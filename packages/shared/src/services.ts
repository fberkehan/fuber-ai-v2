/**
 * Çekirdek servis ARAYÜZLERİ (KURGU §4.1). Uygulamalar `apps/desktop/src/main/` altındadır;
 * herkes yalnız bu arayüzlere göre yazar.
 *
 * Fabrika kuralı: her servis `createX(deps: Deps<...>): XApi` biçiminde tek bir işlevle kurulur
 * ve yalnız aşağıdaki tabloda yazan servislere bağlanır. `apps/desktop/src/main/bootstrap.ts` tabloyu
 * yukarıdan aşağı kurar. Fabrika yalnız nesneyi kurar; başka servisi çağıran iş `start()` içinde ya da
 * ilk kullanımda yapılır (kurulum sırasında diğer servisler henüz başlamamıştır).
 *
 * | Servis         | Dosya (`src/main/`)    | Fabrika              | Bağımlı olduğu servisler                         |
 * |----------------|------------------------|----------------------|--------------------------------------------------|
 * | `paths`        | `core/paths.ts`        | `createPaths`        | —                                                |
 * | `log`          | `core/log.ts`          | `createLogger`       | paths                                            |
 * | `bus`          | `core/bus.ts`          | `createBus`          | log                                              |
 * | `store`        | `core/store.ts`        | `createStore`        | paths, log                                       |
 * | `settings`     | `core/settings.ts`     | `createSettings`     | store, bus, log                                  |
 * | `policy`       | `core/policy.ts`       | `createPolicy`       | paths, store, settings, bus, log                 |
 * | `usage`        | `core/usage.ts`        | `createUsage`        | store, policy, bus, log                          |
 * | `presence`     | `core/presence.ts`     | `createPresence`     | settings, bus, log                               |
 * | `windows`      | `windows/index.ts`     | `createWindows`      | paths, settings, presence, bus, log              |
 * | `ipc`          | `ipc/router.ts`        | `createRouter`       | log                                              |
 * | `models`       | `voice/models.ts`      | `createModels`       | paths, policy, bus, log                          |
 * | `attention`    | `core/attention.ts`    | `createAttention`    | store, policy, presence, settings, bus, log      |
 * | `memory`       | `core/memory.ts`       | `createMemory`       | store, bus, log                                  |
 * | `scheduler`    | `core/scheduler.ts`    | `createScheduler`    | store, bus, log                                  |
 * | `jobs`         | `core/jobs.ts`         | `createJobs`         | store, bus, log                                  |
 * | `stage`        | `core/stage.ts`        | `createStage`        | bus, log                                         |
 * | `tools`        | `core/tools.ts`        | `createTools`        | store, policy, stage, bus, log                   |
 * | `brain`        | `core/brain.ts`        | `createBrain`        | policy, tools, memory, usage, presence, bus, log |
 * | `conversation` | `core/conversation.ts` | `createConversation` | store, brain, bus, log                           |
 * | `voice`        | `voice/index.ts`       | `createVoice`        | policy, settings, models, tools, brain, conversation, usage, windows, paths, bus, log |
 * | `hotkeys`      | `core/hotkeys.ts`      | `createHotkeys`      | settings, bus, log (yalnız `hotkey.pressed` yayınlar) |
 * | `modules`      | `core/modules.ts`      | `createModules`      | kendisi dışında hepsi (her modüle `ModuleContext` kurar) |
 *
 * Döngü yok: bir servis yalnız tabloda kendinden yukarıdakilere bağlanır. Aşağıdan yukarıya haber
 * gerektiğinde olay yolu kullanılır. Örnekler: `attention` sesli kanalı seçince `attention.notify`
 * yayınlar, `voice` dinleyip okur; `tools` onay isteyince `tool.approval.request` yayınlar, ada gösterir,
 * `voice` onay beklerken gelen sözü `tools.resolveApprovalFromSpeech`'e verir; hafıza yazıcısı (memory modülü)
 * `conversation.turn` olayını dinleyip `brain.extract` ile çıkarım yapar.
 *
 * Kalıcılık `node:sqlite` ile eşzamanlıdır; bu yüzden veri okuyan/yazan yöntemler `Promise` döndürmez.
 */

import type { z } from 'zod';
import type { HotkeyId, WindowKind } from './constants';
import type {
  ApprovalDecision,
  ApprovalKind,
  ApprovalRequest,
  AuthorityState,
  BrainRole,
  BrainStatus,
  Channel,
  ChatAttachment,
  ChatMessage,
  ChatSearchHit,
  ChatSession,
  ControlStatus,
  EchoTestResult,
  HotkeyStatus,
  Id,
  IsoDateTime,
  Job,
  JobActivity,
  JsonObject,
  JsonValue,
  LocalModelProgress,
  MemoryItem,
  MemoryKind,
  MemorySearchHit,
  MemoryStats,
  MicTestResult,
  ModuleInfo,
  Notification,
  NotifyRequest,
  PresenceState,
  Recurrence,
  RecordSource,
  Settings,
  StageApp,
  StageCard,
  StageItem,
  ToolCallRecord,
  ToolCallSummary,
  ToolInfo,
  ToolOrigin,
  UsageKind,
  UsageRecord,
  UsageSummary,
  VoiceStatus,
  WakeCalibrationResult,
  WakeTestResult,
} from './entities';
import type { BusEvents, WindowEvents } from './events';
import type { Api, ReqOf, ResOf } from './ipc';
import type { ExternalToolDef, Migration, ModuleContext, ModuleDef, ToolDef, ToolResult } from './module';
import type { Effort, LocalModel, Policy } from './policy';

/** Aboneliği kaldırır. Birden çok kez çağrılması zararsızdır. */
export type Unsubscribe = () => void;

/** Arka plan döngüsü olan servisler (yoklama, zamanlayıcı). `main.ts` kurulumdan sonra `start`, çıkışta `stop` çağırır. */
export interface Lifecycle {
  start(): void | Promise<void>;
  /** Zamanlayıcıları ve açık bağlantıları kapatır; sonrasında servis kullanılmaz. */
  stop(): void | Promise<void>;
}

// ───────────────────────────── paths · log · bus ─────────────────────────────

/** Mutlak klasör/dosya yolları. Klasörler `createPaths` içinde oluşturulur. */
export interface Paths {
  /** Veri kökü: `%APPDATA%\Fuber AI 2` (testte `FUBER2_DATA`). */
  data: string;
  /** Ana SQLite dosyası. */
  db: string;
  logs: string;
  /** İndirilen yerel modeller. */
  models: string;
  /** Kullanıcı yetenekleri kökü. */
  skills: string;
  cache: string;
  /** Geçici dosyalar; açılışta temizlenir. */
  temp: string;
  /** Politikanın disk önbelleği. */
  policyCache: string;
  /** Uygulamayla gelen salt okunur kaynaklar (`resources/`). Paketli ve geliştirme kipinde doğru yeri gösterir. */
  resources: string;
}

