import { describe, expect, it } from 'vitest';
import type { NewsSourceView, NewsTopic } from '../../../../../main/modules/news/types';
import { CARD_METRICS, canAddTopic, clampInt, groupSources, isValidRange, isValidTime, minutesOf, planBriefingCard, shortUrl, splitTopics } from './briefing-logic';

const source = (id: string, category: NewsSourceView['category'], enabled = true, name = id): NewsSourceView => ({
  id,
  name,
  url: `https://${id}.com/rss`,
  category,
  lang: 'tr',
  builtin: true,
  enabled,
  addedAt: '2026-11-17T08:00:00.000Z',
  lastOkAt: null,
  lastError: null,
  itemCount: 0,
});

const topic = (text: string, mode: NewsTopic['mode'], createdAt: string): NewsTopic => ({ id: text, text, mode, origin: 'user', createdAt });

describe('brifing ayarları mantığı', () => {
  it('saati SS:DD biçiminde doğrular', () => {
    expect(isValidTime('08:30')).toBe(true);
    expect(isValidTime('23:59')).toBe(true);
    expect(isValidTime('00:00')).toBe(true);
    expect(isValidTime('24:00')).toBe(false);
    expect(isValidTime('8:30')).toBe(false);
    expect(isValidTime('08:60')).toBe(false);
    expect(isValidTime('')).toBe(false);
    expect(minutesOf('09:15')).toBe(555);
    expect(minutesOf('x')).toBeNull();
  });

  it('gün içi aralık: başlangıç bitişten önce olmalı', () => {
    expect(isValidRange('09:00', '21:00')).toBe(true);
    expect(isValidRange('21:00', '09:00')).toBe(false);
    expect(isValidRange('09:00', '09:00')).toBe(false);
    expect(isValidRange('09:00', '25:00')).toBe(false);
  });

  it('tamsayıyı sıkıştırır', () => {
    expect(clampInt(0, 1, 6)).toBe(1);
    expect(clampInt(9, 1, 6)).toBe(6);
    expect(clampInt(3.4, 1, 6)).toBe(3);
    expect(clampInt(Number.NaN, 1, 6)).toBe(1);
  });

  it('adresi kısaltır', () => {
    expect(shortUrl('https://www.bloomberght.com/rss/')).toBe('bloomberght.com/rss');
    const long = shortUrl('https://feeds.bbci.co.uk/turkce/rss/a/very/long/path/that/keeps/going.xml', 24);
    expect(long).toHaveLength(24);
    expect(long.endsWith('…')).toBe(true);
  });

  it('kaynakları kategori sırasıyla gruplar; etkinler önce, ada göre', () => {
    const groups = groupSources([source('b', 'economy'), source('z', 'tr', false), source('a', 'tr'), source('ç', 'tr', true, 'Çağ'), source('x', 'other')]);
    expect(groups.map((group) => group.category)).toEqual(['tr', 'economy', 'other']);
    expect(groups[0]?.sources.map((entry) => entry.id)).toEqual(['a', 'ç', 'z']);
    expect(groups[0]?.enabled).toBe(2);
  });

  it('bilinmeyen kategorideki kaynak "Diğer"e düşer', () => {
    const odd = { ...source('q', 'other'), category: 'sports' as unknown as NewsSourceView['category'] };
    expect(groupSources([odd]).map((group) => group.category)).toEqual(['other']);
  });

  it('konuları takip ve sessiz diye ayırır, eklenme sırasıyla', () => {
    const split = splitTopics([topic('dolar', 'follow', '2026-11-17T02:00:00Z'), topic('magazin', 'mute', '2026-11-17T01:00:00Z'), topic('yapay zekâ', 'follow', '2026-11-17T01:00:00Z')]);
    expect(split.follow.map((entry) => entry.text)).toEqual(['yapay zekâ', 'dolar']);
    expect(split.mute.map((entry) => entry.text)).toEqual(['magazin']);
  });

  it('aynı konu iki kez eklenmez (Türkçe katlamayla)', () => {
    const topics = [topic('İstanbul', 'follow', '2026-11-17T01:00:00Z')];
    expect(canAddTopic('istanbul', topics)).toBe(false);
    expect(canAddTopic(' ', topics)).toBe(false);
    expect(canAddTopic('Ankara', topics)).toBe(true);
  });
});

describe('brifing kartı yerleşimi', () => {
  const { title, line, news } = CARD_METRICS;

  it('dar kartta iki haberlik yer ayırır, kalanı bölümlere verir', () => {
    const plan = planBriefingCard({ height: title + line * 2 + news * 2, sectionLines: [3, 2], news: 5, split: false });
    expect(plan).toEqual({ lines: [2, 0], news: 2 });
  });

  it('bölümler sığınca artan yer haberlere gider', () => {
    const plan = planBriefingCard({ height: title + line + news * 4, sectionLines: [1], news: 5, split: false });
    expect(plan).toEqual({ lines: [1], news: 4 });
  });

  it('geniş kartta iki sütun bağımsızdır', () => {
    const plan = planBriefingCard({ height: title * 2 + line * 3, sectionLines: [2, 1], news: 10, split: true });
    expect(plan.lines).toEqual([2, 1]);
    expect(plan.news).toBe(Math.floor((title * 2 + line * 3) / news));
  });

  it('çok kısa kartta yarım satır çizilmez; boş bölüm atlanır', () => {
    expect(planBriefingCard({ height: 10, sectionLines: [2], news: 0, split: false })).toEqual({ lines: [0], news: 0 });
    expect(planBriefingCard({ height: 400, sectionLines: [0, 2], news: 0, split: false })).toEqual({ lines: [0, 2], news: 0 });
    expect(planBriefingCard({ height: -50, sectionLines: [2], news: 3, split: false })).toEqual({ lines: [0], news: 0 });
  });
});
