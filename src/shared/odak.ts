// ── Odak zamanlayıcısı ve Yapılacaklar girdisi (0.14 T26; saf; birim testli: tests/odak.test.ts, tests/yapilacaklar.test.ts) ─────────────────────────
// Çentik panelinin Odak sayfası: 25 dk odak, 5 dk kısa mola, 15 dk uzun mola (dördüncü odaktan sonra uzun mola önerilir). Durum ANA SÜREÇTE tutulur
// (main/odak.ts): bitiş MUTLAK zamandır (`bitis`, epoch ms), bu yüzden panel kapansa, pencere gizlense, bilgisayar uyusa da doğru kalır — kalan süre her
// zaman `bitis − şimdi`'den hesaplanır, sayaç tutulmaz. Duraklayınca `bitis` null olur ve kalan süre `duraklatildi`'ya (ms) yazılır; sürdürünce şimdiye eklenir.
// Bu dosyada Electron/DOM yok: ana süreç ve arayüz aynı kuralı içe aktarır.
// Yapılacaklar: sayfa kokpitin `gorevler` tablosunu okur ve yazar (yeni depo yok); burada yalnız yeni madde girdisinin temizliği ve sınırı durur.
import type { SistemUyarisi } from './sistem-uyarilari.ts';

export type OdakTuru = 'odak' | 'kisa' | 'uzun';

/** Sayım süreleri (sn): 25 dk odak, 5 dk kısa mola, 15 dk uzun mola. */
export const ODAK_SURELERI: Record<OdakTuru, number> = { odak: 1500, kisa: 300, uzun: 900 };
/** Her dördüncü odaktan sonra uzun mola önerilir. */
export const UZUN_MOLA_PERIYODU = 4;

export const ODAK_TUR_ADI: Record<OdakTuru, string> = { odak: 'Odak', kisa: 'Kısa mola', uzun: 'Uzun mola' };

/**
 * `tur`: seçili/süren sayımın türü. `bitis`: sayım sürerken bitişin epoch ms'si, yoksa null. `duraklatildi`: duraklamışken kalan süre (ms), yoksa null (ikisi aynı
 * anda dolu olmaz). `tamamlanan`: bugün biten odak sayısı (molalar sayılmaz).
 */
export interface OdakDurumu { tur: OdakTuru; bitis: number | null; duraklatildi: number | null; tamamlanan: number }

export const ODAK_ILK: OdakDurumu = { tur: 'odak', bitis: null, duraklatildi: null, tamamlanan: 0 };

export type OdakEylemi = 'baslat' | 'duraklat' | 'surdur' | 'sifirla' | 'bitti';
export interface OdakAdimi { tur: OdakEylemi; secim?: OdakTuru }

export const odakCalisiyor = (d: OdakDurumu): boolean => d.bitis !== null;
export const odakDuraklatildi = (d: OdakDurumu): boolean => d.bitis === null && d.duraklatildi !== null;

/** Odak bitince önerilen mola: her dördüncü odaktan sonra uzun, değilse kısa. */
export function onerilenMola(d: Pick<OdakDurumu, 'tamamlanan'>): 'kisa' | 'uzun' {
  return d.tamamlanan > 0 && d.tamamlanan % UZUN_MOLA_PERIYODU === 0 ? 'uzun' : 'kisa';
}

/** Kalan süre (sn, yukarı yuvarlanır: 00:00 yalnız bitişte). Sayım sürüyorsa `bitis − şimdi`, duraklamışsa saklanan süre, boştaysa türün süresi. */
export function kalanSn(d: OdakDurumu, simdi: number): number {
  if (d.bitis !== null) return Math.max(0, Math.ceil((d.bitis - simdi) / 1000));
  if (d.duraklatildi !== null) return Math.max(0, Math.ceil(d.duraklatildi / 1000));
  return ODAK_SURELERI[d.tur];
}

/** Çentiğin kenar ışığı (0.14 çentik cilası): sayım sürerken tek CSS animasyonunun süresi (`toplamMs`) ve başlangıcı (`gecenMs`, negatif gecikme olur);
 *  duraklamada durağan oran (`akiyor: false`); boştayken null. Zamanlayıcı yok: animasyon bir kez kurulur, olayla (odak:durum) yenilenir. */
export function odakIlerlemesi(d: OdakDurumu, simdi: number): { tur: OdakTuru; toplamMs: number; gecenMs: number; oran: number; akiyor: boolean } | null {
  const toplamMs = ODAK_SURELERI[d.tur] * 1000;
  const kalan = d.bitis !== null ? d.bitis - simdi : d.duraklatildi;
  if (kalan === null) return null;
  const k = Math.min(toplamMs, Math.max(0, kalan));
  const gecenMs = toplamMs - k;
  return { tur: d.tur, toplamMs, gecenMs, oran: gecenMs / toplamMs, akiyor: d.bitis !== null && k > 0 };
}

