// Ayarlar › E-posta › "Thunderbird’den içe aktar": bulunan hesaplar (ad, adres, gelen/giden sunucu, güvenlik, "zaten ekli")
// → işaretle → her seçili hesap için isteğe bağlı parola (OAuth hesabında "uygulamadan giriş yap") → içe aktar → hesap başına
// sınama sonucu. Parola yalnız `mail.importAccounts` isteğinde ana sürece gider; hiçbir yanıtta geri gelmez.
import { useEffect, useState } from 'react';
import { t } from '@fuber/shared';
import { Badge, Button, Checkbox, Dialog, Input, type Tone } from '@fuber/ui';
import { attempt } from '../../shell/live';
import type { ImportSecurity, MailImportCandidate, MailImportResult, MailImportScan, MailImportStatus } from '../../../../main/modules/mail/types';

// Sesle açma (`mail_import_thunderbird` → `app.navigate { page: 'settings', params: { tab: 'mail', mailImport } }`). Ayarlar
// sayfası henüz açık değilken gelen istek de kaçmasın diye dinleyici modül yüklenirken kurulur (`navigate.ts` düzeni).
let pendingOpen = false;
const openListeners = new Set<() => void>();
if (typeof window !== 'undefined' && window.fuber) {
  window.fuber.on('app.navigate', ({ page, params }) => {
    if (page !== 'settings' || params?.mailImport !== 'thunderbird') return;
    if (openListeners.size === 0) pendingOpen = true;
    else for (const listener of openListeners) listener();
  });
}

/** Sesle "içe aktarma penceresini aç" isteği: bekleyen istek varsa hemen bir kez, sonra her istekte. */
export function useImportRequest(open: () => void): void {
  useEffect(() => {
    if (pendingOpen) {
      pendingOpen = false;
      open();
    }
    openListeners.add(open);
    return () => void openListeners.delete(open);
  }, [open]);
}

const securityLabel = (security: ImportSecurity) => t(`mail.import.security.${security}`);

const STATUS_TONE: Record<MailImportStatus, Tone> = {
  connected: 'success',
  sendFailed: 'warning',
  wrongPassword: 'danger',
  loginRequired: 'warning',
  unreachable: 'danger',
  passwordPending: 'neutral',
  exists: 'neutral',
  failed: 'danger',
  notFound: 'neutral',
};

function CandidateRow({
  candidate,
  selected,
  password,
  onToggle,
  onPassword,
  onLoginInApp,
}: {
  candidate: MailImportCandidate;
  selected: boolean;
  password: string;
  onToggle: (next: boolean) => void;
  onPassword: (value: string) => void;
  onLoginInApp: () => void;
}) {
  const selectable = candidate.importable && !candidate.existing;
  return (
    <div
      className="flex flex-col gap-2 rounded-md border border-line px-3 py-2.5"
      data-testid="mail-import-row"
      data-address={candidate.address}
      data-importable={String(candidate.importable)}
      data-existing={String(candidate.existing)}
    >
      <div className="flex items-start gap-3">
        <Checkbox checked={selected} disabled={!selectable} onCheckedChange={onToggle} aria-label={candidate.address || candidate.name} data-testid="mail-import-check" className="mt-0.5" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
            <span className="truncate">{candidate.name}</span>
            {candidate.address && candidate.address !== candidate.name && <span className="truncate font-normal text-fg-muted">{candidate.address}</span>}
            {candidate.existing && (
              <Badge size="sm" tone="neutral" data-testid="mail-import-existing">
                {t('mail.import.existing')}
              </Badge>
            )}
            {!candidate.importable && (
              <Badge size="sm" tone="warning" data-testid="mail-import-unsupported">
                {t('mail.import.unsupported')}
              </Badge>
            )}
            {candidate.importable && candidate.oauth && !candidate.existing && (
              <Badge size="sm" tone="accent">
                {t('mail.import.oauth')}
              </Badge>
            )}
          </span>
          {candidate.importable ? (
            <span className="text-sm text-fg-muted">
              {t('mail.import.incoming')}:{' '}
              {t('mail.import.server', {
                host: candidate.imapHost,
                port: candidate.imapPort,
                security: securityLabel(candidate.imapSecurity),
              })}{' '}
              · {t('mail.import.outgoing')}:{' '}
              {t('mail.import.server', {
                host: candidate.smtpHost,
                port: candidate.smtpPort,
                security: securityLabel(candidate.smtpSecurity),
              })}
            </span>
          ) : (
            <span className="text-sm text-fg-muted" data-testid="mail-import-reason">
              {candidate.reason}
            </span>
          )}
          {candidate.importable &&
            candidate.notes.map((note) => (
              <span key={note} className="text-xs text-fg-muted">
                {note}
              </span>
            ))}
        </div>
      </div>
      {selected && (
        <div className="flex flex-col gap-1.5 pl-8">
          <div className="flex items-center gap-2">
            <Input
              type="password"
              autoComplete="new-password"
              placeholder={candidate.oauth ? t('mail.import.appPassword') : t('mail.import.password')}
              aria-label={candidate.oauth ? t('mail.import.appPassword') : t('mail.import.password')}
              value={password}
              onChange={(event) => onPassword(event.target.value)}
              className="flex-1"
              data-testid="mail-import-password"
            />
            {candidate.oauth && (
              <Button size="sm" variant="ghost" onClick={onLoginInApp} data-testid="mail-import-login">
                {t('mail.import.loginInApp')}
              </Button>
            )}
          </div>
          {candidate.oauth && <span className="text-xs text-fg-muted">{t('mail.import.oauthHint')}</span>}
        </div>
      )}
    </div>
  );
}

