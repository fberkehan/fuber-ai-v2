// ── Çentik panelinin Gündem, Görevler ve Gelenler sayfaları: saf kurallar (0.14 T24; R12, P14, B23; tests/centik-veri.test.ts) ─────────────────────
// Panel (renderer/ada/Panel.tsx) bu üç sayfayı `sayfaKaydet` ile taşır; veri ana süreçten tek kanaldan gelir ('centik:veri' → main/centik-veri.ts centikVerisi).
// Burada DOM, Electron ve ağ yok: ana süreç ve sayfalar aynı kuralı okur.
//  • Gündem: kokpitin gündemi (shared/gundem.ts gundemOgeleri: hatırlatıcı, son tarihli iş, toplantı e-postası, mesele) + bağlı takvimin bugünkü etkinlikleri.
//    Takvim, katalog girdisinin `gundemAraci` ile okunur (R12): panel açılınca, en çok 15 dakikada bir (`takvimAl`; başarısız deneme de 15 dk bekletir).
//    Sonuç `takvimOlaylariAyikla` ile (Google Calendar `items[]`, Microsoft Graph `value[]`); tanınmazsa "Takvim okunamadı". Her başarılı çağrı yerel
//    veritabanına `takvim-onbellek` anahtarıyla yazılır (B23: kokpit kartlarının durduğu depo, vt.ts meta). P14: Gizli ve "Yalnız bu bilgisayar"da hiç
//    çağrı yok — takvim bu bilgisayardaki son kopyadan, BULUT_KAPALI_METNI.takvim satırıyla; çağrı sürerken kapı kapanırsa yanıt gösterilmez, yazılmaz.
//    Düzeltme turu 1: panel takvimi beklemez (`takvimHemen`: önbellekteki kopya hemen, gerekiyorsa çağrı arka planda; bitince sayfa yeniden çeker).
//    Takvim bağlı değilse sayfa gizlenmez: kokpitin gündemi durur, altında tek satır "Takvim bağlı değil." ve "Bağla".
//  • Gelenler: kokpitin e-postaları (okunmamış ya da önemi ≥ 4) ve okunmamış WhatsApp yazışmaları, KOKPİTİN önem puanıyla sıralı (e-posta eşitlemesi
//    puanlar; burada yeni model çağrısı yok). Kaynak yoksa "E-posta ya da WhatsApp bağlı değil." ve "Bağla". Satıra tıklamak kokpit sohbetine
//    "Şu mesaja yanıt taslağı hazırla: …" gönderir (`gelenIstemi`); Fuber göndermez — gönderme her seferinde onaylıdır.
//  • Görevler: eşiği aşan sohbet turu ('ada:calisiyor') ve görevler (shared/isler-gorunum.ts); Durdur turu sohbet:durdur'la, görevi isler:durdur'la keser.
// Metinler kullanıcının gözünden, sade Türkçe; gizlilik için mutlak söz yok (yalnız neyin kapalı olduğu söylenir).
import { gundemOgeleri, type GundemOgesi } from './gundem.ts';
import { BULUT_KAPALI_METNI } from './bulut-kapisi.ts';
import { gorevKartiOgeleri, gorevSatiri, type GorevRozetTonu } from './isler-gorunum.ts';
import type { IsOzet } from './isler.ts';
import type { Istem } from './kokpit-istemleri.ts';
import type { EpostaOzet, KokpitVerisi, Mod, WaOzet } from './tipler.ts';

// ── Takvim ──
export interface TakvimOlayi {
  baslik: string;
  /** Saatli etkinlikte ISO (UTC); tüm gün etkinlikte YYYY-AA-GG. */
  bas: string;
  /** Bitiş (aynı biçim; tüm günde hariç tutulan gün). Yoksa alan yok. */
  bit?: string;
  tumGun: boolean;
}

