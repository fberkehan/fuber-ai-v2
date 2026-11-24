// CAL: uygulamanın bütün takvim/plan kaynakları BİRLEŞİK (planlayıcı hatırlatıcıları, bugün/gecikmiş görevler).
// Uygulamada Google/Outlook/ICS bağlantısı YOKTUR; "toplantı" modülü kayıt tutar, takvim tutmaz. Briefing'in
// "gündem" bölümü de aynı iki kaynaktır. Hiçbiri yoksa kutu boş kalmaz: ipucu satırı gelir.
import type { Reminder, Todo } from '@fuber/shared';
import type { HudCal, HudCalItem } from './types';

const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const CAL_MAX_ITEMS = 6;
export const CAL_HINT = "“Jarvis, yarın 10'da toplantı ekle” demeniz yeter.";

const PRIORITY_TR: Record<string, string> = { urgent: 'ACİL', high: 'ÖNEMLİ' };

export interface CalSources {
  /** Planlayıcı hatırlatıcıları (hepsi). `null`: planlayıcı kapalı. */
  reminders: Reminder[] | null;
  /** Açık görevler (`done: false`). */
  todos?: Todo[] | null;
}

/** Eski imza (yalnız hatırlatıcı) da desteklenir. */
export function buildCal(input: Reminder[] | null | CalSources, nowMs: number): HudCal {
  const src: CalSources = Array.isArray(input) || input === null ? { reminders: input } : input;
  const noPlanner = src.reminders === null && src.todos == null;
  if (noPlanner) return { status: 'off', nextInSec: null, items: [] };
  const now = new Date(nowMs);
  const today = dayKey(now);
  const live = (src.reminders ?? []).filter((r) => r.status === 'scheduled' || r.status === 'fired');
  const todays = live
    .map((r) => ({ r, at: Date.parse(r.dueAt) }))
    .filter((x) => Number.isFinite(x.at) && dayKey(new Date(x.at)) === today)
    .sort((a, b) => a.at - b.at);
  // Sıradaki: şimdiden sonraki en yakın bekleyen hatırlatıcı (yarına taşsa da).
  const upcoming = live
    .filter((r) => r.status === 'scheduled')
    .map((r) => ({ r, at: Date.parse(r.dueAt) }))
    .filter((x) => Number.isFinite(x.at) && x.at >= nowMs)
    .sort((a, b) => a.at - b.at)[0];
  const nextRef = upcoming?.r.id;
  const events: HudCalItem[] = todays.map(({ r, at }) => ({
    ref: `cal:${r.id}`,
    time: hhmm(new Date(at)),
    title: r.text,
    place: PRIORITY_TR[r.priority] ?? '',
    current: r.id === nextRef,
    at,
    kind: 'event',
  }));
  const todos: HudCalItem[] = (src.todos ?? [])
    .filter((t) => !t.done && t.dueDay !== null && t.dueDay <= today)
    .map((t) => ({ ref: `todo:${t.id}`, time: '—', title: t.text, place: t.dueDay! < today ? 'GECİKMİŞ' : 'GÖREV', current: false, kind: 'todo' as const }));
  // Açık görev sayısı (bugüne bağlı olmayanlar) — boş durumda "görevleriniz" satırı için.
  const openTodos: HudCalItem[] = (src.todos ?? [])
    .filter((t) => !t.done && (t.dueDay === null || t.dueDay > today))
    .slice(0, 3)
    .map((t) => ({ ref: `todo:${t.id}`, time: '—', title: t.text, place: 'GÖREV', current: false, kind: 'todo' as const }));
  const all = [...events, ...todos];
  const items = (all.length ? all : openTodos).slice(0, CAL_MAX_ITEMS);
  return {
    status: 'ok',
    nextInSec: upcoming ? Math.max(0, Math.round((upcoming.at - nowMs) / 1000)) : null,
    items,
    eventCount: events.length,
    ...(events.length === 0 ? { hint: CAL_HINT } : {}),
  };
}

/** Süresi geçmiş ya da çalıp tamamlanmamış hatırlatıcı sayısı (dikkat bekleyenler). */
export function overdueCount(reminders: Reminder[] | null, nowMs: number): number {
  if (!reminders) return 0;
  return reminders.filter((r) => r.status === 'fired' || (r.status === 'scheduled' && Date.parse(r.dueAt) < nowMs)).length;
}
