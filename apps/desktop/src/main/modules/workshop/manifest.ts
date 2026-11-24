/**
 * `skills/<id>/manifest.json` şeması ve doğrulaması. Sözleşmedeki `SkillManifest`'in üst kümesidir:
 * izin ayrıntıları (`net.hosts`, `fs.roots`, `uses.tools`, `speak`), eklenti katkıları (`cards`, `jobs`, `watches`,
 * `pages`, `settings`, `voice`) ve köken (`createdBy`, `createdAt`) eklenir. Tam tarif: `docs/EKLENTI-API.md`.
 * Hata iletileri Türkçedir: hem eklentiyi yazan modele hem "hatalı" durumundaki eklentinin kartında kullanıcıya gösterilir.
 */
import type { JsonObject, Permission, Risk } from '@fuber/shared';
import { z } from 'zod';
import { PAGE_FILE } from './paths';
import {
  PLUGIN_CARD_TEMPLATES,
  PLUGIN_EVENTS,
  type PluginAnnounce,
  type PluginCard,
  type PluginJob,
  type PluginPage,
  type PluginSchedule,
  type PluginSetting,
  type PluginTool,
  type PluginVoice,
  type PluginWatch,
  type WorkshopManifest,
} from './types';

/**
 * Eklentilere açık izinler: `net` = `ctx.fetch` (yalnız `net.hosts`), `notify` = `ctx.notify` ve `ctx.remind`,
 * `fs` = `ctx.files` (yalnız `fs.roots`). Kabuk, ekran, mikrofon YOK. Sesli duyuru (`speak: true`) ve Jarvis
 * araçlarını çağırma (`uses.tools`) ayrı alanlardır; hepsi onay kartında gösterilir.
 */
export const SKILL_PERMISSIONS = ['net', 'notify', 'fs'] as const satisfies readonly Permission[];

export const MANIFEST_LIMITS = {
  maxBytes: 32_000,
  maxTools: 12,
  maxHosts: 10,
  maxSchemaChars: 8_000,
  maxCards: 4,
  maxJobs: 6,
  maxWatches: 4,
  maxPages: 3,
  maxSettings: 12,
  maxVoice: 8,
  maxPhrases: 8,
  maxRoots: 4,
  maxUsedTools: 12,
  /** En sık zamanlanmış iş / takip aralığı (dakika). */
  minEveryMinutes: 1,
  maxEveryMinutes: 7 * 24 * 60,
} as const;

export const SKILL_ID = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
/** Dosya kökü: bilinen bir kullanıcı klasörünün ALTINDA en az bir alt klasör (`{belgeler}/Jarvis`). Klasörün kendisi verilemez. */
export const FS_ROOT = /^\{(belgeler|masaustu|indirilenler)\}(?:\/[^\\/:*?"<>|\0]{1,80}){1,6}$/;
/** Eklentinin `ctx.tools.call` ile HİÇBİR koşulda çağıramayacağı araçlar: kendini geliştirme ve çekirdek güncelleme zinciri. */
export const FORBIDDEN_USED_TOOLS = /^(?:skill_|core_|selfdev_|plugin_)/;
const ITEM_ID = SKILL_ID;
/** En az iki etiketli alan adı; port, IP, köşeli ayraç, joker yok. */
const HOST_ENTRY = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))+$/;
/**
 * URL ayrıştırıcısı son etiketi sayı olan adı IPv4 sayar ("127.1", "0x7f.1", "2130706433", "0177.0.0.1"):
 * böyle bir ad hiçbir biçimde kabul edilmez.
 */
const NUMERIC_LABEL = /^(?:0x[0-9a-f]*|[0-9]+)$/;
/** Yerel ağın adları: genel DNS'te çözülmez, yalnız bu bilgisayarın ya da yerel ağın kendi sunucularına gider. */
const LOCAL_SUFFIXES = ['localhost', 'local', 'internal', 'intranet', 'lan', 'home', 'corp', 'localdomain', 'private', 'arpa'];

const toolSchema = z.object({
  name: z.string(),
  description: z.string().trim().min(10).max(600),
  risk: z.enum(['read', 'write', 'danger']),
  inputSchema: z.record(z.string(), z.unknown()),
  hidden: z.boolean().optional(),
});

