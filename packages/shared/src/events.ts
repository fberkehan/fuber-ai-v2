/**
 * Tipli olay haritası. Ana süreçte `Bus` bu olayları taşır; `WINDOW_EVENTS` içindekiler (ve yüklü
 * modüllerin `ModuleDef.windowEvents` ile bildirdikleri) ayrıca pencerelere aktarılır
 * (`window.fuber.on(...)`). Adlandırma: `alan.eylem`.
 * Yükler düz JSON'dur; pencereye giden her şey yapısal kopyalanabilir olmalıdır.
 */

import type { HotkeyId, HudSurface, WindowKind } from './constants';
import type {
  ApprovalDecision,
  ApprovalKind,
  ApprovalRequest,
  AttentionChannel,
  AuthorityLevel,
  AuthorityState,
  BrainStatus,
  Channel,
  ChatMessage,
  ControlStatus,
  Id,
  IsoDateTime,
  Job,
  JobActivity,
  JsonObject,
  LocalModelProgress,
  MemoryKind,
  Notification,
  PresenceState,
  Risk,
  Settings,
  SetupState,
  StageItem,
  ToolOrigin,
  UsageRecord,
  UsageSummary,
  VoiceActivity,
  VoiceState,
  VoiceStateReason,
  VoiceStatus,
  VoiceTurnMetrics,
  WakeCalibrationProgress,
  WakePath,
} from './entities';

/** Bir varlık listesinin değiştiğini bildirir; arayüz ilgili listeyi yeniden çeker. */
export interface EntityChange<E extends string = string> {
  entity: E;
  op: 'created' | 'updated' | 'deleted';
  ids: Id[];
}

/** Sohbet akışı (yazılı ve sesli turlar). Bir asistan iletisi `messageId` ile izlenir. */
export type ChatStreamEvent =
  /** Tur başladı; kullanıcı iletisi kaydedildi. */
  | { kind: 'start'; sessionId: Id; messageId: Id; userMessage: ChatMessage }
  /** Asistan metninden yeni parça. */
  | { kind: 'text'; sessionId: Id; messageId: Id; delta: string }
  /** Araç etkinliği. `step`: aracın bildirdiği ara durum. */
  | {
      kind: 'tool';
      sessionId: Id;
      messageId: Id;
      callId: Id;
      name: string;
      phase: 'start' | 'report' | 'end';
      ok?: boolean;
      step?: string;
    }
  /** Tur bitti; `message` kaydedilen son halidir (iptalde `interrupted: true`). */
  | { kind: 'done'; sessionId: Id; messageId: Id; message: ChatMessage }
  /** Tur yanıt üretemeden bitti. `error` kullanıcıya gösterilecek Türkçe metindir. */
  | { kind: 'error'; sessionId: Id; messageId: Id; error: string };

export interface BusEvents {
  // ── uygulama ──
  /**
   * Acil durdur (Ctrl+Alt+Q, tepsi ya da IPC). `voice`, `tools` ve `jobs` bunu dinler:
   * konuşma, bütün araç çağrıları ve arka plan işleri kesilir.
   */
  'app.panic': { at: IsoDateTime; source: 'hotkey' | 'ui' | 'tray' };
  /** Ana pencereye "şu sayfaya git" (tepsi menüsü, bildirim eylemi, `app.openMain`). */
  'app.navigate': { page: string; params?: JsonObject };
  /** Genel kısayola basıldı. `talk` ve `mute`'u `voice`, `panic`'i `main.ts` karşılar. */
  'hotkey.pressed': { id: HotkeyId };

