import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { MotionConfig, motion } from 'motion/react';
import { CaretLeft } from '@phosphor-icons/react';
import {
  t,
  type BrainStatus,
  type ControlStatus,
  type LocalModelProgress,
  type Policy,
  type SetupStepId,
  type VoiceState,
  type VoiceStatus,
} from '@fuber/shared';
import { Button, Core, KeyHint, Starfield, cn, type CoreState } from '@fuber/ui';
import { StepSwap, capitalize } from './parts';
import {
  AutostartStep,
  ConnectStep,
  EchoStep,
  IntroStep,
  MicrophoneStep,
  ModelsStep,
  ReadyStep,
  WakeStep,
  WelcomeStep,
  type StepContext,
} from './steps';
import { acceleratorKeys, quiet, useEvent } from './util';

export type Screen = 'welcome' | 'connect' | 'microphone' | 'models' | 'wake' | 'echo' | 'autostart' | 'intro' | 'ready';

const SCREENS: Screen[] = ['welcome', 'connect', 'microphone', 'models', 'wake', 'echo', 'autostart', 'intro', 'ready'];

/** Ekranın kalıcı adım karşılığı (`setup.completeStep`). Uyandırma ve yankı, mikrofon adımının parçasıdır. */
const STEP_OF: Record<Screen, SetupStepId> = {
  welcome: 'welcome',
  connect: 'connect',
  microphone: 'microphone',
  models: 'models',
  wake: 'microphone',
  echo: 'microphone',
  autostart: 'autostart',
  intro: 'intro',
  ready: 'done',
};
/** Ayrılınca tamamlandı işaretlenen adımlar. */
const COMPLETES: Partial<Record<Screen, SetupStepId[]>> = {
  welcome: ['welcome'],
  connect: ['connect'],
  microphone: ['microphone'],
  models: ['models'],
  autostart: ['autostart'],
  intro: ['intro'],
};

export interface Shared {
  policy: Policy | null;
  talkKeys: string[];
  voice: VoiceStatus | null;
  voiceState: VoiceState;
  /** Son ~1 sn'lik mikrofon genliği (olay geliyorsa). */
  level: { current: number };
  models: LocalModelProgress[];
  control: ControlStatus | null;
  /** Asistanın o anki beyni (`app.status.brain`); henüz okunmadıysa `null`. */
  brain: BrainStatus | null;
}

/**
 * Kurulum sihirbazı (v1'in kurgusu, v2'nin dili): solda tek soru (büyük başlık, kısa açıklama, denetimler), sağda
 * büyük yuvarlak panoda o adımın CANLI sonucu. Panonun tepesinde ekranın üstündeki ada gibi Jarvis'in varlığı ve o
 * adımdaki tek cümlesi durur; karşılamada varlık panonun ortasındadır. Üstte FUBER ve ilerleme ("3 / 9"), altta
 * "Geri" ve beyaz hap (Enter). Her adım gerçek bir iş yapar; ilerleme `setup.*` ile kalıcıdır. Sınamalar isteğe
 * bağlıdır: yalnız düğmeyle başlar (yankı sınaması ses çalar) ve "Şimdilik geç" ile geçilir. Tek görünüm: Takımyıldız.
 */
