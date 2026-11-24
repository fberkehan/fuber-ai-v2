// 0.12 H6: Electron sigortaları (fuses) — iki uygulama (Fuber AI: electron-builder.yml, Fuber Yönetim: yonetim/electron-builder.yml) AYNI
// değerlerle paketlenir ve kodda bu sigortaların kıracağı bir yol kalmaz. Kırılma denetimi (H6, rapor: alt süreç yolları ve kararlar):
//   · runAsNode false — ana süreç hiçbir alt süreci kendi exe'siyle Node olarak başlatmaz (ELECTRON_RUN_AS_NODE yok, child_process.fork yok —
//     Electron'da fork da ELECTRON_RUN_AS_NODE kullanır —, utilityProcess yok). Tek istisna test kancası: main/yerel/piper.ts'te sahte Piper
//     (FUBER_DEMO + FUBER_TEST_PIPER); kurulu uygulamada ortam kapısı onu siler (shared/ortam-kapisi.ts RUN_AS_NODE_KANCALARI). Öteki alt
//     süreçler kendi ikilileridir: fuber-girdi.exe / fuber-olay.exe (kaynak/), llama-server, whisper-server, piper.exe (%APPDATA%), kullanıcının
//     claude.exe'si, git, where.exe, taskkill, tar, nvidia-smi, powershell/wt, MCP sunucularının kendi komutları, kaldırıcı. Testteki sahte Claude
//     Code / uv / graphify / girdi / olay komutları sistemin `node`unu kullanır (process.execPath değil).
//   · enableNodeOptionsEnvironmentVariable / enableNodeCliInspectArguments false — paketli testler Playwright'la (ana sürece --inspect) sürer:
//     DAĞITILMAYAN test kopyasında koşar (scripts/paket-test-kopyasi.mjs: yalnız EnableNodeCliInspectArguments açık, başka bayt farkı yok).
//   · grantFileProtocolExtraPrivileges false — arayüz file:// ile değil özel şemayla yüklenir (fuber://app/, fuber-yonetim://app/; protocol.handle
//     + ana süreçte net.fetch(file://)); hiçbir pencere loadFile/file:// açmaz.
//   · enableEmbeddedAsarIntegrityValidation + onlyLoadAppFromAsar true — uygulama app.asar'dan; asarUnpack yok; kaynak/ (yerel ikililer, ses
//     modeli, yazı tipi) asar DIŞINDA extraResources'tur (bütünlük denetimi onları kapsamaz, yükleme yolu değişmez).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { RUN_AS_NODE_KANCALARI } from '../src/shared/ortam-kapisi.ts';
import { YONETIM_VAR, ozelGerekli } from './yardimci/ozel.ts';

const kok = path.resolve(import.meta.dirname, '..');
const oku = (g: string) => fs.readFileSync(path.join(kok, g), 'utf8').replace(/\r\n/g, '\n');

/** İstenen sigorta değerleri (H6 görevi; @electron/fuses FuseV1Options karşılıkları electron-builder'ın electronFuses anahtarlarıdır). */
const BEKLENEN: Record<string, boolean> = {
  runAsNode: false,
  enableCookieEncryption: true,
  enableNodeOptionsEnvironmentVariable: false,
  enableNodeCliInspectArguments: false,
  enableEmbeddedAsarIntegrityValidation: true,
  onlyLoadAppFromAsar: true,
  loadBrowserProcessSpecificV8Snapshot: false,
  grantFileProtocolExtraPrivileges: false,
};

/** YAML'daki `electronFuses:` bloğu (iki boşluk girintili `ad: true|false` satırları). */
function sigortalar(yml: string): Record<string, boolean> {
  const m = /^electronFuses:\n((?: {2}[A-Za-z0-9]+: (?:true|false)\n)+)/m.exec(yml);
  assert.ok(m, 'electronFuses bloğu yok');
  return Object.fromEntries([...m[1].matchAll(/^ {2}([A-Za-z0-9]+): (true|false)$/gm)].map((x) => [x[1], x[2] === 'true']));
}

