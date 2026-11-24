// 0.14 T27 — Raf: çentiğe bırakılan dosya ve metinlerin durağı. Saf kurallar (shared/raf.ts), ana süreç yöneticisi ve kayıt (main/raf.ts), IPC kapısı (yalnız kimlik),
// güvenlik (kopyalama yok, UNC/file: reddi, çalıştırılabilir dosya açılmaz, listede olmayan yol reddi), sürüklerken yakalama (R21) ve sayfanın kaynak kuralları.
// Ağ bekçisi açık (tests/yardimci/ana-surec.ts): Raf hiçbir şey yüklemez (P14). Dosyalar gerçek geçici klasörde; shell sahte (açma çağrıları sayılır).
import { KURULUM_SURUMU } from '../src/shared/kurulum-adimlari.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { anaSurecSahnesi, ipcKurBos, ipcIsleyicileri } from './yardimci/ana-surec.ts';
import {
  DOSYA_YOK_METNI, METIN_EN_COK, RAF_EN_COK, boyutYaz, metniKes, rafDogrula, rafEkle, surukleFareGonder, surukleYakalamayiBirakMi, surukluyorMu, type RafOgesi,
} from '../src/shared/raf.ts';
import { CAGRI_KANALLARI } from '../src/shared/kanallar.ts';

const { klasor: sahneKlasoru } = anaSurecSahnesi('raf', {
  kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, kullaniciAdi: 'Deniz', mod: 'is', tanitimSurumu: '0.9.0', ses: { surum: 2, uyandirma: false }, proaktif: { etkin: false }, baslangictaAc: false,
});
process.env.FUBER_DEMO = '1';
await ipcKurBos();
const elektron = (await import('electron')) as unknown as { shell: { openPath: (y: string) => Promise<string>; showItemInFolder: (y: string) => void }; clipboard: { writeText: (m: string) => void } };
const { rafYoneticisiKur, rafYoluDogrula, acilabilirMi, rafSurukleBagla, rafSurukle, rafGonderenBagla, rafGonderenGecerliMi } = await import('../src/main/raf.ts');
/** Sahte webContents'ler: çentik penceresi ve başka bir pencere (ana pencere). */
const CENTIK = { ad: 'centik' };
const ANA_PENCERE = { ad: 'ana' };
rafGonderenBagla((g) => g === CENTIK);
/** Çentik penceresinden gelen IPC çağrısı (varsayılan) ya da verilen göndericiden. */
const ipcKimden = <T>(gonderen: unknown, kanal: string, ...a: unknown[]) => Promise.resolve().then(() => ipcIsleyicileri().get(kanal)!({ sender: gonderen }, ...a)) as Promise<T>;
const ipc = <T>(kanal: string, ...a: unknown[]) => ipcKimden<T>(CENTIK, kanal, ...a);
const kaynakOku = (yol: string): string => fs.readFileSync(new URL(`../${yol}`, import.meta.url), 'utf8');
const yorumsuz = (k: string): string => k.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const win = process.platform === 'win32';
const gecici = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-raf-'));
const dosyaYaz = (ad: string, icerik = 'merhaba'): string => { const y = path.join(gecici, ad); fs.writeFileSync(y, icerik); return y; };

/** Sahte bağımlılıklarla yönetici: açma/gösterme/kopyalama çağrıları kaydedilir; disk gerçek (geçici klasör). */
function kur(ham: unknown = undefined, gercek: (y: string) => string | null = (y) => { try { return fs.realpathSync.native(y); } catch { return null; } }) {
  const cagrilar = { ac: [] as string[], goster: [] as string[], kopyala: [] as string[], yaz: 0 };
  let sayac = 0;
  let kayit: RafOgesi[] = [];
  const y = rafYoneticisiKur({
    oku: () => ham,
    yaz: (l) => { cagrilar.yaz++; kayit = l; },
    durum: (yol) => { try { const s = fs.statSync(yol); return { klasor: s.isDirectory(), boyut: s.size }; } catch { return null; } },
    gercekYol: gercek,
    ac: async (yol) => { cagrilar.ac.push(yol); return ''; },
    goster: (yol) => { cagrilar.goster.push(yol); },
    kopyala: (m) => { cagrilar.kopyala.push(m); },
    simdi: () => new Date(Date.UTC(2026, 10, 4, 12, 0, 0)),
    kimlik: () => `id-${++sayac}`,
  });
  return { y, cagrilar, kayit: () => kayit };
}
const dosyaSayisi = (k: string): number => fs.readdirSync(k, { recursive: true }).length;

// ── Saf kurallar ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const ornek = (i: number, yol = `C:\\Raf\\dosya-${i}.txt`): RafOgesi => ({ id: `o${i}`, tur: 'dosya', yol, ad: `dosya-${i}.txt`, boyut: i, eklendi: '2026-11-04T12:00:00.000Z' });

test('sabitler: raf en çok 30 öğe, metin kartı 2000 karakter', () => {
  assert.equal(RAF_EN_COK, 30);
  assert.equal(METIN_EN_COK, 2000);
});

test('aynı yol bir kez: büyük/küçük harf ve ayırıcı farkı aynı dosyadır; metin kartları ayrı sayılır', () => {
  let l = rafEkle([], ornek(1, 'C:\\Raf\\Rapor.docx'));
  const once = l;
  l = rafEkle(l, { ...ornek(2, 'c:/raf/rapor.DOCX') });
  assert.equal(l.length, 1, 'aynı yol ikinci kez eklenmedi');
  assert.equal(l[0].id, 'o1', 'ilk kayıt yerinde (sıra bozulmadı)');
  assert.notEqual(l, once, 'girdi dizi değiştirilmez, yeni dizi döner');
  l = rafEkle(l, { id: 'm1', tur: 'metin', metin: 'x', eklendi: 'z' });
  l = rafEkle(l, { id: 'm2', tur: 'metin', metin: 'x', eklendi: 'z' });
  assert.equal(l.length, 3, 'metin kartlarında yol yok: ikisi de kalır');
});

