// İş araçları. `watch_start` planı KESİN doğrular ve kullanıcıya TEK onay kartı gösterir (planın insan dili);
// onaylanınca gözcü arka planda başlar. Öteki araçlar listeler, durumu söyler, duraklatır, sürdürür, iptal eder.
// Küme `watch` (yerel modele "takip et / bitince haber ver / işlerim" sözünde açılır: `core/brain/local-tools.ts`).
import { defineTool, foldForSearch, t, type JsonObject, type ToolContext, type ToolDef, type ToolResult } from '@fuber/shared';
import { z } from 'zod';
import { approvalText, jobLine, planText, shortId, statusSentence } from './describe';
import { WatchError, type WatchEngine } from './engine';
import { DEFAULT_DURATION_HOURS, DEFAULT_MODEL_CALLS, MAX_DURATION_HOURS, compilePattern, fitInterval } from './rules';
import type { WatchCondition, WatchJob, WatchPlan, WatchSourceDef } from './types';

const CONDITIONS = ['changed', 'appears', 'disappears', 'matches', 'below', 'above', 'drops', 'rises', 'ask'] as const;

export const startInput = z.object({
  title: z.string().min(2).max(80).describe('Kısa ad: "Kulaklık fiyatı", "Atlas Claude oturumu"'),
  source: z
    .string()
    .min(2)
    .max(30)
    .describe('Ne izlenecek: page (web sayfası), file (dosya ya da klasör), window (açık pencere ya da tarayıcı sekmesinin başlığı), claude (Claude Code oturumu bitince), time (belli bir saatte); e-posta modülü açıksa mail'),
  target: z
    .string()
    .max(2000)
    .describe('page: tam adres · file: dosya/klasör yolu · window: pencere başlığından bir parça · claude: proje adı (boş = hangisi olursa) · time: ofsetli ISO an'),
  // Serbest metin: küçük model "asks" gibi yakın yazımlar üretiyor; doğrulama `buildPlan`'da Türkçe ve yol gösteren hatayla.
  condition: z
    .string()
    .max(20)
    .optional()
    .describe('changed (değişince; varsayılan), appears/disappears (text görününce/kaybolunca), below/above (sayı value’nun altına/üstüne), drops/rises (sayı düşünce/yükselince), matches (text düzenli ifadesi), ask (text: doğal dille koşul; yalnız değişince yapay zekâya sorulur)'),
  text: z.string().max(300).optional().describe('appears/disappears metni, matches deseni, ask sorusu; sayı koşullarında sayının yanındaki sözcük ("Fiyat", "TL")'),
  value: z.number().optional().describe('below/above eşiği'),
  repeat: z.boolean().optional().describe('true: son tarihe dek her seferinde haber ver; varsayılan false (ilk seferde biter)'),
  speak: z.boolean().optional().describe('Sesli haber; varsayılan true'),
  hours: z.number().min(0.05).max(MAX_DURATION_HOURS).optional().describe(`Kaç saat izlensin; varsayılan ${DEFAULT_DURATION_HOURS}, en çok ${MAX_DURATION_HOURS}`),
  every_minutes: z.number().min(0.1).max(60).optional().describe('En sık kaç dakikada bir bakılsın (kaynağın sınırına oturtulur)'),
  then_tool: z.string().max(60).optional().describe('Koşul tutunca çalışacak OKUMA aracı (ör. web_read, fx_rate); yazan araç her seferinde ayrıca onay ister'),
  then_input: z.record(z.string(), z.unknown()).optional().describe('then_tool girdisi'),
  goal: z.string().max(1000).optional().describe('Kullanıcının isteği, kendi sözleriyle'),
});
export type StartInput = z.infer<typeof startInput>;

export interface ToolRuntime {
  engine: WatchEngine;
  now(): number;
}

export interface BuiltPlan {
  title: string;
  goal: string;
  plan: WatchPlan;
  source: WatchSourceDef;
  /** Eylem aracı okuma dışıysa (her seferinde yeniden onay ister). */
  actionNeedsApproval: boolean;
}

