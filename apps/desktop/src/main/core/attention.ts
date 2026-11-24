// Sahibi: T2. Dikkat Yöneticisi (KURGU §8): her bildirimin kanalını tek yerde seçer, bekletir, tekilleştirir, özetler.
import {
  isWithinLocalTimeRange,
  newId,
  nowIso,
  t,
  type AttentionApi,
  type AttentionChannel,
  type Id,
  type JsonObject,
  type Migration,
  type Notification,
  type NotifyAction,
  type NotifyRequest,
  type Priority,
  type ServiceDeps,
  type SqlValue,
  type Unsubscribe,
} from '@fuber/shared';
import { attentionMode, decideChannel, PRIORITY_RANK, spokenAllowed, type AttentionMode } from './attention-rules';

const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'bildirim geçmişi',
    up: `CREATE TABLE attention_notifications (
      id TEXT PRIMARY KEY,
      module_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      priority TEXT NOT NULL,
      actions TEXT NOT NULL,
      speak TEXT,
      dedupe_key TEXT,
      data TEXT NOT NULL,
      status TEXT NOT NULL,
      channel TEXT,
      created_at TEXT NOT NULL,
      shown_at TEXT,
      resolved_at TEXT,
      action_id TEXT
    );
    CREATE INDEX attention_notifications_status ON attention_notifications (status);
    CREATE INDEX attention_notifications_dedupe ON attention_notifications (dedupe_key);`,
  },
];

/** Aynı anahtarlı bildirim bu süre içinde çözülmüş olsa da yeniden gösterilmez. */
export const DEDUPE_WINDOW_MS = 60_000;
/** Sessiz saat bitişi gibi olaysız değişimler için yoklama aralığı. */
const RECHECK_MS = 30_000;
export const DIGEST_MODULE_ID = 'attention';

interface Row {
  id: string;
  module_id: string;
  title: string;
  body: string;
  priority: string;
  actions: string;
  speak: string | null;
  dedupe_key: string | null;
  data: string;
  status: string;
  channel: string | null;
  created_at: string;
  shown_at: string | null;
  resolved_at: string | null;
  action_id: string | null;
}

const toNotification = (row: Row): Notification => ({
  id: row.id,
  moduleId: row.module_id,
  title: row.title,
  body: row.body,
  priority: row.priority as Priority,
  actions: JSON.parse(row.actions) as NotifyAction[],
  speak: row.speak,
  dedupeKey: row.dedupe_key,
  data: JSON.parse(row.data) as JsonObject,
  status: row.status as Notification['status'],
  channel: row.channel as AttentionChannel | null,
  createdAt: row.created_at,
  shownAt: row.shown_at,
  resolvedAt: row.resolved_at,
  actionId: row.action_id,
});

function speakText(request: NotifyRequest): string | null {
  if (typeof request.speak === 'string') return request.speak.trim() || null;
  if (request.speak === true) return [request.title, request.body].filter(Boolean).join('. ');
  return null;
}

