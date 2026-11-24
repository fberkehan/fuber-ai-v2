// ── Kurulum sihirbazının sayfa listesi, sol paneldeki seçim özetleri ve kurulum sürümü (saf, birim testli: tests/kurulum-adimlari.test.ts) ──
// 0.10 E4 (K6) — 27 Eki: uygulamayı indiren yönetici her adımı "ileri, ileri, ileri" diyerek geçebilmeli; kişiyi tanımak için birçok
// kurulum sayfası var ama seçim hakkı az (tek ürün). Her sayfada TEK soru, makul varsayılan seçili,
// tek birincil düğme "Devam". Sıra (İş): Hoş geldin → Fuber hesabı → Tanışalım → İşin → Günün → Görünüm → Ses → Gizlilik → Bu cihazda
// çalışan yapay zekâ → Bağlantılar → İzinler → Hazırsın. "İşin" sayfasındaki "Geliştiriciyim" kullanım biçimini Geliştirici'ye çevirir ve
// Hazırsın'dan önce "Geliştirici araçları" girer (K8).
//   · Sayfa sırası VERİDEN (KURULUM_ADIMLARI): sihirbaz listeyi moda ve kipe göre süzer, sayfayı kimliğiyle izler (mod değişse de
//     bulunulan sayfa kaymaz). Moda bağlı yeni bir sayfa listeye bir satır olarak girer (adimEkle).
//   · Kurulum sürümü (Ayarlar.kurulumSurumu): yeni kurulum bitince KURULUM_SURUMU yazılır; bu alandan önce kurulumu bitmiş profil (0.6–0.8)
//     göçte 1 sayılır. 0.12 H3a (önceki veriler silinmedikçe yükseltmede gereksiz bir ekran açılıyordu): sürüm numarası
//     AÇILIŞ KARARINI ETKİLEMEZ — yükseltmede hiçbir sihirbaz ya da özet ekranı açılmaz. Karar tek yerde: kurulumYolu (aşağıda;
//     yeni kurulum · Tekrar hoş geldin · yalnız Fuber hesabı · hiçbiri). Alan yalnız kayıt için kalır ve "Geliştirici araçları" teklifinin
//     tek sayfalık sihirbazı (ozelYukseltmeBitirirMi) onu okur.
//   · adimOzeti: eski sihirbazın (renderer/sayfalar/Kurulum.tsx; artık yalnız "Geliştirici araçları" teklifi) haritasındaki seçim özeti.
//     Yeni kurulum (0.12 H3a): renderer/kurulum2/ + shared/kurulum-taslak.ts.
import { hitapMetni } from './hitap.ts';
import type { Mod, Tema } from './tipler.ts';
import { DAGITIM } from './dagitim.ts';

/** Bu sürümün kurulumu (kurulum:tamamla yazar). 0.12 H3a: artması HİÇBİR ekran açmaz (kurulumYolu sürüme bakmaz); 5 kalır. Tarihçe:
 *  3 Geliştirici araçları (Görev 29), 4 Fuber hesabı (0.10 E4), 5 hesap zorunlu (0.11 G2). */
export const KURULUM_SURUMU = 5;

/** Sihirbazın üç kipi: ilk kurulum, Ayarlar'dan yeniden açılan (Ruling 20), sürüm yükseltmesi (K11). */
export type KurulumKipi = 'ilk' | 'yeniden' | 'yukseltme';

export type AdimId =
  | 'hosgeldin' | 'hesap' | 'tanisma' | 'isin' | 'gunun' | 'gorunum' | 'ses' | 'gizlilik' | 'yerel' | 'baglantilar' | 'izinler'
  | 'gelistirici-araclari' | 'ada';

export interface AdimTanimi {
  id: AdimId;
  /** Sol paneldeki haritada görünen kısa ad (dar panelde tek satır; sayfanın kendi başlığı ayrıdır). */
  ad: string;
  /** Geliştirici'deki ad (sözlük P2; verilmezse `ad`). */
  adGelistirici?: string;
  /** Yalnız bu kullanım biçiminde (verilmezse iki modda da). */
  mod?: Mod;
  /** Yükseltme sihirbazında: bu sayfa hangi kurulum sürümüyle geldi ya da köklü değişti — profilin kurulum sürümü bundan küçükse
   *  gösterilir. 'kapanis': her yükseltmenin son sayfası (yalnız gösterilecek başka sayfa varsa). Verilmezse yükseltmede yok. */
  yukseltme?: number | 'kapanis';
}

