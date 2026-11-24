/**
 * JARVIS HUD → Quest köprüsü. Çekirdek (`modules/jarvis`) Quest'i tanımaz; bu eklenti yalnız olayları dinler:
 *   `jarvis.snapshot`       her saniye anlık görüntü → bağlı gözlüğe `hud.snapshot` (değişmediyse en çok 5 sn'de bir)
 *   `jarvis.device`         ses seviyesi (`hud.voice`) ve günlük satırı (`hud.log`) → bağlı gözlüğe
 *   `xr.message` (quest)    gözlükten gelen `hud.action` → çekirdeğe `jarvis.deviceMessage`
 * Sözleşme: `plugins/jarvis-quest/docs/PROTOCOL.md` §7. Çekirdekte olmayan `bio` bölümü, Unity istemcisinin
 * JSON'u eksiksiz okuyabilmesi için "kapalı" değerleriyle eklenir.
 */
import type { HudSnapshot } from '../jarvis/types';

export const SNAPSHOT_MIN_RESEND_MS = 5000;

/** Çekirdek anlık görüntüsü + istemcinin beklediği, kapalı durumdaki `bio` bölümü. */
export function withLegacySections(snapshot: HudSnapshot): Record<string, unknown> {
  return {
    ...snapshot,
    bio: { status: 'off', source: 'none', worn: false, battery: null, hr: null, hrSeries: [], spo2: null, steps: null, kcal: null, skinTemp: null, stress: null, sleepMin: null, lastSampleAgoSec: null },
  };
}

export interface HudForwardDeps {
  now(): number;
  /** Gözlük şu an bağlı mı. */
  questUp(): boolean;
  /** Bağlı gözlüğe ileti yolla. */
  send(msg: Record<string, unknown>): void;
  /** Gözlükten gelen `hud.action`ı çekirdeğe ilet. */
  emitAction(kind: 'quest', msg: Record<string, unknown>): void;
}

export class HudForwarder {
  private sentAt = 0;
  private sentKey = '';
  private last: HudSnapshot | null = null;

  constructor(private readonly deps: HudForwardDeps) {}

  /** `jarvis.snapshot` geldi. `force`: yinelenme kuralı uygulanmaz (gözlük yeni bağlandı). */
  onSnapshot(snapshot: HudSnapshot, force = false): void {
    this.last = snapshot;
    if (!this.deps.questUp()) return;
    const t = this.deps.now();
    const key = JSON.stringify({ ...snapshot, ts: 0, seq: 0, clock: null });
    if (!force && key === this.sentKey && t - this.sentAt < SNAPSHOT_MIN_RESEND_MS) return;
    this.sentKey = key;
    this.sentAt = t;
    this.deps.send({ t: 'hud.snapshot', seq: snapshot.seq ?? 0, data: withLegacySections(snapshot) });
  }

  /** `jarvis.device` geldi (`hud.voice`, `hud.log`). */
  onDeviceMessage(msg: Record<string, unknown>): void {
    if (this.deps.questUp()) this.deps.send(msg);
  }

  /** Gözlük (yeniden) bağlandı: son görüntü hemen gider. */
  onQuestConnected(): void {
    if (this.last) this.onSnapshot(this.last, true);
  }

  /** `xr.message` geldi: yalnız gözlükten gelen `hud.action` çekirdeğe iletilir. */
  onXrMessage(kind: 'quest' | 'watch', msg: Record<string, unknown>): void {
    if (kind === 'quest' && msg.t === 'hud.action') this.deps.emitAction('quest', msg);
  }
}
