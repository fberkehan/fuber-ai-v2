// ── Yerel Whisper: tanı, hata eşleme, donanıma göre model (14 Kas 2026, 0.18.2; Electron'suz — tests/whisper-tani.test.ts) ──────────────────────────
// 0.18.1'de bir toplantıda bütün satırlar sonsuza dek "…" kaldı. Paketli ortamda yeniden üretilen kök neden: v1.9.2 "cublas-11.8.0" arşivi cublas64_11.dll'i
// İÇERMİYOR; ggml-cuda.dll yüklenemiyor, whisper-server SESSİZCE işlemciye düşüyor ("whisper_backend_init_gpu: no GPU found") ve large-v3-turbo işlemcide her istek
// için ~11 sn sürüyor (GPU'da 0,12–0,25 sn). Toplantıdaki büyüyen pencere + tek sıra bunu bitmeyen bir kuyruğa çeviriyordu; hiçbir hata da yoktu. Bu dosya:
//  · sunucu günlüğünden gerçek donanımı okur (GPU bulundu mu), · her hatayı "neden + tek cümle + eylem"e eşler, · işlemcide büyük modeli hızlı modele indirir.
import type { WhisperModeli } from './tipler.ts';

/** NVIDIA arşivi: CUDA 12.4 (cublas64_12.dll + cublasLt64_12.dll dahil; 11.8 arşivinde yok → GPU hiç kullanılamıyordu). Sürüm kurulum.json'a yazılır. */
export const WHISPER_CUDA_SURUMU = '12.4.0';
/** İstek bu süreyi aşarsa yerel tanıyıcı "yavaş" sayılır (ms; ortalama). Büyüyen pencerenin kısmi metni bu eşikte kapanır. */
export const WHISPER_YAVAS_MS = 3500;

/** ASCII dışı karakter (Türkçe harf, aksan…) içeren yol: whisper-server bunu dar karakterlerle okur. */
export const ASCII_DISI = /[^\x20-\x7e]/;

export type WhisperNedeni = 'model-yok' | 'baslamadi' | 'zaman-asimi' | 'cokme' | 'gpu-yok' | 'yavas' | 'bilinmeyen';
/** whisper.ts'in fırlattığı hata: neden + (sırsız, kısa) ayrıntı. */
export class WhisperHatasi extends Error {
  readonly neden: WhisperNedeni;
  constructor(neden: WhisperNedeni, ayrinti = '') {
    super(`Whisper ${neden}${ayrinti ? `: ${ayrinti}` : ''}`);
    this.neden = neden;
    this.name = 'WhisperHatasi';
  }
}

export interface WhisperSorunu { neden: WhisperNedeni; /** Tek cümle: ne oldu, ne yapılacak. */ metin: string; eylem?: 'whisper-indir'; /** Çipte "sorun" mu, sakin "bilgi" mi. */ seviye: 'sorun' | 'bilgi' }

/** Her hata için kullanıcıya tek cümle (+ eylem). Ham ileti ekranda yok (günlükte). */
export function whisperSorunu(e: unknown): WhisperSorunu {
  const neden: WhisperNedeni = e instanceof WhisperHatasi ? e.neden : /zaman aşımı|timeout|aborted/i.test(String((e as Error)?.message ?? e)) ? 'zaman-asimi' : 'bilinmeyen';
  switch (neden) {
    case 'model-yok': return { neden, metin: 'Yerel ses tanıma eksik ya da yarım indi; yazıya çevirmek için yeniden indir.', eylem: 'whisper-indir', seviye: 'sorun' };
    case 'baslamadi': return { neden, metin: 'Yerel yazıya çevirme başlatılamadı; yeniden indirmek çoğunlukla çözer.', eylem: 'whisper-indir', seviye: 'sorun' };
    case 'gpu-yok': return { neden, metin: 'Ekran kartı bu yazıya çevirme sürümüyle çalışmadı; işlemci sürümü ve daha hızlı ses dosyası indirilirse yazı akar.', eylem: 'whisper-indir', seviye: 'sorun' };
    case 'zaman-asimi': return { neden, metin: 'Yerel yazıya çevirme zamanında yanıt vermedi; bu bilgisayar için yavaş kalıyor olabilir.', seviye: 'sorun' };
    case 'cokme': return { neden, metin: 'Yerel yazıya çevirme beklenmedik biçimde kapandı; yeniden başlatılıyor.', seviye: 'sorun' };
    case 'yavas': return { neden, metin: 'Bu bilgisayarda yerel yazıya çevirme yavaş; yazı cümle bitince, gecikmeyle gelir.', seviye: 'bilgi' };
    default: return { neden: 'bilinmeyen', metin: 'Yerel yazıya çevirme çalışmadı; dinleme sürüyor.', seviye: 'sorun' };
  }
}

/** whisper-server günlüğünden donanım: 'cuda' (GPU bulundu), 'cpu' (GPU yok → işlemciye düştü), null (henüz söylemedi). */
export function sunucuDonanimi(log: string): 'cuda' | 'cpu' | null {
  if (/ggml_cuda_init: found \d+ CUDA devices?/i.test(log) || /whisper_backend_init_gpu: device \d+: (?!CPU)\S+/i.test(log)) return 'cuda';
  if (/no GPU found/i.test(log) || /whisper_backend_init_gpu: device \d+: CPU/i.test(log)) return 'cpu';
  return null;
}

/** İşlemcide büyük modeller her istek için ~9–11 sn (kısa ses de): canlı yazıya yetmez. İşlemci derlemesinde büyük model hızlı modele ('small-q5_1', ~1,8 sn) indirilir; GPU'da seçim aynen kalır. */
export function etkinWhisperModeli(secilen: WhisperModeli, derleme: 'cuda' | 'cpu' | undefined): WhisperModeli {
  return derleme === 'cpu' && (secilen === 'large-v3-turbo-q5_0' || secilen === 'large-v3-q5_0') ? 'small-q5_1' : secilen;
}

/** Çıkan sunucu günlüğünden (son kısım) ekrana ve tanıya giren kısa, sırsız ayrıntı. */
export function sunucuGunlukOzeti(log: string, n = 160): string {
  const satirlar = log.split(/\r?\n/).map((s) => s.trim()).filter((s) => /error|failed|cannot|not found|unable|no GPU/i.test(s));
  return (satirlar[satirlar.length - 1] ?? '').replace(/[A-Za-z]:[\\/][^\s'"]*/g, '<yol>').slice(0, n);
}

/** Gecikme ortalaması (üstel; ilk örnek aynen). */
export function gecikmeOrtalamasi(onceki: number | null, yeni: number): number { return onceki === null ? yeni : Math.round(onceki * 0.6 + yeni * 0.4); }

/** Ayrıntılar'a giren hata: Windows yolları (boşluklu klasörler dahil) `<yol>`, anahtar/belirteç benzeri uzun diziler `<gizli>` olur; tek satır, kısa. */
export function hataArindir(m: string, n = 180): string {
  return String(m ?? '')
    .replace(/[A-Za-z]:[\\/](?:[^\\/:*?"<>|\r\n]+[\\/])*[^\\/:*?"<>|\r\n]*?\.[A-Za-z0-9]{1,5}\b/g, '<yol>')
    .replace(/[A-Za-z]:[\\/][^\s'"]*/g, '<yol>')
    .replace(/\b[A-Za-z0-9_.-]{28,}\b/g, '<gizli>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, n);
}