export function ImportDialog({
  open,
  onClose,
  onImported,
  onLoginInApp,
}: {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
  /** OAuth hesabı: var olan hesap formunu bu hesabın ayarlarıyla açar. */
  onLoginInApp: (candidate: MailImportCandidate) => void;
}) {
  const [scan, setScan] = useState<MailImportScan | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<MailImportResult[] | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setResults(null);
    setPasswords({});
    setScan(null);
    void attempt(() => window.fuber.invoke('mail.importScan')).then((next) => {
      if (!alive || !next) return;
      setScan(next);
      // Seçilebilenler baştan işaretli: kullanıcı yalnız istemediğini kaldırır.
      setSelected(new Set(next.accounts.filter((candidate) => candidate.importable && !candidate.existing).map((candidate) => candidate.key)));
    });
    return () => {
      alive = false;
    };
  }, [open]);

  const close = () => {
    if (busy) return;
    setPasswords({});
    onClose();
  };

  const submit = async () => {
    if (!scan) return;
    const items = scan.accounts
      .filter((candidate) => selected.has(candidate.key))
      .map((candidate) => ({
        key: candidate.key,
        ...(passwords[candidate.key] ? { password: passwords[candidate.key] } : {}),
      }));
    if (!items.length) return;
    setBusy(true);
    const response = await attempt(() => window.fuber.invoke('mail.importAccounts', { items }));
    setBusy(false);
    setPasswords({});
    if (!response) return;
    setResults(response.results);
    onImported();
  };

  const accounts = scan?.accounts ?? [];
  const count = selected.size;
  const byKey = new Map(accounts.map((candidate) => [candidate.key, candidate]));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && close()}
      title={results ? t('mail.import.done') : t('mail.import.title')}
      description={
        results
          ? t('mail.import.doneBody', {
              count: results.filter((result) => result.accountId).length,
            })
          : t('mail.import.description')
      }
      size="lg"
      footer={
        results ? (
          <Button variant="primary" onClick={close} data-testid="mail-import-close">
            {t('mail.import.close')}
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={close} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" loading={busy} disabled={count === 0} onClick={() => void submit()} data-testid="mail-import-submit">
              {busy ? t('mail.import.importing') : count > 0 ? t('mail.import.submitCount', { count }) : t('mail.import.submit')}
            </Button>
          </>
        )
      }
    >
      {results ? (
        <div className="flex flex-col gap-2" data-testid="mail-import-results">
          {results.map((result) => (
            <div key={result.key} className="flex items-start gap-3 rounded-md border border-line px-3 py-2.5" data-testid="mail-import-result" data-status={result.status}>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  <span className="truncate">{result.address || byKey.get(result.key)?.name}</span>
                  <Badge size="sm" tone={STATUS_TONE[result.status]} dot>
                    {t(`mail.import.result.${result.status}`)}
                  </Badge>
                </span>
                <span className="text-sm text-fg-muted">{result.text}</span>
              </div>
            </div>
          ))}
        </div>
      ) : !scan ? (
        <p className="text-sm text-fg-muted">{t('mail.import.scanning')}</p>
      ) : accounts.length === 0 ? (
        <p className="text-sm text-fg-muted" data-testid="mail-import-empty">
          {scan.found ? t('mail.import.empty') : scan.reason}
        </p>
      ) : (
        <div className="flex max-h-[min(60vh,560px)] flex-col gap-2 overflow-y-auto pr-1" data-testid="mail-import-list">
          {scan.profiles.length > 1 && <p className="text-xs text-fg-muted">{scan.profiles.map((profile) => t('mail.import.profile', { name: profile.name })).join(' · ')}</p>}
          {accounts.map((candidate) => (
            <CandidateRow
              key={candidate.key}
              candidate={candidate}
              selected={selected.has(candidate.key)}
              password={passwords[candidate.key] ?? ''}
              onToggle={(next) =>
                setSelected((previous) => {
                  const copy = new Set(previous);
                  if (next) copy.add(candidate.key);
                  else copy.delete(candidate.key);
                  return copy;
                })
              }
              onPassword={(value) =>
                setPasswords((previous) => ({
                  ...previous,
                  [candidate.key]: value,
                }))
              }
              onLoginInApp={() => {
                setPasswords({});
                onLoginInApp(candidate);
              }}
            />
          ))}
        </div>
      )}
    </Dialog>
  );
}
