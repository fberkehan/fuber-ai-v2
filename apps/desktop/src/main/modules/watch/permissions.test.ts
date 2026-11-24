// v1 `tests/isler-izin.test.ts`ten taşındı ve v2'ye uyarlandı. v1'de görev adımı araç kullanan bir yapay zekâ turuydu ve
// izin kapsamı (kişiye WhatsApp, adrese e-posta, ekran, site) adımda onaysız gönderime izin veriyordu. v2'de gözcü
// yalnız OKUR: iş TEK onay kartıyla başlar; koşul tutunca çalışan okuma aracı onaysız, yazan araç HER SEFERİNDE yeniden
// onay ister. Taşınan kabuller: tek onay kartı (planın insan dili), reddedilince iş yok, adımda iş başlatma aracı yok,
// geçersiz plan modele düzeltme yoluyla döner.
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { defineTool, t, type ApprovalInput, type IpcHandlers, type ModuleContext, type NotifyRequest, type ToolOrigin } from '@fuber/shared';
import { z } from 'zod';
import { fakePolicy, loadModule, miniTools, moduleContext, tempStore, testBus } from '../../core/brain/testkit';
import watchModule from './index';
import type { WatchJob } from './types';

const root = path.join(process.cwd(), 'artifacts', `watch-perm-${process.pid}`);
beforeAll(() => fs.mkdirSync(root, { recursive: true }));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const chat: ToolOrigin = { channel: 'chat', sessionId: 'S1', speakerVerified: null };

let env: ReturnType<typeof tempStore>;
let ctx: ModuleContext;
let tools: ReturnType<typeof miniTools>;
let ipc: IpcHandlers;
let asked: ApprovalInput[];
let notes: NotifyRequest[];
let chatLines: string[];
let runs: string[];

beforeEach(async () => {
  env = tempStore();
  const bus = testBus();
  tools = miniTools();
  asked = [];
  notes = [];
  chatLines = [];
  runs = [];
  const queue = tools.approvals;
  tools.requestApproval = async (input: ApprovalInput) => {
    asked.push(input);
    return queue.shift() ?? 'denied';
  };
  ctx = moduleContext(
    'watch',
    {
      bus,
      tools,
      policy: fakePolicy(),
      paths: { data: path.join(root, 'veri') } as ModuleContext['paths'],
      attention: { notify: (request: NotifyRequest) => void notes.push(request), forgetModule: () => 0 } as unknown as ModuleContext['attention'],
      conversation: { appendMessage: (input: { text: string }) => void chatLines.push(input.text) } as unknown as ModuleContext['conversation'],
    },
    env.store,
  );
  // Koşul tutunca çalışacak sahte araçlar: biri okur, biri yazar.
  const helpers = moduleContext('helpers', { bus, tools }, env.store);
  tools.bind(helpers, [
    defineTool({ name: 'fake_read', description: 'okur', input: z.object({}), risk: 'read', run: async () => (runs.push('read'), { ok: true, text: 'okunan değer 42' }) }),
    defineTool({ name: 'fake_write', description: 'yazar', input: z.object({}), risk: 'write', run: async () => (runs.push('write'), { ok: true, text: 'gönderildi' }) }),
  ]);
  ipc = watchModule.ipc!(ctx);
  await loadModule(watchModule, ctx, env.store, tools);
});
afterEach(async () => {
  await watchModule.teardown?.();
  env.close();
});

const call = (name: keyof IpcHandlers, payload: unknown) => (ipc[name] as (value: unknown) => Promise<unknown> | unknown)(payload);

async function startFileJob(file: string, extra: Record<string, unknown> = {}) {
  tools.approvals.push('approved');
  const result = await tools.run('watch_start', { title: 'Rapor dosyası', source: 'file', target: file, condition: 'changed', ...extra }, { origin: chat });
  expect(result.ok, result.text).toBe(true);
  return (result.data as { id: string }).id;
}

