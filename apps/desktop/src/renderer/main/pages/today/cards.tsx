// Kokpit'in yerleşik kartları. Her kart içeriğinin türüne göre çizilir: sıradaki iş öne çıkan zaman çizgisi, onay
// kutulu liste, kalan günü yazan son günler, ilerleme çubuklu iş, sıcaklık, kur, başlık listesi.
//
// Üç kademe: "Sırada" sayfanın odak kartıdır (sıradaki iş büyük yazıyla); işe dönük listeler olağan karttır; hava,
// döviz, haber, oturumlar ve son olanlar ortam bilgisidir (geri çekilir, rakamları küçüktür). Kartın gösterdiği
// satır sayısı o anki yüksekliğinden (`height`), sütun sayısı genişliğinden (`width`) çıkar; sığmayanlar "N tane
// daha" ile ilgili sayfaya bağlanır.
import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CheckCircle,
  Circle,
  Cloud,
  CloudFog,
  CloudLightning,
  CloudMoon,
  CloudRain,
  CloudSnow,
  CloudSun,
  Info,
  Moon,
  Sun,
  WarningCircle,
  X,
  type Icon,
} from '@phosphor-icons/react';
import {
  daysBetween,
  formatDay,
  localDay,
  localTime,
  relativeDay,
  relativeTime,
  t,
  type ActivityData,
  type AgendaData,
  type AgendaItem,
  type DashboardCard,
  type FxData,
  type JobsData,
  type LocalDay,
  type NewsData,
  type NoticesData,
  type Reminder,
  type SessionsData,
  type SuggestionsData,
  type TodosData,
  type UsageData,
  type WeatherData,
} from '@fuber/shared';
import { Badge, Button, Checkbox, IconButton, ProgressBar, cn, durations, easings, useReducedMotion } from '@fuber/ui';
import { useShell } from '../../shell/context';
import { attempt } from '../../shell/live';
import { capitalize, formatUsd } from '../../shell/text';
import { completeReminder, setTodoDone, snoozeReminder } from '../planner/actions';
import { registerTodayCard, type TodayCardProps } from './registry';

let measurer: CanvasRenderingContext2D | null | undefined;
/** Metnin gövde yazısıyla (15 px) tek satırdaki genişliği (px, ölçeksiz). "Sığar mı, sarar mı" kararı için. */
function textWidth(text: string): number {
  if (measurer === undefined) measurer = document.createElement('canvas').getContext('2d');
  if (!measurer) return text.length * 6.4;
  measurer.font = `15px ${getComputedStyle(document.body).fontFamily}`;
  return measurer.measureText(text).width;
}

/** Kartın üst-alt boşluğu ve başlık satırı (today.css `.kokpit-card`, `.kokpit-card-head`). */
const CHROME = 70;
/** Kartın içeriğine kalan yükseklik (px). */
export const inner = (height: number): number => height - CHROME;
/** `rowPx` yüksekliğinde kaç satır sığar (`reserve`: alt not ya da bağlantı için ayrılan yer). */
export const fitRows = (height: number, rowPx: number, reserve = 0): number => Math.max(1, Math.floor((inner(height) - reserve) / rowPx));
/** Kart bu genişlikten (px) itibaren içeriğini iki sütuna böler. */
export const SPLIT_FROM = 600;

const number = (value: number, digits = 2) => value.toLocaleString('tr-TR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export function More({ count, onOpen }: { count: number; onOpen?: () => void }) {
  if (count <= 0) return null;
  const label = t('dashboard.more', { count });
  return onOpen ? (
    <button type="button" onClick={onOpen} className="group mt-auto flex cursor-pointer items-center gap-1 self-start rounded-xs pt-2 text-sm text-fg-muted transition-colors duration-(--duration-fast) hover:text-fg">
      {label}
      <ArrowRight className="size-3.5 transition-transform duration-(--duration-fast) ease-out group-hover:translate-x-0.5" aria-hidden />
    </button>
  ) : (
    <p className="mt-auto pt-2 text-sm text-fg-faint">{label}</p>
  );
}

// ───────────── sırada (hatırlatıcılar): sayfanın odak kartı ─────────────

