// Planlar: birincil kutu takvimdir (hafta şeridi + o haftadan başlayan gün gün zaman çizgisi); yanında yapılacaklar,
// bağlam sütununda sabah/akşam özeti saatleri ve geçmiş. Ekle/düzenle, tamamla (geri alınabilir), ertele.
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowCounterClockwise, ArrowsClockwise, Bell, CalendarCheck, CaretLeft, CaretRight, DotsThree, ListChecks, PencilSimple, Plus, SlidersHorizontal, Trash } from '@phosphor-icons/react';
import {
  addDays,
  daysBetween,
  describeRecurrence,
  formatDay,
  fromLocal,
  localDay,
  localTime,
  relativeDateTime,
  relativeDay,
  relativeTime,
  t,
  weekdayName,
  weekdayOf,
  type LocalDay,
  type Priority,
  type Recurrence,
  type Reminder,
  type Todo,
} from '@fuber/shared';
import {
  Badge,
  Button,
  Checkbox,
  Chip,
  Dialog,
  Field,
  IconButton,
  Input,
  Menu,
  Panel,
  Select,
  Skeleton,
  Textarea,
  Workspace,
  WorkspaceHeader,
  cn,
  enter,
  spring,
  stagger,
  toast,
  useMotionPreset,
  useMotionTransition,
  useReducedMotion,
} from '@fuber/ui';
import { useShell } from '../../shell/context';
import { attempt, useLive } from '../../shell/live';
import { ConfirmDialog, ErrorPanel } from '../../shell/parts';
import { capitalize } from '../../shell/text';
import { definePage } from '../page';
import { ContextCard, ContextSection } from '../memory/page-parts';
import { completeReminder, setTodoDone, snoozeReminder } from './actions';
import './planner.css';

type Repeat = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly';

function repeatOf(recurrence: Recurrence | null): Repeat {
  if (!recurrence) return 'none';
  if (recurrence.freq === 'weekly' && recurrence.weekdays?.length === 5 && [1, 2, 3, 4, 5].every((d) => recurrence.weekdays?.includes(d as 1))) return 'weekdays';
  return recurrence.freq;
}

function recurrenceOf(repeat: Repeat): Recurrence | null {
  if (repeat === 'none') return null;
  if (repeat === 'weekdays') return { freq: 'weekly', interval: 1, weekdays: [1, 2, 3, 4, 5] };
  return { freq: repeat, interval: 1 };
}

const isOverdue = (reminder: Reminder, now = Date.now()) => reminder.status === 'fired' || new Date(reminder.dueAt).getTime() < now;

// ───────────── satırlar ─────────────

/** Tamamlanan satır önce işareti doldurur ve metni soldurur; bu kadar bekledikten sonra gerçekten kapanır. */
const COMPLETE_DELAY_MS = 400;

function useRowMotion(index: number) {
  const reduce = useReducedMotion();
  const transition = useMotionTransition(spring.smooth);
  return {
    layout: !reduce,
    initial: reduce ? { opacity: 0 } : { opacity: 0, transform: 'translateY(6px)' },
    animate: reduce ? { opacity: 1 } : { opacity: 1, transform: 'translateY(0px)' },
    // Tamamlanan ya da silinen satır sönerek ve yerini bırakarak çıkar.
    exit: reduce ? { opacity: 0 } : { opacity: 0, height: 0, overflow: 'hidden', transition: { duration: 0.2, ease: [0.23, 1, 0.32, 1] as const } },
    transition: stagger(index, transition),
  };
}

/**
 * Satırın tamamlanması: `start` işareti doldurur; gecikmeden sonra `commit` çalışır. Başarısız olursa ya da tekrarlı
 * hatırlatıcı yerinde kalırsa (`stays`) satır eski hâline döner.
 */
function useCompletion(commit: () => Promise<boolean>, stays = false) {
  const [completing, setCompleting] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const start = () => {
    if (completing) return;
    setCompleting(true);
    timer.current = window.setTimeout(() => {
      // Başarılıysa satır zaten çıkış animasyonuna girer; yalnız yerinde kalacaksa (tekrarlı) eski hâline döner.
      void commit().then((ok) => {
        if (!ok || stays) setCompleting(false);
      });
    }, COMPLETE_DELAY_MS);
  };
  return { completing, start };
}

function RowMenu({ onEdit, onDelete, snooze, testId }: { onEdit: () => void; onDelete: () => void; snooze?: Reminder; testId?: string }) {
  return (
    <Menu
      label={t('common.more')}
      placement="bottom-end"
      trigger={<IconButton icon={<DotsThree weight="bold" />} label={t('common.more')} size="sm" {...(testId ? { 'data-testid': testId } : {})} />}
      items={[
        ...(snooze
          ? ([
              { type: 'label', id: 'snooze-label', label: t('planner.snooze') },
              { id: 'hour', label: t('planner.snooze.hour'), onSelect: () => void snoozeReminder(snooze, 'hour') },
              { id: 'tomorrow', label: t('planner.snooze.tomorrow'), onSelect: () => void snoozeReminder(snooze, 'tomorrow') },
              { id: 'week', label: t('planner.snooze.week'), onSelect: () => void snoozeReminder(snooze, 'week') },
              { type: 'separator', id: 'sep' },
            ] as const)
          : []),
        { id: 'edit', label: t('common.edit'), icon: <PencilSimple />, onSelect: onEdit },
        { id: 'delete', label: t('common.delete'), icon: <Trash />, danger: true, onSelect: onDelete },
      ]}
    />
  );
}

