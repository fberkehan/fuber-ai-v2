/**
 * Belge ayrıştırıcıları: PDF, Word, Excel, CSV, PowerPoint, e-posta, düz metin → sayfa/bölüm bölüm metin.
 * YALNIZ belge işçisinde (ayrı süreç) çalışır; ana süreç bu dosyayı içe aktarmaz. Word/PowerPoint/Excel okuyucuları
 * v1'den (`belge-isci.ts`) uyarlandı ve genişletildi: tablolar satır satır " | " ile korunur, Excel tarihleri gün
 * olarak yazılır, başlık ve üstveri okunur. Makro ve betik ÇALIŞTIRILMAZ: yalnız XML metni okunur; PDF'te
 * değerlendirme (eval) ve XFA kapalıdır.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { DocFormat, DocMeta, DocSection, ErrorCode, PageImage, ParseRequest, ParseResponse } from './protocol';
import {
  DEFAULT_ZIP_LIMITS,
  decodeXml,
  EncryptedError,
  inflateEntry,
  isCompoundFile,
  LimitError,
  partNumber,
  readZipDirectory,
  type InflateBudget,
  type ZipEntry,
  type ZipLimits,
} from './zip';

const DEFAULT_XLSX = { maxRows: 5_000, maxCells: 200_000 };
/** CSV'de bir bölüm bu kadar satır. */
const CSV_ROWS_PER_SECTION = 200;
/** İşçinin kendi baytı: ana süreç de denetler; bu son ağdır. */
const MAX_FILE_BYTES = 60 * 1024 * 1024;
/** Görüntüsü üretilecek en çok sayfa (derin beyne gider). */
const MAX_RENDER_PAGES = 3;

class ParseFailure extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** Metni bütçeyle biriktirir: bütçeyi aşan kısım tutulmaz ama sayılır (`total` gerçek uzunluk). */
class Collector {
  total = 0;
  private kept = 0;
  constructor(private readonly budget: number) {}
  /** Bütçeye sığan kısmı döndürür (boş olabilir); hepsini sayar. */
  take(text: string): string {
    if (!text) return '';
    this.total += text.length;
    const room = this.budget - this.kept;
    if (room <= 0) return '';
    const kept = text.length <= room ? text : text.slice(0, room);
    this.kept += kept.length;
    return kept;
  }
  get full(): boolean {
    return this.kept >= this.budget;
  }
  get truncated(): boolean {
    return this.total > this.kept;
  }
}

/** Bölüm listesi: bütçe dolunca kalan bölümler eklenmez, yalnız sayılır. */
class Sections {
  readonly list: DocSection[] = [];
  constructor(private readonly collector: Collector) {}
  add(kind: DocSection['kind'], label: string, index: number, text: string): void {
    const kept = this.collector.take(text);
    if (kept || (!this.collector.full && !text)) this.list.push({ kind, label, index, text: kept });
  }
}

export function formatOf(file: string): DocFormat | 'legacy' | null {
  const extension = path.extname(file).toLowerCase().slice(1);
  switch (extension) {
    case 'pdf':
      return 'pdf';
    case 'docx':
    case 'docm':
      return 'docx';
    case 'xlsx':
    case 'xlsm':
      return 'xlsx';
    case 'pptx':
    case 'pptm':
      return 'pptx';
    case 'csv':
    case 'tsv':
      return 'csv';
    case 'eml':
      return 'eml';
    case 'doc':
    case 'xls':
    case 'ppt':
      return 'legacy';
    case 'txt':
    case 'md':
    case 'markdown':
    case 'log':
    case 'json':
    case 'xml':
    case 'html':
    case 'htm':
    case 'yaml':
    case 'yml':
    case 'ini':
    case 'rtf':
      return 'text';
    default:
      return CODE_EXTENSIONS.has(extension) ? 'text' : null;
  }
}

/** Düz metin olarak okunan kod dosyaları (`../formats.ts` › `CODE_EXTENSIONS` ile aynı). */
const CODE_EXTENSIONS = new Set(
  'ts tsx js jsx mjs cjs py java kt kts c h cc cpp hpp cs go rs rb php swift m scala dart lua r sql sh bash zsh ps1 psm1 bat cmd css scss sass less vue svelte astro gradle toml proto graphql tf jsonl'.split(' '),
);

