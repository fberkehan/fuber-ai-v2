/**
 * JARVIS MODE modülü: tam ekran holografik HUD'un verisini üretir (`service.ts`) ve HUD'u sesle açıp kapatan aracı
 * (`jarvis_mode`) sağlar. HUD'un gezinme düğmesi, menü öğesi ya da kısayol ipucu YOKTUR: kullanıcı konuşurken
 * "Jarvis moduna geç" der, HUD animasyonla gelir; "Jarvis modunu kapat" der, animasyonla gider (Esc de çıkar).
 *
 * Her saniye tek `HudSnapshot` üretilir:
 *   env  Open-Meteo (`env.ts`)            cal  planner hatırlatıcıları ve görevler (`cal.ts`)
 *   core CPU/RAM/GPU (`core.ts`)          fin  Binance + Yahoo (`fin.ts`)
 *   links TCP 443 gecikmesi (`links.ts`)  log  asistan olayları (`log.ts`)
 * Anlık görüntü renderer'a (`jarvis.snapshot` pencere olayı) gider. Cihaz eklentileri (plugins/jarvis-quest,
 * plugins/jarvis-watch) `jarvis.snapshot` / `jarvis.device` olaylarını dinler ve `jarvis.deviceMessage` ile çekirdeğe yazar.
 *
 * Sınama kipinde kaynaklar sessizdir (ağ/PowerShell/nvidia-smi çağrılmaz); `FUBER2_JARVIS_LIVE=1` ile gerçek kaynaklar açılır.
 */
import os from 'node:os';
import { defineModule, defineTool, nowIso, type ModuleContext } from '@fuber/shared';
import { z } from 'zod';
import { testing } from '../../testing';
import { localeFromZone } from '../dashboard/network';
import { createDashboardStore } from '../dashboard/store';
import { createPlannerRepo } from '../planner/repo';
import { safeFetch } from '../web/net';
import { createCoreSource } from './core';
import { createEnvSource } from './env';
import { createFinSource } from './fin';
import { createLinksSource, type ProbeTarget } from './links';
import { JarvisService, defaultConfig, sanitizeConfig } from './service';
import type { HudJob, HudNotice, JarvisConfig, JarvisState } from './types';

import './types';

export type { HudSnapshot, JarvisConfig, JarvisState } from './types';

const CONFIG_KEY = 'config';
let service: JarvisService | null = null;
let offs: Array<() => void> = [];
/** Bekleyen araç onayları (tool.approval.request/resolve). */
const approvalsPending = new Set<string>();

/** HUD sayfası şu an açık mı (sayfa `jarvis.fullscreen` çağrısıyla bildirir). */
let hudOpen = false;
/** Arka arkaya gelen aç/kapa isteklerini (yankı, çift söz) tek isteğe indirir. */
const TOGGLE_DEBOUNCE_MS = 1500;
let lastToggleAt = 0;
let lastToggleOn: boolean | null = null;

/** HUD'un açık olduğunu ana sürece bildirir (`jarvis.fullscreen` işleyicisi çağırır). */
export function setHudOpen(open: boolean): void {
  hudOpen = open;
}
export function isHudOpen(): boolean {
  return hudOpen;
}

/**
 * `jarvis_mode` aracının kararı (saf; sınanır): açık/kapalı durumuna ve son isteğe göre ne yapılacağı.
 * `emit`: HUD'a olay gönderilsin mi; `text`: asistanın söyleyeceği kısa cümlenin ham maddesi.
 */
export function decideMode(on: boolean, open: boolean, now: number, last: { at: number; on: boolean | null }): { emit: boolean; text: string } {
  if (last.on === on && now - last.at < TOGGLE_DEBOUNCE_MS) return { emit: false, text: on ? 'Jarvis modu zaten açılıyor.' : 'Jarvis modu zaten kapanıyor.' };
  if (on && open) return { emit: false, text: 'Jarvis modu zaten açık.' };
  if (!on && !open) return { emit: false, text: 'Jarvis modu zaten kapalı.' };
  return { emit: true, text: on ? 'Jarvis modu açıldı.' : 'Jarvis modu kapatıldı.' };
}

