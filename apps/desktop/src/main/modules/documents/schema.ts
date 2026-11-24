/**
 * Belge üretme isteğinin biçimi ve katı doğrulaması (v1 `shared/belge-sema.ts`ten uyarlandı; alan adları İngilizce).
 * İçerik üç biçimden biridir:
 *   · metin  (docx, pdf): { title?, sections: [{ heading?, paragraphs?, table? }] }
 *   · tablo  (xlsx):      { sheets: [{ name, rows: (metin | sayı)[][] }] }
 *   · sunum  (pptx):      { title?, slides: [{ title, bullets }] }
 * Doğrulama kopya döndürür: bilinmeyen alanlar düşer, `null` hücre boştur, sayı gibi görünen metin Excel'e sayı olarak
 * yazılır (baştaki sıfırlı telefon/posta kodu metin kalır). Boyut sınırları bellek ve dosya boyutunu korur. Hata
 * iletileri modele gider (Türkçe, düzeltilebilir).
 */
import { z } from 'zod';
import type { SheetContent, SlideContent, TextContent } from './worker/protocol';

export type CreateFormat = 'docx' | 'xlsx' | 'pptx' | 'pdf';
export const CREATE_FORMATS: readonly CreateFormat[] = ['docx', 'xlsx', 'pptx', 'pdf'];

export const CREATE_LIMITS = { sections: 200, paragraphs: 2000, sheets: 20, rows: 5000, columns: 50, slides: 100, bullets: 40, text: 1_000_000, cell: 32_000 } as const;

export const FORMAT_LABEL: Record<CreateFormat, string> = { docx: 'Word belgesi', xlsx: 'Excel tablosu', pptx: 'Sunum', pdf: 'PDF belgesi' };

const cell = z.union([z.string(), z.number(), z.null()]);

/** Aracın girdi şeması: düz ve kısa (küçük model iç içe birleşimle zorlanır); türe uygunluğu `validateCreate` denetler. */
export const createInput = z.object({
  format: z.enum(['docx', 'xlsx', 'pptx', 'pdf']).describe('docx = Word, xlsx = Excel, pptx = sunum, pdf'),
  file_name: z.string().min(1).max(160).describe('Dosya adı (uzantısız da olur): "Ekim KDV özeti"'),
  title: z.string().optional().describe('Belgenin başlığı'),
  sections: z
    .array(
      z.object({
        heading: z.string().optional(),
        paragraphs: z.array(z.string()).optional(),
        table: z.array(z.array(cell)).optional().describe('İlk satır başlık'),
      }),
    )
    .optional()
    .describe('docx ve pdf için bölümler'),
  sheets: z
    .array(z.object({ name: z.string(), rows: z.array(z.array(cell)).describe('İlk satır başlık') }))
    .optional()
    .describe('xlsx için sayfalar'),
  slides: z.array(z.object({ title: z.string(), bullets: z.array(z.string()).optional() })).optional().describe('pptx için slaytlar'),
});
export type CreateInput = z.infer<typeof createInput>;

export type ValidContent = { format: 'docx' | 'pdf'; content: TextContent } | { format: 'xlsx'; content: SheetContent } | { format: 'pptx'; content: SlideContent };

const NUMBER_TEXT = /^-?(?:0|[1-9]\d{0,14})(?:\.\d{1,15})?$/;

class Counter {
  total = 0;
}

function text(value: unknown, where: string, counter: Counter, required = false): string | undefined | { error: string } {
  if (value === undefined || value === null || value === '') return required ? { error: `${where} zorunlu` } : undefined;
  if (typeof value !== 'string') return { error: `${where} metin olmalı` };
  if (value.length > CREATE_LIMITS.cell) return { error: `${where} çok uzun (en çok ${CREATE_LIMITS.cell} karakter)` };
  counter.total += value.length;
  return value;
}
const isError = (value: unknown): value is { error: string } => typeof value === 'object' && value !== null && 'error' in value;

function rows(value: unknown, where: string, counter: Counter, numbers: boolean): Array<Array<string | number>> | string {
  if (!Array.isArray(value)) return `${where} satır dizisi olmalı (her satır bir dizi)`;
  if (value.length > CREATE_LIMITS.rows) return `${where} çok uzun (en çok ${CREATE_LIMITS.rows} satır)`;
  const out: Array<Array<string | number>> = [];
  for (let i = 0; i < value.length; i++) {
    const row: unknown = value[i];
    if (!Array.isArray(row)) return `${where}[${i}] dizi olmalı`;
    if (row.length > CREATE_LIMITS.columns) return `${where}[${i}] çok geniş (en çok ${CREATE_LIMITS.columns} sütun)`;
    const cells: Array<string | number> = [];
    for (let j = 0; j < row.length; j++) {
      const item: unknown = row[j];
      if (item === null || item === undefined) {
        cells.push('');
        continue;
      }
      if (typeof item === 'number') {
        if (!Number.isFinite(item)) return `${where}[${i}][${j}] sonlu bir sayı olmalı`;
        cells.push(numbers ? item : String(item));
        continue;
      }
      const value = text(item, `${where}[${i}][${j}]`, counter);
      if (isError(value)) return value.error;
      cells.push(numbers && value !== undefined && NUMBER_TEXT.test(value) ? Number(value) : (value ?? ''));
    }
    out.push(cells);
  }
  return out;
}

