/**
 * İzinli klasörler ve çıktı klasörü. Varsayılan: Belgeler, Masaüstü, İndirilenler (yalnız okuma). Kullanıcı Ayarlar'dan
 * klasör ekler/kaldırır, varsayılanı kapatabilir; başka modüllerin izin verdiği klasörler olayla gelir (`documents.allowPaths`).
 * Yazma yalnız çıktı klasörüne yapılır (varsayılan `Belgeler\Fuber AI 2`; Ayarlar'dan değişir).
 */
import fs from 'node:fs';
import nodePath from 'node:path';
import type { ScopedDb } from '@fuber/shared';
import { checkFolderChoice, isInside, type AccessConfig } from './access';
import type { FolderEntry, FoldersView } from './types';

export interface KnownFolders {
  documents: string;
  desktop: string;
  downloads: string;
}

interface Stored {
  user: string[];
  disabledDefaults: string[];
  output: string | null;
}

const KEY = 'folders';
const OUTPUT_FOLDER_NAME = 'Fuber AI 2';
const DEFAULT_LABELS: Record<keyof KnownFolders, string> = { documents: 'Belgeler', desktop: 'Masaüstü', downloads: 'İndirilenler' };

export interface Folders {
  view(): FoldersView;
  /** Okumanın serbest olduğu kökler (varsayılan + kullanıcı + başka modüllerin izin verdikleri). */
  readRoots(): string[];
  output(): string;
  addUser(path: string): { ok: true } | { ok: false; reason: string };
  remove(path: string): void;
  restore(path: string): void;
  setOutput(path: string | null): { ok: true } | { ok: false; reason: string };
  /** Başka modülden gelen izinli dosyaların klasörleri. */
  setExternal(source: string, files: string[]): void;
  known(): KnownFolders;
  /** "Masaüstü", "belgelerim", "downloads" gibi adları klasöre çevirir; tanınmazsa `null`. */
  alias(name: string): string | null;
}

export function createFolders(deps: { db: ScopedDb; known: () => KnownFolders; access: () => AccessConfig }): Folders {
  const external = new Map<string, string[]>();
  const platform = () => deps.access().platform;

  const load = (): Stored => {
    const row = deps.db.get<{ value: string }>('SELECT value FROM documents_settings WHERE key = ?', [KEY]);
    if (!row) return { user: [], disabledDefaults: [], output: null };
    try {
      const value = JSON.parse(row.value) as Partial<Stored>;
      return {
        user: Array.isArray(value.user) ? value.user.filter((item) => typeof item === 'string') : [],
        disabledDefaults: Array.isArray(value.disabledDefaults) ? value.disabledDefaults.filter((item) => typeof item === 'string') : [],
        output: typeof value.output === 'string' ? value.output : null,
      };
    } catch {
      return { user: [], disabledDefaults: [], output: null };
    }
  };
  const save = (value: Stored) =>
    deps.db.run('INSERT INTO documents_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [KEY, JSON.stringify(value)]);

  const same = (a: string, b: string) => isInside(a, b, platform()) && isInside(b, a, platform());
  const exists = (folder: string) => {
    try {
      return fs.statSync(folder).isDirectory();
    } catch {
      return false;
    }
  };

  const defaults = (): FolderEntry[] =>
    (Object.keys(DEFAULT_LABELS) as Array<keyof KnownFolders>).map((key) => {
      const path = deps.known()[key];
      return { path, label: DEFAULT_LABELS[key], source: 'default' as const, exists: exists(path) };
    });

  const defaultOutput = () => nodePath.join(deps.known().documents, OUTPUT_FOLDER_NAME);

  const api: Folders = {
    known: deps.known,

    view() {
      const stored = load();
      const all = defaults();
      const enabled = all.filter((entry) => !stored.disabledDefaults.some((path) => same(path, entry.path)));
      const disabled = all.filter((entry) => !enabled.includes(entry));
      const user = stored.user.map((path): FolderEntry => ({ path, label: nodePath.basename(path) || path, source: 'user', exists: exists(path) }));
      const external_: FolderEntry[] = [];
      for (const files of external.values()) {
        for (const file of files) {
          const folder = nodePath.dirname(file);
          if (external_.some((entry) => same(entry.path, folder))) continue;
          external_.push({ path: folder, label: nodePath.basename(folder) || folder, source: 'external', exists: exists(folder) });
        }
      }
      return {
        read: [...enabled, ...user, ...external_],
        disabledDefaults: disabled,
        output: stored.output ?? defaultOutput(),
        outputIsDefault: stored.output === null,
      };
    },

    readRoots() {
      const view = api.view();
      // Başka modüllerin açtığı klasörler yine engel listesinden geçer: AppData'daki bir kayıt oraya kapı açmasın.
      return view.read.filter((entry) => entry.source !== 'external' || checkFolderChoice(entry.path, deps.access()).ok).map((entry) => entry.path);
    },

    output: () => api.view().output,

    addUser(path) {
      const checked = checkFolderChoice(path, deps.access());
      if (!checked.ok) return checked;
      const stored = load();
      if (!stored.user.some((item) => same(item, checked.path)) && !defaults().some((entry) => same(entry.path, checked.path))) stored.user.push(checked.path);
      stored.disabledDefaults = stored.disabledDefaults.filter((item) => !same(item, checked.path));
      save(stored);
      return { ok: true };
    },

    remove(path) {
      const stored = load();
      stored.user = stored.user.filter((item) => !same(item, path));
      if (defaults().some((entry) => same(entry.path, path)) && !stored.disabledDefaults.some((item) => same(item, path))) stored.disabledDefaults.push(path);
      save(stored);
    },

    restore(path) {
      const stored = load();
      stored.disabledDefaults = stored.disabledDefaults.filter((item) => !same(item, path));
      save(stored);
    },

    setOutput(path) {
      const stored = load();
      if (path === null) {
        stored.output = null;
        save(stored);
        return { ok: true };
      }
      const checked = checkFolderChoice(path, deps.access());
      if (!checked.ok) return checked;
      stored.output = checked.path;
      save(stored);
      return { ok: true };
    },

    setExternal(source, files) {
      external.set(source, files.filter((file) => typeof file === 'string' && file.trim()));
    },

    alias(name) {
      const key = name
        .trim()
        .toLocaleLowerCase('tr')
        .replace(/[\\/]+$/, '');
      const known = deps.known();
      if (/^(masaüstü|masaustu|masa üstü|desktop)(m|ü|ümdeki|deki|ndeki)?$/.test(key)) return known.desktop;
      if (/^(belgeler|belgelerim|dokümanlar|dokumanlar|documents|my documents)(deki|imdeki)?$/.test(key)) return known.documents;
      if (/^(indirilenler|indirmeler|downloads|i̇ndirilenler)(deki|imdeki)?$/.test(key)) return known.downloads;
      const user = load().user.find((item) => nodePath.basename(item).toLocaleLowerCase('tr') === key);
      return user ?? null;
    },
  };
  return api;
}