export function Wizard() {
  const [index, setIndex] = useState<number | null>(null);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [busy, setBusy] = useState(false);
  const [skippable, setSkippable] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const [core, setCore] = useState<CoreState>('idle');
  const [say, setSay] = useState<string | null>(null);
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);

  const [policy, setPolicy] = useState<Policy | null>(null);
  const [talkKeys, setTalkKeys] = useState<string[]>(['Ctrl', 'Alt', 'J']);
  const [voice, setVoice] = useState<VoiceStatus | null>(null);
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [models, setModels] = useState<LocalModelProgress[]>([]);
  const [control, setControl] = useState<ControlStatus | null>(null);
  const [brain, setBrain] = useState<BrainStatus | null>(null);
  const level = useRef({ current: 0 });
  const speakerLevel = useRef(0);
  const root = useRef<HTMLDivElement>(null);

  // Adımların topladığı ve ayrılırken yazılan değerler.
  const [launchAtLogin, setLaunchAtLogin] = useState(true);
  const [userName, setUserName] = useState('');
  const [address, setAddress] = useState<string | null>(null);

  useEffect(() => {
    void quiet(window.fuber.invoke('settings.policy')).then((value) => value && setPolicy(value));
    void quiet(window.fuber.invoke('settings.hotkeys')).then((hotkeys) => {
      const talk = hotkeys?.find((hotkey) => hotkey.id === 'talk');
      if (talk) setTalkKeys(acceleratorKeys(talk.accelerator));
    });
    void quiet(window.fuber.invoke('settings.get')).then((settings) => {
      if (!settings) return;
      if (settings.userName) setUserName(settings.userName);
      if (settings.userAddress) setAddress(settings.userAddress);
    });
    void quiet(window.fuber.invoke('voice.status')).then((status) => {
      if (!status) return;
      setVoice(status);
      setVoiceState(status.state);
    });
    void quiet(window.fuber.invoke('setup.models')).then((list) => list && setModels(list));
    void quiet(window.fuber.invoke('control.status')).then((status) => status && setControl(status));
    void quiet(window.fuber.invoke('app.status')).then((status) => status && setBrain(status.brain));
    void quiet(window.fuber.invoke('setup.state')).then((state) => {
      const done = new Set(state?.done ?? []);
      const resume = state?.completed ? SCREENS.length - 1 : SCREENS.findIndex((screen) => !done.has(STEP_OF[screen]));
      setIndex(resume < 0 ? SCREENS.length - 1 : resume);
    });
  }, []);

  useEvent('voice.status', (status) => {
    setVoice(status);
    setVoiceState(status.state);
  });
  useEvent('voice.state', ({ state }) => setVoiceState(state));
  useEvent('voice.level', ({ source, rms }) => {
    if (source === 'mic') level.current.current = rms;
    else speakerLevel.current = rms;
  });
  useEvent('setup.modelProgress', (progress) =>
    setModels((list) => {
      const found = list.some((item) => item.id === progress.id);
      return found ? list.map((item) => (item.id === progress.id ? progress : item)) : [...list, progress];
    }),
  );
  useEvent('control.status', setControl);
  useEvent('brain.status', setBrain);
  useEvent('policy.changed', () => void quiet(window.fuber.invoke('settings.policy')).then((value) => value && setPolicy(value)));
  useEvent('settings.changed', ({ settings, changedKeys }) => {
    if (changedKeys.includes('hotkeys')) setTalkKeys(acceleratorKeys(settings.hotkeys.talk));
  });

  const screen = index === null ? null : SCREENS[index];
  const position = index ?? -1;

  // Ekran değişince ada o ekranın varsayılanına döner; adım isterse değiştirir. Çizimden önce, adımın kendi
  // etkilerinden de önce yapılır (alt bileşenin etkileri üstünkünden önce koşar).
  const [shownScreen, setShownScreen] = useState(screen);
  if (shownScreen !== screen) {
    setShownScreen(screen);
    setCore('idle');
    setSay(null);
    setBusy(false);
    setSkippable(false);
    setLeaveError(null);
  }

  const shared: Shared = { policy, talkKeys, voice, voiceState, level: level.current, models, control, brain };
  const wake = policy?.persona.wakePhrases[0] ? capitalize(policy.persona.wakePhrases[0]) : 'Hey Jarvis';
  const name = policy?.persona.name ?? 'Jarvis';

  const ctx: StepContext = {
    shared,
    wake,
    name,
    setCore,
    setSay,
    setBusy,
    setSkippable,
    launchAtLogin,
    setLaunchAtLogin,
    userName,
    setUserName,
    address,
    setAddress,
  };

  /** Ekrandan ayrılırken yapılan iş: ayarı yaz, adımı tamamla. Hata olursa ilerlenmez, neden gösterilir. */
  const leave = async (from: Screen) => {
    if (from === 'welcome') {
      // Modeller şimdiden hazırlanmaya başlar (bu bilgisayarda bulunanlar anında yerleşir); mikrofon adımı ses hattını bekler.
      void quiet(window.fuber.invoke('setup.downloadModels', {}));
    }
    if (from === 'autostart') await window.fuber.invoke('settings.update', { patch: { launchAtLogin } });
    if (from === 'intro') {
      const trimmed = userName.trim();
      await window.fuber.invoke('settings.update', { patch: { userName: trimmed || null, userAddress: address?.trim() || null } });
    }
    for (const step of COMPLETES[from] ?? []) await window.fuber.invoke('setup.completeStep', { step });
  };

  const goNext = async () => {
    if (index === null || !screen || leaving || busy) return;
    setLeaving(true);
    setLeaveError(null);
    try {
      if (screen === 'ready') {
        await leave('ready');
        await window.fuber.invoke('setup.finish');
        return;
      }
      await leave(screen);
      setDirection(1);
      if (index + 1 < SCREENS.length) setIndex(index + 1);
    } catch (error) {
      setLeaveError(t('setup.error.generic', { message: (error as Error).message }));
    } finally {
      setLeaving(false);
    }
  };

  const goBack = () => {
    if (index === null || index === 0 || leaving) return;
    setDirection(-1);
    setIndex(index - 1);
  };

  // Klavye: Enter birincil düğmeye basar (odak bir düğmede, anahtarda ya da seçenekte değilse; onlar kendi Enter'ını
  // işler). Metin alanında Enter de ilerler (adı yazıp Enter).
  const nextRef = useRef(goNext);
  nextRef.current = goNext;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.defaultPrevented || event.isComposing || event.repeat || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('button, a, textarea, [role="switch"], [role="radio"], [role="checkbox"]')) return;
      event.preventDefault();
      void nextRef.current();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  // Adım değişince odak yeni başlığa (adımın bir alanı kendini odaklamadıysa): klavye ve ekran okuyucu yeni soruyu duyar.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const layer = root.current?.querySelector('.setup-left [data-gecis="gir"]');
      const active = document.activeElement;
      if (active && active !== document.body && layer?.contains(active)) return;
      layer?.querySelector<HTMLElement>('[data-testid=setup-title]')?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [screen]);

  if (index === null || !screen) return <div className="h-full bg-stage" />;

  const offline = control !== null && control.state !== 'approved' && control.state !== 'pending';
  const primaryLabel =
    screen === 'welcome'
      ? t('setup.welcome.start')
      : screen === 'ready'
        ? t('setup.ready.finish')
        : screen === 'connect' && offline
          ? t('setup.connect.local')
          : skippable
            ? t('setup.skip')
            : t('setup.next');

  const coreState: CoreState = screen === 'ready' ? readyCore(voiceState, voice) : core;
  const caption = say ?? t(`setup.${screen === 'microphone' ? 'mic' : screen}.say`);
  const hero = screen === 'welcome';
  const total = SCREENS.length;

  // Dinlerken mikrofon, konuşurken hoparlör genliği: varlık o anki kaynağa tepki verir. Karşılamada büyük (panonun
  // ortası), sonra adada küçük; aynı `layoutId` ile yerinden yerine akar.
  const presence = (
    <motion.div layoutId="setup-core" className="setup-core" data-testid="setup-core" data-state={coreState} transition={{ type: 'spring', visualDuration: 0.32, bounce: 0.12 }}>
      <Core
        state={coreState}
        getLevel={() => (voiceState === 'speaking' ? speakerLevel.current : level.current.current)}
        size={hero ? 148 : 44}
        label={name}
      />
    </motion.div>
  );
  const sayLine = (
    <p key={caption} className="setup-say" data-testid="setup-say" aria-live="polite">
      {caption}
    </p>
  );

  // Adımın kendi önerilen eylemi varken (sınama, Yönetim'i açma) alttaki düğme geri planda durur.
  const deferred = skippable || (screen === 'connect' && offline);
  const next = (
    <Button
      variant={deferred ? 'secondary' : 'primary'}
      size={deferred ? 'md' : 'lg'}
      className="setup-next rounded-full"
      onClick={() => void goNext()}
      disabled={busy}
      loading={leaving}
      trailing={deferred ? undefined : <KeyHint keys={['Enter']} tone="inverse" size="sm" />}
      data-testid="setup-next"
      data-skip={skippable ? '' : undefined}
    >
      {primaryLabel}
    </Button>
  );

  return (
    <MotionConfig reducedMotion="user">
      <div ref={root} className="setup-root" data-testid="setup" data-screen={screen} style={{ '--setup-dir': direction } as CSSProperties}>
        {/* Tek görünüm: yıldızlı sahne her zaman. */}
        <Starfield shift={position} />
        {/* Üst şerit: solda FUBER, ortada ilerleme; sağdaki pencere düğmeleri işletim sisteminin katmanında. */}
        <header className="setup-top">
          <span className="setup-brand" aria-hidden>
            FUBER
          </span>
          <div className="setup-progress" aria-label={t('setup.step', { n: position + 1, total })}>
            <span className="setup-track" aria-hidden>
              <span className="setup-fill" style={{ transform: `scaleX(${(position + 1) / total})` }} />
            </span>
            <span className="setup-count" aria-hidden>
              {position + 1} / {total}
            </span>
            <span className="sr-only" data-testid="setup-step">
              {t('setup.step', { n: position + 1, total })}
            </span>
          </div>
          <span />
        </header>

        <div className="setup-frame">
          <div className="setup-shell">
            <main className="setup-main">
              <section className="setup-left setup-body">
                <StepSwap id={screen} slot={slot}>
                  {screen === 'welcome' ? <WelcomeStep ctx={ctx} /> : null}
                  {screen === 'connect' ? <ConnectStep ctx={ctx} /> : null}
                  {screen === 'microphone' ? <MicrophoneStep ctx={ctx} /> : null}
                  {screen === 'models' ? <ModelsStep ctx={ctx} /> : null}
                  {screen === 'wake' ? <WakeStep ctx={ctx} /> : null}
                  {screen === 'echo' ? <EchoStep ctx={ctx} /> : null}
                  {screen === 'autostart' ? <AutostartStep ctx={ctx} /> : null}
                  {screen === 'intro' ? <IntroStep ctx={ctx} /> : null}
                  {screen === 'ready' ? <ReadyStep ctx={ctx} /> : null}
                </StepSwap>
              </section>

              {/* Canlı önizleme panosu: ekranınızın küçük bir kopyası. Ada tepede, adımın sonucu ortada. */}
              <section className="setup-board" data-testid="setup-preview" data-hero={hero ? '' : undefined} aria-label={t('setup.preview')}>
                {hero ? (
                  <div className="setup-hero">
                    {presence}
                    <p className="setup-hero-title">{t('setup.welcome.hello', { name })}</p>
                    {sayLine}
                  </div>
                ) : (
                  <div className="setup-island">
                    {presence}
                    {sayLine}
                  </div>
                )}
                <div ref={setSlot} className="setup-slot" />
              </section>
            </main>

            <footer className="setup-foot">
              {position > 0 ? (
                <Button variant="ghost" className="setup-back" icon={<CaretLeft weight="bold" />} onClick={goBack} disabled={leaving} data-testid="setup-back">
                  {t('setup.back')}
                </Button>
              ) : null}
              <span className={cn('grow text-right text-sm', leaveError ? 'text-danger' : '')} role={leaveError ? 'alert' : undefined} data-testid={leaveError ? 'setup-error' : undefined}>
                {leaveError}
              </span>
              {next}
            </footer>
          </div>
        </div>
      </div>
    </MotionConfig>
  );
}

function readyCore(state: VoiceState, status: VoiceStatus | null): CoreState {
  if (status?.micMuted || state === 'mic_off') return 'muted';
  if (state === 'listening' || state === 'followup') return 'listening';
  if (state === 'thinking') return 'thinking';
  if (state === 'speaking') return 'speaking';
  return 'idle';
}