export const KURULUM_ADIMLARI: readonly AdimTanimi[] = [
  { id: 'hosgeldin', ad: 'Hoş geldin' },
  { id: 'hesap', ad: 'Fuber hesabı', yukseltme: 4 },
  { id: 'tanisma', ad: 'Tanışalım' },
  { id: 'isin', ad: 'İşin', yukseltme: 2 },
  { id: 'gunun', ad: 'Günün' },
  { id: 'gorunum', ad: 'Görünüm', yukseltme: 2 },
  { id: 'ses', ad: 'Ses', yukseltme: 2 },
  { id: 'gizlilik', ad: 'Gizlilik', yukseltme: 2 },
  { id: 'yerel', ad: 'Cihazdaki yapay zekâ', adGelistirici: 'Yerel model', yukseltme: 2 },
  { id: 'baglantilar', ad: 'Bağlantılar' },
  { id: 'izinler', ad: 'İzinler' },
  { id: 'gelistirici-araclari', ad: 'Geliştirici araçları', mod: 'gelistirici', yukseltme: 3 },
  { id: 'ada', ad: 'Hazırsın', yukseltme: 'kapanis' },
];

/**
 * Sihirbazın sayfa sırası. `profilSurumu`: yükseltmede profilin kurulum sürümü (öteki kiplerde okunmaz). İlk kurulum ve yeniden açılan
 * sihirbaz aynı sayfaları gösterir. Yükseltmede gösterilecek sayfa yoksa boş liste.
 * 0.11 G2 (spec §2 "Fuber hesabı zorunlu"): `hesapVar: false` — yükseltmede hesabı olmayan profil Fuber hesabı sayfasını, sayfanın sürüm
 * numarasından BAĞIMSIZ görür (herkes kayıt olur). Verilmezse eski kural (sürüm numarası).
 */
export function adimSirasi(mod: Mod, kip: KurulumKipi, profilSurumu = 0, tanimlar: readonly AdimTanimi[] = KURULUM_ADIMLARI, o: { hesapVar?: boolean; hesapsizTercih?: boolean; hesapAcik?: boolean } = {}): AdimId[] {
  // Açık kaynak hazırlığı: hesapsız derlemede (false false) hesap sayfası hiç yok; "Hesapsız" seçmiş profil yükseltmede yeniden sorulmaz.
  const modda = tanimlar.filter((t) => (!t.mod || t.mod === mod) && !(t.id === 'hesap' && !(o.hesapAcik ?? false)));
  if (o.hesapsizTercih && o.hesapVar === false) o = { ...o, hesapVar: undefined };
  if (kip !== 'yukseltme') return modda.map((t) => t.id);
  const yeni = modda.filter((t) => (typeof t.yukseltme === 'number' && profilSurumu < t.yukseltme) || (t.id === 'hesap' && o.hesapVar === false));
  if (!yeni.length) return [];
  return modda.filter((t) => yeni.includes(t) || t.yukseltme === 'kapanis').map((t) => t.id);
}

/**
 * Adım ekleme API'si: `sonra` sayfasının hemen arkasına koyar. Aynı kimlik ya da olmayan `sonra` hata verir (sessizce yanlış yere
 * girmesin). Liste yeniden yazılmaz, yenisi döner.
 */
export function adimEkle(tanimlar: readonly AdimTanimi[], yeni: AdimTanimi, sonra: AdimId | string): AdimTanimi[] {
  if (tanimlar.some((t) => t.id === yeni.id)) throw new Error(`kurulum adımı zaten var: ${yeni.id}`);
  const i = tanimlar.findIndex((t) => t.id === sonra);
  if (i < 0) throw new Error(`kurulum adımı yok: ${sonra}`);
  return [...tanimlar.slice(0, i + 1), yeni, ...tanimlar.slice(i + 1)];
}

/** Sayfanın haritadaki adı (bilinmeyen kimlikte kimliğin kendisi); Geliştirici'de varsa `adGelistirici` (sözlük P2: "Yerel model"). */
export function adimAdi(id: AdimId, tanimlar: readonly AdimTanimi[] = KURULUM_ADIMLARI, mod?: Mod): string {
  const t = tanimlar.find((x) => x.id === id);
  return (mod === 'gelistirici' ? t?.adGelistirici : undefined) ?? t?.ad ?? id;
}

