// G2 (0.11 spec §2): veri yaşam döngüsü — "Yeni başla", "Verilerimi sil", "Eski yedekleri sil" ve "Tekrar hoş geldin" özeti
// (src/main/veri/temizlik.ts). Her şey GEÇİCİ bir kökte: gerçek %APPDATA%\Fuber AI'ye hiçbir yolda dokunulmaz (işlevler kökü parametreyle
// alır; yollar.ts okunmaz). Sınanır:
//  · yeni-basla: kişisel dosyalar yedekler/<YYYY-AA-GG-SS-DD>/ altına TAŞINIR (silinmez); indirilen yapay zekâ (yerel/, whisper/) ve
//    Electron'un önbelleği yerinde; işaretler silinir; aynı dakikada ikinci yedek ayrı klasöre.
//  · sil: kökteki her şey gider; yerel/ ve whisper/ yalnız seçilince; Chromium'un o an tuttuğu iki çalışma dosyası (lockfile, Local State)
//    kalır.
//  · Kök dışına çıkan bağlantı (Windows'ta dizin bağlantısı / junction) hiçbir yolda izlenmez: hedefi silinmez, taşınmaz.
//  · İşlem yokken ya da işaret bozukken hiçbir şey değişmez; işaret işlemden ÖNCE silinir (en çok bir kez — her açılışta yeniden silinmez).
//  · yedekleriSil yalnız yedekler/'e dokunur. veriOzeti hafıza/sohbet sayısı, son kullanım ve hesap e-postası.
//  · main.ts işlemi ayarlar ve veritabanı açılmadan, app.whenReady'den önce uygular.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  KISISEL, EK_KISISEL, ISARET_YENIDEN_KURULUM, ISARET_VERI_ISLEMI, veriIslemiIste, bekleyenVeriIsleminiUygula, yedekleriSil, veriOzeti,
  yedekSayisi, klasorBoyutuSinirli, yenidenKurulumVar, yenidenKurulumIsaretiniSil, INDIRILEN, type DosyaIslemleri,
} from '../src/main/veri/temizlik.ts';

const geciciler: string[] = [];
after(() => { for (const d of geciciler) fs.rmSync(d, { recursive: true, force: true }); });
const gecici = (ad: string) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), `fuber-veri-${ad}-`)); geciciler.push(d); return d; };

/** 0.14'te eklenen profil başına depolar (son inceleme I2): "Yeni başla" yedeğe taşır, "Verilerimi sil" siler. Odak ve Yapılacaklar fuber.db'dedir. */
const YENI_014 = ['raf.json', 'raf.json.bak', 'mcp-araclar.json', 'mcp-araclar.json.bak', 'mcp-katalog.json', 'mcp-katalog.json.bak',
  'tarayici-siteler.json.bak', 'pano-onbellek.json.bak'];

test('I2: 0.14 depoları (Raf, MCP araç listesi, MCP kataloğu ve .bak eşleri) EK_KISISEL\'de', () => {
  for (const k of YENI_014) assert.ok(EK_KISISEL.includes(k), `${k} EK_KISISEL'de yok`);
});

test('I2: yeni-basla Raf ve MCP önbelleklerini yedeğe taşır (silmez); yeni profil eskisini görmez', () => {
  const kok = profilKur('i2');
  fs.writeFileSync(path.join(kok, 'raf.json'), '{"surum":1,"ogeler":[{"yol":"C:\\\\eski\\\\sozlesme.docx"}]}');
  veriIslemiIste(kok, { tur: 'yeni-basla' });
  const r = bekleyenVeriIsleminiUygula(kok, ZAMAN);
  for (const k of YENI_014) {
    assert.ok(!var_(kok, k), `${k} kökte kaldı`);
    assert.ok(fs.existsSync(path.join(r.yedek!, k)), `${k} yedekte yok`);
  }
  assert.match(fs.readFileSync(path.join(r.yedek!, 'raf.json'), 'utf8'), /sozlesme/);
});

test('I2: Verilerimi sil Raf ve MCP önbelleklerini de siler', () => {
  const kok = profilKur('i2sil');
  veriIslemiIste(kok, { tur: 'sil' });
  bekleyenVeriIsleminiUygula(kok, ZAMAN);
  for (const k of YENI_014) assert.ok(!var_(kok, k), `${k} silinmedi`);
});

