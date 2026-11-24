// Projeler modülü (KURGU §10): proje dizini, Claude Code oturum dizini (FTS5, sabitle, kategori),
// "Terminalde aç" (Windows Terminal + `claude --resume`), oturum bitince bildirim.
// Claude Code iki yoldan kullanılır: "Terminalde aç" (gerçek terminal) ve uygulama içi oturum yönetimi (`claude/`):
// oturum başlat, ileti gönder, araya gir, izin onayla, durdur. İkisi de CLI'nin kendi istemi ve ayarlarıyla çalışır.
import os from 'node:os';
import { defineModule, defineTool, ftsQuery, t, UserError, type ModuleContext, type ModuleDef, type ToolResult } from '@fuber/shared';
import { z } from 'zod';
import { testing } from '../../testing';
import { locateClaudeCli } from '../../core/claude-cli/locate';
import { createClaudeBridge, type ClaudeBridge } from './claude/bridge';
import { gitDiff, gitSummary, matchFiles, projectFiles } from './claude/git';
import { claudeTools } from './claude/tools';
import type { LiveEnvelope } from './claude/types';
import './claude/types';
import { launch } from './launch';
import { rankCandidates } from './match';
import { PROJECTS_MIGRATIONS, ProjectsError } from './repo';
import { createProjectsService, type ProjectsService, type ShellApi } from './service';
import type { ProjectDetail } from './types';
import './types';

/** İkinci argüman: dizinin "oturum bitti" bildirimi uygulamanın yönettiği oturumlarda yinelenmesin diye. */
export type ServiceFactory = (ctx: ModuleContext, managed: (sessionId: string) => boolean) => Promise<ProjectsService> | ProjectsService;
export type BridgeFactory = (ctx: ModuleContext, service: ProjectsService) => ClaudeBridge;

/** Ev klasörü: sınamada `FUBER2_PROJECTS_HOME` verildiyse o (gerçek `~/.claude` okunmaz). */
const projectsHome = (): string => (testing.enabled && testing.projectsHome ? testing.projectsHome : os.homedir());

const electronShell = async (): Promise<ShellApi> => {
  const { shell } = await import('electron');
  return { openPath: (target) => shell.openPath(target), openExternal: (url) => shell.openExternal(url) };
};

const defaultFactory: ServiceFactory = async (ctx, managed) =>
  testing.fakeLaunch
    ? // Sınama sınırı: VS Code, Gezgin ve terminal gerçekten açılmaz; başlatmalar kaydedilir.
      createProjectsService({ ctx, shell: testing.fakeShell, homeDir: projectsHome(), spawn: testing.fakeSpawn, launchWaitMs: 50, vsCodePath: () => 'code.exe', managed })
    : createProjectsService({ ctx, shell: await electronShell(), homeDir: projectsHome(), managed, locateClaude: locateClaudeCli });

const defaultBridgeFactory: BridgeFactory = (ctx, service) =>
  createClaudeBridge({
    ctx,
    repo: service.repo,
    homeDir: projectsHome(),
    // Sınama sınırı: sınamada Claude Code yalnız açıkça verilirse vardır (kotadan harcanmasın).
    cli: testing.claudeCli,
    launchLogin: async (command) => {
      const outcome = await launch(
        { file: command.command, args: [...command.prefixArgs, 'auth', 'login'] },
        testing.fakeLaunch ? { spawn: testing.fakeSpawn, waitMs: 50 } : {},
      );
      return outcome.ok ? null : (outcome.error ?? '?');
    },
  });

function lastAssistantText(bridge: ClaudeBridge, liveId: string): string {
  const events = bridge.manager.detail(liveId)?.events ?? [];
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]!.event;
    if (event.type === 'text' && event.parent === null) return event.text.slice(0, 2000);
  }
  return '';
}