  // ── ses ──
  /** Durum makinesi geçişi (KURGU §5.1). Ada, tepsi ve ana pencere bunu dinler. */
  'voice.state': { state: VoiceState; prev: VoiceState; reason: VoiceStateReason; at: IsoDateTime };
  /** Durum dışındaki ses bilgisi değişti (mikrofon, sessiz kip, hazır olma, aygıt). */
  'voice.status': VoiceStatus;
  /**
   * Canlı yazı satırı. `user`: STT ara/son sonucu; `assistant`: seslendirilmekte olan cümle.
   * `final: true` o turdaki o rolün son hali.
   */
  'voice.partial': { turnId: Id; role: 'user' | 'assistant'; text: string; final: boolean };
  /** Genlik (dalga animasyonu için), saniyede ~30 kez. `rms` 0–1. Yalnız HUD ve ana pencere dinlemeli. */
  'voice.level': { source: 'mic' | 'speaker'; rms: number };
  /** Uyandırma sözü algılandı. `score` 0–1 (Whisper yolunda 1); `path` hangi yoldan algılandığı. */
  'voice.wake': { phrase: string; score: number; path: WakePath; at: IsoDateTime };
  /** Sesli tur bitti; ölçülen gecikmeler. */
  'voice.turn': VoiceTurnMetrics;
  /**
   * Ortam kipi (`voice.setAmbient`): asistan boştayken duyulan ve uyandırma sözüyle başlamayan söz, tur AÇMADAN
   * yazıya çevrilip yayınlanır. Mikrofon kapalıyken, dinleme duraklatılmışken, asistan konuşurken ve kendi sesinin
   * yankısında olay çıkmaz. Ses diske yazılmaz; yalnız metin taşınır.
   */
  'voice.ambient': VoiceAmbientEvent;
  /**
   * Toplantı kipi (`voice.setMeeting`): mikrofonun ("Siz") ve bilgisayar sesinin ("Karşı taraf") her sözü tur AÇMADAN
   * yazıya çevrilip yayınlanır. Ses diske yazılmaz; yalnız metin taşınır.
   */
  'voice.meeting': VoiceMeetingEvent;
  /**
   * Hat iletisi. `message` Türkçe ve kullanıcıya gösterilebilir. `level: 'info'` hata DEĞİLDİR (ör. `tts_fallback`:
   * bulut ses yerine yerel sesle konuşuluyor): arayüz bunu sakin bir bilgi olarak gösterir, hata rozeti/kırmızı
   * kullanmaz ve `VoiceStatus.lastError` değişmez. Alan yoksa `error` sayılır.
   */
  'voice.error': { code: string; message: string; level?: 'info' | 'error'; retry?: boolean };
  /**
   * Süren sesli turun canlı adımı (ada "ne yapıyor" satırı): `step` Türkçe kısa cümle ("WhatsApp’ı açıyorum"), tur
   * bitince `null`. `failed`: son başarısız adımın nedeni (kısa). `tools`: bu turda biten adım sayısı.
   */
  'voice.activity': VoiceActivity;
  /** Yetki düzeyi değişti (ayar, geçici yükseltme, Yönetim sınırı). */
  'authority.changed': AuthorityState;
  /** Kapı bir onayı sormadan verdi (yetki düzeyi gereği); denetim günlüğü. */
  'tool.approval.auto': { toolName: string; moduleId: string; kind: ApprovalKind; level: AuthorityLevel; summary: string; origin: ToolOrigin };

  // ── beyin ──
  /** Asistanın beyni değişti (buluttan yerele düşüş, anahtar geldi, yerel model hazır oldu, durduruldu). */
  'brain.status': BrainStatus;

  // ── sohbet ──
  'chat.stream': ChatStreamEvent;
  /** Bir tur tamamlandı (iptal dahil). Hafıza yazıcısı bunu dinleyip çıkarım yapar. */
  'conversation.turn': {
    sessionId: Id;
    channel: Channel;
    userMessageId: Id;
    assistantMessageId: Id;
    interrupted: boolean;
  };
  /** Oturum listesi değişti (yeni oturum, ad, silme). */
  'chat.changed': EntityChange<'session'>;

  // ── politika, ayar, kontrol ──
  /** Yeni politika yürürlükte. `changedKeys`: değişen üst düzey alanlar (`persona`, `voice`, `modules`…). */
  'policy.changed': { revision: number; source: 'remote' | 'cache' | 'embedded'; changedKeys: string[] };
  'settings.changed': { settings: Settings; changedKeys: Array<keyof Settings> };
  'control.status': ControlStatus;

