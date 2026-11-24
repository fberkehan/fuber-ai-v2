// İşlerin insan dili: onay kartı, iş kartı, araç yanıtları ve arayüz aynı cümleleri kullanır. Saf ve Node'suz:
// sayfa da bu dosyayı içe aktarır (`renderer/main/pages/watch`). Birim sınamalı (`describe.test.ts`).
import { localTime, relativeDay, relativeTime, t } from '@fuber/shared';
import type { WatchCondition, WatchJob, WatchPlan } from './types';

export const clipText = (text: string, n: number) => {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
};

export const numberText = (value: number) => value.toLocaleString('tr-TR', { maximumFractionDigits: 2 });

/** "45 saniye", "3 dakika", "1 saat 30 dakika", "2 gün 4 saat". */
export function durationText(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  const days = Math.floor(s / 86_400);
  const hours = Math.floor((s % 86_400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const parts = [
    days ? `${days} gün` : '',
    hours ? `${hours} saat` : '',
    minutes && !days ? `${minutes} dakika` : '',
    seconds && !hours && !days ? `${seconds} saniye` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' ') : '0 saniye';
}

/** "30 sn’de bir", "2 dk’da bir", "saatte bir". */
export function everyText(sec: number): string {
  if (sec >= 3600) return 'saatte bir';
  if (sec >= 60) return `${Math.round(sec / 60)} dk’da bir`;
  return `${sec} sn’de bir`;
}

/** Koşulun insan dili: "“stokta” yazısı görününce". */
export function conditionText(condition: WatchCondition): string {
  switch (condition.type) {
    case 'changed':
      return t('watch.cond.changed');
    case 'appears':
      return t('watch.cond.appears', { text: clipText(condition.text, 80) });
    case 'disappears':
      return t('watch.cond.disappears', { text: clipText(condition.text, 80) });
    case 'matches':
      return t('watch.cond.matches', { text: clipText(condition.pattern, 80) });
    case 'below':
      return t(condition.near ? 'watch.cond.belowNear' : 'watch.cond.below', { value: numberText(condition.value), near: clipText(condition.near ?? '', 40) });
    case 'above':
      return t(condition.near ? 'watch.cond.aboveNear' : 'watch.cond.above', { value: numberText(condition.value), near: clipText(condition.near ?? '', 40) });
    case 'drops':
      return t(condition.near ? 'watch.cond.dropsNear' : 'watch.cond.drops', { near: clipText(condition.near ?? '', 40) });
    case 'rises':
      return t(condition.near ? 'watch.cond.risesNear' : 'watch.cond.rises', { near: clipText(condition.near ?? '', 40) });
    case 'ask':
      return t('watch.cond.ask', { text: clipText(condition.question, 120) });
  }
}

/** "bugün 18:00", "Cuma 09:30". */
export function whenText(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  return `${relativeDay(date, now)} ${localTime(date)}`;
}

export interface PlanText {
  /** Ne izlenecek (kaynağın kendi anlatımı). */
  what: string;
  /** Ne olunca haber verilecek. */
  when: string;
  /** Nasıl denetlenecek (aralık, model kuralı). */
  how: string;
  /** Ne zamana dek. */
  until: string;
  /** Koşul tutunca ne yapılacak. */
  then: string;
}

/** Onay kartının ve iş kartının metni. `sourceText`: kaynağın `describe(target)` sonucu. */
export function planText(plan: WatchPlan, sourceText: string, now: Date = new Date(), actionNeedsApproval = false): PlanText {
  const model = plan.condition.type === 'ask' ? t('watch.plan.modelOnChange', { calls: plan.maxModelCalls }) : t('watch.plan.noModel');
  const how =
    plan.source.kind === 'time'
      ? t('watch.plan.howTime')
      : `${t('watch.plan.how', { every: everyText(plan.interval.minSec), max: durationText(plan.interval.maxSec) })} ${model}`;
  const action = plan.action ? t(actionNeedsApproval ? 'watch.plan.thenToolAsk' : 'watch.plan.thenRead', { tool: plan.action.tool }) : '';
  const then = [plan.speak ? t('watch.plan.thenSpeak') : t('watch.plan.thenNotify'), action, plan.repeat ? t('watch.plan.repeat') : t('watch.plan.once')].filter(Boolean).join(' ');
  return {
    what: sourceText,
    when: plan.source.kind === 'time' ? t('watch.plan.whenTime', { at: whenText(plan.source.target, now) }) : conditionText(plan.condition),
    how,
    until: t('watch.plan.until', { at: whenText(plan.untilAt, now) }),
    then,
  };
}

/** Onay kartındaki tek parça metin (ada, sohbet, Bugün sayfası aynı metni gösterir). */
export function approvalText(title: string, text: PlanText): string {
  return [
    t('watch.approval.lead', { title }),
    // Satır sonları her yüzeyde korunmaz (Bugün kartı tek paragraf çizer): her parça noktayla biter.
    `${t('watch.approval.what')}: ${text.what}.`,
    `${t('watch.approval.when')}: ${text.when}.`,
    `${t('watch.approval.how')}: ${text.how}`,
    `${t('watch.approval.then')}: ${text.then}`,
    text.until,
  ].join('\n');
}

/** Kısa kimlik (ULID'in son dört harfi): sesle ve yazıyla söylenebilir. */
export const shortId = (id: string) => id.slice(-4);

/** İşin durumunu anlatan tek cümle (kart, araç yanıtı). */
export function statusSentence(job: WatchJob, now: Date = new Date()): string {
  switch (job.status) {
    case 'running': {
      if (job.lastError) return t('watch.status.runningIssue', { error: clipText(job.lastError, 120) });
      const next = job.nextCheckAt ? relativeTime(job.nextCheckAt, now) : null;
      return next ? t('watch.status.running', { next }) : t('watch.status.runningNow');
    }
    case 'paused':
      return t(`watch.reason.${job.reason ?? 'user'}`);
    case 'done':
      return job.result ? t('watch.status.doneWith', { result: clipText(job.result, 160) }) : t('watch.status.done');
    case 'failed':
      return t('watch.status.failed', { error: clipText(job.lastError ?? '', 160) });
    case 'cancelled':
      return t('watch.status.cancelled');
  }
}

/** Araçların (ve sesli yanıtın) tek satırı: "#K3QZ Kulaklık fiyatı: sürüyor, sonraki denetim 2 dk sonra · 4 denetim, 0 değişiklik". */
export function jobLine(job: WatchJob, now: Date = new Date()): string {
  const counts = t('watch.line.counts', { checks: job.checks, changes: job.changes, calls: job.modelCalls });
  const found = job.finding && job.status === 'running' ? ` · ${t('watch.line.found', { finding: clipText(job.finding, 120) })}` : '';
  return `#${shortId(job.id)} ${job.title}: ${t(`watch.state.${job.status}`)}, ${statusSentence(job, now)} · ${counts}${found}`;
}
