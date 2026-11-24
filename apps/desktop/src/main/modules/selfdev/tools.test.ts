import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApprovalInput, ToolCallRecord, ToolContext, ToolOrigin } from '@fuber/shared';
import { installSummary, runtime, selfdevTools } from './tools';
import type { SelfdevRun, SelfdevStatus } from './types';

const tool = (name: string) => selfdevTools.find((item) => item.name === name)!;

const baseRun = (patch: Partial<SelfdevRun> = {}): SelfdevRun => ({
  id: 'RUN00001', request: 'ses hattına yeni bir şey ekle', reason: 'ses hattı', origin: 'chat', status: 'ready', planSummary: 'Ses hattı değişecek.', planText: 'p', planFiles: [], planRisk: null,
  branch: 'selfdev/x', worktree: 'W', baseCommit: 'a', headCommit: 'b', files: ['a.ts', 'b.ts', 'c.ts'], riskFlags: [], checks: [
    { name: 'typecheck', command: 'typecheck', ok: false, exitCode: 1, durationMs: 1, tail: '', round: 0 },
    { name: 'typecheck', command: 'typecheck', ok: true, exitCode: 0, durationMs: 1, tail: '', round: 1 },
    { name: 'test', command: 'test', ok: true, exitCode: 0, durationMs: 1, tail: '', round: 1 },
  ], fixRounds: 1, fromVersion: '2.0.0-demo.3', version: '2.0.0-demo.3.dev.1', packagePath: 'P', error: null, createdAt: 'x', updatedAt: 'x', finishedAt: null,
  ...patch,
});

interface Setup {
  calls: ApprovalInput[];
  answer: { value: 'approved' | 'denied' | 'expired' };
  start: ReturnType<typeof vi.fn>;
  install: ReturnType<typeof vi.fn>;
  rollback: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  gateOpen: { value: boolean };
}

let setup: Setup;

beforeEach(() => {
  const answer: Setup['answer'] = { value: 'approved' };
  setup = {
    calls: [],
    answer,
    start: vi.fn(() => ({ ok: true, text: 'Başlattım.', run: baseRun({ status: 'queued' }) })),
    install: vi.fn(async () => ({ ok: true, text: 'Kuruluyor.' })),
    rollback: vi.fn(async () => ({ ok: true, text: 'Dönülüyor.' })),
    cancel: vi.fn(async () => ({ ok: true, text: 'Durdu.' })),
    gateOpen: { value: true },
  };
  const status = (): SelfdevStatus => ({
    gate: { open: setup.gateOpen.value, reason: setup.gateOpen.value ? null : 'Geliştirici kipi bu bilgisayarda kapalı.', policy: true, setting: setup.gateOpen.value, repoPath: null, repoOk: true },
    active: null,
    ready: baseRun(),
    versions: { current: '2.0.0-demo.3', previous: '2.0.0-demo.2', rollbackVia: 'snapshot', history: [] },
    pending: null,
    healthFailed: null,
    deep: { ok: true, reason: null },
    install: { ok: true, reason: null },
  });
  runtime.service = {
    gate: () => status().gate,
    status,
    runningVersion: () => '2.0.0-demo.3',
    store: { listRuns: () => [] },
    engine: { start: setup.start, install: setup.install, rollback: setup.rollback, cancel: setup.cancel, readyRun: () => baseRun(), rollbackTarget: () => ({ version: '2.0.0-demo.2', via: 'snapshot', snapshot: 'S', installer: null }) },
  } as never;
});
afterEach(() => {
  runtime.service = null;
});

function context(origin: Partial<ToolOrigin> = {}, recent: Array<Partial<ToolCallRecord>> = []): ToolContext {
  return {
    callId: 'CALL1',
    origin: { channel: 'voice', speakerVerified: null, sessionId: 'S1', ...origin },
    signal: new AbortController().signal,
    report() {},
    conversation: { messages: () => [{ role: 'user', at: new Date(Date.now() - 5_000).toISOString() }] },
    tools: {
      recentCalls: () => recent.map((call) => ({ callId: 'X', origin: { channel: 'voice', sessionId: 'S1', speakerVerified: null }, startedAt: new Date().toISOString(), ...call })),
      requestApproval: async (input: ApprovalInput) => {
        setup.calls.push(input);
        return setup.answer.value;
      },
    },
  } as unknown as ToolContext;
}

