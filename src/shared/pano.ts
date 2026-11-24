// ── Pano (Görev 24, K14): kokpitin doldurucu bileşenlerinin ortak tipleri ve saf yardımcıları ───────────────────────────
// Ana sayfada boş bir şey kalmaz: gerekirse hava durumu, haberler; boş kutucuk mutlaka dolar;
// güncel konular ve bekleyen takvim her zaman yukarıda. Kokpit veri yokken boş kalmasın diye ana süreç (src/main/pano/) dış
// kaynaklardan önbellekli veri toplar: hava (MET Norway Locationforecast, CC BY 4.0), haberler (ülkeye göre yayıncı akışları; yalnız
// başlık + kaynak + zaman, tıklanınca haber kendi sitesinde Fuber Tarayıcı'da açılır), gündemdeki konular (aynı başlıklardan yerelde
// çıkarılır; ek istek yok), döviz (Avrupa Merkez Bankası günlük referans kurları; TCMB çözücüsü de var — bkz. KUR_KAYNAGI).
// Konum (Ruling BB): varsayılan sistem saat dilimi + dil; IP adresi üçüncü tarafa gönderilmez; Ayarlar → Pano'dan şehir seçilir.
// Bu dosya saftır (DOM yok, Electron yok): tests/pano.test.ts doğrudan sınar; arayüz de aynı listeleri okur.

// ── Ayar ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface PanoAyari {
  hava: boolean;
  haberler: boolean;
  /** Gündemdeki konular (haber başlıklarından çıkarılır: kapalıysa ve haberler de kapalıysa akışlar hiç istenmez). */
  gundem: boolean;
  piyasa: boolean;
  /** SEHIRLER kimliği; boş = saat diliminden. */
  sehir: string;
}
export const PANO_VARSAYILAN: PanoAyari = { hava: true, haberler: true, gundem: true, piyasa: true, sehir: '' };

export type PanoKaynakAdi = 'hava' | 'haberler' | 'piyasa';

// ── Veri ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface SaatlikHava { zaman: string; sicaklik: number; simge: string }
export interface GunlukHava { gun: string; enYuksek: number; enDusuk: number; simge: string }
export interface HavaVerisi {
  /** Tahminin güncellendiği an (MET: meta.updated_at). */
  guncelleme: string;
  simdi: { sicaklik: number; simge: string; ruzgar?: number; nem?: number };
  bugun: { enYuksek: number; enDusuk: number; yagis: number };
  saatlik: SaatlikHava[];
  gunluk: GunlukHava[];
}
export interface Haber { id: string; baslik: string; link: string; kaynak: string; kaynakId: string; zaman?: string }
export interface GundemKonusu { ad: string; kaynakSayisi: number; haberSayisi: number; ornek: Haber }
export interface KurSatiri {
  /** "USD", "EUR" … (yerel para birimi karşılığı). */
  kod: string;
  /** 1 birim yabancı paranın yerel karşılığı. */
  deger: number;
  /** Önceki iş gününe göre % değişim; geçmiş yoksa yok. */
  degisim?: number;
  /** Son ~30 iş gününün değerleri (eskiden yeniye), çizgi grafik için. */
  gecmis: number[];
}
export interface PiyasaVerisi { yerel: string; tarih: string; kurlar: KurSatiri[]; kaynak: 'ecb' | 'tcmb' }

/** Bir kaynağın arayüze giden hâli. `zaman`: verinin alındığı an; `bayat`: tazelenme süresi geçti (çevrimdışında son veri yaşıyla). */
export interface PanoKaynak<T> {
  durum: 'kapali' | 'yukleniyor' | 'hazir' | 'yok';
  veri?: T;
  zaman?: string;
  bayat?: boolean;
  /** Son deneme başarısız oldu (veri varsa eskisi gösterilir). */
  cevrimdisi?: boolean;
  /** F1 (son inceleme K1): Gizli mod açık — pano ağa çıkmaz; veri varsa son önbellek, yoksa kart "Gizli modda güncellenmiyor" der. */
  gizli?: boolean;
}
/** kaynak: 'ayar' Ayarlar'dan seçildi · 'saat-dilimi' sistem saat dilimi listede · 'tahmin' listede yok, en yakın saat farkındaki şehir
 *  (Hava kartı "Şehrini seç" der; haberler uluslararası katalogdan). `haberUlke`/`paraUlke`: haber kataloğu ve yerel para birimi için. */
export interface PanoKonumu {
  sehirId: string; sehir: string; ulke: string; enlem: number; boylam: number; saatDilimi: string;
  kaynak: 'ayar' | 'saat-dilimi' | 'tahmin'; haberUlke: string; paraUlke: string;
}
export interface PanoDurumu {
  konum: PanoKonumu;
  hava: PanoKaynak<HavaVerisi>;
  haberler: PanoKaynak<Haber[]>;
  gundem: PanoKaynak<GundemKonusu[]>;
  piyasa: PanoKaynak<PiyasaVerisi>;
}

