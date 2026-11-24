// Kurulum adımları (int3 içeriği, d4 sihirbaz kurgusu). Her adım iki şeyi birden çizer: solda tek soru ve
// denetimleri, sağdaki panoda (`Preview`) o adımın CANLI sonucu. İkisi aynı durumu okur; önizleme dekor değil,
// kararın/sınamanın o anki hâlidir. Sorulan şeyler ve toplanan ayarlar int3'tekiyle aynıdır; yalnız kurgu yenidir.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Bell,
  CalendarBlank,
  CheckCircle,
  Clock,
  Cloud,
  Desktop,
  Info,
  ListChecks,
  LockKey,
  Microphone,
  Power,
  SpeakerHigh,
  WarningCircle,
} from '@phosphor-icons/react';
import { t, type BrainStatus, type LocalModelProgress, type MicTestResult } from '@fuber/shared';
import { Badge, Chip, Field, Input, KeyHint, ProgressBar, ProgressRing, Spinner, Switch, Waveform, cn, type CoreState, type Tone } from '@fuber/ui';
import { useEchoTest, useWakeCalibration } from '../voice-tests';
import type { Shared } from './Wizard';
import {
  Heading,
  Notice,
  Preview,
  RunButton,
  formatSize,
  greeting,
  roleLabel,
  stagger,
  summarize,
  useClock,
  type RoleSummary,
} from './parts';
import { quiet } from './util';

export interface StepContext {
  shared: Shared;
  /** Uyandırma sözü, baş harfleri büyük ("Hey Jarvis"). */
  wake: string;
  /** Asistanın adı (politikadan). */
  name: string;
  setCore(state: CoreState): void;
  setSay(text: string | null): void;
  setBusy(busy: boolean): void;
  /** Bu ekran geçilebilir bir sınamadır ve henüz sonuçlanmadı: alttaki düğme "Şimdilik geç" olur. */
  setSkippable(skippable: boolean): void;
  launchAtLogin: boolean;
  setLaunchAtLogin(value: boolean): void;
  userName: string;
  setUserName(value: string): void;
  address: string | null;
  setAddress(value: string | null): void;
}

/** Görünen hitap: seçilmişse o, yoksa politikanın varsayılanı ("efendim"). */
const addressOf = (ctx: StepContext) => ctx.address?.trim() || ctx.shared.policy?.persona.address || 'efendim';

/** İsteğe bağlı sınama adımlarının ortak kuralı: sonuç alınana dek alttaki düğme "Şimdilik geç"tir. */
function useSkippable(ctx: StepContext, finished: boolean) {
  useEffect(() => {
    ctx.setSkippable(!finished);
  }, [finished]);
}

/** Pano içindeki kart: arkadan ışık alan tek yüzey. */
function Card({ children, className, testId, ...rest }: { children: ReactNode; className?: string; testId?: string } & Record<`data-${string}`, string | undefined>) {
  return (
    <div className={cn('setup-card', className)} data-testid={testId} {...rest}>
      {children}
    </div>
  );
}

