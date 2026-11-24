/**
 * Yönetim renderer'ı için `window.fuber` bildirimi.
 * Kullanım: renderer tsconfig'inin gördüğü bir `env.d.ts` içinde `import '@fuber/shared/window-admin';`
 */
import type { AdminBridge } from './ipc-admin';

declare global {
  interface Window {
    fuber: AdminBridge;
  }
}

export {};
