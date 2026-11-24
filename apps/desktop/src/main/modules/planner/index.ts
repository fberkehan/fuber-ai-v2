// Sahibi: T2. Planlar modülü: hatırlatıcılar (tekrarlı), yapılacaklar, sabah/akşam özeti (KURGU §10).
import {
  addDays,
  defineModule,
  defineTool,
  describeRecurrence,
  fromLocal,
  localDay,
  localTime,
  REMINDER_NOTIFY_PRIORITY,
  relativeDateTime,
  t,
  UserError,
  type Id,
  type LocalDay,
  type ModuleContext,
  type Recurrence,
  type RecordSource,
  type Reminder,
  type ToolContext,
  type ToolResult,
  type Unsubscribe,
} from '@fuber/shared';
import { z } from 'zod';
import { cleanTodoItem, findDuplicateReminder, findDuplicateTodo, isPlaceholderItem, placeholderRefusal, sameText } from './dedupe';
import { createPlannerRepo, PLANNER_MIGRATIONS, PlannerError, REMINDER_TASK, type PlannerRepo } from './repo';
import './types';

const BRIEF_TASK = 'planner.brief';
const DEFAULT_BRIEF_TIMES = { morning: '08:30', evening: '20:30' } as const;
/** Açılışta kaçan hatırlatıcılar bu süre içinde toplanıp tek özet olur. */
const MISSED_COLLECT_MS = 1500;

const recurrenceSchema = z
  .object({
    freq: z.enum(['daily', 'weekly', 'monthly', 'yearly']).describe('Tekrar birimi'),
    interval: z.number().int().min(1).default(1).describe('Her kaç birimde bir (1 = her)'),
    weekdays: z
      .array(z.number().int().min(1).max(7))
      .optional()
      .describe('Yalnız weekly: ISO hafta günleri, 1 = Pazartesi … 7 = Pazar'),
    until: z.string().optional().describe('Bu andan sonra tekrar etmez (ISO 8601)'),
  })
  .describe('Tekrar kuralı. Saat ve ayın günü due_at\'ten alınır: "her ayın 28\'i saat 10" → due_at bir sonraki 28\'i 10:00, freq monthly');

const prioritySchema = z.enum(['low', 'normal', 'high', 'urgent']);

let repo: PlannerRepo | null = null;
const subscriptions: Unsubscribe[] = [];
let missedBuffer: Reminder[] = [];
let missedTimer: ReturnType<typeof setTimeout> | null = null;

function plannerRepo(ctx: ModuleContext): PlannerRepo {
  repo ??= createPlannerRepo(ctx);
  return repo;
}

function sourceOf(ctx: ToolContext): RecordSource {
  return ctx.origin.channel === 'voice' ? 'voice' : ctx.origin.channel === 'chat' ? 'chat' : 'system';
}

function when(reminder: Reminder): string {
  const at = relativeDateTime(reminder.dueAt);
  return reminder.recurrence ? `${at} (${describeRecurrence(reminder.recurrence)})` : at;
}

function reminderData(reminder: Reminder) {
  return {
    id: reminder.id,
    text: reminder.text,
    due_at: reminder.dueAt,
    when: when(reminder),
    recurrence: reminder.recurrence ? describeRecurrence(reminder.recurrence) : null,
    status: reminder.status,
  };
}

async function guard(run: () => ToolResult): Promise<ToolResult> {
  try {
    return run();
  } catch (error) {
    if (error instanceof PlannerError) return { ok: false, text: error.message };
    throw error;
  }
}

function addressOf(ctx: ModuleContext): string {
  return ctx.settings.get().userAddress?.trim() || ctx.policy.get().persona.address;
}

function notifyReminder(ctx: ModuleContext, reminder: Reminder, scheduledFor: string) {
  ctx.attention.notify({
    moduleId: 'planner',
    title: t('planner.notify.title'),
    body: reminder.text,
    priority: reminder.priority === 'urgent' ? 'urgent' : REMINDER_NOTIFY_PRIORITY,
    speak: t('planner.notify.spoken', { address: addressOf(ctx), text: reminder.text }),
    actions: [
      { id: 'done', label: t('planner.action.done'), kind: 'primary' },
      { id: 'snooze10', label: t('planner.action.snooze10'), kind: 'secondary' },
    ],
    dedupeKey: `planner.reminder.${reminder.id}.${scheduledFor}`,
    data: { reminderId: reminder.id },
  });
}

