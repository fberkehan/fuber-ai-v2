// ── Toplantı modu: ortak tipler ve saf kurallar (12 Kas 2026; Electron/DOM yok — tests/toplanti.test.ts) ─────────────────────────────────────
// 12 Kas: PC'den gelen ses anlık algılanır; algılanan dilde ekrana yazılır ve istenen dile anlık çevrilir. Robot modu
// açıksa verilen konuda doğrudan AI yanıtı üretilip ekranda gösterilir. Ayrı bir ekrandır. Kararlar:
//  · İki ses ayrı akar: bilgisayarın sesi (Zoom, Teams, YouTube…) "Karşı taraf", mikrofon "Siz". Konuşan etiketi akıştan gelir (ayrıca tanıma yok).
//  · Robot yalnız karşı tarafın sorusuna/isteğine YANIT ÖNERİSİ yazar: yalnız kullanıcı görür, hiç seslendirilmez, hiçbir yere gönderilmez.
//  · Toplantı bitince döküm, çeviri ve kısa özet bu bilgisayarda saklanır (main/toplanti/depo.ts); kullanıcı silebilir; kendiliğinden yüklenmez.
// Burada: satır/öneri/özet tipleri, dil seçenekleri, dil sezgisi (yazıya çevirmenin sonucundan), soru sezgisi, yankı süzgeci (hoparlörden mikrofona
// kaçan karşı taraf sesi), yapay zekâ istemleri ve yanıt çözücüleri, iş izi kaydı. İstemler kısa ve ucuzdur (çeviri toplu, en çok birkaç satır).
import type { IsKaydi } from './is-izi.ts';
import type { ToplantiBaglami } from './toplanti-baglam.ts';

export type Konusan = 'karsi' | 'siz';
export const KONUSAN_ADI: Record<Konusan, string> = { karsi: 'Karşı taraf', siz: 'Siz' };

/** Kayıt sırasında başta görünen onay satırı (ürün kararı; birebir). */
export const RIZA_SATIRI = 'Toplantıdakilere kayıt yaptığınızı bildirin.';
/** Kredi notu (bulut yolu). Gizli ve "Yalnız bu bilgisayar"da yazıya çevirme ve çeviri bu bilgisayarda: kredi kullanılmaz. */
export const KREDI_NOTU = 'Yazıya çevirme ve çeviri Fuber kredinden düşer; dinlerken kredi harcanır.';
export const KREDI_NOTU_YEREL = 'Bu bilgisayarda çalışır; kredi harcanmaz.';
/** Robot önerisinin altındaki sabit not: öneri yalnız ekranda, sesli okunmaz, gönderilmez. */
export const ROBOT_NOTU = 'Yalnız sana gösterilir; Fuber bunu sesli okumaz, kimseye iletmez — söyleyip söylememek senin kararın.';
/** Bulutta yazıya çevirmenin sınırı (402 / günlük tavan): dinleme sürer, yazı durur; elde kalan döküm saklanır. */
export const TOPLANTI_SINIR_METNI: Readonly<Record<'kredi' | 'tavan', string>> = {
  kredi: 'Kullanım hakkın doldu; yazıya çevirme durdu. Buraya kadar yazılanlar saklanacak.',
  tavan: 'Bugünkü yazıya çevirme sınırın doldu; yarın yeniden açılır. Buraya kadar yazılanlar saklanacak.',
};

/**
 * Uyarı metinleri (12 Kas 0.17.2): her biri NE OLDUĞUNU ve NE YAPILACAĞINI tek cümlede söyler; gerektiğinde yanında tek eylem düğmesi durur
 * (UyariEylemi). "Bilgi" seviyesi sorun değildir (iş sürüyor): arayüzde sarı değil, sakin durum çipidir.
 */
export const UYARI = {
  bulutDustuYerelVar: 'Bulutta yazıya çevirme kullanılamıyor; bu bilgisayarda sürüyor.',
  bulutDustuYerelYok: 'Yazıya çevirme durdu; devam etmek için yerel yazıya çevirmeyi indir.',
  yerelYok: 'Yazıya çevirme için yerel yazıya çevirmeyi indirmen gerekiyor.',
  parca: 'Bir parça yazıya çevrilemedi; dinleme sürüyor.',
  satirYok: 'Bazı konuşmalar yazıya çevrilemedi; dinleme sürüyor.',
  ceviri: 'Çeviri şu an yapılamıyor; yazıya çevirme sürüyor.',
  ozet: 'Özet çıkarılamadı; konuşma metni saklandı.',
  karsiKesildi: 'Bilgisayarın sesi kesildi; yeniden açabilirsin.',
  sizKesildi: 'Mikrofon kesildi; yeniden açabilirsin.',
  karsiYok: 'Bilgisayarın sesi alınamadı; yalnız mikrofon yazılıyor.',
  sizYok: 'Mikrofon kapalı ya da bulunamadı; yalnız karşı taraf yazılıyor.',
  ikisiYok: 'Ne bilgisayarın sesi ne mikrofon alınabildi; toplantı başlamadı.',
  baslamadi: 'Toplantı başlatılamadı; yeniden dene.',
} as const;
export type UyariEylemi = 'whisper-indir' | 'karsi-yeniden' | 'siz-yeniden' | 'giris' | 'windows-mikrofon' | 'mikrofon-ac';
export type UyariSeviyesi = 'bilgi' | 'sorun';

