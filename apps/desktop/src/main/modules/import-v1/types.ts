// v1 içe aktarıcısının kendi IPC kanalları ve olayı (çekirdek `Api`'ye tip genişletmesiyle eklenir).
// Ayarlar sayfası da bu dosyayı `import type` ile alır; burada Node'a özgü hiçbir şey olmamalı.
import type { Id, IsoDateTime } from '@fuber/shared';

/** Aktarılabilen dört v1 tablosu. */
export type V1Table = 'hafizalar' | 'hatirlaticilar' | 'gorevler' | 'meseleler';

/** v1 tablosunun okunabilirliği. `missing`: tablo yok (eski sürüm); `incompatible`: beklenen sütun eksik. */
export interface V1TableStatus {
  table: V1Table;
  state: 'ok' | 'missing' | 'incompatible';
  /** `incompatible` ise eksik sütunlar. */
  missingColumns: string[];
  /** Tabloda `gizli` sütunu var mı (yoksa hiçbir kayıt gizli sayılmaz). */
  hasPrivateColumn: boolean;
}

/** v1 klasörünün durumu: yalnız dosyalara bakılır, veritabanı açılmaz. */
export interface ImportV1Status {
  found: boolean;
  dir: string | null;
  /** `fuber.db` + `fuber.db-wal` toplam bayt. */
  bytes: number;
  /** Son yazım (WAL dahil). */
  modifiedAt: IsoDateTime | null;
  /** Geri alınmamış son aktarım. */
  lastRun: ImportV1RunSummary | null;
  /** v2 tarafında hatırlatıcı ve yapılacak tabloları var mı (Planlar modülü hiç yüklenmediyse yok). */
  plannerReady: boolean;
}

/**
 * Önizleme: v1 veritabanının anlık kopyasında YALNIZ şema ve satır SAYILARI okunur; hiçbir satırın içeriği
 * okunmaz, hiçbir şey yazılmaz.
 */
export interface ImportV1Preview {
  dir: string;
  /** v1 göç sürümü (`meta.surum`); okunamadıysa `null`. */
  schemaVersion: number | null;
  tables: V1TableStatus[];
  memories: { active: number; private: number; deletedOrArchived: number };
  reminders: { upcoming: number; past: number; private: number };
  todos: { open: number; done: number; private: number };
  issues: { open: number; closed: number; private: number };
  /** Daha önceki (geri alınmamış) aktarımlardan v2'de iz kaydı olan satırlar: yeniden eklenmez. */
  alreadyImported: Record<V1Table, number>;
  plannerReady: boolean;
}

export interface ImportV1Options {
  memories: boolean;
  /** Yalnız gelecekteki ve etkin hatırlatıcılar (tekrarlılar bir sonraki anlarıyla). */
  reminders: boolean;
  /** Geçmişte kalan hatırlatıcılar hatırlatıcı OLMAZ; seçilirse hafızaya tarihli not olarak girer. */
  pastRemindersAsNotes: boolean;
  todos: boolean;
  doneTodos: boolean;
  /** Açık meseleler hafızaya "söz/bekleyen iş" kaydı olarak girer. */
  issues: boolean;
  /** `gizli = 1` kayıtlar da aktarılsın mı (varsayılan hayır). */
  includePrivate: boolean;
}

export const DEFAULT_IMPORT_OPTIONS: ImportV1Options = {
  memories: true,
  reminders: true,
  pastRemindersAsNotes: false,
  todos: true,
  doneTodos: false,
  issues: true,
  includePrivate: false,
};

export interface ImportV1Counts {
  memories: number;
  reminders: number;
  todos: number;
  issueNotes: number;
  pastReminderNotes: number;
}

export interface ImportV1Skipped {
  /** `gizli = 1` (ayrı onay verilmedi). */
  private: number;
  /** Sır, parola ya da anahtar gibi görünen metin. */
  secrets: number;
  /** Önceki aktarımda zaten alınmış ya da aynı içerik ikinci kez geldi. */
  duplicates: number;
  /** Boş başlık, okunamayan tarih, tanınmayan tekrar kuralı. */
  invalid: number;
  /** Seçilmeyen türler, geçmiş hatırlatıcılar, bitmiş yapılacaklar, kapanmış meseleler, silinmiş/arşiv hafıza. */
  notSelected: number;
}

export interface ImportV1Result {
  runId: Id;
  imported: ImportV1Counts;
  skipped: ImportV1Skipped;
  /** Okunamayan tablolar ve nedeni; o tablolar atlanır, ötekiler aktarılır. */
  tableErrors: Array<{ table: V1Table; message: string }>;
  startedAt: IsoDateTime;
  finishedAt: IsoDateTime;
}

export interface ImportV1RunSummary {
  id: Id;
  startedAt: IsoDateTime;
  finishedAt: IsoDateTime;
  imported: ImportV1Counts;
  skipped: ImportV1Skipped;
  /** Geri alınırsa kaldırılacak kayıt sayısı (iz tablosundan). */
  undoable: number;
}

export interface ImportV1UndoResult {
  runId: Id;
  /** Kaldırılan v2 kayıtları. */
  removed: number;
  /** Kullanıcı daha önce kendisi silmişti; yapılacak bir şey yoktu. */
  alreadyGone: number;
}

export type ImportV1Phase = 'copying' | 'reading' | 'writing' | 'done';

declare module '@fuber/shared' {
  interface Api {
    /** v1 klasörü var mı ve son aktarım (veritabanı açılmaz). */
    'import-v1.status': { req: Record<string, never>; res: ImportV1Status };
    /** Salt okunur önizleme: şema ve sayılar. */
    'import-v1.preview': { req: Record<string, never>; res: ImportV1Preview };
    /** Kullanıcı onayıyla aktarım: tek işlem. */
    'import-v1.run': { req: { options: ImportV1Options }; res: ImportV1Result };
    /** Bir aktarımın v2'ye eklediği kayıtları kaldırır. */
    'import-v1.undo': { req: { runId: Id }; res: ImportV1UndoResult };
  }
  interface BusEvents {
    'import-v1.progress': { phase: ImportV1Phase; done: number; total: number };
  }
  interface WindowEvents {
    'import-v1.progress': { phase: ImportV1Phase; done: number; total: number };
  }
}
