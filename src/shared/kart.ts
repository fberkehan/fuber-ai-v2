// ── Yapay zekânın sohbet kartları (0.11 G6) ───────────────────────────────────────────────────────────────────────────────
// Araç kartları tutarsızdı; yapay zekânın kullanacağı kaliteli bir arayüz kütüphanesi gerekiyordu. Yapay zekâ `kart_goster` aracıyla
// yanıtına yapılandırılmış kart koyar (özet, liste, tablo, adımlar, karşılaştırma, bağlantılar); sohbette arayüz kütüphanesiyle
// (renderer/bilesenler/YapayZekaKarti.tsx), adada kısaltılmış, telefona ve hafıza/özet yollarına düz metin olarak gider.
// Doğrulama KATI ve tek yerde: bilinmeyen alan yok, sayı ve uzunluk sınırları, bağlantı yalnız http(s), HTML yok — metin düz metin kalır
// (arayüz React metniyle çizer; kalın/italik/Markdown/HTML yorumlanmaz). Hem araç hem sohbet görünümü hem sohbet kaydı aynı işlevi kullanır:
// geçerli girdi ⇒ araç başarılı ⇒ görünümde kart; geçersiz ⇒ araç hata ⇒ görünümde "hata" araç satırı.

export type KartVerisi =
  | { tur: 'ozet'; baslik: string; maddeler: string[] }
  | { tur: 'liste'; baslik?: string; ogeler: { baslik: string; alt?: string; sag?: string }[] }
  | { tur: 'tablo'; baslik?: string; sutunlar: string[]; satirlar: string[][] }
  | { tur: 'adimlar'; baslik?: string; adimlar: string[] }
  | { tur: 'karsilastirma'; baslik?: string; secenekler: string[]; ozellikler: { ad: string; degerler: string[] }[] }
  | { tur: 'baglantilar'; baslik?: string; baglantilar: { baslik: string; adres: string }[] };

export type KartTuru = KartVerisi['tur'];
export const KART_TURLERI: readonly KartTuru[] = ['ozet', 'liste', 'tablo', 'adimlar', 'karsilastirma', 'baglantilar'];

/** Sınırlar (karakter = Unicode kod noktası). `baslik`: kart, öğe ve bağlantı başlıkları; `metin`: öteki her metin (adres dahil). */
export const KART_SINIR = {
  baslik: 80, metin: 200,
  ozet: 8, liste: 12, sutun: 6, satir: 20, adim: 10, secenekEn: 3, secenekAz: 2, ozellik: 8, baglanti: 8,
} as const;

// ── Doğrulama ────────────────────────────────────────────────────────────────────────────────────────────────────────────
class KartHatasi extends Error {}
const kus = (m: string): never => { throw new KartHatasi(m); };

/** Yön denetimi (U+202A–202E, U+2066–2069), sıfır genişlikli ve yön işaretleri (U+200B–200F, U+2060–2064) ile BOM (U+FEFF). Aralıklar SAYIYLA kurulur:
 *  kaynakta ham görünmez karakter olmaz (tests/kaynak-gorunmez.test.ts). */
const GIZLI_KARAKTER = new RegExp(`[${[[0x200b, 0x200f], [0x202a, 0x202e], [0x2060, 0x2064], [0x2066, 0x2069], [0xfeff, 0xfeff]]
  .map(([a, b]) => `${String.fromCharCode(a)}-${String.fromCharCode(b)}`).join('')}]`, 'g');

/** Denetim karakterleri boşluk olur; yön denetimi ve sıfır genişlikli karakterler düşer; boşluk dizileri tek boşluk, uçlar kırpılır. */
const duzelt = (s: string): string => s
  .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
  .replace(GIZLI_KARAKTER, '')
  .replace(/\s+/g, ' ')
  .trim();
const uzunluk = (s: string): number => [...s].length;

const nesneMi = (d: unknown): d is Record<string, unknown> => typeof d === 'object' && d !== null && !Array.isArray(d);

function nesne(d: unknown, yol: string, izinli: readonly string[]): Record<string, unknown> {
  if (!nesneMi(d)) return kus(`${yol} bir nesne olmalı`);
  for (const k of Object.keys(d)) if (!izinli.includes(k)) kus(`${yol}: bilinmeyen alan "${k}" (izin verilenler: ${izinli.join(', ')})`);
  return d;
}

