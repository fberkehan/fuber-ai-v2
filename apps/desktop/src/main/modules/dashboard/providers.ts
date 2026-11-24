// Kokpit'in yerleşik doldurucuları. Her biri bir karttır; veri yoksa `null` döner ve kart çizilmez.
//
// Aynı bilgi iki kartta gösterilmez:
//   onay bekleyen iş      → yalnız bugün bandında
//   hatırlatıcılar        → "Sırada" (band yalnız sayıyı ve hafta şeridindeki noktayı taşır)
//   süren işler           → "Süren işler"; bitenler "Son olanlar"
//   son konuşma           → sayfanın sağındaki yerleşik sohbet (kart değil)
//
// Planlar ve Projeler'in verisi o modüllerin depo okuyucularıyla okunur (yalnız okuma). Bu bağdaştırıcılar,
// modüller kendi kartlarını `dashboard.registerProvider` ile kaydettiğinde buradan kalkabilir.
import {
  addDays,
  daysBetween,
  describeRecurrence,
  localDay,
  localTime,
  t,
  type ActivityData,
  type AgendaData,
  type DashboardFill,
  type DashboardFillContext,
  type DashboardJobsCollect,
  type DashboardProvider,
  type DashboardWeekDay,
  type JobsData,
  type JobsItem,
  type LocalDay,
  type ModuleContext,
  type NoticesData,
  type Reminder,
  type SessionsData,
  type SuggestionsData,
  type Todo,
  type TodayBandData,
  type TodosData,
  type UsageData,
  DASHBOARD_CARD_IDS as IDS,
} from '@fuber/shared';
import { createPlannerRepo } from '../planner/repo';
import { createProjectsRepo } from '../projects/repo';
import type { DashboardNetwork } from './network';
import type { DashboardStore } from './store';

const DAY_MS = 24 * 60 * 60 * 1000;
/** "Sırada" ve hafta şeridi bu kadar gün ileriye bakar. */
export const AHEAD_DAYS = 7;
const MAX_AGENDA = 8;
const MAX_TODOS = 7;
const MAX_SESSIONS = 4;
const MAX_ACTIVITY = 6;
/** "Süren işler" kartı: arka plan işleri ve katkılar (takip işleri) birlikte en çok bu kadar. */
const MAX_JOBS = 10;
/** Claude Code kartı yalnız son günlerde etkin oturumları gösterir; eski oturum sayfayı doldurmaz. */
const SESSION_RECENT_DAYS = 3;

export const MODULE_ID = 'dashboard';

interface Plan {
  reminders: Reminder[];
  todos: Todo[];
}

export interface BuiltinDeps {
  ctx: ModuleContext;
  store: DashboardStore;
  network: DashboardNetwork;
}

