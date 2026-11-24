// Sahibi: T2. Hafıza: olay/bilgi/söz katmanları, köken, güven; Türkçeye duyarlı FTS5 arama (KURGU §7).
import {
  foldForSearch,
  FTS_TOKENIZER,
  makeSnippet,
  newId,
  nowIso,
  searchTerms,
  type Id,
  type MemoryApi,
  type MemoryItem,
  type MemoryKind,
  type MemorySaveInput,
  type MemorySearchHit,
  type Migration,
  type ScopedDb,
  type ServiceDeps,
  type SqlValue,
} from '@fuber/shared';

const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'hafıza kayıtları ve arama dizini',
    up: `CREATE TABLE memory_items (
      rid INTEGER PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      text TEXT NOT NULL,
      subject TEXT,
      tags TEXT NOT NULL,
      source TEXT NOT NULL,
      at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      confidence REAL NOT NULL,
      importance REAL NOT NULL,
      pinned INTEGER NOT NULL,
      status TEXT NOT NULL,
      superseded_by TEXT,
      session_id TEXT,
      reminder_id TEXT
    );
    CREATE INDEX memory_items_kind ON memory_items (kind, status);
    CREATE VIRTUAL TABLE memory_fts USING fts5(norm, tokenize = "${FTS_TOKENIZER}");`,
  },
];

interface Row {
  rid: number;
  id: string;
  kind: string;
  text: string;
  subject: string | null;
  tags: string;
  source: string;
  at: string;
  updated_at: string;
  confidence: number;
  importance: number;
  pinned: number;
  status: string;
  superseded_by: string | null;
  session_id: string | null;
  reminder_id: string | null;
}