/** Araç girdisini doğrulanmış plana çevirir. Hata Türkçe ve modele düzeltme yolunu söyler. */
export function buildPlan(input: StartInput, engine: WatchEngine, tools: Pick<ToolContext['tools'], 'list' | 'has'>, now: number): BuiltPlan | { error: string } {
  const kind = input.source.trim().toLowerCase();
  const source = engine.source(kind);
  const offered = engine
    .sources()
    .filter((info) => !info.unavailable)
    .map((info) => info.kind)
    .join(', ');
  if (!source) return { error: t('watch.error.unknownSource', { kind, list: offered }) };
  const unavailable = source.available?.() ?? null;
  if (unavailable) return { error: unavailable };
  const normalized = source.normalize ? source.normalize(input.target) : { target: input.target.trim() };
  if ('error' in normalized) return { error: normalized.error };
  const target = normalized.target;

  const text = input.text?.trim() ?? '';
  let condition: WatchCondition;
  // Koşul serbest metindir: küçük model "asks", "drop" gibi yakın yazımlar üretiyor (ölçüldü); tekil/çoğul farkı kabul edilir.
  const raw = (input.condition ?? 'changed').trim().toLowerCase();
  const requested = CONDITIONS.find((name) => name === raw || name === `${raw}s` || `${name}s` === raw || (name === 'matches' && raw === 'match'));
  if (!requested) return { error: t('watch.error.badCondition', { condition: raw, list: CONDITIONS.join(', ') }) };
  const withValue = typeof input.value === 'number' && Number.isFinite(input.value);
  // Claude Code kaynağının olayı yalnız "oturum bitti"dir: metin koşulu yoksa koşul "yeni bitiş"tir (model "ask" verse de).
  const claudeDefault = kind === 'claude' && requested !== 'appears' && requested !== 'disappears' && requested !== 'matches';
  // "Klasöre yeni dosya gelince": genel sözcük ("dosya") ad değildir; klasörün değişmesi demektir (ölçüldü: yerel model böyle veriyor).
  const genericFile = kind === 'file' && requested === 'appears' && /^(yeni )?(dosya|belge|evrak|file)(lar)?$/.test(foldForSearch(text));
  // "Fiyat 1000'in altına düşünce" sözünde küçük model `drops` + `value` veriyor (ölçüldü): eşik varsa eşik koşuludur.
  const type = kind === 'time' || claudeDefault || genericFile ? 'changed' : requested === 'drops' && withValue ? 'below' : requested === 'rises' && withValue ? 'above' : requested;
  switch (type) {
    case 'changed':
      condition = { type };
      break;
    case 'appears':
    case 'disappears':
      if (!text) return { error: t('watch.error.needText') };
      condition = { type, text };
      break;
    case 'matches':
      if (!compilePattern(text)) return { error: t('watch.error.badPattern') };
      condition = { type, pattern: text };
      break;
    case 'below':
    case 'above':
      if (typeof input.value !== 'number' || !Number.isFinite(input.value)) return { error: t('watch.error.needValue') };
      condition = { type, value: input.value, ...(text ? { near: text } : {}) };
      break;
    case 'drops':
    case 'rises':
      condition = { type, ...(text ? { near: text } : {}) };
      break;
    case 'ask':
      if (!text) return { error: t('watch.error.needQuestion') };
      condition = { type, question: text };
      break;
  }

  const hours = input.hours ?? DEFAULT_DURATION_HOURS;
  let untilAt = now + Math.min(MAX_DURATION_HOURS, hours) * 3_600_000;
  // Saat işinin son tarihi vaktinden sonra olmalı: vakit son tarihten sonraysa son tarih vakte göre uzar.
  if (kind === 'time') untilAt = Math.max(untilAt, Date.parse(target) + 10 * 60_000);
  if (kind === 'time' && Date.parse(target) - now > MAX_DURATION_HOURS * 3_600_000) return { error: t('watch.error.tooFar', { days: MAX_DURATION_HOURS / 24 }) };

  let action: WatchPlan['action'] = null;
  let actionNeedsApproval = false;
  if (input.then_tool?.trim()) {
    const name = input.then_tool.trim();
    const info = tools.list().find((tool) => tool.name === name);
    if (!info || name.startsWith('watch_')) return { error: t('watch.error.unknownTool', { tool: name }) };
    action = { tool: name, input: (input.then_input ?? {}) as JsonObject };
    actionNeedsApproval = info.risk !== 'read';
  }

  const plan: WatchPlan = {
    source: { kind, target },
    condition,
    repeat: kind === 'time' ? false : (input.repeat ?? false),
    speak: input.speak ?? true,
    untilAt: new Date(untilAt).toISOString(),
    interval: fitInterval(input.every_minutes ? { minSec: input.every_minutes * 60 } : {}, source),
    maxModelCalls: DEFAULT_MODEL_CALLS,
    action,
  };
  return { title: input.title.trim(), goal: input.goal?.trim() || input.title.trim(), plan, source, actionNeedsApproval };
}

