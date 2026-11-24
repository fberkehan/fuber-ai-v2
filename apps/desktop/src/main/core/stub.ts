/**
 * Henüz uygulanmamış servisin yer tutucusu. `working` içindeki yöntemler çalışır (açılışın ayağa
 * kalkması için gereken zararsız davranışlar); `start`/`stop` sessizce geçer; geri kalan her yöntem
 * çağrıldığında açık bir hata fırlatır: "henüz uygulanmadı: brain.respond".
 */
export function notImplemented<T extends object>(service: string, working: Partial<T> = {}): T {
  return new Proxy(working as T, {
    get(target, prop) {
      if (prop in target) return Reflect.get(target, prop);
      // `await stub` ve günlükleme (inspect, toJSON) hata fırlatmasın.
      if (typeof prop === 'symbol' || prop === 'then' || prop === 'toJSON') return undefined;
      if (prop === 'start' || prop === 'stop') return () => {};
      return () => {
        throw new Error(`henüz uygulanmadı: ${service}.${prop}`);
      };
    },
  });
}
