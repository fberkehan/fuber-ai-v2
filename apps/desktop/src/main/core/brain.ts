// Sahibi: T2. Beyin (KURGU §6): sağlayıcıdan bağımsız akışlı araç döngüsü (araç turu, cümle olayları, iptal, adım sınırı,
// hata çevirisi) + iki sağlayıcı: `anthropic` (asıl) ve `local` (llama-server). Bulut beynine ulaşılamazsa geri düşme.
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import {
  APP_VERSION,
  CHAT_EFFORT,
  DEFAULT_CLAUDE_CODE_BRAIN,
  DESKTOP_APP_NAME,
  LIMITS,
  localDay,
  newId,
  SentenceSplitter,
  t,
  type BrainApi,
  type BrainCloudIssue,
  type BrainExtractRequest,
  type BrainMessage,
  type BrainRequest,
  type BrainResponse,
  type BrainRole,
  type BrainStatus,
  type BrainStopReason,
  type BrainTaskRequest,
  type ClaudeCodeBrainStatus,
  type JsonObject,
  type MemorySearchHit,
  type ModelRef,
  type ModuleContext,
  type ModuleInfo,
  type ServiceDeps,
  type ToolCallSummary,
  type ToolDef,
  type ToolOrigin,
  type ToolResult,
  type TrTimeResult,
} from '@fuber/shared';
import type { BetaMessage, BetaMessageStreamParams, BetaToolUnion } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { z } from 'zod';
import { claudeCodeSystem, runClaudeCodeTurn, type ClaudeCodeTarget, type ClaudeCodeTurnEnv } from './brain/claude-code/turn';
import { createAnthropicClient, type ClientFactory, type MessagesClient } from './brain/client';
import { createCloudHealth, modelRefFor, resolveCloudTarget, type CloudTarget } from './brain/cloud-route';
import { openAiCompatibleExtract, openAiCompatibleProvider } from './brain/providers/openai-compatible';
import { deepStatusSnapshot } from './brain/deep/status';
import { mapBrainError } from './brain/errors';
import type { LlmServer } from './brain/llm-server';
import { routeSpokenCommand } from './brain/local-commands';
import { matchSpokenRoute } from './brain/spoken-routes';
import { asksEarlier, asksRecentDetail, asksVoiceOff, farewellIntent, recallIntent, VOICE_OFF_TOOLS, routeVoiceIntent } from './brain/local-intents';
import { applyListItems, asksInventedList, inventListHint, LIST_ADD_TOOLS, spokenList } from './brain/local-lists';
import { createReplyFilter } from './brain/local-style';
import { compactToolSpec } from './brain/local-tool-specs';
import {
  DEFAULT_LOCAL_TOOL_MODE,
  foldTr,
  groundingGroups,
  isLocalTool,
  LOCAL_DEEP_ASKS,
  LOCAL_NEEDS_DEEP,
  LOCAL_TOOLS_INFO,
  localGroupOf,
  ownWords,
  previousReplyOf,
  routingTexts,
  selectLocalTools,
  selectSkillTools,
  type LocalToolMode,
} from './brain/local-tools';
import { unfoundedPanoClaim } from './brain/pano-claim';
import { maxTokensFor, modelParams, serverToolDefs, SERVER_FALLBACK_BETA } from './brain/models';
import { announcesAction, asksAction, compactSystem, isNarrativeRequest, contextNote, doneToolsOf, isRepeatRequest, isTimeAsked, isTimeRelevant, localIso, REPEAT_NOTE, spokenPart, resolveSpokenTime, stableSystem, SUMMARY_OPEN, userContextBlock, variableTail, type PromptStyle, type UserContext, type UserContextReader } from './brain/prompt';
import { anthropicProvider, type AnthropicBase } from './brain/providers/anthropic';
import type { ClaudeCodeAvailability, ClaudeCodeBrain, ClaudeCodeSpec } from './brain/providers/claude-code';
import { localExtract, localProvider } from './brain/providers/local';
import { LocalBrainError, type BrainProvider, type ConvMessage, type ProviderTurnResult, type ProviderUsage, type ToolResultMessage, type ToolSpec } from './brain/providers/types';
import {
  correctSelfClaim,
  deepFromStatus,
  listCapabilities,
  renderSelfBlock,
  selfHints,
  type DeepStatusLike,
  type SelfBlockOptions,
  type SelfDeepState,
  type SelfSource,
  type SelfState,
} from './brain/self';
import { buildCatalog, buildClusters, catalogModule, renderSelfKnowledge, type CatalogModule, type CatalogTool, type SelfPart } from './brain/self-catalog';

export interface BrainOptions {
  /** Sınamada sahte istemci verilir. */
  clientFactory?: ClientFactory;
  now?: () => Date;
  /** Yerel beyin sunucusu (bootstrap kurar ve kapanışta durdurur); verilmezse ya da `null` ise yerel beyin yok. */
  localServer?: LlmServer | null;
  /** Sınamada yerel sağlayıcının `fetch`'i. */
  localFetch?: typeof fetch;
  /** Sınamada OpenAI uyumlu bulut sağlayıcının `fetch`'i (sahte sunucu). */
  cloudFetch?: typeof fetch;
  /** Bulut beyni düşünce doğrudan yerelden başlanan süre (ms). */
  cloudRetryMs?: number;
  /** Bulut düşükken arka plan yoklamasının aralığı (ms); sınamada kısaltılır. */
  cloudProbeMs?: number;
  /** Yerel modele araçların nasıl sunulacağı; varsayılan ölçümle seçilen kiptir (değerlendirme betiği değiştirir). */
  localToolMode?: LocalToolMode;
  /**
   * "Bu bilgisayardaki modelle çalışıyorum" duyurusunun en son söylendiği yerel gün (`YYYY-AA-GG`). Duyuru günde en çok
   * bir kez söylenir; uygulama yeniden başlasa da öyle kalsın diye değer kalıcı bir yerde tutulur (bootstrap depoyu
   * verir). Verilmezse süreç belleğinde tutulur.
   */
  noticeDay?: { get(): string | null; set(day: string): void };
  /**
   * Konuşan beyin olarak Claude Code (bu bilgisayardaki CLI, kullanıcının aboneliği). Bileşim kökü kurar ve kapanışta
   * kapatır; verilmezse ya da `null` ise Claude Code yolu yoktur (beyin eskisi gibi davranır).
   */
  claudeCode?: ClaudeCodeBrain | null;
}

export type BrainDeps = ServiceDeps['brain'];

/**
 * Beynin, ortak sözleşmenin (`BrainApi`) dışındaki yüzü: öz-durum. Ses hattının durumunu beyin kendisi bilemez
 * (ses servisi beyinden sonra kurulur); ses denetimi modülü açılışta kaynağı bağlar (`attachSelfState`) ve
 * `self_status` aracı tam durumu buradan okur (`selfState`).
 */
export interface BrainService extends BrainApi {
  attachSelfState(source: (() => SelfSource | null) | null): void;
  /**
   * Modül kaydı (bileşim kökü bağlar: `modules.list()`): öz-tanım modülleri açık/kapalı durumu ve nedeniyle bundan
   * yazar. Bağlanmamışsa açık modüller kayıtlı araçlardan çıkarılır, kapalılar "bilinmiyor"dur.
   */
  attachModuleCatalog(read: (() => readonly ModuleInfo[]) | null): void;
  /**
   * Bir modülün öz-tanıma kattığı parça (KANCA; `SelfPart`): değiştirilebilen/değiştirilemeyen yeni şeyler ve süren
   * işler. Takip işleri (`watch`) bunu kullanır; ikinci dalgada "pano" da buradan bağlanır. `null` bağı kaldırır.
   */
  attachSelfPart(id: string, read: (() => SelfPart | null) | null): void;
  /**
   * Kullanıcı bağlamı (KANCA; `UserContextReader`): hafıza modülünün profil katmanı bağlar. Kişilikli her turda (Claude
   * Code, bulut ve yerel yol) kullanıcı profilinin özeti isteme buradan girer; yerelde kısa biçim. `null`
   * bağı kaldırır; bağlı değilken istem eskisi gibidir.
   */
  attachUserContext(read: UserContextReader | null): void;
  selfState(): SelfState;
  /** Kayıttan üretilen zengin öz-tanım (`self-catalog.ts`); Claude Code ve bulut yolunun sabit istemine giren metin. */
  selfKnowledge(): string;
}

type Origin = ToolOrigin;

/** Araç sonucu modele bu kadar karakterden uzun gitmez (bağlam ve maliyet). */
const MAX_TOOL_RESULT_CHARS = 16_000;
/** Değişince kayıtlı araçları ya da modülleri (dolayısıyla öz-tanımı) değiştiren ayarlar. */
const SELF_SETTINGS: ReadonlySet<string> = new Set(['disabledModules', 'pcControlAllowed', 'pcReadAllowed', 'jbrowserAllowed', 'privacyMode']);
const CLOUD_RETRY_MS = 5 * 60_000;
/** Durum ve öz-durumda görünen ad. */
const CLAUDE_CODE_NAME = 'Claude Code';
/** Bulut düşükken arka planda ne sıklıkla yoklanır (ücretsiz, `max_tokens: 0`). Düzelince kendiliğinden buluta dönülür. */
const CLOUD_PROBE_MS = 60_000;

/**
 * Yerel modelde geçmişe ayrılan pay (token; kaba kestirim). Bağlam 8192 olsa da geçmiş bununla sınırlanır: bir sınama
 * oturumunda tur başına ~5,7 bin girdi konuşmayı birkaç turda boğdu. Aşılınca geçmiş hedefe kadar kırpılır (her turda
 * bir ileti atmak yerine arada bir toplu kırpma: istem öneki turlar arasında aynı kalır).
 */
const LOCAL_HISTORY_BUDGET = 650;
const LOCAL_HISTORY_TARGET = 400;
/** Yerel sesli yanıtın çıktı sınırı: bir iki cümle ya da bir araç çağrısı. Kaçak üretim (ölçüldü: 768 token ≈ 5 sn) kısa kesilir. */
const LOCAL_VOICE_MAX_TOKENS = 512;
/**
 * Yerel SESLİ yanıtın söz sınırı: bu kadar cümle ya da sözcük söylendikten sonra üretim kesilir (cümle sonunda). İstem
 * kuralı ("bir ya da iki kısa cümle") küçük modelde tek başına yetmiyor: ölçümde (demo.3) "limited ile anonim şirketin
 * farkı nedir" sorusuna üç denemenin ikisinde 71 ve 117 sözcük, 5 ve 9 cümle geldi (~40 sn konuşma). Yazılı sohbette,
 * anlatı isteğinde (fıkra, özet) ve kullanıcı ayrıntı istediğinde sınır yoktur. Araç sonucu okunan turda pay biraz geniştir.
 */
const LOCAL_VOICE_BRIEF = { sentences: 3, words: 40, sentencesAfterTool: 4, wordsAfterTool: 55 } as const;
/** Kullanıcı uzun yanıtı kendisi istedi: sesli turda söz sınırı uygulanmaz. */
const WANTS_DETAIL = /ayrintili|detayli|uzun uzun|uzunca|tek tek|hepsini|tamamini|adim adim|madde madde|devam et|daha fazla|\bsay\b|sayar misin|listele|\boku\b|okur musun|bastan sona/;
/**
 * Cümle içinde dönen öbek: iki ile altı sözcüklük bir öbeğin art arda en az üç kez yinelenmesi. Ölçüm (demo.3): "kısa bir
 * fıkra anlat" yanıtında model tek cümlenin içinde "kedi kavgasına karışan bir" öbeğini çıktı sınırına kadar yineledi.
 */
const PHRASE_LOOP = /(?<![\p{L}\p{N}])([\p{L}\p{N}’']+(?:\s+[\p{L}\p{N}’']+){1,5})(?:\s+\1){2,}(?![\p{L}\p{N}])/u;
/** Geçmişteki sözün alıntısı bu kadar karakteri aşmaz ("az önce şunu söylediniz: …"). */
const RECALL_QUOTE_CHARS = 220;
/** Veda sözünde kodla çalıştırılan araç (`modules/voice-control`): sohbet kipini ve takip dinlemesini bitirir. */
const END_CONVERSATION_TOOL = 'voice_end_conversation';
/** Uyarıdan sonraki zorunlu araç adımının çıktı sınırı (tek araç çağrısı). */
const LOCAL_FORCED_STEP_MAX_TOKENS = 256;
/**
 * Yerel modele sunulan araç tanımlarının payı (token; kaba kestirim). Çekirdek küme ~1,3 bin tutar; söze göre açılan
 * gruplar bu payı aşarsa liste sondan kırpılır (önce yalnız bir önceki sözün taşıdığı gruplar gider).
 */
const LOCAL_TOOLS_BUDGET = 2600;
/** Yerel turda tek bir araç sonucunun modele giden en uzun hali (~900 token): web araması ve sayfa okuma buna sığar. */
const LOCAL_TOOL_RESULT_CHARS = 2400;
/** Aynı turun önceki adımlarından kalan araç sonuçlarının önizleme boyu. */
const LOCAL_OLD_TOOL_RESULT_CHARS = 300;
/**
 * Bir önceki turda yapıldıysa, kullanıcı yeniden istemeden yerel modelin bir daha çağıramadığı kayıt açan araçlar
 * (bir sınama oturumunda yankı sözünde aynı hatırlatıcı yeniden kuruldu). Okuyan ve tekrarı zararsız araçlar dışarıda.
 */
const REDO_GUARDED = new Set(['reminder_create', 'todo_add', 'todo_add_many', 'memory_save']);

export { LOCAL_TOOLS } from './brain/local-tools';

/** Olgu söyleyen cümle: içinde sayı ya da ay adı geçiyor (tarih, tutar, sıcaklık, kur). Okuma kapısı buna bakar. */
const STATES_FACT = /\d|(?<!\p{L})(ocak|şubat|mart|nisan|mayıs|haziran|temmuz|ağustos|eylül|ekim|kasım|aralık)(?!\p{L})/iu;

/**
 * Eylem bildiren cümle ("kurdum", "kaydediyorum"…). Yerel modelde bu cümle, turda başarılı bir araç yoksa
 * kullanıcıya iletilmez: küçük model araç çağırmadan "yaptım" diyebiliyor (ölçüldü).
 */
export const ACTION_CLAIM =
  /(?<!\p{L})(kurdum|kuruyorum|kuracağım|ayarladım|ayarlıyorum|kaydettim|kaydediyorum|ekledim|ekliyorum|kapattım|kapatıyorum|oluşturdum|oluşturuyorum|sildim|siliyorum|hatırlatacağım|hatırlatıyorum|açtım|açıyorum|açacağım|çağırıyorum|çağıracağım|işaretledim|işaretliyorum|tamamladım|durdurdum|durduruyorum|kestim|kesiyorum|susuyorum|kontrol ediyorum|bakıyorum|gösteriyorum|listeliyorum|arıyorum|kuruldu|eklendi|kaydedildi|kapatıldı|oluşturuldu|etkinleştirdim|etkinleştiriyorum|aktif ettim|aktif ediyorum|devre dışı bıraktım|iptal ettim|güncelledim|değiştirdim|gönderdim|gönderiyorum|araştırdım|araştırıyorum|baktım|kontrol ettim|inceledim|inceliyorum|hazırladım|hazırlıyorum|kaldırdım|kaldırıyorum|kaldıracağım|kaldırıldı|silindi|başlattım|başlatıyorum|geliştirdim|tıkladım|iptal ediyorum|iptal edeceğim|iptal edildi|iptal edilmiştir|iptal oldu|sileceğim|silinmiştir|temizledim|temizliyorum|temizlendi|durduracağım|durduruldu|durdurulmuştur|sonlandırdım|sonlandırıyorum|sonlandırıldı|erteledim|erteliyorum|ertelendi|kaldırılmıştır|takibi bıraktım|izlemeyi bıraktım)(?!\p{L})/iu;

function styleFor(role: BrainRole, origin: Origin, persona: boolean): PromptStyle {
  if (!persona) return 'plain';
  if (origin.channel === 'voice' || role === 'voice') return 'voice';
  if (origin.channel === 'job' || origin.channel === 'skill') return 'task';
  return 'chat';
}

