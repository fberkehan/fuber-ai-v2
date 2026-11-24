// Canlı oturum deposu (v1 `renderer/claudecode/depo.ts`'ten): oturum özetleri `projects.claudeEvent` ile güncel tutulur;
// ekranda olan oturumun dökümü (`TranscriptModel`) ilk açılışta anlık görüntüden kurulur, sonra olaylar `seq` sırasıyla uygulanır.
import { useEffect, useSyncExternalStore } from 'react';
import type {
  LiveEnvelope,
  LiveEnvironment,
  LiveSessionDetail,
  LiveSessionSummary,
} from '../../../../../main/modules/projects/claude/types';
import { fuber } from '../shared';
import { TranscriptModel } from './model';

/** Ekrandaki oturumun yüklü hâli. `detail.events` kullanılmaz (döküm `model`dedir); kalan alanlar canlı tutulur. */
export interface LoadedSession {
  detail: LiveSessionDetail;
  model: TranscriptModel;
  lastSeq: number;
}

type Listener = () => void;

class LiveStore {
  private sessions = new Map<string, LiveSessionSummary>();
  private loaded = new Map<string, LoadedSession>();
  private loading = new Map<string, Promise<LoadedSession | null>>();
  /** Yükleme sürerken gelen olaylar: anlık görüntüden sonra `seq`'i büyük olanlar uygulanır. */
  private buffers = new Map<string, LiveEnvelope[]>();
  private refreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private listeners = new Set<Listener>();
  private users = 0;
  private off: (() => void) | null = null;
  private listCache: LiveSessionSummary[] = [];
  private environmentValue: LiveEnvironment | null = null;
  private environmentPending: Promise<void> | null = null;
  /** İlk liste geldi mi (boş durum ile "yükleniyor" ayrımı). */
  ready = false;
  version = 0;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit(): void {
    this.version++;
    this.listCache = [...this.sessions.values()];
    for (const listener of this.listeners) listener();
  }

  /** Olay aboneliği sayfa açıkken yaşar (ilk kullanıcıda kurulur, son kullanıcı ayrılınca kalkar). */
  retain(): () => void {
    if (this.users++ === 0) {
      this.off = fuber().on('projects.claudeEvent', (envelope) => this.apply(envelope));
      void this.refreshList();
      void this.refreshEnvironment();
    }
    return () => {
      if (--this.users > 0) return;
      this.off?.();
      this.off = null;
    };
  }

  async refreshList(): Promise<void> {
    try {
      const list = await fuber().invoke('projects.claudeSessions');
      const next = new Map<string, LiveSessionSummary>();
      for (const session of list) next.set(session.id, session);
      this.sessions = next;
    } catch {
      // Modül kapalıysa kanal bağlı değildir: liste boş kalır.
    }
    this.ready = true;
    this.emit();
  }

  list = (): LiveSessionSummary[] => this.listCache;
  summary = (id: string | null): LiveSessionSummary | null => (id ? (this.sessions.get(id) ?? null) : null);
  session = (id: string | null): LoadedSession | null => (id ? (this.loaded.get(id) ?? null) : null);
  environment = (): LiveEnvironment | null => this.environmentValue;

  /** Bu Claude Code oturum kimliğiyle (dizindeki `CodeSession.id`) yaşayan kayıt. */
  byCliSession(sessionId: string): LiveSessionSummary | null {
    let best: LiveSessionSummary | null = null;
    for (const session of this.sessions.values()) {
      if (session.sessionId !== sessionId || session.status === 'closed') continue;
      if (!best || session.lastActivityAt > best.lastActivityAt) best = session;
    }
    return best;
  }

  refreshEnvironment(): Promise<void> {
    this.environmentPending ??= fuber()
      .invoke('projects.claudeEnvironment')
      .then((environment) => {
        this.environmentValue = environment;
        this.emit();
      })
      .catch(() => {})
      .finally(() => {
        this.environmentPending = null;
      });
    return this.environmentPending;
  }

  /** Başlatma/sürdürme yanıtındaki özeti hemen listeye koyar (olay gelmeden görünüm açılabilsin). */
  upsert(summary: LiveSessionSummary): void {
    this.sessions.set(summary.id, summary);
    const loaded = this.loaded.get(summary.id);
    if (loaded) this.loaded.set(summary.id, { ...loaded, detail: { ...loaded.detail, ...summary } });
    this.emit();
  }

