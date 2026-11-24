/**
 * Kokpit (Bugün sayfasının panosu): ortak sözleşme.
 *
 * - Kart tipleri ve hazır kartların veri biçimleri (ana süreç doldurur, arayüz çizer).
 * - 12 sütunlu DELİKSİZ ızgara (`packDashboard`): saf işlev; ana süreç (araç yanıtları, sınama) ve arayüz
 *   (kabın o anki genişliği) aynı işlevi çağırır. v1'in `izgara.ts` kuralları: kartlar sırayla satırlara dolar,
 *   her satır tam dolar, satırdaki hücreler aynı boydadır. v2 eki: yüksek bir kartın yanındaki iki küçük kart üst üste
 *   yığılır (kutucuklu görünüm) ve geniş kapta sütun sayısı artar (12 → 18 → 24).
 * - Kart kaydı (`dashboard.registerProvider`): başka modüller kendi kartını bununla ekler; modüller birbirini içe
 *   aktarmaz, hepsi bu paketi içe aktarır.
 *
 * Kurallar (v1'den): boş kart çizilmez (`fill` → `null` ya da boş veri); aynı bilgi iki kartta gösterilmez;
 * kullanıcının ve yapay zekânın düzeni kalıcıdır; "düzeni sıfırla" vardır.
 */

import type { ApprovalRequest, Id, IsoDateTime, LocalDay, Notification, Reminder, Todo } from './entities';
import type { BusEvents } from './events';
import type { Unsubscribe } from './services';

// ───────────────────────────── boyut ve ızgara ─────────────────────────────

/**
 * Kartın boyutu. `small`: dar ve kısa (sayı, hava, kur) · `medium`: orta (liste) · `wide`: geniş (iki sütunluk liste,
 * haber) · `large`: geniş ve yüksek (zaman çizgisi). Gerçek sütun sayısı kabın genişliğine göre seçilir.
 */
export type DashboardSize = 'small' | 'medium' | 'wide' | 'large';
export const DASHBOARD_SIZES = ['small', 'medium', 'wide', 'large'] as const satisfies readonly DashboardSize[];

export const isDashboardSize = (value: unknown): value is DashboardSize =>
  typeof value === 'string' && (DASHBOARD_SIZES as readonly string[]).includes(value);

/** Boyutun ızgara satırı (birim) sayısı. Bir birim arayüzde `DASHBOARD_UNIT_PX` yüksekliğinde bir izdir. */
export const DASHBOARD_ROWS: Record<DashboardSize, number> = { small: 2, medium: 3, wide: 3, large: 4 };

export type DashboardColumns = 1 | 6 | 12 | 18 | 24;

/** Kabın genişliğine göre ızgara kipi: sütun sayısı ve her boyutun kaç sütun istediği. */
export interface DashboardGridMode {
  columns: DashboardColumns;
  span: Record<DashboardSize, number>;
}

/** Sütunlar arası boşluk (px); arayüzün ızgarası ve eşik hesabı aynı değeri kullanır. */
export const DASHBOARD_GAP_PX = 16;

/**
 * Izgaranın KENDİ genişliğinden (px) kip seçer; pencere genişliği yanıltıcıdır (ray ve sohbet sütunu yer kaplar).
 * Eşikler bir küçük kartın yaklaşık 200 px'in altına inmemesi için: 12 sütun 640 px'te başlar (küçük kart 4 sütun;
 * 980 px'lik pencerede raydan kalan alan yaklaşık 660, 1440 px'lik pencerede ray ve sohbet sütunundan kalan alan
 * yaklaşık 750 px'tir; ikisinde de zaman çizgisinin yanına hava ve döviz sığar), 1100 px'ten sonra küçük kart 3
 * sütuna iner; 1600 ve 2200 px'te sütun sayısı artar ki geniş ekranda kartlar uzamasın, satıra daha çok kart sığsın.
 */
