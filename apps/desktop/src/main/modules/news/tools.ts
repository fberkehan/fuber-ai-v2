// Gündem araçları. Hepsi `briefing` kümesindedir; adlar bilerek `news_` ile BAŞLAMAZ (o önek yerel modelde `info`
// kümesine düşer). Dış içerik (başlıklar) güvenilmezdir: modele `[WEB İÇERİĞİ BAŞI/SONU]` çerçevesinde gider ve
// çerçevenin içinde geçen işaretler etkisizleştirilir.
import { defineTool, relativeTime, t, UserError, type ToolDef } from '@fuber/shared';
import { z } from 'zod';
import { fold } from '../web/text';
import { CATEGORY_LABEL } from './catalog';
import type { NewsService } from './service';
import { NEWS_CATEGORIES, type NewsCategory, type NewsSourceView } from './types';

export interface NewsToolRuntime {
  service(): NewsService;
  now(): number;
}

/** Web içeriğini işaretli bloğa koyar (`modules/web` ile aynı çerçeve); içerideki işaretler bozulur, blok dışına kaçılamaz. */
export function fenced(content: string): string {
  const begin = t('web.read.begin');
  const end = t('web.read.end');
  const safe = content.split(begin).join('[…]').split(end).join('[…]');
  return `${t('web.untrusted')}\n${begin}\n${safe}\n${end}`;
}

