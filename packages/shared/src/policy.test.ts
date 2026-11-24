import { describe, expect, it } from 'vitest';
import { BUILTIN_MODULE_IDS } from './constants';
import { DEFAULT_LOCAL_MODELS } from './local-models';
import {
  compareVersions,
  DEFAULT_POLICY,
  isUpdateRequired,
  mergePolicy,
  parsePolicy,
  POLICY_SCHEMA_VERSION,
  PolicySchema,
  upgradePolicyDocument,
  redactPolicy,
  clientUnderstandsPolicyV2,
  DEFAULT_ELEVENLABS_MODEL,
  DEFAULT_ELEVENLABS_VOICE_ID,
  policyForLegacyClient,
  POLICY_V2_MIN_APP_VERSION,
  type Policy,
  type PolicyPatch,
} from './policy';

describe('DEFAULT_POLICY', () => {
  it('şemaya uyar', () => {
    expect(PolicySchema.safeParse(DEFAULT_POLICY).success).toBe(true);
  });

  it('KURGU varsayılanlarını taşır', () => {
    expect(DEFAULT_POLICY.persona.name).toBe('Jarvis');
    expect(DEFAULT_POLICY.persona.wakePhrases).toEqual(['hey jarvis']);
    expect(DEFAULT_POLICY.persona.address).toBe('efendim');
    expect(DEFAULT_POLICY.models.deep.model).toBe('claude-opus-5-5');
    expect(DEFAULT_POLICY.voice.followUpSeconds).toBe(12);
    expect(DEFAULT_POLICY.limits.dailyBudgetUsd).toBe(10);
    expect(DEFAULT_POLICY.killSwitch.active).toBe(false);
    expect(Object.keys(DEFAULT_POLICY.modules).sort()).toEqual([...BUILTIN_MODULE_IDS].sort());
    expect(DEFAULT_POLICY.modules.ambient?.enabled).toBe(false);
    expect(DEFAULT_POLICY.modules.planner?.enabled).toBe(true);
    expect(DEFAULT_POLICY.ambient.allowed).toBe(false);
    // demo.2 G3: v1 içe aktarıcısı varsayılan açık (yalnız kullanıcı Ayarlar'dan başlatınca çalışır).
    expect(DEFAULT_POLICY.modules['import-v1']?.enabled).toBe(true);
  });

  it('gecikme bütçesi için ses rolü: Haiku, düşünme kapalı, efor düşük', () => {
    expect(DEFAULT_POLICY.models.voice).toEqual({
      provider: 'anthropic',
      model: 'claude-haiku-5-5',
      effort: 'low',
      thinking: 'off',
      speed: 'standard',
    });
    expect(DEFAULT_POLICY.models.deep.thinking).toBe('adaptive');
    expect(DEFAULT_POLICY.voice.bargeIn).toBe('voice');
    expect(DEFAULT_POLICY.voice.conversationMode).toBe(true);
  });

  it('yerel beyin: geri düşme açık, model kaydı ve bağlam sınırı tanımlı; sağlayıcı local olabilir', () => {
    expect(DEFAULT_POLICY.brain.localFallback).toBe('auto');
    expect(DEFAULT_POLICY.brain.local.contextTokens).toBeGreaterThanOrEqual(4096);
    expect(DEFAULT_POLICY.brain.local.modelId).toBeTruthy();
    const local = { ...DEFAULT_POLICY.models.voice, provider: 'local' as const };
    expect(PolicySchema.safeParse({ ...DEFAULT_POLICY, models: { ...DEFAULT_POLICY.models, voice: local } }).success).toBe(true);
  });

  it('derin beyin: varsayılan seçim kendiliğinden, Claude Code modeli sonnet; üç seçenek geçerli, bilinmeyen reddedilir', () => {
    expect(DEFAULT_POLICY.brain.deep).toEqual({ provider: 'auto', claudeCodeModel: 'sonnet' });
    for (const provider of ['auto', 'anthropic', 'claude-code'] as const) {
      expect(mergePolicy(DEFAULT_POLICY, { brain: { deep: { provider } } }).brain.deep.provider).toBe(provider);
    }
    expect(() => mergePolicy(DEFAULT_POLICY, { brain: { deep: { provider: 'openai' as never } } })).toThrow();
    // Yalnız sağlayıcıyı değiştiren yama modeli ve yerel beyin ayarlarını korur.
    const next = mergePolicy(DEFAULT_POLICY, { brain: { deep: { provider: 'claude-code' } } });
    expect(next.brain).toEqual({ ...DEFAULT_POLICY.brain, deep: { provider: 'claude-code', claudeCodeModel: 'sonnet' } });
  });

  it('derin beyin: eski belge (brain.deep yok, brain hiç yok) açılır ve varsayılanı alır', () => {
    const { deep: _deep, ...oldBrain } = DEFAULT_POLICY.brain;
    // demo.1'in yazdığı önbellek: `brain` var, `deep` yok.
    expect(parsePolicy({ ...DEFAULT_POLICY, revision: 4, brain: { ...oldBrain, localFallback: 'off' } })?.brain).toEqual({
      ...oldBrain,
      localFallback: 'off',
      deep: { provider: 'auto', claudeCodeModel: 'sonnet' },
    });
    // Daha eski belge: `brain` alanı hiç yok.
    const { brain: _brain, ...noBrain } = DEFAULT_POLICY;
    expect(parsePolicy({ ...noBrain, revision: 2 })?.brain).toEqual(DEFAULT_POLICY.brain);
    // Şema da tek başına aynı sonucu verir (kontrol servisinin veritabanındaki eski kayıt `parse` ile okunur).
    expect(PolicySchema.parse({ ...DEFAULT_POLICY, brain: oldBrain }).brain.deep).toEqual({ provider: 'auto', claudeCodeModel: 'sonnet' });
    expect(PolicySchema.parse({ ...noBrain }).brain.deep).toEqual({ provider: 'auto', claudeCodeModel: 'sonnet' });
    // Belgedeki seçim korunur; yarım `deep` (yalnız sağlayıcı) tamamlanır.
    expect(parsePolicy({ revision: 9, brain: { deep: { provider: 'claude-code' } } })?.brain.deep).toEqual({ provider: 'claude-code', claudeCodeModel: 'sonnet' });
    expect(parsePolicy({ revision: 9, brain: { deep: { provider: 'bilinmeyen' } } })).toBeNull();
  });

  it('ortam dinleme: eski belgede olmayan saklama süresi ve araya girme alanları varsayılanla açılır; izin kapalı kalır', () => {
    expect(DEFAULT_POLICY.ambient).toEqual({ allowed: false, maxInterjectionsPerHour: 3, minGapSeconds: 180, retentionDays: 7, interjections: 'cloud-only' });
    // demo.1'in yazdığı belge: `ambient` yalnız üç alan taşır.
    const oldAmbient = { allowed: true, maxInterjectionsPerHour: 2, minGapSeconds: 240 };
    expect(parsePolicy({ ...DEFAULT_POLICY, revision: 5, ambient: oldAmbient })?.ambient).toEqual({ ...oldAmbient, retentionDays: 7, interjections: 'cloud-only' });
    // Kontrol servisinin veritabanındaki eski kayıt doğrudan şemayla okunur.
    expect(PolicySchema.parse({ ...DEFAULT_POLICY, ambient: oldAmbient }).ambient).toEqual({ ...oldAmbient, retentionDays: 7, interjections: 'cloud-only' });
    // Yarım belge (yalnız sürüm) gömülü varsayılanla tamamlanır: izin KAPALI.
    expect(parsePolicy({ revision: 3 })?.ambient.allowed).toBe(false);
    // Sınır dışı değer belgeyi geçersiz kılar (sessizce kırpılmaz): 7 günden uzun saklama, tanınmayan kip.
    expect(parsePolicy({ ...DEFAULT_POLICY, ambient: { ...DEFAULT_POLICY.ambient, retentionDays: 30 } })).toBeNull();
    expect(parsePolicy({ ...DEFAULT_POLICY, ambient: { ...DEFAULT_POLICY.ambient, interjections: 'hep' } })).toBeNull();
    // Yama ile yalnız bir alan değişir.
    expect(mergePolicy(DEFAULT_POLICY, { ambient: { retentionDays: 3 } } as PolicyPatch).ambient).toEqual({ ...DEFAULT_POLICY.ambient, retentionDays: 3 });
  });

  it('geliştirici kipi: varsayılan KAPALI; eski belgede alan yoksa kapalı açılır, yama yalnız onu değiştirir', () => {
    expect(DEFAULT_POLICY.developer).toEqual({ enabled: false });
    const { developer: _developer, ...old } = DEFAULT_POLICY;
    expect(parsePolicy({ ...old, revision: 4 })?.developer).toEqual({ enabled: false });
    expect(PolicySchema.parse(old).developer).toEqual({ enabled: false });
    expect(parsePolicy({ ...DEFAULT_POLICY, revision: 4, developer: { enabled: true } })?.developer.enabled).toBe(true);
    expect(parsePolicy({ ...DEFAULT_POLICY, revision: 4, developer: { enabled: 'evet' } })).toBeNull();
    expect(mergePolicy(DEFAULT_POLICY, { developer: { enabled: true } } as PolicyPatch).developer).toEqual({ enabled: true });
    expect(DEFAULT_POLICY.modules.selfdev?.enabled).toBe(true);
  });

  it('kişilik istemi yalnız karakteri taşır; biçim ve dürüstlük kuralları beyindedir', () => {
    expect(DEFAULT_POLICY.persona.systemPrompt).toContain('{name}');
    expect(DEFAULT_POLICY.persona.systemPrompt).toContain('{address}');
    expect(DEFAULT_POLICY.persona.systemPrompt).not.toContain('Madde işareti');
  });

  it('yerel model listesi tek sabitten gelir', () => {
    expect(DEFAULT_POLICY.localModels).toBe(DEFAULT_LOCAL_MODELS);
  });
});

