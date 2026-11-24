// ── İş izi: uygulamadaki bütün işlerin TEK modeli (11 Kas 2026; saf, Electron/DOM yok — tests/is-izi.test.ts) ─────────────────────────────
// Alt ajanlara giden işlerde ne yapıldığı belli olmuyordu; uygulama hangi işin nerede yapıldığını özel animasyonlarla gösterir.
// Tasarımcı analizi (bulgu 1, 2, 4; Bölüm 5): iş altı yüzeye dağılmıştı, her yüzey başka sözcük kullanıyordu. Artık her iş tek kayıttır ve AYNI cümle
// üç yerde görünür: çentik (en çok 3 satır), sohbet (yardımcı şeritleri), kokpit ("Şu an" kartı); rayda işin yürüdüğü sayfanın simgesinde nokta.
// Kaynaklar (ana süreç main/is-izi.ts eşler ve olayla yayar, yoklama yok): sohbet turu, arka plan görevi (isler), Claude Code oturumu, alt ajanı
// ve arka plan işi, sohbetin arka plan süreci (arka_plan). Her kayıt: ne (kısa Türkçe fiil öbeği), nerede (açılacak sayfa ve yol), durum, başlangıç
// ve biliniyorsa ilerleme. Telefona yalnız durum gider (telefonIsOzeti): fiil, başlık, yer adı ve yol gitmez.
import type { IsOzet } from './isler.ts';
import type { SurecOzeti } from './surec.ts';
import type { CcArkaIs, CcAracTipi, CcOturumOzeti } from './cc-olay.ts';
import type { Mod } from './tipler.ts';
import { ccOturumYolu } from './cc-olay.ts';
import { gorevSatiri } from './isler-gorunum.ts';
import { isGuvenliMetin } from './beyin.ts';
import { TERIM } from './terimler.ts';

/** Yedi durum; her yüzeyde aynı ad ve aynı işaret (Bölüm 5.2). */
export const IS_HALLERI = ['sirada', 'basliyor', 'calisiyor', 'bekliyor', 'onay', 'bitti', 'olmadi'] as const;
export type IsHali = (typeof IS_HALLERI)[number];
export const IS_HALI_ADI: Record<IsHali, string> = {
  sirada: 'Sırada', basliyor: 'Başlıyor', calisiyor: 'Çalışıyor', bekliyor: 'Bekliyor', onay: 'Onay bekliyor', bitti: 'Bitti', olmadi: 'Olmadı',
};
export const aktifMi = (h: IsHali): boolean => h !== 'bitti' && h !== 'olmadi';

export type IsKaynagi = 'sohbet' | 'gorev' | 'surec' | 'cc-oturum' | 'cc-ajan' | 'cc-is' | 'toplanti';
/** İşin yürüdüğü sayfa (ray simgesindeki nokta bu sayfanın düğmesine düşer). */
export type IsSayfasi = 'sohbetler' | 'claude' | 'kokpit' | 'etkinlik' | 'toplanti';
/** `yol`: ana:goster yolu ('sohbetler/12', 'claude#cc-<id>'); `ad`: insan dilinde yer ("Rakip fiyat araştırması", "mavi-kus"). */
export interface IsYeri { sayfa: IsSayfasi; yol: string; ad: string }
export interface IsIlerlemesi {
  /** Atılan adım sayısı (biliniyorsa). */
  adim?: number;
  /** Bilinen ilerleme 0…1 (süreli görevde geçen süre / toplam): çubuk yalnız bu varken çizilir. */
  oran?: number;
}