// ───────────────────────── metin kodlaması ─────────────────────────

/** UTF-8 (BOM'lu ya da değil), UTF-16 ya da Türkçe Windows kod sayfası (1254). */
export function decodeText(buffer: Buffer): string {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return new TextDecoder('utf-16le').decode(buffer.subarray(2));
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) return new TextDecoder('utf-16be').decode(buffer.subarray(2));
  const start = buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf ? 3 : 0;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(start));
  } catch {
    try {
      return new TextDecoder('windows-1254').decode(buffer);
    } catch {
      return new TextDecoder('latin1').decode(buffer);
    }
  }
}

const clean = (text: string): string => text.replace(/\r\n?/g, '\n').replace(/[\t ]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

// ───────────────────────── Office üstverisi ─────────────────────────

async function officeMeta(buffer: Buffer, entries: ZipEntry[], budget: InflateBudget): Promise<{ title: string | null; meta: DocMeta }> {
  const core = entries.find((entry) => entry.name === 'docProps/core.xml');
  if (!core) return { title: null, meta: {} };
  const xml = (await inflateEntry(buffer, core, budget)).toString('utf8');
  const tag = (name: string) => {
    const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml);
    return match ? decodeXml(match[1] ?? '').trim() : '';
  };
  const meta: DocMeta = {};
  const author = tag('dc:creator');
  if (author) meta.author = author;
  const subject = tag('dc:subject');
  if (subject) meta.subject = subject;
  const created = tag('dcterms:created');
  if (created) meta.created = created;
  const modified = tag('dcterms:modified');
  if (modified) meta.modified = modified;
  return { title: tag('dc:title') || null, meta };
}

// ───────────────────────── Word ─────────────────────────

/** `<w:tbl>` bloklarını iç içe derinliği izleyerek bulur (tembel düzenli ifade iç içe tabloda yanlış yerde biter). */
function extractBlocks(xml: string, open: RegExp, close: string): { text: string; blocks: string[] } {
  const blocks: string[] = [];
  let out = '';
  let depth = 0;
  let blockStart = -1;
  let cursor = 0;
  const pattern = new RegExp(`${open.source}|${close.replace(/[/]/g, '\\/')}`, 'g');
  for (let match = pattern.exec(xml); match; match = pattern.exec(xml)) {
    const isClose = match[0] === close;
    if (!isClose) {
      if (depth === 0) {
        out += xml.slice(cursor, match.index);
        blockStart = match.index;
      }
      depth++;
    } else if (depth > 0) {
      depth--;
      if (depth === 0) {
        const end = match.index + close.length;
        blocks.push(xml.slice(blockStart, end));
        out += `\u0000T${blocks.length - 1}\u0000`;
        cursor = end;
      }
    }
  }
  out += depth > 0 ? xml.slice(blockStart) : xml.slice(cursor);
  return { text: out, blocks };
}

function wordRuns(xml: string): string {
  return [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:(tab|br|cr)\b[^>]*\/>/g)]
    .map((match) => (match[2] === 'tab' ? '\t' : match[2] ? '\n' : decodeXml(match[1] ?? '')))
    .join('');
}

const HEADING_STYLE = /<w:pStyle\s+w:val="(?:Heading|heading|Başlık|Baslik|Title|Konu|KonuBal)[^"]*"/;

function wordTable(xml: string): string {
  const rows: string[] = [];
  for (const row of xml.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)) {
    const cells = [...row[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)].map((cell) =>
      cell[0]
        .split(/<\/w:p>/)
        .map(wordRuns)
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
    );
    if (cells.some(Boolean)) rows.push(cells.join(' | '));
  }
  return rows.join('\n');
}

