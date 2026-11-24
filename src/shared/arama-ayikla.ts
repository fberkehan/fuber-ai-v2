// ── Arama sayfası ayıklayıcıları (0.14 T14, Ruling R5; saf → birim testli: tests/web-araclari.test.ts, örnek sayfalar tests/veri/ddg.html ve bing.html) ──
// Sunucuda arama sağlayıcısı yoksa masaüstü aramayı kullanıcının kendi bilgisayarından yapar (main/yerel-arama.ts): önce DuckDuckGo HTML,
// sonuçsuz ya da engelliyse Bing. Burada yalnız sayfa metninden sonuç çıkarılır; ağ yok, DOM yok (ana süreçte DOMParser yoktur — küçük, katı
// düzenli ifadelerle). Çıktı `webAramaSonucuTemizle`'den geçer: yalnız http(s), kimlik bilgisiz adres, sınırlı uzunluk; aynı adres bir kez.
//  • DuckDuckGo: `a.result__a` (başlık + adres; adres `//duckduckgo.com/l/?uddg=<adres>` yönlendirmesidir, çözülür) ve ardından `.result__snippet`.
//    Reklamlar (`duckduckgo.com/y.js`) sonuç sayılmaz.
//  • Bing: `li.b_algo h2 a` (başlık + adres; bazı adresler `bing.com/ck/a?…&u=a1<base64url>` yönlendirmesidir, çözülür) ve `.b_caption p`.
import { webAramaSonucuTemizle, WEB_SINIR, type WebAramaSonucu } from './web-arama.ts';

const VARLIKLAR: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', middot: '·', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', copy: '©' };

/** HTML varlıklarını çözer (adlı + onluk + onaltılık); tanınmayan olduğu gibi kalır. */
export function varliklariCoz(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (tam, v: string) => {
    if (v[0] === '#') {
      const kod = v[1] === 'x' || v[1] === 'X' ? parseInt(v.slice(2), 16) : parseInt(v.slice(1), 10);
      if (!Number.isFinite(kod) || kod <= 0 || kod > 0x10ffff) return tam;
      try { return String.fromCodePoint(kod); } catch { return tam; }
    }
    return VARLIKLAR[v.toLowerCase()] ?? tam;
  });
}

/** İç HTML → düz metin: betik/stil atılır, <br> ve blok sonları boşluk olur, etiketler silinir, varlıklar çözülür, boşluk sadeleşir. */
export function htmlMetni(html: string): string {
  const t = html
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6])\s*>/gi, ' ')
    .replace(/<[^>]*>/g, '');
  return varliklariCoz(t).replace(/\s+/g, ' ').trim();
}

