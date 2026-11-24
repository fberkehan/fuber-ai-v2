// Bildirimdeki "Oturumu aç" eylemi ana süreçten `app.navigate { page: 'projects', params: { tab: 'sessions', live } }` yayınlar.
// Kabuk parametreleri sayfaya taşımaz; sayfa henüz açık değilken gelen istek de kaçmasın diye dinleyici modül yüklenirken
// kurulur (sayfalar açılışta yüklenir) ve son istek sayfa onu alana dek tutulur.

export interface ProjectsNavigation {
  tab?: 'projects' | 'sessions';
  /** Seçilecek canlı oturumun uygulama içi kimliği. */
  live?: string;
}

let pending: ProjectsNavigation | null = null;
const listeners = new Set<(target: ProjectsNavigation) => void>();

if (typeof window !== 'undefined' && window.fuber) {
  window.fuber.on('app.navigate', ({ page, params }) => {
    if (page !== 'projects' || !params) return;
    const target: ProjectsNavigation = {
      ...(params.tab === 'sessions' || params.tab === 'projects' ? { tab: params.tab } : {}),
      ...(typeof params.live === 'string' && params.live ? { live: params.live } : {}),
    };
    if (!target.tab && !target.live) return;
    if (listeners.size === 0) pending = target;
    else for (const listener of listeners) listener(target);
  });
}

/** Sayfa açılmadan önce gelmiş isteği bir kez verir. */
export function takeNavigation(): ProjectsNavigation | null {
  const target = pending;
  pending = null;
  return target;
}

export function onNavigation(listener: (target: ProjectsNavigation) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