async function parseDocx(buffer: Buffer, collector: Collector, limits: ZipLimits) {
  const entries = readZipDirectory(buffer, limits);
  const budget: InflateBudget = { left: limits.maxInflated };
  const body = entries.find((entry) => entry.name === 'word/document.xml');
  if (!body) throw new ParseFailure('corrupt', 'Word belgesi değil (word/document.xml yok).');
  const { title, meta } = await officeMeta(buffer, entries, budget);
  const xml = (await inflateEntry(buffer, body, budget)).toString('utf8');
  const { text, blocks } = extractBlocks(xml, /<w:tbl[\s>]/, '</w:tbl>');
  const sections = new Sections(collector);
  let label = 'Belge';
  let buffered: string[] = [];
  let index = 1;
  const flush = (final = false) => {
    // Yalnız başlıktan oluşan bölüm (belge başlığı, ardından alt başlık) ayrı parça olmaz: sonrakiyle birleşir.
    if (!final && buffered.length > 0 && buffered.every((line) => line.startsWith('# '))) return;
    const joined = clean(buffered.join('\n'));
    if (joined) sections.add('part', label, index++, joined);
    buffered = [];
  };
  for (const match of text.matchAll(/<w:p\b[^>]*?(?:\/>|>[\s\S]*?<\/w:p>)|\u0000T(\d+)\u0000/g)) {
    if (collector.full) {
      collector.take(match[0].replace(/<[^>]+>/g, ''));
      continue;
    }
    if (match[1] !== undefined) {
      const table = wordTable(blocks[Number(match[1])] ?? '');
      if (table) buffered.push(table, '');
      continue;
    }
    const line = wordRuns(match[0]).trim();
    if (!line) continue;
    if (HEADING_STYLE.test(match[0])) {
      flush();
      label = line.length > 60 ? `${line.slice(0, 59)}…` : line;
      buffered.push(`# ${line}`);
      continue;
    }
    buffered.push(line);
  }
  flush(true);
  return { title, meta, sections: sections.list };
}

// ───────────────────────── PowerPoint ─────────────────────────

function drawingText(xml: string): string {
  const { text, blocks } = extractBlocks(xml, /<a:tbl[\s>]/, '</a:tbl>');
  const lines: string[] = [];
  for (const match of text.matchAll(/<a:p\b[\s\S]*?<\/a:p>|\u0000T(\d+)\u0000/g)) {
    if (match[1] !== undefined) {
      const table = blocks[Number(match[1])] ?? '';
      for (const row of table.matchAll(/<a:tr\b[\s\S]*?<\/a:tr>/g)) {
        const cells = [...row[0].matchAll(/<a:tc\b[\s\S]*?<\/a:tc>/g)].map((cell) =>
          [...cell[0].matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map((t) => decodeXml(t[1] ?? '')).join(' ').trim(),
        );
        if (cells.some(Boolean)) lines.push(cells.join(' | '));
      }
      continue;
    }
    const line = [...match[0].matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map((t) => decodeXml(t[1] ?? '')).join('');
    if (line.trim()) lines.push(line);
  }
  return lines.join('\n');
}

async function parsePptx(buffer: Buffer, collector: Collector, limits: ZipLimits) {
  const entries = readZipDirectory(buffer, limits);
  const budget: InflateBudget = { left: limits.maxInflated };
  const { title, meta } = await officeMeta(buffer, entries, budget);
  const slides = entries.filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry.name)).sort((a, b) => partNumber(a.name) - partNumber(b.name));
  if (slides.length === 0 && !entries.some((entry) => entry.name === 'ppt/presentation.xml')) {
    throw new ParseFailure('corrupt', 'PowerPoint sunusu değil (ppt/presentation.xml yok).');
  }
  const notes = new Map(entries.filter((entry) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(entry.name)).map((entry) => [partNumber(entry.name), entry]));
  const sections = new Sections(collector);
  let skipped = 0;
  let firstTitle: string | null = null;
  for (const slide of slides) {
    if (collector.full) {
      skipped++;
      continue;
    }
    const number = partNumber(slide.name);
    const text = drawingText((await inflateEntry(buffer, slide, budget)).toString('utf8'));
    firstTitle ??= text.split('\n')[0]?.trim() || null;
    const noteEntry = notes.get(number);
    const note = noteEntry ? drawingText((await inflateEntry(buffer, noteEntry, budget)).toString('utf8')).replace(/^\d+$/gm, '').trim() : '';
    sections.add('slide', `Slayt ${number}`, number, `${text || '(metin yok)'}${note ? `\n\nKonuşmacı notu: ${note}` : ''}`);
  }
  meta.pages = slides.length;
  return {
    title: title ?? firstTitle,
    meta,
    sections: sections.list,
    ...(skipped ? { note: `Sınıra ulaşıldı: son ${skipped} slayt okunmadı.` } : {}),
  };
}