// ── Açılışta hangi ekran (0.12 H3a, spec §2) ──────────────────────────────────────────────────────────────────────────────────────
/** Açılışın dört yolu: yeni kurulum (renderer/kurulum2), "Tekrar hoş geldin" (yeniden kurulan bilgisayar), yalnız Fuber hesabı ekranı
 *  (eksik tek zorunlu şey), hiçbiri (doğrudan kokpit). */
export type KurulumYolu = 'yeni' | 'tekrar-hos-geldin' | 'yalniz-hesap' | 'yok';

export interface KurulumYoluGirdisi {
  /** Veri klasöründe karşılanacak bir şey var (kurulum bitmiş, hesap, sohbet ya da hafıza; renderer/main.tsx `veri:ozet`ten). */
  veriVar: boolean;
  /** Veri klasöründe `.yeniden-kurulum` işareti var (0.11 G2: kaldırıcı "verilerim kalsın" dedi; main/veri/temizlik.ts). Güncelleme
   *  (aynı kurulumun üstüne yeni sürüm) işaret YAZMAZ (build/kurulum.nsh `${isUpdated}`). */
  yenidenKurulum: boolean;
  kurulumTamam: boolean;
  /** Fuber hesabı bağlı (Ayarlar.hesap). */
  hesapVar: boolean;
  /** Açık kaynak hazırlığı: kullanıcı kurulumda "Hesapsız" yolu seçti (Ayarlar.hesapsizTercih) — hesap ekranı açılışta yeniden sorulmaz. */
  hesapsizTercih?: boolean;
  /** Bu derlemede Fuber hesabı var mı (shared/dagitim.ts false; verilmezse derlemenin değeri). */
  hesapAcik?: boolean;
}

/**
 * Kural sırası (brief H3a; sürüm numarası kararı ETKİLEMEZ — bu fonksiyon onu hiç almaz):
 *  1. yeniden kurulum işareti (ve karşılanacak veri) → "Tekrar hoş geldin";
 *  2. kurulum tamamlanmamış → yeni kurulum;
 *  3. hesap yok → yalnız Fuber hesabı ekranı;
 *  4. değilse → hiçbiri (kokpit).
 * İşaret var ama veri klasöründe hiçbir şey yoksa (karşılanacak hafıza yok) kural 2'den sürer.
 */
export function kurulumYolu(o: KurulumYoluGirdisi): KurulumYolu {
  if (o.yenidenKurulum && o.veriVar) return 'tekrar-hos-geldin';
  if (!o.kurulumTamam) return 'yeni';
  if (!o.hesapVar && !o.hesapsizTercih && (o.hesapAcik ?? false)) return 'yalniz-hesap';
  return 'yok';
}

/**
 * Açılışta hesap sunucusu yoklanır mı (renderer/main.tsx): YALNIZ yalnız-hesap ekranı adayıyken VE Gizli mod kapalıyken. 0.12 H3a düzeltme
 * turu 1 (inceleme Ö1; K1/F1): Gizli modda uygulama kendiliğinden ağa çıkmaz ve Gizli yüzeyleri hesap önermez — açılış yoklaması da yok.
 */
export function acilisYoklamasi(yol: KurulumYolu, gizli: boolean): boolean {
  return yol === 'yalniz-hesap' && !gizli;
}

/**
 * Açılışta gösterilecek ekran (renderer/main.tsx): yalnız hesap ekranı YALNIZ hesap sunucusuna ulaşılabiliyorken ve Gizli mod kapalıyken
 * açılır. Ulaşılamıyorsa (çevrim dışı; ya da önizlemede sahte sunucu verilmemiş) o ekranın tek eylemi "Şimdilik hesapsız devam et" olurdu
 * — kullanıcı boşuna durdurulmaz, doğrudan kokpit; bir sonraki açılışta (sunucuya ulaşılınca) hesap ekranı yine gelir. Gizli modda hesap
 * ekranı hiç açılmaz (yoklama da yapılmaz: acilisYoklamasi; hesap Ayarlar → Hesap'ta her zaman açılabilir). Öteki yollar olduğu gibi.
 */
export function acilisEkrani(yol: KurulumYolu, o: { gizli: boolean; ulasilir: boolean }): KurulumYolu {
  if (yol !== 'yalniz-hesap') return yol;
  return !o.gizli && o.ulasilir ? yol : 'yok';
}

