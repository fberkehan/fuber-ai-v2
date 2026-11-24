/**
 * Ses işçisinin iki ileti sözleşmesi. Yalnız tip içerir; ana süreç, işçi ve ses penceresi aynı dosyayı kullanır.
 *
 * 1. Ana süreç ↔ işçi: `utilityProcess` iletileri (`WorkerCommand` / `WorkerEvent`).
 * 2. İşçi ↔ ses penceresi: MessagePort (`PortToWorker` / `PortToWindow`). Ses örnekleri yalnız buradan akar.
 *
 * Ses dizileri kopyalanarak gönderilir; aktarım listesi `utilityProcess` tarafında çalışmaz (TUZAKLAR §7).
 */

import type { TtsDevice, TtsEngineId, TtsHostEngineId } from '@fuber/shared';

export type { TtsEngineId } from '@fuber/shared';

/** Model dosyaları `modelsDir`'e göreli verilir: işçi çalışma dizinini oraya alır ki yollar ASCII kalsın. */
export interface WorkerConfig {
  modelsDir: string;
  vad: {
    model: string;
    /** Silero olasılık eşiği (0–1). */
    threshold: number;
    /** Sözün "başladı" sayılması için gereken kesintisiz ses (ms). */
    minSpeechMs: number;
    /** Sözün "bitti" sayılması için gereken sessizlik (ms). */
    minSilenceMs: number;
    maxSpeechSeconds: number;
    /**
     * Kısa söz izleyici: asıl VAD'ın "söz" saymadığı kadar kısa ya da kısık sesleri ("sus") yakalayan ikinci,
     * daha duyarlı VAD. Yalnız `watch` açıkken (Jarvis konuşurken / düşünürken) çalışır.
     */
    blip: { threshold: number; minSpeechMs: number; minSilenceMs: number; maxMs: number };
  };
  kws: null | {
    encoder: string;
    decoder: string;
    joiner: string;
    tokens: string;
    bpeModel: string;
    /** Uyandırma sözleri, küçük harf ("hey jarvis"). Modelin sözlüğüyle yazılamayan söz atlanır. */
    phrases: string[];
    /** Sezici eşiği (0–1); düşük değer daha kolay tetiklenir. */
    threshold: number;
    /** Söz yoluna verilen destek puanı. */
    boost: number;
    /** Sezicinin aynı anda izlediği yol sayısı (`maxActivePaths`). */
    paths: number;
    /** İşçinin üreteceği anahtar sözcük dosyasının yolu (`modelsDir`'e göreli). */
    keywordsFile: string;
    /**
     * Uyandırma sözünün ek yazımları (Türkçe söyleyişe karşılık gelen İngilizce yazımlar). Sezici bunlardan birini
     * duyunca `phrase` duyulmuş sayılır. Boşsa yalnız sözün kendisi aranır.
     */
    variants: Array<{ spelling: string; phrase: string }>;
  };
  piper: null | {
    exe: string;
    voice: string;
    espeakData: string;
    /** Cümleler arası sessizlik (sn). */
    sentenceSilence: number;
  };
  tts: TtsSettings;
  /**
   * Toplantı kipinde bilgisayar sesinin ("Karşı taraf") bölütleyicisi: aynı VAD modeli, ayrı durum. Yalnız kip açıkken
   * (`system` komutu) beslenir. Verilmezse `vad` ayarları kullanılır.
   */
  systemVad?: { minSilenceMs: number; maxSpeechSeconds: number };
}

/** Ses konağında yüklü birincil motor: hangi motor, hangi ses, nerede çalışıyor. */
export interface TtsHostInfo {
  engine: TtsHostEngineId;
  voice: string;
  device: TtsDevice;
  sampleRate: number;
}

/**
 * Seslendirme ayarı. Seçim (cihaz ayarı ya da politika) ya da ses konağının durumu değişince işçi yeniden
 * başlatılmadan `tts.config` ile yenilenir.
 */
