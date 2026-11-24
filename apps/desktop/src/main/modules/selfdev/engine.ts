// Çekirdek geliştirme motoru: koşuyu uçtan uca yürütür (plan → uygula → sına ⇄ düzelt → paketle → hazır) ve kurulum, geri alma ve
// açılış sağlık denetimini yönetir. Bütün dış bağımlılıklar (git hariç: o geçici depoda gerçekten koşar) enjekte edilir: sınamada
// sahte koşucu, paketleyici, kurucu ve Claude sürücüsü verilir. Durum geçişleri `pipeline.ts`'tedir ve her geçiş kaydedilir.
import fs from 'node:fs';
import path from 'node:path';
import { newId, nowIso, t, type JobControl, type JobsApi, type Logger, type NotifyRequest } from '@fuber/shared';
import type { ClaudeDriver } from './claude';
import type { SelfdevConfig } from './gate';
import * as gitApi from './git';
import { decideStartup, evaluateHealth, failureReason, type HealthFacts, type HealthMark } from './health';
import type { Installer, InstallJob } from './installer';
import { createPackager, healthFile, isSafeVersion, pendingFile, pruneStorage, rollbackDir, selfdevDir, storePackage, storedPackage, type Packager } from './packager';
import { assertTransition, isBlocking, isTerminal, isWorking, stageProgress } from './pipeline';
import { parsePlan } from './prompts';
import { riskFlags } from './risk';
import { nodeCommand, npmCommand, type Runner } from './runner';
import type { SelfdevStore } from './store';
import type { CheckResult, EventKind, PendingUpdate, RunStatus, SelfdevRun, SelfdevState } from './types';
import { applyVersion, devNumberOf, installerName, nextDevVersion, readVersion } from './version';

export interface EngineDeps {
  store: SelfdevStore;
  runner: Runner;
  packager?: Packager;
  claude: ClaudeDriver;
  installer: Installer;
  jobs: JobsApi;
  /** Her çağrıda güncel yapılandırma. */
  config(): SelfdevConfig;
  /** Doğrulanmış kaynak deposunun kökü (kapı geçtiyse). */
  repoRoot(): string;
  dataDir: string;
  /** Çalışan uygulamanın sürümü. */
  runningVersion(): string;
  env: { pid: number; execPath: string; quit(): void };
  notify(request: Omit<NotifyRequest, 'moduleId'>): void;
  emit(runId: string | null, status: RunStatus | null): void;
  /** Sağlık yoklamaları için servis değerleri. */
  healthFacts(): HealthFacts;
  log: Logger;
}

export interface Outcome {
  ok: boolean;
  text: string;
  run?: SelfdevRun;
}

class Cancelled extends Error {
  constructor() {
    super('iptal edildi');
    this.name = 'Cancelled';
  }
}

/** Kullanıcıya söylenebilir hata: iletisi olduğu gibi gösterilir. */
class Failure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Failure';
  }
}

const shortOf = (id: string): string => id.slice(-8).toLowerCase();
const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