/** Kimlik, kısa kimlik ya da başlıktan TEK işi bulur; bulamazsa ya da birden çok çıkarsa modele söylenecek metin. */
function pick(engine: WatchEngine, query: string, only?: (job: WatchJob) => boolean): WatchJob | { error: string } {
  const found = engine.find(query).filter((job) => !only || only(job));
  if (found.length === 1) return found[0]!;
  if (found.length === 0) return { error: t('watch.error.noMatch', { query }) };
  return { error: t('watch.error.ambiguous', { list: found.slice(0, 5).map((job) => `#${shortId(job.id)} ${job.title}`).join('; ') }) };
}

const failure = (error: unknown): ToolResult => ({ ok: false, text: error instanceof Error ? error.message : String(error) });

const jobQuery = z.object({ job: z.string().min(1).max(120).describe('İşin kısa kimliği (#K3QZ) ya da adından bir parça') });

export function createTools(runtime: () => ToolRuntime): ToolDef[] {
  return [
    defineTool({
      name: 'watch_start',
      group: 'watch',
      description:
        'Arka planda bir şeyi TAKİP EDEN iş başlatır; kullanıcı onay kartından onaylarsa çalışır. "Şu sayfayı takip et, fiyat düşünce söyle", ' +
        '"stokta yazısı çıkınca haber ver", "Claude bitirince haber ver", "şu klasöre dosya gelince söyle", "saat beşte şu sayfaya bak". ' +
        'Gözcü yapay zekâsız bakar; değişiklik yoksa yapay zekâ çağrılmaz, aralık uzar. Hatırlatıcı için reminder_create kullan, bunu değil.',
      input: startInput,
      risk: 'write',
      async run(input, ctx) {
        const { engine, now } = runtime();
        const built = buildPlan(input, engine, ctx.tools, now());
        if ('error' in built) return { ok: false, text: t('watch.tool.invalid', { error: built.error }) };
        const text = planText(built.plan, built.source.describe(built.plan.source.target), new Date(now()), built.actionNeedsApproval);
        const decision = await ctx.tools.requestApproval({
          toolName: 'watch_start',
          moduleId: 'watch',
          summary: approvalText(built.title, text),
          input: { title: built.title, source: built.plan.source.kind, target: built.plan.source.target, condition: built.plan.condition.type },
          origin: ctx.origin,
        });
        if (decision !== 'approved') return { ok: false, text: decision === 'expired' ? t('watch.tool.expired') : t('watch.tool.denied') };
        try {
          const job = engine.create({
            title: built.title,
            goal: built.goal,
            plan: built.plan,
            sessionId: ctx.origin.sessionId ?? null,
            channel: ctx.origin.channel === 'voice' || ctx.origin.channel === 'chat' ? ctx.origin.channel : null,
          });
          return {
            ok: true,
            text: t('watch.tool.started', { id: shortId(job.id), title: job.title, what: text.what, when: text.when, until: text.until }),
            data: { id: job.id, short: shortId(job.id) },
          };
        } catch (error) {
          return failure(error);
        }
      },
    }),

    defineTool({
      name: 'watch_list',
      group: 'watch',
      description: 'Arka plandaki takip işlerini durumlarıyla listeler ("işlerim ne durumda", "neleri takip ediyorsun"): son denetim, sonraki denetim, bulunan değişiklik.',
      input: z.object({ all: z.boolean().optional().describe('true: bitenler de; varsayılan yalnız süren ve duraklatılanlar') }),
      risk: 'read',
      async run({ all }) {
        const { engine, now } = runtime();
        const jobs = engine.list(all ? { limit: 15 } : { status: ['running', 'paused'], limit: 15 });
        if (!jobs.length) return { ok: true, text: all ? t('watch.tool.none') : t('watch.tool.noneActive') };
        return { ok: true, text: jobs.map((job) => jobLine(job, new Date(now()))).join('\n'), data: { count: jobs.length } };
      },
    }),

    defineTool({
      name: 'watch_status',
      group: 'watch',
      description: 'Bir takip işinin ayrıntılı durumu ("fiyat işi ne durumda"): ne izliyor, son denetim, bulunan, kalan süre. Tek bir işin ayrıntısı sorulduğunda kullan; kimliği bilmiyorsan önce watch_list.',
      input: jobQuery,
      risk: 'read',
      async run({ job: query }) {
        const { engine, now } = runtime();
        const job = pick(engine, query);
        if ('error' in job) return { ok: false, text: job.error };
        const source = engine.source(job.plan.source.kind);
        const text = planText(job.plan, source ? source.describe(job.plan.source.target) : job.plan.source.target, new Date(now()));
        const lines = [
          jobLine(job, new Date(now())),
          `${t('watch.approval.what')}: ${text.what} · ${t('watch.approval.when')}: ${text.when}`,
          text.until,
          job.finding ? t('watch.line.found', { finding: job.finding }) : '',
          job.lastError ? t('watch.line.error', { error: job.lastError }) : '',
        ].filter(Boolean);
        return { ok: true, text: lines.join('\n'), data: { id: job.id, status: job.status } };
      },
    }),

    defineTool({
      name: 'watch_pause',
      group: 'watch',
      description: 'Bir takip işini duraklatır ("şu işi durdur, sonra devam ederiz"). Silmez; watch_resume ile sürer. Kimliği bilmiyorsan önce watch_list.',
      input: jobQuery,
      risk: 'write',
      async run({ job: query }) {
        const { engine } = runtime();
        const job = pick(engine, query, (item) => item.status === 'running');
        if ('error' in job) return { ok: false, text: job.error };
        try {
          const paused = engine.pause(job.id, 'user');
          return { ok: true, text: t('watch.tool.paused', { title: paused.title }) };
        } catch (error) {
          return failure(error);
        }
      },
    }),

    defineTool({
      name: 'watch_resume',
      group: 'watch',
      description: 'Duraklatılmış takip işini sürdürür ("fiyat işine devam et"). Kimliği bilmiyorsan önce watch_list.',
      input: jobQuery,
      risk: 'write',
      async run({ job: query }) {
        const { engine, now } = runtime();
        const job = pick(engine, query, (item) => item.status === 'paused' || item.status === 'failed');
        if ('error' in job) return { ok: false, text: job.error };
        try {
          const resumed = engine.resume(job.id);
          return { ok: true, text: t('watch.tool.resumed', { title: resumed.title, status: statusSentence(resumed, new Date(now())) }) };
        } catch (error) {
          return failure(error instanceof WatchError ? error : new Error(String(error)));
        }
      },
    }),

    defineTool({
      name: 'watch_cancel',
      group: 'watch',
      description: 'Bir takip işini İPTAL EDER, biter ("şu işi iptal et", "fiyatı takip etmeyi bırak"). Kimliği bilmiyorsan önce watch_list; yalnız ara vermek isteniyorsa watch_pause.',
      input: jobQuery,
      risk: 'write',
      async run({ job: query }) {
        const { engine } = runtime();
        const job = pick(engine, query, (item) => item.status === 'running' || item.status === 'paused' || item.status === 'failed');
        if ('error' in job) return { ok: false, text: job.error };
        try {
          const cancelled = engine.cancel(job.id);
          return { ok: true, text: t('watch.tool.cancelled', { title: cancelled.title }) };
        } catch (error) {
          return failure(error);
        }
      },
    }),
  ];
}
