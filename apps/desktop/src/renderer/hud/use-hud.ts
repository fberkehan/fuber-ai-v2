import { useEffect, useLayoutEffect, useRef } from 'react';
import type { Events, HudSurface } from '@fuber/shared';

/**
 * Kalıcı sözleşme: yüzey, içerik kutusunun boyutunu ana sürece bildirir; pencere tam o boyuta getirilir
 * (pencere = görünen şekil). İçerik yokken kutu 0×0 ölçülür ve pencere gizlenir. Dönen `ref` içerik kutusuna
 * (`.hud-content`) verilir.
 */
export function useReportSize(surface: HudSurface) {
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef('');

  const report = () => {
    const element = ref.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const width = Math.ceil(rect.width);
    const height = Math.ceil(rect.height);
    // Boş kutu: iki boyut da sıfır bildirilir ki ana süreç pencereyi gizlesin.
    const size = width > 0 && height > 0 ? { width, height } : { width: 0, height: 0 };
    const key = `${size.width}x${size.height}`;
    if (key === last.current) return;
    last.current = key;
    void window.fuber.invoke('hud.resize', { surface, ...size }).catch(() => {
      // Bu sayfa bir HUD penceresinde değilse (ör. tanı amaçlı düz pencere) bildirim reddedilir; zararsız.
      last.current = '';
    });
  };

  // Her çizimden sonra eşzamanlı ölçüm: gizli pencere kare üretmese de boyut değişimi ana sürece ulaşır.
  useLayoutEffect(report);

  // Yazı tipi yüklenmesi, satır kırılması gibi React dışı değişimler.
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(report);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return ref;
}

/** Ana süreç olayını dinler; bileşen kalkınca abonelik de kalkar. */
export function useEvent<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void) {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => window.fuber.on(event, (payload) => latest.current(payload)), [event]);
}

/** Henüz bağlanmamış bir kanala yapılan çağrı (servis hazır değil) yüzeyi düşürmez. */
export function quiet<T>(call: Promise<T>): Promise<T | null> {
  return call.catch(() => null);
}

/**
 * Açılış okuması: HUD sayfaları uygulama açılırken önceden yüklenir; o an IPC kanalları henüz bağlanmamış olabilir
 * ve ilk çağrı reddedilir. Görünüm ve kısayol gibi kalıcı değerler varsayılanda kalmasın diye okuma, kanal
 * bağlanana kadar kısa aralıklarla yinelenir (en çok ~15 sn). Bileşen kalkınca `alive()` false döner ve durur.
 */
export async function eventually<T>(call: () => Promise<T>, alive: () => boolean, tries = 60, delayMs = 250): Promise<T | null> {
  for (let attempt = 0; attempt < tries && alive(); attempt++) {
    try {
      return await call();
    } catch {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return null;
}