// ───────────────────────── Excel ─────────────────────────

/** Yerleşik tarih biçimleri (ECMA-376 §18.8.30). */
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 22, 27, 30, 36, 45, 46, 47, 50, 57]);
const BUILTIN_TIME_FORMATS = new Set([18, 19, 20, 21]);

function isDateCode(code: string): boolean {
  const stripped = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
  return /[dy]/i.test(stripped) || /m{3,}/i.test(stripped);
}

/** Excel seri günü → "2026-11-26" (saat varsa "2026-11-26 14:30"). 1900 artık yıl hatası 30.12.1899 tabanıyla düzelir. */
export function excelSerialToText(serial: number, date1904: boolean, withTime: boolean): string {
  const ms = Date.UTC(1899, 11, 30) + (serial + (date1904 ? 1462 : 0)) * 86_400_000;
  const date = new Date(Math.round(ms / 60_000) * 60_000);
  const day = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
  if (!withTime) return day;
  return `${day} ${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
}

async function parseXlsx(buffer: Buffer, collector: Collector, limits: ZipLimits, caps: { maxRows: number; maxCells: number }) {
  const entries = readZipDirectory(buffer, limits);
  const budget: InflateBudget = { left: limits.maxInflated };
  const find = (name: string) => entries.find((entry) => entry.name === name);
  const workbook = find('xl/workbook.xml');
  if (!workbook) throw new ParseFailure('corrupt', 'Excel çalışma kitabı değil (xl/workbook.xml yok).');
  const { title, meta } = await officeMeta(buffer, entries, budget);
  const shared: string[] = [];
  const sharedEntry = find('xl/sharedStrings.xml');
  if (sharedEntry) {
    const xml = (await inflateEntry(buffer, sharedEntry, budget)).toString('utf8');
    for (const match of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      shared.push([...(match[1] ?? '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => decodeXml(t[1] ?? '')).join(''));
      if (shared.length > caps.maxCells * 2) break;
    }
  }
  // Hücre biçimleri: tarih biçimli hücrenin seri sayısı gün olarak yazılır.
  const styleKinds: Array<'date' | 'time' | null> = [];
  const stylesEntry = find('xl/styles.xml');
  if (stylesEntry) {
    const xml = (await inflateEntry(buffer, stylesEntry, budget)).toString('utf8');
    const custom = new Map<number, string>();
    for (const match of xml.matchAll(/<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) custom.set(Number(match[1]), decodeXml(match[2] ?? ''));
    const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] ?? '';
    for (const match of xfs.matchAll(/<xf\b([^>]*)/g)) {
      const id = Number(/numFmtId="(\d+)"/.exec(match[1] ?? '')?.[1] ?? 0);
      const code = custom.get(id);
      if (BUILTIN_DATE_FORMATS.has(id) || (code !== undefined && isDateCode(code))) styleKinds.push(code && /h/i.test(code) ? 'time' : 'date');
      else if (BUILTIN_TIME_FORMATS.has(id)) styleKinds.push('time');
      else styleKinds.push(null);
    }
  }
  const workbookXml = (await inflateEntry(buffer, workbook, budget)).toString('utf8');
  const date1904 = /<workbookPr\b[^>]*date1904="(?:1|true)"/.test(workbookXml);
  const names = [...workbookXml.matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)].map((match) => decodeXml(match[1] ?? ''));
  const sheets = entries.filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/.test(entry.name)).sort((a, b) => partNumber(a.name) - partNumber(b.name));
  const sections = new Sections(collector);
  const notes: string[] = [];
  let cells = 0;
  for (const [index, sheet] of sheets.entries()) {
    const name = names[index] ?? `Sayfa ${index + 1}`;
    if (collector.full || cells >= caps.maxCells) {
      notes.push(`"${name}" okunmadı`);
      continue;
    }
    const xml = (await inflateEntry(buffer, sheet, budget)).toString('utf8');
    const lines: string[] = [];
    let rows = 0;
    const rowPattern = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
    for (let row = rowPattern.exec(xml); row; row = rowPattern.exec(xml)) {
      if (rows >= caps.maxRows || cells >= caps.maxCells) {
        notes.push(`"${name}" ilk ${rows.toLocaleString('tr-TR')} satırla kesildi`);
        break;
      }
      rows++;
      const values: string[] = [];
      for (const cell of (row[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        cells++;
        const attributes = cell[1] ?? '';
        const type = /\bt="([^"]+)"/.exec(attributes)?.[1];
        const style = Number(/\bs="(\d+)"/.exec(attributes)?.[1] ?? -1);
        const inner = cell[2] ?? '';
        const raw = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        let value = '';
        if (type === 's') value = shared[Number(raw)] ?? '';
        else if (type === 'inlineStr') value = [...inner.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => decodeXml(t[1] ?? '')).join('');
        else if (type === 'b') value = raw === '1' ? 'DOĞRU' : 'YANLIŞ';
        else if (type === 'e') value = raw ? `#${decodeXml(raw).replace(/^#/, '')}` : '';
        else if (raw !== undefined) {
          const kind = style >= 0 ? styleKinds[style] : null;
          const number = Number(raw);
          value = kind && Number.isFinite(number) && (type === undefined || type === 'n') ? excelSerialToText(number, date1904, kind === 'time') : decodeXml(raw);
        }
        // Boş hücreler sütun hizasını korusun diye yerinde kalır; satır sonundaki boşluklar atılır.
        const reference = /\br="([A-Z]+)\d+"/.exec(attributes)?.[1];
        if (reference) {
          const column = columnIndex(reference);
          while (values.length < column) values.push('');
        }
        values.push(value.replace(/[\t\r\n]+/g, ' ').trim());
      }
      while (values.length && !values[values.length - 1]) values.pop();
      if (values.length) lines.push(values.join(' | '));
    }
    sections.add('sheet', `Sayfa: ${name}`, index + 1, lines.join('\n') || '(boş sayfa)');
  }
  meta.pages = sheets.length;
  return {
    title,
    meta,
    sections: sections.list,
    ...(notes.length ? { note: `Sınıra ulaşıldı: ${notes.slice(0, 3).join('; ')}${notes.length > 3 ? ` (+${notes.length - 3})` : ''}.` } : {}),
  };
}

