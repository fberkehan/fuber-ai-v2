// Ekrana bakma: önce görüntü anlayan beyin (derin beyin köprüsü, yoksa bulut `vision` rolü); o da yoksa
// "göremiyorum" deyip susmak yerine ekrandaki YAZIYI erişilebilirlik ağacından okur.
import { t, type BrainImage, type ToolContext, type ToolResult } from '@fuber/shared';
import { sensitiveWindow } from './guard';
import { defaultTarget, describeWindow, outline, untrusted } from './read';
import type { DeepBrain, Rect, UiaProvider } from './types';

/** Son ekran görüntüsünün ölçüsü: görüntüdeki (x, y) → ekrandaki fiziksel piksel (v1'deki koordinat çevirisi). */
export interface ShotGeometry {
  /** Görüntüsü alınan ekranın fiziksel dikdörtgeni. */
  screen: Rect;
  /** Modele giden görüntünün boyutu. */
  width: number;
  height: number;
  at: number;
}

export interface Capture extends BrainImage {
  geometry?: Omit<ShotGeometry, 'at'>;
  /** Görüntü neredeyse tamamen siyah (ekran uykuda, içerik korumalı). */
  dark?: boolean;
}

export interface ScreenDeps {
  /** `screen`: ekran numarası (`ScreenInfo.index`); verilmezse imlecin bulunduğu ekran. */
  captureScreen(screen?: number): Promise<Capture>;
  uia?: UiaProvider;
  deepBrain?: DeepBrain;
}

const SHOT_TTL_MS = 2 * 60_000;
const FALLBACK_CHARS = 2500;

export function createShotMemory() {
  let last: ShotGeometry | null = null;
  return {
    remember(geometry: Omit<ShotGeometry, 'at'> | undefined) {
      last = geometry ? { ...geometry, at: Date.now() } : null;
    },
    /** Görüntüdeki noktayı ekrana çevirir; görüntü yoksa ya da bayatsa `null` (bayat koordinatla tıklanmaz). */
    toScreen(point: { x: number; y: number }): { x: number; y: number } | null {
      if (!last || Date.now() - last.at > SHOT_TTL_MS || last.width <= 0 || last.height <= 0) return null;
      if (point.x < 0 || point.y < 0 || point.x > last.width || point.y > last.height) return null;
      const { screen } = last;
      return {
        x: Math.round(screen.left + (point.x / last.width) * (screen.right - screen.left)),
        y: Math.round(screen.top + (point.y / last.height) * (screen.bottom - screen.top)),
      };
    },
  };
}

export type ShotMemory = ReturnType<typeof createShotMemory>;

/** Ekrandaki yazı (öndeki pencere): görüntü yokken verilecek dürüst yanıtın gövdesi. */
async function screenText(uia: UiaProvider): Promise<string | null> {
  const list = await uia.windows();
  const window = defaultTarget(list);
  if (!window) return null;
  const read = await uia.read(window.hwnd, { maxText: FALLBACK_CHARS });
  const body = outline(read.nodes, FALLBACK_CHARS);
  const others = list.windows.filter((other) => other.hwnd !== window.hwnd && !other.minimized && !other.own).slice(0, 5);
  const lines = [t('pc.read.header', { title: window.title, app: window.app }), body.text || t('pc.read.empty')];
  if (body.truncated) lines.push(t('pc.read.truncated'));
  if (others.length > 0) lines.push('', t('pc.windows.list', { count: others.length }), ...others.map((other) => `- ${describeWindow(other)}`));
  return lines.join('\n');
}

export async function lookAtScreen(ctx: ToolContext, deps: ScreenDeps, shots: ShotMemory, question?: string, screen?: number): Promise<ToolResult> {
  // Parola yöneticisi ya da banka sayfası öndeyken görüntü alınmaz, metin de okunmaz.
  if (deps.uia) {
    try {
      const list = await deps.uia.windows();
      if (list.locked) return { ok: false, text: t('pc.fail.locked') };
      const sensitive = list.foreground ? sensitiveWindow(list.foreground) : null;
      if (sensitive) return { ok: false, text: t('pc.look.sensitive', { detail: t(`pc.sensitive.${sensitive}`) }) };
    } catch {
      // pencere bilgisi yoksa görüntü yolu yine denenir
    }
  }

  const policy = ctx.policy.get();
  const network = ctx.policy.networkAllowed();
  const deep = network ? deps.deepBrain : undefined;
  const deepReady = deep ? deep.available() : null;
  const cloudVision = network && policy.models.vision.provider === 'anthropic';
  let reason = t('pc.look.noVision');

  if (deepReady?.ok || cloudVision) {
    let capture: Capture | null = null;
    try {
      capture = await deps.captureScreen(screen);
    } catch (error) {
      reason = t('projects.pc.captureFailed') + (error instanceof Error ? ` (${error.message})` : '');
    }
    if (capture?.dark) {
      reason = t('pc.look.dark');
      capture = null;
    }
    if (capture) {
      shots.remember(capture.geometry);
      const size = capture.geometry ? `\n${t('pc.look.size', { width: capture.geometry.width, height: capture.geometry.height })}` : '';
      const prompt = (question?.trim() || t('projects.pc.visionDefault')) + size;
      if (deep && deepReady?.ok) {
        // Görüntü bellekten gider: ekran görüntüsü diske hiç yazılmaz (derin beyin onu ileti içinde blok olarak taşır).
        try {
          const answer = await deep.ask({
            system: t('projects.pc.visionInstructions'),
            prompt,
            images: [{ mediaType: capture.mediaType, data: capture.data }],
            maxSeconds: 45,
            signal: ctx.signal,
          });
          if (answer.text.trim()) return { ok: true, text: answer.text.trim(), data: { vision: deepReady.provider, untrusted: true } };
          reason = t('projects.pc.visionFailed');
        } catch (error) {
          reason = error instanceof Error ? error.message : String(error);
        }
      } else {
        const response = await ctx.brain.respond({
          role: 'vision',
          tools: 'none',
          persona: false,
          origin: ctx.origin,
          signal: ctx.signal,
          instructions: t('projects.pc.visionInstructions'),
          messages: [{ role: 'user', text: prompt, images: [{ mediaType: capture.mediaType, data: capture.data }] }],
        });
        if (response.stopReason === 'end' && response.text.trim()) return { ok: true, text: response.text.trim(), data: { vision: 'cloud', untrusted: true } };
        reason = response.error ?? t('projects.pc.visionFailed');
      }
    }
  } else if (!network || policy.models.vision.provider !== 'anthropic') {
    reason = deepReady?.reason ?? t('projects.pc.visionNeedsCloud');
  }

  // Görüntü yok: ekranda yazanı oku ve bunun görüntü olmadığını açıkça söyle.
  if (deps.uia) {
    try {
      const text = await screenText(deps.uia);
      if (text) return { ok: true, text: `${t('pc.look.textOnly', { reason })}\n${untrusted(text)}`, data: { vision: null, untrusted: true } };
    } catch {
      // aşağıda dürüst hata
    }
  }
  return { ok: false, text: deps.uia ? t('pc.look.none') : reason };
}
