// Bilgisayar modülünün ortak tipleri ve modüle özgü olayı. Sayfa/HUD aynı tipleri görsün diye `import type` edilir.
import type { BrainImage, IsoDateTime, Ok } from '@fuber/shared';

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Üst düzey bir pencere (Alt+Tab'da görünenler; sıra = z-sırası, en üstteki ilk). */
export interface WindowInfo {
  hwnd: number;
  title: string;
  /** Süreç adı, küçük harf, uzantısız: `chrome`, `notepad`. */
  exe: string;
  /** Okunur ad (dosya açıklaması): "Google Chrome"; yoksa süreç adı. */
  app: string;
  /** Çalıştırılabilir dosyanın tam yolu. Yalnız içeride (tarayıcıyı yeniden çağırmak için) kullanılır; modele gitmez. */
  path: string;
  pid: number;
  minimized: boolean;
  maximized: boolean;
  focused: boolean;
  /** Fuber AI'nin kendi penceresi. */
  own: boolean;
  className: string;
  rect: Rect;
  /** Masaüstü, görev çubuğu gibi kabuk yüzeyi (yalnız öndeki pencere listelenmeyen bir yüzeyse dolar). */
  shell?: boolean;
}

export interface WindowList {
  windows: WindowInfo[];
  /** Öndeki pencere; listede olmayabilir (iletişim kutusu, kabuk). */
  foreground: WindowInfo | null;
  /** Kilit ekranı açık: Windows ekran yakalamayı ve girdiyi engeller. */
  locked: boolean;
}

/** Erişilebilirlik ağacından bir düğüm (ön-sıra dolaşım; `depth` kökten uzaklık). */
export interface UiaNode {
  depth: number;
  /** UI Automation denetim türü: `Button`, `Edit`, `Text`, `Document`… */
  role: string;
  name: string;
  /** Alanın değeri ya da belgenin metni. Parola alanlarında HİÇ gelmez. */
  value?: string;
  /** `x` devre dışı · `*` klavye odağı · `s` seçili · `c` işaretli. */
  flags?: string;
  password?: boolean;
}

export interface ReadResult {
  nodes: UiaNode[];
  truncated: boolean;
}

/** Klavye odağındaki öğe. */
export interface FocusedInfo {
  /** Öndeki pencere. */
  hwnd: number | null;
  /** Öğe okunabildi mi; `false` ise tür bilinmiyor demektir. */
  known: boolean;
  role: string;
  name: string;
  className: string;
  password: boolean;
  editable: boolean;
  /** Parola alanında her zaman `null`. */
  value: string | null;
  /** Öğenin ekrandaki dikdörtgeni (fiziksel piksel); katmandaki "buraya yazıyorum" vurgusu için. */
  rect?: Rect | null;
}

/** Pencerede üzerinde işlem yapılabilecek, görünen bir öğe (alan, düğme, sekme, bağlantı, satır). */
export interface SurveyItem {
  role: string;
  name: string;
  /** `x` devre dışı · `*` klavye odağı · `s` seçili · `c` işaretli. */
  flags?: string;
  password?: boolean;
}

export interface SurveyResult {
  items: SurveyItem[];
  /** Listeye sığmayan öğe sayısı. */
  more: number;
  truncated: boolean;
}

/** Ekrandaki bir noktanın altındaki öğe (koordinatla tıklamadan önce bakılır). */
export interface ElementAt {
  known: boolean;
  role: string;
  name: string;
  className: string;
  password: boolean;
  /** En yakın üst öğe: adsız bir simgenin neye ait olduğunu söyler (sekmenin kapatma düğmesi gibi). */
  parentRole: string;
  parentName: string;
}

export interface FoundElement {
  /** Yardımcı süreçteki geçici kimlik; yalnız bir sonraki `find` çağrısına kadar geçerli. */
  ref: number;
  role: string;
  name: string;
  score: number;
  rect: Rect | null;
  point: Point | null;
  onscreen: boolean;
  enabled: boolean;
  password: boolean;
  /** Fare gerektirmeyen eylem yolları: `invoke`, `select`, `toggle`, `expand`. */
  patterns: string[];
}

export interface BrowserTab {
  title: string;
  active: boolean;
}

export interface BrowserWindowInfo extends WindowInfo {
  tabs: BrowserTab[];
  /** Adres çubuğundaki metin (etkin sekme); okunamadıysa `null`. */
  url: string | null;
}

export interface DocumentText {
  found: boolean;
  /** `text`: belge metni tek çağrıyla · `tree`: görünen öğe adları · `none`: okunamadı. */
  method: 'text' | 'tree' | 'none';
  text: string;
  truncated: boolean;
}

/** Windows'un UI Automation ağacını okuyan sağlayıcı. Gerçeği yardımcı süreçtir (`uia.ts`); sınamada sahtesi. */
export interface UiaProvider {
  windows(): Promise<WindowList>;
  read(hwnd: number, options?: { maxNodes?: number; budgetMs?: number; maxText?: number }): Promise<ReadResult>;
  focused(): Promise<FocusedInfo>;
  at(point: Point): Promise<ElementAt>;
  /** `terms` boşsa `role` zorunludur: o türden görünen bütün öğeler. Chromium/Electron pencerelerinde sayfa ağacı gerekirse uyandırılır. */
  find(hwnd: number, query: { terms: string[]; role?: string; max?: number }): Promise<{ matches: FoundElement[]; total: number }>;
  /** Pencerede görünen, üzerinde işlem yapılabilecek öğelerin kısa listesi (web sayfalarının içi dahil). */
  survey(hwnd: number, options?: { max?: number; budgetMs?: number }): Promise<SurveyResult>;
  /** Öğeyi fare olmadan etkinleştirir (UIA deseni). Desen yoksa `ok: false`. */
  invoke(ref: number): Promise<{ ok: boolean; pattern?: string; error?: string }>;
  browsers(): Promise<BrowserWindowInfo[]>;
  document(hwnd: number, options?: { maxChars?: number }): Promise<DocumentText>;
  /** Yardımcıyı önceden başlatır (soğuk başlatma ilk araç çağrısına kalmasın). */
  warm(): void;
  stop(): void;
}

export type MouseButton = 'left' | 'right' | 'middle';

/**
 * Fare/klavye girdisi ve pencere durumu. GERÇEK sürücü (`input-win32.ts`) `SendInput` çağırır; birim ve uçtan uca
 * sınamalar yalnız sahte sürücüyle koşar. Bütün yöntemler eşzamanlı ve küçüktür: sıra, bekleme ve kesme kararı
 * `control.ts` içindedir.
 */
export interface InputDriver {
  foregroundWindow(): number | null;
  /** Noktadaki üst düzey pencere. */
  windowAt(point: Point): number | null;
  windowState(hwnd: number): { exists: boolean; minimized: boolean; maximized: boolean; rect: Rect | null };
  /** Pencereyi öne getirmeyi dener. Sonucu çağıran `foregroundWindow()` ile doğrular. */
  activateWindow(hwnd: number): void;
  showWindow(hwnd: number, action: 'minimize' | 'maximize' | 'restore'): void;
  /** Kibar kapatma isteği (`WM_CLOSE`): uygulama "kaydedilsin mi" diye sorabilir. */
  closeWindow(hwnd: number): void;
  /** Pencereyi taşır ve boyutlandırır (fiziksel piksel; görünen çerçeve bu dikdörtgene oturur). Sonucu çağıran `windowState()` ile doğrular. */
  setWindowRect(hwnd: number, rect: Rect): void;
  /** Pencerenin bulunduğu ekran: tamamı ve çalışma alanı (görev çubuğu hariç), fiziksel piksel. */
  monitorOf(hwnd: number): { full: Rect; work: Rect } | null;
  /** Unicode metin parçası (Türkçe harfler klavye düzeninden bağımsız). */
  sendText(text: string): void;
  /** Sanal tuş olayları, tek atomik `SendInput` çağrısında. */
  sendKeys(events: Array<{ vk: number; down: boolean }>): void;
  /** Karakterin geçerli klavye düzenindeki tuşu; yoksa `null`. */
  keyForChar(char: string): { vk: number; shift: boolean } | null;
  cursor(): Point;
  moveCursor(point: Point): void;
  mouseButton(button: MouseButton, down: boolean): void;
  /** Tekerlek: pozitif = yukarı (yatayda sağa). */
  wheel(notches: number, horizontal?: boolean): void;
  /** Şu an basılı tuşlar ve fare düğmeleri (sanal tuş kodları). */
  downKeys(): number[];
  /** Sistemin gördüğü son girdinin anı ve şimdiki an (aynı sayaç, ms). */
  lastInputTick(): number;
  tick(): number;
}

/** Bağlı bir ekran (çoklu ekran ve DPI): dikdörtgenler fiziksel pikseldir; `scale` Windows ölçeği (1,5 = %150). */
export interface ScreenInfo {
  /** 1'den başlayan sıra (soldan sağa, yukarıdan aşağıya). */
  index: number;
  bounds: Rect;
  work: Rect;
  scale: number;
  primary: boolean;
  /** İmleç şu an bu ekranda. */
  current: boolean;
}

/** Pano (yalnız metin). Gerçeği Electron `clipboard`; sınamada sahtesi. */
export interface ClipboardPort {
  /** Electron 45'te pano eşzamansızdır; sahtesi eşzamanlı kalabilir. */
  readText(): string | Promise<string>;
  writeText(text: string): void | Promise<void>;
  /** Panoda metin dışı içerik (görüntü, dosya) var: geçici kullanım onu geri getiremez. */
  hasNonText?(): boolean | Promise<boolean>;
}

/**
 * Görüntü anlayan derin beynin bu modülün kullandığı dar yüzü; çekirdeğin `DeepBrain`'i (`core/brain/deep`) bunu karşılar.
 * Ekran görüntüsü bellekten verilir (`{ mediaType, data }`): diske hiç yazılmaz.
 */
export interface DeepBrain {
  available(): { ok: boolean; provider: string | null; reason?: string };
  ask(request: { system: string; prompt: string; images?: BrainImage[]; maxSeconds?: number; signal?: AbortSignal }): Promise<{ text: string }>;
}

export type PcAction = 'type' | 'keys' | 'click' | 'scroll' | 'focus' | 'window' | 'browser' | 'files' | 'command' | 'system' | 'clipboard' | 'selftest';

/** Jarvis'in bilgisayarı kullandığı an: ada "Bilgisayarı kullanıyor" durumunu bundan gösterir. */
export interface PcActivity {
  active: boolean;
  action: PcAction | null;
  /** Üzerinde çalışılan uygulamanın adı ("Google Chrome"); pencere başlığı DEĞİL. */
  app: string | null;
  /** Dizi kesildiyse nedeni: kullanıcı fareyi/klavyeyi aldı ya da acil dur. */
  interrupted: 'user' | 'panic' | null;
  /** İmlecin gittiği hedef (fiziksel piksel); yalnız fare eylemlerinde. Ekrandaki "Jarvis imleci" katmanı bununla çizer. */
  point: Point | null;
  /**
   * Yayıncı (`pc`: fare/klavye · `browser`: asistanın kendi tarayıcısı). Kanal ortaktır; bir yayıncının geç gelen "bitti"si
   * ötekinin süren satırını kaldırmasın diye yayın `activity.ts` üzerinden yapılır. Adsız yayın "başka biri" sayılır.
   */
  source?: string;
  /** Şu an yapılan adımın kısa metni ("“Ara” alanına tıklıyorum"); ada ve ekran katmanı gösterir. Pencere içeriği taşımaz. */
  step?: string | null;
  /** Toplu eylemde (`pc_do`) kaçıncı adım. */
  progress?: { index: number; total: number } | null;
  /** Kullanıcıdan onay bekleniyor: eylem durdu, süre işlemiyor. */
  waiting?: 'approval' | null;
  /** Ekran katmanı için o anki görsel olay (fiziksel piksel). Yalnız yayınlandığı an anlamlıdır. */
  fx?: PcFx | null;
  at: IsoDateTime;
}

/** Ekran katmanının çizdiği anlık olaylar (koordinatlar FİZİKSEL piksel; katman kendi ekranına çevirir). */
export type PcFx =
  /** Jarvis'in imleci `to` noktasına `ms` sürede gidiyor (gerçek imleç de aynı eğride gider). `from`: gerçek imlecin o anki yeri. */
  | { kind: 'move'; to: Point; ms: number; from?: Point }
  /** Tıklama dalgası. */
  | { kind: 'click'; at: Point; button: MouseButton; double: boolean }
  /** Hedef öğenin/alanın vurgusu: yazılan alan, tıklanan düğme, okunan pencere. */
  | { kind: 'target'; rect: Rect; mode: 'type' | 'click' | 'read' }
  /** Yazı sürüyor: şimdiye dek yazılan karakter sayısı. */
  | { kind: 'typing'; chars: number; total: number };

/** Ekran katmanına giden kare: koordinatlar katman penceresinin sol üstüne göre DIP. */
export interface PcOverlayFrame {
  /** `false`: katman söner (pencere kısa süre sonra gizlenir). */
  visible: boolean;
  /** `working`: kullanıyor · `waiting`: onay bekliyor · `interrupted`: kullanıcı devraldı · `stopped`: Durdur / acil dur. */
  state: 'working' | 'waiting' | 'interrupted' | 'stopped';
  /** Asistanın adı ("Jarvis"); imleç etiketi ve şerit. */
  name: string;
  step: string | null;
  progress: { index: number; total: number } | null;
  reducedMotion: boolean;
  /** Ayar "sistem": sayfa Windows'un animasyon tercihine (`prefers-reduced-motion`) bakar. */
  systemMotion: boolean;
  /** Acil dur kısayolu ("Ctrl+Alt+Q"). */
  stopKeys: string;
  /** Süren eylem; adım metni yoksa rozet/şerit bundan kısa bir söz kurar ("tıklıyor"). */
  action: PcAction | null;
  /** Etkin ekran: şerit ve imleç burada; diğer ekranlarda yalnız kenar ışığı. */
  focus: boolean;
  /** İmlecin bu ekrandaki yeri; `null`: imleç bu ekranda görünmez (konumsuz eylem ya da başka ekran). */
  pointer: Point | null;
  /** Çalışma alanı (görev çubuğu hariç), pencereye göre DIP: şerit bunun alt kenarının üstünde durur. */
  work: { x: number; y: number; width: number; height: number };
  /** Kare sırası: sayfa yeniden gönderilen karenin dalgasını/hareketini ikinci kez oynatmaz. */
  seq: number;
  fx:
    /** `from`: hareketin başladığı yer (gerçek imlecin o anki yeri); yoksa sayfa imlecin son çizildiği yerden başlar. */
    | { kind: 'move'; to: Point; ms: number; from?: Point | null }
    | { kind: 'click'; at: Point; button: MouseButton; double: boolean }
    | { kind: 'target'; rect: Rect; mode: 'type' | 'click' | 'read' }
    | { kind: 'typing'; chars: number; total: number }
    | null;
}

// ───────────── fare ve klavye sınaması (`selftest.ts`) ─────────────

export type SelftestStatus = 'ok' | 'warn' | 'fail' | 'skipped';

export type SelftestStepId = 'prepare' | 'open' | 'focus' | 'survey' | 'wait' | 'click' | 'type' | 'select' | 'paste' | 'uia' | 'move' | 'close' | 'cleanup';

export interface SelftestStep {
  id: SelftestStepId;
  status: SelftestStatus;
  /** Ne oldu / neden olmadı (Türkçe, kısa). */
  detail: string;
  ms: number;
}

export interface SelftestReport {
  ok: boolean;
  /** Sınama yarıda kesildiyse nedeni: kullanıcı fareye dokundu, Durdur, iptal ya da önde beklenmedik pencere. */
  stopped: 'user' | 'panic' | 'aborted' | 'foreign' | null;
  /** Sınama hiç başlayamadıysa nedeni (izin kapalı, sürücü yok, zaten koşuyor). */
  unavailable?: string;
  steps: SelftestStep[];
  ms: number;
}

declare module '@fuber/shared' {
  interface Api {
    /** Adadaki "Durdur": süren fare/klavye dizisi kesilir, basılı düğme bırakılır, yeni eylem bir süre başlamaz. */
    'pc.stop': { req: void; res: Ok };
    /**
     * Fare ve klavye sınaması (Ayarlar › Gizlilik › Bilgisayar kullanımı). GERÇEK girdi üretir; yalnız kullanıcı
     * düğmeye basınca çağrılır. Not Defteri'ni kendi geçici dosyasıyla açar ve yalnız ona dokunur.
     */
    'pc.selftest.run': { req: void; res: SelftestReport };
  }
  interface BusEvents {
    'pc.activity': PcActivity;
    /** Adadaki "Durdur" basıldı: bilgisayarı kullanan BAŞKA modüller de (Jarvis'in tarayıcısı) durur. */
    'pc.stopRequested': { at: IsoDateTime };
    'pc.selftest.progress': { index: number; step: SelftestStep };
  }
  interface WindowEvents {
    /** Yalnız ekran katmanı penceresine gider (`overlay.ts`): çizilecek kare, katmanın kendi koordinatlarında (DIP). */
    'pc.overlay': PcOverlayFrame;
    'pc.activity': PcActivity;
    'pc.selftest.progress': { index: number; step: SelftestStep };
  }
}
