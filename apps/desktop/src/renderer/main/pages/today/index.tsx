// Bugün = Kokpit: açılış sayfası. Solda kutucuklu pano (tek birincil kutu: bugün bandı; altında içerik türüne göre
// çizilen kartlar), sağda yerleşik ana sohbet. Kartları ana süreçteki pano modülü doldurur (boş kart yoktur);
// kullanıcı sürükleyip sıralar, boyutlandırır, kaldırır; yapay zekâ araçla kart ekleyince pano canlı güncellenir.
//
// Panoda gösterecek hiçbir şey yokken (ilk açılış) sayfa bir karşılama ekranıdır: bant, örnek sözler ve hemen
// altlarında yazma kutusu, tek blokta ve ortada. Yandaki sohbet sütunu ancak gösterecek konuşma olunca açılır;
// o zamana kadar yazma kutusu panonun altındadır (boş kutu çizilmez).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowCounterClockwise, ArrowRight, Sun } from '@phosphor-icons/react';
import { orderDashboardCards, t, type DashboardCard, type DashboardSize, type DashboardSnapshot, type MessageKey } from '@fuber/shared';
import { Button, Skeleton, Workspace, cn, toast } from '@fuber/ui';
import { useShell } from '../../shell/context';
import { attempt } from '../../shell/live';
import { ErrorPanel } from '../../shell/parts';
import { definePage } from '../page';
import { SPLIT_FROM } from './cards';
import { ChatDock, type ChatDockHandle, type ChatDockState } from './chat-dock';
import { DashboardGrid } from './grid';
import { localTodayCards, registerTodayCard, todayCardEntry, useTodayCardRegistry, type TodayCardProps } from './registry';
import { useDashboard } from './use-dashboard';
import './band';
import './briefing-card';
import './custom-cards';
import './module-cards';
import './today.css';

export { registerTodayCard, type TodayCardOptions, type TodayCardProps, type TodayCardTone } from './registry';

/** Sohbet bu genişlikten (sayfa kabı, px) itibaren yanda durur; altında şerittir. `today.css` ile aynı eşik. */
const SIDE_FROM = 1040;
/** "Düzeni sıfırla" satırının ızgaranın altında tuttuğu yer (px). */
const RESET_ROW = 52;
/** Yapay zekânın eklediği kartın başlığında "Geri al" bu kadar süre durur. */
const UNDO_MS = 12_000;

const STARTERS = ['reminder', 'card', 'weather', 'project'] as const;
const STARTERS_ID = 'starters';

type StarterId = (typeof STARTERS)[number] | 'news';

