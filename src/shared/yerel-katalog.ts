// ── Yerel model kataloğu: bu bilgisayara uygunluk, neden, Önerilen (0.12 H3c; saf, birim testli: tests/yerel-katalog.test.ts) ─────────────────
// Ana sistem tamamen yerel modellerle de çalışabilmeli. Kurulumun "Nerede çalışsın" adımı
// ve Ayarlar → Gizlilik aynı kartları çizer (renderer/bilesenler/NeredeSecimi.tsx → ui/fintech/ModelKarti.tsx). Her kart: ad (İş'te "Büyük /
// Orta / Hafif sürüm", Geliştirici'de paket adı), tek satır, boyut (GB; ilk kurulumda çalıştırıcı ve ses payıyla — yerel-boyut.ts ile aynı
// sayı), tahmini indirme süresi (50 Mbit/sn varsayımıyla, "≈"), bu bilgisayara uygunluk.
// Uygunluk GERÇEK donanımdan (sistem:kontrol: toplam bellek, varsa ekran kartı belleği, boş disk) — model-bilgisi.ts yerelUygunluk ile aynı
// eşikler (paketler.ts ramGB/vramGB); disk burada indirilecek toplamla (+1 GB kurulum payı) ölçülür (yerelOnerisi ile aynı). Kararlar:
//  · Uymayan (diske ya da belleğe sığmayan) kart SEÇİLEMEZ ve nedeni gerçek sayıyla yazar: "Bu bilgisayarda 8 GB bellek var, bu sürüm 16 GB
//    ister." İş dilinde "model" yok ("sürüm"); Geliştirici'de "model".
//  · Belleğe sığan ama ekran kartında çalışamayan kart seçilebilir, "yavaş" diye dürüstçe söyler.
//  · Önerilen = uyanların en iyisi: büyükten küçüğe ilk "hızlı/rahat" çalışan; hiçbiri yoksa yavaş çalışanların en hafifi. Kurulu ve uyan
//    sürüm varsa o seçili gelir (yeniden inmez: varsayilanModel).
//  · Donanım okunamadıysa TUTUCU: hiçbir kart önerilmez ve seçilemez (ölçülmemiş şey söylenmez — I1); okunurken de seçim yok. Düzeltme turu 1
//    (Kü1): yalnız boş disk okunamadıysa da tutucu — kurulu olmayan sürüm "Disk ölçülemedi" (eskiden sınırsız sayılıyordu).
//  · Ö3: inmekte olan sürüm (`inen`) diske yeniden ölçülmez — kendi yarım dosyası boş yeri azaltır; bellek yine ölçülür.
//  · Ö2: ana süreç de aynı kuralla reddeder (kurulumUygunlugu; main/yerel/uygunluk.ts → ipc.ts yerel:kur).
//  · 0.13 G: liste sunucudan gelir (main/yerel/katalog.ts); kartlar katalogdaki sırayla, Önerilen yine büyükten küçüğe. Business özeti, Developer teknik adı ve dosyayı görür. Listeden
//    kalkan kurulu model seçilebilir ve çalışır, kartı söyler, önerilmez. Kurulu dosya kayıttan eskiyse (`eskiSurum`) çalışır, kartı söyler. Sunulan model yoksa `bos`: "Şu an sunulan model yok."
import { KURULUM_PAYI_GB, gbMetni, yerelMakinesi, yerelUygunluk } from './model-bilgisi.ts';
import { ILK_KURULUM_PAYI, yerelEtiketi } from './yerel-boyut.ts';
import type { YerelModelAdi } from './tipler.ts';

/** Tahmini indirme süresinin varsaydığı bağlantı (Mbit/sn). Kartın altındaki not bunu söyler. */
export const INDIRME_HIZI_MBIT = 50;
export const SURE_NOTU = `Süreler ${INDIRME_HIZI_MBIT} Mbit/sn bağlantıya göre yaklaşık; indirme arka planda sürer.`;

