// İşlerin saf kuralları: aralık, koşul değerlendirmesi (yapay zekâsız), sayı okuma, değişiklik anlatımı. İnsan dili
// `describe.ts`. Zaman, ağ ve veritabanı yok; birim sınamalı (`rules.test.ts`). Fuber AI 1 `shared/isler.ts`
// kurallarından uyarlandı: aralık ×1,5 büyür (yukarı yuvarlanır), değişince en kısaya döner; sınırlar katı.
import { createHash } from 'node:crypto';
import { foldForSearch, t } from '@fuber/shared';
import { clipText as clip, numberText } from './describe';
import type { WatchCondition, WatchPlan } from './types';

/** v1 ile aynı: değişiklik yokken aralık bu kadar büyür. */
export const INTERVAL_FACTOR = 1.5;
/** En kısa denetim aralığı (sn). Saat kaynağı bunun dışındadır: tam vaktinde uyanır. */
export const MIN_INTERVAL_SEC = 10;
/** En uzun denetim aralığı (sn). */
export const MAX_INTERVAL_SEC = 3600;
/** Varsayılan ve en uzun iş süresi. v1'de 24 saatti; "ilan çıkınca söyle" gibi işler günler sürebildiği için 7 gün. */
export const DEFAULT_DURATION_HOURS = 24;
export const MAX_DURATION_HOURS = 24 * 7;
/** İş başına model çağrısı bütçesi (yalnız `ask` koşulu çağırır). */
export const DEFAULT_MODEL_CALLS = 20;
export const MAX_MODEL_CALLS = 100;
/** Aynı anda en çok kaç iş çalışır (V1-DENKLIK G5 kabulü; Yönetim `modules.watch.config.maxActive` ile değiştirir). */
export const DEFAULT_MAX_ACTIVE = 3;
/** Üst üste bu kadar başarısız denetimde iş duraklar (kaynak geçici olarak çökmüş olabilir: hemen bırakılmaz). */
export const MAX_ERRORS = 5;
/** Değişiklik anlatımı için saklanan önceki metnin en çok uzunluğu. */
export const BASELINE_CHARS = 20_000;
/** Koşulların ve düzenli ifadenin baktığı en çok metin (uzun sayfada düzenli ifade süresi sınırlı kalsın). */
export const EVAL_CHARS = 60_000;

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** İçeriğin imzası (kısa SHA-256). Metin olduğu gibi karşılaştırılmaz; yalnız boşluk farkları yok sayılır. */
export function signatureOf(text: string): string {
  return createHash('sha256').update(text.replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 24);
}

/**
 * Sonraki aralık (sn): değişti → en kısa; değişmedi → ×1,5 (yukarı yuvarlanır), en çok `maxSec`.
 * v1 `sonrakiAralik` ile aynı sonuçlar: 10 → 15, 23, 35, 53, 60 (max 60).
 */
export function nextInterval(current: number, changed: boolean, interval: WatchPlan['interval']): number {
  if (changed) return interval.minSec;
  return clamp(Math.ceil(current * INTERVAL_FACTOR), interval.minSec, interval.maxSec);
}

/** Planın aralığını kaynağın sınırlarına ve genel sınırlara oturtur. */
export function fitInterval(requested: { minSec?: number; maxSec?: number }, source: { minIntervalSec: number; maxIntervalSec: number }): WatchPlan['interval'] {
  const floor = Math.max(MIN_INTERVAL_SEC, source.minIntervalSec);
  const minSec = clamp(Math.round(requested.minSec ?? floor), floor, MAX_INTERVAL_SEC);
  const maxSec = clamp(Math.round(requested.maxSec ?? Math.max(minSec, source.maxIntervalSec)), minSec, MAX_INTERVAL_SEC);
  return { minSec, maxSec };
}

// ───────────────────────────── metin ve sayı ─────────────────────────────

const fold = (text: string) => foldForSearch(text).replace(/\s+/g, ' ');

/** Metinde (Türkçe harf ve büyük/küçük harf duyarsız) geçiyor mu. */
export function containsFolded(text: string, needle: string): boolean {
  const n = fold(needle).trim();
  return n.length > 0 && fold(text).includes(n);
}

