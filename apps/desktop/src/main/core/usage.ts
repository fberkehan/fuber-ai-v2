// Sahibi: T2. Her model çağrısının token ve dolar karşılığı, günlük toplam ve bütçe kapısı (KURGU §6).
import {
  addDays,
  localDay,
  newId,
  nowIso,
  type Migration,
  type ServiceDeps,
  type UsageApi,
  type UsageKind,
  type UsageRecord,
  type UsageSummary,
  UNPRICED_CALL_GUARD_USD,
} from '@fuber/shared';
import { costUsd } from './usage-pricing';

const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'kullanım kayıtları',
    up: `CREATE TABLE usage_records (
      id TEXT PRIMARY KEY,
      at TEXT NOT NULL,
      day TEXT NOT NULL,
      kind TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      cache_read_tokens INTEGER NOT NULL,
      cache_write_tokens INTEGER NOT NULL,
      audio_seconds REAL NOT NULL,
      cost_usd REAL NOT NULL,
      duration_ms INTEGER NOT NULL,
      session_id TEXT,
      -- Kontrol servisine gönderilmemiş kayıtlar (yükleme kuyruğu) NULL'dur.
      synced_at TEXT
    );
    CREATE INDEX usage_records_day ON usage_records (day);
    CREATE INDEX usage_records_unsynced ON usage_records (synced_at) WHERE synced_at IS NULL;`,
  },
  {
    id: 2,
    // OpenAI uyumlu sağlayıcıların modellerinin çoğunun fiyatı bilinmez: tutar 0 yazılır ama "bilinmiyor" diye işaretlenir.
    name: 'fiyatı bilinmeyen çağrı',
    up: `ALTER TABLE usage_records ADD COLUMN cost_known INTEGER NOT NULL DEFAULT 1;`,
  },
];

interface Row {
  id: string;
  at: string;
  kind: string;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  audio_seconds: number;
  cost_usd: number;
  cost_known: number;
  duration_ms: number;
  session_id: string | null;
}

function toRecord(row: Row): UsageRecord {
  return {
    ...(row.cost_known === 0 ? { costKnown: false } : {}),
    id: row.id,
    at: row.at,
    kind: row.kind as UsageKind,
    provider: row.provider,
    model: row.model,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cacheReadTokens: row.cache_read_tokens,
    cacheWriteTokens: row.cache_write_tokens,
    audioSeconds: row.audio_seconds,
    costUsd: row.cost_usd,
    durationMs: row.duration_ms,
    sessionId: row.session_id,
  };
}

/** Yükleme kuyruğu: sözleşmede boşaltma yöntemi yok; kontrol ucu bunu (ya da `usage.recorded`) kullanır. */
export interface UsageUploadQueue {
  pendingUpload(limit: number): UsageRecord[];
  markUploaded(ids: string[]): void;
}

