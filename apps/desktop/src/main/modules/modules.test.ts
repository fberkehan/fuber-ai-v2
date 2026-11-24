import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Bus, BusEvents } from '@fuber/shared';
import { createJobs, INTERRUPTED_JOB_ERROR } from '../core/jobs';
import { createStage, validateStageApp } from '../core/stage';
import { createUsage } from '../core/usage';
import { costUsd } from '../core/usage-pricing';
import { createMemory } from '../core/memory';
import { fakePolicy, fakeVoice, loadModule, miniTools, moduleContext, silentLog, tempStore, testBus } from '../core/brain/testkit';
import memoryModule from './memory/index';
import stageModule from './stage/index';
import voiceControl from './voice-control/index';

let env: ReturnType<typeof tempStore>;
let bus: Bus;
beforeEach(() => {
  env = tempStore();
  bus = testBus();
});
afterEach(() => env.close());

const voice = { channel: 'voice' as const, speakerVerified: null };

describe('voice-control', () => {
  it('mikrofonu kapatır ve modele "Ctrl+Alt+M ile açarsınız" dedirtecek sonuç döner', async () => {
    const tools = miniTools();
    const fake = fakeVoice();
    await loadModule(voiceControl, moduleContext('voice-control', { bus, voice: fake }), env.store, tools);
    const result = await tools.run('voice_mute_mic', {}, { origin: voice });
    expect(result.ok).toBe(true);
    expect(result.text).toContain('Ctrl+Alt+M');
    expect(fake.calls).toContain('muteMic:');
    expect((await tools.run('voice_stop_speaking', {}, { origin: voice })).ok).toBe(true);
    expect(fake.calls).toContain('stopSpeaking');
    await tools.run('voice_set_quiet', { on: true }, { origin: voice });
    await tools.run('voice_pause_listening', { minutes: 30 }, { origin: voice });
    expect(fake.calls).toEqual(expect.arrayContaining(['setQuiet:true', 'pauseWake:30']));
    expect((await tools.run('voice_status', {}, { origin: voice })).text).toContain('Mikrofon kapalı');
  });
});

describe('sahne', () => {
  it('kart ve geçerli mini uygulama stage.show yayınlar; dış adresli uygulama reddedilir', async () => {
    const tools = miniTools();
    const stage = createStage({ bus, log: silentLog });
    const shown: Array<BusEvents['stage.show']> = [];
    bus.on('stage.show', (event) => void shown.push(event));
    await loadModule(stageModule, moduleContext('stage', { bus, stage }), env.store, tools);

    const card = await tools.run(
      'stage_show_card',
      { title: 'Plan', kind: 'progress', steps: [{ title: 'A', done: true }, { title: 'B', done: false }] },
      { origin: voice },
    );
    expect(card.ok).toBe(true);
    expect(shown[0]!.item).toMatchObject({ kind: 'card', card: { title: 'Plan' } });

    const html = '<div id="t">10</div><script>let n=10;setInterval(()=>{if(n>0)document.getElementById("t").textContent=--n},1000)</script>';
    const app = await tools.run('stage_show_app', { title: 'Geri sayım', html }, { origin: voice });
    expect(app.ok).toBe(true);
    const item = shown[1]!.item;
    expect(item.kind).toBe('app');
    if (item.kind === 'app') {
      expect(item.app.html).toContain('<html');
      expect(item.app.width).toBeGreaterThanOrEqual(160);
    }

    const remote = await tools.run(
      'stage_show_app',
      { title: 'x', html: '<script src="https://cdn.example.com/a.js"></script>' },
      { origin: voice },
    );
    expect(remote.ok).toBe(false);
    expect(shown).toHaveLength(2);
    expect(validateStageApp({ title: 'svg', html: '<svg xmlns="http://www.w3.org/2000/svg"></svg>', width: 200, height: 200 })).toBeNull();
    expect(validateStageApp({ title: 'big', html: 'x'.repeat(250_000), width: 200, height: 200 })).toMatch(/büyük/);

    await tools.run('stage_close', {}, { origin: voice });
    expect(stage.items()).toHaveLength(0);
  });
});

