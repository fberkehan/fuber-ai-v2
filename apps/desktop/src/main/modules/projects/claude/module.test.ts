// Modül düzeyi: asistan araçları, izin → onay akışı, bitiş bildirimi ve sohbet özeti, bilinen klasör kuralı, iş (job).
// Claude Code yerine sahte CLI (gerçek süreç, gerçek denetim protokolü); proje klasörleri geçici bir ev dizininde.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ApprovalDecision, ApprovalInput, ApprovalRequest, Job, JobSpec, ModuleContext, NotifyRequest, Paths, ToolOrigin } from '@fuber/shared';
import { loadModule, miniTools, moduleContext, silentLog, tempStore, testBus } from '../../../core/brain/testkit';
import { createWatchEngine } from '../../watch/engine';
import { WATCH_MIGRATIONS, createWatchRepo } from '../../watch/repo';
import { claudeSource } from '../../watch/sources';
import { createProjectsModule } from '../index';
import { PROJECTS_MIGRATIONS } from '../repo';
import { createProjectsService, type ProjectsService } from '../service';
import { createClaudeBridge, finishNotice, type ClaudeBridge } from './bridge';
import { modeForAuthority } from './tools';
import { fakeSessionCli, waitFor } from './testkit';
import type { LiveEnvelope, LiveSessionSummary } from './types';

interface PendingApproval {
  request: ApprovalRequest;
  settle(decision: ApprovalDecision): void;
}