function groupLabel(item: AgendaItem, today: LocalDay): string {
  if (item.overdue) return t('today.timeline.overdue');
  const day = localDay(item.reminder.dueAt);
  const diff = daysBetween(today, day);
  if (diff === 0) return t('today.timeline.today');
  if (diff === 1) return t('today.timeline.tomorrow');
  return t('today.timeline.day', { day: capitalize(relativeDay(day)), date: formatDay(day) });
}

/** "Tamamlandı" halkası: boşken halka, üstüne gelince ve tamamlanınca dolu işaret. */
function Complete({ reminder, done, onDone }: { reminder: Reminder; done: boolean; onDone: () => void }) {
  return (
    <button
      type="button"
      className="kokpit-check"
      aria-label={`${t('today.timeline.complete')}: ${reminder.text}`}
      title={t('today.timeline.complete')}
      disabled={done}
      data-done={done ? '' : undefined}
      onClick={onDone}
      data-testid="timeline-complete"
    >
      <Circle aria-hidden />
      <CheckCircle weight="fill" aria-hidden />
    </button>
  );
}

function AgendaCard({ card, width, height, now }: TodayCardProps<AgendaData>) {
  const shell = useShell();
  const reduce = useReducedMotion();
  const today = localDay(now);
  // Tamamlanan satır önce işaretlenir ve solar, sonra yüksekliğini bırakır ("Geri al" için kısa bir an).
  const [completing, setCompleting] = useState<ReadonlySet<string>>(() => new Set());
  const complete = (reminder: Reminder) => {
    setCompleting((current) => new Set(current).add(reminder.id));
    window.setTimeout(
      () =>
        void completeReminder(reminder).then((ok) => {
          if (!ok) setCompleting((current) => new Set([...current].filter((id) => id !== reminder.id)));
        }),
      reduce ? 0 : 320,
    );
  };

  const [lead, ...rest] = card.data.items;
  if (!lead) return null;
  const split = width >= SPLIT_FROM;
  // Sıradaki iş sayfanın en büyük yazısıyla; kalanlar sakin satırlar. Geniş kartta ikisi yan yana durur.
  // Başlık bir satıra sığıyorsa altındaki listeye bir satır daha yer kalır.
  const titleWidth = (textWidth(lead.reminder.text) * (split ? 32 : 24)) / 15;
  const LEAD = titleWidth > (split ? width * 0.42 : width) - 36 - 44 ? 106 : 76;
  let budget = inner(height) - (split ? 0 : LEAD + 13) - (card.data.total > card.data.items.length ? 28 : 0);
  const groups: Array<{ label: string; overdue: boolean; items: AgendaItem[] }> = [];
  let shown = 1;
  for (const item of rest) {
    const label = groupLabel(item, today);
    const last = groups[groups.length - 1];
    const cost = 44 + (last?.label === label ? 0 : 24);
    if (budget < cost) break;
    budget -= cost;
    shown += 1;
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, overdue: item.overdue, items: [item] });
  }
  // Yan yana düzen yalnız sağda gösterilecek başka iş varken: tek iş kartın bütün genişliğini kullanır. (18 Kas 2026:
  // tek hatırlatmada başlık kartın %42'sine sıkışıp üç satırda kesiliyor, kalan %58 boş duruyordu.)
  const hasRest = groups.length > 0 || card.data.total > shown;
  const side = split && hasRest;
  const leadDone = completing.has(lead.reminder.id);
  const leadDay = localDay(lead.reminder.dueAt);

  return (
    <div className={cn('flex min-h-0 flex-1', side ? 'flex-row gap-7' : 'flex-col')} data-testid="timeline" data-side={side ? '' : undefined}>
      <ol className={cn('flex flex-col', side ? 'w-[42%] shrink-0' : split && 'min-h-0 flex-1')}>
        <AnimatePresence initial={false}>
          <motion.li
            key={lead.reminder.id}
            exit={reduce ? { opacity: 0 } : { opacity: 0, transition: { duration: durations.fast, ease: easings.out } }}
            className={cn('flex gap-3 py-1 transition-opacity duration-(--duration-base)', split ? 'flex-1 items-stretch' : 'items-start', leadDone && 'opacity-45')}
            data-testid="timeline-item"
            data-kind="reminder"
            data-lead=""
          >
            <div className="flex min-w-0 flex-1 flex-col">
              <span className={cn('font-medium tracking-tight text-fg', side ? 'line-clamp-3 text-3xl' : split ? 'line-clamp-2 text-3xl' : 'line-clamp-2 text-2xl', leadDone && 'line-through decoration-fg-faint')}>{lead.reminder.text}</span>
              <span className={cn('flex items-baseline text-base text-fg-muted', split ? 'mt-3 gap-3' : 'mt-2 gap-2.5')}>
                <time className={cn('kokpit-figure', split ? 'text-4xl' : 'text-xl')}>{localTime(lead.reminder.dueAt)}</time>
                <span className={cn('truncate', lead.overdue ? 'text-danger' : 'text-accent-fg')} data-testid="timeline-next">
                  {[
                    lead.overdue
                      ? `${t('today.todos.late')}, ${relativeTime(lead.reminder.dueAt, now)}`
                      : leadDay === today
                        ? relativeTime(lead.reminder.dueAt, now)
                        : capitalize(relativeDay(leadDay)),
                    lead.repeats,
                  ]
                    .filter(Boolean)
                    .join(', ')}
                </span>
              </span>
              {/* Geniş kartta sıradaki işin eylemleri kendi bölmesinin altında durur: bitir ya da ertele. */}
              {split && (
                <span className="mt-auto flex flex-wrap items-center gap-2 pt-4">
                  <Button size="sm" variant="secondary" icon={<CheckCircle />} disabled={leadDone} onClick={() => complete(lead.reminder)} data-testid="timeline-complete">
                    {t('today.timeline.complete')}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={leadDone} onClick={() => void snoozeReminder(lead.reminder, 'hour')} data-testid="timeline-snooze">
                    {t('dashboard.agenda.snoozeHour')}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={leadDone} onClick={() => void snoozeReminder(lead.reminder, 'tomorrow')}>
                    {t('dashboard.agenda.snoozeTomorrow')}
                  </Button>
                </span>
              )}
            </div>
            {!split && (
              <span className="shrink-0 self-start">
                <Complete reminder={lead.reminder} done={leadDone} onDone={() => complete(lead.reminder)} />
              </span>
            )}
          </motion.li>
        </AnimatePresence>
      </ol>

      {hasRest && (
        <div className={cn('flex min-w-0 flex-1 flex-col', side ? 'border-l border-line pl-6' : 'mt-2 border-t border-line pt-1')}>
          {groups.map((group) => (
            <div key={group.label} className="flex flex-col">
              <h3 className={cn('pt-2 pb-0.5 text-xs font-medium tracking-normal', group.overdue ? 'text-danger' : 'text-fg-faint')}>{group.label}</h3>
              <ol className="flex flex-col">
                <AnimatePresence initial={false}>
                  {group.items.map(({ reminder, overdue, repeats }) => {
                    const done = completing.has(reminder.id);
                    const dueDay = localDay(reminder.dueAt);
                    const sub = [repeats, overdue && dueDay !== today ? formatDay(dueDay) : null].filter(Boolean).join(', ');
                    return (
                      <motion.li
                        key={reminder.id}
                        // Düzen animasyonu yok: çıkan satır yüksekliğini bırakır, alttakiler onunla birlikte kayar. (Düzen
                        // animasyonu pencere boyutlanınca satırları kartın dışına uçururdu.)
                        exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0, transition: { duration: durations.fast, ease: easings.out } }}
                        className="overflow-hidden"
                        data-testid="timeline-item"
                        data-kind="reminder"
                      >
                        <div className="kokpit-row py-0.5" data-hover>
                          <time className={cn('w-11 shrink-0 text-sm font-semibold tabular-nums', overdue ? 'text-danger' : 'text-fg')}>{localTime(reminder.dueAt)}</time>
                          <span className={cn('flex min-w-0 flex-1 items-baseline gap-2 transition-opacity duration-(--duration-base)', done && 'opacity-45')}>
                            <span className={cn('truncate text-base text-fg', done && 'line-through decoration-fg-faint')}>{reminder.text}</span>
                            {sub ? <span className="shrink-0 text-xs text-fg-faint">{sub}</span> : null}
                          </span>
                          <Complete reminder={reminder} done={done} onDone={() => complete(reminder)} />
                        </div>
                      </motion.li>
                    );
                  })}
                </AnimatePresence>
              </ol>
            </div>
          ))}
          <More count={card.data.total - shown} onOpen={() => shell.navigate('planner')} />
        </div>
      )}
    </div>
  );
}

