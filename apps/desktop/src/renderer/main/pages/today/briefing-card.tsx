// Bugün › Brifing kartı: brifing modülünün doldurucusundan gelen son brifing (`card.data` bir `Briefing`). Selam ve an,
// bölümler (gündem, son günler, işler, e-posta) ve haberler; kartın yüksekliğine sığan kadarı çizilir (yarım satır yok).
// Haber tıklanınca tarayıcıda açılır ve ilgi bildirilir (`briefing.feedback` › `engaged`). Ses düğmesi yoktur: "Sohbette
// sor" sözü yerleşik sohbete koyar, "Bugün yeter" kendiliğinden konuşmayı bugünlük durdurur (`declined`).
import { useState } from 'react';
import { ChatCircleText, HandPalm } from '@phosphor-icons/react';
import { localTime, relativeTime, t } from '@fuber/shared';
import { Button, cn, toast } from '@fuber/ui';
import type { Briefing, BriefingNewsItem } from '../../../../main/modules/briefing/types';
import { attempt } from '../../shell/live';
import { planBriefingCard } from '../settings/sections/briefing-logic';
import { inner, SPLIT_FROM } from './cards';
import { registerTodayCard, type TodayCardProps } from './registry';

/** Selam satırı (24) + aralık, neden satırı ve alt eylem satırı (kartın sabit parçaları, px). */
const HEAD_PX = 32;
const REASON_PX = 20;
const ACTIONS_PX = 44;
/** İçerik alanı bundan kısaysa alt eylemler çizilmez (önce içerik). */
const MIN_BODY_PX = 70;

function NewsList({ items, briefing, onEngage }: { items: BriefingNewsItem[]; briefing: Briefing; onEngage: () => void }) {
  if (items.length === 0) return null;
  return (
    <ul className="flex min-w-0 flex-col" data-testid="today-briefing-news" aria-label={t('briefingUi.card.news')}>
      {items.map((item) => (
        <li key={item.id} className="min-w-0">
          <button
            type="button"
            className="kokpit-row flex-col items-start gap-0.5"
            title={t('briefingUi.card.open')}
            onClick={() => {
              void attempt(() => window.fuber.invoke('app.openExternal', { url: item.url }));
              if (briefing.response === 'pending') onEngage();
            }}
            data-testid="today-briefing-news-item"
          >
            <span className="line-clamp-1 text-sm font-medium text-fg">{item.title}</span>
            <span className="flex max-w-full min-w-0 items-center gap-1.5 text-xs text-fg-faint">
              <span className="truncate">{item.source}</span>
              {item.reasons.slice(0, 2).map((reason) => (
                <span key={reason} className="shrink-0 rounded-full bg-surface-4 px-1.5 leading-[18px] text-fg-muted">
                  {reason}
                </span>
              ))}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function BriefingCard({ card, width, height, now, compose }: TodayCardProps<Briefing>) {
  const briefing = card.data;
  // Haberler ayrı listede (kaynak ve neden etiketiyle) çizilir; aynı başlıklar "Gündem" bölümünde ikinci kez gösterilmez.
  const shownSections = briefing.news.length > 0 ? briefing.sections.filter((section) => section.id !== 'news') : briefing.sections;
  const [declined, setDeclined] = useState(false);
  const split = width >= SPLIT_FROM && briefing.news.length > 0 && shownSections.some((section) => section.lines.length > 0);
  const reason = (briefing.delivered === 'deferred' || briefing.delivered === 'card') && briefing.reason ? briefing.reason : null;
  const body = inner(height) - HEAD_PX - (reason ? REASON_PX : 0);
  const showActions = body - ACTIONS_PX >= MIN_BODY_PX;
  const plan = planBriefingCard({
    height: body - (showActions ? ACTIONS_PX : 0),
    sectionLines: shownSections.map((section) => section.lines.length),
    news: briefing.news.length,
    split,
  });
  const sections = shownSections.map((section, index) => ({ section, count: plan.lines[index] ?? 0 })).filter((entry) => entry.count > 0);
  const news = briefing.news.slice(0, plan.news);
  const nothing = sections.length === 0 && news.length === 0;

  const feedback = (response: 'engaged' | 'declined') => attempt(() => window.fuber.invoke('briefing.feedback', { id: briefing.id, response }));
  const enough = async () => {
    if (await feedback('declined')) {
      setDeclined(true);
      toast.success(t('briefingUi.card.enoughDone'));
    }
  };

  const sectionList = sections.length > 0 && (
    <div className="flex min-w-0 flex-col gap-1">
      {sections.map(({ section, count }) => (
        <section key={section.id} className="flex min-w-0 flex-col" data-testid="today-briefing-section" data-id={section.id}>
          <h3 className="truncate pt-1 text-xs font-semibold text-fg-muted">{section.title}</h3>
          <ul className="flex min-w-0 flex-col">
            {section.lines.slice(0, count).map((line, index) => (
              <li key={index} className="flex min-w-0 items-baseline gap-2 text-sm leading-[22px] text-fg">
                <span className="size-1 shrink-0 translate-y-[-2px] rounded-full bg-fg-faint" aria-hidden />
                <span className="truncate" title={line}>
                  {line}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
  const newsList = <NewsList items={news} briefing={briefing} onEngage={() => void feedback('engaged')} />;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="today-briefing" data-kind={briefing.kind} data-delivered={briefing.delivered}>
      <div className="flex min-w-0 items-baseline justify-between gap-3 pb-2">
        <span className="truncate text-base font-medium text-fg" title={briefing.greeting}>
          {briefing.greeting}
        </span>
        <time className="shrink-0 text-xs text-fg-faint tabular-nums" dateTime={briefing.at} title={relativeTime(briefing.at, now)}>
          {t(`briefingUi.kind.${briefing.kind}`)}, {localTime(briefing.at)}
        </time>
      </div>
      {reason ? (
        <p className="truncate pb-1 text-xs text-fg-faint" data-testid="today-briefing-reason">
          {briefing.delivered === 'deferred' ? t('briefingUi.card.deferred', { reason }) : t('briefingUi.card.cardOnly', { reason })}
        </p>
      ) : null}

      <div className={cn('min-h-0 min-w-0 flex-1 overflow-hidden', split ? 'grid grid-cols-2 gap-6' : 'flex flex-col gap-2')}>
        {nothing ? <p className="text-sm text-fg-muted">{t('briefingUi.card.empty')}</p> : null}
        {sectionList}
        {newsList}
      </div>

      {showActions ? (
        <div className="flex min-w-0 items-center gap-2 pt-2">
          <Button size="sm" variant="secondary" icon={<ChatCircleText />} onClick={() => compose(t('briefingUi.card.askPrompt'))} data-testid="today-briefing-ask">
            {t('briefingUi.card.ask')}
          </Button>
          {briefing.response !== 'declined' && !declined ? (
            <Button size="sm" variant="ghost" icon={<HandPalm />} aria-label={t('briefingUi.card.enoughLabel')} onClick={() => void enough()} data-testid="today-briefing-enough">
              {t('briefingUi.card.enough')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

registerTodayCard<Briefing>('briefing', BriefingCard, { tone: 'base' });