test('31. öğede en eskisi düşer', () => {
  let l: RafOgesi[] = [];
  for (let i = 1; i <= 30; i++) l = rafEkle(l, ornek(i));
  assert.equal(l.length, 30);
  assert.equal(l[0].id, 'o1');
  l = rafEkle(l, ornek(31));
  assert.equal(l.length, 30, 'sayı 30\'u aşmaz');
  assert.equal(l[0].id, 'o2', 'en eskisi (o1) düştü');
  assert.equal(l.at(-1)!.id, 'o31', 'yeni öğe sonda');
  assert.ok(!l.some((o) => o.id === 'o1'));
});

test('metin kartı 2000 karakterde kesilir (çift karakterin ortasından bölünmez)', () => {
  assert.equal(metniKes('a'.repeat(5000)).length, 2000);
  assert.equal(metniKes('kısa'), 'kısa');
  const yarim = 'a'.repeat(1999) + '😀😀'; // 2000. karakter bir vekil çiftinin yarısı
  assert.equal(metniKes(yarim).length, 1999, 'yarım vekil çifti atılır');
  const { y } = kur();
  const r = y.ekle({ metin: 'b'.repeat(5000) });
  assert.equal(r.eklenen, 1);
  const o = r.liste[0];
  assert.equal(o.tur, 'metin');
  assert.equal(o.tur === 'metin' ? o.metin.length : -1, 2000, 'rafa giren metin 2000 karakter');
  assert.equal(y.ekle({ metin: '   \n ' }).eklenen, 0, 'boş metin eklenmez');
});

test('rafDogrula: bozuk kayıt temiz listeye düşer (eksik alan, tekrar eden kimlik, tekrar eden yol, uzun metin, 30 sınırı); "eksik" diske girmez', () => {
  assert.deepEqual(rafDogrula(undefined), []);
  assert.deepEqual(rafDogrula('x'), []);
  const ham = [
    null, 5, { id: 'a' }, { id: 'b', tur: 'dosya', yol: 'C:\\x\\a.txt' }, // ad yok
    { id: 'c', tur: 'dosya', yol: 'C:\\x\\a.txt', ad: 'a.txt', boyut: 12, eklendi: 'z', eksik: true },
    { id: 'c', tur: 'dosya', yol: 'C:\\x\\b.txt', ad: 'b.txt', boyut: 1, eklendi: 'z' }, // kimlik tekrarı
    { id: 'd', tur: 'dosya', yol: 'c:\\X\\A.txt', ad: 'A.txt', boyut: 1, eklendi: 'z' }, // yol tekrarı
    { id: 'e', tur: 'metin', metin: 'm'.repeat(3000), eklendi: 'z' },
    { id: 'f', tur: 'metin', metin: '  ', eklendi: 'z' },
    { id: 'g', tur: 'bilinmeyen' },
    { id: 'h', tur: 'dosya', yol: 'C:\\x\\h.txt', ad: 'h.txt', boyut: -3, eklendi: 5 },
  ];
  const l = rafDogrula(ham);
  assert.deepEqual(l.map((o) => o.id), ['c', 'e', 'h']);
  const c = l[0];
  assert.equal(c.tur === 'dosya' && c.eksik, undefined, 'kayıttaki eksik bayrağı atılır');
  assert.equal(l[1].tur === 'metin' ? l[1].metin.length : 0, 2000);
  assert.equal(l[2].tur === 'dosya' ? l[2].boyut : -1, 0, 'eksi boyut sıfırlanır');
  const cok = Array.from({ length: 45 }, (_, i) => ({ id: `k${i}`, tur: 'dosya', yol: `C:\\x\\${i}.txt`, ad: `${i}.txt`, boyut: 1, eklendi: 'z' }));
  assert.equal(rafDogrula(cok).length, 30);
  assert.equal(rafDogrula(cok)[0].id, 'k15', 'en yeni 30 kalır');
});

test('boyut yazımı', () => {
  assert.equal(boyutYaz(0), '');
  assert.equal(boyutYaz(812), '812 B');
  assert.equal(boyutYaz(1536), '1,5 KB');
  assert.equal(boyutYaz(5 * 1024 * 1024), '5,0 MB');
  assert.equal(boyutYaz(250 * 1024 * 1024), '250 MB');
});