export function dashboardGridMode(widthPx: number): DashboardGridMode {
  if (widthPx < 520) return { columns: 1, span: { small: 1, medium: 1, wide: 1, large: 1 } };
  if (widthPx < 640) return { columns: 6, span: { small: 3, medium: 3, wide: 6, large: 6 } };
  if (widthPx < 1100) return { columns: 12, span: { small: 4, medium: 4, wide: 8, large: 8 } };
  if (widthPx < 1600) return { columns: 12, span: { small: 3, medium: 4, wide: 6, large: 8 } };
  if (widthPx < 2200) return { columns: 18, span: { small: 3, medium: 4, wide: 6, large: 8 } };
  return { columns: 24, span: { small: 3, medium: 4, wide: 6, large: 8 } };
}

/** Bir hücrenin alabileceği genişlikler. Küme küçüktür ki satırlar arasında kenarlar aynı çizgilere otursun. */
const ALLOWED_SPANS: Record<DashboardColumns, readonly number[]> = {
  1: [1],
  6: [3, 6],
  12: [3, 4, 6, 8, 9, 12],
  18: [3, 4, 5, 6, 8, 9, 10, 12, 18],
  24: [3, 4, 5, 6, 8, 9, 10, 12, 16, 18, 24],
};

/**
 * 12 sütunda üçte bir, yarım ve tam çizgilere oturan genişlikler (4, 6, 8, 12): eşit maliyette bunlar seçilir ki
 * satırların kenarları alt alta gelsin. Daha çok sütunda satırlar kalabalıktır; orada büyüme eşit paylaşılır.
 */
const isHarmonic = (span: number, columns: number): boolean => columns !== 12 || (span * 6) % columns === 0;

export interface DashboardLayoutItem {
  id: string;
  size: DashboardSize;
  /** Bant: kendi satırında, tam genişlikte, yüksekliği içeriğinden (bugün bandı). Sıradan bağımsız en üstte durur. */
  band?: boolean;
}

/** Bir kartın ızgaradaki yeri. CSS: `grid-column: col / span span; grid-row: row / span rows` (1 tabanlı). */
export interface DashboardPlacement {
  id: string;
  col: number;
  span: number;
  row: number;
  rows: number;
}

interface Cell {
  items: DashboardLayoutItem[];
  want: number;
}

/** Yüksek kartın yanında üst üste yığılan iki kartın birim toplamı en çok bu kadar olabilir (küçük + orta). */
const STACK_MAX_ROWS = 5;

const stackable = (item: DashboardLayoutItem | undefined): item is DashboardLayoutItem => item !== undefined && (item.size === 'small' || item.size === 'medium');

/**
 * Bir satırın hücreleri. Satırda yüksek (`large`) bir kart varsa dar kartlar ikişer ikişer tek hücrede üst üste
 * yığılır (kutucuklu görünüm): iki küçük kartın toplam boyu yüksek kartınkine eşittir; küçük + orta bir birim uzundur,
 * o zaman satır o kadar uzar. İki orta kart yığılmaz (satır fazla uzardı). Eşleşme sırayla yapılır ve araya giren
 * yüksek kart eşleşmeyi bozmaz (küçük · yüksek · küçük → solda iki küçük üst üste, sağda yüksek kart). Bir orta
 * kartın ardından iki küçük geliyorsa küçükler birbiriyle yığılır, orta tek kalır. Satır her durumda deliksiz kalır.
 */
function arrangeRow(items: readonly DashboardLayoutItem[], mode: DashboardGridMode): Cell[] {
  const want = (item: DashboardLayoutItem) => Math.min(mode.columns, mode.span[item.size]);
  const stack = mode.columns >= 12 && items.some((item) => item.size === 'large');
  const cells: Cell[] = [];
  /** Eşini bekleyen tek dar kartın hücresi. */
  let open: Cell | null = null;
  items.forEach((item, index) => {
    if (stack && stackable(item) && open) {
      const first = open.items[0]!;
      const fits = DASHBOARD_ROWS[first.size] + DASHBOARD_ROWS[item.size] <= STACK_MAX_ROWS;
      const upcoming = items.slice(index + 1).find(stackable);
      const keepForSmall = first.size === 'medium' && item.size === 'small' && upcoming?.size === 'small';
      if (fits && !keepForSmall) {
        open.items.push(item);
        open.want = Math.max(open.want, want(item));
        open = null;
        return;
      }
    }
    const cell: Cell = { items: [item], want: want(item) };
    cells.push(cell);
    if (stack && stackable(item)) open = cell;
  });
  return cells;
}

