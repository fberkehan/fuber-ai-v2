// 0.14 T29: ortak arayüz dili (Nusa / Dynamic Island) — belirteçler ve ortak bileşenler. Derin siyah zemin, hap düğme ve sekme, iri sıkı
// rakam, ekran başına TEK vurgu, yumuşak yay. Burada kaynak sözleşmesi denetlenir (DOM yok, ağ yok): vurgu çözümü (vurgu.ts; 'karakter'
// vurgusu ui/goz/vurgu.ts KIP_VURGUSU'ndan, ikinci kopya yok), ui.css ve fintech.css'in yalnız belirteç rengi kullanması, ortak bileşenlerde
// genişlik/yükseklik geçişi olmaması, düğme ve sekme köşesinin --r-hap olması, sayıların tabular ve sıkı olması, vurgunun üç temada yüzeyde
// ≥ 3:1 kalması. Ekranların kökünü tarayan denetimler sahibi görevlerdedir (T30–T33). Görsel ölçüm: scripts/dev/once-sonra.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { YONETIM_VAR } from './yardimci/ozel.ts';
import { EKRANLAR, SAYFA_VURGUSU, vurguRengi, vurguStili, type EkranAdi } from '../src/renderer/ui/vurgu.ts';
import { KIP_VURGUSU } from '../src/renderer/ui/goz/vurgu.ts';
import { YAY } from '../src/renderer/ui/fintech/yay.ts';
import { renkOku, kontrastOrani, ustune, BEYAZ, acikligiSinirla, srgbOklch } from '../scripts/dev/kontrast.mjs';
import { gizliSayisi, listePlani } from '../src/renderer/pano/sigdir.ts';

const kok = path.resolve(import.meta.dirname, '..');
const oku = (...p: string[]) => fs.readFileSync(path.join(kok, ...p), 'utf8');
const yorumsuz = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const TASARIM = () => yorumsuz(oku('src', 'renderer', 'tasarim.css'));
const UI = () => yorumsuz(oku('src', 'renderer', 'ui', 'ui.css'));
const FINTECH = () => yorumsuz(oku('src', 'renderer', 'ui', 'fintech', 'fintech.css'));

/** Seçicinin İLK kural bloğunun gövdesi (seçici listesinde tek başına geçtiği ilk blok: `seçici {` ya da `seçici, …{`). */
const kural = (css: string, secici: string): string => {
  const i = css.search(new RegExp(`(^|\\n|\\}|,)\\s*${secici.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[{,]`));
  assert.ok(i >= 0, `kural yok: ${secici}`);
  const bas = css.indexOf('{', i + 1);
  return css.slice(bas + 1, css.indexOf('}', bas));
};
/** Bloktaki özel özelliğin değeri. */
const belirtec = (govde: string, ad: string): string | undefined => govde.match(new RegExp(`(?:^|[;{\\s])${ad}:\\s*([^;]+);`))?.[1]?.trim();

