// Tanışma: ilk günlerde kısa, doğal bir "sizi tanıyayım" sohbeti ve zamanla eksik bilgileri uygun anlarda sorma.
// Zorlayıcı DEĞİLDİR: bir yanıtın sonunda tek soru; kullanıcı istemezse bırakılır ("sorma" → kapanır; iki kez yanıtsız
// kalırsa üç gün ara verilir). Karar kodladır (ne zaman, hangi soru); soruyu modelin kendisi, konuşmanın akışına uygun
// biçimde sorar. Soruya verilen yanıt profile `intro` kaynağıyla, kullanıcının kendi sözüyle yazılır.
import { foldForSearch, localDay, type IsoDateTime, type JsonValue, type PresenceState } from '@fuber/shared';
import type { ProfileStore } from './store';
import type { ProfileCategory, ProfileIntroState } from './types';

interface IntroQuestion {
  id: string;
  /** Bu kategorilerden birinde etkin kayıt varsa soru sorulmaz. */
  fills: ProfileCategory[];
  /** Yanıtın yazılacağı kategori. */
  category: ProfileCategory;
  /** Modele: neyi öğrenmek istediği. */
  ask: string;
  /** Profildeki satırın başı ("İşi (kendi anlatımı)"). */
  label: string;
  /** Arayüzde "henüz bilmediklerim" satırı. */
  missing: string;
}

export const INTRO_QUESTIONS: readonly IntroQuestion[] = [
  { id: 'work', fills: ['work'], category: 'work', ask: 'ne işle uğraştığını, hangi şirket ve projeler üzerinde çalıştığını', label: 'İşi (kendi anlatımı)', missing: 'işleriniz ve projeleriniz' },
  { id: 'interest', fills: ['interest'], category: 'interest', ask: 'hangi konuları takip ettiğini, gündemde onun için nelere bakmanı istediğini', label: 'Takip ettikleri (kendi anlatımı)', missing: 'ilgi alanlarınız' },
  { id: 'style', fills: ['style', 'rule', 'preference'], category: 'style', ask: 'yanıtlarını nasıl istediğini (kısa ve net mi, ayrıntılı mı) ve ona nasıl hitap etmeni istediğini', label: 'Yanıt biçimi (kendi anlatımı)', missing: 'nasıl yanıt istediğiniz' },
  { id: 'routine', fills: ['routine'], category: 'routine', ask: 'gününün genelde kaçta başladığını ve sabah brifingini kaçta istediğini', label: 'Günlük düzeni (kendi anlatımı)', missing: 'günlük düzeniniz' },
  { id: 'circle', fills: ['circle'], category: 'circle', ask: 'adı sık geçecek kişileri (ortakları, ekibi, ailesi)', label: 'Yakın çevresi (kendi anlatımı)', missing: 'yakın çevreniz' },
  { id: 'dislike', fills: ['dislike'], category: 'dislike', ask: 'yapmanı istemediği, onu rahatsız eden bir şey olup olmadığını', label: 'İstemedikleri (kendi anlatımı)', missing: 'istemedikleriniz' },
];

interface IntroData {
  enabled: boolean;
  asked: number;
  answered: number;
  declinedAt: IsoDateTime | null;
  lastAskedAt: IsoDateTime | null;
  /** Sorulan ve yanıtı beklenen soru. */
  pending: { id: string; at: IsoDateTime; text: string } | null;
  /** Sorulmuş soruların kimlikleri (yanıtsız kalan yeniden sorulmaz). */
  done: string[];
  /** Art arda yanıtsız kalan soru sayısı. */
  skips: number;
  /** Bu ana kadar soru sorulmaz. */
  snoozeUntil: IsoDateTime | null;
  day: string | null;
  dayCount: number;
}

const DEFAULT: IntroData = { enabled: true, asked: 0, answered: 0, declinedAt: null, lastAskedAt: null, pending: null, done: [], skips: 0, snoozeUntil: null, day: null, dayCount: 0 };
const STATE_KEY = 'intro';

/** Bir günde en çok bu kadar soru (ilk tanışmada art arda; sonraki günlerde tek tek). */
export const MAX_PER_DAY = 3;
/** Toplam soru üst sınırı (soru bankası bitince zaten durur). */
export const MAX_TOTAL = 12;
/** İlk tanışma günü dışında iki soru arasında en az bu kadar süre. */
export const MIN_GAP_MS = 20 * 60 * 60 * 1000;
/** Sorudan sonra bu süre içinde gelen söz yanıt sayılabilir. */
export const ANSWER_WINDOW_MS = 5 * 60 * 1000;
/** Aynı tur birden çok sağlayıcıda yeniden denenirse (Claude → Fuber → yerel) soru bir kez sayılır. */
const SAME_TURN_MS = 90 * 1000;
const SNOOZE_AFTER_SKIPS_MS = 3 * 24 * 60 * 60 * 1000;

