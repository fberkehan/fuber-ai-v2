// ── Yerel beyin durumu (Ayarlar, kokpit) ve "Dene" (hızlı yanıt + ses süresi ölçümü) ─────────────────────────────
import { ayarlar } from '../ayarlar.js';
import { yerelYollar, yerelIndirmeDurumu, modelKuruluMu, yerelInenModel, yerelKaldiriliyorMu } from './kurulum.js';
import { nvidiaVarMi } from '../gpu.js';
import { yerelSunucuDurumu } from './sunucu.js';
import { katalogAciklamasi, katalogListe, modelEskiMi } from './katalog.js';
import { piperHazirMi } from './piper.js';
import { yerelSohbet, yerelModelEtiketi } from '../motor/yerel.js';
import { hitapMetni } from '../../shared/hitap.js';
import type { YerelModelAdi } from '../../shared/tipler.js';

let gpu: boolean | null = null;
void nvidiaVarMi().then((v) => { gpu = v; }).catch(() => undefined);

export interface YerelDurumu {
  etkin: boolean;
  kurulu: { calistirici: boolean; model: boolean; ses: boolean };
  sunucu: { calisiyor: boolean; aciliyor: boolean; hata?: string };
  indirme?: { yuzde: number; adim: string; hata?: string };
  /** Şu an inen model (indirme sürerken; kart "İndiriliyor" der ve "İndirmeyi durdur" görünür). */
  inen?: YerelModelAdi;
  /** "Kaldır" sürüyor (indirme durduruluyor, süreçler kapanıyor, dosyalar siliniyor; Görev 20b). */
  kaldiriliyor?: boolean;
  gpu: boolean | null;
  cuda: boolean;
  /** Katalog (0.13 G; yerel/katalog.ts): `ad` kayıt kimliği, `etiket` Developer'ın gördüğü ad, `ozet` Business'ın gördüğü satır, `dosya` Hugging Face'teki ad. boyut: bayt; ramGB/vramGB:
   *  gereksinim — Ayarlar'daki kartlar uygunluğu bununla gösterir; kurulu: model dosyası inmiş ve doğrulanmış ("Kurulu" / "İndirilmesi gerekir"); listedenKalkti: katalogdan kapatıldı, kurulu olan çalışır; eskiSurum: kurulu dosyanın
   *  özeti kayıttakiyle aynı değil, eskisi çalışır, "Yeniden indir" yenisini getirir. */
  modeller: { ad: YerelModelAdi; etiket: string; aciklama: string; ozet: string; dosya: string; boyut: number; ramGB: number; vramGB?: number; kurulu: boolean; listedenKalkti?: boolean; eskiSurum?: boolean }[];
}

export function yerelDurumu(): YerelDurumu {
  const y = yerelYollar();
  const s = yerelSunucuDurumu();
  return {
    etkin: ayarlar().yerel.etkin,
    kurulu: { calistirici: Boolean(y.sunucu), model: Boolean(y.model), ses: piperHazirMi() },
    sunucu: { calisiyor: s.calisiyor, aciliyor: s.aciliyor, hata: s.hata },
    indirme: yerelIndirmeDurumu(),
    ...(yerelInenModel() ? { inen: yerelInenModel()! } : {}),
    ...(yerelKaldiriliyorMu() ? { kaldiriliyor: true } : {}),
    gpu, cuda: y.cuda,
    modeller: katalogListe().map((k) => ({
      ad: k.id, etiket: k.ad, aciklama: katalogAciklamasi(k), ozet: k.ozet, dosya: k.dosya, boyut: k.boyut, ramGB: k.ramGB, ...(k.vramGB !== undefined ? { vramGB: k.vramGB } : {}),
      kurulu: modelKuruluMu(k.id), ...(k.acik ? (modelEskiMi(k) ? { eskiSurum: true } : {}) : { listedenKalkti: true }),
    })),
  };
}

/** Bulut yolunda "Dene" yerel modeli açmaz (yerel model o yolda hiçbir işte kullanılmaz; düzeltme 7). İki modda aynı sade metin. 0.12 H3c:
 *  yol "Nerede çalışsın"da Yalnız bu bilgisayar ya da Gizli seçilince yerelde. */
export const DENE_GIZLI_MODDA = 'Bu bilgisayardaki yapay zekâ yalnız “Yalnız bu bilgisayar” ya da Gizli seçiliyken yanıt verir; denemek için Nerede çalışsın’dan birini seç.';

/** Ayarlar'daki "Dene" (Gizlilik): yerel beynin kısa yanıtı + süresi. Görev 21: eski "hızlı yanıt" sınıflandırıcısı
 *  (Bonsai ön eleme) kalktı; doğrudan yerel beyin. Düzeltme 2: yanıt burada seslendirilmez (ayrı bir Piper WAV'ı + `new Audio` ikinci bir
 *  ses yoluydu, Sustur'u da atlıyordu) — arayüz ortak çalardan Fuber'in o anki sesiyle söyler (Gizli modda bu, yedek sestir).
 *  `tekMotor`: yerel beyin şu an tek motor mu (Gizli mod / bulutsuz); değilse sunucu açılmaz. */
export async function yerelDene(metin: string, tekMotor: boolean): Promise<{ yanit?: string; dusunmeMs?: number; hata?: string }> {
  if (!tekMotor) return { hata: DENE_GIZLI_MODDA };
  try {
    const a = ayarlar();
    const t0 = Date.now();
    const y = await yerelSohbet({
      model: yerelModelEtiketi(), araclar: [], maxToken: 200,
      sistemSabit: `Sen Fuber'sin: ${hitapMetni(a.kullaniciAdi, a.hitap) || 'kullanıcının'} kişisel asistanı. Bir iki kısa, sıcak, doğal Türkçe cümleyle yanıt ver; markdown yok.`,
      mesajlar: [{ rol: 'user', bloklar: [{ tur: 'metin', metin }] }],
    });
    const yanit = y.bloklar.map((b) => (b.tur === 'metin' ? b.metin : '')).join('').trim();
    return { yanit, dusunmeMs: Date.now() - t0 };
  } catch (e) {
    return { hata: (e as Error).message };
  }
}
