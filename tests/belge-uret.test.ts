// 0.14 T17 (R7): belge üretimi — docx (docx), xlsx (exceljs), pptx (pptxgenjs), pdf (Electron printToPDF; burada yazıcı sahte, gerçeği
// scripts/dev/belge-onizle.mjs Electron'da koşar). Üretilen dosyalar BAŞKA bir okuyucuyla geri okunur (mammoth, exceljs, zip). Yalnız geçici klasör.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import mammoth from 'mammoth';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { belgeIstegiDogrula, belgeIstegiHatasi, belgeOzetiMetni, BELGE_SINIR, type BelgeIstegi } from '../src/shared/belge-sema.ts';
import { belgeUret, belgeHtml } from '../src/main/belge-uret.ts';

const klasor = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-belge-'));
test.after(() => fs.rmSync(klasor, { recursive: true, force: true }));
const yol = (ad: string) => path.join(klasor, ad);

const METIN: BelgeIstegi = {
  tur: 'docx', yol: 'x.docx',
  icerik: {
    baslik: 'Çeyrek Raporu ĞÜŞİÖÇ',
    bolumler: [
      { baslik: 'Özet', paragraflar: ['Gelir bu çeyrekte arttı.', 'İkinci paragraf: ığüşöç'] },
      { baslik: 'Rakamlar', tablo: [['Ürün', 'Adet', 'Tutar'], ['Çay', '3', '12,5'], ['Şeker', '10', '40']] },
    ],
  },
};
const TABLO: BelgeIstegi = {
  tur: 'xlsx', yol: 'x.xlsx',
  icerik: { sayfalar: [{ ad: 'Satışlar', satirlar: [['Ürün', 'Adet', 'Tutar'], ['A', 1, 10.5], ['B', 2, 20], ['C', 3, 30], ['D', 4, 40]] }] },
};
const SUNUM: BelgeIstegi = {
  tur: 'pptx', yol: 'x.pptx',
  icerik: { slaytlar: [{ baslik: 'Hoş Geldiniz', maddeler: ['Birinci madde', 'İkinci madde'] }, { baslik: 'Kapanış', maddeler: ['Teşekkürler'] }] },
};

test('belge: docx mammoth ile okununca başlık ve tablo metni var', async () => {
  const s = await belgeUret(METIN, yol('rapor.docx'));
  assert.equal(s.yol, yol('rapor.docx'));
  assert.ok(s.boyut > 1000 && s.boyut === fs.statSync(s.yol).size);
  const metin = (await mammoth.extractRawText({ path: s.yol })).value;
  assert.match(metin, /Çeyrek Raporu ĞÜŞİÖÇ/);
  assert.match(metin, /Özet/);
  assert.match(metin, /İkinci paragraf: ığüşöç/);
  for (const h of ['Ürün', 'Adet', 'Tutar', 'Çay', '12,5', 'Şeker', '40']) assert.ok(metin.includes(h), `tablo hücresi yok: ${h}`);
  // Gerçek tablo: HTML'e çevrilince <table> çıkar.
  assert.match((await mammoth.convertToHtml({ path: s.yol })).value, /<table>/);
});

test('belge: xlsx exceljs ile okununca 3 sütun 5 satır; sayılar sayı olarak kalır', async () => {
  const s = await belgeUret(TABLO, yol('satis.xlsx'));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(s.yol);
  const sayfa = wb.getWorksheet('Satışlar');
  assert.ok(sayfa, 'sayfa adı korunur');
  assert.equal(sayfa.rowCount, 5);
  assert.equal(sayfa.columnCount, 3);
  assert.equal(sayfa.getCell('A1').value, 'Ürün');
  assert.equal(sayfa.getCell('B2').value, 1);
  assert.equal(typeof sayfa.getCell('C2').value, 'number');
  assert.equal(sayfa.getCell('C2').value, 10.5);
});