// ── Tazelenme süreleri ────────────────────────────────────────────────────────────────────────────────────────────
/** MET: Expires başlığına uyulur; en az 30 dk, en çok 2 saat. Haber 15 dk. Kurlar (günde bir yayımlanır) 1 saat. */
export const TAZELIK_MS: Record<PanoKaynakAdi, number> = { hava: 30 * 60_000, haberler: 15 * 60_000, piyasa: 60 * 60_000 };
export const HAVA_EN_COK_MS = 2 * 3600_000;
/** Başarısız denemeden sonra bekleme: 2 dk'dan başlar, her hatada iki katına çıkar, en çok 30 dk. */
export function geriCekilmeMs(ardisikHata: number): number {
  return Math.min(30 * 60_000, 2 * 60_000 * 2 ** Math.max(0, ardisikHata - 1));
}

/** "az önce", "12 dk önce", "3 sa önce", "2 gün önce" — kartlardaki yaş yazısı (kısa; 12 px'te sığar). */
export function yasMetni(iso: string | undefined, simdi = Date.now()): string {
  const t = Date.parse(iso ?? '');
  if (!Number.isFinite(t)) return '';
  const dk = Math.max(0, Math.round((simdi - t) / 60_000));
  if (dk < 1) return 'az önce';
  if (dk < 60) return `${dk} dk önce`;
  const sa = Math.round(dk / 60);
  if (sa < 24) return `${sa} sa önce`;
  return `${Math.round(sa / 24)} gün önce`;
}

// ── Şehirler (çevrimdışı liste; Ayarlar → Pano seçicisi ve saat diliminden varsayılan) ─────────────────────────────────
export interface Sehir { id: string; ad: string; ulke: string; enlem: number; boylam: number; saatDilimi: string }

