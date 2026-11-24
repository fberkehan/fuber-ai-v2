/**
 * Varlık tipleri: süreçler arası (IPC), servisler arası ve veritabanı satırlarının dışa dönük biçimi.
 * Hepsi düz JSON'dur (Date, Map, sınıf yok) ki IPC'den ve HTTP'den olduğu gibi geçsin.
 */

import type { HotkeyId, WindowKind } from './constants';
import type { TtsEngineId } from './tts-engines';

// ───────────────────────────── Ortak ─────────────────────────────

/** `newId()` ile üretilen 26 karakterlik, zamana göre sıralanabilir kimlik. */
export type Id = string;
/** ISO 8601 UTC an: `2026-11-16T07:30:00.000Z`. Üretim: `nowIso()` / `date.toISOString()`. */
export type IsoDateTime = string;
/** Yerel takvim günü `YYYY-MM-DD`. Üretim: `localDay()`; asla `toISOString().slice(0,10)`. */
export type LocalDay = string;
/** Yerel saat `HH:MM` (24 saat). */
export type LocalTime = string;

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type Priority = 'low' | 'normal' | 'high' | 'urgent';

/** Bir kaydın nereden geldiği (KURGU §7: her kayıt kökenini bilir). */
export type RecordSource =
  | 'voice' // sesli sohbet
  | 'chat' // yazılı sohbet
  | 'ambient' // ortam dinleme
  | 'import' // v1'den içe aktarma
  | 'user' // kullanıcı arayüzden elle girdi
  | 'system'; // uygulamanın kendisi (şablon, zamanlayıcı, yetenek)

/** Konuşmanın yapıldığı kanal. */
export type Channel = 'voice' | 'chat';

/** Beyin rolleri (KURGU §6). Model ve efor politikadan gelir. */
export type BrainRole = 'voice' | 'deep' | 'memory' | 'vision';

/** Araç risk düzeyi. `danger` onaysız çalışmaz. */
export type Risk = 'read' | 'write' | 'danger';
/** Modülün istediği izinler. */
export type Permission = 'net' | 'fs' | 'shell' | 'screen' | 'mic' | 'notify';

// ───────────────────────────── Tekrar ─────────────────────────────

/** ISO hafta günü: 1 = Pazartesi … 7 = Pazar. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/**
 * Tekrar kuralı. Yerel duvar saatini korur (her gün 09:00 demek, yaz saati değişse de 09:00 demektir).
 * Sonraki an `nextOccurrence()` ile hesaplanır.
 */
export interface Recurrence {
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  /** Her `interval` birimde bir; en az 1. */
  interval: number;
  /** Yalnız `weekly` için: hangi günler. Boş/yoksa ilk anın günü. */
  weekdays?: Weekday[];
  /** Bu andan sonra tekrar etmez. */
  until?: IsoDateTime;
}

// ───────────────────────────── Uygulama ─────────────────────────────

export interface AppInfo {
  /** "Fuber AI 2" ya da "Fuber Yönetim 2". */
  name: string;
  appId: string;
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
  arch: string;
  /** Veri kökünün mutlak yolu. */
  dataDir: string;
  packaged: boolean;
  /** İşletim sistemi yereli, ör. `tr-TR`. */
  locale: string;
  /** `FUBER2_TEST` altında mı koşuyor (yalnız `testing.ts` belirler). */
  testMode: boolean;
}

/** Arayüzün açılışta tek çağrıyla aldığı toplu durum. */
export interface AppStatus {
  voice: VoiceStatus;
  control: ControlStatus;
  presence: PresenceState;
  /** `Policy.killSwitch`. Etkinse ses ve araçlar durur. */
  killSwitch: { active: boolean; message: string | null };
  /** `Policy.release.force` ve sürüm < `minVersion`: yalnız güncelleme ekranı gösterilir. */
  updateRequired: boolean;
  /** Daha yeni sürüm var (zorunlu değil). */
  updateAvailable: { version: string; downloadUrl: string | null; notes: string | null } | null;
  setupCompleted: boolean;
  hotkeys: HotkeyStatus[];
  /** Bugünkü harcama ve bütçe. */
  budget: { spentUsd: number; limitUsd: number; over: boolean };
  /** Asistanın şu an hangi beyinle çalıştığı (tek doğru kaynak; değişince `brain.status` olayı gelir). */
  brain: BrainStatus;
}

/**
 * Ayarlar › Tanı için ana sürecin tuttuğu son ses olayları (uygulama açıldığından beri; pencere kapalıyken de birikir).
 */
export interface AppDiagnostics {
  /** Son uyandırma sözü algısı: hangi yoldan (sezici / yazıya çevirme) ve hangi puanla. */
  lastWake: { phrase: string; score: number; path: WakePath; at: IsoDateTime } | null;
  /** Dinlemenin en son neyle başladığı (uyandırma sözü, kısayol, ada/düğme). */
  lastListen: { reason: 'wake' | 'hotkey' | 'island' | 'api'; at: IsoDateTime } | null;
  /** Son sesli turun ölçülen gecikmeleri. */
  lastTurn: (VoiceTurnMetrics & { at: IsoDateTime }) | null;
  /** Son ses hattı hatası. */
  lastError: { code: string; message: string; at: IsoDateTime } | null;
}

/**
 * Bulut beyninin kullanılamama nedeni (`BrainStatus.cause`). `limit`: Claude aboneliğinin kullanım sınırı doldu
 * (yalnız Claude Code yolunda).
 */
export type BrainCloudIssue = 'billing' | 'auth' | 'network' | 'limit';

/**
 * Asistanın o anki beyni. Arayüz tahmin yürütmez; rozet ve kurulum adımı bunu gösterir.
 * - `cloud`: yanıtlar buluttaki modelden geliyor.
 * - `local`: yanıtlar bu bilgisayardaki dil modelinden geliyor (`reason` nedenini söyler).
 * - `none`: yanıt verebilecek beyin yok (`message` kullanıcıya gösterilecek Türkçe neden).
 */
