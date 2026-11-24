// Belgeler modülü: araçlar (file_list, document_read, document_search, document_create), izin kapısı ve onay, sohbet
// ekleri (çözücü, bağlam bütçesi, görsel notu) ve konuşma servisiyle bütünleşme.
import fs from 'node:fs';
import nodePath from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ApprovalInput, BrainApi, BrainRequest, BrainResponse, Bus, ModuleContext, Paths, ToolResult } from '@fuber/shared';
import { createConversation } from '../../core/conversation';
import { loadModule, miniTools, moduleContext, silentLog, tempStore, testBus } from '../../core/brain/testkit';
import documents, { configureDocuments, setDeepVisionProvider } from './index';
import { buildDocx, buildPdf, scratchDir } from './testkit';
import { generateDocument } from './worker/generate';
import { parseDocument } from './worker/parse';
import type { DocWorker } from './worker-client';

/** İşçinin aynısı, aynı süreçte (süre/bellek sınırları worker.test.ts'te). */
const inProcess: DocWorker = {
  parse: (request) => parseDocument({ op: 'parse', ...request }),
  generate: (format, content) => generateDocument({ op: 'generate', format, content }),
  dispose() {},
};

/** Geçerli küçük bir PDF döndüren sahte yazıcı; HTML'deki ilk paragrafı PDF metnine koyar. */
const fakePrinter = async (html: string) => {
  const text = (/<p>([^<]*)/.exec(html)?.[1] ?? 'PDF').replace(/[^\x20-\x7e]/g, '?');
  return new Uint8Array(buildPdf([[text]]));
};

let env: ReturnType<typeof tempStore>;
let bus: Bus;
let tools: ReturnType<typeof miniTools>;
let ctx: ModuleContext;
let home: string;
let cleanup: () => Promise<void>;
let approvals: ApprovalInput[];
let brainProvider: 'cloud' | 'local';
let sentRequests: BrainRequest[];

const voice = { channel: 'voice' as const, speakerVerified: null };
const run = (name: string, input: unknown) => tools.run(name, input, { origin: voice }) as Promise<ToolResult>;
const desktop = () => nodePath.join(home, 'Desktop');
const put = (folder: string, name: string, data: Buffer | string) => {
  fs.mkdirSync(folder, { recursive: true });
  const file = nodePath.join(folder, name);
  fs.writeFileSync(file, data);
  return file;
};

async function boot() {
  env = tempStore();
  bus = testBus();
  tools = miniTools();
  approvals = [];
  const scratch = scratchDir('module');
  cleanup = scratch.cleanup;
  home = nodePath.join(scratch.dir, 'home');
  for (const folder of ['Desktop', 'Documents', 'Downloads']) fs.mkdirSync(nodePath.join(home, folder), { recursive: true });
  const paths = { data: nodePath.join(scratch.dir, 'data'), temp: nodePath.join(scratch.dir, 'tmp') } as Paths;
  const requestApproval = tools.requestApproval.bind(tools);
  tools.requestApproval = async (input: ApprovalInput) => {
    approvals.push(input);
    return requestApproval(input);
  };
  brainProvider = 'local';
  sentRequests = [];
  const brain = {
    status: () => ({ provider: brainProvider }),
    respond: async (request: BrainRequest): Promise<BrainResponse> => {
      sentRequests.push(request);
      return { text: 'Tamam.', stopReason: 'end', error: null, toolCalls: [], usage: { inputTokens: 1, outputTokens: 1, costUsd: 0, durationMs: 1 } };
    },
    extract: async () => null,
  } as unknown as BrainApi;
  const conversation = createConversation({ store: env.store, brain: brain as BrainApi, bus, log: silentLog });
  ctx = moduleContext('documents', { bus, paths, brain, conversation, tools }, env.store);
  configureDocuments({
    worker: inProcess,
    home,
    known: { documents: nodePath.join(home, 'Documents'), desktop: desktop(), downloads: nodePath.join(home, 'Downloads') },
    storageDir: nodePath.join(scratch.dir, 'store'),
    printPdf: fakePrinter,
  });
  await loadModule(documents, ctx, env.store, tools);
  return conversation;
}

