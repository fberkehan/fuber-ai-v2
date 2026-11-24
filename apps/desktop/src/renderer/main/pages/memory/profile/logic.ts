// "Beni nasıl tanıyorsun" görünümünün saf mantığı: güven kademesi, grupların sırası, istem bloğu boyunun yuvarlanması.
// React ve IPC yok; `logic.test.ts` sınar.
import type { ProfileCategory, ProfileGroup, ProfileItem } from '../../../../../main/modules/memory/profile/types';

/** Üç kademeli güven: 1 zayıf (tahmin), 2 orta, 3 güçlü (açık söz ya da yinelenmiş). */
export type ConfidenceLevel = 1 | 2 | 3;

/** Açık söz 1,0 · çıkarım 0,7 · davranıştan 0,5–0,8 (sözleşme): 0,9 ve üstü güçlü, 0,65 ve üstü orta. */
export function confidenceLevel(value: number): ConfidenceLevel {
  if (!Number.isFinite(value)) return 1;
  if (value >= 0.9) return 3;
  if (value >= 0.65) return 2;
  return 1;
}

/**
 * Görünümdeki kategori sırası. Davranış kuralları her zaman en üsttedir (her turda uygulanan düzeltmeler); ardından
 * kimlik, çevre ve işler; en sonda süren meseleler. Sözleşmedeki `PROFILE_CATEGORIES` ile aynı küme.
 */
export const PROFILE_ORDER = ['rule', 'identity', 'circle', 'work', 'preference', 'style', 'routine', 'interest', 'dislike', 'ongoing'] as const satisfies readonly ProfileCategory[];

export interface OrderedGroups {
  /** "Davranış kuralları" grubu; boşsa `null`. */
  rules: ProfileGroup | null;
  /** Öteki dolu gruplar, `PROFILE_ORDER` sırasıyla; bilinmeyen kategori sona. */
  others: ProfileGroup[];
}

const rank = (category: string): number => {
  const index = (PROFILE_ORDER as readonly string[]).indexOf(category);
  return index === -1 ? PROFILE_ORDER.length : index;
};

/** Boş grupları atar, kuralları ayırır, kalanları görünüm sırasına dizer. Grup içi sıra ana süreçten geldiği gibidir. */
export function orderProfileGroups(groups: readonly ProfileGroup[]): OrderedGroups {
  const filled = groups.filter((group) => group.items.some((item) => item.status === 'active'));
  const active = filled.map((group) => ({ ...group, items: group.items.filter((item) => item.status === 'active') }));
  const rules = active.find((group) => group.category === 'rule') ?? null;
  const others = active.filter((group) => group.category !== 'rule').sort((a, b) => rank(a.category) - rank(b.category));
  return { rules, others };
}

/** Kaydın en son ne zaman öğrenildiği / düzeltildiği (satırdaki göreli zaman bunu gösterir). */
export function itemTime(item: Pick<ProfileItem, 'learnedAt' | 'updatedAt'>): string {
  return item.updatedAt > item.learnedAt ? item.updatedAt : item.learnedAt;
}

/** Ekleme/düzeltme metni kaydedilebilir mi: boş değil ve makul uzunlukta (tek cümle ya da birkaç cümle). */
export const PROFILE_TEXT_MAX = 400;
export function canSaveProfileText(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length >= 2 && trimmed.length <= PROFILE_TEXT_MAX;
}
