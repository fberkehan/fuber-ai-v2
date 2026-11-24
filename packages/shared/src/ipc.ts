/**
 * Tek tipli IPC sözleşmesi (KURGU §4.3) — masaüstü uygulaması.
 *
 * - `Api`: pencere → ana süreç, istek/yanıt. Kanal adı `alan.eylem`.
 * - `Events`: ana süreç → pencere, tek yönlü.
 * - Preload yalnız `window.fuber = { invoke, on }` açar (`FuberBridge`).
 *
 * Buradaki `Api` çekirdek sözleşmedir ve yalnız orkestra şefi değiştirir. Çekirdek kanalların işleyicisi
 * `apps/desktop/src/main/ipc/handlers/<alan>.ts` içindedir. Bir modül, burada olmayan kendi kanalını
 * kendi klasöründe tip genişletmesiyle tanımlar ve `ModuleDef.ipc` ile bağlar:
 *
 * ```ts
 * declare module '@fuber/shared' {
 *   interface Api { 'web.summarize': { req: { url: string }; res: { text: string } } }
 * }
 * ```
 *
 * İstek gövdesi olmayan kanallarda `req: void`; `invoke('app.info')` biçiminde çağrılır.
 * Bütün yükler yapısal kopyalanabilir düz JSON'dur.
 */

import type { HotkeyId, HudSurface } from './constants';
import type { TtsDevice, TtsEngineId, TtsHostEngineId } from './tts-engines';
import type {
  AppDiagnostics,
  AppInfo,
  AppStatus,
  ApprovalRequest,
  AuthorityLevel,
  AuthorityState,
  ChatMessage,
  ChatSearchHit,
  ChatSession,
  CodeSession,
  CodeSessionHit,
  CodeSessionMessage,
  ControlStatus,
  HotkeyStatus,
  EchoTestResult,
  Id,
  IsoDateTime,
  Job,
  JobActivity,
  LaunchResult,
  LocalDay,
  LocalModelProgress,
  MemoryItem,
  MemoryKind,
  MemorySearchHit,
  MemoryStats,
  MicTestResult,
  ModuleInfo,
  Notification,
  OpenTarget,
  Project,
  Reminder,
  ReminderInput,
  Settings,
  SetupState,
  SetupStepId,
  SkillDetail,
  SkillInfo,
  StageItem,
  Todo,
  TodoInput,
  ToolCallRecord,
  UsageRecord,
  UsageSummary,
  VoiceStatus,
  WakeCalibrationResult,
  WakePath,
  WakeTestResult,
} from './entities';
import type { AudioReport, BusEvents, WindowEvents } from './events';

// `voice.wake` pencerelere de gider (ada "duydum" animasyonu, Tanı). Tipi burada eklenir; yönlendirme için adın
// `events.ts` › `WINDOW_EVENTS` listesine de girmesi gerekir (bütünleştirmede yapılacak).
declare module './events' {
  interface WindowEvents {
    'voice.wake': BusEvents['voice.wake'];
  }
}
import type { Policy } from './policy';

/** Yalnızca işin yapıldığını bildiren yanıt. */
export interface Ok {
  ok: true;
}

export interface Api {
  // ───────── app: sürüm, pencere denetimi, toplu durum ─────────
  'app.info': { req: void; res: AppInfo };
  'app.status': { req: void; res: AppStatus };
  /** Ayarlar › Tanı: son uyandırma (yol, puan), son sesli turun gecikmeleri, son ses hatası. */
  'app.diagnostics': { req: void; res: AppDiagnostics };
  /** Çağıran pencereyi denetler. `close`: ana pencere tepsiye iner, uygulama kapanmaz. */
  'app.window': {
    req: { action: 'minimize' | 'toggleMaximize' | 'close' };
    res: { maximized: boolean };
  };
  /** Ana pencereyi öne getirir; `page` verilirse o sayfaya gider (HUD ve bildirimlerden). */
  'app.openMain': { req: { page?: string }; res: Ok };
  /** Yalnız `http:`/`https:` adresleri varsayılan tarayıcıda açar. */
  'app.openExternal': { req: { url: string }; res: Ok };
  /** Dosya seçme penceresi. İptal edilirse `path: null`. `extensions` noktasız: `['pdf', 'docx']`. */
  'app.pickFile': {
    req: { title: string; extensions?: string[]; directory?: boolean };
    res: { path: string | null };
  };
  /** Acil durdur: konuşmayı, bütün araçları ve arka plan işlerini keser. */
  'app.panic': { req: void; res: Ok };
  /** Uygulamayı tümüyle kapatır (tepsi dahil). */
  'app.quit': { req: void; res: Ok };

