import type { BrainRole, Priority } from './entities';

/** Uygulama sürümü. Kök ve bütün workspace `package.json` sürümleriyle aynı tutulur. */
export const APP_VERSION = '2.0.0-demo.16';

export const DESKTOP_APP_ID = 'ai.fuber.desktop2';
export const DESKTOP_APP_NAME = 'Fuber AI 2';
export const ADMIN_APP_ID = 'ai.fuber.admin2';
export const ADMIN_APP_NAME = 'Fuber Yönetim 2';

/** Kontrol servisi yalnız geri döngüde dinler (KURGU §3: gece yarısı internete bir şey yayınlanmaz). */
export const CONTROL_HOST = '127.0.0.1';
export const CONTROL_PORT = 47820;
export const CONTROL_DEFAULT_URL = `http://${CONTROL_HOST}:${CONTROL_PORT}`;
/** `GET /v1/policy?wait=` için varsayılan uzun yoklama süresi (saniye). */
export const CONTROL_LONG_POLL_SECONDS = 25;

/** Geliştirme sunucusu portları (`npm run dev:*`). */
export const DEV_PORT_DESKTOP = 5173;
export const DEV_PORT_ADMIN = 5174;

/**
 * Genel kısayollar (Electron accelerator biçimi). Kullanıcı Ayarlar'dan değiştirebilir;
 * bunlar `Settings.hotkeys` için varsayılanlardır. v1 `Alt+Shift+Q` kullanıyor, çakışmaz.
 */
export const DEFAULT_HOTKEYS = {
  /** Uyandırma sözü yerine konuşmayı başlatır. */
  talk: 'Control+Alt+J',
  /** Mikrofonu açar/kapatır. */
  mute: 'Control+Alt+M',
  /** Acil durdur: konuşmayı, bütün araçları ve arka plan işlerini keser. */
  panic: 'Control+Alt+Q',
  /** Toplantı modunu başlatır / bitirir (toplantı modülü dinler; modül kapalıysa hiçbir şey olmaz). */
  meeting: 'Control+Alt+T',
} as const;
export type HotkeyId = keyof typeof DEFAULT_HOTKEYS;

/**
 * Veri kökü altındaki adlar. Kök: `%APPDATA%\Fuber AI 2\` (testte `FUBER2_DATA`).
 * Yönetim uygulamasının kökü: `%APPDATA%\Fuber Yönetim 2\`.
 */
export const DATA_DIRS = {
  /** Ana SQLite dosyası. */
  dbFile: 'fuber.db',
  /** Son geçerli politikanın disk önbelleği (anahtarlar safeStorage ile şifreli). */
  policyCacheFile: 'policy.json',
  logs: 'logs',
  /** İndirilen yerel modeller (`Policy.localModels[].files[].path` buraya görelidir). */
  models: 'models',
  /** Kullanıcı yetenekleri: `skills/<id>/` (manifest.json, index.mjs, selftest.mjs). */
  skills: 'skills',
  cache: 'cache',
  temp: 'temp',
} as const;
export const CONTROL_DB_FILE = 'control.db';

/**
 * Ses hattının tek biçimi: 16 kHz mono Int16, 20 ms çerçeve (KURGU §5.2).
 * Ses penceresi, ses işçisi ve STT aynı sabitleri kullanır.
 */
export const AUDIO_SAMPLE_RATE = 16_000;
export const AUDIO_FRAME_MS = 20;
export const AUDIO_FRAME_SAMPLES = (AUDIO_SAMPLE_RATE * AUDIO_FRAME_MS) / 1000;
/** Konuşma sırasında söz kesme için gereken en kısa kesintisiz ses (ms). */
export const BARGE_IN_MIN_SPEECH_MS = 250;

/** Masaüstü renderer giriş noktaları (`apps/desktop/src/renderer/<ad>/index.html`). */
export const RENDERER_ENTRIES = ['main', 'hud', 'audio', 'setup'] as const;
export type RendererEntry = (typeof RENDERER_ENTRIES)[number];

/** `hud` girişinin `?surface=` ile ayrışan yüzeyleri. */
export const HUD_SURFACES = ['island', 'toasts', 'stage'] as const;
export type HudSurface = (typeof HUD_SURFACES)[number];

/** Uygulamanın açabildiği bütün pencere türleri. */
export const WINDOW_KINDS = ['main', 'island', 'toasts', 'stage', 'audio', 'setup'] as const;
export type WindowKind = (typeof WINDOW_KINDS)[number];

/**
 * MessagePort teslim adları. Main, `webContents.postMessage(PORT_CHANNEL, name, [port])` ile yollar;
 * preload bunu sayfaya `window.postMessage({ fuberPort: name }, '*', [port])` olarak aktarır
 * (contextBridge MessagePort taşıyamaz).
 */