export interface BrainStatus {
  provider: 'cloud' | 'local' | 'none';
  /**
   * `ok` bulut çalışıyor · `policy_local` politika yerel modeli seçmiş · `no_key` bulut anahtarı hiç yok ·
   * `cloud_down` anahtar var ama bulut yanıt vermiyor (ödeme, ağ) · `kill_switch` Yönetim'den durduruldu ·
   * `update_required` zorunlu güncelleme bekleniyor (sürüm kapısı) · `private` Gizli kip açık (kullanıcı açtı): buluta
   * hiçbir şey gitmez, yerel model yürütür (yerel model yoksa `provider: 'none'`).
   */
  reason: 'ok' | 'policy_local' | 'no_key' | 'cloud_down' | 'kill_switch' | 'update_required' | 'private';
  /**
   * `reason: 'cloud_down'` iken bulutun neden kullanılamadığı: `billing` hesapta kredi yok / ödeme sorunu ·
   * `auth` anahtar kabul edilmedi · `network` ulaşılamıyor (ağ, zaman aşımı). Diğer durumlarda `null`.
   * Arayüz bunu kullanıcıya sade bir cümleyle söyler; bulut düzelince durum kendiliğinden `cloud`/`ok` olur.
   */
  cause: BrainCloudIssue | null;
  /** Bu bilgisayardaki dil modeli kullanılabilir mi (dosyaları yerinde, sunucusu düşmemiş). */
  localReady: boolean;
  /** Yerel dil modelinin kimliği (politikadan). */
  localModel: string;
  /** `provider: 'none'` iken kullanıcıya gösterilecek neden; diğer durumlarda `null`. */
  message: string | null;
  /**
   * Sesli rolün bulut beyni: sağlayıcı (Anthropic ya da OpenAI uyumlu), görünen adı ve model. Rol yerel modeldeyse
   * `null`. Bulut o an düşükse de doldurulur (asıl beyin hangisi). Alanı doldurmayan eski sahteler için isteğe bağlı.
   */
  cloud?: { provider: 'anthropic' | 'openai-compatible' | 'claude-code'; name: string; model: string } | null;
  /**
   * Konuşan beyin olarak Claude Code'un (bu bilgisayardaki CLI, kullanıcının aboneliği) durumu. Ayarlar › Tanı ve
   * rozet buradan okur. Alanı doldurmayan eski sahteler için isteğe bağlı.
   */
  claudeCode?: ClaudeCodeBrainStatus;
  /**
   * Anthropic API'nin BİLİNEN sorunu (kredi yok, anahtar kabul edilmedi, ulaşılamıyor); sorun bilinmiyorsa `null`.
   * Konuşan beyin Claude Code iken `cause` onun durumunu anlatır; API'nin durumu buradadır (derin işlerin sağlayıcı
   * seçimi buna bakar). Alanı doldurmayan eski sahteler için isteğe bağlı.
   */
  apiIssue?: BrainCloudIssue | null;
  /**
   * Derin beynin (yetenek geliştirme, araştırma, görüntü anlama) durumu. Sesli turun beyninden bağımsızdır:
   * sesli tur yerel modeldeyken derin işler Claude Code ile yürüyebilir. Beyin servisi bu alanı HER ZAMAN doldurur;
   * isteğe bağlı olması yalnız eski sınama sahteleri içindir (okuyan `status.deep ?? DEEP_BRAIN_UNKNOWN` der).
   */
  deep?: DeepBrainStatus;
}

/** Bu bilgisayardaki Claude Code CLI'nin durumu. */
export interface ClaudeCodeInfo {
  installed: boolean;
  /** `2.1.325` biçiminde; okunamadıysa `null`. */
  version: string | null;
  /** Oturum açık mı; henüz yoklanmadıysa `null`. */
  loggedIn: boolean | null;
}

/**
 * Konuşan beyin olarak Claude Code'un durumu (`BrainStatus.claudeCode`).
 * `active` sesli turlar şu an Claude Code ile yürüyor · `standby` hazır ama sıra onda değil (ör. önce API seçili) ·
 * `checking` henüz yoklanmadı · `missing` kurulu değil · `old` sürüm eski · `logged_out` oturum açık değil ·
 * `limit` abonelik kullanım sınırı doldu · `error` son turlarda yanıt alınamadı (kısa süre sonra yeniden denenir) ·
 * `private` Gizli kip (buluta bir şey gitmez) · `off` politika kapalı ya da rol başka bir sağlayıcıda.
 */
export interface ClaudeCodeBrainStatus {
  state: 'active' | 'standby' | 'checking' | 'missing' | 'old' | 'logged_out' | 'limit' | 'error' | 'private' | 'off';
  /** `active`/`standby` dışındaki durumlarda kullanıcıya gösterilecek Türkçe neden; diğer durumda `null`. */
  reason: string | null;
  /** Politikadaki kullanım (`Policy.brain.claudeCode.use`). */
  use: 'prefer' | 'fallback' | 'off';
  /** Sınır dolduysa açılacağı an; bilinmiyorsa `null`. */
  resetsAt: IsoDateTime | null;
  /** CLI sürümü; okunamadıysa `null`. */
  version: string | null;
  /** Sesli ve yazılı sohbetin Claude Code modeli (takma ad ya da kimlik). */
  voiceModel: string;
  chatModel: string;
  /** Hazır bekleyen (ısıtılmış ya da oturuma bağlı) süreç sayısı. */
  warm: number;
  /** Son başarılı turun ilk metin parçasına kadar süresi (ms); henüz tur yoksa `null`. */
  lastFirstTextMs: number | null;
}

/** Derin beynin durumu (`BrainStatus.deep`). Seçim `Policy.brain.deep.provider` ile yapılır. */
export interface DeepBrainStatus {
  /** Derin işler şu an yapılabilir mi. */
  ok: boolean;
  /** Şu an kullanılacak sağlayıcı: `anthropic` (API anahtarı) · `claude-code` (bu bilgisayardaki abonelik) · yoksa `null`. */
  provider: 'anthropic' | 'claude-code' | null;
  /** Politikadaki seçim. */
  setting: 'auto' | 'anthropic' | 'claude-code';
  /** `ok: false` iken kullanıcıya söylenecek Türkçe neden; diğer durumda `null`. */
  reason: string | null;
  claudeCode: ClaudeCodeInfo;
}

/** Derin beyin henüz kurulmadan (açılışın ilk anı) görünen durum. */
export const DEEP_BRAIN_UNKNOWN: DeepBrainStatus = {
  ok: false,
  provider: null,
  setting: 'auto',
  reason: null,
  claudeCode: { installed: false, version: null, loggedIn: null },
};

export interface HotkeyStatus {
  id: HotkeyId;
  accelerator: string;
  /** `false`: başka uygulama tutuyor; Ayarlar'da uyarı gösterilir, uygulama çökmez. */
  registered: boolean;
}

