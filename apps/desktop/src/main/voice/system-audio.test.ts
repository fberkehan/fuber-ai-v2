import { describe, expect, it, vi } from 'vitest';

vi.mock('../runtime', () => ({ rendererUrl: () => 'file:///C:/app/renderer/audio/index.html' }));

const { acceptSystemAudioRequest, allowSystemAudioRequest, systemAudioRequestOpen } = await import('./system-audio');

describe('bilgisayar sesi isteği', () => {
  it('display-capture izni yalnız istek penceresi açıkken verilir (görülen "denied" kusuru)', () => {
    expect(systemAudioRequestOpen()).toBe(false);
    allowSystemAudioRequest();
    expect(systemAudioRequestOpen()).toBe(true);
    expect(systemAudioRequestOpen(Date.now() + 16_000)).toBe(false);
  });

  it('ses penceresinin isteği kabul edilir; başka sayfa, süresi dolmuş ya da sessiz istek geri çevrilir', () => {
    const audioUrl = 'file:///C:/Users/A%20B/app/renderer/audio/index.html';
    const base = { url: `${audioUrl}?x=1`, audioRequested: true, now: 1000, allowUntil: 2000, audioUrl };
    expect(acceptSystemAudioRequest(base)).toBe(true);
    expect(acceptSystemAudioRequest({ ...base, url: 'file:///C:/app/renderer/main/index.html' })).toBe(false);
    expect(acceptSystemAudioRequest({ ...base, now: 3000 })).toBe(false);
    expect(acceptSystemAudioRequest({ ...base, audioRequested: false })).toBe(false);
  });
});
