/**
 * Atölye modülünün arayüzle paylaştığı tipler ve modüle özgü IPC kanalları (tip genişletmesi).
 * Yetenekler sayfası bu dosyayı `import type` ile alır; Node'a özgü hiçbir şey içe aktarmaz.
 *
 * Çekirdek sözleşmedeki `skills.*` kanalları aynen uygulanır. Sözleşmede karşılığı olmayan üç iş buradadır:
 * kod görüntüleme (`workshop.source`), bulut beyni ve süren yapımların durumu (`workshop.status`),
 * yapımı durdurma (`workshop.cancelBuild`).
 */
import type { DashboardCustomContent, Id, IsoDateTime, Job, JsonObject, JsonValue, Ok, Risk, SkillInfo, SkillManifest, ToolOrigin } from '@fuber/shared';

/**
 * Eklenti katkıları (KURGU §10.1, `docs/EKLENTI-API.md`). Bir eklenti araçların yanında pano kartı, sayfa, zamanlanmış
 * ya da olay tetikli iş, takip kaynağı, ayar ve sesli komut kalıbı ekleyebilir. Hepsinin işleyicisi bir ARAÇTIR
 * (`tool`): tek işleyici türü, tek öz-sınama düzeni. `hidden` araç beyne görünmez; yalnız katkılar çağırır.
 */
export type PluginEventName = 'app.started' | 'reminder.fired' | 'mail.received' | 'watch.fired' | 'user.returned';
export const PLUGIN_EVENTS = ['app.started', 'reminder.fired', 'mail.received', 'watch.fired', 'user.returned'] as const satisfies readonly PluginEventName[];

/** `daily`: her gün "SS:DD" (yerel saat; `days` 1=Pazartesi … 7=Pazar) · `everyMinutes`: aralıkla · `on`: olay olunca. */
export type PluginSchedule = { daily: string; days?: number[] } | { everyMinutes: number } | { on: PluginEventName };
/** İşin sonucu nasıl duyurulur: `speak` sesli (izin: `speak`) · `notify` sessiz bildirim (izin: `notify`) · `silent` hiç. */
export type PluginAnnounce = 'speak' | 'notify' | 'silent';

export interface PluginTool {
  name: string;
  description: string;
  risk: Risk;
  inputSchema: JsonObject;
  /** Beyne araç olarak sunulmaz; yalnız kart, iş, takip, sayfa ve sesli kalıp çağırır. */
  hidden?: boolean;
}
/** Pano kartının görünümü: Bugün panosunun hazır şablonları (`metric`, `list`, `keyvalue`, `text`, `progress`). */
export type PluginCardTemplate = Exclude<DashboardCustomContent['template'], 'link'>;
export const PLUGIN_CARD_TEMPLATES = ['metric', 'list', 'keyvalue', 'text', 'progress'] as const satisfies readonly PluginCardTemplate[];

export interface PluginCard {
  id: string;
  title: string;
  template: PluginCardTemplate;
  /** Kartın verisini üreten araç (`risk: read`); `data.card` alanında şablonun verisini döndürür. */
  tool: string;
  input: JsonObject;
  refreshMinutes: number;
  size: 'small' | 'medium' | 'wide';
}
export interface PluginJob {
  id: string;
  title: string;
  tool: string;
  input: JsonObject;
  schedule: PluginSchedule;
  announce: PluginAnnounce;
}
export interface PluginWatch {
  id: string;
  title: string;
  /** `data.items: [{ key, title, detail? }]` döndüren araç; daha önce görülmemiş `key` yeni sayılır ve duyurulur. */
  tool: string;
  input: JsonObject;
  everyMinutes: number;
  announce: PluginAnnounce;
}
export interface PluginPage {
  id: string;
  title: string;
  /** Yan menü simgesi (hazır kümeden bir ad; bilinmeyen ad varsayılan simgeye düşer). */
  icon: string;
  /** Sayfanın tek dosyalık HTML'i: `page.html` ya da `page_<ad>.html`. */
  file: string;
}
export interface PluginSetting {
  key: string;
  label: string;
  description?: string;
  type: 'text' | 'number' | 'boolean' | 'select';
  default: string | number | boolean;
  /** `select` için seçenekler. */
  options?: string[];
}
export interface PluginVoice {
  /** Kullanıcının söyleyebileceği kalıplar (küçük harf, Türkçe). Söz bu kalıplardan biriyle eşleşirse araç doğrudan çağrılır. */
  phrases: string[];
  tool: string;
  input: JsonObject;
}