/** Zorunlu metin: dize, düzeltilmiş hâli boş değil, sınır içinde. */
function metin(d: unknown, yol: string, sinir: number): string {
  if (typeof d !== 'string') return kus(`${yol} metin olmalı`);
  const s = duzelt(d);
  if (!s) return kus(`${yol} boş olamaz`);
  if (uzunluk(s) > sinir) return kus(`${yol} en çok ${sinir} karakter olabilir (${uzunluk(s)} var)`);
  return s;
}
/** Boş olabilen metin (tablo hücresi, karşılaştırma değeri). Hücrede en sık takılma: sonlu sayı metne ("29" → "29") ve doğru/yanlış değeri
 *  ("Evet"/"Hayır") çevrilir (görünür turda yeniden deneme turu harcanmasın); NaN/Infinity/nesne/null yine hata. */
function metinBosOlur(d: unknown, yol: string, sinir: number): string {
  const ham = typeof d === 'number' && Number.isFinite(d) ? String(d) : typeof d === 'boolean' ? (d ? 'Evet' : 'Hayır') : d;
  if (typeof ham !== 'string') return kus(`${yol} metin olmalı (sayı ve doğru/yanlış değeri de olur)`);
  const s = duzelt(ham);
  if (uzunluk(s) > sinir) return kus(`${yol} en çok ${sinir} karakter olabilir (${uzunluk(s)} var)`);
  return s;
}
/** İsteğe bağlı metin: yok / null / boş dize ⇒ undefined (alan kartta hiç yer almaz). */
function metinIsteyerek(d: unknown, yol: string, sinir: number): string | undefined {
  if (d === undefined || d === null) return undefined;
  if (typeof d !== 'string') return kus(`${yol} metin olmalı`);
  return duzelt(d) ? metin(d, yol, sinir) : undefined;
}

function dizi(d: unknown, yol: string, en: number, ust: number, birim: string): unknown[] {
  if (!Array.isArray(d)) return kus(`${yol} bir liste olmalı`);
  if (d.length < en) return kus(`${yol} en az ${en} ${birim} içermeli (${d.length} var)`);
  if (d.length > ust) return kus(`${yol} en çok ${ust} ${birim} içerebilir (${d.length} var)`);
  return d;
}

