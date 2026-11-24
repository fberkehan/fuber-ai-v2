/**
 * IPC yönlendiricisinin Electron'dan bağımsız çekirdeği: işleyici kaydı, bilinmeyen kanal hatası ve
 * tek noktadan hata sarmalama. İki uygulamanın `src/main/ipc/router.ts` dosyası bunu Electron'a bağlar.
 */

import { t } from './i18n/index';
import type { IpcError, IpcResult, ReqOf, ResOf } from './ipc';

/**
 * Mesajı kullanıcıya olduğu gibi gösterilebilen hata (Türkçe). İşleyiciler beklenen durumlarda
 * bunu fırlatır ("Bu ad zaten kullanılıyor"); başka her hata genel bir iletiyle sarılır.
 */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserError';
  }
}

export type IpcHandler<A, K extends keyof A, C> = (
  request: ReqOf<A, K>,
  context: C,
) => ResOf<A, K> | Promise<ResOf<A, K>>;

export interface IpcDispatcher<A, C> {
  /** Kanala işleyici bağlar. Aynı kanala ikinci kayıt programlama hatasıdır ve fırlatır. */
  handle<K extends keyof A>(channel: K, handler: IpcHandler<A, K, C>): void;
  /** Birden çok işleyiciyi tek nesneyle bağlar (bir alanın bütün kanalları). */
  handleAll(handlers: { [K in keyof A]?: IpcHandler<A, K, C> }): void;
  /** Kanalın işleyicisini kaldırır (modül kapanınca). Kayıtlı değilse sessizce geçer. */
  unhandle(channel: keyof A): void;
  has(channel: string): boolean;
  /** Kayıtlı kanal adları (tanı için). */
  channels(): string[];
  /** Çağrıyı işler. Hiç fırlatmaz; sonuç her zaman zarf içindedir. */
  dispatch(channel: string, request: unknown, context: C): Promise<IpcResult<unknown>>;
}

export interface IpcDispatcherOptions {
  /** Sarılan (kullanıcıya gösterilmeyen) hataların asıl hali buraya bildirilir. */
  onError?(channel: string, error: unknown): void;
}

export function createIpcDispatcher<A, C = void>(options: IpcDispatcherOptions = {}): IpcDispatcher<A, C> {
  const handlers = new Map<string, (request: unknown, context: C) => unknown>();

  const fail = (code: IpcError['code'], channel: string, message: string): IpcResult<unknown> => ({
    ok: false,
    error: { code, channel, message },
  });

  const dispatcher: IpcDispatcher<A, C> = {
    handle(channel, handler) {
      const name = String(channel);
      if (handlers.has(name)) throw new Error(`IPC kanalı iki kez kaydedildi: ${name}`);
      handlers.set(name, handler as (request: unknown, context: C) => unknown);
    },
    handleAll(map) {
      for (const [channel, handler] of Object.entries(map)) {
        if (handler) dispatcher.handle(channel as keyof A, handler as IpcHandler<A, keyof A, C>);
      }
    },
    unhandle(channel) {
      handlers.delete(String(channel));
    },
    has: (channel) => handlers.has(channel),
    channels: () => [...handlers.keys()].sort(),
    async dispatch(channel, request, context) {
      const handler = handlers.get(channel);
      if (!handler) {
        options.onError?.(channel, new Error('bilinmeyen IPC kanalı'));
        return fail('unknown_channel', channel, t('common.unknownError'));
      }
      try {
        return { ok: true, data: await handler(request, context) };
      } catch (error) {
        if (error instanceof UserError) return fail('handler_error', channel, error.message);
        options.onError?.(channel, error);
        return fail('handler_error', channel, t('common.unknownError'));
      }
    },
  };
  return dispatcher;
}
