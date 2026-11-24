// ── Olay yardımcısı protokolü (0.14 T20, Ruling R1) — saf; birim testli: tests/sistem-olay.test.ts ───────────────────────────────
// resources/bin/fuber-olay.exe (native/fuber-olay, C++17 + C++/WinRT) sistem olaylarını olay güdümlü dinler ve stdout'a satır başına
// bir JSON (UTF-8) yazar: şarj, ağ, ses aygıtı, ses düzeyi, parlaklık, Caps Lock, klavye dili, tam ekran, medya oturumu. Ana süreç
// stdin'e komut satırı yazar (durum, klavye kancası aç/kapa, ses düzeyi, medya eylemi); stdin kapanınca yardımcı çıkar. Yoklama yok:
// değer yalnız değişince gelir. Bu dosya satırları alan alan doğrular (yardımcı sürümü değişince tanınmayan satır ya da alan sessizce
// düşer, çökme yok) ve son bilinen hâli (`SistemDurumu`) olaylardan saf olarak günceller. Süreci açan ve çentiğe bağlayan katman
// T22'de (src/main).
// Medya (T21): Windows'un medya oturumu (GSMTC; Spotify, tarayıcı, mağaza uygulamaları …) çalanı bildirir. Konum her saniye gelmez:
// yardımcı konumu bir anla (`konumZamani`) birlikte verir, ana süreç anlık konumu `medyaKonumu` ile kendisi hesaplar; yardımcı yalnız
// çalma durumu, hız, parça ya da kapak değişince ya da konum bu hesaptan 0,5 sn kayınca yeniden yazar.

/** Yardımcının `hazir` satırında bildirdiği protokol sürümü. */
export const OLAY_SURUMU = 1;
/** Yardımcının yazabildiği olay türleri (kaynak taraması C++ tarafını bu listeyle karşılaştırır). */
export const OLAY_TURLERI = ['hazir', 'guc', 'ag', 'ses-aygiti', 'ses', 'parlaklik', 'caps', 'dil', 'tam-ekran', 'medya', 'durum', 'hata', 'sayac'] as const;
export type OlayTuru = (typeof OLAY_TURLERI)[number];
/**
 * 0.14 T28b: yardımcının temiz çıkışta yazdığı geri çağırma sayaçları (`sayac` satırı; tanı, ana süreç yalnız FUBER_DEMO'da günlüğe yazar). Yalnız bu adlar
 * ve negatif olmayan tamsayılar geçer; tuş verisi ve pencere başlığı hiçbir alanda yoktur. `sureMs`: yardımcının açık kaldığı süre; `on`, `kucultme`: ön
 * pencere ve küçültme olayı; `appbar`: kabuğun tam ekran bildirimi (ABN_FULLSCREENAPP); `ekran`: ekran düzeni değişimi; `klavyeKurulum`/`klavyeKaldirma`:
 * alçak düzey klavye kancasının kaç kez kurulup kaldırıldığı (tam ekranda kaldırılır); `klavyeAcikMs`: kancanın kurulu kaldığı toplam süre; `klavyeIsMs`:
 * kanca iş parçacığının toplam işlemci süresi.
 */
export const SAYAC_ALANLARI = ['sureMs', 'on', 'kucultme', 'appbar', 'ekran', 'klavyeKurulum', 'klavyeKaldirma', 'klavyeAcikMs', 'klavyeIsMs'] as const;
export type SayacAlani = (typeof SAYAC_ALANLARI)[number];
/** Medya eylemleri: her biri yardımcıda tek bir oturum yöntemine gider (oynat, duraklat, sonraki, önceki parça, konuma git). */
export const MEDYA_EYLEMLERI = ['oynat', 'duraklat', 'ileri', 'geri', 'konum'] as const;
export type MedyaEylemi = (typeof MEDYA_EYLEMLERI)[number];
/** Kapak görselinin ham bayt sınırı; aşan kapak `null` gelir (yardımcıda da aynı sınır: native/fuber-olay/medya.cpp). */
export const KAPAK_SINIRI = 256 * 1024;

/** Medya oturumu olayı (ve `durum.medya`): çalan bir oturum yoksa `var: false`. */
export type MedyaOlayi = Extract<SistemOlayi, { t: 'medya' }>;

/** 0.14 T25: çentiğe giden medya hâli ('ada:medya', 'medya:al'; main/olay-yardimcisi.ts centikMedyasi): medya oturumu ve ses düzeyi (Müzik kaydırıcısı). */
export interface CentikMedyasi { medya: MedyaOlayi | null; ses: SistemDurumu['ses'] }

