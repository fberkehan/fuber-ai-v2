// ── HTML → okunur metin (0.14 T14 düzeltme turu 1 ve 2; saf → birim testli: tests/web-araclari.test.ts) ──
// `sayfa_oku` HTML'i artık Chromium'da yüklemez (JavaScript, iletişim kutusu, ayrı DNS çözümlemesi yok): sayfa Node'da çekilir ve metni burada çıkarılır.
// Tek geçişli (doğrusal) ayıklayıcı: betik/stil/noscript/şablon/svg/iframe blokları atlanır, blok etiketleri satır ve paragraf sınırı olur, varlıklar çözülür.
// DOĞRUSALLIK (düzeltme turu 2): bu işlev ana süreçte EŞZAMANLI çalışır; 20 sn sinyali ve Alt+Shift+Q onu kesemez. Bu yüzden her adım girdiyi en çok bir kez gezer:
//  • etiket sonu ve tırnaklı öznitelik değerleri `indexOf` ve karakter taramasıyla (düzenli ifade yok) bulunur; tarama hep ileri gider, etiket bitince `konum` oraya atlar;
//  • düzenli ifadeler yalnız KISA, sınırlı dizgelerde (başlık/noscript dilimi ≤ 2.000 karakter) ya da `[^<>]` ile (etiket içinde '<' olamaz → her karakteri en çok bir
//    başlangıç noktası tarar) kullanılır;
//  • etiket olmayan "<" metne katılır: bekleyen metin `bas`'tan kesilir, karakter karakter parça üretilmez.
// JavaScript ile çizilen sayfalar (boş kök öğe, JavaScript uyarılı `<noscript>`, ya da hiç metin + betik) tanınır: `jsGerekli` true → araç "Fuber Tarayıcı ile açabilirim" der.
import { varliklariCoz } from './arama-ayikla.ts';

/** JavaScript isteyen sayfada araç sonucu (kullanıcıya/modele olduğu gibi söylenir). Fuber Tarayıcı kullanıcıya görünür; onay kuralları ayrı (T15). */
export const JS_GEREKLI_METNI = 'Bu sayfa içerik için JavaScript istiyor; Fuber Tarayıcı ile açabilirim.';
/** Bu uzunluğun altındaki metin + JavaScript işaretleri = içerik betikle gelir. */
export const JS_METIN_ESIGI = 200;
/** Başlık ve `<noscript>` içeriğinden en çok bu kadar karakter incelenir (düşmanca büyük girdi bu işlere sokulmaz). */
const KISA_DILIM = 2000;

export interface HtmlMetni { baslik: string; metin: string; jsGerekli: boolean }

/** İçeriği hiç okunmayan (metni sayfaya girmeyen) öğeler. */
const ATLANAN = new Set(['script', 'style', 'noscript', 'template', 'svg', 'iframe', 'object', 'embed', 'canvas', 'select', 'datalist', 'math']);
/** İki satır sonu (paragraf) koyan öğeler; öteki blok öğeleri tek satır sonu koyar. */
const PARAGRAF = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'table', 'blockquote', 'section', 'article', 'pre', 'figure', 'fieldset', 'dl', 'details']);
const SATIR = new Set(['br', 'div', 'li', 'tr', 'hr', 'header', 'footer', 'main', 'nav', 'aside', 'form', 'dt', 'dd', 'caption', 'figcaption', 'address', 'summary', 'td', 'th']);

