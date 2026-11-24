// ── Fuber'in beyni: motorların beyindeki yerleri, aralarındaki bağlar ve canlı olay tipleri ─────────────────────
// Her motor için animasyonlu bir beyin şeması: anlık olarak neyin çalıştığı ve nasıl
// çalıştığı görünür. Her motor işlevce karşılığı olan beyin bölgesine oturur (kulak → işitme korteksi, not tutucu →
// hipokampus…). Koordinatlar Beyin sayfasının 1200×940 sahnesindedir (yan görünüş render'ı 1200×800, ön SOLDA).
// Saf modül: çalışma anı içe aktarması yok (ana süreç, arayüz ve testler ortak kullanır).
// 0.10 Görev 3 (P2): görünen metinlerde "beyin" yok (tek sözlük: shared/terimler.ts); `anatomi` alanı yalnız telefonun Beyin sekmesinde
// görünür (P8) ve olduğu gibi kalır. Modül ve kanal adları ('beyin:durum') telefon 2.1.1 için değişmez.
// 0.13 T15 (Spec H): iç kimlikler (el, goz, kulak, bekci…) DEĞİŞMEZ; kullanıcıya görünen `ad`lar düz ad oldu (Düşünme, Fare ve klavye,
// Ekran ve web, Dinleme…) — "Akıl, El, Göz, Kulak, Bekçi, Eşlikçi, Raporcu, Not tutucu, Uyanma" hiçbir yerde görünmez (tests/kullanici-dili.test.ts).
// Akış satırları ok işaretli ("A → B") değil düz cümledir (olayMetni); telefon sekmesi aynı adları ve cümleleri okur.
import { UYANDIRMA_DUSTU_METNI, type UyandirmaDurumu } from './uyandirma-ayar.ts';
import { isDiliIhlali } from './is-dili.ts';
import type { DurmaNedeni } from './isler.ts';
import { motorBildirimi, motorEngelliMi, type MotorGorunumu } from './motor-durumu.ts';
import { TERIM, yerelAdi } from './terimler.ts';
import { HAFIZA_NEREDE_GEL, HAFIZA_NEREDE_IS } from './gizlilik-metni.ts';
import { DAGITIM } from './dagitim.ts';

export type BolgeId =
  | 'uyanma' | 'kulak' | 'yazici' | 'not' | 'hafiza' | 'eslikci' | 'rapor' | 'bekci'
  | 'ajan' | 'ses' | 'goz' | 'el' | 'iletisim' | 'saat' | 'kokpit' | 'kod';
export type MotorId = 'anthropic' | 'openai' | 'openrouter' | 'yerel';

export interface BolgeTanimi {
  id: BolgeId;
  ad: string;
  anatomi: string; // beyindeki karşılığı
  ne: string; // ne yapar (tek cümle)
  nasil: string; // nasıl çalışır (2-3 cümle)
  x: number;
  y: number;
  derin?: boolean; // yüzeyde değil, içeride (kesik halka)
  etiket: 'sol' | 'sag' | 'ust' | 'alt';
  ayar?: string; // Ayarlar'da ilgili bölüm (#çapa)
}

