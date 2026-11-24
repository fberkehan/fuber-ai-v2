// Çentiğin hareket kuralı (0.14 T19; Global Constraints "Hafiflik", R15): çentik yalnız `transform` ve `opacity` canlandırır. Genişlik, yükseklik ve köşe
// yarıçapı hiç canlandırılmaz: biçim dokuz dilimdir (CentikSekli.tsx; köşe ve omuz parçaları translate, gövde scale ile büyür). Boşta çizim yok:
// sonsuz animasyon yalnız konuşma ve dinleme hâllerinde durabilir. Kaynak taraması (CSS ayrıştırıcısı yok; ada.css düz kurallardan oluşur).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const oku = (yol: string): string => readFileSync(new URL(`../${yol}`, import.meta.url), 'utf8');
const yorumsuz = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');
const CSS = yorumsuz(oku('src/renderer/ada/ada.css'));
const SEKIL = oku('src/renderer/ada/CentikSekli.tsx');
const IZINLI = new Set(['transform', 'opacity', 'none']);

/** @keyframes adları ve gövdeleri (iç içe tek düzey: `from { … } to { … }`). */
function anahtarKareler(css: string): { ad: string; govde: string }[] {
  const sonuc: { ad: string; govde: string }[] = [];
  const re = /@keyframes\s+([\w-]+)\s*\{/g;
  for (let m = re.exec(css); m; m = re.exec(css)) {
    let derinlik = 1, i = re.lastIndex;
    while (i < css.length && derinlik > 0) { if (css[i] === '{') derinlik++; else if (css[i] === '}') derinlik--; i++; }
    sonuc.push({ ad: m[1], govde: css.slice(re.lastIndex, i - 1) });
  }
  return sonuc;
}
const KARESIZ = anahtarKareler(CSS).reduce((c, k) => c.replace(`@keyframes ${k.ad}`, '').replace(`{${k.govde}}`, ''), CSS);
/** Düz kurallar (seçici + gövde); @media sarmalayıcısının içindekiler de yakalanır. */
const kurallar = (css: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ secici: m[1].trim(), govde: m[2] }));

