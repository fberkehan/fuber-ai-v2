// Ana pencerenin yaşam döngüsü katmanı (kabuk düzeyi, sayfalardan bağımsız):
// - Kapanış diyaloğu (`app.closeRequested`): pencere X'i "sor" ayarında ya da süren iş varken çıkış istenince.
// - Veda örtüsü (`app.farewell`): varlık söner, tek cümle; ≤ 650 ms, sınamada beklemesiz.
// - Açılış çanı: yalnız paketli üretimde (`chime.ts`).
// - Açılış kapıları: "Tekrar hoş geldiniz" (yeniden kurulum işareti) ve "Yenilikler" (sürüm değişti), sırayla.
// Birincil eylem beyaz hap ve solda; olumsuz eylem hemen sağında; "Vazgeç" en sağda (KURGU §12).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowRight,
  ArrowsClockwise,
  Binoculars,
  Brain,
  ChatCircleDots,
  ChatsCircle,
  Check,

  DownloadSimple,
  EnvelopeSimple,
  GearSix,
  GlobeHemisphereWest,
  Layout,
  Lightning,
  MonitorPlay,
  Sparkle,
  Terminal,
  UsersThree,
  Waveform,
} from '@phosphor-icons/react';
import { APP_VERSION, t, type BusyItem, type CloseChoice, type CloseRequest, type DataSummary, type WelcomeState, type WhatsNewItem } from '@fuber/shared';
import { Badge, Button, Checkbox, cn, Dialog, KeyHint, Presence, spring, useReducedMotion } from '@fuber/ui';
import { startupChime } from './chime';
import { useShell } from './context';
import { acceleratorKeys, attempt, useEvent } from './live';

// ───────────────────────────── kapanış ─────────────────────────────

const busyIcon: Record<BusyItem['kind'], ReactNode> = {
  jobs: <Lightning weight="fill" />,
  meeting: <UsersThree weight="fill" />,
  claude: <Terminal weight="bold" />,
  models: <DownloadSimple weight="bold" />,
  pc: <MonitorPlay weight="fill" />,
};

export function busyText(item: BusyItem, name: string): string {
  switch (item.kind) {
    case 'jobs':
      if (item.title && item.count > 1) return t('lifecycle.busy.jobsMore', { title: item.title, more: item.count - 1 });
      if (item.title) return t('lifecycle.busy.jobsTitled', { title: item.title });
      return t('lifecycle.busy.jobs', { count: item.count });
    case 'meeting':
      return t('lifecycle.busy.meeting');
    case 'claude':
      return t('lifecycle.busy.claude', { count: item.count });
    case 'models':
      return t('lifecycle.busy.models', { count: item.count });
    case 'pc':
      return t('lifecycle.busy.pc', { name });
  }
}

/** Başlığın solundaki varlık işareti: Jarvis'in kendisi (yıldız kümesi). */
function TitleMark({ state = 'idle', children }: { state?: 'idle' | 'notice' | 'job'; children: ReactNode }) {
  return (
    <span className="flex items-center gap-3.5">
      <span className="grid size-11 shrink-0 place-items-center rounded-full bg-surface-3 shadow-raise" aria-hidden>
        <Presence state={state} size={36} />
      </span>
      <span className="min-w-0">{children}</span>
    </span>
  );
}

