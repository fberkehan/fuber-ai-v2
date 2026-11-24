/**
 * Seslendirme yönlendiricisi: cümleyi seçili motora verir; o motor ses üretemezse O CÜMLEYİ zincirde bir alttaki
 * motorla okur. Kullanıcı hiçbir durumda sessizlik yaşamaz ve hangi motorun konuştuğu her cümlede bildirilir.
 *
 * Zincir (yukarıdan aşağı; seçili motorun bulunduğu halkadan başlanır):
 *   1. Bulut (ElevenLabs)            yalnız seçiliyse.
 *   2. Ses konağı (ekran kartı)      Supertonic 3 / EMA Lightning; ayrı süreç (`host-synth.ts`). Bulut seçiliyken
 *                                    konak ayaktaysa bulutun yerel yedeği de odur.
 *   3. Piper (işlemci)               her zaman son halka.
 *
 * Kurallar:
 * - Ses hiç başlamadan hata → aynı cümle bir alt halkayla.
 * - Ses başladıktan sonra kopma → cümlenin çalınan kısmı kalır, SONRAKİ cümleler alt halkaya geçer.
 * - Bulut her geri düşüşte bir bekleme süresi başlatır (`cooldownFor`); süre dolunca yeniden denenir.
 * - Konak bir cümlede başarısız olursa "düştü" sayılır ve ana süreç yeni port (ya da yeni ayar) gönderene kadar
 *   kullanılmaz; konağı yeniden başlatmak ana sürecin işidir (`main/voice/tts-host.ts`).
 * - Geri düşüşler `onFallback` / `onHostFailure` ile bildirilir; kullanıcıya ne söyleneceğine ana süreç karar verir.
 *
 * İfade etiketleri motora göre çevrilir (`speech-tags.ts` › `ENGINE_TAGS`): `eleven_v3` köşeli etiketleri, Supertonic
 * yalnız `<throatclear>`'ı anlar; ötekilerde etiketler metinden çıkarılır (yoksa yüksek sesle okunurlar).
 */

import { isTtsHostEngine, type TtsDevice, type TtsEngineId, type TtsHostEngineId } from '@fuber/shared';
import type { ElevenFailure } from './elevenlabs';
import { ENGINE_TAGS, renderExpressionTags, tagEngineFor, type TagEngine } from './speech-tags';
import { toSpokenTurkish } from './tr-speech';

export interface SynthChunk {
  pcm: Int16Array;
  sampleRate: number;
}

export interface LocalSynth {
  readonly sampleRate: number;
  speak(text: string, onChunk: (chunk: SynthChunk) => void): Promise<{ samples: number; firstChunkMs: number | null }>;
  cancel(): void;
}

export interface CloudSynth {
  readonly sampleRate: number;
  prewarm(): void;
  speak(
    text: string,
    onChunk: (chunk: SynthChunk) => void,
  ): Promise<{ samples: number; firstChunkMs: number | null; chars: number; cancelled: boolean }>;
  cancel(): void;
  stop(): void;
}

/** Ses konağının yönlendiricinin gördüğü yüzü (`HostSynth`). */
export interface HostSynthLike {
  readonly usable: boolean;
  readonly info: { engine: TtsHostEngineId; voice: string; device: TtsDevice; sampleRate: number };
  speak(
    text: string,
    onChunk: (chunk: SynthChunk) => void,
    language?: 'tr' | 'en',
    override?: { engine?: TtsHostEngineId; voice?: string },
  ): Promise<{ samples: number; firstChunkMs: number | null }>;
  cancel(): void;
}

export interface FallbackInfo {
  reason: ElevenFailure;
  /** HTTP durumu; ağ hatası ya da zaman aşımında `null`. */
  status: number | null;
  /** Bulutun yeniden deneneceği an (epoch ms); `null` = ayar değişene kadar denenmez. */
  until: number | null;
  /** Günlük için ayrıntı (anahtar içermez). */
  detail: string;
}

