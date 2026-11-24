// Oturum başlatma/sürdürme akışı: `projects.claudeStart` yanıtına göre klasör güveni kartı (v1 `KlasorGuveni.tsx`) ya da
// "başka yerde açık" seçenekleri gösterilir; karar verilince aynı istek yeniden gönderilir.
import { useCallback, useRef, useState } from 'react';
import { t } from '@fuber/shared';
import { Button } from '@fuber/ui';
import { ArrowsSplit, ShieldCheck, ShieldWarning, WarningCircle } from '@phosphor-icons/react';
import type { FolderTrustState, LiveSessionSummary, LiveStartRequest, LiveStartResult } from '../../../../../main/modules/projects/claude/types';
import { errorText, fuber, tidyPath } from '../shared';
import { liveStore } from './store';

export interface Starter {
  pending: boolean;
  /** Kullanıcıya gösterilecek hazır Türkçe hata (ana süreçten). */
  error: string;
  /** Karar bekleyen klasör güveni. */
  trust: FolderTrustState | null;
  /** Oturum başka yerde açık: "yine de sürdür" / "çatalla" seçenekleri. */
  elsewhere: boolean;
  start(request: LiveStartRequest): Promise<LiveStartResult | null>;
  decideTrust(decision: 'trust' | 'distrust'): Promise<void>;
  retry(extra: Pick<LiveStartRequest, 'force' | 'fork'>): Promise<void>;
  reset(): void;
}

export function useStarter(onStarted: (session: LiveSessionSummary) => void): Starter {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [trust, setTrust] = useState<FolderTrustState | null>(null);
  const [elsewhere, setElsewhere] = useState(false);
  const last = useRef<LiveStartRequest | null>(null);
  const started = useRef(onStarted);
  started.current = onStarted;

  const start = useCallback(async (request: LiveStartRequest): Promise<LiveStartResult | null> => {
    last.current = request;
    setPending(true);
    setError('');
    setTrust(null);
    setElsewhere(false);
    try {
      const result = await fuber().invoke('projects.claudeStart', request);
      if (result.ok && result.session) {
        liveStore.upsert(result.session);
        started.current(result.session);
      } else if (result.code === 'trust_required' && result.trust) {
        setTrust(result.trust);
      } else {
        if (result.code === 'open_elsewhere') setElsewhere(true);
        setError(result.error ?? '');
      }
      return result;
    } catch (cause) {
      setError(errorText(cause));
      return null;
    } finally {
      setPending(false);
    }
  }, []);

  const decideTrust = useCallback(
    async (decision: 'trust' | 'distrust') => {
      const request = last.current;
      const folder = trust?.cwd;
      if (!request || !folder) return;
      setPending(true);
      try {
        await fuber().invoke('projects.claudeTrust', { cwd: folder, decision });
      } catch (cause) {
        setError(errorText(cause));
        setPending(false);
        return;
      }
      await start(request);
    },
    [trust, start],
  );

  const retry = useCallback(
    async (extra: Pick<LiveStartRequest, 'force' | 'fork'>) => {
      if (last.current) await start({ ...last.current, ...extra });
    },
    [start],
  );

  const reset = useCallback(() => {
    setError('');
    setTrust(null);
    setElsewhere(false);
  }, []);

  return { pending, error, trust, elsewhere, start, decideTrust, retry, reset };
}

/** Başlatma akışının kullanıcıdan karar istediği durumlar ve hata satırı. */
export function StartPrompts({ starter }: { starter: Starter }) {
  const { trust } = starter;
  return (
    <>
      {trust && (
        <section data-testid="live-trust-card" aria-label={t('projects.live.trust.title')} data-attention="" className="ui-card flex flex-col gap-3 rounded-md border border-line bg-surface-1 px-5 py-4">
          <header className="flex items-start gap-2 text-sm">
            <ShieldWarning weight="fill" className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="font-medium text-fg">{t('projects.live.trust.title')}</span>
              <span className="font-mono text-xs break-all text-fg-faint" data-selectable>
                {tidyPath(trust.cwd)}
              </span>
            </div>
          </header>
          <p className="text-sm text-fg-muted">{t('projects.live.trust.body')}</p>
          {trust.files.length > 0 && (
            <ul className="flex flex-col gap-1 text-xs" data-selectable>
              {trust.files.map((file) => (
                <li key={file.path} className="flex items-baseline gap-2">
                  <span className="shrink-0 font-mono text-fg">{file.path}</span>
                  <span className="min-w-0 break-words text-fg-muted">{file.summary}</span>
                </li>
              ))}
            </ul>
          )}
          {(trust.hooks || trust.mcp) && (
            <p className="text-xs text-fg-muted">
              {[trust.hooks ? t('projects.live.trust.hooks') : '', trust.mcp ? t('projects.live.trust.mcp') : ''].filter(Boolean).join(' ')}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" icon={<ShieldCheck />} disabled={starter.pending} data-testid="live-trust-yes" onClick={() => void starter.decideTrust('trust')}>
              {t('projects.live.trust.yes')}
            </Button>
            <Button size="sm" variant="secondary" disabled={starter.pending} data-testid="live-trust-no" onClick={() => void starter.decideTrust('distrust')}>
              {t('projects.live.trust.no')}
            </Button>
          </div>
        </section>
      )}
      {starter.error && (
        <p role="alert" data-testid="live-start-error" className="flex items-start gap-2 text-sm text-danger">
          <WarningCircle weight="fill" className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span data-selectable>{starter.error}</span>
        </p>
      )}
      {starter.elsewhere && (
        <div className="flex flex-wrap items-center gap-2" data-testid="live-elsewhere">
          <Button size="sm" variant="secondary" disabled={starter.pending} data-testid="live-force" onClick={() => void starter.retry({ force: true })}>
            {t('projects.live.elsewhere.force')}
          </Button>
          <Button size="sm" variant="secondary" icon={<ArrowsSplit />} disabled={starter.pending} data-testid="live-fork" onClick={() => void starter.retry({ fork: true })}>
            {t('projects.live.elsewhere.fork')}
          </Button>
        </div>
      )}
    </>
  );
}
