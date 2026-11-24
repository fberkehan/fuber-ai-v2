// Planlar eylemleri: Bugün ve Planlar sayfası aynı tamamla / geri al / ertele davranışını paylaşır.
import { addDays, fromLocal, localDay, localTime, t, type Reminder, type Todo } from '@fuber/shared';
import { toast } from '@fuber/ui';
import { attempt } from '../../shell/live';

/**
 * Tamamlananı geri alma. Sözleşmede "yeniden aç" kanalı yok (raporda): tek seferlik hatırlatıcı ertelemeyle
 * planlıya döndürülür, sonra asıl anı geri yazılır. Anı geçmişse 10 dk sonra yeniden hatırlatılır.
 */
async function reopenReminder(reminder: Reminder): Promise<void> {
  const future = new Date(reminder.dueAt).getTime() - Date.now() > 60_000;
  const snoozed = await attempt(() => window.fuber.invoke('planner.snoozeReminder', { id: reminder.id, minutes: future ? 1 : 10 }));
  if (!snoozed) return;
  if (future) {
    const restored = await attempt(() => window.fuber.invoke('planner.updateReminder', { id: reminder.id, patch: { dueAt: reminder.dueAt } }));
    if (restored) toast(({ title: t('planner.toast.reopened', { text: reminder.text }) }));
  } else {
    toast(({ title: t('planner.toast.reopenedLater', { text: reminder.text }) }));
  }
}

export async function completeReminder(reminder: Reminder): Promise<boolean> {
  const done = await attempt(() => window.fuber.invoke('planner.completeReminder', { id: reminder.id }));
  if (!done) return false;
  toast.success(t('planner.toast.completed', { text: reminder.text }), {
    ...(reminder.recurrence
      ? { description: t('planner.toast.recurringNext') }
      : { action: { label: t('common.undo'), onClick: () => void reopenReminder(reminder) } }),
  });
  return true;
}

export async function setTodoDone(todo: Todo, done: boolean): Promise<boolean> {
  const updated = await attempt(() => window.fuber.invoke('planner.updateTodo', { id: todo.id, patch: { done } }));
  if (!updated) return false;
  if (done) {
    toast.success(t('planner.toast.todoDone', { text: todo.text }), {
      action: { label: t('common.undo'), onClick: () => void setTodoDone(todo, false) },
    });
  }
  return true;
}

export type SnoozeChoice = 'hour' | 'tomorrow' | 'week';

/** Erteleme dakikası: 1 saat; yarın ve haftaya aynı saatte (sabah 09:00'dan erken değil). */
export function snoozeMinutes(choice: SnoozeChoice, reminder: Reminder, now = new Date()): number {
  if (choice === 'hour') return 60;
  const time = localTime(reminder.dueAt);
  const target = fromLocal(addDays(localDay(now), choice === 'tomorrow' ? 1 : 7), time < '09:00' ? '09:00' : time);
  return Math.max(1, Math.round((target.getTime() - now.getTime()) / 60_000));
}

export async function snoozeReminder(reminder: Reminder, choice: SnoozeChoice): Promise<void> {
  const next = await attempt(() =>
    window.fuber.invoke('planner.snoozeReminder', { id: reminder.id, minutes: snoozeMinutes(choice, reminder) }),
  );
  if (next) toast.success(t(`planner.toast.snoozed.${choice}`, { text: reminder.text }));
}
