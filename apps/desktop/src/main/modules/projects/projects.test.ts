import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bus, ModuleContext, NotifyRequest } from '@fuber/shared';
import { loadModule, miniTools, moduleContext, silentLog, tempStore, testBus } from '../../core/brain/testkit';
import { finishDue } from './finish';
import { applyEntry, emptyAcc, parseLine, readNewLines, sessionTitle, type FileCursor } from './jsonl';
import { childEnv, escapeWt, launch, quoteCmd, resumeSpec, startSpec, wtSpec, type SpawnFn } from './launch';
import { decisive, rankCandidates, scoreName } from './match';
import { createProjectsModule } from './index';
import { createProjectsRepo, PROJECTS_MIGRATIONS } from './repo';
import { scanRoots } from './scanner';
import { createProjectsService, type ShellApi } from './service';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fuber2-t10-'));
const line = (obj: unknown) => `${JSON.stringify(obj)}\n`;
const user = (text: string, at: string, extra: Record<string, unknown> = {}) =>
  line({ type: 'user', message: { role: 'user', content: text }, timestamp: at, cwd: 'C:\\x', sessionId: 's', ...extra });
const assistant = (text: string, at: string, stop = 'end_turn') =>
  line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }], stop_reason: stop }, timestamp: at });
const toolUse = (at: string) =>
  line({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't', name: 'Bash', input: {} }], stop_reason: 'tool_use' }, timestamp: at });
const toolResult = (at: string) =>
  line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't', content: 'x'.repeat(100) }] }, timestamp: at });

async function collect(file: string, cursor: FileCursor) {
  const lines: Array<string | null> = [];
  const result = await readNewLines(file, cursor, { onLine: (value) => void lines.push(value), chunkBytes: 64 });
  return { lines, result };
}

describe('artımlı okuyucu', () => {
  let dir: string;
  beforeEach(() => (dir = tmp()));
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('yarım satırı işlemez, konumu onun önünde bırakır; tamamlanınca okur', async () => {
    const file = path.join(dir, 'a.jsonl');
    fs.writeFileSync(file, `${line({ n: 1 })}{"n": 2, "yar`);
    const first = await collect(file, { offset: 0, head: null });
    expect(first.lines).toEqual(['{"n":1}']);
    expect(first.result.cursor.offset).toBe(Buffer.byteLength(line({ n: 1 })));
    fs.appendFileSync(file, 'im": true}\n');
    const second = await collect(file, first.result.cursor);
    expect(second.lines).toEqual(['{"n": 2, "yarim": true}']);
    expect(second.result.reset).toBe(false);
  });

  it('dosya büyüyünce yalnız yeni satırları, CRLF ve çok baytlı harflerle okur (parça sınırında bölünse de)', async () => {
    const file = path.join(dir, 'b.jsonl');
    fs.writeFileSync(file, `{"t":"İstanbul şğüöçı"}\r\n`);
    const first = await collect(file, { offset: 0, head: null });
    expect(first.lines).toEqual(['{"t":"İstanbul şğüöçı"}']);
    fs.appendFileSync(file, `${'{"t":"' + 'ğ'.repeat(100) + '"}'}\n`);
    const second = await collect(file, first.result.cursor);
    expect(second.lines).toEqual([`{"t":"${'ğ'.repeat(100)}"}`]);
  });

  it('dosya küçülür ya da başı değişirse baştan okur', async () => {
    const file = path.join(dir, 'c.jsonl');
    fs.writeFileSync(file, line({ a: 1 }) + line({ a: 2 }));
    const first = await collect(file, { offset: 0, head: null });
    fs.writeFileSync(file, line({ b: 1 }));
    const shrunk = await collect(file, first.result.cursor);
    expect(shrunk.result.reset).toBe(true);
    expect(shrunk.lines).toEqual(['{"b":1}']);
    // Aynı boyda ama başka içerikle yeniden yazıldı.
    fs.writeFileSync(file, line({ c: 1 }) + line({ b: 2 }));
    const grown = await collect(file, shrunk.result.cursor);
    expect(grown.result.reset).toBe(true);
    expect(grown.lines).toEqual(['{"c":1}', '{"b":2}']);
  });

  it('çok uzun satırı ayrıştırmadan atlar, sonrasını okur', async () => {
    const file = path.join(dir, 'd.jsonl');
    fs.writeFileSync(file, `${line({ big: 'x'.repeat(5000) })}${line({ ok: 1 })}`);
    const lines: Array<string | null> = [];
    const result = await readNewLines(file, { offset: 0, head: null }, { onLine: (value) => void lines.push(value), chunkBytes: 256, maxLineBytes: 1000 });
    expect(lines).toEqual([null, '{"ok":1}']);
    expect(result.skippedLong).toBe(1);
  });

  it('bozuk JSON satırı sayılır ve atlanır; konum ilerler', () => {
    const acc = emptyAcc();
    expect(applyEntry(acc, parseLine('{bozuk'))).toBeNull();
    expect(acc.badLines).toBe(1);
    expect(applyEntry(acc, parseLine(user('merhaba', '2026-11-16T01:00:00Z').trim()))?.text).toBe('merhaba');
  });
});

