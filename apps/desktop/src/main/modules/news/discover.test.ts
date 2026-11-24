// Besleme keşfi (ağ YOK: kayıtlı yanıtlar; özel ağ reddi gerçek güvenlik kapısıyla, ad çözümlemesinden önce).
import { describe, expect, it } from 'vitest';
import { createSafeFetch } from '../web/net';
import { fakeFetch } from '../web/fake-fetch';
import { discoverFeed, feedLanguage, feedLinks, guessCategory, matchCatalog } from './discover';
import { atom, html, rss } from './testkit';

const AT = '2026-11-17T06:00:00Z';
const RSS_TYPE = 'application/rss+xml';

describe('katalog eşleşmesi', () => {
  it('ad, öteki ad, boşluksuz yazım, ana makine adı ve tam adres', () => {
    expect(matchCatalog('webrazzi')?.id).toBe('webrazzi');
    expect(matchCatalog("Webrazzi'yi")?.id).toBe('webrazzi');
    expect(matchCatalog('bbc türkçe')?.id).toBe('bbc-tr');
    expect(matchCatalog('BBC Türkçe')?.id).toBe('bbc-tr');
    expect(matchCatalog('hackernews')?.id).toBe('hn');
    expect(matchCatalog('theverge.com')?.id).toBe('verge');
    expect(matchCatalog('https://www.theverge.com/')?.id).toBe('verge');
    expect(matchCatalog('techcrunch.com')?.id).toBe('techcrunch');
    expect(matchCatalog('https://the-decoder.com/feed/')?.id).toBe('the-decoder');
    expect(matchCatalog('https://bilinmeyen.example.com/feed')).toBeNull();
    expect(matchCatalog('bilinmeyen site')).toBeNull();
  });
});

