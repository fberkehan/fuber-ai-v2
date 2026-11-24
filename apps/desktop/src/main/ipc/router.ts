/**
 * Tipli IPC yönlendirici: `Api` haritasındaki kanalları tek Electron kanalı üzerinden işler.
 *
 * ```ts
 * router.handle('memory.search', ({ query, limit }, ctx) => services.memory.search({ text: query, limit }));
 * router.broadcast('voice.state', payload);
 * ```
 *
 * Bilinmeyen kanal ve işleyici hataları tek noktada sarılır (`createIpcDispatcher`); pencereye
 * yalnız kullanıcıya gösterilebilir ileti gider, asıl hata günlüğe yazılır.
 */

import { BrowserWindow, ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import {
  createIpcDispatcher,
  IPC_EVENT_CHANNEL,
  IPC_INVOKE_CHANNEL,
  t,
  type Api,
  type Events,
  type IpcHandler,
  type IpcHandlers,
  type IpcRegistrar,
  type IpcResult,
  type ReqOf,
  type ResOf,
  type Services,
  type Unsubscribe,
} from '@fuber/shared';
import { isAppUrl } from '../runtime';

/** İşleyiciye verilen çağrı bağlamı. */
export interface IpcContext {
  /** Çağrıyı yapan pencerenin içeriği (yanıt dışında olay göndermek ya da pencereyi bulmak için). */
  sender: WebContents;
  /** Çağıran pencere; pencere o sırada kapandıysa `null`. */
  window: BrowserWindow | null;
}

export type Handler<K extends keyof Api> = IpcHandler<Api, K, IpcContext>;

/**
 * `ipc/handlers/<alan>.ts` dosyalarının dışa aktardığı `register` işlevinin tipi.
 * Dosyalar klasörden keşfedilir (`handlers/index.gen.ts`) ve bootstrap sırasında bir kez çağrılır.
 */
export type RegisterHandlers = (ipc: IpcRouter, services: Services) => void;

export interface IpcRouter extends IpcRegistrar {
  /** Kanala işleyici bağlar; aynı kanal iki kez bağlanırsa fırlatır. */
  handle<K extends keyof Api>(channel: K, handler: Handler<K>): void;
  /** Bir alanın bütün kanallarını tek nesneyle bağlar. */
  handleAll(handlers: { [K in keyof Api]?: Handler<K> }): void;
  /**
   * Çağıran pencereyi bilmesi gerekmeyen işleyicileri bağlar (modüller ve çekirdek servisler);
   * dönen işlev hepsini kaldırır. `Services.ipc` budur.
   */
  register(handlers: IpcHandlers): Unsubscribe;
  /** Olayı açık bütün pencerelere yollar. */
  broadcast<K extends keyof Events>(event: K, payload: Events[K]): void;
  /** Olayı tek bir pencereye yollar. */
  sendTo<K extends keyof Events>(target: WebContents, event: K, payload: Events[K]): void;
  /** Kayıtlı kanal adları. */
  channels(): string[];
  /**
   * Süreç içinden çağrı (pencere yok). Yalnız çağıran pencereye bakmayan kanallar içindir: modüllerin `ipc`
   * alanıyla ve `register` ile bağlananlar. Kanal bağlı değilse ya da işleyici hata verirse `null` döner.
   */
  local<K extends keyof Api>(channel: K, request: ReqOf<Api, K>): Promise<ResOf<Api, K> | null>;
}

export function createRouter(options: { onError(channel: string, error: unknown): void }): IpcRouter {
  const dispatcher = createIpcDispatcher<Api, IpcContext>({ onError: options.onError });

  ipcMain.handle(
    IPC_INVOKE_CHANNEL,
    async (event: IpcMainInvokeEvent, channel: unknown, request: unknown): Promise<IpcResult<unknown>> => {
      const name = typeof channel === 'string' ? channel : '';
      // Yalnız kendi sayfalarımızın ana çerçevesi çağırabilir; sahnedeki mini uygulama çerçeveleri çağıramaz.
      const frame = event.senderFrame;
      if (!frame || frame !== event.sender.mainFrame || !isAppUrl(frame.url)) {
        options.onError(name, new Error(`güvenilmeyen IPC göndereni: ${frame?.url ?? 'bilinmiyor'}`));
        return { ok: false, error: { code: 'forbidden', channel: name, message: t('common.unknownError') } };
      }
      return dispatcher.dispatch(name, request, {
        sender: event.sender,
        window: BrowserWindow.fromWebContents(event.sender),
      });
    },
  );

  const sendTo: IpcRouter['sendTo'] = (target, event, payload) => {
    if (!target.isDestroyed()) target.send(IPC_EVENT_CHANNEL, event, payload);
  };

  return {
    handle: (channel, handler) => dispatcher.handle(channel, handler),
    handleAll: (handlers) => dispatcher.handleAll(handlers),
    register(handlers) {
      const channels = Object.keys(handlers) as Array<keyof Api>;
      dispatcher.handleAll(handlers);
      return () => {
        for (const channel of channels) dispatcher.unhandle(channel);
      };
    },
    broadcast(event, payload) {
      for (const win of BrowserWindow.getAllWindows()) sendTo(win.webContents, event, payload);
    },
    sendTo,
    channels: () => dispatcher.channels(),
    async local(channel, request) {
      if (!dispatcher.has(String(channel))) return null;
      // Pencere bağlamı yoktur; bağlama bakan (`handle` ile bağlanmış) kanallar bu yoldan çağrılmaz.
      const result = await dispatcher.dispatch(String(channel), request, { sender: null as never, window: null });
      return result.ok ? (result.data as ResOf<Api, typeof channel>) : null;
    },
  };
}
