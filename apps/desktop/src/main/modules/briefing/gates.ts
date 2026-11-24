// Kendiliğinden konuşmanın kapıları ve ilgiye göre azalma. Saf işlevler: saat ve durum dışarıdan verilir, tablo satır
// satır birim testlidir. Kanal kararı (ada / ses / toast / beklet) Dikkat Yöneticisi'nindir (KURGU §8); buradaki kapı
// "şimdi kendiliğinden KONUŞMAYA kalkayım mı"yı söyler. Kapı kapalıyken brifing yine hazırlanır ve Bugün panosunda
// kart olur.
import { isWithinLocalTimeRange, type PresenceState, type VoiceState } from '@fuber/shared';
import type { BriefingAdaptive, BriefingKind, BriefingPrefs, TalkLevel } from './types';

/** Günde en çok kaç GÜNCELLEME (sabah brifingi ayrı sayılır). */
export const UPDATES_PER_DAY: Record<TalkLevel, number> = { silent: 0, low: 0, normal: 2, high: 4 };
/** Günde en çok kaç "önemli gelişme" araya girmesi. */
export const BREAKING_PER_DAY: Record<TalkLevel, number> = { silent: 0, low: 0, normal: 2, high: 3 };
/** İki güncelleme arasında en az bu kadar süre (ms). */
export const UPDATE_GAP_MS: Record<TalkLevel, number> = { silent: Infinity, low: Infinity, normal: 3 * 3_600_000, high: 90 * 60_000 };
/** Kendiliğinden iki konuşma arasında en az bu kadar süre. */
export const MIN_GAP_MS = 20 * 60_000;
/** Sabah brifingi, kullanıcı bilgisayar başına gelene dek bu kadar bekler; sonra yalnız kart olur. */
export const MORNING_WINDOW_MS = 4 * 3_600_000;
/** Bu kadar süredir girdi yoksa kullanıcı bilgisayar başında değildir (boş odaya konuşulmaz). */
export const ACTIVE_IDLE_SECONDS = 180;

export type GateReason =
  | 'ok'
  | 'disabled'
  | 'silent'
  | 'learned_silent'
  | 'level'
  | 'kill_switch'
  | 'quiet_hours'
  | 'fullscreen'
  | 'meeting'
  | 'voice_quiet'
  | 'user_speaking'
  | 'away'
  | 'hourly_limit'
  | 'daily_limit'
  | 'min_gap'
  | 'outside_hours';

export interface GateInput {
  kind: BriefingKind;
  now: Date;
  prefs: BriefingPrefs;
  adaptive: Pick<BriefingAdaptive, 'factor'>;
  presence: Pick<PresenceState, 'mode' | 'fullscreen' | 'meeting' | 'cameraInUse' | 'micInUseByOther' | 'idleSeconds'>;
  /** Sessiz saat ya da "rahatsız etme" (Dikkat Yöneticisi ile aynı kural). */
  quiet: boolean;
  killSwitch: boolean;
  voiceState: VoiceState;
  /** Sessiz kip: Jarvis hiç konuşmaz. */
  voiceQuiet: boolean;
  /** Sohbet kipi açık (kullanıcı konuşmanın ortasında). */
  conversation: boolean;
  /** Son 60 dakikada kendiliğinden kaç kez konuşuldu. */
  spokenLastHour: number;
  /** Bugün söylenen güncelleme ve "önemli gelişme" sayıları. */
  updatesToday: number;
  breakingToday: number;
  /** Kendiliğinden son konuşmanın anı (ms); yoksa `null`. */
  lastSpokenAt: number | null;
  /** Son GÜNCELLEMENİN anı (ms); yoksa `null`. */
  lastUpdateAt: number | null;
}

