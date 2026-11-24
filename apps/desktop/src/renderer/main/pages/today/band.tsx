// Bugün bandı: sayfanın tek birincil kutusu, tek satır. Solda Jarvis'in varlığı (tıklanınca dinler) ve selam ile
// gerçek durumu söyleyen tek cümle; sağda yedi günlük hafta şeridi. Onay bekleyen iş varsa bandın alt bölümünde,
// belirgin; onaylar başka hiçbir kartta gösterilmez.
//
// Varlık bandın parçasıdır, ayrı bir kutu değil. Selamın satırında, satırın ortasına hizalı durur (selamı o söyler):
// bandın sol bölgesi bir gökyüzü parçasıdır (`Presence field`); çekirdek selamın başında durur, toz selamın arkasına
// yayılıp sağa doğru söner. Dinlerken yıldızlar çekirdeğe akar, konuşurken dışarı. Gökyüzü motoru boştayken çekirdeği
// çok soluk çizer (pencerenin başı için ayarlı); bantta dinlenen çekirdeği aynı noktada, aynı yarıçapta duran sakin
// çekirdek (`Presence`, tuvali düğmeden büyük) gösterir ve hâl değişince gökyüzüne bırakır.
import { useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ShieldWarning } from '@phosphor-icons/react';
import { formatDayLong, fromLocal, relativeDay, t, type LocalDay, type TodayBandData } from '@fuber/shared';
import { Button, KeyHint, Presence, Tooltip, cn, durations, easings, fade, useReducedMotion } from '@fuber/ui';
import { getLevelFrom, useShell } from '../../shell/context';
import { LiveContent, liveText, type LiveText } from '../../shell/LiveLine';
import { acceleratorKeys, attempt } from '../../shell/live';
import { stopVoice, voiceBusy } from '../../shell/voice-stop';
import { registerTodayCard, type TodayCardProps } from './registry';

const MAX_APPROVALS = 2;
const DAY_NAMES = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];

function greeting(hour: number): string {
  if (hour < 5) return t('today.greeting.night');
  if (hour < 12) return t('today.greeting.morning');
  if (hour < 18) return t('today.greeting.day');
  if (hour < 22) return t('today.greeting.evening');
  return t('today.greeting.night');
}

/**
 * Selamın altındaki cümle gerçek durumu söyler: bugün ne var, yoksa sırada ne var. Bekleyen onay burada yinelenmez:
 * hemen altında, bandın kendi bölümünde yazar.
 */
function summarize(data: TodayBandData): string {
  const approvals = data.approvals.length;
  const parts = [
    data.reminders > 0 ? t('today.summary.reminders', { count: data.reminders }) : null,
    data.todos > 0 ? t('today.summary.todos', { count: data.todos }) : null,
  ].filter((part): part is string => part !== null);
  if (parts.length > 0) return t('today.summary.lead', { list: parts.join(', ') });
  if (data.next) return t('today.summary.next', { when: `${relativeDay(data.next.day)}${data.next.time ? ` ${data.next.time}` : ''}`, text: data.next.text });
  return approvals === 0 ? t('today.summary.clear') : '';
}

