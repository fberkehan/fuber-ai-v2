// Ayarlar › E-posta: hesap ekle (hazır sağlayıcı ya da elle IMAP/SMTP), sına, kaldır; eşitleme durumu. Parola yalnız
// "Bağla ve sına" isteğinde ana sürece gider; hiçbir yanıtta geri gelmez. Kutular `kit.tsx`'in yapı taşlarıdır (arama bulur).
import { useCallback, useMemo, useState } from 'react';
import { ArrowsClockwise, DownloadSimple, EnvelopeSimple, FolderOpen, HardDrives, Key, Plus, Trash } from '@phosphor-icons/react';
import { relativeTime, t } from '@fuber/shared';
import { Badge, Button, Dialog, Field, Input, Select, Switch, toast, Tooltip } from '@fuber/ui';
import { useShell } from '../../shell/context';
import { attempt, useLive } from '../../shell/live';
import { ErrorPanel, SkeletonRows } from '../../shell/parts';
import { Column, Group, SectionGrid, SettingRow } from './kit';
import { ImportDialog, useImportRequest } from './mail-import';
import type { MailAccountInput, MailAccountView, MailImportCandidate, MailImportScan, MailLocalStatus, MailPreset, MailProviderId, MailStatus, MailTestResult } from '../../../../main/modules/mail/types';

const presetLabel = (preset: MailPreset) => (preset.id === 'custom' ? t('mail.preset.custom') : preset.label);