/** Yazıya çevirmenin yolu: Gizli ve "Yalnız bu bilgisayar"da YALNIZ kurulu yerel tanıyıcı (P14: hiçbir ses buluta gitmez); bulutta Fuber hesabı, o yoksa ya da düştüyse
 *  kurulu yerel tanıyıcı (yerel her zaman güvenlidir; hesapsız kullanıcı da Whisper kuruluysa yazdırır). Dikte (shared/dikte-yolu.ts) bulutta Whisper'a düşmez; toplantı düşer. */
export function toplantiYolu(g: { bulutsuz: boolean; hesapKullanilir: boolean; bulutDustu: boolean; whisperKurulu: boolean; /** 13 Kas: kullanıcının seçimi ('yerel': hesap olsa da bu bilgisayarda yazılır; 'bulut'/'otomatik': eski kural). */ tercih?: 'otomatik' | 'bulut' | 'yerel' }): YaziYolu {
  if (!g.bulutsuz && g.tercih === 'yerel') return g.whisperKurulu ? 'whisper' : 'yok';
  if (!g.bulutsuz && g.hesapKullanilir && !g.bulutDustu) return 'hesap';
  return g.whisperKurulu ? 'whisper' : 'yok';
}

/** Üst şeritteki iki sade satır (teknik kimlik yok). İş kipinde tanıyıcı ve model adları görünmez (shared/is-dili.ts); Geliştirici'de kısa ad eklenir. */
export function motorEtiketleri(g: { yazi: YaziYolu; yz: 'yerel' | 'bulut' | 'yok'; yzSaglayici?: string; yzAd?: string; gelistirici: boolean; yerelYzHazir?: boolean }): { yazi: string; yz: string } {
  const yazi = g.yazi === 'hesap' ? 'Bulut' : g.yazi === 'whisper' ? (g.gelistirici ? 'Bu bilgisayar · Whisper' : 'Bu bilgisayar') : 'Kapalı';
  let yz: string;
  if (g.yz === 'yerel') yz = g.yerelYzHazir === false ? 'Bu bilgisayar (hazır değil)' : g.gelistirici && g.yzAd ? `Bu bilgisayar · ${g.yzAd}` : 'Bu bilgisayar';
  else if (g.yz === 'yok') yz = 'Kapalı';
  else if (g.yzSaglayici === 'fuber' || !g.yzSaglayici) yz = g.gelistirici && g.yzAd ? `Fuber · ${g.yzAd}` : 'Fuber';
  else yz = g.gelistirici && g.yzAd ? g.yzAd : 'Kendi hesabın';
  return { yazi, yz };
}

/** Hedef dil seçenekleri (kısa liste; rozet kodu büyük harf). */
export const DILLER: readonly { kod: string; ad: string }[] = [
  { kod: 'tr', ad: 'Türkçe' }, { kod: 'en', ad: 'İngilizce' }, { kod: 'de', ad: 'Almanca' }, { kod: 'fr', ad: 'Fransızca' },
  { kod: 'es', ad: 'İspanyolca' }, { kod: 'it', ad: 'İtalyanca' }, { kod: 'pt', ad: 'Portekizce' }, { kod: 'nl', ad: 'Felemenkçe' },
  { kod: 'ru', ad: 'Rusça' }, { kod: 'ar', ad: 'Arapça' }, { kod: 'zh', ad: 'Çince' }, { kod: 'ja', ad: 'Japonca' }, { kod: 'ko', ad: 'Korece' },
];
const DIL_ADI_EN: Record<string, string> = {
  tr: 'Turkish', en: 'English', de: 'German', fr: 'French', es: 'Spanish', it: 'Italian', pt: 'Portuguese', nl: 'Dutch', ru: 'Russian', ar: 'Arabic',
  zh: 'Chinese', ja: 'Japanese', ko: 'Korean', el: 'Greek', he: 'Hebrew',
};
export const dilGecerli = (k: unknown): k is string => typeof k === 'string' && DILLER.some((d) => d.kod === k);
export const dilAdi = (k: string | null | undefined): string => DILLER.find((d) => d.kod === k)?.ad ?? (k ? k.toUpperCase() : 'Bilinmiyor');
/** Varsayılan hedef dil: uygulamanın dili. */
export const varsayilanHedef = (uygulamaDili: string | undefined): string => (dilGecerli(uygulamaDili) ? uygulamaDili : 'tr');