/** Gerçek profilin biçimi: KISISEL dosyalar/klasörler, ek kişisel durum, indirilen yapay zekâ, Electron önbelleği ve Chromium çalışma dosyaları. */
function profilKur(ad: string): string {
  const kok = gecici(ad);
  const yaz = (p: string, icerik = `${p} içeriği`) => { fs.mkdirSync(path.dirname(path.join(kok, p)), { recursive: true }); fs.writeFileSync(path.join(kok, p), icerik); };
  for (const k of KISISEL) {
    if (k.includes('.')) yaz(k);
    else yaz(path.join(k, 'icerik.txt'));
  }
  yaz(path.join('whatsapp-oturum', 'alt', 'creds.json'));
  yaz(path.join('Partitions', 'fuber-tarayici', 'Cookies'));
  yaz('tarayici-siteler.json'); yaz('claude-klasor-guveni.json'); yaz('pano-onbellek.json'); yaz('beyin-gunu.json'); yaz('claude-oturumlar.json');
  yaz('soz-onbellek.json'); yaz('soz-onbellek.json.bak'); // 0.14 T25: dinlenen parçaların şarkı sözü önbelleği
  for (const k of YENI_014) yaz(k); // 0.14 son inceleme I2: Raf, MCP araç/katalog önbelleği ve jsonYaz .bak eşleri
  yaz(path.join('toplantilar', 't-20261112-101500-ab12.json')); // 12 Kas: Toplantı modunun geçmiş toplantıları
  yaz(path.join('yerel', 'model.gguf'), 'GGUF'); yaz(path.join('yerel', 'llama', 'llama-server.exe'), 'MZ');
  yaz(path.join('whisper', 'x.bin'), 'WHISPER');
  yaz(path.join('ses', 'piper', 'tr_TR-model.onnx'), 'PIPER');
  yaz(path.join('Cache', 'Cache_Data', 'data_0'), 'onbellek');
  yaz('lockfile', ''); yaz('Local State', '{}');
  return kok;
}
const var_ = (kok: string, p: string) => fs.existsSync(path.join(kok, p));
/** Kökün bütün içeriği (göreli yol → içerik): "hiçbir şey değişmedi" karşılaştırması. */
function anlik(kok: string): Record<string, string> {
  const o: Record<string, string> = {};
  const gez = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isSymbolicLink()) { o[path.relative(kok, p)] = '→bağlantı'; continue; }
      if (e.isDirectory()) { o[`${path.relative(kok, p)}/`] = ''; gez(p); } else o[path.relative(kok, p)] = fs.readFileSync(p, 'utf8');
    }
  };
  gez(kok);
  return o;
}
/** Kökün DIŞINDA bir klasör (bağlantı hedefi) — içinde silinmemesi gereken bir dosya. */
function disariKur(): string {
  const d = gecici('disari');
  fs.writeFileSync(path.join(d, 'dokunma.txt'), 'kök dışı');
  return d;
}
const baglantiKur = (hedef: string, yol: string) => fs.symlinkSync(hedef, yol, process.platform === 'win32' ? 'junction' : 'dir');
const ZAMAN = new Date(2026, 9, 27, 14, 5, 30);

test('KISISEL ve işaret adları sözleşmedeki gibi', () => {
  assert.deepEqual([...KISISEL], ['fuber.db', 'fuber.db-wal', 'fuber.db-shm', 'ayarlar.json', 'ayarlar.json.bak', 'sirlar.json', 'sirlar.json.bak', 'whatsapp-oturum', 'tarayici', 'gunluk']);
  assert.equal(ISARET_YENIDEN_KURULUM, '.yeniden-kurulum');
  assert.equal(ISARET_VERI_ISLEMI, '.veri-islemi');
  // Ek kişisel durum KISISEL ile kesişmez; indirilen yapay zekâ hiçbir listede yok.
  assert.deepEqual(EK_KISISEL.filter((x) => KISISEL.includes(x)), []);
  for (const l of [KISISEL, EK_KISISEL]) for (const x of ['yerel', 'whisper', 'yedekler']) assert.ok(!l.includes(x), x);
});