export const BOLGELER: BolgeTanimi[] = [
  { id: 'ajan', ad: 'Düşünme', anatomi: 'Ön lob · yürütücü işlevler', x: 430, y: 150, etiket: 'ust', ayar: 'motorlar', // İş: Hesap ve kullanım
    ne: 'Sohbeti yürütür: düşünür, araç seçer, yanıtı yazar.',
    nasil: 'Mesajınla birlikte çekirdek hafızayı, ilgili hafıza kayıtlarını ve saati okur; Fuber’in ana modeline gider. Bir araç gerekirse ilgili özelliğe sinyal yollar, sonucu alıp devam eder; en çok 30 adım.' },
  { id: 'rapor', ad: 'Raporlar', anatomi: 'Prefrontal korteks · planlama', x: 292, y: 250, etiket: 'sol', ayar: 'dusunme',
    ne: 'Gün sonu, hafta sonu ve ay sonu raporlarını yazar.',
    nasil: 'Günlük rapor o günün notlarından (önemli/önemsiz + günün esprisi), haftalık günlüklerden, aylık haftalıklardan süzülür. Her katman bir alttakinin gereksizlerini atar; aylık rapor kalıcıdır.' },
  { id: 'ses', ad: 'Ses', anatomi: 'Broca alanı · konuşma üretimi', x: 372, y: 392, etiket: 'sol', ayar: 'ses',
    ne: 'Yanıtları ve araya girmeleri sesli okur.',
    nasil: 'Fuber’in tek sesiyle konuşur: ElevenLabs (Türkçe, akışlı) ya da anahtar yoksa bu bilgisayardaki yedek ses (Piper). Fuber yazarken cümle cümle; saat, tarih ve sayılar yazıyla okunur, atıflar ve markdown okunmaz; "Sustur" sesi anında keser.' },
  { id: 'eslikci', ad: 'Araya girme', anatomi: 'Temporal kutup · sosyal beyin', x: 430, y: 560, etiket: 'sol', ayar: 'dusunme',
    ne: 'Konuşmalara gerektiğinde araya girer: hatırlatır, espri yapar.',
    nasil: 'Her yeni cümlede önce ucuz bir ön eleme yapar (notlarda, hafızada, raporlarda iz var mı). İz varsa yardımcı modele "araya girmeli miyim?" diye sorar; güven eşiği, saatlik sınır ve sessiz saatler geçilirse konuşur.' },
  { id: 'el', ad: 'Fare ve klavye', anatomi: 'Motor korteks · hareket', x: 566, y: 104, etiket: 'ust', ayar: 'yetkiler',
    ne: 'Fareni ve klavyeni kullanır.',
    nasil: 'Gümüş "Fuber" imleciyle gerçek imleci aynı kavisle götürür, tıklar, yazar. Fareyi sen tutarsan o görevde çekilir; {acil} her şeyi durdurur.' }, // {acil}: gösterilirken gerçek tuş (genel-kisayol.ts acilYerlestir)
  { id: 'kokpit', ad: 'Kokpit', anatomi: 'Üst parietal · uzamsal yerleşim', x: 748, y: 140, etiket: 'ust',
    ne: 'Kokpitte neyin nerede duracağına karar verir.',
    nasil: 'Hatırlatıcılar, planlar, e-postalar, gün kaydı ve hafıza değişince yardımcı model kartları önem sırasına dizer, selamlama ve günün odağını yazar.' },
  { id: 'hafiza', ad: 'Hafıza', anatomi: 'Neokorteks · uzun süreli bellek', x: 680, y: 276, etiket: 'sag',
    ne: 'Seninle ilgili kalıcı bilgileri atıflarıyla saklar.',
    nasil: `Her sohbetten sonra yardımcı model öğrenilenleri çıkarır; benzeri varsa günceller. Arama kelime + tarih + kişi ile yapılır (yerel SQLite FTS5). ${HAFIZA_NEREDE_GEL}` },
  { id: 'iletisim', ad: 'E-posta ve mesajlar', anatomi: 'Açısal girus · okuma-yazma', x: 878, y: 300, etiket: 'sag',
    ne: 'E-posta ve WhatsApp’ı okur, önemlileri seçer, taslak yazar.',
    nasil: 'Gelen kutusu eşitlenir; yardımcı model önem puanı verir. Gönderim yalnız senin onayınla yapılır.' },
  { id: 'goz', ad: 'Ekran ve web', anatomi: 'Görme korteksi · oksipital lob', x: 972, y: 414, etiket: 'sag', ayar: 'yetkiler',
    ne: 'Ekrana ve web sayfalarına bakar.',
    nasil: 'Ekran görüntüsü alır (Fuber’in kendi katmanları görüntüye girmez) ya da Fuber Tarayıcı’da sayfayı okur; model koordinat ve öğe numarasıyla fare ve klavyeye iş verir.' },
  { id: 'bekci', ad: 'Eski notları silme', anatomi: 'Talamus · neyin kalacağına karar', x: 610, y: 372, derin: true, etiket: 'alt', ayar: 'dusunme',
    ne: 'Neyin ne kadar hatırlanacağını yönetir; süresi dolanı siler.',
    nasil: 'Önemsiz notlar 3 gün, önemliler 7 gün; haftalığın önemsizleri 1 hafta, önemlileri 1 ay; aylık kalıcı. Saatte bir çalışır, süreleri Ayarlar’dan değiştirirsin.' },
  { id: 'kulak', ad: 'Dinleme', anatomi: 'İşitme korteksi', x: 538, y: 452, etiket: 'sol', ayar: 'dusunme',
    ne: 'Mikrofonu dinler; "Hey Fuber"i ve konuşmaları ayırır.',
    nasil: 'Cihazda çalışan Vosk tanıyıcısı kelime zamanlarından konuşmanın sınırını bulur; o bölüm bellekte 16 kHz sese kesilir (diske yazılmaz). Fuber konuşurken kendini duymaz.' },
  { id: 'yazici', ad: 'Konuşmayı yazıya çevirme', anatomi: 'Wernicke alanı · dili anlama', x: 724, y: 444, etiket: 'sag', ayar: 'dusunme',
    ne: 'Konuşmayı yazıya döker.',
    nasil: 'Bu bilgisayardaki Whisper (yerel, ücretsiz, Türkçe+İngilizce) varsa onunla, yoksa Vosk’la. Özel adlar sözlük ipucu olarak gider.' },
  { id: 'saat', ad: 'Hatırlatıcılar', anatomi: 'Suprakiazmatik çekirdek · iç saat', x: 536, y: 606, derin: true, etiket: 'alt',
    ne: 'Hatırlatıcıları zamanında çalar, sabah/akşam özetini başlatır.',
    nasil: 'Her dakika bakar: zamanı gelen hatırlatıcı kokpitin sol üstüne ve bildirime düşer; kendiliğinden yazma işleri (sabah özeti, merak soruları) Fuber’e görev verir.' },
  { id: 'not', ad: 'Günün notları', anatomi: 'Hipokampus · günü belleğe yazar', x: 624, y: 572, derin: true, etiket: 'alt', ayar: 'dusunme',
    ne: 'Gün boyu yazıya dökülen konuşmayı madde madde nota çevirir.',
    nasil: 'Birikmiş satırları yardımcı modele toplu verir (token yemesin diye tek tek değil): önemli/önemsiz maddeler, takip edilecek işler (kim, ne, ne zamana) ve kalıcı bilgi çıkar; kalıcı olan Hafıza’ya geçer.' },
  { id: 'uyanma', ad: '“Hey Fuber”', anatomi: 'Beyin sapı · uyanıklık', x: 726, y: 690, etiket: 'sag', ayar: 'ses',
    ne: '"Hey Fuber" duyunca asistanı uyandırır.',
    nasil: 'Mikrofondan gelen kısa kelime eşleşmesi yeterli güvendeyse asistan ekranın üstünden iner ve sorunu dinler; soru asistana gider.' },
  // I4 (son inceleme): 0.9'da Claude Code uygulama içi yöneticidedir (K17; terminal gerekmez) — eski metin terminal açtığını anlatıyordu.
  { id: 'kod', ad: 'Kod', anatomi: 'Beyincik · öğrenilmiş beceriler', x: 880, y: 604, etiket: 'sag',
    // 0.14 T13: Fuber küçük kod işini kendi araçlarıyla yapar (dosya, komut); yalnız büyük kod işi Claude Code oturumuna gider (ajan/kod-isleri.ts).
    ne: 'Küçük kod işini kendisi yapar; büyük kod işini Claude Code’a verir.',
    nasil: 'Tek dosyalık düzeltmeyi, küçük bir betiği ya da bir komutu kendi dosya ve komut araçlarıyla yapar. Büyük işte bilgisayarındaki bütün Claude Code oturumlarını (~/.claude/projects) bilir: “Şu projede şunu yap” deyince doğru oturumu bulur ve Fuber’in Claude Code sayfasında sürdürür ya da o klasörde yeni oturum açar; komutunu olduğu gibi verir. Terminal gerekmez: araç adımları ve izin istekleri sayfada görünür, izni sen verirsin; iş Claude aboneliğinle yapılır.' },
];

