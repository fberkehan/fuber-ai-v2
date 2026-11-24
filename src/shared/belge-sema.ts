// ── Belge üretimi: istek biçimi ve doğrulama (0.14 T17, R7; saf → birim testli: tests/belge-uret.test.ts) ──
// `belge_uret` aracının girdisi: tür (docx, xlsx, pptx, pdf), hedef yol ve türe uygun içerik. İçerik üç biçimden biridir:
//   · metin  (docx, pdf): { baslik?, bolumler: [{ baslik?, paragraflar?, tablo? }] }
//   · tablo  (xlsx):      { sayfalar: [{ ad, satirlar: (metin | sayı)[][] }] }
//   · sunum  (pptx):      { slaytlar: [{ baslik, maddeler }] }
// Doğrulama KATI ve kopya döndürür: bilinmeyen alanlar düşer, sayılar tablo hücresinde metne çevrilir (modeller sık sayı yollar), `null` hücre boştur.
// Boyut sınırları bellek ve dosya boyutunu korur (model yanlışlıkla yüz bin satır yollayamaz). Hata iletileri modele gider (Türkçe, düzeltilebilir).

export type BelgeTuru = 'docx' | 'xlsx' | 'pptx' | 'pdf';
export const BELGE_TURLERI: readonly BelgeTuru[] = ['docx', 'xlsx', 'pptx', 'pdf'];

export interface BelgeBolum { baslik?: string; paragraflar?: string[]; tablo?: string[][] }
export interface BelgeMetinIcerigi { baslik?: string; bolumler: BelgeBolum[] }
export interface BelgeTabloIcerigi { sayfalar: { ad: string; satirlar: (string | number)[][] }[] }
export interface BelgeSunumIcerigi { slaytlar: { baslik: string; maddeler: string[] }[] }
export type BelgeIcerigi = BelgeMetinIcerigi | BelgeTabloIcerigi | BelgeSunumIcerigi;
export interface BelgeIstegi { tur: BelgeTuru; yol: string; icerik: BelgeIcerigi }

/** Üst sınırlar. `metin`: belgedeki bütün metinlerin toplam karakteri; `hucre`: tek hücre/paragraf (Excel hücre sınırı 32.767). */
export const BELGE_SINIR = { bolum: 200, paragraf: 2000, sayfa: 20, satir: 5000, sutun: 50, slayt: 100, madde: 40, metin: 1_000_000, hucre: 32_000, yol: 1000 } as const;

/** Kullanıcıya ve onay kartına görünen tür adları. */
export const BELGE_TUR_ADI: Record<BelgeTuru, string> = { docx: 'Word belgesi', xlsx: 'Excel tablosu', pptx: 'Sunum', pdf: 'PDF belgesi' };

/** xlsx hücresinde sayıya çevrilen metin: işaretsiz ya da "-" işaretli, baştaki sıfırsız (telefon, posta kodu metin kalır), nokta ondalıklı, en çok 15 hane.
 *  Şemada hücreler `string`dir (bazı sağlayıcılar tür dizisini reddeder); sayı gibi görünen metin Excel'e sayı olarak yazılır. */
const SAYI_METNI = /^-?(?:0|[1-9]\d{0,14})(?:\.\d{1,15})?$/;

const nesne = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const adetli = (n: number, tekil: string) => `${n} ${tekil}`;

/** Doğrulama sırasındaki toplam metin sayacı (sınır aşımı tek iletiyle). */
class Sayac {
  toplam = 0;
  ekle(s: string): void { this.toplam += s.length; }
}

function metin(x: unknown, yer: string, s: Sayac, zorunlu = false): string | undefined | { hata: string } {
  if (x === undefined || x === null || x === '') return zorunlu ? { hata: `${yer} zorunlu` } : undefined;
  if (typeof x !== 'string') return { hata: `${yer} metin olmalı` };
  if (x.length > BELGE_SINIR.hucre) return { hata: `${yer} çok uzun (en çok ${BELGE_SINIR.hucre} karakter)` };
  s.ekle(x);
  return x;
}
const hataMi = (x: unknown): x is { hata: string } => nesne(x) && typeof x.hata === 'string' && Object.keys(x).length === 1;