export interface IsKaydi {
  /** Kararlı kimlik (yalnız eşleme ve anahtar için; HİÇBİR yerde görünmez): 'sohbet:7', 'gorev:4', 'cc:<oturum>', 'cc:<oturum>:<araç>', 'surec:k1'. */
  id: string;
  kaynak: IsKaynagi;
  /** Canlı fiil öbeği ("Web'de arıyor", "Okuyor · Kartlar.tsx", "Bekliyor · sonraki kontrol 14:30"). */
  ne: string;
  /** İşin kendi adı ("Eski ekranları tara", görev başlığı); yoksa boş. */
  baslik: string;
  nerede: IsYeri;
  hal: IsHali;
  /** ms (Date.now tabanı). */
  baslangic: number;
  bitis?: number;
  ilerleme?: IsIlerlemesi;
  /** Üst işin kimliği (Claude Code oturumunun alt ajanı ve işleri). */
  ust?: string;
  /** Kardeşler arasında sıra (0'dan): yardımcının adı ("Yardımcı 2") ve tonu bundan. */
  sira?: number;
  /** İşin geldiği sohbet (o sohbette yardımcı şeridi olarak görünür). */
  sohbetId?: number;
  /** Uzun ömürlü arka plan işi (dev sunucusu): çentiği açmaz, rayda nefes almaz; kokpit ve sohbette görünür. */
  surekli?: boolean;
  /** Satırdan durdurulabilir (sohbet turu, görev, Claude Code oturumu ve işi, süreç). */
  durdurulabilir?: boolean;
}

/** Biten iş bu kadar görünür kalır (tik + hedefe uçuş + çıkış), sonra listeden düşer. */
export const BITEN_OMRU_MS = 2400;
/** Sohbet turu bu eşiği aşınca iş sayılır (kısa yanıt çentiği ve kokpiti oynatmasın; ajan/zincir.ts CALISIYOR_ESIGI ile aynı). */
export const SOHBET_IS_ESIGI = { ms: 8000, adim: 3 } as const;

// ── Biçim ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const tekSatir = (s: string, n: number): string => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  const k = [...t];
  return k.length > n ? `${k.slice(0, n - 1).join('').trimEnd()}…` : t;
};
const dosyaAdi = (y: string): string => String(y ?? '').trim().split(/[\\/]/).filter(Boolean).pop() ?? '';

/** "4 sn", "1 dk 12 sn", "12 dk", "1 sa 5 dk". */
export function isSuresi(ms: number): string {
  const sn = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  if (sn < 60) return `${sn} sn`;
  const dk = Math.floor(sn / 60);
  if (dk < 10) return sn % 60 ? `${dk} dk ${sn % 60} sn` : `${dk} dk`;
  if (dk < 60) return `${dk} dk`;
  const sa = Math.floor(dk / 60);
  return dk % 60 ? `${sa} sa ${dk % 60} dk` : `${sa} sa`;
}

const HAL_SIRASI: Record<IsHali, number> = { onay: 0, calisiyor: 1, basliyor: 2, bekliyor: 3, sirada: 4, olmadi: 5, bitti: 5 };
/** Aktifler önce (onay > çalışıyor > başlıyor > bekliyor > sırada; aynı hâlde önce başlayan), sürekli işler (dev sunucusu) aktiflerin sonunda,
 *  sonra bitenler (en yeni önce). */
const sira = (x: IsKaydi): number => (x.surekli && aktifMi(x.hal) ? 4.5 : HAL_SIRASI[x.hal]);
export function isleriSirala(l: readonly IsKaydi[]): IsKaydi[] {
  return [...l].sort((a, b) => {
    const h = sira(a) - sira(b);
    if (h) return h;
    if (!aktifMi(a.hal)) return (b.bitis ?? 0) - (a.bitis ?? 0);
    return a.baslangic - b.baslangic || (a.sira ?? 0) - (b.sira ?? 0);
  });
}

/** Satır olarak gösterilen işler: aktif çocuğu olan üst iş satır olmaz (yerine çocukları — "3 yardımcı" görünür). Sıralı. */
export function yaprakIsler(l: readonly IsKaydi[]): IsKaydi[] {
  const ustler = new Set(l.filter((x) => x.ust && aktifMi(x.hal)).map((x) => x.ust!));
  return isleriSirala(l.filter((x) => !ustler.has(x.id)));
}

/** Çentiğin saydığı işler: aktif, sürekli olmayan yapraklar. */
export const centikIsleri = (l: readonly IsKaydi[]): IsKaydi[] => yaprakIsler(l).filter((x) => aktifMi(x.hal) && !x.surekli);
export const centikIsSayisi = (l: readonly IsKaydi[]): number => centikIsleri(l).length;

/** Çentiğin gösterdiği işler: aktif yapraklar + bir an kalan bitenler (tik görünsün), sürekli işler hariç. Hap bu liste boşalınca kapanır. */
export const centikGorunenler = (l: readonly IsKaydi[]): IsKaydi[] => yaprakIsler(l).filter((x) => !x.surekli);