const TR = 'Europe/Istanbul';
// 81 il (il merkezi, ~1 km duyarlık yeter: istekte zaten 2 ondalığa yuvarlanır).
const IL: [string, string, number, number][] = [
  ['adana', 'Adana', 37.0, 35.32], ['adiyaman', 'Adıyaman', 37.76, 38.28], ['afyonkarahisar', 'Afyonkarahisar', 38.76, 30.54], ['agri', 'Ağrı', 39.72, 43.05],
  ['aksaray', 'Aksaray', 38.37, 34.03], ['amasya', 'Amasya', 40.65, 35.83], ['ankara', 'Ankara', 39.93, 32.86], ['antalya', 'Antalya', 36.9, 30.7],
  ['ardahan', 'Ardahan', 41.11, 42.7], ['artvin', 'Artvin', 41.18, 41.82], ['aydin', 'Aydın', 37.84, 27.84], ['balikesir', 'Balıkesir', 39.65, 27.88],
  ['bartin', 'Bartın', 41.64, 32.34], ['batman', 'Batman', 37.89, 41.13], ['bayburt', 'Bayburt', 40.26, 40.23], ['bilecik', 'Bilecik', 40.14, 29.98],
  ['bingol', 'Bingöl', 38.88, 40.5], ['bitlis', 'Bitlis', 38.4, 42.11], ['bolu', 'Bolu', 40.74, 31.61], ['burdur', 'Burdur', 37.72, 30.29],
  ['bursa', 'Bursa', 40.19, 29.06], ['canakkale', 'Çanakkale', 40.15, 26.41], ['cankiri', 'Çankırı', 40.6, 33.62], ['corum', 'Çorum', 40.55, 34.95],
  ['denizli', 'Denizli', 37.78, 29.09], ['diyarbakir', 'Diyarbakır', 37.91, 40.24], ['duzce', 'Düzce', 40.84, 31.16], ['edirne', 'Edirne', 41.68, 26.56],
  ['elazig', 'Elazığ', 38.67, 39.22], ['erzincan', 'Erzincan', 39.75, 39.49], ['erzurum', 'Erzurum', 39.9, 41.27], ['eskisehir', 'Eskişehir', 39.78, 30.52],
  ['gaziantep', 'Gaziantep', 37.07, 37.38], ['giresun', 'Giresun', 40.91, 38.39], ['gumushane', 'Gümüşhane', 40.46, 39.48], ['hakkari', 'Hakkari', 37.58, 43.74],
  ['hatay', 'Hatay', 36.2, 36.16], ['igdir', 'Iğdır', 39.92, 44.05], ['isparta', 'Isparta', 37.76, 30.55], ['istanbul', 'İstanbul', 41.01, 28.98],
  ['izmir', 'İzmir', 38.42, 27.14], ['kahramanmaras', 'Kahramanmaraş', 37.58, 36.94], ['karabuk', 'Karabük', 41.2, 32.62], ['karaman', 'Karaman', 37.18, 33.22],
  ['kars', 'Kars', 40.6, 43.1], ['kastamonu', 'Kastamonu', 41.38, 33.78], ['kayseri', 'Kayseri', 38.72, 35.49], ['kilis', 'Kilis', 36.72, 37.12],
  ['kirikkale', 'Kırıkkale', 39.85, 33.51], ['kirklareli', 'Kırklareli', 41.73, 27.22], ['kirsehir', 'Kırşehir', 39.15, 34.16], ['kocaeli', 'Kocaeli', 40.77, 29.92],
  ['konya', 'Konya', 37.87, 32.48], ['kutahya', 'Kütahya', 39.42, 29.98], ['malatya', 'Malatya', 38.35, 38.31], ['manisa', 'Manisa', 38.61, 27.43],
  ['mardin', 'Mardin', 37.31, 40.74], ['mersin', 'Mersin', 36.81, 34.64], ['mugla', 'Muğla', 37.22, 28.36], ['mus', 'Muş', 38.75, 41.51],
  ['nevsehir', 'Nevşehir', 38.62, 34.71], ['nigde', 'Niğde', 37.97, 34.68], ['ordu', 'Ordu', 40.98, 37.88], ['osmaniye', 'Osmaniye', 37.07, 36.25],
  ['rize', 'Rize', 41.02, 40.52], ['sakarya', 'Sakarya', 40.78, 30.4], ['samsun', 'Samsun', 41.29, 36.33], ['sanliurfa', 'Şanlıurfa', 37.16, 38.79],
  ['siirt', 'Siirt', 37.93, 41.94], ['sinop', 'Sinop', 42.03, 35.15], ['sirnak', 'Şırnak', 37.52, 42.46], ['sivas', 'Sivas', 39.75, 37.02],
  ['tekirdag', 'Tekirdağ', 40.98, 27.51], ['tokat', 'Tokat', 40.31, 36.55], ['trabzon', 'Trabzon', 41.0, 39.72], ['tunceli', 'Tunceli', 39.11, 39.55],
  ['usak', 'Uşak', 38.68, 29.41], ['van', 'Van', 38.5, 43.38], ['yalova', 'Yalova', 40.66, 29.27], ['yozgat', 'Yozgat', 39.82, 34.81],
  ['zonguldak', 'Zonguldak', 41.45, 31.79],
];
// Yurt dışı: Türkçe adlar; her saat diliminin ilk şehri o dilimin varsayılanıdır.
const DUNYA: [string, string, string, number, number, string][] = [
  ['berlin', 'Berlin', 'DE', 52.52, 13.4, 'Europe/Berlin'], ['munih', 'Münih', 'DE', 48.14, 11.58, 'Europe/Berlin'], ['koln', 'Köln', 'DE', 50.94, 6.96, 'Europe/Berlin'],
  ['frankfurt', 'Frankfurt', 'DE', 50.11, 8.68, 'Europe/Berlin'], ['hamburg', 'Hamburg', 'DE', 53.55, 9.99, 'Europe/Berlin'], ['stuttgart', 'Stuttgart', 'DE', 48.78, 9.18, 'Europe/Berlin'],
  ['dusseldorf', 'Düsseldorf', 'DE', 51.23, 6.78, 'Europe/Berlin'], ['viyana', 'Viyana', 'AT', 48.21, 16.37, 'Europe/Vienna'], ['zurih', 'Zürih', 'CH', 47.38, 8.54, 'Europe/Zurich'],
  ['cenevre', 'Cenevre', 'CH', 46.2, 6.14, 'Europe/Zurich'], ['amsterdam', 'Amsterdam', 'NL', 52.37, 4.9, 'Europe/Amsterdam'], ['rotterdam', 'Rotterdam', 'NL', 51.92, 4.48, 'Europe/Amsterdam'],
  ['bruksel', 'Brüksel', 'BE', 50.85, 4.35, 'Europe/Brussels'], ['paris', 'Paris', 'FR', 48.86, 2.35, 'Europe/Paris'], ['lyon', 'Lyon', 'FR', 45.76, 4.84, 'Europe/Paris'],
  ['londra', 'Londra', 'GB', 51.51, -0.13, 'Europe/London'], ['manchester', 'Manchester', 'GB', 53.48, -2.24, 'Europe/London'], ['dublin', 'Dublin', 'IE', 53.35, -6.26, 'Europe/Dublin'],
  ['madrid', 'Madrid', 'ES', 40.42, -3.7, 'Europe/Madrid'], ['barselona', 'Barselona', 'ES', 41.39, 2.17, 'Europe/Madrid'], ['roma', 'Roma', 'IT', 41.9, 12.5, 'Europe/Rome'],
  ['milano', 'Milano', 'IT', 45.46, 9.19, 'Europe/Rome'], ['atina', 'Atina', 'GR', 37.98, 23.73, 'Europe/Athens'], ['sofya', 'Sofya', 'BG', 42.7, 23.32, 'Europe/Sofia'],
  ['bukres', 'Bükreş', 'RO', 44.43, 26.1, 'Europe/Bucharest'], ['varsova', 'Varşova', 'PL', 52.23, 21.01, 'Europe/Warsaw'], ['prag', 'Prag', 'CZ', 50.08, 14.44, 'Europe/Prague'],
  ['budapeste', 'Budapeşte', 'HU', 47.5, 19.04, 'Europe/Budapest'], ['stockholm', 'Stockholm', 'SE', 59.33, 18.07, 'Europe/Stockholm'], ['kopenhag', 'Kopenhag', 'DK', 55.68, 12.57, 'Europe/Copenhagen'],
  ['oslo', 'Oslo', 'NO', 59.91, 10.75, 'Europe/Oslo'], ['helsinki', 'Helsinki', 'FI', 60.17, 24.94, 'Europe/Helsinki'], ['lizbon', 'Lizbon', 'PT', 38.72, -9.14, 'Europe/Lisbon'],
  ['kiev', 'Kiev', 'UA', 50.45, 30.52, 'Europe/Kyiv'], ['moskova', 'Moskova', 'RU', 55.76, 37.62, 'Europe/Moscow'], ['lefkosa', 'Lefkoşa', 'CY', 35.19, 33.36, 'Asia/Nicosia'],
  ['baku', 'Bakü', 'AZ', 40.41, 49.87, 'Asia/Baku'], ['tiflis', 'Tiflis', 'GE', 41.72, 44.79, 'Asia/Tbilisi'], ['taskent', 'Taşkent', 'UZ', 41.3, 69.24, 'Asia/Tashkent'],
  ['almati', 'Almatı', 'KZ', 43.24, 76.89, 'Asia/Almaty'], ['bisek', 'Bişkek', 'KG', 42.87, 74.59, 'Asia/Bishkek'], ['askabat', 'Aşkabat', 'TM', 37.95, 58.38, 'Asia/Ashgabat'],
  ['uskup', 'Üsküp', 'MK', 41.99, 21.43, 'Europe/Skopje'], ['saraybosna', 'Saraybosna', 'BA', 43.86, 18.41, 'Europe/Sarajevo'], ['belgrad', 'Belgrad', 'RS', 44.79, 20.45, 'Europe/Belgrade'],
  ['tiran', 'Tiran', 'AL', 41.33, 19.82, 'Europe/Tirane'], ['dubai', 'Dubai', 'AE', 25.2, 55.27, 'Asia/Dubai'], ['doha', 'Doha', 'QA', 25.29, 51.53, 'Asia/Qatar'],
  ['riyad', 'Riyad', 'SA', 24.71, 46.68, 'Asia/Riyadh'], ['kahire', 'Kahire', 'EG', 30.04, 31.24, 'Africa/Cairo'], ['tahran', 'Tahran', 'IR', 35.69, 51.39, 'Asia/Tehran'],
  ['bagdat', 'Bağdat', 'IQ', 33.31, 44.36, 'Asia/Baghdad'], ['beyrut', 'Beyrut', 'LB', 33.89, 35.5, 'Asia/Beirut'], ['amman', 'Amman', 'JO', 31.95, 35.93, 'Asia/Amman'],
  ['new-york', 'New York', 'US', 40.71, -74.01, 'America/New_York'], ['washington', 'Washington', 'US', 38.91, -77.04, 'America/New_York'], ['chicago', 'Chicago', 'US', 41.88, -87.63, 'America/Chicago'],
  ['houston', 'Houston', 'US', 29.76, -95.37, 'America/Chicago'], ['denver', 'Denver', 'US', 39.74, -104.99, 'America/Denver'], ['phoenix', 'Phoenix', 'US', 33.45, -112.07, 'America/Phoenix'],
  ['los-angeles', 'Los Angeles', 'US', 34.05, -118.24, 'America/Los_Angeles'], ['san-francisco', 'San Francisco', 'US', 37.77, -122.42, 'America/Los_Angeles'], ['miami', 'Miami', 'US', 25.76, -80.19, 'America/New_York'],
  ['toronto', 'Toronto', 'CA', 43.65, -79.38, 'America/Toronto'], ['vancouver', 'Vancouver', 'CA', 49.28, -123.12, 'America/Vancouver'], ['meksiko', 'Meksiko', 'MX', 19.43, -99.13, 'America/Mexico_City'],
  ['sao-paulo', 'São Paulo', 'BR', -23.55, -46.63, 'America/Sao_Paulo'], ['buenos-aires', 'Buenos Aires', 'AR', -34.6, -58.38, 'America/Argentina/Buenos_Aires'], ['tokyo', 'Tokyo', 'JP', 35.68, 139.69, 'Asia/Tokyo'],
  ['seul', 'Seul', 'KR', 37.57, 126.98, 'Asia/Seoul'], ['sanghay', 'Şanghay', 'CN', 31.23, 121.47, 'Asia/Shanghai'], ['hong-kong', 'Hong Kong', 'HK', 22.32, 114.17, 'Asia/Hong_Kong'],
  ['singapur', 'Singapur', 'SG', 1.35, 103.82, 'Asia/Singapore'], ['kuala-lumpur', 'Kuala Lumpur', 'MY', 3.14, 101.69, 'Asia/Kuala_Lumpur'], ['cakarta', 'Cakarta', 'ID', -6.21, 106.85, 'Asia/Jakarta'],
  ['bangkok', 'Bangkok', 'TH', 13.76, 100.5, 'Asia/Bangkok'], ['yeni-delhi', 'Yeni Delhi', 'IN', 28.61, 77.21, 'Asia/Kolkata'], ['karaci', 'Karaçi', 'PK', 24.86, 67.01, 'Asia/Karachi'],
  ['sidney', 'Sidney', 'AU', -33.87, 151.21, 'Australia/Sydney'], ['melbourne', 'Melbourne', 'AU', -37.81, 144.96, 'Australia/Melbourne'], ['auckland', 'Auckland', 'NZ', -36.85, 174.76, 'Pacific/Auckland'],
  ['johannesburg', 'Johannesburg', 'ZA', -26.2, 28.05, 'Africa/Johannesburg'], ['lagos', 'Lagos', 'NG', 6.52, 3.38, 'Africa/Lagos'], ['nairobi', 'Nairobi', 'KE', -1.29, 36.82, 'Africa/Nairobi'],
  ['kazablanka', 'Kazablanka', 'MA', 33.57, -7.59, 'Africa/Casablanca'], ['tunus', 'Tunus', 'TN', 36.81, 10.18, 'Africa/Tunis'],
];

