// ── Belge ayrıştırma işçisi (inceleme I1) — ana süreçte DEĞİL, ayrı süreçte/iş parçacığında çalışır ──────────────────────────────────
// PDF, Word (.docx), Excel (.xlsx), PowerPoint (.pptx) ve e-posta (.eml) burada metne çevrilir. Çağıran (belge-ayristir.ts) bu dosyayı Electron'da
// utilityProcess, testte worker_threads olarak açar; bellek sınırı (--max-old-space-size / resourceLimits) ve kesin süre sınırıyla öldürebilir.
// Ana süreç donmaz, çökmez. ZIP tabanlı biçimlerde: girdi sayısı ve merkez dizindeki AÇIK boyut toplamı sınırlı; açma akışla yapılır ve gerçek açılan
// bayt sayacı sınırı aşınca durur (başlık yalan söylese de). xlsx satır ve hücre sınırıyla, kendi okuyucumuzla (tüm çalışma kitabı belleğe alınmaz).
// Bu dosya GÖRELİ içe aktarma yapmaz (testte Node tür ayıklamasıyla doğrudan, üretimde ayrı paket olarak çalışır); yalnız node: ve npm paketleri.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export interface IsciIstegi { yol: string; azamiKarakter: number; zip?: { azamiGirdi: number; azamiAcik: number }; xlsx?: { azamiSatir: number; azamiHucre: number } }
export interface IsciParcasi { ad: string; metin: string; tarih?: string }
export type IsciYaniti = { parcalar: IsciParcasi[]; toplam: number; kesildi: boolean; not?: string } | { hata: string; kod: 'sinir' | 'bozuk' };

class SinirHatasi extends Error {}
const VARSAYILAN_ZIP = { azamiGirdi: 5_000, azamiAcik: 100 * 1024 * 1024 };
const VARSAYILAN_XLSX = { azamiSatir: 5_000, azamiHucre: 200_000 };

/** Metni bütçeyle biriktirir: bütçeyi aşan kısım tutulmaz ama sayılır (toplam gerçek uzunluk). */
class Toplayici {
  private parcalar: string[] = [];
  private tutulan = 0;
  toplam = 0;
  private readonly butce: number;
  constructor(butce: number) { this.butce = butce; }
  ekle(s: string): void {
    if (!s) return;
    this.toplam += s.length;
    const yer = this.butce + 1 - this.tutulan;
    if (yer <= 0) return;
    const al = s.length <= yer ? s : s.slice(0, yer);
    this.parcalar.push(al);
    this.tutulan += al.length;
  }
  get dolu(): boolean { return this.tutulan > this.butce; }
  metin(): string { return this.parcalar.join(''); }
}

// ── ZIP: merkez dizin + sınırlı, akışlı açma ─────────────────────────────────────────────────────────────────────────────
interface Girdi { ad: string; yontem: number; bayrak: number; sikisik: number; acik: number; yerel: number }
function zipDizini(b: Buffer, s: { azamiGirdi: number; azamiAcik: number }): Girdi[] {
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65_557); i--) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('ZIP değil (merkez dizin yok).');
  const adet = b.readUInt16LE(eocd + 10);
  if (adet === 0xffff || b.readUInt32LE(eocd + 16) === 0xffffffff) throw new Error('ZIP64 arşivleri okunmaz.');
  if (adet > s.azamiGirdi) throw new SinirHatasi(`arşivde çok fazla parça var (${adet})`);
  let p = b.readUInt32LE(eocd + 16);
  const out: Girdi[] = [];
  let toplamAcik = 0;
  for (let n = 0; n < adet; n++) {
    if (p + 46 > b.length || b.readUInt32LE(p) !== 0x02014b50) throw new Error('ZIP merkez dizini bozuk.');
    const g: Girdi = { bayrak: b.readUInt16LE(p + 8), yontem: b.readUInt16LE(p + 10), sikisik: b.readUInt32LE(p + 20), acik: b.readUInt32LE(p + 24), yerel: b.readUInt32LE(p + 42), ad: '' };
    const adUz = b.readUInt16LE(p + 28), ekUz = b.readUInt16LE(p + 30), yorumUz = b.readUInt16LE(p + 32);
    g.ad = b.toString((g.bayrak & 0x800) ? 'utf8' : 'latin1', p + 46, p + 46 + adUz);
    p += 46 + adUz + ekUz + yorumUz;
    toplamAcik += g.acik;
    if (toplamAcik > s.azamiAcik) throw new SinirHatasi(`açılınca ${Math.round(toplamAcik / 1024 / 1024)} MB'ı aşıyor`);
    if (!g.ad.endsWith('/')) out.push(g);
  }
  return out;
}