export function createEngine(deps: EngineDeps) {
  const { store, log } = deps;
  const packager = deps.packager ?? createPackager(deps.runner);
  const controllers = new Map<string, AbortController>();
  const jobIds = new Map<string, string>();
  const timers = new Set<ReturnType<typeof setTimeout>>();

  // ───────────────────────── kayıt ─────────────────────────

  function note(runId: string, kind: EventKind, text: string): void {
    try {
      store.addEvent(runId, kind, text);
    } catch (error) {
      log.warn('günlük yazılamadı', error);
    }
    deps.emit(runId, null);
  }

  function setStatus(runId: string, to: RunStatus, patch: Partial<SelfdevRun> = {}): SelfdevRun {
    const current = store.getRun(runId);
    if (!current) throw new Error(`koşu yok: ${runId}`);
    if (current.status !== to) assertTransition(current.status, to);
    const finished = isTerminal(to) ? { finishedAt: nowIso() } : {};
    const run = store.updateRun(runId, { ...patch, ...finished, status: to })!;
    note(runId, 'status', t(`selfdev.status.${to}` as never));
    deps.emit(runId, to);
    return run;
  }

  function fail(runId: string, message: string): never {
    throw new Failure(message);
  }

  const aborted = (signal: AbortSignal): void => {
    if (signal.aborted) throw new Cancelled();
  };

  // ───────────────────────── sınama adımları ─────────────────────────

  async function runChecks(run: SelfdevRun, worktree: string, round: number, cfg: SelfdevConfig, signal: AbortSignal, control: JobControl): Promise<CheckResult[]> {
    const results: CheckResult[] = [];
    const specs: Array<{ name: string; spec: ReturnType<typeof npmCommand> }> = [];
    const timeout = cfg.commandMinutes * 60_000;
    for (const script of cfg.verify) specs.push({ name: script, spec: npmCommand(script, ['run', script], worktree, timeout) });
    if (cfg.e2e.length > 0) {
      specs.push({ name: 'build', spec: npmCommand('build', ['run', 'build'], worktree, timeout) });
      for (const script of cfg.e2e) specs.push({ name: `e2e:${path.basename(script, '.mjs')}`, spec: nodeCommand(`e2e ${script}`, script, worktree, timeout) });
    }
    for (const { name, spec } of specs) {
      aborted(signal);
      control.update({ step: t('selfdev.step.check', { name }) });
      note(run.id, 'step', t('selfdev.step.check', { name }));
      const result = await deps.runner.run(spec, { signal });
      aborted(signal);
      const check: CheckResult = {
        name,
        command: [spec.label].join(' '),
        ok: result.ok,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        tail: result.error ? `${result.error}\n${result.tail}`.trim() : result.tail,
        round,
      };
      results.push(check);
      const all = [...store.getRun(run.id)!.checks, check];
      store.updateRun(run.id, { checks: all });
      note(run.id, 'check', `${name}: ${check.ok ? 'geçti' : 'KALDI'} (${Math.round(check.durationMs / 1000)} sn)`);
      if (!check.ok) break; // ilk başarısızda dur: sonraki komutlar yalnız gürültü üretir
    }
    return results;
  }

  // ───────────────────────── boru hattı ─────────────────────────

  async function pipeline(runId: string, control: JobControl, ctl: AbortController): Promise<string> {
    const signal = ctl.signal;
    control.signal.addEventListener('abort', () => ctl.abort(), { once: true });
    const cfg = deps.config();
    const repo = deps.repoRoot();
    let run = store.getRun(runId)!;
    const logAgent = (event: { kind: 'tool' | 'text' | 'note'; text: string }): void => note(runId, event.kind === 'note' ? 'note' : event.kind, event.text);

    // 1) Worktree + plan
    run = setStatus(runId, 'planning');
    control.update({ progress: stageProgress('planning'), step: t('selfdev.step.worktree') });
    const baseRev = cfg.baseBranch ?? 'HEAD';
    const baseCommit = await gitApi.headCommit(repo, baseRev);
    if (!baseCommit) fail(runId, t('selfdev.error.noBase', { rev: baseRev }));
    const layout = gitApi.worktreeLayout(repo, shortOf(runId));
    const added = await gitApi.worktreeAdd(repo, layout.dir, layout.branch, baseCommit!);
    if (!added.ok) fail(runId, t('selfdev.error.worktree', { error: added.error ?? '' }));
    store.updateRun(runId, { branch: layout.branch, worktree: layout.dir, baseCommit });
    note(runId, 'note', t('selfdev.note.worktree', { branch: layout.branch, dir: layout.dir }));
    aborted(signal);

    control.update({ step: t('selfdev.step.plan') });
    note(runId, 'step', t('selfdev.step.plan'));
    const planStep = await deps.claude.plan({ request: run.request, reason: run.reason, workDir: layout.dir, maxSeconds: cfg.planMinutes * 60, signal, onEvent: logAgent });
    aborted(signal);
    if (!planStep.ok) fail(runId, t('selfdev.error.plan', { error: planStep.error ?? planStep.stop }));
    const plan = parsePlan(planStep.text);
    if (!plan) fail(runId, t('selfdev.error.planEmpty'));
    run = store.updateRun(runId, { planSummary: plan!.summary, planText: planStep.text, planFiles: plan!.files, planRisk: plan!.risk })!;
    note(runId, 'note', t('selfdev.note.plan', { summary: plan!.summary }));
    if (plan!.kind === 'plugin') {
      // Dürüst çıkış: çekirdek değişikliği gerekmiyor. Hiçbir dosya yazılmadı; temiz worktree kaldırılır.
      await gitApi.worktreeRemoveIfClean(repo, layout.dir);
      fail(runId, t('selfdev.error.pluginEnough', { reason: plan!.pluginReason ?? plan!.summary }));
    }
    deps.notify({ title: t('selfdev.notify.planTitle'), body: plan!.summary, priority: 'normal', speak: t('selfdev.notify.planSpeak', { summary: plan!.summary }), dedupeKey: `selfdev.plan.${runId}`, actions: [{ id: 'selfdev.open', label: t('selfdev.action.open') }] });

    // 2) Uygulama
    run = setStatus(runId, 'implementing');
    control.update({ progress: stageProgress('implementing'), step: t('selfdev.step.implement') });
    note(runId, 'step', t('selfdev.step.implement'));
    const impl = await deps.claude.implement({ request: run.request, planText: planStep.text, workDir: layout.dir, maxSeconds: cfg.implementMinutes * 60, signal, onEvent: logAgent });
    aborted(signal);
    if (!impl.ok) fail(runId, t('selfdev.error.implement', { error: impl.error ?? impl.stop }));
    let changed = await gitApi.changedFiles(layout.dir, baseCommit!);
    if (changed.length === 0) fail(runId, t('selfdev.error.noChange'));
    let head = await gitApi.commitAll(layout.dir, `selfdev: ${clip(run.request.replace(/\s+/g, ' '), 72)}`);
    changed = await gitApi.changedFiles(layout.dir, baseCommit!);
    run = store.updateRun(runId, { headCommit: head ?? baseCommit, files: changed, riskFlags: riskFlags(changed) })!;

    // 3) Sınama ⇄ düzeltme
    run = setStatus(runId, 'verifying');
    control.update({ progress: stageProgress('verifying'), step: t('selfdev.step.install') });
    if (cfg.install) {
      note(runId, 'step', t('selfdev.step.install'));
      const ci = await deps.runner.run(npmCommand('npm ci', ['ci'], layout.dir, cfg.commandMinutes * 60_000), { signal });
      aborted(signal);
      if (!ci.ok) fail(runId, t('selfdev.error.install', { tail: clip(ci.tail.trim().split('\n').slice(-6).join(' | '), 400) }));
    }
    let round = 0;
    for (;;) {
      const results = await runChecks(run, layout.dir, round, cfg, signal, control);
      const failed = results.find((result) => !result.ok);
      if (!failed) break;
      if (round >= cfg.maxFixRounds) {
        fail(runId, t('selfdev.error.checksFailed', { name: failed.name, rounds: round, dir: layout.dir }));
      }
      round++;
      run = setStatus(runId, 'fixing', { fixRounds: round });
      control.update({ progress: stageProgress('fixing'), step: t('selfdev.step.fix', { round }) });
      note(runId, 'step', t('selfdev.step.fix', { round }));
      const fix = await deps.claude.fix({ request: run.request, command: failed.command, output: failed.tail, round, workDir: layout.dir, maxSeconds: cfg.implementMinutes * 60, signal, onEvent: logAgent });
      aborted(signal);
      if (!fix.ok) fail(runId, t('selfdev.error.fix', { error: fix.error ?? fix.stop }));
      head = (await gitApi.commitAll(layout.dir, `selfdev: düzeltme ${round}`)) ?? head;
      changed = await gitApi.changedFiles(layout.dir, baseCommit!);
      run = store.updateRun(runId, { headCommit: head ?? baseCommit, files: changed, riskFlags: riskFlags(changed) })!;
      run = setStatus(runId, 'verifying');
    }

    // 4) Sürüm + paket
    run = setStatus(runId, 'packaging');
    control.update({ progress: stageProgress('packaging'), step: t('selfdev.step.version') });
    const state = store.state();
    const baseVersion = readVersion(layout.dir);
    const dev = nextDevVersion(baseVersion, Math.max(state.lastDevNumber, devNumberOf(deps.runningVersion())));
    applyVersion(layout.dir, dev.version);
    head = (await gitApi.commitAll(layout.dir, `selfdev: sürüm ${dev.version}`)) ?? head;
    store.saveState({ ...state, lastDevNumber: dev.devNumber });
    store.updateRun(runId, { version: dev.version, headCommit: head ?? baseCommit });
    note(runId, 'note', t('selfdev.note.version', { from: baseVersion, to: dev.version }));
    control.update({ step: t('selfdev.step.package') });
    note(runId, 'step', t('selfdev.step.package'));
    const built = await packager.build({
      worktree: layout.dir,
      version: dev.version,
      script: cfg.packager,
      timeoutMs: cfg.packageMinutes * 60_000,
      signal,
      onLine: (line) => control.update({ step: t('selfdev.step.packageLine', { line: clip(line, 80) }) }),
    });
    aborted(signal);
    if (!built.ok || !built.file) fail(runId, t('selfdev.error.package', { error: built.error ?? '' }) + (built.result?.tail ? ` ${clip(built.result.tail.trim().split('\n').slice(-3).join(' | '), 300)}` : ''));
    const stored = await storePackage(deps.dataDir, dev.version, built.file!);
    const size = fs.statSync(stored).size;
    note(runId, 'note', t('selfdev.note.package', { file: path.basename(stored), mb: (size / 1_048_576).toFixed(0) }));
    await pruneStorage(deps.dataDir, keepVersions(store.state(), dev.version)).catch(() => undefined);

    // 5) Hazır
    run = setStatus(runId, 'ready', { packagePath: stored });
    control.update({ progress: 1, step: t('selfdev.step.ready') });
    const files = run.files.length;
    deps.notify({
      title: t('selfdev.notify.readyTitle', { version: dev.version }),
      body: run.planSummary ?? '',
      priority: 'high',
      speak: t('selfdev.notify.readySpeak', { summary: run.planSummary ?? '', count: files }),
      dedupeKey: `selfdev.ready.${runId}`,
      actions: [
        { id: 'selfdev.install', label: t('selfdev.action.install'), kind: 'primary' },
        { id: 'selfdev.open', label: t('selfdev.action.open') },
      ],
    });
    return t('selfdev.job.done', { version: dev.version, count: files });
  }

  /** Koşuyu iş olarak başlatır; hata ve iptali koşu kaydına işler. */
  function runAsJob(run: SelfdevRun): void {
    const ctl = new AbortController();
    controllers.set(run.id, ctl);
    const job = deps.jobs.start({
      kind: 'selfdev.run',
      moduleId: 'selfdev',
      title: t('selfdev.job.title', { request: clip(run.request.replace(/\s+/g, ' '), 60) }),
      async run(control) {
        try {
          return await pipeline(run.id, control, ctl);
        } catch (error) {
          const current = store.getRun(run.id);
          const cancelled = error instanceof Cancelled || ctl.signal.aborted || control.signal.aborted;
          if (current && !isTerminal(current.status)) {
            if (cancelled) {
              setStatus(run.id, 'cancelled', { error: t('selfdev.error.cancelled') });
            } else {
              const message = error instanceof Failure ? error.message : t('selfdev.error.unexpected', { error: error instanceof Error ? error.message : String(error) });
              if (!(error instanceof Failure)) log.error('çekirdek geliştirme koşusu patladı', error);
              setStatus(run.id, 'failed', { error: message });
              note(run.id, 'error', message);
              deps.notify({ title: t('selfdev.notify.failedTitle'), body: message, priority: 'normal', speak: t('selfdev.notify.failedSpeak'), dedupeKey: `selfdev.failed.${run.id}`, actions: [{ id: 'selfdev.open', label: t('selfdev.action.open') }] });
            }
          }
          throw error instanceof Cancelled ? new Error(t('selfdev.error.cancelled')) : error;
        } finally {
          controllers.delete(run.id);
          jobIds.delete(run.id);
        }
      },
    });
    jobIds.set(run.id, job.id);
  }

  // ───────────────────────── dış arayüz ─────────────────────────

  const blocking = (): SelfdevRun | null => store.runsWithStatus(['queued', 'planning', 'implementing', 'verifying', 'fixing', 'packaging', 'ready', 'installing', 'restarting']).find((run) => isBlocking(run.status)) ?? null;

  return {
    /** Yeni koşu başlatır (kapı denetimi çağıranındır). */
    start(input: { request: string; reason: string; origin: string }): Outcome {
      const busy = blocking();
      if (busy) {
        const text = busy.status === 'ready' ? t('selfdev.start.busyReady', { version: busy.version ?? '' }) : t('selfdev.start.busy');
        return { ok: false, text, run: busy };
      }
      const driver = deps.claude.available();
      if (!driver.ok) return { ok: false, text: t('selfdev.start.noDeep', { reason: driver.reason ?? '' }) };
      const run = store.insertRun({
        id: newId(),
        request: input.request.trim(),
        reason: input.reason.trim(),
        origin: input.origin,
        status: 'queued',
        planSummary: null,
        planText: null,
        planFiles: [],
        planRisk: null,
        branch: null,
        worktree: null,
        baseCommit: null,
        headCommit: null,
        files: [],
        riskFlags: [],
        checks: [],
        fixRounds: 0,
        fromVersion: deps.runningVersion(),
        version: null,
        packagePath: null,
        error: null,
        createdAt: nowIso(),
        finishedAt: null,
      });
      note(run.id, 'note', t('selfdev.note.request', { request: clip(run.request, 300) }));
      deps.emit(run.id, 'queued');
      runAsJob(run);
      return { ok: true, text: t('selfdev.start.ok'), run };
    },

    /** Süren koşuyu durdurur ya da hazır güncellemeyi bırakır. */
    async cancel(): Promise<Outcome> {
      const run = blocking();
      if (!run) return { ok: false, text: t('selfdev.cancel.none') };
      if (run.status === 'installing' || run.status === 'restarting') return { ok: false, text: t('selfdev.cancel.installing'), run };
      if (run.status === 'ready') {
        const updated = setStatus(run.id, 'cancelled', { error: t('selfdev.error.discarded') });
        if (run.version && isSafeVersion(run.version)) await fs.promises.rm(path.join(selfdevDir(deps.dataDir), 'packages', run.version), { recursive: true, force: true }).catch(() => undefined);
        return { ok: true, text: t('selfdev.cancel.discarded'), run: updated };
      }
      const ctl = controllers.get(run.id);
      if (ctl) ctl.abort();
      const jobId = jobIds.get(run.id);
      if (jobId) deps.jobs.cancel(jobId);
      // İş çalışmıyorsa (kuyrukta ya da yetim) kaydı kendimiz kapatırız.
      if (!ctl) setStatus(run.id, 'cancelled', { error: t('selfdev.error.cancelled') });
      return { ok: true, text: t('selfdev.cancel.ok'), run };
    },

    /** Kurulum onayı bekleyen koşu (en yenisi). */
    readyRun(id?: string): SelfdevRun | null {
      const ready = store.runsWithStatus(['ready']);
      return id ? (ready.find((run) => run.id === id) ?? null) : (ready[0] ?? null);
    },

    /**
     * Kurulumu başlatır. ONAY çağıranındır (araç: `requestApproval`); bu işlev onaylandığı varsayımıyla çalışır ve
     * hiçbir şeyi onaysız tetiklemez: çağıran yoksa çağrılmaz.
     */
    async install(runId: string): Promise<Outcome> {
      const run = store.getRun(runId);
      if (!run || run.status !== 'ready' || !run.version || !run.packagePath) return { ok: false, text: t('selfdev.install.notReady') };
      const available = deps.installer.available();
      if (!available.ok) return { ok: false, text: t('selfdev.install.unavailable', { reason: available.reason ?? '' }), run };
      if (!fs.existsSync(run.packagePath)) return { ok: false, text: t('selfdev.install.packageGone'), run };
      const current = deps.runningVersion();
      const state = store.state();
      if (state.installed.at(-1)?.version !== current) {
        state.installed.push({ version: current, at: nowIso(), runId: null, packagePath: storedPackage(deps.dataDir, current), snapshotPath: null });
      }
      const baseline = state.installed.at(-1)!;
      // Geri dönüş yolu YOKSA kurulum yapılmaz: önce kurulu klasörün anlık kopyası alınır.
      if (!baseline.packagePath && !(baseline.snapshotPath && fs.existsSync(baseline.snapshotPath))) {
        const target = path.join(rollbackDir(deps.dataDir), current);
        note(runId, 'step', t('selfdev.step.snapshot'));
        const snap = await deps.installer.snapshot(path.dirname(deps.env.execPath), target);
        if (!snap.ok) return { ok: false, text: t('selfdev.install.noSnapshot', { error: snap.error ?? '' }), run };
        baseline.snapshotPath = target;
      }
      state.installed.push({ version: run.version, at: nowIso(), runId, packagePath: run.packagePath, snapshotPath: null });
      const pending: PendingUpdate = { runId, kind: 'install', fromVersion: current, toVersion: run.version, attempts: 0, at: nowIso() };
      state.pending = pending;
      state.healthFailed = null;
      store.saveState(state);
      writePending(pending);
      await fs.promises.rm(healthFile(deps.dataDir), { force: true }).catch(() => undefined);
      setStatus(runId, 'installing');
      const job: InstallJob = {
        mode: 'install',
        runId,
        pid: deps.env.pid,
        installDir: path.dirname(deps.env.execPath),
        exe: deps.env.execPath,
        version: run.version,
        fromVersion: current,
        installer: run.packagePath,
        restoreSnapshot: baseline.snapshotPath,
        restoreInstaller: baseline.packagePath,
        healthFile: healthFile(deps.dataDir),
        resultFile: path.join(selfdevDir(deps.dataDir), 'run', runId, 'result.json'),
        waitHealthSeconds: 120,
      };
      const started = await deps.installer.start(job, path.join(selfdevDir(deps.dataDir), 'run', runId));
      if (!started.ok) {
        abandonPending(runId, run.version);
        setStatus(runId, 'failed', { error: t('selfdev.install.startFailed', { error: started.error ?? '' }) });
        return { ok: false, text: t('selfdev.install.startFailed', { error: started.error ?? '' }) };
      }
      setStatus(runId, 'restarting');
      note(runId, 'note', t('selfdev.note.restarting'));
      // Yanıt kullanıcıya ulaşsın diye kısa bir gecikmeyle kapanır.
      const timer = setTimeout(() => {
        timers.delete(timer);
        deps.env.quit();
      }, 2500);
      timers.add(timer);
      return { ok: true, text: t('selfdev.install.started', { version: run.version }), run: store.getRun(runId)! };
    },

    /** Geri alma hedefi (önceki sürüm); yoksa `null`. */
    rollbackTarget(): { version: string; via: 'snapshot' | 'package'; snapshot: string | null; installer: string | null } | null {
      return chooseRollbackTarget(store.state(), deps.runningVersion(), deps.dataDir);
    },

    /** Geri almayı başlatır; ONAY çağıranındır. */
    async rollback(): Promise<Outcome> {
      const available = deps.installer.available();
      if (!available.ok) return { ok: false, text: t('selfdev.rollback.unavailable', { reason: available.reason ?? '' }) };
      const state = store.state();
      const current = deps.runningVersion();
      const target = chooseRollbackTarget(state, current, deps.dataDir);
      if (!target) return { ok: false, text: t('selfdev.rollback.none') };
      const entry = [...state.installed].reverse().find((item) => item.version === current);
      const runId = entry?.runId ?? state.pending?.runId ?? newId();
      const pending: PendingUpdate = { runId, kind: 'rollback', fromVersion: current, toVersion: target.version, attempts: 0, at: nowIso() };
      state.pending = pending;
      state.healthFailed = null;
      store.saveState(state);
      writePending(pending);
      await fs.promises.rm(healthFile(deps.dataDir), { force: true }).catch(() => undefined);
      const job: InstallJob = {
        mode: 'rollback',
        runId,
        pid: deps.env.pid,
        installDir: path.dirname(deps.env.execPath),
        exe: deps.env.execPath,
        version: target.version,
        fromVersion: current,
        installer: null,
        restoreSnapshot: target.snapshot,
        restoreInstaller: target.installer,
        healthFile: healthFile(deps.dataDir),
        resultFile: path.join(selfdevDir(deps.dataDir), 'run', `${runId}-rollback`, 'result.json'),
        waitHealthSeconds: 120,
      };
      const started = await deps.installer.start(job, path.join(selfdevDir(deps.dataDir), 'run', `${runId}-rollback`));
      if (!started.ok) {
        state.pending = null;
        store.saveState(state);
        removePendingFile();
        return { ok: false, text: t('selfdev.rollback.startFailed', { error: started.error ?? '' }) };
      }
      const run = store.getRun(runId);
      if (run) note(runId, 'note', t('selfdev.note.rollbackStart', { version: target.version }));
      const timer = setTimeout(() => {
        timers.delete(timer);
        deps.env.quit();
      }, 2500);
      timers.add(timer);
      return { ok: true, text: t('selfdev.rollback.started', { version: target.version }), ...(run ? { run } : {}) };
    },

    /**
     * Açılışta bir kez: yarıda kalan koşuları kapatır, bekleyen güncellemeyi sağlık denetimine bağlar. Dönüş: sağlık
     * denetimi için bekleme süresi bittiğinde çağrılacak işlev yoktur; zamanlayıcı burada kurulur.
     */
    onStartup(): void {
      const running = deps.runningVersion();
      const state = store.state();
      // Yarıda kalan boru hattı: iş yeniden açılışta sürmez.
      for (const run of store.runsWithStatus(['queued', 'planning', 'implementing', 'verifying', 'fixing', 'packaging'])) {
        setStatus(run.id, 'failed', { error: t('selfdev.error.interrupted') });
        note(run.id, 'error', t('selfdev.error.interrupted'));
      }
      const decision = decideStartup(state.pending, running);
      switch (decision.action) {
        case 'none': {
          for (const run of store.runsWithStatus(['installing', 'restarting'])) setStatus(run.id, 'failed', { error: t('selfdev.error.interrupted') });
          return;
        }
        case 'install-missed': {
          const pending = decision.pending;
          clearPending(state, pending);
          if (pending.kind === 'install') {
            state.installed = state.installed.filter((item) => !(item.version === pending.toVersion && item.runId === pending.runId));
            const run = store.getRun(pending.runId);
            if (run && (run.status === 'restarting' || run.status === 'installing')) setStatus(run.id, 'failed', { error: t('selfdev.error.installMissed', { version: pending.toVersion, running }) });
            deps.notify({ title: t('selfdev.notify.missedTitle'), body: t('selfdev.error.installMissed', { version: pending.toVersion, running }), priority: 'high', speak: t('selfdev.notify.missedSpeak'), dedupeKey: `selfdev.missed.${pending.runId}` });
          } else {
            deps.notify({ title: t('selfdev.notify.rollbackMissedTitle'), body: t('selfdev.notify.rollbackMissedBody', { version: pending.toVersion, running }), priority: 'high', speak: t('selfdev.notify.rollbackMissedSpeak'), dedupeKey: `selfdev.rbmissed.${pending.runId}` });
          }
          store.saveState(state);
          return;
        }
        case 'recommend-rollback': {
          recommendRollback(state, decision.pending, decision.reason);
          return;
        }
        case 'verify': {
          // Bu açılış sayılır: sağlık işareti yazılamadan çökersek bir sonraki açılış bunu görür.
          const pending: PendingUpdate = { ...decision.pending, attempts: decision.pending.attempts + 1 };
          state.pending = pending;
          store.saveState(state);
          writePending(pending);
          const delay = Math.max(0, deps.config().healthDelaySeconds) * 1000;
          const timer = setTimeout(() => {
            timers.delete(timer);
            void verifyHealth(pending);
          }, delay);
          timers.add(timer);
          return;
        }
      }
    },

    /** Sağlık denetimini hemen koşturur (sınama ve elle tetikleme). */
    verifyNow: async (): Promise<void> => {
      const pending = store.state().pending;
      if (pending) await verifyHealth(pending);
    },

    dispose(): void {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      for (const ctl of controllers.values()) ctl.abort();
    },

    /** Koşan koşuya bağlı iş kimliği (sınama). */
    jobIdOf: (runId: string): string | null => jobIds.get(runId) ?? null,
  };

  // ───────────────────────── yardımcılar (işlev bildirimleri yukarıda kullanılır) ─────────────────────────

  function writePending(pending: PendingUpdate): void {
    try {
      fs.mkdirSync(selfdevDir(deps.dataDir), { recursive: true });
      fs.writeFileSync(pendingFile(deps.dataDir), JSON.stringify(pending, null, 2), 'utf8');
    } catch (error) {
      log.warn('bekleyen güncelleme kaydı yazılamadı', error);
    }
  }

  /** Eşzamanlı silme: eşzamansız silme, hemen ardından yazılan yeni kaydı silebilirdi (yarış). */
  function removePendingFile(): void {
    try {
      fs.unlinkSync(pendingFile(deps.dataDir));
    } catch {
      // dosya zaten yok
    }
  }

  function clearPending(state: SelfdevState, pending: PendingUpdate): void {
    if (state.pending && state.pending.runId === pending.runId) state.pending = null;
    removePendingFile();
  }

  /** Kurucu başlatılamadı: yeni sürüm kaydını geri al. */
  function abandonPending(runId: string, version: string): void {
    const state = store.state();
    state.pending = null;
    state.installed = state.installed.filter((item) => !(item.version === version && item.runId === runId));
    store.saveState(state);
    removePendingFile();
  }

  function writeHealth(mark: HealthMark): void {
    try {
      fs.mkdirSync(selfdevDir(deps.dataDir), { recursive: true });
      fs.writeFileSync(healthFile(deps.dataDir), JSON.stringify(mark, null, 2), 'utf8');
    } catch (error) {
      log.warn('sağlık işareti yazılamadı', error);
    }
  }

  function recommendRollback(state: SelfdevState, pending: PendingUpdate, reason: string): void {
    state.healthFailed = { runId: pending.runId, reason, at: nowIso() };
    store.saveState(state);
    deps.emit(pending.runId, null);
    note(pending.runId, 'error', t('selfdev.health.failed', { reason }));
    deps.notify({
      title: t('selfdev.notify.healthTitle'),
      body: t('selfdev.notify.healthBody', { version: pending.toVersion, reason }),
      priority: 'high',
      speak: t('selfdev.notify.healthSpeak'),
      dedupeKey: `selfdev.health.${pending.runId}`,
      actions: [
        { id: 'selfdev.rollback', label: t('selfdev.action.rollback'), kind: 'danger' },
        { id: 'selfdev.open', label: t('selfdev.action.open') },
      ],
    });
  }

  async function verifyHealth(pending: PendingUpdate): Promise<void> {
    const health = evaluateHealth(deps.healthFacts());
    const version = deps.runningVersion();
    if (!health.ok) {
      const reason = failureReason(health.probes);
      writeHealth({ version, runId: pending.runId, ok: false, at: nowIso(), reason });
      recommendRollback(store.state(), pending, reason);
      return;
    }
    writeHealth({ version, runId: pending.runId, ok: true, at: nowIso(), reason: null });
    const state = store.state();
    clearPending(state, pending);
    state.healthFailed = null;
    if (pending.kind === 'rollback') {
      // Geri alınan sürüm artık kurulu: kayıttan çıkar.
      state.installed = state.installed.filter((item) => item.version !== pending.fromVersion);
      store.saveState(state);
      const run = store.getRun(pending.runId);
      if (run && (run.status === 'installed' || run.status === 'restarting')) setStatus(run.id, 'rolled_back');
      note(pending.runId, 'note', t('selfdev.note.rolledBack', { version }));
      deps.notify({ title: t('selfdev.notify.rolledBackTitle'), body: t('selfdev.notify.rolledBackBody', { version }), priority: 'high', speak: t('selfdev.notify.rolledBackSpeak', { version }), dedupeKey: `selfdev.rolledback.${pending.runId}` });
    } else {
      store.saveState(state);
      const run = store.getRun(pending.runId);
      if (run && run.status === 'restarting') setStatus(run.id, 'installed');
      note(pending.runId, 'note', t('selfdev.note.installed', { version }));
      deps.notify({ title: t('selfdev.notify.installedTitle'), body: t('selfdev.notify.installedBody', { version }), priority: 'high', speak: t('selfdev.notify.installedSpeak', { version }), dedupeKey: `selfdev.installed.${pending.runId}` });
    }
    await pruneStorage(deps.dataDir, keepVersions(store.state())).catch(() => undefined);
  }
}