const fold = (text: string) => foldForSearch(text);

/** Kullanıcı tanışma sorularını istemiyor (her zaman geçerli). */
const STOP = /(beni tani|tanisma|kendim\w* ilgili|hakkimda|kisisel)\w*.{0,30}(sorma|soru sorma|istemiyorum|kapat|gerek yok|birak)|\b(bana )?soru sorma\b|sorgulama|sorguya cekme/;
/** Yanıt beklenirken gelen ret: "sorma", "gerek yok", "istemiyorum". */
const DECLINE = /\b(sorma|gerek yok|istemiyorum|istemem|bos ?ver|karistirma|seni ilgilendirmez|soylemek istemiyorum|ozel)\b/;
/** Yanıt beklenirken gelen erteleme: "sonra", "şimdi değil". */
const LATER = /\b(sonra|simdi degil|simdi olmaz|baska zaman|gec|pas|mesgulum|vaktim yok|acelem var)\b/;
/** Uygunsuz an: kullanıcı acele ediyor ya da öfkeli. */
const BAD_MOMENT = /\b(acil|hemen|cabuk|acele|yeter|sus|kes|sinir|kizdim|biktim|ugrasma)\b/;
/** Yanıt değil, yeni bir iş isteği. */
const COMMAND = /\b(hatirlat|\bac\b|kapat|\bara\b|goster|ekle|\bkur\b|gonder|\boku\b|baslat|durdur|sil|kaldir|ne zaman|kac|nedir|nasil|soyle bakalim|haberler|hava)\b/;

function read(store: ProfileStore): IntroData {
  const saved = store.state<JsonValue>(STATE_KEY);
  return saved && typeof saved === 'object' && !Array.isArray(saved) ? { ...DEFAULT, ...(saved as unknown as Partial<IntroData>) } : { ...DEFAULT };
}

const write = (store: ProfileStore, data: IntroData) => store.setState(STATE_KEY, data as unknown as JsonValue);

function missingQuestions(store: ProfileStore, data: IntroData): IntroQuestion[] {
  const present = new Set(store.list().map((item) => item.category));
  return INTRO_QUESTIONS.filter((question) => !data.done.includes(question.id) && !question.fills.some((category) => present.has(category)));
}

export function introState(store: ProfileStore): ProfileIntroState {
  const data = read(store);
  return {
    enabled: data.enabled,
    asked: data.asked,
    answered: data.answered,
    declinedAt: data.declinedAt,
    missing: missingQuestions(store, { ...data, done: [] }).map((question) => question.missing),
  };
}

export function setIntroEnabled(store: ProfileStore, enabled: boolean, now: Date): ProfileIntroState {
  const data = read(store);
  write(store, { ...data, enabled, declinedAt: enabled ? null : now.toISOString(), pending: enabled ? data.pending : null, skips: enabled ? 0 : data.skips, snoozeUntil: enabled ? null : data.snoozeUntil });
  return introState(store);
}

export interface IntroTurnInput {
  /** Kullanıcının bu turdaki sözü. */
  text: string;
  now: Date;
  presence: Pick<PresenceState, 'mode' | 'fullscreen' | 'meeting'> | null;
  /** Kişilikli sohbet turu mu (sesli tur ya da yazılı sohbet); görev ve yalın çağrıda soru sorulmaz. */
  conversational: boolean;
}

export interface IntroTurn {
  /** Bu tur için modele not (yanıtın sonunda sorulacak soru); yoksa `null`. */
  note: string | null;
  /** Bekleyen soruya verilen yanıt: profile yazılacak kayıt. */
  answer: { category: ProfileCategory; key: string; text: string } | null;
  /** Kullanıcı bu turda tanışmayı kapattı. */
  declined: boolean;
}

/**
 * Turun başında çağrılır: bekleyen sorunun yanıtını değerlendirir ve bu turda sorulacak soruyu seçer. Aynı söz kısa
 * sürede ikinci kez gelirse (sağlayıcı zincirinde yeniden deneme) aynı not döner, sayaç artmaz.
 */
