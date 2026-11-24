// Ortam dinleme kapısı. `full`: sekmede kayıt yokken sayfanın birincil kutusu (ne olduğu, tek eylem) ve bağlam
// sütununda "açıkken ne olur". `strip`: kayıt varken bağlam yüzeyinin son bölümü: tek satır durum ve eylem.
// Hâller `data.ts` › `GateState`.
import { useState, type ReactNode } from 'react';
import { LockKey, Pause, Play } from '@phosphor-icons/react';
import { t } from '@fuber/shared';
import { Badge, Button, IconButton, Panel, Skeleton, WorkspaceGrid, type Tone } from '@fuber/ui';
import { useShell } from '../../../shell/context';
import { attempt } from '../../../shell/live';
import type { AmbientStatus } from '../../../../../main/modules/ambient/types';
import { ContextCard, ContextSection } from '../page-parts';
import { ConsentDialog } from './ConsentDialog';
import type { GateState } from './data';

const enable = () => attempt(() => window.fuber.invoke('ambient.setPrefs', { patch: { enabled: true } }));
const resume = () => attempt(() => window.fuber.invoke('ambient.pause', { preset: null }));

interface GateText {
  /** Rozetteki kısa durum. */
  badge: string;
  title: string;
  body: string;
  tone: Tone;
}

function gateText(state: GateState, status: AmbientStatus | null, name: string): GateText {
  switch (state) {
    case 'module_off':
      return { badge: t('ambient.ui.gate.badge.off'), title: t('ambient.ui.gate.moduleOff.title'), body: t('ambient.ui.gate.moduleOff.body'), tone: 'neutral' };
    case 'policy':
      return { badge: t('ambient.ui.gate.badge.off'), title: t('ambient.ui.gate.policy.title'), body: t('ambient.ui.gate.policy.body'), tone: 'neutral' };
    case 'consent':
      return { badge: t('ambient.ui.gate.badge.off'), title: t('ambient.ui.gate.consent.title', { name }), body: t('ambient.ui.gate.consent.body', { name }), tone: 'warning' };
    case 'off': {
      const reason = status?.reason ?? 'disabled';
      return {
        badge: t(`ambient.reason.${reason}`),
        title: t('ambient.ui.gate.off.title', { reason: t(`ambient.reason.${reason}`) }),
        body: t(`ambient.ui.gate.off.${reason}`),
        tone: 'warning',
      };
    }
    case 'on':
      return { badge: t('ambient.reason.ok'), title: t('ambient.reason.ok'), body: t('ambient.ui.gate.on.body', { days: status?.limits.retentionDays ?? 7 }), tone: 'success' };
    default:
      return { badge: '', title: '', body: '', tone: 'neutral' };
  }
}

/** Kapı yüklenirken birincil kutunun biçiminde iskelet. */
export function AmbientSkeleton() {
  return (
    <Panel tone="lead" aria-busy aria-label={t('common.loading')}>
      <Skeleton className="h-5 w-40 rounded-full" />
      <Skeleton shape="text" lines={3} className="max-w-xl" />
      <Skeleton className="h-10 w-36 rounded-full" />
    </Panel>
  );
}

