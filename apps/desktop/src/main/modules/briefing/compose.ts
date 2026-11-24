// Brifingin içeriği: takvim, son günler, bekleyen işler, e-posta ve kişiselleştirilmiş gündem tek metinde ve tek kartta.
// Metin KODLA kurulur (şablon): model çağrısı yok, abonelik kotası harcanmaz, internet yokken de çalışır ve her gün
// aynı güvenilirlikte söylenir. Haber başlıkları dış içeriktir: yalnız seslendirilir ve kartta gösterilir; modele
// ancak `briefing_now` aracının çerçeveli sonucuyla gider.
import { localDay, newId, t, type LocalDay } from '@fuber/shared';
import type { NewsStory } from '../news/types';
import type { Briefing, BriefingKind, BriefingNewsItem, BriefingPrefs, BriefingSection } from './types';

export interface AgendaLine {
  /** `SS:DD`; saatsizse `null`. */
  time: string | null;
  text: string;
  overdue: boolean;
}

/** Brifingin okuduğu kaynaklar (modül bağlamından; sınamada sahte). Kapalı modülün kaynağı boş döner. */
export interface BriefingSources {
  /** Kullanıcıya hitap ("Deniz Hanım", "efendim"): ayardan gelir, sabit yazılmaz. */
  address(): string;
  agenda(day: LocalDay): AgendaLine[];
  /** Bugüne ya da öncesine vadeli açık yapılacaklar ve vadesiz açıkların sayısı. */
  tasks(day: LocalDay): { due: string[]; open: number };
  /** Yaklaşan (7 gün) ve gecikmiş son günler; hazır Türkçe satırlar. */
  /** Okunmamış önemli e-postalar: gönderen ve konu; hesap yoksa `null`. */
  mail(): { count: number; items: string[] } | null;
  /** Kişiselleştirilmiş, okunmamış haberler (puan sırasıyla). `since`: yalnız bu andan sonra görülenler. */
  news(limit: number, since?: string): NewsStory[];
}

const ORDINALS = ['briefing.ordinal.1', 'briefing.ordinal.2', 'briefing.ordinal.3', 'briefing.ordinal.4', 'briefing.ordinal.5'] as const;