describe('discoverFeed', () => {
  it('katalog adı: ağa çıkılmaz', async () => {
    const fetcher = fakeFetch([]);
    const outcome = await discoverFeed('the verge', fetcher);
    expect(outcome).toMatchObject({ kind: 'catalog', entry: { id: 'verge' } });
    expect(fetcher.calls).toEqual([]);
  });

  it('doğrudan besleme adresi: doğrulanır; ad, dil ve kategori beslemeden', async () => {
    const fetcher = fakeFetch([{ match: 'ornekhaber.example.com/rss', contentType: RSS_TYPE, body: rss('Örnek Teknoloji Haberleri', [{ title: 'Yeni işlemci tanıtıldı', url: 'https://ornekhaber.example.com/a', at: AT }], { language: 'tr-TR' }) }]);
    const outcome = await discoverFeed('https://ornekhaber.example.com/rss', fetcher);
    expect(outcome).toMatchObject({ kind: 'feed', url: 'https://ornekhaber.example.com/rss', name: 'Örnek Teknoloji Haberleri', lang: 'tr', category: 'tech' });
    if (outcome.kind === 'feed') expect(outcome.items).toHaveLength(1);
  });

  it('HTML sayfası: <link rel="alternate"> ile (göreli adres çözülür); Atom da olur', async () => {
    const fetcher = fakeFetch([
      { match: /blog\.example\.com\/?$/, body: html('<link rel="alternate" type="application/atom+xml" title="Atom" href="/atom/genel.xml">') },
      { match: 'blog.example.com/atom/genel.xml', contentType: 'application/atom+xml', body: atom('Mühendis Günlüğü', [{ title: 'Kod incelemesi üzerine', url: 'https://blog.example.com/p/1', at: AT }]) },
    ]);
    const outcome = await discoverFeed('blog.example.com', fetcher);
    expect(outcome).toMatchObject({ kind: 'feed', url: 'https://blog.example.com/atom/genel.xml', name: 'Mühendis Günlüğü' });
    expect(fetcher.calls).toEqual(['https://blog.example.com', 'https://blog.example.com/atom/genel.xml']);
  });

  it('bağlantı yoksa yaygın yollar denenir', async () => {
    const fetcher = fakeFetch([
      { match: 'site.example.org/feed', contentType: RSS_TYPE, body: rss('Site Finans', [{ title: 'Borsa güne yükselişle başladı', url: 'https://site.example.org/x', at: AT }]) },
      { match: /site\.example\.org\/?$/, body: html('') },
      { match: /./, status: 404, body: 'yok' },
    ]);
    const outcome = await discoverFeed('https://site.example.org/', fetcher);
    expect(outcome).toMatchObject({ kind: 'feed', url: 'https://site.example.org/feed', category: 'economy' });
  });

  it('site adı: alan adı tahmini (www.<ad>.com …)', async () => {
    const fetcher = fakeFetch([
      { match: /^https:\/\/www\.yepyenihaber\.com$/, fail: 'network' },
      { match: /^https:\/\/yepyenihaber\.com$/, body: html('<link rel="alternate" type="application/rss+xml" href="https://yepyenihaber.com/rss.xml">') },
      { match: 'yepyenihaber.com/rss.xml', contentType: RSS_TYPE, body: rss('Yepyeni Haber', [{ title: 'Startup ekosisteminde yeni fon', url: 'https://yepyenihaber.com/1', at: AT }]) },
    ]);
    const outcome = await discoverFeed('yepyenihaber', fetcher);
    expect(outcome).toMatchObject({ kind: 'feed', url: 'https://yepyenihaber.com/rss.xml', name: 'Yepyeni Haber' });
    expect(outcome.tried[0]).toBe('https://www.yepyenihaber.com');
  });

  it('bulunamazsa ne denendiği döner; istek bütçesi aşılmaz', async () => {
    const fetcher = fakeFetch([{ match: /./, fail: 'network' }]);
    const outcome = await discoverFeed('hicolmayansite', fetcher);
    expect(outcome.kind).toBe('none');
    expect(outcome.tried.length).toBeGreaterThan(3);
    expect(fetcher.calls.length).toBeLessThanOrEqual(10);
    const html404 = fakeFetch([{ match: /./, body: html('') }]);
    const many = await discoverFeed('https://sayfa.example.com/haber', html404);
    expect(many.kind).toBe('none');
    expect(html404.calls.length).toBeLessThanOrEqual(10);
  });

  it('besleme gibi görünen ama öğesi olmayan yanıt kabul edilmez', async () => {
    const fetcher = fakeFetch([{ match: /./, contentType: RSS_TYPE, body: rss('Boş', []) }]);
    expect((await discoverFeed('https://bos.example.com/rss', fetcher)).kind).toBe('none');
  });

  it('özel ağ / yerel adres reddedilir (güvenlik kapısı, ağa çıkmadan)', async () => {
    const safe = createSafeFetch({ lookup: (_host, callback) => callback(null, [{ address: '10.0.0.5', family: 4 }]) });
    expect((await discoverFeed('http://192.168.1.10/feed', safe)).kind).toBe('blocked');
    expect((await discoverFeed('http://localhost/rss', safe)).kind).toBe('blocked');
    expect((await discoverFeed('https://ic-ag.example.com/rss', safe)).kind).toBe('blocked');
  });
});

describe('yardımcılar', () => {
  it('besleme bağlantıları, dil ve kategori sezgisi', () => {
    expect(feedLinks(html('<link href="feed.xml" type="application/rss+xml" rel="alternate"><link rel="stylesheet" href="a.css">'), 'https://x.example.com/blog/')).toEqual(['https://x.example.com/blog/feed.xml']);
    expect(feedLanguage('<rss><channel><title>a</title></channel></rss>', ['Bugün hava çok güzel ve güneşli', 'Şehirde yağış bekleniyor'])).toBe('tr');
    expect(feedLanguage('<rss><channel></channel></rss>', ['Weather is nice today'])).toBe('en');
    expect(guessCategory('Yapay Zeka Gündemi', 'https://a.example.com/feed')).toBe('ai');
    expect(guessCategory('Daily', 'https://a.example.com/ai/feed')).toBe('ai');
    expect(guessCategory('Girişim Haberleri', 'https://a.example.com')).toBe('startup');
    expect(guessCategory('Ekonomi', 'https://a.example.com')).toBe('economy');
    expect(guessCategory('TechNews', 'https://a.example.com')).toBe('tech');
    expect(guessCategory('Kişisel blog', 'https://a.example.com')).toBe('other');
  });
});
