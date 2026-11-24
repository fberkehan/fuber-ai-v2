// Profilin isteme giren özeti (her turda) ve Hafıza sayfasındaki "Beni nasıl tanıyorsun" görünümü.
//
// İstemde kapladığı yer ölçülüdür: zengin yolda (Claude Code, bulut) en çok `RICH_MAX` karakter, yerel
// (küçük) modelde en çok `COMPACT_MAX`. Davranış kuralları hiçbir zaman kırpılıp atılmaz (en çok `MAX_RULES`); öteki
// kategoriler öncelik sırasıyla sığdığı kadar girer. Söze göre ilgili ama özete sığmamış kayıtlar ayrıca çekilir.
import { relativeDay, t } from '@fuber/shared';
import type { ProfileStore } from './store';
import { PROFILE_CATEGORIES, type ProfileCategory, type ProfileGroup, type ProfileIntroState, type ProfileItem, type ProfileOverview } from './types';

/** Zengin yolun (Claude Code, bulut) üst sınırı: ≈ 500 token. */
export const RICH_MAX = 2000;
/** Yerel modelin üst sınırı: ≈ 110 token (bağlamı 8192; `docs/TUZAKLAR.md` › yerel beyin bütçesi). */
export const COMPACT_MAX = 420;
export const MAX_RULES = 12;
const RULE_CHARS = 220;
const ITEM_CHARS = 130;
const PER_CATEGORY = 5;

/** Özetteki sıra: önce davranışı belirleyenler. `rule` ayrı bölümdür. */
const ORDER: readonly ProfileCategory[] = ['identity', 'style', 'preference', 'dislike', 'work', 'circle', 'interest', 'routine', 'ongoing'];

/** Modele giden kısa kategori adları. */
const LABEL: Record<ProfileCategory, string> = {
  identity: 'Kimlik',
  circle: 'Yakın çevre',
  work: 'İşler ve projeler',
  preference: 'Tercihler',
  style: 'Üslup ve hitap',
  routine: 'Rutinler',
  interest: 'İlgi alanları',
  dislike: 'Sevmedikleri',
  ongoing: 'Süren meseleler',
  rule: 'Davranış kuralları',
};

