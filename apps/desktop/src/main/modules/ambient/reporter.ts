// Raporcu: günlük → haftalık → aylık. Fuber AI 1'in `gunkaydi/raporcu.ts` dosyasının v2 karşılığı.
// Günlük: günün notlarından. Haftalık: günlük raporlardan (raporu olmayan günün önemli notları yedek). Aylık: haftalık
// raporlardan. Her katman yalnız bir alt katmanın KISA özetini okur; ham döküm hiçbir rapora gitmez.
import type { BrainApi, Logger } from '@fuber/shared';
import { z } from 'zod';
import { currentPeriod, dayKey, dayToDate, monthDays, monthWeeks, weekDays, type ReportKind } from './periods';
import type { AmbientRepo } from './repo';
import type { AmbientReport } from './types';

export const ReportSchema = z.object({
  title: z.string(),
  summary: z.string(),
  important: z.array(z.string()),
  casual: z.array(z.string()),
  decisions: z.array(z.string()),
  open: z.array(z.string()),
  next: z.array(z.string()),
  joke: z.string().nullable(),
});
export type ReportDraft = z.infer<typeof ReportSchema>;

const COMMON = `Bir kişisel asistanın raporcususun. Kısa, net ve sıcak yazarsın; Türkçe. Yalnız sana verilen notlara dayan, uydurma.
"(emin değil)" işaretli notu aktarırken "sanırım" de. Her kalem tek satır, en çok 140 karakter.`;

export const REPORT_INSTRUCTIONS: Record<ReportKind, string> = {
  daily: `${COMMON}
GÜNLÜK RAPOR. Günün notlarından:
- important: önemli olanlar, öncelik sırasıyla (en çok 10). casual: gündelik olanların kısa listesi (en çok 6).
- decisions: verilen kararlar. open: hâlâ bekleyen işler (kimden, ne zaman). next: yarın ya da yakında yapılacaklar.
- joke: gündelik notlardan tek cümlelik, kimseyi kırmayan hafif bir espri; yoksa null.
- title: günün kısa başlığı. summary: iki cümle.`,
  weekly: `${COMMON}
HAFTALIK RAPOR. Haftanın günlük raporlarından; tekrarları ayıkla, aynı konuyu tek kalemde birleştir.
- important: haftanın önemli gelişmeleri ve ilerlemeleri (en çok 12). casual: akılda kalan hafif anlar (en çok 6).
- decisions: haftanın kararları. open: hafta sonunda hâlâ açık olanlar. next: gelecek hafta.
- joke: haftaya dair tek cümle hafif espri ya da null. title ve summary (iki üç cümle).`,
  monthly: `${COMMON}
AYLIK RAPOR. Ayın haftalık raporlarından YALNIZ kalıcı değeri olanları süz: büyük gelişmeler, kararlar, tamamlananlar, tekrar eden konular, ay sonunda açık kalanlar.
- important (en çok 12), casual (en çok 3 hatıra), decisions, open, next. joke null olsun. title ve summary (üç dört cümle).`,
};