/** "A" → 0, "Z" → 25, "AA" → 26. */
function columnIndex(letters: string): number {
  let value = 0;
  for (const letter of letters) value = value * 26 + (letter.charCodeAt(0) - 64);
  return value - 1;
}

// ───────────────────────── CSV ─────────────────────────

/** Ayırıcıyı ilk satırlardan seçer: tırnak dışındaki `;`, `,` ya da sekme sayısı. */
function detectDelimiter(text: string): string {
  const sample = text.split('\n').slice(0, 10);
  let best = ',';
  let bestScore = -1;
  for (const candidate of [';', ',', '\t', '|']) {
    const counts = sample.map((line) => {
      let quoted = false;
      let count = 0;
      for (const ch of line) {
        if (ch === '"') quoted = !quoted;
        else if (ch === candidate && !quoted) count++;
      }
      return count;
    });
    const nonZero = counts.filter((count) => count > 0);
    const score = nonZero.length ? nonZero.length * 10 + Math.min(...nonZero) : 0;
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

export function parseCsvRows(text: string, delimiter = detectDelimiter(text)): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === '') quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim()));
}

function parseCsv(buffer: Buffer, collector: Collector, extension: string) {
  const text = decodeText(buffer);
  const rows = parseCsvRows(text, extension === 'tsv' ? '\t' : undefined);
  const sections = new Sections(collector);
  const header = rows[0]?.map((cell) => cell.trim()).join(' | ') ?? '';
  for (let start = 0; start < rows.length; start += CSV_ROWS_PER_SECTION) {
    const slice = rows.slice(start, start + CSV_ROWS_PER_SECTION).map((cells) => cells.map((cell) => cell.replace(/\s+/g, ' ').trim()).join(' | '));
    // Sonraki bölümler de sütun adlarını taşısın: parça tek başına okunduğunda anlaşılır kalsın.
    const body = start === 0 ? slice.join('\n') : `${header}\n${slice.join('\n')}`;
    const end = Math.min(rows.length, start + CSV_ROWS_PER_SECTION);
    sections.add('sheet', `Satır ${start + 1}–${end}`, start / CSV_ROWS_PER_SECTION + 1, body);
  }
  return { title: null, meta: { pages: Math.max(1, Math.ceil(rows.length / CSV_ROWS_PER_SECTION)) }, sections: sections.list };
}

