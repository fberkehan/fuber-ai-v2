// ── Odak zili (0.14 T26) ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Sayım bitince ana süreç 'ada:odak-zil' yollar — yalnız hap gerçekten gösterildiyse (R25 kapısı hapı düşürürse zil de çalmaz; main/odak.ts odakBittiBagi). WAV paketli kaynaktan çalınır
// (resources/ses/odak-zil.wav, scripts/dev/zil-uret.mjs; `fuber://app/kaynak/…`, media-src izinli) — indirme ya da ağ yok. Çalınamazsa (ses çıkışı yok) sessizce geçilir.
import { kaynak } from '../api';

export async function odakZiliCal(): Promise<void> {
  try {
    const ses = new Audio(kaynak('ses/odak-zil.wav'));
    ses.volume = 0.7;
    await ses.play();
  } catch { /* ses çıkışı yok ya da engelli: hap yine görünür */ }
}
