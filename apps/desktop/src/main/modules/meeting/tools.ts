// Toplantı araçları: sesle/sohbetten başlat, bitir, özetle ve geçmiş toplantıda ne konuşulduğunu bul. Fuber AI 1'de
// toplantı araçla yönetilmiyordu (yalnız arayüz); dört araç, yerel modelin `meeting` kümesinde (`local-tools.ts`).
import { defineTool, foldForSearch, type Bus, type ToolDef } from '@fuber/shared';
import { z } from 'zod';
import { durationText, isMeetingLanguage } from './pure';
import type { MeetingRepo } from './repo';
import type { MeetingService } from './service';
import type { Meeting, MeetingSummary } from './types';

export interface ToolEnv {
  service: MeetingService;
  repo: MeetingRepo;
  bus: Bus;
  now(): Date;
}

const STAMP = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', weekday: 'long', hour: '2-digit', minute: '2-digit' });
const when = (meeting: Meeting) => STAMP.format(new Date(meeting.startedAt));
const length = (meeting: Meeting) => (meeting.endedAt ? durationText(Date.parse(meeting.endedAt) - Date.parse(meeting.startedAt)) : null);

/** Özetin modele giden metni. Dayanağı doğrulanmış maddeler; yoksa açıkça "yok". */
export function summaryText(meeting: Meeting, summary: MeetingSummary): string {
  const block = (title: string, items: MeetingSummary['points'], empty: string) =>
    `${title}:\n${items.length ? items.map((item) => `- ${item.text}${item.owner ? ` (${item.owner})` : ''}${item.due ? ` [${item.due}]` : ''}${item.todoId ? ' (Planlar’da)' : ''}`).join('\n') : `- ${empty}`}`;
  return [
    `Toplantı: "${meeting.title}" · ${when(meeting)}${length(meeting) ? ` · ${length(meeting)}` : ''}`,
    block('Ana noktalar', summary.points, 'yok'),
    block('Kararlar', summary.decisions, 'kayıtta karar yok'),
    block('Yapılacaklar', summary.actions, 'kayıtta yapılacak yok'),
  ].join('\n');
}

const problemText = (meeting: Meeting): string => {
  switch (meeting.summaryProblem) {
    case 'needs_deep':
      return `Bu toplantının özeti yok: uzun toplantıyı özetlemek için derin beyin gerekiyor ve şu an yok${meeting.summaryDetail ? ` (${meeting.summaryDetail})` : ''}.`;
    case 'no_brain':
      return 'Bu toplantının özeti yok: şu an hiçbir dil modeli çalışmıyor.';
    case 'empty':
      return 'Bu toplantıda yazıya dökülmüş konuşma yok.';
    default:
      return 'Bu toplantının özeti yazılamadı.';
  }
};

