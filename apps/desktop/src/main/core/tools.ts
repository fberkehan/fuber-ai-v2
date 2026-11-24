/**
 * Araç kaydı ve tek kapı (KURGU §4.1, §13). Acil durdurma, sürüm kapısı, günlük bütçe, modül izni,
 * Gizli kip, konuşmacı doğrulama ve onay kararı YALNIZ burada verilir; araçlar ve modüller bunları sormaz.
 */

import type Anthropic from '@anthropic-ai/sdk';
import {
  LIMITS,
  localDay,
  newId,
  nowIso,
  searchTerms,
  t,
  type ApprovalDecision,
  type ApprovalInput,
  type ApprovalKind,
  type ApprovalRequest,
  type AuthorityLevel,
  type AuthorityState,
  type ExternalToolDef,
  type Id,
  type JsonObject,
  type JsonValue,
  type ModuleContext,
  type Permission,
  type Risk,
  type ScopedDb,
  type ServiceDeps,
  type SettingsApi,
  type ToolCallRecord,
  type ToolContext,
  type ToolDef,
  type ToolOrigin,
  type ToolRegistry,
  type ToolResult,
  type ToolSchema,
  type Unsubscribe,
} from '@fuber/shared';
import { z } from 'zod';
import { approvalKindOf, autoApproves, capLevel, shortAsk } from './authority';

/** Kapının bir modül hakkında bilmesi gerekenler. `ToolRegistry.register` yalnız bağlam aldığı için ayrıca bildirilir. */
export interface ModuleGate {
  /** Modülün izinleri; Gizli kipte `net` isteyen modülün araçları çalışmaz. */
  permissions: Permission[];
  /** Politikada bakılacak modül kimliği. Kullanıcı yetenekleri kendi kimlikleriyle politikada yer almaz; onları Atölye yönetir. */
  policyId?: string;
}

const gates = new WeakMap<ToolRegistry, Map<string, ModuleGate>>();

/** Modül kaydı, bir modülü yüklemeden önce izinlerini kapıya bildirir; `null` bildirimi kaldırır. */
export function declareModule(tools: ToolRegistry, moduleId: string, gate: ModuleGate | null): void {
  const map = gates.get(tools);
  if (!map) return;
  if (gate) map.set(moduleId, gate);
  else map.delete(moduleId);
}

/** Kayıttaki tanımı Anthropic Messages API araç tanımına çevirir (akışlı istekte girdi parça parça gelsin diye `eager_input_streaming`). */
export function toAnthropicTool(schema: ToolSchema): Anthropic.Tool {
  return {
    name: schema.name,
    description: schema.description,
    input_schema: schema.inputSchema as Anthropic.Tool.InputSchema,
    eager_input_streaming: true,
  };
}

// Katlanmış (küçük harf, Türkçe harfler ASCII) sözcükler. Ret önekleri olumsuz çekimleri kapsar:
// "yapm" → "yapma", "yapmayın", "yapmıyorum"; "onaylam" → "onaylamıyorum", "onaylamam".
/** Günlüğe yazılan neden en çok bu kadar karakterdir. */
const FAILURE_LOG_MAX = 160;

/**
 * Yapılmayan araç adımının günlük satırındaki kısa neden: aracın kendi hata cümlesinin ilk satırı, en çok 160 karakter.
 * Tırnak içindeki her şey (aranan metin, yazılacak metin, pencere başlığı, pano) "…" olur: kullanıcının yazdığı ya da
 * ekrandan okunan içerik günlüğe girmez, yalnız aracın cümlesi kalır. E-posta ve uzun sayı dizileri de silinir.
 */
export function failureLogReason(text: string): string {
  const line = (text ?? '').split(/\r?\n/).find((item) => item.trim().length > 0)?.trim() ?? '';
  const clean = line
    .replace(/“[^”]*”|"[^"]*"|«[^»]*»|‘[^’]*’|`[^`]*`/g, '…')
    // Tek tırnak yalnız sözcük başında açılıp sözcük sonunda kapanırsa tırnaktır ("Ahmet'e" kesme işaretidir).
    .replace(/(^|\s)'[^']+'(?=\s|[.,:;!?]|$)/g, '$1…')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '…')
    .replace(/\d[\d\s-]{7,}\d/g, '…')
    .replace(/\s+/g, ' ');
  if (!clean) return '(neden yok)';
  return clean.length > FAILURE_LOG_MAX ? `${clean.slice(0, FAILURE_LOG_MAX - 1)}…` : clean;
}