export function createAttention(deps: ServiceDeps['attention']): AttentionApi {
  const log = deps.log.child('attention');
  const db = deps.store.scoped('attention');
  const subscriptions: Unsubscribe[] = [];
  let timer: ReturnType<typeof setInterval> | null = null;
  let ready = false;

  const ensure = () => {
    if (ready) return;
    deps.store.migrate('attention', MIGRATIONS);
    ready = true;
  };

  const quietByUser = (): boolean => {
    const settings = deps.settings.get();
    const now = new Date();
    if (settings.dnd && (!settings.dndUntil || Date.parse(settings.dndUntil) > now.getTime())) return true;
    return settings.quietHours.enabled && isWithinLocalTimeRange(now, settings.quietHours.from, settings.quietHours.to);
  };

  const mode = (): AttentionMode => attentionMode(deps.presence.get(), quietByUser());

  /**
   * Kanalı seçer ve kullanıcının "hangi bildirimler sesli okunsun" tercihini uygular: ses kanalı seçilse de bu
   * bildirime sesli okuma izin verilmiyorsa (düzey ya da susturulmuş modül) adaya düşürülür (yine görünür, okunmaz).
   */
  const channelFor = (priority: Priority, moduleId: string, speakable: boolean): AttentionChannel => {
    const channel = decideChannel(priority, mode(), speakable);
    if (channel !== 'voice') return channel;
    return spokenAllowed(priority, moduleId, deps.settings.get().spokenNotifications) ? 'voice' : 'island';
  };

  const read = (id: Id) => {
    const row = db.get<Row>('SELECT * FROM attention_notifications WHERE id = ?', [id]);
    return row ? toNotification(row) : null;
  };

  const patch = (id: Id, change: Partial<Record<keyof Row, SqlValue>>) => {
    const keys = Object.keys(change);
    db.run(`UPDATE attention_notifications SET ${keys.map((key) => `${key} = ?`).join(', ')} WHERE id = ?`, [
      ...keys.map((key) => change[key as keyof Row] as SqlValue),
      id,
    ]);
  };

  const show = (notification: Notification, channel: Exclude<AttentionChannel, 'deferred'>): Notification => {
    patch(notification.id, { status: 'shown', channel, shown_at: nowIso() });
    const shown = read(notification.id)!;
    deps.bus.emit('attention.notify', { notification: shown, channel });
    return shown;
  };

  const insert = (request: NotifyRequest): Notification => {
    const id = newId();
    db.run(
      `INSERT INTO attention_notifications (id, module_id, title, body, priority, actions, speak, dedupe_key, data, status,
         channel, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?)`,
      [
        id,
        request.moduleId,
        request.title,
        request.body ?? '',
        request.priority,
        JSON.stringify(request.actions ?? []),
        speakText(request),
        request.dedupeKey ?? null,
        JSON.stringify(request.data ?? {}),
        nowIso(),
      ],
    );
    return read(id)!;
  };

  /** Bekleyenler artık gösterilebiliyorsa tek özet olarak çıkar. */
  const flushDeferred = () => {
    if (!ready) return;
    const waiting = db
      .all<Row>(`SELECT * FROM attention_notifications WHERE status = 'pending' AND channel = 'deferred' ORDER BY id`)
      .map(toNotification);
    if (waiting.length === 0) return;
    const current = mode();
    const releasable = waiting.filter((item) => decideChannel(item.priority, current, item.speak !== null) !== 'deferred');
    if (releasable.length === 0) return;
    if (releasable.length === 1) {
      const only = releasable[0]!;
      show(only, channelFor(only.priority, only.moduleId, only.speak !== null) as Exclude<AttentionChannel, 'deferred'>);
      return;
    }
    const top = releasable.reduce<Priority>(
      (best, item) => (PRIORITY_RANK[item.priority] > PRIORITY_RANK[best] ? item.priority : best),
      'low',
    );
    const titles = releasable.map((item) => item.title);
    // Özet, yalnız SESLİ okunabilen (düzeyi yeten, modülü susturulmamış) bildirim varsa sesli okunur; diğerleri sessiz
    // özette toplanır (yine görünür).
    const prefs = deps.settings.get().spokenNotifications;
    const spoken = releasable.filter((item) => item.speak !== null && spokenAllowed(item.priority, item.moduleId, prefs));
    const digest = insert({
      moduleId: DIGEST_MODULE_ID,
      title: t('attention.digest.title', { count: releasable.length }),
      body: releasable.map((item) => (item.body ? `${item.title}: ${item.body}` : item.title)).join('\n'),
      priority: top,
      speak: spoken.length > 0 ? t('attention.digest.spoken', { count: spoken.length, list: spoken.map((item) => item.title).join(', ') }) : false,
      data: { ids: releasable.map((item) => item.id) },
    });
    // `digest.speak` yalnız sesli okunabilir bildirim varsa doludur; kanal kararı eskisi gibi (toplantıda ses yerine
    // sessiz toast, vb.). Bu yüzden ayrıca `channelFor` süzgecine gerek yok: `speak` zaten süzüldü.
    const channel = decideChannel(top, current, digest.speak !== null) as Exclude<AttentionChannel, 'deferred'>;
    const shownAt = nowIso();
    db.transaction(() => {
      for (const item of releasable) patch(item.id, { status: 'shown', channel, shown_at: shownAt });
    });
    show(digest, channel);
  };

  const api: AttentionApi = {
    start() {
      ensure();
      subscriptions.push(deps.bus.on('presence.changed', () => flushDeferred()));
      subscriptions.push(deps.bus.on('settings.changed', () => flushDeferred()));
      // İşler `attention`'a bağlanamaz (bağımlılık tablosu); bitişlerini olay yolundan duyup bildiririz.
      subscriptions.push(
        deps.bus.on('job.progress', ({ job }) => {
          if (job.status === 'done') {
            api.notify({
              moduleId: job.moduleId,
              title: t('attention.job.done', { title: job.title }),
              body: (job.resultText ?? '').slice(0, 400),
              priority: 'normal',
              dedupeKey: `job.${job.id}`,
              data: { jobId: job.id },
            });
          } else if (job.status === 'failed') {
            api.notify({
              moduleId: job.moduleId,
              title: t('attention.job.failed', { title: job.title }),
              body: job.error ?? '',
              priority: 'normal',
              dedupeKey: `job.${job.id}`,
              data: { jobId: job.id },
            });
          }
        }),
      );
      timer = setInterval(flushDeferred, RECHECK_MS);
      flushDeferred();
    },

    stop() {
      for (const off of subscriptions.splice(0)) off();
      if (timer) clearInterval(timer);
      timer = null;
    },

    notify(request) {
      ensure();
      if (request.dedupeKey) {
        const open = db.get<Row>(
          `SELECT * FROM attention_notifications WHERE dedupe_key = ? AND status IN ('pending', 'shown') ORDER BY id DESC LIMIT 1`,
          [request.dedupeKey],
        );
        if (open) {
          patch(open.id, {
            title: request.title,
            body: request.body ?? '',
            priority: request.priority,
            actions: JSON.stringify(request.actions ?? []),
            speak: speakText(request),
            data: JSON.stringify(request.data ?? {}),
          });
          return read(open.id)!;
        }
        const recent = db.get<Row>(
          `SELECT * FROM attention_notifications WHERE dedupe_key = ? AND created_at >= ? ORDER BY id DESC LIMIT 1`,
          [request.dedupeKey, new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString()],
        );
        if (recent) return toNotification(recent);
      }
      const notification = insert(request);
      const channel = channelFor(notification.priority, notification.moduleId, notification.speak !== null);
      if (channel === 'deferred') {
        patch(notification.id, { channel: 'deferred' });
        log.info(`bildirim bekletildi: ${notification.title}`);
        return read(notification.id)!;
      }
      return show(notification, channel);
    },

    dismiss(id) {
      ensure();
      const current = read(id);
      if (!current || current.status === 'dismissed' || current.status === 'acted') return;
      patch(id, { status: 'dismissed', resolved_at: nowIso() });
      deps.bus.emit('attention.dismiss', { id, reason: 'user' });
    },

    act(id, actionId) {
      ensure();
      const current = read(id);
      if (!current) return;
      patch(id, { status: 'acted', resolved_at: nowIso(), action_id: actionId });
      deps.bus.emit('attention.action', { id, moduleId: current.moduleId, actionId, data: current.data });
      deps.bus.emit('attention.dismiss', { id, reason: 'action' });
    },

    pending() {
      ensure();
      return db
        .all<Row>(`SELECT * FROM attention_notifications WHERE status IN ('pending', 'shown') ORDER BY id DESC`)
        .map(toNotification);
    },

    recent(limit) {
      ensure();
      return db.all<Row>('SELECT * FROM attention_notifications ORDER BY id DESC LIMIT ?', [limit]).map(toNotification);
    },

    forgetModule(moduleId) {
      ensure();
      const rows = db.all<{ id: string; status: string }>('SELECT id, status FROM attention_notifications WHERE module_id = ?', [moduleId]);
      if (rows.length === 0) return 0;
      db.run('DELETE FROM attention_notifications WHERE module_id = ?', [moduleId]);
      // Açık olanlar adadan, toast yığınından ve Bugün sayfasından da kalksın.
      for (const row of rows) {
        if (row.status === 'pending' || row.status === 'shown') deps.bus.emit('attention.dismiss', { id: row.id, reason: 'user' });
      }
      return rows.length;
    },
  };
  return api;
}
