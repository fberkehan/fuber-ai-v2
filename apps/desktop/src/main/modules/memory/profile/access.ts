// Profil katmanının başka modüllere açık yüzü (brifing, gündem). Hafıza modülü kapalıyken `null`.
import type { ProfileService } from './service';

let active: ProfileService | null = null;

/** Hafıza modülü açıkken etkin profil servisi; kapalıyken `null`. */
export const activeProfile = (): ProfileService | null => active;

/** Yalnız hafıza modülü çağırır (`setup` / `teardown`). */
export function setActiveProfile(service: ProfileService | null): void {
  active = service;
}