export function greetingFor(now: Date): string {
  const hour = now.getHours();
  if (hour >= 5 && hour < 11) return t('briefing.greeting.morning');
  if (hour >= 11 && hour < 17) return t('briefing.greeting.day');
  if (hour >= 17 && hour < 23) return t('briefing.greeting.evening');
  return t('briefing.greeting.night');
}

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1).replace(/\s+\S*$/, '')}…` : text);
/** Seslendirilecek başlık: tırnak ve köşeli işaretler atılır, sondaki nokta alınır. */
const speakable = (title: string): string => clip(title.replace(/[«»“”"[\]<>]/g, '').replace(/\s+/g, ' ').trim().replace(/[.!…]+$/, ''), 150);

const toNewsItem = (story: NewsStory): BriefingNewsItem => ({ id: story.id, title: story.title, url: story.url, source: story.sources.length > 1 ? `${story.source} +${story.sources.length - 1}` : story.source, reasons: story.reasons });

/** Haberin söylenişi: takip edilen konu ya da ilgi alanı varsa başına eklenir ("yapay zekâ tarafında: …"). */
function spokenStory(story: NewsStory): string {
  const reason = story.reasons.find((item) => /^(takip|ilgi alanı):/.test(item));
  const topic = reason?.replace(/^(takip|ilgi alanı):\s*/, '').trim();
  return topic ? t('briefing.news.withTopic', { topic, title: speakable(story.title) }) : speakable(story.title);
}

function spokenNews(stories: NewsStory[], kind: BriefingKind): string {
  if (stories.length === 0) return '';
  const turkish = stories.filter((story) => story.lang === 'tr');
  const foreign = stories.length - turkish.length;
  const parts: string[] = [];
  if (turkish.length > 0) {
    const list = turkish.map((story, index) => (turkish.length > 1 && ORDINALS[index] ? `${t(ORDINALS[index])} ${spokenStory(story)}` : spokenStory(story))).join('. ');
    parts.push(t(kind === 'update' ? 'briefing.news.update' : 'briefing.news.lead', { count: turkish.length }), `${list}.`);
  }
  // Yabancı dildeki başlık Türkçe sesle okunmaz; sayısı söylenir, kartta görünür.
  if (foreign > 0) parts.push(t(turkish.length > 0 ? 'briefing.news.foreignAlso' : 'briefing.news.foreignOnly', { count: foreign }));
  return parts.join(' ');
}

export interface ComposeInput {
  kind: BriefingKind;
  now: Date;
  prefs: BriefingPrefs;
  sources: BriefingSources;
  /** Güncelleme / önemli gelişme: yalnız bu andan sonra görülen haberler. */
  since?: string;
  /** Önemli gelişme: söylenecek hikâyeler (çağıran seçer). */
  stories?: NewsStory[];
}

/** Brifingi kurar; `delivered` ve `response` çağıran (motor) tarafından sonradan yazılır. */
export function composeBriefing(input: ComposeInput): Briefing {
  const { kind, now, prefs, sources } = input;
  const day = localDay(now);
  const address = sources.address();
  const sections: BriefingSection[] = [];
  const spoken: string[] = [];
  const full = kind === 'morning' || kind === 'manual';

  if (kind === 'breaking') spoken.push(t('briefing.spoken.breakingLead', { address }));
  else if (kind === 'update') spoken.push(t('briefing.spoken.updateLead', { address }));
  else spoken.push(`${greetingFor(now)} ${address}.`);

  if (full && prefs.scope.agenda) {
    const agenda = sources.agenda(day);
    if (agenda.length) {
      sections.push({ id: 'agenda', title: t('briefing.section.agenda'), lines: agenda.map((item) => `${item.time ? `${item.time} ` : ''}${item.text}${item.overdue ? ` ${t('briefing.overdue')}` : ''}`) });
      const said = agenda.slice(0, 3).map((item) => (item.time ? t('briefing.agenda.timed', { time: item.time, text: item.text }) : item.text));
      spoken.push(t(agenda.length === 1 ? 'briefing.spoken.agendaOne' : 'briefing.spoken.agenda', { count: agenda.length, list: said.join('; ') }));
      if (agenda.length > 3) spoken.push(t('briefing.spoken.more', { count: agenda.length - 3 }));
    }
  }

  if (full && prefs.scope.tasks) {
    const tasks = sources.tasks(day);
    if (tasks.due.length || tasks.open) {
      const lines = [...tasks.due];
      if (tasks.open) lines.push(t('briefing.tasks.open', { count: tasks.open }));
      sections.push({ id: 'tasks', title: t('briefing.section.tasks'), lines });
      if (tasks.due.length) spoken.push(t('briefing.spoken.tasks', { count: tasks.due.length, first: tasks.due[0]! }));
    }
  }
  if (full && prefs.scope.mail) {
    const mail = sources.mail();
    if (mail && mail.count > 0) {
      sections.push({ id: 'mail', title: t('briefing.section.mail'), lines: mail.items });
      spoken.push(t(mail.count === 1 ? 'briefing.spoken.mailOne' : 'briefing.spoken.mail', { count: mail.count }));
    }
  }

  let stories: NewsStory[] = [];
  if (kind === 'breaking') stories = input.stories ?? [];
  else if (prefs.scope.news) stories = input.stories ?? sources.news(prefs.newsCount, input.since);
  const news = stories.map(toNewsItem);
  if (stories.length) {
    sections.push({ id: 'news', title: t('briefing.section.news'), lines: stories.map((story) => `${story.title} · ${story.source}`) });
    if (kind === 'breaking') {
      const top = stories[0]!;
      spoken.push(`${spokenStory(top)}.`);
      if (top.sources.length > 1) spoken.push(t('briefing.spoken.breakingSources', { count: top.sources.length }));
    } else {
      spoken.push(spokenNews(stories, kind));
    }
  }

  const empty = sections.length === 0;
  if (empty && full) spoken.push(t('briefing.spoken.empty'));
  else if (full && stories.length) spoken.push(t('briefing.spoken.outro'));

  return {
    id: newId(),
    kind,
    day,
    at: now.toISOString(),
    greeting: kind === 'breaking' ? t('briefing.card.breaking') : kind === 'update' ? t('briefing.card.update') : `${greetingFor(now)} ${address}`,
    spoken: spoken.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim(),
    sections,
    news,
    delivered: 'card',
    reason: null,
    response: 'pending',
  };
}

/** Brifingde söylenecek bir şey var mı (boş güncelleme hiç üretilmez). */
export const hasContent = (briefing: Briefing): boolean => briefing.sections.length > 0;
