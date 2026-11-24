// HTML'den okunabilir ana metin (bağımlılıksız). Betik çalıştırılmaz, DOM kurulmaz: etiketler sırayla taranır,
// gezinme/çerez/reklam/paylaş blokları atlanır, metin bloklara bölünür. Soru verilirse bloklar basit bir puanla
// (sorudaki sözcük köklerinin geçişi, nadir sözcük daha değerli) sıralanıp seçilir; model çağrılmaz.
import { terms, fold } from './text';

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ',
  ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»',
  bull: '•', middot: '·', copy: '©', reg: '®', trade: '™', deg: '°', euro: '€', pound: '£', yen: '¥', cent: '¢',
  times: '×', divide: '÷', plusmn: '±', sect: '§', para: '¶', shy: '',
  ccedil: 'ç', Ccedil: 'Ç', ouml: 'ö', Ouml: 'Ö', uuml: 'ü', Uuml: 'Ü', auml: 'ä', Auml: 'Ä', szlig: 'ß',
  eacute: 'é', Eacute: 'É', egrave: 'è', ecirc: 'ê', aacute: 'á', agrave: 'à', acirc: 'â', icirc: 'î', iacute: 'í',
  oacute: 'ó', ocirc: 'ô', uacute: 'ú', ucirc: 'û', ntilde: 'ñ', scedil: 'ş', Scedil: 'Ş', gbreve: 'ğ', Gbreve: 'Ğ',
  inodot: 'ı', Idot: 'İ',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);?/gi, (match, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return NAMED_ENTITIES[body] ?? NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/** Etiketleri atıp varlıkları çözer (arama sonucu parçaları için). */
export function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?’'])/g, '$1')
    .trim();
}

/** İçeriği hiç okunmayan etiketler (ham metinli ya da görsel/etkileşimli). */
const RAW_SKIP = new Set(['script', 'style', 'noscript', 'template', 'svg', 'math', 'iframe', 'textarea', 'object', 'canvas', 'video', 'audio']);
/** Ana metin olmayan yapısal bölgeler. */
const SKIP_TAGS = new Set(['nav', 'header', 'footer', 'aside', 'form', 'button', 'select', 'dialog', 'menu', 'figure', 'picture', 'label']);
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const BLOCK = new Set([
  'p', 'div', 'section', 'article', 'main', 'li', 'ul', 'ol', 'dl', 'dt', 'dd', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'pre', 'table', 'tr', 'td', 'th', 'caption', 'br', 'hr', 'body', 'address', 'summary', 'details',
]);
const SKIP_ROLES = new Set(['navigation', 'banner', 'contentinfo', 'complementary', 'dialog', 'alertdialog', 'search', 'menu', 'menubar', 'toolbar']);
/** Sınıf/kimlik parçalarında bunlardan biri varsa blok gürültüdür… */
const NOISE_WORDS = new Set([
  'cookie', 'cookies', 'consent', 'gdpr', 'kvkk', 'banner', 'advert', 'advertisement', 'ads', 'ad', 'adslot', 'sponsor', 'sponsored', 'promo',
  'newsletter', 'subscribe', 'social', 'share', 'sharing', 'related', 'recommended', 'breadcrumb', 'breadcrumbs', 'sidebar', 'footer',
  'navbar', 'nav', 'menu', 'comments', 'comment', 'popup', 'modal', 'overlay', 'signup', 'login', 'paywall', 'toolbar', 'skip', 'masthead',
]);
/** …ama bunlardan biri de varsa asıl içerik olabilir, atlanmaz. */
const KEEP_WORDS = new Set(['content', 'article', 'main', 'post', 'entry', 'story', 'body', 'text', 'prose']);

function attr(attrs: string, name: string): string | null {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attrs);
  return match ? (match[1] ?? match[2] ?? match[3] ?? '') : null;
}