const develop = { request: 'Ana pencereye yeni bir bölüm ekle', reason: 'arayüz kabuğu' };

describe('core_develop kapıları', () => {
  it('kullanıcının sesi ya da yazısı: başlatır; yalnız başlatır ("güncelledim" demez)', async () => {
    const result = await tool('core_develop').run(develop, context({ channel: 'voice' }));
    expect(result.ok).toBe(true);
    expect(setup.start).toHaveBeenCalledWith({ request: develop.request, reason: develop.reason, origin: 'voice' });
    expect(result.text).toBe('Başlattım.');
    expect(setup.calls).toEqual([]);
    expect((await tool('core_develop').run(develop, context({ channel: 'chat' }))).ok).toBe(true);
    expect((await tool('core_develop').run(develop, context({ channel: 'ui', sessionId: undefined }))).ok).toBe(true);
  });

  it('arka plan işi ve eklenti kökenli çağrı REDDEDİLİR (dış içerik istek sayılmaz)', async () => {
    for (const channel of ['job', 'skill'] as const) {
      setup.start.mockClear();
      const result = await tool('core_develop').run(develop, context({ channel }));
      expect(result.ok, channel).toBe(false);
      expect(result.text).toMatch(/yalnız siz verebilirsiniz/);
      expect(setup.start).not.toHaveBeenCalled();
      expect(setup.calls).toEqual([]);
    }
  });

  it('tanınmayan ses reddedilir', async () => {
    const result = await tool('core_develop').run(develop, context({ channel: 'voice', speakerVerified: false }));
    expect(result.ok).toBe(false);
    expect(setup.start).not.toHaveBeenCalled();
  });

  it('aynı turda dış içerik okunduysa (web) AÇIK ONAY ister; reddedilirse başlamaz, onaylanırsa başlar', async () => {
    const tainted = context({ channel: 'voice' }, [{ name: 'web_read', moduleId: 'web' }]);
    setup.answer.value = 'denied';
    const denied = await tool('core_develop').run(develop, tainted);
    expect(denied.ok).toBe(false);
    expect(setup.calls).toHaveLength(1);
    expect(setup.calls[0]!.toolName).toBe('core_develop');
    expect(setup.calls[0]!.summary).toMatch(/web_read/);
    expect(setup.start).not.toHaveBeenCalled();
    setup.answer.value = 'approved';
    expect((await tool('core_develop').run(develop, tainted)).ok).toBe(true);
    expect(setup.start).toHaveBeenCalledTimes(1);
  });

  it('geliştirici kipi kapalıyken nedenini söyleyip reddeder; `refuse` onaydan önce de reddeder', async () => {
    setup.gateOpen.value = false;
    const result = await tool('core_develop').run(develop, context());
    expect(result.ok).toBe(false);
    expect(result.text).toMatch(/Çekirdek geliştirme kapalı.*bilgisayarda kapalı/);
    expect(setup.start).not.toHaveBeenCalled();
    expect((tool('core_develop').refuse as (input: unknown) => string | null)(develop)).toMatch(/kapalı/);
  });

  it('araç tanımları: kümesi workshop, riskleri doğru, açıklamalar örnek cümle taşır', () => {
    const byName = Object.fromEntries(selfdevTools.map((item) => [item.name, item]));
    expect(Object.keys(byName).sort()).toEqual(['core_cancel', 'core_develop', 'core_install', 'core_rollback', 'core_status']);
    expect(byName.core_develop!.risk).toBe('write');
    expect(byName.core_install!.risk).toBe('danger');
    expect(byName.core_rollback!.risk).toBe('danger');
    expect(byName.core_status!.risk).toBe('read');
    for (const item of selfdevTools) expect(item.group).toBe('workshop');
    expect(byName.core_develop!.description).toMatch(/skill_build/);
    expect(byName.core_install!.description).toMatch(/"kur"/);
    expect(byName.core_rollback!.description).toMatch(/önceki sürüme dön/);
    expect(byName.core_cancel!.description).toMatch(/vazgeç/);
    expect(byName.core_status!.description).toMatch(/güncelleme ne durumda/);
  });
});

