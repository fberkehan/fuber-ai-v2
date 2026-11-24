/**
 * HUD yüzeylerinin yerleşimi (KURGU §9). Kural: pencere dikdörtgeni = içeriğin bildirdiği boyut; büyük saydam
 * pencere ve bölgesel tıklama geçirme yoktur. Bu dosya yalnız geometri hesaplar (Electron'a bağlı değildir).
 */

import type { HudSurface } from '@fuber/shared';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Yüzey ile çalışma alanının kenarı arasındaki boşluk (DIP). */
export const HUD_EDGE = 16;
/** Adanın ekranın üst kenarına uzaklığı (DIP): ada üst kenara kaynaklıdır (çentik), arada boşluk yoktur. */
export const ISLAND_TOP = 0;
/** Ada görünürken imlecin yoklanma aralığı (ms): bakış ve imleç altında çekilme için. */
export const ISLAND_POINTER_MS = 33;

/**
 * Adanın tıklama geçirme durumu, PENCERE BAŞINA. `apply` yalnız durum değişince çağrılır (her karede
 * `setIgnoreMouseEvents` çağrılmaz). Durum pencereye bağlıdır: süreç çöküp ada yeniden açılınca yeni pencere
 * Electron'un varsayılanıyla (tıklamayı alır) başlar; tek bir genel bayrak eski pencerenin "geçiriyor" durumunu
 * taşır ve yeni pencereye gelen ilk "geçir" isteğini yutardı.
 */
export function passthroughGate<W extends object>(apply: (win: W, on: boolean) => void): { set(win: W, on: boolean): boolean } {
  const state = new WeakMap<W, boolean>();
  return {
    set(win, on) {
      if ((state.get(win) ?? false) === on) return false;
      state.set(win, on);
      apply(win, on);
      return true;
    },
  };
}

/**
 * Ekrandaki imleç konumundan adanın koordinatına (DIP): `x` pencerenin yatay merkezine, `y` üst kenarına göre.
 * Ada penceresi gövdeyi yatayda ortalar ve ekranın üst kenarına yapışıktır; sayfa bu değerle "imleç biçimin üstünde
 * mi" kararını verir (`renderer/hud/hover.ts`).
 */
export function islandPointer(point: { x: number; y: number }, bounds: { x: number; y: number; width: number; height: number }): { x: number; y: number } {
  return { x: Math.round(point.x - (bounds.x + bounds.width / 2)), y: Math.round(point.y - bounds.y) };
}

/**
 * Yüzeyin ekrandaki dikdörtgeni. `workArea` görev çubuğu dışındaki alandır: ada üst ortada, toast yığını
 * sağ altta (görev çubuğunun üstünde), sahne sağ kenarda dikey ortada. Çalışma alanına sığmayan içerik kırpılır.
 */
export function placeHud(surface: HudSurface, size: { width: number; height: number }, workArea: Rect): Rect {
  const width = Math.max(1, Math.min(Math.ceil(size.width), workArea.width - HUD_EDGE * 2));
  const height = Math.max(1, Math.min(Math.ceil(size.height), workArea.height - HUD_EDGE * 2));
  const right = workArea.x + workArea.width - width - HUD_EDGE;
  switch (surface) {
    case 'island':
      return { x: workArea.x + Math.round((workArea.width - width) / 2), y: workArea.y + ISLAND_TOP, width, height };
    case 'toasts':
      return { x: right, y: workArea.y + workArea.height - height - HUD_EDGE, width, height };
    case 'stage':
      return { x: right, y: workArea.y + Math.round((workArea.height - height) / 2), width, height };
  }
}