test('vurguStili her ekran için tek --vurgu döndürür; \'karakter\' vurgusu kipe göre KARAKTER_VURGUSU\'ndan çözülür (ekran kökü taraması sahibi görevlerde: T30–T33)', () => {
  assert.deepEqual([...EKRANLAR].sort(), ['ayarlar', 'baglantilar', 'gorevler', 'kokpit', 'kurulum', 'sohbet', 'yonetim']);
  assert.deepEqual(SAYFA_VURGUSU, {
    kokpit: '#0A84FF', sohbet: 'karakter', gorevler: '#64D2FF', ayarlar: '#5E5CE6', baglantilar: '#30D158', kurulum: 'karakter', yonetim: '#30D158',
  });
  for (const e of EKRANLAR) {
    for (const kip of [undefined, 'business', 'developer'] as const) {
      const s = vurguStili(e, kip);
      assert.deepEqual(Object.keys(s), ['--vurgu'], `${e}: tek anahtar`);
      assert.match(s['--vurgu'], /^#[0-9A-F]{6}$/, `${e}/${kip}: çözülmüş onaltılık renk`);
      assert.equal(s['--vurgu'], vurguRengi(e, kip));
    }
  }
  // Ürün kararı (4 Kas): vurgu kipi izler — Business Tilki turuncusu, Developer Bukalemun yeşili; kip yoksa Business.
  for (const e of ['sohbet', 'kurulum'] as EkranAdi[]) {
    assert.equal(vurguStili(e, 'business')['--vurgu'], KIP_VURGUSU.business);
    assert.equal(vurguStili(e, 'developer')['--vurgu'], KIP_VURGUSU.developer);
    assert.equal(vurguStili(e)['--vurgu'], KIP_VURGUSU.business);
  }
  // Kip renklerinin ikinci kopyası yok: vurgu.ts ui/goz/vurgu.ts'ten okur, değerleri kendisi yazmaz.
  const kaynak = oku('src', 'renderer', 'ui', 'vurgu.ts');
  for (const r of Object.values(KIP_VURGUSU)) assert.ok(!kaynak.toUpperCase().includes(r.toUpperCase()), `vurgu.ts ${r} rengini kopyalıyor`);
  assert.match(kaynak, /KIP_VURGUSU/);
  // Sabit ekran vurguları karakter vurgusuyla karışmaz (tek vurgu: kipe bağlı olan yalnız 'karakter').
  assert.equal(vurguStili('kokpit', 'developer')['--vurgu'], '#0A84FF');
});

test('belirteçler: --bg #000 (koyu), --r-hap 999px, --sayi-agirlik 640, --sayi-aralik -0.02em, --yay yay.ts ile aynı, --vurgu tanımlı', () => {
  const css = TASARIM();
  const koyu = kural(css, ':root');
  assert.equal(belirtec(koyu, '--bg'), '#000');
  const genel = css.slice(css.indexOf('\n:root {'));
  const g = kural(genel, ':root');
  assert.equal(belirtec(g, '--r-hap'), '999px');
  assert.equal(belirtec(g, '--sayi-agirlik'), '640');
  assert.equal(belirtec(g, '--sayi-aralik'), '-0.02em');
  assert.equal(belirtec(g, '--yay'), YAY.egri, '--yay = yay.ts YAY (tek kaynak)');
  assert.equal(belirtec(g, '--vurgu'), '#0A84FF', '--vurgu varsayılanı (ekran kökü yoksa) düz :root bloğunda');
  // Fuber Yönetim tasarim.css yüklemez: fintech.css aynı değerleri taşır (bu test eşitliği tutar).
  const ft = kural(FINTECH(), ':root');
  assert.equal(belirtec(ft, '--ft-r-hap'), '999px');
  assert.equal(belirtec(ft, '--ft-sayi-agirlik'), '640');
  assert.equal(belirtec(ft, '--ft-sayi-aralik'), '-0.02em');
  assert.equal(belirtec(ft, '--ft-yay'), YAY.egri);
});

test('ui.css ve fintech.css yalnız belirteç renkleri kullanır', () => {
  const sabit = /#[0-9a-fA-F]{3,8}\b|\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\((?!\s*from\s+var\()|[:\s,(](white|black)\s*[;,)]/;
  assert.doesNotMatch(UI(), sabit, 'ui.css');
  // fintech.css: renk değeri yalnız --ft-* belirteç bildiriminde; kurallar belirteç okur.
  const kurallar = FINTECH().replace(/--[\w-]+\s*:[^;]*;/g, '');
  const bul = kurallar.match(sabit);
  assert.equal(bul, null, `fintech.css kuralında sabit renk: ${bul?.[0]} … ${bul ? kurallar.slice(Math.max(0, (bul.index ?? 0) - 80), (bul.index ?? 0) + 20) : ''}`);
});

test('ortak bileşenlerde width/height geçişi yok (hareket yalnız transform ve opacity)', () => {
  const boyutlu = /\b(all|width|height|min-width|min-height|max-width|max-height|inline-size|block-size|left|right|top|bottom)\b/;
  for (const [ad, css] of [['tasarim.css', TASARIM()], ['ui.css', UI()], ['fintech.css', FINTECH()]] as const) {
    for (const m of css.matchAll(/transition(?:-property)?\s*:\s*([^;}]+)/g)) {
      // Süre/eğri belirteçleri ve sayılar düşülür; geriye kalan özellik adları denetlenir.
      const ozellikler = m[1].split(',').map((p) => p.trim().split(/\s+/)[0]);
      for (const o of ozellikler) assert.doesNotMatch(o, boyutlu, `${ad}: "${m[0].slice(0, 90)}"`);
    }
    for (const m of css.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)) {
      // Ayraç eşleyerek gövdeyi al (tek satırlık ve çok satırlık bloklar).
      let d = 1, j = (m.index ?? 0) + m[0].length;
      for (; j < css.length && d; j++) d += css[j] === '{' ? 1 : css[j] === '}' ? -1 : 0;
      const govde = css.slice((m.index ?? 0) + m[0].length, j - 1).replace(/--[\w-]+\s*:[^;]*;/g, '');
      assert.doesNotMatch(govde, /(^|[\s;{])(width|height|max-height|max-width)\s*:/, `${ad}: @keyframes ${m[1]} boyut canlandırıyor`);
      // Düzeltme turu 1 (M1): canlandırma yalnız transform, opacity ve özel özellik. Bilinen istisnalar: tek seferlik kokpit önem parıltısı
      // (onem-parla, isik-supur — kokpit ekranı T30'un) ve işaretlenen maddenin çizgisi (ui-cizgi: text-decoration transform'la çizilemez).
      if (['onem-parla', 'isik-supur', 'ui-cizgi'].includes(m[1])) continue;
      const ozellikler = [...govde.matchAll(/(?:^|[;{\s])([a-z-]+)\s*:/g)].map((x) => x[1]);
      for (const o of ozellikler) assert.ok(['transform', 'opacity'].includes(o), `${ad}: @keyframes ${m[1]} "${o}" canlandırıyor (yalnız transform ve opacity)`);
    }
  }
  // Bileşenler satır içi genişlik/yükseklik geçişi yazmaz; İlerleme dolgusu genişlikle değil ölçekle (scaleX) dolar.
  const klasorler = [path.join(kok, 'src', 'renderer', 'ui'), path.join(kok, 'src', 'renderer', 'ui', 'fintech')];
  for (const k of klasorler) {
    for (const d of fs.readdirSync(k).filter((x) => x.endsWith('.tsx'))) {
      const s = fs.readFileSync(path.join(k, d), 'utf8');
      assert.doesNotMatch(s, /transition\s*:\s*['"`][^'"`]*\b(width|height|all)\b/, `${d}: satır içi boyut geçişi`);
    }
  }
  const ilerleme = oku('src', 'renderer', 'ui', 'Ilerleme.tsx');
  assert.doesNotMatch(ilerleme, /width:\s*`/, 'Ilerleme dolgusu genişlik yazmamalı');
  // Dolgu kaydırılarak dolar (genişlik canlandırılmaz). 0.14 T35 (T29 M2): ölçekle değil, tam genişlikte sola kaydırılır — kap yuvarlak ve
  // overflow: hidden, sol uç kapla kırpılır, sağ uç dolgunun kendi yuvarlağıyla kalır (scaleX ucu eziyordu). Ölçüm araçları artık kırpılmış kutuyu sayar.
  const dolgu = kural(UI(), '.ui-ilerleme__dolgu');
  assert.match(dolgu, /transform:\s*translateX\(calc\(\(var\(--oran, 0\) - 1\) \* 100%\)\)/);
  assert.doesNotMatch(dolgu, /scaleX/, 'scaleX yuvarlak ucu ezer');
  assert.match(kural(UI(), '.ui-ilerleme__cubuk'), /overflow:\s*hidden/, 'kap kırpmazsa kaydırılan dolgu kabın solundan görünür');
});

test('düğme ve sekme köşesi --r-hap', () => {
  const t = TASARIM();
  for (const s of ['.dgm', '.sekmeler', '.sekmeler button']) assert.match(kural(t, s), /border-radius:\s*var\(--r-hap\)/, `tasarim.css ${s}`);
  const f = FINTECH();
  for (const s of ['.ft-hap', '.ft-cip', '.ft-segment', '.ft-segment__kaydirak', '.ft-segment__dgm']) assert.match(kural(f, s), /border-radius:\s*var\(--ft-r-hap\)/, `fintech.css ${s}`);
  // Sekmeler bileşeni ortak .sekmeler hap biçemini taşır (ekranlar aynı sınıfı kullanır).
  const sekme = oku('src', 'renderer', 'ui', 'Sekme.tsx');
  assert.match(sekme, /['"`]sekmeler\b/);
  assert.match(oku('src', 'renderer', 'ui', 'index.ts'), /export \{[^}]*\bSekmeler\b[^}]*\} from '\.\/Sekme'/);
  assert.match(oku('src', 'renderer', 'ui', 'index.ts'), /from '\.\/vurgu'/);
});