  // ── dikkat ──
  /** Bildirim şimdi gösterilecek. `channel` nerede gösterileceğini söyler (`deferred` hiç yayınlanmaz). */
  'attention.notify': { notification: Notification; channel: Exclude<AttentionChannel, 'deferred'> };
  /** Bildirim ekrandan kalkmalı. */
  'attention.dismiss': { id: Id; reason: 'user' | 'action' | 'timeout' | 'replaced' | 'presence' };
  /** Kullanıcı bir eylem seçti; bildiren modül `moduleId` ile süzer. */
  'attention.action': { id: Id; moduleId: string; actionId: string; data: JsonObject };
  'presence.changed': PresenceState;

  // ── araçlar ──
  /** Araç çağrısı başladı/bitti. `ok` ve `durationMs` yalnız `end`'de. */
  'tool.call': {
    callId: Id;
    name: string;
    moduleId: string;
    risk: Risk;
    origin: ToolOrigin;
    phase: 'start' | 'end';
    ok?: boolean;
    durationMs?: number;
  };
  /** Onay bekleniyor: ada onay kartı gösterir, ses "onaylıyor musunuz?" diye sorar. */
  'tool.approval.request': ApprovalRequest;
  /** Onay sonuçlandı; kart kalkar. */
  'tool.approval.resolve': { id: Id; decision: ApprovalDecision; by: 'voice' | 'ui' | 'timeout' | 'system' };

  // ── işler, modüller ──
  /** İşin her durum/ilerleme değişimi (başlangıç ve bitiş dahil). */
  'job.progress': { job: Job };
  /** Arka plan işlerinin o anki özeti değişti (adım, ilerleme, başlama, bitiş): ada bunu gösterir. */
  'job.activity': JobActivity;
  /** Modül yüklendi/kapandı; gezinme ve araç listesi yenilenir. */
  'module.changed': { id: string; enabled: boolean; reason: 'policy' | 'user' | 'error' | 'added' | 'removed' };

  // ── veri değişimleri ──
  'memory.changed': { op: 'created' | 'updated' | 'deleted' | 'superseded'; ids: Id[]; kind: MemoryKind };
  'planner.changed': EntityChange<'reminder' | 'todo'>;
  'projects.changed': EntityChange<'project' | 'session'>;
  'skills.changed': EntityChange<'skill'>;

  // ── sahne ──
  'stage.show': { item: StageItem };
  /** `id: null` = bütün sahne kapandı. */
  'stage.close': { id: Id | null };
  /** Kartta eylem düğmesine basıldı; kartı gösteren modül `moduleId` ile süzer. */
  'stage.action': { itemId: Id; moduleId: string; actionId: string };

  // ── kullanım ──
  'usage.recorded': { record: UsageRecord; today: UsageSummary };

  // ── kurulum ──
  'setup.changed': SetupState;
  'setup.modelProgress': LocalModelProgress;
  /** Uyandırma kalibrasyonunun her adımı (`setup.calibrateWake` sürerken). */
  'setup.calibrationProgress': WakeCalibrationProgress;

  // ── pencereler ──
  /** Bir pencere açıldı/kapandı (ör. ana pencere tepsiye indi). */
  'window.changed': { kind: WindowKind; open: boolean };
  /**
   * İmlecin HUD yüzeyine göre konumu (DIP): `x` yüzeyin yatay merkezine, `y` üst kenarına göre. Yalnız yüzey
   * görünürken ve yalnız o yüzeyin penceresine yollanır (veri yoluna yayınlanmaz). Ada bununla imlece bakar ve
   * imleç üstüne gelince çekilir.
   */
  'hud.pointer': { surface: HudSurface; x: number; y: number };
  /**
   * Ada durumunu kim gösteriyor. `main`: ana pencere görünür, küçültülmemiş ve odakta; yüzen ada gizlidir, durum (ve
   * onay kartı, Durdur/Sustur) ana pencerenin kendi çentiğindedir. `island`: ana pencere odakta değil, küçültülmüş ya da
   * kapalı; yüzen ada ekranın üst ortasındadır. Yalnız değişince yayınlanır.
   */
  'hud.owner': { owner: 'main' | 'island' };
}

export type BusEventName = keyof BusEvents;

