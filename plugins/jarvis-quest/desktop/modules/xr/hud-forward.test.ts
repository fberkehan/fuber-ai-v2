import { describe, expect, it } from 'vitest';
import { HudForwarder, SNAPSHOT_MIN_RESEND_MS, withLegacySections } from './hud-forward';
import type { HudSnapshot } from '../jarvis/types';

const snapshot = (over: Partial<HudSnapshot> = {}): HudSnapshot => ({ ts: 1, seq: 1, greeting: 'g', summary: 's', palette: 'cyan', tab: 'overview', clock: { time: '09:00:00', date: '', tz: '', place: '' }, env: {} as never, cal: {} as never, core: {} as never, fin: {} as never, links: {} as never, log: [], ...over }) as HudSnapshot;

function setup(up = true) {
  let t = 100_000;
  const sent: Array<Record<string, unknown>> = [];
  const actions: Array<Record<string, unknown>> = [];
  const state = { up };
  const forwarder = new HudForwarder({ now: () => t, questUp: () => state.up, send: (msg) => void sent.push(msg), emitAction: (_kind, msg) => void actions.push(msg) });
  return { forwarder, sent, actions, state, advance: (ms: number) => void (t += ms) };
}

describe('JARVIS HUD → Quest', () => {
  it('gözlük bağlı değilken hiçbir şey gitmez; bağlanınca son görüntü hemen gider', () => {
    const { forwarder, sent, state } = setup(false);
    forwarder.onSnapshot(snapshot());
    forwarder.onDeviceMessage({ t: 'hud.voice', state: 'idle', level: 0 });
    expect(sent).toEqual([]);
    state.up = true;
    forwarder.onQuestConnected();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ t: 'hud.snapshot', seq: 1 });
  });

  it('görüntü değişmediyse 5 sn dolmadan yeniden gitmez; değişince hemen gider', () => {
    const { forwarder, sent, advance } = setup();
    forwarder.onSnapshot(snapshot({ seq: 1 }));
    advance(1000);
    forwarder.onSnapshot(snapshot({ seq: 2, ts: 2 }));
    expect(sent).toHaveLength(1);
    advance(SNAPSHOT_MIN_RESEND_MS);
    forwarder.onSnapshot(snapshot({ seq: 3, ts: 3 }));
    expect(sent).toHaveLength(2);
    forwarder.onSnapshot(snapshot({ seq: 4, summary: 'yeni' }));
    expect(sent).toHaveLength(3);
  });

  it('çekirdekte olmayan bio bölümü kapalı değerleriyle eklenir', () => {
    const data = withLegacySections(snapshot()) as { bio: { status: string; hr: number | null } };
    expect(data.bio).toMatchObject({ status: 'off', hr: null });
  });

  it('ses ve günlük iletileri bağlıyken gider; gözlükten gelen hud.action çekirdeğe iletilir, saatten gelen iletilmez', () => {
    const { forwarder, sent, actions } = setup();
    forwarder.onDeviceMessage({ t: 'hud.voice', state: 'speaking', level: 0.4 });
    expect(sent).toEqual([{ t: 'hud.voice', state: 'speaking', level: 0.4 }]);
    forwarder.onXrMessage('quest', { t: 'hud.action', action: 'tab', tab: 'workshop' });
    forwarder.onXrMessage('quest', { t: 'ping' });
    forwarder.onXrMessage('watch', { t: 'hud.action', action: 'stop' });
    expect(actions).toEqual([{ t: 'hud.action', action: 'tab', tab: 'workshop' }]);
  });
});
