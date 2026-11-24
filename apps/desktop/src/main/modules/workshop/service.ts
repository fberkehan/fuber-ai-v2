/**
 * Atölye'nin orkestra şefi: yetenek klasörlerini tarar, doğrular, öz-sınamadan geçirir, onayı ve durumu tutar,
 * etkin yetenekleri konağa yükleyip araçlarını çekirdeğin kaydına sokar ve çıkarır.
 *
 * Değişmezler:
 *  - Onaylanmamış içerik canlı konağa yüklenmez ve aracı kayda girmez (karar `lifecycle.ts` içinde).
 *  - Onay, içeriğin özetine bağlıdır: dosya değişirse yetenek kapanır ve yeniden sınanıp onaya düşer.
 *  - Sınanmamış ya da taslak kod yalnız GEÇİCİ konakta koşar; etkin yeteneklerin konağına hiç girmez.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  nowIso,
  t,
  UserError,
  type ExternalToolDef,
  type Id,
  type Job,
  type JsonValue,
  type ModuleContext,
  type SkillDetail,
  type SkillInfo,
  type ToolOrigin,
  type Unsubscribe,
} from '@fuber/shared';
import { z } from 'zod';
import type { DeepBrain } from '../../core/brain/deep/types';
import { declareModule } from '../../core/tools';
import type { BridgeCall, SelftestOutcome } from '../../../skill-host/protocol';
import { auditPage, describeIssues, MAX_SOURCE_BYTES, prepareSource } from './audit';
import { createBridge, type UserFolders } from './bridge';
import { createBuilder, type BuildDriver, type Builder } from './build';
import {
  createSkillHost,
  HostAbortedError,
  HostRestartedError,
  HostTimeoutError,
  type HostProcess,
  type HostTimeouts,
  type SkillHost,
} from './host';
import { INITIAL_STATE, transition, type SkillEvent, type TransitionError } from './lifecycle';
import { MANIFEST_LIMITS, parseManifest, visibleTools } from './manifest';
import type { Lookup, Transport } from './net';
import { pageDocument } from './page';
import { DRAFTS_DIR, isPlainChildDir, PathError, resolveInside, SKILL_FILES, skillFilePath, STAGED_DIR, VERSIONS_DIR } from './paths';
import { buildPreview, spokenPreview, widensPermissions } from './preview';
import { PROBE_TEXT } from './prompt';
import { createPluginRuntime, type PluginRuntime } from './runtime';
import { createWorkshopStore, type SkillRecord, type WorkshopStore } from './store';
import type {
  BuildProgress,
  CloudStatus,
  PluginActivity,
  PluginPageInfo,
  PluginPreview,
  PluginSettingValue,
  SkillSource,
  SkillVersionInfo,
  WorkshopManifest,
  WorkshopStatus,
} from './types';

export interface WorkshopOptions {
  /** Yeni bir konak süreci başlatır (uygulamada `utilityProcess`). */
  spawnHost(): HostProcess;
  /**
   * Derin beyin. Verilirse yapımın sağlayıcısını o seçer (API çalışmıyorsa Claude Code köprüsü); verilmezse yalnız
   * Anthropic API yolu vardır.
   */
  deep?: DeepBrain;
  lookup?: Lookup;
  /** Sınamada gerçek ağ yerine sahte taşıyıcı. */
  transport?: Transport;
  timeouts?: Partial<HostTimeouts>;
  /** `fs.roots` belirteçlerinin gerçek klasörleri (uygulamada Electron'ın bildirdiği kullanıcı klasörleri). */
  userFolders?: UserFolders;
  /** Eklenti katkılarının yoklama aralığı; `0` kapatır (sınama `plugins.tick()` çağırır). */
  pluginTickMs?: number;
}

/** Politikada yeteneklerin bağlı olduğu modül: Atölye kapalıysa yetenek araçları da çalışmaz. */
const POLICY_ID = 'workshop';
const MODULE_PREFIX = 'skill:';
/** Art arda bu kadar konak öldüren zaman aşımından sonra yetenek kapatılır. */
const MAX_STRIKES = 3;
const MAX_RESULT_CHARS = 8000;
const MAX_SOURCE_VIEW_BYTES = 200_000;
const MAX_LOG_LINES = 200;
const SCRATCH_IDLE_MS = 20_000;
const PROBE_TIMEOUT_MS = 15_000;
const PROBE_OK_TTL_MS = 5 * 60_000;
const PROBE_FAIL_TTL_MS = 45_000;
const APPROVAL_PROMPT_MS = 120_000;
const FOLDER_NAME = /^[A-Za-z0-9_-]{1,64}$/;
/** Saklanan eski sürüm sayısı; fazlası en eskiden silinir. */
const MAX_KEPT_VERSIONS = 5;
/** Bir eklenti sayfasının dakikada yapabileceği araç çağrısı. */
const PAGE_CALLS_PER_MINUTE = 120;

export type ReadSkill =
  | {
      ok: true;
      manifest: WorkshopManifest;
      script: string;
      selftestScript: string;
      hash: string;
      /** Sayfa dosyaları (ad → HTML); denetimden geçmiş ve özete dahil. */
      pages: Record<string, string>;
    }
  | { ok: false; issues: string[]; hash: string | null; manifest: WorkshopManifest | null };

export interface SelftestReport {
  ok: boolean;
  error: string | null;
  /** `ctx.log` satırları ve sonuç satırı. */
  log: string;
}

export interface Workshop {
  /** Klasörleri tarar, etkin yetenekleri yükler. Bitince `ready` çözülür. */
  start(): Promise<void>;
  stop(): Promise<void>;
  ready(): Promise<void>;
  list(): Promise<SkillInfo[]>;
  detail(id: string): Promise<SkillDetail>;
  source(id: string, relative: string): Promise<SkillSource>;
  approve(id: string, approve: boolean): Promise<SkillInfo>;
  setEnabled(id: string, enabled: boolean): Promise<SkillInfo>;
  remove(id: string): Promise<void>;
  build(goal: string, origin: ToolOrigin): Promise<Job>;
  cancelBuild(id: string): Promise<void>;
  status(probe: boolean): Promise<WorkshopStatus>;
  /**
   * Ada, kimliğe ya da araç adına göre yetenek bulur (sesli komutlar için; küçük model çoğu kez aracın adını söyler:
   * `skill_zar_at`, `zar_at`). Birden çok yetenek eşleşirse `prefer` durumundakiler öne alınır ("kapat" açık olanı,
   * "aç" kapalı olanı kasteder). Bulunamazsa ya da hâlâ belirsizse `UserError`.
   */
  find(name: string, prefer?: 'enabled' | 'disabled'): SkillRecord;
  records(): SkillRecord[];
  /** Kullanıcıdan (ada kartı ya da ses) onay ister; onaylanırsa etkinleştirir. */
  requestApproval(id: string, origin: ToolOrigin): Promise<'approved' | 'denied' | 'expired'>;

  // ── eklenti platformu ──
  /** Ne ekliyor, hangi izinleri istiyor. `staged`: onay bekleyen güncellemenin önizlemesi. */
  preview(id: string, staged?: boolean): Promise<PluginPreview>;
  versions(id: string): Promise<SkillVersionInfo[]>;
  /** "Şunu da ekle": güncelleme yapımını başlatır. Eski sürüm onaya dek çalışır. */
  update(id: string, change: string, origin: ToolOrigin): Promise<Job>;
  approveUpdate(id: string, approve: boolean): Promise<SkillInfo>;
  /** Önceki (ya da verilen) sürüme döner. */
  rollback(id: string, version?: number): Promise<SkillInfo>;
  /** Kullanıcıdan güncelleme için onay ister (ada kartı ya da ses). */
  requestUpdateApproval(id: string, origin: ToolOrigin): Promise<'approved' | 'denied' | 'expired'>;
  pages(): Promise<PluginPageInfo[]>;
  page(skillId: string, pageId: string): Promise<{ title: string; skillName: string; html: string }>;
  pageCall(skillId: string, pageId: string, tool: string, input: unknown): Promise<{ ok: boolean; text: string; data?: unknown }>;
  pageStorage(skillId: string, op: 'get' | 'set' | 'delete', key: string, value?: JsonValue): Promise<{ found: boolean; value: JsonValue }>;
  settings(skillId: string): Promise<PluginSettingValue[]>;
  setSetting(skillId: string, key: string, value: string | number | boolean): Promise<PluginSettingValue[]>;
  activity(skillId?: string): Promise<PluginActivity[]>;
  runNow(skillId: string, kind: 'job' | 'watch' | 'card', id: string): Promise<{ ok: boolean; text: string }>;
  /** Sınama ve tanı: katkı çalışma zamanı. */
  plugins: PluginRuntime;
}