// ── Dosya kopyalanmaz ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('dosya kopyalanmaz: rafa eklemek diskte dosya sayısını ve içeriği değiştirmez; kayıt yalnız yol, ad ve boyutu taşır', () => {
  const kutu = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-raf-kopya-'));
  const a = path.join(kutu, 'a.txt'); fs.writeFileSync(a, 'AAA');
  const b = path.join(kutu, 'b.pdf'); fs.writeFileSync(b, 'BBBBB');
  fs.mkdirSync(path.join(kutu, 'alt'));
  const verim = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-raf-veri-'));
  const oncesi = dosyaSayisi(kutu);
  const verimOncesi = dosyaSayisi(verim);
  const { y, cagrilar, kayit } = kur();
  const r = y.ekle({ yollar: [a, b, path.join(kutu, 'alt')] });
  assert.equal(r.eklenen, 3);
  assert.deepEqual(r.reddedilen, []);
  assert.equal(dosyaSayisi(kutu), oncesi, 'bırakılan klasörde dosya sayısı aynı');
  assert.equal(dosyaSayisi(verim), verimOncesi, 'başka yere kopya yok');
  assert.equal(fs.readFileSync(a, 'utf8'), 'AAA');
  assert.equal(cagrilar.yaz, 1, 'kayıt tek yazım');
  for (const o of kayit()) {
    assert.ok(o.tur !== 'dosya' || Object.keys(o).sort().join() === 'ad,boyut,eklendi,id,tur,yol', `dosya kaydı yalnız referans taşır: ${Object.keys(o)}`);
  }
  const d = r.liste.find((o) => o.tur === 'dosya' && o.ad === 'b.pdf');
  assert.ok(d && d.tur === 'dosya' && d.boyut === 5 && d.yol === path.resolve(b));
  const klasorOgesi = r.liste.find((o) => o.tur === 'dosya' && o.ad === 'alt');
  assert.ok(klasorOgesi && klasorOgesi.tur === 'dosya' && klasorOgesi.boyut === 0, 'klasör de referans olarak girer (boyut 0)');
  // kaynak taraması: raf kodu dosya kopyalama/taşıma/silme çağırmaz
  const k = yorumsuz(kaynakOku('src/main/raf.ts'));
  assert.ok(!/copyFile|cpSync|renameSync\(|unlink|rmSync|writeFileSync|trashItem|createReadStream|readFile/.test(k.replace(/jsonYaz/g, '')), 'raf.ts dosyalara yazmaz/silmez/okumaz');
  fs.rmSync(kutu, { recursive: true, force: true });
  fs.rmSync(verim, { recursive: true, force: true });
});

test('aynı yol yöneticide de bir kez: ikinci bırakma "eklenmedi" sayılır', async () => {
  const a = dosyaYaz('tek.txt');
  const { y } = kur();
  assert.equal(y.ekle({ yollar: [a] }).eklenen, 1);
  const ikinci = y.ekle({ yollar: [a.toUpperCase().replace(/^C:/, 'C:')] });
  assert.equal(ikinci.eklenen, win ? 0 : 1, 'Windows\'ta büyük/küçük harf farkı aynı dosya');
  assert.equal((await y.liste()).length, win ? 1 : 2);
});

// ── Eksik dosya ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('silinen ya da taşınan dosya eksik görünür, açılmaz, "Dosya yerinde yok" der; yerine gelince yeniden açılır', async () => {
  const a = dosyaYaz('silinecek.txt');
  const { y, cagrilar } = kur();
  const id = y.ekle({ yollar: [a] }).liste[0].id;
  const l0 = (await y.liste())[0];
  assert.equal(l0.tur === 'dosya' ? l0.eksik : 'x', undefined, 'yerindeyken eksik değil');
  fs.renameSync(a, `${a}.tasindi`);
  const l = await y.liste();
  assert.equal(l[0].tur === 'dosya' && l[0].eksik, true, 'taşınan dosya eksik görünür');
  const r = await y.ac(id);
  assert.equal(r.tamam, false);
  assert.equal(r.mesaj, 'Dosya yerinde yok');
  assert.equal(r.mesaj, DOSYA_YOK_METNI);
  assert.equal(r.eylem, 'yok');
  assert.deepEqual(cagrilar.ac, [], 'açılmadı');
  assert.deepEqual(cagrilar.goster, [], 'klasörde de gösterilmedi');
  assert.equal(y.surukleYolu(id), null, 'eksik dosya dışarı sürüklenmez');
  fs.renameSync(`${a}.tasindi`, a);
  const l1 = (await y.liste())[0];
  assert.equal(l1.tur === 'dosya' && l1.eksik, undefined, 'dosya geri gelince eksik kalkar (yoklama yok: liste çekilirken bakılır)');
  assert.equal((await y.ac(id)).tamam, true);
  assert.deepEqual(cagrilar.ac, [path.resolve(a)]);
  // "eksik" diske yazılmaz
  const k = yorumsuz(kaynakOku('src/main/raf.ts'));
  assert.ok(!/setInterval|requestAnimationFrame|fs\.watch|watchFile|chokidar/.test(k), 'varlık yoklanmaz/izlenmez: yalnız liste çekilirken ve açarken bakılır');
});

// ── Açma ve sürükleme yalnız listedeki yol için ────────────────────────────────────────────────────────────────────────────────────────

test('açma ve dışarı sürükleme yalnız listedeki yol için: yöneticiye verilen başka yol ya da kimlik reddedilir', async () => {
  const a = dosyaYaz('listede.txt');
  const disarida = dosyaYaz('listede-degil.txt');
  const { y, cagrilar } = kur();
  const id = y.ekle({ yollar: [a] }).liste[0].id;
  for (const kotu of [disarida, a, path.resolve(a), 'C:\\Windows\\System32\\cmd.exe', '..\\x', '', null, undefined, 5, {}, ['id-1'], 'id-999', `${id} `]) {
    const r = await y.ac(kotu);
    assert.equal(r.tamam, false, `reddedilmeli: ${JSON.stringify(kotu)}`);
    assert.equal(r.eylem, 'reddedildi');
    assert.equal(y.surukleYolu(kotu), null, `sürüklenmemeli: ${JSON.stringify(kotu)}`);
  }
  assert.deepEqual(cagrilar.ac, [], 'listede olmayan hiçbir şey açılmadı');
  assert.deepEqual(cagrilar.goster, []);
  assert.equal(y.surukleYolu(id), path.resolve(a), 'listedeki dosya için sürükleme yolu verilir');
  assert.equal((await y.ac(id)).eylem, 'acildi');
  assert.deepEqual(cagrilar.ac, [path.resolve(a)]);
});

