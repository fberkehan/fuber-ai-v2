/**
 * Uygulamanın yaşam döngüsü: kapanış (pencere X, tepsi "Çık", `app.quit`), açılış çanı, "Tekrar hoş geldiniz",
 * "Yenilikler" ve veri işlemleri (yedek al, geri yükle, yeni başla, verilerimi sil, bu bilgisayardan kaldır).
 *
 * Çekirdek sözleşmeye (`ipc.ts`) dokunmadan, kendi kanallarını tip genişletmesiyle ekler. Kararlar saf işlevlerdedir
 * (birim testli: `lifecycle.test.ts`); ana süreç tarafı `apps/desktop/src/main/core/lifecycle*.ts`.
 */

import type { Ok } from './ipc';
import type { LocalTime } from './entities';

// ───────────────────────────── kapanış ─────────────────────────────

/** Pencere kapatılınca (X): sor (varsayılan) · tepsiye in · tamamen çık. */
export type CloseAction = 'ask' | 'background' | 'quit';
export const CLOSE_ACTIONS: readonly CloseAction[] = ['ask', 'background', 'quit'];

/** Kapanışı kim istedi: pencerenin X'i, tepsideki "Çık" ya da arayüzden `app.quit`. */
export type CloseSource = 'window' | 'tray' | 'app';

/** Kapanışta yarıda kalacak, gerçekten sorgulanabilen işler. */
export type BusyKind = 'jobs' | 'meeting' | 'claude' | 'models' | 'pc';
export interface BusyItem {
  kind: BusyKind;
  /** Kaç tane (iş, oturum, indirme); tekil durumlarda 1. */
  count: number;
  /** Öne çıkan adı (ör. süren işin başlığı); yoksa `null`. */
  title: string | null;
}

/** Ana süreç → ana pencere: kapanış diyaloğunu aç. */
export interface CloseRequest {
  id: string;
  source: CloseSource;
  busy: BusyItem[];
}

/** Kullanıcının kararı: arka planda sürsün · tamamen çık · vazgeç. `remember`: "Bir daha sorma". */
export type CloseChoice = 'background' | 'quit' | 'cancel';

export interface LifecyclePrefs {
  closeAction: CloseAction;
  /** Açılış çanı (yalnız paketli üretimde çalar). */
  startupSound: boolean;
}
export const DEFAULT_LIFECYCLE_PREFS: LifecyclePrefs = { closeAction: 'ask', startupSound: true };

/** Kayıtlı (eksik ya da bozuk olabilen) tercihleri varsayılanla tamamlar. */
export function normalizePrefs(raw: unknown): LifecyclePrefs {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof LifecyclePrefs, unknown>>;
  return {
    closeAction: CLOSE_ACTIONS.includes(value.closeAction as CloseAction) ? (value.closeAction as CloseAction) : DEFAULT_LIFECYCLE_PREFS.closeAction,
    startupSound: typeof value.startupSound === 'boolean' ? value.startupSound : DEFAULT_LIFECYCLE_PREFS.startupSound,
  };
}

/**
 * Kapanış isteğinin yolu (tek karar):
 * - `hide`: sessizce tepsiye in.
 * - `ask`: uygulama içi diyalog (pencere X'i "sor" ayarında, ya da süren iş varken çıkış).
 * - `quit`: kısa veda ve çıkış.
 *
 * Pencerenin X'i ayara uyar; `quit` ayarında süren iş varsa yine sorulur (iş sessizce kesilmesin). Tepsi ve `app.quit`
 * çıkıştır: süren iş yoksa sormadan çıkar.
 */
export function closeRoute(source: CloseSource, action: CloseAction, busy: readonly BusyItem[]): 'hide' | 'ask' | 'quit' {
  if (source === 'window') {
    if (action === 'background') return 'hide';
    if (action === 'quit') return busy.length > 0 ? 'ask' : 'quit';
    return 'ask';
  }
  return busy.length > 0 ? 'ask' : 'quit';
}