describe('iş başlatma: tek onay kartı', () => {
  it('TEK onay kartı planın insan dilini taşır; reddedilince iş yok, onaylanınca iş başlar', async () => {
    tools.approvals.push('denied');
    const denied = await tools.run('watch_start', { title: 'Kulaklık fiyatı', source: 'time', target: new Date(Date.now() + 3_600_000).toISOString() }, { origin: chat });
    expect(denied.ok).toBe(false);
    expect(denied.text).toBe(t('watch.tool.denied'));
    expect(asked).toHaveLength(1);
    expect((await call('watch.list', {})) as WatchJob[]).toHaveLength(0);

    const file = path.join(root, 'onay.txt');
    const id = await startFileJob(file, { condition: 'appears', text: 'ONAYLANDI', hours: 2 });
    expect(asked).toHaveLength(2);
    const card = asked[1]!;
    expect(card).toMatchObject({ toolName: 'watch_start', moduleId: 'watch', origin: chat });
    expect(card.summary).toContain('Rapor dosyası');
    expect(card.summary).toContain('“onay.txt”');
    expect(card.summary).toContain('“ONAYLANDI” görününce');
    expect(card.summary).toContain(t('watch.plan.noModel'));
    expect(card.summary).toMatch(/Son tarih/);
    const job = (await call('watch.get', { id })) as WatchJob;
    expect(job).toMatchObject({ status: 'running', sessionId: 'S1', plan: { source: { kind: 'file' }, condition: { type: 'appears', text: 'ONAYLANDI' } } });
  });

  it('geçersiz plan modele düzeltme yoluyla döner ve onay kartı ÇIKMAZ', async () => {
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ source: 'whatsapp', target: 'Ahmet' }, /kaynak yok/],
      [{ source: 'page', target: 'http://127.0.0.1/' }, /izlenemez/],
      [{ source: 'page', target: 'file:///C:/gizli.txt' }, /izlenemez|geçerli/],
      [{ source: 'file', target: 'C:\\Users\\x\\AppData\\Roaming\\a.txt' }, /izlenmez/],
      [{ source: 'window', target: 'Outlook' }, /okuma izni kapalı/],
      [{ source: 'file', target: path.join(root, 'a.txt'), condition: 'below' }, /value/],
      [{ source: 'file', target: path.join(root, 'a.txt'), condition: 'matches', text: '(' }, /düzenli ifade/],
      [{ source: 'file', target: path.join(root, 'a.txt'), condition: 'ask' }, /ask/],
      [{ source: 'time', target: '2020-01-01T10:00:00Z' }, /geçmişte/],
      [{ source: 'file', target: path.join(root, 'a.txt'), then_tool: 'watch_start' }, /okuma aracı yok/],
    ];
    for (const [input, pattern] of cases) {
      const result = await tools.run('watch_start', { title: 'Deneme', ...input }, { origin: chat });
      expect(result.ok, JSON.stringify(input)).toBe(false);
      expect(result.text, JSON.stringify(input)).toMatch(pattern);
    }
    expect(asked).toHaveLength(0);
  });

  it('"düşünce" + eşik verilirse eşik koşuludur (yerel modelin sık verdiği biçim)', async () => {
    tools.approvals.push('approved');
    const result = await tools.run('watch_start', { title: 'Fiyat', source: 'file', target: path.join(root, 'fiyat.txt'), condition: 'drops', value: 1000, text: 'Fiyat' }, { origin: chat });
    const job = (await call('watch.get', { id: (result.data as { id: string }).id })) as WatchJob;
    expect(job.plan.condition).toEqual({ type: 'below', value: 1000, near: 'Fiyat' });
  });

  it('yakın yazımlar ve ölçülen yanlışlar düzeltilir: "asks", Claude kaynağında koşul, klasöre "dosya" gelince', async () => {
    const start = async (input: Record<string, unknown>) => {
      tools.approvals.push('approved');
      const result = await tools.run('watch_start', { title: 'Deneme', ...input }, { origin: chat });
      expect(result.ok, result.text).toBe(true);
      return ((await call('watch.get', { id: (result.data as { id: string }).id })) as WatchJob).plan.condition;
    };
    expect(await start({ source: 'claude', target: 'atlas', condition: 'asks', text: 'işini bitirince haber ver' })).toEqual({ type: 'changed' });
    expect(await start({ source: 'file', target: root, condition: 'appears', text: 'dosya' })).toEqual({ type: 'changed' });
    expect(await start({ source: 'file', target: path.join(root, 'b.txt'), condition: 'appear', text: 'TAMAM' })).toEqual({ type: 'appears', text: 'TAMAM' });
    const bad = await tools.run('watch_start', { title: 'Bozuk koşul', source: 'file', target: root, condition: 'whenever' }, { origin: chat });
    expect(bad.text).toMatch(/koşul yok/);
  });

  it('kaynak listesi: pencere okuma izni kapalıyken (araç kayıtlı değil) pencere kaynağı kullanılamaz görünür', async () => {
    const sources = (await call('watch.sources', undefined)) as Array<{ kind: string; unavailable: string | null }>;
    expect(sources.map((source) => source.kind)).toEqual(['time', 'page', 'file', 'window', 'claude']);
    expect(sources.find((source) => source.kind === 'window')!.unavailable).toBe(t('watch.source.windowOff'));
  });
});

