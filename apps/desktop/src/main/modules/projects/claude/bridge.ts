/**
 * Oturum yöneticisinin uygulamaya bağlanması (v1 `claudecode/yonetim.ts`'ten taşındı):
 *  • Her olay `projects.claudeEvent` ile pencerelere.
 *  • İzin isteği mevcut onay akışına düşer (ada onay kartı + sesli "onaylıyorum"). Onay akışı Dikkat Yöneticisinden
 *    bağımsızdır: "rahatsız etme" ve sessiz saat iş-bitti bildirimini bekletir, izin isteğini bekletmez.
 *  • İş bitince/durunca/çökünce BİR KEZ kısa özet (değişen dosya sayısı, son yanıtın ilk cümlesi): adada bildirim +
 *    sesle; asistan sohbetinden verilen işte özet o sohbete de yazılır.
 *  • "Tam yetki" kapanınca Tam yetkideki oturumlar "Düzenlemelere izin ver"e iner. Acil durdurma süren turları keser.
 *    Uygulama kapanırken hepsi temiz kapanır.
 *  • Oturum yalnız bilinen proje klasörlerinde açılır (proje dizini ya da oturum geçmişi olan klasör).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { t, type Channel, type Id, type ModuleContext, type Unsubscribe } from '@fuber/shared';
import { locateClaudeCli } from '../../../core/claude-cli/locate';
import { execCli, probeClaudeCli, type CliCommand, type CliProbe } from '../../../core/claude-cli/process';
import { isPermissionMode, isRecord, resultSummary, truncate, type PermissionRequestEvent } from '../../../core/claude-cli/session-events';
import { isInside } from '../scanner';
import type { ProjectsRepo } from '../repo';
import type { ProjectDetail } from '../types';
import { createSessionManager, type OurTraces, type SessionManager, type TurnEndInfo } from './manager';
import { checkProtectedFolder, claudeCodeTrusts, createTrustStore, defaultFolderLimits, folderTrustState, guardEditTarget, type FolderLimits } from './trust';
import type { FolderTrustState, LiveConfig, LiveEnvironment, LiveModel, LiveSessionSummary } from './types';

export const DEFAULT_LIVE_CONFIG: LiveConfig = { fullAccess: false, defaultMode: 'default', defaultModel: '', maxConcurrent: 4 };

/** Sınama sınırının (`testing.claudeCli`) verdiği seçim: `auto` = bu bilgisayarda ara, `null` = Claude Code yok say. */
export type ClaudeCliChoice = 'auto' | null | CliCommand;

export interface ClaudeBridgeDeps {
  ctx: ModuleContext;
  repo: ProjectsRepo;
  homeDir: string;
  cli: ClaudeCliChoice;
  /** `claude auth login` için görünür konsol açar; hata metni ya da `null`. Sınamada sahte başlatıcı. */
  launchLogin(command: CliCommand): Promise<string | null>;
  /** Yöneticinin zaman ayarları (sınamalar kısaltır). */
  timing?: { settleMs?: number; interruptGraceMs?: number; closeGraceMs?: number; shutdownMs?: number; approvalMs?: number };
}

/** İzin onayı adada bu kadar bekler; süre dolunca istek sayfada beklemeye devam eder. */
const APPROVAL_MS = 5 * 60_000;
const PROBE_TTL_MS = 60_000;
/** Bu süre içinde yazılmış döküm "şu an başka yerde açık" sayılır (kendi kapanış yazımımız hariç). */
const RECENT_WRITE_MS = 90_000;
const OWN_WRITE_SLACK_MS = 3_000;

export interface FinishNotice {
  title: string;
  body: string;
  speak: string;
}

/**
 * Bitiş bildirimi: başlık durumu ve projeyi, gövde ayrıntıyı taşır (v1 `ccBitisBildirimi`). demo.5: gövde ve sesli
 * cümle oturumun son asistan iletisinden 1–2 cümlelik SONUCU taşır (`resultSummary`: kod, yol, liste, sır atılır);
 * hatayla bittiyse nedeni de kısaca söylenir.
 */
