// Aktarılan kayıtların gittiği yer: hafıza çekirdek servisi ve Planlar modülünün içe aktarma yüzü.
//
// Planlar için tek bağlantı noktası burasıdır: Planlar'ın dışa açık içe aktarma yüzü (`planner/import-api.ts`)
// kullanılır. Eşzamanlıdır (bizim işlemimize girer), kaydın asıl oluşturulma/bitirilme anını kabul eder ve kaydın
// gerçekten yeni oluşturulup oluşturulmadığını söyler: Planlar kopya koruması yüzünden var olan bir kaydı döndürürse
// o kayıt bizim değildir (`null` döneriz; aktarım geri alınırken silinmez).
import type { Id, MemorySaveInput, ModuleContext, ReminderInput, TodoInput } from '@fuber/shared';
import { createPlannerImportApi, type PlannerImportApi } from '../planner/import-api';
import type { ImportSink, ImportStamps, TargetType } from './importer';

export function createImportSink(ctx: ModuleContext): ImportSink {
  let api: PlannerImportApi | null = null;
  const planner = () => (api ??= createPlannerImportApi(ctx));

  return {
    plannerReady: () => planner().ready(),

    prepare() {
      ctx.memory.stats();
    },

    saveMemory(input: MemorySaveInput): Id | null {
      const item = ctx.memory.save(input);
      return item.source === 'import' ? item.id : null;
    },

    createReminder(input: ReminderInput, stamps: ImportStamps = {}): Id | null {
      const record = planner().importReminder(input, { createdAt: stamps.createdAt ?? null });
      return record.created ? record.id : null;
    },

    createTodo(input: TodoInput, done: boolean, stamps: ImportStamps = {}): Id | null {
      const record = planner().importTodo(input, { createdAt: stamps.createdAt ?? null, done, doneAt: stamps.doneAt ?? null });
      return record.created ? record.id : null;
    },

    remove(type: TargetType, id: Id): boolean {
      if (type === 'memory') return ctx.memory.forget(id);
      return planner().remove(type, id);
    },

    isRejection: (error) => planner().isRejection(error),
  };
}
