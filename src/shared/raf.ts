// ── Çentiğin Raf'ı: saf kurallar (0.14 T27; R21; tests/raf.test.ts) ─────────────────────────────────────────────────────────────────────────────
// Raf, çentiğe sürüklenen dosya ve metinlerin geçici durağıdır. DOSYA KOPYALANMAZ: raf yalnız yolu (referansı), adı ve boyutu tutar; metin kartı en çok
// METIN_EN_COK karakterdir. Liste en çok RAF_EN_COK öğe tutar (eskiden yeniye sıralı; dolunca en eskisi düşer). Kayıt `userData/raf.json` (main/raf.ts).
// DOM ve Electron yok: ana süreç (kayıt doğrulaması) ve arayüz (liste sırası, boyut yazımı, sürükleme kararı) aynı kuralı okur.

export type RafOgesi =
  | { id: string; tur: 'dosya'; yol: string; ad: string; boyut: number; eklendi: string; eksik?: boolean; klasor?: boolean }
  | { id: string; tur: 'metin'; metin: string; eklendi: string };

/** Rafta en çok bu kadar öğe durur; 31. öğede en eskisi düşer. */
export const RAF_EN_COK = 30;
/** Metin kartı bu kadar karakterde kesilir (kart tam metni taşır; panelde iki satır görünür). */
export const METIN_EN_COK = 2000;

/** Aynı dosyanın iki yazımı (büyük/küçük harf, / ya da \) aynı sayılır: Windows yolları büyük/küçük harf duyarsızdır. */
export const yolAnahtari = (yol: string): string => yol.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();

/**
 * Öğeyi listenin sonuna ekler. Aynı yol (dosya) tekrar eklenmez: liste olduğu gibi döner. Listeyi bozmaz (yeni dizi döner); RAF_EN_COK aşılırsa en eskiler düşer.
 */
export function rafEkle(l: readonly RafOgesi[], o: RafOgesi): RafOgesi[] {
  if (o.tur === 'dosya') {
    const anahtar = yolAnahtari(o.yol);
    if (l.some((x) => x.tur === 'dosya' && yolAnahtari(x.yol) === anahtar)) return [...l];
  }
  const yeni = [...l, o];
  return yeni.length > RAF_EN_COK ? yeni.slice(yeni.length - RAF_EN_COK) : yeni;
}

/** Metni METIN_EN_COK karakterde keser (UTF-16 çift karakterin ortasından bölmez). */
export function metniKes(metin: string): string {
  if (metin.length <= METIN_EN_COK) return metin;
  let s = metin.slice(0, METIN_EN_COK);
  const son = s.charCodeAt(s.length - 1);
  if (son >= 0xd800 && son <= 0xdbff) s = s.slice(0, -1); // yarım vekil çifti
  return s;
}

const metinMi = (x: unknown): x is string => typeof x === 'string';

/**
 * Diskten okunan ya da elle bozulmuş kaydı doğrular: bilinmeyen biçim ve eksik alanlı öğe düşer, kimlik tekrarı düşer, aynı dosya yolu bir kez kalır, metin
 * kesilir, sayı RAF_EN_COK ile sınırlanır. `eksik` ve `klasor` diske yazılmaz (varlık her açışta ve liste çekilirken yeniden bakılır): kayıtta olsa da atılır.
 */
export function rafDogrula(x: unknown): RafOgesi[] {
  if (!Array.isArray(x)) return [];
  let l: RafOgesi[] = [];
  const kimlikler = new Set<string>();
  for (const o of x) {
    if (!o || typeof o !== 'object') continue;
    const r = o as Record<string, unknown>;
    if (!metinMi(r.id) || !r.id || r.id.length > 100 || kimlikler.has(r.id)) continue;
    const eklendi = metinMi(r.eklendi) && r.eklendi.length <= 40 ? r.eklendi : new Date(0).toISOString();
    if (r.tur === 'dosya') {
      if (!metinMi(r.yol) || !r.yol || r.yol.length > 4000 || !metinMi(r.ad) || !r.ad) continue;
      const boyut = typeof r.boyut === 'number' && Number.isFinite(r.boyut) && r.boyut >= 0 ? r.boyut : 0;
      kimlikler.add(r.id);
      l = rafEkle(l, { id: r.id, tur: 'dosya', yol: r.yol, ad: r.ad.slice(0, 260), boyut, eklendi });
    } else if (r.tur === 'metin') {
      if (!metinMi(r.metin) || !r.metin.trim()) continue;
      kimlikler.add(r.id);
      l = rafEkle(l, { id: r.id, tur: 'metin', metin: metniKes(r.metin), eklendi });
    }
  }
  return l;
}