export function createTools(env: () => ToolEnv): ToolDef[] {
  return [
    defineTool({
      name: 'meeting_start',
      group: 'meeting',
      description:
        'Toplantı modunu başlatır: kullanıcının sesi ve bilgisayardan gelen karşı tarafın sesi yazıya dökülür, anlık çeviri ve yanıt önerisi ekranda görünür. ' +
        'Kullanıcı "toplantı modunu aç", "görüşmeyi yazıya dök", "toplantıyı kaydet" derse kullan.',
      input: z.object({
        topic: z.string().optional().describe('Toplantının konusu (söylendiyse)'),
        translate_to: z.string().optional().describe('Çeviri dili kodu: tr, en, de… (söylendiyse)'),
      }),
      risk: 'write',
      async run({ topic, translate_to }) {
        const { service, bus } = env();
        const before = service.status();
        if (before.active?.state === 'live') return { ok: true, text: 'Toplantı modu zaten açık; yazıya dökme sürüyor.' };
        if (!before.consentAt) {
          bus.emit('app.navigate', { page: 'meeting' });
          return { ok: false, text: 'Kullanıcıya yalnız şunu söyle: "Toplantı modunu ilk kez açmadan önce onayınız gerekiyor; Toplantı sayfasını açtım."' };
        }
        try {
          const status = service.begin({
            ...(topic?.trim() ? { context: { topic: topic.trim() } } : {}),
            ...(translate_to && isMeetingLanguage(translate_to) ? { target: translate_to } : {}),
          });
          const system = status.active?.system ? ' ve bilgisayarın sesi' : '';
          return { ok: true, text: `Toplantı modu açıldı: mikrofon${system} yazıya dökülüyor; ses saklanmıyor. Toplantı sürerken sesli konuşmayacağım, her şey ekranda.` };
        } catch (error) {
          return { ok: false, text: `Toplantı modu açılamadı: ${(error as Error).message}` };
        }
      },
    }),
    defineTool({
      name: 'meeting_stop',
      group: 'meeting',
      description: 'Süren toplantı modunu bitirir ve özetini hazırlar. "Toplantıyı bitir", "toplantı modunu kapat", "kaydı durdur" denince kullan.',
      input: z.object({}),
      // Durdurmak gizliliği artırır; konuşmacı doğrulaması takılsa da çalışmalı.
      risk: 'read',
      async run() {
        const { service } = env();
        const meeting = service.status().active;
        if (!meeting || meeting.state !== 'live') return { ok: true, text: 'Süren bir toplantı yok.' };
        void service.end({ reason: 'user' });
        return { ok: true, text: `Toplantı bitti (${meeting.lineCount} satır). Özeti hazırlanıyor; Toplantı sayfasında görünecek.` };
      },
    }),
    defineTool({
      name: 'meeting_summary',
      group: 'meeting',
      description:
        'Son (ya da süren) toplantının özetini verir: ana noktalar, kararlar, yapılacaklar. "Toplantıyı özetle", "toplantıda ne konuştuk" denince kullan; ' +
        'şu an toplantı sürmüyorsa da çağır (son biten toplantıyı özetler). ' +
        'Sonuçta olmayan bir şeyi söyleme.',
      input: z.object({}),
      risk: 'read',
      async run() {
        const { service, repo } = env();
        const live = service.status().active;
        if (live?.state === 'live') {
          const lines = repo.lines(live.id).slice(-8);
          return {
            ok: true,
            text: `Toplantı sürüyor (${live.lineCount} satır); özet bitince yazılır. Son konuşulanlar:\n${lines.map((line) => `${line.speaker === 'me' ? 'Siz' : 'Karşı taraf'}: ${line.text}`).join('\n') || '- henüz satır yok'}`,
          };
        }
        const last = repo.ended(1)[0];
        if (!last) return { ok: true, text: 'Kayıtlı toplantı yok.' };
        if (last.summary) return { ok: true, text: summaryText(last, last.summary) };
        if (last.lineCount > 0 && last.summaryProblem !== 'needs_deep' && last.summaryProblem !== 'no_brain') {
          const updated = await service.summarize(last.id);
          if (updated.summary) return { ok: true, text: summaryText(updated, updated.summary) };
          return { ok: true, text: problemText(updated) };
        }
        return { ok: true, text: problemText(last) };
      },
    }),
    defineTool({
      name: 'meeting_recall',
      group: 'meeting',
      description:
        'Geçmiş toplantılarda konuşulanı bulur: kararlar, yapılacaklar ve döküm satırları. "Geçen toplantıda ne karar verdik", ' +
        '"Kaan\'la toplantıda fiyat konuşmuştuk, ne demişti" gibi sorularda kullan. Kayıt yoksa uydurma, olmadığını söyle.',
      input: z.object({ query: z.string().optional().describe('Aranacak sözcükler: "fiyat indirim", "teslim tarihi"; boşsa son toplantı') }),
      risk: 'read',
      async run({ query }) {
        const { repo } = env();
        const meetings = repo.ended(20);
        if (meetings.length === 0) return { ok: true, text: 'Kayıtlı toplantı yok.' };
        const asked = foldForSearch(query ?? '').split(/\s+/).filter((word) => word.length >= 3);
        if (asked.length === 0) {
          const last = meetings[0] as Meeting;
          return { ok: true, text: last.summary ? summaryText(last, last.summary) : `${when(last)} toplantısı: ${problemText(last)}` };
        }
        const hits: string[] = [];
        for (const meeting of meetings) {
          if (!meeting.summary) continue;
          for (const [label, items] of [['karar', meeting.summary.decisions], ['yapılacak', meeting.summary.actions], ['nokta', meeting.summary.points]] as const) {
            for (const item of items) {
              const folded = foldForSearch(item.text);
              if (asked.some((word) => folded.includes(word))) hits.push(`[${label} · ${when(meeting)} · "${meeting.title}"] ${item.text}`);
            }
          }
        }
        const byId = new Map(meetings.map((meeting) => [meeting.id, meeting]));
        for (const line of repo.searchLines(query ?? '', 8)) {
          const meeting = byId.get(line.meetingId);
          if (!meeting) continue;
          hits.push(`[döküm · ${when(meeting)} · ${line.speaker === 'me' ? 'Siz' : 'Karşı taraf'}] ${line.text.slice(0, 240)}`);
        }
        if (hits.length === 0) return { ok: true, text: `Toplantı kayıtlarında "${query}" ile ilgili bir şey yok.` };
        return { ok: true, text: `${hits.length} kayıt bulundu:\n${hits.slice(0, 14).join('\n')}` };
      },
    }),
  ];
}