export interface Logger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  /** `data` bir `Error` ise yığını da yazılır. */
  error(message: string, data?: unknown): void;
  /** Aynı hedefe `[scope]` önekiyle yazan alt günlük. */
  child(scope: string): Logger;
}

/** Tipli olay yolu. Eşzamanlı dağıtır; bir dinleyicinin hatası diğerlerini engellemez (günlüğe yazılır). */
export interface Bus {
  emit<K extends keyof BusEvents>(type: K, payload: BusEvents[K]): void;
  on<K extends keyof BusEvents>(type: K, handler: (payload: BusEvents[K]) => void): Unsubscribe;
  once<K extends keyof BusEvents>(type: K, handler: (payload: BusEvents[K]) => void): Unsubscribe;
  /** Bütün olayları dinler (pencerelere aktarma ve tanı için). */
  onAny(handler: <K extends keyof BusEvents>(type: K, payload: BusEvents[K]) => void): Unsubscribe;
}

// ───────────────────────────── store ─────────────────────────────

export type SqlValue = string | number | bigint | null | Uint8Array;
/** Konumsal (`?`) ya da adlı (`:ad`, `$ad`, `@ad`) parametreler. */
export type SqlParams = SqlValue[] | Record<string, SqlValue>;
export type SqlRow = Record<string, SqlValue>;

/**
 * Bir modülün (ya da çekirdek servisin) veritabanı görünümü. Aynı SQLite bağlantısını paylaşır;
 * kural: yalnız `prefix` ile başlayan tablolara dokunulur. FTS5 sanal tabloları da aynı öneki taşır.
 * Tam metin arama kalıbı (`FTS_TOKENIZER`, `foldForSearch`, `ftsQuery`, `makeSnippet`) `search.ts` içindedir.
 */
export interface ScopedDb {
  /** Tablo öneki: modül kimliğinde `-` yerine `_`, sonunda `_` (`voice_control_`). */
  readonly prefix: string;
  /** Sonuç döndürmeyen bir ya da birden çok deyim (DDL). */
  exec(sql: string): void;
  run(sql: string, params?: SqlParams): { changes: number; lastInsertRowid: number };
  get<T = SqlRow>(sql: string, params?: SqlParams): T | undefined;
  all<T = SqlRow>(sql: string, params?: SqlParams): T[];
  /** `fn` tek işlem içinde koşar; fırlatırsa geri alınır. İç içe çağrılabilir. */
  transaction<T>(fn: () => T): T;
}

/** Küçük, JSON değerli anahtar-değer deposu (ayarlar, cihaz belirteci, son eşitleme anı). */
export interface KeyValueStore {
  get<T extends JsonValue>(key: string): T | undefined;
  set(key: string, value: JsonValue): void;
  delete(key: string): void;
}

export interface Store {
  /** Açık veritabanı dosyasının yolu. */
  readonly path: string;
  /** `scope` için görünüm. Kapsam: modül kimliği ya da çekirdek servis adı (`core`, `memory`, `usage`…). */
  scoped(scope: string): ScopedDb;
  /** `scope`'un henüz uygulanmamış göçlerini sırayla uygular. */
  migrate(scope: string, migrations: Migration[]): void;
  /** Kapsam başına ayrı ad alanı olan anahtar-değer deposu. */
  kv(scope: string): KeyValueStore;
  close(): void;
}

// ───────────────────────────── settings · policy ─────────────────────────────

export interface SettingsApi {
  get(): Settings;
  /** Verilen alanları değiştirir, kaydeder, `settings.changed` yayınlar. */
  update(patch: Partial<Settings>): Settings;
}

export interface PolicyApi extends Lifecycle {
  /** Yürürlükteki politika (anahtarlar dahil). Arayüze `redactPolicy()` ile verilir. */
  get(): Policy;
  status(): ControlStatus;
  /** Cihazı kontrol servisine kaydeder (gerekirse) ve politikayı hemen çeker. `url` verilirse ayara yazılır. */
  connect(url?: string): Promise<ControlStatus>;
  /** Uzun yoklamayı beklemeden politikayı yeniden çeker. */
  refresh(): Promise<ControlStatus>;
  /** Modül politikaca açık mı. Listede yoksa `false`. */
  moduleAllowed(moduleId: string): boolean;
  /** `Policy.modules[id].config`; yoksa boş nesne. */
  moduleConfig(moduleId: string): Record<string, unknown>;
  /** Acil durdurma etkin mi. Ses ve araç kapısı her işlemden önce buna bakar. */
  killSwitchActive(): boolean;
  /** Zorunlu güncelleme gerekiyor mu. */
  updateRequired(): boolean;
  /**
   * Gizlilik kararının tek yeri (KURGU §4.1): Gizli kipte ağ gerektiren iş yapılabilir mi.
   * Bulut kipinde her zaman `true`.
   */
  networkAllowed(): boolean;
}

// ───────────────────────────── usage ─────────────────────────────

export interface UsageInput {
  kind: UsageKind;
  provider: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  audioSeconds?: number;
  /**
   * Verilmezse servis kendi fiyat tablosundan hesaplar. `null` ya da tabloda olmayan model: fiyat BİLİNMİYOR
   * (kayıt `costKnown: false` taşır, tutar 0 yazılır ama "bilinmiyor" diye gösterilir).
   */
  costUsd?: number | null;
  durationMs: number;
  sessionId?: Id;
}

export interface UsageApi {
  /** Kaydeder, `usage.recorded` yayınlar, kontrol servisine gönderilmek üzere sıraya koyar. */
  record(input: UsageInput): UsageRecord;
  today(): UsageSummary;
  /** Bugün dahil son `days` günün özeti, yeniden eskiye. */
  summary(days: number): UsageSummary[];
  recent(limit: number): UsageRecord[];
  /** Günlük bütçe aşıldı mı. `true` iken beyin yalnız `voice` rolünü çalıştırır. */
  overBudget(): boolean;
}

// ───────────────────────────── presence · windows ─────────────────────────────

export interface PresenceApi extends Lifecycle {
  /** Son yoklamanın sonucu (ucuz; önbellekten). */
  get(): PresenceState;
  /** Hemen yeniden ölçer; değiştiyse `presence.changed` yayınlar. */
  refresh(): PresenceState;
}

/**
 * Pencere yöneticisi. Electron tipleri burada görünmez; `BrowserWindow`'a gerek duyan kod
 * `apps/desktop/src/main/windows/` içindeki somut dışa aktarımları kullanır.
 */
