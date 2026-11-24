// ── Ayarlar araması ve çapa çözümü (saf; birim testli: tests/ayar-arama.test.ts) ──────────────────────────────────────
// Ayarlar içinde aramak kolay olmalı. Ayar adı/açıklaması/anahtar sözcükleri ile kategori ve grup adlarında arar;
// sonuç kategori adıyla döner (Ayarlar kabuğu tıklayınca o kategoriye gider, akordeonu açar, ayarı vurgular).
// - Harf katlama: Türkçe büyük/küçük (İ/ı) ve işaretler (ç ğ ı ö ş ü) katlanır; noktalama boşluk olur. Katlanmış metin özgünle
//   AYNI uzunluktadır: eşleşme aralıkları özgün metinde doğrudan vurgulanır.
// - Her sorgu sözcüğü bir yerde eşleşmeli (VE). Puan: tam sözcük > sözcük başı > kök (Türkçe ek: "mikrofonu" → "mikrofon") >
//   sözcük içi (3+ harf); alan ağırlığı ad > anahtar sözcük > grup adı > açıklama > kategori adı. Eşit puanda dizin sırası.
// - Mod: geliştirici işaretli kategori/grup/ayar İş modunda dizine girmez (K2); `aciklamaIs` İş modunda açıklamanın yerini alır
//   (grup başlığı için `baslikIs`, Ruling O; ayar adı için `adIs`, 0.10 Görev 3).
// Arayüzdeki seçici (bilesenler/Secici.tsx) de aynı katlamayla süzer.
import type { Mod } from './tipler.ts';
import { acilYerlestir, ACIL_DURDURMA_METNI } from './genel-kisayol.ts';

export interface AyarTanimi {
  id: string;
  ad: string;
  /** İş modunda gösterilen ad (0.10 Görev 3, P2 sözlüğü: "Yerel model" → "Bu bilgisayardaki yapay zekâ"); yoksa `ad`. */
  adIs?: string;
  aciklama?: string;
  /** İş modunda gösterilen açıklama (teknik sözcüksüz); yoksa `aciklama`. */
  aciklamaIs?: string;
  /** Görünmeyen arama sözcükleri (eş anlamlılar). */
  anahtar?: readonly string[];
  /** İş modundaki arama sözcükleri (sağlayıcı ve teknik adlar olmadan); yoksa `anahtar`. */
  anahtarIs?: readonly string[];
  /** Yalnız Geliştirici modunda (K2). */
  gelistirici?: boolean;
}
/** `baslikIs` / `aciklamaIs`: İş modunda gösterilen başlık ve açıklama (teknik ya da Geliştirici'ye özgü sözcüksüz); yoksa asılları. */
export interface GrupTanimi { id: string; baslik: string; baslikIs?: string; aciklama?: string; aciklamaIs?: string; gelistirici?: boolean; ayarlar: readonly AyarTanimi[] }
/** `isDiliIstisna` (5 Kas): İş dili taramasında sağlayıcı adı ve "anahtar" bu kategoride serbest — yalnız 'motor' (Business'ın "Kendi Claude anahtarım"
 *  satırı; Business kullanıcıları da kendi API anahtarını kullanabilir). Öteki kategoriler taranmaya devam eder. */
export interface KategoriTanimi { id: string; ad: string; aciklama: string; aciklamaIs?: string; gelistirici?: boolean; isDiliIstisna?: boolean; gruplar: readonly GrupTanimi[] }

/** Moda göre görünen metin: İş modunda `…Is` alanı varsa o (Ruling O: aynı ayar İş'te sade, Geliştirici'de ayrıntılı). */
export const modaGore = (mod: Mod, asil: string, is?: string): string => (mod === 'is' && is) || asil;

export interface AramaKaydi {
  id: string; ad: string; aciklama: string; anahtar: readonly string[];
  kategori: string; kategoriAd: string; grup: string; grupAd: string;
}
export interface AramaSonucu { kayit: AramaKaydi; puan: number }
export interface CipaHedefi { kategori: string; grup?: string; ayar?: string }
/** Eski çapalar ('#motorlar' …): her mod için ayrı hedef ya da ikisinde aynı hedef ('kategori' | 'kategori/grup' | ayar kimliği). */
export type EskiCipalar = Readonly<Record<string, string | Readonly<Partial<Record<Mod, string>>>>>;