export interface TtsSettings {
  /** Seçili motor. */
  engine: TtsEngineId;
  /**
   * Ses konağı (ekran kartı motorları) hazırsa yüklü motoru; hazır değilse ya da istenmiyorsa (`piper-local` seçili)
   * `null`. Port ayrıca `tts.port` ile teslim edilir: port yokken bu alan dolu olsa da konak kullanılmaz.
   */
  host: TtsHostInfo | null;
  /** Konuşma dili (`persona.language`); okuma düzeltici (rakam → sözcük) yalnız Türkçede uygulanır. Yoksa Türkçe. */
  language?: 'tr' | 'en';
  /** Bulut sesi: anahtar varsa dolu (seçili motor başka olsa da: "Dinle" için); anahtar yoksa `null`. */
  elevenlabs: null | {
    apiKey: string;
    voiceId: string;
    model: string;
    languageCode: string | null;
    baseUrl: string;
    firstChunkTimeoutMs: number;
    stallTimeoutMs: number;
    /** Yalnız sınamada: bu süreçte harcanabilecek en çok karakter. */
    charBudget: number | null;
  };
}

/** Bulut sesten yerel sese düşüşün nedeni (`elevenlabs.ts` › `ElevenFailure` ile aynı). */
export type TtsFallbackReason =
  | 'no_key'
  | 'unauthorized'
  | 'payment'
  | 'rate_limit'
  | 'quota'
  | 'network'
  | 'timeout'
  | 'interrupted'
  | 'server'
  | 'budget';

export type WorkerCommand =
  /** İlk ileti; ses penceresine giden port bu iletiyle birlikte teslim edilir. */
  | { type: 'init'; config: WorkerConfig }
  /** Ses penceresi yeniden yüklendi: yeni port bu iletiyle gelir. */
  | { type: 'port' }
  /** Mikrofon çerçeveleri işlensin mi (kapalıyken VAD ve sezici durur, durumları sıfırlanır). */
  | { type: 'listen'; on: boolean }
  /** Anahtar sözcük sezici çalışsın mı (konuşurken ve uyandırma duraklatılmışken kapalı). */
  | { type: 'wake'; on: boolean }
  /** Kısa söz izleyici çalışsın mı (Jarvis konuşurken / düşünürken: kaçan "sus" yakalansın). */
  | { type: 'watch'; on: boolean }
  /**
   * Bu andan önceki ses teslim edilmesin: Jarvis'in sesi çalarken (ve biter bitmez) mikrofona giren ses onun kendi
   * sesidir. VAD sıfırlanmaz (kullanıcı o sırada konuşmaya başladıysa sözü bölünmesin); süren bölüt bittiğinde yalnız
   * bu andan SONRAKİ kısmı verilir, o kısımda söz yoksa bölüt hiç verilmez ve `speech_cut` bildirilir.
   */
  | { type: 'cut' }
  /** Toplantı kipi: bilgisayar sesinin çerçeveleri (`system_frame`) bölütlensin mi (kapanırken durum sıfırlanır). */
  | { type: 'system'; on: boolean }

  /**
   * Cümleyi sıraya koyar; sentezlenen ses `streamId` akışına eklenir. `local`: sağlayıcı ne olursa olsun yerel ses.
   * `engine` / `voice`: seçili motor yerine bu motor ve sesle ("Dinle"); o motor kullanılamıyorsa başka motora
   * düşülmez, `tts.error` döner.
   */
  | { type: 'tts.speak'; streamId: string; text: string; local?: boolean; engine?: TtsEngineId; voice?: string }
  /**
   * Ses konağına giden port bu iletiyle teslim edilir (konak hazır oldu ya da yeniden başladı). Port yoksa konak
   * bağlantısı bırakılır (konak durdu): cümleler Piper ile okunur.
   */
  | { type: 'tts.port'; host: TtsHostInfo | null }
  /** Seslendirme sağlayıcısı değişti (politika). Geri düşme bekleme süresi sıfırlanır. */
  | { type: 'tts.config'; settings: TtsSettings }
  /** Kullanıcı uyandı: bulut bağlantısı önceden açılsın (ilk cümle el sıkışması beklemesin). */
  | { type: 'tts.prewarm' }
  /** Sezicinin duyarlığı değişti (kalibrasyon): sezici yeni ayarla yeniden kurulur. */
  | { type: 'kws.update'; threshold: number; boost: number; paths: number }
  /**
   * Kalibrasyon: verilen söz örneğinin sezicide tetiklendiği EN YÜKSEK eşiği (örneğin "puanı") ve örneği yakalayan
   * duyarlık profillerini ölçer. Yanıt `kws.probe.result`. Ölçüm için kurulan seziciler `kws.probe.end` ile bırakılır.
   */
  | { type: 'kws.probe'; id: number; pcm: Int16Array }
  | { type: 'kws.probe.end' }
  /** Akışa başka cümle gelmeyecek; pencere kuyruk boşalınca "bitti" der. */
  | { type: 'tts.end'; streamId: string }
  /** Sırayı boşaltır, süren sentezi atar ve pencereye "çalmayı kes" der. */
  | { type: 'tts.cancel' }
  /** Kısa uyarı sesi (pencere sentezler). */
  | { type: 'earcon'; kind: EarconKind }
  | { type: 'shutdown' };

