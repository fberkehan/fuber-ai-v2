// 0.11 G3: Fuber arayüz kütüphanesinin (src/renderer/ui/) saf yardımcıları — sayı biçimi (tr-TR, tabular), birim yeri, kırpma kararları
// (tahmin ve ölçüm; ölçüm kuralı scripts/dev/tasma.mjs ile aynı pay), liste dilimi ("Tümü"), ilerleme oranı — ve galerinin kapısı: galeri
// YALNIZ test derlemesinde (FUBER_DEMO) ve yalnız #galeri adresinde açılır; ana sayfa onu durağan içe aktarmaz (müşteri paketinde yüklenmez).
// Ayrıca galerinin zorlayıcı fikstürlerinin sözleşmesi (spec §4: 200 karakterlik haber başlığı, 60+ karakterlik tek sözcük, 7 haneli sayı)
// ve ui.css'in yalnız belirteç kullanması. Ağ yok, DOM yok.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  sayiBicim, sayiMetni, birimKonumu, kirpGerekli, kirpildiMi, TASMA_PAYI, listeDilimi, ilerlemeOrani, yuzdeBicim, kartAdlandirma,
} from '../src/renderer/ui/bicim.ts';
import { galeriAcikMi } from '../src/renderer/ui/galeri-kapisi.ts';
import { ZORLAYICI } from '../src/renderer/ui/galeri-veri.ts';

const kok = path.resolve(import.meta.dirname, '..');
const oku = (...p: string[]) => fs.readFileSync(path.join(kok, ...p), 'utf8');

test('sayiBicim: tr-TR binlik nokta, ondalık virgül; sıfır ve 7 haneli sayı', () => {
  assert.equal(sayiBicim(1234567.8, 1), '1.234.567,8');
  assert.equal(sayiBicim(0), '0');
  assert.equal(sayiBicim(1234567), '1.234.567');
  assert.equal(sayiBicim(1234), '1.234');
  assert.equal(sayiBicim(12.5, 2), '12,50', 'ondalık hane sabit (sütunda hizalı)');
  assert.equal(sayiBicim(0, 1), '0,0');
});

test('sayiBicim: eksi işareti tipografik (U+2212); yuvarlanınca sıfır olan eksi işaretsiz; sayı değilse uzun çizgi', () => {
  assert.equal(sayiBicim(-12.5, 1), '−12,5');
  assert.equal(sayiBicim(-0.04, 1), '0,0');
  assert.equal(sayiBicim(-0), '0');
  assert.equal(sayiBicim(Number.NaN), '—');
  assert.equal(sayiBicim(Number.POSITIVE_INFINITY), '—');
});

test('sayiBicim: ondalık hane sayısı tam sayıya indirilir ve 0–6 aralığında tutulur', () => {
  assert.equal(sayiBicim(3.14159, 2.7), '3,14');
  assert.equal(sayiBicim(3.14159, -1), '3');
  assert.equal(sayiBicim(1.5, 99), '1,500000');
});

test('birimKonumu: yüzde önde (Türkçe "%42"), derece bitişik, öteki birimler ayrı; birimsiz "yok"', () => {
  assert.equal(birimKonumu('%'), 'on');
  assert.equal(birimKonumu('°'), 'bitisik');
  assert.equal(birimKonumu('°C'), 'bitisik');
  assert.equal(birimKonumu('TL'), 'ayri');
  assert.equal(birimKonumu('km/sa'), 'ayri');
  assert.equal(birimKonumu(undefined), 'yok');
  assert.equal(birimKonumu(''), 'yok');
  assert.equal(birimKonumu('  '), 'yok');
});

test('sayiMetni: düz metin hâli (ipucu, ekran okuyucu, telefon özeti) — birim yeri birimKonumu ile aynı', () => {
  assert.equal(sayiMetni(42, '%'), '%42');
  assert.equal(sayiMetni(18, '°'), '18°');
  assert.equal(sayiMetni(1234567.8, 'TL', 1), '1.234.567,8 TL');
  assert.equal(sayiMetni(0), '0');
  assert.equal(sayiMetni(-3, '°C'), '−3°C');
  assert.equal(sayiMetni(-0.3, '%', 2), '−%0,30', 'eksi işaret yüzde işaretinin önüne geçer');
  assert.equal(sayiMetni(Number.NaN, '%'), '—', 'sayı yoksa birim de yazılmaz');
});