afterEach(async () => {
  await documents.teardown?.();
  setDeepVisionProvider(null);
  env.close();
  await cleanup();
});

describe('dosya araçları ve izin kapısı', () => {
  beforeEach(() => boot());

  it('file_list: izinli klasörler, "Masaüstü" adı, ada göre arama', async () => {
    put(desktop(), 'Ekim beyannamesi.pdf', buildPdf([['x']]));
    put(nodePath.join(desktop(), 'Vergi'), 'kasim beyannamesi.pdf', buildPdf([['y']]));
    const roots = await run('file_list', {});
    expect(roots.text).toContain('Masaüstü');
    const listed = await run('file_list', { folder: 'Masaüstü' });
    expect(listed.ok).toBe(true);
    expect(listed.text).toContain('Ekim beyannamesi.pdf');
    expect(listed.text).toContain('[klasör] Vergi');
    const found = await run('file_list', { folder: 'masaüstündeki', name_contains: 'beyanname' });
    expect(found.text).toContain(nodePath.join('Vergi', 'kasim beyannamesi.pdf'));
    expect(approvals).toHaveLength(0);
  });

  it('izinli klasör dışı okuma onay ister: reddedilirse okunmaz, onaylanırsa okunur ve 30 dk hatırlanır', async () => {
    const outside = nodePath.join(home, '..', 'disari');
    const file = put(outside, 'rapor.txt', 'Dışarıdaki rapor: toplam 42.');
    const denied = await run('document_read', { path: file });
    expect(denied.ok).toBe(false);
    expect(denied.text).toContain('izin vermedi');
    expect(approvals[0]?.summary).toContain('rapor.txt');
    tools.approvals.push('approved');
    const allowed = await run('document_read', { path: file });
    expect(allowed.ok).toBe(true);
    expect(allowed.text).toContain('toplam 42');
    const again = await run('document_read', { path: file, part: 1 });
    expect(again.ok).toBe(true);
    expect(approvals).toHaveLength(2);
  });

  it('engelli yollar onay bile sorulmadan reddedilir', async () => {
    put(nodePath.join(home, 'AppData', 'Roaming'), 'gizli.txt', 'x');
    put(desktop(), 'id_rsa', 'x');
    for (const target of [nodePath.join(home, 'AppData', 'Roaming', 'gizli.txt'), nodePath.join(desktop(), 'id_rsa'), '\\\\sunucu\\paylasim\\a.pdf', `${nodePath.join(desktop(), 'a.pdf')}:akis`]) {
      const result = await run('document_read', { path: target });
      expect(result.ok, target).toBe(false);
    }
    expect(approvals).toHaveLength(0);
  });
});

