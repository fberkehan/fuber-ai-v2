// Brifing araçları: "brifing ver", "daha az konuş", "sabah brifingini sekizde ver", "haberleri sorma", "neden konuşmuyorsun".
// Ayar değerini model seçmek zorunda değildir: `briefing_set` aracına sözün KENDİSİ (`say`) verilebilir; değer kodla okunur.
import { defineTool, localTime, t } from '@fuber/shared';
import { z } from 'zod';
import type { BriefingEngine } from './engine';
import { parseSpokenPrefs, type PrefsPatch } from './prefs';
import { TALK_LEVELS, type Briefing, type BriefingPrefs, type BriefingState } from './types';

const TALK_KEY = { silent: 'briefing.talk.silent', low: 'briefing.talk.low', normal: 'briefing.talk.normal', high: 'briefing.talk.high' } as const;
const SCOPE_KEY = { news: 'briefing.scope.news', agenda: 'briefing.scope.agenda', tasks: 'briefing.scope.tasks', mail: 'briefing.scope.mail' } as const;

/** Dış içeriği (haber başlığı, e-posta konusu) işaretli bloğa koyar; içerikte işaret geçiyorsa bozulur. */
function fenced(content: string): string {
  const begin = t('web.read.begin');
  const end = t('web.read.end');
  return `${t('web.untrusted')}\n${begin}\n${content.split(begin).join('[…]').split(end).join('[…]')}\n${end}`;
}

/** Ayarların kullanıcıya söylenecek kısa özeti. */
export function describePrefs(prefs: BriefingPrefs): string {
  if (!prefs.enabled) return t('briefing.describe.off');
  const scope = (Object.keys(SCOPE_KEY) as Array<keyof typeof SCOPE_KEY>).filter((key) => prefs.scope[key]).map((key) => t(SCOPE_KEY[key]));
  return [
    t('briefing.describe.talk', { level: t(TALK_KEY[prefs.talk]) }),
    prefs.morning.enabled ? t('briefing.describe.morning', { time: prefs.morning.time }) : t('briefing.describe.morningOff'),
    t(prefs.breaking ? 'briefing.describe.breakingOn' : 'briefing.describe.breakingOff'),
    scope.length ? t('briefing.describe.scope', { list: scope.join(', ') }) : t('briefing.describe.scopeNone'),
  ].join(' ');
}

function briefingText(briefing: Briefing): string {
  const lines: string[] = [];
  for (const section of briefing.sections) {
    lines.push(`${section.title}:`);
    for (const line of section.lines) lines.push(`- ${line}`);
  }
  return lines.join('\n');
}

