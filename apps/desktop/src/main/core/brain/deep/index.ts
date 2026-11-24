/**
 * Derin beyin: tek arayüz, iki sağlayıcı (`types.ts`). Seçim politikadan gelir (`Policy.brain.deep.provider`):
 *  - `auto`: Anthropic anahtarı çalışıyorsa API; anahtar yoksa, kredi yoksa ya da API bu çağrıda düştüyse ve bu
 *    bilgisayarda Claude Code hazırsa Claude Code; hiçbiri yoksa dürüst "derin beyin yok".
 *  - `anthropic` / `claude-code`: yalnız o sağlayıcı; kullanılamıyorsa neden söylenir, ötekine sessizce geçilmez.
 * Acil durdurma, zorunlu güncelleme ve Gizli kip (ağ kapalı) derin işleri tümüyle kapatır: iki sağlayıcı da buluttur.
 *
 * Modüller `deepBrainFor(ctx)` ile ulaşır; süreçte tek örnek vardır.
 */
import { t, type DeepBrainStatus, type ModuleContext, type Unsubscribe } from '@fuber/shared';
import { testing } from '../../../testing';
import { createAnthropicProvider, type AnthropicRun } from './anthropic';
import { locateClaudeCli, MIN_CLI_VERSION, probeClaudeCli, type CliCommand, type CliProbe } from '../../claude-cli';
import { createClaudeCodeProvider, type ClaudeCodeRun } from './claude-code';
import { setDeepStatus } from './status';
import { DeepBrainError, type DeepAskRequest, type DeepAskResult, type DeepAvailability, type DeepBrain, type DeepProviderId, type DeepTaskRequest, type DeepTaskResult } from './types';

export * from './types';

export interface DeepBrainOptions {
  /** `auto`: bilinen yerlerde aranır · `null`: Claude Code yok sayılır · komut: o çalıştırılır (sınamada sahte CLI). */
  cli?: 'auto' | CliCommand | null;
  /** Claude Code yoklamasının (sürüm, oturum) geçerlilik süresi. */
  probeTtlMs?: number;
  /** API bir çağrıda düştükten sonra bu süre boyunca yeniden denenmez (`auto` kipte Claude Code'a geçilir). */
  apiRetryMs?: number;
}

export interface DeepBrainService extends DeepBrain {
  /** Koşan bütün derin işleri keser, dinleyicileri bırakır. */
  dispose(): void;
}

const PROBE_TTL_MS = 10 * 60_000;
const API_RETRY_MS = 5 * 60_000;

type State = { ok: true } | { ok: false; reason: string };