// ── İş modu (K2, Ruling O / K6): sağlayıcı, model ve motor adı olmadan ───────────────────────────────────────────────────
// Geliştirici'de bugünkü ayrıntı (BOLGELER, MOTORLAR, model kimlikleri). İş modunda: motor şeridinde yalnız "Bu bilgisayardaki yapay
// zekâ" ve "Fuber’in yapay zekâsı" (dört bulut sağlayıcı tek hapta toplanır), bölge metinlerinde sağlayıcı/model/token yok, olaylarda model kimliği
// yok; "Kod" bölgesi İş modunda HİÇ görünmez (I4, son inceleme: Claude Code yalnız Geliştirici — K17/K18 "İş modunda hiçbiri
// görünmez"; eskiden claude.exe kuruluysa İş'te de çıkıyordu), olayları da listelenmez. Canlı metinler (olay, bölge notu) kaynakta sade yazılır, teknik ayrıntı ayrı alanda (`ayrinti`: yalnız Geliştirici); İş'te
// hata satırı içeriğe bakmadan hep "bir sorun oldu", yasak sözcük taşıyan öteki metinler bölgenin sade metniyle değişir — isGuvenliMetin.
type Mod = 'is' | 'gelistirici';
const BOLGE_IS: Partial<Record<BolgeId, Partial<Pick<BolgeTanimi, 'ne' | 'nasil'>>>> = {
  ajan: { nasil: 'Mesajınla birlikte çekirdek hafızayı, ilgili hafıza kayıtlarını ve saati okur; Fuber’in yapay zekâsıyla düşünür. Bir araç gerekirse ilgili bölgeye sinyal yollar, sonucu alıp devam eder; en çok 30 adım.' },
  ses: { nasil: 'Fuber’in tek sesiyle, Fuber yazarken cümle cümle konuşur. Atıflar ve biçim işaretleri okunmaz; "Sustur" sesi anında keser.' },
  eslikci: { nasil: 'Her yeni cümlede önce hızlı bir ön eleme yapar (notlarda, hafızada, raporlarda iz var mı). İz varsa "araya girmeli miyim?" diye düşünür; güven eşiği, saatlik sınır ve sessiz saatler geçilirse konuşur.' },
  kokpit: { nasil: 'Hatırlatıcılar, planlar, e-postalar, gün kaydı ve hafıza değişince kartları önem sırasına dizer, selamlama ve günün odağını yazar.' },
  hafiza: { nasil: `Her sohbetten sonra öğrenilenleri çıkarır; benzeri varsa günceller. Arama kelime, tarih ve kişiyle yapılır. ${HAFIZA_NEREDE_IS}` },
  iletisim: { nasil: 'Gelen kutusu eşitlenir; Fuber her iletiye önem puanı verir. Gönderim yalnız senin onayınla yapılır.' },
  goz: { nasil: 'Ekran görüntüsü alır (Fuber’in kendi katmanları görüntüye girmez) ya da Fuber Tarayıcı’da sayfayı okur; gördüğünü fare ve klavyeye iş olarak verir.' },
  kulak: { nasil: 'Bu bilgisayarda çalışan tanıyıcı konuşmanın nerede başlayıp bittiğini bulur; o bölüm bellekte kesilir (diske yazılmaz). Fuber konuşurken kendini duymaz.' },
  yazici: { nasil: 'Konuşmayı yazıya döker; varsayılan olarak bu bilgisayarda ve ücretsiz (Türkçe ve İngilizce). Özel adlar ipucu olarak kullanılır.' },
  not: { nasil: 'Birikmiş satırları tek tek değil toplu işler: önemli/önemsiz maddeler, takip edilecek işler (kim, ne, ne zamana) ve kalıcı bilgi çıkar; kalıcı olan Hafıza’ya geçer.' },
};
const KOD: BolgeId = 'kod';

/** Bölgenin moda göre metni (ne yapar, nasıl çalışır). */
export function bolgeMetni(b: BolgeTanimi, mod: Mod): { ne: string; nasil: string } {
  const is = mod === 'is' ? BOLGE_IS[b.id] : undefined;
  return { ne: is?.ne ?? b.ne, nasil: is?.nasil ?? b.nasil };
}
/** Moda göre haritadaki bölgeler (İş: Kod yok — Claude Code yalnız Geliştirici). */
export const gorunurBolgeler = (mod: Mod): BolgeTanimi[] => (mod === 'is' ? BOLGELER.filter((b) => b.id !== KOD) : BOLGELER);
/** Moda göre bağlar (gizli bölgeye giden bağ yok). */
export const gorunurBaglar = (mod: Mod): typeof BAGLAR => (mod === 'is' ? BAGLAR.filter(([a, b]) => a !== KOD && b !== KOD) : BAGLAR);

/** Hata metninin İş karşılığı (ham hata iletisi İş'te görünmez). */
export const IS_HATA_METNI = 'bir sorun oldu';
/** İş modunda yasak sözcük taşıyan canlı metin (olay, bölge notu) yerine `yedek` (bölgenin sade metni ya da "bir sorun oldu");
 *  Geliştirici'de olduğu gibi. Boş metin boş kalır. */
