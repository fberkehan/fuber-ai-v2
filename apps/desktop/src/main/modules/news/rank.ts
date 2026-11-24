// Gündemin saf işlevleri: başlık kümeleme (aynı olay → tek hikâye), konu eşleşmesi (Türkçe↔İngilizce küçük eş anlam
// tablosuyla), puanlama, nedenler, sessize alma ve çeşitlilik. Saat ve veri dışarıdan gelir; yan etki yoktur.
//
// Puan (0–100):
//   tazelik            en çok 40; yarı ömür 12 saat
//   çok kaynak         ek kaynak başına +8, en çok 24
//   takip konusu       +30
//   profil ilgi alanı  +18
//   kategori ilgisi    +8 (takip/ilgi konusu hikâyenin konusuna denk düşüyorsa: "yapay zekâ" → `ai`)
// Sessize alınan konu ya da profilin sevmedikleri başlıkta geçerse hikâye ELENİR.
import { stemSet, stemSetSimilarity, t } from '@fuber/shared';
import { fold } from '../web/text';
import type { NewsCategory, NewsStory } from './types';

const HOUR = 60 * 60_000;
export const CLUSTER_WINDOW_MS = 36 * HOUR;
export const CLUSTER_SIMILARITY = 0.6;
export const FRESH_HALF_LIFE_MS = 12 * HOUR;

export const SCORE = { freshMax: 40, perSource: 8, sourcesMax: 24, follow: 30, interest: 18, category: 8 } as const;

/** Kümelemeye girecek başlık (depodaki satırın saf biçimi). */
export interface RankItem {
  id: string;
  sourceId: string;
  sourceName: string;
  category: NewsCategory;
  /** Kaynağın dili. */
  lang: string;
  title: string;
  url: string;
  /** Yayın anı (ms); beslemede yoksa `null`. */
  at: number | null;
  /** İlk görülme anı (ms). */
  firstSeen: number;
}

export interface Cluster {
  /** Belirleyici kimlik: kümenin en erken görülen öğesinin kimliği. */
  id: string;
  items: RankItem[];
}

// Kümelemede sayılmayan, her başlıkta geçebilen sözcükler (katlanmış, kök biçimi).
const CLUSTER_STOP = new Set(
  (
    'son dakika icin ile gibi daha kadar sonra once olan oldu olarak yeni haber haberi bugun dun yarin cok bir iki uzerinde ' +
    'nedir neden nasil hangi kim ama fakat veya bunu buna diye dedi etti eden edildi yapti yapildi geldi ' +
    'the and for with from that this after over into about says said new news are was has have not but you your how why what who will its his her their they than more'
  ).split(' '),
);

function clusterStems(title: string): Set<string> {
  const stems = stemSet(title);
  for (const stem of [...stems]) if (CLUSTER_STOP.has(stem) || stem.length < 3) stems.delete(stem);
  return stems;
}

const timeOf = (item: RankItem) => item.at ?? item.firstSeen;
const normalUrl = (url: string) => url.replace(/^https?:\/\/(www\.)?/i, '').replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();

/**
 * Aynı olayı anlatan başlıkları kümeler: aynı adres ya da kök kümesi benzerliği ≥ 0,6 (en az iki ortak kök) ve 36 saat
 * içinde. Ortak kökü olan kümeler ters dizinle bulunur (bütün çiftler karşılaştırılmaz).
 */