/** Yerel kullanıcı ayarları. Politikadan ayrıdır: kullanıcı değiştirir, cihazda kalır. */
export interface Settings {
  launchAtLogin: boolean;
  /** `MediaDeviceInfo.deviceId`; `null` = sistem varsayılanı. */
  inputDeviceId: string | null;
  outputDeviceId: string | null;
  /**
   * GERÇEKTE kayıtlı genel kısayollar (Electron accelerator). İstenen tuş başka uygulamadaysa kısayol servisi
   * yedeğini kaydeder ve onu buraya yazar; boş dizgi = hiçbir tuş alınamadı (bir sonraki açılışta varsayılan yeniden
   * denenir). Kısayolu kullanıcıya söyleyen her metin buradan okur.
   */
  hotkeys: Record<HotkeyId, string>;
  /** Sessiz saatler: bu aralıkta bütün bildirimler bekler, sabah özeti verilir. */
  quietHours: { enabled: boolean; from: LocalTime; to: LocalTime };
  /** "Rahatsız etme": elle açılır, elle ya da `dndUntil` gelince kapanır. */
  dnd: boolean;
  dndUntil: IsoDateTime | null;
  /**
   * Hangi bildirimler SESLİ okunsun. Bildirimler yine görünür (ada/pano); bu yalnız sesli okumayı kısar.
   * `level`: 'none' hiçbiri, 'urgent' yalnız acil, 'high' önemli ve acil (varsayılan). `mutedModules`: bu modüllerin
   * bildirimleri (ör. `whatsapp`, `mail`, `news`) sesli okunmaz, yalnız görünür.
   */
  spokenNotifications: { level: 'none' | 'urgent' | 'high'; mutedModules: string[] };
  /** Bulut (varsayılan) ya da Gizli (her şey yerel). Demo 1'de Gizli'nin yalnız altyapısı var. */
  privacyMode: 'cloud' | 'private';
  uiLanguage: 'tr' | 'en';
  reducedMotion: 'system' | 'on' | 'off';
  /** Adanın çıkacağı ekran. */
  islandDisplay: 'cursor' | 'primary';
  /** Proje taramasının kökü; varsayılan `~/Projects`. */
  projectsRoot: string;
  /** Kontrol servisi adresi; varsayılan `CONTROL_DEFAULT_URL`. */
  controlUrl: string;
  /** Ortam dinleme rıza anı; `null` = rıza yok, modül açılamaz. */
  ambientConsentAt: IsoDateTime | null;
  /** Kurulumdaki tanışmada kullanıcının söylediği adı; bilinmiyorsa `null`. İsteme "kullanıcının adı" olarak girer. */
  userName: string | null;
  /** Kullanıcının istediği hitap; `null` ise `Policy.persona.address` kullanılır. */
  userAddress: string | null;
  /** Kurulum sihirbazının bittiği an; `null` = açılışta sihirbaz gösterilir. */
  setupCompletedAt: IsoDateTime | null;
  /** Kullanıcının yerelde kapattığı modüller. Politika izin verse de yüklenmez. */
  disabledModules: string[];
  /**
   * "Jarvis bilgisayarımı kullanabilsin": fare, klavye, pencere ve tarayıcı eylemleri. Kapalıyken bu araçlar hiç
   * kayıtlı değildir (model onları göremez). Varsayılan açık.
   */
  pcControlAllowed: boolean;
  /** "Ekranımı ve pencerelerimi okuyabilsin": pencere listesi, pencere/sayfa metni, sekmeler, ekrana bakma. Varsayılan açık. */
  pcReadAllowed: boolean;
  /**
   * Bu cihazın seslendirme motoru (Ayarlar › Ses). `null`: Fuber Yönetim'in varsayılanı (`Policy.voice.tts.provider`).
   * Cihaz düzeyindedir çünkü ekran kartına bağlıdır: aynı politika, ekran kartı olmayan bir bilgisayara da gider.
   */
  ttsEngine: TtsEngineId | null;
  /** Motor başına bu cihazda seçilen ses (`{ supertonic: 'M5' }`); kayıt yoksa politikanın sesi, o da yoksa motorun varsayılanı. */
  ttsVoices: Partial<Record<TtsEngineId, string>>;
  /**
   * "Jarvis kendi tarayıcısını kullanabilsin": ayrı pencerede, uygulamadan yalıtılmış oturumla gezinme, okuma, form doldurma
   * (gönderim her seferinde onaylı; parola ve kart alanına yazmaz). Kapalıyken araçları kayıtlı değildir. Varsayılan açık.
   */
  jbrowserAllowed: boolean;
  /**
   * Yetki düzeyi (Ayarlar › Genel ve sesle "tam yetki ver"): araç kapısı hangi işler için onay sorar.
   * `ask` her şeyi sorar · `smart` (varsayılan) geri alınabilir işleri sormaz; silme, gönderme, ödeme, komut, süreç
   * sonlandırma, kapatma sorulur · `full` hiçbir şey sorulmaz (parola/kart/banka yasakları, acil durdurma ve "fareye
   * dokununca dur" KALIR). Fuber Yönetim üst sınır koyabilir (`Policy.limits.maxAuthority`).
   */
  authorityLevel: AuthorityLevel;
  /** Uzun işte aralarda kısa sesli ilerleme ("WhatsApp’ı açtım, Ahmet’i arıyorum"). Varsayılan açık. */
  spokenProgress: boolean;
  /**
   * Dinleme süresi: yanıttan sonra uyandırma sözü olmadan sözün beklendiği saniye (sol paneldeki Hızlı kontrol ve sesle
   * "dinleme süreni uzat"). `null`: Fuber Yönetim'in değeri (`Policy.voice.followUpSeconds`). Yürürlükteki değer
   * `effectiveFollowUpSeconds` ile okunur.
   */
  followUpSeconds: number | null;
  /**
   * Geliştirici kipi (Katman 2): Jarvis kendi kaynak kodunu değiştirebilir. Varsayılan kapalı; ayrıca Yönetim politikası
   * (`Policy.developer.enabled`) açık olmalı ve `developerRepoPath` gösterilmelidir. Yalnız Ayarlar sayfasından açılır.
   */
  developerMode: boolean;
  /** Kaynak deposunun (Fuber AI 2) mutlak yolu; ayarlanmamışsa `null`. */
  developerRepoPath: string | null;
}

/** Yetki düzeyi: araç kapısının onay politikası (`core/authority.ts`). */
export type AuthorityLevel = 'ask' | 'smart' | 'full';
export const AUTHORITY_LEVELS: readonly AuthorityLevel[] = ['ask', 'smart', 'full'];