const plain = (text: string) => fold(text).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Kaynağı ad ya da kimlikle bulur: tam kimlik, tam ad, sonra adın içinde geçen. */
export function findSources(list: readonly NewsSourceView[], query: string): NewsSourceView[] {
  const wanted = plain(query.replace(/['’ʼ`´]\p{L}*$/u, ''));
  if (!wanted) return [];
  const byId = list.filter((source) => source.id === query.trim());
  if (byId.length) return byId;
  const exact = list.filter((source) => plain(source.name) === wanted);
  if (exact.length) return exact;
  return list.filter((source) => plain(source.name).includes(wanted) || plain(source.url).includes(wanted.replace(/\s+/g, '')));
}

const categoryInput = z.enum(NEWS_CATEGORIES);

export function newsTools(runtime: NewsToolRuntime): ToolDef[] {
  const live = () => runtime.service();
  return [
    defineTool({
      name: 'feed_add',
      group: 'briefing',
      description:
        'Kullanıcının haber kaynaklarına (RSS) yeni kaynak ekler: besleme adresi, site adresi ya da site adı verilebilir; besleme bulunur, doğrulanır ve eklenir. ' +
        'Kullanıcı "şu RSS kaynağını kendine ekle", "Webrazzi\'yi de takip et", "kaynaklarına theverge.com\'u ekle" dediğinde kullan. Site AÇMA.',
      input: z.object({ source: z.string().min(2).max(300).describe('Besleme ya da site adresi ("https://site.com/feed", "theverge.com") veya site adı ("webrazzi", "bbc türkçe")') }),
      risk: 'write',
      async run({ source }, ctx) {
        ctx.report(t('news.tool.stepAdd'));
        const result = await live().addSource(source);
        return {
          ok: result.ok,
          text: result.message,
          data: { source: result.source ? { id: result.source.id, name: result.source.name, url: result.source.url, category: result.source.category, items: result.source.itemCount } : null, tried: result.tried.length },
        };
      },
    }),
    defineTool({
      name: 'feed_remove',
      group: 'briefing',
      description:
        'Kullanıcının haber kaynaklarından birini çıkarır (kendi eklediği silinir, yerleşik kaynak kapatılır). "BBC\'yi kaynaklarından çıkar", "Sözcü\'yü artık okuma" dediğinde kullan. ' +
        'Birden çok kaynak uyarsa liste döner: tahmin etme, kullanıcıya hangisi olduğunu sor.',
      input: z.object({ source: z.string().min(1).max(200).describe('Kaynağın adı ya da kimliği ("BBC Türkçe", "verge")') }),
      risk: 'write',
      async run({ source }) {
        const service = live();
        const all = service.sources();
        const matches = findSources(all.filter((item) => item.enabled), source);
        const candidates = matches.length ? matches : findSources(all, source);
        if (candidates.length === 0) return { ok: false, text: t('news.remove.notFound', { query: source }) };
        if (candidates.length > 1) {
          return { ok: false, text: t('news.remove.ambiguous', { query: source, list: candidates.map((item) => item.name).join(', ') }), data: { candidates: candidates.map((item) => ({ id: item.id, name: item.name })) } };
        }
        const target = candidates[0]!;
        service.removeSource(target.id);
        return { ok: true, text: target.builtin ? t('news.remove.disabled', { name: target.name }) : t('news.remove.deleted', { name: target.name }), data: { id: target.id, builtin: target.builtin } };
      },
    }),
    defineTool({
      name: 'feed_list',
      group: 'briefing',
      description:
        'Kullanıcının haber kaynaklarını (açık/kapalı, okunamayanlar) ve takip edilen/sessize alınan konuları listeler. "Hangi kaynaklardan haber alıyorsun", "haber kaynaklarım neler", ' +
        '"hangi konuları takip ediyorum" dediğinde kullan.',
      input: z.object({ category: categoryInput.optional().describe('Konu süzgeci: tr (Türkiye), world, economy, tech, ai, startup, other') }),
      risk: 'read',
      async run({ category }) {
        const service = live();
        const all = service.sources().filter((item) => !category || item.category === category);
        const on = all.filter((item) => item.enabled);
        const off = all.filter((item) => !item.enabled);
        const failing = on.filter((item) => item.lastError);
        const lines: string[] = [];
        const names = (list: readonly NewsSourceView[], max: number) => list.slice(0, max).map((item) => item.name).join(', ') + (list.length > max ? '…' : '');
        if (on.length === 0) lines.push(t('news.list.none'));
        else if (category) lines.push(t('news.list.headerCategory', { category: CATEGORY_LABEL[category as NewsCategory], count: on.length, list: names(on, 25) }));
        else lines.push(t('news.list.header', { count: on.length, list: names(on, 25) }));
        if (off.length) lines.push(t('news.list.disabled', { count: off.length, list: names(off, 5) }));
        if (failing.length) lines.push(t('news.list.failing', { list: failing.map((item) => `${item.name} (${item.lastError})`).join(', ') }));
        const topics = service.topics();
        const follow = topics.filter((topic) => topic.mode === 'follow');
        const mute = topics.filter((topic) => topic.mode === 'mute');
        if (follow.length) lines.push(t('news.list.follow', { list: follow.map((topic) => (topic.origin === 'profile' ? `${topic.text} (${t('news.topic.profile')})` : topic.text)).join(', ') }));
        if (mute.length) lines.push(t('news.list.mute', { list: mute.map((topic) => topic.text).join(', ') }));
        if (!follow.length && !mute.length) lines.push(t('news.list.noTopics'));
        return {
          ok: true,
          text: lines.join('\n'),
          data: {
            enabled: on.map((item) => ({ id: item.id, name: item.name, category: item.category })),
            disabled: off.length,
            failing: failing.map((item) => ({ id: item.id, name: item.name, error: item.lastError })),
            follow: follow.map((topic) => topic.text),
            mute: mute.map((topic) => topic.text),
          },
        };
      },
    }),
    defineTool({
      name: 'feed_topic',
      group: 'briefing',
      description:
        'Haber konusu takibi: follow (öne çıkar), mute (bu konudaki haberleri gösterme ve söyleme), remove (listeden çıkar). ' +
        'Kullanıcı bir konunun haberlerini takip etmek, görmemek ya da takipten çıkarmak istediğinde kullan: ' +
        '"Yapay zekâ haberlerini takip et" → follow, "magazin haberlerini gösterme" → mute, "futbolu takipten çıkar" → remove. Konuyu kısa yaz ("yapay zekâ", "magazin", "futbol").',
      input: z.object({
        topic: z.string().min(1).max(60).describe('Konu: "yapay zekâ", "dolar kuru", "Fenerbahçe"'),
        action: z.enum(['follow', 'mute', 'remove']).describe('follow, mute ya da remove'),
      }),
      risk: 'write',
      async run({ topic, action }) {
        const service = live();
        const clean = topic.replace(/\s+/g, ' ').trim();
        if (action === 'remove') {
          const before = service.topics().filter((item) => item.origin === 'user').length;
          let after: number;
          try {
            after = service.setTopic(clean, 'remove').filter((item) => item.origin === 'user').length;
          } catch (error) {
            if (error instanceof UserError) return { ok: false, text: error.message };
            throw error;
          }
          if (after === before) return { ok: false, text: t('news.topic.notFound', { topic: clean }) };
          return { ok: true, text: t('news.topic.removed', { topic: clean }) };
        }
        try {
          const topics = service.setTopic(clean, action);
          return {
            ok: true,
            text: action === 'follow' ? t('news.topic.followed', { topic: clean }) : t('news.topic.muted', { topic: clean }),
            data: { follow: topics.filter((item) => item.mode === 'follow').map((item) => item.text), mute: topics.filter((item) => item.mode === 'mute').map((item) => item.text) },
          };
        } catch (error) {
          if (error instanceof UserError) return { ok: false, text: error.message };
          throw error;
        }
      },
    }),
    defineTool({
      name: 'feed_news',
      group: 'briefing',
      description:
        'Kullanıcının KENDİ haber kaynaklarından, ilgisine göre puanlanmış ve aynı haberi veren kaynakları birleştirilmiş gündem (yalnız başlıklar). ' +
        '"Haberlerde ne var", "gündemde ne var", "bugün neler oldu", "benim için önemli ne var", "yapay zekâ tarafında ne var" sorularında news_get yerine BUNU kullan. ' +
        'Varsayılan olarak yalnız henüz söylenmemiş haberler gelir ve dönenler okundu sayılır. Site AÇMA.',
      input: z.object({
        topic: z.string().max(80).optional().describe('Konu süzgeci ("ekonomi", "OpenAI"); boşsa genel gündem'),
        category: categoryInput.optional().describe('Kaynak konusu: tr, world, economy, tech, ai, startup, other'),
        limit: z.number().int().min(1).max(10).optional().describe('Kaç haber; varsayılan 5, en çok 10'),
        unread_only: z.boolean().optional().describe('Yalnız henüz söylenmemişler; varsayılan true'),
        mark_read: z.boolean().optional().describe('Dönenler okundu sayılsın mı; varsayılan true'),
      }),
      risk: 'read',
      async run({ topic, category, limit, unread_only, mark_read }, ctx) {
        const service = live();
        const allowed = ctx.policy.networkAllowed();
        if (service.sources().every((item) => !item.enabled)) return { ok: false, text: t('news.tool.noSources') };
        if (allowed && service.stale()) {
          ctx.report(t('news.tool.step'));
          await service.refresh({ signal: ctx.signal });
        }
        const subject = topic?.trim() || undefined;
        const unreadOnly = unread_only ?? true;
        const list = service.stories({ limit: Math.min(10, limit ?? 5), unreadOnly, ...(category ? { category } : {}), ...(subject ? { topic: subject } : {}) });
        if (list.length === 0) {
          const any = unreadOnly && service.stories({ limit: 1, ...(category ? { category } : {}), ...(subject ? { topic: subject } : {}) }).length > 0;
          return { ok: true, text: subject ? t('news.tool.noneTopic', { topic: subject }) : any ? t('news.tool.noneAllRead') : t('news.tool.none'), data: { stories: [] } };
        }
        const now = new Date(runtime.now());
        const lines = list.map((story, index) => {
          const parts = [story.title, story.sources.join(', ')];
          if (story.at) parts.push(relativeTime(story.at, now));
          const reason = story.reasons.length ? ` (${story.reasons.join(', ')})` : '';
          return `${index + 1}. ${parts.join(' · ')}${reason}`;
        });
        if (mark_read ?? true) service.markRead(list.map((story) => story.id));
        const header = subject ? t('news.tool.headerTopic', { topic: subject, count: list.length }) : t('news.tool.header', { count: list.length });
        return {
          ok: true,
          text: `${allowed ? '' : `${t('news.tool.offline')}\n`}${header}\n${fenced(lines.join('\n'))}\n${t('news.tool.footer')}`,
          data: { stories: list.map((story) => ({ id: story.id, url: story.url })), untrusted: true },
        };
      },
    }),
  ];
}