  /** Oturumun dökümünü yükler (bir kez; sonraki çağrılar aynı sözü döndürür). */
  load(id: string): Promise<LoadedSession | null> {
    const ready = this.loaded.get(id);
    if (ready) return Promise.resolve(ready);
    let pending = this.loading.get(id);
    if (pending) return pending;
    this.buffers.set(id, []);
    pending = fuber()
      .invoke('projects.claudeSession', { id })
      .then((detail) => {
        if (!detail) return null;
        const model = new TranscriptModel();
        model.applyAll(detail.events.map((envelope) => ({ event: envelope.event, at: envelope.at })));
        // Bekleyen izinler döküm sınırında kaybolmuş olabilir: anlık görüntüden yeniden eklenir (var olan yinelenmez).
        for (const request of detail.permissions) model.apply(request);
        const lastSeq = detail.events.reduce((max, envelope) => Math.max(max, envelope.seq), 0);
        const entry: LoadedSession = { detail: { ...detail, events: [] }, model, lastSeq };
        this.loaded.set(detail.id, entry);
        this.sessions.set(detail.id, summaryOf(detail));
        const buffered = this.buffers.get(id) ?? [];
        this.buffers.delete(id);
        for (const envelope of buffered) if (envelope.seq > lastSeq) this.applyLoaded(envelope);
        this.emit();
        return this.loaded.get(detail.id) ?? entry;
      })
      .catch(() => null)
      .finally(() => {
        this.loading.delete(id);
        this.buffers.delete(id);
      });
    this.loading.set(id, pending);
    return pending;
  }

  /** Ekranda olmayan oturumun dökümü bırakılır (yeniden açılınca ana süreçten yüklenir). */
  unload(id: string): void {
    if (this.loaded.delete(id)) this.emit();
  }

  /** Kuyruk, değişen dosyalar ve komut listesi olay taşımaz: özet değişince ayrıntıdan tazelenir. */
  private scheduleRefresh(id: string): void {
    if (this.refreshTimers.has(id)) return;
    this.refreshTimers.set(
      id,
      setTimeout(() => {
        this.refreshTimers.delete(id);
        void this.refreshMeta(id);
      }, 150),
    );
  }

  async refreshMeta(id: string): Promise<void> {
    if (!this.loaded.has(id)) return;
    const detail = await fuber()
      .invoke('projects.claudeSession', { id })
      .catch(() => null);
    const current = this.loaded.get(id);
    if (!detail || !current) return;
    this.loaded.set(id, {
      ...current,
      detail: { ...current.detail, queue: detail.queue, changedFilesList: detail.changedFilesList, commands: detail.commands, todos: detail.todos, tasks: detail.tasks },
    });
    this.emit();
  }

  private apply(envelope: LiveEnvelope): void {
    const { session: id, event } = envelope;
    if (event.type === 'forgotten') {
      this.sessions.delete(id);
      this.loaded.delete(id);
      this.emit();
      return;
    }
    if (event.type === 'status') this.sessions.set(id, event.summary);
    const buffer = this.buffers.get(id);
    if (buffer) buffer.push(envelope);
    else if (this.loaded.has(id)) this.applyLoaded(envelope);
    // Yüklü olmayan oturumda yalnız özet değişir; onu da yalnız durum olayı taşır.
    if (event.type === 'status' || this.loaded.has(id)) this.emit();
  }

  private applyLoaded(envelope: LiveEnvelope): void {
    const entry = this.loaded.get(envelope.session);
    if (!entry || envelope.seq <= entry.lastSeq) return;
    const { event } = envelope;
    let detail = entry.detail;
    switch (event.type) {
      case 'status': {
        const before = detail;
        detail = { ...detail, ...event.summary };
        if (before.queued !== event.summary.queued || before.changedFiles !== event.summary.changedFiles || before.status !== event.summary.status) {
          this.scheduleRefresh(envelope.session);
        }
        break;
      }
      case 'permission_request':
        if (!detail.permissions.some((request) => request.requestId === event.requestId)) detail = { ...detail, permissions: [...detail.permissions, event] };
        break;
      case 'permission_resolved':
        detail = { ...detail, permissions: detail.permissions.filter((request) => request.requestId !== event.requestId) };
        break;
      case 'todos':
        if (event.parent === null) detail = { ...detail, todos: event.items };
        break;
      case 'tasks':
        detail = { ...detail, tasks: event.tasks };
        break;
      case 'init':
        // Komut ve beceri listesi ilk `init`ten sonra dolar.
        this.scheduleRefresh(envelope.session);
        break;
      default:
        break;
    }
    entry.model.apply(event, envelope.at);
    this.loaded.set(envelope.session, { detail, model: entry.model, lastSeq: envelope.seq });
  }
}

function summaryOf(detail: LiveSessionDetail): LiveSessionSummary {
  const { events: _events, permissions: _permissions, queue: _queue, changedFilesList: _files, todos: _todos, tasks: _tasks, commands: _commands, ...summary } = detail;
  return summary;
}

export const liveStore = new LiveStore();

const useVersion = () => useSyncExternalStore(liveStore.subscribe, () => liveStore.version);

/** Sayfa açıkken olay aboneliğini yaşatır. */
export function useLiveRetain(): void {
  useEffect(() => liveStore.retain(), []);
}

export function useLiveSessions(): { sessions: LiveSessionSummary[]; ready: boolean } {
  useVersion();
  return { sessions: liveStore.list(), ready: liveStore.ready };
}

export function useLiveEnvironment(): LiveEnvironment | null {
  useVersion();
  return liveStore.environment();
}

/** Oturumun yüklü hâli; ilk kullanımda yükler. Yüklenene dek `null`. */
export function useLoadedSession(id: string | null): LoadedSession | null {
  useVersion();
  useEffect(() => {
    if (id) void liveStore.load(id);
  }, [id]);
  return liveStore.session(id);
}