/**
 * Onay isteyen işin türü; kapı düzeye göre sorup sormayacağına bununla karar verir ve sesli soruyu kısaltır.
 * Geri alınabilir (Akıllı'da sorulmaz): `input` tuş/tıklama/yazma · `window` pencere/uygulama kapatma · `file` kopyala/taşı/
 * klasör/yeni dosya/aç · `read` izinli klasör dışını okuma · `watch` takip işi başlatma.
 * Kritik (yalnız Tam yetki'de sorulmaz): `delete`, `send`, `pay`, `run` (komut), `kill` (süreç), `power` (kapat/yeniden
 * başlat), `overwrite` (var olan içeriği değiştirme), `download`, `install` (yetenek kurma), `commit` (geri dönüşsüz
 * düğme), `other` (sınıflanmamış).
 * Her zaman sorulur: `permission` (izin açma), `authority` (yetki yükseltme), `update` (çekirdek güncellemesini kurma ya da
 * geri alma: uygulama kendi kodunu değiştirir ve yeniden başlar).
 */
export type ApprovalKind =
  | 'input' | 'window' | 'file' | 'read' | 'watch'
  | 'delete' | 'send' | 'pay' | 'run' | 'kill' | 'power' | 'overwrite' | 'download' | 'install' | 'commit' | 'other'
  | 'permission' | 'authority' | 'update';

/** Yürürlükteki yetki (ayar + süreli/işe bağlı yükseltme + Yönetim sınırı). */
export interface AuthorityState {
  /** Şu an uygulanan düzey. */
  level: AuthorityLevel;
  /** Ayardaki kalıcı düzey (Yönetim sınırı uygulanmadan). */
  base: AuthorityLevel;
  /** Yönetim'in üst sınırı. */
  max: AuthorityLevel;
  /** Geçici yükseltme: `time` belirli ana kadar, `task` süren iş (sesli sohbet) bitene kadar. Yoksa `null`. */
  grant: { scope: 'time' | 'task'; until: IsoDateTime | null } | null;
}

// ───────────────────────────── Ses ─────────────────────────────

/** Ses durum makinesi (KURGU §5.1 ile birebir). */
export type VoiceState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'followup' | 'mic_off';

/** Bir durum geçişinin nedeni. */
export type VoiceStateReason =
  | 'wake' // uyandırma sözü
  | 'hotkey' // Ctrl+Alt+J / Ctrl+Alt+M
  | 'island' // ada tıklaması
  | 'api' // araç ya da IPC
  | 'speech_end' // kullanıcının sözü bitti
  | 'first_audio' // ilk ses çalmaya başladı
  | 'speech_done' // konuşma bitti → followup
  | 'barge_in' // konuşurken kullanıcı söze girdi
  | 'stop_word' // "sus, dur, yeter": yerel hızlı yol, model turu açılmaz
  | 'conversation' // sohbet kipi: yanıttan sonra uyandırmasız dinlemeye dönüş
  | 'timeout' // tur dondu (hiçbir etkinlik yok)
  | 'interject' // iş sürerken kullanıcı yeni bir söz söyledi
  | 'followup_timeout' // takip süresi doldu → idle
  | 'no_speech' // dinlerken hiç söz gelmedi
  | 'mute' // mikrofon kapatıldı
  | 'unmute'
  | 'panic' // acil durdur
  | 'kill_switch'
  | 'error';

/** Süren sesli turun canlı adımı (`voice.activity`). */
export interface VoiceActivity {
  turnId: Id | null;
  /** Şu an yapılan iş, Türkçe ve kısa ("WhatsApp’ı açıyorum"); iş yoksa `null`. */
  step: string | null;
  /** Çalışan aracın adı (varsa). */
  tool: string | null;
  /** Bu turda biten adım sayısı. */
  done: number;
  /** Turun başladığı an. */
  startedAt: IsoDateTime | null;
  /** Son başarısız adımın nedeni (Türkçe, kısa); yoksa `null`. */
  failed: string | null;
}

export interface VoiceStatus {
  state: VoiceState;
  /** Hat kullanıma hazır mı (modeller inmiş, ses penceresi ve işçi ayakta). */
  ready: boolean;
  /** `ready=false` ise kullanıcıya gösterilecek Türkçe neden. */
  notReadyReason: string | null;
  engine: 'cascade' | 'gemini-live' | 'openai-realtime';
  /** Mikrofon gerçekten kapalı (`track.stop()`); `state` de `mic_off` olur. */
  micMuted: boolean;
  /** Süreli kapatmada kendiliğinden açılacağı an. */
  micMutedUntil: IsoDateTime | null;
  /** Uyandırma sözü bu ana kadar yok sayılır (kısayol ve ada yine çalışır). */
  wakePausedUntil: IsoDateTime | null;
  /** Sessiz kip: Jarvis konuşmaz, yalnız yazıyla bildirir. */
  quiet: boolean;
  /** Sohbet kipi açık: "tamam, bu kadar" denene ya da sessizlik süresi dolana kadar uyandırma sözü gerekmez. */
  conversation: boolean;
  /** Yürürlükteki söz kesme kipi (politika + yankı sınamasının sonucu). */
  bargeIn: 'voice' | 'wake' | 'off';
  /** Kullanılan giriş aygıtının adı; bilinmiyorsa `null`. */
  inputDeviceLabel: string | null;
  /** Son hata (Türkçe, kullanıcıya gösterilebilir). */
  lastError: string | null;
  /** Ortam kipi istenmiş mi (`voice.setAmbient`). Olay çıkması için ayrıca politika izni ve kullanıcı rızası gerekir. */
  ambient?: boolean;
  /** Toplantı kipi (`voice.setMeeting`); kip hiç açılmadıysa ya da ses hattı desteklemiyorsa yok. */
  meeting?: VoiceMeetingStatus;
  /**
   * Politika `voice` dediği hâlde bu cihazda konuşarak kesme neden kapalı (`bargeIn: 'wake'`): yankı sınaması,
   * art arda kendini kesme ya da söz kesme sınaması. Kapalı değilse `null`/yok.
   */
  bargeInBlockedBy?: 'echo_test' | 'self_interrupt' | 'barge_test' | null;
  /** Yanıtı kesilen/başarısız olan son söz "yeniden dene" ile yinelenebilir mi. */
  canRetry?: boolean;
}

/**
 * Toplantı kipinin ses hattındaki durumu. Kip açıkken Jarvis sesli konuşmaz, uyandırma sözü kapalıdır (yalnız kısayol),
 * mikrofonun ve (istendiyse) bilgisayar sesinin her sözü yazıya çevrilip `voice.meeting` olarak yayınlanır.
 */
export interface VoiceMeetingStatus {
  on: boolean;
  /** "Karşı taraf" kaynağı (bilgisayarın sesi, Windows loopback). */
  system: 'off' | 'starting' | 'on' | 'error';
  /** `system: 'error'` iken kullanıcıya gösterilebilir Türkçe neden. */
  systemError: string | null;
  /** Yazıya çevrilmeyi bekleyen bölüt sayısı (iki kaynak toplamı). */
  queued: number;
}