function metinIcerigi(c: Record<string, unknown>, s: Sayac): BelgeMetinIcerigi | string {
  const baslik = metin(c.baslik, 'icerik.baslik', s);
  if (hataMi(baslik)) return baslik.hata;
  if (!Array.isArray(c.bolumler)) return 'icerik.bolumler dizi olmalı (her biri { baslik?, paragraflar?, tablo? })';
  if (c.bolumler.length === 0) return 'icerik.bolumler en az bir bölüm içermeli';
  if (c.bolumler.length > BELGE_SINIR.bolum) return `icerik.bolumler çok uzun (en çok ${BELGE_SINIR.bolum} bölüm)`;
  const bolumler: BelgeBolum[] = [];
  for (let i = 0; i < c.bolumler.length; i++) {
    const b = c.bolumler[i], yer = `icerik.bolumler[${i}]`;
    if (!nesne(b)) return `${yer} nesne olmalı`;
    const o: BelgeBolum = {};
    const bb = metin(b.baslik, `${yer}.baslik`, s);
    if (hataMi(bb)) return bb.hata;
    if (bb) o.baslik = bb;
    if (b.paragraflar !== undefined && b.paragraflar !== null) {
      if (!Array.isArray(b.paragraflar)) return `${yer}.paragraflar metin dizisi olmalı`;
      if (b.paragraflar.length > BELGE_SINIR.paragraf) return `${yer}.paragraflar çok uzun (en çok ${BELGE_SINIR.paragraf})`;
      o.paragraflar = [];
      for (let j = 0; j < b.paragraflar.length; j++) {
        const p = metin(b.paragraflar[j], `${yer}.paragraflar[${j}]`, s);
        if (hataMi(p)) return p.hata;
        o.paragraflar.push(p ?? '');
      }
    }
    if (b.tablo !== undefined && b.tablo !== null) {
      const t = tabloSatirlari(b.tablo, `${yer}.tablo`, s, false);
      if (typeof t === 'string') return t;
      o.tablo = t.map((r) => r.map(String));
    }
    bolumler.push(o);
  }
  return { ...(baslik ? { baslik } : {}), bolumler };
}

/** Satır dizisi (tablo ya da xlsx sayfası): her satır dizi, her hücre metin ya da sayı (`null` boş). `sayiOk`: sayı olarak kalır. */
function tabloSatirlari(x: unknown, yer: string, s: Sayac, sayiOk: boolean): (string | number)[][] | string {
  if (!Array.isArray(x)) return `${yer} satır dizisi olmalı (her satır bir dizi)`;
  if (x.length > BELGE_SINIR.satir) return `${yer} çok uzun (en çok ${BELGE_SINIR.satir} satır)`;
  const out: (string | number)[][] = [];
  for (let i = 0; i < x.length; i++) {
    const r = x[i];
    if (!Array.isArray(r)) return `${yer}[${i}] dizi olmalı`;
    if (r.length > BELGE_SINIR.sutun) return `${yer}[${i}] çok geniş (en çok ${BELGE_SINIR.sutun} sütun)`;
    const satir: (string | number)[] = [];
    for (let j = 0; j < r.length; j++) {
      const h = r[j];
      if (h === null || h === undefined) { satir.push(''); continue; }
      if (typeof h === 'number') {
        if (!Number.isFinite(h)) return `${yer}[${i}][${j}] sonlu bir sayı olmalı`;
        satir.push(sayiOk ? h : String(h));
        continue;
      }
      const m = metin(h, `${yer}[${i}][${j}]`, s);
      if (hataMi(m)) return m.hata;
      satir.push(sayiOk && m !== undefined && SAYI_METNI.test(m) ? Number(m) : m ?? '');
    }
    out.push(satir);
  }
  return out;
}

function tabloIcerigi(c: Record<string, unknown>, s: Sayac): BelgeTabloIcerigi | string {
  if (!Array.isArray(c.sayfalar)) return 'icerik.sayfalar dizi olmalı (her biri { ad, satirlar })';
  if (c.sayfalar.length === 0) return 'icerik.sayfalar en az bir sayfa içermeli';
  if (c.sayfalar.length > BELGE_SINIR.sayfa) return `icerik.sayfalar çok uzun (en çok ${BELGE_SINIR.sayfa} sayfa)`;
  const sayfalar: BelgeTabloIcerigi['sayfalar'] = [];
  for (let i = 0; i < c.sayfalar.length; i++) {
    const p = c.sayfalar[i], yer = `icerik.sayfalar[${i}]`;
    if (!nesne(p)) return `${yer} nesne olmalı`;
    const a = metin(p.ad, `${yer}.ad`, s, true);
    if (hataMi(a)) return a.hata;
    const satirlar = tabloSatirlari(p.satirlar, `${yer}.satirlar`, s, true);
    if (typeof satirlar === 'string') return satirlar;
    sayfalar.push({ ad: a as string, satirlar });
  }
  return { sayfalar };
}

