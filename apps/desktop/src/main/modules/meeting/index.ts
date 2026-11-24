// Toplantı modu (KURGU §10.6). Açıkça başlatılır; ilk kullanımda rıza ekranı; ses saklanmaz, yalnız yazı. Yazıya
// çevirme ses hattının yerel Whisper'ıdır (ortam dinlemeyle aynı altyapı): modül sesi hiç görmez, `voice.meeting`
// olayıyla yazıya çevrilmiş söz bölütlerini alır.
import path from 'node:path';
import { addDays, dashboard, defineModule, fromLocal, localDay, localTime, t, UserError, type DashboardFill, type ModuleContext, type Unsubscribe } from '@fuber/shared';
import { deepBrainFor } from '../../core/brain/deep';
import { testing } from '../../testing';
import { CONTEXT_LIMITS } from './pure';
import { createMeetingRepo, MEETING_MIGRATIONS, type MeetingRepo } from './repo';
import { createMeetingService, MODULE_ID, type MeetingService } from './service';
import { createTools } from './tools';
import './types';
import type { MeetingDashboardData } from './types';

const RETENTION_TASK = 'meeting.retention';
export const MEETING_CARD_ID = 'meeting';
/** Son toplantının özeti panoda bu kadar gün kalır (eski toplantı sayfayı doldurmaz). */
const MEETING_CARD_DAYS = 7;
const RETENTION_TIME = '03:40';

interface Runtime {
  ctx: ModuleContext;
  repo: MeetingRepo;
  service: MeetingService;
}

let runtime: Runtime | null = null;
const subscriptions: Unsubscribe[] = [];
const ok = { ok: true as const };

function ensure(ctx: ModuleContext): Runtime {
  if (runtime) return runtime;
  const repo = createMeetingRepo(ctx.db);
  const service = createMeetingService({
    repo,
    bus: ctx.bus,
    voice: ctx.voice,
    brain: ctx.brain,
    policy: ctx.policy,
    settings: ctx.settings,
    tools: ctx.tools,
    attention: ctx.attention,
    log: ctx.log,
    deep: () => {
      try {
        return deepBrainFor(ctx);
      } catch {
        return null;
      }
    },
    now: () => new Date(),
    defer(run, ms) {
      const timer = setTimeout(run, ms);
      return () => clearTimeout(timer);
    },
  });
  runtime = { ctx, repo, service };
  return runtime;
}

function current(): Runtime {
  if (!runtime) throw new UserError(t('meeting.error.off'));
  return runtime;
}

/** Kokpit kartı: süren toplantı ya da son yedi günün son toplantısı. */
export function meetingCard(repo: Pick<MeetingRepo, 'get' | 'ended'>, activeId: string | null, now: Date = new Date()): DashboardFill<MeetingDashboardData> | null {
  const live = activeId ? repo.get(activeId) : null;
  const meeting = live ?? repo.ended(1)[0] ?? null;
  if (!meeting) return null;
  if (!live && now.getTime() - Date.parse(meeting.endedAt ?? meeting.startedAt) > MEETING_CARD_DAYS * 24 * 3600_000) return null;
  const summary = meeting.summary;
  return {
    data: {
      state: live ? 'live' : meeting.state,
      id: meeting.id,
      title: meeting.title,
      startedAt: meeting.startedAt,
      endedAt: meeting.endedAt,
      summary: summary
        ? { points: [...summary.points, ...summary.decisions].slice(0, 3).map((item) => item.text), decisions: summary.decisions.length, actions: summary.actions.length }
        : null,
      problem: meeting.summaryProblem,
    },
    ...(live ? { title: t('today.meeting.live') } : {}),
  };
}

/** Bugün `time` geçtiyse yarın, geçmediyse bugün. */
function nextAt(time: string): string {
  let due = fromLocal(localDay(), time);
  if (due.getTime() <= Date.now()) due = fromLocal(addDays(localDay(), 1), time);
  return due.toISOString();
}

