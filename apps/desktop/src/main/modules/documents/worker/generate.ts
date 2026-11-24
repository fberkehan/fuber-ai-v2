/**
 * Word, Excel ve PowerPoint üretimi (v1 `belge-uret.ts`ten uyarlandı): `docx`, `exceljs`, `pptxgenjs`. Belge işçisinde
 * koşar; içerik ana süreçte `schema.ts` ile doğrulanmış gelir. PDF burada üretilmez (Electron'un yazdırma motoru
 * ana süreçte: `create.ts`).
 */
import type { GenerateRequest, GenerateResponse, SheetContent, SlideContent, TextContent } from './protocol';

const FONT = 'Calibri';

/** Excel sayfa adı: yasak karakterler (\ / ? * [ ] :) boşluk olur, en çok 31 karakter, büyük/küçük harf duyarsız tek. */
export function sheetName(name: string, used: Set<string>, order: number): string {
  let value =
    name
      .replace(/[\\/?*[\]:]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^'+|'+$/g, '')
      .trim()
      .slice(0, 31)
      .trim() || `Sayfa ${order}`;
  for (let n = 2; used.has(value.toLocaleLowerCase('tr')); n++) {
    const suffix = ` (${n})`;
    value = `${value.slice(0, 31 - suffix.length).trim()}${suffix}`;
  }
  used.add(value.toLocaleLowerCase('tr'));
  return value;
}

async function docx(content: TextContent): Promise<Uint8Array> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType } = await import('docx');
  /** Satır sonlu metin → her satır sonu bir `break`. */
  const runs = (text: string, extra: { bold?: boolean } = {}) =>
    text.split(/\r?\n/).map((line, index) => new TextRun({ text: line, break: index ? 1 : 0, ...extra }));
  const children: Array<InstanceType<typeof Paragraph> | InstanceType<typeof Table>> = [];
  if (content.title) children.push(new Paragraph({ heading: HeadingLevel.TITLE, children: runs(content.title) }));
  for (const section of content.sections) {
    if (section.heading) children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: runs(section.heading) }));
    for (const paragraph of section.paragraphs ?? []) children.push(new Paragraph({ children: runs(paragraph), spacing: { after: 120 } }));
    if (section.table?.length) {
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: section.table.map(
            (row, index) =>
              new TableRow({
                tableHeader: index === 0,
                children: (row.length ? row : ['']).map((cell) => new TableCell({ children: [new Paragraph({ children: runs(cell, { bold: index === 0 }) })] })),
              }),
          ),
        }),
      );
      // Art arda iki tablo birleşmesin.
      children.push(new Paragraph({ children: [] }));
    }
  }
  const document = new Document({
    creator: 'Fuber AI 2',
    ...(content.title ? { title: content.title } : {}),
    styles: { default: { document: { run: { font: FONT, size: 22 } } } },
    sections: [{ children: children.length ? children : [new Paragraph({ children: [] })] }],
  });
  return new Uint8Array(await Packer.toBuffer(document));
}

async function xlsx(content: SheetContent): Promise<Uint8Array> {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Fuber AI 2';
  workbook.created = new Date();
  const used = new Set<string>();
  content.sheets.forEach((sheet, index) => {
    const worksheet = workbook.addWorksheet(sheetName(sheet.name, used, index + 1));
    // '' gerçekten boş hücre olur; "=…" ile başlayan metin formül DEĞİL metin kalır (formül yalnız {formula} ile yazılır).
    worksheet.addRows(sheet.rows.map((row) => row.map((cell) => (cell === '' ? null : cell))));
    if (sheet.rows.length) worksheet.getRow(1).font = { bold: true };
    const columns = sheet.rows.reduce((max, row) => Math.max(max, row.length), 0);
    for (let column = 1; column <= columns; column++) {
      const width = sheet.rows.reduce(
        (max, row) => Math.max(max, String(row[column - 1] ?? '').split(/\r?\n/).reduce((longest, line) => Math.max(longest, [...line].length), 0)),
        0,
      );
      worksheet.getColumn(column).width = Math.min(60, Math.max(8, width + 2));
    }
  });
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

async function pptx(content: SlideContent): Promise<Uint8Array> {
  const PptxGenJS = (await import('pptxgenjs')).default;
  const deck = new PptxGenJS();
  deck.layout = 'LAYOUT_WIDE';
  deck.author = 'Fuber AI 2';
  if (content.title) deck.title = content.title;
  deck.defineSlideMaster({
    title: 'FUBER',
    background: { color: 'FFFFFF' },
    objects: [
      { placeholder: { options: { name: 'title', type: 'title', x: 0.7, y: 0.45, w: 11.9, h: 1.1, fontFace: FONT, fontSize: 32, bold: true, color: '111111', valign: 'middle' }, text: '' } },
      { placeholder: { options: { name: 'body', type: 'body', x: 0.7, y: 1.8, w: 11.9, h: 5.0, fontFace: FONT, fontSize: 22, color: '222222', valign: 'top' }, text: '' } },
    ],
  });
  for (const slide of content.slides) {
    const page = deck.addSlide({ masterName: 'FUBER' });
    page.addText(slide.title, { placeholder: 'title' });
    if (slide.bullets.length) {
      const small = slide.bullets.length > 8;
      page.addText(
        slide.bullets.map((bullet) => ({ text: bullet, options: { bullet: true, breakLine: true, fontSize: small ? 16 : 22 } })),
        { placeholder: 'body' },
      );
    }
  }
  const output = await deck.write({ outputType: 'nodebuffer' });
  return output instanceof Uint8Array ? new Uint8Array(output) : new Uint8Array(output as ArrayBuffer);
}

export async function generateDocument(request: GenerateRequest): Promise<GenerateResponse> {
  try {
    const data =
      request.format === 'docx'
        ? await docx(request.content as TextContent)
        : request.format === 'xlsx'
          ? await xlsx(request.content as SheetContent)
          : await pptx(request.content as SlideContent);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, code: 'corrupt', error: String((error as Error)?.message ?? error).slice(0, 200) };
  }
}
