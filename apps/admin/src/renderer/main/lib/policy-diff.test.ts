import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, type Policy } from '@fuber/shared';
import { buildPatch, changedPaths, rebase, setIn, ttsEngineEdits } from './policy-diff';

const withVoice: Policy = {
  ...DEFAULT_POLICY,
  revision: 3,
  voice: { ...DEFAULT_POLICY.voice, tts: { provider: 'elevenlabs', voiceId: 'libVoice123', model: 'eleven_v3' } },
};

describe('politika farkı', () => {
  it('isteğe bağlı alanı varsayılana döndürmek: alan taslaktan silinir, yamada null gider', () => {
    let draft = setIn(withVoice, ['voice', 'tts', 'voiceId'], undefined);
    draft = setIn(draft, ['voice', 'tts', 'model'], undefined);
    expect('voiceId' in draft.voice.tts).toBe(false);
    const paths = changedPaths(withVoice, draft);
    expect(paths).toEqual(expect.arrayContaining([['voice', 'tts', 'voiceId'], ['voice', 'tts', 'model']]));
    expect(buildPatch(draft, paths)).toEqual({ voice: { tts: { voiceId: null, model: null } } });
  });

  it('yeniden kurmada kaldırılan alan geri gelmez', () => {
    const draft = setIn(withVoice, ['voice', 'tts', 'voiceId'], undefined);
    const next = { ...withVoice, revision: 4, persona: { ...withVoice.persona, name: 'Friday' } };
    const rebased = rebase(next, draft, changedPaths(withVoice, draft));
    expect('voiceId' in rebased.voice.tts).toBe(false);
    expect(rebased.persona.name).toBe('Friday');
  });

  it('yerel beyin alanları farka girer', () => {
    const draft = setIn(withVoice, ['brain', 'localFallback'], 'off');
    expect(changedPaths(withVoice, draft)).toEqual([['brain', 'localFallback']]);
    expect(buildPatch(draft, [['brain', 'localFallback']])).toEqual({ brain: { localFallback: 'off' } });
  });

  it('effort: null değerdir (modelin varsayılanı), alan silinmez', () => {
    const draft = setIn(withVoice, ['models', 'voice', 'effort'], null);
    expect(draft.models.voice.effort).toBeNull();
    expect(buildPatch(draft, changedPaths(withVoice, draft))).toEqual({ models: { voice: { effort: null } } });
  });
});

describe('ses motoru değişimi', () => {
  const apply = (base: Policy, edits: Array<[string[], unknown]>): Policy => edits.reduce((acc, [path, value]) => setIn(acc, path, value), base);

  it('ElevenLabs → Supertonic: ses kimliği M4 olur, model kalkar', () => {
    const draft = apply(withVoice, ttsEngineEdits('supertonic'));
    expect(draft.voice.tts).toEqual({ provider: 'supertonic', voiceId: 'M4' });
    expect(buildPatch(draft, changedPaths(withVoice, draft))).toEqual({ voice: { tts: { provider: 'supertonic', voiceId: 'M4', model: null } } });
  });

  it('Supertonic seçilen sesle gelir', () => {
    expect(apply(withVoice, ttsEngineEdits('supertonic', 'F2')).voice.tts.voiceId).toBe('F2');
  });

  it('Supertonic → ElevenLabs ve Piper: M4 kalmaz', () => {
    const supertonic = apply(withVoice, ttsEngineEdits('supertonic', 'M5'));
    for (const engine of ['elevenlabs', 'piper-local', 'ema-lightning'] as const) {
      const draft = apply(supertonic, ttsEngineEdits(engine));
      expect(draft.voice.tts).toEqual({ provider: engine });
      expect(buildPatch(draft, changedPaths(supertonic, draft))).toEqual({ voice: { tts: { provider: engine, voiceId: null } } });
    }
  });
});