/** Diskteki `manifest.json`: sözleşmedeki `SkillManifest` + izin ayrıntıları, katkılar ve köken. */
export interface WorkshopManifest extends SkillManifest {
  tools: PluginTool[];
  /** `ctx.fetch`'in gidebileceği alan adları (isteğe bağlı `:port`). `net` izni bunlarla sınırlıdır. */
  net?: { hosts: string[] };
  /** `ctx.files`'ın okuyup yazabileceği klasör kökleri (`{belgeler}/…`, `{masaustu}/…`, `{indirilenler}/…`). `fs` izni bunlarla sınırlıdır. */
  fs?: { roots: string[] };
  /** `ctx.tools.call` ile çağırabileceği Jarvis araçları (ad listesi). */
  uses?: { tools: string[] };
  /** Sesli duyuru yapabilir (`ctx.speak`, `announce: "speak"`). */
  speak?: boolean;
  cards?: PluginCard[];
  jobs?: PluginJob[];
  watches?: PluginWatch[];
  pages?: PluginPage[];
  settings?: PluginSetting[];
  voice?: PluginVoice[];
  /** `workshop`: Atölye yazdı · `manual`: klasör elle kondu. */
  createdBy: 'workshop' | 'manual';
  createdAt?: IsoDateTime;
}

/** Yapımın kullanıcıya gösterilen aşaması. */
export type BuildPhase = 'planning' | 'writing' | 'testing' | 'approval';

export interface BuildProgress {
  /** Yapım sürerken yeteneğin geçici kimliği (`skills.list` içindeki `building` kaydıyla aynı). */
  skillId: string;
  jobId: Id;
  goal: string;
  phase: BuildPhase;
  /** O an yapılan iş, kısa Türkçe cümle. */
  step: string;
  startedAt: IsoDateTime;
}

export interface CloudStatus {
  /** Yetenek geliştirmek için derin beyin (Anthropic API ya da bu bilgisayardaki Claude Code) şu an kullanılabilir mi. */
  ok: boolean;
  /** Yapımı yürütecek sağlayıcı; yoksa `null`. Derin beyin bağlanmamışsa (eski sınamalar) alan hiç yoktur. */
  provider?: 'anthropic' | 'claude-code' | null;
  /** Kullanılamıyorsa kullanıcıya gösterilecek Türkçe neden. */
  reason: string | null;
  /** Son gerçek yoklamanın anı; hiç yoklanmadıysa `null` (yalnız anahtar varlığına bakıldı). */
  checkedAt: IsoDateTime | null;
}

export interface WorkshopStatus {
  cloud: CloudStatus;
  builds: BuildProgress[];
  /** Yetenek başına: onaylanmış mı ve hangi alan adlarına gidebilir (kartlar için; `SkillInfo`'da yok). */
  skills: Record<
    string,
    {
      approved: boolean;
      hosts: string[];
      createdBy: 'workshop' | 'manual';
      draft: boolean;
      /** Onay bekleyen bir güncellemesi var (eski sürüm o sırada çalışmayı sürdürür). */
      update?: { version: number; note: string | null };
      /** Saklanan eski sürüm sayısı (geri alınabilir). */
      versions?: number;
      /** Ne eklediğinin sayıları (liste satırındaki rozetler için). */
      adds?: { tools: number; cards: number; jobs: number; watches: number; pages: number; settings: number; voice: number };
    }
  >;
}

