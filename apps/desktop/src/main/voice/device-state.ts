/**
 * Bu cihaza (mikrofon, hoparlör, oda) ve bu kullanıcının sesine özgü ses ayarları: uyandırma kalibrasyonu ve yankı
 * sınamasının sonucu. Politikadan ayrıdır (cihazda kalır) ve politikayı yalnız DARALTIR: yankı sızıyorsa söz kesme
 * kipi `voice` olsa bile `wake` uygulanır.
 *
 * `Settings` sözleşmesinde bu alanlar yok (sözleşmeyi orkestra şefi değiştirir); o yüzden veri kökünde ayrı bir
 * dosyada durur: `<veri>/voice-device.json`. Dosya bozuksa yok sayılır, uygulama varsayılanlarla açılır.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { EchoCancellationMode, IsoDateTime, WakePath } from '@fuber/shared';

export interface WakeCalibration {
  /** Seçilen sezici eşiği; sezici örneklerde hiç tetiklenmediyse `null` (varsayılan eşik kalır). */
  threshold: number | null;
  /** Whisper'ın kullanıcının söyleyişini yazdığı, eşleştiriciye eklenen yazımlar. */
  learned: string[];
  /** Her örnek: sezici puanı (tetiklendiği en yüksek eşik), Whisper dökümü, algılandığı yollar. */
  samples: Array<{ score: number | null; transcript: string; paths: WakePath[]; durationMs: number; profiles?: string[] }>;
  at: IsoDateTime;
  /** Seçilen sezici duyarlık profili (`worker/kws-profiles.ts` › `KWS_PROFILES`); eski kalibrasyonlarda yoktur. */
  profile?: string;
}

export interface EchoMeasurement {
  /** Jarvis'in kendi sesi mikrofonda konuşma olarak algılandı mı. */
  leaked: boolean;
  /** Çalma sırasında VAD'ın bildirdiği söz sayısı. */
  vadTriggers: number;
  /** Çalma sırasında sezicinin tetiklenme sayısı (test cümlesinde uyandırma sözü geçer). */
  wakeTriggers: number;
  /** Çalmadan önceki ve çalma sırasındaki mikrofon düzeyi (0–1 RMS). */
  baselineRms: number;
  playbackRms: number;
  /** Çalma sırasındaki en yüksek mikrofon düzeyi. */
  playbackPeak: number;
  /** Test cümlesinin gerçekten çalınan süresi. */
  playedMs: number;
  at: IsoDateTime;
  /** Sızan sesin çalma bittikten sonra mikrofonda sürdüğü süre (hoparlör tamponu + oda); eski ölçümlerde yoktur. */
  tailMs?: number | null;
  /** Ölçümün alındığı yankı engelleme kipi. */
  mode?: EchoCancellationMode;
  /** Olağan kip sızdırdığı için "bütün sesleri bastır" kipi de denendiyse o kipteki sonuç. */
  allMode?: { leaked: boolean; playbackRms: number } | null;
  /** Ölçüm değil gözlem: Jarvis söz kesme `voice` kipindeyken kendi sesiyle kendini kesti. */
  observed?: boolean;
  /**
   * Ölçüm referanslı yankı gidericiyle alındı: `leaked`, gidericiye RAĞMEN Jarvis'in kendi sesinin kullanıcı sözü
   * sayıldığı anlamına gelir (söz kesme `wake`e iner). Eski ölçümlerde alan yoktur: orada `leaked` yalnız ham
   * sızıntıdır ve söz kesmeyi tek başına kapatmaz.
   */
  gated?: boolean;
  /** Gidericiden bağımsız: çalma sırasında VAD'ın söz bildirdiği sayı (ham sızıntı). */
  rawVadTriggers?: number;
  /** Söz kesmenin bu cihazda neden `wake`e indiği (tanıda gösterilir). */
  reason?: 'echo_test' | 'self_interrupt' | 'barge_test';
  /**
   * Sınama anında yankı gidericinin durumu: öğrendi mi, bulduğu gecikme, en iyi zarf ilintisi ve yeri, tarayıcının
   * bildirdiği çıkış gecikmesi. "Neden öğrenemedi" sorusunun yanıtı buradadır (ilinti 0,7'nin altındaysa yankı zarfı
   * bozuluyor; yeri aralığın sonundaysa gecikme daha da büyük).
   */
  canceller?: { trained: boolean; coupled: boolean; delayMs: number; erleDb: number; corr: number | null; corrLagMs: number | null; outputLatencyMs: number | null } | null;
  /** Söz kesme sınaması geçtiği için `wake` kipi kaldırıldı (ham sızıntı sürüyor, giderici bastırıyor). */
  clearedByBargeTest?: boolean;
}

