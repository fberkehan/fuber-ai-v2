/**
 * Taslak ile yürürlükteki politika arasındaki fark. Saf işlevler: kaydet çubuğunun sayacı, yama ve
 * "başka yerden değişti" durumunda taslağın yeni sürümün üstüne yeniden kurulması buradan.
 * Diziler (uyandırma sözleri, yerel modeller) tek alan sayılır ve bütün olarak gönderilir (`mergePolicy`).
 */
import { DEFAULT_SUPERTONIC_VOICE, type Policy, type PolicyPatch, type TtsEngineId } from '@fuber/shared';

/** Yönetim'in düzenlediği üst düzey alanlar; sürüm, zaman, anahtar ve acil durdurma ayrı yollardan yönetilir. */
const EDITABLE = ['persona', 'models', 'providers', 'voice', 'brain', 'modules', 'ambient', 'limits', 'release'] as const;

type Plain = Record<string, unknown>;
const isPlain = (value: unknown): value is Plain => typeof value === 'object' && value !== null && !Array.isArray(value);

function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  // İsteğe bağlı metin alanı: yazılıp silinen ("") ile hiç olmayan aynıdır.
  if ((a === undefined && b === '') || (a === '' && b === undefined)) return true;
  // Sayı alanında silinmiş giriş NaN olur; NaN ≠ NaN, ama iki NaN aynı taslaktır.
  return JSON.stringify(a) === JSON.stringify(b) && !(typeof a === 'number' || typeof b === 'number');
}

function walk(base: unknown, draft: unknown, path: string[], out: string[][]): void {
  if (isPlain(base) && isPlain(draft)) {
    const keys = new Set([...Object.keys(base), ...Object.keys(draft)]);
    for (const key of keys) walk(base[key], draft[key], [...path, key], out);
    return;
  }
  if (!same(base, draft)) out.push(path);
}

/** Değişen yaprak yolları: `[['persona','name'], ['modules','web','enabled']]`. */
export function changedPaths(base: Policy, draft: Policy): string[][] {
  const out: string[][] = [];
  for (const key of EDITABLE) walk(base[key], draft[key], [key], out);
  return out;
}

export function getIn(source: unknown, path: readonly string[]): unknown {
  let node = source;
  for (const key of path) {
    if (!isPlain(node)) return undefined;
    node = node[key];
  }
  return node;
}

/**
 * Değişmez güncelleme: yol boyunca kopyalar. Yapraktaki `undefined` alanı nesneden siler (isteğe bağlı alanı
 * "varsayılana döndürmek"); `{ voiceId: undefined }` kalsaydı alan hâlâ var sayılırdı.
 */
export function setIn<T>(source: T, path: readonly string[], value: unknown): T {
  if (path.length === 0) return value as T;
  const [head, ...rest] = path as [string, ...string[]];
  const node = (isPlain(source) ? source : {}) as Plain;
  if (rest.length === 0 && value === undefined) {
    const { [head]: _removed, ...kept } = node;
    return kept as T;
  }
  return { ...node, [head]: setIn(node[head], rest, value) } as T;
}

/**
 * Kayıt yaması. Taslakta kaldırılan isteğe bağlı alan (`voice.tts.voiceId` "sağlayıcının varsayılanı"na döndü)
 * `null` olarak gider: `undefined` IPC'de ve birleştirmede "değişmedi" sayılır, alan politikada kalırdı.
 * Kontrol servisi `null`'ı şemada `null` alamayan alanda "kaldır" diye okur (`mergeWithRemovals`).
 */
export function buildPatch(draft: Policy, paths: string[][]): PolicyPatch {
  let patch: Plain = {};
  for (const path of paths) {
    const value = getIn(draft, path);
    patch = setIn(patch, path, value === undefined ? null : value);
  }
  return patch as PolicyPatch;
}

/** Yeni gelen politikanın üstüne taslaktaki değişiklikleri yeniden koyar. */
export function rebase(next: Policy, draft: Policy, paths: string[][]): Policy {
  let out = next;
  for (const path of paths) out = setIn(out, path, getIn(draft, path));
  return out;
}

/** Değişiklik notu ve kullanıcıya gösterilen alan adları için yolun ilk iki parçası. */
export function pathGroup(path: string[]): string {
  if (path[0] === 'modules') return 'modules';
  return path.slice(0, 2).join('.');
}

/**
 * Seslendirme motoru değişince `voice.tts` alanları: eski motorun `voiceId` / `model` değeri yeni motorda
 * anlamsızdır (Supertonic'te ElevenLabs ses kimliği, ElevenLabs'te `M4`). Supertonic `voiceId` alır (verilmezse
 * varsayılan), `model` kalkar; öteki yerel motorlar ve ElevenLabs ikisini de bırakır (`undefined` = alan kalkar).
 */
export function ttsEngineEdits(engine: TtsEngineId, voiceId?: string): Array<[string[], unknown]> {
  return [
    [['voice', 'tts', 'provider'], engine],
    [['voice', 'tts', 'voiceId'], engine === 'supertonic' ? (voiceId ?? DEFAULT_SUPERTONIC_VOICE) : undefined],
    [['voice', 'tts', 'model'], undefined],
  ];
}
