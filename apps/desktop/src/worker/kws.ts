/**
 * Anahtar sözcük sezici (sherpa-onnx KWS): uyandırmanın hızlı yolu. Model İngilizce (GigaSpeech) ve açık
 * sözlüklü: söz, modelin parçalarına bölünerek verilir. Türkçe söyleyiş için sözün ek yazımları da verilir
 * (`variants`; seçimi ve ölçümü `main/voice/wake-variants.ts` içinde). Tutmadığı durumlar için ikinci yol
 * (kısa bölütün Whisper dökümü) ana süreçtedir.
 */

import fs from 'node:fs';
import path from 'node:path';
import { AUDIO_SAMPLE_RATE } from '@fuber/shared';
import type { KeywordSpotter, KeywordSpotterConfig, OnlineStream } from 'sherpa-onnx-node';
import { DEFAULT_KWS_PROFILE, KWS_PROFILES, type KwsTuning } from './kws-profiles';
import type { WorkerConfig } from './protocol';
import { encodePieces, parseSentencePieceModel, type SentencePieceModel } from './sentencepiece';

export interface KwsModule {
  KeywordSpotter: new (config: KeywordSpotterConfig) => KeywordSpotter;
}

export interface WakeHit {
  phrase: string;
  score: number;
}

type KwsConfig = NonNullable<WorkerConfig['kws']>;

/** Kalibrasyon örneğinin ardına eklenen taban gürültüsünün genliği (≈ −60 dBFS). */
const PROBE_NOISE = 0.001;

interface Keywords {
  lines: string[];
  /** Sezicinin etiketinden (`k0`) politikadaki söze. */
  labels: Map<string, string>;
  skipped: string[];
}

/**
 * Anahtar sözcük dosyasının satırları. Sözün kendisi yazılamıyorsa (modelin sözlüğünde olmayan harf) `skipped`'e
 * girer; yazılamayan ek yazım sessizce atlanır. Aynı parça dizisi iki kez verilmez (sezici yinelenen yolu reddeder).
 */
export function buildKeywords(model: SentencePieceModel, config: Pick<KwsConfig, 'phrases' | 'variants' | 'boost'>, threshold: number): Keywords {
  const lines: string[] = [];
  const labels = new Map<string, string>();
  const skipped: string[] = [];
  const seen = new Set<string>();
  const add = (spelling: string, phrase: string): boolean => {
    // Model büyük harfli İngilizce parçalarla eğitilmiş; sözlüğünde olmayan harf (ç, ş…) içeren söz yazılamaz.
    const pieces = encodePieces(model, spelling, (text) => text.toUpperCase());
    if (!pieces) return false;
    const key = pieces.join(' ');
    if (seen.has(key)) return true;
    seen.add(key);
    const label = `k${lines.length}`;
    labels.set(label, phrase);
    lines.push(`${key} :${config.boost} #${threshold} @${label}`);
    return true;
  };
  for (const phrase of config.phrases) if (!add(phrase, phrase)) skipped.push(phrase);
  for (const variant of config.variants) add(variant.spelling, variant.phrase);
  return { lines, labels, skipped };
}