const DENY_WORDS = new Set(['hayir', 'olmaz', 'istemiyorum', 'dur', 'sus', 'yeter', 'bosver', 'kalsin']);
const DENY_PREFIXES = ['yapm', 'vazgec', 'onaylam', 'iptal'];
// Kabul bilinçli olarak dardır: `danger` bir iş ancak açık bir onay sözüyle çalışır. Gündelik "tamam",
// "olur", "yap" tek başına onay değildir (başka bir şeye verilmiş yanıt olabilir).
const APPROVE_STRONG = new Set(['onayliyorum', 'onayla', 'onaylarim', 'onayliyoruz']);
// Onay sözünün yanında durabilen sözcükler; bunların dışında tek bir sözcük bile varsa söz `unclear` kalır.
const APPROVE_COMPANIONS = new Set([
  'evet', 'tamam', 'lutfen', 'eminim', 'kesinlikle', 'bunu', 'islemi', 'yap', 'et', 'devam', 'kabul', 'ediyorum',
]);
const MAX_SPEECH_WORDS = 6;
const MAX_APPROVE_WORDS = 4;
/**
 * Soru sesli turun içinde doğrudan sorulduysa ("Göndereyim mi?") gündelik kabul sözleri de onaydır: kullanıcı o an
 * yalnız bu soruya yanıt veriyordur. Kimliği bilinmeyen (başka yerde bekleyen) onayda dar kural geçerlidir.
 */
const APPROVE_ASKED = new Set([
  'evet', 'tamam', 'olur', 'yap', 'yapabilirsin', 'gonder', 'gonderebilirsin', 'sil', 'silebilirsin', 'devam', 'tabii', 'tabi', 'elbette',
  'aynen', 'peki', 'kabul', 'onay', 'bas', 'calistir', 'kapat', 'ac', 'hadi',
]);
const ASKED_COMPANIONS = new Set(['et', 'ediyorum', 'lutfen', 'eminim', 'kesinlikle', 'bunu', 'islemi', 'ki', 'canim', 'efendim', 'hemen', 'simdi']);
/** Doğrudan sorulan soruya ret: "gönderme", "silme", "bekle", "gerek yok". */
const DENY_ASKED = /^(gonderme|silme|kapatma|basma|calistirma|bekle|istemem|gerek)/;
/** "Sormadan devam et", "bu iş boyunca sorma", "hepsine evet", "bir daha sorma": onay + iş boyunca Tam yetki. */
const TASK_SCOPE = /\bsormadan\b|\bsorma\b|hepsine (evet|tamam|onay)|hepsini (onayla|yap)|her seye evet/;
const TASK_SCOPE_NOT = /\bsor\b|sorarak|soracak/;

/** Söz "bu iş boyunca sorma" anlamı taşıyor mu (onayla birlikte işe bağlı Tam yetki verilir). */
export function approvalSpeechScope(text: string): 'task' | null {
  const folded = searchTerms(text).join(' ');
  return TASK_SCOPE.test(folded) && !TASK_SCOPE_NOT.test(folded) ? 'task' : null;
}

/**
 * Onay beklenirken söylenen sözü yorumlar. Ret, kabulden önce gelir ("tamam, vazgeç" → ret). Kabul yalnız kısa
 * ve yalın sözdür: ya açık onay sözcüğü ("onaylıyorum", "onayla", "kabul ediyorum") ya da baştaki "evet";
 * yanında yalnız `APPROVE_COMPANIONS` durabilir. Uzun cümlenin içinde geçen "evet" onay sayılmaz; belirsiz
 * her söz `unclear` döner: `danger` araç yanlış anlaşılan bir cümleyle çalışmamalı.
 */
