/**
 * Yedek keşif (`plugins/jarvis-quest/docs/PROTOCOL.md` §5): QR okunamazsa bilgisayar yerel ağa kendini duyurur. UDP 47853.
 *
 * Kural: yayın yalnız eşleşmiş cihaz BAĞLI DEĞİLKEN yapılır; eşleşme penceresi açıkken 2 sn'de bir,
 * değilken 5 sn'de bir (gözlük önceden eşleşmişse bile bilgisayarı listede görebilsin). Yük yalnız ÖZEL ağ IPv4
 * arayüzlerine yollanır (genel adrese sızmaz).
 *
 * SAF çekirdek (adres süzme, yük üretimi) ile ince çalışma zamanı sarmalayıcısı ayrıdır; çekirdek birim sınanır.
 */

import dgram from 'node:dgram';
import os from 'node:os';
import { XR_DISCOVERY_PORT, XR_PORT } from './protocol';

export interface DiscoveryPayload {
  fuberxr: 1;
  name: string;
  p: number;
  f: string;
  /** Eşleşme penceresi açık mı (gözlük "şimdi eşleşebilirim" ayrımı için). */
  pairing: boolean;
}

export function buildDiscoveryPayload(input: { name: string; fp: string; pairing: boolean; port?: number }): Buffer {
  const obj: DiscoveryPayload = { fuberxr: 1, name: input.name, p: input.port ?? XR_PORT, f: input.fp, pairing: input.pairing };
  return Buffer.from(JSON.stringify(obj), 'utf8');
}

/** Özel ağ IPv4 mı? 10/8, 172.16/12, 192.168/16, 169.254/16 (bağlantı-yerel). Genel adresler elenir. */
export function isPrivateIPv4(ip: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return false;
  const o = m.slice(1, 5).map(Number);
  if (o.some((n) => n < 0 || n > 255)) return false;
  const [a, b] = o as [number, number, number, number];
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

export interface BroadcastTarget {
  /** Yayın yapılacak yerel arayüz adresi (bind için). */
  address: string;
  /** Yayın hedef adresi (arayüz yayın adresi; yoksa 255.255.255.255). */
  broadcast: string;
}

/** Yalnız özel, dahili olmayan IPv4 arayüzleri; her biri için yayın hedefi hesaplanır. */
export function privateBroadcastTargets(ifaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces()): BroadcastTarget[] {
  const out: BroadcastTarget[] = [];
  for (const list of Object.values(ifaces)) {
    for (const info of list ?? []) {
      if (info.family !== 'IPv4' || info.internal) continue;
      if (!isPrivateIPv4(info.address)) continue;
      out.push({ address: info.address, broadcast: ipv4Broadcast(info.address, info.netmask) });
    }
  }
  return out;
}

/** Arayüz yayın adresi = adres | ~maske. Maske bozuksa sınırlı yayın (255.255.255.255). */
export function ipv4Broadcast(address: string, netmask: string): string {
  const a = address.split('.').map(Number);
  const m = netmask.split('.').map(Number);
  if (a.length !== 4 || m.length !== 4 || [...a, ...m].some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return '255.255.255.255';
  }
  return a.map((oct, i) => (oct | (~m[i]! & 0xff)) & 0xff).join('.');
}

export interface DiscoveryState {
  /** Pencere açık mı. */
  pairingOpen: boolean;
  /** Eşleşmiş bir gözlük şu an bağlı mı (bağlıysa yayın durur). */
  deviceConnected: boolean;
}

export const DISCOVERY_INTERVAL_PAIRING_MS = 2000;
export const DISCOVERY_INTERVAL_IDLE_MS = 5000;

/**
 * Çalışma zamanı yayıncısı. `start` çağrılınca durum geri çağrımını yoklar; cihaz bağlıysa yayın yapmaz, pencere
 * açıkken 2 sn, değilken 5 sn aralıkla özel arayüzlere yük gönderir. Modül kapanınca `stop`.
 */
export class DiscoveryBroadcaster {
  private socket: dgram.Socket | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly opts: {
      name: string;
      fp: string;
      state: () => DiscoveryState;
      port?: number;
      onError?: (err: Error) => void;
    },
  ) {}

  start(): void {
    if (this.socket) return;
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    sock.on('error', (err) => this.opts.onError?.(err));
    sock.bind(() => {
      try {
        sock.setBroadcast(true);
      } catch (err) {
        this.opts.onError?.(err as Error);
      }
      this.schedule();
    });
    this.socket = sock;
  }

  private schedule(): void {
    const tick = () => {
      const state = this.opts.state();
      if (!state.deviceConnected) this.sendOnce(state.pairingOpen);
      const next = state.pairingOpen ? DISCOVERY_INTERVAL_PAIRING_MS : DISCOVERY_INTERVAL_IDLE_MS;
      this.timer = setTimeout(tick, next);
      // Node'un süreç bitişini engellememesi için.
      this.timer.unref?.();
    };
    tick();
  }

  private sendOnce(pairingOpen: boolean): void {
    const sock = this.socket;
    if (!sock) return;
    const payload = buildDiscoveryPayload({ name: this.opts.name, fp: this.opts.fp, pairing: pairingOpen, port: this.opts.port });
    for (const target of privateBroadcastTargets()) {
      sock.send(payload, 0, payload.length, XR_DISCOVERY_PORT, target.broadcast, (err) => {
        if (err) this.opts.onError?.(err);
      });
    }
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        /* zaten kapalı */
      }
      this.socket = null;
    }
  }
}