export type EarconKind = 'heard' | 'wake' | 'error';

export type WorkerEvent =
  /** Süreç ayağa kalktı ve ileti dinliyor; ana süreç `init`'i bunun üzerine yollar. */
  | { type: 'hello' }
  /** Modeller yüklendi. `kws`/`tts` kullanılamıyorsa `false` ve `warnings` içinde nedeni. */
  | { type: 'ready'; kws: boolean; tts: boolean; warnings: string[]; /** Piper (işlemcideki yerel ses) açıldı mı. */ piper?: boolean }
  | { type: 'fatal'; message: string }
  /** Anahtar sözcük sezici tetiklendi. */
  | { type: 'wake'; phrase: string; score: number }
  /**
   * Söz başladı (VAD, `minSpeechMs` kesintisiz ses). `onsetAgoMs`: ilk sesli çerçeveden bu yana geçen süre.
   * `near`: yankı gidericiye göre sözün kullanıcıya ait olma oranı (son ~260 ms'de Jarvis'in sesi mikrofona
   * ulaşıyorken): 1 kullanıcı, 0 yankı. `null`: o sırada yankı beklenmiyordu. Giderici henüz öğrenmediyse 0 gelir
   * (ısınma süresince ve yankı varken aday söz kesmez); ısındı ve yankı bulamadıysa (kulaklık) `null`. Alan yoksa
   * ses penceresi yankı özeti göndermiyordur.
   */
  /**
   * `coarse`: `near` kaba kapıdan geldi (yankı giderici yakınsamadı). Oturum bu kanıtla hemen susmaz: önce sesi kısar,
   * kısık seste ikinci bir `speech_near` gelirse susar.
   */
  | { type: 'speech_start'; segmentId: number; onsetAgoMs: number; near?: number | null; coarse?: boolean }
  /**
   * Söz bitti: bölütün tamamı (16 kHz mono). `durationMs` sessizlik payı hariç söz süresi;
   * `confirmLagMs` sözün gerçek başlangıcı ile `speech_start` bildirimi arasındaki ölçülen gecikme.
   */
  | { type: 'speech_end'; segmentId: number; pcm: Int16Array; durationMs: number; confirmLagMs: number }
  /**
   * Kısa söz izleyici, asıl VAD'ın bildirmediği kısa bir ses yakaladı (bölüt, 16 kHz mono). Ana süreç bunu
   * yalnız dur-sözcüğü mü diye yazıya çevirir; söz kesme sayılmaz.
   */
  | { type: 'speech_blip'; pcm: Int16Array; durationMs: number }
  /** `cut`tan önce başlayan bölüt, kesme anından sonra söz içermediği için atıldı: bu bölüt için `speech_end` gelmez. */
  | { type: 'speech_cut'; segmentId: number }
  /**
   * Süren söz, başladığında yankı sanılmıştı (ya da kararsız kalınmıştı) ama artık kullanıcının konuştuğu kesin:
   * yankı gidericinin son ~260 ms'lik oranı eşiği geçti. Bölüt başına en çok bir kez bildirilir.
   */
  | { type: 'speech_near'; segmentId: number; coarse?: boolean }
  /** Yankı gidericinin durumu (tanı; Jarvis konuşurken saniyede bir). */
  | { type: 'echo'; converged: boolean; trained: boolean; delayMs: number; erleDb: number; coupled?: boolean; corr?: number; corrLagMs?: number }
  /** Genlik, saniyede ~25 kez. `rms` ve `peak` 0–1. */
  | { type: 'level'; source: 'mic' | 'speaker'; rms: number; peak: number }
  /** Bir cümlenin sentezi bitti ve sesi pencereye yollandı. */
  | {
      type: 'tts.sentence';
      streamId: string;
      index: number;
      /** Üretilen sesin süresi (ms). */
      audioMs: number;
      /** İsteğin işçiye varışından ilk ses parçasına kadar geçen süre (ms; sırada bekleme dahil). */
      firstChunkMs: number;
      /** Motorun cümleyi aldığı andan ilk ses parçasına (ms); ses üretilmediyse `null`. */
      synthFirstChunkMs: number | null;
      rms: number;
      /** Cümleyi gerçekte seslendiren motor ve çalıştığı yer. */
      engine: TtsEngineId;
      device?: TtsDevice;
      /** Bulut sağlayıcının faturaladığı karakter; yerel seste 0. */
      chars: number;
      /** Bu cümlede buluttan yerel sese düşüldüyse nedeni. */
      fallback: TtsFallbackReason | null;
    }
  | { type: 'tts.error'; streamId: string; message: string }
  /** Ses konağı bir cümleyi üretemedi (çöktü, yanıt vermedi); yeni port gelene dek cümleler Piper ile okunur. */
  | { type: 'tts.hostFailed'; message: string; kind?: 'synth' | 'hang' | 'closed' }
  /** Bulut ses kullanılamadı; `until` anına kadar (`null`: ayar değişene kadar) yerel ses kullanılacak. */
  | { type: 'tts.fallback'; reason: TtsFallbackReason; status: number | null; until: number | null; detail: string }
  /** Geri düşüşten sonra bulut yeniden ses üretti. */
  | { type: 'tts.recovered' }
  /** Bulut sağlayıcı bir cümleyi faturaladı (cümle yarıda kesilmiş olsa da). `durationMs`: istekten bitişe. */
  | { type: 'tts.usage'; engine: TtsEngineId; chars: number; audioMs: number; durationMs: number }
  /**
   * `kws.probe` yanıtı. `score`: örneğin yürürlükteki ayarla tetiklendiği en yüksek eşik (0–1); hiç tetiklenmediyse
   * `null`. `profiles`: örneği yakalayan duyarlık profilleri (`KWS_PROFILES` kimlikleri).
   */
  | { type: 'kws.probe.result'; id: number; score: number | null; phrase: string | null; profiles: string[] }
  /** Toplantı kipi: bilgisayar sesinde söz başladı ("Karşı taraf konuşuyor" göstergesi). */
  | { type: 'system_start' }
  /** Toplantı kipi: bilgisayar sesinde bir söz bölütü bitti (16 kHz mono). */
  | { type: 'system_speech'; pcm: Int16Array; durationMs: number }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string };