test('yeni-basla: kişisel dosyalar yedekler/<zaman>/ altına taşınır; yerel/, whisper/ ve Electron önbelleği yerinde; işaretler silinir', () => {
  const kok = profilKur('yeni');
  fs.writeFileSync(path.join(kok, ISARET_YENIDEN_KURULUM), 'kaldirildi');
  const once = anlik(kok);
  veriIslemiIste(kok, { tur: 'yeni-basla' });
  const isaret = JSON.parse(fs.readFileSync(path.join(kok, ISARET_VERI_ISLEMI), 'utf8'));
  assert.equal(isaret.tur, 'yeni-basla');
  assert.ok(!Number.isNaN(Date.parse(isaret.zaman)), 'zaman ISO');
  const r = bekleyenVeriIsleminiUygula(kok, ZAMAN);
  assert.equal(r.yapildi, 'yeni-basla');
  const yedek = path.join(kok, 'yedekler', '2026-10-27-14-05');
  assert.equal(r.yedek, yedek);
  for (const k of [...KISISEL, ...EK_KISISEL]) {
    assert.ok(!var_(kok, k), `${k} kökte kaldı`);
    assert.ok(fs.existsSync(path.join(yedek, k)), `${k} yedekte yok`);
  }
  // İçerik aynen taşındı (alt klasörler dahil).
  assert.equal(fs.readFileSync(path.join(yedek, 'fuber.db'), 'utf8'), once['fuber.db']);
  assert.equal(fs.readFileSync(path.join(yedek, 'whatsapp-oturum', 'alt', 'creds.json'), 'utf8'), once[path.join('whatsapp-oturum', 'alt', 'creds.json')]);
  assert.equal(fs.readFileSync(path.join(yedek, 'Partitions', 'fuber-tarayici', 'Cookies'), 'utf8'), once[path.join('Partitions', 'fuber-tarayici', 'Cookies')]);
  // İndirilen yapay zekâ ve Electron'un önbelleği/çalışma dosyaları yerinde.
  assert.equal(fs.readFileSync(path.join(kok, 'yerel', 'model.gguf'), 'utf8'), 'GGUF');
  assert.ok(var_(kok, path.join('yerel', 'llama', 'llama-server.exe')));
  assert.equal(fs.readFileSync(path.join(kok, 'whisper', 'x.bin'), 'utf8'), 'WHISPER');
  assert.equal(fs.readFileSync(path.join(kok, 'ses', 'piper', 'tr_TR-model.onnx'), 'utf8'), 'PIPER');
  for (const k of [path.join('Cache', 'Cache_Data', 'data_0'), 'lockfile', 'Local State']) assert.ok(var_(kok, k), k);
  assert.ok(!var_(kok, ISARET_VERI_ISLEMI) && !var_(kok, ISARET_YENIDEN_KURULUM), 'işaretler silinmedi');
  assert.equal(yedekSayisi(kok), 1);
  // İkinci çağrı: işlem yok, hiçbir şey değişmez.
  const sonra = anlik(kok);
  assert.deepEqual(bekleyenVeriIsleminiUygula(kok, ZAMAN), { yapildi: null });
  assert.deepEqual(anlik(kok), sonra);
});

test('yeni-basla aynı dakikada ikinci kez: önceki yedeğin üstüne yazılmaz, yeni klasör açılır', () => {
  const kok = profilKur('ayni-dakika');
  fs.mkdirSync(path.join(kok, 'yedekler', '2026-10-27-14-05'), { recursive: true });
  fs.writeFileSync(path.join(kok, 'yedekler', '2026-10-27-14-05', 'fuber.db'), 'ESKİ YEDEK');
  veriIslemiIste(kok, { tur: 'yeni-basla' });
  const r = bekleyenVeriIsleminiUygula(kok, ZAMAN);
  assert.equal(r.yedek, path.join(kok, 'yedekler', '2026-10-27-14-05-2'));
  assert.equal(fs.readFileSync(path.join(kok, 'yedekler', '2026-10-27-14-05', 'fuber.db'), 'utf8'), 'ESKİ YEDEK');
  assert.equal(fs.readFileSync(path.join(kok, 'yedekler', '2026-10-27-14-05-2', 'fuber.db'), 'utf8'), 'fuber.db içeriği');
  assert.equal(yedekSayisi(kok), 2);
});

