import type { CSSProperties } from 'react';
import { Presence } from '../presence/Presence';
import type { PresenceState } from '../presence/types';

/** Eski "Öz" durum kümesi; yeni kodda `PresenceState` kullanın. */
export const CORE_STATES = ['idle', 'listening', 'thinking', 'speaking', 'muted', 'error'] as const;
export type CoreState = (typeof CORE_STATES)[number];

export const CORE_LABELS: Record<CoreState, string> = {
  idle: 'Asistan hazır',
  listening: 'Asistan dinliyor',
  thinking: 'Asistan düşünüyor',
  speaking: 'Asistan konuşuyor',
  muted: 'Mikrofon kapalı',
  error: 'Ses hattında sorun var',
};

export interface CoreProps {
  state: CoreState | PresenceState;
  level?: number;
  getLevel?: () => number;
  /** CSS pikseli. 24–28 (ray), 40 (satır), 72+ (sayfa başı, kapılar, kurulum). */
  size?: number;
  label?: string;
  className?: string;
  style?: CSSProperties;
  /** Sınama işareti; kök öğeye iletilir (`data-state` de aynı öğededir). */
  'data-testid'?: string;
}

/**
 * Eski ad: "Öz". Artık Jarvis'in varlığını (`Presence`: yıldızlardan toplanan çekirdek) çizer. Dış arayüz (state,
 * level, getLevel, size, label) korunmuştur.
 */
export function Core({ state, level, getLevel, size = 40, label, className, style, 'data-testid': testId }: CoreProps) {
  return (
    <Presence
      state={state}
      level={level}
      getLevel={getLevel}
      size={size}
      label={label ?? CORE_LABELS[state as CoreState]}
      className={className}
      style={style}
      data-testid={testId}
    />
  );
}
