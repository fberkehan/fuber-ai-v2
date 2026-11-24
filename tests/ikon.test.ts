// 0.10 E1 (K7): görev çubuğu, Alt+Tab, bildirim, tepsi ve pencere başlığında her yerde Fuber ikonu.
// 27 Eki kök nedeni: Başlat menüsünde "Electron.lnk" (hedef: geliştirme klonunun node_modules\electron\dist\electron.exe'si, ikon:
// Electron'unki) ürünün AppUserModelID'sini (ai.fuber.masaustu) taşıyordu; Windows kimliği o kısayola çözdü (Get-StartApps: "Electron
// ai.fuber.masaustu"; "Fuber AI" listede yok) → kurulu uygulama da geliştirme koşuları da görev çubuğunda Electron ikonu ve adıyla göründü.
// Bu dosya: paketleme ayarı (exe ikonu rcedit ile yazılır), kimlik (paketli = electron-builder appId = NSIS kısayolu; geliştirme ayrı),
// kimlik gaspı kuralı, her pencereye ikon ve bildirim ikonu. Gerçek ikonların piksel denetimi: scripts/dev/kurulu-duman.mjs ve
// scripts/dev/ikon-onizle.mjs (ikon-denetle.ps1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { URUN_KIMLIGI, GELISTIRME_KIMLIGI, uygulamaKimligi, kimlikGaspiMi, gaspAdayiMi, temizlikKipi, kisayolTemizligiGerekli } from '../src/shared/uygulama-kimligi.ts';
import { ayarKaydiniSuz } from '../src/main/ayar-kaydi.ts';

