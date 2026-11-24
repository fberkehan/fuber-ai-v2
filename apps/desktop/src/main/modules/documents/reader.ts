/**
 * Belge okuyucu: işçiden gelen bölümleri parçalara çevirir, son okunanları bellekte tutar (yol + boyut + değişme anı;
 * dosya değişince yeniden okunur) ve işçi hatasını kullanıcıya söylenecek tek satıra çevirir.
 */
import fs from 'node:fs';
import nodePath from 'node:path';
import { PARSE_MAX_CHARS } from './formats';
import { toParts, type Part } from './text';
import type { DocWorker, ParseResult } from './worker-client';
import type { DocFormat, DocMeta, DocSection, PageImage } from './worker/protocol';

export interface ParsedDoc {
  path: string;
  name: string;
  format: DocFormat;
  title: string | null;
  sections: DocSection[];
  parts: Part[];
  totalChars: number;
  truncated: boolean;
  meta: DocMeta;
  scanned: boolean;
  note: string | null;
  bytes: number;
}

export type ReadOutcome = { ok: true; doc: ParsedDoc; images?: PageImage[] } | { ok: false; code: string; error: string };

const CACHE_SIZE = 24;
const MAX_BYTES = 60 * 1024 * 1024;

export function describeFailure(name: string, result: Extract<ParseResult, { ok: false }>): string {
  switch (result.code) {
    case 'timeout':
      return `${name} okunamadı: ${result.error}.`;
    case 'memory':
      return `${name} okunamadı: ${result.error}.`;
    case 'limit':
      return `${name} okunamadı: ${result.error} (sınır: 100 MB açılmış içerik; sıkıştırma bombası olabilir).`;
    case 'encrypted':
      return `${name} okunamadı: ${result.error}`;
    case 'legacy':
    case 'unsupported':
      return result.error;
    case 'aborted':
      return `${name} okunması iptal edildi.`;
    default:
      return `${name} okunamadı: ${result.error}`;
  }
}

export interface Reader {
  /** `file` erişim kapısından geçmiş gerçek yol olmalıdır. */
  read(file: string, options?: { signal?: AbortSignal; renderPages?: number[]; displayName?: string }): Promise<ReadOutcome>;
  forget(file: string): void;
}

export function createReader(worker: () => DocWorker): Reader {
  const cache = new Map<string, ParsedDoc>();
  const keyOf = (file: string, stat: fs.Stats) => `${file.toLowerCase()}|${stat.size}|${stat.mtimeMs}`;

  return {
    async read(file, options = {}) {
      const name = options.displayName ?? nodePath.basename(file);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(file);
      } catch {
        return { ok: false, code: 'missing', error: `${name} bulunamadı.` };
      }
      if (stat.size === 0) return { ok: false, code: 'empty', error: `${name} boş (0 bayt).` };
      if (stat.size > MAX_BYTES) return { ok: false, code: 'limit', error: `${name} çok büyük (${Math.round(stat.size / 1024 / 1024)} MB); en çok 60 MB okunur.` };
      const key = keyOf(file, stat);
      const cached = cache.get(key);
      if (cached && !options.renderPages?.length) {
        cache.delete(key);
        cache.set(key, cached);
        return { ok: true, doc: cached };
      }
      const result = await worker().parse(
        { path: file, maxChars: PARSE_MAX_CHARS, ...(options.renderPages?.length ? { renderPages: options.renderPages } : {}) },
        options.signal ? { signal: options.signal } : {},
      );
      if (!result.ok) return { ok: false, code: result.code, error: describeFailure(name, result) };
      const doc: ParsedDoc = {
        path: file,
        name,
        format: result.format,
        title: result.title,
        sections: result.sections,
        parts: toParts(result.sections),
        totalChars: result.totalChars,
        truncated: result.truncated,
        meta: result.meta,
        scanned: result.scanned === true,
        note: result.note ?? null,
        bytes: stat.size,
      };
      cache.set(key, doc);
      while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
      return { ok: true, doc, ...(result.images ? { images: result.images } : {}) };
    },
    forget(file) {
      for (const key of [...cache.keys()]) if (key.startsWith(`${file.toLowerCase()}|`)) cache.delete(key);
    },
  };
}

/** Belgenin tek satırlık tanımı: "PDF · 12 sayfa · 3,4 MB". */
export function docSummary(doc: Pick<ParsedDoc, 'format' | 'meta' | 'sections' | 'scanned'>): string {
  const label: Record<DocFormat, string> = { pdf: 'PDF', docx: 'Word', xlsx: 'Excel', csv: 'CSV', pptx: 'PowerPoint', eml: 'E-posta', text: 'Metin' };
  const count = doc.meta.pages;
  const unit = doc.format === 'pptx' ? 'slayt' : doc.format === 'xlsx' ? 'çalışma sayfası' : doc.format === 'pdf' ? 'sayfa' : null;
  const pieces = [label[doc.format]];
  if (unit && count) pieces.push(`${count} ${unit}`);
  if (doc.scanned) pieces.push('metin katmanı yok (taranmış)');
  return pieces.join(' · ');
}