/** Medya şu an çalıyor mu (R13 Kapalı hap, panelin medya çubukları): oturum var, `caliyor` ve hız > 0. Düzeltme turu 1: duraklamada hiz 0 gelir (T21);
 *  yalnız `caliyor` bayrağına güvenilmez. */
export const medyaCaliyor = (m: CentikMedyasi | null | undefined): boolean => Boolean(m?.medya?.var && m.medya.caliyor && m.medya.hiz > 0);

/** Ekranın fiziksel piksel kutusu (yardımcı DPI farkında; ana süreç ölçekle DIP'e çevirir). */
export interface EkranKutusu { x: number; y: number; en: number; boy: number }

/** Yardımcının bildiği son hâl (`durum` olayının gövdesi). Bilinmeyen ya da kaynağı olmayan alan null (ör. dahili ekranı olmayan bilgisayarda parlaklık). */
export interface SistemDurumu {
  /** `sarj`: prize takılı; `yuzde`: pil yüzdesi (pilsiz masaüstünde null). */
  guc: { sarj: boolean; yuzde: number | null } | null;
  /** İnternete bağlı mı (Windows ağ simgesiyle aynı ölçü). */
  ag: boolean | null;
  /** Son değişen ses çıkış aygıtı (açılışta varsayılan aygıt). `tur`: 'kulaklik' | 'hoparlor' | 'ekran' | 'diger'; `pil` bilinmiyorsa null. */
  sesAygiti: { ad: string; tur: string; bagli: boolean; pil: number | null } | null;
  /** Varsayılan çıkış aygıtının düzeyi (0..1) ve sessizliği. */
  ses: { duzey: number; sessiz: boolean } | null;
  /** Dahili ekran parlaklığı (0..1); WMI olayı vermeyen ekranda null (R25). */
  parlaklik: number | null;
  caps: boolean | null;
  /** Ön pencerenin klavye dili: BCP-47 kodu ve dilin kendi adı ("Türkçe", "English"). */
  dil: { kod: string; ad: string } | null;
  /** Ön pencere kendi ekranını tam kaplıyor mu; `ekran` o ekranın kutusu. */
  tamEkran: { acik: boolean; ekran: EkranKutusu } | null;
  /** Medya oturumu; yardımcının medya kaynağı henüz hazır değilse ya da kurulamadıysa null. */
  medya: MedyaOlayi | null;
}

export type SistemOlayi =
  | { t: 'hazir'; surum: number }
  | { t: 'guc'; sarj: boolean; yuzde: number | null }
  | { t: 'ag'; bagli: boolean }
  | { t: 'ses-aygiti'; ad: string; tur: string; bagli: boolean; pil: number | null }
  | { t: 'ses'; duzey: number; sessiz: boolean }
  | { t: 'parlaklik'; duzey: number }
  | { t: 'caps'; acik: boolean }
  | { t: 'dil'; kod: string; ad: string }
  | { t: 'tam-ekran'; acik: boolean; ekran: EkranKutusu }
  | { t: 'medya'; var: false }
  | {
    t: 'medya'; var: true;
    /** Kaynak uygulamanın kimliği (AUMID): "Spotify.exe", "chrome", "MSEdge", mağaza uygulamasında paket kimliği. */
    uygulama: string;
    /** Uygulama üst veri vermeyebilir: boş dize olabilir. */
    baslik: string; sanatci: string; album: string;
    /** Parça süresi (sn); 0: uygulama zaman çizelgesi vermiyor. */
    sure: number;
    /** `konumZamani` anındaki konum (sn). Anlık konum: `medyaKonumu`. */
    konum: number;
    /** Konumun ölçüldüğü an (Unix ms). */
    konumZamani: number;
    caliyor: boolean;
    /** Oynatma hızı (1 = normal). */
    hiz: number;
    /** `data:image/jpeg;base64,…` ya da `data:image/png;base64,…`; kapak yoksa ya da `KAPAK_SINIRI`'nı aşarsa null. */
    kapak: string | null;
  }
  | ({ t: 'durum' } & SistemDurumu)
  | { t: 'hata'; mesaj: string }
  | { t: 'sayac'; sayaclar: Partial<Record<SayacAlani, number>> };

