// Belgeler modülü (demo.2 G2 + P1-7): belge okuma (PDF, Word, Excel, PowerPoint, CSV, e-posta, metin), sohbete dosya
// ekleme, dosya araçları ve belge üretme. Ayrıştırma ve Office üretimi AYRI süreçte (`worker/entry.ts`), süre ve bellek
// sınırıyla. Erişim kapısı `access.ts`; izinli klasörler `folders.ts` (Ayarlar › Gizlilik › Dosya erişimi).
import os from 'node:os';
import nodePath from 'node:path';
import { defineModule, UserError, type ModuleContext, type Unsubscribe } from '@fuber/shared';
import { deepBrainFor } from '../../core/brain/deep';
import { testing } from '../../testing';
import type { AccessConfig } from './access';
import { electronPdf } from './create';
import { setDefaultDeepVision } from './deep';
import { PICKER_EXTENSIONS } from './formats';
import type { KnownFolders } from './folders';
import { createDocumentsService, type DocumentsService } from './service';
import { createTools } from './tools';
import type { FoldersView } from './types';
import { createDocWorker, type DocWorker } from './worker-client';
import './types';

export { setDeepVisionProvider } from './deep';

/** Sınamada (vitest) Electron yerine verilenler. */
export interface DocumentsOverrides {
  worker?: DocWorker;
  known?: KnownFolders;
  home?: string;
  storageDir?: string;
  printPdf?: (html: string) => Promise<Uint8Array>;
  pickFiles?: () => Promise<string[]>;
  pickFolder?: () => Promise<string | null>;
  openFolder?: (folder: string) => Promise<void>;
}

let overrides: DocumentsOverrides = {};
export function configureDocuments(next: DocumentsOverrides): void {
  overrides = next;
}

let service: DocumentsService | null = null;
let worker: DocWorker | null = null;
const subscriptions: Unsubscribe[] = [];

/** Uçtan uca sınamada iletişim kutusu açılmaz: seçilecek yollar bu kuyruktan gelir (`__fuber2Test.documents`). */
const testPicks: { files: string[][]; folders: Array<string | null> } = { files: [], folders: [] };

function current(): DocumentsService {
  if (!service) throw new UserError('Belgeler modülü hazır değil.');
  return service;
}

/**
 * Bilgisayar modülünün dosya araçları (kopyala, taşı, sil, aç) AYNI erişim kurallarını kullanır: izinli klasörler,
 * engelli yollar, "Masaüstü\x" kısaltmaları. Belgeler modülü kapalıyken (ya da henüz kurulmadan) `null`.
 */
export function documentsAccess(): { config(): AccessConfig; expand(raw: string): string; known(): KnownFolders } | null {
  const active = service;
  return active ? { config: () => active.accessConfig(), expand: (raw) => active.expand(raw), known: () => active.folders.known() } : null;
}

async function knownFolders(home: string): Promise<KnownFolders> {
  if (overrides.known) return overrides.known;
  if (testing.enabled) {
    return { documents: nodePath.join(home, 'Documents'), desktop: nodePath.join(home, 'Desktop'), downloads: nodePath.join(home, 'Downloads') };
  }
  const { app } = await import('electron');
  const get = (name: 'documents' | 'desktop' | 'downloads', fallback: string) => {
    try {
      return app.getPath(name);
    } catch {
      return nodePath.join(home, fallback);
    }
  };
  return { documents: get('documents', 'Documents'), desktop: get('desktop', 'Desktop'), downloads: get('downloads', 'Downloads') };
}

async function pickFiles(): Promise<string[]> {
  if (overrides.pickFiles) return overrides.pickFiles();
  if (testing.enabled) return testPicks.files.shift() ?? [];
  const { dialog, BrowserWindow } = await import('electron');
  const parent = BrowserWindow.getFocusedWindow();
  const options: Electron.OpenDialogOptions = {
    title: 'Sohbete dosya ekle',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Belgeler ve görseller', extensions: [...PICKER_EXTENSIONS] },
      { name: 'Bütün dosyalar', extensions: ['*'] },
    ],
  };
  const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
  return result.canceled ? [] : result.filePaths;
}

async function pickFolder(title: string): Promise<string | null> {
  if (overrides.pickFolder) return overrides.pickFolder();
  if (testing.enabled) return testPicks.folders.shift() ?? null;
  const { dialog, BrowserWindow } = await import('electron');
  const parent = BrowserWindow.getFocusedWindow();
  const options: Electron.OpenDialogOptions = { title, properties: ['openDirectory', 'createDirectory'] };
  const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
  return result.canceled ? null : (result.filePaths[0] ?? null);
}