const NUMBER = /[-−]?\d{1,3}(?:[.,  ]\d{3})+(?:[.,]\d+)?|[-−]?\d+(?:[.,]\d+)?/g;

/**
 * Yazıdaki sayıyı okur: "1.299,90" (Türkçe), "1,299.90" (İngilizce), "12,5", "1 299". Ayırıcı birden çoksa sonuncusu
 * ondalıktır; tek ayırıcı ve ardından tam üç basamak varsa binlik sayılır ("1.299" = 1299).
 */
export function parseNumber(raw: string): number | null {
  let text = raw.replace(/[−]/g, '-').replace(/[  ]/g, '');
  const dots = (text.match(/\./g) ?? []).length;
  const commas = (text.match(/,/g) ?? []).length;
  if (dots && commas) {
    const decimal = text.lastIndexOf('.') > text.lastIndexOf(',') ? '.' : ',';
    const thousands = decimal === '.' ? ',' : '.';
    text = text.split(thousands).join('').replace(decimal, '.');
  } else if (dots + commas > 1) {
    text = text.replace(/[.,]/g, '');
  } else if (dots + commas === 1) {
    const [, after = ''] = text.split(/[.,]/);
    text = after.length === 3 ? text.replace(/[.,]/, '') : text.replace(',', '.');
  }
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/**
 * Metindeki ilgili sayı: `near` verilirse o sözcükten SONRAKİ ilk sayı (80 karakter içinde), yoksa ondan önceki son
 * sayı (40 karakter içinde); `near` yoksa metindeki ilk sayı.
 */
export function numberIn(text: string, near?: string): number | null {
  const body = text.slice(0, EVAL_CHARS);
  if (!near?.trim()) {
    const first = body.match(NUMBER)?.[0];
    return first ? parseNumber(first) : null;
  }
  const folded = foldForSearch(body);
  const key = foldForSearch(near.trim());
  const at = folded.indexOf(key);
  // Yanındaki sözcük sayfada hiç yoksa (model "bin" gibi bir sözcük verdi) ilk sayıya bakılır: hiç haber vermemekten iyidir.
  if (at === -1) return numberIn(body);
  const after = body.slice(at + key.length, at + key.length + 80).match(NUMBER)?.[0];
  if (after) return parseNumber(after);
  const before = body.slice(Math.max(0, at - 40), at).match(NUMBER);
  return before?.length ? parseNumber(before[before.length - 1]!) : null;
}

/** Düzenli ifade geçerli ve makul mü (uzunluk; modelin verdiği desen). */
export function compilePattern(pattern: string): RegExp | null {
  if (!pattern.trim() || pattern.length > 200) return null;
  try {
    return new RegExp(pattern, 'iu');
  } catch {
    return null;
  }
}

/** Satır düzeyinde yeni eklenen satırlar (önceki metinde olmayan), en çok `limit` tanesi. */
export function addedLines(before: string, after: string, limit = 3): string[] {
  const seen = new Set(before.split(/\r?\n/).map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean));
  const out: string[] = [];
  for (const raw of after.split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line || seen.has(line)) continue;
    seen.add(line);
    out.push(line.length > 160 ? `${line.slice(0, 159)}…` : line);
    if (out.length >= limit) break;
  }
  return out;
}

// ───────────────────────────── koşul ─────────────────────────────

export interface EvalState {
  /** Bu denetimin metni. */
  text: string;
  /** Önceki denetimin metni (saklandığı kadarıyla); ilk denetimde `null`. */
  previousText: string | null;
  /** Önceki denetimde okunan sayı. */
  previousValue: number | null;
  /** Önceki denetimde koşul tutuyor muydu (kenar tetikleme: tekrarlı işte aynı durum yeniden haber verilmez). */
  previousMatch: boolean;
  /** İlk denetim (taban kaydı). */
  first: boolean;
  /** İmza değişti mi (`events` kaynağında: yeni olay var mı). */
  changed: boolean;
  /** Kaynağın kendi anlatımı. */
  sourceFinding?: string;
}

export interface EvalResult {
  /** Koşul şimdi tutuyor mu (durum). */
  holds: boolean;
  /** Haber verilmeli mi (kenar: tutmuyordu → tutuyor; `changed`te her değişiklik). */
  fire: boolean;
  /** Bu denetimde okunan sayı (sayı koşullarında). */
  value: number | null;
  /** Haberin kısa anlatımı. */
  finding: string;
  /** `ask`: model gerekiyor (değişiklik var, koşulu kod veremez). */
  needsModel: boolean;
}