describe('eski belgelerle uyum', () => {
  it('yeni alanları olmayan politika varsayılanlarla açılır', () => {
    const parsed = PolicySchema.parse({
      ...DEFAULT_POLICY,
      models: {
        ...DEFAULT_POLICY.models,
        deep: { provider: 'anthropic', model: 'claude-opus-5-5', effort: 'high' },
      },
      voice: { engine: 'cascade', stt: { provider: 'whisper-local' }, tts: { provider: 'piper-local' }, followUpSeconds: 12, speakerVerification: 'off' },
    });
    expect(parsed.models.deep.thinking).toBe('adaptive');
    expect(parsed.models.deep.speed).toBe('standard');
    expect(parsed.voice.bargeIn).toBe('voice');
    expect(parsed.voice.conversationMode).toBe(true);
  });

  it('brain alanı olmayan eski önbellek varsayılanla açılır', () => {
    const { brain: _brain, ...old } = DEFAULT_POLICY;
    const parsed = PolicySchema.parse(old);
    expect(parsed.brain).toEqual(DEFAULT_POLICY.brain);
  });

  it('eski boolean bargeIn değerini reddeder', () => {
    expect(PolicySchema.safeParse({ ...DEFAULT_POLICY, voice: { ...DEFAULT_POLICY.voice, bargeIn: true } }).success).toBe(false);
  });
});

