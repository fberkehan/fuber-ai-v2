// Oturum yönetimi ayarları (v1 `CcAyarlar.tsx`): Claude Code'un bu bilgisayardaki durumu, oturum açma, "Tam yetki" anahtarı,
// varsayılan kip ve model, eşzamanlı tur sınırı.
import { useEffect, useState } from 'react';
import { t } from '@fuber/shared';
import { Badge, Button, Dialog, Field, Switch, toast } from '@fuber/ui';
import { ArrowsClockwise, SignIn } from '@phosphor-icons/react';
import type { LiveConfig, LiveEnvironment, PermissionMode } from '../../../../../main/modules/projects/claude/types';
import type { ProjectsConfig } from '../../../../../main/modules/projects/types';
import { errorText, fuber } from '../shared';
import { modeOptions, modelOptions, PickSelect, SectionTitle } from './controls';
import { liveStore } from './store';

export function SettingsDialog({ open, onClose, environment }: { open: boolean; onClose(): void; environment: LiveEnvironment | null }) {
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const config = environment?.config;
  // Kullanıcının kendi (terminaldeki) oturumlarının bitiş duyurusu: proje modülünün ayarı (`notifyOnFinish`, varsayılan açık).
  const [projects, setProjects] = useState<ProjectsConfig | null>(null);
  useEffect(() => {
    if (!open) return;
    void fuber()
      .invoke('projects.config', {})
      .then(setProjects, () => setProjects(null));
  }, [open]);
  const patchProjects = async (change: Partial<ProjectsConfig>) => {
    setSaving(true);
    try {
      setProjects(await fuber().invoke('projects.config', { patch: change }));
    } catch (cause) {
      toast.error(errorText(cause));
    } finally {
      setSaving(false);
    }
  };

  const patch = async (change: Partial<LiveConfig>) => {
    setSaving(true);
    try {
      await fuber().invoke('projects.claudeConfig', { patch: change });
      await liveStore.refreshEnvironment();
    } catch (cause) {
      toast.error(errorText(cause));
    } finally {
      setSaving(false);
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    await liveStore.refreshEnvironment();
    setRefreshing(false);
  };

  const login = async () => {
    try {
      const result = await fuber().invoke('projects.claudeLogin');
      if (result.ok) toast.info(t('projects.live.settings.loginStarted'));
      else if (result.error) toast.error(result.error);
    } catch (cause) {
      toast.error(errorText(cause));
    }
  };

  const account = environment?.account;
  const accountText = account ? [account.email, account.plan].filter(Boolean).join(' · ') : '';

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      size="md"
      title={t('projects.live.settings.title')}
      footer={
        <Button variant="primary" onClick={onClose}>
          {t('projects.live.settings.close')}
        </Button>
      }
    >
      <div className="flex flex-col gap-5" data-testid="live-settings-panel">
        <section className="flex flex-col gap-2">
          <SectionTitle
            aside={
              <Button size="sm" variant="ghost" icon={<ArrowsClockwise />} loading={refreshing} onClick={() => void refresh()}>
                {t('projects.live.settings.recheck')}
              </Button>
            }
          >
            {t('projects.live.settings.status')}
          </SectionTitle>
          {!environment ? (
            <p className="text-sm text-fg-muted">{t('projects.live.settings.checking')}</p>
          ) : (
            <div className="flex flex-col gap-2 text-sm" data-installed={environment.installed} data-logged-in={String(environment.loggedIn)}>
              <div className="flex flex-wrap items-center gap-2">
                {environment.installed ? (
                  <Badge tone="success" dot>
                    {environment.version ? t('projects.live.env.installedVersion', { version: environment.version }) : t('projects.live.env.installed')}
                  </Badge>
                ) : (
                  <Badge tone="danger" dot>
                    {t('projects.live.env.notInstalled')}
                  </Badge>
                )}
                {environment.installed &&
                  (environment.loggedIn === true ? (
                    <Badge tone="success" dot>
                      {t('projects.live.env.loggedIn')}
                    </Badge>
                  ) : environment.loggedIn === false ? (
                    <Badge tone="warning" dot>
                      {t('projects.live.env.loggedOut')}
                    </Badge>
                  ) : (
                    <Badge dot>{t('projects.live.env.loginUnknown')}</Badge>
                  ))}
                {environment.running > 0 && <Badge tone="accent">{t('projects.live.env.running', { n: environment.running })}</Badge>}
              </div>
              {accountText && (
                <p className="text-xs text-fg-muted" data-selectable>
                  {accountText}
                </p>
              )}
              {environment.installed && environment.loggedIn !== true && (
                <Button size="sm" variant="secondary" icon={<SignIn />} className="self-start" onClick={() => void login()}>
                  {t('projects.live.settings.login')}
                </Button>
              )}
            </div>
          )}
        </section>

        {config && (
          <section className="flex flex-col gap-4">
            <SectionTitle>{t('projects.live.settings.defaults')}</SectionTitle>
            <Switch
              data-testid="live-full-access"
              checked={config.fullAccess}
              disabled={saving}
              onCheckedChange={(checked) => void patch({ fullAccess: checked })}
              label={t('projects.live.settings.fullAccess')}
              description={t('projects.live.settings.fullAccessHint')}
            />
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('projects.live.settings.defaultMode')}>
                <PickSelect
                  size="md"
                  className="w-full"
                  data-testid="live-default-mode"
                  value={config.defaultMode}
                  disabled={saving}
                  onChange={(event) => void patch({ defaultMode: event.target.value as PermissionMode })}
                  options={modeOptions(config.fullAccess, config.defaultMode)}
                />
              </Field>
              <Field label={t('projects.live.settings.defaultModel')}>
                <PickSelect
                  size="md"
                  className="w-full"
                  data-testid="live-default-model"
                  value={config.defaultModel}
                  disabled={saving}
                  onChange={(event) => void patch({ defaultModel: event.target.value })}
                  options={modelOptions(environment?.models ?? [], config.defaultModel)}
                />
              </Field>
            </div>
            {projects && (
              <Switch
                data-testid="live-announce-own"
                checked={projects.notifyOnFinish}
                disabled={saving}
                onCheckedChange={(checked) => void patchProjects({ notifyOnFinish: checked })}
                label={t('projects.settings.announceOwn')}
                description={t('projects.settings.announceOwnHint')}
              />
            )}
            <Field label={t('projects.live.settings.maxConcurrent')} hint={t('projects.live.settings.maxConcurrentHint')}>
              <PickSelect
                size="md"
                className="w-32"
                data-testid="live-max-concurrent"
                value={String(config.maxConcurrent)}
                disabled={saving}
                onChange={(event) => void patch({ maxConcurrent: Number(event.target.value) })}
                options={Array.from({ length: 8 }, (_, index) => ({ value: String(index + 1), label: String(index + 1) }))}
              />
            </Field>
          </section>
        )}
      </div>
    </Dialog>
  );
}