export interface SpeakResult {
  /** Cümleyi GERÇEKTEN seslendiren motor ve çalıştığı yer. */
  engine: TtsEngineId;
  device: TtsDevice;
  samples: number;
  sampleRate: number;
  /** Motorun isteği aldığı andan ilk ses parçasına (ms); ses üretilmediyse `null`. */
  firstChunkMs: number | null;
  /** Bulut sağlayıcının faturaladığı karakter; yerel seste 0. */
  chars: number;
  /** Bu cümlede buluttan yerele düşüldüyse nedeni. */
  fallback: ElevenFailure | null;
  /** Bu cümlede ekran kartı motoru kullanılamadıysa nedeni (cümle Piper ile okundu ya da yarıda kaldı). */
  hostError: string | null;
}

export interface SpeakOptions {
  /** Sağlayıcı ne olursa olsun yerel ses (yankı sınaması kotadan yemesin). */
  forceLocal?: boolean;
  /**
   * Seçili motor yerine bu motorla oku ("Dinle"). Motor kullanılamıyorsa başka motora DÜŞÜLMEZ, hata fırlatılır:
   * kullanıcı hangi sesi dinlediğini bilmelidir.
   */
  engine?: TtsEngineId;
  voice?: string;
}

const MINUTE = 60_000;

/** Geri düşüşten sonra bulutun yeniden deneneceği an. `null`: ayar (anahtar, ses, model) değişene kadar denenmez. */
export function cooldownFor(reason: ElevenFailure, now: number): number | null {
  switch (reason) {
    case 'no_key':
    case 'budget':
      return null;
    case 'quota': {
      // Kota bittiyse gün sonuna kadar: her cümlede boşuna istek atılmasın.
      const end = new Date(now);
      end.setHours(24, 0, 0, 0);
      return end.getTime();
    }
    case 'rate_limit':
      return now + MINUTE;
    case 'timeout':
    case 'network':
    case 'interrupted':
      return now + 2 * MINUTE;
    case 'unauthorized':
    case 'payment':
    case 'server':
      return now + 5 * MINUTE;
  }
}

const TAG = /\[[^[\]\n]{1,40}\]/g;