export function introTurn(store: ProfileStore, input: IntroTurnInput): IntroTurn {
  const data = read(store);
  const nowMs = input.now.getTime();
  const folded = fold(input.text);
  const out: IntroTurn = { note: null, answer: null, declined: false };

  if (STOP.test(folded) && data.enabled) {
    write(store, { ...data, enabled: false, declinedAt: input.now.toISOString(), pending: null });
    return { ...out, declined: true };
  }
  if (!data.enabled) return out;

  let next = { ...data };
  let chained = false;
  if (data.pending) {
    const age = nowMs - Date.parse(data.pending.at);
    if (age < SAME_TURN_MS && data.pending.text === input.text) {
      // Aynı turun yeniden denemesi: aynı soru, sayaç artmaz.
      const question = INTRO_QUESTIONS.find((candidate) => candidate.id === data.pending!.id);
      return { ...out, note: question ? noteFor(question, data.asked <= 1) : null };
    }
    const question = INTRO_QUESTIONS.find((candidate) => candidate.id === data.pending!.id);
    next.pending = null;
    if (question && age <= ANSWER_WINDOW_MS) {
      const words = input.text.trim().split(/\s+/).filter(Boolean).length;
      if (DECLINE.test(folded) && words <= 12) {
        write(store, { ...next, enabled: false, declinedAt: input.now.toISOString() });
        return { ...out, declined: true };
      }
      if (LATER.test(folded) && words <= 10) {
        // Sonra sorulabilsin diye soru bankasına geri döner.
        write(store, { ...next, done: next.done.filter((id) => id !== question.id), snoozeUntil: new Date(nowMs + MIN_GAP_MS).toISOString() });
        return out;
      }
      const isQuestion = /\?\s*$/.test(input.text.trim()) || /\b(mi|mu|misin|musun)\s*$/.test(folded);
      if (!isQuestion && !COMMAND.test(folded) && words >= 2 && words <= 80) {
        out.answer = { category: question.category, key: `tanisma-${question.id}`, text: `${question.label}: “${input.text.replace(/\s+/g, ' ').trim().slice(0, 260)}”` };
        next.answered += 1;
        next.skips = 0;
        chained = true;
      } else {
        next.skips += 1;
      }
    } else {
      next.skips += 1;
    }
    if (next.skips >= 2) {
      next.skips = 0;
      next.snoozeUntil = new Date(nowMs + SNOOZE_AFTER_SKIPS_MS).toISOString();
    }
  }

  const day = localDay(input.now);
  if (next.day !== day) {
    next.day = day;
    next.dayCount = 0;
  }
  const busy = input.presence ? input.presence.fullscreen || input.presence.meeting || input.presence.mode === 'meeting' || input.presence.mode === 'fullscreen' : false;
  const snoozed = next.snoozeUntil !== null && Date.parse(next.snoozeUntil) > nowMs;
  const gapOk = chained || next.lastAskedAt === null || nowMs - Date.parse(next.lastAskedAt) >= MIN_GAP_MS;
  const candidates = missingQuestions(store, next).filter((question) => !out.answer || !question.fills.includes(out.answer.category));
  const canAsk = input.conversational && !busy && !snoozed && gapOk && next.dayCount < MAX_PER_DAY && next.asked < MAX_TOTAL && !BAD_MOMENT.test(folded) && candidates.length > 0;
  if (canAsk) {
    const question = candidates[0]!;
    out.note = noteFor(question, next.asked === 0);
    next.asked += 1;
    next.dayCount += 1;
    next.lastAskedAt = input.now.toISOString();
    next.pending = { id: question.id, at: input.now.toISOString(), text: input.text };
    next.done = [...next.done, question.id];
  }
  write(store, next);
  return out;
}

function noteFor(question: IntroQuestion, first: boolean): string {
  const opening = first
    ? 'Kullanıcıyı henüz yeni tanıyorsun. Önce isteğini yerine getir; yanıtının SONUNDA tek cümleyle, zorlamadan, onu daha iyi tanımak istediğini söyle ve şunu sor'
    : 'Uygun düşerse, isteğini yerine getirdikten sonra yanıtının SONUNDA tek kısa soruyla şunu öğren';
  return `Tanışma (bu tura özgü): ${opening}: ${question.ask}. Yalnız BİR soru sor; kullanıcı bu turda başka bir şeyle meşgulse ya da konu uygun değilse sorma. İstemezse ısrar etme.`;
}