test('sayılar tabular ve sıkı', () => {
  const u = UI();
  const sayi = kural(u, '.ui-sayi');
  assert.match(sayi, /font-variant-numeric:\s*tabular-nums/);
  assert.match(sayi, /letter-spacing:\s*var\(--sayi-aralik\)/);
  assert.match(kural(u, '.ui-deger .ui-sayi'), /font-weight:\s*var\(--sayi-agirlik\)/);
  const f = FINTECH();
  for (const s of ['.ft-buyuk-sayi__deger', '.ft-saat__deger']) {
    const g = kural(f, s);
    assert.match(g, /font-variant-numeric:\s*tabular-nums/, s);
    assert.match(g, /font-weight:\s*var\(--ft-sayi-agirlik\)/, s);
    assert.match(g, /letter-spacing:\s*var\(--ft-sayi-aralik\)/, s);
  }
  assert.match(kural(f, '.ft-sayi'), /font-variant-numeric:\s*tabular-nums/);
});

// ── Vurgu yüzeyi (düzeltme turu 1, I2 + M3): oklch açıklık sınırı; her temanın bütün yüzeylerinde ölçülür ──────────────────────────────────
const temaBloklari = () => {
  const css = TASARIM();
  const ft = FINTECH();
  return {
    koyu: kural(css, ':root'), acik: kural(css, ":root[data-tema='acik']"), cam: kural(css, ":root[data-tema='cam']"),
    ftKoyu: kural(ft, ':root'), ftAcik: kural(ft, ":root[data-tema='acik']"),
  };
};
const deger = (ad: string, ...bloklar: string[]) => { for (const b of bloklar) { const v = belirtec(b, ad); if (v) return v; } throw new Error(`belirteç yok: ${ad}`); };
const RENKLER = () => [...new Set([...Object.values(SAYFA_VURGUSU).filter((v) => v !== 'karakter'), ...Object.values(KIP_VURGUSU), '#34C759'])];

