// İşler modülü (G5): gözcülü arka plan işleri. "Şu sayfayı takip et, fiyat düşünce söyle", "Claude bitirince haber
// ver", "şu klasöre dosya gelince söyle", "saat beşte şu sayfaya bak". Plan → TEK onay kartı → arka planda gözcü.
// Gözcü yapay zekâsızdır (karşılaştırma, düzenli ifade, sayı, imza); model yalnız `ask` koşulunda ve yalnız içerik
// DEĞİŞTİĞİNDE çağrılır. Haber Dikkat Yöneticisi'nden geçer (ada, ses, toast; toplantı/oyun kuralları onun).
// Acil durdurma bütün gözcüleri duraklatır; modül politikadan kapanınca gözcüler durur, açılınca kaldıkları yerden sürer.
import { dashboard, DASHBOARD_CARD_IDS, defineModule, t, UserError, type JobsItem, type ModuleContext, type ToolOrigin, type Unsubscribe } from '@fuber/shared';
import { z } from 'zod';
import { testing } from '../../testing';
import { clipText, shortId, statusSentence } from './describe';
import { checkUrl, createSafeFetch, isPublicAddress, safeFetch } from '../web/net';
import { createWatchEngine, type Judge, type WatchEngine } from './engine';
import { WATCH_MIGRATIONS, createWatchRepo } from './repo';
import { claudeSource, fileSource, pageSource, timeSource, windowSource } from './sources';
import { createTools } from './tools';
import type { WatchJob, WatchSourceDef } from './types';
import type { BrainService } from '../../core/brain';
import './types';

export const MODULE_ID = 'watch';

interface Runtime {
  ctx: ModuleContext;
  engine: WatchEngine;
  dispose(): void;
}

let runtime: Runtime | null = null;
const subscriptions: Unsubscribe[] = [];
/** Sınama: modelin yerine geçen karar verici (`__fuber2Test.watch.setJudge`). Üretimde hiç atanmaz. */
let judgeOverride: Judge | null = null;
let attachedBrain: Partial<BrainService> | null = null;

/** Süren takip işlerinin öz-durumdaki tek satırlık hali: "Takip: <başlık> (duraklatıldı)". */
export function describeRunning(jobs: readonly Pick<WatchJob, 'title' | 'status'>[]): string[] {
  return jobs.map((job) => `Takip: ${job.title}${job.status === 'paused' ? ' (duraklatıldı)' : ''}`);
}

/** Takip işinin Kokpit "Süren işler" satırı: dokununca İşler sayfası açılır; alt satır bulguyu ya da durumu söyler. */
export function dashboardItem(job: WatchJob, now: Date = new Date()): JobsItem {
  return {
    id: `watch:${job.id}`,
    title: job.title,
    moduleId: MODULE_ID,
    status: job.status === 'paused' ? 'paused' : 'running',
    startedAt: job.createdAt,
    page: 'watch',
    detail: job.finding && job.status === 'running' ? clipText(job.finding, 140) : statusSentence(job, now),
    tag: `#${shortId(job.id)}`,
  };
}

const JUDGE_SCHEMA = z.object({
  match: z.boolean().describe('Koşul şimdi gerçekleşti mi'),
  finding: z.string().max(300).describe('Kullanıcıya söylenecek tek kısa cümle: ne oldu'),
});

/** Modelin kararı: içerik güvenilmez veri olarak çerçevelenir; içindeki yönergeler talimat değildir. */
function brainJudge(ctx: ModuleContext): Judge {
  // Değişiklik anlatımı da içerikten türer (yeni satırlar): o da çerçevenin İÇİNDE ve kaçırılmış olarak gider.
  const fence = (value: string) => value.split('<<<').join('‹‹‹').split('>>>').join('›››');
  return async ({ question, text, change, signal }) => {
    const body = text.length > 6000 ? `${text.slice(0, 6000)}…` : text;
    return ctx.brain.extract({
      instructions: t('watch.judge.instructions'),
      input: `${t('watch.judge.question')}: ${fence(question)}\n${t('watch.judge.begin')}\n${t('watch.judge.change')}: ${fence(change)}\n---\n${fence(body)}\n${t('watch.judge.end')}`,
      schema: JUDGE_SCHEMA,
      signal,
    });
  };
}

