/**
 * Bilgisayar modülünün DOSYA YÖNETİMİ araçları: ada göre arama, kopyalama, taşıma/yeniden adlandırma, klasör oluşturma,
 * Geri Dönüşüm Kutusu'na gönderme, varsayılan uygulamada açma, Gezgin'de gösterme; metin dosyası yazma ve düzenleme
 * (`file_write`, `file_edit`: v1'deki `dosya_yaz`, `dosya_duzenle`).
 *
 * Erişim kuralları belgeler modülününkilerle AYNIDIR (`documents/access.ts`): sistem klasörleri, uygulama verisi
 * (AppData), tarayıcı profilleri ve parola/anahtar dosyaları HİÇBİR koşulda (onayla da) dokunulmaz; izinli klasörlerin
 * içi serbesttir; dışına dokunan her işlem kullanıcıdan HER SEFERİNDE onay ister. Karar dosyanın GERÇEK yoluna göre
 * verilir (bağ, bağlantı noktası çözülür); bağın kendisi kopyalanmaz, taşınmaz, silinmez.
 *
 * Değişmezler (birim sınamalı: `files.test.ts`):
 *  1. Hiçbir araç var olan bir dosyanın ÜZERİNE onaysız YAZMAZ: kopyalama/taşıma hiç yazmaz; `file_write` yalnız
 *     `overwrite: true` ve HER SEFERİNDE onay kartıyla (yol, eski ve yeni boyut). `file_edit` yalnız birebir eşleşen
 *     parçayı değiştirir; dosyanın satır sonu ve BOM'u korunur.
 *  1b. Çalıştırılabilir/betik uzantılı dosya YAZILMAZ ve DÜZENLENMEZ (onayla da); bağ ve çok adlı (sabit bağlı) dosyaya yazılmaz.
 *  2. Silme kalıcı değildir: yalnız Geri Dönüşüm Kutusu (`env.trash`), her seferinde onay (`risk: 'danger'`).
 *  3. İzinli klasörün kendisi, kullanıcı klasörü (ve doğrudan alt klasörleri), sürücü kökü taşınamaz/silinemez.
 *  4. Çalıştırılabilir ve betik dosyaları `file_open` ile AÇILMAZ; yeniden adlandırma bir dosyayı çalıştırılabilir yapamaz.
 *  5. "Durdur"/acil dur (`env.gate`) süren kopyayı ve aramayı keser; yenisi bir süre başlamaz.
 * Bu dosya Electron'a bağlı değildir: çöp kutusu, açma ve Gezgin dışarıdan (`FilesEnv`) gelir.
 */
import fs from 'node:fs';
import nodePath from 'node:path';
import { defineTool, foldForSearch, searchTerms, t, type ApprovalKind, type JsonValue, type ToolContext, type ToolDef, type ToolResult } from '@fuber/shared';
import { z } from 'zod';
import { blockedReason, checkAccess, checkPathText, isInside, type AccessConfig } from '../documents/access';
import type { PcGate } from './gate';

export interface FilesEnv {
  gate: PcGate;
  /** Belgeler modülünün erişim kuralları (izinli kökler, engelli yollar). */
  access(): AccessConfig;
  /** "Masaüstü\\x.txt" → tam yol. */
  expand(raw: string): string;
  /** Geri Dönüşüm Kutusu (gerçeği Electron `shell.trashItem`; sınamada sahte). */
  trash(path: string): Promise<void>;
  /** Varsayılan uygulamada açar; `''` = başarı, değilse hata metni. */
  openPath(target: string): Promise<string>;
  /** Gezgin'de gösterir (öğe seçili). */
  reveal(path: string): void;
}

/** Sınırlar: küçük ve öngörülebilir. Büyük işi kullanıcı Gezgin'de yapar (`file_reveal`). */
export const FILE_LIMITS = {
  copyItems: 2000,
  copyBytes: 2 * 1024 ** 3,
  findResults: 20,
  findResultsMax: 50,
  findDepth: 8,
  findScan: 40_000,
  findMs: 5000,
  deleteCount: 5000,
  mkdirLevels: 5,
  /** `file_write` içeriği (UTF-8 bayt): bir model çıktısına sığan metin. */
  writeBytes: 1024 ** 2,
  /** `file_edit` bu boyuta kadar metin dosyasını açar ve bu boyutu aşan sonucu yazmaz. */
  editBytes: 5 * 1024 ** 2,
} as const;

/** `file_open` bunları açmaz; yeniden adlandırma/kopyalama bir dosyayı bu uzantılara çeviremez. */
export const EXECUTABLE_EXTENSIONS: ReadonlySet<string> = new Set([
  'exe', 'com', 'scr', 'pif', 'cpl', 'msi', 'msp', 'msix', 'msixbundle', 'appx', 'appxbundle', 'appinstaller', 'bat', 'cmd', 'ps1', 'psm1', 'psd1', 'ps1xml', 'vbs',
  'vbe', 'js', 'jse', 'mjs', 'cjs', 'wsf', 'wsh', 'hta', 'jar', 'reg', 'lnk', 'url', 'scf', 'inf', 'msc', 'gadget', 'application', 'py', 'pyw', 'sh', 'dll', 'sys',
  'chm', 'hlp', 'iso', 'img', 'vhd', 'vhdx', 'library-ms', 'search-ms', 'settingcontent-ms', 'website', 'xll', 'xlam', 'docm', 'xlsm', 'pptm',
]);

const fail = (text: string, data: Record<string, unknown> = {}): ToolResult => ({ ok: false, text, data });
const lib = (platform: NodeJS.Platform) => (platform === 'win32' ? nodePath.win32 : nodePath.posix);
const extensionOf = (name: string): string => {
  const base = name.split(/[\\/]/).pop() ?? name;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
};
const errorText = (error: unknown): string => {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') return 'dosya kullanımda ya da erişim izni yok (açık bir programda olabilir)';
  if (code === 'ENOSPC') return 'diskte yer kalmadı';
  if (code === 'ENOENT') return 'dosya ya da klasör artık yerinde değil';
  return error instanceof Error ? error.message : String(error);
};

export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

const RESERVED_NAME = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