test('ada.css ve CentikSekli yalnız transform ve opacity canlandırır (width, height, border-radius geçişi yok)', () => {
  for (const m of CSS.matchAll(/transition-property\s*:\s*([^;}]+)/g)) {
    for (const p of m[1].replace(/!important/, '').split(',')) assert.ok(IZINLI.has(p.trim()), `transition-property: ${p.trim()}`);
  }
  for (const m of CSS.matchAll(/(?<![-\w])transition\s*:\s*([^;}]+)/g)) {
    for (const parca of m[1].replace(/!important/, '').split(',')) {
      const ozellik = parca.trim().split(/\s+/)[0];
      assert.ok(IZINLI.has(ozellik), `transition: ${parca.trim()}`);
    }
  }
  const kareler = anahtarKareler(CSS);
  assert.ok(kareler.length > 0);
  for (const k of kareler) {
    for (const m of k.govde.matchAll(/([a-z-]+)\s*:/g)) assert.ok(m[1] === 'transform' || m[1] === 'opacity', `@keyframes ${k.ad}: ${m[1]}`);
  }
  // Kullanılan her animasyonun anahtar kareleri bu dosyada (başka dosyadan gelen, denetlenmemiş hareket yok).
  const adlar = new Set(kareler.map((k) => k.ad));
  for (const m of KARESIZ.matchAll(/animation(?:-name)?\s*:\s*([^;}]+)/g)) {
    const ad = m[1].trim().split(/\s+/)[0];
    if (ad === 'none') continue;
    assert.ok(adlar.has(ad), `animation ${ad} ada.css'te tanımlı değil`);
  }
  // CentikSekli: parçaların biçemi yalnız transform; genişlik/yükseklik/köşe yarıçapı satır içi yazılmaz, geçiş tanımlanmaz.
  assert.doesNotMatch(SEKIL, /style=\{\{[^}]*\b(width|height|borderRadius|left|top)\b/);
  assert.doesNotMatch(SEKIL, /transition/i);
  assert.match(SEKIL, /translate\(/);
  assert.match(SEKIL, /scale\(/);
  // Ada.tsx ses dalgası çubukları yükseklikle değil scaleY ile oynar.
  const ada = oku('src/renderer/ada/Ada.tsx');
  assert.doesNotMatch(ada, /height: `\$\{4 \+ v/);
  assert.match(ada, /scaleY\(/);
});

test("ada.css'te sonsuz animasyon yalnız konuşma ve dinleme hâllerinde", () => {
  for (const k of kurallar(KARESIZ)) {
    if (!/\binfinite\b/.test(k.govde)) continue;
    // 0.14 çentik cilası: medya ÇALARKEN eşitleyici — 0.15 sürüm doğrulaması: YALNIZ açık panelde (kullanıcı çentiğe bakıyor). Kapalı hap boştur:
    // başka bir uygulamada saatlerce müzik çalsa da çentik çizmez (bosta-islemci: 15 sn'de 0 kare; eskiden 1095 kare ve işleyicide %5–7).
    assert.match(k.secici, /\[data-ada-hal='dinliyor'\]|\[data-konusuyor\]|\[data-ada-hal='panel'\]\[data-medya-caliyor\]:not\(\[data-az-hareket\]\)/, `sonsuz animasyon: ${k.secici}`);
  }
});

test('Kapalı hap (boşta, medya başka uygulamada çalıyor): eşitleyici durağan — yalnız tek seferlik giriş, sonsuz döngü yok', () => {
  const kapali = kurallar(KARESIZ).filter((k) => /\.ada__esitleyici/.test(k.secici) && /\banimation\b/.test(k.govde));
  for (const k of kapali) assert.doesNotMatch(k.govde, /\binfinite\b/, `Kapalı hap eşitleyicisinde sonsuz animasyon: ${k.secici}`);
  // Açık panelin medya çubukları çalarken oynar (kullanıcı bakıyor), az harekette oynamaz.
  assert.ok(kurallar(KARESIZ).some((k) => /\[data-ada-hal='panel'\]\[data-medya-caliyor\]:not\(\[data-az-hareket\]\)/.test(k.secici) && /\.panel__medya/.test(k.secici) && /\binfinite\b/.test(k.govde)), 'panelde eşitleyici oynar');
});

test('dokuz dilim: omuz 12 px, haplarda alt köşe boy/2, panelde 28 px; her temada siyah', async () => {
  const { koseYaricapi, OMUZ_PX, PANEL_KOSE_PX } = await import('../src/renderer/ada/centik-olcu.ts');
  assert.equal(OMUZ_PX, 12);
  assert.equal(PANEL_KOSE_PX, 28);
  assert.equal(koseYaricapi(30, false), 15);
  assert.equal(koseYaricapi(44, false), 22);
  assert.equal(koseYaricapi(300, true), 28);
  assert.equal(koseYaricapi(0, false), 0);
  assert.equal(koseYaricapi(20, true), 10, 'kısa içerikli şekilde köşe boyun yarısını aşmaz');
  assert.match(CSS, /\.ada \{[^}]*--ada-zemin: #000;/);
  assert.match(CSS, /:root\[data-tema='acik'\] \.ada \{[^}]*--ada-zemin: #000;/);
});

// 0.14 T28 düzeltme turu 1 (inceleme Important 2): açık panelin boyu sabittir (188) ama alt köşesi plan gereği 28 px — çağrı yerinin kuralı hâle bağlı.
test('köşe kuralı hâle bağlı: açık panel sabit boylu olsa da 28 px; hap ve dinlenme boy/2; Ada.tsx bu kuralı çağırır', async () => {
  const { centikKosesi } = await import('../src/renderer/ada/centik-olcu.ts');
  const { adaOlcusu } = await import('../src/shared/ada.ts');
  const kose = (hal: string) => { const o = adaOlcusu(hal as never); const boy = o.boy === 'icerik' ? 300 : (o.boy as number); return centikKosesi(hal, boy, o.boy === 'icerik'); };
  assert.equal(kose('panel'), 28, 'panel: 28 px (boy/2 = 94 değil)');
  assert.equal(kose('onay'), 28);
  assert.equal(kose('yanit'), 28);
  for (const h of ['dinlenme', 'sessiz', 'uyari', 'bildirim']) assert.equal(kose(h), (adaOlcusu(h as never).boy as number) / 2, `${h} hap kalır`);
  const ada = oku('src/renderer/ada/Ada.tsx');
  assert.match(ada, /kose=\{centikKosesi\(hal, sekilBoy, icerikli\)\}/, 'Ada.tsx köşeyi hâle bağlı kuraldan alır');
  assert.doesNotMatch(ada, /koseYaricapi\(/, 'çağrı yeri hâlsiz kuralı doğrudan kullanmaz');
});

// 0.14 T28 düzeltme turu 1 (inceleme Important 1): sağ yarı sol yarının durağan aynasıdır — her dış kenar tek bir öteleme değerinden geçer, iki yan simetrik.
test('dokuz dilim aynalı: yarım parçalar soldan kurulur, sağ yarı scaleX(-1) kap (canlandırılmaz); dış kenarlar tek öteleme', async () => {
  const { yariParcalari, OMUZ_PX } = await import('../src/renderer/ada/centik-olcu.ts');
  for (const [en, boy, kose] of [[560, 188, 28], [440, 300, 28], [200, 36, 18], [148, 34, 17], [200, 0, 0]]) {
    const yari = en / 2;
    const p = yariParcalari(en, boy, kose, true);
    const bul = (ad: string) => { const x = p.find((y) => y.ad === ad); assert.ok(x, ad); return x; };
    const ust = bul('ust'), alt = bul('alt'), kp = bul('kose'), om = bul('omuz');
    assert.equal(ust.x, -yari, 'üst gövdenin dış kenarı -yari (tek öteleme)');
    assert.equal(kp.x, -yari, 'köşenin dış kenarı -yari (aynı öteleme)');
    assert.equal(om.x, -yari - OMUZ_PX * (boy > 0 ? 1 : 0), 'omuzun dış kenarı -yari − 12');
    if (boy > 0) {
      // Ortada (x = 0) iki yarı en çok yarım px'le örtüşür (düz dolgu: dikiş yok).
      for (const g of [ust, alt]) { const sag = g.x + 100 * g.sx; assert.ok(sag >= 0 && sag <= 0.5 + 1e-9, `${g.ad} ortaya ulaşır (${sag})`); }
      assert.ok(Math.abs(alt.x - (-yari + kose)) <= 0.5, 'alt gövde köşenin bittiği yerden başlar (yarım px örtüşmeyle)');
    }
  }
  assert.doesNotMatch(SEKIL, /--sag/, 'sağ parçalar ayrı hesaplanmaz');
  assert.match(SEKIL, /ada-bicim__yari ada-bicim__yari--ayna/, 'sağ yarı ayna kabında');
  assert.match(SEKIL, /yariParcalari\(/);
  const ayna = kurallar(CSS).find((k) => k.secici === '.ada-bicim__yari--ayna');
  assert.ok(ayna && /transform:\s*scaleX\(-1\)/.test(ayna.govde) && !/transition/.test(ayna.govde), 'ayna kabı durağan scaleX(-1)');
  assert.doesNotMatch(CSS, /\.ada-bicim__(kose|omuz)--sag/, 'sağa özgü köşe/omuz biçimi kalmadı');
});