/** Boyut yazımı ("0 B", "812 B", "1,4 MB"). Klasör ve bilinmeyen boyut (0) boş döner. */
export function boyutYaz(bayt: number): string {
  if (!(bayt > 0)) return '';
  if (bayt < 1024) return `${Math.round(bayt)} B`;
  const birimler = ['KB', 'MB', 'GB', 'TB'];
  let d = bayt / 1024;
  let i = 0;
  while (d >= 1024 && i < birimler.length - 1) { d /= 1024; i++; }
  return `${d < 10 ? d.toFixed(1).replace('.', ',') : Math.round(d)} ${birimler[i]}`;
}

/** Dosyanın "yerinde yok" yazısı (kart ve açma sonucu aynı metni söyler). */
export const DOSYA_YOK_METNI = 'Dosya yerinde yok';

/** Sürüklenen nesne çentiğe ulaştı mı: fare hareketi `buttons === 1` (sol düğme basılı) taşıyorsa. Düğmesiz hareket bu yoldan geçmez (üzerinden geçen imleç adayı yakalamaz). */
export const surukluyorMu = (buttons: number | undefined): boolean => buttons === 1;

/**
 * R21: sürükleme sırasında Electron'un ilettiği `buttons === 1` fare hareketi çentiğin şekline girince yakalama açılır (ana sürece `ada:fare(true)`), pencere bırakma hedefi
 * olur. `fare` arayüzün imleç işlevidir (useAsistan.ts `fare`: ana sürece `ada:fare` yazar, aynı durumu iki kez bildirmez). Yakalama açıldıysa true.
 */
export function surukleFareGonder(buttons: number | undefined, fare: (ustunde: boolean) => void): boolean {
  if (!surukluyorMu(buttons)) return false;
  fare(true);
  return true;
}

/** Çentiğe dışarıdan sürüklenen nesnenin olayı: `sekildeMi` imleç çentiğin şeklinin dikdörtgeninde mi, `iliskiliHedefVar` `dragleave`in relatedTarget'ı dolu mu. */
export type SurukleOlayi = { tur: 'dragover' | 'dragleave' | 'drop' | 'dragend'; sekildeMi: boolean; iliskiliHedefVar: boolean };

/**
 * R21 düzeltme turu 1 (I3): sürükleme yüzünden açılan yakalama OLAYLA düşer (zamanlayıcı ve yoklama yok). Sürükleme sürerken pencere işletim sisteminin bırakma hedefidir ve
 * fare hareketi gelmez; şeklin `mouseleave`'i de gelmeyebilir. Bu yüzden belge düzeyinde: şeklin DIŞINDA `dragover` (kutunun boş yeri bırakma hedefi olup altındaki uygulamanın
 * hedefini yutmasın), `drop` ve `dragend` (sürükleme bitti), imleç şekil dışındayken ilişkili hedefi olmayan `dragleave` (pencereden çıkış; şeklin çocukları arasındaki
 * geçişte Chromium ilişkili hedefi boş verebilir, o yüzden şekil içindeki `dragleave` bırakmaz) yakalamayı bırakır.
 */
export function surukleYakalamayiBirakMi(o: SurukleOlayi): boolean {
  switch (o.tur) {
    case 'dragover': return !o.sekildeMi;
    case 'dragleave': return !o.iliskiliHedefVar && !o.sekildeMi;
    default: return true; // drop, dragend
  }
}
