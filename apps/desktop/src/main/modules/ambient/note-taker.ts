// Not tutucu: kapanan konuşma dönemini kısa notlara çevirir, açık işleri (mesele) ve kalıcı görünen bilgiyi ayıklar.
// Fuber AI 1'in `gunkaydi/not-tutucu.ts` dosyasının v2 karşılığı. Döküm modele yalnız BİR KEZ (burada) ve YALNIZ yerel modele gider (proje kararı);
// sonrası hep bu kısa notlar üzerinden yürür. İstem kısadır: yerel model (4B, 8 bin token) ile de çalışmalı.
//
// Modele güvenilmeyen yerler kodda:
//  · kaynak: modelin verdiği satır numaraları doğrulanır; geçersizse not "emin değil" işaretlenir;
//  · uydurma: nottaki sözcüklerin hiçbiri dökümde geçmiyorsa not yazılmaz; kişi adı dökümde yoksa listeden düşer;
//  · tarih: hedef gün yalnız verilen takvim aralığındaysa kabul edilir;
//  · söz: "arayacağım", "göndereceğim" gibi birinci kişi gelecek zaman satırları model atlasa da mesele olur ("sanırım").
import { foldForSearch, type BrainApi, type Id, type LocalDay, type Logger, type MemoryApi } from '@fuber/shared';
import { z } from 'zod';
import { dayToDate, expiryDate, matchIssue, shiftDay, topicSimilarity } from './periods';
import { isSelfTalk } from '../memory/writer';
import type { AmbientRepo } from './repo';
import { RETENTION } from './retention';
import { stemSet, stemSimilarity } from './stems';
import type { AmbientIssue, AmbientNote, AmbientSegment, AmbientSuggestion } from './types';

export { RETENTION } from './retention';

/** Bir dönem bu kadar satıra ya da harfe ulaşınca beklemeden kapanır. */
export const WINDOW_MAX_LINES = 15;
export const WINDOW_MAX_CHARS = 1800;
/** Son sözden sonra bu kadar sessizlik dönemi kapatır. */
export const WINDOW_SILENCE_MS = 3 * 60_000;
/** Dönem en çok bu kadar açık kalır (kesintisiz konuşmada notlar gecikmesin). */
export const WINDOW_MAX_AGE_MS = 10 * 60_000;
/** Tek model çağrısına giren en çok satır ve harf (yerel modelin bağlamı için). */
const BATCH_MAX_LINES = 30;
const BATCH_MAX_CHARS = 2600;
/**
 * Model yanıt veremediğinde (beyin kapalı, bulut düşük, çıktı bozuk) parti notlanmamış bekler. Yeniden deneme en erken
 * `RETRY_MS` sonra; aynı parti en az `GIVE_UP_MS` boyunca `MAX_ATTEMPTS` kez denenip çıkarılamadıysa atlanır (döküm
 * süresi dolana dek aranabilir kalır). Kısa bir kesinti notları yakmaz.
 */
const MAX_ATTEMPTS = 3;
export const NOTE_RETRY_MS = 5 * 60_000;
export const NOTE_GIVE_UP_MS = 30 * 60_000;

interface Attempts {
  id: string;
  count: number;
  firstAt: number;
  lastAt: number;
}

/** Notlanmamış satırlar bir dönemi kapatıyor mu: satır/harf sınırı, sessizlik ya da yaş. */
export function windowClosed(pending: Pick<AmbientSegment, 'text' | 'startedAt' | 'endedAt'>[], now: Date): boolean {
  const first = pending[0];
  const last = pending.at(-1);
  if (!first || !last) return false;
  if (pending.length >= WINDOW_MAX_LINES) return true;
  if (pending.reduce((sum, segment) => sum + segment.text.length, 0) >= WINDOW_MAX_CHARS) return true;
  if (now.getTime() - Date.parse(last.endedAt) >= WINDOW_SILENCE_MS) return true;
  return now.getTime() - Date.parse(first.startedAt) >= WINDOW_MAX_AGE_MS;
}

export const NoteExtractionSchema = z.object({
  notes: z.array(
    z.object({
      text: z.string(),
      kind: z.enum(['decision', 'promise', 'date', 'person', 'preference', 'info', 'chat']),
      important: z.boolean(),
      people: z.array(z.string()),
      lines: z.array(z.number()),
      sure: z.boolean(),
    }),
  ),
  issues: z.array(
    z.object({
      title: z.string(),
      person: z.string().nullable(),
      due: z.string().nullable(),
      closes: z.number().nullable(),
      line: z.number(),
    }),
  ),
  facts: z.array(z.object({ text: z.string(), subject: z.string().nullable(), line: z.number() })),
});
export type NoteExtraction = z.infer<typeof NoteExtractionSchema>;

