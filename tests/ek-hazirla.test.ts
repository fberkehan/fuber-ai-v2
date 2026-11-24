// Analiz 11 Kas (geliştirici bulgu 8): sohbet eki dosya_oku'nun ayrıştırıcısıyla metne çevrilir — PDF, docx, xlsx, pptx, metin ve kod; tür/boyut
// reddi tek satır; uzun metin AÇIKÇA kısaltılır. Dosyalar testte üretilir (docx, exceljs, pptxgenjs bağımlılıkları; elle yazılmış küçük PDF).
import { KURULUM_SURUMU } from '../src/shared/kurulum-adimlari.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
// exceljs / pptxgenjs / docx / pdf-parse modül kancasından ÖNCE yüklenir (tests/dosya-yaz.test.ts'teki not: aksi hâlde "module is not linked").
import 'exceljs';
import 'pptxgenjs';
import 'docx';
import 'mammoth';
import 'pdf-parse';
import { anaSurecSahnesi, esbuildHazir } from './yardimci/ana-surec.ts';

const sahne = anaSurecSahnesi('ek-hazirla', { kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, kullaniciAdi: 'Deniz', mod: 'gelistirici', tanitimSurumu: '0.9.0', proaktif: { etkin: false }, baslangictaAc: false });
await esbuildHazir();
const { ekMetniOku } = await import('../src/main/iceaktar.ts');
const kl = path.join(sahne.klasor, 'ekler');
fs.mkdirSync(kl, { recursive: true });

/** En küçük geçerli PDF: tek sayfa, "Merhaba PDF eki" yazısı (xref uzaklıkları hesaplanır). */
function kucukPdf(): Buffer {
  const nesneler = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const akis = 'BT /F1 18 Tf 20 80 Td (Merhaba PDF eki) Tj ET';
  nesneler[3] = `<< /Length ${akis.length} >>\nstream\n${akis}\nendstream`;
  let s = '%PDF-1.4\n';
  const yer: number[] = [];
  nesneler.forEach((n, i) => { yer.push(Buffer.byteLength(s)); s += `${i + 1} 0 obj\n${n}\nendobj\n`; });
  const xref = Buffer.byteLength(s);
  s += `xref\n0 ${nesneler.length + 1}\n0000000000 65535 f \n${yer.map((y) => `${String(y).padStart(10, '0')} 00000 n \n`).join('')}`;
  s += `trailer\n<< /Size ${nesneler.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(s, 'latin1');
}

test('PDF, Word, Excel, PowerPoint, metin ve kod eki metne çevrilir', async () => {
  const pdf = path.join(kl, 'rapor.pdf');
  fs.writeFileSync(pdf, kucukPdf());
  const docx = await import('docx');
  const belge = new docx.Document({ sections: [{ children: [new docx.Paragraph('Word eki: ğüşıöç')] }] });
  const docxYol = path.join(kl, 'not.docx');
  fs.writeFileSync(docxYol, await docx.Packer.toBuffer(belge));
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Satışlar');
  ws.addRow(['Ay', 'Tutar']); ws.addRow(['Ocak', 1200]); ws.addRow(['Şubat', { formula: 'B2*2', result: 2400 }]);
  const xlsx = path.join(kl, 'tablo.xlsx');
  await wb.xlsx.writeFile(xlsx);
  const PptxGenJS = (await import('pptxgenjs')).default as unknown as new () => { addSlide: () => { addText: (t: string, o: object) => void; addNotes: (t: string) => void }; write: (o: object) => Promise<Buffer> };
  const sunum = new PptxGenJS();
  const s1 = sunum.addSlide(); s1.addText('Birinci slayt başlığı', { x: 1, y: 1 }); s1.addNotes('Burada fiyatı anlat');
  const s2 = sunum.addSlide(); s2.addText('İkinci slayt', { x: 1, y: 1 });
  const pptx = path.join(kl, 'sunum.pptx');
  fs.writeFileSync(pptx, await sunum.write({ outputType: 'nodebuffer' }));
  const md = path.join(kl, 'README.md'); fs.writeFileSync(md, '# Başlık\nmetin');
  const ts = path.join(kl, 'main.ts'); fs.writeFileSync(ts, 'export const x = 1;\n');

  const r = async (y: string) => { const s = await ekMetniOku(y); assert.ok(!('hata' in s), JSON.stringify(s)); return s as { ad: string; metin: string; tur: string }; };
  assert.match((await r(pdf)).metin, /Merhaba PDF eki/);
  assert.match((await r(docxYol)).metin, /Word eki: ğüşıöç/);
  const x = await r(xlsx);
  assert.match(x.metin, /## Sayfa: Satışlar/);
  assert.match(x.metin, /Ocak\t1200/);
  assert.match(x.metin, /Şubat\t2400/, 'formülün sonucu');
  const p = await r(pptx);
  assert.match(p.metin, /## Slayt 1\nBirinci slayt başlığı/);
  assert.match(p.metin, /Konuşmacı notu: Burada fiyatı anlat/);
  assert.match(p.metin, /## Slayt 2\nİkinci slayt/);
  assert.equal((await r(md)).metin, '# Başlık\nmetin');
  assert.equal((await r(ts)).tur, 'belge');
});

test('ret ve kısaltma: tür, boyut, boş dosya, göreli yol tek satır; uzun metin açık notla kısaltılır', async () => {
  const exe = path.join(kl, 'kur.exe'); fs.writeFileSync(exe, 'MZ');
  const e = await ekMetniOku(exe);
  assert.ok('hata' in e && /^Bu dosya türü desteklenmiyor: \.\w+$/.test(e.hata));
  assert.ok('hata' in (await ekMetniOku('goreli.txt')));
  assert.ok('hata' in (await ekMetniOku(path.join(kl, 'yok.txt'))));
  const bos = path.join(kl, 'bos.txt'); fs.writeFileSync(bos, '');
  assert.ok('hata' in (await ekMetniOku(bos)));
  const uzun = path.join(kl, 'uzun.txt'); fs.writeFileSync(uzun, 'a'.repeat(50_000));
  const u = await ekMetniOku(uzun) as { metin: string; kisaltildi?: boolean; toplam?: number };
  assert.equal(u.kisaltildi, true);
  assert.equal(u.toplam, 50_000);
  assert.match(u.metin, /ek kısaltıldı: 40\.000 \/ 50\.000 karakter/);
});