/** Değişikliğin anlatımı: kaynağın kendi cümlesi, yoksa yeni satırlar, o da yoksa "içerik değişti". */
export function changeFinding(state: Pick<EvalState, 'text' | 'previousText' | 'sourceFinding'>): string {
  if (state.sourceFinding) return state.sourceFinding;
  if (state.previousText === null) return clip(state.text, 300) || t('watch.finding.changed');
  const lines = addedLines(state.previousText, state.text);
  return lines.length ? t('watch.finding.newLines', { lines: lines.join(' · ') }) : t('watch.finding.changed');
}

/**
 * Koşulu YAPAY ZEKÂSIZ değerlendirir. Kenar tetikleme: `appears/disappears/matches/below/above` koşulu tutmuyorken
 * tutmaya geçince haber verir (ilk denetimde de: "zaten öyle" de bir haberdir). `changed` ve `drops/rises` bir taban
 * ister: ilk denetim yalnız taban kaydeder. `ask` yalnız değişiklikte modele gider.
 */
export function evaluate(condition: WatchCondition, state: EvalState, mode: 'state' | 'events' = 'state'): EvalResult {
  const text = state.text.slice(0, EVAL_CHARS);
  const none = (holds = false): EvalResult => ({ holds, fire: false, value: null, finding: '', needsModel: false });
  // Olay kaynağında metin yalnız yeni olaylardır: boşsa hiçbir koşul tutmaz.
  if (mode === 'events' && !text.trim()) return none();
  const edge = (holds: boolean, finding: string, value: number | null = null): EvalResult => ({
    holds,
    fire: holds && (mode === 'events' || !state.previousMatch),
    value,
    finding,
    needsModel: false,
  });
  switch (condition.type) {
    case 'changed': {
      const fire = mode === 'events' ? true : !state.first && state.changed;
      return { holds: fire, fire, value: null, finding: fire ? changeFinding(state) : '', needsModel: false };
    }
    case 'appears': {
      const holds = containsFolded(text, condition.text);
      return edge(holds, holds ? t('watch.finding.appears', { text: clip(condition.text, 80) }) : '');
    }
    case 'disappears': {
      const holds = !containsFolded(text, condition.text);
      return edge(holds, holds ? t('watch.finding.disappears', { text: clip(condition.text, 80) }) : '');
    }
    case 'matches': {
      const pattern = compilePattern(condition.pattern);
      const hit = pattern?.exec(text)?.[0];
      return edge(Boolean(hit), hit ? t('watch.finding.matches', { text: clip(hit, 120) }) : '');
    }
    case 'below':
    case 'above': {
      const value = numberIn(text, condition.near);
      if (value === null) return none();
      const holds = condition.type === 'below' ? value < condition.value : value > condition.value;
      const key = condition.type === 'below' ? 'watch.finding.below' : 'watch.finding.above';
      return edge(holds, holds ? t(key, { value: numberText(value), limit: numberText(condition.value) }) : '', value);
    }
    case 'drops':
    case 'rises': {
      const value = numberIn(text, condition.near);
      if (value === null) return none();
      if (state.previousValue === null) return { ...none(), value };
      const holds = condition.type === 'drops' ? value < state.previousValue : value > state.previousValue;
      const key = condition.type === 'drops' ? 'watch.finding.drops' : 'watch.finding.rises';
      return { holds, fire: holds, value, finding: holds ? t(key, { from: numberText(state.previousValue), to: numberText(value) }) : '', needsModel: false };
    }
    case 'ask': {
      const changed = mode === 'events' ? true : !state.first && state.changed;
      return { holds: false, fire: false, value: null, finding: changed ? changeFinding(state) : '', needsModel: changed };
    }
  }
}

/** Koşul ilk denetimde haber verebilir mi (taban istemeyen koşullar). Onay kartı ve sınamalar için. */
export const firesOnFirstCheck = (condition: WatchCondition): boolean =>
  condition.type === 'appears' || condition.type === 'disappears' || condition.type === 'matches' || condition.type === 'below' || condition.type === 'above';