describe('ayrıştırıcı', () => {
  it('kullanıcı ve asistan metnini alır; araç çağrısı/sonucu, meta, sistem hatırlatması dizine girmez', () => {
    const acc = emptyAcc();
    const lines = [
      user('<command-name>/review</command-name><command-args>pr 12</command-args>', '2026-11-16T01:00:00Z'),
      user('Ödeme sayfasını düzelt <system-reminder>gizli</system-reminder>', '2026-11-16T01:01:00Z'),
      user('meta', '2026-11-16T01:01:30Z', { isMeta: true }),
      toolUse('2026-11-16T01:02:00Z'),
      toolResult('2026-11-16T01:03:00Z'),
      line({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'düşünce' }], stop_reason: null }, timestamp: '2026-11-16T01:03:30Z' }),
      assistant('Düzelttim, testler geçti.', '2026-11-16T01:04:00Z'),
      line({ type: 'ai-title', aiTitle: 'Ödeme sayfası onarımı', sessionId: 's' }),
      line({ type: 'last-prompt', lastPrompt: 'x' }),
    ];
    const messages = lines.map((text) => applyEntry(acc, parseLine(text.trim()))).filter(Boolean);
    expect(messages.map((message) => message!.text)).toEqual(['/review pr 12', 'Ödeme sayfasını düzelt', 'Düzelttim, testler geçti.']);
    expect(acc.messageCount).toBe(3);
    expect(acc.lastRole).toBe('assistant');
    expect(acc.lastStop).toBe('end_turn');
    expect(acc.startedAt).toBe('2026-11-16T01:00:00Z');
    expect(acc.cwd).toBe('C:\\x');
    expect(sessionTitle(acc, null)).toBe('Ödeme sayfası onarımı');
    expect(sessionTitle(acc, 'Benim adım')).toBe('Benim adım');
  });

  it('yan zincir (alt ajan) satırları sayılmaz', () => {
    const acc = emptyAcc();
    applyEntry(acc, parseLine(user('alt', '2026-11-16T01:00:00Z', { isSidechain: true }).trim()));
    expect(acc.messageCount).toBe(0);
  });
});