/** Bir sesli turun ölçülen gecikmeleri (KURGU §5.3). Alanlar ms; ölçülemediyse `null`. */
export interface VoiceTurnMetrics {
  turnId: Id;
  /** Söz bitti → döküm hazır. */
  sttMs: number | null;
  /** Döküm hazır → beynin ilk tam cümlesi. */
  firstSentenceMs: number | null;
  /** İlk cümle → ilk ses örneği. */
  ttsFirstAudioMs: number | null;
  /** Söz bitti → ilk ses (bütçenin asıl kalemi). */
  endOfSpeechToFirstAudioMs: number | null;
  interrupted: boolean;
}

// ───────────────────────────── Sohbet ─────────────────────────────

export interface ChatSession {
  id: Id;
  /** İlk kullanıcı iletisinden türetilir; kullanıcı değiştirebilir. */
  title: string;
  channel: Channel;
  startedAt: IsoDateTime;
  lastAt: IsoDateTime;
  messageCount: number;
}

/** Bir tur içinde çalışan aracın özeti (iletiyle birlikte saklanır). */
export interface ToolCallSummary {
  callId: Id;
  name: string;
  ok: boolean;
  /** `ToolResult.text`'in kısaltılmışı (en çok 300 karakter). */
  text: string;
  durationMs: number;
}

export interface ChatMessage {
  id: Id;
  sessionId: Id;
  role: 'user' | 'assistant';
  text: string;
  channel: Channel;
  at: IsoDateTime;
  /** Asistan yanıtı yarıda kesildi (söz kesme / iptal); `text` yalnız söylenen kısımdır. */
  interrupted: boolean;
  /**
   * Tur yanıt üretemeden bitti; `text` kullanıcıya gösterilen hata cümlesidir. Geçmişten yüklenen hata turu da
   * arayüzde hata olarak çizilir (yoksa/`false` ise olağan ileti).
   */
  failed?: boolean;
  toolCalls: ToolCallSummary[];
  /** Kullanıcı iletisine eklenen dosyalar (belge modülü; içerikleri modülde durur). Yoksa ek yok. */
  attachments?: ChatAttachment[];
}

/** Sohbet iletisine eklenen dosyanın özeti. İçerik belge modülünde saklanır; iletide yalnız bu özet durur. */
export interface ChatAttachment {
  id: Id;
  /** Dosya adı (yol değil). */
  name: string;
  kind: 'document' | 'image';
  bytes: number;
  /** `ok` okundu · `no_text` metin katmanı yok (taranmış PDF) · `failed` okunamadı. */
  status: 'ok' | 'no_text' | 'failed';
  /** Kullanıcıya gösterilen tek satır: "PDF · 12 sayfa" ya da okunamama nedeni. */
  note: string | null;
}

export interface ChatSearchHit {
  message: ChatMessage;
  sessionTitle: string;
  /** Eşleşmenin çevresi; eşleşen kısım `[[` ve `]]` arasında. */
  snippet: string;
}

// ───────────────────────────── Hafıza ─────────────────────────────

/** Hafıza katmanları (KURGU §7). Ham döküm `ChatMessage` olarak ayrı saklanır. */
export type MemoryKind =
  | 'episode' // olay/anı: ne konuşuldu, ne karar verildi
  | 'fact' // kalıcı bilgi: kişi, şirket, tercih, tarih
  | 'commitment'; // söz verilen iş; hatırlatıcıya bağlanabilir

export interface MemoryItem {
  id: Id;
  kind: MemoryKind;
  text: string;
  /** Kimin/neyin hakkında: kişi, şirket ya da konu adı. */
  subject: string | null;
  tags: string[];
  source: RecordSource;
  /** Bilginin öğrenildiği an. */
  at: IsoDateTime;
  updatedAt: IsoDateTime;
  /** 0–1. Kullanıcının açıkça söylediği 1'e yakın; çıkarım daha düşük. */
  confidence: number;
  /** 0–1. Arama sıralamasına girer. */
  importance: number;
  pinned: boolean;
  /** `superseded`: çelişen yeni bilgi geldi; silinmez, aramada gösterilmez. */
  status: 'active' | 'superseded';
  /** Yerine geçen kayıt. */
  supersededBy: Id | null;
  /** Kaynak sohbet oturumu. */
  sessionId: Id | null;
  /** `commitment` bir hatırlatıcıya bağlandıysa. */
  reminderId: Id | null;
}

export interface MemorySearchHit {
  item: MemoryItem;
  /** FTS + güncellik + önem bileşik puanı; büyük olan daha ilgili. */
  score: number;
  snippet: string;
}

export interface MemoryStats {
  facts: number;
  episodes: number;
  commitments: number;
  messages: number;
}

// ───────────────────────────── Planlar ─────────────────────────────

export interface Reminder {
  id: Id;
  text: string;
  /** Bir sonraki (ya da tek) çalma anı. Tekrarlı ise her çalışta ileri alınır. */
  dueAt: IsoDateTime;
  recurrence: Recurrence | null;
  /** `scheduled` bekliyor · `fired` çaldı, kullanıcı henüz tamamlamadı · `done` · `cancelled`. */
  status: 'scheduled' | 'fired' | 'done' | 'cancelled';
  priority: Priority;
  source: RecordSource;
  createdAt: IsoDateTime;
  /** Son çalma anı. */
  firedAt: IsoDateTime | null;
  /** Bağlı `commitment` hafıza kaydı. */
  memoryId: Id | null;
}

export interface ReminderInput {
  text: string;
  dueAt: IsoDateTime;
  recurrence?: Recurrence | null;
  priority?: Priority;
}

export interface Todo {
  id: Id;
  text: string;
  notes: string;
  done: boolean;
  /** Son gün; saat yok. */
  dueDay: LocalDay | null;
  priority: Priority;
  source: RecordSource;
  /** Liste sırası; küçük olan üstte. */
  order: number;
  createdAt: IsoDateTime;
  doneAt: IsoDateTime | null;
}

export interface TodoInput {
  text: string;
  notes?: string;
  dueDay?: LocalDay | null;
  priority?: Priority;
}

// ───────────────────────────── Projeler ─────────────────────────────

export interface Project {
  id: Id;
  /** Klasör adı. */
  name: string;
  /** Mutlak yol. */
  path: string;
  /** Algılanan yığın etiketleri: "node", "flutter", "python", "git". */
  stack: string[];
  description: string;
  category: string | null;
  pinned: boolean;
  /** Klasördeki en yeni değişiklik. */
  modifiedAt: IsoDateTime;
  sessionCount: number;
  lastSessionAt: IsoDateTime | null;
}

