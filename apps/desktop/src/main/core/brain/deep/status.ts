/**
 * Derin beynin son durumu. Beyin servisi (`core/brain.ts`) `BrainStatus.deep` alanını buradan okur; derin beyin
 * kurulunca ve durumu değişince buraya yazar. Ayrı dosya: beyin servisi derin beynin geri kalanını içe aktarmaz.
 */
import { DEEP_BRAIN_UNKNOWN, type DeepBrainStatus } from '@fuber/shared';

let current: DeepBrainStatus = DEEP_BRAIN_UNKNOWN;

export function deepStatusSnapshot(): DeepBrainStatus {
  return current;
}

export function setDeepStatus(next: DeepBrainStatus): void {
  current = next;
}
