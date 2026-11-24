// ── Ada penceresinin konumu: saf hesap (birim testli: tests/ada-konum.test.ts) ──────────────────────────────────
// Ayrı dosya çünkü ada.ts Electron'u içe aktarır, testler (node --test) ise .ts'yi doğrudan yükler: burada Electron'dan yalnız tür içe aktarması var.
// Pencere kutusu src/shared/ada.ts `ADA_PENCERE` × ölçektir (0.14 R15; ölçek `centikOlcegi`, ekranın DIP enine göre).
// 0.14 T19 (Review Focus 1): `centikYerlesimi` imlecin bulunduğu ekranı seçer (yoksa en yakınını) ve çentiği o ekranın üst ortasına, o ekranın
// ölçeğiyle kurar. Ana süreç bunu her gösterimde ve ekran olaylarında (eklendi, söküldü, ölçek değişti) çağırır; imleç yoklanmaz.
import type { Rectangle } from 'electron';
import { ADA_PENCERE, centikOlcegi } from '../shared/ada.ts';

/**
 * Ada penceresinin yeri: ekranın ÜST ORTASI, üst kenara yapışık. Görev çubuğu ya da menü çubuğu üstte olsa bile
 * `bounds` esas alınır (Windows'ta ada görev çubuğunun üstüne biner, macOS'ta menü çubuğunun üstünde durur).
 * Formül iki platformda aynıdır; `platform` Mac'e özgü ayrışma gerekirse (Faz 2) diye imzada durur. `olcek`: R15 (yuvarlanır).
 */
export function adaKonumu(ekran: { bounds: Rectangle; workArea: Rectangle }, platform: string, olcek = 1): Rectangle {
  const en = Math.round(ADA_PENCERE.en * olcek), boy = Math.round(ADA_PENCERE.boy * olcek);
  return { x: ekran.bounds.x + Math.round((ekran.bounds.width - en) / 2), y: ekran.bounds.y, width: en, height: boy };
}

/**
 * Çentikli (notch) Mac ekranı mı? Çentikli ekranda menü çubuğu çentik kadar yüksektir: çalışma alanı üst kenardan en az
 * 32 px aşağıda başlar. Windows'ta çentik yoktur (üstteki görev çubuğu da çalışma alanını iter, çentik sayılmaz).
 */
export function adaCentikli(ekran: { bounds: Rectangle; workArea: Rectangle }, platform: string): boolean {
  return platform === 'darwin' && ekran.workArea.y - ekran.bounds.y >= 32;
}

/** Electron `Display`'inin bu hesabın kullandığı parçası (test sahte ekranla çağırır). */
export interface CentikEkrani { id: number; bounds: Rectangle; workArea: Rectangle; scaleFactor: number }

/** Noktanın dikdörtgene uzaklığı (içindeyse 0). Sağ ve alt kenar dikdörtgene dahil değildir (komşu ekranın sol kenarı). */
function uzaklik(r: Rectangle, p: { x: number; y: number }): number {
  const dx = p.x < r.x ? r.x - p.x : p.x >= r.x + r.width ? p.x - (r.x + r.width - 1) : 0;
  const dy = p.y < r.y ? r.y - p.y : p.y >= r.y + r.height ? p.y - (r.y + r.height - 1) : 0;
  return Math.hypot(dx, dy);
}

/**
 * Çentik hangi ekranda, hangi kutuda, hangi ölçekte? İmlecin ekranı (yoksa en yakın ekran; eşitlikte listedeki ilk). Ölçek o ekranın DIP enine göre
 * (`centikOlcegi`); `scaleFactor` (Windows ölçeği) DIP'e zaten yansıdığından ölçeği ayrıca değiştirmez — keskinliği Chromium o ekranın ölçeğiyle çizerek
 * sağlar. Ekran yoksa (bilinmeyen kısa an) taban kutu, `ekranId` -1.
 */
export function centikYerlesimi(ekranlar: readonly CentikEkrani[], imlec: { x: number; y: number }): { ekranId: number; kutu: Rectangle; olcek: number } {
  let secilen: CentikEkrani | undefined;
  let en = Infinity;
  for (const e of ekranlar) {
    const u = uzaklik(e.bounds, imlec);
    if (u < en) { en = u; secilen = e; }
  }
  if (!secilen) return { ekranId: -1, kutu: { x: 0, y: 0, width: ADA_PENCERE.en, height: ADA_PENCERE.boy }, olcek: 1 };
  const olcek = centikOlcegi(secilen.bounds.width);
  return { ekranId: secilen.id, kutu: adaKonumu(secilen, '', olcek), olcek };
}
