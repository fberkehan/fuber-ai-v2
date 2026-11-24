// Ekran katmanının Electron'a bağlı parçası (`overlay.ts` › `OverlayHost`): ekranlar, fiziksel → DIP çevirisi ve
// ekran başına bir saydam pencere. Pencere bütün pencerelerin geçtiği fabrikadan açılır (`create-window.ts`).
//
// Pencere kuralları (v1 `imlec.ts` ile aynı, kullanıcının ekranında):
//  - girdi almaz, odak çalmaz: `focusable:false`, `setIgnoreMouseEvents(true)` (forward YOK), yalnız `showInactive`;
//  - ekran görüntüsüne girmez: `setContentProtection(true)` (WDA_EXCLUDEFROMCAPTURE): Jarvis'in kendi ekran bakışı
//    ve kullanıcının ekran kaydı katmanı görmez;
//  - her şeyin üstünde: `setAlwaysOnTop(true, 'screen-saver')`, bütün masaüstlerinde. Tam ekran oyun/video sürerken de
//    görünür: o an Jarvis bilgisayarı kullanıyorsa kullanıcı bunu bilmelidir (ada tam ekranda bastırılır, katman değil).
import { screen, type BrowserWindow, type Display } from 'electron';
import { IPC_EVENT_CHANNEL } from '@fuber/shared';
import { createWindow, reveal } from '../../create-window';
import { testing } from '../../testing';
import type { OverlayDisplay, OverlayHost, OverlaySurface } from './overlay';
import type { PcOverlayFrame } from './types';

const toOverlayDisplay = (display: Display): OverlayDisplay => ({
  id: display.id,
  bounds: { ...display.bounds },
  workArea: { ...display.workArea },
  scaleFactor: display.scaleFactor,
});

/** Sınama kancası (`__fuber2Test.pcOverlay`): açılan pencereler ve uygulanan pencere kuralları. Üretimde dolmaz. */
interface OverlayProbe {
  windows: Array<{ displayId: number; win: BrowserWindow; contentProtection: boolean; ignoreMouse: boolean; topLevel: string }>;
  frames: number;
}

export function createElectronOverlayHost(): OverlayHost {
  const probe: OverlayProbe = { windows: [], frames: 0 };
  testing.expose({ pcOverlay: probe });

  return {
    displays: () => screen.getAllDisplays().map(toOverlayDisplay),
    toDip: (point) => {
      try {
        return screen.screenToDipPoint(point);
      } catch {
        // Çevrilemeyen nokta (ekran dışı): birincil ekranın ölçeğiyle yaklaşık değer.
        const primary = screen.getPrimaryDisplay();
        return { x: point.x / primary.scaleFactor, y: point.y / primary.scaleFactor };
      }
    },
    nearest: (point) => toOverlayDisplay(screen.getDisplayNearestPoint({ x: Math.round(point.x), y: Math.round(point.y) })),
    cursorDisplay: () => toOverlayDisplay(screen.getDisplayNearestPoint(screen.getCursorScreenPoint())),

    open(display): OverlaySurface {
      const { win, loaded } = createWindow({
        entry: 'hud',
        query: { surface: 'pc-overlay' },
        window: {
          ...display.bounds,
          title: 'Fuber AI 2 · ekran katmanı',
          frame: false,
          transparent: true,
          backgroundColor: '#00000000',
          hasShadow: false,
          thickFrame: false,
          roundedCorners: false,
          resizable: false,
          movable: false,
          minimizable: false,
          maximizable: false,
          fullscreenable: false,
          skipTaskbar: true,
          focusable: false,
          alwaysOnTop: true,
          enableLargerThanScreen: true,
        },
      });
      win.setIgnoreMouseEvents(true);
      win.setAlwaysOnTop(true, 'screen-saver');
      win.setContentProtection(true);
      win.setVisibleOnAllWorkspaces(true);
      // Tam ekran kaplamada Windows pencereyi ekranın iç alanına oturtabilir; kesin dikdörtgen yeniden verilir.
      win.setBounds(display.bounds);
      probe.windows.push({ displayId: display.id, win, contentProtection: true, ignoreMouse: true, topLevel: 'screen-saver' });

      let ready = false;
      let pending: PcOverlayFrame | null = null;
      const deliver = (frame: PcOverlayFrame) => {
        if (win.isDestroyed()) return;
        probe.frames += 1;
        win.webContents.send(IPC_EVENT_CHANNEL, 'pc.overlay', frame);
      };
      // Sayfa dinleyicisini betik yüklenirken kurar (`PcOverlay.tsx` › `startPcOverlay`); yükleme bitince son kare gider.
      void loaded
        .then(() => {
          ready = true;
          if (pending) deliver(pending);
          pending = null;
        })
        .catch(() => undefined);

      return {
        send(frame) {
          if (ready) deliver(frame);
          else pending = frame;
        },
        show() {
          // Sınama kipinde katman HİÇBİR koşulda ekrana çıkmaz (`FUBER2_SHOW_HUD=1` olsa da): tam ekran saydam pencere,
          // bilgisayarın başındaki kişinin ekranını kaplardı. Gizli pencere yine çizer; görüntüsü `capturePage` ile alınır.
          if (testing.enabled) return;
          if (!win.isDestroyed()) reveal(win, 'inactive');
        },
        hide() {
          if (!win.isDestroyed() && win.isVisible()) win.hide();
        },
        setBounds(bounds) {
          if (!win.isDestroyed()) win.setBounds(bounds);
        },
        destroy() {
          const index = probe.windows.findIndex((entry) => entry.win === win);
          if (index >= 0) probe.windows.splice(index, 1);
          if (!win.isDestroyed()) win.destroy();
        },
      };
    },

    onDisplaysChanged(listener) {
      screen.on('display-added', listener);
      screen.on('display-removed', listener);
      screen.on('display-metrics-changed', listener);
      return () => {
        screen.off('display-added', listener);
        screen.off('display-removed', listener);
        screen.off('display-metrics-changed', listener);
      };
    },
  };
}
