// Projeler modülünün tabloları: projeler, Claude Code oturumları, iletiler ve FTS5 dizini.
import {
  FTS_TOKENIZER,
  foldForSearch,
  ftsQuery,
  makeSnippet,
  newId,
  nowIso,
  type Migration,
  type ScopedDb,
} from '@fuber/shared';
import { emptyAcc, sessionTitle, type NewMessage, type SessionAcc } from './jsonl';
import type { ScannedProject } from './scanner';
import type { ProjectDetail, ProjectSource, SessionHitDetail, SessionMessage, SessionQuery, SessionRow } from './types';

export const PROJECTS_MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'projeler, oturumlar, iletiler, FTS',
    up: `
      CREATE TABLE projects_projects (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL UNIQUE COLLATE NOCASE,
        name TEXT NOT NULL,
        stack TEXT NOT NULL DEFAULT '[]',
        description TEXT NOT NULL DEFAULT '',
        category TEXT,
        pinned INTEGER NOT NULL DEFAULT 0,
        aliases TEXT NOT NULL DEFAULT '[]',
        git_branch TEXT,
        modified_at TEXT NOT NULL,
        last_opened_at TEXT,
        source TEXT NOT NULL DEFAULT 'scan',
        seen_at TEXT
      );
      CREATE TABLE projects_sessions (
        id TEXT PRIMARY KEY,
        file_path TEXT NOT NULL,
        cwd TEXT NOT NULL DEFAULT '',
        project_id TEXT,
        ai_title TEXT,
        custom_title TEXT,
        summary_title TEXT,
        user_title TEXT,
        first_prompt TEXT,
        title TEXT NOT NULL DEFAULT '',
        category TEXT,
        pinned INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0,
        git_branch TEXT,
        started_at TEXT,
        last_at TEXT,
        message_count INTEGER NOT NULL DEFAULT 0,
        last_role TEXT,
        last_stop TEXT,
        last_conv_at TEXT,
        notified_at TEXT,
        file_offset INTEGER NOT NULL DEFAULT 0,
        file_size INTEGER NOT NULL DEFAULT 0,
        file_head TEXT,
        file_mtime REAL NOT NULL DEFAULT 0,
        bad_lines INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX projects_sessions_last ON projects_sessions(last_at DESC);
      CREATE INDEX projects_sessions_project ON projects_sessions(project_id);
      CREATE TABLE projects_messages (
        id INTEGER PRIMARY KEY,
        session_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        role TEXT NOT NULL,
        at TEXT,
        text TEXT NOT NULL
      );
      CREATE INDEX projects_messages_session ON projects_messages(session_id, seq);
      CREATE VIRTUAL TABLE projects_msg_fts USING fts5(norm, tokenize = "${FTS_TOKENIZER}");
      CREATE VIRTUAL TABLE projects_title_fts USING fts5(norm, tokenize = "${FTS_TOKENIZER}");
      CREATE TABLE projects_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `,
  },
];

interface ProjectRowDb {
  id: string;
  path: string;
  name: string;
  stack: string;
  description: string;
  category: string | null;
  pinned: number;
  aliases: string;
  git_branch: string | null;
  modified_at: string;
  last_opened_at: string | null;
  source: string;
  session_count?: number;
  last_session_at?: string | null;
}

interface SessionRowDb {
  rowid: number;
  id: string;
  file_path: string;
  cwd: string;
  project_id: string | null;
  project_name?: string | null;
  ai_title: string | null;
  custom_title: string | null;
  summary_title: string | null;
  user_title: string | null;
  first_prompt: string | null;
  title: string;
  category: string | null;
  pinned: number;
  archived: number;
  git_branch: string | null;
  started_at: string | null;
  last_at: string | null;
  message_count: number;
  last_role: string | null;
  last_stop: string | null;
  last_conv_at: string | null;
  notified_at: string | null;
  file_offset: number;
  file_size: number;
  file_head: string | null;
  file_mtime: number;
  bad_lines: number;
}

export type FileState = Pick<SessionRowDb, 'id' | 'file_path' | 'file_offset' | 'file_size' | 'file_head' | 'file_mtime'>;

export class ProjectsError extends Error {}

const parseList = (raw: string): string[] => {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
};

