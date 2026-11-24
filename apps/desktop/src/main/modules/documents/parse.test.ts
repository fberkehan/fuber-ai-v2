// Belge ayrıştırıcıları: her biçim sentetik fikstürle; bozuk, şifreli, boş, eski biçim ve zip bombası.
import fs from 'node:fs';
import nodePath from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDocx, buildEncryptedOffice, buildPdf, buildZip, SAMPLE_EML, scratchDir } from './testkit';
import { generateDocument } from './worker/generate';
import { decodeText, excelSerialToText, parseCsvRows, parseDocument } from './worker/parse';
import type { ParseResponse } from './worker/protocol';

let dir: string;
let cleanup: () => Promise<void>;
beforeAll(() => {
  ({ dir, cleanup } = scratchDir('parse'));
});
afterAll(() => cleanup());

const write = (name: string, data: Buffer | string | Uint8Array) => {
  const file = nodePath.join(dir, name);
  fs.writeFileSync(file, data);
  return file;
};
const parse = (file: string, extra: Partial<Parameters<typeof parseDocument>[0]> = {}) => parseDocument({ op: 'parse', path: file, maxChars: 1_000_000, ...extra });
const ok = (result: ParseResponse) => {
  if (!result.ok) throw new Error(`beklenmeyen hata: ${result.code} ${result.error}`);
  return result;
};
const allText = (result: ParseResponse) => (result.ok ? result.sections.map((section) => section.text).join('\n') : '');

describe('PDF', () => {
  it('sayfa sayfa metin, başlık ve sayfa sayısı', async () => {
    const file = write('beyan.pdf', buildPdf([['KDV Beyannamesi', 'Donem: Ekim 2026'], ['Son Odeme Tarihi: 26.11.2026', 'Odenecek tutar: 12.500,00 TL']], { title: 'Ekim KDV' }));
    const result = ok(await parse(file));
    expect(result.format).toBe('pdf');
    expect(result.title).toBe('Ekim KDV');
    expect(result.meta.pages).toBe(2);
    expect(result.sections.map((section) => section.label)).toEqual(['Sayfa 1', 'Sayfa 2']);
    expect(result.sections[1]!.text).toContain('26.11.2026');
    expect(result.scanned).toBeUndefined();
  });

  it('taranmış (metinsiz) PDF dürüstçe işaretlenir', async () => {
    const file = write('tarama.pdf', buildPdf([[], []], { scanned: [1, 2] }));
    const result = ok(await parse(file));
    expect(result.scanned).toBe(true);
    expect(allText(result).trim()).toBe('');
  });

  it('taranmış PDF sayfası görüntü olarak üretilir (derin beyne gidecek PNG)', async () => {
    const file = write('tarama-goruntu.pdf', buildPdf([[], []], { scanned: [1, 2] }));
    const result = ok(await parse(file, { renderPages: [1, 9] }));
    expect(result.images).toHaveLength(1);
    expect(result.images![0]!.page).toBe(1);
    expect(Buffer.from(result.images![0]!.data, 'base64').subarray(1, 4).toString('latin1')).toBe('PNG');
  });

  it('parolalı PDF: "encrypted", çökmez', async () => {
    const file = write('parolali.pdf', buildPdf([['gizli']], { encrypt: true }));
    const result = await parse(file);
    expect(result).toMatchObject({ ok: false, code: 'encrypted' });
  });

  it('bozuk PDF ve PDF olmayan .pdf', async () => {
    const broken = buildPdf([['yarim']]).subarray(0, 120);
    expect(await parse(write('bozuk.pdf', broken))).toMatchObject({ ok: false });
    expect(await parse(write('sahte.pdf', 'merhaba dunya'))).toMatchObject({ ok: false, code: 'corrupt' });
  });
});

describe('Word', () => {
  it('başlık bölümleri, tablo satırları " | " ile, üstveri', async () => {
    const result = ok(await parse(write('ozet.docx', buildDocx())));
    expect(result.format).toBe('docx');
    expect(result.title).toBe('KDV Özeti');
    expect(result.meta.author).toBe('Sınama');
    const labels = result.sections.map((section) => section.label);
    expect(labels).toContain('Ödemeler');
    const text = allText(result);
    expect(text).toContain('KDV | 12.500,00 TL | 26.11.2026');
    expect(text).toContain('Kalem | Tutar | Son gün');
    expect(text).toContain('ödeme bankadan yapılacak & dekont saklanacak');
  });

  it('docx kitaplığıyla üretilen belge geri okunur (tablo dahil)', async () => {
    const generated = await generateDocument({
      op: 'generate',
      format: 'docx',
      content: { title: 'Rapor', sections: [{ heading: 'Özet', paragraphs: ['Çağrı merkezi: şeffaf, ılık, İstanbul'], table: [['A', 'B'], ['1', '2']] }] },
    });
    expect(generated.ok).toBe(true);
    if (!generated.ok) return;
    const result = ok(await parse(write('uretilen.docx', generated.data)));
    expect(allText(result)).toContain('Çağrı merkezi: şeffaf, ılık, İstanbul');
    expect(allText(result)).toContain('1 | 2');
  });

  it('parolalı ve eski biçim Office dosyaları', async () => {
    expect(await parse(write('parolali.docx', buildEncryptedOffice()))).toMatchObject({ ok: false, code: 'encrypted' });
    expect(await parse(write('eski.doc', 'x'))).toMatchObject({ ok: false, code: 'legacy' });
  });

  it('zip bombası: başlık yalan söylese de açılan bayt sınırı keser', async () => {
    const bomb = buildZip([{ name: 'word/document.xml', data: Buffer.alloc(8 * 1024 * 1024, 0x41), claimInflated: 100 }]);
    expect(bomb.length).toBeLessThan(100_000);
    const result = await parse(write('bomba.docx', bomb), { zip: { maxEntries: 100, maxInflated: 1024 * 1024 } });
    expect(result).toMatchObject({ ok: false, code: 'limit' });
  });

  it('çok parçalı arşiv sınırı', async () => {
    const many = buildZip(Array.from({ length: 30 }, (_unused, i) => ({ name: `p${i}.xml`, data: 'x' })));
    expect(await parse(write('cok.docx', many), { zip: { maxEntries: 10, maxInflated: 1024 * 1024 } })).toMatchObject({ ok: false, code: 'limit' });
  });

  it('şifreli işaretli ZIP parçası', async () => {
    const zip = buildZip([{ name: 'word/document.xml', data: '<w:document/>', flags: 1 }]);
    expect(await parse(write('sifreli-parca.docx', zip))).toMatchObject({ ok: false, code: 'encrypted' });
  });
});

