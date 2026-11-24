// Projeler modülünün işi: proje dizini, oturum dizini, açma eylemleri ve bitiş bildirimi.
// Electron'a doğrudan bağlı değildir (kabuk işlevleri dışarıdan verilir) ki birim sınamada koşsun.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { t, type LaunchResult, type ModuleContext, type OpenTarget, type Unsubscribe } from '@fuber/shared';
import { resultSummary } from '../../core/claude-cli/session-events';
import { finishDue } from './finish';
import { createIndexer, type Indexer } from './indexer';
import { findVsCode, launch, resumeSpec, SESSION_ID, startSpec, wtSpec, type LaunchSpec, type SpawnFn } from './launch';
import { decisive, rankCandidates, type Ranked } from './match';
import { createProjectsRepo, type ProjectsRepo } from './repo';
import { inspectDir, isInside, scanRoots, type ScannedProject } from './scanner';
import type { IndexStatus, ProjectDetail, ProjectsConfig } from './types';

export const DEFAULT_CONFIG: ProjectsConfig = {
  extraRoots: [],
  claudeDir: '',
  scanDepth: 4,
  notifyOnFinish: true,
  finishIdleSeconds: 20,
  finishActiveMinutes: 10,
  claudeCommand: ['claude'],
};

const RESCAN_MS = 5 * 60_000;
const FINISH_CHECK_MS = 5_000;
/** Açılışı yavaşlatmasın diye ilk dizinleme biraz sonra başlar. */
const START_DELAY_MS = 2_500;

/** Electron kabuğundan gerekenler (`shell.openPath`, `shell.openExternal`). */
export interface ShellApi {
  /** Başarıda boş metin, hatada hata metni (Electron `shell.openPath` sözleşmesi). */
  openPath(target: string): Promise<string>;
  openExternal(url: string): Promise<void>;
}

export interface ProjectsServiceDeps {
  ctx: ModuleContext;
  shell: ShellApi;
  homeDir: string;
  spawn?: SpawnFn;
  launchWaitMs?: number;
  now?: () => number;
  /** `false`: `start()` zamanlayıcı ve izleyici kurmaz (birim sınama). */
  background?: boolean;
  vsCodePath?: () => string | null;
  /** Bu oturumu uygulama içi yönetici yürütüyor mu: öyleyse bitişini o bildirir (çift bildirim olmasın). */
  managed?: (sessionId: string) => boolean;
  /**
   * Bu bilgisayardaki `claude` ikilisinin tam yolu. Uygulamanın PATH'i oturum açılışındaki bayat kopya olabilir
   * (Claude Code sonradan kurulduysa terminalde `claude` bulunamaz); komut varsayılansa tam yol kullanılır.
   */
  locateClaude?: () => string | null;
}

export type FindResult =
  | { kind: 'one'; project: ProjectDetail }
  | { kind: 'many'; options: Array<Ranked<ProjectDetail>> }
  | { kind: 'none' };

