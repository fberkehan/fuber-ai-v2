// ── Ekran vurgusu (0.14 T29; saf; tests/arayuz-dili.test.ts) — Nusa / Dynamic Island dili: her ekranın TEK vurgu rengi ──────────────────────
// Ekranın kökü `style={vurguStili(ekran, kip)}` taşır; ortak bileşenler (anahtar, ilerleme) `--vurgu`yu okur (tasarim.css, ui.css, fintech.css).
// Yüzeydeki renk temaya göre kuralda karışır: color-mix(in srgb, var(--vurgu) var(--vurgu-oran), var(--ink)) — koyuda düz, açıkta koyulaşır,
// Şeffaf'ta açılır; üç temada yüzeyde ≥ 3:1 (test ölçer). Vurgu yazı rengi olarak kullanılmaz (yazı ≥ 4,5:1 nötr belirteçlerden).
// 'karakter': sohbet ve kurulum kipin rengini izler (ürün kararı, 4 Kas): Business mode turuncu, Developer mode yeşil —
// değer YALNIZ ui/goz/vurgu.ts KIP_VURGUSU'ndan okunur (ikinci kopya yok; gözlerin parıltısı da). Sade modda (T6b) göz yoktur ama vurgu aynı kalır: Sade işareti
// (SadeIsaret.tsx) de kipin bu rengini taşır; renk kipi anlatır. Ekran kökü taramaları sahibi görevlerde (T30–T33).
import type { KipKimligi } from '../../shared/karakterler.ts';
import { KIP_VURGUSU } from './goz/vurgu.ts';

export type EkranAdi = 'kokpit' | 'sohbet' | 'gorevler' | 'ayarlar' | 'baglantilar' | 'kurulum' | 'yonetim';
export const EKRANLAR: readonly EkranAdi[] = ['kokpit', 'sohbet', 'gorevler', 'ayarlar', 'baglantilar', 'kurulum', 'yonetim'];

/** Ekran → vurgu. 'karakter' kipe göre çözülür (vurguRengi). */
export const SAYFA_VURGUSU: Readonly<Record<EkranAdi, string | 'karakter'>> = {
  kokpit: '#0A84FF',
  sohbet: 'karakter',
  gorevler: '#64D2FF',
  ayarlar: '#5E5CE6',
  baglantilar: '#30D158',
  kurulum: 'karakter',
  yonetim: '#30D158',
};

/** Ekranın çözülmüş vurgu rengi (büyük harfli onaltılık). Kip verilmezse Business mode. */
export function vurguRengi(ekran: EkranAdi, kip: KipKimligi = 'business'): string {
  const v = SAYFA_VURGUSU[ekran];
  return (v === 'karakter' ? (kip === 'developer' ? KIP_VURGUSU.developer : KIP_VURGUSU.business) : v).toUpperCase();
}

/** Ekran kökünün satır içi biçemi: yalnız `--vurgu`. */
export function vurguStili(ekran: EkranAdi, kip?: KipKimligi): { '--vurgu': string } {
  return { '--vurgu': vurguRengi(ekran, kip) };
}