describe('Excel ve CSV', () => {
  it('sayfa adları, tablo satırları, tarih biçimli hücre gün olarak', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('Ödemeler');
    sheet.addRow(['Kalem', 'Tutar', 'Son gün']);
    sheet.addRow(['KDV', 12500, new Date(Date.UTC(2026, 10, 26))]);
    sheet.getCell('C2').numFmt = 'dd.mm.yyyy';
    book.addWorksheet('Notlar').addRow(['Bilgi', 'Sentetik']);
    const file = write('takvim.xlsx', Buffer.from(await book.xlsx.writeBuffer()));
    const result = ok(await parse(file));
    expect(result.meta.pages).toBe(2);
    expect(result.sections.map((section) => section.label)).toEqual(['Sayfa: Ödemeler', 'Sayfa: Notlar']);
    expect(result.sections[0]!.text).toContain('KDV | 12500 | 2026-11-26');
  });

  it('Excel seri günü dönüşümü (1900 ve 1904 tabanı)', () => {
    expect(excelSerialToText(46352, false, false)).toBe('2026-11-26');
    expect(excelSerialToText(46352.5, false, true)).toBe('2026-11-26 12:00');
    expect(excelSerialToText(44890, true, false)).toBe('2026-11-26');
  });

  it('CSV: noktalı virgül, tırnak, Windows-1254 Türkçe', async () => {
    const text = 'Kalem;Tutar;Açıklama\nKDV;"12.500,00";"Şubat; ödeme"\nSGK;3.000;Işık\n';
    const encoded = Buffer.from(new Uint8Array([...text].map((ch) => ({ Ç: 0xc7, ç: 0xe7, Ş: 0xde, ş: 0xfe, ı: 0xfd, İ: 0xdd, ö: 0xf6, Ğ: 0xd0, ğ: 0xf0, I: 0x49 })[ch] ?? ch.charCodeAt(0))));
    expect(decodeText(encoded)).toBe(text);
    const result = ok(await parse(write('liste.csv', encoded)));
    expect(result.sections[0]!.text).toContain('KDV | 12.500,00 | Şubat; ödeme');
    expect(parseCsvRows('a,b\n"x,y",z')).toEqual([['a', 'b'], ['x,y', 'z']]);
  });
});

describe('PowerPoint, e-posta, metin', () => {
  it('pptx: slayt slayt metin', async () => {
    const generated = await generateDocument({ op: 'generate', format: 'pptx', content: { title: 'Sunum', slides: [{ title: 'Giriş', bullets: ['Birinci madde'] }, { title: 'Takvim', bullets: ['KDV 26 Kasım'] }] } });
    if (!generated.ok) throw new Error(generated.error);
    const result = ok(await parse(write('sunum.pptx', generated.data)));
    expect(result.meta.pages).toBe(2);
    expect(result.sections.map((section) => section.label)).toEqual(['Slayt 1', 'Slayt 2']);
    expect(result.sections[1]!.text).toContain('KDV 26 Kasım');
  });

  it('eml: başlıklar, gövde, ek adları (ek içeriği okunmaz)', async () => {
    const result = ok(await parse(write('posta.eml', SAMPLE_EML)));
    expect(result.title).toBe('KDV beyannamesi');
    expect(result.meta.attachments).toEqual(['tahakkuk.pdf']);
    expect(allText(result)).toContain('son ödeme günü 26 Kasım 2026');
    expect(allText(result)).toContain('Kimden: "Muhasebe Sınama" <muhasebe@example.com>');
    expect(allText(result)).toContain('Tarih: 2026-11-16 09:30');
  });

  it('metin ve Markdown; 0 bayt ve desteklenmeyen tür', async () => {
    const md = ok(await parse(write('not.md', '# Başlık\n\nİçerik satırı.')));
    expect(md.title).toBe('Başlık');
    expect(await parse(write('bos.txt', ''))).toMatchObject({ ok: false, code: 'corrupt' });
    expect(await parse(write('program.exe', 'MZ'))).toMatchObject({ ok: false, code: 'unsupported' });
  });

  it('bütçe: fazlası tutulmaz ama sayılır', async () => {
    const result = ok(await parse(write('uzun.txt', 'a'.repeat(5000)), { maxChars: 1000 }));
    expect(result.truncated).toBe(true);
    expect(result.totalChars).toBe(5000);
    expect(allText(result).length).toBe(1000);
  });
});
