// Toplantı deposu: toplantılar (bağlam + özet), döküm satırları (çevirileriyle), yanıt önerileri, modül durumu.
// Ses HİÇ saklanmaz: hiçbir tabloda ikili (BLOB) sütun yoktur. Satırlar ortam dinlemenin saklama süresiyle silinir
// (`policy.ambient.retentionDays`); özet ve bağlam daha uzun yaşar (`MEETING_RETENTION`).
import { foldForSearch, ftsQuery, FTS_TOKENIZER, newId, type Id, type IsoDateTime, type Migration, type ScopedDb, type SqlValue } from '@fuber/shared';
import { cleanContext } from './pure';
import type {
  Meeting,
  MeetingContext,
  MeetingLine,
  MeetingListItem,
  MeetingSpeaker,
  MeetingState,
  MeetingSuggestion,
  MeetingSummary,
  SummaryProblem,
  TranslationState,
} from './types';

export const MEETING_MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'toplantı tabloları',
    up: `CREATE TABLE meeting_meetings (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      state TEXT NOT NULL,
      started_at TEXT NOT NULL,
      started_ms INTEGER NOT NULL,
      ended_at TEXT,
      target TEXT,
      their_language TEXT NOT NULL,
      suggestions INTEGER NOT NULL,
      system INTEGER NOT NULL,
      context TEXT NOT NULL,
      summary TEXT,
      summary_problem TEXT,
      summary_detail TEXT,
      summary_dropped INTEGER NOT NULL DEFAULT 0,
      echo_dropped INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX meeting_meetings_started ON meeting_meetings (started_ms);

    CREATE TABLE meeting_lines (
      rid INTEGER PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      meeting_id TEXT NOT NULL,
      speaker TEXT NOT NULL,
      text TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT NOT NULL,
      started_ms INTEGER NOT NULL,
      lang TEXT,
      translation TEXT,
      translation_state TEXT NOT NULL
    );
    CREATE INDEX meeting_lines_meeting ON meeting_lines (meeting_id, started_ms);
    CREATE INDEX meeting_lines_started ON meeting_lines (started_ms);
    CREATE VIRTUAL TABLE meeting_lines_fts USING fts5(norm, tokenize = "${FTS_TOKENIZER}");

    CREATE TABLE meeting_suggestions (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL,
      line_id TEXT NOT NULL,
      question TEXT NOT NULL,
      state TEXT NOT NULL,
      reply TEXT,
      translation TEXT,
      created_at TEXT NOT NULL,
      created_ms INTEGER NOT NULL
    );
    CREATE INDEX meeting_suggestions_meeting ON meeting_suggestions (meeting_id, created_ms);

    CREATE TABLE meeting_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
  },
];

type Row = Record<string, SqlValue>;
const text = (value: SqlValue | undefined): string => (value === null || value === undefined ? '' : String(value));
const nullable = (value: SqlValue | undefined): string | null => (value === null || value === undefined ? null : String(value));
const json = <T>(value: SqlValue | undefined, fallback: T): T => {
  try {
    return value === null || value === undefined ? fallback : (JSON.parse(String(value)) as T);
  } catch {
    return fallback;
  }
};
const placeholders = (count: number) => Array.from({ length: count }, () => '?').join(',');

const toLine = (row: Row): MeetingLine => ({
  id: text(row.id),
  meetingId: text(row.meeting_id),
  speaker: text(row.speaker) as MeetingSpeaker,
  text: text(row.text),
  startedAt: text(row.started_at),
  endedAt: text(row.ended_at),
  lang: nullable(row.lang),
  translation: nullable(row.translation),
  translationState: text(row.translation_state) as TranslationState,
});

const toSuggestion = (row: Row): MeetingSuggestion => ({
  id: text(row.id),
  meetingId: text(row.meeting_id),
  lineId: text(row.line_id),
  question: text(row.question),
  state: text(row.state) as MeetingSuggestion['state'],
  reply: nullable(row.reply),
  translation: nullable(row.translation),
  createdAt: text(row.created_at),
});

export interface LineInput {
  /** Kesinleşmeyi bekleyen satırın ekranda gösterilen kimliği korunur. */
  id?: Id;
  meetingId: Id;
  speaker: MeetingSpeaker;
  text: string;
  startedAt: IsoDateTime;
  endedAt: IsoDateTime;
  lang: string | null;
  translationState: TranslationState;
}

export interface MeetingInput {
  title: string;
  startedAt: IsoDateTime;
  target: string | null;
  theirLanguage: string;
  suggestions: boolean;
  system: boolean;
  context: MeetingContext;
}

export interface MeetingPatch {
  title?: string;
  state?: MeetingState;
  endedAt?: IsoDateTime | null;
  target?: string | null;
  theirLanguage?: string;
  suggestions?: boolean;
  context?: MeetingContext;
  summary?: MeetingSummary | null;
  summaryProblem?: SummaryProblem | null;
  summaryDetail?: string | null;
  summaryDropped?: number;
  echoDropped?: number;
}

export interface MeetingRepo {
  create(input: MeetingInput): Meeting;
  get(id: Id): Meeting | null;
  update(id: Id, patch: MeetingPatch): Meeting | null;
  list(limit: number): MeetingListItem[];
  /** Bitmiş (ya da özetlenmekte kalmış) toplantılar, yeniden eskiye. */
  ended(limit: number): Meeting[];
  /** Uygulama süren toplantıyla kapandıysa açılışta bulunur ve bitirilir. */
  unfinished(): Meeting[];

  addLine(input: LineInput): MeetingLine;
  lines(meetingId: Id): MeetingLine[];
  getLine(id: Id): MeetingLine | null;
  setTranslation(id: Id, translation: string | null, state: TranslationState): MeetingLine | null;
  deleteLines(ids: Id[]): number;
  searchLines(query: string, limit: number): MeetingLine[];

  addSuggestion(input: Omit<MeetingSuggestion, 'id' | 'createdAt'>): MeetingSuggestion;
  updateSuggestion(id: Id, patch: Partial<Pick<MeetingSuggestion, 'state' | 'reply' | 'translation'>>): MeetingSuggestion | null;
  suggestions(meetingId: Id): MeetingSuggestion[];

  /** Süresi dolan satırları ve önerileri (`lineCutoff`) ve toplantıları (`meetingCutoff`) siler. */
  retain(lineCutoff: IsoDateTime, meetingCutoff: IsoDateTime): { lines: number; meetings: number };
  deleteMeeting(id: Id): void;
  deleteAll(): void;

  getState<T>(key: string): T | null;
  setState(key: string, value: unknown): void;
}

export function createMeetingRepo(db: ScopedDb, now: () => Date = () => new Date()): MeetingRepo {
  /** Silinen içerik veritabanı dosyasının boş sayfalarında okunur kalmasın (ortam dinlemeyle aynı kural). */
  const secureDelete = <T>(run: () => T): T => {
    const before = db.get<{ secure_delete: number }>('PRAGMA secure_delete')?.secure_delete ?? 0;
    db.exec('PRAGMA secure_delete = ON');
    try {
      return db.transaction(run);
    } finally {
      db.exec(`PRAGMA secure_delete = ${Number(before) === 1 ? 'ON' : Number(before) === 2 ? 'FAST' : 'OFF'}`);
    }
  };

  const counts = (id: Id) => db.get<{ n: number }>('SELECT COUNT(*) AS n FROM meeting_lines WHERE meeting_id = ?', [id])?.n ?? 0;

  const toMeeting = (row: Row): Meeting => ({
    id: text(row.id),
    title: text(row.title),
    state: text(row.state) as MeetingState,
    startedAt: text(row.started_at),
    endedAt: nullable(row.ended_at),
    target: nullable(row.target),
    theirLanguage: text(row.their_language) || 'auto',
    suggestions: Number(row.suggestions) === 1,
    system: Number(row.system) === 1,
    context: cleanContext(json(row.context, {})),
    summary: json<MeetingSummary | null>(row.summary, null),
    summaryProblem: nullable(row.summary_problem) as SummaryProblem | null,
    summaryDetail: nullable(row.summary_detail),
    summaryDropped: Number(row.summary_dropped ?? 0),
    lineCount: counts(text(row.id)),
    echoDropped: Number(row.echo_dropped ?? 0),
  });

  const deleteLineRows = (where: string, params: SqlValue[]): number => {
    const rows = db.all<{ rid: number }>(`SELECT rid FROM meeting_lines WHERE ${where}`, params);
    for (const row of rows) db.run('DELETE FROM meeting_lines_fts WHERE rowid = ?', [row.rid]);
    return db.run(`DELETE FROM meeting_lines WHERE ${where}`, params).changes;
  };

  const repo: MeetingRepo = {
    create(input) {
      const id = newId();
      db.run(
        `INSERT INTO meeting_meetings (id, title, state, started_at, started_ms, ended_at, target, their_language, suggestions, system, context)
         VALUES (?, ?, 'live', ?, ?, NULL, ?, ?, ?, ?, ?)`,
        [id, input.title, input.startedAt, Date.parse(input.startedAt), input.target, input.theirLanguage, input.suggestions ? 1 : 0, input.system ? 1 : 0, JSON.stringify(input.context)],
      );
      return repo.get(id) as Meeting;
    },

    get(id) {
      const row = db.get<Row>('SELECT * FROM meeting_meetings WHERE id = ?', [id]);
      return row ? toMeeting(row) : null;
    },

    update(id, patch) {
      const sets: string[] = [];
      const params: SqlValue[] = [];
      const set = (column: string, value: SqlValue) => {
        sets.push(`${column} = ?`);
        params.push(value);
      };
      if (patch.title !== undefined) set('title', patch.title);
      if (patch.state !== undefined) set('state', patch.state);
      if (patch.endedAt !== undefined) set('ended_at', patch.endedAt);
      if (patch.target !== undefined) set('target', patch.target);
      if (patch.theirLanguage !== undefined) set('their_language', patch.theirLanguage);
      if (patch.suggestions !== undefined) set('suggestions', patch.suggestions ? 1 : 0);
      if (patch.context !== undefined) set('context', JSON.stringify(patch.context));
      if (patch.summary !== undefined) set('summary', patch.summary === null ? null : JSON.stringify(patch.summary));
      if (patch.summaryProblem !== undefined) set('summary_problem', patch.summaryProblem);
      if (patch.summaryDetail !== undefined) set('summary_detail', patch.summaryDetail);
      if (patch.summaryDropped !== undefined) set('summary_dropped', patch.summaryDropped);
      if (patch.echoDropped !== undefined) set('echo_dropped', patch.echoDropped);
      if (sets.length > 0) db.run(`UPDATE meeting_meetings SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
      return repo.get(id);
    },

    list(limit) {
      return db
        .all<Row>(
          `SELECT m.id, m.title, m.state, m.started_at, m.ended_at, m.summary,
             (SELECT COUNT(*) FROM meeting_lines l WHERE l.meeting_id = m.id) AS line_count
           FROM meeting_meetings m ORDER BY m.started_ms DESC LIMIT ?`,
          [limit],
        )
        .map((row) => ({
          id: text(row.id),
          title: text(row.title),
          state: text(row.state) as MeetingState,
          startedAt: text(row.started_at),
          endedAt: nullable(row.ended_at),
          lineCount: Number(row.line_count),
          hasSummary: row.summary !== null && row.summary !== undefined,
          transcriptExpired: Number(row.line_count) === 0 && text(row.state) === 'ended',
        }));
    },

    ended(limit) {
      return db.all<Row>("SELECT * FROM meeting_meetings WHERE state != 'live' ORDER BY started_ms DESC LIMIT ?", [limit]).map(toMeeting);
    },

    unfinished() {
      return db.all<Row>("SELECT * FROM meeting_meetings WHERE state != 'ended' ORDER BY started_ms").map(toMeeting);
    },

    addLine(input) {
      const id = input.id ?? newId();
      const result = db.run(
        `INSERT INTO meeting_lines (id, meeting_id, speaker, text, started_at, ended_at, started_ms, lang, translation, translation_state)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
        [id, input.meetingId, input.speaker, input.text, input.startedAt, input.endedAt, Date.parse(input.startedAt), input.lang, input.translationState],
      );
      db.run('INSERT INTO meeting_lines_fts (rowid, norm) VALUES (?, ?)', [result.lastInsertRowid, foldForSearch(input.text)]);
      return repo.getLine(id) as MeetingLine;
    },

    lines(meetingId) {
      return db.all<Row>('SELECT * FROM meeting_lines WHERE meeting_id = ? ORDER BY started_ms, rid', [meetingId]).map(toLine);
    },

    getLine(id) {
      const row = db.get<Row>('SELECT * FROM meeting_lines WHERE id = ?', [id]);
      return row ? toLine(row) : null;
    },

    setTranslation(id, translation, state) {
      db.run('UPDATE meeting_lines SET translation = ?, translation_state = ? WHERE id = ?', [translation, state, id]);
      return repo.getLine(id);
    },

    deleteLines(ids) {
      if (ids.length === 0) return 0;
      return secureDelete(() => deleteLineRows(`id IN (${placeholders(ids.length)})`, ids));
    },

    searchLines(query, limit) {
      const match = ftsQuery(query, { any: true });
      if (!match) return [];
      return db
        .all<Row>(
          `SELECT l.* FROM meeting_lines_fts f JOIN meeting_lines l ON l.rid = f.rowid
           WHERE meeting_lines_fts MATCH ? ORDER BY bm25(meeting_lines_fts) LIMIT ?`,
          [match, limit],
        )
        .map(toLine);
    },

    addSuggestion(input) {
      const id = newId();
      const at = now();
      db.run(
        `INSERT INTO meeting_suggestions (id, meeting_id, line_id, question, state, reply, translation, created_at, created_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, input.meetingId, input.lineId, input.question, input.state, input.reply, input.translation, at.toISOString(), at.getTime()],
      );
      return toSuggestion(db.get<Row>('SELECT * FROM meeting_suggestions WHERE id = ?', [id]) as Row);
    },

    updateSuggestion(id, patch) {
      const sets: string[] = [];
      const params: SqlValue[] = [];
      if (patch.state !== undefined) {
        sets.push('state = ?');
        params.push(patch.state);
      }
      if (patch.reply !== undefined) {
        sets.push('reply = ?');
        params.push(patch.reply);
      }
      if (patch.translation !== undefined) {
        sets.push('translation = ?');
        params.push(patch.translation);
      }
      if (sets.length > 0) db.run(`UPDATE meeting_suggestions SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
      const row = db.get<Row>('SELECT * FROM meeting_suggestions WHERE id = ?', [id]);
      return row ? toSuggestion(row) : null;
    },

    suggestions(meetingId) {
      return db.all<Row>('SELECT * FROM meeting_suggestions WHERE meeting_id = ? ORDER BY created_ms', [meetingId]).map(toSuggestion);
    },

    retain(lineCutoff, meetingCutoff) {
      return secureDelete(() => {
        const lineMs = Date.parse(lineCutoff);
        const lines = deleteLineRows('started_ms < ?', [lineMs]);
        db.run('DELETE FROM meeting_suggestions WHERE created_ms < ?', [lineMs]);
        const old = db.all<{ id: string }>("SELECT id FROM meeting_meetings WHERE started_ms < ? AND state = 'ended'", [Date.parse(meetingCutoff)]);
        for (const { id } of old) {
          deleteLineRows('meeting_id = ?', [id]);
          db.run('DELETE FROM meeting_suggestions WHERE meeting_id = ?', [id]);
          db.run('DELETE FROM meeting_meetings WHERE id = ?', [id]);
        }
        return { lines, meetings: old.length };
      });
    },

    deleteMeeting(id) {
      secureDelete(() => {
        deleteLineRows('meeting_id = ?', [id]);
        db.run('DELETE FROM meeting_suggestions WHERE meeting_id = ?', [id]);
        db.run('DELETE FROM meeting_meetings WHERE id = ?', [id]);
      });
    },

    deleteAll() {
      secureDelete(() => {
        db.run('DELETE FROM meeting_lines_fts');
        db.run('DELETE FROM meeting_lines');
        db.run('DELETE FROM meeting_suggestions');
        db.run('DELETE FROM meeting_meetings');
      });
    },

    getState<T>(key: string) {
      const row = db.get<{ value: string }>('SELECT value FROM meeting_state WHERE key = ?', [key]);
      return row ? json<T | null>(row.value, null) : null;
    },

    setState(key, value) {
      db.run('INSERT INTO meeting_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, JSON.stringify(value)]);
    },
  };
  return repo;
}
