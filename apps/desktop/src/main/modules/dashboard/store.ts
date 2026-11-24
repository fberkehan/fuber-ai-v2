// Kokpit deposu: özel kartlar, öneriler, kalıcı düzen ve ağ verisinin son iyi kopyası. Tablolar `dashboard_` önekli.
import {
  DASHBOARD_TEMPLATES,
  isDashboardSize,
  newId,
  type DashboardCardSource,
  type DashboardCustomContent,
  type DashboardLayoutState,
  type DashboardSize,
  type DashboardSuggestion,
  type Id,
  type IsoDateTime,
  type Migration,
  type ScopedDb,
} from '@fuber/shared';

export const DASHBOARD_MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'kartlar, öneriler, düzen, ağ önbelleği',
    up: `
      CREATE TABLE dashboard_cards (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        size TEXT NOT NULL,
        source TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        removed_at TEXT
      );
      CREATE TABLE dashboard_suggestions (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        detail TEXT,
        prompt TEXT,
        created_at TEXT NOT NULL,
        dismissed_at TEXT
      );
      CREATE TABLE dashboard_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE dashboard_cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, fetched_at TEXT NOT NULL, previous TEXT);
    `,
  },
];

export interface CustomCard {
  id: Id;
  title: string;
  content: DashboardCustomContent;
  size: DashboardSize;
  source: Extract<DashboardCardSource, 'ai' | 'user'>;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

interface CardRow {
  id: string;
  title: string;
  content: string;
  size: string;
  source: string;
  created_at: string;
  updated_at: string;
}

export interface CachedValue<T> {
  value: T;
  fetchedAt: IsoDateTime;
  /** Bir önceki (farklı güne ait) değer; kur değişimini hesaplamak için. */
  previous: T | null;
}

/** Aynı anda en çok bu kadar özel kart ve öneri tutulur (yapay zekâ panoyu doldurup taşırmasın). */
export const MAX_CUSTOM_CARDS = 12;
export const MAX_SUGGESTIONS = 6;
/** Kaldırılan özel kart "Geri al" için bu kadar süre saklanır, sonra kalıcı silinir. */
const REMOVED_KEEP_MS = 24 * 60 * 60 * 1000;

const EMPTY_LAYOUT: DashboardLayoutState = { order: [], sizes: {}, hidden: [] };

function parseJson<T>(text: string | undefined | null): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function isContent(value: unknown): value is DashboardCustomContent {
  return typeof value === 'object' && value !== null && (DASHBOARD_TEMPLATES as readonly string[]).includes((value as { template?: string }).template ?? '');
}

export function createDashboardStore(db: ScopedDb, now: () => number = Date.now) {
  const toCard = (row: CardRow): CustomCard | null => {
    const content = parseJson<unknown>(row.content);
    if (!isContent(content)) return null;
    return {
      id: row.id,
      title: row.title,
      content,
      size: isDashboardSize(row.size) ? row.size : 'medium',
      source: row.source === 'user' ? 'user' : 'ai',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  };

  const readLayout = (): DashboardLayoutState => {
    const raw = parseJson<Partial<DashboardLayoutState>>(db.get<{ value: string }>('SELECT value FROM dashboard_state WHERE key = ?', ['layout'])?.value);
    if (!raw) return { order: [], sizes: {}, hidden: [] };
    const sizes: Record<string, DashboardSize> = {};
    for (const [id, size] of Object.entries(raw.sizes ?? {})) if (isDashboardSize(size)) sizes[id] = size;
    return {
      order: Array.isArray(raw.order) ? raw.order.filter((id): id is string => typeof id === 'string') : [],
      sizes,
      hidden: Array.isArray(raw.hidden) ? raw.hidden.filter((id): id is string => typeof id === 'string') : [],
    };
  };
  const writeLayout = (layout: DashboardLayoutState): void => {
    db.run('INSERT INTO dashboard_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', ['layout', JSON.stringify(layout)]);
  };

  return {
    // ── özel kartlar ──
    cards(): CustomCard[] {
      return db
        .all<CardRow>('SELECT * FROM dashboard_cards WHERE removed_at IS NULL ORDER BY created_at')
        .map(toCard)
        .filter((card): card is CustomCard => card !== null);
    },
    card(id: string): CustomCard | null {
      const row = db.get<CardRow>('SELECT * FROM dashboard_cards WHERE id = ? AND removed_at IS NULL', [id]);
      return row ? toCard(row) : null;
    },
    addCard(input: { title: string; content: DashboardCustomContent; size: DashboardSize; source: CustomCard['source'] }): CustomCard {
      const at = new Date(now()).toISOString();
      const card: CustomCard = { id: `kart-${newId()}`, title: input.title, content: input.content, size: input.size, source: input.source, createdAt: at, updatedAt: at };
      db.run('INSERT INTO dashboard_cards (id, title, content, size, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
        card.id,
        card.title,
        JSON.stringify(card.content),
        card.size,
        card.source,
        at,
        at,
      ]);
      return card;
    },
    updateCard(id: string, patch: { title?: string; content?: DashboardCustomContent; size?: DashboardSize }): CustomCard | null {
      const current = this.card(id);
      if (!current) return null;
      const next: CustomCard = {
        ...current,
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.content !== undefined ? { content: patch.content } : {}),
        ...(patch.size !== undefined ? { size: patch.size } : {}),
        updatedAt: new Date(now()).toISOString(),
      };
      db.run('UPDATE dashboard_cards SET title = ?, content = ?, size = ?, updated_at = ? WHERE id = ?', [next.title, JSON.stringify(next.content), next.size, next.updatedAt, id]);
      return next;
    },
    /** Yumuşak silme: "Geri al" için bir gün saklanır. Kart varsa `true`. */
    removeCard(id: string): boolean {
      return db.run('UPDATE dashboard_cards SET removed_at = ? WHERE id = ? AND removed_at IS NULL', [new Date(now()).toISOString(), id]).changes > 0;
    },
    restoreCard(id: string): boolean {
      return db.run('UPDATE dashboard_cards SET removed_at = NULL WHERE id = ? AND removed_at IS NOT NULL', [id]).changes > 0;
    },
    /** Süresi dolan silinmiş kartları ve kapatılmış önerileri kalıcı olarak atar. */
    sweep(): void {
      const before = new Date(now() - REMOVED_KEEP_MS).toISOString();
      db.run('DELETE FROM dashboard_cards WHERE removed_at IS NOT NULL AND removed_at < ?', [before]);
      db.run('DELETE FROM dashboard_suggestions WHERE dismissed_at IS NOT NULL AND dismissed_at < ?', [before]);
    },

    // ── öneriler ──
    suggestions(): DashboardSuggestion[] {
      return db
        .all<{ id: string; text: string; detail: string | null; prompt: string | null; created_at: string }>(
          'SELECT id, text, detail, prompt, created_at FROM dashboard_suggestions WHERE dismissed_at IS NULL ORDER BY created_at DESC LIMIT ?',
          [MAX_SUGGESTIONS],
        )
        .map((row) => ({ id: row.id, text: row.text, detail: row.detail, prompt: row.prompt, createdAt: row.created_at }));
    },
    addSuggestion(input: { text: string; detail?: string | null; prompt?: string | null }): DashboardSuggestion {
      const at = new Date(now()).toISOString();
      // Aynı metinli açık öneri yinelenmez: var olan döner.
      const same = db.get<{ id: string; detail: string | null; prompt: string | null; created_at: string }>(
        'SELECT id, detail, prompt, created_at FROM dashboard_suggestions WHERE dismissed_at IS NULL AND text = ?',
        [input.text],
      );
      if (same) return { id: same.id, text: input.text, detail: same.detail, prompt: same.prompt, createdAt: same.created_at };
      const suggestion: DashboardSuggestion = { id: `oneri-${newId()}`, text: input.text, detail: input.detail ?? null, prompt: input.prompt ?? null, createdAt: at };
      db.run('INSERT INTO dashboard_suggestions (id, text, detail, prompt, created_at) VALUES (?, ?, ?, ?, ?)', [suggestion.id, suggestion.text, suggestion.detail, suggestion.prompt, at]);
      return suggestion;
    },
    dismissSuggestion(id: string): boolean {
      return db.run('UPDATE dashboard_suggestions SET dismissed_at = ? WHERE id = ? AND dismissed_at IS NULL', [new Date(now()).toISOString(), id]).changes > 0;
    },

    // ── düzen ──
    layout: readLayout,
    setOrder(ids: readonly string[]): void {
      writeLayout({ ...readLayout(), order: [...new Set(ids)] });
    },
    setSize(id: string, size: DashboardSize): void {
      const layout = readLayout();
      writeLayout({ ...layout, sizes: { ...layout.sizes, [id]: size } });
    },
    setHidden(id: string, hidden: boolean): void {
      const layout = readLayout();
      const rest = layout.hidden.filter((item) => item !== id);
      writeLayout({ ...layout, hidden: hidden ? [...rest, id] : rest });
    },
    resetLayout(): void {
      writeLayout(EMPTY_LAYOUT);
    },

    // ── ayar (hava durumunun yeri) ──
    config(): { weatherPlace: string | null } {
      const raw = parseJson<{ weatherPlace?: unknown }>(db.get<{ value: string }>('SELECT value FROM dashboard_state WHERE key = ?', ['config'])?.value);
      return { weatherPlace: typeof raw?.weatherPlace === 'string' && raw.weatherPlace.trim() ? raw.weatherPlace.trim() : null };
    },
    setConfig(config: { weatherPlace: string | null }): void {
      db.run('INSERT INTO dashboard_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', ['config', JSON.stringify(config)]);
    },

    // ── ağ verisinin son iyi kopyası ──
    cached<T>(key: string): CachedValue<T> | null {
      const row = db.get<{ value: string; fetched_at: string; previous: string | null }>('SELECT value, fetched_at, previous FROM dashboard_cache WHERE key = ?', [key]);
      const value = parseJson<T>(row?.value);
      return row && value !== null ? { value, fetchedAt: row.fetched_at, previous: parseJson<T>(row.previous) } : null;
    },
    putCache<T>(key: string, value: T, previous: T | null): CachedValue<T> {
      const fetchedAt = new Date(now()).toISOString();
      db.run(
        'INSERT INTO dashboard_cache (key, value, fetched_at, previous) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, fetched_at = excluded.fetched_at, previous = excluded.previous',
        [key, JSON.stringify(value), fetchedAt, previous === null ? null : JSON.stringify(previous)],
      );
      return { value, fetchedAt, previous };
    },
    dropCache(key: string): void {
      db.run('DELETE FROM dashboard_cache WHERE key = ?', [key]);
    },

    /** Kullanıcının bütün pano verisi ("verimi sil"). */
    purge(): void {
      db.exec('DELETE FROM dashboard_cards; DELETE FROM dashboard_suggestions; DELETE FROM dashboard_state; DELETE FROM dashboard_cache;');
    },
  };
}

export type DashboardStore = ReturnType<typeof createDashboardStore>;