describe('hafıza araçları', () => {
  it('kaydet, ara, güncelle, unut', async () => {
    const tools = miniTools();
    const memory = createMemory({ store: env.store, bus, log: silentLog });
    await loadModule(memoryModule, moduleContext('memory', { bus, memory }), env.store, tools);
    const saved = await tools.run('memory_save', { text: 'Kullanıcının şirketi Atlas Limited, Ankara’da kurulu.', subject: 'Atlas' }, { origin: voice });
    const id = (saved.data as { id: string }).id;
    const found = await tools.run('memory_search', { query: 'atlas şirket' }, { origin: voice });
    expect((found.data as Array<{ id: string }>)[0]!.id).toBe(id);
    expect((await tools.run('memory_update', { id, text: 'Atlas Limited İzmir’de.' }, { origin: voice })).ok).toBe(true);
    expect((await tools.run('memory_forget', { id }, { origin: voice })).ok).toBe(true);
    expect(memory.get(id)).toBeNull();
    expect((await tools.run('memory_forget', { id }, { origin: voice })).ok).toBe(false);
    await memoryModule.teardown?.();
  });
});

describe('kullanım ve bütçe', () => {
  it('fiyat tablosu: önbellek okuma/yazma ayrı hesaplanır', () => {
    expect(costUsd('claude-opus-5-5', { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBeCloseTo(4);
    expect(costUsd('claude-opus-5-5', { inputTokens: 0, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBeCloseTo(20);
    expect(costUsd('claude-opus-5-5', { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000, cacheWriteTokens: 0 })).toBeCloseTo(0.2);
    expect(costUsd('claude-haiku-5-5', { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 80_000 })).toBeCloseTo(0.01, 6);
    // 100 bin tokenı aşan istem Haiku'da pahalı kartla faturalanır.
    expect(costUsd('claude-haiku-5-5', { inputTokens: 200_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBeCloseTo(0.1, 6);
    expect(costUsd('claude-fable-5-2', { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBeCloseTo(48);
    expect(costUsd('claude-sonnet-5-5', { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBeCloseTo(2);
    expect(costUsd('bilinmeyen', { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBeNull();
  });

  it('günlük toplam, bütçe kapısı ve yükleme kuyruğu', () => {
    const policy = fakePolicy({ limits: { dailyBudgetUsd: 1, maxAgentSteps: 10 } });
    const usage = createUsage({ store: env.store, policy, bus, log: silentLog });
    usage.record({ kind: 'voice', provider: 'anthropic', model: 'claude-haiku-5-5', inputTokens: 1000, outputTokens: 100, durationMs: 10 });
    expect(usage.overBudget()).toBe(false);
    usage.record({ kind: 'deep', provider: 'anthropic', model: 'claude-opus-5-5', inputTokens: 200_000, outputTokens: 20_000, durationMs: 10 });
    const today = usage.today();
    expect(today.calls).toBe(2);
    expect(today.costUsd).toBeCloseTo(0.0001 + 0.00005 + 0.8 + 0.4, 5);
    expect(today.overBudget).toBe(true);
    expect(usage.overBudget()).toBe(true);
    expect(today.byKind.deep?.calls).toBe(1);
    const pending = usage.pendingUpload(10);
    expect(pending).toHaveLength(2);
    usage.markUploaded(pending.map((record) => record.id));
    expect(usage.pendingUpload(10)).toHaveLength(0);
  });
});

describe('işler', () => {
  it('ilerleme olayları, iptal ve yeniden açılışta "yarıda kaldı"', async () => {
    const jobs = createJobs({ store: env.store, bus, log: silentLog });
    const progress: string[] = [];
    bus.on('job.progress', ({ job }) => void progress.push(`${job.status}:${job.step}`));
    const done = jobs.start({
      kind: 'test.ok',
      moduleId: 'test',
      title: 'Deneme',
      async run(control) {
        control.update({ progress: 0.5, step: 'Yarısı' });
        return 'sonuç';
      },
    });
    const finished = await jobs.wait(done.id);
    expect(finished).toMatchObject({ status: 'done', resultText: 'sonuç' });
    expect(progress).toContain('running:Yarısı');

    const hanging = jobs.start({
      kind: 'test.hang',
      moduleId: 'test',
      title: 'Asılı',
      run: (control) =>
        new Promise((_resolve, reject) => control.signal.addEventListener('abort', () => reject(new Error('iptal')))),
    });
    expect(jobs.cancel(hanging.id)).toBe(true);
    expect((await jobs.wait(hanging.id)).status).toBe('cancelled');

    // Süreç kapanmış gibi: "running" kalan kayıt yeni örnekte yarıda kalmış olur, kendiliğinden koşmaz.
    env.store.scoped('jobs').run(`UPDATE jobs_jobs SET status = 'running', finished_at = NULL WHERE id = ?`, [done.id]);
    const reopened = createJobs({ store: env.store, bus, log: silentLog });
    expect(reopened.get(done.id)).toMatchObject({ status: 'failed', error: INTERRUPTED_JOB_ERROR });
  });
});