export function isGuvenliMetin(metin: string | undefined, mod: Mod, yedek: string): string | undefined {
  if (!metin || mod !== 'is') return metin;
  return isDiliIhlali(metin) ? yedek : metin;
}
/** Bölge notunun (son çalışmanın kısa yazısı) moda göre hâli. Geliştirici: not + teknik ayrıntı (varsa). İş: bölge hatadaysa ya da son
 *  not bir hatanın notuysa (`notHata`) içeriğe bakmadan "bir sorun oldu" (ham hata yasak sözcük taşımasa da görünmez: "page.goto:
 *  net::ERR_…"); bölge yeniden çalışırken eski hata notu gösterilmez; öteki notlarda yasak sözcük varsa bölgenin "ne yapar"ı. */
export function bolgeNotu(b: BolgeTanimi, d: { not?: string; ayrinti?: string; hal?: BolgeHali; notHata?: boolean } | undefined, mod: Mod): string | undefined {
  if (mod === 'gelistirici') {
    if (!d?.not) return d?.ayrinti;
    return d.ayrinti && !d.not.includes(d.ayrinti) ? `${d.not} · ${d.ayrinti}` : d.not;
  }
  if (!d) return undefined;
  if (d.hal === 'hata') return IS_HATA_METNI;
  if (d.notHata) return d.hal === 'calisiyor' ? undefined : IS_HATA_METNI;
  return isGuvenliMetin(d.not, mod, bolgeMetni(b, 'is').ne);
}

/** Bağlar yönsüzdür; sinyal her iki yönde akabilir. [a, b, ne taşır] */
export const BAGLAR: [BolgeId, BolgeId, string][] = [
  ['kulak', 'uyanma', '"Hey Fuber"'],
  ['uyanma', 'ajan', 'sesli soru'],
  ['kulak', 'yazici', 'konuşma bölümü'],
  ['yazici', 'not', 'yazıya dökülen konuşma'],
  ['yazici', 'eslikci', 'yeni cümle'],
  ['not', 'hafiza', 'kalıcı bilgi'],
  ['not', 'rapor', 'günün maddeleri'],
  ['rapor', 'ajan', 'rapor sohbete'],
  ['eslikci', 'ses', 'araya girme'],
  ['eslikci', 'hafiza', 'iz arama'],
  ['ajan', 'ses', 'yanıtı seslendir'],
  ['ajan', 'hafiza', 'bağlam / öğrenilen'],
  ['ajan', 'el', 'fare/klavye'],
  ['ajan', 'goz', 'ekran/web'],
  ['ajan', 'iletisim', 'e-posta/WhatsApp'],
  ['ajan', 'saat', 'hatırlatıcı'],
  ['ajan', 'kokpit', 'yerleşim'],
  ['hafiza', 'kokpit', 'durum'],
  ['bekci', 'not', 'süre doldu'],
  ['bekci', 'rapor', 'budama'],
  ['iletisim', 'hafiza', 'önemli ileti'],
  ['goz', 'el', 'ekrandaki yer'],
  ['ajan', 'kod', 'Claude Code’a iş'],
];

export const MOTORLAR: { id: MotorId; ad: string; x: number }[] = [
  { id: 'yerel', ad: 'Yerel model', x: 250 },
  { id: 'anthropic', ad: 'Claude', x: 410 },
  { id: 'openai', ad: 'OpenAI', x: 570 },
  { id: 'openrouter', ad: 'OpenRouter', x: 730 },
];
export const MOTOR_Y = 880;
export const SAHNE = { en: 1200, boy: 940, gorselBoy: 800 };

/** Motor şeridindeki bir hap: Geliştirici'de her motor ayrı; İş'te 'bulut' dört bulut sağlayıcısını tek hapta ("Fuber’in yapay zekâsı") toplar. */
export type SeritId = MotorId | 'bulut';
export interface SeritMotoru { id: SeritId; ad: string; x: number; /** Hap genişliği (sahne birimi). */ en: number; uyeler: readonly MotorId[] }
const BULUT_UYELER: readonly MotorId[] = ['anthropic', 'openai', 'openrouter'];
// 0.10 Görev 1 (P2 sözlüğü): İş adları "Bu bilgisayardaki yapay zekâ" ve "Fuber’in yapay zekâsı" (telefon da bunları gösterir, P8).
const SERIT_IS: readonly SeritMotoru[] = [
  { id: 'yerel', ad: 'Bu bilgisayardaki yapay zekâ', x: 410, en: 200, uyeler: ['yerel'] },
  { id: 'bulut', ad: 'Fuber’in yapay zekâsı', x: 730, en: 236, uyeler: BULUT_UYELER },
];
/** Moda göre motor şeridi (K6: İş'te yalnız iki hap — bu bilgisayardaki ve Bulut yapay zekâ). */
export const motorSeridi = (mod: Mod): readonly SeritMotoru[] => (mod === 'is' ? SERIT_IS : MOTORLAR.map((m) => ({ ...m, en: 152, uyeler: [m.id] })));
/** Olayın motoru şeritte hangi hapta (İş: bulut sağlayıcıları 'bulut'). */
export const seritIdsi = (m: MotorId, mod: Mod): SeritId => (mod === 'is' && m !== 'yerel' ? 'bulut' : m);

/** Şerit hapının durumu: üyelerinden (bağlı: biri bağlı; etkin çağrı ve bugünkü çağrı: toplam). */
export function seritDurumu(s: SeritMotoru, motorlar: readonly MotorDurumu[]): Omit<MotorDurumu, 'id'> & { id: SeritId } {
  const l = motorlar.filter((m) => s.uyeler.includes(m.id));
  return {
    id: s.id, bagli: l.some((m) => m.bagli), aktif: l.reduce((t, m) => t + m.aktif, 0), bugun: l.reduce((t, m) => t + m.bugun, 0),
    // Görev 21: son model kimliği şeride taşınmaz (tek görünen kimlik "Fuber").
  };
}

