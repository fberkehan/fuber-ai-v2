// Arayüz kütüphanesi galerisinin kapısı (0.11 G3): galeri bir geliştirici sayfasıdır — YALNIZ test derlemesinde (FUBER_DEMO; preload
// `window.fuber.demo`) ve yalnız `#galeri` adresiyle açılır. Ana sayfa (main.tsx) kararı açılışta bir kez verir ve galeriyi tembel
// yükler; müşteri sürümünde ne kod yüklenir ne de adres bir şey açar (tests/ui-kutuphanesi.test.ts).
// 0.14 T1: `#galeri/karakter` galerinin karakter bölümünü tek başına açar (varlık sayfası; scripts/dev/karakter-onizle.mjs).
export const GALERI_ADRESLERI: readonly string[] = ['#galeri', '#galeri/karakter'];
export function galeriAcikMi(o: { demo: boolean | undefined; hash: string }): boolean {
  return o.demo === true && GALERI_ADRESLERI.includes(o.hash);
}
