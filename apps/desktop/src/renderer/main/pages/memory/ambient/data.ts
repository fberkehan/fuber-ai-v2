// Ortam dinleme sekmelerinin ortak verisi: durum okuma, kapı hâli, tarih ve dönem biçimleri.
import { formatDay, formatDayLong, fromLocal, localTime, t, type IsoDateTime, type LocalDay } from '@fuber/shared';
import { useShell } from '../../../shell/context';
import { useLive } from '../../../shell/live';
import { RETENTION } from '../../../../../main/modules/ambient/retention';
import type { AmbientStatus, ReportKind } from '../../../../../main/modules/ambient/types';

export const AMBIENT_MODULE = 'ambient';

/** Sekmelerin yeniden okuma tetikleri. */
export const AMBIENT_EVENTS = ['ambient.changed', 'ambient.status'] as const;

/**
 * Kapının hâli. `module_off`: modül yüklü değil (kanallar bağlı değil, hiçbir `ambient.*` çağrısı yapılmaz) ·
 * `policy`: Yönetim izni yok · `consent`: rıza verilmemiş · `off`: rıza var ama şu an dinlemiyor · `on`: dinliyor.
 */
export type GateState = 'module_off' | 'loading' | 'policy' | 'consent' | 'off' | 'on';

export function gateState(moduleOn: boolean, status: AmbientStatus | null): GateState {
  if (!moduleOn) return 'module_off';
  if (!status) return 'loading';
  if (!status.allowed) return 'policy';
  if (!status.consentAt) return 'consent';
  return status.listening ? 'on' : 'off';
}

/** Modül açıksa durumu okur ve olayla yeniler; kapalıysa hiç çağırmaz. */
export function useAmbientStatus(): { moduleOn: boolean; status: AmbientStatus | null; state: GateState; reload: () => void } {
  const shell = useShell();
  const moduleOn = shell.moduleEnabled(AMBIENT_MODULE);
  const live = useLive<AmbientStatus | null>(
    async () => (moduleOn ? window.fuber.invoke('ambient.status') : null),
    AMBIENT_EVENTS,
    [moduleOn],
  );
  return { moduleOn, status: live.data, state: gateState(moduleOn, live.data), reload: live.reload };
}

/**
 * Saklama süreleri (gün): ana süreçle AYNI sabitten (`modules/ambient/retention.ts`, saf dosya). Rıza ekranı ve Ayarlar
 * bu sayıları söyler; saklama görevi de bunları uygular.
 */
export const RETENTION_DAYS = {
  casualNote: RETENTION.casualNoteDays,
  importantNote: RETENTION.importantNoteDays,
  dailyReport: RETENTION.dailyReportDays,
  closedIssue: RETENTION.closedIssueDays,
} as const;

export const clock = (iso: IsoDateTime): string => localTime(iso);

/** "14:05 – 14:12"; aynı dakikaysa tek saat. */
export function clockRange(from: IsoDateTime, to: IsoDateTime): string {
  const start = clock(from);
  const end = clock(to);
  return start === end ? start : `${start} – ${end}`;
}

const MONTH = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' });

/** Rapor döneminin okunur adı: gün "16 Kasım Pazartesi", hafta "47. hafta, 2026", ay "Kasım 2026". */
export function periodLabel(kind: ReportKind, period: string): string {
  if (kind === 'daily') return /^\d{4}-\d{2}-\d{2}$/.test(period) ? formatDayLong(period) : period;
  if (kind === 'weekly') {
    const match = /^(\d{4})-W(\d{2})$/.exec(period);
    return match ? t('ambient.ui.reports.week', { week: Number(match[2]), year: match[1]! }) : period;
  }
  return /^\d{4}-\d{2}$/.test(period) ? MONTH.format(fromLocal(`${period}-01`)) : period;
}

export const dayLabel = (day: LocalDay): string => (/^\d{4}-\d{2}-\d{2}$/.test(day) ? formatDay(day) : day);