export function briefingTools(engine: () => BriefingEngine) {
  return [
    defineTool({
      name: 'briefing_now',
      group: 'briefing',
      description:
        'Günün brifingini şimdi hazırlar: bugünün takvimi ve hatırlatıcıları, yaklaşan son günler, bekleyen işler, önemli e-postalar ve kullanıcının ilgisine göre ' +
        'seçilmiş gündem. Kullanıcı "brifing ver", "bugün neler var", "günün özetini ver", "bana durumu özetle", "günaydın, neler oluyor" derse kullan. Bugün panosundaki ' +
        'brifing kartı da güncellenir. Sonucu sen anlat: kısa, konuşma diliyle, en önemliden başlayarak; hepsini okuma, kullanıcı isterse ayrıntıya gir.',
      input: z.object({}),
      risk: 'read',
      async run(_input, ctx) {
        ctx.report(t('briefing.step.preparing'));
        const briefing = await engine().runNow({ speak: false });
        if (briefing.sections.length === 0) return { ok: true, text: t('briefing.tool.empty'), data: { sections: 0 } };
        return {
          ok: true,
          text: `${t('briefing.tool.header', { time: localTime(new Date(briefing.at)) })}\n${fenced(briefingText(briefing))}\n${t('briefing.tool.footer')}`,
          data: { sections: briefing.sections.map((section) => section.id), news: briefing.news.map((item) => ({ id: item.id, url: item.url })), untrusted: true },
        };
      },
    }),
    defineTool({
      name: 'briefing_set',
      group: 'briefing',
      description:
        'Kendiliğinden konuşmanın (brifing) ayarını değiştirir: ne kadar konuşacağın, sabah brifinginin saati, önemli gelişmede araya girip girmeyeceğin, brifingde nelerin ' +
        'olacağı. Kullanıcı "daha az konuş", "kendiliğinden konuşma", "daha sık haber ver", "sabah brifingini sekizde ver", "sabah brifingini istemiyorum", "haberleri sorma", ' +
        '"brifingde e-postaları da söyle", "önemli gelişmede araya girme", "eskisi gibi konuş" derse kullan. Emin değilsen alanları doldurmak yerine kullanıcının sözünü AYNEN ' +
        '`say` alanına ver: değer kodla okunur. Örnek: "sabah brifingini sekiz buçukta ver" → say="sabah brifingini sekiz buçukta ver" ya da morning_time="08:30".',
      input: z.object({
        say: z.string().optional().describe('Kullanıcının sözü, aynen (öteki alanlar verilmediyse bundan okunur)'),
        talk: z.enum(TALK_LEVELS).optional().describe('silent: kendiliğinden hiç konuşma (yalnız kart) · low: yalnız sabah · normal: sabah + günde en çok 2 güncelleme · high: daha sık'),
        morning_enabled: z.boolean().optional(),
        morning_time: z
          .string()
          .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
          .optional()
          .describe('Sabah brifinginin saati, SS:DD (yerel)'),
        breaking: z.boolean().optional().describe('Önemli gelişmede araya gir'),
        news: z.boolean().optional().describe('Brifingde haberler'),
        mail: z.boolean().optional().describe('Brifingde e-postalar'),
        agenda: z.boolean().optional().describe('Brifingde takvim ve hatırlatıcılar'),
        tasks: z.boolean().optional().describe('Brifingde bekleyen işler'),
        news_count: z.number().int().min(1).max(10).optional(),
        max_per_hour: z.number().int().min(1).max(6).optional().describe('Kendiliğinden konuşmanın saatlik üst sınırı'),
        enabled: z.boolean().optional().describe('Brifingin tümü (false: ne ses ne kart)'),
        reset_learned: z.boolean().optional().describe('Kullanıcı ilgisizliğinden öğrenilen azalmayı sıfırla ("eskisi gibi konuş")'),
      }),
      risk: 'write',
      async run(input) {
        const current = engine().prefs();
        const patch: PrefsPatch = {};
        if (input.talk !== undefined) patch.talk = input.talk;
        if (input.enabled !== undefined) patch.enabled = input.enabled;
        if (input.breaking !== undefined) patch.breaking = input.breaking;
        if (input.news_count !== undefined) patch.newsCount = input.news_count;
        if (input.max_per_hour !== undefined) patch.maxPerHour = input.max_per_hour;
        if (input.morning_enabled !== undefined || input.morning_time !== undefined) {
          patch.morning = { ...(input.morning_enabled !== undefined ? { enabled: input.morning_enabled } : {}), ...(input.morning_time !== undefined ? { time: input.morning_time, enabled: input.morning_enabled ?? true } : {}) };
        }
        const scope = { news: input.news, mail: input.mail, agenda: input.agenda, tasks: input.tasks };
        const scopePatch = Object.fromEntries(Object.entries(scope).filter(([, value]) => value !== undefined)) as PrefsPatch['scope'];
        if (scopePatch && Object.keys(scopePatch).length) patch.scope = scopePatch;
        let reset = input.reset_learned === true;
        if (Object.keys(patch).length === 0 && !reset) {
          const spoken = input.say ? parseSpokenPrefs(input.say, current, new Date()) : null;
          if (!spoken) return { ok: false, text: t('briefing.tool.notUnderstood') };
          Object.assign(patch, spoken.patch);
          reset = spoken.resetAdaptive;
        }
        let state: BriefingState = engine().setPrefs(patch);
        if (reset) state = engine().resetAdaptive();
        return { ok: true, text: t('briefing.tool.set', { summary: describePrefs(state.prefs) }), data: { prefs: state.prefs } };
      },
    }),
    defineTool({
      name: 'briefing_status',
      group: 'briefing',
      description:
        'Kendiliğinden konuşma (brifing) ayarlarını ve o anki durumunu okur: konuşkanlık düzeyi, sabah brifinginin saati, kapsam, bugün kaç kez konuştuğun, şu an neden ' +
        'konuşamadığın, kullanıcının ilgisine göre öğrendiğin azalma. Kullanıcı "brifing ayarların ne", "neden kendiliğinden konuşmuyorsun", "sabah brifingi kaçta", ' +
        '"ne zaman haber vereceksin" derse kullan.',
      input: z.object({}),
      risk: 'read',
      async run() {
        const state = engine().state();
        const parts = [describePrefs(state.prefs), t('briefing.status.today', { count: state.spokenToday, limit: state.dailyLimit })];
        if (state.nextMorningAt) parts.push(t('briefing.status.nextMorning', { time: localTime(new Date(state.nextMorningAt)) }));
        if (!state.canSpeak.ok && state.canSpeak.reason) parts.push(t('briefing.status.cannot', { reason: state.canSpeak.reason }));
        if (state.adaptive.factor < 1 && state.adaptive.note) parts.push(state.adaptive.note);
        return { ok: true, text: parts.join(' '), data: { prefs: state.prefs, adaptive: state.adaptive, spokenToday: state.spokenToday } };
      },
    }),
  ];
}