/** Çentiğin açık listesi: en çok 3 satır + kalan sayısı. */
export function centikSatirlari(l: readonly IsKaydi[], en = 3): { satirlar: IsKaydi[]; kalan: number } {
  const c = centikIsleri(l);
  return { satirlar: c.slice(0, en), kalan: Math.max(0, c.length - en) };
}

/** Kapalı hapın cümlesi: tek işte işin fiili; birden çokta "N iş · <ilk işin adı>". */
export function centikOzeti(l: readonly IsKaydi[]): string {
  const c = l.filter((x) => aktifMi(x.hal));
  if (!c.length) return '';
  if (c.length === 1) return c[0].ne;
  const ilk = c[0];
  return `${c.length} iş · ${ilk.baslik || ilk.ne}`;
}

/** Yardımcının adı: alt ajan "Yardımcı N" (İş dilinde "alt ajan" denmez); öbürleri kaynağın adı. */
export function yardimciAdi(is: Pick<IsKaydi, 'kaynak' | 'sira'>): string {
  switch (is.kaynak) {
    case 'cc-ajan': return `Yardımcı ${(is.sira ?? 0) + 1}`;
    case 'cc-oturum': return 'Claude Code';
    case 'cc-is': return 'Arka plan işi';
    case 'gorev': return TERIM.gorev;
    case 'surec': return 'Arka plan';
    case 'toplanti': return 'Toplantı';
    default: return 'Fuber';
  }
}

/** Paralel yardımcıların tonu: kipin vurgusundan sıraya göre ton kayması (derece; CSS `oklch(from var(--vurgu) l c calc(h + ton))`). İlk yardımcı vurgunun kendisi. */
const TONLAR = [0, 52, -52, 104, -104, 156] as const;
export const yardimciTonu = (sira: number): number => TONLAR[((Math.floor(sira) % TONLAR.length) + TONLAR.length) % TONLAR.length];

/** Ray noktaları: aktif işin sayfası → 'canli' (nefes) ya da yalnız sürekli iş varsa 'surekli' (durağan). */
export function rayNoktalari(l: readonly IsKaydi[]): Partial<Record<IsSayfasi, 'canli' | 'surekli'>> {
  const r: Partial<Record<IsSayfasi, 'canli' | 'surekli'>> = {};
  for (const x of l) {
    if (!aktifMi(x.hal)) continue;
    if (!x.surekli) r[x.nerede.sayfa] = 'canli';
    else if (!r[x.nerede.sayfa]) r[x.nerede.sayfa] = 'surekli';
  }
  return r;
}

/** Satırın ikinci satırı: "<yer> · <süre> · <N adım>". */
export function isAltMetni(is: IsKaydi, simdi: number): string {
  const son = aktifMi(is.hal) ? simdi : (is.bitis ?? simdi);
  const adim = is.ilerleme?.adim;
  return [is.nerede.ad, isSuresi(son - is.baslangic), aktifMi(is.hal) && adim ? `${adim} adım` : ''].filter(Boolean).join(' · ');
}

/** Hepsi biten yardımcıların tek satırı: "3 yardımcı · 14 adım · 42 sn". */
export function yardimciOzeti(c: readonly IsKaydi[]): string {
  if (!c.length) return '';
  const adim = c.reduce((n, x) => n + (x.ilerleme?.adim ?? 0), 0);
  const bas = Math.min(...c.map((x) => x.baslangic));
  const son = Math.max(...c.map((x) => x.bitis ?? x.baslangic));
  return [`${c.length} yardımcı`, adim ? `${adim} adım` : '', isSuresi(son - bas)].filter(Boolean).join(' · ');
}

/** Kokpit ve Etkinlik "Şu an": üst işler (sıralı) ve her birinin çocukları (sırayla). Üstü listede olmayan çocuk kendi başına üst sayılır. */
export function ustGruplari(l: readonly IsKaydi[]): { is: IsKaydi; cocuklar: IsKaydi[] }[] {
  const kimlikler = new Set(l.map((x) => x.id));
  const ust = isleriSirala(l.filter((x) => !x.ust || !kimlikler.has(x.ust)));
  return ust.map((u) => ({ is: u, cocuklar: l.filter((c) => c.ust === u.id).sort((a, b) => (a.sira ?? 0) - (b.sira ?? 0) || a.baslangic - b.baslangic) }));
}