describe('FTS ve depo', () => {
  let env: ReturnType<typeof tempStore>;
  beforeEach(() => {
    env = tempStore();
    env.store.migrate('projects', PROJECTS_MIGRATIONS);
  });
  afterEach(() => env.close());

  const add = (repo: ReturnType<typeof createProjectsRepo>, id: string, lastAt: string, texts: string[]) => {
    const acc = { ...emptyAcc(), cwd: 'C:\\p', lastAt, startedAt: lastAt, messageCount: texts.length, firstPrompt: texts[0] ?? null };
    repo.commitChunk(
      id,
      `C:\\c\\${id}.jsonl`,
      acc,
      texts.map((text, index) => ({ role: index % 2 ? ('assistant' as const) : ('user' as const), text, at: lastAt })),
      { offset: 1, size: 1, head: null, mtimeMs: 1 },
      null,
    );
  };

  it('sonuçlar ALAKA sırasıyla gelir (tarihe göre yeniden sıralanmaz), asistan metni de aranır, Türkçe katlama çalışır', () => {
    const repo = createProjectsRepo(env.store.scoped('projects'));
    const A = '11111111-1111-1111-1111-111111111111';
    const B = '22222222-2222-2222-2222-222222222222';
    const C = '33333333-3333-3333-3333-333333333333';
    // A en yeni ama "stripe" bir kez, uzun metin içinde; B eski ama yoğun.
    add(repo, A, '2026-11-16T10:00:00Z', ['Bugün çok iş var', `Biraz ${'dolgu '.repeat(80)} stripe`]);
    add(repo, B, '2026-10-01T10:00:00Z', ['Stripe webhook', 'Stripe webhook imzası doğrulandı, Stripe portal hazır']);
    add(repo, C, '2026-11-15T10:00:00Z', ['ISPARTA ŞUBESİ', 'İSTANBUL ofisi']);
    const hits = repo.searchSessions({ query: 'stripe', limit: 10 }).hits;
    expect(hits.map((hit) => hit.session.id)).toEqual([B, A]);
    expect(hits[0]!.snippet).toContain('[[Stripe]]');
    expect(hits[1]!.matchSeq).toBe(1);
    expect(repo.searchSessions({ query: 'istanbul', limit: 10 }).hits[0]?.session.id).toBe(C);
    expect(repo.searchSessions({ query: 'subesi', limit: 10 }).hits[0]?.session.id).toBe(C);
    // Önek araması (yazdıkça): "webh" → "webhook"
    expect(repo.searchSessions({ query: 'webh', limit: 10 }).hits[0]?.session.id).toBe(B);
  });

  it('sabitle, kategori, başlık, arşiv; süzgeçler; iletiler eşleşmenin çevresinden', () => {
    const repo = createProjectsRepo(env.store.scoped('projects'));
    const A = '11111111-1111-1111-1111-111111111111';
    add(repo, A, '2026-11-16T10:00:00Z', Array.from({ length: 50 }, (_, i) => (i === 40 ? 'iğne burada' : `satır ${i}`)));
    repo.updateSession(A, { pinned: true, category: ' Müşteri ', title: 'Elle verilen ad' });
    const session = repo.getSession(A);
    expect(session).toMatchObject({ pinned: true, category: 'Müşteri', title: 'Elle verilen ad' });
    expect(repo.categories()).toEqual(['Müşteri']);
    expect(repo.listSessions({ limit: 10, pinnedOnly: true }).total).toBe(1);
    expect(repo.listSessions({ limit: 10, category: 'Başka' }).total).toBe(0);
    expect(repo.searchSessions({ query: 'elle verilen', limit: 5 }).hits[0]?.session.id).toBe(A);
    const hit = repo.searchSessions({ query: 'iğne', limit: 5 }).hits[0]!;
    const page = repo.sessionMessages(A, { around: hit.matchSeq!, limit: 12 });
    expect(page.messages.some((message) => message.seq === 40)).toBe(true);
    expect(page.total).toBe(50);
    repo.updateSession(A, { archived: true });
    expect(repo.listSessions({ limit: 10 }).total).toBe(0);
    expect(repo.listSessions({ limit: 10, includeArchived: true }).total).toBe(1);
  });
});

