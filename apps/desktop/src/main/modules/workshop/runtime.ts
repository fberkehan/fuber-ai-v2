/**
 * Eklenti katkılarının çalışma zamanı: etkin bir eklentinin pano kartlarını, zamanlanmış ve olay tetikli işlerini,
 * takiplerini ve sesli komut kalıplarını çekirdeğe bağlar; eklenti kapanınca hepsini geri alır.
 *
 * Tek kural: bütün işleyiciler eklentinin ARAÇLARIDIR ve canlı konakta (`deps.call`) koşar. Bu dosya eklenti kodu
 * çalıştırmaz; yalnız ne zaman çağrılacağına ve sonucun nereye gideceğine karar verir:
 *  - kart   → araç `data.card` döndürür → hazır pano şablonuna indirgenir → Bugün panosu (kayıt: `dashboard`)
 *  - iş     → araç `text` döndürür → `announce` (sesli / bildirim / sessiz). Boş `text` = söyleyecek bir şey yok.
 *  - takip  → araç `data.items: [{ key, title, detail? }]` döndürür → daha önce görülmemiş `key` duyurulur
 *  - kalıp  → `spoken-routes` kaydı (söz kesin eşleşirse araç kullanıcının kökeniyle kapıdan çağrılır)
 *
 * Zamanlama kendi küçük saatidir (30 sn yoklama; durum `workshop_runs` tablosunda): çekirdek zamanlayıcının tekrar
 * birimi gündür, eklentiler dakika aralığı da ister. Kaçan günlük iş yalnız bir saat içinde telafi edilir: "her sabah
 * dokuzda" öğleden sonra çalışmaz.
 */
import {
  customCardKind,
  dashboard,
  nowIso,
  t,
  type DashboardCustomContent,
  type JsonObject,
  type JsonValue,
  type Logger,
  type ModuleContext,
  type Unsubscribe,
} from '@fuber/shared';
import crypto from 'node:crypto';
import { setSpokenRoutes } from '../../core/brain/spoken-routes';
import type { WatchProbe, WatchSourceDef } from '../watch/types';
import type { SkillToolResult } from '../../../skill-host/protocol';
import { describeEvery, describeSchedule } from './preview';
import type { RunRecord, WorkshopStore } from './store';
import {
  pluginPageRoute,
  type PluginActivity,
  type PluginAnnounce,
  type PluginCard,
  type PluginCardTemplate,
  type PluginEventName,
  type PluginJob,
  type PluginPageInfo,
  type PluginWatch,
  type WorkshopManifest,
} from './types';

export interface PluginRuntimeDeps {
  ctx: ModuleContext;
  store: WorkshopStore;
  log: Logger;
  /** Etkin eklentinin bir aracını canlı konakta çağırır (gizli işleyiciler dahil). Fırlatabilir. */
  call(skillId: string, tool: string, input: unknown): Promise<SkillToolResult>;
  now?(): Date;
  /** Yoklama aralığı; `0` kendiliğinden yoklamayı kapatır (sınama `tick()` çağırır). */
  tickMs?: number;
}

export interface PluginRuntime {
  /** Eklenti etkinleşti: katkıları bağlanır. `boot`: uygulama açılışındaki yükleme (`app.started` işleri tetiklenir). */
  attach(skillId: string, manifest: WorkshopManifest, options?: { boot?: boolean }): void;
  detach(skillId: string): void;
  pages(): PluginPageInfo[];
  activity(skillId?: string): PluginActivity[];
  runNow(skillId: string, kind: 'job' | 'watch' | 'card', id: string): Promise<{ ok: boolean; text: string }>;
  /** Vakti gelen kartları, işleri ve takipleri koşturur (yoklama; sınama doğrudan çağırır). */
  tick(): Promise<void>;
  /** Olay tetikli işleri koşturur (sınama için dışa açık). */
  fire(event: PluginEventName, payload: JsonObject): Promise<void>;
  start(): void;
  stop(): void;
}