function toProject(row: ProjectRowDb): ProjectDetail {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    stack: parseList(row.stack),
    description: row.description,
    category: row.category,
    pinned: row.pinned === 1,
    modifiedAt: row.modified_at,
    sessionCount: row.session_count ?? 0,
    lastSessionAt: row.last_session_at ?? null,
    aliases: parseList(row.aliases),
    gitBranch: row.git_branch,
    lastOpenedAt: row.last_opened_at,
    source: row.source === 'claude' ? 'claude' : 'scan',
  };
}

function toSession(row: SessionRowDb): SessionRow {
  return {
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name ?? null,
    cwd: row.cwd,
    title: row.title || row.id.slice(0, 8),
    category: row.category,
    pinned: row.pinned === 1,
    archived: row.archived === 1,
    preview: row.first_prompt,
    gitBranch: row.git_branch,
    startedAt: row.started_at ?? row.last_at ?? '',
    lastAt: row.last_at ?? row.started_at ?? '',
    messageCount: row.message_count,
    filePath: row.file_path,
  };
}

function accOf(row: SessionRowDb | undefined): SessionAcc {
  if (!row) return emptyAcc();
  return {
    cwd: row.cwd,
    gitBranch: row.git_branch,
    aiTitle: row.ai_title,
    customTitle: row.custom_title,
    summaryTitle: row.summary_title,
    firstPrompt: row.first_prompt,
    startedAt: row.started_at,
    lastAt: row.last_at,
    messageCount: row.message_count,
    lastRole: row.last_role === 'user' || row.last_role === 'assistant' ? row.last_role : null,
    lastStop: row.last_stop,
    lastConvAt: row.last_conv_at,
    badLines: row.bad_lines,
  };
}

const PROJECT_SELECT = `
  SELECT p.*, (SELECT COUNT(*) FROM projects_sessions s WHERE s.project_id = p.id AND s.archived = 0) AS session_count,
         (SELECT MAX(s.last_at) FROM projects_sessions s WHERE s.project_id = p.id) AS last_session_at
  FROM projects_projects p`;

const SESSION_SELECT = `
  SELECT s.rowid AS rowid, s.*, p.name AS project_name
  FROM projects_sessions s LEFT JOIN projects_projects p ON p.id = s.project_id`;