function build(ctx: ModuleContext): JarvisService {
  const live = !testing.enabled || testing.jarvisLive;
  const moduleOn = (id: string) => ctx.policy.moduleAllowed(id) && !ctx.settings.get().disabledModules.includes(id);
  const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

  const config = {
    load(): JarvisConfig {
      try {
        const row = ctx.db.get<{ value: string }>('SELECT value FROM jarvis_state WHERE key = ?', [CONFIG_KEY]);
        return row ? sanitizeConfig(JSON.parse(row.value)) : defaultConfig();
      } catch {
        return defaultConfig();
      }
    },
    save(next: JarvisConfig): void {
      try {
        ctx.db.run('INSERT INTO jarvis_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [CONFIG_KEY, JSON.stringify(next)]);
      } catch (error) {
        ctx.log.warn('jarvis ayarı yazılamadı', error instanceof Error ? error.message : String(error));
      }
    },
  };

  const hostOf = (url: string): string | null => {
    try {
      return new URL(url).hostname || null;
    } catch {
      return null;
    }
  };

  /** Bağlantı denetimi hedefleri: herkese açık iki ağ ucu ve (yerel değilse) Yönetim kontrol servisi. */
  const targets = (): ProbeTarget[] => {
    const list: ProbeTarget[] = [
      { id: 'net', name: 'İNTERNET', kind: 'service', host: '1.1.1.1', detail: 'CLOUDFLARE 1.1.1.1' },
      { id: 'dns', name: 'DNS', kind: 'service', host: '8.8.8.8', detail: 'GOOGLE 8.8.8.8' },
    ];
    let control: string | null = null;
    try {
      control = hostOf(ctx.policy.status().url);
    } catch {
      control = null;
    }
    const loopback = control === 'localhost' || control === '127.0.0.1' || control === '::1' || control === '[::1]';
    if (control && !loopback && !list.some((t) => t.host === control)) list.push({ id: 'control', name: 'YÖNETİM', kind: 'server', host: control, detail: control.toUpperCase() });
    return list;
  };

  const fetcher = safeFetch;
  return new JarvisService({
    env: createEnvSource({
      fetcher,
      appCity: () => {
        try {
          return createDashboardStore(ctx.db).config().weatherPlace;
        } catch {
          return null;
        }
      },
      zonePlace: () => localeFromZone(zone()).place ?? null,
    }),
    fin: createFinSource({ fetcher }),
    core: createCoreSource(live ? {} : { run: () => Promise.reject(new Error('sınama kipi')) }),
    links: createLinksSource({ targets }),
    config,
    reads: {
      cal: () => {
        const planner = moduleOn('planner');
        const safe = <T,>(f: () => T, d: T): T => {
          try {
            return f();
          } catch {
            return d;
          }
        };
        return {
          reminders: planner ? safe(() => createPlannerRepo(ctx).listReminders(), null) : null,
          todos: planner ? safe(() => createPlannerRepo(ctx).listTodos(false), []) : null,
        };
      },
      notices: (): HudNotice[] => {
        try {
          return ctx.attention.recent(12).map((n) => ({
            ref: `notice:${n.id}`,
            ts: n.createdAt,
            title: n.title,
            body: n.body.replace(/\s+/g, ' ').trim().slice(0, 200),
            moduleId: n.moduleId,
            pending: n.status === 'pending' || n.status === 'shown',
            priority: n.priority,
          }));
        } catch {
          return [];
        }
      },
      jobs: (): HudJob[] => {
        try {
          return [...ctx.jobs.list({ status: 'running', limit: 8 }), ...ctx.jobs.list({ status: 'queued', limit: 4 })].map((j) => ({
            id: `job:${j.id}`,
            title: j.title,
            moduleId: j.moduleId,
            status: j.status === 'queued' ? ('queued' as const) : ('running' as const),
            startedAt: j.startedAt,
          }));
        } catch {
          return [];
        }
      },
      address: () => ctx.settings.get().userAddress,
      approvals: () => approvalsPending.size,
    },
    targets,
    emit: (snapshot) => ctx.bus.emit('jarvis.snapshot', { snapshot }),
    publish: (msg) => ctx.bus.emit('jarvis.device', { msg }),
    panic: () => ctx.bus.emit('app.panic', { at: nowIso(), source: 'ui' }),
    navigate: (page) => ctx.bus.emit('app.navigate', { page }),
    node: (os.hostname() || 'PC').toUpperCase(),
    live,
  });
}

const state = (svc: JarvisService): JarvisState => ({ snapshot: svc.get(), config: svc.getConfig() });

export default defineModule({
  id: 'jarvis',
  version: '2.0.0',
  nameKey: 'module.jarvis.name',
  descriptionKey: 'module.jarvis.description',
  permissions: ['net'],
  migrations: [{ id: 1, name: 'jarvis_state tablosu', up: 'CREATE TABLE IF NOT EXISTS jarvis_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)' }],
  // Bilerek `page` YOK: sol rayda düğme çıkmaz. Sayfa (renderer: pages/jarvis) gizlidir ve yalnız `jarvis_mode` ile açılır.
  windowEvents: ['jarvis.snapshot', 'jarvis.mode'],

  tools: [
    defineTool({
      name: 'jarvis_mode',
      group: 'settings',
      description:
        'JARVIS MODE\'u (tam ekran holografik gösterge) açar ya da kapatır. Kullanıcı "Jarvis moduna geç", "Jarvis modunu aç", "JARVIS modu", ' +
        '"Jarvis moduna gir" derse on=true; "Jarvis modunu kapat", "Jarvis modundan çık", "normal moda dön" derse on=false ile çağır. ' +
        'İngilizce: "Jarvis mode on/off", "enter/exit Jarvis mode". Yalnız KULLANICI böyle söylerse kullan; kendi cümlende geçti diye çağırma.',
      input: z.object({ on: z.boolean().describe('true: aç, false: kapat') }),
      risk: 'read',
      async run({ on }, ctx) {
        const now = Date.now();
        const decision = decideMode(on, hudOpen, now, { at: lastToggleAt, on: lastToggleOn });
        if (decision.emit) {
          lastToggleAt = now;
          lastToggleOn = on;
          ctx.bus.emit('jarvis.mode', { on });
        }
        return { ok: true, text: `${decision.text} Kullanıcıya yalnız bunu kısaca söyle: "${decision.text}"` };
      },
    }),
  ],

  ipc: () => ({
    'jarvis.get': () => state(service!),
    'jarvis.setTab': ({ tab }) => {
      service!.setTab(tab);
      return state(service!);
    },
    'jarvis.setPalette': ({ palette }) => {
      service!.setPalette(palette);
      return state(service!);
    },
    'jarvis.setConfig': (patch) => {
      service!.setConfig(patch);
      return state(service!);
    },
  }),

  async setup(ctx) {
    const svc = build(ctx);
    service = svc;
    hudOpen = false;
    lastToggleAt = 0;
    lastToggleOn = null;
    const log = svc.log;
    const tagOf = (moduleId: string) => (moduleId === 'planner' ? 'CAL' : moduleId === 'selfdev' || moduleId === 'workshop' ? 'SYS' : 'MSG');
    offs = [
      ctx.bus.on('jarvis.deviceMessage', ({ kind, msg }) => svc.onDeviceMessage(kind, msg)),
      ctx.bus.on('attention.notify', ({ notification: n }) => void log.add(tagOf(n.moduleId), n.title, `notice:${n.id}`)),
      ctx.bus.on('brain.status', (b) => {
        const text = b.provider === 'cloud' ? 'Beyin: bulut çalışıyor.' : b.provider === 'local' ? 'Beyin: yerel modele geçildi.' : 'Beyin kullanılamıyor.';
        log.add('SYS', text);
      }),
      ctx.bus.on('job.progress', ({ job }) => {
        if (job.status === 'done') log.add('SYS', `İş bitti: ${job.title}`, `job:${job.id}`);
        else if (job.status === 'failed') log.add('SYS', `İş başarısız: ${job.title}`, `job:${job.id}`);
      }),
      ctx.bus.on('tool.approval.request', (a) => {
        approvalsPending.add(a.id);
        log.add('SYS', `Onay bekleniyor: ${a.summary}`);
      }),
      ctx.bus.on('tool.approval.resolve', ({ id }) => void approvalsPending.delete(id)),
      ctx.bus.on('voice.state', ({ state }) => svc.onVoiceState(state)),
      ctx.bus.on('voice.level', ({ source, rms }) => svc.onVoiceLevel(source, rms)),
      ctx.bus.on('voice.partial', ({ role, text, final }) => {
        if (role === 'assistant' && !final) svc.onVoiceText(text);
      }),
      ctx.bus.on('voice.wake', () => void log.add('SYS', 'Uyandırma sözü duyuldu.')),
      ctx.bus.on('app.panic', ({ source }) => void log.add('SYS', `Acil durdurma çalıştı (${source}).`)),
    ];
    approvalsPending.clear();
    svc.start();
    testing.expose({
      jarvis: {
        snapshot: () => svc.get(),
        tick: () => svc.tick(true),
        config: () => svc.getConfig(),
        /** Cihaz eklentisi iletisi taklidi: `{ t: 'hud.action', action: 'tab', tab: 'workshop' }` (sınama). */
        device: (kind: string, msg: Record<string, unknown>) => svc.onDeviceMessage(kind, msg),
        /** Ses durumu/seviyesi taklidi (yalnız sınama; gerçek ses katmanı olayları `voice.*` ile aynı yoldan). */
        voice: (voiceState: string, text?: string) => {
          if (text) svc.onVoiceText(text);
          svc.onVoiceState(voiceState);
        },
        voiceLevel: (source: 'mic' | 'speaker', rms: number) => svc.onVoiceLevel(source, rms),
        resetAuto: () => svc.resetAutoPalette(),
        /** Bekleyen onay sayısını taklit et (yoğunluk sınaması). */
        approvals: (n: number) => {
          approvalsPending.clear();
          for (let i = 0; i < n; i += 1) approvalsPending.add(`sim${i}`);
        },
        log: (tag: string, text: string) => void log.add(tag, text),
      },
    });
  },

  teardown() {
    service?.stop();
    service = null;
    hudOpen = false;
    for (const off of offs) off();
    offs = [];
  },
});
