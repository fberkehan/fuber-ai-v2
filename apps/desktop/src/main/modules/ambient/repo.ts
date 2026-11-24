// Ortam dinleme deposu: döküm satırları, notlar, meseleler, raporlar, araya girmeler, hafıza önerileri.
// Ses HİÇ saklanmaz: tabloların hiçbirinde ikili (BLOB) sütun yoktur; yalnız yazıya dökülmüş satırlar, süresi dolana dek.
// Fuber AI 1'in `gunkaydi/depo.ts` dosyasının v2 karşılığı; `gizli = 1` sütunu ve süzgeçleri taşınmadı.
import {
  foldForSearch,
  FTS_TOKENIZER,
  newId,
  type Id,
  type IsoDateTime,
  type LocalDay,
  type Migration,
  type ScopedDb,
  type SqlValue,
} from '@fuber/shared';
import { dayKey, type ReportKind } from './periods';
import { looseFtsQuery } from './stems';
import type {
  AmbientDay,
  AmbientInterjection,
  AmbientIssue,
  AmbientIssueStatus,
  AmbientNote,
  AmbientNoteKind,
  AmbientReport,
  AmbientSegment,
  AmbientSuggestion,
  InterjectionKind,
} from './types';

export const AMBIENT_MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'ortam dinleme tabloları',
    up: `CREATE TABLE ambient_segments (
      rid INTEGER PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      feed_id TEXT UNIQUE,
      text TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT NOT NULL,
      started_ms INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      day TEXT NOT NULL,
      noted INTEGER NOT NULL DEFAULT 0,
      addressed INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX ambient_segments_day ON ambient_segments (day, started_ms);
    CREATE INDEX ambient_segments_pending ON ambient_segments (noted, started_ms);
    CREATE VIRTUAL TABLE ambient_segments_fts USING fts5(norm, tokenize = "${FTS_TOKENIZER}");

    CREATE TABLE ambient_notes (
      rid INTEGER PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      day TEXT NOT NULL,
      at TEXT NOT NULL,
      text TEXT NOT NULL,
      important INTEGER NOT NULL,
      kind TEXT NOT NULL,
      people TEXT NOT NULL,
      unsure INTEGER NOT NULL,
      source_ids TEXT NOT NULL,
      source_from TEXT NOT NULL,
      source_to TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX ambient_notes_day ON ambient_notes (day, at);
    CREATE VIRTUAL TABLE ambient_notes_fts USING fts5(norm, tokenize = "${FTS_TOKENIZER}");

    CREATE TABLE ambient_issues (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      person TEXT,
      detail TEXT,
      first_day TEXT NOT NULL,
      due_day TEXT,
      status TEXT NOT NULL,
      closed_at TEXT,
      unsure INTEGER NOT NULL,
      source_ids TEXT NOT NULL,
      source_from TEXT NOT NULL,
      reminder_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX ambient_issues_status ON ambient_issues (status);

    CREATE TABLE ambient_reports (
      rid INTEGER PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      period TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      body TEXT NOT NULL,
      item_count INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (kind, period)
    );
    CREATE VIRTUAL TABLE ambient_reports_fts USING fts5(norm, tokenize = "${FTS_TOKENIZER}");

    CREATE TABLE ambient_interjections (
      id TEXT PRIMARY KEY,
      at TEXT NOT NULL,
      at_ms INTEGER NOT NULL,
      text TEXT NOT NULL,
      kind TEXT NOT NULL,
      trigger_text TEXT NOT NULL,
      sources TEXT NOT NULL,
      voiced INTEGER NOT NULL
    );
    CREATE INDEX ambient_interjections_at ON ambient_interjections (at_ms);

    CREATE TABLE ambient_suggestions (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      subject TEXT,
      day TEXT NOT NULL,
      source_ids TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE ambient_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
  },
  {
    id: 2,
    name: 'önemli notun hafıza kaydı',
    // Önemli not hafızaya da yazılır; not silinince (saklama, "son N dakikayı unut", hepsini sil) hafıza kaydı da gider.
    up: `ALTER TABLE ambient_notes ADD COLUMN memory_id TEXT;`,
  },
];

type Row = Record<string, SqlValue>;

const list = (raw: SqlValue | undefined): string[] => {
  try {
    const value: unknown = JSON.parse(String(raw ?? '[]'));
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
};
const text = (value: SqlValue | undefined): string => (value === null || value === undefined ? '' : String(value));
const nullable = (value: SqlValue | undefined): string | null => (value === null || value === undefined ? null : String(value));

const toSegment = (row: Row): AmbientSegment => ({
  id: text(row.id),
  text: text(row.text),
  startedAt: text(row.started_at),
  endedAt: text(row.ended_at),
  durationMs: Number(row.duration_ms),
  day: text(row.day),
  noted: Number(row.noted) === 1,
  addressed: Number(row.addressed) === 1,
});

const toNote = (row: Row): AmbientNote => ({
  id: text(row.id),
  day: text(row.day),
  at: text(row.at),
  text: text(row.text),
  important: Number(row.important) === 1,
  kind: text(row.kind) as AmbientNoteKind,
  people: list(row.people),
  unsure: Number(row.unsure) === 1,
  sourceIds: list(row.source_ids),
  sourceFrom: text(row.source_from),
  sourceTo: text(row.source_to),
  expiresAt: text(row.expires_at),
  createdAt: text(row.created_at),
});

const toIssue = (row: Row): AmbientIssue => ({
  id: text(row.id),
  title: text(row.title),
  person: nullable(row.person),
  detail: nullable(row.detail),
  firstDay: text(row.first_day),
  dueDay: nullable(row.due_day),
  status: text(row.status) as AmbientIssueStatus,
  closedAt: nullable(row.closed_at),
  unsure: Number(row.unsure) === 1,
  sourceIds: list(row.source_ids),
  sourceFrom: text(row.source_from),
  reminderId: nullable(row.reminder_id),
  createdAt: text(row.created_at),
  updatedAt: text(row.updated_at),
});

interface ReportBody {
  important?: string[];
  casual?: string[];
  decisions?: string[];
  openIssues?: string[];
  next?: string[];
  joke?: string | null;
}

const toReport = (row: Row): AmbientReport => {
  let body: ReportBody = {};
  try {
    body = JSON.parse(text(row.body) || '{}') as ReportBody;
  } catch {
    body = {};
  }
  const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []);
  return {
    id: text(row.id),
    kind: text(row.kind) as ReportKind,
    period: text(row.period),
    title: text(row.title),
    summary: text(row.summary),
    important: strings(body.important),
    casual: strings(body.casual),
    decisions: strings(body.decisions),
    openIssues: strings(body.openIssues),
    next: strings(body.next),
    joke: typeof body.joke === 'string' && body.joke.trim() ? body.joke : null,
    itemCount: Number(row.item_count),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
};

const toInterjection = (row: Row): AmbientInterjection => ({
  id: text(row.id),
  at: text(row.at),
  text: text(row.text),
  kind: text(row.kind) as InterjectionKind,
  trigger: text(row.trigger_text),
  sources: list(row.sources),
  voiced: Number(row.voiced) === 1,
});

const toSuggestion = (row: Row): AmbientSuggestion => ({
  id: text(row.id),
  text: text(row.text),
  subject: nullable(row.subject),
  day: text(row.day),
  sourceIds: list(row.source_ids),
  status: text(row.status) as AmbientSuggestion['status'],
  createdAt: text(row.created_at),
});

const placeholders = (count: number) => Array.from({ length: count }, () => '?').join(',');

export interface SegmentInput {
  /** Ses hattının verdiği bölüt kimliği; aynı bölüt iki kez gelirse ikincisi yazılmaz. */
  feedId: string | null;
  text: string;
  startedAt: IsoDateTime;
  endedAt: IsoDateTime;
  durationMs: number;
  addressed: boolean;
}

export type NoteInput = Omit<AmbientNote, 'id' | 'createdAt'>;
export type IssueInput = Pick<AmbientIssue, 'title' | 'person' | 'detail' | 'firstDay' | 'dueDay' | 'unsure' | 'sourceIds' | 'sourceFrom'>;
export type ReportInput = Omit<AmbientReport, 'id' | 'createdAt' | 'updatedAt'>;
export interface IssuePatch {
  title?: string;
  detail?: string | null;
  dueDay?: LocalDay | null;
  status?: AmbientIssueStatus;
  reminderId?: Id | null;
  /** Meseleye yeniden değinen döküm satırları (kaynak listesine eklenir). */
  addSourceIds?: Id[];
}

export interface AmbientRepo {
  getState<T>(key: string): T | undefined;
  setState(key: string, value: unknown): void;

  addSegment(input: SegmentInput): AmbientSegment | null;
  pendingSegments(limit: number): AmbientSegment[];
  markNoted(ids: Id[]): void;
  recentSegments(count: number): AmbientSegment[];
  segmentsOfDay(day: LocalDay): AmbientSegment[];
  segmentsByIds(ids: Id[]): AmbientSegment[];
  searchSegments(query: string, limit: number): AmbientSegment[];
  deleteSegments(ids: Id[]): number;
  /** `cutoff`'tan eski bütün satırları siler (notlanmış olsun olmasın: saklama sözü). */
  deleteSegmentsBefore(cutoff: IsoDateTime): number;
  segmentIdsSince(since: IsoDateTime): Id[];

  addNote(input: NoteInput): AmbientNote;
  getNote(id: Id): AmbientNote | null;
  notesOfDay(day: LocalDay): AmbientNote[];
  notesOfDays(days: LocalDay[], importantOnly?: boolean): AmbientNote[];
  hasNotes(days: LocalDay[]): boolean;
  searchNotes(query: string, limit: number): AmbientNote[];
  deleteNotes(ids: Id[]): number;
  expiredNoteIds(now: IsoDateTime): Id[];
  /** `since`'ten sonra yazılmış ve kaynağı verilen satırlardan biri olan notlar. */
  noteIdsDerivedFrom(segmentIds: Id[], since: IsoDateTime): Id[];
  /** Notun hafızaya yazılan kopyası. */
  linkNoteMemory(noteId: Id, memoryId: Id): void;
  /** Verilen notların (verilmezse bütün notların) hafıza kaydı kimlikleri. */
  noteMemoryIds(noteIds?: Id[]): Id[];
  /** Notlar `since`'ten sonra yazılmış önemli notlar, eskiden yeniye. */
  importantNotesSince(since: IsoDateTime, limit: number): AmbientNote[];

  addIssue(input: IssueInput): AmbientIssue;
  getIssue(id: Id): AmbientIssue | null;
  listIssues(status: 'open' | 'closed' | 'all', limit?: number): AmbientIssue[];
  updateIssue(id: Id, patch: IssuePatch): AmbientIssue | null;
  deleteIssues(ids: Id[]): number;
  issueIdsDerivedFrom(segmentIds: Id[], since: IsoDateTime): Id[];
  /** `cutoff`'tan önce kapanmış meseleler. */
  closedIssueIdsBefore(cutoff: IsoDateTime): Id[];

  upsertReport(input: ReportInput): AmbientReport;
  getReport(kind: ReportKind, period: string): AmbientReport | null;
  listReports(filter: { kind?: ReportKind; periods?: string[]; limit: number }): AmbientReport[];
  searchReports(query: string, limit: number): AmbientReport[];
  deleteReports(ids: Id[]): number;
  reportIdsCreatedSince(since: IsoDateTime): Id[];
  reportIdsOlderThan(kind: ReportKind, cutoff: IsoDateTime): Id[];

  addInterjection(input: Omit<AmbientInterjection, 'id'>): AmbientInterjection;
  recentInterjections(limit: number): AmbientInterjection[];
  countInterjectionsSince(sinceMs: number): number;
  deleteInterjectionsSince(sinceMs: number): number;
  deleteInterjectionsBefore(beforeMs: number): number;

  addSuggestion(input: Omit<AmbientSuggestion, 'id' | 'createdAt' | 'status'>): AmbientSuggestion;
  getSuggestion(id: Id): AmbientSuggestion | null;
  listSuggestions(status?: AmbientSuggestion['status']): AmbientSuggestion[];
  setSuggestionStatus(id: Id, status: AmbientSuggestion['status']): void;
  suggestionIdsDerivedFrom(segmentIds: Id[], since: IsoDateTime): Id[];
  deleteSuggestions(ids: Id[]): number;
  deleteResolvedSuggestionsBefore(cutoff: IsoDateTime): number;

  days(limit: number): AmbientDay[];
  counts(day: LocalDay, sinceMs: number): { segments: number; notes: number; openIssues: number; interjections: number };
  deleteAll(): void;
}

export function createAmbientRepo(db: ScopedDb, now: () => Date = () => new Date()): AmbientRepo {
  const iso = () => now().toISOString();

  /**
   * Silme sırasında SQLite'ın silinen içeriği sıfırla doldurmasını ister: "sil" denen söz veritabanı dosyasının boş
   * sayfalarında okunur kalmasın. Ayar bağlantı genelidir; iş bitince eski değerine döner.
   */
  const secureDelete = <T>(run: () => T): T => {
    const before = db.get<{ secure_delete: number }>('PRAGMA secure_delete')?.secure_delete ?? 0;
    db.exec('PRAGMA secure_delete = ON');
    try {
      return db.transaction(run);
    } finally {
      db.exec(`PRAGMA secure_delete = ${Number(before) === 1 ? 'ON' : Number(before) === 2 ? 'FAST' : 'OFF'}`);
    }
  };

  /** Dizinli tablodan satır siler: önce FTS girdisi (rowid ile), sonra satırın kendisi. */
  const deleteIndexed = (table: 'segments' | 'notes' | 'reports', ids: Id[]): number => {
    if (ids.length === 0) return 0;
    return secureDelete(() => {
      let removed = 0;
      for (let offset = 0; offset < ids.length; offset += 200) {
        const chunk = ids.slice(offset, offset + 200);
        const marks = placeholders(chunk.length);
        const rows = db.all<{ rid: number }>(`SELECT rid FROM ambient_${table} WHERE id IN (${marks})`, chunk);
        for (const row of rows) db.run(`DELETE FROM ambient_${table}_fts WHERE rowid = ?`, [row.rid]);
        removed += db.run(`DELETE FROM ambient_${table} WHERE id IN (${marks})`, chunk).changes;
      }
      return removed;
    });
  };

  const deletePlain = (table: 'issues' | 'suggestions', ids: Id[]): number => {
    if (ids.length === 0) return 0;
    return secureDelete(() => db.run(`DELETE FROM ambient_${table} WHERE id IN (${placeholders(ids.length)})`, ids).changes);
  };

  const derivedFrom = (table: 'notes' | 'issues' | 'suggestions', segmentIds: Id[], since: IsoDateTime): Id[] => {
    if (segmentIds.length === 0) return [];
    const wanted = new Set(segmentIds);
    return db
      .all<{ id: string; source_ids: string }>(`SELECT id, source_ids FROM ambient_${table} WHERE created_at >= ?`, [since])
      .filter((row) => list(row.source_ids).some((id) => wanted.has(id)))
      .map((row) => row.id);
  };

  const search = <T>(table: 'segments' | 'notes' | 'reports', query: string, limit: number, map: (row: Row) => T, extra = ''): T[] => {
    const match = looseFtsQuery(query);
    if (!match) return [];
    return db
      .all<Row>(
        `SELECT t.* FROM ambient_${table}_fts f JOIN ambient_${table} t ON t.rid = f.rowid
         WHERE ambient_${table}_fts MATCH ?${extra} ORDER BY bm25(ambient_${table}_fts) LIMIT ?`,
        [match, limit],
      )
      .map(map);
  };

  const reportIndex = (report: ReportInput) =>
    foldForSearch([report.title, report.summary, ...report.important, ...report.casual, ...report.decisions, ...report.openIssues].join('\n'));

  const repo: AmbientRepo = {
    getState<T>(key: string): T | undefined {
      const row = db.get<{ value: string }>('SELECT value FROM ambient_state WHERE key = ?', [key]);
      if (!row) return undefined;
      try {
        return JSON.parse(row.value) as T;
      } catch {
        return undefined;
      }
    },
    setState(key, value) {
      db.run('INSERT INTO ambient_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, JSON.stringify(value)]);
    },

    addSegment(input) {
      if (input.feedId && db.get('SELECT 1 FROM ambient_segments WHERE feed_id = ?', [input.feedId])) return null;
      const id = newId();
      const started = new Date(input.startedAt);
      const result = db.run(
        `INSERT INTO ambient_segments (id, feed_id, text, started_at, ended_at, started_ms, duration_ms, day, noted, addressed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        [id, input.feedId, input.text, input.startedAt, input.endedAt, started.getTime(), Math.round(input.durationMs), dayKey(started), input.addressed ? 1 : 0],
      );
      db.run('INSERT INTO ambient_segments_fts (rowid, norm) VALUES (?, ?)', [result.lastInsertRowid, foldForSearch(input.text)]);
      return toSegment(db.get<Row>('SELECT * FROM ambient_segments WHERE id = ?', [id])!);
    },
    pendingSegments: (limit) => db.all<Row>('SELECT * FROM ambient_segments WHERE noted = 0 ORDER BY started_ms, rid LIMIT ?', [limit]).map(toSegment),
    markNoted(ids) {
      for (let offset = 0; offset < ids.length; offset += 200) {
        const chunk = ids.slice(offset, offset + 200);
        db.run(`UPDATE ambient_segments SET noted = 1 WHERE id IN (${placeholders(chunk.length)})`, chunk);
      }
    },
    recentSegments: (count) =>
      db.all<Row>('SELECT * FROM (SELECT * FROM ambient_segments ORDER BY started_ms DESC, rid DESC LIMIT ?) ORDER BY started_ms, rid', [count]).map(toSegment),
    segmentsOfDay: (day) => db.all<Row>('SELECT * FROM ambient_segments WHERE day = ? ORDER BY started_ms, rid', [day]).map(toSegment),
    segmentsByIds(ids) {
      if (ids.length === 0) return [];
      return db.all<Row>(`SELECT * FROM ambient_segments WHERE id IN (${placeholders(ids.length)}) ORDER BY started_ms, rid`, ids).map(toSegment);
    },
    searchSegments: (query, limit) => search('segments', query, limit, toSegment),
    deleteSegments: (ids) => deleteIndexed('segments', ids),
    deleteSegmentsBefore(cutoff) {
      const ids = db.all<{ id: string }>('SELECT id FROM ambient_segments WHERE started_ms < ?', [Date.parse(cutoff)]).map((row) => row.id);
      return deleteIndexed('segments', ids);
    },
    segmentIdsSince: (since) => db.all<{ id: string }>('SELECT id FROM ambient_segments WHERE started_ms >= ?', [Date.parse(since)]).map((row) => row.id),

    addNote(input) {
      const id = newId();
      const result = db.run(
        `INSERT INTO ambient_notes (id, day, at, text, important, kind, people, unsure, source_ids, source_from, source_to, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          input.day,
          input.at,
          input.text,
          input.important ? 1 : 0,
          input.kind,
          JSON.stringify(input.people),
          input.unsure ? 1 : 0,
          JSON.stringify(input.sourceIds),
          input.sourceFrom,
          input.sourceTo,
          input.expiresAt,
          iso(),
        ],
      );
      db.run('INSERT INTO ambient_notes_fts (rowid, norm) VALUES (?, ?)', [result.lastInsertRowid, foldForSearch([input.text, ...input.people].join(' '))]);
      return repo.getNote(id)!;
    },
    getNote(id) {
      const row = db.get<Row>('SELECT * FROM ambient_notes WHERE id = ?', [id]);
      return row ? toNote(row) : null;
    },
    notesOfDay: (day) => db.all<Row>('SELECT * FROM ambient_notes WHERE day = ? AND expires_at > ? ORDER BY at, rid', [day, iso()]).map(toNote),
    notesOfDays(days, importantOnly = false) {
      if (days.length === 0) return [];
      return db
        .all<Row>(
          `SELECT * FROM ambient_notes WHERE day IN (${placeholders(days.length)}) AND expires_at > ?${importantOnly ? ' AND important = 1' : ''} ORDER BY at, rid`,
          [...days, iso()],
        )
        .map(toNote);
    },
    hasNotes(days) {
      if (days.length === 0) return false;
      return db.get(`SELECT 1 FROM ambient_notes WHERE day IN (${placeholders(days.length)}) AND expires_at > ? LIMIT 1`, [...days, iso()]) !== undefined;
    },
    searchNotes(query, limit) {
      const current = iso().replace(/'/g, '');
      return search('notes', query, limit, toNote, ` AND t.expires_at > '${current}'`);
    },
    deleteNotes: (ids) => deleteIndexed('notes', ids),
    expiredNoteIds: (current) => db.all<{ id: string }>('SELECT id FROM ambient_notes WHERE expires_at <= ?', [current]).map((row) => row.id),
    noteIdsDerivedFrom: (segmentIds, since) => derivedFrom('notes', segmentIds, since),
    linkNoteMemory(noteId, memoryId) {
      db.run('UPDATE ambient_notes SET memory_id = ? WHERE id = ?', [memoryId, noteId]);
    },
    noteMemoryIds(noteIds) {
      if (noteIds === undefined) return db.all<{ memory_id: string }>('SELECT memory_id FROM ambient_notes WHERE memory_id IS NOT NULL').map((row) => row.memory_id);
      const ids: string[] = [];
      for (let offset = 0; offset < noteIds.length; offset += 200) {
        const chunk = noteIds.slice(offset, offset + 200);
        ids.push(...db.all<{ memory_id: string }>(`SELECT memory_id FROM ambient_notes WHERE memory_id IS NOT NULL AND id IN (${placeholders(chunk.length)})`, chunk).map((row) => row.memory_id));
      }
      return ids;
    },
    importantNotesSince: (since, limit) =>
      db.all<Row>('SELECT * FROM ambient_notes WHERE important = 1 AND created_at > ? AND expires_at > ? ORDER BY created_at, rid LIMIT ?', [since, iso(), limit]).map(toNote),

    addIssue(input) {
      const id = newId();
      const stamp = iso();
      db.run(
        `INSERT INTO ambient_issues (id, title, person, detail, first_day, due_day, status, closed_at, unsure, source_ids, source_from, reminder_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'open', NULL, ?, ?, ?, NULL, ?, ?)`,
        [id, input.title, input.person, input.detail, input.firstDay, input.dueDay, input.unsure ? 1 : 0, JSON.stringify(input.sourceIds), input.sourceFrom, stamp, stamp],
      );
      return repo.getIssue(id)!;
    },
    getIssue(id) {
      const row = db.get<Row>('SELECT * FROM ambient_issues WHERE id = ?', [id]);
      return row ? toIssue(row) : null;
    },
    listIssues(status, limit = 200) {
      const where = status === 'all' ? '' : status === 'open' ? "WHERE status = 'open'" : "WHERE status != 'open'";
      return db
        .all<Row>(`SELECT * FROM ambient_issues ${where} ORDER BY CASE WHEN due_day IS NULL THEN 1 ELSE 0 END, due_day, created_at DESC LIMIT ?`, [limit])
        .map(toIssue);
    },
    updateIssue(id, patch) {
      const current = repo.getIssue(id);
      if (!current) return null;
      const status = patch.status ?? current.status;
      const closedAt = status !== 'open' && current.status === 'open' ? iso() : status === 'open' ? null : current.closedAt;
      const sourceIds = patch.addSourceIds?.length ? [...new Set([...current.sourceIds, ...patch.addSourceIds])].slice(-40) : current.sourceIds;
      db.run(
        `UPDATE ambient_issues SET title = ?, detail = ?, due_day = ?, status = ?, closed_at = ?, reminder_id = ?, source_ids = ?, updated_at = ? WHERE id = ?`,
        [
          patch.title ?? current.title,
          patch.detail === undefined ? current.detail : patch.detail,
          patch.dueDay === undefined ? current.dueDay : patch.dueDay,
          status,
          closedAt,
          patch.reminderId === undefined ? current.reminderId : patch.reminderId,
          JSON.stringify(sourceIds),
          iso(),
          id,
        ],
      );
      return repo.getIssue(id);
    },
    deleteIssues: (ids) => deletePlain('issues', ids),
    issueIdsDerivedFrom: (segmentIds, since) => derivedFrom('issues', segmentIds, since),
    closedIssueIdsBefore: (cutoff) =>
      db.all<{ id: string }>("SELECT id FROM ambient_issues WHERE status != 'open' AND closed_at IS NOT NULL AND closed_at < ?", [cutoff]).map((row) => row.id),

    upsertReport(input) {
      const stamp = iso();
      const body: ReportBody = {
        important: input.important,
        casual: input.casual,
        decisions: input.decisions,
        openIssues: input.openIssues,
        next: input.next,
        joke: input.joke,
      };
      const existing = db.get<{ rid: number; id: string }>('SELECT rid, id FROM ambient_reports WHERE kind = ? AND period = ?', [input.kind, input.period]);
      let rid: number;
      if (existing) {
        db.run('UPDATE ambient_reports SET title = ?, summary = ?, body = ?, item_count = ?, updated_at = ? WHERE rid = ?', [
          input.title,
          input.summary,
          JSON.stringify(body),
          input.itemCount,
          stamp,
          existing.rid,
        ]);
        rid = existing.rid;
        db.run('DELETE FROM ambient_reports_fts WHERE rowid = ?', [rid]);
      } else {
        rid = db.run(
          'INSERT INTO ambient_reports (id, kind, period, title, summary, body, item_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [newId(), input.kind, input.period, input.title, input.summary, JSON.stringify(body), input.itemCount, stamp, stamp],
        ).lastInsertRowid;
      }
      db.run('INSERT INTO ambient_reports_fts (rowid, norm) VALUES (?, ?)', [rid, reportIndex(input)]);
      return repo.getReport(input.kind, input.period)!;
    },
    getReport(kind, period) {
      const row = db.get<Row>('SELECT * FROM ambient_reports WHERE kind = ? AND period = ?', [kind, period]);
      return row ? toReport(row) : null;
    },
    listReports(filter) {
      const where: string[] = [];
      const params: SqlValue[] = [];
      if (filter.kind) {
        where.push('kind = ?');
        params.push(filter.kind);
      }
      if (filter.periods) {
        if (filter.periods.length === 0) return [];
        where.push(`period IN (${placeholders(filter.periods.length)})`);
        params.push(...filter.periods);
      }
      params.push(filter.limit);
      return db
        .all<Row>(`SELECT * FROM ambient_reports ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY period DESC, rid DESC LIMIT ?`, params)
        .map(toReport);
    },
    searchReports: (query, limit) => search('reports', query, limit, toReport),
    deleteReports: (ids) => deleteIndexed('reports', ids),
    reportIdsCreatedSince: (since) => db.all<{ id: string }>('SELECT id FROM ambient_reports WHERE updated_at >= ?', [since]).map((row) => row.id),
    reportIdsOlderThan: (kind, cutoff) =>
      db.all<{ id: string }>('SELECT id FROM ambient_reports WHERE kind = ? AND created_at < ?', [kind, cutoff]).map((row) => row.id),

    addInterjection(input) {
      const id = newId();
      db.run('INSERT INTO ambient_interjections (id, at, at_ms, text, kind, trigger_text, sources, voiced) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
        id,
        input.at,
        Date.parse(input.at),
        input.text,
        input.kind,
        input.trigger,
        JSON.stringify(input.sources),
        input.voiced ? 1 : 0,
      ]);
      return { id, ...input };
    },
    recentInterjections: (limit) => db.all<Row>('SELECT * FROM ambient_interjections ORDER BY at_ms DESC LIMIT ?', [limit]).map(toInterjection),
    countInterjectionsSince: (sinceMs) => Number(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM ambient_interjections WHERE at_ms >= ?', [sinceMs])?.n ?? 0),
    deleteInterjectionsSince: (sinceMs) => secureDelete(() => db.run('DELETE FROM ambient_interjections WHERE at_ms >= ?', [sinceMs]).changes),
    deleteInterjectionsBefore: (beforeMs) => secureDelete(() => db.run('DELETE FROM ambient_interjections WHERE at_ms < ?', [beforeMs]).changes),

    addSuggestion(input) {
      const id = newId();
      db.run("INSERT INTO ambient_suggestions (id, text, subject, day, source_ids, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)", [
        id,
        input.text,
        input.subject,
        input.day,
        JSON.stringify(input.sourceIds),
        iso(),
      ]);
      return repo.getSuggestion(id)!;
    },
    getSuggestion(id) {
      const row = db.get<Row>('SELECT * FROM ambient_suggestions WHERE id = ?', [id]);
      return row ? toSuggestion(row) : null;
    },
    listSuggestions(status) {
      return db
        .all<Row>(`SELECT * FROM ambient_suggestions ${status ? 'WHERE status = ?' : ''} ORDER BY created_at DESC LIMIT 200`, status ? [status] : [])
        .map(toSuggestion);
    },
    setSuggestionStatus(id, status) {
      db.run('UPDATE ambient_suggestions SET status = ? WHERE id = ?', [status, id]);
    },
    suggestionIdsDerivedFrom: (segmentIds, since) => derivedFrom('suggestions', segmentIds, since),
    deleteSuggestions: (ids) => deletePlain('suggestions', ids),
    deleteResolvedSuggestionsBefore: (cutoff) =>
      secureDelete(() => db.run("DELETE FROM ambient_suggestions WHERE status != 'pending' AND created_at < ?", [cutoff]).changes),

    days(limit) {
      const current = iso();
      const rows = db.all<{ day: string; notes: number; important: number }>(
        'SELECT day, COUNT(*) AS notes, SUM(important) AS important FROM ambient_notes WHERE expires_at > ? GROUP BY day',
        [current],
      );
      const segments = db.all<{ day: string; n: number }>('SELECT day, COUNT(*) AS n FROM ambient_segments GROUP BY day');
      const reports = new Set(db.all<{ period: string }>("SELECT period FROM ambient_reports WHERE kind = 'daily'").map((row) => row.period));
      const byDay = new Map<string, AmbientDay>();
      const entry = (day: string): AmbientDay => {
        let value = byDay.get(day);
        if (!value) {
          value = { day, notes: 0, important: 0, segments: 0, hasReport: reports.has(day) };
          byDay.set(day, value);
        }
        return value;
      };
      for (const row of rows) Object.assign(entry(row.day), { notes: Number(row.notes), important: Number(row.important ?? 0) });
      for (const row of segments) entry(row.day).segments = Number(row.n);
      for (const day of reports) entry(day);
      return [...byDay.values()].sort((a, b) => (a.day < b.day ? 1 : -1)).slice(0, limit);
    },
    counts(day, sinceMs) {
      const one = (sql: string, params: SqlValue[]) => Number(db.get<{ n: number }>(sql, params)?.n ?? 0);
      return {
        segments: one('SELECT COUNT(*) AS n FROM ambient_segments WHERE day = ?', [day]),
        notes: one('SELECT COUNT(*) AS n FROM ambient_notes WHERE day = ? AND expires_at > ?', [day, iso()]),
        openIssues: one("SELECT COUNT(*) AS n FROM ambient_issues WHERE status = 'open'", []),
        interjections: one('SELECT COUNT(*) AS n FROM ambient_interjections WHERE at_ms >= ?', [sinceMs]),
      };
    },
    deleteAll() {
      secureDelete(() => {
        for (const table of ['segments', 'notes', 'reports']) {
          db.run(`DELETE FROM ambient_${table}_fts`);
          db.run(`DELETE FROM ambient_${table}`);
        }
        for (const table of ['issues', 'interjections', 'suggestions']) db.run(`DELETE FROM ambient_${table}`);
        // Tercihler ve rıza durmaz; yalnız eşlikçinin belleği (tekrar listesi, bugünkü "sus" işareti) silinir.
        db.run("DELETE FROM ambient_state WHERE key != 'prefs'");
      });
    },
  };
  return repo;
}