export const PORT_CHANNEL = 'fuber:port';
export const PORT_NAMES = {
  /** Ses penceresi ↔ ses işçisi: mikrofon çerçeveleri ve çalınacak PCM. */
  audio: 'audio',
} as const;

/** Tek tipli IPC'nin Electron kanalları. Bütün `Api` çağrıları tek `ipcMain.handle` kanalından geçer. */
export const IPC_INVOKE_CHANNEL = 'fuber:invoke';
export const IPC_EVENT_CHANNEL = 'fuber:event';

/** Ana pencere gezinmesi (KURGU §12). Sayfalar modülden gelir; bu yalnız sıra ve yerleşik kimliklerdir. */
export const NAV_PAGES = ['today', 'chat', 'memory', 'planner', 'projects', 'skills'] as const;
export type NavPageId = (typeof NAV_PAGES)[number] | 'settings';

/** Demo 1 yerleşik modül kimlikleri (KURGU §10). */
/**
 * Fiyatı bilinmeyen bir model çağrısının günlük bütçe KAPISINDA sayıldığı varsayılan tutar (USD). OpenAI uyumlu
 * sağlayıcıda fiyat çoğu kez bilinmez (rolde fiyat verilmediyse ve sağlayıcı maliyeti bildirmiyorsa); o çağrılar
 * harcama toplamına 0 diye girmez ama kapıyı da işletmezdi: fiyatsız modelde günlük bütçe hiçbir şeyi durdurmazdı.
 * KURGU (güvenlik ilkeleri) "günlük bütçe her zaman etkin" der; bu yüzden fiyatsız çağrı SAYISI üzerinden bir üst sınır vardır:
 * bütçe / 0,02 (varsayılan 10 $ bütçede 500 çağrı). 0,02 $ kaba bir üst kestirimdir: ~6 bin girdi + ~200 çıktı token'lık
 * bir tur, pahalı sınıftaki bir modelde (3 $ / 15 $ milyon token) ≈ 0,021 $ tutar. Gerçek fiyat biliniyorsa rolde
 * `price` verilir ve bu varsayım hiç kullanılmaz.
 */
export const UNPRICED_CALL_GUARD_USD = 0.02;

export const BUILTIN_MODULE_IDS = [
  'voice-control',
  'memory',
  'planner',
  'stage',
  'projects',
  'web',
  'pc',
  'workshop',
  'ambient',
  'documents',
  'import-v1',
  'meeting',
  'watch',
  'browser',
  'mail',
  'dashboard',
  // d4-jarvis: gündem (RSS) ve brifing (kendiliğinden konuşma).
  'news',
  'briefing',
  'selfdev',
  // JARVIS MODE: tam ekran holografik HUD (gizli; yalnız sesle açılır).
  'jarvis',
  // plugins/*/install.mjs: kurulan eklentilerin modül kimlikleri bu işaretin üstüne eklenir.
  // PLUGIN-MODULES
] as const;
export type BuiltinModuleId = (typeof BUILTIN_MODULE_IDS)[number];

/**
 * Hatırlatıcı bildirimlerinin önceliği. `high`: normal durumda adada görünür ve seslendirilir (KURGU §8, §14).
 * Hatırlatıcı çalan her yer (`planner`) bu sabiti kullanır.
 */
export const REMINDER_NOTIFY_PRIORITY = 'high' satisfies Priority;

/**
 * Yazılı sohbetin beyin ayarı: ayrı bir politika alanı yoktur. Sohbet, `deep` rolünün modelini kullanır
 * ve eforu bu değere indirir (`BrainRequest.effort`); araştırma ve Atölye `deep` rolünün kendi eforuyla koşar.
 */
export const CHAT_ROLE = 'deep' satisfies BrainRole;
export const CHAT_EFFORT = 'medium';

/** Sohbet kipi: bu kadar saniye sessizlikten sonra kendiliğinden biter (KURGU §5.2 madde 9). */
export const CONVERSATION_IDLE_SECONDS = 45;

/** Dikkat ve onay sınırları. */
export const LIMITS = {
  /** Toast yığınında aynı anda en çok kart. */
  maxToasts: 3,
  /** Onay isteği yanıtsız kalırsa reddedilmiş sayılır (ms). */
  approvalTimeoutMs: 60_000,
  /** Değişken kuyruğa giren hafıza sayısı (KURGU §7). */
  memoryContextItems: 8,
  /** Ortam dinleme döküm satırlarının saklanma süresi (gün). */
  ambientTranscriptDays: 7,
} as const;
