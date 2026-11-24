// v1 satırı → v2 kayıt girdisi. Saf işlevler: veritabanı ve servis yok, sınamada doğrudan çalışır.
import { createHash } from 'node:crypto';
import {
  formatDay,
  fromLocal,
  localDay,
  localTime,
  nextOccurrence,
  t,
  type IsoDateTime,
  type MemoryKind,
  type MemorySaveInput,
  type Priority,
  type Recurrence,
  type ReminderInput,
  type TodoInput,
} from '@fuber/shared';
import { looksSecret } from './secrets';
import type { V1IssueRow, V1MemoryRow, V1ReminderRow, V1TodoRow } from './v1-source';
import type { V1Table } from './types';

/** v1'de hafıza metni 4.000, başlıklar 200 karakterle sınırlıydı; v2'de aynı tavanlar. */
const MEMORY_TEXT_MAX = 4000;
const TITLE_MAX = 300;
const NOTES_MAX = 4000;

export type Rejection = 'invalid' | 'secret';
export type Mapped<T> = { ok: true; value: T; hash: string } | { ok: false; reason: Rejection };

const clean = (value: string | null | undefined): string => (value ?? '').replace(/\r\n?/g, '\n').trim();
const oneLine = (value: string): string => value.replace(/\s+/g, ' ').trim();
const cap = (value: string, max: number): string => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