/** Canlı dalga: yalnız gerçek sinyal varken (`active`) oynar; boşta durağan bir biçimde bekler (döngü yok). */
function LiveWave({ active, getLevel, height, bars = 40, gain = 4 }: { active: boolean; getLevel: () => number; height: number; bars?: number; gain?: number }) {
  const idle = useRef(Array.from({ length: bars }, (_, i) => 0.1 + 0.08 * Math.abs(Math.sin(i * 0.9))));
  const [levels, setLevels] = useState<number[]>(idle.current);
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    let last = 0;
    const buffer = [...idle.current];
    const loop = (now: number) => {
      if (now - last > 33) {
        last = now;
        buffer.push(Math.min(1, getLevel() * gain));
        buffer.splice(0, buffer.length - bars);
        setLevels([...buffer]);
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [active]);
  return <Waveform levels={levels} bars={bars} height={height} tone={active ? 'fg' : 'muted'} className="w-full" />;
}

// ───────────────────────────── 1 · karşılama ─────────────────────────────

export function WelcomeStep({ ctx }: { ctx: StepContext }) {
  // Varlık, selam ve tek cümle panonun ortasındadır (sihirbazın kendisi çizer); burada yalnız tarih ve saat.
  const clock = useClock();
  return (
    <div className="setup-stack">
      <Heading title={t('setup.welcome.title', { name: ctx.name })}>
        <p>{t('setup.welcome.body', { wake: ctx.wake })}</p>
      </Heading>
      <p className="flex items-start gap-3 text-base text-fg [&_svg]:mt-1 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-fg-muted" {...stagger(2)}>
        <LockKey weight="bold" aria-hidden />
        <span>{t('setup.welcome.privacy')}</span>
      </p>
      <Preview kind="welcome" caption={clock}>
        <span />
      </Preview>
    </div>
  );
}

// ───────────────────────────── 2 · Fuber Yönetim ve beyin ─────────────────────────────

/** Özetteki kısa beyin adı: "Claude Code" · "Bulut" · "Bu bilgisayar". */
export function brainName(brain: BrainStatus | null): string {
  if (!brain) return '…';
  if (brain.provider === 'cloud') return brain.cloud?.provider === 'claude-code' ? t('setup.preview.brain.cc') : (brain.cloud?.name ?? t('setup.preview.brain.cloud'));
  if (brain.provider === 'local') return t('setup.preview.brain.local');
  return '…';
}

export function ConnectStep({ ctx }: { ctx: StepContext }) {
  const { control, policy } = ctx.shared;
  const [launching, setLaunching] = useState(false);
  const [launchMessage, setLaunchMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    ctx.setCore(control === null ? 'thinking' : 'idle');
  }, [control === null]);

  // Yönetim açılınca bağlantıyı birkaç kez dener; servis kendisi de yoklar.
  useEffect(() => {
    if (!launching) return;
    let tries = 0;
    const timer = setInterval(() => {
      tries++;
      void quiet(window.fuber.invoke('control.connect', {}));
      if (tries >= 8) {
        clearInterval(timer);
        setLaunching(false);
      }
    }, 2500);
    return () => clearInterval(timer);
  }, [launching]);

  const openAdmin = async () => {
    try {
      const result = await window.fuber.invoke('control.launchAdmin');
      setLaunchMessage({ ok: result.ok, text: result.message });
      if (result.ok) setLaunching(true);
    } catch (error) {
      setLaunchMessage({ ok: false, text: (error as Error).message });
    }
  };

  // Hangi beyinle çalışılacağı tahmin edilmez: ana sürecin bildirdiği durum (`app.status.brain`) gösterilir.
  const current = ctx.shared.brain;
  const brain = (() => {
    if (!current) return t('setup.connect.brainChecking');
    if (current.provider === 'cloud') return policy?.brain.localFallback === 'off' ? t('setup.connect.brainCloudOnly') : t('setup.connect.brainCloud');
    if (current.provider === 'local') {
      if (current.reason === 'policy_local') return t('setup.connect.brainLocal');
      if (current.reason === 'cloud_down') {
        return current.cause === 'billing' ? t('setup.connect.brainBilling') : current.cause === 'auth' ? t('setup.connect.brainAuth') : t('setup.connect.brainCloudDown');
      }
      return control?.state === 'approved' ? t('setup.connect.brainNoKey') : t('setup.connect.brainOffline');
    }
    if (current.reason === 'kill_switch') return current.message ?? t('brain.error.killSwitch');
    // Ne bulut ne yerel: yerel dil modeli henüz yerleşmedi (modeller adımında hazırlanır).
    return t('setup.connect.brainPending');
  })();

  let status: ReactNode;
  if (!control) {
    status = (
      <Notice tone="neutral" icon={<Spinner size={14} label={null} />}>
        {t('setup.connect.checking')}
      </Notice>
    );
  } else if (control.state === 'approved') {
    status = (
      <Notice tone="success" icon={<CheckCircle weight="fill" />} testId="setup-connect-status">
        {t('setup.connect.approved')}
      </Notice>
    );
  } else if (control.state === 'pending') {
    status = (
      <Notice tone="warning" icon={<Info weight="bold" />} testId="setup-connect-status">
        {t('setup.connect.pending')}
      </Notice>
    );
  } else if (control.state === 'revoked') {
    status = (
      <Notice tone="danger" icon={<WarningCircle weight="bold" />} testId="setup-connect-status">
        {t('setup.connect.revoked')}
      </Notice>
    );
  } else {
    status = (
      <Notice tone="warning" icon={<WarningCircle weight="bold" />} testId="setup-connect-status">
        {t('setup.connect.offline')} {t('setup.connect.offlineHint')}
      </Notice>
    );
  }

  const connected = control?.state === 'approved';
  const adminState = !control ? 'checking' : control.state === 'approved' ? 'approved' : control.state === 'pending' ? 'pending' : control.state === 'revoked' ? 'revoked' : 'offline';
  return (
    <div className="setup-stack">
      <Heading title={t('setup.connect.title')}>
        <p>{t('setup.connect.body')}</p>
      </Heading>
      <div className="flex flex-col gap-3.5" {...stagger(2)}>
        {status}
        <div className="flex items-start gap-2.5 text-sm [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0" data-testid="setup-brain">
          <span className="contents text-fg-faint" aria-hidden>
            {current?.provider === 'cloud' ? <Cloud weight="bold" /> : <Desktop weight="bold" />}
          </span>
          <p className="text-fg-muted" data-brain={current?.provider ?? 'unknown'} data-reason={current?.reason}>
            {brain}
          </p>
        </div>
      </div>
      {control && !connected ? (
        <div className="flex flex-wrap items-center gap-3" {...stagger(3)}>
          <RunButton variant="primary" running={launching} runningLabel={t('setup.connect.opening')} onRun={() => void openAdmin()} testId="setup-open-admin">
            {t('setup.connect.openAdmin')}
          </RunButton>
          {launchMessage && !launchMessage.ok ? <span className="text-sm text-fg-muted">{launchMessage.text}</span> : null}
        </div>
      ) : null}
      <Preview kind="connect" caption={t('setup.preview.brain.caption')}>
        <div className="flex w-full flex-col items-center gap-5">
          <span className="setup-pill" data-state={adminState}>
            <i aria-hidden />
            {t(`setup.preview.admin.${adminState}`)}
          </span>
          <Card testId="setup-preview-brain">
            <p className="text-sm font-medium text-fg-muted">{t('setup.preview.brain.title')}</p>
            <div className="flex items-start gap-3">
              <span className="setup-list-icon" aria-hidden>
                {current?.provider === 'cloud' ? <Cloud weight="bold" /> : <Desktop weight="bold" />}
              </span>
              <span className="flex min-w-0 flex-col gap-1">
                <span className="text-lg font-semibold text-fg">{brainName(current)}</span>
                <span className="text-sm text-fg-muted">{brain}</span>
              </span>
            </div>
          </Card>
        </div>
      </Preview>
    </div>
  );
}

