// ── Ayarlar dizini: kategoriler, akordeon grupları ve ayarların METİNLERİ (tek kaynak) ─────────────────────────────────
// Her ayar grubu ayrı bir düğmede, üst kategoriler altında; basınca o kategorinin ayarları akordeon olarak açılır.
// Saf veri (JSX yok): Ayarlar kabuğu (sayfalar/Ayarlar.tsx) kategori listesini ve aramayı buradan kurar; grup içerikleri
// (bileşenler) kayit.ts'te eşlenir; satırlar (ayarlar/Ortak.tsx → Satir) ad ve açıklamayı kimlikle buradan okur — arama ile ekran
// aynı metni gösterir. Birim testi (tests/ayar-arama.test.ts) ve önizleme betiği (scripts/dev/ayarlar-onizle.mjs) de bunu okur;
// betik her kimliğin ekranda `[data-ayar]` olarak bulunduğunu denetler.
// Mod (K2): `gelistirici: true` kategori/grup/ayar İş modunda hiç görünmez ve aranmaz. İş modunda görünen metinlerde "API",
// "anahtar", "model", "token" geçmez (anti-hedef; testli) — gerekiyorsa `aciklamaIs` yazılır; arama sözcüklerinde de sağlayıcı ve
// teknik ad olmaz (aramayla sızmasın) — gerekiyorsa `anahtarIs`.
// Sonraki görevler: Görev 14 'hesap' kategorisini doldurdu (grup/ayar tanımları burada, içerik Hesap.tsx'te; 0.11 G8: abonelik yerine
// "Hesap ve kullanım"). Kabuğa dokunmadan kategori, grup ve ayar eklenebilir. 0.13 T15 (Spec H): "Yapay zekâ" kategorisi (motor anahtar
// kartları, rol başına model kartları, Claude web araması) kalktı — kimse API anahtarı girmez; Fuber'in modeli ya da yerel model.
import { temaGocu } from '../../shared/tema-cozum.ts';
import type { Ayarlar } from '../../shared/tipler.ts';
import type { AyarTanimi, EskiCipalar, GrupTanimi, KategoriTanimi } from '../../shared/ayar-arama.ts';
import { hitapMetni } from '../../shared/hitap.ts';
import { KIP_ADI } from '../../shared/karakterler.ts';
import { karakterGorunurMu } from '../../shared/karakter-gorunum.ts';
import { sureSuruyor } from '../../shared/ada.ts';
import { uyariAnahtarlari } from '../../shared/sistem-uyarilari.ts';
import { acikSayfalar } from '../../shared/centik-sayfalar.ts';
import { sehirBul } from '../../shared/pano.ts';
import { gizliKapsami } from '../../shared/kurulum-yerel.ts';
import { BULUT_YZ_KAPALI, YEDEK_SES_NASIL } from '../../shared/gizlilik-metni.ts';
import { TERIM, buyukBasla } from '../../shared/terimler.ts';
import { kisayolGosterimi } from '../../shared/kisayol.ts';
import { VARSAYILAN_ASISTAN } from '../../shared/genel-kisayol.ts';
import { claudeRolSecimi, claudeSecili, etkinSaglayiciAdi, openaiUyumluSecili } from '../../shared/motor-secimi.ts';

/** Kısayol açıklamasındaki varsayılan tuş platforma göre (Mac'te ⌘). Önizleme betikleri ve testler (pencere yok) Windows yazımını görür. */
const MAC = typeof window !== 'undefined' && window.fuber?.platform === 'darwin';

export type KategoriId =
  | 'motor' | 'genel' | 'gorunum' | 'pano' | 'ses' | 'gizlilik' | 'proaktif' | 'dusunme' | 'yetkiler' | 'kullanim' | 'veri';

export interface AyarGrubu extends GrupTanimi {
  /** Kapalı akordeonun başlığında sağda görünen kısa durum ("Koyu", "Açık · 08:30"). */
  ozet?: (a: Ayarlar) => string | undefined;
  ayarlar: readonly AyarTanimi[];
}
export interface AyarKategorisi extends KategoriTanimi {
  id: KategoriId;
  /** Ikon.tsx adı. */
  simge: string;
  /** Kenar listesinde bölüm (aralarında ince çizgi). */
  bolum: number;
  /** Sağdaki başlığın altındaki bir cümle. */
  giris: string;
  /** İş modundaki giriş cümlesi (yoksa `giris`). */
  girisIs?: string;
  gruplar: readonly AyarGrubu[];
}

