import { describe, expect, it } from 'vitest';
import jarvis, { decideMode, isHudOpen, setHudOpen } from './index';

describe('jarvis_mode aracı (karar mantığı)', () => {
  const never = { at: 0, on: null as boolean | null };

  it('kapalıyken aç: olay gider; açıkken kapat: olay gider', () => {
    expect(decideMode(true, false, 10_000, never)).toEqual({ emit: true, text: 'Jarvis modu açıldı.' });
    expect(decideMode(false, true, 10_000, never)).toEqual({ emit: true, text: 'Jarvis modu kapatıldı.' });
  });

  it('zaten açıkken aç / zaten kapalıyken kapat: olay gitmez', () => {
    expect(decideMode(true, true, 10_000, never)).toEqual({ emit: false, text: 'Jarvis modu zaten açık.' });
    expect(decideMode(false, false, 10_000, never)).toEqual({ emit: false, text: 'Jarvis modu zaten kapalı.' });
  });

  it('aynı istek 1,5 sn içinde yinelenirse (çift söz, yankı) yok sayılır', () => {
    expect(decideMode(true, false, 10_500, { at: 10_000, on: true }).emit).toBe(false);
    expect(decideMode(true, false, 12_000, { at: 10_000, on: true }).emit).toBe(true);
    // Ters yöndeki istek hemen kabul edilir.
    expect(decideMode(false, true, 10_200, { at: 10_000, on: true }).emit).toBe(true);
  });

  it('HUD durumu ana süreçte izlenir', () => {
    setHudOpen(true);
    expect(isHudOpen()).toBe(true);
    setHudOpen(false);
    expect(isHudOpen()).toBe(false);
  });

  it('modül rayda sayfa istemez ve aracı ayar kümesinde sunar', () => {
    expect(jarvis.page).toBeUndefined();
    const tool = jarvis.tools?.find((def) => def.name === 'jarvis_mode');
    expect(tool?.group).toBe('settings');
    expect(tool?.risk).toBe('read');
    expect(tool?.description).toContain('Jarvis moduna geç');
    expect(tool?.description).toContain('Jarvis modundan çık');
    expect(tool?.description).toContain('enter/exit Jarvis mode');
  });
});