export const SEHIRLER: readonly Sehir[] = [
  ...IL.map(([id, ad, enlem, boylam]) => ({ id, ad, ulke: 'TR', enlem, boylam, saatDilimi: TR })),
  ...DUNYA.map(([id, ad, ulke, enlem, boylam, saatDilimi]) => ({ id, ad, ulke, enlem, boylam, saatDilimi })),
];
const SEHIR_HARITASI = new Map(SEHIRLER.map((s) => [s.id, s]));
export const sehirBul = (id: string | undefined): Sehir | undefined => (id ? SEHIR_HARITASI.get(id) : undefined);

/** Aynı yerin eski/eşdeğer saat dilimi adları (ICU sürümüne göre biri gelebilir). */
const DILIM_ESI: Record<string, string> = {
  'Asia/Istanbul': TR, Turkey: TR, 'Europe/Kiev': 'Europe/Kyiv', 'Europe/Nicosia': 'Asia/Nicosia', 'Asia/Famagusta': 'Asia/Nicosia',
  'America/Montreal': 'America/Toronto', 'Asia/Calcutta': 'Asia/Kolkata', 'Europe/Busingen': 'Europe/Zurich', 'Europe/Vaduz': 'Europe/Zurich',
  'America/Detroit': 'America/New_York', 'Asia/Chongqing': 'Asia/Shanghai', 'Australia/ACT': 'Australia/Sydney',
};
/** Dil bölgesinden (ör. "de-AT") ülke; şehir saat diliminden bulunamazsa o ülkenin ilk şehri. */
function bolgeUlkesi(dil: string | undefined): string | undefined {
  const m = /[-_]([A-Za-z]{2})\b/.exec(dil ?? '');
  return m ? m[1].toUpperCase() : undefined;
}