/** "Karşılanacak veri" (kural 1): kurulum bitmiş ya da hesap, sohbet veya hafıza var. Sayılar `veri:ozet`ten (işaret varken istenir). */
export function veriVarMi(a: { kurulumTamam: boolean; hesapVar: boolean }, ozet?: { sohbet?: number; hafiza?: number } | null): boolean {
  return a.kurulumTamam || a.hesapVar || (ozet?.sohbet ?? 0) > 0 || (ozet?.hafiza ?? 0) > 0;
}

/**
 * Görev 29 (G23 incelemesi, bulgu 5): İş'teki bir kullanıcı oturum ortasında Geliştirici'ye geçince, kurulum bitmiş ve "Geliştirici araçları"
 * sayfası görülmemişse kabuk küçük bir teklif kartı gösterir; "Göster" yalnız bu sayfalı sihirbazı açar (yeniden başlatma yok). Görülme
 * bilgisi Geliştirici paketinin durumundadır (main/claudecode/eklenti-kurucu.ts).
 * 0.10 Görev 2 (D-2): bulut motoru yokken (`motorVar` false) teklif BEKLER — Ayarlar önce Yapay zekâ → Motorlar'ı açar; motor bağlanınca
 * kabuk (renderer/main.tsx) teklifi açar.
 */
export function araclarTeklifEdilsinMi(g: { onceki: Mod | null; yeni: Mod; kurulumTamam: boolean; araclarGoruldu: boolean; motorVar: boolean }): boolean {
  return g.onceki === 'is' && g.yeni === 'gelistirici' && g.kurulumTamam && !g.araclarGoruldu && g.motorVar;
}

/** Bu ayar değişimi Geliştirici'ye yeni mi girdi: oturum ortasında İş → Geliştirici ya da kurulumun Developer seçilerek bitmesi (0.13; yeni kurulumda "Geliştirici araçları"
 *  sayfası yok, teklif oraya kalır). `oncekiTamam`: bir önceki ayardaki kurulumTamam; ayarlar henüz okunmadıysa null. */
export const araclarGecisiMi = (g: { onceki: Mod | null; oncekiTamam: boolean | null; kurulumTamam: boolean }): boolean => g.kurulumTamam && (g.onceki === 'is' || g.oncekiTamam === false);

/**
 * Yalnız belli sayfalarla açılan yükseltme sihirbazı bitince kurulum sürümü yazılır mı: bu profilde bu modda bekleyen yükseltme sayfalarının
 * hepsi (kapanış dışında) gösterilmişse evet. Bekleyen başka sayfa varsa (sürüm 1) yazılmaz: açılışta yükseltme sürer.
 */
export function ozelYukseltmeBitirirMi(mod: Mod, profilSurumu: number, gosterilen: readonly AdimId[], tanimlar: readonly AdimTanimi[] = KURULUM_ADIMLARI): boolean {
  return adimSirasi(mod, 'yukseltme', profilSurumu, tanimlar).every((id) => gosterilen.includes(id) || tanimlar.find((t) => t.id === id)?.yukseltme === 'kapanis');
}

/**
 * Göç (ayarlar.ts, dosyadaki HAM değerden; bir kez): alan yoksa — bu sürümden önce — kurulumu bitmiş profil 1 (yükseltme sihirbazını bir
 * kez görür), bitmemiş/taze profil 0. Sayı varsa olduğu gibi (negatif/bozuk → 0).
 */
export function kurulumSurumuGocu(ham: { kurulumTamam?: unknown; kurulumSurumu?: unknown } | null | undefined): number {
  const s = ham?.kurulumSurumu;
  if (typeof s === 'number' && Number.isFinite(s)) return Math.max(0, Math.floor(s));
  return ham?.kurulumTamam === true ? 1 : 0;
}

// ── "İşin" ve "Günün": iş profili (Ayarlar.isProfili; Fuber'in sabit hafızasına da tek kayıt olarak yazılır) ──────────────────────────
/** 0.13 T5: yeni kurulum rol sormaz (kipler Business mode ve Developer mode); kayıtlı rol silinmez, hafıza metninde kalır. satis/yazilim/tasarim
 *  0.12 kurulumlarından, ekip-lideri ve gelistirici eski sihirbazdan gelir; hiçbiri kipi DEĞİŞTİRMEZ. */