export function builtinProviders({ ctx, store, network }: BuiltinDeps): DashboardProvider[] {
  const moduleOn = (id: string) => ctx.policy.moduleAllowed(id) && !ctx.settings.get().disabledModules.includes(id);
  /** Başka modülün tablosu henüz kurulmamış olabilir (modül hiç açılmadıysa): okuma hatası "veri yok" sayılır. */
  const safe = <T,>(read: () => T, fallback: T): T => {
    try {
      return read();
    } catch (error) {
      ctx.log.debug('pano: okuma atlandı', error instanceof Error ? error.message : String(error));
      return fallback;
    }
  };

  // Bir pano okumasında birkaç kart aynı veriyi ister: okuma bağlam başına bir kez yapılır.
  const plans = new WeakMap<DashboardFillContext, Plan>();
  const plan = (context: DashboardFillContext): Plan => {
    const known = plans.get(context);
    if (known) return known;
    const until = addDays(context.today, AHEAD_DAYS);
    const planner = moduleOn('planner') ? createPlannerRepo(ctx) : null;
    const fresh: Plan = {
      reminders: planner ? safe(() => planner.listReminders(), []) : [],
      todos: planner ? safe(() => planner.listTodos(), []) : [],
    };
    plans.set(context, fresh);
    return fresh;
  };

  const reminderOverdue = (reminder: Reminder, now: Date) => reminder.status === 'fired' || Date.parse(reminder.dueAt) < now.getTime();
  const openTodos = (todos: Todo[]) =>
    todos.filter((todo) => !todo.done).sort((a, b) => (a.dueDay ?? '9999').localeCompare(b.dueDay ?? '9999') || a.order - b.order);

  /** Bir hatırlatıcının vakti geçince ya da gün dönünce görünüm eskir. */
  const expiry = (context: DashboardFillContext, reminders: Reminder[]): string => {
    const midnight = new Date(context.now);
    midnight.setHours(24, 0, 5, 0);
    const upcoming = reminders.map((reminder) => Date.parse(reminder.dueAt)).filter((at) => at > context.now.getTime());
    return new Date(Math.min(midnight.getTime(), ...upcoming)).toISOString();
  };

  const today: DashboardProvider<TodayBandData> = {
    id: IDS.today,
    moduleId: MODULE_ID,
    title: t('dashboard.card.today'),
    defaultSize: 'large',
    priority: 1000,
    band: true,
    events: ['planner.changed', 'tool.approval.request', 'tool.approval.resolve', 'module.changed'],
    fill(context) {
      const { reminders, todos } = plan(context);
      const until = addDays(context.today, AHEAD_DAYS - 1);
      const week: DashboardWeekDay[] = Array.from({ length: AHEAD_DAYS }, (_, index) => ({ day: addDays(context.today, index), reminders: 0, todos: 0 }));
      const slot = (day: LocalDay) => (day < context.today ? week[0] : week[daysBetween(context.today, day)]);
      for (const reminder of reminders) {
        const day = localDay(reminder.dueAt);
        if (day <= until) slot(day)!.reminders += 1;
      }
      const open = openTodos(todos);
      for (const todo of open) if (todo.dueDay && todo.dueDay <= until) slot(todo.dueDay)!.todos += 1;

      const dueReminders = reminders.filter((reminder) => localDay(reminder.dueAt) === context.today || reminderOverdue(reminder, context.now)).length;
      const nextReminder = reminders.find((reminder) => !reminderOverdue(reminder, context.now) && localDay(reminder.dueAt) > context.today);
      const reminderDay = nextReminder ? localDay(nextReminder.dueAt) : null;
      const next: TodayBandData['next'] = nextReminder ? { day: reminderDay!, time: localTime(nextReminder.dueAt), text: nextReminder.text } : null;
      return {
        data: {
          day: context.today,
          reminders: dueReminders,
          todos: open.length,
          next,
          approvals: ctx.tools.pendingApprovals(),
          week,
        },
        validUntil: expiry(context, reminders),
      };
    },
  };

  const notices: DashboardProvider<NoticesData> = {
    id: IDS.notices,
    moduleId: MODULE_ID,
    title: t('dashboard.card.notices'),
    defaultSize: 'medium',
    priority: 86,
    events: ['attention.notify', 'attention.dismiss', 'attention.action'],
    fill() {
      const items = safe(() => ctx.attention.pending(), []);
      return items.length ? { data: { items: items.slice(0, 4) } } : null;
    },
  };

  const jobs: DashboardProvider<JobsData> = {
    id: IDS.jobs,
    moduleId: MODULE_ID,
    title: t('dashboard.card.jobs'),
    defaultSize: 'small',
    priority: 88,
    events: ['job.progress'],
    fill() {
      const running = safe(() => [...ctx.jobs.list({ status: 'running', limit: 6 }), ...ctx.jobs.list({ status: 'queued', limit: 4 })], []);
      const items: JobsItem[] = running
        .slice(0, 6)
        .map((job) => ({ id: job.id, title: job.title, moduleId: job.moduleId, status: job.status === 'queued' ? ('queued' as const) : ('running' as const), startedAt: job.startedAt }));
      // Başka modüllerin süren işleri (takip işleri) aynı karta girer: ayrı kart açılmaz, süren işler tek yerde görünür.
      const box: DashboardJobsCollect = { items: [] };
      safe(() => ctx.bus.emit('dashboard.jobs.collect', box), undefined);
      const known = new Set(items.map((item) => item.id));
      for (const item of box.items) if (item && typeof item.id === 'string' && !known.has(item.id) && items.length < MAX_JOBS) items.push(item);
      if (items.length === 0) return null;
      return { data: { items } };
    },
  };

  const agenda: DashboardProvider<AgendaData> = {
    id: IDS.agenda,
    moduleId: 'planner',
    title: t('dashboard.card.agenda'),
    defaultSize: 'large',
    priority: 96,
    page: 'planner',
    events: ['planner.changed', 'module.changed'],
    fill(context) {
      const until = addDays(context.today, AHEAD_DAYS);
      const due = plan(context)
        .reminders.filter((reminder) => localDay(reminder.dueAt) <= until)
        .map((reminder) => ({ reminder, overdue: reminderOverdue(reminder, context.now) }))
        .sort((a, b) => Number(b.overdue) - Number(a.overdue) || Date.parse(a.reminder.dueAt) - Date.parse(b.reminder.dueAt));
      if (due.length === 0) return null;
      return {
        data: {
          total: due.length,
          items: due.slice(0, MAX_AGENDA).map(({ reminder, overdue }) => ({
            reminder,
            overdue,
            repeats: reminder.recurrence ? describeRecurrence(reminder.recurrence) : null,
          })),
        },
        validUntil: expiry(
          context,
          due.map((item) => item.reminder),
        ),
      };
    },
  };

  const todos: DashboardProvider<TodosData> = {
    id: IDS.todos,
    moduleId: 'planner',
    title: t('dashboard.card.todos'),
    defaultSize: 'medium',
    priority: 80,
    page: 'planner',
    events: ['planner.changed', 'module.changed'],
    fill(context) {
      const open = openTodos(plan(context).todos);
      if (open.length === 0) return null;
      return {
        data: {
          total: open.length,
          items: open.slice(0, MAX_TODOS).map((todo) => ({ todo, late: todo.dueDay !== null && todo.dueDay < context.today })),
        },
      };
    },
  };

  const weather: DashboardProvider = {
    id: IDS.weather,
    moduleId: MODULE_ID,
    title: t('dashboard.card.weather'),
    defaultSize: 'small',
    priority: 94,
    fill: () => network.weather(),
  };

  const fx: DashboardProvider = {
    id: IDS.fx,
    moduleId: MODULE_ID,
    title: t('dashboard.card.fx'),
    defaultSize: 'small',
    priority: 93,
    fill: () => network.fx(),
  };

  const news: DashboardProvider = {
    id: IDS.news,
    moduleId: MODULE_ID,
    title: t('dashboard.card.news'),
    defaultSize: 'wide',
    priority: 60,
    fill: () => network.news(),
  };

  const suggestions: DashboardProvider<SuggestionsData> = {
    id: IDS.suggestions,
    moduleId: MODULE_ID,
    title: t('dashboard.card.suggestions'),
    defaultSize: 'medium',
    priority: 55,
    fill() {
      const items = store.suggestions();
      return items.length ? { data: { items } } : null;
    },
  };

  const sessions: DashboardProvider<SessionsData> = {
    id: IDS.sessions,
    moduleId: 'projects',
    title: t('dashboard.card.sessions'),
    defaultSize: 'medium',
    priority: 40,
    page: 'projects',
    events: ['projects.changed', 'module.changed'],
    fill(context) {
      if (!moduleOn('projects')) return null;
      const since = new Date(context.now.getTime() - SESSION_RECENT_DAYS * DAY_MS).toISOString();
      const recent = safe(() => createProjectsRepo(ctx.db).listSessions({ since, limit: MAX_SESSIONS }), { items: [], total: 0 });
      if (recent.items.length === 0) return null;
      return {
        data: {
          total: recent.total,
          items: recent.items.map((session) => ({ id: session.id, title: session.title, project: session.projectName, lastAt: session.lastAt, messageCount: session.messageCount })),
        },
      };
    },
  };

  const activity: DashboardProvider<ActivityData> = {
    id: IDS.activity,
    moduleId: MODULE_ID,
    title: t('dashboard.card.activity'),
    defaultSize: 'medium',
    priority: 35,
    events: ['job.progress', 'attention.dismiss', 'attention.action'],
    fill(context) {
      const since = context.now.getTime() - DAY_MS;
      const items: ActivityData['items'] = [];
      for (const job of safe(() => ctx.jobs.list({ limit: 20 }), [])) {
        const at = job.finishedAt ? Date.parse(job.finishedAt) : 0;
        if (at < since || job.status === 'running' || job.status === 'queued') continue;
        const detail = (job.status === 'failed' ? job.error : job.resultText)?.replace(/\s+/g, ' ').trim().slice(0, 140) || null;
        items.push({
          id: `job:${job.id}`,
          at: job.finishedAt!,
          text: t(job.status === 'done' ? 'dashboard.activity.jobDone' : job.status === 'failed' ? 'dashboard.activity.jobFailed' : 'dashboard.activity.jobCancelled', { title: job.title }),
          detail,
          tone: job.status === 'done' ? 'done' : job.status === 'failed' ? 'failed' : 'info',
          page: job.moduleId === 'projects' ? 'projects' : job.moduleId === 'workshop' ? 'skills' : 'chat',
        });
      }
      for (const notification of safe(() => ctx.attention.recent(20), [])) {
        const at = Date.parse(notification.resolvedAt ?? notification.createdAt);
        if (at < since || notification.status === 'pending' || notification.status === 'shown') continue;
        items.push({
          id: `notice:${notification.id}`,
          at: new Date(at).toISOString(),
          text: notification.title,
          detail: notification.body.replace(/\s+/g, ' ').trim().slice(0, 140) || null,
          tone: 'info',
          page: notification.moduleId === 'projects' ? 'projects' : 'planner',
        });
      }
      if (items.length === 0) return null;
      items.sort((a, b) => b.at.localeCompare(a.at));
      return { data: { items: items.slice(0, MAX_ACTIVITY) } };
    },
  };

  /** Kullanım yalnız dikkat isteyince görünür: bütçenin yarısı geçildiyse ya da dolduysa. */
  const usage: DashboardProvider<UsageData> = {
    id: IDS.usage,
    moduleId: MODULE_ID,
    title: t('dashboard.card.usage'),
    defaultSize: 'small',
    priority: 30,
    events: ['usage.recorded'],
    fill(): DashboardFill<UsageData> | null {
      const summary = safe(() => ctx.usage.today(), null);
      if (!summary || summary.budgetUsd <= 0) return null;
      if (!summary.overBudget && summary.costUsd < summary.budgetUsd * 0.5) return null;
      return { data: { costUsd: summary.costUsd, budgetUsd: summary.budgetUsd, calls: summary.calls, overBudget: summary.overBudget } };
    },
  };

  // Varsayılan sıra: zaman çizgisi (yüksek) ve yanında üst üste hava + döviz; altında süren işler ve listeler.
  return [today, agenda, weather, fx, jobs, notices, todos, news, suggestions, sessions, activity, usage];
}