function toItem(row: Row): MemoryItem {
  return {
    id: row.id,
    kind: row.kind as MemoryKind,
    text: row.text,
    subject: row.subject,
    tags: JSON.parse(row.tags) as string[],
    source: row.source as MemoryItem['source'],
    at: row.at,
    updatedAt: row.updated_at,
    confidence: row.confidence,
    importance: row.importance,
    pinned: row.pinned === 1,
    status: row.status as MemoryItem['status'],
    supersededBy: row.superseded_by,
    sessionId: row.session_id,
    reminderId: row.reminder_id,
  };
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Aramada yalnız gürültü yapan sözcükler (katlanmış biçimde). */
const STOP_WORDS = new Set(
  [
    've', 'veya', 'ile', 'bir', 'bu', 'su', 'o', 'ne', 'mi', 'mu', 'de', 'da', 'ki', 'icin', 'gibi', 'ama',
    'benim', 'bana', 'beni', 'sen', 'ben', 'biz', 'siz', 'onu', 'nedir', 'neydi', 'nerede', 'hangi', 'kim',
    'mi', 'misin', 'musun', 'var', 'yok', 'olan', 'olarak', 'daha', 'en', 'cok', 'hatirla', 'hatirliyor',
    'musun', 'soyle', 'sence', 'acaba', 'the', 'a', 'an', 'of', 'is',
  ].map(foldForSearch),
);

/**
 * Serbest metinden FTS5 sorgusu: her sözcük önek olarak aranır ve sözcükler VEYA ile bağlanır; uzun sözcük
 * kısaltılır ki Türkçe ekler eşleşmeyi bozmasın ("beyannamesini" → "beyann*", "şirketimin" → "sirket*").
 * Sıralama bm25'e kalır; çok sözcüklü sorguda VE, doğal cümlelerde neredeyse hiç sonuç vermiyor.
 */
export function memoryFtsQuery(text: string): string | null {
  const terms = [...new Set(searchTerms(text))].filter((term) => !STOP_WORDS.has(term));
  const usable = terms.filter((term) => term.length >= 2 || /\d/.test(term));
  if (usable.length === 0) return null;
  return usable.map((term) => `"${term.length > 6 ? term.slice(0, 6) : term}" *`).join(' OR ');
}

function indexText(item: Pick<MemoryItem, 'text' | 'subject' | 'tags'>): string {
  return foldForSearch([item.text, item.subject ?? '', ...item.tags].join(' '));
}

export function createMemory(deps: ServiceDeps['memory']): MemoryApi {
  const db: ScopedDb = deps.store.scoped('memory');
  let ready = false;
  const ensure = () => {
    if (ready) return;
    deps.store.migrate('memory', MIGRATIONS);
    ready = true;
  };

  const rowById = (id: Id) => db.get<Row>('SELECT * FROM memory_items WHERE id = ?', [id]);

  const reindex = (row: Row) => {
    db.run('DELETE FROM memory_fts WHERE rowid = ?', [row.rid]);
    const item = toItem(row);
    db.run('INSERT INTO memory_fts (rowid, norm) VALUES (?, ?)', [row.rid, indexText(item)]);
  };

  /** İçe aktarılan kaydın kendi "son değişme" anı; geçersizse ya da gelecekteyse şimdi. */
  const updatedAtOf = (given: string | undefined, now: string): string => {
    if (!given) return now;
    const at = Date.parse(given);
    return Number.isNaN(at) || at > Date.parse(now) ? now : given;
  };

  const insert = (input: MemorySaveInput): MemoryItem => {
    const now = nowIso();
    const id = newId();
    const userSaid = input.source === 'user';
    db.run(
      `INSERT INTO memory_items (id, kind, text, subject, tags, source, at, updated_at, confidence, importance, pinned,
         status, superseded_by, session_id, reminder_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NULL, ?, ?)`,
      [
        id,
        input.kind,
        input.text.trim(),
        input.subject?.trim() || null,
        JSON.stringify(input.tags ?? []),
        input.source,
        input.at ?? now,
        updatedAtOf(input.updatedAt, now),
        clamp01(input.confidence ?? (userSaid ? 1 : 0.8)),
        clamp01(input.importance ?? 0.5),
        input.pinned ? 1 : 0,
        input.sessionId ?? null,
        input.reminderId ?? null,
      ],
    );
    const row = rowById(id)!;
    reindex(row);
    return toItem(row);
  };

  const api: MemoryApi = {
    save(input) {
      ensure();
      const item = db.transaction(() => insert(input));
      deps.bus.emit('memory.changed', { op: 'created', ids: [item.id], kind: item.kind });
      return item;
    },

    update(id, patch) {
      ensure();
      const current = rowById(id);
      if (!current) return null;
      const sets: string[] = [];
      const values: SqlValue[] = [];
      const set = (column: string, value: SqlValue) => {
        sets.push(`${column} = ?`);
        values.push(value);
      };
      if (patch.text !== undefined) set('text', patch.text.trim());
      if (patch.subject !== undefined) set('subject', patch.subject?.trim() || null);
      if (patch.tags !== undefined) set('tags', JSON.stringify(patch.tags));
      if (patch.confidence !== undefined) set('confidence', clamp01(patch.confidence));
      if (patch.importance !== undefined) set('importance', clamp01(patch.importance));
      if (patch.pinned !== undefined) set('pinned', patch.pinned ? 1 : 0);
      if (patch.kind !== undefined) set('kind', patch.kind);
      if (patch.reminderId !== undefined) set('reminder_id', patch.reminderId);
      set('updated_at', nowIso());
      const row = db.transaction(() => {
        db.run(`UPDATE memory_items SET ${sets.join(', ')} WHERE id = ?`, [...values, id]);
        const updated = rowById(id)!;
        reindex(updated);
        return updated;
      });
      const item = toItem(row);
      deps.bus.emit('memory.changed', { op: 'updated', ids: [id], kind: item.kind });
      return item;
    },

    supersede(oldId, replacement) {
      ensure();
      const item = db.transaction(() => {
        const created = insert(replacement);
        db.run(`UPDATE memory_items SET status = 'superseded', superseded_by = ?, updated_at = ? WHERE id = ?`, [
          created.id,
          nowIso(),
          oldId,
        ]);
        return created;
      });
      const old = rowById(oldId);
      deps.bus.emit('memory.changed', { op: 'superseded', ids: [oldId], kind: (old?.kind as MemoryKind) ?? item.kind });
      deps.bus.emit('memory.changed', { op: 'created', ids: [item.id], kind: item.kind });
      return item;
    },

    forget(id) {
      ensure();
      const row = rowById(id);
      if (!row) return false;
      db.transaction(() => {
        db.run('DELETE FROM memory_fts WHERE rowid = ?', [row.rid]);
        db.run('DELETE FROM memory_items WHERE rid = ?', [row.rid]);
        // Bu kaydın yerini aldığı eski kayıtlar da aynı bilginin eski hâlidir; "unut" onları da kapsar.
        const older = db.all<{ rid: number }>('SELECT rid FROM memory_items WHERE superseded_by = ?', [id]);
        for (const { rid } of older) {
          db.run('DELETE FROM memory_fts WHERE rowid = ?', [rid]);
          db.run('DELETE FROM memory_items WHERE rid = ?', [rid]);
        }
      });
      deps.bus.emit('memory.changed', { op: 'deleted', ids: [id], kind: row.kind as MemoryKind });
      return true;
    },

    get(id) {
      ensure();
      const row = rowById(id);
      return row ? toItem(row) : null;
    },

    search(query) {
      ensure();
      const match = memoryFtsQuery(query.text);
      if (!match) return [];
      const limit = query.limit ?? 8;
      const conditions = ['memory_fts MATCH ?'];
      const params: SqlValue[] = [match];
      if (!query.includeSuperseded) conditions.push(`m.status = 'active'`);
      if (query.kinds?.length) {
        conditions.push(`m.kind IN (${query.kinds.map(() => '?').join(', ')})`);
        params.push(...query.kinds);
      }
      const rows = db.all<Row & { rank: number }>(
        `SELECT m.*, bm25(memory_fts) AS rank FROM memory_fts JOIN memory_items m ON m.rid = memory_fts.rowid
          WHERE ${conditions.join(' AND ')} ORDER BY rank LIMIT 60`,
        params,
      );
      if (rows.length === 0) return [];
      // bm25 küçükse daha iyi; en iyiye göre 0–1'e çekip güncellik ve önemle harmanlanır.
      const best = Math.max(...rows.map((row) => -row.rank), 1e-9);
      const now = Date.now();
      const hits: MemorySearchHit[] = rows.map((row) => {
        const item = toItem(row);
        const relevance = clamp01(-row.rank / best);
        const ageDays = Math.max(0, (now - Date.parse(item.updatedAt)) / 86_400_000);
        const recency = Math.exp(-ageDays / 30);
        const score =
          0.6 * relevance + 0.2 * item.importance + 0.1 * recency + 0.05 * item.confidence + (item.pinned ? 0.05 : 0);
        return { item, score, snippet: makeSnippet(item.text, query.text) };
      });
      return hits.sort((a, b) => b.score - a.score).slice(0, limit);
    },

    list(filter) {
      ensure();
      const conditions: string[] = [];
      const params: SqlValue[] = [];
      if (filter.kind) {
        conditions.push('kind = ?');
        params.push(filter.kind);
      }
      if (filter.pinnedOnly) conditions.push('pinned = 1');
      if (!filter.includeSuperseded) conditions.push(`status = 'active'`);
      if (filter.subject) {
        conditions.push('subject = ?');
        params.push(filter.subject);
      }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      return db
        .all<Row>(`SELECT * FROM memory_items ${where} ORDER BY updated_at DESC, rid DESC LIMIT ? OFFSET ?`, [
          ...params,
          filter.limit,
          filter.offset ?? 0,
        ])
        .map(toItem);
    },

    stats() {
      ensure();
      const counts = db.all<{ kind: string; n: number }>(
        `SELECT kind, COUNT(*) AS n FROM memory_items WHERE status = 'active' GROUP BY kind`,
      );
      const count = (kind: MemoryKind) => counts.find((row) => row.kind === kind)?.n ?? 0;
      let messages = 0;
      try {
        messages = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM conversation_messages')?.n ?? 0;
      } catch {
        // Konuşma tablosu henüz kurulmadıysa döküm sayısı 0'dır.
      }
      return { facts: count('fact'), episodes: count('episode'), commitments: count('commitment'), messages };
    },
  };
  return api;
}
