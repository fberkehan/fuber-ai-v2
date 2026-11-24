/**
 * XR köprüsü çalışma zamanı: `pairing.ts` + `server.ts` + `discovery.ts` parçalarını tek bir yaşam döngüsünde
 * birleştirir ve arayüze (Yönetim/Ayarlar sayfası) `status`/`startPairing`/`cancelPairing`/`forget` sunar.
 *
 * SAF çekirdek: Electron'a dokunmaz. Ağ açma (`net: true`) ve QR resmi üretimi (`qrDataUrl`) DIŞARIDAN verilir;
 * böylece sınama gerçek soket açmadan ve gerçek QR kodlamadan eşleşme/durum/unutma mantığını koşturabilir.
 */

import {
  PAIRING_WINDOW_MS,
  PairingStore,
  PairingWindow,
} from './pairing';
import { DiscoveryBroadcaster, privateBroadcastTargets } from './discovery';
import { XrServer, type XrSession } from './server';
import { deviceKindOf, type XrDeviceKind } from './kind';
import { XR_PORT, buildQrUri, shortFingerprint } from './protocol';

import type { XrConnectionView, XrDeviceView, XrPairingView, XrStatus } from './types';
import type { XrJson } from './protocol';

export type { XrDeviceView, XrPairingView, XrStatus } from './types';

export interface XrBridgeLog {
  info(message: string, extra?: unknown): void;
  warn(message: string, extra?: unknown): void;
  error(message: string, extra?: unknown): void;
}

export interface XrBridgeDeps {
  /** Kalıcı eşleşme deposu (statik anahtar + cihazlar). */
  store: PairingStore;
  /** Gözlükte görünecek bilgisayar adı. */
  pcName: string;
  port?: number;
  /** Yerel IPv4 adres çözücü (varsayılan: özel ağ arayüzleri). Sınamada sabitlenir. */
  hostsOf?: () => string[];
  /** `fuberxr:` içeriğini QR resmine (data URL) çevirir (ana süreçte `qrcode`; sınamada sahte). */
  qrDataUrl: (uri: string) => Promise<string>;
  /** Gerçek soket aç (üretim). Sınamada `false`: ağ açılmaz, durum/eşleşme mantığı yine çalışır. */
  net?: boolean;
  log?: XrBridgeLog;
  /** Durum değişince (bağlanma/kopma/eşleşme) çağrılır; arayüz tazelenir. */
  onChanged?: (connected: string | null) => void;
  /** Bağlı cihazdan gelen iş iletisi (`hud.action`, `bio.*`; `pong` köprüde kalır). */
  onMessage?: (kind: XrDeviceKind, deviceId: string, msg: XrJson) => void;
  /** Bir cihaz (yeniden) bağlandı: ilk anlık görüntü hemen yollanabilsin. */
  onConnected?: (kind: XrDeviceKind, deviceId: string) => void;
  /** Gecikme ölçümü (`ping`) aralığı, ms; 0 = kapalı. Varsayılan 5000. */
  pingEveryMs?: number;
  /** Şimdiki an (sınama için), ms. */
  now?: () => number;
}

const defaultHostsOf = (): string[] => privateBroadcastTargets().map((t) => t.address);

export class XrBridge {
  private server: XrServer | null = null;
  private discovery: DiscoveryBroadcaster | null = null;
  private window: PairingWindow | null = null;
  /** Açık pencere için önceden üretilmiş görünüm (QR data URL eşzamanlı okunabilsin diye). */
  private pairingView: Omit<XrPairingView, 'attemptsLeft'> | null = null;
  /** Bağlı cihazlar, türe göre. `connected` (gözlük) geriye uyum için bundan türetilir. */
  private connections = new Map<XrDeviceKind, string>();
  /** Son ölçülen gidiş-dönüş gecikmesi (ms), cihaz kimliğine göre. */
  private rtt = new Map<string, { ms: number; at: number }>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private error: string | null = null;
  private running = false;