test('sil (yerelDahil: false): kişisel dosyalar, yedekler ve Electron önbelleği gider; yerel/ ve whisper/ kalır', () => {
  const kok = profilKur('sil');
  fs.mkdirSync(path.join(kok, 'yedekler', '2026-10-01-09-00'), { recursive: true });
  fs.writeFileSync(path.join(kok, 'yedekler', '2026-10-01-09-00', 'fuber.db'), 'eski');
  fs.writeFileSync(path.join(kok, ISARET_YENIDEN_KURULUM), 'kaldirildi');
  veriIslemiIste(kok, { tur: 'sil', yerelDahil: false });
  const r = bekleyenVeriIsleminiUygula(kok, ZAMAN);
  assert.equal(r.yapildi, 'sil');
  assert.equal(r.yedek, undefined);
  for (const k of [...KISISEL, ...EK_KISISEL, 'yedekler', 'Cache']) assert.ok(!var_(kok, k), `${k} silinmedi`);
  // 0.14 T25 düzeltme turu 1: "Verilerimi sil" şarkı sözü önbelleğini (dinlenen parçalar) ve yedeğini de siler.
  assert.ok(EK_KISISEL.includes('soz-onbellek.json') && EK_KISISEL.includes('soz-onbellek.json.bak'));
  assert.ok(!var_(kok, 'soz-onbellek.json') && !var_(kok, 'soz-onbellek.json.bak'), 'şarkı sözü önbelleği silinmedi');
  assert.equal(fs.readFileSync(path.join(kok, 'yerel', 'model.gguf'), 'utf8'), 'GGUF');
  assert.equal(fs.readFileSync(path.join(kok, 'whisper', 'x.bin'), 'utf8'), 'WHISPER');
  // Chromium'un açılışta tuttuğu çalışma dosyaları (kişisel veri yok) dokunulmaz.
  assert.ok(var_(kok, 'lockfile') && var_(kok, 'Local State'));
  assert.ok(!var_(kok, ISARET_VERI_ISLEMI) && !var_(kok, ISARET_YENIDEN_KURULUM));
  // G2 düzeltme turu 1 (K4): indirilen ses modeli (ses/piper) de indirilen yapay zekâdır — seçilmeden silinmez.
  assert.equal(fs.readFileSync(path.join(kok, 'ses', 'piper', 'tr_TR-model.onnx'), 'utf8'), 'PIPER');
  assert.deepEqual(fs.readdirSync(kok).sort(), ['Local State', 'lockfile', 'ses', 'whisper', 'yerel']);
});

test('sil (yerelDahil: true): indirilen yapay zekâ (yerel/, whisper/) da gider', () => {
  const kok = profilKur('sil-yerel');
  veriIslemiIste(kok, { tur: 'sil', yerelDahil: true });
  assert.equal(bekleyenVeriIsleminiUygula(kok, ZAMAN).yapildi, 'sil');
  assert.ok(!var_(kok, 'yerel') && !var_(kok, 'whisper') && !var_(kok, 'ses'));
  assert.deepEqual(fs.readdirSync(kok).sort(), ['Local State', 'lockfile']);
});

test('kök dışını gösteren bağlantı (junction) izlenmez: sil ve yeni-basla hedefe dokunmaz', () => {
  // sil: kökte ve bir kişisel klasörün içinde kök dışına bağlantı.
  const kok = profilKur('baglanti-sil');
  const disari = disariKur();
  baglantiKur(disari, path.join(kok, 'disari'));
  baglantiKur(disari, path.join(kok, 'gunluk', 'ic-baglanti'));
  veriIslemiIste(kok, { tur: 'sil', yerelDahil: true });
  const r = bekleyenVeriIsleminiUygula(kok, ZAMAN);
  assert.equal(r.yapildi, 'sil');
  assert.equal(fs.readFileSync(path.join(disari, 'dokunma.txt'), 'utf8'), 'kök dışı', 'bağlantı hedefi silindi');
  assert.ok((r.atlanan ?? []).some((x) => x.endsWith('disari')), JSON.stringify(r.atlanan));
  assert.ok(!var_(kok, 'fuber.db'));

  // yeni-basla: KISISEL adlı bir girdinin KENDİSİ bağlantıysa taşınmaz (hedef yerinde, bağlantı da yerinde).
  const kok2 = profilKur('baglanti-yeni');
  const disari2 = disariKur();
  fs.rmSync(path.join(kok2, 'tarayici'), { recursive: true });
  baglantiKur(disari2, path.join(kok2, 'tarayici'));
  veriIslemiIste(kok2, { tur: 'yeni-basla' });
  const r2 = bekleyenVeriIsleminiUygula(kok2, ZAMAN);
  assert.equal(r2.yapildi, 'yeni-basla');
  assert.equal(fs.readFileSync(path.join(disari2, 'dokunma.txt'), 'utf8'), 'kök dışı');
  assert.ok(fs.lstatSync(path.join(kok2, 'tarayici')).isSymbolicLink(), 'bağlantı taşındı');
  assert.ok(!fs.existsSync(path.join(r2.yedek!, 'tarayici')));
  assert.ok(fs.existsSync(path.join(r2.yedek!, 'fuber.db')));
});

