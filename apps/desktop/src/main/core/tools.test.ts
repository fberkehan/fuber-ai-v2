import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  defineTool,
  LIMITS,
  t,
  localDay,
  type Bus,
  type BusEvents,
  type Logger,
  type ModuleContext,
  type Paths,
  type PolicyApi,
  type StageApi,
  type StageCard,
  type Store,
  type ToolOrigin,
  type ToolRegistry,
  type UsageRecord,
} from '@fuber/shared';
import { z } from 'zod';
import { createBus } from './bus';
import { createStore } from './store';
import { createTools, declareModule, failureLogReason, interpretApprovalSpeech, toAnthropicTool } from './tools';

const log: Logger = { debug() {}, info() {}, warn() {}, error() {}, child: () => log };
const voice: ToolOrigin = { channel: 'voice', speakerVerified: null };
const job: ToolOrigin = { channel: 'job', speakerVerified: null };

let dir: string;
let store: Store;
let bus: Bus;
let tools: ToolRegistry;
let events: Array<{ type: keyof BusEvents; payload: unknown }>;
let shown: Array<{ moduleId: string; card: StageCard }>;
let gate: { killSwitch: boolean; updateRequired: boolean; network: boolean; allowed: Set<string> };
let ran: string[];

const ctx = (moduleId: string) => ({ moduleId }) as ModuleContext;
const emitted = <K extends keyof BusEvents>(type: K) =>
  events.filter((event) => event.type === type).map((event) => event.payload as BusEvents[K]);
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const noteTools = [
  defineTool({
    name: 'note_read',
    description: 'Notu okur.',
    input: z.object({ id: z.string().min(1).describe('Not kimliği') }),
    risk: 'read',
    async run({ id }) {
      ran.push(`read:${id}`);
      return { ok: true, text: `not ${id}`, data: { id } };
    },
  }),
  defineTool({
    name: 'note_write',
    description: 'Not yazar.',
    input: z.object({ text: z.string(), pinned: z.boolean().default(false) }),
    risk: 'write',
    async run({ text, pinned }) {
      ran.push(`write:${text}:${pinned}`);
      return { ok: true, text: 'yazıldı', show: { title: 'Not', body: [{ type: 'text', text }] } };
    },
  }),
  defineTool({
    name: 'note_wipe',
    description: 'Bütün notları siler.',
    input: z.object({ scope: z.enum(['all', 'old']) }),
    risk: 'danger',
    approvalText: ({ scope }) => `Notları silmek istiyorum (${scope})`,
    async run({ scope }) {
      ran.push(`wipe:${scope}`);
      return { ok: true, text: 'silindi' };
    },
  }),
];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber2-tools-'));
  store = createStore({ paths: { db: path.join(dir, 'test.db') } as Paths, log });
  bus = createBus({ log });
  events = [];
  bus.onAny((type, payload) => void events.push({ type, payload }));
  shown = [];
  ran = [];
  gate = { killSwitch: false, updateRequired: false, network: true, allowed: new Set(['notes', 'web', 'workshop']) };
  const policy = {
    killSwitchActive: () => gate.killSwitch,
    updateRequired: () => gate.updateRequired,
    networkAllowed: () => gate.network,
    moduleAllowed: (id: string) => gate.allowed.has(id),
  } as PolicyApi;
  const stage = { showCard: (moduleId: string, card: StageCard) => void shown.push({ moduleId, card }) } as unknown as StageApi;
  tools = createTools({ store, policy, stage, bus, log });
  tools.register(ctx('notes'), noteTools);
});

