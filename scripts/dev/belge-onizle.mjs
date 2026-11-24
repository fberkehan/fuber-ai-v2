// Belge üretimi önizlemesi (0.14 T17, R7): GERÇEK Electron'da (arka planda, görünür pencere YOK) dört belge türünü üretir —
// docx, xlsx, pptx ve pdf (`webContents.printToPDF`: gizli pencere, kalıcı olmayan bölüm, JavaScript kapalı). Ardından dışarıdan doğrular:
// PDF'in ilk baytları `%PDF`, Türkçe karakterler metin katmanında DOĞRU (pdf-parse) ve görüntüde okunur (sayfa 1'in PNG'si çıktıya yazılır;
// gözle bakılır), kötü niyetli metin (<script>) düz metin olarak basılır, uzun belge birden çok sayfa olur; docx/xlsx/pptx geri okunur.
// Ağ yok, gerçek fare/klavye yok. userData geçici klasörde (kurulu Fuber AI ve %APPDATA%\Fuber AI'a dokunulmaz); çıktı geçici klasöre yazılır.
// Çalıştır: node scripts/dev/belge-onizle.mjs [çıktı-klasörü]     Çıktı: <çıktı>/*.{docx,xlsx,pptx,pdf} + pdf-sayfa1.png + sonuc.json
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import electronYolu from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import mammoth from 'mammoth';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { PDFParse } from 'pdf-parse';

const kok = path.resolve(import.meta.dirname, '../..');
const cikti = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'fuber-belge-onizle'));
if (cikti.toLowerCase().startsWith(path.resolve(os.tmpdir()).toLowerCase() + path.sep)) fs.rmSync(cikti, { recursive: true, force: true });
fs.mkdirSync(cikti, { recursive: true });

const sonuclar = [];
const kontrol = (ad, tamam, ayrinti = '') => {
  sonuclar.push({ ad, tamam: Boolean(tamam), ayrinti: String(ayrinti ?? '').slice(0, 600) });
  console.log(`${tamam ? '✅' : '❌'} ${ad}${ayrinti && !tamam ? ` — ${String(ayrinti).slice(0, 400)}` : ''}`);
};

// 1) belge-uret.ts'i paketle (paketler dışta: dist/ altında, kök node_modules'ten çözülür; dist git'e girmez).
const paketKlasoru = path.join(kok, 'dist', 'belge-onizle');
fs.mkdirSync(paketKlasoru, { recursive: true });
const paket = path.join(paketKlasoru, 'belge-uret.mjs');
await build({ entryPoints: [path.join(kok, 'src/main/belge-uret.ts')], outfile: paket, bundle: true, platform: 'node', format: 'esm', target: 'node24', packages: 'external', logLevel: 'warning' });

// 2) Electron ana betiği: istekleri üretir, sonucu yazar, çıkar.
const ana = path.join(paketKlasoru, 'ana.cjs');
fs.writeFileSync(ana, `const { app } = require('electron');
const { pathToFileURL } = require('node:url');
app.disableHardwareAcceleration();
app.on('window-all-closed', () => { /* gizli PDF penceresi kapanınca uygulama çıkmasın (main.ts'teki gibi) */ });
app.whenReady().then(async () => {
  try {
    const m = await import(pathToFileURL(process.env.FUBER_BELGE_PAKET).href);
    const sonuc = [];
    for (const { istek, hedef } of JSON.parse(process.env.FUBER_BELGE_ISTEK)) sonuc.push(await m.belgeUret(istek, hedef));
    process.stdout.write('SONUC ' + JSON.stringify(sonuc) + '\\n');
    app.exit(0);
  } catch (e) { process.stderr.write('HATA ' + ((e && e.stack) || e) + '\\n'); app.exit(1); }
});
`);