test('işlem yokken çağrı: { yapildi: null }, hiçbir şey değişmez (yeniden kurulum işareti dahil)', () => {
  const kok = profilKur('islem-yok');
  fs.writeFileSync(path.join(kok, ISARET_YENIDEN_KURULUM), 'kaldirildi');
  const once = anlik(kok);
  assert.deepEqual(bekleyenVeriIsleminiUygula(kok, ZAMAN), { yapildi: null });
  assert.deepEqual(anlik(kok), once);
  // Kök yoksa da sessizce hiçbir şey.
  assert.deepEqual(bekleyenVeriIsleminiUygula(path.join(kok, 'yok'), ZAMAN), { yapildi: null });
});

test('bozuk işaret: hiçbir veri değişmez, yalnız bozuk işaret kalkar (her açılışta yeniden denenmez)', () => {
  const kok = profilKur('bozuk');
  fs.writeFileSync(path.join(kok, ISARET_VERI_ISLEMI), '{"tur":"hepsini-sil"}');
  const once = anlik(kok);
  delete once[ISARET_VERI_ISLEMI];
  assert.deepEqual(bekleyenVeriIsleminiUygula(kok, ZAMAN), { yapildi: null });
  assert.deepEqual(anlik(kok), once);
  fs.writeFileSync(path.join(kok, ISARET_VERI_ISLEMI), 'json değil');
  assert.deepEqual(bekleyenVeriIsleminiUygula(kok, ZAMAN), { yapildi: null });
  assert.deepEqual(anlik(kok), once);
});

test('veriIslemiIste yalnız iki işlemi kabul eder; göreli ya da sürücü kökü verilirse hiçbir şey yapılmaz', () => {
  const kok = gecici('iste');
  assert.throws(() => veriIslemiIste(kok, { tur: 'hepsini-sil' as never }));
  assert.ok(!var_(kok, ISARET_VERI_ISLEMI));
  assert.throws(() => veriIslemiIste('goreli/klasor', { tur: 'sil' }));
  assert.throws(() => veriIslemiIste(path.parse(os.tmpdir()).root, { tur: 'sil' }));
  assert.deepEqual(bekleyenVeriIsleminiUygula('goreli/klasor', ZAMAN), { yapildi: null });
  assert.deepEqual(bekleyenVeriIsleminiUygula(path.parse(os.tmpdir()).root, ZAMAN), { yapildi: null });
});

test('yedekleriSil yalnız yedekler/ klasörünü siler; sayıyı döner; bağlantılı yedek klasörünün hedefine dokunmaz', () => {
  const kok = profilKur('yedek-sil');
  for (const z of ['2026-10-01-09-00', '2026-10-20-18-30']) {
    fs.mkdirSync(path.join(kok, 'yedekler', z, 'gunluk'), { recursive: true });
    fs.writeFileSync(path.join(kok, 'yedekler', z, 'fuber.db'), z);
  }
  const disari = disariKur();
  baglantiKur(disari, path.join(kok, 'yedekler', '2026-10-20-18-30', 'gunluk', 'disari'));
  const once = anlik(kok);
  assert.equal(yedekSayisi(kok), 2);
  assert.equal(yedekleriSil(kok), 2);
  assert.equal(fs.readFileSync(path.join(disari, 'dokunma.txt'), 'utf8'), 'kök dışı');
  const sonra = anlik(kok);
  const yedekDisi = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('yedekler')));
  assert.deepEqual(yedekDisi(sonra), yedekDisi(once), 'yedekler dışında bir şey değişti');
  assert.equal(yedekSayisi(kok), 0);
  assert.equal(yedekleriSil(kok), 0, 'yedek yokken 0');
});

