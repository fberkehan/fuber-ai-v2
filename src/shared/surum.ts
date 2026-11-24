// ── Görünen sürüm etiketi (0.11 G12b, spec §10; 0.13: "uygulamada sürüm görünen yerde 0.13.0 beta") ─────────────────────────────────
// Beta soneki YALNIZ görünen yazıdadır (Ayarlar → Genel → Hakkında); kurulum dosyasının adı, app.getVersion() ve sunucuya giden sürüm
// package.json'dan olduğu gibi gelir ("0.13.0"). Beta bitince bu satır tek yerde kalkar. Birim testli: tests/surum-ve-metin.test.ts.
export const SURUM_SONEKI = 'beta';

/** "0.13.0" → "0.13.0 beta"; sürüm henüz bilinmiyorsa ('' — durum:al gelmedi) etiket yok. */
export function surumEtiketi(surum: string): string {
  return surum ? `${surum} ${SURUM_SONEKI}` : '';
}