const DAY_FORMAT = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', weekday: 'long' });
const MONTH_FORMAT = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' });
export const dayName = (day: string) => DAY_FORMAT.format(dayToDate(day));
export const monthName = (month: string) => MONTH_FORMAT.format(dayToDate(`${month}-01`));
const clock = (iso: string) => {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

export function periodTitle(kind: ReportKind, period: string): string {
  return kind === 'daily' ? dayName(period) : kind === 'weekly' ? `${dayName(weekDays(period)[0]!)} haftası` : monthName(period);
}

/** Dönemde rapor yazılacak veri var mı (v1 `donemdeVeriVar`). */
export function hasReportData(repo: AmbientRepo, kind: ReportKind, period: string): boolean {
  if (kind === 'daily') return repo.hasNotes([period]);
  if (kind === 'weekly') return repo.listReports({ kind: 'daily', periods: weekDays(period), limit: 1 }).length > 0 || repo.hasNotes(weekDays(period));
  return (
    repo.listReports({ kind: 'weekly', periods: monthWeeks(period), limit: 1 }).length > 0 ||
    repo.listReports({ kind: 'daily', periods: monthDays(period), limit: 1 }).length > 0
  );
}

const reportBlock = (heading: string, report: AmbientReport, full: boolean) =>
  [
    `## ${heading}: ${report.title}`,
    report.summary,
    report.important.length ? `Önemli: ${report.important.join(' | ')}` : '',
    full && report.casual.length ? `Gündelik: ${report.casual.join(' | ')}` : '',
    report.decisions.length ? `Kararlar: ${report.decisions.join(' | ')}` : '',
    report.openIssues.length ? `Açık: ${report.openIssues.join(' | ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');

/** Modele giden girdi ve dayandığı kalem sayısı; veri yoksa `null`. */
export function buildReportInput(repo: AmbientRepo, kind: ReportKind, period: string): { input: string; itemCount: number } | null {
  const open = repo.listIssues('open', 30);
  const openLines = open.length
    ? `Şu an açık meseleler:\n${open.map((issue) => `- ${issue.title}${issue.person ? ` (${issue.person})` : ''}${issue.dueDay ? `, hedef ${issue.dueDay}` : ''}`).join('\n')}`
    : '';

  if (kind === 'daily') {
    // Girdi yerel modelin bağlamına sığsın: önemli notların hepsi, gündeliklerin sonuncuları.
    const all = repo.notesOfDay(period);
    if (all.length === 0) return null;
    const important = all.filter((note) => note.important).slice(-40);
    const casual = all.filter((note) => !note.important).slice(-15);
    const notes = [...important, ...casual].sort((a, b) => (a.at < b.at ? -1 : 1));
    const interjections = repo.recentInterjections(30).filter((entry) => dayKey(new Date(entry.at)) === period);
    return {
      itemCount: all.length,
      input: [
        `Gün: ${dayName(period)}`,
        'Notlar:',
        ...notes.map((note) => `- [${clock(note.at)}] (${note.important ? 'önemli' : 'gündelik'}${note.unsure ? ', emin değil' : ''}) ${note.text}`),
        openLines,
        interjections.length ? `Asistanın gün içindeki araya girişleri:\n${interjections.map((entry) => `- ${entry.text}`).join('\n')}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    };
  }

  if (kind === 'weekly') {
    const days = weekDays(period);
    const daily = repo.listReports({ kind: 'daily', periods: days, limit: 7 }).reverse();
    const covered = new Set(daily.map((report) => report.period));
    const fallback = repo.notesOfDays(days.filter((day) => !covered.has(day)), true).slice(-30);
    if (daily.length === 0 && fallback.length === 0) return null;
    return {
      itemCount: daily.reduce((sum, report) => sum + report.important.length + report.casual.length, 0) + fallback.length,
      input: [
        `Hafta: ${dayName(days[0]!)} – ${dayName(days[6]!)}`,
        ...daily.map((report) => reportBlock(dayName(report.period), report, true)),
        fallback.length ? `Raporu olmayan günlerin önemli notları:\n${fallback.map((note) => `- ${note.day}: ${note.text}`).join('\n')}` : '',
        openLines,
      ]
        .filter(Boolean)
        .join('\n\n'),
    };
  }

  const weeks = monthWeeks(period);
  const weekly = repo.listReports({ kind: 'weekly', periods: weeks, limit: 6 }).reverse();
  const coveredDays = new Set(weekly.flatMap((report) => weekDays(report.period)));
  const daily = repo.listReports({ kind: 'daily', periods: monthDays(period).filter((day) => !coveredDays.has(day)), limit: 31 }).reverse();
  if (weekly.length === 0 && daily.length === 0) return null;
  return {
    itemCount: [...weekly, ...daily].reduce((sum, report) => sum + report.important.length, 0),
    input: [
      `Ay: ${monthName(period)}`,
      ...weekly.map((report) => reportBlock(`Hafta ${report.period}`, report, false)),
      ...daily.map((report) => reportBlock(dayName(report.period), report, false)),
    ].join('\n\n'),
  };
}

const lines = (value: string[], max: number) =>
  value
    .map((line) => line.replace(/\s+/g, ' ').trim().slice(0, 220))
    .filter(Boolean)
    .slice(0, max);

export interface ReporterDeps {
  repo: AmbientRepo;
  brain: Pick<BrainApi, 'extract'>;
  log: Logger;
  now(): Date;
}

/**
 * Raporu hazırlar (varsa yeniden yazar). Dönemde veri yoksa `null`; model yanıt veremezse fırlatır (çağıran
 * "not yok" ile "hazırlanamadı"yı karıştırmasın).
 */
export async function buildReport(deps: ReporterDeps, kind: ReportKind, period: string = currentPeriod(kind, deps.now())): Promise<AmbientReport | null> {
  const prepared = buildReportInput(deps.repo, kind, period);
  if (!prepared) return null;
  // Raporlar da yalnız yerel modelde yazılır (ortam dinlemenin bütün çıkarımı bu bilgisayarda kalır).
  const draft = await deps.brain.extract({ role: 'memory', localOnly: true, instructions: REPORT_INSTRUCTIONS[kind], input: prepared.input, schema: ReportSchema });
  if (!draft) throw new Error('rapor hazırlanamadı: model yanıt vermedi');
  return deps.repo.upsertReport({
    kind,
    period,
    title: draft.title.replace(/\s+/g, ' ').trim().slice(0, 140) || periodTitle(kind, period),
    summary: draft.summary.replace(/\s+/g, ' ').trim().slice(0, 800),
    important: lines(draft.important, 12),
    casual: lines(draft.casual, kind === 'monthly' ? 3 : 6),
    decisions: lines(draft.decisions, 12),
    openIssues: lines(draft.open, 12),
    next: lines(draft.next, 8),
    joke: kind === 'monthly' ? null : draft.joke?.replace(/\s+/g, ' ').trim().slice(0, 240) || null,
    itemCount: prepared.itemCount,
  });
}

/** Raporun düz metni (araç yanıtı ve bildirim gövdesi için). */
export function reportText(report: AmbientReport): string {
  return [
    `${periodTitle(report.kind, report.period)}: ${report.title}`,
    report.summary,
    report.important.length ? `Önemli:\n${report.important.map((line) => `- ${line}`).join('\n')}` : '',
    report.decisions.length ? `Kararlar:\n${report.decisions.map((line) => `- ${line}`).join('\n')}` : '',
    report.openIssues.length ? `Bekleyenler:\n${report.openIssues.map((line) => `- ${line}`).join('\n')}` : '',
    report.next.length ? `Sırada:\n${report.next.map((line) => `- ${line}`).join('\n')}` : '',
    report.casual.length ? `Gündelik:\n${report.casual.map((line) => `- ${line}`).join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}