test('I1: tüm raf:* çağrıları yalnız çentik penceresinin webContents\'inden kabul edilir; başka pencere ya da göndericisiz çağrı reddedilir', async () => {
  const a = dosyaYaz('gonderen.txt');
  const r = await ipc<{ liste: RafOgesi[] }>('raf:birak', { yollar: [a] });
  const id = r.liste.find((o) => o.tur === 'dosya' && o.ad === 'gonderen.txt')!.id;
  const oncesi = (await ipc<RafOgesi[]>('raf:liste')).length;
  const kanallar: [string, unknown[]][] = [['raf:liste', []], ['raf:birak', [{ yollar: [dosyaYaz('baska-pencere.txt')], metin: 'x' }]], ['raf:ac', [id]], ['raf:sil', [id]], ['raf:surukle', [id]]];
  for (const gonderen of [ANA_PENCERE, {}, null, undefined, 'centik', 5]) {
    for (const [k, arg] of kanallar) {
      await assert.rejects(ipcKimden(gonderen, k, ...arg), /yalnız çentik/, `${k} ${JSON.stringify(gonderen)} göndericisinden reddedilir`);
    }
  }
  assert.equal((await ipc<RafOgesi[]>('raf:liste')).length, oncesi, 'reddedilen çağrılar hiçbir şeyi değiştirmedi (ekleme/silme yok)');
  assert.ok(rafGonderenGecerliMi(CENTIK) && !rafGonderenGecerliMi(ANA_PENCERE) && !rafGonderenGecerliMi(null) && !rafGonderenGecerliMi(undefined));
  // Çentik penceresi için aynı çağrılar çalışır
  assert.equal((await ipc<{ tamam: boolean }>('raf:ac', id)).tamam, true);
  assert.ok(Array.isArray(await ipc('raf:sil', id)));
  // Gönderen bağlayıcısı hiç kurulmamışsa (varsayılan) kimse kabul edilmez: ada.ts bağlar.
  const ada = kaynakOku('src/main/ada.ts');
  assert.match(ada, /rafGonderenBagla\(\(g\) => \{ const w = canli\(\); return Boolean\(w\) && g === w!\.webContents; \}\)/, 'ada.ts gönderen olarak çentiğin webContents\'ini bağlar');
});

