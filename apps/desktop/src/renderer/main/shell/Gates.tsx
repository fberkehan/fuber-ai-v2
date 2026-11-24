// Tam pencere kapıları: acil durdurma (politika) ve zorunlu güncelleme. İkisi de her şeyi örter.
import { useState, type ReactNode } from 'react';
import { ArrowClockwise, DownloadSimple, Gear } from '@phosphor-icons/react';
import { APP_VERSION, t, type Policy } from '@fuber/shared';
import { Button, Presence, Surface, toast } from '@fuber/ui';
import { attempt } from './live';

function GateFrame({ children, testId }: { children: ReactNode; testId: string }) {
  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-y-auto bg-stage px-6 py-12" data-testid={testId}>
      {/* Çerçevesiz pencere: üst şerit pencereyi taşır; sağında pencere düğmeleri durur. */}
      <div className="ui-drag absolute inset-x-0 top-0 h-10" aria-hidden />
      <div className="fuber-gate flex w-full max-w-[560px] flex-col items-center text-center">{children}</div>
    </div>
  );
}

export function KillSwitchGate({ name, message }: { name: string; message: string | null }) {
  const [busy, setBusy] = useState(false);
  return (
    <GateFrame testId="gate-killswitch">
      <Presence state="stopped" size={112} label={t('nav.gate.kill.coreLabel', { name })} />
      <h1 className="mt-10 text-4xl text-fg">{t('app.killSwitch.title')}</h1>
      <p className="mt-3 text-lg text-fg-muted">{t('nav.gate.kill.body', { name })}</p>
      {message && (
        <Surface level={1} className="mt-8 w-full px-6 py-5 text-left">
          <p className="text-sm font-medium text-fg-faint">{t('nav.gate.kill.messageFrom')}</p>
          <p className="mt-1.5 text-base text-fg" data-selectable data-testid="gate-message">
            {message}
          </p>
        </Surface>
      )}
      <p className="mt-8 text-sm text-fg-muted">{t('nav.gate.kill.hint')}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button
          icon={<ArrowClockwise />}
          loading={busy}
          onClick={async () => {
            setBusy(true);
            await attempt(() => window.fuber.invoke('control.refresh'));
            setBusy(false);
          }}
        >
          {t('nav.gate.checkAgain')}
        </Button>
        <Button
          variant="ghost"
          icon={<Gear />}
          onClick={async () => {
            const result = await attempt(() => window.fuber.invoke('control.launchAdmin'));
            if (result) (result.ok ? toast.success : toast.info)(result.message);
          }}
        >
          {t('nav.gate.openAdmin')}
        </Button>
      </div>
    </GateFrame>
  );
}

export function UpdateGate({ policy }: { policy: Policy | null }) {
  const release = policy?.release;
  const version = release?.latestVersion && release.latestVersion !== APP_VERSION ? release.latestVersion : (release?.minVersion ?? '');
  const url = release?.downloadUrl ?? null;
  return (
    <GateFrame testId="gate-update">
      <Presence state="idle" size={112} />
      <h1 className="mt-10 text-4xl text-fg">{t('app.updateRequired.title')}</h1>
      <p className="mt-3 text-lg text-fg-muted">{t('app.updateRequired.body', { version })}</p>
      <dl className="mt-8 grid w-full grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line text-left">
        <div className="bg-surface-1 px-6 py-5">
          <dt className="text-sm text-fg-faint">{t('nav.gate.update.current')}</dt>
          <dd className="mt-1 font-mono text-base text-fg">{APP_VERSION}</dd>
        </div>
        <div className="bg-surface-1 px-6 py-5">
          <dt className="text-sm text-fg-faint">{t('nav.gate.update.required')}</dt>
          <dd className="mt-1 font-mono text-base text-fg" data-testid="gate-version">
            {version}
          </dd>
        </div>
      </dl>
      {release?.notes && (
        <Surface level={1} className="mt-3 w-full px-6 py-5 text-left">
          <p className="text-sm font-medium text-fg-faint">{t('nav.gate.update.notes')}</p>
          <p className="mt-1.5 text-base whitespace-pre-line text-fg" data-selectable>
            {release.notes}
          </p>
        </Surface>
      )}
      <div className="mt-8 flex flex-wrap justify-center gap-2">
        <Button
          variant="primary"
          size="lg"
          icon={<DownloadSimple weight="bold" />}
          disabled={!url}
          onClick={() => url && void attempt(() => window.fuber.invoke('app.openExternal', { url }))}
          data-testid="gate-download"
        >
          {t('nav.gate.update.download')}
        </Button>
      </div>
      {!url && <p className="mt-3 text-sm text-fg-muted">{t('nav.gate.update.noUrl')}</p>}
    </GateFrame>
  );
}
