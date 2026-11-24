// Ayarlar › Brifing ve gündem ile Bugün'ün brifing kartının saf mantığı: saat doğrulama, kaynak gruplama, adres
// kısaltma, kartın yüksekliğe göre neyi göstereceği. React ve IPC yok; `briefing-logic.test.ts` sınar.
import type { NewsCategory, NewsSourceView, NewsTopic } from '../../../../../main/modules/news/types';

/** Yerel saat `SS:DD` (00:00–23:59). */
export function isValidTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** `SS:DD` → günün dakikası; geçersizse `null`. */
export function minutesOf(value: string): number | null {
  if (!isValidTime(value)) return null;
  const [hours, minutes] = value.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

/** Gün içi aralık geçerli mi: iki uç da geçerli ve başlangıç bitişten önce (gece yarısını aşan aralık kabul edilmez). */
export function isValidRange(from: string, to: string): boolean {
  const start = minutesOf(from);
  const end = minutesOf(to);
  return start !== null && end !== null && start < end;
}

/** Tamsayıyı aralığa sıkıştırır (Seçim kutusundan gelen değerler için güvenlik). */
export function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Besleme adresini göze sığacak biçimde kısaltır: şema, `www.` ve sondaki bölü atılır; uzunsa ortadan değil sondan kesilir. */
export function shortUrl(url: string, max = 42): string {
  const bare = url
    .trim()
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/+$/, '');
  if (bare.length <= max) return bare;
  return `${bare.slice(0, Math.max(1, max - 1))}…`;
}

/** Ayarlar'daki kategori sırası (sözleşmedeki `NEWS_CATEGORIES` ile aynı küme). */
export const NEWS_ORDER = ['tr', 'world', 'economy', 'tech', 'ai', 'startup', 'other'] as const satisfies readonly NewsCategory[];

export interface SourceGroup {
  category: NewsCategory;
  sources: NewsSourceView[];
  enabled: number;
}

/** Kaynakları kategoriye göre gruplar; grup içinde etkinler önce, sonra ada göre (Türkçe sıralama). Boş grup yok. */
export function groupSources(sources: readonly NewsSourceView[]): SourceGroup[] {
  const groups: SourceGroup[] = [];
  for (const category of NEWS_ORDER) {
    const list = sources
      // Bilinmeyen kategorideki kaynak "Diğer"e düşer (sözleşme genişlerse kaynak kaybolmasın).
      .filter((source) => ((NEWS_ORDER as readonly string[]).includes(source.category) ? source.category : 'other') === category)
      .sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name, 'tr'));
    if (list.length > 0) groups.push({ category, sources: list, enabled: list.filter((source) => source.enabled).length });
  }
  return groups;
}

/** Takip edilen ve sessize alınan konular ayrı; her biri eklenme sırasıyla. */
export function splitTopics(topics: readonly NewsTopic[]): { follow: NewsTopic[]; mute: NewsTopic[] } {
  const byTime = [...topics].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return { follow: byTime.filter((topic) => topic.mode === 'follow'), mute: byTime.filter((topic) => topic.mode === 'mute') };
}

/** Konu metni eklenebilir mi: boş değil, kısa ve listede (büyük-küçük harf ayırmadan) yok. */
export function canAddTopic(text: string, topics: readonly NewsTopic[]): boolean {
  const folded = text.trim().toLocaleLowerCase('tr-TR');
  if (folded.length < 2 || folded.length > 60) return false;
  return !topics.some((topic) => topic.text.trim().toLocaleLowerCase('tr-TR') === folded);
}

// ───────────── Bugün kartı: yüksekliğe göre ne sığar ─────────────

export interface CardMetrics {
  /** Bölüm başlığı, bölüm satırı ve haber satırının yüksekliği (px). */
  title: number;
  line: number;
  news: number;
}

/** Bugün kartındaki ölçüler: başlık (12 px yazı + üst boşluk + aralık), satır 22 px, haber satırı `.kokpit-row` (6 + 20 + 2 + 18 + 6). */
export const CARD_METRICS: CardMetrics = { title: 26, line: 22, news: 52 };

export interface CardPlan {
  /** Her bölümden kaç satır gösterilir (0: bölüm çizilmez). */
  lines: number[];
  /** Kaç haber gösterilir. */
  news: number;
}

/**
 * Kartın içerik alanına (`height` px) ne sığar. Geniş kartta (`split`) bölümler solda, haberler sağda ayrı sütundadır;
 * ikisi de bütün yüksekliği kullanır. Dar kartta önce en çok iki haberlik yer ayrılır, bölümler sırayla (başlık + en az
 * bir satır) doldurulur, artan yer yeniden haberlere gider. Sığmayan bölüm atlanır; yarım satır çizilmez.
 */
export function planBriefingCard(
  input: { height: number; sectionLines: readonly number[]; news: number; split: boolean },
  metrics: CardMetrics = CARD_METRICS,
): CardPlan {
  const lines = input.sectionLines.map(() => 0);
  const height = Math.max(0, input.height);
  const fill = (budget: number): number => {
    let left = budget;
    input.sectionLines.forEach((count, index) => {
      if (count <= 0 || left < metrics.title + metrics.line) return;
      left -= metrics.title;
      const take = Math.min(count, Math.floor(left / metrics.line));
      lines[index] = take;
      left -= take * metrics.line;
    });
    return left;
  };
  const newsFit = (budget: number) => Math.max(0, Math.min(input.news, Math.floor(budget / metrics.news)));
  if (input.split) {
    fill(height);
    return { lines, news: newsFit(height) };
  }
  const reserve = Math.min(height, Math.min(input.news, 2) * metrics.news);
  const left = fill(height - reserve) + reserve;
  return { lines, news: newsFit(left) };
}
