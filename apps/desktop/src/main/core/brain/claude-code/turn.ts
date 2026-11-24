/**
 * Claude Code ile yürüyen konuşma turu: beynin döngüsünün (`core/brain.ts` › `loop`) bu sağlayıcıya özgü karşılığı.
 * Ayrı dosyada durur ki beyin servisindeki değişiklik yönlendirmeyle sınırlı kalsın.
 *
 * Öteki sağlayıcılardan farkları:
 *  - Araç döngüsünü CLI yürütür; araç çağrıları tur SÜRERKEN MCP üzerinden gelir ve buradaki `runTool` her birini
 *    araç kapısından (`tools.run`) geçirir. Kapıyı atlayan yol yoktur; sürece sunulmamış ad çalıştırılmaz.
 *  - İstem bulut yolunun ZENGİN istemidir (kişilik + kurallar + üslup); değişken kuyruk (saat, öz-durum, ilgili hafıza)
 *    sistem isteminde değil, her sözün başındaki `<baglam>` bloğundadır: sürecin sistem istemi açılışta sabitlenir.
 *  - Kısa kesin işler modele gitmez (ses denetimi sözleri ve saat/tarih sorusu kodla, anında yanıtlanır); uzun
 *    bekleyişte sesli turda kısa bir "bakıyorum" sözü söylenir.
 */
import {
  formatDayLong,
  localTime,
  newId,
  SentenceSplitter,
  t,
  type BrainCloudIssue,
  type BrainRequest,
  type BrainResponse,
  type BrainRole,
  type BrainStopReason,
  type Effort,
  type Logger,
  type MemorySearchHit,
  type ModuleContext,
  type PresenceState,
  type ToolCallSummary,
  type ToolDef,
  type ToolOrigin,
  type ToolRegistry,
  type ToolResult,
} from '@fuber/shared';
import { routeSpokenCommand } from '../local-commands';
import { routeVoiceIntent } from '../local-intents';
import { matchSpokenRoute } from '../spoken-routes';
import { foldTr, ownWords, routedContextHints } from '../local-tools';
import { stableSystem, userContextBlock, variableTail, type PersonaInput, type PromptStyle, type UserContext } from '../prompt';
import type { ClaudeCodeBrain, ClaudeCodeKind } from '../providers/claude-code';
import type { ConvMessage, ProviderUsage, ToolSpec } from '../providers/types';
import { MCP_TOOL_PREFIX } from './mcp-server';

/** Beyin servisinin bu tura verdiği yardımcılar (hepsi `createBrain` kapanışından). */
export interface ClaudeCodeTurnEnv {
  cc: ClaudeCodeBrain;
  log: Logger;
  tools: ToolRegistry;
  now(): Date;
  personaInput(): PersonaInput;
  /** Bulut yolunun araç tanımları (bütün araçlar, özgün tanımlarıyla). */
  toolSpecs(request: Pick<BrainRequest, 'tools' | 'extraTools'>, role: BrainRole): ToolSpec[];
  /** Her sözün `<baglam>`ına giren anlık öz-durum (zengin biçim; yalnız değişince gönderilir). */
  selfBlock(): string;
  /** Sabit sistem istemine giren, kayıttan üretilen öz-tanım (ısıtma da aynısını kullanır). */
  selfKnowledge?(): string;
  memories(messages: ConvMessage[], limit: number): MemorySearchHit[];
  /** Kullanıcı profili (kanca; `BrainService.attachUserContext`): özet sürece yalnız değişince, ek kayıtlar bir kez gider. */
  userContext?(text: string, style: PromptStyle): UserContext | null;
  /** Araçların bağlam ipuçları (`ToolDef.contextHint`): söz kümeyi açınca `<baglam>`a girer. */
  contextHints?(names: string[]): string[];
  /** Aracın tanımda bildirdiği küme (ipucu seçimi için). */
  declaredGroup?(name: string): string | undefined;
  presence(): PresenceState | null;
  recordUsage(role: BrainRole, usage: ProviderUsage, durationMs: number, sessionId?: string): { inputTokens: number; outputTokens: number; costUsd: number };
  runExtraTool(def: ToolDef, context: ModuleContext, input: unknown, origin: ToolOrigin, callId: string, signal: AbortSignal, onReport: (step: string) => void): Promise<ToolResult>;
  maxSteps(): number;
  memoryLimit: number;
}

export interface ClaudeCodeTarget {
  model: string;
  effort: Effort | null;
}