  // ───────── hud: ada / toast / sahne pencereleri ─────────
  /**
   * Yüzey, içeriğinin boyutunu bildirir; pencere tam bu boyuta getirilir (pencere = görünen şekil).
   * `width`/`height` CSS pikseli, gölge payı dahil. `0×0` = gösterilecek bir şey yok, pencere gizlenir.
   */
  'hud.resize': { req: { surface: HudSurface; width: number; height: number }; res: Ok };
  /** Sahne içine tıklandı: pencere odak alabilir hale gelir (KURGU §9). */
  'hud.focus': { req: { surface: HudSurface }; res: Ok };
  /**
   * Ada imleç altında çekildi (`on: true`): pencere tıklamayı alttaki uygulamaya geçirir; imleç ayrılınca kapanır.
   * Yalnız ada için ve yalnız karar beklenmeyen hâllerde çağrılır.
   */
  'hud.passthrough': { req: { surface: HudSurface; on: boolean }; res: Ok };

  // ───────── audio: gizli ses penceresi ─────────
  'audio.report': { req: AudioReport; res: Ok };

  // ───────── voice ─────────
  'voice.status': { req: void; res: VoiceStatus };
  /** Dinlemeyi başlatır (ada tıklaması, ana penceredeki düğme). */
  'voice.listen': { req: void; res: VoiceStatus };
  /** Konuşmayı keser. */
  'voice.stop': { req: void; res: VoiceStatus };
  /** Yanıtı kesilen ya da başarısız olan son sözü yeniden yürütür ("Yeniden dene"). Yinelenecek söz yoksa durum değişmez. */
  'voice.retry': { req: void; res: VoiceStatus };
  /** Mikrofonu kapatır/açar. `minutes` yalnız kapatırken: süre dolunca kendiliğinden açılır. */
  'voice.mute': { req: { muted: boolean; minutes?: number }; res: VoiceStatus };
  /** Sessiz kip. Arayüzden açılırken asistan konuşuyorsa hemen susar (`voice/quick.ts`). */
  'voice.setQuiet': { req: { on: boolean }; res: VoiceStatus };
  /**
   * Dinlemeyi duraklatır/sürdürür (sol paneldeki Hızlı kontrol): mikrofon açık kalır, uyandırma sözü yok sayılır ve o an
   * süren dinleme biter. Durum `VoiceStatus.wakePausedUntil`'de; kısayol ve ada yine dinletir.
   */
  'voice.pauseListening': { req: { paused: boolean }; res: VoiceStatus };
  /** Metni seslendirir (Ayarlar'daki "Dene"). `spoken`: gerçekten çalındı mı. */
  'voice.speak': { req: { text: string }; res: { spoken: boolean } };
  /** Sohbet kipini başlatır (ada düğmesi): uyandırma sözü olmadan konuşma sürer. Politika izin vermiyorsa hata. */
  'voice.startConversation': { req: void; res: VoiceStatus };
  /** Sohbet kipini bitirir → `idle`. */
  'voice.endConversation': { req: void; res: VoiceStatus };
  /**
   * Söz kesme sınaması (Ayarlar › Ses): Jarvis hoparlörden üç bölüm okur, kullanıcı her bölümde araya girer. Kaçında
   * sustuğu, kaç ms'de sustuğu ve kendi kendini kesip kesmediği ölçülür; eşik cihaza yazılır. SES ÇALAR: yalnız
   * kullanıcı başlatır.
   */
  'voice.bargeTest': { req: void; res: BargeTestResult };
  /** Ortam kipini açar/kapatır (`VoiceApi.setAmbient`); dönen durumda `ambient` alanı güncel. */
  'voice.setAmbient': { req: { enabled: boolean }; res: VoiceStatus };
  /** Ses hattının tanı özeti (Ayarlar › Tanı): son uyanma, son turun aşama süreleri, motorlar, söz kesme kipi. */
  'voice.diagnostics': { req: void; res: VoiceDiagnosticsReport };
  /**
   * Seslendirme motorları (Ayarlar › Ses): katalog, yürürlükteki seçim ve her motorun bu cihazdaki durumu. Seçim
   * `settings.update({ ttsEngine, ttsVoices })` ile yapılır ve uygulama yeniden başlatılmadan uygulanır.
   */
  'voice.ttsEngines': { req: void; res: TtsEnginesReport };
  /**
   * "Dinle": verilen motor ve sesle kısa bir örnek cümle okur. SES ÇALAR: yalnız kullanıcı düğmeye basınca çağrılır.
   * Motor hazır değilse çalmaz ve nedenini döndürür. ElevenLabs örneği kotadan harcar.
   */
  'voice.ttsPreview': { req: { engine: TtsEngineId; voice?: string }; res: TtsPreviewResult };
  /**
   * Motorun eksik dosyalarını indirir ya da başarısız hazırlığı yeniden dener ("İndir" / "Yeniden dene"). Hemen döner;
   * ilerleme `setup.modelProgress` ile gelir ve `voice.ttsEngines` raporunda görünür. Motor seçiliyse dosyalar
   * hazır olunca kendiliğinden o motora geçilir.
   */
  'voice.ttsPrepare': { req: { engine: TtsEngineId }; res: TtsEnginesReport };
  /** Süren ses motoru indirmesini durdurur (öteki model indirmeleri de durur; yarım dosya sonra kaldığı yerden sürer). */
  'voice.ttsCancelPrepare': { req: void; res: TtsEnginesReport };