/** Bir eklentinin ne eklediği ve hangi izinleri istediği: onay kartında, sesli özette ve Eklentiler sayfasında gösterilir. */
export interface PluginPreview {
  id: string;
  name: string;
  version: number;
  /** Beyne görünen araç sayısı ve gizli işleyici sayısı. */
  tools: number;
  hiddenTools: number;
  cards: PluginCard[];
  jobs: PluginJob[];
  watches: PluginWatch[];
  pages: PluginPage[];
  settings: PluginSetting[];
  voice: PluginVoice[];
  hosts: string[];
  roots: string[];
  usedTools: string[];
  speak: boolean;
  notify: boolean;
  /** "Ne ekleyecek": kullanıcıya gösterilecek hazır Türkçe satırlar. */
  adds: string[];
  /** "Hangi izinler": kullanıcıya gösterilecek hazır Türkçe satırlar. */
  permissions: string[];
  /** Güncelleme önizlemesiyse bir önceki sürüme göre farklar (yeni izinler, yeni katkılar); değilse boş. */
  changes: string[];
  /** Bu önizleme onay bekleyen bir GÜNCELLEMEYE mi ait (yoksa kurulu sürüme). */
  staged: boolean;
}

export interface SkillVersionInfo {
  version: number;
  createdAt: IsoDateTime;
  /** Bu sürümü doğuran istek ("şunu da ekle…"); ilk sürümde yapım isteği. */
  note: string | null;
  /** Şu an kurulu olan sürüm. */
  current: boolean;
}

/** Etkin bir eklentinin yan menüye eklediği sayfa. Gezinme kimliği: `plugin:<skillId>:<pageId>`. */
export interface PluginPageInfo {
  skillId: string;
  skillName: string;
  pageId: string;
  title: string;
  icon: string;
}

export interface PluginSettingValue extends PluginSetting {
  value: string | number | boolean;
}

/** Kendiliğinden çalışan katkının (zamanlanmış iş, takip, pano kartı) son durumu. */
export interface PluginActivity {
  skillId: string;
  skillName: string;
  kind: 'job' | 'watch' | 'card';
  id: string;
  title: string;
  /** İnsan okur zamanlama: "her gün 09:00", "10 dakikada bir", "e-posta gelince". */
  schedule: string;
  announce: PluginAnnounce | null;
  lastRunAt: IsoDateTime | null;
  lastOk: boolean | null;
  lastText: string | null;
  nextRunAt: IsoDateTime | null;
}

/** `plugin:<skillId>:<pageId>` gezinme kimliği. */
export const pluginPageRoute = (skillId: string, pageId: string) => `plugin:${skillId}:${pageId}`;
export function parsePluginPageRoute(route: string): { skillId: string; pageId: string } | null {
  const match = /^plugin:([a-z][a-z0-9_]*):([a-z][a-z0-9_]*)$/.exec(route);
  return match ? { skillId: match[1]!, pageId: match[2]! } : null;
}

/**
 * Eklenti sayfası ↔ kabuk iletileri (`postMessage`). Sayfa güvenli kutuda (opak kökenli `iframe sandbox="allow-scripts"`)
 * koşar; uygulamanın IPC'sine ulaşamaz. Sayfadaki `window.fuber` (ana süreçte eklenen köprü betiği) şu iletileri
 * gönderir; kabuk bunları aşağıdaki `plugins.*` kanallarına çevirir ve yanıtı aynı `id` ile geri yollar.
 */
export type PluginFrameRequest =
  | { fuberPlugin: 1; id: number; op: 'call'; tool: string; input: unknown }
  | { fuberPlugin: 1; id: number; op: 'storage.get' | 'storage.delete'; key: string }
  | { fuberPlugin: 1; id: number; op: 'storage.set'; key: string; value: JsonValue }
  | { fuberPlugin: 1; id: number; op: 'settings.get'; key: string };
export type PluginFrameReply = { fuberPlugin: 1; id: number; ok: true; value: unknown } | { fuberPlugin: 1; id: number; ok: false; error: string };

export interface SkillSource {
  path: string;
  content: string;
  bytes: number;
  /** Dosya gösterim sınırından büyüktü; `content` kısaltıldı. */
  truncated: boolean;
}