  constructor(private readonly deps: XrBridgeDeps) {}

  private get connected(): string | null {
    return this.connections.get('quest') ?? null;
  }

  private get now(): () => number {
    return this.deps.now ?? Date.now;
  }

  private get port(): number {
    return this.deps.port ?? XR_PORT;
  }

  private hosts(): string[] {
    return (this.deps.hostsOf ?? defaultHostsOf)();
  }

  private changed(): void {
    this.deps.onChanged?.(this.connected);
  }

  /** Açık (süresi geçmemiş, kapanmamış) pencere; yoksa null. */
  private openWindow(): PairingWindow | null {
    if (this.window && this.window.isOpen(this.now())) return this.window;
    return null;
  }

  /** Dinlemeye başlar (gerçek soket). Hata (ör. kapı dolu) uygulamayı çökertmez; `error`'a yazılır. */
  async start(): Promise<void> {
    if (this.running || this.server) return;
    if (this.deps.net === false) {
      // Sınama/ağsız kip: durum mantığı çalışır, soket açılmaz.
      this.running = true;
      return;
    }
    const server = new XrServer({
      pcName: this.deps.pcName,
      store: this.deps.store,
      pairingWindow: () => this.openWindow(),
      features: ['voice', 'dashboard', 'approvals', 'hud', 'bio'],
      onConnect: (session: XrSession) => {
        if (!session.deviceId) return;
        this.connections.set(session.kind, session.deviceId);
        this.deps.log?.info(session.kind === 'watch' ? 'saat bağlandı' : 'gözlük bağlandı', { deviceId: session.deviceId });
        this.changed();
        this.deps.onConnected?.(session.kind, session.deviceId);
      },
      onMessage: (session, msg) => {
        if (msg.t === 'pong') {
          // PC'nin yolladığı `ping`in yankısı: `ts` gönderim anıdır.
          if (typeof msg.ts === 'number' && session.deviceId) this.rtt.set(session.deviceId, { ms: Math.max(0, this.now() - msg.ts), at: this.now() });
          return;
        }
        if (session.deviceId) this.deps.onMessage?.(session.kind, session.deviceId, msg);
      },
      onDisconnect: (session: XrSession, reason: string) => {
        if (session.deviceId && this.connections.get(session.kind) === session.deviceId && !this.server?.sessionOf(session.kind)) {
          this.connections.delete(session.kind);
          this.rtt.delete(session.deviceId);
        }
        this.deps.log?.info(session.kind === 'watch' ? 'saat koptu' : 'gözlük koptu', { deviceId: session.deviceId, reason });
        this.changed();
      },
      onLog: (level, message, extra) => this.deps.log?.[level]?.(message, extra),
    });
    try {
      await server.listen(this.port);
      this.server = server;
      this.running = true;
      this.error = null;
    } catch (e) {
      this.error = `Köprü ${this.port} kapısında dinleyemedi: ${(e as Error).message}`;
      this.deps.log?.error('köprü dinleyemedi', this.error);
      this.running = false;
      return;
    }
    this.discovery = new DiscoveryBroadcaster({
      name: this.deps.pcName,
      fp: this.deps.store.fingerprint,
      state: () => ({ pairingOpen: this.openWindow() !== null, deviceConnected: this.connected !== null }),
      port: this.port,
      onError: (err) => this.deps.log?.warn('keşif yayını hatası', err.message),
    });
    this.discovery.start();
    const every = this.deps.pingEveryMs ?? 5000;
    if (every > 0) {
      this.pingTimer = setInterval(() => this.pingAll(), every);
      this.pingTimer.unref?.();
    }
  }

  /** Bağlı her cihaza `ping` yollar; yankı (`pong`) gecikmeyi verir. */
  pingAll(): void {
    const ts = this.now();
    for (const s of this.server?.sessions() ?? []) s.send({ t: 'ping', ts });
  }