describe('mergePolicy: `null` ile alan kaldırma', () => {
  it('isteğe bağlı alan `null` ile kaldırılır; diğer alanlar yerinde kalır', () => {
    const base = mergePolicy(DEFAULT_POLICY, {
      voice: { tts: { provider: 'elevenlabs', voiceId: 'ses-x', model: 'eleven_v3' }, s2s: { model: 'm', voice: 'v' } },
      killSwitch: { active: true, message: 'Bakım var.' },
      release: { notes: 'Yenilikler', downloadUrl: 'https://ornek.test/kur.exe' },
      modules: { planner: { enabled: true, config: { a: 1 } } },
    });
    const patch: PolicyPatch = {
      voice: { tts: { voiceId: null }, s2s: null },
      killSwitch: { message: null },
      release: { notes: null },
      modules: { planner: { config: null } },
    };
    const merged = mergePolicy(base, patch);
    expect(merged.voice.tts).toEqual({ provider: 'elevenlabs', model: 'eleven_v3' });
    expect('voiceId' in merged.voice.tts).toBe(false);
    expect(merged.voice.s2s).toBeUndefined();
    expect(merged.killSwitch).toEqual({ active: true });
    expect(merged.release.notes).toBeUndefined();
    expect(merged.release.downloadUrl).toBe('https://ornek.test/kur.exe');
    expect(merged.modules.planner).toEqual({ enabled: true });
  });

  it('`null`ı değer olarak kabul eden alanda (efor) değer yazılır, alan silinmez', () => {
    const merged = mergePolicy(DEFAULT_POLICY, { models: { voice: { effort: null } } });
    expect(merged.models.voice.effort).toBeNull();
    expect(merged.models.voice.model).toBe(DEFAULT_POLICY.models.voice.model);
  });

  it('zorunlu alan `null` ile kaldırılamaz: şema reddeder', () => {
    expect(() => mergePolicy(DEFAULT_POLICY, { persona: { name: null as never } })).toThrow();
    expect(() => mergePolicy(DEFAULT_POLICY, { voice: { tts: null as never } })).toThrow();
  });

  it('olmayan isteğe bağlı alanı kaldırmak zararsızdır; anahtar da `null` ile kaldırılır', () => {
    expect(mergePolicy(DEFAULT_POLICY, { killSwitch: { message: null } }).killSwitch).toEqual({ active: false });
    const withKey = mergePolicy(DEFAULT_POLICY, { keys: { elevenlabs: 'k', anthropic: 'a' } });
    expect(mergePolicy(withKey, { keys: { elevenlabs: null } }).keys).toEqual({ anthropic: 'a' });
  });
});