// ── Tipler ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** 'akiyor': kesin cümlenin çevirisi harf harf akıyor; 'on': konuşma sürerken kısmi metnin hafif ön çevirisi (soluk; kesin çeviri gelince yerini alır). */
export type CeviriDurumu = 'bekliyor' | 'tamam' | 'ayni' | 'olmadi' | 'yok' | 'akiyor' | 'on';
export interface ToplantiSatiri {
  /** '<konusan>:<konusma no>' — yalnız eşleme için; görünmez. */
  id: string;
  konusan: Konusan;
  /** Toplantı başından bu yana ms (akışın örnek sayacından). */
  basMs: number;
  bitMs?: number;
  /** Şimdiye dek yazıya çevrilen metin (parçalar sırayla). */
  metin: string;
  /** Konuşma bitti ve bütün parçaları yazıya çevrildi. Kesin olmayan satır "…" ile görünür. */
  kesin: boolean;
  /** Sezilen dil (ISO 639-1); bilinmiyorsa null. */
  dil: string | null;
  ceviri?: string;
  ceviriDurum: CeviriDurumu;
  /** Yazıya çevrilemedi: satır belirli süre (SATIR_ZAMAN_ASIMI_MS) hiç metin almadı ya da yazıya çevirme hata verdi. "…" sonsuza dek kalmaz; satır "yazıya çevrilemedi" olur (0.18.2). */
  hata?: boolean;
}
export interface RobotOnerisi {
  id: string;
  satirId: string;
  soru: string;
  durum: 'hazirlaniyor' | 'hazir' | 'olmadi';
  yanit?: string;
  /** Yanıt hedef dilden başka dildeyse hedef dildeki karşılığı. */
  ceviri?: string;
}
export interface ToplantiOzeti { anaNoktalar: string[]; kararlar: string[]; yapilacaklar: string[] }
export type ToplantiHali = 'dinliyor' | 'ozetleniyor' | 'bitti' | 'durdu';
export type YaziYolu = 'hesap' | 'whisper' | 'yok';
/** Bir satır bu kadar süre hiç metin almazsa "yazıya çevrilemedi" olur (ms). Yerel Whisper'ın en yavaş meşru yanıtı (60 sn istek sınırı değil, toplantı için 20 sn) ile uyumlu. */
export const SATIR_ZAMAN_ASIMI_MS = 20_000;
/** Bulut yazıya çevirmenin (Fuber ya da başka bulut) kullanılamama nedenleri: çipte "Fuber bulutu kullanılamadı: <neden>; bu bilgisayarda yazılıyor." */
export type BulutNedeni = 'hesap-yok' | 'hesap-pasif' | 'sunucu-ses-yok' | 'belirtec' | 'baglanti' | 'kredi' | 'tavan' | 'yazi-hatasi';
export const BULUT_NEDENI_METNI: Readonly<Record<BulutNedeni, string>> = {
  'hesap-yok': 'bulut yazıya çevirme bağlı değil',
  'hesap-pasif': 'bulut yazıya çevirme şu an etkin değil',
  'sunucu-ses-yok': 'Fuber sunucusunda yazıya çevirme henüz kurulu değil',
  belirtec: 'canlı yazı için sunucudan izin alınamadı',
  baglanti: 'canlı yazı bağlantısı kurulamadı',
  kredi: 'kullanım hakkın doldu',
  tavan: 'bugünkü yazıya çevirme sınırın doldu',
  'yazi-hatasi': 'sunucu yazıya çevirmeyi üst üste reddetti',
};
/** Bulut yazıya çevirme kullanılamayıp yerelde yazılıyor: her zaman söylenir, neden dahil. */
export const bulutGecisMetni = (n: BulutNedeni): string => `Bulut kullanılamadı: ${BULUT_NEDENI_METNI[n]}; bu bilgisayarda yazılıyor.`;
/** Toplantı sayfasındaki açılır "Ayrıntılar" (ekran görüntüsüyle teşhis): sır yok, ham hata kısaltılmış ve yol/anahtar maskeli. */
export interface ToplantiTani {
  /** Yazıya çevirme motoru: 'Fuber bulutu (canlı)', 'Fuber bulutu (toplu)', 'Bu bilgisayar · Whisper', 'Gemini', 'Yok'. */
  motor: string;
  /** Bağlantı / süreç durumu, tek satır (örn. "canlı akış: karşı taraf bağlı, siz bağlı", "yerel sunucu çalışıyor · GPU"). */
  baglanti: string;
  /** Son hata (arındırılmış; yok ise boş). */
  sonHata: string;
  /** Yazıya çevirmeye giden ses parçası/bölümü ve metin dönen sayısı. */
  gelenParca: number;
  gelenMetin: number;
  /** Zaman aşımına düşen ya da hata alan satır sayısı. */
  basarisiz: number;
  /** Bulut kullanılamıyorsa nedeni (kullanıcı seçimi dışı). */
  bulutNedeni?: BulutNedeni;
  /** Yerel yazıya çevirme: gerçek donanım, model, ortalama istek süresi (ms). */
  yerel?: { donanim: string; model: string; gecikmeMs: number | null; derleme: string };
}
export interface ToplantiDurumu {
  id: string;
  hal: ToplantiHali;
  /** ms (Date.now tabanı). */
  baslangic: number;
  bitis?: number;
  yol: YaziYolu;
  /** Gizli ya da "Yalnız bu bilgisayar": ses ve yapay zekâ bu bilgisayarda. */
  bulutsuz: boolean;
  hedefDil: string;
  robot: boolean;
  satirlar: ToplantiSatiri[];
  oneriler: RobotOnerisi[];
  ozet: ToplantiOzeti | null;
  /** Tek cümlelik durum (UYARI; kredi bitti, günlük sınır, yazıya çevirme düştü). Geçici olan sonraki başarılı parçada kalkar. */
  uyari?: string;
  uyariEylemi?: UyariEylemi;
  uyariSeviyesi?: UyariSeviyesi;
  /** Üst şeritteki iki satır (motorEtiketleri): yazıya çevirme ve çeviri/öneri. */
  yaziMotoru?: string;
  yzMotoru?: string;
  /** Bu toplantıya bağlam verildi mi (içeriği durumda gezmez; arayüz kendi kopyasını tutar). */
  baglamVar?: boolean;
  /** Hoparlörden mikrofona kaçtığı için atılan "Siz" satırı sayısı. */
  yankiAtilan: number;
  /** "Ayrıntılar" paneli (0.18.2). */
  tani?: ToplantiTani;
  /** Hafif yayın (14 Kas; uzun toplantıda her güncelleme bütün dökümü taşımasın): `satirlar` boş gelir, yalnız değişen satırlar ve silinen kimlikler `yama`dadır. Arayüz kendi
   *  dökümüne uygular (denetci.ts yamaUygula). Yama olmayan durum (başlangıç, `toplanti:durum`, `toplanti:durdur`) dökümün TAMAMINI taşır. */
  yama?: { satirlar: ToplantiSatiri[]; silinen: string[] };
}

