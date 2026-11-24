/**
 * Ses penceresinin raporları (`audio.report` IPC kanalı) ile ses servisi arasındaki köprü.
 * IPC işleyicisi (`ipc/handlers/voice.ts`) yalnız `Services` arayüzünü görür ve `VoiceApi`'de rapor alan bir
 * yöntem yoktur; raporlar bu modül düzeyindeki dağıtıcıdan geçer.
 */

import type { AudioReport, Unsubscribe } from '@fuber/shared';

const listeners = new Set<(report: AudioReport) => void>();

export const audioReports = {
  deliver(report: AudioReport): void {
    for (const listener of [...listeners]) listener(report);
  },
  subscribe(listener: (report: AudioReport) => void): Unsubscribe {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
};