/** Model çağrısının amacı → onu yapan bölge. */
export function amactanBolge(amac: string): BolgeId {
  if (amac.startsWith('gunkaydi:not')) return 'not';
  if (amac.startsWith('gunkaydi:eslik')) return 'eslikci';
  if (amac.startsWith('gunkaydi:rapor')) return 'rapor';
  if (amac === 'kokpit') return 'kokpit';
  if (amac === 'eposta-onem' || amac === 'whatsapp-onem') return 'iletisim';
  if (amac === 'baslik' || amac === 'ozet' || amac.startsWith('hafiza') || amac.startsWith('iceaktar')) return 'hafiza';
  return 'ajan';
}

/** Ajan aracı → aracı çalıştıran bölge. */
export function aractanBolge(grup: string, ad: string): BolgeId {
  if (grup === 'bilgisayar') return ad === 'bilgisayar_ekran' || ad === 'bilgisayar_pencereler' ? 'goz' : 'el';
  if (grup === 'tarayici') return /_(tikla|yaz|gonder|kaydir|tus)/.test(ad) ? 'el' : 'goz';
  if (grup === 'hafiza' || grup === 'dosya') return ad.startsWith('gun_') || ad.startsWith('mesele') ? 'not' : 'hafiza';
  if (grup === 'web') return 'goz'; // 0.14 T14: web_ara / sayfa_oku dış dünyaya bakar
  if (grup === 'plan') return 'saat';
  if (grup === 'kokpit') return 'kokpit';
  if (grup === 'eposta' || grup === 'whatsapp' || grup === 'mcp') return 'iletisim';
  if (grup === 'claudecode') return 'kod';
  return 'ajan';
}

export type BolgeHali = 'calisiyor' | 'dinliyor' | 'hazir' | 'kapali' | 'hata';

/** 0.11 G10: Görevler'in Etkinlik akışındaki olayları (main/beyin.ts gorevOlayi). */
export type GorevOlayiTuru = 'basladi' | 'kontrol' | 'adim' | 'bitti' | 'durdu' | 'surdu';

export interface BeyinOlayi {
  id: number;
  zaman: string;
  /** 'gorev' (0.11 G10): Görev başladı / kontrol etti / adım attı / bitti / durdu / yeniden başladı — `gorev` alanı taşır, bölgesi 'saat'; telefona gitmez. */
  tur: 'basla' | 'bitti' | 'sinyal' | 'motor' | 'gorev';
  bolge: BolgeId;
  /** Yalnız `tur: 'gorev'`: hangi olay, hangi görev (başlık), nedeni (durdu), adım özeti (adim), art arda kaç kontrol tek satırda toplandı (kontrol). */
  gorev?: { olay: GorevOlayiTuru; id: number; baslik: string; neden?: DurmaNedeni; ozet?: string; n?: number };
  hedef?: BolgeId;
  motor?: MotorId;
  faz?: 'istek' | 'yanit';
  model?: string;
  /** Kullanıcıya görünen sade metin (iki modda). */
  metin?: string;
  /** Teknik ayrıntı (yazıcı motorunun adı, ses sağlayıcısı, ham hata iletisi): yalnız Geliştirici modunda gösterilir. */
  ayrinti?: string;
  sure?: number; // ms
  hata?: boolean;
}

/** `notHata`: son not bir hatanın notu (İş'te içeriğe bakılmadan "bir sorun oldu" gösterilir; bölge 60 sn sonra "hata"dan çıksa da). */
export interface BolgeDurumu { id: BolgeId; hal: BolgeHali; aktif: number; bugun: number; son?: string; not?: string; ayrinti?: string; notHata?: boolean; neden?: string }
/** Görev 21 (K10): model kimliği taşınmaz — model adı yalnız Ayarlar → Yapay zekâ'da (Geliştirici). */
export interface MotorDurumu { id: MotorId; bagli: boolean; aktif: number; bugun: number }
export interface BeyinDurumu { bolgeler: BolgeDurumu[]; motorlar: MotorDurumu[]; olaylar: BeyinOlayi[] }

/** Bir bölgenin neden kapalı olduğunu söylemek için gereken anlık durum (ana süreç doldurur; main.ts beyinBagla). */
export interface KapaliGirdisi {
  mod: 'is' | 'gelistirici';
  mikrofonKapali: boolean;
  uyandirma: boolean;
  seslendirme: boolean;
  gunKaydi: boolean;
  eslikciKapali: boolean;
  bilgisayar: boolean;
  tarayici: boolean;
  iletisimVar: boolean;
  /** R28c (G2 düzeltme turu 1): motorun YANIT VERİLEBİLİR hâli — tek kaynaktan (shared/motor-durumu.ts motorGorunumu → adaMotoru; ana
   *  süreç main.ts beyinBagla): hesap hâlleri ve Gizli mod dahil; yalnız bu bilgisayardaki yapay zekâ yanıtlıyorsa 'yerel'. */
  motor: MotorGorunumu;
  /** Uyandırma motorunun durumu (0.13 T8): ayar açık ama motor çalışmıyorsa neden "ayar kapalı" değildir. Yoksa çalışıyor sayılır. */
  uyandirmaDurumu?: UyandirmaDurumu;
  /** Gizli mod açık (sinyalin `gizli`si). */
  gizli?: boolean;
  /** Hazırlık duraklamış (sinyalin `yarim`ı; F1 düzeltme turu 1, K-1). */
  yarim?: boolean;
  claudeCodeEtkin: boolean;
  claudeBulundu: boolean;
}