/** Canlı oturumu bir arka plan işine bağlar: iş, oturumun turu bitince biter; iptal edilirse oturum durdurulur. */
function watchAsJob(ctx: ModuleContext, bridge: ClaudeBridge, liveId: string, control: { signal: AbortSignal; update(change: { step?: string }): void }): Promise<string> {
  return new Promise((resolve, reject) => {
    const finish = (run: () => void) => {
      off();
      control.signal.removeEventListener('abort', onAbort);
      run();
    };
    const onAbort = () => void bridge.manager.interrupt(liveId);
    const check = (envelope: LiveEnvelope) => {
      if (envelope.session !== liveId) return;
      const event = envelope.event;
      if (event.type === 'tool_start') control.update({ step: event.summary.slice(0, 120) });
      if (event.type === 'forgotten') finish(() => reject(new Error(t('claude.op.sessionClosed'))));
      if (event.type !== 'status') return;
      const { status, error } = event.summary;
      if (status === 'done') finish(() => resolve(lastAssistantText(bridge, liveId)));
      else if (status === 'stopped' || status === 'closed') finish(() => reject(new Error(t('claude.op.stopped'))));
      else if (status === 'error' || status === 'limit') finish(() => reject(new Error(error ?? t('claude.notify.unknownError'))));
    };
    const off = ctx.bus.on('projects.claudeEvent', check);
    control.signal.addEventListener('abort', onAbort, { once: true });
  });
}

const targetSchema = z.enum(['editor', 'explorer', 'terminal', 'claude']);

function brief(project: ProjectDetail) {
  return {
    id: project.id,
    name: project.name,
    path: project.path,
    stack: project.stack,
    aliases: project.aliases,
    pinned: project.pinned,
    last_session_at: project.lastSessionAt,
  };
}

const wrap = async <T>(fn: () => T | Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ProjectsError) throw new UserError(error.message);
    throw error;
  }
};