function isNoiseAttrs(attrs: string): boolean {
  if (/(?:^|\s)hidden(?:\s|=|$)/i.test(attrs) || /aria-hidden\s*=\s*["']?true/i.test(attrs)) return true;
  if (/display\s*:\s*none/i.test(attr(attrs, 'style') ?? '')) return true;
  const role = attr(attrs, 'role')?.toLowerCase();
  if (role && SKIP_ROLES.has(role)) return true;
  const names = `${attr(attrs, 'class') ?? ''} ${attr(attrs, 'id') ?? ''}`.toLowerCase();
  if (!names.trim()) return false;
  const parts = names.split(/[\s_-]+/).filter(Boolean);
  return parts.some((part) => NOISE_WORDS.has(part)) && !parts.some((part) => KEEP_WORDS.has(part));
}

export interface Block {
  text: string;
  heading: boolean;
  inArticle: boolean;
  inMain: boolean;
  /** Bloğun bağlantı içindeki karakter oranı (menü/liste gürültüsü). */
  linkRatio: number;
}

export interface Extracted {
  title: string;
  description: string;
  blocks: Block[];
}

interface Frame {
  tag: string;
  skip: boolean;
  main: boolean;
}

const isLetter = (code: number) => (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
const isNameChar = (code: number) => isLetter(code) || (code >= 48 && code <= 57) || code === 45 || code === 58;

/**
 * Açılış etiketinin sonundaki ">" konumu (v1 `html-metin.ts` › etiketSonu'ndan alındı). Tırnaklı öznitelik değerindeki
 * ">" etiketi bitirmez; tarayıcı gibi tırnak yalnız "="den hemen sonra (boşluk atlanarak) değerin ilk karakteriyse açılır.
 * Kapanmayan tırnak belgenin kalanını yutar (-1). Tek ileri tarama, geri dönüş yok.
 */
function tagEnd(html: string, from: number): number {
  const n = html.length;
  let state = 0; // 0: ad/boşluk · 1: "="den sonra değer bekleniyor · 2: tırnaksız değerin içi
  for (let j = from; j < n; j++) {
    const code = html.charCodeAt(j);
    if (code === 62) return j;
    if (state === 1) {
      if (code <= 32) continue;
      if (code === 34 || code === 39) {
        const quote = html.indexOf(html[j]!, j + 1);
        if (quote === -1) return -1;
        j = quote;
        state = 0;
      } else state = 2;
      continue;
    }
    if (state === 2) {
      if (code <= 32) state = 0;
      continue;
    }
    if (code === 61) state = 1;
  }
  return -1;
}

/** Sayfayı bloklara ayırır. `classNoise: false` sınıf/kimlik tabanlı ayıklamayı kapatır (ikinci deneme). */
export function extractBlocks(html: string, options: { classNoise?: boolean } = {}): Extracted {
  const classNoise = options.classNoise ?? true;
  // Başlık ve meta yalnız belgenin başında aranır (düzenli ifade kısa dilimde kalsın).
  const head = html.slice(0, 60_000);
  const titleRaw = (/<title[^<>]*>([^<]{0,2000})/i.exec(head)?.[1] ?? '').slice(0, 300);
  const meta = (key: string) => {
    const tag = new RegExp(`<meta[^<>]+(?:property|name)\\s*=\\s*["']${key}["'][^<>]*>`, 'i').exec(head)?.[0];
    return tag ? decodeEntities(attr(tag.slice(5), 'content') ?? '').trim() : '';
  };
  const title = (meta('og:title') || stripTags(titleRaw)).replace(/\s+/g, ' ').trim();
  const description = meta('description') || meta('og:description');

  const blocks: Block[] = [];
  const stack: Frame[] = [];
  let skipDepth = 0;
  let article = 0;
  let main = 0;
  let link = 0;
  let buffer = '';
  let linkChars = 0;
  let heading = false;

  const flush = () => {
    const text = decodeEntities(buffer).replace(/\s+/g, ' ').trim();
    if (text) {
      const plainLength = text.length;
      blocks.push({ text, heading, inArticle: article > 0, inMain: main > 0, linkRatio: Math.min(1, linkChars / Math.max(1, plainLength)) });
    }
    buffer = '';
    linkChars = 0;
    heading = false;
  };

  // DOĞRUSAL kalmalı (v1 `html-metin.ts` dersi): ayrıştırma ana süreçte eşzamanlı koşar, kötü niyetli bir sayfa onu
  // kilitleyemesin. Tarama hep ileri gider: etiket sonu tırnakları gözeten durum makinesiyle (`tagEnd`, v1'den) bulunur,
  // kapanmayan tırnak/yorum belgenin kalanını bir kez tüketir; aynı bölge ikinci kez taranmaz.
  const onText = (text: string) => {
    if (skipDepth > 0 || !text) return;
    buffer += text;
    if (link > 0) linkChars += decodeEntities(text).replace(/\s+/g, ' ').trim().length;
  };
  const n = html.length;
  let pos = 0;
  while (pos < n) {
    const lt = html.indexOf('<', pos);
    if (lt === -1) {
      onText(html.slice(pos));
      break;
    }
    onText(html.slice(pos, lt));
    const next = html.charCodeAt(lt + 1);
    if (next === 33 /* ! */ || next === 63 /* ? */) {
      const comment = html.startsWith('<!--', lt);
      const end = comment ? html.indexOf('-->', lt + 4) : html.indexOf('>', lt + 2);
      pos = end === -1 ? n : end + (comment ? 3 : 1);
      continue;
    }
    const closing = next === 47; /* / */
    const nameStart = closing ? lt + 2 : lt + 1;
    if (!isLetter(html.charCodeAt(nameStart))) {
      onText('<');
      pos = lt + 1;
      continue;
    }
    let nameEnd = nameStart;
    while (nameEnd < n && isNameChar(html.charCodeAt(nameEnd))) nameEnd++;
    const tag = html.slice(nameStart, nameEnd).toLowerCase();
    const end = closing ? html.indexOf('>', nameEnd) : tagEnd(html, nameEnd);
    if (end === -1) break;
    pos = end + 1;
    if (!closing) {
      // Öznitelik dizisi çok uzun olabilir (Vikipedi `data-mw`); gürültü denetimine başı yeter.
      const attrs = html.slice(nameEnd, Math.min(end, nameEnd + 4000));
      if (RAW_SKIP.has(tag)) {
        if (html.charCodeAt(end - 1) === 47) continue; // <svg/>
        // Ham metinli öğenin içi taranmaz: kapanışına atlanır. Büyük/küçük harf duyarsız arama düzenli ifadeyle:
        // `toLowerCase()` "İ" harfini iki karaktere çevirip konumları kaydırır.
        const closer = new RegExp(`</${tag}(?![a-z0-9:-])`, 'ig');
        closer.lastIndex = pos;
        const found = closer.exec(html);
        const close = found ? html.indexOf('>', found.index) : -1;
        pos = close === -1 ? n : close + 1;
        continue;
      }
      if (BLOCK.has(tag) && skipDepth === 0) flush();
      if (VOID.has(tag) || html.charCodeAt(end - 1) === 47) continue;
      // Kapatılmayan öğeler yığını şişirmesin: çok derinde yeni öğe yığına girmez (metni yine okunur).
      if (stack.length >= 2000) continue;
      const skip = skipDepth > 0 || SKIP_TAGS.has(tag) || (classNoise && tag !== 'main' && tag !== 'article' && tag !== 'body' && tag !== 'html' && isNoiseAttrs(attrs));
      if (skip && skipDepth === 0) flush();
      if (skip) skipDepth++;
      const isMain = tag === 'main' || /role\s*=\s*["']?main/i.test(attrs);
      stack.push({ tag, skip, main: isMain });
      if (tag === 'article') article++;
      if (isMain) main++;
      if (tag === 'a') link++;
      if (/^h[1-6]$/.test(tag) && skipDepth === 0) heading = true;
      continue;
    }
    // Kapanış: eşleşen açılışa kadar yığından çıkar (kapatılmamış iç öğeler de kapanır).
    // Yalnız yığının üst 64 öğesine bakılır (derin iç içe + çok kapanış ikinci dereceden olmasın).
    let index = -1;
    for (let i = stack.length - 1; i >= Math.max(0, stack.length - 64); i--) {
      if (stack[i]!.tag === tag) {
        index = i;
        break;
      }
    }
    if (index === -1) continue;
    if (BLOCK.has(tag) && skipDepth === 0) flush();
    while (stack.length > index) {
      const frame = stack.pop()!;
      if (frame.skip) skipDepth--;
      if (frame.tag === 'article') article--;
      if (frame.main) main--;
      if (frame.tag === 'a') link--;
    }
    if (BLOCK.has(tag) && skipDepth === 0) flush();
  }
  flush();
  return { title, description, blocks };
}

const MIN_MAIN_CHARS = 300;

/** Gürültü bloklarını atar, sayfanın ana kısmını (article > main > gövde) seçer. */
export function mainBlocks(extracted: Extracted): Block[] {
  const useful = extracted.blocks.filter((block) => !(block.linkRatio > 0.6 && block.text.length < 300) && block.text.length >= 2);
  const size = (list: Block[]) => list.reduce((sum, block) => sum + block.text.length, 0);
  const inArticle = useful.filter((block) => block.inArticle);
  if (size(inArticle) >= MIN_MAIN_CHARS) return inArticle;
  const inMain = useful.filter((block) => block.inMain);
  if (size(inMain) >= MIN_MAIN_CHARS) return inMain;
  // Kısa satırları (tek sözcüklük düğme/etiket kalıntısı) gövdede at.
  return useful.filter((block) => block.heading || block.text.length >= 25 || /[.!?:]$/.test(block.text));
}

export interface Readable {
  title: string;
  description: string;
  /** Okunabilir ana metnin tamamı (paragraflar boş satırla değil satır sonuyla ayrılır). */
  text: string;
  blocks: Block[];
}

export function readableFromHtml(html: string): Readable {
  let extracted = extractBlocks(html);
  let blocks = mainBlocks(extracted);
  // Sınıf adına bakan ayıklama asıl içeriği de yemiş olabilir ("has-sidebar"): yalnız etiketlere bakarak yeniden dene.
  if (blocks.reduce((sum, block) => sum + block.text.length, 0) < 200) {
    const relaxed = extractBlocks(html, { classNoise: false });
    const relaxedBlocks = mainBlocks(relaxed);
    if (relaxedBlocks.reduce((sum, block) => sum + block.text.length, 0) > blocks.reduce((sum, block) => sum + block.text.length, 0)) {
      extracted = relaxed;
      blocks = relaxedBlocks;
    }
  }
  return { title: extracted.title, description: extracted.description, text: blocks.map((block) => block.text).join('\n'), blocks };
}

export function readableFromPlain(text: string): Readable {
  const blocks = text
    .split(/\n\s*\n|\r\n\s*\r\n/)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((part) => ({ text: part, heading: false, inArticle: false, inMain: false, linkRatio: 0 }));
  return { title: '', description: '', text: blocks.map((block) => block.text).join('\n'), blocks };
}

/** Uzun bloğu cümle sınırlarında ~`size` karakterlik parçalara böler (puanlama birimi). */
function chunks(blocks: Block[], size = 420): Array<{ text: string; heading: boolean; order: number }> {
  const out: Array<{ text: string; heading: boolean; order: number }> = [];
  for (const block of blocks) {
    if (block.text.length <= size) {
      out.push({ text: block.text, heading: block.heading, order: out.length });
      continue;
    }
    const sentences = block.text.split(/(?<=[.!?…])\s+/);
    let current = '';
    for (const sentence of sentences) {
      if (current && current.length + sentence.length + 1 > size) {
        out.push({ text: current, heading: false, order: out.length });
        current = '';
      }
      current = current ? `${current} ${sentence}` : sentence;
    }
    if (current) out.push({ text: current, heading: false, order: out.length });
  }
  return out;
}

/**
 * Metni satır (yoksa cümle, o da yoksa sert) sınırında en çok `size` karakterlik parçalara böler. `web_read` uzun
 * sayfayı parça parça verir (v1 `sayfa_oku` › `parca`).
 */
export function paginate(text: string, size: number): string[] {
  const pages: string[] = [];
  let rest = text.trim();
  while (rest.length > size) {
    const window = rest.slice(0, size);
    let cut = window.lastIndexOf('\n');
    if (cut < size * 0.5) cut = Math.max(window.lastIndexOf('. '), window.lastIndexOf('? '), window.lastIndexOf('! '));
    if (cut < size * 0.5) cut = window.lastIndexOf(' ');
    if (cut < size * 0.5) cut = size - 1;
    pages.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) pages.push(rest);
  return pages;
}

export interface Selection {
  text: string;
  /** Seçilmeyen ya da sığmayan metin kaldı mı. */
  truncated: boolean;
  /** Soru verildi ama hiçbir bölüm eşleşmedi (metnin başı döndü). */
  noMatch: boolean;
  totalChars: number;
}

/**
 * Bütçeye sığacak metni seçer. Soru yoksa baştan keser. Soru varsa her parça, sorudaki köklerin geçişiyle puanlanır
 * (her kök bir kez sayılır, nadir kök daha değerli; başlığa yakın parçaya küçük artı); en iyi parçalar belge
 * sırasıyla döner.
 */
export function selectText(blocks: Block[], question: string | undefined, budget: number): Selection {
  const all = blocks.map((block) => block.text).join('\n');
  const totalChars = all.length;
  const wanted = question ? terms(question) : [];
  if (wanted.length === 0) {
    if (totalChars <= budget) return { text: all, truncated: false, noMatch: false, totalChars };
    const cut = all.slice(0, budget);
    const end = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf('. '));
    return { text: (end > budget * 0.6 ? cut.slice(0, end + 1) : cut).trim(), truncated: true, noMatch: false, totalChars };
  }
  const parts = chunks(blocks);
  const stems = parts.map((part) =>
    new Set(
      fold(part.text)
        .split(/[^\p{L}\p{N}]+/u)
        .filter((word) => word.length >= 2)
        .map((word) => word.slice(0, 5)),
    ),
  );
  const df = new Map(wanted.map((term) => [term, stems.filter((set) => set.has(term)).length]));
  const scored = parts.map((part, index) => {
    let score = 0;
    for (const term of wanted) if (stems[index]!.has(term)) score += Math.log(1 + parts.length / (df.get(term)! || 1));
    if (score > 0 && index > 0 && parts[index - 1]!.heading) score += 0.2;
    return { ...part, score };
  });
  const ranked = scored.filter((part) => part.score > 0).sort((a, b) => b.score - a.score || a.order - b.order);
  if (ranked.length === 0) {
    const head = selectText(blocks, undefined, budget);
    return { ...head, noMatch: true };
  }
  const chosen: typeof ranked = [];
  let used = 0;
  for (const part of ranked) {
    if (used + part.text.length + 1 > budget) {
      if (chosen.length === 0) chosen.push({ ...part, text: part.text.slice(0, budget) });
      continue;
    }
    chosen.push(part);
    used += part.text.length + 1;
  }
  chosen.sort((a, b) => a.order - b.order);
  const text = chosen.map((part) => part.text).join('\n');
  return { text, truncated: text.length < totalChars, noMatch: false, totalChars };
}
