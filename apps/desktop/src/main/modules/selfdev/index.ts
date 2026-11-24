// Çekirdek kendini geliştirme (Katman 2, KURGU §10.13): eklentiyle yapılamayan isteklerde Jarvis kendi KAYNAK kodunu Claude Code
// ile ayrı bir git worktree'sinde değiştirir; plan → uygula → sına ⇄ düzelt → paketle → "kurayım mı?" → açık onayla kur →
// yeniden başlat → sağlık denetimi → (gerekirse) önceki sürüme dön. Yalnız "geliştirici kipi" açıkken çalışır
// (politika `developer.enabled` + cihaz `developerMode` + `developerRepoPath`).
import { defineModule, t, type ModuleContext, type ToolOrigin } from '@fuber/shared';
import { testing } from '../../testing';
import type { BrainService } from '../../core/brain';
import { validateRepo } from './gate';
import { createSelfdevService, MODULE_ID, type SelfdevService } from './service';
import { runtime, selfdevTools } from './tools';
import { createSelfdevStore, SELFDEV_MIGRATIONS } from './store';
import type { SelfdevRun } from './types';
import './types';

const USER_CHANNELS: ReadonlySet<string> = new Set(['voice', 'chat', 'ui']);
const UI_ORIGIN: ToolOrigin = { channel: 'ui', speakerVerified: null };

let service: SelfdevService | null = null;
let attachedBrain: Partial<BrainService> | null = null;
const subscriptions: Array<() => void> = [];

/** Beynin öz-durumuna giren satırlar: Jarvis kendini bilsin. */
function selfLines(svc: SelfdevService): { work: string[]; canChange: string[]; cannotChange: string[] } {
  const gate = svc.gate();
  const status = svc.status();
  const work: string[] = [];
  const stage = (run: SelfdevRun): string => t(`selfdev.status.${run.status}` as never);
  if (status.active) work.push(t('selfdev.self.active', { stage: stage(status.active), request: status.active.request.slice(0, 80) }));
  if (status.ready) work.push(t('selfdev.self.ready', { version: status.ready.version ?? '?', count: status.ready.files.length }));
  if (status.healthFailed) work.push(t('selfdev.self.healthFailed'));
  return {
    work,
    canChange: gate.open ? [t('selfdev.self.canChange')] : [],
    cannotChange: gate.open ? [] : [t('selfdev.self.cannotChange', { reason: gate.reason ?? '' })],
  };
}