test('klasorBoyutuSinirli (K2): eşzamansız, bağlantıları izlemez, sınırlı (girdi sayısı); yeniden kurulum işareti okunur ve silinir', async () => {
  const kok = gecici('boyut');
  fs.mkdirSync(path.join(kok, 'yerel', 'alt'), { recursive: true });
  fs.writeFileSync(path.join(kok, 'yerel', 'a.gguf'), Buffer.alloc(1000));
  fs.writeFileSync(path.join(kok, 'yerel', 'alt', 'b.bin'), Buffer.alloc(500));
  baglantiKur(disariKur(), path.join(kok, 'yerel', 'disari'));
  const p = klasorBoyutuSinirli(kok, 'yerel');
  assert.ok(p instanceof Promise, 'eşzamansız değil');
  assert.deepEqual(await p, { bayt: 1500, tam: true });
  assert.deepEqual(await klasorBoyutuSinirli(kok, 'yok'), { bayt: 0, tam: true });
  assert.deepEqual(await klasorBoyutuSinirli(kok, '..'), { bayt: 0, tam: true }, 'kök dışı');
  // Binlerce dosyalı yedek (Chromium önbelleği) her açılışta taranmasın: sınır aşılınca yarım sonuç (alt sınır) ve tam: false.
  fs.mkdirSync(path.join(kok, 'yedekler', 'x', 'Cache'), { recursive: true });
  for (let i = 0; i < 30; i++) fs.writeFileSync(path.join(kok, 'yedekler', 'x', 'Cache', `f${i}`), Buffer.alloc(10));
  const y = await klasorBoyutuSinirli(kok, 'yedekler', { enCokGirdi: 10 });
  assert.equal(y.tam, false);
  assert.ok(y.bayt < 300 && y.bayt >= 0, String(y.bayt));
  assert.deepEqual(await klasorBoyutuSinirli(kok, 'yedekler'), { bayt: 300, tam: true });
  assert.equal(yenidenKurulumVar(kok), false);
  fs.writeFileSync(path.join(kok, ISARET_YENIDEN_KURULUM), 'kaldirildi');
  assert.equal(yenidenKurulumVar(kok), true);
  yenidenKurulumIsaretiniSil(kok);
  assert.equal(yenidenKurulumVar(kok), false);
  yenidenKurulumIsaretiniSil(kok); // yokken hata yok
});

test('K4: indirilenler = yerel/, whisper/ ve ses/ (indirilen ses modeli)', () => {
  assert.deepEqual([...INDIRILEN], ['yerel', 'whisper', 'ses']);
});

// K3: SQLite üçlüsü ayrılmaz. Önce -wal/-shm, sonra fuber.db; eşlerden biri taşınamaz/silinemezse fuber.db'ye dokunulmaz — yeni profilin
// boş veritabanının yanında eski WAL kalıp açılışta yeniden oynatılmasın (eski sayfalar yeni profile karışmasın). Hata taklit edilir
// (dosya işlemleri parametreyle; yalnız `bozuk` adlı dosyanın KÖKTEN yapılan işlemi düşer — geri alma çalışır).
function hataliIslem(bozuk: string, tur: 'yeniAd' | 'sil'): DosyaIslemleri & { cagrilar: string[] } {
  const cagrilar: string[] = [];
  const hata = () => Object.assign(new Error('taklit: kilitli'), { code: 'EIO' });
  return {
    cagrilar,
    yeniAd: (a, b) => {
      cagrilar.push(`yeniAd ${path.basename(a)}`);
      if (tur === 'yeniAd' && path.basename(a) === bozuk && path.basename(path.dirname(path.dirname(b))) === 'yedekler') throw hata();
      fs.renameSync(a, b);
    },
    sil: (p) => {
      cagrilar.push(`sil ${path.basename(p)}`);
      if (tur === 'sil' && path.basename(p) === bozuk) throw hata();
      fs.unlinkSync(p);
    },
  };
}

