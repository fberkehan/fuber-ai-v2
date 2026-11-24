import type { Bus, BusEvents, ServiceDeps, Unsubscribe } from '@fuber/shared';

type Handler = (payload: never) => void;
type AnyHandler = (type: keyof BusEvents, payload: never) => void;

export function createBus(deps: ServiceDeps['bus']): Bus {
  const handlers = new Map<string, Set<Handler>>();
  const anyHandlers = new Set<AnyHandler>();

  const on = (type: string, handler: Handler): Unsubscribe => {
    let set = handlers.get(type);
    if (!set) handlers.set(type, (set = new Set()));
    set.add(handler);
    return () => void set.delete(handler);
  };

  return {
    emit(type, payload) {
      // Bir dinleyicinin hatası diğerlerini engellemez.
      for (const handler of [...(handlers.get(type) ?? [])]) {
        try {
          handler(payload as never);
        } catch (error) {
          deps.log.error(`olay dinleyicisi hata verdi: ${type}`, error);
        }
      }
      for (const handler of [...anyHandlers]) {
        try {
          handler(type, payload as never);
        } catch (error) {
          deps.log.error(`olay dinleyicisi hata verdi: ${type}`, error);
        }
      }
    },
    on: (type, handler) => on(type, handler as Handler),
    once(type, handler) {
      const off = on(type, ((payload: never) => {
        off();
        (handler as Handler)(payload);
      }) as Handler);
      return off;
    },
    onAny(handler) {
      anyHandlers.add(handler as AnyHandler);
      return () => void anyHandlers.delete(handler as AnyHandler);
    },
  };
}