describe('Claude Code oturum yönetimi: modül', () => {
  let env: ReturnType<typeof tempStore>;
  let home: string;
  let projectsRoot: string;
  let bridge: ClaudeBridge;
  let service: ProjectsService;
  let ctx: ModuleContext;
  let tools: ReturnType<typeof miniTools>;
  let mod: ReturnType<typeof createProjectsModule>;
  let notified: NotifyRequest[];
  let chat: Array<{ sessionId: string; role: string; text: string; channel: string }>;
  let approvals: PendingApproval[];
  let resolvedApprovals: Array<{ id: string; decision: string; by: string }>;
  let navigated: unknown[];
  let jobs: Array<{ spec: JobSpec; result: Promise<string>; abort: AbortController }>;
  let cliEnv: Record<string, string>;
  const voice: ToolOrigin = { channel: 'voice', sessionId: 'sohbet-ses-1', speakerVerified: null };
  const panel = () => path.join(projectsRoot, 'ATLAS Panel');
  const live = (id: string): LiveSessionSummary => bridge.manager.summary(id)!;
  const waitStatus = (id: string, status: LiveSessionSummary['status']) => waitFor(() => live(id)?.status === status, `durum ${status} (şimdi ${live(id)?.status})`);

  beforeEach(async () => {
    env = tempStore();
    home = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'fuber2-ccmod-')));
    projectsRoot = path.join(home, 'Projects');
    fs.mkdirSync(panel(), { recursive: true });
    fs.writeFileSync(path.join(panel(), 'package.json'), '{}');
    fs.mkdirSync(path.join(projectsRoot, 'atlas-site'), { recursive: true });
    fs.writeFileSync(path.join(projectsRoot, 'atlas-site', 'package.json'), '{}');
    fs.mkdirSync(path.join(projectsRoot, 'Şirket İşleri'), { recursive: true });
    fs.writeFileSync(path.join(projectsRoot, 'Şirket İşleri', 'package.json'), '{}');
    fs.mkdirSync(path.join(home, '.claude', 'projects'), { recursive: true });
    notified = [];
    chat = [];
    approvals = [];
    resolvedApprovals = [];
    navigated = [];
    jobs = [];
    cliEnv = {};
    const bus = testBus();
    bus.on('app.navigate', (payload) => void navigated.push(payload));
    tools = miniTools();
    // Yetki düzeyi "Sor": kip verilmeyen oturum her adımı sorar (izin akışının sınamaları bunu bekler; demo.5 öncesi varsayılan).
    Object.assign(tools, { authority: () => ({ level: 'ask', base: 'ask', max: 'full', grant: null }) });
    // Onay akışı gerçek kayıttaki gibi: istek bekler, düğme/ses sonuçlandırır.
    Object.assign(tools, {
      requestApproval(input: ApprovalInput): Promise<ApprovalDecision> {
        return new Promise((resolve) => {
          const request = { id: `onay-${approvals.length + 1}`, risk: 'danger', requestedAt: '', expiresAt: '', ...input } as ApprovalRequest;
          const entry: PendingApproval = {
            request,
            settle: (decision) => {
              const index = approvals.indexOf(entry);
              if (index === -1) return;
              approvals.splice(index, 1);
              resolve(decision);
            },
          };
          approvals.push(entry);
        });
      },
      pendingApprovals: () => approvals.map((entry) => entry.request),
      resolveApproval(id: string, decision: Exclude<ApprovalDecision, 'expired'>, by: string) {
        const entry = approvals.find((item) => item.request.id === id);
        if (!entry) return false;
        resolvedApprovals.push({ id, decision, by });
        entry.settle(decision);
        return true;
      },
    });
    ctx = moduleContext(
      'projects',
      {
        bus,
        tools,
        paths: { data: path.join(home, 'veri') } as Paths,
        attention: {
          start() {},
          stop() {},
          notify(request) {
            notified.push(request);
            return {} as never;
          },
          dismiss() {},
          act() {},
          pending: () => [],
          recent: () => [],
        },
        conversation: {
          appendMessage(input: { sessionId: string; role: string; text: string; channel: string }) {
            chat.push(input);
            return {} as never;
          },
        } as unknown as ModuleContext['conversation'],
        jobs: {
          start(spec: JobSpec) {
            const abort = new AbortController();
            const result = spec.run({ id: 'iş-1', signal: abort.signal, update() {} });
            result.catch(() => undefined);
            jobs.push({ spec, result, abort });
            return { id: 'iş-1', kind: spec.kind, title: spec.title, status: 'running' } as Job;
          },
        } as unknown as ModuleContext['jobs'],
      },
      env.store,
    );
    ctx.settings.update({ projectsRoot });
    env.store.migrate('projects', PROJECTS_MIGRATIONS);
    service = createProjectsService({ ctx, shell: { openPath: async () => '', openExternal: async () => {} }, homeDir: home, background: false, vsCodePath: () => null });
    mod = createProjectsModule(
      () => service,
      (context, svc) =>
        (bridge = createClaudeBridge({
          ctx: context,
          repo: svc.repo,
          homeDir: home,
          cli: fakeSessionCli(cliEnv),
          launchLogin: async () => null,
          timing: { settleMs: 0, interruptGraceMs: 600, closeGraceMs: 600, shutdownMs: 1500 },
        })),
    );
    await loadModule(mod, ctx, env.store, tools);
    await service.rescanProjects();
  });

  afterEach(async () => {
    await mod.teardown?.();
    env.close();
    await fs.promises.rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('araç adları ve riskleri: mevcut code_session ailesiyle aynı önek', () => {
    const risks = Object.fromEntries(tools.list().map((tool) => [tool.name, tool.risk]));
    expect(risks).toMatchObject({
      code_session_search: 'read',
      code_session_open: 'write',
      code_session_start: 'write',
      code_session_send: 'write',
      code_session_status: 'read',
      code_session_stop: 'write',
    });
  });

  it('kip verilmezse yetki düzeyine göre seçilir: Sor → ask, Akıllı → edits, Tam → (tam erişim kapalıyken) edits (demo.5)', async () => {
    expect(modeForAuthority('ask', true)).toBe('default');
    expect(modeForAuthority('smart', true)).toBe('acceptEdits');
    expect(modeForAuthority('full', false)).toBe('acceptEdits');
    expect(modeForAuthority('full', true)).toBe('bypassPermissions');
    Object.assign(tools, { authority: () => ({ level: 'smart', base: 'smart', max: 'full', grant: null }) });
    const started = await tools.run('code_session_start', { project: 'atlas-site', request: 'Merhaba' }, { origin: voice });
    expect(started.ok, started.text).toBe(true);
    expect(live((started.data as { id: string }).id).mode).toBe('acceptEdits');
  });

  it('sesle başlat (Türkçe ekli ad) → izin adada onaylanır → dosya yazılır → bitince bildirim, ses ve sohbete özet', async () => {
    const started = await tools.run('code_session_start', { project: 'Atlas panelinde', request: 'Şunu yaz #yaz:not.txt' }, { origin: voice });
    expect(started.ok).toBe(true);
    expect(started.text).toContain('ATLAS Panel');
    expect(started.text).toContain('Her şeyi sor');
    const id = (started.data as { id: string }).id;
    expect(live(id)).toMatchObject({ source: 'assistant', projectName: 'ATLAS Panel', mode: 'default' });

    // İzin isteği Dikkat Yöneticisine değil onay akışına düşer ("rahatsız etme" bunu susturmaz).
    const approval = await waitFor(() => approvals[0], 'onay isteği');
    expect(approval.request.summary).toContain('ATLAS Panel');
    expect(approval.request.summary).toContain('not.txt');
    expect(notified).toHaveLength(0);
    expect(fs.existsSync(path.join(panel(), 'not.txt'))).toBe(false);
    approval.settle('approved');
    await waitStatus(id, 'done');
    expect(fs.existsSync(path.join(panel(), 'not.txt'))).toBe(true);

    await waitFor(() => notified.length === 1, 'bitiş bildirimi');
    expect(notified[0]).toMatchObject({ moduleId: 'projects', priority: 'high', title: 'Claude Code bitirdi · ATLAS Panel', data: { liveId: id } });
    expect(notified[0]!.body).toContain('1 dosya değişti');
    expect(notified[0]!.body).toContain('Dosya yazıldı: not.txt.');
    expect(String(notified[0]!.speak)).toContain('ATLAS Panel projesindeki iş bitti');
    expect(chat).toEqual([{ sessionId: 'sohbet-ses-1', role: 'assistant', channel: 'voice', text: expect.stringContaining('Claude Code bitirdi · ATLAS Panel: 1 dosya değişti.') }]);

    // Bildirimdeki "Oturumu aç" sayfayı o oturuma götürür.
    ctx.bus.emit('attention.action', { id: 'b', moduleId: 'projects', actionId: 'claude.open', data: { liveId: id } });
    expect(navigated).toEqual([{ page: 'projects', params: { tab: 'sessions', live: id } }]);
  });

  it('izin reddi adadan; sayfadan yanıtlanan izinde adadaki kart kalkar', async () => {
    const first = await tools.run('code_session_start', { project: 'atlas panel', request: '#yaz:a.txt' }, { origin: voice });
    const id = (first.data as { id: string }).id;
    (await waitFor(() => approvals[0], 'onay')).settle('denied');
    await waitStatus(id, 'done');
    expect(fs.existsSync(path.join(panel(), 'a.txt'))).toBe(false);

    await tools.run('code_session_send', { message: '#yaz:b.txt', session: id }, { origin: voice });
    const approval = await waitFor(() => approvals[0], 'ikinci onay');
    const requestId = bridge.manager.detail(id)!.permissions[0]!.requestId;
    const handlers = mod.ipc!(ctx);
    expect(await handlers['projects.claudePermission']!({ id, requestId, answer: { decision: 'allow' } })).toEqual({ ok: true });
    expect(resolvedApprovals).toEqual([{ id: approval.request.id, decision: 'denied', by: 'ui' }]);
    await waitFor(() => fs.existsSync(path.join(panel(), 'b.txt')), 'dosya yazıldı');
  });

  it('"son oturuma devam et", durum sorgusu ve durdurma', async () => {
    const started = await tools.run('code_session_start', { project: 'şirket işleri', request: 'ilk iş' }, { origin: voice });
    const id = (started.data as { id: string }).id;
    expect(live(id).cwd).toBe(path.join(projectsRoot, 'Şirket İşleri'));
    await waitStatus(id, 'done');
    expect((await tools.run('code_session_status', {}, { origin: voice })).text).toMatch(/çalışan Claude Code oturumu yok\. Son oturum: Şirket İşleri · “ilk iş”: bitti/);

    const sent = await tools.run('code_session_send', { message: '#yavas:30' }, { origin: voice });
    expect(sent.ok).toBe(true);
    expect(sent.text).toContain('Şirket İşleri');
    await waitStatus(id, 'running');
    expect((await tools.run('code_session_status', { project: 'şirket işleri' }, { origin: voice })).text).toContain('çalışıyor');
    const stopped = await tools.run('code_session_stop', {}, { origin: voice });
    expect(stopped.text).toBe('1 Claude Code oturumu durduruldu.');
    await waitStatus(id, 'stopped');
    expect((await tools.run('code_session_stop', {}, { origin: voice })).text).toContain('Durdurulacak');
  });

  it('belirsiz ad başlatmaz; bilinmeyen proje ve oturum dürüstçe söylenir', async () => {
    const ambiguous = await tools.run('code_session_start', { project: 'atlas', request: 'x' }, { origin: voice });
    expect(ambiguous.ok).toBe(false);
    expect(ambiguous.text).toContain('ATLAS Panel');
    expect(ambiguous.text).toContain('atlas-site');
    expect((await tools.run('code_session_start', { project: 'olmayan şey', request: 'x' }, { origin: voice })).ok).toBe(false);
    expect((await tools.run('code_session_send', { message: 'x' }, { origin: voice })).text).toContain('bulunamadı');
    expect(bridge.manager.sessions()).toHaveLength(0);
  });

  it('Tam yetki: ayar kapalıyken başlamaz; açıkken açık onay ister, onaysız başlamaz', async () => {
    const off = await tools.run('code_session_start', { project: 'atlas panel', request: 'x', mode: 'full' }, { origin: voice });
    expect(off.ok).toBe(false);
    expect(off.text).toContain('Tam yetki kapalı');
    await bridge.setConfig({ fullAccess: true });

    const denied = tools.run('code_session_start', { project: 'atlas panel', request: 'x', mode: 'full' }, { origin: voice });
    const ask = await waitFor(() => approvals[0], 'tam yetki onayı');
    expect(ask.request.summary).toContain('TAM YETKİYLE');
    ask.settle('denied');
    expect((await denied).ok).toBe(false);
    expect(bridge.manager.sessions()).toHaveLength(0);

    const approved = tools.run('code_session_start', { project: 'atlas panel', request: '#bayraklar', mode: 'full' }, { origin: voice });
    (await waitFor(() => approvals[0], 'tam yetki onayı 2')).settle('approved');
    const result = await approved;
    expect(result.ok).toBe(true);
    expect(live((result.data as { id: string }).id).mode).toBe('bypassPermissions');

    // Ayar kapanınca Tam yetkideki oturum "Düzenlemelere izin ver"e iner.
    await waitStatus((result.data as { id: string }).id, 'done');
    await bridge.setConfig({ fullAccess: false });
    expect(live((result.data as { id: string }).id).mode).toBe('acceptEdits');
  });

  it('sayfadan: yalnız bilinen proje klasöründe açılır; izlenen oturumun bitişi bildirilmez; ayarlar kalıcı', async () => {
    const handlers = mod.ipc!(ctx);
    const outside = await handlers['projects.claudeStart']!({ cwd: home, prompt: 'x' });
    expect(outside).toMatchObject({ ok: false });
    const stray = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber2-yabancı-'));
    try {
      expect(await handlers['projects.claudeStart']!({ cwd: stray, prompt: 'x' })).toMatchObject({ ok: false, code: 'unknown_folder' });
    } finally {
      await fs.promises.rm(stray, { recursive: true, force: true });
    }
    const project = service.repo.listProjects().find((item) => item.name === 'ATLAS Panel')!;
    const started = (await handlers['projects.claudeStart']!({ projectId: project.id, prompt: 'selam' })) as { ok: boolean; session: LiveSessionSummary };
    expect(started.ok).toBe(true);
    expect(started.session).toMatchObject({ source: 'page', projectId: project.id });
    await handlers['projects.claudeWatch']!({ id: started.session.id });
    await waitStatus(started.session.id, 'done');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(notified).toHaveLength(0);
    expect(chat).toHaveLength(0);

    expect(await handlers['projects.claudeConfig']!({ patch: { defaultMode: 'acceptEdits', maxConcurrent: 99 } })).toMatchObject({ defaultMode: 'acceptEdits', maxConcurrent: 8, fullAccess: false });
    // Tam yetki kapalıyken varsayılan kip Tam yetki olamaz.
    expect(await handlers['projects.claudeConfig']!({ patch: { defaultMode: 'bypassPermissions' } })).toMatchObject({ defaultMode: 'default' });
    const environment = (await handlers['projects.claudeEnvironment']!()) as { installed: boolean; version: string; loggedIn: boolean };
    expect(environment).toMatchObject({ installed: true, version: '2.1.325', loggedIn: true });
  });

  it('olaylar pencereye gider; arka plan işi (projects.startTask) oturum bitince biter, iptalde oturumu durdurur', async () => {
    const seen: LiveEnvelope[] = [];
    ctx.bus.on('projects.claudeEvent', (envelope) => void seen.push(envelope));
    expect(mod.windowEvents).toContain('projects.claudeEvent');
    const handlers = mod.ipc!(ctx);
    const project = service.repo.listProjects().find((item) => item.name === 'ATLAS Panel')!;
    const job = (await handlers['projects.startTask']!({ projectId: project.id, prompt: 'kısa iş' })) as Job;
    expect(job).toMatchObject({ kind: 'projects.code_task', title: 'Claude Code · ATLAS Panel' });
    expect(await jobs[0]!.result).toContain('Merhaba! Sahte Claude Code yanıtı: kısa iş');
    expect(seen.some((envelope) => envelope.event.type === 'status')).toBe(true);

    await handlers['projects.startTask']!({ projectId: project.id, prompt: '#yavas:30' });
    const running = await waitFor(() => bridge.manager.sessions().find((item) => item.status === 'running'), 'çalışan oturum');
    jobs[1]!.abort.abort();
    await expect(jobs[1]!.result).rejects.toThrow(/durduruldu/);
    expect(live(running.id).status).toBe('stopped');
  });

  it('dizindeki (kapalı) oturuma ileti: kaldığı yerden --resume ile sürer; güven kararı yoksa araç bunu söyler', async () => {
    const sessionId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const folder = path.join(home, '.claude', 'projects', 'C--ATLAS-Panel');
    fs.mkdirSync(folder, { recursive: true });
    const line = (value: unknown) => `${JSON.stringify(value)}\n`;
    fs.writeFileSync(
      path.join(folder, `${sessionId}.jsonl`),
      line({ type: 'user', message: { role: 'user', content: 'Ödeme sayfasını kur' }, timestamp: '2026-11-15T10:00:00Z', cwd: panel(), sessionId }) +
        line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Kurdum.' }], stop_reason: 'end_turn' }, timestamp: '2026-11-15T10:00:30Z' }),
    );
    await service.indexSessions();
    expect(service.repo.getSession(sessionId).cwd).toBe(panel());

    // Dökümü az önce yazılmış oturum "şu an başka yerde açık" sayılır: sürdürülmez, nedeni söylenir.
    const busy = await tools.run('code_session_send', { project: 'atlas panelindeki', message: 'x' }, { origin: voice });
    expect(busy.ok).toBe(false);
    expect(busy.text).toContain('başka bir yerde');
    const old = new Date(Date.now() - 10 * 60_000);
    fs.utimesSync(path.join(folder, `${sessionId}.jsonl`), old, old);

    const sent = await tools.run('code_session_send', { project: 'atlas panelindeki', message: 'şunu söyle #bayraklar' }, { origin: voice });
    expect(sent.ok).toBe(true);
    expect(sent.text).toContain('ATLAS Panel');
    const id = (sent.data as { id: string }).id;
    await waitStatus(id, 'done');
    expect(live(id)).toMatchObject({ sessionId, source: 'assistant' });
    const flags = bridge.manager.detail(id)!.events.map((envelope) => (envelope.event.type === 'text' ? envelope.event.text : '')).join('');
    expect(flags).toContain(`"--resume","${sessionId}"`);
    // Aynı oturuma ikinci ileti yeni süreç açmaz: canlı kayda gider.
    const again = await tools.run('code_session_send', { session: sessionId, message: 'devam' }, { origin: voice });
    expect((again.data as { id: string }).id).toBe(id);
    expect(bridge.manager.sessions()).toHaveLength(1);

    fs.mkdirSync(path.join(projectsRoot, 'atlas-site', '.claude'), { recursive: true });
    fs.writeFileSync(path.join(projectsRoot, 'atlas-site', '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: ['Bash(*)'] } }));
    const untrusted = await tools.run('code_session_start', { project: 'atlas site', request: '#bayraklar' }, { origin: voice });
    expect(untrusted.ok).toBe(true);
    expect(untrusted.text).toContain('güven kararı verilmediği için yüklenmedi');
    const untrustedId = (untrusted.data as { id: string }).id;
    await waitStatus(untrustedId, 'done');
    expect(live(untrustedId).untrusted).toBe(true);
  });

  // ── demo.3 bütünleştirmesi: İşler modülünün "Claude bitirince haber ver" işi ile bu modülün bitiş bildirimi ──
  describe('takip işiyle birlikte: aynı bitiş TEK kez bildirilir', () => {
    /** Gerçek gözcü motoru ve gerçek Claude Code kaynağı, aynı olay yolunda; bildirimleri aynı listeye düşer. */
    const withWatchJob = () => {
      env.store.migrate('watch', WATCH_MIGRATIONS);
      // Bekleme geniş: yük altında (bütün sınamalar koşarken) projeler modülünün bildirimi 1,5 sn'yi aşabiliyor.
      const source = claudeSource(ctx.bus, () => Date.now(), { announceWaitMs: 8_000 });
      const engine = createWatchEngine({
        repo: createWatchRepo(env.store.scoped('watch')),
        sources: () => [source],
        judge: async () => null,
        notify: (request) => void notified.push(request),
        appendChat: (sessionId, channel, text) => void chat.push({ sessionId, role: 'assistant', text, channel }),
        runAction: async () => ({ ok: true, text: '' }),
        killSwitchActive: () => false,
        emit() {},
        log: silentLog,
        now: () => Date.now(),
        setTimer: (run, ms) => setTimeout(run, ms),
        clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      });
      engine.start();
      const job = engine.create({
        title: 'Claude bitince haber ver',
        goal: '',
        plan: {
          source: { kind: 'claude', target: 'atlas' },
          condition: { type: 'changed' },
          repeat: false,
          speak: true,
          untilAt: new Date(Date.now() + 3_600_000).toISOString(),
          interval: { minSec: 30, maxSec: 600 },
          maxModelCalls: 0,
          action: null,
        },
        sessionId: 'sohbet-ses-1',
        channel: 'voice',
      });
      return {
        engine,
        job,
        dispose() {
          engine.stop();
          source.dispose();
        },
      };
    };
    const count = (moduleId: string) => notified.filter((item) => item.moduleId === moduleId).length;

    it('projeler modülü duyurduysa iş ayrıca bildirim göndermez; iş yine "gerçekleşti" diye biter', async () => {
      const watch = withWatchJob();
      try {
        const handlers = mod.ipc!(ctx);
        const project = service.repo.listProjects().find((item) => item.name === 'ATLAS Panel')!;
        const started = (await handlers['projects.claudeStart']!({ projectId: project.id, prompt: 'selam' })) as { ok: boolean; session: LiveSessionSummary };
        await waitStatus(started.session.id, 'done');
        await waitFor(() => watch.engine.get(watch.job.id)?.status === 'done', 'takip işi bitti', 15_000);
        expect(watch.engine.get(watch.job.id)).toMatchObject({ status: 'done', reason: 'matched', finding: expect.stringContaining('ATLAS Panel') });
        // TEK haber: özetli, "Oturumu aç" düğmeli ve sesli olan projeler bildirimi.
        expect(count('projects')).toBe(1);
        expect(count('watch')).toBe(0);
        expect(notified[0]).toMatchObject({ moduleId: 'projects', title: 'Claude Code bitirdi · ATLAS Panel' });
        // İşi başlatan sohbete işin satırı yine yazılır (işin kaydı).
        expect(chat.filter((line) => line.text.includes('Claude bitince haber ver'))).toHaveLength(1);
      } finally {
        watch.dispose();
      }
    }, 30_000);

    it('projeler modülü duyurmadıysa (kullanıcı oturumu sayfada izliyor) haberi iş verir', async () => {
      const watch = withWatchJob();
      try {
        const handlers = mod.ipc!(ctx);
        const project = service.repo.listProjects().find((item) => item.name === 'ATLAS Panel')!;
        const started = (await handlers['projects.claudeStart']!({ projectId: project.id, prompt: 'selam' })) as { ok: boolean; session: LiveSessionSummary };
        await handlers['projects.claudeWatch']!({ id: started.session.id });
        await waitStatus(started.session.id, 'done');
        await waitFor(() => watch.engine.get(watch.job.id)?.status === 'done', 'takip işi bitti', 15_000);
        expect(count('projects')).toBe(0);
        expect(count('watch')).toBe(1);
        expect(notified[0]).toMatchObject({ moduleId: 'watch', priority: 'high' });
      } finally {
        watch.dispose();
      }
    }, 30_000);
  });

  it('klasör güveni: kendi ayarı olan klasörde sayfa karar ister; karar kaydedilince açılır', async () => {
    fs.mkdirSync(path.join(panel(), '.claude'), { recursive: true });
    fs.writeFileSync(path.join(panel(), '.claude', 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'echo x' }] }] } }));
    const handlers = mod.ipc!(ctx);
    const blocked = (await handlers['projects.claudeStart']!({ cwd: panel(), prompt: '#bayraklar' })) as { ok: boolean; code: string; trust: { required: boolean; files: unknown[] } };
    expect(blocked).toMatchObject({ ok: false, code: 'trust_required' });
    expect(blocked.trust.required).toBe(true);
    expect(blocked.trust.files.length).toBeGreaterThan(0);
    expect(await handlers['projects.claudeTrust']!({ cwd: panel(), decision: 'distrust' })).toMatchObject({ decision: 'distrust', decidedBy: 'user' });
    const untrusted = (await handlers['projects.claudeStart']!({ cwd: panel(), prompt: '#bayraklar' })) as { ok: boolean; session: LiveSessionSummary };
    await waitStatus(untrusted.session.id, 'done');
    expect(live(untrusted.session.id).untrusted).toBe(true);
    expect(await handlers['projects.claudeTrust']!({ cwd: panel(), decision: 'trust' })).toMatchObject({ decision: 'trust' });
    const trusted = (await handlers['projects.claudeStart']!({ cwd: panel(), prompt: '#bayraklar' })) as { ok: boolean; session: LiveSessionSummary };
    await waitStatus(trusted.session.id, 'done');
    expect(live(trusted.session.id).untrusted).toBeUndefined();
    const flags = bridge.manager.detail(trusted.session.id)!.events.map((envelope) => (envelope.event.type === 'text' ? envelope.event.text : '')).join('');
    expect(flags).toContain('"--setting-sources","user,project,local"');
  });
});