/** Diskteki bir Claude Code oturumu (`~/.claude/projects/**.jsonl`). */
export interface CodeSession {
  /** Claude Code oturum kimliği (UUID); `claude --resume <id>` ile açılır. */
  id: string;
  projectId: Id | null;
  /** Oturumun çalışma klasörü. */
  cwd: string;
  /** Özet satırı ya da ilk kullanıcı iletisi; kullanıcı değiştirebilir. */
  title: string;
  category: string | null;
  pinned: boolean;
  gitBranch: string | null;
  startedAt: IsoDateTime;
  lastAt: IsoDateTime;
  messageCount: number;
  /** `.jsonl` dosyasının mutlak yolu. */
  filePath: string;
}

export interface CodeSessionMessage {
  role: 'user' | 'assistant';
  text: string;
  at: IsoDateTime;
}

export interface CodeSessionHit {
  session: CodeSession;
  /** Eşleşen kısım `[[` ve `]]` arasında. */
  snippet: string;
  score: number;
}

/** Bir projeyi/oturumu açma hedefi. `terminal` = Windows Terminal. */
export type OpenTarget = 'explorer' | 'terminal' | 'editor' | 'claude';

/**
 * Dış süreç başlatma sonucu. `ok` yalnız süreç gerçekten ayakta kaldıysa `true` olur
 * (v1'in "açıldı dedi ama açılmadı" hatasına karşı).
 */
export interface LaunchResult {
  ok: boolean;
  /** Kullanıcıya gösterilecek Türkçe ileti. */
  message: string;
}

// ───────────────────────────── Modüller ve yetenekler ─────────────────────────────

export interface ModulePage {
  /** Rota kimliği; `NAV_PAGES` içindeki ad ya da modüle özgü ad. */
  id: string;
  /** Phosphor ikon adı: "CalendarCheck". */
  icon: string;
  /** Sol raydaki sıra; küçük olan üstte. */
  order: number;
}

export interface ToolInfo {
  name: string;
  description: string;
  risk: Risk;
  moduleId: string;
  /** Aracın tanımında bildirdiği küme (`ToolDef.group`); bildirmediyse yok. */
  group?: string;
}

export interface ModuleInfo {
  id: string;
  version: string;
  kind: 'builtin' | 'skill';
  nameKey: string;
  descriptionKey: string;
  permissions: Permission[];
  /** Politika izin veriyor mu (`Policy.modules[id].enabled`). */
  allowed: boolean;
  /** Şu an yüklü ve araçları kayıtlı mı (`allowed` ve yerelde kapatılmamış ve hatasız). */
  enabled: boolean;
  tools: ToolInfo[];
  page: ModulePage | null;
  /** Yükleme hatası (Türkçe); yoksa `null`. */
  error: string | null;
}

export type SkillStatus =
  | 'building' // Atölye yazıyor
  | 'testing' // öz-sınama koşuyor
  | 'pending_approval' // hazır, kullanıcı onayı bekliyor
  | 'enabled'
  | 'disabled'
  | 'failed';

/** Kullanıcı yeteneği (`skills/<id>/`). */
export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  status: SkillStatus;
  /** Yapım sayacı; 1'den başlar, yetenek yeniden yapılırsa artar. Eski yapım saklanmaz (geri alma Demo 1'de yok). */
  version: number;
  permissions: Permission[];
  tools: ToolInfo[];
  /** Yapımı yürüten arka plan işi. */
  jobId: Id | null;
  /** Son hata ya da öz-sınama çıktısının özeti. */
  lastError: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** `skills/<id>/<version>/manifest.json` biçimi. */
export interface SkillManifest {
  id: string;
  name: string;
  description: string;
  version: number;
  permissions: Permission[];
  tools: Array<{
    name: string;
    description: string;
    risk: Risk;
    /** JSON Schema (draft 2020-12) nesne şeması. */
    inputSchema: JsonObject;
  }>;
}

export interface SkillDetail {
  info: SkillInfo;
  manifest: SkillManifest | null;
  /** Son öz-sınamanın çıktısı. */
  selftestLog: string;
  files: Array<{ path: string; bytes: number }>;
}

// ───────────────────────────── Sahne ─────────────────────────────

/** Sahne kartının gövde blokları. Sunum `packages/ui` içindedir; modül yalnız veri verir. */
export type StageBlock =
  | { type: 'text'; text: string }
  | { type: 'keyValue'; rows: Array<{ label: string; value: string }> }
  | { type: 'list'; items: Array<{ title: string; detail?: string; checked?: boolean }> }
  | { type: 'table'; columns: string[]; rows: string[][] }
  /** `src`: `data:` URL ya da mutlak dosya yolu. */
  | { type: 'image'; src: string; alt: string }
  | { type: 'code'; language: string; code: string }
  | { type: 'link'; label: string; url: string };

export interface StageAction {
  id: string;
  label: string;
  kind?: 'primary' | 'secondary' | 'danger';
}

/** Jarvis'in sahnede gösterdiği kart. Araçlar `ToolResult.show` ile döndürür. */
export interface StageCard {
  title: string;
  subtitle?: string;
  /** Phosphor ikon adı. */
  icon?: string;
  body: StageBlock[];
  /** Tıklanınca `stage.action` olayı yayınlanır. */
  actions?: StageAction[];
  /** Bu kadar saniye sonra kendiliğinden kapanır; yoksa kullanıcı kapatana dek kalır. */
  ttlSeconds?: number;
}

/** Kum havuzlu mini uygulama: `sandbox` öznitelikli iframe içinde koşan tek HTML belgesi. */
export interface StageApp {
  title: string;
  /** Tam HTML belgesi. Node/IPC erişimi yoktur. */
  html: string;
  /** CSS pikseli. */
  width: number;
  height: number;
}

export type StageItem =
  | { id: Id; kind: 'card'; card: StageCard; moduleId: string; createdAt: IsoDateTime }
  | { id: Id; kind: 'app'; app: StageApp; moduleId: string; createdAt: IsoDateTime };

// ───────────────────────────── Dikkat ─────────────────────────────

/** Dikkat Yöneticisinin seçtiği kanal (KURGU §8). */
export type AttentionChannel =
  | 'voice' // ada + ses
  | 'island' // yalnız ada
  | 'toast' // sağ altta sessiz kart
  | 'today' // yalnız Bugün sayfası
  | 'deferred'; // bekliyor; durum değişince özetle gelir

export interface NotifyAction {
  id: string;
  label: string;
  kind?: 'primary' | 'secondary' | 'danger';
}