export type IsRolu = 'kurucu' | 'yonetici' | 'ekip-lideri' | 'gelistirici' | 'diger' | 'satis' | 'yazilim' | 'tasarim';
/** Eski sihirbazın "İşin" sayfasının seçenekleri (sıra sabit). "Geliştiriciyim" kullanım biçimini Geliştirici'ye çevirir. */
export const ROL_ADLARI: readonly (readonly [IsRolu, string])[] = [
  ['kurucu', 'Kurucu'], ['yonetici', 'Yönetici'], ['ekip-lideri', 'Ekip lideri'], ['gelistirici', 'Geliştiriciyim'], ['diger', 'Diğer'],
];
/** Özette ve hafızada rolün adı ("Geliştiriciyim" → "Geliştirici"). */
export const ROL_OZETI: Readonly<Record<IsRolu, string>> = {
  kurucu: 'Kurucu', yonetici: 'Yönetici', 'ekip-lideri': 'Ekip lideri', gelistirici: 'Geliştirici', diger: 'Diğer', satis: 'Satış', yazilim: 'Yazılım', tasarim: 'Tasarım',
};
/** Önerilen çalışma saatleri ve sabah özeti (K6). 0.13.1: klasik mesai 09:00–18:00 (eskiden 19:00). */
export const GUN_VARSAYILAN = { gunBas: '09:00', gunBit: '18:00', sabah: '08:30' } as const;

export interface IsProfili { rol?: IsRolu; sirket?: string; gunBas?: string; gunBit?: string }

const SAAT = /^([01]\d|2[0-3]):[0-5]\d$/;
const ROLLER = new Set<string>(Object.keys(ROL_OZETI));
/** Arayüzden gelen iş profili (ayarlar:kaydet, kurulum:tamamla) güvenle süzülür: bilinmeyen rol ve geçersiz saat yok sayılır (öncekinde
 *  kalır), şirket adı kırpılır ve 80 karakterle sınırlanır. Nesne değilse undefined (alan yazılmaz). */
export function isProfiliSuz(ham: unknown, onceki: IsProfili = {}): IsProfili | undefined {
  if (!ham || typeof ham !== 'object' || Array.isArray(ham)) return undefined;
  const h = ham as Record<string, unknown>;
  const p: IsProfili = { ...onceki };
  if (typeof h.rol === 'string' && ROLLER.has(h.rol)) p.rol = h.rol as IsRolu;
  if (typeof h.sirket === 'string') p.sirket = h.sirket.replace(/\s+/g, ' ').trim().slice(0, 80);
  if (typeof h.gunBas === 'string' && SAAT.test(h.gunBas)) p.gunBas = h.gunBas;
  if (typeof h.gunBit === 'string' && SAAT.test(h.gunBit)) p.gunBit = h.gunBit;
  return p;
}

/** Sabit hafıza kaydının içeriği (Fuber'in kişiyi tanıması): "Rolü: Kurucu. Şirketi: Mavi Kuş. Çalışma saatleri: 09:00–18:00 (…)." Boşsa ''.
 *  Saat aralığı yarım çizgiyle (U+2013). Mesai dışı = sessiz saat (sessizSaatleri): yalnız hatırlatıcılar. */
export function isProfiliMetni(p: IsProfili | undefined): string {
  if (!p) return '';
  const l: string[] = [];
  if (p.rol) l.push(`Rolü: ${ROL_OZETI[p.rol]}.`);
  if (p.sirket) l.push(`Şirketi: ${p.sirket}.`);
  if (p.gunBas && p.gunBit) l.push(`Çalışma saatleri: ${p.gunBas}–${p.gunBit}; bu saatlerin dışında yalnız hatırlatıcılar için yazılır.`);
  return l.join(' ');
}

const dk = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
/**
 * Çalışma saatleri → Fuber'in sessiz saati (proaktif.sessizBaslangic/sessizBitis; zamanlayici.ts sessizMi: hatırlatıcılar dışında kendiliğinden
 * mesaj ve bildirim yok). Sessiz: mesai bitişinden ertesi sabaha; bitiş mesai başlangıcı ya da — sabah özeti daha erkense — özetin saati
 * (özet sessiz saatte gönderilmez). Geçersiz saat ya da gece vardiyası (bitiş başlangıçtan önce) eşlenmez: null.
 */
