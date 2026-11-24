// Brifing ayarları ve öğrenilmiş ilgi durumu: modülün kendi tablosunda durur (ortak `Settings` sözleşmesine dokunulmaz).
// Sesle ayar: araca sözün KENDİSİ de verilebilir (`parseSpokenPrefs`): değer kodla okunur, model seçmez
// ("sabah brifingini sekizde ver", "daha az konuş", "haberleri sorma").
import { foldForSearch, resolveTurkishTime, type JsonValue, type Migration, type ScopedDb } from '@fuber/shared';
import { TALK_LEVELS, type BriefingAdaptive, type BriefingPrefs, type BriefingScope, type TalkLevel } from './types';

export const BRIEFING_MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'brifing ayarları, geçmişi ve ilgi durumu',
    up: `CREATE TABLE briefing_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE briefing_log (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      day TEXT NOT NULL,
      at TEXT NOT NULL,
      delivered TEXT NOT NULL,
      response TEXT NOT NULL,
      spoken_at TEXT,
      data TEXT NOT NULL
    );
    CREATE INDEX briefing_log_day ON briefing_log (day, at);`,
  },
];

export const DEFAULT_PREFS: BriefingPrefs = {
  enabled: true,
  talk: 'normal',
  morning: { enabled: true, time: '08:30' },
  updates: { from: '10:00', to: '19:00' },
  maxPerHour: 2,
  breaking: true,
  scope: { news: true, agenda: true, tasks: true, mail: true },
  newsCount: 3,
};

export const DEFAULT_ADAPTIVE: BriefingAdaptive = { ignoredStreak: 0, engaged: 0, ignored: 0, declined: 0, factor: 1, changedAt: null, note: null };

export type PrefsPatch = Partial<Omit<BriefingPrefs, 'morning' | 'updates' | 'scope'>> & {
  morning?: Partial<BriefingPrefs['morning']>;
  updates?: Partial<BriefingPrefs['updates']>;
  scope?: Partial<BriefingScope>;
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const validTime = (value: unknown, fallback: string): string => (typeof value === 'string' && TIME.test(value) ? value : fallback);
const bool = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);

/** Kayıtlı ya da yamalı ayarı geçerli bir ayara tamamlar (bozuk alan varsayılana döner). */
export function normalizePrefs(raw: unknown, base: BriefingPrefs = DEFAULT_PREFS): BriefingPrefs {
  const value = (raw && typeof raw === 'object' ? raw : {}) as PrefsPatch;
  const scope = (value.scope ?? {}) as Partial<BriefingScope>;
  const maxPerHour = typeof value.maxPerHour === 'number' && Number.isFinite(value.maxPerHour) ? Math.min(12, Math.max(1, Math.round(value.maxPerHour))) : base.maxPerHour;
  const newsCount = typeof value.newsCount === 'number' && Number.isFinite(value.newsCount) ? Math.min(20, Math.max(1, Math.round(value.newsCount))) : base.newsCount;
  return {
    enabled: bool(value.enabled, base.enabled),
    talk: TALK_LEVELS.includes(value.talk as TalkLevel) ? (value.talk as TalkLevel) : base.talk,
    morning: { enabled: bool(value.morning?.enabled, base.morning.enabled), time: validTime(value.morning?.time, base.morning.time) },
    updates: { from: validTime(value.updates?.from, base.updates.from), to: validTime(value.updates?.to, base.updates.to) },
    maxPerHour,
    breaking: bool(value.breaking, base.breaking),
    scope: {
      news: bool(scope.news, base.scope.news),
      agenda: bool(scope.agenda, base.scope.agenda),
      tasks: bool(scope.tasks, base.scope.tasks),
      mail: bool(scope.mail, base.scope.mail),
    },
    newsCount,
  };
}