describe('ad eşleştirme', () => {
  const projects = ['ATLAS', 'atlas-panel', 'ORBIT-WEB', 'orbit-us-site', 'study-blog', 'ORBIT-AI-2', 'ORBITFOOD', 'NightOwlChat'].map((name) => ({
    item: name,
    names: [name],
  }));
  const best = (query: string) => decisive(rankCandidates(query, projects));

  it('Türkçe/yaklaşık söyleyiş doğru projeyi bulur', () => {
    expect(best('atlas panel')).toBe('atlas-panel');
    expect(best('orbit web')).toBe('ORBIT-WEB');
    expect(best('study blog’u')).toBe('study-blog');
    expect(best('orbitweb projesini')).toBe('ORBIT-WEB');
    expect(best('naytiçet')).toBeNull();
    expect(best('night owl chat')).toBe('NightOwlChat');
    expect(best('orbit food')).toBe('ORBITFOOD');
  });

  it('belirsizse seçenek döner (karar vermez)', () => {
    const ranked = rankCandidates('orbit', projects);
    expect(ranked.length).toBeGreaterThan(2);
    expect(decisive(ranked)).toBeNull();
    expect(scoreName('atlas', 'ATLAS')).toBe(100);
  });
});

describe('komut satırları', () => {
  it('Windows Terminal: boşluklu ve Türkçe harfli klasör, ; kaçırılır, kimlik doğrulanır', () => {
    const cwd = 'C:\\Users\\ayse\\Projects\\Atlas\\çalışma;deneme';
    const spec = resumeSpec(cwd, '0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0', ['claude']);
    expect(spec.file).toBe('wt.exe');
    expect(spec.args).toEqual(['-w', 'new', '-d', 'C:\\Users\\ayse\\Projects\\Atlas\\çalışma\\;deneme', 'claude', '--resume', '0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0']);
    expect(() => resumeSpec(cwd, 'x; rm -rf /', ['claude'])).toThrow();
    expect(wtSpec('D:\\a b').args).toEqual(['-w', 'new', '-d', 'D:\\a b']);
    expect(escapeWt('a;b;c')).toBe('a\\;b\\;c');
  });

  it('wt yoksa cmd start yedeği tek satırlık doğru tırnaklı komut kurar', () => {
    const spec = startSpec('C:\\Projects\\Şirket', ['claude', '--resume', 'abc']);
    expect(spec.verbatim).toBe(true);
    expect(spec.args[0]).toBe('/d /s /c "start "" /D "C:\\Projects\\Şirket" claude --resume abc"');
    expect(quoteCmd('a b')).toBe('"a b"');
  });

  it('alt sürece anahtar, test sınırı ve iç içe Claude Code işareti gitmez', () => {
    const env = childEnv({ PATH: 'x', FUBER2_TEST: '1', ANTHROPIC_API_KEY: 'k', CLAUDECODE: '1', ELECTRON_RUN_AS_NODE: '1', USERPROFILE: 'u' });
    expect(env).toEqual({ PATH: 'x', USERPROFILE: 'u' });
  });
});

/** Sahte süreç: `exit` kodu, `error` ya da ayakta kalma. */
function fakeSpawn(behaviour: { exit?: number; error?: string; stderr?: string }, calls: Array<{ file: string; args: string[] }> = []): SpawnFn {
  return ((file: string, args: string[]) => {
    calls.push({ file, args });
    const child = new EventEmitter() as EventEmitter & { pid: number; unref(): void; stderr: EventEmitter & { destroy(): void } };
    child.pid = 4242;
    child.unref = () => {};
    child.stderr = Object.assign(new EventEmitter(), { destroy() {} });
    setTimeout(() => {
      if (behaviour.error) {
        const error = Object.assign(new Error(behaviour.error), { code: behaviour.error });
        child.emit('error', error);
      } else if (behaviour.exit !== undefined) {
        if (behaviour.stderr) child.stderr.emit('data', Buffer.from(behaviour.stderr));
        child.emit('exit', behaviour.exit);
      }
    }, 5);
    return child as never;
  }) as SpawnFn;
}