const fold = (text: string) =>
  text
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/[^a-z0-9çğöşü]+/g, ' ')
    .trim();

export function createWorkshop(ctx: ModuleContext, options: WorkshopOptions): Workshop {
  const log = ctx.log;
  const store: WorkshopStore = createWorkshopStore(ctx.db);
  const skillsRoot = ctx.paths.skills;
  const draftsRoot = path.join(skillsRoot, DRAFTS_DIR);
  const stagedRoot = path.join(skillsRoot, STAGED_DIR);
  const versionsRoot = path.join(skillsRoot, VERSIONS_DIR);

  /** Etkin yetenekler: araçları kayıtta, kodu canlı konakta; sayfaları (denetlenmiş HTML) bellekte. */
  const active = new Map<string, { manifest: WorkshopManifest; disposers: Unsubscribe[]; pages: Record<string, string> }>();
  /** Açılış taraması sürüyor: bu sırada etkinleşen eklentilerin `app.started` işleri tetiklenir. */
  let booting = false;
  const pageCalls = new Map<string, number[]>();
  /** Öz-sınaması süren yeteneklerin manifestleri (geçici konaktan gelen `ctx` istekleri için). */
  const underTest = new Map<string, WorkshopManifest>();
  /** Son okunan geçerli manifestler (liste ve kartlar için). */
  const manifests = new Map<string, WorkshopManifest>();
  const logs = new Map<string, string[]>();
  const strikes = new Map<string, number>();
  const builds = new Map<string, BuildProgress>();
  /** Adadaki onay isteği: yetenek → onay kimliği. */
  const prompts = new Map<string, Id>();
  /** Sonuçlanan onay isteklerini kimin kapattığı (kullanıcı mı, sistem mi). */
  const resolvedBy = new Map<Id, string>();
  const subscriptions: Unsubscribe[] = [];
  let cloudProbe: { at: number; status: CloudStatus } | null = null;
  let scratchTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  // Durumu değiştiren işler tek sıradan geçer; öz-sınamalar ayrı bir sırada koşar (uzun sürebilir).
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T> | T): Promise<T> => {
    const next = queue.then(work, work);
    queue = next.catch(() => {});
    return next;
  };
  let testQueue: Promise<unknown> = Promise.resolve();
  const serialTest = <T>(work: () => Promise<T>): Promise<T> => {
    const next = testQueue.then(work, work);
    testQueue = next.catch(() => {});
    return next;
  };

  const emit = (op: 'created' | 'updated' | 'deleted', id: string) => ctx.bus.emit('skills.changed', { entity: 'skill', op, ids: [id] });
  const moduleId = (id: string) => `${MODULE_PREFIX}${id}`;
  const dirOf = (record: Pick<SkillRecord, 'id' | 'draft'>) => path.join(record.draft ? draftsRoot : skillsRoot, record.id);

  const appendLog = (skillId: string, line: string) => {
    const lines = logs.get(skillId) ?? [];
    lines.push(line);
    if (lines.length > MAX_LOG_LINES) lines.splice(0, lines.length - MAX_LOG_LINES);
    logs.set(skillId, lines);
  };

  const bridge = createBridge({
    ctx,
    store,
    manifestOf: (skillId: string, mode: BridgeCall['mode']) =>
      mode === 'selftest' ? (underTest.get(skillId) ?? null) : (active.get(skillId)?.manifest ?? null),
    ...(options.lookup ? { lookup: options.lookup } : {}),
    ...(options.userFolders ? { userFolders: options.userFolders } : {}),
    ...(options.transport ? { transport: options.transport } : {}),
  });

  const hostLog = (entry: { skillId: string; level: 'info' | 'warn' | 'error'; text: string }) => {
    if (!entry.skillId) {
      log.warn(`konak: ${entry.text}`);
      return;
    }
    appendLog(entry.skillId, entry.level === 'info' ? entry.text : `[${entry.level === 'warn' ? 'uyarı' : 'hata'}] ${entry.text}`);
    log.debug(`${entry.skillId}: ${entry.text}`);
  };

  const live: SkillHost = createSkillHost({
    spawn: options.spawnHost,
    log: log.child('konak'),
    bridge,
    onLog: hostLog,
    onSkillDropped: (skillId, reason) => void serial(() => failActive(skillId, t('skills.error.load', { detail: reason }))),
    ...(options.timeouts ? { timeouts: options.timeouts } : {}),
  });
  /** Onaylanmamış ve taslak kodun koştuğu ayrı süreç: sonsuz döngüsü etkin yetenekleri düşürmez. */
  const scratch: SkillHost = createSkillHost({
    spawn: options.spawnHost,
    log: log.child('sınama-konağı'),
    bridge,
    onLog: hostLog,
    ...(options.timeouts ? { timeouts: options.timeouts } : {}),
  });

  /** Katkı çalışma zamanı: kartlar, zamanlanmış ve olay tetikli işler, takipler, sesli kalıplar. */
  const plugins: PluginRuntime = createPluginRuntime({
    ctx,
    store,
    log: log.child('katkı'),
    call: (skillId, tool, input) => live.call(skillId, tool, input),
    ...(options.pluginTickMs !== undefined ? { tickMs: options.pluginTickMs } : {}),
  });

  // ───────────────────────────── diskten okuma ─────────────────────────────

  const readFile = (dir: string, name: string, maxBytes: number): string | { issue: string } => {
    let file: string;
    try {
      file = skillFilePath(dir, name);
    } catch (error) {
      return { issue: `${name}: ${(error as Error).message}` };
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(file);
    } catch {
      return { issue: `${name} yok.` };
    }
    if (!stat.isFile()) return { issue: `${name} bir dosya değil.` };
    if (stat.size > maxBytes) return { issue: `${name} çok büyük (en çok ${Math.round(maxBytes / 1000)} KB).` };
    return fs.readFileSync(file, 'utf8');
  };

  /** Klasörü okur, manifesti doğrular, iki kaynağı denetleyip konak gövdesine çevirir. `folderId`: klasör adı = kimlik denetimi. */
  const readSkill = (dir: string, folderId?: string): ReadSkill => {
    const parent = path.dirname(dir);
    if (!isPlainChildDir(parent, dir)) {
      return { ok: false, issues: ['Yetenek klasörü sıradan bir klasör değil (bağlantı ya da eksik).'], hash: null, manifest: null };
    }
    const manifestText = readFile(dir, 'manifest.json', MANIFEST_LIMITS.maxBytes);
    const indexText = readFile(dir, 'index.mjs', MAX_SOURCE_BYTES);
    const selftestText = readFile(dir, 'selftest.mjs', MAX_SOURCE_BYTES);
    const issues: string[] = [];
    for (const item of [manifestText, indexText, selftestText]) if (typeof item !== 'string') issues.push(item.issue);

    let manifest: WorkshopManifest | null = null;
    if (typeof manifestText === 'string') {
      const parsed = parseManifest(manifestText, folderId);
      if (parsed.ok) manifest = parsed.manifest;
      else issues.push(...parsed.issues);
    }

    // Sayfalar: manifestte bildirilen her dosya okunur, denetlenir ve özete girer (onay sayfayı da kapsar).
    const pages: Record<string, string> = {};
    let pagesOk = true;
    for (const page of manifest?.pages ?? []) {
      const html = readFile(dir, page.file, MAX_SOURCE_BYTES);
      if (typeof html !== 'string') {
        issues.push(html.issue);
        pagesOk = false;
        continue;
      }
      const audit = auditPage(html, page.file);
      if (audit.length > 0) issues.push(...describeIssues(page.file, audit));
      pages[page.file] = html;
    }

    let hash: string | null = null;
    if (typeof manifestText === 'string' && typeof indexText === 'string' && typeof selftestText === 'string' && pagesOk) {
      // Sayfasız eklentinin özeti eski biçimle aynıdır: önceki sürümde verilen onaylar geçerli kalır.
      const digest = crypto.createHash('sha256').update(manifestText).update('\0').update(indexText).update('\0').update(selftestText);
      for (const file of Object.keys(pages).sort()) digest.update('\0page:').update(file).update('\0').update(pages[file]!);
      hash = digest.digest('hex');
    }

    const index = typeof indexText === 'string' ? prepareSource(indexText, 'index.mjs') : null;
    const selftest = typeof selftestText === 'string' ? prepareSource(selftestText, 'selftest.mjs') : null;
    if (index && !index.ok) issues.push(...describeIssues('index.mjs', index.issues));
    if (selftest && !selftest.ok) issues.push(...describeIssues('selftest.mjs', selftest.issues));

    if (issues.length > 0 || !manifest || !index?.ok || !selftest?.ok || !hash) return { ok: false, issues, hash, manifest };
    return { ok: true, manifest, script: index.script, selftestScript: selftest.script, hash, pages };
  };

  // ───────────────────────────── öz-sınama ─────────────────────────────

  const releaseScratch = () => {
    if (scratchTimer) clearTimeout(scratchTimer);
    scratchTimer = setTimeout(() => scratch.stop(), SCRATCH_IDLE_MS);
    scratchTimer.unref?.();
  };

  /** Yeteneği geçici konakta yükleyip öz-sınamasını koşturur. Hiç fırlatmaz. */
  const runSelftest = (skillId: string, read: Extract<ReadSkill, { ok: true }>, signal?: AbortSignal): Promise<SelftestReport> =>
    serialTest(async () => {
      if (scratchTimer) clearTimeout(scratchTimer);
      underTest.set(skillId, read.manifest);
      logs.set(skillId, []);
      const started = Date.now();
      let outcome: SelftestOutcome;
      try {
        outcome = await scratch.selftest(
          {
            skillId,
            script: read.script,
            selftestScript: read.selftestScript,
            spec: {
              declared: read.manifest.tools.map((tool) => tool.name),
              mustCall: read.manifest.tools.filter((tool) => tool.risk === 'read').map((tool) => tool.name),
              settings: Object.fromEntries((read.manifest.settings ?? []).map((setting) => [setting.key, setting.default])),
            },
          },
          signal ? { signal } : {},
        );
      } catch (error) {
        const message =
          error instanceof HostTimeoutError
            ? t('skills.error.selftestTimeout')
            : error instanceof HostAbortedError
              ? t('tool.error.aborted')
              : (error as Error).message;
        outcome = { ok: false, error: message, called: [], effects: 0 };
      } finally {
        underTest.delete(skillId);
        releaseScratch();
      }
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      appendLog(
        skillId,
        outcome.ok
          ? `✓ Öz-sınama geçti (${seconds} sn; çağrılan araçlar: ${outcome.called.join(', ') || 'yok'}).`
          : `✗ Öz-sınama geçmedi (${seconds} sn): ${outcome.error ?? 'bilinmeyen neden'}`,
      );
      return { ok: outcome.ok, error: outcome.error, log: (logs.get(skillId) ?? []).join('\n') };
    });

  // ───────────────────────────── etkinleştirme ─────────────────────────────

  const deactivate = async (id: string, unload = true) => {
    const entry = active.get(id);
    if (!entry) return;
    active.delete(id);
    plugins.detach(id);
    for (const dispose of entry.disposers) dispose();
    ctx.tools.unregisterModule(moduleId(id));
    declareModule(ctx.tools, moduleId(id), null);
    if (unload) await live.unload(id);
  };

  const strike = (id: string) => {
    const count = (strikes.get(id) ?? 0) + 1;
    strikes.set(id, count);
    if (count >= MAX_STRIKES) void serial(() => failActive(id, t('skills.error.strikes')));
  };

  const toolFor = (id: string, manifest: WorkshopManifest, tool: WorkshopManifest['tools'][number]): ExternalToolDef => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    risk: tool.risk,
    approvalText: () => t('skills.tool.approval', { name: manifest.name, description: tool.description }),
    async run(input, toolContext) {
      try {
        const result = await live.call(id, tool.name, input, { signal: toolContext.signal });
        strikes.delete(id);
        return {
          ok: result.ok,
          text: result.text.slice(0, MAX_RESULT_CHARS),
          ...(result.data !== undefined ? { data: result.data } : {}),
        };
      } catch (error) {
        if (error instanceof HostTimeoutError) {
          if (error.restarted) strike(id);
          return { ok: false, text: t('skills.error.timeout', { name: manifest.name }) };
        }
        if (error instanceof HostRestartedError) return { ok: false, text: t('skills.error.hostRestarted') };
        if (error instanceof HostAbortedError) return { ok: false, text: t('tool.error.aborted') };
        return { ok: false, text: t('skills.error.threw', { name: manifest.name, detail: (error as Error).message }) };
      }
    },
  });

  /** Onaylı ve sınanmış yeteneği canlı konağa yükler, araçlarını kayda sokar. Başarısızsa fırlatır ve iz bırakmaz. */
  const activate = async (id: string, read: Extract<ReadSkill, { ok: true }>) => {
    await deactivate(id);
    const exported = await live.load(id, read.script);
    const declared = read.manifest.tools.map((tool) => tool.name);
    const mismatch = declared.filter((name) => !exported.includes(name)).concat(exported.filter((name) => !declared.includes(name)));
    if (mismatch.length > 0) {
      await live.unload(id);
      throw new Error(`manifest ile index.mjs araçları uyuşmuyor: ${mismatch.join(', ')}`);
    }
    const disposers: Unsubscribe[] = [];
    declareModule(ctx.tools, moduleId(id), { permissions: read.manifest.permissions, policyId: POLICY_ID });
    const skillContext: ModuleContext = { ...ctx, moduleId: moduleId(id), log: log.child(id) };
    try {
      // Gizli (`hidden`) araçlar beyne sunulmaz: yalnız kart, iş, takip ve sayfa çağırır.
      for (const tool of visibleTools(read.manifest)) disposers.push(ctx.tools.registerExternal(skillContext, toolFor(id, read.manifest, tool)));
    } catch (error) {
      for (const dispose of disposers) dispose();
      declareModule(ctx.tools, moduleId(id), null);
      await live.unload(id);
      throw error;
    }
    active.set(id, { manifest: read.manifest, disposers, pages: read.pages });
    strikes.delete(id);
    plugins.attach(id, read.manifest, { boot: booting });
  };

  // ───────────────────────────── kayıt yardımcıları ─────────────────────────────

  const newRecord = (id: string, patch: Partial<SkillRecord> = {}): SkillRecord => {
    const now = nowIso();
    return {
      ...INITIAL_STATE,
      id,
      name: id,
      description: '',
      build: 1,
      contentHash: null,
      draft: false,
      createdBy: 'manual',
      jobId: null,
      goal: null,
      lastError: null,
      selftestLog: '',
      stagedHash: null,
      stagedNote: null,
      createdAt: now,
      updatedAt: now,
      ...patch,
    };
  };

  /** Durum makinesini uygular; geçersiz geçişte kullanıcıya gösterilebilir hata fırlatır. */
  const apply = (record: SkillRecord, event: SkillEvent): SkillRecord => {
    const result = transition(record, event);
    if (!result.ok) throw new UserError(transitionMessage(result.reason, record.name));
    return { ...record, ...result.state };
  };

  const transitionMessage = (reason: TransitionError, name: string): string => {
    switch (reason) {
      case 'not_approved':
        return t('skills.error.notApproved', { name });
      case 'not_tested':
        return t('skills.error.notTested', { name });
      case 'busy':
        return t('skills.error.busy', { name });
      case 'invalid':
        return t('skills.error.invalidState', { name });
    }
  };

  const need = (id: string): SkillRecord => {
    const record = store.get(id);
    if (!record) throw new UserError(t('skills.error.unknown', { name: id }));
    return record;
  };

  /** Etkin yeteneği "hatalı" durumuna alır (yüklenemedi, konağı düşürdü, art arda zaman aşımı). */
  const failActive = async (id: string, message: string) => {
    await deactivate(id, false);
    await live.unload(id);
    const record = store.get(id);
    if (!record) return;
    const next = transition(record, { type: 'load_failed' });
    store.save({ ...record, ...(next.ok ? next.state : { status: 'failed' as const }), lastError: message });
    emit('updated', id);
  };

  const toInfo = (record: SkillRecord): SkillInfo => {
    const manifest = manifests.get(record.id);
    return {
      id: record.id,
      name: record.name,
      description: record.description,
      status: record.status,
      version: record.build,
      permissions: manifest?.permissions ?? [],
      tools: (manifest ? visibleTools(manifest) : []).map((tool) => ({
        name: tool.name,
        description: tool.description,
        risk: tool.risk,
        moduleId: moduleId(record.id),
      })),
      jobId: record.jobId,
      lastError: record.lastError,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  };

  // ───────────────────────────── alım: doğrula → sına → duruma yerleştir ─────────────────────────────

  /**
   * Klasördeki yeteneği baştan değerlendirir. Yeni klasörde, içerik değiştiğinde ve "yeniden sına" isteğinde çalışır.
   * Sonuç: `pending_approval` (yeni içerik), `enabled`/`disabled` (onaylı içerik yeniden sınandı) ya da `failed`.
   */
  const intake = async (id: string): Promise<void> => {
    const prepared = await serial(async () => {
      const existing = store.get(id);
      if (existing?.draft) return null;
      await deactivate(id);
      const read = readSkill(path.join(skillsRoot, id), id);
      const base = existing ?? newRecord(id);
      if (read.manifest) manifests.set(id, read.manifest);
      else manifests.delete(id);
      const named = read.manifest
        ? { name: read.manifest.name, description: read.manifest.description, createdBy: read.manifest.createdBy }
        : {};
      if (!read.ok) {
        const failed = transition({ ...base, status: 'testing' }, { type: 'test_failed' });
        store.save({
          ...base,
          ...(failed.ok ? failed.state : {}),
          ...named,
          contentHash: read.hash,
          lastError: read.issues.join('\n'),
          selftestLog: '',
        });
        emit(existing ? 'updated' : 'created', id);
        return null;
      }
      store.save({ ...apply(base, { type: 'test_started' }), ...named, contentHash: read.hash, lastError: null });
      emit(existing ? 'updated' : 'created', id);
      return read;
    });
    if (!prepared) return;

    const report = await runSelftest(id, prepared);

    await serial(async () => {
      const record = store.get(id);
      if (!record || record.status !== 'testing' || record.contentHash !== prepared.hash) return;
      if (!report.ok) {
        store.save({
          ...apply(record, { type: 'test_failed' }),
          lastError: t('skills.error.selftest', { detail: report.error ?? '' }),
          selftestLog: report.log,
        });
        emit('updated', id);
        return;
      }
      let next: SkillRecord = { ...apply(record, { type: 'test_passed', hash: prepared.hash }), selftestLog: report.log, lastError: null };
      if (next.status === 'enabled') {
        try {
          await activate(id, prepared);
        } catch (error) {
          next = { ...apply(next, { type: 'load_failed' }), lastError: t('skills.error.load', { detail: (error as Error).message }) };
        }
      }
      store.save(next);
      emit('updated', id);
      if (next.status === 'pending_approval') announcePending(next);
    });
  };

  /** Klasörleri kayıtlarla eşitler. `boot`: açılış (etkin yetenekler yüklenir, yarım işler toparlanır). */
  const scan = (boot: boolean): Promise<void> =>
    serial(async () => {
      fs.mkdirSync(draftsRoot, { recursive: true });
      const folders = fs
        .readdirSync(skillsRoot, { withFileTypes: true })
        .filter((entry) => !entry.name.startsWith('.') && !entry.name.startsWith('_') && FOLDER_NAME.test(entry.name))
        .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
        .map((entry) => entry.name);
      const pending: string[] = [];

      if (boot) {
        // Kaydı kalmamış taslak klasörleri (yarıda kesilen silme, çökme) birikmesin.
        for (const entry of fs.readdirSync(draftsRoot, { withFileTypes: true })) {
          if (!store.get(entry.name)) deleteDir(draftsRoot, path.join(draftsRoot, entry.name));
        }
        // Sahipsiz bekleyen güncellemeler ve kaldırılmış eklentilerin saklanan sürümleri de birikmesin.
        for (const [root, keep] of [
          [stagedRoot, (id: string) => store.get(id)?.stagedHash != null],
          [versionsRoot, (id: string) => store.get(id) !== null],
        ] as const) {
          let names: string[] = [];
          try {
            names = fs.readdirSync(root);
          } catch {
            // klasör henüz yok
          }
          for (const name of names) if (!keep(name)) await removeTree(path.join(root, name));
        }
      }

      for (const record of store.list()) {
        if (record.draft) {
          const alive = builds.has(record.id);
          if (boot || !alive) {
            if (record.status === 'building' || record.status === 'testing') {
              // Önceki oturumda yarıda kalan yapım: kendiliğinden sürdürülmez, dürüstçe "yarıda kaldı" görünür.
              store.save({ ...record, status: 'failed', lastError: t('skills.error.interrupted') });
              emit('updated', record.id);
            }
          }
          continue;
        }
        if (!folders.includes(record.id)) {
          await deactivate(record.id);
          store.delete(record.id);
          manifests.delete(record.id);
          emit('deleted', record.id);
        }
      }

      for (const id of folders) {
        const record = store.get(id);
        if (record?.draft) continue;
        const read = readSkill(path.join(skillsRoot, id), id);
        if (read.manifest) manifests.set(id, read.manifest);
        if (!record || read.hash !== record.contentHash || read.hash === null) {
          // Yeni klasör ya da içerik değişmiş: eski onay bu içerik için geçerli değil; yeniden değerlendirilir.
          if (!record || read.hash !== record.contentHash) pending.push(id);
          continue;
        }
        if (!boot) continue;
        if (record.status === 'testing' || record.status === 'building') {
          pending.push(id);
        } else if (record.wanted && record.approvedHash === read.hash && (record.status === 'enabled' || record.status === 'failed')) {
          if (!read.ok) {
            store.save({ ...record, status: 'failed', lastError: read.issues.join('\n') });
            emit('updated', id);
            continue;
          }
          try {
            await activate(id, read);
            const restored = transition(record, { type: 'restored', hash: read.hash });
            store.save({ ...record, ...(restored.ok ? restored.state : {}), lastError: null });
          } catch (error) {
            log.error(`${id} açılışta yüklenemedi`, error);
            store.save({ ...record, status: 'failed', lastError: t('skills.error.load', { detail: (error as Error).message }) });
          }
          emit('updated', id);
        }
      }

      for (const id of pending) void intake(id).catch((error: unknown) => log.error(`${id} değerlendirilemedi`, error));
    });

  // ───────────────────────────── onay ─────────────────────────────

  /** Onay özeti: ne ekliyor ve hangi izinleri istiyor (ada kartında ve sesli okunur; `preview.ts` ile aynı kaynak). */
  const approvalSummary = (record: SkillRecord, manifest: WorkshopManifest | undefined): string => {
    if (!manifest) return t('skills.approval.summary', { name: record.name, description: record.description, permissions: t('skills.permission.none.spoken') });
    const spoken = spokenPreview(manifest);
    return t('plugins.approval.summary', { name: record.name, description: record.description, adds: spoken.adds, permissions: spoken.permissions });
  };

  /** Onay bekleyen yeteneği kullanıcıya duyurur: yapımdan çıkan için ada kartı, elle konan için sessiz bildirim. */
  const announcePending = (record: SkillRecord) => {
    if (stopped) return;
    if (record.createdBy === 'workshop') {
      void requestApproval(record.id, { channel: 'job', ...(record.jobId ? { jobId: record.jobId } : {}), speakerVerified: null }).catch(
        (error: unknown) => log.warn('onay isteği başarısız', error),
      );
      return;
    }
    try {
      ctx.attention.notify({
        moduleId: 'workshop',
        title: t('skills.notify.found.title'),
        body: t('skills.notify.found.body', { name: record.name }),
        priority: 'normal',
        dedupeKey: `workshop.found.${record.id}`,
        data: { skillId: record.id },
      });
    } catch (error) {
      log.warn('bildirim gönderilemedi', error);
    }
  };

  const requestApproval = async (id: string, origin: ToolOrigin): Promise<'approved' | 'denied' | 'expired'> => {
    const record = need(id);
    if (record.status !== 'pending_approval' && !(record.status === 'disabled' && record.testedHash !== null)) {
      throw new UserError(transitionMessage('invalid', record.name));
    }
    // Acil durdurma etkinken kapı her isteği "reddedildi" sayar; bu, kullanıcının reddi değildir.
    if (ctx.policy.killSwitchActive()) return 'expired';
    const manifest = manifests.get(id);
    const asked = ctx.tools.requestApproval({
      toolName: 'skill_approve',
      moduleId: 'workshop',
      summary: approvalSummary(record, manifest),
      input: {
        id,
        name: record.name,
        permissions: manifest?.permissions ?? [],
        hosts: manifest?.net?.hosts ?? [],
        roots: manifest?.fs?.roots ?? [],
        usedTools: manifest?.uses?.tools ?? [],
        speak: manifest?.speak === true,
        tools: (manifest ? visibleTools(manifest) : []).map((tool) => tool.name),
        adds: manifest ? spokenPreview(manifest).adds : '',
      },
      origin,
      timeoutMs: APPROVAL_PROMPT_MS,
    });
    // İstek eşzamanlı yayınlanır; dinleyici onay kimliğini bu noktada yazmıştır.
    const promptId = prompts.get(id);
    const decision = await asked;
    prompts.delete(id);
    const by = promptId ? resolvedBy.get(promptId) : undefined;
    if (promptId) resolvedBy.delete(promptId);
    // Acil durdurma ve kapanış bekleyen onayları "reddedildi" diye kapatır; bu kullanıcının reddi değildir.
    if (stopped || by === 'system') return 'expired';
    const current = store.get(id);
    // Bu sırada sayfadan karar verilmiş olabilir.
    if (!current || (current.status !== 'pending_approval' && current.status !== 'disabled')) return decision;
    if (decision === 'approved') {
      await approve(id, true);
    } else if (decision === 'denied' && current.status === 'pending_approval') {
      await approve(id, false);
    } else if (decision === 'expired') {
      try {
        ctx.attention.notify({
          moduleId: 'workshop',
          title: t('skills.notify.waiting.title'),
          body: t('skills.notify.waiting.body', { name: current.name }),
          priority: 'normal',
          dedupeKey: `workshop.waiting.${id}`,
          data: { skillId: id },
        });
      } catch (error) {
        log.warn('bildirim gönderilemedi', error);
      }
    }
    return decision;
  };

  /** Adada bekleyen onay kartını (varsa) sayfadan verilen kararla kapatır. */
  const settlePrompt = (id: string, approved: boolean) => {
    const promptId = prompts.get(id);
    if (!promptId) return;
    prompts.delete(id);
    ctx.tools.resolveApproval(promptId, approved ? 'approved' : 'denied', 'ui');
  };

  const approve = (id: string, approved: boolean): Promise<SkillInfo> =>
    serial(async () => {
      const record = need(id);
      if (!approved) {
        const next = store.save(apply(record, { type: 'rejected' }));
        emit('updated', id);
        settlePrompt(id, false);
        return toInfo(next);
      }
      const accepted = apply(record, { type: 'approved' });
      const read = readSkill(dirOf(record), id);
      if (!read.ok || read.hash !== record.testedHash) {
        // Sınanan içerik artık diskteki içerik değil: onay verilmez, yeniden değerlendirilir.
        void intake(id).catch((error: unknown) => log.error(`${id} değerlendirilemedi`, error));
        throw new UserError(t('skills.error.changed', { name: record.name }));
      }
      try {
        await activate(id, read);
      } catch (error) {
        const message = t('skills.error.load', { detail: (error as Error).message });
        store.save({ ...apply(accepted, { type: 'load_failed' }), lastError: message });
        emit('updated', id);
        throw new UserError(message);
      }
      const next = store.save({ ...accepted, lastError: null });
      // Onaylanan her içerik sürüm kaydına girer: geri alma yalnız kullanıcının bir kez onayladığı içeriğe döner.
      if (next.approvedHash) {
        store.versions.save({ skillId: id, version: next.build, hash: next.approvedHash, note: next.goal, createdAt: nowIso() });
      }
      emit('updated', id);
      settlePrompt(id, true);
      log.info(`${id} onaylandı ve etkinleşti`);
      return toInfo(next);
    });

  const setEnabled = (id: string, enabled: boolean): Promise<SkillInfo> =>
    serial(async () => {
      const record = need(id);
      if (!enabled) {
        const next = store.save(apply(record, { type: 'disable' }));
        await deactivate(id);
        emit('updated', id);
        return toInfo(next);
      }
      if (record.draft) throw new UserError(transitionMessage('invalid', record.name));
      if (record.status === 'failed') {
        // "Yeniden dene": baştan doğrula ve sına. Onaylı içerik değişmediyse sınamadan sonra kendiliğinden açılır.
        const retry = store.save({ ...record, status: 'testing' });
        emit('updated', id);
        void intake(id).catch((error: unknown) => log.error(`${id} değerlendirilemedi`, error));
        return toInfo(retry);
      }
      const accepted = apply(record, { type: 'enable' });
      const read = readSkill(dirOf(record), id);
      if (!read.ok || read.hash !== record.approvedHash) {
        void intake(id).catch((error: unknown) => log.error(`${id} değerlendirilemedi`, error));
        throw new UserError(t('skills.error.changed', { name: record.name }));
      }
      try {
        await activate(id, read);
      } catch (error) {
        const message = t('skills.error.load', { detail: (error as Error).message });
        store.save({ ...apply(accepted, { type: 'load_failed' }), lastError: message });
        emit('updated', id);
        throw new UserError(message);
      }
      const next = store.save({ ...accepted, lastError: null });
      emit('updated', id);
      return toInfo(next);
    });

  /** Klasörü siler; bağlantıysa yalnız bağlantıyı kaldırır (hedefine dokunmaz). */
  const deleteDir = (root: string, dir: string) => {
    if (path.dirname(path.resolve(dir)) !== path.resolve(root)) throw new Error('yetenek klasörü beklenen yerde değil');
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(dir);
    } catch {
      return;
    }
    if (stat.isSymbolicLink()) {
      try {
        fs.unlinkSync(dir);
      } catch {
        fs.rmdirSync(dir);
      }
      return;
    }
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  };

  const remove = (id: string): Promise<void> =>
    serial(async () => {
      const record = need(id);
      if (record.jobId && builds.has(id)) ctx.jobs.cancel(record.jobId);
      builds.delete(id);
      settlePrompt(id, false);
      await deactivate(id);
      deleteDir(record.draft ? draftsRoot : skillsRoot, dirOf(record));
      if (!record.draft) {
        // Bekleyen güncelleme ve saklanan eski sürümler de gider: kaldırılan eklentiden kod kalmaz.
        await removeTree(path.join(stagedRoot, id));
        await removeTree(path.join(versionsRoot, id));
      }
      store.delete(id);
      manifests.delete(id);
      logs.delete(id);
      strikes.delete(id);
      emit('deleted', id);
      log.info(`${id} kaldırıldı`);
    });

  // ───────────────────────────── bulut durumu ─────────────────────────────

  /** Ağa çıkmadan bilinen engeller (acil durdurma, Gizli kip, anahtar yok, `deep` rolü yerelde). */
  const cloudBlockers = (): string | null => {
    const policy = ctx.policy.get();
    if (ctx.policy.killSwitchActive()) return t('brain.error.killSwitch');
    if (!ctx.policy.networkAllowed()) return t('tool.error.private');
    if (policy.models.deep.provider !== 'anthropic') return t('skills.cloud.localOnly');
    if (!policy.keys.anthropic?.trim()) return t('brain.error.noKey');
    return null;
  };

  const cloudStatus = async (probe: boolean): Promise<CloudStatus> => {
    const blocker = cloudBlockers();
    if (blocker) return { ok: false, reason: blocker, checkedAt: null };
    const cached = cloudProbe;
    if (cached && Date.now() - cached.at < (cached.status.ok ? PROBE_OK_TTL_MS : PROBE_FAIL_TTL_MS)) return cached.status;
    if (!probe) return cached?.status ?? { ok: true, reason: null, checkedAt: null };

    // Anahtarın var olması bulutun çalıştığı anlamına gelmez (kredi bitmiş, ağ yok olabilir): en küçük gerçek istek.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    let status: CloudStatus;
    try {
      const response = await ctx.brain.respond({
        role: 'deep',
        text: PROBE_TEXT,
        tools: 'none',
        persona: false,
        effort: 'low',
        maxSteps: 1,
        origin: { channel: 'job', speakerVerified: null },
        signal: controller.signal,
      });
      const ok = response.stopReason === 'end' || response.stopReason === 'max_tokens' || response.stopReason === 'max_steps';
      status = {
        ok,
        reason: ok ? null : response.stopReason === 'aborted' ? t('brain.error.timeout') : (response.error ?? t('brain.error.unknown')),
        checkedAt: nowIso(),
      };
    } catch (error) {
      status = { ok: false, reason: (error as Error).message, checkedAt: nowIso() };
    } finally {
      clearTimeout(timer);
    }
    cloudProbe = { at: Date.now(), status };
    return status;
  };

  // ───────────────────────────── yapım ─────────────────────────────

  /**
   * Yapımı kimin yürüteceği ve arayüze gösterilecek durum. API seçiliyken gerçekten yanıt verip vermediği küçük bir
   * istekle yoklanır (`probe`); yanıt vermiyorsa derin beyne bildirilir ve `auto` kipte Claude Code'a geçilir.
   */
  const buildRoute = async (probe: boolean): Promise<{ driver: BuildDriver | null; status: CloudStatus }> => {
    const deep = options.deep;
    if (!deep) {
      const status = await cloudStatus(probe);
      return { driver: status.ok ? 'api' : null, status };
    }
    let availability = probe ? await deep.refresh() : deep.available();
    let checkedAt: string | null = probe ? nowIso() : null;
    if (availability.provider === 'anthropic') {
      const cloud = await cloudStatus(probe);
      if (cloud.ok) return { driver: 'api', status: { ...cloud, provider: 'anthropic' } };
      availability = deep.reportApiFailure(cloud.reason ?? t('brain.error.unknown'));
      checkedAt = cloud.checkedAt ?? checkedAt;
    }
    if (availability.provider === 'claude-code') return { driver: 'deep', status: { ok: true, reason: null, checkedAt, provider: 'claude-code' } };
    return { driver: null, status: { ok: false, reason: availability.reason ?? null, checkedAt, provider: null } };
  };

  const builder: Builder = createBuilder({
    ctx,
    ...(options.deep ? { deep: options.deep } : {}),
    store,
    skillsRoot,
    draftsRoot,
    readSkill,
    runSelftest,
    newRecord,
    serial,
    takenIds: () => [...new Set([...store.list().map((record) => record.id), ...safeFolders()])],
    setProgress(progress) {
      if (progress) builds.set(progress.skillId, progress);
    },
    endBuild: (draftId) => void builds.delete(draftId),
    onPromoted(record, manifest) {
      manifests.set(record.id, manifest);
      emit('created', record.id);
      announcePending(record);
    },
    stagedRoot,
    onStaged(record) {
      emit('updated', record.id);
      if (stopped) return;
      void requestUpdateApproval(record.id, { channel: 'job', ...(record.jobId ? { jobId: record.jobId } : {}), speakerVerified: null }).catch(
        (error: unknown) => log.warn('güncelleme onayı istenemedi', error),
      );
    },
    onCloudFailure(reason) {
      cloudProbe = { at: Date.now(), status: { ok: false, reason, checkedAt: nowIso() } };
    },
    deleteDraft: (draftId) => deleteDir(draftsRoot, path.join(draftsRoot, draftId)),
    emit,
  });

  function safeFolders(): string[] {
    try {
      return fs.readdirSync(skillsRoot).filter((name) => !name.startsWith('.'));
    } catch {
      return [];
    }
  }

  const build = async (goal: string, origin: ToolOrigin): Promise<Job> => {
    await readyPromise;
    const route = await buildRoute(true);
    if (!route.driver) throw new UserError(`${t('skills.build.needsCloud')}${route.status.reason ? ` ${route.status.reason}` : ''}`);
    return builder.start(goal, origin, route.driver);
  };

  // ───────────────────────────── eklenti platformu: sürümler, güncelleme, geri alma ─────────────────────────────

  /** Klasörü (varsa) özyinelemeli siler. `fs.rmSync` Türkçe harfli yolda sessizce silmediği için eşzamansız yol (TUZAKLAR §7). */
  async function removeTree(dir: string): Promise<void> {
    await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {});
  }

  const versionDir = (id: string, version: number) => path.join(versionsRoot, id, String(version));

  /** Klasörü taşır; hedef varsa önce kaldırılır. Aynı sürücüde yeniden adlandırmadır (yarım kopya kalmaz). */
  const moveDir = async (from: string, to: string) => {
    await removeTree(to);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
  };

  /** Onaylı (ya da en son sınanmış) kurulu içeriğin sürüm kaydı yoksa açar: eski kayıtlarda ve elle konan eklentilerde. */
  const ensureVersionRecord = (record: SkillRecord) => {
    if (store.versions.get(record.id, record.build)) return;
    const hash = record.approvedHash ?? record.testedHash;
    if (hash) store.versions.save({ skillId: record.id, version: record.build, hash, note: record.goal, createdAt: record.createdAt });
  };

  const pruneVersions = async (id: string, current: number) => {
    const old = store.versions.list(id).filter((entry) => entry.version !== current);
    for (const entry of old.slice(MAX_KEPT_VERSIONS)) {
      await removeTree(versionDir(id, entry.version));
      store.versions.delete(id, entry.version);
    }
  };

  const discardStaged = async (record: SkillRecord): Promise<SkillRecord> => {
    await removeTree(path.join(stagedRoot, record.id));
    return store.save({ ...record, stagedHash: null, stagedNote: null });
  };

  const preview = async (id: string, staged = false): Promise<PluginPreview> => {
    await readyPromise;
    const record = need(id);
    const current = manifests.get(id) ?? readSkill(dirOf(record), record.draft ? undefined : id).manifest;
    if (staged) {
      if (!record.stagedHash) throw new UserError(t('plugins.update.none', { name: record.name }));
      const read = readSkill(path.join(stagedRoot, id), id);
      if (!read.manifest) throw new UserError(t('plugins.update.broken', { name: record.name }));
      return buildPreview(read.manifest, { staged: true, previous: current });
    }
    if (!current) throw new UserError(t('skills.error.unknown', { name: id }));
    return buildPreview(current, { staged: false });
  };

  const versions = async (id: string): Promise<SkillVersionInfo[]> => {
    await readyPromise;
    const record = need(id);
    ensureVersionRecord(record);
    return store.versions
      .list(id)
      .filter((entry) => entry.version === record.build || fs.existsSync(versionDir(id, entry.version)))
      .map((entry) => ({ version: entry.version, createdAt: entry.createdAt, note: entry.note, current: entry.version === record.build }));
  };

  const update = async (id: string, change: string, origin: ToolOrigin): Promise<Job> => {
    await readyPromise;
    const record = need(id);
    if (record.draft || record.status === 'building' || record.status === 'testing') throw new UserError(t('skills.error.busy', { name: record.name }));
    const route = await buildRoute(true);
    if (!route.driver) throw new UserError(`${t('skills.build.needsCloud')}${route.status.reason ? ` ${route.status.reason}` : ''}`);
    return builder.start(change, origin, route.driver, { id, name: record.name, version: record.build + 1, dir: dirOf(record) });
  };

  const requestUpdateApproval = async (id: string, origin: ToolOrigin): Promise<'approved' | 'denied' | 'expired'> => {
    const record = need(id);
    if (!record.stagedHash) throw new UserError(t('plugins.update.none', { name: record.name }));
    if (ctx.policy.killSwitchActive()) return 'expired';
    const next = readSkill(path.join(stagedRoot, id), id).manifest;
    const current = manifests.get(id);
    const changes = next && current ? buildPreview(next, { staged: true, previous: current }).changes.join('; ') : '';
    const wider = next && current ? widensPermissions(next, current) : false;
    const decision = await ctx.tools.requestApproval({
      toolName: 'skill_update_approve',
      moduleId: 'workshop',
      summary: t(wider ? 'plugins.update.summaryWider' : 'plugins.update.summary', { name: record.name, version: record.build + 1, changes }),
      input: { id, name: record.name, version: record.build + 1, changes, widensPermissions: wider },
      origin,
      timeoutMs: APPROVAL_PROMPT_MS,
    });
    if (stopped) return 'expired';
    const latest = store.get(id);
    // Bu sırada sayfadan karar verilmiş olabilir.
    if (!latest?.stagedHash) return decision;
    if (decision === 'approved') await approveUpdate(id, true);
    else if (decision === 'denied') await approveUpdate(id, false);
    else {
      try {
        ctx.attention.notify({
          moduleId: 'workshop',
          title: t('plugins.update.waiting.title'),
          body: t('plugins.update.waiting.body', { name: record.name }),
          priority: 'normal',
          dedupeKey: `workshop.update.${id}`,
          data: { skillId: id },
        });
      } catch (error) {
        log.warn('bildirim gönderilemedi', error);
      }
    }
    return decision;
  };

  const approveUpdate = (id: string, approved: boolean): Promise<SkillInfo> =>
    serial(async () => {
      const record = need(id);
      if (!record.stagedHash) throw new UserError(t('plugins.update.none', { name: record.name }));
      // Adada bekleyen güncelleme onayı (varsa) sayfadan verilen kararla kapanır.
      for (const pending of ctx.tools.pendingApprovals()) {
        const input = pending.input as { id?: unknown } | null;
        if (pending.toolName === 'skill_update_approve' && input?.id === id) ctx.tools.resolveApproval(pending.id, approved ? 'approved' : 'denied', 'ui');
      }
      if (!approved) {
        const next = await discardStaged(record);
        emit('updated', id);
        return toInfo(next);
      }
      const stagedDir = path.join(stagedRoot, id);
      const read = readSkill(stagedDir, id);
      if (!read.ok || read.hash !== record.stagedHash) {
        // Sınanan güncelleme artık diskteki içerik değil: uygulanmaz.
        await discardStaged(record);
        emit('updated', id);
        throw new UserError(t('plugins.update.broken', { name: record.name }));
      }
      ensureVersionRecord(record);
      await deactivate(id);
      await moveDir(path.join(skillsRoot, id), versionDir(id, record.build));
      await moveDir(stagedDir, path.join(skillsRoot, id));
      manifests.set(id, read.manifest);
      const build = record.build + 1;
      store.versions.save({ skillId: id, version: build, hash: read.hash, note: record.stagedNote, createdAt: nowIso() });
      let next: SkillRecord = {
        ...record,
        name: read.manifest.name,
        description: read.manifest.description,
        build,
        contentHash: read.hash,
        testedHash: read.hash,
        approvedHash: read.hash,
        stagedHash: null,
        stagedNote: null,
        status: record.wanted ? 'enabled' : 'disabled',
        lastError: null,
      };
      if (next.wanted) {
        try {
          await activate(id, read);
        } catch (error) {
          next = { ...next, status: 'failed', lastError: t('skills.error.load', { detail: (error as Error).message }) };
        }
      }
      const saved = store.save(next);
      await pruneVersions(id, build);
      emit('updated', id);
      log.info(`${id} güncellendi: sürüm ${build}`);
      return toInfo(saved);
    });

  const rollback = async (id: string, version?: number): Promise<SkillInfo> => {
    await readyPromise;
    const before = need(id);
    if (before.draft || before.status === 'building' || before.status === 'testing') throw new UserError(t('skills.error.busy', { name: before.name }));
    ensureVersionRecord(before);
    const candidates = store.versions.list(id).filter((entry) => entry.version !== before.build && fs.existsSync(versionDir(id, entry.version)));
    const target = version !== undefined ? candidates.find((entry) => entry.version === version) : candidates.find((entry) => entry.version < before.build);
    if (!target) throw new UserError(t(version !== undefined ? 'plugins.rollback.unknown' : 'plugins.rollback.none', { name: before.name, version: version ?? 0 }));
    const read = readSkill(versionDir(id, target.version), id);
    // Saklanan içerik onaylandığı andaki içerik olmalı (özet veritabanında, klasörün dışında durur).
    if (!read.ok || read.hash !== target.hash) throw new UserError(t('plugins.rollback.broken', { name: before.name, version: target.version }));
    const report = await runSelftest(id, read);
    if (!report.ok) throw new UserError(t('plugins.rollback.selftest', { name: before.name, version: target.version, detail: report.error ?? '' }));

    return serial(async () => {
      const record = need(id);
      await deactivate(id);
      await removeTree(path.join(stagedRoot, id));
      await moveDir(path.join(skillsRoot, id), versionDir(id, record.build));
      await moveDir(versionDir(id, target.version), path.join(skillsRoot, id));
      manifests.set(id, read.manifest);
      let next: SkillRecord = {
        ...record,
        name: read.manifest.name,
        description: read.manifest.description,
        build: target.version,
        contentHash: read.hash,
        testedHash: read.hash,
        approvedHash: read.hash,
        stagedHash: null,
        stagedNote: null,
        status: record.wanted ? 'enabled' : 'disabled',
        lastError: null,
        selftestLog: report.log,
      };
      if (next.wanted) {
        try {
          await activate(id, read);
        } catch (error) {
          next = { ...next, status: 'failed', lastError: t('skills.error.load', { detail: (error as Error).message }) };
        }
      }
      const saved = store.save(next);
      emit('updated', id);
      log.info(`${id} geri alındı: sürüm ${record.build} → ${target.version}`);
      return toInfo(saved);
    });
  };

  // ───────────────────────────── eklenti platformu: sayfalar ve ayarlar ─────────────────────────────

  const activeOf = (skillId: string) => {
    const entry = active.get(skillId);
    if (!entry) throw new UserError(t('plugins.run.inactive'));
    return entry;
  };

  const settingValues = (skillId: string, manifest: WorkshopManifest): PluginSettingValue[] =>
    (manifest.settings ?? []).map((setting) => {
      const stored = store.settings.get(skillId, setting.key);
      const value = stored.found && typeof stored.value === typeof setting.default ? (stored.value as string | number | boolean) : setting.default;
      return { ...setting, value };
    });

  const inputValidators = new Map<string, z.ZodType>();
  const validateInput = (skillId: string, manifest: WorkshopManifest, toolName: string, input: unknown) => {
    const tool = manifest.tools.find((entry) => entry.name === toolName);
    if (!tool) throw new UserError(t('plugins.page.unknownTool', { tool: toolName }));
    const key = `${skillId}:${toolName}:${JSON.stringify(tool.inputSchema)}`;
    let validator = inputValidators.get(key);
    if (!validator) {
      validator = z.fromJSONSchema(tool.inputSchema as Parameters<typeof z.fromJSONSchema>[0]);
      if (inputValidators.size > 200) inputValidators.clear();
      inputValidators.set(key, validator);
    }
    const parsed = validator.safeParse(input ?? {});
    if (!parsed.success) throw new UserError(t('plugins.page.badInput', { tool: toolName }));
    return { tool, value: parsed.data };
  };

  // ───────────────────────────── yaşam döngüsü ─────────────────────────────

  let readyPromise: Promise<void> = Promise.resolve();

  const find = (name: string, prefer?: 'enabled' | 'disabled'): SkillRecord => {
    const records = store.list().filter((record) => !record.draft);
    const wanted = fold(name);
    const exact = records.filter((record) => record.id === name.trim() || fold(record.name) === wanted || fold(record.id) === wanted);
    // Araç adı verildiyse (`skill_<id>_<fiil>` ya da `<id>_<fiil>`): aracın sahibi yetenek. En uzun kimlik kazanır.
    const raw = name.trim().toLowerCase().replace(/^skill_/, '');
    const byTool = exact.length
      ? []
      : records
          .filter((record) => raw.startsWith(`${record.id}_`) || (manifests.get(record.id)?.tools ?? []).some((tool) => tool.name === name.trim().toLowerCase()))
          .sort((a, b) => b.id.length - a.id.length)
          .slice(0, 1);
    let matches = exact.length
      ? exact
      : byTool.length
        ? byTool
        : records.filter((record) => wanted.length >= 2 && (fold(record.name).includes(wanted) || wanted.includes(fold(record.name))));
    if (matches.length > 1 && prefer) {
      const preferred = matches.filter((record) => record.status === prefer);
      if (preferred.length > 0) matches = preferred;
    }
    if (matches.length === 0) throw new UserError(t('skills.error.unknown', { name }));
    if (matches.length > 1) {
      throw new UserError(t('skills.error.ambiguous', { names: matches.map((record) => `${record.name} (${record.id})`).join(', ') }));
    }
    return matches[0]!;
  };

  return {
    start() {
      stopped = false;
      plugins.start();
      subscriptions.push(
        ctx.bus.on('tool.approval.request', (request) => {
          if (request.toolName !== 'skill_approve' || request.moduleId !== 'workshop') return;
          const id = (request.input as { id?: unknown } | null)?.id;
          if (typeof id === 'string') prompts.set(id, request.id);
        }),
        ctx.bus.on('tool.approval.resolve', ({ id, by }) => {
          if ([...prompts.values()].includes(id)) resolvedBy.set(id, by);
        }),
        ctx.bus.on('job.progress', ({ job }) => {
          if (job.kind !== 'workshop.skill_build' || (job.status !== 'cancelled' && job.status !== 'failed')) return;
          // Sırada beklerken iptal edilen yapım hiç koşmaz; taslağı burada toparlanır.
          for (const progress of builds.values()) {
            if (progress.jobId === job.id) void builder.abandon(progress.skillId).catch((error: unknown) => log.warn('taslak kaldırılamadı', error));
          }
        }),
      );
      booting = true;
      readyPromise = scan(true)
        .catch((error: unknown) => log.error('yetenekler taranamadı', error))
        .finally(() => {
          booting = false;
        });
      return readyPromise;
    },

    async stop() {
      stopped = true;
      for (const off of subscriptions.splice(0)) off();
      for (const id of [...prompts.keys()]) settlePrompt(id, false);
      for (const progress of builds.values()) ctx.jobs.cancel(progress.jobId);
      if (scratchTimer) clearTimeout(scratchTimer);
      plugins.stop();
      for (const id of [...active.keys()]) {
        const entry = active.get(id);
        active.delete(id);
        for (const dispose of entry?.disposers ?? []) dispose();
        ctx.tools.unregisterModule(moduleId(id));
        declareModule(ctx.tools, moduleId(id), null);
      }
      live.stop();
      scratch.stop();
    },

    ready: () => readyPromise,

    async list() {
      await readyPromise;
      // Klasöre elle konan ya da silinen yetenek sayfayı açınca görünsün; değerlendirme arka planda sürer.
      await scan(false).catch((error: unknown) => log.warn('yetenek taraması başarısız', error));
      return store.list().map(toInfo);
    },

    async detail(id) {
      await readyPromise;
      const record = need(id);
      const dir = dirOf(record);
      const read = readSkill(dir, record.draft ? undefined : id);
      const files: SkillDetail['files'] = [];
      try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true }).slice(0, 40)) {
          if (!entry.isFile()) continue;
          files.push({ path: entry.name, bytes: fs.statSync(path.join(dir, entry.name)).size });
        }
      } catch {
        // klasör yok ya da okunamıyor: dosya listesi boş kalır
      }
      const order = (name: string) => {
        const index = (SKILL_FILES as readonly string[]).indexOf(name);
        return index === -1 ? SKILL_FILES.length : index;
      };
      files.sort((a, b) => order(a.path) - order(b.path) || a.path.localeCompare(b.path));
      return {
        info: toInfo(record),
        manifest: read.manifest ?? manifests.get(id) ?? null,
        selftestLog: record.selftestLog || (logs.get(id) ?? []).join('\n'),
        files,
      };
    },

    async source(id, relative) {
      await readyPromise;
      const record = need(id);
      let file: string;
      try {
        file = resolveInside(dirOf(record), relative);
      } catch (error) {
        throw new UserError(error instanceof PathError ? error.message : t('common.unknownError'));
      }
      let stat: fs.Stats;
      try {
        stat = fs.statSync(file);
      } catch {
        throw new UserError(t('skills.error.fileMissing', { path: relative }));
      }
      if (!stat.isFile()) throw new UserError(t('skills.error.fileMissing', { path: relative }));
      const buffer = Buffer.alloc(Math.min(stat.size, MAX_SOURCE_VIEW_BYTES));
      const handle = fs.openSync(file, 'r');
      try {
        fs.readSync(handle, buffer, 0, buffer.length, 0);
      } finally {
        fs.closeSync(handle);
      }
      return { path: relative, content: buffer.toString('utf8'), bytes: stat.size, truncated: stat.size > MAX_SOURCE_VIEW_BYTES };
    },

    approve: async (id, approved) => {
      await readyPromise;
      return approve(id, approved);
    },
    setEnabled: async (id, enabled) => {
      await readyPromise;
      return setEnabled(id, enabled);
    },
    remove: async (id) => {
      await readyPromise;
      return remove(id);
    },
    build,

    async cancelBuild(id) {
      const progress = builds.get(id);
      if (!progress) throw new UserError(t('skills.error.noBuild'));
      ctx.jobs.cancel(progress.jobId);
    },

    async status(probe) {
      await readyPromise;
      const skills: WorkshopStatus['skills'] = {};
      for (const record of store.list()) {
        const manifest = manifests.get(record.id);
        const kept = record.draft ? 0 : store.versions.list(record.id).filter((entry) => entry.version !== record.build && fs.existsSync(versionDir(record.id, entry.version))).length;
        skills[record.id] = {
          approved: record.approvedHash !== null && record.approvedHash === record.testedHash,
          hosts: manifest?.net?.hosts ?? [],
          createdBy: record.createdBy,
          draft: record.draft,
          ...(record.stagedHash ? { update: { version: record.build + 1, note: record.stagedNote } } : {}),
          ...(kept > 0 ? { versions: kept } : {}),
          ...(manifest
            ? {
                adds: {
                  tools: visibleTools(manifest).length,
                  cards: manifest.cards?.length ?? 0,
                  jobs: manifest.jobs?.length ?? 0,
                  watches: manifest.watches?.length ?? 0,
                  pages: manifest.pages?.length ?? 0,
                  settings: manifest.settings?.length ?? 0,
                  voice: manifest.voice?.length ?? 0,
                },
              }
            : {}),
        };
      }
      return { cloud: (await buildRoute(probe)).status, builds: [...builds.values()], skills };
    },

    find,
    records: () => store.list(),
    requestApproval,

    preview,
    versions,
    update,
    approveUpdate: async (id, approved) => {
      await readyPromise;
      return approveUpdate(id, approved);
    },
    rollback,
    requestUpdateApproval,

    async pages() {
      await readyPromise;
      return plugins.pages();
    },

    async page(skillId, pageId) {
      await readyPromise;
      const entry = activeOf(skillId);
      const page = (entry.manifest.pages ?? []).find((item) => item.id === pageId);
      const html = page ? entry.pages[page.file] : undefined;
      if (!page || html === undefined) throw new UserError(t('plugins.page.unknown'));
      return { title: page.title, skillName: entry.manifest.name, html: pageDocument(html, { title: page.title }) };
    },

    async pageCall(skillId, pageId, toolName, input) {
      await readyPromise;
      const entry = activeOf(skillId);
      if (!(entry.manifest.pages ?? []).some((item) => item.id === pageId)) throw new UserError(t('plugins.page.unknown'));
      const now = Date.now();
      const stamps = (pageCalls.get(skillId) ?? []).filter((at) => now - at < 60_000);
      if (stamps.length >= PAGE_CALLS_PER_MINUTE) throw new UserError(t('plugins.page.tooMany'));
      stamps.push(now);
      pageCalls.set(skillId, stamps);
      const { tool, value } = validateInput(skillId, entry.manifest, toolName, input);
      // Onay isteyen araç sayfadaki bir düğmeyle çalışmaz: onay yalnız kullanıcının Jarvis'e verdiği isteğe sorulur.
      if (tool.risk === 'danger') throw new UserError(t('plugins.page.danger', { tool: toolName }));
      if (!tool.hidden) {
        // Beyne görünen araç çekirdeğin kapısından geçer (politika, günlük, girdi doğrulaması).
        const result = await ctx.tools.run(toolName, value, { origin: { channel: 'ui', speakerVerified: null } });
        return { ok: result.ok, text: result.text.slice(0, MAX_RESULT_CHARS), ...(result.data !== undefined ? { data: result.data } : {}) };
      }
      if (!ctx.policy.moduleAllowed(POLICY_ID) || ctx.policy.killSwitchActive()) throw new UserError(t('tool.error.moduleDisabled'));
      try {
        const result = await live.call(skillId, toolName, value);
        return { ok: result.ok, text: result.text.slice(0, MAX_RESULT_CHARS), ...(result.data !== undefined ? { data: result.data } : {}) };
      } catch (error) {
        return { ok: false, text: t('skills.error.threw', { name: entry.manifest.name, detail: (error as Error).message }) };
      }
    },

    async pageStorage(skillId, op, key, value) {
      await readyPromise;
      activeOf(skillId);
      const name = String(key ?? '').slice(0, 200);
      if (op === 'get') return store.storage.get(skillId, name);
      if (op === 'set') {
        try {
          store.storage.set(skillId, name, (value ?? null) as JsonValue);
        } catch (error) {
          throw new UserError((error as Error).message);
        }
        return { found: true, value: (value ?? null) as JsonValue };
      }
      return { found: store.storage.delete(skillId, name), value: null };
    },

    async settings(skillId) {
      await readyPromise;
      const record = need(skillId);
      const manifest = active.get(skillId)?.manifest ?? manifests.get(record.id);
      return manifest ? settingValues(skillId, manifest) : [];
    },

    async setSetting(skillId, key, value) {
      await readyPromise;
      const record = need(skillId);
      const manifest = active.get(skillId)?.manifest ?? manifests.get(record.id);
      const setting = (manifest?.settings ?? []).find((entry) => entry.key === key);
      if (!manifest || !setting) throw new UserError(t('plugins.setting.unknown', { key }));
      const expected = setting.type === 'number' ? 'number' : setting.type === 'boolean' ? 'boolean' : 'string';
      if (typeof value !== expected || (typeof value === 'number' && !Number.isFinite(value))) throw new UserError(t('plugins.setting.badType', { label: setting.label }));
      if (setting.type === 'select' && !(setting.options ?? []).includes(String(value))) throw new UserError(t('plugins.setting.badOption', { label: setting.label }));
      store.settings.set(skillId, key, typeof value === 'string' ? value.slice(0, 500) : value);
      ctx.bus.emit('plugins.changed', { skillId });
      return settingValues(skillId, manifest);
    },

    async activity(skillId) {
      await readyPromise;
      return plugins.activity(skillId);
    },

    async runNow(skillId, kind, id) {
      await readyPromise;
      return plugins.runNow(skillId, kind, id);
    },

    plugins,
  };
}