/** Modülün `attention.notify()` ile bildirdiği niyet. Kanalı modül seçmez. */
export interface NotifyRequest {
  /** Bildiren modül kimliği. */
  moduleId: string;
  title: string;
  body?: string;
  priority: Priority;
  actions?: NotifyAction[];
  /**
   * Sesli kanal seçilirse söylenecek metin. `true` = başlık + gövde okunur;
   * yok/`false` = bu bildirim hiç seslendirilmez.
   */
  speak?: string | boolean;
  /** Aynı anahtarla bekleyen bildirim varsa yenisi gösterilmez, eskisi güncellenir. */
  dedupeKey?: string;
  /** Eylem olayında (`attention.action`) modüle geri verilen serbest veri. */
  data?: JsonObject;
}

export interface Notification {
  id: Id;
  moduleId: string;
  title: string;
  body: string;
  priority: Priority;
  actions: NotifyAction[];
  /** Seslendirilecek metin; seslendirilmeyecekse `null`. */
  speak: string | null;
  dedupeKey: string | null;
  data: JsonObject;
  /** `pending` bekliyor · `shown` gösterildi · `dismissed` kapatıldı · `acted` eylem seçildi. */
  status: 'pending' | 'shown' | 'dismissed' | 'acted';
  /** Seçilen kanal; henüz karar verilmediyse `null`. */
  channel: AttentionChannel | null;
  createdAt: IsoDateTime;
  shownAt: IsoDateTime | null;
  resolvedAt: IsoDateTime | null;
  /** `acted` ise seçilen eylem. */
  actionId: string | null;
}

/** Kullanıcının o anki durumu (varlık algısı). */
export interface PresenceState {
  /**
   * Öncelik sırasıyla tek özet: `fullscreen` > `meeting` > `quiet` > `away` > `normal`.
   * `away`: `idleSeconds` eşik üstünde.
   */
  mode: 'normal' | 'fullscreen' | 'meeting' | 'quiet' | 'away';
  /** Tam ekran oyun/sunum (D3D tam ekran, QUNS_BUSY, QUNS_PRESENTATION_MODE). */
  fullscreen: boolean;
  /** Kamera ya da mikrofon başka uygulamada, ya da ekran paylaşımı var. */
  meeting: boolean;
  cameraInUse: boolean;
  /** Mikrofonu bizden başka bir uygulama kullanıyor. */
  micInUseByOther: boolean;
  /** Sessiz saat ya da "rahatsız etme" açık. */
  quiet: boolean;
  /** Son klavye/fare girdisinden bu yana geçen süre. */
  idleSeconds: number;
  /** `mode`'un bu değere geçtiği an. */
  since: IsoDateTime;
}

// ───────────────────────────── Araç çağrıları ve onay ─────────────────────────────

/** Bir araç çağrısının kökeni. Kapı (politika + onay) kararını buna göre verir. */
export interface ToolOrigin {
  /** Çağrıyı başlatan yol. `ui` = kullanıcı arayüzden doğrudan tetikledi. */
  channel: Channel | 'job' | 'ui' | 'skill';
  sessionId?: Id;
  jobId?: Id;
  /**
   * Yalnız `voice`: konuşan kişi tanıtılmış sesle eşleşti mi.
   * `null` = doğrulama kapalı ya da yapılamadı. `false` iken `write`/`danger` araç çalışmaz.
   */
  speakerVerified: boolean | null;
}

export interface ToolCallRecord {
  callId: Id;
  name: string;
  moduleId: string;
  risk: Risk;
  origin: ToolOrigin;
  /** Doğrulanmış girdi. */
  input: JsonValue;
  ok: boolean;
  text: string;
  startedAt: IsoDateTime;
  durationMs: number;
  /** Onay istendiyse sonucu. */
  approval: ApprovalDecision | null;
}

export type ApprovalDecision = 'approved' | 'denied' | 'expired';

export interface ApprovalRequest {
  id: Id;
  toolName: string;
  moduleId: string;
  risk: Risk;
  /** Kullanıcıya gösterilen ve okunan Türkçe cümle: "Şu dosyayı silmek istiyorum: …". */
  summary: string;
  input: JsonValue;
  origin: ToolOrigin;
  requestedAt: IsoDateTime;
  /** Bu ana kadar yanıt gelmezse `expired`. */
  expiresAt: IsoDateTime;
  /** İşin türü (`core/authority.ts`); eski kayıtlarda yok. */
  kind?: ApprovalKind;
  /** Sesli sorunun kısa biçimi ("Göndereyim mi?"); kart `summary`yi gösterir. Yoksa `summary` okunur. */
  ask?: string;
}

// ───────────────────────────── Arka plan işleri ─────────────────────────────

export interface Job {
  id: Id;
  /** `<moduleId>.<ad>`: "web.research", "workshop.skill_build", "projects.code_task". */
  kind: string;
  moduleId: string;
  title: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  /** 0–1; ölçülemiyorsa `null`. */
  progress: number | null;
  /** O an yapılan iş, kısa Türkçe cümle. */
  step: string;
  startedAt: IsoDateTime;
  finishedAt: IsoDateTime | null;
  /** `done` ise sonuç metni. */
  resultText: string | null;
  /** `failed` ise hata (Türkçe). */
  error: string | null;
}

/**
 * Arka plan işlerinin O ANKİ özeti (`job.activity` olayı, `jobs.activity` kanalı): ada ve öteki yüzeyler derin işin
 * ilerlemesini bundan gösterir. İşlerin tam kaydı `Job`'dur; bu, "şu an ne oluyor"un tek satırlık halidir.
 */
export interface JobActivity {
  /**
   * Gösterilecek iş: en son ilerleme bildiren koşan iş; koşan yoksa sıradaki ilk iş; hiç iş yoksa `null` (satır kalkar).
   * `progress`: 0–1; ölçülemiyorsa `null` (belirsiz ilerleme). `step`: o an yapılan iş, kısa Türkçe cümle.
   */
  current: {
    id: Id;
    kind: string;
    moduleId: string;
    title: string;
    status: 'queued' | 'running';
    step: string;
    progress: number | null;
    startedAt: IsoDateTime;
  } | null;
  /** Koşan ve sırada bekleyen iş sayıları. */
  running: number;
  queued: number;
  /** Bu olayla biten iş (bitiş anında bir kez); başka durumda `null`. */
  finished: { id: Id; title: string; status: 'done' | 'failed' | 'cancelled' } | null;
}

// ───────────────────────────── Kullanım ─────────────────────────────

export type UsageKind = BrainRole | 'stt' | 'tts' | 's2s';

