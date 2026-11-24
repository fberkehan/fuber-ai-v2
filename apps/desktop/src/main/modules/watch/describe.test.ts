// v1 `tests/isler-arayuz.test.ts`ten taşındı ve v2'ye uyarlandı: iş kartının ve araç yanıtının cümleleri (süren,
// duraklatılan, biten, iptal edilen; her duraklatma nedeni sakin tek cümle), süre ve sıklık ekleri, onay kartının
// metni. v1'in "İş dili" yasak sözcük kuralı, görev sohbeti ve kokpit sayaçları v2'de yok.
import { describe, expect, it } from 'vitest';
import { t } from '@fuber/shared';
import { approvalText, conditionText, durationText, everyText, jobLine, planText, shortId, statusSentence, whenText } from './describe';
import type { WatchJob, WatchPlan, WatchReason } from './types';

const NOW = new Date('2026-11-16T10:00:00');

const plan = (patch: Partial<WatchPlan> = {}): WatchPlan => ({
  source: { kind: 'page', target: 'https://ornek.com/kulaklik' },
  condition: { type: 'below', value: 1000, near: 'Fiyat' },
  repeat: false,
  speak: true,
  untilAt: new Date('2026-11-16T18:00:00').toISOString(),
  interval: { minSec: 120, maxSec: 1800 },
  maxModelCalls: 20,
  action: null,
  ...patch,
});

const job = (patch: Partial<WatchJob> = {}): WatchJob => ({
  id: '01JD0000000000000000ABCDEF',
  title: 'Kulaklık fiyatı',
  goal: 'fiyat bin liranın altına inince söyle',
  plan: plan(),
  status: 'running',
  reason: null,
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
  lastCheckAt: null,
  nextCheckAt: new Date(NOW.getTime() + 5 * 60_000).toISOString(),
  intervalSec: 120,
  checks: 4,
  changes: 1,
  modelCalls: 0,
  matches: 0,
  errors: 0,
  lastError: null,
  lastChangeAt: null,
  finding: null,
  result: null,
  finishedAt: null,
  sessionId: null,
  ...patch,
});

describe('süre ve sıklık', () => {
  it('süre ekleri: sn, dk, sa, gün', () => {
    expect(durationText(45)).toBe('45 saniye');
    expect(durationText(180)).toBe('3 dakika');
    expect(durationText(5400)).toBe('1 saat 30 dakika');
    expect(durationText(86_400 * 2 + 3600 * 4)).toBe('2 gün 4 saat');
    expect(durationText(0)).toBe('0 saniye');
  });

  it('sıklık: "30 sn’de bir", "2 dk’da bir", "saatte bir"', () => {
    expect(everyText(30)).toBe('30 sn’de bir');
    expect(everyText(120)).toBe('2 dk’da bir');
    expect(everyText(90)).toBe('2 dk’da bir');
    expect(everyText(3600)).toBe('saatte bir');
  });

  it('kısa kimlik ULID’in son dört harfi', () => {
    expect(shortId('01JD0000000000000000ABCDEF')).toBe('CDEF');
  });
});

describe('iş kartı cümleleri', () => {
  it('süren: sonraki bakış göreli; son bakışta sorun varsa o yazılır', () => {
    expect(statusSentence(job(), NOW)).toBe(t('watch.status.running', { next: '5 dk sonra' }));
    expect(statusSentence(job({ nextCheckAt: null }), NOW)).toBe(t('watch.status.runningNow'));
    expect(statusSentence(job({ lastError: 'Sayfa 503 yanıtı verdi.' }), NOW)).toContain('503');
  });

  it('duraklatılan: her neden için sakin tek cümle', () => {
    for (const reason of ['user', 'panic', 'policy', 'errors'] as WatchReason[]) {
      const sentence = statusSentence(job({ status: 'paused', reason }), NOW);
      expect(sentence).toBe(t(`watch.reason.${reason}`));
      expect(sentence).not.toMatch(/\n|undefined|watch\./);
    }
    expect(statusSentence(job({ status: 'paused', reason: null }), NOW)).toBe(t('watch.reason.user'));
  });

  it('biten: sonuç tek satır; sonuç yoksa "tamamlandı"; iptal ve hata', () => {
    expect(statusSentence(job({ status: 'done', reason: 'matched', result: 'Şimdi 999,90;\n1.000 altına indi.' }), NOW)).toBe('Şimdi 999,90; 1.000 altına indi.');
    expect(statusSentence(job({ status: 'done', result: null }), NOW)).toBe(t('watch.status.done'));
    expect(statusSentence(job({ status: 'cancelled' }), NOW)).toBe(t('watch.status.cancelled'));
    expect(statusSentence(job({ status: 'failed', lastError: 'erişim yok' }), NOW)).toContain('erişim yok');
  });

  it('araç satırı: kısa kimlik, ad, durum, sayaçlar; süren işte bulunan', () => {
    const line = jobLine(job({ finding: 'Fiyat 1.050' }), NOW);
    expect(line.startsWith('#CDEF Kulaklık fiyatı: sürüyor, ')).toBe(true);
    expect(line).toContain('4 bakış, 1 değişiklik, 0 yapay zekâ çağrısı');
    expect(line).toContain('bulunan: Fiyat 1.050');
    expect(jobLine(job({ status: 'done', finding: 'Fiyat 999' }), NOW)).not.toContain('bulunan');
  });
});

describe('onay kartı', () => {
  it('ne, ne zaman, nasıl, sonra, son tarih; kod koşulunda "yapay zekâ çağrılmaz"', () => {
    const text = planText(plan(), 'ornek.com/kulaklik sayfası', NOW);
    expect(text.when).toBe(conditionText({ type: 'below', value: 1000, near: 'Fiyat' }));
    expect(text.when).toBe('“Fiyat” 1.000 altına inince');
    expect(text.how).toContain('2 dk’da bir');
    expect(text.how).toContain(t('watch.plan.noModel'));
    expect(text.then).toContain(t('watch.plan.thenSpeak'));
    expect(text.then).toContain(t('watch.plan.once'));
    expect(text.until).toBe(t('watch.plan.until', { at: whenText(plan().untilAt, NOW) }));
    const card = approvalText('Kulaklık fiyatı', text);
    expect(card.split('\n')).toHaveLength(6);
    expect(card).toContain('“Kulaklık fiyatı”');
  });

  it('ask koşulunda model kuralı ve bütçesi; saat işinde aralık yok; yazan eylem ayrıca onay ister', () => {
    expect(planText(plan({ condition: { type: 'ask', question: 'ilan çıktı mı' } }), 'x', NOW).how).toContain('en çok 20 kez');
    const time = planText(plan({ source: { kind: 'time', target: new Date('2026-11-16T17:00:00').toISOString() }, condition: { type: 'changed' } }), 'saat', NOW);
    expect(time.how).toBe(t('watch.plan.howTime'));
    expect(time.when).toBe(t('watch.plan.whenTime', { at: 'bugün 17:00' }));
    const ask = planText(plan({ action: { tool: 'mail_send', input: {} }, repeat: true }), 'x', NOW, true);
    expect(ask.then).toContain(t('watch.plan.thenToolAsk', { tool: 'mail_send' }));
    expect(ask.then).toContain(t('watch.plan.repeat'));
  });
});