test('belge: xlsx sayfa adı temizlenir (31 karakter, yasak karakter, yinelenen ad)', async () => {
  const i: BelgeIstegi = { tur: 'xlsx', yol: 'a.xlsx', icerik: { sayfalar: [
    { ad: 'Rapor/2026: [Q1]?*', satirlar: [['a']] }, { ad: 'Rapor/2026: [Q1]?*', satirlar: [['b']] }, { ad: 'u'.repeat(60), satirlar: [['c']] },
  ] } };
  const s = await belgeUret(i, yol('adlar.xlsx'));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(s.yol);
  const adlar = wb.worksheets.map((w) => w.name);
  assert.equal(adlar.length, 3);
  assert.equal(new Set(adlar.map((a) => a.toLowerCase())).size, 3, adlar.join('|'));
  for (const a of adlar) { assert.ok(a.length > 0 && a.length <= 31, a); assert.doesNotMatch(a, /[\\/?*[\]:]/, a); }
});

test('belge: xlsx "=" ile başlayan metin formül olarak yazılmaz (metin kalır, değiştirilmez)', async () => {
  const i: BelgeIstegi = { tur: 'xlsx', yol: 'f.xlsx', icerik: { sayfalar: [{ ad: 'F', satirlar: [['=HYPERLINK("http://x","t")', '+1+1', '@SUM(A1)', 'düz', -5]] }] } };
  const s = await belgeUret(i, yol('formul.xlsx'));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(s.yol);
  const sayfa = wb.getWorksheet('F')!;
  assert.equal(sayfa.getCell('A1').value, '=HYPERLINK("http://x","t")');
  assert.equal(typeof sayfa.getCell('A1').value, 'string', 'formül nesnesi olmamalı');
  assert.equal(sayfa.getCell('B1').value, '+1+1');
  assert.equal(sayfa.getCell('C1').value, '@SUM(A1)');
  assert.equal(sayfa.getCell('D1').value, 'düz');
  assert.equal(sayfa.getCell('E1').value, -5);
  // Dosyanın XML'inde <f> (formül) öğesi yok.
  const zip = await JSZip.loadAsync(fs.readFileSync(s.yol));
  assert.doesNotMatch(await zip.file('xl/worksheets/sheet1.xml')!.async('string'), /<f[ >]/);
});

test('belge: xlsx sayı gibi görünen metin ("12.5") sayı olarak yazılır; sıfırla başlayan, virgüllü, üstel ve uzun değerler metin kalır', async () => {
  const i: BelgeIstegi = { tur: 'xlsx', yol: 's.xlsx', icerik: { sayfalar: [{ ad: 'S', satirlar: [['12.5', '-3', '0', '42', '007', '05000000001', '12,5', '1e5', '0x10', ' 5', '1234567890123456789', '+7', 'Çay', '']] }] } };
  const d = belgeIstegiDogrula(i)!;
  assert.deepEqual((d.icerik as { sayfalar: { satirlar: unknown[][] }[] }).sayfalar[0].satirlar[0],
    [12.5, -3, 0, 42, '007', '05000000001', '12,5', '1e5', '0x10', ' 5', '1234567890123456789', '+7', 'Çay', '']);
  const s = await belgeUret(i, yol('sayilar.xlsx'));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(s.yol);
  const sayfa = wb.getWorksheet('S')!;
  assert.equal(sayfa.getCell('A1').value, 12.5);
  assert.equal(typeof sayfa.getCell('A1').value, 'number');
  assert.equal(sayfa.getCell('C1').value, 0);
  assert.equal(sayfa.getCell('E1').value, '007');
  assert.equal(sayfa.getCell('F1').value, '05000000001');
  // docx tablosunda sayı gibi metin metin kalır.
  const m = belgeIstegiDogrula({ tur: 'docx', yol: 'a.docx', icerik: { bolumler: [{ tablo: [['12.5']] }] } })!;
  assert.deepEqual((m.icerik as { bolumler: { tablo: unknown[][] }[] }).bolumler[0].tablo, [['12.5']]);
});

