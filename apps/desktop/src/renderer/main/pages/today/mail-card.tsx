// Kokpit "E-posta" kartı. Verisi ana süreçteki doldurucudan gelir (`modules/mail/dashboard-card.ts`): hesap başına
// okunmamış sayısı, son okunmamış iletiler (gönderen, konu, saat, önem işareti) ve eşitleme hatası. Yeni ileti gelince
// satır kayarak girer ve 1–2 sn "Yeni" vurgusu görünür (`live-update.ts`). Gelen kutusu temizken ve eşitleme hatasında
// kart ayrı bir durum gösterir.
import { CheckCircle, WarningCircle } from '@phosphor-icons/react';
import { t } from '@fuber/shared';
import { cn } from '@fuber/ui';
import type { MailCardData, MailCardItem } from '../../../../main/modules/mail/dashboard-card';
import { useShell } from '../../shell/context';
import { fitRows, More } from './cards';
import { initials, stamp, useArrival, useFreshKeys } from './live-update';
import { registerTodayCard, type TodayCardProps } from './registry';

const ROW_PX = 56;
const HEAD_PX = 34;

function MessageRow({ message, now, fresh, onOpen }: { message: MailCardItem; now: Date; fresh: boolean; onOpen(): void }) {
  return (
    <li className="min-w-0" data-testid="today-mail-item" data-important={message.important ? '' : undefined} data-fresh={fresh ? '' : undefined}>
      <button type="button" className={cn('kokpit-row', fresh && 'kokpit-fresh')} data-hover onClick={onOpen}>
        <span className="kokpit-avatar" data-unread="" aria-hidden>
          {initials(message.from)}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-baseline justify-between gap-3">
            <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-fg">
              <span className="truncate">{message.from}</span>
              {message.important ? (
                <span className="shrink-0 text-xs font-medium text-warning" data-testid="today-mail-important">
                  {t('today.mailCard.importantMark')}
                </span>
              ) : null}
            </span>
            <span className="shrink-0 text-xs text-fg tabular-nums">{stamp(message.date, now)}</span>
          </span>
          <span className="truncate text-sm text-fg-muted">{message.subject || t('mail.noSubject')}</span>
        </span>
      </button>
    </li>
  );
}

function MailCard({ card, height, now }: TodayCardProps<MailCardData>) {
  const shell = useShell();
  const data = card.data;
  const accounts = data.accounts ?? [];
  const items = data.items ?? [];
  const open = () => shell.navigate('settings');
  const arrived = useArrival(data.newestAt);
  const fresh = useFreshKeys(items.map((message) => message.id));
  const failing = accounts.filter((account) => account.error);
  const reserve = HEAD_PX + (failing.length > 0 ? 22 : 0) + (data.unread > items.length ? 24 : 0);
  const rows = items.slice(0, fitRows(height, ROW_PX, reserve));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2" data-testid="today-mail">
      <div className="flex items-center justify-between gap-3">
        <div className="kokpit-accounts" data-testid="today-mail-accounts">
          {accounts.map((account) => (
            <span
              key={account.id}
              className="kokpit-account"
              data-error={account.error ? '' : undefined}
              title={account.error ? t('today.mailCard.errorHint', { account: account.label, reason: account.error }) : account.address}
              data-testid="today-mail-account"
            >
              <span>{account.label}</span>
              {account.error ? <WarningCircle weight="bold" className="size-3.5 shrink-0" aria-label={t('today.mailCard.error')} /> : <b>{account.unread}</b>}
            </span>
          ))}
          {data.important > 0 ? <span className="kokpit-account text-warning">{t('today.mailCard.important', { count: data.important })}</span> : null}
        </div>
        {arrived ? (
          <span className="kokpit-new" data-testid="today-mail-new">
            {t('today.live.new')}
          </span>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <div className="kokpit-state" data-testid="today-mail-state" data-state={failing.length > 0 ? 'error' : 'empty'}>
          <span className="kokpit-state-icon" data-tone={failing.length > 0 ? 'danger' : 'live'} aria-hidden>
            {failing.length > 0 ? <WarningCircle weight="bold" /> : <CheckCircle weight="bold" />}
          </span>
          <span>{failing.length > 0 ? t('today.mailCard.errorHint', { account: failing[0]!.label, reason: failing[0]!.error ?? '' }) : t('today.mailCard.empty')}</span>
        </div>
      ) : (
        <>
          <ul className="flex flex-col">
            {rows.map((message) => (
              <MessageRow key={message.id} message={message} now={now} fresh={fresh.has(message.id)} onOpen={open} />
            ))}
          </ul>
          {failing.length > 0 ? (
            <p className="truncate pt-1 text-xs text-danger" data-testid="today-mail-failing">
              {t('today.mailCard.errorHint', { account: failing[0]!.label, reason: failing[0]!.error ?? '' })}
            </p>
          ) : null}
          <More count={data.unread - rows.length} onOpen={open} />
        </>
      )}
    </div>
  );
}

registerTodayCard('mail.important', MailCard, { count: (card) => (card.data as MailCardData).unread || undefined });