test('K3 yeni-basla: -wal/-shm önce taşınır; biri taşınamazsa üçlü kökte BİRLİKTE kalır (taşınan eş geri alınır), öteki kişisel dosyalar taşınır', () => {
  for (const bozuk of ['fuber.db-wal', 'fuber.db-shm', 'fuber.db']) {
    const kok = profilKur(`k3-yeni-${bozuk}`);
    veriIslemiIste(kok, { tur: 'yeni-basla' });
    const islem = hataliIslem(bozuk, 'yeniAd');
    const r = bekleyenVeriIsleminiUygula(kok, ZAMAN, islem);
    assert.equal(r.yapildi, 'yeni-basla', bozuk);
    for (const x of ['fuber.db', 'fuber.db-wal', 'fuber.db-shm']) {
      assert.equal(fs.readFileSync(path.join(kok, x), 'utf8'), `${x} içeriği`, `${bozuk}: ${x} kökte değil`);
      assert.ok(!fs.existsSync(path.join(r.yedek!, x)), `${bozuk}: ${x} yedekte`);
    }
    assert.ok(fs.existsSync(path.join(r.yedek!, 'ayarlar.json')) && !var_(kok, 'ayarlar.json'), 'öteki dosyalar taşınmadı');
    assert.ok((r.atlanan ?? []).includes('fuber.db'), JSON.stringify(r.atlanan));
    // Sıra: eşler veritabanından önce.
    const ilkVt = islem.cagrilar.indexOf('yeniAd fuber.db');
    const ilkWal = islem.cagrilar.indexOf('yeniAd fuber.db-wal');
    assert.ok(ilkWal >= 0 && (ilkVt === -1 || ilkWal < ilkVt), JSON.stringify(islem.cagrilar));
  }
  // Hatasız: üçlü birlikte yedekte.
  const kok = profilKur('k3-yeni-tamam');
  veriIslemiIste(kok, { tur: 'yeni-basla' });
  const r = bekleyenVeriIsleminiUygula(kok, ZAMAN, hataliIslem('yok', 'yeniAd'));
  for (const x of ['fuber.db', 'fuber.db-wal', 'fuber.db-shm']) assert.ok(fs.existsSync(path.join(r.yedek!, x)) && !var_(kok, x), x);
});

test('K3 sil: -wal/-shm önce silinir; biri silinemezse fuber.db korunur; öteki her şey silinir', () => {
  for (const bozuk of ['fuber.db-wal', 'fuber.db-shm']) {
    const kok = profilKur(`k3-sil-${bozuk}`);
    veriIslemiIste(kok, { tur: 'sil', yerelDahil: false });
    const islem = hataliIslem(bozuk, 'sil');
    const r = bekleyenVeriIsleminiUygula(kok, ZAMAN, islem);
    assert.equal(r.yapildi, 'sil');
    assert.equal(fs.readFileSync(path.join(kok, 'fuber.db'), 'utf8'), 'fuber.db içeriği', `${bozuk}: fuber.db silindi`);
    assert.ok(var_(kok, bozuk), `${bozuk} yok`);
    assert.ok(!islem.cagrilar.includes('sil fuber.db'), JSON.stringify(islem.cagrilar));
    assert.ok(!var_(kok, 'ayarlar.json') && !var_(kok, 'gunluk'), 'öteki dosyalar silinmedi');
    assert.ok((r.atlanan ?? []).includes('fuber.db'), JSON.stringify(r.atlanan));
  }
  const kok = profilKur('k3-sil-tamam');
  veriIslemiIste(kok, { tur: 'sil', yerelDahil: false });
  const islem = hataliIslem('yok', 'sil');
  bekleyenVeriIsleminiUygula(kok, ZAMAN, islem);
  for (const x of ['fuber.db', 'fuber.db-wal', 'fuber.db-shm']) assert.ok(!var_(kok, x), x);
  const sira = islem.cagrilar.filter((c) => c.startsWith('sil fuber.db'));
  assert.deepEqual(sira, ['sil fuber.db-wal', 'sil fuber.db-shm', 'sil fuber.db']);
});

function vtKur(dosya: string): DatabaseSync {
  const vt = new DatabaseSync(dosya);
  vt.exec(`CREATE TABLE sohbetler(id INTEGER PRIMARY KEY, baslik TEXT NOT NULL DEFAULT 'Yeni sohbet', tur TEXT NOT NULL DEFAULT 'normal',
      olusturma TEXT NOT NULL, guncelleme TEXT NOT NULL, arsiv INTEGER NOT NULL DEFAULT 0, okunmamis INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE mesajlar(id INTEGER PRIMARY KEY, sohbet_id INTEGER NOT NULL, rol TEXT NOT NULL, metin TEXT NOT NULL DEFAULT '', kaynak TEXT, olusturma TEXT NOT NULL);
    CREATE TABLE hafizalar(id INTEGER PRIMARY KEY, tur TEXT NOT NULL, baslik TEXT NOT NULL, icerik TEXT NOT NULL, olusturma TEXT NOT NULL, guncelleme TEXT NOT NULL, silindi INTEGER NOT NULL DEFAULT 0);`);
  return vt;
}