/** Önem rozeti: iki listede de aynı biçim. Acil kırmızı, öteki dereceler nötr; gecikme ayrı renktir (kehribar yazı). */
function PriorityBadge({ priority, quietLabel }: { priority: Priority; quietLabel?: boolean }) {
  if (priority === 'urgent') return <Badge size="sm" tone="danger">{t('priority.urgent')}</Badge>;
  if (priority === 'high' && !quietLabel) return <Badge size="sm" tone="neutral">{t('priority.high')}</Badge>;
  if (priority === 'normal' && quietLabel) return <Badge size="sm" tone="neutral">{t('planner.quiet')}</Badge>;
  return null;
}

/**
 * Zaman çizgisi satırı: onay kutusu, saat, metin (+ tekrar kuralı), önem ve menü. Satırın tamamı düzenlemeyi açar.
 * Kutu ve saat ilk satıra hizalanır; menü üstüne gelince ya da odakta görünür.
 */
function ReminderRow({ reminder, index, showDay, next, onEdit, onDelete }: { reminder: Reminder; index: number; showDay?: boolean; next?: boolean; onEdit: () => void; onDelete: () => void }) {
  const motionProps = useRowMotion(index);
  const overdue = isOverdue(reminder);
  const { completing, start } = useCompletion(() => completeReminder(reminder), reminder.recurrence !== null);
  const repeat = reminder.recurrence ? capitalize(describeRecurrence(reminder.recurrence)) : null;
  // Sıradaki hatırlatıcı (sayfa başındaki cümlenin sözünü ettiği) satırda da yazar: ne kadar kaldığıyla.
  const sub = [next ? t('planner.nextIn', { when: relativeTime(reminder.dueAt) }) : null, showDay ? capitalize(relativeDay(localDay(reminder.dueAt))) : null, repeat].filter(Boolean).join(', ');
  return (
    <motion.li {...motionProps} className="overflow-hidden" data-testid="reminder-row" data-id={reminder.id} data-next={next || undefined} data-completing={completing || undefined}>
      <div
        role="button"
        tabIndex={0}
        onClick={onEdit}
        onKeyDown={(event) => {
          if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            onEdit();
          }
        }}
        className="plan-row"
      >
        <span className="flex h-[22px] shrink-0 items-center" onClick={(event) => event.stopPropagation()}>
          <Checkbox checked={completing} onCheckedChange={start} aria-label={t('planner.complete')} data-testid="reminder-complete" />
        </span>
        <time
          dateTime={reminder.dueAt}
          className={cn(
            'w-11 shrink-0 text-base tabular-nums transition-colors duration-(--duration-base)',
            completing ? 'text-fg-faint' : overdue ? 'font-medium text-warning' : next ? 'font-semibold text-fg' : 'font-medium text-fg-muted',
          )}
        >
          {localTime(reminder.dueAt)}
        </time>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-baseline gap-2.5">
            <span className={cn('line-clamp-2 min-w-0 text-base transition-colors duration-(--duration-base)', completing ? 'text-fg-faint line-through decoration-fg-faint' : 'text-fg')}>{reminder.text}</span>
            <span className="flex shrink-0 self-start pt-px">
              <PriorityBadge priority={reminder.priority} quietLabel />
            </span>
          </span>
          {sub && (
            <span className="flex items-center gap-1.5 truncate text-sm text-fg-muted">
              {repeat && <ArrowsClockwise className="size-3.5 shrink-0 text-fg-faint" aria-hidden />}
              {sub}
            </span>
          )}
        </span>
        <span className="plan-row-menu" onClick={(event) => event.stopPropagation()}>
          <RowMenu onEdit={onEdit} onDelete={onDelete} snooze={reminder} testId="reminder-menu" />
        </span>
      </div>
    </motion.li>
  );
}

/** Yapılacak satırı: onay kutusu, metin (+ not), altında son gün ve önem; dar sütunda da kırpılmadan okunur. */
function TodoRow({ todo, index, onEdit, onDelete }: { todo: Todo; index: number; onEdit: () => void; onDelete: () => void }) {
  const motionProps = useRowMotion(index);
  const today = localDay();
  const late = todo.dueDay !== null && todo.dueDay < today;
  const { completing, start } = useCompletion(() => setTodoDone(todo, true));
  const due = todo.dueDay ? (late ? t('planner.late', { day: formatDay(todo.dueDay) }) : capitalize(relativeDay(todo.dueDay))) : null;
  const flagged = todo.priority === 'urgent' || todo.priority === 'high';
  return (
    <motion.li {...motionProps} className="overflow-hidden" data-testid="todo-row" data-id={todo.id} data-completing={completing || undefined}>
      <div className="plan-row">
        <span className="flex h-[22px] shrink-0 items-center">
          <Checkbox checked={completing} onCheckedChange={start} aria-label={t('planner.todoComplete', { text: todo.text })} data-testid="todo-check" />
        </span>
        <button type="button" onClick={onEdit} className="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5 text-left">
          <span className={cn('line-clamp-2 text-base text-balance transition-colors duration-(--duration-base)', completing ? 'text-fg-faint line-through decoration-fg-faint' : 'text-fg')}>{todo.text}</span>
          {todo.notes && <span className="truncate text-sm text-fg-muted">{todo.notes}</span>}
          {(due || flagged) && (
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-0.5 text-sm">
              {due && <span className={late ? 'text-warning' : 'text-fg-muted'}>{due}</span>}
              <PriorityBadge priority={todo.priority} />
            </span>
          )}
        </button>
        <span className="plan-row-menu">
          <RowMenu onEdit={onEdit} onDelete={onDelete} />
        </span>
      </div>
    </motion.li>
  );
}