describe('süreç başlatma (dürüst sonuç)', () => {
  it('ayakta kalan ya da 0 ile çıkan süreç başarılı; diğerleri hata metniyle', async () => {
    expect((await launch({ file: 'x', args: [] }, { spawn: fakeSpawn({}), waitMs: 30 })).ok).toBe(true);
    expect((await launch({ file: 'x', args: [] }, { spawn: fakeSpawn({ exit: 0 }), waitMs: 30 })).ok).toBe(true);
    const failed = await launch({ file: 'x', args: [] }, { spawn: fakeSpawn({ exit: 2, stderr: 'bozuk argüman' }), waitMs: 30 });
    expect(failed).toMatchObject({ ok: false, error: 'bozuk argüman', code: 2 });
    const missing = await launch({ file: 'wt.exe', args: [] }, { spawn: fakeSpawn({ error: 'ENOENT' }), waitMs: 30 });
    expect(missing.ok).toBe(false);
    expect(missing.error).toContain('ENOENT');
  });
});

describe('proje taraması (sahte ağaç)', () => {
  let root: string;
  beforeEach(() => {
    root = tmp();
    const mk = (rel: string, files: Record<string, string> = {}) => {
      fs.mkdirSync(path.join(root, rel), { recursive: true });
      for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(root, rel, name), body);
    };
    mk('atlas-panel', { 'package.json': '{"dependencies":{"next":"1","react":"1"}}' });
    mk('atlas-panel/.git', { HEAD: 'ref: refs/heads/main\n' });
    mk('atlas-panel/packages/inner', { 'package.json': '{}' }); // proje içine inilmez
    mk('Mobil Uygulamalar/Şirket App', { 'pubspec.yaml': 'name: x' });
    mk('node_modules/paket', { 'package.json': '{}' }); // atlanır
    mk('yedek-2026/eski', { 'package.json': '{}' }); // yedek klasörü atlanır
    mk('a/b/c/d/e/derin', { 'go.mod': 'module x' }); // derinlik sınırı dışında
    mk('worktree', { '.git': 'gitdir: C:/repo/.git/worktrees/t1' }); // git çalışma ağacı atlanır
    mk('belgeler', { 'notlar.txt': 'x' });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('bildirim dosyası ve .git ile projeleri bulur, yığını ve dalı çıkarır', async () => {
    const result = await scanRoots([root], 4);
    const names = result.projects.map((project) => project.name).sort();
    expect(names).toEqual(['atlas-panel', 'Şirket App']);
    const panel = result.projects.find((project) => project.name === 'atlas-panel')!;
    expect(panel.stack).toEqual(expect.arrayContaining(['git', 'node', 'next', 'react']));
    expect(panel.gitBranch).toBe('main');
    expect(result.projects.find((project) => project.name === 'Şirket App')!.stack).toEqual(['flutter']);
  });
});

describe('bitiş bildirimi kuralı', () => {
  const rule = { idleSeconds: 20, activeMinutes: 10 };
  const T = Date.parse('2026-11-16T12:00:00Z');
  it('dosya 20 sn büyümediyse ve son 10 dakikada etkinse bitti sayılır', () => {
    const lastConvAt = new Date(T - 25_000).toISOString();
    expect(finishDue({ lastConvAt, fileMtime: T - 25_000 }, T, rule)).toBe(true);
    expect(finishDue({ lastConvAt, fileMtime: T - 5_000 }, T, rule)).toBe(false); // hâlâ yazıyor
    expect(finishDue({ lastConvAt: new Date(T - 11 * 60_000).toISOString(), fileMtime: T - 11 * 60_000 }, T, rule)).toBe(false); // eski
  });
});

describe('modül: dizinleme, bildirim, araçlar (yalıtılmış sahte klasörler)', () => {
  let env: ReturnType<typeof tempStore>;
  let home: string;
  let claudeDir: string;
  let projectsRoot: string;
  let bus: Bus;
  let notified: NotifyRequest[];
  let clock: number;
  let spawnCalls: Array<{ file: string; args: string[] }>;
  let opened: string[];
  const SID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

  beforeEach(() => {
    env = tempStore();
    home = tmp();
    claudeDir = path.join(home, '.claude', 'projects');
    projectsRoot = path.join(home, 'Projects');
    fs.mkdirSync(path.join(projectsRoot, 'ATLAS Panel'), { recursive: true });
    fs.writeFileSync(path.join(projectsRoot, 'ATLAS Panel', 'package.json'), '{}');
    fs.mkdirSync(path.join(projectsRoot, 'tarif-web', '.git'), { recursive: true });
    fs.mkdirSync(path.join(claudeDir, 'C--ATLAS-Panel'), { recursive: true });
    bus = testBus();
    notified = [];
    clock = Date.parse('2026-11-16T12:00:00Z');
    spawnCalls = [];
    opened = [];
  });
  afterEach(() => {
    env.close();
    fs.rmSync(home, { recursive: true, force: true });
  });

  const shell: ShellApi = {
    openPath: async (target) => {
      opened.push(target);
      return '';
    },
    openExternal: async () => {},
  };

  async function boot() {
    const ctx: ModuleContext = moduleContext(
      'projects',
      {
        bus,
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
      },
      env.store,
    );
    ctx.settings.update({ projectsRoot });
    const store = env.store;
    store.migrate('projects', PROJECTS_MIGRATIONS);
    const service = createProjectsService({
      ctx,
      shell,
      homeDir: home,
      spawn: fakeSpawn({ exit: 0 }, spawnCalls),
      launchWaitMs: 30,
      now: () => clock,
      background: false,
      vsCodePath: () => 'C:\\VSCode\\Code.exe',
    });
    const tools = miniTools();
    const mod = createProjectsModule(() => service);
    await loadModule(mod, ctx, env.store, tools);
    return { service, tools, mod, ctx };
  }

  const sessionFile = () => path.join(claudeDir, 'C--ATLAS-Panel', `${SID}.jsonl`);
  const voice = { channel: 'voice' as const, speakerVerified: null };

  it('dizinler, arar, sabitler; yeniden açılışta korunur; artımlı ekleme yalnız yeni satırı okur', async () => {
    const cwd = path.join(projectsRoot, 'ATLAS Panel');
    fs.writeFileSync(sessionFile(), user('Stripe ödeme akışını kur', '2026-11-16T11:58:00Z', { cwd }) + assistant('Kurdum, webhook hazır.', '2026-11-16T11:58:30Z'));
    let { service, mod } = await boot();
    await service.rescanProjects();
    await service.indexSessions();
    expect(service.indexStatus()).toMatchObject({ sessions: 1, messages: 2, state: 'idle' });
    const project = service.repo.listProjects().find((item) => item.name === 'ATLAS Panel')!;
    expect(service.repo.getSession(SID).projectId).toBe(project.id);
    expect(service.repo.searchSessions({ query: 'webhook', limit: 5 }).hits[0]?.session.id).toBe(SID);
    service.repo.updateSession(SID, { pinned: true, category: 'Ödeme' });
    await mod.teardown?.();

    ({ service, mod } = await boot());
    expect(service.repo.getSession(SID)).toMatchObject({ pinned: true, category: 'Ödeme' });
    fs.appendFileSync(sessionFile(), user('Şimdi testleri yaz', '2026-11-16T11:59:00Z', { cwd }) + '{"type":"assistant","yar');
    await service.indexSessions();
    expect(service.indexStatus().messages).toBe(3);
    fs.appendFileSync(sessionFile(), 'im":1}\n');
    await service.indexSessions();
    expect(service.indexStatus().messages).toBe(3);
    expect(service.repo.getSession(SID).messageCount).toBe(3);
    await mod.teardown?.();
  });

  it('oturum bitince bir kez bildirir (sahte saat); eylem "Terminalde aç" wt.exe ile --resume kurar', async () => {
    const cwd = path.join(projectsRoot, 'ATLAS Panel');
    fs.writeFileSync(sessionFile(), user('İlk iş', '2026-11-16T10:00:00Z', { cwd }) + assistant('Bitti.', '2026-11-16T10:00:10Z'));
    const { service, mod } = await boot();
    await service.rescanProjects();
    await service.indexSessions(); // ilk geçiş: eski turlar "görüldü"
    await service.checkFinished();
    expect(notified).toHaveLength(0);

    fs.appendFileSync(sessionFile(), user('Yeni iş', '2026-11-16T11:59:00Z', { cwd }) + toolUse('2026-11-16T11:59:05Z'));
    await service.indexSessions();
    clock = Date.parse('2026-11-16T12:00:00Z');
    await service.checkFinished();
    expect(notified).toHaveLength(0); // araç çağrısında: tur sürüyor

    const doneAt = new Date(Date.now() - 30_000).toISOString();
    fs.appendFileSync(sessionFile(), assistant('Yeni iş tamam.', doneAt));
    await service.indexSessions();
    clock = Date.now() + 1_000; // dosya son 20 sn içinde yazıldı → henüz değil
    await service.checkFinished();
    expect(notified).toHaveLength(0);
    clock = Date.now() + 25_000;
    await service.checkFinished();
    await service.checkFinished();
    expect(notified).toHaveLength(1);
    // demo.5: kullanıcının kendi oturumu da sesli duyurulur ve son asistan iletisinden sonucu taşır.
    expect(notified[0]).toMatchObject({ moduleId: 'projects', priority: 'high', data: { sessionId: SID } });
    expect(notified[0]!.title).toContain('ATLAS Panel');
    expect(notified[0]!.speak).toBe('ATLAS Panel projesindeki iş bitti. Yeni iş tamam.');
    expect(notified[0]!.body).toContain('Yeni iş tamam.');
    expect(notified[0]!.actions?.[0]).toMatchObject({ id: 'open' });

    bus.emit('attention.action', { id: 'n', moduleId: 'projects', actionId: 'open', data: { sessionId: SID } });
    await vi.waitFor(() => expect(spawnCalls).toHaveLength(1));
    expect(spawnCalls[0]).toEqual({ file: 'wt.exe', args: ['-w', 'new', '-d', cwd, 'claude', '--resume', SID] });
    await mod.teardown?.();
  });

  it('araçlar: project_find / project_open (belirsizde açmaz) / code_session_search; startTask bilinmeyen projede hata', async () => {
    fs.mkdirSync(path.join(projectsRoot, 'atlas-site'), { recursive: true });
    fs.writeFileSync(path.join(projectsRoot, 'atlas-site', 'package.json'), '{}');
    const { service, tools, mod, ctx } = await boot();
    await service.rescanProjects();
    const ambiguous = await tools.run('project_open', { name: 'atlas', in: 'editor' }, { origin: voice });
    expect(ambiguous.ok).toBe(false);
    expect(ambiguous.text).toContain('ATLAS Panel');
    expect(spawnCalls).toHaveLength(0);
    const found = await tools.run('project_find', { query: 'atlas panel' }, { origin: voice });
    expect((found.data as Array<{ name: string }>)[0]!.name).toBe('ATLAS Panel');
    const open = await tools.run('project_open', { name: 'atlas panelini', in: 'editor' }, { origin: voice });
    expect(open.ok).toBe(true);
    expect(spawnCalls[0]).toEqual({ file: 'C:\\VSCode\\Code.exe', args: [path.join(projectsRoot, 'ATLAS Panel')] });
    const explorer = await tools.run('project_open', { name: 'tarif web', in: 'explorer' }, { origin: voice });
    expect(explorer.ok).toBe(true);
    expect(opened).toEqual([path.join(projectsRoot, 'tarif-web')]);
    const recent = await tools.run('project_list_recent', {}, { origin: voice });
    expect((recent.data as Array<{ name: string }>)[0]!.name).toBe('tarif-web');
    const handlers = mod.ipc!(ctx);
    await expect(handlers['projects.startTask']!({ projectId: 'x', prompt: 'y' })).rejects.toThrow(/bulunamadı/);
    await mod.teardown?.();
  });
});