const satirSirasi = (a: ToplantiSatiri, b: ToplantiSatiri): number => a.basMs - b.basMs || (a.konusan === 'karsi' ? -1 : 1);
/**
 * Hafif yayını (ana süreç: yalnız değişen satırlar + silinen kimlikler) elimizdeki dökümle birleştirir. Değişmeyen satırların nesnesi AYNEN kalır: satır bileşenleri
 * (React.memo) onlar için yeniden çizilmez — 2 saatlik toplantıda da her güncelleme tek satırlık iştir. Yama olmayan durum dökümün tamamıdır.
 */
export function yamaUygula(onceki: ToplantiDurumu | null, d: ToplantiDurumu): ToplantiDurumu {
  const { yama, ...temel } = d;
  if (!yama) return d;
  const harita = new Map((onceki && onceki.id === d.id ? onceki.satirlar : []).map((s) => [s.id, s]));
  let sirala = false;
  for (const s of yama.satirlar) { const e = harita.get(s.id); if (!e || e.basMs !== s.basMs) sirala = true; harita.set(s.id, s); }
  for (const id of yama.silinen) harita.delete(id);
  const satirlar = [...harita.values()];
  if (sirala) satirlar.sort(satirSirasi);
  return { ...temel, satirlar };
}


// ── Süre ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** "0:07", "12:40", "1:02:03". */
export function sureMetni(ms: number): string {
  const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const sa = Math.floor(s / 3600), dk = Math.floor((s % 3600) / 60), sn = s % 60;
  const iki = (n: number) => String(n).padStart(2, '0');
  return sa ? `${sa}:${iki(dk)}:${iki(sn)}` : `${dk}:${iki(sn)}`;
}

// ── Dil sezgisi (yazıya çevirmenin sonucundan) ──────────────────────────────────────────────────────────────────────────────
// Yazıya çevirme dili sabitlemeden çalışır (sunucu dili kendisi sezer ama yanıtta söylemez; yerel yolda dil 'auto'). Dil metinden sezilir: önce yazı
// sistemi (Arap, Kiril, Çin, Japon, Kore, Yunan, İbrani), Latin yazıda dile özgü harfler ve sık sözcükler. Emin değilse null (çağıran konuşanın son
// dilini kullanır). Kısa ünlemler ("Okay", "Evet") bilinçli olarak yalnız güçlü işaretle sezilir.
const SIK: Record<string, readonly string[]> = {
  tr: ['ve', 'bir', 'bu', 'şu', 'için', 'ile', 'ama', 'çok', 'daha', 'ne', 'evet', 'hayır', 'değil', 'var', 'yok', 'mi', 'mı', 'mu', 'mü', 'ben', 'sen', 'biz', 'siz', 'onu', 'bunu', 'gibi', 'kadar', 'sonra', 'şimdi', 'nasıl', 'neden', 'tamam', 'olarak', 'diye', 'de', 'da', 'ki', 'yani', 'merhaba', 'teşekkür', 'teşekkürler', 'lütfen', 'olur', 'oldu', 'yarın', 'bugün'],
  en: ['the', 'and', 'is', 'are', 'to', 'of', 'a', 'in', 'that', 'it', 'you', 'we', 'i', 'for', 'on', 'with', 'this', 'what', 'can', 'do', 'not', 'be', 'have', 'will', 'would', 'could', 'should', 'yes', 'no', 'our', 'your', 'about', 'how', 'when', 'please', 'thanks', 'thank', 'hello', 'okay', 'right', 'just', 'so', 'they', 'there', 'was'],
  de: ['und', 'der', 'die', 'das', 'ist', 'nicht', 'ich', 'sie', 'wir', 'es', 'ein', 'eine', 'zu', 'mit', 'auf', 'für', 'auch', 'aber', 'wie', 'was', 'ja', 'nein', 'können', 'haben', 'sind', 'bitte', 'danke', 'heute', 'morgen', 'noch', 'dass', 'wenn', 'oder'],
  fr: ['le', 'la', 'les', 'et', 'est', 'un', 'une', 'des', 'je', 'vous', 'nous', 'il', 'elle', 'pas', 'que', 'qui', 'pour', 'avec', 'dans', 'sur', 'oui', 'non', 'merci', 'bonjour', 'mais', 'très', 'cette', 'ce', 'du', 'au', 'sont', 'pouvez'],
  es: ['el', 'la', 'los', 'las', 'y', 'es', 'un', 'una', 'que', 'de', 'en', 'por', 'para', 'con', 'no', 'sí', 'yo', 'usted', 'nosotros', 'pero', 'muy', 'gracias', 'hola', 'cómo', 'qué', 'está', 'son', 'del', 'puede'],
  it: ['il', 'lo', 'la', 'gli', 'le', 'e', 'è', 'un', 'una', 'che', 'di', 'per', 'con', 'non', 'sì', 'io', 'noi', 'voi', 'ma', 'molto', 'grazie', 'ciao', 'come', 'cosa', 'sono', 'del', 'della', 'questo'],
  pt: ['o', 'a', 'os', 'as', 'e', 'é', 'um', 'uma', 'que', 'de', 'em', 'para', 'com', 'não', 'sim', 'eu', 'nós', 'você', 'mas', 'muito', 'obrigado', 'obrigada', 'olá', 'como', 'está', 'são', 'do', 'da'],
  nl: ['de', 'het', 'een', 'en', 'is', 'niet', 'ik', 'je', 'wij', 'we', 'zij', 'van', 'op', 'voor', 'met', 'dat', 'die', 'ja', 'nee', 'maar', 'ook', 'dank', 'hallo', 'hoe', 'wat', 'zijn', 'kunnen'],
};
const HARF_ISARETI: Record<string, RegExp> = { tr: /[ğşıçöü]/g, de: /[äöüß]/g, fr: /[éèêëçàâîôûœ]/g, es: /[ñ¿¡áíóú]/g, it: /[àèìòù]/g, pt: /[ãõâêôç]/g };
const SIK_KUMESI: Record<string, Set<string>> = Object.fromEntries(Object.entries(SIK).map(([d, l]) => [d, new Set(l)]));

