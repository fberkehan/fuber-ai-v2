// XR (Quest 3) köprüsünün arayüze görünen varlıkları, IPC kanalları ve olayı. Tip genişletmesidir; çekirdek sözleşmeye
// dokunmaz. Node bağımlılığı YOKTUR: "VR" sayfası (renderer) bu dosyayı yalnız `import type` ile alır.

/** Arayüze gösterilen eşleşmiş cihaz. */
export interface XrDeviceView {
  deviceId: string;
  name: string;
  model: string;
  pairedAt: string;
  lastSeen: string;
  /** Şu an bağlı mı. */
  connected: boolean;
  /** Cihaz türü: gözlük ya da saat. */
  kind: 'quest' | 'watch';
}

/** Şu an bağlı bir cihaz (tür, ad, ölçülen gidiş-dönüş gecikmesi). */
export interface XrConnectionView {
  kind: 'quest' | 'watch';
  deviceId: string;
  name: string;
  model: string;
  /** PC'nin `ping`ine cihazın `pong` yanıtından ölçülen gecikme; ölçülmediyse null. */
  latencyMs: number | null;
}

/** Açık eşleşme penceresinin arayüz görünümü. */
export interface XrPairingView {
  /** 6 haneli PIN (gözlükte elle girilir). */
  pin: string;
  /** QR resmi (data URL; gözlük kamerayla okur). */
  qr: string;
  /** QR'ın taşıdığı `fuberxr:` içeriği (tanı için). */
  uri: string;
  /** Hangi cihaz türü için açıldı (arayüz metni); QR/PIN aynıdır. */
  forKind: 'quest' | 'watch';
  /** Pencerenin kapanacağı an (ISO). */
  expiresAt: string;
  /** Kalan PIN denemesi. */
  attemptsLeft: number;
}

/** Köprünün bütün durumu (arayüz bununla çizer). */
export interface XrStatus {
  /** Sunucu dinliyor mu. */
  running: boolean;
  port: number;
  /** Bilgisayarın kalıcı statik anahtar parmak izi (base64url, 43 karakter). */
  fingerprint: string;
  /** Parmak izinin ilk 4 karakteri (gözlükte doğrulama için). */
  shortFp: string;
  pcName: string;
  /** Gözlüğe QR'da verilecek yerel IPv4 adresleri. */
  hosts: string[];
  devices: XrDeviceView[];
  /** Bağlı gözlüğün deviceId'si ya da null. */
  connected: string | null;
  /** Bağlı saatin deviceId'si ya da null. */
  watch: string | null;
  /** Bağlı bütün cihazlar (gözlük + saat). */
  connections: XrConnectionView[];
  pairing: XrPairingView | null;
  /** Dinleme/çalışma hatası (Türkçe), yoksa null. */
  error: string | null;
}

declare module '@fuber/shared' {
  interface Api {
    'xr.status': { req: Record<string, never>; res: XrStatus };
    'xr.startPairing': { req: { kind?: 'quest' | 'watch' }; res: XrStatus };
    'xr.cancelPairing': { req: Record<string, never>; res: XrStatus };
    'xr.forget': { req: { deviceId: string }; res: XrStatus };
  }
  interface BusEvents {
    'xr.changed': { connected: string | null; watch?: string | null; connections?: XrConnectionView[] };
    /** Bağlı cihazdan gelen iş iletisi (`hud-forward.ts` `hud.action` için, jarvis-watch eklentisi `bio.*` için dinler). */
    'xr.message': { kind: 'quest' | 'watch'; deviceId: string; msg: Record<string, unknown> };
    /** Bağlı cihazlara ileti yolla (`kind` yoksa hepsine). Ağsız kipte kimseye gitmez. */
    'xr.send': { kind?: 'quest' | 'watch'; msg: Record<string, unknown> };
    /** Bir cihaz (yeniden) bağlandı. */
    'xr.connected': { kind: 'quest' | 'watch'; deviceId: string };
  }
  interface WindowEvents {
    'xr.changed': { connected: string | null };
  }
}