export const NOTE_INSTRUCTIONS = `Bir kişisel asistanın not tutucususun. Sana kullanıcının ve çevresindekilerin gün içinde mikrofonun duyduğu konuşmaların otomatik dökümü verilecek. Tanıma hatası ve başkalarının sesi olabilir; kimin konuştuğu yazmaz.
Görevin dökümü kısa notlara çevirmek. Yalnız dökümde geçeni yaz; uydurma, tahmin yürütme, bir sözü belirli birine yükleme.

notes: her not tek cümle, geçmiş zaman, en çok 160 karakter: kim, ne, hangi karar, hangi söz.
- kind: decision (karar), promise (birinin yapacağını söylediği iş), date (tarih, randevu), person (kişi bilgisi), preference (tercih), info (para, yer, başka bilgi), chat (gündelik sohbet).
- important: chat için false, öteki türler için true.
- people: notta geçen kişi adları. lines: notun dayandığı satır numaraları.
- sure: döküm bozuksa ya da anlamından emin değilsen false.
Televizyon, müzik, reklam, selamlaşma ve anlamsız kırıntıları alma. Not çıkmıyorsa notes boş kalsın.

issues: tamamlanmamış işler ve verilen sözler ("Kaan'ı arayacağım").
- title: kısa iş cümlesi ("Kaan aranacak"). person: ilgili kişi ya da null. line: dayandığı satır numarası.
- due: gün söylendiyse "Önümüzdeki günler" listesinden YYYY-AA-GG; söylenmediyse null.
- closes: döküm "Açık meseleler"den birinin bittiğini söylüyorsa o meselenin numarası; yoksa null.

facts: haftalar sonra da geçerli kalıcı bilgi (tercih, kişi bilgisi, kural). Çoğu zaman boş.`;

