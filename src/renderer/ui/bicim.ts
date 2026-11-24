// Fuber arayüz kütüphanesinin saf yardımcıları (0.11 G3; tests/ui-kutuphanesi.test.ts). DOM'a ve React'e dokunmaz: bileşenler
// (Sayi, Ilerleme, Liste, MetinKirp, Satir) ve önizlemenin taşma denetimi (scripts/dev/tasma.mjs: aynı TASMA_PAYI) bunları kullanır;
// telefon/özet gibi düz metin yolları da sayiMetni ile aynı yazımı alır.

/** Ölçümde alt piksel yuvarlaması kırpma sayılmaz: kaydırma boyu kutuyu bundan ÇOK aşarsa taşmadır. */
export const TASMA_PAYI = 1;

const bicimciler = new Map<number, Intl.NumberFormat>();
const bicimci = (ondalik: number): Intl.NumberFormat => {
  let b = bicimciler.get(ondalik);
  if (!b) {
    // signDisplay 'negative': yuvarlanınca sıfır olan eksi değer (−0,04 → "0,0") işaretsiz yazılır.
    b = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: ondalik, maximumFractionDigits: ondalik, signDisplay: 'negative', useGrouping: true });
    bicimciler.set(ondalik, b);
  }
  return b;
};

/**
 * Sayı → tr-TR yazımı: binlik nokta, ondalık virgül, ondalık hane SABİT (sütunda hizalı durur), eksi işareti tipografik "−" (U+2212).
 * Sayı değilse "—". `ondalik` tam sayıya indirilir, 0–6 aralığında tutulur.
 */
export function sayiBicim(deger: number, ondalik = 0): string {
  if (!Number.isFinite(deger)) return '—';
  const o = Math.min(6, Math.max(0, Math.trunc(Number.isFinite(ondalik) ? ondalik : 0)));
  return bicimci(o).format(deger).replace('-', '−');
}

export type BirimKonumu = 'on' | 'bitisik' | 'ayri' | 'yok';

/** Birim nerede yazılır: Türkçede yüzde önde ("%42"), derece bitişik ("18°"), öteki birimler dar boşlukla ayrı ("1.234 TL"). */
export function birimKonumu(birim: string | undefined): BirimKonumu {
  const b = birim?.trim() ?? '';
  if (!b) return 'yok';
  if (b === '%') return 'on';
  if (b.startsWith('°')) return 'bitisik';
  return 'ayri';
}

/** Sayının düz metni (birimiyle): ipucu, ekran okuyucu, telefon/özet yolları. Ayrı birim dar bölünmez boşlukla (U+202F) bağlanır. */
export function sayiMetni(deger: number, birim?: string, ondalik = 0): string {
  const s = sayiBicim(deger, ondalik);
  const b = birim?.trim() ?? '';
  if (!Number.isFinite(deger)) return s;
  switch (birimKonumu(b)) {
    // Eksi işaret yüzde işaretinin önüne geçer: "−%0,30".
    case 'on': return s.startsWith('−') ? `−${b}${s.slice(1)}` : `${b}${s}`;
    case 'bitisik': return `${s}${b}`;
    case 'ayri': return `${s} ${b}`;
    default: return s;
  }
}

/**
 * Kırpma TAHMİNİ (ölçümden önce): metin `satir` satıra sığar mı? Satır başına ~`satirKarakteri` karakter varsayılır; sözcük sözcük
 * sarılır, satırdan uzun sözcük (overflow-wrap: anywhere) satır satır bölünür. Boşluklar ve satır sonları tek boşluktur (CSS
 * white-space: normal). Asıl karar ölçümdür (kirpildiMi); bu yalnız ilk karede odaklanabilirliği belirler.
 */
export function kirpGerekli(metin: string, satir: number, satirKarakteri = 40): boolean {
  const sozcukler = metin.split(/\s+/).filter(Boolean);
  if (!sozcukler.length) return false;
  if (!(satir >= 1)) return true;
  const k = Math.max(1, Math.floor(satirKarakteri));
  let satirlar = 1;
  let doluluk = 0;
  for (const s of sozcukler) {
    let u = [...s].length;
    const bosluk = doluluk > 0 ? 1 : 0;
    if (doluluk + bosluk + u <= k) { doluluk += bosluk + u; continue; }
    if (doluluk > 0) { satirlar++; doluluk = 0; }
    while (u > k) { u -= k; satirlar++; }
    doluluk = u;
    if (satirlar > satir) return true;
  }
  return satirlar > satir;
}

export interface KutuOlcusu { scrollWidth: number; clientWidth: number; scrollHeight: number; clientHeight: number }

/** Ölçülmüş kutu kırpılmış mı (yatay ya da dikey): kaydırma boyu kutuyu TASMA_PAYI'ndan çok aşıyorsa. */
export function kirpildiMi(o: KutuOlcusu, pay = TASMA_PAYI): boolean {
  return o.scrollWidth > o.clientWidth + pay || o.scrollHeight > o.clientHeight + pay;
}

/** Listenin görünen dilimi ve kalan sayısı ("Tümü"). `azami` yoksa ya da geçersizse (eksi, sayı değil) hepsi görünür. */
export function listeDilimi<T>(ogeler: readonly T[], azami?: number): { gorunen: T[]; kalan: number } {
  if (azami === undefined || !Number.isFinite(azami) || azami < 0) return { gorunen: [...ogeler], kalan: 0 };
  const n = Math.floor(azami);
  return { gorunen: ogeler.slice(0, n), kalan: Math.max(0, ogeler.length - n) };
}

/** İlerleme oranı 0–1: azami 0/eksi ya da değerler sayı değilse 0. */
export function ilerlemeOrani(deger: number, azami: number): number {
  if (!Number.isFinite(deger) || !Number.isFinite(azami) || azami <= 0) return 0;
  return Math.min(1, Math.max(0, deger / azami));
}

const yuzde = new Intl.NumberFormat('tr-TR', { style: 'percent', maximumFractionDigits: 0 });
/** Oran → "%60" (Türkçe: işaret önde). 1'i aşan oran %100 yazılır. */
export function yuzdeBicim(oran: number): string {
  return yuzde.format(Number.isFinite(oran) ? Math.min(1, Math.max(0, oran)) : 0);
}

/**
 * Kartın erişilebilir adı (G4 K2): başlık varsa kart `aria-labelledby` ile ona bağlanır — AMA çağıranın verdiği `aria-label` (ör. kokpitin
 * "Önem: acil" grup adı) başlığa ezilmez: aria-labelledby adlandırmada aria-label'dan önce gelir, koşulsuz bağlanırsa önem ekran okuyucuya
 * gitmez. `aria-label` verilmişse aria-labelledby koyulmaz (çağıranın `aria-labelledby`'si varsa o korunur).
 */
export function kartAdlandirma(baslik: string | undefined, baslikId: string, verilen: { 'aria-label'?: string; 'aria-labelledby'?: string }): { 'aria-labelledby'?: string } {
  if (verilen['aria-label']) return {};
  const baglanti = baslik ? baslikId : verilen['aria-labelledby'];
  return baglanti ? { 'aria-labelledby': baglanti } : {};
}
