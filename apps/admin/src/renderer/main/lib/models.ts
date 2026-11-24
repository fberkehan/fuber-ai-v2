/**
 * Model seçimindeki kısa not. Rakam yazılmaz (fiyat ve hız sağlayıcıda değişir, burada bayatlar):
 * yalnız aile içindeki göreli yer söylenir.
 */
import { t } from '@fuber/shared';

export type ModelTier = 'opus' | 'sonnet' | 'haiku' | 'other';

export function modelTier(id: string): ModelTier {
  const lower = id.toLowerCase();
  if (lower.includes('opus')) return 'opus';
  if (lower.includes('sonnet')) return 'sonnet';
  if (lower.includes('haiku')) return 'haiku';
  return 'other';
}

export function modelNote(id: string): string {
  return t(`admin.brain.tier.${modelTier(id)}`);
}

export const ROLES = ['voice', 'deep', 'memory', 'vision'] as const;
export type Role = (typeof ROLES)[number];
