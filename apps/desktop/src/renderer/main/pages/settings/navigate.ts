// Sesle gezinme ("ses ayarlarını aç", `app_navigate` aracı) ana süreçten `app.navigate { page: 'settings', params: { tab } }`
// yayınlar. Kabuk parametreleri sayfaya taşımaz; sayfa henüz açık değilken gelen istek de kaçmasın diye dinleyici modül
// yüklenirken kurulur ve son istek sayfa onu alana dek tutulur (`pages/projects/live/navigate.ts` ile aynı düzen).

// Ayarlar'ın bölüm kimlikleri (gezgin sırasıyla). `local-commands.ts` › `SPOKEN_PAGES`'in `tab` alanları bunlardan biridir.
export const SETTINGS_TABS = ['general', 'voice', 'briefing', 'hotkeys', 'privacy', 'mail', 'connection', 'diagnostics'] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

let pending: SettingsTab | null = null;
const listeners = new Set<(tab: SettingsTab) => void>();

if (typeof window !== 'undefined' && window.fuber) {
  window.fuber.on('app.navigate', ({ page, params }) => {
    const tab = SETTINGS_TABS.find((id) => id === params?.tab);
    if (page !== 'settings' || !tab) return;
    if (listeners.size === 0) pending = tab;
    else for (const listener of listeners) listener(tab);
  });
}

/** Arayüzün kendisinden sekme isteği (ör. Hızlı kontrol › Ortam: rıza Gizlilik'te verilir); ardından Ayarlar'a gidilir. */
export function requestSettingsTab(tab: SettingsTab): void {
  if (listeners.size === 0) pending = tab;
  else for (const listener of listeners) listener(tab);
}

/** Sayfa açılmadan önce gelmiş sekme isteğini bir kez verir. */
export function takeSettingsTab(): SettingsTab | null {
  const tab = pending;
  pending = null;
  return tab;
}

export function onSettingsTab(listener: (tab: SettingsTab) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
