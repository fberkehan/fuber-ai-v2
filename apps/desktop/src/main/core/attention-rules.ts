// Sahibi: T2. Dikkat Yöneticisinin kanal kararı (KURGU §8). Saf işlev: tablo satır satır birim testlidir.
import type { AttentionChannel, PresenceState, Priority } from '@fuber/shared';

/** Karar için kullanıcının durumu; öncelik sırası: tam ekran > toplantı > sessiz > normal. */
export type AttentionMode = 'fullscreen' | 'meeting' | 'quiet' | 'normal';

export const PRIORITY_RANK: Record<Priority, number> = { low: 0, normal: 1, high: 2, urgent: 3 };

export function attentionMode(presence: PresenceState, quietByUser: boolean): AttentionMode {
  if (presence.fullscreen || presence.mode === 'fullscreen') return 'fullscreen';
  if (presence.meeting || presence.mode === 'meeting') return 'meeting';
  if (quietByUser || presence.quiet || presence.mode === 'quiet') return 'quiet';
  // `away` tabloda yok: hatırlatıcı uzaktaki kullanıcıya da sesle ulaşmalı, bu yüzden normal sayılır.
  return 'normal';
}

/**
 * | Durum      | Davranış                                                                 |
 * |------------|--------------------------------------------------------------------------|
 * | fullscreen | Görsel yok. `urgent` → kısa ses; diğerleri bekler                         |
 * | meeting    | Ses yok. Sağ altta sessiz toast; `low` bekler                            |
 * | quiet      | Hepsi bekler; sonra özet                                                 |
 * | normal     | `high`+ → ada + ses (seslendirilecek metin yoksa yalnız ada); `normal` → toast; `low` → Bugün |
 */
export type SpokenLevel = 'none' | 'urgent' | 'high';

/**
 * Kullanıcının "hangi bildirimler sesli okunsun" tercihi bu bildirime izin veriyor mu. Bildirim yine görünür; bu yalnız
 * SESLİ okumayı (ses kanalını) kısar. Modül susturulmuşsa ya da öncelik düzeyin altındaysa sesli okunmaz.
 */
export function spokenAllowed(
  priority: Priority,
  moduleId: string,
  prefs: { level: SpokenLevel; mutedModules: string[] } | undefined,
): boolean {
  const level = prefs?.level ?? 'high';
  if (prefs?.mutedModules?.includes(moduleId)) return false;
  switch (level) {
    case 'none':
      return false;
    case 'urgent':
      return priority === 'urgent';
    case 'high':
      return PRIORITY_RANK[priority] >= PRIORITY_RANK.high;
  }
}

export function decideChannel(priority: Priority, mode: AttentionMode, speakable: boolean): AttentionChannel {
  switch (mode) {
    case 'fullscreen':
      // Ada tam ekranda zaten gizlidir; `voice` burada yalnız kısa sesi taşır (metin yoksa uyarı sesi).
      return priority === 'urgent' ? 'voice' : 'deferred';
    case 'meeting':
      return priority === 'low' ? 'deferred' : 'toast';
    case 'quiet':
      return 'deferred';
    case 'normal':
      if (PRIORITY_RANK[priority] >= PRIORITY_RANK.high) return speakable ? 'voice' : 'island';
      return priority === 'normal' ? 'toast' : 'today';
  }
}
