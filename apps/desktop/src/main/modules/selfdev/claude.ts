// Claude Code sürücüsü: derin beyin köprüsü (`core/brain/deep`, seçenek (a)). Gerekçe:
//  - Yalıtım hazırdır: `--restricted --safe-mode --permission-mode dontAsk`; dosya araçları YALNIZ çalışma klasöründe (worktree),
//    kabuk yok, kullanıcı ayarı/CLAUDE.md/MCP yüklenmez, sistem istemi dosyadan, ortam izin listesiyle. Oturum yöneticisi
//    (seçenek (b)) "bilinen proje", güven ve izin istemi gibi koşullar ister ve modüller birbirini içe aktarmaz.
//  - Bash olmaması kusur değil özelliktir: sınamaları (typecheck, test) BİZ koşarız, Claude kendi sonucunu kendisi onaylayamaz.
//  - Canlı arayüz yerine `onEvent` akışı koşu günlüğüne yazılır (Geliştirme sayfasındaki adım günlüğü).
// Plan aşaması salt okunur (`['read']`); uygulama ve düzeltme `['read','write']`. Hiçbir aşamada web aracı yok.
import { deepBrainFor, type DeepTaskEvent } from '../../core/brain/deep';
import type { ModuleContext } from '@fuber/shared';
import { fixPrompt, fixSystem, implementPrompt, implementSystem, planPrompt, planSystem } from './prompts';

/** Bir Claude aşamasının sonucu (hiç fırlatmaz). */
export interface AgentStep {
  ok: boolean;
  /** Modelin son yanıtı. */
  text: string;
  /** `ok: false` iken Türkçe neden. */
  error: string | null;
  /** `end`, `timeout`, `limit`, `aborted`, `max_turns`… */
  stop: string;
  turns: number;
  durationMs: number;
}

/** Günlüğe yazılacak sadeleştirilmiş olay. */
export interface AgentLogEvent {
  kind: 'tool' | 'text' | 'note';
  text: string;
}

export interface AgentCall {
  workDir: string;
  maxSeconds: number;
  signal?: AbortSignal;
  onEvent?(event: AgentLogEvent): void;
}

export interface ClaudeDriver {
  /** Şu an iş verilebilir mi (derin beyin hazır mı). */
  available(): { ok: boolean; reason: string | null };
  plan(call: AgentCall & { request: string; reason: string }): Promise<AgentStep>;
  implement(call: AgentCall & { request: string; planText: string }): Promise<AgentStep>;
  fix(call: AgentCall & { request: string; command: string; output: string; round: number }): Promise<AgentStep>;
}

/** Çekirdek işleri uzundur: varsayılan 60 tur yetmez. */
export const PLAN_TURNS = 80;
export const IMPLEMENT_TURNS = 200;
export const FIX_TURNS = 120;

/** Derin beyin olayını günlük olayına çevirir; gösterilecek bir şey yoksa `null`. */
export function toLogEvent(event: DeepTaskEvent): AgentLogEvent | null {
  switch (event.type) {
    case 'tool':
      return event.phase === 'start' ? { kind: 'tool', text: event.detail ? `${event.name}: ${event.detail}` : event.name } : null;
    case 'text': {
      const text = event.text.replace(/\s+/g, ' ').trim();
      return text ? { kind: 'text', text: text.slice(0, 400) } : null;
    }
    case 'denied':
      return { kind: 'note', text: `izin kapısı reddetti: ${event.tool} (${event.reason})` };
    case 'limit':
      return { kind: 'note', text: event.status === 'rejected' ? 'Claude Code abonelik sınırı doldu' : 'Claude Code abonelik sınırına yaklaşıldı' };
    case 'retry':
      return { kind: 'note', text: `yeniden deneniyor (${event.attempt}): ${event.error}` };
    default:
      return null;
  }
}

export function createDeepDriver(ctx: ModuleContext): ClaudeDriver {
  const deep = () => deepBrainFor(ctx);

  async function run(kind: string, system: string, prompt: string, tools: Array<'read' | 'write'>, turns: number, call: AgentCall): Promise<AgentStep> {
    const result = await deep().runTask({
      kind,
      system,
      prompt,
      workDir: call.workDir,
      allowedTools: tools,
      maxSeconds: call.maxSeconds,
      maxTurns: turns,
      ...(call.signal ? { signal: call.signal } : {}),
      onEvent(event) {
        const mapped = toLogEvent(event);
        if (mapped) call.onEvent?.(mapped);
      },
    });
    return { ok: result.ok, text: result.text, error: result.error, stop: result.stop, turns: result.turns, durationMs: result.durationMs };
  }

  return {
    available() {
      const status = deep().available();
      return { ok: status.ok, reason: status.ok ? null : (status.reason ?? null) };
    },
    plan: (call) => run('selfdev_plan', planSystem(), planPrompt(call.request, call.reason), ['read'], PLAN_TURNS, call),
    implement: (call) => run('selfdev_implement', implementSystem(), implementPrompt(call.request, call.planText), ['read', 'write'], IMPLEMENT_TURNS, call),
    fix: (call) => run('selfdev_fix', fixSystem(), fixPrompt(call.request, call.command, call.output, call.round), ['read', 'write'], FIX_TURNS, call),
  };
}