const cellsWidth = (cells: readonly Cell[]): number => cells.reduce((sum, cell) => sum + cell.want, 0);

/**
 * Satırı tam doldurur: her hücre izinli bir genişlik alır, toplam = sütun sayısı, hiçbir hücre istediğinden dar olmaz.
 * İstenen genişlikten sapma en az olsun (kare ceza; büyüme tek hücreye yığılmaz); eşitlikte hizalı genişlikler ve
 * sondaki hücrenin büyümesi yeğlenir. Belirleyicidir (aynı girdi → aynı çıktı).
 */
export function distributeRow(wants: readonly number[], columns: DashboardColumns): number[] {
  const allowed = ALLOWED_SPANS[columns];
  const count = wants.length;
  if (count === 0) return [];
  // best[i][left]: i. hücreden sona kadar `left` sütunu tam dolduran en ucuz seçim.
  const best: Array<Map<number, { cost: number; pick: number }>> = Array.from({ length: count + 1 }, () => new Map());
  best[count]!.set(0, { cost: 0, pick: 0 });
  for (let index = count - 1; index >= 0; index--) {
    for (let left = 0; left <= columns; left++) {
      let winner: { cost: number; pick: number } | null = null;
      for (const span of allowed) {
        if (span < wants[index]! || span > left) continue;
        const rest = best[index + 1]!.get(left - span);
        if (!rest) continue;
        const grow = span - wants[index]!;
        // Sondaki hücrenin büyümesi çok hafif ucuzdur: eşitlik hep aynı yönde bozulur.
        const cost = rest.cost + grow * grow * (1 + (count - 1 - index) * 0.02) + (isHarmonic(span, columns) ? 0 : 0.6);
        if (!winner || cost < winner.cost - 1e-9) winner = { cost, pick: span };
      }
      if (winner) best[index]!.set(left, winner);
    }
  }
  const out: number[] = [];
  let left: number = columns;
  for (let index = 0; index < count; index++) {
    const step = best[index]!.get(left);
    if (!step) {
      // İzinli bölüşüm yok (satır kurma kuralı gereği olmaz): son hücre kalanı alır, delik yine kalmaz.
      const used = wants.slice(0, count - 1).reduce((sum, value) => sum + value, 0);
      return [...wants.slice(0, count - 1), Math.max(1, columns - used)];
    }
    out.push(step.pick);
    left -= step.pick;
  }
  return out;
}

/**
 * Kartları verilen kipte delik bırakmadan dizer. Sıra korunur; bantlar en üstte, tam genişlikte ve tek başına bir
 * satırdadır. Son satırda tek başına kalan dar kart, üstündeki kalabalık satırdan bir komşu alır (tek kart tam
 * genişliğe gerilmesin).
 */
