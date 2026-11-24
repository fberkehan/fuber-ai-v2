// Jarvis'in "şu an ne yapıyor" cümleleri: ada, ana pencere çentiği ve Bugün aynı cümleyi kurar (iş izi).
import { t, type MessageKey } from '@fuber/shared';

/** Altyazıda bir cümlenin en uzun hâli; daha uzunu sondan gösterilir. */
const SAY_MAX_CHARS = 118;

/** Konuşulan metnin son cümlesi ve sırası; uzun cümlede son sözcükler (baştaki "…" ile). */
export function currentSentence(text: string, maxChars = SAY_MAX_CHARS): { index: number; text: string } {
  const sentences = text
    .trim()
    .split(/(?<=[.!?…])\s+/)
    .filter(Boolean);
  const index = Math.max(0, sentences.length - 1);
  let sentence = sentences[index] ?? '';
  if (sentence.length > maxChars) {
    const words = sentence.split(/\s+/);
    while (words.length > 1 && words.join(' ').length > maxChars - 2) words.shift();
    sentence = `… ${words.join(' ')}`;
  }
  return { index, text: sentence };
}

/** Metnin sonu, bir sözcüğün başından: "…muhasebeciyi aramayı hatırlat" (kırpık harf yok). */
export function tailWords(text: string, maxChars: number): string {
  const clean = text.trim().replace(/\s+/g, ' ');
  if (clean.length <= maxChars) return clean;
  const words = clean.split(' ');
  const kept: string[] = [];
  let length = 0;
  for (let i = words.length - 1; i >= 0; i--) {
    const word = words[i] ?? '';
    if (length + word.length + 1 > maxChars - 2 && kept.length > 0) break;
    kept.unshift(word);
    length += word.length + 1;
  }
  return `… ${kept.join(' ')}`;
}

const toolKey: Record<string, MessageKey> = {
  planner: 'hud.island.tool.planner',
  projects: 'hud.island.tool.projects',
  memory: 'hud.island.tool.memory',
  web: 'hud.island.tool.web',
  pc: 'hud.island.tool.pc',
  documents: 'hud.island.tool.documents',
  workshop: 'hud.island.tool.skills',
  skills: 'hud.island.tool.skills',
};

/** Düşünürken süren araç adımının cümlesi: "Planlara bakıyorum". Araç yoksa "Düşünüyorum". */
export const thinkingLine = (toolModule: string | null): string =>
  toolModule === null ? t('hud.island.thinking') : t(toolKey[toolModule] ?? 'hud.island.tool.other');