function Week({ data, onOpen }: { data: TodayBandData; onOpen: () => void }) {
  return (
    <div className="kokpit-band-week">
      <div className="kokpit-week" role="group" aria-label={t('dashboard.week.label')} data-testid="today-week">
        {data.week.map((entry) => {
          const date = fromLocal(entry.day as LocalDay);
          const total = entry.reminders + entry.todos;
          const isToday = entry.day === data.day;
          const label = t(total > 0 ? 'dashboard.week.count' : 'dashboard.week.none', { day: formatDayLong(entry.day), count: total });
          return (
            <Tooltip key={entry.day} content={label} delay={400}>
              <button type="button" className="kokpit-day" data-today={isToday ? '' : undefined} data-count={total} aria-label={label} aria-current={isToday ? 'date' : undefined} onClick={onOpen}>
                <span className="kokpit-day-name">{DAY_NAMES[date.getDay()]}</span>
                <span className="kokpit-day-number">{date.getDate()}</span>
                {/* Noktalar o günün kayıt sayısıdır (en çok üç); renk anlam taşımaz. */}
                <span className="kokpit-day-dots" aria-hidden>
                  {Array.from({ length: Math.min(3, total) }, (_, index) => (
                    <span key={index} />
                  ))}
                </span>
              </button>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

/** Takımyıldız'da bandın gökyüzü parçası: tuvalin ölçüsü ve çekirdeğin durduğu nokta (bandın sol üstüne göre, px). */
interface Sky {
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
}

/** Gökyüzü tuvali selam bloğundan bu kadar geniştir (toz seyrelsin; sağ kenarı maskeyle söner). */
const SKY_SPREAD = 1.5;
/**
 * Tuvalin boyu selam bloğunun bu kadarıdır: çekirdeğin ve ışınlarının ölçüsü tuvalin boyundan türer; tam boyda
 * dinlerken ışınlar bandın üst kenarına ve selamın ilk harfine dayanıyordu.
 */
const SKY_HEIGHT = 0.8;
/** Tuval ölçüsü değişince motor yeniden kurulur: pencere boyutlanırken her karede değil, durulunca. */
const SKY_SETTLE_MS = 160;

function TodayBand({ card, now }: TodayCardProps<TodayBandData>) {
  const shell = useShell();
  const reduce = useReducedMotion() ?? false;
  const root = useRef<HTMLElement | null>(null);
  const lead = useRef<HTMLDivElement | null>(null);
  const core = useRef<HTMLButtonElement | null>(null);
  const lines = useRef<HTMLDivElement | null>(null);
  // Varlık sayfa ölçeğiyle ve bandın genişlik basamağıyla büyür (selamın yazı boyunu izler).
  const [scale, setScale] = useState(1);
  const [sky, setSky] = useState<Sky | null>(null);
  useLayoutEffect(() => {
    const band = root.current;
    const block = lead.current;
    const button = core.current;
    const summary = lines.current;
    if (!band || !block || !button || !summary) return;
    let timer = 0;
    const read = () => {
      const next = Number.parseFloat(getComputedStyle(band).getPropertyValue('--kokpit-k')) || 1;
      setScale((current) => (current === next ? current : next));
      // Yerleşim ölçüleri (dönüşümden bağımsız): kartın giriş animasyonu sürerken de doğru okunur.
      const offset = (element: HTMLElement) => {
        let x = 0;
        let y = 0;
        for (let node: HTMLElement | null = element; node && node !== band; node = node.offsetParent as HTMLElement | null) {
          x += node.offsetLeft;
          y += node.offsetTop;
        }
        return { x, y };
      };
      const text = offset(block);
      const mark = offset(button);
      const measured: Sky = {
        width: Math.round(Math.min(band.clientWidth, (text.x + block.offsetWidth) * SKY_SPREAD)),
        // Tuval bandın üst bölümündedir (selam + iki satırlık özet kutusu; alt pay üst payla aynı), onay bölümüne taşmaz.
        // Boy, selam bloğunun o anki boyundan DEĞİL sabit kutulardan türer: blokta sonradan beliren bir satır ("ses
        // hazır değil") tuvalin ölçüsünü değiştirmez, varlık yeniden kurulmaz (boşta kare üretilmez).
        height: Math.round((text.y + offset(summary).y + summary.offsetHeight) * SKY_HEIGHT),
        anchorX: Math.round(mark.x + button.offsetWidth / 2),
        anchorY: Math.round(mark.y + button.offsetHeight / 2),
      };
      if (measured.width < 8 || measured.height < 8) return;
      setSky((current) =>
        current && current.width === measured.width && current.height === measured.height && current.anchorX === measured.anchorX && current.anchorY === measured.anchorY ? current : measured,
      );
    };
    read();
    const observer = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(read, SKY_SETTLE_MS);
    });
    // Yalnız bant izlenir: genişliği (pencere, yandaki sohbet) ya da boyu değişince ölçüm yinelenir; ölçü aynıysa
    // durum değişmez, motor uyanmaz.
    observer.observe(band);
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, []);
  const data = card.data;
  const who = shell.settings?.userName?.trim() || shell.address;
  const hello = greeting(now.getHours());
  const talk = shell.hotkeys.find((hotkey) => hotkey.id === 'talk');
  const talkKeys = talk ? acceleratorKeys(talk.accelerator) : undefined;
  // Asistan konuşuyor ya da çalışıyorsa çekirdek "Sustur / Durdur" düğmesidir (demo.5; Esc de aynı işi görür).
  const voiceState = shell.voice?.state;
  const busy = voiceBusy(voiceState);
  const coreLabel = busy ? (voiceState === 'speaking' ? t('voice.action.stop') : t('turn.stop')) : t('today.core.talk');
  // Süren iş "Süren işler" kartında, bekleyen onay bandın altında yazar: canlı satır onları yinelemez. Boştayken
  // son söylenen de yinelenmez (yandaki sohbette durur); satır yalnız Jarvis dinlerken, düşünürken, konuşurken çıkar.
  // Pencere odaktayken duyulan ve söylenen söz pencerenin çentiğinde akar (`hudOwner`); bant onu ikinci kez yazmaz.
  const quiet = shell.presence === 'job' || shell.presence === 'approval' || shell.hudOwner === 'main';
  const text: LiveText = quiet ? { key: null } : liveText(shell.live, { idleLast: false, followup: true, maxChars: 96 });
  const job = shell.presence === 'job' ? shell.live.jobs[0] : undefined;
  // Sayaç yalnız gerçekten sayan bir şey varken verilir (süren işin ilerlemesi); onay beklerken çekirdek doludur.
  const counting = job && job.progress !== null ? { progress: job.progress } : {};
  const approvals = data.approvals.slice(0, MAX_APPROVALS);
  const resolve = (id: string, approve: boolean) => void attempt(() => window.fuber.invoke('attention.resolveApproval', { id, approve }));

  return (
    <section ref={root} className="kokpit-band" aria-label={card.title} data-testid="today-band">
      {/* Takımyıldız: varlık bandın kendi ışığıdır; tuval selamın arkasında durur, tıklamayı almaz. */}
      {sky && (
        <div className="kokpit-band-sky" style={{ transformOrigin: `${sky.anchorX}px ${sky.anchorY}px` }} aria-hidden>
          <Presence state={shell.presence} getLevel={getLevelFrom(shell.level)} size={Math.round(56 * scale)} field={sky} {...counting} />
        </div>
      )}
      <div className="kokpit-band-top">
        <div ref={lead} className="kokpit-band-lead">
          <Tooltip content={coreLabel} shortcut={busy ? ['Esc'] : talkKeys} placement="bottom">
            <button
              ref={core}
              type="button"
              aria-label={coreLabel}
              onClick={busy ? stopVoice : () => void attempt(() => window.fuber.invoke('voice.listen'))}
              className="kokpit-band-presence"
              data-testid="today-core"
              data-state={shell.presence}
              data-action={busy ? 'stop' : 'talk'}
            >
              {/*
                Dinlenen çekirdek (yalnız boştayken görünür; öbür hâlleri gökyüzü tuvali çizer). Boyu, gökyüzündeki
                çekirdeğin yarıçapını tutturur.
              */}
              <Presence
                state={shell.presence}
                getLevel={getLevelFrom(shell.level)}
                size={Math.round(sky ? Math.min(sky.height * 0.75, 200) : 92 * scale)}
                label={t('nav.coreLabel', { name: shell.name })}
                {...counting}
              />
            </button>
          </Tooltip>

          <div className="kokpit-band-text">
            <h1 className="kokpit-greeting" data-testid="today-greeting">
              {who ? t('today.greeting.withName', { greeting: hello, name: who }) : `${hello}.`}
            </h1>
            {/*
              Canlı satır özet cümlesinin yerinde akar (aynı kutu, iki satır): bant uzamaz, selam ve pano yerinden
              oynamaz. Tarih ve özet her zaman kendi satırındadır; canlı satır en çok iki satırdır.
            */}
            <div ref={lines} className="kokpit-band-lines">
              <p className="kokpit-summary" data-live={text.key !== null ? '' : undefined} aria-hidden={text.key !== null || undefined} data-testid="today-summary">
                <time className="block truncate text-fg" dateTime={data.day} data-testid="today-date">
                  {formatDayLong(data.day)}.
                </time>
                {/* Özet uzunsa kendi içinde alt satıra iner (kesilmez); canlı satır aynı kutuda akar, kutu küçülmez. */}
                <span className="block">{summarize(data)}</span>
              </p>
              <p className="kokpit-summary" aria-live="polite" data-testid="today-live">
                {text.key !== null ? (
                  <span key={text.key} className={cn('live-caption line-clamp-2 max-w-full text-fg-muted [&_.live-strong]:mr-2 [&_.live-strong]:text-fg', text.words && 'text-fg')}>
                    <LiveContent text={text} />
                  </span>
                ) : null}
              </p>
            </div>
            {shell.voice && !shell.voice.ready && (
              <p className="mt-1.5 text-sm text-fg-faint" data-testid="today-voice-hint">
                {t('today.voiceNotReady')}
                {talk?.registered && (
                  <>
                    {' '}
                    {t('today.voiceNotReadyKey')} <KeyHint keys={acceleratorKeys(talk.accelerator)} size="sm" className="align-middle" />
                  </>
                )}
              </p>
            )}
          </div>
        </div>

        <Week data={data} onOpen={() => shell.moduleEnabled('planner') && shell.navigate('planner')} />
      </div>

      {/*
        Onay bölümü akordeon gibi açılır ve kapanır (boy + saydamlık, kısa): bant birden uzayıp kısalmaz, alttaki
        kartlar bantla birlikte aynı eğriyle iner ve çıkar (arada boşluk kalmaz, kartlar satırın üstüne binmez).
        Azaltılmış harekette yalnız saydamlık.
      */}
      <AnimatePresence initial={false}>
        {approvals.length > 0 && (
          <motion.div
            key="pending"
            className="flex flex-col overflow-hidden"
            aria-label={t('today.pending.title')}
            data-testid="today-pending"
            initial={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, height: 'auto' }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0, transition: { duration: durations.fast, ease: easings.out } }}
            transition={reduce ? fade : { duration: durations.base, ease: easings.out }}
          >
            {approvals.map((approval) => (
              <div key={approval.id} className="kokpit-approval" data-testid="pending-approval">
                <ShieldWarning weight="fill" className="size-6 shrink-0 text-warning" aria-hidden />
                <p className="min-w-0 flex-1 basis-64 text-lg font-medium text-fg">
                  <span className="text-warning">{t('approval.title')}:</span> {approval.summary}
                </p>
                {/*
                  Onay solda, ret sağında (KURGU §12: öteki yüzeylerle aynı yer). Geri dönüşü olmayan işte onay beyaz
                  hap değildir: kırmızıdır ve retten bir adım uzakta durur; ekranın en davetkâr düğmesi olmaz.
                */}
                <div className={cn('flex shrink-0', approval.risk === 'danger' ? 'gap-4' : 'gap-2')}>
                  <Button variant={approval.risk === 'danger' ? 'danger' : 'primary'} onClick={() => resolve(approval.id, true)}>
                    {t('common.approve')}
                  </Button>
                  <Button variant="secondary" onClick={() => resolve(approval.id, false)}>
                    {t('common.deny')}
                  </Button>
                </div>
              </div>
            ))}
            {data.approvals.length > MAX_APPROVALS && (
              <p className="kokpit-approval py-2.5 text-sm text-fg-muted">{t('dashboard.approval.more', { count: data.approvals.length - MAX_APPROVALS })}</p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

registerTodayCard('today', TodayBand, { bare: true });
