// ── web_ara yanıt sözleşmesi (0.14 T0, Ruling R5; saf → birim testli: tests/sohbet-protokolu.test.ts, tests/web-araclari.test.ts) ──
// `web_ara` Fuber'in aracıdır; sohbet modelinden ve sağlayıcısından bağımsızdır. Önce sunucu (Yönetim'de arama sağlayıcısı tanımlıysa;
// kredi arama başına), olmazsa ya da 503 dönerse kullanıcının kendi bilgisayarı (kendi IP'si; kredi düşmez). Kaynak yalnız bu ikisi.
// Gizli ve "Yalnız bu bilgisayar"da araç hiç sunulmaz (bulut-kapisi.ts).
// 0.14 T14 (T0 incelemesinden kalan): doğrulayıcı tek bozuk sonuçta bütün yanıtı düşürmez (bozuk sonuç ayıklanır, gerisi kalır); en çok 10 sonuç;
// başlık 300, özet 1.000, adres 2.048 karakter; kimlik bilgili adres (`user:pass@`) reddedilir. Aynı temizleyici bilgisayardan yapılan aramanın
// ayıklayıcılarında da (arama-ayikla.ts) kullanılır: iki kaynak aynı kuraldan geçer.

/** Tek arama sonucu. */
export interface WebAramaSonucu { baslik: string; url: string; ozet: string }

/** Barındırılan arama servisinin yanıt biçimi (bu sürümde yok); bilgisayardan yapılan aramada masaüstü aynı biçimi kendisi üretir (kredi 0). */
export interface WebAramaYaniti { sonuclar: WebAramaSonucu[]; kaynak: 'sunucu' | 'bilgisayar'; kredi: number }

/** Sonuç sayısı ve alan uzunlukları (karakter). Adres kesilmez (kesik adres bozuk adrestir): uzunsa sonuç ayıklanır. */
export const WEB_SINIR = { sonuc: 10, baslik: 300, ozet: 1000, adres: 2048 } as const;

/** Sunucu kredi yetersizse (402) `hesap.webAra` bunu fırlatır: bu arama bilgisayardan yapılmaz (kullanıcıya tek cümle söylenir). */
export const WEB_KREDI_YOK_METNI = 'Kredin bu arama için yetmiyor.';
export class WebAramaKredisiYok extends Error {
  readonly webAramaKredisiYok = true as const;
  constructor() { super(WEB_KREDI_YOK_METNI); this.name = 'WebAramaKredisiYok'; }
}
export const webAramaKredisiYokMu = (e: unknown): e is WebAramaKredisiYok => typeof e === 'object' && e !== null && (e as { webAramaKredisiYok?: unknown }).webAramaKredisiYok === true;

/** Hiçbir arama kaynağı yanıt vermediğinde (sunucu yok/503 ve bilgisayardan DuckDuckGo + Bing başarısız) araç sonucunun tek cümlesi. */
export const WEB_ARAMA_YAPILAMIYOR_METNI = "Şu an web'de arama yapılamıyor.";

const metin = (x: unknown): x is string => typeof x === 'string';

/** `n` karakteri (kod noktası değil UTF-16 birimi; vekil çifti bölmez) aşan metni … ile kısaltır; sonuç en çok `n` karakter. */
export function webMetniKes(s: string, n: number): string {
  if (s.length <= n) return s;
  let son = n - 1;
  const kod = s.charCodeAt(son - 1);
  if (kod >= 0xd800 && kod <= 0xdbff) son -= 1; // yüksek vekil çiftin yarısı kalmasın
  return `${s.slice(0, son).trimEnd()}…`;
}

/** Tek sonucu doğrular ve temiz kopya döner; bozuksa null: alanlar metin değil, adres http(s) değil / bozuk / 2.048 karakterden uzun ya da
 *  kimlik bilgili (`user:pass@`). Başlık ve özet boşluğu sadeleştirilir, sınırı aşarsa kısaltılır; başlık boşsa adresin sunucu adı kullanılır. */
export function webAramaSonucuTemizle(x: unknown): WebAramaSonucu | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const r = x as Record<string, unknown>;
  if (!metin(r.baslik) || !metin(r.url) || !metin(r.ozet)) return null;
  const adres = r.url.trim();
  if (!adres || adres.length > WEB_SINIR.adres) return null;
  let u: URL;
  try { u = new URL(adres); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.username || u.password) return null; // kimlik bilgisi bağlantıda gösterilmez, modele gitmez
  const sade = (s: string) => s.replace(/\s+/g, ' ').trim();
  return {
    baslik: webMetniKes(sade(r.baslik) || u.hostname, WEB_SINIR.baslik),
    url: adres,
    ozet: webMetniKes(sade(r.ozet), WEB_SINIR.ozet),
  };
}

/** Yanıtı doğrular ve temiz bir kopya döner; biçim bozuksa null. Bozuk sonuçlar ayıklanır (yanıt düşmez); en çok 10 sonuç kalır.
 *  Sonuç adresi yalnız http(s) olabilir (bağlantı olarak gösterilir). */
export function webAramaYanitiDogrula(x: unknown): WebAramaYaniti | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  if (o.kaynak !== 'sunucu' && o.kaynak !== 'bilgisayar') return null;
  if (typeof o.kredi !== 'number' || !Number.isFinite(o.kredi) || o.kredi < 0) return null;
  if (!Array.isArray(o.sonuclar)) return null;
  const sonuclar: WebAramaSonucu[] = [];
  for (const s of o.sonuclar) {
    const t = webAramaSonucuTemizle(s);
    if (t) sonuclar.push(t);
    if (sonuclar.length >= WEB_SINIR.sonuc) break;
  }
  return { sonuclar, kaynak: o.kaynak, kredi: o.kredi };
}
