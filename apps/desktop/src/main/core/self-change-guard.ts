/**
 * Kendini değiştirme kapısı (KURGU §13): "kendine şunu ekle / kendini güncelle" isteğini YALNIZ kullanıcının kendi
 * sözü ya da yazısı başlatabilir. Web sayfasından, e-postadan, belgeden, bir eklentinin sonucundan ya da arka plan
 * işinden gelen aynı cümle istek sayılmaz.
 *
 * İki denetim:
 *  1. Köken: çağrı kullanıcının turundan (`voice`, `chat`) ya da arayüzden (`ui`) gelmeli. Arka plan işi (`job`) ve
 *     eklenti (`skill`) kökenli çağrı reddedilir. Tanınmayan ses (`speakerVerified === false`) reddedilir.
 *  2. Bulaşma: aynı turda dış içerik okuyan bir araç çalıştıysa (web, e-posta, belge, ekran, tarayıcı, eklenti) model
 *     o içerikteki talimatı izliyor olabilir. Köken yine `voice` görünür; bu yüzden böyle bir turda istek reddedilmez
 *     ama AÇIK ONAY ister (`confirm: true`): kullanıcı adada ne istendiğini görür ve "onaylıyorum" der.
 *
 * Atölye (eklenti yapımı/güncellemesi) ve çekirdek geliştirme (kaynak değişikliği, kurulum) aynı kapıyı kullanır.
 */
import { t, type ApprovalDecision, type JsonValue, type ToolContext } from '@fuber/shared';

export type SelfChangeVerdict = { allow: true; confirm: boolean; why: string | null } | { allow: false; reason: string };

/** Kullanıcının kendisinin başlattığı kanallar. */
const USER_CHANNELS: ReadonlySet<string> = new Set(['voice', 'chat', 'ui']);

/** Sonuçları dış dünyadan gelen içerik taşıyan modüller (içerik talimat sayılmaz). */
const EXTERNAL_MODULES: ReadonlySet<string> = new Set(['web', 'browser', 'mail', 'documents', 'meeting', 'ambient', 'watch', 'import-v1']);
/** Modülü yukarıda olmayan ama dış içerik döndüren araçlar (ekran ve pencere okuma, dosya okuma, Claude Code oturum çıktısı). */
const EXTERNAL_TOOLS = /^(?:screen_|pc_read|pc_window|pc_clipboard|file_read|code_session_status|document_|rss_)/;

/** Kullanıcının son iletisi bulunamazsa turun başı sayılacak geriye bakış. */
const FALLBACK_TURN_MS = 120_000;
const RECENT_CALLS = 60;

/** Bu çağrının ait olduğu turun başlangıcı: oturumdaki son kullanıcı iletisinin anı. */
function turnStart(ctx: ToolContext): number {
  const sessionId = ctx.origin.sessionId;
  if (sessionId) {
    try {
      const messages = ctx.conversation.messages(sessionId, { limit: 6 });
      for (let index = messages.length - 1; index >= 0; index--) {
        const message = messages[index]!;
        if (message.role === 'user') return Date.parse(message.at);
      }
    } catch {
      // döküm okunamadı: geriye bakışa düşülür
    }
  }
  return Date.now() - FALLBACK_TURN_MS;
}

/** Bu turda dış içerik okuyan araçların adları (yoksa boş). */
export function externalContentInTurn(ctx: ToolContext): string[] {
  const since = turnStart(ctx);
  const sessionId = ctx.origin.sessionId;
  const names = new Set<string>();
  for (const call of ctx.tools.recentCalls(RECENT_CALLS)) {
    if (call.callId === ctx.callId) continue;
    if (Date.parse(call.startedAt) < since) continue;
    // Oturum biliniyorsa yalnız aynı oturumun çağrıları; bilinmiyorsa (arayüz) süre penceresi yeter.
    if (sessionId && call.origin.sessionId && call.origin.sessionId !== sessionId) continue;
    if (EXTERNAL_MODULES.has(call.moduleId) || call.moduleId.startsWith('skill:') || EXTERNAL_TOOLS.test(call.name)) names.add(call.name);
  }
  return [...names];
}

/** Kendini değiştirme isteği bu çağrıdan başlayabilir mi. */
export function checkSelfChange(ctx: ToolContext): SelfChangeVerdict {
  if (!USER_CHANNELS.has(ctx.origin.channel)) return { allow: false, reason: t('selfchange.notUser') };
  if (ctx.origin.speakerVerified === false) return { allow: false, reason: t('selfchange.speaker') };
  // Arayüzden (düğme, form) gelen istek kullanıcının doğrudan eylemidir; bulaşma yalnız model turlarında aranır.
  if (ctx.origin.channel === 'ui') return { allow: true, confirm: false, why: null };
  const external = externalContentInTurn(ctx);
  if (external.length > 0) return { allow: true, confirm: true, why: t('selfchange.tainted', { tools: external.slice(0, 4).join(', ') }) };
  return { allow: true, confirm: false, why: null };
}

/**
 * Kapıyı uygular: reddedilirse nedenini, onay gerekiyorsa kullanıcının kararını döndürür. `summary` adadaki onay
 * kartında gösterilir (ne isteniyor). Onay yalnız kullanıcıdan gelir (ada düğmesi ya da sesli "onaylıyorum").
 */
export async function guardSelfChange(
  ctx: ToolContext,
  request: { toolName: string; moduleId: string; summary: string; input?: JsonValue },
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const verdict = checkSelfChange(ctx);
  if (!verdict.allow) return { ok: false, reason: verdict.reason };
  if (!verdict.confirm) return { ok: true };
  const decision: ApprovalDecision = await ctx.tools.requestApproval({
    toolName: request.toolName,
    moduleId: request.moduleId,
    summary: `${request.summary} ${verdict.why ?? ''}`.trim(),
    input: request.input ?? {},
    origin: ctx.origin,
  });
  if (decision === 'approved') return { ok: true };
  return { ok: false, reason: decision === 'denied' ? t('selfchange.denied') : t('selfchange.noAnswer') };
}