export function createProjectsService(deps: ProjectsServiceDeps) {
  const { ctx } = deps;
  const repo: ProjectsRepo = createProjectsRepo(ctx.db);
  const now = deps.now ?? Date.now;
  const timers: Array<ReturnType<typeof setInterval> | ReturnType<typeof setTimeout>> = [];
  const subscriptions: Unsubscribe[] = [];
  let projectPaths: Array<{ id: string; path: string }> = [];
  let baselineDone = false;
  let lastScan: { projects: number; dirsVisited: number; durationMs: number } | null = null;

  const config = (): ProjectsConfig => ({ ...DEFAULT_CONFIG, ...(repo.kvGet<Partial<ProjectsConfig>>('config') ?? {}) });
  const claudeDir = () => config().claudeDir.trim() || path.join(deps.homeDir, '.claude', 'projects');
  const roots = () => [ctx.settings.get().projectsRoot, ...config().extraRoots].filter((root) => root && root.trim());
  const claudeCommand = (): string[] => {
    const command = config().claudeCommand;
    if (command.length !== 1 || command[0] !== 'claude') return command;
    const located = deps.locateClaude?.();
    return located ? [located] : command;
  };

  const refreshPaths = () => {
    projectPaths = repo
      .listProjects()
      .map((project) => ({ id: project.id, path: project.path }))
      .sort((a, b) => b.path.length - a.path.length);
  };
  const projectFor = (cwd: string): string | null => projectPaths.find((project) => isInside(cwd, project.path))?.id ?? null;

  const changed = (entity: 'project' | 'session', ids: string[] = []) =>
    ctx.bus.emit('projects.changed', { entity, op: 'updated', ids });

  const indexer: Indexer = createIndexer({
    repo,
    log: ctx.log,
    claudeDir,
    projectFor,
    onProgress: (status: IndexStatus) => ctx.bus.emit('projects.indexProgress', status),
    onPassDone: (changedFiles) => {
      if (!baselineDone) {
        repo.baselineNotified();
        baselineDone = true;
      }
      if (changedFiles > 0) {
        void refreshDerived().then(() => changed('session'));
      }
    },
  });

  /** Oturumu olan ama tarama kökü dışındaki klasörler de proje sayılır ("atlas" Masaüstü dışında olabilir). */
  const eligibleCwd = (cwd: string): boolean => {
    const resolved = path.resolve(cwd);
    // Sürücü kökü ("C:\") proje değildir.
    if (resolved.length <= 3) return false;
    const home = deps.homeDir;
    const blocked = [home, path.join(home, 'Desktop'), path.join(home, 'Downloads'), path.join(home, 'Documents'), ...roots()];
    if (blocked.some((dir) => path.resolve(dir).toLowerCase() === resolved.toLowerCase())) return false;
    // Köklerin ataları (Masaüstü gibi) proje değildir.
    if (roots().some((root) => isInside(root, resolved))) return false;
    const banned = [path.join(home, 'AppData'), process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.SystemRoot].filter(
      (dir): dir is string => !!dir,
    );
    return !banned.some((dir) => isInside(resolved, dir));
  };

  const refreshDerived = async () => {
    refreshPaths();
    const derived: ScannedProject[] = [];
    const seen = new Set<string>();
    for (const cwd of repo.sessionCwds()) {
      const key = cwd.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const covered = projectPaths.find((project) => isInside(cwd, project.path));
      if (covered) continue;
      if (!eligibleCwd(cwd) || !fs.existsSync(cwd)) continue;
      const project = await inspectDir(path.resolve(cwd), undefined, true);
      if (project) derived.push(project);
    }
    // Daha önce eklenmiş türetilmiş projeleri de koru (oturumları hâlâ duruyorsa listede yine çıkarlar).
    for (const project of repo.listProjects().filter((item) => item.source === 'claude')) {
      if (!derived.some((item) => item.path.toLowerCase() === project.path.toLowerCase()) && fs.existsSync(project.path)) {
        const again = await inspectDir(project.path, undefined, true);
        if (again) derived.push(again);
      }
    }
    repo.syncScanned(derived, 'claude');
    refreshPaths();
    repo.relinkSessions(projectFor);
  };

  // Taramalar sıraya girer: kök değişirken süren eski tarama yeni sonucun üstüne yazmasın.
  let scanChain: Promise<unknown> = Promise.resolve();
  const rescanProjects = (): Promise<{ projects: number; dirsVisited: number; durationMs: number }> => {
    const next = scanChain.then(scanOnce, scanOnce);
    scanChain = next.catch(() => {});
    return next;
  };
  const scanOnce = async () => {
    const result = await scanRoots(roots(), config().scanDepth);
    repo.syncScanned(result.projects, 'scan');
    lastScan = { projects: result.projects.length, dirsVisited: result.dirsVisited, durationMs: result.durationMs };
    await refreshDerived();
    changed('project');
    return lastScan;
  };

  // ───────── açma ─────────

  const launched = async (spec: LaunchSpec, fallback: LaunchSpec | null) => {
    let outcome = await launch(spec, { ...(deps.spawn ? { spawn: deps.spawn } : {}), ...(deps.launchWaitMs !== undefined ? { waitMs: deps.launchWaitMs } : {}) });
    if (!outcome.ok && fallback && outcome.error?.startsWith('ENOENT')) {
      outcome = await launch(fallback, { ...(deps.spawn ? { spawn: deps.spawn } : {}), ...(deps.launchWaitMs !== undefined ? { waitMs: deps.launchWaitMs } : {}) });
    }
    return outcome;
  };

  const openFolder = async (folder: string, target: OpenTarget, name: string): Promise<LaunchResult> => {
    if (!fs.existsSync(folder)) return { ok: false, message: t('projects.open.missingFolder', { path: folder }) };
    const label = t(`projects.target.${target}`);
    if (target === 'explorer') {
      const error = await deps.shell.openPath(folder);
      return error ? { ok: false, message: t('projects.open.failed', { name, target: label, error }) } : { ok: true, message: t('projects.open.done', { name, target: label }) };
    }
    let outcome;
    if (target === 'editor') {
      const exe = (deps.vsCodePath ?? findVsCode)();
      if (!exe) return { ok: false, message: t('projects.open.noEditor') };
      outcome = await launched({ file: exe, args: [folder] }, null);
    } else if (target === 'terminal') {
      outcome = await launched(wtSpec(folder), startSpec(folder, []));
    } else {
      const command = claudeCommand();
      outcome = await launched(wtSpec(folder, command), startSpec(folder, command));
    }
    return outcome.ok
      ? { ok: true, message: t('projects.open.done', { name, target: label }) }
      : { ok: false, message: t('projects.open.failed', { name, target: label, error: outcome.error ?? '' }) };
  };

  const openProject = async (id: string, target: OpenTarget): Promise<LaunchResult> => {
    const project = repo.getProject(id);
    const result = await openFolder(project.path, target, project.name);
    if (result.ok) {
      repo.markOpened(id);
      changed('project', [id]);
    }
    return result;
  };

  const openSession = async (id: string): Promise<LaunchResult> => {
    if (!SESSION_ID.test(id)) return { ok: false, message: t('projects.session.badId') };
    const session = repo.getSession(id);
    const cwd = session.cwd;
    if (!cwd || !fs.existsSync(cwd)) return { ok: false, message: t('projects.open.missingFolder', { path: cwd || '?' }) };
    const command = claudeCommand();
    const outcome = await launched(resumeSpec(cwd, id, command), startSpec(cwd, [...command, '--resume', id]));
    return outcome.ok
      ? { ok: true, message: t('projects.session.opened', { title: session.title }) }
      : { ok: false, message: t('projects.session.openFailed', { error: outcome.error ?? '' }) };
  };

  // ───────── bulma ─────────

  const recency = (project: ProjectDetail) => {
    const stamps = [project.lastOpenedAt, project.lastSessionAt, project.modifiedAt].map((value) => (value ? Date.parse(value) : 0));
    const newest = Math.max(...stamps);
    const days = (now() - newest) / 86_400_000;
    return days < 0 ? 0.9 : Math.max(0, 0.9 - days / 60);
  };

  const find = (query: string): FindResult => {
    const projects = repo.listProjects();
    const ranked = rankCandidates(
      query,
      projects.map((project) => {
        const relative = roots()
          .map((root) => (isInside(project.path, root) ? path.relative(root, project.path) : null))
          .find((value): value is string => !!value);
        return {
          item: project,
          names: [project.name, ...project.aliases, ...(relative && relative !== project.name ? [relative] : [])],
          recency: recency(project),
        };
      }),
    );
    if (ranked.length === 0) return { kind: 'none' };
    const winner = decisive(ranked);
    return winner ? { kind: 'one', project: winner } : { kind: 'many', options: ranked.slice(0, 5) };
  };

  // ───────── bitiş bildirimi ─────────

  const checkFinished = async () => {
    const cfg = config();
    if (!cfg.notifyOnFinish || !baselineDone) return;
    const current = now();
    const since = new Date(current - cfg.finishActiveMinutes * 60_000).toISOString();
    for (const candidate of repo.finishCandidates(since)) {
      if (!finishDue(candidate, current, { idleSeconds: cfg.finishIdleSeconds, activeMinutes: cfg.finishActiveMinutes })) continue;
      if (deps.managed?.(candidate.id)) {
        repo.markNotified(candidate.id, candidate.lastConvAt);
        continue;
      }
      // Dizin geride kalmış olabilir: dosya bu arada büyüdüyse tur sürüyordur, bildirme.
      const state = repo.fileStates().find((file) => file.id === candidate.id);
      if (state) {
        try {
          const stat = await fsp.stat(state.file_path);
          if (stat.size !== state.file_size) continue;
          if (current - stat.mtimeMs < cfg.finishIdleSeconds * 1000) continue;
        } catch {
          continue;
        }
      }
      const project = candidate.projectName ?? (path.basename(candidate.cwd) || '?');
      repo.markNotified(candidate.id, candidate.lastConvAt);
      // demo.5: kullanıcının kendi oturumunun bitişi de SESLİ duyurulur ve sonucu taşır (son asistan iletisinden 1–2 cümle;
      // kod, yol, liste ve sır atılır). Ne zaman konuşulacağına Dikkat Yöneticisi karar verir (sessiz saat, toplantı).
      let summary = '';
      try {
        summary = resultSummary(repo.lastAssistantText(candidate.id));
      } catch (error) {
        ctx.log.debug('oturum sonucu okunamadı', error);
      }
      ctx.attention.notify({
        moduleId: 'projects',
        title: t('projects.notify.finishedTitle', { project }),
        body: summary ? `${candidate.title} · ${summary}` : candidate.title,
        priority: 'high',
        speak: `${t('projects.speak.finished', { project })}${summary ? ` ${summary}` : ''}`,
        actions: [{ id: 'open', label: t('projects.notify.openAction'), kind: 'primary' }],
        dedupeKey: `projects.finish.${candidate.id}.${candidate.lastConvAt}`,
        data: { sessionId: candidate.id },
      });
    }
  };

  return {
    repo,
    config,
    claudeDir,
    roots,
    lastScan: () => lastScan,
    indexStatus: (): IndexStatus => ({ ...indexer.status(), claudeDir: claudeDir() }),
    setConfig(patch: Partial<ProjectsConfig>): ProjectsConfig {
      const before = config();
      const next: ProjectsConfig = { ...before, ...patch };
      next.scanDepth = Math.min(8, Math.max(1, Math.round(next.scanDepth)));
      next.finishIdleSeconds = Math.min(600, Math.max(5, next.finishIdleSeconds));
      next.finishActiveMinutes = Math.min(240, Math.max(1, next.finishActiveMinutes));
      if (!Array.isArray(next.claudeCommand) || next.claudeCommand.length === 0) next.claudeCommand = ['claude'];
      repo.kvSet('config', next);
      if (path.resolve(next.claudeDir || '.') !== path.resolve(before.claudeDir || '.')) {
        // Başka bir oturum klasörü: eski dizin bu klasöre ait değildir.
        repo.clearSessions();
        baselineDone = false;
        indexer.unwatch();
        void indexer.run().then(() => {
          if (deps.background !== false) indexer.watch();
        });
      }
      if (JSON.stringify(next.extraRoots) !== JSON.stringify(before.extraRoots) || next.scanDepth !== before.scanDepth) void rescanProjects();
      return next;
    },
    rescanProjects,
    refreshDerived,
    indexSessions: () => indexer.run(),
    whenIdle: () => indexer.whenIdle(),
    find,
    openProject,
    openFolder,
    openSession,
    checkFinished,
    projectFor,
    start() {
      refreshPaths();
      subscriptions.push(
        ctx.bus.on('attention.action', ({ moduleId, actionId, data }) => {
          if (moduleId !== 'projects' || actionId !== 'open' || typeof data.sessionId !== 'string') return;
          void openSession(data.sessionId).then((result) => {
            if (!result.ok) ctx.log.warn('bildirimden oturum açılamadı', result.message);
          });
        }),
        ctx.bus.on('settings.changed', ({ changedKeys }) => {
          if (changedKeys.includes('projectsRoot')) void rescanProjects();
        }),
      );
      if (deps.background === false) return;
      timers.push(
        setTimeout(() => {
          void rescanProjects()
            .catch((error) => ctx.log.warn('proje taraması başarısız', error))
            .then(() => indexer.run())
            .then(() => indexer.watch());
        }, START_DELAY_MS),
        setInterval(() => void indexer.run(), RESCAN_MS),
        setInterval(() => void checkFinished().catch((error) => ctx.log.warn('bitiş denetimi', error)), FINISH_CHECK_MS),
      );
      for (const timer of timers) (timer as { unref?: () => void }).unref?.();
    },
    async stop() {
      for (const timer of timers.splice(0)) clearTimeout(timer as ReturnType<typeof setTimeout>);
      for (const off of subscriptions.splice(0)) off();
      await indexer.stop();
    },
  };
}

export type ProjectsService = ReturnType<typeof createProjectsService>;
