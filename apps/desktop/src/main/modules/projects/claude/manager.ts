/**
 * Uygulama içi Claude Code oturum yöneticisi (v1 `claudecode/oturum-yoneticisi.ts` › `CcYonetici`'den taşındı).
 * Electron'a bağlı değildir: yayın, bildirim, ayar, güven ve "başka yerde açık" kancaları dışarıdan verilir (`bridge.ts`).
 *
 *  • Eşzamanlılık: aynı anda en çok `maxConcurrent` çalışan tur; fazlası sırada (sıra numarasıyla görünür). Boştaki
 *    süreçler sayılmaz; `maxLiveProcesses` aşılınca en eskisi kapatılır (sonraki iletide `--resume` ile açılır).
 *  • Araya girme: tur sürerken yazılan ileti hemen Claude Code'a yazılır (CLI onu bir sonraki adımda tura katar ya da
 *    turdan sonra yeni tur olarak işler). Tur sonucu geldikten sonra akış sürerse oturum yeniden "çalışıyor" olur ve
 *    bitiş bildirimi ertelenir: yarıda "bitti" denmez.
 *  • İzin: her `can_use_tool` isteği bekleyen izin kaydı + olay; yanıt gelene dek SÜRESİZ bekler. "Bu oturumda hep izin
 *    ver" yalnız oturum kapsamındadır (kalıcı ayar dosyasına yazılmaz).
 *  • Kısıtlı oturum (asistanın sesle/sohbetten başlattığı): kip en çok "Düzenlemelere izin ver"; oturum klasörünün
 *    dışına, korunan klasörlere ve klasörün `.claude/`, `.mcp.json`, `.git/` dosyalarına yazım her zaman sorulur
 *    (PreToolUse kancası). Kısıt yalnız kullanıcı sayfada açıkça Tam yetki seçince kalkar.
 *  • Klasör güveni: klasörün kendi Claude Code ayarları varsa ve güvenilmediyse `--setting-sources user` (kancaları,
 *    izin kuralları, MCP sunucuları yüklenmez). Sayfadan ilk oturum karar verilmeden açılmaz; asistan kartı
 *    yanıtlayamaz: güvenilmemiş sayılır ve dökümde açıkça söylenir.
 *  • Çökme: süreç beklenmedik biçimde biterse oturum "hata" olur; sonraki ileti `--resume` ile sürdürür.
 *  • Kapanış: önce durdurma isteği, en çok `shutdownMs` beklenir, sonra girdi kapatılır; kalan süreç ağacıyla öldürülür.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { t, type Id, type Logger } from '@fuber/shared';
import type { CliCommand } from '../../../core/claude-cli/process';
import { buildSessionArgs, openSessionChannel, type CanUseToolRequest, type PermissionResult, type SessionChannel, type SessionExit } from '../../../core/claude-cli/session-channel';
import { describeCliCrash, describeCliError } from '../../../core/claude-cli/session-errors';
import {
  checkAnswers,
  CLI_MODEL_RE,
  CLI_SESSION_ID_RE,
  isEffortLevel,
  isPermissionMode,
  isRecord,
  oneLine,
  readQuestions,
  showsCost,
  toolKind,
  toolSummary,
  truncate,
  truncateInput,
  type BackgroundTask,
  type EffortLevel,
  type PermissionMode,
  type PermissionRequestEvent,
  type TodoItem,
  type TokenUsage,
  type TurnResultEvent,
} from '../../../core/claude-cli/session-events';
import { createNormalizeContext, normalizeSessionMessage, resetBackground, type NormalizeContext } from '../../../core/claude-cli/session-normalize';
import type {
  FolderTrustState,
  LiveCommand,
  LiveConfig,
  LiveEnvelope,
  LiveEvent,
  LiveImage,
  LiveModel,
  LiveOpCode,
  LiveOpResult,
  LivePermissionAnswer,
  LiveSessionDetail,
  LiveSessionSummary,
  LiveSource,
  LiveStartResult,
  LiveStatus,
} from './types';

export interface StartInput {
  cwd: string;
  prompt?: string;
  images?: LiveImage[];
  resume?: string;
  fork?: boolean;
  mode?: PermissionMode;
  model?: string | null;
  effort?: EffortLevel | null;
  title?: string;
  source?: LiveSource;
  /** Asistan sohbetinden verildiyse: bitince özet o sohbete BİR KEZ yazılır. */
  chatSessionId?: Id;
  /** Asistanın işi için kullanıcı Tam yetkiyi açıkça onayladı (onay kartı): kip tavanı uygulanmaz. */
  fullAccessApproved?: boolean;
  /** "Başka yerde açık" denetimini atla (kullanıcı uyarıyı gördü ve yine de istedi). */
  force?: boolean;
}

export interface TurnEndInfo {
  result: TurnResultEvent;
  lastText: string;
  changedFiles: string[];
  source: LiveSource;
  /** Yalnız sohbetten verilen İŞİN bitişinde (bir kez). */
  chatSessionId?: Id;
}

export interface OurTraces {
  /** Süreci şu an yaşayan oturum kimlikleri. */
  live: Set<string>;
  /** Oturum kimliği → bizim sürecimizin o oturumda son kapandığı an. */
  closedAt: Map<string, number>;
  pids: Set<number>;
}

export interface SessionManagerDeps {
  /** Çalıştırılacak Claude Code; `null`: bu bilgisayarda yok (ya da sınamada verilmedi). */
  command(): CliCommand | null;
  config(): LiveConfig;
  emit(envelope: LiveEnvelope): void;
  /** Bilinen proje klasörü mü; değilse `null` (oturum açılmaz). */
  knownFolder(cwd: string): { projectId: Id | null; projectName: string } | null;
  trust(cwd: string): FolderTrustState;
  /** Geniş/korunan klasör denetimi: `reason` doluysa oturum açılmaz; `path` gerçek yol. */
  protectedFolder(cwd: string): { reason: string | null; path: string };
  /** Kısıtlı oturumda düzenleme hedefi sorulmalı mı (Türkçe neden ya da `null`). */
  guardEdit(cwd: string, tool: string, input: unknown): string | null;
  openElsewhere?(sessionId: string, ours: OurTraces): Promise<boolean>;
  onPermission?(summary: LiveSessionSummary, request: PermissionRequestEvent): void;
  onPermissionResolved?(summary: LiveSessionSummary, requestId: string): void;
  /** Bir iş bitti (zorla durdurma dahil) ve oturumda bekleyen ileti yok. */
  onTurnEnd?(summary: LiveSessionSummary, info: TurnEndInfo): void;
  /** Çökme ya da başlatma hatası. */
  onError?(summary: LiveSessionSummary, error: string, chatSessionId?: Id): void;
  onAccount?(account: { email?: string; plan?: string } | null): void;
  models?: { read(): unknown; write(list: LiveModel[]): void };
  log: Pick<Logger, 'warn'>;
  clientApp?: string;
  maxLiveProcesses?: number;
  /** Kapalı oturum kaydı sınırı (fazlası unutulur). */
  maxClosed?: number;
  shutdownMs?: number;
  interruptGraceMs?: number;
  closeGraceMs?: number;
  /** Akış parçası yayın aralığı (ms). */
  deltaIntervalMs?: number;
  /** Tur sonucundan sonra "bitti" demeden önce beklenen süre (araya giren ileti yeni tur açabilir). */
  settleMs?: number;
}

interface Outgoing {
  id: string;
  text: string;
  images?: LiveImage[];
}

interface PendingPermission {
  event: PermissionRequestEvent;
  input: Record<string, unknown>;
  suggestions: unknown[];
  toolUseId?: string;
  channel: SessionChannel;
}