describe('document_read', () => {
  beforeEach(() => boot());

  it('soruyla ilgili sayfayı bulur ("son ödeme günü"), sayfa ve parça okur, içerik güvenilmez diye işaretli', async () => {
    const pages = [
      ['KDV Beyannamesi', 'Donem: Ekim 2026', 'Mukellef: Sentetik Ltd'],
      ['Matrah ve vergi tablosu', 'Hesaplanan KDV 15.000,00'],
      ['Son Odeme Tarihi: 26.11.2026', 'Odenecek KDV: 12.500,00 TL'],
    ];
    put(desktop(), 'beyan.pdf', buildPdf(pages, { title: 'Ekim KDV' }));
    const answer = await run('document_read', { path: 'Masaüstü\\beyan.pdf', question: 'son ödeme günü ne?' });
    expect(answer.ok).toBe(true);
    expect(answer.text).toContain('[Sayfa 3]');
    expect(answer.text).toContain('26.11.2026');
    expect(answer.text).toContain('güvenilmez veri');
    expect(answer.text.length).toBeLessThan(3200);
    const page = await run('document_read', { path: nodePath.join(desktop(), 'beyan.pdf'), page: 2 });
    expect(page.text).toContain('Hesaplanan KDV');
    expect(page.text).not.toContain('26.11.2026');
    const missing = await run('document_read', { path: nodePath.join(desktop(), 'beyan.pdf'), page: 9 });
    expect(missing.text).toContain('9. sayfa yok');
  });

  it('uzun belge parça parça: her sonuç bütçede, "devamı var" notu', async () => {
    const paragraphs = Array.from({ length: 40 }, (_unused, i) => `Paragraf ${i + 1}: ${'sentetik metin '.repeat(20)}`);
    put(desktop(), 'uzun.txt', paragraphs.join('\n\n'));
    const first = await run('document_read', { path: nodePath.join(desktop(), 'uzun.txt') });
    expect(first.text).toContain('Devamı var');
    expect(first.text.length).toBeLessThan(3200);
    const second = await run('document_read', { path: nodePath.join(desktop(), 'uzun.txt'), part: 2 });
    expect(second.text).toContain('(2/');
  });

  it('taranmış PDF: derin beyin yoksa dürüst "görüntü olarak bakmam gerekir"; varsa sayfa görüntüsüyle okur', async () => {
    put(desktop(), 'tarama.pdf', buildPdf([[], []], { scanned: [1, 2] }));
    const honest = await run('document_read', { path: nodePath.join(desktop(), 'tarama.pdf') });
    expect(honest.ok).toBe(false);
    expect(honest.text).toContain('metin katmanı yok');
    expect(honest.text).toContain('Görüntü olarak bakmam gerekir');
    const asked: Array<{ images?: unknown[] }> = [];
    setDeepVisionProvider(() => ({
      available: () => ({ ok: true }),
      ask: async (request) => {
        asked.push(request);
        return { text: 'Son ödeme: 26.11.2026' };
      },
    }));
    const viaDeep = await run('document_read', { path: nodePath.join(desktop(), 'tarama.pdf'), question: 'son ödeme' });
    expect(viaDeep.ok).toBe(true);
    expect(viaDeep.text).toContain('26.11.2026');
    expect(viaDeep.text).toContain('güvenilmez veri');
    expect(asked[0]!.images?.length).toBe(2);
    // Açık sağlayıcı kaldırılınca modülün kurulumda bağladığı çekirdek derin beyni (`deepBrainFor`) geçerlidir: sayfa
    // görüntüleri bellekten beyne gider (sınamada sahte beyin; Claude Code yok sayılır).
    setDeepVisionProvider(undefined);
    const before = sentRequests.length;
    const viaCore = await run('document_read', { path: nodePath.join(desktop(), 'tarama.pdf'), question: 'toplam tutar' });
    expect(viaCore.ok).toBe(true);
    const deepRequest = sentRequests.slice(before).find((request) => (request.messages ?? []).some((message) => (message.images?.length ?? 0) > 0));
    expect(deepRequest?.messages?.at(-1)?.images?.length).toBe(2);
    expect(deepRequest?.tools).toBe('none');
  });

  it('bozuk ve boş dosyada dürüst hata, uygulama çökmez', async () => {
    put(desktop(), 'bozuk.docx', 'PK bozuk arsiv');
    put(desktop(), 'bos.pdf', '');
    expect((await run('document_read', { path: nodePath.join(desktop(), 'bozuk.docx') })).ok).toBe(false);
    const empty = await run('document_read', { path: nodePath.join(desktop(), 'bos.pdf') });
    expect(empty.ok).toBe(false);
    expect(empty.text).toContain('boş');
  });
});

describe('document_search', () => {
  beforeEach(() => boot());

  it('klasördeki belgelerin içinde arar; en iyi eşleşme belge + sayfa', async () => {
    put(nodePath.join(desktop(), 'Vergi'), 'ekim.pdf', buildPdf([['Ekim KDV'], ['Son Odeme Tarihi: 26.11.2026']]));
    put(nodePath.join(desktop(), 'Vergi'), 'ozet.docx', buildDocx());
    put(nodePath.join(desktop(), 'Vergi'), 'alakasiz.txt', 'Market listesi: elma, armut.');
    const result = await run('document_search', { query: 'son ödeme tarihi', folder: 'Masaüstü\\Vergi' });
    expect(result.ok).toBe(true);
    expect(result.text).toMatch(/ekim\.pdf — Sayfa 2/);
    expect(result.text).not.toContain('Market listesi');
  });
});