function dosyalar(kokDizin: string, desen: RegExp): string[] {
  const out: string[] = [];
  if (!fs.existsSync(kokDizin)) return out; // açık kaynak hazırlığı: genel depoda yonetim/ yok
  const gez = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const y = path.join(d, e.name);
      if (e.isDirectory()) { if (!['node_modules', 'dist', 'release'].includes(e.name)) gez(y); } else if (desen.test(e.name)) out.push(y);
    }
  };
  gez(kokDizin);
  return out;
}

test('iki uygulamanın electron-builder yapılandırmasında sigortalar AYNI ve istenen değerlerde', () => {
  const ana = sigortalar(oku('electron-builder.yml'));
  assert.deepEqual(ana, BEKLENEN, 'Fuber AI');
  if (YONETIM_VAR) assert.deepEqual(sigortalar(oku('yonetim/electron-builder.yml')), BEKLENEN, 'Fuber Yönetim'); // Açık kaynak hazırlığı: genel depoda yonetim/ yok — Yönetim kısmı yalnız özel depoda denetlenir (tests/yardimci/ozel.ts).
});

test('asar: ikisi de asar: true, asarUnpack YOK (bütünlük denetimi bütün uygulama kodunu kapsar); yerel ikililer asar dışı kaynak/', () => {
  for (const g of ['electron-builder.yml', ...(YONETIM_VAR ? ['yonetim/electron-builder.yml'] : [])]) {
    const y = oku(g);
    assert.match(y, /^asar: true$/m, g);
    assert.doesNotMatch(y, /^asarUnpack:/m, `${g}: asarUnpack`);
  }
  assert.match(oku('electron-builder.yml'), /^extraResources:\n {2}- from: resources\n {4}to: kaynak$/m, 'yerel ikililer ve modeller asar dışında (kaynak/)');
  // Fuber Yönetim'in yonetim/dist'inde node_modules yok; electron-builder o zaman depo kökünün bağımlılıklarını toplardı (claude.exe dahil).
  if (YONETIM_VAR) {
    const dosyalarBlogu = /^files:\n((?: {2}.*\n)+)/m.exec(oku('yonetim/electron-builder.yml'))?.[1] ?? '';
    assert.match(dosyalarBlogu, /^ {2}- "!node_modules\/\*\*"$/m, 'Fuber Yönetim paketine node_modules girmez');
  }
});