/** Kokpit: ana sürecin listesine arayüzün elindeki süren görevleri de katar (aynı 'isler:durum' olayı; liste henüz gelmediyse görev yine görünür). Yineleme yok. */
export function gorevleriKat(l: readonly IsKaydi[], gorevler: readonly IsOzet[], simdi: Date, mod: Mod = 'is'): IsKaydi[] {
  const var_ = new Set(l.map((x) => x.id));
  const ek = gorevler.filter((g) => (g.durum === 'suruyor' || g.durum === 'onay') && !var_.has(`gorev:${g.id}`)).map((g) => gorevIsi(g, simdi, mod));
  return ek.length ? isleriSirala([...l, ...ek]) : [...l];
}

/** Bir sohbetin yardımcıları: o sohbetten verilen işler (sohbet turunun kendisi değil) ve çocukları (sırayla). */
export function sohbetYardimcilari(l: readonly IsKaydi[], sohbetId: number): { is: IsKaydi; cocuklar: IsKaydi[] }[] {
  const ust = l.filter((x) => x.sohbetId === sohbetId && x.kaynak !== 'sohbet' && !x.ust);
  return ust.map((u) => ({ is: u, cocuklar: l.filter((c) => c.ust === u.id).sort((a, b) => (a.sira ?? 0) - (b.sira ?? 0)) }));
}

/** Telefon köprüsü: YALNIZ durum. Fiil, başlık, yer adı, yol ve kimlik gitmez (içerik masada kalır). */
export interface TelefonIsi { kaynak: IsKaynagi; hal: IsHali; baslangic: number; sayfa: IsSayfasi; ilerleme?: IsIlerlemesi }
export function telefonIsOzeti(l: readonly IsKaydi[]): TelefonIsi[] {
  if (!Array.isArray(l)) return [];
  return l.map((x) => ({
    kaynak: x.kaynak, hal: x.hal, baslangic: x.baslangic, sayfa: x.nerede.sayfa,
    ...(x.ilerleme ? { ilerleme: { ...(x.ilerleme.adim !== undefined ? { adim: x.ilerleme.adim } : {}), ...(x.ilerleme.oran !== undefined ? { oran: x.ilerleme.oran } : {}) } } : {}),
  }));
}

/**
 * Bitenleri bir an tut (tik ve uçuş görünsün): önceki aktif kümeden kaybolan ya da bitmiş hâle geçen iş `BITEN_OMRU_MS` boyunca biten olarak
 * kalır. Hiç aktif görülmemiş biten iş (ör. dünün bitmiş görevi) eklenmez. `tutulan` çağrılar arası durumdur (yerinde güncellenir).
 */
export function bitenleriTut(onceki: ReadonlyMap<string, IsKaydi>, yeni: readonly IsKaydi[], tutulan: Map<string, IsKaydi>, simdi: number): IsKaydi[] {
  const yeniMap = new Map(yeni.map((x) => [x.id, x]));
  for (const [id, o] of onceki) {
    if (!aktifMi(o.hal)) continue;
    const y = yeniMap.get(id);
    if (!y) tutulan.set(id, { ...o, hal: 'bitti', bitis: simdi });
    else if (!aktifMi(y.hal)) tutulan.set(id, { ...y, bitis: y.bitis ?? simdi });
  }
  // Yeniden aktifleşen iş tutulandan çıkar; süresi dolan düşer. Üstü hâlâ süren yardımcı düşmez (grup bütün kalsın: "3 yardımcı · …" özeti).
  const aktifler = new Set(yeni.filter((x) => aktifMi(x.hal)).map((x) => x.id));
  for (const [id, t] of tutulan) {
    const y = yeniMap.get(id);
    if (y && aktifMi(y.hal)) { tutulan.delete(id); continue; }
    const son = bitenSonu(t, tutulan, aktifler);
    if (son !== null && simdi > son) tutulan.delete(id);
  }
  return [...tutulan.values()];
}