/** yerel:durum modelinin (main/yerel/durum.ts) kataloğun okuduğu alanları. */
export interface KatalogModeli { ad: YerelModelAdi; etiket: string; aciklama: string; ozet?: string; dosya?: string; boyut: number; ramGB: number; vramGB?: number; kurulu: boolean; listedenKalkti?: boolean; eskiSurum?: boolean }
export interface KatalogDonanimi { ramGB: number; nvidia: boolean; vramGB?: number; bosDiskGB?: number }
export interface KatalogGirdisi {
  /** sistem:kontrol: null = okunuyor; 'hata' = okunamadı (ya da ~10 sn'de yanıt yok). */
  donanim: KatalogDonanimi | null | 'hata';
  modeller: readonly KatalogModeli[];
  /** Çalıştırıcı kurulu: yalnız model iner (boyut payı yok). */
  calistiriciKurulu: boolean;
  /** Çalıştırıcı CUDA'lı kurulu mu (kurulu ve CUDA'sızsa ekran kartı kullanılamaz; yerelMakinesi). */
  cuda?: boolean;
  /** Ayarlar'da "Yalnız işlemci". */
  islemciZorla?: boolean;
  /** İş modu: paket adı ve "model" sözcüğü yok. */
  sade: boolean;
  /** Ö3: şu an inen sürüm — diske yeniden ölçülmez (yarım dosyası zaten diskte). */
  inen?: YerelModelAdi | null;
}
/** hizli: ekran kartında · rahat: işlemcide rahat · yavas: belleğe sığar ama ekran kartında çalışamaz. */
export type KatalogHizi = 'hizli' | 'rahat' | 'yavas';
export interface KatalogKarti {
  ad: YerelModelAdi;
  baslik: string;
  aciklama: string;
  /** İndirilecek GB (bir ondalık); kuruluysa 0. */
  indirGB: number;
  boyutMetni: string;
  /** "≈ 5 dk" ya da "Kurulu". */
  sureMetni: string;
  kurulu: boolean;
  /** Seçilebilir mi (uymayan seçilemez). */
  uygun: boolean;
  hiz: KatalogHizi | null;
  /** Uygunluğun tek satırı ("Ekran kartında hızlı çalışır", "Uygun ekran kartı yok; işlemcide yavaş çalışır", "Uymuyor"). */
  uygunlukMetni: string;
  /** Uymuyorsa nedeni (gerçek sayıyla); uyuyorsa null. */
  neden: string | null;
  onerilen: boolean;
  /** Yalnız Geliştirici: disk, bellek ve ekran kartı gereksinimi. */
  ayrinti?: string;
  /** Yalnız Geliştirici: Hugging Face'teki dosya adı. */
  dosya?: string;
  /** Katalogdan kapatıldı, bu bilgisayarda kurulu kaldı. */
  listedenKalkti?: boolean;
  /** Kurulu dosya kayıttakinden eski: çalışır, yenisi indirilebilir. */
  eskiSurum?: boolean;
}
export interface YerelKatalog {
  durum: 'bekliyor' | 'olculdu' | 'okunamadi';
  kartlar: KatalogKarti[];
  onerilen: YerelModelAdi | null;
  /** Hiçbiri uymuyorsa genel neden (en hafif sürümünki; sunulan yoksa KATALOG_BOS); değilse null. */
  neden: string | null;
  /** Sunulan model yok (listeden kalkan kurulu model olabilir). */
  bos: boolean;
}

const gbBir = (bayt: number) => Math.round(bayt / 1e8) / 10;
const gbYaz = (gb: number) => `${gb.toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} GB`;

/** "≈ 5 dk" · "≈ 1 sa 47 dk" (en az 1 dk). */
export function indirmeSuresi(bayt: number, mbit = INDIRME_HIZI_MBIT): string {
  const dk = Math.max(1, Math.round((bayt * 8) / (mbit * 1e6) / 60));
  const s = Math.floor(dk / 60), d = dk % 60;
  return `≈ ${s ? (d ? `${s} sa ${d} dk` : `${s} sa`) : `${d} dk`}`;
}

export const KATALOG_OLCULEMEDI = 'Bu bilgisayar ölçülemedi; uyup uymadığını bilemiyorum.';
/** 0.13 G: sunucu boş liste döndü (arıza değil: arızada önbellek ya da Bonsai üçlüsü durur). */
export const KATALOG_BOS = 'Şu an sunulan model yok.';
export const KATALOG_KALKTI = 'Kuruldu, listeden kalktı';
export const KATALOG_ESKI = 'Kurulu; yenisi var';

