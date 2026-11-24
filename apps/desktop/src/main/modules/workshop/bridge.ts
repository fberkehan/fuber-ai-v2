/**
 * `ctx` yüzeyinin ana süreçteki karşılığı. Yetenek kodu konakta koşar; ağ, depolama, bildirim, sahne ve
 * hatırlatıcı istekleri buraya gelir ve yeteneğin manifestteki izinlerine göre karşılanır ya da reddedilir.
 * Yeteneğe açılan başka hiçbir çekirdek servisi yoktur.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { JsonValue, ModuleContext, Priority, StageBlock, StageCard } from '@fuber/shared';
import { z } from 'zod';
import type { BridgeCall } from '../../../skill-host/protocol';
import { FORBIDDEN_USED_TOOLS } from './manifest';
import { FetchError, safeFetch, type FetchRequest, type Lookup, type Transport } from './net';
import { PathError, resolveInside } from './paths';
import type { WorkshopStore } from './store';
import type { WorkshopManifest } from './types';

/** `fs.roots` içindeki belirteçlerin bu bilgisayardaki karşılığı. */
export interface UserFolders {
  belgeler: string;
  masaustu: string;
  indirilenler: string;
}

/** Electron dışındaki (sınama) varsayılan: ev dizininin bilinen alt klasörleri. */
export const defaultUserFolders = (): UserFolders => ({
  belgeler: path.join(os.homedir(), 'Documents'),
  masaustu: path.join(os.homedir(), 'Desktop'),
  indirilenler: path.join(os.homedir(), 'Downloads'),
});

/**
 * Eklentinin `ctx.tools.call` ile çağırabileceği, bir şeyi DEĞİŞTİREN araçların tamamı. Bunların dışındaki `write`
 * araçlar (fare/klavye, dosya yazma, uygulama ve adres açma, ayar, ses denetimi, Claude Code oturumu, takip başlatma…)
 * manifestte bildirilse ve kullanıcı onaylasa bile eklentiye açılmaz. Okuyan (`read`) araçlar bildirilmek koşuluyla açıktır.
 */
export const PLUGIN_WRITE_TOOLS: ReadonlySet<string> = new Set(['reminder_create', 'todo_add', 'todo_add_many', 'memory_save']);

export const FILE_LIMITS = { maxReadBytes: 1_000_000, maxWriteBytes: 1_000_000, maxEntries: 500 } as const;

export interface BridgeDeps {
  ctx: ModuleContext;
  store: WorkshopStore;
  /** İsteği yapan yeteneğin manifesti: etkin yetenek ya da sınanmakta olan taslak. Bilinmiyorsa `null`. */
  manifestOf(skillId: string, mode: BridgeCall['mode']): WorkshopManifest | null;
  /** Sınamada DNS çözümü. */
  lookup?: Lookup;
  /** Sınamada gerçek ağ yerine sahte taşıyıcı. */
  transport?: Transport;
  /** `fs.roots` belirteçlerinin gerçek klasörleri; verilmezse ev dizininin alt klasörleri. */
  userFolders?: UserFolders;
}

/** Öz-sınama (onaydan önce) ağa çıkamaz: kullanıcı adresleri henüz onaylamadı. */
export const SELFTEST_NET_CLOSED =
  'öz-sınama sırasında ağ kapalı; ağ gerektiren davranışı sahte veriyle sına (selftest içinde mockFetch ile örnek yanıt ver)';

/** Bir yeteneğin dakikada gönderebileceği bildirim ve kurabileceği hatırlatıcı. */
const NOTIFY_PER_MINUTE = 6;
/** Bir eklentinin dakikada yapabileceği sesli duyuru ve Jarvis aracı çağrısı. */
const SPEAK_PER_MINUTE = 3;
const TOOL_CALLS_PER_MINUTE = 30;
const MAX_TOOL_RESULT_CHARS = 8000;
const MAX_CARD_BLOCKS = 20;
const MAX_TEXT = 4000;

const text = (value: unknown, max = MAX_TEXT): string => String(value ?? '').slice(0, max);