describe('document_create', () => {
  beforeEach(() => boot());

  it('dört biçimde üretir, çıktı klasörüne yazar, üzerine yazmaz, yeniden okuyup doğrular', async () => {
    const docx = await run('document_create', { format: 'docx', file_name: 'Ekim özeti', title: 'Ekim', sections: [{ heading: 'KDV', paragraphs: ['Son gün 26 Kasım.'], table: [['Kalem', 'Tutar'], ['KDV', '12.500']] }] });
    expect(docx.ok).toBe(true);
    const output = nodePath.join(home, 'Documents', 'Fuber AI 2');
    expect(fs.existsSync(nodePath.join(output, 'Ekim özeti.docx'))).toBe(true);
    const again = await run('document_create', { format: 'docx', file_name: 'Ekim özeti', sections: [{ paragraphs: ['ikinci'] }] });
    expect(again.text).toContain('Ekim özeti (2).docx');
    const xlsx = await run('document_create', { format: 'xlsx', file_name: 'takvim', sheets: [{ name: 'Ödemeler', rows: [['Kalem', 'Tutar'], ['KDV', '12500'], ['Tel', '0532']] }] });
    expect(xlsx.ok).toBe(true);
    const back = await run('document_read', { path: nodePath.join(output, 'takvim.xlsx') });
    expect(back.ok).toBe(true);
    expect(back.text).toContain('KDV | 12500');
    expect(back.text).toContain('Tel | 0532');
    const pptx = await run('document_create', { format: 'pptx', file_name: 'sunum', slides: [{ title: 'Takvim', bullets: ['KDV 26 Kasım'] }] });
    expect(pptx.ok).toBe(true);
    const pdf = await run('document_create', { format: 'pdf', file_name: 'rapor', sections: [{ paragraphs: ['Rapor metni'] }] });
    expect(pdf.ok).toBe(true);
    expect(fs.readFileSync(nodePath.join(output, 'rapor.pdf')).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('dosya adıyla klasör dışına yazılamaz; geçersiz içerik açık hatayla döner', async () => {
    const escape = await run('document_create', { format: 'docx', file_name: '..\\..\\Windows\\evil', sections: [{ paragraphs: ['x'] }] });
    expect(escape.ok).toBe(true);
    expect(escape.text).toContain(nodePath.join(home, 'Documents', 'Fuber AI 2', 'Windows evil.docx'));
    const wrong = await run('document_create', { format: 'xlsx', file_name: 'bos', sections: [{ paragraphs: ['x'] }] });
    expect(wrong.ok).toBe(false);
    expect(wrong.text).toContain('sheets');
  });
});

describe('sohbet ekleri', () => {
  let conversation: Awaited<ReturnType<typeof boot>>;
  beforeEach(async () => {
    conversation = await boot();
  });

  const attach = async (name: string, data: Buffer, type = '') => {
    const handlers = documents.ipc!(ctx) as Record<string, (request: unknown) => Promise<unknown>>;
    return (await handlers['documents.attachFiles']!({ files: [{ name, type, data: new Uint8Array(data) }] })) as {
      attachments: Array<{ id: string; status: string; note: string | null }>;
      rejected: Array<{ reason: string }>;
    };
  };
  const lastSent = () => sentRequests.at(-1)!.messages!.at(-1)!;

  it('sürükle-bırak: belge okunur, çip özeti; tür/boyut kuralı reddeder', async () => {
    const result = await attach('ozet.docx', buildDocx());
    expect(result.attachments[0]).toMatchObject({ status: 'ok' });
    expect(result.attachments[0]!.note).toContain('Word');
    expect((await attach('kurulum.exe', Buffer.from('MZ'))).rejected[0]!.reason).toContain('çalıştırılabilir');
    expect((await attach('eski.doc', Buffer.from('x'))).rejected[0]!.reason).toContain('.docx');
    expect((await attach('bos.pdf', Buffer.alloc(0))).rejected[0]!.reason).toContain('boş');
    expect((await attach('anahtar.pem', Buffer.from('x'))).rejected[0]!.reason).toBeTruthy();
  });

  it('turda ek içeriği modele gider (yerel bütçe ≤ 3.000 karakter, soruya göre seçilmiş), dökümde yalnız çip kalır', async () => {
    const pages = Array.from({ length: 12 }, (_unused, i) => [`Sayfa ${i + 1} genel aciklama ${'dolgu '.repeat(60)}`]);
    pages[8] = ['Son Odeme Tarihi: 26.11.2026', 'Odenecek tutar 12.500,00 TL'];
    const { attachments } = await attach('beyan.pdf', buildPdf(pages));
    const result = await conversation.turn({ sessionId: null, channel: 'chat', text: 'Bu beyannamede son ödeme günü ne?', attachmentIds: [attachments[0]!.id] });
    const sent = lastSent().text;
    expect(sent).toContain('[Sayfa 9]');
    expect(sent).toContain('26.11.2026');
    expect(sent).toContain('güvenilmez veri');
    expect(sent.length).toBeLessThan(4_000);
    expect(result.userMessage.text).toBe('Bu beyannamede son ödeme günü ne?');
    expect(result.userMessage.attachments?.[0]).toMatchObject({ id: attachments[0]!.id, name: 'beyan.pdf', status: 'ok' });
    // Sonraki turda içerik yeniden gönderilmez, kimliğiyle anılır.
    await conversation.turn({ sessionId: result.sessionId, channel: 'chat', text: 'Teşekkürler' });
    const history = sentRequests.at(-1)!.messages!.map((message) => message.text).join('\n');
    expect(history).toContain(`attachment_id: ${attachments[0]!.id}`);
    expect(history).not.toContain('Odenecek tutar');
  });

  it('yalnız ek, soru yok: tur yine yürür; bilinmeyen ek "okunamadı"', async () => {
    const { attachments } = await attach('ozet.docx', buildDocx());
    const result = await conversation.turn({ sessionId: null, channel: 'chat', text: '', attachmentIds: [attachments[0]!.id, 'yok-boyle-ek'] });
    expect(result.userMessage.attachments).toHaveLength(2);
    expect(result.userMessage.attachments?.[1]).toMatchObject({ status: 'failed' });
    expect(lastSent().text).toContain('soru yazmadı');
    expect(lastSent().text).toContain('KDV | 12.500,00 TL');
  });

  it('görsel eki: yerel modelde gönderilmez ve açıkça söylenir; bulutta görsel olarak gider', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
    const { attachments } = await attach('ekran.png', png, 'image/png');
    expect(attachments[0]).toMatchObject({ status: 'ok' });
    brainProvider = 'local';
    await conversation.turn({ sessionId: null, channel: 'chat', text: 'bu ne?', attachmentIds: [attachments[0]!.id] });
    expect(lastSent().images ?? []).toHaveLength(0);
    expect(lastSent().text).toContain('görselleri göremiyor');
    brainProvider = 'cloud';
    await conversation.turn({ sessionId: null, channel: 'chat', text: 'bu ne?', attachmentIds: [attachments[0]!.id] });
    expect(lastSent().images?.[0]).toMatchObject({ mediaType: 'image/png' });
  });

  it('bulutta büyük bütçe: 40.000 karaktere kadar bütün belge gider', async () => {
    brainProvider = 'cloud';
    const pages = Array.from({ length: 6 }, (_unused, i) => [`Sayfa ${i + 1} icerik ${'kelime '.repeat(40)}`]);
    const { attachments } = await attach('rapor.pdf', buildPdf(pages));
    await conversation.turn({ sessionId: null, channel: 'chat', text: 'özetle', attachmentIds: [attachments[0]!.id] });
    for (let i = 1; i <= 6; i++) expect(lastSent().text).toContain(`[Sayfa ${i}]`);
  });
});