function CloseDialog({ request, onClose }: { request: CloseRequest; onClose: () => void }) {
  const shell = useShell();
  const [remember, setRemember] = useState(false);
  const [sending, setSending] = useState<CloseChoice | null>(null);
  const primary = useRef<HTMLButtonElement | null>(null);
  const busy = request.busy.length > 0;
  const askRemember = request.source === 'window';
  const talk = shell.hotkeys.find((hotkey) => hotkey.id === 'talk' && hotkey.registered);

  useEffect(() => {
    void window.fuber.invoke('app.closeAck', { id: request.id }).catch(() => {});
  }, [request.id]);

  const decide = async (choice: CloseChoice) => {
    if (sending) return;
    setSending(choice);
    await attempt(() => window.fuber.invoke('app.closeDecision', { id: request.id, choice, remember: askRemember && remember }));
    onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && void decide('cancel')}
      role={busy ? 'alertdialog' : 'dialog'}
      size="md"
      initialFocusRef={primary}
      closeLabel={t('lifecycle.close.cancel')}
      className="lc-close"
      title={<TitleMark state={busy ? 'job' : 'idle'}>{busy ? t('lifecycle.close.busyTitle') : t('lifecycle.close.title', { name: shell.name })}</TitleMark>}
      description={busy ? t('lifecycle.close.busyBody', { name: shell.name }) : t('lifecycle.close.body', { name: shell.name, wake: shell.wakePhrase })}
      footer={
        <div className="flex w-full flex-wrap items-center gap-2" data-testid="close-actions">
          <Button ref={primary} variant="primary" loading={sending === 'background'} onClick={() => void decide('background')} data-testid="close-background">
            {busy ? t('lifecycle.close.backgroundBusy') : t('lifecycle.close.background')}
          </Button>
          <Button variant="secondary" loading={sending === 'quit'} onClick={() => void decide('quit')} data-testid="close-quit">
            {busy ? t('lifecycle.close.quitBusy') : t('lifecycle.close.quit')}
          </Button>
          <Button variant="ghost" className="ml-auto" onClick={() => void decide('cancel')} data-testid="close-cancel">
            {t('lifecycle.close.cancel')}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4" data-testid="close-dialog" data-source={request.source} data-busy={busy ? request.busy.length : 0}>
        {busy ? (
          <ul className="flex flex-col overflow-hidden rounded-md bg-surface-1 shadow-raise" data-testid="close-busy">
            {request.busy.map((item) => (
              <li key={item.kind} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0" data-busy-kind={item.kind}>
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-warning-soft text-warning [&_svg]:size-4" aria-hidden>
                  {busyIcon[item.kind]}
                </span>
                <span className="min-w-0 flex-1 truncate text-base text-fg">{busyText(item, shell.name)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex items-center gap-3 rounded-md bg-surface-1 px-4 py-3 shadow-raise" data-testid="close-tray">
            <span className="relative grid size-8 shrink-0 place-items-center rounded-full bg-success-soft" aria-hidden>
              <span className="size-2 rounded-full bg-success" />
            </span>
            <span className="min-w-0 flex-1 text-sm text-fg-muted">
              <span className="block text-base text-fg">{t('lifecycle.close.tray')}</span>
              “{shell.wakePhrase}”
            </span>
            {talk && <KeyHint keys={acceleratorKeys(talk.accelerator)} />}
          </div>
        )}
        {askRemember && (
          <Checkbox
            checked={remember}
            onCheckedChange={setRemember}
            label={t('lifecycle.close.remember')}
            description={t('lifecycle.close.rememberHint')}
            data-testid="close-remember"
          />
        )}
      </div>
    </Dialog>
  );
}

// ───────────────────────────── veda ─────────────────────────────

/** Veda örtüsü: siyah sahne yükselir, varlık söner, tek cümle. Uygulama örtünün süresi dolunca kapanır. */
export function Farewell({ ms, title, dim = 0.18, testId = 'farewell', children }: { ms: number; title: string; dim?: number; testId?: string; children?: ReactNode }) {
  const reduce = useReducedMotion() ?? false;
  const quick = ms <= 0;
  const duration = quick ? 0 : Math.max(0.16, (ms / 1000) * 0.45);
  return (
    <motion.div
      className="lc-farewell fixed inset-0 flex flex-col items-center justify-center bg-stage"
      style={{ zIndex: 'calc(var(--z-toast) + 50)' }}
      initial={quick ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: quick ? 0 : 0.16, ease: [0.23, 1, 0.32, 1] }}
      data-testid={testId}
      role="status"
      aria-live="assertive"
    >
      <div className="ui-drag absolute inset-x-0 top-0 h-10" aria-hidden />
      <motion.div
        initial={quick || reduce ? false : { opacity: 1, transform: 'scale(1)' }}
        animate={reduce ? { opacity: Math.max(dim, 0.4) } : { opacity: dim, transform: 'scale(0.86)' }}
        transition={{ duration: Math.max(duration, quick ? 0 : 0.3), ease: [0.23, 1, 0.32, 1], delay: quick ? 0 : 0.12 }}
      >
        <Presence state="idle" size={120} />
      </motion.div>
      <motion.p
        className="mt-8 text-3xl font-[640] tracking-[-0.045em] text-fg"
        initial={quick ? false : { opacity: 0, transform: 'translateY(6px)' }}
        animate={{ opacity: 1, transform: 'translateY(0px)' }}
        transition={quick ? { duration: 0 } : { ...spring.smooth, delay: 0.06 }}
        data-testid={`${testId}-text`}
      >
        {title}
      </motion.p>
      {children}
    </motion.div>
  );
}

// ───────────────────────────── tekrar hoş geldiniz ─────────────────────────────

export function relativeDay(iso: string | null, now = new Date()): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const day = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const diff = Math.round((day(now) - day(date)) / 86_400_000);
  if (diff <= 0) return t('lifecycle.welcome.today');
  if (diff === 1) return t('lifecycle.welcome.yesterday');
  if (diff < 30) return t('lifecycle.welcome.daysAgo', { count: diff });
  if (diff < 365) return t('lifecycle.welcome.monthsAgo', { count: Math.floor(diff / 30) });
  return date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function ChoiceCard({ selected, onSelect, title, hint, icon, badge, testId }: { selected: boolean; onSelect: () => void; title: string; hint: string; icon: ReactNode; badge?: string; testId: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      data-testid={testId}
      className={cn(
        'lc-choice group flex w-full items-start gap-3.5 rounded-md px-4 py-3.5 text-left outline-none',
        'transition-[background-color,box-shadow,transform] duration-(--duration-fast) ease-out active:scale-[0.99]',
        'focus-visible:shadow-[0_0_0_2px_var(--color-accent-fg)]',
        selected ? 'bg-surface-3 shadow-[inset_0_0_0_1px_var(--color-line-strong)]' : 'bg-surface-1 shadow-raise hover:bg-surface-2',
      )}
    >
      <span className={cn('mt-0.5 grid size-9 shrink-0 place-items-center rounded-full [&_svg]:size-4.5', selected ? 'bg-primary text-on-primary' : 'bg-surface-4 text-fg-muted')} aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-base font-medium text-fg">{title}</span>
          {badge && <Badge tone="accent">{badge}</Badge>}
        </span>
        <span className="mt-0.5 block text-sm text-fg-muted">{hint}</span>
      </span>
    </button>
  );
}

function SummaryRow({ icon, label, value, testId }: { icon: ReactNode; label: string; value: string | null; testId: string }) {
  return (
    <li className="flex items-center gap-3 border-b border-line py-3 last:border-b-0" data-testid={testId} data-empty={value === null ? '' : undefined}>
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-4 text-fg-muted [&_svg]:size-4" aria-hidden>
        {icon}
      </span>
      <span className="flex-1 text-base text-fg">{label}</span>
      {value === null ? (
        <span className="text-sm text-fg-faint">{t('lifecycle.welcome.empty')}</span>
      ) : (
        <span className="flex items-center gap-1.5 text-sm tabular-nums text-fg">
          {value}
          <Check weight="bold" className="size-3.5 text-success" aria-hidden />
        </span>
      )}
    </li>
  );
}

function WelcomeBack({ summary, onDone }: { summary: DataSummary; onDone: () => void }) {
  const shell = useShell();
  const [choice, setChoice] = useState<'continue' | 'fresh'>('continue');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const primary = useRef<HTMLButtonElement | null>(null);
  const when = relativeDay(summary.lastUsedAt);
  const go = async () => {
    setBusy(true);
    if (choice === 'continue') {
      await attempt(() => window.fuber.invoke('lifecycle.welcomeContinue'));
      onDone();
      return;
    }
    const result = await attempt(() => window.fuber.invoke('lifecycle.startOver'));
    if (!result) {
      setBusy(false);
      return;
    }
    setNote(result.restart === 'auto' ? t('lifecycle.data.restarting') : t('lifecycle.data.manual'));
  };
  const count = (n: number, key: string) => (n > 0 ? t(key, { count: n.toLocaleString('tr-TR') }) : null);
  return (
    <Dialog
      open
      onOpenChange={() => {}}
      dismissible={false}
      size="lg"
      initialFocusRef={primary}
      className="lc-welcome max-w-190!"
      title={<TitleMark>{shell.address ? t('lifecycle.welcome.title', { address: shell.address }) : t('lifecycle.welcome.titlePlain')}</TitleMark>}
      description={t('lifecycle.welcome.body', { name: shell.name })}
      footer={
        <div className="flex w-full items-center gap-3">
          <Button ref={primary} variant="primary" loading={busy} onClick={() => void go()} trailing={<ArrowRight weight="bold" />} data-testid="welcome-go" data-choice={choice}>
            {choice === 'continue' ? t('lifecycle.welcome.go') : t('lifecycle.welcome.fresh')}
          </Button>
          <span className="min-w-0 flex-1 text-sm text-fg-muted" role="status">
            {note ?? t('lifecycle.welcome.assurance')}
          </span>
        </div>
      }
    >
      <div className="grid gap-5 sm:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]" data-testid="welcome-back">
        <div role="radiogroup" aria-label={t('lifecycle.welcome.choice')} className="flex flex-col gap-2">
          <ChoiceCard
            selected={choice === 'continue'}
            onSelect={() => setChoice('continue')}
            title={t('lifecycle.welcome.continue')}
            hint={t('lifecycle.welcome.continueHint')}
            icon={<ArrowRight weight="bold" />}
            badge={t('lifecycle.welcome.recommended')}
            testId="welcome-continue"
          />
          <ChoiceCard
            selected={choice === 'fresh'}
            onSelect={() => setChoice('fresh')}
            title={t('lifecycle.welcome.fresh')}
            hint={t('lifecycle.welcome.freshHint')}
            icon={<ArrowsClockwise weight="bold" />}
            testId="welcome-fresh"
          />
        </div>
        <section className="rounded-md bg-surface-1 px-4 pt-3.5 pb-1 shadow-raise" aria-label={t('lifecycle.welcome.here')} data-testid="welcome-summary">
          <header className="flex flex-col gap-0.5">
            <h3 className="text-sm font-medium text-fg-muted">{t('lifecycle.welcome.here')}</h3>
            <span className="text-sm text-fg-faint">{when ? t('lifecycle.welcome.lastUsed', { when }) : t('lifecycle.welcome.lastUnknown')}</span>
          </header>
          <ul className="mt-1">
            <SummaryRow icon={<ChatsCircle weight="fill" />} label={t('lifecycle.welcome.chats')} value={count(summary.chats, 'lifecycle.welcome.chatsValue')} testId="welcome-row-chats" />
            <SummaryRow icon={<Brain weight="fill" />} label={t('lifecycle.welcome.memory')} value={count(summary.memory, 'lifecycle.welcome.memoryValue')} testId="welcome-row-memory" />
            <SummaryRow
              icon={<GearSix weight="fill" />}
              label={t('lifecycle.welcome.settings')}
              value={summary.settings > 0 ? t('lifecycle.welcome.settingsValue', { count: summary.settings }) : t('lifecycle.welcome.settingsDefault')}
              testId="welcome-row-settings"
            />
          </ul>
        </section>
      </div>
    </Dialog>
  );
}

// ───────────────────────────── yenilikler ─────────────────────────────

const newsIcon: Record<WhatsNewItem['icon'], ReactNode> = {
  brain: <Brain weight="fill" />,
  waveform: <Waveform weight="bold" />,
  users: <UsersThree weight="fill" />,
  binoculars: <Binoculars weight="fill" />,
  globe: <GlobeHemisphereWest weight="fill" />,
  envelope: <EnvelopeSimple weight="fill" />,
  chat: <ChatCircleDots weight="fill" />,
  layout: <Layout weight="fill" />,
};

function WhatsNew({ version, items, onDone }: { version: string; items: WhatsNewItem[]; onDone: () => void }) {
  const shell = useShell();
  const reduce = useReducedMotion() ?? false;
  const close = () => {
    void window.fuber.invoke('lifecycle.whatsNewSeen').catch(() => {});
    onDone();
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && close()}
      size="lg"
      className="lc-news"
      closeLabel={t('lifecycle.news.ok')}
      title={
        <TitleMark state="notice">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {t('lifecycle.news.title')}
            <span className="rounded-full bg-surface-4 px-2.5 py-0.5 font-mono text-sm text-fg-muted" data-testid="news-version">
              {version}
            </span>
          </span>
        </TitleMark>
      }
      description={t('lifecycle.news.body', { name: shell.name })}
      footer={
        <div className="flex w-full items-center gap-2">
          <Button variant="primary" onClick={close} data-testid="news-ok" icon={<Sparkle weight="fill" />}>
            {t('lifecycle.news.ok')}
          </Button>
        </div>
      }
    >
      <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2" data-testid="whats-new">
        {items.map((item, index) => (
          <motion.li
            key={item.key}
            className="flex items-start gap-3 py-2.5"
            initial={reduce ? { opacity: 0 } : { opacity: 0, transform: 'translateY(6px)' }}
            animate={{ opacity: 1, transform: 'translateY(0px)' }}
            transition={{ ...spring.smooth, delay: 0.08 + index * 0.04 }}
            data-news={item.key}
          >
            <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft text-accent-fg [&_svg]:size-4.5" aria-hidden>
              {newsIcon[item.icon]}
            </span>
            <span className="text-base text-fg">{t(item.key)}</span>
          </motion.li>
        ))}
      </ul>
    </Dialog>
  );
}

// ───────────────────────────── katman ─────────────────────────────

export function Lifecycle() {
  const shell = useShell();
  const [request, setRequest] = useState<CloseRequest | null>(null);
  const [farewell, setFarewell] = useState<number | null>(null);
  const [welcome, setWelcome] = useState<WelcomeState | null>(null);
  const [gate, setGate] = useState<'reinstall' | 'news' | null>(null);
  const chimed = useRef(false);

  useEvent('app.closeRequested', (next) => setRequest(next));
  useEvent('app.farewell', ({ ms }) => {
    setRequest(null);
    setFarewell(ms);
  });

  // Açılış çanı: ayarlar ve uygulama bilgisi gelince bir kez.
  useEffect(() => {
    if (chimed.current || !shell.info || !shell.settings) return;
    chimed.current = true;
    const { info, settings } = shell;
    void window.fuber
      .invoke('lifecycle.prefs')
      .then((prefs) => prefs.startupSound, () => false)
      .then((enabled) =>
        startupChime({
          packaged: info.packaged,
          testMode: info.testMode,
          enabled,
          quietHours: settings.quietHours,
          dnd: settings.dnd,
          now: new Date(),
        }),
      );
  }, [shell.info, shell.settings]);

  useEffect(() => {
    void window.fuber.invoke('lifecycle.welcome').then((state) => {
      setWelcome(state);
      setGate(state.reinstall ? 'reinstall' : state.whatsNew ? 'news' : null);
    }, () => {});
  }, []);

  const nextGate = () => setGate(gate === 'reinstall' && welcome?.whatsNew ? 'news' : null);

  return (
    <>
      {gate === 'reinstall' && welcome?.reinstall && <WelcomeBack summary={welcome.reinstall} onDone={nextGate} />}
      {gate === 'news' && welcome?.whatsNew && <WhatsNew version={welcome.whatsNew.version} items={welcome.whatsNew.items} onDone={() => setGate(null)} />}
      {request && farewell === null && <CloseDialog key={request.id} request={request} onClose={() => setRequest((current) => (current?.id === request.id ? null : current))} />}
      <AnimatePresence>
        {farewell !== null && (
          <Farewell ms={farewell} title={shell.address ? t('lifecycle.farewell', { address: shell.address }) : t('lifecycle.farewellPlain')}>
            <span className="mt-3 text-sm text-fg-faint">{t('lifecycle.farewell.closing')}</span>
          </Farewell>
        )}
      </AnimatePresence>
      <span hidden data-testid="lifecycle-ready" data-version={APP_VERSION} />
    </>
  );
}