test('I1: yol dizisini arayüz göndermez — preload çözer: rafBirak köprüsü webUtils ile yolu preload\'da çıkarır, özel raf:birak kanalına yollar; sayfa yol/yolAl kullanmaz', () => {
  const preload = yorumsuz(kaynakOku('src/preload/preload.ts'));
  assert.match(preload, /rafBirak: \(dosyalar: File\[\], metin\?: string\)/);
  assert.match(preload, /webUtils\.getPathForFile\(d\)/);
  assert.match(preload, /ipcRenderer\.invoke\('raf:birak', \{ yollar,/, 'yollar preload\'da çözülür, özel kanala gider');
  assert.ok(!/yolAl/.test(preload), 'ana dünyaya ham yol veren yolAl köprüsü kalmadı');
  const raf = yorumsuz(kaynakOku('src/renderer/ada/sayfalar/Raf.tsx'));
  assert.ok(!/yolAl|raf:ekle|raf:birak|yollar/.test(raf), 'sayfa yol dizisi oluşturmaz/göndermez ve ham kanalı çağırmaz');
  assert.match(raf, /window\.fuber\?\.rafBirak/, 'bırakılan File\'lar köprüye verilir');
  const api = yorumsuz(kaynakOku('src/renderer/api.ts'));
  assert.ok(!/yolAl/.test(api) && /rafBirak/.test(api));
  // Uydurma File (yolu çözülemez): preload hiçbir yol göndermez, yönetici eklemez
  const { y } = kur();
  assert.equal(y.ekle({ yollar: [] }).eklenen, 0);
});

test('I2: shell.openPath yalnız İZİN LİSTESİNDEKİ türlerde; listede olmayan her tür ve uzantısız dosya klasörde gösterilir; metin kartı panoya kopyalanır', async () => {
  const gosterilmeli = [
    'a1.exe', 'a2.bat', 'a3.cmd', 'a4.ps1', 'a5.lnk', 'a6.js', 'a7.vbs', 'a8.msi', 'a9.scr', 'b1.hta', 'b2.url', 'B3.EXE', 'b4.py', 'b5.jar', 'b6.reg',
    'c1.docm', 'c2.xlsm', 'c3.pptm', 'c4.appinstaller', 'c5.diagcab', 'c6.xll', 'c7.wsc', 'c8.iso', 'c9.vhdx', 'd1.rdp', 'd2.jnlp', 'd3.mdb', 'd4.searchConnector-ms', 'd5.msu', 'd6.psc1',
    'noext', 'LICENSE', 'd7.pdf.lnk', 'd8.txt.exe', 'd9.7z', 'e1.dll', 'e2.html', 'e3.htm', 'e4.xml', 'e5.xlsb', 'e6.svg', 'E7.SVG',
  ];
  const acilmali = ['f1.png', 'f2.JPG', 'f3.jpeg', 'f4.gif', 'f5.webp', 'f6.bmp', 'f7.heic', 'g1.pdf', 'G2.PDF', 'h1.txt', 'h2.md', 'h3.csv', 'h4.json', 'h5.log',
    'i1.docx', 'i2.xlsx', 'i3.pptx', 'i4.odt', 'i5.ods', 'i6.odp', 'i7.rtf', 'j1.mp3', 'j2.wav', 'j3.m4a', 'j4.flac', 'j5.ogg', 'j6.mp4', 'j7.mov', 'j8.mkv', 'j9.webm', 'k1.avi', 'l1.zip', 'L2.ZIP'];
  const { y, cagrilar } = kur();
  const idDe = (ad: string) => { const yol = dosyaYaz(ad); return y.ekle({ yollar: [yol] }).liste.find((o) => o.tur === 'dosya' && o.yol === path.resolve(yol))!.id; };
  // Raf 30 öğeyle sınırlı: her dosya eklenir eklenmez açılır, sonra kaldırılır.
  for (const ad of gosterilmeli) {
    const r = await y.ac(idDe(ad));
    assert.equal(r.eylem, 'gosterildi', `gösterilmeli ${ad}: ${r.mesaj}`);
    assert.match(r.mesaj, /Çalıştırılmadı/);
  }
  assert.deepEqual(cagrilar.ac, [], 'listede olmayan hiçbiri shell.openPath\'a gitmedi (.lnk, .docm, .appinstaller, uzantısız dahil)');
  assert.equal(cagrilar.goster.length, gosterilmeli.length, 'hepsi klasörde gösterildi');
  for (const ad of acilmali) assert.equal((await y.ac(idDe(ad))).eylem, 'acildi', `açılmalı: ${ad}`);
  assert.equal(cagrilar.ac.length, acilmali.length, 'izin listesindeki her tür açıldı');
  assert.equal(cagrilar.goster.length, gosterilmeli.length, 'açılanlar klasörde gösterilmedi');
  // saf işlev: büyük/küçük harf, sondaki nokta/boşluk, çift uzantı
  assert.ok(acilabilirMi('C:\\a\\Rapor.DOCX') && acilabilirMi('C:\\a\\x.Pdf') && acilabilirMi('C:\\a\\x.zip'));
  assert.ok(!acilabilirMi('C:\\a\\x.pdf.lnk') && !acilabilirMi('C:\\a\\x.exe. ') && !acilabilirMi('C:\\a\\notlar') && !acilabilirMi('C:\\a\\x.docm') && !acilabilirMi('C:\\a\\x.appinstaller') && !acilabilirMi('C:\\a\\x.lnk') && !acilabilirMi('C:\\a\\.pdf.exe'));
  // klasör (adı .exe ile bitse de) Gezgin'de açılır: içindekini çalıştırmaz
  const kl = path.join(gecici, 'bir-klasor.exe'); fs.mkdirSync(kl, { recursive: true });
  const klId = y.ekle({ yollar: [kl] }).liste.find((o) => o.tur === 'dosya' && o.ad === 'bir-klasor.exe')!.id;
  const oncekiAcilan = cagrilar.ac.length;
  assert.equal((await y.ac(klId)).eylem, 'acildi');
  assert.deepEqual(cagrilar.ac.at(-1), kl);
  assert.equal(cagrilar.ac.length, oncekiAcilan + 1);
  const klO = (await y.liste()).find((o) => o.id === klId);
  assert.equal(klO?.tur === 'dosya' && (klO as { klasor?: boolean }).klasor, true, 'liste klasör bayrağını taşır (simge sezgisi yok)');
  // metin
  const m = y.ekle({ metin: 'panoya gidecek' }).liste.find((o) => o.tur === 'metin')!;
  const mr = await y.ac(m.id);
  assert.equal(mr.eylem, 'kopyalandi');
  assert.deepEqual(cagrilar.kopyala, ['panoya gidecek']);
});

// ── Yol güvenliği: UNC/ağ, file: ve diğerleri ──────────────────────────────────────────────────────────────────────────────────────

test('UNC/ağ yolları, file: bağlantıları ve geçersiz yollar rafa girmez ve açılmaz', async () => {
  const a = dosyaYaz('guvenli.txt');
  const reddedilmeli = [
    '\\\\sunucu\\paylasim\\gizli.docx', '//sunucu/paylasim/gizli.docx', '\\\\?\\C:\\Windows\\win.ini', '\\\\?\\UNC\\sunucu\\p\\x', '\\\\.\\pipe\\x',
    'file:///C:/Windows/win.ini', 'FILE://sunucu/p/x', 'file:C:\\x', 'http://example.com/a.exe', 'https://example.com', 'ftp://x/y', 'javascript:alert(1)',
    'dosya.txt', '.\\dosya.txt', '..\\..\\Windows\\win.ini', 'C:dosya.txt', `${a}:gizli-akis`, 'C:\\a\\b\x00.txt', '', '   ', 5, null, undefined, {}, 'x'.repeat(2500),
  ];
  const { y, cagrilar } = kur();
  const r = y.ekle({ yollar: reddedilmeli });
  assert.equal(r.eklenen, 0, `hiçbiri eklenmedi: ${JSON.stringify(r.reddedilen.length)}`);
  assert.equal(r.liste.length, 0);
  assert.equal(r.reddedilen.length, reddedilmeli.length, 'her biri için neden döner');
  for (const k of reddedilmeli) assert.ok('hata' in rafYoluDogrula(k, () => null, true), `reddedilmeli (Windows kuralı): ${String(k).slice(0, 40)}`);
  assert.deepEqual(cagrilar.ac, []);
  // eşlenmiş ağ sürücüsü: sürücü harfli yolun GERÇEK yolu UNC ise reddedilir
  const esleme = rafYoluDogrula('Z:\\proje\\a.txt', (yol) => (yol.startsWith('Z:') ? '\\\\sunucu\\paylasim\\proje\\a.txt' : null), true);
  assert.ok('hata' in esleme, 'eşlenmiş ağ sürücüsü reddedilir');
  const esleme2 = rafYoluDogrula('Z:\\proje\\a.txt', () => '\\\\?\\UNC\\sunucu\\paylasim\\proje\\a.txt', true);
  assert.ok('hata' in esleme2, '\\\\?\\UNC\\ biçimi de reddedilir');
  const yerel = rafYoluDogrula('C:\\Kullanicilar\\Deniz\\a.txt', () => '\\\\?\\C:\\Kullanicilar\\Deniz\\a.txt', true);
  assert.ok('yol' in yerel && yerel.yol === 'C:\\Kullanicilar\\Deniz\\a.txt', '\\\\?\\C:\\ önekli yerel gerçek yol geçer');
  // kayıt dosyası elle bozulup UNC/file: eklenmişse AÇILMAZ, sürüklenmez
  const bozuk = [
    { id: 'u1', tur: 'dosya', yol: '\\\\sunucu\\paylasim\\x.docx', ad: 'x.docx', boyut: 1, eklendi: 'z' },
    { id: 'u2', tur: 'dosya', yol: 'file:///C:/Windows/win.ini', ad: 'win.ini', boyut: 1, eklendi: 'z' },
    { id: 'u3', tur: 'dosya', yol: 'rapor.docx', ad: 'rapor.docx', boyut: 1, eklendi: 'z' },
  ];
  const { y: y2, cagrilar: c2 } = kur(bozuk);
  const l2 = await y2.liste();
  assert.equal(l2.length, 3);
  for (const o of l2) assert.ok(o.tur === 'dosya' && o.eksik, 'geçersiz yol eksik görünür');
  for (const id of ['u1', 'u2', 'u3']) {
    const ac = await y2.ac(id);
    assert.equal(ac.tamam, false);
    assert.equal(y2.surukleYolu(id), null);
  }
  assert.deepEqual(c2.ac, []);
  assert.deepEqual(c2.goster, []);
});

// ── Ağ yok, bulut yok ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('P14: raf hiçbir şey yüklemez ve ağa çıkmaz; kayıt yerel userData/raf.json', async () => {
  const k = yorumsuz(kaynakOku('src/main/raf.ts')) + yorumsuz(kaynakOku('src/shared/raf.ts')) + yorumsuz(kaynakOku('src/renderer/ada/sayfalar/Raf.tsx'));
  assert.ok(!/\bfetch\(|net\.fetch|XMLHttpRequest|WebSocket|https?:\/\/|sohbet:gonder|upload|yukle/i.test(k), 'ağ/yükleme/sohbet eki çağrısı yok');
  const a = dosyaYaz('kayit.txt');
  const r = await ipc<{ eklenen: number }>('raf:birak', { yollar: [a] });
  assert.equal(r.eklenen, 1);
  const kayit = JSON.parse(fs.readFileSync(path.join(sahneKlasoru, 'raf.json'), 'utf8')) as { surum: number; ogeler: RafOgesi[] };
  assert.equal(kayit.surum, 1);
  assert.ok(kayit.ogeler.some((o) => o.tur === 'dosya' && o.yol === path.resolve(a)));
  assert.ok(kayit.ogeler.every((o) => !('eksik' in o)), '"eksik" diske yazılmaz');
});

// ── Sürüklerken yakalama (R21) ─────────────────────────────────────────────────────────────────────────────────────────────────────────

test('sürüklerken buttons === 1 fare hareketi şekle girince ada:fare(true) gider; düğmesiz hareket yakalamaz', () => {
  assert.equal(surukluyorMu(1), true);
  for (const b of [0, undefined, 2, 3, 4, 5]) assert.equal(surukluyorMu(b), false, `buttons=${b} sürükleme değil`);
  const gonderilen: [string, boolean][] = [];
  const fare = (ustunde: boolean) => { gonderilen.push(['ada:fare', ustunde]); };
  assert.equal(surukleFareGonder(1, fare), true);
  assert.deepEqual(gonderilen, [['ada:fare', true]], 'buttons === 1: yakalama açıldı');
  gonderilen.length = 0;
  for (const b of [0, undefined, 2]) assert.equal(surukleFareGonder(b, fare), false);
  assert.deepEqual(gonderilen, [], 'düğmesiz hareket (üstünden geçen imleç) yakalamayı açmaz');
  // kablolama: şeklin fare hareketi bu işleve gider; gerçek `fare` ada:fare yazar
  const ada = kaynakOku('src/renderer/ada/Ada.tsx');
  assert.match(ada, /onMouseMove=\{\(e\) => a\.surukleHareketi\(e\.buttons\)\}/, 'şeklin onMouseMove\'u buttons\'ı iletir');
  const asistan = yorumsuz(kaynakOku('src/renderer/ada/useAsistan.ts'));
  assert.match(asistan, /surukleFareGonder\(buttons, fare\)/, 'useAsistan sürükleme kararını surukleFareGonder\'a bırakır');
  assert.match(asistan, /void cagir\('ada:fare', ustunde\)/, 'fare(true) ana sürece ada:fare yazar');
  assert.match(asistan, /acikSayfalar\(sayfaAyari\)\.includes\('raf'\) && sayfa !== 'raf'\) \{ surukleOncesi\.current \?\?= sayfa; setSayfa\('raf'\); \}/, 'panel Raf açıksa Raf sayfasıyla açılır, önceki sayfa saklanır');
  assert.match(asistan, /surukleSayfasiniBirak\(\);\s*setPanelAcik\(false\)/, 'panel kapanınca önceki sayfa geri gelir');
  assert.match(asistan, /if \(icerdeBasili\.current\) return;/, 'içeride basılı düğme (yazı seçimi) sürükleme sayılmaz');
});

