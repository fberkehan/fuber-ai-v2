// Ayar araması: yazdıkça süzer, eşleşeni vurgular. Dizin tutulmaz; ekrandaki `Group` ve `SettingRow` öğelerinin kendi
// metni okunur. Bu yüzden yeni eklenen bir bölüm hiçbir kayıt yapmadan aranabilir olur (bkz. kit.tsx).

const FOLD: Record<string, string> = { ı: 'i', ş: 's', ğ: 'g', ü: 'u', ö: 'o', ç: 'c', â: 'a', î: 'i', û: 'u', '’': "'" };

/**
 * Aramaya hazır metin: Türkçe kuralıyla küçük harf, aksansız ("Kısayol" → "kisayol"). Uzunluk KORUNUR: çıktının
 * n. karakteri girdinin n. karakterine denk gelir (vurgu aralıkları özgün metne bu sayede oturur).
 */
export function fold(text: string): string {
  let out = '';
  for (const unit of text.split('')) {
    const lower = unit.toLocaleLowerCase('tr-TR');
    const one = lower.length === 1 ? lower : unit;
    out += FOLD[one] ?? one;
  }
  return out;
}

/** Sorgu sözcükleri (katlanmış). Boş sorgu boş dizi verir. */
export function tokens(query: string): string[] {
  return fold(query).split(/\s+/).filter(Boolean);
}

/** Metin bütün sözcükleri içeriyor mu (sıra önemsiz). */
export function matches(text: string, words: string[]): boolean {
  if (words.length === 0) return true;
  const folded = fold(text);
  return words.every((word) => folded.includes(word));
}

/** Sözcüklerin metindeki yerleri: `[başlangıç, bitiş)` çiftleri, çakışmasız, soldan sağa. */
export function hitRanges(text: string, words: string[]): Array<[number, number]> {
  const folded = fold(text);
  const found: Array<[number, number]> = [];
  for (const word of words) {
    let at = folded.indexOf(word);
    while (at !== -1) {
      found.push([at, at + word.length]);
      at = folded.indexOf(word, at + word.length);
    }
  }
  found.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged: Array<[number, number]> = [];
  for (const range of found) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  return merged;
}

export interface SearchResult {
  /** Eşleşen ayar sayısı (satır; satırsız grupta grubun kendisi). */
  total: number;
  /** Bölüm kimliği → eşleşme sayısı. */
  bySection: Record<string, number>;
  /** Klavyeyle gezilecek öğeler, ekran sırasıyla. */
  hits: HTMLElement[];
}

const HIGHLIGHT = 'st-hit';
const text = (node: Element | null | undefined) => node?.textContent ?? '';
const keywords = (node: Element) => node.getAttribute('data-st-keywords') ?? '';

/** Vurgu ve gizleme izlerini siler (arama kapandı). */
export function clearSearch(root: HTMLElement): void {
  for (const node of root.querySelectorAll('[data-st-miss]')) node.removeAttribute('data-st-miss');
  for (const node of root.querySelectorAll('[data-st-active]')) node.removeAttribute('data-st-active');
  CSS.highlights?.delete(HIGHLIGHT);
}

/**
 * Sorguyu kökteki bölümlere uygular: eşleşmeyen satır, grup ve bölüm gizlenir (`data-st-miss`), eşleşen yazı
 * CSS vurgusuyla boyanır (DOM'a öğe eklenmez; React'in ağacına dokunulmaz).
 *
 * Kural: satırlardan eşleşen varsa yalnız onlar görünür; hiçbiri eşleşmiyor ama grubun başlığı eşleşiyorsa bütün
 * satırları görünür. Satırı olmayan grup (özel içerik) bütün metniyle aranır.
 */
export function applySearch(root: HTMLElement, query: string): SearchResult {
  const words = tokens(query);
  const result: SearchResult = { total: 0, bySection: {}, hits: [] };
  if (words.length === 0) {
    clearSearch(root);
    return result;
  }
  const ranges: Range[] = [];
  for (const section of root.querySelectorAll<HTMLElement>('[data-st-section]')) {
    const id = section.getAttribute('data-st-section') ?? '';
    let count = 0;
    for (const group of section.querySelectorAll<HTMLElement>('[data-st-group]')) {
      const rows = [...group.querySelectorAll<HTMLElement>('[data-st-row]')];
      const headMatch = matches(`${text(group.querySelector('[data-st-head]'))} ${keywords(group)}`, words);
      const rowMatch = rows.map((row) => matches(`${text(row)} ${keywords(row)}`, words));
      const anyRow = rowMatch.some(Boolean);
      const groupMatch = rows.length === 0 ? matches(`${text(group)} ${keywords(group)}`, words) : headMatch || anyRow;
      group.toggleAttribute('data-st-miss', !groupMatch);
      rows.forEach((row, index) => row.toggleAttribute('data-st-miss', groupMatch && anyRow && !rowMatch[index]));
      if (!groupMatch) continue;
      const shown = rows.filter((_, index) => !anyRow || rowMatch[index]);
      const hits = shown.length > 0 ? shown : [group];
      count += hits.length;
      result.hits.push(...hits);
      collectRanges(group, words, ranges);
    }
    section.toggleAttribute('data-st-miss', count === 0);
    result.bySection[id] = count;
    result.total += count;
  }
  if (typeof Highlight !== 'undefined' && CSS.highlights) {
    if (ranges.length > 0) CSS.highlights.set(HIGHLIGHT, new Highlight(...ranges));
    else CSS.highlights.delete(HIGHLIGHT);
  }
  return result;
}

function collectRanges(group: HTMLElement, words: string[], out: Range[]): void {
  const walker = document.createTreeWalker(group, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || parent.closest('[data-st-miss], .sr-only, [aria-hidden=true]')) continue;
    for (const [start, end] of hitRanges(node.nodeValue ?? '', words)) {
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, end);
      out.push(range);
    }
  }
}
