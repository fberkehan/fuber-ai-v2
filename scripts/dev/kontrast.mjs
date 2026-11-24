// Kontrast hesabı (WCAG 2.x) — önizleme betiklerinin ortak yardımcısı (tema-onizle.mjs: cam belirteçleri, ada-onizle.mjs: ada
// malzemesi). Renkler getComputedStyle'dan gelir: 'rgb(…)' / 'rgba(…)', color-mix sonucu 'color(srgb r g b / a)' (0–1) ya da 0.14 T29
// düzeltme turu 1'den beri göreli oklch vurgusunun sonucu 'oklch(L C H / a)' / 'oklab(L a b / a)' (Chromium hangisini döndürürse).
// Tanınmayan biçim (display-p3, lab, adlı renk …) HATA atar: okunamayan renk sessizce "geçti" sayılmaz (tests/kontrast.test.ts).
// Saydam yüzeyler `ustune` ile alttaki zeminle birleştirilir (alfa karışımı); oran yalnız opak renkler arasında hesaplanır.

// ── OKLab ⇄ sRGB (Björn Ottosson'un matrisleri; CSS Color 4 ile aynı) ──
const gamaAc = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gamaKapa = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
/** sRGB (0–255) → OKLab [L, a, b]. */
export const srgbOklab = ([r, g, b]) => {
  const [R, G, B] = [r, g, b].map((x) => gamaAc(x / 255));
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
};
/** OKLab → sRGB (0–255; gamut dışı kanal kırpılır — Chromium'un ekran rengine çevirmesi gibi). */
export const oklabSrgb = ([L, a, b]) => {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const R = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const G = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const B = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return [R, G, B].map((x) => Math.round(Math.min(1, Math.max(0, gamaKapa(Math.min(1, Math.max(0, x))))) * 255 * 1000) / 1000);
};
/** sRGB → OKLCH [L, C, H°]. */
export const srgbOklch = (rgb) => { const [L, a, b] = srgbOklab(rgb); return [L, Math.hypot(a, b), ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360]; };
/** OKLCH → sRGB (0–255, kırpılmış). */
export const oklchSrgb = ([L, C, H]) => oklabSrgb([L, C * Math.cos((H * Math.PI) / 180), C * Math.sin((H * Math.PI) / 180)]);
/** CSS'teki `oklch(from <renk> clamp(taban, l, tavan) min(c, cTavan) h)` dönüşümünün aynısı (vurgu; tasarim.css, ui.css, fintech.css). */
export const acikligiSinirla = (rgb, taban, tavan, cTavan = Infinity) => { const [L, C, H] = srgbOklch(rgb); return [...oklchSrgb([Math.min(tavan, Math.max(taban, L)), Math.min(C, cTavan), H]), 1]; };

const sayilar = (s) => (s.slice(s.indexOf('(') + 1, s.lastIndexOf(')')).match(/-?[\d.]+(?:e-?\d+)?%?|none/g) ?? []).map((x) => (x === 'none' ? 0 : x.endsWith('%') ? Number(x.slice(0, -1)) / 100 : Number(x)));

/** CSS rengi → [r, g, b, a] (0–255, alfa 0–1). Tanınmayan biçimde hata atar. */
export const renkOku = (girdi) => {
  const s = String(girdi).trim();
  const hex = s.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    const h = hex[1].length <= 4 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
  }
  const m = sayilar(s);
  if (/^rgba?\(/i.test(s) && m.length >= 3) return [m[0], m[1], m[2], m[3] ?? 1];
  if (/^color\(\s*srgb\s/i.test(s) && m.length >= 3) return [m[0] * 255, m[1] * 255, m[2] * 255, m[3] ?? 1];
  if (/^oklch\(/i.test(s) && m.length >= 3) return [...oklchSrgb([m[0], m[1], m[2]]), m[3] ?? 1];
  if (/^oklab\(/i.test(s) && m.length >= 3) return [...oklabSrgb([m[0], m[1], m[2]]), m[3] ?? 1];
  throw new Error(`kontrast.mjs: okunamayan renk biçimi «${s.slice(0, 80)}»`);
};
/** Bir gradyan ya da kutu gölgesi metnindeki renkler (sırayla). */
export const renklerOku = (s) => String(s).match(/(rgba?|color|oklch|oklab|lab|lch)\([^)]*\)/g) ?? [];
const dogrusal = (c) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
const parlaklik = ([r, g, b]) => 0.2126 * dogrusal(r) + 0.7152 * dogrusal(g) + 0.0722 * dogrusal(b);
/** İki opak renk arasındaki WCAG kontrast oranı (1–21). */
export const kontrastOrani = (a, b) => { const x = parlaklik(a), y = parlaklik(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
/** `renk`i (alfalı) opak `zemin`in üstüne koyar → opak sonuç. */
export const ustune = (renk, zemin) => { const [r, g, b, a] = renk; return [r * a + zemin[0] * (1 - a), g * a + zemin[1] * (1 - a), b * a + zemin[2] * (1 - a), 1]; };
export const BEYAZ = [255, 255, 255, 1];
export const SIYAH = [0, 0, 0, 1];
