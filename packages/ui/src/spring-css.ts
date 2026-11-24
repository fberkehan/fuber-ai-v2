/**
 * Yayın CSS karşılığı (v1 `ui/fintech/yay.ts`'ten): CSS'te yay yoktur; yayın konum eğrisi örneklenip `linear()`
 * zamanlama işlevine çevrilir. Motion kullanılamayan yerlerde (düz CSS geçişi, `@starting-style`, gizli pencere) tek
 * kaynak budur: `tokens.css` içindeki `--ease-spring` ve `--ease-spring-bouncy` bu işlevin çıktısıdır (sınama eşler).
 *
 * İki parametre (Apple'ın akışkan arayüz dili): `response` (sn; hedefe ne çabuk varır) ve `damping` (sönüm oranı;
 * 1 = aşmadan oturur, < 1 hafif sekme).
 */

/** Yayın `t` saniyedeki konumu (0 → 1). */
export function springPosition(t: number, response: number, damping: number): number {
  const w = (2 * Math.PI) / response;
  if (damping >= 1) return 1 - (1 + w * t) * Math.exp(-w * t);
  const wd = w * Math.sqrt(1 - damping * damping);
  return 1 - Math.exp(-damping * w * t) * (Math.cos(wd * t) + ((damping * w) / wd) * Math.sin(wd * t));
}

/** `linear()` eğrisi ve süresi (ms). Eğri süre boyunca `points` örnekle çizilir; son nokta tam 1'dir. */
export function springCurve(options: { response?: number; damping?: number; points?: number } = {}): { curve: string; durationMs: number } {
  const response = options.response ?? 0.42;
  const damping = options.damping ?? 1;
  const points = options.points ?? 18;
  // Kritik sönümlü yay ~1 tepkide %98,6'ya varır; sekmeli yay biraz daha uzun salınır.
  const duration = response * (damping >= 1 ? 1 : 1.35);
  const values: string[] = [];
  for (let i = 0; i <= points; i++) {
    const value = i === points ? 1 : springPosition((i / points) * duration, response, damping);
    values.push(String(Math.round(value * 1000) / 1000));
  }
  return { curve: `linear(${values.join(', ')})`, durationMs: Math.round(duration * 1000) };
}

/** `tokens.css` › `--ease-spring` / `--duration-spring`: aşmadan oturan yay (0,42 sn). */
export const SPRING_CSS = springCurve();
/** `tokens.css` › `--ease-spring-bouncy` / `--duration-spring-bouncy`: hafif sekmeli yay (seçim, basma bırakılınca). */
export const SPRING_CSS_BOUNCY = springCurve({ response: 0.36, damping: 0.82 });