export function createProjectsRepo(db: ScopedDb) {
  const sessionRow = (id: string) => db.get<SessionRowDb>(`${SESSION_SELECT} WHERE s.id = ?`, [id]);

  const setTitleIndex = (rowid: number, title: string) => {
    db.run('DELETE FROM projects_title_fts WHERE rowid = ?', [rowid]);
    if (title) db.run('INSERT INTO projects_title_fts (rowid, norm) VALUES (?, ?)', [rowid, foldForSearch(title)]);
  };

  const refreshTitle = (id: string) => {
    const row = sessionRow(id);
    if (!row) return;
    const title = sessionTitle(accOf(row), row.user_title);
    if (title !== row.title) {
      db.run('UPDATE projects_sessions SET title = ? WHERE id = ?', [title, id]);
    }
    setTitleIndex(row.rowid, title);
  };

  return {
    kvGet<T>(key: string): T | undefined {
      const row = db.get<{ value: string }>('SELECT value FROM projects_kv WHERE key = ?', [key]);
      if (!row) return undefined;
      try {
        return JSON.parse(row.value) as T;
      } catch {
        return undefined;
      }
    },
    kvSet(key: string, value: unknown): void {
      db.run('INSERT INTO projects_kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, JSON.stringify(value)]);
    },

    // ───────── projeler ─────────
    listProjects(): ProjectDetail[] {
      return db
        .all<ProjectRowDb>(`${PROJECT_SELECT} ORDER BY p.pinned DESC, COALESCE(p.last_opened_at, '') DESC, p.modified_at DESC`)
        .map(toProject);
    },
    getProject(id: string): ProjectDetail {
      const row = db.get<ProjectRowDb>(`${PROJECT_SELECT} WHERE p.id = ?`, [id]);
      if (!row) throw new ProjectsError('Proje bulunamadı.');
      return toProject(row);
    },
    /** Tarama sonucunu yazar. `source` kaynağından olup bu taramada görülmeyen ve kullanıcı verisi olmayan kayıtlar silinir. */
    syncScanned(scanned: ScannedProject[], source: ProjectSource): { added: number; removed: number } {
      const stamp = nowIso();
      let added = 0;
      let removed = 0;
      db.transaction(() => {
        for (const project of scanned) {
          const existing = db.get<{ id: string; source: string }>('SELECT id, source FROM projects_projects WHERE path = ?', [project.path]);
          if (existing) {
            // Taramada da bulunan klasör "scan" kaynağına yükselir; "claude" kaynağı taramayı ezmez.
            const nextSource = existing.source === 'scan' || source === 'scan' ? 'scan' : 'claude';
            db.run(
              'UPDATE projects_projects SET name = ?, stack = ?, git_branch = ?, modified_at = ?, source = ?, seen_at = ? WHERE id = ?',
              [project.name, JSON.stringify(project.stack), project.gitBranch, project.modifiedAt, nextSource, stamp, existing.id],
            );
          } else {
            db.run(
              'INSERT INTO projects_projects (id, path, name, stack, git_branch, modified_at, source, seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
              [newId(), project.path, project.name, JSON.stringify(project.stack), project.gitBranch, project.modifiedAt, source, stamp],
            );
            added++;
          }
        }
        const stale = db.all<{ id: string }>(
          `SELECT id FROM projects_projects WHERE source = ? AND (seen_at IS NULL OR seen_at <> ?)
             AND pinned = 0 AND category IS NULL AND description = '' AND aliases = '[]'`,
          [source, stamp],
        );
        for (const { id } of stale) {
          db.run('DELETE FROM projects_projects WHERE id = ?', [id]);
          db.run('UPDATE projects_sessions SET project_id = NULL WHERE project_id = ?', [id]);
          removed++;
        }
      });
      return { added, removed };
    },
    updateProject(id: string, patch: { pinned?: boolean; category?: string | null; description?: string }): ProjectDetail {
      this.getProject(id);
      if (patch.pinned !== undefined) db.run('UPDATE projects_projects SET pinned = ? WHERE id = ?', [patch.pinned ? 1 : 0, id]);
      if (patch.category !== undefined) db.run('UPDATE projects_projects SET category = ? WHERE id = ?', [normCategory(patch.category), id]);
      if (patch.description !== undefined) db.run('UPDATE projects_projects SET description = ? WHERE id = ?', [patch.description.trim(), id]);
      return this.getProject(id);
    },
    setAliases(id: string, aliases: string[]): ProjectDetail {
      this.getProject(id);
      const clean = [...new Set(aliases.map((alias) => alias.trim()).filter(Boolean))].slice(0, 20);
      db.run('UPDATE projects_projects SET aliases = ? WHERE id = ?', [JSON.stringify(clean), id]);
      return this.getProject(id);
    },
    markOpened(id: string): void {
      db.run('UPDATE projects_projects SET last_opened_at = ? WHERE id = ?', [nowIso(), id]);
    },
    /** Oturumları en uzun ön ekle eşleşen projeye bağlar. */
    relinkSessions(match: (cwd: string) => string | null): void {
      db.transaction(() => {
        for (const row of db.all<{ id: string; cwd: string; project_id: string | null }>('SELECT id, cwd, project_id FROM projects_sessions')) {
          const projectId = row.cwd ? match(row.cwd) : null;
          if (projectId !== row.project_id) db.run('UPDATE projects_sessions SET project_id = ? WHERE id = ?', [projectId, row.id]);
        }
      });
    },
    sessionCwds(): string[] {
      return db.all<{ cwd: string }>(`SELECT DISTINCT cwd FROM projects_sessions WHERE cwd <> ''`).map((row) => row.cwd);
    },

    // ───────── oturum dosyaları ─────────
    fileStates(): FileState[] {
      return db.all<FileState>('SELECT id, file_path, file_offset, file_size, file_head, file_mtime FROM projects_sessions');
    },
    acc(id: string): SessionAcc {
      return accOf(sessionRow(id));
    },
    /** Dosya yeniden yazıldı: iletileri ve dizini sil, birikimi sıfırla (kullanıcı verisi kalır). */
    resetSession(id: string): void {
      db.transaction(() => {
        db.run('DELETE FROM projects_msg_fts WHERE rowid IN (SELECT id FROM projects_messages WHERE session_id = ?)', [id]);
        db.run('DELETE FROM projects_messages WHERE session_id = ?', [id]);
        const empty = emptyAcc();
        db.run(
          `UPDATE projects_sessions SET ai_title = NULL, custom_title = NULL, summary_title = NULL, first_prompt = NULL,
             started_at = NULL, last_at = NULL, message_count = 0, last_role = NULL, last_stop = NULL, last_conv_at = NULL,
             bad_lines = 0, file_offset = 0, cwd = ? WHERE id = ?`,
          [empty.cwd, id],
        );
      });
    },
    /**
     * Bir parçanın sonucunu TEK işlemde yazar: yeni iletiler + birikim + dosya konumu. Uygulama arada
     * kapanırsa konum ile iletiler tutarlı kalır (aynı satır iki kez dizine girmez).
     */
    commitChunk(
      id: string,
      filePath: string,
      acc: SessionAcc,
      messages: NewMessage[],
      file: { offset: number; size: number; head: string | null; mtimeMs: number },
      projectId: string | null,
    ): void {
      db.transaction(() => {
        const existing = db.get<{ message_count: number; user_title: string | null }>(
          'SELECT message_count, user_title FROM projects_sessions WHERE id = ?',
          [id],
        );
        if (!existing) {
          db.run('INSERT INTO projects_sessions (id, file_path) VALUES (?, ?)', [id, filePath]);
        }
        const baseSeq = (db.get<{ n: number | null }>('SELECT MAX(seq) AS n FROM projects_messages WHERE session_id = ?', [id])?.n ?? -1) + 1;
        messages.forEach((message, index) => {
          const { lastInsertRowid } = db.run('INSERT INTO projects_messages (session_id, seq, role, at, text) VALUES (?, ?, ?, ?, ?)', [
            id,
            baseSeq + index,
            message.role,
            message.at,
            message.text,
          ]);
          db.run('INSERT INTO projects_msg_fts (rowid, norm) VALUES (?, ?)', [lastInsertRowid, foldForSearch(message.text)]);
        });
        const title = sessionTitle(acc, existing?.user_title ?? null);
        db.run(
          `UPDATE projects_sessions SET file_path = ?, cwd = ?, project_id = COALESCE(project_id, ?), ai_title = ?, custom_title = ?,
             summary_title = ?, first_prompt = ?, title = ?, git_branch = ?, started_at = ?, last_at = ?, message_count = ?,
             last_role = ?, last_stop = ?, last_conv_at = ?, bad_lines = ?, file_offset = ?, file_size = ?, file_head = ?, file_mtime = ?
           WHERE id = ?`,
          [
            filePath,
            acc.cwd,
            projectId,
            acc.aiTitle,
            acc.customTitle,
            acc.summaryTitle,
            acc.firstPrompt,
            title,
            acc.gitBranch,
            acc.startedAt,
            acc.lastAt,
            acc.messageCount,
            acc.lastRole,
            acc.lastStop,
            acc.lastConvAt,
            acc.badLines,
            file.offset,
            file.size,
            file.head,
            file.mtimeMs,
            id,
          ],
        );
        const rowid = db.get<{ rowid: number }>('SELECT rowid FROM projects_sessions WHERE id = ?', [id])!.rowid;
        setTitleIndex(rowid, title);
      });
    },
    /** Diskten silinen oturum dosyası: kullanıcı verisi yoksa kayıt da silinir. */
    removeMissing(ids: string[]): number {
      let removed = 0;
      db.transaction(() => {
        for (const id of ids) {
          const row = db.get<{ rowid: number; pinned: number; category: string | null; user_title: string | null }>(
            'SELECT rowid, pinned, category, user_title FROM projects_sessions WHERE id = ?',
            [id],
          );
          if (!row || row.pinned || row.category || row.user_title) continue;
          db.run('DELETE FROM projects_msg_fts WHERE rowid IN (SELECT id FROM projects_messages WHERE session_id = ?)', [id]);
          db.run('DELETE FROM projects_messages WHERE session_id = ?', [id]);
          db.run('DELETE FROM projects_title_fts WHERE rowid = ?', [row.rowid]);
          db.run('DELETE FROM projects_sessions WHERE id = ?', [id]);
          removed++;
        }
      });
      return removed;
    },
    /** Kaynak klasör değişti: bütün oturum dizinini boşalt (sabit/kategori dahil; başka kasanın oturumlarıdır). */
    clearSessions(): void {
      db.transaction(() => {
        db.exec('DELETE FROM projects_msg_fts; DELETE FROM projects_title_fts; DELETE FROM projects_messages; DELETE FROM projects_sessions;');
      });
    },
    counts(): { sessions: number; messages: number } {
      return {
        sessions: db.get<{ n: number }>('SELECT COUNT(*) AS n FROM projects_sessions')!.n,
        messages: db.get<{ n: number }>('SELECT COUNT(*) AS n FROM projects_messages')!.n,
      };
    },

    // ───────── oturum sorguları ─────────
    getSession(id: string): SessionRow {
      const row = sessionRow(id);
      if (!row) throw new ProjectsError('Oturum bulunamadı.');
      return toSession(row);
    },
    updateSession(id: string, patch: { pinned?: boolean; category?: string | null; title?: string; archived?: boolean }): SessionRow {
      this.getSession(id);
      if (patch.pinned !== undefined) db.run('UPDATE projects_sessions SET pinned = ? WHERE id = ?', [patch.pinned ? 1 : 0, id]);
      if (patch.archived !== undefined) db.run('UPDATE projects_sessions SET archived = ? WHERE id = ?', [patch.archived ? 1 : 0, id]);
      if (patch.category !== undefined) db.run('UPDATE projects_sessions SET category = ? WHERE id = ?', [normCategory(patch.category), id]);
      if (patch.title !== undefined) {
        const title = patch.title.trim();
        db.run('UPDATE projects_sessions SET user_title = ? WHERE id = ?', [title || null, id]);
        refreshTitle(id);
      }
      return this.getSession(id);
    },
    listSessions(query: SessionQuery): { items: SessionRow[]; total: number } {
      const { where, params } = sessionFilter(query);
      const total = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM projects_sessions s ${where}`, params)!.n;
      const rows = db.all<SessionRowDb>(
        `${SESSION_SELECT} ${where} ORDER BY s.pinned DESC, COALESCE(s.last_at, '') DESC LIMIT ? OFFSET ?`,
        [...params, query.limit, query.offset ?? 0],
      );
      return { items: rows.map(toSession), total };
    },
    /**
     * Tam metin arama: kullanıcı ve asistan metni + başlık. Sonuç ALAKA sırasıyla döner (bm25; düşük daha iyi),
     * tarihe göre yeniden sıralanmaz. Süzgeçler sıralamayı değiştirmeden uygulanır.
     */
    searchSessions(query: SessionQuery & { query: string }): { hits: SessionHitDetail[]; total: number } {
      const match = ftsQuery(query.query);
      if (!match) return { hits: [], total: 0 };
      const best = new Map<string, { score: number; messageId: number | null }>();
      // İç sorgu LIMIT taşır ki SQLite onu dış toplamayla birleştirmesin (bm25 yalnız MATCH bağlamında çalışır).
      const messageHits = db.all<{ sid: string; score: number; mid: number }>(
        `SELECT sid, MIN(score) AS score, mid FROM (
           SELECT m.session_id AS sid, bm25(projects_msg_fts) AS score, m.id AS mid
           FROM projects_msg_fts JOIN projects_messages m ON m.id = projects_msg_fts.rowid
           WHERE projects_msg_fts MATCH ? ORDER BY score LIMIT 20000
         ) GROUP BY sid`,
        [match],
      );
      for (const hit of messageHits) best.set(hit.sid, { score: hit.score, messageId: hit.mid });
      const titleHits = db.all<{ sid: string; score: number }>(
        `SELECT s.id AS sid, bm25(projects_title_fts) AS score
         FROM projects_title_fts JOIN projects_sessions s ON s.rowid = projects_title_fts.rowid
         WHERE projects_title_fts MATCH ? ORDER BY score LIMIT 2000`,
        [match],
      );
      for (const hit of titleHits) {
        // Başlık eşleşmesi daha güçlü işarettir: puanı iki kat (bm25 negatif; daha küçük = daha iyi).
        const score = hit.score * 2;
        const current = best.get(hit.sid);
        if (!current) best.set(hit.sid, { score, messageId: null });
        else if (score < current.score) best.set(hit.sid, { score, messageId: current.messageId });
      }
      const ordered = [...best.entries()].sort((a, b) => a[1].score - b[1].score);
      const { where, params } = sessionFilter(query, 's');
      const allowed = new Set(
        db.all<{ id: string }>(`SELECT s.id FROM projects_sessions s ${where}`, params).map((row) => row.id),
      );
      const filtered = ordered.filter(([sid]) => allowed.has(sid));
      const page = filtered.slice(query.offset ?? 0, (query.offset ?? 0) + query.limit);
      const hits: SessionHitDetail[] = [];
      for (const [sid, { score, messageId }] of page) {
        const row = sessionRow(sid);
        if (!row) continue;
        const session = toSession(row);
        let snippet = makeSnippet(session.title, query.query, 60);
        let matchSeq: number | null = null;
        if (messageId !== null) {
          const message = db.get<{ seq: number; text: string }>('SELECT seq, text FROM projects_messages WHERE id = ?', [messageId]);
          if (message) {
            snippet = makeSnippet(message.text, query.query, 70);
            matchSeq = message.seq;
          }
        }
        hits.push({ session, snippet, score: -score, matchSeq });
      }
      return { hits, total: filtered.length };
    },
    /** Sayfalı iletiler. `around` verilirse o iletinin çevresi (eşleşen iletiye kaydırma). */
    sessionMessages(id: string, options: { around?: number; offset?: number; limit: number }): { total: number; offset: number; messages: SessionMessage[] } {
      this.getSession(id);
      const total = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM projects_messages WHERE session_id = ?', [id])!.n;
      let offset = options.offset ?? Math.max(0, total - options.limit);
      if (options.around !== undefined) {
        const position = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM projects_messages WHERE session_id = ? AND seq < ?', [id, options.around])!.n;
        offset = Math.max(0, Math.min(position - Math.floor(options.limit / 3), Math.max(0, total - options.limit)));
      }
      const messages = db
        .all<{ seq: number; role: string; at: string | null; text: string }>(
          'SELECT seq, role, at, text FROM projects_messages WHERE session_id = ? ORDER BY seq LIMIT ? OFFSET ?',
          [id, options.limit, offset],
        )
        .map((row) => ({ seq: row.seq, role: row.role === 'assistant' ? ('assistant' as const) : ('user' as const), at: row.at ?? '', text: row.text }));
      return { total, offset, messages };
    },
    categories(): string[] {
      return db
        .all<{ c: string }>(
          `SELECT category AS c FROM projects_sessions WHERE category IS NOT NULL
           UNION SELECT category AS c FROM projects_projects WHERE category IS NOT NULL ORDER BY c COLLATE NOCASE`,
        )
        .map((row) => row.c);
    },

    // ───────── bitiş bildirimi ─────────
    finishCandidates(sinceIso: string): Array<{ id: string; title: string; cwd: string; projectName: string | null; lastConvAt: string; fileMtime: number }> {
      return db
        .all<{ id: string; title: string; cwd: string; project_name: string | null; last_conv_at: string; file_mtime: number }>(
          `SELECT s.id, s.title, s.cwd, p.name AS project_name, s.last_conv_at, s.file_mtime
           FROM projects_sessions s LEFT JOIN projects_projects p ON p.id = s.project_id
           WHERE s.last_role = 'assistant' AND s.last_stop = 'end_turn' AND s.last_conv_at >= ?
             AND (s.notified_at IS NULL OR s.notified_at <> s.last_conv_at)`,
          [sinceIso],
        )
        .map((row) => ({ id: row.id, title: row.title, cwd: row.cwd, projectName: row.project_name, lastConvAt: row.last_conv_at, fileMtime: row.file_mtime }));
    },
    /** Oturumun son asistan METNİ (dizindeki ileti; araç çıktısı ve dosya içeriği dizine girmez). Bitiş duyurusunun sonucu. */
    lastAssistantText(id: string): string {
      return db.get<{ text: string }>(`SELECT text FROM projects_messages WHERE session_id = ? AND role = 'assistant' ORDER BY seq DESC LIMIT 1`, [id])?.text ?? '';
    },
    markNotified(id: string, lastConvAt: string): void {
      db.run('UPDATE projects_sessions SET notified_at = ? WHERE id = ?', [lastConvAt, id]);
    },
    /** İlk dizinlemede bitmiş turlar "görüldü" sayılır: uygulama açılınca eski oturumlar için bildirim yağmaz. */
    baselineNotified(): void {
      db.run(`UPDATE projects_sessions SET notified_at = last_conv_at WHERE last_stop = 'end_turn'`);
    },
  };
}

export type ProjectsRepo = ReturnType<typeof createProjectsRepo>;

function normCategory(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 40) : null;
}

function sessionFilter(query: SessionQuery, alias = 's'): { where: string; params: Array<string | number> } {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (!query.includeArchived) clauses.push(`${alias}.archived = 0`);
  if (query.projectId) {
    clauses.push(`${alias}.project_id = ?`);
    params.push(query.projectId);
  }
  if (query.category) {
    clauses.push(`${alias}.category = ?`);
    params.push(query.category);
  }
  if (query.pinnedOnly) clauses.push(`${alias}.pinned = 1`);
  if (query.since) {
    clauses.push(`${alias}.last_at >= ?`);
    params.push(query.since);
  }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}
