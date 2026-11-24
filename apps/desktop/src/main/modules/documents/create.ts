/**
 * Belge üretimi (v1 `belge-uret.ts`ten uyarlandı): Word/Excel/PowerPoint belge işçisinde, PDF Electron'un yazdırma
 * motoruyla (görünmeyen, JavaScript'i ve ağı kapalı, kalıcı olmayan bölümlü bir sayfa). Yazım atomiktir: yan dosyaya
 * yazılır, sonra yerine taşınır; yarım belge bırakılmaz.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import nodePath from 'node:path';
import type { ValidContent } from './schema';
import type { DocWorker } from './worker-client';
import type { SheetContent, SlideContent, TextContent } from './worker/protocol';

/** `target`a atomik yazar (klasörü gerekirse oluşturur); hata olursa yan dosya silinir, hedef değişmez. */
export function writeAtomic(target: string, data: Uint8Array): void {
  fs.mkdirSync(nodePath.dirname(target), { recursive: true });
  const side = `${target}.fuber-tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  try {
    fs.writeFileSync(side, data, { flag: 'wx' });
    fs.renameSync(side, target);
  } catch (error) {
    try {
      fs.unlinkSync(side);
    } catch {
      // yan dosya hiç oluşmadı
    }
    throw error;
  }
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escape = (value: string): string => value.replace(/[&<>"']/g, (ch) => ESCAPES[ch]!);
const body = (value: string): string => escape(value).replace(/\r?\n/g, '<br>');

const CSS = `@page { size: A4; margin: 20mm 18mm; }
html { font-family: "Segoe UI", Calibri, Arial, sans-serif; font-size: 11pt; color: #111; line-height: 1.5; }
body { margin: 0; }
h1 { font-size: 22pt; margin: 0 0 14pt; }
h2 { font-size: 15pt; margin: 18pt 0 6pt; page-break-after: avoid; }
p { margin: 0 0 8pt; }
table { border-collapse: collapse; width: 100%; margin: 6pt 0 12pt; }
th, td { border: 1px solid #888; padding: 4pt 6pt; text-align: left; vertical-align: top; }
th { background: #eee; }
tr { page-break-inside: avoid; }
.slide { page-break-after: always; }
.slide:last-child { page-break-after: auto; }`;

function tableHtml(rows: Array<Array<string | number>>): string {
  if (!rows.length) return '';
  const [head = [], ...rest] = rows;
  const cell = (tag: string) => (value: string | number) => `<${tag}>${body(String(value))}</${tag}>`;
  return `<table><thead><tr>${head.map(cell('th')).join('')}</tr></thead><tbody>${rest.map((row) => `<tr>${row.map(cell('td')).join('')}</tr>`).join('')}</tbody></table>`;
}

/** Belgeyi tek HTML sayfasına çevirir (PDF için). Her metin kaçışlanır; CSP betiği ve ağı kapatır. */
export function documentHtml(valid: ValidContent): string {
  let content = '';
  let title = 'Belge';
  if (valid.format === 'xlsx') {
    for (const sheet of (valid.content as SheetContent).sheets) content += `<h2>${escape(sheet.name)}</h2>${tableHtml(sheet.rows)}`;
  } else if (valid.format === 'pptx') {
    const deck = valid.content as SlideContent;
    if (deck.title) title = deck.title;
    for (const slide of deck.slides) {
      content += `<section class="slide"><h1>${escape(slide.title)}</h1>${slide.bullets.length ? `<ul>${slide.bullets.map((bullet) => `<li>${body(bullet)}</li>`).join('')}</ul>` : ''}</section>`;
    }
  } else {
    const doc = valid.content as TextContent;
    if (doc.title) {
      title = doc.title;
      content += `<h1>${escape(doc.title)}</h1>`;
    }
    for (const section of doc.sections) {
      if (section.heading) content += `<h2>${escape(section.heading)}</h2>`;
      for (const paragraph of section.paragraphs ?? []) content += `<p>${body(paragraph)}</p>`;
      if (section.table?.length) content += tableHtml(section.table);
    }
  }
  return (
    `<!DOCTYPE html>\n<html lang="tr"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">` +
    `<title>${escape(title)}</title><style>${CSS}</style></head><body>${content}</body></html>`
  );
}

const PDF_TIMEOUT_MS = 30_000;

/**
 * HTML'i PDF'e basar. Pencere HİÇ gösterilmez (yalnız yazdırma yüzeyi; `createWindow` uygulama sayfası yükler, bu
 * yüzden kullanılmaz): kalıcı olmayan bölüm, JavaScript kapalı, kum havuzu açık, yalnız kendi geçici dosyasına istek.
 */
export async function electronPdf(html: string, tempDir = os.tmpdir()): Promise<Uint8Array> {
  const { BrowserWindow, session } = await import('electron');
  fs.mkdirSync(tempDir, { recursive: true });
  const file = nodePath.join(tempDir, `fuber-belge-${crypto.randomBytes(6).toString('hex')}.html`);
  fs.writeFileSync(file, html, 'utf8');
  const url = new URL(`file:///${file.replace(/\\/g, '/')}`).href;
  const partition = session.fromPartition(`fuber-pdf-${crypto.randomBytes(4).toString('hex')}`);
  partition.webRequest.onBeforeRequest((details, callback) => callback({ cancel: details.url !== url }));
  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    skipTaskbar: true,
    focusable: false,
    webPreferences: { session: partition, javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, spellcheck: false },
  });
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const print = (async () => {
      await win.loadURL(url);
      return win.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true });
    })();
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('PDF hazırlanırken zaman aşımı')), PDF_TIMEOUT_MS);
    });
    return new Uint8Array(await Promise.race([print, timeout]));
  } finally {
    if (timer) clearTimeout(timer);
    if (!win.isDestroyed()) win.destroy();
    try {
      fs.unlinkSync(file);
    } catch {
      // geçici dosya zaten yok
    }
  }
}

/** Belgeyi üretip baytlarını döndürür. Geçersiz çıktıda fırlatır. */
export async function renderDocument(valid: ValidContent, deps: { worker: DocWorker; printPdf: (html: string) => Promise<Uint8Array>; signal?: AbortSignal }): Promise<Uint8Array> {
  if (valid.format === 'pdf') {
    const data = await deps.printPdf(documentHtml(valid));
    if (data.length < 8 || Buffer.from(data.subarray(0, 4)).toString('latin1') !== '%PDF') throw new Error('PDF üretilemedi (çıktı geçerli bir PDF değil)');
    return data;
  }
  const result = await deps.worker.generate(valid.format, valid.content, deps.signal ? { signal: deps.signal } : {});
  if (!result.ok) throw new Error(result.error);
  return result.data;
}