/** Belgeyi belge modülünün okuyucusuyla metne çevirir (ayrı süreç, süre ve bellek sınırı, izinli klasör kapısı orada). */
async function readDocument(ctx: ModuleContext, requested: string | undefined): Promise<{ name: string; text: string; truncated: boolean } | null> {
  let file = requested?.trim() ?? '';
  if (!file) {
    // Sınamada işletim sistemi penceresi açılmaz.
    if (testing.enabled) return null;
    const { dialog } = await import('electron');
    const result = await dialog.showOpenDialog({ title: t('meeting.context.pick'), properties: ['openFile'], filters: [{ name: t('meeting.context.pick'), extensions: ['pdf', 'docx', 'txt', 'md'] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    file = result.filePaths[0];
  }
  if (!ctx.tools.has('document_read')) throw new UserError(t('meeting.error.documentsOff'));
  const result = await ctx.tools.run('document_read', { path: file }, { origin: { channel: 'ui', speakerVerified: null } });
  if (!result.ok) throw new UserError(result.text);
  const text = result.text.slice(0, CONTEXT_LIMITS.documentText + 1);
  return { name: path.basename(file), text: text.slice(0, CONTEXT_LIMITS.documentText), truncated: text.length > CONTEXT_LIMITS.documentText };
}

export default defineModule({
  id: MODULE_ID,
  version: '1.0.0',
  nameKey: 'module.meeting.name',
  descriptionKey: 'module.meeting.description',
  permissions: ['mic', 'notify'],
  migrations: MEETING_MIGRATIONS,
  windowEvents: ['meeting.status', 'meeting.changed'],

  tools: createTools(() => {
    const { service, repo, ctx } = current();
    return { service, repo, bus: ctx.bus, now: () => new Date() };
  }),

  ipc: (ctx) => {
    const { service, repo } = ensure(ctx);
    return {
      'meeting.status': () => service.status(),
      'meeting.consent': ({ accept }) => service.consent(accept === true),
      'meeting.start': (options) => service.begin(options ?? {}),
      'meeting.stop': () => service.end({ reason: 'user' }),
      'meeting.setContext': ({ context }) => service.setContext(context),
      'meeting.addDocument': async ({ path: file }) => {
        const active = service.status().active;
        if (!active) throw new UserError(t('meeting.error.notActive'));
        const document = await readDocument(ctx, file);
        if (!document) return service.status();
        const documents = [...active.context.documents.filter((item) => item.name !== document.name), document].slice(-CONTEXT_LIMITS.documents);
        return service.setContext({ documents });
      },
      'meeting.setOptions': (patch) => service.setOptions(patch),
      'meeting.list': ({ limit }) => repo.list(Math.max(1, Math.min(200, Math.round(Number(limit) || 20)))),
      'meeting.get': ({ id }) => {
        const meeting = repo.get(id);
        return meeting ? { meeting, lines: repo.lines(id), suggestions: repo.suggestions(id) } : null;
      },
      'meeting.summarize': ({ id }) => {
        if (id === service.activeId()) throw new UserError(t('meeting.error.stillLive'));
        return service.summarize(id);
      },
      'meeting.exportActions': ({ id, index }) => service.exportActions(id, index),
      'meeting.delete': ({ id }) => {
        service.deleteMeeting(id);
        return ok;
      },
      'meeting.deleteAll': () => {
        service.deleteAll();
        return ok;
      },
    };
  },

  async setup(ctx) {
    const { service, repo } = ensure(ctx);
    // Kokpit: toplantı sürüyorsa "sürüyor" kartı, yoksa son toplantının (son yedi gün) özeti; hiç yoksa kart çizilmez.
    // Pano her söz satırında değil, yalnız toplantı başlayıp bittiğinde ve özet yazıldığında yeniden dolar.
    subscriptions.push(dashboard.registerProvider<MeetingDashboardData>({ id: MEETING_CARD_ID, moduleId: MODULE_ID, title: t('today.meeting.title'), defaultSize: 'medium', priority: 84, page: 'meeting', fill: () => meetingCard(repo, service.activeId()) }));
    let lastActive: string | null = null;
    subscriptions.push(
      ctx.bus.on('meeting.changed', (change) => {
        if (change.kind === 'meeting') dashboard.invalidate(MEETING_CARD_ID);
      }),
      ctx.bus.on('meeting.status', (status) => {
        const active = status.active ? `${status.active.id}:${status.active.state}` : null;
        if (active === lastActive) return;
        lastActive = active;
        dashboard.invalidate(MEETING_CARD_ID);
      }),
    );
    subscriptions.push(ctx.scheduler.handle(RETENTION_TASK, () => service.runRetention()));
    const existing = ctx.scheduler.list(RETENTION_TASK).find((task) => task.key === 'daily');
    if (!existing || localTime(existing.dueAt) !== RETENTION_TIME) {
      ctx.scheduler.schedule({ kind: RETENTION_TASK, key: 'daily', dueAt: nextAt(RETENTION_TIME), recurrence: { freq: 'daily', interval: 1 }, payload: {} });
    }
    service.start();
  },

  // Modül kapalıyken de kullanıcı toplantı kayıtlarını silebilir (Ayarlar › Gizlilik).
  purge(ctx) {
    if (runtime) {
      runtime.service.deleteAll();
      return;
    }
    createMeetingRepo(ctx.db).deleteAll();
    ctx.attention.forgetModule?.(MODULE_ID);
    ctx.bus.emit('meeting.changed', { kind: 'meeting', meetingId: '*' });
  },

  teardown() {
    for (const off of subscriptions.splice(0)) off();
    runtime?.service.stop();
    runtime = null;
  },
});
