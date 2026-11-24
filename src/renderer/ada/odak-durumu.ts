// ── Çentiğin Odak hâli (0.14 çentik cilası, 5 Kas) ─────────────────────────────────────────────────────────────────────────────────────────────
// Odaklanma açıksa çentik ona göre hareket eder. Sayım ana süreçtedir (main/odak.ts); çentik kökü yalnız durumu okur: açılışta bir kez 'odak:al',
// sonra 'odak:durum' olayı (yoklama yok). Pencerede tek abonelik (modül deposu). Kenar ışığı bu durumdan TEK CSS animasyonu kurar (shared/odak.ts odakIlerlemesi).
import { useSyncExternalStore } from 'react';
import { cagir, dinle } from '../api';
import type { OdakDurumu } from '../../shared/odak';

let son: OdakDurumu | null = null;
let olayGeldi = false;
let kuruldu = false;
const dinleyiciler = new Set<() => void>();
const yay = () => { for (const f of [...dinleyiciler]) f(); };

function kur(): void {
  if (kuruldu) return;
  kuruldu = true;
  dinle('odak:durum', (x: OdakDurumu) => { if (x) { olayGeldi = true; son = x; yay(); } });
  void Promise.resolve(cagir<OdakDurumu>('odak:al')).then((x) => { if (x && !olayGeldi) { son = x; yay(); } }).catch(() => undefined);
}
const abone = (f: () => void) => { kur(); dinleyiciler.add(f); return () => { dinleyiciler.delete(f); }; };
const oku = () => son;

/** Ana sürecin sayım durumu (henüz bilinmiyorsa null). */
export function useCentikOdak(): OdakDurumu | null {
  return useSyncExternalStore(abone, oku, oku);
}
