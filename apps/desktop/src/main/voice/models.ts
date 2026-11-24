/**
 * Yerel model yöneticisi (`ModelsApi`). Politika listesindeki her dosyanın yerinde ve özetinin doğru
 * olduğunu denetler; eksikleri kullanıcı başlatınca önce bilinen yerel kaynaklardan yerleştirir, bulamazsa
 * ağdan indirir. Listede olmayan dosya hiçbir zaman kullanılmaz: `filePath` yalnız listedeki hazır modeller
 * için yol verir.
 *
 * Ağdan indirme (`downloader.ts`): yarıda kalan indirme kaldığı yerden sürer (HTTP Range); adresi
 * `<arşiv>#<arşiv içi yol>` olan dosyalar için arşiv BİR KEZ indirilir ve içinden yalnız istenen dosyalar çıkarılır.
 * Her dosya yerine konmadan önce SHA-256 ile doğrulanır; özeti tutmayan içerik silinir. İptalde yarım dosya
 * kalır (sonraki deneme oradan sürer), başarıda arşiv ve geçici klasör temizlenir.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { t, type LocalModel, type LocalModelProgress, type ModelsApi, type ServiceDeps } from '@fuber/shared';
import { discardPartial, DownloadError, downloadToFile, extractFromZip, hasFreeSpace } from './downloader';
import { knownLocalSources } from './local-sources';
import {
  VerifyCache,
  findLocalCopy,
  hashFile,
  isSafeRelativePath,
  placeFile,
  quickState,
  removeFile,
  resolveModelPath,
  verifyFile,
  type LocalSource,
} from './model-files';

const PROGRESS_INTERVAL_MS = 250;
/** Arşivlerin ve çıkarma klasörlerinin durduğu yer (model klasörünün içinde: aynı sürücü, taşıma anlıktır). */
const DOWNLOADS_DIR = '.downloads';

type ModelFile = LocalModel['files'][number];

export interface ModelsOptions {
  /** Yerel kaynaklar; verilmezse bu bilgisayardaki bilinen klasörler. */
  sources?: () => LocalSource[];
  /** Sınamada: ağ hatasından sonraki ilk yeniden deneme beklemesi (ms). */
  retryDelayMs?: number;
}

