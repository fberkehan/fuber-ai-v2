// Sol menünün altındaki "Hızlı kontrol" (d10). Kullanıcı isteği: "Sen çok konuşuyorsun. Bazen seni susturmak, bazen
// dinleme süreni uzatmak, saçma sapan şeyleri dinlememen için anlık susturmak, ortam dinlemeni ve mikrofonu açıp kapatmak
// istiyorum. Bunları sol panelde anlık görmek istiyorum; şu an illa ayarlara girmem gerekiyor."
// Durum her zaman ana süreçten gelir (`voice.status`, `settings.changed`, `ambient.status`): sesle, Ayarlar'dan ya da
// tepsiden değişen durum düğmelere kendiliğinden yansır. Düğmeler var olan kanalları çağırır; yeni kanal yalnız ikidir
// (`voice.pauseListening`, `attention.hush`).
import { useEffect, useState, type ReactNode } from 'react';
import { BellSimpleSlash, Ear, EarSlash, Microphone, MicrophoneSlash, SpeakerHigh, SpeakerSlash, Waveform } from '@phosphor-icons/react';
import { effectiveFollowUpSeconds, FOLLOW_UP_STEPS, t } from '@fuber/shared';
import { cn, Tooltip } from '@fuber/ui';
import { isListeningPaused } from '../../../main/voice/quick';
import { useAmbientStatus } from '../pages/memory/ambient/data';
import { requestSettingsTab } from '../pages/settings/navigate';
import { useShell } from './context';
import { attempt, useEvent } from './live';

/** Adada/çentikte görünen bildirimin ömrü (adanın eylemli kartı en çok 30 sn kalır; pay ile). */
const NOTICE_VISIBLE_MS = 35_000;

type Tone = 'on' | 'off' | 'warn' | 'danger';

const toneClass: Record<Tone, string> = {
  on: 'bg-accent-soft text-accent-fg hover:bg-accent-soft/80',
  off: 'text-fg-muted hover:bg-surface-2 hover:text-fg',
  warn: 'bg-warning-soft text-warning hover:bg-warning-soft/80',
  danger: 'bg-danger-soft text-danger hover:bg-danger/20',
};

interface ToggleProps {
  testId: string;
  label: string;
  hint: string;
  icon: ReactNode;
  tone: Tone;
  /** Açık/kapalı düğmede `aria-pressed`; eylem düğmesinde verilmez. */
  pressed?: boolean;
  disabled?: boolean;
  collapsed: boolean;
  onClick(): void;
}

/** Tek düğme: genişken simge + kısa ad (iki sütun), daraltılınca yalnız simge. Dokunma alanı en az 36 px. */
function Control({ testId, label, hint, icon, tone, pressed, disabled, collapsed, onClick }: ToggleProps) {
  return (
    <Tooltip content={hint} placement="right">
      <button
        type="button"
        data-testid={testId}
        data-tone={tone}
        aria-label={collapsed ? label : undefined}
        aria-pressed={pressed}
        aria-disabled={disabled || undefined}
        onClick={() => {
          if (!disabled) onClick();
        }}
        className={cn(
          'flex h-9 min-w-0 cursor-pointer items-center gap-2 rounded-sm text-sm font-medium outline-offset-[-2px]',
          'transition-[background-color,color,transform] duration-(--duration-fast) ease-out active:scale-[0.97] [&_svg]:size-[18px] [&_svg]:shrink-0',
          collapsed ? 'w-full justify-center' : 'px-2.5',
          disabled ? 'cursor-default text-fg-faint active:scale-100' : toneClass[tone],
        )}
      >
        {icon}
        {!collapsed && <span className="truncate">{label}</span>}
      </button>
    </Tooltip>
  );
}

/** Adada/çentikte o an görünen bildirim var mı (sesli, adalık ya da kart). Kapanınca ya da süresi dolunca düşer. */
function useVisibleNotices(): boolean {
  const [shown, setShown] = useState<Map<string, number>>(new Map());
  useEvent('attention.notify', ({ notification, channel }) => {
    if (channel === 'today') return;
    setShown((current) => new Map(current).set(notification.id, Date.now()));
  });
  useEvent('attention.dismiss', ({ id }) =>
    setShown((current) => {
      if (!current.has(id)) return current;
      const next = new Map(current);
      next.delete(id);
      return next;
    }),
  );
  useEffect(() => {
    if (shown.size === 0) return;
    const oldest = Math.min(...shown.values());
    const timer = setTimeout(() => {
      const now = Date.now();
      setShown((current) => new Map([...current].filter(([, at]) => now - at < NOTICE_VISIBLE_MS)));
    }, Math.max(0, oldest + NOTICE_VISIBLE_MS - Date.now()) + 50);
    return () => clearTimeout(timer);
  }, [shown]);
  return shown.size > 0;
}