  // ───────── chat: yazılı sohbet ─────────
  /**
   * İleti gönderir ve hemen döner; yanıt `chat.stream` olaylarıyla akar (`messageId` ile eşleşir).
   * `sessionId: null` yeni oturum açar.
   * Yazılı sohbetin beyin ayarı sabittir: `deep` rolünün modeli, efor `medium` (`CHAT_ROLE`, `CHAT_EFFORT`).
   */
  'chat.send': {
    /** `attachmentIds`: belge modülünün `documents.attach*` kanallarından dönen ek kimlikleri; varsa `text` boş olabilir. */
    req: { sessionId: Id | null; text: string; attachmentIds?: Id[] };
    res: { sessionId: Id; userMessage: ChatMessage; messageId: Id };
  };
  /** Oturumda süren yanıtı iptal eder. */
  'chat.cancel': { req: { sessionId: Id }; res: Ok };
  /** Yeniden eskiye; `query` başlıkta arar. */
  'chat.sessions': { req: { query?: string; limit: number; offset?: number }; res: ChatSession[] };
  /** Eskiden yeniye; `beforeId` verilirse ondan önceki `limit` ileti. */
  'chat.history': { req: { sessionId: Id; limit: number; beforeId?: Id }; res: ChatMessage[] };
  'chat.search': { req: { query: string; limit: number }; res: ChatSearchHit[] };
  'chat.renameSession': { req: { sessionId: Id; title: string }; res: ChatSession };
  'chat.deleteSession': { req: { sessionId: Id }; res: Ok };

  // ───────── memory ─────────
  'memory.search': { req: { query: string; kinds?: MemoryKind[]; limit: number }; res: MemorySearchHit[] };
  'memory.list': {
    req: { kind?: MemoryKind; pinnedOnly?: boolean; includeSuperseded?: boolean; limit: number; offset?: number };
    res: MemoryItem[];
  };
  /** Kullanıcının elle eklediği kayıt (`source: 'user'`, `confidence: 1`). */
  'memory.save': {
    req: { kind: MemoryKind; text: string; subject?: string | null; tags?: string[]; pinned?: boolean };
    res: MemoryItem;
  };
  'memory.update': {
    req: {
      id: Id;
      patch: Partial<Pick<MemoryItem, 'text' | 'subject' | 'tags' | 'pinned' | 'kind' | 'importance'>>;
    };
    res: MemoryItem;
  };
  /** Kalıcı olarak siler. */
  'memory.forget': { req: { id: Id }; res: Ok };
  'memory.stats': { req: void; res: MemoryStats };

  // ───────── planner: hatırlatıcı + yapılacak ─────────
  /** `from`/`to` `dueAt` aralığıdır (dahil). Durum verilmezse `scheduled` ve `fired`. */
  'planner.listReminders': {
    req: { status?: Reminder['status'][]; from?: IsoDateTime; to?: IsoDateTime };
    res: Reminder[];
  };
  'planner.createReminder': { req: ReminderInput; res: Reminder };
  'planner.updateReminder': { req: { id: Id; patch: Partial<ReminderInput> }; res: Reminder };
  'planner.deleteReminder': { req: { id: Id }; res: Ok };
  /** Tamamlandı işaretler. Tekrarlı hatırlatıcıda yalnız bu seferki kapanır, sonraki an planlı kalır. */
  'planner.completeReminder': { req: { id: Id }; res: Reminder };
  /** Erteler: `dueAt` şimdi + `minutes` olur, durum `scheduled`'a döner. */
  'planner.snoozeReminder': { req: { id: Id; minutes: number }; res: Reminder };
  'planner.listTodos': { req: { includeDone?: boolean }; res: Todo[] };
  'planner.createTodo': { req: TodoInput; res: Todo };
  'planner.updateTodo': { req: { id: Id; patch: Partial<TodoInput> & { done?: boolean } }; res: Todo };
  'planner.deleteTodo': { req: { id: Id }; res: Ok };
  /** Listeyi verilen kimlik sırasına göre yeniden sıralar. */
  'planner.reorderTodos': { req: { ids: Id[] }; res: Ok };


