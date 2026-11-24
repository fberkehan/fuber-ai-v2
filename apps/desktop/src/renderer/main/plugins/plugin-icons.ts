// Eklenti sayfası simgesi: manifestteki `icon` adı hazır küçük bir kümeye çevrilir (saf mantık; çizim `PluginIcon.tsx`'te).

export const PLUGIN_ICON_KEYS = [
  'puzzle',
  'timer',
  'chart',
  'note',
  'list',
  'calendar',
  'coin',
  'globe',
  'bell',
  'star',
  'heart',
  'wrench',
  'game',
  'music',
  'book',
  'clock',
] as const;

export type PluginIconKey = (typeof PLUGIN_ICON_KEYS)[number];

/** Yaygın eş anlamlılar: model "calculator" ya da "todo" yazsa da makul bir simge çıkar. */
const ALIASES: Record<string, PluginIconKey> = {
  stopwatch: 'timer',
  pomodoro: 'timer',
  countdown: 'timer',
  graph: 'chart',
  stats: 'chart',
  analytics: 'chart',
  notes: 'note',
  memo: 'note',
  todo: 'list',
  tasks: 'list',
  checklist: 'list',
  date: 'calendar',
  agenda: 'calendar',
  money: 'coin',
  finance: 'coin',
  currency: 'coin',
  world: 'globe',
  web: 'globe',
  notification: 'bell',
  alert: 'bell',
  favorite: 'star',
  like: 'heart',
  health: 'heart',
  tool: 'wrench',
  tools: 'wrench',
  settings: 'wrench',
  games: 'game',
  gamepad: 'game',
  audio: 'music',
  sound: 'music',
  reading: 'book',
  library: 'book',
  time: 'clock',
  watch: 'clock',
};

/** Bilinmeyen ya da boş ad `puzzle` olur. Büyük/küçük harf ve baştaki/sondaki boşluk önemsenmez. */
export function pluginIconKey(name: string | null | undefined): PluginIconKey {
  const key = (name ?? '').trim().toLowerCase();
  if ((PLUGIN_ICON_KEYS as readonly string[]).includes(key)) return key as PluginIconKey;
  return ALIASES[key] ?? 'puzzle';
}