export function packDashboard(items: readonly DashboardLayoutItem[], mode: DashboardGridMode): DashboardPlacement[] {
  const out: DashboardPlacement[] = [];
  let top = 1;
  for (const band of items.filter((item) => item.band)) {
    out.push({ id: band.id, col: 1, span: mode.columns, row: top, rows: 1 });
    top += 1;
  }

  const rows: DashboardLayoutItem[][] = [];
  let current: DashboardLayoutItem[] = [];
  for (const item of items) {
    if (item.band) continue;
    if (current.length > 0 && cellsWidth(arrangeRow([...current, item], mode)) > mode.columns) {
      rows.push(current);
      current = [];
    }
    current.push(item);
  }
  if (current.length > 0) rows.push(current);

  // Denge: son satırda tek başına kalan dar kart tam genişliğe gerilmesin diye üst satırın son kartını yanına alır.
  // Üst satır üç ya da daha çok hücreliyse her zaman; iki hücreliyse yalnız geride kalan kart geniş bir kartsa
  // (haber gibi geniş kart tam satırda iyi durur, dar kart durmaz).
  if (mode.columns >= 12 && rows.length >= 2) {
    const last = rows[rows.length - 1]!;
    const previous = rows[rows.length - 2]!;
    const narrow = (item: DashboardLayoutItem) => item.size === 'small' || item.size === 'medium';
    const cells = arrangeRow(previous, mode);
    const leftAlone = cells.length === 2 && cells[0]!.items.length === 1 && !narrow(cells[0]!.items[0]!) && cells[1]!.items.length === 1;
    if (last.length === 1 && narrow(last[0]!) && (cells.length >= 3 || leftAlone)) {
      const moved = previous[previous.length - 1]!;
      if (narrow(moved) && cellsWidth(arrangeRow([moved, ...last], mode)) <= mode.columns) {
        previous.pop();
        last.unshift(moved);
      }
    }
  }

  for (const row of rows) {
    const cells = arrangeRow(row, mode);
    const spans = distributeRow(
      cells.map((cell) => cell.want),
      mode.columns,
    );
    const height = Math.max(...cells.map((cell) => cell.items.reduce((sum, item) => sum + DASHBOARD_ROWS[item.size], 0)));
    let col = 1;
    cells.forEach((cell, index) => {
      const span = spans[index]!;
      if (cell.items.length === 1) {
        out.push({ id: cell.items[0]!.id, col, span, row: top, rows: height });
      } else {
        // Üstteki kart kendi boyunu alır; satır daha uzunsa artan birim alttaki karta gider (toplam = satır boyu).
        const upper = Math.min(DASHBOARD_ROWS[cell.items[0]!.size], height - 1);
        out.push({ id: cell.items[0]!.id, col, span, row: top, rows: upper });
        out.push({ id: cell.items[1]!.id, col, span, row: top + upper, rows: height - upper });
      }
      col += span;
    });
    top += height;
  }
  return out;
}

/** Yerleşimde delik ya da üst üste binme var mı (sınama ve tanı için). Bant satırları dahil her iz tam dolu olmalı. */
export function dashboardHoles(placements: readonly DashboardPlacement[], columns: number): number {
  if (placements.length === 0) return 0;
  const rows = Math.max(...placements.map((place) => place.row + place.rows - 1));
  const filled = Array.from({ length: rows }, () => new Array<number>(columns).fill(0));
  for (const place of placements) {
    for (let row = place.row; row < place.row + place.rows; row++) {
      for (let col = place.col; col < place.col + place.span; col++) filled[row - 1]![col - 1]! += 1;
    }
  }
  return filled.flat().filter((count) => count !== 1).length;
}

// ───────────────────────────── kartlar ─────────────────────────────

/** Kartı kimin koyduğu: `system` yerleşik doldurucu · `module` başka modülün kaydı · `ai` araçla · `user` elle. */
export type DashboardCardSource = 'system' | 'module' | 'ai' | 'user';

export interface DashboardCard<D = unknown> {
  /** Benzersiz kimlik: yerleşik kartta doldurucunun kimliği (`weather`), özel kartta kaydın kimliği. */
  id: string;
  /** Arayüzde hangi bileşenin çizeceği (`registerTodayCard(kind, …)`); yerleşiklerde kimlikle aynı. */
  kind: string;
  moduleId: string;
  title: string;
  size: DashboardSize;
  defaultSize: DashboardSize;
  source: DashboardCardSource;
  /** Bant (bugün bandı): kaldırılamaz, taşınamaz, boyutu değişmez. */
  band: boolean;
  /** Varsayılan sıradaki yeri (büyük olan önce); arayüzün kendi kaydettiği kartlar bu sıraya göre araya girer. */
  priority: number;
  /** Kartın ilgili sayfası (başlıktaki bağlantı); yoksa `null`. */
  page: string | null;
  /** Verinin alındığı an (ağdan gelen kartlarda); yerel veride `null`. */
  updatedAt: IsoDateTime | null;
  /** Son yenileme başarısız oldu ya da ağ kapalı: gösterilen son iyi veridir (`updatedAt` anından). */
  stale: boolean;
  data: D;
}

