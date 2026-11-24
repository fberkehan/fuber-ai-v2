// Galaxy Watch eklentisi: arayüze görünen nabız/pil bilgisi, IPC kanalı ve pencere olayı. Node bağımlılığı YOK: "Saat"
// sayfası (renderer) bu dosyayı yalnız `import type` ile alır.

export interface HudBio {
  status: 'live' | 'stale' | 'off';
  source: 'watch' | 'none';
  worn: boolean;
  battery: number | null;
  hr: number | null;
  hrSeries: number[];
  spo2: number | null;
  steps: number | null;
  kcal: number | null;
  skinTemp: number | null;
  stress: number | null;
  sleepMin: number | null;
  lastSampleAgoSec: number | null;
  /** Saat şu an ölçüyor mu (`bio.status.measuring`). */
  measuring?: boolean;
  /** Neden `off`: saat bağlı değil, takılı değil, ölçüm durdu, veri yok. */
  reason?: 'ok' | 'disconnected' | 'notWorn' | 'notMeasuring' | 'noData';
  /** Son 20 dk içindeki gerçek örneklerin nabız ortalaması. */
  hrAvg?: number | null;
  /** Son gerçek ölçümler (en çok 20): saat sürekli ölçmez, her ölçümde bir örnek yollar. */
  hrHistory?: Array<{ ts: number; hr: number }>;
  /** Saat şu an köprüde bağlı mı (durum buna BAĞLI DEĞİL, son örneğin yaşına bağlıdır). */
  connected?: boolean;
}

declare module '@fuber/shared' {
  interface Api {
    'saat.bio': { req: Record<string, never>; res: HudBio };
  }
  interface BusEvents {
    /** Saatten yeni nabız/durum geldi ya da bağlantı değişti. */
    'saat.bio': { bio: HudBio };
  }
  interface WindowEvents {
    'saat.bio': { bio: HudBio };
  }
}
