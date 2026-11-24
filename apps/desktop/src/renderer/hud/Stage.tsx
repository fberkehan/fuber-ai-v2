import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowSquareOut, CaretDown, LockSimple, X } from '@phosphor-icons/react';
import { t, type StageItem } from '@fuber/shared';
import { Button, IconButton, spring, useMotionPreset, useMotionTransition, type MotionPreset } from '@fuber/ui';
import { isEmpty, useEnvelope, useMeasure, ZERO } from './envelope';
import { MINI_APP_MAX_BYTES, MiniAppFrame, miniAppSize } from './MiniApp';
import { stageIcon } from './parts';
import { StageBlockView } from './StageBlocks';
import { quiet, useEvent, useReportSize } from './use-hud';

/** Aynı anda açık görünen en çok kart; fazlası "n kart daha" altında durur. */
const VISIBLE = 3;
const SETTLE_MS = 520;
const PAD = { left: 12, right: 12, top: 12, bottom: 16 } as const;
const CARD_WIDTH = 400;
const APP_CARD_MIN = 300;
/** `.stage-scroll` en büyük yüksekliği; aşılınca alt kenar söner (kaydırılabilir olduğu belli olsun). */
const SCROLL_MAX = 720;
/** Ana penceresinde sayfası olan modüller: kart "ana pencerede aç" düğmesi taşır. */
const PAGES = new Set(['planner', 'projects', 'memory', 'skills', 'today']);

const cardMotion: MotionPreset = {
  initial: { opacity: 0, transform: 'translateX(14px) scale(0.98)' },
  animate: { opacity: 1, transform: 'translateX(0px) scale(1)' },
  exit: { opacity: 0, transform: 'translateX(10px) scale(0.97)', transition: { type: 'spring', visualDuration: 0.2, bounce: 0 } },
  transition: spring.gentle,
};

/**
 * Sahne (sağ kenar): Jarvis'in gösterdiği kartlar ve kum havuzlu mini uygulamalar. En yeni kart üstte;
 * en çok üç kart açık. Başlık çubuğu pencereyi sürükler. Odak almadan açılır, içine tıklanınca odak alabilir.
 */
