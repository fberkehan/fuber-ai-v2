// JARVIS MODE: tam ekran holografik HUD (normalde görünmez; sesle açılır). Burada yalnız çekirdeğin ürettiği veri tipleri
// vardır. Cihaz köprüsü eklentileri (plugins/jarvis-quest, plugins/jarvis-watch) anlık görüntüyü `jarvis.snapshot`
// olayından okur. Node bağımlılığı YOK: renderer bu dosyayı `import type` ile alır.

export type HudPalette = 'cyan' | 'blue' | 'ember' | 'ice';
export const HUD_PALETTES: readonly HudPalette[] = ['cyan', 'blue', 'ember', 'ice'];
export type HudTab = 'overview' | 'workshop' | 'comms';
export const HUD_TABS: readonly HudTab[] = ['overview', 'workshop', 'comms'];

export type LoadLevel = 'calm' | 'normal' | 'busy' | 'critical';
export type VoiceHudState = 'idle' | 'listening' | 'thinking' | 'speaking';

export type SourceStatus = 'ok' | 'stale' | 'off';

export interface LogEntry {
  ts: string;
  /** ENV/MSG/FIN/CAL/SYS (eklentiler kendi etiketlerini ekleyebilir) */
  tag: string;
  text: string;
  ref?: string;
}

export interface HudEnv {
  status: SourceStatus;
  place: string;
  lat: number;
  lon: number;
  tempC: number;
  condition: string;
  windKmh: number;
  windDir: string;
  humidity: number;
  visibilityKm: number;
  uv?: number;
  hourly: { time: string; tempC: number }[];
  /** [+] Konumun nereden geldiği: ayar (şehir), IP'den kaba ya da saat dilimi. */
  source?: 'settings' | 'ip' | 'timezone' | 'none';
  /** [+] Hissedilen sıcaklık. */
  feelsC?: number;
  /** [+] Yağış ihtimali (bugün azami, %). */
  rainPct?: number;
  /** [+] Verinin alındığı an (ms epoch). */
  fetchedAt?: number;
}

export interface HudCalItem {
  ref: string;
  time: string;
  title: string;
  place: string;
  current: boolean;
  /** [+] Olayın mutlak anı (ms epoch). */
  at?: number;
  /** [+] Kaynak türü: hatırlatıcı olayı ya da görev (saatsiz). */
  kind?: 'event' | 'todo';
}

export interface HudCal {
  status: SourceStatus;
  nextInSec: number | null;
  items: HudCalItem[];
  /** [+] demo.16: bugün saatli olay yoksa gösterilecek ipucu (boş kutu yerine). */
  hint?: string;
  /** [+] demo.16: bugünkü saatli olay sayısı (görev/son gün hariç). */
  eventCount?: number;
}

export interface HudCore {
  label: string;
  value: string;
  unit: string;
  sub: string;
  cpu: number;
  gpu: number | null;
  ram: number;
  vram: number | null;
  tempC: number | null;
  /** [+] Sıcaklığın kaynağı: ekran kartı ya da işlemci (okunamazsa null). */
  tempSource?: 'gpu' | 'cpu' | null;
  /** [+] Ekran kartı adı. */
  gpuName?: string | null;
  /** [+] Son ~60 örnek (yüzde): grafikler için. */
  cpuSeries?: number[];
  gpuSeries?: number[];
  ramSeries?: number[];
  /** [+] Toplam / kullanılan RAM (GB), VRAM (GB). */
  ramUsedGb?: number;
  ramTotalGb?: number;
  vramUsedGb?: number | null;
  vramTotalGb?: number | null;
  /** [+] Mantıksal işlemci sayısı ve çekirdek başına yük (yüzde). */
  cores?: number[];
  /** [+] Bilgisayarın açık kalma süresi, sn. */
  uptimeSec?: number;
}

export interface HudFinItem {
  sym: string;
  name: string;
  price: number;
  currency: string;
  changePct: number;
  series: number[];
  /** [+] Bu sembolün piyasası şu an açık mı (kripto her zaman açık). */
  open?: boolean;
  /** [+] Veri kaynağı. */
  source?: 'binance' | 'yahoo';
}

export interface HudFin {
  status: SourceStatus;
  marketOpen: boolean;
  focus: string;
  items: HudFinItem[];
  /** [+] Verinin alındığı an. */
  fetchedAt?: number;
}

export interface HudLinkItem {
  id: string;
  name: string;
  kind: 'server' | 'service';
  detail: string;
  latencyMs: number | null;
  quality: number;
  up: boolean;
}

export interface HudLinks {
  status: 'ok';
  linked: number;
  total: number;
  items: HudLinkItem[];
}

/** [+] Atölye sekmesi: süren işler. */
export interface HudJob {
  id: string;
  title: string;
  moduleId: string;
  status: 'queued' | 'running';
  startedAt: string | null;
}

/** [+] İletişim sekmesi: asistan bildirimleri. */
export interface HudNotice {
  ref: string;
  ts: string;
  title: string;
  body: string;
  moduleId: string;
  pending: boolean;
  /** [+] demo.16: bildirimin önemi (yoğunluk puanı için). */
  priority?: 'low' | 'normal' | 'high' | 'urgent';
}