export const TAKVIM_ONBELLEK_ANAHTARI = 'takvim-onbellek';
/** Takvim aracı en sık bu aralıkla çağrılır (R12). */
export const TAKVIM_ARALIK_MS = 15 * 60_000;
export const TAKVIM_BAGLI_DEGIL = 'Takvim bağlı değil.';
export const TAKVIM_OKUNAMADI = 'Takvim okunamadı.';
export const TAKVIM_YENILENMELI = 'Takvim bağlantısı yenilenmeli.';
/** 11 Kas (tasarımcı bulgu 9): katalogda takvim servisi yok — açık kaynak kullanıcısının Yönetim uygulaması yok, "Fuber Yönetim'den açılır" ona
 *  yol göstermiyordu. Artık neyin bağlanacağı söylenir ve Bağla Bağlantılar'ı açar (Servisler; Developer mode'da MCP sunucuları). */
export const TAKVIM_SERVISI_YOK = 'Takvim bağlı değil. Google ya da Outlook takvimini Bağlantılar’dan ekleyebilirsin.';
export const GELEN_GIZLI_NOTU = 'Gizli modda yanıt taslağı hazırlanmaz.';
export const GELEN_YEREL_NOTU = '"Yalnız bu bilgisayar" seçiliyken yanıt taslağı hazırlanmaz.';
export const GELEN_KAYNAK_YOK = 'E-posta ya da WhatsApp bağlı değil.';
export const GELEN_YOK = 'Yeni bir şey yok.';
export const GUNDEM_YOK = 'Bugün için bekleyen bir şey yok.';
export const GOREVLER_BOS = 'Şu an süren bir iş yok.';
export const YANIT_TASLAGI_ONEKI = 'Şu mesaja yanıt taslağı hazırla:';
const AZAMI_OLAY = 100;

/** Kaynağı olmayan sayfanın tek satırı + "Bağla": ana pencerede Bağlantılar'ın `cipa` bölümü açılır (ana:goster `baglantilar#<cipa>`). */
export interface BosDurum { metin: string; eylem: 'baglantilar' | null; cipa: string }

const nesne = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const metinMi = (x: unknown): x is string => typeof x === 'string';
const GUN_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Saatli zaman → ISO (UTC). Graph: ofsetsiz `dateTime` + `timeZone: 'UTC'` → Z eklenir; yedi haneli kesir üçe iner. Geçersizse null. */
function isoZaman(s: unknown, saatDilimi?: unknown): string | null {
  if (!metinMi(s) || !s.trim()) return null;
  let t = s.trim().replace(/(\.\d{3})\d+/, '$1');
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(t) && /^utc$/i.test(String(saatDilimi ?? ''))) t += 'Z';
  const z = Date.parse(t);
  return Number.isFinite(z) ? new Date(z).toISOString() : null;
}
const baslikOf = (x: unknown): string => (metinMi(x) && x.trim() ? x.replace(/\s+/g, ' ').trim().slice(0, 200) : '(Başlıksız)');

function googleOlayi(o: unknown): TakvimOlayi | null {
  if (!nesne(o) || o.status === 'cancelled' || !nesne(o.start)) return null;
  const s = o.start, e = nesne(o.end) ? o.end : {};
  if (metinMi(s.date) && GUN_RE.test(s.date)) {
    return { baslik: baslikOf(o.summary), bas: s.date, ...(metinMi(e.date) && GUN_RE.test(e.date) ? { bit: e.date } : {}), tumGun: true };
  }
  const bas = isoZaman(s.dateTime);
  if (!bas) return null;
  const bit = isoZaman(e.dateTime);
  return { baslik: baslikOf(o.summary), bas, ...(bit ? { bit } : {}), tumGun: false };
}