afterEach(() => {
  vi.useRealTimers();
  tools.cancelAll();
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('kayıt', () => {
  it('zod şemasını JSON Schema ve Anthropic araç tanımına çevirir', () => {
    expect(tools.list().map((tool) => tool.name)).toEqual(['note_read', 'note_write', 'note_wipe']);
    expect(tools.has('note_read')).toBe(true);
    const [schema] = tools.schemas(['note_read', 'yok']);
    expect(schema).toEqual({
      name: 'note_read',
      description: 'Notu okur.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', minLength: 1, description: 'Not kimliği' } },
        required: ['id'],
      },
    });
    expect(toAnthropicTool(schema!)).toEqual({
      name: 'note_read',
      description: 'Notu okur.',
      input_schema: schema!.inputSchema,
      eager_input_streaming: true,
    });
    expect(tools.schemas()).toHaveLength(3);
  });

  it('ad çakışırsa fırlatır ve yarım kayıt bırakmaz', () => {
    const extra = defineTool({ name: 'note_extra', description: '', input: z.object({}), risk: 'read', run: async () => ({ ok: true, text: '' }) });
    expect(() => tools.register(ctx('other'), [extra, noteTools[0]!])).toThrow('zaten kayıtlı');
    expect(tools.has('note_extra')).toBe(false);
    expect(() => tools.register(ctx('other'), [{ ...extra, name: 'boşluklu ad' }])).toThrow('geçersiz araç adı');
  });

  it('kayıt geri alınabilir; modülün bütün araçları birlikte düşer', () => {
    const off = tools.register(ctx('other'), [
      defineTool({ name: 'other_a', description: '', input: z.object({}), risk: 'read', run: async () => ({ ok: true, text: '' }) }),
    ]);
    off();
    expect(tools.has('other_a')).toBe(false);
    tools.unregisterModule('notes');
    expect(tools.list()).toEqual([]);
    expect(tools.unregister('note_read')).toBe(false);
  });

  it('JSON Schema ile tanımlı dış aracı aynı kapıdan geçirir', async () => {
    tools.registerExternal(ctx('workshop'), {
      name: 'kur_cevir',
      description: 'Döviz çevirir.',
      inputSchema: {
        type: 'object',
        properties: { amount: { type: 'number', minimum: 0 }, to: { type: 'string', enum: ['USD', 'EUR'] } },
        required: ['amount', 'to'],
      },
      risk: 'read',
      run: async (input) => ({ ok: true, text: JSON.stringify(input) }),
    });
    expect(await tools.run('kur_cevir', { amount: 5, to: 'USD' }, { origin: voice })).toMatchObject({ ok: true, text: '{"amount":5,"to":"USD"}' });
    const bad = await tools.run('kur_cevir', { amount: -1, to: 'TRY' }, { origin: voice });
    expect(bad.ok).toBe(false);
    expect(bad.text).toContain('Araç girdisi geçersiz');
    expect(tools.schemas(['kur_cevir'])[0]!.inputSchema.required).toEqual(['amount', 'to']);
    expect(() =>
      tools.registerExternal(ctx('workshop'), { name: 'dizi', description: '', inputSchema: { type: 'array' }, risk: 'read', run: async () => ({ ok: true, text: '' }) }),
    ).toThrow('nesne şeması');
  });
});