interface SessionRecord {
  id: string;
  sessionId?: string;
  cwd: string;
  projectId: Id | null;
  projectName: string;
  title: string;
  source: LiveSource;
  chatSessionId?: Id;
  /** Sohbetten verilen iş sürüyor: bitince/çökünce sohbete BİR KEZ özet. */
  chatJob: boolean;
  restricted: boolean;
  /** Kısıt konduğunda sabitlenen gerçek klasör (kanca hedefleri bununla karşılaştırılır). */
  root?: string;
  untrusted: boolean;
  trustNote?: string;
  mode: PermissionMode;
  model?: string;
  activeModel?: string;
  effort?: EffortLevel;
  /** Canlı süreç eforu uygulayamadı: tur bitince süreç kapatılır, sonraki ileti yeni değerle açar. */
  effortPending: boolean;
  first: { resume?: string; fork: boolean };
  channel?: SessionChannel;
  /** Sürecin "Tam yetki"ye geçme izni (`--allow-dangerously-skip-permissions`). */
  allowBypass: boolean;
  turnActive: boolean;
  /** Eşzamanlı sınır sırasında. */
  waiting: boolean;
  closed: boolean;
  closing: boolean;
  interruptRequested: boolean;
  error?: string;
  outcome?: 'done' | 'stopped' | 'error' | 'limit';
  limitResetsAt?: number | null;
  queue: Outgoing[];
  permissions: Map<string, PendingPermission>;
  events: LiveEnvelope[];
  seq: number;
  ctx: NormalizeContext;
  deltaPending: Map<string, { text: string; parent: string | null }>;
  deltaTimer?: ReturnType<typeof setTimeout>;
  deltaEntries: Map<string, LiveEnvelope>;
  cost?: number;
  showCost: boolean;
  usage?: TokenUsage;
  durationMs: number;
  turns: number;
  changed: Set<string>;
  pendingEdits: Map<string, string>;
  todos: TodoItem[];
  tasks: BackgroundTask[];
  background: number;
  commands: LiveCommand[];
  lastText: string;
  lastResult?: TurnResultEvent;
  version?: string;
  lastInit?: string;
  lastSignature?: string;
  interruptTimer?: ReturnType<typeof setTimeout>;
  settleTimer?: ReturnType<typeof setTimeout>;
  exited?: Promise<void>;
  resolveExit?: () => void;
  createdAt: number;
  lastActivityAt: number;
}

const EVENT_LIMIT = 2000;
const CLOSED_EVENT_LIMIT = 200;
const IMAGE_LIMIT = 6 * 1024 * 1024;
const QUEUE_LIMIT = 50;
const QUEUE_IMAGE_LIMIT = 20;
const QUEUE_IMAGE_BYTES = 32 * 1024 * 1024;
/** Çıkmış sürecimizin PID'i bu süre boyunca bizim sayılır (sonra işletim sistemi numarayı başka sürece verebilir). */
const EXITED_PID_MS = 30_000;
const MEDIA = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const DEFAULT_MODELS: LiveModel[] = [
  { value: 'default', label: 'Default', description: '' },
  { value: 'opus', label: 'Opus', description: '' },
  { value: 'sonnet', label: 'Sonnet', description: '' },
  { value: 'haiku', label: 'Haiku', description: '' },
];
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error ?? ''));
const fail = (code: LiveOpCode, error: string): LiveOpResult => ({ ok: false, code, error });
const OK: LiveOpResult = { ok: true };
const emptyUsage = (): TokenUsage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
const interruptedResult = (): TurnResultEvent => ({ type: 'result', ok: false, interrupted: true, durationMs: 0, turns: 0, costUsd: 0, usage: emptyUsage() });

/** Kip tavanı: asistanın başlattığı oturum en çok "Düzenlemelere izin ver". */
export const cappedMode = (mode: PermissionMode): PermissionMode => (mode === 'bypassPermissions' ? 'acceptEdits' : mode);
export const modeSelectable = (mode: PermissionMode, fullAccess: boolean): boolean => mode !== 'bypassPermissions' || fullAccess;
/** Yeni oturumun kipi: istenen (seçilebiliyorsa) → kayıtlı varsayılan (seçilebiliyorsa) → her şeyi sor. */
export function startMode(config: Pick<LiveConfig, 'fullAccess' | 'defaultMode'>, requested?: unknown): PermissionMode {
  if (isPermissionMode(requested) && modeSelectable(requested, config.fullAccess)) return requested;
  if (isPermissionMode(config.defaultMode) && modeSelectable(config.defaultMode, config.fullAccess)) return config.defaultMode;
  return 'default';
}