  // ───────── projects: proje dizini + Claude Code oturumları ─────────
  'projects.list': { req: { query?: string; pinnedOnly?: boolean }; res: Project[] };
  /** `Settings.projectsRoot` ve Claude Code oturum klasörünü yeniden tarar. */
  'projects.rescan': { req: void; res: { projects: number; sessions: number } };
  'projects.update': {
    req: { id: Id; patch: Partial<Pick<Project, 'pinned' | 'category' | 'description'>> };
    res: Project;
  };
  'projects.open': { req: { id: Id; target: OpenTarget }; res: LaunchResult };
  /** Yeniden eskiye. */
  'projects.listSessions': {
    req: { projectId?: Id; pinnedOnly?: boolean; category?: string; limit: number; offset?: number };
    res: CodeSession[];
  };
  /** Oturum içeriğinde (kullanıcı ve asistan metni) tam metin arama. */
  'projects.searchSessions': { req: { query: string; projectId?: Id; limit: number }; res: CodeSessionHit[] };
  /** Oturum ve son `limit` iletisi (eskiden yeniye). */
  'projects.getSession': {
    req: { id: string; limit: number };
    res: { session: CodeSession; messages: CodeSessionMessage[] };
  };
  'projects.updateSession': {
    req: { id: string; patch: Partial<Pick<CodeSession, 'pinned' | 'category' | 'title'>> };
    res: CodeSession;
  };
  /** Oturumu Windows Terminal'de `claude --resume` ile açar. */
  'projects.openSession': { req: { id: string }; res: LaunchResult };
  /** Kullanılan bütün kategori adları (proje ve oturumlar). */
  'projects.categories': { req: void; res: string[] };
  /** Projede arka planda Claude Code görevi başlatır. */
  'projects.startTask': { req: { projectId: Id; prompt: string }; res: Job };

  // ───────── skills: Atölye ─────────
  'skills.list': { req: void; res: SkillInfo[] };
  'skills.get': { req: { id: string }; res: SkillDetail };
  /** Yeni yetenek yapımını başlatır; ilerleme `job.progress` ve `skills.changed` ile izlenir. */
  'skills.build': { req: { goal: string }; res: Job };
  /** `pending_approval` yeteneği onaylar (yüklenir) ya da reddeder (`disabled` kalır). */
  'skills.approve': { req: { id: string; approve: boolean }; res: SkillInfo };
  'skills.setEnabled': { req: { id: string; enabled: boolean }; res: SkillInfo };
  /** Yeteneği diskten siler. */
  'skills.remove': { req: { id: string }; res: Ok };

  // ───────── modules ─────────
  'modules.list': { req: void; res: ModuleInfo[] };
  /** Yerel aç/kapat. Politikanın kapattığı modül açılamaz (hata döner). */
  'modules.setEnabled': { req: { id: string; enabled: boolean }; res: ModuleInfo };
  /** Modülün kullanıcı verisini kalıcı olarak siler; modül kapalıyken de çalışır (`ModulesApi.purgeData`). */
  'modules.purgeData': { req: { id: string }; res: Ok };

  // ───────── stage ─────────
  'stage.items': { req: void; res: StageItem[] };
  /** `id: null` hepsini kapatır. */
  'stage.close': { req: { id: Id | null }; res: Ok };
  /** Karttaki eylem düğmesine basıldı. */
  'stage.action': { req: { itemId: Id; actionId: string }; res: Ok };

  // ───────── attention: bildirimler ve onaylar ─────────
  /** Açılışta ve pencere yeniden yüklenince ekranda olması gerekenler. */
  'attention.pending': { req: void; res: { notifications: Notification[]; approvals: ApprovalRequest[] } };
  /** Çözülmüşler dahil son bildirimler (Bugün sayfası). */
  'attention.recent': { req: { limit: number }; res: Notification[] };
  'attention.dismiss': { req: { id: Id }; res: Ok };
  /**
   * Bildirimi kapat VE sustur (ada kartının ✕'i: `id`; sol paneldeki Hızlı kontrol: `id` yok = o an görünen bütün
   * kartlar). Konuşma (duyuru dahil, sıradakiler de) kesilir, hat boşa döner, çentik kapanır (`voice/quick.ts`).
   */
  'attention.hush': { req: { id?: Id }; res: { dismissed: number } };
  'attention.act': { req: { id: Id; actionId: string }; res: Ok };
  /** Onay kartının yanıtı. */
  'attention.resolveApproval': { req: { id: Id; approve: boolean; scope?: 'task' }; res: Ok };
  /** Yürürlükteki yetki düzeyi (ayar + geçici yükseltme + Yönetim sınırı). */
  'authority.get': { req: void; res: AuthorityState };
  /**
   * Yetkiyi değiştirir. `level` kalıcı ayardır; `minutes` ya da `task` geçici Tam yetki verir; `clearGrant` geçici
   * yükseltmeyi kaldırır. Arayüzden gelen istek kullanıcının kendi açık eylemidir (ayrıca onay sorulmaz).
   */
  'authority.set': { req: { level?: AuthorityLevel; minutes?: number; task?: boolean; clearGrant?: boolean }; res: AuthorityState };