export function Stage() {
  const reportRef = useReportSize('stage');
  const [items, setItems] = useState<StageItem[]>([]);
  const [expanded, setExpanded] = useState(false);
  const preset = useMotionPreset(cardMotion);
  const layoutTransition = useMotionTransition(spring.gentle);

  useEffect(() => {
    void quiet(window.fuber.invoke('stage.items')).then((list) => {
      // Yanıt gelene kadar `stage.show` olayıyla eklenmiş öğeler ezilmez: liste birleştirilir.
      if (list) setItems((current) => [...list, ...current.filter((item) => !list.some((other) => other.id === item.id))]);
    });
  }, []);
  useEvent('stage.show', ({ item }) => setItems((list) => [...list.filter((other) => other.id !== item.id), item]));
  useEvent('stage.close', ({ id }) => setItems((list) => (id === null ? [] : list.filter((item) => item.id !== id))));

  const newestFirst = [...items].reverse();
  const visible = expanded ? newestFirst : newestFirst.slice(0, VISIBLE);
  const hidden = newestFirst.length - visible.length;
  useEffect(() => {
    if (items.length <= VISIBLE) setExpanded(false);
  }, [items.length]);

  const [stackRef, stack] = useMeasure<HTMLDivElement>();
  const natural = isEmpty(stack) ? ZERO : { width: stack.width + PAD.left + PAD.right, height: stack.height + PAD.top + PAD.bottom };
  const envelope = useEnvelope(natural, SETTLE_MS);

  const close = (id: string) => {
    // Kart hemen yaylanarak çıkar; sahne servisi de kapatır (olay yinelenirse zararsız).
    setItems((list) => list.filter((item) => item.id !== id));
    void quiet(window.fuber.invoke('stage.close', { id }));
  };

  return (
    <div
      ref={reportRef}
      className="hud-content"
      data-testid="hud-content"
      style={{ width: envelope.width, height: envelope.height }}
      // Sahne odak almadan açılır; içine tıklanınca odak alabilir hale gelir (KURGU §9).
      onMouseDown={() => void quiet(window.fuber.invoke('hud.focus', { surface: 'stage' }))}
    >
      <div className="stage-anchor">
        <div
          ref={stackRef}
          className="stage-scroll flex flex-col gap-2.5"
          data-count={items.length}
          data-overflow={stack.height >= SCROLL_MAX ? '' : undefined}
        >
          <AnimatePresence initial={false} mode="sync">
            {visible.map((item) => (
              <motion.div
                key={item.id}
                layout="position"
                initial={preset.initial}
                animate={preset.animate}
                exit={preset.exit}
                transition={{ ...preset.transition, layout: layoutTransition }}
                style={{ transformOrigin: '100% 50%' }}
              >
                <StageCardView item={item} onClose={() => close(item.id)} />
              </motion.div>
            ))}
            {hidden > 0 || expanded ? (
              <motion.div key="more" layout="position" className="flex justify-end" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <Button
                  size="sm"
                  variant="secondary"
                  className="rounded-full shadow-[var(--hud-shadow)]"
                  trailing={<CaretDown weight="bold" className={expanded ? 'rotate-180' : undefined} />}
                  onClick={() => setExpanded((value) => !value)}
                  data-testid="stage-more"
                >
                  {expanded ? t('hud.stage.less') : t('hud.stage.more', { n: hidden })}
                </Button>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function StageCardView({ item, onClose }: { item: StageItem; onClose(): void }) {
  const isApp = item.kind === 'app';
  const title = isApp ? item.app.title : item.card.title;
  const subtitle = isApp ? t('hud.stage.appSandboxed') : item.card.subtitle;
  const tooLarge = isApp && new Blob([item.app.html]).size > MINI_APP_MAX_BYTES;
  // Mini uygulama kartı çerçeveyi sarar (iki yanda 6 px); başlığa yer kalsın diye en az 300 px.
  const width = isApp ? Math.max(APP_CARD_MIN, miniAppSize(item.app).width + 12) : CARD_WIDTH;

  return (
    <section
      className="flex flex-col overflow-hidden rounded-lg bg-stage text-fg shadow-[var(--hud-shadow)]"
      style={{ width }}
      data-testid="stage-item"
      data-kind={item.kind}
      aria-label={title}
    >
      <header className="stage-drag flex items-center gap-3 py-3 pr-2.5 pl-4" title={t('hud.stage.dragHint')}>
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-4 text-fg [&_svg]:size-4" aria-hidden>
          {isApp ? <LockSimple weight="bold" /> : stageIcon(item.card.icon, 'card')}
        </span>
        <div className="flex min-w-0 grow flex-col">
          <h2 className="truncate text-base leading-[22px]" data-testid="stage-title">
            {title}
          </h2>
          {subtitle ? <p className="truncate text-xs text-fg-muted">{subtitle}</p> : null}
        </div>
        {!isApp && PAGES.has(item.moduleId) ? (
          <IconButton
            size="sm"
            icon={<ArrowSquareOut weight="bold" />}
            label={t('hud.stage.openMain')}
            tooltip={false}
            className="rounded-full"
            onClick={() => void quiet(window.fuber.invoke('app.openMain', { page: item.moduleId }))}
          />
        ) : null}
        <IconButton size="sm" icon={<X weight="bold" />} label={t('hud.stage.close')} tooltip={false} className="rounded-full" onClick={onClose} data-testid="stage-close" />
      </header>

      {isApp ? (
        tooLarge ? (
          <p className="px-4 pb-4 text-sm text-danger">{t('hud.stage.appTooLarge')}</p>
        ) : (
          <div className="flex justify-center border-t border-line bg-surface-1 p-1.5">
            <div className="overflow-hidden rounded-md">
              <MiniAppFrame app={item.app} title={title} />
            </div>
          </div>
        )
      ) : (
        <>
          {item.card.body.length > 0 ? (
            <div className="flex flex-col gap-3 px-4 pb-4">
              {item.card.body.map((block, index) => (
                <StageBlockView key={index} block={block} />
              ))}
            </div>
          ) : null}
          {item.card.actions?.length ? (
            <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
              {item.card.actions.map((action) => (
                <Button
                  key={action.id}
                  size="sm"
                  className="rounded-full"
                  variant={action.kind === 'primary' ? 'primary' : action.kind === 'danger' ? 'danger' : 'secondary'}
                  onClick={() => void quiet(window.fuber.invoke('stage.action', { itemId: item.id, actionId: action.id }))}
                >
                  {action.label}
                </Button>
              ))}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
