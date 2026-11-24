// `jarvis.fullscreen`: JARVIS MODE sayfası çağıran (ana) pencereyi tam ekran yapar, çıkarken geri alır. Aynı çağrı HUD'un
// açık olup olmadığını da modüle bildirir (`jarvis_mode` aracı "zaten açık/kapalı" kararını buradan verir). Kanal tipi
// `modules/jarvis/types.ts` içindedir; veri kanalları modülün kendisindedir.
import { windowsRuntime } from '../../windows/index';
import { setHudOpen } from '../../modules/jarvis/index';
import type { RegisterHandlers } from '../router';

export const register: RegisterHandlers = (ipc, services) => {
  const hud = windowsRuntime(services.windows);
  ipc.handleAll({
    'jarvis.fullscreen': ({ on }, ctx) => {
      setHudOpen(on);
      const win = ctx.window;
      // Yalnız çerçeveli ana pencere tam ekran olur (HUD yüzeyleri değil).
      if (!win || win.isDestroyed() || hud.kindOf(win) !== 'main') return { fullscreen: false };
      if (win.isFullScreen() !== on) win.setFullScreen(on);
      return { fullscreen: win.isFullScreen() };
    },
  });
};