// ───────────── yapılacaklar ─────────────

function TodosCard({ card, width, height, now }: TodayCardProps<TodosData>) {
  const shell = useShell();
  const reduce = useReducedMotion();
  const today = localDay(now);
  const split = width >= SPLIT_FROM;
  // Uzun madde kesilmez, iki satıra sarar; kaç maddenin sığacağı satır sayısına göre hesaplanır.
  // Madde yazısına kalan genişlik: kartın iç boşluğu, onay kutusu ve aralığı düşülür.
  const line = (split ? (width - 28) / 2 : width) - 36 - 32;
  const cost = (item: TodosData['items'][number]) => 44 + (textWidth(item.todo.text) > line ? 22 : 0);
  const fit = (reserve: number) => {
    const columns = split ? 2 : 1;
    const room = inner(height) - reserve;
    let used = 0;
    let count = 0;
    for (const item of card.data.items) {
      // İki sütunda maddeler satır satır dizilir: satırın yüksekliği iki maddenin uzununa eşittir.
      const rowStart = count % columns === 0;
      const add = rowStart ? cost(item) : Math.max(0, cost(item) - cost(card.data.items[count - 1]!));
      // Birkaç piksellik taşma kartı fark edilmeden uzatır; bir maddeyi "N tane daha"ya atmaya değmez.
      if (used + add > room + 12 && count > 0) break;
      used += add;
      count += 1;
    }
    return count;
  };
  const limit = fit(card.data.total > fit(0) ? 28 : 0);
  const items = card.data.items.slice(0, limit);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ul className="kokpit-list" data-split={split ? '' : undefined} data-testid="today-todos">
        <AnimatePresence initial={false}>
          {items.map(({ todo, late }) => (
            <motion.li
              key={todo.id}
              // Tamamlanan madde sönerek ve yüksekliğini bırakarak çıkar; alttakiler onunla birlikte yerine kayar.
              exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0, transition: { duration: durations.fast, ease: easings.out } }}
              className="overflow-hidden"
              data-testid="today-todo"
            >
              <div className="kokpit-row py-0.5" data-hover>
                <Checkbox checked={false} onCheckedChange={() => void setTodoDone(todo, true)} aria-label={t('today.todos.complete', { text: todo.text })} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="line-clamp-2 text-base text-fg" title={todo.text}>
                    {todo.text}
                  </span>
                  {todo.dueDay && (
                    <span className={cn('truncate text-xs', late ? 'text-danger' : todo.dueDay === today ? 'text-warning' : 'text-fg-faint')}>
                      {late ? `${t('today.todos.late')}, ${formatDay(todo.dueDay)}` : capitalize(relativeDay(todo.dueDay))}
                    </span>
                  )}
                </span>
              </div>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      <More count={card.data.total - items.length} onOpen={() => shell.navigate('planner')} />
    </div>
  );
}