export function createModels(deps: ServiceDeps['models'], options: ModelsOptions = {}): ModelsApi {
  const log = deps.log.child('models');
  const root = deps.paths.models;
  const cache = new VerifyCache(root);
  const sources = options.sources ?? knownLocalSources;

  const states = new Map<string, LocalModelProgress>();
  /** Hazırlanmakta olan modeller; tarama bunların durumunu ezmez. */
  const busy = new Set<string>();
  let listKey = '';
  let queue: Promise<void> = Promise.resolve();
  let abort = new AbortController();
  /** İptal edilen hazırlama işleri sıradan çıkmadan da geçersiz sayılsın diye artan sayaç. */
  let generation = 0;

  const models = (): LocalModel[] => deps.policy.get().localModels;
  const totalBytes = (model: LocalModel): number => model.files.reduce((sum, file) => sum + file.bytes, 0);

  const publish = (model: LocalModel, patch: Partial<LocalModelProgress>): LocalModelProgress => {
    const next: LocalModelProgress = {
      id: model.id,
      role: model.role,
      required: model.required,
      status: 'missing',
      receivedBytes: 0,
      totalBytes: totalBytes(model),
      error: null,
      ...patch,
    };
    const prev = states.get(model.id);
    states.set(model.id, next);
    if (
      !prev ||
      prev.status !== next.status ||
      prev.receivedBytes !== next.receivedBytes ||
      prev.error !== next.error
    ) {
      deps.bus.emit('setup.modelProgress', next);
    }
    return next;
  };

  const readyBytes = (model: LocalModel): number =>
    model.files.reduce((sum, file) => sum + (quickState(root, file, cache) === 'ready' ? file.bytes : 0), 0);

  /** Eşzamanlı hızlı değerlendirme; özeti bilinmeyen dosya varsa arka planda doğrulama başlatır. */
  const evaluate = (model: LocalModel): void => {
    if (busy.has(model.id)) return;
    if (model.files.some((file) => !isSafeRelativePath(file.path))) {
      publish(model, { status: 'failed', error: t('voice.models.badPath') });
      return;
    }
    const fileStates = model.files.map((file) => quickState(root, file, cache));
    if (fileStates.every((state) => state === 'ready')) {
      publish(model, { status: 'ready', receivedBytes: totalBytes(model) });
      return;
    }
    if (fileStates.every((state) => state === 'ready' || state === 'unverified')) {
      publish(model, { status: 'verifying', receivedBytes: readyBytes(model) });
      busy.add(model.id);
      enqueue(async () => {
        try {
          for (const file of model.files) await verifyFile(root, file, cache, abort.signal);
        } catch (error) {
          log.warn(`doğrulama yarıda kaldı: ${model.id}`, error);
        } finally {
          cache.save();
          busy.delete(model.id);
          settle(model);
        }
      });
      return;
    }
    publish(model, { status: 'missing', receivedBytes: readyBytes(model), error: t('voice.models.needDownload') });
  };

  /** Doğrulama ya da hazırlama bitince son durumu yazar (yeniden doğrulama başlatmaz). */
  const settle = (model: LocalModel, error: string | null = null): void => {
    const done = model.files.every((file) => quickState(root, file, cache) === 'ready');
    if (done) publish(model, { status: 'ready', receivedBytes: totalBytes(model) });
    else {
      publish(model, {
        status: error ? 'failed' : 'missing',
        receivedBytes: readyBytes(model),
        error: error ?? t('voice.models.needDownload'),
      });
    }
  };

  const enqueue = (job: () => Promise<void>): void => {
    queue = queue.then(job).catch((error) => log.error('model işi hata verdi', error));
  };

  /** Politika listesi değiştiyse durumları baştan kurar. */
  const sync = (): void => {
    const current = models();
    const key = JSON.stringify(current);
    if (key === listKey) return;
    listKey = key;
    const ids = new Set(current.map((model) => model.id));
    for (const id of [...states.keys()]) if (!ids.has(id)) states.delete(id);
    for (const model of current) evaluate(model);
  };

  const downloadsDir = path.join(root, DOWNLOADS_DIR);
  const noSpace = (): Error => Object.assign(new Error(t('voice.models.noSpace')), { userMessage: t('voice.models.noSpace') });

  /** Doğrulanmış geçici dosyayı hedefe taşır ve önbelleğe yazar; özeti tutmuyorsa siler ve fırlatır. */
  const install = async (file: ModelFile, temp: string, signal: AbortSignal): Promise<void> => {
    const sha256 = await hashFile(temp, signal);
    if (sha256 !== file.sha256) {
      removeFile(temp);
      throw Object.assign(new Error(t('voice.models.hashMismatch')), { userMessage: t('voice.models.hashMismatch') });
    }
    const target = resolveModelPath(root, file.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    removeFile(target);
    fs.renameSync(temp, target);
    cache.record(file.path, fs.statSync(target), file.sha256);
  };

  /** Arşivsiz dosya: kaldığı yerden indir, özetle, yerine koy. */
  const downloadDirect = async (file: ModelFile, onBytes: (received: number) => void, signal: AbortSignal): Promise<void> => {
    const target = resolveModelPath(root, file.path);
    const staged = `${target}.download`;
    if (!(await hasFreeSpace(path.dirname(target), file.bytes))) throw noSpace();
    await downloadToFile({ url: file.url, target: staged, signal, retryDelayMs: options.retryDelayMs, onProgress: (received) => onBytes(received) });
    try {
      await install(file, staged, signal);
    } catch (error) {
      // İçerik bozuk: yarım dosyadan sürdürmek aynı bozuk içeriği verir.
      discardPartial(staged);
      throw error;
    }
  };

  /**
   * Aynı arşivden gelen dosyalar: arşiv bir kez iner, yalnız istenenler çıkarılır, her biri özetlenip yerine konur.
   * `onFraction`: arşivin ne kadarı indi (0–1). Başarıda arşiv ve geçici klasör silinir.
   */
  const downloadArchive = async (archiveUrl: string, files: ModelFile[], onFraction: (fraction: number) => void, signal: AbortSignal): Promise<void> => {
    const key = createHash('sha1').update(archiveUrl).digest('hex').slice(0, 16);
    const archive = path.join(downloadsDir, `${key}.zip`);
    const extractDir = path.join(downloadsDir, `x-${key}`);
    const wanted = files.reduce((sum, file) => sum + file.bytes, 0);
    // Arşiv + çıkarılan dosyalar aynı anda diskte durur.
    if (!(await hasFreeSpace(downloadsDir, wanted * 2))) throw noSpace();
    if (!fs.existsSync(archive)) {
      await downloadToFile({
        url: archiveUrl,
        target: archive,
        signal,
        retryDelayMs: options.retryDelayMs,
        onProgress: (received, total) => onFraction(total ? Math.min(1, received / total) : 0),
      });
    }
    onFraction(1);
    try {
      const entries = files.map((file) => file.url.slice(file.url.indexOf('#') + 1));
      await extractFromZip({ archive, entries, destDir: extractDir, signal });
      for (const [index, file] of files.entries()) {
        await install(file, path.join(extractDir, ...(entries[index] ?? '').split('/')), signal);
      }
      removeFile(archive);
    } catch (error) {
      // Arşiv bozuksa (açılamadı, içindeki dosyanın özeti tutmadı) saklanmaz: sonraki deneme baştan indirir.
      if (!signal.aborted && !(error instanceof DownloadError && error.code === 'aborted')) removeFile(archive);
      throw error;
    } finally {
      await fs.promises.rm(extractDir, { recursive: true, force: true }).catch(() => {});
    }
  };

  const prepare = async (model: LocalModel, startedIn: number): Promise<void> => {
    if (startedIn !== generation) {
      busy.delete(model.id);
      settle(model);
      return;
    }
    const signal = abort.signal;
    const local = sources();
    let received = readyBytes(model);
    let lastEmit = 0;
    const progress = (status: LocalModelProgress['status'], force = false): void => {
      const now = Date.now();
      if (!force && now - lastEmit < PROGRESS_INTERVAL_MS) return;
      lastEmit = now;
      publish(model, { status, receivedBytes: Math.min(received, totalBytes(model)) });
    };

    let failure: string | null = null;
    const fail = (file: ModelFile, error: unknown): void => {
      if (signal.aborted) return;
      failure = (error as { userMessage?: string }).userMessage ?? t('voice.models.fileFailed', { file: file.path });
      log.warn(`model dosyası hazırlanamadı: ${file.path}`, error);
    };
    progress('downloading', true);

    // 1) Yerinde duran ya da bu bilgisayarda kopyası bulunan dosyalar; kalanı ağdan gelecek.
    const remote: ModelFile[] = [];
    for (const file of model.files) {
      if (signal.aborted) break;
      if (quickState(root, file, cache) === 'ready') continue;
      try {
        if (await verifyFile(root, file, cache, signal)) {
          received += file.bytes;
          continue;
        }
        const copy = await findLocalCopy(file, local, cache, signal);
        if (copy) {
          const how = await placeFile(root, file, copy, cache);
          log.info(`model dosyası yerel kaynaktan yerleştirildi (${how}): ${file.path}`);
          received += file.bytes;
          progress('downloading');
          continue;
        }
        remote.push(file);
      } catch (error) {
        fail(file, error);
      }
    }

    // 2) Ağdan: arşivsiz dosyalar tek tek, arşivdekiler arşiv başına bir indirmeyle.
    if (remote.length > 0 && deps.policy.networkAllowed() && !signal.aborted) {
      const base = received;
      const archives = new Map<string, ModelFile[]>();
      for (const file of remote) {
        if (signal.aborted) break;
        const hash = file.url.indexOf('#');
        if (hash >= 0) {
          const url = file.url.slice(0, hash);
          archives.set(url, [...(archives.get(url) ?? []), file]);
          continue;
        }
        const before = received;
        try {
          await downloadDirect(
            file,
            (bytes) => {
              received = before + Math.min(bytes, file.bytes);
              progress('downloading');
            },
            signal,
          );
          received = before + file.bytes;
          log.info(`model dosyası indirildi: ${file.path}`);
        } catch (error) {
          received = before;
          fail(file, error);
        }
      }
      for (const [url, files] of archives) {
        if (signal.aborted) break;
        const before = received;
        const bytes = files.reduce((sum, file) => sum + file.bytes, 0);
        try {
          await downloadArchive(
            url,
            files,
            (fraction) => {
              received = before + Math.round(bytes * fraction);
              progress('downloading');
            },
            signal,
          );
          received = before + bytes;
          log.info(`arşivden ${files.length} dosya çıkarıldı: ${url.split('/').pop() ?? url}`);
        } catch (error) {
          received = before;
          fail(files[0] as ModelFile, error);
        }
      }
      if (received > base) progress('downloading', true);
    }
    cache.save();
    busy.delete(model.id);
    settle(model, failure);
  };

  deps.bus.on('policy.changed', ({ changedKeys }) => {
    if (changedKeys.includes('localModels')) sync();
  });

  return {
    status() {
      sync();
      return models().flatMap((model) => states.get(model.id) ?? []);
    },
    ready(role) {
      sync();
      return models()
        .filter((model) => model.role === role && model.required)
        .every((model) => states.get(model.id)?.status === 'ready');
    },
    filePath(modelId, relativePath) {
      sync();
      const model = models().find((item) => item.id === modelId);
      if (!model || states.get(modelId)?.status !== 'ready') return null;
      const file = relativePath ? model.files.find((item) => item.path === relativePath) : model.files[0];
      return file ? resolveModelPath(root, file.path) : null;
    },
    download(ids) {
      sync();
      const wanted = models().filter((model) => (ids ? ids.includes(model.id) : model.required));
      for (const model of wanted) {
        const state = states.get(model.id);
        if (busy.has(model.id) || state?.status === 'ready') continue;
        if (model.files.some((file) => !isSafeRelativePath(file.path))) continue;
        busy.add(model.id);
        publish(model, { status: 'queued', receivedBytes: readyBytes(model) });
        const startedIn = generation;
        enqueue(() => prepare(model, startedIn));
      }
      return models().flatMap((model) => states.get(model.id) ?? []);
    },
    cancel() {
      generation++;
      abort.abort();
      abort = new AbortController();
    },
  };
}