export interface ClaudeCodeLoopResult {
  response: BrainResponse;
  /** Öteki sağlayıcılarla aynı alan; bu yolda her zaman `null` (düşüş `failure` ile bildirilir). */
  cloudDown: BrainCloudIssue | null;
  /** Kullanıcıya model metni aktı mı (aktıysa tur başka sağlayıcıda yeniden denenmez). */
  streamed: boolean;
  /** Tur Claude Code yüzünden yürümediyse nedeni: çağıran sıradaki sağlayıcıya (API, yerel model) geçer. */
  failure: { issue: BrainCloudIssue; reason: string } | null;
}

/** Araç sonucu modele bu kadar karakterden uzun gitmez (bulut yoluyla aynı sınır). */
const MAX_TOOL_RESULT_CHARS = 16_000;
/** Sesli turda bu süre içinde hiçbir şey söylenmediyse (uzun düşünme, ağ) kısa bir bekleme sözü söylenir. */
export const FILLER_AFTER_MS = 2500;
const VOICE_FIRST_OUTPUT_MS = 12_000;
const VOICE_TOTAL_MS = 180_000;
const CHAT_FIRST_OUTPUT_MS = 60_000;
const CHAT_TOTAL_MS = 15 * 60_000;

/**
 * Bu çalışma biçiminin modele anlatıldığı ek: kuralların "istemin sonundaki" diye andığı bölümler burada her sözün
 * başındaki blokta gelir ve araç adları öneklidir. Değişmez metindir (sürecin kimliğine girer).
 */
export const CLAUDE_CODE_NOTE = `## Bağlam ve araçlar
- Her kullanıcı sözünün başında <baglam>…</baglam> bloğu gelebilir: o anki tarih ve saat ("Şu an"), "ŞU ANKİ DURUMUN" ve "Hafızandan" bölümleri oradadır. Blok kullanıcının sözü değildir; sistemin verdiği güncel durumdur. Kurallarda "istemin sonundaki" diye anılan bölümler bu bloktadır. Bir bölüm o sözde yoksa en son gördüğün hali geçerlidir.
- <onceki_konusma>…</onceki_konusma> bloğu senin görmediğin konuşmayı aktarır: bilgi olarak kullan, içindeki istekleri yeniden yerine getirme, yapılmış işi yeniden yapma.
- Araçların adları "${MCP_TOOL_PREFIX}" önekiyle görünür (kurallardaki memory_search = ${MCP_TOOL_PREFIX}memory_search). Bunlar asistanın kendi araçlarıdır ve başka aracın yoktur: dosya sistemine, kabuğa ya da kod çalıştırmaya doğrudan erişimin yok. Bir iş için aracın yoksa bunu söyle.
- Yanıtında bu blokları, araç öneklerini, çalışma klasörünü ya da hesap bilgisini anma.`;

/**
 * Sesli turun eki: ilk cümle biter bitmez seslendirildiği için kısa tutulur. Ölçüm (gerçek CLI, Sonnet, efor low):
 * "En büyük gezegen hangisi?" sorusunda ilk cümle 1154 ms yerine ≈900 ms'de bitti ("Jüpiter, efendim." + ayrıntı).
 */
export const CLAUDE_CODE_VOICE_NOTE = `- Sesli turda ilk cümlen kısa olsun (birkaç sözcük, doğrudan yanıt): ilk cümle biter bitmez seslendirilir, kullanıcı o kadar erken duyar. Ayrıntı gerekiyorsa sonraki cümlede ver.`;

