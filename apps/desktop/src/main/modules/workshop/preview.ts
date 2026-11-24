/**
 * Eklenti önizlemesi: bir manifestin NE EKLEDİĞİNİ ve HANGİ İZİNLERİ istediğini kullanıcının okuyacağı Türkçe satırlara
 * çevirir. Onay kartı (ada), sesli özet ve Eklentiler sayfası aynı işlevi kullanır; böylece kullanıcının onayladığı şey
 * ile gördüğü şey aynı kaynaktan gelir. Saf işlevlerdir (dosya, ağ, durum yok).
 */
import { t } from '@fuber/shared';
import { visibleTools } from './manifest';
import type { PluginAnnounce, PluginPreview, PluginSchedule, WorkshopManifest } from './types';

const EVENT_KEYS: Record<string, string> = {
  'app.started': 'plugins.event.appStarted',
  'reminder.fired': 'plugins.event.reminderFired',
  'mail.received': 'plugins.event.mailReceived',
  'watch.fired': 'plugins.event.watchFired',
  'user.returned': 'plugins.event.userReturned',
};

const DAY_KEYS = ['', 'plugins.day.1', 'plugins.day.2', 'plugins.day.3', 'plugins.day.4', 'plugins.day.5', 'plugins.day.6', 'plugins.day.7'];

/** İnsan okur zamanlama: "her gün 09:00", "10 dakikada bir", "e-posta gelince". */
export function describeSchedule(schedule: PluginSchedule): string {
  if ('daily' in schedule) {
    if (!schedule.days || schedule.days.length === 7) return t('plugins.schedule.daily', { time: schedule.daily });
    return t('plugins.schedule.days', { days: schedule.days.map((day) => t(DAY_KEYS[day] ?? 'plugins.day.1')).join(', '), time: schedule.daily });
  }
  if ('everyMinutes' in schedule) return describeEvery(schedule.everyMinutes);
  return t(EVENT_KEYS[schedule.on] ?? 'plugins.event.appStarted');
}

export function describeEvery(minutes: number): string {
  if (minutes % 1440 === 0) return minutes === 1440 ? t('plugins.schedule.everyDay') : t('plugins.schedule.everyDays', { count: minutes / 1440 });
  if (minutes % 60 === 0) return minutes === 60 ? t('plugins.schedule.everyHour') : t('plugins.schedule.everyHours', { count: minutes / 60 });
  return t('plugins.schedule.everyMinutes', { count: minutes });
}

const announceText = (announce: PluginAnnounce): string =>
  announce === 'speak' ? t('plugins.announce.speak') : announce === 'notify' ? t('plugins.announce.notify') : t('plugins.announce.silent');

/** "Ne ekleyecek" satırları. */
export function describeAdds(manifest: WorkshopManifest): string[] {
  const lines: string[] = [];
  const tools = visibleTools(manifest);
  if (tools.length > 0) lines.push(t('plugins.adds.tools', { count: tools.length }));
  for (const card of manifest.cards ?? []) lines.push(t('plugins.adds.card', { title: card.title, every: describeEvery(card.refreshMinutes) }));
  for (const page of manifest.pages ?? []) lines.push(t('plugins.adds.page', { title: page.title }));
  for (const job of manifest.jobs ?? []) {
    lines.push(t('plugins.adds.job', { title: job.title, schedule: describeSchedule(job.schedule), announce: announceText(job.announce) }));
  }
  for (const watch of manifest.watches ?? []) {
    lines.push(t('plugins.adds.watch', { title: watch.title, every: describeEvery(watch.everyMinutes), announce: announceText(watch.announce) }));
  }
  if ((manifest.settings ?? []).length > 0) lines.push(t('plugins.adds.settings', { count: manifest.settings!.length }));
  const phrases = (manifest.voice ?? []).flatMap((entry) => entry.phrases.slice(0, 1));
  if (phrases.length > 0) lines.push(t('plugins.adds.voice', { phrases: phrases.map((phrase) => `"${phrase}"`).join(', ') }));
  return lines;
}

/** "Hangi izinler" satırları. İzin istemeyen eklentide tek satır: özel izin istemiyor. */
export function describePermissions(manifest: WorkshopManifest): string[] {
  const lines: string[] = [];
  if (manifest.permissions.includes('net')) lines.push(t('plugins.permission.net', { hosts: (manifest.net?.hosts ?? []).join(', ') }));
  if (manifest.permissions.includes('fs')) lines.push(t('plugins.permission.fs', { roots: (manifest.fs?.roots ?? []).map(prettyRoot).join(', ') }));
  if ((manifest.uses?.tools ?? []).length > 0) lines.push(t('plugins.permission.tools', { tools: manifest.uses!.tools.join(', ') }));
  if (manifest.speak) lines.push(t('plugins.permission.speak'));
  if (manifest.permissions.includes('notify')) lines.push(t('plugins.permission.notify'));
  if (lines.length === 0) lines.push(t('plugins.permission.none'));
  return lines;
}