/**
 * Bölge kapalıysa nedeni ve nereden açılacağı (açıksa undefined). Yollar bugünkü Ayarlar adlarıyla (Görev 10: "Ses ve ada"; Görev 14:
 * İş modunda motor Hesap ve kullanım'dan gelir, "Motorlar" yalnız Geliştirici'de; Claude Code ayarı Claude Code sayfasında). Görev 19
 * denetimi eski yolları ("Ayarlar → Ses", "Ayarlar → Motorlar", "Ayarlar → Claude Code") buldu.
 */
export function bolgeKapaliNedeni(b: BolgeId, d: KapaliGirdisi): string | undefined {
  const dusunmeKapali = 'Gün kaydı kapalı (Ayarlar → Gün kaydı)';
  switch (b) {
    case 'uyanma': {
      if (d.mikrofonKapali) return 'Mikrofon kapalı (sol menü)';
      if (!d.uyandirma) return '"Hey Fuber" kapalı (Ayarlar → Ses ve ada)';
      return d.uyandirmaDurumu && d.uyandirmaDurumu !== 'calisiyor' ? UYANDIRMA_DUSTU_METNI : undefined;
    }
    case 'kulak': {
      if (d.mikrofonKapali) return 'Mikrofon kapalı (sol menü)';
      if (d.gunKaydi || (d.uyandirma && d.uyandirmaDurumu !== 'vazgecti')) return undefined;
      return d.uyandirma ? UYANDIRMA_DUSTU_METNI : 'Mikrofon kullanılmıyor: "Hey Fuber" ve gün kaydı kapalı';
    }
    case 'yazici': case 'not': case 'rapor': case 'bekci': return d.gunKaydi ? undefined : dusunmeKapali;
    case 'eslikci': return !d.gunKaydi ? dusunmeKapali : d.eslikciKapali ? 'Araya girme kapalı (Ayarlar → Gün kaydı)' : undefined;
    case 'ses': return d.seslendirme ? undefined : 'Sesli yanıt kapalı (Ayarlar → Ses ve ada)';
    case 'el': return d.bilgisayar ? undefined : 'Fare/klavye yetkisi kapalı (Ayarlar → Yetkiler)';
    case 'goz': return d.bilgisayar || d.tarayici ? undefined : 'Ekran ve tarayıcı yetkisi kapalı (Ayarlar → Yetkiler)';
    case 'iletisim': return d.iletisimVar ? undefined : 'E-posta ya da WhatsApp bağlı değil (Bağlantılar)';
    case 'ajan': return akilKapaliNedeni(d);
    case 'kod': return !d.claudeCodeEtkin ? 'Claude Code yöneticisi kapalı (Claude Code sayfası → Ayarlar)' : d.claudeBulundu ? undefined
      : d.mod === 'gelistirici' ? 'Claude Code (claude.exe) bu bilgisayarda bulunamadı' : 'Kod yardımcısı bu bilgisayarda bulunamadı';
    default: return undefined;
  }
}

/** Akıl bölgesi (R28c): yanıt verilebiliyorsa (bulut ya da bu bilgisayardaki yapay zekâ) açık; değilse motor durumunun nedeni. Metinler tek
 *  sözlükten (G3, shared/terimler.ts): İş'te "Fuber’in yapay zekâsı" / "bu bilgisayardaki yapay zekâ", Geliştirici'de "motor" / "yerel model";
 *  Ayarlar kategorisi "Gizlilik" (G3'te "Gizlilik ve yerel beyin" adı kalktı). */
function akilKapaliNedeni(d: KapaliGirdisi): string | undefined {
  if (!motorEngelliMi(d.motor)) return undefined;
  const gel = d.mod === 'gelistirici';
  // F1 (Ö2): hazırlanırken bildirimin aynı nötr cümlesi (shared/motor-durumu.ts tek kaynak; "hazır değil" denmez).
  // 0.12 H3c: Gizli kapalıyken 'hazirlaniyor' yalnız "Yalnız bu bilgisayar" seçiliyken doğar (kendi nötr cümlesi; Gizli denmez).
  if (d.motor === 'hazirlaniyor') return motorBildirimi('hazirlaniyor', d.mod, null, d.gizli !== false, d.yarim === true, d.gizli === false)?.baslik;
  // H3c düzeltme turu 1 (P14 K1): "Yalnız bu bilgisayar" seçili, yerel hazır değil — kendi sakin cümlesi.
  if (d.motor === 'yerel-hazir-degil') return `${motorBildirimi('yerel-hazir-degil', d.mod)?.baslik ?? ''} (Ayarlar → Gizlilik)`;
  if (d.gizli) return `Gizli mod açık, ${yerelAdi(!gel)} hazır değil (Ayarlar → Gizlilik)`;
  const hesapta = '(Ayarlar → Hesap ve kullanım)';
  if (d.motor === 'hesap-bekliyor') return `Hesabın onay bekliyor ${hesapta}`;
  if (d.motor === 'hesap-kapali') return `Fuber erişimi kapalı ${hesapta}`;
  if (d.motor === 'kredi-bitti') return `Kullanım hakkın doldu ${hesapta}`;
  return gel ? 'Hiçbir yapay zekâ motoru bağlı değil (Ayarlar → Hesap ve kullanım)' : `${TERIM.yzBulut} bağlı değil ${hesapta}`;
}

/** İki bölge arasındaki bağın adı (yönsüz); yoksa null. */
export function bagBul(a: BolgeId, b: BolgeId): { ters: boolean; ne: string } | null {
  for (const [x, y, ne] of BAGLAR) {
    if (x === a && y === b) return { ters: false, ne };
    if (x === b && y === a) return { ters: true, ne };
  }
  return null;
}