test('kirpGerekli (tahmin): satır başına karakterle sözcük sözcük sarar; uzun tek sözcük bölünür (overflow-wrap: anywhere)', () => {
  assert.equal(kirpGerekli('a'.repeat(60), 1), true, '60 karakterlik tek sözcük 40 karakterlik satıra sığmaz');
  assert.equal(kirpGerekli('a'.repeat(40), 1), false, 'tam sığan sınırda kırpılmaz');
  assert.equal(kirpGerekli('a'.repeat(41), 1), true);
  assert.equal(kirpGerekli('a'.repeat(80), 2), false, 'iki satıra tam bölünür');
  assert.equal(kirpGerekli('a'.repeat(81), 2), true);
  assert.equal(kirpGerekli('aa bb', 1, 5), false, 'boşlukla birlikte tam sığar');
  assert.equal(kirpGerekli('aa bb', 1, 4), true);
  assert.equal(kirpGerekli('aa bbbbbbbbb', 2, 4), true, 'uzun sözcük yeni satırda başlar, sonra bölünür: 1 + 3 satır');
  assert.equal(kirpGerekli('', 1), false);
  assert.equal(kirpGerekli('   ', 1), false);
  assert.equal(kirpGerekli('kısa', 0), true, '0 satıra hiçbir metin sığmaz');
  assert.equal(kirpGerekli('', 0), false);
});

test('kirpildiMi (ölçüm): kaydırma boyu kutuyu 1 px’ten çok aşıyorsa kırpılmıştır — tasma.mjs ile aynı pay', () => {
  assert.equal(TASMA_PAYI, 1);
  assert.equal(kirpildiMi({ scrollWidth: 200, clientWidth: 200, scrollHeight: 40, clientHeight: 40 }), false);
  assert.equal(kirpildiMi({ scrollWidth: 201, clientWidth: 200, scrollHeight: 41, clientHeight: 40 }), false, 'alt piksel yuvarlaması kırpma değil');
  assert.equal(kirpildiMi({ scrollWidth: 202, clientWidth: 200, scrollHeight: 40, clientHeight: 40 }), true, 'yatay');
  assert.equal(kirpildiMi({ scrollWidth: 200, clientWidth: 200, scrollHeight: 60, clientHeight: 40 }), true, 'dikey (satır sınırı)');
  assert.equal(kirpildiMi({ scrollWidth: 0, clientWidth: 0, scrollHeight: 0, clientHeight: 0 }), false, 'satır içi öğe (boyutsuz) ölçülmez');
});

test('listeDilimi: azami yoksa hepsi; azami kadar görünür, kalan sayılır; geçersiz azami hepsini gösterir', () => {
  const l = [1, 2, 3, 4, 5, 6, 7, 8];
  assert.deepEqual(listeDilimi(l), { gorunen: l, kalan: 0 });
  assert.deepEqual(listeDilimi(l, 3), { gorunen: [1, 2, 3], kalan: 5 });
  assert.deepEqual(listeDilimi(l, 8), { gorunen: l, kalan: 0 });
  assert.deepEqual(listeDilimi(l, 20), { gorunen: l, kalan: 0 });
  assert.deepEqual(listeDilimi(l, 0), { gorunen: [], kalan: 8 });
  assert.deepEqual(listeDilimi(l, 2.9), { gorunen: [1, 2], kalan: 6 });
  assert.deepEqual(listeDilimi(l, -1), { gorunen: l, kalan: 0 });
  assert.deepEqual(listeDilimi(l, Number.NaN), { gorunen: l, kalan: 0 });
  assert.deepEqual(listeDilimi([], 3), { gorunen: [], kalan: 0 });
});

test('ilerlemeOrani ve yuzdeBicim: 0–1 aralığına sıkışır; azami 0 ya da sayı değilse 0', () => {
  assert.equal(ilerlemeOrani(3, 5), 0.6);
  assert.equal(ilerlemeOrani(0, 5), 0);
  assert.equal(ilerlemeOrani(7, 5), 1);
  assert.equal(ilerlemeOrani(-2, 5), 0);
  assert.equal(ilerlemeOrani(3, 0), 0);
  assert.equal(ilerlemeOrani(Number.NaN, 5), 0);
  assert.equal(ilerlemeOrani(1234567, 9999999), 1234567 / 9999999);
  assert.equal(yuzdeBicim(0.6), '%60');
  assert.equal(yuzdeBicim(0), '%0');
  assert.equal(yuzdeBicim(1), '%100');
  assert.equal(yuzdeBicim(0.996), '%100');
  assert.equal(yuzdeBicim(1.7), '%100', 'oran 1’i aşmaz');
});