// ───────────────────────────── 3 · mikrofon ─────────────────────────────

export function MicrophoneStep({ ctx }: { ctx: StepContext }) {
  const { voice } = ctx.shared;
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<MicTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const percent = useRef<HTMLSpanElement>(null);
  /** Sınama boyunca görülen en yüksek düzey: sınama bitince çubukta iz olarak kalır. */
  const peak = useRef(0);
  const ready = voice?.ready ?? false;

  // Sınama sürerken düzey çubuğu genliği izler (React çizimi olmadan).
  useEffect(() => {
    if (!testing) return;
    let frame = 0;
    const loop = () => {
      const value = Math.min(1, ctx.shared.level.current * 4);
      peak.current = Math.max(peak.current, value);
      if (bar.current) bar.current.style.transform = `scaleX(${value})`;
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [testing]);

  const start = async () => {
    peak.current = 0;
    if (percent.current) percent.current.textContent = '';
    setTesting(true);
    setResult(null);
    setError(null);
    ctx.setBusy(true);
    ctx.setCore('listening');
    ctx.setSay(t('setup.mic.listening'));
    try {
      const settings = await window.fuber.invoke('settings.get');
      const outcome = await window.fuber.invoke('setup.testMic', { deviceId: settings.inputDeviceId, seconds: 4 });
      setResult(outcome);
      if (bar.current) bar.current.style.transform = `scaleX(${peak.current})`;
      if (percent.current) percent.current.textContent = peak.current > 0 ? t('setup.mic.peak', { pct: Math.round(peak.current * 100) }) : '';
      ctx.setCore(outcome.ok ? 'idle' : 'error');
      ctx.setSay(outcome.ok && outcome.speechDetected ? t('setup.mic.heard') : null);
    } catch (reason) {
      setError((reason as Error).message);
      ctx.setCore('error');
      ctx.setSay(null);
    } finally {
      setTesting(false);
      ctx.setBusy(false);
    }
  };

  const failed = error ?? (result && !result.ok ? result.error : null);
  const passed = result?.ok === true && result.speechDetected;
  // Sınama geçene dek adımın asıl eylemi kendi düğmesidir; alttaki düğme "Şimdilik geç" olarak geri planda durur.
  useSkippable(ctx, passed);
  const device = result?.deviceLabel || voice?.inputDeviceLabel || null;
  return (
    <div className="setup-stack">
      <Heading title={t('setup.mic.title')}>
        <p>{t('setup.mic.body')}</p>
      </Heading>
      {/* Sonuç düğmenin hemen üstünde, sabit yuvada çıkar: düğme hâlden hâle yerinden oynamaz. */}
      <div className="flex min-h-6 flex-col gap-2" {...stagger(2)}>
        {!ready && !testing ? (
          <Notice tone="neutral" icon={<Spinner size={14} label={null} />} testId="setup-mic-waiting">
            {voice?.notReadyReason ?? t('setup.mic.waiting')}
          </Notice>
        ) : null}
        {result?.ok && result.speechDetected ? (
          <Notice tone="success" icon={<CheckCircle weight="fill" />} testId="setup-mic-result">
            {t('setup.mic.ok')} {result.transcript ? t('setup.mic.heardWords', { text: result.transcript }) : null}
          </Notice>
        ) : null}
        {result?.ok && !result.speechDetected ? (
          <Notice tone="warning" icon={<WarningCircle weight="bold" />} testId="setup-mic-result">
            {t('setup.mic.quiet')}
          </Notice>
        ) : null}
        {failed ? (
          <Notice tone="danger" icon={<WarningCircle weight="bold" />} testId="setup-mic-result">
            {failed}
          </Notice>
        ) : null}
      </div>
      <div className="flex items-center gap-3" {...stagger(3)}>
        <RunButton
          variant={passed ? 'secondary' : 'primary'}
          icon={<Microphone weight="bold" />}
          running={testing}
          runningLabel={t('setup.mic.running')}
          onRun={() => void start()}
          disabled={!ready}
          testId="setup-mic-start"
        >
          {result || failed ? t('setup.mic.again') : t('setup.mic.start')}
        </RunButton>
      </div>
      {failed || (result?.ok && !result.speechDetected) ? (
        <div className="flex flex-col gap-1 border-t border-line pt-3 text-sm" data-testid="setup-mic-help">
          <p className="font-medium text-fg">{t('setup.mic.help.title')}</p>
          <ul className="flex list-disc flex-col pl-4 text-fg-muted">
            <li>{t('setup.mic.help.1')}</li>
            <li>{t('setup.mic.help.2')}</li>
            <li>{t('setup.mic.help.3')}</li>
          </ul>
        </div>
      ) : null}
      <Preview kind="microphone" caption={device ? t('setup.mic.device', { device }) : t('setup.preview.mic.defaultDevice')}>
        <Card testId="setup-preview-mic" data-testing={testing ? 'true' : 'false'}>
          <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-2 text-base font-medium text-fg">
              <Microphone weight="bold" className="size-4 text-fg-muted" aria-hidden />
              {t('setup.mic.level')}
            </span>
            <span ref={percent} className="shrink-0 text-sm text-fg-muted tabular-nums" aria-hidden />
          </div>
          <LiveWave active={testing} getLevel={() => ctx.shared.level.current} height={120} bars={40} />
          <div className="h-2 overflow-hidden rounded-full bg-surface-4 shadow-[inset_0_0_0_1px_var(--color-line-strong)]" aria-hidden>
            <div ref={bar} className="setup-level h-full w-full rounded-full bg-fg" style={{ transform: 'scaleX(0)' }} data-testid="setup-mic-level" />
          </div>
          <p className={cn('min-h-14 text-xl', passed ? 'text-fg' : 'text-fg-muted')} data-testid="setup-preview-heard">
            {passed && result?.transcript ? t('setup.mic.heardWords', { text: result.transcript }) : testing ? t('setup.mic.listening') : t('setup.preview.mic.idle')}
          </p>
        </Card>
      </Preview>
    </div>
  );
}

// ───────────────────────────── 4 · yerel modeller ─────────────────────────────

const statusTone: Record<RoleSummary['status'], Tone> = {
  ready: 'success',
  missing: 'warning',
  queued: 'neutral',
  downloading: 'accent',
  verifying: 'accent',
  failed: 'danger',
};

export function ModelsStep({ ctx }: { ctx: StepContext }) {
  const rows = summarize(ctx.shared.models);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const working = rows.some((row) => row.status === 'downloading' || row.status === 'verifying' || row.status === 'queued');
  const missing = rows.some((row) => row.status === 'missing' || row.status === 'failed');
  const allReady = rows.length > 0 && rows.every((row) => row.status === 'ready');
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  const have = rows.reduce((sum, row) => sum + (row.status === 'ready' ? row.total : Math.min(row.received, row.total)), 0);
  const missingCount = rows.filter((row) => row.status === 'missing' || row.status === 'failed').length;

  useEffect(() => {
    ctx.setCore(working ? 'thinking' : 'idle');
  }, [working]);
  useEffect(() => {
    ctx.setSay(allReady ? t('setup.models.sayReady') : null);
  }, [allReady]);

  const prepare = async () => {
    setStarting(true);
    setError(null);
    try {
      await window.fuber.invoke('setup.downloadModels', {});
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setStarting(false);
    }
  };

  const impact = (role: string) =>
    ['stt', 'tts', 'llm', 'vad', 'wake'].includes(role)
      ? t(`setup.models.impact.${role}`, { wake: ctx.wake, hotkey: ctx.shared.talkKeys.join('+') })
      : t('setup.models.impact.other');
  const statusText = (row: RoleSummary) =>
    row.status === 'downloading'
      ? t('setup.models.status.downloading', { pct: row.total ? Math.floor((row.received / row.total) * 100) : 0 })
      : t(`setup.models.status.${row.status}`);

  return (
    <div className="setup-stack">
      <Heading title={t('setup.models.title')}>
        <p>{t('setup.models.body')}</p>
      </Heading>
      {/* Model satırları: ne, ne kadar yer tutuyor, ne durumda. Hazır olan sakin kalır; rengi yalnız sorun ve indirme taşır. */}
      <ul className="setup-list" data-testid="setup-models" {...stagger(2)}>
        {rows.map((row) => (
          <li key={row.role} className="flex flex-col gap-2 px-4 py-2.5" data-role={row.role} data-status={row.status}>
            <div className="grid grid-cols-[minmax(0,1fr)_72px_minmax(96px,auto)] items-center gap-3">
              <span className="truncate text-base text-fg">{roleLabel(row.role)}</span>
              <span className="text-right text-sm text-fg-muted tabular-nums">{formatSize(row.total)}</span>
              {row.status === 'ready' ? (
                <span className="flex items-center justify-end gap-1.5 text-sm text-fg-muted [&_svg]:size-4 [&_svg]:text-success">
                  <CheckCircle weight="fill" aria-hidden />
                  {statusText(row)}
                </span>
              ) : (
                <span className="flex justify-end">
                  <Badge tone={statusTone[row.status]} dot>
                    {statusText(row)}
                  </Badge>
                </span>
              )}
            </div>
            {row.status === 'downloading' || row.status === 'verifying' ? <ProgressBar value={row.total ? row.received / row.total : 0} size="sm" /> : null}
            {row.status === 'missing' || row.status === 'failed' ? (
              <p className="text-xs text-fg-muted">
                {row.error ? `${row.error} ` : ''}
                {impact(row.role)}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="flex min-h-9 items-center gap-3" {...stagger(3)}>
        {missing ? (
          <RunButton variant="primary" running={starting} runningLabel={t('setup.working')} onRun={() => void prepare()} testId="setup-models-prepare">
            {rows.some((row) => row.status === 'failed') ? t('setup.retry') : t('setup.models.prepare')}
          </RunButton>
        ) : null}
        {allReady ? (
          <Notice tone="neutral" testId="setup-models-ready">
            {t('setup.models.allReady', { count: rows.length, size: formatSize(total) })}
          </Notice>
        ) : null}
        {error ? (
          <Notice tone="danger" icon={<WarningCircle weight="bold" />}>
            {error}
          </Notice>
        ) : null}
      </div>
      <Preview kind="models" caption={t('setup.preview.models.caption')}>
        <div className="flex flex-col items-center gap-7" data-testid="setup-preview-models">
          <ProgressRing value={total ? have / total : 0} size={196} thickness={10} tone={allReady ? 'success' : 'accent'} label={t('setup.models.title')}>
            <span className="flex flex-col items-center gap-1">
              <span className="text-3xl font-semibold text-fg tabular-nums">{rows.length ? t('setup.preview.models.count', { count: rows.length }) : '…'}</span>
              <span className="text-sm text-fg-muted">
                {!rows.length
                  ? t('setup.preview.models.empty')
                  : allReady
                    ? t('setup.preview.models.ready')
                    : missingCount && !working
                      ? t('setup.preview.models.missing', { count: missingCount })
                      : `${t('setup.preview.models.working')} · %${total ? Math.floor((have / total) * 100) : 0}`}
              </span>
            </span>
          </ProgressRing>
          <p className="text-sm text-fg-muted tabular-nums">{rows.length ? t('setup.preview.models.size', { size: formatSize(total) }) : ' '}</p>
          <ul className="setup-role-chips">
            {rows.map((row) => (
              <li key={row.role} data-status={row.status}>
                {row.status === 'ready' ? <CheckCircle weight="fill" aria-hidden /> : <i aria-hidden />}
                {roleLabel(row.role)}
              </li>
            ))}
          </ul>
        </div>
      </Preview>
    </div>
  );
}

// ───────────────────────────── 5 · uyandırma alıştırması ─────────────────────────────

export function WakeStep({ ctx }: { ctx: StepContext }) {
  const test = useWakeCalibration(3);
  const ready = ctx.shared.voice?.ready ?? false;
  const running = test.phase === 'running';
  const ok = test.phase === 'done' && test.result?.ok === true;
  useSkippable(ctx, ok);

  useEffect(() => {
    ctx.setBusy(running);
    if (running) {
      ctx.setCore('listening');
      ctx.setSay(t('setup.wake.listening'));
    } else if (test.phase === 'done') {
      ctx.setCore('idle');
      ctx.setSay(ok ? t('setup.wake.done') : null);
    } else if (test.phase === 'failed') {
      ctx.setCore('error');
      ctx.setSay(null);
    }
  }, [test.phase]);

  const tried = test.phase === 'done' || test.phase === 'failed';
  return (
    <div className="setup-stack" data-testid="setup-wake" data-phase={test.phase}>
      <Heading title={t('setup.wake.title')}>
        <p>{t('setup.wake.body', { wake: ctx.wake })}</p>
      </Heading>
      {/* Sabit durum yuvası: yönerge ve sonuç burada çıkar; düğme hâlden hâle yerinden oynamaz. */}
      <div className="flex min-h-12 flex-col justify-center gap-2" {...stagger(2)}>
        {running ? (
          <p className="text-lg text-fg" data-testid="setup-wake-prompt">
            {test.samples.includes('retry') ? t('setup.wake.again') : t('setup.wake.prompt', { wake: ctx.wake })}
          </p>
        ) : !ready ? (
          <Notice tone="neutral" icon={<Spinner size={14} label={null} />} testId="setup-wake-waiting">
            {ctx.shared.voice?.notReadyReason ?? t('setup.mic.waiting')}
          </Notice>
        ) : test.phase === 'done' && test.result ? (
          <Notice tone={ok ? 'success' : 'warning'} icon={ok ? <CheckCircle weight="fill" /> : <WarningCircle weight="bold" />} testId="setup-wake-result">
            {test.result.message}
          </Notice>
        ) : test.phase === 'failed' ? (
          <Notice tone="danger" icon={<WarningCircle weight="bold" />} testId="setup-wake-result">
            {test.error}
          </Notice>
        ) : null}
      </div>
      <div className="flex items-center gap-3" {...stagger(3)}>
        <RunButton variant={ok ? 'secondary' : 'primary'} running={running} runningLabel={t('setup.wake.running')} onRun={test.start} disabled={!ready} testId="setup-wake-start">
          {tried ? t('setup.wake.restart') : t('setup.wake.start')}
        </RunButton>
      </div>
      <Preview kind="wake" caption={t('setup.preview.wake.caption')}>
        <div className="flex flex-col items-center gap-9" data-testid="setup-preview-wake">
          <p className="setup-wake-phrase" data-running={running || ok ? 'true' : 'false'}>
            “{ctx.wake}”
          </p>
          {/* Üç örnek yuvası: birer durum göstergesi (seçenek değil). */}
          <ol className="setup-samples" data-testid="setup-wake-samples">
            {test.samples.map((sample, index) => (
              <li key={index} data-sample={sample}>
                <span className="setup-sample-dot" aria-hidden>
                  {sample === 'heard' ? <CheckCircle weight="fill" /> : sample === 'listening' ? <Spinner size={16} label={null} /> : <i />}
                </span>
                {t('setup.wake.sample', { n: index + 1 })}
              </li>
            ))}
          </ol>
        </div>
      </Preview>
    </div>
  );
}

// ───────────────────────────── 6 · yankı sınaması ─────────────────────────────

export function EchoStep({ ctx }: { ctx: StepContext }) {
  const test = useEchoTest();
  const ready = ctx.shared.voice?.ready ?? false;
  const running = test.phase === 'running';
  const measured = test.phase === 'done' && test.result?.ok === true;
  useSkippable(ctx, measured);

  useEffect(() => {
    ctx.setBusy(running);
    if (running) {
      ctx.setCore('speaking');
      ctx.setSay(t('setup.echo.running'));
    } else if (test.phase === 'done') {
      ctx.setCore('idle');
      ctx.setSay(measured ? (test.result?.leaked ? t('setup.echo.sayLeaked') : t('setup.echo.sayClean')) : null);
    } else if (test.phase === 'failed') {
      ctx.setCore('error');
      ctx.setSay(null);
    }
  }, [test.phase]);

  const tried = test.phase === 'done' || test.phase === 'failed';
  const outcome = running ? 'running' : measured ? (test.result?.leaked ? 'leaked' : 'clean') : tried ? 'failed' : 'idle';
  return (
    <div className="setup-stack" data-testid="setup-echo" data-phase={test.phase}>
      <Heading title={t('setup.echo.title')}>
        <p>{t('setup.echo.body', { wake: ctx.wake })}</p>
      </Heading>
      <div className="flex min-h-12 flex-col justify-center gap-2" {...stagger(2)}>
        {running ? (
          <p className="text-lg text-fg" data-testid="setup-echo-prompt">
            {t('setup.echo.prompt')}
          </p>
        ) : !ready ? (
          <Notice tone="neutral" icon={<Spinner size={14} label={null} />} testId="setup-echo-waiting">
            {ctx.shared.voice?.notReadyReason ?? t('setup.mic.waiting')}
          </Notice>
        ) : test.phase === 'done' && test.result ? (
          measured ? (
            <Notice tone={test.result.leaked ? 'warning' : 'success'} icon={test.result.leaked ? <Info weight="bold" /> : <CheckCircle weight="fill" />} testId="setup-echo-result">
              {test.result.leaked ? t('setup.echo.leaked', { wake: ctx.wake }) : t('setup.echo.clean')}
            </Notice>
          ) : (
            <Notice tone="warning" icon={<WarningCircle weight="bold" />} testId="setup-echo-result">
              {test.result.message}
            </Notice>
          )
        ) : test.phase === 'failed' ? (
          <Notice tone="danger" icon={<WarningCircle weight="bold" />} testId="setup-echo-result">
            {test.error}
          </Notice>
        ) : (
          <Notice tone="neutral" icon={<SpeakerHigh weight="bold" />}>
            {t('setup.echo.sound')}
          </Notice>
        )}
      </div>
      <div className="flex items-center gap-3" {...stagger(3)}>
        <RunButton variant={measured ? 'secondary' : 'primary'} running={running} runningLabel={t('setup.echo.busy')} onRun={test.start} disabled={!ready} testId="setup-echo-start">
          {tried ? t('setup.echo.restart') : t('setup.echo.start')}
        </RunButton>
      </div>
      <Preview kind="echo" caption={t('setup.preview.echo.caption')}>
        <div className="setup-echo" data-outcome={outcome} data-testid="setup-preview-echo">
          <span className="setup-echo-node">
            <span className="setup-echo-icon" aria-hidden>
              <SpeakerHigh weight="bold" />
            </span>
            {t('setup.preview.echo.speaker')}
          </span>
          <span className="setup-echo-link" aria-hidden>
            <i />
          </span>
          <span className="setup-echo-node">
            <span className="setup-echo-icon" aria-hidden>
              <Microphone weight="bold" />
            </span>
            {t('setup.preview.echo.mic')}
          </span>
          <span className="setup-pill setup-echo-state" data-state={outcome}>
            <i aria-hidden />
            {t(`setup.preview.echo.${outcome}`)}
          </span>
        </div>
      </Preview>
    </div>
  );
}

// ───────────────────────────── 7 · Windows'la başla ─────────────────────────────

export function AutostartStep({ ctx }: { ctx: StepContext }) {
  const on = ctx.launchAtLogin;
  return (
    <div className="setup-stack">
      <Heading title={t('setup.autostart.title')}>
        <p>{t('setup.autostart.body', { wake: ctx.wake })}</p>
      </Heading>
      <div className="flex flex-col gap-3.5" {...stagger(2)}>
        <div className="border-y border-line py-4">
          <Switch
            checked={ctx.launchAtLogin}
            onCheckedChange={ctx.setLaunchAtLogin}
            label={<span className="text-base text-fg">{t('setup.autostart.label')}</span>}
            data-testid="setup-autostart"
          />
        </div>
        <Notice tone="neutral" icon={<Info weight="bold" />}>
          {t('setup.autostart.later')}
        </Notice>
      </div>
      <Preview kind="autostart" caption={t('setup.preview.autostart.caption')}>
        <div className="setup-tray" data-on={on ? 'true' : 'false'} data-testid="setup-preview-autostart">
          <span className="setup-tray-icon" aria-hidden>
            <Power weight="bold" />
          </span>
          <span className="setup-pill" data-state={on ? 'on' : 'offline'}>
            <i aria-hidden />
            {on ? t('setup.preview.autostart.on') : t('setup.preview.autostart.off')}
          </span>
          <p className="max-w-[320px] text-center text-base text-fg-muted text-balance">
            {on ? t('setup.preview.autostart.line', { wake: ctx.wake }) : t('setup.preview.autostart.lineOff')}
          </p>
        </div>
      </Preview>
    </div>
  );
}

// ───────────────────────────── 8 · tanışma ─────────────────────────────

export function IntroStep({ ctx }: { ctx: StepContext }) {
  const base = ctx.shared.policy?.persona.address || 'efendim';
  const name = ctx.userName.trim();
  const options = [base, ...(name ? [t('setup.intro.bey', { name }), t('setup.intro.hanim', { name }), name] : [])];
  const custom = ctx.address !== null && !options.includes(ctx.address);
  const [customOpen, setCustomOpen] = useState(custom);
  const chosen = ctx.address ?? base;
  const clock = useClock();
  const address = addressOf(ctx);

  useEffect(() => {
    ctx.setSay(ctx.address ? t('setup.intro.say.named', { address: ctx.address }) : null);
  }, [ctx.address]);

  return (
    <div className="setup-stack">
      <Heading title={t('setup.intro.title')}>
        <p>{t('setup.intro.body')}</p>
      </Heading>
      <div className="flex flex-col gap-6" {...stagger(2)}>
        <Field label={t('setup.intro.name')}>
          <Input
            value={ctx.userName}
            onChange={(event) => ctx.setUserName(event.target.value)}
            placeholder={t('setup.intro.namePlaceholder')}
            autoFocus
            data-testid="setup-name"
          />
        </Field>
        <div className="flex flex-col gap-2.5">
          <p className="text-sm font-medium text-fg">{t('setup.intro.address')}</p>
          <div className="flex flex-wrap gap-2" data-testid="setup-address">
            {options.map((option) => (
              <Chip
                key={option}
                selected={!customOpen && chosen === option}
                onClick={() => {
                  setCustomOpen(false);
                  ctx.setAddress(option);
                }}
              >
                {option.charAt(0).toLocaleUpperCase('tr') + option.slice(1)}
              </Chip>
            ))}
            <Chip selected={customOpen} onClick={() => setCustomOpen(true)}>
              {t('setup.intro.custom')}
            </Chip>
          </div>
          {customOpen ? (
            <Input
              value={custom ? (ctx.address ?? '') : ''}
              onChange={(event) => ctx.setAddress(event.target.value || null)}
              placeholder={t('setup.intro.customPlaceholder')}
              autoFocus
              aria-label={t('setup.intro.custom')}
              data-testid="setup-address-custom"
            />
          ) : null}
        </div>
      </div>
      <Preview kind="intro" caption={t('setup.preview.today.caption')}>
        <Card testId="setup-preview-today">
          <div className="flex items-center justify-between gap-4 text-sm text-fg-muted">
            <span className="flex items-center gap-2 text-fg">
              <CalendarBlank weight="bold" className="size-4" aria-hidden />
              {t('nav.today')}
            </span>
            <span className="tabular-nums">{clock}</span>
          </div>
          <p className="setup-today-greet" data-testid="setup-preview-greeting">
            {greeting(address)}
          </p>
          <p className="text-base text-fg-muted">{t('setup.preview.today.line')}</p>
          <div className="setup-tiles">
            <span>
              <Clock weight="bold" aria-hidden />
              <b>09:30</b>
              {t('setup.preview.today.meeting')}
            </span>
            <span>
              <ListChecks weight="bold" aria-hidden />
              <b>3</b>
              {t('setup.preview.today.todos')}
            </span>
            <span>
              <Bell weight="bold" aria-hidden />
              <b>1</b>
              {t('setup.preview.today.reminders')}
            </span>
          </div>
        </Card>
      </Preview>
    </div>
  );
}

// ───────────────────────────── 9 · hazır ─────────────────────────────

export function ReadyStep({ ctx }: { ctx: StepContext }) {
  const { voice, voiceState, talkKeys } = ctx.shared;
  const [heard, setHeard] = useState(false);
  const seen = useRef(voiceState);

  // Uyanma: bu ekrandayken ses durumu dinlemeye geçti. Kutlama yok; sakin bir onay.
  useEffect(() => {
    if (voiceState !== seen.current && (voiceState === 'listening' || voiceState === 'thinking' || voiceState === 'speaking')) setHeard(true);
    seen.current = voiceState;
  }, [voiceState]);
  useEffect(() => {
    ctx.setSay(heard ? t('setup.ready.here') : null);
  }, [heard]);

  const address = addressOf(ctx);
  const [before, after] = t('setup.ready.body', { wake: ctx.wake, hotkey: '\u0000' }).split('\u0000');
  const awake = voiceState === 'listening' || voiceState === 'thinking' || voiceState === 'speaking';
  const rows = [
    { key: 'address', value: address.charAt(0).toLocaleUpperCase('tr') + address.slice(1) },
    { key: 'brain', value: brainName(ctx.shared.brain) },
    { key: 'autostart', value: ctx.launchAtLogin ? t('setup.preview.summary.on') : t('setup.preview.summary.off') },
  ];
  return (
    <div className="setup-stack">
      <Heading title={t('setup.ready.title')}>
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1" data-testid="setup-ready-hint">
          <span>{before}</span>
          <KeyHint keys={talkKeys} />
          <span>{after}</span>
        </p>
      </Heading>
      {/* Durum satırının yeri sabittir: duyulunca içerik yerinden oynamaz. */}
      <div className="min-h-5" {...stagger(2)}>
        {heard ? (
          <Notice tone="success" icon={<CheckCircle weight="fill" />} testId="setup-ready-heard">
            {t('setup.ready.heard')}
          </Notice>
        ) : voice && !voice.ready ? (
          <Notice tone="neutral" icon={<Spinner size={14} label={null} />}>
            {voice.notReadyReason ?? t('setup.ready.notReady')}
          </Notice>
        ) : (
          <Notice tone="neutral" icon={<Info weight="bold" />}>
            {t('setup.ready.waiting')}
          </Notice>
        )}
      </div>
      <div className="flex flex-col gap-2.5" {...stagger(3)}>
        <p className="text-sm text-fg-muted">{t('setup.ready.try')}</p>
        <ul className="flex flex-col gap-2" data-testid="setup-ready-examples">
          {(['1', '2', '3'] as const).map((n) => (
            <li key={n} className="setup-example">
              {t(`setup.ready.example.${n}`)}
            </li>
          ))}
        </ul>
      </div>
      <Preview kind="ready" caption={t('setup.preview.summary.caption')}>
        <Card testId="setup-preview-summary">
          <div className="flex items-center justify-between gap-4">
            <p className="text-xl font-semibold text-fg">{t('setup.preview.summary.title')}</p>
            <Badge tone={awake ? 'accent' : 'success'} dot>
              {awake ? t('setup.ready.here') : t('setup.preview.summary.ready')}
            </Badge>
          </div>
          <dl className="setup-facts">
            {rows.map((row) => (
              <div key={row.key} data-fact={row.key}>
                <dt>{t(`setup.preview.summary.${row.key}`)}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </Preview>
    </div>
  );
}