describe('core_install: ikinci, bağımsız onay', () => {
  it('kendi onayını ister (sürüm + dosya sayısı + sınama sonucu); onaylanmazsa KURMAZ', async () => {
    for (const decision of ['denied', 'expired'] as const) {
      setup.answer.value = decision;
      setup.install.mockClear();
      const result = await tool('core_install').run({}, context({ channel: 'ui', sessionId: undefined }));
      expect(result.ok).toBe(false);
      expect(setup.install).not.toHaveBeenCalled();
    }
    expect(setup.calls).toHaveLength(2);
    const summary = setup.calls[0]!.summary;
    expect(summary).toContain('2.0.0-demo.3 sürümünden 2.0.0-demo.3.dev.1 sürümüne');
    expect(summary).toContain('3 dosya değişti');
    expect(summary).toContain('Sınamalar geçti (typecheck, test; 1 düzeltme turu)');
    expect(summary).toContain('yeniden açılacak');
  });

  it('onaylanınca kurar; arka plan işi, eklenti ve kapalı kapıda hiç sormadan reddeder', async () => {
    setup.answer.value = 'approved';
    const ok = await tool('core_install').run({}, context({ channel: 'voice' }));
    expect(ok.ok).toBe(true);
    expect(setup.install).toHaveBeenCalledWith('RUN00001');

    setup.install.mockClear();
    setup.calls.length = 0;
    for (const channel of ['job', 'skill'] as const) {
      const result = await tool('core_install').run({}, context({ channel }));
      expect(result.ok).toBe(false);
    }
    setup.gateOpen.value = false;
    expect((await tool('core_install').run({}, context({ channel: 'voice' }))).ok).toBe(false);
    expect(setup.install).not.toHaveBeenCalled();
    expect(setup.calls).toEqual([]);
  });

  it('dikkat işaretleri onay metnine girer', () => {
    const text = installSummary(baseRun({ riskFlags: ['güvenlik: çekirdek geliştirme motoru değişti (x)'] }), '2.0.0-demo.3');
    expect(text).toMatch(/Dikkat: güvenlik: çekirdek geliştirme motoru değişti/);
  });
});

describe('core_rollback ve core_cancel', () => {
  it('geri alma kendi onayını ister; onaylanmazsa dönmez', async () => {
    setup.answer.value = 'denied';
    expect((await tool('core_rollback').run({}, context())).ok).toBe(false);
    expect(setup.rollback).not.toHaveBeenCalled();
    expect(setup.calls[0]!.summary).toMatch(/2\.0\.0-demo\.3 sürümünden önceki 2\.0\.0-demo\.2 sürümüne/);
    setup.answer.value = 'approved';
    expect((await tool('core_rollback').run({}, context())).ok).toBe(true);
    expect(setup.rollback).toHaveBeenCalledTimes(1);
  });

  it('geri alma da dış kökenli çağrıda hiç sormadan reddeder', async () => {
    expect((await tool('core_rollback').run({}, context({ channel: 'job' }))).ok).toBe(false);
    expect(setup.calls).toEqual([]);
  });

  it('vazgeç koşuyu durdurur (onay gerekmez)', async () => {
    expect((await tool('core_cancel').run({}, context())).ok).toBe(true);
    expect(setup.cancel).toHaveBeenCalled();
  });

  it('durum: kapı, hazır güncelleme ve sürümleri söyler', async () => {
    const result = await tool('core_status').run({}, context());
    expect(result.text).toMatch(/Geliştirici kipi açık/);
    expect(result.text).toMatch(/2\.0\.0-demo\.3\.dev\.1, 3 dosya/);
    expect(result.text).toMatch(/Kurulu sürüm 2\.0\.0-demo\.3; önceki sürüm: 2\.0\.0-demo\.2/);
  });
});
