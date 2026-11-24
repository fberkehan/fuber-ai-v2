/**
 * Sınama yardımcıları: SENTETİK belge fikstürleri (kişisel veri yok) ve yalıtılmış klasörler. Üretim kodu bunu içe
 * aktarmaz. Klasörler depo içindeki `artifacts/` altında açılır: `%TEMP%` AppData altındadır ve erişim kapısı AppData'yı
 * bilerek engeller.
 */
import fs from 'node:fs';
import nodePath from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const repoRoot = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..', '..');

/** Depo içinde (AppData dışında) geçici klasör. */
export function scratchDir(label: string): { dir: string; cleanup(): Promise<void> } {
  const base = nodePath.join(repoRoot, 'artifacts', 'vitest-documents');
  fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(nodePath.join(base, `${label}-`));
  return { dir, cleanup: () => fs.promises.rm(dir, { recursive: true, force: true }) };
}

// ───────────────────────── PDF ─────────────────────────

const pdfText = (value: string) => value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

/**
 * Elle kurulmuş geçerli PDF: her sayfa satır listesidir (Helvetica, WinAnsi; Latin-1 dışı harf yazılamaz).
 * `scanned` sayfalarında yazı yoktur (yalnız gri bir dikdörtgen). `encrypt`: Standard güvenlik sözlüğü (boş parola tutmaz).
 */
export function buildPdf(pages: string[][], options: { title?: string; scanned?: number[]; encrypt?: boolean } = {}): Buffer {
  const objects: string[] = [];
  const pageCount = pages.length;
  const firstPage = 4;
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Count ${pageCount} /Kids [${pages.map((_page, i) => `${firstPage + i * 2} 0 R`).join(' ')}] >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  pages.forEach((lines, i) => {
    const pageObject = firstPage + i * 2;
    const contentObject = pageObject + 1;
    const scanned = options.scanned?.includes(i + 1);
    const stream = scanned
      ? '0.6 g 72 72 450 650 re f'
      : `BT /F1 12 Tf 16 TL 72 740 Td ${lines.map((line) => `(${pdfText(line)}) Tj T*`).join(' ')} ET`;
    objects[pageObject] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObject} 0 R >>`;
    objects[contentObject] = `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`;
  });
  const infoObject = objects.length;
  objects[infoObject] = `<< /Title (${pdfText(options.title ?? 'Sentetik belge')}) /Author (Fuber sinama) >>`;
  let encryptObject = 0;
  if (options.encrypt) {
    encryptObject = objects.length;
    objects[encryptObject] = `<< /Filter /Standard /V 1 /R 2 /O <${'4f'.repeat(32)}> /U <${'55'.repeat(32)}> /P -44 >>`;
  }
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets: number[] = [];
  for (let n = 1; n < objects.length; n++) {
    offsets[n] = Buffer.byteLength(out, 'latin1');
    out += `${n} 0 obj\n${objects[n]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let n = 1; n < objects.length; n++) out += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  const id = '0123456789abcdef0123456789abcdef';
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info ${infoObject} 0 R${encryptObject ? ` /Encrypt ${encryptObject} 0 R /ID [<${id}> <${id}>]` : ''} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

// ───────────────────────── ZIP ─────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Küçük ZIP yazıcı. `claimInflated`: merkez dizinde yalan açık boyut (zip bombası sınaması); `flags` 1 = şifreli işareti. */
export function buildZip(entries: Array<{ name: string; data: Buffer | string; claimInflated?: number; flags?: number }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
    const compressed = zlib.deflateRawSync(raw);
    const name = Buffer.from(entry.name, 'utf8');
    const crc = crc32(raw);
    const inflated = entry.claimInflated ?? raw.length;
    const flags = (entry.flags ?? 0) | 0x800;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(inflated, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(inflated, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, compressed);
    centrals.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

/** Elle kurulmuş Word belgesi: başlık, paragraf ve tablo (docx kitaplığından bağımsız fikstür). */
export function buildDocx(): Buffer {
  const p = (text: string, style?: string) =>
    `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
  const cell = (text: string) => `<w:tc><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
  const row = (cells: string[]) => `<w:tr>${cells.map(cell).join('')}</w:tr>`;
  const body = [
    p('Ekim 2026 KDV Özeti', 'Title'),
    p('Genel bilgi', 'Heading1'),
    p('Bu belge sınama için üretilmiştir; gerçek bir şirkete ait değildir.'),
    p('Ödemeler', 'Heading1'),
    `<w:tbl><w:tblPr/>${row(['Kalem', 'Tutar', 'Son gün'])}${row(['KDV', '12.500,00 TL', '26.11.2026'])}${row(['Muhtasar', '3.200,00 TL', '26.11.2026'])}</w:tbl>`,
    p('Not: ödeme bankadan yapılacak &amp; dekont saklanacak.'),
  ].join('');
  const document = `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
  const core = `<?xml version="1.0"?><cp:coreProperties xmlns:cp="x" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"><dc:title>KDV Özeti</dc:title><dc:creator>Sınama</dc:creator></cp:coreProperties>`;
  return buildZip([
    { name: '[Content_Types].xml', data: '<Types/>' },
    { name: 'word/document.xml', data: document },
    { name: 'docProps/core.xml', data: core },
  ]);
}

/** Parolalı Office dosyasının taklidi: OLE bileşik belge imzası + "EncryptedPackage" akış adı. */
export function buildEncryptedOffice(): Buffer {
  const header = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  return Buffer.concat([header, Buffer.alloc(504), Buffer.from('EncryptionInfo', 'utf16le'), Buffer.alloc(64), Buffer.from('EncryptedPackage', 'utf16le'), Buffer.alloc(1024)]);
}

export const SAMPLE_EML = [
  'From: Muhasebe Sınama <muhasebe@example.com>',
  'To: Kullanıcı <kullanici@example.com>',
  'Subject: =?UTF-8?B?S0RWIGJleWFubmFtZXNp?=',
  'Date: Mon, 16 Nov 2026 09:30:00 +0300',
  'MIME-Version: 1.0',
  'Content-Type: multipart/mixed; boundary="sinir"',
  '',
  '--sinir',
  'Content-Type: text/plain; charset=utf-8',
  'Content-Transfer-Encoding: 8bit',
  '',
  'Merhaba, Ekim KDV beyannamesinin son ödeme günü 26 Kasım 2026.',
  'Tutar: 12.500,00 TL.',
  '--sinir',
  'Content-Type: application/pdf; name="tahakkuk.pdf"',
  'Content-Disposition: attachment; filename="tahakkuk.pdf"',
  'Content-Transfer-Encoding: base64',
  '',
  'JVBERi0xLjQK',
  '--sinir--',
  '',
].join('\r\n');