const DAY_NAMES = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const dayLabel = (day: LocalDay) => `${DAY_NAMES[dayToDate(day).getDay()]} ${day}`;
const clock = (iso: string) => {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

/** Modele giden girdi: tarih, önümüzdeki günler (küçük model göreli günü hesaplayamıyor), açık meseleler, numaralı döküm. */
export function buildNoteInput(day: LocalDay, batch: AmbientSegment[], openIssues: AmbientIssue[]): string {
  return [
    `Tarih: ${dayLabel(day)}`,
    `Önümüzdeki günler: ${Array.from({ length: 7 }, (_, index) => dayLabel(shiftDay(day, index + 1))).join(' · ')}`,
    openIssues.length
      ? `Açık meseleler:\n${openIssues.map((issue, index) => `${index + 1}. ${issue.title}${issue.person ? ` (${issue.person})` : ''}`).join('\n')}`
      : 'Açık mesele yok.',
    '',
    'Döküm:',
    ...batch.map((segment, index) => `${index + 1} [${clock(segment.startedAt)}] ${segment.text}`),
  ].join('\n');
}

/** Model "önemsiz" dese de önemli sayılan türler. */
const IMPORTANT_KINDS: ReadonlySet<string> = new Set(['decision', 'promise', 'date', 'person', 'preference']);

/** Tek başına anlam taşımayan dolgu sözleri (katlanmış: ı → i, ş → s). */
const FILLERS = new Set(['evet', 'hayir', 'tamam', 'peki', 'olur', 'yok', 'var', 'hi hi', 'hm', 'hmm', 'aa', 'oh', 'eee', 'iste', 'yani', 'tabii', 'tabi', 'aynen', 'sey', 'haa', 'he', 'tesekkurler', 'sagol', 'merhaba', 'selam', 'gorusuruz', 'alo']);
/** Yazıya çevirme motorunun sessizlikte, müzikte ve televizyonda uydurduğu kalıplar. */
const TRANSCRIBER_NOISE = /altyazi|abone ol|izlediginiz icin|begenmeyi unutmayin|kanalima|muzik|alkis|gulme|^\W*$/;

const foldWords = (text: string): string[] => {
  const folded = foldForSearch(text.trim()).replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  return folded ? folded.split(' ') : [];
};

/**
 * Yazıya çevirme çöpü: ayraçlı ses etiketi ("[Müzik]", "(alkış)"), nota işareti, motorun sessizlikte ve televizyonda
 * uydurduğu bilinen kalıplar. Böyle satır modele hiç gitmez (partiden de çıkarılır).
 */
export function isTranscriberJunk(text: string): boolean {
  const trimmed = text.trim();
  if (/^[[(].*[\])]$/.test(trimmed) || /[♪♫]/.test(trimmed)) return true;
  const words = foldWords(trimmed);
  return words.length === 0 || (words.length <= 6 && TRANSCRIBER_NOISE.test(words.join(' ')));
}

/**
 * Kural tabanlı ön süzgeç: tek başına not çıkmayacak satır (çöp, tek sözcük, yalnız dolgu: "evet tamam"). Partideki
 * bütün satırlar böyleyse küçük yerel model hiç çağrılmaz; anlamlı satırların yanındaki kısa yanıtlar ("Perşembe.")
 * bağlam için partide kalır.
 */
export function isNoise(text: string): boolean {
  if (isTranscriberJunk(text)) return true;
  const words = foldWords(text);
  return words.length < 2 || words.every((word) => FILLERS.has(word)) || FILLERS.has(words.join(' '));
}

/** Birinci kişi gelecek zaman: "arayacağım", "göndereceğiz", konuşma dilinde "arıycam", "gönderecem". */
const FIRST_PERSON_FUTURE = /(?:^|\s)([\p{L}]{2,}(?:acağım|eceğim|acağız|eceğiz|ıcam|icem|ucam|ücem|acam|ecem|ıcaz|icez|acaz|ecez))(?![\p{L}])/u;

/** Satır bir söz (taahhüt) taşıyor mu. Kural tabanlıdır: model atlasa da mesele kaçmasın. */
export function looksLikePromise(text: string): boolean {
  return FIRST_PERSON_FUTURE.test(text.toLocaleLowerCase('tr'));
}

export interface NoteTakerDeps {
  repo: AmbientRepo;
  brain: Pick<BrainApi, 'extract'>;
  memory: Pick<MemoryApi, 'search'>;
  log: Logger;
  now(): Date;
}

export interface NoteResult {
  notes: AmbientNote[];
  /** Yeni açılan meseleler. */
  issues: AmbientIssue[];
  /** Dökümün kapattığı meseleler. */
  closed: AmbientIssue[];
  suggestions: AmbientSuggestion[];
  /** Model çağrısı yapılan parti sayısı. */
  batches: number;
  /** Model yanıt veremediği için bekleyen parti var mı. */
  failed: boolean;
}

const cut = (value: string, max: number) => value.replace(/\s+/g, ' ').trim().slice(0, max);

/** İlk satırla aynı güne ait, model sınırına sığan ardışık satırlar. */
export function nextBatch(pending: AmbientSegment[]): AmbientSegment[] {
  const first = pending[0];
  if (!first) return [];
  const batch: AmbientSegment[] = [];
  let chars = 0;
  for (const segment of pending) {
    if (segment.day !== first.day) break;
    if (batch.length >= BATCH_MAX_LINES || (batch.length > 0 && chars + segment.text.length > BATCH_MAX_CHARS)) break;
    batch.push(segment);
    chars += segment.text.length;
  }
  return batch;
}

/** Model çıktısını depoya uygular. Dışa açık: birim testleri ve ölçüm betiği model olmadan da çağırır. */
export function applyExtraction(deps: Pick<NoteTakerDeps, 'repo' | 'memory' | 'log'>, day: LocalDay, batch: AmbientSegment[], extraction: NoteExtraction): Omit<NoteResult, 'batches' | 'failed'> {
  const { repo } = deps;
  const first = batch[0]!;
  const last = batch.at(-1)!;
  const batchText = batch.map((segment) => segment.text).join(' ');
  const batchStems = stemSet(batchText);
  const batchFolded = foldForSearch(batchText);
  const lineSegment = (line: number): AmbientSegment | null => (Number.isInteger(line) && line >= 1 && line <= batch.length ? batch[line - 1]! : null);
  const covered = new Set<Id>();

  const notes: AmbientNote[] = [];
  for (const entry of extraction.notes.slice(0, 20)) {
    const noteText = cut(entry.text, 300);
    if (noteText.length < 4) continue;
    const stems = stemSet(noteText);
    let common = 0;
    for (const stem of stems) if (batchStems.has(stem)) common++;
    // Dökümle tek ortak kökü olmayan not uydurmadır; azı ortak olan "emin değil" yazılır.
    if (stems.size > 0 && common === 0) {
      deps.log.debug('ortam notu dökümde dayanaksız, yazılmadı');
      continue;
    }
    const grounded = stems.size === 0 || common / stems.size >= 0.25;
    const sources = [...new Set(entry.lines.map(lineSegment).filter((segment): segment is AmbientSegment => segment !== null))];
    const used = sources.length ? sources : batch;
    for (const segment of used) covered.add(segment.id);
    // Önem kodda da tutulur: model "önemsiz" dese de karar, söz, tarih, kişi bilgisi ve tercih önemlidir.
    const important = entry.important || IMPORTANT_KINDS.has(entry.kind);
    notes.push(
      repo.addNote({
        day,
        at: used[0]!.startedAt,
        text: noteText,
        important,
        kind: entry.kind,
        people: [...new Set(entry.people.map((name) => cut(name, 40)).filter((name) => name && batchFolded.includes(foldForSearch(name))))].slice(0, 6),
        unsure: !entry.sure || !grounded || sources.length === 0,
        sourceIds: used.map((segment) => segment.id),
        sourceFrom: used[0]!.startedAt,
        sourceTo: used.at(-1)!.endedAt,
        expiresAt: expiryDate(day, important ? RETENTION.importantNoteDays : RETENTION.casualNoteDays),
      }),
    );
  }

  const openBefore = repo.listIssues('open', 12);
  const issues: AmbientIssue[] = [];
  const closed: AmbientIssue[] = [];
  const dueOf = (raw: string | null): LocalDay | null => {
    if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
    return raw >= day && raw <= shiftDay(day, 90) ? raw : null;
  };
  const openIssue = (title: string, person: string | null, due: LocalDay | null, sources: AmbientSegment[], unsure: boolean) => {
    const existing = matchIssue(title, person, repo.listIssues('open', 80));
    if (existing) {
      repo.updateIssue(existing.id, { addSourceIds: sources.map((segment) => segment.id), ...(due ? { dueDay: due } : {}) });
      return;
    }
    issues.push(
      repo.addIssue({
        title: cut(title, 160),
        person: person ? cut(person, 60) : null,
        detail: null,
        firstDay: day,
        dueDay: due,
        unsure,
        sourceIds: sources.map((segment) => segment.id),
        sourceFrom: sources[0]!.startedAt,
      }),
    );
  };

  const promised = new Set<Id>();
  for (const entry of extraction.issues.slice(0, 10)) {
    const title = cut(entry.title, 160);
    if (title.length < 4) continue;
    const source = lineSegment(entry.line);
    const closes = entry.closes !== null && Number.isInteger(entry.closes) ? openBefore[entry.closes - 1] : undefined;
    if (closes) {
      const updated = repo.updateIssue(closes.id, { status: 'done', addSourceIds: (source ? [source] : batch).map((segment) => segment.id) });
      if (updated) closed.push(updated);
      continue;
    }
    if (source) promised.add(source.id);
    const person = entry.person && batchFolded.includes(foldForSearch(entry.person)) ? entry.person : null;
    openIssue(title, person, dueOf(entry.due), source ? [source] : batch, source === null);
  }

  // Model "söz" notu yazıp meseleyi atladıysa not meseleye çevrilir.
  for (const note of notes) {
    if (note.kind !== 'promise') continue;
    const known = [...issues, ...repo.listIssues('open', 80)].some((issue) => topicSimilarity(issue.title, note.text) >= 0.5);
    if (known) continue;
    const sources = batch.filter((segment) => note.sourceIds.includes(segment.id));
    for (const segment of sources) promised.add(segment.id);
    openIssue(note.text, note.people[0] ?? null, null, sources.length ? sources : batch, note.unsure);
  }

  // Modelin hiç değinmediği birinci kişi gelecek zaman satırı: mesele olarak yazılır, "emin değil" işaretiyle.
  for (const segment of batch) {
    if (promised.has(segment.id) || !looksLikePromise(segment.text)) continue;
    const mentioned = [...issues, ...repo.listIssues('open', 80)].some((issue) => issue.sourceIds.includes(segment.id) || topicSimilarity(issue.title, segment.text) >= 0.5);
    if (mentioned) continue;
    openIssue(segment.text, null, null, [segment], true);
  }

  const suggestions: AmbientSuggestion[] = [];
  const pending = repo.listSuggestions('pending');
  for (const fact of extraction.facts.slice(0, 3)) {
    const factText = cut(fact.text, 240);
    // Asistanın kendi hakkındaki söz kalıcı bilgi önerisi olmaz (hafızanın kural kapısı).
    if (factText.length < 8 || isSelfTalk(factText)) continue;
    const stems = stemSet(factText);
    let common = 0;
    for (const stem of stems) if (batchStems.has(stem)) common++;
    if (stems.size === 0 || common / stems.size < 0.25) continue;
    if ([...pending, ...suggestions].some((entry) => stemSimilarity(entry.text, factText) >= 0.8)) continue;
    let known = false;
    try {
      known = deps.memory.search({ text: factText, limit: 5 }).some((hit) => stemSimilarity(hit.item.text, factText) >= 0.8);
    } catch (error) {
      deps.log.debug('hafıza araması yapılamadı', error);
    }
    if (known) continue;
    const source = lineSegment(fact.line);
    suggestions.push(repo.addSuggestion({ text: factText, subject: fact.subject ? cut(fact.subject, 60) : null, day, sourceIds: (source ? [source] : [first, last]).map((segment) => segment.id) }));
  }

  return { notes, issues, closed, suggestions };
}

/**
 * Bekleyen dökümü nota çevirir. Aynı anda tek tur koşar; süren tur varken gelen çağrı onun bitmesini bekleyip kalanı işler.
 * `force`: kullanıcı "Şimdi not çıkar" dedi; yeniden deneme beklemesi atlanır.
 */
export function createNoteTaker(deps: NoteTakerDeps): { run(force?: boolean): Promise<NoteResult> } {
  let chain: Promise<unknown> = Promise.resolve();

  const round = async (force: boolean): Promise<NoteResult> => {
    const result: NoteResult = { notes: [], issues: [], closed: [], suggestions: [], batches: 0, failed: false };
    for (let guard = 0; guard < 20; guard++) {
      const batch = nextBatch(deps.repo.pendingSegments(200));
      const first = batch[0];
      if (!first) break;
      const ids = batch.map((segment) => segment.id);
      // Kural tabanlı ön süzgeç: yazıya çevirme çöpü partiden çıkar; kalan satırların hepsi boş laf, tek sözcük ya da
      // üç beş harflik kırıntıysa model hiç çağrılmaz.
      const useful = batch.filter((segment) => !isTranscriberJunk(segment.text));
      if (useful.every((segment) => isNoise(segment.text)) || useful.reduce((sum, segment) => sum + segment.text.length, 0) < 12) {
        deps.repo.markNoted(ids);
        continue;
      }
      const usefulIds = useful.map((segment) => segment.id);
      const now = deps.now().getTime();
      const previous = deps.repo.getState<Attempts | null>('noteAttempts') ?? null;
      const attempts = previous?.id === first.id ? previous : null;
      if (attempts && !force && now - attempts.lastAt < NOTE_RETRY_MS) {
        result.failed = true;
        break;
      }
      // Ham döküm YALNIZ bu bilgisayardaki yerel modele gider (`localOnly`): bulut anahtarı, politika ne
      // derse desin. Yerel model hazır değilse `null` döner ve parti yeniden deneme düzeniyle bekler.
      const extraction = await deps.brain.extract({
        role: 'memory',
        localOnly: true,
        instructions: NOTE_INSTRUCTIONS,
        input: buildNoteInput(first.day, useful, deps.repo.listIssues('open', 12)),
        schema: NoteExtractionSchema,
      });
      result.batches++;
      // Tur sürerken kullanıcı "son 10 dakikayı sil" demiş olabilir: silinen satırlardan not çıkmaz.
      const alive = deps.repo.segmentsByIds(usefulIds);
      if (!extraction) {
        const count = (attempts?.count ?? 0) + 1;
        const firstAt = attempts?.firstAt ?? now;
        if (count >= MAX_ATTEMPTS && now - firstAt >= NOTE_GIVE_UP_MS) {
          deps.log.warn(`ortam notu ${count} denemede çıkarılamadı; ${batch.length} satır notsuz bırakıldı`);
          deps.repo.markNoted(ids);
          deps.repo.setState('noteAttempts', null);
          continue;
        }
        deps.repo.setState('noteAttempts', { id: first.id, count, firstAt, lastAt: now } satisfies Attempts);
        result.failed = true;
        break;
      }
      if (alive.length > 0) {
        const applied = applyExtraction(deps, first.day, alive, alive.length === useful.length ? extraction : { ...extraction, notes: [], issues: [], facts: [] });
        result.notes.push(...applied.notes);
        result.issues.push(...applied.issues);
        result.closed.push(...applied.closed);
        result.suggestions.push(...applied.suggestions);
      }
      deps.repo.markNoted(ids);
    }
    return result;
  };

  return {
    run(force = false) {
      const next = chain.then(() => round(force), () => round(force));
      chain = next.catch(() => undefined);
      return next;
    },
  };
}
