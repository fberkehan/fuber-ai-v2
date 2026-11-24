/**
 * Tepsi simgesi (KURGU §9): uygulama burada yaşar. Simge ses durumunu gösterir (dinliyor / meşgul /
 * mikrofon kapalı / hata), menü hızlı eylemleri verir. Eylemler olay yoluyla istenir (`hotkey.pressed`,
 * `app.panic`); tepsi ses servisini tanımaz.
 */

import { Menu, nativeImage, nativeTheme, Tray, type NativeImage } from 'electron';
import path from 'node:path';
import { DESKTOP_APP_NAME, nowIso, t, type Bus, type Logger, type Paths, type SettingsApi, type Unsubscribe, type VoiceState } from '@fuber/shared';

export type TrayStatus = 'notReady' | 'listening' | 'busy' | 'micOff' | 'error';

/** Durum noktasının rengi (`tokens.css`: success, accent-fg, warning, danger). `notReady` noktasızdır. */
const DOT: Record<Exclude<TrayStatus, 'notReady'>, [number, number, number]> = {
  listening: [0x2b, 0xd6, 0x7b],
  busy: [0x5b, 0x9b, 0xff],
  micOff: [0xff, 0xb0, 0x20],
  error: [0xff, 0x4d, 0x4d],
};

export interface TrayDeps {
  paths: Paths;
  settings: SettingsApi;
  bus: Bus;
  log: Logger;
  openMain(): void;
  quit(): void;
}

export interface TrayHandle {
  status(): TrayStatus;
  /** Simgenin o anki ipucu metni (sınama ve tanı için). */
  tooltip(): string;
  destroy(): void;
}

/** Ses olaylarından tepsi durumunu türetir. */
export function trayStatus(voice: { state: VoiceState; ready: boolean; micMuted: boolean; error: boolean }): TrayStatus {
  if (voice.state === 'mic_off' || voice.micMuted) return 'micOff';
  if (voice.error) return 'error';
  if (voice.state === 'thinking' || voice.state === 'speaking') return 'busy';
  return voice.ready ? 'listening' : 'notReady';
}

/**
 * Ortam dinleme gerçekten sürüyor mu: kip istenmiş (`VoiceStatus.ambient`; ortam modülü yalnız rıza + Yönetim izni +
 * kullanıcı anahtarı açıkken ister) ve mikrofon açık. Tepsi ipucu ve ana pencerenin durum satırı aynı kuralı kullanır.
 */
export function ambientListening(voice: { ambient?: boolean | undefined; micMuted: boolean; state: VoiceState; ready: boolean }): boolean {
  return voice.ambient === true && voice.ready && !voice.micMuted && voice.state !== 'mic_off';
}

/** Simgenin sağ alt köşesine durum noktası çizer (32 px taban; Windows gereken boyuta küçültür). */
function withDot(base: NativeImage, color: [number, number, number]): NativeImage {
  const size = 32;
  const bitmap = base.resize({ width: size, height: size, quality: 'best' }).toBitmap();
  const radius = 7;
  const center = size - radius - 1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const distance = Math.hypot(x - center, y - center);
      if (distance > radius + 1.5) continue;
      const offset = (y * size + x) * 4;
      // Nokta çevresinde ince koyu halka: açık ve koyu görev çubuğunda da seçilsin.
      const [r, g, b] = distance <= radius ? color : [0x11, 0x11, 0x13];
      bitmap[offset] = b;
      bitmap[offset + 1] = g;
      bitmap[offset + 2] = r;
      bitmap[offset + 3] = 0xff;
    }
  }
  return nativeImage.createFromBitmap(bitmap, { width: size, height: size, scaleFactor: 2 });
}

export function createTray(deps: TrayDeps): TrayHandle | null {
  const { bus, settings, log } = deps;
  const icon = () => {
    // Koyu görev çubuğunda açık renkli işaret kullanılır.
    const file = nativeTheme.shouldUseDarkColors ? 'tray-dark.ico' : 'tray-light.ico';
    return nativeImage.createFromPath(path.join(deps.paths.resources, 'icons', file));
  };

  let tray: Tray;
  try {
    tray = new Tray(icon());
  } catch (error) {
    log.error('tepsi simgesi oluşturulamadı', error);
    return null;
  }

  const voice = { state: 'idle' as VoiceState, ready: false, micMuted: false, error: false, ambient: false, meeting: false };
  let current: TrayStatus | null = null;
  let tooltip = '';

  const render = () => {
    const status = trayStatus(voice);
    const muted = status === 'micOff';
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: t('tray.open'), click: () => deps.openMain() },
        { label: t('tray.listen'), enabled: voice.ready, click: () => bus.emit('hotkey.pressed', { id: 'talk' }) },
        { label: muted ? t('tray.unmute') : t('tray.mute'), enabled: voice.ready, click: () => bus.emit('hotkey.pressed', { id: 'mute' }) },
        {
          label: t('tray.dnd'),
          type: 'checkbox',
          checked: settings.get().dnd,
          click: (item) => settings.update({ dnd: item.checked, dndUntil: null }),
        },
        { type: 'separator' },
        { label: t('tray.panic'), click: () => bus.emit('app.panic', { at: nowIso(), source: 'tray' }) },
        { label: t('tray.quit'), click: () => deps.quit() },
      ]),
    );
    // Ortam dinleme sürerken ipucu bunu her zaman söyler (kalıcı, sade gösterge; adada kalıcı öğe açılmaz).
    const nextTooltip = `${DESKTOP_APP_NAME} · ${t(`tray.status.${status}`)}${ambientListening(voice) ? ` · ${t('tray.ambient')}` : ''}${voice.meeting ? ` · ${t('meeting.recording')}` : ''}`;
    if (nextTooltip !== tooltip) {
      tooltip = nextTooltip;
      tray.setToolTip(nextTooltip);
    }
    if (status === current) return;
    current = status;
    try {
      tray.setImage(status === 'notReady' ? icon() : withDot(icon(), DOT[status]));
    } catch (error) {
      log.warn('tepsi simgesi güncellenemedi', error);
    }
  };

  const subscriptions: Unsubscribe[] = [
    bus.on('voice.state', ({ state }) => {
      voice.state = state;
      // Yeni bir tur başladıysa hat çalışıyordur ve önceki hata geçmiştir.
      if (state === 'listening' || state === 'thinking' || state === 'speaking') {
        voice.ready = true;
        voice.error = false;
      }
      render();
    }),
    bus.on('voice.status', (status) => {
      voice.state = status.state;
      voice.ready = status.ready;
      voice.micMuted = status.micMuted;
      voice.error = status.lastError !== null;
      voice.ambient = status.ambient === true;
      voice.meeting = status.meeting?.on === true;
      render();
    }),
    bus.on('voice.error', ({ level }) => {
      if (level === 'info') return;
      voice.error = true;
      render();
    }),
    bus.on('settings.changed', ({ changedKeys }) => {
      if (changedKeys.includes('dnd')) render();
    }),
  ];
  const onTheme = () => {
    current = null;
    render();
  };
  nativeTheme.on('updated', onTheme);
  tray.on('click', () => deps.openMain());
  render();

  return {
    status: () => trayStatus(voice),
    tooltip: () => tooltip,
    destroy() {
      for (const off of subscriptions.splice(0)) off();
      nativeTheme.off('updated', onTheme);
      if (!tray.isDestroyed()) tray.destroy();
    },
  };
}
