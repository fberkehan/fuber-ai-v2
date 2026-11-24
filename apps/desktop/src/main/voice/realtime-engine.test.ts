import { describe, expect, it, vi } from 'vitest';
import { pcmToBase64, type RealtimeSocket } from './realtime';
import { RealtimeController, type RealtimeControllerDeps } from './realtime-engine';

/** Sahte soket (realtime.test.ts'tekiyle aynı çekirdek): sunucu olaylarını elle besler. */
class FakeSocket implements RealtimeSocket {
  sent: Array<Record<string, unknown>> = [];
  private h: { open?: () => void; message?: (d: string) => void; close?: (c: number, r?: string) => void; error?: (e: Error) => void } = {};
  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close(): void {}
  on(event: 'open' | 'message' | 'close' | 'error', cb: never): void {
    (this.h as Record<string, unknown>)[event] = cb;
  }
  open(): void {
    this.h.open?.();
  }
  emit(event: Record<string, unknown>): void {
    this.h.message?.(JSON.stringify(event));
  }
  types(): string[] {
    return this.sent.map((item) => String(item.type));
  }
}

function setup() {
  const socket = new FakeSocket();
  const states: Array<{ state: string; reason: string }> = [];
  const partials: Array<{ role: string; text: string; final: boolean }> = [];
  const played: Array<{ pcm: number; end: boolean }> = [];
  const stops: number[] = [];
  const errors: Array<{ code: string }> = [];
  const deps: RealtimeControllerDeps = {
    transport: () => socket,
    getKey: () => 'sk-test',
    getConfig: () => ({ model: 'gpt-realtime-2.1', voice: 'marin', instructions: 'Jarvis' }),
    play: (_id, _rate, pcm, end) => played.push({ pcm: pcm.length, end }),
    stopPlayback: () => stops.push(1),
    emitState: (state, _prev, reason) => states.push({ state, reason }),
    emitPartial: (_turn, role, text, final) => partials.push({ role, text, final }),
    reportError: (code) => errors.push({ code }),
    followUpSeconds: () => 10,
    log: { info: () => {}, warn: () => {}, error: () => {} },
    inputRate: 16_000,
  };
  const controller = new RealtimeController(deps);
  const ready = () => {
    socket.open();
    socket.emit({ type: 'session.created' });
    socket.emit({ type: 'session.updated' });
  };
  return { controller, socket, states, partials, played, stops, errors, ready };
}

describe('RealtimeController', () => {
  it('uyandırma dinlemeyi açar; söz bölütü OpenAI\'ye (append+commit+response) gider ve düşünmeye geçer', () => {
    const { controller, socket, states, ready } = setup();
    controller.start();
    ready();
    controller.onWake();
    expect(states.at(-1)).toEqual({ state: 'listening', reason: 'wake' });
    controller.onUtterance(new Int16Array(160).fill(1000));
    expect(socket.types()).toContain('input_audio_buffer.append');
    expect(socket.types()).toContain('input_audio_buffer.commit');
    expect(socket.types()).toContain('response.create');
    expect(states.at(-1)).toEqual({ state: 'thinking', reason: 'speech_end' });
  });

  it('uyandırma olmadan gelen söz yok sayılır (OpenAI\'ye gitmez)', () => {
    const { controller, socket, ready } = setup();
    controller.start();
    ready();
    controller.onUtterance(new Int16Array(160).fill(1000));
    expect(socket.types()).not.toContain('response.create');
  });

  it('dönen ses çalma yoluna gider ve konuşmaya geçer; bitince takip penceresi', () => {
    const { controller, socket, states, played, ready } = setup();
    controller.start();
    ready();
    controller.onWake();
    controller.onUtterance(new Int16Array(160).fill(1000));
    socket.emit({ type: 'response.created' });
    socket.emit({ type: 'response.output_audio.delta', delta: pcmToBase64(new Int16Array([1, 2, 3])) });
    expect(states.at(-1)).toEqual({ state: 'speaking', reason: 'first_audio' });
    expect(played[0]).toEqual({ pcm: 3, end: false });
    socket.emit({ type: 'response.output_audio.done' });
    expect(played.at(-1)!.end).toBe(true);
    // Oynatma penceresi akışın bittiğini bildirir → takip.
    const streamId = (controller as unknown as { streamId: string }).streamId;
    controller.onPlaybackEnded(streamId);
    expect(states.at(-1)).toEqual({ state: 'followup', reason: 'speech_done' });
  });

  it('kullanıcı konuşunca model sesi kesilir (araya girme): çalma durur, yanıt iptal', () => {
    const { controller, socket, stops, ready } = setup();
    controller.start();
    ready();
    controller.onWake();
    controller.onUtterance(new Int16Array(160).fill(1000));
    socket.emit({ type: 'response.created' });
    socket.emit({ type: 'response.output_audio.delta', delta: pcmToBase64(new Int16Array([1])) });
    socket.sent = [];
    controller.onUserSpeechStart();
    expect(stops.length).toBeGreaterThan(0);
    expect(socket.types()).toContain('response.cancel');
  });

  it('ara ve son metin adaya düşer', () => {
    const { controller, socket, partials, ready } = setup();
    controller.start();
    ready();
    controller.onWake();
    controller.onUtterance(new Int16Array(160).fill(1000));
    socket.emit({ type: 'response.created' });
    socket.emit({ type: 'response.output_audio_transcript.delta', delta: 'Mer' });
    socket.emit({ type: 'response.output_audio_transcript.delta', delta: 'haba' });
    socket.emit({ type: 'response.output_audio_transcript.done', transcript: 'Merhaba efendim.' });
    expect(partials).toContainEqual({ role: 'assistant', text: 'Merhaba', final: false });
    expect(partials.at(-1)).toEqual({ role: 'assistant', text: 'Merhaba efendim.', final: true });
  });

  it('Sustur: çalma ve yanıt kesilir, boşa dönülür', () => {
    const { controller, socket, stops, states, ready } = setup();
    controller.start();
    ready();
    controller.onWake();
    controller.onUtterance(new Int16Array(160).fill(1000));
    socket.emit({ type: 'response.created' });
    socket.emit({ type: 'response.output_audio.delta', delta: pcmToBase64(new Int16Array([1])) });
    controller.hush();
    expect(stops.length).toBeGreaterThan(0);
    expect(states.at(-1)).toEqual({ state: 'idle', reason: 'stop_word' });
  });

  it('mikrofon kapatma: söz işlenmez', () => {
    const { controller, socket, states, ready } = setup();
    controller.start();
    ready();
    controller.setMicMuted(true);
    expect(states.at(-1)).toEqual({ state: 'mic_off', reason: 'mute' });
    controller.onWake();
    controller.onUtterance(new Int16Array(160).fill(1000));
    expect(socket.types()).not.toContain('response.create');
  });

  it('anahtar yoksa hata bildirilir', () => {
    const base = setup();
    const errors: Array<{ code: string }> = [];
    const controller = new RealtimeController({
      transport: () => base.socket,
      getKey: () => null,
      getConfig: () => ({ model: 'm', voice: 'marin', instructions: 'x' }),
      play: () => {},
      stopPlayback: () => {},
      emitState: () => {},
      emitPartial: () => {},
      reportError: (code) => errors.push({ code }),
      followUpSeconds: () => 10,
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });
    controller.start();
    expect(errors).toEqual([{ code: 'no_key' }]);
  });
});
