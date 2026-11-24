// Çekirdek geliştirme birim sınamalarının ortak yardımcıları. Uygulama demetine girmez (yalnız sınamalar içe aktarır).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Job, JobControl, JobSpec, JobsApi, Logger, NotifyRequest, Paths } from '@fuber/shared';
import { createStore } from '../../core/store';
import type { AgentCall, AgentStep, ClaudeDriver } from './claude';
import { REPO_PACKAGE_NAME, SelfdevConfigSchema, type SelfdevConfig } from './gate';
import type { Installer, InstallJob } from './installer';
import type { Packager } from './packager';
import type { CommandResult, CommandSpec, Runner } from './runner';
import { createSelfdevStore, SELFDEV_MIGRATIONS } from './store';
import { installerName } from './version';

export const log: Logger = { debug() {}, info() {}, warn() {}, error() {}, child: () => log };

export const tempDir = (label: string): string => fs.mkdtempSync(path.join(os.tmpdir(), `fuber2-selfdev-${label}-`));
export const removeDir = (dir: string): Promise<void> => fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });

const sh = (cwd: string, args: string[]): string => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true }).trim();

/** Sahte kaynak deposu: kök package.json adı `fuber-ai-v2`, sürüm alanları, hızlı sahte betikler. */
export function makeFakeRepo(parent: string, version = '2.0.0-demo.3'): string {
  const repo = path.join(parent, 'FUBER AI 2 ÇEKİRDEK');
  fs.mkdirSync(path.join(repo, 'packages', 'shared', 'src'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'apps', 'desktop'), { recursive: true });
  const pkg = (name: string, extra: Record<string, unknown> = {}) => JSON.stringify({ name, version, private: true, ...extra }, null, 2) + '\n';
  fs.writeFileSync(path.join(repo, 'package.json'), pkg(REPO_PACKAGE_NAME, { scripts: { typecheck: 'node check.mjs', test: 'node check.mjs', 'dist:desktop': 'node make-installer.mjs' } }));
  fs.writeFileSync(path.join(repo, 'apps', 'desktop', 'package.json'), pkg('@fuber/desktop'));
  fs.writeFileSync(path.join(repo, 'packages', 'shared', 'package.json'), pkg('@fuber/shared'));
  fs.writeFileSync(path.join(repo, 'packages', 'shared', 'src', 'constants.ts'), `export const APP_VERSION = '${version}';\n`);
  fs.writeFileSync(path.join(repo, '.gitignore'), 'node_modules\napps/desktop/release\n');
  fs.writeFileSync(path.join(repo, 'README.md'), 'sahte depo\n');
  sh(repo, ['init', '-q', '-b', 'main']);
  sh(repo, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A']);
  sh(repo, ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'ilk']);
  return repo;
}

export const gitOut = sh;

export function makeStore(dir: string) {
  const core = createStore({ paths: { db: path.join(dir, 'test.db') } as Paths, log });
  core.migrate('selfdev', SELFDEV_MIGRATIONS);
  return { core, store: createSelfdevStore(core.scoped('selfdev')) };
}

export const defaultConfig = (patch: Partial<SelfdevConfig> = {}): SelfdevConfig => ({ ...SelfdevConfigSchema.parse({}), install: false, healthDelaySeconds: 0, ...patch });

/** Sahte iş yöneticisi: işi hemen başlatır; `settled()` hepsinin bitmesini bekler. */
export function fakeJobs() {
  const running: Array<{ id: string; promise: Promise<unknown>; abort(): void }> = [];
  let counter = 0;
  const api: JobsApi = {
    start(spec: JobSpec): Job {
      const id = `job-${++counter}`;
      const ctl = new AbortController();
      const control: JobControl = { id, signal: ctl.signal, update() {} };
      const promise = spec.run(control).catch(() => undefined);
      running.push({ id, promise, abort: () => ctl.abort() });
      return { id, kind: spec.kind, moduleId: spec.moduleId, title: spec.title, status: 'running', progress: null, step: '', startedAt: new Date().toISOString(), finishedAt: null, resultText: null, error: null };
    },
    cancel(id) {
      const job = running.find((item) => item.id === id);
      job?.abort();
      return job !== undefined;
    },
    cancelAll: () => 0,
    get: () => null,
    list: () => [],
    wait: async () => ({}) as Job,
  };
  return { api, settled: () => Promise.all(running.map((item) => item.promise)) };
}

