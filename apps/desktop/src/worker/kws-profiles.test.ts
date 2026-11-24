import { describe, expect, it } from 'vitest';
import { chooseKwsProfile, DEFAULT_KWS_PROFILE, KWS_PROFILES, kwsProfile, tuningForCalibration } from './kws-profiles';

describe('sezici duyarlık profilleri', () => {
  it('profiller az duyarlıdan çok duyarlıya sıralıdır ve hepsi sekiz yol izler (v1 dersi)', () => {
    expect(KWS_PROFILES.map((profile) => profile.id)).toEqual(['standard', 'sensitive']);
    for (let i = 1; i < KWS_PROFILES.length; i++) {
      expect(KWS_PROFILES[i]?.threshold).toBeLessThan(KWS_PROFILES[i - 1]?.threshold ?? 0);
    }
    expect(KWS_PROFILES.every((profile) => profile.paths === 8)).toBe(true);
    expect(kwsProfile('sensitive')?.threshold).toBe(0.1);
    expect(kwsProfile('yok')).toBeNull();
  });

  it('örneklerin üçte ikisini yakalayan en az duyarlı profili seçer', () => {
    expect(chooseKwsProfile([['standard', 'sensitive'], ['standard', 'sensitive'], ['sensitive']])).toMatchObject({
      profile: { id: 'standard' },
      caught: 2,
    });
    expect(chooseKwsProfile([['standard', 'sensitive'], ['sensitive'], ['sensitive']])).toMatchObject({ profile: { id: 'sensitive' }, caught: 3 });
  });

  it('hiçbir profil yeterince yakalamıyorsa en çok yakalayanı, eşitlikte daha duyarlıyı seçer', () => {
    // Örnek alıştırma: sezici üç örnekten yalnız birini yakaladı, ikisini Whisper yolu.
    expect(chooseKwsProfile([['standard', 'sensitive'], [], []])).toMatchObject({ profile: { id: 'sensitive' }, caught: 1 });
    expect(chooseKwsProfile([[], [], []])).toMatchObject({ profile: { id: 'sensitive' }, caught: 0 });
    expect(chooseKwsProfile([])).toMatchObject({ caught: 0 });
  });

  it('kayıtlı kalibrasyondan yürürlükteki duyarlık', () => {
    expect(tuningForCalibration(null)).toBe(DEFAULT_KWS_PROFILE);
    expect(tuningForCalibration({ profile: 'sensitive', samples: [] }).id).toBe('sensitive');
    expect(tuningForCalibration({ profile: 'bilinmeyen', samples: [] }).id).toBe('standard');
  });

  it('profil alanı olmayan eski kalibrasyonda örneklerden çıkarır (kayıtlı örnek alıştırma: 1/3 sezici)', () => {
    const sample = {
      samples: [{ paths: ['kws', 'whisper'] }, { paths: ['whisper'] }, { paths: ['whisper'] }],
    };
    expect(tuningForCalibration(sample).id).toBe('sensitive');
    expect(tuningForCalibration({ samples: [{ paths: ['kws'] }, { paths: ['kws', 'whisper'] }, { paths: ['whisper'] }] }).id).toBe('standard');
  });
});