/** Sayfa gözcüsünün ağ kapısı. Sınamada yalnız geri döngü (127.0.0.1) ek olarak açılır; özel ağ yine kapalı. */
function pageNet() {
  if (!testing.watchLoopback) return { fetcher: safeFetch, checkTarget: undefined };
  const isAllowed = (address: string) => isPublicAddress(address) || address === '127.0.0.1' || address === '::1';
  return { fetcher: createSafeFetch({ isAllowed, isPortAllowed: () => true }), checkTarget: (url: string) => checkUrl(url, isAllowed, () => true) };
}

function ensure(ctx: ModuleContext): Runtime {
  if (runtime) return runtime;
  const now = () => Date.now();
  const repo = createWatchRepo(ctx.db);
  const net = pageNet();
  const jobOrigin = (jobId?: string): ToolOrigin => ({ channel: 'job', speakerVerified: null, ...(jobId ? { jobId } : {}) });
  const claude = claudeSource(ctx.bus, now);
  const builtins: WatchSourceDef[] = [
    timeSource(now),
    pageSource({ fetcher: net.fetcher, networkAllowed: () => ctx.policy.networkAllowed(), ...(net.checkTarget ? { checkTarget: net.checkTarget } : {}) }),
    // Sınamada "İndirilenler" gibi klasör adları gerçek profile değil belge modülünün sınama evine çözülür.
    fileSource({ dataDir: ctx.paths.data, ...(testing.documentsHome ? { home: testing.documentsHome } : {}) }),
    windowSource({ tools: ctx.tools, origin: () => jobOrigin() }),
    claude,
  ];
  const engine = createWatchEngine({
    repo,
    sources() {
      // Takılı kaynaklar her seferinde yeniden toplanır: sahibi modül kapanınca dinleyicisi kalkar, kaynak düşer.
      const box: { sources: WatchSourceDef[] } = { sources: [] };
      try {
        ctx.bus.emit('watch.sources.collect', box);
      } catch (error) {
        ctx.log.warn('takılı kaynaklar toplanamadı', error);
      }
      const known = new Set(builtins.map((source) => source.kind));
      return [...builtins, ...box.sources.filter((source) => source && typeof source.check === 'function' && !known.has(source.kind))];
    },
    judge: (input) => (judgeOverride ?? brainJudge(ctx))(input),
    notify: (request) => ctx.attention.notify(request),
    appendChat: (sessionId, channel, text) => ctx.conversation.appendMessage({ sessionId, role: 'assistant', text, channel }),
    async runAction(action, job, signal) {
      const info = ctx.tools.list().find((tool) => tool.name === action.tool);
      if (!info) return { ok: false, text: t('watch.action.missing', { tool: action.tool }) };
      // Yazan araç her seferinde YENİDEN onay ister (iş onayı yalnız okumayı kapsar). `danger` aracı kapı kendisi sorar.
      if (info.risk === 'write') {
        const decision = await ctx.tools.requestApproval({
          toolName: action.tool,
          moduleId: MODULE_ID,
          summary: t('watch.action.approval', { title: job.title, tool: action.tool }),
          input: action.input,
          origin: jobOrigin(job.id),
          kind: 'other',
        });
        if (decision !== 'approved') return { ok: false, text: t('watch.action.denied') };
      }
      return ctx.tools.run(action.tool, action.input, { origin: jobOrigin(job.id), signal });
    },
    killSwitchActive: () => ctx.policy.killSwitchActive(),
    maxActive: () => {
      const value = Number(ctx.policy.moduleConfig(MODULE_ID).maxActive);
      return Number.isFinite(value) && value > 0 ? value : 3;
    },
    emit: (job, op, id) => ctx.bus.emit('watch.changed', { entity: 'job', op, ids: [id], job }),
    log: ctx.log,
    now,
    setTimer: (run, ms) => {
      const timer = setTimeout(run, ms);
      timer.unref?.();
      return timer;
    },
    clearTimer: (handle) => clearTimeout(handle as NodeJS.Timeout),
  });
  runtime = { ctx, engine, dispose: () => claude.dispose() };
  return runtime;
}

function current(): Runtime {
  if (!runtime) throw new UserError(t('watch.error.off'));
  return runtime;
}

