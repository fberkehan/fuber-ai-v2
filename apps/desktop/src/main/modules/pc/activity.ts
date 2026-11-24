// Adadaki "Bilgisayarı kullanıyor: … · Durdur" satırının kanalı (`pc.activity`) BİRDEN ÇOK yayıncıya açıktır: bilgisayar
// modülü (fare/klavye) ve asistanın kendi tarayıcısı (`modules/browser`). Her yayıncı, eylemi bitince satırı hemen
// kaldırmaz; kısa bir oyalanma süresinden sonra "bitti" yayınlar (art arda eylemlerde satır yanıp sönmesin).
//
// Yayıncılar birbirini bilmezse birinin GEÇ gelen "bitti"si, o arada başlamış olan ötekinin satırını ve "Durdur"
// düğmesini kaldırır: kullanıcı süren eylemi durduramaz. demo.3 bütünleştirmesinde `scripts/e2e/pc.mjs` bununla kaldı
// ("Durdur" tıklanmadan kayboluyor): yazma aracının oyalanma süresi dolunca gelen "bitti", sonradan yayınlanan etkinliğin
// satırını siliyordu. Kanalın adada tek satırı vardır; hakemlik burada, yayın tarafında yapılır.
//
// Kural: OLAĞAN "bitti" yalnız kanalın son sahibi (en son "sürüyor" diyen yayıncı) söylerse yayınlanır. Kesilme
// ("durduruldu": kullanıcı araya girdi, acil dur) her zaman yayınlanır: durdurma bütün yayıncıları durdurur.
import { nowIso, type Bus } from '@fuber/shared';
import type { PcActivity } from './types';

export interface ActivityEmitter {
  /** Yayınlar; başkasının süren satırını kaldıracak olağan "bitti"yi yayınlamaz. Yayınlandıysa `true`. */
  emit(activity: Omit<PcActivity, 'at' | 'source'>): boolean;
  dispose(): void;
}

/** `source`: yayıncının adı (`pc`, `browser`); olaya yazılır. Adı olmayan yayın (sınama) "başka biri" sayılır. */
export function createActivityEmitter(bus: Bus, source: string): ActivityEmitter {
  /** Kanalda o an "sürüyor" diyen son yayıncı; satır kalktıysa `null`. */
  let owner: string | null = null;
  const off = bus.on('pc.activity', (event) => {
    owner = event.active ? (event.source ?? 'other') : null;
  });
  return {
    emit(activity) {
      if (!activity.active && !activity.interrupted && owner !== null && owner !== source) return false;
      bus.emit('pc.activity', { ...activity, source, at: nowIso() });
      return true;
    },
    dispose: off,
  };
}