function flushMissed(ctx: ModuleContext) {
  missedTimer = null;
  const missed = missedBuffer;
  missedBuffer = [];
  if (missed.length === 0) return;
  const lines = missed.map((reminder) => `${reminder.text} (${relativeDateTime(reminder.firedAt ?? reminder.dueAt)})`);
  ctx.attention.notify({
    moduleId: 'planner',
    title: t('planner.missed.title', { count: missed.length }),
    body: lines.join('\n'),
    priority: REMINDER_NOTIFY_PRIORITY,
    speak: t('planner.missed.spoken', {
      address: addressOf(ctx),
      count: missed.length,
      list: missed.map((reminder) => reminder.text).join('; '),
    }),
    dedupeKey: `planner.missed.${missed.map((reminder) => reminder.id).join(',')}`,
    data: { reminderIds: missed.map((reminder) => reminder.id) },
  });
}

function briefTimes(ctx: ModuleContext): { morning: string; evening: string } {
  const config = ctx.policy.moduleConfig('planner');
  const valid = (value: unknown, fallback: string) =>
    typeof value === 'string' && /^\d{2}:\d{2}$/.test(value) ? value : fallback;
  return {
    morning: valid(config.morningBrief, DEFAULT_BRIEF_TIMES.morning),
    evening: valid(config.eveningBrief, DEFAULT_BRIEF_TIMES.evening),
  };
}

function scheduleBriefs(ctx: ModuleContext) {
  const times = briefTimes(ctx);
  const existing = ctx.scheduler.list(BRIEF_TASK);
  for (const kind of ['morning', 'evening'] as const) {
    const time = times[kind];
    const current = existing.find((task) => task.key === kind);
    if (current && localTime(current.dueAt) === time) continue;
    let due = fromLocal(localDay(), time);
    if (due.getTime() <= Date.now()) due = fromLocal(addDays(localDay(), 1), time);
    ctx.scheduler.schedule({
      kind: BRIEF_TASK,
      key: kind,
      dueAt: due.toISOString(),
      recurrence: { freq: 'daily', interval: 1 },
      payload: { kind },
    });
  }
}

/** Sabah: bugünün işleri; akşam: yarının. Başka modüller `planner.brief.collect` ile satır ekler. */
export function composeBrief(ctx: ModuleContext, kind: 'morning' | 'evening', day: LocalDay): string[] {
  const store = plannerRepo(ctx);
  const start = fromLocal(day);
  const end = fromLocal(addDays(day, 1));
  const reminders = store
    .listReminders({ from: start.toISOString(), to: new Date(end.getTime() - 1).toISOString() })
    .filter((reminder) => reminder.status === 'scheduled');
  const todos = store.listTodos(false);
  const dueTodos = todos.filter((todo) => todo.dueDay !== null && todo.dueDay <= day);
  const lines: string[] = [];
  for (const reminder of reminders) lines.push(`${localTime(reminder.dueAt)} ${reminder.text}`);
  for (const todo of dueTodos) lines.push(todo.dueDay! < day ? `${todo.text} (gecikmiş)` : todo.text);
  if (todos.length > dueTodos.length) lines.push(t('planner.brief.openTodos', { count: todos.length - dueTodos.length }));
  const collect = { kind, day, lines: [] as string[] };
  ctx.bus.emit('planner.brief.collect', collect);
  return [...lines, ...collect.lines];
}

function runBrief(ctx: ModuleContext, kind: 'morning' | 'evening') {
  // Brifing modülü sabah brifingini kendisi veriyorsa (takvim + son günler + gündem, sesli) bu özet ikinci kez bildirilmez.
  const before = { kind, handled: false };
  ctx.bus.emit('planner.brief.before', before);
  if (before.handled) return;
  const day = kind === 'morning' ? localDay() : addDays(localDay(), 1);
  const lines = composeBrief(ctx, kind, day);
  const title = kind === 'morning' ? t('planner.brief.morningTitle') : t('planner.brief.eveningTitle');
  const body = lines.length ? lines.join('\n') : t('planner.brief.empty');
  ctx.attention.notify({
    moduleId: 'planner',
    title,
    body,
    priority: 'normal',
    speak: lines.length
      ? t('planner.brief.spoken', { title, count: lines.length, first: lines.slice(0, 3).join('; ') })
      : `${title}: ${t('planner.brief.empty')}`,
    dedupeKey: `planner.brief.${kind}.${day}`,
  });
}