describe('risk kapısı', () => {
  it('okuma serbesttir; girdi şemayla doğrulanır', async () => {
    expect(await tools.run('note_read', { id: 'a1' }, { origin: voice })).toEqual({ ok: true, text: 'not a1', data: { id: 'a1' } });
    const bad = await tools.run('note_read', { id: '' }, { origin: voice });
    expect(bad).toMatchObject({ ok: false });
    expect(bad.text).toContain('id');
    expect((await tools.run('yok_boyle', {}, { origin: voice })).text).toBe('“yok_boyle” adında bir araç yok.');
    expect(ran).toEqual(['read:a1']);
  });

  it('yazma onaysız çalışır, günlüğe girer, sonucu sahnede gösterilir', async () => {
    const result = await tools.run('note_write', { text: 'süt al' }, { origin: voice, callId: 'cagri-1' });
    expect(result.ok).toBe(true);
    expect(ran).toEqual(['write:süt al:false']);
    expect(emitted('tool.approval.request')).toHaveLength(0);
    expect(shown).toEqual([{ moduleId: 'notes', card: { title: 'Not', body: [{ type: 'text', text: 'süt al' }] } }]);
    expect(emitted('tool.call')).toMatchObject([
      { callId: 'cagri-1', name: 'note_write', moduleId: 'notes', risk: 'write', phase: 'start' },
      { callId: 'cagri-1', phase: 'end', ok: true },
    ]);
    expect(tools.recentCalls(5)).toMatchObject([
      { callId: 'cagri-1', name: 'note_write', risk: 'write', ok: true, text: 'yazıldı', input: { text: 'süt al', pinned: false }, approval: null, origin: voice },
    ]);
  });

  it('tehlikeli araç onay gelmeden çalışmaz; düğmeyle onaylanınca çalışır', async () => {
    const pendingRun = tools.run('note_wipe', { scope: 'all' }, { origin: voice });
    await tick();
    expect(ran).toEqual([]);
    const [request] = tools.pendingApprovals();
    expect(request).toMatchObject({ toolName: 'note_wipe', moduleId: 'notes', risk: 'danger', summary: 'Notları silmek istiyorum (all)', input: { scope: 'all' } });
    expect(Date.parse(request!.expiresAt) - Date.parse(request!.requestedAt)).toBe(LIMITS.approvalTimeoutMs);
    expect(emitted('tool.approval.request')).toEqual([request]);

    expect(tools.resolveApproval(request!.id, 'approved', 'ui')).toBe(true);
    expect(await pendingRun).toEqual({ ok: true, text: 'silindi' });
    expect(ran).toEqual(['wipe:all']);
    expect(emitted('tool.approval.resolve')).toEqual([{ id: request!.id, decision: 'approved', by: 'ui' }]);
    expect(tools.resolveApproval(request!.id, 'approved', 'ui')).toBe(false);
    expect(tools.recentCalls(1)[0]).toMatchObject({ approval: 'approved', ok: true });
  });

  it('aracın ret denetimi onaydan ÖNCE koşar: reddedilecek girdi için kart çıkmaz, neden döner; geçerli girdi yine onay ister', async () => {
    tools.register(ctx('notes'), [
      defineTool({
        name: 'note_purge',
        description: 'Notları kalıcı siler.',
        input: z.object({ scope: z.enum(['all', 'old']) }),
        risk: 'danger',
        refuse: ({ scope }) => (scope === 'all' ? 'Bütün notlar bir kerede silinemez.' : null),
        async run({ scope }) {
          ran.push(`purge:${scope}`);
          return { ok: true, text: 'silindi' };
        },
      }),
    ]);
    expect(await tools.run('note_purge', { scope: 'all' }, { origin: voice })).toEqual({ ok: false, text: 'Bütün notlar bir kerede silinemez.' });
    expect(tools.pendingApprovals()).toEqual([]);
    expect(emitted('tool.approval.request')).toEqual([]);
    expect(ran).toEqual([]);
    expect(tools.recentCalls(1)[0]).toMatchObject({ name: 'note_purge', ok: false, approval: null });

    const pendingRun = tools.run('note_purge', { scope: 'old' }, { origin: voice });
    await tick();
    expect(tools.pendingApprovals()).toHaveLength(1);
    tools.resolveApproval(tools.pendingApprovals()[0]!.id, 'approved', 'ui');
    expect(await pendingRun).toEqual({ ok: true, text: 'silindi' });
    expect(ran).toEqual(['purge:old']);
  });

  it('reddedilen tehlikeli araç çalışmaz ve sonucu bunu söyler', async () => {
    const pendingRun = tools.run('note_wipe', { scope: 'old' }, { origin: voice });
    await tick();
    tools.resolveApproval(tools.pendingApprovals()[0]!.id, 'denied', 'ui');
    expect(await pendingRun).toEqual({ ok: false, text: t('tool.error.denied') });
    expect(ran).toEqual([]);
    expect(tools.recentCalls(1)[0]).toMatchObject({ approval: 'denied', ok: false });
  });

  it('onay 60 saniyede gelmezse reddedilmiş sayılır ve araç sonucu bunu söyler', async () => {
    vi.useFakeTimers();
    const pendingRun = tools.run('note_wipe', { scope: 'all' }, { origin: voice });
    await vi.advanceTimersByTimeAsync(59_000);
    expect(tools.pendingApprovals()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await pendingRun).toEqual({ ok: false, text: 'Onay süresi doldu, yanıt gelmedi; iş yapılmadı.' });
    expect(ran).toEqual([]);
    expect(tools.pendingApprovals()).toEqual([]);
    expect(emitted('tool.approval.resolve')).toMatchObject([{ decision: 'expired', by: 'timeout' }]);
    expect(tools.recentCalls(1)[0]).toMatchObject({ approval: 'expired' });
  });

  it('modüller araç dışı iş için de onay isteyebilir', async () => {
    const decision = tools.requestApproval({ toolName: 'skill_enable', moduleId: 'workshop', summary: 'Yeni yetenek', input: null, origin: voice, timeoutMs: 20 });
    expect(tools.pendingApprovals()).toHaveLength(1);
    expect(await decision).toBe('expired');
  });

  it('konuşmacı doğrulanamadıysa yalnız okuyan araç çalışır', async () => {
    const stranger: ToolOrigin = { channel: 'voice', speakerVerified: false };
    expect((await tools.run('note_read', { id: 'a' }, { origin: stranger })).ok).toBe(true);
    expect(await tools.run('note_write', { text: 'x' }, { origin: stranger })).toEqual({ ok: false, text: 'Sesinizi tanıyamadım; bu işi yapamam.' });
    expect((await tools.run('note_wipe', { scope: 'all' }, { origin: stranger })).ok).toBe(false);
    expect(tools.pendingApprovals()).toEqual([]);
  });
});

