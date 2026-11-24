// ── Tek sayaçlı süre (saf; birim testli: tests/son-sayac.test.ts) ──────────────────────────────────────────────────────────────────
// Aynı satırı gösterip belli süre sonra kaldıran yerler için: yeni süre eskisini iptal eder, eski sayaç yeni iletiyi erken silmez (0.13 son düzeltme 7; bilesenler/Sohbet.tsx).
export interface SonSayac { kur(f: () => void, ms: number): void; iptal(): void }

export function sonSayac(): SonSayac {
  let z: ReturnType<typeof setTimeout> | null = null;
  const iptal = () => { if (z !== null) { clearTimeout(z); z = null; } };
  return { iptal, kur: (f, ms) => { iptal(); z = setTimeout(() => { z = null; f(); }, ms); } };
}