  // ───────── jobs ─────────
  'jobs.list': { req: { status?: Job['status']; limit: number }; res: Job[] };
  'jobs.cancel': { req: { id: Id }; res: Ok };
  /** Arka plan işlerinin o anki özeti (ada açılışta bununla başlar; sonrası `job.activity` olayı). */
  'jobs.activity': { req: void; res: JobActivity };

  // ───────── tools: tanı ─────────
  /** Son araç çağrıları (Ayarlar › Tanı). */
  'tools.recent': { req: { limit: number }; res: ToolCallRecord[] };

  // ───────── settings ─────────
  'settings.get': { req: void; res: Settings };
  'settings.update': { req: { patch: Partial<Settings> }; res: Settings };
  /** Yürürlükteki politikanın anahtarsız kopyası (asistan adı, hitap, modeller, modül bayrakları). */
  'settings.policy': { req: void; res: Policy };
  'settings.hotkeys': { req: void; res: HotkeyStatus[] };
  /** Kısayolu değiştirir; kayıt başarısızsa eskisi kalır ve `registered: false` döner. */
  'settings.rebindHotkey': { req: { id: HotkeyId; accelerator: string }; res: HotkeyStatus };
  /** Veri klasörünü Dosya Gezgini'nde açar. */
  'settings.openDataDir': { req: void; res: Ok };
  /** Günlük klasörünü Dosya Gezgini'nde açar (Ayarlar › Tanı). */
  'settings.openLogsDir': { req: void; res: Ok };

  // ───────── setup: kurulum sihirbazı ─────────
  'setup.state': { req: void; res: SetupState };
  /** Bir adımı tamamlandı işaretler ve sıradaki adımı döndürür. */
  'setup.completeStep': { req: { step: SetupStepId }; res: SetupState };
  /** Gereken yerel modellerin durumu. */
  'setup.models': { req: void; res: LocalModelProgress[] };
  /** Eksik modelleri indirmeye başlar; ilerleme `setup.modelProgress` ile gelir. `ids` yoksa gereken hepsi. */
  'setup.downloadModels': { req: { ids?: string[] }; res: LocalModelProgress[] };
  'setup.cancelDownloads': { req: void; res: Ok };
  /** `seconds` boyunca dinler; genlik, konuşma algısı ve (STT hazırsa) döküm döner. */
  'setup.testMic': { req: { deviceId: string | null; seconds: number }; res: MicTestResult };
  /** `seconds` boyunca uyandırma sözünü bekler. */
  'setup.testWake': { req: { seconds: number }; res: WakeTestResult };
  /**
   * "Üç kez Hey Jarvis deyin": `samples` (varsayılan 3) örnek dinler, sezici eşiğini kullanıcının sesine
   * ayarlar ve kaydeder. Her örnek için `setup.calibrationProgress` olayı gelir; çağrı bitince sonuç döner.
   */
  'setup.calibrateWake': { req: { samples?: number }; res: WakeCalibrationResult };
  /**
   * Yankı sınaması: kısa bir test cümlesi çalınır; yankı engellemeden geçen mikrofonda konuşma algılanırsa
   * söz kesme bu cihazda `wake` kipine indirilir. Sonuç hem döner hem uygulanır.
   */
  'setup.echoTest': { req: void; res: EchoTestResult };
  /** Sihirbazı bitirir: kurulum penceresi kapanır, ses hattı başlar. */
  'setup.finish': { req: void; res: SetupState };

  // ───────── usage ─────────
  'usage.today': { req: void; res: UsageSummary };
  /** Bugün dahil son `days` gün, yeniden eskiye. */
  'usage.summary': { req: { days: number }; res: UsageSummary[] };
  'usage.recent': { req: { limit: number }; res: UsageRecord[] };

  // ───────── control: kontrol servisi bağlantısı ─────────
  'control.status': { req: void; res: ControlStatus };
  /** Cihazı kaydeder (gerekirse) ve politikayı çeker. `url` verilirse ayara yazılır. */
  'control.connect': { req: { url?: string }; res: ControlStatus };
  /** Politikayı hemen yeniden çeker. */
  'control.refresh': { req: void; res: ControlStatus };
  /**
   * Fuber Yönetim 2'yi başlatır (kurulumda ve anahtar yokken gösterilen "Yönetim'i aç" düğmesi).
   * Kurulu değilse `ok: false` ve nedenini söyleyen ileti döner.
   */
  'control.launchAdmin': { req: void; res: LaunchResult };
}