describe('mergePolicy', () => {
  it('nesneleri alan alan birleştirir, diğer alanlara dokunmaz', () => {
    const merged = mergePolicy(DEFAULT_POLICY, {
      persona: { name: 'Friday' },
      modules: { ambient: { enabled: true } },
    });
    expect(merged.persona.name).toBe('Friday');
    expect(merged.persona.address).toBe('efendim');
    expect(merged.modules.ambient?.enabled).toBe(true);
    expect(merged.modules.planner?.enabled).toBe(true);
    expect(DEFAULT_POLICY.persona.name).toBe('Jarvis');
  });

  it('dizileri bütün olarak değiştirir', () => {
    const merged = mergePolicy(DEFAULT_POLICY, { persona: { wakePhrases: ['hey friday', 'friday'] } });
    expect(merged.persona.wakePhrases).toEqual(['hey friday', 'friday']);
  });

  it('geçersiz sonucu reddeder', () => {
    expect(() => mergePolicy(DEFAULT_POLICY, { voice: { engine: 'telepati' as never } })).toThrow();
  });
});

describe('parsePolicy', () => {
  it('eksik alanları varsayılandan tamamlar', () => {
    const parsed = parsePolicy({ revision: 7, persona: { name: 'Friday' } });
    expect(parsed?.revision).toBe(7);
    expect(parsed?.persona.name).toBe('Friday');
    expect(parsed?.voice.engine).toBe('cascade');
  });

  it('belgenin kendi voice.tts alanı bütün olarak geçerlidir: silinmiş ses kimliği varsayılandan geri dolmaz', () => {
    const current = { schemaVersion: POLICY_SCHEMA_VERSION, revision: 3 };
    expect(parsePolicy({ ...current, voice: { tts: { provider: 'elevenlabs' } } })?.voice.tts).toEqual({ provider: 'elevenlabs' });
    expect(parsePolicy({ ...current, voice: { tts: { provider: 'supertonic' } } })?.voice.tts).toEqual({ provider: 'supertonic' });
    expect(parsePolicy({ revision: 3, voice: { tts: { provider: 'piper-local' } } })?.voice.tts).toEqual({ provider: 'piper-local' });
    // tts hiç yoksa varsayılan (yerel ekran kartı sesi, kimliğiyle) gelir.
    expect(parsePolicy({ revision: 3, voice: { followUpSeconds: 8 } })?.voice.tts).toEqual(DEFAULT_POLICY.voice.tts);
    expect(DEFAULT_POLICY.voice.tts).toEqual({ provider: 'supertonic', voiceId: 'M4' });
  });

  it('bilinmeyen seslendirme motorunu reddeder; dört motor geçerlidir', () => {
    for (const provider of ['supertonic', 'ema-lightning', 'piper-local', 'elevenlabs'] as const) {
      expect(mergePolicy(DEFAULT_POLICY, { voice: { tts: { provider } } }).voice.tts.provider).toBe(provider);
    }
    expect(PolicySchema.safeParse({ ...DEFAULT_POLICY, voice: { ...DEFAULT_POLICY.voice, tts: { provider: 'kokoro' } } }).success).toBe(false);
  });

  describe('biçim sürümü 1 → 2: yerel ekran kartı sesi', () => {
  // demo.1 / demo.2 Yönetim'inin yazdığı belge: sürüm alanı yok, ses ElevenLabs Daniel, listede yerel ses modelleri yok.
  const OLD_MODELS = DEFAULT_LOCAL_MODELS.filter((model) => !/^(supertonic|ema-lightning|onnxruntime)/.test(model.id));
  const oldDocument = (tts: Record<string, unknown>): Record<string, unknown> => {
    const { schemaVersion: _version, ...rest } = DEFAULT_POLICY;
    return { ...rest, revision: 12, voice: { ...DEFAULT_POLICY.voice, tts }, localModels: OLD_MODELS };
  };
  const OLD_DEFAULT = { provider: 'elevenlabs', voiceId: 'onwK4e9ZLuTAKqWW03F9', model: 'eleven_flash_v2_5' };

  it('yeni belge sürümünü taşır; eski belge sürüm 1 sayılır', () => {
    expect(DEFAULT_POLICY.schemaVersion).toBe(POLICY_SCHEMA_VERSION);
    expect(OLD_MODELS.length).toBe(DEFAULT_LOCAL_MODELS.length - 4);
    expect(parsePolicy(oldDocument(OLD_DEFAULT))?.schemaVersion).toBe(POLICY_SCHEMA_VERSION);
  });

  it('eski varsayılan bulut sesi (Daniel + flash, ya da boş bırakılmış) yerel sese çevrilir', () => {
    for (const tts of [OLD_DEFAULT, { provider: 'elevenlabs' }, { provider: 'elevenlabs', voiceId: 'onwK4e9ZLuTAKqWW03F9' }, { provider: 'elevenlabs', model: 'eleven_flash_v2_5' }]) {
      const parsed = parsePolicy(oldDocument(tts));
      expect(parsed?.voice.tts, JSON.stringify(tts)).toEqual({ provider: 'supertonic', voiceId: 'M4' });
      expect(parsed?.revision).toBe(12);
    }
  });

  it('bilerek yapılmış seçim korunur: başka bir ElevenLabs sesi ya da modeli, Piper', () => {
    const chosen = { provider: 'elevenlabs', voiceId: 'TX3LPaxmHKxFdv7VOQHJ', model: 'eleven_v3' };
    expect(parsePolicy(oldDocument(chosen))?.voice.tts).toEqual(chosen);
    expect(parsePolicy(oldDocument({ provider: 'elevenlabs', model: 'eleven_v3' }))?.voice.tts).toEqual({ provider: 'elevenlabs', model: 'eleven_v3' });
    expect(parsePolicy(oldDocument({ provider: 'piper-local' }))?.voice.tts).toEqual({ provider: 'piper-local' });
  });

  it('güncel belgede ElevenLabs Daniel bilerek seçilmiştir: dokunulmaz', () => {
    const current = { ...oldDocument(OLD_DEFAULT), schemaVersion: POLICY_SCHEMA_VERSION };
    expect(parsePolicy(current)?.voice.tts).toEqual(OLD_DEFAULT);
    expect(upgradePolicyDocument(current)).toBe(current);
  });

  it('yerel ses modelleri eski listeye eklenir; var olan kayda ve sıraya dokunulmaz, ikinci kez eklenmez', () => {
    const parsed = parsePolicy(oldDocument(OLD_DEFAULT));
    const ids = parsed?.localModels.map((model) => model.id) ?? [];
    expect(ids.slice(0, OLD_MODELS.length)).toEqual(OLD_MODELS.map((model) => model.id));
    expect(ids.slice(OLD_MODELS.length).sort()).toEqual(['ema-lightning-onnx-1.0', 'onnxruntime-1.24.4-directml', 'onnxruntime-1.32.0-cuda13', 'supertonic-3-onnx']);
    // Yöneticinin listeye elle eklediği kayıt (isteğe bağlı büyük model) yerinde kalır.
    const extra = { id: 'ozel-model', role: 'llm', required: false, files: [] };
    const withExtra = parsePolicy({ ...oldDocument(OLD_DEFAULT), localModels: [...OLD_MODELS, extra] });
    expect(withExtra?.localModels.some((model) => model.id === 'ozel-model')).toBe(true);
    // Yükseltilmiş belge yeniden okunursa değişmez.
    const again = parsePolicy(JSON.parse(JSON.stringify(parsed)));
    expect(again?.localModels.map((model) => model.id)).toEqual(ids);
    expect(again?.voice.tts).toEqual(parsed?.voice.tts);
  });

  it('yerel ses kayıtları: Supertonic ve CUDA çalışma zamanı zorunlu, DirectML ve EMA isteğe bağlı; yollar tts/ altında', () => {
    const byId = new Map(DEFAULT_LOCAL_MODELS.map((model) => [model.id, model]));
    expect(byId.get('supertonic-3-onnx')?.required).toBe(true);
    expect(byId.get('onnxruntime-1.32.0-cuda13')?.required).toBe(true);
    expect(byId.get('onnxruntime-1.24.4-directml')?.required).toBe(false);
    expect(byId.get('ema-lightning-onnx-1.0')?.required).toBe(false);
    for (const id of ['supertonic-3-onnx', 'onnxruntime-1.32.0-cuda13', 'onnxruntime-1.24.4-directml', 'ema-lightning-onnx-1.0']) {
      const model = byId.get(id)!;
      expect(model.role, id).toBe('tts');
      for (const file of model.files) {
        expect(file.path.startsWith('tts/'), file.path).toBe(true);
        expect(file.url.startsWith('https://'), file.url).toBe(true);
        expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
      }
    }
    // On hazır sesin dosyaları listede.
    const voices = byId.get('supertonic-3-onnx')!.files.filter((file) => file.path.includes('/voice_styles/')).map((file) => file.path.split('/').pop());
    expect(voices.sort()).toEqual(['F1.json', 'F2.json', 'F3.json', 'F4.json', 'F5.json', 'M1.json', 'M2.json', 'M3.json', 'M4.json', 'M5.json']);
  });
  });

  it('bozuk belgede null döner', () => {
    expect(parsePolicy(null)).toBeNull();
    expect(parsePolicy('policy')).toBeNull();
    expect(parsePolicy({ revision: 'yedi' })).toBeNull();
  });
});

