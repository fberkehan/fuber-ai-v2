// Bilgisayar modülünün fare/klavye DIŞINDAKİ araçları (dosya, komut, süreç, pano, sistem) için ortak kapı:
// "Durdur" ve acil dur bu araçları da keser, iş sürerken adada "Bilgisayarı kullanıyor: <eylem>" görünür.
// Fare/klavye araçlarının kapısı `control.ts` içindedir (adım adım kesme); bu kapı onun kaba taneli karşılığıdır.
import { t, type ToolContext, type ToolResult } from '@fuber/shared';
import type { PcAction } from './types';

export interface PcGate {
  /** Araç başlamadan sorulur: çağrı iptal edildiyse ya da "Durdur"/acil dur kilidi sürüyorsa modele dönecek sonuç; engel yoksa `null`. */
  blocked(ctx: Pick<ToolContext, 'signal'>): ToolResult | null;
  /** İş sürerken adada "Bilgisayarı kullanıyor: <eylem> · <etiket>" görünür; iş bitince (hata da olsa) kapanır. */
  busy<T>(action: PcAction, label: string | null, work: () => Promise<T>): Promise<T>;
  /** "Durdur"a ya da acil dura basılınca çağrılır (süren komutu öldürmek, döngüyü kesmek için). Dönen işlev kaydı kaldırır. */
  onStop(listener: () => void): () => void;
}

export interface GateDeps {
  now?(): number;
  /** Ada durumu (`pc.activity`). */
  onActivity?(event: { state: 'start' | 'end'; action: PcAction; label: string | null }): void;
  /** Fare/klavye motorunun kilidi de sorulur (kullanıcı araya girdiyse dosya/komut işi de başlamasın). */
  inputHalted?(): 'user' | 'panic' | null;
}

/** "Durdur"dan sonra yeni iş bu kadar süre başlamaz (`control.ts` › `TUNING.haltPanicMs` ile aynı). */
export const STOP_LOCK_MS = 10_000;

export interface PcGateControl extends PcGate {
  /** "Durdur" / acil dur: dinleyiciler çağrılır, yeni iş bir süre başlamaz. */
  stop(): void;
  stopped(): boolean;
}

export function createPcGate(deps: GateDeps = {}): PcGateControl {
  const now = deps.now ?? Date.now;
  const listeners = new Set<() => void>();
  let lockedUntil = 0;
  return {
    blocked(ctx) {
      if (ctx.signal.aborted) return { ok: false, text: t('pc.fail.aborted'), data: { reason: 'aborted' } };
      if (now() < lockedUntil || deps.inputHalted?.() === 'panic') return { ok: false, text: t('pc.fail.panic'), data: { reason: 'panic' } };
      return null;
    },
    async busy(action, label, work) {
      deps.onActivity?.({ state: 'start', action, label });
      try {
        return await work();
      } finally {
        deps.onActivity?.({ state: 'end', action, label });
      }
    },
    onStop(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    stop() {
      lockedUntil = now() + STOP_LOCK_MS;
      for (const listener of [...listeners]) {
        try {
          listener();
        } catch {
          // bir dinleyicinin hatası diğerlerini engellemesin
        }
      }
    },
    stopped: () => now() < lockedUntil,
  };
}