export interface WindowsApi {
  /** Pencere yoksa oluşturur ve içeriği yüklenene kadar bekler. Göstermez. */
  ensure(kind: WindowKind): Promise<void>;
  /** Ana pencereyi öne getirir (istenirse bir sayfaya gider). Odak alan tek çağrı budur. */
  showMain(page?: string): Promise<void>;
  /** HUD yüzeyini odak çalmadan gösterir (`showInactive`). */
  show(kind: WindowKind): Promise<void>;
  hide(kind: WindowKind): void;
  isOpen(kind: WindowKind): boolean;
  /** Olayı açık bütün pencerelere yollar. */
  broadcast<K extends keyof WindowEvents>(event: K, payload: WindowEvents[K]): void;
  /** Olayı yalnız bir pencereye yollar (pencere kapalıysa sessizce atlanır). */
  sendTo<K extends keyof WindowEvents>(kind: WindowKind, event: K, payload: WindowEvents[K]): void;
  /**
   * Bir MessagePort'u pencereye teslim eder (`PORT_CHANNEL`; sayfa `window` üstünde `{ fuberPort: name }`
   * iletisiyle alır). `port` Electron'un `MessagePortMain` nesnesidir; bu paket Electron tipi taşımadığı için
   * `unknown` yazılır. Pencere açık değilse fırlatır (önce `ensure`).
   */
  postPort(kind: WindowKind, name: string, port: unknown): void;
}

// ───────────────────────────── ipc ─────────────────────────────

/**
 * Electron'dan bağımsız IPC işleyici haritası: kanal → işleyici. Modüller ve çekirdek servisler
 * arayüze açtıkları kanalları bununla bildirir.
 */
export type IpcHandlers = {
  [K in keyof Api]?: (request: ReqOf<Api, K>) => ResOf<Api, K> | Promise<ResOf<Api, K>>;
};

/** IPC yönlendiricisinin servislere açık yüzü (`main.ts` içinde `router`'dan kurulur). */
export interface IpcRegistrar {
  /** İşleyicileri bağlar; dönen işlev hepsini kaldırır. Kanal zaten bağlıysa fırlatır. */
  register(handlers: IpcHandlers): Unsubscribe;
}

// ───────────────────────────── models ─────────────────────────────

/**
 * Yerel model dosyaları (`Policy.localModels`): indirme, SHA-256 doğrulama, disk durumu.
 * Politikadan çıkan model "yok" sayılır; yenisi inene kadar ilgili özellik hazır değildir.
 */
export interface ModelsApi {
  /** Politikadaki her modelin durumu. */
  status(): LocalModelProgress[];
  /** Verilen roldeki `required` modellerin hepsi hazır mı. */
  ready(role: LocalModel['role']): boolean;
  /**
   * Hazır modelin bir dosyasının mutlak yolu. `relativePath`, `LocalModel.files[].path` değeridir;
   * verilmezse ilk dosya. Model hazır değilse `null`.
   */
  filePath(modelId: string, relativePath?: string): string | null;
  /**
   * Eksik modelleri indirir (`ids` yoksa `required` olanların hepsi). İlerleme `setup.modelProgress`
   * ile yayınlanır; çağrı hemen döner. Yarım kalan indirme kaldığı yerden sürer.
   */
  download(ids?: string[]): LocalModelProgress[];
  /** Süren indirmeleri durdurur. */
  cancel(): void;
}

// ───────────────────────────── attention ─────────────────────────────

/** Dikkat Yöneticisi (KURGU §8). Modüller niyet bildirir; kanalı yalnız bu servis seçer. */
export interface AttentionApi extends Lifecycle {
  /**
   * Bildirimi kaydeder ve varlık durumuna göre kanalını seçer. Hemen gösterilecekse
   * `attention.notify` yayınlanır; bekleyecekse durum değişince özetle gelir.
   * Aynı `dedupeKey` ile çözülmemiş bildirim varsa o güncellenir ve döndürülür.
   */
  notify(request: NotifyRequest): Notification;
  /** Kapatır (`attention.dismiss` yayınlar). */
  dismiss(id: Id): void;
  /** Kullanıcı bir eylem seçti: `attention.action` yayınlanır, bildirim `acted` olur. */
  act(id: Id, actionId: string): void;
  /** Çözülmemiş (`pending` ve `shown`) bildirimler, yeniden eskiye. */
  pending(): Notification[];
  /** Çözülmüşler dahil son bildirimler (Bugün sayfası). */
  recent(limit: number): Notification[];
  /**
   * Bir modülün BÜTÜN bildirimlerini (geçmiş dahil) kalıcı olarak siler; açık olanlar yüzeylerden de kalkar
   * (`attention.dismiss`). Modül "verimi sil" dediğinde bildirim başlık ve gövdelerinde kalan içerik de gitsin diye.
   * Silinen kayıt sayısını döner. (İsteğe bağlı olması yalnız eski sınama sahteleri içindir; servis her zaman sağlar.)
   */
  forgetModule?(moduleId: string): number;
}

// ───────────────────────────── memory ─────────────────────────────

export interface MemorySaveInput {
  kind: MemoryKind;
  text: string;
  source: RecordSource;
  subject?: string | null;
  tags?: string[];
  /** 0–1; varsayılan 0.8 (çıkarım), kullanıcı açıkça söylediyse 1. */
  confidence?: number;
  /** 0–1; varsayılan 0.5. */
  importance?: number;
  pinned?: boolean;
  /** Bilginin ait olduğu an; varsayılan şimdi. */
  at?: IsoDateTime;
  /**
   * Kaydın son değiştiği an; varsayılan şimdi. Yalnız içe aktarma verir: başka kaynaktan gelen eski kayıt "yeni"
   * sayılmasın (liste sırası ve aramadaki güncellik puanı `updatedAt`'e bakar). Gelecekteki an şimdiye çekilir.
   */
  updatedAt?: IsoDateTime;
  sessionId?: Id | null;
  reminderId?: Id | null;
}

export type MemoryPatch = Partial<
  Pick<MemoryItem, 'text' | 'subject' | 'tags' | 'confidence' | 'importance' | 'pinned' | 'kind' | 'reminderId'>
>;

export interface MemoryQuery {
  /** Serbest metin; FTS5 sorgusuna servis çevirir (özel karakterleri kaçırır). */
  text: string;
  kinds?: MemoryKind[];
  /** Varsayılan 8. */
  limit?: number;
  /** `superseded` kayıtlar da gelsin mi; varsayılan `false`. */
  includeSuperseded?: boolean;
}

export interface MemoryListFilter {
  kind?: MemoryKind;
  pinnedOnly?: boolean;
  includeSuperseded?: boolean;
  subject?: string;
  limit: number;
  offset?: number;
}