export default defineModule({
  id: MODULE_ID,
  version: '1.0.0',
  nameKey: 'module.selfdev.name',
  descriptionKey: 'module.selfdev.description',
  permissions: [],
  windowEvents: ['selfdev.changed'],
  migrations: SELFDEV_MIGRATIONS,
  tools: selfdevTools,

  ipc: (ctx) => ({
    'selfdev.status': () => {
      if (!service) throw new Error(t('selfdev.tool.notReady'));
      return service.status();
    },
    'selfdev.runs': ({ limit }) => service?.store.listRuns(Math.min(Math.max(limit, 1), 100)) ?? [],
    'selfdev.run': ({ id }) => {
      const run = service?.store.getRun(id);
      return run && service ? { run, events: service.store.events(id) } : null;
    },
    // Arayüz düğmeleri araçlarla AYNI kapılardan geçer (`ctx.tools.run`): kapı, onay kartları ve ikinci onay aynen işler.
    'selfdev.start': async ({ request, reason }) => {
      const result = await ctx.tools.run('core_develop', { request, reason: reason?.trim() || t('selfdev.ui.defaultReason') }, { origin: UI_ORIGIN });
      const data = result.data as { runId?: string | null } | undefined;
      return { ok: result.ok, text: result.text, ...(data?.runId ? { runId: data.runId } : {}) };
    },
    'selfdev.cancel': async () => {
      const result = await ctx.tools.run('core_cancel', {}, { origin: UI_ORIGIN });
      return { ok: result.ok, text: result.text };
    },
    'selfdev.install': async ({ run }) => {
      const result = await ctx.tools.run('core_install', run ? { run } : {}, { origin: UI_ORIGIN });
      return { ok: result.ok, text: result.text };
    },
    'selfdev.rollback': async () => {
      const result = await ctx.tools.run('core_rollback', {}, { origin: UI_ORIGIN });
      return { ok: result.ok, text: result.text };
    },
    'selfdev.checkRepo': async ({ path }) => {
      const check = validateRepo(path, [ctx.paths.data]);
      return { ok: check.ok, reason: check.ok ? null : check.reason };
    },
  }),

  setup(ctx) {
    service = createSelfdevService(ctx);
    runtime.service = service;
    const svc = service;
    const refresh = (): void => ctx.bus.emit('selfdev.changed', { runId: null, status: null });

    subscriptions.push(
      ctx.bus.on('policy.changed', refresh),
      ctx.bus.on('settings.changed', refresh),
      // Atölye: "bu eklentiyle yapılamıyor". Geliştirici kipi açıksa kullanıcıya onay kartı, kapalıysa bildirim.
      ctx.bus.on('selfdev.escalate', ({ request, reason, origin }) => {
        void escalate(ctx, svc, request, reason, origin);
      }),
      ctx.bus.on('attention.action', ({ moduleId, actionId }) => {
        if (moduleId !== MODULE_ID) return;
        if (actionId === 'selfdev.open') ctx.bus.emit('app.navigate', { page: 'development' });
        else if (actionId === 'selfdev.install') void ctx.tools.run('core_install', {}, { origin: UI_ORIGIN });
        else if (actionId === 'selfdev.rollback') void ctx.tools.run('core_rollback', {}, { origin: UI_ORIGIN });
      }),
      // Acil durdurma: süren çekirdek koşusu da durur (iş iptali zaten kurulumu başlatmaz).
      ctx.bus.on('app.panic', () => {
        void svc.engine.cancel();
      }),
    );

    // Öz-durum: Jarvis çekirdek geliştirmenin açık/kapalı olduğunu ve süren koşuyu bilir.
    const brain = ctx.brain as Partial<BrainService>;
    try {
      brain.attachSelfPart?.(MODULE_ID, () => selfLines(svc));
      attachedBrain = brain;
    } catch (error) {
      ctx.log.debug(`öz-durum parçası bağlanamadı: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Açılış: yarıda kalan koşular kapanır, bekleyen güncelleme sağlık denetimine bağlanır.
    try {
      svc.engine.onStartup();
    } catch (error) {
      ctx.log.error('açılış denetimi başarısız', error);
    }
    testing.expose({ selfdev: { service: svc } });
  },

  teardown() {
    for (const off of subscriptions.splice(0)) off();
    try {
      attachedBrain?.attachSelfPart?.(MODULE_ID, null);
    } catch {
      // bağlı bir şey yoktu
    }
    attachedBrain = null;
    service?.engine.dispose();
    service = null;
    runtime.service = null;
  },

  purge(ctx) {
    // Yalnız kayıtlar silinir; sürüm paketleri ve anlık kopyalar disktedir ve kurulu sürümün geri alma yoludur.
    createSelfdevStore(ctx.db).clear();
    ctx.attention.forgetModule?.(MODULE_ID);
  },
});

/** Yükseltme: eklentiyle yapılamayan istek → onay kartı (kapıdan geçerse) → koşu. */
async function escalate(ctx: ModuleContext, svc: SelfdevService, request: string, reason: string, origin: ToolOrigin): Promise<void> {
  // Yalnız kullanıcının kendi isteği: dış içerik, iş ve eklenti kökenli yükseltme yok sayılır.
  if (!USER_CHANNELS.has(origin.channel) || origin.speakerVerified === false) {
    ctx.log.info(`yükseltme yok sayıldı: köken ${origin.channel}`);
    return;
  }
  const gate = svc.gate();
  if (!gate.open) {
    ctx.attention.notify({
      moduleId: MODULE_ID,
      title: t('selfdev.escalate.closedTitle'),
      body: t('selfdev.escalate.closedBody', { reason: gate.reason ?? '' }),
      priority: 'normal',
      speak: t('selfdev.escalate.closedSpeak', { reason: gate.reason ?? '' }),
      dedupeKey: 'selfdev.escalate.closed',
      actions: [{ id: 'selfdev.open', label: t('selfdev.action.open') }],
    });
    return;
  }
  const decision = await ctx.tools.requestApproval({
    toolName: 'core_develop',
    moduleId: MODULE_ID,
    summary: t('selfdev.escalate.ask', { reason: reason.slice(0, 220) }),
    input: { request: request.slice(0, 500), reason: reason.slice(0, 300) },
    origin,
  });
  if (decision !== 'approved') return;
  const outcome = svc.engine.start({ request, reason, origin: 'escalate' });
  if (!outcome.ok) {
    ctx.attention.notify({ moduleId: MODULE_ID, title: t('selfdev.escalate.failedTitle'), body: outcome.text, priority: 'normal', dedupeKey: 'selfdev.escalate.failed' });
  }
}

