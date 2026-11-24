// Jarvis'in kendi tarayıcısı (G6; KURGU §10.8): ayrı pencere, kalıcı ama uygulamadan yalıtılmış oturum, numaralı öğelerle
// sayfa okuma ve kullanma, gönderim kalkanı. Kullanıcının KENDİ tarayıcısını okuyan/kullanan araçlar pc modülündedir
// (`browser_*`); buradakiler `jbrowser_*`.
//
// Açma/kapama: politika (`modules.browser.enabled`) + cihaz izni (Ayarlar › Gizlilik: `Settings.jbrowserAllowed`). İzin
// kapalıyken araçlar KAYITLI değildir (model göremez, çağıramaz); açık pencere kapanır.
// Durdurma: adadaki "Durdur" (`pc.stopRequested`), araç çubuğundaki "Durdur" ve acil durdurma (`app.panic`) süren eylemi
// keser, açık onay kartlarını reddeder, sayfaların yüklenmesini durdurur.
import path from 'node:path';
import { defineModule, t, type ModuleContext, type ModuleDef, type Unsubscribe } from '@fuber/shared';
import { deepBrainFor } from '../../core/brain/deep';
import { testing } from '../../testing';
import { createActivityEmitter } from '../pc/activity';
import { JarvisBrowser } from './service';
import { browserTools, type VisionBrain } from './tools';
import type { JBrowserStatus } from './types';

export type { JBrowserStatus } from './types';
export { JBROWSER_GROUP } from './tools';

/** Ada satırında uygulama adı yerine görünen ad; bitişten sonra satır bu kadar daha kalır (ardışık eylemlerde yanıp sönmesin). */
const LINGER_MS = 1500;

let current: JarvisBrowser | null = null;

function allowed(ctx: ModuleContext): boolean {
  return ctx.settings.get().jbrowserAllowed !== false;
}

export interface BrowserModuleOptions {
  vision?(ctx: ModuleContext): VisionBrain | undefined;
}

export function createBrowserModule(options: BrowserModuleOptions = {}): ModuleDef {
  let teardown: Array<() => void> = [];
  let busy = false;

  const status = (ctx: ModuleContext): JBrowserStatus => ({
    allowed: allowed(ctx),
    tabs: current?.listTabs().length ?? 0,
    visible: current?.isVisible() ?? false,
    busy,
  });

  return defineModule({
    id: 'browser',
    version: '1.0.0',
    nameKey: 'module.browser.name',
    descriptionKey: 'module.browser.description',
    permissions: ['net'],

    ipc: (ctx) => ({
      'jbrowser.show': async () => {
        if (!current || !allowed(ctx)) throw new Error(t('jbrowser.error.notAllowed'));
        await current.show(true);
        await current.ensureTab();
        return { ok: true as const };
      },
      'jbrowser.clearData': async () => {
        await (current ?? null)?.clearData();
        return { ok: true as const };
      },
      'jbrowser.status': () => status(ctx),
    }),

    async setup(ctx: ModuleContext) {
      const electron = await import('electron');
      let lingering: NodeJS.Timeout | null = null;
      // Kanal bilgisayar modülüyle ortaktır: onun süren satırını kaldıracak "bitti" yayınlanmaz (`pc/activity.ts`).
      const channel = createActivityEmitter(ctx.bus, 'browser');
      const emit = (active: boolean, interrupted: 'user' | 'panic' | null = null) => {
        channel.emit({ active, action: active || interrupted ? 'browser' : null, app: active ? t('jbrowser.appName', { name: ctx.policy.get().persona.name }) : null, interrupted, point: null });
      };
      const browser = new JarvisBrowser({
        log: ctx.log,
        test: testing.enabled,
        allow: testing.jbrowserAllow,
        downloadsDir: testing.enabled ? path.join(ctx.paths.data, 'jbrowser-downloads') : electron.app.getPath('downloads'),
        onBusy(next) {
          if (next) {
            if (lingering) clearTimeout(lingering);
            lingering = null;
            busy = true;
            emit(true);
            return;
          }
          if (lingering) clearTimeout(lingering);
          lingering = setTimeout(() => {
            lingering = null;
            if (busy) {
              busy = false;
              emit(false);
            }
          }, LINGER_MS);
        },
        onStop: () => stop('panic'),
      });
      current = browser;
      testing.expose({ jbrowser: browser });

      const stop = (why: 'panic' | 'user') => {
        browser.halt();
        if (lingering) clearTimeout(lingering);
        lingering = null;
        if (busy) {
          busy = false;
          emit(false, why);
        }
      };

      let offTools: Unsubscribe | null = null;
      const sync = () => {
        if (allowed(ctx) && !offTools) {
          offTools = ctx.tools.register(ctx, browserTools({ driver: browser, vision: (toolCtx) => options.vision?.(toolCtx) }));
        } else if (!allowed(ctx) && offTools) {
          offTools();
          offTools = null;
          browser.halt();
          browser.closeAll();
        }
      };
      sync();
      const offSettings = ctx.bus.on('settings.changed', ({ changedKeys }) => {
        if (changedKeys.includes('jbrowserAllowed')) sync();
      });
      const offPanic = ctx.bus.on('app.panic', () => stop('panic'));
      const offStop = ctx.bus.on('pc.stopRequested', () => stop('panic'));

      teardown = [
        offSettings,
        offPanic,
        offStop,
        () => offTools?.(),
        () => {
          if (lingering) clearTimeout(lingering);
        },
        () => channel.dispose(),
        () => browser.dispose(),
        () => {
          if (current === browser) current = null;
        },
      ];
    },

    teardown() {
      for (const off of teardown.reverse()) {
        try {
          off();
        } catch {
          // kapanışta kalan parça diğerlerini engellemesin
        }
      }
      teardown = [];
    },
  });
}

export default createBrowserModule({ vision: (ctx) => deepBrainFor(ctx) as unknown as VisionBrain });