/** Geçerliyse temizlenmiş içerik, değilse modele gidecek Türkçe ileti. */
export function validateCreate(input: CreateInput): ValidContent | string {
  const counter = new Counter();
  const format = input.format;
  let result: ValidContent | string;
  if (format === 'xlsx') {
    if (!input.sheets?.length) return 'xlsx için "sheets" gerekli: [{ name, rows }] (ilk satır başlık).';
    if (input.sheets.length > CREATE_LIMITS.sheets) return `sheets çok uzun (en çok ${CREATE_LIMITS.sheets} sayfa)`;
    const sheets: SheetContent['sheets'] = [];
    for (const [i, sheet] of input.sheets.entries()) {
      const name = text(sheet.name, `sheets[${i}].name`, counter, true);
      if (isError(name)) return name.error;
      const body = rows(sheet.rows, `sheets[${i}].rows`, counter, true);
      if (typeof body === 'string') return body;
      sheets.push({ name: name!, rows: body });
    }
    result = { format, content: { sheets } };
  } else if (format === 'pptx') {
    if (!input.slides?.length) return 'pptx için "slides" gerekli: [{ title, bullets }].';
    if (input.slides.length > CREATE_LIMITS.slides) return `slides çok uzun (en çok ${CREATE_LIMITS.slides} slayt)`;
    const slides: SlideContent['slides'] = [];
    for (const [i, slide] of input.slides.entries()) {
      const title = text(slide.title, `slides[${i}].title`, counter, true);
      if (isError(title)) return title.error;
      const bullets: string[] = [];
      if ((slide.bullets?.length ?? 0) > CREATE_LIMITS.bullets) return `slides[${i}].bullets çok uzun (en çok ${CREATE_LIMITS.bullets} madde)`;
      for (const [j, bullet] of (slide.bullets ?? []).entries()) {
        const value = text(bullet, `slides[${i}].bullets[${j}]`, counter);
        if (isError(value)) return value.error;
        bullets.push(value ?? '');
      }
      slides.push({ title: title!, bullets });
    }
    const title = text(input.title, 'title', counter);
    if (isError(title)) return title.error;
    result = { format, content: { ...(title ? { title } : {}), slides } };
  } else {
    if (!input.sections?.length) return `${format} için "sections" gerekli: [{ heading?, paragraphs?, table? }].`;
    if (input.sections.length > CREATE_LIMITS.sections) return `sections çok uzun (en çok ${CREATE_LIMITS.sections} bölüm)`;
    const title = text(input.title, 'title', counter);
    if (isError(title)) return title.error;
    const sections: TextContent['sections'] = [];
    for (const [i, section] of input.sections.entries()) {
      const out: TextContent['sections'][number] = {};
      const heading = text(section.heading, `sections[${i}].heading`, counter);
      if (isError(heading)) return heading.error;
      if (heading) out.heading = heading;
      if (section.paragraphs) {
        if (section.paragraphs.length > CREATE_LIMITS.paragraphs) return `sections[${i}].paragraphs çok uzun (en çok ${CREATE_LIMITS.paragraphs})`;
        out.paragraphs = [];
        for (const [j, paragraph] of section.paragraphs.entries()) {
          const value = text(paragraph, `sections[${i}].paragraphs[${j}]`, counter);
          if (isError(value)) return value.error;
          out.paragraphs.push(value ?? '');
        }
      }
      if (section.table) {
        const table = rows(section.table, `sections[${i}].table`, counter, false);
        if (typeof table === 'string') return table;
        out.table = table.map((row) => row.map(String));
      }
      if (!out.heading && !out.paragraphs?.length && !out.table?.length) return `sections[${i}] boş (heading, paragraphs ya da table verin)`;
      sections.push(out);
    }
    result = { format, content: { ...(title ? { title } : {}), sections } };
  }
  if (counter.total > CREATE_LIMITS.text) return `belge çok büyük (en çok ${CREATE_LIMITS.text} karakter metin)`;
  return result;
}

/** Onay ve sonuç metni için kısa özet: tür, başlık, sayılar. */
export function describeContent(valid: ValidContent): string {
  const label = FORMAT_LABEL[valid.format];
  const short = (value: string, n = 60) => (value.length > n ? `${value.slice(0, n - 1)}…` : value);
  if (valid.format === 'xlsx') {
    return `${label} · ${valid.content.sheets.length} sayfa: ${valid.content.sheets.slice(0, 6).map((sheet) => `${short(sheet.name, 31)} (${sheet.rows.length} satır)`).join(', ')}`;
  }
  if (valid.format === 'pptx') return `${label} · ${valid.content.slides.length} slayt`;
  const tables = valid.content.sections.filter((section) => section.table?.length).length;
  return `${label}${valid.content.title ? ` · “${short(valid.content.title, 80)}”` : ''} · ${valid.content.sections.length} bölüm${tables ? `, ${tables} tablo` : ''}`;
}