/** Hafızanın `episodes` / `facts` / `commitments` katmanları (KURGU §7). Ham döküm `ConversationApi`'dedir. */
export interface MemoryApi {
  save(input: MemorySaveInput): MemoryItem;
  /** Kayıt yoksa `null`. */
  update(id: Id, patch: MemoryPatch): MemoryItem | null;
  /** Çelişen yeni bilgi: eskisini `superseded` işaretler (silmez), yenisini kaydeder ve döndürür. */
  supersede(oldId: Id, replacement: MemorySaveInput): MemoryItem;
  /** Gerçekten siler ("bunu unut"). Silindiyse `true`. */
  forget(id: Id): boolean;
  get(id: Id): MemoryItem | null;
  /** FTS5 + güncellik + önem puanıyla sıralı arama. */
  search(query: MemoryQuery): MemorySearchHit[];
  /** Yeniden eskiye liste (Hafıza sayfası). */
  list(filter: MemoryListFilter): MemoryItem[];
  stats(): MemoryStats;
}

// ───────────────────────────── scheduler ─────────────────────────────

export interface ScheduledTask {
  id: Id;
  /** İşleyiciyi seçen ad: `<moduleId>.<ad>` (`planner.reminder`). */
  kind: string;
  /** Bir sonraki çalışma anı. */
  dueAt: IsoDateTime;
  recurrence: Recurrence | null;
  /** İşleyiciye olduğu gibi verilen veri. */
  payload: JsonObject;
  /** Verildiyse aynı `kind` + `key` ile tek görev tutulur (yeniden planlama eskisinin üstüne yazar). */
  key: string | null;
  createdAt: IsoDateTime;
}

export interface ScheduleInput {
  kind: string;
  dueAt: IsoDateTime;
  payload: JsonObject;
  recurrence?: Recurrence | null;
  key?: string;
}

export interface TaskRun {
  /** Planlanan an. */
  scheduledFor: IsoDateTime;
  /** Uygulama kapalıyken kaçtı; açılışta işleniyor. */
  missed: boolean;
  /** Planlanan andan bu yana geçen süre (ms). */
  lateMs: number;
}

export interface SchedulerApi extends Lifecycle {
  /** Görev planlar. `key` verilmiş ve aynı `kind`+`key` varsa onu günceller. */
  schedule(input: ScheduleInput): ScheduledTask;
  cancel(id: Id): boolean;
  cancelByKey(kind: string, key: string): boolean;
  get(id: Id): ScheduledTask | null;
  /** `kind` verilirse yalnız o tür; `dueAt` sırasıyla. */
  list(kind?: string): ScheduledTask[];
  /**
   * `kind` için işleyici kaydeder (tür başına tek işleyici). Vakti gelen görev işleyiciye verilir;
   * tek seferlikse silinir, tekrarlıysa `dueAt` bir sonraki ana alınır. Kaçan tekrarlı görev
   * açılışta yalnız bir kez (`missed: true`) çalışır. İşleyici fırlatırsa günlüğe yazılır, görev yine ilerler.
   * İşleyicisi henüz kayıtlı olmayan vakti gelmiş görev, işleyici kaydedilince çalışır.
   */
  handle(kind: string, handler: (task: ScheduledTask, run: TaskRun) => void | Promise<void>): Unsubscribe;
}

// ───────────────────────────── jobs ─────────────────────────────

export interface JobControl {
  id: Id;
  /** İptal ya da acil durdurma. İş bunu dinleyip bırakmalı. */
  signal: AbortSignal;
  /** İlerleme bildirir (`job.progress` yayınlanır). `progress` 0–1. */
  update(change: { progress?: number | null; step?: string }): void;
}

export interface JobSpec {
  /** `<moduleId>.<ad>`. */
  kind: string;
  moduleId: string;
  /** Kullanıcıya görünen Türkçe başlık. */
  title: string;
  /** İşi yapar; dönen metin `Job.resultText` olur. Fırlatırsa iş `failed` olur. */
  run(control: JobControl): Promise<string>;
}

/** Arka plan derin görevleri. Aynı anda en çok birkaç iş koşar; fazlası `queued` bekler. */
export interface JobsApi {
  /** İşi sıraya koyar ve hemen döner. Bitiş `job.progress` olayından izlenir. */
  start(spec: JobSpec): Job;
  cancel(id: Id): boolean;
  /** Acil durdurma: koşan ve bekleyen bütün işleri iptal eder; iptal edilen sayıyı döndürür. */
  cancelAll(): number;
  get(id: Id): Job | null;
  /** Yeniden eskiye. */
  list(filter?: { status?: Job['status']; kind?: string; limit?: number }): Job[];
  /** İş bitene (done/failed/cancelled) kadar bekler ve son halini döndürür. */
  wait(id: Id): Promise<Job>;
  /**
   * İşlerin o anki özeti (`job.activity` olayının son hali). Yüzeyler açıldıklarında bununla başlar. (İsteğe bağlı
   * olması yalnız eski sınama sahteleri içindir; servis her zaman sağlar.)
   */
  activity?(): JobActivity;
}

// ───────────────────────────── stage ─────────────────────────────

/** Sahne: Jarvis'in gösterdiği kartlar ve mini uygulamalar. Pencereyi `windows` yönetir; bu servis listeyi tutar. */
export interface StageApi {
  /** Kartı sahneye koyar, `stage.show` yayınlar. */
  showCard(moduleId: string, card: StageCard): StageItem;
  showApp(moduleId: string, app: StageApp): StageItem;
  /** `id` verilirse o öğeyi, verilmezse hepsini kapatır (`stage.close`). */
  close(id?: Id): void;
  items(): StageItem[];
}

// ───────────────────────────── tools ─────────────────────────────

/** Sağlayıcıdan bağımsız araç tanımı; beyin bunu Anthropic `tools` biçimine çevirir. */
export interface ToolSchema {
  name: string;
  description: string;
  /** `ToolDef.input`'tan üretilen JSON Schema (nesne). */
  inputSchema: JsonObject;
}

export interface ToolCallOptions {
  /** Verilmezse üretilir. */
  callId?: Id;
  origin: ToolOrigin;
  signal?: AbortSignal;
  /** Aracın `ctx.report()` ile bildirdiği ara durumlar. */
  onReport?(step: string): void;
}

export interface ApprovalInput {
  toolName: string;
  moduleId: string;
  summary: string;
  input: JsonValue;
  origin: ToolOrigin;
  /** Varsayılan `LIMITS.approvalTimeoutMs`. */
  timeoutMs?: number;
  /** İşin türü; verilmezse araç adından bulunur (`core/authority.ts` › `APPROVAL_KINDS`), o da yoksa `other`. */
  kind?: ApprovalKind;
  /** Sesli sorunun kısa biçimi; verilmezse türe göre üretilir ("Göndereyim mi?"). */
  ask?: string;
}

/**
 * Araç kaydı ve tek kapı (KURGU §4.1). `run()` şu sırayı uygular ve hiç fırlatmaz:
 * 1. araç var mı → 2. acil durdurma kapalı mı → 3. modül politikaca açık mı →
 * 4. Gizli kipte `net` izni gerekmiyor mu → 5. girdi şemaya (zod ya da JSON Schema) uyuyor mu →
 * 6. `write`/`danger` ve konuşmacı doğrulanamadıysa reddet → 7. `danger` ise onay iste →
 * 8. çalıştır → 9. günlüğe yaz, `tool.call` yayınla, `show` varsa sahneye koy.
 * Reddedilen her adım `ok: false` ve nedenini söyleyen Türkçe `text` döndürür.
 */