test("belge: pptx zip'inde ppt/slides/slide1.xml başlığı taşır; iki slayt", async () => {
  const s = await belgeUret(SUNUM, yol('sunum.pptx'));
  const zip = await JSZip.loadAsync(fs.readFileSync(s.yol));
  const adlar = Object.keys(zip.files).filter((a) => /^ppt\/slides\/slide\d+\.xml$/.test(a)).sort();
  assert.deepEqual(adlar, ['ppt/slides/slide1.xml', 'ppt/slides/slide2.xml']);
  const bir = await zip.file('ppt/slides/slide1.xml')!.async('string');
  assert.ok(bir.includes('Hoş Geldiniz'), 'başlık slayt 1\'de');
  assert.ok(bir.includes('Birinci madde') && bir.includes('İkinci madde'));
  assert.ok((await zip.file('ppt/slides/slide2.xml')!.async('string')).includes('Teşekkürler'));
});

test('belge: pdf — HTML kurulur, yazıcıya verilir, çıktı yazılır (yazıcı sahte; gerçeği belge-onizle.mjs)', async () => {
  let gelenHtml = '';
  const sahte = async (html: string) => { gelenHtml = html; return Buffer.from('%PDF-1.4\n% sahte\n'); };
  const s = await belgeUret({ ...METIN, tur: 'pdf', yol: 'r.pdf' }, yol('r.pdf'), { pdfYazici: sahte });
  assert.equal(fs.readFileSync(s.yol).subarray(0, 4).toString(), '%PDF');
  assert.equal(gelenHtml, belgeHtml({ ...METIN, tur: 'pdf', yol: 'r.pdf' }));
  assert.match(gelenHtml, /Çeyrek Raporu ĞÜŞİÖÇ/);
});

test('belge: pdf yazıcı boş ya da %PDF olmayan çıktı verirse hata (dosya yazılmaz)', async () => {
  const hedef = yol('bos.pdf');
  await assert.rejects(belgeUret({ ...METIN, tur: 'pdf', yol: 'b.pdf' }, hedef, { pdfYazici: async () => Buffer.from('merhaba') }), /PDF/);
  assert.equal(fs.existsSync(hedef), false);
});

test('belgeHtml metni kaçışlar (<script> düz metin olur); Türkçe karakter ve utf-8 bildirimi var', () => {
  const kotu = '<script>alert("x")</script> & <img src=x onerror=alert(1)>';
  const html = belgeHtml({ tur: 'pdf', yol: 'a.pdf', icerik: { baslik: kotu, bolumler: [{ baslik: kotu, paragraflar: [kotu], tablo: [[kotu, 'ş']] }] } });
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /<img/i);
  assert.ok(html.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &lt;img'));
  assert.match(html, /<meta charset="utf-8">/i);
  assert.match(html, /Content-Security-Policy/); // betik ve ağ kapalı
  assert.ok(html.includes('ş'));
});

test('belgeHtml: bölümsüz başlık, paragraf ve tablo yapısı (h1/h2/p/table/th)', () => {
  const html = belgeHtml({ tur: 'pdf', yol: 'a.pdf', icerik: METIN.icerik });
  assert.match(html, /<h1>Çeyrek Raporu ĞÜŞİÖÇ<\/h1>/);
  assert.match(html, /<h2>Özet<\/h2>/);
  assert.match(html, /<p>Gelir bu çeyrekte arttı\.<\/p>/);
  assert.match(html, /<table>[\s\S]*<th>Ürün<\/th>[\s\S]*<td>Çay<\/td>/);
});

