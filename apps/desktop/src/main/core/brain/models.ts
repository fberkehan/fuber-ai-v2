// Sahibi: T2. Model kimliğine göre istek alanları: düşünme, efor, hız, sunucu tarafı yedek, sunucu araçları.
import type { Effort, ModelRef } from '@fuber/shared';
import type { BetaToolUnion } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { ServerTool } from '@fuber/shared';

/** Düşünmesi kapatılamayan modeller: `{type:'disabled'}` 400 döner, eforla yönetilir. */
const THINKING_ALWAYS_ON = /^claude-(opus-5-5|sonnet-5-5|fable-|mythos-)/;
/** Sunucu tarafı ret yedeği (`fallbacks: "default"`) olan modeller. Haiku 5.5'te yok. */
const SERVER_FALLBACK = /^claude-(opus-5-5|opus-5(?!-)|sonnet-5-5|fable-5-1|fable-5-2|mythos-5-2)/;
/** Hızlı çıktı (`speed: "fast"`) beta başlığı istemeden destekleyen modeller. */
const FAST_MODE = /^claude-(opus-5-5|fable-5-2|mythos-5-2)/;
/** Dinamik süzgeçli web araçlarını (`_20260209`) destekleyen modeller. */
const DYNAMIC_WEB = /^claude-(opus-5-5|opus-5|opus-4-[678]|sonnet-5-5|sonnet-5|sonnet-4-6|fable-|mythos-)/;

export const SERVER_FALLBACK_BETA = 'server-side-fallback-2026-07-01';

const HIGH_OR_BELOW: ReadonlySet<Effort> = new Set(['low', 'medium', 'high']);

export interface ModelParams {
  thinking?: { type: 'adaptive' } | { type: 'disabled' };
  effort: Effort | null;
  speed?: 'fast';
  fallback: boolean;
  /** Politikada `off` istenip modelde uygulanamadıysa günlüğe yazılacak not. */
  note: string | null;
}

/**
 * Rolün model ayarını isteğe çevirir. `effortOverride` yalnız bu çağrı için (yazılı sohbet: `medium`).
 * `off` istenip model düşünmeyi kapatamıyorsa parametre hiç gönderilmez ve efor `low`'a çekilir;
 * Haiku 5.5'te `disabled` yalnız efor `high` ve altında kabul edilir.
 */
export function modelParams(ref: ModelRef, effortOverride?: Effort): ModelParams {
  const model = ref.model;
  let effort: Effort | null = effortOverride ?? ref.effort;
  let thinking: ModelParams['thinking'];
  let note: string | null = null;

  if (ref.thinking === 'off') {
    if (THINKING_ALWAYS_ON.test(model)) {
      effort = 'low';
      note = `${model} düşünmeyi kapatamıyor; düşünme parametresi gönderilmedi, efor low`;
    } else if (effort === null || HIGH_OR_BELOW.has(effort)) {
      thinking = { type: 'disabled' };
    } else {
      thinking = { type: 'adaptive' };
      note = `${model} ${effort} eforda düşünmeyi kapatamıyor; adaptive gönderildi`;
    }
  } else {
    thinking = { type: 'adaptive' };
  }

  return {
    ...(thinking ? { thinking } : {}),
    effort,
    ...(ref.speed === 'fast' && FAST_MODE.test(model) ? { speed: 'fast' as const } : {}),
    fallback: SERVER_FALLBACK.test(model),
    note,
  };
}

export function serverToolDefs(model: string, tools: ServerTool[] | undefined): BetaToolUnion[] {
  if (!tools?.length) return [];
  const dynamic = DYNAMIC_WEB.test(model);
  return tools.map((tool): BetaToolUnion => {
    if (tool === 'web_search') {
      return dynamic
        ? { type: 'web_search_20260209', name: 'web_search', max_uses: 5 }
        : { type: 'web_search_20250305', name: 'web_search', max_uses: 5 };
    }
    return dynamic
      ? { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 5 }
      : { type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 5 };
  });
}

/** Çıktı sınırı: düşünme de bu sınıra sayılır. */
export function maxTokensFor(role: string, style: 'voice' | 'chat' | 'task' | 'plain'): number {
  if (style === 'voice') return 4096;
  if (role === 'memory') return 4096;
  if (style === 'chat') return 16_000;
  return 32_000;
}