/** Ne söylenebileceğine dair örnekler: dokununca söz yazma kutusuna yazılır. */
function StarterList({
  compose,
  roomy = false,
  columns = 1,
  swap,
  className,
}: {
  compose(text: string): void;
  roomy?: boolean;
  columns?: 1 | 2;
  swap?: Partial<Record<StarterId, StarterId>>;
  className?: string;
}) {
  return (
    <ul className={cn('min-w-0', columns === 2 ? 'grid grid-cols-2 gap-x-7' : 'flex flex-col', className)}>
      {STARTERS.map((base): StarterId => swap?.[base] ?? base).map((id) => {
        const prompt = t(`dashboard.starter.${id}.prompt` as MessageKey);
        return (
          <li key={id}>
            <button type="button" className="kokpit-row group items-start" onClick={() => compose(prompt)} data-testid="today-starter">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className={cn('line-clamp-2 text-fg', roomy ? 'text-lg' : 'text-base')}>“{prompt}”</span>
                <span className={cn('truncate text-fg-faint', roomy ? 'text-sm' : 'text-xs')}>{t(`dashboard.starter.${id}.title` as MessageKey)}</span>
              </span>
              <ArrowRight className="mt-1 size-4 shrink-0 text-fg-faint transition-[color,transform] duration-(--duration-fast) ease-out group-hover:translate-x-0.5 group-hover:text-fg" aria-hidden />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Kullanıcının kendi verisi yokken ama hava, döviz, haber gibi ortam kartları varken panonun ilk kartı ("Başlarken"):
 * tek cümle ve örnek sözler. Hava kartı zaten panodaysa "havayı sorun" örneğinin yerine haber örneği gelir.
 */
function StartersCard({ card, width, compose }: TodayCardProps<{ weather: boolean }>) {
  // Cümle üstte, örnekler altında; kart genişse örnekler iki sütuna dizilir (kart içeriği kadar yer tutar).
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3" data-testid="today-empty">
      <p className="max-w-[72ch] text-base text-fg">{t('dashboard.empty.cardBody')}</p>
      <StarterList
        compose={compose}
        {...(card.data.weather ? { swap: { weather: 'news' } } : {})}
        columns={width >= SPLIT_FROM - 80 ? 2 : 1}
        className="border-t border-line pt-1"
      />
    </div>
  );
}

// İlk günün birincil kartı: ortam kartları (hava, döviz, haber) onun yanında geri çekilir.
registerTodayCard(STARTERS_ID, StartersCard, { fixed: true, tone: 'focus' });

/** Bomboş ilk açılış: pano yerine karşılama. Örnek sözler yazma kutusunun hemen üstündedir. */
function Welcome({ compose }: { compose(text: string): void }) {
  const shell = useShell();
  return (
    <div className="kokpit-welcome" data-testid="today-empty">
      <div className="flex min-w-0 flex-col gap-2">
        <p className="text-2xl font-medium tracking-tight text-fg">{t('dashboard.empty.title')}</p>
        <p className="kokpit-welcome-body max-w-[46ch] text-base text-fg-muted">{t('dashboard.empty.body', { name: shell.name })}</p>
      </div>
      <StarterList compose={compose} roomy className="kokpit-welcome-list" />
    </div>
  );
}

function Loading() {
  return (
    <div className="flex flex-col gap-4" aria-busy aria-label={t('common.loading')}>
      <Skeleton className="h-28 w-full rounded-lg" />
      <div className="grid grid-cols-3 gap-4">
        <Skeleton className="col-span-2 h-80 rounded-md" />
        <Skeleton className="h-80 rounded-md" />
      </div>
    </div>
  );
}

/**
 * Arayüzün kendi kaydettiği (ana süreçte doldurucusu olmayan) kartları ve gerekiyorsa başlangıç kartını panoya
 * katar. `solo`: bant dışında çizilecek hiçbir kart yok (karşılama ekranı).
 */
function composeCards(snapshot: DashboardSnapshot): { cards: DashboardCard[]; solo: boolean } {
  const hidden = new Set(snapshot.layout.hidden);
  const known = new Set(snapshot.cards.map((card) => card.id));
  const base = { moduleId: 'dashboard', source: 'system' as const, band: false, page: null, updatedAt: null, stale: false, data: null };
  const locals = localTodayCards()
    .filter((entry) => !hidden.has(entry.options.local!.id) && !known.has(entry.options.local!.id))
    .map((entry): DashboardCard => {
      const local = entry.options.local!;
      return {
        ...base,
        id: local.id,
        kind: entry.kind,
        moduleId: local.moduleId ?? 'dashboard',
        title: local.title,
        size: snapshot.layout.sizes[local.id] ?? local.defaultSize,
        defaultSize: local.defaultSize,
        source: 'module',
        priority: local.priority,
        page: local.page ?? null,
      };
    });
  const cards = locals.length === 0 ? snapshot.cards : orderDashboardCards([...snapshot.cards, ...locals], snapshot.layout.order, (card) => card.priority);
  const drawn = cards.filter((card) => !card.band && todayCardEntry(card.kind) !== undefined);
  if (drawn.length === 0) return { cards, solo: true };
  // Kullanıcının kendi verisi yok, yalnız ortam kartları var: başlangıç kartı öne gelir.
  const personal = drawn.some((card) => todayCardEntry(card.kind)?.options.tone !== 'ambient');
  if (personal) return { cards, solo: false };
  const weather = drawn.some((card) => card.kind === 'weather');
  const starters: DashboardCard = { ...base, id: STARTERS_ID, kind: STARTERS_ID, title: t('dashboard.empty.card'), size: 'wide', defaultSize: 'wide', priority: 999, data: { weather } };
  return { cards: [...cards.filter((card) => card.band), starters, ...cards.filter((card) => !card.band)], solo: false };
}

function TodayPage() {
  const dash = useDashboard();
  const registry = useTodayCardRegistry();
  const dock = useRef<ChatDockHandle | null>(null);
  const workspace = useRef<HTMLDivElement | null>(null);
  const [side, setSide] = useState(true);
  // Yandaki sohbet sütunu gösterecek konuşma olunca açılır ve bu ziyaret boyunca açık kalır ("yeni sohbet" kapatmaz).
  const [chat, setChat] = useState<ChatDockState>('unknown');
  const [chatOpened, setChatOpened] = useState(false);
  useEffect(() => {
    if (chat === 'active') setChatOpened(true);
  }, [chat]);

  useEffect(() => {
    const element = workspace.current;
    if (!element) return;
    const update = () => setSide(element.clientWidth >= SIDE_FROM);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const snapshot = dash.snapshot;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const { cards, solo } = useMemo(() => (snapshot ? composeCards(snapshot) : { cards: [], solo: false }), [snapshot, registry]);
  const compose = useCallback((text: string) => dock.current?.compose(text), []);
  const apply = dash.apply;

  const reorder = useCallback(
    (ids: string[]) => {
      if (!snapshot) return;
      // Bırakılan sıra hemen uygulanır (kart geri sıçramasın), sonra kalıcı düzene yazılır.
      const byId = new Map(snapshot.cards.map((card) => [card.id, card]));
      const moved = ids.map((id) => byId.get(id)).filter((card): card is DashboardCard => card !== undefined);
      apply({ ...snapshot, cards: [...snapshot.cards.filter((card) => card.band), ...moved, ...snapshot.cards.filter((card) => !card.band && !ids.includes(card.id))] });
      void attempt(() => window.fuber.invoke('dashboard.reorder', { ids })).then((next) => next && apply(next));
    },
    [snapshot, apply],
  );
  const resize = useCallback(
    (card: DashboardCard, size: DashboardSize) => void attempt(() => window.fuber.invoke('dashboard.resize', { id: card.id, size })).then((next) => next && apply(next)),
    [apply],
  );
  const restore = useCallback((id: string) => void attempt(() => window.fuber.invoke('dashboard.restore', { id })).then((next) => next && apply(next)), [apply]);
  const remove = useCallback(
    (card: DashboardCard) =>
      void attempt(() => window.fuber.invoke('dashboard.remove', { id: card.id })).then((next) => {
        if (!next) return;
        apply(next);
        toast({ title: t('dashboard.removed', { title: card.title }), action: { label: t('common.undo'), onClick: () => restore(card.id) } });
      }),
    [apply, restore],
  );
  const reset = () =>
    void attempt(() => window.fuber.invoke('dashboard.reset')).then((next) => {
      if (!next) return;
      apply(next);
      toast.success(t('dashboard.resetDone'));
    });

  // Yapay zekânın az önce eklediği kart kısa bir süre kendi başlığından geri alınabilir.
  const [undoable, setUndoable] = useState<string | null>(null);
  useEffect(() => {
    if (!dash.arrived) return;
    setUndoable(dash.arrived);
    const id = window.setTimeout(() => setUndoable((current) => (current === dash.arrived ? null : current)), UNDO_MS);
    return () => window.clearTimeout(id);
  }, [dash.arrived]);
  const undo = useCallback(
    (card: DashboardCard) => {
      setUndoable(null);
      remove(card);
    },
    [remove],
  );

  const dockMode = side && !solo && (chatOpened || chat !== 'quiet') ? 'side' : 'bar';

  return (
    <Workspace ref={workspace} fill maxWidth={4096} data-testid="today-page">
      <div className="kokpit" data-solo={solo ? '' : undefined} data-dock={dockMode}>
        {/* Kaydırılan kap: kartların düzen animasyonu kaydırma konumunu hesaba katsın diye `layoutScroll`. */}
        <motion.div layoutScroll className="kokpit-main" data-testid="today-main">
          {snapshot ? (
            <>
              <DashboardGrid
                cards={cards}
                now={dash.now}
                arrived={dash.arrived}
                // Yalnız yapay zekânın eklediği özel kart geri alınır (öneri eklemek yerleşik kartı "eklenmiş" saydırmaz).
                undoable={cards.some((card) => card.id === undoable && card.source === 'ai') ? undoable : null}
                reserve={snapshot.customized ? RESET_ROW : 0}
                compose={compose}
                onReorder={reorder}
                onResize={resize}
                onRemove={remove}
                onUndo={undo}
              />
              {snapshot.customized && (
                <div className="flex justify-end pt-3">
                  <Button size="sm" variant="ghost" icon={<ArrowCounterClockwise />} onClick={reset} data-testid="dash-reset">
                    {t('dashboard.reset')}
                  </Button>
                </div>
              )}
            </>
          ) : dash.error ? (
            <ErrorPanel title={t('dashboard.error.title')} message={dash.error} onRetry={dash.reload} />
          ) : (
            <Loading />
          )}
        </motion.div>
        <div className="kokpit-dock">
          {/* Anahtarlar sabit: karşılama gelip gidince sohbet yeniden kurulmaz (yazılan söz ve oturum yerinde kalır). */}
          {solo && <Welcome key="welcome" compose={compose} />}
          <ChatDock key="chat" ref={dock} mode={dockMode} onState={setChat} />
        </div>
      </div>
    </Workspace>
  );
}

export default definePage({
  id: 'today',
  titleKey: 'nav.today',
  icon: Sun,
  order: 10,
  Component: TodayPage,
});
