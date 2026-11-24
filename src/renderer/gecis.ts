// ── Görünüm geçişi (View Transitions) — atlanan geçiş konsolu kirletmesin ─────────────────────────────────────────────
// Üst üste gelen geçişte (kokpit yeniden dizilirken tema da değişti, ya da pencere gizliyken) tarayıcı öncekini atlar ve
// `ready` sözü "AbortError: Transition was skipped" ile reddedilir; yakalanmazsa her seferinde konsol hatası olur (Görev 19
// denetiminde kokpitte görüldü). Geçiş yoksa değişiklik doğrudan yapılır. `updateCallbackDone` yakalanmaz: değiştiricinin
// kendi hatası gizlenmesin.
type Gecis = { ready?: Promise<unknown>; finished?: Promise<unknown> } | undefined;
type GecisliBelge = { startViewTransition?: (f: () => void) => Gecis };

export function gorunumGecisi(degistir: () => void, belge: GecisliBelge = document as unknown as GecisliBelge): void {
  const vt = belge.startViewTransition;
  if (typeof vt !== 'function') { degistir(); return; }
  const g = vt.call(belge, degistir);
  g?.ready?.catch(() => undefined);
  g?.finished?.catch(() => undefined);
}