/**
 * Ana sürecin yardımcıya yazdığı komutlar. `klavye`: Caps Lock / klavye dili kancası (yalnız ayar açıkken true). `ses`: düzey 0..1.
 * `medya`: çalan oturuma oynat, duraklat, sonraki (`ileri`), önceki (`geri`) ya da `konum` (sn'ye git).
 */
export type YardimciKomutu =
  | { k: 'durum' } | { k: 'klavye'; acik: boolean } | { k: 'ses'; duzey: number }
  | { k: 'medya'; eylem: Exclude<MedyaEylemi, 'konum'> } | { k: 'medya'; eylem: 'konum'; sn: number };

export const BOS_DURUM: Readonly<SistemDurumu> = Object.freeze({
  guc: null, ag: null, sesAygiti: null, ses: null, parlaklik: null, caps: null, dil: null, tamEkran: null, medya: null,
});

/** Tek satırın üst sınırı (kapaksız en uzun satır `durum`, ~2 KB; fazlası bozuk sayılır). */
const SATIR_SINIRI = 64 * 1024;
/** Kapak taşıyabilen satırların (`medya`, `durum`) sınırı: 256 KB kapak base64'te ≈ 342 KB. */
const KAPAKLI_SATIR_SINIRI = 512 * 1024;
const AD_SINIRI = 256;
const MESAJ_SINIRI = 500;
/** Kapak yalnız yardımcının yazdığı iki biçimde: jpeg ya da png base64 data URL (ağ adresi, dosya yolu, SVG ya da HTML geçmez). */
const KAPAK_ONEKLERI = ['data:image/jpeg;base64,', 'data:image/png;base64,'] as const;
const KAPAK_BASE64_SINIRI = Math.ceil(KAPAK_SINIRI / 3) * 4;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

type Nesne = Record<string, unknown>;
const nesneMi = (v: unknown): v is Nesne => typeof v === 'object' && v !== null && !Array.isArray(v);
const sayiMi = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const kirp01 = (v: number) => Math.min(1, Math.max(0, v));
/** 0–100 arası yüzde; dışı ya da sayı değilse null. */
const yuzde = (v: unknown): number | null => (sayiMi(v) && v >= 0 && v <= 100 ? v : null);
/** Boş olmayan dize (sınırda kesilir); değilse null. */
const dize = (v: unknown, sinir: number): string | null => (typeof v === 'string' && v.length > 0 ? v.slice(0, sinir) : null);

function gucAyikla(v: unknown): SistemDurumu['guc'] {
  if (!nesneMi(v) || typeof v.sarj !== 'boolean') return null;
  return { sarj: v.sarj, yuzde: yuzde(v.yuzde) };
}
function sesAygitiAyikla(v: unknown): SistemDurumu['sesAygiti'] {
  if (!nesneMi(v) || typeof v.bagli !== 'boolean') return null;
  const ad = dize(v.ad, AD_SINIRI), tur = dize(v.tur, 32);
  return ad && tur ? { ad, tur, bagli: v.bagli, pil: yuzde(v.pil) } : null;
}
function sesAyikla(v: unknown): SistemDurumu['ses'] {
  if (!nesneMi(v) || !sayiMi(v.duzey) || typeof v.sessiz !== 'boolean') return null;
  return { duzey: kirp01(v.duzey), sessiz: v.sessiz };
}
function dilAyikla(v: unknown): SistemDurumu['dil'] {
  if (!nesneMi(v)) return null;
  const kod = dize(v.kod, 85), ad = dize(v.ad, 128);
  return kod && ad ? { kod, ad } : null;
}
function ekranAyikla(v: unknown): EkranKutusu | null {
  if (!nesneMi(v) || !sayiMi(v.x) || !sayiMi(v.y) || !sayiMi(v.en) || !sayiMi(v.boy) || v.en <= 0 || v.boy <= 0) return null;
  return { x: v.x, y: v.y, en: v.en, boy: v.boy };
}
function tamEkranAyikla(v: unknown): SistemDurumu['tamEkran'] {
  if (!nesneMi(v) || typeof v.acik !== 'boolean') return null;
  const ekran = ekranAyikla(v.ekran);
  return ekran ? { acik: v.acik, ekran } : null;
}
const mantikYaDaBos = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
const duzeyYaDaBos = (v: unknown): number | null => (sayiMi(v) ? kirp01(v) : null);
/** Dize (boş olabilir; sınırda kesilir); dize değilse null. */
const metinYaDaBos = (v: unknown, sinir: number): string | null => (typeof v === 'string' ? v.slice(0, sinir) : null);

