// Claude Code oturum dizinleyicisi: `<claudeDir>/<proje-klasörü>/<oturum>.jsonl` dosyalarını artımlı okur.
// Alt ajan dökümleri (`<oturum>/subagents/*.jsonl`) sürdürülebilir oturum olmadığı için dizine girmez.
// Arka planda, parça parça çalışır ve her parçadan sonra olay döngüsüne yol verir (arayüz kilitlenmez).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { nowIso, type Logger } from '@fuber/shared';
import { applyEntry, parseLine, readNewLines, type NewMessage } from './jsonl';
import type { ProjectsRepo } from './repo';
import type { IndexStatus } from './types';

const SESSION_FILE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.jsonl$/;
/** Bir parçada birikip tek işlemde yazılan en çok ileti. */
const COMMIT_EVERY = 400;

export interface SessionFile {
  id: string;
  path: string;
  size: number;
  mtimeMs: number;
}

/** Oturum dosyalarını listeler (yalnız proje klasörlerinin doğrudan altındaki `<uuid>.jsonl`). */
export async function listSessionFiles(claudeDir: string): Promise<SessionFile[]> {
  let dirs: fs.Dirent[];
  try {
    dirs = await fsp.readdir(claudeDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: SessionFile[] = [];
  for (const dir of dirs) {
    if (!dir.isDirectory() || dir.name.startsWith('.')) continue;
    const full = path.join(claudeDir, dir.name);
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(full, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !SESSION_FILE.test(entry.name)) continue;
      const file = path.join(full, entry.name);
      try {
        const stat = await fsp.stat(file);
        files.push({ id: entry.name.slice(0, -'.jsonl'.length), path: file, size: stat.size, mtimeMs: stat.mtimeMs });
      } catch {
        // dosya bu arada silindi
      }
    }
  }
  return files;
}

const yieldLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

export interface IndexerDeps {
  repo: ProjectsRepo;
  log: Logger;
  claudeDir(): string;
  /** Oturum klasörünü projeye bağlar. */
  projectFor(cwd: string): string | null;
  onProgress(status: IndexStatus): void;
  /** Bir geçiş bitti (yeni oturum ya da proje klasörü çıkmış olabilir). */
  onPassDone(changedFiles: number): void;
}

export function createIndexer(deps: IndexerDeps) {
  let status: IndexStatus = {
    state: 'idle',
    filesDone: 0,
    filesTotal: 0,
    bytesDone: 0,
    bytesTotal: 0,
    sessions: 0,
    messages: 0,
    lastIndexedAt: null,
    lastDurationMs: null,
    error: null,
    claudeDir: '',
  };
  let running: Promise<void> | null = null;
  let again = false;
  let stopped = false;
  let lastEmit = 0;
  let watcher: fs.FSWatcher | null = null;
  let debounce: ReturnType<typeof setTimeout> | null = null;

  const emit = (force = false) => {
    const now = Date.now();
    if (!force && now - lastEmit < 250) return;
    lastEmit = now;
    deps.onProgress({ ...status });
  };

  /** Tek dosyayı son konumundan dosya sonuna kadar dizinler. Değişen bayt sayısını döndürür. */
  const indexFile = async (
    file: SessionFile,
    state: { file_offset: number; file_head: string | null; file_size: number; file_mtime: number } | undefined,
    onBytes: (n: number) => void,
  ) => {
    const cursor = { offset: state?.file_offset ?? 0, head: state?.file_head ?? null };
    let acc = deps.repo.acc(file.id);
    let pending: NewMessage[] = [];
    let lastOffset = cursor.offset;
    let head = cursor.head;
    const headOf = () => head;
    const projectOf = () => (acc.cwd ? deps.projectFor(acc.cwd) : null);
    const result = await readNewLines(file.path, cursor, {
      onReset() {
        // Dosya küçüldü ya da yeniden yazıldı: eski iletileri sil, birikimi sıfırla, baştan oku.
        deps.repo.resetSession(file.id);
        acc = deps.repo.acc(file.id);
        pending = [];
        lastOffset = 0;
        deps.log.info(`oturum dosyası yeniden yazılmış, baştan okunuyor (${file.id.slice(0, 8)})`);
      },
      onLine(line) {
        const entry = line === null ? null : parseLine(line);
        if (!entry) return;
        const message = applyEntry(acc, entry);
        if (message) pending.push(message);
      },
      onChunk: async (offset, currentHead) => {
        if (stopped) throw new Error('durduruldu');
        head = currentHead;
        onBytes(offset - lastOffset);
        lastOffset = offset;
        if (pending.length >= COMMIT_EVERY || offset >= file.size) {
          // Ara kayıtta dosya bilgisi eski kalır (mtime/boyut): yarıda kesilirse sonraki geçiş dosyayı yine ele alır.
          deps.repo.commitChunk(file.id, file.path, acc, pending, { offset, size: state?.file_size ?? 0, head: headOf(), mtimeMs: state?.file_mtime ?? 0 }, projectOf());
          pending = [];
        }
        await yieldLoop();
      },
    });
    // Son kalanları ve dosya bilgisini yaz (yeni satır olmasa da boyut/zaman güncellenir).
    deps.repo.commitChunk(
      file.id,
      file.path,
      acc,
      pending,
      { offset: result.cursor.offset, size: result.size, head: result.cursor.head, mtimeMs: result.mtimeMs },
      projectOf(),
    );
    return result;
  };

  const pass = async (only?: Set<string>) => {
    const started = Date.now();
    const dir = deps.claudeDir();
    status = { ...status, state: 'indexing', error: null, claudeDir: dir, filesDone: 0, bytesDone: 0 };
    const files = await listSessionFiles(dir);
    const known = new Map(deps.repo.fileStates().map((state) => [state.id, state]));
    const present = new Set(files.map((file) => file.id));
    const missing = [...known.keys()].filter((id) => !present.has(id));
    if (!only && missing.length) deps.repo.removeMissing(missing);

    const todo = files
      .filter((file) => !only || only.has(file.id))
      .filter((file) => {
        const state = known.get(file.id);
        return !state || state.file_size !== file.size || state.file_mtime !== file.mtimeMs || state.file_offset > file.size;
      })
      // En yeni oturumlar önce: arayüz son çalışmaları hemen görsün.
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    status.filesTotal = todo.length;
    status.bytesTotal = todo.reduce((sum, file) => sum + Math.max(0, file.size - (known.get(file.id)?.file_offset ?? 0)), 0);
    emit(true);
    for (const file of todo) {
      if (stopped) break;
      try {
        await indexFile(file, known.get(file.id), (n) => {
          status.bytesDone += Math.max(0, n);
          emit();
        });
      } catch (error) {
        if (stopped) break;
        deps.log.warn(`oturum dosyası okunamadı (${file.id.slice(0, 8)})`, error instanceof Error ? error.message : error);
      }
      status.filesDone++;
      const counts = deps.repo.counts();
      status.sessions = counts.sessions;
      status.messages = counts.messages;
      emit();
    }
    const counts = deps.repo.counts();
    status = { ...status, ...counts, state: 'idle', lastIndexedAt: nowIso(), lastDurationMs: Date.now() - started };
    emit(true);
    deps.onPassDone(todo.length);
  };

  const run = (only?: Set<string>): Promise<void> => {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          again = false;
          await pass(only);
          only = undefined;
        } while (again && !stopped);
      } catch (error) {
        status = { ...status, state: 'error', error: error instanceof Error ? error.message : String(error) };
        emit(true);
        deps.log.error('oturum dizinleme başarısız', error);
      } finally {
        running = null;
      }
    })();
    return running;
  };

  const pendingIds = new Set<string>();

  return {
    status: () => ({ ...status }),
    /** Bütün klasörü tarar; yalnız değişen dosyaları okur. */
    run: () => run(),
    whenIdle: () => running ?? Promise.resolve(),
    /** Klasördeki değişikliği izler (Windows'ta özyinelemeli). Kaçan olaylar için çağıran ayrıca dönemsel `run` yapar. */
    watch() {
      this.unwatch();
      const dir = deps.claudeDir();
      try {
        watcher = fs.watch(dir, { recursive: true }, (_event, name) => {
          if (!name) return;
          const parts = String(name).split(/[\\/]/);
          if (parts.length !== 2 || !SESSION_FILE.test(parts[1]!)) return;
          pendingIds.add(parts[1]!.slice(0, -'.jsonl'.length));
          if (debounce) clearTimeout(debounce);
          debounce = setTimeout(() => {
            debounce = null;
            const ids = new Set(pendingIds);
            pendingIds.clear();
            void run(ids);
          }, 600);
        });
        watcher.on('error', (error) => deps.log.warn('oturum klasörü izlenemiyor', error.message));
      } catch (error) {
        deps.log.warn('oturum klasörü izlenemiyor', error instanceof Error ? error.message : error);
      }
    },
    unwatch() {
      watcher?.close();
      watcher = null;
      if (debounce) clearTimeout(debounce);
      debounce = null;
    },
    async stop() {
      stopped = true;
      this.unwatch();
      await running?.catch(() => {});
    },
  };
}

export type Indexer = ReturnType<typeof createIndexer>;