function object(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${what} bir nesne olmalı.`);
  return value as Record<string, unknown>;
}

/** Yetenekten gelen kartı sözleşmedeki `StageCard`'a indirger; dosya yolu taşıyabilen ve eylem bağlayan alanlar alınmaz. */
export function sanitizeCard(input: unknown, skillName: string): StageCard {
  const raw = object(input, 'Kart');
  const title = text(raw.title, 120).trim();
  if (!title) throw new Error('Kartın başlığı (title) gerekli.');
  const blocks = Array.isArray(raw.body) ? raw.body.slice(0, MAX_CARD_BLOCKS) : [];
  const body: StageBlock[] = [];
  for (const item of blocks) {
    const block = object(item, 'Kart bloğu');
    switch (block.type) {
      case 'text':
        body.push({ type: 'text', text: text(block.text) });
        break;
      case 'keyValue':
        body.push({
          type: 'keyValue',
          rows: (Array.isArray(block.rows) ? block.rows : []).slice(0, 40).map((row) => {
            const pair = object(row, 'Satır');
            return { label: text(pair.label, 120), value: text(pair.value, 400) };
          }),
        });
        break;
      case 'list':
        body.push({
          type: 'list',
          items: (Array.isArray(block.items) ? block.items : []).slice(0, 60).map((entry) => {
            const line = object(entry, 'Madde');
            return {
              title: text(line.title, 300),
              ...(line.detail !== undefined ? { detail: text(line.detail, 600) } : {}),
              ...(typeof line.checked === 'boolean' ? { checked: line.checked } : {}),
            };
          }),
        });
        break;
      case 'table': {
        const columns = (Array.isArray(block.columns) ? block.columns : []).slice(0, 8).map((column) => text(column, 80));
        body.push({
          type: 'table',
          columns,
          rows: (Array.isArray(block.rows) ? block.rows : [])
            .slice(0, 60)
            .map((row) => (Array.isArray(row) ? row : []).slice(0, columns.length).map((cell) => text(cell, 300))),
        });
        break;
      }
      case 'code':
        body.push({ type: 'code', language: text(block.language, 30), code: text(block.code, 8000) });
        break;
      case 'link': {
        const url = text(block.url, 2000);
        if (!/^https?:\/\//i.test(url)) throw new Error('Bağlantı yalnız http ya da https olabilir.');
        body.push({ type: 'link', label: text(block.label, 120), url });
        break;
      }
      default:
        // `image` dosya yolu taşıyabildiği için yeteneklere açık değildir.
        throw new Error(`Desteklenmeyen kart bloğu: ${text(block.type, 30)}. Kullanılabilenler: text, keyValue, list, table, code, link.`);
    }
  }
  if (body.length === 0) throw new Error('Kartın gövdesi (body) en az bir blok içermeli.');
  const ttl = Number(raw.ttlSeconds);
  return {
    title,
    subtitle: raw.subtitle !== undefined ? text(raw.subtitle, 160) : skillName,
    body,
    ...(Number.isFinite(ttl) && ttl >= 5 ? { ttlSeconds: Math.min(3600, Math.floor(ttl)) } : {}),
  };
}

/**
 * Eklentinin verdiği yolu (`{belgeler}/Jarvis/not.txt`) manifestteki köklerden birinin İÇİNDE gerçek yola çevirir.
 * Kökün dışına çıkan, bağlantıdan (symlink/junction) geçen ya da bildirilmemiş bir köke giden yol reddedilir.
 */
export function resolvePluginPath(manifest: WorkshopManifest, folders: UserFolders, given: unknown): { file: string; root: string } {
  const raw = String(given ?? '').replace(/\\/g, '/').replace(/\/+$/, '');
  const root = (manifest.fs?.roots ?? []).find((entry) => raw === entry || raw.startsWith(`${entry}/`));
  if (!root) {
    throw new Error(`Bu yol bildirilen dosya köklerinin dışında. Kullanılabilen kökler: ${(manifest.fs?.roots ?? []).join(', ') || 'yok'}.`);
  }
  const token = /^\{(belgeler|masaustu|indirilenler)\}/.exec(root)?.[1] as keyof UserFolders | undefined;
  if (!token) throw new Error('Dosya kökü tanınmıyor.');
  const rootDir = path.join(folders[token], ...root.split('/').slice(1));
  const relative = raw.slice(root.length).replace(/^\/+/, '');
  if (relative === '') return { file: rootDir, root: rootDir };
  try {
    return { file: resolveInside(rootDir, relative), root: rootDir };
  } catch (error) {
    throw new Error(error instanceof PathError ? error.message : 'Dosya yolu geçersiz.');
  }
}

export function createBridge(deps: BridgeDeps): (call: BridgeCall) => Promise<unknown> {
  const { ctx, store } = deps;
  const folders = deps.userFolders ?? defaultUserFolders();
  const recent = new Map<string, number[]>();
  const validators = new Map<string, z.ZodType>();

  const limit = (bucket: string, perMinute: number, message: string) => {
    const now = Date.now();
    const stamps = (recent.get(bucket) ?? []).filter((at) => now - at < 60_000);
    if (stamps.length >= perMinute) throw new Error(message);
    stamps.push(now);
    recent.set(bucket, stamps);
  };
  const throttle = (skillId: string) => limit(skillId, NOTIFY_PER_MINUTE, 'Çok sık bildirim: dakikada en çok 6 bildirim ya da hatırlatıcı.');

  return async (call) => {
    const manifest = deps.manifestOf(call.skillId, call.mode);
    if (!manifest) throw new Error('Yetenek tanınmıyor.');
    const params = call.params;
    const need = (permission: 'net' | 'notify' | 'fs', what: string) => {
      if (!manifest.permissions.includes(permission)) {
        throw new Error(`${what} için manifestte "${permission}" izni gerekli; bu yetenek o izni bildirmemiş.`);
      }
    };

    switch (call.method) {
      case 'fetch': {
        need('net', 'ctx.fetch');
        // Öz-sınama ve taslak onaydan önce koşar: kod henüz kullanıcıya gösterilmedi, ağa hiç çıkmaz.
        if (call.mode !== 'live') throw new Error(SELFTEST_NET_CLOSED);
        if (!ctx.policy.networkAllowed()) throw new Error('Gizli kipte internet gerektiren işler yapılmıyor.');
        const request = object(params, 'İstek') as unknown as FetchRequest;
        try {
          return await safeFetch(request, {
            hosts: manifest.net?.hosts ?? [],
            ...(deps.lookup ? { lookup: deps.lookup } : {}),
            ...(deps.transport ? { transport: deps.transport } : {}),
          });
        } catch (error) {
          if (error instanceof FetchError) throw error;
          throw new Error(`İstek başarısız: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      case 'storage.get':
        return store.storage.get(call.skillId, text(object(params, 'İstek').key, 200));
      case 'storage.set': {
        const input = object(params, 'İstek');
        store.storage.set(call.skillId, text(input.key, 200), (input.value ?? null) as JsonValue);
        return null;
      }
      case 'storage.delete':
        return { deleted: store.storage.delete(call.skillId, text(object(params, 'İstek').key, 200)) };
      case 'storage.keys':
        return { keys: store.storage.keys(call.skillId) };

      case 'notify': {
        need('notify', 'ctx.notify');
        const input = object(params, 'Bildirim');
        const title = text(input.title, 120).trim();
        if (!title) throw new Error('Bildirimin başlığı (title) gerekli.');
        throttle(call.skillId);
        // Yetenek en çok `normal` öncelik verebilir: adayı ve sesi yalnız çekirdek modüller kullanır.
        const priority: Priority = input.priority === 'low' ? 'low' : 'normal';
        const notification = ctx.attention.notify({
          moduleId: `skill:${call.skillId}`,
          title: `${manifest.name}: ${title}`,
          ...(input.body !== undefined ? { body: text(input.body, 600) } : {}),
          priority,
          speak: false,
        });
        return { ok: true, id: notification.id };
      }

      case 'showCard': {
        const card = sanitizeCard(params, manifest.name);
        const item = ctx.stage.showCard(`skill:${call.skillId}`, card);
        return { ok: true, id: item.id };
      }

      case 'remind': {
        need('notify', 'ctx.remind');
        const input = object(params, 'Hatırlatıcı');
        const reminder = text(input.text, 300).trim();
        if (!reminder) throw new Error('Hatırlatıcının metni (text) gerekli.');
        const after = Number(input.afterSeconds);
        const at = typeof input.at === 'string' ? input.at : undefined;
        if (!at && !(Number.isFinite(after) && after >= 1)) throw new Error('Hatırlatıcı için at (ISO 8601) ya da afterSeconds gerekli.');
        throttle(call.skillId);
        // Hatırlatıcılar Planlar modülünündür; yetenek onun aracını çekirdeğin kapısından geçerek çağırır.
        const result = await ctx.tools.run(
          'reminder_create',
          { text: `${manifest.name}: ${reminder}`, ...(at ? { due_at: at } : { after_seconds: Math.floor(after) }) },
          { origin: { channel: 'skill', speakerVerified: null } },
        );
        return { ok: result.ok, text: result.text };
      }

      case 'speak': {
        if (manifest.speak !== true) throw new Error('ctx.speak için manifestte "speak": true gerekli; bu eklenti sesli duyuru izni bildirmemiş.');
        const spoken = text(object(params, 'Duyuru').text, 400).trim();
        if (!spoken) throw new Error('Duyurunun metni (text) gerekli.');
        limit(`speak:${call.skillId}`, SPEAK_PER_MINUTE, `Çok sık sesli duyuru: dakikada en çok ${SPEAK_PER_MINUTE}.`);
        // Sesli kanalı Dikkat Yöneticisi seçer (sessiz kip, toplantı, yokluk kuralları geçerlidir); eklenti dayatamaz.
        const notification = ctx.attention.notify({
          moduleId: `skill:${call.skillId}`,
          title: manifest.name,
          body: spoken,
          priority: 'high',
          speak: spoken,
        });
        return { ok: true, id: notification.id };
      }

      case 'settings.get': {
        const name = text(object(params, 'İstek').key, 64);
        const declared = (manifest.settings ?? []).find((entry) => entry.key === name);
        if (!declared) return { found: false, value: null };
        const stored = store.settings.get(call.skillId, name);
        return { found: true, value: stored.found ? stored.value : declared.default };
      }

      case 'files.read': {
        need('fs', 'ctx.files');
        const { file } = resolvePluginPath(manifest, folders, object(params, 'İstek').path);
        let stat: fs.Stats;
        try {
          stat = fs.statSync(file);
        } catch {
          throw new Error('dosya yok');
        }
        if (!stat.isFile()) throw new Error('bu bir dosya değil');
        if (stat.size > FILE_LIMITS.maxReadBytes) throw new Error(`dosya çok büyük (en çok ${FILE_LIMITS.maxReadBytes / 1_000_000} MB)`);
        return { text: fs.readFileSync(file, 'utf8') };
      }
      case 'files.write': {
        need('fs', 'ctx.files');
        const input = object(params, 'İstek');
        const { file, root } = resolvePluginPath(manifest, folders, input.path);
        if (file === root) throw new Error('kök klasörün kendisine yazılamaz; bir dosya adı ver');
        const content = String(input.text ?? '');
        if (Buffer.byteLength(content, 'utf8') > FILE_LIMITS.maxWriteBytes) throw new Error(`içerik çok büyük (en çok ${FILE_LIMITS.maxWriteBytes / 1_000_000} MB)`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content, 'utf8');
        return null;
      }
      case 'files.exists': {
        need('fs', 'ctx.files');
        return { exists: fs.existsSync(resolvePluginPath(manifest, folders, object(params, 'İstek').path).file) };
      }
      case 'files.list': {
        need('fs', 'ctx.files');
        const { file } = resolvePluginPath(manifest, folders, object(params, 'İstek').path);
        let entries: fs.Dirent[];
        try {
          entries = fs.readdirSync(file, { withFileTypes: true });
        } catch {
          return { entries: [] };
        }
        return {
          entries: entries
            .filter((entry) => !entry.isSymbolicLink())
            .slice(0, FILE_LIMITS.maxEntries)
            .map((entry) => ({ name: entry.name, dir: entry.isDirectory() })),
        };
      }
      case 'files.remove': {
        need('fs', 'ctx.files');
        const { file, root } = resolvePluginPath(manifest, folders, object(params, 'İstek').path);
        if (file === root) throw new Error('kök klasör silinemez');
        let stat: fs.Stats;
        try {
          stat = fs.lstatSync(file);
        } catch {
          return { removed: false };
        }
        // Yalnız dosya silinir: eklenti bir klasör ağacını tek çağrıda yok edemez.
        if (!stat.isFile()) throw new Error('yalnız dosya silinebilir');
        fs.unlinkSync(file);
        return { removed: true };
      }

      case 'tools.call': {
        const input = object(params, 'İstek');
        const name = text(input.name, 80);
        if (!(manifest.uses?.tools ?? []).includes(name) || FORBIDDEN_USED_TOOLS.test(name)) {
          throw new Error(`"${name}" aracı manifestteki uses.tools içinde bildirilmemiş; eklenti yalnız bildirdiği Jarvis araçlarını çağırabilir.`);
        }
        // Öz-sınama onaydan önce koşar: gerçek araç çağrılmaz (çalışma zamanı da mockTool ister).
        if (call.mode !== 'live') throw new Error('öz-sınama sırasında Jarvis araçları kapalı; mockTool ile örnek sonuç ver');
        const info = ctx.tools.list().find((tool) => tool.name === name);
        if (!info) throw new Error(`"${name}" aracı şu an kullanılamıyor (modülü kapalı olabilir).`);
        // Onay isteyen araç bir eklentinin isteğiyle çalışmaz: onay yalnız kullanıcının kendi isteğine verilir.
        if (info.risk === 'danger') throw new Error(`"${name}" onay isteyen bir araç; eklentiler çağıramaz.`);
        // Bir şeyi değiştiren araçlardan yalnız kısa bir liste açıktır: eklenti Jarvis adına bilgisayarı kullanamaz,
        // dosya yazamaz, uygulama açamaz, ayar değiştiremez, oturum başlatamaz.
        if (info.risk !== 'read' && !PLUGIN_WRITE_TOOLS.has(name)) {
          throw new Error(`"${name}" bir şeyi değiştiren bir araç; eklentiler yalnız okuyan araçları ve şunları çağırabilir: ${[...PLUGIN_WRITE_TOOLS].join(', ')}.`);
        }
        limit(`tools:${call.skillId}`, TOOL_CALLS_PER_MINUTE, `Çok sık araç çağrısı: dakikada en çok ${TOOL_CALLS_PER_MINUTE}.`);
        const result = await ctx.tools.run(name, input.input ?? {}, { origin: { channel: 'skill', speakerVerified: null } });
        return {
          ok: result.ok,
          text: result.text.slice(0, MAX_TOOL_RESULT_CHARS),
          ...(result.data !== undefined ? { data: JSON.parse(JSON.stringify(result.data ?? null)) as JsonValue } : {}),
        };
      }

      case 'validate': {
        const input = object(params, 'İstek');
        const name = text(input.tool, 80);
        const tool = manifest.tools.find((entry) => entry.name === name);
        if (!tool) throw new Error(`Manifestte "${name}" adında araç yok.`);
        const cacheKey = `${call.skillId}:${name}:${JSON.stringify(tool.inputSchema)}`;
        let validator = validators.get(cacheKey);
        if (!validator) {
          validator = z.fromJSONSchema(tool.inputSchema as Parameters<typeof z.fromJSONSchema>[0]);
          if (validators.size > 200) validators.clear();
          validators.set(cacheKey, validator);
        }
        const parsed = validator.safeParse(input.input);
        if (!parsed.success) {
          const detail = parsed.error.issues
            .slice(0, 3)
            .map((issue) => (issue.path.length ? `${issue.path.map(String).join('.')}: ${issue.message}` : issue.message))
            .join('; ');
          throw new Error(`${name}: girdi inputSchema'ya uymuyor (${detail}).`);
        }
        return null;
      }
    }
  };
}