export function createDeepBrain(ctx: ModuleContext, options: DeepBrainOptions = {}): DeepBrainService {
  const log = ctx.log.child('derin');
  const choice = options.cli === undefined ? 'auto' : options.cli;
  const probeTtlMs = options.probeTtlMs ?? PROBE_TTL_MS;
  const apiRetryMs = options.apiRetryMs ?? API_RETRY_MS;

  /** Komut her yoklamada yeniden çözülür: CLI uygulama açıkken kurulmuş olabilir. */
  const resolveCommand = (): CliCommand | null => {
    if (choice === null) return null;
    if (choice !== 'auto') return choice;
    const found = locateClaudeCli();
    return found ? { command: found, prefixArgs: [] } : null;
  };

  // Arama (where, kayıt defteri) eşzamanlı süreç çalıştırır; açılışı bekletmesin diye ilk yoklamaya bırakılır.
  let command: CliCommand | null = choice === 'auto' ? null : choice;
  let probe: CliProbe = { installed: false, path: null, version: null, loggedIn: null, supported: false, checkedAt: 0 };
  let probing: Promise<void> | null = null;
  let apiDown: { until: number; reason: string } | null = null;
  let signature = '';
  let disposed = false;
  const subscriptions: Unsubscribe[] = [];

  const anthropic = createAnthropicProvider(ctx);
  const claudeCode = createClaudeCodeProvider({
    command: () => command,
    model: () => ctx.policy.get().brain.deep.claudeCodeModel,
    log,
    onAuthFailure() {
      probe = { ...probe, loggedIn: false, checkedAt: Date.now() };
      publish();
    },
    onUsage(usage) {
      // Abonelikle koşar: dolar maliyeti yoktur, kullanım yine de görünür olsun.
      ctx.usage.record({ kind: 'deep', provider: 'claude-code', model: usage.model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUsd: 0, durationMs: usage.durationMs });
    },
  });

  const apiState = (): State => {
    const policy = ctx.policy.get();
    if (policy.models.deep.provider !== 'anthropic') {
      const provider = policy.models.deep.provider;
      return { ok: false, reason: t(provider === 'openai-compatible' ? 'cloud.deep.compatRole' : provider === 'claude-code' ? 'ccbrain.deep.role' : 'deep.api.localRole') };
    }
    if (!policy.keys.anthropic?.trim()) return { ok: false, reason: t('deep.api.noKey') };
    if (apiDown && Date.now() < apiDown.until) return { ok: false, reason: apiDown.reason };
    // Beynin kendi bilgisi: sesli tur ya da ısıtma bulutun düştüğünü çoktan görmüş olabilir (kredi, anahtar, ağ).
    let brain: ReturnType<typeof ctx.brain.status> | null = null;
    try {
      brain = ctx.brain.status();
    } catch {
      brain = null;
    }
    // Konuşan beyin Claude Code iken `cause` onun durumudur (sınır, oturum); Anthropic API'nin durumu `apiIssue`'dadır.
    const viaClaudeCode = brain?.cloud?.provider === 'claude-code';
    const issue = brain?.apiIssue ?? (brain?.reason === 'cloud_down' && !viaClaudeCode ? (brain.cause ?? 'network') : null);
    if (issue) {
      return { ok: false, reason: t(issue === 'billing' ? 'deep.api.billing' : issue === 'auth' ? 'deep.api.auth' : 'deep.api.network') };
    }
    return { ok: true };
  };

  const cliState = (): State => {
    // İlk yoklama bitmeden sorulduysa: iş verilirse önce yoklama beklenir (`route`), burada yalnız "henüz bilinmiyor".
    if (choice !== null && probe.checkedAt === 0) return { ok: false, reason: t('deep.cli.checking') };
    if (!command || !probe.installed) return { ok: false, reason: t(command ? 'deep.cli.broken' : 'deep.cli.missing') };
    if (!probe.supported) return { ok: false, reason: t('deep.cli.old', { version: probe.version ?? '?', min: MIN_CLI_VERSION }) };
    if (probe.loggedIn === false) return { ok: false, reason: t('deep.cli.loggedOut') };
    return { ok: true };
  };

  const compute = (): DeepBrainStatus => {
    const setting = ctx.policy.get().brain.deep.provider;
    const base = { setting, claudeCode: { installed: probe.installed, version: probe.version, loggedIn: probe.loggedIn } };
    const none = (reason: string): DeepBrainStatus => ({ ...base, ok: false, provider: null, reason });
    const use = (provider: DeepProviderId): DeepBrainStatus => ({ ...base, ok: true, provider, reason: null });
    if (ctx.policy.killSwitchActive()) return none(t('brain.error.killSwitch'));
    if (ctx.policy.updateRequired()) return none(t('brain.error.updateRequired'));
    if (!ctx.policy.networkAllowed()) return none(t('deep.none.private'));
    const api = apiState();
    const cli = cliState();
    if (setting === 'anthropic') return api.ok ? use('anthropic') : none(api.reason);
    if (setting === 'claude-code') return cli.ok ? use('claude-code') : none(cli.reason);
    if (api.ok) return use('anthropic');
    if (cli.ok) return use('claude-code');
    return none(t('deep.none.both', { api: api.reason, cli: cli.reason }));
  };

  /** Durumu hesaplar; değiştiyse beyin servisine `brain.status` yayınlatır. */
  function publish(): DeepBrainStatus {
    const status = compute();
    setDeepStatus(status);
    const next = JSON.stringify(status);
    if (next !== signature) {
      const first = signature === '';
      signature = next;
      if (!first || status.ok) log.info(`derin beyin: ${status.provider ?? 'yok'} (seçim: ${status.setting}${status.reason ? `; ${status.reason}` : ''})`);
      try {
        ctx.brain.status();
      } catch {
        // beyin servisi henüz hazır değilse durum ilk sorulduğunda zaten buradan okunur
      }
    }
    return status;
  }

  const refresh = async (force = false): Promise<DeepAvailability> => {
    if (force || probe.checkedAt === 0 || Date.now() - probe.checkedAt > probeTtlMs) {
      probing ??= (async () => {
        command = resolveCommand();
        try {
          probe = await probeClaudeCli(command);
        } catch (error) {
          log.warn('Claude Code yoklanamadı', error);
          probe = { installed: false, path: command?.command ?? null, version: null, loggedIn: null, supported: false, checkedAt: Date.now() };
        }
      })().finally(() => {
        probing = null;
      });
      await probing;
    }
    return toAvailability(publish());
  };

  const toAvailability = (status: DeepBrainStatus): DeepAvailability =>
    status.ok ? { ok: true, provider: status.provider } : { ok: false, provider: null, ...(status.reason ? { reason: status.reason } : {}) };

  const markApiDown = (reason: string | null) => {
    apiDown = { until: Date.now() + apiRetryMs, reason: reason?.trim() || t('deep.api.down') };
    log.info(`Anthropic API derin işte kullanılamadı: ${apiDown.reason}`);
  };
  const noteApiDown = (run: AnthropicRun) => markApiDown(run.error);

  /** İş için sağlayıcı sırası: önce seçilen; `auto` kipte API düşerse Claude Code. */
  const route = async (): Promise<DeepBrainStatus> => {
    await refresh();
    return publish();
  };

  const ask = async (request: DeepAskRequest): Promise<DeepAskResult> => {
    if (!request.system.trim()) throw new DeepBrainError('error', t('deep.error.system'));
    let status = await route();
    if (!status.ok || !status.provider) throw new DeepBrainError('unavailable', status.reason ?? t('deep.api.down'));
    let run: AnthropicRun | ClaudeCodeRun;
    if (status.provider === 'anthropic') {
      run = await anthropic.ask(request);
      if (run.ok) return { text: run.text, provider: 'anthropic' };
      if (!(run as AnthropicRun).cloudFailure) throw new DeepBrainError(run.stop === 'end' ? 'error' : run.stop, run.error ?? t('brain.error.unknown'));
      noteApiDown(run as AnthropicRun);
      status = publish();
      if (status.provider !== 'claude-code') throw new DeepBrainError('unavailable', status.reason ?? run.error ?? t('deep.api.down'));
    }
    run = await claudeCode.ask(request);
    if (run.ok) return { text: run.text, provider: 'claude-code' };
    throw new DeepBrainError(run.stop === 'end' ? 'error' : run.stop, run.error ?? t('brain.error.unknown'));
  };

  const runTask = async (request: DeepTaskRequest): Promise<DeepTaskResult> => {
    const none = (reason: string | null): DeepTaskResult => ({
      ok: false,
      text: '',
      provider: null,
      stop: 'unavailable',
      error: reason ?? t('deep.api.down'),
      turns: 0,
      durationMs: 0,
      denials: 0,
    });
    try {
      if (!request.system.trim()) return { ...none(t('deep.error.system')), stop: 'error' };
      let status = await route();
      if (!status.ok || !status.provider) return none(status.reason);
      if (status.provider === 'anthropic') {
        const { cloudFailure, ...run } = await anthropic.runTask(request);
        if (!cloudFailure) return { ...run, provider: 'anthropic' };
        noteApiDown({ ...run, cloudFailure });
        status = publish();
        if (status.provider !== 'claude-code') return { ...run, provider: 'anthropic', stop: 'unavailable', error: status.reason ?? run.error };
      }
      return await claudeCode.runTask(request);
    } catch (error) {
      log.error(`derin iş beklenmeyen hatayla bitti: ${request.kind}`, error);
      return { ...none(error instanceof Error ? error.message : t('brain.error.unknown')), stop: 'error' };
    }
  };

  subscriptions.push(
    ctx.bus.on('policy.changed', () => void publish()),
    ctx.bus.on('brain.status', () => void publish()),
    ctx.bus.on('app.killSwitch', () => void publish()),
    // Acil durdurma: işler kendi sinyalleriyle de kesilir; iş dışı soruları (ekrana bakma) da kes.
    ctx.bus.on('app.panic', () => claudeCode.abortAll()),
  );
  publish();
  void refresh().catch((error: unknown) => log.warn('derin beyin yoklaması başarısız', error));

  return {
    available: () => toAvailability(disposed ? compute() : publish()),
    refresh,
    status: () => (disposed ? compute() : publish()),
    reportApiFailure(reason) {
      markApiDown(reason);
      return toAvailability(publish());
    },
    ask,
    runTask,
    dispose() {
      disposed = true;
      for (const off of subscriptions.splice(0)) off();
      claudeCode.abortAll();
    },
  };
}

/** Beyin servisi başına tek derin beyin: uygulamada bir tane vardır; sınamada her sahte beynin kendi örneği olur. */
let shared = new WeakMap<object, DeepBrainService>();
const created = new Set<DeepBrainService>();

/** Süreçteki derin beyin. İlk çağıran modülün bağlamıyla kurulur (servisler bütün modüllerde aynıdır). */
export function deepBrainFor(ctx: ModuleContext): DeepBrain {
  let service = shared.get(ctx.brain);
  if (!service) {
    service = createDeepBrain(ctx, { cli: testing.claudeCli });
    shared.set(ctx.brain, service);
    created.add(service);
  }
  return service;
}

/** Uygulama kapanırken: koşan CLI süreçleri öksüz kalmasın. */
export function disposeDeepBrain(): void {
  for (const service of created) service.dispose();
  created.clear();
  shared = new WeakMap();
}