const inputObject = z.record(z.string(), z.unknown()).default({});
const announceSchema = z.enum(['speak', 'notify', 'silent']);
const titleSchema = z.string().trim().min(2).max(60);
const scheduleSchema = z.union([
  z.object({ daily: z.string(), days: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional() }).strict(),
  z.object({ everyMinutes: z.number().int() }).strict(),
  z.object({ on: z.string() }).strict(),
]);
const cardSchema = z.object({
  id: z.string(),
  title: titleSchema,
  template: z.enum(PLUGIN_CARD_TEMPLATES).default('metric'),
  tool: z.string(),
  input: inputObject,
  refreshMinutes: z
    .number()
    .int()
    .min(1)
    .max(24 * 60)
    .default(15),
  size: z.enum(['small', 'medium', 'wide']).default('small'),
});
const jobSchema = z.object({
  id: z.string(),
  title: titleSchema,
  tool: z.string(),
  input: inputObject,
  schedule: scheduleSchema,
  announce: announceSchema.default('notify'),
});
const watchSchema = z.object({
  id: z.string(),
  title: titleSchema,
  tool: z.string(),
  input: inputObject,
  everyMinutes: z.number().int(),
  announce: announceSchema.default('notify'),
});
const pageSchema = z.object({
  id: z.string(),
  title: titleSchema,
  icon: z.string().trim().max(24).default('puzzle'),
  file: z.string().default('page.html'),
});
const settingSchema = z.object({
  key: z.string(),
  label: z.string().trim().min(2).max(60),
  description: z.string().trim().max(200).optional(),
  type: z.enum(['text', 'number', 'boolean', 'select']),
  default: z.union([z.string().max(500), z.number(), z.boolean()]),
  options: z.array(z.string().trim().min(1).max(60)).min(2).max(20).optional(),
});
const voiceSchema = z.object({
  phrases: z.array(z.string().trim().min(3).max(80)).min(1).max(MANIFEST_LIMITS.maxPhrases),
  tool: z.string(),
  input: inputObject,
});

const manifestSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().min(10).max(300),
  version: z.number().int().min(1).default(1),
  permissions: z.array(z.string()).max(4).default([]),
  tools: z.array(toolSchema).max(MANIFEST_LIMITS.maxTools).default([]),
  net: z.object({ hosts: z.array(z.string()).min(1).max(MANIFEST_LIMITS.maxHosts) }).optional(),
  fs: z.object({ roots: z.array(z.string()).min(1).max(MANIFEST_LIMITS.maxRoots) }).optional(),
  uses: z.object({ tools: z.array(z.string()).min(1).max(MANIFEST_LIMITS.maxUsedTools) }).optional(),
  speak: z.boolean().optional(),
  cards: z.array(cardSchema).max(MANIFEST_LIMITS.maxCards).optional(),
  jobs: z.array(jobSchema).max(MANIFEST_LIMITS.maxJobs).optional(),
  watches: z.array(watchSchema).max(MANIFEST_LIMITS.maxWatches).optional(),
  pages: z.array(pageSchema).max(MANIFEST_LIMITS.maxPages).optional(),
  settings: z.array(settingSchema).max(MANIFEST_LIMITS.maxSettings).optional(),
  voice: z.array(voiceSchema).max(MANIFEST_LIMITS.maxVoice).optional(),
  createdBy: z.enum(['workshop', 'manual']).default('manual'),
  createdAt: z.string().optional(),
});

export type ManifestResult = { ok: true; manifest: WorkshopManifest } | { ok: false; issues: string[] };

function zodIssues(error: z.ZodError): string[] {
  return error.issues.slice(0, 8).map((issue) => {
    const field = issue.path.map(String).join('.');
    return field ? `manifest.json › ${field}: ${issue.message}` : `manifest.json: ${issue.message}`;
  });
}

/**
 * Yalnız genel bir alan adı: `api.example.com`. Şema, yol, joker, kullanıcı bilgisi, port, IP sabiti (v4/v6,
 * ondalık/onaltılık/sekizlik biçimleri dahil), `localhost` ve yerel ağ adları (`.local`, `.internal`, …) olmaz.
 */
export function normalizeHost(entry: string): string | null {
  const host = entry.trim().toLowerCase().replace(/\.$/, '');
  if (!HOST_ENTRY.test(host) || host.length > 253) return null;
  const labels = host.split('.');
  if (NUMERIC_LABEL.test(labels[labels.length - 1]!)) return null;
  if (LOCAL_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) return null;
  return host;
}

/** Dosya kökünü doğrular ve yalınlaştırır; geçersizse `null`. `..`, `.` ve sonu nokta/boşlukla biten parça kabul edilmez. */
export function normalizeRoot(entry: string): string | null {
  const root = entry.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  if (!FS_ROOT.test(root)) return null;
  const parts = root.split('/').slice(1);
  if (parts.some((part) => part === '.' || part === '..' || /[. ]$/.test(part) || part.trim() !== part)) return null;
  return root;
}