export function AmbientGate({
  state,
  status,
  variant,
  empty,
  extra,
}: {
  state: GateState;
  status: AmbientStatus | null;
  variant: 'full' | 'strip';
  /** Dinleme açıkken sekmenin kendi boş durum metni. */
  empty?: { icon?: ReactNode; title: string; body: string };
  /** `full`: birincil eylemin yanında ikinci eylem (ör. "Bugünün raporunu hazırla"). */
  extra?: ReactNode;
}) {
  const shell = useShell();
  const [consentOpen, setConsentOpen] = useState(false);
  if (state === 'loading') return variant === 'full' ? <AmbientSkeleton /> : null;

  const text = gateText(state, status, shell.name);
  const small = variant === 'strip';
  const action =
    state === 'consent' ? (
      <Button variant={small ? 'secondary' : 'primary'} size={small ? 'sm' : 'md'} onClick={() => setConsentOpen(true)} data-testid="ambient-consent-open">
        {t('ambient.ui.gate.consent.action')}
      </Button>
    ) : state === 'off' && status?.reason === 'disabled' ? (
      <Button variant={small ? 'secondary' : 'primary'} size={small ? 'sm' : 'md'} icon={<Play weight="fill" />} onClick={() => void enable()} data-testid="ambient-gate-enable">
        {t('ambient.ui.gate.enable')}
      </Button>
    ) : state === 'off' && status?.reason === 'paused' ? (
      <Button variant={small ? 'secondary' : 'primary'} size={small ? 'sm' : 'md'} icon={<Play weight="fill" />} onClick={() => void resume()} data-testid="ambient-gate-resume">
        {t('ambient.ui.resume')}
      </Button>
    ) : state === 'on' && small ? (
      <Button size="sm" variant="ghost" icon={<Pause />} onClick={() => void attempt(() => window.fuber.invoke('ambient.pause', { preset: '15m' }))} data-testid="ambient-gate-pause">
        {t('ambient.ui.gate.pause15')}
      </Button>
    ) : null;
  const dialog = <ConsentDialog open={consentOpen} status={status} onClose={() => setConsentOpen(false)} />;

  if (small) {
    // Tek satır: durum, eylem, gizlilik ayarları. Dinlemiyorsa nedeni altında bir satır yazar.
    return (
      <section className="ctx-section" aria-label={t('ambient.ui.gate.label')} data-testid="ambient-gate" data-state={state}>
        <div className="flex min-h-7 flex-wrap items-center gap-x-1.5 gap-y-1.5">
          <span className="mr-auto flex items-center" title={text.body}>
            <Badge tone={text.tone} dot>
              {text.badge}
            </Badge>
          </span>
          {action}
          <span className="-mr-1.5 flex">
            <IconButton icon={<LockKey />} label={t('ambient.ui.gate.settings')} size="sm" onClick={() => shell.navigate('settings')} data-testid="ambient-gate-settings" />
          </span>
        </div>
        {state !== 'on' && <p className="text-sm text-fg-muted">{text.body}</p>}
        {dialog}
      </section>
    );
  }

  const on = state === 'on' && empty;
  const points = ['notes', 'issues', 'reports'] as const;
  // Dolu hâlle aynı iskelet (rıza verilince yerleşim sıçramaz): birincil kutuda solda davet, sağda "açıkken ne olur";
  // bağlam sütununda gizlilik güvencesi. Modül kapalıyken de kalan kayıtlar Ayarlar › Gizlilik'ten silinir: bağlantı
  // her hâlde durur.
  return (
    <WorkspaceGrid
      asideWidth={348}
      aside={
        <ContextCard>
          <ContextSection title={t('ambient.ui.gate.privacy')}>
            <p className="text-sm text-fg">{t('ambient.ui.gate.what.privacy')}</p>
            <p className="text-sm text-fg-muted">{t('ambient.ui.gate.privacy.keep', { days: status?.limits.retentionDays ?? 7 })}</p>
            <div className="-ml-0.5 pt-1">
              <Button size="sm" icon={<LockKey />} onClick={() => shell.navigate('settings')} data-testid="ambient-gate-settings">
                {t('ambient.ui.gate.settings')}
              </Button>
            </div>
          </ContextSection>
        </ContextCard>
      }
    >
      <Panel tone="lead" padding="none" data-testid="ambient-gate" data-state={state}>
        <div className="mem-empty">
          <div className="flex flex-col items-start gap-3">
            <Badge tone={text.tone} dot>
              {text.badge}
            </Badge>
            <h2 className="text-2xl text-fg">{on ? empty.title : text.title}</h2>
            <p className="max-w-[58ch] text-base text-fg-muted">{on ? empty.body : text.body}</p>
            {(action || extra) && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {action}
                {extra}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold tracking-normal text-fg-muted">{t('ambient.ui.gate.what')}</h3>
            <dl className="flex flex-col gap-3.5">
              {points.map((point) => (
                <div key={point} className="flex flex-col">
                  <dt className="text-base font-medium text-fg">{t(`ambient.ui.tab.${point}`)}</dt>
                  <dd className="m-0 max-w-[52ch] text-sm text-fg-muted">{t(`ambient.ui.gate.what.${point}`)}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
        {dialog}
      </Panel>
    </WorkspaceGrid>
  );
}