export interface BargeTestResult {
  /** Sınama yapılabildi mi. */
  ok: boolean;
  /** Okunan bölüm sayısı ve kullanıcı araya girince Jarvis'in sustuğu bölüm sayısı. */
  trials: number;
  stopped: number;
  /** Jarvis'in kendi sesiyle sustuğu (kullanıcı konuşmadan) sayı. */
  selfInterrupts: number;
  /** Sözün başından susmaya geçen süreler (ms) ve ortancası. */
  latenciesMs: number[];
  medianMs: number | null;
  /** Sınamadan sonra yürürlükteki söz kesme kipi. */
  bargeIn: 'voice' | 'wake' | 'off';
  /** Kullanıcıya gösterilecek Türkçe özet. */
  message: string;
}

export interface VoiceWakeLatency {
  sinceSpeechStartMs: number | null;
  sinceSpeechEndMs: number | null;
  sttMs: number | null;
  at: IsoDateTime;
}

/**
 * `voice.diagnostics` kanalının yanıtı. Süreler ms; ölçülemediyse `null`. Anahtar ya da başka bir sır içermez.
 */
export interface VoiceDiagnosticsReport {
  wake: {
    /** Son uyanma: hangi yoldan (`kws` sezici / `whisper` döküm), hangi sözle, hangi puanla. */
    last: { path: WakePath; phrase: string; score: number; at: IsoDateTime } | null;
    /** Yürürlükteki sezici eşiği (kalibrasyon değiştirir). */
    threshold: number;
    calibratedAt: IsoDateTime | null;
    /** Kalibrasyonda öğrenilen, kullanıcıya özel yazımlar. */
    learned: string[];
    /**
     * İki uyandırma yolunun son ölçülen gecikmesi. `sinceSpeechStartMs`: sözün başından uyanmaya; `sinceSpeechEndMs`:
     * sözün bitişinden uyanmaya (sezici söz bitmeden uyandırır: `null`); `sttMs`: Whisper yolunda yazıya çevirme.
     */
    latency?: { kws: VoiceWakeLatency | null; whisper: VoiceWakeLatency | null };
    /** Kalibrasyonun seçtiği sezici duyarlık profili (`standard` / `sensitive` / `max`); kalibrasyon yoksa `null`. */
    profile?: string | null;
  };
  /** Kendi sesini duymaya karşı korumalar: çalma sonrası koruma süresi, sayaçlar, yankı engelleme kipi. */
  echoGuard?: {
    /** Çalma bittikten sonra gelen sesin Jarvis'in kendi sesi sayıldığı süre (ms). */
    guardMs: number;
    /** Çalma bitince atılan söz toplama sayısı. */
    cuts: number;
    /** Jarvis'in kendi sesi olduğu için tur açmayan söz sayısı. */
    dropped: number;
    /** Başındaki yankı ayıklanıp kalanı komut sayılan söz sayısı. */
    trimmed: number;
    /** Jarvis'in kendi sesiyle kendini kestiği anlaşılan söz kesme sayısı. */
    selfInterrupts: number;
    last: { at: IsoDateTime; kind: 'guard' | 'echo' | 'partial' | 'self_interrupt'; heard: string; coverage: number | null } | null;
    aec: {
      /** Cihaz için seçili yankı engelleme kipi ve tarayıcının gerçekten uyguladığı. */
      mode: 'default' | 'all';
      applied: string | null;
      /** Çıkış aygıtının bildirdiği gecikme (ms); Bluetooth'ta gerçek gecikme bundan büyüktür. */
      outputLatencyMs: number | null;
      /** Yankı sınamasında sızan sesin çalma bittikten sonra sürdüğü süre (ms). */
      tailMs: number | null;
      /** Olağan kip sızdırınca "bütün sesleri bastır" kipi de denendiyse sonucu. */
      allMode: { leaked: boolean; playbackRms: number } | null;
      /** Sızıntı yankı sınamasıyla değil, Jarvis kendini kesince mi anlaşıldı. */
      observed: boolean;
    };
    /** Referanslı yankı giderici: öğrendi mi, kestirdiği hoparlör → mikrofon gecikmesi, yankı bastırma, düzey kapısı. */
    canceller?: {
      trained: boolean;
      converged: boolean;
      delayMs: number;
      erleDb: number;
      gate: number;
      /** Referansla mikrofon arasında ilinti bulundu mu; bulunan en iyi zarf ilintisi (eşik 0,7) ve yeri (ms). */
      coupled?: boolean;
      corr?: number | null;
      corrLagMs?: number | null;
    } | null;
    /** Söz kesme `wake`e indiyse nedeni; `voice` ise `null`. */
    wakeReason?: 'echo_test' | 'self_interrupt' | 'barge_test' | null;
    /** Son söz kesme sınaması. */
    bargeTest?: { stopped: number; trials: number; selfInterrupts: number; medianMs: number | null; at: IsoDateTime } | null;
  };
  /** Son sesli turun aşamaları. */
  turn: {
    at: IsoDateTime;
    /** Sözün bittiğinin anlaşılması için beklenen sessizlik. */
    endSilenceMs: number;
    sttMs: number | null;
    /** Döküm hazır → beynin ilk tam cümlesi. */
    brainFirstSentenceMs: number | null;
    /** Seslendirme motorunun cümleyi aldığı andan ilk ses parçasına. */
    ttsFirstChunkMs: number | null;
    /** İlk cümle → hoparlörde ilk ses. */
    ttsFirstAudioMs: number | null;
    /** Son sesli çerçeve → ilk ses. */
    totalMs: number | null;
    interrupted: boolean;
  } | null;
  engines: {
    stt: { id: string; state: 'stopped' | 'starting' | 'ready' | 'restarting' | 'failed'; gpu: boolean | null; reason: string | null };
    /** Uyandırmanın iki yolu çalışıyor mu. */
    wake: { kws: boolean; whisper: boolean };
    tts: {
      /** Seçili motor: cihaz ayarı (Ayarlar › Ses) varsa o, yoksa politikanın varsayılanı. */
      provider: TtsEngineId;
      /** Seçimin kaynağı. */
      source?: 'device' | 'policy';
      /** Şu an cümleleri GERÇEKTEN seslendiren motor (seçili motor kullanılamıyorsa zincirde bir alttaki). */
      active: TtsEngineId;
      /** Etkin motorun çalıştığı yer: `cuda` / `directml` ekran kartı, `cpu` işlemci, `cloud` bulut. */
      device?: TtsDevice | null;
      /** Etkin motorda kullanılan ses (Supertonic: `M4`). */
      voice?: string | null;
      /** Herhangi bir yerel ses (ekran kartı motoru ya da Piper) kullanılabilir mi. */
      local: boolean;
      /**
       * Ses konağı (ekran kartı motorlarının süreci). `attempts`: denenip açılamayan cihazlar ve nedenleri
       * (düşüş zinciri: CUDA → DirectML → işlemci). Konak hiç istenmediyse `null`.
       */
      host?: {
        engine: TtsHostEngineId;
        phase: 'off' | 'starting' | 'ready' | 'failed';
        device: TtsDevice | null;
        reason: string | null;
        attempts: Array<{ device: TtsDevice; error: string }>;
        /** Modellerin yüklenmesi ve ısınma (ms). */
        loadMs: number | null;
        warmMs: number | null;
        restarts: number;
      } | null;
      voiceId: string | null;
      model: string | null;
      /** Bulut sağlayıcının anahtarı politikada var mı (anahtarın kendisi hiçbir zaman yer almaz). */
      hasKey: boolean;
      /**
       * Buluttan yerel sese düşüldüyse nedeni (`reason` kod, `message` Türkçe) ve yeniden deneme anı. Anahtar yokken
       * `reason: 'no_key'` (kullanıcıya bildirilmez; yalnız burada görünür).
       */
      fallback: { reason: string; message: string; until: IsoDateTime | null } | null;
      /** Bu oturumda bulut sağlayıcının faturaladığı karakter. */
      charsBilled: number;
    };
    worker: { ready: boolean; restarts: number };
    microphone: { capturing: boolean; error: string | null };
  };
  bargeIn: {
    policy: 'voice' | 'wake' | 'off';
    /** Yürürlükteki kip: yankı sızıyorsa politika `voice` olsa da `wake`. */
    effective: 'voice' | 'wake' | 'off';
    /** Son yankı sınaması; hiç yapılmadıysa `null`. Düzeyler 0–1 RMS. */
    echo: { leaked: boolean; baselineRms: number; playbackRms: number; at: IsoDateTime } | null;
  };
}

