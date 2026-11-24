// Profil deposu: kategorili kayıtlar, çelişki çözümü (yeni bilgi eskisinin yerini alır, eskisi tarihli olarak durur),
// güven ve kaynak tur. Saat dışarıdan verilir (çok günlük benzetim sahte saatle koşar).
import {
  foldForSearch,
  FTS_TOKENIZER,
  newId,
  SIMILAR_MERGE,
  SIMILAR_SKIP,
  stemSet,
  stemSetSimilarity,
  type Channel,
  type Id,
  type IsoDateTime,
  type JsonValue,
  type Migration,
  type ScopedDb,
  type SqlValue,
} from '@fuber/shared';
import type { ProfileCategory, ProfileItem, ProfileOrigin } from './types';

/**
 * Hafıza modülünün kendi göçleri. Çekirdek hafıza servisi aynı ad alanını (`memory`) 1 numaralı göçle kullanır;
 * çakışmasın diye profil göçleri 101'den başlar.
 */
export const PROFILE_MIGRATIONS: Migration[] = [
  {
    id: 101,
    name: 'kullanıcı profili',
    up: `CREATE TABLE memory_profile_items (
      rid INTEGER PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL,
      key TEXT NOT NULL,
      text TEXT NOT NULL,
      confidence REAL NOT NULL,
      origin TEXT NOT NULL,
      channel TEXT NOT NULL,
      session_id TEXT,
      message_id TEXT,
      learned_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      confirmations INTEGER NOT NULL DEFAULT 0,
      locked INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      superseded_by TEXT,
      previous_text TEXT
    );
    CREATE INDEX memory_profile_items_status ON memory_profile_items (status, category);
    CREATE VIRTUAL TABLE memory_profile_fts USING fts5(norm, tokenize = "${FTS_TOKENIZER}");
    CREATE TABLE memory_profile_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE memory_profile_signals (
      key TEXT NOT NULL,
      day TEXT NOT NULL,
      count INTEGER NOT NULL,
      last_at TEXT NOT NULL,
      PRIMARY KEY (key, day)
    );`,
  },
];

interface Row {
  rid: number;
  id: string;
  category: string;
  key: string;
  text: string;
  confidence: number;
  origin: string;
  channel: string;
  session_id: string | null;
  message_id: string | null;
  learned_at: string;
  updated_at: string;
  confirmations: number;
  locked: number;
  status: string;
  superseded_by: string | null;
  previous_text: string | null;
}

const toItem = (row: Row): ProfileItem => ({
  id: row.id,
  category: row.category as ProfileCategory,
  key: row.key,
  text: row.text,
  confidence: row.confidence,
  origin: row.origin as ProfileOrigin,
  channel: row.channel as ProfileItem['channel'],
  sessionId: row.session_id,
  messageId: row.message_id,
  learnedAt: row.learned_at,
  updatedAt: row.updated_at,
  confirmations: row.confirmations,
  locked: row.locked === 1,
  status: row.status as ProfileItem['status'],
  supersededBy: row.superseded_by,
  previousText: row.previous_text,
});

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Kullanıcının kendi ağzından geldiği için model çıkarımının ezemediği kaynaklar. */
const FIRST_HAND: ReadonlySet<ProfileOrigin> = new Set(['said', 'user', 'intro']);

/** Sır gibi görünen metin profile yazılmaz (parola, kart, kimlik numarası, anahtar). */
const SECRET = /\b(sifre|parola|password|passcode|pin kodu|cvv|kart numara|kredi karti no|iban|tc kimlik|kimlik numara|api anahtar|api key|token|gizli anahtar|secret)\w*/;
export const looksSecret = (text: string): boolean => SECRET.test(foldForSearch(text)) || /\b\d{11,}\b/.test(text);