test('vurgu yüzeyde üç temada: dolgu/simge ≥ 3:1, yazı ≥ 4,5:1 — oklch açıklığı sınırlanır, ton korunur (kart, kart-2/3, fintech yüzeyleri, Şeffaf en kötü durum)', (t) => {
  const b = temaBloklari();
  const r = (ad: string, ...x: string[]) => renkOku(deger(ad, ...x));
  // Yüzeyler: anahtarın ve ilerlemenin gerçekten durabildiği her zemin (M3).
  const pano = ustune(r('--pano-zemin', b.cam), BEYAZ);
  const temalar = {
    koyu: { bloklar: [b.koyu], zeminler: ['--bg', '--kart', '--kart-2', '--kart-3'].map((z) => r(z, b.koyu)).concat(['--ft-sahne', '--ft-tepsi', '--ft-yuzey', '--ft-yuzey-2', '--ft-yuzey-3'].map((z) => r(z, b.ftKoyu))) },
    acik: { bloklar: [b.acik, b.koyu], zeminler: ['--bg', '--kart', '--kart-2', '--kart-3'].map((z) => r(z, b.acik)).concat(['--ft-sahne', '--ft-tepsi', '--ft-yuzey', '--ft-yuzey-2', '--ft-yuzey-3'].map((z) => r(z, b.ftAcik))) },
    cam: { bloklar: [b.cam, b.koyu], zeminler: [pano, ...['--kart', '--kart-2', '--kart-3', '--dugme-2'].map((z) => ustune(r(z, b.cam), pano))] },
  };
  const dusuk: string[] = [];
  const enKotu: Record<string, string> = {};
  for (const [tema, t] of Object.entries(temalar)) {
    const sinir = (ad: string) => Number(deger(ad, ...t.bloklar));
    const kullanimlar = [['dolgu', sinir('--vurgu-l-taban'), sinir('--vurgu-l-tavan'), Infinity, 3], ['yazı', sinir('--vurgu-yazi-l-taban'), sinir('--vurgu-yazi-l-tavan'), sinir('--vurgu-yazi-c-tavan'), 4.5]] as const;
    for (const [kullanim, taban, tavan, cTavan, esik] of kullanimlar) {
      let min = Infinity;
      for (const renk of RENKLER()) {
        const kaynak = renkOku(renk);
        const v = acikligiSinirla(kaynak, taban, tavan, cTavan);
        // Ton korunur: sınırlanan rengin oklch tonu kaynağınkinden dolguda 12°'den (sRGB gamut kırpması: Şeffaf'ta açılan mavi dolgu ≈ 11°
        // camgöbeğine), yazıda 2°'den fazla sapmaz (yazıda doygunluk da sınırlanır, renk ekrana sığar, kırpma yok). Çamurlaşma yok.
        const [, c0, h0] = srgbOklch(kaynak);
        const [, c1, h1] = srgbOklch(v);
        if (c0 > 0.05 && c1 > 0.05) assert.ok(Math.abs(((h1 - h0 + 540) % 360) - 180) < (kullanim === 'dolgu' ? 12 : 2), `${tema} ${kullanim} ${renk}: ton ${h0.toFixed(1)}° → ${h1.toFixed(1)}°`);
        for (const z of t.zeminler) { const k = kontrastOrani(v, z); min = Math.min(min, k); if (k < esik) dusuk.push(`${tema} ${kullanim} ${renk} ${k.toFixed(2)}:1`); }
      }
      enKotu[`${tema} ${kullanim}`] = min.toFixed(2);
    }
  }
  assert.deepEqual(dusuk, [], JSON.stringify(enKotu));
  t.diagnostic(`en düşük oranlar: ${JSON.stringify(enKotu)}`);
  // Koyu temada dolgu dokunulmaz (kaynak renk aynen).
  assert.equal(deger('--vurgu-l-taban', b.koyu), '0');
  assert.equal(deger('--vurgu-l-tavan', b.koyu), '1');
  // Fintech sınırları tasarim.css ile aynı (Yönetim tasarim.css yüklemez); camda .pano içinde tasarim.css'inkini okur.
  assert.equal(deger('--ft-vurgu-l-taban', b.ftKoyu), deger('--vurgu-l-taban', b.koyu));
  assert.equal(deger('--ft-vurgu-l-tavan', b.ftKoyu), deger('--vurgu-l-tavan', b.koyu));
  assert.equal(deger('--ft-vurgu-l-taban', b.ftAcik), deger('--vurgu-l-taban', b.acik));
  assert.equal(deger('--ft-vurgu-l-tavan', b.ftAcik), deger('--vurgu-l-tavan', b.acik));
  assert.match(kural(FINTECH(), ":root[data-tema='cam'] .pano"), /--ft-vurgu-l-taban:\s*var\(--vurgu-l-taban\);\s*--ft-vurgu-l-tavan:\s*var\(--vurgu-l-tavan\)/);
  // Kurallar bu dönüşümü kullanır (sayfa kökünde --vurgu değişince yüzey rengi de değişir: dönüşüm kuralda, belirteçte değil). Karışım yok.
  const DOLGU = /oklch\(from var\(--vurgu\) clamp\(var\(--vurgu-l-taban\), l, var\(--vurgu-l-tavan\)\) c h\)/;
  assert.match(kural(TASARIM(), ".anahtar[aria-checked='true']"), DOLGU);
  assert.match(kural(UI(), '.ui-ilerleme__dolgu'), DOLGU);
  assert.match(kural(UI(), '.ui-vurgu-simge'), DOLGU);
  assert.match(kural(UI(), '.ui-vurgu-yazi'), /oklch\(from var\(--vurgu\) clamp\(var\(--vurgu-yazi-l-taban\), l, var\(--vurgu-yazi-l-tavan\)\) min\(c, var\(--vurgu-yazi-c-tavan\)\) h\)/);
  assert.match(kural(FINTECH(), ".ft-anahtar[aria-checked='true']"), /oklch\(from var\(--vurgu, var\(--ft-yesil\)\) clamp\(var\(--ft-vurgu-l-taban\), l, var\(--ft-vurgu-l-tavan\)\) c h\)/);
  for (const [ad, css] of [['tasarim.css', TASARIM()], ['ui.css', UI()], ['fintech.css', FINTECH()]] as const) assert.doesNotMatch(css, /color-mix\([^)]*var\(--vurgu/, `${ad}: vurgu sRGB'de karıştırılmaz`);
  // Yönetim'in açık anahtarı (vurgu yok → Apple yeşili #34C759) yine yeşil ve doygun kalır.
  const yesil = acikligiSinirla(renkOku(deger('--ft-yesil', b.ftAcik)), Number(deger('--ft-vurgu-l-taban', b.ftAcik)), Number(deger('--ft-vurgu-l-tavan', b.ftAcik)));
  const [, cy, hy] = srgbOklch(yesil);
  assert.ok(hy > 135 && hy < 155 && cy > 0.15, `Yönetim açık anahtarı yeşil değil: ${yesil.map(Math.round).join(',')}`);
});

test('kök vurgusu alt ağaçta sıfırlanmaz: --vurgu yalnız düz :root\'ta tanımlanır (.koyu-bolge, [data-tema-kutu], .kurulum, .acilis ve tema blokları ezmez; I1)', () => {
  // Bütün biçem dosyaları (masaüstü ve Yönetim): --vurgu bildirimi yalnız tasarim.css'in düz :root bloğunda.
  const dosyalar: string[] = [];
  const tara = (k: string) => { for (const d of fs.readdirSync(k, { withFileTypes: true })) { const p = path.join(k, d.name); if (d.isDirectory()) tara(p); else if (d.name.endsWith('.css')) dosyalar.push(p); } };
  tara(path.join(kok, 'src', 'renderer'));
  if (YONETIM_VAR) tara(path.join(kok, 'yonetim', 'renderer')); // Açık kaynak hazırlığı: genel depoda yonetim/ yok — Yönetim kısmı yalnız özel depoda denetlenir (tests/yardimci/ozel.ts).
  const bulunan: string[] = [];
  for (const p of dosyalar) {
    const css = yorumsuz(fs.readFileSync(p, 'utf8'));
    for (const m of css.matchAll(/(?<![\w-])--vurgu\s*:(?!:)/g)) {
      const bas = css.lastIndexOf('}', m.index ?? 0) + 1;
      const secici = css.slice(bas, css.lastIndexOf('{', m.index ?? 0)).trim();
      bulunan.push(`${path.relative(kok, p)} «${secici}»`);
    }
  }
  assert.deepEqual(bulunan, [`${path.join('src', 'renderer', 'tasarim.css')} «:root»`]);
  // Tema kuran paylaşılan blok yine koyu sınırları kurar (koyu bölge koyu kalır) ama rengi miras bırakır.
  const paylasilan = kural(TASARIM(), ':root');
  assert.equal(belirtec(paylasilan, '--vurgu'), undefined);
  assert.equal(belirtec(paylasilan, '--vurgu-l-tavan'), '1');
  // Satır içi biçem: ekran kökü yalnız --vurgu verir; alt ağaç (çentik .ada.koyu-bolge dahil) onu miras alır (ui-onizle.mjs gerçek pencerede ölçer).
  assert.equal(vurguStili('sohbet', 'developer')['--vurgu'], KIP_VURGUSU.developer);
});

test('kontrast.mjs: Chromium\'un hesaplanmış renk biçimlerini okur (rgb, color(srgb), oklch, oklab, #onaltılık); tanımadığını HATA sayar', () => {
  assert.deepEqual(renkOku('rgb(10, 20, 30)'), [10, 20, 30, 1]);
  assert.deepEqual(renkOku('rgba(0, 0, 0, 0.5)'), [0, 0, 0, 0.5]);
  assert.deepEqual(renkOku('rgb(8 9 12 / 0.8)'), [8, 9, 12, 0.8]);
  assert.deepEqual(renkOku('color(srgb 1 0.5 0 / 0.25)'), [255, 127.5, 0, 0.25]);
  assert.deepEqual(renkOku('#F09532'), [240, 149, 50, 1]);
  assert.deepEqual(renkOku('#fff'), [255, 255, 255, 1]);
  // oklch / oklab: bilinen değerler (CSS Color 4 örnekleri) ± 1 kanal birimi.
  const yakin = (a: number[], b: number[]) => a.slice(0, 3).every((x, i) => Math.abs(x - b[i]) <= 1.01);
  assert.ok(yakin(renkOku('oklch(1 0 0)'), [255, 255, 255]));
  assert.ok(yakin(renkOku('oklch(0 0 none)'), [0, 0, 0]));
  assert.ok(yakin(renkOku('oklch(0.627955 0.257683 29.2339)'), [255, 0, 0]), JSON.stringify(renkOku('oklch(0.627955 0.257683 29.2339)')));
  assert.ok(yakin(renkOku('oklab(0.519975 -0.140454 0.107607)'), [0, 128, 0]), JSON.stringify(renkOku('oklab(0.519975 -0.140454 0.107607)')));
  assert.ok(yakin(renkOku('oklch(62.7955% 0.257683 29.2339)'), [255, 0, 0]), 'yüzdeli açıklık');
  assert.equal(renkOku('oklch(0.5 0.1 200 / 0.4)')[3], 0.4);
  // Gidiş dönüş: sRGB → oklch → sRGB aynı renk; sınırlama tonu korur.
  for (const h of Object.values(SAYFA_VURGUSU).filter((v) => v !== 'karakter')) {
    const [L, C, H] = srgbOklch(renkOku(h));
    assert.ok(yakin(renkOku(`oklch(${L} ${C} ${H})`), renkOku(h)), h);
  }
  // Okunamayan biçim sessizce geçmez.
  for (const kotu of ['color(display-p3 1 0 0)', 'lab(50 20 30)', 'red', 'transparent', 'var(--x)', '']) assert.throws(() => renkOku(kotu), /okunamayan renk/, kotu);
});

// ── 0.14 T31: Görevler, Ayarlar, Bağlantılar (ve Etkinlik) Nusa dilinde — kaynak taraması (JSX; DOM yok). Görsel ölçüm: once-sonra.mjs gorevler|ayarlar|baglantilar|etkinlik.
const tsx = (...p: string[]) => oku('src', 'renderer', ...p);
const AYAR_DOSYALARI = (): [string, string][] => [
  ['sayfalar/Ayarlar.tsx', tsx('sayfalar', 'Ayarlar.tsx')],
  ...fs.readdirSync(path.join(kok, 'src', 'renderer', 'ayarlar')).filter((d) => d.endsWith('.tsx')).map((d): [string, string] => [`ayarlar/${d}`, tsx('ayarlar', d)]),
];
/** `ad` işlevinin gövdesi (bir sonraki üst düzey işleve kadar). */
const islevGovdesi = (s: string, ad: string) => {
  const i = s.indexOf(`function ${ad}(`);
  assert.ok(i >= 0, `${ad} yok`);
  const sonraki = [...s.slice(i + 10).matchAll(/\n(?:export )?function /g)][0];
  return s.slice(i, sonraki ? i + 10 + (sonraki.index ?? 0) : s.length);
};

test('Ayarlar\'ın her kategorisi Anahtar ve Liste bileşenini kullanır (yerel checkbox yok)', () => {
  const kabuk = tsx('sayfalar', 'Ayarlar.tsx');
  // Kategori listesi ortak Liste'yle (her kategori bir satır); arama sonuçları da.
  assert.match(kabuk, /import \{[^}]*\bListe\b[^}]*\} from '\.\.\/ui'/);
  assert.match(kabuk, /kategoriBolumleri\(kategoriler\)\.map\([\s\S]*?<Liste>\s*\{liste\.map\(/, 'kategoriler bölüm başına Liste içinde');
  assert.match(islevGovdesi(kabuk, 'AramaSonuclari'), /<Liste>/, 'arama sonuçları Liste içinde');
  // Ayar satırı aç/kapa: yalnız ortak Anahtar (role="switch", ekranın vurgusuyla dolar); yerel checkbox/radio ve elle yazılmış anahtar yok.
  let anahtarli = 0;
  for (const [ad, s] of AYAR_DOSYALARI()) {
    assert.doesNotMatch(s, /type=["'](checkbox|radio)["']/, `${ad}: yerel checkbox`);
    assert.doesNotMatch(s, /role=["']switch["']|className=["']anahtar["']/, `${ad}: elle yazılmış anahtar (ortak Anahtar kullan)`);
    if (/<Anahtar\b/.test(s)) { anahtarli++; assert.match(s, /import \{[^}]*\bAnahtar\b[^}]*\} from '\.\.\/bilesenler\/Ortak'/, `${ad}: Anahtar ortak bileşenden`); }
  }
  assert.ok(anahtarli >= 6, `Anahtar kullanan ayar dosyası: ${anahtarli}`);
  // Ortak Anahtar ekranın vurgusunu okur (tasarim.css; dolgu vurgudan).
  assert.match(oku('src', 'renderer', 'bilesenler', 'Ortak.tsx'), /export function Anahtar[\s\S]{0,200}role="switch"/);
  // Bağlantılar'da da ("her sohbete") yerel checkbox yok.
  assert.doesNotMatch(tsx('sayfalar', 'Baglantilar.tsx'), /type=["']checkbox["']/);
});

test('Bağlantılar kartları ortak Kart; Gizli\'de katalog kartlarında BULUT_KAPALI_METNI.mcp, web satırında BULUT_KAPALI_METNI.web', () => {
  const s = tsx('sayfalar', 'Baglantilar.tsx');
  assert.match(s, /import \{[^}]*\bKart\b[^}]*\} from '\.\.\/ui'/);
  assert.doesNotMatch(s, /className=["'`]kart kutu/, 'elle yazılmış kart kutusu kalmadı');
  assert.ok((s.match(/<Kart\b/g) ?? []).length >= 5, 'e-posta, WhatsApp, servisler, MCP, öğretme klasörü Kart');
  const katalog = islevGovdesi(s, 'KatalogBolumu');
  // Gizli / "Yalnız bu bilgisayar": katalog kartı önceki kopyadan görünür, kapalı olduğunu söyler; Bağla kapalı ve nedeni ipucunda.
  assert.match(katalog, /<Kart\b[\s\S]*g\.bulutKapali[\s\S]*BULUT_KAPALI_METNI\.mcp/);
  assert.match(katalog, /disabled=\{g\.bulutKapali\} title=\{g\.bulutKapali \? BULUT_KAPALI_METNI\.mcp/);
  // İnternet araması satırı: kapalıyken yalnız BULUT_KAPALI_METNI.web (mutlak söz yok).
  const web = islevGovdesi(s, 'WebSatiri');
  assert.match(web, /data-web-satiri/);
  assert.match(web, /kapali \? BULUT_KAPALI_METNI\.web : WEB_ACIK_METNI/);
  assert.match(katalog, /<WebSatiri kapali=\{bulutKapali\} \/>/);
  assert.match(katalog, /const bulutKapali = g\?\.bulutKapali \?\? yerelKapali;/);
  // Ürün kararı: servis sessiz bir araçtır — ad, simge, TEK kısa satır ve durum (Bağlı / Bağla); tanıtım paragrafı yok, marka logosu yok.
  assert.match(katalog, /<Satir sol=\{<span className="servis__simge">[\s\S]*?altSatir=\{1\}/);
  // Üçüncü taraf logosu yok: tek görsel WhatsApp eşleştirme QR'ı.
  assert.deepEqual([...s.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]), ['<img className="qr" src={qr} alt="WhatsApp QR" />'], 'üçüncü taraf logosu yok');
  for (const m of [/Rozet ton="iyi">Bağlı</, /'Yeniden bağla' : 'Bağla'/]) assert.match(katalog, m);
});

test('görevler, ayarlar ve bağlantılar ekran kökleri tek data-vurgu taşır', () => {
  const tek = (s: string, ad: string) => assert.equal((s.match(/data-vurgu/g) ?? []).length, 1, `${ad}: tek data-vurgu`);
  const ayar = tsx('sayfalar', 'Ayarlar.tsx');
  tek(ayar, 'Ayarlar.tsx');
  assert.match(ayar, /className="ayarlar" data-vurgu="ayarlar" style=\{vurguStili\('ayarlar'\) as CSSProperties\}/);
  // Arama sonucundan gelinen ayarın geçici vurgusu artık data-isaret (kök vurgusuyla karışmaz).
  assert.match(ayar, /setAttribute\('data-isaret', ''\)/);
  assert.doesNotMatch(yorumsuz(oku('src', 'renderer', 'ayarlar', 'ayarlar.css')), /\[data-vurgu\]/);
  const bag = tsx('sayfalar', 'Baglantilar.tsx');
  tek(bag, 'Baglantilar.tsx');
  assert.match(bag, /data-vurgu="baglantilar" style=\{vurguStili\('baglantilar'\) as CSSProperties\}/);
  // M5 (koordinatör kararı): kokpitin içindeki Görevler kartı ayrı ekran kökü DEĞİL — kokpitin tek vurgusunu (mavi) taşır; ikinci vurgu yok.
  const gor = tsx('pano', 'GorevlerKarti.tsx');
  assert.equal((gor.match(/data-vurgu/g) ?? []).length, 0, 'GorevlerKarti kendi kökünü açmaz');
  assert.doesNotMatch(gor, /vurguStili\('gorevler'/, 'kokpitte görev camgöbeği yok');
  assert.match(gor, /<div className="gorev-satir" style=\{vurguStili\('kokpit'\) as CSSProperties\}/, 'portal levhada da kokpit mavisi');
  assert.equal(vurguRengi('kokpit'), '#0A84FF');
  assert.match(tsx('sayfalar', 'Kokpit.tsx'), /className="kokpit" data-vurgu="kokpit" style=\{vurguStili\('kokpit'\)/);
  // Etkinlik (Fuber'in işleri) görevlerin vurgusunu taşır: ayrı ekran adı yok (vurgu.ts EKRANLAR değişmez).
  const etk = tsx('sayfalar', 'Etkinlik.tsx');
  tek(etk, 'Etkinlik.tsx');
  assert.match(etk, /data-vurgu="gorevler" style=\{vurguStili\('gorevler'\) as CSSProperties\}/);
  for (const e of ['gorevler', 'ayarlar', 'baglantilar'] as EkranAdi[]) assert.ok(EKRANLAR.includes(e));
});

test('Görevler\'de Durdur hap düğme', () => {
  const s = islevGovdesi(tsx('pano', 'GorevlerKarti.tsx'), 'GorevSatiriKutusu');
  // Durdur ve Sürdür ortak Dugme (.dgm → border-radius: var(--r-hap)); Durdur'un dur simgesi var, kaba <button> yok.
  assert.match(s, /<Dugme tur="ikincil" boyut="k" simge="dur" data-gorev-eylem="durdur"/);
  assert.match(s, /<Dugme tur="ikincil" boyut="k" data-gorev-eylem="surdur"/);
  assert.doesNotMatch(s, /<button\b/);
  assert.match(kural(TASARIM(), '.dgm'), /border-radius:\s*var\(--r-hap\)/);
  // Görev biçemi hapı ezmez.
  const pano = yorumsuz(oku('src', 'renderer', 'pano', 'pano.css'));
  for (const m of pano.matchAll(/\.gorev-[^{]*\{([^}]*)\}/g)) assert.doesNotMatch(m[1], /border-radius/, m[0].slice(0, 80));
  // Kokpitte yer darsa önce özet satırı bırakılır (ikiSatir planı): iki görev yarım kartta tek görevle boşluk bırakmaz.
  assert.match(tsx('pano', 'GorevlerKarti.tsx'), /<ListeKarti[\s\S]*ikiSatir[\s\S]*satir=\{\(g, iki\) =>/);
});

test('Görevler: kartta bırakılan özet ve "N gönderim" Tümü\'yle erişilir kalır (düzeltme turu 1, I2)', () => {
  type G = { id: number; ozet?: string; gonderim?: number };
  const ikiGorev: G[] = [{ id: 1, ozet: 'Ece henüz yazmadı.', gonderim: 2 }, { id: 2 }];
  const ayrintiVar = (g: G) => Boolean(g.ozet || g.gonderim);
  const plan = listePlani(ikiGorev.length, { ikiSatir: true, ikiEnAz: 2 });
  const zengin = plan.find((a) => a.n === 2 && a.iki)!;
  const sikisik = plan.find((a) => a.n === 2 && !a.iki)!;
  // Her şey sığıyor (özetler görünür): "Tümü" yok.
  assert.equal(gizliSayisi(ikiGorev, zengin, { ikiSatir: true, ayrintiVar }), 0);
  // Satırlar sığdı ama özet bırakıldı (küçük kokpit, 1080×680): ayrıntılı satır kadar gizli sayılır → "Tümü" çıkar.
  assert.equal(gizliSayisi(ikiGorev, sikisik, { ikiSatir: true, ayrintiVar }), 1);
  // Ayrıntısız görevler bırakılınca bir şey kaybolmaz: "Tümü" yok. Sığmayan satırlar eskisi gibi sayılır.
  assert.equal(gizliSayisi([{ id: 3 }, { id: 4 }] as G[], sikisik, { ikiSatir: true, ayrintiVar }), 0);
  assert.equal(gizliSayisi(ikiGorev, { n: 1, iki: false, altlik: false }, { ikiSatir: true, ayrintiVar }), 2);
  // ayrintiVar vermeyen kartlar (hatırlatıcı, öneri) değişmez.
  assert.equal(gizliSayisi(ikiGorev, sikisik, { ikiSatir: true }), 0);
  // Kart gerçekten bunu kullanır: ListeKarti gizliSayisi ile, GorevlerKarti özet ya da gönderim varsa ayrıntı der.
  assert.match(tsx('pano', 'KullaniciKartlari.tsx'), /const gizli = gizliSayisi\(kayitlar, secili, \{ ikiSatir, ayrintiVar \}\)/);
  assert.match(tsx('pano', 'GorevlerKarti.tsx'), /ayrintiVar=\{\(g\) => Boolean\(gorevOzeti\(g, mod\) \|\| gonderimRozeti\(g\)\)\}/);
});

test('Ayarlar: kategori bölüm sınırları ekran okuyucuya söylenir (M6) — her bölüm adlı grup, görünmez başlık', () => {
  const s = tsx('sayfalar', 'Ayarlar.tsx');
  // Her bölüm role="group" + aria-labelledby → aynı kimlikli görünmez <h2> (ui-gizli: yalnız ekran okuyucu).
  assert.match(s, /<div key=\{bolum\} className="ayarlar__bolum" role="group" aria-labelledby=\{`ayar-bolum-\$\{bolum\}`\}/);
  assert.match(s, /<h2 className="ui-gizli" id=\{`ayar-bolum-\$\{bolum\}`\}>\{BOLUM_ADI\[bolum\] \?\? 'Diğer ayarlar'\}<\/h2>/);
  assert.match(oku('src', 'renderer', 'ui', 'ui.css'), /\.ui-gizli \{[^}]*clip-path: inset\(50%\)/);
  // dizin.ts'teki her bölüm numarasının adı var (yeni bölüm adsız kalmaz).
  const numaralar = [...new Set([...oku('src', 'renderer', 'ayarlar', 'dizin.ts').matchAll(/\bbolum: (\d+)/g)].map((m) => Number(m[1])))].sort();
  const adlar = s.match(/BOLUM_ADI[^=]*= \{([^}]*)\}/)?.[1] ?? '';
  for (const n of numaralar) assert.match(adlar, new RegExp(`\\b${n}: '[^']+'`), `bölüm ${n} adsız`);
  // Gruplama sırayı korur: ardışık aynı bölüm tek grup (işlev kaynağı).
  assert.match(s.slice(s.indexOf('export function kategoriBolumleri<'), s.indexOf('/** Bu oturumda en son')), /son && son\.bolum === k\.bolum\) son\.liste\.push\(k\); else gruplar\.push\(\{ bolum: k\.bolum, liste: \[k\] \}\)/);
  // Görünen ayrım grubun üstündeki çizgi (eski li:has seçicisi kalktı).
  const css = yorumsuz(oku('src', 'renderer', 'ayarlar', 'ayarlar.css'));
  assert.match(css, /\.ayarlar__bolum \+ \.ayarlar__bolum::before \{/);
  assert.doesNotMatch(css + s, /data-bolum-basi/);
});

// 0.14 T35 (T30 incelemesi M7): Sohbetler sayfasının düğmeleri ortak Dugme'den — elle yazılmış .dgm düğmesi yok (tür ve boyut tek yerden,
// uzun etiket kırpması ve odak ipucu kütüphanede).
test('Sohbetler: "Yeni", "Arşivle" ve dar listedeki "Sohbetler" düğmesi ortak Dugme', () => {
  const k = oku('src', 'renderer', 'sayfalar', 'Sohbetler.tsx');
  assert.doesNotMatch(k, /<button[^>]*className="dgm\b/, 'elle yazılmış .dgm düğmesi');
  assert.match(k, /import \{[^}]*\bDugme\b[^}]*\} from '\.\.\/ui'/, 'Dugme ui kütüphanesinden');
  assert.match(k, /<Dugme tur="birincil" boyut="k" simge="arti"[^\n]*?>Yeni<\/Dugme>/, '"Yeni" birincil küçük düğme');
  assert.match(k, /<Dugme tur="hayalet" boyut="k" onClick[^\n]*?>Arşivle<\/Dugme>/, '"Arşivle" hayalet küçük düğme');
  assert.match(k, /<Dugme tur="hayalet" boyut="k" simge="liste" aria-label="Sohbetler"/, 'dar listede simgeli "Sohbetler" düğmesi');
});
