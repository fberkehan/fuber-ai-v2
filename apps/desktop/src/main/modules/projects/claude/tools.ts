// Asistanın Claude Code araçları: sesle/sohbetten oturum başlat, oturuma ileti gönder, durumu sor, durdur
// (v1 `claudecode/araclar.ts` › `claude_code_gorev`). Adlar ve açıklamalar kısa tutulur: yerel model küçük.
import { defineTool, t, type AuthorityLevel, type Id, type ModuleContext, type ToolContext, type ToolDef, type ToolResult } from '@fuber/shared';
import { z } from 'zod';
import type { PermissionMode } from '../../../core/claude-cli/session-events';
import type { ProjectsService } from '../service';
import type { ProjectDetail, SessionRow } from '../types';
import type { ClaudeBridge } from './bridge';
import type { LiveSessionSummary } from './types';

export interface ClaudeToolDeps {
  service(ctx: ModuleContext): Promise<ProjectsService>;
  bridge(ctx: ModuleContext): Promise<ClaudeBridge>;
}

const MODES: Record<string, PermissionMode> = { plan: 'plan', ask: 'default', edits: 'acceptEdits', full: 'bypassPermissions' };
const ACTIVE = new Set(['running', 'permission', 'queued']);

const brief = (session: LiveSessionSummary) => ({
  id: session.id,
  session_id: session.sessionId ?? null,
  project: session.projectName,
  title: session.title,
  status: session.status,
  mode: session.mode,
  pending_permissions: session.pendingPermissions,
  changed_files: session.changedFiles,
});

/** Asistanın çağrısı hangi sohbetten geldi (bitiş özeti oraya yazılır). */
function chatOf(ctx: ToolContext, bridge: ClaudeBridge): Id | undefined {
  const { channel, sessionId } = ctx.origin;
  if (sessionId === undefined || (channel !== 'voice' && channel !== 'chat')) return undefined;
  bridge.rememberChat(sessionId, channel);
  return sessionId;
}

/** Asistanın o anki yetki düzeyi (`core/authority.ts`); okunamazsa en temkinlisi. */
function authorityLevel(ctx: ToolContext): AuthorityLevel {
  try {
    return ctx.tools.authority().level;
  } catch {
    return 'ask';
  }
}

/**
 * Kip verilmeyen oturumun kipi: Sor → her adımı sorar; Akıllı → dosya düzenlemelerine izinli; Tam → köprüde tam erişim
 * açıksa tam yetki (yine açık onayla başlar), değilse düzenlemelere izinli.
 */
export function modeForAuthority(level: AuthorityLevel, fullAccess: boolean): PermissionMode {
  if (level === 'ask') return 'default';
  if (level === 'full' && fullAccess) return 'bypassPermissions';
  return 'acceptEdits';
}

type ProjectPick = { project: ProjectDetail } | { result: ToolResult };

function pickProject(service: ProjectsService, name: string): ProjectPick {
  const byId = service.repo.listProjects().find((project) => project.id === name);
  if (byId) return { project: byId };
  const found = service.find(name);
  if (found.kind === 'one') return { project: found.project };
  if (found.kind === 'none') return { result: { ok: false, text: t('claude.tool.noProject', { query: name }) } };
  return {
    result: {
      ok: false,
      text: t('claude.tool.ambiguous', { names: found.options.map((option) => option.item.name).join(', ') }),
      data: found.options.map((option) => ({ id: option.item.id, name: option.item.name, path: option.item.path })),
    },
  };
}

function statusLine(session: LiveSessionSummary, permission?: string): string {
  const detail =
    session.status === 'permission' && permission
      ? t('claude.tool.statusPermission', { count: session.pendingPermissions, what: permission })
      : session.status === 'error' || session.status === 'limit'
        ? session.error
          ? ` (${session.error})`
          : ''
        : session.changedFiles
          ? t('claude.tool.statusChanged', { count: session.changedFiles })
          : '';
  return t('claude.tool.statusLine', { project: session.projectName, title: session.title.slice(0, 60), status: t(`claude.status.${session.status}`), detail });
}

