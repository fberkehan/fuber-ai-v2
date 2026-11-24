/**
 * Varlık algısı (KURGU §8): kullanıcı şu an ne durumda? Tam ekran oyun/sunum, toplantı (kamera ya da mikrofon
 * başka uygulamada), sessiz saat / rahatsız etme, uzakta. Dikkat Yöneticisi ve pencere katmanı buna göre davranır.
 * 2 saniyede bir yoklar (kayıt defteri taraması daha seyrek) ve yalnız durum değişince `presence.changed` yayınlar.
 */

import { powerMonitor } from 'electron';
import path from 'node:path';
import {
  isWithinLocalTimeRange,
  nowIso,
  type PresenceApi,
  type PresenceState,
  type ServiceDeps,
  type Settings,
  type Unsubscribe,
} from '@fuber/shared';
import { loadWin32Probe, QUNS, type ForegroundInfo, type Win32Probe } from './presence-win32';

const POLL_MS = 2000;
/** Kamera/mikrofon kaydı her bu kadar yoklamada bir okunur (kayıt defteri taraması + gerekirse süreç listesi). */
const MEDIA_EVERY = 3;
/** Bu kadar süre girdi yoksa kullanıcı "uzakta" sayılır. */
export const AWAY_AFTER_SECONDS = 300;

/** Bir yoklamanın ham ölçümleri. */
export interface PresenceReadings {
  /** `SHQueryUserNotificationState` sonucu; okunamadıysa `null`. */
  notificationState: number | null;
  /** Ön pencere bulunduğu monitörü başlıksız olarak tamamen kaplıyor. */
  foregroundFullscreen: boolean;
  idleSeconds: number;
  /** Kamerayı / mikrofonu şu an kullanan uygulamalar (paket adı ya da exe yolu). */
  cameraUsers: string[];
  micUsers: string[];
  /** Oturum kilitli. */
  locked: boolean;
}

/** Kendi uygulamamız ve v1 (`Fuber AI.exe`): mikrofonu bunların kullanması "toplantı" değildir. */
export function isOwnApp(user: string, ownExe: string): boolean {
  const normalized = user.toLowerCase();
  if (normalized === ownExe.toLowerCase()) return true;
  const base = normalized.slice(normalized.lastIndexOf('\\') + 1);
  return base === 'fuber ai.exe' || base === 'fuber ai 2.exe';
}

function dndActive(settings: Settings, now: Date): boolean {
  if (!settings.dnd) return false;
  return settings.dndUntil === null || now.getTime() < Date.parse(settings.dndUntil);
}

/** Ölçümlerden ve ayarlardan durumu türetir. Öncelik: tam ekran > toplantı > sessiz > uzakta > normal. */
export function derivePresence(
  readings: PresenceReadings,
  settings: Settings,
  now: Date,
  ownExe: string,
): Omit<PresenceState, 'since'> {
  const state = readings.notificationState;
  // Kilitli oturumda ön pencere kilit ekranıdır; tam ekran uygulama sayılmaz.
  const absent = readings.locked || state === QUNS.notPresent;
  const fullscreen =
    !absent &&
    (state === QUNS.busy || state === QUNS.d3dFullScreen || state === QUNS.presentation || readings.foregroundFullscreen);
  const cameraInUse = readings.cameraUsers.some((user) => !isOwnApp(user, ownExe));
  const micInUseByOther = readings.micUsers.some((user) => !isOwnApp(user, ownExe));
  const meeting = cameraInUse || micInUseByOther;
  const quietHours = settings.quietHours.enabled && isWithinLocalTimeRange(now, settings.quietHours.from, settings.quietHours.to);
  const quiet = state === QUNS.quietTime || dndActive(settings, now) || quietHours;
  const away = absent || readings.idleSeconds >= AWAY_AFTER_SECONDS;
  const mode = fullscreen ? 'fullscreen' : meeting ? 'meeting' : quiet ? 'quiet' : away ? 'away' : 'normal';
  return { mode, fullscreen, meeting, cameraInUse, micInUseByOther, quiet, idleSeconds: Math.round(readings.idleSeconds) };
}

const STABLE_KEYS = ['mode', 'fullscreen', 'meeting', 'cameraInUse', 'micInUseByOther', 'quiet'] as const;

/** Tanı için ham ölçümler (Ayarlar › Tanı ve uçtan uca sınama raporu). Ölçüm yapılamıyorsa `null`. */
export interface PresenceDiagnostics {
  readings: PresenceReadings;
  foreground: ForegroundInfo;
}

const diagnostics = new WeakMap<PresenceApi, () => PresenceDiagnostics | null>();