/** Modelin verdiği yeni ad tek bir yol bileşeni mi (ayırıcı, yasak karakter, sondaki nokta/boşluk, ayrılmış ad yok). */
export function validName(name: string): boolean {
  const value = name.trim();
  if (!value || value === '.' || value === '..' || value.length > 200) return false;
  if (/[\\/<>:"|?*\u0000-\u001f]/.test(value)) return false;
  if (/[. ]$/.test(value)) return false;
  return !RESERVED_NAME.test(value);
}

type Located =
  | {
      ok: true;
      /** Dosya sisteminin gerçek yolu (bağlar çözülmüş); işlem bununla yapılır. */
      path: string;
      dir: boolean;
      /** Verilen yolun son bileşeni bir bağ (sembolik bağ / bağlantı noktası). */
      link: boolean;
      /** İzinli köklerin içinde (onay gerekmez). */
      inside: boolean;
    }
  | { ok: false; result: ToolResult };

export function fileTools(env: FilesEnv): { read: ToolDef[]; control: ToolDef[] } {
  const platform = () => env.access().platform;
  const same = (a: string, b: string) => isInside(a, b, platform()) && isInside(b, a, platform());

  const realOrSelf = (target: string): string => {
    try {
      return fs.realpathSync.native(target);
    } catch {
      return target;
    }
  };

  /** İzinli köklerin içinde mi (kökün yazılan ve gerçek yoluna göre). */
  const insideRoots = (target: string, config: AccessConfig): boolean =>
    config.readRoots().some((root) => isInside(target, root, config.platform) || isInside(target, realOrSelf(root), config.platform));

  /** Var olan dosya/klasör: yazı denetimi → engel → gerçek yol → engel → izinli mi. */
  const locate = (raw: string): Located => {
    const config = env.access();
    const text = checkPathText(env.expand(raw), config.platform);
    if (!text.ok) return { ok: false, result: fail(t('pc.files.badPath', { reason: text.reason }), { reason: 'bad_path' }) };
    const lexicalBlock = blockedReason(text.path, config);
    if (lexicalBlock) return { ok: false, result: fail(t('pc.files.blocked', { reason: lexicalBlock }), { reason: 'blocked' }) };
    let link: boolean;
    let dir: boolean;
    try {
      link = fs.lstatSync(text.path).isSymbolicLink();
      dir = fs.statSync(text.path).isDirectory();
    } catch {
      return { ok: false, result: fail(t('pc.files.missing', { path: text.path }), { reason: 'missing' }) };
    }
    const decision = checkAccess(text.path, dir ? 'dir' : 'file', config);
    if (decision.kind === 'deny') return { ok: false, result: fail(decision.reason, { reason: 'blocked' }) };
    return { ok: true, path: decision.path, dir, link, inside: decision.kind === 'allow' };
  };

  /** Henüz olmayabilecek hedef: var olan en yakın üst klasörün GERÇEK yoluna göre denetlenir. */
  const locateNew = (lexical: string): { ok: true; path: string; inside: boolean; missingLevels: number } | { ok: false; result: ToolResult } => {
    const config = env.access();
    const p = lib(config.platform);
    const lexicalBlock = blockedReason(lexical, config);
    if (lexicalBlock) return { ok: false, result: fail(t('pc.files.blocked', { reason: lexicalBlock }), { reason: 'blocked' }) };
    const rest: string[] = [];
    let anchor = lexical;
    for (;;) {
      try {
        fs.lstatSync(anchor);
        break;
      } catch {
        const parent = p.dirname(anchor);
        if (parent === anchor) return { ok: false, result: fail(t('pc.files.missing', { path: lexical }), { reason: 'missing' }) };
        rest.unshift(p.basename(anchor));
        anchor = parent;
      }
    }
    let real: string;
    try {
      real = fs.realpathSync.native(anchor);
    } catch {
      return { ok: false, result: fail(t('pc.files.missing', { path: anchor }), { reason: 'missing' }) };
    }
    const full = rest.length ? p.join(real, ...rest) : real;
    const text = checkPathText(full, config.platform);
    if (!text.ok) return { ok: false, result: fail(t('pc.files.badPath', { reason: text.reason }), { reason: 'bad_path' }) };
    const realBlock = blockedReason(text.path, config);
    if (realBlock) return { ok: false, result: fail(t('pc.files.blockedReal', { path: text.path, reason: realBlock }), { reason: 'blocked' }) };
    return { ok: true, path: text.path, inside: insideRoots(text.path, config), missingLevels: rest.length };
  };

  /** İzinli kökün kendisi (ya da üstü), kullanıcı klasörü (ve doğrudan alt klasörleri), sürücü kökü. */
  const isProtected = (target: string, dir: boolean): boolean => {
    const config = env.access();
    const p = lib(config.platform);
    if (same(p.parse(target).root, target)) return true;
    const home = realOrSelf(config.home);
    if (isInside(home, target, config.platform) || isInside(config.home, target, config.platform)) return true;
    // Kullanıcı klasörünün doğrudan alt klasörleri (Masaüstü, Belgeler, Resimler, OneDrive…) izinli listede olmasa da korunur.
    if (dir && (same(p.dirname(target), home) || same(p.dirname(target), config.home))) return true;
    return config.readRoots().some((root) => isInside(root, target, config.platform) || isInside(realOrSelf(root), target, config.platform));
  };

  const approve = async (ctx: ToolContext, toolName: string, summary: string, input: JsonValue, kind?: ApprovalKind): Promise<ToolResult | null> => {
    const verdict = await ctx.tools.requestApproval({ toolName, moduleId: ctx.moduleId, summary, input, origin: ctx.origin, ...(kind ? { kind } : {}) });
    if (verdict !== 'approved') return fail(t(verdict === 'expired' ? 'pc.files.approvalExpired' : 'pc.files.approvalDenied'), { reason: 'denied' });
    // Onay beklenirken "Durdur"a basılmış ya da çağrı iptal edilmiş olabilir.
    return env.gate.blocked(ctx);
  };

  const exists = (target: string): boolean => {
    try {
      fs.lstatSync(target);
      return true;
    } catch {
      return false;
    }
  };

  /** Klasördeki öğe sayısı (alt klasörler dahil), sınırla. */
  const countItems = (folder: string, limit: number): { count: number; more: boolean } => {
    let count = 0;
    const stack = [folder];
    while (stack.length) {
      let items: fs.Dirent[];
      try {
        items = fs.readdirSync(stack.pop()!, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const item of items) {
        count += 1;
        if (count >= limit) return { count, more: true };
        if (item.isDirectory() && !item.isSymbolicLink()) stack.push(nodePath.join(item.parentPath, item.name));
      }
    }
    return { count, more: false };
  };

  /** Bir işi "Durdur" ve çağrı iptaliyle kesilebilir yapar: `stopped()` döngüde yoklanır. */
  const stoppable = async <T>(ctx: ToolContext, work: (stopped: () => boolean) => Promise<T>): Promise<T> => {
    let halted = false;
    const off = env.gate.onStop(() => {
      halted = true;
    });
    try {
      return await work(() => halted || ctx.signal.aborted);
    } finally {
      off();
    }
  };

  // ───────────── kopyalama ─────────────

  class Stopped extends Error {}

  /** Kopyalanacak ağacın boyu: bağlar ve engelli dosyalar sayılmaz (kopyalanmayacaklar). */
  const measureTree = async (folder: string, stopped: () => boolean): Promise<{ items: number; bytes: number; over: boolean }> => {
    const config = env.access();
    let items = 0;
    let bytes = 0;
    const stack = [folder];
    while (stack.length) {
      if (stopped()) throw new Stopped();
      const dir = stack.pop()!;
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = nodePath.join(dir, entry.name);
        if (entry.isSymbolicLink() || blockedReason(full, config)) continue;
        items += 1;
        if (entry.isDirectory()) stack.push(full);
        else bytes += (await fs.promises.stat(full)).size;
        if (items > FILE_LIMITS.copyItems || bytes > FILE_LIMITS.copyBytes) return { items, bytes, over: true };
      }
    }
    return { items, bytes, over: false };
  };

  const copyTree = async (from: string, to: string, stopped: () => boolean): Promise<{ copied: number; skipped: number }> => {
    const config = env.access();
    let copied = 0;
    let skipped = 0;
    const walk = async (source: string, target: string): Promise<void> => {
      await fs.promises.mkdir(target);
      for (const entry of await fs.promises.readdir(source, { withFileTypes: true })) {
        if (stopped()) throw new Stopped();
        const src = nodePath.join(source, entry.name);
        const dst = nodePath.join(target, entry.name);
        // Bağ izlenmez (kopya izinli klasörün dışındaki içeriği içeri taşımasın); parola/anahtar dosyası kopyalanmaz.
        if (entry.isSymbolicLink() || blockedReason(src, config) || blockedReason(dst, config)) {
          skipped += 1;
          continue;
        }
        if (entry.isDirectory()) await walk(src, dst);
        else if (entry.isFile()) await fs.promises.copyFile(src, dst, fs.constants.COPYFILE_EXCL);
        else {
          skipped += 1;
          continue;
        }
        copied += 1;
      }
    };
    await walk(from, to);
    return { copied, skipped };
  };

  /** Kaynak + hedef klasör + ad → hedef yol; ortak denetimler (kopyala ve taşı). */
  const planTarget = (
    source: Extract<Located, { ok: true }>,
    input: { to?: string | undefined; new_name?: string | undefined },
  ): { ok: true; path: string; inside: boolean; caseOnly: boolean } | { ok: false; result: ToolResult } => {
    const p = lib(platform());
    const newName = input.new_name?.trim();
    if (newName !== undefined && newName !== '' && !validName(newName)) return { ok: false, result: fail(t('pc.files.badName', { name: newName }), { reason: 'bad_name' }) };
    let folder = p.dirname(source.path);
    if (input.to?.trim()) {
      const destination = locate(input.to);
      if (!destination.ok) {
        // Hedef klasör yoksa neyin eksik olduğu ve çözümü söylenir.
        return destination.result.data && (destination.result.data as { reason?: string }).reason === 'missing'
          ? { ok: false, result: fail(t('pc.files.destMissing', { path: env.expand(input.to) }), { reason: 'dest_missing' }) }
          : destination;
      }
      if (!destination.dir) return { ok: false, result: fail(t('pc.files.notFolder', { path: destination.path }), { reason: 'not_folder' }) };
      folder = destination.path;
    }
    const name = newName || p.basename(source.path);
    const target = p.join(folder, name);
    const text = checkPathText(target, platform());
    if (!text.ok) return { ok: false, result: fail(t('pc.files.badPath', { reason: text.reason }), { reason: 'bad_path' }) };
    const block = blockedReason(target, env.access());
    if (block) return { ok: false, result: fail(t('pc.files.blocked', { reason: block }), { reason: 'blocked' }) };
    const targetExtension = extensionOf(name);
    if (!source.dir && EXECUTABLE_EXTENSIONS.has(targetExtension) && targetExtension !== extensionOf(source.path)) {
      return { ok: false, result: fail(t('pc.files.execRename', { ext: `.${targetExtension}` }), { reason: 'executable' }) };
    }
    const sameSpot = same(target, source.path);
    const caseOnly = sameSpot && p.basename(target) !== p.basename(source.path);
    if (sameSpot && !caseOnly) return { ok: false, result: fail(t('pc.files.samePlace', { path: source.path }), { reason: 'same_place' }) };
    if (source.dir && !sameSpot && isInside(target, source.path, platform())) return { ok: false, result: fail(t('pc.files.intoItself'), { reason: 'into_itself' }) };
    if (!caseOnly && exists(target)) {
      let kind = 'file';
      try {
        kind = fs.statSync(target).isDirectory() ? 'folder' : 'file';
      } catch {
        // kırık bağ: dosya say
      }
      return { ok: false, result: fail(t('pc.files.exists', { kind: t(`pc.files.kind.${kind}`), path: target }), { reason: 'exists', path: target }) };
    }
    return { ok: true, path: target, inside: insideRoots(target, env.access()), caseOnly };
  };

  const PATH_PARAM = 'Tam yol ya da "Masaüstü\\rapor.pdf", "Belgeler\\Vergi", "İndirilenler\\x.zip"';

  // ───────────── okuma: file_find ─────────────

  const fileFind = defineTool({
    name: 'file_find',
    group: 'files',
    description:
      'Bilgisayarda bir dosyayı ya da klasörü ADINA göre arar (alt klasörler dahil): "geçen ayki fatura nerede", "sözleşme dosyasını bul". ' +
      'name: adında geçen sözcükler (hepsi geçmeli; büyük/küçük ve Türkçe harf duyarsız). folder verilmezse izinli klasörlerin (Belgeler, Masaüstü, İndirilenler ve eklenenler) hepsinde arar. ' +
      'Bir klasörün içindekileri sıralamak için file_list, belgelerin İÇERİĞİNDE aramak için document_search kullan. Sistem ve uygulama verisi klasörlerinde aramaz.',
    input: z.object({
      name: z.string().max(200).optional().describe('Dosya ya da klasör adında geçen sözcükler: "fatura kasım"'),
      folder: z.string().optional().describe(`Aranacak klasör. ${PATH_PARAM}. Boşsa izinli klasörlerin hepsi`),
      extension: z.string().max(20).optional().describe('Yalnız bu uzantı: "pdf", "xlsx"'),
      kind: z.enum(['any', 'file', 'folder']).optional().describe('Yalnız dosya ya da yalnız klasör (varsayılan: ikisi de)'),
      max_results: z.number().int().min(1).max(FILE_LIMITS.findResultsMax).optional().describe(`En çok sonuç (varsayılan ${FILE_LIMITS.findResults})`),
    }),
    risk: 'read',
    async run(input, ctx) {
      const blocked = env.gate.blocked(ctx);
      if (blocked) return blocked;
      const terms = searchTerms(input.name ?? '');
      const extension = (input.extension ?? '').trim().replace(/^\./, '').toLowerCase();
      if (terms.length === 0 && !extension) return fail(t('pc.files.find.noTerms'), { reason: 'bad_input' });
      const config = env.access();
      let roots: string[];
      let where: string;
      if (input.folder?.trim()) {
        const folder = locate(input.folder);
        if (!folder.ok) return folder.result;
        if (!folder.dir) return fail(t('pc.files.notFolder', { path: folder.path }), { reason: 'not_folder' });
        if (!folder.inside) {
          const denied = await approve(ctx, 'file_find', t('pc.files.approve.find', { path: folder.path }), { folder: folder.path });
          if (denied) return denied;
        }
        roots = [folder.path];
        where = folder.path;
      } else {
        roots = [...new Set(config.readRoots().map(realOrSelf))].filter((root) => {
          try {
            return fs.statSync(root).isDirectory() && !blockedReason(root, config);
          } catch {
            return false;
          }
        });
        if (roots.length === 0) return fail(t('pc.files.find.noRoots'), { reason: 'no_roots' });
        where = t('pc.files.find.allRoots');
      }
      const limit = input.max_results ?? FILE_LIMITS.findResults;
      const kind = input.kind ?? 'any';
      const label = input.name?.trim() || `.${extension}`;

      return env.gate.busy('files', null, () =>
        stoppable(ctx, async (stopped) => {
          const found: Array<{ path: string; dir: boolean; bytes: number; modified: number }> = [];
          const started = Date.now();
          let scanned = 0;
          let more: 'limit' | 'budget' | 'stopped' | null = null;
          // Genişlik öncelikli: yakın (sığ) eşleşmeler önce gelir.
          let level = roots.map((root) => ({ dir: root, depth: 0 }));
          const seen = new Set<string>();
          scan: while (level.length) {
            const next: typeof level = [];
            for (const { dir, depth } of level) {
              if (stopped()) {
                more = 'stopped';
                break scan;
              }
              if (scanned >= FILE_LIMITS.findScan || Date.now() - started > FILE_LIMITS.findMs) {
                more = 'budget';
                break scan;
              }
              const key = dir.toLowerCase();
              if (seen.has(key)) continue;
              seen.add(key);
              let entries: fs.Dirent[];
              try {
                entries = await fs.promises.readdir(dir, { withFileTypes: true });
              } catch {
                continue;
              }
              for (const entry of entries) {
                scanned += 1;
                if (entry.name.startsWith('.') || entry.name.startsWith('~$') || entry.name === 'node_modules') continue;
                if (entry.isSymbolicLink()) continue;
                const full = nodePath.join(dir, entry.name);
                if (blockedReason(full, config)) continue;
                const isDir = entry.isDirectory();
                if (isDir && depth < FILE_LIMITS.findDepth) next.push({ dir: full, depth: depth + 1 });
                if ((kind === 'file' && isDir) || (kind === 'folder' && !isDir)) continue;
                if (extension && (isDir || extensionOf(entry.name) !== extension)) continue;
                const folded = foldForSearch(entry.name);
                if (!terms.every((term) => folded.includes(term))) continue;
                if (found.length >= limit) {
                  more = 'limit';
                  break scan;
                }
                let bytes = 0;
                let modified = 0;
                try {
                  const stat = await fs.promises.stat(full);
                  bytes = stat.size;
                  modified = stat.mtimeMs;
                } catch {
                  // okunamadı: yine de listelenir
                }
                found.push({ path: full, dir: isDir, bytes, modified });
              }
            }
            level = next;
          }
          if (found.length === 0) {
            const text = t('pc.files.find.none', { name: label, where, scanned });
            return { ok: true, text: more ? `${text}\n${t('pc.files.find.more', { reason: t(`pc.files.find.more.${more}`) })}` : text, data: { count: 0, results: [], more: more !== null } };
          }
          found.sort((a, b) => b.modified - a.modified);
          const lines = found.map((item) =>
            item.dir
              ? `${t('pc.files.find.folderTag')} ${item.path}`
              : `${item.path} · ${sizeLabel(item.bytes)}${item.modified ? ` · ${new Date(item.modified).toLocaleDateString('tr-TR')}` : ''}`,
          );
          let text = `${t('pc.files.find.header', { name: label, count: found.length, where })}\n${lines.join('\n')}`;
          if (more) text += `\n${t('pc.files.find.more', { reason: t(`pc.files.find.more.${more}`) })}`;
          return { ok: true, text, data: { count: found.length, results: found.map((item) => ({ path: item.path, folder: item.dir })), more: more !== null } };
        }),
      );
    },
  });

  // ───────────── kullanma: kopyala, taşı, klasör oluştur, sil, aç, göster ─────────────

  const fileCopy = defineTool({
    name: 'file_copy',
    group: 'files',
    description:
      'Bir dosyayı ya da klasörü KOPYALAR (kaynak yerinde kalır). to: hedef KLASÖR (var olmalı; yoksa önce folder_create); new_name: kopyanın adı. ' +
      'Aynı klasöre kopyalamak için yalnız new_name ver. Hedefte aynı ad varsa üzerine yazmaz, hata döner. Çok büyük klasörleri kopyalamaz. ' +
      'Taşımak ya da ad değiştirmek için file_move kullan. İzinli klasörlerin dışına dokunursa kullanıcıdan onay ister.',
    input: z.object({
      from: z.string().min(1).describe(`Kopyalanacak dosya ya da klasör. ${PATH_PARAM}`),
      to: z.string().optional().describe('Hedef klasör: "Masaüstü", "Belgeler\\Yedek" ya da tam yol. Boşsa kaynağın klasörü'),
      new_name: z.string().max(200).optional().describe('Kopyanın adı (uzantısıyla): "rapor-yedek.pdf"'),
    }),
    risk: 'write',
    async run(input, ctx) {
      const blocked = env.gate.blocked(ctx);
      if (blocked) return blocked;
      const source = locate(input.from);
      if (!source.ok) return source.result;
      if (source.link) return fail(t('pc.files.link', { path: source.path }), { reason: 'link' });
      if (!input.to?.trim() && !input.new_name?.trim()) return fail(t('pc.files.needTarget'), { reason: 'bad_input' });
      const target = planTarget(source, input);
      if (!target.ok) return target.result;
      if (target.caseOnly) return fail(t('pc.files.samePlace', { path: source.path }), { reason: 'same_place' });
      if (!source.inside || !target.inside) {
        const denied = await approve(ctx, 'file_copy', t('pc.files.approve.copy', { from: source.path, to: target.path }), { from: source.path, to: target.path });
        if (denied) return denied;
      }
      return env.gate.busy('files', nodePath.basename(source.path), () =>
        stoppable(ctx, async (stopped) => {
          try {
            if (!source.dir) {
              const size = (await fs.promises.stat(source.path)).size;
              if (size > FILE_LIMITS.copyBytes) {
                return fail(t('pc.files.copy.tooBig', { detail: sizeLabel(size), maxItems: FILE_LIMITS.copyItems, maxSize: sizeLabel(FILE_LIMITS.copyBytes) }), { reason: 'too_big' });
              }
              await fs.promises.copyFile(source.path, target.path, fs.constants.COPYFILE_EXCL);
              return { ok: true, text: t('pc.files.copy.doneFile', { from: source.path, to: target.path, size: sizeLabel(size) }), data: { path: target.path, from: source.path, count: 1, bytes: size } };
            }
            const measured = await measureTree(source.path, stopped);
            if (measured.over) {
              const detail = measured.items > FILE_LIMITS.copyItems ? `${FILE_LIMITS.copyItems}+ öğe` : sizeLabel(measured.bytes);
              return fail(t('pc.files.copy.tooBig', { detail, maxItems: FILE_LIMITS.copyItems, maxSize: sizeLabel(FILE_LIMITS.copyBytes) }), { reason: 'too_big' });
            }
            const outcome = await copyTree(source.path, target.path, stopped);
            let text = t('pc.files.copy.doneFolder', { from: source.path, to: target.path, count: outcome.copied, size: sizeLabel(measured.bytes) });
            if (outcome.skipped) text += t('pc.files.copy.skipped', { count: outcome.skipped });
            return { ok: true, text, data: { path: target.path, from: source.path, count: outcome.copied, skipped: outcome.skipped, bytes: measured.bytes } };
          } catch (error) {
            if ((error as NodeJS.ErrnoException | null)?.code === 'EEXIST') {
              return fail(t('pc.files.exists', { kind: t(`pc.files.kind.${source.dir ? 'folder' : 'file'}`), path: target.path }), { reason: 'exists', path: target.path });
            }
            // Yarım kopya bırakılmaz: hedefi biz oluşturduk (önceden yoktu), geri alınır.
            let cleaned = true;
            if (source.dir && exists(target.path)) {
              try {
                await fs.promises.rm(target.path, { recursive: true, force: true });
              } catch {
                cleaned = false;
              }
            }
            if (error instanceof Stopped) return fail(t(cleaned ? 'pc.files.copy.stopped' : 'pc.files.copy.stoppedPartial', { to: target.path }), { reason: 'aborted' });
            return fail(t('pc.files.failed', { error: errorText(error) }), { reason: 'failed' });
          }
        }),
      );
    },
  });

  const fileMove = defineTool({
    name: 'file_move',
    group: 'files',
    description:
      'Bir dosyayı ya da klasörü TAŞIR ya da YENİDEN ADLANDIRIR. to: hedef KLASÖR (var olmalı); new_name: yeni ad. Yalnız ad değiştirmek için yalnız new_name ver; ' +
      'ikisi birlikte verilirse taşır ve adını değiştirir. Hedefte aynı ad varsa üzerine yazmaz, hata döner. ' +
      'Kopyasını çıkarmak için file_copy, silmek için file_delete kullan. İzinli klasörlerin dışına dokunursa kullanıcıdan onay ister.',
    input: z.object({
      from: z.string().min(1).describe(`Taşınacak ya da adı değişecek dosya/klasör. ${PATH_PARAM}`),
      to: z.string().optional().describe('Hedef klasör: "Masaüstü", "Belgeler\\Arşiv" ya da tam yol. Boşsa yerinde kalır (yalnız ad değişir)'),
      new_name: z.string().max(200).optional().describe('Yeni ad (uzantısıyla): "sozlesme-2026.pdf"'),
    }),
    risk: 'write',
    async run(input, ctx) {
      const blocked = env.gate.blocked(ctx);
      if (blocked) return blocked;
      const source = locate(input.from);
      if (!source.ok) return source.result;
      if (source.link) return fail(t('pc.files.link', { path: source.path }), { reason: 'link' });
      if (isProtected(source.path, source.dir)) return fail(t('pc.files.protected', { path: source.path }), { reason: 'protected' });
      if (!input.to?.trim() && !input.new_name?.trim()) return fail(t('pc.files.needTarget'), { reason: 'bad_input' });
      const target = planTarget(source, input);
      if (!target.ok) return target.result;
      const rename = !input.to?.trim() || same(nodePath.dirname(target.path), nodePath.dirname(source.path));
      if (!source.inside || !target.inside) {
        const summary = rename
          ? t('pc.files.approve.rename', { from: source.path, name: nodePath.basename(target.path) })
          : t('pc.files.approve.move', { from: source.path, to: target.path });
        const denied = await approve(ctx, 'file_move', summary, { from: source.path, to: target.path });
        if (denied) return denied;
      }
      return env.gate.busy('files', nodePath.basename(source.path), async () => {
        try {
          // `rename` Windows'ta var olan dosyanın üzerine yazar: onay beklenirken hedef oluşmuş olabilir, yeniden bakılır.
          if (!target.caseOnly && exists(target.path)) {
            return fail(t('pc.files.exists', { kind: t(`pc.files.kind.${source.dir ? 'folder' : 'file'}`), path: target.path }), { reason: 'exists', path: target.path });
          }
          try {
            await fs.promises.rename(source.path, target.path);
          } catch (error) {
            if ((error as NodeJS.ErrnoException | null)?.code !== 'EXDEV') throw error;
            // Başka sürücü: dosya kopyalanır, kopya doğrulanınca kaynak kaldırılır. Klasör için bu yol kullanılmaz.
            if (source.dir) return fail(t('pc.files.move.crossDrive'), { reason: 'cross_drive' });
            await fs.promises.copyFile(source.path, target.path, fs.constants.COPYFILE_EXCL);
            const [before, after] = await Promise.all([fs.promises.stat(source.path), fs.promises.stat(target.path)]);
            if (before.size !== after.size) {
              await fs.promises.rm(target.path, { force: true });
              return fail(t('pc.files.failed', { error: 'kopya doğrulanamadı; dosya yerinde duruyor' }), { reason: 'failed' });
            }
            await fs.promises.unlink(source.path);
          }
          return {
            ok: true,
            text: t(rename ? 'pc.files.move.renamed' : 'pc.files.move.done', { from: source.path, to: target.path }),
            data: { path: target.path, from: source.path, renamed: rename },
          };
        } catch (error) {
          return fail(t('pc.files.failed', { error: errorText(error) }), { reason: 'failed' });
        }
      });
    },
  });

  const folderCreate = defineTool({
    name: 'folder_create',
    group: 'files',
    description:
      'Yeni bir KLASÖR oluşturur: "Masaüstü\\Proje X", "Belgeler\\Vergi\\2026" ya da tam yol. Aradaki eksik klasörleri de oluşturur. Klasör zaten varsa dokunmaz ve bunu söyler. ' +
      'Dosya (belge) oluşturmak için document_create kullan. İzinli klasörlerin dışında ise kullanıcıdan onay ister.',
    input: z.object({ path: z.string().min(1).describe(`Oluşturulacak klasör. ${PATH_PARAM}`) }),
    risk: 'write',
    async run(input, ctx) {
      const blocked = env.gate.blocked(ctx);
      if (blocked) return blocked;
      const config = env.access();
      const text = checkPathText(env.expand(input.path), config.platform);
      if (!text.ok) return fail(t('pc.files.badPath', { reason: text.reason }), { reason: 'bad_path' });
      const target = locateNew(text.path);
      if (!target.ok) return target.result;
      if (target.missingLevels === 0) {
        let dir = false;
        try {
          dir = fs.statSync(target.path).isDirectory();
        } catch {
          // kırık bağ
        }
        return dir
          ? { ok: true, text: t('pc.files.mkdir.existed', { path: target.path }), data: { path: target.path, created: false } }
          : fail(t('pc.files.mkdir.isFile', { path: target.path }), { reason: 'exists', path: target.path });
      }
      if (target.missingLevels > FILE_LIMITS.mkdirLevels) return fail(t('pc.files.destMissing', { path: nodePath.dirname(target.path) }), { reason: 'dest_missing' });
      const p = lib(config.platform);
      if (!target.path.split(/[\\/]/).slice(-target.missingLevels).every((part) => validName(part))) {
        return fail(t('pc.files.badName', { name: p.basename(target.path) }), { reason: 'bad_name' });
      }
      if (!target.inside) {
        const denied = await approve(ctx, 'folder_create', t('pc.files.approve.mkdir', { path: target.path }), { path: target.path });
        if (denied) return denied;
      }
      return env.gate.busy('files', p.basename(target.path), async () => {
        try {
          await fs.promises.mkdir(target.path, { recursive: true });
          return { ok: true, text: t('pc.files.mkdir.done', { path: target.path }), data: { path: target.path, created: true } };
        } catch (error) {
          return fail(t('pc.files.failed', { error: errorText(error) }), { reason: 'failed' });
        }
      });
    },
  });

  const fileDelete = defineTool({
    name: 'file_delete',
    group: 'files',
    description:
      'Bir dosyayı ya da klasörü GERİ DÖNÜŞÜM KUTUSU’na gönderir (kalıcı silmez; kullanıcı geri alabilir). HER SEFERİNDE kullanıcının onayı gerekir. ' +
      'Yalnız kullanıcı silmeyi açıkça istediyse kullan; yolu bilmiyorsan önce file_find. Sistem klasörleri, uygulama verisi, izinli klasörün kendisi ve kullanıcı klasörü silinemez. ' +
      'Geri Dönüşüm Kutusu’nu boşaltmaz, kalıcı silme yapmaz.',
    input: z.object({ path: z.string().min(1).describe(`Silinecek dosya ya da klasör. ${PATH_PARAM}`) }),
    risk: 'danger',
    approvalText(input) {
      // Onay kartı tam (gerçek) yolu ve klasörse içindeki öğe sayısını gösterir; yol çözülemezse yazılan yol gösterilir.
      try {
        const located = locate(input.path);
        if (!located.ok) return t('pc.files.approve.deleteUnknown', { path: env.expand(input.path) });
        if (!located.dir || located.link) return t('pc.files.approve.deleteFile', { path: located.path });
        const { count, more } = countItems(located.path, FILE_LIMITS.deleteCount);
        return t(more ? 'pc.files.approve.deleteFolderMany' : 'pc.files.approve.deleteFolder', { path: located.path, count });
      } catch {
        return t('pc.files.approve.deleteUnknown', { path: input.path });
      }
    },
    async run(input, ctx) {
      const blocked = env.gate.blocked(ctx);
      if (blocked) return blocked;
      const target = locate(input.path);
      if (!target.ok) return target.result;
      if (target.link) return fail(t('pc.files.link', { path: target.path }), { reason: 'link' });
      if (isProtected(target.path, target.dir)) return fail(t('pc.files.protected', { path: target.path }), { reason: 'protected' });
      return env.gate.busy('files', nodePath.basename(target.path), async () => {
        const count = target.dir ? countItems(target.path, FILE_LIMITS.deleteCount).count : 0;
        try {
          await env.trash(target.path);
        } catch (error) {
          return fail(t('pc.files.delete.failed', { error: errorText(error) }), { reason: 'failed' });
        }
        // Çöp kutusu "tamam" dese de öğe yerindeyse model "sildim" diyemesin.
        if (exists(target.path)) return fail(t('pc.files.delete.stillThere', { path: target.path }), { reason: 'no_effect' });
        return {
          ok: true,
          text: target.dir ? t('pc.files.delete.doneFolder', { path: target.path, count }) : t('pc.files.delete.done', { path: target.path }),
          data: { path: target.path, folder: target.dir, count: target.dir ? count : 1, recycleBin: true },
        };
      });
    },
  });

  const fileOpen = defineTool({
    name: 'file_open',
    group: 'files',
    description:
      'Bir dosyayı varsayılan uygulamasında ya da bir klasörü Gezgin’de AÇAR: "raporu aç", "İndirilenler klasörünü aç". Belgeyi OKUMAK için değil (onun için document_read), ' +
      'kullanıcının ekranında açmak içindir. Çalıştırılabilir ve betik dosyalarını (exe, bat, ps1, lnk…) açmaz; uygulama açmak için app_open kullan. ' +
      'İzinli klasörlerin dışındaki dosya için kullanıcıdan onay ister.',
    input: z.object({ path: z.string().min(1).describe(`Açılacak dosya ya da klasör. ${PATH_PARAM}`) }),
    risk: 'write',
    async run(input, ctx) {
      const blocked = env.gate.blocked(ctx);
      if (blocked) return blocked;
      const target = locate(input.path);
      if (!target.ok) return target.result;
      const extension = extensionOf(target.path);
      if (!target.dir && EXECUTABLE_EXTENSIONS.has(extension)) return fail(t('pc.files.open.executable', { ext: `.${extension}` }), { reason: 'executable' });
      if (!target.inside) {
        const denied = await approve(ctx, 'file_open', t('pc.files.approve.open', { path: target.path }), { path: target.path });
        if (denied) return denied;
      }
      return env.gate.busy('files', nodePath.basename(target.path), async () => {
        let error: string;
        try {
          error = await env.openPath(target.path);
        } catch (cause) {
          error = errorText(cause) || 'bilinmeyen hata';
        }
        if (error) return fail(t('pc.files.open.failed', { error, path: target.path }), { reason: 'failed' });
        return { ok: true, text: t(target.dir ? 'pc.files.open.doneFolder' : 'pc.files.open.done', { path: target.path }), data: { path: target.path, folder: target.dir } };
      });
    },
  });

  const fileReveal = defineTool({
    name: 'file_reveal',
    group: 'files',
    description:
      'Bir dosyayı ya da klasörü Windows Gezgini’nde, bulunduğu klasörde SEÇİLİ olarak gösterir: "dosyanın yerini göster", "klasöründe göster". Dosyanın kendisini açmaz (onun için file_open). ' +
      'Büyük kopyalama/taşıma gibi kullanıcının elle yapacağı işlerde yeri göstermek için de kullanılır.',
    input: z.object({ path: z.string().min(1).describe(`Gösterilecek dosya ya da klasör. ${PATH_PARAM}`) }),
    risk: 'write',
    async run(input, ctx) {
      const blocked = env.gate.blocked(ctx);
      if (blocked) return blocked;
      const target = locate(input.path);
      if (!target.ok) return target.result;
      return env.gate.busy('files', nodePath.basename(target.path), async () => {
        try {
          env.reveal(target.path);
        } catch (error) {
          return fail(t('pc.files.failed', { error: errorText(error) }), { reason: 'failed' });
        }
        return { ok: true, text: t('pc.files.reveal.done', { path: target.path }), data: { path: target.path, folder: target.dir } };
      });
    },
  });

  // ───────────── metin dosyası yazma ve düzenleme: file_write, file_edit ─────────────

  /** PowerShell'in kullanıcı modül/profil klasörleri: buraya bırakılan dosya bir komutla kendiliğinden yüklenebilir (v1 kuralı). */
  const PS_FOLDER = /[\\/](?:windowspowershell|powershell)(?:[\\/]|$)/i;
  const countLines = (text: string): number => (text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0));
  const occurrences = (text: string, part: string): number => {
    let count = 0;
    for (let at = text.indexOf(part); at !== -1; at = text.indexOf(part, at + part.length)) count += 1;
    return count;
  };
  const excerpt = (text: string): string => {
    const line = text.split(/\r?\n/).find((item) => item.trim() !== '') ?? '';
    const flat = line.trim();
    return flat.length > 80 ? `${flat.slice(0, 79)}…` : flat;
  };

  /** Yazılamayacak hedef: çalıştırılabilir/betik uzantısı ya da PowerShell profil klasörü. */
  const writeRefusal = (target: string): ToolResult | null => {
    const extension = extensionOf(target);
    if (EXECUTABLE_EXTENSIONS.has(extension)) return fail(t('pc.files.write.executable', { ext: `.${extension}` }), { reason: 'executable' });
    if (PS_FOLDER.test(target)) return fail(t('pc.files.write.psFolder', { path: target }), { reason: 'blocked' });
    return null;
  };

  /** Birden çok adı olan dosya (sabit bağ): yazmak izinli klasörün dışındaki aynı dosyayı da değiştirirdi; gerçek yol bunu göstermez. */
  const hardLinked = (target: string): boolean => {
    try {
      const stat = fs.statSync(target);
      return stat.isFile() && stat.nlink > 1;
    } catch {
      return false;
    }
  };

  /** Atomik yazım: aynı klasörde yan dosya + taşıma. Yarıda kalırsa asıl dosya eski haliyle kalır. */
  const writeAtomic = async (target: string, data: Buffer): Promise<void> => {
    const temp = nodePath.join(nodePath.dirname(target), `.${nodePath.basename(target)}.${process.pid}-${Date.now().toString(36)}.tmp`);
    try {
      await fs.promises.writeFile(temp, data, { flag: 'wx' });
      await fs.promises.rename(temp, target);
    } catch (error) {
      await fs.promises.rm(temp, { force: true }).catch(() => undefined);
      throw error;
    }
  };

  type TextFile = { ok: true; bom: boolean; text: string; bytes: number } | { ok: false; result: ToolResult };

  /** Metin dosyasını okur: çok büyük, ikili (NUL) ya da UTF-8 olmayan (geri yazınca bozulacak) dosya düzenlenmez. BOM ayrı tutulur. */
  const readText = async (target: string): Promise<TextFile> => {
    let buffer: Buffer;
    try {
      const size = (await fs.promises.stat(target)).size;
      if (size > FILE_LIMITS.editBytes) return { ok: false, result: fail(t('pc.files.edit.tooBig', { size: sizeLabel(size), max: sizeLabel(FILE_LIMITS.editBytes) }), { reason: 'too_big' }) };
      buffer = await fs.promises.readFile(target);
    } catch (error) {
      return { ok: false, result: fail(t('pc.files.failed', { error: errorText(error) }), { reason: 'failed' }) };
    }
    if (buffer.includes(0)) return { ok: false, result: fail(t('pc.files.edit.binary', { path: target }), { reason: 'binary' }) };
    const bom = buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf;
    const body = bom ? buffer.subarray(3) : buffer;
    const text = body.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(body)) return { ok: false, result: fail(t('pc.files.edit.notUtf8', { path: target }), { reason: 'not_utf8' }) };
    return { ok: true, bom, text, bytes: buffer.length };
  };

  const fileWrite = defineTool({
    name: 'file_write',
    group: 'files',
    description:
      'YENİ bir METİN dosyası yazar (not, .txt, .md, .csv, .json, .html…): path tam yol ya da "Masaüstü\\notlar.md", content dosyanın tamamı. UTF-8 yazar. ' +
      'Dosya zaten varsa YAZMAZ; var olanı tamamen değiştirmek için overwrite=true gerekir ve kullanıcıdan HER SEFERİNDE onay ister. Küçük değişiklik için file_edit kullan. ' +
      'Word, Excel, PowerPoint, PDF için document_create; kod projesi işi için Claude Code oturumu (code_session_*) kullan. ' +
      'Çalıştırılabilir ve betik dosyası (.bat, .ps1, .exe, .js…) yazmaz; olmayan klasöre yazmaz (önce folder_create). İzinli klasörlerin dışında onay ister. Parola ve anahtar yazma.',
    input: z.object({
      path: z.string().min(1).describe(`Yazılacak dosya (uzantısıyla). ${PATH_PARAM}`),
      content: z.string().describe('Dosyanın metni (tamamı). Boş dosya için ""'),
      overwrite: z.boolean().optional().describe('Var olan dosyanın içeriğini tamamen değiştir (her seferinde onay ister)'),
    }),
    risk: 'write',
    async run(input, ctx) {
      const blocked = env.gate.blocked(ctx);
      if (blocked) return blocked;
      const config = env.access();
      const p = lib(config.platform);
      // BOM yazılmaz; satır sonları modelin verdiği gibi kalır.
      const content = input.content.startsWith('﻿') ? input.content.slice(1) : input.content;
      if (content.includes('\u0000')) return fail(t('pc.files.write.binary'), { reason: 'binary' });
      const data = Buffer.from(content, 'utf8');
      if (data.length > FILE_LIMITS.writeBytes) return fail(t('pc.files.write.tooBig', { size: sizeLabel(data.length), max: sizeLabel(FILE_LIMITS.writeBytes) }), { reason: 'too_big' });
      const text = checkPathText(env.expand(input.path), config.platform);
      if (!text.ok) return fail(t('pc.files.badPath', { reason: text.reason }), { reason: 'bad_path' });
      if (!validName(p.basename(text.path))) return fail(t('pc.files.badName', { name: p.basename(text.path) }), { reason: 'bad_name' });
      const lexicalRefusal = writeRefusal(text.path);
      if (lexicalRefusal) return lexicalRefusal;
      const target = locateNew(text.path);
      if (!target.ok) return target.result;
      const realRefusal = writeRefusal(target.path);
      if (realRefusal) return realRefusal;
      const name = p.basename(target.path);
      const lines = countLines(content);

      if (target.missingLevels === 0) {
        // Hedef var: klasör, bağ ya da çok adlı dosya değilse ve açıkça istendiyse, onayla üzerine yazılır.
        const existing = locate(input.path);
        if (!existing.ok) return existing.result;
        if (existing.dir) return fail(t('pc.files.write.isFolder', { path: existing.path }), { reason: 'exists', path: existing.path });
        if (existing.link) return fail(t('pc.files.write.link', { path: text.path }), { reason: 'link' });
        if (hardLinked(existing.path)) return fail(t('pc.files.write.hardLink', { path: existing.path }), { reason: 'link' });
        if (input.overwrite !== true) return fail(t('pc.files.write.exists', { path: existing.path }), { reason: 'exists', path: existing.path });
        let oldBytes = 0;
        try {
          oldBytes = fs.statSync(existing.path).size;
        } catch {
          // boyut okunamadı: kartta 0 görünür
        }
        const denied = await approve(
          ctx,
          'file_write',
          t(existing.inside ? 'pc.files.approve.overwrite' : 'pc.files.approve.overwriteOutside', { path: existing.path, oldSize: sizeLabel(oldBytes), newSize: sizeLabel(data.length) }),
          { path: existing.path, overwrite: true, oldBytes, newBytes: data.length },
          'overwrite',
        );
        if (denied) return denied;
        return env.gate.busy('files', name, async () => {
          // Kart beklenirken bağa dönüşmüş ya da silinmiş olabilir.
          const again = locate(input.path);
          if (!again.ok || again.dir || again.link || hardLinked(again.path) || !same(again.path, existing.path)) return fail(t('pc.files.write.changed', { path: existing.path }), { reason: 'changed' });
          try {
            await writeAtomic(existing.path, data);
          } catch (error) {
            return fail(t('pc.files.failed', { error: errorText(error) }), { reason: 'failed' });
          }
          return {
            ok: true,
            text: t('pc.files.write.overwritten', { path: existing.path, lines, size: sizeLabel(data.length), oldSize: sizeLabel(oldBytes) }),
            data: { path: existing.path, created: false, overwritten: true, bytes: data.length, lines },
          };
        });
      }

      // Yeni dosya: üst klasör var olmalı (eksik klasör sessizce oluşturulmaz).
      if (target.missingLevels > 1) return fail(t('pc.files.destMissing', { path: p.dirname(target.path) }), { reason: 'dest_missing' });
      let parentIsDir = false;
      try {
        parentIsDir = fs.statSync(p.dirname(target.path)).isDirectory();
      } catch {
        parentIsDir = false;
      }
      if (!parentIsDir) return fail(t('pc.files.notFolder', { path: p.dirname(target.path) }), { reason: 'not_folder' });
      if (!target.inside) {
        const denied = await approve(ctx, 'file_write', t('pc.files.approve.write', { path: target.path, size: sizeLabel(data.length) }), { path: target.path, bytes: data.length });
        if (denied) return denied;
      }
      return env.gate.busy('files', name, async () => {
        try {
          // `wx`: araya aynı adda bir dosya girdiyse üzerine yazılmaz.
          await fs.promises.writeFile(target.path, data, { flag: 'wx' });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EEXIST') return fail(t('pc.files.write.exists', { path: target.path }), { reason: 'exists', path: target.path });
          return fail(t('pc.files.failed', { error: errorText(error) }), { reason: 'failed' });
        }
        return {
          ok: true,
          text: t('pc.files.write.created', { path: target.path, lines, size: sizeLabel(data.length) }),
          data: { path: target.path, created: true, overwritten: false, bytes: data.length, lines },
        };
      });
    },
  });

  const fileEdit = defineTool({
    name: 'file_edit',
    group: 'files',
    description:
      'Var olan bir METİN dosyasında bir parçayı başka bir metinle değiştirir (dosyanın geri kalanı aynen kalır). old_text dosyada BİREBİR ve TAM BİR KEZ geçmelidir ' +
      '(boşluklar dahil); bulunamazsa ya da birden çok yerde geçiyorsa dosya değişmez: çevresindeki satırları ekleyerek benzersiz yap ya da hepsini değiştirmek için replace_all=true ver. ' +
      'Parçayı silmek için new_text="". Dosyanın satır sonları (CRLF/LF) ve kodlaması korunur. Önce dosyayı oku (document_read). ' +
      'Dosyanın tamamını yeniden yazmak için file_write, Word/Excel/PDF için document_create kullan. Betik/çalıştırılabilir dosyaları, ikili ve çok büyük dosyaları düzenlemez. İzinli klasörlerin dışında onay ister.',
    input: z.object({
      path: z.string().min(1).describe(`Düzenlenecek metin dosyası. ${PATH_PARAM}`),
      old_text: z.string().min(1).describe('Dosyada olduğu gibi geçen, değiştirilecek metin'),
      new_text: z.string().describe('Yerine yazılacak metin ("" = sil)'),
      replace_all: z.boolean().optional().describe('old_text birden çok yerde geçiyorsa hepsini değiştir'),
    }),
    risk: 'write',
    async run(input, ctx) {
      const blocked = env.gate.blocked(ctx);
      if (blocked) return blocked;
      if (input.new_text.includes('\u0000')) return fail(t('pc.files.write.binary'), { reason: 'binary' });
      const lexical = checkPathText(env.expand(input.path), env.access().platform);
      if (lexical.ok) {
        const refusal = writeRefusal(lexical.path);
        if (refusal) return refusal;
      }
      const target = locate(input.path);
      if (!target.ok) return target.result;
      if (target.dir) return fail(t('pc.files.write.isFolder', { path: target.path }), { reason: 'not_file' });
      if (target.link) return fail(t('pc.files.write.link', { path: lexical.ok ? lexical.path : target.path }), { reason: 'link' });
      const refusal = writeRefusal(target.path);
      if (refusal) return refusal;
      if (hardLinked(target.path)) return fail(t('pc.files.write.hardLink', { path: target.path }), { reason: 'link' });
      if (!target.inside) {
        const denied = await approve(ctx, 'file_edit', t('pc.files.approve.edit', { path: target.path }), { path: target.path });
        if (denied) return denied;
      }
      return env.gate.busy('files', nodePath.basename(target.path), async () => {
        const file = await readText(target.path);
        if (!file.ok) return file.result;
        // Satır sonu uyumu: model `\n` verir; dosya CRLF ise arama ve yazma CRLF'e, LF ise LF'e çevrilir.
        const crlf = file.text.includes('\r\n');
        const adapt = (value: string): string => (crlf ? value.replace(/\r?\n/g, '\r\n') : value.replace(/\r\n/g, '\n'));
        let oldText = adapt(input.old_text);
        let newText = adapt(input.new_text);
        let count = occurrences(file.text, oldText);
        // Satır sonları karışık dosya: çevrilmiş hali yoksa verildiği gibi denenir.
        if (count === 0 && oldText !== input.old_text && occurrences(file.text, input.old_text) > 0) {
          oldText = input.old_text;
          newText = input.new_text;
          count = occurrences(file.text, oldText);
        }
        if (oldText === newText) return fail(t('pc.files.edit.same'), { reason: 'no_change' });
        if (count === 0) return fail(t('pc.files.edit.notFound', { path: target.path }), { reason: 'not_found' });
        if (count > 1 && input.replace_all !== true) return fail(t('pc.files.edit.many', { count }), { reason: 'ambiguous', count });
        const first = file.text.indexOf(oldText);
        const line = file.text.slice(0, first).split('\n').length;
        const result = input.replace_all === true ? file.text.split(oldText).join(newText) : file.text.slice(0, first) + newText + file.text.slice(first + oldText.length);
        const body = Buffer.from(result, 'utf8');
        const data = file.bom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]) : body;
        if (data.length > FILE_LIMITS.editBytes) return fail(t('pc.files.edit.tooBig', { size: sizeLabel(data.length), max: sizeLabel(FILE_LIMITS.editBytes) }), { reason: 'too_big' });
        try {
          await writeAtomic(target.path, data);
        } catch (error) {
          return fail(t('pc.files.failed', { error: errorText(error) }), { reason: 'failed' });
        }
        const oldLines = countLines(oldText.replace(/\r\n/g, '\n'));
        const newLines = countLines(newText.replace(/\r\n/g, '\n'));
        const summary =
          t(count > 1 ? 'pc.files.edit.doneMany' : 'pc.files.edit.done', { path: target.path, count, line, oldLines, newLines, size: sizeLabel(data.length) }) +
          t('pc.files.edit.excerpt', { old: excerpt(oldText), new: excerpt(newText) || t('pc.files.edit.deleted') });
        return {
          ok: true,
          text: summary,
          data: { path: target.path, replaced: count, line, oldLines, newLines, bytes: data.length, lineEndings: crlf ? 'crlf' : 'lf', bom: file.bom },
        };
      });
    },
  });

  return { read: [fileFind], control: [fileCopy, fileMove, folderCreate, fileDelete, fileOpen, fileReveal, fileWrite, fileEdit] };
}

/** `Settings.pcReadAllowed` ile sunulan dosya araçları: `file_find`. */
export function fileReadTools(env: FilesEnv): ToolDef[] {
  return fileTools(env).read;
}

/** `Settings.pcControlAllowed` ile sunulan dosya araçları: `file_copy`, `file_move`, `folder_create`, `file_delete`, `file_open`, `file_reveal`, `file_write`, `file_edit`. */
export function fileControlTools(env: FilesEnv): ToolDef[] {
  return fileTools(env).control;
}
