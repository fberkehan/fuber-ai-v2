import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, type IsoDateTime } from '@fuber/shared';
import { createDeviceStore } from './device-state';
import { buildTtsSettings, describeTts, ELEVENLABS_DEFAULT_MODEL, ELEVENLABS_DEFAULT_VOICE, fallbackMessage, resolveTtsSelection, shouldNotifyFallback, voiceFor } from './tts-settings';
import { wakeVariants } from './wake-variants';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber2-cihaz-'));
});

afterEach(async () => {
  await fs.promises.rm(dir, { recursive: true, force: true });
});

const at = '2026-11-17T03:00:00.000Z' as IsoDateTime;

describe('cihaza özgü ses ayarları', () => {
  it('boş başlar; kalibrasyon ve yankı sonucu kalıcıdır, biri diğerini silmez', () => {
    const store = createDeviceStore(dir);
    expect(store.get()).toEqual({ wake: null, echo: null, ttsQuotaNoticeMonth: null });
    store.update({ wake: { threshold: 0.2, learned: ['garvis'], samples: [{ score: 0.25, transcript: 'Hey Garvis', paths: ['kws', 'whisper'], durationMs: 800 }], at } });
    store.update({
      echo: { leaked: true, vadTriggers: 2, wakeTriggers: 0, baselineRms: 0.001, playbackRms: 0.08, playbackPeak: 0.2, playedMs: 6000, at },
    });
    const reopened = createDeviceStore(dir).get();
    expect(reopened.wake?.threshold).toBe(0.2);
    expect(reopened.wake?.learned).toEqual(['garvis']);
    expect(reopened.echo?.leaked).toBe(true);
    store.update({ ttsQuotaNoticeMonth: '2026-11' });
    expect(createDeviceStore(dir).get()).toMatchObject({ ttsQuotaNoticeMonth: '2026-11', echo: { leaked: true } });
    expect(fs.existsSync(path.join(dir, 'voice-device.json.tmp'))).toBe(false);
  });

  it('bozuk dosyada varsayılanlarla açılır ve hatayı bildirir; sonraki yazma dosyayı onarır', () => {
    fs.writeFileSync(path.join(dir, 'voice-device.json'), '{ bozuk');
    const errors: string[] = [];
    const store = createDeviceStore(dir, (message) => errors.push(message));
    expect(store.get()).toEqual({ wake: null, echo: null, ttsQuotaNoticeMonth: null });
    expect(errors).toHaveLength(1);
    store.update({ echo: null });
    expect(createDeviceStore(dir).get()).toEqual({ wake: null, echo: null, ttsQuotaNoticeMonth: null });
  });
});

describe('sezici için ek yazımlar', () => {
  it('"hey jarvis" için Türkçe "ç" söyleyişinin İngilizce yazımını üretir', () => {
    expect(wakeVariants(['hey jarvis'])).toEqual([{ spelling: 'hey charvis', phrase: 'hey jarvis' }]);
  });

  it('kural uymayan ya da modelin yazamayacağı sözde ek yazım üretmez; yinelenen yazım vermez', () => {
    expect(wakeVariants(['selam fuber'])).toEqual([]);
    expect(wakeVariants(['hey çağrı'])).toEqual([]);
    expect(wakeVariants(['hey jarvis', 'hey charvis'])).toEqual([]);
    expect(wakeVariants(['jarvis', 'hey jarvis']).map((item) => item.spelling)).toEqual(['charvis', 'hey charvis']);
  });
});

