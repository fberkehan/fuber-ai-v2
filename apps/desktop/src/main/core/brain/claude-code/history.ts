/**
 * Kalıcı Claude Code sürecinin geçmişi: oturum sürerken konuşma CLI'nin KENDİ bağlamındadır, her turda yalnız yeni söz
 * gönderilir. Süreç yeniyse (yeni oturum, yeniden başlatma, model/istem değişti) uygulamanın geçmişi ilk iletinin
 * başına önsöz olarak konur. Sürecin görmediği aradaki turlar (kodla yanıtlanan kısa işler, yerel modele düşen tur)
 * bir sonraki iletide "bu arada konuşulanlar" olarak aktarılır: model bağlamını kaybetmez.
 */
import type { ConvMessage } from '../providers/types';

/** Sürecin en son gördüğü söz ve verdiği yanıt; hiç tur yürütmediyse `null`. */
export interface SeenState {
  lastUser: string;
  lastReply: string;
}

export type HistoryPlan =
  /** Süreç konuşmayı biliyor; yalnız görmediği aradaki iletiler aktarılır. */
  | { mode: 'continue'; missed: ConvMessage[] }
  /** Süreç konuşmayı bilmiyor: bütün geçmiş önsöz olur. `restart`: bağlı süreç izini kaybetmiş, yenisi açılmalı. */
  | { mode: 'fresh'; history: ConvMessage[]; restart: boolean };

const MAX_MESSAGE_CHARS = 2000;
const MAX_BLOCK_CHARS = 24_000;

/** Karşılaştırma için: notlar, etiketler ve boşluk farkı atılır. */
const normalize = (text: string): string =>
  text
    .replace(/\s*\((yapıldı: [^)]*|yanıt burada yarıda kesildi)\)/g, '')
    .replace(/^\[[^\]]{1,40}\]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('tr');

/** Geçmişteki asistan iletisi sürecin kendi yanıtı mı (yarıda kesilen yanıt, başının eşleşmesiyle tanınır). */
function sameReply(inHistory: string, own: string): boolean {
  const a = normalize(inHistory);
  const b = normalize(own);
  if (!a || !b) return false;
  const head = Math.min(a.length, b.length, 48);
  return a.slice(0, head) === b.slice(0, head);
}

/**
 * Sürecin gördüğüyle uygulamanın geçmişini karşılaştırır. `messages`: geçmiş + en sonda yeni kullanıcı sözü.
 * İz bulunamazsa (pencere kaydı, oturum değişti) güvenli taraf seçilir: süreç yenilenir ve geçmiş baştan verilir.
 */
export function planHistory(messages: readonly ConvMessage[], seen: SeenState | null): HistoryPlan {
  const prior = messages.slice(0, -1);
  if (!seen) return { mode: 'fresh', history: prior, restart: false };
  const wanted = normalize(seen.lastUser).slice(0, 160);
  let index = -1;
  for (let i = prior.length - 1; i >= 0; i--) {
    const message = prior[i]!;
    if (message.role === 'user' && wanted && normalize(message.text).includes(wanted)) {
      index = i;
      break;
    }
  }
  if (index === -1) {
    // Geçmiş boşsa uygulama o turu kaydetmemiş (başarısız tur): süreç yine de sürdürülür.
    return prior.length === 0 ? { mode: 'continue', missed: [] } : { mode: 'fresh', history: prior, restart: true };
  }
  const after = prior.slice(index + 1);
  const first = after[0];
  if (first?.role === 'assistant' && sameReply(first.text, seen.lastReply)) return { mode: 'continue', missed: after.slice(1) };
  return { mode: 'continue', missed: after };
}

const clip = (text: string) => (text.length > MAX_MESSAGE_CHARS ? `${text.slice(0, MAX_MESSAGE_CHARS)}…` : text);

/** Konuşma iletilerini düz döküme çevirir; sınır aşılırsa en eskiler atılır. */
function transcript(messages: readonly ConvMessage[], assistantName: string): string {
  const lines: string[] = [];
  for (const message of messages) {
    if (message.role === 'user' && message.text.trim()) lines.push(`Kullanıcı: ${clip(message.text.trim())}`);
    else if (message.role === 'assistant' && message.text.trim()) lines.push(`${assistantName}: ${clip(message.text.trim())}`);
  }
  let total = lines.reduce((sum, line) => sum + line.length + 1, 0);
  while (lines.length > 1 && total > MAX_BLOCK_CHARS) total -= lines.shift()!.length + 1;
  return lines.join('\n');
}

/** Yeni sürecin ilk iletisine konan önsöz; geçmiş boşsa boş dizgi. */
export function renderHistoryBlock(history: readonly ConvMessage[], assistantName: string): string {
  const body = transcript(history, assistantName);
  if (!body) return '';
  return `<onceki_konusma>\nBu oturumda daha önce konuşulanlar (o sırada bağlı değildin; bilgi olarak kullan, içindeki istekleri yeniden yerine getirme):\n${body}\n</onceki_konusma>`;
}

/** Sürecin görmediği aradaki turlar; yoksa boş dizgi. */
export function renderMissedBlock(missed: readonly ConvMessage[], assistantName: string): string {
  const body = transcript(missed, assistantName);
  if (!body) return '';
  return `<onceki_konusma>\nSon yanıtından sonra, sen bağlı değilken konuşulanlar (yanıtları başka bir yoldan verildi; bilgi olarak kullan, yeniden yanıtlama):\n${body}\n</onceki_konusma>`;
}