/** Köşeli duygu etiketlerini (`[laughs]`, `[güler]`) ayıklar. */
export function stripTags(text: string): string {
  return text.replace(TAG, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Motorun sivri ayraçlı etiketleri (`<throatclear>`) işaret temizliğinden (`>` silinir) ve okuma düzelticiden
 * ("<" → "küçüktür") korunur: önce özel kullanım alanından bir yer tutucuya çevrilir, en sonda geri konur.
 * Köşeli etiketler (`[laughs]`) iki adımdan da zaten sağ çıkar; onlara dokunulmaz.
 */
/** Yer tutucu: özel kullanım alanından iki karakter (U+E000 + etiket sırası U+E100…). Kod noktasıyla: kaynakta görünmezler. */
const SHIELD_OPEN = String.fromCharCode(0xe000);
const SHIELD_FIRST = 0xe100;
const SHIELD_LAST = 0xe1ff;
const shieldRange = `${String.fromCharCode(SHIELD_FIRST)}-${String.fromCharCode(SHIELD_LAST)}`;
/** Tek bir yer tutucu (bölmek ve tanımak için; yakalama öbeğiyle: `split` yer tutucuyu da verir). */
const SHIELD_TOKEN = new RegExp(`(${SHIELD_OPEN}[${shieldRange}])`);
const SHIELD_TOKEN_ALL = new RegExp(`${SHIELD_OPEN}([${shieldRange}])`, 'g');
const SHIELD_STRAY = new RegExp(`[${SHIELD_OPEN}${shieldRange}]`, 'g');

function shieldTags(text: string, tags: TagEngine): { text: string; restore(value: string): string } {
  const angled = [...new Set(Object.values(ENGINE_TAGS[tags]).filter((tag): tag is string => typeof tag === 'string' && tag.startsWith('<')))];
  if (angled.length === 0) return { text, restore: (value) => value };
  let shielded = text;
  angled.forEach((tag, index) => {
    // Yer tutucunun iki yanına boşluk: bitişik yazılmış etiket ("<throatclear>Tamam") sözcüğe yapışmasın.
    shielded = shielded.split(tag).join(` ${SHIELD_OPEN}${String.fromCharCode(SHIELD_FIRST + index)} `);
  });
  return {
    text: shielded,
    restore: (value) => value.replace(SHIELD_TOKEN_ALL, (_match, code: string) => angled[code.charCodeAt(0) - SHIELD_FIRST] ?? ' ').replace(SHIELD_STRAY, ' '),
  };
}

/** Türkçe okunuş: kısayol tuşları ayrı sözcükler olarak ("Ctrl+Alt+K"; "+" artı diye okunmaz), sonra okuma düzeltici. */
function readAloud(text: string): string {
  const keys = text.replace(/\b(Ctrl|Control|Alt|Shift|Win)\+/g, (_match, key: string) => `${/^c/i.test(key) ? 'Kontrol' : key} `);
  return toSpokenTurkish(keys).trim();
}

/**
 * Söz olmayan simgeler: oklar (U+2190–21FF, 2900–297F, 2B00–2BFF), teknik işaretler (2300–23FF), kutu çizgileri ve
 * geometrik şekiller (2500–25FF), çeşitli simgeler ve süsler (2600–27BF). Motora GİTMEZ: Piper bu karakterlerde
 * erişim ihlaliyle (0xC0000005) ÇÖKÜYOR ve cümle hiç okunmuyor (ölçüm: "Supertonic → Piper." üç denemenin üçünde);
 * öteki motorlar da bunları okuyamaz. Kısa bir duraksamaya (virgül) çevrilir: "A → B" "A, B" diye okunur.
 * Aralıklar kod noktasıyla kurulur (kaynakta görünmez karakter kalmasın).
 */
const symbolRange = (from: number, to: number): string => `${String.fromCharCode(from)}-${String.fromCharCode(to)}`;
const UNSPEAKABLE_SYMBOLS = new RegExp(
  `\\s*[${symbolRange(0x2190, 0x21ff)}${symbolRange(0x2300, 0x23ff)}${symbolRange(0x2500, 0x25ff)}${symbolRange(0x2600, 0x27bf)}${symbolRange(0x2900, 0x297f)}${symbolRange(0x2b00, 0x2bff)}]+\\s*`,
  'g',
);

const toTagEngine = (tags: TagEngine | boolean): TagEngine => (tags === true ? 'eleven_v3' : tags === false ? 'none' : tags);

/**
 * Seslendirilemeyen işaretleri atar; geriye okunacak bir şey kalmazsa boş döner. `tags`: ifade etiketlerinin
 * çevrileceği motor (`true` eski kullanım: `eleven_v3`; `false`: hiçbiri).
 */
export function speakableText(text: string, tags: TagEngine | boolean = 'none'): string {
  return prepare(text, toTagEngine(tags), null);
}

/** Boşlukları teke indirir, noktalamadan önceki boşluğu atar. */
const tidy = (text: string): string =>
  text
    .replace(/\s+/g, ' ')
    .replace(/ ([.,!?;:])/g, '$1')
    .trim();

function prepare(text: string, tags: TagEngine, language: string | null): string {
  // İfade etiketleri (`<laugh>`, `[laughs]`, `*güler*`…) önce ele alınır: motor destekliyorsa kendi yazımına çevrilir,
  // desteklemiyorsa atılır (`speech-tags.ts`). Sonraki adımlar (işaret temizliği, okuma düzeltici) etikete dokunmaz.
  const shield = shieldTags(renderExpressionTags(text, tags), tags);
  const cleaned = shield.text
    .replace(UNSPEAKABLE_SYMBOLS, ', ')
    .replace(/[*_`#>|~]+/g, ' ')
    .replace(/\p{Extended_Pictographic}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Etiketlerden başka bir şey kalmadıysa okunacak söz yoktur.
  if (!/[\p{L}\p{N}]/u.test(cleaned.replace(TAG, ''))) return '';
  if (language !== 'tr') return tidy(shield.restore(cleaned));
  // Okuma düzeltici yer tutucuyu tanımaz (imi "-" yapar): metin, yer tutucuların ARASINDAKİ parçalar halinde çevrilir.
  const spoken = cleaned
    .split(SHIELD_TOKEN)
    .map((part) => (SHIELD_TOKEN.test(part) ? part : readAloud(part)))
    .filter((part) => part.length > 0)
    .join(' ');
  return tidy(shield.restore(spoken));
}

/**
 * Motora verilecek metin: seslendirilemeyen işaretler atılır, sonra (Türkçe konuşuluyorsa) rakam ve simgeler okunuşa
 * çevrilir ("20:00'de" → "yirmide"). Bütün motorlar için aynıdır: küçük modeller sayıları, saatleri ve tutarları
 * yanlış okur. Ekrandaki ve dökümdeki metin değişmez; yalnız sese giden metin çevrilir.
 */
export function spokenForm(text: string, options: { tags?: TagEngine; keepTags?: boolean; language?: string | null } = {}): string {
  return prepare(text, options.tags ?? (options.keepTags === true ? 'eleven_v3' : 'none'), options.language ?? 'tr');
}

/** Model köşeli duygu etiketlerini seslendirmeden yorumluyor mu. */
export const understandsTags = (model: string): boolean => /^eleven_v3/.test(model);

export interface RouterOptions {
  local: LocalSynth | null;
  log(level: 'info' | 'warn' | 'error', message: string): void;
  onFallback(info: FallbackInfo): void;
  /** Geri düşüşten sonra bulut yeniden ses üretti. */
  onRecovered(): void;
  /** Ses konağı bir cümleyi üretemedi; yeni port gelene dek kullanılmayacak. */
  /** Konak bir cümleyi üretemedi. `kind`: üretim hatası · yanıt yok · bağlantı koptu. (Motora özgü hata buraya GELMEZ.) */
  onHostFailure?(message: string, kind?: 'synth' | 'hang' | 'closed'): void;
  now?: () => number;
}

export class TtsRouter {
  private cloud: CloudSynth | null = null;
  private cloudModel = '';
  private host: HostSynthLike | null = null;
  /** Konak bu bağlantıda bir cümleyi üretemedi: yeni bağlantıya kadar atlanır. */
  private hostDown = false;
  /** Seçili motor (cihaz ayarı ya da politika). */
  private engine: TtsEngineId = 'piper-local';
  /** Konuşma dili (politika `persona.language`): okuma düzeltici yalnız Türkçede uygulanır. */
  private language: string | null = 'tr';
  /** Bulut bu ana kadar denenmez; `Infinity` = ayar değişene kadar. 0 = geri düşüş yok. */
  private cooldownUntil = 0;
  private lastFallback: FallbackInfo | null = null;
  private readonly now: () => number;

  constructor(private readonly options: RouterOptions) {
    this.now = options.now ?? Date.now;
  }

  /** Bulut sağlayıcıyı takar ya da (`null`) çıkarır. Ayar değiştiği için bekleme süresi sıfırlanır. */
  setCloud(cloud: CloudSynth | null, model = ''): void {
    this.cloud?.stop();
    this.cloud = cloud;
    this.cloudModel = model;
    this.cooldownUntil = 0;
    this.lastFallback = null;
    // Eski kullanım: bulut takılıyken seçili motor da buluttur (`setEngine` çağrılmadıysa).
    if (cloud && this.engine === 'piper-local' && !this.engineSet) this.engine = 'elevenlabs';
  }

  private engineSet = false;

  /** Seçili motor. `piper-local` seçiliyken konak takılı olsa da kullanılmaz. */
  setEngine(engine: TtsEngineId): void {
    this.engine = engine;
    this.engineSet = true;
  }

  /** Ses konağının ucunu takar ya da (`null`) çıkarır. Yeni uç "düştü" işaretini siler. */
  setHost(host: HostSynthLike | null): void {
    if (host !== this.host) this.hostDown = false;
    this.host = host;
  }

  setLanguage(language: string | null): void {
    this.language = language;
  }

  available(): boolean {
    return this.options.local !== null || this.cloud !== null || this.hostUsable();
  }

  /** Şu an cümleleri seslendirecek motor. */
  active(): TtsEngineId {
    if (this.engine === 'elevenlabs' && this.cloudUsable()) return 'elevenlabs';
    if (this.engine !== 'piper-local' && this.hostUsable()) return this.host!.info.engine;
    return 'piper-local';
  }

  fallback(): FallbackInfo | null {
    return this.cloudUsable() ? null : this.lastFallback;
  }

  private cloudUsable(): boolean {
    return this.cloud !== null && this.now() >= this.cooldownUntil;
  }

  private hostUsable(): boolean {
    return this.host !== null && this.host.usable && !this.hostDown;
  }

  /** Uyanma anında çağrılır: bulut bağlantısı önceden açılır ki ilk cümle el sıkışması beklemesin. */
  prewarm(): void {
    if (this.engine === 'elevenlabs' && this.cloudUsable()) this.cloud?.prewarm();
  }

  cancel(): void {
    this.cloud?.cancel();
    this.host?.cancel();
    this.options.local?.cancel();
  }

  stop(): void {
    this.cloud?.stop();
    this.cloud = null;
  }

  private fellBack(reason: ElevenFailure, status: number | null, detail: string): void {
    const until = cooldownFor(reason, this.now());
    this.cooldownUntil = until ?? Number.POSITIVE_INFINITY;
    this.lastFallback = { reason, status, until, detail };
    this.options.log('warn', `bulut ses kullanılamadı (${reason}): ${detail}; yerel sese geçildi`);
    this.options.onFallback(this.lastFallback);
  }

  /**
   * Cümleyi seslendirir. Üçüncü parametre eski kullanımda `forceLocal` (boolean), yenide `SpeakOptions`.
   * Hiçbir motor yoksa fırlatır.
   */
  async speak(text: string, onChunk: (chunk: SynthChunk) => void, options: SpeakOptions | boolean = {}): Promise<SpeakResult> {
    const opts: SpeakOptions = typeof options === 'boolean' ? { forceLocal: options } : options;
    const target = opts.engine ?? this.engine;
    /** "Dinle": istenen motor olmazsa başka motora düşülmez. */
    const explicit = opts.engine !== undefined;
    const language = this.language === 'en' ? 'en' : 'tr';
    let fallback: ElevenFailure | null = null;
    let hostError: string | null = null;
    let rate = 0;
    const tap = (chunk: SynthChunk): void => {
      rate = chunk.sampleRate;
      onChunk(chunk);
    };
    const hasLocal = this.options.local !== null || this.hostUsable();

    // ── 1. bulut ──
    const cloud = this.cloud;
    // Yerel ses yoksa (model inmemiş) "yerel zorunlu" isteği de buluta gider: sessiz kalmaktan iyidir.
    if (cloud && target === 'elevenlabs' && (!opts.forceLocal || !hasLocal) && this.cloudUsable()) {
      const speakable = spokenForm(text, { tags: tagEngineFor('elevenlabs', this.cloudModel), language: this.language });
      if (!speakable) return { engine: 'elevenlabs', device: 'cloud', samples: 0, sampleRate: cloud.sampleRate, firstChunkMs: null, chars: 0, fallback: null, hostError: null };
      try {
        const result = await cloud.speak(speakable, tap);
        if (!result.cancelled && this.lastFallback) {
          this.lastFallback = null;
          this.options.onRecovered();
        }
        return {
          engine: 'elevenlabs',
          device: 'cloud',
          samples: result.cancelled ? 0 : result.samples,
          sampleRate: cloud.sampleRate,
          firstChunkMs: result.firstChunkMs,
          chars: result.samples > 0 || !result.cancelled ? result.chars : 0,
          fallback: null,
          hostError: null,
        };
      } catch (error) {
        const failure = error as { reason?: ElevenFailure; status?: number | null; samples?: number; message?: string };
        const reason = failure.reason ?? 'server';
        this.fellBack(reason, failure.status ?? null, failure.message ?? String(error));
        if ((failure.samples ?? 0) > 0) {
          // Cümlenin başı çalındı: baştan okumak yinelemek olur. Kalan cümleler yerel sesle sürer.
          return {
            engine: 'elevenlabs',
            device: 'cloud',
            samples: failure.samples ?? 0,
            sampleRate: cloud.sampleRate,
            firstChunkMs: null,
            chars: speakable.length,
            fallback: reason,
            hostError: null,
          };
        }
        if (explicit) throw error;
        fallback = reason;
      }
    } else if (explicit && target === 'elevenlabs') {
      throw new Error('bulut ses kullanılamıyor');
    }

    // ── 2. ses konağı (ekran kartı) ──
    const host = this.host;
    if (host && target !== 'piper-local' && this.hostUsable()) {
      // Olağan cümlede konağın YÜKLÜ motoru konuşur (seçim yeni değiştiyse konak öbür motoru yükleyene dek eskisi);
      // yalnız "Dinle" başka bir motoru adıyla ister.
      const override = explicit && isTtsHostEngine(target) ? { engine: target, voice: opts.voice } : {};
      const engine: TtsHostEngineId = override.engine ?? host.info.engine;
      // İfade etiketi yalnız ölçülmüş ses + dil çiftinde motora gider (`speech-tags.ts`); yoksa atılır.
      const tags = tagEngineFor(engine, '', { voice: override.voice ?? (engine === host.info.engine ? host.info.voice : null), language: this.language });
      const speakable = spokenForm(text, { tags, language: this.language });
      if (!speakable) return { engine, device: host.info.device, samples: 0, sampleRate: host.info.sampleRate, firstChunkMs: null, chars: 0, fallback, hostError: null };
      try {
        const result = await host.speak(speakable, tap, language, override);
        return { engine, device: host.info.device, samples: result.samples, sampleRate: rate || host.info.sampleRate, firstChunkMs: result.firstChunkMs, chars: 0, fallback, hostError: null };
      } catch (error) {
        const failure = error as { samples?: number; message?: string; kind?: string };
        hostError = failure.message ?? String(error);
        // İstenen motor yüklenemedi (dosyası yok, model okunamadı): konak SAĞLAMDIR ve yüklü motorla konuşmayı
        // sürdürür. "Dinle" bunu nedeniyle birlikte bildirir; konak asılı sayılmaz, yeniden başlatılmaz.
        if (failure.kind === 'engine' && override.engine !== undefined && override.engine !== host.info.engine) {
          this.options.log('warn', `${engine} dinlenemedi: ${hostError}`);
          throw error;
        }
        this.hostDown = true;
        this.options.log('warn', `ekran kartı sesi kullanılamadı: ${hostError}; işlemcideki yerel sese geçildi`);
        this.options.onHostFailure?.(hostError, failure.kind === 'hang' || failure.kind === 'closed' ? failure.kind : 'synth');
        if ((failure.samples ?? 0) > 0) {
          return { engine, device: host.info.device, samples: failure.samples ?? 0, sampleRate: rate || host.info.sampleRate, firstChunkMs: null, chars: 0, fallback, hostError };
        }
        if (explicit) throw error;
      }
    } else if (explicit && isTtsHostEngine(target)) {
      throw new Error('ses motoru hazır değil');
    }

    // ── 3. Piper (işlemci) ──
    const local = this.options.local;
    if (!local) throw new Error('yerel ses kullanılamıyor');
    const speakable = spokenForm(text, { language: this.language });
    if (!speakable) return { engine: 'piper-local', device: 'cpu', samples: 0, sampleRate: local.sampleRate, firstChunkMs: null, chars: 0, fallback, hostError };
    const result = await local.speak(speakable, tap);
    return {
      engine: 'piper-local',
      device: 'cpu',
      samples: result.samples,
      sampleRate: local.sampleRate,
      firstChunkMs: result.firstChunkMs,
      chars: 0,
      fallback,
      hostError,
    };
  }
}