test('I3: sürükleme yüzünden açılan yakalama OLAYLA düşer: şeklin dışında dragover, drop, dragend ve pencereden çıkan dragleave; şekil içindeki olaylar bırakmaz; zamanlayıcı yok', () => {
  const o = (tur: 'dragover' | 'dragleave' | 'drop' | 'dragend', sekildeMi: boolean, iliskiliHedefVar = false) => surukleYakalamayiBirakMi({ tur, sekildeMi, iliskiliHedefVar });
  assert.equal(o('dragover', false), true, 'şeklin dışında dragover: kutunun boş yeri bırakma hedefi olmasın');
  assert.equal(o('dragover', true), false, 'şeklin üstünde dragover: yakalama sürer');
  assert.equal(o('drop', true), true, 'drop: sürükleme bitti');
  assert.equal(o('drop', false), true);
  assert.equal(o('dragend', true), true, 'dragend: sürükleme bitti');
  assert.equal(o('dragleave', false, false), true, 'şeklin dışında, ilişkili hedefi olmayan dragleave = pencereden çıkış');
  assert.equal(o('dragleave', true, false), false, 'şekil içinde (çocuklar arası geçiş) ilişkili hedef boş gelse de bırakılmaz');
  assert.equal(o('dragleave', false, true), false, 'ilişkili hedefi olan dragleave pencereden çıkış değil');
  // kablolama
  const asistan = yorumsuz(kaynakOku('src/renderer/ada/useAsistan.ts'));
  assert.match(asistan, /for \(const \[t, f\] of surukleDinleyicileri\) document\.addEventListener\(t, f as EventListener\)/, 'belge düzeyinde dinleyiciler');
  assert.match(asistan, /\['dragover', 'dragleave', 'drop', 'dragend'\]/, 'dört olay');
  assert.match(asistan, /if \(!surukleYakalama\.current \|\| !surukleYakalamayiBirakMi\(o\)\) return;\s*surukleYakalama\.current = false;\s*fare\(false\);/, 'yakalama bırakılınca fare(false) (panel hover\'la açıldıysa onu da kapatır)');
  assert.match(asistan, /if \(uzerinde\.current\) surukleYakalama\.current = true;/, 'düğmesi dışarıda basılmış hareketin yakalaması sürüklemeye aittir (mouseenter önce açmış olsa da)');
  assert.match(asistan, /if \(!ustunde\) surukleYakalama\.current = false;/, 'imleç çıkınca bayrak düşer');
  // sürükleme kodunda yeni zamanlayıcı yok
  const parca = asistan.slice(asistan.indexOf('const surukleBirak'), asistan.indexOf('const icerdeBasildi'));
  assert.ok(parca.length > 100 && !/setTimeout|setInterval|requestAnimationFrame/.test(parca), 'surukleBirak zamanlayıcısız');
  const belgeParca = asistan.slice(asistan.indexOf('const sekilde = '), asistan.indexOf('const surukleDinleyicileri') + 400);
  assert.ok(!/setTimeout|setInterval|requestAnimationFrame/.test(belgeParca), 'belge düzeyi dinleyiciler zamanlayıcısız');
});