/** Sahte Claude sürücüsü: aşama başına betik. */
export function fakeClaude(script: {
  plan?: (call: AgentCall) => string | Promise<string>;
  implement?: (call: AgentCall & { planText: string }) => void | Promise<void>;
  fix?: (call: AgentCall & { command: string; output: string; round: number }) => void | Promise<void>;
  available?: { ok: boolean; reason: string | null };
}): ClaudeDriver & { calls: string[] } {
  const calls: string[] = [];
  const ok = (text: string): AgentStep => ({ ok: true, text, error: null, stop: 'end', turns: 1, durationMs: 1 });
  return {
    calls,
    available: () => script.available ?? { ok: true, reason: null },
    async plan(call) {
      calls.push('plan');
      return ok((await script.plan?.(call)) ?? PLAN_OK);
    },
    async implement(call) {
      calls.push('implement');
      await script.implement?.(call);
      return ok('## DEĞİŞİKLİK ÖZETİ\n- yapıldı');
    },
    async fix(call) {
      calls.push('fix');
      await script.fix?.(call);
      return ok('## DEĞİŞİKLİK ÖZETİ\n- düzeltildi');
    },
  };
}

export const PLAN_OK = `## UYGUNLUK
ÇEKİRDEK

## ÖZET
Ana pencereye yeni bir bölüm eklenecek. Siz yeni bir sayfa göreceksiniz.

## DOSYALAR
- src/ozellik.txt — yeni özellik dosyası

## RİSK
- Düşük: yalnız yeni dosya.

## SINAMA
- typecheck ve test koşar.`;

/** Sahte koşucu: komut etiketine göre sonuç; `fail(label, round)` ile başarısızlık verilebilir. */
export function fakeRunner(fail: (spec: CommandSpec, count: number) => boolean = () => false): Runner & { specs: CommandSpec[] } {
  const specs: CommandSpec[] = [];
  const counts = new Map<string, number>();
  return {
    specs,
    async run(spec): Promise<CommandResult> {
      specs.push(spec);
      const count = (counts.get(spec.label) ?? 0) + 1;
      counts.set(spec.label, count);
      const bad = fail(spec, count);
      return { ok: !bad, exitCode: bad ? 1 : 0, timedOut: false, cancelled: false, durationMs: 5, tail: bad ? `error TS2322: ${spec.label} sahte hata` : 'tamam' };
    },
  };
}

/** Sahte paketleyici: worktree'deki sürümle sahte bir kurulum dosyası yazar. */
export const fakePackager: Packager = {
  async build(input) {
    const dir = path.join(input.worktree, 'apps', 'desktop', 'release');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, installerName(input.version));
    fs.writeFileSync(file, `sahte kurulum ${input.version}`);
    return { ok: true, file };
  },
};

/** Kayıt tutan sahte kurucu. */
export function fakeInstaller(options: { available?: { ok: boolean; reason: string | null }; snapshotOk?: boolean } = {}): Installer & { jobs: InstallJob[]; snapshots: string[] } {
  const jobs: InstallJob[] = [];
  const snapshots: string[] = [];
  return {
    jobs,
    snapshots,
    available: () => options.available ?? { ok: true, reason: null },
    async snapshot(_installDir, targetDir) {
      if (options.snapshotOk === false) return { ok: false, error: 'disk dolu' };
      fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(path.join(targetDir, 'kopya.txt'), 'x');
      snapshots.push(targetDir);
      return { ok: true };
    },
    async start(job) {
      jobs.push(job);
      return { ok: true };
    },
  };
}

export function notices() {
  const list: Array<Omit<NotifyRequest, 'moduleId'>> = [];
  return { list, notify: (request: Omit<NotifyRequest, 'moduleId'>) => void list.push(request) };
}