describe('redactPolicy', () => {
  it('anahtarları çıkarır, aslını değiştirmez', () => {
    const withKeys = mergePolicy(DEFAULT_POLICY, { keys: { anthropic: 'gizli-deger' } });
    const redacted = redactPolicy(withKeys);
    expect(redacted.keys).toEqual({});
    expect(JSON.stringify(redacted)).not.toContain('gizli-deger');
    expect(withKeys.keys.anthropic).toBe('gizli-deger');
  });
});

describe('compareVersions', () => {
  it('çekirdek sürümü karşılaştırır', () => {
    expect(compareVersions('2.0.0', '2.0.0')).toBe(0);
    expect(compareVersions('2.0.1', '2.0.0')).toBe(1);
    expect(compareVersions('2.0.9', '2.1.0')).toBe(-1);
    expect(compareVersions('v2.10.0', '2.9.0')).toBe(1);
  });

  it('ön sürümü eksizden küçük sayar ve sayısal sıralar', () => {
    expect(compareVersions('2.0.0-demo.1', '2.0.0')).toBe(-1);
    expect(compareVersions('2.0.0-demo.2', '2.0.0-demo.10')).toBe(-1);
    expect(compareVersions('2.0.0-demo.1', '2.0.0-demo.1')).toBe(0);
    expect(compareVersions('2.0.0-beta.1', '2.0.0-demo.1')).toBe(-1);
  });
});