const DEFAULT_TICK_MS = 30_000;
/** Kaçan günlük iş bu kadar geç kaldıysa o gün artık çalışmaz. */
const DAILY_LATE_LIMIT_MS = 60 * 60_000;
/** Olay tetikli iş en sık bu aralıkla koşar (olay yağmuru eklentiyi ve kullanıcıyı boğmasın). */
const EVENT_MIN_GAP_MS = 10_000;
const APP_STARTED_DELAY_MS = 5_000;
const MAX_ANNOUNCE_CHARS = 400;
const MAX_WATCH_ITEMS = 50;
const MAX_NEW_SPOKEN = 3;

const clip = (value: unknown, max: number): string => String(value ?? '').slice(0, max);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Aracın döndürdüğü kart verisini panonun hazır şablonuna indirger. Şablona uymayan ya da boş veri `null` (kart
 * çizilmez). Eklenti yalnız metin ve sayı verebilir: bağlantı, görüntü ya da biçimli içerik panoya geçmez.
 */
export function sanitizeCardContent(template: PluginCardTemplate, raw: unknown): DashboardCustomContent | null {
  if (!isRecord(raw)) return null;
  switch (template) {
    case 'metric': {
      const value = clip(raw.value, 40).trim();
      if (!value) return null;
      const trend = raw.trend === 'up' || raw.trend === 'down' || raw.trend === 'flat' ? raw.trend : undefined;
      return {
        template: 'metric',
        value,
        ...(raw.unit !== undefined ? { unit: clip(raw.unit, 12) } : {}),
        ...(raw.label !== undefined ? { label: clip(raw.label, 60) } : {}),
        ...(raw.delta !== undefined ? { delta: clip(raw.delta, 24) } : {}),
        ...(trend ? { trend } : {}),
      };
    }
    case 'list': {
      const items = (Array.isArray(raw.items) ? raw.items : [])
        .filter(isRecord)
        .slice(0, 12)
        .map((item) => ({
          text: clip(item.text ?? item.title, 120),
          ...(item.detail !== undefined ? { detail: clip(item.detail, 160) } : {}),
          ...(typeof item.done === 'boolean' ? { done: item.done } : {}),
        }))
        .filter((item) => item.text.trim() !== '');
      return items.length > 0 ? { template: 'list', items } : null;
    }
    case 'keyvalue': {
      const pairs = (Array.isArray(raw.pairs) ? raw.pairs : [])
        .filter(isRecord)
        .slice(0, 12)
        .map((pair) => ({ label: clip(pair.label, 60), value: clip(pair.value, 120) }))
        .filter((pair) => pair.label.trim() !== '');
      return pairs.length > 0 ? { template: 'keyvalue', pairs } : null;
    }
    case 'text': {
      const text = clip(raw.text, 600).trim();
      return text ? { template: 'text', text } : null;
    }
    case 'progress': {
      const value = Number(raw.value);
      if (!Number.isFinite(value)) return null;
      return {
        template: 'progress',
        value: Math.min(1, Math.max(0, value)),
        ...(raw.label !== undefined ? { label: clip(raw.label, 60) } : {}),
        ...(raw.detail !== undefined ? { detail: clip(raw.detail, 120) } : {}),
      };
    }
  }
}

/** Günlük zamanlamanın bugünkü anı (yerel saat); bugün çalışma günü değilse `null`. */
function dailySlot(schedule: { daily: string; days?: number[] }, now: Date): Date | null {
  // getDay: 0=Pazar … 6=Cumartesi → 1=Pazartesi … 7=Pazar
  const weekday = now.getDay() === 0 ? 7 : now.getDay();
  if (schedule.days && !schedule.days.includes(weekday)) return null;
  const [hours, minutes] = schedule.daily.split(':').map(Number);
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours ?? 0, minutes ?? 0, 0, 0);
}

/** Günlük iş şimdi çalışmalı mı. `since`: işin kurulduğu an (kurulmadan önceki an telafi edilmez). */
export function dailyDue(schedule: { daily: string; days?: number[] }, lastRunAt: string | null, since: string | null, now: Date): boolean {
  const slot = dailySlot(schedule, now);
  if (!slot) return false;
  const at = slot.getTime();
  if (now.getTime() < at) return false;
  if (now.getTime() - at > DAILY_LATE_LIMIT_MS) return false;
  if (lastRunAt && Date.parse(lastRunAt) >= at) return false;
  if (since && Date.parse(since) > at) return false;
  return true;
}

