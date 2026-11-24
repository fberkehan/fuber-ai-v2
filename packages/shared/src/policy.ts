/**
 * Politika (KURGU §11.1): Fuber Yönetim'den gelen, masaüstünün bütün uzaktan yönetilen davranışı.
 * Kontrol servisi üretir ve sürümler; masaüstü `policy` servisi çeker, diske önbellekler.
 * Bağlantı yoksa önbellek, o da yoksa gömülü varsayılan: `DEFAULT_POLICY` (ana süreç demetinin içindedir;
 * ayrı bir JSON dosyası yoktur ki yerel model listesi tek sabitten, `DEFAULT_LOCAL_MODELS`'ten gelsin).
 */

import { z } from 'zod';
import { APP_VERSION, BUILTIN_MODULE_IDS } from './constants';
import { DEFAULT_LOCAL_MODELS } from './local-models';
import { DEFAULT_SUPERTONIC_VOICE, DEFAULT_TTS_ENGINE, TTS_ENGINE_IDS, TTS_MODEL_IDS } from './tts-engines';

/** `output_config.effort` değerleri. `null` = modelin kendi varsayılanı. */
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORT_LEVELS)[number];

/**
 * Rolün beyni: Anthropic API, bu bilgisayardaki yerel model, OpenAI uyumlu bir bulut sağlayıcı (`Policy.providers`) ya da
 * bu bilgisayardaki Claude Code (kullanıcının aboneliği; `Policy.brain.claudeCode`).
 */
export const MODEL_PROVIDERS = ['anthropic', 'local', 'openai-compatible', 'claude-code'] as const;
export type ModelProvider = (typeof MODEL_PROVIDERS)[number];

/**
 * Anahtar kasasındaki sağlayıcı kimlikleri. `openrouter`, `moonshot`, `custom` OpenAI uyumlu bulut
 * sağlayıcılarının anahtarlarıdır (`CloudEndpoint.keyId`); `openai` hem OpenAI sağlayıcısı hem ileride ses motoru içindir.
 */
export const KEY_PROVIDERS = ['anthropic', 'elevenlabs', 'openai', 'gemini', 'openrouter', 'moonshot', 'custom'] as const;

/** OpenAI uyumlu sağlayıcının hazır ayarı: istek biçimi ve bilinen farklar buna göre seçilir (`cloud-providers.ts`). */
export const CLOUD_PRESETS = ['openai', 'openrouter', 'moonshot', 'custom'] as const;
export type CloudPreset = (typeof CLOUD_PRESETS)[number];

/** Bir modelin dolar fiyatı (milyon token başına). Bilinmiyorsa alan hiç yazılmaz: kullanım "bilinmiyor" sayılır, 0 değil. */
export const ModelPriceSchema = z.object({
  input: z.number().min(0),
  output: z.number().min(0),
  /** Önbellekten okunan girdi; yoksa `input` sayılır. */
  cachedInput: z.number().min(0).optional(),
});
export type ModelPrice = z.infer<typeof ModelPriceSchema>;

/**
 * OpenAI uyumlu bulut sağlayıcı kaydı. Anahtar politikada DURMAZ: `keyId` Yönetim kasasındaki anahtarın adıdır ve
 * anahtar yalnız onaylı cihaza `keys[keyId]` olarak iner.
 */
export const CloudEndpointSchema = z.object({
  /** Kayıt kimliği; rol ayarı (`ModelRef.endpoint`) bununla bağlanır. */
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'küçük harf, rakam ve tire'),
  preset: z.enum(CLOUD_PRESETS),
  /** Görünen ad ("OpenRouter"); öz-durum ve Yönetim bunu söyler. */
  name: z.string().trim().min(1).max(60),
  /** Temel adres: `https://openrouter.ai/api/v1`. Sonundaki `/` yok sayılır. */
  baseUrl: z
    .string()
    .url()
    .refine((value) => /^https?:\/\//i.test(value), 'adres http(s) olmalı'),
  /** Anahtar kasasındaki anahtarın adı. */
  keyId: z.enum(KEY_PROVIDERS),
  /** Rolde model seçilmemişse kullanılacak model. */
  model: z.string().trim().min(1).max(200),
  /** Yetenekler: araç çağrısı, görsel girdi, akış. Kapalı olan özellik modele hiç sunulmaz. */
  caps: z
    .object({
      tools: z.boolean().default(true),
      vision: z.boolean().default(false),
      stream: z.boolean().default(true),
    })
    .default({ tools: true, vision: false, stream: true }),
});
export type CloudEndpoint = z.infer<typeof CloudEndpointSchema>;