/** Kullanıcının/yapay zekânın kalıcı düzeni. Boşsa varsayılan düzen geçerlidir. */
export interface DashboardLayoutState {
  /** Kart kimlikleri, istenen sırayla (o an çizilmeyen kartlar da yerini korur). */
  order: string[];
  sizes: Record<string, DashboardSize>;
  /** Kullanıcının kaldırdığı yerleşik kartlar. */
  hidden: string[];
}

export interface DashboardSnapshot {
  /** Her içerik ya da düzen değişiminde artar. */
  revision: number;
  generatedAt: IsoDateTime;
  /** Çizilecek kartlar, sırayla; boş kart yoktur. İlki her zaman bugün bandıdır. */
  cards: DashboardCard[];
  layout: DashboardLayoutState;
  /** Düzen varsayılandan farklı mı ("Düzeni sıfırla" görünsün mü). */
  customized: boolean;
  /**
   * Görünümün kendiliğinden eskiyeceği an (bir hatırlatıcının vakti geçecek, gün dönecek, ağ verisi bayatlayacak);
   * arayüz bu andan sonraki ilk dakika başında yeniden ister. Yoksa `null`.
   */
  validUntil: IsoDateTime | null;
}

// ── yerleşik kartların veri biçimleri ──

export const DASHBOARD_CARD_IDS = {
  today: 'today',
  notices: 'notices',
  jobs: 'jobs',
  agenda: 'agenda',
  todos: 'todos',
  weather: 'weather',
  fx: 'fx',
  news: 'news',
  sessions: 'sessions',
  activity: 'activity',
  usage: 'usage',
  suggestions: 'suggestions',
} as const;

export interface DashboardWeekDay {
  day: LocalDay;
  reminders: number;
  todos: number;
}

/** Bugün bandı: selamın altındaki cümlenin sayıları, bekleyen onaylar ve hafta şeridi. */
export interface TodayBandData {
  day: LocalDay;
  /** Bugün (ve gecikmiş) kalemler. */
  reminders: number;
  todos: number;
  /** Bugün bir şey yoksa sıradaki ilk kalem. */
  next: { day: LocalDay; time: string | null; text: string } | null;
  /** Onay bekleyen işler YALNIZ burada gösterilir. */
  approvals: ApprovalRequest[];
  /** Bugünden başlayan yedi gün. */
  week: DashboardWeekDay[];
}

export interface NoticesData {
  items: Notification[];
}

export interface JobsData {
  /**
   * Süren ve sırada bekleyen işler. İlerleme ve adım burada YOKTUR: arayüz onları canlı olaydan (`job.progress`)
   * okur; yoksa her ilerleme adımında bütün pano yeniden yayınlanırdı.
   */
  items: JobsItem[];
}

/**
 * "Süren işler" kartının bir satırı. Arka plan işi (`ctx.jobs`) ilerleme çubuğu ve Durdur düğmesiyle çizilir; başka
 * modülün katkısı (takip işi: `dashboard.jobs.collect`) `page` taşır: satıra dokununca o sayfa açılır, `detail` durumu
 * anlatan tek cümledir.
 */
export interface JobsItem {
  id: Id;
  title: string;
  moduleId: string;
  status: 'queued' | 'running' | 'paused';
  startedAt: IsoDateTime;
  /** Katkı satırının sayfası (`watch`); arka plan işinde yok. */
  page?: string;
  /** Katkı satırının durum cümlesi ("Sonraki denetim 2 dk sonra"). */
  detail?: string | null;
  /** Kısa kimlik ("#K3QZ"): sesle söylenebilir. */
  tag?: string | null;
}

/**
 * "Süren işler" kartına katkı: pano kartı doldururken `dashboard.jobs.collect` olayını yayınlar, dinleyen modüller
 * (İşler: takip işleri) kendi süren işlerini `items` dizisine ekler (eşzamanlı). Ayrı kart açılmaz: süren işler tek
 * yerde görünür. Katkı değişince modül `dashboard.invalidate(DASHBOARD_CARD_IDS.jobs)` çağırır.
 */