/** Söz kesme sınamasının (Ayarlar › Ses) sonucu ve cihaza yazdığı eşik. */
export interface BargeCalibration {
  /** Yankı gidericinin düzey kapısı (güç oranı). */
  gate: number;
  stopped: number;
  trials: number;
  selfInterrupts: number;
  medianMs: number | null;
  at: IsoDateTime;
}

export interface VoiceDeviceState {
  wake: WakeCalibration | null;
  echo: EchoMeasurement | null;
  /** "Bulut sesinin kotası doldu" bilgisinin en son gösterildiği ay (`YYYY-AA`): ayda bir kez gösterilir. */
  ttsQuotaNoticeMonth: string | null;
  /**
   * Bu cihazda mikrofonun yankı engelleme kipi. Yalnız yankı sınaması olağan kipte sızıntı, `all` kipinde temiz
   * gösterdiyse `all` olur; dosyada yoksa `default`.
   */
  aecMode?: EchoCancellationMode;
  barge?: BargeCalibration | null;
  /**
   * d6 (deneme, varsayılan KAPALI): yankı sınaması "sızıyor" dediği cihazda doğal söz kesme açık kalsın (kaba kanıt:
   * sesi kıs, kısınca mikrofon düşmüyorsa sus). Benzetimde sınandı ama gerçek Bluetooth hoparlörde doğrulanmadı;
   * dosyada `true` yazılınca açılır. Kapalıyken eski davranış: "sızıyor" → söz kesme `wake`.
   */
  coarseBarge?: boolean;
}

const EMPTY: VoiceDeviceState = { wake: null, echo: null, ttsQuotaNoticeMonth: null };

export interface DeviceStore {
  get(): VoiceDeviceState;
  update(patch: Partial<VoiceDeviceState>): VoiceDeviceState;
}

export function createDeviceStore(dataDir: string, onError: (message: string, error: unknown) => void = () => {}): DeviceStore {
  const file = path.join(dataDir, 'voice-device.json');
  let state: VoiceDeviceState = EMPTY;
  try {
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<VoiceDeviceState> | null;
      if (parsed && typeof parsed === 'object') {
        state = {
          wake: parsed.wake ?? null,
          echo: parsed.echo ?? null,
          ttsQuotaNoticeMonth: typeof parsed.ttsQuotaNoticeMonth === 'string' ? parsed.ttsQuotaNoticeMonth : null,
          ...(parsed.aecMode === 'all' ? { aecMode: 'all' as const } : {}),
          ...(parsed.barge && typeof parsed.barge === 'object' ? { barge: parsed.barge } : {}),
          ...(parsed.coarseBarge === true ? { coarseBarge: true } : {}),
        };
      }
    }
  } catch (error) {
    onError('cihaz ses ayarları okunamadı; varsayılanlar kullanılıyor', error);
  }
  return {
    get: () => state,
    update(patch) {
      state = { ...state, ...patch };
      try {
        fs.mkdirSync(dataDir, { recursive: true });
        const temp = `${file}.tmp`;
        fs.writeFileSync(temp, JSON.stringify(state, null, 2), 'utf8');
        fs.renameSync(temp, file);
      } catch (error) {
        onError('cihaz ses ayarları yazılamadı', error);
      }
      return state;
    },
  };
}
