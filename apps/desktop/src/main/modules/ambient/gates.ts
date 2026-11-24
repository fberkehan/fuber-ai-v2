// Ortam dinlemenin kapıları. Saf işlevler: saat ve durum dışarıdan verilir, tablo satır satır birim testlidir
// (`gates.test.ts`). Karar modele bırakılmaz; model yalnız bu kapıların HEPSİ açıkken "söyleyecek bir şey var mı"
// diye sorulur (KURGU §10.2).
import { isWithinLocalTimeRange, type IsoDateTime, type PresenceState, type Settings, type VoiceState } from '@fuber/shared';
import { isWithinHours } from './periods';
import type { AmbientPrefs, InterjectReason, ListenReason, PausePreset } from './types';

/** Sessiz saatler ya da "rahatsız etme" açık mı (Dikkat Yöneticisi ile aynı kural). */
export function isQuietNow(settings: Pick<Settings, 'dnd' | 'dndUntil' | 'quietHours'>, now: Date): boolean {
  if (settings.dnd && (!settings.dndUntil || Date.parse(settings.dndUntil) > now.getTime())) return true;
  return settings.quietHours.enabled && isWithinLocalTimeRange(now, settings.quietHours.from, settings.quietHours.to);
}

export interface ListenInput {
  now: Date;
  killSwitch: boolean;
  /** `policy.ambient.allowed`. */
  allowed: boolean;
  consentAt: IsoDateTime | null;
  prefs: Pick<AmbientPrefs, 'enabled' | 'hours' | 'pauseWhenLocked'>;
  pausedUntil: IsoDateTime | null;
  micMuted: boolean;
  quiet: boolean;
  locked: boolean;
  /** Ses hattı sürekli döküm verebiliyor ve hazır mı. */
  feedReady: boolean;
}

/**
 * Dinlenebilir mi. İlk tutmayan koşulun nedeni döner; hepsi tutuyorsa `ok`.
 * Rıza ve Yönetim izni olmadan hiçbir ayar dinlemeyi açamaz; "mikrofonu kapat" ve sessiz saatler ortam dinlemeyi de kapatır.
 */
export function listenGate(input: ListenInput): ListenReason {
  if (input.killSwitch) return 'kill_switch';
  if (!input.allowed) return 'policy';
  if (!input.consentAt) return 'no_consent';
  if (!input.prefs.enabled) return 'disabled';
  if (input.pausedUntil && Date.parse(input.pausedUntil) > input.now.getTime()) return 'paused';
  if (input.micMuted) return 'mic_off';
  if (input.quiet) return 'quiet_hours';
  if (input.prefs.hours.enabled && !isWithinHours(input.now, input.prefs.hours)) return 'outside_hours';
  if (input.prefs.pauseWhenLocked && input.locked) return 'locked';
  if (!input.feedReady) return 'no_feed';
  return 'ok';
}

/** "Şimdi duraklat" seçeneğinin biteceği an. `today`: yerel gün bitene dek. */
export function pauseUntil(preset: PausePreset, now: Date): IsoDateTime {
  if (preset === '15m') return new Date(now.getTime() + 15 * 60_000).toISOString();
  if (preset === '1h') return new Date(now.getTime() + 60 * 60_000).toISOString();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
}

/** Son sözün bitişinden sonra bu kadar sessizlik olmadan "kullanıcı sustu" sayılmaz. */
export const SPEECH_SETTLE_MS = 2500;

export interface InterjectInput {
  /** Şimdiki an (ms). */
  now: number;
  listening: boolean;
  /** `policy.ambient.interjections`. */
  mode: 'off' | 'cloud-only' | 'on';
  /** Asistanın o anki beyni (`brain.status().provider`). */
  brain: 'cloud' | 'local' | 'none';
  /** Kullanıcının eşlikçi anahtarı. */
  companion: boolean;
  presence: Pick<PresenceState, 'mode' | 'fullscreen' | 'meeting' | 'cameraInUse' | 'micInUseByOther'>;
  quiet: boolean;
  /** `policy.ambient.maxInterjectionsPerHour`. */
  maxPerHour: number;
  /** Kullanıcı bugün "sus" dedi: saatlik sınır yarıya iner. */
  hushedToday: boolean;
  /** Son 60 dakikadaki araya girme sayısı. */
  countLastHour: number;
  /**
   * Son 60 dakikada beyne "söze girmeye değer mi" diye kaç kez soruldu ("değmez" yanıtı da sayılır). Bulut kotası
   * için saatlik sınır bunu da kapsar.
   */
  consultsLastHour: number;
  /** Son araya girmenin anı (ms); hiç yoksa `null`. */
  lastInterjectionAt: number | null;
  /** `policy.ambient.minGapSeconds`. */
  minGapSeconds: number;
  voiceState: VoiceState;
  /** Son döküm satırının bittiği an (ms); yoksa `null`. */
  lastSpeechEndedAt: number | null;
  /** Önceki değerlendirme hâlâ sürüyor. */
  evaluating: boolean;
}

/** Bugünkü saatlik sınır: kullanıcı "sus" dediyse yarısı (aşağı yuvarlanır). */
export function hourlyLimit(maxPerHour: number, hushedToday: boolean): number {
  const limit = Math.max(0, Math.floor(maxPerHour));
  return hushedToday ? Math.floor(limit / 2) : limit;
}

/**
 * Eşlikçi şu an araya girebilir mi. Toplantıda (mikrofon ya da kamera başka uygulamada), tam ekranda ve sessiz
 * saatlerde ASLA; saatlik sınır ve en kısa aralık politikadan; kullanıcı konuşurken ya da sesli tur sürerken girmez.
 */
export function interjectGate(input: InterjectInput): InterjectReason {
  if (!input.listening) return 'not_listening';
  if (input.mode === 'off') return 'policy_off';
  if (input.mode === 'cloud-only' && input.brain !== 'cloud') return 'needs_cloud';
  if (input.brain === 'none') return 'needs_cloud';
  if (!input.companion) return 'user_off';
  if (input.presence.fullscreen || input.presence.mode === 'fullscreen') return 'fullscreen';
  if (input.presence.meeting || input.presence.micInUseByOther || input.presence.cameraInUse || input.presence.mode === 'meeting') return 'meeting';
  if (input.quiet || input.presence.mode === 'quiet') return 'quiet_hours';
  const limit = hourlyLimit(input.maxPerHour, input.hushedToday);
  if (input.countLastHour >= limit || input.consultsLastHour >= limit) return 'hourly_limit';
  if (input.lastInterjectionAt !== null && input.now - input.lastInterjectionAt < input.minGapSeconds * 1000) return 'min_gap';
  if (input.voiceState !== 'idle') return 'user_speaking';
  if (input.lastSpeechEndedAt !== null && input.now - input.lastSpeechEndedAt < SPEECH_SETTLE_MS) return 'user_speaking';
  if (input.evaluating) return 'busy';
  return 'ok';
}
