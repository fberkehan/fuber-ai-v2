/**
 * Bileşim kökü: bütün servisleri fabrikalarından, bağımlılık tablosundaki sırayla kurar
 * (`@fuber/shared` › `services.ts`), IPC işleyicilerini ve yerleşik modülleri bağlar, servisleri başlatır.
 * Servisler birbirini burada tanır; başka hiçbir dosya bir servisi kendisi kurmaz.
 *
 * Dayanıklılık kuralı: çekirdek dışındaki bir servisin kurulamaması ya da başlatılamaması açılışı durdurmaz.
 * O servis "henüz uygulanmadı" yer tutucusuna düşer ya da başlatılmamış kalır; ilgili özellik hazır değil görünür.
 */

import path from 'node:path';
import {
  nowIso,
  t,
  WINDOW_EVENTS,
  type HotkeysApi,
  type Services,
  type WindowEvents,
} from '@fuber/shared';
import { createAttention } from './core/attention';
import { createBrain, type BrainService } from './core/brain';
import { createLlmServer } from './core/brain/llm-server';
import { createClaudeCodeBrain } from './core/brain/providers/claude-code';
import { createBus } from './core/bus';
import { createConversation } from './core/conversation';
import { createHotkeys } from './core/hotkeys';
import { createJobs } from './core/jobs';
import { createLogger } from './core/log';
import { createMemory } from './core/memory';
import { createModules } from './core/modules';
import { createPaths } from './core/paths';
import { controlLinkOf, createPolicy } from './core/policy';
import { createPresence, presenceDiagnostics } from './core/presence';
import { createScheduler } from './core/scheduler';
import { createSettings } from './core/settings';
import { createStage } from './core/stage';
import { createStore, storeRecovery } from './core/store';
import { notImplemented } from './core/stub';
import { createTools } from './core/tools';
import { createUsage, type UsageUploadQueue } from './core/usage';
import { ipcHandlers } from './ipc/handlers/index.gen';
import { createRouter, type IpcRouter } from './ipc/router';
import { builtinModules } from './modules/registry.gen';
import { testing } from './testing';
import { createVoice, type VoiceService } from './voice/index';
import { createModels } from './voice/models';
import { bindSttVocabulary } from './voice/vocabulary';
import { createWindows, windowsRuntime } from './windows/index';

export interface App {
  services: Services;
  router: IpcRouter;
  /** Servisleri sırayla başlatır. Birinin hatası diğerlerini durdurmaz; yalnız günlüğe yazılır. */
  start(): Promise<void>;
  /** Kurulamayan ya da başlatılamayan servislerin adları (tanı için). */
  notReady(): string[];
  /** Servisleri ters sırayla durdurur ve veritabanını kapatır. */
  shutdown(): Promise<void>;
}

/** Sınamada genel kısayol kaydı kapalıdır; servis yerine hiçbir şey kaydetmeyen bu nesne kullanılır. */
const disabledHotkeys: HotkeysApi = {
  start() {},
  stop() {},
  status: () => [],
  rebind: (id, accelerator) => ({ id, accelerator, registered: false }),
};

