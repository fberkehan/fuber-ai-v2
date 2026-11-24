// Arka plan araştırmasının derin iş kısmı: derin beyin (Anthropic API ya da bu bilgisayardaki Claude Code) web
// araçlarıyla araştırır; çıktı sesli okunacak kısa bir özet + kaynaklı rapordur. Dosya aracı verilmez: iş boş bir
// geçici klasörde koşar. Web içeriği TALİMAT DEĞİLDİR (KURGU §13); rapor da güvenilmez veridir.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { t, type ModuleContext } from '@fuber/shared';
import { deepBrainFor, type DeepBrain } from '../../core/brain/deep';

/** Araştırmanın süre sınırı (saniye). */
export const RESEARCH_SECONDS = 600;
const MAX_SPOKEN_CHARS = 400;

export interface ResearchReport {
  /** Sesli okunacak bir iki cümle. */
  spoken: string;
  /** Kaynaklı tam rapor (Markdown). */
  report: string;
}

/** Derin beyin yoksa kullanıcıya söylenecek neden; varsa `null`. */
export async function researchBlocker(ctx: ModuleContext): Promise<string | null> {
  const availability = await deepBrainFor(ctx).refresh();
  return availability.ok ? null : t('deep.research.unavailable', { reason: availability.reason ?? '' }).trim();
}

/** `ÖZET:` satırını rapordan ayırır; model biçime uymadıysa özet raporun ilk iki cümlesidir. */
export function splitReport(text: string): ResearchReport {
  const clean = text.trim();
  const match = /^\s*(?:\*\*)?ÖZET:?(?:\*\*)?:?\s*([\s\S]+?)\n\s*\n([\s\S]+)$/i.exec(clean);
  if (match) {
    const spoken = match[1]!.replace(/\s+/g, ' ').trim();
    return { spoken: spoken.length > MAX_SPOKEN_CHARS ? `${spoken.slice(0, MAX_SPOKEN_CHARS)}…` : spoken, report: match[2]!.trim() };
  }
  const plain = clean
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[#*_`>|-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const sentences = plain.match(/[^.!?]+[.!?]+/g) ?? [plain];
  const spoken = sentences
    .slice(0, 2)
    .map((sentence) => sentence.trim())
    .join(' ');
  return { spoken: spoken.length > MAX_SPOKEN_CHARS ? `${spoken.slice(0, MAX_SPOKEN_CHARS)}…` : spoken, report: clean };
}

/** Konuyu araştırır; ilerlemeyi iş adımı olarak bildirir. Başarısızsa kullanıcıya söylenebilir iletiyle fırlatır. */
export async function runDeepResearch(
  ctx: ModuleContext,
  topic: string,
  control: { signal: AbortSignal; update(change: { progress?: number | null; step?: string }): void },
  deep: DeepBrain = deepBrainFor(ctx),
): Promise<ResearchReport> {
  const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'fuber2-research-'));
  let steps = 0;
  try {
    const result = await deep.runTask({
      kind: 'research',
      system: `${t('projects.web.instructions')}\n\n${t('deep.research.format')}`,
      prompt: t('projects.web.researchGoal', { topic }),
      workDir,
      allowedTools: ['web'],
      maxSeconds: RESEARCH_SECONDS,
      signal: control.signal,
      onEvent(event) {
        if (event.type !== 'tool' || event.phase !== 'start') return;
        steps++;
        const step =
          event.name === 'WebSearch' && event.detail
            ? t('deep.research.stepQuery', { query: event.detail })
            : event.name === 'WebFetch' && event.detail
              ? t('deep.research.stepSite', { site: event.detail })
              : t('projects.web.stepReading', { n: steps });
        control.update({ progress: Math.min(0.8, 0.1 + steps * 0.07), step });
      },
    });
    if (!result.ok || !result.text.trim()) throw new Error(result.error ?? t('projects.web.failed'));
    return splitReport(result.text);
  } finally {
    await fs.promises.rm(workDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => {});
  }
}