/** Biten işin listeden düşeceği an (ms); üstü sürüyorsa null (düşmez). Üstü de bittiyse ikisinin geç biteni + ömür. */
export function bitenSonu(t: IsKaydi, tutulan: ReadonlyMap<string, IsKaydi>, aktifler: ReadonlySet<string>): number | null {
  if (t.ust && aktifler.has(t.ust)) return null;
  const ust = t.ust ? tutulan.get(t.ust) : undefined;
  return Math.max(t.bitis ?? 0, ust?.bitis ?? 0) + BITEN_OMRU_MS;
}

// ── Kaynak eşlemeleri ───────────────────────────────────────────────────────────────────────────────────────────────────────
/** Sohbet turu. `ne`: süren aracın insan dilindeki satırı (shared/arac-satiri.ts) ya da boş; `adim`: atılan araç adımı. */
export function sohbetTuruIsi(t: { sohbetId: number; baslik: string; baslangic: number; adim: number; ne: string; onay: boolean }): IsKaydi {
  const ne = t.onay ? 'Onayını bekliyor' : tekSatir(t.ne, 90) || (t.adim ? 'Çalışıyor' : 'Düşünüyor');
  return {
    id: `sohbet:${t.sohbetId}`, kaynak: 'sohbet', ne, baslik: tekSatir(t.baslik, 60),
    nerede: { sayfa: 'sohbetler', yol: `sohbetler/${t.sohbetId}`, ad: tekSatir(t.baslik, 48) || 'Sohbet' },
    hal: t.onay ? 'onay' : !t.adim && !t.ne ? 'basliyor' : 'calisiyor',
    baslangic: t.baslangic, sohbetId: t.sohbetId, durdurulabilir: true,
    ...(t.adim > 0 ? { ilerleme: { adim: t.adim } } : {}),
  };
}

const saatMetni = (ms: number): string => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const zaman = (iso: string | null | undefined): number => (iso ? Date.parse(iso) : Number.NaN);

/** Arka plan görevi. Adım sürerken Çalışıyor; iki kontrol arasında Bekliyor ve sonraki kontrolün saati; süreli işte geçen süre oranı. */
export function gorevIsi(g: IsOzet, simdi: Date, mod: Mod = 'is'): IsKaydi {
  const baslik = tekSatir(g.baslik ? isGuvenliMetin(g.baslik, mod, '') ?? '' : '', 60);
  const bas = zaman(g.baslangic);
  const bitis = zaman(g.bitisZamani);
  let hal: IsHali; let ne: string;
  switch (g.durum) {
    case 'onay': hal = 'onay'; ne = 'Onayını bekliyor'; break;
    case 'suruyor': {
      if (g.adimda) { hal = 'calisiyor'; ne = 'Kontrol ediyor'; break; }
      hal = 'bekliyor';
      const s = zaman(g.sonraki);
      ne = Number.isFinite(s) ? `Bekliyor · sonraki kontrol ${saatMetni(s)}` : 'Bekliyor';
      break;
    }
    case 'bitti': hal = 'bitti'; ne = 'Bitti'; break;
    default: hal = 'olmadi'; ne = gorevSatiri(g, simdi, mod).alt || 'Durdu';
  }
  const oran = Number.isFinite(bas) && Number.isFinite(bitis) && bitis > bas ? Math.min(1, Math.max(0, (simdi.getTime() - bas) / (bitis - bas))) : undefined;
  const ilerleme: IsIlerlemesi | undefined = g.adim > 0 || oran !== undefined ? { ...(g.adim > 0 ? { adim: g.adim } : {}), ...(oran !== undefined ? { oran } : {}) } : undefined;
  return {
    id: `gorev:${g.id}`, kaynak: 'gorev', ne, baslik,
    nerede: { sayfa: 'sohbetler', yol: `sohbetler/${g.sohbetId}`, ad: baslik || TERIM.gorev },
    hal, baslangic: Number.isFinite(bas) ? bas : simdi.getTime(),
    ...(hal === 'bitti' || hal === 'olmadi' ? { bitis: Number.isFinite(bitis) ? bitis : simdi.getTime() } : {}),
    ...(ilerleme ? { ilerleme } : {}),
    durdurulabilir: hal === 'calisiyor' || hal === 'bekliyor',
  };
}

