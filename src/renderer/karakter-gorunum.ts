// Sade mod (0.14 T6b) arayüz kancası: gözler (11 Kas "Pamuk") çizilsin mi. Kural shared/karakter-gorunum.ts karakterGorunurMu; kaynak
// ayarlardaki gorunum.karakterler + değişiklikleri ('ayarlar:degisti'). useMod (mod.ts) gibi modül önyüklenirken bir kez sorar; farkı: TEK abonelik
// paylaşılır (sohbetteki her ileti başlığı kancayı çağırır, ileti başına IPC olmasın) ve useSyncExternalStore ile okunur.
// Ayar gelene dek `false` döner: Sade seçmiş birine açılışta bir kare bile karakter görünmesin (Göster'de ilk karede nötr işaret, sonra karakter;
// kabuk ayarları beklediğinden pratikte görünmez). Pencere köprüsü yoksa (Yönetim, testler) ayar da yoktur: `true` (varsayılan Göster).
// Karakter çizen HER dosya bunu çağırır (tests/karakter-gorunum.test.ts kaynak taraması `<Karakter` ve `<ModGecisi` çizen dosyaları denetler).
import { useSyncExternalStore } from 'react';
import { cagir, dinle } from './api';
import { gorunenKarakterAdi, karakterGorunurMu } from '../shared/karakter-gorunum';
import type { Ayarlar } from '../shared/tipler';

const kopruVar = (): boolean => typeof window !== 'undefined' && Boolean(window.fuber);
let son: boolean | null = kopruVar() ? null : true;
const dinleyenler = new Set<() => void>();
let basladi = false;

function yaz(a: Ayarlar | null | undefined): void {
  if (!a) return;
  const y = karakterGorunurMu(a);
  if (y === son) return;
  son = y;
  for (const f of dinleyenler) f();
}

function baslat(): void {
  if (basladi || !kopruVar()) return;
  basladi = true;
  void cagir<Ayarlar>('ayarlar:al').then(yaz).catch(() => undefined);
  dinle('ayarlar:degisti', yaz);
}
baslat();

const abone = (f: () => void) => {
  baslat();
  dinleyenler.add(f);
  return () => { dinleyenler.delete(f); };
};
const anlik = (): boolean => son === true;

/** Karakterler görünür mü (Göster) — false: Sade mod ya da ayar henüz gelmedi. Business ve Developer mode'da aynı. */
export function useKarakterGorunur(): boolean {
  return useSyncExternalStore(abone, anlik, anlik);
}

/** Ekranda görünecek karakter adı: Göster'de `ad`, Sade'de "Fuber" (boş ad boş kalır). */
export function useGorunenKarakterAdi(ad: string | undefined | null): string {
  return gorunenKarakterAdi(useKarakterGorunur(), ad);
}

/** Kancasız okuma (olay işleyicileri): son bilinen değer. */
export const karakterGorunurAnlik = anlik;