// ── Sayfa ve kayıt ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('sayfa kaynak kuralları: metinler, kayıt satırı, kimlikle eylem, yoklama/çizim döngüsü yok, karakter yok, rafBirak köprüsü', () => {
  const raf = kaynakOku('src/renderer/ada/sayfalar/Raf.tsx');
  const k = yorumsuz(raf);
  assert.match(raf, /Dosyaları buraya bırak/);
  assert.match(raf, /Bırak, ekleyeyim/);
  assert.match(raf, /Dosya yerinde yok|DOSYA_YOK_METNI/);
  assert.ok(!/setInterval|requestAnimationFrame/.test(k), 'çizim/yoklama döngüsü yok');
  assert.ok(!/<svg|ui\/goz|<Gozler|svg\.gozler/.test(k), 'Raf\'ta göz yok (Sade modda da)');
  assert.match(k, /cagir<AcSonucu>\('raf:ac', o\.id\)/, 'açma ana sürece KİMLİKLE gider');
  assert.match(k, /cagir\('raf:surukle', o\.id\)/, 'sürükleme KİMLİKLE istenir');
  assert.ok(!/cagir[^;]*'raf:(ac|surukle)', [a-z.]*yol/.test(k), 'açma/sürükleme çağrısına yol verilmez');
  assert.match(k, /window\.fuber\?\.rafBirak/, 'bırakılan File\'lar preload\'un rafBirak köprüsüne');
  assert.ok(!/\.path\b/.test(k.replace(/o\.yol/g, '')), 'File.path kullanılmaz (Electron 32+ kaldırdı)');
  const panel = kaynakOku('src/renderer/ada/Panel.tsx');
  assert.match(panel, /sayfaKaydet\('raf', Raf\);/, 'Panel\'de tek satır kayıt');
  const preload = kaynakOku('src/preload/preload.ts');
  assert.match(preload, /webUtils\.getPathForFile/);
  const css = kaynakOku('src/renderer/ada/panel.css');
  const rafCss = css.slice(css.indexOf('0.14 T27: Raf'));
  assert.ok(rafCss.length > 500);
  assert.ok(!/@keyframes/.test(rafCss) && !/infinite/.test(rafCss), 'Raf CSS\'inde sürekli animasyon yok');
  for (const m of rafCss.matchAll(/transition:\s*([^;]+);/g)) for (const p of m[1].split(',')) assert.match(p.trim(), /^(?:transform|opacity|none)\b/, `geçiş yalnız transform/opacity: ${p}`);
  assert.ok(!/transition:[^;]*\b(width|height|top|left|right|margin|padding)\b/.test(rafCss), 'yerleşim özelliği canlandırılmaz');
});

// ── 0.14 T35: T27'den ertelenen Minor'lar ───────────────────────────────────────────────────────────────────────────────────────────────

