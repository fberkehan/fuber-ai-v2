// ── Dikte yolu (0.13 Görev 10): konuşmadan yazıya hangi yoldan, yoksa kullanıcıya hangi tek satır ────────────────────────────────────
// Sıra (spec C): bulut kiplerinde yalnız Fuber hesabı (canlı Scribe → toplu → tek satır; main/ses/merkez.ts); Gizli ve "Yalnız bu bilgisayar"da
// kurulu yerel Whisper. Vosk dikte için kullanılmaz ('cihaz' yolu yok); yol yoksa sessiz düşüş yerine tek düz satır söylenir. Bulut kiplerinde Whisper'a
// düşülmez ve otomatik indirilmez. Yerel kipte Whisper kurulu değilse ilk ELLE dikte isteğinde kurulur ("Hey Fuber" yolunda yalnız tek satır: yanlış uyanma indirme
// başlatmaz): inecek GERÇEK toplam (çalıştırıcı + model; NVIDIA'da CUDA arşivi dahil) satırda BİR kez söylenir (kota sürprizi olmasın), sürerken ilerleme, düşerse
// açık söz ve bir "Yeniden dene" (İş) ya da Ayarlar satırı (Geliştirici) — sessiz yeniden indirme yok. Saf karar: Electron'suz, testli (tests/dikte-sirasi.test.ts).
import { DIKTE_SINIR_METNI, type HesapDurumu } from './masaustu-hesap.ts';
import type { WhisperModeli } from './tipler.ts';

/** Yol yoksa söylenen tek satır (telefon köprüsünün ESKI_DIKTE_YOK'uyla aynı cümle). */
export const DIKTE_YOK = 'Şu an yazıya çevrilemiyor, yazarak devam edebilirsin.';

/** Hugging Face'teki GGML dosyalarının boyutu (ondalık MB; ggml-*.bin Content-Length). */
export const WHISPER_BOYUT_MB: Readonly<Record<WhisperModeli, number>> = { 'large-v3-turbo-q5_0': 574, 'large-v3-q5_0': 1081, 'small-q5_1': 190 };
/** whisper.cpp v1.9.2 Windows arşivleri (ondalık MB; GitHub varlık boyutu): işlemci (OpenBLAS) ve NVIDIA (CUDA 12.4; 11.8 arşivi cublas içermediği için GPU'yu hiç kullanamıyordu). */
export const WHISPER_CALISTIRICI_MB: Readonly<Record<'cpu' | 'cuda', number>> = { cpu: 21, cuda: 671 };

/** Bu bilgisayara inecek toplam (MB): yalnız eksik olanlar sayılır — çalıştırıcı gün kaydından zaten kuruluysa yalnız model. */
export function whisperIndirmeMB(g: { model: WhisperModeli; cuda: boolean; calistiriciVar: boolean; modelVar: boolean }): number {
  return (g.calistiriciVar ? 0 : WHISPER_CALISTIRICI_MB[g.cuda ? 'cuda' : 'cpu']) + (g.modelVar ? 0 : WHISPER_BOYUT_MB[g.model]);
}

export type DikteYolu = 'hesap' | 'whisper' | 'yok';

export interface DikteGirdisi {
  /** Gizli ya da "Yalnız bu bilgisayar": ses ve yazıya çevirme bu bilgisayardan çıkmaz (shared/nerede.ts). */
  bulutsuz: boolean;
  /** Fuber hesabı dikteye açık (aktif hesap, cihaz anahtarı, Gizli kapalı, sunucuda dikte modeli var). */
  hesapKullanilir: boolean;
  /** Hesabın durumu: kredi bittiyse (402) sonraki dikte de bunu söyler, genel metne düşmez. */
  hesapDurumu?: HesapDurumu | null;
  /** Kullanıcının kipi ('is' | 'gelistirici'): Ayarlar'daki ilerleme satırı ve yeniden deneme yalnız Geliştirici'de, "Yeniden dene" düğmesi İş'te. */
  mod?: string;
  /** Kullanıcı "Yeniden dene"ye bastı: düşmüş kurulum bir kez daha başlar. */
  yeniden?: boolean;
  /** Söz "Hey Fuber"den geldi, kullanıcı düğmeye basmadı (yanlış uyanma da olabilir): indirme başlamaz; satır elle yolu söyler. */
  uyandirma?: boolean;
  whisper?: {
    kurulu: boolean;
    /** Kurulum başlatılabilir mi (bağlı olmayan ortamlarda false). */
    kurulabilir: boolean;
    /** Bu kurulumda inecek toplam (MB; whisperIndirmeMB): satırda söylenir. */
    boyutMB?: number;
    /** Bu oturumdaki kurulum durumu (main/gunkaydi/whisper.ts IndirmeDurumu). */
    indirme?: { yuzde: number; adim: string; hata?: string };
  };
}