export function interpretApprovalSpeech(text: string, opts: { asked?: boolean } = {}): 'approved' | 'denied' | 'unclear' {
  const words = searchTerms(text);
  if (words.length === 0 || words.length > MAX_SPEECH_WORDS) return 'unclear';
  // "Sormadan devam et": "sorma" bir ret değildir; iş boyunca onaydır.
  if (approvalSpeechScope(text) === 'task') return 'approved';
  if (words.some((word) => DENY_WORDS.has(word) || DENY_PREFIXES.some((prefix) => word.startsWith(prefix)))) return 'denied';
  if (opts.asked && words.some((word) => DENY_ASKED.test(word))) return 'denied';
  if (words.length > MAX_APPROVE_WORDS) return 'unclear';
  if (opts.asked) {
    // Doğrudan sorulan soruya kısa ve yalın kabul: "evet", "tamam", "yap", "olur", "tamam gönder", "evet yap".
    const known = words.every((word) => APPROVE_ASKED.has(word) || APPROVE_STRONG.has(word) || APPROVE_COMPANIONS.has(word) || ASKED_COMPANIONS.has(word));
    if (known && words.some((word) => APPROVE_ASKED.has(word) || APPROVE_STRONG.has(word))) return 'approved';
  }
  if (!words.every((word) => APPROVE_STRONG.has(word) || APPROVE_COMPANIONS.has(word))) return 'unclear';
  const strong = words.some((word) => APPROVE_STRONG.has(word));
  const acceptPhrase = words.join(' ').includes('kabul ediyorum');
  if (strong || acceptPhrase || words[0] === 'evet') return 'approved';
  return 'unclear';
}

interface Entry {
  name: string;
  description: string;
  risk: Risk;
  moduleId: string;
  /** Aracın tanımında bildirdiği küme (`ToolDef.group`); yerel beyin tura göre araç seçerken okur. */
  group?: string;
  context: ModuleContext;
  inputSchema: JsonObject;
  validator: z.ZodType;
  approvalText?(input: unknown): string;
  /** Onayın türü (`ToolDef.approvalKind`); yoksa araç adından bulunur. */
  approvalKind?: ApprovalKind;
  contextHint?(): string | null;
  refuse?(input: unknown): string | null;
  run(input: unknown, ctx: ToolContext): Promise<ToolResult>;
}

interface PendingApproval {
  request: ApprovalRequest;
  settle(decision: ApprovalDecision, by: 'voice' | 'ui' | 'timeout' | 'system'): void;
}

/**
 * Aynı şey iki kez sorulmaz: kullanıcının reddettiği iş AYNI TURDA yeniden istenirse (model ısrar ediyor) sorulmadan
 * yine reddedilir. Turu bilen çağrıda (kapının `danger` sorusu) ölçü turun iptal imidir; turu bilmeyen çağrıda
 * (aracın kendi içinden istediği onay) bu kısa süredir. Kullanıcının sonradan kendisinin yeniden istemesi (yeni tur,
 * birkaç saniye sonra) engellenmez.
 */
const DENY_MEMORY_MS = 10_000;
/** İşe bağlı Tam yetki ("bu iş boyunca sorma") en çok bu kadar sürer; sesli sohbet boşa dönünce daha erken kalkar. */
const TASK_GRANT_MAX_MS = 20 * 60_000;
const MAX_GRANT_MINUTES = 12 * 60;

const TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;
const MAX_LOGGED_TEXT = 4000;
const MAX_LOG_ROWS = 5000;

const MIGRATIONS = [
  {
    id: 1,
    name: 'araç çağrı günlüğü',
    up: `CREATE TABLE tools_calls (
      call_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      module_id TEXT NOT NULL,
      risk TEXT NOT NULL,
      origin TEXT NOT NULL,
      input TEXT NOT NULL,
      ok INTEGER NOT NULL,
      text TEXT NOT NULL,
      started_at TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      approval TEXT
    );
    CREATE INDEX tools_calls_started ON tools_calls (started_at DESC);`,
  },
];

function toJson(value: unknown): JsonValue {
  try {
    return (JSON.parse(JSON.stringify(value ?? null)) ?? null) as JsonValue;
  } catch {
    return null;
  }
}

function describeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((issue) => (issue.path.length > 0 ? `${issue.path.map(String).join('.')}: ${issue.message}` : issue.message))
    .join('; ');
}

/**
 * `settings`: yetki düzeyinin kaynağı (`Settings.authorityLevel`). Bileşim kökü verir; verilmezse (eski sınama
 * düzenekleri) her şey sorulur.
 */
