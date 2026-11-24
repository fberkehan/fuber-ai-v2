/**
 * Masaüstü renderer'ları için `window.fuber` bildirimi.
 * Kullanım: renderer tsconfig'inin gördüğü bir `env.d.ts` içinde `import '@fuber/shared/window-desktop';`
 */
import type { FuberBridge } from './ipc';

declare global {
  interface Window {
    fuber: FuberBridge;
  }
}

export {};