function clipResult(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}… (sonuç kısaltıldı: ${limit} / ${text.length} karakter)` : text;
}

function stringifyResult(result: ToolResult): string {
  let text = result.text;
  if (result.data !== undefined) {
    try {
      text += `\n\n${JSON.stringify(result.data)}`;
    } catch {
      // JSON'a çevrilemeyen veri modele gitmez; metin yeter.
    }
  }
  return clipResult(text, MAX_TOOL_RESULT_CHARS);
}

function styleFor(role: BrainRole, origin: ToolOrigin, persona: boolean): PromptStyle {
  if (!persona) return 'plain';
  if (origin.channel === 'voice' || role === 'voice') return 'voice';
  if (origin.channel === 'job' || origin.channel === 'skill') return 'task';
  return 'chat';
}

const kindOf = (style: PromptStyle): ClaudeCodeKind => (style === 'voice' ? 'voice' : style === 'chat' ? 'chat' : 'task');

/**
 * Sürecin sistem istemi: bulut yolunun zengin istemi (kayıttan üretilen öz-tanım `knowledge` dahil) + bu çalışma
 * biçiminin eki. Tur ve ısıtma aynı metni üretir: öz-tanım değişken bir şey içermez (mikrofon, süren iş `<baglam>`'dadır).
 */
export function claudeCodeSystem(persona: PersonaInput, style: PromptStyle, instructions?: string, knowledge?: string): string {
  if (style === 'plain') return instructions?.trim() || t('ccbrain.system.plain');
  return `${stableSystem(persona, style, false, instructions, knowledge)}\n\n${CLAUDE_CODE_NOTE}${style === 'voice' ? `\n${CLAUDE_CODE_VOICE_NOTE}` : ''}`;
}

function toConv(messages: NonNullable<BrainRequest['messages']>): ConvMessage[] {
  return messages
    .filter((message) => message.text.trim() || message.images?.length)
    .map((message) =>
      message.role === 'user'
        ? { role: 'user' as const, text: message.text, ...(message.images?.length ? { images: message.images } : {}) }
        : { role: 'assistant' as const, text: message.text, toolCalls: [] },
    );
}

const plain = (text: string): string =>
  foldTr(text)
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const ASKS_TIME = /^(peki |acaba |jarvis )?(su an |simdi )?saat kac( oldu)?( acaba)?$/;
const ASKS_DATE = /^(peki |acaba |jarvis )?(bugun (gunlerden ne|ayin kaci|hangi gun|tarih ne|tarih nedir|ne)|bugunun tarihi (ne|nedir)|(su an |bugun )?tarih (ne|nedir|kac))$/;

/**
 * Modele gitmeden, kodla ve anında yanıtlanan sözler: saat ve tarih. Yalnız dar ve kesin kalıplar; emin olunmayan söz
 * modele kalır. Dönen metin söylenecek cümledir.
 */
export function quickAnswer(text: string, now: Date): string | null {
  const said = plain(text);
  if (!said) return null;
  if (ASKS_TIME.test(said)) return t('ccbrain.quick.time', { time: localTime(now) });
  if (ASKS_DATE.test(said)) return t('ccbrain.quick.date', { day: formatDayLong(now, now), year: now.getFullYear() });
  return null;
}

/** Ses aracının sonucundaki hazır cümle ("Kullanıcıya yalnız şunu söyle: “…”"); yoksa sonucun ilk cümlesi. */
export function spokenFromToolResult(text: string): string {
  const quoted = /şunu söyle:\s*"([^"]+)"/.exec(text);
  if (quoted) return quoted[1]!.trim();
  const first = /^[^.!?]+[.!?]/.exec(text.trim());
  return (first ? first[0] : text).trim();
}

const QUICK_TOOLS = new Set(['voice_mute_mic', 'voice_set_quiet', 'voice_stop_speaking']);
/**
 * "Her şeyi konuşarak" sözlerinden kodla eşlenenler (`local-commands.ts`; yerel beyinle AYNI eşleme): ayar değiştirme,
 * sınama başlatma, gezinme. Bu araçların sonucu söylenecek cümleyi hazır taşır; okuma aracı (`settings_list`) modele
 * kalır (sonucunu model özetler). Kesin söz modele gitmeden, anında işlenir.
 */
const QUICK_COMMAND_TOOLS = new Set(['settings_set', 'voice_test_start', 'app_navigate', 'pc_selftest', 'jarvis_mode']);

export async function runClaudeCodeTurn(
  env: ClaudeCodeTurnEnv,
  role: BrainRole,
  request: BrainRequest,
  target: ClaudeCodeTarget,
  onStep?: (step: { index: number; text: string; toolNames: string[] }) => void,
): Promise<ClaudeCodeLoopResult> {
  const started = Date.now();
  const totals = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  const toolCalls: ToolCallSummary[] = [];
  let text = '';
  let streamed = false;
  const finish = (stopReason: BrainStopReason, error: string | null, failure: ClaudeCodeLoopResult['failure'] = null): ClaudeCodeLoopResult => ({
    response: { text: text.trim(), stopReason, error, toolCalls, usage: { ...totals, durationMs: Date.now() - started } },
    cloudDown: null,
    streamed,
    failure,
  });

  const persona = request.persona ?? (role === 'voice' || role === 'deep');
  const style = styleFor(role, request.origin, persona);
  const signal = request.signal;
  const sessionId = request.origin.sessionId;
  const messages = toConv(request.messages ?? [{ role: 'user', text: request.text ?? '' }]);
  while (messages[0]?.role === 'assistant') messages.shift();
  const last = messages.at(-1);
  if (!last || last.role !== 'user') return finish('error', t('brain.error.badRequest'));
  if (signal?.aborted) return finish('aborted', null);

  const splitter = new SentenceSplitter();
  const emit = (delta: string, boundary: boolean) => {
    if (!delta) return;
    // Araç turları arasında metin bitişik gelmesin.
    if (boundary && text !== '' && !/\s$/.test(text) && !/^\s/.test(delta)) {
      text += ' ';
      request.onText?.(' ');
      for (const sentence of splitter.push(' ')) request.onSentence?.(sentence);
    }
    text += delta;
    request.onText?.(delta);
    for (const sentence of splitter.push(delta)) request.onSentence?.(sentence);
  };
  const flush = () => {
    for (const sentence of splitter.flush()) request.onSentence?.(sentence);
  };

  const specs = env.toolSpecs(request, role);
  const offered = new Set(specs.map((spec) => spec.name));
  const own = ownWords(last.text).text;
  /** Son kullanıcı sözleri, yeniden eskiye (bağlam ipucunun kümesi bunlardan seçilir). */
  const userTexts = messages.flatMap((message) => (message.role === 'user' ? [message.text] : [])).reverse().slice(0, 2);

  /** Araç çağrısı: kapıdan geçer, olayları yayınlar, özete yazar. Kısa yol da model de aynı işlevi kullanır. */
  const stepTools: string[] = [];
  const runTool = async (name: string, input: unknown): Promise<{ text: string; isError: boolean; outcome: ToolResult }> => {
    const callId = newId();
    const toolStarted = Date.now();
    request.onToolCall?.({ phase: 'start', callId, name, input });
    const onReport = (step: string) => request.onToolCall?.({ phase: 'report', callId, name, step });
    let outcome: ToolResult;
    const extra = request.extraTools?.tools.find((def) => def.name === name);
    if (signal?.aborted) {
      outcome = { ok: false, text: t('tool.error.aborted') };
    } else if (!offered.has(name)) {
      // Yalnız bu sürece sunulan araçlar çalışır (kayıtta olsa bile sunulmamış ad reddedilir).
      outcome = { ok: false, text: t('tool.error.unknown', { name }) };
    } else if (extra && request.extraTools) {
      outcome = await env.runExtraTool(extra, request.extraTools.context, input, request.origin, callId, signal ?? new AbortController().signal, onReport);
    } else if (!env.tools.has(name)) {
      outcome = { ok: false, text: t('tool.error.unknown', { name }) };
    } else {
      try {
        outcome = await env.tools.run(name, input, { callId, origin: request.origin, ...(signal ? { signal } : {}), onReport });
      } catch (error) {
        outcome = { ok: false, text: t('tool.error.failed', { detail: error instanceof Error ? error.message : String(error) }) };
      }
    }
    const durationMs = Date.now() - toolStarted;
    request.onToolCall?.({ phase: 'end', callId, name, ok: outcome.ok, text: outcome.text, durationMs });
    toolCalls.push({ callId, name, ok: outcome.ok, text: outcome.text.slice(0, 300), durationMs });
    stepTools.push(name);
    return { text: stringifyResult(outcome), isError: !outcome.ok, outcome };
  };

  // ── kısa kesin işler: modele gitmez (yalnız sesli turda; gecikme orada hissedilir) ──
  if (style === 'voice') {
    const previousReply = messages.reduce<string | null>((found, message) => (message.role === 'assistant' && message.text.trim() ? message.text : found), null);
    const voiceAsk = t('brain.local.voiceAsk');
    const intent = routeVoiceIntent(own, previousReply?.includes(voiceAsk) ?? false);
    if (intent?.kind === 'ask' && offered.has('voice_mute_mic') && offered.has('voice_set_quiet')) {
      emit(voiceAsk, false);
      flush();
      return finish('end', null);
    }
    if (intent?.kind === 'call' && QUICK_TOOLS.has(intent.name) && offered.has(intent.name)) {
      const result = await runTool(intent.name, intent.input);
      if (signal?.aborted) return finish('aborted', null);
      // "Sus": yanıt verilmez (araç konuşmayı kesti); öteki araçlar söylenecek cümleyi kendileri verir.
      if (intent.name !== 'voice_stop_speaking' || !result.outcome.ok) {
        emit(result.outcome.ok ? spokenFromToolResult(result.outcome.text) : t('brain.local.toolFailed', { detail: result.outcome.text.replace(/^HATA:\s*/, '') }), false);
        flush();
      }
      return finish('end', null);
    }
    // Kesin ayar / sınama / gezinme sözü ("sessiz saatleri aç", "söz kesme sınamasını başlat", "işler sayfasını aç"):
    // çağıran araçları daraltmadıysa kodla araca gider. Emin olunmayan söyleyiş modele kalır.
    const command = intent === null && (request.tools === undefined || request.tools === 'all') ? routeSpokenCommand(own) : null;
    if (command && QUICK_COMMAND_TOOLS.has(command.name) && offered.has(command.name)) {
      const result = await runTool(command.name, command.input);
      if (signal?.aborted) return finish('aborted', null);
      emit(spokenFromToolResult(result.outcome.text.replace(/^HATA:\s*/, '')), false);
      flush();
      return finish('end', null);
    }
    // Eklentilerin kayıtlı sesli komut kalıpları (`spoken-routes.ts`): yerleşik kalıpların tanımadığı kesin söz.
    const routed = intent === null && command === null && (request.tools === undefined || request.tools === 'all') ? matchSpokenRoute(own) : null;
    if (routed && offered.has(routed.name)) {
      const result = await runTool(routed.name, routed.input);
      if (signal?.aborted) return finish('aborted', null);
      emit(result.outcome.ok ? spokenFromToolResult(result.outcome.text) : t('brain.local.toolFailed', { detail: result.outcome.text.replace(/^HATA:\s*/, '') }), false);
      flush();
      return finish('end', null);
    }
    const quick = quickAnswer(own, env.now());
    if (quick) {
      emit(quick, false);
      flush();
      return finish('end', null);
    }
  }

  const personaInput = env.personaInput();
  const system = claudeCodeSystem(personaInput, style, request.instructions, style === 'plain' ? undefined : env.selfKnowledge?.());
  const memories = style === 'plain' ? [] : env.memories(messages, env.memoryLimit);
  const user = style === 'plain' ? null : (env.userContext?.(own, style) ?? null);

  /** Sözün başına konan güncel durum. Öz-durum yalnız değiştiğinde, hafıza kaydı sürece bir kez gönderilir. */
  const compose = ({ fresh, memo }: { fresh: boolean; memo: Map<string, string> }): string => {
    if (style === 'plain') return '';
    const self = env.selfBlock();
    const sendSelf = self !== '' && memo.get('self') !== self;
    if (self) memo.set('self', self);
    const unseen = memories.filter((hit) => !memo.has(`m:${hit.item.id}`));
    for (const hit of unseen) memo.set(`m:${hit.item.id}`, '1');
    // Kullanıcı profili: özet yalnız değiştiğinde (yeni kural öğrenildi), söze göre çekilen kayıtlar sürece bir kez.
    const profile = user?.summary ?? '';
    const sendProfile = profile !== '' && memo.get('profile') !== profile;
    if (profile) memo.set('profile', profile);
    const details = (user?.details ?? []).filter((detail) => !memo.has(`p:${detail.id}`));
    for (const detail of details) memo.set(`p:${detail.id}`, '1');
    const userBlock = user ? userContextBlock({ summary: sendProfile ? profile : '', details, note: user.note }) : '';
    let tail = variableTail({ now: env.now(), presence: env.presence(), memories: unseen, budgetNotice: false, self: sendSelf ? self : null, user: userBlock });
    // Süren konuşmada yeni kayıt yoksa "kayıt yok" satırı yanıltır (önceki sözlerde verilenler geçerlidir): bölüm atılır.
    if (!fresh && unseen.length === 0) tail = tail.replace(/\n*## Hafızandan[\s\S]*$/, '');
    // Söz bir aracın kümesini açtıysa o aracın güncel durumu (pano: kartlar ve sıraları). Sabit sistem istemine DEĞİL,
    // bu bloğa girer (ısıtılmış sürecin kimliği değişmez) ve her sözde yeniden okunur (pano arada değişmiş olabilir).
    const hints = routedContextHints([...offered], userTexts, env.contextHints, env.declaredGroup);
    if (hints.length) tail = `${tail.trim()}\n\n## Bu sözle ilgili güncel durum\n${hints.map((hint) => `- ${hint}`).join('\n')}`;
    return `<baglam>\n${tail.trim()}\n</baglam>`;
  };

  // Sesli turda bekleme sözü (turda yalnız bir kez; model metni akmaya başladıysa söylenmez). İki tetik:
  //  - model bir araç çağırmaya başladı (≈1 sn'de belli olur; yanıt ancak araçtan sonraki adımda gelir): yazan işte
  //    "Hemen.", okuyan işte "Bakıyorum." hemen söylenir. Ölçüm: araçlı turda yanıt ≈2 sn'de başlıyor; sabit 1,8 sn'lik
  //    söz yanıttan 150 ms önce geliyordu ("Bir saniye. Kaydettim efendim").
  //  - hiçbir çıktı yok (uzun düşünme, ağ): `FILLER_AFTER_MS` sonra "Bir saniye.".
  const voice = style === 'voice';
  let filler: ReturnType<typeof setTimeout> | null = null;
  let fillerSaid = false;
  const sayFiller = (key: 'ccbrain.filler' | 'ccbrain.filler.read' | 'ccbrain.filler.write') => {
    if (!voice || streamed || fillerSaid || signal?.aborted) return;
    fillerSaid = true;
    emit(`${t(key)} `, false);
  };
  const riskOf = new Map<string, string>();
  if (voice) {
    try {
      for (const tool of env.tools.list()) riskOf.set(tool.name, tool.risk);
    } catch {
      // araç kaydı okunamadıysa söz "yazan iş" sayılır
    }
    for (const def of request.extraTools?.tools ?? []) riskOf.set(def.name, def.risk);
    filler = setTimeout(() => sayFiller('ccbrain.filler'), FILLER_AFTER_MS);
    filler.unref?.();
  }

  const outcome = await env.cc.run({
    kind: kindOf(style),
    model: target.model,
    effort: target.effort,
    system,
    tools: specs,
    maxTurns: request.maxSteps ?? env.maxSteps(),
    // Konuşma oturumuna bağlı süreç; oturumu olmayan çağrı (görev, yalın) tek kullanımlık süreçte yürür.
    sessionKey: style === 'voice' || style === 'chat' ? (sessionId ?? `kanal:${request.origin.channel}`) : null,
    messages,
    userKey: own,
    assistantName: personaInput.persona.name,
    compose,
    runTool: async (call) => {
      const name = call.name.startsWith(MCP_TOOL_PREFIX) ? call.name.slice(MCP_TOOL_PREFIX.length) : call.name;
      const result = await runTool(name, call.input);
      return { text: result.text, isError: result.isError };
    },
    ...(signal ? { signal } : {}),
    onText(delta, boundary) {
      streamed = true;
      emit(delta, boundary);
    },
    onActivity(kind, name) {
      // Ses denetimi araçlarında ("sus", "mikrofonu kapat") söz söylenmez: istenen sessizliktir.
      // Profil kaydı sessizdir (kullanıcı bir şey beklemiyor): bekleme sözü söylenmez.
      if (kind === 'tool' && name && !name.startsWith('voice_') && !name.startsWith('profile_')) sayFiller(riskOf.get(name) === 'read' ? 'ccbrain.filler.read' : 'ccbrain.filler.write');
    },
    firstOutputTimeoutMs: voice ? VOICE_FIRST_OUTPUT_MS : CHAT_FIRST_OUTPUT_MS,
    totalTimeoutMs: voice ? VOICE_TOTAL_MS : CHAT_TOTAL_MS,
  });
  if (filler) clearTimeout(filler);
  flush();

  if (outcome.usage) {
    // Abonelikle koşar: dolar karşılığı yoktur; kullanım "fiyatı bilinmiyor" diye kaydedilir (0 sayılmaz).
    const usage = env.recordUsage(
      role,
      { provider: 'claude-code', model: outcome.model ?? target.model, ...outcome.usage, costUsd: null },
      Date.now() - started,
      sessionId,
    );
    totals.inputTokens += usage.inputTokens;
    totals.outputTokens += usage.outputTokens;
  }
  onStep?.({ index: 0, text: outcome.text, toolNames: stepTools });

  switch (outcome.stop) {
    case 'end':
      if (!text.trim() && toolCalls.length === 0) return finish('error', t('brain.error.empty'));
      return finish('end', null);
    case 'aborted':
      return finish('aborted', null);
    case 'max_turns':
      return finish('max_steps', t('brain.error.maxSteps'));
    case 'refusal':
      return finish('refusal', t('brain.error.refusal'));
    default: {
      const failure = outcome.failure ?? { issue: 'network' as const, reason: t('ccbrain.error.unreachable') };
      env.log.warn(`Claude Code turu başarısız: ${outcome.stop} (${outcome.detail})`);
      return finish('error', failure.reason, failure);
    }
  }
}
