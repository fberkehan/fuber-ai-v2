// Çekirdek geliştirme servisi: modül bağlamını motorun bağımlılıklarına bağlar (gerçek koşucu, derin beyin sürücüsü, kurucu) ve
// arayüzün/araçların okuduğu durumu üretir. Sınama kipinde (`FUBER2_SELFDEV=fake`) yalnız KURUCU sahtedir; git, koşucu,
// paketleme gerçektir.
import { app } from 'electron';
import { APP_VERSION, type ModuleContext } from '@fuber/shared';
import { testing } from '../../testing';
import { createDeepDriver, type ClaudeDriver } from './claude';
import { createEngine, type EngineDeps } from './engine';
import { evaluateGate, parseConfig, validateRepo, type SelfdevConfig } from './gate';
import { createFakeInstaller, createWindowsInstaller, fakeRunningVersion, type Installer } from './installer';
import { createRunner, type Runner } from './runner';
import { createSelfdevStore } from './store';
import type { GateState, SelfdevStatus } from './types';

export const MODULE_ID = 'selfdev';

/** Sınamada ya da bileşik denemede değiştirilebilen parçalar. */
export interface ServiceOverrides {
  runner?: Runner;
  claude?: ClaudeDriver;
  installer?: Installer;
  runningVersion?: () => string;
  quit?: () => void;
  execPath?: string;
}

const safeApp = (): { isPackaged: boolean; quit(): void } | null => {
  try {
    return typeof app?.quit === 'function' ? app : null;
  } catch {
    return null;
  }
};

export function createSelfdevService(ctx: ModuleContext, overrides: ServiceOverrides = {}) {
  const store = createSelfdevStore(ctx.db);
  const fake = testing.enabled && testing.selfdev.fake;
  const electron = safeApp();
  const installer = overrides.installer ?? (fake ? createFakeInstaller(ctx.paths.data) : createWindowsInstaller({ isPackaged: electron?.isPackaged === true }));
  const runningVersion = overrides.runningVersion ?? (() => (fake ? (fakeRunningVersion(ctx.paths.data) ?? APP_VERSION) : APP_VERSION));

  const config = (): SelfdevConfig => {
    const parsed = parseConfig(ctx.policy.moduleConfig(MODULE_ID));
    // Sınama: sağlık denetimi gecikmesi ortamdan gelir (politika yeniden açılışta sıfırlanır).
    return testing.enabled && testing.selfdev.healthDelaySeconds !== null ? { ...parsed, healthDelaySeconds: testing.selfdev.healthDelaySeconds } : parsed;
  };

  const gate = (): GateState => {
    const settings = ctx.settings.get();
    return evaluateGate({
      // Yönetim izni TEK anahtardır: Modüller sayfasındaki "Kendini geliştirme" modülü (`moduleAllowed`). Eskiden ayrıca
      // `developer.enabled` da gerekiyordu; kullanıcı modülü açık görüp "açtım ama çalışmıyor" dedi (18 Kas 2026).
      policyEnabled: true,
      moduleAllowed: ctx.policy.moduleAllowed(MODULE_ID),
      settingEnabled: settings.developerMode === true,
      repoPath: settings.developerRepoPath ?? null,
      forbidden: [ctx.paths.data],
    });
  };

  const engineDeps: EngineDeps = {
    store,
    runner: overrides.runner ?? createRunner(),
    claude: overrides.claude ?? createDeepDriver(ctx),
    installer,
    jobs: ctx.jobs,
    config,
    repoRoot() {
      const repo = validateRepo(ctx.settings.get().developerRepoPath, [ctx.paths.data]);
      if (!repo.ok) throw new Error(repo.reason);
      return repo.root;
    },
    dataDir: ctx.paths.data,
    runningVersion,
    env: {
      pid: process.pid,
      execPath: overrides.execPath ?? process.execPath,
      // Sahte kipte uygulama kapanmaz (sınama yeniden açışı kendisi yapar).
      quit: overrides.quit ?? (() => (fake ? undefined : electron?.quit())),
    },
    notify: (request) => {
      ctx.attention.notify({ moduleId: MODULE_ID, ...request });
    },
    emit: (runId, status) => ctx.bus.emit('selfdev.changed', { runId, status }),
    healthFacts() {
      let dbOpen = false;
      let settingsReadable = false;
      let brainStatusReadable = false;
      try {
        dbOpen = ctx.db.get('SELECT 1 AS ok') !== undefined;
      } catch {
        dbOpen = false;
      }
      try {
        settingsReadable = ctx.settings.get() !== undefined;
      } catch {
        settingsReadable = false;
      }
      try {
        brainStatusReadable = ctx.brain.status() !== undefined;
      } catch {
        brainStatusReadable = false;
      }
      let toolModules = 0;
      try {
        toolModules = new Set(ctx.tools.list().map((tool) => tool.moduleId).filter((id) => id !== MODULE_ID)).size;
      } catch {
        toolModules = 0;
      }
      // Sınama: sağlıksız açılışı taklit eder.
      if (testing.enabled && testing.selfdev.unhealthy) dbOpen = false;
      return { dbOpen, settingsReadable, brainStatusReadable, toolModules, moduleLoadErrors: 0 };
    },
    log: ctx.log,
  };
  const engine = createEngine(engineDeps);

  const status = (): SelfdevStatus => {
    const state = store.state();
    const current = runningVersion();
    const target = engine.rollbackTarget();
    const runs = store.runsWithStatus(['queued', 'planning', 'implementing', 'verifying', 'fixing', 'packaging', 'installing', 'restarting']);
    const deepStatus = engineDeps.claude.available();
    const install = installer.available();
    return {
      gate: gate(),
      active: runs[0] ?? null,
      ready: engine.readyRun(),
      versions: {
        current,
        previous: target?.version ?? null,
        rollbackVia: target?.via ?? null,
        history: state.installed.map((item) => ({ version: item.version, at: item.at })).reverse(),
      },
      pending: state.pending,
      healthFailed: state.healthFailed,
      deep: { ok: deepStatus.ok, reason: deepStatus.reason },
      install: { ok: install.ok, reason: install.reason },
    };
  };

  return { store, engine, gate, config, status, runningVersion };
}

export type SelfdevService = ReturnType<typeof createSelfdevService>;