/** Saat diliminin şu anki UTC farkı (dakika); bilinmeyen dilimde undefined. */
export function dilimFarki(saatDilimi: string, t = Date.now()): number | undefined {
  try {
    const ad = new Intl.DateTimeFormat('en-US', { timeZone: saatDilimi, timeZoneName: 'longOffset' }).formatToParts(t).find((p) => p.type === 'timeZoneName')?.value ?? '';
    if (ad === 'GMT') return 0;
    const m = /GMT([+-])(\d{1,2}):?(\d{2})?/.exec(ad);
    return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : undefined;
  } catch { return undefined; }
}

/**
 * Varsayılan şehir (Ruling BB): önce sistem saat dilimi (o dilimin ilk şehri: Europe/Istanbul → İstanbul, Europe/Berlin → Berlin);
 * dilim listede yoksa (düzeltme turu 1) aynı ya da en yakın UTC farkındaki şehir — dil bölgesinin ülkesinden olan öncelikli (Asia/Manila +
 * en-US artık New York değil) — ve `tahmin: true`. Dilim de bilinmiyorsa dil bölgesi ("de-CH" → Zürih), en son İstanbul. Ağ yok, IP yok.
 */
const tahminOnbellegi = new Map<string, { sehir: Sehir; tahmin: boolean }>();
export function sehirTahmini(saatDilimi: string | undefined, dil?: string, t = Date.now()): { sehir: Sehir; tahmin: boolean } {
  // Saat farkı karşılaştırması onlarca Intl biçimleyicisi kurar: aynı dilim/dil için saat başına bir kez.
  const anahtar = `${saatDilimi}|${dil}|${Math.floor(t / 3600_000)}`;
  const var_ = tahminOnbellegi.get(anahtar);
  if (var_) return var_;
  const sonuc = sehirTahminiHesapla(saatDilimi, dil, t);
  if (tahminOnbellegi.size > 50) tahminOnbellegi.clear();
  tahminOnbellegi.set(anahtar, sonuc);
  return sonuc;
}
function sehirTahminiHesapla(saatDilimi: string | undefined, dil: string | undefined, t: number): { sehir: Sehir; tahmin: boolean } {
  const d = DILIM_ESI[saatDilimi ?? ''] ?? saatDilimi ?? '';
  // Türkiye'nin tek saat dilimi var: il listesinin ilki (Adana) değil, İstanbul. Yurt dışında dilimin ilk şehri (liste öyle sıralı).
  if (d === TR) return { sehir: SEHIR_HARITASI.get('istanbul')!, tahmin: false };
  const dilimden = SEHIRLER.find((s) => s.saatDilimi === d);
  if (dilimden) return { sehir: dilimden, tahmin: false };
  const ulke = bolgeUlkesi(dil);
  // Genel dilimler (UTC, Etc/GMT±n: çoğunlukla sanal makine/sunucu ayarı) yer söylemez: dil bölgesine bakılır.
  const genel = /^(Etc\/|UTC$|GMT$|Universal$|Zulu$)/.test(d);
  const fark = d && !genel ? dilimFarki(d, t) : undefined;
  if (fark !== undefined) {
    // Aday şehirler: yurt dışı listesi + İstanbul (il listesi aynı dilimde). Önce dil bölgesinin ülkesi, sonra liste sırası.
    const adaylar = [...SEHIRLER.filter((s) => s.ulke !== 'TR'), SEHIR_HARITASI.get('istanbul')!];
    const farklar = new Map<string, number>();
    const farkOf = (s: Sehir) => { if (!farklar.has(s.saatDilimi)) farklar.set(s.saatDilimi, dilimFarki(s.saatDilimi, t) ?? 9999); return farklar.get(s.saatDilimi)!; };
    let en: Sehir | undefined, enPuan = Infinity;
    for (const s of adaylar) {
      const puan = Math.abs(farkOf(s) - fark) * 10 + (s.ulke === ulke ? 0 : 1);
      if (puan < enPuan) { en = s; enPuan = puan; }
    }
    if (en) return { sehir: en, tahmin: true };
  }
  if (ulke === 'TR') return { sehir: SEHIR_HARITASI.get('istanbul')!, tahmin: false };
  const bolgeden = ulke ? SEHIRLER.find((s) => s.ulke === ulke) : undefined;
  return { sehir: bolgeden ?? SEHIR_HARITASI.get('istanbul')!, tahmin: !bolgeden && Boolean(saatDilimi) };
}
export function varsayilanSehir(saatDilimi: string | undefined, dil?: string): Sehir {
  return sehirTahmini(saatDilimi, dil).sehir;
}