export function mergePrefs(current: BriefingPrefs, patch: PrefsPatch): BriefingPrefs {
  return normalizePrefs(
    {
      ...current,
      ...patch,
      morning: { ...current.morning, ...(patch.morning ?? {}) },
      updates: { ...current.updates, ...(patch.updates ?? {}) },
      scope: { ...current.scope, ...(patch.scope ?? {}) },
    },
    current,
  );
}

export interface BriefingKv {
  get<T extends JsonValue>(key: string): T | undefined;
  set(key: string, value: JsonValue): void;
}

export function createKv(db: ScopedDb): BriefingKv {
  return {
    get<T extends JsonValue>(key: string): T | undefined {
      const row = db.get<{ value: string }>('SELECT value FROM briefing_state WHERE key = ?', [key]);
      if (!row) return undefined;
      try {
        return JSON.parse(row.value) as T;
      } catch {
        return undefined;
      }
    },
    set(key, value) {
      db.run('INSERT INTO briefing_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, JSON.stringify(value)]);
    },
  };
}

// ───────────── sesle ayar: söz kodla okunur ─────────────

const LEVEL_DOWN: Record<TalkLevel, TalkLevel> = { high: 'normal', normal: 'low', low: 'silent', silent: 'silent' };
const LEVEL_UP: Record<TalkLevel, TalkLevel> = { silent: 'low', low: 'normal', normal: 'high', high: 'high' };

const SCOPE_WORDS: ReadonlyArray<{ key: keyof BriefingScope; test: RegExp }> = [
  { key: 'news', test: /haber|gundem|rss/ },
  { key: 'mail', test: /e-?posta|\bmail|\bmeyl/ },
  { key: 'agenda', test: /takvim|hatirlatici|randevu|program/ },
  { key: 'tasks', test: /yapilacak|bekleyen is|gorev/ },
];

const OFF_WORDS = /sorma|soyleme|anlatma|okuma|istemiyorum|istemem|cikar|kaldir|kapat|verme|olmasin|dahil etme|katma|gec\b|atla/;
const ON_WORDS = /\bsoyle\b|\banlat\b|\bekle\b|\bac\b|dahil et|olsun|istiyorum|isterim|\bver\b|\bkat\b|de soyle|da soyle/;

/** Sözdeki saat ("sekizde", "sekiz buçukta", "08:30", "dokuza çeyrek kala") → `SS:DD`; yoksa `null`. */
export function spokenClock(text: string, now: Date): string | null {
  const direct = /\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/.exec(text);
  if (direct) return `${direct[1]!.padStart(2, '0')}:${direct[2]}`;
  const resolved = resolveTurkishTime(text, now);
  if (!resolved?.hasTime) return null;
  const at = resolved.at;
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
}

export interface SpokenPrefs {
  patch: PrefsPatch;
  /** Öğrenilmiş azalmayı sıfırla ("eskisi gibi konuş"). */
  resetAdaptive: boolean;
}

/**
 * Kullanıcının sözünden ayar değişikliği. Hiçbir şey anlaşılmazsa `null` (araç "anlamadım" der; tahmin edilmez).
 * `current`: göreli sözler ("daha az konuş") şimdiki düzeye göre okunur.
 */
export function parseSpokenPrefs(text: string, current: BriefingPrefs, now: Date): SpokenPrefs | null {
  const said = foldForSearch(text).replace(/\s+/g, ' ').trim();
  if (!said) return null;
  const patch: PrefsPatch = {};
  let resetAdaptive = false;
  let understood = false;

  // Konuşkanlık.
  if (/hic konusma|kendiliginden konusma|kendi kendine konusma|sen konusma|ben sormadan (konusma|soyleme)|araya girme\b.*\b(hic|asla)|sessiz kal|yalniz kart|sadece kart/.test(said)) {
    patch.talk = 'silent';
    understood = true;
  } else if (/daha az (konus|soyle|rahatsiz)|az konus|bu kadar (cok )?konusma|cok konusuyorsun|seyrek|azalt|daha seyrek/.test(said)) {
    patch.talk = LEVEL_DOWN[current.talk];
    understood = true;
  } else if (/daha (cok|fazla|sik) (konus|soyle|haber ver|guncelle)|daha konuskan|sik sik (soyle|haber ver)|artir|daha sik/.test(said)) {
    patch.talk = LEVEL_UP[current.talk];
    resetAdaptive = true;
    understood = true;
  } else if (/eskisi gibi konus|yeniden konus|normal(e)? don|olagan(a)? don|kendiliginden konusabilirsin/.test(said)) {
    patch.talk = current.talk === 'silent' ? 'normal' : current.talk;
    resetAdaptive = true;
    understood = true;
  }
  if (/yalniz sabah|sadece sabah|sabah disinda konusma/.test(said)) {
    patch.talk = 'low';
    understood = true;
  }

  // Haber sayısı ("brifingde beş haber olsun"): bu sözdeki "olsun" brifingi ya da haber kapsamını açma isteği değildir.
  const count = /\b(\d{1,2}) haber\b/.exec(said) ?? /\b(bir|iki|uc|dort|bes|alti|yedi|sekiz|dokuz|on) haber\b/.exec(said);

  // Sabah brifingi: aç/kapa ve saat.
  const morningTalk = /sabah|brifing|gunaydin|gun ozet|gunluk ozet/.test(said);
  if (morningTalk) {
    const clock = spokenClock(text, now);
    if (/(brifing|sabah (ozet|rapor|karsilama))\w*.{0,30}(verme|istemiyorum|istemem|kapat|iptal|olmasin|birak)/.test(said) || /brifing\w* (verme|kapat|istemiyorum)/.test(said)) {
      patch.morning = { enabled: false };
      understood = true;
    } else if (clock && /brifing|sabah|ozet/.test(said)) {
      patch.morning = { enabled: true, time: clock };
      understood = true;
    } else if (!count && /(brifing|sabah (ozet|rapor|karsilama))\w*.{0,20}(\bac\b|\bver\b|istiyorum|isterim|olsun|basla)/.test(said)) {
      patch.morning = { enabled: true };
      understood = true;
    }
  }

  // Önemli gelişmede araya girme.
  if (/(onemli|son dakika|acil) (gelisme|haber)\w*.{0,30}(araya girme|soyleme|haber verme|rahatsiz etme)|araya girme/.test(said)) {
    patch.breaking = false;
    understood = true;
  } else if (/(onemli|son dakika|acil) (gelisme|haber)\w*.{0,30}(araya gir|soyle|haber ver)/.test(said)) {
    patch.breaking = true;
    understood = true;
  }

  // Kapsam: "haberleri sorma", "e-postaları da söyle".
  for (const { key, test } of SCOPE_WORDS) {
    if (!test.test(said) || (key === 'news' && count)) continue;
    const off = OFF_WORDS.test(said);
    const on = ON_WORDS.test(said);
    if (off && !on) {
      patch.scope = { ...(patch.scope ?? {}), [key]: false };
      understood = true;
    } else if (on && !off && /brifing|ozet|sabah|de soyle|da soyle|dahil|\bekle\b|\bkat\b/.test(said)) {
      patch.scope = { ...(patch.scope ?? {}), [key]: true };
      understood = true;
    }
  }

  if (count) {
    const words = ['', 'bir', 'iki', 'uc', 'dort', 'bes', 'alti', 'yedi', 'sekiz', 'dokuz', 'on'];
    const value = /\d/.test(count[1]!) ? Number(count[1]) : words.indexOf(count[1]!);
    if (value >= 1) {
      patch.newsCount = value;
      understood = true;
    }
  }

  // Tümünü aç/kapa.
  if (/brifing\w* (tamamen |butunuyle )?kapat|brifing ozelligini kapat/.test(said)) {
    patch.enabled = false;
    understood = true;
  } else if (/brifing\w* (yeniden |tekrar )?ac\b/.test(said)) {
    patch.enabled = true;
    understood = true;
  }

  return understood ? { patch, resetAdaptive } : null;
}