export interface DikteKarari {
  yol: DikteYolu;
  /** Yerel Whisper'ın kurulumu şimdi başlatılmalı (yalnız yerel kipte, yalnız söz gerçekten istenince). */
  kur: boolean;
  /** Yol 'yok' ise kullanıcıya söylenecek tek satır; çalışan yolda null. */
  satir: string | null;
  /** Satırın yanında tek "Yeniden dene" düğmesi (İş kipinde, düşmüş yerel kurulumda). */
  yenidenDene?: true;
}

/** Arayüze giden söylenecek satır (`ses:dikte-yok`, `ses:dikte-yeniden`). */
export interface DikteSatiri { satir: string; yenidenDene?: true }

export function dikteYolu(g: DikteGirdisi): DikteYolu {
  if (g.bulutsuz) return g.whisper?.kurulu ? 'whisper' : 'yok';
  return g.hesapKullanilir ? 'hesap' : 'yok';
}

function boyutMetni(mb: number): string {
  return mb >= 1000 ? `${(mb / 1000).toFixed(1).replace('.', ',')} GB` : `${mb} MB`;
}

export function dikteKarari(g: DikteGirdisi): DikteKarari {
  const yol = dikteYolu(g);
  if (yol !== 'yok') return { yol, kur: false, satir: null };
  // Bulut kipinde Whisper'a düşülmez, indirme de başlamaz. Kredi bittiyse sonraki dikte de bunu söyler.
  if (!g.bulutsuz) return { yol, kur: false, satir: g.hesapDurumu === 'kredi-bitti' ? DIKTE_SINIR_METNI.kredi : DIKTE_YOK };
  const w = g.whisper;
  if (!w?.kurulabilir) return { yol, kur: false, satir: DIKTE_YOK };
  const dev = g.mod === 'gelistirici';
  const ayarlarda = dev ? ' İlerlemeyi Ayarlar → Gün kaydı’nda görebilirsin.' : '';
  const ind = w.indirme;
  if (ind?.hata && !g.yeniden) {
    return dev
      ? { yol, kur: false, satir: 'Yerel yazıya çevirme kurulamadı. Ayarlar → Gün kaydı’ndan yeniden deneyebilirsin; şimdilik yazarak devam edebilirsin.' }
      : { yol, kur: false, satir: 'Yerel yazıya çevirme kurulamadı. Şimdilik yazarak devam edebilirsin.', yenidenDene: true };
  }
  if (ind && !ind.hata && ind.yuzde < 100) return { yol, kur: false, satir: `Yerel yazıya çevirme hazırlanıyor (%${Math.round(ind.yuzde)}); hazır olunca sesle yazdırabilirsin. Şimdilik yazarak devam edebilirsin.${ayarlarda}` };
  const boyut = w.boyutMB ? ` (yaklaşık ${boyutMetni(w.boyutMB)})` : '';
  // Otomatik indirme yalnız elle başlatılan diktede: yanlış uyanmanın ardından gelen konuşma yüzlerce MB indirmesin.
  if (g.uyandirma) return { yol, kur: false, satir: `Yerel yazıya çevirme kurulu değil. Sohbetteki mikrofona basınca indirilir${boyut}; şimdilik yazarak devam edebilirsin.` };
  return { yol, kur: true, satir: `Yerel yazıya çevirme ilk kullanımda indiriliyor${boyut}. Hazır olunca sesle yazdırabilirsin; şimdilik yazarak devam edebilirsin.${ayarlarda}` };
}