describe('koşul tutunca eylem', () => {
  it('okuma aracı onaysız çalışır, sonucu habere eklenir; haber işi başlatan sohbete de yazılır', async () => {
    const file = path.join(root, 'okuma.txt');
    fs.writeFileSync(file, 'ilk');
    const id = await startFileJob(file, { then_tool: 'fake_read', speak: false });
    await call('watch.checkNow', { id });
    fs.writeFileSync(file, 'ikinci, daha uzun');
    const job = (await call('watch.checkNow', { id })) as WatchJob;
    expect(job).toMatchObject({ status: 'done', reason: 'matched' });
    expect(runs).toEqual(['read']);
    expect(asked).toHaveLength(1); // yalnız başlatma kartı
    expect(notes).toHaveLength(1);
    expect(notes[0]!.body).toContain('okunan değer 42');
    expect(notes[0]).toMatchObject({ priority: 'normal', speak: false });
    expect(chatLines[0]).toContain('Rapor dosyası');
  });

  it('yazan araç HER SEFERİNDE yeniden onay ister: reddedilirse çalışmaz, yalnız haber verilir; onaylanırsa çalışır', async () => {
    const file = path.join(root, 'yazma.txt');
    fs.writeFileSync(file, 'v0');
    const id = await startFileJob(file, { then_tool: 'fake_write', repeat: true });
    expect(asked[0]!.summary).toContain(t('watch.plan.thenToolAsk', { tool: 'fake_write' }));
    await call('watch.checkNow', { id });
    fs.writeFileSync(file, 'v1 değişti');
    tools.approvals.push('denied');
    await call('watch.checkNow', { id });
    expect(runs).toEqual([]);
    expect(asked).toHaveLength(2);
    expect(asked[1]!.summary).toBe(t('watch.action.approval', { title: 'Rapor dosyası', tool: 'fake_write' }));
    expect(notes[0]!.body).toContain(t('watch.action.denied'));
    fs.writeFileSync(file, 'v2 yine değişti, uzun');
    tools.approvals.push('approved');
    await call('watch.checkNow', { id });
    expect(runs).toEqual(['write']);
    expect(asked).toHaveLength(3);
  });

  it('iş araçları birbirini başlatamaz: eylem olarak watch_* verilemez', async () => {
    const result = await tools.run('watch_start', { title: 'Döngü', source: 'file', target: path.join(root, 'x.txt'), then_tool: 'watch_cancel' }, { origin: chat });
    expect(result.ok).toBe(false);
    expect(asked).toHaveLength(0);
  });
});

describe('araçlar: listele, durum, duraklat, sürdür, iptal', () => {
  it('sesle söylenen kısa kimlik ya da başlıkla bulunur; belirsizse kısa kimlik istenir', async () => {
    const a = await startFileJob(path.join(root, 'a1.txt'));
    tools.approvals.push('approved');
    await tools.run('watch_start', { title: 'Rapor klasörü', source: 'file', target: root }, { origin: chat });
    const list = await tools.run('watch_list', {}, { origin: chat });
    expect(list.text.split('\n')).toHaveLength(2);
    expect(list.text).toContain(`#${a.slice(-4)} Rapor dosyası: sürüyor`);
    const ambiguous = await tools.run('watch_pause', { job: 'rapor' }, { origin: chat });
    expect(ambiguous.ok).toBe(false);
    expect(ambiguous.text).toMatch(/Birden çok/);
    expect((await tools.run('watch_pause', { job: a.slice(-4).toLowerCase() }, { origin: chat })).ok).toBe(true);
    expect(((await call('watch.get', { id: a })) as WatchJob).status).toBe('paused');
    const status = await tools.run('watch_status', { job: 'dosyası' }, { origin: chat });
    expect(status.text).toContain(t('watch.reason.user'));
    expect((await tools.run('watch_resume', { job: 'dosyası' }, { origin: chat })).ok).toBe(true);
    expect((await tools.run('watch_cancel', { job: 'dosyası' }, { origin: chat })).text).toBe(t('watch.tool.cancelled', { title: 'Rapor dosyası' }));
    expect((await tools.run('watch_list', {}, { origin: chat })).text.split('\n')).toHaveLength(1);
    expect((await tools.run('watch_list', { all: true }, { origin: chat })).text).toContain('iptal edildi');
  });

  it('acil durdurma (app.panic) bütün gözcüleri duraklatır; sürdürme yeniden başlatır', async () => {
    const id = await startFileJob(path.join(root, 'acil.txt'));
    ctx.bus.emit('app.panic', { at: new Date().toISOString(), source: 'hotkey' });
    expect((await call('watch.get', { id })) as WatchJob).toMatchObject({ status: 'paused', reason: 'panic' });
    expect(((await call('watch.resume', { id })) as WatchJob).status).toBe('running');
  });
});