/** Sohbetin arka plan süreci (dev sunucusu, izleyici): sürekli iş. */
export function surecIsi(s: SurecOzeti): IsKaydi {
  const hal: IsHali = s.durum === 'calisiyor' || s.durum === 'durduruluyor' ? 'calisiyor' : s.durum === 'bitti' ? 'bitti' : 'olmadi';
  const sohbet = typeof s.sohbetId === 'number';
  return {
    id: `surec:${s.kimlik}`, kaynak: 'surec', ne: s.durum === 'durduruluyor' ? 'Durduruluyor' : hal === 'calisiyor' ? 'Arka planda çalışıyor' : hal === 'bitti' ? 'Bitti' : 'Durdu',
    baslik: tekSatir(s.komut, 40),
    nerede: sohbet ? { sayfa: 'sohbetler', yol: `sohbetler/${s.sohbetId}`, ad: 'Sohbet' } : { sayfa: 'kokpit', yol: 'kokpit', ad: 'Kokpit' },
    hal, baslangic: s.baslangic, ...(s.bitis ? { bitis: s.bitis } : {}),
    ...(sohbet ? { sohbetId: s.sohbetId } : {}), surekli: true, durdurulabilir: hal === 'calisiyor',
  };
}

/** Claude Code araç tipinin fiili (+ nesne): "Okuyor · Kartlar.tsx", "Arıyor · “width”", "Komut çalıştırıyor · npm test". */
export function ccAracFiili(a: { tip: CcAracTipi; ad: string; ozet: string }): string {
  const o = String(a.ozet ?? '');
  switch (a.tip) {
    case 'okuma': return dosyaAdi(o) ? `Okuyor · ${tekSatir(dosyaAdi(o), 32)}` : 'Okuyor';
    case 'duzenleme': return dosyaAdi(o) ? `Düzenliyor · ${tekSatir(dosyaAdi(o), 32)}` : 'Düzenliyor';
    case 'arama': { const a = o.replace(/[“”"]/g, '').trim(); return a ? `Arıyor · ${tekSatir(a, 32)}` : 'Arıyor'; }
    case 'kabuk': return o.trim() ? `Komut çalıştırıyor · ${tekSatir(o, 26)}` : 'Komut çalıştırıyor';
    case 'web': return "Web'de arıyor";
    case 'mcp': return 'Bağlantı kullanıyor';
    case 'alt-ajan': return 'Yardımcı başlatıyor';
    case 'yapilacaklar': case 'plan': return 'Plan yapıyor';
    case 'soru': return 'Soru soruyor';
    default: return 'Çalışıyor';
  }
}

/** Alt ajan türünün insan dilindeki adı: genel amaçlı olan için çip yok (''), bilinenler Türkçe, bilinmeyen okunur ad. */
const AJAN_TIPI: Record<string, string> = { 'general-purpose': '', explore: 'Keşif', plan: 'Planlama', 'statusline-setup': 'Durum satırı', 'output-style-setup': 'Çıktı biçimi' };
export function ccAjanTipiAdi(t: string | undefined | null): string {
  const k = String(t ?? '').trim();
  if (!k) return '';
  const bilinen = AJAN_TIPI[k.toLowerCase()];
  if (bilinen !== undefined) return bilinen;
  const okunur = k.replace(/[:_-]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  return okunur ? okunur[0].toLocaleUpperCase('tr') + okunur.slice(1) : '';
}

type CcYeri = Pick<CcOturumOzeti, 'id' | 'kimlik' | 'proje' | 'sohbetId'>;
const ccYeri = (o: CcYeri): IsYeri => ({ sayfa: 'claude', yol: ccOturumYolu(o.id, o.kimlik), ad: tekSatir(o.proje, 40) || 'Claude Code' });

/** Claude Code oturumu. `sonArac`: oturumun (üst düzey) son süren aracı (fiil için). */
export function ccOturumIsi(o: CcOturumOzeti, sonArac?: { tip: CcAracTipi; ad: string; ozet: string } | null): IsKaydi {
  let hal: IsHali; let ne: string;
  switch (o.durum) {
    case 'sirada': hal = 'sirada'; ne = o.siraNo ? `Sırada · ${o.siraNo}.` : 'Sırada'; break;
    case 'izin': hal = 'onay'; ne = 'İznini bekliyor'; break;
    case 'calisiyor': hal = 'calisiyor'; ne = sonArac ? ccAracFiili(sonArac) : 'Çalışıyor'; break;
    case 'bosta': hal = o.arkaPlan > 0 ? 'calisiyor' : 'bitti'; ne = o.arkaPlan > 0 ? 'Arka planda sürüyor' : 'Bitti'; break;
    case 'hata': hal = 'olmadi'; ne = 'Hata verdi'; break;
    default: hal = 'bitti'; ne = 'Kapandı';
  }
  if (hal === 'calisiyor' && o.bekleyenIzin > 0) { hal = 'onay'; ne = 'İznini bekliyor'; }
  return {
    id: `cc:${o.id}`, kaynak: 'cc-oturum', ne, baslik: tekSatir(o.baslik, 60), nerede: ccYeri(o), hal, baslangic: o.olusturma,
    ...(typeof o.sohbetId === 'number' ? { sohbetId: o.sohbetId } : {}),
    durdurulabilir: hal === 'calisiyor' || hal === 'onay',
  };
}

/** Alt ajanın kendi görünümü (ana süreçte olaylardan, Claude Code sayfasında dökümden kurulur — iki yer aynı eşlemeyi kullanır). */
export interface CcAltAjanGirdisi {
  id: string; aciklama: string; ajanTipi?: string;
  durum: 'calisiyor' | 'tamam' | 'hata' | 'kesildi';
  baslangic: number; bitis?: number;
  /** İçindeki adımlar (sırayla). */
  cocuklar: { id?: string; tip: CcAracTipi; ad: string; ozet: string; durum: 'calisiyor' | 'tamam' | 'hata' | 'kesildi' }[];
  /** İçindeki bir adım izin bekliyor. */
  izinde?: boolean;
}

export function ccAltAjanIsi(a: CcAltAjanGirdisi, o: CcYeri, sira: number): IsKaydi {
  const suren = [...a.cocuklar].reverse().find((c) => c.durum === 'calisiyor');
  const son = suren ?? a.cocuklar.at(-1);
  let hal: IsHali;
  if (a.durum === 'tamam') hal = 'bitti';
  else if (a.durum !== 'calisiyor') hal = 'olmadi';
  else if (a.izinde) hal = 'onay';
  else hal = a.cocuklar.length ? 'calisiyor' : 'basliyor';
  const ne = hal === 'onay' ? 'İznini bekliyor' : hal === 'bitti' ? 'Bitti' : hal === 'olmadi' ? 'Durdu' : son ? ccAracFiili(son) : 'Başlıyor';
  return {
    id: `cc:${o.id}:${a.id}`, kaynak: 'cc-ajan', ne, baslik: tekSatir(a.aciklama, 60) || 'Yardımcı', nerede: ccYeri(o), hal,
    baslangic: a.baslangic, ...(a.bitis ? { bitis: a.bitis } : {}), ust: `cc:${o.id}`, sira,
    ...(a.cocuklar.length ? { ilerleme: { adim: a.cocuklar.length } } : {}),
  };
}

const ARKA_IS_FIILI: Record<CcArkaIs['tip'], string> = { kabuk: 'Komut çalıştırıyor', izleyici: 'İzliyor', ajan: 'Yardımcı çalışıyor', diger: 'Çalışıyor' };
export function ccArkaIsIsi(i: CcArkaIs, o: CcYeri): IsKaydi {
  const hal: IsHali = i.durum === 'suruyor' ? 'calisiyor' : i.durum === 'bitti' ? 'bitti' : 'olmadi';
  return {
    id: `cc:${o.id}:is:${i.id}`, kaynak: 'cc-is', ne: hal === 'calisiyor' ? ARKA_IS_FIILI[i.tip] : hal === 'bitti' ? 'Bitti' : 'Durdu',
    baslik: tekSatir(i.aciklama, 60), nerede: ccYeri(o), hal, baslangic: i.baslangic, ...(i.bitis ? { bitis: i.bitis } : {}), ust: `cc:${o.id}`,
    durdurulabilir: hal === 'calisiyor',
  };
}