export function createUsage(deps: ServiceDeps['usage']): UsageApi & UsageUploadQueue {
  const log = deps.log.child('usage');
  const db = deps.store.scoped('usage');
  let ready = false;
  const ensure = () => {
    if (ready) return;
    deps.store.migrate('usage', MIGRATIONS);
    ready = true;
  };

  const budget = () => deps.policy.get().limits.dailyBudgetUsd;

  const summaryFor = (day: string): UsageSummary => {
    ensure();
    const rows = db.all<{ kind: string; cost: number; calls: number; input: number; output: number; unpriced: number }>(
      `SELECT kind, SUM(cost_usd) AS cost, COUNT(*) AS calls, SUM(input_tokens + cache_read_tokens + cache_write_tokens) AS input,
              SUM(output_tokens) AS output, SUM(CASE WHEN cost_known = 0 THEN 1 ELSE 0 END) AS unpriced
         FROM usage_records WHERE day = ? GROUP BY kind`,
      [day],
    );
    const byKind: UsageSummary['byKind'] = {};
    let cost = 0;
    let calls = 0;
    let unpriced = 0;
    for (const row of rows) {
      unpriced += row.unpriced;
      byKind[row.kind as UsageKind] = {
        costUsd: row.cost,
        calls: row.calls,
        inputTokens: row.input,
        outputTokens: row.output,
      };
      cost += row.cost;
      calls += row.calls;
    }
    const limit = budget();
    // Fiyatı bilinmeyen çağrılar harcamaya girmez ama kapıda sayılır (çağrı başına varsayılan tutar): fiyatsız modelde de
    // günlük bir üst sınır olur. Kuruş yuvarlaması: 500 × 0,02 kayan noktada 10'un altında kalmasın.
    const guard = Math.round(unpriced * UNPRICED_CALL_GUARD_USD * 10_000) / 10_000;
    return {
      day,
      costUsd: cost,
      budgetUsd: limit,
      overBudget: limit > 0 && cost + guard >= limit,
      calls,
      ...(unpriced > 0 ? { unpricedCalls: unpriced, unpricedGuardUsd: guard } : {}),
      byKind,
    };
  };

  return {
    record(input) {
      ensure();
      let cost: number | null | undefined = input.costUsd;
      if (cost === undefined) {
        cost = costUsd(input.model, {
          inputTokens: input.inputTokens ?? 0,
          outputTokens: input.outputTokens ?? 0,
          cacheReadTokens: input.cacheReadTokens ?? 0,
          cacheWriteTokens: input.cacheWriteTokens ?? 0,
        });
      }
      // Fiyat bilinmiyor: 0 SAYILMAZ; kayıt "bilinmiyor" diye işaretlenir (Yönetim ve arayüz öyle yazar).
      const costKnown = cost !== null;
      if (!costKnown) log.info(`fiyatı bilinmeyen model; maliyet "bilinmiyor" diye kaydedildi: ${input.provider}/${input.model}`);
      const at = nowIso();
      const record: UsageRecord = {
        id: newId(),
        at,
        kind: input.kind,
        provider: input.provider,
        model: input.model,
        inputTokens: input.inputTokens ?? 0,
        outputTokens: input.outputTokens ?? 0,
        cacheReadTokens: input.cacheReadTokens ?? 0,
        cacheWriteTokens: input.cacheWriteTokens ?? 0,
        audioSeconds: input.audioSeconds ?? 0,
        costUsd: cost ?? 0,
        ...(costKnown ? {} : { costKnown: false }),
        durationMs: Math.round(input.durationMs),
        sessionId: input.sessionId ?? null,
      };
      db.run(
        `INSERT INTO usage_records (id, at, day, kind, provider, model, input_tokens, output_tokens, cache_read_tokens,
           cache_write_tokens, audio_seconds, cost_usd, duration_ms, session_id, cost_known)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.id,
          record.at,
          localDay(at),
          record.kind,
          record.provider,
          record.model,
          record.inputTokens,
          record.outputTokens,
          record.cacheReadTokens,
          record.cacheWriteTokens,
          record.audioSeconds,
          record.costUsd,
          record.durationMs,
          record.sessionId,
          costKnown ? 1 : 0,
        ],
      );
      deps.bus.emit('usage.recorded', { record, today: summaryFor(localDay()) });
      return record;
    },
    today: () => summaryFor(localDay()),
    summary(days) {
      const today = localDay();
      const out: UsageSummary[] = [];
      for (let i = 0; i < Math.max(1, days); i++) out.push(summaryFor(addDays(today, -i)));
      return out;
    },
    recent(limit) {
      ensure();
      return db.all<Row>('SELECT * FROM usage_records ORDER BY id DESC LIMIT ?', [limit]).map(toRecord);
    },
    overBudget: () => summaryFor(localDay()).overBudget,
    pendingUpload(limit) {
      ensure();
      return db
        .all<Row>('SELECT * FROM usage_records WHERE synced_at IS NULL ORDER BY id LIMIT ?', [limit])
        .map(toRecord);
    },
    markUploaded(ids) {
      ensure();
      const at = nowIso();
      db.transaction(() => {
        for (const id of ids) db.run('UPDATE usage_records SET synced_at = ? WHERE id = ?', [at, id]);
      });
    },
  };
}