// ───────────── süren işler ─────────────

/** Bir dakikadan kısa süre için `null`: "bitmek üzere", "az önce başladı" denir. */
function duration(ms: number): string | null {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return null;
  if (minutes < 60) return t('dashboard.jobs.minutes', { count: minutes });
  return t('dashboard.jobs.hours', { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}

function JobsCard({ card, height, now }: TodayCardProps<JobsData>) {
  const shell = useShell();
  const live = new Map(shell.live.jobs.map((job) => [job.id, job]));
  // Her iş aynı kalıpla: ad, ilerleme çubuğu ve yüzde, altta adım (yoksa kalan süre) ve Durdur. Ferah kartta adım
  // ve kalan süre ayrı satırlardadır.
  const roomy = inner(height) >= 150 && card.data.items.length === 1;
  // Arka plan işi (ilerleme + Durdur) ~100 px, katkı satırı (takip işi: ad + tek satır durum) ~60 px yer tutar; sığan
  // kadarı çizilir, kalanı "N tane daha" olur. En az bir satır her zaman çizilir.
  let room = inner(height) - (card.data.items.length > 1 ? 28 : 0);
  let full = false;
  const items = card.data.items.filter((item, index) => {
    const cost = item.page ? 60 : 100;
    if (full || (index > 0 && cost > room)) {
      full = true;
      return false;
    }
    room -= cost;
    return true;
  });
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ul className="flex flex-col gap-4 pt-1" data-testid="today-running">
        {items.map((item) => {
          // Başka modülün katkısı (takip işi): ilerleme ve Durdur yok; satır ilgili sayfayı açar.
          if (item.page) {
            const page = item.page;
            return (
              <li key={item.id} className="flex flex-col" data-testid="job-item" data-kind={item.moduleId}>
                <button
                  type="button"
                  className="kokpit-row flex-col items-start gap-0.5"
                  data-hover
                  aria-label={t('today.jobs.openWatch', { title: item.title })}
                  onClick={() => shell.navigate(page)}
                  data-testid={item.moduleId === 'watch' ? 'today-watch-item' : undefined}
                >
                  <span className="flex max-w-full min-w-0 items-baseline gap-2">
                    <span className="truncate text-base font-medium text-fg" title={item.title}>
                      {item.title}
                    </span>
                    {item.tag ? <span className="shrink-0 font-mono text-xs text-fg-faint">{item.tag}</span> : null}
                    {item.status === 'paused' ? (
                      <Badge tone="warning" size="sm">
                        {t('today.jobs.paused')}
                      </Badge>
                    ) : null}
                  </span>
                  {item.detail ? <span className="line-clamp-2 text-left text-xs text-fg-faint">{item.detail}</span> : null}
                </button>
              </li>
            );
          }
          const job = live.get(item.id);
          const progress = job?.progress ?? null;
          const step = job?.step || null;
          const elapsed = now.getTime() - Date.parse(item.startedAt);
          // Kalan süre, ilerleme hızından kestirilir; ilerleme bildirmeyen işte ne zaman başladığı yazar.
          const estimating = progress !== null && progress > 0.05 && progress < 1 && elapsed > 5_000;
          const time = duration(estimating ? (elapsed * (1 - progress)) / progress : Math.max(0, elapsed));
          const meta =
            item.status === 'queued'
              ? t('dashboard.jobs.queued')
              : estimating
                ? time
                  ? t('dashboard.jobs.remaining', { time })
                  : t('dashboard.jobs.almost')
                : time
                  ? t('dashboard.jobs.elapsed', { time })
                  : t('dashboard.jobs.justStarted');
          return (
            <li key={item.id} className={cn('flex flex-col', roomy ? 'gap-2.5' : 'gap-1.5')} data-testid="job-item">
              <div className="flex min-w-0 flex-col">
                <span className={cn('text-base font-medium text-fg', roomy ? 'line-clamp-2' : 'truncate')} title={item.title}>
                  {item.title}
                </span>
                {roomy && step ? <span className="truncate text-sm text-fg-muted">{step}</span> : null}
              </div>
              {progress !== null && (
                <div className="flex items-center gap-3">
                  <ProgressBar value={progress} tone="accent" size="sm" aria-label={item.title} className="flex-1" />
                  <span className="shrink-0 text-right text-sm font-medium text-fg tabular-nums">%{Math.round(progress * 100)}</span>
                </div>
              )}
              <div className="flex items-center justify-between gap-3">
                <span className="line-clamp-2 min-w-0 text-xs text-fg-faint" title={meta}>
                  {roomy ? meta : (step ?? meta)}
                </span>
                <Button size="sm" variant="secondary" aria-label={t('dashboard.jobs.stopLabel', { title: item.title })} onClick={() => void attempt(() => window.fuber.invoke('jobs.cancel', { id: item.id }))} data-testid="job-stop">
                  {t('dashboard.jobs.stop')}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      <More count={card.data.items.length - items.length} />
    </div>
  );
}

// ───────────── bildirimler ─────────────

function NoticesCard({ card, height }: TodayCardProps<NoticesData>) {
  const items = card.data.items.slice(0, Math.max(1, Math.floor(inner(height) / 92)));
  return (
    <ul className="flex min-h-0 flex-1 flex-col gap-3">
      {items.map((notification) => {
        const actions = [...notification.actions].sort((a, b) => Number(b.kind === 'primary') - Number(a.kind === 'primary'));
        return (
          <li key={notification.id} className="flex flex-col gap-2" data-testid="pending-notification">
            <div className="flex items-start gap-2">
              <div className="flex min-w-0 flex-1 flex-col">
                <p className="text-base font-medium text-fg">{notification.title}</p>
                {notification.body && <p className="line-clamp-2 text-sm whitespace-pre-line text-fg-muted">{notification.body}</p>}
              </div>
              <IconButton icon={<X weight="bold" />} label={t('today.pending.dismiss')} size="sm" className="-mt-1 -mr-1.5" onClick={() => void attempt(() => window.fuber.invoke('attention.dismiss', { id: notification.id }))} />
            </div>
            {actions.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {actions.map((action, index) => (
                  <Button
                    key={action.id}
                    size="sm"
                    variant={action.kind === 'danger' ? 'danger' : index === 0 ? 'primary' : 'secondary'}
                    onClick={() => void attempt(() => window.fuber.invoke('attention.act', { id: notification.id, actionId: action.id }))}
                  >
                    {action.label}
                  </Button>
                ))}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ───────────── hava (ortam) ─────────────

/** WMO hava kodundan simge; gece açık ve az bulutlu havada ay. */
export function weatherIcon(code: number | null, night: boolean): Icon {
  if (code === null) return Cloud;
  if (code === 0) return night ? Moon : Sun;
  if (code <= 2) return night ? CloudMoon : CloudSun;
  if (code === 3) return Cloud;
  if (code === 45 || code === 48) return CloudFog;
  if (code >= 95) return CloudLightning;
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return CloudSnow;
  if (code >= 51) return CloudRain;
  return Cloud;
}

const degrees = (value: number | null) => (value === null ? '' : `${value}°`);

function WeatherCard({ card, width, height, now }: TodayCardProps<WeatherData>) {
  const data = card.data;
  const hour = now.getHours();
  const NowIcon = weatherIcon(data.code, hour >= 20 || hour < 6);
  // Önümüzdeki günler: kart genişse yanında, yüksekse altında; ikisi de değilse yalnız bugün.
  const beside = width >= 330;
  const below = !beside && inner(height) >= 170;
  // Bugün zaten solda yazar: tahmin yarından başlar.
  const ahead = data.days.filter((day) => day.date !== localDay(now));
  const days = beside ? ahead.slice(0, width >= 460 ? 4 : 3) : below ? ahead.slice(0, 3) : [];
  return (
    <div className={cn('flex min-h-0 flex-1 gap-x-5 gap-y-3 pt-1', beside ? 'flex-row items-start' : 'flex-col')} data-testid="today-weather">
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex items-center gap-2.5">
          <span className="kokpit-figure text-2xl" data-testid="weather-temperature">
            {degrees(data.temperature)}
          </span>
          <NowIcon className="size-6 shrink-0 text-fg-muted" weight="light" aria-hidden />
        </div>
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium text-fg">{capitalize(data.summary)}</span>
          {data.max !== null && data.min !== null && <span className="truncate text-xs text-fg-faint">{t('dashboard.weather.range', { max: data.max, min: data.min })}</span>}
        </div>
      </div>
      {days.length > 0 && (
        <ul className={cn('grid min-w-0 flex-1 gap-1', beside ? 'border-l border-line pl-4' : 'mt-auto border-t border-line pt-3')} style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
          {days.map((day) => {
            const DayIcon = weatherIcon(day.code, false);
            return (
              <li key={day.date} className="flex min-w-0 flex-col items-center gap-1" title={capitalize(day.summary)}>
                <span className="text-xs text-fg-faint">{day.weekday.slice(0, 3)}</span>
                <DayIcon className="size-5 text-fg-muted" weight="light" aria-hidden />
                <span className="text-sm font-medium text-fg tabular-nums">{degrees(day.max)}</span>
                <span className="text-xs text-fg-faint tabular-nums">{degrees(day.min)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ───────────── döviz (ortam) ─────────────

function FxCard({ card, width, height }: TodayCardProps<FxData>) {
  const data = card.data;
  const rates = data.rates.slice(0, Math.max(2, Math.min(3, Math.floor((inner(height) - 22) / 34))));
  // Alış ve satış yalnız geniş kartta yazar; dar kartta rakam tek başına okunur.
  const spread = width >= 330;
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="today-fx">
      <ul className="flex flex-1 flex-col gap-1.5 pt-1">
        {rates.map((rate) => {
          const moved = rate.change !== null && Math.abs(rate.change) >= 0.00005;
          const Trend = rate.change !== null && rate.change < 0 ? ArrowDown : ArrowUp;
          return (
            <li key={rate.code} className="flex items-baseline gap-3" data-testid="fx-rate">
              <span className="w-9 shrink-0 text-sm font-medium text-fg-muted" title={rate.name}>
                {rate.code}
              </span>
              <span className="kokpit-figure text-lg">{number(rate.rate)}</span>
              {moved && (
                <span className="flex shrink-0 items-center gap-0.5 text-xs text-fg-muted tabular-nums" title={t(rate.change! < 0 ? 'dashboard.fx.down' : 'dashboard.fx.up', { value: `%${number(Math.abs(rate.change!) * 100)}` })}>
                  <Trend className="size-3" weight="bold" aria-hidden />%{number(Math.abs(rate.change!) * 100)}
                </span>
              )}
              {spread && rate.buying !== null && rate.selling !== null && (
                <span className="ml-auto truncate text-xs text-fg-faint">{t('dashboard.fx.spread', { buying: number(rate.buying), selling: number(rate.selling) })}</span>
              )}
            </li>
          );
        })}
      </ul>
      <p className="truncate pt-1.5 text-xs text-fg-faint">{t('dashboard.fx.source', { source: data.source, date: formatDay(data.date as LocalDay) })}</p>
    </div>
  );
}

// ───────────── haberler (ortam) ─────────────

function NewsCard({ card, width, height, now }: TodayCardProps<NewsData>) {
  // Geniş kartta başlıklar iki, çok geniş kartta üç sütuna dizilir.
  const columns = width >= 900 ? 3 : width >= 460 ? 2 : 1;
  // Son satır yarım kalmasın: başlık sayısı sütun sayısının katına indirilir.
  const fit = Math.min(card.data.items.length, fitRows(height, 62) * columns);
  const items = card.data.items.slice(0, fit > columns ? fit - (fit % columns) : fit);
  return (
    <ul className="kokpit-list min-h-0 flex-1" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }} data-testid="today-news">
      {items.map((item) => (
        <li key={item.url} className="min-w-0">
          <button
            type="button"
            className="kokpit-row flex-col items-start gap-0.5"
            title={t('dashboard.news.open')}
            onClick={() => void attempt(() => window.fuber.invoke('app.openExternal', { url: item.url }))}
            data-testid="news-item"
          >
            <span className="line-clamp-2 text-sm font-medium text-fg">{item.title}</span>
            <span className="truncate text-xs text-fg-faint">{[item.source, item.at ? relativeTime(item.at, now) : null].filter(Boolean).join(', ')}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

// ───────────── Claude Code oturumları (ortam) ─────────────

function SessionsCard({ card, width, height, now }: TodayCardProps<SessionsData>) {
  const shell = useShell();
  const split = width >= SPLIT_FROM;
  const capacity = (reserve: number) => fitRows(height, 48, reserve) * (split ? 2 : 1);
  const items = card.data.items.slice(0, capacity(card.data.total > capacity(0) ? 28 : 0));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ul className="kokpit-list" data-split={split ? '' : undefined} data-testid="today-sessions">
        {items.map((session) => (
          <li key={session.id} className="min-w-0">
            <button type="button" className="kokpit-row" onClick={() => shell.navigate('projects')} data-testid="session-item">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium text-fg">{capitalize(session.title)}</span>
                <span className="truncate text-xs text-fg-faint">{[session.project, relativeTime(session.lastAt, now)].filter(Boolean).join(', ')}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <More count={card.data.total - items.length} onOpen={() => shell.navigate('projects')} />
    </div>
  );
}

// ───────────── son olanlar (ortam) ─────────────

const ACTIVITY_ICON: Record<ActivityData['items'][number]['tone'], { icon: Icon; className: string }> = {
  done: { icon: CheckCircle, className: 'text-success' },
  failed: { icon: WarningCircle, className: 'text-danger' },
  info: { icon: Info, className: 'text-fg-faint' },
};

function ActivityCard({ card, width, height, now }: TodayCardProps<ActivityData>) {
  const shell = useShell();
  const split = width >= SPLIT_FROM;
  const items = card.data.items.slice(0, fitRows(height, 52) * (split ? 2 : 1));
  return (
    <ul className="kokpit-list min-h-0 flex-1" data-split={split ? '' : undefined} data-testid="today-activity">
      {items.map((item) => {
        const { icon: ToneIcon, className } = ACTIVITY_ICON[item.tone];
        return (
          <li key={item.id} className="min-w-0">
            <button type="button" className="kokpit-row items-start" onClick={() => shell.navigate(item.page)}>
              <ToneIcon className={cn('mt-0.5 size-4 shrink-0', className)} weight="fill" aria-hidden />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium text-fg">{item.text}</span>
                <span className="truncate text-xs text-fg-faint">{[relativeTime(item.at, now), item.detail].filter(Boolean).join(', ')}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// ───────────── kullanım ─────────────

function UsageCard({ card }: TodayCardProps<UsageData>) {
  const usage = card.data;
  const ratio = usage.budgetUsd > 0 ? Math.min(1, usage.costUsd / usage.budgetUsd) : 0;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 pt-1" data-testid="today-usage">
      <div className="flex items-baseline justify-between gap-3">
        <span className="kokpit-figure text-2xl">{formatUsd(usage.costUsd)}</span>
        <span className="truncate text-sm text-fg-muted">{t('today.usage.budget', { budget: formatUsd(usage.budgetUsd) })}</span>
      </div>
      <div className="flex flex-col gap-2">
        <ProgressBar value={ratio} tone={usage.overBudget ? 'danger' : ratio > 0.8 ? 'warning' : 'accent'} size="sm" aria-label={card.title} />
        <p className={cn('truncate text-xs', usage.overBudget ? 'text-warning' : 'text-fg-faint')}>{usage.overBudget ? t('today.usage.over') : t('today.usage.calls', { count: usage.calls })}</p>
      </div>
    </div>
  );
}

// ───────────── öneriler ─────────────

function SuggestionsCard({ card, width, height, compose }: TodayCardProps<SuggestionsData>) {
  const split = width >= SPLIT_FROM;
  const items = card.data.items.slice(0, fitRows(height, 60) * (split ? 2 : 1));
  return (
    <ul className="kokpit-list min-h-0 flex-1" data-split={split ? '' : undefined} data-testid="today-suggestions">
      {items.map((item) => (
        <li key={item.id} className="kokpit-row min-w-0 items-start" data-hover data-testid="suggestion-item">
          <button type="button" className="flex min-w-0 flex-1 cursor-pointer flex-col rounded-xs text-left" title={t('dashboard.suggestions.use')} onClick={() => compose(item.prompt ?? item.text)}>
            <span className="line-clamp-2 text-sm font-medium text-fg">{item.text}</span>
            {item.detail ? <span className="truncate text-xs text-fg-faint">{item.detail}</span> : null}
          </button>
          <IconButton
            icon={<X weight="bold" />}
            label={t('dashboard.suggestions.dismiss')}
            size="sm"
            className="-mr-1.5"
            onClick={() => void attempt(() => window.fuber.invoke('dashboard.dismissSuggestion', { id: item.id }))}
            data-testid="suggestion-dismiss"
          />
        </li>
      ))}
    </ul>
  );
}

// ───────────── kayıt ─────────────

const total = (card: DashboardCard): number | undefined => (card.data as { total?: number }).total;
const many = (card: DashboardCard): number | undefined => {
  const count = (card.data as { items?: unknown[] }).items?.length;
  return count !== undefined && count > 1 ? count : undefined;
};

registerTodayCard('agenda', AgendaCard, { tone: 'focus', count: total });
registerTodayCard('todos', TodosCard, { count: total });
registerTodayCard('jobs', JobsCard, { count: (card) => (card.data as JobsData).items.length });
registerTodayCard('notices', NoticesCard, { count: many });
registerTodayCard('suggestions', SuggestionsCard);
registerTodayCard('usage', UsageCard);
registerTodayCard('weather', WeatherCard, { tone: 'ambient' });
registerTodayCard('fx', FxCard, { tone: 'ambient' });
registerTodayCard('news', NewsCard, { tone: 'ambient' });
registerTodayCard('sessions', SessionsCard, { tone: 'ambient' });
registerTodayCard('activity', ActivityCard, { tone: 'ambient' });