/** Silinmeyecek sürümler: kurulu, önceki, bekleyen (ve verilen ek sürüm). */
export function keepVersions(state: SelfdevState, extra?: string): Set<string> {
  const keep = new Set<string>();
  for (const item of state.installed.slice(-2)) keep.add(item.version);
  if (state.pending) {
    keep.add(state.pending.toVersion);
    keep.add(state.pending.fromVersion);
  }
  if (extra) keep.add(extra);
  return keep;
}

/**
 * Geri alma hedefi: kurulu sürümden bir önceki kayıt. Anlık kopya varsa o (`robocopy`), yoksa saklanan kurulum paketi.
 * Hiçbiri yoksa `null` (geri alma yolu yok).
 */
export function chooseRollbackTarget(
  state: SelfdevState,
  running: string,
  dataDir: string,
): { version: string; via: 'snapshot' | 'package'; snapshot: string | null; installer: string | null } | null {
  const list = state.installed;
  let index = -1;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]!.version === running) {
      index = i;
      break;
    }
  }
  if (index === -1) index = list.length - 1;
  const previous = index > 0 ? list[index - 1] : undefined;
  if (!previous) return null;
  const snapshot = previous.snapshotPath && fs.existsSync(previous.snapshotPath) ? previous.snapshotPath : null;
  const installer = previous.packagePath && fs.existsSync(previous.packagePath) ? previous.packagePath : storedPackage(dataDir, previous.version);
  if (snapshot) return { version: previous.version, via: 'snapshot', snapshot, installer };
  if (installer) return { version: previous.version, via: 'package', snapshot: null, installer };
  return null;
}

export { installerName };
