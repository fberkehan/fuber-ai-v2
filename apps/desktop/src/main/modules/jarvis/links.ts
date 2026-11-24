// LINKS: bağlantılar. Gerçek gecikme: servis için TCP 443 bağlanma süresi. Ölçüm yoksa gecikme null (sahte sayı yok). `quality` 0..1: gecikmeden türetilir (≤30 ms ≈ 1,
// ≥600 ms ≈ 0), düşük gecikme iyi.
import net from 'node:net';
import type { HudLinkItem, HudLinks } from './types';

export interface ProbeTarget {
  id: string;
  name: string;
  kind: 'server' | 'service';
  host: string;
  port?: number;
  detail: string;
}

export type TcpProbe = (host: string, port: number, timeoutMs: number) => Promise<number | null>;

/** TCP bağlanma süresi (ms); bağlanamazsa null. */
export const tcpProbe: TcpProbe = (host, port, timeoutMs) =>
  new Promise((resolve) => {
    const start = process.hrtime.bigint();
    const socket = net.connect({ host, port });
    let done = false;
    const end = (v: number | null) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(v);
    };
    socket.setTimeout(timeoutMs, () => end(null));
    socket.once('connect', () => end(Math.max(1, Math.round(Number(process.hrtime.bigint() - start) / 1e6))));
    socket.once('error', () => end(null));
  });

export const qualityOf = (ms: number | null): number => (ms === null ? 0 : Math.max(0, Math.min(1, 1 - (ms - 30) / 570)));

/** Ölçümleri tek `links` bloğuna birleştirir. */
export function buildLinks(servers: Array<ProbeTarget & { ms: number | null }>): HudLinks {
  const items: HudLinkItem[] = servers.map(
    (s): HudLinkItem => ({ id: s.id, name: s.name, kind: s.kind, detail: s.detail, latencyMs: s.ms, quality: qualityOf(s.ms), up: s.ms !== null }),
  );
  return { status: 'ok', linked: items.filter((i) => i.up).length, total: items.length, items };
}

export interface LinksSourceDeps {
  now?: () => number;
  probe?: TcpProbe;
  /** Sunucu hedefleri (uygulamanın bildiği: internet, Yönetim kontrol servisi…). */
  targets: () => ProbeTarget[];
}

export interface LinksSource {
  refresh(force?: boolean): Promise<void>;
  /** Son ölçümler (hedef kimliğine göre). */
  results(): Array<ProbeTarget & { ms: number | null }>;
}

export function createLinksSource(deps: LinksSourceDeps): LinksSource {
  const now = deps.now ?? Date.now;
  const probe = deps.probe ?? tcpProbe;
  let last: Array<ProbeTarget & { ms: number | null }> = [];
  let at = 0;
  let inflight: Promise<void> | null = null;
  return {
    results: () => last,
    async refresh(force = false) {
      if (inflight) return inflight;
      if (!force && now() - at < 4000) return;
      inflight = (async () => {
        const targets = deps.targets();
        last = await Promise.all(targets.map(async (t) => ({ ...t, ms: await probe(t.host, t.port ?? 443, 2500).catch(() => null) })));
        at = now();
        inflight = null;
      })();
      return inflight;
    },
  };
}
