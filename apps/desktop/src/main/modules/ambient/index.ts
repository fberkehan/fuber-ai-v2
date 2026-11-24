// Ortam dinleme modülü (KURGU §10.2): gün kaydı + eşlikçi. Kapalı gelir; Yönetim izni VE kullanıcının açık rızası
// olmadan dinlemez. Ses bu modüle hiç gelmez: ses hattı yalnız yazıya çevrilmiş söz bölütlerini verir (`feed.ts`).
//
//   besleme (voice.ambient) → döküm → dönem kapanır → not tutucu (YALNIZ yerel model) → meseleler / önemli notlar
//   hafızaya / hafıza önerileri → günlük, haftalık, aylık rapor (yerel model);  önemli notta → eşlikçi (kod kapıları →
//   iz araması → konuşan beyne yalnız kısa notlarla "değer mi" → kod denetimi → Dikkat Yöneticisi)
import { addDays, defineModule, fromLocal, localDay, localTime, t, UserError, type Id, type ModuleContext, type Unsubscribe } from '@fuber/shared';
import { voiceAmbientFeed } from './feed';
import { AMBIENT_MIGRATIONS, createAmbientRepo, type AmbientRepo } from './repo';
import { briefLines, createAmbient, MODULE_ID, type AmbientService } from './service';
import { createTools } from './tools';
import './types';

const RETENTION_TASK = 'ambient.retention';
const REPORT_TASK = 'ambient.report';
/** Saklama görevi her gün bu saatte koşar; uygulama kapalıyken kaçan koşu açılışta yapılır. */
const RETENTION_TIME = '03:30';

interface Runtime {
  ctx: ModuleContext;
  repo: AmbientRepo;
  service: AmbientService;
}

let runtime: Runtime | null = null;
let screenLocked = false;
const subscriptions: Unsubscribe[] = [];

function ensure(ctx: ModuleContext): Runtime {
  if (runtime) return runtime;
  const now = () => new Date();
  const repo = createAmbientRepo(ctx.db, now);
  const service = createAmbient({
    repo,
    feed: voiceAmbientFeed(ctx.bus, ctx.voice),
    brain: ctx.brain,
    memory: ctx.memory,
    attention: ctx.attention,
    policy: ctx.policy,
    settings: ctx.settings,
    presence: ctx.presence,
    voice: ctx.voice,
    tools: ctx.tools,
    bus: ctx.bus,
    log: ctx.log,
    now,
    screenLocked: () => screenLocked,
    defer(run, ms) {
      const timer = setTimeout(run, ms);
      return () => clearTimeout(timer);
    },
    every(run, ms) {
      const timer = setInterval(run, ms);
      timer.unref();
      return () => clearInterval(timer);
    },
  });
  runtime = { ctx, repo, service };
  return runtime;
}

function current(): Runtime {
  if (!runtime) throw new UserError(t('ambient.error.off'));
  return runtime;
}

/** Bugün `time` geçtiyse yarın, geçmediyse bugün. */
function nextAt(time: string): string {
  let due = fromLocal(localDay(), time);
  if (due.getTime() <= Date.now()) due = fromLocal(addDays(localDay(), 1), time);
  return due.toISOString();
}

function scheduleDaily(ctx: ModuleContext, kind: string, time: string) {
  const existing = ctx.scheduler.list(kind).find((task) => task.key === 'daily');
  if (existing && localTime(existing.dueAt) === time) return;
  ctx.scheduler.schedule({ kind, key: 'daily', dueAt: nextAt(time), recurrence: { freq: 'daily', interval: 1 }, payload: {} });
}