declare module '@fuber/shared' {
  interface Api {
    /** Yeteneğin bir dosyasını salt okunur gösterim için döndürür. `path`, `SkillDetail.files[].path` değeridir. */
    'workshop.source': { req: { id: string; path: string }; res: SkillSource };
    /**
     * Bulut beyninin durumu, süren yapımlar ve yetenek başına ek bilgi. `probe: true` bulutu gerçek bir
     * (çok küçük) istekle yoklar; sonuç birkaç dakika önbellekte kalır.
     */
    'workshop.status': { req: { probe?: boolean }; res: WorkshopStatus };
    /** Süren yapımı durdurur. `id`: yapımın geçici yetenek kimliği. */
    'workshop.cancelBuild': { req: { id: string }; res: Ok };
    /** Eklentinin ne eklediği ve hangi izinleri istediği. Onay bekleyen bir güncelleme varsa `staged: true` ile o döner. */
    'workshop.preview': { req: { id: string; staged?: boolean }; res: PluginPreview };
    /** Saklanan sürümler, yeniden eskiye (kurulu olan dahil). */
    'workshop.versions': { req: { id: string }; res: SkillVersionInfo[] };
    /** Eklentiyi günceller ("şunu da ekle"): arka plan işi başlatır; hazır olunca kullanıcıdan onay istenir. */
    'workshop.update': { req: { id: string; change: string }; res: Job };
    /** Onay bekleyen güncellemeyi uygular ya da atar. */
    'workshop.approveUpdate': { req: { id: string; approve: boolean }; res: SkillInfo };
    /** Önceki (ya da verilen) sürüme döner. */
    'workshop.rollback': { req: { id: string; version?: number }; res: SkillInfo };

    /** Etkin eklentilerin yan menü sayfaları. */
    'plugins.pages': { req: void; res: PluginPageInfo[] };
    /** Sayfanın güvenli kutuya yüklenecek TAM belgesi (içerik güvenlik politikası ve `window.fuber` köprüsü eklenmiş). */
    'plugins.page': { req: { skillId: string; pageId: string }; res: { title: string; skillName: string; html: string } };
    /** Sayfanın kendi eklentisinin bir aracını çağırması. Onay isteyen (`danger`) araç sayfadan çağrılamaz. */
    'plugins.pageCall': { req: { skillId: string; pageId: string; tool: string; input: unknown }; res: { ok: boolean; text: string; data?: unknown } };
    /** Sayfanın eklenti deposuna erişimi (eklentinin `ctx.storage` deposuyla aynı). */
    'plugins.pageStorage': {
      req: { skillId: string; op: 'get' | 'set' | 'delete'; key: string; value?: JsonValue };
      res: { found: boolean; value: JsonValue };
    };
    /** Eklentinin ayarları ve o anki değerleri. */
    'plugins.settings': { req: { skillId: string }; res: PluginSettingValue[] };
    'plugins.setSetting': { req: { skillId: string; key: string; value: string | number | boolean }; res: PluginSettingValue[] };
    /** Zamanlanmış işlerin, takiplerin ve kartların son durumu. `skillId` verilmezse bütün etkin eklentiler. */
    'plugins.activity': { req: { skillId?: string }; res: PluginActivity[] };
    /** Bir işi, takibi ya da kart yenilemesini şimdi koşturur. */
    'plugins.runNow': { req: { skillId: string; kind: 'job' | 'watch' | 'card'; id: string }; res: { ok: boolean; text: string } };
  }
  interface BusEvents {
    /** Eklenti katkıları değişti (sayfa, ayar, iş durumu). `skillId` yoksa hepsi yeniden okunur. */
    'plugins.changed': { skillId: string | null };
    /** Atölye: bu istek eklentiyle yapılamıyor; çekirdek geliştirme gerekir. Yalnız kullanıcının kendi isteğinden doğan yapımlarda yayınlanır. */
    'selfdev.escalate': { request: string; reason: string; origin: ToolOrigin };
  }
  interface WindowEvents {
    'plugins.changed': { skillId: string | null };
  }
}