/** Ayardaki şehir (geçerliyse) ya da saat diliminden varsayılan; tahminde haberler uluslararası, para birimi dil bölgesinden. */
export function panoKonumu(ayar: Pick<PanoAyari, 'sehir'> | undefined, saatDilimi: string | undefined, dil?: string, t = Date.now()): PanoKonumu {
  const secili = sehirBul(ayar?.sehir);
  const tahmin = secili ? null : sehirTahmini(saatDilimi, dil, t);
  const s = secili ?? tahmin!.sehir;
  const kaynak: PanoKonumu['kaynak'] = secili ? 'ayar' : tahmin!.tahmin ? 'tahmin' : 'saat-dilimi';
  const bolge = bolgeUlkesi(dil);
  return {
    sehirId: s.id, sehir: s.ad, ulke: s.ulke, enlem: s.enlem, boylam: s.boylam, saatDilimi: s.saatDilimi, kaynak,
    haberUlke: kaynak === 'tahmin' ? '*' : s.ulke,
    paraUlke: kaynak === 'tahmin' && bolge ? bolge : s.ulke,
  };
}

/** MET Norway: en çok 4 ondalık; gizlilik için şehir düzeyinde (2 ondalık ≈ 1 km) gönderilir. */
export const koordinat = (x: number) => (Math.round(x * 100) / 100).toFixed(2);

