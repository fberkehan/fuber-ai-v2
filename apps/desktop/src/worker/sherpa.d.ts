/** `sherpa-onnx-node` tip bildirimi yayınlamıyor; işçinin kullandığı kadarı burada tanımlıdır. */
declare module 'sherpa-onnx-node' {
  export interface VadConfig {
    sileroVad: {
      model: string;
      threshold: number;
      minSilenceDuration: number;
      minSpeechDuration: number;
      windowSize: number;
      maxSpeechDuration: number;
    };
    sampleRate: number;
    numThreads: number;
    provider: string;
    debug: number;
  }

  export interface SpeechSegment {
    /** Akışın başından bu yana örnek sırası. */
    start: number;
    samples: Float32Array;
  }

  export class Vad {
    constructor(config: VadConfig, bufferSizeInSeconds: number);
    acceptWaveform(samples: Float32Array): void;
    isEmpty(): boolean;
    isDetected(): boolean;
    pop(): void;
    clear(): void;
    front(enableExternalBuffer?: boolean): SpeechSegment;
    reset(): void;
    flush(): void;
  }

  export interface KeywordSpotterConfig {
    featConfig: { sampleRate: number; featureDim: number };
    modelConfig: {
      transducer: { encoder: string; decoder: string; joiner: string };
      tokens: string;
      numThreads: number;
      provider: string;
      debug: number;
    };
    maxActivePaths: number;
    numTrailingBlanks: number;
    keywordsScore: number;
    keywordsThreshold: number;
    keywordsFile: string;
  }

  export interface OnlineStream {
    acceptWaveform(input: { samples: Float32Array; sampleRate: number }): void;
  }

  export interface KeywordResult {
    keyword: string;
    start_time: number;
    tokens: string[];
    timestamps: number[];
  }

  export class KeywordSpotter {
    constructor(config: KeywordSpotterConfig);
    createStream(): OnlineStream;
    isReady(stream: OnlineStream): boolean;
    decode(stream: OnlineStream): void;
    reset(stream: OnlineStream): void;
    getResult(stream: OnlineStream): KeywordResult;
  }

  /** CJS paket: ESM'den varsayılan içe aktarımla (`module.exports`) alınır. */
  const sherpa: {
    Vad: typeof Vad;
    KeywordSpotter: typeof KeywordSpotter;
    version: string;
  };
  export default sherpa;
}