export function dilSez(metin: string | null | undefined): string | null {
  const t = String(metin ?? '').trim();
  if (!t) return null;
  const say = (re: RegExp) => (t.match(re) ?? []).length;
  const kana = say(/[぀-ヿ]/g), han = say(/[一-鿿]/g), hangul = say(/[가-힯]/g);
  const arap = say(/[؀-ۿ]/g), kiril = say(/[Ѐ-ӿ]/g), yunan = say(/[Ͱ-Ͽ]/g), ibrani = say(/[֐-׿]/g);
  const latin = say(/[A-Za-zÀ-ɏ]/g);
  const yazi = [['ja', kana ? kana + han : 0], ['zh', kana ? 0 : han], ['ko', hangul], ['ar', arap], ['ru', kiril], ['el', yunan], ['he', ibrani]] as const;
  const enCok = [...yazi].sort((a, b) => b[1] - a[1])[0];
  if (enCok[1] > 0 && enCok[1] >= latin) return enCok[0];
  if (!latin) return null;
  const kucuk = t.toLowerCase().replace(/i̇/g, 'i');
  const sozcukler = kucuk.split(/[^\p{L}']+/u).filter(Boolean);
  const puan: Record<string, number> = {};
  for (const d of Object.keys(SIK)) {
    let p = 0;
    for (const s of sozcukler) if (SIK_KUMESI[d].has(s)) p += 1;
    const re = HARF_ISARETI[d];
    if (re) p += 1.5 * (kucuk.match(re) ?? []).length;
    puan[d] = p;
  }
  // Türkçe ekleri (-lar/-ler, -yor, -dır, -mış) güçlü işaret.
  puan.tr += 0.8 * sozcukler.filter((s) => /(?:lar|ler|yor|yorum|yoruz|dır|dir|dur|dür|mış|miş|muş|müş|acak|ecek|sınız|siniz)$/.test(s) && s.length > 4).length;
  const sirali = Object.entries(puan).sort((a, b) => b[1] - a[1]);
  const [ilk, ikinci] = sirali;
  if (ilk[1] < 1) return null;
  // Tek sözcük ve tek puan: güçlü değil (aynı sözcük birden çok dilde var: "de", "a", "e").
  if (ilk[1] - (ikinci?.[1] ?? 0) < 0.5) return null;
  return ilk[0];
}

// ── Soru sezgisi (karşı tarafın sorusu ya da isteği) ────────────────────────────────────────────────────────────────────────
// 'soru': açık işaret (soru işareti, soru eki, istek kalıbı, soru sözcüğüyle başlama). 'belki': yardımcı fiille başlayan İngilizce/Almanca cümle gibi
// zayıf işaret — hafif bir model denetimi karar verir. 'degil': yanıt önerisi yok.
export type SoruSonucu = 'soru' | 'belki' | 'degil';
const ISTEK = [
  /\blütfen\b/, /\brica\b/, /\b\w+(?:ebilir|abilir)\s+m[iıuü]s[iıuü]n(?:[iıuü]z)?\b/, /\b(?:söyler|anlatır|açıklar|gönderir|paylaşır|bakar)\s+m[iıuü]s[iıuü]n(?:[iıuü]z)?\b/,
  /\bplease\b/, /\b(?:can|could|would|will) you\b/, /\bwould you mind\b/, /\blet (?:me|us) know\b/, /\bwhat do you think\b/, /\byour (?:thoughts|opinion|view)\b/,
  /\bbitte\b/, /\bkönnten sie\b/, /\bkönnen sie\b/, /\bs'il vous plaît\b/, /\bpourriez-vous\b/, /\bpouvez-vous\b/, /\bpor favor\b/, /\bpodría\b/, /\bper favore\b/,
];
const SORU_BASI = /^(?:ne|neden|niçin|niye|nasıl|nerede|nereye|nereden|kim|kime|hangi|kaç|ne zaman|what|why|how|when|where|who|whom|whose|which|was|warum|wieso|wie|wann|wo|wer|welche[rsn]?|pourquoi|comment|quand|où|qui|quel(?:le)?s?|qu'est-ce|est-ce que|qué|por qué|cómo|cuándo|dónde|quién|cuál|perché|come|quando|dove|chi|quale)\b/;
const YARDIMCI_BASI = /^(?:is|are|was|were|do|does|did|can|could|would|will|should|shall|may|have|has|had|ist|sind|hast|haben|kannst|können|könnten|wird|werden|kann)\b/;
const TR_SORU_EKI = /(?:^|\s)m[iıuü](?:y[iıuü]m|s[iıuü]n|y[iıuü]z|s[iıuü]n[iıuü]z|d[iıuü]r)?(?:\s|$|[.,!])/;

export function soruMu(metin: string | null | undefined): SoruSonucu {
  const t = String(metin ?? '').trim();
  if (!t) return 'degil';
  if (/[?؟？]\s*["'”’)]*$/.test(t) || /[?؟？]/.test(t.slice(-40))) return 'soru';
  const k = t.toLowerCase().replace(/i̇/g, 'i').replace(/^[\s"'“‘(¿¡-]+/, '');
  const sozcuk = k.split(/\s+/).filter(Boolean).length;
  if (ISTEK.some((r) => r.test(k))) return 'soru';
  if (sozcuk < 3) return 'degil';
  if (TR_SORU_EKI.test(k)) return 'soru';
  if (SORU_BASI.test(k)) return 'soru';
  if (YARDIMCI_BASI.test(k)) return 'belki';
  return 'degil';
}

// ── Yankı süzgeci ───────────────────────────────────────────────────────────────────────────────────────────────────────────
// Kulaklık yoksa karşı tarafın sesi hoparlörden mikrofona kaçar ve "Siz" diye ikinci kez yazılır. Aynı aralıkta (±4 sn) karşı tarafın satırıyla sözcüklerinin
// çoğu ortak olan "Siz" satırı yankıdır: atılır. Ölçü: ortak sözcük / kısa satırın sözcük sayısı (en az 3 sözcük).
const sozcukKumesi = (s: string): Set<string> => new Set(s.toLocaleLowerCase('tr-TR').split(/[^\p{L}\p{N}]+/u).filter((x) => x.length >= 2));
export function benzerlik(a: string, b: string): number {
  const x = sozcukKumesi(a), y = sozcukKumesi(b);
  const kisa = Math.min(x.size, y.size);
  if (kisa < 3) return a.trim().toLocaleLowerCase('tr-TR') === b.trim().toLocaleLowerCase('tr-TR') && a.trim() ? 1 : 0;
  let ortak = 0;
  for (const s of x) if (y.has(s)) ortak++;
  return ortak / kisa;
}
export const YANKI_ESIGI = 0.6;
export const YANKI_PENCERE_MS = 4000;
export function yankiMi(siz: Pick<ToplantiSatiri, 'metin' | 'basMs' | 'bitMs'>, karsilar: readonly Pick<ToplantiSatiri, 'metin' | 'basMs' | 'bitMs'>[]): boolean {
  const sBas = siz.basMs, sBit = siz.bitMs ?? siz.basMs;
  return karsilar.some((k) => {
    const kBit = k.bitMs ?? k.basMs;
    const yakin = sBas <= kBit + YANKI_PENCERE_MS && sBit >= k.basMs - YANKI_PENCERE_MS;
    return yakin && benzerlik(siz.metin, k.metin) >= YANKI_ESIGI;
  });
}

// ── JSON ayıklama (modeller bazen çit ya da ön söz ekler) ───────────────────────────────────────────────────────────────────────
export function jsonAyikla(metin: string): unknown {
  const temiz = String(metin ?? '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  for (const aday of [temiz, temiz.slice(Math.max(0, temiz.search(/[[{]/)))]) {
    try { return JSON.parse(aday); } catch { /* sonraki */ }
  }
  const m = temiz.match(/[[{][\s\S]*[\]}]/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* yok */ } }
  return null;
}
const metinMi = (x: unknown): x is string => typeof x === 'string';
const temizSatir = (s: string, n = 600): string => s.replace(/\s+/g, ' ').trim().slice(0, n);

// ── Çeviri ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Bir çağrıda en çok bu kadar satır çevrilir (kısa istem, hızlı yanıt). */
export const CEVIRI_TOPLU = 6;
export function ceviriIstemi(metinler: readonly string[], hedef: string, sozluk = ''): { sistem: string; kullanici: string } {
  const ad = DIL_ADI_EN[hedef] ?? hedef;
  return {
    sistem: `You translate live meeting captions into ${ad}. Return ONLY a JSON array of strings: exactly one translation per input item, same order, same count. Keep names, numbers and tone; no notes. If an item is already in ${ad}, copy it unchanged.${sozluk ? ` ${sozluk}` : ''}`,
    kullanici: JSON.stringify(metinler.map((m) => temizSatir(m, 1200))),
  };
}
/** Tek cümlelik çeviri istemi (14 Kas): düz metin döner, harf harf akar; kısa tutulur (ilk jeton gecikmesi düşük kalsın). Sözlük en çok 400 karakter. */
export function ceviriIstemiTek(metin: string, hedef: string, sozluk = ''): { sistem: string; kullanici: string } {
  const ad = DIL_ADI_EN[hedef] ?? hedef;
  return {
    sistem: `Translate this live meeting caption into ${ad}. Reply with ONLY the translation. Keep names and numbers. If it is already in ${ad}, repeat it unchanged.${sozluk ? ` ${sozluk.slice(0, 400)}` : ''}`,
    kullanici: temizSatir(metin, 1200),
  };
}
/** Tek cümlelik çeviri yanıtını temizler: çit, baştaki/sondaki tırnak, JSON içine sarılmış tek metin. Boşsa null. */
export function ceviriTemiz(yanit: string): string | null {
  let t = String(yanit ?? '').replace(/^```(?:\w+)?\s*/i, '').replace(/```\s*$/, '').trim();
  if (/^[[{]/.test(t)) {
    const j = jsonAyikla(t);
    const v = Array.isArray(j) ? j.find(metinMi) : j && typeof j === 'object' ? Object.values(j as Record<string, unknown>).find(metinMi) : undefined;
    if (v) t = v;
  }
  t = t.replace(/^["“„]\s*|\s*["”]$/g, '').trim();
  return t ? temizSatir(t, 1200) : null;
}
/** Aynı anda en çok bu kadar cümle çevirisi sürer (kesin cümleler anında, paralel; toplu bekleme yok). */
export const CEVIRI_PARALEL = 4;

/** Yanıttan `n` çeviri (eksikse null; sıra korunur). Tek satırda düz metin de kabul edilir. */
export function ceviriCoz(yanit: string, n: number): (string | null)[] {
  const j = jsonAyikla(yanit);
  let liste: unknown[] | null = null;
  if (Array.isArray(j)) liste = j;
  else if (j && typeof j === 'object') {
    const v = Object.values(j as Record<string, unknown>).find(Array.isArray);
    if (v) liste = v as unknown[];
  }
  if (!liste) {
    const duz = String(yanit ?? '').trim();
    return n === 1 && duz && !/^[[{]/.test(duz) ? [temizSatir(duz.replace(/^["“]|["”]$/g, ''), 1200)] : Array(n).fill(null);
  }
  const out: (string | null)[] = [];
  for (let i = 0; i < n; i++) {
    const x = liste[i];
    const s = metinMi(x) ? x : x && typeof x === 'object' ? Object.values(x as Record<string, unknown>).find(metinMi) : undefined;
    out.push(s && s.trim() ? temizSatir(s, 1200) : null);
  }
  return out;
}

// ── Robot ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export function soruDenetimIstemi(gecmis: readonly { konusan: Konusan; metin: string }[], son: string): { sistem: string; kullanici: string } {
  return {
    sistem: 'You check live meeting captions. Is the LAST line a question or a request addressed to the listener that expects an answer? Reply with exactly one word: EVET or HAYIR.',
    kullanici: [...gecmis.slice(-4).map((g) => `${g.konusan === 'karsi' ? 'Other side' : 'Listener'}: ${temizSatir(g.metin, 300)}`), `LAST (other side): ${temizSatir(son, 400)}`].join('\n'),
  };
}
export const soruDenetimCoz = (y: string): boolean => /\b(?:evet|yes|ja|oui|sí)\b/i.test(String(y ?? '')) && !/\b(?:hayır|hayir|no)\b/i.test(String(y ?? ''));

export function robotIstemi(o: { soru: string; soruDili: string | null; hedefDil: string; gecmis: readonly { konusan: Konusan; metin: string }[]; baglam?: string; kullaniciAdi?: string; toplanti?: string }): { sistem: string; kullanici: string } {
  const dil = DIL_ADI_EN[o.soruDili ?? ''] ?? 'the same language as the question';
  const hedef = DIL_ADI_EN[o.hedefDil] ?? o.hedefDil;
  const ceviriGerek = o.soruDili !== o.hedefDil;
  const kim = o.kullaniciAdi ? `The listener is ${temizSatir(o.kullaniciAdi, 60)}.` : '';
  return {
    sistem: [
      `You help the listener answer live in a meeting. ${kim} Write ONE short reply they could say out loud (at most 2 sentences), in ${dil}, first person, natural and polite.`,
      'Use only facts from the transcript and the listener notes; if a fact is unknown, suggest a short honest holding reply (e.g. offer to check and follow up). Never invent numbers or commitments.',
      `Return ONLY JSON: {"yanit": "<reply>"${ceviriGerek ? `, "ceviri": "<the same reply in ${hedef}>"` : ''}}.`,
    ].join(' '),
    kullanici: [
      o.toplanti ? `Meeting context given by the listener:\n${o.toplanti}\n` : '',
      o.baglam ? `Listener notes:\n${o.baglam.slice(0, 1500)}\n` : '',
      'Recent transcript:',
      ...o.gecmis.slice(-12).map((g) => `${g.konusan === 'karsi' ? 'Other side' : 'Listener'}: ${temizSatir(g.metin, 400)}`),
      '',
      `Question to answer (other side): ${temizSatir(o.soru, 600)}`,
    ].filter((x, i) => x || i > 0).join('\n'),
  };
}
export function robotCoz(y: string): { yanit: string; ceviri?: string } | null {
  const j = jsonAyikla(y);
  if (j && typeof j === 'object' && !Array.isArray(j)) {
    const o = j as Record<string, unknown>;
    const yanit = metinMi(o.yanit) ? o.yanit : metinMi(o.reply) ? o.reply : metinMi(o.answer) ? o.answer : '';
    if (yanit.trim()) return { yanit: temizSatir(yanit, 500), ...(metinMi(o.ceviri) && o.ceviri.trim() ? { ceviri: temizSatir(o.ceviri, 500) } : {}) };
  }
  const duz = String(y ?? '').trim();
  return duz && !/^[[{]/.test(duz) ? { yanit: temizSatir(duz, 500) } : null;
}

// ── Özet ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Özete giden dökümün üst sınırı (karakter): uzun toplantıda son kısım tutulur (başı kısaltılır). */
export const OZET_DOKUM_SINIRI = 14_000;
export function dokumMetni(satirlar: readonly Pick<ToplantiSatiri, 'konusan' | 'metin' | 'basMs'>[], sinir = OZET_DOKUM_SINIRI): string {
  const t = satirlar.filter((s) => s.metin.trim()).map((s) => `[${sureMetni(s.basMs)}] ${s.konusan === 'karsi' ? 'Other side' : 'Me'}: ${temizSatir(s.metin, 1000)}`).join('\n');
  return t.length > sinir ? `…\n${t.slice(t.length - sinir)}` : t;
}
export function ozetIstemi(satirlar: readonly Pick<ToplantiSatiri, 'konusan' | 'metin' | 'basMs'>[], hedefDil: string, baglam = ''): { sistem: string; kullanici: string } {
  const ad = DIL_ADI_EN[hedefDil] ?? hedefDil;
  return {
    sistem: `Summarize this meeting transcript in ${ad}. Return ONLY JSON: {"anaNoktalar": [..], "kararlar": [..], "yapilacaklar": [..]}. anaNoktalar: up to 6 key points; kararlar: decisions actually made (may be empty); yapilacaklar: concrete action items, each a short imperative line with the owner if stated (may be empty). Short lines, no invented facts.${baglam ? ' Use the meeting context below only to get names, terms and topic right; never copy it into the summary unless it was discussed.' : ''}`,
    kullanici: baglam ? `Meeting context given by the listener:\n${baglam}\n\nTranscript:\n${dokumMetni(satirlar)}` : dokumMetni(satirlar),
  };
}
export function ozetCoz(y: string): ToplantiOzeti | null {
  const j = jsonAyikla(y);
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
  const o = j as Record<string, unknown>;
  const liste = (x: unknown, n: number): string[] => (Array.isArray(x) ? x.filter(metinMi).map((s) => temizSatir(s, 240)).filter(Boolean).slice(0, n) : []);
  const ozet = { anaNoktalar: liste(o.anaNoktalar ?? o.keyPoints, 8), kararlar: liste(o.kararlar ?? o.decisions, 8), yapilacaklar: liste(o.yapilacaklar ?? o.actionItems, 12) };
  return ozet.anaNoktalar.length || ozet.kararlar.length || ozet.yapilacaklar.length ? ozet : null;
}

// ── Saklanan kayıt ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface ToplantiKaydi {
  surum: 1;
  id: string;
  baslangic: string;
  bitis: string;
  sureMs: number;
  yol: YaziYolu;
  hedefDil: string;
  /** Gizli moddayken tutulan toplantı (yerelde kalır; hafızaya yazılmaz). */
  gizli: boolean;
  satirlar: Pick<ToplantiSatiri, 'konusan' | 'basMs' | 'metin' | 'dil' | 'ceviri'>[];
  oneriler: Pick<RobotOnerisi, 'soru' | 'yanit' | 'ceviri'>[];
  ozet: ToplantiOzeti | null;
  /** Verilen bağlam (konu, katılımcılar, notlar, belge metni): yalnız bu bilgisayarda, kayıtla birlikte; "Verilerimi sil" ile gider. */
  baglam?: ToplantiBaglami;
}
export interface ToplantiListeOgesi { id: string; baslangic: string; sureMs: number; satirSayisi: number; baslik: string; gizli: boolean; ozetVar: boolean }
export const TOPLANTI_KIMLIGI = /^t-\d{8}-\d{6}-[a-z0-9]{4}$/;
export function toplantiKimligi(an: Date, rastgele: string): string {
  const iki = (n: number) => String(n).padStart(2, '0');
  const r = rastgele.toLowerCase().replace(/[^a-z0-9]/g, '').padEnd(4, '0').slice(0, 4);
  return `t-${an.getFullYear()}${iki(an.getMonth() + 1)}${iki(an.getDate())}-${iki(an.getHours())}${iki(an.getMinutes())}${iki(an.getSeconds())}-${r}`;
}
export function kayitBasligi(k: Pick<ToplantiKaydi, 'ozet' | 'satirlar'>): string {
  const ilk = k.ozet?.anaNoktalar[0] ?? k.satirlar.find((s) => s.metin.trim())?.metin ?? 'Boş toplantı';
  const t = temizSatir(ilk, 200);
  return [...t].length > 90 ? `${[...t].slice(0, 89).join('').trimEnd()}…` : t;
}
/** Durumdan saklanacak kayıt: yalnız metni olan satırlar (kesin olmayanlar da: kapanışta yarıda kalan söz kaybolmasın). */
export function kayitYap(d: ToplantiDurumu, bitis: number, baglam?: ToplantiBaglami | null): ToplantiKaydi {
  return {
    surum: 1, id: d.id, baslangic: new Date(d.baslangic).toISOString(), bitis: new Date(bitis).toISOString(), sureMs: Math.max(0, bitis - d.baslangic),
    yol: d.yol, hedefDil: d.hedefDil, gizli: d.bulutsuz,
    satirlar: d.satirlar.filter((s) => s.metin.trim()).map((s) => ({ konusan: s.konusan, basMs: s.basMs, metin: s.metin, dil: s.dil, ...(s.ceviri ? { ceviri: s.ceviri } : {}) })),
    oneriler: d.oneriler.filter((o) => o.durum === 'hazir' && o.yanit).map((o) => ({ soru: o.soru, yanit: o.yanit, ...(o.ceviri ? { ceviri: o.ceviri } : {}) })),
    ozet: d.ozet,
    ...(baglam && (baglam.konu || baglam.katilimcilar || baglam.notlar || baglam.ton || baglam.belgeler.length) ? { baglam } : {}),
  };
}

// ── İş izi ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Toplantı sürerken iş izine giden tek kayıt: çentik "Toplantı · dinliyor" der, rayda Toplantı simgesi nefes alır. Bitince kayıt düşer (tik + uçuş). */
export function toplantiIsi(d: Pick<ToplantiDurumu, 'id' | 'hal' | 'baslangic' | 'bitis'>): IsKaydi | null {
  if (d.hal !== 'dinliyor' && d.hal !== 'ozetleniyor') return null;
  return {
    id: `toplanti:${d.id}`, kaynak: 'toplanti', ne: d.hal === 'dinliyor' ? 'Toplantı · dinliyor' : 'Toplantı · özetleniyor', baslik: '',
    nerede: { sayfa: 'toplanti', yol: 'toplanti', ad: 'Toplantı' }, hal: 'calisiyor', baslangic: d.baslangic, durdurulabilir: d.hal === 'dinliyor',
  };
}