/** Manifestin beyne görünen araçları (gizli işleyiciler hariç). */
export const visibleTools = (manifest: WorkshopManifest): PluginTool[] => manifest.tools.filter((tool) => !tool.hidden);

/**
 * Manifest metnini doğrular. `folderId` verilirse `id` klasör adıyla aynı olmalıdır (eklenti = klasör).
 */
export function parseManifest(text: string, folderId?: string): ManifestResult {
  if (Buffer.byteLength(text, 'utf8') > MANIFEST_LIMITS.maxBytes) {
    return { ok: false, issues: [`manifest.json çok büyük (en çok ${MANIFEST_LIMITS.maxBytes / 1000} KB).`] };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { ok: false, issues: [`manifest.json geçerli JSON değil: ${(error as Error).message}`] };
  }
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, issues: zodIssues(parsed.error) };
  const data = parsed.data;
  const issues: string[] = [];

  if (!SKILL_ID.test(data.id) || data.id.length < 2 || data.id.length > 32) {
    issues.push('manifest.json › id: küçük harf, rakam ve alt çizgiden oluşmalı, harfle başlamalı, 2–32 karakter (ör. "doviz_kuru").');
  }
  if (folderId !== undefined && data.id !== folderId) {
    issues.push(`manifest.json › id ("${data.id}") klasör adıyla ("${folderId}") aynı olmalı.`);
  }

  const permissions: Permission[] = [];
  for (const permission of data.permissions) {
    if (!(SKILL_PERMISSIONS as readonly string[]).includes(permission)) {
      issues.push(`manifest.json › permissions: "${permission}" eklentilere açık değil. Kullanılabilenler: ${SKILL_PERMISSIONS.join(', ')}.`);
    } else if (!permissions.includes(permission as Permission)) {
      permissions.push(permission as Permission);
    }
  }

  const hosts: string[] = [];
  for (const entry of data.net?.hosts ?? []) {
    const host = normalizeHost(entry);
    if (!host) issues.push(`manifest.json › net.hosts: "${entry}" geçersiz. Yalnız genel alan adı yaz (ör. api.ornek.com); https://, yol, *, port, IP adresi, localhost ve yerel ağ adları olmaz.`);
    else if (!hosts.includes(host)) hosts.push(host);
  }
  if (hosts.length > 0 && !permissions.includes('net')) {
    issues.push('manifest.json: net.hosts verilmiş ama permissions içinde "net" yok.');
  }
  if (permissions.includes('net') && hosts.length === 0) {
    issues.push('manifest.json: "net" izni için net.hosts içinde en az bir alan adı gerekli.');
  }

  const roots: string[] = [];
  for (const entry of data.fs?.roots ?? []) {
    const root = normalizeRoot(entry);
    if (!root) {
      issues.push(
        `manifest.json › fs.roots: "${entry}" geçersiz. Biçim: "{belgeler}/AltKlasör", "{masaustu}/AltKlasör" ya da "{indirilenler}/AltKlasör" (klasörün kendisi, mutlak yol, ".." ve sürücü harfi olmaz).`,
      );
    } else if (!roots.includes(root)) roots.push(root);
  }
  if (roots.length > 0 && !permissions.includes('fs')) issues.push('manifest.json: fs.roots verilmiş ama permissions içinde "fs" yok.');
  if (permissions.includes('fs') && roots.length === 0) issues.push('manifest.json: "fs" izni için fs.roots içinde en az bir klasör kökü gerekli.');

  const usedTools: string[] = [];
  for (const name of data.uses?.tools ?? []) {
    if (!/^[a-z][a-z0-9_]{1,63}$/.test(name)) issues.push(`manifest.json › uses.tools: "${name}" bir araç adı değil.`);
    else if (FORBIDDEN_USED_TOOLS.test(name)) {
      issues.push(`manifest.json › uses.tools: "${name}" eklentilere açık değil (kendini geliştirme ve güncelleme araçları çağrılamaz).`);
    } else if (!usedTools.includes(name)) usedTools.push(name);
  }

  const prefix = `skill_${data.id}_`;
  const names = new Set<string>();
  const tools: PluginTool[] = data.tools.map((tool, index) => {
    const where = `manifest.json › tools[${index}]`;
    if (!tool.name.startsWith(prefix) || !/^[a-z0-9_]+$/.test(tool.name.slice(prefix.length)) || tool.name.length > 64) {
      issues.push(`${where}.name: "${prefix}<fiil>" biçiminde olmalı (küçük harf, rakam, alt çizgi; en çok 64 karakter).`);
    }
    if (names.has(tool.name)) issues.push(`${where}.name: "${tool.name}" yineleniyor.`);
    names.add(tool.name);
    const schema = tool.inputSchema;
    if (schema.type !== 'object') {
      issues.push(`${where}.inputSchema: type "object" olmalı (girdi yoksa { "type": "object", "properties": {} }).`);
    } else if (JSON.stringify(schema).length > MANIFEST_LIMITS.maxSchemaChars) {
      issues.push(`${where}.inputSchema çok büyük.`);
    } else {
      try {
        z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0]);
      } catch (error) {
        issues.push(`${where}.inputSchema okunamadı: ${(error as Error).message}`);
      }
    }
    return {
      name: tool.name,
      description: tool.description,
      risk: tool.risk as Risk,
      inputSchema: schema as JsonObject,
      ...(tool.hidden ? { hidden: true } : {}),
    };
  });

  // ── katkılar: her birinin işleyicisi manifestteki bir araçtır ──
  const toolByName = new Map(tools.map((tool) => [tool.name, tool]));
  const checkIds = (section: string, list: Array<{ id: string }>) => {
    const seen = new Set<string>();
    list.forEach((item, index) => {
      if (!ITEM_ID.test(item.id) || item.id.length > 32) {
        issues.push(`manifest.json › ${section}[${index}].id: küçük harf, rakam ve alt çizgi; harfle başlar; en çok 32 karakter.`);
      }
      if (seen.has(item.id)) issues.push(`manifest.json › ${section}[${index}].id: "${item.id}" yineleniyor.`);
      seen.add(item.id);
    });
  };
  /** Katkının aracı manifestte olmalı. `readOnly`: kendiliğinden çalışan kart ve takip yalnız `read` araç çağırır. */
  const handler = (where: string, name: string, readOnly: boolean) => {
    const tool = toolByName.get(name);
    if (!tool) {
      issues.push(`${where}.tool: "${name}" manifestteki tools içinde yok.`);
      return;
    }
    if (tool.risk === 'danger') issues.push(`${where}.tool: "${name}" riski "danger"; kendiliğinden çalışan katkı onay isteyen aracı çağıramaz.`);
    else if (readOnly && tool.risk !== 'read') issues.push(`${where}.tool: "${name}" riski "read" olmalı (kart ve takip yalnız okur).`);
  };
  const needAnnounce = (where: string, value: PluginAnnounce) => {
    if (value === 'speak' && data.speak !== true) issues.push(`${where}.announce: "speak" için manifestte "speak": true gerekli (sesli duyuru izni).`);
    if (value === 'notify' && !permissions.includes('notify')) issues.push(`${where}.announce: "notify" için permissions içinde "notify" gerekli.`);
  };
  const checkEvery = (where: string, value: number) => {
    if (value < MANIFEST_LIMITS.minEveryMinutes || value > MANIFEST_LIMITS.maxEveryMinutes) {
      issues.push(`${where}: ${MANIFEST_LIMITS.minEveryMinutes}–${MANIFEST_LIMITS.maxEveryMinutes} dakika arasında olmalı.`);
    }
  };

  const cards: PluginCard[] = (data.cards ?? []).map((card, index) => {
    handler(`manifest.json › cards[${index}]`, card.tool, true);
    return {
      id: card.id,
      title: card.title,
      template: card.template,
      tool: card.tool,
      input: card.input as JsonObject,
      refreshMinutes: card.refreshMinutes,
      size: card.size,
    };
  });
  checkIds('cards', cards);

  const jobs: PluginJob[] = (data.jobs ?? []).map((job, index) => {
    const where = `manifest.json › jobs[${index}]`;
    handler(where, job.tool, false);
    needAnnounce(where, job.announce);
    let schedule: PluginSchedule;
    if ('daily' in job.schedule) {
      if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(job.schedule.daily)) issues.push(`${where}.schedule.daily: "SS:DD" biçiminde olmalı (ör. "09:00").`);
      schedule = { daily: job.schedule.daily, ...(job.schedule.days ? { days: [...new Set(job.schedule.days)].sort((a, b) => a - b) } : {}) };
    } else if ('everyMinutes' in job.schedule) {
      checkEvery(`${where}.schedule.everyMinutes`, job.schedule.everyMinutes);
      schedule = { everyMinutes: job.schedule.everyMinutes };
    } else {
      if (!(PLUGIN_EVENTS as readonly string[]).includes(job.schedule.on)) {
        issues.push(`${where}.schedule.on: "${job.schedule.on}" bilinmiyor. Kullanılabilen olaylar: ${PLUGIN_EVENTS.join(', ')}.`);
      }
      schedule = { on: job.schedule.on as (typeof PLUGIN_EVENTS)[number] };
    }
    return { id: job.id, title: job.title, tool: job.tool, input: job.input as JsonObject, schedule, announce: job.announce };
  });
  checkIds('jobs', jobs);

  const watches: PluginWatch[] = (data.watches ?? []).map((watch, index) => {
    const where = `manifest.json › watches[${index}]`;
    handler(where, watch.tool, true);
    needAnnounce(where, watch.announce);
    checkEvery(`${where}.everyMinutes`, watch.everyMinutes);
    return { id: watch.id, title: watch.title, tool: watch.tool, input: watch.input as JsonObject, everyMinutes: watch.everyMinutes, announce: watch.announce };
  });
  checkIds('watches', watches);

  const pages: PluginPage[] = (data.pages ?? []).map((page, index) => {
    if (!PAGE_FILE.test(page.file)) issues.push(`manifest.json › pages[${index}].file: "page.html" ya da "page_<ad>.html" olmalı.`);
    return { id: page.id, title: page.title, icon: page.icon || 'puzzle', file: page.file };
  });
  checkIds('pages', pages);
  if (new Set(pages.map((page) => page.file)).size !== pages.length) issues.push('manifest.json › pages: aynı dosya iki sayfada kullanılamaz.');

  const settingKeys = new Set<string>();
  const settings: PluginSetting[] = (data.settings ?? []).map((setting, index) => {
    const where = `manifest.json › settings[${index}]`;
    if (!ITEM_ID.test(setting.key) || setting.key.length > 32) issues.push(`${where}.key: küçük harf, rakam ve alt çizgi; harfle başlar; en çok 32 karakter.`);
    if (settingKeys.has(setting.key)) issues.push(`${where}.key: "${setting.key}" yineleniyor.`);
    settingKeys.add(setting.key);
    const expected = setting.type === 'number' ? 'number' : setting.type === 'boolean' ? 'boolean' : 'string';
    if (typeof setting.default !== expected) issues.push(`${where}.default: türü "${setting.type}" ile uyuşmuyor.`);
    if (setting.type === 'select') {
      if (!setting.options) issues.push(`${where}.options: "select" için seçenek listesi gerekli.`);
      else if (!setting.options.includes(String(setting.default))) issues.push(`${where}.default: seçeneklerden biri olmalı.`);
    } else if (setting.options) {
      issues.push(`${where}.options: yalnız "select" türünde kullanılır.`);
    }
    return {
      key: setting.key,
      label: setting.label,
      ...(setting.description ? { description: setting.description } : {}),
      type: setting.type,
      default: setting.default,
      ...(setting.options ? { options: setting.options } : {}),
    };
  });

  const voice: PluginVoice[] = (data.voice ?? []).map((entry, index) => {
    handler(`manifest.json › voice[${index}]`, entry.tool, false);
    // Sesli kalıp aracı kapıdan kullanıcının kökeniyle geçer: beyne görünen bir araç olmalı.
    if (toolByName.get(entry.tool)?.hidden) issues.push(`manifest.json › voice[${index}].tool: "${entry.tool}" gizli (hidden) olamaz.`);
    return {
      phrases: [...new Set(entry.phrases.map((phrase) => phrase.toLocaleLowerCase('tr-TR')))],
      tool: entry.tool,
      input: entry.input as JsonObject,
    };
  });

  if (tools.length === 0 && pages.length === 0) issues.push('manifest.json: en az bir araç (tools) ya da bir sayfa (pages) gerekli.');

  if (data.createdAt !== undefined && Number.isNaN(Date.parse(data.createdAt))) {
    issues.push('manifest.json › createdAt: ISO 8601 tarih olmalı.');
  }
  if (issues.length > 0) return { ok: false, issues };

  return {
    ok: true,
    manifest: {
      id: data.id,
      name: data.name,
      description: data.description,
      version: data.version,
      permissions,
      tools,
      ...(hosts.length > 0 ? { net: { hosts } } : {}),
      ...(roots.length > 0 ? { fs: { roots } } : {}),
      ...(usedTools.length > 0 ? { uses: { tools: usedTools } } : {}),
      ...(data.speak === true ? { speak: true } : {}),
      ...(cards.length > 0 ? { cards } : {}),
      ...(jobs.length > 0 ? { jobs } : {}),
      ...(watches.length > 0 ? { watches } : {}),
      ...(pages.length > 0 ? { pages } : {}),
      ...(settings.length > 0 ? { settings } : {}),
      ...(voice.length > 0 ? { voice } : {}),
      createdBy: data.createdBy,
      ...(data.createdAt ? { createdAt: data.createdAt } : {}),
    },
  };
}