export function sessizSaatleri(gunBas: string, gunBit: string, sabah: string): { sessizBaslangic: string; sessizBitis: string } | null {
  if (!SAAT.test(gunBas) || !SAAT.test(gunBit) || dk(gunBit) <= dk(gunBas)) return null;
  const bitis = sabah && SAAT.test(sabah) && dk(sabah) < dk(gunBas) ? sabah : gunBas;
  return { sessizBaslangic: gunBit, sessizBitis: bitis };
}

/**
 * "Günün" sayfasının açılış saatleri (I1 5b). İlk kurulumda önerilen 09:00–18:00. Sonra (yeniden açılan sihirbaz, yükseltme) kayıtlı iş
 * profilinin saatleri; profilde saat yoksa (yükseltme yolu yalnız rol/şirket yazar) kayıtlı sessiz saatin TERSİ — gece yarısını aşan sessiz
 * saat (ör. 22:00–07:30) mesaiye çevrilir (07:30–22:00): sayfa kullanıcının gerçek sessiz saatini gösterir, "Bitti" onu ezmez. Çevrilemezse
 * önerilen saatler (`kaynak: 'varsayilan'`; yazılmaz — isProfiliYamasi).
 */
export function gunBaslangici(kip: KurulumKipi, p: IsProfili | undefined, sessiz: { sessizBaslangic?: string; sessizBitis?: string }): { bas: string; bit: string; kaynak: 'profil' | 'sessiz' | 'varsayilan' } {
  const varsayilan = { bas: GUN_VARSAYILAN.gunBas, bit: GUN_VARSAYILAN.gunBit, kaynak: 'varsayilan' as const };
  if (kip === 'ilk') return varsayilan;
  if (p?.gunBas && p.gunBit && SAAT.test(p.gunBas) && SAAT.test(p.gunBit)) return { bas: p.gunBas, bit: p.gunBit, kaynak: 'profil' };
  const { sessizBaslangic: a, sessizBitis: b } = sessiz;
  if (a && b && SAAT.test(a) && SAAT.test(b) && dk(a) > dk(b)) return { bas: b, bit: a, kaynak: 'sessiz' };
  return varsayilan;
}

/** "Günün" metni yalnız uygulanan şeyi söyler (I1 5b): saatler "Bitti"/"Başla"da sessiz saate eşlenecek mi — ilk kurulumda, kayıtlı ya da
 *  sessiz saatten türetilmiş saatte ya da kullanıcı saatlere dokunduysa; gece yarısını aşan mesai (bitiş ≤ başlangıç) eşlenmez. */
export function sessizUygulanirMi(g: { kip: KurulumKipi; kaynak: 'profil' | 'sessiz' | 'varsayilan'; dokunuldu: boolean; gunBas: string; gunBit: string; sabah: string }): boolean {
  return (g.kip === 'ilk' || g.kaynak !== 'varsayilan' || g.dokunuldu) && sessizSaatleri(g.gunBas, g.gunBit, g.sabah) !== null;
}

/** `rol` isteğe bağlı: yeni kurulum rol sormaz (0.13 T5); sormayan akışta yamaya girmez, kayıtlı rol olduğu gibi kalır (isProfiliSuz). */
type IsSecimi = { rol?: IsRolu; sirket: string; gunBas: string; gunBit: string };
/**
 * Yeniden açılan sihirbazın (ve yükseltmenin) "Bitti"si iş profiline ne yazar; hiçbir şey değişmediyse null (I1 5b). Çalışma saatleri YALNIZ
 * kayıtta zaten varsa ya da kullanıcı "Günün"de saatleri değiştirdiyse yazılır — dokunulmamış açılış saati (varsayılan ya da sessiz saatten
 * türetilmiş) "değişti" sayılıp kullanıcının sessiz saatini ezmez (ipc.ts ayarlar:kaydet saat değişince sessiz saate eşler).
 */
export function isProfiliYamasi(onceki: IsProfili | undefined, simdi: IsSecimi, acilis: IsSecimi): IsProfili | null {
  const isDegisti = simdi.rol !== acilis.rol || simdi.sirket.trim() !== acilis.sirket.trim();
  const saatDegisti = simdi.gunBas !== acilis.gunBas || simdi.gunBit !== acilis.gunBit;
  if (!isDegisti && !saatDegisti) return null;
  const saatYaz = saatDegisti || Boolean(onceki?.gunBas && onceki?.gunBit);
  return { ...(simdi.rol ? { rol: simdi.rol } : {}), sirket: simdi.sirket.trim(), ...(saatYaz ? { gunBas: simdi.gunBas, gunBit: simdi.gunBit } : {}) };
}