export async function bootstrap(): Promise<App> {
  // ── kurulum: tablo sırası ──
  // Çekirdek (yollar, günlük, olay yolu, depo, ayar, politika) kurulamazsa uygulama açılamaz: hata yukarı çıkar.
  const paths = createPaths();
  const log = createLogger({ paths });
  const bus = createBus({ log });
  const store = createStore({ paths, log });
  const settings = testing.wrapSettings(createSettings({ store, bus, log }));
  const policy = testing.wrapPolicy(createPolicy({ paths, store, settings, bus, log }));

  const failed = new Set<string>();
  let started = false;
  /** Çekirdek dışı servisi kurar; fabrika fırlatırsa yer tutucuya düşer ki açılış sürsün. */
  const build = <T extends object>(name: string, factory: () => T): T => {
    try {
      return factory();
    } catch (error) {
      failed.add(name);
      log.error(`kurulum: ${name} servisi kurulamadı; ilgili özellik hazır değil`, error);
      return notImplemented<T>(name);
    }
  };

  const usage = build('usage', () => createUsage({ store, policy, bus, log }));
  // Kullanım kayıtlarının kontrol servisine tek yolu: `usage`'ın kalıcı kuyruğu → politika istemcisi.
  if (!failed.has('usage')) controlLinkOf(policy)?.attachUsageQueue(usage as typeof usage & UsageUploadQueue);
  const measuredPresence = createPresence({ settings, bus, log });
  const presence = testing.wrapPresence(measuredPresence, bus);
  const windows = createWindows({ paths, settings, presence, bus, log });
  const router: IpcRouter = createRouter({
    onError(channel, error) {
      // Bağlı olmayan kanal bir hata yığını değil, tek satırlık uyarıdır (servisi hazır olmayan özellik çağrıldı).
      if (router.channels().includes(channel)) log.error(`ipc: ${channel}`, error);
      else log.warn(`ipc: ${channel || '(adsız)'} kanalı bağlı değil`);
    },
  });
  const models = build('models', () => createModels({ paths, policy, bus, log }));
  const attention = build('attention', () => createAttention({ store, policy, presence, settings, bus, log }));
  const memory = build('memory', () => createMemory({ store, bus, log }));
  const scheduler = build('scheduler', () => createScheduler({ store, bus, log }));
  const jobs = build('jobs', () => createJobs({ store, bus, log }));
  const stage = build('stage', () => createStage({ bus, log }));
  const tools = createTools({ store, policy, settings, stage, bus, log });
  // Sesli tur sürüyor mu (dinleme / düşünme / konuşma): yerel beynin boşta kapatması bu sırada ertelenir ki ekran belleği
  // tam kullanıcı konuşurken bırakılıp hemen yeniden yüklenmesin (ses konağını işlemciye düşüren aç-kapa savaşı).
  let voiceGpuBusy = false;
  bus.on('voice.state', ({ state }) => {
    voiceGpuBusy = state === 'listening' || state === 'thinking' || state === 'speaking' || state === 'followup';
  });
  // Yerel beynin sunucusu (llama-server): dosyalarının yerini model yöneticisi bilir, süreci bu nesne yönetir.
  // Burada kurulur ki kapanışta durdurulabilsin. Dosyalar yoksa beyin "yerel model kurulu değil" der; açılış etkilenmez.
  const localServer = failed.has('models') ? null : createLlmServer({ log: log.child('brain'), policy, models, voiceBusy: () => voiceGpuBusy });
  // "Yerel modelle çalışıyorum" duyurusu günde en çok bir kez söylenir; gün, uygulama yeniden başlasa da hatırlansın diye depodadır.
  const brainKv = store.kv('brain');
  const noticeDay = { get: () => brainKv.get<string>('noticeDay') ?? null, set: (day: string) => brainKv.set('noticeDay', day) };
  // Konuşan beyin olarak Claude Code (bu bilgisayardaki CLI, kullanıcının aboneliği): süreçlerini bu nesne yönetir.
  // Sınamada `FUBER2_CLAUDE_CLI` verilmediyse Claude Code yok sayılır (geliştiricinin kotasından harcanmaz).
  const claudeCode = createClaudeCodeBrain({ log: log.child('brain') }, { cli: testing.claudeCli, workDir: path.join(paths.temp, 'claude-beyin') });
  const brain = build('brain', () => createBrain({ policy, tools, memory, usage, presence, bus, log }, { localServer, noticeDay, claudeCode }));
  const conversation = build('conversation', () => createConversation({ store, brain, bus, log }));
  const voice = build<VoiceService>('voice', () =>
    createVoice({ policy, settings, models, tools, brain, conversation, usage, windows, paths, bus, log }, testing.voiceOptions),
  );
  const hotkeys = testing.hotkeys ? createHotkeys({ settings, bus, log }) : disabledHotkeys;

  const base = {
    paths,
    log,
    bus,
    store,
    settings,
    policy,
    usage,
    presence,
    windows,
    ipc: router,
    models,
    attention,
    memory,
    scheduler,
    jobs,
    stage,
    tools,
    brain,
    conversation,
    voice,
    hotkeys,
  };
  const modules = createModules(base);
  // Öz-tanım modülleri modül kaydından okur (açık/kapalı ve nedeni); beyin kurulamamışsa (yer tutucu) bağlama atlanır.
  (brain as Partial<BrainService>).attachModuleCatalog?.(() => modules.list());
  const services: Services = { ...base, modules };

  /** Bir adımı koşturur; hata verirse günlüğe yazar ve sürer. */
  const attempt = async (phase: string, name: string, work: () => unknown): Promise<void> => {
    try {
      await work();
    } catch (error) {
      failed.add(name);
      log.error(`${phase}: ${name} başarısız; ilgili özellik hazır değil`, error);
    }
  };

  // ── bağlama ──
  for (const handler of ipcHandlers) {
    // Bir işleyici dosyasının hatası (ör. aynı kanalın iki yerden bağlanması) diğer kanalları düşürmez.
    await attempt('ipc bağlama', `ipc/${handler.name}`, () => handler.register(router, services));
  }

  // Olay yolundan pencerelere: çekirdek liste. Modüllerin kendi olaylarını modül kaydı aktarır.
  const forwarded = new Set<string>(WINDOW_EVENTS);
  bus.onAny((type, payload) => {
    if (forwarded.has(type)) windows.broadcast(type as keyof WindowEvents, payload as never);
  });

  bus.on('hotkey.pressed', ({ id }) => {
    if (id === 'panic') bus.emit('app.panic', { at: nowIso(), source: 'hotkey' });
  });
  bus.on('app.panic', () => {
    // Ses ve araç kaydı `app.panic`'i kendisi dinler; arka plan işleri burada kesilir.
    void attempt('acil durdur', 'jobs', () => jobs.cancelAll());
  });
  bus.on('policy.changed', () => void modules.sync());

  /**
   * Yerel modellerin eksikleri bu bilgisayardaki bilinen kaynaklardan (önceden hazırlanmış önbellek, Fuber AI 1'in
   * indirdikleri) kendiliğinden yerleştirilir: kurulum sihirbazı olmadan da ilk açılışta ses ve yerel beyin hazır olur.
   * Kaynağı olmayan dosya "indirme gerekiyor" durumunda kalır; uygulama yine açılır.
   */
  const prepareModels = () =>
    attempt('modeller', 'models', () => {
      const missing = models.status().filter((item) => item.status !== 'ready').map((item) => item.id);
      if (missing.length > 0) models.download(missing);
    });
  bus.on('policy.changed', ({ changedKeys }) => {
    if (started && changedKeys.includes('localModels')) void prepareModels();
  });

  let unbindVocabulary: (() => void) | null = null;

  /**
   * Sesli turları yerel beyin yürütecekse (anahtar yok ya da ses rolü yerelde) model, ses hattı ilk hazır olduğunda
   * belleğe alınır. Ölçüm: uyandırma sezici yoluyla olunca yükleme (≈2,3 sn) kullanıcının sözünün arkasına saklanıyor
   * (son ses → ilk ses ≈1,1 sn); Whisper yolunda uyanma ancak söz bittikten sonra anlaşıldığı için soğuk modelde ilk
   * ses ≈3,6 sn'ye çıkıyor. Açılışta ısıtmak günün ilk "Hey Jarvis"ini bu beklemeden kurtarır; sunucu boşta kalınca
   * kendiliğinden kapanır.
   *
   * Bulut anahtarı varken de bir kez ısıtılır (tek, çıktısız istek): hesapta kredi yoksa ya da anahtar geçersizse bu
   * AÇILIŞTA anlaşılır, beyin şimdiden yerele geçer ve rozet doğruyu gösterir; ilk tur buluta gidip dönmeyi beklemez.
   */
  let warmedOnce = false;
  bus.on('voice.status', ({ ready }) => {
    if (!ready || warmedOnce) return;
    warmedOnce = true;
    if (!failed.has('brain')) void attempt('ısıtma', 'brain-prewarm', () => brain.prewarm('voice'));
  });
  bus.on('app.killSwitch', ({ active }) => {
    if (!active) return;
    // Araç kapısı kendini kapatır; süren konuşma ve arka plan işleri de burada kesilir.
    void attempt('acil durdurma', 'voice', () => voice.cancelTurn());
    void attempt('acil durdurma', 'jobs', () => jobs.cancelAll());
  });

  const runtime = windowsRuntime(windows);
  testing.expose({ services, router, windowsRuntime: runtime, presenceDiagnostics: () => presenceDiagnostics(measuredPresence) });

  return {
    services,
    router,
    notReady: () => [...failed].sort(),

    async start() {
      if (started) return;
      started = true;
      await attempt('başlatma', 'policy', () => policy.start());
      await attempt('başlatma', 'presence', () => presence.start());
      // Tepsi ve HUD, uzun sürebilen ses başlangıcından önce hazır olur.
      await attempt('başlatma', 'windows', () => runtime.start());
      await attempt('başlatma', 'scheduler', () => scheduler.start());
      await attempt('başlatma', 'attention', () => attention.start());
      await attempt('başlatma', 'hotkeys', () => hotkeys.start());
      await attempt('başlatma', 'modules', () => modules.loadBuiltins(builtinModules));
      await prepareModels();
      await attempt('başlatma', 'voice', () => voice.start());
      if (!failed.has('voice')) {
        unbindVocabulary = bindSttVocabulary({
          bus,
          log,
          sources: {
            projects: () => router.local('projects.list', {}),
          },
          apply: (words) => voice.setSttVocabulary(words),
        });
      }

      const recovery = storeRecovery(store);
      if (recovery) {
        bus.emit('store.recovered', recovery);
        await attempt('bildirim', 'attention', () =>
          attention.notify({
            moduleId: 'core',
            title: t('store.recovered.title'),
            body: t('store.recovered.body'),
            priority: 'high',
            dedupeKey: 'core.store.recovered',
          }),
        );
      }
      log.info(failed.size > 0 ? `açılış tamam; hazır olmayanlar: ${[...failed].sort().join(', ')}` : 'açılış tamam');
    },

    async shutdown() {
      const steps: Array<[string, () => unknown]> = [
        ['vocabulary', () => unbindVocabulary?.()],
        ['voice', () => voice.stop()],
        ['brain', () => localServer?.stop()],
        ['claude-code', () => claudeCode.dispose()],
        ['modules', () => modules.stopAll()],
        ['tools', () => tools.cancelAll()],
        ['hotkeys', () => hotkeys.stop()],
        ['attention', () => attention.stop()],
        ['scheduler', () => scheduler.stop()],
        ['windows', () => runtime.stop()],
        ['presence', () => presence.stop()],
        ['policy', () => policy.stop()],
        ['store', () => store.close()],
      ];
      for (const [name, stop] of steps) await attempt('kapanış', name, stop);
    },
  };
}
