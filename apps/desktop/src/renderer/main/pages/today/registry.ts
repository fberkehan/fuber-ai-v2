// Kokpit kartlarının arayüz kaydı: kartın türü (`DashboardCard.kind`) → onu çizen bileşen.
//
// Yerleşik kartlar `cards.tsx`, `custom-cards.tsx` ve `band.tsx` içinde kaydedilir. Başka bir modül kendi kartını
// iki yoldan takar:
//
//  1. Verisi ana süreçten geliyorsa (önerilen): ana süreçte `dashboard.registerProvider({ id, kind, … })`, arayüzde
//     `registerTodayCard(kind, Bileşen)`. Bileşen `card.data`yı çizer; boşluk kuralını ana süreç uygular.
//  2. Kart kendi verisini kendi okuyorsa (ana süreçte doldurucusu yoksa): `registerTodayCard(kind, Bileşen, { local })`.
//     Kart panoya `local` bilgisiyle girer; gösterecek bir şeyi yoksa `props.setEmpty(true)` çağırır ve çizilmez.
//
// Her iki yolda da kart sürüklenir, boyutlanır, kaldırılır ve düzeni kalıcıdır.
import { useSyncExternalStore, type ComponentType } from 'react';
import type { DashboardCard, DashboardSize } from '@fuber/shared';

export interface TodayCardProps<D = unknown> {
  card: DashboardCard<D>;
  /** Kartın ızgaradaki o anki genişliği (sütun), ızgaranın sütun sayısı ve kartın kapladığı satır birimi. */
  span: number;
  columns: number;
  rows: number;
  /**
   * Kartın o anki genişliği ve yüksekliği (px, sayfa ölçeğinden bağımsız). İçerik buna göre seçilir: kaç satır
   * sığar, liste iki sütuna bölünür mü, ayrıntı gösterilir mi.
   */
  width: number;
  height: number;
  /** Dakikada bir yenilenen saat (kalan süre, "şu kadar önce"). */
  now: Date;
  /** Sözü yerleşik sohbetin yazma kutusuna koyar ve kutuya odaklanır. */
  compose(text: string): void;
  /** Kart o an gösterecek bir şey bulamadıysa `true`: kart çizilmez ("boş kart yok"). Yalnız `local` kartlar kullanır. */
  setEmpty(empty: boolean): void;
}

/**
 * Kartın kademesi. `focus`: sayfada en çok bir tane; sıradaki iş gibi "şimdi buna bakın" kartı (açık çerçeve, üstten
 * mavi ışık). `base`: olağan kart. `ambient`: ortam bilgisi (hava, döviz, haber); ışıksız ve bir kat koyu, geri çekilir.
 */
export type TodayCardTone = 'focus' | 'base' | 'ambient';

export interface TodayCardOptions {
  tone?: TodayCardTone;
  /** Başlığın yanındaki sayı. */
  count?(card: DashboardCard): number | undefined;
  /** Kart çerçevesiz çizilir: bileşen kendi yüzeyini taşır (bugün bandı). */
  bare?: boolean;
  /** Kart taşınmaz, boyutlanmaz, kaldırılmaz; menüsü yoktur (boş durumdaki başlangıç kartı). */
  fixed?: boolean;
  /** Ana süreçte doldurucusu olmayan, kendi verisini okuyan kart. */
  local?: { id: string; title: string; defaultSize: DashboardSize; priority: number; page?: string; moduleId?: string };
}

export interface TodayCardEntry {
  kind: string;
  Component: ComponentType<TodayCardProps<never>>;
  options: TodayCardOptions;
}

const entries = new Map<string, TodayCardEntry>();
const listeners = new Set<() => void>();
let version = 0;

/**
 * Kart türünü çizecek bileşeni kaydeder; aynı tür yeniden kaydedilirse yenisi geçerli olur (sıcak yenileme).
 * Dönen işlev kaydı kaldırır.
 */
export function registerTodayCard<D = unknown>(kind: string, Component: ComponentType<TodayCardProps<D>>, options: TodayCardOptions = {}): () => void {
  const entry: TodayCardEntry = { kind, Component: Component as ComponentType<TodayCardProps<never>>, options };
  entries.set(kind, entry);
  version += 1;
  for (const listener of [...listeners]) listener();
  return () => {
    if (entries.get(kind) !== entry) return;
    entries.delete(kind);
    version += 1;
    for (const listener of [...listeners]) listener();
  };
}

export const todayCardEntry = (kind: string): TodayCardEntry | undefined => entries.get(kind);

/** Ana süreçte doldurucusu olmayan kayıtlı kartlar. */
export const localTodayCards = (): TodayCardEntry[] => [...entries.values()].filter((entry) => entry.options.local);

/** Kayıt değişince yeniden çizer (sonradan yüklenen modülün kartı). */
export function useTodayCardRegistry(): number {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => version,
  );
}
