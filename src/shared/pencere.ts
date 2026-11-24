// ── Pencere kabuğu (Görev 22, K12): kendi başlık düğmelerimiz — saf kurallar (ana süreç + arayüz; birim testli) ───────────────
// Windows'ta (ve Linux'ta) Windows'un saydam başlık şeridi kaplaması (titleBarOverlay) KULLANILMAZ: düğmeleri biz çizeriz
// (renderer/pencere). macOS'ta yerel trafik ışıkları kalır; yalnız başlık şeridinin ortasına oturtulur.

export type PencereEylemi = 'kucult' | 'buyut' | 'kapat';
/** Pencerenin arayüze bildirilen hâli ('pencere:durum'). `odak`: PENCERENİN (BrowserWindow) odağı — sayfanın belgesinin değil:
 *  Fuber Tarayıcı'da odak web sayfasının ayrı görünümündeyken araç çubuğu belgesi "blur" alır ama pencere öndedir.
 *  `gorunur` (0.11 G10 düzeltme turu 1, K5): pencere ekranda mı (gösterilmiş ve simge durumunda değil)? Tepsiden `--gizli` başlatılan, hiç gösterilmemiş
 *  pencerenin belgesi `document.hidden` demeyebilir (sayfa çizilir); gerçeği ana süreç bilir. Yoksa bilinmiyor sayılır. */
export interface PencereDurumu { buyuk: boolean; tamEkran: boolean; odak: boolean; gorunur?: boolean }

/** Trafik ışıkları (macOS): üç düğme 12 px çaplı, 20 px aralıklı → toplam 52 px genişlik, 12 px yükseklik. */
const ISIK_GEN = 52;
const ISIK_BOY = 12;

/** Bu platformda düğmeleri biz mi çiziyoruz? Windows ve Linux evet; macOS'ta yerel trafik ışıkları, telefonda ('cep') pencere yok. */
export const ozelDugmeler = (platform: string): boolean => platform === 'win32' || platform === 'linux';

/**
 * BrowserWindow başlık ayarı. `yukseklik`: arayüzün başlık şeridi (ana pencere 38 px, Fuber Tarayıcı 48 px); `solBosluk`: macOS'ta
 * trafik ışıklarının yatayda ortalanacağı sol alanın genişliği (ana pencerede ray 68 px; verilmezse 14 px soldan).
 * Windows/Linux: başlık gizli, KAPLAMA YOK (düğmeleri arayüz çizer; Windows'un kendi düğmeleri arayüzün üstüne binmez).
 */
export function baslikAyari(platform: string, yukseklik: number, solBosluk?: number):
  { titleBarStyle: 'hidden'; trafficLightPosition?: { x: number; y: number } } {
  if (platform !== 'darwin') return { titleBarStyle: 'hidden' };
  const x = solBosluk ? Math.round((solBosluk - ISIK_GEN) / 2) : 14;
  return { titleBarStyle: 'hidden', trafficLightPosition: { x: Math.max(8, x), y: Math.round((yukseklik - ISIK_BOY) / 2) } };
}

/** Arayüzden gelen eylem doğrulanır (bilinmeyen değer → null; ana süreç hiçbir şey yapmaz). */
export function eylemCoz(e: unknown): PencereEylemi | null {
  return e === 'kucult' || e === 'buyut' || e === 'kapat' ? e : null;
}

/** Düğme adları (Windows'un Türkçe adları; ekran okuyucu ve ipucu). `tepsi`: kapatınca uygulama tepside çalışmayı sürdürür. */
export function dugmeAdi(eylem: PencereEylemi, d: PencereDurumu, tepsi = false): string {
  if (eylem === 'kucult') return 'Simge durumuna küçült';
  if (eylem === 'buyut') return d.buyuk ? 'Önceki boyutuna getir' : 'Ekranı kapla';
  return tepsi ? 'Kapat (Fuber tepside çalışmayı sürdürür)' : 'Kapat';
}

/** Pencere ikonu: Windows'ta çok boylu .ico (16–256; görev çubuğu ve Alt+Tab elle çizilmiş küçük boyları alır), diğerlerinde png. */
export const pencereIkonuAdi = (platform: string): string => (platform === 'win32' ? 'fuber.ico' : 'fuber.png');

/**
 * Tepsi ikonu: macOS menü çubuğu şablonu (sistem boyar); Windows'ta görev çubuğunun temasına göre tek renk işaret (koyu görev
 * çubuğunda beyaz, açıkta mürekkep). `sistemKoyu`: nativeTheme.shouldUseDarkColorsForSystemIntegratedUI (uygulamanın temasından
 * bağımsız: görev çubuğu Windows'un "sistem" rengidir).
 */
export function tepsiIkonuAdi(platform: string, sistemKoyu: boolean): string {
  if (platform === 'darwin') return 'tepsiTemplate.png';
  if (platform === 'win32') return sistemKoyu ? 'tepsi-koyu.ico' : 'tepsi-acik.ico';
  return 'fuber.png';
}
