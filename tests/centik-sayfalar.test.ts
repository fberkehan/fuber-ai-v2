// Çentiğin açık paneli (0.14 T23): sayfa sırası ayarı, gezinme ve tekerlek (saf işlevler) + panelin kaynak kuralları (sayfa kaydı, boş durum, yalnız
// transform ve opacity). Pencere yok.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PANEL_SAYFALARI, TEKERLEK_ESIGI, VARSAYILAN_SAYFA_SIRASI, acikSayfalar, komsuSayfa, sayfaAyariDogrula, sayfaVurgusu, tekerlekBirikimi, type SayfaKimligi,
} from '../src/shared/centik-sayfalar.ts';
import { KIP_VURGUSU } from '../src/renderer/ui/goz/vurgu.ts';

const kaynakOku = (yol: string): string => readFileSync(new URL(`../${yol}`, import.meta.url), 'utf8');

test('varsayılan sıra dokuz sayfa, Asistan başta, hepsi açık', () => {
  assert.equal(VARSAYILAN_SAYFA_SIRASI.length, 9);
  assert.equal(VARSAYILAN_SAYFA_SIRASI[0], 'asistan');
  assert.deepEqual([...VARSAYILAN_SAYFA_SIRASI].sort(), Object.keys(PANEL_SAYFALARI).sort());
  assert.deepEqual(sayfaAyariDogrula(undefined), { sira: [...VARSAYILAN_SAYFA_SIRASI], kapali: [] });
  assert.deepEqual(acikSayfalar(undefined), [...VARSAYILAN_SAYFA_SIRASI]);
});

test('sayfa renkleri brief\'teki gibi; Asistan kipin rengini alır (ui/goz/vurgu.ts tek kaynak)', () => {
  const beklenen: Partial<Record<SayfaKimligi, string>> = {
    gundem: '#5E5CE6', gorevler: '#64D2FF', gelenler: '#FFD60A', muzik: '#FF375F', soz: '#BF5AF2', odak: '#FF453A', yapilacaklar: '#30D158', raf: '#0A84FF',
  };
  for (const [id, renk] of Object.entries(beklenen)) assert.equal(PANEL_SAYFALARI[id as SayfaKimligi].vurgu, renk, id);
  assert.equal(KIP_VURGUSU.business, '#F09532', 'ürün kararı: Business');
  assert.equal(KIP_VURGUSU.developer, '#67AD58', 'ürün kararı: Developer');
  assert.equal(sayfaVurgusu('asistan', 'is'), KIP_VURGUSU.business);
  assert.equal(sayfaVurgusu('asistan', 'gelistirici'), KIP_VURGUSU.developer);
  assert.equal(sayfaVurgusu('asistan', 'developer'), KIP_VURGUSU.developer, 'gözlerin kipi de olur');
  assert.equal(sayfaVurgusu('asistan', 'business'), KIP_VURGUSU.business);
  assert.equal(sayfaVurgusu('raf', 'gelistirici'), '#0A84FF');
  assert.equal(PANEL_SAYFALARI.asistan.ad, 'Asistan');
  assert.equal(PANEL_SAYFALARI.soz.ad, 'Şarkı sözü');
});

test('bilinmeyen sayfa düşer, tekrar düşer, Asistan kapatılamaz', () => {
  const d = sayfaAyariDogrula({ sira: ['raf', 'yok', 'raf', 'asistan', 42, 'muzik'], kapali: ['asistan', 'muzik', 'muzik', 'bilinmez'] });
  assert.deepEqual(d.sira.slice(0, 3), ['raf', 'asistan', 'muzik'], 'kullanıcının sırası korunur; Asistan da yer değiştirebilir');
  assert.equal(d.sira.length, 9, 'eksik sayfalar sona eklenir, kaybolmaz');
  assert.equal(new Set(d.sira).size, 9);
  assert.deepEqual(d.kapali, ['muzik']);
  assert.ok(acikSayfalar({ kapali: ['asistan'] }).includes('asistan'));
  assert.deepEqual(sayfaAyariDogrula('bozuk'), { sira: [...VARSAYILAN_SAYFA_SIRASI], kapali: [] });
  assert.deepEqual(sayfaAyariDogrula({ sira: 'raf', kapali: null }), { sira: [...VARSAYILAN_SAYFA_SIRASI], kapali: [] });
});