/** Konu anahtarı: katlanmış, harf-rakam ve tire; en çok 48 karakter. */
export function normalizeKey(raw: string): string {
  return foldForSearch(raw)
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/** Konu taşımayan sık kökler: iki kaydın "aynı konu" sayılmasında örtüşmeye katılmaz. */
const FILLER_STEMS = new Set(
  [
    'kullanici', 'kullan', 'ister', 'istiyor', 'istemiyor', 'istemez', 'tercih', 'eder', 'sever', 'sevmez', 'sevmiyor', 'bana', 'hep', 'her', 'zaman', 'bundan', 'sonra',
    'artik', 'asla', 'daha', 'cok', 'gibi', 'icin', 'olarak', 'olsun', 'olmasin', 'bir', 'bunu', 'boyle', 'oyle', 'istegi', 'istek', 'acik', 'uygula', 'lutfen', 'yap',
    'yapma', 'deme', 'soyle', 'soyleme', 'yanit', 'yanitlar', 'cevap', 'asistan', 'jarvis', 'sen', 'ben', 'seferinde', 'genelde', 'genellikle', 'siklikla', 'onceden',
  ].map((word) => [...stemSet(word)][0] ?? word),
);

export const topicStems = (text: string): Set<string> => new Set([...stemSet(text)].filter((stem) => !FILLER_STEMS.has(stem) && !/^\d+$/.test(stem)));
const numbersOf = (text: string): Set<string> => new Set(foldForSearch(text).match(/\d+(?:[.,:]\d+)?/g) ?? []);

/**
 * İki kayıt AYNI konuda mı (yenisi eskisinin yerini alır). Fuber AI 1'in tercih kuralından (`ayniTercihMi`) uyarlandı:
 * konu köklerinden en az ikisi ortak VE ya sayılar farklı ("en fazla 5 madde" → "3 madde") ya da küçük kümenin
 * neredeyse tamamı ortak ("sabah brifingi isterim" → "sabah brifingi istemem"). Eşik v1'dekinden (0,5) sıkıdır:
 * "kahveyi sade içer" ile "çayı sade içer" ayrı konulardır. Zıt sıfatlı düzeltmeler ("kısa tut" → "uzun anlat")
 * kök örtüşmesiyle yakalanamaz; onlar konu anahtarıyla (`key`) eşlenir (`learn.ts` › konu sözlüğü, modelin verdiği anahtar).
 */
export function sameTopic(a: string, b: string): boolean {
  const left = topicStems(a);
  const right = topicStems(b);
  if (left.size === 0 || right.size === 0) return false;
  let common = 0;
  for (const stem of left) if (right.has(stem)) common++;
  if (common < 2) return false;
  const numsA = numbersOf(a);
  const numsB = numbersOf(b);
  const numbersDiffer = numsA.size > 0 && numsB.size > 0 && [...numsB].some((value) => !numsA.has(value));
  return numbersDiffer || common / Math.min(left.size, right.size) >= 0.8;
}

export interface LearnInput {
  category: ProfileCategory;
  /** Konu anahtarı; verilmezse metinden türetilir (ilk iki konu kökü). */
  key?: string | null;
  text: string;
  confidence?: number;
  origin: ProfileOrigin;
  channel: ProfileItem['channel'];
  sessionId?: Id | null;
  messageId?: Id | null;
}

export type LearnOutcome =
  /** Yeni kayıt açıldı. */
  | { kind: 'added'; item: ProfileItem }
  /** Aynı bilgi yinelendi: güven ve doğrulama sayısı arttı. */
  | { kind: 'confirmed'; item: ProfileItem }
  /** Aynı konunun yeni hâli: eski kayıt "geçersiz" işaretlendi (silinmedi), yenisi onun yerini aldı. */
  | { kind: 'superseded'; item: ProfileItem; previous: ProfileItem }
  /** Yazılmadı: sır, boş metin, ya da kullanıcının kendi sözünü ezmeye çalışan bir çıkarım. */
  | { kind: 'skipped'; reason: 'empty' | 'secret' | 'first-hand-wins' | 'locked' };

export interface ProfileStore {
  /** Etkin kayıtlar (kategori verilirse yalnız o); en yeni önce. */
  list(filter?: { category?: ProfileCategory; includeSuperseded?: boolean }): ProfileItem[];
  get(id: Id): ProfileItem | null;
  /** Öğrenilen bilgiyi çelişki kuralıyla işler. */
  learn(input: LearnInput): LearnOutcome;
  /** Kullanıcının elle düzeltmesi: güven 1, kilitli; metin değiştiyse eskisi geçmişte kalır. */
  edit(id: Id, patch: { category?: ProfileCategory; text?: string }): ProfileItem | null;
  /** Kaydı ve yerini aldığı eski sürümleri kalıcı siler. */
  remove(id: Id): boolean;
  /** Söze göre ilgili etkin kayıtlar (tam metin arama; kök önekleri VEYA ile). */
  search(text: string, limit: number): ProfileItem[];
  /** Son değişenler: yerini yenisine bırakan kayıtlar, en yeni önce. */
  history(limit: number): Array<{ old: ProfileItem; replacedBy: ProfileItem | null }>;
  /** Kayıt isteme girdi: son kullanım sayacı yok; yalnız `confirm` güveni artırır. */
  count(): { total: number; rules: number };
  first(): IsoDateTime | null;
  state<T extends JsonValue>(key: string): T | undefined;
  setState(key: string, value: JsonValue): void;
  /** Davranış işareti sayacı (anahtar + yerel gün). Dönen: son `windowDays` günde kaç FARKLI günde ve toplam kaç kez. */
  bumpSignal(key: string, day: string, windowDays: number): { days: number; total: number };
  signal(key: string, sinceDay: string): { days: number; total: number };
  /** Bütün profil verisini siler (modül verisini temizleme). */
  purge(): void;
}

export interface ProfileStoreDeps {
  db: ScopedDb;
  now?: () => Date;
}

const STOP = new Set(['ve', 'veya', 'ile', 'bir', 'bu', 'su', 'ne', 'mi', 'mu', 'de', 'da', 'ki', 'icin', 'gibi', 'ama', 'ben', 'sen', 'var', 'yok', 'cok', 'daha', 'en'].map(foldForSearch));

function ftsOf(text: string): string | null {
  const terms = [...new Set(foldForSearch(text).match(/[\p{L}\p{N}]+/gu) ?? [])].filter((term) => !STOP.has(term) && (term.length >= 3 || /\d/.test(term)));
  if (terms.length === 0) return null;
  return terms
    .slice(0, 24)
    .map((term) => `"${term.length > 6 ? term.slice(0, 6) : term}" *`)
    .join(' OR ');
}

export function createProfileStore(deps: ProfileStoreDeps): ProfileStore {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());
  const iso = (): IsoDateTime => now().toISOString();

  const rowById = (id: Id) => db.get<Row>('SELECT * FROM memory_profile_items WHERE id = ?', [id]);
  const reindex = (row: Row) => {
    db.run('DELETE FROM memory_profile_fts WHERE rowid = ?', [row.rid]);
    if (row.status === 'active') db.run('INSERT INTO memory_profile_fts (rowid, norm) VALUES (?, ?)', [row.rid, foldForSearch(`${row.text} ${row.key.replace(/-/g, ' ')}`)]);
  };

  const insert = (input: Required<Pick<LearnInput, 'category' | 'text' | 'origin' | 'channel'>> & { key: string; confidence: number; sessionId: Id | null; messageId: Id | null; previousText: string | null; locked: boolean; confirmations?: number }): Row => {
    const id = newId();
    const at = iso();
    db.run(
      `INSERT INTO memory_profile_items (id, category, key, text, confidence, origin, channel, session_id, message_id, learned_at, updated_at,
         confirmations, locked, status, superseded_by, previous_text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NULL, ?)`,
      [id, input.category, input.key, input.text, clamp01(input.confidence), input.origin, input.channel, input.sessionId, input.messageId, at, at, input.confirmations ?? 0, input.locked ? 1 : 0, input.previousText],
    );
    const row = rowById(id)!;
    reindex(row);
    return row;
  };

  const supersedeRow = (old: Row, by: Row) => {
    db.run(`UPDATE memory_profile_items SET status = 'superseded', superseded_by = ?, updated_at = ? WHERE rid = ?`, [by.id, iso(), old.rid]);
    db.run('DELETE FROM memory_profile_fts WHERE rowid = ?', [old.rid]);
  };

  const activeRows = (category?: ProfileCategory): Row[] =>
    category
      ? db.all<Row>(`SELECT * FROM memory_profile_items WHERE status = 'active' AND category = ? ORDER BY updated_at DESC, rid DESC`, [category])
      : db.all<Row>(`SELECT * FROM memory_profile_items WHERE status = 'active' ORDER BY updated_at DESC, rid DESC`);

  /**
   * Aynı konudaki etkin kayıt: önce aynı anahtar, sonra en benzer metin. Anahtar AÇIKÇA verildiyse (konu sözlüğü,
   * model, tanışma) farklı anahtarlı kayıt başka konudur; yalnız birebir yineleme (aynı metin) eşleşir.
   * Davranış kuralları ayrıdır: aynı düzeltmeyi kod kullanıcının sözüyle (`yanit-uzunlugu`), model kendi anahtarıyla
   * (`yanit-bicimi`) yazabilir; ikisi yan yana kalırsa sonraki çelişkide biri eski hâliyle kalır ve model çelişen iki
   * kural görür. Kurallarda anahtar farklı olsa da konu benzerliğine bakılır.
   */
  const findSameTopic = (category: ProfileCategory, key: string, text: string, keyGiven: boolean): Row | null => {
    const rows = activeRows(category);
    const byKey = key ? rows.find((row) => row.key === key) : undefined;
    if (byKey) return byKey;
    const stems = stemSet(text);
    let best: { row: Row; similarity: number } | null = null;
    for (const row of rows) {
      const similarity = stemSetSimilarity(stems, stemSet(row.text));
      const strict = keyGiven && category !== 'rule';
      const match = strict ? similarity >= SIMILAR_SKIP && numbersEqual(row.text, text) : similarity >= SIMILAR_MERGE || sameTopic(row.text, text);
      if (match && (!best || similarity > best.similarity)) best = { row, similarity };
    }
    return best?.row ?? null;
  };

  const deriveKey = (text: string): string => normalizeKey([...topicStems(text)].slice(0, 3).join('-')) || normalizeKey(text.slice(0, 32));

  const api: ProfileStore = {
    list(filter = {}) {
      const conditions: string[] = [];
      const params: SqlValue[] = [];
      if (!filter.includeSuperseded) conditions.push(`status = 'active'`);
      if (filter.category) {
        conditions.push('category = ?');
        params.push(filter.category);
      }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      return db.all<Row>(`SELECT * FROM memory_profile_items ${where} ORDER BY updated_at DESC, rid DESC`, params).map(toItem);
    },

    get(id) {
      const row = rowById(id);
      return row ? toItem(row) : null;
    },

    learn(input) {
      const text = input.text.replace(/\s+/g, ' ').trim();
      if (text.length < 3) return { kind: 'skipped', reason: 'empty' };
      if (looksSecret(text)) return { kind: 'skipped', reason: 'secret' };
      const givenKey = normalizeKey(input.key ?? '');
      const key = givenKey || deriveKey(text);
      const confidence = clamp01(input.confidence ?? (FIRST_HAND.has(input.origin) ? 1 : 0.7));
      return db.transaction((): LearnOutcome => {
        const existing = findSameTopic(input.category, key, text, givenKey !== '');
        if (!existing) {
          const row = insert({ category: input.category, key, text, confidence, origin: input.origin, channel: input.channel, sessionId: input.sessionId ?? null, messageId: input.messageId ?? null, previousText: null, locked: input.origin === 'user' });
          return { kind: 'added', item: toItem(row) };
        }
        const oldStems = stemSet(existing.text);
        const newStems = stemSet(text);
        let common = 0;
        for (const stem of newStems) if (oldStems.has(stem)) common++;
        const covered = newStems.size === 0 ? 1 : common / newStems.size;
        // Yeni metin var olan kayda bir şey EKLEMİYORSA (kökleri ve sayıları zaten orada) yinelemedir. Kodun kısa kaydı
        // ("Kızı: Elif.") modelin aynı turda yazdığı zengin kaydın ("Kızı Elif; 2026'da üniversiteye başladı.") yerini almaz.
        const same = foldForSearch(existing.text) === foldForSearch(text) || (covered >= SIMILAR_SKIP && numbersWithin(text, existing.text));
        if (same) {
          // Yinelenen bilgi: doğrulama. Güven yükselir (ilk elden söz 1,0'a çıkarır); kaynak daha güçlüyse o yazılır.
          const boosted = FIRST_HAND.has(input.origin) ? Math.max(existing.confidence, confidence) : Math.min(0.95, Math.max(existing.confidence, confidence) + 0.05);
          const origin = FIRST_HAND.has(input.origin) && !FIRST_HAND.has(existing.origin as ProfileOrigin) ? input.origin : existing.origin;
          db.run('UPDATE memory_profile_items SET confidence = ?, confirmations = confirmations + 1, origin = ?, updated_at = ? WHERE rid = ?', [clamp01(boosted), origin, iso(), existing.rid]);
          return { kind: 'confirmed', item: toItem(rowById(existing.id)!) };
        }
        // Aynı konu, farklı içerik: çelişki. Kullanıcının kendi sözünü (ya da elle düzeltmesini) bir çıkarım ezemez.
        if (!FIRST_HAND.has(input.origin)) {
          if (existing.locked === 1) return { kind: 'skipped', reason: 'locked' };
          if (FIRST_HAND.has(existing.origin as ProfileOrigin)) return { kind: 'skipped', reason: 'first-hand-wins' };
        }
        const row = insert({
          category: input.category,
          key: existing.key || key,
          text,
          confidence,
          origin: input.origin,
          channel: input.channel,
          sessionId: input.sessionId ?? null,
          messageId: input.messageId ?? null,
          previousText: existing.text,
          locked: input.origin === 'user',
        });
        supersedeRow(existing, row);
        return { kind: 'superseded', item: toItem(row), previous: toItem(rowById(existing.id)!) };
      });
    },

    edit(id, patch) {
      const current = rowById(id);
      if (!current || current.status !== 'active') return null;
      const text = patch.text?.replace(/\s+/g, ' ').trim();
      const category = patch.category ?? (current.category as ProfileCategory);
      return db.transaction(() => {
        if (text && text !== current.text) {
          const row = insert({ category, key: current.key, text, confidence: 1, origin: 'user', channel: 'ui', sessionId: null, messageId: null, previousText: current.text, locked: true });
          supersedeRow(current, row);
          return toItem(row);
        }
        db.run(`UPDATE memory_profile_items SET category = ?, confidence = 1, origin = 'user', locked = 1, updated_at = ? WHERE rid = ?`, [category, iso(), current.rid]);
        const updated = rowById(id)!;
        reindex(updated);
        return toItem(updated);
      });
    },

    remove(id) {
      const row = rowById(id);
      if (!row) return false;
      db.transaction(() => {
        // Zincir: bu kaydın yerini aldığı bütün eski sürümler de aynı bilginin eski hâlidir.
        const doomed: Row[] = [row];
        for (let index = 0; index < doomed.length; index++) {
          doomed.push(...db.all<Row>('SELECT * FROM memory_profile_items WHERE superseded_by = ?', [doomed[index]!.id]));
        }
        for (const item of doomed) {
          db.run('DELETE FROM memory_profile_fts WHERE rowid = ?', [item.rid]);
          db.run('DELETE FROM memory_profile_items WHERE rid = ?', [item.rid]);
        }
      });
      return true;
    },

    search(text, limit) {
      const match = ftsOf(text);
      if (!match) return [];
      return db
        .all<Row>(
          `SELECT m.* FROM memory_profile_fts JOIN memory_profile_items m ON m.rid = memory_profile_fts.rowid
            WHERE memory_profile_fts MATCH ? AND m.status = 'active' ORDER BY bm25(memory_profile_fts) LIMIT ?`,
          [match, limit],
        )
        .map(toItem);
    },

    history(limit) {
      return db
        .all<Row>(`SELECT * FROM memory_profile_items WHERE status = 'superseded' ORDER BY updated_at DESC, rid DESC LIMIT ?`, [limit])
        .map((row) => ({ old: toItem(row), replacedBy: row.superseded_by ? api.get(row.superseded_by) : null }));
    },

    count() {
      const rows = db.all<{ category: string; n: number }>(`SELECT category, COUNT(*) AS n FROM memory_profile_items WHERE status = 'active' GROUP BY category`);
      return { total: rows.reduce((sum, row) => sum + row.n, 0), rules: rows.find((row) => row.category === 'rule')?.n ?? 0 };
    },

    first() {
      return db.get<{ at: string | null }>('SELECT MIN(learned_at) AS at FROM memory_profile_items')?.at ?? null;
    },

    state<T extends JsonValue>(key: string): T | undefined {
      const row = db.get<{ value: string }>('SELECT value FROM memory_profile_state WHERE key = ?', [key]);
      if (!row) return undefined;
      try {
        return JSON.parse(row.value) as T;
      } catch {
        return undefined;
      }
    },

    setState(key, value) {
      db.run('INSERT INTO memory_profile_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, JSON.stringify(value)]);
    },

    bumpSignal(key, day, windowDays) {
      db.run(
        `INSERT INTO memory_profile_signals (key, day, count, last_at) VALUES (?, ?, 1, ?)
         ON CONFLICT(key, day) DO UPDATE SET count = count + 1, last_at = excluded.last_at`,
        [key, day, iso()],
      );
      const since = new Date(now().getTime() - windowDays * 86_400_000).toISOString().slice(0, 10);
      return api.signal(key, since);
    },

    signal(key, sinceDay) {
      const row = db.get<{ days: number; total: number | null }>('SELECT COUNT(*) AS days, SUM(count) AS total FROM memory_profile_signals WHERE key = ? AND day >= ?', [key, sinceDay]);
      return { days: row?.days ?? 0, total: row?.total ?? 0 };
    },

    purge() {
      db.transaction(() => {
        db.run('DELETE FROM memory_profile_fts');
        db.run('DELETE FROM memory_profile_items');
        db.run('DELETE FROM memory_profile_state');
        db.run('DELETE FROM memory_profile_signals');
      });
    },
  };
  return api;
}

/** `text`teki bütün sayılar `container`da da var mı (yeni metin yeni bir sayı getirmiyor). */
function numbersWithin(text: string, container: string): boolean {
  const held = numbersOf(container);
  for (const value of numbersOf(text)) if (!held.has(value)) return false;
  return true;
}

function numbersEqual(a: string, b: string): boolean {
  const left = numbersOf(a);
  const right = numbersOf(b);
  if (left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
}

export type { Channel };
