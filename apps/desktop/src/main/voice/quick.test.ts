import { describe, expect, it } from 'vitest';
import type { Notification, VoiceApi, VoiceState, VoiceStatus } from '@fuber/shared';
import { hushNotices, isListeningPaused, QUICK_PAUSE_MINUTES, setListeningPaused, setQuietFromUi } from './quick';

/** Ses hattının küçük taklidi: çağrıları sırayla yazar, durumu taklit eder. */
function fakeVoice(state: VoiceState) {
  const calls: string[] = [];
  const status: VoiceStatus = {
    state,
    ready: true,
    notReadyReason: null,
    engine: 'cascade',
    micMuted: false,
    micMutedUntil: null,
    wakePausedUntil: null,
    quiet: false,
    conversation: false,
    bargeIn: 'voice',
    inputDeviceLabel: null,
    lastError: null,
  };
  const voice = {
    status: () => status,
    setQuiet(on: boolean) {
      calls.push(`setQuiet:${on}`);
      status.quiet = on;
    },
    stopSpeaking() {
      calls.push('stopSpeaking');
      status.state = 'followup';
    },
    pauseWake(minutes: number) {
      calls.push(`pauseWake:${minutes}`);
      status.wakePausedUntil = new Date(Date.now() + minutes * 60_000).toISOString();
    },
    resumeWake() {
      calls.push('resumeWake');
      status.wakePausedUntil = null;
    },
    cancelTurn() {
      calls.push('cancelTurn');
      status.state = 'idle';
    },
  } as unknown as VoiceApi;
  return { voice, calls, status };
}

describe('Hızlı kontrol: sessiz kip', () => {
  it('asistan konuşurken açılınca hemen susar; sonraki yanıt yazıyla gelir', () => {
    const { voice, calls } = fakeVoice('speaking');
    const next = setQuietFromUi(voice, true);
    expect(calls).toEqual(['setQuiet:true', 'stopSpeaking']);
    expect(next.quiet).toBe(true);
  });

  it('konuşmuyorken yalnız kip değişir; düşünürken süren iş kesilmez', () => {
    for (const state of ['idle', 'thinking', 'followup'] as const) {
      const { voice, calls } = fakeVoice(state);
      setQuietFromUi(voice, true);
      expect(calls, state).toEqual(['setQuiet:true']);
    }
  });

  it('kapatmak konuşmayı kesmez', () => {
    const { voice, calls } = fakeVoice('speaking');
    setQuietFromUi(voice, false);
    expect(calls).toEqual(['setQuiet:false']);
  });
});

describe('Bildirimi kapat / Sustur (ada ✕ ve Hızlı kontrol)', () => {
  const NOW = Date.parse('2026-11-18T10:00:00.000Z');
  const note = (id: string, patch: Partial<Notification> = {}): Notification => ({
    id,
    moduleId: 'projects',
    title: 'Claude Code bitti',
    body: '',
    priority: 'high',
    actions: [],
    speak: 'Claude Code oturumu bitti.',
    dedupeKey: null,
    data: {},
    status: 'shown',
    channel: 'voice',
    createdAt: new Date(NOW - 2000).toISOString(),
    shownAt: new Date(NOW - 2000).toISOString(),
    resolvedAt: null,
    actionId: null,
    ...patch,
  });
  const attentionOf = (list: Notification[]) => {
    const dismissed: string[] = [];
    return { dismissed, api: { pending: () => list, dismiss: (id: string) => void dismissed.push(id) } };
  };

  it('kartın ✕\'i: o bildirim kapanır VE konuşma susar (eskiden yalnız kayıt kapanıyordu, duyuru sürüyordu)', () => {
    const { voice, calls } = fakeVoice('speaking');
    (voice as { hush?: () => void }).hush = () => void calls.push('hush');
    const attention = attentionOf([note('n1'), note('n2')]);
    expect(hushNotices(attention.api, voice, { id: 'n1', now: NOW })).toEqual({ dismissed: 1 });
    expect(attention.dismissed).toEqual(['n1']);
    expect(calls).toEqual(['hush']);
  });

  it('yan menü: adada/çentikte o an görünen bildirimler kapanır; Bugün kutusundaki eski ve sessiz kanallı bildirimlere dokunulmaz', () => {
    const { voice, calls } = fakeVoice('idle');
    (voice as { hush?: () => void }).hush = () => void calls.push('hush');
    const attention = attentionOf([
      note('yeni'),
      note('ada', { channel: 'island', speak: null }),
      note('kart', { channel: 'toast', speak: null }),
      note('eski', { shownAt: new Date(NOW - 10 * 60_000).toISOString() }),
      note('bugun', { channel: 'today' }),
      note('bekliyor', { status: 'pending', shownAt: null }),
    ]);
    expect(hushNotices(attention.api, voice, { now: NOW })).toEqual({ dismissed: 3 });
    expect(attention.dismissed).toEqual(['yeni', 'ada', 'kart']);
    expect(calls).toEqual(['hush']);
  });

  it('ses hattında hush yoksa (sınama düzeneği) stopSpeaking ile susar', () => {
    const { voice, calls } = fakeVoice('speaking');
    hushNotices(attentionOf([]).api, voice, { now: NOW });
    expect(calls).toEqual(['stopSpeaking']);
  });
});

describe('Hızlı kontrol: dinlemeyi duraklat', () => {
  it('duraklatma uyandırma sözünü yok sayar ve o an süren dinlemeyi bitirir', () => {
    for (const state of ['listening', 'followup'] as const) {
      const { voice, calls, status } = fakeVoice(state);
      const next = setListeningPaused(voice, true);
      expect(calls, state).toEqual([`pauseWake:${QUICK_PAUSE_MINUTES}`, 'cancelTurn']);
      expect(isListeningPaused(next)).toBe(true);
      expect(status.state).toBe('idle');
    }
  });

  it('asistan konuşurken ya da düşünürken duraklatma yanıtı kesmez (susturmak ayrı düğmedir)', () => {
    for (const state of ['speaking', 'thinking', 'idle'] as const) {
      const { voice, calls } = fakeVoice(state);
      setListeningPaused(voice, true);
      expect(calls, state).toEqual([`pauseWake:${QUICK_PAUSE_MINUTES}`]);
    }
  });

  it('yeniden tıklayınca dinleme sürer', () => {
    const { voice, calls } = fakeVoice('idle');
    setListeningPaused(voice, true);
    const next = setListeningPaused(voice, false);
    expect(calls.at(-1)).toBe('resumeWake');
    expect(isListeningPaused(next)).toBe(false);
  });

  it('süresi geçmiş duraklatma duraklatılmış sayılmaz', () => {
    const { status } = fakeVoice('idle');
    status.wakePausedUntil = new Date(Date.now() - 1000).toISOString();
    expect(isListeningPaused(status)).toBe(false);
    expect(isListeningPaused(null)).toBe(false);
  });
});
