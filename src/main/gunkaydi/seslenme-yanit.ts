// ── Gün içinde seslenilince: Fuber'in sesiyle yanıt ───────────────────────────────────────────────────────────────────────────────
// Döküme düşen satır Fuber'e bir seslenmeyse (bkz. shared/seslenme.ts) ya da Fuber az önce konuştu ve bu ona bir yanıtsa, soru ana
// ajana SESLİ tur olarak gider (kısa yanıt, düşük düşünme gücü) ve yanıt adada Fuber'in sesiyle söylenir (asistan:soyle → ada
// main/ses.ts konuşmasıyla, cümle cümle). Görev 21 (K10): eskiden önce yerel beyin (Bonsai) türü ve kısa bir yanıtı üretiyor, Piper'la
// "hı hı, bakıyorum" deniyor, sonra Claude çalışıyordu — iki beyin, iki ses, iki kat gecikme. Artık tek beyin, tek ses.
// Aynı anda tek seslenme işlenir (üst üste binmesin). "Hey Fuber" uyandırması açıksa o cümleler zaten asistana gider.
// Düzeltme 7: yanıt AKARKEN söylenir — ada turu üstlenir ('dinlendi': duyulan cümle soru olarak görünür, model yazdıkça cümle cümle
// konuşur; sesli sorunun aynısı). Eskiden tur bitince yanıtın ilk 600 harfi (sözcük ortasından kesilerek) tek seferde okunuyordu.
import { seslenmeAnaliz, devamMi } from '../../shared/seslenme.js';
import { anaSohbet } from '../sohbet.js';
import { ayarlar } from '../ayarlar.js';
import { beyinBasla, sinyal } from '../beyin.js';

export type Soyle = (v: { metin: string; tur: string; sesli: boolean; sohbetId?: number }) => void;

let sonKonusma = 0;
let suruyor = false;
/** Fuber bir şey söyledi (eşlikçi, seslenme yanıtı): kısa süre adsız yanıtlar da ona sayılır. */
export const fuberKonustu = () => { sonKonusma = Date.now(); };

export function seslenmeMi(metin: string): boolean {
  const a = ayarlar();
  if (!a.yerel.hitapAlgila) return false;
  if (a.ses.uyandirma && /^(hey|hay|ey)\s+(fuber|fiber)/i.test(metin)) return false; // uyandırma yolu karşılar
  return seslenmeAnaliz(metin).karar === 'seslenme' || devamMi(metin, sonKonusma, Date.now());
}

export async function seslenmeyeYanit(metin: string, _baglam: string[], soyle: Soyle): Promise<boolean> {
  if (suruyor) return false;
  suruyor = true;
  sinyal('yazici', 'uyanma', 'seslenme');
  const bitir = beyinBasla('uyanma', 'seslenildi · yanıt');
  try {
    // Ajan döngüsü burada dinamik yüklenir (dongu → araçlar → gün kaydı döngüsel içe aktarmasın).
    const { yanitla, mesgulMu } = await import('../ajan/dongu.js');
    const ana = anaSohbet();
    if (mesgulMu(ana)) return false; // ana sohbette yanıt sürüyor: adanın süren turu bozulmasın
    // Ada turu üstlenir (olaylardan ÖNCE; aynı pencere kanalı → sıra korunur): yanıt akarken cümle cümle konuşulur.
    soyle({ metin, tur: 'dinlendi', sesli: true, sohbetId: ana });
    const son = await yanitla(ana, { metin, kaynak: 'ses', sesli: true });
    const yazi = (son?.bloklar ?? []).some((b) => b.tur === 'metin' && b.metin.trim());
    if (yazi) fuberKonustu();
    return yazi;
  } finally {
    bitir();
    suruyor = false;
  }
}