export interface ToolRegistry {
  /**
   * Bir modülün araçlarını kaydeder. `context`, her çağrıda `ToolContext`'e genişletilerek `run`'a verilir.
   * Ad çakışırsa fırlatır. Dönen işlev bu kaydı kaldırır.
   */
  register(context: ModuleContext, tools: ToolDef[]): Unsubscribe;
  /**
   * JSON Schema ile tanımlı DIŞ aracı kaydeder (kullanıcı yeteneklerinin araçları). Kayıt, girdiyi
   * `inputSchema` ile doğrular ve aynı kapıdan geçirir. Ad çakışırsa ya da şema nesne şeması değilse fırlatır.
   * Dönen işlev bu aracı kaldırır.
   */
  registerExternal(context: ModuleContext, tool: ExternalToolDef): Unsubscribe;
  /** Tek bir aracı adıyla kaldırır (zod'lu ya da dış). Kayıtlıydıysa `true`. */
  unregister(name: string): boolean;
  /** Modülün bütün araçlarını kaldırır. */
  unregisterModule(moduleId: string): void;
  list(): ToolInfo[];
  has(name: string): boolean;
  /** Beyne verilecek tanımlar. `names` verilmezse kayıtlı bütün araçlar; bilinmeyen ad atlanır. */
  schemas(names?: string[]): ToolSchema[];
  /** Verilen araçların bağlam ipuçları (`ToolDef.contextHint`); ipucu vermeyen ve hata veren araçlar atlanır. */
  contextHints(names: string[]): string[];
  run(name: string, input: unknown, options: ToolCallOptions): Promise<ToolResult>;
  /**
   * Kullanıcıdan onay ister: `tool.approval.request` yayınlar, yanıtı ya da zaman aşımını bekler.
   * `run()` bunu `danger` araçlar için kendisi çağırır; modüller araç dışı riskli iş için de kullanabilir.
   */
  requestApproval(input: ApprovalInput): Promise<ApprovalDecision>;
  /**
   * Bekleyen onayı sonuçlandırır (ada düğmesi ya da sesli "onaylıyorum"). Bulunduysa `true`.
   * `opts.scope: 'task'` ("Bu iş boyunca sorma"): onayla birlikte süren iş bitene kadar Tam yetki verilir.
   */
  resolveApproval(id: Id, decision: Exclude<ApprovalDecision, 'expired'>, by: 'voice' | 'ui', opts?: { scope?: 'task' }): boolean;
  /** Yürürlükteki yetki düzeyi (ayar + geçici yükseltme + Yönetim sınırı). */
  authority(): AuthorityState;
  /**
   * Geçici yükseltme verir ya da kaldırır (`null`). `minutes`: süreli Tam yetki; `task`: süren iş bitene kadar.
   * Yönetim sınırı Tam yetki'ye izin vermiyorsa `false` döner. Kalıcı düzey ayardır (`Settings.authorityLevel`).
   */
  grantAuthority(grant: { minutes: number } | { task: true } | null): boolean;
  /** Süren iş bitti (sesli sohbet boşa döndü): işe bağlı yükseltme kalkar. */
  endTask(): void;
  /**
   * Onay beklenirken söylenen sözü yorumlar ve SORULAN onayı sonuçlandırır: `approvalId` verilirse yalnız o
   * onay; verilmezse yalnız tek bir onay bekliyorsa o (birden çoksa hiçbiri, `unclear`).
   * Açık kabul (kısa ve yalın: "onaylıyorum", "evet", "evet onaylıyorum", "onayla") → `approved`; tek başına
   * "tamam", "olur", "yap" kabul değildir. Açık ret ("hayır", "vazgeç", "iptal") → `denied`. Anlaşılmadıysa ya
   * da hedef onay yoksa `unclear` (hiçbir şey değişmez; ses oturumu yeniden sorar).
   * Ses oturumu, onay beklerken gelen her dökümü beyne göndermeden önce buraya `turn.approval.id` ile verir.
   */
  resolveApprovalFromSpeech(text: string, opts?: { approvalId?: Id; asked?: boolean }): 'approved' | 'denied' | 'unclear';
  pendingApprovals(): ApprovalRequest[];
  /** Son çağrılar, yeniden eskiye. */
  recentCalls(limit: number): ToolCallRecord[];
  /** Acil durdurma: koşan bütün çağrıları iptal eder, bekleyen onayları reddeder. */
  cancelAll(): void;
}

// ───────────────────────────── modules ─────────────────────────────

export interface ModuleRegistry {
  /**
   * Yerleşik modülleri kaydeder ve açık olanları yükler (göç → araç kaydı → `setup`).
   * Bir modülün hatası diğerlerini durdurmaz; `ModuleInfo.error` olarak görünür.
   */
  loadBuiltins(defs: ModuleDef[]): Promise<void>;
  /** Çalışma anında modül ekler (Atölye'nin onaylanan yetenekleri, `kind: 'skill'`). */
  add(def: ModuleDef, kind: 'skill'): Promise<ModuleInfo>;
  /** Modülü kapatıp kayıttan siler. */
  remove(id: string): Promise<void>;
  list(): ModuleInfo[];
  get(id: string): ModuleInfo | null;
  /**
   * Yerel aç/kapat (`Settings.disabledModules`). Politikanın kapattığı modül açılamaz.
   * Değişince `module.changed` yayınlanır.
   */
  setEnabled(id: string, enabled: boolean): Promise<ModuleInfo>;
  /**
   * Modülün kullanıcı verisini kalıcı olarak siler (`ModuleDef.purge`); modül kapalıyken de çalışır. Modül böyle bir
   * silme tanımlamıyorsa `UserError` fırlatır.
   */
  purgeData(id: string): Promise<void>;
  /** Politika değişince çağrılır: izin durumuna göre modülleri yükler/kapatır. */
  sync(): Promise<void>;
  /** Çıkışta bütün modüllerin `teardown`'ını çağırır. */
  stopAll(): Promise<void>;
}

// ───────────────────────────── brain ─────────────────────────────

export interface BrainImage {
  /** `image/png`, `image/jpeg`, `image/webp`. */
  mediaType: string;
  /** Base64 (önek yok). */
  data: string;
}

/** Tur geçmişi yalnız metindir; tur içindeki araç blokları beynin iç döngüsünde kalır. */
export interface BrainMessage {
  role: 'user' | 'assistant';
  text: string;
  /** Yalnız `user` iletisinde. */
  images?: BrainImage[];
}