function graphOlayi(o: unknown): TakvimOlayi | null {
  if (!nesne(o) || o.isCancelled === true || !nesne(o.start)) return null;
  const s = o.start, e = nesne(o.end) ? o.end : {};
  if (o.isAllDay === true) {
    const bas = metinMi(s.dateTime) ? s.dateTime.slice(0, 10) : '';
    if (!GUN_RE.test(bas)) return null;
    const bit = metinMi(e.dateTime) ? e.dateTime.slice(0, 10) : '';
    return { baslik: baslikOf(o.subject), bas, ...(GUN_RE.test(bit) ? { bit } : {}), tumGun: true };
  }
  const bas = isoZaman(s.dateTime, s.timeZone);
  if (!bas) return null;
  const bit = isoZaman(e.dateTime, e.timeZone);
  return { baslik: baslikOf(o.subject), bas, ...(bit ? { bit } : {}), tumGun: false };
}

/**
 * Takvim aracının sonucu → etkinlikler (R12). Kabul edilen: MCP sonucu (`structuredContent` ya da JSON metin parçası) ya da ham gövde; içinde Google Calendar
 * `items[]` ya da Microsoft Graph `value[]`. İptal edilenler ve başlangıcı okunamayanlar düşer; boş liste geçerlidir ([]). Tanınmayan biçim (ve araç hatası) null.
 */
export function takvimOlaylariAyikla(x: unknown): TakvimOlayi[] | null {
  if (!nesne(x) || x.isError === true) return null;
  const adaylar: unknown[] = [];
  if (nesne(x.structuredContent)) adaylar.push(x.structuredContent);
  if (Array.isArray(x.content)) {
    for (const p of x.content) {
      if (!nesne(p) || p.type !== 'text' || !metinMi(p.text)) continue;
      try { adaylar.push(JSON.parse(p.text)); } catch { /* JSON değil: bu parça tanınmaz */ }
    }
  }
  adaylar.push(x);
  for (const a of adaylar) {
    if (!nesne(a)) continue;
    const [liste, ayikla] = Array.isArray(a.items) ? [a.items, googleOlayi] : Array.isArray(a.value) ? [a.value, graphOlayi] : [null, null];
    if (!liste || !ayikla) continue;
    return liste.slice(0, AZAMI_OLAY).map(ayikla).filter((o): o is TakvimOlayi => o !== null);
  }
  return null;
}

// ── Takvimin çağrısı ve önbelleği (bağımlılıklar dışarıdan: main/centik-veri.ts gerçeklerini verir, test sahtesini) ──
export interface TakvimOnbellegi { surum: 1; zaman: number; kaynak: string; olaylar: TakvimOlayi[] }
/** Bellekteki çağrı durumu: son deneme (başarısız da), son hata, süren çağrı (aynı anda iki açılış tek çağrı). */
export interface TakvimCagriDurumu { kaynak: string | null; sonDeneme: number; sonHata: string | null; suren: Promise<TakvimSonucu> | null }
export const takvimDurumuYeni = (): TakvimCagriDurumu => ({ kaynak: null, sonDeneme: Number.NEGATIVE_INFINITY, sonHata: null, suren: null });

export interface TakvimBaglami {
  /** P14: istek anında sorulur (çağrıdan önce ve yanıt gelince). */
  bulutKapali(): boolean;
  /** Bu modda görünen, bu bilgisayarda bağlı ve gündem aracı tanımlı takvim girdisi (yerel kayıttan; ağa çıkmaz). Yoksa null. */
  girdi(): { id: string; arac: { ad: string; girdi: Record<string, unknown> } } | null;
  /** Düzeltme turu 1: gündem araçlı takvim girdisi var ama bağlantısı yenilenmeli (belirteç reddedildi; yerel kayıttan, ağsız). */
  yenilenmeli(): boolean;
  /** Gündem aracının çağrısı (main: mcpKatalogAraciCagir). Fırlatırsa mesajı tek cümledir. */
  aracCagir(id: string, ad: string, girdi: Record<string, unknown>): Promise<unknown>;
  oku(anahtar: string): string | undefined;
  yaz(anahtar: string, deger: string): void;
  simdi(): number;
  durum: TakvimCagriDurumu;
}
/** `olaylar` null: takvim bağlı değil (`yenilenmeli`: girdi var, bağlantısı yenilenmeli). `not`: Gizli satırı; `hata`: son çağrının tek cümlesi (son kopya yine
 *  gösterilir). */
