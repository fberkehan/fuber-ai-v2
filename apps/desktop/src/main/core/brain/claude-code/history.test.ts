// Kalıcı sürecin geçmişi: süreklilik, aradaki (sürecin görmediği) turlar ve yeni sürecin önsözü.
import { describe, expect, it } from 'vitest';
import type { ConvMessage } from '../providers/types';
import { planHistory, renderHistoryBlock, renderMissedBlock } from './history';

const user = (text: string): ConvMessage => ({ role: 'user', text });
const bot = (text: string): ConvMessage => ({ role: 'assistant', text, toolCalls: [] });

describe('planHistory', () => {
  it('yeni süreç: bütün geçmiş önsöz olur', () => {
    const plan = planHistory([user('merhaba'), bot('Merhaba efendim.'), user('saat kaç')], null);
    expect(plan).toEqual({ mode: 'fresh', history: [user('merhaba'), bot('Merhaba efendim.')], restart: false });
  });

  it('süren konuşma: yalnız yeni söz gider', () => {
    const plan = planHistory([user('merhaba'), bot('Merhaba efendim.'), user('nasılsın')], { lastUser: 'merhaba', lastReply: 'Merhaba efendim.' });
    expect(plan).toEqual({ mode: 'continue', missed: [] });
  });

  it('geçmişteki notlar ve gün etiketi eşleşmeyi bozmaz; yarıda kesilen yanıt başından tanınır', () => {
    const plan = planHistory(
      [user('[dün 14:05] KDV için hatırlatıcı kur'), bot('KDV hatırlatıcısını (yanıt burada yarıda kesildi)'), user('teşekkürler')],
      { lastUser: 'KDV için hatırlatıcı kur', lastReply: 'KDV hatırlatıcısını kurdum efendim; yarın sabah dokuzda haber veririm.' },
    );
    expect(plan).toEqual({ mode: 'continue', missed: [] });
    const done = planHistory([user('KDV için hatırlatıcı kur'), bot('Kurdum efendim. (yapıldı: reminder_create)'), user('sağ ol')], {
      lastUser: 'KDV için hatırlatıcı kur',
      lastReply: 'Kurdum efendim.',
    });
    expect(done).toEqual({ mode: 'continue', missed: [] });
  });

  it('aradaki turlar (kodla yanıtlanan, yerele düşen) "kaçırılan" olarak aktarılır', () => {
    const plan = planHistory([user('merhaba'), bot('Merhaba efendim.'), user('saat kaç'), bot('Saat 14:05.'), user('peki yarın hava nasıl')], {
      lastUser: 'merhaba',
      lastReply: 'Merhaba efendim.',
    });
    expect(plan).toEqual({ mode: 'continue', missed: [user('saat kaç'), bot('Saat 14:05.')] });
  });

  it('sürecin sözüne başka bir sağlayıcı yanıt verdiyse o yanıt da aktarılır', () => {
    const plan = planHistory([user('bir fıkra anlat'), bot('Yerel modelin fıkrası.'), user('bir tane daha')], { lastUser: 'bir fıkra anlat', lastReply: '' });
    expect(plan).toEqual({ mode: 'continue', missed: [bot('Yerel modelin fıkrası.')] });
  });

  it('iz kaybolduysa (pencere kaydı) süreç yenilenir; geçmiş boşsa sürdürülür', () => {
    const lost = planHistory([user('çok eski olmayan söz'), bot('yanıt'), user('yeni')], { lastUser: 'pencereden düşmüş söz', lastReply: 'x' });
    expect(lost).toEqual({ mode: 'fresh', history: [user('çok eski olmayan söz'), bot('yanıt')], restart: true });
    expect(planHistory([user('yeni')], { lastUser: 'kaydedilmemiş söz', lastReply: '' })).toEqual({ mode: 'continue', missed: [] });
  });
});

describe('önsöz blokları', () => {
  it('geçmişi düz döküme çevirir; boşsa blok yoktur', () => {
    const block = renderHistoryBlock([user('merhaba'), bot('Merhaba efendim.')], 'Jarvis');
    expect(block).toContain('<onceki_konusma>');
    expect(block).toContain('Kullanıcı: merhaba');
    expect(block).toContain('Jarvis: Merhaba efendim.');
    expect(block).toContain('yeniden yerine getirme');
    expect(renderHistoryBlock([], 'Jarvis')).toBe('');
    expect(renderMissedBlock([], 'Jarvis')).toBe('');
  });

  it('çok uzun geçmişte en eskiler atılır, tek ileti kısaltılır', () => {
    const long = Array.from({ length: 40 }, (_unused, index) => user(`${index}: ${'a'.repeat(1500)}`));
    const block = renderHistoryBlock(long, 'Jarvis');
    expect(block.length).toBeLessThan(26_000);
    expect(block).toContain('39: ');
    expect(block).not.toContain('Kullanıcı: 0: ');
    expect(renderMissedBlock([user('x'.repeat(5000))], 'Jarvis')).toContain('…');
  });
});
