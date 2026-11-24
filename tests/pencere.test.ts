// Görev 22 (K12/K13): kendi pencere düğmelerimiz ve ikon ailesi.
//  - Windows'ta Windows'un saydam başlık şeridi kaplaması (titleBarOverlay) hiçbir pencerede kalmaz; macOS'ta trafik ışıkları
//    şeridin ortasına oturtulur.
//  - Eylem doğrulama, düğme adları, ikon seçimi (pencere .ico, tepsi görev çubuğu temasına göre).
//  - Üretilmiş ikon dosyaları (0.12: mini logo, scripts/ikon-uret.mjs): çok boylu ICO (küçük boylar optik ayarlı BMP; 256 PNG),
//    macOS .icns, zeminsiz tepsi ailesi, kurulum rozeti; üretici tekrar üretilebilir; arayüzdeki mini logo aynı kaynak SVG'den.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { MOBIL_VAR, ozelGerekli } from './yardimci/ozel.ts';
import { baslikAyari, eylemCoz, dugmeAdi, ozelDugmeler, pencereIkonuAdi, tepsiIkonuAdi } from '../src/shared/pencere.ts';
import { URUN_VB, URUN_YOLLAR, URUN_GECISLER, MINI_VB, MINI_YOLLAR, MINI_EN, MINI_BOY, MINI_CIZGI, MINI_EN_DAR_BOSLUK, miniKalinlik } from '../src/shared/urun-isareti.ts';

const KOK = path.resolve(import.meta.dirname, '..');

test('başlık ayarı: Windows/Linux kaplamasız gizli başlık; macOS trafik ışıkları şeridin ortasında', () => {
  assert.deepEqual(baslikAyari('win32', 38), { titleBarStyle: 'hidden' });
  assert.deepEqual(baslikAyari('linux', 48), { titleBarStyle: 'hidden' });
  // Ana pencere: 38 px şerit, 68 px ray → ışıklar rayın ortasında (8 px), dikeyde (38 − 12) / 2 = 13.
  assert.deepEqual(baslikAyari('darwin', 38, 68), { titleBarStyle: 'hidden', trafficLightPosition: { x: 8, y: 13 } });
  // Fuber Tarayıcı: 48 px araç çubuğu, soldan 14 px.
  assert.deepEqual(baslikAyari('darwin', 48), { titleBarStyle: 'hidden', trafficLightPosition: { x: 14, y: 18 } });
  assert.equal(ozelDugmeler('win32'), true);
  assert.equal(ozelDugmeler('darwin'), false);
  assert.equal(ozelDugmeler('cep'), false); // telefon arayüzü: pencere yok
});

test('pencere eylemi yalnız küçült / büyüt / kapat', () => {
  for (const e of ['kucult', 'buyut', 'kapat'] as const) assert.equal(eylemCoz(e), e);
  for (const e of ['close', 'KAPAT', '', null, undefined, 1, { e: 'kapat' }]) assert.equal(eylemCoz(e), null);
});

test('düğme adları: büyütülmüşken "Önceki boyutuna getir"; ana pencerede kapat tepsiye gizler', () => {
  const normal = { buyuk: false, tamEkran: false, odak: true }, buyuk = { buyuk: true, tamEkran: false, odak: true };
  assert.equal(dugmeAdi('kucult', normal), 'Simge durumuna küçült');
  assert.equal(dugmeAdi('buyut', normal), 'Ekranı kapla');
  assert.equal(dugmeAdi('buyut', buyuk), 'Önceki boyutuna getir');
  assert.equal(dugmeAdi('kapat', normal), 'Kapat');
  assert.match(dugmeAdi('kapat', normal, true), /tepside/);
});