/** Kapak: yalnız jpeg/png base64 data URL, en çok `KAPAK_SINIRI` bayt; değilse null (olay düşmez, kapaksız gösterilir). */
function kapakAyikla(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const onek = KAPAK_ONEKLERI.find((o) => v.startsWith(o));
  if (!onek) return null;
  const govde = v.slice(onek.length);
  if (govde.length === 0 || govde.length > KAPAK_BASE64_SINIRI || govde.length % 4 !== 0 || !BASE64.test(govde)) return null;
  return v;
}

/** Medya gövdesi ("t" olsa da olmasa da): `var` mantık değilse ya da `var: true`da zorunlu alan eksik/yanlış türdeyse null. */
function medyaAyikla(v: unknown): MedyaOlayi | null {
  if (!nesneMi(v) || typeof v.var !== 'boolean') return null;
  if (!v.var) return { t: 'medya', var: false };
  const uygulama = metinYaDaBos(v.uygulama, AD_SINIRI), baslik = metinYaDaBos(v.baslik, AD_SINIRI);
  const sanatci = metinYaDaBos(v.sanatci, AD_SINIRI), album = metinYaDaBos(v.album, AD_SINIRI);
  if (uygulama === null || baslik === null || sanatci === null || album === null) return null;
  if (!sayiMi(v.sure) || !sayiMi(v.konum) || !sayiMi(v.konumZamani) || typeof v.caliyor !== 'boolean' || !sayiMi(v.hiz)) return null;
  return {
    t: 'medya', var: true, uygulama, baslik, sanatci, album, sure: Math.max(0, v.sure), konum: Math.max(0, v.konum),
    konumZamani: v.konumZamani, caliyor: v.caliyor, hiz: v.hiz, kapak: kapakAyikla(v.kapak),
  };
}

/**
 * Anlık konum (sn): `konum` + `konumZamani`'ndan bu yana geçen süre × hız (yalnız çalarken), 0..`sure` arasında. Saat konum
 * zamanının gerisindeyse geri gitmez. Çalan yoksa ya da zaman çizelgesi yoksa (`sure` 0) 0.
 */
export function medyaKonumu(m: MedyaOlayi, simdi: number): number {
  if (!m.var) return 0;
  const gecen = m.caliyor && Number.isFinite(simdi) ? (Math.max(0, simdi - m.konumZamani) / 1000) * m.hiz : 0;
  return Math.min(m.sure, Math.max(0, m.konum + gecen));
}

/** Yardımcının bir stdout satırını doğrular; bozuk, bilinmeyen ya da zorunlu alanı eksik satır null. Fazladan alanlar atılır. */
export function olaySatiriAyristir(satir: string): SistemOlayi | null {
  if (typeof satir !== 'string' || satir.length > KAPAKLI_SATIR_SINIRI) return null;
  const s = satir.trim();
  if (!s.startsWith('{')) return null;
  let v: unknown;
  try { v = JSON.parse(s); } catch { return null; }
  if (!nesneMi(v) || typeof v.t !== 'string' || !(OLAY_TURLERI as readonly string[]).includes(v.t)) return null;
  const t = v.t as OlayTuru;
  if (satir.length > SATIR_SINIRI && t !== 'medya' && t !== 'durum') return null;
  switch (t) {
    case 'hazir':
      return Number.isInteger(v.surum) && (v.surum as number) >= 1 ? { t, surum: v.surum as number } : null;
    case 'guc': {
      const g = gucAyikla(v);
      return g ? { t, ...g } : null;
    }
    case 'ag':
      return typeof v.bagli === 'boolean' ? { t, bagli: v.bagli } : null;
    case 'ses-aygiti': {
      const a = sesAygitiAyikla(v);
      return a ? { t, ...a } : null;
    }
    case 'ses': {
      const d = sesAyikla(v);
      return d ? { t, ...d } : null;
    }
    case 'parlaklik':
      return sayiMi(v.duzey) ? { t, duzey: kirp01(v.duzey) } : null;
    case 'caps':
      return typeof v.acik === 'boolean' ? { t, acik: v.acik } : null;
    case 'dil': {
      const d = dilAyikla(v);
      return d ? { t, ...d } : null;
    }
    case 'tam-ekran': {
      const d = tamEkranAyikla(v);
      return d ? { t, ...d } : null;
    }
    case 'medya':
      return medyaAyikla(v);
    case 'durum':
      return {
        t, guc: gucAyikla(v.guc), ag: mantikYaDaBos(v.ag), sesAygiti: sesAygitiAyikla(v.sesAygiti), ses: sesAyikla(v.ses),
        parlaklik: duzeyYaDaBos(v.parlaklik), caps: mantikYaDaBos(v.caps), dil: dilAyikla(v.dil), tamEkran: tamEkranAyikla(v.tamEkran),
        medya: medyaAyikla(v.medya),
      };
    case 'hata': {
      const mesaj = typeof v.mesaj === 'string' ? v.mesaj.slice(0, MESAJ_SINIRI) : null;
      return mesaj !== null ? { t, mesaj } : null;
    }
    case 'sayac': {
      const sayaclar: Partial<Record<SayacAlani, number>> = {};
      for (const a of SAYAC_ALANLARI) {
        const x = v[a];
        if (Number.isSafeInteger(x) && (x as number) >= 0) sayaclar[a] = x as number;
      }
      return { t, sayaclar };
    }
  }
}