/**
 * Pencerelere aktarılan olaylar. Burada olmayanlar ana süreçte kalır.
 * `voice.level` yüksek sıklıklıdır; pencere yöneticisi onu yalnız HUD ve ana pencereye yollar.
 */
export const WINDOW_EVENTS = [
  'app.navigate',
  'voice.state',
  'voice.status',
  'voice.partial',
  'voice.level',
  'voice.wake',
  'voice.turn',
  'voice.error',
  'voice.activity',
  'authority.changed',
  'brain.status',
  'chat.stream',
  'chat.changed',
  'policy.changed',
  'settings.changed',
  'control.status',
  'attention.notify',
  'attention.dismiss',
  'presence.changed',
  'tool.call',
  'tool.approval.request',
  'tool.approval.resolve',
  'job.progress',
  'job.activity',
  'module.changed',
  'memory.changed',
  'planner.changed',
  'projects.changed',
  'skills.changed',
  'stage.show',
  'stage.close',
  'usage.recorded',
  'setup.changed',
  'setup.modelProgress',
  'setup.calibrationProgress',
  'window.changed',
  'hud.pointer',
  'hud.owner',
] as const satisfies readonly BusEventName[];

export type WindowEventName = (typeof WINDOW_EVENTS)[number];

export interface VoiceAmbientEvent {
  id: Id;
  text: string;
  /** Sözün başladığı ve bittiği an (son sesli çerçeve). */
  startedAt: IsoDateTime;
  endedAt: IsoDateTime;
  durationMs: number;
  /** Yazıya çevirmenin dili (`persona.language`). */
  lang?: string;
  /** Sesin Türkçe ya da İngilizce olma olasılığı (0–1); motor vermiyorsa `null`. */
  languageConfidence?: number | null;
  source: 'mic';
}

export interface VoiceMeetingEvent {
  id: Id;
  text: string;
  /** `mic`: kullanıcı ("Siz") · `system`: bilgisayarın sesi ("Karşı taraf"). */
  source: 'mic' | 'system';
  startedAt: IsoDateTime;
  endedAt: IsoDateTime;
  durationMs: number;
  /** Yazıya çevirmenin istenen dili (`tr`, `en`, `auto`…). */
  lang?: string;
  /** Motorun sezdiği dil (ISO 639-1); bilinmiyorsa yok. */
  detectedLang?: string | null;
  languageConfidence?: number | null;
}

/**
 * Mikrofonun yankı engelleme kipi. `default`: tarayıcının olağan kipi (uygulamanın kendi çaldığı ses bastırılır).
 * `all`: bilgisayarda çalan BÜTÜN ses bastırılır (sistem çıkışı referans alınır). Yalnız yankı sınaması olağan kipte
 * sızıntı gösterip bu kipte göstermediyse cihaza uygulanır.
 */
export type EchoCancellationMode = 'default' | 'all';

/** Tarayıcının mikrofon izine GERÇEKTEN uyguladığı ses işleme (istenen değil; `track.getSettings()`). */
export interface CaptureProcessing {
  /** `true` / `false` ya da kip adı (`all`, `remote-only`). */
  echoCancellation: string;
  noiseSuppression: boolean | null;
  autoGainControl: boolean | null;
}

/**
 * Ana süreçten gizli ses penceresine giden komutlar (`audio.command` olayı).
 * Ses örnekleri IPC'den değil MessagePort'tan akar (`PORT_NAMES.audio`); buradakiler yalnız denetimdir.
 */