/** Girdiyi AKIŞLA açar (64 KB parçalar); her çıkış parçası `sayac.kalan`dan düşer — başlıktaki boyut yalan olsa da (zip bombası) gerçek açılan bayt
 *  sınırı aşınca akış hemen kesilir. */
function zipAc(b: Buffer, g: Girdi, sayac: { kalan: number }): Promise<Buffer> {
  if (g.bayrak & 0x1) return Promise.reject(new Error('Şifreli dosya okunmaz.'));
  if (b.readUInt32LE(g.yerel) !== 0x04034b50) return Promise.reject(new Error('ZIP yerel başlığı bozuk.'));
  const bas = g.yerel + 30 + b.readUInt16LE(g.yerel + 26) + b.readUInt16LE(g.yerel + 28);
  const veri = b.subarray(bas, bas + g.sikisik);
  if (g.yontem === 0) {
    if (veri.length > sayac.kalan) return Promise.reject(new SinirHatasi('açılınca sınırı aşıyor'));
    sayac.kalan -= veri.length;
    return Promise.resolve(Buffer.from(veri));
  }
  if (g.yontem !== 8) return Promise.reject(new Error(`Desteklenmeyen sıkıştırma (${g.yontem}).`));
  return new Promise((ok, no) => {
    const inf = zlib.createInflateRaw({ chunkSize: 64 * 1024 });
    const parcalar: Buffer[] = [];
    let n = 0;
    let bitti = false;
    inf.on('data', (c: Buffer) => {
      if (bitti) return;
      n += c.length;
      if (n > sayac.kalan) { bitti = true; inf.destroy(); no(new SinirHatasi('açılınca sınırı aşıyor (sıkıştırma bombası olabilir)')); return; }
      parcalar.push(c);
    });
    inf.on('end', () => { if (bitti) return; bitti = true; sayac.kalan -= n; ok(Buffer.concat(parcalar)); });
    inf.on('error', (e) => { if (!bitti) { bitti = true; no(e); } });
    inf.end(veri);
  });
}

const xmlCoz = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_t, n: string) => String.fromCodePoint(parseInt(n, 16))).replace(/&#(\d+);/g, (_t, n: string) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');
const no = (ad: string) => Number(/(\d+)\.xml$/.exec(ad)?.[1] ?? 0);

/** Word: word/document.xml paragrafları (<w:p>), metin parçaları (<w:t>), sekme ve satır sonu. */
async function docxMetni(b: Buffer, t: Toplayici, z: { azamiGirdi: number; azamiAcik: number }): Promise<void> {
  const dizin = zipDizini(b, z);
  const sayac = { kalan: z.azamiAcik };
  const g = dizin.find((x) => x.ad === 'word/document.xml');
  if (!g) throw new Error('Word belgesi değil (word/document.xml yok).');
  const xml = (await zipAc(b, g, sayac)).toString('utf8');
  for (const par of xml.split(/<\/w:p>/)) {
    if (t.dolu) { t.ekle(par.replace(/<[^>]+>/g, '')); continue; } // yalnız sayılır
    const parca = [...par.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:(tab|br)\b[^>]*\/>/g)].map((m) => (m[2] === 'tab' ? '\t' : m[2] === 'br' ? '\n' : xmlCoz(m[1] ?? ''))).join('');
    if (parca) t.ekle(`${parca}\n`);
  }
}