test('ikon seçimi: Windows pencere .ico; tepsi görev çubuğunun temasına göre; macOS şablon', () => {
  assert.equal(pencereIkonuAdi('win32'), 'fuber.ico');
  assert.equal(pencereIkonuAdi('darwin'), 'fuber.png');
  assert.equal(tepsiIkonuAdi('win32', true), 'tepsi-koyu.ico');
  assert.equal(tepsiIkonuAdi('win32', false), 'tepsi-acik.ico');
  assert.equal(tepsiIkonuAdi('darwin', true), 'tepsiTemplate.png');
  for (const ad of ['fuber.ico', 'fuber.png', 'tepsi-koyu.ico', 'tepsi-acik.ico', 'tepsiTemplate.png', 'tepsiTemplate@2x.png']) {
    assert.ok(fs.existsSync(path.join(KOK, 'resources/ikon', ad)), `resources/ikon/${ad} yok (node scripts/ikon-uret.mjs)`);
  }
});

test('Windows başlık şeridi kaplaması (titleBarOverlay) hiçbir pencerede yok', () => {
  for (const dosya of ['src/main/main.ts', 'src/main/tarayici.ts', 'src/main/tema.ts', 'src/main/pencere-kabugu.ts']) {
    const k = fs.readFileSync(path.join(KOK, dosya), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/titleBarOverlay|setTitleBarOverlay/.test(k), `${dosya} hâlâ başlık şeridi kaplaması kullanıyor`);
  }
});