/** Beynin tur içinde bildirdiği araç etkinliği. */
export type ToolCallEvent =
  | { phase: 'start'; callId: Id; name: string; input: unknown }
  | { phase: 'report'; callId: Id; name: string; step: string }
  | { phase: 'end'; callId: Id; name: string; ok: boolean; text: string; durationMs: number };

/** Anthropic'in sunucuda koşan araçları; istemci tarafında çalıştırılmaz. */
export type ServerTool = 'web_search' | 'web_fetch';

export interface BrainRequestBase {
  role: BrainRole;
  /**
   * Kişilik isteminin ardına eklenen, bu çağrıya özgü yönerge. Değişmeyen metin olmalı
   * (saat, kimlik gibi değişken şey koyma; istem önbelleğini kırar).
   */
  instructions?: string;
  /**
   * Kullanılabilecek kayıtlı araçlar: ad listesi, `'all'` ya da `'none'`.
   * Varsayılan: `voice` ve `deep` için `'all'`, `memory` ve `vision` için `'none'`.
   */
  tools?: string[] | 'all' | 'none';
  /**
   * Yalnız bu çağrıda geçerli, kayda girmeyen araçlar (ör. Atölye'nin tek klasöre yazan dosya araçları).
   * `context`, bu araçların `run`'ına verilecek modül bağlamıdır. Kapı kuralları (onay, acil durdurma) bunlara da uygulanır.
   */
  extraTools?: { context: ModuleContext; tools: ToolDef[] };
  serverTools?: ServerTool[];
  /** Araç çağrılarının kökeni; kapı kararları buna göre verilir. */
  origin: ToolOrigin;
  /** İptal: akış kesilir, koşan araçlara iletilir, yanıt `stopReason: 'aborted'` ile döner. */
  signal?: AbortSignal;
  /** En çok araç turu; varsayılan `Policy.limits.maxAgentSteps`. */
  maxSteps?: number;
  /**
   * Rolün politikadaki eforunu yalnız bu çağrı için değiştirir. Yazılı sohbet bunu kullanır:
   * `deep` rolünün modeli, efor `CHAT_EFFORT`.
   */
  effort?: Effort;
  /**
   * Kişilik + değişken kuyruk (saat, varlık durumu, ilgili hafızalar) eklensin mi.
   * Varsayılan: `voice`/`deep` için `true`; `memory`/`vision` için `false` (yalın çağrı).
   */
  persona?: boolean;
  /**
   * Yalnız bulut beyni (Claude Code, Anthropic, OpenAI uyumlu): yerel modele ne birincil ne düşüş olarak
   * gidilir; bulut yoksa `stopReason: 'error'`. Ortam dinlemenin "söze girmeye değer mi" sorusu bunu kullanır.
   */
  cloudOnly?: boolean;
  /** Metin parçası geldikçe (tur içi araçlardan önceki ve sonraki bütün metin). */
  onText?(delta: string): void;
  /** Tamamlanan her cümle için (`SentenceSplitter`); TTS bunu dinler. */
  onSentence?(sentence: string): void;
  onToolCall?(event: ToolCallEvent): void;
}

/** `messages` ya da `text`'ten tam biri verilir. `text`, tek kullanıcı iletisinin kısaltmasıdır. */
export type BrainRequest = BrainRequestBase &
  ({ messages: BrainMessage[]; text?: undefined } | { text: string; messages?: undefined });

export type BrainStopReason =
  | 'end' // model yanıtını bitirdi
  | 'max_steps' // araç turu sınırına takıldı
  | 'max_tokens' // çıktı sınırına takıldı; `text` yarımdır
  | 'aborted' // `signal` ile iptal
  | 'refusal' // model/sınıflandırıcı reddetti
  | 'budget' // günlük bütçe aşıldı (yalnız `voice` dışı roller)
  | 'kill_switch' // acil durdurma etkin
  | 'no_key' // sağlayıcı anahtarı yok
  | 'error'; // ağ/sağlayıcı hatası; `error` dolu

export interface BrainResponse {
  /** Modelin ürettiği bütün metin (iptalde o ana kadarki kısım). */
  text: string;
  stopReason: BrainStopReason;
  /** `stopReason` `end` değilse kullanıcıya söylenebilecek Türkçe açıklama. */
  error: string | null;
  toolCalls: ToolCallSummary[];
  /** Bu çağrının toplam kullanımı (`usage.record` ayrıca yapılmıştır). */
  usage: { inputTokens: number; outputTokens: number; costUsd: number; durationMs: number };
}

export interface BrainTaskRequest extends Omit<BrainRequestBase, 'role'> {
  /** Varsayılan `deep`. */
  role?: BrainRole;
  /** Görevin tam tarifi: amaç, kısıtlar, bitmiş sayılma ölçütü. */
  goal: string;
  /** Her araç turunda: modelin o turdaki metni ve çağırdığı araçlar (iş ilerlemesi için). */
  onStep?(step: { index: number; text: string; toolNames: string[] }): void;
}

export interface BrainExtractRequest<T> {
  /** Varsayılan `memory`. */
  role?: BrainRole;
  /** Ne çıkarılacağını anlatan yönerge. */
  instructions: string;
  /** Üzerinde çalışılacak metin. */
  input: string;
  images?: BrainImage[];
  /** Çıktı şeması; yapılandırılmış çıktı olarak istenir ve yanıt bununla doğrulanır. */
  schema: z.ZodType<T>;
  signal?: AbortSignal;
  /**
   * Her koşulda bu bilgisayardaki yerel model: rolün politikadaki sağlayıcısı, Anthropic anahtarı, OpenAI
   * uyumlu sağlayıcılar yok sayılır; yerel model hazır değilse `null` (buluta DÜŞMEZ). Ham döküm gören ortam dinleme
   * çağrıları bunu kullanır.
   */
  localOnly?: boolean;
}

/** Claude döngüsü (KURGU §6). Model, efor ve anahtar politikadan gelir; çağıran bunları bilmez. */
export interface BrainApi {
  /**
   * Bir konuşma turu: akışlı yanıt + araç döngüsü. Hiç fırlatmaz; sorun `stopReason` ile bildirilir.
   * Geçmişi çağıran verir (genellikle `ConversationApi.turn` üzerinden).
   */
  respond(request: BrainRequest): Promise<BrainResponse>;
  /** Derin görev: uzun, çok adımlı araçlı döngü. Arka planda koşturmak için `jobs.start` içine sarılır. */
  runTask(request: BrainTaskRequest): Promise<BrainResponse>;
  /** Araçsız, şemaya uygun yapılandırılmış çıkarım. Başarısızsa (ret, geçersiz çıktı, anahtar yok) `null`. */
  extract<T>(request: BrainExtractRequest<T>): Promise<T | null>;
  /** Rol şu an çalışabilir mi; çalışamıyorsa Türkçe neden (anahtar yok, bütçe, acil durdurma). */
  availability(role: BrainRole): { ok: boolean; reason: string | null };
  /** Asistanın o anki beyni (sesli tur ve yazılı sohbet için). Değişince `brain.status` olayı yayınlanır. */
  status(): BrainStatus;
  /**
   * Rolün istem önbelleğini ısıtır (araçlar + kişilik; `max_tokens: 0`). Ses oturumu uyandırma anında
   * çağırır ki ilk yanıt önbellekten başlasın. Hiç fırlatmaz; anahtar yoksa ya da hata olursa sessizce döner.
   * Aynı rol için süren bir ısıtma varken yeniden çağrılırsa aynı sözü döndürür.
   */
  prewarm(role: BrainRole): Promise<void>;
}