export function finishNotice(input: { project: string; changed: number; lastText: string; result: TurnEndInfo['result']; background: number }): FinishNotice {
  const { project } = input;
  const files = input.changed ? t('claude.notify.filesChanged', { count: input.changed }) : t('claude.notify.noFiles');
  const summary = resultSummary(input.lastText);
  const tail = summary ? ` ${summary}` : '';
  if (input.result.interrupted) return { title: t('claude.notify.stoppedTitle', { project }), body: `${files}.`, speak: t('claude.speak.stopped', { project }) };
  if (!input.result.ok) {
    const limit = input.result.errorClass === 'limit';
    const reason = resultSummary(input.result.error ?? '', 160);
    return {
      title: t(limit ? 'claude.notify.limitTitle' : 'claude.notify.errorTitle', { project }),
      body: truncate(input.result.error ?? t('claude.notify.unknownError'), 300),
      speak: `${t(limit ? 'claude.speak.limit' : 'claude.speak.error', { project })}${!limit && reason ? ` ${reason}` : ''}`,
    };
  }
  // Arkada iş sürerken iş "bitti" değil, yalnız bu tur bitti.
  if (input.background > 0) {
    return {
      title: t('claude.notify.turnTitle', { project }),
      body: `${files}.${tail} ${t('claude.notify.background', { count: input.background })}`,
      speak: `${t('claude.speak.turn', { project, files })}${tail}`,
    };
  }
  return { title: t('claude.notify.doneTitle', { project }), body: `${files}.${tail}`, speak: `${t('claude.speak.done', { project, files })}${tail}` };
}

/** İzin isteğinin onay kartında ve sesli soruda kullanılan cümlesi. */
export function approvalSentence(project: string, request: PermissionRequestEvent): string {
  const what = truncate(request.summary, 160);
  if (request.kind === 'question') return t('claude.approval.question', { project, what: truncate(request.questions?.[0]?.question ?? request.summary, 200) });
  if (request.kind === 'plan') return t('claude.approval.plan', { project });
  if (request.kind === 'edit') return t('claude.approval.edit', { project, what });
  if (request.kind === 'shell') return t('claude.approval.shell', { project, what });
  if (request.kind === 'web') return t('claude.approval.web', { project, what });
  return t('claude.approval.other', { project, tool: request.displayName ?? request.tool, what });
}

/** `claude agents --json` çıktısında bu oturum bizim olmayan bir süreçte açık mı. */
export function listedElsewhere(output: string, sessionId: string, ourPids: Set<number>): boolean {
  if (!output.trim()) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return output.includes(sessionId);
  }
  const list = Array.isArray(parsed) ? parsed : isRecord(parsed) && Array.isArray(parsed.agents) ? parsed.agents : null;
  if (!list) return output.includes(sessionId);
  return list.some((item) => isRecord(item) && item.sessionId === sessionId && !(typeof item.pid === 'number' && ourPids.has(item.pid)));
}