export interface TakvimSonucu { olaylar: TakvimOlayi[] | null; not: string | null; hata: string | null; yenilenmeli?: boolean }

function olayGecerli(o: unknown): o is TakvimOlayi {
  return nesne(o) && metinMi(o.baslik) && metinMi(o.bas) && typeof o.tumGun === 'boolean' && (o.bit === undefined || metinMi(o.bit));
}
function onbellekOku(b: TakvimBaglami): TakvimOnbellegi | null {
  try {
    const j = JSON.parse(b.oku(TAKVIM_ONBELLEK_ANAHTARI) ?? 'null') as unknown;
    if (!nesne(j) || j.surum !== 1 || !metinMi(j.kaynak) || typeof j.zaman !== 'number' || !Array.isArray(j.olaylar)) return null;
    return { surum: 1, zaman: j.zaman, kaynak: j.kaynak, olaylar: j.olaylar.filter(olayGecerli).slice(0, AZAMI_OLAY) };
  } catch { return null; }
}
const hataCumlesi = (e: unknown): string => {
  const m = String((e as Error)?.message ?? '').replace(/\s+/g, ' ').trim();
  return m && m.length <= 160 ? m : TAKVIM_OKUNAMADI;
};

type Karar = { sonuc: TakvimSonucu; cagri: null } | { sonuc: TakvimSonucu; cagri: { id: string; arac: { ad: string; girdi: Record<string, unknown> } } };
/** Çağrısız karar (ağsız, eşzamanlı): Gizli'de son kopya; bağlı değilse null; yoksa eldeki kopya — ve 15 dk sınırı izin veriyorsa çağrılacak girdi. */
function karar(b: TakvimBaglami): Karar {
  const g = b.girdi();
  const c = onbellekOku(b);
  const eldeki = g && c && c.kaynak === g.id ? c.olaylar : [];
  if (b.bulutKapali()) {
    // Düzeltme turu 1: Gizli'de takvim hiç bağlı değilse "son kopya" denmez; bağlı olmadığı (ya da yenilenmesi gerektiği) söylenir. Bağla yok.
    const not = g ? BULUT_KAPALI_METNI.takvim : b.yenilenmeli() ? TAKVIM_YENILENMELI : TAKVIM_BAGLI_DEGIL;
    return { sonuc: { olaylar: g ? eldeki : null, not, hata: null }, cagri: null };
  }
  if (!g) return { sonuc: { olaylar: null, not: null, hata: null, yenilenmeli: b.yenilenmeli() }, cagri: null };
  const d = b.durum;
  if (d.kaynak !== g.id) { d.kaynak = g.id; d.sonDeneme = Number.NEGATIVE_INFINITY; d.sonHata = null; d.suren = null; }
  const simdi = b.simdi();
  if (c && c.kaynak === g.id && simdi - c.zaman < TAKVIM_ARALIK_MS) return { sonuc: { olaylar: c.olaylar, not: null, hata: null }, cagri: null };
  const sonuc = { olaylar: eldeki, not: null, hata: d.sonHata };
  if (d.suren || simdi - d.sonDeneme < TAKVIM_ARALIK_MS) return { sonuc, cagri: null };
  return { sonuc, cagri: g };
}

/**
 * Düzeltme turu 1 (stale-while-revalidate): takvimi BEKLEMEDEN verir — Gizli'de son kopya, bağlı değilse null, yoksa önbellekteki kopya. `tazele` doluysa
 * 15 dk sınırı bir çağrıya izin verdi ve çağrı başlatıldı: söz bitince (başarı ya da hata) çağıran sayfaları yeniden çizdirir. Hiç fırlatmaz.
 */
export function takvimHemen(b: TakvimBaglami): TakvimSonucu & { tazele: Promise<TakvimSonucu> | null } {
  const k = karar(b);
  return { ...k.sonuc, tazele: k.cagri ? cagriBaslat(b, k.cagri) : null };
}