// ───────────────────────────── conversation ─────────────────────────────

export interface TurnRequest {
  /** `null`: kanalın güncel oturumu kullanılır (yoksa açılır). */
  sessionId: Id | null;
  channel: Channel;
  /** Kullanıcının söylediği/yazdığı. */
  text: string;
  images?: BrainImage[];
  /** Varsayılan: `voice` kanalı → `voice`; `chat` kanalı → `CHAT_ROLE` (`deep`). */
  role?: BrainRole;
  /** Varsayılan: `voice` kanalı → rolün politikadaki eforu; `chat` kanalı → `CHAT_EFFORT` (`medium`). */
  effort?: Effort;
  /** Yalnız sesli turda: konuşmacı doğrulama sonucu. */
  speakerVerified?: boolean | null;
  /** Kullanıcı iletisine eklenen dosyalar (belge modülünün ek kimlikleri); `useAttachmentResolver` ile çözülür. */
  attachmentIds?: Id[];
  signal?: AbortSignal;
  onText?(delta: string): void;
  onSentence?(sentence: string): void;
  onToolCall?(event: ToolCallEvent): void;
}

/** Ek çözücüsü (belge modülü bağlar; `ConversationApi.useAttachmentResolver`). */
export interface AttachmentResolver {
  /** Eşzamanlı: kullanıcı iletisine yazılacak ek özetleri. Bilinmeyen kimlik "okunamadı" özetiyle döner. */
  describe(ids: Id[]): ChatAttachment[];
  /**
   * Modele gidecek ek metni (güvenilmez veri olarak çerçevelenmiş; dökümde saklanmaz) ve görseller. Kullanıcının
   * sözü (`text`) uzun belgeden ilgili yerleri seçmek için verilir.
   */
  prepare(ids: Id[], request: { text: string; channel: Channel; signal?: AbortSignal }): Promise<{ text: string; images: BrainImage[] }>;
}

export interface TurnResult {
  sessionId: Id;
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
  response: BrainResponse;
}

/**
 * Sesli ve yazılı sohbetin ortak omurgası: oturumlar, ham döküm (hafızanın `transcript` katmanı,
 * FTS5 ile aranır) ve bir turun baştan sona yürütülmesi.
 */
export interface ConversationApi {
  /**
   * Bir tur yürütür: kullanıcı iletisini kaydeder → geçmiş penceresiyle `brain.respond` → asistan iletisini
   * kaydeder → `conversation.turn` yayınlar. Akış boyunca `chat.stream` olayları yayınlanır.
   * İptal edilirse asistan iletisi o ana kadarki metinle ve `interrupted: true` olarak kaydedilir.
   */
  turn(request: TurnRequest): Promise<TurnResult>;
  /**
   * Kaydedilmiş iletiyi düzeltir. Ses oturumu söz kesmede bunu çağırıp metni yalnız
   * gerçekten seslendirilen kısma indirir.
   */
  amendMessage(id: Id, patch: { text?: string; interrupted?: boolean }): ChatMessage | null;
  /**
   * Ek çözücüsünü bağlar (belge modülü). Tur, `attachmentIds` verilince `describe` sonucunu kullanıcı iletisine
   * yazar (eşzamanlı; `chat.stream start` beklemeden yayınlanır), `prepare` metnini yalnız modele giden iletiye ekler
   * (dökümde durmaz), görselleri görsel olarak gönderir. Çözücü yoksa (modül kapalı) ekler "okunamadı" kaydedilir.
   */
  useAttachmentResolver(resolver: AttachmentResolver): Unsubscribe;
  /** Tur dışı ileti ekler (ör. seslendirilen bir bildirimin döküme düşmesi). */
  appendMessage(input: { sessionId: Id; role: 'user' | 'assistant'; text: string; channel: Channel }): ChatMessage;
  createSession(channel: Channel, title?: string): ChatSession;
  /** Kanalın güncel oturumu: son etkinlik yakınsa o, değilse yeni oturum. */
  currentSession(channel: Channel): ChatSession;
  /** Yeniden eskiye. `query` başlıkta arar. */
  sessions(filter: { channel?: Channel; query?: string; limit: number; offset?: number }): ChatSession[];
  renameSession(id: Id, title: string): ChatSession | null;
  /** Oturumu ve iletilerini siler. */
  deleteSession(id: Id): boolean;
  /** Eskiden yeniye; `beforeId` verilirse ondan önceki `limit` ileti. */
  messages(sessionId: Id, options: { limit: number; beforeId?: Id }): ChatMessage[];
  /** Bütün dökümde tam metin arama. */
  search(query: string, limit: number): ChatSearchHit[];
  /** `olderThanDays` günden eski dökümü siler; silinen ileti sayısını döndürür. */
  purge(olderThanDays: number): number;
}

// ───────────────────────────── voice ─────────────────────────────

/**
 * Ses oturumu (KURGU §5). Durum tek kaynaktır ve `voice.state` ile duyurulur. Diğer olaylar:
 * `voice.status`, `voice.partial`, `voice.level`, `voice.wake`, `voice.turn`, `voice.error`.
 */