describe('sözlü onay', () => {
  it.each([
    ['evet', 'approved'],
    ['Evet.', 'approved'],
    ['onaylıyorum', 'approved'],
    ['ONAYLIYORUM', 'approved'],
    ['evet onaylıyorum', 'approved'],
    ['onayla', 'approved'],
    ['evet onaylıyorum yap', 'approved'],
    ['evet, lütfen', 'approved'],
    ['kabul ediyorum', 'approved'],
    ['tamam onaylıyorum', 'approved'],
    // Gündelik sözler tek başına onay değildir.
    ['olur', 'unclear'],
    ['tamam', 'unclear'],
    ['yap', 'unclear'],
    ['tamam yap', 'unclear'],
    ['Tamam, yap.', 'unclear'],
    ['tabii', 'unclear'],
    ['kabul', 'unclear'],
    // Cümlenin içinde geçen "evet" ya da onay sözcüğü kabul değildir.
    ['bence evet', 'unclear'],
    ['evet ama bekle', 'unclear'],
    ['evet onu da sil', 'unclear'],
    ['onayla ama önce göster', 'unclear'],
    ['dün onayladım sanırım', 'unclear'],
    ['hayır', 'denied'],
    ['HAYIR', 'denied'],
    ['vazgeç', 'denied'],
    ['vazgeçtim', 'denied'],
    ['iptal', 'denied'],
    ['iptal et', 'denied'],
    ['yapma', 'denied'],
    ['yapmayın', 'denied'],
    ['hayır yapma', 'denied'],
    ['tamam vazgeç', 'denied'],
    ['onaylamıyorum', 'denied'],
    ['yapmıyoruz', 'denied'],
    ['onaylarım', 'approved'],
    ['olmaz', 'denied'],
    ['tamam sus', 'denied'],
    ['', 'unclear'],
    ['hava nasıl', 'unclear'],
    ['bilmiyorum', 'unclear'],
    ['yapacak mısın', 'unclear'],
    ['evet ama önce bana dosyaların listesini bir daha oku lütfen', 'unclear'],
  ] as const)('%j → %s', (text, verdict) => {
    expect(interpretApprovalSpeech(text)).toBe(verdict);
  });

  it('tek bekleyen onayı sonuçlandırır; anlaşılmayan söz hiçbir şeyi değiştirmez', async () => {
    expect(tools.resolveApprovalFromSpeech('evet')).toBe('unclear');
    const first = tools.run('note_wipe', { scope: 'all' }, { origin: voice });
    await tick();
    expect(tools.resolveApprovalFromSpeech('şey, bir dakika')).toBe('unclear');
    expect(tools.resolveApprovalFromSpeech('tamam')).toBe('unclear');
    expect(tools.pendingApprovals()).toHaveLength(1);
    expect(tools.resolveApprovalFromSpeech('Onaylıyorum')).toBe('approved');
    expect(await first).toEqual({ ok: true, text: 'silindi' });
    const second = tools.run('note_wipe', { scope: 'old' }, { origin: voice });
    await tick();
    expect(tools.resolveApprovalFromSpeech('hayır, vazgeç')).toBe('denied');
    expect((await second).ok).toBe(false);
    expect(ran).toEqual(['wipe:all']);
    expect(emitted('tool.approval.resolve').map((event) => [event.decision, event.by])).toEqual([
      ['approved', 'voice'],
      ['denied', 'voice'],
    ]);
  });

  it('birden çok onay bekliyorsa kimliksiz söz hiçbirini sonuçlandırmaz; kimlikle yalnız sorulan sonuçlanır', async () => {
    const first = tools.run('note_wipe', { scope: 'all' }, { origin: voice });
    const second = tools.run('note_wipe', { scope: 'old' }, { origin: voice });
    await tick();
    const [older, newer] = tools.pendingApprovals();
    expect(older && newer).toBeTruthy();
    expect(tools.resolveApprovalFromSpeech('onaylıyorum')).toBe('unclear');
    expect(tools.pendingApprovals()).toHaveLength(2);
    // Sorulan (yeni) onay: en eskisi değil.
    expect(tools.resolveApprovalFromSpeech('onaylıyorum', { approvalId: newer!.id })).toBe('approved');
    expect(await second).toEqual({ ok: true, text: 'silindi' });
    expect(ran).toEqual(['wipe:old']);
    expect(tools.pendingApprovals().map((a) => a.id)).toEqual([older!.id]);
    // Bilinmeyen kimlik hiçbir şeyi değiştirmez.
    expect(tools.resolveApprovalFromSpeech('hayır', { approvalId: 'yok-boyle-bir-onay' })).toBe('unclear');
    expect(tools.pendingApprovals()).toHaveLength(1);
    expect(tools.resolveApprovalFromSpeech('hayır', { approvalId: older!.id })).toBe('denied');
    expect((await first).ok).toBe(false);
  });
});