/** PowerPoint: slayt sırasıyla metin (<a:t>) ve konuşmacı notları. Bütçe dolunca kalan slaytlar açılmaz. */
async function pptxMetni(b: Buffer, t: Toplayici, z: { azamiGirdi: number; azamiAcik: number }): Promise<string | undefined> {
  const dizin = zipDizini(b, z);
  const sayac = { kalan: z.azamiAcik };
  const slaytlar = dizin.filter((g) => /^ppt\/slides\/slide\d+\.xml$/.test(g.ad)).sort((x, y) => no(x.ad) - no(y.ad));
  const notlar = new Map(dizin.filter((g) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(g.ad)).map((g) => [no(g.ad), g]));
  const metin = (xml: string) => xml.split(/<\/a:p>/).map((par) => [...par.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map((m) => xmlCoz(m[1])).join('')).filter(Boolean).join('\n');
  let atlanan = 0;
  for (const s of slaytlar) {
    if (t.dolu) { atlanan++; continue; }
    const n = no(s.ad);
    const m = metin((await zipAc(b, s, sayac)).toString('utf8'));
    const ng = notlar.get(n);
    const not = ng ? metin((await zipAc(b, ng, sayac)).toString('utf8')).replace(/^\d+$/gm, '').trim() : '';
    t.ekle(`## Slayt ${n}\n${m || '(metin yok)'}${not ? `\n\nKonuşmacı notu: ${not}` : ''}\n\n`);
  }
  return atlanan ? `Sınıra ulaşıldı: son ${atlanan} slayt okunmadı.` : undefined;
}

/** Excel: kendi okuyucumuz — paylaşılan dizgiler + sayfalar; sayfa başına en çok `azamiSatir` satır, toplam `azamiHucre` hücre (ExcelJS bütün çalışma
 *  kitabını belleğe alırdı). Formülün sonucu (<v>), satır içi dizgi (<is>), mantıksal değer. */
async function xlsxMetni(b: Buffer, t: Toplayici, z: { azamiGirdi: number; azamiAcik: number }, s: { azamiSatir: number; azamiHucre: number }): Promise<string | undefined> {
  const dizin = zipDizini(b, z);
  const sayac = { kalan: z.azamiAcik };
  const bul = (ad: string) => dizin.find((g) => g.ad === ad);
  const paylasilan: string[] = [];
  const ss = bul('xl/sharedStrings.xml');
  if (ss) {
    const xml = (await zipAc(b, ss, sayac)).toString('utf8');
    for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      paylasilan.push([...m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((x) => xmlCoz(x[1])).join(''));
      if (paylasilan.length > s.azamiHucre * 2) break;
    }
  }
  const wb = bul('xl/workbook.xml');
  const adlar = wb ? [...(await zipAc(b, wb, sayac)).toString('utf8').matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)].map((m) => xmlCoz(m[1])) : [];
  const sayfalar = dizin.filter((g) => /^xl\/worksheets\/sheet\d+\.xml$/.test(g.ad)).sort((x, y) => no(x.ad) - no(y.ad));
  let hucre = 0;
  const notlar: string[] = [];
  for (const [i, sg] of sayfalar.entries()) {
    if (t.dolu || hucre >= s.azamiHucre) { notlar.push(`"${adlar[i] ?? `Sayfa ${i + 1}`}" okunmadı`); continue; }
    t.ekle(`## Sayfa: ${adlar[i] ?? `Sayfa ${i + 1}`}\n`);
    const xml = (await zipAc(b, sg, sayac)).toString('utf8');
    let satir = 0;
    const satirRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
    for (let m = satirRe.exec(xml); m; m = satirRe.exec(xml)) {
      if (satir >= s.azamiSatir || hucre >= s.azamiHucre) { notlar.push(`"${adlar[i] ?? `Sayfa ${i + 1}`}" ilk ${satir.toLocaleString('tr-TR')} satırla kesildi`); break; }
      satir++;
      const degerler: string[] = [];
      for (const c of m[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        hucre++;
        const tur = /\bt="([^"]+)"/.exec(c[1])?.[1];
        const ic = c[2] ?? '';
        const v = /<v>([\s\S]*?)<\/v>/.exec(ic)?.[1];
        let d = '';
        if (tur === 's') d = paylasilan[Number(v)] ?? '';
        else if (tur === 'inlineStr') d = [...ic.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((x) => xmlCoz(x[1])).join('');
        else if (tur === 'b') d = v === '1' ? 'DOĞRU' : 'YANLIŞ';
        else d = v !== undefined ? xmlCoz(v) : '';
        degerler.push(d.replace(/[\t\r\n]+/g, ' '));
      }
      t.ekle(`${degerler.join('\t').replace(/\t+$/, '')}\n`);
    }
    t.ekle('\n');
  }
  return notlar.length ? `Sınıra ulaşıldı: ${notlar.slice(0, 3).join('; ')}${notlar.length > 3 ? ` (+${notlar.length - 3})` : ''}.` : undefined;
}