// Görev 23 (G22 küçüğü): düğmelerin odak dışında sönmesi PENCERENİN odağına bağlı (belgenin focus/blur'una değil — Fuber Tarayıcı'da
// sayfa ayrı görünüm); kabukBagla iki pencerede de kurulur ve bildirim yok edilmiş pencereye/webContents'e gönderilmez. Kaynak taraması.
test('kabukBagla: focus/blur ve büyüt/tam ekran olayları bağlı, durum pencerenin odağından; ana pencere ve Fuber Tarayıcı bağlı; isDestroyed korumaları', () => {
  const temiz = (dosya: string) => fs.readFileSync(path.join(KOK, dosya), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const k = temiz('src/main/pencere-kabugu.ts');
  const govde = k.match(/export function kabukBagla\([^)]*\)[^{]*\{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.ok(govde, 'kabukBagla gövdesi bulunamadı');
  for (const olay of ['focus', 'blur', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'restore']) assert.match(govde, new RegExp(`'${olay}'`), `${olay} olayı bağlı değil`);
  assert.match(govde, /w\.on\(/, 'olaylar pencereye bağlanmıyor');
  assert.match(govde, /!w\.isDestroyed\(\)/, 'pencere yok edilmişken bildiriliyor');
  assert.match(govde, /!w\.webContents\.isDestroyed\(\)/, 'webContents yok edilmişken bildiriliyor');
  assert.match(k, /odak:\s*w\.isFocused\(\)/, 'odak pencereden okunmuyor');
  assert.doesNotMatch(govde, /document|webContents\.on\('(focus|blur)'/, 'odak belgeden okunuyor');
  for (const dosya of ['src/main/main.ts', 'src/main/tarayici.ts']) assert.match(temiz(dosya), /kabukBagla\(\w+\)/, `${dosya} kabukBagla çağırmıyor`);
});

// 0.12: Fuber AI'nin işareti mini logodur — arayüz (shared/urun-isareti.ts MINI_*) ve ikon üreticisi (scripts/ikon-uret.mjs,
// dosyayı kendisi okur) AYNI kaynak dosyadan: resources/ikon/kaynak/fuber-ai-mini.svg.
test('mini logo tek kaynaktan: arayüzdeki yollar ve viewBox kaynak SVG dosyasıyla birebir; üretici aynı dosyayı okur', async () => {
  const svg = fs.readFileSync(path.join(KOK, 'resources/ikon/kaynak/fuber-ai-mini.svg'), 'utf8');
  const yollar = [...svg.matchAll(/<path\b[^>]*\sd="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...MINI_YOLLAR], yollar);
  assert.equal(MINI_VB, svg.match(/viewBox="([^"]+)"/)?.[1]);
  assert.equal(`0 0 ${MINI_EN} ${MINI_BOY}`, MINI_VB);
  const uret = await import('../scripts/ikon-uret.mjs');
  assert.deepEqual(uret.svgOku().yollar, yollar);
  // Arayüzde F + iki nokta yalnız Fuber Yönetim'in FuberIsareti'nde kalır; Fuber AI ekranları MiniLogo / UrunIsareti kullanır.
  const ekranlar = (fs.readdirSync(path.join(KOK, 'src/renderer'), { recursive: true }) as string[]).filter((d) => d.endsWith('.tsx'));
  for (const d of ekranlar) {
    const k = fs.readFileSync(path.join(KOK, 'src/renderer', d), 'utf8');
    if (d.replace(/\\/g, '/') === 'ui/fintech/Isaret.tsx') continue;
    assert.doesNotMatch(k, /<FuberIsareti\b|URUN_YOLLAR|<FHarf\b|function FHarf\b/, `src/renderer/${d} eski işareti (F + iki nokta / F harfi) kullanıyor`);
  }
});

test('mini logo küçük boyda optik kalınlaşır ama iç boşlukları KAPATMAZ: 20–24 px toplam ~1,2 px; 10–16 px en dar boşluk ≥ 0,2 px açık; 40 px+ kaynağın kendisi', async () => {
  const toplamPx = (olcu: number) => ((MINI_CIZGI + miniKalinlik(olcu)) * olcu) / MINI_BOY;
  const kalanBoslukPx = (olcu: number) => ((MINI_EN_DAR_BOSLUK - miniKalinlik(olcu)) * olcu) / MINI_BOY;
  for (const olcu of [20, 24]) assert.ok(Math.abs(toplamPx(olcu) - 1.2) < 0.02, `${olcu} px: toplam ${toplamPx(olcu)}`);
  for (let olcu = 8; olcu < 40; olcu++) {
    assert.ok(kalanBoslukPx(olcu) >= 0.2 - 1e-9, `${olcu} px: en dar boşluk ${kalanBoslukPx(olcu).toFixed(2)} px — kalınlaştırma kapatıyor`);
    assert.ok(toplamPx(olcu) >= (MINI_CIZGI * olcu) / MINI_BOY, `${olcu} px: inceltme yok`);
  }
  // İnceleme Minor-3: 12–14 px (sohbet ve telefon avatarları) kalınlaştırma azaldı; 1,2 px hedefinin altında kalır.
  for (const olcu of [12, 13, 14]) assert.ok(toplamPx(olcu) < 1.0, `${olcu} px: toplam ${toplamPx(olcu)} — boşluklar kapanır`);
  assert.ok(toplamPx(32) > 1.2 && miniKalinlik(32) < miniKalinlik(24), '24–40 arası kalınlaştırma söner');
  for (const olcu of [40, 48, 96, 168]) assert.equal(miniKalinlik(olcu), 0, `${olcu} px kalınlaşmamalı`);
  assert.equal(miniKalinlik(0), 0);
  assert.equal(miniKalinlik(Number.NaN), 0);
  // Topoloji: yüksek çözünürlükte logo, arayüzün eklediği konturun yarısı kadar genişletilince kapalı bölge sayısı DEĞİŞMEZ (yeni cep yok,
  // kase kapanmaz). Ölçü üreticinin kendi taramasıyla (scripts/ikon-uret.mjs).
  const uret = await import('../scripts/ikon-uret.mjs');
  const N = 440, boy = 420, olcek = boy / MINI_BOY;
  const { m, R } = uret.logoKapsama(N, { sol: (N - (boy * MINI_EN) / MINI_BOY) / 2, ust: 10, boy }, { ss: 1, ham: true });
  const once = uret.kapaliBolgeSayisi(m, R);
  assert.equal(once, 1, 'kaynakta tek kapalı bölge (kase) olmalı');
  for (const olcu of [10, 12, 13, 14, 16, 20, 24, 32]) {
    const r = (miniKalinlik(olcu) / 2) * olcek;
    assert.equal(uret.kapaliBolgeSayisi(uret.genislet(m, R, r), R), once, `${olcu} px: kalınlaştırma bir boşluğu kapattı`);
  }
});

test('eski "F + iki nokta" (yalnız Fuber Yönetim): yollar eski kütüphaneyle birebir; eski üretici Fuber AI ailesini yazamaz', () => {
  // Satır sonu ayrımı (Windows'ta git CRLF ile çıkarabilir) desenleri bozmasın.
  const py = fs.readFileSync(path.join(KOK, 'scripts/ikon-uret.py'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(py, /def main\(\) -> int:\n(?:\s*#.*\n)*\s*print\("Fuber AI ikon ailesi artık: node scripts\/ikon-uret\.mjs[\s\S]*?\n\s*return 2\n/, 'ikon-uret.py doğrudan çalışınca yazmamalı');
  const blok = py.match(/ISARET_YOLLARI = \(([\s\S]*?)\)\n/)?.[1] ?? '';
  const pyYollar = [...blok.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(pyYollar, [...URUN_YOLLAR]);
  assert.equal(URUN_VB, '0 0 101.07 123.41');
  // Gümüş geçiş kaynaktaki gibi parça parça (F, sağ nokta, sol nokta): arayüz ve üretici aynı uç noktaları kullanır.
  const gecis = py.match(/GECISLER = \(([\s\S]*?)\)\n/)?.[1] ?? '';
  const sayilar = [...gecis.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
  assert.deepEqual(sayilar, URUN_GECISLER.flat());
});

/** ICO dizini: [{ boy, png }] (girdinin PNG mi BMP mi olduğu). */
function icoGirdileri(dosya: string): { boy: number; png: boolean }[] {
  const b = fs.readFileSync(dosya);
  assert.equal(b.readUInt16LE(2), 1, `${dosya}: ICO değil`);
  const n = b.readUInt16LE(4);
  return Array.from({ length: n }, (_, i) => {
    const o = 6 + i * 16;
    const boy = b[o] || 256;
    const ofs = b.readUInt32LE(o + 12);
    return { boy, png: b.subarray(ofs, ofs + 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) };
  });
}

/** ICO içindeki BMP karesi (32 bit BGRA, aşağıdan yukarı) → satır satır [r, g, b, a]. */
function icoKaresi(dosya: string, boy: number): number[][][] {
  const b = fs.readFileSync(dosya);
  const n = b.readUInt16LE(4);
  for (let i = 0; i < n; i++) {
    const o = 6 + i * 16;
    if ((b[o] || 256) !== boy) continue;
    const ofs = b.readUInt32LE(o + 12) + 40;
    return Array.from({ length: boy }, (_, y) => Array.from({ length: boy }, (_, x) => {
      const p = ofs + ((boy - 1 - y) * boy + x) * 4;
      return [b[p + 2], b[p + 1], b[p], b[p + 3]];
    }));
  }
  throw new Error(`${dosya}: ${boy} px kare yok`);
}

const parlaklik = ([r, g, b]: number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// 0.12 mini logo: kullanıcı en çok 16–32 px'i görür (görev çubuğu, Alt+Tab, pencere başlığı). Kaynağın çizgisi yüksekliğin %4'ü (16 px'te
// 0,6 px): kalınlaştırılmazsa logo soluk gri bir leke olurdu. Küçük boylarda logo karonun büyük bölümünü kaplar ve çizgisi TAM parlaklığa
// ulaşır; karonun köşeleri şeffaftır (Windows ikonu kendiliğinden yuvarlamaz).
test('küçük ikonlarda mini logo okunur: 16–48 px karo — köşeler şeffaf, çizgi tam parlak, logo karonun ortasında ve yeterince büyük', () => {
  for (const boy of [16, 20, 24, 32, 40, 48]) {
    const kare = icoKaresi(path.join(KOK, 'build/icon.ico'), boy);
    const kose = [kare[0][0], kare[0][boy - 1], kare[boy - 1][0], kare[boy - 1][boy - 1]];
    assert.ok(kose.every((p) => p[3] === 0), `${boy} px: köşeler şeffaf değil (${JSON.stringify(kose)})`);
    // Logo pikselleri: karoda parlak (karo koyu grafit).
    const logo: [number, number][] = [];
    let enParlak = 0;
    for (let y = 0; y < boy; y++) for (let x = 0; x < boy; x++) { const l = parlaklik(kare[y][x]); enParlak = Math.max(enParlak, l); if (l > 160) logo.push([x, y]); }
    assert.ok(enParlak >= 245, `${boy} px: logo tam parlaklığa ulaşmıyor (${enParlak.toFixed(0)}) — soluk leke`);
    assert.ok(logo.length >= boy * 2.2, `${boy} px: logo çizgisi çok az (${logo.length} parlak piksel)`);
    const xs = logo.map((p) => p[0]), ys = logo.map((p) => p[1]);
    const yuk = Math.max(...ys) - Math.min(...ys) + 1, gen = Math.max(...xs) - Math.min(...xs) + 1;
    assert.ok(yuk / boy >= (boy <= 32 ? 0.62 : 0.56), `${boy} px: logo küçük kalmış (${yuk} px)`);
    assert.ok(Math.abs(gen / yuk - 126.54 / 158.6) < 0.12, `${boy} px: logo oranı bozuk (${gen}×${yuk})`);
    // Ortada: sol/sağ ve üst/alt boşlukları en çok 2 piksel farklı (optik merkez hafif sağa/aşağı).
    const sol = Math.min(...xs), sag = boy - 1 - Math.max(...xs), ust = Math.min(...ys), alt = boy - 1 - Math.max(...ys);
    assert.ok(Math.abs(sol - sag) <= 2 && Math.abs(ust - alt) <= 2, `${boy} px: logo ortada değil (sol ${sol}, sağ ${sag}, üst ${ust}, alt ${alt})`);
  }
});

// Görevin yeni testi: tepsi ikonları ZEMİNSİZ (görev çubuğunun kendi rengi görünür) ve tek renk — koyu görev çubuğunda beyaz, açıkta mürekkep.
test('tepsi ikonları zeminsiz ve tek renk: koyu çubukta beyaz, açıkta mürekkep (16–48); köşeler ve logonun çevresi şeffaf', () => {
  // Renkler: beyaz ve --ft-ink (açık tema mürekkebi #1d1d1f).
  for (const [dosya, renk] of [['resources/ikon/tepsi-koyu.ico', [255, 255, 255]], ['resources/ikon/tepsi-acik.ico', [0x1d, 0x1d, 0x1f]]] as const) {
    for (const boy of [16, 20, 24, 32, 40, 48]) {
      const pikseller = icoKaresi(path.join(KOK, dosya), boy).flat();
      const gorunur = pikseller.filter((p) => p[3] > 0);
      assert.ok(gorunur.length / pikseller.length < 0.5, `${dosya} ${boy} px: piksellerin %${Math.round((100 * gorunur.length) / pikseller.length)}'i dolu — zemin var`);
      assert.ok(pikseller.filter((p) => p[3] === 0).length > pikseller.length * 0.5, `${dosya} ${boy} px: şeffaf piksel az`);
      assert.ok(gorunur.every((p) => p[0] === renk[0] && p[1] === renk[1] && p[2] === renk[2]), `${dosya} ${boy} px: tek renk değil`);
      assert.ok(pikseller.filter((p) => p[3] > 230).length >= boy * 2.5, `${dosya} ${boy} px: logo soluk (tam opak piksel az)`);
      const k = icoKaresi(path.join(KOK, dosya), boy);
      assert.equal(k[0][0][3] + k[0][boy - 1][3] + k[boy - 1][0][3] + k[boy - 1][boy - 1][3], 0, `${dosya} ${boy} px: köşe dolu`);
      // Nefes payı (inceleme Minor-4): dış 1 piksellik halka tamamen boş — logo kenarda kırpılmaz, komşu tepsi ikonlarından sıkışık durmaz.
      const halka = k.flatMap((s, y) => s.filter((p, x) => (x === 0 || y === 0 || x === boy - 1 || y === boy - 1) && p[3] > 0));
      assert.equal(halka.length, 0, `${dosya} ${boy} px: dış halkada ${halka.length} dolu piksel`);
    }
  }
  // macOS menü çubuğu şablonu: siyah + alfa (sistem boyar).
  for (const ad of ['tepsiTemplate.png', 'tepsiTemplate@2x.png']) {
    const b = fs.readFileSync(path.join(KOK, 'resources/ikon', ad));
    assert.equal(b[25], 6, `${ad}: RGBA değil`);
  }
});

// Kurulum ikonu: aynı karo + sağ altta "indir" rozeti (beyaz disk, koyu ok; mavi yok). Rozet logoya DEĞMEZ: uygulama ikonunun logo pikselleri
// (parlak) kurulum ikonunda birebir aynı. 16–20 px'te 6–7 piksellik ok okunmaz: orada kurulum ikonu uygulama ikonunun kendisi.
test('kurulum ikonu: 24 px ve üstünde rozet logoya değmez (logo pikselleri birebir); 16–20 px uygulama ikonuyla aynı', () => {
  for (const boy of [16, 20]) assert.deepEqual(icoKaresi(path.join(KOK, 'build/kurulum.ico'), boy), icoKaresi(path.join(KOK, 'build/icon.ico'), boy), `${boy} px`);
  for (const boy of [24, 32, 40, 48, 64, 96, 128]) {
    const kur = icoKaresi(path.join(KOK, 'build/kurulum.ico'), boy), uyg = icoKaresi(path.join(KOK, 'build/icon.ico'), boy);
    let fark = 0, logoFarki = 0, rozetSagAltta = true;
    for (let y = 0; y < boy; y++) {
      for (let x = 0; x < boy; x++) {
        if (!kur[y][x].some((c, i) => Math.abs(c - uyg[y][x][i]) > 2)) continue;
        fark++;
        if (parlaklik(uyg[y][x]) > 150 && uyg[y][x][3] > 200) logoFarki++;
        if (x < boy / 2 || y < boy / 2) rozetSagAltta = false;
      }
    }
    assert.ok(fark > 0, `${boy} px: rozet yok`);
    assert.equal(logoFarki, 0, `${boy} px: rozet logonun ${logoFarki} pikseline değiyor`);
    assert.ok(rozetSagAltta, `${boy} px: rozet sağ alt çeyreğin dışına taşıyor`);
  }
});

// Üretim hattı tekrar üretilebilir: depodaki dosyalar betiğin bugünkü çıktısı (elle düzenlenmiş ya da bayat ikon kalmasın). Hızlı olsun diye
// iki küçük katman yeniden üretilir ve bayt bayt karşılaştırılır (bütün aile: node scripts/ikon-uret.mjs).
test('ikon üreticisi tekrar üretilebilir: build/icon.ico 24 px ve tepsi-koyu 16 px katmanları betiğin çıktısıyla bayt bayt aynı', async () => {
  const uret = await import('../scripts/ikon-uret.mjs');
  const karsilastir = (dosya: string, resim: { en: number; veri: Uint8Array }) => {
    const n = resim.en, depo = icoKaresi(path.join(KOK, dosya), n).flat();
    for (let i = 0; i < n * n; i++) assert.deepEqual(depo[i], [...resim.veri.subarray(i * 4, i * 4 + 4)], `${dosya} ${n} px, piksel ${i % n},${Math.floor(i / n)}: betikle aynı değil (node scripts/ikon-uret.mjs)`);
  };
  karsilastir('build/icon.ico', uret.uygulamaIkonu(24));
  karsilastir('resources/ikon/tepsi-koyu.ico', uret.tepsiIkonu(16, uret.TEPSI_KOYU));
  // Telefon: küçük iki dosya betikle bayt bayt aynı (bütün telefon ailesi aynı çalıştırmada yazılır). Telefon uygulaması yalnız özel depoda.
  if (MOBIL_VAR) {
    const cep = (yol: string) => fs.readFileSync(path.join(KOK, 'mobil/fuber-cep', yol));
    assert.ok(cep('android/app/src/main/res/drawable-mdpi/ic_bildirim.png').equals(uret.png(uret.bildirimSimgesi(24))), 'ic_bildirim mdpi betikle aynı değil');
    assert.ok(cep('web/favicon.png').equals(uret.png(uret.uygulamaIkonu(16))), 'favicon betikle aynı değil');
  }
});

// Ürün kararı (0.12 cila): masaüstü ve telefon TEK ürün "Fuber AI" — telefonun (mobil/fuber-cep) bütün ikonları aynı üreticiden, yeni mini
// logo ailesiyle: Android başlatıcı (eski tip + uyarlanır ön/arka plan + tek renkli tema), bildirim simgesi, kilit ekranı işareti, mağaza
// ikonları, PWA (any + maskable) ve favicon. Eski serif "F" ve Flutter'ın varsayılan web ikonları kalmadı.
test('telefon ikonları yeni aileden: boyutlar, zemin/alfa kuralları, uyarlanır ikon XML\'i, PWA manifesti "Fuber AI"', ozelGerekli('mobil'), async () => {
  const uret = await import('../scripts/ikon-uret.mjs');
  const CEP = path.join(KOK, 'mobil/fuber-cep');
  const oku = (yol: string) => uret.pngOku(fs.readFileSync(path.join(CEP, yol)));
  const yollar = Object.keys(uret.cepDosyalari());
  assert.ok(yollar.length >= 28, `${yollar.length} dosya`);
  for (const yol of yollar) assert.ok(fs.existsSync(path.join(CEP, yol)), `${yol} yok (node scripts/ikon-uret.mjs)`);
  const res = 'android/app/src/main/res';
  for (const [ad, k] of Object.entries(uret.YOGUNLUK) as [string, number][]) {
    const eski = oku(`${res}/mipmap-${ad}/ic_launcher.png`), on = oku(`${res}/mipmap-${ad}/ic_launcher_foreground.png`);
    const arka = oku(`${res}/mipmap-${ad}/ic_launcher_background.png`), bil = oku(`${res}/drawable-${ad}/ic_bildirim.png`);
    assert.deepEqual([eski.en, on.en, arka.en, bil.en], [48 * k, 108 * k, 108 * k, 24 * k], ad);
    assert.equal(eski.veri[3], 0, `${ad}: eski başlatıcının köşesi şeffaf olmalı`);
    assert.ok(arka.veri.every((v, i) => i % 4 !== 3 || v === 255), `${ad}: uyarlanır arka plan tam opak olmalı`);
    // Ön plan: zeminsiz; logo 66 dp güvenli dairenin içinde (merkeze uzaklık ≤ 33 dp).
    const n = on.en, m = n / 2, guvenli = 33 * k;
    let disari = 0, dolu = 0;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { if (on.veri[(y * n + x) * 4 + 3] > 8) { dolu++; if (Math.hypot(x + 0.5 - m, y + 0.5 - m) > guvenli) disari++; } }
    assert.ok(dolu > 0 && dolu / (n * n) < 0.2, `${ad}: ön plan zeminsiz olmalı (%${Math.round((100 * dolu) / (n * n))} dolu)`);
    assert.equal(disari, 0, `${ad}: logonun ${disari} pikseli güvenli dairenin dışında`);
    // Bildirim simgesi: yalnız beyaz + alfa (sistem boyar), dış halka boş.
    const g = bil.en;
    let renkli = 0, halka = 0;
    for (let i = 0; i < g * g; i++) { const a = bil.veri[i * 4 + 3]; if (a > 0 && (bil.veri[i * 4] !== 255 || bil.veri[i * 4 + 1] !== 255 || bil.veri[i * 4 + 2] !== 255)) renkli++; const x = i % g, y = Math.floor(i / g); if (a > 0 && (x === 0 || y === 0 || x === g - 1 || y === g - 1)) halka++; }
    assert.equal(renkli, 0, `${ad}: bildirim simgesi beyaz değil`);
    assert.equal(halka, 0, `${ad}: bildirim simgesinin kenarı dolu`);
  }
  const gumus = oku('assets/img/f-gumus.png');
  assert.deepEqual([gumus.en, gumus.boy], [Math.ceil((200 * MINI_EN) / MINI_BOY), 200], 'kilit ekranı işareti logonun oranında');
  for (const [yol, boy, opak] of [['assets/img/ikon.png', 512, false], ['assets/img/ikon-512.png', 512, true], ['web/icons/Icon-192.png', 192, false], ['web/icons/Icon-512.png', 512, false],
    ['web/icons/Icon-maskable-192.png', 192, true], ['web/icons/Icon-maskable-512.png', 512, true], ['web/favicon.png', 16, false]] as const) {
    const r = oku(yol);
    assert.deepEqual([r.en, r.boy], [boy, boy], yol);
    assert.equal(r.veri[3] === 255, opak, `${yol}: köşe ${opak ? 'opak (tam kare: maskeyi sistem uygular)' : 'şeffaf (karo)'} olmalı`);
  }
  const xml = fs.readFileSync(path.join(CEP, res, 'mipmap-anydpi-v26/ic_launcher.xml'), 'utf8');
  for (const s of ['<background android:drawable="@mipmap/ic_launcher_background"/>', '<foreground android:drawable="@mipmap/ic_launcher_foreground"/>', '<monochrome android:drawable="@mipmap/ic_launcher_foreground"/>']) assert.ok(xml.includes(s), s);
  const manifest = JSON.parse(fs.readFileSync(path.join(CEP, 'web/manifest.json'), 'utf8'));
  assert.equal(manifest.name, 'Fuber AI');
  assert.equal(manifest.short_name, 'Fuber AI');
  assert.doesNotMatch(JSON.stringify(manifest) + fs.readFileSync(path.join(CEP, 'web/index.html'), 'utf8'), /fuber_cep|0175C2/i, 'Flutter varsayılanı kaldı');
  // Eski telefon ikon betiği eski F'yi yazmaz: yeni üreticinin telefon dosyalarını kullanır.
  const betik = fs.readFileSync(path.join(KOK, 'scripts/dev/cep-ikon.mjs'), 'utf8');
  assert.match(betik, /import \{ CEP, cepDosyalari \} from '\.\.\/ikon-uret\.mjs'/);
  assert.doesNotMatch(betik, /LOGO_YOLLAR|logo\.ts/);
});

test('ikon ailesi: uygulama ve kurulum ICO 16–256 (küçükler BMP, 256 PNG); tepsi 16–48; macOS icns 1024', () => {
  for (const dosya of ['build/icon.ico', 'build/kurulum.ico', 'resources/ikon/fuber.ico']) {
    const g = icoGirdileri(path.join(KOK, dosya));
    assert.deepEqual(g.map((x) => x.boy), [16, 20, 24, 32, 40, 48, 64, 96, 128, 256], dosya);
    assert.deepEqual(g.filter((x) => x.png).map((x) => x.boy), [256], `${dosya}: yalnız 256 PNG olmalı`);
  }
  for (const dosya of ['resources/ikon/tepsi-koyu.ico', 'resources/ikon/tepsi-acik.ico']) {
    assert.deepEqual(icoGirdileri(path.join(KOK, dosya)).map((x) => x.boy), [16, 20, 24, 32, 40, 48], dosya);
  }
  // build/icon.ico ile pencere ikonu aynı aile (kurulumdaki kısayol ve çalışan pencere aynı resmi gösterir).
  assert.ok(fs.readFileSync(path.join(KOK, 'build/icon.ico')).equals(fs.readFileSync(path.join(KOK, 'resources/ikon/fuber.ico'))));
  const icns = fs.readFileSync(path.join(KOK, 'build/icon.icns'));
  assert.equal(icns.subarray(0, 4).toString('latin1'), 'icns');
  assert.equal(icns.readUInt32BE(4), icns.length);
  assert.ok(icns.includes(Buffer.from('ic10')), 'icns 1024 (ic10) girdisi yok');
  const png = fs.readFileSync(path.join(KOK, 'build/icon.png'));
  assert.equal(png.readUInt32BE(16), 1024, 'build/icon.png 1024 değil');
});