// ── Büyük canlı beyin (Beyin sayfasının üstü) ────────────────────────────────────────────────────────────────────
// Beyin animasyonu ana sayfada yersiz duruyordu; bol animasyonlu hâli ayrıntılarıyla Beyin sayfasındadır.
// Canlı beynin yanındaki ayrıntılar (genel hâl, çalışan bölgeler, motorlar, son olaylar) buradaki saf işlevlerden gelir.

/** Beynin genel hâli (ana süreçteki 'zihin:durum' ile aynı sözlük). */
export type ZihinHali = 'bos' | 'dusunuyor' | 'dinliyor' | 'konusuyor';
export const ZIHIN_ADI: Record<ZihinHali, string> = { bos: 'hazır', dusunuyor: 'düşünüyor', dinliyor: 'dinliyor', konusuyor: 'konuşuyor' };

/**
 * Genel hâl: ana süreç "düşünüyor / dinliyor / konuşuyor" bildirdiyse o; bildirmediyse çalışan bölgelerden türer
 * (Akıl → düşünüyor, Ses → konuşuyor, Uyanma → dinliyor). Not tutucu gibi arka plan işleri beyni "düşünüyor" yapmaz.
 */
export function zihinHali(bildirilen: string | undefined, calisanlar: readonly BolgeId[]): ZihinHali {
  if (bildirilen === 'dusunuyor' || bildirilen === 'dinliyor' || bildirilen === 'konusuyor') return bildirilen;
  if (calisanlar.includes('ajan')) return 'dusunuyor';
  if (calisanlar.includes('ses')) return 'konusuyor';
  if (calisanlar.includes('uyanma')) return 'dinliyor';
  return 'bos';
}

/** "A", "A ve B", "A, B ve C". */
export function listeBirlestir(adlar: readonly string[]): string {
  if (adlar.length < 2) return adlar[0] ?? '';
  return `${adlar.slice(0, -1).join(', ')} ve ${adlar[adlar.length - 1]}`;
}

/** Süren arka plan görevleri (isler): kokpitin Görevler kartıyla AYNI kaynak (shared/isler-gorunum.ts gorevSayaci). `adimda`: şu an yapay zekâ
 *  adımı atan görev sayısı. */
export interface GorevSayaci { suren: number; adimda: number }

/** Canlı beynin başlığı (genel hâl) ve alt satırı (neyin çalıştığı). 11 Kas (tasarımcı bulgu 1): süren görev varken "Hazır" denmez — Etkinlik ve
 *  kokpit birbiriyle çelişmesin; görev sayısı kokpitin Görevler kartının okuduğu listeden gelir. */
export function durumOzeti(hali: ZihinHali, calisanAdlari: readonly string[], kulakDinliyor = false, gorev?: GorevSayaci): { baslik: string; alt: string } {
  const alt = calisanAdlari.length ? `${listeBirlestir(calisanAdlari)} çalışıyor` : '';
  const suren = Math.max(0, gorev?.suren ?? 0);
  const gorevEki = suren ? ` · ${suren} görev sürüyor` : '';
  switch (hali) {
    case 'dusunuyor': return { baslik: 'Düşünüyor', alt: (alt || 'Yanıtı hazırlıyor') + gorevEki };
    case 'dinliyor': return { baslik: 'Dinliyor', alt: (alt || 'Fuber seni dinliyor.') + gorevEki };
    case 'konusuyor': return { baslik: 'Konuşuyor', alt: (alt || 'Yanıtı seslendiriyor') + gorevEki };
    default: {
      if (suren) {
        const adimda = (gorev?.adimda ?? 0) > 0;
        const ilk = `${suren} görev sürüyor; ${adimda ? 'şu an bir adım atıyor.' : 'sıradaki kontrolü bekliyor.'}`;
        return { baslik: adimda ? 'Görev üzerinde çalışıyor' : 'Görevleri takip ediyor', alt: alt ? `${ilk} ${alt}.` : ilk };
      }
      return calisanAdlari.length
        ? { baslik: 'Arka planda çalışıyor', alt }
        : { baslik: 'Hazır', alt: `${kulakDinliyor ? 'Mikrofon dinliyor; ' : 'Sessiz; '}Fuber hazır bekliyor.` };
    }
  }
}

const bolgeAdi = (b: BolgeId) => BOLGELER.find((x) => x.id === b)?.ad ?? b;

/** Görev durduğunda Akış'taki kısa neden (G9 DurmaNedeni; tam cümleler Görevler kartında: shared/isler-gorunum.ts). Son inceleme I1: "Gizli mod
 *  açıldı" yalnız Gizli'de; yol başka nedenle yerelse nötr söz (gizlilik vaadi yok). */
const GOREV_NEDEN: Record<DurmaNedeni, string> = {
  kullanici: 'sen durdurdun', acil: 'acil durdurma', kapanis: 'Fuber kapandı', sinir: 'adım sınırı', hata: 'ilerleyemedi', gizli: 'Gizli mod açıldı',
  yerel: 'yapay zekâ şu an yalnız bu bilgisayarda',
};
/** Görev olayının Akış satırı: üst = ne oldu ("Görev kontrol etti"), alt = hangi görev + ayrıntı. Başlık/özet kullanıcı ve yapay zekâ metnidir: İş
 *  modunda yasak sözcük taşırsa özet düşer, başlık taşırsa alt TERIM.gorev ("Görev") olur. */