export async function ayristir(i: IsciIstegi): Promise<IsciYaniti> {
  const z = i.zip ?? VARSAYILAN_ZIP;
  const ad = path.basename(i.yol);
  const uz = path.extname(i.yol).toLowerCase();
  const t = new Toplayici(Math.max(1, i.azamiKarakter));
  try {
    const buf = fs.readFileSync(i.yol);
    let not: string | undefined;
    if (uz === '.docx') await docxMetni(buf, t, z);
    else if (uz === '.pptx') not = await pptxMetni(buf, t, z);
    else if (uz === '.xlsx') not = await xlsxMetni(buf, t, z, i.xlsx ?? VARSAYILAN_XLSX);
    else if (uz === '.pdf') {
      // pdf.js, Electron'un ana süreç DIŞINDAKİ süreçlerini (process.type 'utility') tarayıcı sanıp DOMMatrix arar; bu yalıtılmış süreç Node'dur.
      const p0 = process as unknown as { type?: string };
      if (p0.type === 'utility') { try { Object.defineProperty(process, 'type', { value: 'browser', configurable: true }); } catch { /* salt okur */ } }
      const { PDFParse } = await import('pdf-parse');
      const p = new PDFParse({ data: buf });
      try { t.ekle((await p.getText()).text); } finally { await p.destroy(); }
    } else if (uz === '.eml') {
      const { simpleParser } = await import('mailparser');
      const m = await simpleParser(buf);
      const to = Array.isArray(m.to) ? m.to.map((x) => x.text).join(', ') : m.to?.text ?? '';
      t.ekle(`Kimden: ${m.from?.text ?? ''}\nKime: ${to}\nTarih: ${m.date?.toISOString() ?? ''}\nKonu: ${m.subject ?? ''}\n\n${m.text ?? ''}`);
      return { parcalar: [{ ad: `E-posta: ${m.subject ?? ad}`, metin: t.metin(), ...(m.date ? { tarih: m.date.toISOString() } : {}) }], toplam: t.toplam, kesildi: t.dolu };
    } else return { hata: 'Bu tür işçide ayrıştırılmaz.', kod: 'bozuk' };
    return { parcalar: [{ ad, metin: t.metin() }], toplam: t.toplam, kesildi: t.dolu, ...(not ? { not } : {}) };
  } catch (e) {
    if (e instanceof SinirHatasi) return { hata: e.message, kod: 'sinir' };
    return { hata: String((e as Error)?.message ?? e).slice(0, 200), kod: 'bozuk' };
  }
}

// ── Giriş: Electron utilityProcess (process.parentPort) ya da worker_threads ────────────────────────────────────────────────
const up = (process as unknown as { parentPort?: { on: (o: string, f: (e: { data: IsciIstegi }) => void) => void; postMessage: (m: unknown) => void } }).parentPort;
if (up) {
  up.on('message', (e) => { void ayristir(e.data).then((r) => up.postMessage(r)); });
} else {
  const wt = await import('node:worker_threads');
  if (!wt.isMainThread && wt.parentPort) {
    const port = wt.parentPort;
    port.once('message', (d: IsciIstegi) => { void ayristir(d).then((r) => port.postMessage(r)); });
  }
}