export function yerelKatalog(g: KatalogGirdisi): YerelKatalog {
  const l = [...g.modeller].sort((a, b) => b.boyut - a.boyut);
  const bos = !g.modeller.some((m) => !m.listedenKalkti);
  const bu = g.sade ? 'bu sürüm' : 'bu model';
  const indir = (m: KatalogModeli) => (m.kurulu ? 0 : gbBir(m.boyut + (g.calistiriciKurulu ? 0 : ILK_KURULUM_PAYI)));
  const temel = (m: KatalogModeli) => {
    const indirGB = indir(m);
    return {
      ad: m.ad, baslik: g.sade ? yerelEtiketi(m.ad, l) : m.etiket, aciklama: m.ozet ?? m.aciklama, indirGB, kurulu: m.kurulu,
      boyutMetni: gbYaz(m.kurulu ? gbBir(m.boyut) : indirGB), sureMetni: m.kurulu ? (m.listedenKalkti ? KATALOG_KALKTI : m.eskiSurum ? KATALOG_ESKI : 'Kurulu') : indirmeSuresi(indirGB * 1e9),
      ...(g.sade ? {} : { ayrinti: `${gbYaz(gbBir(m.boyut))} disk · ${gbMetni(m.ramGB)} bellek · ${m.vramGB !== undefined ? `ekran kartı ${gbMetni(m.vramGB)}` : 'ekran kartı gerekmez'}`, ...(m.dosya ? { dosya: m.dosya } : {}) }),
      ...(m.listedenKalkti ? { listedenKalkti: true } : {}),
      ...(m.eskiSurum ? { eskiSurum: true } : {}),
    };
  };
  if (g.donanim === null || g.donanim === 'hata') {
    // Ölçülmeden hiçbir şey önerilmez ve indirilmez (tutucu). Zaten KURULU sürüm ölçüm istemez: bu bilgisayarda çalışmış olandır (seçilebilir;
    // kurulumOnerisi ile aynı kural).
    const okunamadi = g.donanim === 'hata';
    return {
      durum: okunamadi ? 'okunamadi' : 'bekliyor', onerilen: null, neden: okunamadi ? KATALOG_OLCULEMEDI : null, bos,
      kartlar: g.modeller.map((m) => (m.kurulu
        ? { ...temel(m), uygun: true, hiz: null, onerilen: false, uygunlukMetni: 'Bu bilgisayarda kurulu', neden: null }
        : { ...temel(m), uygun: false, hiz: null, onerilen: false, uygunlukMetni: okunamadi ? 'Ölçülemedi' : 'Bakılıyor…', neden: okunamadi ? KATALOG_OLCULEMEDI : null })),
    };
  }
  const d = g.donanim;
  // Kü1: boş disk okunamadıysa (yok, NaN) sınırsız sayılmaz — kurulu olmayan sürüm seçilemez.
  const disk = typeof d.bosDiskGB === 'number' && Number.isFinite(d.bosDiskGB) ? d.bosDiskGB : null;
  // Ekran kartı yalnız gerçekten kullanılabiliyorsa sayılır ("Yalnız işlemci", CUDA'sız çalıştırıcı); disk burada ayrıca ölçülür.
  const makine = yerelMakinesi({ ramGB: d.ramGB, nvidia: d.nvidia, ...(d.vramGB !== undefined ? { vramGB: d.vramGB } : {}) },
    { gpu: g.islemciZorla ? 'cpu' : 'otomatik', calistiriciKurulu: g.calistiriciKurulu, cuda: g.cuda !== false });
  const kartlar: KatalogKarti[] = g.modeller.map((m) => {
    const t = temel(m);
    const gerekli = t.indirGB + KURULUM_PAYI_GB;
    if (!m.kurulu && m.ad !== g.inen && disk === null) {
      return { ...t, uygun: false, hiz: null, onerilen: false, uygunlukMetni: 'Disk ölçülemedi', neden: `Diskteki boş yer ölçülemedi; ${bu} ${gbMetni(gerekli)} ister.` };
    }
    if (!m.kurulu && m.ad !== g.inen && disk !== null && disk < gerekli) {
      return { ...t, uygun: false, hiz: null, onerilen: false, uygunlukMetni: 'Uymuyor', neden: `Diskte ${gbMetni(disk)} boş yer var, ${bu} ${gbMetni(gerekli)} ister.` };
    }
    const u = yerelUygunluk({ boyutGB: m.boyut / 1e9, ramGB: m.ramGB, ...(m.vramGB !== undefined ? { vramGB: m.vramGB } : {}) }, makine, { kurulu: m.kurulu });
    if (u.durum === 'calismaz') {
      const kart = makine.nvidia && makine.vramGB !== undefined && m.vramGB !== undefined ? ` Ekran kartında ${gbMetni(makine.vramGB)} var, ${gbMetni(m.vramGB)} gerekir.` : '';
      return { ...t, uygun: false, hiz: null, onerilen: false, uygunlukMetni: 'Uymuyor', neden: `Bu bilgisayarda ${gbMetni(d.ramGB)} bellek var, ${bu} ${gbMetni(m.ramGB)} ister.${kart}` };
    }
    if (u.durum === 'zorlanir') return { ...t, uygun: true, hiz: 'yavas', onerilen: false, uygunlukMetni: u.neden, neden: null };
    const hizli = m.vramGB !== undefined && makine.nvidia && makine.vramGB !== undefined && makine.vramGB >= m.vramGB;
    return { ...t, uygun: true, hiz: hizli ? 'hizli' : 'rahat', onerilen: false, uygunlukMetni: hizli ? 'Ekran kartında hızlı çalışır' : 'Bu bilgisayarda rahat çalışır', neden: null };
  });
  // Önerilen büyükten küçüğe aranır, listeden kalkan önerilmez.
  const boyutla = l.filter((m) => !m.listedenKalkti).map((m) => kartlar.find((k) => k.ad === m.ad)!);
  const enIyi = boyutla.find((k) => k.hiz === 'hizli' || k.hiz === 'rahat') ?? [...boyutla].reverse().find((k) => k.hiz === 'yavas');
  if (enIyi) enIyi.onerilen = true;
  const hicbiri = !kartlar.some((k) => k.uygun);
  return { durum: 'olculdu', kartlar, onerilen: enIyi?.ad ?? null, bos, neden: hicbiri ? (boyutla[boyutla.length - 1]?.neden ?? (bos ? KATALOG_BOS : null)) : null };
}