test('galeriAcikMi: yalnız test derlemesi (demo) VE tam olarak #galeri', () => {
  assert.equal(galeriAcikMi({ demo: true, hash: '#galeri' }), true);
  assert.equal(galeriAcikMi({ demo: false, hash: '#galeri' }), false, 'müşteri derlemesinde asla');
  assert.equal(galeriAcikMi({ demo: undefined, hash: '#galeri' }), false);
  assert.equal(galeriAcikMi({ demo: true, hash: '' }), false);
  assert.equal(galeriAcikMi({ demo: true, hash: '#galeri-x' }), false);
  assert.equal(galeriAcikMi({ demo: true, hash: '#motorlar' }), false);
});

test('ana sayfa galeriyi yalnız kapıdan geçerek ve tembel yükler; preload demo bayrağını yalnız FUBER_DEMO’dan alır', () => {
  const ana = oku('src', 'renderer', 'main.tsx');
  assert.doesNotMatch(ana, /import\s[^;]*from\s+['"]\.\/ui\/Galeri['"]/, 'Galeri durağan içe aktarılırsa müşteri paketinde de yüklenir');
  assert.match(ana, /galeriAcikMi\(\{\s*demo:\s*window\.fuber\?\.demo === true/);
  assert.match(ana, /import\(['"]\.\/ui\/Galeri['"]\)/);
  const on = oku('src', 'preload', 'preload.ts');
  assert.match(on, /demo:\s*Boolean\(process\.env\.FUBER_DEMO\)/);
});

test('galeri fikstürleri spec §4’ün zorlayıcı verilerini taşır (200 karakter başlık, 60+ karakter tek sözcük, 0 ve 7 haneli sayı)', () => {
  assert.equal(ZORLAYICI.haberBasligi.length, 200);
  assert.ok(ZORLAYICI.tekSozcuk.length >= 60 && !/\s/.test(ZORLAYICI.tekSozcuk));
  assert.ok(ZORLAYICI.sehir.length >= 40, 'çok uzun şehir adı');
  assert.equal(String(Math.trunc(ZORLAYICI.yediHane)).length, 7);
  assert.equal(ZORLAYICI.sifir, 0);
  // Kesme işareti ’ (U+2019); düz ' yok.
  assert.doesNotMatch(JSON.stringify(ZORLAYICI), /\w'\w/);
});

test('ui.css renkleri yalnız belirteçlerden okur (sabit renk yok) ve her bileşen dizinden dışa aktarılır', () => {
  const css = oku('src', 'renderer', 'ui', 'ui.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, 'onaltılık renk');
  assert.doesNotMatch(css, /\b(rgba?|hsla?)\(/, 'sabit rgb/hsl');
  assert.match(css, /font-variant-numeric:\s*tabular-nums/);
  assert.match(css, /overflow-wrap:\s*anywhere/);
  assert.match(css, /-webkit-line-clamp/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /forced-colors:\s*active/, 'yüksek karşıtlık modu ayrıca ele alınır');
  const dizin = oku('src', 'renderer', 'ui', 'index.ts');
  for (const ad of ['Kart', 'KartBaslik', 'Satir', 'Liste', 'MetinKirp', 'Rozet', 'Dugme', 'Bos', 'Iskelet', 'Ilerleme', 'Sayi', 'Isaret', 'Ayrac']) {
    assert.match(dizin, new RegExp(`\\b${ad}\\b`), `${ad} dışa aktarılmalı`);
  }
});

// G3 düzeltme turu 1 (inceleme K1–K5): yerleşim kuralları ui.css'te — davranışı ui-onizle.mjs ölçer; burada kural yerinde mi.
const temizCss = () => oku('src', 'renderer', 'ui', 'ui.css').replace(/\/\*[\s\S]*?\*\//g, '');
const kural = (css: string, secici: string): string => {
  const i = css.indexOf(`\n${secici} {`);
  assert.ok(i >= 0, `kural yok: ${secici}`);
  return css.slice(i, css.indexOf('}', i));
};

test('K3: işaretsiz maddede üstü çizgi YOK (yüksek karşıtlıkta saydam çizgi yazı rengine zorlanıp görünüyordu); çizgi yalnız işaretlide', () => {
  const css = temizCss();
  assert.doesNotMatch(kural(css, '.ui-isaret__metin'), /line-through/);
  assert.match(kural(css, ".ui-isaret[aria-checked='true'] .ui-isaret__metin"), /text-decoration-line:\s*line-through/);
  const yk = css.slice(css.indexOf('@media (forced-colors: active)'));
  assert.match(yk, /\.ui-isaret__kutu\s*\{[^}]*border:[^}]*CanvasText/, 'yüksek karşıtlıkta kutunun çerçevesi (box-shadow orada çizilmez)');
});

test('K1/K2: .ui-deger genişliği belli (esnek satırda 0’a çökmez); yoğun kartta "Tümü" düğmesinin odak halkasına yer var', () => {
  const css = temizCss();
  assert.match(kural(css, '.ui-deger'), /width:\s*100%/);
  assert.match(kural(css, '.ui-deger'), /flex:\s*1 1 0/);
  assert.match(kural(css, '.ui-kart--yogun .ui-liste__alt'), /margin-left:\s*-10px/);
});

test('K5: iskelet satırı Satir ile AYNI yazı ölçülerinden (başlık/alt satır yüksekliği tek kaynaktan); alt ve başlık satır sayısı seçilir', () => {
  const css = temizCss();
  assert.match(kural(css, '.ui-satir__baslik'), /var\(--ui-baslik-yazi\)/);
  assert.match(kural(css, '.ui-satir__alt'), /var\(--ui-alt-yazi\)/);
  assert.match(kural(css, '.ui-iskelet__b'), /calc\(var\(--ui-baslik-yazi\)\s*\*\s*var\(--ui-baslik-satir\)\)/);
  assert.match(kural(css, '.ui-iskelet__a'), /calc\(var\(--ui-alt-yazi\)\s*\*\s*var\(--ui-alt-satir\)\)/);
  const isk = oku('src', 'renderer', 'ui', 'Iskelet.tsx');
  assert.match(isk, /alt\?: boolean/);
  assert.match(isk, /baslikSatiri\?: 1 \| 2/);
});

test('K4: Dugme metin etiketinin tamamı title’da ve klavye odağında okunur (kırpılınca); erişilebilir ad içerikten kalır', () => {
  const d = oku('src', 'renderer', 'ui', 'Dugme.tsx');
  assert.match(d, /typeof children === 'string'/);
  assert.match(d, /useOdakIpucu/);
  assert.doesNotMatch(d, /aria-label=\{[^}]*children/, 'görünen yazı erişilebilir addır; aria-label ile ezilmez');
});

test('G4 K2: Kart adı — verilmiş aria-label (ör. kokpitin "Önem: acil" grup adı) başlığın aria-labelledby\'sine EZİLMEZ; yoksa başlığa bağlanır', () => {
  assert.deepEqual(kartAdlandirma('Yapılacaklar', 'h1', {}), { 'aria-labelledby': 'h1' }, 'etiket yok: başlık kartın adıdır');
  assert.deepEqual(kartAdlandirma('Yapılacaklar', 'h1', { 'aria-label': 'Önem: acil' }), {}, 'çağıranın etiketi kazanır');
  assert.deepEqual(kartAdlandirma('Yapılacaklar', 'h1', { 'aria-labelledby': 'dis' }), { 'aria-labelledby': 'h1' }, 'etiketsiz kartta başlık, G3\'teki gibi, kartın adıdır');
  assert.deepEqual(kartAdlandirma(undefined, 'h1', {}), {}, 'başlıksız kart');
  assert.deepEqual(kartAdlandirma(undefined, 'h1', { 'aria-labelledby': 'dis' }), { 'aria-labelledby': 'dis' }, 'başlıksız kartta çağıranın aria-labelledby\'si korunur');
  assert.deepEqual(kartAdlandirma('', 'h1', { 'aria-label': 'Önem: dikkat', 'aria-labelledby': 'dis' }), {}, 'aria-label varsa aria-labelledby koyulmaz');
  const k = oku('src', 'renderer', 'ui', 'Kart.tsx');
  assert.match(k, /kartAdlandirma\(/, 'Kart adlandırmayı bu yardımcıdan alır');
  assert.doesNotMatch(k, /aria-labelledby=\{baslik \?/, 'başlık, çağıranın etiketini ezen koşulsuz bağ değildir');
});