const SATIR_ISARETI = '\u0001';
const PARAGRAF_ISARETI = '\u0002';
const JS_UYARISI = /javascript|enable|etkinle[sş]tir|gerekli|required|tarayıcı|browser/i;
// Boş SPA kökü: kök kimlikli HERHANGİ bir öğe ya da <app-root> (Angular), içi boş. Etiket tek tek, ana döngüde ve YALNIZ kısa öznitelik diliminde sınanır
// (tüm belgede geriye izlemeli düzenli ifade, '<a-a-a-…' gibi girdide ikinci dereceden olurdu).
const KOK_KIMLIGI = /\bid\s*=\s*["']?(?:root|app|__next|__nuxt|svelte|react-root)(?![\w-])/i;
const BETIK_VAR = /<script\b/i;

/** Etiketsiz düz metin (başlık/noscript için). Girdi çağıranda KISA_DILIM ile sınırlanır; `[^<>]` doğrusal kalmayı garanti eder. */
function etiketsiz(s: string): string {
  return varliklariCoz(s.slice(0, KISA_DILIM).replace(/<[^<>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

const harfMi = (k: number): boolean => (k >= 65 && k <= 90) || (k >= 97 && k <= 122);
const adKarakteriMi = (k: number): boolean => harfMi(k) || (k >= 48 && k <= 57) || k === 45 || k === 58;

/** `bas`'tan başlayan açılış etiketinin sonundaki ">" konumu; tırnaklı öznitelik değerindeki ">" etiketi bitirmez. Tarayıcı gibi: tırnak YALNIZ "="'den hemen sonra (boşluk atlanarak)
 *  değerin İLK karakteri olduğunda açılır; tırnaksız değerde (`href=/ara?q='abc`) tırnak düz karakterdir ve boşluğa ya da ">"e kadar sürer. Kapanmayan tırnak belgenin kalanını
 *  yutar (tarayıcılar gibi) → -1. Tek ileri tarama (durum makinesi; geri dönüş yok). */
function etiketSonu(html: string, bas: number): number {
  const n = html.length;
  let durum = 0; // 0: ad/boşluk, 1: "="den sonra değer başı bekleniyor, 2: tırnaksız değerin içi
  for (let j = bas; j < n; j++) {
    const k = html.charCodeAt(j);
    if (k === 62) return j;
    if (durum === 1) {
      if (k <= 32) continue; // "=" ile değer arasındaki boşluk
      if (k === 34 || k === 39) {
        const q = html.indexOf(html[j], j + 1);
        if (q < 0) return -1;
        j = q;
        durum = 0;
      } else durum = 2;
      continue;
    }
    if (durum === 2) { if (k <= 32) durum = 0; continue; }
    if (k === 61) durum = 1;
  }
  return -1;
}

/** `ad` öğesinin kapanış etiketini (`</ad`) `konum`'dan ileri arar; bulunan "</ad ... >" biçiminin başlangıcı, yoksa -1. Büyük/küçük harf duyarsız, indexOf ile (RegExp derleme yok). */
function kapanisBul(html: string, ad: string, konum: number): number {
  const n = html.length;
  let i = html.indexOf('</', konum);
  while (i >= 0) {
    if (i + 2 + ad.length <= n && html.substr(i + 2, ad.length).toLowerCase() === ad) {
      const s = i + 2 + ad.length < n ? html.charCodeAt(i + 2 + ad.length) : 62;
      if (!adKarakteriMi(s)) return i; // </scripts> gibi daha uzun ad değil
    }
    i = html.indexOf('</', i + 2);
  }
  return -1;
}

/** HTML'den başlık ve görünen metin; `jsGerekli`: metin eşiğin altında ve (JavaScript uyarılı `<noscript>`, boş SPA kökü, ya da hiç metin + betik) var. */
export function htmlSayfaMetni(html: string): HtmlMetni {
  const parcalar: string[] = [];
  const kir = (ad: string) => { if (PARAGRAF.has(ad)) parcalar.push(PARAGRAF_ISARETI); else if (SATIR.has(ad)) parcalar.push(SATIR_ISARETI); };
  /** Metin parçalarındaki ham işaret karakterleri atılır (sayfa işaret taklit edemesin). */
  const metinEkle = (s: string) => { if (s) parcalar.push(s.replace(/[\u0001\u0002]/g, '')); };
  let baslik = '';
  let noscript = '';
  let bosKok = false;
  let bas = 0; // bekleyen ham metnin başı (etiket olmayan "<" metne katılır; parçalanmaz)
  let konum = 0; // sonraki "<" aramasının başı
  const n = html.length;
  while (konum < n) {
    const i = html.indexOf('<', konum);
    if (i < 0) break;
    const k1 = i + 1 < n ? html.charCodeAt(i + 1) : 0;
    if (k1 === 33 /* ! */ || k1 === 63 /* ? */) { // yorum, <!doctype …>, <![CDATA[…, <?xml …?>
      metinEkle(html.slice(bas, i));
      const j = html.startsWith('<!--', i) ? html.indexOf('-->', i + 4) : html.indexOf('>', i + 2);
      konum = bas = j < 0 ? n : j + (html.startsWith('<!--', i) ? 3 : 1);
      continue;
    }
    const kapanis = k1 === 47; // "</"
    const adBas = kapanis ? i + 2 : i + 1;
    if (!harfMi(adBas < n ? html.charCodeAt(adBas) : 0)) { konum = i + 1; continue; } // "a < b" gibi etiket olmayan
    let adSon = adBas;
    while (adSon < n && adKarakteriMi(html.charCodeAt(adSon))) adSon++;
    const ad = html.slice(adBas, adSon).toLowerCase();
    const son = kapanis ? html.indexOf('>', adSon) : etiketSonu(html, adSon);
    metinEkle(html.slice(bas, i));
    if (son < 0) { bas = konum = n; break; }
    konum = bas = son + 1;
    if (kapanis) { kir(ad); continue; }
    if (ad === 'title' && !baslik) {
      const e = kapanisBul(html, 'title', konum);
      baslik = etiketsiz(html.slice(konum, e < 0 ? n : Math.min(e, konum + KISA_DILIM))).slice(0, 300);
      const g = e < 0 ? -1 : html.indexOf('>', e);
      konum = bas = g < 0 ? n : g + 1;
      continue;
    }
    if (ATLANAN.has(ad) && html.charCodeAt(son - 1) !== 47 /* "/>" */) {
      const e = kapanisBul(html, ad, konum);
      if (ad === 'noscript' && noscript.length < 4 * KISA_DILIM) noscript += ` ${etiketsiz(html.slice(konum, e < 0 ? n : Math.min(e, konum + KISA_DILIM)))}`;
      const g = e < 0 ? -1 : html.indexOf('>', e);
      konum = bas = g < 0 ? n : g + 1;
      continue;
    }
    if (!bosKok && (ad === 'app-root' || KOK_KIMLIGI.test(html.slice(adSon, Math.min(son, adSon + KISA_DILIM)))) && html.charCodeAt(son - 1) !== 47) {
      let q = son + 1;
      const lim = Math.min(n, q + 1000);
      while (q < lim && html.charCodeAt(q) <= 32) q++;
      if (html.substr(q, ad.length + 2).toLowerCase() === `</${ad}`) bosKok = true; // içi boş kök
    }
    kir(ad);
  }
  if (bas < n) metinEkle(html.slice(bas));
  // Parçaları satırlara topla: işaretler (SATIR_ISARETI / PARAGRAF_ISARETI) satır sonudur; ardışık işaretlerin en güçlüsü ayırıcı olur (boş satır = paragraf).
  const cikti: string[] = [];
  let satir = '';
  let seviye = 0;
  const bosalt = () => {
    const t = varliklariCoz(satir).replace(/\s+/g, ' ').trim();
    satir = '';
    if (!t) return;
    if (cikti.length) cikti.push(seviye >= 2 ? '\n\n' : '\n');
    cikti.push(t);
    seviye = 0;
  };
  for (const p of parcalar) {
    if (p === SATIR_ISARETI || p === PARAGRAF_ISARETI) { bosalt(); seviye = Math.max(seviye, p === PARAGRAF_ISARETI ? 2 : 1); } else satir += p;
  }
  bosalt();
  const metin = cikti.join('');
  const jsGerekli = metin.length < JS_METIN_ESIGI
    && ((noscript.trim().length > 0 && JS_UYARISI.test(noscript)) || bosKok || (metin.length === 0 && BETIK_VAR.test(html)));
  return { baslik, metin, jsGerekli };
}
