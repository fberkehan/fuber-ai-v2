/**
 * Tipli IPC yönlendirici (`AdminApi`). Bilinmeyen kanal ve işleyici hataları tek noktada sarılır.
 *
 * ```ts
 * router.handle('devices.approve', ({ id }) => control.approveDevice(id));
 * router.broadcast('policy.changed', { revision });
 * ```
 */

import { BrowserWindow, ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import {
  createIpcDispatcher,
  IPC_EVENT_CHANNEL,
  IPC_INVOKE_CHANNEL,
  t,
  type AdminApi,
  type AdminEvents,
  type IpcHandler,
  type IpcResult,
} from '@fuber/shared';
import { isAppUrl } from '../runtime';

export interface IpcContext {
  sender: WebContents;
  /** Çağıran pencere; o sırada kapandıysa `null`. */
  window: BrowserWindow | null;
}

export type Handler<K extends keyof AdminApi> = IpcHandler<AdminApi, K, IpcContext>;

export interface IpcRouter {
  handle<K extends keyof AdminApi>(channel: K, handler: Handler<K>): void;
  handleAll(handlers: { [K in keyof AdminApi]?: Handler<K> }): void;
  /** Olayı açık bütün pencerelere yollar. */
  broadcast<K extends keyof AdminEvents>(event: K, payload: AdminEvents[K]): void;
  channels(): string[];
}

export function createRouter(options: { onError(channel: string, error: unknown): void }): IpcRouter {
  const dispatcher = createIpcDispatcher<AdminApi, IpcContext>({ onError: options.onError });

  ipcMain.handle(
    IPC_INVOKE_CHANNEL,
    async (event: IpcMainInvokeEvent, channel: unknown, request: unknown): Promise<IpcResult<unknown>> => {
      const name = typeof channel === 'string' ? channel : '';
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

  return {
    handle: (channel, handler) => dispatcher.handle(channel, handler),
    handleAll: (handlers) => dispatcher.handleAll(handlers),
    broadcast(event, payload) {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.webContents.isDestroyed()) win.webContents.send(IPC_EVENT_CHANNEL, event, payload);
      }
    },
    channels: () => dispatcher.channels(),
  };
}
