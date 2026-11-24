// Canlı oturum listesi (v1 `OturumListesi.tsx`): izin bekleyenler en üstte, sonra çalışanlar, sonra diğerleri.
import { t } from '@fuber/shared';
import { Badge, cn } from '@fuber/ui';
import { ShieldWarning } from '@phosphor-icons/react';
import type { LiveSessionSummary } from '../../../../../main/modules/projects/claude/types';
import { STATUS_TONE, sortSessions, statusLabel } from './format';

export function StatusBadge({ session, size = 'sm', testId }: { session: Pick<LiveSessionSummary, 'status' | 'queuePosition' | 'background'>; size?: 'sm' | 'md'; testId?: string }) {
  return (
    <Badge size={size} tone={STATUS_TONE[session.status]} dot data-testid={testId} data-status={session.status}>
      {statusLabel(session)}
    </Badge>
  );
}

export function LiveList({
  sessions,
  selectedId,
  onSelect,
  fill = false,
}: {
  sessions: readonly LiveSessionSummary[];
  selectedId: string | null;
  onSelect(id: string): void;
  /** Sütunun kalan yüksekliğini doldurur (çalışma alanı); değilse geçmiş listesinin üstünde en çok %40. */
  fill?: boolean;
}) {
  const sorted = sortSessions(sessions);
  return (
    <div data-testid="live-list" role="listbox" aria-label={t('projects.live.list.label')} className={cn('flex flex-col overflow-y-auto', fill ? 'min-h-0 flex-1' : 'max-h-[50%] shrink-0')}>
      {sorted.map((session) => {
        const selected = session.id === selectedId;
        return (
          <div
            key={session.id}
            role="option"
            aria-selected={selected}
            tabIndex={0}
            data-testid={`live-item-${session.id}`}
            data-status={session.status}
            data-session-id={session.sessionId}
            onClick={() => onSelect(session.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelect(session.id);
              }
            }}
            className={cn(
              'relative flex cursor-pointer flex-col gap-1 border-b border-line py-2.5 outline-offset-[-2px] transition-colors duration-(--duration-fast) ease-out',
              fill ? 'px-4' : 'px-5',
              selected ? 'bg-surface-4' : 'hover:bg-surface-2',
            )}
          >
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span className={cn('min-w-0 flex-1 basis-24 truncate text-base text-fg', selected ? 'font-semibold' : 'font-medium')}>{session.title}</span>
              <StatusBadge session={session} />
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-fg-faint">
              <span className="truncate">{session.projectName}</span>
              {/* Tek izin isteği durum rozetinde zaten yazar ("İzin bekliyor"); sayı yalnız birden çoksa gösterilir. */}
              {session.pendingPermissions > 1 && (
                <Badge size="sm" tone="warning" icon={<ShieldWarning />}>
                  {t('projects.live.list.permissions', { n: session.pendingPermissions })}
                </Badge>
              )}
              {session.queued > 0 && <span className="shrink-0 tabular-nums">{t('projects.live.list.queued', { n: session.queued })}</span>}
              {session.background > 0 && <span className="shrink-0 tabular-nums">{t('projects.live.list.background', { n: session.background })}</span>}
              {session.source === 'assistant' && <span className="shrink-0">{t('projects.live.source.assistant')}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