export function createClaudeBridge(deps: ClaudeBridgeDeps) {
  const { ctx, repo } = deps;
  const subscriptions: Unsubscribe[] = [];
  const claudeDir = path.join(deps.homeDir, '.claude');
  let account: LiveEnvironment['account'] = null;
  let probe: { at: number; value: CliProbe } | null = null;
  let watched: string | null = null;
  /** Asistan sohbet oturumu → kanalı (özet doğru kanala yazılsın). */
  const chatChannels = new Map<Id, Channel>();
  /** İzin isteği → adadaki onayın kimliği. */
  const approvals = new Map<string, Id>();
  const settledOnPage = new Set<string>();

  const config = (): LiveConfig => {
    const stored = repo.kvGet<Partial<LiveConfig>>('claude.config') ?? {};
    const merged: LiveConfig = { ...DEFAULT_LIVE_CONFIG, ...stored };
    if (!isPermissionMode(merged.defaultMode)) merged.defaultMode = DEFAULT_LIVE_CONFIG.defaultMode;
    // Tam yetki kapalıyken varsayılan kip Tam yetki olamaz.
    if (merged.defaultMode === 'bypassPermissions' && !merged.fullAccess) merged.defaultMode = DEFAULT_LIVE_CONFIG.defaultMode;
    merged.maxConcurrent = Math.min(8, Math.max(1, Math.round(Number(merged.maxConcurrent)) || DEFAULT_LIVE_CONFIG.maxConcurrent));
    merged.defaultModel = typeof merged.defaultModel === 'string' ? merged.defaultModel.trim() : '';
    merged.fullAccess = merged.fullAccess === true;
    return merged;
  };

  const command = (): CliCommand | null => {
    if (deps.cli === null) return null;
    if (deps.cli !== 'auto') return deps.cli;
    const file = locateClaudeCli();
    return file ? { command: file, prefixArgs: [] } : null;
  };

  const trustStore = createTrustStore({ read: () => repo.kvGet<unknown>('claude.trust'), write: (value) => repo.kvSet('claude.trust', value) });
  const limits = (): FolderLimits => defaultFolderLimits({ dataDir: ctx.paths.data, claudeDir, documentsDir: path.join(deps.homeDir, 'Documents'), homeDir: deps.homeDir });
  const trustState = (cwd: string): FolderTrustState & { fingerprint: string } =>
    folderTrustState(cwd, trustStore.get(cwd), { userClaudeDir: claudeDir, claudeCodeTrusted: claudeCodeTrusts(cwd, deps.homeDir) });

  const projectFor = (cwd: string): ProjectDetail | null =>
    repo
      .listProjects()
      .filter((project) => isInside(cwd, project.path))
      .sort((a, b) => b.path.length - a.path.length)[0] ?? null;

  const knownFolder = (cwd: string): { projectId: Id | null; projectName: string } | null => {
    const project = projectFor(cwd);
    if (project) return { projectId: project.id, projectName: project.name };
    // Proje dizininde olmasa da Claude Code'un daha önce çalıştığı klasör bilinen klasördür (oturum sürdürme).
    const target = path.resolve(cwd).toLowerCase();
    if (repo.sessionCwds().some((known) => path.resolve(known).toLowerCase() === target)) return { projectId: null, projectName: path.basename(cwd) || cwd };
    return null;
  };

  async function openElsewhere(sessionId: string, ours: OurTraces): Promise<boolean> {
    if (ours.live.has(sessionId)) return false;
    try {
      const file = repo.getSession(sessionId).filePath;
      const modified = fs.statSync(file).mtimeMs;
      const closed = ours.closedAt.get(sessionId);
      const ownWrite = closed !== undefined && modified <= closed + OWN_WRITE_SLACK_MS;
      if (Date.now() - modified < RECENT_WRITE_MS && !ownWrite) return true;
    } catch {
      // dizinde yok ya da dosya silinmiş: etkin ajan listesine bakılır
    }
    const cli = command();
    if (!cli) return false;
    const listed = await execCli(cli, ['agents', '--json'], 8_000).catch(() => ({ ok: false, stdout: '' }));
    return listedElsewhere(listed.stdout, sessionId, ours.pids);
  }

  // ── izin → onay akışı ──

  function requestApproval(summary: LiveSessionSummary, request: PermissionRequestEvent): void {
    const sentence = approvalSentence(summary.projectName, request);
    const decision = ctx.tools.requestApproval({
      toolName: 'claude_permission',
      moduleId: 'projects',
      summary: sentence,
      input: { liveId: summary.id, requestId: request.requestId, tool: request.tool, detail: truncate(request.summary, 300) },
      origin: { channel: 'ui', speakerVerified: null },
      timeoutMs: deps.timing?.approvalMs ?? APPROVAL_MS,
    });
    const pending = ctx.tools.pendingApprovals().find((approval) => isRecord(approval.input) && approval.input.requestId === request.requestId);
    if (pending) approvals.set(request.requestId, pending.id);
    void decision.then((result) => {
      approvals.delete(request.requestId);
      if (settledOnPage.delete(request.requestId)) return;
      if (result === 'approved') {
        if (request.kind === 'question') {
          // Soru onay/ret ile yanıtlanamaz: oturum açılır, yanıt sayfada verilir.
          ctx.bus.emit('app.navigate', { page: 'projects', params: { tab: 'sessions', live: summary.id } });
          return;
        }
        manager.answerPermission(summary.id, request.requestId, { decision: 'allow' });
      } else if (result === 'denied') {
        manager.answerPermission(summary.id, request.requestId, { decision: 'deny', ...(request.kind === 'question' ? { reason: t('claude.approval.questionDenied') } : {}) });
      } else {
        // Süre doldu: istek sayfada beklemeye devam eder; kalıcı bir bildirim bırakılır.
        ctx.attention.notify({
          moduleId: 'projects',
          title: t('claude.notify.waitingTitle', { project: summary.projectName }),
          body: sentence,
          priority: 'high',
          actions: [{ id: 'claude.open', label: t('claude.notify.open'), kind: 'primary' }],
          dedupeKey: `projects.claude.permission.${request.requestId}`,
          data: { liveId: summary.id },
        });
      }
    });
  }

  function approvalSettled(requestId: string): void {
    const approvalId = approvals.get(requestId);
    if (approvalId === undefined) return;
    // Sayfadan yanıtlandı ya da Claude Code isteği geri çekti: adadaki kart kalkar.
    settledOnPage.add(requestId);
    if (!ctx.tools.resolveApproval(approvalId, 'denied', 'ui')) settledOnPage.delete(requestId);
  }

  // ── bitiş özeti ──

  function writeToChat(chatSessionId: Id, text: string): void {
    try {
      ctx.conversation.appendMessage({ sessionId: chatSessionId, role: 'assistant', text, channel: chatChannels.get(chatSessionId) ?? 'chat' });
    } catch (error) {
      ctx.log.warn('claude özeti sohbete yazılamadı', error);
    }
  }

  function notifyEnd(summary: LiveSessionSummary, notice: FinishNotice, key: string): void {
    // Sayfada o an izlenen oturum için bildirim yok: kullanıcı zaten görüyor.
    if (watched === summary.id) return;
    ctx.attention.notify({
      moduleId: 'projects',
      title: notice.title,
      body: notice.body,
      priority: 'high',
      speak: notice.speak,
      actions: [{ id: 'claude.open', label: t('claude.notify.open'), kind: 'primary' }],
      dedupeKey: key,
      data: { liveId: summary.id },
    });
    // Bu bitiş duyuruldu: aynı bitişi bekleyen takip işi ("Claude bitirince haber ver") ayrıca bildirim göndermesin.
    ctx.bus.emit('projects.claudeAnnounced', { liveId: summary.id, project: summary.projectName, status: summary.status });
  }

  const manager: SessionManager = createSessionManager({
    command,
    config,
    emit: (envelope) => ctx.bus.emit('projects.claudeEvent', envelope),
    knownFolder,
    trust: trustState,
    protectedFolder: (cwd) => checkProtectedFolder(cwd, limits()),
    guardEdit: (cwd, tool, input) => guardEditTarget({ cwd, limits: limits(), tool, input }),
    openElsewhere,
    onPermission: requestApproval,
    onPermissionResolved: (_summary, requestId) => approvalSettled(requestId),
    onTurnEnd: (summary, info) => {
      const notice = finishNotice({ project: summary.projectName, changed: info.changedFiles.length, lastText: info.lastText, result: info.result, background: summary.background });
      if (info.chatSessionId !== undefined) writeToChat(info.chatSessionId, `${notice.title}: ${notice.body}`);
      notifyEnd(summary, notice, `projects.claude.end.${summary.id}.${summary.lastActivityAt}`);
      ctx.bus.emit('projects.changed', { entity: 'session', op: 'updated', ids: summary.sessionId ? [summary.sessionId] : [] });
    },
    onError: (summary, error, chatSessionId) => {
      const limit = summary.status === 'limit';
      const title = t(limit ? 'claude.notify.limitTitle' : 'claude.notify.crashTitle', { project: summary.projectName });
      if (chatSessionId !== undefined) writeToChat(chatSessionId, `${title}: ${truncate(error, 300)}`);
      notifyEnd(summary, { title, body: truncate(error, 300), speak: t(limit ? 'claude.speak.limit' : 'claude.speak.error', { project: summary.projectName }) }, `projects.claude.error.${summary.id}.${summary.lastActivityAt}`);
    },
    onAccount: (value) => {
      if (value) account = value;
    },
    models: { read: () => repo.kvGet<unknown>('claude.models'), write: (list: LiveModel[]) => repo.kvSet('claude.models', list) },
    log: ctx.log,
    clientApp: 'fuber-ai-2',
    ...(deps.timing ?? {}),
  });

  async function environment(): Promise<LiveEnvironment> {
    const cli = command();
    if (!probe || Date.now() - probe.at > PROBE_TTL_MS || probe.value.installed !== Boolean(cli)) {
      probe = { at: Date.now(), value: await probeClaudeCli(cli) };
    }
    return {
      installed: probe.value.installed,
      version: probe.value.version,
      loggedIn: probe.value.loggedIn,
      account,
      models: manager.models(),
      config: config(),
      running: manager.runningCount(),
    };
  }

  return {
    manager,
    config,
    environment,
    command,
    projectFor,
    /** Asistan aracının çağrısı: özet bu sohbete, doğru kanala yazılsın. */
    rememberChat(sessionId: Id, channel: Channel): void {
      chatChannels.set(sessionId, channel);
      if (chatChannels.size > 200) chatChannels.delete(chatChannels.keys().next().value as Id);
    },
    async setConfig(patch: Partial<LiveConfig>): Promise<LiveConfig> {
      const before = config();
      repo.kvSet('claude.config', { ...before, ...patch });
      const next = config();
      repo.kvSet('claude.config', next);
      if (before.fullAccess && !next.fullAccess) await manager.fullAccessRevoked();
      return next;
    },
    trustState,
    async setTrust(cwd: string, decision: 'trust' | 'distrust' | null): Promise<FolderTrustState> {
      // Karar yalnız bilinen proje klasörleri için tutulur.
      if (!knownFolder(cwd)) return trustState(cwd);
      trustStore.set(cwd, decision, decision === 'trust' ? trustState(cwd).fingerprint : undefined);
      await manager.trustChanged(cwd);
      return trustState(cwd);
    },
    watch(id: string | null): void {
      watched = id;
    },
    async login() {
      const cli = command();
      if (!cli) return { ok: false, code: 'no_cli' as const, error: t('claude.tool.noCli') };
      const error = await deps.launchLogin(cli);
      probe = null;
      return error ? { ok: false, error: t('claude.op.loginFailed', { error }) } : { ok: true, error: t('claude.op.loginStarted') };
    },
    start(): void {
      subscriptions.push(
        ctx.bus.on('app.panic', () => void manager.interruptAll()),
        ctx.bus.on('attention.action', ({ moduleId, actionId, data }) => {
          if (moduleId !== 'projects' || actionId !== 'claude.open' || typeof data.liveId !== 'string') return;
          ctx.bus.emit('app.navigate', { page: 'projects', params: { tab: 'sessions', live: data.liveId } });
        }),
      );
    },
    async stop(): Promise<void> {
      for (const off of subscriptions.splice(0)) off();
      await manager.shutdown();
    },
  };
}

export type ClaudeBridge = ReturnType<typeof createClaudeBridge>;

/** Kullanıcının ev klasörü (sınamalar başka bir klasör verir). */
export const defaultHomeDir = (): string => os.homedir();