const TR = 'ĞÜŞİÖÇ ığüşöç — Çalışkan öğrenci şiir okudu: “İstanbul’da güneşli bir gün”';
const uzunBolumler = Array.from({ length: 40 }, (_, i) => ({ baslik: `Bölüm ${i + 1}: Üretim şeması`, paragraflar: [`Paragraf ${i + 1}. ${TR}. `.repeat(6)] }));
const istekler = [
  { istek: { tur: 'pdf', yol: 'turkce.pdf', icerik: { baslik: 'Türkçe Karakter Sınaması', bolumler: [
    { baslik: 'Harfler', paragraflar: [TR, 'ABCÇDEFGĞHIİJKLMNOÖPRSŞTUÜVYZ abcçdefgğhıijklmnoöprsştuüvyz 0123456789'] },
    { baslik: 'Tablo', tablo: [['Ürün', 'Adet', 'Tutar (₺)'], ['Çay', '3', '12,50'], ['Şeker', '10', '40,00'], ['Ağaç', '1', '99,99']] },
  ] } }, hedef: path.join(cikti, 'turkce.pdf') },
  { istek: { tur: 'pdf', yol: 'kotu.pdf', icerik: { baslik: '<script>document.body.innerHTML="HACK"</script>', bolumler: [
    { baslik: '<img src="http://127.0.0.1:9/x.png" onerror="document.title=1">', paragraflar: ['<b>kalın değil</b> & "tırnak" \'tek\''] },
  ] } }, hedef: path.join(cikti, 'kotu.pdf') },
  { istek: { tur: 'pdf', yol: 'uzun.pdf', icerik: { baslik: 'Uzun Belge', bolumler: uzunBolumler } }, hedef: path.join(cikti, 'uzun.pdf') },
  { istek: { tur: 'docx', yol: 'rapor.docx', icerik: { baslik: 'Rapor — Çeyrek', bolumler: [{ baslik: 'Özet', paragraflar: [TR] }, { baslik: 'Rakamlar', tablo: [['Ürün', 'Adet'], ['Çay', '3']] }] } }, hedef: path.join(cikti, 'rapor.docx') },
  { istek: { tur: 'xlsx', yol: 'tablo.xlsx', icerik: { sayfalar: [{ ad: 'Satışlar', satirlar: [['Ürün', 'Adet', 'Tutar'], ['Çay', 3, 12.5], ['Şeker', 10, 40]] }] } }, hedef: path.join(cikti, 'tablo.xlsx') },
  { istek: { tur: 'pptx', yol: 'sunum.pptx', icerik: { slaytlar: [{ baslik: 'Hoş Geldiniz', maddeler: ['Birinci madde', TR] }, { baslik: 'Kapanış', maddeler: ['Teşekkürler'] }] } }, hedef: path.join(cikti, 'sunum.pptx') },
];

