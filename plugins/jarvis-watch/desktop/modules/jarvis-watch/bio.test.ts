import { describe, expect, it } from 'vitest';
import { BIO_LIVE_MS, BIO_OFF_MS, BioTracker, stressFromIbi } from './bio';

describe('bio (saat): örnek tabanlı, bağlantıya bağlı değil', () => {
  it('veri yokken off; sahte sayı yok', () => {
    const bio = new BioTracker(() => 1_000_000);
    expect(bio.snapshot()).toMatchObject({ status: 'off', source: 'none', hr: null, reason: 'disconnected' });
  });

  it('son gerçek örnek ≤ 20 dk: CANLI (bağlantı koptuysa bile); 20 dk–2 sa: bayat; 2 sa+: off', () => {
    let t = 10_000_000;
    const bio = new BioTracker(() => t);
    bio.setConnected(true);
    bio.onStatus({ worn: true, battery: 64, measuring: true });
    bio.onSample({ ts: t, hr: 72 });
    expect(bio.snapshot()).toMatchObject({ status: 'live', hr: 72, battery: 64, worn: true });
    bio.setConnected(false);
    t += BIO_LIVE_MS - 1000;
    expect(bio.snapshot().status).toBe('live');
    t += 2000;
    expect(bio.snapshot().status).toBe('stale');
    t += BIO_OFF_MS;
    expect(bio.snapshot()).toMatchObject({ status: 'off', hr: null, reason: 'noData' });
  });

  it('geç gelen eski örnek en son örneği geri almaz; geçersiz nabız yok sayılır', () => {
    let t = 10_000_000;
    const bio = new BioTracker(() => t);
    bio.onSample({ ts: t, hr: 80 });
    bio.onSample({ ts: t - 600_000, hr: 55 });
    bio.onSample({ ts: t, hr: 900 });
    expect(bio.snapshot().lastSampleAgoSec).toBe(0);
    expect(bio.last()?.hr).toBe(80);
  });

  it('IBI’den RMSSD tabanlı gerginlik; az veri null', () => {
    expect(stressFromIbi([800, 810])).toBeNull();
    const calm = stressFromIbi([800, 900, 780, 920, 790, 910, 800]);
    const tense = stressFromIbi([800, 802, 801, 803, 800, 802, 801]);
    expect(calm).not.toBeNull();
    expect(tense!).toBeGreaterThan(calm!);
  });
});
