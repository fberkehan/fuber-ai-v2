// ── Acil durdurma kısayolu GERÇEKTEN alındı mı (Görev 20b düzeltme turu 2) ─────────────────────────────────────────────────
// main.ts (kisayollariKaydet) yazar; tuşu söyleyen ana süreç metinleri (bilgisayar kontrolünün onayı) okur. Başka bir uygulama tuşu
// tutuyorsa söz verilmez, tepsideki "Tümünü durdur"a yönlendirilir. Bilinmiyorsa (henüz denenmedi) tuş söylenir.
let alindi: boolean | null = null;

export const acilKisayolAlindiMi = (): boolean | null => alindi;
export function acilKisayolAlindi(v: boolean): void { alindi = v; }
/** "İstediğin an … ile durdurabilirsin" cümlesindeki yol: okunur tuş ya da tepsi. */
export const acilDurdurmaYolu = (okunurTus: string): string => (alindi === false ? 'tepsideki “Tümünü durdur”' : okunurTus);