test('veriOzeti: hafıza notu (silinmemiş), mesajlı ve arşivde olmayan sohbet sayısı, son kullanım, hesap e-postası', () => {
  const kok = gecici('ozet');
  assert.deepEqual(veriOzeti(kok), { hafiza: 0, sohbet: 0, sonKullanim: null, hesapEposta: null }, 'boş kök');
  const vt = vtKur(path.join(kok, 'fuber.db'));
  const z = '2026-10-20T10:00:00.000Z';
  const h = vt.prepare('INSERT INTO hafizalar(tur, baslik, icerik, olusturma, guncelleme, silindi) VALUES(?,?,?,?,?,?)');
  h.run('kullanici', 'Ad', 'Deniz', z, z, 0); h.run('proje', 'Mavi Kuş', '…', z, z, 0); h.run('gecici', 'Eski', '…', z, z, 1);
  const s = vt.prepare('INSERT INTO sohbetler(id, tur, olusturma, guncelleme, arsiv) VALUES(?,?,?,?,?)');
  s.run(1, 'ana', z, z, 0); s.run(2, 'normal', z, z, 0); s.run(3, 'normal', z, z, 0); s.run(4, 'normal', z, z, 1);
  const m = vt.prepare('INSERT INTO mesajlar(sohbet_id, rol, metin, olusturma) VALUES(?,?,?,?)');
  m.run(1, 'assistant', 'Günaydın', '2026-10-25T07:00:00.000Z'); m.run(2, 'user', 'Merhaba', '2026-10-26T18:42:00.000Z');
  m.run(4, 'user', 'arşiv', '2026-10-27T09:00:00.000Z'); // arşivdeki sohbet sayılmaz ama son kullanım en yeni mesajdır
  fs.writeFileSync(path.join(kok, 'ayarlar.json'), JSON.stringify({ kurulumTamam: true, hesap: { eposta: 'deniz@ornek.com', durum: 'aktif' } }));
  const beklenen = { hafiza: 2, sohbet: 2, sonKullanim: '2026-10-27T09:00:00.000Z', hesapEposta: 'deniz@ornek.com' };
  assert.deepEqual(veriOzeti(kok, vt), beklenen, 'açık bağlantıyla');
  vt.close();
  assert.deepEqual(veriOzeti(kok), beklenen, 'dosyadan (salt okunur)');
  // Ayar dosyası bozuksa yedeğinden; o da yoksa e-posta null.
  fs.writeFileSync(path.join(kok, 'ayarlar.json'), '{bozuk');
  fs.writeFileSync(path.join(kok, 'ayarlar.json.bak'), JSON.stringify({ hesap: { eposta: 'yedek@ornek.com' } }));
  assert.equal(veriOzeti(kok).hesapEposta, 'yedek@ornek.com');
  fs.rmSync(path.join(kok, 'ayarlar.json.bak'));
  assert.equal(veriOzeti(kok).hesapEposta, null);
});

test('main.ts: bekleyen veri işlemi ayarlar/veritabanı açılmadan ve app.whenReady\'den önce, yalnız birinci örnekte uygulanır', () => {
  const kaynak = fs.readFileSync(path.resolve(import.meta.dirname, '../src/main/main.ts'), 'utf8');
  const i = kaynak.indexOf('bekleyenVeriIsleminiUygula(yollar.veri()');
  assert.ok(i > 0, 'çağrı yok');
  assert.ok(i < kaynak.indexOf('app.whenReady('), 'whenReady\'den sonra');
  assert.ok(i < kaynak.indexOf('kimligiKur();'), 'pencere kimliğinden sonra');
  assert.ok(i > kaynak.indexOf('const ikinciOrnek'), 'tek örnek kilidinden önce (ikinci örnek de silerdi)');
  // Gövde (import satırları dışında) bu satırdan önce ayar ya da veritabanı okumaz.
  const govde = kaynak.slice(0, i).split('\n').filter((l) => !/^import\b/.test(l)).join('\n');
  assert.ok(!/\bayarlar\(\)|veritabani\(\)/.test(govde), 'işlemden önce ayar/veritabanı okunuyor');
  assert.match(kaynak.slice(i - 200, i), /!ikinciOrnek && !cikisIstegi/, 'yalnız birinci örnek');
});
