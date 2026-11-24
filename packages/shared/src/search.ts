/**
 * Tam metin arama yardımcıları (SQLite FTS5). Hafıza, döküm ve Claude Code oturum dizini aynı kalıbı kullanır:
 *
 * ```sql
 * create virtual table memory_fts using fts5(norm, tokenize = "unicode61 remove_diacritics 0");
 * -- norm = foldForSearch(asıl metin); rowid asıl tablonun satırıyla aynı
 * select rowid from memory_fts where memory_fts match ? order by bm25(memory_fts);  -- ? = ftsQuery(kullanıcı metni)
 * ```
 *
 * Neden kendi katlamamız: FTS5'in `unicode61` belirteçleyicisi Türkçe büyük/küçük harfi bilmez
 * ("İSTANBUL" ≠ "istanbul", "IŞIK" ≠ "ışık"; Electron 45 içinde ölçüldü). Metni dizine yazarken ve
 * sorgularken aynı işlevle katlayınca arama hem büyük/küçük harfe hem de Türkçe karakter yazılıp
 * yazılmamasına ("sisli" → "Şişli") duyarsız olur. Gösterilecek alıntı asıl metinden `makeSnippet` ile üretilir.
 */

/** FTS5 sanal tablolarında kullanılacak belirteçleyici. Katlamayı biz yaptığımız için aksan silme kapalıdır. */
export const FTS_TOKENIZER = 'unicode61 remove_diacritics 0';

const ASCII_FOLD: Record<string, string> = {
  ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u',
};

/**
 * Metni arama için katlar: Türkçe kurala göre küçük harf (I→ı, İ→i), ardından Türkçe harfler ASCII
 * karşılığına. Çıktının uzunluğu girdiyle aynıdır (karakter karakter), bu yüzden katlanmış metinde
 * bulunan konum asıl metinde de geçerlidir.
 */
export function foldForSearch(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const lower = ch.toLocaleLowerCase('tr');
    // Küçültünce uzunluğu değişen ender karakterler olduğu gibi bırakılır ki konumlar kaymasın.
    const single = lower.length === 1 ? lower : ch;
    out += ASCII_FOLD[single] ?? single;
  }
  return out;
}

const WORD = /[\p{L}\p{N}]+/gu;

/** Metindeki aranabilir sözcükler (katlanmış). */
export function searchTerms(text: string): string[] {
  return foldForSearch(text).match(WORD) ?? [];
}

/**
 * Kullanıcının yazdığı metni güvenli bir FTS5 `MATCH` ifadesine çevirir. Her sözcük tırnaklanır
 * (FTS5 sözdizimi enjekte edilemez), sözcükler VE ile bağlanır, son sözcük önek olarak aranır
 * ("beyan" → "beyannamesini"). Aranabilir sözcük yoksa `null` döner; çağıran sorguyu hiç çalıştırmaz.
 */
export function ftsQuery(text: string, options: { prefixLast?: boolean; any?: boolean } = {}): string | null {
  const terms = searchTerms(text);
  if (terms.length === 0) return null;
  const prefixLast = options.prefixLast ?? true;
  const parts = terms.map((term, index) => {
    const quoted = `"${term}"`;
    return prefixLast && index === terms.length - 1 ? `${quoted} *` : quoted;
  });
  return parts.join(options.any ? ' OR ' : ' ');
}

/**
 * Asıl metinden, sorgu sözcüklerinin ilk geçtiği yerin çevresini alır; eşleşmeler `[[` ve `]]` arasına
 * alınır. Eşleşme yoksa metnin başı döner. `radius`: eşleşmenin iki yanında bırakılan karakter sayısı.
 */
export function makeSnippet(original: string, query: string, radius = 60): string {
  const terms = [...new Set(searchTerms(query))].sort((a, b) => b.length - a.length);
  const folded = foldForSearch(original);

  const ranges: Array<[number, number]> = [];
  for (const match of folded.matchAll(WORD)) {
    const word = match[0];
    const start = match.index;
    const hit = terms.find((term) => word.startsWith(term));
    if (hit) ranges.push([start, start + hit.length]);
  }

  const first = ranges[0];
  const from = first ? Math.max(0, first[0] - radius) : 0;
  const to = first ? Math.min(original.length, first[1] + radius) : Math.min(original.length, radius * 2);

  let out = from > 0 ? '…' : '';
  let cursor = from;
  for (const [start, end] of ranges) {
    if (start < from || end > to) continue;
    out += `${original.slice(cursor, start)}[[${original.slice(start, end)}]]`;
    cursor = end;
  }
  out += original.slice(cursor, to);
  if (to < original.length) out += '…';
  return out.replace(/\s+/g, ' ').trim();
}