/** Sonucu sınıra indirir; ne kadarının kaldığını söyler (Fuber AI 1'deki `aracSonucuKisalt` düzeni: model eksik olduğunu bilsin). */
function clipResult(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}… (sonuç kısaltıldı: ${limit} / ${text.length} karakter)` : text;
}

function stringifyResult(result: ToolResult, limit = MAX_TOOL_RESULT_CHARS): string {
  let text = result.text;
  if (result.data !== undefined) {
    try {
      text += `\n\n${JSON.stringify(result.data)}`;
    } catch {
      // JSON'a çevrilemeyen veri modele gitmez; metin yeter.
    }
  }
  return clipResult(text, limit);
}

const RECURRENCE_INPUT: Record<Exclude<TrTimeResult['recurrence'], 'none'>, Record<string, unknown>> = {
  daily: { freq: 'daily' },
  weekdays: { freq: 'weekly', weekdays: [1, 2, 3, 4, 5] },
  weekly: { freq: 'weekly' },
  monthly: { freq: 'monthly' },
};

/**
 * Yerel modelin `reminder_create` çağrısına kodla çözülen zamanı yerleştirir (yerinde). Fuber AI 1'de yerel yolda
 * hatırlatıcının zamanını model hiç hesaplamazdı (ölçüm: tarih hesabında 2/10); burada araç modelde kalır, zaman
 * koddan gelir. Model göreli süre verdiyse (`after_seconds`) dokunulmaz: o hesap araçta yapılır.
 */
export function applyResolvedTime(call: { name: string; input: unknown }, resolved: TrTimeResult, log?: { debug(message: string): void }): void {
  if (call.name !== 'reminder_create' || typeof call.input !== 'object' || call.input === null || Array.isArray(call.input)) return;
  const input = call.input as Record<string, unknown>;
  if (typeof input.after_seconds === 'number') return;
  const given = typeof input.due_at === 'string' ? Date.parse(input.due_at) : Number.NaN;
  if (Number.isNaN(given) || Math.abs(given - resolved.at.getTime()) > 60_000) {
    if (!Number.isNaN(given)) log?.debug(`hatırlatıcı zamanı kodla düzeltildi: ${String(input.due_at)} → ${localIso(resolved.at)}`);
    input.due_at = localIso(resolved.at);
  }
  if (resolved.recurrence !== 'none' && (typeof input.recurrence !== 'object' || input.recurrence === null)) {
    input.recurrence = RECURRENCE_INPUT[resolved.recurrence];
  }
}

/**
 * Yerel turda bir önceki adımların araç sonuçlarını önizlemeye indirir (yerinde). Model o sonuçları bir kez gördü ve
 * yanıtına kattı; yeni adımın sonucu için yer açılır (web araması + sayfa okuma art arda ~1.500 token ekliyordu).
 */
function squeezeOldToolResults(messages: ConvMessage[]): void {
  for (const message of messages) {
    if (message.role !== 'tool') continue;
    message.results = message.results.map((result) => ({ ...result, content: clipResult(result.content, LOCAL_OLD_TOOL_RESULT_CHARS) }));
  }
}

/**
 * Geçmişteki bir kullanıcı iletisinin kullanıcının KENDİ sözü olan kısmı: konuşma servisinin eklediği oturum özeti,
 * gün etiketi ("[dün 14:05]"), ek notu ve söze gömülü belge metni ayıklanır.
 */
export function ownHistoryText(text: string): string {
  let out = ownWords(text).text;
  if (out.startsWith(SUMMARY_OPEN)) {
    const end = out.indexOf('\n\n');
    out = end === -1 ? '' : out.slice(end + 2);
  }
  return out
    .replace(/^\s*(\[[^\]]{0,80}\]\s*)+/, '')
    .replace(/\n\(Bu iletiye eklenen dosyalar:[^\n]*\)\s*$/, '')
    .trim();
}

function toConv(messages: BrainMessage[]): ConvMessage[] {
  return messages
    .filter((message) => message.text.trim() || message.images?.length)
    .map((message) =>
      message.role === 'user'
        ? { role: 'user' as const, text: message.text, ...(message.images?.length ? { images: message.images } : {}) }
        : { role: 'assistant' as const, text: message.text, toolCalls: [] },
    );
}

/**
 * Kaba token kestirimi; yerel bağlam sınırını aşmamak için. Türkçe metin ve JSON şemada ölçülen oran ~2,7
 * karakter/token (4.613 token = 12.746 karakter); pay bırakmak için Fuber AI 1'deki gibi 2,5 alınır.
 */
export const estimateTokens = (text: string) => Math.ceil(text.length / 2.5);

function convSize(message: ConvMessage): number {
  if (message.role === 'user') return estimateTokens(message.text);
  if (message.role === 'assistant') return estimateTokens(message.text + JSON.stringify(message.toolCalls.map((c) => c.input)));
  return estimateTokens(message.results.map((r) => r.content).join(''));
}

/**
 * Bağlam penceresine sığmayan en eski iletileri atar; son kullanıcı iletisi ve sonrasındaki araç turu kalır.
 * `targetTokens` verilirse bütçe aşıldığında o hedefe kadar kırpılır (toplu kırpma). Geçmişin başındaki oturum
 * özeti (`SUMMARY_OPEN` ile başlayan paragraf) kırpılan iletiyle birlikte kaybolmaz; kalan ilk iletiye taşınır.
 */
export function trimToContext(messages: ConvMessage[], budgetTokens: number, targetTokens = budgetTokens): ConvMessage[] {
  const out = [...messages];
  let total = out.reduce((sum, message) => sum + convSize(message), 0);
  if (total <= budgetTokens) return out;
  const first = out[0];
  const summaryEnd = first?.role === 'user' && first.text.startsWith(SUMMARY_OPEN) ? first.text.indexOf('\n\n') : -1;
  const summary = first?.role === 'user' && first.text.startsWith(SUMMARY_OPEN) ? (summaryEnd === -1 ? first.text : first.text.slice(0, summaryEnd)) : null;
  const lastUser = out.map((message) => message.role).lastIndexOf('user');
  let removable = Math.max(0, lastUser);
  const goal = Math.min(budgetTokens, targetTokens) - (summary ? estimateTokens(summary) : 0);
  while (total > goal && removable > 0) {
    const removed = out.shift()!;
    total -= convSize(removed);
    removable--;
    // Yetim araç sonucu ya da asistanla başlayan geçmiş bırakılmaz.
    while (out[0] && out[0].role !== 'user' && removable > 0) {
      total -= convSize(out.shift()!);
      removable--;
    }
  }
  const head = out[0];
  if (summary && head?.role === 'user' && !head.text.startsWith(SUMMARY_OPEN)) out[0] = { ...head, text: `${summary}\n\n${head.text}` };
  return out;
}

export function createBrain(deps: BrainDeps, options: BrainOptions = {}): BrainService {
  const log = deps.log.child('brain');
  const clientFactory = options.clientFactory ?? createAnthropicClient;
  const now = options.now ?? (() => new Date());
  const cloudRetryMs = options.cloudRetryMs ?? CLOUD_RETRY_MS;
  const localServer: LlmServer | null = options.localServer ?? null;
  const claudeCode: ClaudeCodeBrain | null = options.claudeCode ?? null;
  let cachedClient: { key: string; client: MessagesClient } | null = null;
  const prewarms = new Map<BrainRole, Promise<void>>();
  /** Kullanıcının adı ve hitabı ayarlardadır; beyin ayarlara bağlı değil, değişikliği olay yolundan izler. */
  let user: { name: string | null; address: string | null } = { name: null, address: null };
  let budgetToldOn: string | null = null;
  /** Bulut beyni bu ana kadar "düşmüş" sayılır: turlar doğrudan yerelden başlar, arka planda yoklanır. */
  let cloudDownUntil = 0;
  /** Bulutun neden düşük sayıldığı (kredi, anahtar, ağ): duyuru cümlesi ve arayüz buna göre konuşur. */
  let cloudIssue: BrainCloudIssue | null = null;
  const cloudProbeMs = options.cloudProbeMs ?? CLOUD_PROBE_MS;
  let probeTimer: ReturnType<typeof setInterval> | null = null;
  /**
   * "Bu bilgisayardaki modelle çalışıyorum" duyurusu. Eskiden her oturumun ilk yanıtının başına ekleniyordu; kullanıcı bunu
   * her yeni sohbette duyuyordu (bulut anahtarı yokken ya da hesapta kredi yokken durum kalıcıdır: söylenecek yeni bir
   * şey yoktur, durum arayüzde ve öz-durumda zaten yazar). Şimdi GÜNDE EN ÇOK BİR KEZ ve yalnız gerektiğinde söylenir:
   *   · bulut bu turun içinde düştüyse (kullanıcı farkı o an yaşar), ya da
   *   · kullanıcı derin beyin isteyen bir iş istediyse ve derin beyin yoksa (araştırma, yetenek geliştirme, ekrana bakma).
   * Derin işler bu bilgisayardaki Claude Code ile yürüyorsa ikinci durum hiç oluşmaz: "bulut beynim bağlı değil"
   * cümlesi o işler yapılabilirken söylenmez (yanıltıcı olurdu).
   */
  let noticeToldDay: string | null = null;
  const noticeDay = options.noticeDay ?? { get: () => noticeToldDay, set: (day: string) => void (noticeToldDay = day) };
  /**
   * Duyuru bugün BU NEDENLE söylenmediyse söylenmiş diye işaretler ve `true` döner. "Günde en çok bir kez" neden başınadır:
   * aynı neden (kredi yok, ulaşılamıyor) gün içinde yinelenmez, ama YENİ bir neden (sabah ağ koptu, öğleden sonra abonelik
   * sınırı doldu) kullanıcının bilmesi gereken yeni bir bilgidir ve söylenir (demo.3 bütünleştirmesi: Claude Code'un
   * çökmesinden sonra aynı gün dolan sınır hiç söylenmiyordu). Kayıt biçimi `GÜN|neden,neden`; eski biçim (yalnız gün)
   * o gün için "söylendi" sayılır. Kalıcı kayıt okunamazsa süreç belleği yeter.
   */
  const claimNotice = (cause: string): boolean => {
    const today = localDay(now());
    let stored: string | null = noticeToldDay;
    try {
      stored = noticeDay.get() ?? stored;
    } catch {
      // kalıcı kayıt okunamadı
    }
    const [day, causes] = (stored ?? '').split('|');
    if (day === today && causes === undefined) return false;
    const told = day === today ? (causes ?? '').split(',').filter(Boolean) : [];
    if (told.includes(cause)) return false;
    noticeToldDay = `${today}|${[...told, cause].join(',')}`;
    try {
      noticeDay.set(noticeToldDay);
    } catch (error) {
      log.debug(`duyuru günü yazılamadı: ${error instanceof Error ? error.message : String(error)}`);
    }
    return true;
  };
  /** OpenAI uyumlu sağlayıcıların "şu an düşük" durumu (sağlayıcı başına; Anthropic'inkinden ayrı). */
  const cloudHealth = createCloudHealth();
  /** Gizli kip: buluta hiçbir şey gitmez (sağlayıcı ne olursa olsun). */
  const networkAllowed = () => deps.policy.networkAllowed?.() ?? true;
  /** OpenAI uyumlu sağlayıcının son yanıtta bildirdiği model adı ; öz-durum bunu söyler. */
  // Anahtar `sağlayıcı|seçili model`dir: ad yalnız O model seçiliyken geçerlidir. Yalnız sağlayıcıya bağlıyken Yönetim'den
  // model değişince durum eski adı göstermeyi sürdürüyor (cloud-provider.mjs yakaladı), yazılı sohbetin modeli (Opus)
  // sesin durumunda görünüyordu.
  const reportedModels = new Map<string, string>();
  /** Durumda görünen model adı: yanıtın bildirdiği ad varsa o, yoksa seçili model. */
  const reportedModel = (endpointId: string, configured: string) => reportedModels.get(`${endpointId}|${configured}`) ?? configured;

  deps.bus.on('settings.changed', ({ settings, changedKeys }) => {
    user = { name: settings.userName, address: settings.userAddress };
    // Gizli kip açılıp kapandı: beyin değişir (bulut ↔ yerel); durum satırı ve öz-durum hemen izlesin.
    if (changedKeys?.includes('privacyMode')) refreshStatus();
  });

  const client = (): MessagesClient | null => {
    const key = deps.policy.get().keys.anthropic?.trim();
    if (!key) return null;
    if (cachedClient?.key !== key) cachedClient = { key, client: clientFactory(key) };
    return cachedClient.client;
  };

  const localReady = () => localServer?.available() ?? { ok: false, reason: t('brain.error.localUnavailable') };
  const fallbackEnabled = () => deps.policy.get().brain.localFallback === 'auto';
  /** Derin görevler (iş, araştırma, Atölye) yerelde koşmaz; yazılı sohbet `deep` rolünde olsa da koşabilir. */
  const localAllowed = (role: BrainRole, origin: Origin | null) =>
    role === 'voice' || role === 'memory' || (role === 'deep' && origin?.channel === 'chat');

  const cloudUp = () => {
    if (cloudDownUntil === 0) return;
    cloudDownUntil = 0;
    cloudIssue = null;
    if (probeTimer) clearInterval(probeTimer);
    probeTimer = null;
    log.info('bulut beyni yeniden erişilebilir');
    refreshStatus();
  };

  /**
   * Bulut düştü (kredi yok, anahtar geçersiz, ağ yok): turlar gecikme ödemeden doğrudan yerelden başlar; bulut arka
   * planda ucuz bir istekle (max_tokens 0) yoklanır ve düzelince (kredi geldi, ağ döndü) kendiliğinden geri dönülür.
   * Yoklama başarısız oldukça süre uzar: kullanıcının turu hiçbir zaman "bir de buluta bakayım" diye beklemez.
   */
  const probeCloud = () => {
    const api = client();
    if (!api || cloudDownUntil === 0 || !networkAllowed()) return;
    const ref = deps.policy.get().models.voice;
    void api
      .create(
        { model: ref.provider === 'anthropic' ? ref.model : 'claude-haiku-5-5', max_tokens: 0, messages: [{ role: 'user', content: '.' }] },
        { timeout: 15_000, maxRetries: 0 },
      )
      .then(cloudUp)
      .catch((error: unknown) => {
        const mapped = mapBrainError(error, false);
        // Yalnız "bulut kullanılamaz" hataları düşük tutar; başka bir yanıt (ör. 400 geçersiz istek) bulutun
        // ayakta olduğunu gösterir.
        if (!mapped.cloudDown) return cloudUp();
        if (cloudDownUntil === 0) return;
        cloudDownUntil = Date.now() + cloudRetryMs;
        if (mapped.cloudIssue && mapped.cloudIssue !== cloudIssue) {
          cloudIssue = mapped.cloudIssue;
          refreshStatus();
        }
      });
  };
  const markCloudDown = (issue: BrainCloudIssue) => {
    cloudDownUntil = Date.now() + cloudRetryMs;
    cloudIssue = issue;
    refreshStatus();
    if (probeTimer) return;
    probeTimer = setInterval(probeCloud, cloudProbeMs);
    probeTimer.unref?.();
  };
  /**
   * Konuşan beyin Claude Code iken Anthropic API'ye sesli turda hiç gidilmez; durumu (kredi var mı) yine de bilinsin
   * diye anahtar varsa bir kez, ücretsiz yoklanır (`max_tokens: 0`). Derin işlerin sağlayıcı seçimi ve "önce API" sırası
   * buna bakar (`BrainStatus.apiIssue`). Düşükse olağan yoklama zamanlayıcısı devralır.
   */
  let apiProbedFor: string | null = null;
  const probeApiOnce = () => {
    const api = client();
    const key = deps.policy.get().keys.anthropic?.trim() ?? '';
    if (!api || !key || apiProbedFor === key || cloudDownUntil !== 0 || !networkAllowed()) return;
    apiProbedFor = key;
    const ref = deps.policy.get().models.voice;
    void api
      .create(
        { model: ref.provider === 'anthropic' ? ref.model : 'claude-haiku-5-5', max_tokens: 0, messages: [{ role: 'user', content: '.' }] },
        { timeout: 15_000, maxRetries: 0 },
      )
      .then(() => undefined)
      .catch((error: unknown) => {
        const mapped = mapBrainError(error, false);
        if (mapped.cloudDown) markCloudDown(mapped.cloudIssue ?? 'network');
      });
  };

  /** `busy`/`model`: OpenAI uyumlu sağlayıcıda bu tur yürümedi (hız sınırı, 5xx, model yok); `private`: Gizli kip. */
  type LocalWhy = 'no_key' | BrainCloudIssue | 'busy' | 'model' | 'forbidden' | 'private';
  type Route =
    | { kind: 'anthropic' }
    | { kind: 'openai'; target: CloudTarget }
    /** Bu bilgisayardaki Claude Code (abonelik). `implicit`: rol `anthropic` iken `brain.claudeCode.use` ile devraldı. */
    | { kind: 'claude-code'; target: ClaudeCodeTarget; implicit: boolean }
    /**
     * `dropped`: bulut BU turda düştü ve tur yerelde yeniden yürüyor. `via`: düşen OpenAI uyumlu sağlayıcının adı.
     * `cc`: yerele Claude Code kullanılamadığı için düşüldü (duyuru cümlesi onu söyler).
     */
    | { kind: 'local'; fallback: boolean; why?: LocalWhy; via?: string; dropped?: boolean; cc?: boolean }
    | { kind: 'blocked'; stopReason: BrainStopReason; error: string };

  // ───────────────────────── Claude Code (abonelik) yönlendirmesi ─────────────────────────

  const claudeCodeConfig = () => deps.policy.get().brain.claudeCode ?? DEFAULT_CLAUDE_CODE_BRAIN;
  /** Konuşma turu mu (sesli tur ya da yazılı sohbet): Claude Code'un kendiliğinden devraldığı çağrılar yalnız bunlardır. */
  const conversational = (role: BrainRole, origin: Origin | null) => role === 'voice' || (role === 'deep' && origin?.channel === 'chat');
  /** Claude Code'un o çağrıdaki modeli ve eforu: rol açıkça `claude-code` ise rolün ayarı, değilse `brain.claudeCode`. */
  const claudeCodeTarget = (ref: ModelRef, role: BrainRole): ClaudeCodeTarget => {
    if (ref.provider === 'claude-code') return { model: ref.model, effort: ref.effort };
    const config = claudeCodeConfig();
    const chosen = role === 'voice' ? config.voice : config.chat;
    return { model: chosen.model, effort: chosen.effort };
  };
  /** Claude Code kullanılamıyorken yerele düşüşün nedeni (duyuru ve rozet). */
  const claudeCodeWhy = (state: ClaudeCodeAvailability | null): LocalWhy =>
    !state || state.issue === 'missing' || state.issue === null ? 'no_key' : state.issue;

  /**
   * Yerele düşüldüğünü söyleyen cümle (günde en çok bir kez): neden neyse o söylenir (ham hata metni asla). `via`: OpenAI
   * uyumlu sağlayıcının adı ("OpenRouter hesabında kredi yok").
   */
  const fallbackNotice = (why: LocalWhy | undefined, via?: string, cc = false): string => {
    if (why === 'private') return t('cloud.notice.private');
    if (cc) {
      return t(why === 'limit' ? 'ccbrain.notice.limit' : why === 'auth' ? 'ccbrain.notice.auth' : why === 'no_key' ? 'ccbrain.notice.missing' : 'ccbrain.notice.error');
    }
    if (via) {
      const key = why === 'no_key' ? 'cloud.notice.noKey' : why === 'billing' ? 'cloud.notice.billing' : why === 'auth' ? 'cloud.notice.auth' : why === 'model' ? 'cloud.notice.model' : why === 'forbidden' ? 'cloud.notice.forbidden' : why === 'busy' ? 'cloud.notice.busy' : 'cloud.notice.network';
      return t(key, { provider: via });
    }
    return t(
      why === 'no_key'
        ? 'brain.local.noticeNoKey'
        : why === 'billing'
          ? 'brain.local.noticeBilling'
          : why === 'auth'
            ? 'brain.local.noticeAuth'
            : 'brain.local.notice',
    );
  };

  /**
   * Günlük sınır mesajı. Sınır bilinen harcamayla değil fiyatı bilinmeyen çağrıların SAYISIYLA dolduysa bu açıkça
   * söylenir (kullanıcı "harcama görünmüyor ama sınır doldu" diye şaşırmasın).
   */
  const budgetError = (): string => {
    try {
      const today = deps.usage.today();
      if (today.unpricedCalls && today.costUsd < today.budgetUsd) return t('brain.error.budgetUnpriced', { count: today.unpricedCalls });
    } catch {
      // Özet okunamadıysa genel cümle yeter.
    }
    return t('brain.error.budget');
  };

  const route = (role: BrainRole, origin: Origin | null, skipClaudeCode = false): Route => {
    const policy = deps.policy.get();
    if (deps.policy.killSwitchActive()) return { kind: 'blocked', stopReason: 'kill_switch', error: t('brain.error.killSwitch') };
    // Zorunlu güncelleme: sürüm kapısı açıkken beyin de çalışmaz (araç kapısı ve arayüzle birlikte).
    if (deps.policy.updateRequired()) return { kind: 'blocked', stopReason: 'error', error: t('brain.error.updateRequired') };
    const ref = modelRefFor(policy, role, origin);
    if (ref.provider === 'local') {
      if (!localAllowed(role, origin)) return { kind: 'blocked', stopReason: 'error', error: t('brain.error.deepNeedsCloud') };
      const ready = localReady();
      return ready.ok ? { kind: 'local', fallback: false } : { kind: 'blocked', stopReason: 'error', error: ready.reason ?? t('brain.error.localUnavailable') };
    }
    const canFallback = fallbackEnabled() && localAllowed(role, origin) && localReady().ok;
    // Gizli kip: hiçbir bulut sağlayıcısına istek gitmez; yerel model varsa o yürür.
    if (!networkAllowed()) {
      return canFallback ? { kind: 'local', fallback: true, why: 'private' } : { kind: 'blocked', stopReason: 'error', error: t('cloud.error.private') };
    }
    // Claude Code (abonelik). Gizli kip yukarıda kesti: o kipte Claude Code'a hiçbir şey gitmez.
    const ccState = claudeCode && !skipClaudeCode ? claudeCode.availability() : null;
    if (ref.provider === 'claude-code') {
      if (ccState?.ok) return { kind: 'claude-code', target: claudeCodeTarget(ref, role), implicit: false };
      if (canFallback) return { kind: 'local', fallback: true, why: claudeCodeWhy(ccState), cc: true };
      return { kind: 'blocked', stopReason: 'error', error: ccState?.reason ?? t('deep.cli.missing') };
    }
    // Rol `anthropic` iken: `prefer` → önce abonelik; `fallback` → API kullanılamıyorsa abonelik (aşağıda).
    const ccUse = claudeCode && ref.provider === 'anthropic' && conversational(role, origin) ? claudeCodeConfig().use : 'off';
    if (ccUse === 'prefer' && ccState?.ok) return { kind: 'claude-code', target: claudeCodeTarget(ref, role), implicit: true };
    if (ref.provider === 'openai-compatible') {
      const resolved = resolveCloudTarget(policy, ref);
      const via = resolved.ok ? resolved.target.endpoint.name : (policy.providers.find((item) => item.id === ref.endpoint)?.name ?? t('cloud.provider.generic'));
      const down = resolved.ok ? cloudHealth.issue(resolved.target.endpoint.id) : null;
      if (!resolved.ok || down) {
        if (canFallback) return { kind: 'local', fallback: true, why: resolved.ok ? (down ?? 'network') : 'no_key', via };
        if (!resolved.ok) {
          return { kind: 'blocked', stopReason: 'no_key', error: t(resolved.why === 'no_key' ? 'cloud.error.noKey' : 'cloud.error.noEndpoint', { provider: via }) };
        }
      }
      if (role !== 'voice' && deps.usage.overBudget()) return { kind: 'blocked', stopReason: 'budget', error: budgetError() };
      if (resolved.ok) return { kind: 'openai', target: resolved.target };
    }
    const hasKey = !!client();
    if (!hasKey || Date.now() < cloudDownUntil) {
      if (ccUse !== 'off' && ccState?.ok) return { kind: 'claude-code', target: claudeCodeTarget(ref, role), implicit: true };
      // Abonelik yolu varken düştüyse (sınır doldu, oturum kapandı) söylenecek neden odur; Claude Code hiç yoksa eski neden.
      if (canFallback && ccUse !== 'off' && ccState && !ccState.ok && ccState.issue !== 'missing' && ccState.state !== 'checking') {
        return { kind: 'local', fallback: true, why: claudeCodeWhy(ccState), cc: true };
      }
      if (canFallback) return { kind: 'local', fallback: true, why: hasKey ? (cloudIssue ?? 'network') : 'no_key' };
      if (!hasKey) {
        return { kind: 'blocked', stopReason: 'no_key', error: role === 'deep' && origin?.channel !== 'chat' ? t('brain.error.deepNeedsCloud') : t('brain.error.noKey') };
      }
    }
    if (role !== 'voice' && deps.usage.overBudget()) return { kind: 'blocked', stopReason: 'budget', error: budgetError() };
    return { kind: 'anthropic' };
  };

  const availability: BrainApi['availability'] = (role) => {
    const decision = route(role, { channel: role === 'deep' ? 'chat' : role === 'voice' ? 'voice' : 'job', speakerVerified: null });
    return decision.kind === 'blocked' ? { ok: false, reason: decision.error } : { ok: true, reason: null };
  };

  /**
   * Asistanın o anki beyni (sesli tur ölçüsüyle; yazılı sohbet aynı yolu izler). Arayüzün tek kaynağı budur.
   * Bulut "düşmüş" bilgisi son gerçek çağrıya dayanır: anahtar varken ilk hata gelene dek bulut varsayılır.
   */
  const computeStatus = (): BrainStatus => {
    const policy = deps.policy.get();
    const local = localReady();
    const voiceRef = policy.models.voice;
    // Sesli turun gerçekte izleyeceği yol: durum tahmin edilmez, yönlendirmenin kararından okunur.
    const voiceRoute = claudeCode || voiceRef.provider === 'claude-code' ? route('voice', { channel: 'voice', speakerVerified: null }) : null;
    const ccStatus = claudeCodeStatus(voiceRoute?.kind === 'claude-code');
    const base = {
      localReady: local.ok,
      localModel: policy.brain.local.modelId,
      cause: null,
      deep: deepStatusSnapshot(),
      ...(ccStatus ? { claudeCode: ccStatus, apiIssue: Date.now() < cloudDownUntil ? (cloudIssue ?? 'network') : null } : {}),
    };
    if (deps.policy.killSwitchActive()) return { ...base, provider: 'none', reason: 'kill_switch', message: t('brain.error.killSwitch') };
    if (deps.policy.updateRequired()) return { ...base, provider: 'none', reason: 'update_required', message: t('brain.error.updateRequired') };
    if (voiceRef.provider === 'local') {
      return local.ok
        ? { ...base, provider: 'local', reason: 'policy_local', message: null }
        : { ...base, provider: 'none', reason: 'policy_local', message: local.reason ?? t('brain.error.localUnavailable') };
    }
    // Gizli kip (kullanıcı açtı): bulut seçili olsa da hiçbir sağlayıcıya istek gitmez. Neden "politika yerel" değildir;
    // durum satırı "Gizli kip" der, öz-durum nedenini doğru söyler. Yerel model yoksa yanıt verecek beyin yoktur.
    if (!networkAllowed()) {
      return local.ok && fallbackEnabled()
        ? { ...base, provider: 'local', reason: 'private', message: null }
        : { ...base, provider: 'none', reason: 'private', message: t('cloud.error.private') };
    }
    if (voiceRoute) {
      const ccCloud = { provider: 'claude-code' as const, name: CLAUDE_CODE_NAME, model: ccStatus?.voiceModel ?? voiceRef.model };
      if (voiceRoute.kind === 'claude-code') return { ...base, cloud: ccCloud, provider: 'cloud', reason: 'ok', message: null };
      // Asıl beyin Claude Code ama şu an kullanılamıyor: yerel model devraldı (ya da hiçbiri yok).
      const state = ccStatus?.state ?? 'missing';
      const downCause: BrainCloudIssue | null = state === 'limit' ? 'limit' : state === 'logged_out' ? 'auth' : state === 'error' || state === 'old' ? 'network' : null;
      if (voiceRoute.kind === 'local' && voiceRoute.cc) {
        const cause: BrainCloudIssue | null = voiceRoute.why === 'limit' || voiceRoute.why === 'auth' ? voiceRoute.why : downCause;
        return { ...base, cloud: ccCloud, cause, provider: 'local', reason: cause ? 'cloud_down' : 'no_key', message: null };
      }
      if (voiceRef.provider === 'claude-code') {
        const message = voiceRoute.kind === 'blocked' ? voiceRoute.error : (ccStatus?.reason ?? t('brain.status.noBrain'));
        return { ...base, cloud: ccCloud, cause: downCause, provider: 'none', reason: downCause ? 'cloud_down' : 'no_key', message };
      }
    }
    let hasKey: boolean;
    let down: boolean;
    let issue: BrainCloudIssue | null;
    let cloud: NonNullable<BrainStatus['cloud']>;
    if (voiceRef.provider === 'openai-compatible') {
      const resolved = resolveCloudTarget(policy, voiceRef);
      const endpoint = resolved.ok ? resolved.target.endpoint : policy.providers.find((item) => item.id === voiceRef.endpoint);
      hasKey = resolved.ok;
      issue = resolved.ok ? cloudHealth.issue(resolved.target.endpoint.id) : null;
      down = issue !== null;
      cloud = { provider: 'openai-compatible', name: endpoint?.name ?? t('cloud.provider.generic'), model: resolved.ok ? reportedModel(resolved.target.endpoint.id, resolved.target.model) : voiceRef.model };
    } else {
      hasKey = !!client();
      down = Date.now() < cloudDownUntil;
      issue = cloudIssue;
      cloud = { provider: 'anthropic', name: 'Anthropic', model: voiceRef.model };
    }
    if (hasKey && !down) return { ...base, cloud, provider: 'cloud', reason: 'ok', message: null };
    const reason: BrainStatus['reason'] = hasKey ? 'cloud_down' : 'no_key';
    const cause: BrainCloudIssue | null = hasKey ? (issue ?? 'network') : null;
    if (fallbackEnabled() && local.ok) return { ...base, cloud, cause, provider: 'local', reason, message: null };
    return { ...base, cloud, cause, provider: 'none', reason, message: hasKey ? t('brain.status.cloudDownNoLocal') : t('brain.status.noBrain') };
  };
  /** `BrainStatus.claudeCode`: konuşan beyin olarak Claude Code'un durumu (Ayarlar › Tanı ve rozet). */
  function claudeCodeStatus(active: boolean): ClaudeCodeBrainStatus | undefined {
    if (!claudeCode) return undefined;
    const policy = deps.policy.get();
    const config = claudeCodeConfig();
    const voiceRef = policy.models.voice;
    const chatRef = policy.models.chat ?? policy.models.deep;
    const availability = claudeCode.availability();
    const snapshot = claudeCode.snapshot();
    const wanted = voiceRef.provider === 'claude-code' || (voiceRef.provider === 'anthropic' && config.use !== 'off');
    let state: ClaudeCodeBrainStatus['state'];
    let reason: string | null = null;
    if (!wanted) {
      state = 'off';
      reason = t(config.use === 'off' ? 'ccbrain.state.off' : 'ccbrain.state.otherProvider');
    } else if (!networkAllowed()) {
      state = 'private';
      reason = t('ccbrain.state.private');
    } else if (!availability.ok) {
      state = availability.state === 'ready' ? 'error' : availability.state;
      reason = availability.reason;
    } else {
      state = active ? 'active' : 'standby';
    }
    return {
      state,
      reason,
      use: config.use,
      resetsAt: availability.resetsAt ? new Date(availability.resetsAt).toISOString() : null,
      version: availability.version,
      voiceModel: voiceRef.provider === 'claude-code' ? voiceRef.model : config.voice.model,
      chatModel: chatRef.provider === 'claude-code' ? chatRef.model : config.chat.model,
      warm: snapshot.warm,
      lastFirstTextMs: snapshot.lastFirstTextMs,
    };
  }
  let lastStatus = '';
  /** Durum değiştiyse `brain.status` yayınlar. Hesap ucuzdur (dosya varlığı + politika). */
  function refreshStatus(): BrainStatus {
    const status = computeStatus();
    const signature = JSON.stringify(status);
    if (signature !== lastStatus) {
      const first = lastStatus === '';
      lastStatus = signature;
      if (!first) log.info(`beyin: ${status.provider} (${status.reason}${status.cause ? `: ${status.cause}` : ''}${status.localReady ? '' : ', yerel model hazır değil'})`);
      deps.bus.emit('brain.status', status);
    }
    return status;
  }
  deps.bus.on('policy.changed', ({ changedKeys }) => {
    // Yönetim'den yeni anahtar geldiyse bir sonraki yoklama beklenmez: bulut hemen sınanır.
    if (changedKeys.includes('keys')) probeCloud();
    // OpenAI uyumlu sağlayıcıda ücretsiz yoklama yok: anahtar, sağlayıcı ya da model değişince "düşük" damgası silinir,
    // bir sonraki tur buluta yeniden gider.
    if (changedKeys.some((key) => key === 'keys' || key === 'providers' || key === 'models')) cloudHealth.clear();
    // Yanıtın bildirdiği model adı, ayar değişince bayatlar (yeni model seçildi): bir sonraki yanıta kadar ayardaki ad görünür.
    if (changedKeys.some((key) => key === 'keys' || key === 'providers' || key === 'models' || key === 'brain')) reportedModels.clear();
    // Model, kişilik ya da modül (araç kümesi) değiştiyse ısıtılmış boş Claude Code süreçleri bayatlar.
    if (changedKeys.some((key) => key === 'models' || key === 'brain' || key === 'persona' || key === 'modules')) claudeCode?.recycle();
    refreshStatus();
  });
  // Claude Code'un durumu değişti (yoklama bitti, sınır doldu ya da açıldı): rozet ve yönlendirme güncellensin.
  claudeCode?.onChange(() => {
    refreshStatus();
  });
  // Modül açıldı/kapandı ya da ayar değişti (bilgisayar izni → araçlar, sesle değişen ayarların kataloğu): öz-tanım
  // değişmiş olabilir; eski öz-tanımla ısıtılmış boş süreçler bayatlar. Oturuma bağlı süreç kendi kimliğiyle yenilenir.
  deps.bus.on('module.changed', () => claudeCode?.recycle());
  deps.bus.on('settings.changed', ({ changedKeys }) => {
    if (changedKeys.some((key) => SELF_SETTINGS.has(key))) claudeCode?.recycle();
  });
  deps.bus.on('app.killSwitch', () => void refreshStatus());
  // Yerel dil modelinin dosyaları yerleşince (ya da eksilince) beyin değişebilir.
  deps.bus.on('setup.modelProgress', (progress) => {
    if (progress.status !== 'downloading') refreshStatus();
  });

  const recordUsage = (role: BrainRole, usage: ProviderUsage, durationMs: number, sessionId?: string) => {
    const record = deps.usage.record({
      kind: role,
      provider: usage.provider,
      model: usage.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      ...(usage.costUsd !== undefined ? { costUsd: usage.costUsd } : {}),
      durationMs,
      ...(sessionId ? { sessionId } : {}),
    });
    return {
      inputTokens: usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens,
      outputTokens: usage.outputTokens,
      costUsd: record.costUsd,
    };
  };

  /** Araçların tanımlarında bildirdiği kümeler (`ToolDef.group`); araç kaydı hazır değilse boş. */
  const declaredGroups = (): Map<string, string> => {
    try {
      return new Map(deps.tools.list().flatMap((tool) => (tool.group ? [[tool.name, tool.group] as const] : [])));
    } catch {
      return new Map();
    }
  };

  /** Yerel modelin çağırabildiği kullanıcı yeteneği araçları (Atölye'de etkin olanlar). */
  const localSkillTools = (): string[] => {
    try {
      return selectSkillTools(deps.tools.list());
    } catch {
      return [];
    }
  };

  /**
   * `localTexts`: yerel turda son kullanıcı sözleri (yeniden eskiye); bulut turunda `null` (bütün araçlar, özgün
   * tanımlarıyla). Yerelde araçlar tura göre seçilir, seçim sırasıyla dizilir (çekirdek önce: istem öneki turdan tura
   * aynı kalır) ve tanımları kısaltılır.
   */
  const toolSpecs = (request: Pick<BrainRequest, 'tools' | 'extraTools'>, role: BrainRole, localTexts: string[] | null): ToolSpec[] => {
    const defaultTools = role === 'memory' || role === 'vision' ? 'none' : 'all';
    const selection = request.tools ?? defaultTools;
    const registered = selection === 'none' ? [] : deps.tools.schemas(selection === 'all' ? undefined : selection);
    const own: ToolSpec[] = [...registered]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((schema) => ({ name: schema.name, description: schema.description, inputSchema: stripSchemaMeta(schema.inputSchema) }));
    const extra: ToolSpec[] = (request.extraTools?.tools ?? []).map((def) => ({
      name: def.name,
      description: def.description,
      inputSchema: stripSchemaMeta(z.toJSONSchema(def.input, { io: 'input' }) as Record<string, unknown>),
    }));
    if (!localTexts) return [...own, ...extra];
    const byName = new Map(own.map((spec) => [spec.name, spec]));
    const groups = declaredGroups();
    // Derin beynin olmadığı BİLİNİYORSA onu isteyen araçlar (yetenek geliştirme, araştırma, ekrana bakma) sunulmaz.
    const deep = deepState();
    const order = selectLocalTools([...byName.keys()], localTexts, options.localToolMode ?? DEFAULT_LOCAL_TOOL_MODE, (name) => groups.get(name), {
      deepBlocked: !deep.ok && deep.known !== false,
    });
    // Etkin kullanıcı yeteneklerinin araçları sabit listede olamaz; yerel modele dinamik eklenir (sınırlı sayıda).
    for (const name of localSkillTools()) if (byName.has(name) && !order.includes(name)) order.push(name);
    const shown = order.map((name) => compactToolSpec(byName.get(name)!));
    // Araç payı aşılırsa liste sondan kırpılır; çekirdek küme her zaman kalır.
    const core = order.filter((name) => localGroupOf(name, groups.get(name)) === 'core').length;
    let dropped = 0;
    while (shown.length > core && estimateTokens(JSON.stringify(shown)) > LOCAL_TOOLS_BUDGET) {
      shown.pop();
      dropped++;
    }
    if (dropped) log.debug(`yerel araç payı aşıldı; ${dropped} araç bu turda sunulmadı`);
    // Çağrıya özgü araçlar (`extraTools`) çağıranın açık isteğidir: hepsi sunulur.
    return [...shown, ...extra.map(compactToolSpec)];
  };

  /**
   * Bu söz DERİN beyin isteyen bir işi mi istiyor ve o beyin şu an yok mu (araştırma, yetenek geliştirme, ekrana bakma):
   * söz o işi açıkça istiyor (`LOCAL_DEEP_ASKS`), aracı kayıtlı ama derin beyin olmadığı için sunulmuyor. Derin beyin
   * çalışıyorsa (Anthropic API ya da bu bilgisayardaki Claude Code) ya da durumu henüz bilinmiyorsa `false`.
   */
  const wantsMissingDeep = (request: Pick<BrainRequest, 'tools'>, role: BrainRole, said: string): boolean => {
    try {
      const deep = deepState();
      if (deep.ok || deep.known === false) return false;
      const selection = request.tools ?? (role === 'memory' || role === 'vision' ? 'none' : 'all');
      if (selection === 'none') return false;
      const names = new Set(deps.tools.schemas(selection === 'all' ? undefined : selection).map((schema) => schema.name));
      const folded = foldTr(said);
      // Kümenin açılması yetmez ("müziği durdur" da bilgisayar kümesini açar): söz O işi istemeli (`LOCAL_DEEP_ASKS`).
      return [...LOCAL_NEEDS_DEEP].some((name) => names.has(name) && LOCAL_DEEP_ASKS[name]?.test(folded) === true);
    } catch {
      return false;
    }
  };

  // ───────────────────────── öz-durum (kendini bilme) ─────────────────────────

  /**
   * Derin beynin durumu. Kaynak `BrainStatus.deep`'tir (derin beyin köprüsü doldurur: sağlayıcı Anthropic API ya da bu
   * bilgisayardaki Claude Code). Alan yoksa beynin kendi bildiği kullanılır: derin rol buluta gidiyor mu, bulut ayakta mı.
   */
  function deepState(): SelfDeepState {
    const route_ = route('deep', { channel: 'job', speakerVerified: null });
    // Bulut düşükken (kredi yok, ağ yok) rota derin işi yine buluta yollar ve çağrı orada düşer: yetenek o an YOKTUR.
    const ok = route_.kind === 'anthropic' && Date.now() >= cloudDownUntil;
    const own = { ok, reason: route_.kind === 'blocked' ? route_.error : ok ? null : t('brain.error.deepNeedsCloud') };
    let reported: DeepStatusLike | undefined;
    try {
      reported = (computeStatus() as BrainStatus & { deep?: DeepStatusLike }).deep;
    } catch {
      reported = undefined;
    }
    return deepFromStatus(reported, own);
  }

  let selfSource: (() => SelfSource | null) | null = null;
  let moduleCatalog: (() => readonly ModuleInfo[]) | null = null;
  const selfParts = new Map<string, () => SelfPart | null>();
  let userContext: UserContextReader | null = null;
  /** Kullanıcı bağlamı (profil); kanca bağlı değilse, hata verirse ya da tur kişiliksizse `null` (tur bozulmaz). */
  const readUserContext = (text: string, compact: boolean, style: PromptStyle): UserContext | null => {
    if (!userContext || style === 'plain') return null;
    try {
      return userContext({ text, compact, conversational: style === 'voice' || style === 'chat' });
    } catch (error) {
      log.warn('kullanıcı bağlamı okunamadı', error);
      return null;
    }
  };

  /** Kayıtlı araçlar (ad, modül, risk, küme); araç kaydı hazır değilse boş. */
  const catalogTools = (): CatalogTool[] => {
    try {
      return deps.tools.list().map((tool) => ({ name: tool.name, moduleId: tool.moduleId, risk: tool.risk, ...(tool.group ? { group: tool.group } : {}) }));
    } catch {
      return [];
    }
  };

  /** Kayıtlı araç adları; araç kaydı hazır değilse boş. */
  const registeredTools = (): Set<string> => new Set(catalogTools().map((tool) => tool.name));

  /** Modül kaydı; bağlanmamışsa ya da okunamazsa `null` (öz-tanım "bilinmiyor" der). */
  const catalogModules = (): CatalogModule[] | null => {
    if (!moduleCatalog) return null;
    try {
      return moduleCatalog().map(catalogModule);
    } catch (error) {
      log.debug(`modül kaydı okunamadı: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  };

  /** Modüllerin öz-tanıma kattıkları (kanca); hata veren parça atlanır. */
  const readParts = (): SelfPart[] => {
    const out: SelfPart[] = [];
    for (const [id, read] of selfParts) {
      try {
        const part = read();
        if (part) out.push(part);
      } catch (error) {
        log.debug(`öz-tanım parçası okunamadı (${id}): ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return out;
  };

  /** Öz-durum kaynağı (ses denetimi modülü); hata verirse `null`. */
  const readSource = (): SelfSource | null => {
    try {
      return selfSource?.() ?? null;
    } catch (error) {
      log.debug(`öz-durum kaynağı okunamadı: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  };

  /**
   * Kayıttan üretilen zengin öz-tanım: Claude Code ve bulut yolunun SABİT sistem istemine girer. Değişken bir şey
   * içermez; kayıt (modül, araç, ayar kataloğu, kişilik adı) değişince değişir ve ısıtılmış Claude Code süreçleri
   * bayatlar (`noteKnowledge`).
   */
  const selfKnowledge = (): string => {
    try {
      const source = readSource();
      return renderSelfKnowledge(
        buildCatalog({
          appName: DESKTOP_APP_NAME,
          appVersion: APP_VERSION,
          persona: deps.policy.get().persona.name,
          tools: catalogTools(),
          modules: catalogModules(),
          controls: source?.controls ?? null,
          parts: readParts(),
        }),
      );
    } catch (error) {
      log.warn('öz-tanım üretilemedi', error);
      return '';
    }
  };

  /**
   * Öz-tanım son görülenden farklıysa ısıtılmış boş Claude Code süreçleri kapatılır (eski öz-tanımla açılmışlardır).
   * Oturuma bağlı süreç zaten kimliği (istem dahil) değişince yenilenir; bu, bayat yedeğin RAM'de beklemesini önler.
   */
  let lastKnowledge: string | null = null;
  const noteKnowledge = (knowledge: string): string => {
    if (lastKnowledge !== null && lastKnowledge !== knowledge) {
      log.debug('öz-tanım değişti; ısıtılmış Claude Code süreçleri yenilenecek');
      claudeCode?.recycle();
    }
    lastKnowledge = knowledge;
    return knowledge;
  };

  /**
   * O anki gerçek çalışma durumu. Beyin kendi kısmını (hangi beyin, neden, hangi yetenekler) durum hesabından üretir;
   * ses hattı, Yönetim bağlantısı ve kısayollar bağlanan kaynaktan gelir. Kaynak yoksa ya da hata verirse o kısım
   * "bilinmiyor" kalır: uydurulmaz.
   */
  const selfState = (): SelfState => {
    const status = computeStatus();
    const policy = deps.policy.get();
    const source = readSource();
    const deep = deepState();
    const deepOk = deep.ok;
    const tools = catalogTools();
    const local = status.provider === 'local';
    // Süren işler: iş servisinin işleri (kaynaktan) + modüllerin bildirdikleri (takip işleri). İkisi de yoksa bilinmiyor.
    const parts = readParts();
    const partWork = parts.flatMap((part) => part.work ?? []);
    const work = source?.work === undefined || source.work === null ? (parts.some((part) => part.work) ? partWork : null) : [...source.work, ...partWork];
    const skills = new Set(localSkillTools());
    const groups = declaredGroups();
    return {
      appName: DESKTOP_APP_NAME,
      appVersion: APP_VERSION,
      brain: {
        provider: status.provider,
        reason: status.reason,
        cause: status.cause,
        model: local ? policy.brain.local.modelId : (status.cloud?.model ?? policy.models.voice.model),
        ...(status.cloud ? { cloudName: status.cloud.name } : {}),
        ...(status.cloud?.provider === 'claude-code' ? { claudeCode: true } : {}),
        deep,
      },
      voice: source?.voice ?? null,
      admin: source?.admin ?? null,
      hotkeys: source?.hotkeys ?? null,
      pc: source?.pc ?? null,
      work,
      ...(typeof deps.tools.authority === 'function' ? { authority: deps.tools.authority().level } : {}),
      capabilities: listCapabilities({
        clusters: buildClusters(tools, catalogModules()),
        local,
        localCallable: (name) => isLocalTool(name, groups.get(name)) || skills.has(name),
        deepOk,
        // Sağlayıcı bilgisi varsa (köprü) "derin beyin" denir; yoksa eski söyleyiş kalır ("bulut beyni gerekir").
        ...(deep.known === false
          ? { deepNeeds: 'derin beynin durumu henüz bilinmiyor' }
          : deep.provider !== undefined
            ? { deepNeeds: 'derin beyin gerekir; şu an yok' }
            : {}),
      }),
    };
  };

  /** İsteme giren öz-durum bloğu; üretilemezse boş (tur bozulmaz). `rich`: Claude Code ve bulut yolu. */
  const selfBlock = (options: SelfBlockOptions = {}): string => {
    try {
      return renderSelfBlock(selfState(), options);
    } catch (error) {
      log.warn('öz-durum bloğu üretilemedi', error);
      return '';
    }
  };

  const personaInput = () => ({ persona: deps.policy.get().persona, userName: user.name, userAddress: user.address });

  /** Anthropic isteğinin değişmeyen kısmı; `prewarm` ile gerçek tur aynı öneki üretir. */
  const anthropicPrefix = (
    role: BrainRole,
    style: PromptStyle,
    request: Pick<BrainRequest, 'tools' | 'extraTools' | 'serverTools' | 'instructions' | 'effort'>,
    refOverride?: ModelRef,
  ) => {
    const ref = refOverride ?? deps.policy.get().models[role];
    const params = modelParams(ref, request.effort);
    if (params.note) log.debug(params.note);
    const system = stableSystem(personaInput(), style, params.thinking?.type === 'disabled', request.instructions, style === 'plain' ? undefined : selfKnowledge());
    const tools: BetaToolUnion[] = [
      ...toolSpecs(request, role, null).map((spec) => ({
        name: spec.name,
        description: spec.description,
        input_schema: spec.inputSchema as { type: 'object'; [key: string]: unknown },
        eager_input_streaming: true,
      })),
      ...serverToolDefs(ref.model, request.serverTools),
    ];
    const base: AnthropicBase = {
      model: ref.model,
      ...(tools.length ? { tools } : {}),
      ...(params.thinking ? { thinking: params.thinking } : {}),
      ...(params.effort ? { output_config: { effort: params.effort } } : {}),
      ...(params.speed ? { speed: params.speed } : {}),
      ...(params.fallback ? { betas: [SERVER_FALLBACK_BETA], fallbacks: 'default' as const } : {}),
    };
    return { base, system };
  };

  const relevantMemories = (messages: ConvMessage[], limit: number): MemorySearchHit[] => {
    const lastUser = [...messages].reverse().find((message) => message.role === 'user');
    if (!lastUser || lastUser.role !== 'user') return [];
    try {
      return deps.memory.search({ text: lastUser.text, limit });
    } catch (error) {
      log.warn('hafıza araması başarısız', error);
      return [];
    }
  };

  const safePresence = () => {
    try {
      return deps.presence.get();
    } catch {
      return null;
    }
  };

  const runExtraTool = async (
    def: ToolDef,
    context: ModuleContext,
    input: unknown,
    origin: Origin,
    callId: string,
    signal: AbortSignal,
    onReport: (step: string) => void,
  ): Promise<ToolResult> => {
    if (deps.policy.killSwitchActive()) return { ok: false, text: t('tool.error.killSwitch') };
    const parsed = def.input.safeParse(input);
    if (!parsed.success) return { ok: false, text: t('tool.error.invalidInput', { detail: parsed.error.message }) };
    if (def.risk === 'danger') {
      const decision = await deps.tools.requestApproval({
        toolName: def.name,
        moduleId: context.moduleId,
        summary: def.approvalText?.(parsed.data) ?? def.description,
        input: parsed.data as JsonObject,
        origin,
      });
      if (decision !== 'approved') return { ok: false, text: t('tool.error.denied') };
    }
    try {
      return await def.run(parsed.data, { ...context, callId, origin, signal, report: onReport });
    } catch (error) {
      return { ok: false, text: t('tool.error.failed', { detail: error instanceof Error ? error.message : String(error) }) };
    }
  };

  /** Claude Code turunun beyin servisinden aldığı yardımcılar. */
  const claudeCodeEnv = (): ClaudeCodeTurnEnv => ({
    cc: claudeCode!,
    log,
    tools: deps.tools,
    now,
    personaInput,
    toolSpecs: (request, role) => toolSpecs(request, role, null),
    selfBlock: () => selfBlock({ rich: true }),
    selfKnowledge: () => noteKnowledge(selfKnowledge()),
    memories: relevantMemories,
    userContext: (text, style) => readUserContext(text, false, style),
    contextHints: (names) => deps.tools.contextHints?.(names) ?? [],
    declaredGroup: (name) => declaredGroups().get(name),
    presence: safePresence,
    recordUsage,
    runExtraTool,
    maxSteps: () => deps.policy.get().limits.maxAgentSteps,
    memoryLimit: LIMITS.memoryContextItems,
  });
  /** Açıkça `claude-code` seçilmiş rolde çağrının efor isteği (yazılı sohbet: `CHAT_EFFORT`) geçerlidir. */
  const claudeCodeEffort = (target: Extract<Route, { kind: 'claude-code' }>, request: Pick<BrainRequest, 'effort'>): ClaudeCodeTarget =>
    target.implicit ? target.target : { model: target.target.model, effort: request.effort ?? target.target.effort };
  /** Isıtılan sürecin kimliği: gerçek turun kuracağıyla bayt bayt aynı olmalı (yoksa yedek kullanılmaz). */
  const claudeCodeSpec = (role: BrainRole, origin: Origin, target: Extract<Route, { kind: 'claude-code' }>): ClaudeCodeSpec => {
    const style = styleFor(role, origin, role === 'voice' || role === 'deep');
    const resolved = claudeCodeEffort(target, role === 'deep' ? { effort: CHAT_EFFORT } : {});
    return {
      kind: style === 'voice' ? 'voice' : style === 'chat' ? 'chat' : 'task',
      model: resolved.model,
      effort: resolved.effort,
      system: claudeCodeSystem(personaInput(), style, undefined, style === 'plain' ? undefined : noteKnowledge(selfKnowledge())),
      tools: toolSpecs({}, role, null),
      maxTurns: deps.policy.get().limits.maxAgentSteps,
    };
  };

  /**
   * Veda sözünün ("güle güle", "görüşürüz", "iyi geceler") kodla verilen yanıtı; söz veda değilse `null`. Sohbeti
   * BİTİRME isteğidir ve hiçbir sağlayıcıda modele bırakılmaz. Öteki yollar (Anthropic API, OpenAI uyumlu, yerel) aynı
   * işi tur döngüsünün içinde yapar; Claude Code'un turu kendi dosyasında yürüdüğü için oraya girmeden burada kesilir.
   */
  const farewellReply = async (role: BrainRole, request: BrainRequest): Promise<BrainResponse | null> => {
    const persona = request.persona ?? (role === 'voice' || role === 'deep');
    const style = styleFor(role, request.origin, persona);
    if (!persona || style === 'plain' || style === 'task') return null;
    const last = (request.messages ?? [{ role: 'user' as const, text: request.text ?? '' }]).at(-1);
    if (!last || last.role !== 'user') return null;
    const farewell = farewellIntent(ownWords(last.text).text, [personaInput().persona.name]);
    if (!farewell) return null;
    const started = Date.now();
    const toolCalls: ToolCallSummary[] = [];
    if ((request.tools === undefined || request.tools === 'all') && deps.tools.has(END_CONVERSATION_TOOL)) {
      const callId = newId();
      request.onToolCall?.({ phase: 'start', callId, name: END_CONVERSATION_TOOL, input: {} });
      let outcome: ToolResult;
      try {
        outcome = await deps.tools.run(END_CONVERSATION_TOOL, {}, { callId, origin: request.origin, ...(request.signal ? { signal: request.signal } : {}) });
      } catch (error) {
        outcome = { ok: false, text: t('tool.error.failed', { detail: error instanceof Error ? error.message : String(error) }) };
      }
      const durationMs = Date.now() - started;
      request.onToolCall?.({ phase: 'end', callId, name: END_CONVERSATION_TOOL, ok: outcome.ok, text: outcome.text, durationMs });
      toolCalls.push({ callId, name: END_CONVERSATION_TOOL, ok: outcome.ok, text: outcome.text.slice(0, 300), durationMs });
    }
    const who = personaInput().userAddress?.trim() || personaInput().persona.address;
    const text = t(farewell === 'night' ? 'voice.conversation.farewellNight' : 'voice.conversation.farewell', { address: who ? ` ${who}` : '' });
    request.onText?.(text);
    request.onSentence?.(text);
    return { text, stopReason: 'end', error: null, toolCalls, usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, durationMs: Date.now() - started } };
  };

  /** Seçilen sağlayıcıyla bir turu baştan sona yürütür. Fırlatmaz; bulut düşüşünü `cloudDown` ile bildirir. */
  const loop = async (
    role: BrainRole,
    request: BrainRequest,
    target: Exclude<Route, { kind: 'blocked' }>,
    onStep?: (step: { index: number; text: string; toolNames: string[] }) => void,
  ): Promise<{
    response: BrainResponse;
    cloudDown: BrainCloudIssue | null;
    streamed: boolean;
    localRetry?: 'busy' | 'model' | 'forbidden' | null;
    /** Tur Claude Code yüzünden yürümediyse nedeni (yalnız o yolda). */
    ccFailure?: { issue: BrainCloudIssue; reason: string } | null;
  }> => {
    // Yalnız bulut istendi (ortam dinlemenin söze girme sorusu): yerel model ne birincil ne düşüş olarak yürür.
    if (target.kind === 'local' && request.cloudOnly) {
      return { response: { text: '', stopReason: 'error', error: t('brain.status.noBrain'), toolCalls: [], usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, durationMs: 0 } }, cloudDown: null, streamed: false };
    }
    // Claude Code: araç döngüsünü CLI yürütür; tur kendi dosyasındadır (`brain/claude-code/turn.ts`).
    if (target.kind === 'claude-code') {
      // Veda sözü Claude Code yolunda da modele gitmez (aşağıdaki öteki yollarla aynı kural): kodla yanıtlanır.
      const bye = await farewellReply(role, request);
      if (bye) return { response: bye, cloudDown: null, streamed: true, ccFailure: null };
      const result = await runClaudeCodeTurn(claudeCodeEnv(), role, request, claudeCodeEffort(target, request), onStep);
      return { response: result.response, cloudDown: null, streamed: result.streamed, ccFailure: result.failure };
    }
    const started = Date.now();
    const totals = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
    const toolCalls: ToolCallSummary[] = [];
    let text = '';
    let streamed = false;
    const finish = (stopReason: BrainStopReason, error: string | null, cloudDown: BrainCloudIssue | null = null) => ({
      response: { text: text.trim(), stopReason, error, toolCalls, usage: { ...totals, durationMs: Date.now() - started } },
      cloudDown,
      streamed,
    });

    const persona = request.persona ?? (role === 'voice' || role === 'deep');
    const style = styleFor(role, request.origin, persona);
    const local = target.kind === 'local';
    const signal = request.signal;
    const sessionId = request.origin.sessionId;
    let messages = toConv(request.messages ?? [{ role: 'user', text: request.text ?? '' }]);
    while (messages[0]?.role === 'assistant') messages.shift();
    if (messages.length === 0 || messages.at(-1)?.role !== 'user') return finish('error', t('brain.error.badRequest'));

    let provider: BrainProvider;
    let stable: string;
    let tools: ToolSpec[];
    /** Yerel turda son kullanıcı sözü ve ondan önceki asistan yanıtı (yineleme isteği, üslup süzgeci, ses niyeti). */
    // Söze gömülü ek metni (belge çerçevesi) kullanıcının sözü değildir: niyet, saat, "yaptım" çözümlemelerine girmez.
    const lastOwn = (() => {
      const last = messages.at(-1);
      return ownWords(last?.role === 'user' ? last.text : '');
    })();
    const lastSaid = lastOwn.text;
    const previousReply = messages.reduce<string | null>((found, message) => (message.role === 'assistant' && message.text.trim() ? message.text : found), null);
    // "Bir daha söyler misin": tur araçsız yürür; model yalnız son yanıtını yeniden söyler (yapılmış işi yeniden yapmaz).
    const repeatAsked = local && style !== 'plain' && style !== 'task' && previousReply !== null && isRepeatRequest(lastSaid, foldTr);
    /** Bu sözden önceki kullanıcı sözü (yalnız kendi sözü: özet, gün etiketi, ek notu ve gömülü belge ayıklanmış). */
    const previousSaid = (() => {
      const before = messages.filter((message) => message.role === 'user').at(-2);
      return before?.role === 'user' ? ownHistoryText(before.text) || null : null;
    })();
    // "Az önce ne söylemiştim / ne dedin?": yanıt geçmişte AYNEN durur; modele bırakılmaz, tur araçsız ve modelsiz biter.
    const recall = local && persona && style !== 'plain' && style !== 'task' ? recallIntent(lastSaid) : null;
    // "Az önce hangi projeden bahsetmiştim?": yanıtı model seçer ama geçmişteki söz sorunun yanına konur, tur araçsız yürür.
    const recallDetail = local && persona && style !== 'plain' && style !== 'task' && recall === null && previousSaid !== null && asksRecentDetail(lastSaid);
    // Sözde sayılan kalemler ("süt, ekmek ve yumurta"): modelin ekleme çağrısı bunlarla düzeltilir (`local-lists.ts`).
    const spokenItems = local && persona && style !== 'plain' && style !== 'task' && !repeatAsked ? spokenList(lastSaid, previousSaid ?? '') : null;
    if (local) {
      let baseUrl: string;
      try {
        baseUrl = await localServer!.ensure();
      } catch (error) {
        const reason = error instanceof Error ? error.message : t('brain.error.localUnavailable');
        // Bulut bu turda düştü ve yerel beyin de açılamadı (ör. ekran belleği başka uygulamada): kullanıcı yalnız "ekran
        // belleği yok" duyarsa asıl nedeni (abonelik sınırı, kredi…) bilmez. Neden cümlesinin ilk yarısı ("…sınırı doldu")
        // yerelin sorunuyla birlikte söylenir; "bu bilgisayardaki modelle devam ediyorum" yarısı söylenmez (doğru değil).
        // Duyuru kuralı aynıdır: günde en çok bir kez, neden başına (`claimNotice`).
        if (target.fallback && target.dropped === true && persona && style !== 'task' && claimNotice(`${target.cc ? 'claude-code' : (target.via ?? 'bulut')}:${target.why ?? 'yok'}`)) {
          const notice = fallbackNotice(target.why, target.via, target.cc);
          const cause = notice.includes(';') ? notice.slice(0, notice.indexOf(';')).trim() : notice.replace(/[.\s]+$/, '');
          return finish('error', t('brain.error.localAlsoDown', { cause, reason: reason.replace(/[.\s]+$/, '') }));
        }
        return finish('error', reason);
      }
      const policy = deps.policy.get();
      provider = localProvider({ baseUrl, modelId: policy.brain.local.modelId, ...(options.localFetch ? { fetchFn: options.localFetch } : {}) });
      if (style === 'plain') {
        stable = request.instructions ?? '';
      } else {
        // Sistem istemi turdan tura AYNI kalır (kişilik + kurallar + öz-durum); saat ve hafıza son kullanıcı iletisine
        // eklenir. Böylece sunucu sistem istemini ve araç tanımlarını önbellekten okur.
        const block = selfBlock();
        // Kayıtlı bilgi araçları kuralda adıyla geçer (sayfa okuma hariç: o, aramanın devamıdır).
        const registered = registeredTools();
        const infoTools = LOCAL_TOOLS_INFO.filter((name) => name !== 'web_read' && registered.has(name));
        const browserTools = ['browser_search', 'browser_navigate'].filter((name) => registered.has(name));
        stable = compactSystem(personaInput(), style, infoTools, browserTools) + (block ? `\n\n${block}` : '');
        if (request.instructions?.trim()) stable += `\n\n${request.instructions.trim()}`;
      }
      // Kendine yetenek ekleme önerisine kısa onay ("evet, ekle"): yetenek kümesi açılır (`routingTexts`).
      const said = routingTexts(messages.flatMap((message) => (message.role === 'user' ? [message.text] : [])).reverse(), previousReplyOf(messages));
      tools = repeatAsked || recall || recallDetail ? [] : toolSpecs(request, role, said);
    } else if (target.kind === 'openai') {
      // OpenAI uyumlu bulut: bulut beyni gibi tam istem ve bütün araçlar (özgün tanımlarıyla); fark sağlayıcı katmanında.
      const { endpoint, apiKey, ref, model } = target.target;
      provider = openAiCompatibleProvider({
        endpoint,
        apiKey,
        model,
        effort: request.effort ?? ref.effort,
        thinking: ref.thinking,
        price: ref.price,
        ...(options.cloudFetch ? { fetchFn: options.cloudFetch } : {}),
      });
      stable = stableSystem(personaInput(), style, false, request.instructions, style === 'plain' ? undefined : selfKnowledge());
      tools = toolSpecs(request, role, null);
    } else {
      const api = client()!;
      const prefix = anthropicPrefix(role, style, request, modelRefFor(deps.policy.get(), role, request.origin));
      provider = anthropicProvider(api, prefix.base, log);
      stable = prefix.system;
      tools = [];
    }

    let budgetNotice = false;
    if (!local && role === 'voice' && persona && deps.usage.overBudget() && budgetToldOn !== localDay(now())) {
      budgetNotice = true;
      budgetToldOn = localDay(now());
    }
    const memories = style === 'plain' ? [] : relevantMemories(messages, local ? 4 : LIMITS.memoryContextItems);
    // Kullanıcı profili (kanca): bulut yollarında değişken kuyruğa, yerelde `<baglam>` notuna (kısa biçim) girer.
    const userBlock = userContextBlock(readUserContext(lastSaid, local, style));
    const system = stable
      ? {
          stable,
          tail: local
            ? ''
            : variableTail({ now: now(), presence: safePresence(), memories, budgetNotice, self: style === 'plain' ? null : selfBlock({ rich: true }), user: userBlock }),
        }
      : null;
    const maxTokens = local ? (style === 'voice' ? LOCAL_VOICE_MAX_TOKENS : 2048) : maxTokensFor(role, style);
    let resolvedTime: TrTimeResult | null = null;
    let timeInContext = false;
    let narrative = false;
    if (local) {
      // Sözdeki zaman ifadesi kodla çözülür (küçük model tarih hesabında güvenilmez) ve modele hazır verilir.
      if (style !== 'plain' && style !== 'task' && !repeatAsked) resolvedTime = resolveSpokenTime(lastSaid, now(), foldTr);
      // Saat yalnız zamanla ilgili olabilecek sözde (bu ya da bir önceki söz) bağlama girer; sorulmadan okunmasın.
      const recentSaid = messages.flatMap((message) => (message.role === 'user' ? [message.text] : [])).slice(-2);
      timeInContext = style !== 'plain' && (style === 'task' || resolvedTime !== null || recentSaid.some((said) => isTimeRelevant(said, foldTr)));
      // Anlatı isteğinde (fıkra, özet, "ne yaptın") eylem fiili içeriktir; iddia kapısı çalışmaz.
      narrative = isNarrativeRequest(recentSaid, foldTr);
      // Söz asistanın kendisiyle ilgiliyse öz-durumun ilgili satırı sorunun yanına da konur.
      let hints: string[] = [];
      if (style !== 'plain' && style !== 'task') {
        try {
          hints = selfHints(selfState(), lastSaid);
        } catch {
          // Öz-durum okunamadıysa ipucu yok; blok zaten "bilinmiyor" der.
        }
        if (recallDetail && previousSaid) {
          const quote = previousSaid.length > RECALL_QUOTE_CHARS ? `${previousSaid.slice(0, RECALL_QUOTE_CHARS)}…` : previousSaid;
          hints.push(`Kullanıcı bu konuşmada az önce şunu söyledi: "${quote}". Soru bu söz hakkında: yanıtı buradan, tek cümleyle ver.`);
        }
        // Oturumun ilk sözünde "az önce ne söylemiştim?": geçmiş boştur, bakılacak yer hafızadır.
        if (asksEarlier(lastSaid) && recentSaid.length <= 1 && tools.some((tool) => tool.name === 'memory_search')) {
          hints.push('Bu konuşmada daha önce söylenmiş bir söz yok; "Bu konuşmada daha önce bir şey söylemediniz" de. Hafızaya bakmadan "hafızamda yok" deme; bakmak istersen memory_search çağır.');
        }
        // Kalemler sayılmadan liste istendi: maddeleri model belirler; isteğin kendisi madde yazılmasın.
        if (!spokenItems && asksInventedList(lastSaid) && tools.some((tool) => tool.name === 'todo_add_many')) hints.push(inventListHint(lastSaid));
      }
      // Bu turda sunulan araçların kendi güncel durumu (örn. pano: hangi kartlar, hangi sırada): model göremediği
      // yüzeyi bilerek araç çağırır.
      if (style !== 'plain' && tools.length > 0) hints.push(...(deps.tools.contextHints?.(tools.map((tool) => tool.name)) ?? []));
      const note = style === 'plain' ? '' : contextNote({ now: now(), presence: safePresence(), memories, resolved: resolvedTime, includeNow: timeInContext, hints, user: userBlock });
      const contextTokens = deps.policy.get().brain.local.contextTokens;
      const fixed = estimateTokens((system?.stable ?? '') + note + JSON.stringify(tools));
      const hard = Math.max(512, contextTokens - fixed - maxTokens);
      // Sesli turda geçmiş ayrıca kendi payıyla sınırlıdır; yazılı sohbette iletiler uzundur, pay geniştir.
      const budget = style === 'voice' ? LOCAL_HISTORY_BUDGET : 3 * LOCAL_HISTORY_BUDGET;
      const target = style === 'voice' ? LOCAL_HISTORY_TARGET : 3 * LOCAL_HISTORY_TARGET;
      messages = trimToContext(messages, Math.min(hard, budget), Math.min(hard, target));
      const last = messages.at(-1);
      if (last?.role === 'user' && (note || repeatAsked)) {
        messages[messages.length - 1] = { ...last, text: `${note ? `${note}\n` : ''}${last.text}${repeatAsked ? `\n${REPEAT_NOTE}` : ''}` };
      }
    }

    const splitter = new SentenceSplitter();
    const emitText = (delta: string, stepTextEmpty: boolean) => {
      if (!delta) return;
      if (stepTextEmpty && text !== '' && !/\s$/.test(text) && !/^\s/.test(delta)) {
        // Araç turları arasında metin bitişik gelmesin.
        text += ' ';
        request.onText?.(' ');
      }
      streamed = true;
      text += delta;
      request.onText?.(delta);
      for (const sentence of splitter.push(delta)) request.onSentence?.(sentence);
    };
    const flushSentences = () => {
      for (const sentence of splitter.flush()) request.onSentence?.(sentence);
    };

    // Veda sözü ("güle güle", "bay bay", "görüşürüz", "iyi geceler"): sohbeti BİTİRME isteğidir. Modele bırakılmaz (yerelde
    // de bulutta da): küçük model bu sözde mikrofonu kapatıyor ya da dinlemeyi duraklatıyordu. Sohbet kipi ve takip
    // dinlemesi araçla biter (mikrofon ve uyandırma açık kalır), tek kısa veda söylenir. Çağıran araçları daralttıysa
    // (`tools: [...]`, `'none'`) kod araç çalıştırmaz; veda yine söylenir.
    const farewell = persona && style !== 'plain' && style !== 'task' ? farewellIntent(lastSaid, [personaInput().persona.name]) : null;
    if (farewell) {
      if ((request.tools === undefined || request.tools === 'all') && deps.tools.has(END_CONVERSATION_TOOL)) {
        const callId = newId();
        const toolStarted = Date.now();
        request.onToolCall?.({ phase: 'start', callId, name: END_CONVERSATION_TOOL, input: {} });
        let outcome: ToolResult;
        try {
          outcome = await deps.tools.run(END_CONVERSATION_TOOL, {}, { callId, origin: request.origin, ...(signal ? { signal } : {}) });
        } catch (error) {
          outcome = { ok: false, text: t('tool.error.failed', { detail: error instanceof Error ? error.message : String(error) }) };
        }
        const durationMs = Date.now() - toolStarted;
        request.onToolCall?.({ phase: 'end', callId, name: END_CONVERSATION_TOOL, ok: outcome.ok, text: outcome.text, durationMs });
        toolCalls.push({ callId, name: END_CONVERSATION_TOOL, ok: outcome.ok, text: outcome.text.slice(0, 300), durationMs });
      }
      const who = personaInput().userAddress?.trim() || personaInput().persona.address;
      emitText(t(farewell === 'night' ? 'voice.conversation.farewellNight' : 'voice.conversation.farewell', { address: who ? ` ${who}` : '' }), true);
      flushSentences();
      return finish('end', null);
    }

    // Yerel modele düşüldüğü günde en çok bir kez ve yalnız gerektiğinde söylenir: bulut bu turda düştüyse ya da
    // kullanıcı derin beyin isteyen bir iş istediyse ve o beyin yoksa. Her yeni sohbetin başında söylenmez.
    if (local && target.fallback && persona && style !== 'task' && (target.dropped === true || wantsMissingDeep(request, role, lastSaid)) && claimNotice(`${target.cc ? 'claude-code' : (target.via ?? 'bulut')}:${target.why ?? 'yok'}`)) {
      // Neden neyse o söylenir: anahtar hiç yokken "ulaşamıyorum", kredi yokken "ulaşamıyorum" yanlış olur.
      emitText(`${fallbackNotice(target.why, target.via, target.cc)} `, true);
      flushSentences();
    }

    // "Az önce ne söylemiştim?" → kullanıcının bir önceki sözü; "az önce ne dedin?" → asistanın bir önceki yanıtı.
    // İkisi de sohbet geçmişinden AYNEN okunur (hafıza araması değil). Geçmiş boşsa bunu dürüstçe söyler.
    if (recall) {
      const earlier = recall === 'user' ? previousSaid : previousReply ? spokenPart(previousReply) : null;
      const quote = earlier && earlier.length > RECALL_QUOTE_CHARS ? `${earlier.slice(0, earlier.lastIndexOf(' ', RECALL_QUOTE_CHARS) > 80 ? earlier.lastIndexOf(' ', RECALL_QUOTE_CHARS) : RECALL_QUOTE_CHARS).trimEnd()}…` : earlier;
      emitText(
        !quote ? t(recall === 'user' ? 'brain.local.recallNone' : 'brain.local.recallNoReply') : recall === 'user' ? t('brain.local.recallUser', { text: quote }) : quote,
        true,
      );
      flushSentences();
      return finish('end', null);
    }

    // Ses denetimi sözleri yerelde kodla eşlenir (`local-intents.ts`): kesin söz aracı doğrudan çalıştırır, belirsiz
    // söz ("sesi kapat") için model yerine sabit soru sorulur. Yalnız ilgili araç bu turda sunuluyorsa.
    // "Bir daha söyler misin" (sesli tur): son yanıt AYNEN yeniden söylenir; model çağrılmaz (ölçüm: model araçsız turda
    // da kimi zaman içeriği yinelemek yerine "bir daha konuşurum" dedi). Yazılı sohbette model araçsız yanıtlar.
    if (repeatAsked && style === 'voice' && previousReply) {
      const again = spokenPart(previousReply);
      if (again) {
        emitText(again, true);
        flushSentences();
        return finish('end', null);
      }
    }
    /** Bir önceki turda araçla yapılan işler (geçmişteki "(yapıldı: …)" notundan). */
    const justDone = new Set(local ? doneToolsOf(previousReply) : []);
    const voiceAsk = t('brain.local.voiceAsk');
    const intent = local && persona && style !== 'task' && !repeatAsked ? routeVoiceIntent(lastSaid, previousReply?.includes(voiceAsk) ?? false) : null;
    const offered = (name: string) => tools.some((spec) => spec.name === name);
    if (intent?.kind === 'ask' && offered('voice_mute_mic') && offered('voice_set_quiet')) {
      emitText(voiceAsk, true);
      flushSentences();
      return finish('end', null);
    }
    /**
     * Kararını KODUN verdiği araç çağrıları (kimlikleri): o turda modele sunulmamış olsalar da çalışırlar. Sözden kesin
     * eşlenen komutlar ("söz kesme sınamasını başlat", "ayarları aç") ve kullanıcının saydığı kalemlerle düzeltilen
     * ekleme çağrısı böyledir; "sunulmayan araç çağrılamaz" kuralı modelin kendi seçimleri içindir.
     */
    const codeCalls = new Set<string>();
    // Sesle sınama başlatma, gezinme ve "ne ayarlayabilirim" kodla eşlenir (`local-commands.ts`): bu sözlerdeki "aç /
    // başlat" fiili uygulama açma kümesini de açar; küçük modele bırakılırsa `app_open` ile yanlış şeyi açabilir.
    // Çağıran araçları daralttıysa (`tools: [...]`, `'none'`) kod kendiliğinden başka araç çalıştırmaz.
    const openTools = tools.length > 0 && (request.tools === undefined || request.tools === 'all');
    const command = local && persona && style !== 'task' && !repeatAsked && intent === null && openTools ? routeSpokenCommand(lastSaid) : null;
    const commandCallable = command !== null && deps.tools.has(command.name) && isLocalTool(command.name, declaredGroups().get(command.name));
    // Açık bir listeye ekleme buyruğu ("alışveriş listesine süt, ekmek ve yumurta ekle", "yapılacaklara şunları ekle: …"):
    // kalemler sözde sayılmıştır, çağrıyı kod yapar. Ölçüm: bu sözde 21 araç sunulan bir turda model mikrofonu kapattı.
    // Sözde zaman varsa ("yarın …") son günü model verir; o durumda çağrı modelde kalır ve kalemleri düzeltilir.
    const listAdd =
      spokenItems?.explicit && intent === null && command === null && resolvedTime === null && openTools && deps.tools.has('todo_add_many')
        ? { name: 'todo_add_many', input: { items: spokenItems.items.map((item) => ({ text: item })) } }
        : null;
    // Eklentilerin kayıtlı sesli komut kalıpları (`spoken-routes.ts`): yerleşik kalıpların tanımadığı kesin söz.
    const routed = local && persona && style !== 'task' && !repeatAsked && intent === null && command === null && listAdd === null && openTools ? matchSpokenRoute(lastSaid) : null;
    const routedCall = routed !== null && deps.tools.has(routed.name) ? routed : null;
    const seedCall = intent?.kind === 'call' && offered(intent.name) ? intent : commandCallable ? command : (listAdd ?? routedCall);
    let seeded: ProviderTurnResult | null = seedCall
      ? {
          text: '',
          toolCalls: [{ id: `call_${newId()}`, name: seedCall.name, input: seedCall.input }],
          stop: 'tool_use',
          usage: { provider: 'local', model: deps.policy.get().brain.local.modelId, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 },
        }
      : null;
    // Kesin sözden eşlenen ses denetimi çağrısı da kodun kararıdır (aracı zaten sunulmuştur).
    if (seeded) codeCalls.add(seeded.toolCalls[0]!.id);

    const maxSteps = request.maxSteps ?? deps.policy.get().limits.maxAgentSteps;
    let previousSignature: string | null = null;
    let repeats = 0;
    let nudged = false;
    /** Önceki yanıtın yinelenmesi bir kez uyarılır; ikinci kez süzülmez. */
    let repeatNudged = false;
    /** Uyarıdan sonraki tek adımda araç çağrısı zorunlu tutulur (aşağıya bakın). */
    let requireTool = false;
    /** Geri çevrilen liste eklemesi bir kez araçla yeniden denendi. */
    let listRetried = false;
    const address = personaInput().userAddress?.trim() || personaInput().persona.address;
    /** Üslup süzgecinin tur boyu sayacı (hitap bütün turda bir kez). */
    const styleShared = { emitted: 0 };
    /** Bir bilgisayar aracı "DURDUM" döndürdü: turun kalanında yerel model araç çağıramaz, yalnız konuşur. */
    let halted = false;
    /**
     * Okuma kapısı: söz, yanıtı araçla OKUNMADAN verilemeyecek bir şey soruyorsa (kullanıcının belgesi, ekranı, açık
     * sayfası, güncel veri) ve ilgili araç sunulmuşsa, araçsız verilen ve sayı/tarih söyleyen yanıt iletilmez; okuma
     * aracı zorunlu tutulur. Ölçüm (belge ajanı): model belgedeki son ödeme gününü araç çağırmadan uydurdu.
     * Söze eklenen belgenin metni iletinin içindeyse (`attachment_id: "…"`) kapı çalışmaz: model oradan okur.
     */
    const mustRead =
      local && !repeatAsked && !lastOwn.embedded && groundingGroups(lastSaid, tools.map((tool) => tool.name), (name) => declaredGroups().get(name)).length > 0;
    let readNudged = false;
    /** Öz-durum: yanıt cümlesi bilinen duruma aykırıysa düzeltilir (yalnız kişilikli yerel turda). */
    let turnSelf: SelfState | null | undefined;
    const fixSelfClaim = (sentence: string): string => {
      if (!local || !persona || style === 'task') return sentence;
      if (turnSelf === undefined) {
        try {
          turnSelf = selfState();
        } catch {
          turnSelf = null;
        }
      }
      const fixed = turnSelf ? correctSelfClaim(turnSelf, sentence) : null;
      if (fixed) log.debug('yanıt cümlesi öz-duruma aykırıydı; düzeltildi');
      return fixed ?? sentence;
    };
    /** Az önce yapılmış bir iş yeniden istenmeden çağrıldı ve engellendi. */
    let redoBlocked = false;
    /**
     * Sesli turun söz sınırı (`LOCAL_VOICE_BRIEF`): yalnız yerel sesli turda; anlatı isteğinde, kullanıcı ayrıntı
     * istediğinde ve yineleme isteğinde yoktur. `briefSpoken`: bu turda kullanıcıya iletilen cümle ve sözcük sayısı.
     */
    const briefLimit = local && persona && style === 'voice' && !narrative && !repeatAsked && !WANTS_DETAIL.test(foldTr(lastSaid));
    const briefSpoken = { sentences: 0, words: 0 };
    /** Cümle içi öbek döngüsü yüzünden adım bir kez yeniden denendi. */
    let degenerateRetried = false;
    try {
      for (let step = 0; step < maxSteps; step++) {
        if (signal?.aborted) return finish('aborted', null);
        let stepText = '';
        // Yerelde cümle kapısı: eylem iddiası, turda başarılı araç yokken bekletilir (aşağıda karar verilir).
        // Yineleme isteğinde kapalıdır: model geçmişte yaptığı işi yeniden SÖYLER ("…kurdum"), yeni iddia değildir.
        const gate = local ? { splitter: new SentenceSplitter(), held: [] as string[] } : null;
        // Üslup süzgeci (kalıp teklif, her cümlede hitap, önceki yanıtın yinelenmesi): yalnız kişilikli yerel turda.
        const styleFilter =
          local && persona && style !== 'task'
            ? createReplyFilter({
                address,
                previousReply,
                allowRepeat: repeatAsked || repeatNudged,
                // Zaman sorulmadıysa ve bu turda zamanlı bir iş yapılmadıysa saati okuyan cümle atılır.
                unaskedTime: timeInContext && !resolvedTime && !isTimeAsked(lastSaid, foldTr) && toolCalls.length === 0 ? now() : null,
                shared: styleShared,
              })
            : null;
        const toolSucceeded = () => toolCalls.some((call) => call.ok);
        const wordsOf = (sentence: string) => sentence.split(/\s+/).filter(Boolean).length;
        /** Sesli turun söz sınırı doldu mu (`LOCAL_VOICE_BRIEF`); araç sonucu okunan turda pay biraz geniştir. */
        const briefFull = (extra = { sentences: 0, words: 0 }) => {
          const sentences = briefSpoken.sentences + extra.sentences;
          if (!briefLimit || sentences === 0) return false;
          const afterTool = toolCalls.length > 0;
          return (
            sentences >= (afterTool ? LOCAL_VOICE_BRIEF.sentencesAfterTool : LOCAL_VOICE_BRIEF.sentences) ||
            briefSpoken.words + extra.words >= (afterTool ? LOCAL_VOICE_BRIEF.wordsAfterTool : LOCAL_VOICE_BRIEF.words)
          );
        };
        /** Cümleyi kullanıcıya iletir ve sayar; söz sınırı dolduysa iletmez. */
        const emitSpoken = (sentence: string) => {
          if (briefFull()) return;
          briefSpoken.sentences++;
          briefSpoken.words += wordsOf(sentence);
          // Sonuna boşluk: cümle bölücü bir sonraki parçayı beklemeden cümleyi hemen versin.
          emitText(`${sentence} `, true);
        };
        let unreadHeld = false;
        /** Bu adımda araçsız pano iddiası tutuldu (son çare yanıtı panoya özgü dürüst cümledir). */
        let panoHeld = false;
        /** Bu adımda bekletilen (henüz iletilmemiş) cümle ve sözcükler; söz sınırı bunları da sayar. */
        const heldSpoken = { sentences: 0, words: 0 };
        const passSentence = (sentence: string) => {
          if (!gate) return;
          // Pano cümlesi ("en üste taşıdım") ancak bu turda başarılı bir PANO aracı varsa geçer (`pano-claim.ts`).
          const panoUnfounded = unfoundedPanoClaim(sentence, toolCalls);
          if (panoUnfounded) panoHeld = true;
          const unfounded = ((ACTION_CLAIM.test(sentence) || (tools.length > 0 && announcesAction(sentence, foldTr))) && !toolSucceeded()) || panoUnfounded;
          // Okunmadan söylenen olgu (sayı, tarih, tutar): bu turda hiç araç çağrılmadıysa tutulur.
          const unread = mustRead && toolCalls.length === 0 && STATES_FACT.test(sentence);
          if (unread) unreadHeld = true;
          const hold = !repeatAsked && !redoBlocked && (unread || (!narrative && (gate.held.length > 0 || unfounded)));
          if (hold) {
            heldSpoken.sentences++;
            heldSpoken.words += wordsOf(sentence);
            gate.held.push(sentence);
          } else emitSpoken(sentence);
        };
        // Küçük model kimi zaman aynı cümleyi sonsuza dek yineler (ölçüm: "bir fıkra anlat" → aynı iki cümle çıktı
        // sınırına kadar, ~3 sn boş bekleme ve hata). Yanıtta daha önce geçmiş bir cümle yeniden gelirse üretim kesilir;
        // o ana kadar söylenen kalır.
        const said = new Set<string>();
        const stepAbort = new AbortController();
        let loopCut = false;
        /** Akışın son karakterleri (cümle içi öbek döngüsü denetimi) ve döngünün cümle içinde yakalandığı. */
        let tail = '';
        let phraseLoop = false;
        /** Sesli yanıt söz sınırına ulaştı: üretim cümle sonunda kesildi (o ana kadar söylenen yanıttır). */
        let briefCut = false;
        const feed = (sentence: string) => {
          if (loopCut || briefCut) return;
          const key = foldTr(sentence).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
          if (key.split(' ').length >= 3) {
            if (said.has(key)) {
              loopCut = true;
              stepAbort.abort();
              return;
            }
            said.add(key);
          }
          for (const kept of styleFilter ? styleFilter.push(sentence) : [sentence]) passSentence(fixSelfClaim(kept));
          // Söylenen (ve bu adımda bekletilen) söz sınıra ulaştıysa üretim kesilir: model konuşmayı sürdürmesin.
          if (briefFull(heldSpoken)) {
            briefCut = true;
            stepAbort.abort();
          }
        };
        const callStarted = Date.now();
        let result: ProviderTurnResult;
        if (seeded) {
          result = seeded;
        } else {
          try {
            result = await provider.turn({
              system,
              messages,
              // Bir araç "DURDUM" dediyse (kullanıcı fareyi/klavyeyi devraldı) bu turda yerel modele araç sunulmaz.
              tools: halted ? [] : tools,
              // Zorunlu araç adımı tek bir çağrıdır: kaçak üretim kısa kesilir.
              maxTokens: requireTool ? Math.min(maxTokens, LOCAL_FORCED_STEP_MAX_TOKENS) : maxTokens,
              voice: style === 'voice',
              cacheLoop: step > 0,
              ...(requireTool && !halted ? { requireTool: true } : {}),
              ...(local ? { signal: signal ? AbortSignal.any([signal, stepAbort.signal]) : stepAbort.signal } : signal ? { signal } : {}),
              onText(delta) {
                if (gate) {
                  // Cümle İÇİNDE dönen öbek ("bir kedi kavgasına karışan bir kedi kavgasına karışan…"): cümle hiç
                  // bitmediği için cümle yinelemesi denetimi yakalayamaz; üretim çıktı sınırına kadar sürerdi.
                  tail = (tail + delta).slice(-360);
                  if (!loopCut && !briefCut && PHRASE_LOOP.test(tail)) {
                    loopCut = true;
                    phraseLoop = true;
                    stepAbort.abort();
                    return;
                  }
                  for (const sentence of gate.splitter.push(delta)) feed(sentence);
                } else {
                  emitText(delta, stepText === '');
                }
                stepText += delta;
              },
            });
          } catch (error) {
            if ((!loopCut && !briefCut) || signal?.aborted) throw error;
            // Üretim döngü ya da söz sınırı yüzünden kesildi: o ana kadarki metin yanıttır (kullanım sayılamadı: akış yarıda kaldı).
            result = {
              text: stepText,
              toolCalls: [],
              stop: 'end',
              usage: { provider: 'local', model: deps.policy.get().brain.local.modelId, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 },
            };
            log.debug(loopCut ? 'yerel model aynı cümleyi yineledi; üretim kesildi' : 'sesli yanıt söz sınırına ulaştı; üretim kesildi');
          }
        }
        // Cümle içi döngü hiçbir şey söylenmeden yakalandıysa adım bir kez yeniden denenir (örnekleme başka bir yanıt
        // verir); yoksa kullanıcı "bir yanıt oluşturamadım" duyardı.
        if (phraseLoop && !degenerateRetried && result.toolCalls.length === 0 && text.trim() === '' && toolCalls.length === 0 && gate?.held.length === 0) {
          degenerateRetried = true;
          log.debug('yerel model bir öbeği döngüye soktu; adım yeniden deneniyor');
          step--;
          continue;
        }
        const wasSeeded = seeded !== null;
        seeded = null;
        requireTool = false;
        // Kullanım, tur nasıl biterse bitsin (uyarı, hata) kaydedilir: model çalıştı.
        if (!wasSeeded) {
          const usage = recordUsage(role, result.usage, Date.now() - callStarted, sessionId);
          totals.inputTokens += usage.inputTokens;
          totals.outputTokens += usage.outputTokens;
          totals.costUsd += usage.costUsd;
          if (local) localServer?.touch();
          if (target.kind === 'openai') reportedModels.set(`${target.target.endpoint.id}|${target.target.model}`, result.usage.model);
        }
        if (gate) {
          if (!loopCut && !briefCut) for (const sentence of gate.splitter.flush()) feed(sentence);
          const tail = styleFilter?.end();
          for (const sentence of tail?.sentences ?? []) passSentence(fixSelfClaim(sentence));
          if (tail?.repeated && result.toolCalls.length === 0 && gate.held.length === 0) {
            // Yanıtın tamamı önceki yanıtın yinelemesi (sınamada görüldü: yeni söze eski yanıt). Kullanıcıya iletilmez;
            // model bir kez uyarılır. Yine yinelerse süzülmeden iletilir (sessiz kalmaktan iyidir).
            repeatNudged = true;
            messages.push({ role: 'assistant', text: result.text, toolCalls: [] });
            messages.push({ role: 'user', text: t('brain.local.repeatNudge') });
            step--;
            continue;
          }
          if (result.toolCalls.length === 0 && gate.held.length && unreadHeld && toolCalls.length === 0) {
            // Kaynağı okunmadan olgu söylendi: bir kez uyarılır ve okuma aracı zorunlu tutulur. Yine okumazsa kullanıcı
            // uydurma bir tarih yerine dürüst bir "okuyamadım" duyar.
            if (!readNudged) {
              readNudged = true;
              requireTool = true;
              messages.push({ role: 'assistant', text: result.text, toolCalls: [] });
              messages.push({ role: 'user', text: t('brain.local.readNudge') });
              step--;
              continue;
            }
            emitText(t('brain.local.unread'), true);
            flushSentences();
            return finish('end', null);
          }
          if (result.toolCalls.length === 0 && gate.held.length) {
            if (!nudged) {
              // Araç çağırmadan "yaptım" dedi: bir kez uyarılır. Bu turda henüz HİÇ araç çağrılmadıysa yeniden denemede
              // araç çağrısı zorunlu tutulur (model işi yapacağını kendisi söyledi; ölçümde uyarı tek başına çoğu kez
              // yetmedi). Bir araç denenip başarısız olduysa zorlanmaz: modelden beklenen, yapamadığını söylemesidir.
              // Yine çağırmazsa yanıt yerine dürüst hata döner.
              nudged = true;
              requireTool = tools.length > 0 && toolCalls.length === 0;
              messages.push({ role: 'assistant', text: result.text, toolCalls: [] });
              messages.push({ role: 'user', text: t('brain.local.claimNudge') });
              step--;
              continue;
            }
            // Bu turda bir araç denenip BAŞARISIZ olduysa kullanıcı genel bir hata yerine aracın söylediği nedeni duyar
            // ("Veritabanı kilitli; hatırlatıcı kaydedilemedi"): model nedeni söylemek yerine iki kez "yaptım" dedi.
            const failed = toolCalls.findLast((call) => !call.ok);
            if (failed && !toolSucceeded()) {
              emitText(t('brain.local.toolFailed', { detail: failed.text.replace(/^HATA:\s*/, '') }), true);
              flushSentences();
              return finish('end', null);
            }
            // Pano işini araçsız "yaptım" dedi (iki kez): genel hata yerine dürüst, işi sürdüren bir soru.
            if (panoHeld) {
              emitText(t('dashboard.claim.notDone'), true);
              flushSentences();
              return finish('end', null);
            }
            return finish('error', t('brain.error.notDone'));
          }
          if (result.toolCalls.length === 0) for (const sentence of gate.held) emitSpoken(sentence);
        }
        flushSentences();

        if (result.stop === 'refusal') return finish('refusal', t('brain.error.refusal'));
        onStep?.({ index: step, text: stepText, toolNames: result.toolCalls.map((call) => call.name) });
        if (result.stop === 'pause') {
          messages.push({ role: 'assistant', text: result.text, toolCalls: [], native: result.native });
          continue;
        }
        if (result.toolCalls.length === 0 || result.stop !== 'tool_use') {
          if (result.stop === 'max_tokens') return finish('max_tokens', t('brain.error.maxTokens'));
          if (!text.trim() && toolCalls.length === 0) return finish('error', t('brain.error.empty'));
          return finish('end', null);
        }
        if (step === maxSteps - 1) return finish('max_steps', t('brain.error.maxSteps'));

        // Yerelde hatırlatıcının zamanı koddan gelir: model tarihi atladıysa ya da yanlış hesapladıysa düzeltilir.
        if (resolvedTime) for (const call of result.toolCalls) applyResolvedTime(call, resolvedTime, log);
        // Kullanıcı birden çok kalem saydıysa ekleme çağrısı sözdeki kalemlerle düzeltilir (tek maddeye yazılmasın).
        if (spokenItems && openTools && deps.tools.has('todo_add_many')) {
          for (const call of result.toolCalls) if (call.inputError === undefined && applyListItems(call, spokenItems, log)) codeCalls.add(call.id);
        }
        messages.push({ role: 'assistant', text: result.text, toolCalls: result.toolCalls, native: result.native });
        // Küçük model aynı çağrıyı aynı girdiyle döndürebilir: bir kez uyarılır, yinelerse tur kesilir.
        const signature = JSON.stringify(result.toolCalls.map((call) => [call.name, call.input]));
        const repeated = signature === previousSignature;
        previousSignature = signature;
        if (repeated && ++repeats >= 2) return finish(toolCalls.length ? 'end' : 'max_steps', text.trim() ? null : t('brain.error.maxSteps'));

        const results = await Promise.all(
          result.toolCalls.map(async (call): Promise<ToolResultMessage> => {
            if (repeated) {
              return { id: call.id, name: call.name, isError: true, content: t('brain.error.repeat') };
            }
            const callId = newId();
            const toolStarted = Date.now();
            request.onToolCall?.({ phase: 'start', callId, name: call.name, input: call.input });
            const onReport = (stepName: string) => request.onToolCall?.({ phase: 'report', callId, name: call.name, step: stepName });
            let outcome: ToolResult;
            const extra = request.extraTools?.tools.find((def) => def.name === call.name);
            if (call.inputError !== undefined) {
              outcome = { ok: false, text: `INVALID_JSON: ${call.inputError}` };
            } else if (local && justDone.has(call.name) && REDO_GUARDED.has(call.name) && !asksAction(lastSaid, foldTr)) {
              // Az önce yapılmış iş, kullanıcı yeniden istemeden bir daha yapılmaz (araç çalıştırılmaz).
              outcome = { ok: false, text: t('brain.local.alreadyDone') };
              // Turun kalanında araç sunulmaz ve "kurdum" demesi iddia sayılmaz: iş gerçekten (az önce) yapılmıştı.
              halted = true;
              redoBlocked = true;
            } else if (local && !extra && VOICE_OFF_TOOLS.has(call.name) && !codeCalls.has(call.id) && !asksVoiceOff(lastSaid, previousReply)) {
              // Kullanıcı istemeden mikrofon kapatılmaz, dinleme duraklatılmaz, sohbet bitirilmez (modelin kendi seçimi).
              outcome = { ok: false, text: t('brain.local.voiceOffNotAsked') };
            } else if (local && !extra && !offered(call.name) && !codeCalls.has(call.id)) {
              // Yerel model yalnız BU turda sunulan araçları çağırabilir (ör. açma sözü yokken `url_open` sunulmaz).
              outcome = { ok: false, text: t('tool.error.unknown', { name: call.name }) };
            } else if (extra && request.extraTools) {
              outcome = await runExtraTool(extra, request.extraTools.context, call.input, request.origin, callId, signal ?? new AbortController().signal, onReport);
            } else if (!deps.tools.has(call.name)) {
              outcome = { ok: false, text: t('tool.error.unknown', { name: call.name }) };
            } else {
              try {
                outcome = await deps.tools.run(call.name, call.input, { callId, origin: request.origin, ...(signal ? { signal } : {}), onReport });
              } catch (error) {
                outcome = { ok: false, text: t('tool.error.failed', { detail: error instanceof Error ? error.message : String(error) }) };
              }
            }
            const durationMs = Date.now() - toolStarted;
            request.onToolCall?.({ phase: 'end', callId, name: call.name, ok: outcome.ok, text: outcome.text, durationMs });
            toolCalls.push({ callId, name: call.name, ok: outcome.ok, text: outcome.text.slice(0, 300), durationMs });
            return { id: call.id, name: call.name, content: stringifyResult(outcome, local ? LOCAL_TOOL_RESULT_CHARS : MAX_TOOL_RESULT_CHARS), isError: !outcome.ok };
          }),
        );
        if (signal?.aborted) return finish('aborted', null);
        if (local) squeezeOldToolResults(messages);
        if (results.some((item) => /^(HATA: )?DURDUM\b/.test(item.content))) halted = true;
        messages.push({ role: 'tool', results });
        // Liste eklemesi geri çevrildiyse (yer tutucu ya da isteğin kendisi madde diye yazılmış) yerel model bir kez ARAÇLA
        // yeniden denemeye zorlanır. Ölçüm (demo.3, "üç maddelik bir liste oluştur ve yapılacaklara ekle"): geri çevrilen
        // çağrıdan sonra altı denemenin ikisinde model "ekleyeceğim" deyip durdu.
        const addRefused = results.some((item) => item.isError && LIST_ADD_TOOLS.has(item.name));
        if (local && !halted && !listRetried && addRefused && !toolCalls.some((call) => call.ok && LIST_ADD_TOOLS.has(call.name))) {
          listRetried = true;
          requireTool = true;
        }
      }
      return finish('max_steps', t('brain.error.maxSteps'));
    } catch (error) {
      if (error instanceof LocalBrainError) {
        log.warn(`yerel model çağrısı başarısız: ${error.message}`);
        if (signal?.aborted) return finish('aborted', null);
        return finish('error', error.kind === 'context' ? t('brain.error.tooLong') : t('brain.error.localUnavailable'));
      }
      const mapped = mapBrainError(error, signal?.aborted ?? false);
      if (mapped.stopReason === 'aborted') return finish('aborted', null);
      log.warn(`model çağrısı başarısız: ${mapped.detail}`);
      return { ...finish('error', mapped.message, !local && mapped.cloudDown ? (mapped.cloudIssue ?? 'network') : null), localRetry: local ? null : (mapped.localRetry ?? null) };
    }
  };

  /** Rota seçer, turu yürütür; bulut düşerse (henüz metin akmadıysa) aynı turu yerelde yeniden dener. */
  const respond = async (
    role: BrainRole,
    request: BrainRequest,
    onStep?: (step: { index: number; text: string; toolNames: string[] }) => void,
  ): Promise<BrainResponse> => {
    // Açılışın ilk anı: Claude Code yoklaması (sürüm, oturum) bitmeden gelen tur kısa süre bekler.
    if (claudeCode) await claudeCode.settle(2500);
    let decision = route(role, request.origin);
    if (decision.kind === 'blocked') {
      // Beyin yokken gelen tur: durum (ör. yerel model dosyası silinmiş) arayüze de yansısın.
      refreshStatus();
      return { text: '', stopReason: decision.stopReason, error: decision.error, toolCalls: [], usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, durationMs: 0 } };
    }
    let first = await loop(role, request, decision, onStep);
    // Anthropic API bu turda düştü (kredi, anahtar, ağ) ve sırada abonelik var (`use: fallback`): yerelden önce o denenir.
    if (decision.kind === 'anthropic' && first.cloudDown && !first.streamed && first.response.toolCalls.length === 0) {
      markCloudDown(first.cloudDown);
      const next = route(role, request.origin);
      if (next.kind === 'claude-code') {
        log.info(`bulut API kullanılamıyor (${first.cloudDown}); tur Claude Code ile sürüyor`);
        decision = next;
        first = await loop(role, request, decision, onStep);
      }
    }
    if (decision.kind === 'claude-code') {
      const failure = first.ccFailure ?? null;
      // Yanıt verildiyse ya da tur yeniden denenemiyorsa (metin aktı, araç çalıştı: yan etki iki kez olmasın) biter.
      if (!failure || first.streamed || first.response.toolCalls.length > 0) {
        refreshStatus();
        return first.response;
      }
      // Claude Code bu turu yürütemedi (sınır, oturum, süre, çökme): sıradaki sağlayıcı (API varsa o, yoksa yerel model).
      const next = route(role, request.origin, true);
      if (next.kind === 'blocked' || next.kind === 'claude-code') {
        refreshStatus();
        return first.response;
      }
      log.info(`Claude Code kullanılamıyor (${failure.issue}); tur ${next.kind === 'local' ? 'yerel modelle' : 'bulut API ile'} sürüyor`);
      if (next.kind === 'local') {
        const second = await loop(role, request, { kind: 'local', fallback: true, why: failure.issue, cc: true, dropped: true }, onStep);
        refreshStatus();
        return second.response;
      }
      decision = next;
      first = await loop(role, request, decision, onStep);
    }
    if (decision.kind === 'openai') {
      // OpenAI uyumlu sağlayıcı: durum sağlayıcı başına tutulur; kredi/anahtar/ağ "düşük" sayar, hız sınırı, 5xx ve
      // "model yok" yalnız bu turu yerele yollar. Henüz metin akmadıysa VE hiçbir araç çalışmadıysa yerelde yeniden
      // denenir (araç yan etkisi iki kez olmasın).
      const { endpoint } = decision.target;
      if (first.cloudDown) {
        cloudHealth.markDown(endpoint.id, first.cloudDown, cloudRetryMs);
        refreshStatus();
      } else if (first.response.stopReason !== 'error' && cloudHealth.markUp(endpoint.id)) {
        refreshStatus();
      }
      const why = first.cloudDown ?? first.localRetry ?? null;
      if (why && !first.streamed && first.response.toolCalls.length === 0 && fallbackEnabled() && localAllowed(role, request.origin) && localReady().ok) {
        log.info(`${endpoint.name} kullanılamıyor (${why}); tur yerel modelle sürüyor`);
        return (await loop(role, request, { kind: 'local', fallback: true, why, via: endpoint.name, dropped: true }, onStep)).response;
      }
      refreshStatus();
      return first.response;
    }
    if (decision.kind === 'anthropic' && first.cloudDown) {
      markCloudDown(first.cloudDown);
      if (!first.streamed && fallbackEnabled() && localAllowed(role, request.origin) && localReady().ok) {
        log.info(`bulut beyni kullanılamıyor (${first.cloudDown}); tur yerel modelle sürüyor`);
        return (await loop(role, request, { kind: 'local', fallback: true, why: first.cloudDown, dropped: true }, onStep)).response;
      }
    } else if (decision.kind === 'anthropic' && first.response.stopReason !== 'error') {
      cloudUp();
    }
    // Yerel sunucu tur sırasında düşmüş olabilir (dosya silindi, süreç açılamadı): durum yeniden hesaplanır.
    refreshStatus();
    return first.response;
  };

  const extract = async <T>(request: BrainExtractRequest<T>): Promise<T | null> => {
    const role = request.role ?? 'memory';
    // Yalnız yerel (ortam dinleme): politika, anahtarlar ve sağlayıcılar yok sayılır; yerel yoksa buluta düşülmez.
    // Acil durdurma ve zorunlu güncelleme kapısı burada da geçerlidir.
    const localOnly = request.localOnly === true;
    const decision: Route = localOnly
      ? deps.policy.killSwitchActive() || deps.policy.updateRequired() || !localServer || !localReady().ok
        ? { kind: 'blocked', stopReason: 'error', error: t('brain.error.localUnavailable') }
        : { kind: 'local', fallback: false }
      : // Yapılandırılmış çıkarım Claude Code'a gitmez (arka planda kota harcamasın): rol açıkça ona ayarlıysa yerel model.
        route(role, null, true);
    if (decision.kind === 'blocked' || decision.kind === 'claude-code') return null;
    // SDK yardımcısı şemayı yapılandırılmış çıktının kabul ettiği biçime çevirir (additionalProperties vb.).
    const schema = stripSchemaMeta(betaZodOutputFormat(request.schema as z.ZodType).schema as Record<string, unknown>);
    const parse = (raw: string): T | null => {
      try {
        const parsed = request.schema.safeParse(JSON.parse(raw));
        if (parsed.success) return parsed.data;
        log.warn('çıkarım şemaya uymadı', parsed.error.message);
      } catch {
        log.warn('çıkarım JSON değil');
      }
      return null;
    };
    const runLocal = async (): Promise<T | null> => {
      try {
        const baseUrl = await localServer!.ensure();
        const started = Date.now();
        const result = await localExtract({
          baseUrl,
          modelId: deps.policy.get().brain.local.modelId,
          system: request.instructions,
          input: request.input,
          schema,
          maxTokens: 2048,
          ...(request.signal ? { signal: request.signal } : {}),
          ...(options.localFetch ? { fetchFn: options.localFetch } : {}),
        });
        recordUsage(role, { provider: 'local', model: deps.policy.get().brain.local.modelId, inputTokens: result.inputTokens, outputTokens: result.outputTokens, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 }, Date.now() - started);
        localServer?.touch();
        return parse(result.raw);
      } catch (error) {
        // Arka plan çıkarımı yerelde de yapılamıyorsa sessizce atlanır; tur bozulmaz.
        log.debug(`yerel çıkarım atlandı: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      }
    };
    if (decision.kind === 'local') return runLocal();
    if (decision.kind === 'openai') {
      const { endpoint, apiKey, ref, model } = decision.target;
      const started = Date.now();
      try {
        const result = await openAiCompatibleExtract({
          endpoint,
          apiKey,
          model,
          effort: ref.effort,
          thinking: ref.thinking,
          price: ref.price,
          system: request.instructions,
          input: request.input,
          schema,
          ...(request.images?.length ? { images: request.images } : {}),
          maxTokens: maxTokensFor(role, 'plain'),
          ...(request.signal ? { signal: request.signal } : {}),
          ...(options.cloudFetch ? { fetchFn: options.cloudFetch } : {}),
        });
        recordUsage(role, result.usage, Date.now() - started);
        if (cloudHealth.markUp(endpoint.id)) refreshStatus();
        return parse(result.raw);
      } catch (error) {
        const mapped = mapBrainError(error, request.signal?.aborted ?? false);
        if (mapped.stopReason === 'aborted') return null;
        log.warn(`çıkarım başarısız: ${mapped.detail}`);
        if (mapped.cloudDown) {
          cloudHealth.markDown(endpoint.id, mapped.cloudIssue ?? 'network', cloudRetryMs);
          refreshStatus();
        }
        if ((mapped.cloudDown || mapped.localRetry) && fallbackEnabled() && localAllowed(role, null) && localReady().ok) return runLocal();
        return null;
      }
    }

    const api = client()!;
    const ref = deps.policy.get().models[role];
    const params = modelParams(ref);
    const started = Date.now();
    try {
      const message: BetaMessage = await api.create(
        {
          model: ref.model,
          max_tokens: maxTokensFor(role, 'plain'),
          system: request.instructions,
          messages: [
            {
              role: 'user',
              content: [
                ...(request.images ?? []).map((image) => ({
                  type: 'image' as const,
                  source: { type: 'base64' as const, media_type: image.mediaType as 'image/png', data: image.data },
                })),
                { type: 'text' as const, text: request.input },
              ],
            },
          ],
          ...(params.thinking ? { thinking: params.thinking } : {}),
          output_config: { ...(params.effort ? { effort: params.effort } : {}), format: { type: 'json_schema', schema } },
        },
        { ...(request.signal ? { signal: request.signal } : {}), timeout: 120_000 },
      );
      recordUsage(role, { provider: 'anthropic', model: message.model, inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens, cacheReadTokens: message.usage.cache_read_input_tokens ?? 0, cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0 }, Date.now() - started);
      if (message.stop_reason === 'refusal' || message.stop_reason === 'max_tokens') {
        log.warn(`çıkarım tamamlanamadı: ${message.stop_reason}`);
        return null;
      }
      cloudUp();
      return parse(message.content.filter((block) => block.type === 'text').map((block) => (block as { text: string }).text).join(''));
    } catch (error) {
      const mapped = mapBrainError(error, request.signal?.aborted ?? false);
      if (mapped.stopReason === 'aborted') return null;
      log.warn(`çıkarım başarısız: ${mapped.detail}`);
      if (mapped.cloudDown) {
        markCloudDown(mapped.cloudIssue ?? 'network');
        if (fallbackEnabled() && localAllowed(role, null) && localReady().ok) return runLocal();
      }
      return null;
    }
  };

  const api: BrainService = {
    attachSelfState(source) {
      selfSource = source;
    },
    attachModuleCatalog(read) {
      moduleCatalog = read;
    },
    attachSelfPart(id, read) {
      if (read) selfParts.set(id, read);
      else selfParts.delete(id);
    },
    attachUserContext(read) {
      userContext = read;
    },
    selfState,
    selfKnowledge,
    respond: (request) => respond(request.role, request),
    runTask(request: BrainTaskRequest) {
      const { goal, onStep, role, ...rest } = request;
      return respond(role ?? 'deep', { ...rest, role: role ?? 'deep', text: goal }, onStep);
    },
    extract,
    availability,
    status: () => refreshStatus(),
    prewarm(role) {
      const running = prewarms.get(role);
      if (running) return running;
      const task = (async () => {
        const origin: Origin = { channel: role === 'voice' ? 'voice' : 'chat', speakerVerified: null };
        if (claudeCode) await claudeCode.settle(5000);
        const decision = route(role, origin);
        if (decision.kind === 'blocked') return;
        if (decision.kind === 'claude-code') {
          // Isıtma = süreci açıp el sıkışmak ve MCP'ye bağlamak (model çağrısı yok, kota harcanmaz).
          probeApiOnce();
          await claudeCode?.prewarm(claudeCodeSpec(role, origin, decision));
          return;
        }
        if (decision.kind === 'local') {
          // Yerelde ısıtma = süreci açıp modeli belleğe almak; ilk tur yükleme beklemesin.
          await localServer?.ensure().catch((error: unknown) => log.debug(`yerel ısıtma başarısız: ${String(error)}`));
          return;
        }
        // OpenAI uyumlu uçlarda ücretsiz ısıtma/yoklama yok (kredi ancak gerçek istekle görülür): ilk tur karar verir.
        if (decision.kind === 'openai') return;
        const style = styleFor(role, origin, role === 'voice' || role === 'deep');
        const { base, system } = anthropicPrefix(role, style, role === 'deep' ? { effort: CHAT_EFFORT } : {}, modelRefFor(deps.policy.get(), role, origin));
        const started = Date.now();
        try {
          const message = await client()!.create(
            {
              ...(base as Omit<BetaMessageStreamParams, 'messages' | 'max_tokens' | 'stream'>),
              ...(system ? { system: [{ type: 'text' as const, text: system, cache_control: { type: 'ephemeral' as const } }] } : {}),
              stream: false,
              max_tokens: 0,
              messages: [{ role: 'user', content: [{ type: 'text', text: '.' }] }],
            },
            { timeout: 30_000 },
          );
          recordUsage(role, { provider: 'anthropic', model: message.model, inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens, cacheReadTokens: message.usage.cache_read_input_tokens ?? 0, cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0 }, Date.now() - started);
          cloudUp();
        } catch (error) {
          const mapped = mapBrainError(error, false);
          log.debug(`önbellek ısıtma başarısız: ${mapped.detail}`);
          // Isıtma, bulutun kullanılamadığını turdan ÖNCE gösterir (kredisiz hesap, geçersiz anahtar, ağ yok):
          // ilk tur buluta gidip dönmenin gecikmesini ödemesin diye şimdiden yerele geçilir ve yerel model ısıtılır.
          if (mapped.cloudDown) {
            markCloudDown(mapped.cloudIssue ?? 'network');
            if (fallbackEnabled() && localAllowed(role, origin) && localReady().ok) {
              await localServer?.ensure().catch((reason: unknown) => log.debug(`yerel ısıtma başarısız: ${String(reason)}`));
            }
          }
        }
      })().finally(() => prewarms.delete(role));
      prewarms.set(role, task);
      return task;
    },
  };
  return api;
}

/** Yapılandırılmış çıktı ve araç şemaları `$schema` gibi üst alanları istemez. */
function stripSchemaMeta(schema: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = schema;
  return rest;
}
