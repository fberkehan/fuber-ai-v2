import { describe, expect, it } from 'vitest';
import { fakeFetch, fixture } from './fake-fetch';
import { createNews, filterByTopic, mergeHeadlines, NEWS_SOURCES, parseFeed, type Headline } from './news';

const trt = NEWS_SOURCES.TR![0]!;

describe('RSS', () => {
  it('TRT biçiminde sentetik akış: başlık, bağlantı, zaman (yalnız başlık; özet alınmaz)', () => {
    const items = parseFeed(fixture('trt.rss'), trt);
    expect(items).toHaveLength(4);
    expect(items[0]).toMatchObject({ title: 'Meteorolojiden 6 il için kuvvetli yağış uyarısı', source: 'TRT Haber' });
    expect(items[0]!.url).toBe('https://www.trthaber.com/haber/gundem/ornek-kuvvetli-yagis-uyarisi-100001.html');
    expect(items[0]!.at).toBe('2026-11-16T09:52:00.000Z');
    expect(Object.keys(items[0]!)).toEqual(['title', 'url', 'source', 'at']);
  });

  it('"İ" harfi kapanış etiketinin yerini kaydırmaz; CDATA ve Atom', () => {
    const rss = `<rss><channel><item><description>İİİİİİİİ İran İzmir</description><title><![CDATA[İran: Hürmüz Boğazı'nda gerilim]]></title><link>https://ornek.com/a?utm_source=rss</link></item></channel></rss>`;
    expect(parseFeed(rss, trt)[0]).toMatchObject({ title: "İran: Hürmüz Boğazı'nda gerilim", url: 'https://ornek.com/a' });
    const atom = `<feed><entry><title>Atom başlığı</title><link rel="alternate" href="https://ornek.com/b"/><updated>2026-11-16T08:00:00Z</updated></entry></feed>`;
    expect(parseFeed(atom, trt)[0]).toMatchObject({ title: 'Atom başlığı', url: 'https://ornek.com/b', at: '2026-11-16T08:00:00.000Z' });
    const bad = `<rss><item><title>Kötü</title><link>javascript:alert(1)</link></item></rss>`;
    expect(parseFeed(bad, trt)).toEqual([]);
  });

  it('birleştirme: aynı başlık bir kez, en yeni önce, bir kaynaktan üst üste en çok iki', () => {
    const make = (source: string, minute: number, title = `${source} ${minute}`): Headline => ({ title, url: `https://${source}.com/${minute}`, source, at: new Date(Date.UTC(2026, 10, 16, 10, minute)).toISOString() });
    const merged = mergeHeadlines([[make('a', 59), make('a', 58), make('a', 57)], [make('b', 10), make('b', 9, 'a 59')]], 5);
    expect(merged.map((item) => item.title)).toEqual(['a 59', 'a 58', 'b 10', 'a 57']);
  });

  it('konu süzgeci başlığa ve adres yoluna bakar', () => {
    const items = parseFeed(fixture('trt.rss'), trt);
    expect(filterByTopic(items, 'yağış').length).toBe(1);
    expect(filterByTopic(items, 'gündem').length).toBeGreaterThan(0);
  });

  it('bir kaynak düşerse ötekilerle yanıtlar', async () => {
    const fetcher = fakeFetch([
      { match: 'trthaber.com', contentType: 'application/rss+xml', body: fixture('trt.rss') },
      { match: /./, fail: 'network' },
    ]);
    const outcome = await createNews(fetcher).get('TR', undefined, 6);
    expect(outcome.items.length).toBe(4);
    expect(outcome.failed).toEqual(['BBC Türkçe', 'DW Türkçe', 'NTV']);
  });
});
