import { describe, expect, it } from 'vitest';
import { chimeDecision, closeFallback, closeRoute, inQuietHours, normalizePrefs, shouldShowWhatsNew, WHATS_NEW, type BusyItem } from './lifecycle';
import { hasMessage } from './i18n/index';
import tr from './i18n/tr/lifecycle';

const busy: BusyItem[] = [{ kind: 'jobs', count: 1, title: 'Rapor' }];
const chime = { packaged: true, testMode: false, enabled: true, quietHours: { enabled: false, from: '23:00', to: '08:00' }, dnd: false, now: new Date(2026, 10, 17, 10, 0) };

describe('kapanış yolu', () => {
  it('pencerenin X’i ayara uyar; "çık" ayarında süren iş varsa yine sorulur', () => {
    expect(closeRoute('window', 'ask', [])).toBe('ask');
    expect(closeRoute('window', 'background', busy)).toBe('hide');
    expect(closeRoute('window', 'quit', [])).toBe('quit');
    expect(closeRoute('window', 'quit', busy)).toBe('ask');
  });

  it('tepsi ve app.quit: süren iş yoksa sormadan çıkar, varsa sorar', () => {
    for (const source of ['tray', 'app'] as const) {
      expect(closeRoute(source, 'ask', [])).toBe('quit');
      expect(closeRoute(source, 'background', [])).toBe('quit');
      expect(closeRoute(source, 'ask', busy)).toBe('ask');
    }
  });

  it('diyalog açılamazsa: X tepsiye iner, çıkış kilitlenmez', () => {
    expect(closeFallback('window')).toBe('hide');
    expect(closeFallback('tray')).toBe('quit');
    expect(closeFallback('app')).toBe('quit');
  });

  it('tercihler eksik ya da bozuksa varsayılanla tamamlanır', () => {
    expect(normalizePrefs(undefined)).toEqual({ closeAction: 'ask', startupSound: true });
    expect(normalizePrefs({ closeAction: 'bilinmez', startupSound: 'evet' })).toEqual({ closeAction: 'ask', startupSound: true });
    expect(normalizePrefs({ closeAction: 'quit', startupSound: false })).toEqual({ closeAction: 'quit', startupSound: false });
  });
});

describe('açılış çanı', () => {
  it('yalnız paketli üretimde ve ayar açıkken çalar', () => {
    expect(chimeDecision(chime)).toBe('play');
    expect(chimeDecision({ ...chime, testMode: true })).toBe('test');
    expect(chimeDecision({ ...chime, packaged: false })).toBe('dev');
    expect(chimeDecision({ ...chime, enabled: false })).toBe('off');
    // Sınama kipi her şeyin önündedir: paketli ve açık olsa bile çalmaz.
    expect(chimeDecision({ ...chime, testMode: true, packaged: true, enabled: true })).toBe('test');
  });

  it('sessiz saatte ve rahatsız etmede çalmaz', () => {
    expect(chimeDecision({ ...chime, dnd: true })).toBe('quiet');
    expect(chimeDecision({ ...chime, quietHours: { enabled: true, from: '09:00', to: '11:00' } })).toBe('quiet');
    expect(chimeDecision({ ...chime, quietHours: { enabled: true, from: '23:00', to: '08:00' } })).toBe('play');
  });

  it('sessiz saat gece yarısını aşar; başlangıç = bitiş sessiz sayılmaz', () => {
    expect(inQuietHours('23:00', '08:00', new Date(2026, 0, 1, 2, 0))).toBe(true);
    expect(inQuietHours('23:00', '08:00', new Date(2026, 0, 1, 8, 0))).toBe(false);
    expect(inQuietHours('10:00', '10:00', new Date(2026, 0, 1, 10, 0))).toBe(false);
  });
});

describe('yenilikler', () => {
  it('sürüm değişince bir kez; yeni kurulumda yok', () => {
    const current = '2.0.0-demo.3';
    expect(shouldShowWhatsNew({ lastRunVersion: '2.0.0-demo.2', currentVersion: current, setupCompleted: true })).toBe(true);
    expect(shouldShowWhatsNew({ lastRunVersion: null, currentVersion: current, setupCompleted: true })).toBe(true);
    expect(shouldShowWhatsNew({ lastRunVersion: null, currentVersion: current, setupCompleted: false })).toBe(false);
    expect(shouldShowWhatsNew({ lastRunVersion: current, currentVersion: current, setupCompleted: true })).toBe(false);
    expect(shouldShowWhatsNew({ lastRunVersion: '2.0.0-demo.2', currentVersion: '9.9.9', setupCompleted: true })).toBe(false);
  });

  it('demo.3 maddeleri 6–8 tane ve sözlükte tanımlı', () => {
    const items = WHATS_NEW['2.0.0-demo.3'] ?? [];
    expect(items.length).toBeGreaterThanOrEqual(6);
    expect(items.length).toBeLessThanOrEqual(8);
    for (const item of items) expect(hasMessage(item.key), item.key).toBe(true);
  });

  it('metinlerde uzun tire yok, hitap "siz"', () => {
    for (const [key, value] of Object.entries(tr)) {
      expect(value, key).not.toContain('—');
      expect(value, key).not.toMatch(/\b(sen|senin|sana)\b/i);
    }
  });
});
