/**
 * Yazıya çevirmenin sözcük listesi: Whisper'ın ilk istemine giren özel adlar (proje adları ve sık geçen
 * özel sözcükler). Liste olmadan özel adlar rastgele yazılabiliyor.
 *
 * Ses servisi modülleri tanımaz, modüller de sesi: adlar modüllerin kendi IPC kanallarından okunur ve veri
 * değiştiğinde (`projects.changed`, `module.changed`) yeniden toplanır.
 */

import type { Bus, Logger, Project, Unsubscribe } from '@fuber/shared';

/** Whisper istemi kısadır (`whisper-local.ts` 600 karakterde keser); öncelik sırasıyla doldurulur. */
const MAX_WORDS = 40;
const MAX_PROJECTS = 20;
const REFRESH_DELAY_MS = 400;

/** Whisper'ın yanlış yazabildiği, ürünün kendi sözcükleri. */
export const BASE_VOCABULARY = ['Fuber', 'Claude', 'Jarvis'] as const;

export interface VocabularySources {
  /** Kanal bağlı değilse (modül kapalı) ya da hata verirse `null`. */
  projects(): Promise<Project[] | null>;
}

export function collectVocabulary(projects: Project[]): string[] {
  const words: string[] = [...BASE_VOCABULARY];
  // Sabitlenen ve son kullanılan projeler önce: liste uzunsa kuyruk düşer.
  const ranked = [...projects].sort(
    (a, b) =>
      Number(b.pinned) - Number(a.pinned) ||
      (b.lastSessionAt ?? b.modifiedAt).localeCompare(a.lastSessionAt ?? a.modifiedAt),
  );
  for (const project of ranked.slice(0, MAX_PROJECTS)) words.push(project.name);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const word of words) {
    const clean = word.trim();
    const key = clean.toLocaleLowerCase('tr');
    // Çok uzun ad istemi tek başına doldurur; Whisper'a yardımı da olmaz.
    if (!clean || clean.length > 40 || seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= MAX_WORDS) break;
  }
  return out;
}

export function bindSttVocabulary(deps: {
  bus: Bus;
  log: Logger;
  sources: VocabularySources;
  apply(words: string[]): void;
}): Unsubscribe {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last = '';

  const refresh = async () => {
    timer = null;
    try {
      const projects = await deps.sources.projects();
      const words = collectVocabulary(projects ?? []);
      const key = words.join('\n');
      if (key === last) return;
      last = key;
      deps.apply(words);
      deps.log.debug(`yazıya çevirme sözcük listesi: ${words.length} ad`);
    } catch (error) {
      deps.log.warn('yazıya çevirme sözcük listesi güncellenemedi', error);
    }
  };
  /** Art arda gelen değişiklikler (toplu içe aktarma, tarama) tek güncellemeye iner. */
  const schedule = () => {
    if (timer) return;
    timer = setTimeout(() => void refresh(), REFRESH_DELAY_MS);
    timer.unref?.();
  };

  const subscriptions = [
    deps.bus.on('projects.changed', ({ entity }) => {
      if (entity === 'project') schedule();
    }),
    deps.bus.on('module.changed', ({ id }) => {
      if (id === 'projects') schedule();
    }),
  ];
  schedule();
  return () => {
    if (timer) clearTimeout(timer);
    timer = null;
    for (const off of subscriptions) off();
  };
}
