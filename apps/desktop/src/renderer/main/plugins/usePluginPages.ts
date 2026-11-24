import { useCallback, useEffect, useRef, useState } from 'react';
import type { PluginPageInfo } from '../../../main/modules/workshop/types';

/**
 * Etkin eklentilerin yan menü sayfaları. `enabled: false` (Atölye modülü kapalı) listeyi boşaltır.
 * Açılışta, `plugins.changed`, `skills.changed` ve `module.changed` olaylarında yeniden okunur; okuma hatası
 * listeyi olduğu gibi bırakır (ana süreç işleyicisi henüz yoksa menü yalnız eklentisiz kalır).
 */
export function usePluginPages(enabled: boolean): PluginPageInfo[] {
  const [pages, setPages] = useState<PluginPageInfo[]>([]);
  const alive = useRef(true);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(() => {
    const mine = ++seq.current;
    window.fuber.invoke('plugins.pages').then(
      (list) => {
        if (alive.current && mine === seq.current) setPages(Array.isArray(list) ? list : []);
      },
      () => {},
    );
  }, []);

  const refresh = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(load, 80);
  }, [load]);

  useEffect(() => {
    alive.current = true;
    if (!enabled) {
      seq.current++;
      setPages([]);
      return () => {
        alive.current = false;
      };
    }
    load();
    const offs = [window.fuber.on('plugins.changed', refresh), window.fuber.on('skills.changed', refresh), window.fuber.on('module.changed', refresh)];
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
      offs.forEach((off) => off());
    };
  }, [enabled, load, refresh]);

  return pages;
}