// ───────────────────────── düz metin ─────────────────────────

function parsePlain(buffer: Buffer, collector: Collector, extension: string) {
  let text = decodeText(buffer);
  if (extension === 'html' || extension === 'htm') {
    text = text
      .replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ');
    text = decodeXml(text).replace(/&nbsp;/g, ' ');
  } else if (extension === 'rtf') {
    text = text
      .replace(/\\par[d]?/g, '\n')
      .replace(/\\'([0-9a-f]{2})/gi, (_match, hex: string) => new TextDecoder('windows-1254').decode(Uint8Array.of(Number.parseInt(hex, 16))))
      .replace(/\\u(-?\d+)\??/g, (_match, code: string) => String.fromCharCode((Number(code) + 65_536) % 65_536))
      .replace(/\\[a-z]+-?\d* ?/gi, '')
      .replace(/[{}]/g, '');
  }
  const body = clean(text);
  const sections = new Sections(collector);
  sections.add('part', 'Metin', 1, body);
  const heading = /^#\s+(.+)$/m.exec(body)?.[1]?.trim() ?? null;
  return { title: extension === 'md' || extension === 'markdown' ? heading : null, meta: {}, sections: sections.list };
}

// ───────────────────────── e-posta ─────────────────────────

async function parseEml(buffer: Buffer, collector: Collector) {
  const { simpleParser } = await import('mailparser');
  const mail = await simpleParser(buffer, { skipHtmlToText: false, skipImageLinks: true, skipTextLinks: true });
  const addresses = (value: unknown): string => {
    if (!value) return '';
    const list = Array.isArray(value) ? value : [value];
    return list.map((item) => (item as { text?: string }).text ?? '').filter(Boolean).join(', ');
  };
  const from = addresses(mail.from);
  const to = addresses(mail.to);
  const valid = mail.date && !Number.isNaN(mail.date.getTime()) ? mail.date : null;
  const date = valid ? valid.toISOString() : '';
  const pad = (n: number) => String(n).padStart(2, '0');
  // Gövdede bu bilgisayarın saatine göre; üstveride ISO.
  const local = valid ? `${valid.getFullYear()}-${pad(valid.getMonth() + 1)}-${pad(valid.getDate())} ${pad(valid.getHours())}:${pad(valid.getMinutes())}` : '';
  const attachments = (mail.attachments ?? []).map((attachment) => attachment.filename ?? '(adsız ek)').slice(0, 20);
  const head = [`Kimden: ${from}`, `Kime: ${to}`, `Tarih: ${local}`, `Konu: ${mail.subject ?? ''}`];
  if (attachments.length) head.push(`Ekler (içerikleri okunmadı): ${attachments.join(', ')}`);
  const body = clean(mail.text ?? '');
  const sections = new Sections(collector);
  sections.add('email', 'E-posta', 1, `${head.join('\n')}\n\n${body}`);
  const meta: DocMeta = {};
  if (from) meta.from = from;
  if (to) meta.to = to;
  if (date) meta.date = date;
  if (attachments.length) meta.attachments = attachments;
  return { title: mail.subject?.trim() || null, meta, sections: sections.list };
}

// ───────────────────────── PDF ─────────────────────────

interface PdfParser {
  getText(params?: { partial?: number[] }): Promise<{ pages: Array<{ num: number; text: string }>; total: number }>;
  getInfo(): Promise<{ total: number; info?: Record<string, unknown> }>;
  getScreenshot(params?: { partial?: number[]; scale?: number; imageBuffer?: boolean; imageDataUrl?: boolean }): Promise<{
    pages: Array<{ data: Uint8Array; pageNumber: number }>;
  }>;
  destroy(): Promise<void>;
}

async function parsePdf(buffer: Buffer, collector: Collector, renderPages: number[] | undefined) {
  if (buffer.subarray(0, 1024).indexOf('%PDF') < 0) throw new ParseFailure('corrupt', 'PDF değil (dosya başlığı tutmuyor).');
  // pdf.js, Electron'un yardımcı süreçlerini (process.type 'utility') tarayıcı sanıp DOM arar; bu süreç Node'dur.
  const proc = process as unknown as { type?: string };
  if (proc.type === 'utility') {
    try {
      Object.defineProperty(process, 'type', { value: 'browser', configurable: true });
    } catch {
      // salt okunursa pdf.js yine Node yolunu dener
    }
  }
  const { PDFParse } = (await import('pdf-parse')) as unknown as { PDFParse: new (options: Record<string, unknown>) => PdfParser };
  const parser = new PDFParse({ data: new Uint8Array(buffer), isEvalSupported: false, enableXfa: false, verbosity: 0, stopAtErrors: false });
  try {
    let info: Awaited<ReturnType<PdfParser['getInfo']>>;
    try {
      info = await parser.getInfo();
    } catch (error) {
      throw pdfFailure(error);
    }
    const result = await parser.getText().catch((error: unknown) => {
      throw pdfFailure(error);
    });
    const sections = new Sections(collector);
    const empty: number[] = [];
    let meaningful = 0;
    for (const page of result.pages) {
      const text = clean(page.text ?? '');
      const visible = text.replace(/\s+/g, '').length;
      meaningful += visible;
      if (visible < 8) empty.push(page.num);
      sections.add('page', `Sayfa ${page.num}`, page.num, text);
    }
    const pages = info.total || result.total || result.pages.length;
    const scanned = meaningful < Math.max(20, pages * 10);
    const raw = info.info ?? {};
    const meta: DocMeta = { pages };
    const read = (key: string) => (typeof raw[key] === 'string' ? (raw[key] as string).trim() : '');
    if (read('Author')) meta.author = read('Author');
    if (read('Subject')) meta.subject = read('Subject');
    const created = pdfDate(read('CreationDate'));
    if (created) meta.created = created;
    let images: PageImage[] | undefined;
    if (renderPages?.length) {
      const wanted = [...new Set(renderPages)].filter((page) => page >= 1 && page <= pages).slice(0, MAX_RENDER_PAGES);
      if (wanted.length) {
        try {
          const shots = await parser.getScreenshot({ partial: wanted, scale: 1.5, imageBuffer: true, imageDataUrl: false });
          images = shots.pages.map((shot) => ({ page: shot.pageNumber, mediaType: 'image/png' as const, data: Buffer.from(shot.data).toString('base64') }));
        } catch {
          images = [];
        }
      }
    }
    const note = !scanned && empty.length ? `${empty.length} sayfada metin yok (taranmış olabilir): ${empty.slice(0, 8).join(', ')}${empty.length > 8 ? '…' : ''}.` : undefined;
    return {
      title: read('Title') || null,
      meta,
      sections: sections.list,
      scanned,
      ...(note ? { note } : {}),
      ...(images ? { images } : {}),
    };
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

function pdfFailure(error: unknown): ParseFailure {
  const name = (error as { name?: string })?.name ?? '';
  const message = String((error as Error)?.message ?? error);
  if (name === 'PasswordException' || /password/i.test(message)) return new ParseFailure('encrypted', 'PDF parolalı; parola olmadan okunamıyor.');
  if (name === 'InvalidPDFException' || /invalid pdf/i.test(message)) return new ParseFailure('corrupt', 'PDF bozuk ya da geçersiz.');
  return new ParseFailure('corrupt', `PDF okunamadı: ${message.slice(0, 160)}`);
}

/** "D:20261116093000+03'00'" → ISO. */
function pdfDate(value: string): string | null {
  const match = /^D?:?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(value);
  if (!match) return null;
  const [, y, mo = '01', d = '01', h = '00', mi = '00', s = '00'] = match;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}`;
}

// ───────────────────────── giriş ─────────────────────────

export async function parseDocument(request: ParseRequest): Promise<ParseResponse> {
  const format = formatOf(request.path);
  const extension = path.extname(request.path).toLowerCase().slice(1);
  if (format === null) return { ok: false, code: 'unsupported', error: `Bu dosya türü okunmuyor: .${extension || '?'}` };
  if (format === 'legacy') {
    const modern = extension === 'doc' ? '.docx' : extension === 'xls' ? '.xlsx' : '.pptx';
    return { ok: false, code: 'legacy', error: `Eski Office biçimi (.${extension}) okunmuyor; ${modern} olarak kaydedip yeniden deneyin.` };
  }
  const collector = new Collector(Math.max(1, request.maxChars));
  const limits = request.zip ?? DEFAULT_ZIP_LIMITS;
  try {
    const stat = fs.statSync(request.path);
    if (!stat.isFile()) return { ok: false, code: 'corrupt', error: 'Bu yol bir dosya değil.' };
    if (stat.size === 0) return { ok: false, code: 'corrupt', error: 'Dosya boş (0 bayt).' };
    if (stat.size > MAX_FILE_BYTES) return { ok: false, code: 'limit', error: `dosya ${Math.round(stat.size / 1024 / 1024)} MB; en çok ${MAX_FILE_BYTES / 1024 / 1024} MB okunur` };
    const buffer = fs.readFileSync(request.path);
    if ((format === 'docx' || format === 'xlsx' || format === 'pptx') && isCompoundFile(buffer)) {
      const encrypted = buffer.includes(Buffer.from('EncryptedPackage', 'utf16le')) || buffer.includes(Buffer.from('EncryptionInfo', 'utf16le'));
      return encrypted
        ? { ok: false, code: 'encrypted', error: 'Dosya parolayla korunuyor; parola olmadan okunamıyor.' }
        : { ok: false, code: 'legacy', error: 'Dosya eski Office biçiminde (uzantısı yeni); Word/Excel/PowerPoint’te yeni biçimde kaydedip deneyin.' };
    }
    let result: { title: string | null; meta: DocMeta; sections: DocSection[]; note?: string; scanned?: boolean; images?: PageImage[] };
    if (format === 'pdf') result = await parsePdf(buffer, collector, request.renderPages);
    else if (format === 'docx') result = await parseDocx(buffer, collector, limits);
    else if (format === 'pptx') result = await parsePptx(buffer, collector, limits);
    else if (format === 'xlsx') result = await parseXlsx(buffer, collector, limits, request.xlsx ?? DEFAULT_XLSX);
    else if (format === 'csv') result = parseCsv(buffer, collector, extension);
    else if (format === 'eml') result = await parseEml(buffer, collector);
    else result = parsePlain(buffer, collector, extension);
    return {
      ok: true,
      format,
      title: result.title,
      sections: result.sections,
      totalChars: collector.total,
      truncated: collector.truncated,
      meta: result.meta,
      ...(result.scanned ? { scanned: true } : {}),
      ...(result.note ? { note: result.note } : {}),
      ...(result.images ? { images: result.images } : {}),
    };
  } catch (error) {
    if (error instanceof ParseFailure) return { ok: false, code: error.code, error: error.message };
    if (error instanceof LimitError) return { ok: false, code: 'limit', error: error.message };
    if (error instanceof EncryptedError) return { ok: false, code: 'encrypted', error: error.message };
    return { ok: false, code: 'corrupt', error: String((error as Error)?.message ?? error).slice(0, 200) };
  }
}