export interface VoiceApi extends Lifecycle {
  status(): VoiceStatus;
  /** Uyandırma sözü yerine dinlemeyi başlatır. Mikrofon kapalıysa önce açar. */
  startListening(trigger: 'hotkey' | 'island' | 'api'): void;
  /** Konuşmayı keser: oynatma durur, kalan metin atılır, model isteği iptal edilir → `followup`. */
  stopSpeaking(): void;
  /**
   * "Bildirimi kapat / Sustur": sıradaki duyurular atılır, süren konuşma kesilir ve hat boşa döner (çentik kapanır);
   * konuşmayan, çalışan iş kesilmez. İsteğe bağlı: sınama düzeneklerinde yoktur.
   */
  hush?(): void;
  /** Acil durdurma: süren turu tümüyle iptal eder → `idle`. */
  cancelTurn(): void;
  /**
   * Mikrofonu gerçekten kapatır (`track.stop()`) → `mic_off`. `minutes` verilirse süre dolunca
   * kendiliğinden açılır; verilmezse yalnız kısayol ya da ada ile açılır.
   */
  muteMic(options?: { minutes?: number }): void;
  unmuteMic(): void;
  /** Uyandırma sözünü `minutes` dakika yok sayar; mikrofon açık kalır, kısayol ve ada çalışır. */
  pauseWake(minutes: number): void;
  resumeWake(): void;
  /** Sessiz kip: Jarvis konuşmaz, yanıtlar yalnız yazıyla (ada/toast) verilir. */
  setQuiet(on: boolean): void;
  /**
   * Ortam kipi: boştayken duyulan söz tur açmadan `voice.ambient` olayıyla yayınlanır. Varsayılan kapalı. Olay ancak
   * politika izin veriyorsa (`policy.ambient.allowed`) ve kullanıcı rıza verdiyse (`Settings.ambientConsentAt`) çıkar.
   */
  setAmbient?(enabled: boolean): void;
  /**
   * Toplantı kipi (toplantı modülü açar/kapatır). Açıkken: Jarvis sesli konuşmaz (yanıt ve bildirim yalnız yazıyla),
   * uyandırma sözü kapalıdır (dinleme yalnız kısayolla/adadan açılır), mikrofonun her sözü ve `system: true` ise
   * bilgisayarın sesi yazıya çevrilip `voice.meeting` ile yayınlanır. Sesli tur her zaman önce yazıya çevrilir.
   * `systemLanguage`: bilgisayar sesinin dili (`auto` = motor sezsin). Durum `VoiceStatus.meeting`'te.
   */
  setMeeting?(options: { on: boolean; system?: boolean; systemLanguage?: string }): void;
  /**
   * Sohbet kipini başlatır: uyandırma sözü olmadan konuşma sürer; "tamam, bu kadar" denince ya da
   * `CONVERSATION_IDLE_SECONDS` sessizlikte biter. `Policy.voice.conversationMode` kapalıysa `false` döner.
   */
  startConversation(): boolean;
  /** Sohbet kipini bitirir → `idle`. */
  endConversation(): void;
  /**
   * Metni seslendirir (bildirim, onay sorusu, deneme). Süren bir tur varsa bitmesini bekler.
   * Çalma bitince ya da atlanınca (sessiz kip, acil durdurma, toplantı) çözülür; `spoken` gerçekten çalındı mı.
   */
  speak(text: string): Promise<{ spoken: boolean }>;

  // ── kurulum sihirbazı ve Ayarlar sınamaları ──
  /** `seconds` boyunca dinler; genlik, konuşma algısı ve (STT hazırsa) döküm döndürür. */
  testMic(deviceId: string | null, seconds: number): Promise<MicTestResult>;
  /** `seconds` boyunca uyandırma sözünü bekler. */
  testWake(seconds: number): Promise<WakeTestResult>;
  /**
   * "Üç kez Hey Jarvis deyin": `samples` örnek dinler, sezici eşiğini ayarlar ve kalıcı kaydeder.
   * Her örnekte `setup.calibrationProgress` yayınlanır.
   */
  calibrateWake(samples: number): Promise<WakeCalibrationResult>;
  /**
   * Yankı sınaması: test cümlesini çalar; yankı engellemeden geçen mikrofonda konuşma algılanırsa bu cihazda
   * söz kesmeyi `wake` kipine indirir (kalıcı). Sonuç `VoiceStatus.bargeIn`'e yansır.
   */
  echoTest(): Promise<EchoTestResult>;
}

// ───────────────────────────── kısayollar ─────────────────────────────

/**
 * Genel kısayolların kaydı. `start()` kısayolları kaydeder, `stop()` bırakır; `settings.changed` ile
 * yeniden kaydeder. Basılınca yalnız `hotkey.pressed` yayınlar. Sınama kipinde kayıt kapalıdır
 * (v1 ve paralel sınamalar aynı kısayolları tutabilir).
 */
export interface HotkeysApi extends Lifecycle {
  status(): HotkeyStatus[];
  /** Kısayolu değiştirir; kayıt başarısızsa eskisi kalır ve `registered: false` döner. */
  rebind(id: HotkeyId, accelerator: string): HotkeyStatus;
}

// ───────────────────────────── toplu tip ─────────────────────────────

export interface Services {
  paths: Paths;
  log: Logger;
  bus: Bus;
  store: Store;
  settings: SettingsApi;
  policy: PolicyApi;
  usage: UsageApi;
  presence: PresenceApi;
  windows: WindowsApi;
  ipc: IpcRegistrar;
  models: ModelsApi;
  attention: AttentionApi;
  memory: MemoryApi;
  scheduler: SchedulerApi;
  jobs: JobsApi;
  stage: StageApi;
  tools: ToolRegistry;
  brain: BrainApi;
  conversation: ConversationApi;
  voice: VoiceApi;
  modules: ModuleRegistry;
  hotkeys: HotkeysApi;
}

/** Fabrika bağımlılıkları: `createMemory(deps: Deps<'store' | 'bus' | 'log'>): MemoryApi`. */
export type Deps<K extends keyof Services> = Pick<Services, K>;

/**
 * Her fabrikanın bağımlılık tipi (yukarıdaki tablonun tip karşılığı). Fabrika imzası:
 * `export function createMemory(deps: ServiceDeps['memory']): MemoryApi`.
 * Bir servise yeni bağımlılık gerekiyorsa burası değişir (orkestra şefi), fabrika değil.
 */
export interface ServiceDeps {
  log: Deps<'paths'>;
  bus: Deps<'log'>;
  store: Deps<'paths' | 'log'>;
  settings: Deps<'store' | 'bus' | 'log'>;
  policy: Deps<'paths' | 'store' | 'settings' | 'bus' | 'log'>;
  usage: Deps<'store' | 'policy' | 'bus' | 'log'>;
  presence: Deps<'settings' | 'bus' | 'log'>;
  windows: Deps<'paths' | 'settings' | 'presence' | 'bus' | 'log'>;
  models: Deps<'paths' | 'policy' | 'bus' | 'log'>;
  attention: Deps<'store' | 'policy' | 'presence' | 'settings' | 'bus' | 'log'>;
  memory: Deps<'store' | 'bus' | 'log'>;
  scheduler: Deps<'store' | 'bus' | 'log'>;
  jobs: Deps<'store' | 'bus' | 'log'>;
  stage: Deps<'bus' | 'log'>;
  tools: Deps<'store' | 'policy' | 'stage' | 'bus' | 'log'>;
  brain: Deps<'policy' | 'tools' | 'memory' | 'usage' | 'presence' | 'bus' | 'log'>;
  conversation: Deps<'store' | 'brain' | 'bus' | 'log'>;
  voice: Deps<
    'policy' | 'settings' | 'models' | 'tools' | 'brain' | 'conversation' | 'usage' | 'windows' | 'paths' | 'bus' | 'log'
  >;
  hotkeys: Deps<'settings' | 'bus' | 'log'>;
  modules: Omit<Services, 'modules'>;
}
