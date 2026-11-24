// Kokpit "E-posta" kartının verisi (yalnız okuma; mevcut depo sorgularıyla): hesap başına okunmamış sayısı, son okunmamış
// iletiler (gönderen, konu, saat, önem işareti) ve eşitleme hatası. Hesap yoksa kart gelmez (panoda boş kart yok).
import type { Id, IsoDateTime } from '@fuber/shared';
import type { MailService } from './service';

export interface MailCardAccount {
  id: Id;
  label: string;
  address: string;
  unread: number;
  /** Son eşitleme hatası (kısa, Türkçe); yoksa null. */
  error: string | null;
}

export interface MailCardItem {
  id: Id;
  accountId: Id;
  from: string;
  subject: string;
  date: IsoDateTime;
  /** Önem puanı 4+ (kural ya da model). */
  important: boolean;
}

export interface MailCardData {
  accounts: MailCardAccount[];
  /** Son okunmamış iletiler (toplu gönderimler hariç), yeniden eskiye. */
  items: MailCardItem[];
  /** Bütün hesaplarda okunmamış ileti toplamı. */
  unread: number;
  /** Okunmamışlar arasında önemli olanların sayısı (son üç gün). */
  important: number;
  /** En yeni iletinin anı (canlı vurgu için: yeni ileti geldi mi). */
  newestAt: IsoDateTime | null;
}

/** "Ad Soyad <adres>" → "Ad Soyad"; ad yoksa adres. */
const senderOf = (name: string, address: string): string => name.replace(/^["']+|["']+$/g, '').trim() || address;

export function mailCard(mail: MailService, limit: number): MailCardData | null {
  if (!mail.hasAccounts()) return null;
  const accounts = mail.accounts().map((account) => ({
    id: account.id,
    label: account.label || account.address,
    address: account.address,
    unread: account.unreadCount,
    error: account.lastError,
  }));
  const rows = mail.list({ unreadOnly: true, limit: 40 }).filter((row) => row.bulk === 0);
  const items = rows.slice(0, limit).map((row) => ({
    id: row.id,
    accountId: row.account_id,
    from: senderOf(row.from_name, row.from_address),
    subject: row.subject,
    date: row.date,
    important: (row.importance ?? 0) >= 4,
  }));
  const newest = mail.list({ limit: 1 })[0];
  return {
    accounts,
    items,
    unread: accounts.reduce((sum, account) => sum + account.unread, 0),
    important: mail.important(20).length,
    newestAt: newest ? newest.date : null,
  };
}