// ── Sol paneldeki seçim özetleri ─────────────────────────────────────────────────────────────────────────────────────────────────────
/** Özetin okuduğu ayar alanları (sihirbazın o anki değerleriyle: tanışma formu ayara yazılmadan da görünür). */
export interface OzetAyari {
  mod: Mod;
  kullaniciAdi: string;
  hitap: string;
  gorunum: { tema: Tema };
  ses: { hiz?: number };
  yerel: { gizliMod?: boolean };
  eposta: readonly { parolaVar?: boolean }[];
  whatsapp: { bagli?: boolean };
  yetki: { tarayici: boolean; bilgisayar: boolean; dosyaOkuma: boolean; tamYetki: boolean };
  hesap?: { eposta: string; durum: string } | null;
}
/** Sihirbazın kendi seçimleri (ayara sihirbaz sonunda ya da hiç yazılmayanlar). */
export interface KurulumSecimleri {
  rol?: IsRolu; sirket?: string; gunBas?: string; gunBit?: string;
  /** Sabah özeti saati; '' = kapalı. */
  sabah?: string;
  /** "Şimdilik hesapsız devam et" seçildi. */
  hesapsiz?: boolean;
  yerel?: 'evet' | 'hayir';
  yerelHal?: 'kurulu' | 'iniyor' | 'uygun-degil';
  araclar?: 'hepsi' | 'sonra';
  aracSayisi?: number;
}

const TEMA_OZETI: Record<Tema, string> = { koyu: 'Koyu', acik: 'Açık', sistem: 'Otomatik', cam: 'Şeffaf' };
const kisalt = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Haritada sayfanın altında görünen seçim (boş: gösterilecek bir şey yok). İş dili: model, sağlayıcı, "beyin" yok. */
export function adimOzeti(id: AdimId, a: OzetAyari, s: KurulumSecimleri = {}): string {
  switch (id) {
    case 'hesap':
      if (a.hesap?.eposta) return a.hesap.durum === 'bekliyor' ? 'Onay bekliyor' : kisalt(a.hesap.eposta, 30);
      return s.hesapsiz ? 'Sonra' : '';
    case 'tanisma': return hitapMetni(a.kullaniciAdi, a.hitap);
    case 'isin': {
      const rol = s.rol ?? (a.mod === 'gelistirici' ? 'gelistirici' : undefined);
      if (!rol) return '';
      return s.sirket?.trim() ? `${ROL_OZETI[rol]} · ${kisalt(s.sirket.trim(), 22)}` : ROL_OZETI[rol];
    }
    case 'gunun': {
      if (!s.gunBas || !s.gunBit) return '';
      return `${s.gunBas}–${s.gunBit} · ${s.sabah ? `özet ${s.sabah}` : 'özet kapalı'}`;
    }
    case 'gorunum': return TEMA_OZETI[a.gorunum.tema] ?? '';
    case 'ses': {
      const h = a.ses.hiz ?? 1;
      return h < 0.95 ? 'Sakin' : h > 1.05 ? 'Hızlı' : 'Normal hız';
    }
    case 'gizlilik': return a.yerel.gizliMod ? 'Gizli mod' : 'Normal';
    case 'yerel':
      if (s.yerelHal === 'kurulu') return 'Hazır';
      if (s.yerelHal === 'uygun-degil') return 'Bu bilgisayara uymuyor';
      if (s.yerelHal === 'iniyor') return 'İniyor';
      return s.yerel === 'evet' ? 'İstiyorum' : s.yerel === 'hayir' ? 'Sonra' : '';
    case 'baglantilar': {
      const e = a.eposta.filter((x) => x.parolaVar).length;
      const l = [...(e ? [`${e} e-posta`] : []), ...(a.whatsapp.bagli ? ['WhatsApp'] : [])];
      return l.length ? l.join(' · ') : 'Sonra';
    }
    case 'izinler': {
      if (a.yetki.tamYetki) return 'Tam yetki';
      const n = [a.yetki.tarayici, a.yetki.bilgisayar, a.yetki.dosyaOkuma].filter(Boolean).length;
      return n ? `${n} izin açık` : 'Hepsi kapalı';
    }
    case 'gelistirici-araclari':
      return s.araclar === 'hepsi' ? `${s.aracSayisi ?? 0} araç` : s.araclar === 'sonra' ? 'Sonra' : '';
    default: return '';
  }
}
