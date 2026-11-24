/**
 * Belge araçları. Sonuç metni yerel modelin bağlam bütçesine göre kısadır (~2.400 karakter, ≈ 700 belirteç); uzun belge
 * parça parça okunur. Belgeden gelen her metin "güvenilmez veri" çerçevesindedir (`text.ts` › `untrusted`).
 */
import nodePath from 'node:path';
import { defineTool, type ToolContext, type ToolDef, type ToolResult } from '@fuber/shared';
import { z } from 'zod';
import { formatName, isReadableDocument, sizeLabel } from './formats';
import { docSummary, type ParsedDoc } from './reader';
import { createInput, validateCreate } from './schema';
import type { DocumentsService } from './service';
import { clip, searchParts, TOOL_TEXT_BUDGET, untrusted, type Part } from './text';

/** Klasör aramasında en çok taranan belge ve toplam süre. */
const SEARCH_MAX_FILES = 60;
const SEARCH_BUDGET_MS = 60_000;
const LIST_LIMIT = 40;

const dayText = (ms: number) => {
  if (!ms) return '';
  const date = new Date(ms);
  return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}`;
};

const labelled = (part: Part, text = part.text) => `[${part.label}]\n${text}`;

/** Belgenin istenen yerini bütçeye sığdırır. */
function readView(doc: ParsedDoc, input: { page?: number | undefined; part?: number | undefined; question?: string | undefined }, reference: string): { text: string; shown: string[] } {
  const parts = doc.parts;
  const unit = doc.format === 'pptx' ? 'slayt' : doc.format === 'xlsx' ? 'çalışma sayfası' : doc.format === 'pdf' ? 'sayfa' : 'bölüm';
  const head = `${doc.name} — ${docSummary(doc)}${doc.title ? ` · başlık: ${doc.title}` : ''}${doc.meta.author ? ` · yazar: ${doc.meta.author}` : ''}; ${parts.length} parça.`;
  const budget = TOOL_TEXT_BUDGET;
  if (input.question?.trim()) {
    const hits = searchParts(parts, input.question, 3, 800);
    if (hits.length === 0) {
      const first = parts[0];
      return {
        text: `${head}\nBelgede “${input.question.trim()}” ile eşleşen yer bulunamadı. Başı:\n${first ? clip(labelled(first), 900).text : '(boş)'}`,
        shown: first ? [first.label] : [],
      };
    }
    let out = '';
    const shown: string[] = [];
    for (const hit of hits) {
      const block = labelled(hit.part, hit.excerpt);
      if (out.length + block.length > budget) break;
      out += `${out ? '\n\n' : ''}${block}`;
      shown.push(hit.part.label);
    }
    return { text: `${head}\n“${input.question.trim()}” ile ilgili yerler:\n${out}`, shown };
  }
  let selected: Part[];
  if (input.page !== undefined) {
    selected = parts.filter((part) => part.sectionIndex === input.page);
    if (!selected.length) {
      const pages = doc.sections.length;
      return { text: `${head}\nBu belgede ${input.page}. ${unit} yok (toplam ${pages} ${unit}).`, shown: [] };
    }
  } else {
    const index = Math.min(Math.max(1, input.part ?? 1), Math.max(1, parts.length));
    // Kısa parçalar (yalnız başlık, tek slayt) bütçe dolana dek birlikte verilir; devamı sonraki okunmamış parçadan.
    selected = parts.slice(index - 1);
  }
  let out = '';
  const shown: string[] = [];
  for (const part of selected) {
    const block = labelled(part);
    if (out && out.length + block.length > budget) break;
    out += `${out ? '\n\n' : ''}${block}`;
    shown.push(part.label);
  }
  const last = parts.findIndex((part) => part.label === shown[shown.length - 1]) + 1;
  const tail = last > 0 && last < parts.length ? `\n(Devamı var: ${reference} part: ${last + 1} / ${parts.length}${doc.format === 'pdf' ? `; ya da page ile sayfa, question ile arama` : ''}.)` : '';
  return { text: `${head}\n${clip(out, budget).text}${tail}`, shown };
}

export function createTools(service: () => DocumentsService): ToolDef[] {
  /** Taranmış belge: derin beyin varsa sayfa görüntüsüyle okur; yoksa dürüstçe söyler. */
  const scannedResult = async (doc: ParsedDoc, file: string, page: number | undefined, question: string | undefined, ctx: ToolContext): Promise<ToolResult> => {
    const pages = page ? [page] : Array.from({ length: Math.min(3, doc.meta.pages ?? 1) }, (_unused, i) => i + 1);
    ctx.report(`${doc.name}: sayfa görüntüsüne bakılıyor`);
    const transcript = await service()
      .readScanned(file, pages, question ?? '', ctx.signal)
      .catch(() => null);
    if (transcript) {
      return {
        ok: true,
        text: untrusted(doc.name, `${doc.name} — taranmış PDF; ${pages.join(', ')}. sayfa görüntüden okundu (derin beyin):\n${clip(transcript, TOOL_TEXT_BUDGET).text}`),
        data: { name: doc.name, scanned: true, pages: doc.meta.pages ?? null },
      };
    }
    return {
      ok: false,
      text: `${doc.name} taranmış bir belge: metin katmanı yok (${doc.meta.pages ?? '?'} sayfa). Görüntü olarak bakmam gerekir; bu bilgisayardaki modelle şu an yapamıyorum (derin beyin bağlı değil). Kullanıcıya bunu açıkça söyle, içerik uydurma.`,
      data: { name: doc.name, scanned: true },
    };
  };

  return [
    defineTool({
      name: 'file_list',
      group: 'docs',
      description:
        'Bir klasördeki dosyaları listeler ya da ada göre arar. folder: tam yol ya da "Masaüstü", "Belgeler", "İndirilenler". folder verilmezse izinli klasörleri sayar. İçerikte aramak için document_search kullan. "Masaüstümde ne var", "İndirilenler\'de şu adlı dosya var mı" gibi sorularda kullan.',
      input: z.object({
        folder: z.string().optional().describe('Klasör: "Masaüstü", "Belgeler\\Vergi" ya da tam yol'),
        name_contains: z.string().optional().describe('Adında geçen sözcük: "beyanname"'),
        documents_only: z.boolean().optional().describe('Yalnız okunabilen belgeler'),
      }),
      risk: 'read',
      async run({ folder, name_contains, documents_only }, ctx) {
        const docs = service();
        if (!folder?.trim()) {
          const view = docs.folders.view();
          const lines = view.read.map((entry) => `- ${entry.label}: ${entry.path}${entry.exists ? '' : ' (yok)'}`);
          return { ok: true, text: `İzinli klasörler (okuma serbest):\n${lines.join('\n')}\nÇıktı klasörü (üretilen belgeler): ${view.output}` };
        }
        const gate = await docs.gate(folder, 'dir', ctx, 'file_list');
        if (!gate.ok) return { ok: false, text: gate.text };
        const { entries, more } = docs.listFolder(gate.path, {
          recursive: Boolean(name_contains),
          ...(name_contains ? { nameContains: name_contains } : {}),
          documentsOnly: documents_only === true,
          limit: LIST_LIMIT,
        });
        if (!entries.length) return { ok: true, text: `${gate.path}: ${name_contains ? `adında “${name_contains}” geçen dosya yok` : 'klasör boş'}.`, data: { folder: gate.path, count: 0 } };
        entries.sort((a, b) => Number(b.dir) - Number(a.dir) || b.modified - a.modified);
        const lines = entries.map((entry) => {
          const where = nodePath.relative(gate.path, entry.path);
          return entry.dir ? `[klasör] ${where}` : `${where} · ${isReadableDocument(entry.name) ? formatName(entry.name) : 'dosya'} · ${sizeLabel(entry.bytes)} · ${dayText(entry.modified)}`;
        });
        const text = clip(`${gate.path} (${entries.length}${more ? '+' : ''} öğe, yeniden eskiye):\n${lines.join('\n')}`, TOOL_TEXT_BUDGET).text;
        return { ok: true, text: `${text}${more ? '\n(Daha fazlası var; name_contains ile daraltın.)' : ''}`, data: { folder: gate.path, count: entries.length } };
      },
    }),

    defineTool({
      name: 'document_read',
      group: 'docs',
      description:
        'Bir belgeyi okur: PDF, Word, Excel, PowerPoint, CSV, e-posta (.eml), metin. question verilirse ilgili sayfaları bulur ("son ödeme günü ne?"); page ile belirli sayfa/slayt, part ile sonraki parça. Sohbete eklenen dosya için attachment_id ver. Kullanıcı bir belgenin içeriğini sorduğunda ya da sohbete dosya eklediğinde kullan; belgede ne yazdığını okumadan söyleme.',
      input: z.object({
        path: z.string().optional().describe('Dosyanın tam yolu ya da "Masaüstü\\rapor.pdf"'),
        attachment_id: z.string().optional().describe('Sohbete eklenen dosyanın kimliği'),
        question: z.string().optional().describe('Belgede aranan şey: "son ödeme tarihi", "toplam tutar"'),
        page: z.number().int().min(1).optional().describe('Sayfa / slayt / çalışma sayfası numarası'),
        part: z.number().int().min(1).optional().describe('Parça numarası (devamını okumak için)'),
      }),
      risk: 'read',
      async run({ path, attachment_id, question, page, part }, ctx) {
        const docs = service();
        let doc: ParsedDoc;
        let file = '';
        let reference: string;
        if (attachment_id) {
          const row = docs.attachmentRow(attachment_id);
          if (!row) return { ok: false, text: 'Bu ek bulunamadı (süresi dolmuş olabilir); kullanıcıdan dosyayı yeniden eklemesini iste.' };
          if (row.kind === 'image') return { ok: false, text: `${row.name} bir görsel; belge gibi okunmaz.` };
          if (row.status === 'failed') return { ok: false, text: `${row.name} okunamadı: ${row.note ?? 'bilinmeyen neden'}` };
          doc = docs.attachmentDoc(row);
          file = row.file ?? '';
          reference = `attachment_id: "${attachment_id}"`;
        } else if (path?.trim()) {
          const gate = await docs.gate(path, 'file', ctx, 'document_read');
          if (!gate.ok) return { ok: false, text: gate.text };
          if (!isReadableDocument(gate.path)) return { ok: false, text: `${nodePath.basename(gate.path)}: bu dosya türü belge olarak okunmuyor.` };
          ctx.report(`${nodePath.basename(gate.path)} okunuyor`);
          const read = await docs.reader.read(gate.path, { signal: ctx.signal });
          if (!read.ok) return { ok: false, text: read.error };
          doc = read.doc;
          file = gate.path;
          reference = `path: "${gate.path}"`;
        } else {
          return { ok: false, text: 'Hangi belge? path (dosya yolu) ya da attachment_id ver; yolu bilmiyorsan önce file_list ile bul.' };
        }
        if (doc.scanned) return scannedResult(doc, file, page, question, ctx);
        const view = readView(doc, { page, part, question }, reference);
        const notes = [doc.note, doc.truncated ? 'Belge çok uzun; ilk 3 milyon karakteri okundu.' : null].filter(Boolean);
        return {
          ok: true,
          text: untrusted(doc.name, `${view.text}${notes.length ? `\n(${notes.join(' ')})` : ''}`),
          data: { name: doc.name, format: doc.format, pages: doc.meta.pages ?? doc.sections.length, parts: doc.parts.length, shown: view.shown },
        };
      },
    }),

    defineTool({
      name: 'document_search',
      group: 'docs',
      description:
        'Klasördeki belgelerin İÇİNDE arar (ör. "son ödeme tarihi", "fatura 2026-114"); eşleşen belge, sayfa ve satırları verir. folder verilmezse izinli klasörlerde arar. Ada göre aramak için file_list.',
      input: z.object({
        query: z.string().min(2).describe('Aranan sözcükler'),
        folder: z.string().optional().describe('Klasör: "Belgeler\\Vergi" ya da tam yol'),
        limit: z.number().int().min(1).max(8).optional(),
      }),
      risk: 'read',
      async run({ query, folder, limit }, ctx) {
        const docs = service();
        let roots: string[];
        if (folder?.trim()) {
          const gate = await docs.gate(folder, 'dir', ctx, 'document_search');
          if (!gate.ok) return { ok: false, text: gate.text };
          roots = [gate.path];
        } else {
          roots = docs.folders.readRoots();
        }
        const candidates = roots
          .flatMap((root) => docs.listFolder(root, { recursive: true, documentsOnly: true, limit: SEARCH_MAX_FILES }).entries)
          .filter((entry) => entry.bytes > 0 && entry.bytes <= 25 * 1024 * 1024)
          .sort((a, b) => b.modified - a.modified)
          .slice(0, SEARCH_MAX_FILES);
        if (!candidates.length) return { ok: true, text: `Aranacak belge bulunamadı (${roots.join(', ')}).`, data: { scanned: 0, hits: 0 } };
        const started = Date.now();
        const found: Array<{ name: string; path: string; label: string; excerpt: string; score: number }> = [];
        let scanned = 0;
        let skipped = 0;
        for (const entry of candidates) {
          if (ctx.signal.aborted) break;
          if (Date.now() - started > SEARCH_BUDGET_MS) {
            skipped = candidates.length - scanned;
            break;
          }
          scanned++;
          if (scanned % 5 === 0) ctx.report(`${scanned}/${candidates.length} belge tarandı`);
          // Engel listesi ve gerçek yol yine denetlenir (klasör içindeki bağ dışarı çıkmasın).
          const gate = await docs.gate(entry.path, 'file', { ...ctx, tools: { ...ctx.tools, requestApproval: async () => 'denied' } }, 'document_search');
          if (!gate.ok) continue;
          const read = await docs.reader.read(gate.path, { signal: ctx.signal });
          if (!read.ok || read.doc.scanned) continue;
          for (const hit of searchParts(read.doc.parts, query, 2, 300)) {
            found.push({ name: entry.name, path: gate.path, label: hit.part.label, excerpt: hit.excerpt, score: hit.score });
          }
        }
        found.sort((a, b) => b.score - a.score);
        const top = found.slice(0, limit ?? 5);
        if (!top.length) {
          return { ok: true, text: `${scanned} belgede “${query}” bulunamadı.${skipped ? ` (${skipped} belgeye süre yetmedi.)` : ''}`, data: { scanned, hits: 0 } };
        }
        const body = top.map((hit) => `${hit.name} — ${hit.label}\nYol: ${hit.path}\n${hit.excerpt}`).join('\n\n');
        return {
          ok: true,
          text: untrusted(`${scanned} belgede arama`, `${scanned} belge tarandı, “${query}” için en iyi ${top.length} eşleşme:\n${clip(body, TOOL_TEXT_BUDGET).text}${skipped ? `\n(${skipped} belgeye süre yetmedi.)` : ''}`),
          data: { scanned, hits: found.length },
        };
      },
    }),

    defineTool({
      name: 'document_create',
      group: 'docs',
      description:
        'Word (docx), Excel (xlsx), PowerPoint (pptx) ya da PDF belgesi üretip çıktı klasörüne kaydeder. docx/pdf: sections; xlsx: sheets (ilk satır başlık); pptx: slides. Yalnız kullanıcı belge istediğinde kullan.',
      input: createInput,
      risk: 'write',
      async run(input, ctx) {
        const valid = validateCreate(input);
        if (typeof valid === 'string') return { ok: false, text: `Belge isteği geçersiz: ${valid}` };
        ctx.report('Belge hazırlanıyor');
        const result = await service().create(valid, input.file_name, ctx.signal);
        if (!result.ok) return { ok: false, text: result.text };
        return {
          ok: true,
          text: `${result.label} kaydedildi: ${result.path} (${sizeLabel(result.bytes)}; ${result.summary}). Dosya yeniden okunarak doğrulandı.`,
          data: { path: result.path, format: valid.format },
        };
      },
    }),
  ];
}