function gorevOlaySatiri(o: BeyinOlayi, mod: Mod): { ust: string; alt?: string } | null {
  const g = o.gorev;
  if (!g) return null;
  const ek = (...parcalar: (string | undefined)[]) => [g.baslik, ...parcalar].filter(Boolean).join(' · ');
  const guvenli = (m: string) => isGuvenliMetin(m, mod, TERIM.gorev) as string;
  switch (g.olay) {
    case 'basladi': return { ust: `${TERIM.gorev} başladı`, alt: guvenli(g.baslik) };
    case 'kontrol': return { ust: `${TERIM.gorev} kontrol etti`, alt: guvenli(ek(g.n && g.n > 1 ? `${g.n} kez` : undefined, 'değişiklik yok')) };
    case 'adim': {
      const ozet = g.ozet ? isGuvenliMetin(g.ozet.replace(/\s+/g, ' ').trim(), mod, '') : '';
      return { ust: `${TERIM.gorev} adım attı`, alt: guvenli(ek(ozet || undefined)) };
    }
    case 'bitti': return { ust: `${TERIM.gorev} bitti`, alt: guvenli(g.baslik) };
    case 'surdu': return { ust: `${TERIM.gorev} yeniden başladı`, alt: guvenli(g.baslik) };
    case 'durdu': return { ust: `${TERIM.gorev} durdu`, alt: guvenli(ek(g.neden ? GOREV_NEDEN[g.neden] : undefined)) };
  }
}
/** Motorun görünen adı: Geliştirici'de sağlayıcı (Claude, OpenAI…), İş'te şeritteki hap ("Bu bilgisayardaki yapay zekâ", "Fuber’in yapay zekâsı"). */
export const motorAdi = (m: MotorId, mod: Mod = 'gelistirici') => {
  const id = seritIdsi(m, mod);
  return motorSeridi(mod).find((x) => x.id === id)?.ad ?? m;
};
const sureMetni = (ms?: number) => (ms === undefined ? '' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1).replace('.', ',')} sn`);

/** İş modunda sinyal satırının yedek metni: bağın adı (BAGLAR; yasak sözcük taşımıyorsa), yoksa hedef bölgenin sade metni. */
function sinyalYedegi(a: BolgeId, b: BolgeId): string {
  const bag = bagBul(a, b);
  if (bag && !isDiliIhlali(bag.ne)) return bag.ne;
  const hedef = BOLGELER.find((x) => x.id === b);
  return hedef ? bolgeMetni(hedef, 'is').ne : '';
}

const buyukHarf = (m: string) => (m ? m.charAt(0).toLocaleUpperCase('tr-TR') + m.slice(1) : m);

/** Akış listesinde tek satır, DÜZ CÜMLE (0.13 T15: "Akıl → Ses" gibi ok işaretli bölge adları kalktı). `ust` = ne oldu (olayın kendi sade metni:
 *  "Hatırlatıcı kuruyor", "3 e-posta okundu"), `alt` = hangi özellik (Düşünme, Hatırlatıcılar…; Geliştirici'de teknik ayrıntı yanında).
 *  Başla/bitti gürültüsü süzülür: yalnız sinyaller, motorlar, hatalar ve açıklamalı başlangıçlar. İş modunda model kimliği ve teknik ayrıntı
 *  yazılmaz, motor şeritteki adıyla görünür; hata satırı içeriğe bakmadan "bir sorun oldu", yasak sözcük taşıyan öteki metin bölgenin sade
 *  metniyle (sinyalde bağın adıyla) değişir; İş'te Kod olayları listelenmez. */
export function olayMetni(o: BeyinOlayi, mod: Mod = 'gelistirici'): { ust: string; alt?: string } | null {
  if (mod === 'is' && (o.bolge === KOD || o.hedef === KOD)) return null;
  if (o.tur === 'gorev') return gorevOlaySatiri(o, mod);
  const ile = (ust: string, alt?: string) => (alt ? { ust, alt } : { ust });
  /** Özelliğin adı; Geliştirici'de teknik ayrıntı (`ayrinti`) yanında. */
  const alan = (b: BolgeId) => (mod === 'gelistirici' && o.ayrinti ? `${bolgeAdi(b)} · ${o.ayrinti}` : bolgeAdi(b));
  /** Olayın kendi metni cümle olur; yoksa ya da İş'te yasak sözcük taşıyorsa `yedek`. */
  const cumle = (metin: string | undefined, yedek: string) => buyukHarf((metin && isGuvenliMetin(metin, mod, yedek)) || yedek);
  if (o.tur === 'sinyal' && o.hedef) {
    const ozellik = o.bolge === 'ajan' ? o.hedef : o.bolge; // araç çağrısında ve sonucunda özellik, ajan olmayan uçtur
    return ile(cumle(o.metin, sinyalYedegi(o.bolge, o.hedef) || `${bolgeAdi(ozellik)} kullanıldı`), alan(ozellik));
  }
  if (o.tur === 'motor' && o.motor) {
    // Görev 21: tek görünen kimlik "Fuber" — model kimliği Beyin'de iki modda da yazılmaz (yalnız Ayarlar → Yapay zekâ, Geliştirici).
    const ad = motorAdi(o.motor, mod);
    return o.faz === 'istek' ? ile(`${ad} çalışıyor`, bolgeAdi(o.bolge)) : ile(`${ad} ${o.hata ? 'yanıt veremedi' : 'yanıtladı'}`, [bolgeAdi(o.bolge), sureMetni(o.sure)].filter(Boolean).join(' · '));
  }
  if (o.tur === 'basla' && o.metin) {
    const bolge = BOLGELER.find((b) => b.id === o.bolge);
    return ile(cumle(o.metin, bolge ? bolgeMetni(bolge, 'is').ne : `${bolgeAdi(o.bolge)} çalışıyor`), alan(o.bolge));
  }
  if (o.tur === 'bitti' && o.hata) {
    // İş: ham hata hiç görünmez; Geliştirici: olayın metni ve teknik ayrıntısı.
    const ham = [o.metin, o.ayrinti].filter(Boolean).join(' · ');
    return ile(`${bolgeAdi(o.bolge)} çalışırken ${IS_HATA_METNI}`, mod === 'gelistirici' && ham ? ham : undefined);
  }
  return null;
}