async function openFolder(folder: string): Promise<void> {
  if (overrides.openFolder) return overrides.openFolder(folder);
  if (testing.fakeLaunch) {
    await testing.fakeShell.openPath(folder);
    return;
  }
  const { shell } = await import('electron');
  const error = await shell.openPath(folder);
  if (error) throw new UserError(error);
}

async function workerPath(): Promise<string> {
  const { runtime } = await import('../../runtime');
  return nodePath.join(runtime.distDir, 'doc-worker', 'index.js');
}

const failIfNot = (result: { ok: true } | { ok: false; reason: string }) => {
  if (!result.ok) throw new UserError(result.reason);
};

export default defineModule({
  id: 'documents',
  version: '1.0.0',
  nameKey: 'module.documents.name',
  descriptionKey: 'module.documents.description',
  permissions: ['fs'],

  migrations: [
    {
      id: 1,
      name: 'ayarlar ve ekler',
      up: `CREATE TABLE documents_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE documents_attachments (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        bytes INTEGER NOT NULL,
        media_type TEXT,
        status TEXT NOT NULL,
        note TEXT,
        format TEXT,
        title TEXT,
        meta TEXT NOT NULL DEFAULT '{}',
        -- Belgenin bölümleri (JSON); dosyanın kendisi saklanmaz (görsel ve taranmış PDF dışında).
        sections TEXT NOT NULL DEFAULT '[]',
        total_chars INTEGER NOT NULL DEFAULT 0,
        truncated INTEGER NOT NULL DEFAULT 0,
        file TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX documents_attachments_created ON documents_attachments (created_at);`,
    },
  ],

  tools: createTools(current),

  ipc: (ctx) => {
    const view = (): FoldersView => current().folders.view();
    return {
      'documents.folders': () => view(),
      'documents.addFolder': async ({ path }) => {
        const chosen = path ?? (await pickFolder('İzinli klasör ekle'));
        if (chosen) failIfNot(current().folders.addUser(chosen));
        return view();
      },
      'documents.removeFolder': ({ path }) => {
        current().folders.remove(path);
        return view();
      },
      'documents.restoreFolder': ({ path }) => {
        current().folders.restore(path);
        return view();
      },
      'documents.setOutput': async ({ path, reset }) => {
        if (reset) {
          failIfNot(current().folders.setOutput(null));
          return view();
        }
        const chosen = path ?? (await pickFolder('Belgelerin kaydedileceği klasör'));
        if (chosen) failIfNot(current().folders.setOutput(chosen));
        return view();
      },
      'documents.openOutput': async () => {
        const folder = current().folders.output();
        const fs = await import('node:fs');
        fs.mkdirSync(folder, { recursive: true });
        await openFolder(folder);
        return { ok: true };
      },
      'documents.pickAttachments': async () => current().attachPaths(await pickFiles()),
      'documents.attachFiles': ({ files }) => {
        if (!Array.isArray(files)) throw new UserError('Dosya listesi geçersiz.');
        return current().attachDropped(files);
      },
      'documents.discardAttachment': ({ id }) => {
        current().discardAttachment(id);
        ctx.log.debug('ek atıldı', { id });
        return { ok: true };
      },
    };
  },

  async setup(ctx: ModuleContext) {
    // Taranmış PDF ve görsel ek: çekirdeğin derin beyni (Anthropic API ya da bu bilgisayardaki Claude Code) görüntüye bakar.
    setDefaultDeepVision((moduleCtx) => deepBrainFor(moduleCtx));
    const home = overrides.home ?? (testing.enabled ? (testing.documentsHome ?? nodePath.join(ctx.paths.data, 'test-home')) : os.homedir());
    const known = await knownFolders(home);
    worker = overrides.worker ?? createDocWorker({ workerPath: await workerPath(), mode: 'utility' });
    const storageDir = overrides.storageDir ?? nodePath.join(ctx.paths.data, 'documents');
    service = createDocumentsService({
      ctx,
      worker,
      known: () => known,
      home,
      printPdf: overrides.printPdf ?? ((html) => electronPdf(html, nodePath.join(ctx.paths.temp, 'documents'))),
      storageDir,
    });
    subscriptions.push(ctx.conversation.useAttachmentResolver(service.resolver));
    subscriptions.push(ctx.bus.on('documents.allowPaths', ({ source, paths }) => service?.folders.setExternal(source, paths)));
    ctx.bus.emit('documents.allowPaths.request', {});
    const purged = service.purgeOld();
    if (purged) ctx.log.info(`${purged} eski ek silindi`);
    testing.expose({
      documents: {
        queueFiles: (paths: string[]) => testPicks.files.push(paths),
        queueFolder: (path: string | null) => testPicks.folders.push(path),
        folders: () => service?.folders.view(),
      },
    });
  },

  teardown() {
    for (const unsubscribe of subscriptions.splice(0)) unsubscribe();
    worker?.dispose();
    worker = null;
    service = null;
  },
});