/** Ekran kilidini izler. Electron yoksa (birim testi) sessizce atlanır. */
async function watchLock(ctx: ModuleContext): Promise<void> {
  try {
    const { powerMonitor } = await import('electron');
    if (!powerMonitor?.on) return;
    const lock = () => {
      screenLocked = true;
      runtime?.service.refresh();
    };
    const unlock = () => {
      screenLocked = false;
      runtime?.service.refresh();
    };
    powerMonitor.on('lock-screen', lock);
    powerMonitor.on('unlock-screen', unlock);
    subscriptions.push(() => {
      powerMonitor.off('lock-screen', lock);
      powerMonitor.off('unlock-screen', unlock);
    });
  } catch (error) {
    ctx.log.debug('ekran kilidi izlenemiyor', error);
  }
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const clampLimit = (value: number, max: number) => Math.max(1, Math.min(max, Math.round(Number(value) || 1)));
const ok = { ok: true as const };

export default defineModule({
  id: MODULE_ID,
  version: '1.0.0',
  nameKey: 'module.ambient.name',
  descriptionKey: 'module.ambient.description',
  permissions: ['mic', 'notify'],
  migrations: AMBIENT_MIGRATIONS,
  windowEvents: ['ambient.status', 'ambient.changed'],

  tools: createTools(() => {
    const { service, repo } = current();
    return { service, repo, now: () => new Date() };
  }),

  ipc: (ctx) => {
    const { service, repo } = ensure(ctx);
    const changed = (entity: 'segment' | 'note' | 'issue' | 'report', op: 'updated' | 'deleted', ids: Id[]) => ctx.bus.emit('ambient.changed', { entity, op, ids });
    return {
      'ambient.status': () => service.status(),
      'ambient.consent': ({ accept }) => service.consent(accept === true),
      'ambient.setPrefs': ({ patch }) => service.setPrefs(patch),
      'ambient.pause': ({ preset }) => service.pause(preset),
      'ambient.forgetRecent': ({ minutes }) => service.forgetRecent(minutes),
      'ambient.deleteAll': () => {
        service.deleteAll();
        return ok;
      },

      'ambient.days': ({ limit }) => repo.days(clampLimit(limit, 400)),
      'ambient.notes': ({ day }) => (DAY.test(day) ? repo.notesOfDay(day) : []),
      'ambient.noteSources': ({ id }) => {
        const note = repo.getNote(id);
        return note ? repo.segmentsByIds(note.sourceIds) : [];
      },
      'ambient.deleteNote': ({ id }) => {
        service.deleteNote(id);
        return ok;
      },
      'ambient.transcript': ({ day }) => (DAY.test(day) ? repo.segmentsOfDay(day) : []),
      'ambient.deleteSegment': ({ id }) => {
        repo.deleteSegments([id]);
        changed('segment', 'deleted', [id]);
        return ok;
      },
      'ambient.takeNotes': async () => {
        const result = await service.takeNotes(true);
        if (result.failed) throw new UserError(t('ambient.error.notesFailed'));
        return { notes: result.notes.length, issues: result.issues.length };
      },

      'ambient.issues': ({ status }) => repo.listIssues(status),
      'ambient.updateIssue': ({ id, patch }) => {
        if (patch.dueDay && !DAY.test(patch.dueDay)) throw new UserError(t('ambient.error.time'));
        const title = patch.title?.replace(/\s+/g, ' ').trim().slice(0, 160);
        const updated = repo.updateIssue(id, {
          ...(patch.status ? { status: patch.status } : {}),
          ...(patch.dueDay !== undefined ? { dueDay: patch.dueDay } : {}),
          ...(title ? { title } : {}),
        });
        if (!updated) throw new UserError(t('ambient.error.issueMissing'));
        changed('issue', 'updated', [id]);
        return updated;
      },
      'ambient.deleteIssue': ({ id }) => {
        repo.deleteIssues([id]);
        changed('issue', 'deleted', [id]);
        return ok;
      },
      'ambient.issueToReminder': ({ id, dueAt }) => service.issueToReminder(id, dueAt),

      'ambient.reports': ({ kind, limit }) => repo.listReports({ ...(kind ? { kind } : {}), limit: clampLimit(limit, 200) }),
      'ambient.buildReport': async ({ kind, period }) => {
        try {
          return await service.buildReport(kind, period);
        } catch (error) {
          ctx.log.warn('rapor hazırlanamadı', error);
          throw new UserError(t('ambient.error.reportFailed'));
        }
      },
      'ambient.deleteReport': ({ id }) => {
        repo.deleteReports([id]);
        changed('report', 'deleted', [id]);
        return ok;
      },

      'ambient.suggestions': () => repo.listSuggestions('pending'),
      'ambient.resolveSuggestion': ({ id, accept }) => {
        service.resolveSuggestion(id, accept === true);
        return ok;
      },
      'ambient.interjections': ({ limit }) => repo.recentInterjections(clampLimit(limit, 200)),
    };
  },

  async setup(ctx) {
    const { service, repo } = ensure(ctx);
    subscriptions.push(
      ctx.scheduler.handle(RETENTION_TASK, () => {
        service.runRetention();
      }),
    );
    subscriptions.push(
      ctx.scheduler.handle(REPORT_TASK, async () => {
        await service.runDueReports();
      }),
    );
    // Rapor saati kullanıcı tercihidir; değişince görev yeni saate alınır.
    subscriptions.push(ctx.bus.on('ambient.status', (status) => scheduleDaily(ctx, REPORT_TASK, status.prefs.reportTime)));
    // Sabah özetine vadesi gelen açık işler eklenir (olay planlar modülünündür; modül kapalıysa hiç yayınlanmaz).
    subscriptions.push(
      ctx.bus.on('planner.brief.collect', (brief) => {
        if (brief.kind === 'morning') brief.lines.push(...briefLines(repo, brief.day));
      }),
    );
    scheduleDaily(ctx, RETENTION_TASK, RETENTION_TIME);
    scheduleDaily(ctx, REPORT_TASK, service.status().prefs.reportTime);
    await watchLock(ctx);
    // Saklama sözü açılışta da tutulur: uygulama günlerce kapalı kaldıysa süresi dolan döküm ilk iş silinir.
    service.runRetention();
    service.start();
  },

  // Modül kapalıyken de (Yönetim kapattıktan sonra) kullanıcı notlarını, işlerini ve raporlarını silebilir.
  purge(ctx) {
    if (runtime) {
      runtime.service.deleteAll();
      return;
    }
    const repo = createAmbientRepo(ctx.db);
    // Önemli notların hafıza kopyaları da gider.
    for (const id of repo.noteMemoryIds()) {
      try {
        ctx.memory.forget(id);
      } catch (error) {
        ctx.log.debug('ortam notunun hafıza kopyası silinemedi', error);
      }
    }
    repo.deleteAll();
    ctx.attention.forgetModule?.(MODULE_ID);
    for (const entity of ['segment', 'note', 'issue', 'report', 'suggestion', 'interjection'] as const) {
      ctx.bus.emit('ambient.changed', { entity, op: 'deleted', ids: ['*'] });
    }
  },

  teardown() {
    const active = runtime;
    for (const off of subscriptions.splice(0)) off();
    if (!active) return;
    active.service.stop();
    // Modül Yönetim'den ya da kullanıcıca kapatıldıysa saklama görevi artık koşmaz; ham döküm bekletilmeden silinir.
    // (Uygulama kapanırken modül hâlâ izinlidir: o durumda dokunulmaz, süre dolunca açılışta silinir.)
    const disabled = !active.ctx.policy.moduleAllowed(MODULE_ID) || active.ctx.settings.get().disabledModules.includes(MODULE_ID);
    if (disabled) {
      const removed = active.service.purgeTranscript();
      if (removed) active.ctx.log.info(`ortam dinleme kapatıldı: ${removed} döküm satırı silindi`);
    }
    runtime = null;
    screenLocked = false;
  },
});