function createSpotter(sherpa: KwsModule, config: KwsConfig, keywords: Keywords, tuning: KwsTuning, file: string): KeywordSpotter {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${keywords.lines.join('\n')}\n`, 'utf8');
  return new sherpa.KeywordSpotter({
    featConfig: { sampleRate: AUDIO_SAMPLE_RATE, featureDim: 80 },
    modelConfig: {
      transducer: { encoder: config.encoder, decoder: config.decoder, joiner: config.joiner },
      tokens: config.tokens,
      numThreads: 1,
      provider: 'cpu',
      debug: 0,
    },
    maxActivePaths: tuning.paths,
    numTrailingBlanks: 1,
    keywordsScore: tuning.boost,
    keywordsThreshold: tuning.threshold,
    keywordsFile: file,
  });
}

export class WakeSpotter {
  private spotter: KeywordSpotter;
  private stream: OnlineStream;
  private tuning: KwsTuning;
  private readonly model: SentencePieceModel;
  private keywords: Keywords;
  readonly skipped: string[];
  /** Kalibrasyon ölçümü için ayar başına kurulan geçici seziciler. */
  private readonly probes = new Map<string, KeywordSpotter>();

  constructor(
    private readonly sherpa: KwsModule,
    private readonly config: KwsConfig,
  ) {
    this.model = parseSentencePieceModel(fs.readFileSync(config.bpeModel));
    this.tuning = { threshold: config.threshold, boost: config.boost, paths: config.paths };
    this.keywords = this.keywordsFor(this.tuning);
    this.skipped = this.keywords.skipped;
    if (this.keywords.lines.length === 0) throw new Error('sezicinin sözlüğüyle yazılabilen uyandırma sözü yok');
    this.spotter = createSpotter(sherpa, config, this.keywords, this.tuning, config.keywordsFile);
    this.stream = this.spotter.createStream();
  }

  private keywordsFor(tuning: KwsTuning): Keywords {
    return buildKeywords(this.model, { phrases: this.config.phrases, variants: this.config.variants, boost: tuning.boost }, tuning.threshold);
  }

  /** Duyarlık değişti (kalibrasyon): sezici yeni ayarla yeniden kurulur. */
  setTuning(tuning: KwsTuning): void {
    if (tuning.threshold === this.tuning.threshold && tuning.boost === this.tuning.boost && tuning.paths === this.tuning.paths) return;
    this.tuning = { ...tuning };
    this.keywords = this.keywordsFor(tuning);
    this.spotter = createSpotter(this.sherpa, this.config, this.keywords, tuning, this.config.keywordsFile);
    this.stream = this.spotter.createStream();
  }

  /** Sezici kapalıyken biriken bağlam yanlış tetiklemesin diye akış yenilenir. */
  reset(): void {
    this.stream = this.spotter.createStream();
  }

  accept(samples: Float32Array): WakeHit | null {
    this.stream.acceptWaveform({ samples, sampleRate: AUDIO_SAMPLE_RATE });
    let hit: WakeHit | null = null;
    while (this.spotter.isReady(this.stream)) {
      this.spotter.decode(this.stream);
      const result = this.spotter.getResult(this.stream);
      if (result.keyword) {
        // Sezici puan vermez; eşiği geçtiği bilinir, o yüzden alt sınır olarak eşik bildirilir.
        hit = { phrase: this.keywords.labels.get(result.keyword) ?? result.keyword, score: this.tuning.threshold };
        this.spotter.reset(this.stream);
      }
    }
    return hit;
  }

  /**
   * Bir söz örneğinin "puanı": sezicinin o örnekte tetiklendiği en yüksek eşik (ızgaradan). Sezici puan vermediği
   * için örnek farklı eşiklerle kurulmuş seziciden geçirilir; eşik yükseldikçe tetiklenme azalır, bu yüzden ikili
   * arama yeter. Hiçbir eşikte tetiklenmiyorsa `null`.
   */
  probe(pcm: Int16Array): { score: number | null; phrase: string | null; profiles: string[] } {
    const float = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) float[i] = (pcm[i] ?? 0) / 32768;
    let best: { score: number; phrase: string } | null = null;
    let low = 0;
    let high = PROBE_GRID.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const threshold = PROBE_GRID[mid] ?? 0;
      // Puan her zaman olağan profilin destek ve yol ayarıyla ölçülür: kalibrasyonlar arasında karşılaştırılabilir kalır.
      const phrase = this.detectAt({ ...DEFAULT_KWS_PROFILE, threshold }, float);
      if (phrase !== null) {
        best = { score: threshold, phrase };
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    // Hangi duyarlık profilleri bu örneği yakalıyor: kalibrasyon en az duyarlı yeterli profili seçer.
    const profiles: string[] = [];
    let phrase = best?.phrase ?? null;
    for (const profile of KWS_PROFILES) {
      const heard = this.detectAt(profile, float);
      if (heard === null) continue;
      profiles.push(profile.id);
      phrase ??= heard;
    }
    return { score: best?.score ?? null, phrase, profiles };
  }

  private detectAt(tuning: KwsTuning, samples: Float32Array): string | null {
    const key = `${tuning.threshold}/${tuning.boost}/${tuning.paths}`;
    let spotter = this.probes.get(key);
    if (!spotter) {
      spotter = createSpotter(this.sherpa, this.config, this.keywordsFor(tuning), tuning, `${this.config.keywordsFile}.probe`);
      this.probes.set(key, spotter);
    }
    const stream = spotter.createStream();
    stream.acceptWaveform({ samples, sampleRate: AUDIO_SAMPLE_RATE });
    // Akışlı model son çerçeveleri ancak arkasından ses gelince çözer. Arkaya sayısal sıfır değil taban gürültüsü
    // eklenir (gerçek mikrofonda sıfır örnek olmaz). Fuber AI 1 kendi modelinde sıfır dolgunun sonucu bozduğunu
    // ölçmüştü; bu modelde fark çıkmadı (`scripts/voice/kws-eval.mjs probe`, 108 örnek: sıfır 77, gürültü 77; akışta 76).
    stream.acceptWaveform({ samples: probeTail(), sampleRate: AUDIO_SAMPLE_RATE });
    while (spotter.isReady(stream)) {
      spotter.decode(stream);
      const result = spotter.getResult(stream);
      if (result.keyword) return this.keywords.labels.get(result.keyword) ?? result.keyword;
    }
    return null;
  }

  /** Kalibrasyon bitti: ölçüm sezicileri bırakılır. */
  endProbe(): void {
    this.probes.clear();
  }
}

let tail: Float32Array | null = null;

/** 0,8 sn'lik taban gürültüsü (tohumlu: aynı örnek her ölçümde aynı sonucu versin). */
function probeTail(): Float32Array {
  if (tail) return tail;
  tail = new Float32Array(Math.round(AUDIO_SAMPLE_RATE * 0.8));
  let state = 0x2f6e2b1;
  for (let i = 0; i < tail.length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    tail[i] = (state / 0xffffffff - 0.5) * 2 * PROBE_NOISE;
  }
  return tail;
}

/** Kalibrasyonun denediği eşikler (küçükten büyüğe). */
export const PROBE_GRID = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.6, 0.7, 0.8] as const;