export interface DashboardJobsCollect {
  items: JobsItem[];
}

export interface AgendaItem {
  /** Hatırlatıcının kendisi (arayüz "tamamlandı" ve "geri al" için bütün kaydı ister). */
  reminder: Reminder;
  overdue: boolean;
  /** Tekrarın Türkçe özeti ("her gün"); tekrarsızsa `null`. */
  repeats: string | null;
}

export interface AgendaData {
  items: AgendaItem[];
  /** Önümüzdeki yedi günde (ve gecikmiş) toplam hatırlatıcı. */
  total: number;
}

export interface TodosData {
  items: Array<{ todo: Todo; late: boolean }>;
  total: number;
}

export interface WeatherData {
  place: string;
  temperature: number | null;
  feelsLike: number | null;
  /** WMO hava kodu (simge seçimi için) ve Türkçe özeti. */
  code: number | null;
  summary: string;
  min: number | null;
  max: number | null;
  precipitationChance: number | null;
  days: Array<{ date: string; weekday: string; code: number | null; summary: string; min: number | null; max: number | null }>;
  attribution: string;
}

export interface FxData {
  /** Kurların karşılığı olan para ("TRY"). */
  base: string;
  rates: Array<{ code: string; name: string; rate: number; buying: number | null; selling: number | null; change: number | null }>;
  /** Kurun ait olduğu gün (YYYY-MM-DD) ve kaynağı. */
  date: string;
  source: string;
}

export interface NewsData {
  items: Array<{ title: string; url: string; source: string; at: IsoDateTime | null }>;
}

export interface SessionsData {
  items: Array<{ id: string; title: string; project: string | null; lastAt: IsoDateTime; messageCount: number }>;
  total: number;
}

export interface ActivityData {
  items: Array<{ id: string; at: IsoDateTime; text: string; detail: string | null; tone: 'done' | 'failed' | 'info'; page: string }>;
}

export interface UsageData {
  costUsd: number;
  budgetUsd: number;
  calls: number;
  overBudget: boolean;
}

export interface DashboardSuggestion {
  id: Id;
  text: string;
  detail: string | null;
  /** Dokununca sohbet kutusuna yazılacak söz; yoksa `text`. */
  prompt: string | null;
  createdAt: IsoDateTime;
}

export interface SuggestionsData {
  items: DashboardSuggestion[];
}

// ── yapay zekânın/kullanıcının eklediği özel kartlar: genel şablonlar ──

export type DashboardCustomContent =
  | { template: 'text'; text: string }
  | { template: 'keyvalue'; pairs: Array<{ label: string; value: string }> }
  | { template: 'list'; items: Array<{ text: string; detail?: string; done?: boolean }> }
  | { template: 'metric'; value: string; unit?: string; label?: string; delta?: string; trend?: 'up' | 'down' | 'flat' }
  | { template: 'progress'; value: number; label?: string; detail?: string }
  | { template: 'link'; url: string; label?: string; description?: string };

export type DashboardTemplate = DashboardCustomContent['template'];
export const DASHBOARD_TEMPLATES = ['text', 'keyvalue', 'list', 'metric', 'progress', 'link'] as const satisfies readonly DashboardTemplate[];

/** Özel kartın arayüzdeki türü: `custom.<şablon>`. */
export const customCardKind = (template: DashboardTemplate): string => `custom.${template}`;

/**
 * "Boş kart çizilmez" kuralı: veri yoksa (`null`, boş dizi, boş metin) ya da bir nesnenin bütün içerik alanları
 * boşsa kart boştur. Sayılar ve mantıksal değerler içerik sayılır. `items`/`pairs`/`rates`/`days` gibi liste alanı
 * taşıyan veride liste boşsa, yanında sayı olsa bile kart boştur (`{ items: [], total: 0 }`).
 */