export const gorunurMu = (x: { gelistirici?: boolean }, mod: Mod) => !x.gelistirici || mod === 'gelistirici';

const ISARETSIZ: Record<string, string> = {
  ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u',
  á: 'a', à: 'a', ä: 'a', é: 'e', è: 'e', ê: 'e', í: 'i', ó: 'o', ò: 'o', ô: 'o', ú: 'u', ù: 'u',
};

/** Arama için katlanmış metin: küçük harf (Türkçe), işaretsiz, harf/rakam dışı her karakter boşluk; uzunluk korunur. */
export function katla(s: string): string {
  let o = '';
  for (let i = 0; i < s.length; i++) {
    const k = s[i];
    let c = k.toLocaleLowerCase('tr');
    if (c.length !== 1) c = k.toLowerCase();
    if (c.length !== 1) { o += ' '; continue; }
    c = ISARETSIZ[c] ?? c;
    o += (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') ? c : ' ';
  }
  return o;
}

const sozcukler = (s: string) => katla(s).split(' ').filter(Boolean);
const sozcukBasi = (f: string, i: number) => i === 0 || f[i - 1] === ' ';

/** Türkçe ek için kök adayları (uzundan kısaya): 5+ harfli sözcükten sondan harf düşülür; kök en az 4 harf ve sözcüğün en az
 *  yarısı ("özetleri" → "özet", "mikrofonlarını" → "mikrofo…"). */
function kokler(t: string): string[] {
  const l: string[] = [];
  if (t.length < 5) return l;
  for (let n = t.length - 1; n >= Math.max(4, Math.ceil(t.length / 2)); n--) l.push(t.slice(0, n));
  return l;
}

/** Katlanmış alan `f` içinde `t` sözcüğünün puanı (0–1). */
function sozcukPuani(f: string, t: string): number {
  let en = 0;
  for (let i = f.indexOf(t); i !== -1; i = f.indexOf(t, i + 1)) {
    const bas = sozcukBasi(f, i);
    const tam = bas && (i + t.length === f.length || f[i + t.length] === ' ');
    const p = tam ? 1 : bas ? 0.8 : t.length >= 3 ? 0.4 : 0;
    if (p > en) en = p;
    if (en === 1) return 1;
  }
  if (en > 0) return en;
  for (const k of kokler(t)) {
    for (let i = f.indexOf(k); i !== -1; i = f.indexOf(k, i + 1)) if (sozcukBasi(f, i)) return 0.6;
  }
  return 0;
}

/** Kategorilerden arama dizini (moda göre süzülmüş, düz liste). */
export function dizinKur(kategoriler: readonly KategoriTanimi[], mod: Mod): AramaKaydi[] {
  const l: AramaKaydi[] = [];
  for (const k of kategoriler) {
    if (!gorunurMu(k, mod)) continue;
    for (const g of k.gruplar) {
      if (!gorunurMu(g, mod)) continue;
      for (const a of g.ayarlar) {
        if (!gorunurMu(a, mod)) continue;
        l.push({
          id: a.id, ad: modaGore(mod, a.ad, a.adIs), aciklama: (mod === 'is' && a.aciklamaIs) || a.aciklama || '', anahtar: (mod === 'is' && a.anahtarIs) || a.anahtar || [],
          kategori: k.id, kategoriAd: k.ad, grup: g.id, grupAd: modaGore(mod, g.baslik, g.baslikIs),
        });
      }
    }
  }
  return l;
}

/** Arama yapılacak kadar sorgu var mı (en az 2 harf/rakam): ayarAra ile arama görünümü aynı eşiği kullanır. */
export const aramaYeterli = (sorgu: string) => sozcukler(sorgu).join('').length >= 2;

/** Sorgu en az 2 harf (aramaYeterli); sonuçlar puana göre (eşitte dizin sırası), en çok `sinir` tane. */
export function ayarAra(dizin: readonly AramaKaydi[], sorgu: string, sinir = 40): AramaSonucu[] {
  if (!aramaYeterli(sorgu)) return [];
  const t = sozcukler(sorgu);
  const sonuc: (AramaSonucu & { sira: number })[] = [];
  dizin.forEach((k, sira) => {
    // Açıklamadaki acil durdurma yer tutucusu (B8) varsayılan tuşla aranır: "alt shift q" ya da "acil durdurma" bulur.
    const alanlar: [string, number][] = [
      [katla(k.ad), 10], [katla(k.anahtar.join(' · ')), 8], [katla(k.grupAd), 4], [katla(acilYerlestir(k.aciklama, ACIL_DURDURMA_METNI)), 3], [katla(k.kategoriAd), 2],
    ];
    let toplam = 0;
    for (const s of t) {
      let en = 0;
      for (const [f, agirlik] of alanlar) en = Math.max(en, sozcukPuani(f, s) * agirlik);
      if (en === 0) return;
      toplam += en;
    }
    sonuc.push({ kayit: k, puan: toplam, sira });
  });
  return sonuc.sort((a, b) => b.puan - a.puan || a.sira - b.sira).slice(0, sinir).map(({ kayit, puan }) => ({ kayit, puan }));
}

/** `metin` içinde sorgu sözcüklerinin geçtiği aralıklar [başlangıç, bitiş) — birleşik, sıralı. Vurgu (<mark>) için. */
export function eslesmeAraliklari(metin: string, sorgu: string): [number, number][] {
  const f = katla(metin);
  const ar: [number, number][] = [];
  for (const t of sozcukler(sorgu)) {
    let bulundu = false;
    for (let i = f.indexOf(t); i !== -1; i = f.indexOf(t, i + 1)) {
      if (sozcukBasi(f, i) || t.length >= 3) { ar.push([i, i + t.length]); bulundu = true; }
    }
    if (bulundu) continue;
    for (const k of kokler(t)) {
      for (let i = f.indexOf(k); i !== -1; i = f.indexOf(k, i + 1)) if (sozcukBasi(f, i)) { ar.push([i, i + k.length]); bulundu = true; }
      if (bulundu) break;
    }
  }
  ar.sort((a, b) => a[0] - b[0]);
  const birlesik: [number, number][] = [];
  for (const [b, s] of ar) {
    const son = birlesik[birlesik.length - 1];
    if (son && b <= son[1]) son[1] = Math.max(son[1], s);
    else birlesik.push([b, s]);
  }
  return birlesik;
}

/** Çapa → hedef. Sıra: eski çapa (moda göre) → 'kategori' / 'kategori/grup' → ayar kimliği. Görünmeyen (İş modunda geliştirici)
 *  hedef ve tanınmayan çapa null döner (başka sayfanın çapası olabilir: çağıran ona dokunmaz). */
export function cipaCoz(cipa: string, kategoriler: readonly KategoriTanimi[], mod: Mod, eskiler: EskiCipalar = {}): CipaHedefi | null {
  let c = cipa.replace(/^#/, '').trim();
  try { c = decodeURIComponent(c); } catch { /* bozuk kodlama: olduğu gibi */ }
  if (!c) return null;
  const eski = Object.hasOwn(eskiler, c) ? eskiler[c] : undefined;
  if (eski !== undefined) {
    const hedef = typeof eski === 'string' ? eski : eski[mod];
    return hedef && hedef !== c ? cipaCoz(hedef, kategoriler, mod) : null;
  }
  const [kId, gId] = c.split('/');
  const k = kategoriler.find((x) => x.id === kId);
  if (k) {
    if (!gorunurMu(k, mod)) return null;
    const g = gId ? k.gruplar.find((x) => x.id === gId && gorunurMu(x, mod)) : undefined;
    return g ? { kategori: k.id, grup: g.id } : { kategori: k.id };
  }
  for (const kat of kategoriler) {
    if (!gorunurMu(kat, mod)) continue;
    for (const g of kat.gruplar) {
      if (!gorunurMu(g, mod)) continue;
      const a = g.ayarlar.find((x) => x.id === c);
      if (a) return gorunurMu(a, mod) ? { kategori: kat.id, grup: g.id, ayar: a.id } : null;
    }
  }
  return null;
}