describe('acil durdurma, sürüm, bütçe, modül ve gizlilik kapısı', () => {
  it('acil durdurma açıkken hiçbir araç çalışmaz', async () => {
    gate.killSwitch = true;
    for (const [name, input] of [['note_read', { id: 'a' }], ['note_write', { text: 'x' }], ['note_wipe', { scope: 'all' }]] as const) {
      expect(await tools.run(name, input, { origin: voice })).toEqual({
        ok: false,
        text: 'Asistan Fuber Yönetim tarafından durduruldu; araçlar çalışmıyor.',
      });
    }
    expect(ran).toEqual([]);
    expect(tools.pendingApprovals()).toEqual([]);
    expect(await tools.requestApproval({ toolName: 'x', moduleId: 'notes', summary: 's', input: null, origin: voice })).toBe('denied');
    expect(tools.recentCalls(10)).toHaveLength(3);
  });

  it('acil durdurma etkinleşince bekleyen onay reddedilir ve koşan araç kesilir', async () => {
    let sawAbort = false;
    tools.register(ctx('notes'), [
      defineTool({
        name: 'note_slow',
        description: '',
        input: z.object({}),
        risk: 'read',
        run: (_input, toolCtx) =>
          new Promise(() => {
            toolCtx.signal.addEventListener('abort', () => {
              sawAbort = true;
            });
          }),
      }),
    ]);
    const slow = tools.run('note_slow', {}, { origin: voice });
    const wipe = tools.run('note_wipe', { scope: 'all' }, { origin: voice });
    await tick();
    gate.killSwitch = true;
    bus.emit('policy.changed', { revision: 2, source: 'remote', changedKeys: ['killSwitch'] });
    expect(await slow).toEqual({ ok: false, text: 'İş yarıda kesildi.' });
    expect((await wipe).ok).toBe(false);
    expect(sawAbort).toBe(true);
    expect(ran).toEqual([]);
    expect(emitted('tool.approval.resolve')).toMatchObject([{ decision: 'denied', by: 'system' }]);
  });

  it('onay beklenirken kapanan kapı, onaydan sonra da aracı çalıştırmaz', async () => {
    const wipe = tools.run('note_wipe', { scope: 'all' }, { origin: voice });
    await tick();
    gate.allowed.delete('notes');
    tools.resolveApproval(tools.pendingApprovals()[0]!.id, 'approved', 'ui');
    expect(await wipe).toEqual({ ok: false, text: 'Bu yetenek şu an kapalı.' });
    expect(ran).toEqual([]);
  });

  it('zorunlu güncelleme varken araç çalışmaz', async () => {
    gate.updateRequired = true;
    expect((await tools.run('note_read', { id: 'a' }, { origin: voice })).text).toContain('güncellenmesi gerekiyor');
  });

  it('günlük bütçe aşılınca yalnız sesli ve arayüz kökenli araçlar çalışır', async () => {
    const today = { day: localDay(), costUsd: 12, budgetUsd: 10, overBudget: true, calls: 9, byKind: {} };
    bus.emit('usage.recorded', { record: {} as UsageRecord, today });
    expect(await tools.run('note_read', { id: 'a' }, { origin: job })).toEqual({ ok: false, text: 'Bugünkü harcama sınırına ulaşıldı; bu iş yapılmadı.' });
    expect((await tools.run('note_read', { id: 'a' }, { origin: { channel: 'chat', speakerVerified: null } })).ok).toBe(false);
    expect((await tools.run('note_read', { id: 'a' }, { origin: voice })).ok).toBe(true);
    expect((await tools.run('note_read', { id: 'a' }, { origin: { channel: 'ui', speakerVerified: null } })).ok).toBe(true);
    // Dünün özeti bugünü bağlamaz.
    bus.emit('usage.recorded', { record: {} as UsageRecord, today: { ...today, day: '2020-01-01' } });
    expect((await tools.run('note_read', { id: 'a' }, { origin: job })).ok).toBe(true);
  });

  it('politikanın kapattığı modülün aracı çalışmaz; yetenekler Atölye iznine bağlıdır', async () => {
    gate.allowed.delete('notes');
    expect(await tools.run('note_read', { id: 'a' }, { origin: voice })).toEqual({ ok: false, text: 'Bu yetenek şu an kapalı.' });

    const skill = defineTool({ name: 'kur_soyle', description: '', input: z.object({}), risk: 'read', run: async () => ({ ok: true, text: '34' }) });
    tools.register(ctx('skill-kur'), [skill]);
    expect((await tools.run('kur_soyle', {}, { origin: voice })).ok).toBe(false);
    declareModule(tools, 'skill-kur', { permissions: [], policyId: 'workshop' });
    expect((await tools.run('kur_soyle', {}, { origin: voice })).ok).toBe(true);
    gate.allowed.delete('workshop');
    expect((await tools.run('kur_soyle', {}, { origin: voice })).ok).toBe(false);
  });

  it('Gizli kipte ağ izni isteyen modülün aracı çalışmaz', async () => {
    tools.register(ctx('web'), [
      defineTool({ name: 'web_search', description: '', input: z.object({}), risk: 'read', run: async () => ({ ok: true, text: 'sonuç' }) }),
    ]);
    declareModule(tools, 'web', { permissions: ['net'] });
    expect((await tools.run('web_search', {}, { origin: voice })).ok).toBe(true);
    gate.network = false;
    expect(await tools.run('web_search', {}, { origin: voice })).toEqual({ ok: false, text: 'Gizli kipte internet gerektiren işler yapılmıyor.' });
    expect((await tools.run('note_read', { id: 'a' }, { origin: voice })).ok).toBe(true);
  });
});

