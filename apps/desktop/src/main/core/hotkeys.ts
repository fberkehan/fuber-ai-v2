/**
 * Genel kısayollar (KURGU §5.5): konuş, mikrofon aç/kapat, acil durdur. Yalnız `hotkey.pressed` yayınlar;
 * ne yapılacağına dinleyenler karar verir.
 *
 * İstenen tuşu başka bir uygulama tutuyorsa sıradaki yedek denenir ve GERÇEKTE kaydedilen tuş ayarlara yazılır:
 * arayüz, `HotkeyStatus` ve asistanın "şu kısayolla açarsınız" cümlesi hep aynı (doğru) tuşu gösterir. Hiçbiri
 * kaydedilemezse ayardaki değer boş dizgi olur ("kısayol yok"); uygulama çalışmaya devam eder ve bir sonraki
 * açılışta varsayılan yeniden denenir.
 */

import { globalShortcut } from 'electron';
import {
  DEFAULT_HOTKEYS,
  type HotkeyId,
  type HotkeysApi,
  type HotkeyStatus,
  type ServiceDeps,
  type Unsubscribe,
} from '@fuber/shared';

const IDS = Object.keys(DEFAULT_HOTKEYS) as HotkeyId[];

/** İstenen tuş tutulmuşsa sırayla denenecek yedekler. */
export const HOTKEY_FALLBACKS: Record<HotkeyId, readonly string[]> = {
  talk: ['Control+Alt+H', 'Control+Shift+Alt+J'],
  mute: ['Control+Alt+K', 'Control+Shift+Alt+M'],
  panic: ['Control+Shift+Alt+Q'],
  meeting: ['Control+Shift+Alt+T'],
};

export interface HotkeysOptions {
  /** Sınamada sahte kayıt. */
  shortcuts?: Pick<typeof globalShortcut, 'register' | 'unregister'>;
}

export function createHotkeys(deps: ServiceDeps['hotkeys'], options: HotkeysOptions = {}): HotkeysApi {
  const { settings, bus } = deps;
  const log = deps.log.child('hotkeys');
  const shortcuts = options.shortcuts ?? globalShortcut;
  /** Şu an bizim adımıza kayıtlı tuşlar. */
  const held = new Map<HotkeyId, string>();
  let unsubscribe: Unsubscribe | null = null;

  const bind = (id: HotkeyId, accelerator: string): boolean => {
    if (!accelerator) return false;
    // Aynı tuş iki işe verilemez; Electron ikinci kaydı sessizce birincinin üstüne yazardı.
    if ([...held].some(([other, taken]) => other !== id && taken === accelerator)) return false;
    try {
      return shortcuts.register(accelerator, () => bus.emit('hotkey.pressed', { id }));
    } catch {
      // Geçersiz tuş dizgisi.
      return false;
    }
  };

  const release = (id: HotkeyId) => {
    const accelerator = held.get(id);
    if (accelerator === undefined) return;
    held.delete(id);
    try {
      shortcuts.unregister(accelerator);
    } catch {
      // zaten bırakılmış
    }
  };

  /** Kayıtları ayarlarla eşitler: değişeni bırakır, eksik olanı (gerekirse yedeğiyle) kaydeder. */
  const reconcile = () => {
    const wanted = settings.get().hotkeys;
    const effective: Record<HotkeyId, string> = { ...wanted };
    for (const id of IDS) {
      if (held.has(id) && held.get(id) === wanted[id]) continue;
      release(id);
      // Boş ayar = geçen sefer hiçbir tuş alınamadı: varsayılandan başlanır.
      const first = wanted[id] || DEFAULT_HOTKEYS[id];
      const candidates = [first, ...HOTKEY_FALLBACKS[id].filter((candidate) => candidate !== first)];
      const taken = candidates.find((candidate) => bind(id, candidate));
      if (taken) {
        held.set(id, taken);
        if (taken !== first) log.warn(`kısayol ${id}: ${first} başka bir uygulamada; ${taken} kaydedildi`);
      } else {
        log.warn(`kısayol kaydedilemedi: ${id} (${candidates.join(', ')}); başka uygulamalar tutuyor olabilir`);
      }
      effective[id] = taken ?? '';
    }
    // Gerçekte kayıtlı olan ayara yazılır; bu, `settings.changed` ile buraya döner ve artık değişecek bir şey bulmaz.
    if (IDS.some((id) => effective[id] !== wanted[id])) settings.update({ hotkeys: effective });
  };

  const status = (id: HotkeyId): HotkeyStatus => {
    const accelerator = settings.get().hotkeys[id];
    return { id, accelerator, registered: accelerator !== '' && held.get(id) === accelerator };
  };

  return {
    start() {
      if (unsubscribe) return;
      reconcile();
      unsubscribe = bus.on('settings.changed', ({ changedKeys }) => {
        if (changedKeys.includes('hotkeys')) reconcile();
      });
    },
    stop() {
      unsubscribe?.();
      unsubscribe = null;
      for (const id of IDS) release(id);
    },
    status: () => IDS.map(status),
    rebind(id, accelerator) {
      if (held.get(id) === accelerator) return status(id);
      // Önce yenisi denenir: tutmazsa eski kayıt yerinde kalır.
      if (!bind(id, accelerator)) return { id, accelerator, registered: false };
      const previous = held.get(id);
      held.set(id, accelerator);
      if (previous !== undefined) {
        try {
          shortcuts.unregister(previous);
        } catch {
          // zaten bırakılmış
        }
      }
      settings.update({ hotkeys: { ...settings.get().hotkeys, [id]: accelerator } });
      return status(id);
    },
  };
}