/** Hazır kayıtlar: anahtar eklenince seçilebilir. Özel adres Yönetim'den eklenir (`preset: 'custom'`). */
export const DEFAULT_CLOUD_ENDPOINTS: CloudEndpoint[] = [
  { id: 'openai', preset: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', keyId: 'openai', model: 'gpt-5-mini', caps: { tools: true, vision: true, stream: true } },
  { id: 'openrouter', preset: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', keyId: 'openrouter', model: 'moonshotai/kimi-k2', caps: { tools: true, vision: false, stream: true } },
  { id: 'moonshot', preset: 'moonshot', name: 'Moonshot (Kimi)', baseUrl: 'https://api.moonshot.ai/v1', keyId: 'moonshot', model: 'kimi-k2-turbo-preview', caps: { tools: true, vision: false, stream: true } },
];

export const ModelRefSchema = z.object({
  /**
   * `anthropic` (asıl), `local`: bu bilgisayarda `llama-server` ile koşan dil modeli (`Policy.brain.local`) ya da
   * `openai-compatible`: `Policy.providers` içindeki `endpoint` kaydı. `local` rolde `model`, `effort`, `thinking`,
   * `speed` yok sayılır. `claude-code`: bu bilgisayardaki Claude Code CLI (abonelik); `model` CLI'nin takma adı
   * (`sonnet`, `haiku`, `opus`, `fable`) ya da tam model kimliğidir, `thinking` ve `speed` yok sayılır.
   */
  provider: z.enum(MODEL_PROVIDERS),
  /** `openai-compatible` iken `Policy.providers` kaydının kimliği. */
  endpoint: z.string().min(1).optional(),
  /**
   * Fiyat ($ / milyon token). Anthropic modellerinin fiyatı masaüstünün tablosundadır; OpenAI uyumlu modelde Yönetim
   * sağlayıcının listesinden (OpenRouter) ya da elle yazar. Yoksa kullanım kaydı "fiyat bilinmiyor" diye işaretlenir.
   */
  price: ModelPriceSchema.optional(),
  /** Sağlayıcının tam model kimliği, tarih eki olmadan: `claude-opus-5-5`. */
  model: z.string().min(1),
  effort: z.enum(EFFORT_LEVELS).nullable(),
  /**
   * Düşünme: `adaptive` (model gerektiği kadar düşünür) ya da `off` (gecikme için kapalı).
   * `off` yalnız kapatmayı destekleyen modelde geçerlidir (ör. `claude-haiku-5-5`, efor `high` ve altı);
   * desteklemeyen modelde beyin isteği `adaptive` gönderir ve bunu günlüğe yazar.
   */
  thinking: z.enum(['adaptive', 'off']).default('adaptive'),
  /** Çıktı hızı: `fast` destekleyen modelde daha hızlı ve daha pahalıdır; desteklemeyende yok sayılır. */
  speed: z.enum(['standard', 'fast']).default('standard'),
});
export type ModelRef = z.infer<typeof ModelRefSchema>;

export const LocalModelSchema = z.object({
  /** Benzersiz ve sürümlü kimlik: `whisper-large-v3-turbo-q5`. Kimlik değişirse yeni model iner. */
  id: z.string().min(1),
  /** Modelin hattaki görevi. */
  role: z.enum(['stt', 'tts', 'vad', 'wake', 'speaker', 'llm']),
  files: z.array(
    z.object({
      url: z.string().url(),
      /** Küçük harf onaltılık SHA-256; indirme sonrası doğrulanır. */
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
      /** Dosya boyutu (bayt); ilerleme çubuğu ve disk denetimi için. */
      bytes: z.number().int().positive(),
      /** `Paths.models` altına göreli hedef yol, `/` ayraçlı: `whisper/ggml-large-v3-turbo-q5_0.bin`. */
      path: z.string().min(1),
    }),
  ),
  /** `true`: inmeden ilgili özellik "hazırlanıyor" der ve kurulum sihirbazı bekler. */
  required: z.boolean(),
});
export type LocalModel = z.infer<typeof LocalModelSchema>;

/** `Policy.brain.deep.provider` seçenekleri. */
export const DEEP_PROVIDER_SETTINGS = ['auto', 'anthropic', 'claude-code'] as const;
export type DeepProviderSetting = (typeof DEEP_PROVIDER_SETTINGS)[number];
const DEFAULT_DEEP_BRAIN: { provider: DeepProviderSetting; claudeCodeModel: string } = { provider: 'auto', claudeCodeModel: 'sonnet' };

/**
 * Politika belgesinin biçim sürümü (`Policy.schemaVersion`). Alan olmayan belge 1 sayılır.
 * - 2 (demo.3): yerel ekran kartı sesi. Seslendirme motorları `supertonic` ve `ema-lightning` eklendi, varsayılan ses
 *   bulut (ElevenLabs) yerine yerel (Supertonic 3) oldu, yerel model listesine ses modelleri ve ONNX çalışma zamanı girdi.
 * Eski belge okunurken yükseltilir (`upgradePolicyDocument`).
 */
export const POLICY_SCHEMA_VERSION = 2;

/**
 * Claude Code'un konuşan beyin (sesli ve yazılı sohbet) olarak kullanımı (`Policy.brain.claudeCode.use`):
 * `prefer` Claude Code kurulu ve oturumu açıksa rolü `anthropic` olan ses ve sohbet ÖNCE ona gider (abonelik);
 * kullanılamıyorsa Anthropic API, o da yoksa yerel model · `fallback` önce Anthropic API, kullanılamıyorsa Claude Code,
 * sonra yerel model · `off` Claude Code konuşan beyin olarak kullanılmaz (derin işler `brain.deep` ile ayrı yönetilir).
 */
export const CLAUDE_CODE_USE = ['prefer', 'fallback', 'off'] as const;
export type ClaudeCodeUse = (typeof CLAUDE_CODE_USE)[number];
const ClaudeCodeRoleSchema = z.object({
  /** CLI'nin model takma adı (`sonnet`, `haiku`, `opus`, `fable`) ya da tam model kimliği. */
  model: z.string().trim().min(1).max(120),
  effort: z.enum(EFFORT_LEVELS).nullable(),
});
export type ClaudeCodeRoleModel = z.infer<typeof ClaudeCodeRoleSchema>;
/**
 * Varsayılanlar ölçümle seçildi (16 Kasım 2026, CLI 2.1.325, sıcak süreç; `docs/TUZAKLAR.md`): Sonnet 5.5 düşük eforda
 * ilk metin parçası ≈0,55–0,62 sn, Haiku 5.5 ≈1,0 sn (düşünmesi kapatılamıyor). Ses hızlı ve akıllı olanı alır.
 */
export const DEFAULT_CLAUDE_CODE_BRAIN: { use: ClaudeCodeUse; voice: ClaudeCodeRoleModel; chat: ClaudeCodeRoleModel } = {
  use: 'prefer',
  voice: { model: 'sonnet', effort: 'low' },
  chat: { model: 'sonnet', effort: 'medium' },
};

export const PolicySchema = z.object({
  /** Belgenin biçim sürümü (`POLICY_SCHEMA_VERSION`); eski belgede yoktur. */
  schemaVersion: z.number().int().positive().optional(),
  /** Her kayıtta bir artar. Masaüstü yalnız daha büyük sürümü uygular. */
  revision: z.number().int().nonnegative(),
  /** Son değişiklik anı (ISO 8601 UTC). */
  updatedAt: z.string(),

  persona: z.object({
    /** Asistanın adı; arayüzde ve istemde kullanılır. */
    name: z.string().min(1),
    /** Uyandırma sözleri, küçük harf. İlki varsayılan. */
    wakePhrases: z.array(z.string().min(1)).min(1),
    /** Kullanıcıya hitap: "efendim". */
    address: z.string(),
    language: z.enum(['tr', 'en']),
    /** Kişilik ve kurallar. `{name}` ve `{address}` yer tutucuları beyin tarafından doldurulur. */
    systemPrompt: z.string().min(1),
    /** Ses tonu tarifi; duygulu TTS sağlayıcılarına üslup yönergesi olarak gider. */
    voiceStyle: z.string(),
  }),

  /** Rol başına model (KURGU §6). */
  models: z.object({
    voice: ModelRefSchema,
    deep: ModelRefSchema,
    memory: ModelRefSchema,
    vision: ModelRefSchema,
    /**
     * Yazılı sohbetin modeli. Yoksa sohbet `deep` rolünün modelini kullanır (eski davranış). Ayrı tutulabilmesi,
     * sohbeti başka bir sağlayıcıya (ör. Kimi) verip derin işleri Claude'da bırakmak içindir.
     */
    chat: ModelRefSchema.optional(),
  }),

  /** OpenAI uyumlu bulut sağlayıcı kayıtları (`ModelRef.endpoint` bunlara bağlanır). */
  providers: z.array(CloudEndpointSchema).default(DEFAULT_CLOUD_ENDPOINTS),

  voice: z.object({
    engine: z.enum(['cascade', 'gemini-live', 'openai-realtime']),
    stt: z.object({ provider: z.enum(['whisper-local', 'elevenlabs-scribe']) }),
    tts: z.object({
      /**
       * Seslendirme motoru (`tts-engines.ts` kataloğu): `supertonic` ve `ema-lightning` bu bilgisayarın ekran kartında,
       * `piper-local` işlemcide, `elevenlabs` bulutta. Bu, cihazların VARSAYILANIDIR: kullanıcı Ayarlar › Ses'te kendi
       * cihazı için başka bir motor seçebilir (`Settings.ttsEngine`; ekran kartına bağlı bir tercihtir).
       */
      provider: z.enum(TTS_ENGINE_IDS),
      /** Motora özgü ses kimliği (Supertonic: `M4`; ElevenLabs: ses kimliği); yoksa motorun varsayılanı. */
      voiceId: z.string().optional(),
      /** Sağlayıcıya özgü TTS modeli; yoksa varsayılan. */
      model: z.string().optional(),
    }),
    /** Yalnız konuşmadan konuşmaya motorlar için. */
    s2s: z.object({ model: z.string(), voice: z.string() }).optional(),
    /** Yanıttan sonra uyandırma sözü olmadan dinlemeye devam süresi (saniye). */
    followUpSeconds: z.number().min(0).max(120),
    /**
     * Söz kesme kipi: `voice` konuşurken gelen her söz keser (yankı engelleme sağlamsa) ·
     * `wake` yalnız uyandırma sözü ve dur-sözcükleri keser · `off` kesilmez.
     * Kurulumdaki yankı sınaması tutmazsa cihaz bunu kendiliğinden `wake`'e indirir.
     */
    bargeIn: z.enum(['voice', 'wake', 'off']).default('voice'),
    /** Sohbet kipine izin: açıkken "sohbet edelim" denince uyandırma sözü olmadan konuşma sürer. */
    conversationMode: z.boolean().default(true),
    /** `wake`: yalnız uyandırmada doğrula · `always`: her sözde. */
    speakerVerification: z.enum(['off', 'wake', 'always']),
  }),

  /** Sağlayıcı anahtarları. Yalnız onaylı cihaza gönderilir; günlüğe ve arayüze asla yazılmaz. */
  keys: z.object({
    anthropic: z.string().optional(),
    elevenlabs: z.string().optional(),
    openai: z.string().optional(),
    gemini: z.string().optional(),
    openrouter: z.string().optional(),
    moonshot: z.string().optional(),
    custom: z.string().optional(),
  }),

  /** Modül kimliği → açık mı ve modüle özgü ayar. Listede olmayan modül kapalı sayılır. */
  modules: z.record(
    z.string(),
    z.object({
      enabled: z.boolean(),
      config: z.record(z.string(), z.unknown()).optional(),
    }),
  ),

  /** Listeden çıkan model diskten kullanılmaz. */
  localModels: z.array(LocalModelSchema),

  ambient: z.object({
    /** Yönetim izni. Ayrıca kullanıcının rızası (`Settings.ambientConsentAt`) gerekir. */
    allowed: z.boolean(),
    maxInterjectionsPerHour: z.number().int().min(0),
    /** İki araya girme arasındaki en kısa süre (saniye). */
    minGapSeconds: z.number().int().min(0),
    /** Ham dökümün saklanacağı gün sayısı; en çok 7 (`LIMITS.ambientTranscriptDays`). Süresi dolan satır silinir. */
    retentionDays: z.number().int().min(1).max(7).default(7),
    /**
     * Araya girme (eşlikçi): `off` hiç · `cloud-only` yalnız bulut beyni çalışırken (yerel modelde not, mesele ve
     * rapor sürer, araya girme bekler) · `on` yerel modelle de. Varsayılan ölçüme dayanır (16 Kasım 2026,
     * `scripts/e2e/ambient.mjs --measure`, 30 sentetik durum × 3): yerel model (Qwen3.5-4B) susması gereken 60 durumun
     * 25'inde araya girdi (%41,7; kabul eşiği %5). Bulut beyni ölçülemedi (hesapta kredi yok); `cloud-only` onun
     * ölçülmüş olduğu anlamına gelmez. Ayrıntı: `modules/ambient/companion.ts` sonundaki not.
     */
    interjections: z.enum(['off', 'cloud-only', 'on']).default('cloud-only'),
  }),

  /** Beynin sağlayıcı davranışı (KURGU §6 "Yerel beyin"). */
  brain: z
    .object({
      /**
       * `auto`: bulut beynine (anahtar yok, ödeme sorunu, ağ yok) ulaşılamazsa `voice` ve `memory` rolleri o tur
       * yerel modelle yürür; derin görevler yerelde koşmaz. `off`: geri düşme yok.
       */
      localFallback: z.enum(['auto', 'off']).default('auto'),
      local: z
        .object({
          /** `localModels` listesindeki dil modeli kaydının kimliği. */
          modelId: z.string().min(1),
          /** Yerel modele giden istemin (sistem + araçlar + geçmiş + yanıt payı) en çok token sayısı. */
          contextTokens: z.number().int().min(2048).max(131_072),
        })
        .default({ modelId: 'qwen3.5-4b-q4km', contextTokens: 8192 }),
      /**
       * Derin işlerin (yetenek geliştirme, araştırma, görüntü anlama) sağlayıcısı. `auto`: Anthropic anahtarı
       * çalışıyorsa API; anahtar yoksa ya da hesapta kredi yoksa bu bilgisayardaki Claude Code (kullanıcının
       * aboneliği); o da yoksa derin iş yapılmaz ve bu açıkça söylenir. Hızlı sesli turlar bundan etkilenmez.
       */
      deep: z
        .object({
          provider: z.enum(DEEP_PROVIDER_SETTINGS).default('auto'),
          /** Claude Code'a verilen model: takma ad (`sonnet`, `opus`, `haiku`) ya da tam model kimliği. */
          claudeCodeModel: z.string().min(1).default('sonnet'),
        })
        .default(DEFAULT_DEEP_BRAIN),
      /**
       * Konuşan beyin olarak Claude Code (abonelik). Rolü açıkça `claude-code` seçilen rol kendi `ModelRef`'ini
       * kullanır; buradaki `voice` / `chat` modelleri, rolü `anthropic` olup `use` ile Claude Code'a giden ses ve
       * yazılı sohbet içindir. Gizli kipte Claude Code'a hiçbir şey gitmez.
       */
      claudeCode: z
        .object({
          use: z.enum(CLAUDE_CODE_USE).default(DEFAULT_CLAUDE_CODE_BRAIN.use),
          voice: ClaudeCodeRoleSchema.default(DEFAULT_CLAUDE_CODE_BRAIN.voice),
          chat: ClaudeCodeRoleSchema.default(DEFAULT_CLAUDE_CODE_BRAIN.chat),
        })
        .default(DEFAULT_CLAUDE_CODE_BRAIN),
    })
    .default({ localFallback: 'auto', local: { modelId: 'qwen3.5-4b-q4km', contextTokens: 8192 }, deep: DEFAULT_DEEP_BRAIN, claudeCode: DEFAULT_CLAUDE_CODE_BRAIN }),

  limits: z.object({
    /** Günlük harcama sınırı (USD). Aşılınca yalnız `voice` rolü çalışır. */
    dailyBudgetUsd: z.number().min(0),
    /** Bir beyin çağrısındaki en çok araç turu. */
    maxAgentSteps: z.number().int().min(1),
    /**
     * Yetki düzeyinin üst sınırı (`Settings.authorityLevel`): `ask` her iş sorulur, `smart` geri alınabilir işler
     * sorulmaz, `full` kullanıcı Tam yetki verebilir. Alan yoksa sınır yoktur (`full`).
     */
    maxAuthority: z.enum(['ask', 'smart', 'full']).optional(),
  }),

  release: z.object({
    /** Bundan eski sürüm `force` açıkken çalışmaz. */
    minVersion: z.string(),
    latestVersion: z.string(),
    downloadUrl: z.string().optional(),
    notes: z.string().optional(),
    force: z.boolean(),
  }),

  /**
   * Geliştirici kipi (Katman 2, KURGU §10.13): Jarvis'in KENDİ kaynak kodunu Claude Code ile değiştirmesine izin.
   * Varsayılan KAPALI. Bu yalnız yönetim izni; ayrıca cihazda kullanıcı kipi açmalı ve kaynak deposunu göstermelidir.
   */
  developer: z.object({ enabled: z.boolean().default(false) }).default({ enabled: false }),

  /** Acil durdurma: etkinse ses ve araçlar durur, adada `message` gösterilir. */
  killSwitch: z.object({
    active: z.boolean(),
    message: z.string().optional(),
  }),
});

export type Policy = z.infer<typeof PolicySchema>;
export type PolicyKeys = Policy['keys'];
export type KeyProvider = keyof PolicyKeys;
/** Varsayılan bulut sesi: ElevenLabs hazır sesi "Daniel" (ücretsiz planda API'den kullanılabiliyor). */
export const DEFAULT_ELEVENLABS_VOICE_ID = 'onwK4e9ZLuTAKqWW03F9';
/** En düşük gecikmeli çok dilli model; Türkçe için `language_code` kabul eder. */
export const DEFAULT_ELEVENLABS_MODEL = 'eleven_flash_v2_5';

// `KEY_PROVIDERS` ile `keys` şemasının alanları aynı kalmalı (iki yönlü tip denetimi).
type SameKeys = [Exclude<KeyProvider, (typeof KEY_PROVIDERS)[number]>, Exclude<(typeof KEY_PROVIDERS)[number], KeyProvider>] extends [never, never] ? true : false;
export const KEY_PROVIDERS_MATCH_SCHEMA: SameKeys = true;

/** İç içe her alanı isteğe bağlı yapar; diziler bütün olarak değişir. */
export type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

/**
 * Yama: iç içe her alan isteğe bağlıdır; şemada İSTEĞE BAĞLI olan alan `null` verilerek KALDIRILIR
 * (ör. `{ voice: { tts: { voiceId: null } } }` ses kimliğini siler, sağlayıcının varsayılanına dönülür;
 * `{ killSwitch: { message: null } }`, `{ release: { notes: null } }`, `{ voice: { s2s: null } }`).
 * Zorunlu alana `null` verilemez (tip hatası; çalışma anında şema reddeder). Diziler bütün olarak değişir.
 */
export type DeepPatch<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPatch<T[K]> | (undefined extends T[K] ? null : never) }
    : T;

/** Yönetim'in değiştirebildiği kısım: sürüm alanları servisçe, anahtarlar kasa uçlarıyla yönetilir. */
export type PolicyPatch = DeepPatch<Omit<Policy, 'revision' | 'updatedAt' | 'keys'>>;

/**
 * Kişilik: yalnız karakter. Konuşma biçimi (sesli/yazılı), dürüstlük, zaman, hafıza ve araç kuralları beynin
 * kendi kurallar bloğundadır (`core/brain/prompt.ts`); burada yinelenmez ki Yönetim'den düzenlenen metin çelişmesin.
 */
const DEFAULT_SYSTEM_PROMPT = `Sen {name}'sin: kullanıcının bilgisayarında yaşayan, sesle konuşulan kişisel asistanı. Kullanıcıya "{address}" diye hitap edersin.

Karakterin
- Türkçe konuşursun; sıcak, net ve hafif esprilisin, ama önce işini bilen birisin. Lafı uzatmaz, övünmez, gereksiz yere özür dilemezsin.
- Kullanıcının tercihlerini, kişilerini, şirketlerini ve verdiği sözleri hatırlamayı işinin parçası sayarsın.
- İstek bir araçla karşılanabiliyorsa soru sormadan yaparsın; eksik tek bir bilgi varsa yalnız onu sorarsın.
- "Sus", "dur", "mikrofonu kapat" denince hemen ilgili ses aracını çağırır, en fazla tek kısa cümle söylersin.`;

const DEFAULT_MODULES: Policy['modules'] = Object.fromEntries(
  BUILTIN_MODULE_IDS.map((id) => [id, { enabled: id !== 'ambient' }]),
);

export const DEFAULT_POLICY: Policy = {
  schemaVersion: POLICY_SCHEMA_VERSION,
  revision: 0,
  updatedAt: '1970-01-01T00:00:00.000Z',
  persona: {
    name: 'Jarvis',
    wakePhrases: ['hey jarvis'],
    address: 'efendim',
    language: 'tr',
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    voiceStyle: 'Sakin, net ve sıcak; orta tempoda, hafif esprili bir erkek sesi.',
  },
  models: {
    // Gecikme bütçesi (KURGU §5.3): düşünme kapalı, efor düşük. Model, ölçümle Yönetim'den değişir.
    voice: { provider: 'anthropic', model: 'claude-haiku-5-5', effort: 'low', thinking: 'off', speed: 'standard' },
    // Yazılı sohbet de bu rolün modelini kullanır, eforu `CHAT_EFFORT` (medium) ile.
    deep: { provider: 'anthropic', model: 'claude-opus-5-5', effort: 'high', thinking: 'adaptive', speed: 'standard' },
    memory: { provider: 'anthropic', model: 'claude-haiku-5-5', effort: 'low', thinking: 'off', speed: 'standard' },
    vision: {
      provider: 'anthropic',
      model: 'claude-opus-5-5',
      effort: 'medium',
      thinking: 'adaptive',
      speed: 'standard',
    },
  },
  voice: {
    engine: 'cascade',
    stt: { provider: 'whisper-local' },
    // Varsayılan ses yereldir ve ekran kartında üretilir (Supertonic 3, ses M4). Ekran kartı kullanılamıyorsa cihaz
    // DirectML'e, o da olmazsa işlemcideki Piper'a düşer ve bunu tanıda ve öz-durumda açıkça söyler.
    tts: { provider: DEFAULT_TTS_ENGINE, voiceId: DEFAULT_SUPERTONIC_VOICE },
    followUpSeconds: 12,
    bargeIn: 'voice',
    conversationMode: true,
    speakerVerification: 'off',
  },
  providers: DEFAULT_CLOUD_ENDPOINTS,
  keys: {},
  modules: DEFAULT_MODULES,
  // Tek kaynak: gömülü varsayılan ve kontrol servisinin başlangıç politikası aynı sabiti okur.
  localModels: DEFAULT_LOCAL_MODELS,
  brain: {
    localFallback: 'auto',
    local: { modelId: 'qwen3.5-4b-q4km', contextTokens: 8192 },
    deep: { ...DEFAULT_DEEP_BRAIN },
    claudeCode: { use: DEFAULT_CLAUDE_CODE_BRAIN.use, voice: { ...DEFAULT_CLAUDE_CODE_BRAIN.voice }, chat: { ...DEFAULT_CLAUDE_CODE_BRAIN.chat } },
  },
  ambient: { allowed: false, maxInterjectionsPerHour: 3, minGapSeconds: 180, retentionDays: 7, interjections: 'cloud-only' },
  limits: { dailyBudgetUsd: 10, maxAgentSteps: 40 },
  release: { minVersion: APP_VERSION, latestVersion: APP_VERSION, force: false },
  developer: { enabled: false },
  killSwitch: { active: false },
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type AnySchema = z.ZodType & { unwrap?: () => z.ZodType; shape?: Record<string, z.ZodType>; valueType?: z.ZodType };

/** Bir nesne şemasında `key` alanının şeması (isteğe bağlı / varsayılanlı sarmalayıcılar açılarak); bilinmiyorsa `null`. */
function fieldSchema(schema: z.ZodType | null, key: string): z.ZodType | null {
  let current = schema as AnySchema | null;
  // `optional()`, `default()`, `nullable()` sarmalayıcıları: asıl nesne şemasına inilir.
  for (let depth = 0; current && !current.shape && !current.valueType && typeof current.unwrap === 'function' && depth < 8; depth++) {
    current = current.unwrap() as AnySchema;
  }
  if (!current) return null;
  if (current.shape) return current.shape[key] ?? null;
  return current.valueType ?? null;
}

/**
 * Yamadaki `null`: alan şemada isteğe bağlıysa (ve `null` geçerli bir değer değilse) alan KALDIRILIR; `null`'ı değer
 * olarak kabul eden alanda (`ModelRef.effort`) değer olarak yazılır. Şeması bilinmeyen yerde eskisi gibi değerdir.
 */
function deepMerge(base: unknown, patch: unknown, schema: z.ZodType | null = null): unknown {
  if (patch === undefined) return base;
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const field = fieldSchema(schema, key);
    if (value === null && field && !field.safeParse(null).success && field.safeParse(undefined).success) {
      delete out[key];
      continue;
    }
    out[key] = deepMerge(base[key], value, field);
  }
  return out;
}

/**
 * `patch`'i `base` üstüne derin birleştirir ve sonucu şemayla doğrular (geçersizse `ZodError` fırlatır).
 * Nesneler alan alan birleşir (`modules` dahil: yalnız verilen modül değişir); diziler bütün olarak değişir;
 * isteğe bağlı alan `null` ile kaldırılır (`DeepPatch`).
 */
export function mergePolicy(base: Policy, patch: DeepPatch<Policy>): Policy {
  return PolicySchema.parse(deepMerge(base, patch, PolicySchema));
}

/** Biçim sürümü 2 ile listeye giren yerel ses kayıtları (eski belgeye eklenir). */
const SCHEMA_2_MODEL_IDS: readonly string[] = Object.values(TTS_MODEL_IDS);

/** Belgenin biçim sürümü; alan yoksa 1. */
export function policySchemaVersion(raw: unknown): number {
  return isPlainObject(raw) && typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 1;
}

/**
 * Eski biçimdeki politika belgesini güncel biçime yükseltir (ham belge üstünde; doğrulama çağıranındır). Güncel
 * belgeye dokunmaz. Kontrol servisi (kayıtlı politika) ve masaüstü (önbellek, ağdan gelen belge) aynı işlevi kullanır:
 * eski bir Fuber Yönetim'in gönderdiği belge de yeni masaüstünde aynı sonuca varır.
 *
 * 1 → 2 (yerel ekran kartı sesi):
 * - Seslendirme ESKİ VARSAYILANSA (ElevenLabs, ses Daniel ya da boş, model `eleven_flash_v2_5` ya da boş) yeni
 *   varsayılana (Supertonic 3 / M4) çevrilir. Eski biçimde "varsayılanı bıraktım" ile "bilerek ElevenLabs Daniel
 *   seçtim" ayırt edilemez; proje kararı varsayılanın yerel ses olmasıdır. Başka bir ElevenLabs sesi ya da modeli
 *   seçilmişse (bilerek yapılmış seçim) ve `piper-local` seçiliyse dokunulmaz. Bulut sesi isteyen, güncel Yönetim'de
 *   (ya da cihazında Ayarlar › Ses'te) ElevenLabs'i yeniden seçer; o seçim sürüm 2 belgesine yazılır ve kalıcıdır.
 * - Yerel model listesine ses kayıtları (Supertonic 3, EMA Lightning, ONNX çalışma zamanları) eklenir; listede aynı
 *   kimlik varsa dokunulmaz. Eklenmezse eski listeyle gelen cihaz yerel sesin dosyalarını hiç tanımazdı.
 */
export function upgradePolicyDocument(raw: Record<string, unknown>): Record<string, unknown> {
  if (policySchemaVersion(raw) >= POLICY_SCHEMA_VERSION) return raw;
  const out: Record<string, unknown> = { ...raw, schemaVersion: POLICY_SCHEMA_VERSION };
  const voice = raw.voice;
  if (isPlainObject(voice) && isPlainObject(voice.tts)) {
    const tts = voice.tts;
    const oldDefault =
      tts.provider === 'elevenlabs' &&
      (tts.voiceId === undefined || tts.voiceId === DEFAULT_ELEVENLABS_VOICE_ID) &&
      (tts.model === undefined || tts.model === DEFAULT_ELEVENLABS_MODEL);
    if (oldDefault) out.voice = { ...voice, tts: { ...DEFAULT_POLICY.voice.tts } };
  }
  if (Array.isArray(raw.localModels)) {
    const present = new Set(raw.localModels.map((model) => (isPlainObject(model) ? model.id : null)));
    const added = DEFAULT_LOCAL_MODELS.filter((model) => SCHEMA_2_MODEL_IDS.includes(model.id) && !present.has(model.id));
    if (added.length > 0) out.localModels = [...raw.localModels, ...added];
  }
  return out;
}

/**
 * Bilinmeyen kaynaktan (disk önbelleği, ağ) gelen belgeyi politikaya çevirir. Eski biçimdeki belge önce yükseltilir. Eksik alanlar
 * `DEFAULT_POLICY`'den tamamlanır ki eski sürümün yazdığı önbellek yeni alan eklendiğinde de açılsın.
 * Belge kurtarılamayacak kadar bozuksa `null` döner.
 */
export function parsePolicy(raw: unknown): Policy | null {
  if (!isPlainObject(raw)) return null;
  raw = upgradePolicyDocument(raw);
  if (!isPlainObject(raw)) return null;
  const merged = deepMerge(DEFAULT_POLICY, raw) as Record<string, unknown>;
  // Belge kendi `voice.tts`'ini taşıyorsa o bütün olarak geçerlidir: varsayılanın isteğe bağlı `voiceId`/`model`
  // alanları geri doldurulmaz. Yoksa "sesi varsayılana döndür" (alan silindi) ya da yerel sese geçiş, okunurken
  // varsayılan bulut sesinin kimliğini yeniden kazanırdı.
  const rawTts = isPlainObject(raw.voice) ? raw.voice.tts : undefined;
  if (isPlainObject(rawTts) && typeof rawTts.provider === 'string' && isPlainObject(merged.voice)) {
    merged.voice = { ...merged.voice, tts: rawTts };
  }
  const result = PolicySchema.safeParse(merged);
  return result.success ? result.data : null;
}

/**
 * Biçim sürümü 2'yi (yeni seslendirme motorları, OpenAI uyumlu sağlayıcı) tanıyan ilk masaüstü sürümü. Daha eski
 * masaüstü (demo.1, demo.2) belgedeki `supertonic` ya da `openai-compatible` değerini görünce belgenin TAMAMINI
 * geçersiz sayar ("kontrol servisinden gelen politika geçersiz"): çökmez ama yeni politika ve anahtar alamaz.
 */
export const POLICY_V2_MIN_APP_VERSION = '2.0.0-demo.3';

/** Masaüstü sürümü biçim sürümü 2'yi tanıyor mu; sürüm okunamıyorsa (boş) güncel sayılır. */
export function clientUnderstandsPolicyV2(appVersion: string | null | undefined): boolean {
  if (!appVersion?.trim()) return true;
  return compareVersions(appVersion, POLICY_V2_MIN_APP_VERSION) >= 0;
}

/**
 * Politikanın ESKİ masaüstüne (biçim sürümü 1'i bilen: demo.1, demo.2) gönderilen görünümü: `upgradePolicyDocument`'ın
 * tersi. Kurulum sırası böylece önemsizdir: yeni Fuber Yönetim kurulup masaüstü henüz güncellenmediyse eski masaüstü
 * politikayı ve anahtarları almaya DEVAM EDER, demo.2'deki gibi çalışır. Kayıtlı politika değişmez; yalnız o cihaza
 * giden kopya uyarlanır (kontrol servisi cihazın bildirdiği sürüme bakar).
 *
 * - Seslendirme: yeni varsayılan (Supertonic 3 / M4; eski varsayılandan yükseltilmiş belge de böyledir) eski varsayılana
 *   (ElevenLabs Daniel) döner: demo.2 masaüstü güncellenene dek bugünkü sesiyle konuşur. Bilerek seçilmiş başka bir yerel
 *   ekran kartı sesi (EMA Lightning, Supertonic'in başka sesi) eski masaüstünde yerel kalır: Piper.
 * - OpenAI uyumlu sağlayıcıya bağlı rol, o rolün Anthropic varsayılanına döner (eski masaüstü o sağlayıcıyı konuşamaz;
 *   Anthropic anahtarı ya da kredisi yoksa zaten yerel modele düşer). Yazılı sohbetin ayrı modeli (`models.chat`),
 *   sağlayıcı listesi ve biçim sürümü çıkarılır.
 * - Yerel model listesinden biçim sürümü 2 ile gelen ses kayıtları çıkarılır (eski masaüstü kullanamayacağı ~1 GB'ı indirmesin).
 */
export function policyForLegacyClient(policy: Policy): Record<string, unknown> {
  const { schemaVersion: _version, providers: _providers, ...rest } = policy;
  const models: Record<string, unknown> = {};
  for (const [role, ref] of Object.entries(policy.models)) {
    if (role === 'chat' || !ref) continue;
    // `claude-code` (konuşan beyin olarak Claude Code) da eski masaüstünün bilmediği bir sağlayıcıdır.
    if (ref.provider === 'openai-compatible' || ref.provider === 'claude-code') {
      models[role] = { ...DEFAULT_POLICY.models[role as keyof typeof DEFAULT_POLICY.models] };
      continue;
    }
    const { endpoint: _endpoint, price: _price, ...plain } = ref;
    models[role] = plain;
  }
  const tts = policy.voice.tts;
  const legacyTts =
    tts.provider === 'elevenlabs' || tts.provider === 'piper-local'
      ? tts
      : tts.provider === DEFAULT_TTS_ENGINE && (tts.voiceId === undefined || tts.voiceId === DEFAULT_SUPERTONIC_VOICE)
        ? { provider: 'elevenlabs' as const, voiceId: DEFAULT_ELEVENLABS_VOICE_ID, model: DEFAULT_ELEVENLABS_MODEL }
        : { provider: 'piper-local' as const };
  return {
    ...rest,
    models,
    voice: { ...policy.voice, tts: legacyTts },
    localModels: policy.localModels.filter((model) => !SCHEMA_2_MODEL_IDS.includes(model.id)),
  };
}

/** Anahtarsız kopya: arayüze, günlüğe ve denetim kaydına yalnız bu gider. */
export function redactPolicy(policy: Policy): Policy {
  return { ...policy, keys: {} };
}

/**
 * Sürüm karşılaştırır (`2.0.0-demo.1` biçimi). Dönüş: a<b → -1, eşit → 0, a>b → 1.
 * Ön sürüm ekli olan, aynı çekirdek sürümün eksiz halinden küçüktür.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const parse = (v: string) => {
    const clean = v.trim().replace(/^v/, '');
    const dash = clean.indexOf('-');
    const core = dash === -1 ? clean : clean.slice(0, dash);
    const pre = dash === -1 ? '' : clean.slice(dash + 1);
    return {
      core: core.split('.').map((n) => Number.parseInt(n, 10) || 0),
      pre: pre === '' ? [] : pre.split('.'),
    };
  };
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const diff = (pa.core[i] ?? 0) - (pb.core[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  if (pa.pre.length === 0 && pb.pre.length === 0) return 0;
  if (pa.pre.length === 0) return 1;
  if (pb.pre.length === 0) return -1;
  for (let i = 0; i < Math.max(pa.pre.length, pb.pre.length); i++) {
    const x = pa.pre[i];
    const y = pb.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x) ? Number(x) : null;
    const ny = /^\d+$/.test(y) ? Number(y) : null;
    if (nx !== null && ny !== null) {
      if (nx !== ny) return nx < ny ? -1 : 1;
    } else if (x !== y) {
      // Semver: sayısal tanımlayıcı, harfli olandan küçüktür.
      if (nx !== null) return -1;
      if (ny !== null) return 1;
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/** Bu sürüm politikaya göre çalışamaz mı (zorunlu güncelleme). */
export function isUpdateRequired(policy: Policy, version: string = APP_VERSION): boolean {
  return policy.release.force && compareVersions(version, policy.release.minVersion) < 0;
}
