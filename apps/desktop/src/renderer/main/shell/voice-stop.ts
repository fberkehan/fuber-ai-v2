// Ana pencereden "Sustur / Durdur" (demo.5): asistan konuşurken ya da iş yaparken konuş düğmeleri durdurma düğmesine
// döner ve Esc aynı işi görür. Tek yol `voice.stop` IPC'sidir (adanın Sustur düğmesiyle aynı).
import type { VoiceState } from '@fuber/shared';
import { attempt } from './live';

/** Asistan konuşuyor ya da iş yapıyor (düşünüyor / araç çalışıyor): durdurulabilir bir şey var. */
export function voiceBusy(state: VoiceState | null | undefined): boolean {
  return state === 'speaking' || state === 'thinking';
}

/** Konuşmayı ve süren işi keser. */
export function stopVoice(): void {
  void attempt(() => window.fuber.invoke('voice.stop'));
}

/**
 * Esc ile susturma kuralı: açık bir iletişim kutusu ya da çekmece varsa Esc önce onu kapatır (o dinleyiciler olayı
 * `preventDefault` ile işaretler ya da kutu hâlâ sayfadadır); yalnız böyle bir şey yoksa ve asistan meşgulse susturulur.
 */
export function escStopsVoice(event: KeyboardEvent, state: VoiceState | null | undefined): boolean {
  if (event.key !== 'Escape' || event.defaultPrevented || event.repeat) return false;
  if (event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return false;
  if (!voiceBusy(state)) return false;
  if (typeof document !== 'undefined' && document.querySelector('[role="dialog"], [aria-modal="true"], [role="menu"], [role="listbox"]')) return false;
  return true;
}