function cagriBaslat(b: TakvimBaglami, g: { id: string; arac: { ad: string; girdi: Record<string, unknown> } }): Promise<TakvimSonucu> {
  const d = b.durum;
  d.sonDeneme = b.simdi();
  const eldeki = (): TakvimOlayi[] => { const c = onbellekOku(b); return c && c.kaynak === g.id ? c.olaylar : []; };
  const p = (async (): Promise<TakvimSonucu> => {
    try {
      const ham = await b.aracCagir(g.id, g.arac.ad, g.arac.girdi);
      if (b.bulutKapali()) return karar(b).sonuc; // Review Focus 3: kapı çağrı sürerken kapandı — yanıt gösterilmez, yazılmaz
      const olaylar = takvimOlaylariAyikla(ham);
      if (!olaylar) { d.sonHata = TAKVIM_OKUNAMADI; return { olaylar: eldeki(), not: null, hata: TAKVIM_OKUNAMADI }; }
      const kayit: TakvimOnbellegi = { surum: 1, zaman: b.simdi(), kaynak: g.id, olaylar };
      try { b.yaz(TAKVIM_ONBELLEK_ANAHTARI, JSON.stringify(kayit)); } catch { /* yazılamadı: bu açılışta yine gösterilir */ }
      d.sonHata = null;
      return { olaylar, not: null, hata: null };
    } catch (e) {
      if (b.bulutKapali()) return karar(b).sonuc;
      d.sonHata = hataCumlesi(e);
      return { olaylar: eldeki(), not: null, hata: d.sonHata };
    }
  })().finally(() => { if (d.suren === p) d.suren = null; });
  d.suren = p;
  return p;
}

/** Gündemin takvimi, çağrı gerekiyorsa SONUCUNU bekleyerek: Gizli'de son kopya (çağrı yok); bağlı değilse null; önbellek ve son deneme 15 dk'dan yeniyse
 *  çağrısız; süren çağrı varsa onu bekler; yoksa bir çağrı. Hiç fırlatmaz. (Panel takvimHemen kullanır; bu, tazelenmiş sonucu isteyenler ve testler için.) */
export function takvimAl(b: TakvimBaglami): Promise<TakvimSonucu> {
  const k = karar(b);
  if (k.cagri) return cagriBaslat(b, k.cagri);
  if (!b.bulutKapali() && b.durum.suren && b.durum.kaynak === b.girdi()?.id) return b.durum.suren;
  return Promise.resolve(k.sonuc);
}

// ── Gündem sayfası ──
export type GundemSatiri = GundemOgesi | TakvimOlayi;
export const takvimOlayiMi = (o: GundemSatiri): o is TakvimOlayi => 'tumGun' in o;
export interface GundemSayfasi {
  /** Sıradaki (ya da şu an süren) saatli öğe: büyük saatle gösterilir. Yoksa null. */
  siradaki: GundemSatiri | null;
  /** Geri kalanlar (en çok 4): tüm gün etkinlikleri, gecikenler, sonrakiler. */
  ogeler: GundemSatiri[];
  /** Takvim bağlı değil (Gizli'de değil): tek satır + Bağla. */
  bos: BosDurum | null;
  /** Gizli satırı ya da takvimin son hatası (tek satır). */
  not: string | null;
}

const gunSonu = (t: number) => { const d = new Date(t); d.setHours(23, 59, 59, 999); return d.getTime(); };
const gunAnahtari = (t: number) => new Date(t).toLocaleDateString('sv-SE');
const yerelGunBasi = (gun: string) => { const [y, a, g] = gun.split('-').map(Number); return new Date(y, a - 1, g).getTime(); };