export function QuickControls({ collapsed }: { collapsed: boolean }) {
  const shell = useShell();
  const { voice, settings, policy } = shell;
  const ambient = useAmbientStatus();
  const notices = useVisibleNotices();
  // Duraklatma süresi dolunca ana süreç durum yayınlar; yine de saat ilerledikçe düğme yeniden hesaplanır.
  const [, tick] = useState(0);
  const pausedUntil = voice?.wakePausedUntil ?? null;
  useEffect(() => {
    if (!pausedUntil) return;
    const left = Date.parse(pausedUntil) - Date.now();
    if (!(left > 0)) return;
    const timer = setTimeout(() => tick((value) => value + 1), Math.min(left + 50, 2 ** 31 - 1));
    return () => clearTimeout(timer);
  }, [pausedUntil]);

  const wake = shell.wakePhrase;
  const micMuted = voice?.micMuted ?? false;
  const paused = isListeningPaused(voice);
  const quiet = voice?.quiet ?? false;
  const state = voice?.state ?? 'idle';
  const canHush = notices || state === 'speaking' || state === 'followup';

  const ambientAllowed = policy?.ambient.allowed ?? false;
  const ambientConsented = Boolean(ambient.status?.consentAt);
  const ambientOn = ambient.status !== null && ambientConsented && ambient.status.prefs.enabled;
  const ambientBlocked = !ambient.moduleOn ? t('nav.quick.ambientModuleHint') : !ambientAllowed ? t('nav.quick.ambientPolicyHint') : null;

  const policySeconds = policy?.voice.followUpSeconds ?? null;
  const own = settings?.followUpSeconds ?? null;
  const seconds = policy && settings ? effectiveFollowUpSeconds(settings, policy) : (own ?? policySeconds ?? FOLLOW_UP_STEPS[0]);
  const setFollowUp = (next: number) => void attempt(() => window.fuber.invoke('settings.update', { patch: { followUpSeconds: next } }));
  const nextStep = FOLLOW_UP_STEPS.find((step) => step > seconds) ?? FOLLOW_UP_STEPS[0];

  const toggleAmbient = () => {
    if (ambientBlocked || !ambient.status) return;
    if (!ambientConsented) {
      // Rıza yalnız Ayarlar'daki açıklamalı kutudan verilir.
      requestSettingsTab('privacy');
      shell.navigate('settings');
      return;
    }
    void attempt(() => window.fuber.invoke('ambient.setPrefs', { patch: { enabled: !ambientOn } }));
  };

  const controls = (
    <>
      <Control
        testId="quick-mic"
        label={t('nav.quick.mic')}
        hint={micMuted ? t('nav.quick.micOffHint') : t('nav.quick.micOnHint')}
        icon={micMuted ? <MicrophoneSlash weight="fill" /> : <Microphone weight="fill" />}
        tone={micMuted ? 'danger' : 'on'}
        pressed={!micMuted}
        collapsed={collapsed}
        onClick={() => void attempt(() => window.fuber.invoke('voice.mute', { muted: !micMuted }))}
      />
      <Control
        testId="quick-pause"
        label={paused ? t('nav.quick.pausedLabel') : t('nav.quick.pause')}
        hint={paused ? t('nav.quick.pauseOffHint') : t('nav.quick.pauseOnHint', { wake })}
        icon={paused ? <EarSlash weight="fill" /> : <Ear weight="fill" />}
        tone={paused ? 'warn' : micMuted ? 'off' : 'on'}
        pressed={!paused}
        collapsed={collapsed}
        onClick={() => void attempt(() => window.fuber.invoke('voice.pauseListening', { paused: !paused }))}
      />
      <Control
        testId="quick-quiet"
        label={t('nav.quick.quiet')}
        hint={quiet ? t('nav.quick.quietOnHint') : t('nav.quick.quietOffHint')}
        icon={quiet ? <SpeakerSlash weight="fill" /> : <SpeakerHigh weight="fill" />}
        tone={quiet ? 'warn' : 'off'}
        pressed={quiet}
        collapsed={collapsed}
        onClick={() => void attempt(() => window.fuber.invoke('voice.setQuiet', { on: !quiet }))}
      />
      <Control
        testId="quick-ambient"
        label={t('nav.quick.ambient')}
        hint={ambientBlocked ?? (!ambientConsented ? t('nav.quick.ambientConsentHint') : ambientOn ? t('nav.quick.ambientOnHint') : t('nav.quick.ambientOffHint'))}
        icon={<Waveform weight={ambientOn ? 'fill' : 'regular'} />}
        tone={ambientOn ? 'on' : 'off'}
        pressed={ambientOn}
        disabled={ambientBlocked !== null || ambient.status === null}
        collapsed={collapsed}
        onClick={toggleAmbient}
      />
      <Control
        testId="quick-hush"
        label={t('nav.quick.hush')}
        hint={canHush ? t('nav.quick.hushHint') : t('nav.quick.hushIdleHint')}
        icon={<BellSimpleSlash weight="fill" />}
        tone={canHush ? 'danger' : 'off'}
        disabled={!canHush}
        collapsed={collapsed}
        onClick={() => void attempt(() => window.fuber.invoke('attention.hush', {}))}
      />
    </>
  );

  return (
    <section
      aria-label={t('nav.quick.title')}
      data-testid="quick-controls"
      data-collapsed={collapsed || undefined}
      className="mb-2 shrink-0 border-t border-line pt-2"
    >
      {!collapsed && <p className="mb-1.5 px-1.5 text-xs font-semibold tracking-wide text-fg-faint uppercase">{t('nav.quick.title')}</p>}
      <div className={cn('grid gap-1', collapsed ? 'grid-cols-1' : 'grid-cols-2')}>{controls}</div>
      {collapsed ? (
        <div className="mt-1">
          <Tooltip content={t('nav.quick.followUpCycleHint', { seconds })} placement="right">
            <button
              type="button"
              data-testid="quick-followup-cycle"
              data-seconds={seconds}
              aria-label={t('nav.quick.followUpCycleHint', { seconds })}
              onClick={() => setFollowUp(nextStep)}
              className="flex h-9 w-full cursor-pointer items-center justify-center rounded-sm text-sm font-semibold text-fg-muted tabular-nums outline-offset-[-2px] transition-colors duration-(--duration-fast) hover:bg-surface-2 hover:text-fg"
            >
              {seconds}s
            </button>
          </Tooltip>
        </div>
      ) : (
        <div className="mt-2" data-testid="quick-followup" data-seconds={seconds}>
          <Tooltip content={t('nav.quick.followUpHint', { wake })} placement="right">
            <p className="mb-1 flex items-baseline justify-between gap-2 px-1.5 text-xs text-fg-faint">
              <span className="font-semibold tracking-wide uppercase">{t('nav.quick.followUp')}</span>
              {!(FOLLOW_UP_STEPS as readonly number[]).includes(seconds) ? (
                // Kademe dışı değer (Yönetim'in 12 sn'si ya da sesle "15 saniye"): şu anki değer yazılır.
                <span className="truncate tabular-nums">{t('nav.quick.followUpStep', { seconds })}</span>
              ) : own !== null && policySeconds !== null && own !== policySeconds ? (
                <span className="truncate">{t('nav.quick.followUpPolicy', { seconds: policySeconds })}</span>
              ) : null}
            </p>
          </Tooltip>
          <div role="radiogroup" aria-label={t('nav.quick.followUp')} className="grid grid-cols-4 gap-1 rounded-sm bg-surface-2 p-0.5">
            {FOLLOW_UP_STEPS.map((step) => {
              const active = step === seconds;
              return (
                <button
                  key={step}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  data-testid={`quick-followup-${step}`}
                  onClick={() => setFollowUp(step)}
                  className={cn(
                    'h-8 cursor-pointer rounded-[calc(var(--radius-sm)-2px)] text-sm font-medium tabular-nums outline-offset-[-2px] transition-colors duration-(--duration-fast)',
                    active ? 'bg-accent-soft text-accent-fg shadow-[inset_0_0_0_1px_var(--color-line)]' : 'text-fg-muted hover:text-fg',
                  )}
                >
                  {step}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