describe('isUpdateRequired', () => {
  it('yalnız force açık ve sürüm eskiyse gerekir', () => {
    const forced = mergePolicy(DEFAULT_POLICY, { release: { minVersion: '2.1.0', force: true } });
    expect(isUpdateRequired(forced, '2.0.0-demo.1')).toBe(true);
    expect(isUpdateRequired(forced, '2.1.0')).toBe(false);
    const soft = mergePolicy(DEFAULT_POLICY, { release: { minVersion: '2.1.0', force: false } });
    expect(isUpdateRequired(soft, '2.0.0-demo.1')).toBe(false);
  });
});

describe('eski masaüstü için politika görünümü (kurulum sırası önemsiz)', () => {
  const KIMI = { provider: 'openai-compatible' as const, endpoint: 'openrouter', model: 'moonshotai/kimi-k2', effort: 'low' as const, thinking: 'off' as const, speed: 'standard' as const, price: { input: 0.5, output: 2 } };
  /** demo.2 masaüstünün şemasında geçerli değerler (o sürümün `PolicySchema`sından). */
  const DEMO2_TTS = ['piper-local', 'elevenlabs'];
  const DEMO2_MODEL_PROVIDERS = ['anthropic', 'local'];
  const view = (policy: Policy) => policyForLegacyClient(policy) as unknown as Policy & { schemaVersion?: number; providers?: unknown };

  it('hangi sürüm biçim sürümü 2’yi tanır', () => {
    expect(clientUnderstandsPolicyV2('2.0.0-demo.1')).toBe(false);
    expect(clientUnderstandsPolicyV2('2.0.0-demo.2')).toBe(false);
    expect(clientUnderstandsPolicyV2(POLICY_V2_MIN_APP_VERSION)).toBe(true);
    expect(clientUnderstandsPolicyV2('2.0.0-demo.10')).toBe(true);
    expect(clientUnderstandsPolicyV2('2.0.0')).toBe(true);
    // Sürüm okunamıyorsa belge kısılmaz.
    expect(clientUnderstandsPolicyV2('')).toBe(true);
    expect(clientUnderstandsPolicyV2(null)).toBe(true);
  });

  it('varsayılan politika: yalnız demo.2’nin bildiği değerler kalır; yükseltmenin tersidir', () => {
    const legacy = view(DEFAULT_POLICY);
    expect(DEMO2_TTS).toContain(legacy.voice.tts.provider);
    expect(legacy.voice.tts).toEqual({ provider: 'elevenlabs', voiceId: DEFAULT_ELEVENLABS_VOICE_ID, model: DEFAULT_ELEVENLABS_MODEL });
    expect(Object.values(legacy.models).every((ref) => DEMO2_MODEL_PROVIDERS.includes(ref!.provider))).toBe(true);
    expect(legacy.schemaVersion).toBeUndefined();
    expect(legacy.providers).toBeUndefined();
    expect(legacy.localModels.map((model) => model.id)).toEqual(DEFAULT_POLICY.localModels.map((model) => model.id).filter((id) => !/^(supertonic|ema-lightning|onnxruntime)/.test(id)));
    // Gidiş-dönüş: eski görünüm güncel masaüstünde yeniden yükseltilir ve aynı politikaya varır.
    const back = parsePolicy(JSON.parse(JSON.stringify(legacy)))!;
    expect(back.voice.tts).toEqual(DEFAULT_POLICY.voice.tts);
    expect(back.models).toEqual(DEFAULT_POLICY.models);
    expect(back.providers).toEqual(DEFAULT_POLICY.providers);
    expect(back.schemaVersion).toBe(POLICY_SCHEMA_VERSION);
    // Ses kayıtları yeniden eklenir (sıra değişebilir: yükseltme sona ekler).
    expect(back.localModels.map((model) => model.id).sort()).toEqual(DEFAULT_POLICY.localModels.map((model) => model.id).sort());
    // Kaynak belge değişmez.
    expect(DEFAULT_POLICY.voice.tts.provider).toBe('supertonic');
  });

  it('bilerek seçilmiş yerel ekran kartı sesi eski masaüstünde yerel kalır (Piper); bulut ve Piper seçimi aynen geçer', () => {
    const withTts = (tts: Policy['voice']['tts']) => view({ ...DEFAULT_POLICY, voice: { ...DEFAULT_POLICY.voice, tts } }).voice.tts;
    expect(withTts({ provider: 'ema-lightning', voiceId: 'ema' })).toEqual({ provider: 'piper-local' });
    expect(withTts({ provider: 'supertonic', voiceId: 'M5' })).toEqual({ provider: 'piper-local' });
    expect(withTts({ provider: 'piper-local' })).toEqual({ provider: 'piper-local' });
    expect(withTts({ provider: 'elevenlabs', voiceId: 'baska', model: 'eleven_v3' })).toEqual({ provider: 'elevenlabs', voiceId: 'baska', model: 'eleven_v3' });
  });

  it('OpenAI uyumlu role bağlı rol Anthropic varsayılanına döner; yazılı sohbet modeli, uç ve fiyat alanları çıkar', () => {
    const legacy = view({ ...DEFAULT_POLICY, models: { ...DEFAULT_POLICY.models, voice: KIMI, chat: KIMI, deep: { ...DEFAULT_POLICY.models.deep, price: { input: 1, output: 2 } } } });
    expect(legacy.models.voice).toEqual(DEFAULT_POLICY.models.voice);
    expect((legacy.models as Record<string, unknown>).chat).toBeUndefined();
    expect(legacy.models.deep).toEqual(DEFAULT_POLICY.models.deep);
    expect(JSON.stringify(legacy)).not.toContain('openai-compatible');
  });
});