// ── Haber kaynakları (ülkeye göre) ────────────────────────────────────────────────────────────────────────────────────
// Yalnız başlık + kaynak adı + zaman gösterilir; özet, görsel ve haber metni ALINMAZ. Tıklanınca haber yayıncının kendi sitesinde
// açılır. Yayıncıların kullanım koşulları her yayıncının kendi sitesindedir; kendi derlemeni dağıtmadan önce onları gözden geçir.
export interface HaberKaynagi { id: string; ad: string; url: string }
const KATALOG: Record<string, readonly HaberKaynagi[]> = {
  TR: [
    { id: 'trt', ad: 'TRT Haber', url: 'https://www.trthaber.com/sondakika_articles.rss' },
    { id: 'bbc-tr', ad: 'BBC Türkçe', url: 'https://feeds.bbci.co.uk/turkce/rss.xml' },
    { id: 'dw-tr', ad: 'DW Türkçe', url: 'https://rss.dw.com/xml/rss-tur-all' },
    { id: 'ntv', ad: 'NTV', url: 'https://www.ntv.com.tr/son-dakika.rss' },
    { id: 'cumhuriyet', ad: 'Cumhuriyet', url: 'https://www.cumhuriyet.com.tr/rss' },
  ],
  DE: [
    { id: 'tagesschau', ad: 'tagesschau', url: 'https://www.tagesschau.de/xml/rss2/' },
    { id: 'dw-de', ad: 'DW', url: 'https://rss.dw.com/xml/rss-de-all' },
    { id: 'dw-tr', ad: 'DW Türkçe', url: 'https://rss.dw.com/xml/rss-tur-all' },
  ],
  AT: [
    { id: 'orf', ad: 'ORF', url: 'https://rss.orf.at/news.xml' },
    { id: 'dw-de', ad: 'DW', url: 'https://rss.dw.com/xml/rss-de-all' },
  ],
  FR: [
    { id: 'france24', ad: 'France 24', url: 'https://www.france24.com/fr/rss' },
    { id: 'lemonde', ad: 'Le Monde', url: 'https://www.lemonde.fr/rss/une.xml' },
  ],
  NL: [
    { id: 'nos', ad: 'NOS', url: 'https://feeds.nos.nl/nosnieuwsalgemeen' },
    { id: 'dw-en', ad: 'DW', url: 'https://rss.dw.com/xml/rss-en-all' },
  ],
  GB: [
    { id: 'bbc', ad: 'BBC News', url: 'https://feeds.bbci.co.uk/news/rss.xml' },
    { id: 'guardian', ad: 'The Guardian', url: 'https://www.theguardian.com/uk/rss' },
  ],
  US: [
    { id: 'npr', ad: 'NPR', url: 'https://feeds.npr.org/1001/rss.xml' },
    { id: 'bbc-world', ad: 'BBC News', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  ],
  '*': [
    { id: 'bbc-world', ad: 'BBC News', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
    { id: 'dw-en', ad: 'DW', url: 'https://rss.dw.com/xml/rss-en-all' },
    { id: 'aljazeera', ad: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
  ],
};
export function haberKaynaklari(ulke: string): readonly HaberKaynagi[] {
  return KATALOG[ulke] ?? KATALOG['*'];
}

// ── Kurlar ────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Kur kaynağı: Avrupa Merkez Bankası günlük referans kurları (kaynak gösterilerek serbest; Hakkında kaynağı gösterir). TCMB'nin today.xml'i
 * de çözülür (shared/pano-cozucu.ts tcmbCoz) ama TCMB sitesi "ticari amaçlı kullanım yazılı izne tabidir" diyor; bu yüzden varsayılan ECB.
 */
export const KUR_KAYNAGI: 'ecb' | 'tcmb' = 'ecb';
const AVRO = new Set(['DE', 'AT', 'FR', 'NL', 'BE', 'IT', 'ES', 'IE', 'FI', 'PT', 'GR', 'CY', 'SK', 'SI', 'EE', 'LV', 'LT', 'LU', 'MT', 'HR']);
const ULKE_PARA: Record<string, string> = {
  TR: 'TRY', GB: 'GBP', US: 'USD', CH: 'CHF', SE: 'SEK', NO: 'NOK', DK: 'DKK', PL: 'PLN', CZ: 'CZK', HU: 'HUF', RO: 'RON', BG: 'BGN',
  JP: 'JPY', CA: 'CAD', AU: 'AUD', NZ: 'NZD', CN: 'CNY', HK: 'HKD', KR: 'KRW', SG: 'SGD', IN: 'INR', MX: 'MXN', BR: 'BRL', ZA: 'ZAR', MY: 'MYR', ID: 'IDR', TH: 'THB',
};
export function yerelPara(ulke: string): string {
  return AVRO.has(ulke) ? 'EUR' : ULKE_PARA[ulke] ?? 'USD';
}
/** Gösterilecek yabancı paralar (yerel olan atlanır): USD, EUR, GBP; kartta 3 satır. */
export function gosterilecekKurlar(yerel: string): string[] {
  return ['USD', 'EUR', 'GBP', 'CHF'].filter((k) => k !== yerel).slice(0, 3);
}
export const PARA_ADI: Record<string, string> = { USD: 'ABD doları', EUR: 'Avro', GBP: 'İngiliz sterlini', CHF: 'İsviçre frangı', TRY: 'Türk lirası' };

// ── Hava simgeleri (MET symbol_code → Türkçe + simge) ─────────────────────────────────────────────────────────────────
export type HavaSimgesi = 'acik-gun' | 'acik-gece' | 'az-bulut-gun' | 'az-bulut-gece' | 'bulut' | 'sis' | 'yagmur' | 'saganak' | 'kar' | 'sulu-sepken' | 'firtina';
export function havaSimgesi(kod: string | undefined): HavaSimgesi {
  const k = String(kod ?? '');
  const gece = k.endsWith('_night') || k.endsWith('_polartwilight');
  if (k.includes('thunder')) return 'firtina';
  if (k.includes('sleet')) return 'sulu-sepken';
  if (k.includes('snow')) return 'kar';
  if (k.includes('showers')) return 'saganak';
  if (k.includes('rain')) return 'yagmur';
  if (k.startsWith('fog')) return 'sis';
  if (k.startsWith('cloudy')) return 'bulut';
  if (k.startsWith('partlycloudy') || k.startsWith('fair')) return gece ? 'az-bulut-gece' : 'az-bulut-gun';
  if (k.startsWith('clearsky')) return gece ? 'acik-gece' : 'acik-gun';
  return 'bulut';
}
export function havaMetni(kod: string | undefined): string {
  const k = String(kod ?? '').replace(/_(day|night|polartwilight)$/, '');
  const siddet = k.startsWith('light') ? 'Hafif ' : k.startsWith('heavy') ? 'Kuvvetli ' : '';
  const kok = k.replace(/^(light|heavy)/, '');
  if (kok.includes('thunder')) return 'Gök gürültülü sağanak';
  if (kok.startsWith('sleet')) return `${siddet}karla karışık yağmur`.replace(/^./, (h) => h.toLocaleUpperCase('tr'));
  if (kok.startsWith('snowshowers')) return `${siddet}kar sağanağı`.replace(/^./, (h) => h.toLocaleUpperCase('tr'));
  if (kok.startsWith('snow')) return siddet ? `${siddet}kar` : 'Karlı';
  if (kok.startsWith('rainshowers')) return `${siddet}sağanak`.replace(/^./, (h) => h.toLocaleUpperCase('tr'));
  if (kok.startsWith('rain')) return siddet ? `${siddet}yağmur` : 'Yağmurlu';
  const sabit: Record<string, string> = { clearsky: 'Açık', fair: 'Az bulutlu', partlycloudy: 'Parçalı bulutlu', cloudy: 'Bulutlu', fog: 'Sisli' };
  return sabit[k] ?? 'Bulutlu';
}

// ── Güneş (çevrimdışı; hava kartı ağ yokken de dolu kalsın) ────────────────────────────────────────────────────────────
/** Gün doğumu/batımı (NOAA'nın "sunrise equation" yaklaşımı; ±2 dk). Kutup gününde/gecesinde null. `gun`: o günün herhangi bir anı. */
export function gunesSaatleri(gun: Date, enlem: number, boylam: number): { dogus: Date | null; batis: Date | null } {
  const R = Math.PI / 180;
  const jd = Math.floor(gun.getTime() / 86_400_000) + 2440587.5 + 0.5; // o UTC gününün öğlesi
  const n = Math.round(jd - 2451545.0 + 0.0008);
  const jYildiz = n - boylam / 360;
  const M = (357.5291 + 0.98560028 * jYildiz) % 360;
  const C = 1.9148 * Math.sin(M * R) + 0.02 * Math.sin(2 * M * R) + 0.0003 * Math.sin(3 * M * R);
  const lambda = (M + C + 180 + 102.9372) % 360;
  const jTransit = 2451545.0 + jYildiz + 0.0053 * Math.sin(M * R) - 0.0069 * Math.sin(2 * lambda * R);
  const sinD = Math.sin(lambda * R) * Math.sin(23.4397 * R);
  const cosD = Math.cos(Math.asin(sinD));
  const cosW = (Math.sin(-0.833 * R) - Math.sin(enlem * R) * sinD) / (Math.cos(enlem * R) * cosD);
  if (cosW < -1 || cosW > 1) return { dogus: null, batis: null };
  const w = Math.acos(cosW) / R;
  const tarih = (j: number) => new Date((j - 2440587.5) * 86_400_000);
  return { dogus: tarih(jTransit - w / 360), batis: tarih(jTransit + w / 360) };
}

/** Bir anın verilen saat dilimindeki "YYYY-AA-GG" günü (sv-SE biçimi). */
export function yerelGun(iso: string | number | Date, saatDilimi: string): string {
  try { return new Date(iso).toLocaleDateString('sv-SE', { timeZone: saatDilimi }); } catch { return new Date(iso).toLocaleDateString('sv-SE'); }
}
/** Bir anın verilen saat dilimindeki saati ("14:00"). */
export function yerelSaat(iso: string | number | Date, saatDilimi: string): string {
  try { return new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: saatDilimi }); } catch { return new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }); }
}