export function isEmptyCardData(data: unknown): boolean {
  if (data === null || data === undefined) return true;
  if (typeof data === 'string') return data.trim() === '';
  if (typeof data === 'number' || typeof data === 'boolean') return false;
  if (Array.isArray(data)) return data.length === 0;
  if (typeof data === 'object') {
    const record = data as Record<string, unknown>;
    const lists = Object.values(record).filter((value) => Array.isArray(value));
    if (lists.length > 0) return lists.every((list) => (list as unknown[]).length === 0);
    const content = Object.entries(record).filter(([key]) => key !== 'template');
    return content.every(([, value]) => value === null || value === undefined || (typeof value === 'string' && value.trim() === ''));
  }
  return false;
}

// ───────────────────────────── kart kaydı (ana süreç) ─────────────────────────────

/** Doldurucuya verilen bağlam. */
export interface DashboardFillContext {
  now: Date;
  today: LocalDay;
}

/** Doldurucunun ürettiği kart içeriği. `data` düz JSON'dur (pencereye yapısal kopyalanır). */
export interface DashboardFill<D = unknown> {
  data: D;
  /** Verilirse kaydın başlığı yerine bu kullanılır ("İstanbul"). */
  title?: string;
  /** Ağdan gelen veride alındığı an; `stale: true` son iyi verinin gösterildiğini söyler. */
  updatedAt?: IsoDateTime | null;
  stale?: boolean;
  /** Görünümün eskiyeceği an (bkz. `DashboardSnapshot.validUntil`). */
  validUntil?: IsoDateTime | null;
}

/**
 * Bir modülün Kokpit'e koyduğu kart. Modül `setup` içinde kaydeder, `teardown` içinde dönen işlevi çağırır:
 *
 * ```ts
 * const off = dashboard.registerProvider({
 *   id: 'mail.inbox', moduleId: 'mail', title: 'Son e-postalar', defaultSize: 'medium', priority: 55,
 *   events: ['mail.changed'],
 *   fill: () => { const items = repo.unread(5); return items.length ? { data: { items } } : null; },
 * });
 * ```
 */
export interface DashboardProvider<D = unknown> {
  /** Kartın kimliği; bütün kartlar arasında benzersiz. Modül kimliğiyle başlaması önerilir (`mail.inbox`). */
  id: string;
  moduleId: string;
  /** Arayüz türü; verilmezse `id`. Özel çizim için arayüzde `registerTodayCard(kind, Bileşen)` ile eşlenir. */
  kind?: string;
  /** Kartın Türkçe başlığı. */
  title: string;
  defaultSize: DashboardSize;
  /** Varsayılan sıradaki yeri: büyük olan önce (yerleşikler 10–100 arasında; bugün bandı her zaman ilk). */
  priority: number;
  /** Kartın ilgili sayfası (`PageDef.id`). */
  page?: string;
  /** Bu olaylardan biri yayınlanınca kart yeniden doldurulur. */
  events?: ReadonlyArray<keyof BusEvents>;
  /** Yalnız bugün bandı için. */
  band?: boolean;
  /**
   * Kartı doldurur. Eşzamanlıdır ve hızlı olmalıdır (her pano okumasında çağrılır); ağ gerektiren doldurucu kendi
   * önbelleğinden okur, arka planda yeniler ve bitince `dashboard.invalidate(id)` çağırır.
   * `null` ya da boş veri: kart ÇİZİLMEZ. Fırlatırsa kart çizilmez, hata günlüğe yazılır.
   */
  fill(context: DashboardFillContext): DashboardFill<D> | null;
}

type RegistryListener = (change: { kind: 'providers' } | { kind: 'invalidate'; id: string | null }) => void;

const providers = new Map<string, DashboardProvider>();
const registryListeners = new Set<RegistryListener>();
const notifyRegistry: RegistryListener = (change) => {
  for (const listener of [...registryListeners]) listener(change);
};