// 3) Electron'u arka planda koştur (gizli pencere; userData geçici).
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-belge-electron-'));
const env = { ...process.env, FUBER_BELGE_PAKET: paket, FUBER_BELGE_ISTEK: JSON.stringify(istekler), FUBER_DEMO: '1' };
delete env.ELECTRON_RUN_AS_NODE;
for (const k of Object.keys(env)) if (/^FUBER_SIR_/.test(k)) delete env[k];
const cocuk = spawn(electronYolu, [ana, `--user-data-dir=${userData}`, '--disable-gpu'], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let cikis = '', hata = '';
cocuk.stdout.on('data', (d) => { cikis += d; });
cocuk.stderr.on('data', (d) => { hata += d; });
const kod = await new Promise((coz) => {
  const zaman = setTimeout(() => { cocuk.kill(); coz(-1); }, 120_000);
  cocuk.on('exit', (c) => { clearTimeout(zaman); coz(c); });
});
fs.rmSync(userData, { recursive: true, force: true });
kontrol('Electron üretimi bitti (çıkış kodu 0)', kod === 0, `${kod} ${hata.split('\n').find((s) => s.startsWith('HATA')) ?? hata.slice(0, 300)}`);
if (kod !== 0) { fs.writeFileSync(path.join(cikti, 'sonuc.json'), JSON.stringify(sonuclar, null, 2)); process.exit(1); }
kontrol('çıktıda SONUC satırı var', /SONUC \[/.test(cikis), cikis.slice(0, 200));

// 4) Dışarıdan doğrulama.
const oku = (ad) => fs.readFileSync(path.join(cikti, ad));
const pdfMetni = async (ad) => { const p = new PDFParse({ data: oku(ad) }); try { const r = await p.getText(); return { metin: r.text, sayfa: r.total ?? r.pages?.length ?? 0 }; } finally { await p.destroy(); } };

for (const ad of ['turkce.pdf', 'kotu.pdf', 'uzun.pdf']) kontrol(`${ad}: ilk baytlar %PDF`, oku(ad).subarray(0, 4).toString('latin1') === '%PDF' && oku(ad).length > 1000, oku(ad).length);

const tr = await pdfMetni('turkce.pdf');
const trMetni = tr.metin.replace(/\s+/g, ' ');
for (const parca of ['ĞÜŞİÖÇ', 'ığüşöç', 'Çalışkan öğrenci şiir okudu', 'İstanbul’da güneşli', 'Türkçe Karakter Sınaması', 'Tutar (₺)', 'Ağaç', '99,99']) {
  kontrol(`turkce.pdf metin katmanında "${parca}"`, trMetni.includes(parca), trMetni.slice(0, 300));
}
{ // Görüntü: sayfa 1'i PNG'ye çiz (gözle okunur mu: çıktı klasöründeki pdf-sayfa1.png).
  const p = new PDFParse({ data: oku('turkce.pdf') });
  try {
    const r = await p.getScreenshot({ first: 1, scale: 1.6, imageBuffer: true, imageDataUrl: false });
    fs.writeFileSync(path.join(cikti, 'pdf-sayfa1.png'), Buffer.from(r.pages[0].data));
    kontrol('turkce.pdf sayfa 1 görüntüsü yazıldı (pdf-sayfa1.png)', r.pages[0].data.length > 5000, r.pages[0].data.length);
  } finally { await p.destroy(); }
}

const kotu = (await pdfMetni('kotu.pdf')).metin.replace(/\s+/g, ' ');
// Uzun başlık PDF'te satıra sarılır: boşluksuz karşılaştırılır.
kontrol('kotu.pdf: <script> düz metin olarak basıldı', kotu.replace(/\s/g, '').includes('<script>document.body.innerHTML="HACK"</script>'), kotu.slice(0, 300));
kontrol('kotu.pdf: <img> etiketi düz metin, betik çalışmadı', kotu.includes('<img src="http://127.0.0.1:9/x.png"') && !/(^|\s)HACK(\s|$)/.test(kotu), kotu.slice(0, 300));
kontrol('kotu.pdf: <b> kalın etiketi yorumlanmadı (metin olarak var)', kotu.includes('<b>kalın değil</b>'), kotu.slice(0, 300));

const uzun = await pdfMetni('uzun.pdf');
kontrol('uzun.pdf birden çok sayfa', uzun.sayfa > 3, uzun.sayfa);
kontrol('uzun.pdf son bölüm var', uzun.metin.includes('Bölüm 40: Üretim şeması'), uzun.metin.slice(-200));

const dm = (await mammoth.extractRawText({ buffer: oku('rapor.docx') })).value;
kontrol('rapor.docx (Electron içinde üretildi): başlık, Türkçe ve tablo', dm.includes('Rapor — Çeyrek') && dm.includes('ĞÜŞİÖÇ') && dm.includes('Çay'), dm.slice(0, 200));
const wb = new ExcelJS.Workbook();
await wb.xlsx.load(oku('tablo.xlsx'));
const sy = wb.getWorksheet('Satışlar');
kontrol('tablo.xlsx: 3 sütun 3 satır, sayı sayı', sy && sy.columnCount === 3 && sy.rowCount === 3 && sy.getCell('B2').value === 3 && sy.getCell('C2').value === 12.5, sy && `${sy.columnCount}x${sy.rowCount}`);
const zip = await JSZip.loadAsync(oku('sunum.pptx'));
const s1 = await zip.file('ppt/slides/slide1.xml')?.async('string');
kontrol('sunum.pptx: slide1.xml başlık ve Türkçe madde taşır', Boolean(s1?.includes('Hoş Geldiniz') && s1.includes('ĞÜŞİÖÇ')), s1?.slice(0, 200));

fs.writeFileSync(path.join(cikti, 'sonuc.json'), JSON.stringify(sonuclar, null, 2));
fs.rmSync(paketKlasoru, { recursive: true, force: true });
const kotuSayisi = sonuclar.filter((s) => !s.tamam).length;
console.log(`\n${sonuclar.length - kotuSayisi}/${sonuclar.length} kontrol geçti. Çıktı: ${cikti}`);
console.log(`PNG: ${pathToFileURL(path.join(cikti, 'pdf-sayfa1.png')).href}`);
process.exit(kotuSayisi ? 1 : 0);