describe('seslendirme ayarı', () => {
  const policy = (patch: (value: typeof DEFAULT_POLICY) => void) => {
    const value = structuredClone(DEFAULT_POLICY);
    patch(value);
    return value;
  };

  const cloudPolicy = (keys: Record<string, string> = {}) =>
    policy((value) => {
      value.voice.tts = { provider: 'elevenlabs', voiceId: 'onwK4e9ZLuTAKqWW03F9', model: 'eleven_flash_v2_5' };
      value.keys = keys;
    });
  const host = { engine: 'supertonic', voice: 'M4', device: 'cuda', sampleRate: 44_100 } as const;

  it('varsayılan politika yerel ekran kartı sesidir (Supertonic 3 / M4); cihaz seçimi yoksa politika geçerlidir', () => {
    expect(DEFAULT_POLICY.voice.tts).toEqual({ provider: 'supertonic', voiceId: 'M4' });
    expect(resolveTtsSelection(DEFAULT_POLICY, null)).toEqual({ engine: 'supertonic', voice: 'M4', source: 'policy' });
    expect(resolveTtsSelection(DEFAULT_POLICY, { ttsEngine: null, ttsVoices: {} })).toEqual({ engine: 'supertonic', voice: 'M4', source: 'policy' });
    // Konak hazır değilken işçiye konak verilmez (cümleler Piper ile okunur); hazır olunca yüklü motoruyla verilir.
    expect(buildTtsSettings(DEFAULT_POLICY, null, null)).toEqual({ engine: 'supertonic', language: 'tr', host: null, elevenlabs: null });
    expect(buildTtsSettings(DEFAULT_POLICY, null, host)).toEqual({ engine: 'supertonic', language: 'tr', host, elevenlabs: null });
    expect(describeTts(DEFAULT_POLICY, null)).toEqual({ provider: 'supertonic', source: 'policy', voice: 'M4', voiceId: null, model: null, hasKey: false });
  });

  it('cihaz seçimi politikanın önündedir; ses cihazdan, yoksa politikadan, yoksa motorun varsayılanından gelir', () => {
    const device = { ttsEngine: 'ema-lightning', ttsVoices: {} } as const;
    expect(resolveTtsSelection(DEFAULT_POLICY, device)).toEqual({ engine: 'ema-lightning', voice: 'ema', source: 'device' });
    expect(resolveTtsSelection(DEFAULT_POLICY, { ttsEngine: 'supertonic', ttsVoices: { supertonic: 'F2' } })).toEqual({ engine: 'supertonic', voice: 'F2', source: 'device' });
    // Cihazda yalnız ses seçilmiş (motor Yönetim'in varsayılanı): ses yine cihazdan.
    expect(resolveTtsSelection(DEFAULT_POLICY, { ttsEngine: null, ttsVoices: { supertonic: 'M5' } })).toEqual({ engine: 'supertonic', voice: 'M5', source: 'policy' });
    // Politika başka bir Supertonic sesi gösteriyorsa cihaz seçimi olmayan cihaz onu kullanır.
    const m2 = policy((value) => void (value.voice.tts = { provider: 'supertonic', voiceId: 'M2' }));
    expect(resolveTtsSelection(m2, null).voice).toBe('M2');
    // Listede olmayan ses kimliği (eski kayıt, elle bozulmuş ayar) motorun varsayılanına düşer; bilinmeyen motor politikaya.
    expect(voiceFor('supertonic', DEFAULT_POLICY, { ttsEngine: null, ttsVoices: { supertonic: '../../x' } })).toBe('M4');
    expect(resolveTtsSelection(DEFAULT_POLICY, { ttsEngine: 'bilinmeyen' as never, ttsVoices: {} })).toMatchObject({ engine: 'supertonic', source: 'policy' });
    // Piper seçiliyken konak hazır olsa da işçiye verilmez.
    expect(buildTtsSettings(DEFAULT_POLICY, { ttsEngine: 'piper-local', ttsVoices: {} }, host)).toMatchObject({ engine: 'piper-local', host: null });
  });

  it('bulut seçiliyken anahtar yoksa işçi buluttan haberdar edilmez; anahtar varsa bulut ayarı verilir', () => {
    // Anahtar yok: geri düşme olayı ve bildirim doğmaz; konak hazırsa yerel yedek odur.
    expect(buildTtsSettings(cloudPolicy(), null, null)).toEqual({ engine: 'elevenlabs', language: 'tr', host: null, elevenlabs: null });
    expect(buildTtsSettings(cloudPolicy({ elevenlabs: '   ' }), null, host)).toEqual({ engine: 'elevenlabs', language: 'tr', host, elevenlabs: null });
    // Tanı yine de neyin istendiğini ve anahtarın olmadığını söyler.
    expect(describeTts(cloudPolicy(), null)).toEqual({ provider: 'elevenlabs', source: 'policy', voice: 'onwK4e9ZLuTAKqWW03F9', voiceId: 'onwK4e9ZLuTAKqWW03F9', model: 'eleven_flash_v2_5', hasKey: false });
    const withKey = buildTtsSettings(cloudPolicy({ elevenlabs: 'anahtar' }), null, null);
    expect(withKey).toMatchObject({ engine: 'elevenlabs', elevenlabs: { apiKey: 'anahtar', voiceId: 'onwK4e9ZLuTAKqWW03F9', model: 'eleven_flash_v2_5' } });
    // Yerel ses seçiliyken de anahtar varsa bulut ayarı işçide durur ("Dinle" bulut sesini çalabilsin); cümleler yine yerel sesle okunur.
    const localWithKey = buildTtsSettings(policy((value) => void (value.keys = { elevenlabs: 'anahtar' })), null, host);
    expect(localWithKey).toMatchObject({ engine: 'supertonic', host, elevenlabs: { apiKey: 'anahtar', voiceId: ELEVENLABS_DEFAULT_VOICE, model: ELEVENLABS_DEFAULT_MODEL } });
    // Cihaz bulutu seçti, politika yerel: bulut sesi varsayılan ses ve modelle.
    expect(resolveTtsSelection(policy((value) => void (value.keys = { elevenlabs: 'anahtar' })), { ttsEngine: 'elevenlabs', ttsVoices: {} })).toEqual({ engine: 'elevenlabs', voice: ELEVENLABS_DEFAULT_VOICE, source: 'device' });
  });

  it('politika Piper derse anahtar olsa da Piper', () => {
    const local = policy((value) => {
      value.voice.tts = { provider: 'piper-local' };
      value.keys = { elevenlabs: 'anahtar' };
    });
    expect(buildTtsSettings(local, null, host)).toMatchObject({ engine: 'piper-local', language: 'tr', host: null });
    expect(describeTts(local, null)).toEqual({ provider: 'piper-local', source: 'policy', voice: 'dfki', voiceId: null, model: null, hasKey: true });
  });

  it('ElevenLabs: ses ve model politikadan, yoksa Daniel + flash; dil kişilikten', () => {
    const bare = buildTtsSettings(
      policy((value) => {
        value.voice.tts = { provider: 'elevenlabs' };
        value.keys = { elevenlabs: 'k' };
      }),
      null,
      null,
    );
    expect(bare.elevenlabs).toMatchObject({
      apiKey: 'k',
      voiceId: ELEVENLABS_DEFAULT_VOICE,
      model: ELEVENLABS_DEFAULT_MODEL,
      languageCode: 'tr',
      baseUrl: 'https://api.elevenlabs.io',
      firstChunkTimeoutMs: 1500,
      charBudget: null,
    });
    const customPolicy = policy((value) => {
      value.voice.tts = { provider: 'elevenlabs', voiceId: ' ses-x ', model: 'eleven_v3' };
      value.keys = { elevenlabs: ' anahtar ' };
    });
    const custom = buildTtsSettings(customPolicy, null, null, { elevenLabsCharBudget: 50 });
    expect(custom.elevenlabs).toMatchObject({ apiKey: 'anahtar', voiceId: 'ses-x', model: 'eleven_v3', charBudget: 50 });
    // Tanı özeti anahtarı taşımaz.
    expect(JSON.stringify(describeTts(customPolicy, null))).not.toContain('anahtar');
    expect(describeTts(customPolicy, null)).toEqual({ provider: 'elevenlabs', source: 'policy', voice: 'ses-x', voiceId: 'ses-x', model: 'eleven_v3', hasKey: true });
  });

  it('geri düşme bildirimi: anahtar yokluğu hiç, aynı neden bir kez, kota ayda bir kez', () => {
    const fresh = { lastNotified: null, quotaNoticeMonth: null, month: '2026-11' } as const;
    expect(shouldNotifyFallback('no_key', fresh)).toBe(false);
    expect(shouldNotifyFallback('network', fresh)).toBe(true);
    expect(shouldNotifyFallback('network', { ...fresh, lastNotified: 'network' })).toBe(false);
    expect(shouldNotifyFallback('timeout', { ...fresh, lastNotified: 'network' })).toBe(true);
    expect(shouldNotifyFallback('quota', fresh)).toBe(true);
    // Uygulama yeniden başladı (son bildirim belleği boş) ama bu ay zaten söylendi: yinelenmez.
    expect(shouldNotifyFallback('quota', { ...fresh, quotaNoticeMonth: '2026-11' })).toBe(false);
    expect(shouldNotifyFallback('quota', { ...fresh, quotaNoticeMonth: '2026-10' })).toBe(true);
    expect(fallbackMessage('quota')).toBe('Bulut sesinin kotası doldu; yerel sesle devam ediyorum.');
  });

  it('her geri düşme nedeninin Türkçe açıklaması vardır', () => {
    for (const reason of ['no_key', 'unauthorized', 'payment', 'rate_limit', 'quota', 'network', 'timeout', 'interrupted', 'server', 'budget'] as const) {
      const message = fallbackMessage(reason);
      expect(message.length, reason).toBeGreaterThan(15);
      expect(message, reason).not.toContain('voice.tts.');
    }
  });
});