export interface HudSnapshot {
  ts: number;
  greeting: string;
  summary: string;
  palette: HudPalette;
  tab: HudTab;
  clock: { time: string; date: string; tz: string; place: string };
  env: HudEnv;
  cal: HudCal;
  core: HudCore;
  fin: HudFin;
  links: HudLinks;
  log: LogEntry[];
  /** [+] Artan sıra numarası (Quest eksik kareyi anlasın). */
  seq?: number;
  /** [+] Bilgisayarın adı (başlık: "NODE.PC / ..."). */
  node?: string;
  /** [+] Dikkat bekleyen madde sayısı (özetteki sayı). */
  attention?: number;
  /** [+] Atölye: süren işler. */
  jobs?: HudJob[];
  /** [+] demo.16: konuşma durumu (idle/listening/thinking/speaking) ve söylenen son cümle. */
  voice?: { state: VoiceHudState; text?: string };
  /** [+] demo.16: palet kipi; `auto` iken `palette` yoğunluktan hesaplanır. */
  paletteMode?: 'auto' | 'manual';
  /** [+] demo.16: yoğunluk puanı (0..100), düzeyi ve nedenleri. */
  load?: { score: number; level: LoadLevel; reasons: string[] };
  /** [+] İletişim: bildirimler. */
  notices?: HudNotice[];
}

/** Ayarlardan düzenlenebilen izleme listesi öğesi. */
export interface FinWatch {
  /** Görünen kısa ad: BTC, USD/TRY… */
  sym: string;
  name: string;
  /** `binance`: `BTCUSDT` gibi; `yahoo`: `TRY=X`, `^IXIC`, `AAPL`. */
  source: 'binance' | 'yahoo';
  ticker: string;
  currency: string;
}

export const DEFAULT_WATCHLIST: readonly FinWatch[] = [
  { sym: 'BTC', name: 'Bitcoin', source: 'binance', ticker: 'BTCUSDT', currency: 'USD' },
  { sym: 'ETH', name: 'Ethereum', source: 'binance', ticker: 'ETHUSDT', currency: 'USD' },
  { sym: 'USD/TRY', name: 'Dolar / Türk lirası', source: 'yahoo', ticker: 'TRY=X', currency: 'TRY' },
  { sym: 'BIST100', name: 'Borsa İstanbul 100', source: 'yahoo', ticker: 'XU100.IS', currency: 'TRY' },
  { sym: 'NASDAQ', name: 'Nasdaq Bileşik', source: 'yahoo', ticker: '^IXIC', currency: 'USD' },
  { sym: 'AAPL', name: 'Apple', source: 'yahoo', ticker: 'AAPL', currency: 'USD' },
  { sym: 'NVDA', name: 'NVIDIA', source: 'yahoo', ticker: 'NVDA', currency: 'USD' },
];

/** JARVIS MODE ayarı (kalıcı). */
export interface JarvisConfig {
  palette: HudPalette;
  /** `auto` (varsayılan): palet yoğunluğa göre kendiliğinden değişir; elle seçim `manual` yapar. */
  paletteMode: 'auto' | 'manual';
  tab: HudTab;
  /** Hava durumu şehri; boşsa uygulama ayarındaki şehir, o da yoksa IP'den kaba konum. */
  city: string | null;
  watchlist: FinWatch[];
  focus: string;
}

export interface JarvisState {
  snapshot: HudSnapshot;
  config: JarvisConfig;
}

declare module '@fuber/shared' {
  interface Api {
    'jarvis.get': { req: Record<string, never>; res: JarvisState };
    'jarvis.setTab': { req: { tab: HudTab }; res: JarvisState };
    'jarvis.setPalette': { req: { palette: HudPalette | 'auto' }; res: JarvisState };
    'jarvis.setConfig': { req: { city?: string | null; watchlist?: FinWatch[]; focus?: string }; res: JarvisState };
    /** Çağıran pencereyi tam ekran yapar / eski haline döndürür; HUD'un açık olduğunu da ana sürece bildirir. */
    'jarvis.fullscreen': { req: { on: boolean }; res: { fullscreen: boolean } };
  }
  interface BusEvents {
    'jarvis.snapshot': { snapshot: HudSnapshot };
    /** Sesle (ya da araçla) JARVIS MODE açma/kapama isteği. Ana pencere bunu dinler. */
    'jarvis.mode': { on: boolean };
    /** Çekirdekten cihaz eklentilerine giden iletiler (ses seviyesi, günlük satırı). Eklenti yoksa dinleyen olmaz. */
    'jarvis.device': { msg: Record<string, unknown> };
    /** Cihaz eklentilerinden çekirdeğe gelen iletiler (`hud.action`: sekme, palet, odak, aç, durdur). */
    'jarvis.deviceMessage': { kind: string; msg: Record<string, unknown> };
  }
  interface WindowEvents {
    'jarvis.snapshot': { snapshot: HudSnapshot };
    'jarvis.mode': { on: boolean };
  }
}