test('belgeIstegiDogrula: tür ve içerik biçimi uyuşmalı; geçersizse null', () => {
  assert.deepEqual(belgeIstegiDogrula(METIN), METIN);
  assert.deepEqual(belgeIstegiDogrula(TABLO), TABLO);
  assert.deepEqual(belgeIstegiDogrula(SUNUM), SUNUM);
  assert.ok(belgeIstegiDogrula({ ...METIN, tur: 'pdf' }));
  // tür–içerik uyuşmazlığı
  assert.equal(belgeIstegiDogrula({ ...METIN, tur: 'xlsx' }), null);
  assert.equal(belgeIstegiDogrula({ ...TABLO, tur: 'docx' }), null);
  assert.equal(belgeIstegiDogrula({ ...SUNUM, tur: 'pdf' }), null);
  // bozuk girdiler
  for (const x of [null, undefined, 5, 'x', [], {}, { tur: 'docx' }, { tur: 'exe', yol: 'a', icerik: METIN.icerik }, { tur: 'docx', yol: '', icerik: METIN.icerik },
    { tur: 'docx', yol: 'a.docx', icerik: { bolumler: 'x' } }, { tur: 'docx', yol: 'a.docx', icerik: { bolumler: [{ paragraflar: [1] }] } },
    { tur: 'docx', yol: 'a.docx', icerik: { bolumler: [{ tablo: [['a'], 'b'] }] } }, { tur: 'xlsx', yol: 'a.xlsx', icerik: { sayfalar: [{ ad: 'A', satirlar: [[{}]] }] } },
    { tur: 'xlsx', yol: 'a.xlsx', icerik: { sayfalar: [{ satirlar: [['a']] }] } }, { tur: 'pptx', yol: 'a.pptx', icerik: { slaytlar: [{ maddeler: ['a'] }] } },
    { tur: 'pptx', yol: 'a.pptx', icerik: { slaytlar: [] } }]) {
    assert.equal(belgeIstegiDogrula(x), null, JSON.stringify(x));
    assert.ok(belgeIstegiHatasi(x) && belgeIstegiHatasi(x)!.length > 5, 'okunur hata iletisi');
  }
  assert.equal(belgeIstegiHatasi(METIN), null);
});

test('belgeIstegiDogrula: boyut sınırları (bölüm, satır, sütun, slayt, toplam metin)', () => {
  const cok = (n: number) => Array.from({ length: n }, () => 'x');
  assert.equal(belgeIstegiDogrula({ tur: 'docx', yol: 'a.docx', icerik: { bolumler: cok(BELGE_SINIR.bolum + 1).map(() => ({ paragraflar: ['x'] })) } }), null);
  assert.equal(belgeIstegiDogrula({ tur: 'xlsx', yol: 'a.xlsx', icerik: { sayfalar: [{ ad: 'A', satirlar: Array.from({ length: BELGE_SINIR.satir + 1 }, () => ['x']) }] } }), null);
  assert.equal(belgeIstegiDogrula({ tur: 'xlsx', yol: 'a.xlsx', icerik: { sayfalar: [{ ad: 'A', satirlar: [cok(BELGE_SINIR.sutun + 1)] }] } }), null);
  assert.equal(belgeIstegiDogrula({ tur: 'pptx', yol: 'a.pptx', icerik: { slaytlar: Array.from({ length: BELGE_SINIR.slayt + 1 }, () => ({ baslik: 'b', maddeler: ['m'] })) } }), null);
  assert.equal(belgeIstegiDogrula({ tur: 'docx', yol: 'a.docx', icerik: { bolumler: [{ paragraflar: ['y'.repeat(BELGE_SINIR.metin + 1)] }] } }), null);
  assert.ok(belgeIstegiDogrula({ tur: 'docx', yol: 'a.docx', icerik: { bolumler: [{ paragraflar: ['y'.repeat(1000)] }] } }));
});

test('belgeOzetiMetni: onay önizlemesi için içerik özeti (sayılar ve başlıklar)', () => {
  assert.match(belgeOzetiMetni(METIN), /Word belgesi/);
  assert.match(belgeOzetiMetni(METIN), /2 bölüm/);
  assert.match(belgeOzetiMetni(METIN), /Çeyrek Raporu/);
  assert.match(belgeOzetiMetni(TABLO), /Excel tablosu/);
  assert.match(belgeOzetiMetni(TABLO), /Satışlar/);
  assert.match(belgeOzetiMetni(TABLO), /5 satır/);
  assert.match(belgeOzetiMetni(SUNUM), /Sunum/);
  assert.match(belgeOzetiMetni(SUNUM), /2 slayt/);
  assert.match(belgeOzetiMetni({ ...METIN, tur: 'pdf' }), /PDF belgesi/);
});

test('belgeUret: hedef klasör yoksa oluşturulur; bozuk istekte atar', async () => {
  const hedef = path.join(klasor, 'alt', 'klasor', 'iki.docx');
  await belgeUret(METIN, hedef);
  assert.ok(fs.existsSync(hedef));
  await assert.rejects(belgeUret({ tur: 'docx', yol: 'a', icerik: { sayfalar: [] } } as never, yol('kotu.docx')));
  assert.equal(fs.existsSync(yol('kotu.docx')), false);
});
