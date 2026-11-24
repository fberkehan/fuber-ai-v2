// "Claude Code oturumu bitti" kuralı. Saf işlev: sahte saatle sınanır.

export interface FinishCandidate {
  lastConvAt: string;
  /** Dosyanın son değişme anı (ms). */
  fileMtime: number;
}

export interface FinishRule {
  /** Son yanıttan sonra dosya bu kadar saniye büyümediyse tur bitmiştir (Claude Code araç çağırmıyor, kullanıcıyı bekliyor). */
  idleSeconds: number;
  /** Yalnız son bu kadar dakikada etkin olan oturumlar: eski oturumların bitişi haber değildir. */
  activeMinutes: number;
}

/**
 * Aday zaten "asistanın son iletisi tur sonu (`end_turn`) ve bu tur için henüz bildirilmedi" süzgecinden geçmiştir
 * (veritabanı sorgusu). Burada zaman koşulları: dosya `idleSeconds` boyunca büyümedi ve son yanıt `activeMinutes` içinde.
 */
export function finishDue(candidate: FinishCandidate, now: number, rule: FinishRule): boolean {
  const lastAt = Date.parse(candidate.lastConvAt);
  if (Number.isNaN(lastAt)) return false;
  const quietFor = now - Math.max(candidate.fileMtime, lastAt);
  if (quietFor < rule.idleSeconds * 1000) return false;
  return now - lastAt <= rule.activeMinutes * 60_000;
}