// ───────────── diyaloglar ─────────────

interface ReminderDraft {
  id: string | null;
  text: string;
  day: string;
  time: string;
  repeat: Repeat;
  priority: Priority;
}

function ReminderDialog({ draft, onClose }: { draft: ReminderDraft | null; onClose: () => void }) {
  const [value, setValue] = useState<ReminderDraft | null>(draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setValue(draft);
    setError(null);
  }, [draft]);
  const current = value ?? draft;
  const save = async () => {
    if (!current || !current.text.trim()) return;
    let due: Date;
    try {
      due = fromLocal(current.day, current.time);
    } catch {
      setError(t('planner.dialog.badDate'));
      return;
    }
    if (!current.id && due.getTime() < Date.now() - 60_000 && current.repeat === 'none') {
      setError(t('planner.dialog.past'));
      return;
    }
    setBusy(true);
    const input = { text: current.text.trim(), dueAt: due.toISOString(), recurrence: recurrenceOf(current.repeat), priority: current.priority };
    const result = current.id
      ? await attempt(() => window.fuber.invoke('planner.updateReminder', { id: current.id!, patch: input }))
      : await attempt(() => window.fuber.invoke('planner.createReminder', input));
    setBusy(false);
    if (result) {
      toast.success(current.id ? t('planner.toast.reminderUpdated') : t('planner.toast.reminderCreated', { when: relativeDateTime(result.dueAt) }));
      onClose();
    }
  };
  const repeats: Repeat[] = ['none', 'daily', 'weekdays', 'weekly', 'monthly', 'yearly'];
  // Hazır zamanlar: en sık söylenen dört an; gün ve saat alanlarını doldurur (elle değiştirilebilir).
  const presets = (() => {
    const now = new Date();
    const hour = new Date(now.getTime() + 60 * 60_000);
    hour.setMinutes(0, 0, 0);
    const day = localDay(now);
    return [
      { id: 'hour', day: localDay(hour), time: localTime(hour) },
      ...(now.getHours() < 19 ? [{ id: 'evening', day, time: '20:00' }] : []),
      { id: 'tomorrow', day: addDays(day, 1), time: '09:00' },
      { id: 'week', day: addDays(day, 7), time: '09:00' },
    ] as const;
  })();
  return (
    <Dialog
      open={draft !== null}
      onOpenChange={(open) => !open && onClose()}
      title={draft?.id ? t('planner.dialog.editReminder') : t('planner.dialog.newReminder')}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="primary" loading={busy} disabled={!current?.text.trim()} onClick={() => void save()} data-testid="reminder-save">
            {t('common.save')}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </>
      }
    >
      {current && (
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <Field label={t('planner.dialog.text')}>
            <Input
              value={current.text}
              onChange={(event) => setValue({ ...current, text: event.target.value })}
              placeholder={t('planner.dialog.textPlaceholder')}
              autoFocus
              data-testid="reminder-text"
            />
          </Field>
          <div className="-mb-1 flex flex-wrap gap-1.5" role="group" aria-label={t('planner.dialog.presets')}>
            {presets.map((preset) => (
              <Chip
                key={preset.id}
                selected={current.day === preset.day && current.time === preset.time}
                onClick={() => setValue({ ...current, day: preset.day, time: preset.time })}
                data-testid={`reminder-preset-${preset.id}`}
              >
                {t(`planner.preset.${preset.id}`)}
              </Chip>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label={t('planner.dialog.day')} error={error ?? undefined}>
              <Input type="date" value={current.day} onChange={(event) => setValue({ ...current, day: event.target.value })} data-testid="reminder-day" />
            </Field>
            <Field label={t('planner.dialog.time')}>
              <Input type="time" value={current.time} onChange={(event) => setValue({ ...current, time: event.target.value })} data-testid="reminder-time" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label={t('planner.dialog.repeat')}>
              <Select<Repeat> value={current.repeat} onChange={(repeat) => setValue({ ...current, repeat })} options={repeats.map((repeat) => ({ value: repeat, label: t(`planner.repeat.${repeat}`) }))} />
            </Field>
            <Field label={t('planner.dialog.how')}>
              <Select<Priority>
                value={current.priority}
                onChange={(priority) => setValue({ ...current, priority })}
                options={[
                  { value: 'high', label: t('planner.how.high'), description: t('planner.how.highHint') },
                  { value: 'normal', label: t('planner.how.normal'), description: t('planner.how.normalHint') },
                  { value: 'urgent', label: t('planner.how.urgent'), description: t('planner.how.urgentHint') },
                ]}
              />
            </Field>
          </div>
          <button type="submit" hidden />
        </form>
      )}
    </Dialog>
  );
}

interface TodoDraft {
  id: string | null;
  text: string;
  notes: string;
  day: string;
  priority: Priority;
}

function TodoDialog({ draft, onClose }: { draft: TodoDraft | null; onClose: () => void }) {
  const [value, setValue] = useState<TodoDraft | null>(draft);
  const [busy, setBusy] = useState(false);
  useEffect(() => setValue(draft), [draft]);
  const current = value ?? draft;
  const save = async () => {
    if (!current || !current.text.trim()) return;
    setBusy(true);
    const input = { text: current.text.trim(), notes: current.notes.trim(), dueDay: current.day || null, priority: current.priority };
    const result = current.id
      ? await attempt(() => window.fuber.invoke('planner.updateTodo', { id: current.id!, patch: input }))
      : await attempt(() => window.fuber.invoke('planner.createTodo', input));
    setBusy(false);
    if (result) {
      toast.success(current.id ? t('planner.toast.todoUpdated') : t('planner.toast.todoCreated'));
      onClose();
    }
  };
  return (
    <Dialog
      open={draft !== null}
      onOpenChange={(open) => !open && onClose()}
      title={draft?.id ? t('planner.dialog.editTodo') : t('planner.dialog.newTodo')}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="primary" loading={busy} disabled={!current?.text.trim()} onClick={() => void save()} data-testid="todo-save">
            {t('common.save')}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </>
      }
    >
      {current && (
        <div className="flex flex-col gap-5">
          <Field label={t('planner.dialog.todoText')}>
            <Input value={current.text} onChange={(event) => setValue({ ...current, text: event.target.value })} autoFocus data-testid="todo-text" />
          </Field>
          <Field label={t('planner.dialog.notes')} aside={t('planner.dialog.optional')}>
            <Textarea value={current.notes} minRows={2} onChange={(event) => setValue({ ...current, notes: event.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label={t('planner.dialog.dueDay')} aside={t('planner.dialog.optional')}>
              <Input type="date" value={current.day} onChange={(event) => setValue({ ...current, day: event.target.value })} />
            </Field>
            <Field label={t('planner.dialog.priority')}>
              <Select<Priority>
                value={current.priority}
                onChange={(priority) => setValue({ ...current, priority })}
                options={(['low', 'normal', 'high', 'urgent'] as Priority[]).map((priority) => ({ value: priority, label: t(`priority.${priority}`) }))}
              />
            </Field>
          </div>
        </div>
      )}
    </Dialog>
  );
}

// ───────────── hafta şeridi ─────────────

const WEEKDAY_SHORT = new Intl.DateTimeFormat('tr-TR', { weekday: 'short' });
const MONTH_LONG = new Intl.DateTimeFormat('tr-TR', { month: 'long' });

/** Verilen günün haftasının pazartesisi. */
const weekStartOf = (day: LocalDay): LocalDay => addDays(day, 1 - weekdayOf(day));

/** "16-22 Kasım"; ay değişiyorsa "30 Kasım - 6 Aralık". */
function weekLabel(start: LocalDay): string {
  const from = fromLocal(start);
  const to = fromLocal(addDays(start, 6));
  const sameMonth = from.getMonth() === to.getMonth();
  return sameMonth ? `${from.getDate()}-${to.getDate()} ${MONTH_LONG.format(to)}` : `${from.getDate()} ${MONTH_LONG.format(from)} - ${to.getDate()} ${MONTH_LONG.format(to)}`;
}

/** Gün işaretinin tonu: `late` çaldı, kapatılmadı · `urgent` acil · `plain` olağan. */
type Mark = 'late' | 'urgent' | 'plain';

/** Haftanın günlerine düşen hatırlatıcı işaretleri. Zaman çizgisiyle aynı kayıtlar sayılır (ne eksik ne fazla). */
function weekMarks(reminders: Reminder[], start: LocalDay): Map<LocalDay, Mark[]> {
  const end = addDays(start, 6);
  const map = new Map<LocalDay, Mark[]>();
  for (const reminder of [...reminders].sort((a, b) => a.dueAt.localeCompare(b.dueAt))) {
    const day = localDay(reminder.dueAt);
    if (day < start || day > end) continue;
    map.set(day, [...(map.get(day) ?? []), isOverdue(reminder) ? 'late' : reminder.priority === 'urgent' ? 'urgent' : 'plain']);
  }
  return map;
}

const MARK_PREVIEW = 5;

/**
 * Hafta şeridi: yedi gün; her günde o günün hatırlatıcıları kadar nokta. Metin taşımaz (ayrıntı zaman çizgisindedir),
 * bu yüzden hiçbir genişlikte kırpılmaz. Güne basınca zaman çizgisi o güne iner; yeniden basınca hepsi döner.
 */
function WeekStrip({ start, marks, selected, onSelect }: { start: LocalDay; marks: Map<LocalDay, Mark[]>; selected: LocalDay | null; onSelect: (day: LocalDay) => void }) {
  const today = localDay();
  const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));
  return (
    <div className="plan-week" role="group" aria-label={t('planner.week.label', { range: weekLabel(start) })} data-selecting={selected && selected !== today ? '' : undefined} data-testid="planner-week">
      {days.map((day) => {
        const list = marks.get(day) ?? [];
        const date = fromLocal(day);
        return (
          <button
            key={day}
            type="button"
            className="plan-day"
            aria-pressed={selected === day}
            aria-label={t('planner.week.day', { day: `${formatDay(day)} ${weekdayName(weekdayOf(day))}`, count: list.length })}
            data-today={day === today || undefined}
            data-past={day < today || undefined}
            data-day={day}
            data-count={list.length}
            data-testid="planner-day"
            onClick={() => onSelect(day)}
          >
            <span className="plan-day-name">{WEEKDAY_SHORT.format(date)}</span>
            <span className="plan-day-num">{date.getDate()}</span>
            <span className="plan-day-dots" aria-hidden>
              {list.slice(0, MARK_PREVIEW).map((mark, index) => (
                <i key={index} data-tone={mark} />
              ))}
              {list.length > MARK_PREVIEW && <b>+{list.length - MARK_PREVIEW}</b>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ───────────── zaman çizgisi ─────────────

interface Section {
  key: string;
  label: string;
  sub: string;
  /** `late`: çalıp kapatılmayanlar · `today` · `week`: gösterilen haftanın günü · `later`: haftadan sonrası. */
  kind: 'late' | 'today' | 'week' | 'later';
  /** Satırda gün de yazsın mı (gecikenler farklı günlerden gelir). */
  showDay?: boolean;
  items: Reminder[];
}

function daySection(day: LocalDay, items: Reminder[], weekStart: LocalDay, weekEnd: LocalDay): Section {
  const diff = daysBetween(localDay(), day);
  const weekday = weekdayName(weekdayOf(day));
  const relative = capitalize(relativeDay(day));
  // Gösterilen haftanın günü hep gün adıyla başlar ("Perşembe", altında "26 Kasım"); bugün/yarın göreli adıyla.
  // Haftanın dışındaki gün tarihle başlar ("4 Aralık", altında gün adı).
  const dated = /\d/.test(relative);
  const label = dated && day >= weekStart && day <= weekEnd ? weekday : relative;
  const sub = /\d/.test(label) ? weekday : label === weekday ? formatDay(day) : `${formatDay(day)} ${weekday}`;
  return {
    key: day,
    label,
    sub,
    kind: diff === 0 ? 'today' : day > weekEnd ? 'later' : 'week',
    items,
  };
}

/**
 * Zaman çizgisi gösterilen haftayı izler: önce çalıp kapatılmayanlar, sonra o haftanın günleri, ardından haftadan
 * sonrası. Haftadan önceki günler (ileri bir haftaya bakılırken bu hafta) listede yer almaz.
 */
function agendaSections(reminders: Reminder[], weekStart: LocalDay): Section[] {
  const now = Date.now();
  const weekEnd = addDays(weekStart, 6);
  const sorted = [...reminders].sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const late = sorted.filter((reminder) => isOverdue(reminder, now));
  const days = new Map<LocalDay, Reminder[]>();
  for (const reminder of sorted) {
    if (isOverdue(reminder, now)) continue;
    const day = localDay(reminder.dueAt);
    if (day < weekStart) continue;
    days.set(day, [...(days.get(day) ?? []), reminder]);
  }
  return [
    ...(late.length ? [{ key: 'late', label: t('planner.group.overdue'), sub: t('planner.group.overdueSub'), kind: 'late' as const, showDay: true, items: late }] : []),
    ...[...days.entries()].map(([day, items]) => daySection(day, items, weekStart, weekEnd)),
  ];
}

function LeadSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-5" aria-busy aria-label={t('common.loading')}>
      <div className="grid grid-cols-7 gap-3">
        {Array.from({ length: 7 }, (_, index) => (
          <Skeleton key={index} className="h-14 rounded-sm" />
        ))}
      </div>
      {[0, 1, 2].map((index) => (
        <div key={index} className="flex items-center gap-3">
          <Skeleton className="size-5 rounded-xs" />
          <Skeleton className="h-3.5 w-12 rounded-full" />
          <Skeleton className="h-3.5 w-2/5 rounded-full" />
        </div>
      ))}
    </div>
  );
}

// ───────────── sayfa ─────────────

const HISTORY_PREVIEW = 6;

function PlannerPage() {
  const shell = useShell();
  const today = localDay();
  const [weekStart, setWeekStart] = useState<LocalDay>(() => weekStartOf(localDay()));
  const [selectedDay, setSelectedDay] = useState<LocalDay | null>(null);
  const [reminderDraft, setReminderDraft] = useState<ReminderDraft | null>(null);
  const [todoDraft, setTodoDraft] = useState<TodoDraft | null>(null);
  const [quick, setQuick] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [deleting, setDeleting] = useState<{ kind: 'reminder'; item: Reminder } | { kind: 'todo'; item: Todo } | null>(null);
  const emptyPreset = useMotionPreset(enter.fadeUp);

  const reminders = useLive(() => window.fuber.invoke('planner.listReminders', {}), ['planner.changed']);
  const todos = useLive(() => window.fuber.invoke('planner.listTodos', { includeDone: true }), ['planner.changed']);
  const history = useLive(() => window.fuber.invoke('planner.listReminders', { status: ['done', 'cancelled'] }), ['planner.changed']);

  const allReminders = reminders.data ?? [];
  const open = useMemo(() => (todos.data ?? []).filter((todo) => !todo.done).sort((a, b) => a.order - b.order), [todos.data]);
  const doneTodos = (todos.data ?? []).filter((todo) => todo.done);
  const config = shell.policy?.modules.planner?.config ?? {};
  const morning = typeof config.morningBrief === 'string' ? config.morningBrief : '08:30';
  const evening = typeof config.eveningBrief === 'string' ? config.eveningBrief : '20:30';

  const newReminder = (text = '') => {
    const next = new Date(Date.now() + 60 * 60_000);
    next.setMinutes(0, 0, 0);
    // Şeritte ileri bir gün seçiliyse hatırlatıcı o güne, sabah dokuza önerilir.
    const onDay = selectedDay && selectedDay > today ? selectedDay : null;
    setReminderDraft({ id: null, text, day: onDay ?? localDay(next), time: onDay ? '09:00' : localTime(next), repeat: 'none', priority: 'high' });
  };
  const newTodo = () => setTodoDraft({ id: null, text: '', notes: '', day: '', priority: 'normal' });
  const editReminder = (reminder: Reminder) =>
    setReminderDraft({
      id: reminder.id,
      text: reminder.text,
      day: localDay(reminder.dueAt),
      time: localTime(reminder.dueAt),
      repeat: repeatOf(reminder.recurrence),
      priority: reminder.priority,
    });
  const editTodo = (todo: Todo) => setTodoDraft({ id: todo.id, text: todo.text, notes: todo.notes, day: todo.dueDay ?? '', priority: todo.priority });

  /** Hızlı ekleme: yazıp Enter'a basınca listeye düşer; ayrıntı (not, son gün, önem) sonra satırdan verilir. */
  const addQuick = async (event: FormEvent) => {
    event.preventDefault();
    const text = quick.trim();
    if (!text) return;
    setQuick('');
    const created = await attempt(() => window.fuber.invoke('planner.createTodo', { text }));
    if (created) toast.success(t('planner.toast.todoCreated'));
    else setQuick(text);
  };

  const historyItems = [
    ...(history.data ?? []).map((reminder) => ({ id: reminder.id, kind: 'reminder' as const, text: reminder.text, at: reminder.firedAt ?? reminder.dueAt, status: reminder.status })),
    ...doneTodos.map((todo) => ({ id: todo.id, kind: 'todo' as const, text: todo.text, at: todo.doneAt ?? todo.createdAt, status: 'done' as const, todo })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const marks = useMemo(() => weekMarks(allReminders, weekStart), [reminders.data, weekStart]);
  const sections = useMemo(() => agendaSections(allReminders, weekStart), [reminders.data, weekStart]);
  const weekEnd = addDays(weekStart, 6);
  const dayItems = selectedDay ? allReminders.filter((reminder) => localDay(reminder.dueAt) === selectedDay).sort((a, b) => a.dueAt.localeCompare(b.dueAt)) : [];
  const dayTodos = selectedDay ? open.filter((todo) => todo.dueDay === selectedDay) : [];
  // Zaman çizgisinin iki bölmesi seçimle değişmez. Ana bölme: gösterilen hafta; yan bölme: haftadan sonrası. Şeritte
  // bir gün seçilince o günün bloğu öne çıkar, ötekiler solar (liste yer değiştirmez, kutu zıplamaz).
  const mainSections = sections.filter((section) => section.kind !== 'later');
  const sideSections = sections.filter((section) => section.kind === 'later');
  const sideCount = sideSections.reduce((sum, section) => sum + section.items.length, 0);

  const remindersReady = reminders.state.status === 'ready';
  const remindersEmpty = remindersReady && allReminders.length === 0;
  const overdueCount = allReminders.filter((reminder) => isOverdue(reminder)).length;
  const todayItems = allReminders.filter((reminder) => !isOverdue(reminder) && localDay(reminder.dueAt) === today);
  const upcoming = [...allReminders].filter((reminder) => !isOverdue(reminder)).sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0];
  const status = !remindersReady
    ? undefined
    : overdueCount > 0
      ? t('planner.status.overdue', { count: overdueCount })
      : todayItems.length > 0
        ? t('planner.status.today', { count: todayItems.length, time: localTime(todayItems[0]!.dueAt) })
        : upcoming
          ? t('planner.status.next', { when: relativeDateTime(upcoming.dueAt) })
          : remindersEmpty
            ? t('planner.status.none')
            : undefined;

  const renderSection = (section: Section) => (
    <section key={section.key} className="plan-agenda-group" data-kind={section.kind} data-selected={selectedDay === section.key || undefined} data-testid="planner-section" data-key={section.key}>
      <div className="plan-agenda-label">
        <h3>{section.label}</h3>
        <span>{section.sub}</span>
      </div>
      <ul className="flex min-w-0 flex-col">
        <AnimatePresence initial={false}>
          {section.items.map((reminder, row) => (
            <ReminderRow
              key={reminder.id}
              reminder={reminder}
              index={row}
              showDay={section.showDay}
              next={reminder.id === upcoming?.id}
              onEdit={() => editReminder(reminder)}
              onDelete={() => setDeleting({ kind: 'reminder', item: reminder })}
            />
          ))}
        </AnimatePresence>
      </ul>
    </section>
  );

  const selectDay = (day: LocalDay) => setSelectedDay((current) => (current === day ? null : day));
  const moveWeek = (weeks: number) => {
    setWeekStart((current) => addDays(current, weeks * 7));
    setSelectedDay(null);
  };
  const thisWeek = weekStartOf(today);

  return (
    <Workspace data-testid="planner-page">
      <WorkspaceHeader
        title={t('nav.planner')}
        status={status}
        actions={
          !remindersEmpty && (
            <Button variant="primary" icon={<Plus weight="bold" />} onClick={() => newReminder()} data-testid="reminder-add">
              {t('planner.addReminder')}
            </Button>
          )
        }
      />

      <div className="plan-grid">
        {/* ── takvim + zaman çizgisi ── */}
        <Panel tone="lead" padding="none" className="plan-lead" data-cols={sideSections.length > 0 ? 2 : undefined} data-testid="planner-reminders">
          {/* Sol bölme: hafta başlığı, şerit ve o haftanın günleri aynı genişlikte (şerit yönettiği listenin üstünde durur). */}
          <div className="plan-lead-main">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-2 px-5 pt-3.5 pb-1">
              <h2 className="min-w-0 flex-1 text-lg text-fg" data-testid="planner-week-label">
                {weekLabel(weekStart)}
              </h2>
              {selectedDay && (
                <Button size="sm" variant="ghost" onClick={() => setSelectedDay(null)} data-testid="planner-day-clear">
                  {t('planner.agenda.showAll')}
                </Button>
              )}
              {weekStart !== thisWeek && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setWeekStart(thisWeek);
                    setSelectedDay(null);
                  }}
                  data-testid="planner-week-today"
                >
                  {t('planner.week.thisWeek')}
                </Button>
              )}
              <div className="-mr-2 flex items-center">
                <IconButton icon={<CaretLeft />} label={t('planner.week.prev')} size="sm" onClick={() => moveWeek(-1)} data-testid="planner-week-prev" />
                <IconButton icon={<CaretRight />} label={t('planner.week.next')} size="sm" onClick={() => moveWeek(1)} data-testid="planner-week-next" />
              </div>
            </div>
            {reminders.state.status === 'loading' ? (
              <LeadSkeleton />
            ) : reminders.state.status === 'error' ? (
              <div className="p-5">
                <ErrorPanel message={reminders.state.message} onRetry={reminders.reload} />
              </div>
            ) : (
              <>
                <WeekStrip start={weekStart} marks={marks} selected={selectedDay} onSelect={selectDay} />
                <div className="plan-agenda" data-day={selectedDay ?? undefined} data-testid="planner-agenda">
                  {remindersEmpty ? (
                    <motion.div {...emptyPreset} className="plan-empty" data-testid="planner-empty">
                      <div className="flex flex-col items-start gap-2">
                        <h3 className="text-2xl text-fg">{t('planner.empty.reminders')}</h3>
                        <p className="max-w-[52ch] text-base text-fg-muted">{t('planner.empty.remindersBody')}</p>
                        <div className="mt-4">
                          <Button variant="primary" icon={<Plus weight="bold" />} onClick={() => newReminder()} data-testid="reminder-add">
                            {t('planner.addReminder')}
                          </Button>
                        </div>
                      </div>
                      <div className="flex flex-col gap-3">
                        <h4 className="text-sm font-semibold tracking-normal text-fg-muted">{t('planner.empty.voice')}</h4>
                        <ul className="flex flex-col gap-2.5">
                          {(['one', 'two', 'three'] as const).map((key) => (
                            <li key={key} className="text-base text-fg-muted">
                              “{t(`planner.empty.example.${key}`, { wake: shell.wakePhrase })}”
                            </li>
                          ))}
                        </ul>
                      </div>
                    </motion.div>
                  ) : (
                    <>
                      {/* Seçilen günde hatırlatıcı yoksa (ya da hafta boşsa) bunu söyleyen satır listenin başında durur. */}
                      {(selectedDay ? dayItems.length === 0 : mainSections.length === 0) && (
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4" data-selected="" data-testid="planner-day-empty">
                          <p className="text-base text-fg">{selectedDay ? t('planner.agenda.dayEmpty', { day: `${formatDay(selectedDay)} ${weekdayName(weekdayOf(selectedDay))}` }) : t('planner.agenda.weekNone')}</p>
                          {selectedDay && selectedDay >= today && (
                            <Button size="sm" icon={<Plus />} onClick={() => newReminder()} data-testid="reminder-add-day">
                              {t('planner.agenda.addToDay')}
                            </Button>
                          )}
                        </div>
                      )}
                      {mainSections.map(renderSection)}
                    </>
                  )}
                  {selectedDay && dayTodos.length > 0 && (
                    <div className="plan-agenda-group" data-selected="" data-testid="planner-day-todos">
                      <div className="plan-agenda-label">
                        <h3>{t('planner.agenda.dueTodos')}</h3>
                        <span>{t('planner.agenda.dueTodosSub')}</span>
                      </div>
                      <ul className="flex min-w-0 flex-col py-2">
                        {dayTodos.map((todo) => (
                          <li key={todo.id} className="flex items-center gap-3 px-2 py-1.5 text-base text-fg">
                            <ListChecks className="size-4 shrink-0 text-fg-faint" aria-hidden />
                            <span className="min-w-0 truncate">{todo.text}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
          {/* Sağ bölme: haftadan sonrası. Geniş kapta kutunun üstünden başlar; dar kapta haftanın altındadır. */}
          {sideSections.length > 0 && (
            <div className="plan-agenda plan-lead-side" data-day={selectedDay ?? undefined} data-testid="planner-later">
              <p className="plan-agenda-divider">
                {t('planner.agenda.later')}
                <span>{sideCount}</span>
              </p>
              {sideSections.map(renderSection)}
            </div>
          )}
        </Panel>

        {/* ── yapılacaklar ── */}
        <Panel
          tone="base"
          padding="none"
          className="plan-todos"
          title={t('planner.tab.todos')}
          {...(open.length > 0 ? { count: open.length } : {})}
          data-testid="planner-todos"
        >
          <form onSubmit={(event) => void addQuick(event)} className="px-5 pt-3" data-testid="planner-quick">
            <Input
              size="sm"
              leading={<Plus />}
              value={quick}
              onChange={(event) => setQuick(event.target.value)}
              placeholder={t('planner.quick.placeholder')}
              aria-label={t('planner.quick.label')}
              trailing={
                <span className="-mr-1.5 flex">
                  <IconButton icon={<SlidersHorizontal />} label={t('planner.todo.detailed')} size="sm" onClick={newTodo} data-testid="todo-add" />
                </span>
              }
              data-testid="planner-quick-input"
            />
          </form>
          <div className="px-3 pt-1 pb-3">
            {todos.state.status === 'loading' ? (
              <div className="flex flex-col gap-3 p-2" aria-busy aria-label={t('common.loading')}>
                {[0, 1, 2].map((index) => (
                  <div key={index} className="flex items-center gap-3">
                    <Skeleton className="size-5 rounded-xs" />
                    <Skeleton className="h-3.5 w-3/5 rounded-full" />
                  </div>
                ))}
              </div>
            ) : todos.state.status === 'error' ? (
              <ErrorPanel message={todos.state.message} onRetry={todos.reload} />
            ) : open.length === 0 ? (
              <div className="flex flex-col gap-1 px-2 py-3" data-testid="planner-todos-empty">
                <p className="text-base font-medium text-fg">{t('planner.empty.todos')}</p>
                <p className="text-sm text-fg-muted">{t('planner.empty.todosBody')}</p>
              </div>
            ) : (
              <ul className="flex flex-col">
                <AnimatePresence initial={false}>
                  {open.map((todo, index) => (
                    <TodoRow key={todo.id} todo={todo} index={index} onEdit={() => editTodo(todo)} onDelete={() => setDeleting({ kind: 'todo', item: todo })} />
                  ))}
                </AnimatePresence>
              </ul>
            )}
          </div>
        </Panel>

        {/* ── bağlam: özet saatleri, geçmiş (tek yüzey) ── */}
        <div className="plan-ctx">
          <ContextCard>
            <ContextSection title={t('planner.brief.title')} data-testid="planner-briefs">
              <dl className="flex flex-col gap-2">
                {(
                  [
                    ['morning', morning],
                    ['evening', evening],
                  ] as const
                ).map(([key, time]) => (
                  <div key={key} className="grid grid-cols-[52px_48px_minmax(0,1fr)] items-baseline gap-x-2 text-sm">
                    <dt className="text-fg-muted">{t(`planner.brief.${key}`)}</dt>
                    <dd className="contents">
                      <time className="font-semibold text-fg tabular-nums">{time}</time>
                      <span className="text-fg-muted">{t(`planner.brief.${key}Hint`)}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            </ContextSection>
            <ContextSection
              title={t('planner.tab.history')}
              {...(historyItems.length > 0 ? { count: historyItems.length } : {})}
              action={
                historyItems.length > HISTORY_PREVIEW ? (
                  <Button size="sm" variant="ghost" aria-expanded={historyOpen} onClick={() => setHistoryOpen((value) => !value)} data-testid="planner-history-toggle">
                    {historyOpen ? t('planner.history.less') : t('planner.history.all')}
                  </Button>
                ) : undefined
              }
              data-testid="planner-history"
            >
              {historyItems.length === 0 ? (
                <p className="text-sm text-fg-faint">{t('planner.empty.history')}</p>
              ) : (
                <ul className="flex flex-col">
                  {historyItems.slice(0, historyOpen ? 100 : HISTORY_PREVIEW).map((item) => (
                    <li key={`${item.kind}-${item.id}`} className="plan-history-row" data-testid="history-row">
                      <span className="flex shrink-0 text-fg-faint [&_svg]:size-4">{item.kind === 'reminder' ? <Bell /> : <ListChecks />}</span>
                      <span className="min-w-0 flex-1 truncate text-sm text-fg-muted" title={item.text}>
                        {item.text}
                      </span>
                      <span className="plan-history-side">
                        <span className="text-xs text-fg-faint">{item.status === 'cancelled' ? t('planner.cancelled') : capitalize(relativeDay(localDay(item.at)))}</span>
                        {'todo' in item && item.todo && (
                          <span className="plan-history-undo">
                            <IconButton icon={<ArrowCounterClockwise />} label={t('planner.reopen')} size="sm" onClick={() => void setTodoDone(item.todo, false)} data-testid="history-reopen" />
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </ContextSection>
          </ContextCard>
        </div>
      </div>

      <ReminderDialog draft={reminderDraft} onClose={() => setReminderDraft(null)} />
      <TodoDialog draft={todoDraft} onClose={() => setTodoDraft(null)} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(value) => !value && setDeleting(null)}
        title={deleting?.kind === 'todo' ? t('planner.deleteTodoTitle') : t('planner.deleteReminderTitle')}
        body={deleting ? t('planner.deleteBody', { text: deleting.item.text }) : ''}
        confirmLabel={t('common.delete')}
        onConfirm={async () => {
          if (!deleting) return;
          const ok =
            deleting.kind === 'todo'
              ? await attempt(() => window.fuber.invoke('planner.deleteTodo', { id: deleting.item.id }))
              : await attempt(() => window.fuber.invoke('planner.deleteReminder', { id: deleting.item.id }));
          if (ok) toast.success(t('planner.toast.deleted'));
        }}
      />
    </Workspace>
  );
}

export default definePage({
  id: 'planner',
  titleKey: 'nav.planner',
  icon: CalendarCheck,
  order: 40,
  moduleId: 'planner',
  Component: PlannerPage,
});
