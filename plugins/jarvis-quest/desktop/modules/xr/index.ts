/**
 * XR (Quest 3) köprü modülü: gözlükteki Fuber uygulamasının bu bilgisayarla eşleşip (QR + PIN) şifreli konuşmasını
 * sağlar. Ağ/kripto mantığı `protocol.ts` + `pairing.ts` + `server.ts` + `discovery.ts` dosyalarında (birim sınamalı,
 * `plugins/jarvis-quest/docs/PROTOCOL.md`); bu dosya onları `bridge.ts` ile tek yaşam döngüsüne bağlar ve arayüze IPC açar.
 *
 * Varsayılan AÇIK modül (Yönetim › Modüller'den kapatılabilir): kapalıyken hiçbir kapı dinlenmez. Açıkken TCP 47852
 * dinlenir (yalnız QR/PIN ile eşleşmiş cihaz şifreli oturum açabilir), UDP 47853 keşif yayını yapılır; "VR" sayfasından eşleşme penceresi (QR + 6 haneli PIN) açılır.
 */

import os from 'node:os';
import nodePath from 'node:path';
import QRCode from 'qrcode';
import { defineModule, type ModuleContext } from '@fuber/shared';
import { testing } from '../../testing';
import { XrBridge } from './bridge';
import { PairingStore } from './pairing';
import { HudForwarder } from './hud-forward';
import type { XrJson } from './protocol';

import type { XrStatus } from './types';

import './types';

export type { XrStatus, XrDeviceView, XrPairingView, XrConnectionView } from './types';

/** QR içeriğini (`fuberxr:`) data URL'e çevirir. Hata düzeltme M: PROTOCOL.md §5: 213 bayt / sürüm 10 varsayımıyla uyumlu. */
const qrDataUrl = (uri: string): Promise<string> =>
  QRCode.toDataURL(uri, { errorCorrectionLevel: 'M', margin: 1, scale: 6, color: { dark: '#000000', light: '#ffffff' } });

let bridge: XrBridge | null = null;
let offSend: (() => void) | null = null;
let offForward: Array<() => void> = [];

/** Köprünün şu anki durumu (başka modüller okur); köprü kurulmamışsa null. */
export function xrSnapshot(): XrStatus | null {
  return bridge ? bridge.status() : null;
}

function ensureBridge(ctx: ModuleContext): XrBridge {
  if (bridge) return bridge;
  const file = nodePath.join(ctx.paths.data, 'xr', 'pairing.json');
  const store = testing.enabled ? PairingStore.ephemeral() : PairingStore.open(file);
  bridge = new XrBridge({
    store,
    pcName: os.hostname() || 'Fuber',
    qrDataUrl,
    net: !testing.enabled,
    log: {
      info: (message, extra) => ctx.log.info(message, extra),
      warn: (message, extra) => ctx.log.warn(message, extra),
      error: (message, extra) => ctx.log.error(message, extra),
    },
    onChanged: () => {
      const st = bridge?.status();
      ctx.bus.emit('xr.changed', { connected: st?.connected ?? null, watch: st?.watch ?? null, connections: st?.connections ?? [] });
    },
    onMessage: (kind, deviceId, msg) => ctx.bus.emit('xr.message', { kind, deviceId, msg }),
    onConnected: (kind, deviceId) => ctx.bus.emit('xr.connected', { kind, deviceId }),
  });
  offSend?.();
  offSend = ctx.bus.on('xr.send', ({ kind, msg }) => void bridge?.send(msg as XrJson, kind));
  return bridge;
}

export default defineModule({
  id: 'xr',
  version: '1.0.0',
  nameKey: 'module.xr.name',
  descriptionKey: 'module.xr.description',
  permissions: [],
  // Sol rayda "VR" sayfası (renderer: pages/xr). Modül kapalıyken sayfa görünmez.
  page: { id: 'xr', icon: 'Cube', order: 74 },
  windowEvents: ['xr.changed'],

  ipc: (ctx) => ({
    'xr.status': () => ensureBridge(ctx).status(),
    'xr.startPairing': ({ kind }) => ensureBridge(ctx).startPairing(kind),
    'xr.cancelPairing': () => ensureBridge(ctx).cancelPairing(),
    'xr.forget': ({ deviceId }) => ensureBridge(ctx).forget(deviceId),
  }),

  async setup(ctx) {
    await ensureBridge(ctx).start();
    // JARVIS HUD ↔ Quest: çekirdek Quest'i tanımaz, olaylar üzerinden konuşuruz (`hud-forward.ts`).
    const forwarder = new HudForwarder({
      now: () => Date.now(),
      questUp: () => (bridge?.status().connected ?? null) !== null,
      send: (msg) => void bridge?.send(msg as XrJson, 'quest'),
      emitAction: (kind, msg) => ctx.bus.emit('jarvis.deviceMessage', { kind, msg }),
    });
    offForward = [
      ctx.bus.on('jarvis.snapshot', ({ snapshot }) => forwarder.onSnapshot(snapshot)),
      ctx.bus.on('jarvis.device', ({ msg }) => forwarder.onDeviceMessage(msg)),
      ctx.bus.on('xr.message', ({ kind, msg }) => forwarder.onXrMessage(kind, msg)),
      ctx.bus.on('xr.connected', ({ kind }) => {
        if (kind === 'quest') forwarder.onQuestConnected();
      }),
    ];
  },

  async teardown() {
    for (const off of offForward) off();
    offForward = [];
    offSend?.();
    offSend = null;
    bridge?.stop();
    bridge = null;
  },
});