const acikKapali = (v: boolean | undefined) => (v ? 'Açık' : 'Kapalı');
const TEMA_ADI = { koyu: 'Koyu', acik: 'Açık', cam: 'Şeffaf', sistem: 'Otomatik' } as const;
const saatMetni = (iso: string) => new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
/** Ada grubunun özeti: raydaki ada düğmesinin durumu gibi (kapalı / 1 saat gizli / boştayken görünür / yalnız bir şey olunca). */
function adaOzeti(a: Ayarlar): string {
  const g = a.gorunum;
  if (g?.ada === 'kapali') return 'Kapalı';
  if (sureSuruyor(g?.adaGizliBitis, Date.now())) return `${saatMetni(g.adaGizliBitis!)}’e kadar gizli`;
  return g?.adaSessiz !== false ? 'Boştayken görünür' : 'Yalnız bir şey olunca';
}
/** Pano → Konum özeti: seçili şehir ya da "Otomatik". */
function panoSehirOzeti(a: Ayarlar): string {
  const s = sehirBul(a.pano?.sehir);
  return s ? s.ad : 'Otomatik';
}
/** Yapay zekâ sağlayıcısı özeti: etkin olan ("Claude (Anthropic)" ya da "Fuber"); Claude seçili ama anahtar yoksa bunu söyler. */
function saglayiciOzeti(a: Ayarlar): string {
  if (a.motorSecimi === 'anthropic' && !claudeSecili(a)) return 'Fuber · Claude anahtarı bekleniyor';
  if (a.motorSecimi === 'openai' && !openaiUyumluSecili(a)) return 'Fuber · kendi sağlayıcın bekleniyor';
  return etkinSaglayiciAdi(a);
}
/** "claude-opus-5-5" → "Opus 5.5" (özet satırı kısa kalsın). */
const kisaModel = (id: string) => id.replace(/^claude-/, '').replace(/-(\d+)-(\d+)(?:-\d{8})?$/, ' $1.$2').replace(/^./, (c) => c.toUpperCase());
export const KATEGORILER: readonly AyarKategorisi[] = [
  {
    // 0.14 (ürün kararı): 0.13 T15'in "kullanıcı anahtarı yok" kuralı tersine döner. 5 Kas (Business kullanıcıları da kendi
    // API anahtarını kullanabilir): kategori iki modda görünür. Business'ta TEK satır: "Kendi Claude anahtarım" (kaydet = kullan, Sil = Fuber'e
    // dön); sağlayıcı seçimi ve Claude modelleri `gelistirici: true` (yalnız Developer). İçerik ayarlar/Saglayici.tsx; Business'ta satır
    // `data-is-dili-istisna` taşır (İş dili taraması o satırda yalnız sağlayıcı adlarını ve "anahtar"ı atlar). tests/claude-anahtari.test.ts.
    id: 'motor', ad: 'Yapay zekâ sağlayıcısı', aciklama: 'Claude (Anthropic) ya da kendi sağlayıcın', aciklamaIs: 'Kendi Claude hesabın ya da kendi sağlayıcın', simge: 'parilti', bolum: 0, isDiliIstisna: true,
    giris: 'Yanıtların hangi sağlayıcıdan geleceği. Gizli mod ve “Yalnız bu bilgisayar” seçiliyken buluttaki sağlayıcılar kapalı.',
    girisIs: 'Yanıtlar kendi Claude hesabından gelir. Gizli mod ve “Yalnız bu bilgisayar” seçiliyken kullanılmaz.',
    gruplar: [
      { id: 'claude-anahtari', baslik: 'Claude anahtarı', baslikIs: 'Kendi Claude anahtarım', aciklama: 'Anthropic hesabının anahtarı', ozet: (a) => (a.mod === 'is' ? (claudeSecili(a) ? 'Kullanılıyor' : 'Kullanılmıyor') : a.claudeAnahtariVar ? 'Kayıtlı' : 'Kayıtlı değil'), ayarlar: [
        { id: 'claude-anahtar', ad: 'Anthropic anahtarı', aciklama: 'Anthropic Console’da oluşturulan anahtar (sk-ant- ile başlar). Windows şifrelemesiyle bu bilgisayarda saklanır; arayüzde yeniden gösterilmez, telefondan okunamaz.',
          aciklamaIs: 'Anthropic Console’da oluşturduğun anahtar (sk-ant- ile başlar). Kaydedince yanıtlar senin Claude hesabından gelir, ücretini Anthropic alır; Sil deyince bağlantı kapanır. Bu bilgisayarda şifreli saklanır, yeniden gösterilmez.',
          anahtar: ['anahtar', 'anthropic', 'claude', 'console', 'sk-ant', 'bağlantıyı dene', 'sil', 'kendi', 'api'] },
      ] },
      // Açık kaynak hazırlığı (11 Kas): kendi OpenAI uyumlu sağlayıcın — Fuber hesabı gerekmez (ayarlar/Saglayici.tsx OpenaiUyumluGrubu). Satır yalnız
      // Developer'da (Business'ın tek satırı "Kendi Claude anahtarım" kalır; İş dili kuralı); kayıtlı seçim iki modda da geçerli (motor/secici.ts).
      { id: 'kendi-saglayici', baslik: 'Kendi sağlayıcın (OpenAI uyumlu)', aciklama: 'OpenAI, OpenRouter ya da bu bilgisayardaki Ollama / LM Studio', gelistirici: true, ozet: (a) => (openaiUyumluSecili(a) ? `Kullanılıyor · ${a.openaiUyumlu?.model ?? ''}` : 'Kullanılmıyor'), ayarlar: [
        { id: 'openai-taban', ad: 'Taban adresi', aciklama: 'OpenAI uyumlu sunucunun adresi (https; bu bilgisayardaki sunucu için http://127.0.0.1 da olur).', anahtar: ['openai', 'openrouter', 'ollama', 'lm studio', 'taban', 'adres', 'url', 'kendi', 'sağlayıcı', 'hesapsız'], gelistirici: true },
        { id: 'openai-model', ad: 'Model', aciklama: 'Sağlayıcının model adı (ör. gpt-5.5, openai/gpt-5.5, llama3.2). Sohbet ve arka plan işleri bu modelle.', anahtar: ['model', 'openai', 'ollama', 'kendi'], gelistirici: true },
        { id: 'openai-anahtar', ad: 'Anahtar', aciklama: 'Sağlayıcının anahtarı; ücretini sağlayıcı alır. Windows şifrelemesiyle bu bilgisayarda saklanır, yeniden gösterilmez. Bu bilgisayardaki sunucu için gerekmez.', anahtar: ['anahtar', 'api', 'openai', 'openrouter', 'kendi', 'sil'], gelistirici: true },
      ] },
      { id: 'saglayici', baslik: 'Sağlayıcı', aciklama: 'Claude (Anthropic) ya da kendi sağlayıcın', ozet: saglayiciOzeti, gelistirici: true, ayarlar: [
        { id: 'motor-secimi', ad: 'Sağlayıcı', aciklama: 'Claude (Anthropic): sohbet ve arka plan işleri senin Anthropic hesabına gider, ücretini Anthropic alır. Kendi sağlayıcın: OpenAI uyumlu bir sunucu.', anahtar: ['sağlayıcı', 'motor', 'claude', 'anthropic', 'fuber', 'yapay zekâ', 'bulut'], gelistirici: true },
      ] },
      { id: 'claude-modelleri', baslik: 'Claude modelleri', aciklama: 'Rol başına model, düşünme gücü ve web araması', gelistirici: true, ozet: (a) => `${kisaModel(claudeRolSecimi(a, 'ana').model)} · ${kisaModel(claudeRolSecimi(a, 'yardimci').model)}`, ayarlar: [
        { id: 'claude-ana-model', ad: 'Sohbet modeli', aciklama: 'Sohbet ve araç kullanan işler. Varsayılan: Claude Opus 5.5, orta düşünme gücü.', anahtar: ['model', 'opus', 'sonnet', 'sohbet', 'düşünme gücü', 'efor'], gelistirici: true },
        { id: 'claude-yardimci-model', ad: 'Arka plan modeli', aciklama: 'Hafıza, başlık, kokpit planı ve e-posta önem sıralaması. Varsayılan: Claude Haiku 5.5, düşük düşünme gücü.', anahtar: ['model', 'haiku', 'arka plan', 'yardımcı', 'düşünme gücü', 'efor'], gelistirici: true },
        { id: 'claude-web-arama', ad: 'Claude’un web araması', aciklama: 'Claude seçiliyken sohbet modeli gerektiğinde Anthropic’in kendi web aramasını kullanır; ücreti Anthropic hesabına yazılır.', anahtar: ['web', 'arama', 'internet', 'güncel'], gelistirici: true },
      ] },
    ],
  },
  {
    id: 'genel', ad: 'Genel', aciklama: 'Kimlik, kullanım biçimi, açılış, hakkında', simge: 'kaydirici', bolum: 1,
    giris: 'Fuber’in sana nasıl seslendiği, nasıl çalıştığı ve ne zaman açıldığı.',
    gruplar: [
      { id: 'kimlik', baslik: 'Kimlik', aciklama: 'Adın ve Fuber’in sana hitabı', ozet: (a) => hitapMetni(a.kullaniciAdi, a.hitap) || undefined, ayarlar: [
        { id: 'ad', ad: 'Adın', aciklama: 'Fuber sana bu adla seslenir.', anahtar: ['isim', 'kullanıcı adı'] },
        { id: 'hitap', ad: 'Hitap', aciklama: 'Bey, Hanım ya da tam bir ifade (Hocam).', anahtar: ['seslenme', 'unvan', 'bey', 'hanım'] },
      ] },
      { id: 'mod', baslik: 'Kullanım biçimi', aciklama: `${KIP_ADI.is} ya da ${KIP_ADI.gelistirici}`, ozet: (a) => KIP_ADI[a.mod], ayarlar: [
        { id: 'mod', ad: 'Kullanım biçimi', aciklama: `${KIP_ADI.is} sade ve hazırdır; ${KIP_ADI.gelistirici} her ayarı açar. İstediğin zaman değiştirebilirsin.`, anahtar: ['mod', 'business mode', 'developer mode', 'iş', 'geliştirici', 'developer', 'business', 'basit', 'gelişmiş', 'uzman', 'karakter'] },
      ] },
      { id: 'baslangic', baslik: 'Açılış', aciklama: 'Windows açılınca', ozet: (a) => acikKapali(a.baslangictaAc), ayarlar: [
        { id: 'baslangic', ad: 'Windows açılışında başlat', aciklama: 'Tepside sessizce çalışır.', anahtar: ['otomatik başlat', 'açılışta', 'tepsi', 'başlangıç'] },
      ] },
      // Ruling BC; 0.10 Görev 1 (D-26): pakete giren bileşenlerin atıfları (shared/ucuncu-taraf.ts).
      { id: 'hakkinda', baslik: 'Hakkında', aciklama: 'Sürüm ve atıflar', ayarlar: [
        { id: 'atiflar', ad: 'Sürüm ve atıflar', aciklama: 'Fuber AI’ın sürümü, kullandığı açık veri ve yazılımlar, lisans metinleri.', anahtar: ['hakkında', 'sürüm', 'versiyon', 'lisans', 'atıf', 'telif', 'açık kaynak', 'electron', 'üçüncü taraf'] },
      ] },
    ],
  },
  {
    id: 'gorunum', ad: 'Görünüm', aciklama: 'Tema, karakterler, çentik ve tanıtım', simge: 'gunes', bolum: 1,
    giris: 'Koyu, açık, şeffaf ya da Windows’a uyan otomatik tema; karakterlerin görünüp görünmeyeceği; çentiğin tam ekran davranışı, az hareket ve sistem uyarıları.',
    gruplar: [
      { id: 'tema', baslik: 'Tema', aciklama: 'Koyu, açık, şeffaf, otomatik', ozet: (a) => TEMA_ADI[temaGocu(a.gorunum?.tema)], ayarlar: [
        { id: 'tema', ad: 'Uygulama teması', aciklama: 'Koyu, açık, şeffaf (masaüstün pencerenin arkasından görünür; Windows 11 ve macOS) ya da Windows’un temasına uyan (Otomatik).', anahtar: ['karanlık', 'aydınlık', 'koyu mod', 'açık mod', 'renk', 'cam', 'şeffaf', 'buzlu cam', 'otomatik', 'sistem'] },
      ] },
      // 0.14 T6b (Sade mod: karakterlerin hiç olmadığı bir görünüm): iki modda da görünür (gelistirici değil). Alan gorunum.karakterler;
      // kural shared/karakter-gorunum.ts. İçerik Gorunum.tsx KarakterGrubu.
      { id: 'karakterler', baslik: 'Gözler', aciklama: 'Göster ya da sade', ozet: (a) => (karakterGorunurMu(a) ? 'Göster' : 'Sade'), ayarlar: [
        { id: 'karakterler', ad: 'Gözler', aciklama: 'Göster: Fuber’in gözleri ekranın üstünde, sohbette ve kurulumda görünür. Sade: hiçbir yerde göz yok; yerinde küçük, renkli F işareti durur.', anahtar: ['göz', 'gözler', 'karakter', 'sade', 'sade mod', 'gözsüz', 'maskot', 'yüz', 'figür', 'avatar', 'gizle', 'göster', 'yalın', 'minimal'] },
      ] },
      // 0.14 T19: çentiğin tam ekran davranışı ve az hareket (R16).
      { id: 'hareket', baslik: 'Çentik ve hareket', aciklama: 'Tam ekran ve animasyonlar', ozet: (a) => (a.gorunum?.azHareket ? 'Az hareket açık' : a.gorunum?.tamEkrandaGizle === false ? 'Tam ekranda da görünür' : 'Tam ekranda gizlenir'), ayarlar: [
        { id: 'tam-ekranda-gizle', ad: 'Tam ekranda çentiği gizle', aciklama: 'Film, sunum ya da oyun tam ekrandayken boştaki çentik ekranın üstünden çekilir. Kapalıysa çentik kalır; hatırlatıcılar her durumda gelir, onaylar tam ekran bitince gösterilir.', anahtar: ['tam ekran', 'film', 'sunum', 'oyun', 'çentik', 'gizle'] },
        { id: 'az-hareket', ad: 'Az hareket', aciklama: 'Çentik ve gözler zıplamadan, yalnız solarak değişir; göz kırpma dışında göz hareketleri durur. Windows’ta animasyonlar kapalıysa bu kendiliğinden uygulanır.', anahtar: ['animasyon', 'hareket', 'erişilebilirlik', 'baş dönmesi', 'sade'] },
      ] },
      // 0.14 T23: çentiğin açık panelindeki sayfalar (shared/centik-sayfalar.ts): sıra ve aç/kapa; Asistan kapatılamaz. Alan gorunum.centikSayfalari; içerik
      // Gorunum.tsx CentikSayfalariGrubu. Panelin "Bağla" düğmesi buraya gelir (ayarlar#centik-sayfalari).
      { id: 'centik-sayfalari', baslik: 'Çentik sayfaları', aciklama: 'Açık paneldeki sayfaların sırası', ozet: (a) => { const n = acikSayfalar(a.gorunum?.centikSayfalari).length; return n === 9 ? 'Dokuzu açık' : `${n} / 9 açık`; }, ayarlar: [
        { id: 'centik-sayfalari', ad: 'Çentik sayfaları', aciklama: 'İmleç çentikte durunca açılan paneldeki sayfalar: sırasını değiştir, istemediğini kapat. Asistan her zaman açıktır.', anahtar: ['çentik', 'panel', 'sayfa', 'gündem', 'müzik', 'şarkı sözü', 'odak', 'raf', 'yapılacaklar', 'gelenler', 'görevler', 'sıra'] },
      ] },
      // 0.14 T22: çentikteki sistem uyarı hapları (shared/sistem-uyarilari.ts; R25: uygulama öndeyken, çentik kapalıyken ve tam ekranda gösterilmez). İçerik
      // Gorunum.tsx SistemUyarilariGrubu; alan gorunum.uyarilar, hepsi varsayılan açık.
      { id: 'uyarilar', baslik: 'Sistem uyarıları', aciklama: 'Çentikteki kısa haplar', ozet: (a) => { const n = Object.values(uyariAnahtarlari(a.gorunum)).filter(Boolean).length; return n === 7 ? 'Hepsi açık' : n === 0 ? 'Hepsi kapalı' : `${n} / 7 açık`; }, ayarlar: [
        { id: 'uyari-kulaklik', ad: 'Kulaklık ve hoparlör', aciklama: 'Bir kulaklık ya da hoparlör bağlanınca ve ayrılınca adıyla; pili biliniyorsa yüzdesiyle.', anahtar: ['kulaklık', 'bluetooth', 'hoparlör', 'airpods', 'uyarı', 'çentik'] },
        { id: 'uyari-sarj', ad: 'Şarj', aciklama: 'Şarj kablosu takılınca ve çıkarılınca pil yüzdesiyle.', anahtar: ['şarj', 'pil', 'batarya', 'güç', 'uyarı'] },
        { id: 'uyari-ses', ad: 'Ses düzeyi', aciklama: 'Ses değişince çentikte düzey çubuğu; sessize alınınca “Sessiz”.', anahtar: ['ses', 'düzey', 'sessiz', 'hoparlör', 'bindirme', 'uyarı'] },
        { id: 'uyari-parlaklik', ad: 'Parlaklık', aciklama: 'Bilgisayarın kendi ekranının parlaklığı değişince düzey çubuğu. Dış ekranlarda bu sürümde gösterilmez.', anahtar: ['parlaklık', 'ekran', 'ışık', 'bindirme', 'uyarı'] },
        { id: 'uyari-caps', ad: 'Büyük harf kilidi', aciklama: 'Caps Lock açılınca ve kapanınca. Bununla klavye dili ikisi de kapalıysa klavye izlenmez.', anahtar: ['caps lock', 'büyük harf', 'klavye', 'uyarı'] },
        { id: 'uyari-dil', ad: 'Klavye dili', aciklama: 'Klavye dili değişince yeni dilin adı; art arda iki kez değişip başa dönerse gösterilmez.', anahtar: ['klavye', 'dil', 'alt shift', 'türkçe', 'ingilizce', 'uyarı'] },
        { id: 'uyari-ag', ad: 'İnternet bağlantısı', aciklama: 'Bağlantı kopunca ve geri gelince. Uygulama öndeyken ve tam ekranda hiçbir uyarı çentikte gösterilmez.', anahtar: ['internet', 'ağ', 'wi-fi', 'bağlantı', 'koptu', 'uyarı'] },
      ] },
      { id: 'tanitim', baslik: 'Tanıtım ve kurulum', aciklama: 'Turu ve sihirbazı yeniden aç', ayarlar: [
        { id: 'tanitim', ad: 'Kokpit tanıtımı', aciklama: 'Sol menüdeki bölümleri ve ekranın üstündeki adayı kısaca yeniden gösterir.', anahtar: ['tur', 'rehber', 'yardım'] },
        { id: 'sihirbaz', ad: 'Kurulum', aciklama: 'Kurulum adımlarını mevcut ayarlarınla yeniden açar. Bitirince yalnız ayarların kaydedilir; hafızan ve sohbetlerin olduğu gibi kalır.', anahtar: ['kurulum', 'sihirbaz', 'baştan', 'yeniden kur'] },
      ] },
    ],
  },
  {
    // Görev 24 (K14): kokpit doldurucuları. İçerik ayarlar/Pano.tsx; veri ana süreçte (main/pano), kapalı kaynağa hiç istek gitmez.
    id: 'pano', ad: 'Pano', aciklama: 'Hava, haberler, döviz, şehir', simge: 'kokpit', bolum: 1,
    // 0.10 Görev 3 (A-58): giriş kartları küçümsemez; atıflar (MET Norway, kur kaynağı ve lisansı) Hakkında'da (shared/ucuncu-taraf.ts
    // VERI_KAYNAKLARI); İş'te IP / koordinat / lisans kısaltması yok (Geliştirici şehrin gizlilik ayrıntısını görür).
    giris: 'Kokpitte hava, haber ve kurların gösterilip gösterilmeyeceği.',
    gruplar: [
      { id: 'konum', baslik: 'Konum', aciklama: 'Hava ve haberler için şehir', ozet: (a) => panoSehirOzeti(a), ayarlar: [
        { id: 'pano-sehir', ad: 'Şehir', aciklama: 'Otomatik seçimde şehir bilgisayarın saat diliminden bulunur; konumun IP adresinden aranmaz. Hava hizmetine konum olarak yalnız şehrin yaklaşık koordinatı gider (hizmet, her internet isteğinde olduğu gibi bağlantı adresini görür).', aciklamaIs: 'Hava ve haberler için şehrin; otomatik seçimde saat diliminden bulunur.', anahtar: ['konum', 'il', 'yer', 'lokasyon', 'ülke', 'saat dilimi', 'hava durumu'] },
      ] },
      { id: 'kartlar', baslik: 'Bilgi kartları', aciklama: 'Hangi bilgiler gösterilsin', ozet: (a) => { const n = (['hava', 'haberler', 'gundem', 'piyasa'] as const).filter((k) => a.pano?.[k] !== false).length; return n ? `${n} / 4 açık` : 'Hepsi kapalı'; }, ayarlar: [
        { id: 'pano-hava', ad: 'Hava durumu', aciklama: 'Şimdiki hava ve günlük tahmin.', anahtar: ['hava', 'sıcaklık', 'yağmur', 'tahmin', 'derece'] },
        { id: 'pano-haberler', ad: 'Haberler', aciklama: 'Ülkendeki yayıncıların son başlıkları; yalnız başlık, kaynak ve saat gösterilir. Başlığa basınca haber kendi sitesinde, Fuber Tarayıcı’da açılır.', anahtar: ['haber', 'manşet', 'gazete', 'son dakika', 'başlık'] },
        { id: 'pano-gundem', ad: 'Gündemdeki konular', aciklama: 'Birden çok yayında geçen konular; bu bilgisayarda, haber başlıklarından çıkarılır. Kokpitin üstündeki gündem bandında görünür.', anahtar: ['gündem', 'trend', 'konuşulanlar', 'popüler', 'konu'] },
        { id: 'pano-piyasa', ad: 'Döviz', aciklama: 'Dolar, avro ve sterlin; son 30 günün çizgisiyle. Bilgi amaçlıdır, işlem kuru değildir.', anahtar: ['kur', 'dolar', 'avro', 'euro', 'sterlin', 'para', 'piyasa'] },
      ] },
      { id: 'guncelleme', baslik: 'Güncelleme', aciklama: 'Son güncellemeler ve yenile', ayarlar: [
        { id: 'pano-yenile', ad: 'Şimdi yenile', aciklama: 'Hava yarım saatte, haberler 15 dakikada, kurlar saatte bir kendiliğinden yenilenir. Bağlantı yokken son bilgiler yaşıyla gösterilir.', anahtar: ['yenile', 'güncelle', 'çevrimdışı', 'bağlantı'] },
      ] },
    ],
  },
  {
    id: 'ses', ad: 'Ses ve ada', aciklama: '“Hey Fuber”, sesli yanıt, ada', simge: 'mikrofon', bolum: 1,
    giris: 'Fuber’i nasıl çağırdığın, sesinin nasıl çıktığı ve ekranın üstündeki ada.',
    gruplar: [
      { id: 'uyandirma', baslik: 'Uyandırma ve kısayol', aciklama: 'Mikrofon, “Hey Fuber” ve klavye kısayolu', ozet: (a) => (a.ses.mikrofonKapali ? 'Mikrofon kapalı' : a.ses.uyandirma ? '“Hey Fuber” açık' : '“Hey Fuber” kapalı'), ayarlar: [
        // Sol raydaki mikrofon hızlı denetimiyle aynı alan (ses.mikrofonKapali; Görev 11, K6).
        { id: 'mikrofon-kapali', ad: 'Mikrofonu tamamen kapat', aciklama: '“Hey Fuber”, gün kaydı dinlemesi ve sesle sorma kapanır; hiçbir pencere mikrofonu açamaz. Asistanı açınca yazı alanı gelir. Sol menüdeki mikrofondan da açıp kapatabilirsin.', anahtar: ['mikrofon', 'kapat', 'sessize al', 'dinleme', 'gizlilik', 'mute'] },
        { id: 'hey-fuber', ad: '“Hey Fuber”', aciklama: 'Cihazda, çevrimdışı dinler. Uyanınca ekranın üstünden iner.', anahtar: ['mikrofon', 'uyandırma', 'sesle çağır', 'dinleme', 'wake word'] },
        { id: 'kisayol', ad: 'Asistan kısayolu', aciklama: `Her yerden ekranın üstündeki asistanı açar ve dinlemeye başlar. Varsayılan: ${kisayolGosterimi(VARSAYILAN_ASISTAN, MAC)}. Ctrl+Alt birleşimleri kabul edilmez (Türkçe klavyede AltGr karakter yazar).`, anahtar: ['klavye', 'tuş', 'ctrl', 'acil durdurma'] },
      ] },
      // Görev 21 (K9): TEK ses — sağlayıcı kartları ve ayrı "Hızlı yanıtın sesi" kalktı (ayarlar/SesSecimi.tsx). 0.13: ses seçimi ve ElevenLabs
      // anahtarı satırı da kalktı — ses kipin karakterine bağlı, Yönetim'den atanır.
      { id: 'yanit', baslik: 'Sesli yanıt', aciklama: 'Fuber’in sesi', ozet: (a) => acikKapali(a.ses.seslendirme), ayarlar: [
        { id: 'seslendirme', ad: 'Yanıtları sesli oku', aciklama: 'Sesle sorduğunda yanıtı Fuber sesli okur.', anahtar: ['seslendirme', 'sesli oku', 'konuşma', 'tts'] },
        { id: 'acilis-sesi', ad: 'Açılış sesi', aciklama: 'Fuber açılırken kısa, yumuşak bir çan çalar. Sessiz saatlerde ve rahatsız etme açıkken çalmaz.', anahtar: ['açılış', 'başlangıç', 'çan', 'ses efekti', 'animasyon', 'melodi'] },
        { id: 'ses-saglayici', ad: 'Şu anki karakterin sesi', aciklama: 'Ses seçilmez: her karakterin kendi sesi var, modu değiştirince ses de değişir. Ses bir konuşmanın ortasında değişmez; bağlantı koparsa yanıt yazı olarak kalır.', aciklamaIs: 'Ses seçilmez: her karakterin kendi sesi var, modu değiştirince ses de değişir. Bir sorun olursa yanıt yazı olarak kalır.', anahtar: ['ses', 'karakter', 'tek ses', 'dinle', 'konuşma', 'tts', 'sesli yanıt'], anahtarIs: ['ses', 'karakter', 'tek ses', 'dinle', 'konuşma', 'sesli yanıt'] },
        { id: 'yedek-ses', ad: 'Yedek ses', aciklama: 'Gizli modda, “Yalnız bu bilgisayar”da ve Fuber’in sesi gelene dek Fuber bu bilgisayardaki Türkçe sesle konuşur (Piper; işlemcide, çevrimdışı çalışır).', aciklamaIs: `Gizli modda, “Yalnız bu bilgisayar”da ve Fuber’in sesi gelene dek Fuber bu bilgisayardaki Türkçe sesle konuşur. ${YEDEK_SES_NASIL}.`, anahtar: ['piper', 'yedek', 'çevrimdışı', 'indir'], anahtarIs: ['yedek', 'çevrimdışı', 'indir'] },
        { id: 'ses-hizi', ad: 'Konuşma hızı', aciklama: 'Sakin, normal ya da hızlı; iki seste de geçerli.', anahtar: ['hız', 'yavaş', 'hızlı', 'tempo'] },
      ] },
      // Sol raydaki ada hızlı denetimiyle aynı alanlar (gorunum.ada, adaGizliBitis, adaSessiz; Görev 11, K5) ve aynı adlar.
      { id: 'ada', baslik: 'Ada', aciklama: 'Ekranın üstündeki çentik', ozet: adaOzeti, ayarlar: [
        { id: 'ada-gorunurluk', ad: 'Ada görünürlüğü', aciklama: 'Uygulama öndeyken ada görünmez; o sırada gelen hatırlatıcı ve mesajlar pencerenin üstünde bildirim olur. Kapalıyken ada kendiliğinden hiç inmez, hatırlatıcılar Windows bildirimi olur; kısayol ve “Hey Fuber” yine açar. Sol menüden de değiştirebilirsin.', anahtar: ['çentik', 'üstteki çentik', 'dynamic island', 'gizle', '1 saat gizle', 'göster', 'kapat'] },
        { id: 'ada-sessiz', ad: 'Boştayken göster', aciklama: 'İş yokken ada ekranın üstünde küçük bir çentik olarak durur; tıklayınca Fuber’e sorarsın. Tam ekran film ve sunumda çekilir. Kapalıysa yalnız bir şey olunca iner.', anahtar: ['çentik', 'dynamic island', 'sessizken', 'boşta', 'küçük çentik'] },
      ] },
    ],
  },
  {
    // 0.10 Görev 3 (P2 sözlüğü): "Gizlilik ve yerel beyin" → "Gizlilik"; yerel model İş'te "bu bilgisayardaki yapay zekâ".
    id: 'gizlilik', ad: 'Gizlilik', aciklama: 'Gizli mod ve yerel model', aciklamaIs: `Gizli mod ve ${TERIM.yzYerel}`, simge: 'kilit', bolum: 2,
    // F1 düzeltme turu 1 (K-5): "bilgisayardan çıkmadan" / "veri buluta çıkmaz" mutlak sözdü (e-posta/WhatsApp eşitlemesi, Geliştirici'de
    // Claude Code sürer) — yalnız sohbetin nerede yapıldığı söylenir.
    giris: 'Kişisel sohbetin bu bilgisayarda çalışan yerel modelle yapılır.',
    girisIs: `Kişisel sohbetin ${TERIM.yzYerel}yla yapılır.`,
    gruplar: [
      // Görev 21 (K10): yerel model yanıt yolunda "ön eleme" yapmaz; yalnız Gizli modda (bulutsuz) tek motordur. "Yerelde yapılacak
      // işler" ve "Hızlı yanıtın sesi" kalktı.
      { id: 'yerel', baslik: 'Yerel model', baslikIs: buyukBasla(TERIM.yzYerel), aciklama: 'Fuber, Yalnız bu bilgisayar ya da Gizli', ozet: (a) => (a.yerel?.gizliMod ? 'Gizli mod açık' : a.yerel?.yalnizYerel ? 'Yalnız bu bilgisayar' : acikKapali(a.yerel?.etkin)), ayarlar: [
        { id: 'yerel-beyin', ad: 'Yerel model', adIs: buyukBasla(TERIM.yzYerel), aciklama: 'Bu bilgisayarda çalışan dil modeli (“Yalnız bu bilgisayar” ve Gizli için). Fuber normalde buluttaki motorla yanıt verir — en hızlısı; yerel model yalnız bu iki seçimde çalışır, ekran kartını da yalnız o zaman kullanır.', aciklamaIs: `“Yalnız bu bilgisayar” ve Gizli için. Normalde yanıtlar ${TERIM.yzBulut}ndan gelir — en hızlısı; ${TERIM.yzYerel} yalnız bu iki seçimde çalışır.`, anahtar: ['gizlilik', 'ekstra gizlilik', 'çevrimdışı', 'kişisel veri', 'kur', 'indir', 'llama', 'bonsai'], anahtarIs: ['gizlilik', 'ekstra gizlilik', 'çevrimdışı', 'kişisel veri', 'kur', 'indir'] },
        // F1 (son inceleme K1): yalnız doğru olanı söz verir — kapsam sihirbazla aynı kaynaktan (shared/kurulum-yerel.ts gizliKapsami).
        // 0.12 H3c: satır "Nerede çalışsın" oldu (Fuber · Yalnız bu bilgisayar · Gizli; kurulumla aynı bileşen) — kimlik 'gizli-mod' kaldı (motor
        // bildirimlerinin çapası); Gizli'nin kapsam metni aynen, öne üç seçeneğin farkı eklendi.
        { id: 'gizli-mod', ad: 'Nerede çalışsın', aciklama: `Bulut: yanıtlar bulut motorundan. Yalnız bu bilgisayar: yanıtlar ve ses yerel modelden — ${BULUT_YZ_KAPALI}, sohbet yerel model hazır olunca açılır; hesap, eşitleme ve kokpit kartları internete bağlı kalır, Gizli değildir. Gizli: açıkken sohbet, ses, notlar ve hafıza bu bilgisayarda işlenir: yanıtlar, notlar ve raporlar yerel modelle; ses yedek sesle; konuşmadan yazıya bu bilgisayarda. Bulut motorları kapalı. Eşleştirdiğin telefonla bağlantı uçtan uca şifrelenir. Hatırlatıcı kurma, e-posta, WhatsApp ve tarayıcı araçları bu modda çalışmaz, yanıtlar daha yavaş olabilir. ${gizliKapsami('gelistirici').dip} Yerel model kapalıyken nota çevrilemeyen Gizli gün kaydı satırları bu bilgisayarda tutulur ve saklama süresi dolunca silinir.`, aciklamaIs: `Fuber: en iyi yanıtlar ${TERIM.yzBulut}ndan. Yalnız bu bilgisayar: yanıtlar ve ses ${TERIM.yzYerel}dan — ${BULUT_YZ_KAPALI}, sohbet ${TERIM.yzYerel} hazır olunca açılır; hesap, eşitleme ve kokpit kartları internete bağlı kalır, Gizli değildir. Gizli: açıkken sohbet, ses, notlar ve hafıza bu bilgisayarda işlenir; ${TERIM.yzBulut} kapalı. Eşleştirdiğin telefonla bağlantı uçtan uca şifrelenir. Bu modda hatırlatıcı kurulamaz; Fuber e-posta, WhatsApp ve tarayıcıyla iş yapamaz, yanıtlar daha yavaş olabilir. ${gizliKapsami('is').dip} ${buyukBasla(TERIM.yzYerel)} kapalıyken işlenemeyen, Gizli moddayken alınan notlar bu bilgisayarda tutulur ve saklama süresi dolunca silinir.`, anahtar: ['nerede çalışsın', 'gizli mod', 'yalnız bu bilgisayar', 'yalnız yerel', 'yerel model', 'bulutsuz', 'çevrimdışı', 'gizlilik', 'yerel', 'internetsiz', 'offline', 'sürüm', 'bonsai'], anahtarIs: ['nerede çalışsın', 'gizli mod', 'yalnız bu bilgisayar', 'bulutsuz', 'çevrimdışı', 'gizlilik', 'internetsiz', 'sürüm', 'indir'] },
        { id: 'yerel-model', ad: 'Yerel model seçimi', aciklama: 'Fuber’in sunduğu açık modeller; her kartta disk, bellek ve ekran kartı gereksinimi ile bu bilgisayarda nasıl çalışacağı yazar.', anahtar: ['bonsai', '27b', '9b', '4b', 'hugging face', 'gguf', 'boyut', 'bellek', 'ram', 'ekran kartı', 'vram', 'gpu', 'uygunluk'], gelistirici: true },
      ] },
      { id: 'hizli', baslik: 'Seslenme ve deneme', aciklama: 'Gün içinde seslenmeler ve yerel modeli deneme', aciklamaIs: `Gün içinde seslenmeler ve ${TERIM.yzYerel}yı deneme`, ayarlar: [
        { id: 'hitap-algila', ad: 'Seslenmeyi anla', aciklama: 'Gün kaydı açıkken “ee Fuber nasılsın”, “Fuber buralarda mısın?” gibi cümleleri yakalar ve Fuber’in sesiyle kısa bir yanıt verir.', anahtar: ['seslenme', 'hitap', 'hızlı yanıt'] },
        { id: 'yerel-islemci', ad: 'İşlemci', aciklama: 'Otomatik: NVIDIA ekran kartı varsa onu kullanır.', anahtar: ['gpu', 'ekran kartı', 'cuda', 'nvidia', 'cpu'], gelistirici: true },
        { id: 'yerel-dene', ad: 'Dene', aciklama: 'Bir cümle yaz; yerel modelin yanıtını ve süresini gör.', aciklamaIs: `Bir cümle yaz; ${TERIM.yzYerel}nın yanıtını ve süresini gör.`, anahtar: ['test', 'sına'] },
      ] },
    ],
  },
  {
    id: 'proaktif', ad: 'Kendiliğinden yazma', aciklama: 'Özetler, hatırlatmalar, sessiz saatler', simge: 'isik', bolum: 2,
    giris: 'Sen yazmasan da Fuber’in ne zaman ve ne için yazacağı.',
    gruplar: [
      { id: 'proaktif', baslik: 'Kendiliğinden mesajlar', aciklama: 'Kendiliğinden yazma, merak soruları, e-posta takibi', ozet: (a) => acikKapali(a.proaktif.etkin), ayarlar: [
        { id: 'proaktif-fuber', ad: TERIM.kendiliginden, aciklama: 'Sen yazmasan da yazar: özetler, hatırlatmalar, önemli e-postalar, merak soruları.', anahtar: ['bildirim', 'kendiliğinden', 'otomatik mesaj', 'proaktif'] },
        { id: 'merak', ad: 'Seni tanıma soruları', aciklama: 'Günde kaç kez merak edip soru sorsun?', anahtar: ['soru', 'merak'] },
        { id: 'eposta-takip', ad: 'E-posta takibi', aciklama: 'Önemli e-posta gelince söyler.', anahtar: ['posta', 'mail', 'gelen kutusu'] },
      ] },
      { id: 'ozetler', baslik: 'Özetler', aciklama: 'Sabah özeti ve akşam kapanışı', ozet: (a) => `Sabah ${a.proaktif.sabahOzeti || 'kapalı'} · akşam ${a.proaktif.aksamOzeti || 'kapalı'}`, ayarlar: [
        { id: 'sabah-ozeti', ad: 'Sabah özeti', aciklama: 'Günün planı, hatırlatıcılar, gelen kutusu (boş = kapalı).', anahtar: ['sabah', 'gün planı', 'saat'] },
        { id: 'aksam-ozeti', ad: 'Akşam kapanışı', aciklama: 'Günün kapanışı ve yarına hazırlık (boş = kapalı).', anahtar: ['akşam', 'gün sonu'] },
      ] },
      { id: 'sessiz', baslik: 'Sessiz saatler', aciklama: 'Bildirimsiz saat aralığı ve rahatsız etme', ozet: (a) => (sureSuruyor(a.proaktif.rahatsizEtmeBitis, Date.now()) ? `Rahatsız etme · ${saatMetni(a.proaktif.rahatsizEtmeBitis!)}’e kadar` : `${a.proaktif.sessizBaslangic}–${a.proaktif.sessizBitis}`), ayarlar: [
        { id: 'sessiz-saatler', ad: 'Saat aralığı', aciklama: 'Bu aralıkta bildirim ve kendiliğinden mesaj yok (hatırlatıcılar hariç).', anahtar: ['rahatsız etme', 'gece', 'sessiz', 'bildirim'] },
        // Sol raydaki rahatsız etme hızlı denetimiyle aynı alan (proaktif.rahatsizEtmeBitis; Görev 11, K6).
        { id: 'rahatsiz-etme', ad: 'Rahatsız etme (1 saat)', aciklama: 'Fuber kendiliğinden yazmaz, araya girmez, bildirim göstermez; hatırlatıcılar yine gelir. Sol menüden de açabilirsin.', anahtar: ['sessiz', 'sustur', 'bildirim', 'odak', 'bir saat', 'dnd'] },
      ] },
    ],
  },
  {
    // 0.10 Görev 3 (D-11'in ad kısmı, A-60): "Düşünme motoru" → "Gün kaydı" (kategori, Kokpit kartı); ok zinciri ve iç terimler
    // (ajan, döküm) yerine sade cümle. Kimlik ('dusunme') çapa olarak kalır.
    id: 'dusunme', ad: TERIM.gunKaydi, aciklama: 'Dinleme, notlar, raporlar', simge: 'hafiza', bolum: 2,
    giris: 'Gün boyu konuşulanları not alır, akşam rapor hazırlar. Ses bu bilgisayarda yazıya dökülür; yalnız metin notlar tutulur.',
    gruplar: [
      { id: 'dinleme', baslik: 'Dinleme', aciklama: 'Sürekli dinleme ve çalışma saatleri', ozet: (a) => acikKapali(a.gunKaydi?.etkin), ayarlar: [
        { id: 'surekli-dinleme', ad: 'Sürekli dinleme', aciklama: 'Çalışma saatlerinde ortamı dinler ve yazıya döker; Fuber not tutar, gün sonunda rapor hazırlar.', anahtar: ['mikrofon', 'gün kaydı', 'kayıt', 'dinle', 'toplantı'] },
        { id: 'dinleme-durumu', ad: 'Dinleme durumu', aciklama: 'Şu an dinliyor mu; 1 saat ya da bugünlük duraklat.', anahtar: ['duraklat', 'sürdür'] },
        { id: 'calisma-saatleri', ad: 'Çalışma saatleri', aciklama: 'Yalnız bu saatlerde ve seçili günlerde dinler.', anahtar: ['gün', 'saat', 'hafta içi'] },
        { id: 'kilitte-duraklat', ad: 'Ekran kilitliyken duraklat', aciklama: 'Bilgisayar kilitliyken dinlemez.', anahtar: ['kilit'] },
      ] },
      // 0.13 T15: OpenAI seçeneği kalktı (kullanıcı anahtarı artık okunmaz); eski kayıtlı 'openai' değeri Otomatik gibi çalışır.
      { id: 'yazici', baslik: 'Yazıya döken', aciklama: 'Whisper ya da Vosk', gelistirici: true, ozet: (a) => ({ whisper: 'Whisper', vosk: 'Vosk' } as Record<string, string>)[a.gunKaydi?.motor ?? 'otomatik'] ?? 'Otomatik', ayarlar: [
        { id: 'yazici', ad: 'Yazıcı', aciklama: 'Otomatik: Whisper kuruluysa onu, değilse cihazdaki Vosk’u kullanır.', anahtar: ['whisper', 'vosk', 'transkripsiyon', 'yazıya dökme'] },
        { id: 'whisper', ad: 'Whisper', aciklama: 'Ücretsizdir ve tamamen bu bilgisayarda çalışır; model bir kez indirilir.', anahtar: ['indir', 'kur', 'large-v3', 'gpu', 'cuda'] },
      ] },
      // 0.13 T15: "Not ve rapor modeli" seçicisi (sağlayıcı + anahtar rozeti) kalktı; notlar ve raporlar Fuber'in modeliyle (ya da yerel modelle) yazılır.
      { id: 'ajanlar', baslik: TERIM.notlarRaporlar, aciklama: 'Araya girme, rapor saati, son çalışmalar', ayarlar: [
        { id: 'eslikci', ad: 'Araya girme', aciklama: 'Konuşmaları dinlerken gerektiğinde araya girer: unutulanı hatırlatır, istersen espri de yapar.', anahtar: ['espri', 'hatırlatma', 'araya girme'] },
        { id: 'eslikci-sesli', ad: 'Sesli konuş', aciklama: 'Araya girerken sesli söyler; kapalıyken yalnız bildirim olarak yazar.', anahtar: ['araya girme sesi'] },
        { id: 'eslikci-saatlik', ad: 'Saatte en çok', aciklama: 'Bir saatte kaç kez araya girebilir (1–12).', anahtar: ['sıklık', 'sınır'] },
        { id: 'rapor-saati', ad: 'Günlük rapor saati', aciklama: 'Günün raporu her gün bu saatte hazırlanır.', anahtar: ['rapor', 'gün sonu'] },
        { id: 'hafizaya-isle', ad: 'Kalıcı bilgileri hafızaya da işle', aciklama: 'Tercih, karar ve kişi gibi kalıcı bilgiler uzun süreli hafızaya da yazılır.', anahtar: ['hafıza'] },
        { id: 'ajan-durumlari', ad: 'Son çalışmalar', aciklama: 'Notların, araya girmenin ve raporların son çalışması ve sayacı.', anahtar: ['durum'] },
      ] },
      { id: 'saklama', baslik: 'Saklama', aciklama: 'Ne kadar süre tutulur; kayıtları sil', ayarlar: [
        { id: 'saklama-sureleri', ad: 'Saklama süreleri', aciklama: 'Yazıya dökülen konuşma, notlar ve haftalık raporlar kaç gün tutulsun; aylık raporlar kalıcıdır.', anahtar: ['gün', 'silinme', 'süre'] },
        { id: 'kayit-sil', ad: 'Kayıtları sil', aciklama: 'Bu bilgisayardan kalıcı olarak siler; geri alınamaz.', anahtar: ['temizle', 'döküm', 'silme'] },
      ] },
    ],
  },
  {
    id: 'yetkiler', ad: 'Yetkiler', aciklama: 'Fare, klavye, tarayıcı, dosyalar', simge: 'kalkan', bolum: 3,
    giris: 'Fuber’in neye dokunabildiği. E-posta ve WhatsApp gönderimi her zaman onay ister.',
    gruplar: [
      { id: 'tam', baslik: 'Çalışma izni', aciklama: 'Görev başına sormadan çalışma', ozet: (a) => acikKapali(a.yetki.tamYetki), ayarlar: [
        { id: 'tam-yetki', ad: 'Tam yetki', aciklama: 'Açıkken fare/klavye, tarayıcı ve dosya açma için görev başına SORMAZ; Fuber’in imlecini ekranda görürsün; fareyi ya da klavyeyi sen kullanmaya başlarsan Fuber hemen çekilir, {acil} her şeyi durdurur. E-posta/WhatsApp gönderimi ve dış serviste değişiklik yapan işler yine onay ister.', anahtar: ['izin', 'onay', 'sormadan'] },
      ] },
      { id: 'erisim', baslik: 'Erişim', aciklama: 'Tarayıcı, ekran ve dosyalar', ayarlar: [
        { id: 'tarayici', ad: 'Tarayıcı', aciklama: 'Kendi penceresinde gezinir ve okur. Tıklama/yazma görev başına onay ister (tam yetkide sormaz); parola ve kart alanlarına yazmaz.', anahtar: ['web', 'internet', 'gezinme'] },
        { id: 'bilgisayar', ad: 'Fare, klavye ve ekran', aciklama: 'Görev başına onay (tam yetkide sormaz). Kontrol sürerken ekranında Fuber’in kendi imleci ve ince kenar ışığı görünür; {acil} her şeyi anında durdurur.', anahtar: ['ekran görüntüsü', 'imleç', 'kontrol', 'dene'] },
        { id: 'dosya-okuma', ad: 'Dosya okuma', aciklama: 'Masaüstü, Belgeler, İndirilenler ve İçe Aktar serbest; başka yerler için sorar.', anahtar: ['dosya', 'klasör', 'belge'] },
      ] },
    ],
  },
  {
    // 0.11 G8 düzeltme turu 1: eski "Kullanım" sayfası (kimlik 'kullanim' çapa olarak kalır) yalnız Geliştirici'de ve "Maliyet" adıyla — Hesap ve kullanım ile
    // iki "kullanım" girişi kafa karıştırıyordu. İş'te bu ayki yanıt sayısı Hesap ve kullanım → Kullanım grubunda TEK satır (ayarlar/Hesap.tsx);
    // işe göre dağılım (beyin bölgesi adlarıyla) ve USD yalnız burada.
    id: 'kullanim', ad: 'Maliyet', aciklama: 'Son 30 günün maliyeti', simge: 'grafik', bolum: 3, gelistirici: true,
    giris: 'Yapay zekâ çağrılarının yaklaşık maliyeti; son 30 gün. Fiyatı bilinmeyen modelde maliyet “—”.',
    gruplar: [
      { id: 'ozet', baslik: 'Son 30 gün', aciklama: 'Ne için ne kadar', ayarlar: [
        { id: 'kullanim-amac', ad: 'Ne için kullanıldı', aciklama: 'Sohbet, hafıza, kokpit, notlar: işe göre çağrı sayısı ve yaklaşık maliyet.', anahtar: ['maliyet', 'harcama', 'dolar', 'usd', 'fiyat', 'son 30 gün'] },
      ] },
      { id: 'modeller', baslik: 'Modele göre', aciklama: 'Çağrı, giriş, çıkış', ayarlar: [
        { id: 'kullanim-model', ad: 'Modele göre kullanım', aciklama: 'Her modelin çağrı sayısı, giriş ve çıkış uzunluğu (token), yaklaşık USD (model bilgisinin fiyatıyla; bilinmeyen “—”).', anahtar: ['maliyet', 'token', 'giriş', 'çıkış'] },
      ] },
    ],
  },
  {
    id: 'veri', ad: 'Veri', aciklama: 'Bu bilgisayardaki kayıtlar', simge: 'veri', bolum: 3,
    giris: 'Hafıza, sohbetler ve ayarlar yalnız bu bilgisayarda durur.',
    gruplar: [
      { id: 'yerel-veri', baslik: 'Bu bilgisayarda', aciklama: 'Veri klasörü', ayarlar: [
        { id: 'veri-klasoru', ad: 'Veri klasörü', aciklama: 'Hafıza, sohbetler ve ayarlar yalnız bu bilgisayarda (tek bir SQLite dosyası). Anahtarlar Windows şifrelemesiyle (DPAPI) saklanır.', aciklamaIs: 'Hafıza, sohbetler ve ayarlar yalnız bu bilgisayarda (tek bir dosya). Parolalar Windows şifrelemesiyle saklanır.', anahtar: ['klasör', 'yedek', 'sqlite', 'dosya', 'dpapi'], anahtarIs: ['klasör', 'yedek', 'dosya', 'parola'] },
        // 0.11 G2 (spec §2): "Yeni başla"nın taşıdığı eski veriler (açıklama sayıyla Veri.tsx'te; yedek yoksa düğme yok).
        { id: 'eski-yedekler', ad: 'Eski yedekler', aciklama: '“Yeni başla” ile kenara taşınan eski hafıza, sohbetler ve ayarlar.', anahtar: ['yedek', 'eski', 'yeni başla', 'sil', 'temizle'] },
      ] },
      // 0.11 G2 (spec §2): sayfa içi onaylı iki tehlikeli işlem (Veri.tsx; "Bunun geri alınamayacağını biliyorum" işareti olmadan düğme kapalı).
      { id: 'sil-kaldir', baslik: 'Silme ve kaldırma', aciklama: 'Verilerini sil ya da Fuber’i kaldır', ayarlar: [
        { id: 'verileri-sil', ad: 'Verilerimi sil ve çıkış yap', aciklama: 'Hafıza, sohbetler, ayarlar ve bağlantılar bu bilgisayardan silinir; Fuber yeniden açılır ve ilk kurulum başlar.', anahtar: ['sil', 'temizle', 'sıfırla', 'baştan', 'çıkış', 'hesaptan çık', 'unut'] },
        { id: 'fuberi-kaldir', ad: 'Fuber’i bu bilgisayardan kaldır', aciklama: 'Verilerin ve indirilen yapay zekâ silinir, Fuber bu bilgisayardan kaldırılır.', anahtar: ['kaldır', 'sil', 'uninstall', 'program ekle kaldır'] },
      ] },
    ],
  },
];

/** Eski çapalar ('ayarlar#motorlar' …; Etkinlik sayfası, ada, kokpit). Kategori kimlikleri (ses, yetkiler, gorunum, dusunme)
 *  zaten çapadır. İş modunda motor bağlantısı Hesap ve kullanım'a gider (anahtar dili yok; K2, Görev 14). */
export const ESKI_CIPALAR: EskiCipalar = {
  motorlar: 'motor',
  yerel: 'gizlilik/yerel',
  // 0.11 G8 düzeltme turu 1: eski "Kullanım" çapası — İş'te sayfa yok (bu ayki yanıtlar Hesap ve kullanım'da), Geliştirici'de "Maliyet".
  kullanim: { is: 'motor', gelistirici: 'kullanim/ozet' },
};

/** Ayar kimliği → tanım (Satir metni okur). */
export const AYAR_TANIMLARI: ReadonlyMap<string, AyarTanimi> = new Map(KATEGORILER.flatMap((k) => k.gruplar.flatMap((g) => g.ayarlar.map((a) => [a.id, a] as const))));
