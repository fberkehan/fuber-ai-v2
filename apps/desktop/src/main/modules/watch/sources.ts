// Yerleşik gözcü kaynakları. Hepsi YAPAY ZEKÂSIZ: okur, sadeleştirir, imza üretir.
//   time    saat/zaman: tam vaktinde "şimdi" der (koşul yok)
//   page    web sayfası: web modülünün güvenli ağ kapısıyla (SSRF korumalı) okunur, görünen metnin imzası
//   file    dosya ya da klasör: var/yok, boyut, değişme anı, içerik özeti; klasörde dosya listesi
//   window  açık pencere ya da tarayıcı sekmesi metni: bilgisayar modülünün OKUMA aracıyla; okuma izni kapalıysa yok
//   claude  Claude Code oturumu bitti: projeler modülünün `projects.claudeEvent` olaylarından (olay kaynağı)
// E-posta gibi başka kaynaklar kendi modüllerinden `watch.sources.collect` olayıyla takılır (`types.ts` › WatchSourceDef).
import fs from 'node:fs';
import os from 'node:os';
import nodePath from 'node:path';
import { foldForSearch, t, type Bus, type ToolOrigin, type ToolRegistry } from '@fuber/shared';
import { blockedReason, checkPathText } from '../documents/access';
import { extractBlocks, readableFromPlain } from '../web/html';
import { checkUrl, decodeBody, FetchBlockedError, FetchFailedError, type Fetcher } from '../web/net';
import { signatureOf } from './rules';
import type { WatchProbe, WatchSourceDef } from './types';

const clip = (text: string, n: number) => {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
};

// ───────────────────────────── saat ─────────────────────────────

/** Saat kaynağı: hedef ISO an. Vakti gelince `fire`; gelmeden `wakeAt` ile tam vaktine kurulur. */
export function timeSource(now: () => number): WatchSourceDef {
  return {
    kind: 'time',
    moduleId: 'watch',
    label: t('watch.source.time'),
    targetHint: t('watch.source.timeHint'),
    mode: 'state',
    minIntervalSec: 10,
    maxIntervalSec: 3600,
    normalize(target) {
      const at = Date.parse(target.trim());
      if (!/^\d{4}-\d{2}-\d{2}T/.test(target.trim()) || !Number.isFinite(at)) return { error: t('watch.error.timeFormat') };
      if (at <= now()) return { error: t('watch.error.timePast') };
      return { target: new Date(at).toISOString() };
    },
    describe: (target) => {
      const date = new Date(target);
      return t('watch.source.timeDescribe', { at: `${date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' })} ${date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}` });
    },
    async check({ target }) {
      const at = Date.parse(target);
      if (now() >= at) return { signature: 'due', text: '', fire: true, finding: t('watch.finding.time') };
      return { signature: 'wait', text: '', wakeAt: at };
    },
  };
}

// ───────────────────────────── web sayfası ─────────────────────────────

const PAGE_MAX_BYTES = 1_500_000;

/** Sayfanın görünen metni: betik/stil/gezinme ayıklanmış bloklar (kısa satırlar da kalır: "Stokta var" önemlidir). */
export function pageText(body: string, contentType: string): string {
  if (/html|xhtml/.test(contentType) || /^\s*</.test(body)) {
    let blocks = extractBlocks(body).blocks;
    if (blocks.reduce((sum, block) => sum + block.text.length, 0) < 40) blocks = extractBlocks(body, { classNoise: false }).blocks;
    return blocks.map((block) => block.text).filter(Boolean).join('\n');
  }
  return readableFromPlain(body).text;
}

export interface PageSourceDeps {
  fetcher: Fetcher;
  /** Gizli kipte ağa çıkılmaz (`policy.networkAllowed`). */
  networkAllowed(): boolean;
  /** Sınamada geri döngüdeki sahte sunucuya izin (yalnız `testing`). */
  checkTarget?(url: string): URL;
}