/** Etiket özniteliklerini okur (çift ya da tek tırnaklı). Adlar küçük harf. */
function ozellikler(ham: string): Record<string, string> {
  const o: Record<string, string> = {};
  for (const m of ham.matchAll(/([a-zA-Z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) o[m[1].toLowerCase()] = varliklariCoz(m[2] ?? m[3] ?? '');
  return o;
}
const siniflar = (o: Record<string, string>): string[] => (o.class ?? '').split(/\s+/).filter(Boolean);

/** DuckDuckGo bağlantısı → gerçek adres: `uddg` parametresi; yönlendirmesiz mutlak http(s) adres olduğu gibi; duckduckgo.com'un kendi adresleri (reklam, iç bağlantı) null. */
export function ddgAdresiCoz(href: string): string | null {
  let u: URL;
  try { u = new URL(href.startsWith('//') ? `https:${href}` : href, 'https://duckduckgo.com'); } catch { return null; }
  const uddg = u.searchParams.get('uddg');
  if (uddg) return /^https?:\/\//i.test(uddg) ? uddg : null;
  if (u.hostname === 'duckduckgo.com' || u.hostname.endsWith('.duckduckgo.com')) return null;
  return /^https?:$/.test(u.protocol) ? u.href : null;
}

/** Bing bağlantısı → gerçek adres: `bing.com/ck/a` yönlendirmesinde `u=a1<base64url>`; öteki mutlak http(s) adres olduğu gibi. */
export function bingAdresiCoz(href: string): string | null {
  let u: URL;
  try { u = new URL(href, 'https://www.bing.com'); } catch { return null; }
  if ((u.hostname === 'www.bing.com' || u.hostname === 'bing.com') && u.pathname.startsWith('/ck/')) {
    const k = u.searchParams.get('u');
    if (!k || !k.startsWith('a1')) return null;
    try {
      const adres = Buffer.from(k.slice(2), 'base64url').toString('utf8');
      return /^https?:\/\//i.test(adres) ? adres : null;
    } catch { return null; }
  }
  return /^https?:$/.test(u.protocol) ? u.href : null;
}

/** Ham adayları temizler, aynı adresi bir kez alır ve `enCok` (en çok 10) ile keser. */
function topla(adaylar: WebAramaSonucu[], enCok: number): WebAramaSonucu[] {
  const sinir = Math.max(1, Math.min(WEB_SINIR.sonuc, Math.floor(enCok) || 1));
  const goruldu = new Set<string>();
  const out: WebAramaSonucu[] = [];
  for (const a of adaylar) {
    const t = webAramaSonucuTemizle(a);
    if (!t || goruldu.has(t.url)) continue;
    goruldu.add(t.url);
    out.push(t);
    if (out.length >= sinir) break;
  }
  return out;
}

/** DuckDuckGo HTML sayfasından sonuçlar (`a.result__a` + `.result__snippet`). Özeti olmayan sonuç boş özetle gelir. */
export function ddgAyikla(html: string, enCok: number): WebAramaSonucu[] {
  const adaylar: WebAramaSonucu[] = [];
  let simdiki: WebAramaSonucu | null = null; // özeti beklenen son sonuç (reklam/geçersizse null: ardındaki özet sahipsiz kalır)
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const o = ozellikler(m[1]);
    const s = siniflar(o);
    if (s.includes('result__a')) {
      const url = o.href ? ddgAdresiCoz(o.href) : null;
      simdiki = null;
      if (!url) continue;
      simdiki = { baslik: htmlMetni(m[2]), url, ozet: '' };
      adaylar.push(simdiki);
    } else if (s.includes('result__snippet') && simdiki && !simdiki.ozet) {
      simdiki.ozet = htmlMetni(m[2]);
    }
  }
  return topla(adaylar, enCok);
}

/** Bing sayfasından sonuçlar (`li.b_algo h2 a` + `.b_caption p`; reklam `li.b_ad` sayılmaz). */
export function bingAyikla(html: string, enCok: number): WebAramaSonucu[] {
  const adaylar: WebAramaSonucu[] = [];
  const bloklar = html.split(/<li\b(?=[^>]*\bclass\s*=\s*"[^"]*\bb_algo\b)/i).slice(1);
  for (const blok of bloklar) {
    const govde = blok.split(/<\/li\s*>/i)[0];
    const h2 = /<h2\b[^>]*>([\s\S]*?)<\/h2\s*>/i.exec(govde);
    const a = h2 ? /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/i.exec(h2[1]) : null;
    if (!a) continue;
    const href = ozellikler(a[1]).href;
    const url = href ? bingAdresiCoz(href) : null;
    if (!url) continue;
    const baslik = htmlMetni(a[2]);
    const aciklama = /<div\b[^>]*\bclass\s*=\s*"[^"]*\bb_caption\b[^"]*"[^>]*>[\s\S]*?<p\b[^>]*>([\s\S]*?)<\/p\s*>/i.exec(govde) ?? /<p\b[^>]*>([\s\S]*?)<\/p\s*>/i.exec(govde);
    adaylar.push({ baslik, url, ozet: aciklama ? htmlMetni(aciklama[1]) : '' });
  }
  return topla(adaylar, enCok);
}
