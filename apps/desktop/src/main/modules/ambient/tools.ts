// Ortam dinleme araçları: asistan sohbette kendi notlarına bakabilsin. Fuber AI 1'in `ajan/araclar/gunkaydi.ts`
// dosyasının karşılığı; v1'in altı aracı dörde indi (yerel model küçük: az araç, kısa ad). `gun_kaydi_ara` →
// `ambient_search`; `gun_notlari` + `gun_raporu` + `meseleler` → `ambient_day_summary`; `gun_kaydi_duraklat` →
// `ambient_pause`; yeni: `ambient_forget_recent`. `mesele_guncelle` araç değil, Hafıza › Meseleler'de.
import { defineTool, foldForSearch, t, type LocalDay, type ToolDef } from '@fuber/shared';
import { z } from 'zod';
import { dayKey, shiftDay, topicSimilarity } from './periods';
import { dayName, reportText } from './reporter';
import type { AmbientRepo } from './repo';
import type { AmbientService } from './service';
import type { AmbientIssue, AmbientNote } from './types';

export interface ToolEnv {
  service: AmbientService;
  repo: AmbientRepo;
  now(): Date;
}

const STAMP = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const stamp = (iso: string) => STAMP.format(new Date(iso));
const clock = (iso: string) => {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

/** Emin olunmayan kayıt modele "sanırım" ile gider; model de öyle aktarır (dürüstlük kodda, isteme bırakılmaz). */
const hedge = (text: string, unsure: boolean) => (unsure ? `sanırım: ${text}` : text);
const noteLine = (note: AmbientNote, withDay: boolean) => `[not · ${withDay ? stamp(note.at) : clock(note.at)}${note.important ? ' · önemli' : ''}] ${hedge(note.text, note.unsure)}`;
const issueLine = (issue: AmbientIssue) =>
  `[açık iş${issue.person ? ` · ${issue.person}` : ''}${issue.dueDay ? ` · hedef ${issue.dueDay}` : ''} · ilk ${issue.firstDay}] ${hedge(issue.title, issue.unsure)}`;

/** "bugün", "dün", "evvelsi gün" ya da `YYYY-AA-GG` → yerel gün. Anlaşılmayan girdi bugündür. */
export function resolveDay(input: string | undefined, now: Date): LocalDay {
  const today = dayKey(now);
  const value = foldForSearch((input ?? '').trim());
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (/^(dun|yesterday)$/.test(value)) return shiftDay(today, -1);
  if (/^(evvelsi gun|onceki gun)$/.test(value)) return shiftDay(today, -2);
  return today;
}

const offNote = (env: ToolEnv): string => {
  const status = env.service.status();
  return status.listening ? '' : ' Ortam dinleme şu an kapalı; yeni konuşmalar kaydedilmiyor.';
};

export function createTools(env: () => ToolEnv): ToolDef[] {
  return [
    defineTool({
      name: 'ambient_search',
      group: 'ambient',
      description:
        'Gün boyu ortamdan duyulan konuşmaların notlarında, açık işlerinde ve raporlarında arar. "Kaan\'la ilgili ne dedim", ' +
        '"dün toplantıda ne karar verdik", "o dosya neredeydi" gibi, sohbette değil ORTAMDA geçen konuşmayı soran sorularda kullan. ' +
        'Sonuçtaki "sanırım" sözünü yanıtında koru; sonuç yoksa uydurma, kayıt olmadığını söyle.',
      input: z.object({
        query: z.string().min(1).describe('Aranacak sözcükler: "Kaan teklif", "toplantı karar"'),
        day: z.string().optional().describe('Yalnız bir gün: "bugün", "dün" ya da YYYY-AA-GG'),
      }),
      risk: 'read',
      // Söz ortam kümesini açınca beyne kısa durum gider: içerik değil, sayı (notlara araçla ulaşılır).
      contextHint: () => {
        try {
          const { repo, now } = env();
          const important = repo.notesOfDay(dayKey(now())).filter((note) => note.important).length;
          const open = repo.listIssues('open', 80).length;
          return important || open ? `Ortam dinleme: bugün ${important} önemli not, ${open} açık iş var (ambient_search, ambient_day_summary).` : null;
        } catch {
          return null;
        }
      },
      async run({ query, day }, _ctx) {
        const { repo, now } = env();
        const only = day ? resolveDay(day, now()) : null;
        const lines: string[] = [];
        for (const note of repo.searchNotes(query, 12)) if (!only || note.day === only) lines.push(noteLine(note, true));
        for (const issue of repo.listIssues('open', 60)) if (topicSimilarity(query, `${issue.title} ${issue.person ?? ''}`) >= 0.4) lines.push(issueLine(issue));
        if (!only) for (const report of repo.searchReports(query, 2)) lines.push(`[rapor · ${report.period}] ${report.title}: ${report.summary.slice(0, 240)}`);
        // Ham döküm bu araçtan ASLA dönmez: araç sonucu bulut beynine gidebilir, döküm bilgisayardan çıkmaz. Henüz
        // notlanmamış söz varsa yalnız sayısı söylenir (yerel model notlayınca aranabilir).
        const pending = repo.pendingSegments(200).filter((segment) => !only || segment.day === only).length;
        const waiting = pending ? ` ${pending} satır döküm henüz nota çevrilmedi.` : '';
        if (lines.length === 0) return { ok: true, text: `Ortam notlarında bununla ilgili bir şey yok.${waiting}${offNote(env())}`, data: [] };
        return { ok: true, text: `${lines.length} kayıt bulundu:\n${lines.slice(0, 14).join('\n')}${waiting ? `\n${waiting.trim()}` : ''}` };
      },
    }),
    defineTool({
      name: 'ambient_day_summary',
      group: 'ambient',
      description:
        'Bir günün ortam özetini verir: o gün ortamda konuşulanların notları, kararlar ve açık işler. "Bugün ne konuştuk", ' +
        '"dün neler oldu", "bugün kime ne söz verdim" sorularında kullan. Gün verilmezse bugün.',
      input: z.object({ day: z.string().optional().describe('"bugün", "dün" ya da YYYY-AA-GG') }),
      risk: 'read',
      async run({ day }, _ctx) {
        const { repo, now } = env();
        const target = resolveDay(day, now());
        const report = repo.getReport('daily', target);
        const notes = repo.notesOfDay(target);
        const open = repo.listIssues('open', 12);
        const issues = open.length ? `\nAçık işler:\n${open.map(issueLine).join('\n')}` : '';
        if (report) return { ok: true, text: `${reportText(report)}${issues}` };
        if (notes.length === 0) {
          const pending = repo.segmentsOfDay(target).length;
          const waiting = pending ? ` ${pending} satır döküm var ama henüz nota çevrilmedi.` : '';
          return { ok: true, text: `${dayName(target)} için ortam notu yok.${waiting}${offNote(env())}${issues}` };
        }
        const important = notes.filter((note) => note.important);
        const casual = notes.filter((note) => !note.important);
        return {
          ok: true,
          text: [
            `${dayName(target)}: ${notes.length} not (rapor henüz yazılmadı).`,
            important.length ? `Önemli:\n${important.slice(-14).map((note) => noteLine(note, false)).join('\n')}` : '',
            casual.length ? `Gündelik:\n${casual.slice(-6).map((note) => noteLine(note, false)).join('\n')}` : '',
            issues.trim(),
          ]
            .filter(Boolean)
            .join('\n'),
        };
      },
    }),
    defineTool({
      name: 'ambient_pause',
      group: 'ambient',
      description:
        'Ortam dinlemeyi duraklatır ya da sürdürür. Kullanıcı "ortam dinlemeyi durdur", "özel konuşacağız", "misafir var, bir saat dinleme" ' +
        'derse kullan. minutes: kaç dakika duracağı; 0 = duraklatmayı kaldır.',
      input: z.object({ minutes: z.number().int().min(0).max(24 * 60).describe('Dakika; 0 = sürdür') }),
      // Duraklatma gizliliği artıran bir iştir; konuşmacı doğrulaması takılsa da çalışmalı.
      risk: 'read',
      async run({ minutes }, _ctx) {
        const status = env().service.pauseMinutes(minutes);
        if (minutes > 0) {
          return status.reason === 'paused'
            ? { ok: true, text: `Ortam dinleme ${minutes} dakika duraklatıldı; bu sürede hiçbir söz yazılmaz.` }
            : { ok: true, text: `Ortam dinleme zaten kapalı (${t(`ambient.reason.${status.reason}`)}); ${minutes} dakikalık duraklatma da kaydedildi.` };
        }
        return status.listening
          ? { ok: true, text: 'Duraklatma kaldırıldı; ortam dinleme sürüyor.' }
          : { ok: false, text: `Duraklatma kaldırıldı ama ortam dinleme şu an çalışmıyor: ${t(`ambient.reason.${status.reason}`)}` };
      },
    }),
    defineTool({
      name: 'ambient_set',
      group: 'ambient',
      description:
        'Ortam dinlemeyi (gün boyu not tutma) AÇAR ya da KAPATIR. "Ortam dinlemeyi kapat" denince on=false, "ortam dinlemeyi aç" denince ' +
        'on=true. Mikrofonu kapatmak için DEĞİLDİR. İlk açılış kullanıcının Ayarlar’dan verdiği rızayı ister; araç bunu söyler.',
      input: z.object({ on: z.boolean() }),
      // Kapatma gizliliği artırır, konuşmacı doğrulaması takılsa da çalışmalı; açma rıza kapısından geçer (aşağıda).
      risk: 'read',
      async run({ on }, _ctx) {
        const { service } = env();
        const before = service.status();
        if (!on) {
          if (!before.prefs.enabled) return { ok: true, text: 'Ortam dinleme zaten kapalı. Kullanıcıya yalnız şunu söyle: "Ortam dinleme zaten kapalı."' };
          service.setPrefs({ enabled: false });
          return { ok: true, text: 'Ortam dinleme kapatıldı. Kullanıcıya yalnız şunu söyle: "Ortam dinlemeyi kapattım."' };
        }
        if (!before.allowed) return { ok: false, text: `Açılmadı. Kullanıcıya yalnız şunu söyle: "${t('ambient.ui.gate.policy.body')}"` };
        if (!before.consentAt) {
          return { ok: false, text: 'Açılmadı: rıza yok. Kullanıcıya yalnız şunu söyle: "Ortam dinlemeyi ilk kez açmak için Ayarlar’daki Gizlilik ve veri bölümünden onay vermeniz gerekiyor."' };
        }
        if (before.pausedUntil) service.pauseMinutes(0);
        const after = service.setPrefs({ enabled: true });
        return after.listening
          ? { ok: true, text: 'Ortam dinleme açıldı. Kullanıcıya yalnız şunu söyle: "Ortam dinlemeyi açtım."' }
          : { ok: true, text: `Ortam dinleme açık ama şu an dinlemiyor: ${t(`ambient.reason.${after.reason}`)}. Kullanıcıya bunu kısaca söyle.` };
      },
    }),
    defineTool({
      name: 'ambient_forget_recent',
      group: 'ambient',
      description:
        'Ortam dinlemenin son dakikalarda duyduklarını KALICI olarak siler: döküm ve ondan çıkan notlar, işler. Kullanıcı ' +
        '"son on dakikayı sil", "az önce konuşulanı unut" derse kullan. Silindiğini ancak bu araç başarılı dönerse söyle.',
      input: z.object({ minutes: z.number().int().min(1).max(180).default(10).describe('Kaç dakika geriye; varsayılan 10') }),
      risk: 'write',
      async run({ minutes }, _ctx) {
        const removed = env().service.forgetRecent(minutes);
        return {
          ok: true,
          text: `Son ${minutes} dakika silindi: ${removed.segments} döküm satırı, ${removed.notes} not, ${removed.issues} iş. Geri getirilemez.`,
          data: removed,
        };
      },
    }),
  ];
}