/** Öğrenilmiş çarpanla bugünkü güncelleme sınırı (aşağı yuvarlanır; çarpan 0,5'in altındaysa güncelleme yok). */
export const dailyUpdateLimit = (talk: TalkLevel, factor: number): number => Math.floor(UPDATES_PER_DAY[talk] * Math.min(1, Math.max(0, factor)));
export const dailyBreakingLimit = (talk: TalkLevel, factor: number): number => (factor <= 0 ? 0 : Math.max(factor >= 0.5 ? 1 : 0, Math.floor(BREAKING_PER_DAY[talk] * factor)));

/**
 * Şimdi kendiliğinden konuşulabilir mi. İlk tutmayan koşulun nedeni döner. `manual` (kullanıcı istedi) yalnız acil
 * durdurma ve sessiz kipe bakar: istenen brifing sınırlara takılmaz.
 */
export function speakGate(input: GateInput): GateReason {
  if (input.killSwitch) return 'kill_switch';
  if (input.kind === 'manual') return input.voiceQuiet ? 'voice_quiet' : 'ok';
  if (!input.prefs.enabled) return 'disabled';
  if (input.prefs.talk === 'silent') return 'silent';
  if (input.adaptive.factor <= 0) return 'learned_silent';
  if (input.kind !== 'morning' && input.prefs.talk === 'low') return 'level';
  if (input.kind === 'breaking' && !input.prefs.breaking) return 'level';
  if (input.voiceQuiet) return 'voice_quiet';
  if (input.quiet || input.presence.mode === 'quiet') return 'quiet_hours';
  if (input.presence.fullscreen || input.presence.mode === 'fullscreen') return 'fullscreen';
  if (input.presence.meeting || input.presence.micInUseByOther || input.presence.cameraInUse || input.presence.mode === 'meeting') return 'meeting';
  if (input.voiceState !== 'idle' || input.conversation) return 'user_speaking';
  if (input.presence.mode === 'away' || input.presence.idleSeconds > ACTIVE_IDLE_SECONDS) return 'away';
  const nowMs = input.now.getTime();
  if (input.spokenLastHour >= Math.max(1, input.prefs.maxPerHour)) return 'hourly_limit';
  if (input.lastSpokenAt !== null && nowMs - input.lastSpokenAt < MIN_GAP_MS) return 'min_gap';
  if (input.kind === 'update') {
    if (!isWithinLocalTimeRange(input.now, input.prefs.updates.from, input.prefs.updates.to)) return 'outside_hours';
    if (input.updatesToday >= dailyUpdateLimit(input.prefs.talk, input.adaptive.factor)) return 'daily_limit';
    if (input.lastUpdateAt !== null && nowMs - input.lastUpdateAt < UPDATE_GAP_MS[input.prefs.talk]) return 'min_gap';
  }
  if (input.kind === 'breaking' && input.breakingToday >= dailyBreakingLimit(input.prefs.talk, input.adaptive.factor)) return 'daily_limit';
  return 'ok';
}

/** Kapı kapalıyken beklemeye değer mi (kullanıcı konuşuyor, toplantı bitecek…) yoksa bu brifing yalnız kart mı olur. */
export const isTransient = (reason: GateReason): boolean => ['user_speaking', 'away', 'min_gap', 'hourly_limit', 'meeting', 'fullscreen', 'quiet_hours'].includes(reason);

// ───────────── ilgiye göre kendiliğinden azalma ─────────────

/** Çarpan basamakları: 1 → 0,5 → 0,25 → 0 (yalnız kart). İlgi gelince bir basamak geri çıkar. */
export const FACTOR_STEPS = [1, 0.5, 0.25, 0] as const;
/** Bu kadar ağırlık birikince bir basamak inilir. */
export const STEP_DOWN_WEIGHT = 4;
/**
 * Tepkinin ağırlığı. Ret açık bir işarettir (2). Yanıtsız kalmak zayıf bir işarettir: kullanıcı brifingi dinleyip
 * yanıt vermemiş olabilir (uyandırma sözü olmadan yanıt veremez). Güncelleme ve araya girme yanıtsız kalırsa 1, sabah
 * brifingi yanıtsız kalırsa 0,5 sayılır.
 */