export function claudeTools(deps: ClaudeToolDeps): ToolDef[] {
  const latestIndexed = (service: ProjectsService, projectId?: Id): SessionRow | null =>
    service.repo.listSessions({ limit: 1, ...(projectId ? { projectId } : {}) }).items[0] ?? null;

  return [
    defineTool({
      name: 'code_session_start',
      group: 'code',
      description:
        'Bir projede yeni Claude Code oturumu başlatır ve isteği ona verir (kod yazdırma, hata ayıklama, inceleme). Arka planda çalışır; bitince kullanıcıya SESLİ ve yazılı haber verilir. ' +
        'KURAL: kullanıcı bir PROJE ADI verip orada iş istiyorsa ("X projemde şunu yap / düzelt / ekle / şuna bak", "X’te Claude’a şunu yaptır") işi KENDİN pc_*, dosya ya da komut araçlarıyla yapma; bu aracı çağır. ' +
        'O projede süren ya da az önceki oturuma ek söz ("devam et", "ona şunu da söyle") için code_session_send. ' +
        'mode: boş bırak (yetki düzeyine göre seçilir: Sor → ask, Akıllı → edits, Tam → full) | plan (yalnız planlar) | ask (her adımı sorar) | edits (dosya düzenlemelerine izin) | full (hiç sormaz). Yanıt beklemeden başlatıldığını söyle, bitti deme.',
      input: z.object({
        project: z.string().min(1).describe('Projenin söylendiği gibi adı'),
        request: z.string().min(1).describe('Claude Code’a verilecek iş, kullanıcının sözleriyle'),
        mode: z.enum(['plan', 'ask', 'edits', 'full']).optional(),
        model: z.string().optional().describe('opus | sonnet | haiku (isteğe bağlı)'),
      }),
      risk: 'write',
      run: async ({ project, request, mode, model }, ctx) => {
        const [service, bridge] = await Promise.all([deps.service(ctx), deps.bridge(ctx)]);
        const picked = pickProject(service, project);
        if ('result' in picked) return picked.result;
        const target = picked.project;
        // Kip verilmediyse yetki düzeyine göre (demo.5: varsayılan "her adımı sor" oturumu izin bekleterek takıyordu).
        const wanted = mode ? MODES[mode] : modeForAuthority(authorityLevel(ctx), bridge.config().fullAccess);
        let fullApproved = false;
        if (wanted === 'bypassPermissions') {
          if (!bridge.config().fullAccess) return { ok: false, text: t('claude.op.fullAccessOff') };
          // Tam yetkide başlatma tehlikeli iştir: açık onay olmadan yapılmaz.
          const decision = await ctx.tools.requestApproval({
            toolName: 'code_session_start',
            moduleId: 'projects',
            summary: t('claude.approval.full', { project: target.name, request: request.slice(0, 200) }),
            input: { project: target.name, request: request.slice(0, 500), mode: 'full' },
            origin: ctx.origin,
          });
          if (decision !== 'approved') return { ok: false, text: t('claude.tool.fullDenied') };
          fullApproved = true;
        }
        const chatSessionId = chatOf(ctx, bridge);
        const started = await bridge.manager.start({
          cwd: target.path,
          prompt: request,
          source: 'assistant',
          ...(wanted ? { mode: wanted } : {}),
          ...(model ? { model } : {}),
          ...(fullApproved ? { fullAccessApproved: true } : {}),
          ...(chatSessionId !== undefined ? { chatSessionId } : {}),
        });
        if (!started.ok || !started.session) return { ok: false, text: t('claude.tool.failed', { error: started.error ?? '' }) };
        const session = started.session;
        const modeName = t(`claude.mode.${session.mode}`);
        const text =
          session.status === 'queued' && session.queuePosition
            ? t('claude.tool.queued', { project: target.name, position: session.queuePosition, mode: modeName })
            : t('claude.tool.started', { project: target.name, mode: modeName });
        return { ok: true, text: `${text}${bridge.trustState(target.path).required && !bridge.trustState(target.path).decision ? t('claude.tool.untrusted') : ''}`, data: brief(session) };
      },
    }),
    defineTool({
      name: 'code_session_send',
      group: 'code',
      description:
        'Var olan bir Claude Code oturumuna ileti gönderir; çalışıyorsa araya girer, kapalıysa kaldığı yerden sürdürür. ' +
        'session (code_session_search ya da code_session_status kimliği) ya da project verilir; ikisi de yoksa en son oturum. "Claude\'a şunu söyle", "X projesindeki oturuma devam etmesini söyle", "ona şunu da söyle" denince kullan; işi kendin yapma.',
      input: z.object({
        message: z.string().min(1).describe('Oturuma söylenecek şey'),
        session: z.string().optional().describe('Oturum kimliği'),
        project: z.string().optional().describe('Proje adı: o projedeki en son oturum'),
      }),
      risk: 'write',
      run: async ({ message, session, project }, ctx) => {
        const [service, bridge] = await Promise.all([deps.service(ctx), deps.bridge(ctx)]);
        const manager = bridge.manager;
        const chatSessionId = chatOf(ctx, bridge);
        const chat = chatSessionId !== undefined ? { chatSessionId } : {};
        let liveTarget: LiveSessionSummary | null = null;
        let indexed: SessionRow | null = null;
        let projectName: string | null = null;
        if (session) {
          liveTarget = manager.summary(session);
          if (!liveTarget) {
            try {
              indexed = service.repo.getSession(session);
            } catch {
              return { ok: false, text: t('claude.op.notFound') };
            }
          }
        } else if (project) {
          const picked = pickProject(service, project);
          if ('result' in picked) return picked.result;
          projectName = picked.project.name;
          liveTarget = manager.sessions().find((item) => item.projectId === picked.project.id && item.status !== 'closed') ?? null;
          if (!liveTarget) indexed = latestIndexed(service, picked.project.id);
          if (!liveTarget && !indexed) return { ok: false, text: t('claude.tool.noSessionIn', { project: projectName }) };
        } else {
          liveTarget = manager.sessions().find((item) => item.status !== 'closed') ?? null;
          if (!liveTarget) indexed = latestIndexed(service);
          if (!liveTarget && !indexed) return { ok: false, text: t('claude.tool.noSession') };
        }
        // Dizindeki oturum şu an uygulamada açıksa ona gider (çift süreç açılmaz).
        if (!liveTarget && indexed) liveTarget = manager.summary(indexed.id);
        if (liveTarget) {
          const sent = await manager.send(liveTarget.id, { text: message, source: 'assistant', ...chat });
          if (!sent.ok) return { ok: false, text: t('claude.tool.sendFailed', { error: sent.error ?? '' }) };
          const now = manager.summary(liveTarget.id) ?? liveTarget;
          return { ok: true, text: t('claude.tool.sent', { project: now.projectName, title: now.title.slice(0, 60) }), data: brief(now) };
        }
        const row = indexed!;
        const started = await manager.start({ cwd: row.cwd, resume: row.id, prompt: message, title: row.title, source: 'assistant', ...chat });
        if (!started.ok || !started.session) return { ok: false, text: t('claude.tool.sendFailed', { error: started.error ?? '' }) };
        return { ok: true, text: t('claude.tool.sent', { project: started.session.projectName, title: row.title.slice(0, 60) }), data: brief(started.session) };
      },
    }),
    defineTool({
      name: 'code_session_status',
      group: 'code',
      description: 'Claude Code oturumlarının durumunu kısaca verir: çalışan, izin bekleyen, biten. "Claude ne durumda?", "hangi oturumlar çalışıyor?", "X projesindeki iş bitti mi?" sorusunda kullan.',
      input: z.object({ project: z.string().optional().describe('Yalnız bu proje') }),
      risk: 'read',
      run: async ({ project }, ctx) => {
        const [service, bridge] = await Promise.all([deps.service(ctx), deps.bridge(ctx)]);
        let sessions = bridge.manager.sessions();
        if (project) {
          const picked = pickProject(service, project);
          if ('result' in picked) return picked.result;
          sessions = sessions.filter((item) => item.projectId === picked.project.id);
        }
        const line = (item: LiveSessionSummary) => statusLine(item, bridge.manager.detail(item.id)?.permissions[0]?.summary.slice(0, 80));
        const active = sessions.filter((item) => ACTIVE.has(item.status));
        if (!active.length) {
          const last = sessions[0];
          return {
            ok: true,
            text: last ? `${t('claude.tool.statusNone')} ${t('claude.tool.statusLast', { line: line(last) })}` : t('claude.tool.statusNone'),
            data: sessions.slice(0, 5).map(brief),
          };
        }
        return { ok: true, text: t('claude.tool.statusSummary', { count: active.length, lines: active.slice(0, 6).map(line).join('; ') }), data: sessions.slice(0, 8).map(brief) };
      },
    }),
    defineTool({
      name: 'code_session_stop',
      group: 'code',
      description: 'Çalışan Claude Code oturumunu durdurur. session ya da project verilmezse çalışan bütün oturumlar durur. "Claude\'u durdur", "oturumu kes" denince kullan.',
      input: z.object({ session: z.string().optional(), project: z.string().optional() }),
      risk: 'write',
      run: async ({ session, project }, ctx) => {
        const [service, bridge] = await Promise.all([deps.service(ctx), deps.bridge(ctx)]);
        const manager = bridge.manager;
        let targets = manager.sessions().filter((item) => ACTIVE.has(item.status));
        if (session) {
          const one = manager.summary(session);
          if (!one) return { ok: false, text: t('claude.op.notFound') };
          targets = [one];
        } else if (project) {
          const picked = pickProject(service, project);
          if ('result' in picked) return picked.result;
          targets = targets.filter((item) => item.projectId === picked.project.id);
        }
        if (!targets.length) return { ok: true, text: t('claude.tool.nothingToStop'), data: [] };
        await Promise.all(targets.map((item) => manager.interrupt(item.id)));
        return { ok: true, text: t('claude.tool.stopped', { count: targets.length }), data: targets.map((item) => brief(manager.summary(item.id) ?? item)) };
      },
    }),
  ];
}
