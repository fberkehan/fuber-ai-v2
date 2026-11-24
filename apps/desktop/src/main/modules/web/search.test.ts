// Arama sağlayıcıları, gerçek sayfaların yapısını taşıyan küçük SENTETİK sayfalarla sınanır (fixtures/); ağa gidilmez.
import { describe, expect, it } from 'vitest';
import { fakeFetch, fixture } from './fake-fetch';
import { cleanUrl, DEFAULT_PROVIDERS, formatResults, looksTurkish, parseBrave, parseDuckDuckGo, parseWikipedia, parseYahoo, relevant, searchWeb, SEARCH_TEXT_BUDGET } from './search';

describe('ayrıştırıcılar (kayıtlı sayfalar)', () => {
  it('DuckDuckGo: başlık, gerçek adres (uddg çözülmüş) ve özet', () => {
    const results = parseDuckDuckGo(fixture('ddg.html'));
    expect(results.length).toBeGreaterThanOrEqual(5);
    expect(results.some((result) => result.url === 'https://example.org/guides/sourdough-starter-feeding-schedule')).toBe(true);
    for (const result of results) {
      expect(result.url).toMatch(/^https:\/\//);
      expect(result.url).not.toContain('duckduckgo.com');
      expect(result.title).not.toMatch(/<|&#x27;/);
    }
  });

  it('Yahoo: yönlendirme adresinden asıl adres', () => {
    const results = parseYahoo(fixture('yahoo.html'));
    expect(results.length).toBeGreaterThanOrEqual(1);
    for (const result of results) {
      expect(result.url).not.toContain('yahoo.com');
      expect(result.title.length).toBeGreaterThan(5);
    }
  });

  it('Brave', () => {
    const results = parseBrave(fixture('brave.html'));
    expect(results[0]).toMatchObject({ url: 'https://example.org/guides/sourdough-starter-feeding-schedule' });
    expect(results[0]!.title).toContain('feeding schedule');
    expect(results[0]!.snippet).toContain('starter');
  });

  it('Vikipedi', () => {
    const results = parseWikipedia(JSON.parse(fixture('wikipedia-search.json')), 'tr');
    expect(results[0]).toMatchObject({ title: 'Ankara Kalesi', url: 'https://tr.wikipedia.org/wiki/Ankara_Kalesi' });
    expect(results[0]!.snippet).not.toContain('<span');
  });

  it('izleme parametreleri atılır; Türkçe sorgu sezilir', () => {
    expect(cleanUrl('https://a.com/x?utm_source=y&id=3&fbclid=z#k')).toBe('https://a.com/x?id=3');
    expect(looksTurkish('yarın hava')).toBe(true);
    expect(looksTurkish('sourdough starter schedule')).toBe(false);
  });
});

describe('searchWeb (sıra ve geri düşme)', () => {
  const query = 'sourdough starter feeding schedule';

  it('DuckDuckGo bot sınamasına düşerse (202) Yahoo kullanılır', async () => {
    const fetcher = fakeFetch([
      { match: 'html.duckduckgo.com', status: 202, body: fixture('ddg-anomaly.html') },
      { match: 'search.yahoo.com', body: fixture('yahoo.html') },
    ]);
    const outcome = await searchWeb(query, fetcher);
    expect(outcome.provider?.id).toBe('yahoo');
    expect(outcome.attempts.map((attempt) => [attempt.id, attempt.status])).toEqual([
      ['duckduckgo', 'blocked'],
      ['yahoo', 'ok'],
    ]);
    expect(fetcher.calls).toHaveLength(2);
  });

  it('hepsi düşerse sonuç yok ve her denemenin nedeni kayıtlı', async () => {
    const fetcher = fakeFetch([{ match: /./, fail: 'network' }]);
    const outcome = await searchWeb(query, fetcher);
    expect(outcome.results).toEqual([]);
    expect(outcome.attempts.map((attempt) => attempt.id)).toEqual(DEFAULT_PROVIDERS.map((provider) => provider.id));
    expect(outcome.attempts.every((attempt) => attempt.status === 'error')).toBe(true);
  });

  it('alakasız sonuç (bot savunmasının çöpü) boş sayılır ve sonrakine geçilir', async () => {
    const fetcher = fakeFetch([
      { match: 'html.duckduckgo.com', body: '<div class="result results_links"><a class="result__a" href="https://youtube.com/help">YouTube yardım</a><a class="result__snippet">Video yükleme</a></div>' },
      { match: 'search.yahoo.com', body: fixture('yahoo.html') },
    ]);
    const outcome = await searchWeb(query, fetcher);
    expect(outcome.attempts[0]).toMatchObject({ id: 'duckduckgo', status: 'empty' });
    expect(outcome.provider?.id).toBe('yahoo');
  });

  it('alaka kapısı: uzun sorguda köklerin yarısı', () => {
    const results = [
      { title: 'Starter motor replacement guide', url: 'https://x.org/a', snippet: 'Car battery and ignition checks' },
      { title: 'Sourdough starter feeding schedule', url: 'https://y.org/b', snippet: 'How often to feed a starter' },
    ];
    expect(relevant(results, query).map((result) => result.url)).toEqual(['https://y.org/b']);
  });

  it('modele giden metin bütçeyi aşmaz', () => {
    const long = Array.from({ length: 5 }, (_, i) => ({ title: `Başlık ${i} `.repeat(20), url: `https://ornek.com/${'a'.repeat(150)}${i}`, snippet: 'özet '.repeat(100) }));
    const { lines, used } = formatResults(long);
    expect(lines.join('\n').length).toBeLessThanOrEqual(SEARCH_TEXT_BUDGET);
    expect(used.length).toBeGreaterThanOrEqual(3);
  });
});