/** `{belgeler}/Jarvis` → `Belgeler\Jarvis`. */
export function prettyRoot(root: string): string {
  return root
    .replace('{belgeler}', t('plugins.folder.documents'))
    .replace('{masaustu}', t('plugins.folder.desktop'))
    .replace('{indirilenler}', t('plugins.folder.downloads'))
    .replace(/\//g, '\\');
}

/**
 * Güncelleme farkları: bir önceki sürüme göre YENİ izinler ve yeni katkılar. Yeni izin her zaman ilk sırada ve açıkça
 * yazılır; kullanıcı güncellemeyi onaylarken neyin genişlediğini görür.
 */
export function describeChanges(next: WorkshopManifest, previous: WorkshopManifest): string[] {
  const lines: string[] = [];
  const added = <T>(now: readonly T[] | undefined, before: readonly T[] | undefined, key: (item: T) => string) => {
    const known = new Set((before ?? []).map(key));
    return (now ?? []).filter((item) => !known.has(key(item)));
  };
  const same = (value: string) => value;
  const hosts = added(next.net?.hosts, previous.net?.hosts, same);
  if (hosts.length > 0) lines.push(t('plugins.change.hosts', { hosts: hosts.join(', ') }));
  const roots = added(next.fs?.roots, previous.fs?.roots, same);
  if (roots.length > 0) lines.push(t('plugins.change.roots', { roots: roots.map(prettyRoot).join(', ') }));
  const used = added(next.uses?.tools, previous.uses?.tools, same);
  if (used.length > 0) lines.push(t('plugins.change.tools', { tools: used.join(', ') }));
  if (next.speak && !previous.speak) lines.push(t('plugins.change.speak'));
  if (next.permissions.includes('notify') && !previous.permissions.includes('notify')) lines.push(t('plugins.change.notify'));

  const newTools = added(visibleTools(next), visibleTools(previous), (tool) => tool.name);
  if (newTools.length > 0) lines.push(t('plugins.change.newTools', { count: newTools.length }));
  for (const card of added(next.cards, previous.cards, (item) => item.id)) lines.push(t('plugins.change.newCard', { title: card.title }));
  for (const page of added(next.pages, previous.pages, (item) => item.id)) lines.push(t('plugins.change.newPage', { title: page.title }));
  for (const job of added(next.jobs, previous.jobs, (item) => item.id)) {
    lines.push(t('plugins.change.newJob', { title: job.title, schedule: describeSchedule(job.schedule) }));
  }
  for (const watch of added(next.watches, previous.watches, (item) => item.id)) lines.push(t('plugins.change.newWatch', { title: watch.title }));
  const removed =
    added(visibleTools(previous), visibleTools(next), (tool) => tool.name).length +
    added(previous.cards, next.cards, (item) => item.id).length +
    added(previous.pages, next.pages, (item) => item.id).length +
    added(previous.jobs, next.jobs, (item) => item.id).length +
    added(previous.watches, next.watches, (item) => item.id).length;
  if (removed > 0) lines.push(t('plugins.change.removed', { count: removed }));
  if (lines.length === 0) lines.push(t('plugins.change.codeOnly'));
  return lines;
}

/** Yeni sürüm, öncekinde olmayan bir İZİN istiyor mu (onayda vurgulanır). */
export function widensPermissions(next: WorkshopManifest, previous: WorkshopManifest): boolean {
  const more = (now: readonly string[] | undefined, before: readonly string[] | undefined) => (now ?? []).some((item) => !(before ?? []).includes(item));
  return (
    more(next.net?.hosts, previous.net?.hosts) ||
    more(next.fs?.roots, previous.fs?.roots) ||
    more(next.uses?.tools, previous.uses?.tools) ||
    more(next.permissions, previous.permissions) ||
    (next.speak === true && previous.speak !== true)
  );
}

export function buildPreview(manifest: WorkshopManifest, options: { staged: boolean; previous?: WorkshopManifest | null }): PluginPreview {
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    tools: visibleTools(manifest).length,
    hiddenTools: manifest.tools.length - visibleTools(manifest).length,
    cards: manifest.cards ?? [],
    jobs: manifest.jobs ?? [],
    watches: manifest.watches ?? [],
    pages: manifest.pages ?? [],
    settings: manifest.settings ?? [],
    voice: manifest.voice ?? [],
    hosts: manifest.net?.hosts ?? [],
    roots: manifest.fs?.roots ?? [],
    usedTools: manifest.uses?.tools ?? [],
    speak: manifest.speak === true,
    notify: manifest.permissions.includes('notify'),
    adds: describeAdds(manifest),
    permissions: describePermissions(manifest),
    changes: options.previous ? describeChanges(manifest, options.previous) : [],
    staged: options.staged,
  };
}

/** Sesli ve ada onay özeti için tek cümlelik "ne ekliyor; hangi izinler". */
export function spokenPreview(manifest: WorkshopManifest): { adds: string; permissions: string } {
  return { adds: describeAdds(manifest).join('; '), permissions: describePermissions(manifest).join('; ') };
}
