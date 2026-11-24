// "Eklenti ayrıntısı": başka bir sayfadan Eklentiler sayfasına geçerken hangi eklentinin seçileceğini taşır.
// Sayfa henüz açık değilken istek kaçmasın diye son istek, sayfa onu alana dek tutulur.

let pending: string | null = null;
const listeners = new Set<(id: string) => void>();

/** Eklentiler sayfası açılınca bu eklentiyi seçsin. */
export function focusSkill(id: string): void {
  if (listeners.size === 0) pending = id;
  else for (const listener of listeners) listener(id);
}

/** Sayfa açılmadan önce gelmiş isteği bir kez verir. */
export function takeFocusedSkill(): string | null {
  const id = pending;
  pending = null;
  return id;
}

export function onFocusSkill(listener: (id: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