export const ENGAGEMENT_WEIGHT = { declined: 2, ignoredUpdate: 1, ignoredMorning: 0.5 } as const;
/** Yalnız yanıtsızlık çarpanı bunun altına indiremez: Jarvis'i tümüyle susturmak için açık bir ret gerekir. */
export const IGNORE_FLOOR = 0.5;

export type Engagement = 'engaged' | 'ignored' | 'declined';

export interface AdaptiveChange {
  adaptive: BriefingAdaptive;
  /** Çarpan değişti mi (kullanıcıya bir kez söylenir / Ayarlar'da gösterilir). */
  stepped: 'down' | 'up' | null;
}

const stepIndex = (factor: number): number => {
  const index = FACTOR_STEPS.findIndex((step) => factor >= step);
  return index === -1 ? FACTOR_STEPS.length - 1 : index;
};

/**
 * Kullanıcının bir kendiliğinden konuşmaya tepkisini işler. `ignoredStreak` ağırlıklı sayaçtır (`ENGAGEMENT_WEIGHT`);
 * eşiği aşınca çarpan bir basamak iner ve sayaç sıfırlanır. `kind`: tepki verilen konuşmanın türü. İlgi (yanıt, karta dokunma) sayacı sıfırlar ve çarpanı
 * bir basamak yükseltir: kullanıcı yeniden ilgilenince Jarvis yeniden konuşmaya başlar.
 */
export function applyEngagement(current: BriefingAdaptive, signal: Engagement, now: Date, notes: { down: string; up: string }, kind: BriefingKind = 'update'): AdaptiveChange {
  const next: BriefingAdaptive = { ...current };
  let stepped: AdaptiveChange['stepped'] = null;
  if (signal === 'engaged') {
    next.engaged += 1;
    next.ignoredStreak = 0;
    const index = stepIndex(current.factor);
    if (index > 0) {
      next.factor = FACTOR_STEPS[index - 1]!;
      stepped = 'up';
      next.note = next.factor >= 1 ? null : notes.up;
      next.changedAt = now.toISOString();
    }
    return { adaptive: next, stepped };
  }
  if (signal === 'declined') next.declined += 1;
  else next.ignored += 1;
  // Yanıtsızlık çarpanı tabanın altına indiremez: tabandayken sayaç da birikmez (sonraki tek ret hemen susturmasın).
  if (signal === 'ignored' && current.factor <= IGNORE_FLOOR) return { adaptive: next, stepped };
  next.ignoredStreak += signal === 'declined' ? ENGAGEMENT_WEIGHT.declined : kind === 'morning' ? ENGAGEMENT_WEIGHT.ignoredMorning : ENGAGEMENT_WEIGHT.ignoredUpdate;
  if (next.ignoredStreak >= STEP_DOWN_WEIGHT) {
    const index = stepIndex(current.factor);
    if (index < FACTOR_STEPS.length - 1) {
      next.factor = FACTOR_STEPS[index + 1]!;
      stepped = 'down';
      next.note = notes.down;
      next.changedAt = now.toISOString();
    }
    next.ignoredStreak = 0;
  }
  return { adaptive: next, stepped };
}

/** Kendiliğinden konuşmadan sonra bu süre içinde kullanıcı yanıt verirse ilgi sayılır; vermezse "yanıtsız". */
export const RESPONSE_WINDOW_MS = 3 * 60_000;
/** Brifingden hemen sonra gelen ret sözü (katlanmış). */
export const DECLINE_WORDS = /\b(sus|yeter|kes|istemiyorum|istemem|gerek yok|sonra|simdi degil|rahatsiz etme|bosver|bos ver|ilgilenmiyorum|soyleme|anlatma|kapat)\b/;
