// Cihaz türü: köprüye bağlanan her cihaz bir `quest` (gözlük) ya da `watch` (saat)tir. `pair.kind` varsa o, yoksa
// `model` önekinden çıkarılır ("Quest…" → quest, "Galaxy Watch…" / "Wear…" → watch). Bilinmeyen model quest sayılır
// (eski gözlük sürümleri tür göndermiyordu). Node bağımlılığı YOK: renderer da `import type` ile alabilir.

export type XrDeviceKind = 'quest' | 'watch';
export const XR_DEVICE_KINDS: readonly XrDeviceKind[] = ['quest', 'watch'];

export function deviceKindOf(model: string | undefined | null, kind?: unknown): XrDeviceKind {
  if (kind === 'quest' || kind === 'watch') return kind;
  const m = (model ?? '').trim().toLowerCase();
  if (m.startsWith('galaxy watch') || m.startsWith('wear') || m.startsWith('watch') || m.includes('galaxy watch')) return 'watch';
  return 'quest';
}