describe('Claude Code konuşan beyin (brain.claudeCode)', () => {
  it('eski sürümün yazdığı belge (alan yok) varsayılanla açılır: önce abonelik, ses ve sohbet modelleri', () => {
    const old = JSON.parse(JSON.stringify(DEFAULT_POLICY)) as { brain: Record<string, unknown> };
    delete old.brain.claudeCode;
    const parsed = parsePolicy(old);
    expect(parsed?.brain.claudeCode).toEqual({ use: 'prefer', voice: { model: 'sonnet', effort: 'low' }, chat: { model: 'sonnet', effort: 'medium' } });
    // Roller dokunulmadan kalır: kurulu politikada `anthropic` seçiliyken de abonelik devreye girer.
    expect(parsed?.models.voice.provider).toBe('anthropic');
  });

  it('kullanım ve modeller yamayla değişir; rol açıkça claude-code seçilebilir', () => {
    const next = mergePolicy(DEFAULT_POLICY, {
      brain: { claudeCode: { use: 'fallback', voice: { model: 'haiku' } } },
      models: { voice: { provider: 'claude-code', model: 'sonnet', effort: 'low' } },
    });
    expect(next.brain.claudeCode).toEqual({ use: 'fallback', voice: { model: 'haiku', effort: 'low' }, chat: { model: 'sonnet', effort: 'medium' } });
    expect(next.models.voice).toMatchObject({ provider: 'claude-code', model: 'sonnet' });
    expect(() => mergePolicy(DEFAULT_POLICY, { brain: { claudeCode: { use: 'hep' as never } } })).toThrow();
  });
});
