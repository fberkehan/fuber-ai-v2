// Planlar'ın içe aktarma yüzü: başka bir kaynaktan (bugün yalnız v1 aktarıcısı) gelen hatırlatıcı ve yapılacakları,
// kaydın ASIL zaman damgalarıyla (oluşturulma, bitirilme) yazar. Araçların ve IPC kanallarının kullandığı kayıt
// kurallarından (metin doğrulama, zamanlayıcıya bağlama, hafızadaki "söz verilen iş" kaydı) geçer.
//
// Eşzamanlıdır: çağıran kendi veritabanı işleminin içinde kullanabilir (aktarım ya hep ya hiç). Her çağrı kaydın
// gerçekten YENİ oluşturulup oluşturulmadığını söyler: Planlar bir kopya koruması yüzünden var olan kaydı döndürürse
// `created: false` gelir ve çağıran o kaydı kendi kaydı saymaz (aktarımı geri alırken silmez).
import type { Id, IsoDateTime, ModuleContext, ReminderInput, TodoInput } from '@fuber/shared';
import { createPlannerRepo, PlannerError, type PlannerRepo } from './repo';

export interface ImportedRecord {
  id: Id;
  created: boolean;
}

export interface ReminderImportStamps {
  /** Kaydın kaynakta oluşturulduğu an; verilmezse şimdi. Gelecekteki an şimdiye çekilir. */
  createdAt?: IsoDateTime | null;
}

export interface TodoImportStamps extends ReminderImportStamps {
  /** Kaynakta bitirilmiş mi. */
  done?: boolean;
  /** Bitirildiği an; `done` iken verilmezse şimdi. */
  doneAt?: IsoDateTime | null;
}

export interface PlannerImportApi {
  /** Planlar'ın tabloları kurulu mu (modül açık ve en az bir kez yüklenmiş). */
  ready(): boolean;
  importReminder(input: ReminderInput, stamps?: ReminderImportStamps): ImportedRecord;
  importTodo(input: TodoInput, stamps?: TodoImportStamps): ImportedRecord;
  /** Kaldırıldıysa `true`; kayıt zaten yoksa `false`. */
  remove(type: 'reminder' | 'todo', id: Id): boolean;
  /** Hata Planlar'ın geri çevirmesi mi (geçersiz kayıt); öyleyse çağıran satırı atlar, aktarımı durdurmaz. */
  isRejection(error: unknown): boolean;
}

/** Geçersiz ya da gelecekteki damga kullanılmaz: kayıt "henüz oluşmamış" görünmesin. */
function past(value: IsoDateTime | null | undefined, now: number): IsoDateTime | undefined {
  if (!value) return undefined;
  const at = Date.parse(value);
  if (Number.isNaN(at)) return undefined;
  return (at > now ? new Date(now).toISOString() : value) as IsoDateTime;
}

export function createPlannerImportApi(ctx: ModuleContext): PlannerImportApi {
  let repo: PlannerRepo | null = null;
  const planner = () => (repo ??= createPlannerRepo(ctx));
  const count = (table: 'planner_reminders' | 'planner_todos') => ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)?.n ?? 0;

  return {
    ready() {
      const rows = ctx.db.all<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('planner_reminders', 'planner_todos')",
      );
      return rows.length === 2;
    },

    importReminder(input, stamps = {}) {
      const before = count('planner_reminders');
      const createdAt = past(stamps.createdAt, Date.now());
      const reminder = planner().createReminder(input, 'import', null, createdAt ? { createdAt } : {});
      return { id: reminder.id, created: count('planner_reminders') === before + 1 };
    },

    importTodo(input, stamps = {}) {
      const before = count('planner_todos');
      const now = Date.now();
      const createdAt = past(stamps.createdAt, now);
      const doneAt = stamps.done ? (past(stamps.doneAt, now) ?? (new Date(now).toISOString() as IsoDateTime)) : null;
      const todo = planner().createTodo(input, 'import', { ...(createdAt ? { createdAt } : {}), doneAt });
      return { id: todo.id, created: count('planner_todos') === before + 1 };
    },

    remove(type, id) {
      try {
        if (type === 'reminder') planner().deleteReminder(id);
        else planner().deleteTodo(id);
        return true;
      } catch (error) {
        if (error instanceof PlannerError) return false;
        throw error;
      }
    },

    isRejection: (error) => error instanceof PlannerError,
  };
}