function adresDogrula(d: unknown, yol: string): string {
  const adres = metin(d, yol, KART_SINIR.metin);
  // Ham dize "http://" ya da "https://" ile başlamalı: URL ayrıştırıcısı "http:foo", "https:/x.com", "https:\\x.com" gibi kurallı olmayan biçimleri
  // de kabul eder ama ana sürecin sistem:ac yolu (ipc.ts) yalnız /^https?:\/\// açar — doğrulanıp çizilen ama tıklanınca hiçbir şey yapmayan bağlantı olmasın.
  if (!/^https?:\/\//i.test(adres)) return kus(`${yol} "https://" ya da "http://" ile başlayan tam bir web adresi olmalı`);
  let u: URL;
  try { u = new URL(adres); } catch { return kus(`${yol} geçerli bir web adresi olmalı (https://… ya da http://…)`); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return kus(`${yol} yalnız http: ya da https: olabilir`);
  if (!u.hostname) return kus(`${yol} geçerli bir web adresi olmalı`);
  return adres;
}

function kurDogrula(g: unknown): KartVerisi {
  if (!nesneMi(g)) return kus('Kart bir nesne olmalı: { tur, baslik, … }');
  const tur = g.tur;
  if (typeof tur !== 'string' || !(KART_TURLERI as readonly string[]).includes(tur)) return kus(`tur şunlardan biri olmalı: ${KART_TURLERI.join(', ')}`);
  const baslik = (zorunlu: boolean): string | undefined => (zorunlu ? metin(g.baslik, 'baslik', KART_SINIR.baslik) : metinIsteyerek(g.baslik, 'baslik', KART_SINIR.baslik));
  const bas = (b: string | undefined) => (b === undefined ? {} : { baslik: b });
  switch (tur) {
    case 'ozet': {
      nesne(g, 'Kart', ['tur', 'baslik', 'maddeler']);
      const b = baslik(true) as string;
      const maddeler = dizi(g.maddeler, 'maddeler', 1, KART_SINIR.ozet, 'madde').map((x, i) => metin(x, `maddeler[${i + 1}]`, KART_SINIR.metin));
      return { tur, baslik: b, maddeler };
    }
    case 'liste': {
      nesne(g, 'Kart', ['tur', 'baslik', 'ogeler']);
      const b = baslik(false);
      const ogeler = dizi(g.ogeler, 'ogeler', 1, KART_SINIR.liste, 'öğe').map((x, i) => {
        const o = nesne(x, `ogeler[${i + 1}]`, ['baslik', 'alt', 'sag']);
        const alt = metinIsteyerek(o.alt, `ogeler[${i + 1}].alt`, KART_SINIR.metin);
        const sag = metinIsteyerek(o.sag, `ogeler[${i + 1}].sag`, KART_SINIR.metin);
        return { baslik: metin(o.baslik, `ogeler[${i + 1}].baslik`, KART_SINIR.baslik), ...(alt === undefined ? {} : { alt }), ...(sag === undefined ? {} : { sag }) };
      });
      return { tur, ...bas(b), ogeler };
    }
    case 'tablo': {
      nesne(g, 'Kart', ['tur', 'baslik', 'sutunlar', 'satirlar']);
      const b = baslik(false);
      const sutunlar = dizi(g.sutunlar, 'sutunlar', 1, KART_SINIR.sutun, 'sütun').map((x, i) => metin(x, `sutunlar[${i + 1}]`, KART_SINIR.metin));
      const satirlar = dizi(g.satirlar, 'satirlar', 1, KART_SINIR.satir, 'satır').map((x, i) => {
        if (!Array.isArray(x)) return kus(`${i + 1}. satır bir liste olmalı`);
        if (x.length !== sutunlar.length) return kus(`${i + 1}. satırda ${x.length} hücre var, ${sutunlar.length} sütun olduğu için ${sutunlar.length} hücre olmalı`);
        return x.map((h, j) => metinBosOlur(h, `satirlar[${i + 1}][${j + 1}]`, KART_SINIR.metin));
      });
      return { tur, ...bas(b), sutunlar, satirlar };
    }
    case 'adimlar': {
      nesne(g, 'Kart', ['tur', 'baslik', 'adimlar']);
      const b = baslik(false);
      const adimlar = dizi(g.adimlar, 'adimlar', 1, KART_SINIR.adim, 'adım').map((x, i) => metin(x, `adimlar[${i + 1}]`, KART_SINIR.metin));
      return { tur, ...bas(b), adimlar };
    }
    case 'karsilastirma': {
      nesne(g, 'Kart', ['tur', 'baslik', 'secenekler', 'ozellikler']);
      const b = baslik(false);
      const secenekler = dizi(g.secenekler, 'secenekler', KART_SINIR.secenekAz, KART_SINIR.secenekEn, 'seçenek').map((x, i) => metin(x, `secenekler[${i + 1}]`, KART_SINIR.metin));
      const ozellikler = dizi(g.ozellikler, 'ozellikler', 1, KART_SINIR.ozellik, 'özellik').map((x, i) => {
        const o = nesne(x, `ozellikler[${i + 1}]`, ['ad', 'degerler']);
        const ad = metin(o.ad, `ozellikler[${i + 1}].ad`, KART_SINIR.metin);
        const degerler = Array.isArray(o.degerler) ? o.degerler : kus(`ozellikler[${i + 1}].degerler bir liste olmalı`);
        if (degerler.length !== secenekler.length) return kus(`"${ad}" özelliğinde ${degerler.length} değer var, ${secenekler.length} seçenek olduğu için ${secenekler.length} değer olmalı`);
        return { ad, degerler: degerler.map((v, j) => metinBosOlur(v, `ozellikler[${i + 1}].degerler[${j + 1}]`, KART_SINIR.metin)) };
      });
      return { tur, ...bas(b), secenekler, ozellikler };
    }
    default: {
      nesne(g, 'Kart', ['tur', 'baslik', 'baglantilar']);
      const b = baslik(false);
      const baglantilar = dizi(g.baglantilar, 'baglantilar', 1, KART_SINIR.baglanti, 'bağlantı').map((x, i) => {
        const o = nesne(x, `baglantilar[${i + 1}]`, ['baslik', 'adres']);
        return { baslik: metin(o.baslik, `baglantilar[${i + 1}].baslik`, KART_SINIR.baslik), adres: adresDogrula(o.adres, `baglantilar[${i + 1}].adres`) };
      });
      return { tur: 'baglantilar', ...bas(b), baglantilar };
    }
  }
}

/** Girdiyi doğrular ve temiz bir KartVerisi kopyası döner (yalnız bilinen alanlar, düzeltilmiş metin); girdiye dokunmaz. Hata iletisi Türkçe ve
 *  modele geri okunur ("… Düzeltip tekrar çağır."). */
export function kartDogrula(girdi: unknown): { kart: KartVerisi } | { hata: string } {
  try { return { kart: kurDogrula(girdi) }; } catch (e) {
    if (e instanceof KartHatasi) return { hata: e.message };
    return { hata: 'Kart doğrulanamadı' };
  }
}

// ── Düz metin ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const VARSAYILAN_BASLIK: Record<KartTuru, string> = { ozet: 'Özet', liste: 'Liste', tablo: 'Tablo', adimlar: 'Adımlar', karsilastirma: 'Karşılaştırma', baglantilar: 'Bağlantılar' };

/** Kartın başlığı; yoksa türün adı. */
export const kartBaslik = (k: KartVerisi): string => k.baslik ?? VARSAYILAN_BASLIK[k.tur];

/** Başlık dışındaki satırlar (düz metin). */
function govdeSatirlari(k: KartVerisi): string[] {
  switch (k.tur) {
    case 'ozet': return k.maddeler.map((m) => `- ${m}`);
    case 'liste': return k.ogeler.map((o) => `- ${o.baslik}${o.alt ? ` — ${o.alt}` : ''}${o.sag ? ` (${o.sag})` : ''}`);
    case 'tablo': return [k.sutunlar.join(' | '), ...k.satirlar.map((s) => s.join(' | '))];
    case 'adimlar': return k.adimlar.map((a, i) => `${i + 1}. ${a}`);
    case 'karsilastirma': return [`Seçenekler: ${k.secenekler.join(' | ')}`, ...k.ozellikler.map((o) => `${o.ad} — ${k.secenekler.map((s, i) => `${s}: ${o.degerler[i]}`).join(' · ')}`)];
    case 'baglantilar': return k.baglantilar.map((b) => `- ${b.baslik}: ${b.adres}`);
  }
}

/** Telefona, hafızaya, arama dizinine ve sohbet özetine giden düz metin (satır satır, okunur). */
export function kartDuzMetin(k: KartVerisi): string {
  return [...(k.baslik ? [k.baslik] : []), ...govdeSatirlari(k)].join('\n');
}

/** Adadaki kısaltılmış tablo: sütun başlıkları ve ilk satırlar (hizalı küçük tablo olarak çizilir). */
export interface KartOzetTablosu { sutunlar: string[]; satirlar: string[][] }

/** Adadaki kısaltılmış görünüm: başlık, ilk `azami` satır ve kalan satır sayısı. 11 Kas (tasarımcı bulgu 8): tablo ve karşılaştırma ham boru
 *  işaretiyle ("Plan | Aylık") görünmez — `tablo` alanı hizalı küçük tabloyu taşır (başlık satırı + ilk `azami` veri satırı); `satirlar` aynı
 *  satırların okunur düz hâlidir ("Pro · 29 $ · 5"). */
export function kartOzetSatirlari(k: KartVerisi, azami = 3): { baslik: string; satirlar: string[]; kalan: number; tablo?: KartOzetTablosu } {
  const baslik = kartBaslik(k);
  if (k.tur === 'tablo' || k.tur === 'karsilastirma') {
    const sutunlar = k.tur === 'tablo' ? k.sutunlar : ['', ...k.secenekler];
    const hepsi = k.tur === 'tablo' ? k.satirlar : k.ozellikler.map((o) => [o.ad, ...o.degerler]);
    const ilk = hepsi.slice(0, azami);
    return { baslik, satirlar: ilk.map((s) => s.filter(Boolean).join(' · ')), kalan: Math.max(0, hepsi.length - azami), tablo: { sutunlar, satirlar: ilk } };
  }
  const hepsi = k.tur === 'ozet' ? k.maddeler : govdeSatirlari(k).map((s) => s.replace(/^- /, ''));
  return { baslik, satirlar: hepsi.slice(0, azami), kalan: Math.max(0, hepsi.length - azami) };
}

// ── Sohbet kaydı ↔ görünüm ──────────────────────────────────────────────────────────────────────────────────────────────
export const KART_ARACI = 'kart_goster';

/** Kayıtlı bir araç çağrısı kart mı? Yalnız `kart_goster` ve yalnız GEÇERLİ girdi (araç da aynı işlevle doğrular: geçerli ⇒ başarılı). */
export function aracCagrisiKarti(ad: string, girdi: unknown): KartVerisi | null {
  if (ad !== KART_ARACI) return null;
  const s = kartDogrula(girdi);
  return 'kart' in s ? s.kart : null;
}

/** Düz metin yolları (telefon, bildirim): kart bloğu düz metin bloğuna iner; öteki bloklar aynen. */
export function kartiDuzMetneIndir<B extends { tur: string }>(b: B): B | { tur: 'metin'; metin: string } {
  const k = b as unknown as { tur: string; kart?: KartVerisi };
  return k.tur === 'kart' && k.kart ? { tur: 'metin', metin: kartDuzMetin(k.kart) } : b;
}