/**
 * Yardımcının stdin'ine yazılacak tek satır (sonunda '\n'). Yalnız tanımlı alanlar gider; ses düzeyi 0..1'e kıstırılır, NaN/sonsuz
 * hata. Medya: listede olmayan eylem hata (yardımcıya gitmez); `konum` sn ister (0 altı 0, ms çözünürlük), öbür eylemlerde sn gitmez.
 */
export function komutSatiri(k: YardimciKomutu): string {
  let govde: YardimciKomutu;
  switch (k.k) {
    case 'durum': govde = { k: 'durum' }; break;
    case 'klavye': govde = { k: 'klavye', acik: k.acik === true }; break;
    case 'ses':
      if (!sayiMi(k.duzey)) throw new RangeError(`Geçersiz ses düzeyi: ${String(k.duzey)}`);
      govde = { k: 'ses', duzey: Math.round(kirp01(k.duzey) * 1000) / 1000 };
      break;
    case 'medya': {
      const eylem: unknown = k.eylem;
      if (!(MEDYA_EYLEMLERI as readonly unknown[]).includes(eylem)) throw new TypeError(`Bilinmeyen medya eylemi: ${String(eylem)}`);
      if (k.eylem === 'konum') {
        if (!sayiMi(k.sn)) throw new RangeError(`Geçersiz konum: ${String(k.sn)}`);
        govde = { k: 'medya', eylem: 'konum', sn: Math.round(Math.max(0, k.sn) * 1000) / 1000 };
      } else {
        govde = { k: 'medya', eylem: k.eylem };
      }
      break;
    }
    default: throw new TypeError('Bilinmeyen yardımcı komutu');
  }
  return `${JSON.stringify(govde)}\n`;
}

/** Olayı son bilinen hâle uygular; girdiyi değiştirmez, iç nesneleri kopyalar. `durum` hâlin tamamını değiştirir; `hazir` ve `hata` dokunmaz. */
export function durumGuncelle(d: SistemDurumu, o: SistemOlayi): SistemDurumu {
  switch (o.t) {
    case 'hazir':
    case 'hata':
    case 'sayac':
      return d;
    case 'guc': return { ...d, guc: { sarj: o.sarj, yuzde: o.yuzde } };
    case 'ag': return { ...d, ag: o.bagli };
    case 'ses-aygiti': return { ...d, sesAygiti: { ad: o.ad, tur: o.tur, bagli: o.bagli, pil: o.pil } };
    case 'ses': return { ...d, ses: { duzey: o.duzey, sessiz: o.sessiz } };
    case 'parlaklik': return { ...d, parlaklik: o.duzey };
    case 'caps': return { ...d, caps: o.acik };
    case 'dil': return { ...d, dil: { kod: o.kod, ad: o.ad } };
    case 'tam-ekran': return { ...d, tamEkran: { acik: o.acik, ekran: { ...o.ekran } } };
    case 'medya': return { ...d, medya: { ...o } };
    case 'durum': {
      const { t: _t, ...govde } = o;
      return {
        guc: govde.guc && { ...govde.guc }, ag: govde.ag, sesAygiti: govde.sesAygiti && { ...govde.sesAygiti }, ses: govde.ses && { ...govde.ses },
        parlaklik: govde.parlaklik, caps: govde.caps, dil: govde.dil && { ...govde.dil },
        tamEkran: govde.tamEkran && { acik: govde.tamEkran.acik, ekran: { ...govde.tamEkran.ekran } }, medya: govde.medya && { ...govde.medya },
      };
    }
  }
}
