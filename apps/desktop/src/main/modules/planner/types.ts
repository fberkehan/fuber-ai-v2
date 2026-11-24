// Sahibi: T2. Planlar modülünün kendi olayı (tip genişletmesi; çekirdek sözleşmeye dokunmaz).
import type { LocalDay } from '@fuber/shared';

declare module '@fuber/shared' {
  interface BusEvents {
    /**
     * Sabah/akşam özeti hazırlanırken yayınlanır. Başka modüller (ör. e-posta ya da takip işleri) yaklaşan
     * işlerini `lines` dizisine kısa Türkçe satır olarak EŞZAMANLI ekler; özet bu satırları da okur.
     */
    'planner.brief.collect': { kind: 'morning' | 'evening'; day: LocalDay; lines: string[] };
    /**
     * Özet bildirilmeden önce yayınlanır. Bir modül bu özeti kendisi veriyorsa (brifing modülü: sabah brifingi)
     * `handled`'ı EŞZAMANLI olarak `true` yapar; planlar o özeti bildirmez (aynı içerik iki kez söylenmesin).
     */
    'planner.brief.before': { kind: 'morning' | 'evening'; handled: boolean };
  }
}

export {};