test('komsuSayfa uçta null', () => {
  const s: SayfaKimligi[] = ['asistan', 'gundem', 'raf'];
  assert.equal(komsuSayfa(s, 'asistan', 1), 'gundem');
  assert.equal(komsuSayfa(s, 'gundem', -1), 'asistan');
  assert.equal(komsuSayfa(s, 'asistan', -1), null, 'baş: sarmaz');
  assert.equal(komsuSayfa(s, 'raf', 1), null, 'son: sarmaz');
  assert.equal(komsuSayfa(s, 'odak', 1), null, 'sırada olmayan sayfa');
});

test('tekerlek 60 birimde bir adım', () => {
  assert.equal(TEKERLEK_ESIGI, 60);
  let b = 0;
  const adimlar: number[] = [];
  for (const d of [20, 20, 19]) { const r = tekerlekBirikimi(b, d); b = r.birikim; adimlar.push(r.adim); }
  assert.deepEqual(adimlar, [0, 0, 0], '59 birim adım vermez');
  const r = tekerlekBirikimi(b, 1);
  assert.deepEqual(r, { birikim: 0, adim: 1 }, '60. birimde bir adım, birikim sıfırlanır');
  assert.deepEqual(tekerlekBirikimi(0, -120), { birikim: 0, adim: -1 }, 'büyük tek olay da yalnız bir adım');
  assert.deepEqual(tekerlekBirikimi(50, -10), { birikim: -10, adim: 0 }, 'yön değişince birikim yeni yönden başlar');
  assert.deepEqual(tekerlekBirikimi(10, Number.NaN), { birikim: 10, adim: 0 });
});

test('kaydı olmayan sayfa gizlenmez, tek satır boş durum gösterir', () => {
  const p = kaynakOku('src/renderer/ada/Panel.tsx');
  assert.match(p, /export function sayfaKaydet\(id: SayfaKimligi, bilesen: ComponentType\): void/);
  assert.match(p, /data-sayfa-bos=/, 'boş durum satırı');
  assert.match(p, />Bağla</, '"Bağla" düğmesi');
  assert.doesNotMatch(p, /Yakında/, 'boş durum "Yakında" demez');
  // Asistan bu görevde kayıtlı; öbür sayfalar T24–T27'de (tek satır).
  assert.match(p, /sayfaKaydet\('asistan', Asistan\)/);
  // Gezinme: noktalar, oklar (uçtakini gizler), ← → tuşları, tekerlek eşiği.
  assert.match(p, /komsuSayfa\(/);
  assert.match(p, /tekerlekBirikimi\(/);
  assert.match(p, /ArrowLeft/);
  assert.match(p, /ArrowRight/);
});

test('Panel.tsx ve panel.css yalnız transform ve opacity canlandırır', () => {
  const css = kaynakOku('src/renderer/ada/panel.css');
  for (const m of css.matchAll(/transition(?:-property)?\s*:\s*([^;]+);/g)) {
    for (const parca of m[1].split(',')) {
      const ozellik = parca.trim().split(/\s+/)[0];
      assert.ok(['transform', 'opacity', 'none'].includes(ozellik), `geçiş yalnız transform/opacity: ${parca.trim()}`);
    }
  }
  for (const m of css.matchAll(/@keyframes [\w-]+\s*\{([\s\S]*?)\n\}/g)) {
    for (const ozellik of m[1].matchAll(/([a-z-]+)\s*:/g)) assert.ok(['transform', 'opacity'].includes(ozellik[1]), `kare yalnız transform/opacity: ${ozellik[1]}`);
  }
  assert.doesNotMatch(css, /infinite/, 'boşta sonsuz animasyon yok');
  const p = kaynakOku('src/renderer/ada/Panel.tsx') + kaynakOku('src/renderer/ada/sayfalar/Asistan.tsx');
  assert.doesNotMatch(p, /requestAnimationFrame|setInterval/, 'panelde çizim döngüsü yok');
  assert.match(kaynakOku('src/renderer/ada/Panel.tsx'), /Intl\.DateTimeFormat/, 'tarih ve saat uygulama dilinde');
});