describe('bitiş duyurusunun sonucu (demo.5)', () => {
  it('son iletiden 1–2 cümle, en çok 240 karakter; kod, yol, liste ve anahtar söylenmez; hata nedeni söylenir', () => {
    const lastText = [
      '## Özet',
      'Giriş sayfasındaki hata düzeltildi ve testler geçti. Yeni doğrulama `validateEmail` ile yapılıyor. Üçüncü cümle söylenmez.',
      '- src/login/form.tsx değişti',
      '- C:\\Users\\x\\proje\\app.ts',
      '```ts',
      'const key = "sk-" + "abcdefghijklmnopqrstuvwxyz";',
      '```',
    ].join('\n');
    const done = finishNotice({ project: 'Atlas', changed: 2, lastText, result: { ok: true, interrupted: false } as never, background: 0 });
    expect(done.speak).toBe('Atlas projesindeki iş bitti; 2 dosya değişti. Giriş sayfasındaki hata düzeltildi ve testler geçti. Yeni doğrulama ile yapılıyor.');
    expect(done.body).not.toContain('form.tsx');
    expect(done.body).not.toContain('sk-');
    const long = finishNotice({ project: 'Atlas', changed: 0, lastText: `${'a'.repeat(300)}.`, result: { ok: true, interrupted: false } as never, background: 0 });
    expect(long.speak.length).toBeLessThanOrEqual(300);
    const failed = finishNotice({ project: 'Atlas', changed: 0, lastText: '', result: { ok: false, interrupted: false, error: 'Derleme başarısız oldu.' } as never, background: 0 });
    expect(failed.speak).toBe('Atlas projesindeki iş hatayla bitti. Derleme başarısız oldu.');
  });
});