/** Seçili gelecek sürüm: kurulu ve uyan varsa o (yeniden inmez), yoksa Önerilen; hiçbiri yoksa null. */
export function varsayilanModel(k: YerelKatalog): YerelModelAdi | null {
  return k.kartlar.find((x) => x.kurulu && x.uygun)?.ad ?? k.onerilen;
}

/** Ö2 (düzeltme turu 1): bu sürüm kurulabilir mi — arayüzün kartıyla AYNI karar (ana süreç reddederken de bu kullanılır). Ölçülemeyen
 *  bilgisayarda tutucu: yalnız kurulu sürüm. */
export function kurulumUygunlugu(k: YerelKatalog, ad: YerelModelAdi): { uygun: boolean; neden: string | null } {
  const kart = k.kartlar.find((x) => x.ad === ad);
  if (!kart) return { uygun: false, neden: 'Bu sürüm bu bilgisayar için bulunamadı.' };
  return kart.uygun ? { uygun: true, neden: null } : { uygun: false, neden: kart.neden ?? KATALOG_OLCULEMEDI };
}

/** Düzeltme turu 2: kurulumda yerel seçim hazırlanamadığında Hazırsın'ın nedeni — boş disk ÖLÇÜLEMEDİYSE "ölçemedim" ('olculemedi'),
 *  ölçüldü ve sığmıyorsa 'yetmiyor' (ölçülmemiş şey söylenmez). `neden`: ana sürecin ret cümlesi (Ö2). */
export function katalogYetmezligi(k: YerelKatalog | null, neden?: string | null): 'yetmiyor' | 'olculemedi' {
  if (neden && /ölçülemedi/i.test(neden)) return 'olculemedi';
  if (k && k.durum === 'olculdu' && !k.kartlar.some((x) => x.uygun) && k.kartlar.some((x) => x.uygunlukMetni === 'Disk ölçülemedi')) return 'olculemedi';
  return 'yetmiyor';
}