export function clusterItems(items: readonly RankItem[]): Cluster[] {
  const sorted = [...items].sort((a, b) => timeOf(b) - timeOf(a) || a.id.localeCompare(b.id));
  const clusters: Array<{ items: RankItem[]; stems: Array<Set<string>> }> = [];
  const byStem = new Map<string, Set<number>>();
  const byUrl = new Map<string, number>();
  for (const item of sorted) {
    const stems = clusterStems(item.title);
    const url = normalUrl(item.url);
    let target = byUrl.get(url) ?? -1;
    if (target === -1) {
      const candidates = new Set<number>();
      for (const stem of stems) for (const index of byStem.get(stem) ?? []) candidates.add(index);
      let best = 0;
      for (const index of candidates) {
        const cluster = clusters[index]!;
        cluster.items.forEach((member, memberIndex) => {
          if (Math.abs(timeOf(member) - timeOf(item)) > CLUSTER_WINDOW_MS) return;
          const other = cluster.stems[memberIndex]!;
          let common = 0;
          for (const stem of stems) if (other.has(stem)) common++;
          if (common < 2) return;
          const similarity = stemSetSimilarity(stems, other);
          if (similarity >= CLUSTER_SIMILARITY && similarity > best) {
            best = similarity;
            target = index;
          }
        });
      }
    }
    if (target === -1) {
      target = clusters.length;
      clusters.push({ items: [], stems: [] });
    }
    const cluster = clusters[target]!;
    cluster.items.push(item);
    cluster.stems.push(stems);
    byUrl.set(url, target);
    for (const stem of stems) {
      const set = byStem.get(stem) ?? new Set<number>();
      set.add(target);
      byStem.set(stem, set);
    }
  }
  return clusters.map((cluster) => {
    const earliest = [...cluster.items].sort((a, b) => a.firstSeen - b.firstSeen || a.id.localeCompare(b.id))[0]!;
    return { id: earliest.id, items: cluster.items };
  });
}

// ───────────────────────── konu eşleşmesi ─────────────────────────

// Konudan atılan genel sözcükler ("yapay zekâ haberleri" → "yapay zekâ").
const TOPIC_STOP = new Set(
  (
    've veya ile ama ki de da mi mu ne bir bu su o icin gibi kadar daha en cok az olan the a an and or of to in on for is are about news ' +
    'haber haberi haberler haberleri haberlerini haberlerinde gundem gundemi gelisme gelismeler gelismeleri son dakika konu konusu konusunda ile ilgili'
  ).split(' '),
);

/** Türkçe↔İngilizce küçük eş anlam tablosu (katlanmış). Konu bir öbekle aynıysa öbeğin herhangi biri eşleşir. */
export const SYNONYMS: ReadonlyArray<{ phrases: readonly string[]; category?: NewsCategory }> = [
  { phrases: ['yapay zeka', 'ai', 'artificial intelligence', 'llm', 'openai', 'chatgpt', 'yz', 'generative ai'], category: 'ai' },
  { phrases: ['girisim', 'girisimcilik', 'startup', 'startups', 'funding', 'yatirim turu'], category: 'startup' },
  { phrases: ['ekonomi', 'economy', 'enflasyon', 'faiz', 'merkez bankasi', 'inflation'], category: 'economy' },
  { phrases: ['doviz', 'dolar', 'euro', 'kur'], category: 'economy' },
  { phrases: ['teknoloji', 'tech', 'technology'], category: 'tech' },
  { phrases: ['kripto', 'bitcoin', 'crypto', 'kripto para'] },
  // Sık sessize alınan konular: "spor haberlerini sevmem" derbi, maç ve transfer başlıklarını da eler.
  { phrases: ['spor', 'futbol', 'super lig', 'derbi', 'mac', 'basketbol', 'voleybol', 'transfer', 'gol', 'sampiyonlar ligi', 'sports', 'football'] },
  { phrases: ['magazin', 'unluler', 'celebrity', 'dedikodu'] },
  { phrases: ['siyaset', 'politika', 'meclis', 'secim', 'politics'] },
  { phrases: ['dunya', 'world', 'dunya gundemi'], category: 'world' },
  { phrases: ['turkiye', 'turkiye gundemi'], category: 'tr' },
];

interface Term {
  /** Katlanmış sözcüğün ilk 5 harfi (`modules/web/text.ts` › `terms` ile aynı kaba kök). */
  prefix: string;
  /** Başlıktaki sözcüğün en az uzunluğu ("girişim" "giriş"e uymasın: en az min(özgün, 6) harf). */
  minLength: number;
}