/** Takvim etkinliği bugün görünür mü: tüm gün etkinliği bugünü kapsıyor; saatli etkinlik bugün başlıyor (ya da sürüyor) ve bitmedi (bitişsizse 1 saat). */
function bugunGorunur(o: TakvimOlayi, simdi: number): boolean {
  const bugun = gunAnahtari(simdi);
  if (o.tumGun) return o.bas <= bugun && (o.bit ? bugun < o.bit : o.bas === bugun);
  const bas = Date.parse(o.bas);
  if (!Number.isFinite(bas)) return false;
  const bit = o.bit ? Date.parse(o.bit) : bas + 3600_000;
  return bas <= gunSonu(simdi) && (Number.isFinite(bit) ? bit : bas + 3600_000) > simdi;
}
function siraAnahtari(o: GundemSatiri): number {
  if (takvimOlayiMi(o)) return o.tumGun ? yerelGunBasi(o.bas) : Date.parse(o.bas);
  if (o.tur === 'toplanti') return Number.MAX_SAFE_INTEGER - 1; // gelme zamanı geçmişte: zamanlıların arkasında (gundem.ts ile aynı)
  if (o.tur === 'mesele') return Date.parse(`${o.zaman}T23:59:00`);
  return Date.parse(o.zaman ?? '');
}
/** Sıradaki adayı: saatli, gecikmemiş, bitmemiş öğe (takvimde süren etkinlik de; e-posta ve mesele hariç — saatleri yok). */
function saatliGelecek(o: GundemSatiri, simdi: number): boolean {
  if (takvimOlayiMi(o)) return !o.tumGun;
  return !o.gecikti && (o.tur === 'hatirlatici' || o.tur === 'gorev') && Date.parse(o.zaman ?? '') >= simdi;
}

/**
 * Gündem sayfası: kokpitin gündemi + takvimin bugünkü etkinlikleri, zamana göre (gecikenler önce). `takvim` null = takvim bağlı değil → `bos` (Bağla),
 * ama sayfa gizlenmez ve kokpitin gündemi yine görünür. `ek.not` (Gizli satırı) varken Bağla yok; `ek.cipa`: Bağla'nın açacağı Bağlantılar bölümü.
 */
export function gundemSayfasi(
  v: Parameters<typeof gundemOgeleri>[0], takvim: TakvimOlayi[] | null, simdi: number,
  ek: { not?: string | null; hata?: string | null; cipa?: string | null; yenilenmeli?: boolean; yedekCipa?: string } = {},
): GundemSayfasi {
  const kokpit = gundemOgeleri(v, simdi, 12).ogeler;
  const gecikti = (o: GundemSatiri) => !takvimOlayiMi(o) && o.gecikti;
  const hepsi: GundemSatiri[] = [...(takvim ?? []).filter((o) => bugunGorunur(o, simdi)), ...kokpit]
    .sort((a, b) => Number(gecikti(b)) - Number(gecikti(a)) || siraAnahtari(a) - siraAnahtari(b));
  const siradaki = hepsi.find((o) => saatliGelecek(o, simdi)) ?? null;
  return {
    siradaki,
    ogeler: hepsi.filter((o) => o !== siradaki).slice(0, 4),
    // Düzeltme turu 1: yenilenmesi gereken bağlantı "bağlı değil" gibi okunmaz; Bağla yine takvimin kartına ("Yeniden bağla").
    // `cipa: null` = katalogda takvim servisi yok (11 Kas): neyin bağlanacağı söylenir, Bağla Bağlantılar'ın yedek bölümünü açar (`yedekCipa`).
    bos: takvim === null && !ek.not
      ? ek.cipa === null ? { metin: TAKVIM_SERVISI_YOK, eylem: 'baglantilar', cipa: ek.yedekCipa ?? 'servisler' }
        : { metin: ek.yenilenmeli ? TAKVIM_YENILENMELI : TAKVIM_BAGLI_DEGIL, eylem: 'baglantilar', cipa: ek.cipa ?? 'servisler' }
      : null,
    not: ek.not ?? ek.hata ?? null,
  };
}