/** Boyutlu onayın eşiği (Ayarlar'daki kurulumla aynı: bilesenler/YerelKurulum.tsx ONAY_ESIGI = 1 GB). */
export const ONAY_ESIGI_GB = 1;
export interface YenidenIndirSecimi {
  model: YerelModelAdi;
  /** Sürüm zaten kurulu: inmez, açılır. */
  kurulu: boolean;
  /** Düğmenin adı: "Hafif sürümü indir · 1,9 GB" / "Hafif sürümü aç" (Geliştirici: "İndir · Bonsai 2 · 4B · 1,9 GB"). */
  etiket: string;
  /** Boyutlu onay gerekir (1 GB üstü indirme). */
  onay: boolean;
  onayBaslik: string;
  onayMetni: string;
  onayDugmesi: string;
}
/** Düzeltme turu 2: kokpitin "hazır değil" kartındaki "Yeniden indir" — hangi sürüm ve ne kadar: istenen (uyuyorsa) › kurulu › Önerilen
 *  (katalogSecimi; uymayan seçilmez). Seçilecek sürüm yoksa null (kart Ayarlar → Nerede çalışsın'a götürür). */
export function yerelYenidenIndirSecimi(k: YerelKatalog, g: { istenen: YerelModelAdi | null; sade: boolean; bosDiskGB?: number; calistiriciKurulu?: boolean }): YenidenIndirSecimi | null {
  const model = katalogSecimi(k, g.istenen);
  const kart = model ? k.kartlar.find((x) => x.ad === model) : undefined;
  if (!model || !kart) return null;
  const ad = g.sade ? `${kart.baslik}ü` : kart.baslik; // İş: "Hafif sürüm" → "Hafif sürümü"
  const disk = typeof g.bosDiskGB === 'number' && Number.isFinite(g.bosDiskGB) ? `; diskte ${gbMetni(g.bosDiskGB)} boş` : '';
  // Takip turu: model dosyası kurulu ama çalıştırıcı yoksa (antivirüs karantinası, silinmiş klasör, sürüm değişimi) "aç" bir şey değiştirmez —
  // onarım: yerel:kur yalnız eksik çalıştırıcıyı (ve sesi) indirir; boyut o pay kadar.
  const kurulu = kart.kurulu && g.calistiriciKurulu !== false;
  const indirGB = kart.kurulu && !kurulu ? gbBir(ILK_KURULUM_PAYI) : kart.indirGB;
  const boyut = kart.kurulu && !kurulu ? gbYaz(indirGB) : kart.boyutMetni;
  return {
    model, kurulu,
    etiket: kurulu ? (g.sade ? `${ad} aç` : `Aç · ${kart.baslik}`) : (g.sade ? `${ad} indir · ${boyut}` : `İndir · ${kart.baslik} · ${boyut}`),
    onay: !kurulu && indirGB > ONAY_ESIGI_GB,
    onayBaslik: `${kart.baslik} indirilsin mi?`,
    // Ayarlar'daki boyutlu onayla aynı söz (bilesenler/YerelKurulum.tsx IndirmeOnayKutusu).
    onayMetni: `Yaklaşık ${boyut} indirilecek${disk}. İstediğin an durdurabilirsin.`,
    onayDugmesi: `İndir · ${boyut}`,
  };
}

/** Takip turu: yarım indirme dosyaları (`.indiriliyor`; çökme/çıkış artığı) yeniden yazılırken boşalır — ana süreç uygunluk kapısı onları
 *  boş yere ekler (main/yerel/kurulum.ts kurulumDiskHesabi ile aynı ilke); "Sürdür" haksız reddedilmez. Ölçülemeyen disk ölçülmüş sayılmaz. */
export function yarimlaBosDisk(d: KatalogDonanimi | 'hata', yarimBayt: number): KatalogDonanimi | 'hata' {
  if (d === 'hata' || typeof d.bosDiskGB !== 'number' || !Number.isFinite(d.bosDiskGB) || !(yarimBayt > 0)) return d;
  return { ...d, bosDiskGB: Math.round((d.bosDiskGB + yarimBayt / 1e9) * 10) / 10 };
}

/** Uymayan seçilemez: istenen bu bilgisayara uyuyorsa o, değilse varsayılan (Önerilen / kurulu); seçilecek bir şey yoksa null. */
export function katalogSecimi(k: YerelKatalog, istenen: YerelModelAdi | null | undefined): YerelModelAdi | null {
  if (istenen && k.kartlar.find((x) => x.ad === istenen)?.uygun) return istenen;
  return varsayilanModel(k);
}