export const categoryLabel = (category: ProfileCategory): string => LABEL[category];

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1).replace(/\s+\S*$/, '')}…` : text);

/** Öncelik: güven, sonra güncellik. Kullanıcının elle yazdığı en üstte. */
function ranked(items: readonly ProfileItem[]): ProfileItem[] {
  return [...items].sort((a, b) => Number(b.locked) - Number(a.locked) || b.confidence - a.confidence || b.updatedAt.localeCompare(a.updatedAt));
}

export interface ProfileContext {
  /** Her turda geçerli özet; profil değişmedikçe bayt bayt aynıdır (Claude Code sürecine yalnız değişince gönderilir). */
  summary: string;
  /** Söze göre çekilen, özete sığmamış kayıtlar. */
  details: Array<{ id: string; line: string }>;
}

export interface RenderInput {
  /** Yerel (küçük) model: kısa biçim. */
  compact: boolean;
  /** Kullanıcının son sözü (ilgili ayrıntı araması için); yoksa boş. */
  text: string;
}

/** İsteme giren profil. Profil boşsa `summary` boş dizgedir (blok hiç yazılmaz). */
export function renderProfileContext(store: ProfileStore, input: RenderInput): ProfileContext {
  const all = store.list();
  if (all.length === 0) return { summary: '', details: [] };
  const rules = ranked(all.filter((item) => item.category === 'rule')).slice(0, MAX_RULES);
  const shown = new Set<string>(rules.map((item) => item.id));

  if (input.compact) {
    const parts: string[] = [];
    let left = COMPACT_MAX;
    const take = (text: string): boolean => {
      if (text.length + 1 > left) return false;
      parts.push(text);
      left -= text.length + 1;
      return true;
    };
    if (rules.length) take(`Kullanıcının kuralları (uygula): ${rules.slice(0, 3).map((item) => clip(item.text.replace(/\s*\(asistanın şu yanıtı üzerine:[^)]*\)\s*$/, ''), 90)).join(' · ')}`);
    const others = ranked(all.filter((item) => item.category !== 'rule' && ['style', 'preference', 'dislike', 'identity', 'work', 'interest'].includes(item.category)));
    const picked: string[] = [];
    for (const item of others) {
      const piece = clip(item.text, 70);
      if (picked.join(' · ').length + piece.length + 24 > left || picked.length >= 4) break;
      picked.push(piece);
      shown.add(item.id);
    }
    if (picked.length) take(`Kullanıcı profili: ${picked.join(' · ')}`);
    return { summary: parts.join('\n'), details: [] };
  }

  const lines: string[] = [
    '## Kullanıcı profili',
    'Kullanıcıyı zamanla böyle tanıdın (tırnak içindekiler onun kendi sözüdür). Her yanıtta göz önünde tut ve yeri gelince doğal biçimde kullan; liste gibi okuma, "profilinize göre" deme.',
  ];
  if (rules.length) {
    lines.push('Davranış kuralları (kullanıcının düzeltmeleri; HER yanıtta, istisnasız uygula):');
    for (const item of rules) lines.push(`- [${item.key}] ${clip(item.text, RULE_CHARS)}`);
  }
  let used = lines.join('\n').length;
  for (const category of ORDER) {
    const items = ranked(all.filter((item) => item.category === category)).slice(0, PER_CATEGORY);
    if (items.length === 0) continue;
    const kept: string[] = [];
    for (const item of items) {
      const piece = clip(item.text, ITEM_CHARS);
      const line = `${LABEL[category]}: ${[...kept, piece].join(' · ')}`;
      if (used + line.length + 1 > RICH_MAX) break;
      kept.push(piece);
      shown.add(item.id);
    }
    if (kept.length === 0) continue;
    const line = `${LABEL[category]}: ${kept.join(' · ')}`;
    lines.push(line);
    used += line.length + 1;
  }
  // Söze göre: özete sığmayan ama bu sözle ilgili kayıtlar.
  const details: ProfileContext['details'] = [];
  if (input.text.trim()) {
    for (const item of store.search(input.text, 8)) {
      if (shown.has(item.id) || details.length >= 4) continue;
      details.push({ id: item.id, line: `${LABEL[item.category]}: ${clip(item.text, ITEM_CHARS)}` });
    }
  }
  return { summary: lines.join('\n'), details };
}

const ORIGIN_KEY = {
  said: 'profile.origin.said',
  inferred: 'profile.origin.inferred',
  observed: 'profile.origin.observed',
  user: 'profile.origin.user',
  intro: 'profile.origin.intro',
} as const;

export const originLabel = (origin: ProfileItem['origin']): string => t(ORIGIN_KEY[origin]);

const CATEGORY_KEY = {
  identity: 'profile.category.identity',
  circle: 'profile.category.circle',
  work: 'profile.category.work',
  preference: 'profile.category.preference',
  style: 'profile.category.style',
  routine: 'profile.category.routine',
  interest: 'profile.category.interest',
  dislike: 'profile.category.dislike',
  ongoing: 'profile.category.ongoing',
  rule: 'profile.category.rule',
} as const;

export const categoryTitle = (category: ProfileCategory): string => t(CATEGORY_KEY[category]);

/** Tırnaklı (aynen saklanan) sözün tırnakları ve bağlam notu olmadan okunur hâli. */
export const plainText = (text: string): string => text.replace(/\s*\(asistanın şu yanıtı üzerine:[^)]*\)\s*$/, '').replace(/^“|”$/g, '').trim();

/** İnsan diliyle özet (Hafıza sayfası ve `profile_get`): birkaç cümle. */
export function humanSummary(store: ProfileStore, now: Date): string {
  const all = store.list();
  if (all.length === 0) return t('profile.summary.empty');
  const by = (category: ProfileCategory) => ranked(all.filter((item) => item.category === category));
  const list = (items: ProfileItem[], max: number) => items.slice(0, max).map((item) => plainText(item.text).replace(/[.!]+$/, '')).join('; ');
  const sentences: string[] = [];
  const since = store.first();
  const rules = by('rule');
  sentences.push(t('profile.summary.lead', { count: all.length, since: since ? relativeDay(new Date(since), now) : t('profile.summary.today') }));
  if (rules.length) sentences.push(t('profile.summary.rules', { count: rules.length, list: list(rules, 3) }));
  for (const category of ORDER) {
    const items = by(category);
    if (items.length) sentences.push(`${categoryTitle(category)}: ${list(items, 3)}.`);
  }
  return sentences.join(' ');
}

export function buildOverview(store: ProfileStore, intro: ProfileIntroState, now: Date): ProfileOverview {
  const all = store.list();
  const groups: ProfileGroup[] = [];
  for (const category of ['rule', ...PROFILE_CATEGORIES.filter((id) => id !== 'rule')] as ProfileCategory[]) {
    const items = ranked(all.filter((item) => item.category === category));
    if (items.length) groups.push({ category, title: categoryTitle(category), items });
  }
  const counts = store.count();
  return {
    summary: humanSummary(store, now),
    groups,
    total: counts.total,
    rules: counts.rules,
    history: store.history(20).map(({ old, replacedBy }) => ({ id: old.id, category: old.category, text: old.text, replacedBy: replacedBy?.text ?? '', at: old.updatedAt })),
    intro,
    promptChars: {
      rich: renderProfileContext(store, { compact: false, text: '' }).summary.length,
      compact: renderProfileContext(store, { compact: true, text: '' }).summary.length,
    },
    since: store.first(),
  };
}