/** Yankı gidericinin çerçeve özeti (`renderer/audio/echo-canceller.ts` › `EchoFrameInfo` ile aynı biçim). */
export interface EchoFrame {
  ref: number;
  mic: number;
  est: number;
  res: number;
  /** Kullanıcı konuşuyor mu: 1 evet, 0 yalnız yankı, 0,5 bilinmiyor. */
  near: number;
  /** Jarvis'in sesi şu an mikrofona ulaşıyor olabilir mi (referans etkin). */
  active: boolean;
  converged: boolean;
  trained: boolean;
  warm: boolean;
  coupled: boolean;
  delayMs: number;
  erleDb: number;
  /** Son gecikme kestiriminin en iyi zarf ilintisi ve yeri (tanı; eski ses penceresinde yok). */
  corr?: number;
  corrLagMs?: number;
  /** `near` kaba kapıdan (süzgeç yakınsamadı, bağlaşım ve gecikme biliniyor); eski ses penceresinde yok. */
  coarse?: boolean;
}

/** Ses penceresi → işçi. */
export type PortToWorker =
  /** 20 ms, 16 kHz mono Int16 (yankısı çıkarılmış); `echo`: yankı gidericinin o çerçeveye ilişkin özeti. */
  | { type: 'frame'; pcm: Int16Array; echo?: EchoFrame }
  /** Toplantı kipi: bilgisayarın sesi (Windows loopback), 20 ms, 16 kHz mono Int16. */
  | { type: 'system_frame'; pcm: Int16Array }
  /** Çalınmakta olan sesin genliği (ada dalgası için). */
  | { type: 'level'; rms: number; peak: number };

/** İşçi → ses penceresi. */
export type PortToWindow =
  /** `streamId` akışına eklenecek ses parçası. */
  | { type: 'pcm'; streamId: string; sampleRate: number; pcm: Int16Array }
  /** Akışa başka ses gelmeyecek. */
  | { type: 'end'; streamId: string }
  /**
   * Çalmayı kes ve kuyruğu boşalt. Port sıralı olduğu için bu iletiden ÖNCE yollanmış bütün ses
   * parçaları eskidir; pencere IPC'den gelen `playback.stop`'tan sonra bu iletiyi görene kadar gelen sesi atar.
   */
  | { type: 'flush' }
  | { type: 'earcon'; kind: EarconKind };