const KOK = path.resolve(import.meta.dirname, '..');
const oku = (dosya: string) => fs.readFileSync(path.join(KOK, dosya), 'utf8').replace(/\r\n/g, '\n');
/** Yorumsuz kaynak (yorumdaki örnekler denetimi yanıltmasın). */
const kaynak = (dosya: string) => oku(dosya).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const yml = oku('electron-builder.yml');
/** electron-builder.yml'de bir bölümün (win:, nsis:) girintili satırları. */
const bolum = (ad: string) => yml.match(new RegExp(`^${ad}:\\n((?:[ \\t]+.*\\n|\\n)*)`, 'm'))?.[1] ?? '';
const deger = (metin: string, anahtar: string) => metin.match(new RegExp(`^\\s*${anahtar}:\\s*(.+)$`, 'm'))?.[1].trim().replace(/^["']|["']$/g, '');

test('paketleme: win.icon build/icon.ico (dosya var); exe kaynağı rcedit ile düzenlenir (signAndEditExecutable false değil)', () => {
  const win = bolum('win');
  assert.ok(win, 'electron-builder.yml: win: bölümü yok');
  assert.equal(deger(win, 'icon'), 'build/icon.ico');
  assert.ok(fs.existsSync(path.join(KOK, 'build/icon.ico')));
  // signAndEditExecutable: false → electron-builder exe'ye rcedit çalıştırmaz, exe Electron'un ikonuyla kalır. Ya hiç yazılmamış
  // (varsayılan true) ya da true; false ise ikon afterPack'te rcedit ile yazılmalı.
  const sae = deger(yml, 'signAndEditExecutable');
  const afterPack = deger(yml, 'afterPack');
  assert.ok(sae !== 'false' || Boolean(afterPack && /rcedit/.test(oku(afterPack))), 'signAndEditExecutable: false ve afterPack rcedit yok → exe ikonu Electron kalır');
  const nsis = bolum('nsis');
  for (const a of ['installerIcon', 'uninstallerIcon', 'installerHeaderIcon']) {
    const d = deger(nsis, a);
    assert.ok(d && fs.existsSync(path.join(KOK, d)), `nsis.${a} yok ya da dosyası yok`);
  }
  assert.equal(deger(nsis, 'uninstallerIcon'), 'build/icon.ico');
});

test('kimlik: paketli = electron-builder appId (NSIS kısayolunun kimliği); geliştirme koşusu ayrı bir kimlik', () => {
  assert.equal(deger(yml, 'appId'), URUN_KIMLIGI);
  assert.equal(uygulamaKimligi(true), URUN_KIMLIGI);
  assert.equal(uygulamaKimligi(false), GELISTIRME_KIMLIGI);
  assert.notEqual(GELISTIRME_KIMLIGI.toLowerCase(), URUN_KIMLIGI.toLowerCase());
  assert.ok(GELISTIRME_KIMLIGI.startsWith(`${URUN_KIMLIGI}.`));
  // Windows kuralı: en çok 128 karakter, boşluk yok.
  for (const k of [URUN_KIMLIGI, GELISTIRME_KIMLIGI]) assert.match(k, /^[A-Za-z0-9.]{1,128}$/);
});

test('ana süreç: setAppUserModelId tek yerde, paketli/geliştirme kimliğiyle, ilk pencereden önce; elle yazılmış kimlik yok', () => {
  const ana = kaynak('src/main/main.ts');
  const kimlik = kaynak('src/main/kabuk-kimligi.ts');
  assert.match(kimlik, /app\.setAppUserModelId\(uygulamaKimligi\(app\.isPackaged\)\)/);
  // main.ts modül düzeyinde (whenReady'den ve ilk BrowserWindow'dan önce) kimliği kurar ve ikon kancasını bağlar.
  const kur = ana.indexOf('kimligiKur()');
  const kanca = ana.indexOf('pencereIkonlariniKur()');
  const hazir = ana.indexOf('app.whenReady()');
  assert.ok(kur > 0 && kur < hazir, 'kimligiKur() whenReady\'den önce çağrılmıyor');
  assert.ok(kanca > 0 && kanca < hazir, 'pencereIkonlariniKur() whenReady\'den önce çağrılmıyor');
  // Kimlik gaspı temizliği pencerelerden ÖNCE (görev çubuğu düğmesi doğru kısayola çözülsün).
  const temizlik = ana.indexOf('kimlikGaspiniTemizle()');
  assert.ok(temizlik > hazir && temizlik < ana.indexOf('anaOlustur(!gizli)'), 'kimlikGaspiniTemizle() ana pencereden önce çağrılmıyor');
  // Başka hiçbir ana süreç dosyası kimliği elle yazmaz ya da yeniden kurmaz.
  const dosyalar = fs.readdirSync(path.join(KOK, 'src/main'), { recursive: true, withFileTypes: false }) as string[];
  for (const d of dosyalar.filter((x) => x.endsWith('.ts'))) {
    const k = kaynak(path.join('src/main', d));
    assert.ok(!k.includes(`'${URUN_KIMLIGI}'`) && !k.includes(`"${URUN_KIMLIGI}"`), `src/main/${d} kimliği elle yazıyor`);
    if (!d.endsWith('kabuk-kimligi.ts')) assert.ok(!/setAppUserModelId/.test(k), `src/main/${d} kimliği yeniden kuruyor`);
  }
});

test('kimlik gaspı: ürün kimliğini BİREBİR taşıyıp bağımsız değişkensiz, çıplak bir electron.exe açan kısayol; Fuber\'in kendisi ve başkaları değil', () => {
  const exe = 'C:\\Kullanicilar\\Deniz\\AppData\\Local\\Programs\\Fuber AI\\Fuber AI.exe';
  const dev = 'C:\\Kullanicilar\\Deniz\\Desktop\\fuber-ai-v1\\node_modules\\electron\\dist\\electron.exe';
  // 27 Eki'deki kısayol: hedef geliştirme klonunun electron.exe'si, kimlik ürününki, bağımsız değişken yok.
  assert.equal(kimlikGaspiMi({ hedef: dev, kimlik: URUN_KIMLIGI }, exe), true);
  assert.equal(kimlikGaspiMi({ hedef: dev, kimlik: URUN_KIMLIGI, args: '' }, exe), true);
  assert.equal(kimlikGaspiMi({ hedef: dev, kimlik: URUN_KIMLIGI, args: '   ' }, exe), true); // yalnız boşluk = bağımsız değişken yok
  // Hedef yolunun yazımı (eğik çizgi, tırnak, büyük harf) kuralı değiştirmez.
  assert.equal(kimlikGaspiMi({ hedef: dev.replace(/\\/g, '/'), kimlik: URUN_KIMLIGI }, exe), true);
  assert.equal(kimlikGaspiMi({ hedef: `"${dev.toUpperCase()}"`, kimlik: URUN_KIMLIGI }, exe), true);
  // Kimlik BİREBİR olmalı (fix turu 1): harf farkı ya da boşluklu kimlik gasp sayılmaz (ön süzgeç harf duyarsız kalır, karar kesin).
  assert.equal(kimlikGaspiMi({ hedef: dev.replace(/\\/g, '/'), kimlik: 'AI.Fuber.Masaustu' }, exe), false);
  assert.equal(kimlikGaspiMi({ hedef: `"${dev.toUpperCase()}"`, kimlik: ` ${URUN_KIMLIGI} ` }, exe), false);
  // Bağımsız değişkenli electron.exe (bir uygulama klasörünü açan kısayol) "çıplak" değil: dokunulmaz.
  assert.equal(kimlikGaspiMi({ hedef: dev, kimlik: URUN_KIMLIGI, args: '"C:\\Kullanicilar\\Deniz\\Desktop\\fuber-ai-v1"' }, exe), false);
  assert.equal(kimlikGaspiMi({ hedef: dev, kimlik: URUN_KIMLIGI, args: '.' }, exe), false);
  // Fuber'in kendi kısayolu (yazım farkları dahil) ve başka bir yere kurulmuş Fuber AI.exe: gasp değil.
  assert.equal(kimlikGaspiMi({ hedef: exe, kimlik: URUN_KIMLIGI }, exe), false);
  assert.equal(kimlikGaspiMi({ hedef: exe.toLowerCase().replace(/\\/g, '/'), kimlik: URUN_KIMLIGI }, exe), false);
  assert.equal(kimlikGaspiMi({ hedef: 'C:\\Program Files\\Fuber AI\\Fuber AI.exe', kimlik: URUN_KIMLIGI }, exe), false);
  // Geliştirme koşusunun kendi electron.exe'si (çalışan exe) ya da geliştirme kimliği: gasp değil.
  assert.equal(kimlikGaspiMi({ hedef: dev, kimlik: URUN_KIMLIGI }, dev), false);
  assert.equal(kimlikGaspiMi({ hedef: dev, kimlik: GELISTIRME_KIMLIGI }, exe), false);
  // Başka Electron uygulamaları, kimliksiz kısayollar, hedefsiz kısayollar: dokunulmaz.
  assert.equal(kimlikGaspiMi({ hedef: dev, kimlik: 'electron.app.Antigravity' }, exe), false);
  assert.equal(kimlikGaspiMi({ hedef: dev }, exe), false);
  assert.equal(kimlikGaspiMi({ kimlik: URUN_KIMLIGI }, exe), false);
  assert.equal(kimlikGaspiMi({ hedef: 'C:\\Araclar\\notelectron.exe', kimlik: URUN_KIMLIGI }, exe), false);
});

test('gasp ön süzgeci (ham .lnk baytları): UTF-16 kimlik (çift/tek hiza) + electron.exe (ANSI ya da UTF-16); biri eksikse aday değil', () => {
  const u16 = (s: string) => Buffer.from(s, 'utf16le');
  const ansi = (s: string) => Buffer.from(s, 'latin1');
  const dolgu = (n: number) => Buffer.alloc(n, 0x07);
  const yol = 'C:\\Klon\\node_modules\\electron\\dist\\electron.exe';
  // Gerçek düzene benzer: başlık, ANSI hedef yolu (LinkInfo), UTF-16 ad, özellik deposunda UTF-16 kimlik.
  const lnk = (kimlik: string, hedef: Buffer, hiza = 0) => new Uint8Array(Buffer.concat([dolgu(76 + hiza), hedef, dolgu(31), u16(kimlik), dolgu(8)]));
  assert.equal(gaspAdayiMi(lnk(URUN_KIMLIGI, ansi(yol))), true);
  assert.equal(gaspAdayiMi(lnk(URUN_KIMLIGI, ansi(yol), 1)), true); // kimlik tek bayt hizasında
  assert.equal(gaspAdayiMi(lnk('AI.FUBER.MASAUSTU', u16(yol.toUpperCase()))), true);
  // Fuber'in kendi kısayolu (kimlik var, electron.exe yok) ve başka Electron uygulaması (electron.exe var, kimlik başka): çözülmez.
  assert.equal(gaspAdayiMi(lnk(URUN_KIMLIGI, ansi('C:\\Kullanicilar\\Deniz\\AppData\\Local\\Programs\\Fuber AI\\Fuber AI.exe'))), false);
  assert.equal(gaspAdayiMi(lnk('electron.app.Antigravity', ansi(yol))), false);
  assert.equal(gaspAdayiMi(new Uint8Array(0)), false);
});

test('temizlik kipi: testte (FUBER_VERI) KURU ve yalnız testin klasörü; üretimde (paketli, FUBER_VERI yok) gerçek Başlat menüsü', () => {
  const w = { platform: 'win32', paketli: true };
  // Üretim: FUBER_VERI yok → gerçek Başlat menüsü; FUBER_TEST_BASLAT_MENUSU yok sayılır.
  assert.deepEqual(temizlikKipi(w), { kip: 'gercek' });
  assert.deepEqual(temizlikKipi({ ...w, testKlasoru: 'C:\\Test' }), { kip: 'gercek' });
  // Test: FUBER_VERI var → KURU, yalnız testin klasörü; klasör yoksa hiçbir şey (gerçek Başlat menüsüne asla düşmez).
  assert.deepEqual(temizlikKipi({ ...w, veri: 'C:\\Veri', testKlasoru: 'C:\\Test' }), { kip: 'kuru', klasor: 'C:\\Test' });
  assert.deepEqual(temizlikKipi({ ...w, veri: 'C:\\Veri' }), { kip: 'yok' });
  assert.deepEqual(temizlikKipi({ ...w, veri: 'C:\\Veri', testKlasoru: 'C:\\Test', demo: true }), { kip: 'kuru', klasor: 'C:\\Test' });
  assert.deepEqual(temizlikKipi({ platform: 'win32', paketli: false, veri: 'C:\\Veri', testKlasoru: 'C:\\Test' }), { kip: 'kuru', klasor: 'C:\\Test' });
  // Geliştirme koşusu (paketsiz) ya da FUBER_DEMO, FUBER_VERI'siz bile gerçek Başlat menüsüne dokunmaz; Windows dışı hiç.
  assert.deepEqual(temizlikKipi({ platform: 'win32', paketli: false }), { kip: 'yok' });
  assert.deepEqual(temizlikKipi({ platform: 'win32', paketli: false, testKlasoru: 'C:\\Test' }), { kip: 'yok' });
  assert.deepEqual(temizlikKipi({ ...w, demo: true }), { kip: 'yok' });
  assert.deepEqual(temizlikKipi({ platform: 'darwin', paketli: true }), { kip: 'yok' });
  assert.deepEqual(temizlikKipi({ platform: 'darwin', paketli: true, veri: 'V', testKlasoru: 'T' }), { kip: 'yok' });
  // Sürüm başına bir kez.
  assert.equal(kisayolTemizligiGerekli(undefined, '0.10.0'), true);
  assert.equal(kisayolTemizligiGerekli('0.9.0', '0.10.0'), true);
  assert.equal(kisayolTemizligiGerekli('0.10.0', '0.10.0'), false);
  // Ayar yalnız ana sürecin: arayüzün bayat kopyası onu geri alamaz.
  assert.equal('kisayolTemizligiSurumu' in ayarKaydiniSuz({ kisayolTemizligiSurumu: '', kullaniciAdi: 'Deniz' } as never), false);
});

test('kimlik gaspı temizliği (kaynak): Geri Dönüşüm Kutusu (trashItem, beklenmez), kalıcı silme YOK; kuru kip kayıt yazar ve dosyaya dokunmaz; sürüm kapısı', () => {
  const ham = oku('src/main/kabuk-kimligi.ts');
  const k = kaynak('src/main/kabuk-kimligi.ts');
  // R14: bu modülde kalıcı silme hiç yok (yorumlarda da); taşıma Geri Dönüşüm Kutusu'na.
  assert.doesNotMatch(ham, /rmSync|unlinkSync|unlink|\bfs\.rm\b|\brm\(/, 'kalıcı silme var');
  assert.match(k, /shell\.trashItem\(/);
  assert.match(k, /void shell\.trashItem\([^)]*\)\.then\(/, 'taşıma beklenmemeli (fire-and-forget) ve sonucu günlüğe yazılmalı');
  // Fix turu 2: giriş noktası hiçbir koşulda fırlatmaz (ana pencereden önce çalışır); sürüm yazımı ayrıca sarılı; main.ts çağrıyı da sarar.
  assert.match(k, /export function kimlikGaspiniTemizle\(\): string\[\] \{\n {2}try \{ return temizlikYap\(\); \} catch \(e\) \{\n\s+console\.warn\([\s\S]*?\n\s+return \[\];/, 'giriş noktası sarılı değil');
  assert.match(k, /try \{ ayarlariKaydet\(\(a\) => \{ a\.kisayolTemizligiSurumu = surum; \}\); \} catch \(e\) \{\n\s+console\.warn\(/, 'sürüm yazımı sarılı değil');
  assert.match(kaynak('src/main/main.ts'), /try \{ kimlikGaspiniTemizle\(\); \} catch \(e\) \{ console\.warn\(/, 'main.ts çağrıyı sarmıyor');
  const govde = k.match(/function temizlikYap\(\)[^{]*\{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.ok(govde, 'temizlikYap gövdesi yok');
  // Kapı tek yerde (temizlikKipi), ortam değişkenleri doğrudan ona.
  assert.match(govde, /temizlikKipi\(\{[\s\S]*?veri: process\.env\.FUBER_VERI[\s\S]*?testKlasoru: process\.env\.FUBER_TEST_BASLAT_MENUSU[\s\S]*?\}\)/);
  assert.match(govde, /paketli: app\.isPackaged/);
  assert.match(govde, /kip\.kip === 'yok'\) return/);
  // Sürüm kapısı: taramadan önce denetlenir, tarama sonrası yazılır.
  const kapi = govde.indexOf('kisayolTemizligiGerekli(');
  assert.ok(kapi > 0 && kapi < govde.indexOf('gaspcilariBul('), 'sürüm kapısı taramadan sonra');
  assert.match(govde, /a\.kisayolTemizligiSurumu = surum/);
  assert.match(govde, /app\.getVersion\(\)/);
  // Kuru kip: kayıt <FUBER_VERI>/kisayol-temizligi.json'a yazılır ve trashItem'a varmadan döner.
  const kuru = govde.match(/if \(kip\.kip === 'kuru'\) \{([\s\S]*?)\n {2}\}/)?.[1] ?? '';
  assert.match(kuru, /process\.env\.FUBER_VERI!?, 'kisayol-temizligi\.json'/);
  assert.match(kuru, /return /);
  assert.doesNotMatch(kuru, /trashItem/);
  assert.ok(govde.indexOf("if (kip.kip === 'kuru')") < govde.indexOf('trashItem('), 'trashItem kuru kipten önce');
  // Gerçek Başlat menüsü yalnız gercek kipte (kuru kipte testin klasörü).
  assert.match(govde, /kip\.kip === 'kuru' \? kip\.klasor : path\.join\(app\.getPath\('appData'\), 'Microsoft', 'Windows', 'Start Menu', 'Programs'\)/);
  // Tarama: ucuz süzgeç → yalnız adaylar çözülür → kural (bağımsız değişkenlerle) → çalışan exe ile karşılaştırma.
  const bul = k.match(/function gaspcilariBul\([^)]*\)[^{]*\{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.ok(bul.indexOf('gaspAdayiMi(') > 0 && bul.indexOf('gaspAdayiMi(') < bul.indexOf('readShortcutLink('), 'kısayollar süzgeçsiz çözülüyor');
  assert.match(bul, /kimlikGaspiMi\(\{ hedef: k\.target, kimlik: k\.appUserModelId, args: k\.args \}, process\.execPath\)/);
});

test('her pencereye Fuber ikonu: browser-window-created kancası setIcon (+ Windows kimliği); kabuk seçenekleri de ikon verir', () => {
  const k = kaynak('src/main/pencere-kabugu.ts');
  const kur = k.match(/export function pencereIkonlariniKur\([^)]*\)[^{]*\{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.match(kur, /app\.on\('browser-window-created'/, 'kanca yok: kabuksuz pencereler (ada, kulak, imleç, açılır pencere, deneme) ikonsuz kalır');
  const ver = k.match(/export function pencereyeIkonVer\([^)]*\)[^{]*\{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.match(ver, /w\.setIcon\(/);
  assert.match(ver, /setAppDetails\(/);
  assert.match(ver, /uygulamaKimligi\(app\.isPackaged\)/);
  assert.match(k, /icon:\s*pencereIkonu\(\)/);
  // Kancanın kapsamadığı pencere yok: ana süreçte her BrowserWindow kancalı uygulamada açılır (main.ts kancayı modül düzeyinde bağlar).
  const pencereDosyalari = (fs.readdirSync(path.join(KOK, 'src/main'), { recursive: true }) as string[])
    .filter((d) => d.endsWith('.ts') && /new BrowserWindow\(/.test(kaynak(path.join('src/main', d))));
  assert.ok(pencereDosyalari.length >= 5, pencereDosyalari.join(', '));
});

test('Windows bildirimi Fuber ikonuyla (fuber.png); test kaydı ikonu da yazar', () => {
  const z = kaynak('src/main/zamanlayici.ts');
  assert.match(z, /new Notification\(\{[^}]*icon:\s*ikon/);
  assert.match(z, /yollar\.kaynak\('ikon', 'fuber\.png'\)/);
  assert.match(z, /testBildirimleri\.push\(\{[^}]*ikon/);
  assert.ok(fs.existsSync(path.join(KOK, 'resources/ikon/fuber.png')));
  // Uygulamada başka bildirim yolu yok (hepsi bildirimGoster'den geçer).
  for (const d of (fs.readdirSync(path.join(KOK, 'src/main'), { recursive: true }) as string[]).filter((x) => x.endsWith('.ts') && !x.endsWith('zamanlayici.ts'))) {
    assert.ok(!/new Notification\(/.test(kaynak(path.join('src/main', d))), `src/main/${d} kendi bildirimini açıyor`);
  }
});

test('tepsi: Windows\'ta görev çubuğu temasına göre Fuber işareti; okunamazsa pencere ikonuna düşer (Electron\'un boş ikonuna değil)', () => {
  const ana = kaynak('src/main/main.ts');
  assert.match(ana, /new Tray\(tepsiResmi\(\)\)/);
  assert.match(ana, /r\.isEmpty\(\) \? pencereIkonu\(\)/);
  for (const ad of ['tepsi-koyu.ico', 'tepsi-acik.ico']) assert.ok(fs.statSync(path.join(KOK, 'resources/ikon', ad)).size > 1000);
});