export function createTools(deps: ServiceDeps['tools'] & { settings?: SettingsApi }): ToolRegistry {
  const { policy, bus, stage } = deps;
  const log = deps.log.child('tools');
  const entries = new Map<string, Entry>();
  const moduleGates = new Map<string, ModuleGate>();
  const running = new Map<Id, AbortController>();
  const pending = new Map<Id, PendingApproval>();

  // Bütçe durumu kullanım servisinin yayınladığı günlük özetten izlenir (bu servis `usage`'a bağlı değildir).
  let budget: { day: string; over: boolean } | null = null;
  bus.on('usage.recorded', ({ today }) => {
    budget = { day: today.day, over: today.overBudget };
  });
  const overBudget = () => budget !== null && budget.over && budget.day === localDay();

  let database: ScopedDb | null = null;
  const db = (): ScopedDb => {
    if (!database) {
      deps.store.migrate('tools', MIGRATIONS);
      database = deps.store.scoped('tools');
      database.run(
        'DELETE FROM tools_calls WHERE call_id NOT IN (SELECT call_id FROM tools_calls ORDER BY started_at DESC LIMIT ?)',
        [MAX_LOG_ROWS],
      );
    }
    return database;
  };

  /** Kapı: araç şu an bu kökenden çalışabilir mi. Çalışamazsa nedeni (Türkçe). */
  const refusal = (entry: Entry, origin: ToolOrigin): string | null => {
    if (policy.killSwitchActive()) return t('tool.error.killSwitch');
    if (policy.updateRequired()) return t('tool.error.updateRequired');
    // Bütçe aşılınca yalnız sesli asistan ve kullanıcının arayüzden doğrudan başlattığı iş sürer.
    if (overBudget() && origin.channel !== 'voice' && origin.channel !== 'ui') return t('tool.error.budget');
    const gate = moduleGates.get(entry.moduleId);
    if (!policy.moduleAllowed(gate?.policyId ?? entry.moduleId)) return t('tool.error.moduleDisabled');
    if (!policy.networkAllowed() && gate?.permissions.includes('net')) return t('tool.error.private');
    return null;
  };

  const add = (entry: Entry): Unsubscribe => {
    if (!TOOL_NAME.test(entry.name)) throw new Error(`geçersiz araç adı: ${entry.name}`);
    if (entries.has(entry.name)) throw new Error(`araç adı zaten kayıtlı: ${entry.name}`);
    if (entry.inputSchema.type !== 'object') throw new Error(`araç girdisi nesne şeması olmalı: ${entry.name}`);
    entries.set(entry.name, entry);
    return () => {
      if (entries.get(entry.name) === entry) entries.delete(entry.name);
    };
  };

  const record = (row: ToolCallRecord) => {
    try {
      db().run(
        `INSERT OR REPLACE INTO tools_calls (call_id, name, module_id, risk, origin, input, ok, text, started_at, duration_ms, approval)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.callId,
          row.name,
          row.moduleId,
          row.risk,
          JSON.stringify(row.origin),
          JSON.stringify(row.input).slice(0, MAX_LOGGED_TEXT),
          row.ok ? 1 : 0,
          row.text.slice(0, MAX_LOGGED_TEXT),
          row.startedAt,
          row.durationMs,
          row.approval,
        ],
      );
    } catch (error) {
      log.warn('araç çağrısı günlüğe yazılamadı', error);
    }
  };

  // ── yetki düzeyi (`authority.ts`) ──
  /** Geçici yükseltme: süreli ya da işe bağlı Tam yetki. Bellektedir; uygulama yeniden açılınca kalkar (güvenli taraf). */
  let grant: { scope: 'time' | 'task'; until: number } | null = null;
  let grantTimer: ReturnType<typeof setTimeout> | null = null;
  const maxLevel = (): AuthorityLevel => {
    try {
      return policy.get().limits.maxAuthority ?? 'full';
    } catch {
      return 'full';
    }
  };
  // Ayar servisi verilmediyse (eski sınama düzenekleri) her şey sorulur.
  const baseLevel = (): AuthorityLevel => deps.settings?.get().authorityLevel ?? 'ask';
  const authority = (): AuthorityState => {
    if (grant && grant.until <= Date.now()) grant = null;
    const max = maxLevel();
    const base = baseLevel();
    return {
      level: capLevel(grant ? 'full' : base, max),
      base,
      max,
      grant: grant ? { scope: grant.scope, until: new Date(grant.until).toISOString() } : null,
    };
  };
  let lastAuthority = '';
  const announceAuthority = () => {
    const state = authority();
    const key = `${state.level}|${state.base}|${state.max}|${state.grant?.scope ?? ''}|${state.grant?.until ?? ''}`;
    if (key === lastAuthority) return;
    lastAuthority = key;
    bus.emit('authority.changed', state);
  };
  const setGrant = (next: typeof grant) => {
    if (grantTimer) clearTimeout(grantTimer);
    grantTimer = null;
    grant = next;
    if (next) {
      grantTimer = setTimeout(() => {
        grant = null;
        grantTimer = null;
        log.info('geçici Tam yetki süresi doldu');
        announceAuthority();
      }, Math.max(0, next.until - Date.now()));
      grantTimer.unref?.();
    }
    announceAuthority();
  };
  const grantAuthority = (request: { minutes: number } | { task: true } | null): boolean => {
    if (request === null) {
      setGrant(null);
      return true;
    }
    if (maxLevel() !== 'full') return false;
    if ('task' in request) setGrant({ scope: 'task', until: Date.now() + TASK_GRANT_MAX_MS });
    else setGrant({ scope: 'time', until: Date.now() + Math.min(MAX_GRANT_MINUTES, Math.max(1, request.minutes)) * 60_000 });
    log.info(`geçici Tam yetki verildi (${'task' in request ? 'bu iş boyunca' : `${request.minutes} dk`})`);
    return true;
  };
  bus.on('settings.changed', ({ changedKeys }) => {
    if (changedKeys.includes('authorityLevel')) announceAuthority();
  });
  // Acil durdurma geçici yükseltmeyi de kaldırır: "dur" dedikten sonra iş sormadan sürmesin.
  bus.on('app.panic', () => setGrant(null));

  /** Kullanıcının az önce reddettiği işler (araç + özet): yeniden sorulmaz. */
  const recentDenials = new Map<string, number>();
  /** Tur başına (turun iptal imi) reddedilen işler. */
  const turnDenials = new WeakMap<AbortSignal, Set<string>>();
  const denialKey = (input: ApprovalInput) => `${input.origin.channel}|${input.toolName}|${input.summary}`;

  /** `turn`: turun iptal imi (kapının sorusu); `null` tur bilinmiyor (ret belleği yok); verilmezse aracın kendi isteğidir (kısa süreli bellek). */
  const ask = (input: ApprovalInput, risk: Risk, signal?: AbortSignal, turn?: AbortSignal | null): Promise<ApprovalDecision> => {
    if (policy.killSwitchActive() || signal?.aborted) return Promise.resolve('denied');
    const kind: ApprovalKind = approvalKindOf(input.toolName, input.kind);
    // Yetki düzeyi: bu tür bu düzeyde sorulmuyorsa kart çıkmaz, soru sorulmaz; karar günlüğe yazılır.
    // Yetki kullanıcının O AN yürüttüğü iş içindir (sesli tur, yazılı sohbet, arayüz): arka plan işi (`job`) ve
    // kullanıcı yeteneği (`skill`) kullanıcı başında değilken çalışır; onlar her düzeyde eskisi gibi sorar.
    const interactive = input.origin.channel !== 'job' && input.origin.channel !== 'skill';
    const level = interactive ? authority().level : 'ask';
    if (autoApproves(level, kind)) {
      log.info(`${input.toolName}: auto-approved(${level}) [${kind}]`);
      bus.emit('tool.approval.auto', { toolName: input.toolName, moduleId: input.moduleId, kind, level, summary: input.summary, origin: input.origin });
      return Promise.resolve('approved');
    }
    // Aynı şey iki kez sorulmaz: az önce reddedilen iş yeniden istenirse yine reddedilir (model ısrar edemez).
    const key = denialKey(input);
    if (turn) {
      if (turnDenials.get(turn)?.has(key)) {
        log.info(`${input.toolName}: bu turda reddedildi; yeniden sorulmadı`);
        return Promise.resolve('denied');
      }
    } else if (turn === undefined) {
      const deniedAt = recentDenials.get(key);
      if (deniedAt !== undefined) {
        if (Date.now() - deniedAt < DENY_MEMORY_MS) {
          log.info(`${input.toolName}: az önce reddedildi; yeniden sorulmadı`);
          return Promise.resolve('denied');
        }
        recentDenials.delete(key);
      }
    }
    const timeoutMs = input.timeoutMs ?? LIMITS.approvalTimeoutMs;
    const now = Date.now();
    const request: ApprovalRequest = {
      id: newId(),
      toolName: input.toolName,
      moduleId: input.moduleId,
      risk,
      summary: input.summary,
      input: input.input,
      origin: input.origin,
      requestedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + timeoutMs).toISOString(),
      kind,
      ask: input.ask ?? shortAsk(kind, input.summary),
    };
    return new Promise((resolve) => {
      const onAbort = () => entry.settle('denied', 'system');
      const timer = setTimeout(() => entry.settle('expired', 'timeout'), timeoutMs);
      const entry: PendingApproval = {
        request,
        settle(decision, by) {
          if (!pending.delete(request.id)) return;
          if (decision === 'denied' && (by === 'voice' || by === 'ui')) {
            if (turn) {
              const set = turnDenials.get(turn) ?? new Set<string>();
              set.add(key);
              turnDenials.set(turn, set);
            } else if (turn === undefined) {
              recentDenials.set(key, Date.now());
              if (recentDenials.size > 50) recentDenials.delete(recentDenials.keys().next().value as string);
            }
          }
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          bus.emit('tool.approval.resolve', { id: request.id, decision, by });
          resolve(decision);
        },
      };
      pending.set(request.id, entry);
      signal?.addEventListener('abort', onAbort, { once: true });
      bus.emit('tool.approval.request', request);
    });
  };

  const cancelAll = () => {
    for (const controller of [...running.values()]) controller.abort();
    for (const approval of [...pending.values()]) approval.settle('denied', 'system');
  };

  bus.on('app.panic', cancelAll);
  bus.on('policy.changed', () => {
    if (policy.killSwitchActive() || policy.updateRequired()) cancelAll();
  });

  const registry: ToolRegistry = {
    register(context, tools) {
      const removers: Unsubscribe[] = [];
      try {
        for (const tool of tools) {
          const { $schema: _draft, ...inputSchema } = z.toJSONSchema(tool.input, {
            io: 'input',
            unrepresentable: 'any',
          }) as JsonObject;
          removers.push(
            add({
              name: tool.name,
              description: tool.description,
              risk: tool.risk,
              moduleId: context.moduleId,
              ...(tool.group ? { group: tool.group } : {}),
              context,
              inputSchema,
              validator: tool.input,
              approvalText: tool.approvalText,
              ...(tool.approvalKind ? { approvalKind: tool.approvalKind } : {}),
              ...(tool.contextHint ? { contextHint: tool.contextHint } : {}),
              ...(tool.refuse ? { refuse: tool.refuse } : {}),
              run: tool.run,
            }),
          );
        }
      } catch (error) {
        // Yarım kayıt bırakılmaz: ya modülün bütün araçları girer ya hiçbiri.
        for (const remove of removers) remove();
        throw error;
      }
      return () => {
        for (const remove of removers) remove();
      };
    },

    registerExternal(context, tool: ExternalToolDef) {
      if (tool.inputSchema.type !== 'object') throw new Error(`araç girdisi nesne şeması olmalı: ${tool.name}`);
      let validator: z.ZodType;
      try {
        validator = z.fromJSONSchema(tool.inputSchema as Parameters<typeof z.fromJSONSchema>[0]);
      } catch (error) {
        throw new Error(`araç şeması okunamadı: ${tool.name}: ${(error as Error).message}`);
      }
      return add({
        name: tool.name,
        description: tool.description,
        risk: tool.risk,
        moduleId: context.moduleId,
        ...(tool.group ? { group: tool.group } : {}),
        context,
        inputSchema: tool.inputSchema,
        validator,
        approvalText: tool.approvalText,
        ...(tool.refuse ? { refuse: tool.refuse } : {}),
        run: tool.run,
      });
    },

    unregister: (name) => entries.delete(name),

    unregisterModule(moduleId) {
      for (const [name, entry] of [...entries]) {
        if (entry.moduleId === moduleId) entries.delete(name);
      }
    },

    list: () =>
      [...entries.values()].map(({ name, description, risk, moduleId, group }) => ({ name, description, risk, moduleId, ...(group ? { group } : {}) })),
    has: (name) => entries.has(name),

    contextHints(names) {
      const hints: string[] = [];
      for (const name of names) {
        try {
          const hint = entries.get(name)?.contextHint?.();
          if (hint) hints.push(hint);
        } catch {
          // İpucu veremeyen araç turu durdurmaz.
        }
      }
      return hints;
    },

    schemas(names) {
      const selected = names ? names.map((name) => entries.get(name)).filter((entry) => entry !== undefined) : [...entries.values()];
      return selected.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
    },

    async run(name, input, options) {
      const entry = entries.get(name);
      if (!entry) return { ok: false, text: t('tool.error.unknown', { name }) };

      const callId = options.callId ?? newId();
      const startedAt = nowIso();
      const began = Date.now();
      const base = { callId, name, moduleId: entry.moduleId, risk: entry.risk, origin: options.origin };
      let logged: JsonValue = toJson(input);
      let approval: ApprovalDecision | null = null;
      bus.emit('tool.call', { ...base, phase: 'start' });

      const finish = (result: ToolResult): ToolResult => {
        const durationMs = Date.now() - began;
        record({ ...base, input: logged, ok: result.ok, text: result.text, startedAt, durationMs, approval });
        bus.emit('tool.call', { ...base, phase: 'end', ok: result.ok, durationMs });
        // Yapılmayan adımın NEDENİ de yazılır (okuyan araçlarınki dahil; demo.5: "pc_click → yapılmadı" neden yazmıyordu).
        // Çok adımlı araç (pc_do) asıl nedeni `data.logReason` ile verir: ilk satırı "N adımdan M'si yapıldı" der.
        const logReason = (result.data as { logReason?: unknown } | undefined)?.logReason;
        if (!result.ok) log.info(`${name} (${entry.risk}) → yapılmadı (${durationMs} ms): ${failureLogReason(typeof logReason === 'string' ? logReason : result.text)}`);
        else if (entry.risk !== 'read') log.info(`${name} (${entry.risk}) → tamam (${durationMs} ms)`);
        return result;
      };

      const closed = refusal(entry, options.origin);
      if (closed) return finish({ ok: false, text: closed });

      const parsed = entry.validator.safeParse(input);
      if (!parsed.success) {
        return finish({ ok: false, text: t('tool.error.invalidInput', { detail: describeIssues(parsed.error) }) });
      }
      const value: unknown = parsed.data;
      logged = toJson(value);

      // Tanınmayan ses uyandırsa bile yalnız okuyan araçlar çalışır (KURGU §13).
      if (entry.risk !== 'read' && options.origin.speakerVerified === false) {
        return finish({ ok: false, text: t('tool.error.speaker') });
      }

      // Hiçbir koşulda çalıştırılmayacak girdi için onay kartı çıkmaz: aracın ret denetimi onaydan ÖNCE koşar.
      if (entry.refuse) {
        let refused: string | null = null;
        try {
          refused = entry.refuse(value);
        } catch (error) {
          log.warn(`${name}: ret denetimi hata verdi`, error);
        }
        if (refused) return finish({ ok: false, text: refused });
      }

      const controller = new AbortController();
      const forward = () => controller.abort();
      if (options.signal?.aborted) controller.abort();
      else options.signal?.addEventListener('abort', forward, { once: true });
      running.set(callId, controller);

      try {
        if (entry.risk === 'danger') {
          let summary = entry.description;
          try {
            summary = entry.approvalText?.(value) ?? entry.description;
          } catch (error) {
            log.warn(`${name}: onay metni üretilemedi`, error);
          }
          approval = await ask(
            { toolName: name, moduleId: entry.moduleId, summary, input: logged, origin: options.origin, ...(entry.approvalKind ? { kind: entry.approvalKind } : {}) },
            entry.risk,
            controller.signal,
            options.signal ?? null,
          );
          if (approval === 'expired') return finish({ ok: false, text: t('tool.error.expired') });
          if (approval !== 'approved') {
            return finish({ ok: false, text: controller.signal.aborted ? t('tool.error.aborted') : t('tool.error.denied') });
          }
          // Onay beklenirken kapı kapanmış olabilir (acil durdurma, modülün kapatılması).
          const closedNow = refusal(entry, options.origin);
          if (closedNow) return finish({ ok: false, text: closedNow });
        }
        if (controller.signal.aborted) return finish({ ok: false, text: t('tool.error.aborted') });

        // Aracın kendi içinden istediği onay da TURA bağlanır (turun iptal imi varsa): reddedilen iş aynı turda yeniden
        // sorulmaz, kullanıcının YENİ bir turda yeniden istemesi sorulur. Önceden 10 sn'lik süre belleği uygulanıyordu:
        // "Ekranımı okuma iznini aç" → reddet → hemen yeniden iste → kart çıkmadan "yapılmadı" (k2 konus, demo.4).
        const turnSignal = options.signal;
        const ctx: ToolContext = {
          ...entry.context,
          ...(turnSignal ? { tools: { ...entry.context.tools, requestApproval: (input: ApprovalInput) => ask(input, 'danger', undefined, turnSignal) } } : {}),
          callId,
          origin: options.origin,
          signal: controller.signal,
          report(step) {
            try {
              options.onReport?.(step);
            } catch (error) {
              log.warn(`${name}: ara durum bildirimi hata verdi`, error);
            }
          },
        };
        // Araç iptali dinlemese de çağıran beklemez: iptalde sonuç hemen "yarıda kesildi" olur.
        const aborted = new Promise<ToolResult>((resolve) => {
          controller.signal.addEventListener('abort', () => resolve({ ok: false, text: t('tool.error.aborted') }), {
            once: true,
          });
        });
        const work = Promise.resolve()
          .then(() => entry.run(value, ctx))
          .then(
            (result): ToolResult =>
              result && typeof result.ok === 'boolean' && typeof result.text === 'string'
                ? result
                : { ok: false, text: t('tool.error.failed', { detail: t('tool.error.badResult') }) },
            (error: unknown): ToolResult => {
              // İptal edilen araç (söz kesme, "dur", yeni söz, acil durdurma) hata DEĞİLDİR: günlüğe ERROR düşmez.
              if (controller.signal.aborted) {
                log.info(`${name} iptal edildi`);
                return { ok: false, text: t('tool.error.aborted') };
              }
              log.error(`${name} hata verdi`, error);
              return { ok: false, text: t('tool.error.failed', { detail: (error as Error)?.message ?? String(error) }) };
            },
          );
        const result = await Promise.race([work, aborted]);

        if (result.ok && result.show) {
          try {
            stage.showCard(entry.moduleId, result.show);
          } catch (error) {
            log.warn(`${name}: sonuç sahnede gösterilemedi`, error);
          }
        }
        return finish(result);
      } finally {
        running.delete(callId);
        options.signal?.removeEventListener('abort', forward);
      }
    },

    requestApproval: (input) => ask(input, 'danger'),

    resolveApproval(id, decision, by, opts) {
      const approval = pending.get(id);
      if (!approval) return false;
      // "Bu iş boyunca sorma": onayla birlikte işe bağlı Tam yetki. Yükseltmeyi soran onayın kendisi bununla genişletilmez.
      if (decision === 'approved' && opts?.scope === 'task' && approval.request.kind !== 'authority' && approval.request.kind !== 'permission') {
        grantAuthority({ task: true });
      }
      approval.settle(decision, by);
      return true;
    },

    authority,
    grantAuthority,
    endTask() {
      if (grant?.scope === 'task') {
        log.info('iş bitti: işe bağlı Tam yetki kaldırıldı');
        setGrant(null);
      }
    },

    resolveApprovalFromSpeech(text, opts) {
      // Söz yalnız sorulan onaya aittir: kimlik verildiyse o onay, verilmediyse yalnız TEK bekleyen onay
      // sonuçlandırılır. Birden çok onay bekliyorsa hangisine "evet" denildiği bilinemez: `unclear`.
      const target = opts?.approvalId !== undefined ? pending.get(opts.approvalId) : pending.size === 1 ? pending.values().next().value : undefined;
      if (!target) return 'unclear';
      const verdict = interpretApprovalSpeech(text, { asked: opts?.asked === true });
      if (verdict === 'approved' && approvalSpeechScope(text) === 'task' && target.request.kind !== 'authority' && target.request.kind !== 'permission') {
        grantAuthority({ task: true });
      }
      if (verdict !== 'unclear') target.settle(verdict, 'voice');
      return verdict;
    },

    pendingApprovals: () => [...pending.values()].map((approval) => approval.request),

    recentCalls(limit) {
      const rows = db().all<{
        call_id: string;
        name: string;
        module_id: string;
        risk: Risk;
        origin: string;
        input: string;
        ok: number;
        text: string;
        started_at: string;
        duration_ms: number;
        approval: ApprovalDecision | null;
      }>('SELECT * FROM tools_calls ORDER BY started_at DESC, call_id DESC LIMIT ?', [Math.max(0, Math.floor(limit))]);
      return rows.map((row) => {
        let input: JsonValue = null;
        try {
          input = JSON.parse(row.input) as JsonValue;
        } catch {
          // günlükte kısaltılmış girdi: düz yazı olarak kalır
          input = row.input;
        }
        return {
          callId: row.call_id,
          name: row.name,
          moduleId: row.module_id,
          risk: row.risk,
          origin: JSON.parse(row.origin) as ToolOrigin,
          input,
          ok: row.ok === 1,
          text: row.text,
          startedAt: row.started_at,
          durationMs: row.duration_ms,
          approval: row.approval,
        };
      });
    },

    cancelAll,
  };

  gates.set(registry, moduleGates);
  return registry;
}