/** Günlük işin bir sonraki anı. */
export function nextDaily(schedule: { daily: string; days?: number[] }, now: Date): Date {
  for (let offset = 0; offset < 8; offset++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, 12, 0, 0, 0);
    const slot = dailySlot(schedule, day);
    if (slot && slot.getTime() > now.getTime()) return slot;
  }
  return new Date(now.getTime() + 24 * 60 * 60_000);
}

interface Attached {
  manifest: WorkshopManifest;
  disposers: Unsubscribe[];
  /** Katkının kurulduğu an (bu oturumda); kalıcı kayıt yoksa ilk aralık buradan sayılır. */
  since: string;
  /** Süren koşular (`kind:id`): aynı katkı üst üste koşmaz. */
  busy: Set<string>;
  lastEventAt: Map<string, number>;
}

export function createPluginRuntime(deps: PluginRuntimeDeps): PluginRuntime {
  const { ctx, store, log } = deps;
  const now = () => deps.now?.() ?? new Date();
  const attached = new Map<string, Attached>();
  const subscriptions: Unsubscribe[] = [];
  let timer: ReturnType<typeof setInterval> | null = null;
  let ticking: Promise<void> | null = null;
  let wasAway = false;

  const cardId = (skillId: string, id: string) => `plugin.${skillId}.${id}`;
  const changed = (skillId: string | null) => ctx.bus.emit('plugins.changed', { skillId });

  const runOf = (skillId: string, kind: RunRecord['kind'], itemId: string): RunRecord =>
    store.runs.get(skillId, kind, itemId) ?? { skillId, kind, itemId, lastRunAt: null, lastOk: null, lastText: null, data: null };

  /** Aracı çağırır; fırlatmaz. */
  const invoke = async (skillId: string, tool: string, input: unknown): Promise<SkillToolResult> => {
    try {
      return await deps.call(skillId, tool, input);
    } catch (error) {
      return { ok: false, text: error instanceof Error ? error.message : String(error) };
    }
  };

  const announce = (skillId: string, manifest: WorkshopManifest, how: PluginAnnounce, title: string, text: string, dedupe: string) => {
    const body = text.trim().slice(0, MAX_ANNOUNCE_CHARS);
    if (how === 'silent' || !body) return;
    // İzin manifestte doğrulandı; yine de çalışma anında yeniden bakılır (güncellemeyle izin daralmış olabilir).
    const speak = how === 'speak' && manifest.speak === true;
    if (!speak && !manifest.permissions.includes('notify')) return;
    try {
      ctx.attention.notify({
        moduleId: `skill:${skillId}`,
        title: `${manifest.name}: ${title}`,
        body,
        // Sesli kanalı Dikkat Yöneticisi seçer (sessiz saat, toplantı, tam ekran kuralları geçerlidir).
        priority: speak ? 'high' : 'normal',
        speak: speak ? body : false,
        dedupeKey: `plugin.${skillId}.${dedupe}`,
        data: { skillId },
      });
    } catch (error) {
      log.warn(`${skillId}: duyuru gönderilemedi`, error);
    }
  };

  const guarded = async <T>(skillId: string, key: string, work: (entry: Attached) => Promise<T>, busyValue: T): Promise<T> => {
    const entry = attached.get(skillId);
    if (!entry || entry.busy.has(key)) return busyValue;
    entry.busy.add(key);
    try {
      return await work(entry);
    } finally {
      entry.busy.delete(key);
    }
  };

  const refreshCard = (skillId: string, card: PluginCard): Promise<{ ok: boolean; text: string }> =>
    guarded(
      skillId,
      `card:${card.id}`,
      async () => {
        const result = await invoke(skillId, card.tool, card.input);
        const previous = runOf(skillId, 'card', card.id);
        const content = result.ok && isRecord(result.data) ? sanitizeCardContent(card.template, result.data.card) : null;
        const ok = result.ok && content !== null;
        store.runs.save({
          ...previous,
          lastRunAt: nowIso(),
          lastOk: ok,
          lastText: ok ? result.text : result.ok ? t('plugins.card.badData', { template: card.template }) : result.text,
          // Başarısız yenilemede son iyi veri kalır (kart "eski veri" olarak görünür).
          data: content ? (content as unknown as JsonValue) : previous.data,
        });
        dashboard.invalidate(cardId(skillId, card.id));
        changed(skillId);
        return { ok, text: ok ? t('plugins.card.refreshed', { title: card.title }) : result.ok ? t('plugins.card.badData', { template: card.template }) : result.text };
      },
      { ok: false, text: t('plugins.run.busy') },
    );

  const runJob = (skillId: string, job: PluginJob, event?: JsonObject): Promise<{ ok: boolean; text: string }> =>
    guarded(
      skillId,
      `job:${job.id}`,
      async (entry) => {
        const result = await invoke(skillId, job.tool, event ? { ...job.input, event } : job.input);
        const at = nowIso();
        store.runs.save({ ...runOf(skillId, 'job', job.id), lastRunAt: at, lastOk: result.ok, lastText: result.text });
        if (result.ok) announce(skillId, entry.manifest, job.announce, job.title, result.text, `job.${job.id}.${at}`);
        else log.warn(`${skillId}: "${job.id}" işi başarısız: ${result.text.slice(0, 200)}`);
        changed(skillId);
        return { ok: result.ok, text: result.text || t('plugins.job.quiet') };
      },
      { ok: false, text: t('plugins.run.busy') },
    );

  const runWatch = (skillId: string, watch: PluginWatch): Promise<{ ok: boolean; text: string }> =>
    guarded(
      skillId,
      `watch:${watch.id}`,
      async (entry) => {
        const result = await invoke(skillId, watch.tool, watch.input);
        const previous = runOf(skillId, 'watch', watch.id);
        const at = nowIso();
        if (!result.ok) {
          store.runs.save({ ...previous, lastRunAt: at, lastOk: false, lastText: result.text });
          changed(skillId);
          return { ok: false, text: result.text };
        }
        const items = (isRecord(result.data) && Array.isArray(result.data.items) ? result.data.items : [])
          .filter(isRecord)
          .slice(0, MAX_WATCH_ITEMS)
          .map((item) => ({ key: clip(item.key, 200), title: clip(item.title, 160), detail: item.detail !== undefined ? clip(item.detail, 200) : '' }))
          .filter((item) => item.key !== '' && item.title.trim() !== '');
        // İlk koşu yalnız tohumlar: o an var olan her şey "yeni" diye duyurulmaz.
        const first = previous.lastRunAt === null && store.seen.count(skillId, watch.id) === 0;
        const fresh = items.filter((item) => !store.seen.has(skillId, watch.id, item.key));
        store.seen.add(
          skillId,
          watch.id,
          items.map((item) => item.key),
        );
        const summary = first
          ? t('plugins.watch.seeded', { count: items.length })
          : fresh.length > 0
            ? t('plugins.watch.fresh', { count: fresh.length, list: fresh.slice(0, MAX_NEW_SPOKEN).map((item) => item.title).join('; ') })
            : t('plugins.watch.nothing');
        store.runs.save({ ...previous, lastRunAt: at, lastOk: true, lastText: summary });
        if (!first && fresh.length > 0) announce(skillId, entry.manifest, watch.announce, watch.title, summary, `watch.${watch.id}.${at}`);
        changed(skillId);
        return { ok: true, text: summary };
      },
      { ok: false, text: t('plugins.run.busy') },
    );

  const tickOnce = async () => {
    const at = now();
    for (const [skillId, entry] of [...attached]) {
      for (const card of entry.manifest.cards ?? []) {
        const run = runOf(skillId, 'card', card.id);
        if (run.lastRunAt === null || at.getTime() - Date.parse(run.lastRunAt) >= card.refreshMinutes * 60_000) await refreshCard(skillId, card);
      }
      for (const job of entry.manifest.jobs ?? []) {
        if ('on' in job.schedule) continue;
        const run = runOf(skillId, 'job', job.id);
        const due =
          'daily' in job.schedule
            ? dailyDue(job.schedule, run.lastRunAt, entry.since, at)
            : at.getTime() - Date.parse(run.lastRunAt ?? entry.since) >= job.schedule.everyMinutes * 60_000;
        if (due) await runJob(skillId, job);
      }
      for (const watch of entry.manifest.watches ?? []) {
        const run = runOf(skillId, 'watch', watch.id);
        // Takibin ilk koşusu hemen yapılır (tohumlama); sonrası aralıkla.
        if (run.lastRunAt === null || at.getTime() - Date.parse(run.lastRunAt) >= watch.everyMinutes * 60_000) await runWatch(skillId, watch);
      }
    }
  };

  const tick = (): Promise<void> => {
    // Yoklamalar üst üste binmez: uzun süren bir koşu bir sonraki yoklamayı bekletir.
    ticking ??= tickOnce()
      .catch((error: unknown) => log.warn('eklenti yoklaması başarısız', error))
      .finally(() => {
        ticking = null;
      });
    return ticking;
  };

  const fire = async (event: PluginEventName, payload: JsonObject): Promise<void> => {
    for (const [skillId, entry] of [...attached]) {
      for (const job of entry.manifest.jobs ?? []) {
        if (!('on' in job.schedule) || job.schedule.on !== event) continue;
        const key = `${job.id}`;
        const last = entry.lastEventAt.get(key) ?? 0;
        if (Date.now() - last < EVENT_MIN_GAP_MS) continue;
        entry.lastEventAt.set(key, Date.now());
        await runJob(skillId, job, { name: event, ...payload });
      }
    }
  };
  const fireSoon = (event: PluginEventName, payload: JsonObject) => void fire(event, payload).catch((error: unknown) => log.warn(`"${event}" işleri koşturulamadı`, error));

  const detach = (skillId: string) => {
    const entry = attached.get(skillId);
    if (!entry) return;
    attached.delete(skillId);
    for (const dispose of entry.disposers) {
      try {
        dispose();
      } catch (error) {
        log.warn(`${skillId}: katkı kaldırılamadı`, error);
      }
    }
    changed(skillId);
  };

  /**
   * Takip işleri (İşler modülü) için kaynak: etkin eklentilerin takipleri `watch_start`'ta `source: "plugin"` olarak
   * kullanılabilir ("haberler takibinde 'deprem' geçince haber ver"). Modüller birbirini içe aktarmaz: kaynak
   * `watch.sources.collect` olayına eklenir, arayüzü yalnız tip olarak alınır. Kaynak yapay zekâ çağırmaz; eklentinin
   * okuma aracını çağırır ve döndürdüğü başlıkları verir (başlıklar dış içeriktir, talimat değildir).
   */
  const findWatch = (target: string): { skillId: string; watch: PluginWatch } | null => {
    const want = target.trim().toLocaleLowerCase('tr-TR');
    const all: Array<{ skillId: string; name: string; watch: PluginWatch }> = [];
    for (const [skillId, entry] of attached) for (const watch of entry.manifest.watches ?? []) all.push({ skillId, name: entry.manifest.name, watch });
    const exact = all.filter((item) => `${item.skillId}:${item.watch.id}` === want);
    const named = exact.length ? exact : all.filter((item) => item.watch.title.toLocaleLowerCase('tr-TR') === want || item.name.toLocaleLowerCase('tr-TR') === want);
    const loose = named.length ? named : all.filter((item) => want.length >= 3 && (item.watch.title.toLocaleLowerCase('tr-TR').includes(want) || item.name.toLocaleLowerCase('tr-TR').includes(want)));
    return loose.length === 1 ? { skillId: loose[0]!.skillId, watch: loose[0]!.watch } : null;
  };
  const watchNames = () => [...attached].flatMap(([skillId, entry]) => (entry.manifest.watches ?? []).map((watch) => `${watch.title} (${skillId}:${watch.id})`));
  const pluginSource: WatchSourceDef = {
    kind: 'plugin',
    moduleId: 'workshop',
    label: t('plugins.source.label'),
    targetHint: t('plugins.source.targetHint'),
    mode: 'state',
    minIntervalSec: 60,
    maxIntervalSec: 1800,
    available: () => (watchNames().length > 0 ? null : t('plugins.source.unavailable')),
    normalize(target) {
      const found = findWatch(target);
      return found ? { target: `${found.skillId}:${found.watch.id}` } : { error: t('plugins.source.unknown', { names: watchNames().join(', ') || '-' }) };
    },
    describe(target) {
      const found = findWatch(target);
      return t('plugins.source.describe', { title: found?.watch.title ?? target });
    },
    async check({ target }): Promise<WatchProbe> {
      const found = findWatch(target);
      if (!found) throw new Error(t('plugins.source.unknown', { names: watchNames().join(', ') || '-' }));
      const result = await invoke(found.skillId, found.watch.tool, found.watch.input);
      if (!result.ok) throw new Error(result.text);
      const items = (isRecord(result.data) && Array.isArray(result.data.items) ? result.data.items : [])
        .filter(isRecord)
        .slice(0, MAX_WATCH_ITEMS)
        .map((item) => ({ key: clip(item.key, 200), title: clip(item.title, 160) }));
      const keys = items.map((item) => item.key).sort();
      const signature = crypto.createHash('sha1').update(JSON.stringify(keys)).digest('hex');
      return { signature, text: items.map((item) => item.title).join('\n') };
    },
  };

  return {
    attach(skillId, manifest, options = {}) {
      detach(skillId);
      const disposers: Unsubscribe[] = [];
      const entry: Attached = { manifest, disposers, since: nowIso(), busy: new Set(), lastEventAt: new Map() };

      const firstPage = manifest.pages?.[0];
      for (const card of manifest.cards ?? []) {
        try {
          disposers.push(
            dashboard.registerProvider<DashboardCustomContent>({
              id: cardId(skillId, card.id),
              moduleId: 'workshop',
              kind: customCardKind(card.template),
              title: card.title,
              defaultSize: card.size,
              priority: 50,
              page: firstPage ? pluginPageRoute(skillId, firstPage.id) : 'skills',
              fill() {
                const run = store.runs.get(skillId, 'card', card.id);
                if (!run || !isRecord(run.data)) return null;
                return { data: run.data as unknown as DashboardCustomContent, updatedAt: run.lastRunAt, stale: run.lastOk === false };
              },
            }),
          );
        } catch (error) {
          log.warn(`${skillId}: "${card.id}" kartı kaydedilemedi`, error);
        }
      }
      if ((manifest.voice ?? []).length > 0) disposers.push(setSpokenRoutes(`skill:${skillId}`, manifest.voice ?? []));

      // Manifestte artık olmayan katkıların ve ayarların durumu temizlenir (güncelleme ya da geri alma sonrası).
      store.settings.prune(
        skillId,
        (manifest.settings ?? []).map((setting) => setting.key),
      );
      store.runs.prune(skillId, [
        ...(manifest.cards ?? []).map((card) => ({ kind: 'card' as const, itemId: card.id })),
        ...(manifest.jobs ?? []).map((job) => ({ kind: 'job' as const, itemId: job.id })),
        ...(manifest.watches ?? []).map((watch) => ({ kind: 'watch' as const, itemId: watch.id })),
      ]);

      attached.set(skillId, entry);
      changed(skillId);
      // Kartlar ve takipler ilk verisini hemen alır; açılışta `app.started` işleri kısa bir gecikmeyle koşar.
      if ((manifest.cards ?? []).length > 0 || (manifest.watches ?? []).length > 0) void tick();
      if (options.boot && (manifest.jobs ?? []).some((job) => 'on' in job.schedule && job.schedule.on === 'app.started')) {
        const handle = setTimeout(() => {
          for (const job of manifest.jobs ?? []) {
            if ('on' in job.schedule && job.schedule.on === 'app.started' && attached.get(skillId) === entry) {
              void runJob(skillId, job, { name: 'app.started' });
            }
          }
        }, APP_STARTED_DELAY_MS);
        handle.unref?.();
        disposers.push(() => clearTimeout(handle));
      }
    },

    detach,

    pages() {
      const list: PluginPageInfo[] = [];
      for (const [skillId, entry] of attached) {
        for (const page of entry.manifest.pages ?? []) {
          list.push({ skillId, skillName: entry.manifest.name, pageId: page.id, title: page.title, icon: page.icon });
        }
      }
      return list;
    },

    activity(only) {
      const at = now();
      const list: PluginActivity[] = [];
      for (const [skillId, entry] of attached) {
        if (only && only !== skillId) continue;
        const base = { skillId, skillName: entry.manifest.name };
        const state = (kind: RunRecord['kind'], id: string) => {
          const run = runOf(skillId, kind, id);
          return { lastRunAt: run.lastRunAt, lastOk: run.lastOk, lastText: run.lastText };
        };
        const after = (lastRunAt: string | null, minutes: number) => new Date(Date.parse(lastRunAt ?? entry.since) + minutes * 60_000).toISOString();
        for (const card of entry.manifest.cards ?? []) {
          const run = state('card', card.id);
          list.push({
            ...base,
            kind: 'card',
            id: card.id,
            title: card.title,
            schedule: describeEvery(card.refreshMinutes),
            announce: null,
            ...run,
            nextRunAt: run.lastRunAt ? after(run.lastRunAt, card.refreshMinutes) : null,
          });
        }
        for (const job of entry.manifest.jobs ?? []) {
          const run = state('job', job.id);
          const nextRunAt =
            'daily' in job.schedule ? nextDaily(job.schedule, at).toISOString() : 'everyMinutes' in job.schedule ? after(run.lastRunAt, job.schedule.everyMinutes) : null;
          list.push({ ...base, kind: 'job', id: job.id, title: job.title, schedule: describeSchedule(job.schedule), announce: job.announce, ...run, nextRunAt });
        }
        for (const watch of entry.manifest.watches ?? []) {
          const run = state('watch', watch.id);
          list.push({
            ...base,
            kind: 'watch',
            id: watch.id,
            title: watch.title,
            schedule: describeEvery(watch.everyMinutes),
            announce: watch.announce,
            ...run,
            nextRunAt: run.lastRunAt ? after(run.lastRunAt, watch.everyMinutes) : null,
          });
        }
      }
      return list;
    },

    async runNow(skillId, kind, id) {
      const entry = attached.get(skillId);
      if (!entry) return { ok: false, text: t('plugins.run.inactive') };
      if (kind === 'card') {
        const card = (entry.manifest.cards ?? []).find((item) => item.id === id);
        return card ? refreshCard(skillId, card) : { ok: false, text: t('plugins.run.unknown') };
      }
      if (kind === 'job') {
        const job = (entry.manifest.jobs ?? []).find((item) => item.id === id);
        return job ? runJob(skillId, job) : { ok: false, text: t('plugins.run.unknown') };
      }
      const watch = (entry.manifest.watches ?? []).find((item) => item.id === id);
      return watch ? runWatch(skillId, watch) : { ok: false, text: t('plugins.run.unknown') };
    },

    tick,
    fire,

    start() {
      const interval = deps.tickMs ?? DEFAULT_TICK_MS;
      if (interval > 0 && !timer) {
        timer = setInterval(() => void tick(), interval);
        timer.unref?.();
      }
      // Olay kaynakları: yük eklentiye en küçük hâliyle gider (dış içerik talimat değil, veridir).
      subscriptions.push(
        (ctx.bus as unknown as { on(type: string, handler: (payload: { sources: WatchSourceDef[] }) => void): Unsubscribe }).on('watch.sources.collect', ({ sources }) => {
          if (watchNames().length > 0) sources.push(pluginSource);
        }),
        ctx.bus.on('attention.notify', ({ notification }) => {
          if (notification.moduleId === 'planner' && typeof notification.data.reminderId === 'string') {
            fireSoon('reminder.fired', { title: notification.title.slice(0, 200), body: notification.body.slice(0, 300) });
          } else if (notification.moduleId === 'watch') {
            fireSoon('watch.fired', { title: notification.title.slice(0, 200), body: notification.body.slice(0, 300) });
          }
        }),
        ctx.bus.on('presence.changed', (presence) => {
          const away = presence.mode === 'away';
          if (wasAway && !away) fireSoon('user.returned', {});
          wasAway = away;
        }),
        (ctx.bus as unknown as { on(type: string, handler: (payload: unknown) => void): Unsubscribe }).on('mail.received', (payload) => {
          const messages = isRecord(payload) && Array.isArray(payload.messages) ? payload.messages.filter(isRecord) : [];
          fireSoon('mail.received', {
            count: messages.length,
            messages: messages.slice(0, 5).map((message) => ({ from: clip(message.from, 120), subject: clip(message.subject, 200) })),
          });
        }),
      );
    },

    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      for (const off of subscriptions.splice(0)) off();
      for (const skillId of [...attached.keys()]) detach(skillId);
    },
  };
}