/** Kokpit'in kart kaydı. Süreç başına tek kayıt; pano modülü kapalıyken de kayıt alınır, açılınca kartlar görünür. */
export const dashboard = {
  /** Kartı kaydeder; aynı kimlikle ikinci kayıt fırlatır. Dönen işlev kaydı kaldırır. */
  registerProvider<D>(provider: DashboardProvider<D>): Unsubscribe {
    if (providers.has(provider.id)) throw new Error(`Kokpit kartı iki kez kaydedildi: ${provider.id}`);
    providers.set(provider.id, provider as DashboardProvider);
    notifyRegistry({ kind: 'providers' });
    return () => {
      if (providers.get(provider.id) !== provider) return;
      providers.delete(provider.id);
      notifyRegistry({ kind: 'providers' });
    };
  },
  /** Kartın verisi değişti (olay yolu dışındaki değişimler için): pano yeniden doldurur. `id` yoksa hepsi. */
  invalidate(id?: string): void {
    notifyRegistry({ kind: 'invalidate', id: id ?? null });
  },
  /** Kayıtlı kartlar (pano modülü okur). */
  providers(): DashboardProvider[] {
    return [...providers.values()];
  },
  /** Kayıt değişimlerini ve geçersiz kılmaları dinler (pano modülü). */
  subscribe(listener: RegistryListener): Unsubscribe {
    registryListeners.add(listener);
    return () => registryListeners.delete(listener);
  },
};

/**
 * Kartların sırası. Kayıtlı düzende yeri olan kartlar o sırayla; düzende olmayan (yeni gelen) kart, öncelik sırasına
 * göre kendisinden düşük öncelikli ilk kartın önüne girer. Bantlar her zaman başta.
 */
export function orderDashboardCards<T extends { id: string; band: boolean }>(cards: readonly T[], order: readonly string[], priority: (card: T) => number): T[] {
  const index = new Map(order.map((id, position) => [id, position]));
  const known = cards.filter((card) => !card.band && index.has(card.id)).sort((a, b) => index.get(a.id)! - index.get(b.id)!);
  const fresh = cards.filter((card) => !card.band && !index.has(card.id)).sort((a, b) => priority(b) - priority(a));
  const out = [...known];
  for (const card of fresh) {
    const at = out.findIndex((other) => priority(other) < priority(card));
    if (at === -1) out.push(card);
    else out.splice(at, 0, card);
  }
  return [...cards.filter((card) => card.band), ...out];
}

// ───────────────────────────── IPC ve olay ─────────────────────────────

declare module './ipc' {
  interface Api {
    /** Çizilecek kartlar ve düzen. Ağ kartları önbellekten gelir; bayatsa arka planda yenilenir ve olay yayınlanır. */
    'dashboard.get': { req: void; res: DashboardSnapshot };
    /** Kartları verilen sıraya dizer (verilmeyen kartlar sonda, kendi aralarındaki sırayla kalır). */
    'dashboard.reorder': { req: { ids: string[] }; res: DashboardSnapshot };
    'dashboard.resize': { req: { id: string; size: DashboardSize }; res: DashboardSnapshot };
    /** Kartı kaldırır: yerleşik kart gizlenir, özel kart silinir. `dashboard.restore` ile geri alınır. */
    'dashboard.remove': { req: { id: string }; res: DashboardSnapshot };
    /** Kaldırılan kartı geri getirir (toast'taki "Geri al"). */
    'dashboard.restore': { req: { id: string }; res: DashboardSnapshot };
    /** Düzeni sıfırlar: sıra, boyutlar ve gizlenen yerleşik kartlar varsayılana döner (özel kartlar silinmez). */
    'dashboard.reset': { req: void; res: DashboardSnapshot };
    'dashboard.dismissSuggestion': { req: { id: Id }; res: DashboardSnapshot };
  }
}

declare module './events' {
  interface BusEvents {
    /** Pano değişti: arayüz `dashboard.get` ile yeniden okur. `cardId`: eklenen/kaldırılan/güncellenen kart (varsa). */
    'dashboard.changed': { revision: number; reason: 'data' | 'layout' | 'card'; by: DashboardCardSource; cardId: string | null };
    /** "Süren işler" kartına katkı toplama (bkz. `DashboardJobsCollect`). */
    'dashboard.jobs.collect': DashboardJobsCollect;
  }
  interface WindowEvents {
    'dashboard.changed': BusEvents['dashboard.changed'];
  }
}