test('runAsNode false: ana süreç kendi exe\'sini Node olarak hiç başlatmaz (sahte Piper da ayrı bir Node süreciyle — H3c)', () => {
  const kaynak = [...dosyalar(path.join(kok, 'src', 'main'), /\.ts$/), ...dosyalar(path.join(kok, 'src', 'shared'), /\.ts$/), ...dosyalar(path.join(kok, 'yonetim'), /\.tsx?$/)];
  // Kodda kullanım: ortama yazma ya da okuma — hiçbir yerde (H3c düzeltme 1: sahte Piper ["node", betik] kalıbına geçti).
  const ronYeri = kaynak.filter((d) => /ELECTRON_RUN_AS_NODE\s*:|\[\s*['"]ELECTRON_RUN_AS_NODE['"]\s*\]|env\.ELECTRON_RUN_AS_NODE/.test(fs.readFileSync(d, 'utf8'))).map((d) => path.relative(kok, d).replace(/\\/g, '/'));
  assert.deepEqual(ronYeri, [], 'ELECTRON_RUN_AS_NODE hiçbir yerde');
  const piper = oku('src/main/yerel/piper.ts');
  assert.match(piper, /process\.env\.FUBER_DEMO && process\.env\.FUBER_TEST_PIPER \?/, 'sahte Piper yalnız FUBER_DEMO + FUBER_TEST_PIPER');
  assert.ok(RUN_AS_NODE_KANCALARI.includes('FUBER_TEST_PIPER'), 'kurulu uygulamada ortam kapısı FUBER_TEST_PIPER test kancasını siler');
  // process.execPath ile süreç başlatan yer yok (kabuk-kimligi karşılaştırır, pencere-kabugu görev çubuğu komutu, main.ts geliştirmede
  // protokol kaydı — hiçbiri süreç başlatmaz).
  const execPathSpawn = kaynak.filter((d) => /(?:spawn|execFile|spawnSync|execFileSync)\(\s*process\.execPath/.test(fs.readFileSync(d, 'utf8'))).map((d) => path.relative(kok, d).replace(/\\/g, '/'));
  assert.deepEqual(execPathSpawn, []);
  // child_process.fork (Electron'da ELECTRON_RUN_AS_NODE ile çalışır) hiç yok. utilityProcess YALNIZ belge ayrıştırma işçisinde (inceleme I1, 11 Kas):
  // RunAsNode'a dayanmaz (exe --type=utility, Chromium yardımcı süreci), yalnız uygulamanın kendi paketlenmiş betiğini (dist/main/belge-isci.js; asar
  // içinden) bellek ve süre sınırıyla çalıştırır; ortamdan betik ya da argüman almaz. Başka hiçbir dosyada yok.
  const UTILITY_IZINLI = new Set(['src/main/belge-ayristir.ts', 'src/main/belge-isci.ts']); // ayrıştırıcı ve işçinin kendisi
  for (const d of kaynak) {
    const s = fs.readFileSync(d, 'utf8');
    const goreli = path.relative(kok, d).replace(/\\/g, '/');
    assert.doesNotMatch(s, /import\s*\{[^}]*\bfork\b[^}]*\}\s*from\s*'node:child_process'|child_process'\)\.fork/, goreli);
    if (!UTILITY_IZINLI.has(goreli)) assert.doesNotMatch(s, /\butilityProcess\b/, goreli);
  }
  const ayr = oku('src/main/belge-ayristir.ts');
  assert.match(ayr, /fork\(isciYolu\(\), \[\], \{ execArgv: \[`--max-old-space-size=\$\{bellek\}`\]/, 'utilityProcess yalnız kendi işçi betiği, bellek sınırıyla');
  // Fuber Yönetim alt süreç başlatmaz.
  for (const d of dosyalar(path.join(kok, 'yonetim'), /\.tsx?$/)) assert.doesNotMatch(fs.readFileSync(d, 'utf8'), /child_process/, path.relative(kok, d));
});

test('testteki sahte komutlar betiği koşturan node\'u kullanır (process.execPath = node.exe), uygulamanın/Electron\'un exe\'sini değil', () => {
  // FUBER_*_KOMUT değerleri Node betiklerinde kurulur: orada process.execPath sistemin node.exe'sidir. Electron ikilisini (electronYolu,
  // win-unpacked exe'si) komut yapan olsaydı RunAsNode kapalıyken ikinci bir uygulama açılırdı.
  const betikler = dosyalar(path.join(kok, 'scripts'), /\.mjs$/);
  const kotu: string[] = [];
  for (const d of betikler) {
    const s = fs.readFileSync(d, 'utf8');
    for (const m of s.matchAll(/FUBER_(?:CLAUDE|UV|GRAPHIFY|CC_YUKLEYICI|OLAY|GIRDI)_KOMUT:\s*JSON\.stringify\(\[\s*([^,\]]+)/g)) {
      if (/electron|exe\b|paketli/i.test(m[1])) kotu.push(`${path.relative(kok, d)}: ${m[0].slice(0, 80)}`);
    }
  }
  assert.deepEqual(kotu, []);
});

test('grantFileProtocolExtraPrivileges false: pencereler file:// ile yüklenmez — arayüz özel şemadan (protocol.handle + net.fetch)', () => {
  const kaynak = [...dosyalar(path.join(kok, 'src', 'main'), /\.ts$/), ...dosyalar(path.join(kok, 'yonetim', 'main'), /\.ts$/)];
  for (const d of kaynak) {
    const s = fs.readFileSync(d, 'utf8');
    assert.doesNotMatch(s, /\.loadFile\(|loadURL\(\s*['`"]file:|loadURL\(\s*pathToFileURL/, path.relative(kok, d));
  }
  const ana = oku('src/main/main.ts');
  assert.match(ana, /protocol\.handle\('fuber'/);
  assert.match(ana, /net\.fetch\(pathToFileURL\(dosya\)\.toString\(\)\)/);
  assert.match(ana, /loadURL\('fuber:\/\/app\/index\.html'\)/);
  if (YONETIM_VAR) {
    const yon = oku('yonetim/main/main.ts');
    assert.match(yon, /protocol\.handle\(SEMA/);
    assert.match(yon, /loadURL\(`\$\{KOK_ADRES\}index\.html`\)/);
  }
});

test('paket test kopyası betiği: yalnız EnableNodeCliInspectArguments açılır; hedef yalnız "<kaynak>-test"; bayt farkı ve tazelik denetlenir', () => {
  const b = oku('scripts/paket-test-kopyasi.mjs');
  const cevirmeler = [...b.matchAll(/sigortaCevir\(ikili, '([A-Za-z]+)', (true|false)\)/g)].map((m) => `${m[1]}=${m[2]}`);
  assert.deepEqual(cevirmeler, ['EnableNodeCliInspectArguments=true'], 'başka sigorta değiştirilmez');
  assert.match(b, /const hedef = `\$\{kaynak\}\$\{TEST_EKI\}`;/, 'hedef kaynağın kardeşi, adı …-test');
  assert.match(b, /hedef yalnız/, 'başka hedef reddedilir (yanlışlıkla release silinmesin)');
  assert.match(b, /hedef bir test kopyasına benzemiyor, silinmedi/, 'test kopyasına benzemeyen klasör silinmez');
  assert.match(b, /farkliBayt/, 'kopya ile asıl exe arasındaki bayt farkı sayılır');
  assert.match(b, /testKopyasiDogrula\(kopyaExe\)/, 'üretilen kopya paket-dogrula ile de doğrulanır');
});

// ── Sigorta teli okuyucu/çevirici (scripts/sigorta-teli.mjs): @electron/fuses projenin doğrudan bağımlılığı değil (app-builder-lib'in; bugün 1.8.0) ──
const teli = () => import('../scripts/sigorta-teli.mjs');
function sahteIkili(durumlar: number[], dolgu = 64): Buffer {
  return Buffer.concat([Buffer.alloc(dolgu, 0x41), Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX', 'latin1'), Buffer.from([1, durumlar.length, ...durumlar]), Buffer.alloc(dolgu, 0x42)]);
}

test('sigorta teli: @electron/fuses 1.8.0 biçimi — sentinel + [sürüm 1, uzunluk, durumlar]; okuma, tek sigorta çevirme, yml eşlemesi', async () => {
  const { SENTINEL, SIGORTA_ADLARI, YML_ADLARI, sigortalariOku, sigortaCevir, teliBul, ymlSigortalari } = await teli();
  assert.equal(SENTINEL, 'dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX');
  const ikili = sahteIkili([48, 49, 48, 48, 49, 49, 48, 48, 49]);
  const o = sigortalariOku(ikili);
  assert.deepEqual(Object.keys(o), SIGORTA_ADLARI);
  assert.equal(o.RunAsNode, 'kapalı');
  assert.equal(o.EnableCookieEncryption, 'açık');
  assert.equal(o.EnableNodeCliInspectArguments, 'kapalı');
  const once = Buffer.from(ikili);
  const konum = sigortaCevir(ikili, 'EnableNodeCliInspectArguments', true);
  assert.equal(konum, teliBul(ikili).konum + 3);
  assert.equal(sigortalariOku(ikili).EnableNodeCliInspectArguments, 'açık');
  let fark = 0;
  for (let i = 0; i < ikili.length; i++) if (ikili[i] !== once[i]) fark++;
  assert.equal(fark, 1, 'tek bayt');
  assert.throws(() => sigortalariOku(Buffer.alloc(100)), /sigorta teli bulunamadı/);
  assert.throws(() => sigortaCevir(ikili, 'Yok', true), /bilinmeyen sigorta/);
  // Tel sürümü 1 değilse hiçbir bayt yazılmaz (önce denetlenir).
  const v2 = sahteIkili([48, 48, 48, 48]);
  v2[teliBul(v2).konum - 2] = 2;
  const v2once = Buffer.from(v2);
  assert.throws(() => sigortaCevir(v2, 'RunAsNode', true), /beklenmeyen sigorta teli sürümü: 2/);
  assert.ok(v2.equals(v2once), 'sürüm uyuşmazsa ikili değişmez');
  // electron-builder.yml anahtarları → ad; iki yapılandırma aynı sekiz değeri okur.
  assert.deepEqual(Object.keys(YML_ADLARI).sort(), Object.keys(BEKLENEN).sort());
  const yml = ymlSigortalari(oku('electron-builder.yml'));
  assert.deepEqual(yml, Object.fromEntries(Object.entries(BEKLENEN).map(([k, v]) => [YML_ADLARI[k as keyof typeof YML_ADLARI], v ? 'açık' : 'kapalı'])));
  if (YONETIM_VAR) assert.deepEqual(ymlSigortalari(oku('yonetim/electron-builder.yml')), yml);
});

// ── Paketli test kapısı (scripts/paket-dogrula.mjs): bayat test kopyası koşmaz (inceleme I-1) ──
test('paket-dogrula: güncel kopya geçer; bayat app.asar, fazla bayt farkı, dağıtılan exe, eksik kopya açık iletiyle reddedilir', async () => {
  const { testKopyasiDogrula, TEST_EKI } = await import('../scripts/paket-dogrula.mjs');
  const { sigortaCevir } = await teli();
  const os = await import('node:os');
  const kokD = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-paket-dogrula-'));
  try {
    const dag = path.join(kokD, 'win-unpacked'), kop = path.join(kokD, `win-unpacked${TEST_EKI}`);
    const kur = (k: string, ikili: Buffer, asar: string) => {
      fs.mkdirSync(path.join(k, 'resources'), { recursive: true });
      fs.writeFileSync(path.join(k, 'Fuber AI.exe'), ikili);
      fs.writeFileSync(path.join(k, 'resources', 'app.asar'), asar);
    };
    const asil = sahteIkili([48, 49, 48, 48, 49, 49, 48, 48, 49]);
    const kopya = Buffer.from(asil);
    sigortaCevir(kopya, 'EnableNodeCliInspectArguments', true);
    kur(dag, asil, 'asar-v2');
    const kopyaExe = path.join(kop, 'Fuber AI.exe');
    assert.throws(() => testKopyasiDogrula(kopyaExe), /TEST KOPYASI YOK[\s\S]*Ne yapılmalı: npm run dist && node scripts\/paket-test-kopyasi\.mjs/);
    kur(kop, kopya, 'asar-v2');
    const d = testKopyasiDogrula(kopyaExe);
    assert.equal(d.dagitilanExe, path.join(dag, 'Fuber AI.exe'));
    // Bayat: kopyanın app.asar'ı eski derlemeden.
    fs.writeFileSync(path.join(kop, 'resources', 'app.asar'), 'asar-v1');
    assert.throws(() => testKopyasiDogrula(kopyaExe), /TEST KOPYASI BAYAT: app\.asar dağıtılan derlemeden farklı/);
    fs.writeFileSync(path.join(kop, 'resources', 'app.asar'), 'asar-v2');
    // Bayat: exe'de sigorta dışı bir bayt farklı (eski exe).
    const eski = Buffer.from(kopya); eski[3] = 0x43;
    fs.writeFileSync(kopyaExe, eski);
    assert.throws(() => testKopyasiDogrula(kopyaExe), /BAYAT ya da BOZUK: exe farkı yalnız --inspect sigorta baytı olmalı/);
    // Kopyada sigorta açılmamış (fark yok).
    fs.writeFileSync(kopyaExe, asil);
    assert.throws(() => testKopyasiDogrula(kopyaExe), /BAYAT ya da BOZUK/);
    fs.writeFileSync(kopyaExe, kopya);
    // Dağıtılan exe verildi: --inspect kapalı → açık ileti.
    assert.throws(() => testKopyasiDogrula(path.join(dag, 'Fuber AI.exe')), /DAĞITILAN EXE VERİLDİ[\s\S]*Playwright ana sürece bağlanamaz/);
    assert.equal(testKopyasiDogrula(kopyaExe).farkKonumu > 0, true);
    // Düzeltme turu 2 (N-3): app.asar dışındaki kaynaklar da karşılaştırılır — kaynak/ altında içerik, eksik ya da fazla dosya → bayat.
    for (const k of [dag, kop]) { fs.mkdirSync(path.join(k, 'resources', 'kaynak', 'bin'), { recursive: true }); fs.writeFileSync(path.join(k, 'resources', 'kaynak', 'bin', 'fuber-girdi.exe'), 'v2'); }
    assert.equal(testKopyasiDogrula(kopyaExe).farkKonumu > 0, true, 'aynı kaynaklar: geçer');
    fs.writeFileSync(path.join(kop, 'resources', 'kaynak', 'bin', 'fuber-girdi.exe'), 'v1');
    assert.throws(() => testKopyasiDogrula(kopyaExe), /TEST KOPYASI BAYAT: resources\/kaynak\/bin\/fuber-girdi\.exe dağıtılan derlemeden farklı/);
    fs.writeFileSync(path.join(kop, 'resources', 'kaynak', 'bin', 'fuber-girdi.exe'), 'v2');
    fs.writeFileSync(path.join(dag, 'resources', 'elevate.exe'), 'yeni');
    assert.throws(() => testKopyasiDogrula(kopyaExe), /TEST KOPYASI BAYAT: dosya listesi farklı[\s\S]*eksik: resources\/elevate\.exe/);
    fs.writeFileSync(path.join(kop, 'resources', 'elevate.exe'), 'yeni');
    assert.equal(testKopyasiDogrula(kopyaExe).farkKonumu > 0, true);
  } finally { fs.rmSync(kokD, { recursive: true, force: true }); }
});

test('paketli exe açan BÜTÜN betikler paket-dogrula kapısından geçer; varsayılan exe test kopyası (dağıtılan exe değil)', () => {
  const betikler = ['scripts/dev/kurulu-duman.mjs', 'scripts/dev/kurulu-sigorta-denetimi.mjs', 'scripts/dev/yonetim-kurulu-duman.mjs', 'scripts/e2e/tam-akis.mjs',
    'scripts/dev/gercek-masaustu-testi.mjs', 'scripts/dev/uyandirma/uctan-uca.mjs', 'scripts/dev/ada-gercek-pencere.mjs', 'scripts/dev/son-duzeltme-denetimi.mjs', 'scripts/e2e/senaryo-videolari.mjs',
    'scripts/e2e/paketli-belge.mjs', 'scripts/dev/toplanti-paketli.mjs', 'scripts/dev/kurulu-dosya-ekleme.mjs', 'scripts/dev/tarayici-paketli-denetim.mjs']; // 13 Kas: dosya ekleme ve Chrome bağlantısı paketli denetimleri; 0.14 T35: paketli belge (PDF); 0.17.3: Toplantı kaynakları
  // Açık kaynak hazırlığı: Yönetim ve uçtan uca (e2e) betikleri yalnız özel depoda — var olanlar denetlenir.
  for (const b of betikler.filter((x) => fs.existsSync(path.join(kok, x)))) {
    const s = oku(b);
    assert.match(s, /from '(?:\.\.\/)+paket-dogrula\.mjs'/, b);
    assert.match(s, /paketliTestExe\(/, b);
    assert.doesNotMatch(s, /['"]release['"],\s*['"]win-unpacked['"]\)|release\/win-unpacked\/Fuber AI\.exe'\)/, `${b}: dağıtılan exe varsayılanı`);
    // Düzeltme turu 2: her paketli koşu yalıtılmış profil (FUBER_VERI ya da Yönetim'de --user-data-dir) VE geçici ev (USERPROFILE, APPDATA,
    // LOCALAPPDATA) verir — hiçbir koşu gerçek %APPDATA%\Fuber AI / Fuber Yönetim'i yaratmaz, okumaz.
    if (b === 'scripts/e2e/tam-akis.mjs' || b === 'scripts/e2e/senaryo-videolari.mjs' || b === 'scripts/e2e/paketli-belge.mjs') continue; // ortamı scripts/e2e/surucu.mjs masaustuOrtami kurar (aşağıda)
    assert.match(s, /FUBER_VERI|--user-data-dir=/, `${b}: yalıtılmış profil`);
    assert.match(s, /geciciEv\(/, `${b}: geçici ev`);
  }
  const surucu = fs.existsSync(path.join(kok, 'scripts/e2e/surucu.mjs')) ? oku('scripts/e2e/surucu.mjs') : null;
  if (surucu) assert.match(surucu, /FUBER_VERI: veri,[\s\S]*?USERPROFILE: ev, HOME: ev, APPDATA: path\.join\(ev, 'AppData', 'Roaming'\), LOCALAPPDATA: path\.join\(ev, 'AppData', 'Local'\)/, 'tam-akis masaüstü ortamı');
  // Ev, FUBER_VERI'nin KARDEŞİ: içinde olsaydı varsayılan veri klasörü (geçici appData + ürün adı) FUBER_VERI'nin içine düşer ve kurulu
  // uygulama profili yalıtılmış saymaz (açılmaz).
  if (surucu) assert.match(surucu, /const ev = `\$\{path\.resolve\(veri\)\}-ev`;/, 'surucu: ev veri klasörünün kardeşi');
  const ev = oku('scripts/paket-dogrula.mjs');
  assert.match(ev, /const ev = `\$\{path\.resolve\(veri\)\}-ev`;/, 'geciciEv: ev veri klasörünün kardeşi');
  assert.match(ev, /return \{ USERPROFILE: ev, HOME: ev, APPDATA: roaming, LOCALAPPDATA: local \};/);
  if (YONETIM_VAR) assert.doesNotMatch(oku('scripts/dev/yonetim-kurulu-duman.mjs'), /process\.env\.APPDATA|os\.homedir\(\)/, 'Yönetim dumanı gerçek APPDATA\'ya bakmaz');
  // FUBER_TEST_EXE / paketli exe ile Playwright açan başka betik kalmadı.
  const hepsi: string[] = [];
  const gez = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const y = path.join(d, e.name); if (e.isDirectory()) gez(y); else if (/\.mjs$/.test(e.name)) hepsi.push(y); } };
  gez(path.join(kok, 'scripts'));
  const acan = hepsi.filter((d) => /FUBER_TEST_EXE|paketliExe|win-unpacked/.test(fs.readFileSync(d, 'utf8')) && /electron\.launch|masaustuAc|spawn\(/.test(fs.readFileSync(d, 'utf8')))
    .map((d) => path.relative(kok, d).replace(/\\/g, '/')).filter((d) => !betikler.includes(d));
  assert.deepEqual(acan, surucu ? ['scripts/e2e/surucu.mjs'] : [], 'surucu.mjs exe\'yi tam-akis\'ten (doğrulanmış) alır');
});

// ── 0.13 son düzeltme 15: gerçek anahtarla koşan betikler silindi (kullanıcı anahtarı yolu kalktı; geçmiş git'te). Sahte motorlu denetim scripts/dev/sahte-gecit.mjs ve scripts/e2e/tam-akis.mjs ──
test('kullanıcı anahtarı yolunun betikleri ve ortak durdurucusu yok; hiçbir betik gerçek anahtar dosyasını okumaz', () => {
  const silinen = ['cep-gelistir', 'cep2-emulator', 'cep2-testi', 'cep3-emulator', 'claudecode-testi', 'demo-goruntu', 'dusunme-testi', 'e2e', 'gercek-ajan-testi', 'iceaktar-testi', 'kopru-testi', 'kulak-testi', 'yerel-testi', 'yetenek-testi', 'anahtar-yolu-kalkti'];
  assert.deepEqual(silinen.filter((b) => fs.existsSync(path.join(kok, 'scripts', 'dev', `${b}.mjs`))), []);
  const kalan = dosyalar(path.join(kok, 'scripts'), /\.mjs$/).filter((d) => /anahtar-yolu-kalkti|anthropic-test\.key|FUBER_SIR_API_ANTHROPIC/.test(fs.readFileSync(d, 'utf8'))).map((d) => path.relative(kok, d).replace(/\\/g, '/'));
  // cc-gercek-duman.mjs Fuber'in anahtar yolu değil: Claude Code'un kendi kimliğini korumalı ve yalnız elle sınar (varsayılanı sahte kip; tests/cc-duman-kalkan.test.ts).
  // Açık kaynak hazırlığı (11 Kas): onun anahtar dosyası yolu da koddan çıktı (FUBER_CC_DUMAN_ANAHTAR_DOSYASI) — hiçbir betik anahtar dosyası adı taşımaz.
  assert.deepEqual(kalan, []);
  assert.match(fs.readFileSync(path.join(kok, 'scripts/dev/cc-gercek-duman.mjs'), 'utf8'), /process\.env\.FUBER_CC_DUMAN_ANAHTAR_DOSYASI/);
});

// ── Fuber Yönetim: kurulu uygulamada hiçbir npm paketi yüklenmez ("!node_modules/**" ile birlikte; inceleme Minor-6) ──
test('Fuber Yönetim ana süreci ve preload\'u yalnız electron ve node:* içe aktarır (kaynak kapanışı; derlenmişse paket de)', ozelGerekli('yonetim'), (t) => {
  const yerel = (s: string) => s.startsWith('.') || s.startsWith('/');
  const ziyaret = new Set<string>();
  const disari: string[] = [];
  const gez = (dosya: string) => {
    if (ziyaret.has(dosya)) return;
    ziyaret.add(dosya);
    const s = fs.readFileSync(dosya, 'utf8');
    for (const m of s.matchAll(/(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|(?:^|\n)\s*import\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const ad = m[1] ?? m[2] ?? m[3];
      if (!yerel(ad)) { if (ad !== 'electron' && !ad.startsWith('node:')) disari.push(`${path.relative(kok, dosya)} → ${ad}`); continue; }
      let hedef = path.resolve(path.dirname(dosya), ad);
      if (!fs.existsSync(hedef)) for (const uz of ['.ts', '.tsx']) { const h = hedef.replace(/\.js$/, '') + uz; if (fs.existsSync(h)) { hedef = h; break; } }
      if (/\.tsx?$/.test(hedef) && fs.existsSync(hedef)) gez(hedef);
    }
  };
  gez(path.join(kok, 'yonetim', 'main', 'main.ts'));
  gez(path.join(kok, 'yonetim', 'preload', 'preload.ts'));
  assert.ok(ziyaret.size >= 6, `kapanış küçük: ${ziyaret.size}`);
  assert.deepEqual(disari, [], 'Fuber Yönetim ana süreç/preload kapanışında npm paketi');
  const ana = path.join(kok, 'yonetim', 'dist', 'main', 'main.js'), pre = path.join(kok, 'yonetim', 'dist', 'preload', 'preload.cjs');
  if (!fs.existsSync(ana) || !fs.existsSync(pre)) { t.diagnostic('yonetim/dist yok — derlenmiş paket denetlenmedi (kaynak kapanışı denetlendi)'); return; }
  const paketler = new Set<string>();
  for (const d of [ana, pre]) for (const m of fs.readFileSync(d, 'utf8').matchAll(/from\s+["']([^"'.][^"']*)["']|require\(\s*["']([^"'.][^"']*)["']\s*\)|import\(\s*["']([^"'.][^"']*)["']\s*\)/g)) paketler.add(m[1] ?? m[2] ?? m[3]);
  assert.deepEqual([...paketler].filter((p) => p !== 'electron' && !p.startsWith('node:')), [], `derlenmiş paket: ${[...paketler].join(', ')}`);
});
