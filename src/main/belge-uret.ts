// ── Belge üretimi (0.14 T17, R7) ─────────────────────────────────────────────────────────────────────────────────
// `belge_uret` aracının motoru: docx (`docx`), xlsx (`exceljs`, sunucuyla aynı kütüphane), pptx (`pptxgenjs`), pdf (Electron `printToPDF`: gizli
// pencere, kalıcı olmayan bölüm, JavaScript kapalı, ağ kapalı). İçerik biçimi ve doğrulama shared/belge-sema.ts'te. Yol denetimi (izinli klasör,
// onay) araçta (ajan/araclar/dosya-yaz.ts); burası verilen `hedef`e yazar. Yazım atomiktir: yan dosyaya yazılır, sonra yerine taşınır — yarım
// belge bırakılmaz. Paylaşılan shared dosyaları `.ts` uzantısıyla içe aktarılır: bu modül Electron'suz birim testte de yüklenir (tests/belge-uret.test.ts).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { belgeIstegiHatasi, belgeIstegiDogrula, type BelgeIstegi, type BelgeMetinIcerigi, type BelgeSunumIcerigi, type BelgeTabloIcerigi } from '../shared/belge-sema.ts';

const YAZI_TIPI = 'Calibri';

// ── Atomik yazım ─────────────────────────────────────────────────────────────────────────────────────────────────
/** `hedef`e yazar (klasörü gerekirse oluşturur): yan dosya + taşıma; hata olursa yan dosya silinir, hedef değişmez. */
export function atomikYaz(hedef: string, veri: Buffer | string): void {
  fs.mkdirSync(path.dirname(hedef), { recursive: true });
  const yan = `${hedef}.fuber-tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  try {
    fs.writeFileSync(yan, veri);
    fs.renameSync(yan, hedef);
  } catch (e) {
    try { fs.rmSync(yan, { force: true }); } catch { /* yan dosya zaten yok */ }
    throw e;
  }
}

// ── HTML (pdf) ───────────────────────────────────────────────────────────────────────────────────────────────────
const KACIS: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const kacis = (s: string): string => s.replace(/[&<>"']/g, (c) => KACIS[c]);
/** Paragraf metni: kaçışlanır, satır sonları <br>. */
const govde = (s: string): string => kacis(s).replace(/\r?\n/g, '<br>');

const CSS = `@page { size: A4; margin: 20mm 18mm; }
html { font-family: "Segoe UI", ${YAZI_TIPI}, Arial, sans-serif; font-size: 11pt; color: #111; line-height: 1.5; }
body { margin: 0; }
h1 { font-size: 22pt; margin: 0 0 14pt; }
h2 { font-size: 15pt; margin: 18pt 0 6pt; page-break-after: avoid; }
p { margin: 0 0 8pt; }
table { border-collapse: collapse; width: 100%; margin: 6pt 0 12pt; }
th, td { border: 1px solid #888; padding: 4pt 6pt; text-align: left; vertical-align: top; }
th { background: #eee; }
tr { page-break-inside: avoid; }
.slayt { page-break-after: always; }
.slayt:last-child { page-break-after: auto; }`;

function tabloHtml(satirlar: (string | number)[][]): string {
  if (!satirlar.length) return '';
  const [baslik, ...govdeSatirlari] = satirlar;
  const hucre = (etiket: string) => (h: string | number) => `<${etiket}>${govde(String(h))}</${etiket}>`;
  return `<table><thead><tr>${baslik.map(hucre('th')).join('')}</tr></thead><tbody>${govdeSatirlari.map((r) => `<tr>${r.map(hucre('td')).join('')}</tr>`).join('')}</tbody></table>`;
}

/** Belgeyi tek HTML sayfasına çevirir (pdf için). Her metin kaçışlanır (`<script>` düz metin olur); CSP betik ve ağı kapatır. */
export function belgeHtml(i: BelgeIstegi): string {
  let icerik = '';
  if (i.tur === 'xlsx') {
    for (const p of (i.icerik as BelgeTabloIcerigi).sayfalar) icerik += `<h2>${kacis(p.ad)}</h2>${tabloHtml(p.satirlar)}`;
  } else if (i.tur === 'pptx') {
    for (const s of (i.icerik as BelgeSunumIcerigi).slaytlar) icerik += `<section class="slayt"><h1>${kacis(s.baslik)}</h1>${s.maddeler.length ? `<ul>${s.maddeler.map((m) => `<li>${govde(m)}</li>`).join('')}</ul>` : ''}</section>`;
  } else {
    const c = i.icerik as BelgeMetinIcerigi;
    if (c.baslik) icerik += `<h1>${kacis(c.baslik)}</h1>`;
    for (const b of c.bolumler) {
      if (b.baslik) icerik += `<h2>${kacis(b.baslik)}</h2>`;
      for (const p of b.paragraflar ?? []) icerik += `<p>${govde(p)}</p>`;
      if (b.tablo?.length) icerik += tabloHtml(b.tablo);
    }
  }
  return `<!DOCTYPE html>\n<html lang="tr"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`
    + `<title>${kacis(i.tur === 'pdf' && (i.icerik as BelgeMetinIcerigi).baslik ? (i.icerik as BelgeMetinIcerigi).baslik! : 'Belge')}</title><style>${CSS}</style></head><body>${icerik}</body></html>`;
}

// ── docx ─────────────────────────────────────────────────────────────────────────────────────────────────────────
async function docxUret(c: BelgeMetinIcerigi): Promise<Buffer> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType } = await import('docx');
  /** Satır sonlu metin → TextRun dizisi (her satır sonu bir `break`). */
  const parcalar = (s: string, ek: { bold?: boolean } = {}) => s.split(/\r?\n/).map((satir, k) => new TextRun({ text: satir, break: k ? 1 : 0, ...ek }));
  const cocuklar: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = [];
  if (c.baslik) cocuklar.push(new Paragraph({ heading: HeadingLevel.TITLE, children: parcalar(c.baslik) }));
  for (const b of c.bolumler) {
    if (b.baslik) cocuklar.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: parcalar(b.baslik) }));
    for (const p of b.paragraflar ?? []) cocuklar.push(new Paragraph({ children: parcalar(p), spacing: { after: 120 } }));
    if (b.tablo?.length) {
      cocuklar.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: b.tablo.map((r, k) => new TableRow({
          tableHeader: k === 0,
          children: (r.length ? r : ['']).map((h) => new TableCell({ children: [new Paragraph({ children: parcalar(h, { bold: k === 0 }) })] })),
        })),
      }));
      cocuklar.push(new Paragraph({ children: [] })); // tablodan sonra boşluk (art arda tablolar birleşmesin)
    }
  }
  const doc = new Document({
    creator: 'Fuber',
    styles: { default: { document: { run: { font: YAZI_TIPI, size: 22 } } } },
    sections: [{ children: cocuklar.length ? cocuklar : [new Paragraph({ children: [] })] }],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

// ── xlsx ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Excel sayfa adı: yasak karakterler (\ / ? * [ ] :) boşluk olur, baştaki/sondaki ' atılır, en çok 31 karakter, büyük/küçük harf duyarsız tek. */
export function sayfaAdiTemizle(ad: string, kullanilan: Set<string>, sira: number): string {
  let a = ad.replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^'+|'+$/g, '').trim().slice(0, 31).trim() || `Sayfa ${sira}`;
  for (let n = 2; kullanilan.has(a.toLowerCase()); n++) {
    const son = ` (${n})`;
    a = `${a.slice(0, 31 - son.length).trim()}${son}`;
  }
  kullanilan.add(a.toLowerCase());
  return a;
}

async function xlsxUret(c: BelgeTabloIcerigi): Promise<Buffer> {
  const ExcelJS = (await import('exceljs')).default;
  const kitap = new ExcelJS.Workbook();
  kitap.creator = 'Fuber';
  kitap.created = new Date();
  const adlar = new Set<string>();
  c.sayfalar.forEach((s, k) => {
    const sayfa = kitap.addWorksheet(sayfaAdiTemizle(s.ad, adlar, k + 1));
    // '' boş hücre olur (Excel'de gerçekten boş); metin "=…" ile başlasa da metin kalır (formül nesnesi yalnız {formula} ile yazılır).
    sayfa.addRows(s.satirlar.map((r) => r.map((h) => (h === '' ? null : h))));
    if (s.satirlar.length) sayfa.getRow(1).font = { bold: true };
    const sutunSayisi = s.satirlar.reduce((m, r) => Math.max(m, r.length), 0);
    for (let j = 1; j <= sutunSayisi; j++) {
      const en = s.satirlar.reduce((m, r) => Math.max(m, String(r[j - 1] ?? '').split(/\r?\n/).reduce((x, l) => Math.max(x, [...l].length), 0)), 0);
      sayfa.getColumn(j).width = Math.min(60, Math.max(8, en + 2));
    }
  });
  return Buffer.from(await kitap.xlsx.writeBuffer());
}

// ── pptx ─────────────────────────────────────────────────────────────────────────────────────────────────────────
async function pptxUret(c: BelgeSunumIcerigi): Promise<Buffer> {
  const PptxGenJS = (await import('pptxgenjs')).default;
  const sunum = new PptxGenJS();
  sunum.layout = 'LAYOUT_WIDE'; // 13,33 × 7,5 inç
  sunum.author = 'Fuber';
  sunum.defineSlideMaster({
    title: 'FUBER',
    background: { color: 'FFFFFF' },
    objects: [
      { placeholder: { options: { name: 'baslik', type: 'title', x: 0.7, y: 0.45, w: 11.9, h: 1.1, fontFace: YAZI_TIPI, fontSize: 32, bold: true, color: '111111', valign: 'middle' }, text: '' } },
      { placeholder: { options: { name: 'govde', type: 'body', x: 0.7, y: 1.8, w: 11.9, h: 5.0, fontFace: YAZI_TIPI, fontSize: 22, color: '222222', valign: 'top' }, text: '' } },
    ],
  });
  for (const s of c.slaytlar) {
    const slayt = sunum.addSlide({ masterName: 'FUBER' });
    slayt.addText(s.baslik, { placeholder: 'baslik' });
    if (s.maddeler.length) {
      const kucuk = s.maddeler.length > 8;
      slayt.addText(s.maddeler.map((m) => ({ text: m, options: { bullet: true, breakLine: true, fontSize: kucuk ? 16 : 22 } })), { placeholder: 'govde' });
    }
  }
  const cikti = await sunum.write({ outputType: 'nodebuffer' });
  return Buffer.isBuffer(cikti) ? cikti : Buffer.from(cikti as ArrayBuffer);
}

// ── pdf (Electron) ───────────────────────────────────────────────────────────────────────────────────────────────
const PDF_ZAMAN_ASIMI_MS = 30_000;

/** HTML'i PDF'e basar: gizli pencere, kalıcı olmayan bölüm ('persist:' yok), JavaScript kapalı, kum havuzu açık, ağ ve gezinme kapalı.
 *  HTML geçici dosyaya yazılıp yüklenir (büyük belgede veri adresi sınırına takılmaz). */
async function electronPdf(html: string): Promise<Buffer> {
  const { BrowserWindow, session } = await import('electron');
  const gecici = path.join(os.tmpdir(), `fuber-belge-${crypto.randomBytes(6).toString('hex')}.html`);
  fs.writeFileSync(gecici, html, 'utf8');
  const adres = new URL(`file:///${gecici.replace(/\\/g, '/')}`).href;
  const oturum = session.fromPartition('fuber-belge'); // kalıcı olmayan bölüm: disk çerezi/önbelleği yok
  oturum.webRequest.onBeforeRequest((d, cb) => cb({ cancel: d.url !== adres }));
  const pencere = new BrowserWindow({
    show: false, width: 900, height: 1200, skipTaskbar: true,
    webPreferences: { session: oturum, javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, spellcheck: false },
  });
  pencere.webContents.on('will-navigate', (e) => e.preventDefault());
  pencere.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  let zaman: NodeJS.Timeout | undefined;
  try {
    const bas = (async () => {
      await pencere.loadURL(adres);
      return pencere.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true });
    })();
    const asim = new Promise<never>((_, red) => { zaman = setTimeout(() => red(new Error('PDF hazırlanırken zaman aşımı')), PDF_ZAMAN_ASIMI_MS); });
    return Buffer.from(await Promise.race([bas, asim]));
  } finally {
    if (zaman) clearTimeout(zaman);
    if (!pencere.isDestroyed()) pencere.destroy();
    try { fs.rmSync(gecici, { force: true }); } catch { /* geçici dosya zaten yok */ }
  }
}

// ── Giriş ────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface BelgeSecenek {
  /** HTML'den PDF üreten işlev (testte sahte; varsayılan Electron). */
  pdfYazici?: (html: string) => Promise<Buffer>;
}

/** Belgeyi üretip `hedef`e (mutlak yol; klasörü yoksa oluşturulur) atomik yazar. Geçersiz istekte atar, hedef değişmez. */
export async function belgeUret(i: BelgeIstegi, hedef: string, secenek: BelgeSecenek = {}): Promise<{ yol: string; boyut: number }> {
  const hata = belgeIstegiHatasi(i);
  if (hata) throw new Error(hata);
  const d = belgeIstegiDogrula(i)!;
  let veri: Buffer;
  if (d.tur === 'docx') veri = await docxUret(d.icerik as BelgeMetinIcerigi);
  else if (d.tur === 'xlsx') veri = await xlsxUret(d.icerik as BelgeTabloIcerigi);
  else if (d.tur === 'pptx') veri = await pptxUret(d.icerik as BelgeSunumIcerigi);
  else {
    veri = await (secenek.pdfYazici ?? electronPdf)(belgeHtml(d));
    if (veri.length < 8 || veri.subarray(0, 4).toString('latin1') !== '%PDF') throw new Error('PDF üretilemedi (çıktı geçerli bir PDF değil)');
  }
  atomikYaz(hedef, veri);
  return { yol: hedef, boyut: veri.length };
}