export function pageSource(deps: PageSourceDeps): WatchSourceDef {
  const check = deps.checkTarget ?? ((url: string) => checkUrl(url));
  return {
    kind: 'page',
    moduleId: 'watch',
    label: t('watch.source.page'),
    targetHint: t('watch.source.pageHint'),
    mode: 'state',
    minIntervalSec: 60,
    maxIntervalSec: 1800,
    available: () => (deps.networkAllowed() ? null : t('watch.source.pagePrivate')),
    normalize(target) {
      const raw = target.trim();
      try {
        return { target: check(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`).toString() };
      } catch (error) {
        return { error: error instanceof FetchBlockedError ? t('watch.error.urlBlocked', { url: clip(raw, 120) }) : t('watch.error.url', { url: clip(raw, 120) }) };
      }
    },
    describe(target) {
      try {
        const url = new URL(target);
        const path = url.pathname.length > 1 ? clip(url.pathname, 40) : '';
        return t('watch.source.pageDescribe', { host: url.hostname.replace(/^www\./, ''), path });
      } catch {
        return clip(target, 80);
      }
    },
    async check({ target, signal }) {
      if (!deps.networkAllowed()) throw new Error(t('watch.source.pagePrivate'));
      const response = await deps.fetcher(target, { timeoutMs: 20_000, maxBytes: PAGE_MAX_BYTES, signal });
      if (response.status >= 400) throw new FetchFailedError('status', t('watch.error.httpStatus', { status: response.status }), response.status);
      const text = pageText(decodeBody(response), response.contentType || 'text/html');
      return { signature: signatureOf(text), text };
    },
  };
}

// ───────────────────────────── dosya / klasör ─────────────────────────────

const TEXT_FILE = /\.(txt|log|csv|tsv|json|md|xml|html?|ini|ya?ml)$/i;
const TEXT_READ_LIMIT = 256 * 1024;
const LIST_LIMIT = 500;

export interface FileSourceDeps {
  /** Uygulamanın kendi veri klasörü (izlenmez). */
  dataDir: string;
  home?: string;
}

/** Sesle söylenen bilinen klasörler ("İndirilenler", "Masaüstü\Faturalar") kullanıcı profilindeki yerine çevrilir. */
const KNOWN_FOLDERS: Record<string, string> = {
  masaustu: 'Desktop',
  desktop: 'Desktop',
  belgeler: 'Documents',
  belgelerim: 'Documents',
  documents: 'Documents',
  indirilenler: 'Downloads',
  indirmeler: 'Downloads',
  downloads: 'Downloads',
};

export function expandKnownFolder(raw: string, home: string): string {
  const value = raw.trim().replace(/^["']|["']$/g, '');
  const [head = '', ...rest] = value.split(/[\\/]+/);
  const known = KNOWN_FOLDERS[foldForSearch(head).replace(/\s+/g, '')];
  if (known) return nodePath.join(home, known, ...rest);
  if (head === '~') return nodePath.join(home, ...rest);
  return value;
}

/** Yol izlenebilir mi: belge modülünün kapısıyla aynı yasaklar (sistem klasörü, AppData, anahtar ve parola dosyaları). */
export function fileTargetCheck(raw: string, deps: FileSourceDeps): { target: string } | { error: string } {
  const text = checkPathText(expandKnownFolder(raw, deps.home ?? os.homedir()), process.platform);
  if (!text.ok) return { error: text.reason };
  const blocked = blockedReason(text.path, { platform: process.platform, home: deps.home ?? os.homedir(), readRoots: () => [], extraBlocked: [deps.dataDir] });
  if (blocked) return { error: t('watch.error.pathBlocked', { reason: blocked }) };
  return { target: text.path };
}

function fileProbe(target: string): WatchProbe {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(target);
  } catch {
    return { signature: 'missing', text: '', finding: t('watch.finding.fileMissing', { name: nodePath.basename(target) }) };
  }
  if (stat.isDirectory()) {
    const entries = fs
      .readdirSync(target, { withFileTypes: true })
      .slice(0, LIST_LIMIT)
      .map((entry) => {
        try {
          const inner = fs.statSync(nodePath.join(target, entry.name));
          return `${entry.name}${entry.isDirectory() ? '\\' : ''} ${inner.size} ${Math.round(inner.mtimeMs)}`;
        } catch {
          return entry.name;
        }
      })
      .sort();
    // Koşullar dosya ADLARINA bakar; boyut ve an yalnız imzaya girer (değişen dosya da "değişiklik"tir).
    const names = entries.map((line) => line.split(' ')[0]!).join('\n');
    return { signature: signatureOf(entries.join('\n')), text: names };
  }
  const name = nodePath.basename(target);
  let content = '';
  if (TEXT_FILE.test(name) && stat.size <= TEXT_READ_LIMIT) {
    try {
      content = fs.readFileSync(target, 'utf8');
    } catch {
      content = '';
    }
  }
  const head = `${name} ${stat.size}`;
  return { signature: signatureOf(`${head} ${Math.round(stat.mtimeMs)} ${content}`), text: content ? `${name}\n${content}` : name };
}

export function fileSource(deps: FileSourceDeps): WatchSourceDef {
  return {
    kind: 'file',
    moduleId: 'watch',
    label: t('watch.source.file'),
    targetHint: t('watch.source.fileHint'),
    mode: 'state',
    minIntervalSec: 15,
    maxIntervalSec: 900,
    normalize: (target) => fileTargetCheck(target, deps),
    describe: (target) => t('watch.source.fileDescribe', { name: clip(nodePath.basename(target) || target, 60), folder: clip(nodePath.dirname(target), 60) }),
    async check({ target, previous }) {
      const again = fileTargetCheck(target, deps);
      if ('error' in again) throw new Error(again.error);
      const probe = fileProbe(target);
      // Var olmayan → var: "oluştu"; var → yok: "silindi". Değişiklik anlatımı kaynağın kendisinden gelir.
      if (previous === 'missing' && probe.signature !== 'missing') return { ...probe, finding: t('watch.finding.fileCreated', { name: nodePath.basename(target) }) };
      if (previous !== null && previous !== 'missing' && probe.signature === 'missing') return probe;
      return { signature: probe.signature, text: probe.text };
    },
  };
}

// ───────────────────────────── pencere / sekme ─────────────────────────────

export interface WindowSourceDeps {
  tools: Pick<ToolRegistry, 'has' | 'run'>;
  origin(): ToolOrigin;
}

/** Bilgisayar modülünün okuma aracının çıktısından güvenilmez çerçeve satırlarını atar (imza içeriğe baksın). */
function windowBody(text: string): string {
  const markers = new Set([t('pc.untrusted.begin').trim(), t('pc.untrusted.end').trim()]);
  return text
    .split(/\r?\n/)
    .filter((line) => !markers.has(line.trim()))
    .join('\n')
    .trim();
}

export function windowSource(deps: WindowSourceDeps): WatchSourceDef {
  return {
    kind: 'window',
    moduleId: 'watch',
    label: t('watch.source.window'),
    targetHint: t('watch.source.windowHint'),
    mode: 'state',
    minIntervalSec: 30,
    maxIntervalSec: 900,
    available: () => (deps.tools.has('pc_read_window') ? null : t('watch.source.windowOff')),
    normalize: (target) => (target.trim() ? { target: target.trim().slice(0, 120) } : { error: t('watch.error.windowEmpty') }),
    describe: (target) => t('watch.source.windowDescribe', { title: clip(target, 60) }),
    async check({ target, signal }) {
      if (!deps.tools.has('pc_read_window')) throw new Error(t('watch.source.windowOff'));
      const result = await deps.tools.run('pc_read_window', { window: target, max_chars: 6000 }, { origin: deps.origin(), signal });
      if (!result.ok) throw new Error(result.text);
      const text = windowBody(result.text);
      return { signature: signatureOf(text), text };
    },
  };
}

// ───────────────────────────── Claude Code ─────────────────────────────

/** Bir canlı oturumun bitişi (projeler modülünün `status` olayından). */
interface Finish {
  /** Canlı oturumun kimliği (projeler modülünün duyurusuyla eşleştirmek için). */
  id: string;
  at: number;
  project: string;
  title: string;
  status: string;
}

const RUNNING = new Set(['queued', 'running', 'permission']);
const FINISHED = new Set(['done', 'stopped', 'error', 'limit']);

/**
 * Claude Code kaynağı: projeler modülü oturum durumlarını `projects.claudeEvent` ile yayınlar; çalışan bir oturum
 * `done/stopped/error/limit`e geçince bir "bitiş" kaydedilir. Hedef proje adıdır (boş = hangisi olursa).
 * Uygulama yeniden açılınca bellek boştur: önceki oturumun bitişleri sayılmaz (oturumlar da kapanırken sonlanır).
 */
/**
 * Projeler modülü bir oturumun bitişini ~1,2 sn sonra bildirir (araya giren ileti yeni tur açarsa "bitti" denmesin diye
 * bekler); iş ise bitişi hemen görür. İş, haber vermeden önce bu kadar bekler: duyuru geldiyse kendi bildirimini göndermez.
 */
const CLAUDE_ANNOUNCE_WAIT_MS = 4_000;

export function claudeSource(bus: Bus, now: () => number, options: { announceWaitMs?: number } = {}): WatchSourceDef & { dispose(): void } {
  const announceWaitMs = options.announceWaitMs ?? CLAUDE_ANNOUNCE_WAIT_MS;
  const finishes: Finish[] = [];
  /** Projeler modülünün kullanıcıya DUYURDUĞU bitişler: canlı oturum kimliği → duyuru anı. */
  const announced = new Map<string, number>();
  const announceWaiters = new Set<() => void>();
  const lastStatus = new Map<string, string>();
  const pokes = new Set<{ target: string; poke: () => void }>();
  const matches = (finish: Finish, target: string) => {
    const want = foldForSearch(target.trim());
    return !want || foldForSearch(finish.project).includes(want) || foldForSearch(finish.title).includes(want);
  };
  // Olay projeler modülünündür; o modülün tiplerine bağlanmamak için yük gevşek okunur (modül kapalıysa hiç gelmez).
  const listen = bus.on as unknown as (type: string, handler: (payload: unknown) => void) => () => void;
  const off = listen('projects.claudeEvent', (envelope) => {
    const event = (envelope as { event?: { type?: string; summary?: { id?: string; status?: string; projectName?: string; title?: string } } })?.event;
    if (event?.type !== 'status' || !event.summary?.id || !event.summary.status) return;
    const { id, status } = event.summary;
    const before = lastStatus.get(id);
    lastStatus.set(id, status);
    // Yalnız ÇALIŞIRKEN görülen oturumun bitişi sayılır (açılıştaki anlık durum ya da aynı bitişin yinelenmesi sayılmaz).
    if (!FINISHED.has(status) || before === undefined || !RUNNING.has(before)) return;
    const finish: Finish = { id, at: now(), project: event.summary.projectName ?? '', title: event.summary.title ?? '', status };
    finishes.push(finish);
    if (finishes.length > 200) finishes.splice(0, finishes.length - 200);
    for (const entry of pokes) if (matches(finish, entry.target)) entry.poke();
  });
  const offAnnounced = listen('projects.claudeAnnounced', (payload) => {
    const liveId = (payload as { liveId?: string })?.liveId;
    if (!liveId) return;
    announced.set(liveId, now());
    if (announced.size > 200) announced.delete(announced.keys().next().value!);
    for (const wake of [...announceWaiters]) wake();
  });
  /** Bitişi projeler modülü duyurdu mu (bitişten sonra gelen duyuru sayılır; eski bir turun duyurusu sayılmaz). */
  const isAnnounced = (finish: Finish) => (announced.get(finish.id) ?? -1) >= finish.at;
  /** Verilen bitişlerin HEPSİ duyurulana ya da bekleme süresi dolana dek bekler; hepsi duyurulduysa `true`. */
  const waitAnnounced = (list: Finish[]): Promise<boolean> =>
    new Promise((resolve) => {
      if (list.every(isAnnounced)) return resolve(true);
      if (announceWaitMs <= 0) return resolve(false);
      const done = (value: boolean) => {
        clearTimeout(timer);
        announceWaiters.delete(wake);
        resolve(value);
      };
      const wake = () => {
        if (list.every(isAnnounced)) done(true);
      };
      const timer = setTimeout(() => done(list.every(isAnnounced)), announceWaitMs);
      (timer as { unref?: () => void }).unref?.();
      announceWaiters.add(wake);
    });
  const statusText = (status: string) => t(`watch.claude.${status}`);
  return {
    kind: 'claude',
    moduleId: 'watch',
    label: t('watch.source.claude'),
    targetHint: t('watch.source.claudeHint'),
    mode: 'events',
    minIntervalSec: 30,
    maxIntervalSec: 600,
    available: () => null,
    normalize: (target) => ({ target: target.trim().slice(0, 80) }),
    describe: (target) => (target.trim() ? t('watch.source.claudeDescribe', { project: clip(target, 60) }) : t('watch.source.claudeAny')),
    async check({ target, previous, since }) {
      const after = Math.max(since, Number(previous) || 0);
      const fresh = finishes.filter((finish) => finish.at > after && matches(finish, target));
      if (!fresh.length) return { signature: previous ?? String(since), text: '' };
      const text = fresh.map((finish) => `${finish.project || finish.title}: ${statusText(finish.status)}`).join('\n');
      // Aynı bitişi projeler modülü kendi bildirimiyle (özet, "Aç", ses) duyuruyorsa iş ikinci bildirimi göndermez.
      return { signature: String(fresh[fresh.length - 1]!.at), text, finding: clip(text, 300), announcedElsewhere: waitAnnounced(fresh) };
    },
    subscribe(target, poke) {
      const entry = { target, poke };
      pokes.add(entry);
      return () => pokes.delete(entry);
    },
    dispose() {
      off();
      offAnnounced();
      for (const wake of [...announceWaiters]) wake();
      announceWaiters.clear();
    },
  };
}