/**
 * Bir adım. Girdi değişmez.
 *  · baslat: boştaysa `secim ?? tür`'ün tam süresiyle başlar; duraklamışken `secim` yoksa sürdürür (süre kaybolmaz); sürerken `secim` yoksa yinelenen
 *    tıklamadır (etkisiz), `secim` varsa o türle yeni sayım başlatır.
 *  · duraklat / surdur: sayımı durdurur (kalan süre korunur) / kaldığı yerden sürdürür.
 *  · sifirla: sayımı bırakır; tür ve tamamlanan kalır.
 *  · bitti: yalnız sayım sürerken geçerlidir. Odak bittiyse tamamlanan artar ve sıradaki tür önerilen mola olur; mola bittiyse sıra odaktadır.
 */
export function odakAdimi(d: OdakDurumu, o: OdakAdimi, simdi: number): OdakDurumu {
  switch (o.tur) {
    case 'baslat': {
      if (o.secim === undefined) {
        if (d.bitis !== null) return d;
        if (d.duraklatildi !== null) return { ...d, bitis: simdi + d.duraklatildi, duraklatildi: null };
      }
      const tur = o.secim ?? d.tur;
      return { ...d, tur, bitis: simdi + ODAK_SURELERI[tur] * 1000, duraklatildi: null };
    }
    case 'duraklat':
      if (d.bitis === null) return d;
      return { ...d, bitis: null, duraklatildi: Math.max(0, d.bitis - simdi) };
    case 'surdur':
      if (d.duraklatildi === null) return d;
      return { ...d, bitis: simdi + d.duraklatildi, duraklatildi: null };
    case 'sifirla':
      return { ...d, bitis: null, duraklatildi: null };
    case 'bitti': {
      if (d.bitis === null) return d;
      if (d.tur !== 'odak') return { ...d, tur: 'odak', bitis: null, duraklatildi: null };
      const yeni = { ...d, tamamlanan: d.tamamlanan + 1, bitis: null, duraklatildi: null };
      return { ...yeni, tur: onerilenMola(yeni) };
    }
  }
}

/** Sayım bitince çentikte kısa hap ('odak-bitti'; T22 uyarı hapı, anahtarı yok). `biten`: biten sayımın türü, `yeni`: `bitti` adımından sonraki durum. */
export function odakUyarisi(biten: OdakTuru, yeni: OdakDurumu): SistemUyarisi {
  return biten === 'odak'
    ? { tur: 'odak-bitti', metin: `Odak bitti · ${ODAK_TUR_ADI[yeni.tur]}`, simge: 'hedef' }
    : { tur: 'odak-bitti', metin: `Mola bitti · ${ODAK_TUR_ADI.odak}`, simge: 'hedef' };
}

/** "25:00" biçimi (dakika:saniye; 99 dakikayı aşmaz çünkü en uzun sayım 25 dk). */
export function sureMetni(sn: number): string {
  const s = Number.isFinite(sn) ? Math.max(0, Math.floor(sn)) : 0;
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

const turMu = (x: unknown): x is OdakTuru => x === 'odak' || x === 'kisa' || x === 'uzun';
const ms = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.floor(x) : null);

/** Kalıcı kaydı temizler (elle bozulmuş/eski kayıt güvenli başlangıca düşer). Sayım sürerken `duraklatildi` tutarsızdır: düşer. */
export function odakDurumuDogrula(x: unknown): OdakDurumu {
  if (!x || typeof x !== 'object') return { ...ODAK_ILK };
  const o = x as Record<string, unknown>;
  const bitis = ms(o.bitis);
  return {
    tur: turMu(o.tur) ? o.tur : 'odak',
    bitis,
    duraklatildi: bitis === null ? ms(o.duraklatildi) : null,
    tamamlanan: ms(o.tamamlanan) ?? 0,
  };
}

/** Arayüzden gelen adım: `bitti` yalnız ana süreçten (zamanlayıcı) gelir; `secim` yalnız Başlat'ta anlamlıdır. Bozuksa null. */
export function odakAdimGirdisi(x: unknown): OdakAdimi | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (o.tur !== 'baslat' && o.tur !== 'duraklat' && o.tur !== 'surdur' && o.tur !== 'sifirla') return null;
  if (o.tur !== 'baslat') return { tur: o.tur };
  if (o.secim === undefined) return { tur: 'baslat' };
  return turMu(o.secim) ? { tur: 'baslat', secim: o.secim } : null;
}

// ── Yapılacaklar girdisi ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Yeni yapılacağın başlık sınırı (karakter). Panelde tek satır; ana süreç görev başlığını ayrıca 200'de keser. */
export const YAPILACAK_METIN_SINIRI = 120;
const SAAT = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Çentikten gelen yeni yapılacak: başlık düz metindir (kontrol karakterleri atılır, boşluklar birleşir, sınıra kısaltılır; HTML yorumlanmaz — arayüz metin olarak
 * çizer), `saat` isteğe bağlı "SS:DD" (yerel). Başlık boşsa ya da saat bozuksa null (hiçbir şey yazılmaz).
 */
export function yapilacakGirdisi(x: unknown): { baslik: string; saat: string | null } | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (typeof o.baslik !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const baslik = o.baslik.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, YAPILACAK_METIN_SINIRI).trim();
  if (!baslik) return null;
  if (o.saat === undefined || o.saat === null || o.saat === '') return { baslik, saat: null };
  return typeof o.saat === 'string' && SAAT.test(o.saat) ? { baslik, saat: o.saat } : null;
}