/** İzin isteğini olaya çevirir (v1 `izinIstegiOlayi`). */
export function permissionEvent(request: CanUseToolRequest): PermissionRequestEvent {
  const { input, truncated } = truncateInput(request.input);
  const kind = toolKind(request.toolName);
  return {
    type: 'permission_request',
    requestId: request.requestId,
    tool: request.toolName,
    kind,
    input,
    summary: toolSummary(request.toolName, input),
    ...(request.title ? { title: oneLine(request.title, 300) } : {}),
    ...(request.displayName ? { displayName: oneLine(request.displayName, 80) } : {}),
    ...(request.description ? { description: oneLine(request.description, 400) } : {}),
    // eslint-disable-next-line no-control-regex
    ...(request.decisionReason ? { reason: oneLine(request.decisionReason.replace(/\u001b\[[0-9;]*m/g, ''), 400) } : {}),
    ...(kind === 'question' ? { questions: readQuestions(input) } : {}),
    canAlways: kind !== 'question' && !request.suppressAlwaysAllow && request.suggestions.length > 0,
    ...(request.defaultToNo ? { defaultNo: true } : {}),
    ...(request.agentId ? { agentId: request.agentId } : {}),
    ...(request.toolUseId ? { toolUseId: request.toolUseId } : {}),
    ...(truncated ? { truncated } : {}),
  };
}

export function createSessionManager(deps: SessionManagerDeps) {
  const records = new Map<string, SessionRecord>();
  let waitingLine: string[] = [];
  let shuttingDown = false;
  /** Claude Code oturum kimliği → bizim sürecimizin o oturumda son kapandığı an ("başka yerde açık" için). */
  const closedAt = new Map<string, number>();
  /** Çıkmış süreçlerimizin PID'leri → çıkış anı. */
  const exitedPids = new Map<number, number>();
  let modelList: LiveModel[] | null = null;

  const maxConcurrent = () => Math.min(8, Math.max(1, Math.round(deps.config().maxConcurrent) || 1));
  const maxLive = () => Math.max(maxConcurrent(), deps.maxLiveProcesses ?? 8);
  const live = (record: SessionRecord): boolean => Boolean(record.channel?.alive());
  const hook = (run: () => void) => {
    try {
      run();
    } catch (error) {
      deps.log.warn('claude oturum kancası hata verdi', errorText(error));
    }
  };

  // ── özet ve yayın ──

  function statusOf(record: SessionRecord): LiveStatus {
    if (record.closed) return 'closed';
    if (record.permissions.size) return 'permission';
    if (record.turnActive) return 'running';
    if (record.error) return record.outcome === 'limit' ? 'limit' : 'error';
    if (record.waiting) return 'queued';
    return record.outcome ?? 'idle';
  }

  function summaryOf(record: SessionRecord): LiveSessionSummary {
    const position = record.waiting ? waitingLine.indexOf(record.id) + 1 : 0;
    return {
      id: record.id,
      ...(record.sessionId ? { sessionId: record.sessionId } : {}),
      cwd: record.cwd,
      projectId: record.projectId,
      projectName: record.projectName,
      title: record.title,
      status: statusOf(record),
      mode: record.mode,
      ...(record.model ? { model: record.model } : {}),
      ...(record.activeModel ? { activeModel: record.activeModel } : {}),
      ...(record.effort ? { effort: record.effort } : {}),
      source: record.source,
      ...(record.chatSessionId !== undefined ? { chatSessionId: record.chatSessionId } : {}),
      pendingPermissions: record.permissions.size,
      queued: record.queue.length,
      ...(position > 0 ? { queuePosition: position } : {}),
      background: record.background,
      // Abonelikte tahmini dolar özete hiç girmez.
      ...(record.cost !== undefined && record.showCost ? { costUsd: record.cost } : {}),
      ...(record.usage ? { usage: { ...record.usage } } : {}),
      ...(record.durationMs ? { durationMs: record.durationMs } : {}),
      ...(record.turns ? { turns: record.turns } : {}),
      changedFiles: record.changed.size,
      ...(record.version ? { version: record.version } : {}),
      ...(record.untrusted ? { untrusted: true } : {}),
      ...(record.error ? { error: record.error } : {}),
      ...(record.limitResetsAt !== undefined ? { limitResetsAt: record.limitResetsAt } : {}),
      createdAt: record.createdAt,
      lastActivityAt: record.lastActivityAt,
    };
  }

  function keep(record: SessionRecord, envelope: LiveEnvelope): void {
    record.events.push(envelope);
    if (record.events.length > EVENT_LIMIT) {
      for (const dropped of record.events.splice(0, record.events.length - EVENT_LIMIT)) {
        if (dropped.event.type === 'text_delta' && record.deltaEntries.get(dropped.event.block) === dropped) record.deltaEntries.delete(dropped.event.block);
      }
    }
  }

  /** Bekleyen akış parçalarını yayınlar; dökümdeki blok başına birikimli kayıt aynı anda güncellenir. */
  function flushDeltas(record: SessionRecord): void {
    if (record.deltaTimer) {
      clearTimeout(record.deltaTimer);
      record.deltaTimer = undefined;
    }
    if (!record.deltaPending.size) return;
    const pending = [...record.deltaPending];
    record.deltaPending.clear();
    for (const [block, part] of pending) {
      const envelope: LiveEnvelope = { session: record.id, seq: ++record.seq, at: Date.now(), event: { type: 'text_delta', block, text: part.text, parent: part.parent } };
      const entry = record.deltaEntries.get(block);
      if (entry && entry.event.type === 'text_delta') {
        entry.event = { ...entry.event, text: entry.event.text + part.text };
        entry.seq = envelope.seq;
        entry.at = envelope.at;
      } else {
        const copy: LiveEnvelope = { ...envelope, event: { ...envelope.event } };
        record.deltaEntries.set(block, copy);
        keep(record, copy);
      }
      record.lastActivityAt = envelope.at;
      hook(() => deps.emit(envelope));
    }
  }

  function publish(record: SessionRecord, event: LiveEvent): void {
    if (event.type === 'text_delta') {
      // Parçalar toplu yayınlanır (IPC seli olmasın) ve dökümde tek kayıtta birikir.
      const pending = record.deltaPending.get(event.block);
      if (pending) pending.text += event.text;
      else record.deltaPending.set(event.block, { text: event.text, parent: event.parent });
      record.deltaTimer ??= setTimeout(() => flushDeltas(record), deps.deltaIntervalMs ?? 50);
      return;
    }
    flushDeltas(record);
    const envelope: LiveEnvelope = { session: record.id, seq: ++record.seq, at: Date.now(), event };
    // `status` ve `tasks` anlık hâldir; `rate_limit` yalnız sınır dolunca dökümde tutulur.
    if (event.type !== 'status' && event.type !== 'tasks' && !(event.type === 'rate_limit' && event.status !== 'rejected')) {
      record.lastActivityAt = envelope.at;
      const entry = event.type === 'text' ? record.deltaEntries.get(event.block) : undefined;
      if (entry && event.type === 'text') {
        // Tam metin birikimli parçanın YERİNE (konumu korunur).
        entry.event = event;
        entry.seq = envelope.seq;
        entry.at = envelope.at;
        record.deltaEntries.delete(event.block);
      } else keep(record, { ...envelope });
    }
    hook(() => deps.emit(envelope));
  }

  function publishStatus(record: SessionRecord): void {
    const summary = summaryOf(record);
    const signature = JSON.stringify([
      summary.status,
      summary.queued,
      summary.pendingPermissions,
      summary.queuePosition,
      summary.mode,
      summary.model,
      summary.activeModel,
      summary.effort,
      summary.error,
      summary.costUsd,
      summary.sessionId,
      summary.title,
      summary.changedFiles,
      summary.version,
      summary.turns,
      summary.background,
      summary.untrusted,
      summary.limitResetsAt,
    ]);
    if (signature === record.lastSignature) return;
    record.lastSignature = signature;
    publish(record, { type: 'status', summary });
  }

  const system = (record: SessionRecord, level: 'info' | 'warn' | 'error', text: string) => publish(record, { type: 'system', level, text });

  // ── bulma ──

  const byAnyId = (id: string): SessionRecord | undefined =>
    records.get(id) ??
    [...records.values()].filter((record) => record.sessionId === id).sort((a, b) => Number(live(b)) - Number(live(a)) || b.lastActivityAt - a.lastActivityAt)[0];

  const traces = (): OurTraces => {
    const now = Date.now();
    for (const [pid, at] of exitedPids) if (now - at > EXITED_PID_MS) exitedPids.delete(pid);
    return {
      live: new Set([...records.values()].filter((record) => live(record) && record.sessionId).map((record) => record.sessionId!)),
      closedAt: new Map(closedAt),
      // Az önce çıkan süreçlerimiz de bizimdir: etkin ajan listesi onları kısa süre daha gösterebilir.
      pids: new Set([...[...records.values()].map((record) => record.channel?.pid).filter((pid): pid is number => pid !== undefined), ...exitedPids.keys()]),
    };
  };

  // ── iletiler, sıra ──

  function checkMessage(record: SessionRecord, rawText: unknown, rawImages: unknown): LiveOpResult | { message: Outgoing } {
    if (shuttingDown) return fail('shutting_down', t('claude.op.shuttingDown'));
    const text = typeof rawText === 'string' ? rawText : '';
    const images = Array.isArray(rawImages)
      ? (rawImages as LiveImage[]).filter((image) => image && MEDIA.has(image.mediaType) && typeof image.data === 'string' && image.data.length <= IMAGE_LIMIT).slice(0, 10)
      : [];
    if (!text.trim() && !images.length) return fail('empty', t('claude.op.empty'));
    if (text.length > 200_000) return fail('too_large', t('claude.op.tooLarge'));
    if (record.queue.length >= QUEUE_LIMIT) return fail('queue_full', t('claude.op.queueFull'));
    // Bekleyen iletilerdeki görseller toplamda sınırlıdır (sırada bekleyen onlarca ileti belleği doldurmasın).
    const queuedImages = record.queue.flatMap((message) => message.images ?? []);
    const bytes = (list: LiveImage[]): number => list.reduce((total, image) => total + image.data.length, 0);
    if (images.length && (queuedImages.length + images.length > QUEUE_IMAGE_LIMIT || bytes(queuedImages) + bytes(images) > QUEUE_IMAGE_BYTES)) {
      return fail('too_large', t('claude.op.queueImages'));
    }
    return { message: { id: randomUUID(), text, ...(images.length ? { images } : {}) } };
  }

  const activeCount = (): number => [...records.values()].filter((record) => record.turnActive).length;

  function enqueue(record: SessionRecord, message: Outgoing): void {
    // Tur sürerken yazılan ileti hemen Claude Code'a gider (araya girme).
    if (record.turnActive && record.channel?.alive() && !record.closing) {
      if (deliver(record, message)) {
        publishStatus(record);
        return;
      }
    }
    record.queue.push(message);
    if (!record.turnActive) joinLine(record);
    pump();
    publishStatus(record);
  }

  function joinLine(record: SessionRecord): void {
    if (record.waiting || record.turnActive || !record.queue.length) return;
    record.waiting = true;
    waitingLine.push(record.id);
  }

  function leaveLine(record: SessionRecord): void {
    if (!record.waiting) return;
    record.waiting = false;
    waitingLine = waitingLine.filter((id) => id !== record.id);
  }

  function pump(): void {
    if (shuttingDown) return;
    while (waitingLine.length && activeCount() < maxConcurrent()) {
      const record = records.get(waitingLine.shift()!);
      if (!record) continue;
      record.waiting = false;
      // Süreci kapanmakta olan oturum atlanır: çıkışı işlenince kuyruğu yeniden sıraya girer.
      if (record.closed || record.turnActive || !record.queue.length || record.closing) {
        publishStatus(record);
        continue;
      }
      startTurn(record);
    }
    for (const id of waitingLine) {
      const record = records.get(id);
      if (record) publishStatus(record);
    }
  }

  function deliver(record: SessionRecord, message: Outgoing): boolean {
    const sent = record.channel?.sendUser({ id: message.id, text: message.text, ...(message.images ? { images: message.images } : {}) }) ?? false;
    if (!sent) return false;
    publish(record, { type: 'user', id: message.id, text: message.text, images: message.images?.length ?? 0 });
    return true;
  }

  function startTurn(record: SessionRecord): void {
    const message = record.queue.shift()!;
    record.turnActive = true;
    record.interruptRequested = false;
    record.lastText = '';
    record.outcome = undefined;
    cancelSettle(record);
    let problem: string | null = null;
    try {
      ensureProcess(record);
      if (!deliver(record, message)) problem = t('claude.op.notDelivered');
    } catch (error) {
      problem = errorText(error);
    }
    if (problem !== null) {
      record.turnActive = false;
      record.queue.unshift(message);
      // Süreç hiç başlamadıysa asıl nedeni çıkış olayı bildirir; burada ikinci (ve yanıltıcı) bir hata üretilmez.
      if (record.channel && !record.channel.alive()) {
        publishStatus(record);
        pump();
        return;
      }
      toError(record, problem);
      pump();
      return;
    }
    // Kalan iletiler de aynı tura yazılır: Claude Code sırayla işler.
    while (record.queue.length && deliver(record, record.queue[0]!)) record.queue.shift();
    publishStatus(record);
  }

  // ── süreç ──

  /** Boştaki fazla süreçleri kapatır (en eski etkinlik önce); sonraki iletide `--resume` ile açılırlar. */
  function pruneIdle(): void {
    const alive = [...records.values()].filter(live);
    if (alive.length < maxLive()) return;
    // Arka planda iş süren oturumun süreci kapatılmaz: iş onunla ölür.
    const idle = alive.filter((record) => !record.turnActive && !record.permissions.size && !record.waiting && record.background === 0).sort((a, b) => a.lastActivityAt - b.lastActivityAt);
    for (const record of idle.slice(0, alive.length - maxLive() + 1)) void closeProcess(record);
  }

  function ensureProcess(record: SessionRecord): void {
    if (record.channel?.alive()) return;
    const command = deps.command();
    if (!command) throw new Error(describeCliError('claude-yok ENOENT').text);
    const config = deps.config();
    if (record.restricted) {
      // Kısıtlı oturumun klasörü süreç açılmadan HEMEN önce yeniden denetlenir: sabitlenen gerçek yoldan ayrıldıysa açılmaz.
      const checked = deps.protectedFolder(record.cwd);
      if (checked.reason) throw new Error(t('claude.op.protectedFolder', { reason: checked.reason }));
      if (record.root && path.resolve(record.root).toLowerCase() !== path.resolve(checked.path).toLowerCase()) throw new Error(t('claude.op.folderMoved'));
      record.root = checked.path;
    }
    pruneIdle();
    if (record.mode === 'bypassPermissions' && (!config.fullAccess || record.restricted)) record.mode = record.restricted ? cappedMode(record.mode) : startMode(config);
    record.allowBypass = config.fullAccess && !record.restricted;
    const trust = deps.trust(record.cwd);
    const folderSettings = !trust.required || trust.decision === 'trust';
    record.untrusted = !folderSettings;
    if (!folderSettings) {
      const note = trust.decision === 'distrust' ? 'distrust' : 'undecided';
      if (record.trustNote !== note) {
        record.trustNote = note;
        system(record, 'info', t(note === 'distrust' ? 'claude.op.trustSkipped' : 'claude.op.trustUndecided'));
      }
    } else record.trustNote = undefined;
    const resume = record.sessionId ?? record.first.resume;
    const args = buildSessionArgs({
      mode: record.mode,
      ...(resume ? { resume } : {}),
      fork: !record.sessionId && record.first.fork,
      ...(record.model && record.model !== 'default' ? { model: record.model } : {}),
      ...(record.effort ? { effort: record.effort } : {}),
      allowBypass: record.allowBypass,
      folderSettings,
      strictMcp: trust.mcp,
    });
    const channel: SessionChannel = openSessionChannel({
      command,
      args,
      cwd: record.cwd,
      ...(deps.clientApp ? { clientApp: deps.clientApp } : {}),
      // Kanca her sürece kayıtlıdır; karar çağrı anında kayıttan okunur (kısıt sonradan da konabilir).
      preToolUse: ({ toolName, toolInput }) => {
        if (!record.restricted || !EDIT_TOOLS.has(toolName)) return null;
        try {
          return deps.guardEdit(record.root ?? record.cwd, toolName, toolInput);
        } catch {
          return t('claude.op.guardFailed');
        }
      },
      onMessage: (message) => {
        if (record.channel !== channel) return;
        for (const event of normalizeSessionMessage(message, record.ctx, { interruptRequested: record.interruptRequested })) handleEvent(record, event);
      },
      onPermission: (request) => {
        if (record.channel === channel) askPermission(record, channel, request);
      },
      onPermissionCancelled: (requestId) => {
        if (!record.permissions.delete(requestId)) return;
        publish(record, { type: 'permission_resolved', requestId, decision: 'cancelled' });
        publishStatus(record);
        hook(() => deps.onPermissionResolved?.(summaryOf(record), requestId));
      },
      onExit: (exit) => processEnded(record, channel, exit),
    });
    record.channel = channel;
    record.exited = new Promise((resolve) => {
      record.resolveExit = resolve;
    });
    void channel
      .initialize()
      .then((info) => {
        if (record.channel !== channel) return;
        record.commands = info.commands;
        if (info.version) record.version = info.version;
        storeModels(info.models);
        hook(() => deps.onAccount?.(info.account));
        publishStatus(record);
      })
      .catch(() => {
        // Süreç kapandıysa çıkış ayrıca işlenir; eski sürüm el sıkışmaya yanıt vermediyse oturum yine çalışır.
      });
  }

  function handleEvent(record: SessionRecord, event: LiveEvent): void {
    // Tur sonucu geldikten sonra ANA konuşma sürüyorsa (araya giren ileti ya da biten arka plan işi yeni tur açtı) oturum
    // yeniden çalışıyor sayılır: yeni tur `init` ile başlar. Alt ajanın (parent dolu) geç gelen iletileri turu açmaz;
    // yoksa oturum, sonucu hiç gelmeyecek bir "çalışıyor"da takılı kalırdı.
    const mainActivity =
      event.type === 'init' ||
      ((event.type === 'text_delta' || event.type === 'text' || event.type === 'tool_start' || event.type === 'thinking' || event.type === 'subagent' || event.type === 'todos') &&
        event.parent === null);
    if (!record.turnActive && !record.closing && mainActivity) {
      record.turnActive = true;
      record.interruptRequested = false;
      record.outcome = undefined;
      cancelSettle(record);
    }
    switch (event.type) {
      case 'init': {
        if (event.sessionId) record.sessionId = event.sessionId;
        // `init` her turda çözülmüş tam kimliği getirir; kullanıcının seçimi (record.model) ezilmez.
        if (event.model) record.activeModel = event.model;
        if (isPermissionMode(event.mode)) record.mode = event.mode;
        if (event.version) record.version = event.version;
        record.showCost = showsCost(event.apiKeySource);
        const signature = JSON.stringify([event.sessionId, event.model, event.mode, event.version]);
        if (signature === record.lastInit) {
          publishStatus(record);
          return;
        }
        record.lastInit = signature;
        break;
      }
      case 'mode':
        if (!isPermissionMode(event.mode) || event.mode === record.mode) return;
        record.mode = event.mode;
        break;
      case 'background':
        record.background = event.count;
        if (event.count === 0 && record.effortPending && idle(record)) {
          record.effortPending = false;
          void closeProcess(record);
        }
        break;
      case 'tasks':
        record.tasks = event.tasks;
        break;
      case 'tool_start':
        if (event.kind === 'edit') {
          const target = event.input.file_path ?? event.input.notebook_path;
          if (typeof target === 'string' && target) record.pendingEdits.set(event.id, target);
        }
        break;
      case 'tool_end': {
        // Değişen dosyalar YALNIZ başarıyla biten düzenlemelerden (reddedilen sayılmaz).
        const target = record.pendingEdits.get(event.id);
        if (target !== undefined) {
          record.pendingEdits.delete(event.id);
          if (!event.error) record.changed.add(target);
        }
        break;
      }
      case 'todos':
        if (event.parent === null) record.todos = event.items;
        break;
      case 'text':
        if (event.parent === null) record.lastText = event.text;
        break;
      case 'rate_limit':
        if (event.status === 'rejected') record.limitResetsAt = event.resetsAt;
        else if (record.outcome !== 'limit') record.limitResetsAt = undefined;
        break;
      case 'result':
        publish(record, event);
        turnEnded(record, event);
        return;
      default:
        break;
    }
    publish(record, event);
    if (event.type === 'init' || event.type === 'mode' || event.type === 'tool_end' || event.type === 'background' || event.type === 'rate_limit') publishStatus(record);
  }

  const idle = (record: SessionRecord): boolean => !record.turnActive && !record.queue.length && !record.permissions.size && !record.waiting;

  function cancelSettle(record: SessionRecord): void {
    if (!record.settleTimer) return;
    clearTimeout(record.settleTimer);
    record.settleTimer = undefined;
  }

  function turnEnded(record: SessionRecord, result: TurnResultEvent): void {
    if (record.interruptTimer) {
      clearTimeout(record.interruptTimer);
      record.interruptTimer = undefined;
    }
    if (result.costUsd > 0) record.cost = result.costUsd;
    const usage = record.usage ?? emptyUsage();
    record.usage = {
      input: usage.input + result.usage.input,
      output: usage.output + result.usage.output,
      cacheRead: usage.cacheRead + result.usage.cacheRead,
      cacheWrite: usage.cacheWrite + result.usage.cacheWrite,
    };
    record.durationMs += result.durationMs;
    record.turns += result.turns;
    record.lastResult = result;
    if (!record.turnActive) {
      publishStatus(record);
      return;
    }
    record.turnActive = false;
    record.interruptRequested = false;
    record.outcome = result.interrupted ? 'stopped' : result.ok ? 'done' : result.errorClass === 'limit' ? 'limit' : 'error';
    if (record.outcome !== 'limit') record.limitResetsAt = undefined;
    cancelPermissions(record, t('claude.op.turnEnded'));
    if (record.queue.length) joinLine(record);
    else scheduleReport(record, result);
    if (record.effortPending && !record.queue.length && record.background === 0) {
      record.effortPending = false;
      void closeProcess(record);
    }
    publishStatus(record);
    pump();
  }

  /** Bitiş bildirimi kısa bir süre bekler: araya giren ileti yeni tur açarsa "bitti" denmez. */
  function scheduleReport(record: SessionRecord, result: TurnResultEvent): void {
    cancelSettle(record);
    const settleMs = deps.settleMs ?? 1200;
    if (result.interrupted || settleMs <= 0) {
      report(record, result);
      return;
    }
    record.settleTimer = setTimeout(() => {
      record.settleTimer = undefined;
      if (!record.turnActive && !record.queue.length) report(record, result);
    }, settleMs);
    record.settleTimer.unref?.();
  }

  /** Bitiş (ya da zorla durdurma) bildirimi; sohbetten verilen iş için sohbet kimliği YALNIZ bir kez. */
  function report(record: SessionRecord, result: TurnResultEvent): void {
    if (shuttingDown) return;
    const chatSessionId = record.chatJob ? record.chatSessionId : undefined;
    record.chatJob = false;
    hook(() =>
      deps.onTurnEnd?.(summaryOf(record), {
        result,
        lastText: record.lastText,
        changedFiles: [...record.changed],
        source: record.source,
        ...(chatSessionId !== undefined ? { chatSessionId } : {}),
      }),
    );
  }

  function processEnded(record: SessionRecord, channel: SessionChannel, exit: SessionExit): void {
    if (record.channel !== channel) return;
    if (record.interruptTimer) {
      clearTimeout(record.interruptTimer);
      record.interruptTimer = undefined;
    }
    const wasActive = record.turnActive;
    if (channel.pid !== undefined) {
      exitedPids.set(channel.pid, Date.now());
      if (exitedPids.size > 200) exitedPids.delete(exitedPids.keys().next().value as number);
    }
    record.channel = undefined;
    record.turnActive = false;
    record.interruptRequested = false;
    record.pendingEdits.clear();
    // Süreç öldü: arka plan işleri de onunla gitti.
    for (const event of resetBackground(record.ctx)) handleEvent(record, event);
    if (record.sessionId) {
      closedAt.set(record.sessionId, Date.now());
      if (closedAt.size > 500) closedAt.delete(closedAt.keys().next().value as string);
    }
    cancelPermissions(record, t('claude.op.processClosed'));
    if (record.closing) {
      record.closing = false;
      if (wasActive) {
        // Zorla durdurma (Kapat, durdurma bekçisi): tur kesildi sayılır.
        const result = interruptedResult();
        record.outcome = 'stopped';
        publish(record, result);
        system(record, 'info', t('claude.op.stopped'));
        report(record, result);
      }
    } else if (exit.spawnError !== null || wasActive || (exit.code !== null && exit.code !== 0)) {
      const described = exit.spawnError !== null ? describeCliError(exit.spawnError) : describeCliCrash({ code: exit.code, signal: exit.signal }, exit.stderr);
      if (described.class === 'limit') record.outcome = 'limit';
      toError(record, described.text);
    }
    // Bekçinin kapattığı turdan sonra bırakılan iletiler sıraya döner (yeni süreç `--resume` ile açılır).
    if (!record.error && !record.closed && record.queue.length) joinLine(record);
    publishStatus(record);
    record.resolveExit?.();
    pump();
  }

  function toError(record: SessionRecord, text: string): void {
    record.error = text;
    if (record.outcome !== 'limit') record.outcome = 'error';
    leaveLine(record);
    system(record, 'error', text);
    publishStatus(record);
    const chatSessionId = record.chatJob ? record.chatSessionId : undefined;
    record.chatJob = false;
    if (!shuttingDown) hook(() => deps.onError?.(summaryOf(record), text, chatSessionId));
  }

  /** Süreci nazikçe kapatır (girdi kapanır), süre dolarsa ağacıyla öldürür. Oturum kaydı kalır. */
  async function closeProcess(record: SessionRecord, graceMs = deps.closeGraceMs ?? 2500): Promise<void> {
    const channel = record.channel;
    if (!channel) return;
    record.closing = true;
    await channel.close(graceMs);
    await Promise.race([record.exited, sleep(1500)]);
    if (record.channel === channel) {
      // Çıkış olayı gelmedi (ağaç öldürülemedi): kayıt yine de dürüst hâle getirilir.
      processEnded(record, channel, { code: null, signal: null, spawnError: null, stderr: '' });
    }
  }

  // ── izinler ──

  function askPermission(record: SessionRecord, channel: SessionChannel, request: CanUseToolRequest): void {
    const event = permissionEvent(request);
    record.permissions.set(request.requestId, { event, input: request.input, suggestions: request.suggestions, ...(request.toolUseId ? { toolUseId: request.toolUseId } : {}), channel });
    publish(record, event);
    publishStatus(record);
    hook(() => deps.onPermission?.(summaryOf(record), event));
  }

  function cancelPermissions(record: SessionRecord, reason: string, interrupt = false): void {
    for (const [requestId, pending] of record.permissions) {
      record.permissions.delete(requestId);
      if (pending.channel.alive()) pending.channel.respondPermission(requestId, { behavior: 'deny', message: reason, ...(interrupt ? { interrupt: true } : {}) }, pending.toolUseId);
      publish(record, { type: 'permission_resolved', requestId, decision: 'cancelled' });
      hook(() => deps.onPermissionResolved?.(summaryOf(record), requestId));
    }
  }

  function answerPermission(id: string, requestId: string, answer: LivePermissionAnswer): LiveOpResult {
    const record = byAnyId(id);
    const pending = record?.permissions.get(requestId);
    if (!record || !pending) return fail('not_found', t('claude.op.permissionGone'));
    const decision = answer?.decision;
    if (decision !== 'allow' && decision !== 'always' && decision !== 'deny') return fail('invalid', t('claude.op.invalid'));
    let result: PermissionResult;
    let given: 'allow' | 'always' | 'deny' = decision;
    if (decision === 'deny') {
      result = { behavior: 'deny', message: typeof answer.reason === 'string' && answer.reason.trim() ? truncate(answer.reason.trim(), 2000) : t('claude.op.denied') };
    } else if (pending.event.kind === 'question') {
      // Yanıtlar sorulan sorulara uymalı; uymazsa istek BEKLEMEYE devam eder.
      const checked = checkAnswers(pending.event.questions ?? [], answer.answers, answer.freeText);
      if (!checked.ok) return fail('bad_answer', t(`claude.op.answer.${checked.problem}`, { subject: checked.subject }));
      result = { behavior: 'allow', updatedInput: { questions: pending.input.questions, answers: checked.answers } };
      given = 'allow';
    } else if (decision === 'always' && pending.event.canAlways) {
      const fullAllowed = deps.config().fullAccess && record.allowBypass && !record.restricted;
      // Yalnız bu oturum: öneriler kalıcı ayar dosyalarına değil oturuma yazılır; Tam yetkiye geçiş önerisi yalnız izin varken.
      const updates = pending.suggestions
        .filter(isRecord)
        .filter((update) => !(update.type === 'setMode' && update.mode === 'bypassPermissions' && !fullAllowed))
        .map((update) => ({ ...update, destination: 'session' }));
      result = { behavior: 'allow', updatedInput: pending.input, updatedPermissions: updates };
    } else {
      result = { behavior: 'allow', updatedInput: pending.input };
      given = 'allow';
    }
    record.permissions.delete(requestId);
    pending.channel.respondPermission(requestId, result, pending.toolUseId);
    publish(record, { type: 'permission_resolved', requestId, decision: given });
    publishStatus(record);
    hook(() => deps.onPermissionResolved?.(summaryOf(record), requestId));
    return OK;
  }

  // ── başlat, gönder ──

  /** Kısıtlı oturumun klasörü: korunan/geniş klasör reddedilir, gerçek yol sabitlenir. */
  function restrictedFolder(cwd: string, pinned?: string): { path: string } | LiveOpResult {
    const checked = deps.protectedFolder(cwd);
    if (checked.reason) return fail('protected_folder', t('claude.op.protectedFolder', { reason: checked.reason }));
    if (pinned && path.resolve(pinned).toLowerCase() !== path.resolve(checked.path).toLowerCase()) return fail('protected_folder', t('claude.op.folderMoved'));
    return { path: checked.path };
  }

  /** Asistanın işi, sayfada açık bir oturuma gidecekse önce kip tavanı: Tam yetkideyse indirilir (indirilemezse iş GİTMEZ). */
  async function restrict(record: SessionRecord): Promise<LiveOpResult> {
    const folder = restrictedFolder(record.cwd, record.root);
    if (!('path' in folder)) return folder;
    if (record.mode === 'bypassPermissions') {
      if (record.channel?.alive()) {
        try {
          await record.channel.setPermissionMode('acceptEdits');
        } catch {
          return fail('unsupported', t('claude.op.cannotLowerMode'));
        }
      }
      record.mode = 'acceptEdits';
      publish(record, { type: 'mode', mode: 'acceptEdits' });
      system(record, 'info', t('claude.op.modeLowered'));
    }
    record.root = folder.path;
    record.restricted = true;
    publishStatus(record);
    return OK;
  }

  async function start(input: StartInput): Promise<LiveStartResult> {
    if (shuttingDown) return fail('shutting_down', t('claude.op.shuttingDown'));
    let cwd = typeof input.cwd === 'string' ? input.cwd.trim() : '';
    if (!cwd || !path.isAbsolute(cwd)) return fail('no_folder', t('claude.op.noFolder'));
    try {
      if (!fs.statSync(cwd).isDirectory()) throw new Error('not a directory');
    } catch {
      return fail('no_folder', t('claude.op.folderMissing', { path: cwd }));
    }
    const model = typeof input.model === 'string' ? input.model.trim() : '';
    if ((input.model !== undefined && input.model !== null && typeof input.model !== 'string') || (model && !CLI_MODEL_RE.test(model))) return fail('invalid', t('claude.op.badModel'));
    const effort = input.effort === undefined || input.effort === null ? undefined : input.effort;
    if (effort !== undefined && !isEffortLevel(effort)) return fail('invalid', t('claude.op.badEffort'));
    const resume = typeof input.resume === 'string' && input.resume.trim() ? input.resume.trim() : undefined;
    if ((input.resume !== undefined && input.resume !== null && typeof input.resume !== 'string') || (resume && !CLI_SESSION_ID_RE.test(resume))) return fail('invalid', t('claude.op.badSession'));
    if (!deps.command()) return fail('no_cli', describeCliError('claude-yok ENOENT').text);
    const fork = Boolean(resume && input.fork);
    const source: LiveSource = input.source ?? 'page';
    const config = deps.config();
    const fullApproved = input.fullAccessApproved === true && config.fullAccess;
    const restricted = source === 'assistant' && !fullApproved;
    if (input.mode === 'bypassPermissions' && !config.fullAccess) return fail('full_access_off', t('claude.op.fullAccessOff'));

    const known = deps.knownFolder(cwd);
    if (!known) return fail('unknown_folder', t('claude.op.unknownFolder'));
    // Geniş ve korunan klasörlerde (ev klasörü, sürücü kökü, AppData, sistem, Fuber'in verisi, ~/.claude) oturum açılmaz.
    const folder = restrictedFolder(cwd);
    if (!('path' in folder)) return folder;
    if (restricted) cwd = folder.path;

    const prompt = typeof input.prompt === 'string' ? input.prompt : '';
    const hasMessage = Boolean(prompt.trim() || input.images?.length);
    const markChatJob = (record: SessionRecord) => {
      if (source === 'assistant' && input.chatSessionId !== undefined && hasMessage) {
        record.chatSessionId = input.chatSessionId;
        record.chatJob = true;
      }
    };

    let record: SessionRecord | undefined;
    let same: SessionRecord | undefined;
    if (resume && !fork) {
      same = [...records.values()].filter((item) => item.sessionId === resume).sort((a, b) => Number(live(b)) - Number(live(a)) || b.lastActivityAt - a.lastActivityAt)[0];
      if (same && live(same) && !same.closed) {
        // Açık oturum: yenisi açılmaz; ileti ona gider.
        if (hasMessage) {
          const checked = checkMessage(same, prompt, input.images);
          if (!('message' in checked)) return checked;
          if (restricted) {
            const lowered = await restrict(same);
            if (!lowered.ok) return { ...lowered, session: summaryOf(same) };
          }
          markChatJob(same);
          same.closed = false;
          same.error = undefined;
          enqueue(same, checked.message);
        }
        return { ok: true, session: summaryOf(same) };
      }
    }
    let samePinned: string | undefined;
    if (same && restricted) {
      const checked = restrictedFolder(same.cwd, same.restricted ? same.root : undefined);
      if (!('path' in checked)) return { ...checked, session: summaryOf(same) };
      samePinned = checked.path;
    }
    const trust = deps.trust(same?.cwd ?? cwd);
    // Kendi Claude Code ayarları olan klasörde sayfadan İLK süreç, kullanıcı karar vermeden açılmaz.
    if (trust.required && !trust.decision && source === 'page') return { ...fail('trust_required', t('claude.op.trustRequired')), trust };
    if (resume && !fork && !input.force && deps.openElsewhere) {
      const elsewhere = await deps.openElsewhere(resume, traces()).catch(() => false);
      if (elsewhere) return fail('open_elsewhere', t('claude.op.openElsewhere'));
    }
    if (same) {
      // Uygulamada kapanmış/boşta oturum: aynı kayıt yeniden açılır (çift kayıt yok).
      record = same;
      record.closed = false;
      record.error = undefined;
      if (restricted) {
        record.restricted = true;
        record.root = samePinned;
        record.mode = cappedMode(record.mode);
      }
    }
    const fresh = !record;
    if (!record) {
      const now = Date.now();
      const mode = restricted ? cappedMode(startMode(config, input.mode)) : startMode(config, input.mode);
      const fallbackTitle = t(fork ? 'claude.op.titleFork' : resume ? 'claude.op.titleResume' : 'claude.op.titleNew');
      record = {
        id: randomUUID(),
        ...(resume && !fork ? { sessionId: resume } : {}),
        cwd,
        projectId: known.projectId,
        projectName: known.projectName,
        title: truncate(input.title?.trim() || prompt.trim().replace(/\s+/g, ' ') || fallbackTitle, 120),
        source,
        chatJob: false,
        restricted,
        ...(restricted ? { root: cwd } : {}),
        untrusted: false,
        mode,
        ...(model || config.defaultModel ? { model: model || config.defaultModel } : {}),
        ...(effort ? { effort } : {}),
        effortPending: false,
        first: { ...(resume ? { resume } : {}), fork },
        allowBypass: false,
        turnActive: false,
        waiting: false,
        closed: false,
        closing: false,
        interruptRequested: false,
        queue: [],
        permissions: new Map(),
        events: [],
        seq: 0,
        ctx: createNormalizeContext(),
        deltaPending: new Map(),
        deltaEntries: new Map(),
        showCost: false,
        durationMs: 0,
        turns: 0,
        changed: new Set(),
        pendingEdits: new Map(),
        todos: [],
        tasks: [],
        background: 0,
        commands: [],
        lastText: '',
        createdAt: now,
        lastActivityAt: now,
      };
      records.set(record.id, record);
    }
    if (hasMessage) {
      const checked = checkMessage(record, prompt, input.images);
      if (!('message' in checked)) {
        if (fresh) records.delete(record.id);
        return checked;
      }
      markChatJob(record);
      enqueue(record, checked.message);
    } else publishStatus(record);
    return { ok: true, session: summaryOf(record) };
  }

  /** Kapanmış/boştaki oturuma yazmak onu `--resume` ile yeniden açar; o an başka yerde açıksa sürdürülmez. */
  async function send(id: string, message: { text: string; images?: LiveImage[]; source?: LiveSource; chatSessionId?: Id }): Promise<LiveOpResult> {
    const record = byAnyId(id);
    if (!record) return fail('not_found', t('claude.op.notFound'));
    const checked = checkMessage(record, message?.text, message?.images);
    if (!('message' in checked)) return checked;
    if (!live(record) && !record.turnActive && !record.waiting && record.sessionId && deps.openElsewhere) {
      const elsewhere = await deps.openElsewhere(record.sessionId, traces()).catch(() => false);
      if (elsewhere) return fail('open_elsewhere', t('claude.op.openElsewhere'));
    }
    if (shuttingDown) return fail('shutting_down', t('claude.op.shuttingDown'));
    if (message.source === 'assistant' && !record.restricted) {
      const lowered = await restrict(record);
      if (!lowered.ok) return lowered;
    }
    if (message.source === 'assistant' && message.chatSessionId !== undefined) {
      record.chatSessionId = message.chatSessionId;
      record.chatJob = true;
    }
    if (record.effortPending && live(record) && idle(record) && record.background === 0) {
      record.effortPending = false;
      await closeProcess(record);
    }
    record.closed = false;
    record.error = undefined;
    enqueue(record, checked.message);
    return OK;
  }

  function removeQueued(id: string, messageId: string): LiveOpResult {
    const record = byAnyId(id);
    if (!record) return fail('not_found', t('claude.op.notFound'));
    const before = record.queue.length;
    record.queue = record.queue.filter((message) => message.id !== messageId);
    if (record.queue.length === before) return fail('not_found', t('claude.op.queuedGone'));
    if (!record.queue.length) leaveLine(record);
    publishStatus(record);
    pump();
    return OK;
  }

  // ── durdur, kip, model, efor ──

  /** Süren turu keser. `keepQueue` verilmezse bekleyen iletiler de atılır. */
  async function interrupt(id: string, options: { keepQueue?: boolean } = {}): Promise<LiveOpResult> {
    const record = byAnyId(id);
    if (!record) return fail('not_found', t('claude.op.notFound'));
    if (!options.keepQueue) record.queue = [];
    if (record.waiting && !record.queue.length) leaveLine(record);
    const channel = record.channel;
    if (!record.turnActive || !channel?.alive()) {
      // Sırada bekleyen (henüz başlamamış) iş durduruldu: bir kez "durduruldu".
      if (record.chatJob && !record.queue.length) report(record, interruptedResult());
      if (!record.turnActive && !record.queue.length && !record.outcome && record.events.length) record.outcome = 'stopped';
      publishStatus(record);
      pump();
      return OK;
    }
    record.interruptRequested = true;
    cancelPermissions(record, t('claude.op.userStopped'), true);
    publishStatus(record);
    try {
      // "Durdur" her şeyi durdurur: tur sürerken yazılmış ama henüz işlenmemiş iletiler de (`keepQueue` verilmediyse).
      await Promise.race([channel.interrupt({ cancelQueued: !options.keepQueue }), sleep(5000)]);
    } catch (error) {
      if (channel.alive()) system(record, 'warn', t('claude.op.interruptFailed', { error: truncate(errorText(error), 200) }));
    }
    // Bekçi: Claude Code turu kapatmazsa süreç kapatılır (tur "durduruldu"; sonraki iletide `--resume` ile sürer).
    if (record.turnActive && record.channel === channel && !record.interruptTimer) {
      record.interruptTimer = setTimeout(() => {
        record.interruptTimer = undefined;
        if (record.turnActive && record.channel === channel) void closeProcess(record);
      }, deps.interruptGraceMs ?? 8000);
      record.interruptTimer.unref?.();
    }
    return OK;
  }

  async function setMode(id: string, mode: unknown): Promise<LiveOpResult> {
    const record = byAnyId(id);
    if (!record) return fail('not_found', t('claude.op.notFound'));
    if (!isPermissionMode(mode)) return fail('invalid', t('claude.op.invalid'));
    if (!modeSelectable(mode, deps.config().fullAccess)) return fail('full_access_off', t('claude.op.fullAccessOff'));
    if (record.channel?.alive()) {
      if (mode === 'bypassPermissions' && !record.allowBypass) {
        // Süreç Tam yetki izni olmadan açılmış: boştaysa kapatılır, sonraki ileti Tam yetki izniyle sürdürür.
        if (!idle(record)) return fail('busy', t('claude.op.busyForFullAccess'));
        record.restricted = false;
        if (record.mode !== mode) {
          record.mode = mode;
          publish(record, { type: 'mode', mode });
        }
        await closeProcess(record);
      } else {
        try {
          await record.channel.setPermissionMode(mode);
        } catch (error) {
          return fail('unsupported', t('claude.op.modeFailed', { error: truncate(errorText(error), 200) }));
        }
      }
    }
    // Sayfada açıkça Tam yetki seçildi: kısıt kalkar.
    if (mode === 'bypassPermissions') record.restricted = false;
    if (record.mode !== mode) {
      record.mode = mode;
      publish(record, { type: 'mode', mode });
    }
    publishStatus(record);
    return OK;
  }

  async function setModel(id: string, model: unknown): Promise<LiveOpResult> {
    const record = byAnyId(id);
    if (!record) return fail('not_found', t('claude.op.notFound'));
    if (model !== null && model !== undefined && (typeof model !== 'string' || !CLI_MODEL_RE.test(model))) return fail('invalid', t('claude.op.badModel'));
    const next = typeof model === 'string' && model ? model : undefined;
    if (record.channel?.alive()) {
      try {
        await record.channel.setModel(next ?? null);
      } catch (error) {
        return fail('unsupported', t('claude.op.modelFailed', { error: truncate(errorText(error), 200) }));
      }
    }
    record.model = next;
    publish(record, { type: 'model', model: next ?? 'default' });
    publishStatus(record);
    return OK;
  }

  /** Efor canlı oturumda da değişir; Claude Code isteği tanımıyorsa değer kayda yazılır ve sonraki süreçte geçerli olur (`next_turn`). */
  async function setEffort(id: string, effort: unknown): Promise<LiveOpResult> {
    const record = byAnyId(id);
    if (!record) return fail('not_found', t('claude.op.notFound'));
    const next = effort === null || effort === undefined || effort === '' ? undefined : effort;
    if (next !== undefined && !isEffortLevel(next)) return fail('invalid', t('claude.op.badEffort'));
    record.effort = next;
    let deferred = false;
    if (record.channel?.alive()) {
      try {
        await record.channel.setEffort(next ?? null);
        record.effortPending = false;
      } catch {
        deferred = true;
        if (!idle(record) || record.background > 0) record.effortPending = true;
        else await closeProcess(record);
      }
    }
    publishStatus(record);
    return deferred ? { ok: true, code: 'next_turn' } : OK;
  }

  // ── arka plan işleri ──

  function findTask(id: string, taskId: unknown): { record: SessionRecord; task: BackgroundTask } | LiveOpResult {
    const record = byAnyId(id);
    if (!record) return fail('not_found', t('claude.op.notFound'));
    const task = typeof taskId === 'string' ? record.tasks.find((item) => item.id === taskId) : undefined;
    return task ? { record, task } : fail('not_found', t('claude.op.taskGone'));
  }

  async function stopTask(id: string, taskId: unknown): Promise<LiveOpResult> {
    const found = findTask(id, taskId);
    if (!('record' in found)) return found;
    if (found.task.status !== 'running') return OK;
    if (!found.record.channel?.alive()) return fail('not_found', t('claude.op.taskProcessClosed'));
    try {
      await found.record.channel.stopTask(found.task.id);
    } catch (error) {
      return fail('unsupported', t('claude.op.taskStopFailed', { error: truncate(errorText(error), 200) }));
    }
    return OK;
  }

  async function backgroundTask(id: string, taskId: unknown): Promise<LiveOpResult> {
    const found = findTask(id, taskId);
    if (!('record' in found)) return found;
    if (found.task.backgrounded || found.task.status !== 'running') return OK;
    if (!found.record.channel?.alive()) return fail('not_found', t('claude.op.taskProcessClosed'));
    // Araç kimliği olmadan istek BÜTÜN ön plan işlerini arkaya alır: yalnız bu iş hedeflenir.
    if (!found.task.toolUseId) return fail('unsupported', t('claude.op.taskCannotBackground'));
    try {
      if (!(await found.record.channel.backgroundTask(found.task.toolUseId))) return fail('not_found', t('claude.op.taskNotForeground'));
    } catch (error) {
      return fail('unsupported', t('claude.op.taskBackgroundFailed', { error: truncate(errorText(error), 200) }));
    }
    return OK;
  }

  /** İşin canlı çıktısının son satırları (Claude Code'un çıktı dosyasından; yalnız okunur, en çok son 64 KB). */
  function taskOutput(id: string, taskId: unknown, lines = 40): { lines: string[]; bytes: number; error?: string } {
    const found = findTask(id, taskId);
    if (!('record' in found)) return { lines: [], bytes: 0, error: found.error ?? '' };
    const file = found.task.outputFile;
    if (!file) return { lines: [], bytes: 0, error: t(found.task.kind === 'agent' ? 'claude.op.outputAgent' : 'claude.op.outputNone') };
    if (!path.isAbsolute(file) || /^[\\/]{2}/.test(file) || !/\.(output|log|txt)$/i.test(file)) return { lines: [], bytes: 0, error: t('claude.op.outputUnreadable') };
    try {
      const stat = fs.statSync(file);
      if (!stat.isFile()) return { lines: [], bytes: 0, error: t('claude.op.outputUnreadable') };
      const size = Math.min(stat.size, 64 * 1024);
      const fd = fs.openSync(file, 'r');
      try {
        const buffer = Buffer.alloc(size);
        fs.readSync(fd, buffer, 0, size, stat.size - size);
        // eslint-disable-next-line no-control-regex
        const text = buffer.toString('utf8').replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '');
        const all = text
          .split(/\r?\n/)
          .map((line) => line.replace(/\r/g, ''))
          .filter((line, index, list) => line || index < list.length - 1);
        return { lines: all.slice(-Math.max(1, Math.min(200, lines))).map((line) => truncate(line, 400)), bytes: stat.size };
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      return { lines: [], bytes: 0, error: t('claude.op.outputUnreadable') };
    }
  }

  // ── kapat, unut ──

  async function shutRecord(record: SessionRecord): Promise<void> {
    record.closed = true;
    record.queue = [];
    leaveLine(record);
    cancelSettle(record);
    cancelPermissions(record, t('claude.op.sessionClosed'), true);
    await closeProcess(record);
    // Sırada bekleyen sohbet işi (süren tur zaten çıkışta bildirildi).
    if (record.chatJob) report(record, interruptedResult());
  }

  /** Oturumu kapatır (süreç biter; kayıt "kapandı" olarak kalır, yeni ileti `--resume` ile yeniden açar). */
  async function close(id: string): Promise<LiveOpResult> {
    const record = byAnyId(id);
    if (!record) return fail('not_found', t('claude.op.notFound'));
    await shutRecord(record);
    if (record.events.length > CLOSED_EVENT_LIMIT) record.events.splice(0, record.events.length - CLOSED_EVENT_LIMIT);
    publishStatus(record);
    pruneClosed();
    return OK;
  }

  function remove(record: SessionRecord): void {
    if (record.deltaTimer) clearTimeout(record.deltaTimer);
    cancelSettle(record);
    records.delete(record.id);
    hook(() => deps.emit({ session: record.id, seq: ++record.seq, at: Date.now(), event: { type: 'forgotten' } }));
  }

  /** Süreç kapanır ve kayıt silinir (Claude Code'un kendi dökümüne dokunulmaz). */
  async function forget(id: string): Promise<LiveOpResult> {
    const record = byAnyId(id);
    if (!record) return fail('not_found', t('claude.op.notFound'));
    await shutRecord(record);
    remove(record);
    return OK;
  }

  function pruneClosed(): void {
    const limit = Math.max(0, deps.maxClosed ?? 20);
    const closed = [...records.values()].filter((record) => record.closed && !live(record)).sort((a, b) => b.lastActivityAt - a.lastActivityAt);
    for (const record of closed.slice(limit)) remove(record);
  }

  /** "Tam yetki" ayarı kapandı: Tam yetkideki oturumlar "Düzenlemelere izin ver"e iner; kipi değiştirilemeyen süreç KAPATILIR. */
  async function fullAccessRevoked(): Promise<void> {
    for (const record of records.values()) {
      if (record.mode !== 'bypassPermissions') continue;
      record.mode = 'acceptEdits';
      if (record.channel?.alive()) {
        try {
          await record.channel.setPermissionMode('acceptEdits');
        } catch {
          await closeProcess(record);
        }
      }
      publish(record, { type: 'mode', mode: 'acceptEdits' });
      publishStatus(record);
    }
  }

  /** Klasörün güven kararı değişti: o klasörün BOŞTAKİ süreçleri kapatılır (sonraki ileti yeni kararla sürdürür). */
  async function trustChanged(cwd: string): Promise<number> {
    const key = path.resolve(cwd).toLowerCase();
    const targets = [...records.values()].filter((record) => path.resolve(record.cwd).toLowerCase() === key);
    for (const record of targets) record.trustNote = undefined;
    const idleOnes = targets.filter((record) => live(record) && idle(record));
    await Promise.all(idleOnes.map((record) => closeProcess(record)));
    return idleOnes.length;
  }

  // ── model listesi ──

  function cleanModels(raw: unknown): LiveModel[] {
    if (!Array.isArray(raw)) return [];
    const out: LiveModel[] = [];
    for (const item of raw) {
      if (!isRecord(item) || typeof item.value !== 'string' || !CLI_MODEL_RE.test(item.value) || out.some((model) => model.value === item.value)) continue;
      out.push({
        value: item.value,
        label: truncate(typeof item.label === 'string' && item.label.trim() ? item.label.trim() : item.value, 80),
        description: truncate(typeof item.description === 'string' ? item.description : '', 300),
      });
      if (out.length >= 40) break;
    }
    return out;
  }

  /** Oturumdan gelen model listesi kalıcı kayda yazılır (boş liste saklıyı EZMEZ). */
  function storeModels(list: LiveModel[]): void {
    const clean = cleanModels(list);
    if (!clean.length || JSON.stringify(clean) === JSON.stringify(modelList)) return;
    modelList = clean;
    hook(() => deps.models?.write(clean.map((model) => ({ ...model }))));
  }

  /** Model seçicisinin listesi: bu çalıştırmada oturumdan gelen, yoksa saklı, o da yoksa varsayılan takma adlar. */
  function models(): LiveModel[] {
    if (!modelList?.length) {
      let stored: LiveModel[] = [];
      try {
        stored = cleanModels(deps.models?.read());
      } catch {
        stored = [];
      }
      if (stored.length) modelList = stored;
    }
    return (modelList?.length ? modelList : DEFAULT_MODELS).map((model) => ({ ...model }));
  }

  // ── kapanış ──

  /** Acil durdurma: süren bütün turlar kesilir (süreçler açık kalır). */
  async function interruptAll(): Promise<number> {
    const running = [...records.values()].filter((record) => record.turnActive || record.waiting || record.queue.length);
    await Promise.all(running.map((record) => interrupt(record.id)));
    return running.length;
  }

  /** Uygulama kapanıyor: durdurma isteği → en çok `shutdownMs` bekle → kapat → kalan süreçleri ağacıyla öldür. */
  async function shutdown(): Promise<void> {
    shuttingDown = true;
    for (const id of waitingLine) {
      const record = records.get(id);
      if (record) record.waiting = false;
    }
    waitingLine = [];
    const alive = [...records.values()].filter(live);
    const budget = deps.shutdownMs ?? 5000;
    const deadline = Date.now() + budget;
    for (const record of alive) {
      record.queue = [];
      cancelSettle(record);
      cancelPermissions(record, t('claude.op.shuttingDown'), true);
    }
    await Promise.all(
      alive
        .filter((record) => record.turnActive)
        .map(async (record) => {
          record.interruptRequested = true;
          try {
            await Promise.race([record.channel?.interrupt({ cancelQueued: true }), sleep(budget)]);
          } catch {
            // süreç çoktan bitti
          }
        }),
    );
    while (Date.now() < deadline && alive.some((record) => record.turnActive && live(record))) await sleep(50);
    await Promise.all(alive.map((record) => closeProcess(record, 1500)));
    for (const record of records.values()) {
      if (record.deltaTimer) clearTimeout(record.deltaTimer);
      if (record.interruptTimer) clearTimeout(record.interruptTimer);
    }
  }

  return {
    start,
    send,
    removeQueued,
    interrupt,
    interruptAll,
    answerPermission,
    setMode,
    setModel,
    setEffort,
    stopTask,
    backgroundTask,
    taskOutput,
    close,
    forget,
    fullAccessRevoked,
    trustChanged,
    models,
    shutdown,
    sessions: (): LiveSessionSummary[] => [...records.values()].sort((a, b) => b.lastActivityAt - a.lastActivityAt).map(summaryOf),
    summary: (id: string): LiveSessionSummary | null => {
      const record = byAnyId(id);
      return record ? summaryOf(record) : null;
    },
    detail(id: string): LiveSessionDetail | null {
      const record = byAnyId(id);
      if (!record) return null;
      flushDeltas(record);
      return {
        ...summaryOf(record),
        events: record.events.map((envelope) => ({ ...envelope })),
        permissions: [...record.permissions.values()].map((pending) => pending.event),
        queue: record.queue.map((message) => ({ id: message.id, text: message.text, images: message.images?.length ?? 0 })),
        changedFilesList: [...record.changed],
        todos: record.todos.slice(),
        tasks: record.tasks.map((task) => ({ ...task })),
        commands: record.commands.slice(0, 400),
      };
    },
    /** Oturumun klasörü (git özeti, dosya önerisi için); yoksa `null`. */
    cwdOf: (id: string): string | null => byAnyId(id)?.cwd ?? null,
    /** Bu oturum kimliği uygulamada yönetiliyor mu (dizinin "oturum bitti" bildirimi yinelenmesin). */
    manages: (sessionId: string): boolean => [...records.values()].some((record) => record.sessionId === sessionId) || closedAt.has(sessionId),
    runningCount: activeCount,
    /** Yaşayan oturum süreçlerinin PID'leri (kapanış ve sınamalar). */
    pids: (): number[] => [...records.values()].map((record) => record.channel?.pid).filter((pid): pid is number => pid !== undefined && Boolean(pid)),
    traces,
  };
}

export type SessionManager = ReturnType<typeof createSessionManager>;