export interface UsageRecord {
  id: Id;
  at: IsoDateTime;
  kind: UsageKind;
  /** "anthropic", "elevenlabs", "openai", "gemini", "local". */
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** STT/TTS/S2S için işlenen ses süresi; diğerlerinde 0. */
  audioSeconds: number;
  /** Fiyatı bilinmeyen modelde 0'dır ve `costKnown: false` taşır (arayüz "bilinmiyor" yazar). */
  costUsd: number;
  /** `false`: modelin fiyatı bilinmiyor; `costUsd` gerçek maliyet değildir. Alan yoksa bilinir. */
  costKnown?: boolean;
  durationMs: number;
  sessionId: Id | null;
}

export interface UsageSummary {
  day: LocalDay;
  costUsd: number;
  /** `Policy.limits.dailyBudgetUsd`. */
  budgetUsd: number;
  /**
   * Bütçe aşıldı: yalnız `voice` rolü çalışır. Kapı bilinen harcamaya (`costUsd`) fiyatı bilinmeyen çağrıların
   * varsayılan payını (`unpricedGuardUsd`) ekleyerek bakar: fiyatsız modelde de bir üst sınır vardır.
   */
  overBudget: boolean;
  calls: number;
  /** Fiyatı bilinmeyen çağrı sayısı: `costUsd` bunları içermez (toplam eksiktir). */
  unpricedCalls?: number;
  /**
   * Fiyatı bilinmeyen çağrıların günlük bütçe kapısında sayıldığı tutar (çağrı sayısı × `UNPRICED_CALL_GUARD_USD`).
   * Gerçek harcama DEĞİLDİR; yalnız kapı içindir, harcama diye gösterilmez. Fiyatsız çağrı yoksa alan da yoktur.
   */
  unpricedGuardUsd?: number;
  byKind: Partial<Record<UsageKind, { costUsd: number; calls: number; inputTokens: number; outputTokens: number }>>;
}

// ───────────────────────────── Kontrol bağlantısı ─────────────────────────────

export interface ControlStatus {
  /**
   * `unregistered` cihaz kayıtlı değil · `pending` onay bekliyor · `approved` · `revoked` ·
   * `offline` servis yanıt vermiyor (önbellek ya da gömülü politika kullanılıyor).
   */
  state: 'unregistered' | 'pending' | 'approved' | 'revoked' | 'offline';
  url: string;
  deviceId: string | null;
  policyRevision: number;
  /** Yürürlükteki politikanın geldiği yer. */
  policySource: 'remote' | 'cache' | 'embedded';
  lastSyncAt: IsoDateTime | null;
  lastError: string | null;
}

// ───────────────────────────── Kurulum ─────────────────────────────

/**
 * Kurulum adımları, sırasıyla: karşılama → Yönetim'e bağlan → mikrofon (sınama + "üç kez Hey Jarvis"
 * kalibrasyonu + yankı sınaması) → yerel modeller → Windows'la başla → tanışma (ad, hitap) → bitti.
 */
export type SetupStepId = 'welcome' | 'connect' | 'microphone' | 'models' | 'autostart' | 'intro' | 'done';

export interface SetupState {
  completed: boolean;
  /** Tamamlanan adımlar. */
  done: SetupStepId[];
  /** Sıradaki adım. */
  current: SetupStepId;
}

export interface LocalModelProgress {
  /** `Policy.localModels[].id`. */
  id: string;
  role: string;
  required: boolean;
  status: 'missing' | 'queued' | 'downloading' | 'verifying' | 'ready' | 'failed';
  receivedBytes: number;
  totalBytes: number;
  /** `failed` ise neden (Türkçe). */
  error: string | null;
}

export interface MicTestResult {
  ok: boolean;
  deviceLabel: string;
  /** 0–1 tepe genlik. */
  peak: number;
  /** 0–1 ortalama (RMS). */
  rms: number;
  /** VAD konuşma algıladı mı. */
  speechDetected: boolean;
  /** STT hazırsa söylenenin dökümü. */
  transcript: string | null;
  /** `ok=false` ise neden (Türkçe). */
  error: string | null;
}

export interface WakeTestResult {
  detected: boolean;
  /** 0–1 en yüksek puan. */
  score: number;
}

/** Uyandırmanın hangi yoldan algılandığı (KURGU §5.2 madde 8). */
export type WakePath =
  | 'kws' // anahtar sözcük sezici (sherpa-onnx)
  | 'whisper'; // kısa bölütün dökümü "jarvis…" ile başladı

/** Kalibrasyonun adım adım ilerleyişi (`setup.calibrationProgress` olayı). */
export interface WakeCalibrationProgress {
  /** Şu an beklenen örnek (1'den başlar). */
  index: number;
  /** Toplam örnek sayısı. */
  total: number;
  /** `listening` örnek bekleniyor · `heard` örnek alındı · `retry` anlaşılamadı, yeniden istenecek · `done` bitti. */
  phase: 'listening' | 'heard' | 'retry' | 'done';
  /** `heard` ise bu örneğin sezici puanı (0–1); sezici yoksa `null`. */
  score: number | null;
}

/** "Üç kez Hey Jarvis deyin" kalibrasyonunun sonucu. */
export interface WakeCalibrationResult {
  ok: boolean;
  /** Algılanan örnek sayısı. */
  heard: number;
  total: number;
  /** Seçilen sezici eşiği (0–1); sezici kullanılamıyorsa `null` (yalnız Whisper yolu çalışır). */
  threshold: number | null;
  /** Örneklerin hangi yollarla algılandığı. */
  paths: WakePath[];
  /** Kullanıcıya gösterilecek Türkçe özet ("Sesinizi tanıdım" / neden olmadığı). */
  message: string;
}

/** Yankı sınaması: test cümlesi hoparlörden çalınır, yankı engellemeden geçen mikrofonda konuşma algılanır mı. */
export interface EchoTestResult {
  /** Sınama yapılabildi mi (mikrofon ve oynatma hazır). */
  ok: boolean;
  /** Jarvis'in kendi sesi mikrofona sızıp konuşma olarak algılandı mı. */
  leaked: boolean;
  /** Önerilen söz kesme kipi: sızıntı yoksa `voice`, varsa `wake`. Cihaza uygulanmış halidir. */
  recommendedBargeIn: 'voice' | 'wake';
  /** Kullanıcıya gösterilecek Türkçe özet. */
  message: string;
}

// ───────────────────────────── Pencereler ─────────────────────────────

/** Bir pencerenin kendi boyutunu bildirmesi (HUD: pencere = görünen şekil). CSS pikseli. */
export interface WindowSize {
  kind: WindowKind;
  width: number;
  height: number;
}