export function createProjectsModule(factory: ServiceFactory = defaultFactory, bridgeFactory: BridgeFactory = defaultBridgeFactory): ModuleDef {
  let service: ProjectsService | null = null;
  let pending: Promise<ProjectsService> | null = null;
  let bridge: ClaudeBridge | null = null;
  const managed = (sessionId: string): boolean => bridge?.manager.manages(sessionId) ?? false;
  const get = async (ctx: ModuleContext): Promise<ProjectsService> => {
    if (service) return service;
    pending ??= Promise.resolve(factory(ctx, managed)).then((created) => (service = created));
    return pending;
  };
  const getBridge = async (ctx: ModuleContext): Promise<ClaudeBridge> => {
    const svc = await get(ctx);
    bridge ??= bridgeFactory(ctx, svc);
    return bridge;
  };

  const guard = async (ctx: ModuleContext, run: (svc: ProjectsService) => Promise<ToolResult> | ToolResult): Promise<ToolResult> => {
    try {
      return await run(await get(ctx));
    } catch (error) {
      if (error instanceof ProjectsError) return { ok: false, text: error.message };
      throw error;
    }
  };

  const tools = [
    defineTool({
      name: 'project_find',
      group: 'projects',
      description:
        'Kullanıcının yazılım projelerini adla bulur ("atlas panel", "tarif web", "kitap blogu"). Söylenen ad yaklaşık olabilir; ' +
        'birden çok aday varsa hepsi döner, kullanıcıya hangisi olduğunu sor. Kullanıcı bir projeyi adıyla andığında ve hangi klasör olduğu gerektiğinde kullan.',
      input: z.object({ query: z.string().min(1).describe('Projenin söylendiği gibi adı') }),
      risk: 'read',
      run: ({ query }, ctx) =>
        guard(ctx, (svc) => {
          const found = svc.find(query);
          if (found.kind === 'none') return { ok: false, text: t('projects.tool.notFound', { query }) };
          if (found.kind === 'one') return { ok: true, text: t('projects.tool.foundOne', { name: found.project.name, path: found.project.path }), data: [brief(found.project)] };
          return {
            ok: true,
            text: t('projects.tool.foundMany', { names: found.options.map((option) => option.item.name).join(', ') }),
            data: found.options.map((option) => brief(option.item)),
          };
        }),
    }),
    defineTool({
      name: 'project_open',
      group: 'projects',
      description:
        'Projeyi açar. in: "editor" (VS Code), "explorer" (klasör), "terminal" (Windows Terminal), "claude" (o klasörde ' +
        'Windows Terminal içinde Claude Code başlatır). Ad yaklaşık olabilir; birden çok aday çıkarsa açmaz, seçenekleri döndürür. ' +
        'Açıldığını ancak bu araç başarılı dönerse söyle. "Projeyi aç", "VS Code\'da aç", "terminalde aç" denince kullan.',
      input: z.object({
        name: z.string().min(1).describe('Projenin adı ya da kimliği'),
        in: targetSchema.default('editor').describe('Nerede açılacak'),
      }),
      risk: 'write',
      run: ({ name, in: target }, ctx) =>
        guard(ctx, async (svc) => {
          const byId = svc.repo.listProjects().find((project) => project.id === name);
          const found = byId ? ({ kind: 'one', project: byId } as const) : svc.find(name);
          if (found.kind === 'none') return { ok: false, text: t('projects.tool.notFound', { query: name }) };
          if (found.kind === 'many') {
            return {
              ok: false,
              text: t('projects.tool.ambiguous', { names: found.options.map((option) => option.item.name).join(', ') }),
              data: found.options.map((option) => brief(option.item)),
            };
          }
          const result = await svc.openProject(found.project.id, target);
          return { ok: result.ok, text: result.message, data: brief(found.project) };
        }),
    }),
    defineTool({
      name: 'project_list_recent',
      description: 'Son çalışılan ve sabitlenmiş projeleri listeler. "Son projelerim neler", "hangi projelerde çalışıyordum" sorularında kullan.',
      input: z.object({ limit: z.number().int().min(1).max(20).optional() }),
      risk: 'read',
      run: ({ limit }, ctx) =>
        guard(ctx, (svc) => {
          const list = svc.repo
            .listProjects()
            .sort((a, b) => {
              if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
              const at = (project: ProjectDetail) => Math.max(...[project.lastOpenedAt, project.lastSessionAt].map((value) => (value ? Date.parse(value) : 0)));
              return at(b) - at(a);
            })
            .slice(0, limit ?? 8);
          if (list.length === 0) return { ok: true, text: t('projects.tool.empty'), data: [] };
          return { ok: true, text: t('projects.tool.recent', { names: list.map((project) => project.name).join(', ') }), data: list.map(brief) };
        }),
    }),
    defineTool({
      name: 'code_session_search',
      group: 'code',
      description:
        'Kullanıcının Claude Code oturumlarında (kendi istekleri ve Claude\'un yanıtları) tam metin arar. "Dün ödeme sayfası için ' +
        'konuştuğumuz oturum" gibi isteklerde kullan. Alakaya göre sıralı döner.',
      input: z.object({
        query: z.string().min(1),
        project: z.string().optional().describe('Yalnız bu projenin oturumları (ad)'),
        limit: z.number().int().min(1).max(10).optional(),
      }),
      risk: 'read',
      run: ({ query, project, limit }, ctx) =>
        guard(ctx, (svc) => {
          let projectId: string | undefined;
          if (project) {
            const found = svc.find(project);
            if (found.kind === 'one') projectId = found.project.id;
          }
          if (!ftsQuery(query)) return { ok: false, text: t('projects.tool.badQuery') };
          const { hits } = svc.repo.searchSessions({ query, ...(projectId ? { projectId } : {}), limit: limit ?? 5 });
          if (hits.length === 0) return { ok: true, text: t('projects.tool.noSessions', { query }), data: [] };
          return {
            ok: true,
            text: t('projects.tool.sessions', { count: hits.length }),
            data: hits.map((hit) => ({
              id: hit.session.id,
              title: hit.session.title,
              project: hit.session.projectName,
              last_at: hit.session.lastAt,
              snippet: hit.snippet.replace(/\[\[|\]\]/g, ''),
            })),
          };
        }),
    }),
    defineTool({
      name: 'code_session_open',
      group: 'code',
      description:
        'Bir Claude Code oturumunu Windows Terminal\'de kaldığı yerden açar (claude --resume); kullanıcı orada kendisi sürdürür. ' +
        'Kimliği code_session_search verir. Oturuma ileti göndermek için code_session_send kullan. Kullanıcı bir oturumu kendisi sürdürmek istediğinde ("o oturumu terminalde aç") kullan.',
      input: z.object({ id: z.string().describe('Oturum kimliği (UUID)') }),
      risk: 'write',
      run: ({ id }, ctx) =>
        guard(ctx, async (svc) => {
          const result = await svc.openSession(id);
          return { ok: result.ok, text: result.message };
        }),
    }),
    ...claudeTools({ service: get, bridge: getBridge }),
  ];

  return defineModule({
    id: 'projects',
    version: '1.0.0',
    nameKey: 'module.projects.name',
    descriptionKey: 'module.projects.description',
    permissions: ['fs', 'shell', 'notify'],
    page: { id: 'projects', icon: 'FolderSimple', order: 60 },
    migrations: PROJECTS_MIGRATIONS,
    tools,
    windowEvents: ['projects.indexProgress', 'projects.claudeEvent'],

    ipc: (ctx) => ({
      'projects.list': ({ query, pinnedOnly }) =>
        wrap(async () => {
          const svc = await get(ctx);
          let list: ProjectDetail[] = svc.repo.listProjects();
          if (query?.trim()) {
            list = rankCandidates(query, list.map((project) => ({ item: project, names: [project.name, ...project.aliases, project.path] }))).map(
              (ranked) => ranked.item,
            );
          }
          return pinnedOnly ? list.filter((project) => project.pinned) : list;
        }),
      'projects.listDetailed': ({ query }) =>
        wrap(async () => {
          const svc = await get(ctx);
          if (!query?.trim()) return svc.repo.listProjects();
          const projects = svc.repo.listProjects();
          return rankCandidates(query, projects.map((project) => ({ item: project, names: [project.name, ...project.aliases, project.path] }))).map(
            (ranked) => ranked.item,
          );
        }),
      'projects.rescan': () =>
        wrap(async () => {
          const svc = await get(ctx);
          const scan = await svc.rescanProjects();
          await svc.indexSessions();
          return { projects: scan.projects, sessions: svc.repo.counts().sessions };
        }),
      'projects.update': ({ id, patch }) => wrap(async () => (await get(ctx)).repo.updateProject(id, patch)),
      'projects.setAliases': ({ id, aliases }) => wrap(async () => (await get(ctx)).repo.setAliases(id, aliases)),
      'projects.open': ({ id, target }) => wrap(async () => (await get(ctx)).openProject(id, target)),
      'projects.listSessions': (req) =>
        wrap(async () =>
          (await get(ctx)).repo.listSessions({
            limit: req.limit,
            ...(req.offset !== undefined ? { offset: req.offset } : {}),
            ...(req.projectId ? { projectId: req.projectId } : {}),
            ...(req.category ? { category: req.category } : {}),
            ...(req.pinnedOnly ? { pinnedOnly: true } : {}),
          }).items,
        ),
      'projects.searchSessions': ({ query, projectId, limit }) =>
        wrap(async () => (await get(ctx)).repo.searchSessions({ query, limit, ...(projectId ? { projectId } : {}) }).hits),
      'projects.findSessions': (req) =>
        wrap(async () => {
          const svc = await get(ctx);
          if (req.query && ftsQuery(req.query)) {
            const { hits, total } = svc.repo.searchSessions({ ...req, query: req.query });
            return { items: hits.map((hit) => hit.session), hits, total };
          }
          const { items, total } = svc.repo.listSessions(req);
          return { items, hits: null, total };
        }),
      'projects.getSession': ({ id, limit }) =>
        wrap(async () => {
          const svc = await get(ctx);
          return { session: svc.repo.getSession(id), messages: svc.repo.sessionMessages(id, { limit }).messages };
        }),
      'projects.sessionMessages': ({ id, around, offset, limit }) =>
        wrap(async () =>
          (await get(ctx)).repo.sessionMessages(id, {
            limit: Math.min(200, Math.max(1, limit)),
            ...(around !== undefined ? { around } : {}),
            ...(offset !== undefined ? { offset } : {}),
          }),
        ),
      'projects.updateSession': ({ id, patch }) =>
        wrap(async () => {
          const svc = await get(ctx);
          const session = svc.repo.updateSession(id, patch);
          ctx.bus.emit('projects.changed', { entity: 'session', op: 'updated', ids: [id] });
          return session;
        }),
      'projects.archiveSession': ({ id, archived }) =>
        wrap(async () => {
          const svc = await get(ctx);
          const session = svc.repo.updateSession(id, { archived });
          ctx.bus.emit('projects.changed', { entity: 'session', op: 'updated', ids: [id] });
          return session;
        }),
      'projects.openSession': ({ id }) => wrap(async () => (await get(ctx)).openSession(id)),
      'projects.categories': () => wrap(async () => (await get(ctx)).repo.categories()),
      'projects.config': ({ patch }) => wrap(async () => (patch ? (await get(ctx)).setConfig(patch) : (await get(ctx)).config())),
      'projects.indexStatus': () => wrap(async () => (await get(ctx)).indexStatus()),
      // Arka plan işi olarak Claude Code oturumu: iş listesinde görünür, iptal edilirse oturum durdurulur.
      'projects.startTask': ({ projectId, prompt }) =>
        wrap(async () => {
          const svc = await get(ctx);
          const live = await getBridge(ctx);
          const project = svc.repo.getProject(projectId);
          const started = await live.manager.start({ cwd: project.path, prompt, source: 'page' });
          if (!started.ok || !started.session) throw new UserError(started.error ?? t('claude.notify.unknownError'));
          const liveId = started.session.id;
          return ctx.jobs.start({
            kind: 'projects.code_task',
            moduleId: 'projects',
            title: t('claude.job.title', { project: project.name }),
            run: (control) => watchAsJob(ctx, live, liveId, control),
          });
        }),

      // ───────── uygulama içi Claude Code oturumları ─────────
      'projects.claudeEnvironment': async () => (await getBridge(ctx)).environment(),
      'projects.claudeConfig': async ({ patch }) => (patch ? (await getBridge(ctx)).setConfig(patch) : (await getBridge(ctx)).config()),
      'projects.claudeSessions': async () => (await getBridge(ctx)).manager.sessions(),
      'projects.claudeSession': async ({ id }) => (await getBridge(ctx)).manager.detail(id),
      'projects.claudeStart': async (req) => {
        const svc = await get(ctx);
        const live = await getBridge(ctx);
        let cwd = req.cwd;
        if (!cwd && req.projectId) cwd = svc.repo.listProjects().find((project) => project.id === req.projectId)?.path;
        // Sürdürülen oturum dizindeyse klasörü ve başlığı oradan gelir (canlı listede aynı adla görünsün).
        let title = req.title;
        if (req.resume && (!cwd || !title)) {
          try {
            const indexed = svc.repo.getSession(req.resume);
            cwd ||= indexed.cwd;
            title ||= indexed.title;
          } catch {
            // dizinde yok: klasör verilmediyse yönetici "klasör yok" der
          }
        }
        return live.manager.start({
          cwd: cwd ?? '',
          source: 'page',
          ...(req.prompt !== undefined ? { prompt: req.prompt } : {}),
          ...(req.images ? { images: req.images } : {}),
          ...(req.resume ? { resume: req.resume } : {}),
          ...(req.fork ? { fork: true } : {}),
          ...(req.mode ? { mode: req.mode } : {}),
          ...(req.model !== undefined ? { model: req.model } : {}),
          ...(req.effort !== undefined ? { effort: req.effort } : {}),
          ...(title ? { title } : {}),
          ...(req.force ? { force: true } : {}),
        });
      },
      'projects.claudeSend': async ({ id, text, images }) => (await getBridge(ctx)).manager.send(id, { text, ...(images ? { images } : {}) }),
      'projects.claudeInterrupt': async ({ id, keepQueue }) => (await getBridge(ctx)).manager.interrupt(id, keepQueue ? { keepQueue: true } : {}),
      'projects.claudePermission': async ({ id, requestId, answer }) => (await getBridge(ctx)).manager.answerPermission(id, requestId, answer),
      'projects.claudeSetMode': async ({ id, mode }) => (await getBridge(ctx)).manager.setMode(id, mode),
      'projects.claudeSetModel': async ({ id, model }) => (await getBridge(ctx)).manager.setModel(id, model),
      'projects.claudeSetEffort': async ({ id, effort }) => (await getBridge(ctx)).manager.setEffort(id, effort),
      'projects.claudeClose': async ({ id }) => (await getBridge(ctx)).manager.close(id),
      'projects.claudeForget': async ({ id }) => (await getBridge(ctx)).manager.forget(id),
      'projects.claudeRemoveQueued': async ({ id, messageId }) => (await getBridge(ctx)).manager.removeQueued(id, messageId),
      'projects.claudeStopTask': async ({ id, taskId }) => (await getBridge(ctx)).manager.stopTask(id, taskId),
      'projects.claudeBackgroundTask': async ({ id, taskId }) => (await getBridge(ctx)).manager.backgroundTask(id, taskId),
      'projects.claudeTaskOutput': async ({ id, taskId, lines }) => (await getBridge(ctx)).manager.taskOutput(id, taskId, lines),
      'projects.claudeTrust': async ({ cwd, decision }) => {
        const live = await getBridge(ctx);
        return decision === undefined ? live.trustState(cwd) : live.setTrust(cwd, decision);
      },
      // Git özeti, fark ve dosya önerisi yalnız uygulamanın yönettiği oturumun klasöründe çalışır.
      'projects.claudeGit': async ({ id }) => {
        const cwd = (await getBridge(ctx)).manager.cwdOf(id);
        return cwd ? gitSummary(cwd) : { git: false, files: [] };
      },
      'projects.claudeDiff': async ({ id, file }) => {
        const cwd = (await getBridge(ctx)).manager.cwdOf(id);
        if (!cwd) throw new UserError(t('claude.op.notFound'));
        try {
          return await gitDiff(cwd, file);
        } catch (error) {
          throw new UserError(error instanceof Error ? error.message : String(error));
        }
      },
      'projects.claudeFiles': async ({ id, query }) => {
        const cwd = (await getBridge(ctx)).manager.cwdOf(id);
        if (!cwd) return { files: [], truncated: false };
        const listed = await projectFiles(cwd);
        return { files: matchFiles(listed.list, query, 50), truncated: listed.truncated };
      },
      'projects.claudeLogin': async () => (await getBridge(ctx)).login(),
      'projects.claudeWatch': async ({ id }) => (await getBridge(ctx)).watch(id),
    }),

    async setup(ctx) {
      (await get(ctx)).start();
      (await getBridge(ctx)).start();
    },

    async teardown() {
      const current = service ?? (pending ? await pending.catch(() => null) : null);
      const live = bridge;
      service = null;
      pending = null;
      bridge = null;
      // Önce Claude Code süreçleri temiz kapanır (yetim süreç kalmasın), sonra dizin.
      await live?.stop();
      await current?.stop();
    },
  });
}

export default createProjectsModule();