/** Bir seslendirme motorunun bu cihazdaki durumu (Ayarlar › Ses listesi). */
export interface TtsEngineStatus {
  id: TtsEngineId;
  /** Kullanıcıya gösterilen ad ve kısa açıklama ("Supertonic 3" · "yerel, ekran kartı"). */
  label: string;
  hint: string;
  /** Seçilirse şu an konuşabilir mi. */
  available: boolean;
  /** Konuşamıyorsa nedeni (Türkçe; "Model iniyor: %40"). */
  reason: string | null;
  /** Model ve çalışma zamanı dosyaları: hazır · hazırlanıyor (iniyor / doğrulanıyor) · eksik · gerekmiyor (bulut). */
  files: 'ready' | 'preparing' | 'missing' | 'none';
  /** Hazırlanıyorsa ilerleme (0–1). */
  progress: number | null;
  /** Motorun (çalışıyorsa gerçekten, çalışmıyorsa ilk denenecek) cihazı. */
  device: TtsDevice | null;
  /** Motor ses konağında şu an yüklü ve çalışıyor mu. */
  running: boolean;
  voices: Array<{ id: string; label: string }>;
  /** Bu motorda yürürlükteki ses. */
  voice: string | null;
  /** "Dinle" şu an çalışır mı. */
  previewable: boolean;
  /**
   * Arayüzün göstereceği TEK durum (rozet). `speaking`: şu an bu motor konuşuyor · `ready`: seçilirse konuşur ·
   * `downloading` / `verifying`: dosyaları hazırlanıyor · `missing`: dosyaları yok (indirilebilir) · `failed`:
   * indirme ya da yükleme başarısız (neden `reason`'da; yeniden denenebilir) · `loading`: dosyaları hazır, ekran
   * kartına yükleniyor · `unavailable`: şu an kullanılamaz (anahtar yok, ses hattı kapalı).
   */
  state: 'speaking' | 'ready' | 'downloading' | 'verifying' | 'missing' | 'failed' | 'loading' | 'unavailable';
  /** Dosyalarının boyutu (bayt): bu bilgisayarda hazır olan / toplam. Dosya gerektirmeyen motorda (bulut) `null`. */
  bytes: { received: number; total: number } | null;
  /** "İndir" / "Yeniden dene" (`voice.ttsPrepare`) bu motor için anlamlı mı. */
  canPrepare: boolean;
}

