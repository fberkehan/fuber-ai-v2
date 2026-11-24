// Konuşma/dinleme seviyesi. Ham ölçüm gerçektir: TTS çıkış tamponunun (ya da mikrofonun) RMS'i ses katmanından `voice.level`
// olarak gelir (`voice/index.ts`: `rms` 0..1). Burada yalnız algısal sıkıştırma (dB) ve ≈15 Hz'e seyreltme yapılır; rastgele
// değer ÜRETİLMEZ. Node bağımlılığı YOK: renderer de aynı `levelFromRms`i kullanır.
import type { VoiceHudState } from './types';

/** 16 bit işaretli PCM'in RMS'i, 0..1 (tam ölçek = 1). */
export function rmsOfPcm16(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const v = (samples[i] ?? 0) / 32768;
    sum += v * v;
  }
  return Math.sqrt(sum / samples.length);
}

/** RMS (0..1) → algısal seviye (0..1): -50 dBFS ve altı 0, -5 dBFS ve üstü 1. Konuşma (~ -30..-12 dBFS) orta-üst aralıkta. */
export function levelFromRms(rms: number): number {
  if (!(rms > 0)) return 0;
  const db = 20 * Math.log10(Math.min(1, rms));
  return Math.max(0, Math.min(1, (db + 50) / 45));
}

/** Ses katmanı durumu → HUD durumu. Takip penceresi (`followup`) dinlemedir; mikrofon kapalı/boş = idle. */
export function hudStateOf(state: string): VoiceHudState {
  if (state === 'listening' || state === 'followup') return 'listening';
  if (state === 'thinking') return 'thinking';
  if (state === 'speaking') return 'speaking';
  return 'idle';
}

export const HUD_VOICE_MIN_GAP_MS = 66;

export interface HudVoiceMsg {
  t: 'hud.voice';
  state: VoiceHudState;
  level: number;
}

/** Duruma göre ölçülen seviyeyi yumuşatır ve en çok ≈15 Hz'te `hud.voice` iletisi üretir. */
export class VoiceHudTracker {
  state: VoiceHudState = 'idle';
  text = '';
  private level = 0;
  private lastSent = -Infinity;

  /** Durum değişti. Geçişte bir ileti döner (level 0). Aynı durum yinelenirse null. */
  setState(next: VoiceHudState, now: number): HudVoiceMsg | null {
    if (next === this.state) return null;
    this.state = next;
    this.level = 0;
    if (next === 'idle') this.text = '';
    this.lastSent = now;
    return { t: 'hud.voice', state: next, level: 0 };
  }

  setText(text: string): void {
    this.text = text.replace(/\s+/g, ' ').trim().slice(0, 160);
  }

  /** Ölçüm geldi (`source`: mic/speaker). Yalnız duruma uyan kaynak sayılır. */
  onRms(source: 'mic' | 'speaker', rms: number, now: number): HudVoiceMsg | null {
    const wanted = this.state === 'speaking' ? 'speaker' : this.state === 'listening' ? 'mic' : null;
    if (wanted !== source) return null;
    const raw = levelFromRms(rms);
    // hızlı yükselme, yavaş düşüş: dalga titremesin ama sesi gecikmeden izlesin
    this.level = raw > this.level ? this.level + (raw - this.level) * 0.7 : this.level + (raw - this.level) * 0.3;
    if (now - this.lastSent < HUD_VOICE_MIN_GAP_MS) return null;
    this.lastSent = now;
    return { t: 'hud.voice', state: this.state, level: Math.round(this.level * 1000) / 1000 };
  }
}
