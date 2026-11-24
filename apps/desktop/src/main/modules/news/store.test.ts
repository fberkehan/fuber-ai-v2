// Gündem deposu: tohumlama, saklama, okundu kalıcılığı (gerçek SQLite, sahte saat).
import { afterEach, describe, expect, it } from 'vitest';
import { NEWS_CATALOG, type CatalogSource } from './catalog';
import { createNewsStore, foldTitle, itemId, MAX_ITEMS_PER_SOURCE, readKeyOfTitle, readKeyOfUrl, urlKey } from './store';
import { clock, newsDb } from './testkit';

let env: ReturnType<typeof newsDb>;
afterEach(() => env?.close());

const T0 = '2026-11-17T09:00:00+03:00';
const DAY = 24 * 60 * 60_000;

describe('gündem deposu', () => {
  it('ilk açılışta katalog tohumlanır; `on` olanlar etkin', () => {
    env = newsDb();
    const time = clock(T0);
    const store = createNewsStore(env.db, time.now);
    expect(store.seed().added).toBe(NEWS_CATALOG.length);
    const rows = store.sourceRows();
    expect(rows).toHaveLength(NEWS_CATALOG.length);
    expect(rows.filter((row) => row.enabled === 1).map((row) => row.id).sort()).toEqual(NEWS_CATALOG.filter((entry) => entry.on).map((entry) => entry.id).sort());
    expect(rows.every((row) => row.builtin === 1)).toBe(true);
    // İkinci tohumlama hiçbir şey eklemez.
    expect(store.seed().added).toBe(0);
  });

  it('katalog büyürse eksik yerleşik eklenir; kullanıcının kapattığı yerleşik yeniden açılmaz', () => {
    env = newsDb();
    const store = createNewsStore(env.db, clock(T0).now);
    store.seed();
    store.setEnabled('trt', false);
    const extra: CatalogSource = { id: 'yeni-kaynak', name: 'Yeni Kaynak', url: 'https://yeni.example.com/rss', category: 'tech', lang: 'tr', on: true };
    expect(store.seed([...NEWS_CATALOG, extra]).added).toBe(1);
    expect(store.source('trt')!.enabled).toBe(0);
    expect(store.source('yeni-kaynak')!.enabled).toBe(1);
  });

  it('yalnız başlık + adres + zaman saklanır; 7 günden eskisi girmez, gelecek zamanlı "şimdi" sayılır', () => {
    env = newsDb();
    const time = clock(T0);
    const store = createNewsStore(env.db, time.now);
    store.seed();
    const added = store.putItems('trt', [
      { title: 'Taze haber', url: 'https://www.trthaber.com/a', at: new Date(time.now() - 60_000).toISOString() },
      { title: 'Çok eski haber', url: 'https://www.trthaber.com/b', at: new Date(time.now() - 8 * DAY).toISOString() },
      { title: 'Gelecekten haber', url: 'https://www.trthaber.com/c', at: new Date(time.now() + 5 * 60 * 60_000).toISOString() },
    ]);
    expect(added).toBe(2);
    const items = env.db.all<Record<string, unknown>>('SELECT * FROM news_items ORDER BY title');
    expect(Object.keys(items[0]!).sort()).toEqual(['at', 'first_seen_at', 'folded', 'id', 'source_id', 'title', 'url']);
    expect(items.find((item) => item.title === 'Gelecekten haber')!.at).toBe(new Date(time.now()).toISOString());
    // Aynı öğe yeniden gelince eklenmez; ilk görülme anı korunur.
    time.advance(60 * 60_000);
    expect(store.putItems('trt', [{ title: 'Taze haber', url: 'https://www.trthaber.com/a', at: null }])).toBe(0);
    expect(env.db.get<{ first_seen_at: string }>('SELECT first_seen_at FROM news_items WHERE id = ?', [itemId('trt', 'https://www.trthaber.com/a')])!.first_seen_at).toBe(new Date(Date.parse(T0)).toISOString());
  });

  it('saklama: 7 gün ve kaynak başına en çok 150', () => {
    env = newsDb();
    const time = clock(T0);
    const store = createNewsStore(env.db, time.now);
    store.seed();
    const many = Array.from({ length: MAX_ITEMS_PER_SOURCE + 30 }, (_, index) => ({ title: `Başlık ${index}`, url: `https://ntv.com.tr/${index}`, at: new Date(time.now() - index * 60_000).toISOString() }));
    store.putItems('ntv', many);
    store.prune();
    expect(store.counts().get('ntv')).toBe(MAX_ITEMS_PER_SOURCE);
    // En yeniler kalır.
    expect(env.db.get('SELECT id FROM news_items WHERE title = ?', ['Başlık 0'])).toBeDefined();
    expect(env.db.get('SELECT id FROM news_items WHERE title = ?', [`Başlık ${MAX_ITEMS_PER_SOURCE + 10}`])).toBeUndefined();
    time.advance(8 * DAY);
    store.prune();
    expect(store.itemCount()).toBe(0);
  });

  it('okundu bilgisi öğe silinip yeniden gelse de korunur (adres ve başlık anahtarı)', () => {
    env = newsDb();
    const time = clock(T0);
    const store = createNewsStore(env.db, time.now);
    store.seed();
    const item = { title: 'Merkez Bankası faizi sabit tuttu', url: 'https://www.aa.com.tr/x?utm=1', at: new Date(time.now()).toISOString() };
    store.putItems('aa', [item]);
    store.markRead([readKeyOfUrl(item.url), readKeyOfTitle(foldTitle(item.title))]);
    store.deleteSource('aa');
    store.seed();
    store.putItems('aa', [item]);
    const keys = store.readKeys();
    expect(keys.has(readKeyOfUrl(item.url))).toBe(true);
    // Okundu kayıtları 30 gün sonra silinir.
    time.advance(31 * DAY);
    store.prune();
    expect(store.readKeys().size).toBe(0);
  });

  it('konular: katlanmış metin tekildir; kip değişir; silinir', () => {
    env = newsDb();
    const store = createNewsStore(env.db, clock(T0).now);
    store.upsertTopic('Yapay zekâ', 'follow');
    store.upsertTopic('yapay zeka', 'mute');
    expect(store.topics()).toEqual([expect.objectContaining({ text: 'yapay zeka', mode: 'mute', origin: 'user' })]);
    expect(store.removeTopic('YAPAY ZEKÂ')).toBe(true);
    expect(store.topics()).toEqual([]);
  });

  it('adres anahtarı şema, www ve sondaki eğik çizgiyi yok sayar; purge katalogu baştan kurar', () => {
    expect(urlKey('https://www.Example.com/feed/')).toBe(urlKey('http://example.com/feed'));
    env = newsDb();
    const store = createNewsStore(env.db, clock(T0).now);
    store.seed();
    store.setEnabled('trt', false);
    store.addSource({ id: 'u-1', name: 'Benim', url: 'https://benim.example.com/rss', category: 'other', lang: 'tr' });
    store.purge();
    expect(store.source('u-1')).toBeUndefined();
    expect(store.source('trt')!.enabled).toBe(1);
  });
});