export default defineModule({
  id: MODULE_ID,
  version: '1.0.0',
  nameKey: 'module.watch.name',
  descriptionKey: 'module.watch.description',
  // `net` bilerek yazılmadı: araç kapısı Gizli kipte `net` izinli modülün BÜTÜN araçlarını kapatır; o zaman dosya ve
  // Claude Code işleri de listelenemez, iptal edilemezdi. Ağ kararı sayfa kaynağının kendisindedir (`networkAllowed`).
  permissions: ['fs', 'screen', 'notify'],
  migrations: WATCH_MIGRATIONS,
  windowEvents: ['watch.changed'],

  tools: createTools(() => ({ engine: current().engine, now: () => Date.now() })),

  ipc: (ctx) => {
    const { engine } = ensure(ctx);
    return {
      'watch.list': ({ status, limit }) => engine.list({ ...(status?.length ? { status } : {}), limit: Math.max(1, Math.min(200, limit ?? 100)) }),
      'watch.get': ({ id }) => {
        const job = engine.get(id);
        if (!job) throw new UserError(t('watch.error.notFound'));
        return job;
      },
      'watch.sources': () => engine.sources(),
      'watch.pause': ({ id }) => engine.pause(id, 'user'),
      'watch.resume': ({ id }) => engine.resume(id),
      'watch.cancel': ({ id }) => engine.cancel(id),
      'watch.remove': ({ id }) => {
        engine.remove(id);
        return { ok: true as const };
      },
      'watch.checkNow': ({ id }) => engine.checkNow(id),
    };
  },

  setup(ctx) {
    const { engine } = ensure(ctx);
    subscriptions.push(
      // Acil durdurma (kısayol, ada, tepsi) ve Yönetim'in acil durdurması bütün gözcüleri duraklatır.
      ctx.bus.on('app.panic', () => {
        const count = engine.pauseAll('panic');
        if (count) ctx.log.info(`acil durdurma: ${count} iş duraklatıldı`);
      }),
      ctx.bus.on('policy.changed', () => {
        if (ctx.policy.killSwitchActive()) engine.pauseAll('policy');
      }),
      ctx.bus.on('attention.action', ({ moduleId, actionId }) => {
        if (moduleId === MODULE_ID && actionId === 'watch.open') ctx.bus.emit('app.navigate', { page: 'watch' });
      }),
      // Kokpit: süren ve duraklatılmış takip işleri panonun "Süren işler" kartına katılır (ayrı kart yok; süren iş
      // yoksa katkı yok, başka süren iş de yoksa kart çizilmez). Modüller birbirini içe aktarmaz: yol olaydır.
      ctx.bus.on('dashboard.jobs.collect', (box) => {
        for (const job of engine.list({ status: ['running', 'paused'], limit: 6 })) box.items.push(dashboardItem(job));
      }),
      ctx.bus.on('watch.changed', () => dashboard.invalidate(DASHBOARD_CARD_IDS.jobs)),
    );
    testing.expose({
      watch: {
        engine,
        setJudge(judge: Judge | null) {
          judgeOverride = judge;
        },
      },
    });
    engine.start();
    // Öz-durum: süren takip işleri beynin durum bloğuna girer ("işlerim ne durumda" uydurulmadan yanıtlanır).
    const brain = ctx.brain as Partial<BrainService>;
    try {
      brain.attachSelfPart?.(MODULE_ID, () => ({ work: describeRunning(engine.list({ status: ['running', 'paused'], limit: 20 })) }));
      attachedBrain = brain;
    } catch (error) {
      ctx.log.debug(`öz-durum parçası bağlanamadı: ${error instanceof Error ? error.message : String(error)}`);
    }
  },

  purge(ctx) {
    if (runtime) {
      for (const job of runtime.engine.list({ limit: 500 })) runtime.engine.remove(job.id);
    } else {
      createWatchRepo(ctx.db).removeAll();
    }
    ctx.attention.forgetModule?.(MODULE_ID);
    ctx.bus.emit('watch.changed', { entity: 'job', op: 'deleted', ids: ['*'], job: null });
  },

  teardown() {
    for (const off of subscriptions.splice(0)) off();
    // Katkı dinleyicisi kalktı: panonun "Süren işler" kartı takip işleri olmadan yeniden dolsun.
    dashboard.invalidate(DASHBOARD_CARD_IDS.jobs);
    try {
      attachedBrain?.attachSelfPart?.(MODULE_ID, null);
    } catch {
      // Beyin yer tutucusu: bağlanan bir şey yoktu.
    }
    attachedBrain = null;
    if (!runtime) return;
    runtime.engine.stop();
    runtime.dispose();
    runtime = null;
    judgeOverride = null;
  },
});