const tools = [
  defineTool({
    name: 'reminder_create',
    group: 'core',
    description:
      'Belirli bir anda kullanıcıya haber verecek hatırlatıcı kurar (tek seferlik ya da tekrarlı). "Yarın saat onda", ' +
      '"3 gün sonra", "her ayın 28\'inde" gibi ifadeleri sen çözersin: bugünün tarihini ve saatini istemin sonundaki ' +
      '"Şu an" bölümünden oku ve due_at\'i saat dilimi ofsetiyle ISO 8601 ver; "60 saniye sonra", "10 dakika sonra" ' +
      'gibi göreli sürelerde due_at yerine after_seconds ver. Saat söylenmediyse makul bir saat seç ' +
      '(sabah işleri için 09:00) ve yanıtında söyle. Kurulduğunu ancak bu araç başarılı dönerse söyle.',
    input: z.object({
      text: z.string().min(1).describe('Ne hatırlatılacak; kullanıcının diliyle kısa: "KDV beyannamesini ver"'),
      due_at: z.string().optional().describe('İlk çalma anı, ofsetli ISO 8601: 2026-11-17T10:00:00+03:00'),
      after_seconds: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe('Göreli süre söylendiyse ("60 saniye sonra", "10 dakika sonra") due_at yerine kaç saniye sonra çalacağı'),
      recurrence: recurrenceSchema.optional(),
      priority: prioritySchema.optional().describe('Varsayılan high (adada görünür ve seslendirilir)'),
    }),
    risk: 'write',
    run: ({ text, due_at, after_seconds, recurrence, priority }, ctx) =>
      guard(() => {
        // Göreli süre hesabı araçta yapılır: küçük modeller saat aritmetiğinde yanılıyor (yerel değerlendirme).
        const dueAt = after_seconds ? new Date(Date.now() + after_seconds * 1000).toISOString() : due_at;
        if (!dueAt) return { ok: false, text: 'Zaman eksik: due_at ya da after_seconds verilmeli.' };
        // Aynı iş, aynı vakit, az önce kurulmuş: yeni kayıt açılmaz (model "bir daha söyle" sözünde aracı yeniden çağırıyordu).
        const existing = findDuplicateReminder(plannerRepo(ctx).listReminders({ status: ['scheduled'] }), {
          text,
          dueAt,
          relative: after_seconds !== undefined,
          recurring: recurrence !== undefined,
        });
        if (existing) {
          return {
            ok: true,
            text: `Bu hatırlatıcı zaten kurulu: "${existing.text}", ${when(existing)}. Yenisi AÇILMADI. Kullanıcıya zaten kurulu olduğunu söyle; ikinci bir hatırlatıcı kurduğunu söyleme.`,
            data: reminderData(existing),
          };
        }
        const reminder = plannerRepo(ctx).createReminder(
          { text, dueAt, recurrence: (recurrence as Recurrence | undefined) ?? null, ...(priority ? { priority } : {}) },
          sourceOf(ctx),
          ctx.origin.sessionId ?? null,
        );
        return { ok: true, text: `Hatırlatıcı kuruldu: "${reminder.text}", ${when(reminder)}.`, data: reminderData(reminder) };
      }),
  }),
  defineTool({
    name: 'reminder_list',
    group: 'core',
    description: 'Kurulu hatırlatıcıları listeler (yaklaşanlar ve çalıp kapanmamış olanlar). Değiştirmek ya da iptal etmek için önce kimliği buradan bul. "Hatırlatıcılarım neler", "yarın ne hatırlatacaksın" sorularında kullan.',
    input: z.object({ include_done: z.boolean().optional().describe('Tamamlanan ve iptal edilenler de gelsin') }),
    risk: 'read',
    run: ({ include_done }, ctx) =>
      guard(() => {
        const list = plannerRepo(ctx).listReminders(include_done ? { status: ['scheduled', 'fired', 'done', 'cancelled'] } : {});
        if (list.length === 0) return { ok: true, text: 'Kurulu hatırlatıcı yok.', data: [] };
        return { ok: true, text: `${list.length} hatırlatıcı var.`, data: list.map(reminderData) };
      }),
  }),
  defineTool({
    name: 'reminder_update',
    description: 'Var olan hatırlatıcının metnini, zamanını ya da tekrarını değiştirir. Kimlik için önce reminder_list. Kullanıcı bir hatırlatıcının zamanını ya da metnini değiştirmek istediğinde ("onu yarına al") kullan.',
    input: z.object({
      id: z.string(),
      text: z.string().min(1).optional(),
      due_at: z.string().optional().describe('Yeni an, ofsetli ISO 8601'),
      recurrence: recurrenceSchema.nullable().optional().describe('null: tekrarı kaldır'),
      priority: prioritySchema.optional(),
    }),
    risk: 'write',
    run: ({ id, text, due_at, recurrence, priority }, ctx) =>
      guard(() => {
        const reminder = plannerRepo(ctx).updateReminder(id, {
          ...(text ? { text } : {}),
          ...(due_at ? { dueAt: due_at } : {}),
          ...(recurrence !== undefined ? { recurrence: recurrence as Recurrence | null } : {}),
          ...(priority ? { priority } : {}),
        });
        return { ok: true, text: `Hatırlatıcı güncellendi: "${reminder.text}", ${when(reminder)}.`, data: reminderData(reminder) };
      }),
  }),
  defineTool({
    name: 'reminder_cancel',
    group: 'planner',
    description: 'Hatırlatıcıyı iptal eder; bir daha çalmaz. Kimlik için önce reminder_list. Kullanıcı bir hatırlatıcıdan vazgeçtiğinde ("onu iptal et", "hatırlatma") kullan.',
    input: z.object({ id: z.string() }),
    risk: 'write',
    run: ({ id }, ctx) =>
      guard(() => {
        const reminder = plannerRepo(ctx).cancelReminder(id);
        return { ok: true, text: `Hatırlatıcı iptal edildi: "${reminder.text}".` };
      }),
  }),
  defineTool({
    name: 'todo_add',
    group: 'core',
    description: 'Yapılacaklar listesine tek madde ekler. Birden çok madde için todo_add_many kullan. "Listeme ekle", "yapılacaklara yaz" denince kullan.',
    input: z.object({
      text: z.string().min(1),
      notes: z.string().optional(),
      due_day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Son gün, yerel YYYY-MM-DD'),
      priority: prioritySchema.optional(),
    }),
    risk: 'write',
    run: ({ text, notes, due_day, priority }, ctx) =>
      guard(() => {
        // Yer tutucu ya da isteğin kendisi ("üç maddelik liste oluştur") madde diye yazılmaz.
        if (isPlaceholderItem(text)) return { ok: false, text: placeholderRefusal(text) };
        const same = findDuplicateTodo(plannerRepo(ctx).listTodos(false), text);
        if (same) return { ok: true, text: `Bu madde yapılacaklarda zaten var: "${same.text}". Yenisi eklenmedi.`, data: { id: same.id, text: same.text } };
        const todo = plannerRepo(ctx).createTodo(
          { text, ...(notes ? { notes } : {}), dueDay: due_day ?? null, ...(priority ? { priority } : {}) },
          sourceOf(ctx),
        );
        return { ok: true, text: `Yapılacaklara eklendi: "${todo.text}".`, data: { id: todo.id, text: todo.text } };
      }),
  }),
  defineTool({
    name: 'todo_add_many',
    group: 'planner',
    description:
      'Yapılacaklar listesine birden çok maddeyi tek seferde ekler: "araştır ve liste olarak ekle", "alışveriş listesi yap" gibi ' +
      'isteklerde maddeleri sen belirleyip hepsini bununla ekle.',
    input: z.object({
      items: z
        .array(
          z.object({
            text: z.string().min(1),
            notes: z.string().optional(),
            due_day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
            priority: prioritySchema.optional(),
          }),
        )
        .min(1)
        .max(50),
    }),
    risk: 'write',
    run: ({ items: given }, ctx) =>
      guard(() => {
        // Yer tutucu maddeler ("madde 1", tek maddede numaralı liste) listeye yazılmaz; model gerçek kalemlerle yeniden çağırır.
        const placeholder = given.find((item) => isPlaceholderItem(item.text));
        if (placeholder) {
          return {
            ok: false,
            text: placeholderRefusal(placeholder.text),
          };
        }
        // Kalemin başındaki liste etiketi ve sıra numarası listeye yazılmaz ("Alışveriş listesi: süt" → "süt").
        const items = given.map((item) => ({ ...item, text: cleanTodoItem(item.text) }));
        // Listede zaten olan ve aynı çağrıda yinelenen maddeler eklenmez.
        const open = plannerRepo(ctx).listTodos(false);
        const fresh: typeof items = [];
        for (const item of items) {
          if (findDuplicateTodo(open, item.text) || fresh.some((other) => sameText(other.text, item.text))) continue;
          fresh.push(item);
        }
        if (fresh.length === 0) return { ok: true, text: 'Bu maddelerin hepsi yapılacaklarda zaten var; yenisi eklenmedi.', data: [] };
        const skipped = items.length - fresh.length;
        const todos = plannerRepo(ctx).createTodos(
          fresh.map((item) => ({
            text: item.text,
            ...(item.notes ? { notes: item.notes } : {}),
            dueDay: item.due_day ?? null,
            ...(item.priority ? { priority: item.priority } : {}),
          })),
          sourceOf(ctx),
        );
        return {
          ok: true,
          text: `${todos.length} madde yapılacaklara eklendi.${skipped > 0 ? ` ${skipped} madde zaten listedeydi, yeniden eklenmedi.` : ''}`,
          data: todos.map((todo) => ({ id: todo.id, text: todo.text })),
          show: {
            title: 'Yapılacaklara eklendi',
            icon: 'ListChecks',
            body: [{ type: 'list', items: todos.map((todo) => ({ title: todo.text, checked: false })) }],
            ttlSeconds: 20,
          },
        };
      }),
  }),
  defineTool({
    name: 'todo_list',
    group: 'core',
    description: 'Yapılacaklar listesini getirir. "Yapılacaklarım neler", "listemde ne var" sorularında ya da bir maddeyi değiştirmeden önce kimliği bulmak için kullan.',
    input: z.object({ include_done: z.boolean().optional() }),
    risk: 'read',
    run: ({ include_done }, ctx) =>
      guard(() => {
        const todos = plannerRepo(ctx).listTodos(include_done ?? false);
        if (todos.length === 0) return { ok: true, text: 'Yapılacaklar listesi boş.', data: [] };
        return {
          ok: true,
          text: `${todos.length} madde var.`,
          data: todos.map((todo) => ({ id: todo.id, text: todo.text, done: todo.done, due_day: todo.dueDay })),
        };
      }),
  }),
  defineTool({
    name: 'todo_update',
    description: 'Yapılacak maddesinin metnini, notunu, son gününü ya da önceliğini değiştirir. Kimlik için todo_list. Kullanıcı bir maddeyi değiştirmek istediğinde kullan.',
    input: z.object({
      id: z.string(),
      text: z.string().min(1).optional(),
      notes: z.string().optional(),
      due_day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      priority: prioritySchema.optional(),
    }),
    risk: 'write',
    run: ({ id, text, notes, due_day, priority }, ctx) =>
      guard(() => {
        const todo = plannerRepo(ctx).updateTodo(id, {
          ...(text ? { text } : {}),
          ...(notes !== undefined ? { notes } : {}),
          ...(due_day !== undefined ? { dueDay: due_day } : {}),
          ...(priority ? { priority } : {}),
        });
        return { ok: true, text: `Güncellendi: "${todo.text}".` };
      }),
  }),
  defineTool({
    name: 'todo_done',
    group: 'planner',
    description: 'Yapılacak maddesini tamamlandı işaretler. Kimlik için todo_list. Kullanıcı bir maddeyi yaptığını söylediğinde ("sütü aldım", "onu bitirdim") kullan.',
    input: z.object({ id: z.string() }),
    risk: 'write',
    run: ({ id }, ctx) =>
      guard(() => {
        const todo = plannerRepo(ctx).updateTodo(id, { done: true });
        return { ok: true, text: `Tamamlandı: "${todo.text}".` };
      }),
  }),
];