/** Geçerli ISO an ya da `null`. */
export function parseInstant(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Yıl her zaman yazılı mutlak gün: "12 Ekim 2026" (`formatDay` yılı yalnız `now`'dan farklıysa yazar). */
const absoluteDay = (date: Date): string => formatDay(date, new Date(0));

/** İçerik özeti: aynı içerik ikinci kez (başka v1 kimliğiyle de olsa) aktarılmasın. */
export function contentHash(table: V1Table, ...parts: Array<string | number | null | undefined>): string {
  const normalized = parts.map((part) => oneLine(String(part ?? '')).toLocaleLowerCase('tr-TR')).join('\u0000');
  return createHash('sha256').update(`${table}\u0000${normalized}`).digest('hex').slice(0, 32);
}

// ───────────── hafıza ─────────────

/** v1 hafıza türü → v2 katmanı. `olay` bir anıdır; `gorev` verilmiş sözdür; geri kalanı kalıcı bilgidir. */
export function memoryKindOf(tur: string | null): MemoryKind {
  if (tur === 'olay') return 'episode';
  if (tur === 'gorev') return 'commitment';
  return 'fact';
}

/** v1 önemi 1–5 (varsayılan 3) → v2 0–1 (varsayılan 0,5). */
export function importanceOf(onem: number | null): number {
  const value = Number.isFinite(onem) ? Math.min(5, Math.max(1, Math.round(Number(onem)))) : 3;
  return (value - 1) / 4;
}

/**
 * v1 `kaynak` alanı → güven. Kullanıcının kendisinden gelen (kurulum, elle ekleme, Ayarlar) 1; sohbetten ya da
 * belgeden çıkarım 0,8 (v2 yazıcısının varsayılanı); gün kaydı, gün dönümü ve kaynağı bilinmeyen 0,7.
 */
export function confidenceOf(kaynak: string | null): number {
  const parts = clean(kaynak)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.some((part) => part === 'kurulum' || part === 'kullanici' || part === 'ayarlar')) return 1;
  if (parts.some((part) => part.startsWith('sohbet:') || part.startsWith('dosya:') || part.startsWith('belge:'))) return 0.8;
  return 0.7;
}

function parseTags(raw: string | null): string[] {
  try {
    const value: unknown = JSON.parse(raw ?? '[]');
    return Array.isArray(value) ? value.filter((tag): tag is string => typeof tag === 'string').map(oneLine).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/** "Başlık: içerik"; içerik başlıkla başlıyorsa yinelenmez, biri boşsa öteki tek başına. */
function joinTitle(title: string, body: string): string {
  if (!body) return title;
  if (!title) return body;
  return body.toLocaleLowerCase('tr-TR').startsWith(title.toLocaleLowerCase('tr-TR')) ? body : `${title}: ${body}`;
}

export function mapMemory(row: V1MemoryRow): Mapped<MemorySaveInput> {
  const title = oneLine(clean(row.baslik));
  const body = clean(row.icerik);
  const text = cap(joinTitle(title, body), MEMORY_TEXT_MAX);
  if (!text) return { ok: false, reason: 'invalid' };
  if (looksSecret(title, body)) return { ok: false, reason: 'secret' };
  const tur = clean(row.tur) || 'bilgi';
  const at = (tur === 'olay' ? parseInstant(row.olay_tarihi) : null) ?? parseInstant(row.olusturma) ?? parseInstant(row.olay_tarihi);
  const tags = [...new Set(['v1', `v1:${tur}`, ...parseTags(row.etiketler)])].slice(0, 14);
  return {
    ok: true,
    hash: contentHash('hafizalar', tur, title, body),
    value: {
      kind: memoryKindOf(tur),
      text,
      source: 'import',
      subject: (tur === 'kisi' || tur === 'proje') && title ? cap(title, 120) : null,
      tags,
      confidence: confidenceOf(row.kaynak),
      importance: importanceOf(row.onem),
      pinned: row.sabit === 1,
      // Aktarılan kayıt "yeni" sayılmasın: son değişme anı da kaydın kendi tarihidir (v1 ayrı bir güncelleme anı tutmuyor).
      ...(at ? { at: at.toISOString(), updatedAt: at.toISOString() } : {}),
    },
  };
}

/** v1 satırının asıl zaman damgaları: Planlar'a kaydın oluşturulma ve bitirilme anı olarak verilir. */
export function v1Stamps(row: { olusturma?: string | null; tamamlanma?: string | null }): { createdAt?: IsoDateTime; doneAt?: IsoDateTime } {
  const created = parseInstant(row.olusturma);
  const finished = parseInstant(row.tamamlanma);
  return {
    ...(created ? { createdAt: created.toISOString() as IsoDateTime } : {}),
    ...(finished ? { doneAt: finished.toISOString() as IsoDateTime } : {}),
  };
}

// ───────────── hatırlatıcı ─────────────

/**
 * v1 tekrarı (`yok | gunluk | hafta_ici | haftalik | aylik`) → v2 kuralı. `null`: tekrarsız; `undefined`:
 * tanınmayan kural (satır atlanır, uydurma tekrar kurulmaz).
 */
export function recurrenceOf(tekrar: string | null): Recurrence | null | undefined {
  switch (clean(tekrar) || 'yok') {
    case 'yok':
      return null;
    case 'gunluk':
      return { freq: 'daily', interval: 1 };
    case 'haftalik':
      return { freq: 'weekly', interval: 1 };
    case 'hafta_ici':
      return { freq: 'weekly', interval: 1, weekdays: [1, 2, 3, 4, 5] };
    case 'aylik':
      return { freq: 'monthly', interval: 1 };
    default:
      return undefined;
  }
}

/** v1 önemi → hatırlatıcı önceliği. v2 hatırlatıcıları varsayılan `high`'dır (adada görünür, seslendirilir). */
export function reminderPriorityOf(onem: number | null): Priority {
  const value = Number.isFinite(onem) ? Number(onem) : 3;
  if (value >= 5) return 'urgent';
  if (value >= 3) return 'high';
  return 'normal';
}

/**
 * Aylık seride v1 asıl günü (`gun`, 1–31) ayrıca saklar: 31 Ocak'tan sonra Şubat'ta 28'e kırpılmış zaman tutulur.
 * Seri bu asıl günden yeniden kurulsun diye zamanın gününü asıl güne çeken (gerekirse geriye, o güne sahip
 * aya giden) dayanak üretilir.
 */
export function monthlyAnchor(at: Date, day: number | null): Date {
  if (!day || day < 1 || day > 31 || day === at.getDate()) return at;
  const anchor = new Date(at);
  for (let back = 0; back < 12; back++) {
    const candidate = new Date(at.getFullYear(), at.getMonth() - back, 1, at.getHours(), at.getMinutes(), at.getSeconds(), at.getMilliseconds());
    const daysInMonth = new Date(candidate.getFullYear(), candidate.getMonth() + 1, 0).getDate();
    if (daysInMonth >= day) {
      candidate.setDate(day);
      return candidate;
    }
  }
  return anchor;
}

/** Yalnız GELECEKTEKİ ve etkin hatırlatıcılar için (seçim `UPCOMING_REMINDER_SQL` ile yapılır). */
export function mapReminder(row: V1ReminderRow, now: Date): Mapped<ReminderInput> {
  const title = oneLine(clean(row.baslik));
  const detail = oneLine(clean(row.aciklama));
  const at = parseInstant(row.zaman);
  const recurrence = recurrenceOf(row.tekrar);
  if (!title || !at || recurrence === undefined) return { ok: false, reason: 'invalid' };
  if (looksSecret(title, detail)) return { ok: false, reason: 'secret' };
  let due = at;
  const anchor = recurrence?.freq === 'monthly' ? monthlyAnchor(at, row.gun) : at;
  // Tekrarlıda zaman her çalışta ilerler; özet serinin değişmeyen yanını (saat, gün) taşır ki aynı adlı iki ayrı
  // seri ("İlaç" 09:00 ve 21:00) birbirinin kopyası sayılmasın.
  const when = recurrence
    ? `${localTime(anchor)}|${recurrence.freq === 'weekly' ? anchor.getDay() : recurrence.freq === 'monthly' ? anchor.getDate() : ''}`
    : at.toISOString();
  if (recurrence) {
    // Uygulama kapalıyken kaçan tekrarlar atlanır: seri bir sonraki gelecek anından sürer (v1 `sonrakiZaman` gibi).
    const next = anchor.getTime() > now.getTime() ? anchor : nextOccurrence(recurrence, anchor, now);
    if (!next) return { ok: false, reason: 'invalid' };
    due = next;
  } else if (at.getTime() <= now.getTime()) {
    return { ok: false, reason: 'invalid' };
  }
  return {
    ok: true,
    hash: contentHash('hatirlaticilar', title, detail, row.tekrar, when),
    value: {
      text: cap(detail ? `${title} (${detail})` : title, TITLE_MAX),
      dueAt: due.toISOString(),
      recurrence,
      priority: reminderPriorityOf(row.onem),
    },
  };
}

/** Geçmişte kalan hatırlatıcı → hafızada tarihli anı (isteğe bağlı arşiv). */
export function mapPastReminderNote(row: V1ReminderRow): Mapped<MemorySaveInput> {
  const title = oneLine(clean(row.baslik));
  const detail = oneLine(clean(row.aciklama));
  const at = parseInstant(row.zaman);
  if (!title || !at) return { ok: false, reason: 'invalid' };
  if (looksSecret(title, detail)) return { ok: false, reason: 'secret' };
  const state = clean(row.durum);
  const status =
    state === 'gonderildi'
      ? t('importV1.note.reminderFired')
      : state === 'tamam'
        ? t('importV1.note.reminderDone')
        : state === 'iptal'
          ? t('importV1.note.reminderCancelled')
          : t('importV1.note.reminderMissed');
  const text = t('importV1.note.pastReminder', {
    when: `${absoluteDay(at)} ${localTime(at)}`,
    text: detail ? `${title} (${detail})` : title,
    status,
  });
  return {
    ok: true,
    hash: contentHash('hatirlaticilar', title, detail, row.tekrar, at.toISOString()),
    value: {
      kind: 'episode',
      text: cap(text, MEMORY_TEXT_MAX),
      source: 'import',
      tags: ['v1', 'v1:hatirlatici'],
      confidence: 1,
      importance: 0.25,
      at: at.toISOString(),
      updatedAt: at.toISOString(),
    },
  };
}

// ───────────── yapılacak ─────────────

/** v1 önceliği 1–5 (varsayılan 3) → v2 önceliği (varsayılan `normal`). */
export function todoPriorityOf(oncelik: number | null): Priority {
  const value = Number.isFinite(oncelik) ? Number(oncelik) : 3;
  if (value >= 5) return 'urgent';
  if (value >= 4) return 'high';
  if (value >= 3) return 'normal';
  return 'low';
}

export interface MappedTodo {
  input: TodoInput;
  done: boolean;
}

export function mapTodo(row: V1TodoRow): Mapped<MappedTodo> {
  const fullTitle = oneLine(clean(row.baslik));
  if (!fullTitle) return { ok: false, reason: 'invalid' };
  const detail = clean(row.aciklama);
  const project = oneLine(clean(row.proje));
  if (looksSecret(fullTitle, detail, project)) return { ok: false, reason: 'secret' };
  const done = clean(row.durum) === 'tamam';
  const title = cap(fullTitle, TITLE_MAX);
  const notes: string[] = [];
  if (title !== fullTitle) notes.push(fullTitle);
  if (detail) notes.push(detail);
  if (project) notes.push(t('importV1.note.project', { project }));
  const finished = parseInstant(row.tamamlanma);
  if (done && finished) notes.push(t('importV1.note.doneAt', { day: absoluteDay(finished) }));
  const due = parseInstant(row.son_tarih);
  return {
    ok: true,
    hash: contentHash('gorevler', fullTitle, detail, project, due ? localDay(due) : ''),
    value: {
      done,
      input: {
        text: title,
        notes: cap(notes.join('\n'), NOTES_MAX),
        dueDay: due ? localDay(due) : null,
        priority: todoPriorityOf(row.oncelik),
      },
    },
  };
}

// ───────────── mesele ─────────────

/**
 * Açık mesele → hafızada "söz verilen iş" (`commitment`). Meseleleri v1 gün kaydı kendiliğinden çıkarıyordu ve
 * çoğu başkasının sözüdür ("Ali sözleşmeyi gönderecek"): kullanıcının yapılacaklar listesine dökülmez, Jarvis
 * "Ali dönmüş müydü?" sorusunda bulsun diye hafızaya girer. Güven 0,7 (çıkarım).
 */
export function mapIssue(row: V1IssueRow): Mapped<MemorySaveInput> {
  const title = oneLine(clean(row.baslik));
  if (!title) return { ok: false, reason: 'invalid' };
  const detail = oneLine(clean(row.ayrinti));
  const person = oneLine(clean(row.kisi));
  if (looksSecret(title, detail)) return { ok: false, reason: 'secret' };
  const target = /^\d{4}-\d{2}-\d{2}$/.test(clean(row.hedef)) ? fromLocal(clean(row.hedef)) : null;
  const parts = [t('importV1.note.issue', { title })];
  if (detail) parts.push(detail);
  if (target) parts.push(t('importV1.note.issueTarget', { day: absoluteDay(target) }));
  const first = /^\d{4}-\d{2}-\d{2}$/.test(clean(row.ilk_gun)) ? fromLocal(clean(row.ilk_gun), '12:00') : parseInstant(row.olusturma);
  return {
    ok: true,
    hash: contentHash('meseleler', title, detail, person, clean(row.hedef)),
    value: {
      kind: 'commitment',
      text: cap(parts.join(' '), MEMORY_TEXT_MAX),
      source: 'import',
      subject: person ? cap(person, 120) : null,
      tags: ['v1', 'v1:mesele'],
      confidence: 0.7,
      importance: 0.6,
      ...(first ? { at: first.toISOString(), updatedAt: first.toISOString() } : {}),
    },
  };
}