  /** Bağlı cihazlara ileti yollar. `kind` verilirse yalnız o türe. Yollanan cihaz sayısını döner. */
  send(msg: XrJson, kind?: XrDeviceKind): number {
    let n = 0;
    for (const s of this.server?.sessions() ?? []) {
      if (kind && s.kind !== kind) continue;
      s.send(msg);
      n += 1;
    }
    return n;
  }

  /** Bağlı cihazların (tür, kimlik, ad, gecikme) görünümü. */
  connectionsView(): XrConnectionView[] {
    const out: XrConnectionView[] = [];
    for (const [kind, deviceId] of this.connections) {
      const rec = this.deps.store.get(deviceId);
      const r = this.rtt.get(deviceId);
      out.push({ kind, deviceId, name: rec?.name ?? deviceId, model: rec?.model ?? '', latencyMs: r && this.now() - r.at < 30_000 ? r.ms : null });
    }
    return out;
  }

  stop(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.discovery?.stop();
    this.discovery = null;
    this.server?.close();
    this.server = null;
    this.window = null;
    this.pairingView = null;
    this.connections.clear();
    this.rtt.clear();
    this.running = false;
  }

  /** Yeni eşleşme penceresi açar (QR + PIN üretir) ve güncel durumu döndürür. */
  async startPairing(kind: XrDeviceKind = 'quest'): Promise<XrStatus> {
    const window = new PairingWindow(this.now());
    window.forKind = kind;
    const uri = buildQrUri({ hosts: this.hosts(), port: this.port, fp: this.deps.store.fingerprint, code: window.code, name: this.deps.pcName });
    const qr = await this.deps.qrDataUrl(uri);
    this.window = window;
    this.pairingView = { pin: window.pin, qr, uri, forKind: kind, expiresAt: new Date(window.openedAt + PAIRING_WINDOW_MS).toISOString() };
    this.deps.log?.info('eşleşme penceresi açıldı');
    this.changed();
    return this.status();
  }

  /** Açık eşleşme penceresini kapatır. */
  cancelPairing(): XrStatus {
    this.window?.close();
    this.window = null;
    this.pairingView = null;
    this.deps.log?.info('eşleşme iptal edildi');
    this.changed();
    return this.status();
  }

  /** Bir cihazı unutur (kayıt silinir); bağlıysa bağlantısı kapatılır. */
  forget(deviceId: string): XrStatus {
    const removed = this.deps.store.remove(deviceId);
    for (const [kind, id] of [...this.connections]) {
      if (id !== deviceId) continue;
      this.server?.sessionOf(kind)?.bye('forgotten');
      this.connections.delete(kind);
      this.rtt.delete(id);
    }
    if (removed) this.deps.log?.info('cihaz unutuldu', { deviceId });
    this.changed();
    return this.status();
  }

  status(): XrStatus {
    const open = this.openWindow();
    const pairing: XrPairingView | null = open && this.pairingView ? { ...this.pairingView, attemptsLeft: open.attemptsLeft } : null;
    const devices: XrDeviceView[] = this.deps.store.list().map((d) => ({
      deviceId: d.deviceId,
      name: d.name,
      model: d.model,
      pairedAt: d.pairedAt,
      lastSeen: d.lastSeen,
      connected: [...this.connections.values()].includes(d.deviceId),
      kind: deviceKindOf(d.model, d.kind),
    }));
    return {
      running: this.running,
      port: this.port,
      fingerprint: this.deps.store.fingerprint,
      shortFp: shortFingerprint(this.deps.store.fingerprint),
      pcName: this.deps.pcName,
      hosts: this.hosts(),
      devices,
      connected: this.connected,
      watch: this.connections.get('watch') ?? null,
      connections: this.connectionsView(),
      pairing,
      error: this.error,
    };
  }
}

/** Üretim köprüsü: diskteki depo + `qrcode` ile QR. (Ana süreçte `index.ts` kullanır.) */
export function openPairingStore(file: string): PairingStore {
  return PairingStore.open(file);
}