function sunumIcerigi(c: Record<string, unknown>, s: Sayac): BelgeSunumIcerigi | string {
  if (!Array.isArray(c.slaytlar)) return 'icerik.slaytlar dizi olmalı (her biri { baslik, maddeler })';
  if (c.slaytlar.length === 0) return 'icerik.slaytlar en az bir slayt içermeli';
  if (c.slaytlar.length > BELGE_SINIR.slayt) return `icerik.slaytlar çok uzun (en çok ${BELGE_SINIR.slayt} slayt)`;
  const slaytlar: BelgeSunumIcerigi['slaytlar'] = [];
  for (let i = 0; i < c.slaytlar.length; i++) {
    const t = c.slaytlar[i], yer = `icerik.slaytlar[${i}]`;
    if (!nesne(t)) return `${yer} nesne olmalı`;
    const b = metin(t.baslik, `${yer}.baslik`, s, true);
    if (hataMi(b)) return b.hata;
    const maddeler: string[] = [];
    if (t.maddeler !== undefined && t.maddeler !== null) {
      if (!Array.isArray(t.maddeler)) return `${yer}.maddeler metin dizisi olmalı`;
      if (t.maddeler.length > BELGE_SINIR.madde) return `${yer}.maddeler çok uzun (en çok ${BELGE_SINIR.madde} madde)`;
      for (let j = 0; j < t.maddeler.length; j++) {
        const m = metin(t.maddeler[j], `${yer}.maddeler[${j}]`, s);
        if (hataMi(m)) return m.hata;
        maddeler.push(m ?? '');
      }
    }
    slaytlar.push({ baslik: b as string, maddeler });
  }
  return { slaytlar };
}

/** İstek geçerliyse null, değilse modele gidecek Türkçe iletiyi döndürür. */
export function belgeIstegiHatasi(x: unknown): string | null {
  const r = ayikla(x);
  return typeof r === 'string' ? r : null;
}

/** İsteği doğrular ve temizlenmiş kopyasını döndürür; geçersizse null (neden: `belgeIstegiHatasi`). */
export function belgeIstegiDogrula(x: unknown): BelgeIstegi | null {
  const r = ayikla(x);
  return typeof r === 'string' ? null : r;
}

function ayikla(x: unknown): BelgeIstegi | string {
  if (!nesne(x)) return 'belge isteği nesne olmalı: { tur, yol, icerik }';
  const tur = x.tur;
  if (typeof tur !== 'string' || !(BELGE_TURLERI as readonly string[]).includes(tur)) return `tur şunlardan biri olmalı: ${BELGE_TURLERI.join(', ')}`;
  if (typeof x.yol !== 'string' || !x.yol.trim()) return 'yol zorunlu (kaydedilecek dosyanın tam yolu)';
  if (x.yol.length > BELGE_SINIR.yol) return 'yol çok uzun';
  if (!nesne(x.icerik)) return 'icerik nesne olmalı (docx/pdf: bolumler, xlsx: sayfalar, pptx: slaytlar)';
  const s = new Sayac();
  const t = tur as BelgeTuru;
  const icerik = t === 'xlsx' ? tabloIcerigi(x.icerik, s) : t === 'pptx' ? sunumIcerigi(x.icerik, s) : metinIcerigi(x.icerik, s);
  if (typeof icerik === 'string') {
    // Tür–içerik uyuşmazlığına özel ipucu: model yanlış anahtar yollamış olabilir.
    const beklenen = t === 'xlsx' ? 'sayfalar' : t === 'pptx' ? 'slaytlar' : 'bolumler';
    return x.icerik[beklenen] === undefined ? `${t} belgesinin içeriği "${beklenen}" ile verilir. ${icerik}` : icerik;
  }
  if (s.toplam > BELGE_SINIR.metin) return `belge çok büyük (en çok ${BELGE_SINIR.metin} karakter metin)`;
  return { tur: t, yol: x.yol, icerik };
}

/** Onay kartı önizlemesi için içerik özeti: tür adı, başlık, sayılar. Yazılan metnin kendisi uzun olabilir; yalnız başlıklar. */
export function belgeOzetiMetni(i: BelgeIstegi): string {
  const tur = BELGE_TUR_ADI[i.tur];
  const kisa = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  if (i.tur === 'xlsx') {
    const c = i.icerik as BelgeTabloIcerigi;
    return `${tur} · ${adetli(c.sayfalar.length, 'sayfa')}: ${c.sayfalar.slice(0, 8).map((p) => `${kisa(p.ad, 31)} (${adetli(p.satirlar.length, 'satır')})`).join(', ')}`;
  }
  if (i.tur === 'pptx') {
    const c = i.icerik as BelgeSunumIcerigi;
    return `${tur} · ${adetli(c.slaytlar.length, 'slayt')}: ${c.slaytlar.slice(0, 8).map((p) => kisa(p.baslik, 40)).join('; ')}`;
  }
  const c = i.icerik as BelgeMetinIcerigi;
  const tablo = c.bolumler.filter((b) => b.tablo?.length).length;
  const parcalar = [adetli(c.bolumler.length, 'bölüm'), ...(tablo ? [adetli(tablo, 'tablo')] : [])];
  const basliklar = c.bolumler.map((b) => b.baslik).filter((b): b is string => Boolean(b)).slice(0, 8).map((b) => kisa(b, 40));
  return `${tur}${c.baslik ? ` · “${kisa(c.baslik, 80)}”` : ''} · ${parcalar.join(', ')}${basliklar.length ? ` (${basliklar.join('; ')})` : ''}`;
}