export function presenceDiagnostics(presence: PresenceApi): PresenceDiagnostics | null {
  return diagnostics.get(presence)?.() ?? null;
}

export interface PresenceOptions {
  /** Ölçüm kaynağı. Varsayılan: koffi ile Windows; `null` ölçümsüz çalışır. */
  loadProbe?(): Promise<Win32Probe | null>;
  /** Oturum kilidi olaylarının kaynağı. Varsayılan: Electron `powerMonitor`. */
  power?: {
    on(event: 'lock-screen' | 'unlock-screen', listener: () => void): unknown;
    off(event: 'lock-screen' | 'unlock-screen', listener: () => void): unknown;
  };
  pollMs?: number;
}

export function createPresence(deps: ServiceDeps['presence'], options: PresenceOptions = {}): PresenceApi {
  const { settings, bus } = deps;
  const log = deps.log.child('presence');
  const ownExe = path.normalize(process.execPath);
  const power = options.power ?? powerMonitor;

  let probe: Win32Probe | null = null;
  let timer: NodeJS.Timeout | null = null;
  let ticks = 0;
  let locked = false;
  let media = { cameraUsers: [] as string[], micUsers: [] as string[] };
  let failed = false;
  const subscriptions: Unsubscribe[] = [];

  let current: PresenceState = {
    mode: 'normal',
    fullscreen: false,
    meeting: false,
    cameraInUse: false,
    micInUseByOther: false,
    quiet: false,
    idleSeconds: 0,
    since: nowIso(),
  };

  const read = (withMedia: boolean): { readings: PresenceReadings; foreground: ForegroundInfo | null } => {
    if (!probe) {
      return {
        readings: { notificationState: null, foregroundFullscreen: false, idleSeconds: 0, ...media, locked },
        foreground: null,
      };
    }
    if (withMedia) media = { cameraUsers: probe.mediaUsers('webcam'), micUsers: probe.mediaUsers('microphone') };
    const foreground = probe.foreground();
    return {
      readings: {
        notificationState: probe.notificationState(),
        // Kendi pencerelerimiz (ör. büyütülmüş ana pencere) tam ekran uygulama değildir.
        foregroundFullscreen: foreground.fullscreen && foreground.pid !== process.pid,
        idleSeconds: probe.idleSeconds(),
        ...media,
        locked,
      },
      foreground,
    };
  };

  const measure = (withMedia: boolean): PresenceState => {
    const now = new Date();
    const value = settings.get();
    // Süreli "rahatsız etme" dolduysa ayar da kapanır ki tepsi ve Ayarlar doğruyu göstersin.
    if (value.dnd && value.dndUntil !== null && now.getTime() >= Date.parse(value.dndUntil)) {
      settings.update({ dnd: false, dndUntil: null });
    }
    let derived: Omit<PresenceState, 'since'>;
    try {
      derived = derivePresence(read(withMedia).readings, settings.get(), now, ownExe);
      failed = false;
    } catch (error) {
      if (!failed) log.warn('varlık ölçümü başarısız; son durum korunuyor', error);
      failed = true;
      return current;
    }
    const changed = STABLE_KEYS.some((key) => derived[key] !== current[key]);
    const since = derived.mode === current.mode ? current.since : now.toISOString();
    current = { ...derived, since };
    if (changed) bus.emit('presence.changed', current);
    return current;
  };

  const api: PresenceApi = {
    async start() {
      if (timer) return;
      try {
        probe = await (options.loadProbe ?? loadWin32Probe)();
      } catch (error) {
        // Ölçüm yoksa her zaman "uygun" sayılır: bildirimler gösterilir, ada tam ekranda gizlenemez.
        log.error('Windows varlık ölçümleri yüklenemedi; durum hep "uygun" görünecek', error);
      }
      const onLock = () => {
        locked = true;
        measure(false);
      };
      const onUnlock = () => {
        locked = false;
        measure(false);
      };
      power.on('lock-screen', onLock);
      power.on('unlock-screen', onUnlock);
      subscriptions.push(
        () => power.off('lock-screen', onLock),
        () => power.off('unlock-screen', onUnlock),
        bus.on('settings.changed', ({ changedKeys }) => {
          if (changedKeys.some((key) => key === 'dnd' || key === 'dndUntil' || key === 'quietHours')) measure(false);
        }),
      );
      measure(true);
      timer = setInterval(() => measure(++ticks % MEDIA_EVERY === 0), options.pollMs ?? POLL_MS);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      for (const off of subscriptions.splice(0)) off();
    },
    get: () => current,
    refresh: () => measure(true),
  };

  diagnostics.set(api, () => {
    if (!probe) return null;
    const { readings, foreground } = read(true);
    return foreground ? { readings, foreground } : null;
  });
  return api;
}