describe('çalıştırma', () => {
  it('fırlatan ya da geçersiz sonuç döndüren araç ok:false sonuca çevrilir', async () => {
    tools.register(ctx('notes'), [
      defineTool({ name: 'note_boom', description: '', input: z.object({}), risk: 'read', run: async () => Promise.reject(new Error('disk dolu')) }),
      defineTool({ name: 'note_odd', description: '', input: z.object({}), risk: 'read', run: async () => 'tamam' as never }),
    ]);
    expect(await tools.run('note_boom', {}, { origin: voice })).toEqual({ ok: false, text: 'Araç hata verdi: disk dolu' });
    expect((await tools.run('note_odd', {}, { origin: voice })).ok).toBe(false);
  });

  it('çağıranın iptali aracı keser; iptali dinlemeyen araç da beklenmez', async () => {
    tools.register(ctx('notes'), [
      defineTool({ name: 'note_hang', description: '', input: z.object({}), risk: 'read', run: () => new Promise(() => {}) }),
    ]);
    const controller = new AbortController();
    const hang = tools.run('note_hang', {}, { origin: voice, signal: controller.signal });
    await tick();
    controller.abort();
    expect(await hang).toEqual({ ok: false, text: 'İş yarıda kesildi.' });

    const second = tools.run('note_hang', {}, { origin: voice });
    await tick();
    bus.emit('app.panic', { at: new Date().toISOString(), source: 'hotkey' });
    expect((await second).ok).toBe(false);

    const already = new AbortController();
    already.abort();
    expect(await tools.run('note_read', { id: 'a' }, { origin: voice, signal: already.signal })).toEqual({ ok: false, text: 'İş yarıda kesildi.' });
    expect(ran).toEqual([]);
  });

  it('araca çağrı bağlamı verilir ve ara durum bildirimi çağırana ulaşır', async () => {
    const steps: string[] = [];
    let seen: { moduleId: string; callId: string; channel: string } | null = null;
    tools.register(ctx('notes'), [
      defineTool({
        name: 'note_ctx',
        description: '',
        input: z.object({}),
        risk: 'read',
        async run(_input, toolCtx) {
          toolCtx.report('yarısı bitti');
          seen = { moduleId: toolCtx.moduleId, callId: toolCtx.callId, channel: toolCtx.origin.channel };
          return { ok: true, text: 'bitti' };
        },
      }),
    ]);
    await tools.run('note_ctx', {}, { origin: job, callId: 'c9', onReport: (step) => void steps.push(step) });
    expect(steps).toEqual(['yarısı bitti']);
    expect(seen).toEqual({ moduleId: 'notes', callId: 'c9', channel: 'job' });
  });

  it('çağrı günlüğü yeniden eskiye döner ve yeniden açılışta kalır', async () => {
    await tools.run('note_read', { id: '1' }, { origin: voice });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await tools.run('note_read', { id: '' }, { origin: voice });
    const calls = tools.recentCalls(10);
    expect(calls.map((call) => [call.ok, call.input])).toEqual([
      [false, { id: '' }],
      [true, { id: '1' }],
    ]);
    expect(tools.recentCalls(1)).toHaveLength(1);
  });
});

describe('yapılmayan adımın günlük nedeni (demo.5)', () => {
  it('aracın cümlesinin ilk satırı, en çok 160 karakter; tırnak içi içerik ve e-posta günlüğe girmez', () => {
    expect(failureLogReason('Hedef bulunamadı: “Gönder” düğmesi ekranda yok.\nAyrıntı: gizli')).toBe('Hedef bulunamadı: … düğmesi ekranda yok.');
    expect(failureLogReason("Ahmet'e gönderilemedi: 'parola123' yazılamadı.")).toBe("Ahmet'e gönderilemedi: … yazılamadı.");
    expect(failureLogReason('ali@example.com adresine ulaşılamadı')).toBe('… adresine ulaşılamadı');
    expect(failureLogReason('x'.repeat(400))).toHaveLength(160);
    expect(failureLogReason('')).toBe('(neden yok)');
  });
});