/** Diyalog açılamazsa (pencere yanıt vermiyor) düşülecek yol: X → tepsiye in; çıkış isteği → çık (kilitlenmez). */
export const closeFallback = (source: CloseSource): 'hide' | 'quit' => (source === 'window' ? 'hide' : 'quit');

/** Ana pencere diyaloğu bu sürede almazsa düşüş yolu uygulanır (ms). */
export const CLOSE_ACK_TIMEOUT_MS = 2500;
/** Veda örtüsünün süresi (ms); sınama kipinde 0. */
export const FAREWELL_MS = 650;

// ───────────────────────────── açılış çanı ─────────────────────────────

export interface ChimeInput {
  packaged: boolean;
  testMode: boolean;
  enabled: boolean;
  quietHours: { enabled: boolean; from: LocalTime; to: LocalTime } | null;
  dnd: boolean;
  now: Date;
}
export type ChimeDecision = 'play' | 'test' | 'dev' | 'off' | 'quiet';

/** "23:00"–"08:00" gece yarısını aşar; bitiş dışarıda; başlangıç = bitiş sessiz sayılmaz. */
export function inQuietHours(from: string, to: string, now: Date): boolean {
  const minutes = (value: string) => {
    const [h, m] = String(value).split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const n = now.getHours() * 60 + now.getMinutes();
  const a = minutes(from);
  const b = minutes(to);
  if (a === b) return false;
  return a < b ? n >= a && n < b : n >= a || n < b;
}

/**
 * Çan yalnız paketli üretimde ve ayar açıkken çalar; sınamada ve geliştirmede ASLA. Sessiz saatte ve "Rahatsız
 * etme"de çalmaz. Bilinmeyen ayar (null) çalmaz.
 */
export function chimeDecision(input: ChimeInput): ChimeDecision {
  if (input.testMode) return 'test';
  if (!input.packaged) return 'dev';
  if (!input.enabled) return 'off';
  if (input.dnd) return 'quiet';
  if (input.quietHours?.enabled && inQuietHours(input.quietHours.from, input.quietHours.to, input.now)) return 'quiet';
  return 'play';
}

/** v1'in açılış çanı (Re5 · Fa#5 · La5 yükselen arpej): frekans (Hz), başlangıç ve süre (sn), kazanç tepesi. */
export const CHIME_NOTES: ReadonlyArray<{ frequency: number; start: number; duration: number; peak: number }> = [
  { frequency: 587.33, start: 0, duration: 0.66, peak: 0.092 },
  { frequency: 739.99, start: 0.12, duration: 0.62, peak: 0.078 },
  { frequency: 880, start: 0.24, duration: 0.64, peak: 0.066 },
];
export const CHIME = { attack: 0.03, floor: 0.0001, lead: 0.03, lowpassHz: 2600, lowpassQ: 0.4, harmonics: [0, 1, 0.18, 0.04] } as const;

// ───────────────────────────── tekrar hoş geldiniz · yenilikler ─────────────────────────────

/** Kaldırıcı "verilerim kalsın" deyince veri klasörüne yazdığı işaret (içerik `kaldirildi`). */
export const REINSTALL_MARKER = '.yeniden-kurulum';
/** Kurulum başlatıcısı `--cikis`'i yalnız bu dosya varsa dener (içerik: uygulama sürümü). */
export const QUIT_FLAG_MARKER = '.cikis-destekli';
/** İkinci örnek bu bayrakla başlatılırsa çalışan örnek sormadan, nazik çıkış yolundan çıkar. */
export const QUIT_FLAG = '--cikis';

export interface DataSummary {
  memory: number;
  chats: number;
  /** Varsayılandan farklı ayar sayısı. */
  settings: number;
  /** Son sohbetin zamanı ya da `null`. */
  lastUsedAt: string | null;
  /** Veritabanının bayt boyutu. */
  dbBytes: number;
}

export interface WelcomeState {
  /** Yeniden kurulum işareti bulundu: neyin durduğu. */
  reinstall: DataSummary | null;
  /** Sürüm değişti: bu sürümün yenilikleri gösterilecek (sözlük anahtarları). */
  whatsNew: { version: string; items: WhatsNewItem[] } | null;
}

export interface WhatsNewItem {
  /** Phosphor ikon adı (arayüz eşler). */
  icon: 'brain' | 'waveform' | 'users' | 'binoculars' | 'globe' | 'envelope' | 'chat' | 'layout';
  key: string;
}

/** Sürümün yenilikleri. Yalnız gerçekten gelenler (KURGU §10: "demo.3'te gelenler"). */
export const WHATS_NEW: Readonly<Record<string, readonly WhatsNewItem[]>> = {
  '2.0.0-demo.3': [
    { icon: 'brain', key: 'lifecycle.news.d3.claude' },
    { icon: 'waveform', key: 'lifecycle.news.d3.voice' },
    { icon: 'users', key: 'lifecycle.news.d3.meeting' },
    { icon: 'binoculars', key: 'lifecycle.news.d3.watch' },
    { icon: 'globe', key: 'lifecycle.news.d3.browser' },
    { icon: 'envelope', key: 'lifecycle.news.d3.mail' },
    { icon: 'chat', key: 'lifecycle.news.d3.spoken' },
    { icon: 'layout', key: 'lifecycle.news.d3.design' },
  ],
  '2.0.0-demo.4': [
    { icon: 'globe', key: 'lifecycle.news.d4.briefing' },
    { icon: 'brain', key: 'lifecycle.news.d4.profile' },
    { icon: 'layout', key: 'lifecycle.news.d4.pc' },
    { icon: 'waveform', key: 'lifecycle.news.d4.turn' },
    { icon: 'binoculars', key: 'lifecycle.news.d4.plugins' },
  ],
  '2.0.0-demo.5': [
    { icon: 'waveform', key: 'lifecycle.news.d5.stop' },
    { icon: 'brain', key: 'lifecycle.news.d5.code' },
    { icon: 'layout', key: 'lifecycle.news.d5.pc' },
    { icon: 'globe', key: 'lifecycle.news.d5.net' },
  ],
  '2.0.0-demo.6': [
    { icon: 'layout', key: 'lifecycle.news.d6.island' },
    { icon: 'layout', key: 'lifecycle.news.d6.cards' },
    { icon: 'globe', key: 'lifecycle.news.d6.mail' },
    { icon: 'brain', key: 'lifecycle.news.d6.self' },
    { icon: 'waveform', key: 'lifecycle.news.d6.voice' },
  ],
  '2.0.0-demo.7': [{ icon: 'waveform', key: 'lifecycle.news.d7.ambient' }],
  '2.0.0-demo.8': [{ icon: 'waveform', key: 'lifecycle.news.d8.selfstop' }],
  '2.0.0-demo.9': [{ icon: 'layout', key: 'lifecycle.news.d9.wide' }],
  '2.0.0-demo.10': [
    { icon: 'layout', key: 'lifecycle.news.d10.quick' },
    { icon: 'layout', key: 'lifecycle.news.d10.notice' },
    { icon: 'brain', key: 'lifecycle.news.d10.selfdev' },
    { icon: 'waveform', key: 'lifecycle.news.d10.voice' },
  ],
  '2.0.0-demo.11': [
    { icon: 'globe', key: 'lifecycle.news.d11.tblocal' },
    { icon: 'waveform', key: 'lifecycle.news.d11.mic' },
  ],
  '2.0.0-demo.12': [{ icon: 'globe', key: 'lifecycle.news.d12.tbfast' }],
  '2.0.0-demo.13': [
    { icon: 'waveform', key: 'lifecycle.news.d13.realtime' },
    { icon: 'waveform', key: 'lifecycle.news.d13.notify' },
    { icon: 'waveform', key: 'lifecycle.news.d13.gpu' },
    { icon: 'brain', key: 'lifecycle.news.d13.smart' },
    { icon: 'layout', key: 'lifecycle.news.d13.wizard' },
  ],
};

/**
 * Yenilikler gösterilecek mi: daha önce çalışmış bir kurulum (son sürüm kaydı ya da kurulumu bitmiş profil) yeni bir
 * sürüme geçtiyse ve sözlükte o sürümün maddeleri varsa. Yeni kurulumda gösterilmez.
 */
export function shouldShowWhatsNew(input: { lastRunVersion: string | null; currentVersion: string; setupCompleted: boolean }): boolean {
  if (!WHATS_NEW[input.currentVersion]) return false;
  if (input.lastRunVersion === input.currentVersion) return false;
  return input.lastRunVersion !== null || input.setupCompleted;
}

// ───────────────────────────── veri işlemleri ─────────────────────────────

/** Yedek klasörünün içindeki tanım dosyası. */
export const BACKUP_MANIFEST = 'fuber-yedek.json';
export interface BackupManifest {
  app: string;
  version: string;
  createdAt: string;
  summary: Pick<DataSummary, 'memory' | 'chats' | 'settings'>;
  files: string[];
}
export interface BackupResult {
  path: string;
  bytes: number;
  createdAt: string;
}
/** Yeniden açılış gerektiren işlemin yanıtı. `restart: 'manual'`: sınamada uygulama yalnız kapanır. */
export interface RestartResult {
  ok: true;
  restart: 'auto' | 'manual';
  backup: string | null;
}
export interface UninstallResult {
  ok: true;
  command: string;
  args: string[];
  /** Kaldırıcı gerçekten başlatıldı mı (sınamada ve geliştirmede ASLA). */
  executed: boolean;
}
/** "Verilerimi sil" onayında yazılacak sözcük. */
export const WIPE_CONFIRM_WORD = 'SİL';

// ───────────────────────────── sözleşme genişletmesi ─────────────────────────────

declare module './ipc' {
  interface Api {
    /** Kapanış tercihleri (Ayarlar › Genel). */
    'lifecycle.prefs': { req: void; res: LifecyclePrefs };
    'lifecycle.setPrefs': { req: { patch: Partial<LifecyclePrefs> }; res: LifecyclePrefs };
    /** Ana pencere kapanış diyaloğunu açtı (zaman aşımı düşüşü iptal). */
    'app.closeAck': { req: { id: string }; res: Ok };
    /** Kapanış diyaloğunun kararı. */
    'app.closeDecision': { req: { id: string; choice: CloseChoice; remember?: boolean }; res: Ok };
    /** Açılışta gösterilecek kapılar (tekrar hoş geldiniz, yenilikler). */
    'lifecycle.welcome': { req: void; res: WelcomeState };
    /** "Kaldığım yerden devam et": yeniden kurulum işareti silinir. */
    'lifecycle.welcomeContinue': { req: void; res: Ok };
    /** Yenilikler kapatıldı: bir daha gösterilmez. */
    'lifecycle.whatsNewSeen': { req: void; res: Ok };
    /** Veri özeti (Ayarlar › Gizlilik). */
    'lifecycle.summary': { req: void; res: DataSummary & { dataDir: string } };
    /** Yedek al. `dir` verilmezse klasör seçilir (sınamada zorunlu). İptal: `null`. */
    'lifecycle.backup': { req: { dir?: string }; res: BackupResult | null };
    /** Yedekten geri yükle: işlem bir sonraki açılışta, veritabanı açılmadan uygulanır. */
    'lifecycle.restore': { req: { dir?: string }; res: RestartResult | null };
    /** Yeni başla: önce otomatik yedek, sonra temiz veri ve kurulum sihirbazı. */
    'lifecycle.startOver': { req: void; res: RestartResult };
    /** Verilerimi sil (indirilen modeller isteğe bağlı). `confirm` = `WIPE_CONFIRM_WORD`. */
    'lifecycle.wipe': { req: { confirm: string; includeModels?: boolean }; res: RestartResult };
    /** Fuber AI 2'yi bu bilgisayardan kaldır. */
    'lifecycle.uninstall': { req: { keepData: boolean }; res: UninstallResult };
  }
}

declare module './events' {
  interface WindowEvents {
    /** Ana pencere kapanış diyaloğunu açsın. */
    'app.closeRequested': CloseRequest;
    /** Çıkılıyor: ana pencere veda örtüsünü göstersin. `ms`: örtünün süresi. */
    'app.farewell': { ms: number };
  }
}