test('T35 (T27 Minor 3): bağlantı/kavşak hedefi ağdaysa gerçek yol çözülemese de reddedilir — lstat zinciri realpath\'ten ÖNCE bakılır', () => {
  const agHedefli = (y: string): string[] => (y.startsWith('C:\\Raf\\bag') ? ['\\\\sunucu\\paylasim\\proje'] : []);
  const cozulmez = () => null; // ağ hedefine ulaşılamadı: realpath düşer
  const r = rafYoluDogrula('C:\\Raf\\bag\\a.docx', cozulmez, true, agHedefli);
  assert.ok('hata' in r && /Ağ yolları/.test(r.hata), 'ağ hedefli bağlantı reddedilir');
  assert.ok('hata' in rafYoluDogrula('C:\\Raf\\bag\\a.docx', cozulmez, true, () => ['\\\\?\\UNC\\sunucu\\p']), '\\\\?\\UNC\\ hedefli bağlantı');
  // Gerçek yol çözücü ağ hedefli bağlantıda HİÇ çağrılmaz (dışarıya bağlantı denemesi yok).
  let cagrildi = 0;
  rafYoluDogrula('C:\\Raf\\bag\\a.docx', () => { cagrildi++; return null; }, true, agHedefli);
  assert.equal(cagrildi, 0, 'ağ hedefli bağlantıda realpath denenmez');
  // Yerel hedefli bağlantı ve bağlantısız yol geçer.
  assert.ok('yol' in rafYoluDogrula('C:\\Raf\\yerel\\a.docx', cozulmez, true, () => ['D:\\Arsiv']), 'yerel hedefli bağlantı geçer');
  assert.ok('yol' in rafYoluDogrula('C:\\Raf\\a.docx', cozulmez, true, () => []), 'bağlantısız yol geçer');
});

test('T35 (T27 Minor 7 + çift durum): liste() fs.promises ile, öğeler paralel; her dosya için durum bir kez', async () => {
  const a = dosyaYaz('paralel-a.txt'), b = dosyaYaz('paralel-b.txt');
  let durumSayisi = 0, esZamanli = 0, enCok = 0;
  let i = 0;
  const y = rafYoneticisiKur({
    oku: () => undefined, yaz: () => undefined,
    durum: (yol) => { try { const s = fs.statSync(yol); return { klasor: s.isDirectory(), boyut: s.size }; } catch { return null; } },
    gercekYol: (yol) => { try { return fs.realpathSync.native(yol); } catch { return null; } },
    durumP: async (yol) => {
      durumSayisi++; esZamanli++; enCok = Math.max(enCok, esZamanli);
      await new Promise((r) => setTimeout(r, 20));
      esZamanli--;
      try { const s = await fs.promises.stat(yol); return { klasor: s.isDirectory(), boyut: s.size }; } catch { return null; }
    },
    gercekYolP: async (yol) => { try { return await fs.promises.realpath(yol); } catch { return null; } },
    ac: async () => '', goster: () => undefined, kopyala: () => undefined, simdi: () => new Date(), kimlik: () => `p${++i}`,
  });
  y.ekle({ yollar: [a, b] });
  const l = await y.liste();
  assert.equal(l.length, 2);
  assert.ok(l.every((o) => o.tur === 'dosya' && !o.eksik));
  assert.equal(durumSayisi, 2, 'her dosya için durum bir kez (eksik ve klasör bayrağı aynı okumadan)');
  assert.equal(enCok, 2, 'öğeler paralel yoklanır (ana iş parçacığı sırayla beklemez)');
  // kaynak: gerçek bağlayıcı fs.promises kullanır
  const k = yorumsuz(kaynakOku('src/main/raf.ts'));
  assert.match(k, /durumP:\s*async[^\n]*fs\.promises\.stat/, 'gerçek bağlayıcı fs.promises.stat');
  assert.match(k, /gercekYolP:\s*async[^\n]*fs\.promises\.realpath/, 'gerçek bağlayıcı fs.promises.realpath');
});

test('T35 (T27): .svg ve .html aynı kurala uyar — betik taşıyabilen ikisi de açılmaz, klasörde gösterilir', () => {
  for (const ad of ['a.svg', 'a.SVG', 'a.svgz', 'a.html', 'a.htm', 'a.xhtml']) assert.equal(acilabilirMi(`C:\\Raf\\${ad}`), false, ad);
});

test('T35 (T27): sürükleme simgesi önbellek anahtarı uzantıdan — uzantısız dosya ve klasör kendi anahtarını alır', async () => {
  const { surukleSimgeAnahtari } = await import('../src/main/raf.ts');
  assert.equal(surukleSimgeAnahtari('C:\\Raf\\Rapor.PDF', false), '.pdf');
  assert.equal(surukleSimgeAnahtari('C:\\Raf\\LICENSE', false), 'uzantisiz');
  assert.equal(surukleSimgeAnahtari('C:\\Raf\\v1.2', true), 'klasor', 'noktalı klasör adı uzantı sayılmaz');
  assert.equal(surukleSimgeAnahtari('C:\\Raf.d\\notlar', false), 'uzantisiz', 'yolun üst klasöründeki nokta anahtar olmaz');
  const ada = yorumsuz(kaynakOku('src/main/ada.ts'));
  assert.match(ada, /surukleSimgeAnahtari\(/, 'adaSurukle anahtarı yardımcıdan alır');
  assert.doesNotMatch(ada, /lastIndexOf\('\.'\)/, 'eski anahtar (lastIndexOf) kalmadı');
});

test('T35 (T27): raf:test yalnız paketsiz test kipinde ve göndereni denetleyen hr yardımcısıyla kayıtlı', () => {
  const k = yorumsuz(kaynakOku('src/main/ipc.ts'));
  assert.doesNotMatch(k, /\bh\('raf:test'/, 'raf:test genel h ile kayıtlı (gönderen denetimi yok)');
  assert.match(k, /if \(!app\.isPackaged\) hr\('raf:test'/, 'raf:test paketli uygulamada kayıtlı olmamalı');
  assert.ok(ipcIsleyicileri().has('raf:test'), 'paketsiz FUBER_DEMO\'da kayıtlı');
});