const wrap = <T>(fn: () => T): T => {
  try {
    return fn();
  } catch (error) {
    if (error instanceof PlannerError) throw new UserError(error.message);
    throw error;
  }
};

export default defineModule({
  id: 'planner',
  version: '1.0.0',
  nameKey: 'module.planner.name',
  descriptionKey: 'module.planner.description',
  permissions: ['notify'],
  page: { id: 'planner', icon: 'CalendarCheck', order: 40 },
  migrations: PLANNER_MIGRATIONS,
  tools,

  // Kanallar `Api` içinde tanımlı; planlar bir modül olduğu için modül kapanınca kanalları da kalkar.
  ipc: (ctx) => {
    const store = plannerRepo(ctx);
    return {
      'planner.listReminders': (req) =>
        wrap(() =>
          store.listReminders({
            ...(req.status ? { status: req.status } : {}),
            ...(req.from ? { from: req.from } : {}),
            ...(req.to ? { to: req.to } : {}),
          }),
        ),
      'planner.createReminder': (req) => wrap(() => store.createReminder(req, 'user')),
      'planner.updateReminder': ({ id, patch }) => wrap(() => store.updateReminder(id, patch)),
      'planner.deleteReminder': ({ id }) => wrap(() => (store.deleteReminder(id), { ok: true as const })),
      'planner.completeReminder': ({ id }) => wrap(() => store.completeReminder(id)),
      'planner.snoozeReminder': ({ id, minutes }) => wrap(() => store.snoozeReminder(id, minutes)),
      'planner.listTodos': ({ includeDone }) => wrap(() => store.listTodos(includeDone ?? false)),
      'planner.createTodo': (req) => wrap(() => store.createTodo(req, 'user')),
      'planner.updateTodo': ({ id, patch }) => wrap(() => store.updateTodo(id, patch)),
      'planner.deleteTodo': ({ id }) => wrap(() => (store.deleteTodo(id), { ok: true as const })),
      'planner.reorderTodos': ({ ids }) => wrap(() => (store.reorderTodos(ids), { ok: true as const })),
    };
  },

  setup(ctx) {
    const store = plannerRepo(ctx);
    subscriptions.push(
      ctx.scheduler.handle(REMINDER_TASK, (task, run) => {
        const reminderId = task.payload.reminderId as Id;
        const snooze = task.payload.snooze === true;
        let current: Reminder;
        try {
          current = store.getReminder(reminderId);
        } catch {
          return;
        }
        const seriesNext = current.recurrence
          ? (ctx.scheduler.list(REMINDER_TASK).find((candidate) => candidate.key === reminderId)?.dueAt ?? null)
          : null;
        const fired = store.markFired(reminderId, snooze && current.recurrence ? current.dueAt : seriesNext);
        if (!fired) return;
        if (run.missed) {
          missedBuffer.push(fired);
          missedTimer ??= setTimeout(() => flushMissed(ctx), MISSED_COLLECT_MS);
          return;
        }
        notifyReminder(ctx, fired, run.scheduledFor);
      }),
    );
    subscriptions.push(
      ctx.scheduler.handle(BRIEF_TASK, (task, run) => {
        const kind = task.payload.kind === 'evening' ? 'evening' : 'morning';
        // Kapalıyken kaçan özet yalnız aynı gün içindeyse anlamlıdır.
        if (run.missed && localDay(run.scheduledFor) !== localDay()) return;
        runBrief(ctx, kind);
      }),
    );
    subscriptions.push(
      ctx.bus.on('attention.action', ({ moduleId, actionId, data }) => {
        if (moduleId !== 'planner' || typeof data.reminderId !== 'string') return;
        try {
          if (actionId === 'done') store.completeReminder(data.reminderId);
          if (actionId === 'snooze10') store.snoozeReminder(data.reminderId, 10);
        } catch (error) {
          ctx.log.warn('hatırlatıcı eylemi uygulanamadı', error);
        }
      }),
    );
    subscriptions.push(ctx.bus.on('policy.changed', () => scheduleBriefs(ctx)));
    scheduleBriefs(ctx);
  },

  teardown() {
    for (const off of subscriptions.splice(0)) off();
    if (missedTimer) clearTimeout(missedTimer);
    missedTimer = null;
    missedBuffer = [];
    repo = null;
  },
});
