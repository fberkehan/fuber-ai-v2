import { t } from '@fuber/shared';

const relative = new Intl.RelativeTimeFormat('tr', { numeric: 'auto' });
const dateTime = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const timeOnly = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' });
const weekday = new Intl.DateTimeFormat('tr-TR', { weekday: 'short' });
const dayMonth = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short' });
const integer = new Intl.NumberFormat('tr-TR');

/** "az önce", "3 dakika önce", "dün" … */
export function fromNow(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return t('admin.common.never');
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return t('admin.common.never');
  const seconds = Math.round((at - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return t('time.justNow');
  if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return relative.format(Math.round(seconds / 3600), 'hour');
  if (abs < 86_400 * 7) return relative.format(Math.round(seconds / 86_400), 'day');
  return dateTime.format(at);
}

export function formatDateTime(iso: string): string {
  const at = Date.parse(iso);
  return Number.isNaN(at) ? iso : dateTime.format(at);
}

/** Bugünse yalnız saat, değilse gün + saat. */
export function formatStamp(iso: string, now = new Date()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return at.toDateString() === now.toDateString() ? timeOnly.format(at) : dateTime.format(at);
}

/** `YYYY-MM-DD` (yerel gün) → "Pzt". */
export function formatWeekday(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return weekday.format(new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}

export function formatDayMonth(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return dayMonth.format(new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}

/** Dolar: "0,42 $". Küçük tutarlarda iki hane yetmezse üç hane. */
export function formatUsd(value: number): string {
  const digits = value > 0 && value < 0.01 ? 3 : 2;
  return `${value.toLocaleString('tr-TR', { minimumFractionDigits: digits, maximumFractionDigits: digits })} $`;
}

/** Token: 950 → "950", 12 400 → "12,4 bin", 3 200 000 → "3,2 mn". */
export function formatTokens(value: number): string {
  if (value < 1000) return integer.format(value);
  if (value < 1_000_000) return t('admin.common.thousands', { value: (value / 1000).toLocaleString('tr-TR', { maximumFractionDigits: 1 }) });
  return t('admin.common.millions', { value: (value / 1_000_000).toLocaleString('tr-TR', { maximumFractionDigits: 1 }) });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toLocaleString('tr-TR', { maximumFractionDigits: 0 })} MB`;
  return `${(bytes / 1024 ** 3).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} GB`;
}

export function formatInteger(value: number): string {
  return integer.format(value);
}