function topicTerms(text: string): Term[] {
  const words = fold(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 2 && !TOPIC_STOP.has(word));
  const seen = new Set<string>();
  const out: Term[] = [];
  for (const word of words) {
    const prefix = word.slice(0, 5);
    if (seen.has(prefix)) continue;
    seen.add(prefix);
    out.push({ prefix, minLength: Math.min(word.length, 6) });
  }
  return out;
}

/** Başlığın katlanmış sözcükleri (eşleşme için). */
export function titleWords(title: string): string[] {
  return fold(title)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

function termIn(term: Term, words: readonly string[]): boolean {
  // Kısa terim (ai, kur) yalnız tam sözcükle eşleşir; uzun terim sözcüğün başıyla (Türkçe ekler).
  return words.some((word) => (term.prefix.length <= 3 ? word === term.prefix : word.startsWith(term.prefix) && word.length >= term.minLength));
}

export interface TopicMatcher {
  text: string;
  /** Konunun denk düştüğü kategori (eş anlam tablosundan); yoksa `null`. */
  category: NewsCategory | null;
  matches(words: readonly string[]): boolean;
}

/** Konudan eşleştirici kurar; anlamlı sözcüğü yoksa `null`. Çok sözcüklü konuda BÜTÜN anlamlı kökler geçmelidir. */
export function topicMatcher(text: string): TopicMatcher | null {
  const own = topicTerms(text);
  if (own.length === 0) return null;
  const key = own.map((term) => term.prefix).join(' ');
  const group = SYNONYMS.find((entry) => entry.phrases.some((phrase) => topicTerms(phrase).map((term) => term.prefix).join(' ') === key));
  const alternatives = group ? group.phrases.map(topicTerms).filter((terms) => terms.length > 0) : [own];
  return {
    text,
    category: group?.category ?? null,
    matches: (words) => alternatives.some((terms) => terms.every((term) => termIn(term, words))),
  };
}

// ───────────────────────── puanlama ─────────────────────────

export interface RankTopics {
  /** Kullanıcının takip ettiği konular. */
  follow: readonly string[];
  /** Kullanıcının sessize aldığı konular. */
  mute: readonly string[];
  /** Profil katmanının ilgi alanları (kullanıcı sessize aldıysa sayılmaz). */
  interests: readonly string[];
  /** Profilin sevmedikleri. */
  dislikes: readonly string[];
}

export interface RankedStory extends NewsStory {
  /** Kümenin ilk görülme anı (ms; `since` süzgeci). */
  firstSeen: number;
  /** Takip konusu eşleşti mi (son dakika kuralı). */
  followHit: boolean;
  /** Kümedeki bütün öğe kimlikleri (okundu işaretleme). */
  itemIds: string[];
}

export interface RankOptions {
  now: number;
  topics: RankTopics;
  /** Okundu mu (kümenin öğelerine göre). */
  isRead(items: readonly RankItem[]): boolean;
}

/** Türkçe başlık mı: kaynak dili `tr` ya da Türkçe harf oranı yüksek. */
export function looksTurkish(text: string): boolean {
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  if (letters === 0) return false;
  const turkish = text.match(/[çğıöşüÇĞİÖŞÜ]/g)?.length ?? 0;
  return turkish / letters >= 0.015;
}

export function freshness(ageMs: number): number {
  return SCORE.freshMax * 0.5 ** (Math.max(0, ageMs) / FRESH_HALF_LIFE_MS);
}

/** Kümeleri puanlı hikâyelere çevirir; sessize alınan konudakiler elenir. Sıralama yapmaz. */
export function rankClusters(clusters: readonly Cluster[], options: RankOptions): RankedStory[] {
  const build = (list: readonly string[]) => list.map(topicMatcher).filter((matcher): matcher is TopicMatcher => matcher !== null);
  const mutedKeys = new Set(options.topics.mute.map((text) => fold(text).trim()));
  const follow = build(options.topics.follow);
  const mute = build([...options.topics.mute, ...options.topics.dislikes]);
  const followKeys = new Set(options.topics.follow.map((text) => fold(text).trim()));
  const interests = build(options.topics.interests.filter((text) => !mutedKeys.has(fold(text).trim()) && !followKeys.has(fold(text).trim())));
  const interestCategories = new Set([...follow, ...interests].flatMap((matcher) => (matcher.category ? [matcher.category] : [])));

  const out: RankedStory[] = [];
  for (const cluster of clusters) {
    // Adresin yolu da bakılır: yayıncılar kategoriyi oraya yazar (`/spor/…`, `/ekonomi/…`); başlıkta konu sözcüğü geçmese de eşleşir.
    const wordsPerItem = cluster.items.map((item) => [...titleWords(item.title), ...titleWords(item.url.replace(/^https?:\/\/[^/]+/i, '').replace(/[?#].*$/, ''))]);
    if (mute.some((matcher) => wordsPerItem.some((words) => matcher.matches(words)))) continue;
    const newest = [...cluster.items].sort((a, b) => timeOf(b) - timeOf(a));
    const chosen = newest.find((item) => item.lang === 'tr' || looksTurkish(item.title)) ?? newest[0]!;
    const sources = [...new Set([chosen.sourceName, ...newest.map((item) => item.sourceName)])];
    const at = Math.max(...cluster.items.map(timeOf));
    const firstSeen = Math.min(...cluster.items.map((item) => item.firstSeen));
    const hit = (matcher: TopicMatcher) => wordsPerItem.some((words) => matcher.matches(words));
    const followHit = follow.find(hit);
    const interestHit = followHit ? undefined : interests.find(hit);
    const reasons: string[] = [];
    let score = freshness(options.now - at);
    score += Math.min(SCORE.sourcesMax, SCORE.perSource * (sources.length - 1));
    if (followHit) {
      score += SCORE.follow;
      reasons.push(t('news.reason.follow', { topic: followHit.text }));
    }
    if (interestHit) {
      score += SCORE.interest;
      reasons.push(t('news.reason.interest', { topic: interestHit.text }));
    }
    if (interestCategories.has(chosen.category)) score += SCORE.category;
    if (sources.length >= 2) reasons.push(t('news.reason.sources', { count: sources.length }));
    const anyAt = cluster.items.some((item) => item.at !== null);
    out.push({
      id: cluster.id,
      title: chosen.title,
      url: chosen.url,
      source: chosen.sourceName,
      sources,
      category: chosen.category,
      lang: chosen.lang === 'tr' || looksTurkish(chosen.title) ? 'tr' : chosen.lang,
      at: anyAt ? new Date(at).toISOString() : null,
      score: Math.max(0, Math.min(100, Math.round(score))),
      reasons,
      read: options.isRead(cluster.items),
      firstSeen,
      followHit: !!followHit,
      itemIds: cluster.items.map((item) => item.id),
    });
  }
  return out;
}

/** Sıralama: okunmamış önce, sonra puan, sonra tazelik. */
export function sortStories<T extends Pick<NewsStory, 'read' | 'score' | 'at'> & { firstSeen?: number }>(stories: readonly T[]): T[] {
  const time = (story: T) => (story.at ? Date.parse(story.at) : (story.firstSeen ?? 0));
  return [...stories].sort((a, b) => Number(a.read) - Number(b.read) || b.score - a.score || time(b) - time(a));
}

/** Çeşitlilik: aynı kaynaktan art arda en çok `run` hikâye (uygun aday yoksa sıra korunur). */
export function diversify<T extends Pick<NewsStory, 'source'>>(stories: readonly T[], run = 2): T[] {
  const rest = [...stories];
  const out: T[] = [];
  while (rest.length) {
    const blocked = out.length >= run && out.slice(-run).every((story) => story.source === out.at(-1)!.source) ? out.at(-1)!.source : null;
    const index = blocked === null ? 0 : rest.findIndex((story) => story.source !== blocked);
    out.push(...rest.splice(index === -1 ? 0 : index, 1));
  }
  return out;
}

/** Hikâyeden iç alanları atar (arayüze ve modele giden biçim). */
export function publicStory(story: RankedStory): NewsStory {
  const { firstSeen: _firstSeen, followHit: _followHit, itemIds: _itemIds, ...rest } = story;
  return rest;
}