// ── Gelenler sayfası ──
export interface GelenOgesi {
  /** React anahtarı ve tıklamanın kaydı. */
  anahtar: string;
  kanal: 'eposta' | 'whatsapp';
  /** E-postada kayıt numarası (#id), WhatsApp'ta yazışmanın jid'i. */
  kayit: number | string;
  kimden: string;
  /** E-postada konu, WhatsApp'ta son mesaj. */
  ozet: string;
  zaman: string;
  /** Kokpitin önemi (e-posta eşitlemesinin puanı 0–5; okunmamış WhatsApp yazışması 3). */
  oncelik: number;
  okunmamis: boolean;
}
export interface GelenlerSayfasi {
  ogeler: GelenOgesi[];
  /** Düzeltme turu 1: kesmeden önce sayılan okunmamışlar — okunmamış e-postalar + WhatsApp'ta okunmamış MESAJLAR (yazışma değil). */
  okunmamis: number;
  bos: BosDurum | null;
  /** Gizli ya da "Yalnız bu bilgisayar": satırlar tıklanmaz, nedeni tek satır. */
  not: string | null;
}
/** WhatsApp'ta puan yok: okunmamış yazışma kokpitteki "normal" önemde (3) sayılır. */
const WA_ONCELIK = 3;
const kisiAdi = (s: string): string => s.replace(/<[^>]*>/g, '').replace(/^["'\s]+|["'\s]+$/g, '').trim() || s.trim();

/**
 * Gelenler: okunmamış ya da önemli (≥ 4) e-postalar ve okunmamış WhatsApp yazışmaları; kokpitin önemine göre, eşitte okunmamış ve yeni önce. Kaynak yoksa
 * `bos` (E-posta'ya götürür). Yeni model çağrısı yok: önem e-posta eşitlemesinin kaydıdır.
 */
export function gelenlerSayfasi(
  v: { epostalar: readonly EpostaOzet[]; whatsapp: readonly WaOzet[]; kaynak: { eposta: boolean; whatsapp: boolean }; bulut?: { gizliMod: boolean; yalnizYerel: boolean } },
  enCok = 6,
): GelenlerSayfasi {
  if (!v.kaynak.eposta && !v.kaynak.whatsapp && !v.epostalar.length && !v.whatsapp.length) {
    return { ogeler: [], okunmamis: 0, bos: { metin: GELEN_KAYNAK_YOK, eylem: 'baglantilar', cipa: 'eposta' }, not: null };
  }
  const not = v.bulut?.gizliMod ? GELEN_GIZLI_NOTU : v.bulut?.yalnizYerel ? GELEN_YEREL_NOTU : null;
  const okunmamis = v.epostalar.filter((e) => !e.okundu).length + v.whatsapp.reduce((n, w) => n + Math.max(0, Math.floor(Number(w.okunmamis) || 0)), 0);
  const l: GelenOgesi[] = [
    ...v.epostalar.filter((e) => !e.okundu || e.onem >= 4).map((e): GelenOgesi => ({
      anahtar: `e:${e.id}`, kanal: 'eposta', kayit: e.id, kimden: kisiAdi(e.kimden), ozet: e.konu || '(Konusuz)', zaman: e.tarih,
      oncelik: Math.max(0, Math.min(5, Math.round(Number(e.onem) || 0))), okunmamis: !e.okundu,
    })),
    ...v.whatsapp.filter((w) => w.okunmamis > 0).map((w): GelenOgesi => ({
      anahtar: `w:${w.jid}`, kanal: 'whatsapp', kayit: w.jid, kimden: w.ad || w.jid, ozet: w.sonMesaj, zaman: w.zaman, oncelik: WA_ONCELIK, okunmamis: true,
    })),
  ];
  const t = (s: string) => { const z = Date.parse(s); return Number.isFinite(z) ? z : 0; };
  l.sort((a, b) => b.oncelik - a.oncelik || Number(b.okunmamis) - Number(a.okunmamis) || t(b.zaman) - t(a.zaman));
  return { ogeler: l.slice(0, enCok), okunmamis, bos: null, not };
}

/** Gelen satırına tıklama: kokpit sohbetine giden istek (kokpitin e-posta satırıyla aynı yol: sohbet:gonder). Okumak araç ister (Gizli'de önerilmez). */
export function gelenIstemi(o: GelenOgesi): Istem {
  const ozet = o.ozet.replace(/\s+/g, ' ').trim().slice(0, 160);
  const ne = o.kanal === 'eposta' ? `#${o.kayit} numaralı e-posta, ${o.kimden}: "${ozet}".` : `${o.kimden} adlı kişinin WhatsApp mesajı: "${ozet}".`;
  return { metin: `${YANIT_TASLAGI_ONEKI} ${ne} Taslağı bana göster; gönderme.`, arac: true };
}

// ── Görevler sayfası ──
export interface GorevSatiri {
  anahtar: string;
  baslik: string;
  alt: string;
  rozet: { ton: GorevRozetTonu; metin: string };
  /** Satırın tek düğmesi ve gittiği kanal: süren sohbet turu → sohbet:durdur; süren görev → isler:durdur; duran görev → isler:surdur. */
  eylem: { tur: 'durdur' | 'surdur'; kanal: 'sohbet:durdur' | 'isler:durdur' | 'isler:surdur'; id: number } | null;
}
export interface GorevlerSayfasi { suren: number; ogeler: GorevSatiri[]; bos: string | null }

/** Görevler: önce eşiği aşan sohbet turu (Çalışıyor hapıyla aynı kaynak), sonra süren görevler ve bugün bitenler (Görevler kartının sırası). */
export function gorevlerSayfasi(isler: readonly IsOzet[], calisiyor: { sohbetId: number; adim: number; etiket: string } | null, simdi: number, mod: Mod = 'is'): GorevlerSayfasi {
  const an = new Date(simdi);
  const k = gorevKartiOgeleri(isler, an);
  const ogeler: GorevSatiri[] = [];
  if (calisiyor) {
    const etiket = calisiyor.etiket.trim();
    ogeler.push({
      anahtar: `sohbet:${calisiyor.sohbetId}`, baslik: 'Fuber şu an çalışıyor', alt: `${Math.max(1, Math.floor(calisiyor.adim) || 1)}. adım${etiket ? ` · ${etiket}` : ''}`,
      rozet: { ton: 'bilgi', metin: 'Çalışıyor' }, eylem: { tur: 'durdur', kanal: 'sohbet:durdur', id: calisiyor.sohbetId },
    });
  }
  for (const is of k.hepsi) {
    const s = gorevSatiri(is, an, mod);
    ogeler.push({
      anahtar: `is:${is.id}`, baslik: s.baslik, alt: s.alt, rozet: s.rozet,
      eylem: s.eylem === 'durdur' ? { tur: 'durdur', kanal: 'isler:durdur', id: is.id } : s.eylem === 'surdur' ? { tur: 'surdur', kanal: 'isler:surdur', id: is.id } : null,
    });
  }
  return { suren: (calisiyor ? 1 : 0) + k.suren.length, ogeler, bos: ogeler.length ? null : GOREVLER_BOS };
}

// ── 'centik:veri' yükü ──
export interface CentikVerisi {
  gundem: GundemSayfasi;
  /** Görevler sayfası süren sohbet turunu çentiğin kendi durumundan ('ada:calisiyor') ekler. */
  gorevler: { isler: IsOzet[]; mod: Mod };
  gelenler: GelenlerSayfasi;
  /** Gizli ya da "Yalnız bu bilgisayar": Gelenler satırı tıklanmaz (okumak araç ister). */
  bulutKapali: boolean;
}
/** Gündem'in kokpit alt kümesi (gundemOgeleri'nin girdisi). */
export type GundemKokpitVerisi = Pick<KokpitVerisi, 'hatirlaticilar' | 'gorevler' | 'epostalar'> & { dusunme?: Pick<KokpitVerisi['dusunme'], 'meseleler'> };
