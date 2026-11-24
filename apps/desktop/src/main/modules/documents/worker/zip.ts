/**
 * Sınırlı ZIP okuyucu (v1 `belge-isci.ts`ten uyarlandı). Office biçimleri (docx, xlsx, pptx) ZIP'tir; bütün arşivi
 * belleğe açan kitaplık yerine yalnız gereken parçalar açılır. Merkez dizindeki parça sayısı ve AÇIK boyut toplamı
 * sınırlıdır; açma akışla yapılır ve gerçek açılan bayt sayacı sınırı aşınca durur (başlık yalan söylese de: zip bombası).
 */
import zlib from 'node:zlib';

export class LimitError extends Error {}
export class EncryptedError extends Error {}

export interface ZipEntry {
  name: string;
  method: number;
  flags: number;
  compressed: number;
  inflated: number;
  localOffset: number;
}

export interface ZipLimits {
  maxEntries: number;
  maxInflated: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = { maxEntries: 5_000, maxInflated: 100 * 1024 * 1024 };

/** OLE bileşik belge imzası: eski Office (.doc/.xls/.ppt) ve PAROLALI yeni Office dosyaları bu kaptadır. */
export function isCompoundFile(buffer: Buffer): boolean {
  return buffer.length >= 8 && buffer.readUInt32LE(0) === 0xe011cfd0 && buffer.readUInt32LE(4) === 0xe11ab1a1;
}

export function readZipDirectory(buffer: Buffer, limits: ZipLimits): ZipEntry[] {
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65_557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('ZIP değil (merkez dizin yok).');
  const count = buffer.readUInt16LE(end + 10);
  if (count === 0xffff || buffer.readUInt32LE(end + 16) === 0xffffffff) throw new Error('ZIP64 arşivleri okunmaz.');
  if (count > limits.maxEntries) throw new LimitError(`arşivde çok fazla parça var (${count})`);
  let at = buffer.readUInt32LE(end + 16);
  const entries: ZipEntry[] = [];
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (at + 46 > buffer.length || buffer.readUInt32LE(at) !== 0x02014b50) throw new Error('ZIP merkez dizini bozuk.');
    const entry: ZipEntry = {
      flags: buffer.readUInt16LE(at + 8),
      method: buffer.readUInt16LE(at + 10),
      compressed: buffer.readUInt32LE(at + 20),
      inflated: buffer.readUInt32LE(at + 24),
      localOffset: buffer.readUInt32LE(at + 42),
      name: '',
    };
    const nameLength = buffer.readUInt16LE(at + 28);
    const extraLength = buffer.readUInt16LE(at + 30);
    const commentLength = buffer.readUInt16LE(at + 32);
    entry.name = buffer.toString(entry.flags & 0x800 ? 'utf8' : 'latin1', at + 46, at + 46 + nameLength);
    at += 46 + nameLength + extraLength + commentLength;
    total += entry.inflated;
    if (total > limits.maxInflated) throw new LimitError(`açılınca ${Math.round(total / 1024 / 1024)} MB'ı aşıyor`);
    if (!entry.name.endsWith('/')) entries.push(entry);
  }
  return entries;
}

/** Açma bütçesi: bir belgenin bütün parçaları aynı sayaçtan düşer. */
export interface InflateBudget {
  left: number;
}

/** Parçayı akışla açar (64 KB); her çıkış parçası bütçeden düşer, sınır aşılınca akış hemen kesilir. */
export function inflateEntry(buffer: Buffer, entry: ZipEntry, budget: InflateBudget): Promise<Buffer> {
  if (entry.flags & 0x1) return Promise.reject(new EncryptedError('Parolalı (şifreli) arşiv okunmaz.'));
  if (entry.localOffset + 30 > buffer.length || buffer.readUInt32LE(entry.localOffset) !== 0x04034b50) {
    return Promise.reject(new Error('ZIP yerel başlığı bozuk.'));
  }
  const start = entry.localOffset + 30 + buffer.readUInt16LE(entry.localOffset + 26) + buffer.readUInt16LE(entry.localOffset + 28);
  const data = buffer.subarray(start, start + entry.compressed);
  if (entry.method === 0) {
    if (data.length > budget.left) return Promise.reject(new LimitError('açılınca sınırı aşıyor'));
    budget.left -= data.length;
    return Promise.resolve(Buffer.from(data));
  }
  if (entry.method !== 8) return Promise.reject(new Error(`Desteklenmeyen sıkıştırma (${entry.method}).`));
  return new Promise((resolve, reject) => {
    const inflater = zlib.createInflateRaw({ chunkSize: 64 * 1024 });
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    inflater.on('data', (chunk: Buffer) => {
      if (done) return;
      size += chunk.length;
      if (size > budget.left) {
        done = true;
        inflater.destroy();
        reject(new LimitError('açılınca sınırı aşıyor (sıkıştırma bombası olabilir)'));
        return;
      }
      chunks.push(chunk);
    });
    inflater.on('end', () => {
      if (done) return;
      done = true;
      budget.left -= size;
      resolve(Buffer.concat(chunks));
    });
    inflater.on('error', (error) => {
      if (done) return;
      done = true;
      reject(error);
    });
    inflater.end(data);
  });
}

/** XML varlıklarını çözer. `&amp;` en sonda: "&amp;lt;" metinde "&lt;" kalsın. */
export function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => safeCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, dec: string) => safeCodePoint(Number(dec)))
    .replace(/&amp;/g, '&');
}

function safeCodePoint(code: number): string {
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
}

/** "ppt/slides/slide12.xml" → 12. */
export const partNumber = (name: string): number => Number(/(\d+)\.xml$/.exec(name)?.[1] ?? 0);