export interface TtsEnginesReport {
  /** Yürürlükteki seçim ve kaynağı (`device`: Ayarlar › Ses · `policy`: Fuber Yönetim'in varsayılanı). */
  selected: TtsEngineId;
  source: 'device' | 'policy';
  /** Fuber Yönetim'in varsayılanı (cihaz seçimi kaldırılırsa buna dönülür). */
  policy: TtsEngineId;
  /** O an gerçekten konuşan motor ve cihazı. */
  active: TtsEngineId;
  activeDevice: TtsDevice | null;
  /** Seçili motor konuşmuyorsa (düşüş) nedeni; konuşuyorsa `null`. */
  note: string | null;
  engines: TtsEngineStatus[];
}

export interface TtsPreviewResult {
  ok: boolean;
  /** Örneği gerçekten okuyan motor ve cihazı. */
  engine: TtsEngineId | null;
  device: TtsDevice | null;
  /** Çalınamadıysa nedeni (Türkçe). */
  message: string | null;
}

/**
 * Ana süreçten pencerelere giden olaylar. `WindowEvents` bir arayüzdür; modül kendi olayını
 * tip genişletmesiyle ekleyebilir (bkz. `docs/TUZAKLAR.md`, "Modüle özgü IPC").
 */
export type Events = WindowEvents;

export type ApiChannel = keyof Api;
export type EventName = keyof Events;

/** Bir kanal haritasından istek / yanıt tipini çıkarır. */
export type ReqOf<A, K extends keyof A> = A[K] extends { req: infer R } ? R : never;
export type ResOf<A, K extends keyof A> = A[K] extends { res: infer R } ? R : never;

/**
 * Preload'un `window.fuber` olarak açtığı köprü. Kanal ve olay haritası uygulamaya göre değişir
 * (masaüstü: `Api`/`Events`; yönetim: `AdminApi`/`AdminEvents`).
 */
export interface Bridge<A, E> {
  /**
   * Ana süreçteki işleyiciyi çağırır. İşleyici hata verirse `Error` ile reddedilir;
   * `message` kullanıcıya gösterilebilir Türkçe metindir.
   */
  invoke<K extends keyof A>(
    channel: K,
    ...payload: ReqOf<A, K> extends void ? [] : [payload: ReqOf<A, K>]
  ): Promise<ResOf<A, K>>;
  /** Olayı dinler; dönen işlev aboneliği kaldırır. */
  on<K extends keyof E>(event: K, listener: (payload: E[K]) => void): () => void;
}

export type FuberBridge = Bridge<Api, Events>;

/** Ana süreç ↔ preload arasındaki zarf. Hata, Electron'un ileti bozmasına uğramasın diye veri olarak taşınır. */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: IpcError };

export interface IpcError {
  /**
   * `unknown_channel` kayıtlı işleyici yok · `forbidden` bu pencere bu kanalı çağıramaz ·
   * `handler_error` işleyici hata verdi.
   */
  code: 'unknown_channel' | 'forbidden' | 'handler_error';
  channel: string;
  /** Kullanıcıya gösterilebilir Türkçe metin. */
  message: string;
}