function AccountRow({ account, onTest, onRemove, onPassword }: { account: MailAccountView; onTest: () => void; onRemove: () => void; onPassword: () => void }) {
  return (
    <div className="st-row" data-st-row="" data-testid="mail-account" data-address={account.address}>
      <div className="flex min-w-0 flex-1 basis-72 items-start gap-3">
        <EnvelopeSimple className="mt-0.5 size-5 shrink-0 text-fg-muted" aria-hidden />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="st-row-label flex flex-wrap items-center gap-2">
            <span className="truncate">{account.address}</span>
            {account.label !== account.address && <span className="text-sm font-normal text-fg-muted">{account.label}</span>}
            {!account.hasPassword ? (
              <Badge size="sm" tone="warning" dot data-testid="mail-account-pending">
                {t('mail.settings.passwordPending')}
              </Badge>
            ) : account.lastError ? (
              <Badge size="sm" tone="warning" dot data-testid="mail-account-error">
                {t('mail.settings.errorBadge')}
              </Badge>
            ) : account.lastSyncAt ? (
              <Badge size="sm" tone="success" dot>
                {t('mail.settings.lastSync', { when: relativeTime(account.lastSyncAt) })}
              </Badge>
            ) : (
              <Badge size="sm" tone="neutral">
                {t('mail.settings.neverSynced')}
              </Badge>
            )}
          </span>
          <span className="text-sm text-fg-muted" data-testid="mail-account-stats">
            {t('mail.settings.stats', { count: account.messageCount, unread: account.unreadCount })} · {account.imapHost}
          </span>
          {account.lastError && <span className="text-sm text-warning">{account.lastError}</span>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {account.hasPassword ? (
          <Button size="sm" variant="ghost" onClick={onTest} data-testid="mail-account-test">
            {t('mail.settings.test')}
          </Button>
        ) : (
          <Button size="sm" variant="secondary" icon={<Key />} onClick={onPassword} data-testid="mail-account-password">
            {t('mail.settings.enterPassword')}
          </Button>
        )}
        <Button size="sm" variant="ghost" icon={<Trash />} onClick={onRemove} data-testid="mail-account-remove">
          {t('mail.settings.remove')}
        </Button>
      </div>
    </div>
  );
}

interface FormState {
  provider: MailProviderId;
  address: string;
  password: string;
  label: string;
  username: string;
  imapHost: string;
  imapPort: string;
  smtpHost: string;
  smtpPort: string;
}

function emptyForm(preset: MailPreset): FormState {
  return { provider: preset.id, address: '', password: '', label: '', username: '', imapHost: preset.imapHost, imapPort: String(preset.imapPort), smtpHost: preset.smtpHost, smtpPort: String(preset.smtpPort) };
}

/** Hesap formunun önceden doldurulmuş hâli: parolası bekleyen hesap ya da Thunderbird'den gelen OAuth hesabı. */
type AccountPrefill = Omit<FormState, 'password'>;

function prefillOf(source: MailAccountView | MailImportCandidate): AccountPrefill {
  const label = 'label' in source ? (source.label === source.address ? '' : source.label) : source.fullName;
  return {
    provider: source.provider,
    address: source.address,
    label,
    username: source.username === source.address ? '' : source.username,
    imapHost: source.imapHost,
    imapPort: String(source.imapPort),
    smtpHost: source.smtpHost,
    smtpPort: String(source.smtpPort),
  };
}

function AccountDialog({ open, presets, prefill, onClose, onSaved }: { open: boolean; presets: MailPreset[]; prefill?: AccountPrefill | null; onClose: () => void; onSaved: () => void }) {
  const first = presets[0]!;
  const [form, setForm] = useState<FormState>(() => (prefill ? { ...prefill, password: '' } : emptyForm(first)));
  const [advanced, setAdvanced] = useState(Boolean(prefill && prefill.provider === 'custom'));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MailTestResult | null>(null);
  const preset = presets.find((item) => item.id === form.provider) ?? first;
  const custom = form.provider === 'custom';
  const set = (patch: Partial<FormState>) => setForm((previous) => ({ ...previous, ...patch }));

  const choose = (id: MailProviderId) => {
    const next = presets.find((item) => item.id === id) ?? first;
    setForm((previous) => ({ ...emptyForm(next), address: previous.address, password: previous.password, label: previous.label, username: previous.username }));
    setAdvanced(id === 'custom');
    setResult(null);
  };

  const submit = async () => {
    setBusy(true);
    setResult(null);
    const account: MailAccountInput = {
      provider: form.provider,
      address: form.address,
      password: form.password,
      label: form.label,
      username: form.username,
      imapHost: form.imapHost,
      imapPort: Number(form.imapPort),
      smtpHost: form.smtpHost,
      smtpPort: Number(form.smtpPort),
    };
    const response = await attempt(() => window.fuber.invoke('mail.saveAccount', { account }));
    setBusy(false);
    if (!response) return;
    setResult(response.test);
    if (!response.saved) return;
    const address = response.account?.address ?? form.address;
    if (response.test.smtp) toast.success(t('mail.form.saved', { address }));
    else toast.warning(t('mail.form.savedWarn', { address, error: response.test.error ?? '' }));
    setForm(emptyForm(first));
    setResult(null);
    onSaved();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && !busy && onClose()}
      title={prefill ? t('mail.form.passwordTitle', { address: prefill.address }) : t('mail.form.title')}
      description={t('mail.form.description')}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()} data-testid="mail-form-submit">
            {t('mail.form.submit')}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        data-testid="mail-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field label={t('mail.form.provider')} hint={t(preset.noteKey)}>
          <Select<MailProviderId> value={form.provider} onChange={choose} options={presets.map((item) => ({ value: item.id, label: presetLabel(item) }))} aria-label={t('mail.form.provider')} />
        </Field>
        <Field label={t('mail.form.address')}>
          <Input type="email" autoComplete="off" spellCheck={false} value={form.address} onChange={(event) => set({ address: event.target.value })} data-testid="mail-form-address" />
        </Field>
        <Field label={t('mail.form.password')}>
          <Input type="password" autoComplete="new-password" value={form.password} onChange={(event) => set({ password: event.target.value })} data-testid="mail-form-password" />
        </Field>
        <Field label={t('mail.form.label')} hint={t('mail.form.labelHint')}>
          <Input value={form.label} onChange={(event) => set({ label: event.target.value })} />
        </Field>
        {!custom && (
          <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => setAdvanced((value) => !value)} aria-expanded={advanced} data-testid="mail-form-advanced">
            {t('mail.form.advanced')}
          </Button>
        )}
        {(advanced || custom) && (
          <div className="grid grid-cols-[minmax(0,1fr)_112px] gap-3" data-testid="mail-form-servers">
            <Field label={t('mail.form.imapHost')}>
              <Input spellCheck={false} value={form.imapHost} onChange={(event) => set({ imapHost: event.target.value })} data-testid="mail-form-imap-host" />
            </Field>
            <Field label={t('mail.form.imapPort')}>
              <Input inputMode="numeric" value={form.imapPort} onChange={(event) => set({ imapPort: event.target.value.replace(/\D/g, '') })} data-testid="mail-form-imap-port" />
            </Field>
            <Field label={t('mail.form.smtpHost')}>
              <Input spellCheck={false} value={form.smtpHost} onChange={(event) => set({ smtpHost: event.target.value })} data-testid="mail-form-smtp-host" />
            </Field>
            <Field label={t('mail.form.smtpPort')}>
              <Input inputMode="numeric" value={form.smtpPort} onChange={(event) => set({ smtpPort: event.target.value.replace(/\D/g, '') })} data-testid="mail-form-smtp-port" />
            </Field>
            <Field label={t('mail.form.username')} hint={t('mail.form.usernameHint')} className="col-span-2">
              <Input spellCheck={false} value={form.username} onChange={(event) => set({ username: event.target.value })} />
            </Field>
          </div>
        )}
        {result && (
          <p className={result.imap ? 'text-sm text-fg-muted' : 'text-sm text-warning'} role="status" data-testid="mail-form-result" data-ok={String(result.imap)}>
            {result.imap ? result.text : `${t('mail.form.notSaved')} ${result.text}`}
          </p>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

/** Thunderbird'ün yerel klasöründen (indirdiği mbox) PAROLASIZ okuma. IMAP içe aktarmadan bağımsız; onun yanına gelir. */
function LocalSource() {
  const status = useLive<MailLocalStatus>(() => window.fuber.invoke('mail.localStatus'), ['mail.changed']);
  const [busy, setBusy] = useState(false);
  const data = status.data;

  const toggle = async (enabled: boolean) => {
    setBusy(true);
    const result = await attempt(() => window.fuber.invoke('mail.localSetEnabled', { enabled }));
    setBusy(false);
    if (!result) return;
    toast.success(t(enabled ? 'mail.local.turnedOn' : 'mail.local.turnedOff'));
    status.reload();
  };
  const pick = async () => {
    setBusy(true);
    const result = await attempt(() => window.fuber.invoke('mail.localPickFolder'));
    setBusy(false);
    if (result) status.reload();
  };

  if (!data) return null;
  // Hesap sayısı (benzersiz üst klasör) ve kutu sayısı: listede kalabalık olmasın diye özet.
  const accountNames = [...new Set(data.boxes.map((box) => box.account))];

  return (
    <Group
      span="full"
      title={t('mail.local.title')}
      description={t('mail.local.description')}
      keywords={t('mail.local.keywords')}
      action={
        <Switch
          checked={data.enabled}
          disabled={busy || (!data.found && !data.enabled)}
          onCheckedChange={(next) => void toggle(next)}
          aria-label={t('mail.local.toggle')}
          data-testid="mail-local-toggle"
        />
      }
    >
      <div className="flex flex-col gap-3" data-testid="mail-local" data-enabled={String(data.enabled)} data-found={String(data.found)}>
        <div className="flex min-w-0 items-start gap-3">
          <HardDrives className="mt-0.5 size-5 shrink-0 text-fg-muted" aria-hidden />
          <div className="flex min-w-0 flex-col gap-1">
            {data.enabled ? (
              <>
                <span className="text-sm text-fg" data-testid="mail-local-explain">
                  {t('mail.local.explain')}
                </span>
                {data.reading ? (
                  // İlk okuma (backfill) sürüyor: sayı artarken görünür ilerleme.
                  <span className="text-sm text-fg-muted" data-testid="mail-local-reading">
                    {t('mail.local.reading', { count: data.messageCount })}
                  </span>
                ) : (
                  <span className="text-sm text-fg-muted" data-testid="mail-local-stats">
                    {t('mail.local.stats', { count: data.messageCount, boxes: data.boxes.length, accounts: accountNames.length })}
                    {data.profile ? ` · ${t('mail.local.profile', { name: data.profile })}` : ''}
                    {data.lastReadAt ? ` · ${t('mail.local.lastRead', { when: relativeTime(data.lastReadAt) })}` : ''}
                  </span>
                )}
              </>
            ) : data.found ? (
              <span className="text-sm text-fg-muted" data-testid="mail-local-ready">
                {t('mail.local.ready', { boxes: data.boxes.length, accounts: accountNames.length })}
                {data.profile ? ` · ${t('mail.local.profile', { name: data.profile })}` : ''}
              </span>
            ) : (
              <span className="text-sm text-fg-muted" data-testid="mail-local-missing">
                {t('mail.local.notFound')}
              </span>
            )}
          </div>
        </div>

        {data.boxes.length > 0 && (data.enabled || data.found) && (
          <div className="flex flex-wrap gap-1.5" data-testid="mail-local-boxes">
            {data.boxes.slice(0, 24).map((box) => (
              <Badge key={box.path} size="sm" tone="neutral" data-testid="mail-local-box">
                {box.account === box.mailbox ? box.mailbox : `${box.account} › ${box.mailbox}`}
              </Badge>
            ))}
            {data.boxes.length > 24 && <span className="text-xs text-fg-muted">{t('mail.local.more', { count: data.boxes.length - 24 })}</span>}
          </div>
        )}

        <div>
          <Button size="sm" variant="ghost" icon={<FolderOpen />} loading={busy} onClick={() => void pick()} data-testid="mail-local-pick">
            {data.customRoot ? t('mail.local.pickAgain') : t('mail.local.pick')}
          </Button>
        </div>
      </div>
    </Group>
  );
}

export function MailSettings() {
  const shell = useShell();
  const accounts = useLive<MailAccountView[]>(() => window.fuber.invoke('mail.accounts'), ['mail.changed']);
  const status = useLive<MailStatus>(() => window.fuber.invoke('mail.status'), ['mail.changed']);
  const presets = useLive<MailPreset[]>(() => window.fuber.invoke('mail.presets'), []);
  const scan = useLive<MailImportScan>(() => window.fuber.invoke('mail.importScan'), ['mail.changed']);
  const [adding, setAdding] = useState(false);
  const [prefill, setPrefill] = useState<AccountPrefill | null>(null);
  const [dialogSeed, setDialogSeed] = useState(0);
  const [importing, setImporting] = useState(false);
  const openImport = useCallback(() => setImporting(true), []);
  useImportRequest(openImport);
  const openForm = (next: AccountPrefill | null) => {
    setPrefill(next);
    setDialogSeed((seed) => seed + 1);
    setAdding(true);
  };
  const [removing, setRemoving] = useState<MailAccountView | null>(null);
  const [syncing, setSyncing] = useState(false);
  const pausedText = useMemo(() => (status.data?.paused ? t(`mail.settings.paused.${status.data.paused}`) : null), [status.data?.paused]);

  if (accounts.state.status === 'loading' || presets.state.status === 'loading') {
    return (
      <SectionGrid>
        <Group tone="lead" span="full" title={t('mail.settings.title')}>
          <SkeletonRows count={3} />
        </Group>
      </SectionGrid>
    );
  }
  if (accounts.state.status === 'error') return <ErrorPanel message={accounts.state.message} onRetry={accounts.reload} />;
  // Yerel (Thunderbird) hesabı IMAP listesinde parolalı hesap gibi görünmez; kendi bölümünden (LocalSource) yönetilir.
  const list = accounts.state.data.filter((account) => account.kind !== 'thunderbird');
  const synced = list.length > 0 && Boolean(status.data);
  const importHint = scan.data && !scan.data.found ? (scan.data.reason ?? t('mail.import.noProfile')) : t('mail.import.buttonHint');

  const test = async (account: MailAccountView) => {
    const result = await attempt(() =>
      window.fuber.invoke('mail.testAccount', {
        account: { id: account.id, provider: account.provider, address: account.address, username: account.username, imapHost: account.imapHost, imapPort: account.imapPort, smtpHost: account.smtpHost, smtpPort: account.smtpPort },
      }),
    );
    if (!result) return;
    if (result.imap && result.smtp) toast.success(result.text);
    else toast.warning(result.text);
  };

  const sync = async () => {
    setSyncing(true);
    const result = await attempt(() => window.fuber.invoke('mail.syncNow', {}));
    setSyncing(false);
    if (result) toast.success(t('mail.settings.synced'));
    accounts.reload();
    status.reload();
  };

  return (
    <SectionGrid data-testid="settings-mail-section">
      {/* Hesap varken eşitleme kutusu yan sütuna gelir; yokken hesap kutusu tam genişliktir (yarım ekran boş kalmaz). */}
      <Group
        tone="lead"
        span={synced ? 'main' : 'full'}
        title={t('mail.settings.title')}
        description={t('mail.settings.description', { name: shell.name })}
        keywords={t('settings.kw.mail')}
        action={
          <>
            <Tooltip content={importHint}>
              <span tabIndex={scan.data?.found ? -1 : 0} className="inline-flex" aria-label={scan.data?.found ? undefined : importHint} data-testid="mail-import-wrap">
                <Button size="sm" variant="ghost" icon={<DownloadSimple />} onClick={openImport} disabled={!scan.data?.found} data-testid="mail-import">
                  {t('mail.import.button')}
                </Button>
              </span>
            </Tooltip>
            <Button size="sm" icon={<Plus />} onClick={() => openForm(null)} disabled={status.data?.paused === 'noCipher'} data-testid="mail-add">
              {t('mail.settings.add')}
            </Button>
          </>
        }
      >
        {list.length === 0 ? (
          <p className="text-sm text-fg-muted" data-st-row="" data-testid="mail-empty">
            {t('mail.settings.empty')}
          </p>
        ) : (
          list.map((account) => (
            <AccountRow key={account.id} account={account} onTest={() => void test(account)} onRemove={() => setRemoving(account)} onPassword={() => openForm(prefillOf(account))} />
          ))
        )}
      </Group>

      {synced && status.data && (
        <Column span="side">
          <Group title={t('mail.settings.syncTitle')} description={t('mail.settings.syncBody', { minutes: status.data.intervalMinutes })}>
            <SettingRow
              layout="stack"
              label={status.data.lastSyncAt ? t('mail.settings.lastSync', { when: relativeTime(status.data.lastSyncAt) }) : t('mail.settings.neverSynced')}
              description={
                <span className={pausedText ? 'text-warning' : undefined}>{pausedText ?? (status.data.nextSyncAt ? t('mail.settings.next', { when: relativeTime(status.data.nextSyncAt) }) : '')}</span>
              }
              testId="mail-sync"
            >
              <Button size="sm" icon={<ArrowsClockwise />} loading={syncing || status.data.syncing} onClick={() => void sync()} disabled={Boolean(status.data.paused)} data-testid="mail-sync-now">
                {syncing ? t('mail.settings.syncing') : t('mail.settings.sync')}
              </Button>
            </SettingRow>
          </Group>
        </Column>
      )}

      <LocalSource />

      {presets.data && (
        <AccountDialog
          key={dialogSeed}
          open={adding}
          presets={presets.data}
          prefill={prefill}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            accounts.reload();
            status.reload();
          }}
        />
      )}
      <ImportDialog
        open={importing}
        onClose={() => setImporting(false)}
        onImported={() => {
          accounts.reload();
          status.reload();
          scan.reload();
        }}
        onLoginInApp={(candidate) => {
          setImporting(false);
          openForm(prefillOf(candidate));
        }}
      />
      <Dialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={t('mail.settings.removeTitle', { address: removing?.address ?? '' })}
        description={t('mail.settings.removeBody')}
        size="sm"
        role="alertdialog"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              data-testid="mail-remove-confirm"
              onClick={async () => {
                const target = removing;
                setRemoving(null);
                if (target && (await attempt(() => window.fuber.invoke('mail.removeAccount', { id: target.id })))) {
                  toast.success(t('mail.settings.removed'));
                  accounts.reload();
                  status.reload();
                }
              }}
            >
              {t('mail.settings.remove')}
            </Button>
          </>
        }
      />
    </SectionGrid>
  );
}