export type AudioCommand =
  /** Mikrofonu aç (`echoCancellation`, `noiseSuppression`, `autoGainControl` açık) ve çerçeveleri porta yolla. */
  | { type: 'capture.start'; deviceId: string | null; echoMode?: EchoCancellationMode }
  /** Akışı gerçekten durdur (`track.stop()`); işletim sisteminin mikrofon göstergesi söner. */
  | { type: 'capture.stop' }
  /** Çalmayı hemen kes ve kuyruğu boşalt (söz kesme, acil durdurma). */
  | { type: 'playback.stop' }
  /**
   * Hazır PCM'i (mono) oynatma akışına ekler: gerçek zamanlı ses motorunun (OpenAI Realtime) çıkışı işçinin TTS
   * yönlendiricisinden geçmeden doğrudan çalınır. `end`: akışın son parçası ("bitti" raporu bunu izler).
   */
  | { type: 'playback.pcm'; streamId: string; sampleRate: number; pcm: Int16Array; end?: boolean }
  /** Çıkış aygıtını değiştir; `null` = sistem varsayılanı. */
  | { type: 'output.set'; deviceId: string | null }
  /**
   * Çalınan sesi kıs / geri aç (`gain` 0–1, `rampMs` içinde). Jarvis konuşurken söz adayı gelince ses kısılır ve
   * adayın kullanıcı mı yankı mı olduğu doğrulanır; yankıysa ses geri açılır.
   */
  | { type: 'playback.duck'; gain: number; rampMs: number }
  /** Yankı gidericinin düzey kapısı (güç oranı); söz kesme sınaması cihaza göre ayarlar. */
  | { type: 'echo.config'; gate: number }
  /**
   * Toplantı kipi: bilgisayarın sesini (Windows loopback, `getDisplayMedia`) yakalamaya başla; çerçeveler porta
   * `system_frame` olarak gider. `fake`: sınama kipi, gerçek ses yakalanmaz (sınama kancasının verdiği ses kullanılır).
   */
  | { type: 'system.start'; fake?: boolean }
  | { type: 'system.stop' };

/** Ses penceresinin ana sürece bildirdikleri (`audio.report` kanalı). */
export type AudioReport =
  /** Pencere yüklendi ve portu aldı; komut almaya hazır. */
  | { type: 'ready' }
  /** `sampleRate`: AudioContext'in gerçek hızı (Hz); porta giden çerçeveler her zaman 16 kHz'tir. */
  | { type: 'capture.started'; deviceLabel: string; sampleRate: number; processing?: CaptureProcessing }
  | { type: 'capture.stopped' }
  | { type: 'capture.error'; code: 'permission' | 'no_device' | 'in_use' | 'unknown'; message: string }
  /** `streamId` akışının ilk örneği hoparlöre verildi (ilk ses gecikmesinin ölçüm noktası). */
  | { type: 'playback.started'; streamId: string }
  /**
   * Akış bitti ya da kesildi. `playedMs`: gerçekten çalınan süre; `interrupted`: `playback.stop` ile mi bitti.
   * Doğal bitişte rapor, son örnek hoparlörden ÇIKINCA gelir (`outputLatencyMs`: aygıtın bildirdiği çıkış gecikmesi).
   */
  | { type: 'playback.ended'; streamId: string; playedMs: number; interrupted: boolean; outputLatencyMs?: number }
  /**
   * Bilgisayar sesi yakalanıyor (toplantı kipi). Gerçek kipte iz bilgisi de gelir (günlüğe yazılır): `label` izin adı,
   * `trackRate` izin örnek hızı (Hz).
   */
  | { type: 'system.started'; label?: string; trackRate?: number }
  | { type: 'system.stopped' }
  /**
   * Çıkış aygıtı değişti (Bluetooth bağlandı/koptu, varsayılan değişti): yakalama yeni aygıtla yeniden açılmalı.
   * Ana süreç isteği yeniden onaylar ve `system.start` yollar.
   */
  | { type: 'system.restart'; reason: 'device_changed' | 'ended' }
  /**
   * Bilgisayar sesi açılamadı ya da kesildi; `message` Türkçe ve kullanıcıya gösterilebilir, `detail` günlük için
   * (tarayıcının hata adı/iletisi).
   */
  | { type: 'system.error'; code: 'denied' | 'no_audio' | 'ended' | 'unknown'; message: string; detail?: string };

/**
 * Pencerelerin `window.fuber.on(...)` ile dinleyebildiği olaylar.
 * Arayüzdür: modül kendi olayını tip genişletmesiyle ekler (`interface BusEvents` ve `interface WindowEvents`)
 * ve adını `ModuleDef.windowEvents` içinde bildirir ki pencerelere aktarılsın.
 */
export interface WindowEvents extends Pick<BusEvents, WindowEventName> {
  /** Yalnız ses penceresine gönderilir. */
  'audio.command': AudioCommand;
}
