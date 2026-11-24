// Gündem servisi: tazelik, geri çekilme, sahte saatle çok günlük ilerleme, son dakika, kaynak ekleme/silme, konular.
// Ağ YOK: kayıtlı yanıtlar (`fakeFetch`); saat sahte.
import { afterEach, describe, expect, it } from 'vitest';
import { fakeFetch, type FakeRoute } from '../web/fake-fetch';
import type { NewsInterests } from './access';
import { backoffMs, createNewsService, FRESH_MS } from './service';
import { clock, html, newsDb, rss, silentLog, type FeedEntry } from './testkit';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const T0 = '2026-11-17T09:00:00+03:00';
const RSS_TYPE = 'application/rss+xml';

let env: ReturnType<typeof newsDb>;
afterEach(() => env?.close());

interface Setup {
  routes: FakeRoute[];
  enabled?: string[];
  interests?: NewsInterests;
  network?: () => boolean;
}

function setup({ routes, enabled = ['trt', 'aa', 'ntv'], interests = { follow: [], mute: [] }, network = () => true }: Setup) {
  env = newsDb();
  const time = clock(T0);
  const fetcher = fakeFetch(routes);
  const changes: string[] = [];
  const service = createNewsService({ db: env.db, fetcher, now: time.now, interests: () => interests, log: silentLog, networkAllowed: network, onChange: (reason) => changes.push(reason) });
  env.db.run('UPDATE news_sources SET enabled = 0');
  for (const id of enabled) env.db.run('UPDATE news_sources SET enabled = 1 WHERE id = ?', [id]);
  return { service, time, fetcher, changes };
}

const ago = (time: { now(): number }, ms: number) => new Date(time.now() - ms).toISOString();

/** Kayıtlı yanıt: içerik dışarıdan değiştirilebilir (yeni haber gelişi). */
function feedRoute(match: string, title: string, entries: () => FeedEntry[]): FakeRoute {
  const route: FakeRoute = { match, contentType: RSS_TYPE };
  Object.defineProperty(route, 'body', { get: () => rss(title, entries()) });
  return route;
}

describe('gündem servisi: okuma', () => {
  it('etkin kaynakları okur; 20 dk tazelik içinde yeniden istemez; force ister', async () => {
    let trt: FeedEntry[] = [];
    const routes = [feedRoute('trthaber.com', 'TRT', () => trt), feedRoute('aa.com.tr', 'AA', () => []), feedRoute('ntv.com.tr', 'NTV', () => [])];
    const { service, time, fetcher, changes } = setup({ routes });
    trt = [{ title: 'Meclis bütçe görüşmelerine başladı', url: 'https://www.trthaber.com/1', at: ago(time, 10 * MIN) }];
    const status = await service.refresh();
    expect(fetcher.calls).toHaveLength(3);
    expect(status).toMatchObject({ enabled: 3, stories: 1, unread: 1 });
    // AA ve NTV boş: "beslemede başlık yok".
    expect(service.sources().find((source) => source.id === 'aa')!.lastError).toBe('beslemede başlık yok');
    expect(changes).toContain('refresh');

    time.advance(10 * MIN);
    await service.refresh();
    expect(fetcher.calls.filter((url) => url.includes('trthaber'))).toHaveLength(1);
    await service.refresh({ force: true });
    expect(fetcher.calls.filter((url) => url.includes('trthaber'))).toHaveLength(2);
    time.advance(FRESH_MS + MIN);
    expect(service.stale()).toBe(true);
    await service.refresh();
    expect(fetcher.calls.filter((url) => url.includes('trthaber'))).toHaveLength(3);
  });

  it('başarısızlıkta 5 dk’dan başlayıp 2 saate dek katlanan geri çekilme; Türkçe kısa neden', async () => {
    expect([1, 2, 3, 4, 5, 6, 9].map((n) => backoffMs(n) / MIN)).toEqual([5, 10, 20, 40, 80, 120, 120]);
    const { service, time, fetcher } = setup({ routes: [{ match: /./, fail: 'network' }], enabled: ['trt'] });
    await service.refresh();
    const trt = () => service.sources().find((source) => source.id === 'trt')!;
    expect(trt().lastError).toBe('bağlantı kurulamadı');
    expect(service.status().failing).toBe(1);
    time.advance(4 * MIN);
    await service.refresh();
    expect(fetcher.calls).toHaveLength(1);
    time.advance(2 * MIN);
    await service.refresh();
    expect(fetcher.calls).toHaveLength(2);
    time.advance(6 * MIN); // ikinci hatadan sonra bekleme 10 dk
    await service.refresh();
    expect(fetcher.calls).toHaveLength(2);
    time.advance(5 * MIN);
    await service.refresh();
    expect(fetcher.calls).toHaveLength(3);
  });

  it('zaman aşımı ve HTTP hatası ayrı nedenle yazılır; başarı nedeni siler', async () => {
    let fail = true;
    const trtRoute = {
      match: 'trthaber.com',
      contentType: RSS_TYPE,
      get fail() {
        return fail ? ('network' as const) : undefined;
      },
      get body() {
        return rss('TRT', [{ title: 'Deprem uyarısı yapıldı bugün', url: 'https://www.trthaber.com/d', at: T0 }]);
      },
    } as FakeRoute;
    const { service, time } = setup({ routes: [trtRoute, { match: 'aa.com.tr', fail: 'timeout' }, { match: 'ntv.com.tr', status: 503, body: '' }] });
    await service.refresh();
    const errors = Object.fromEntries(service.sources().filter((source) => source.enabled).map((source) => [source.id, source.lastError]));
    expect(errors).toEqual({ trt: 'bağlantı kurulamadı', aa: 'zaman aşımı', ntv: 'sunucu 503 döndü' });
    fail = false;
    time.advance(6 * MIN);
    await service.refresh({ force: true });
    expect(service.sources().find((source) => source.id === 'trt')!.lastError).toBeNull();
  });

  it('ağ kapalıyken / Gizli kipte ağa çıkılmaz', async () => {
    const { service, fetcher } = setup({ routes: [{ match: /./, fail: 'network' }], network: () => false });
    await service.refresh({ force: true });
    expect(fetcher.calls).toEqual([]);
    expect((await service.addSource('https://yeni.example.com/rss')).ok).toBe(false);
    expect(fetcher.calls).toEqual([]);
  });
});

describe('gündem servisi: sahte saatle günler', () => {
  it('çok günlük benzetim: yeni haberler gelir, okundu kalır, 7 günden eskiler düşer', async () => {
    const cities = ['Rize', 'Trabzon', 'Antalya', 'Eskişehir', 'Samsun', 'Malatya', 'Denizli', 'Edirne', 'Mardin', 'Sinop'];
    const places = ['otoyol', 'liman', 'hastane', 'stadyum', 'kütüphane', 'havalimanı', 'baraj', 'köprü', 'tünel', 'fabrika'];
    const things = ['ihalesi', 'projesi', 'planı', 'bütçesi', 'takvimi', 'inşaatı', 'tasarımı', 'onayı', 'sözleşmesi', 'raporu'];
    let trt: FeedEntry[] = [];
    let aa: FeedEntry[] = [];
    const { service, time } = setup({ routes: [feedRoute('trthaber.com', 'TRT', () => trt), feedRoute('aa.com.tr', 'AA', () => aa), { match: /./, fail: 'network' }], enabled: ['trt', 'aa'] });
    const seen: string[] = [];
    for (let day = 0; day < 10; day++) {
      const subject = `${cities[day]} ${places[day]} ${things[day]}`;
      trt = [...trt, { title: `${subject} kararı açıklandı`, url: `https://www.trthaber.com/gun-${day}`, at: ago(time, 30 * MIN) }];
      aa = [...aa, { title: `${subject} için yeni karar`, url: `https://www.aa.com.tr/gun-${day}`, at: ago(time, 20 * MIN) }];
      await service.refresh();
      const fresh = service.stories({ unreadOnly: true });
      expect(fresh).toHaveLength(1);
      expect(fresh[0]!.sources.sort()).toEqual(['Anadolu Ajansı', 'TRT Haber']);
      // Seçilen başlık en yeni Türkçe olan (AA, 20 dk önce).
      expect(fresh[0]!.title).toBe(`${subject} için yeni karar`);
      seen.push(fresh[0]!.id);
      service.markRead([fresh[0]!.id]);
      expect(service.stories({ unreadOnly: true })).toHaveLength(0);
      time.advance(DAY);
    }
    expect(new Set(seen).size).toBe(10);
    // Besleme eski öğeleri hâlâ taşısa da 7 günden eskiler depoya girmez ve silinir; elde kalanların hepsi okundu.
    const all = service.stories({ limit: 100 });
    expect(all.some((story) => story.title.startsWith('Rize') || story.title.startsWith('Trabzon'))).toBe(false);
    expect(all.length).toBeGreaterThanOrEqual(7);
    expect(all.every((story) => story.read)).toBe(true);
  });

  it('since süzgeci: yalnız o andan sonra görülenler', async () => {
    let trt: FeedEntry[] = [];
    const { service, time } = setup({ routes: [feedRoute('trthaber.com', 'TRT', () => trt), { match: /./, fail: 'network' }], enabled: ['trt'] });
    trt = [{ title: 'Sabah haberi geldi erken', url: 'https://www.trthaber.com/s', at: ago(time, 0) }];
    await service.refresh();
    const mark = new Date(time.now() + MIN).toISOString();
    time.advance(3 * HOUR);
    trt = [...trt, { title: 'Öğle haberi geldi şimdi', url: 'https://www.trthaber.com/o', at: ago(time, 0) }];
    await service.refresh();
    expect(service.stories({ since: mark }).map((story) => story.title)).toEqual(['Öğle haberi geldi şimdi']);
  });
});

describe('gündem servisi: son dakika, konular, ilgi', () => {
  const headline = (id: string, title: string) => [{ title, url: `https://${id}.example/${encodeURIComponent(title)}`, at: T0 }];

  it('≥3 kaynağın verdiği ya da takip konusu eşleşen OKUNMAMIŞ hikâyeler', async () => {
    const big = 'İstanbul’da 5,2 büyüklüğünde deprem meydana geldi';
    const routes = [
      feedRoute('trthaber.com', 'TRT', () => [...headline('trt', big), ...headline('trt', 'Sıradan bir yerel haber burada')]),
      feedRoute('aa.com.tr', 'AA', () => headline('aa', 'İstanbul’da 5,2 büyüklüğünde deprem')),
      feedRoute('ntv.com.tr', 'NTV', () => [...headline('ntv', 'Deprem: İstanbul’da 5,2 büyüklüğünde sarsıntı meydana geldi'), ...headline('ntv', 'OpenAI yeni modelini duyurdu bugün')]),
    ];
    const { service } = setup({ routes });
    await service.refresh();
    const since = new Date(Date.parse(T0) - HOUR).toISOString();
    expect(service.breaking(since).map((story) => story.sources.length)).toEqual([3]);
    service.setTopic('yapay zekâ', 'follow');
    const now = service.breaking(since);
    expect(now).toHaveLength(2);
    expect(now.find((story) => story.title.startsWith('OpenAI'))!.reasons).toContain('takip: yapay zekâ');
    service.markRead(now.map((story) => story.id));
    expect(service.breaking(since)).toEqual([]);
    // Eşik sonrası: daha önce görülenler "son dakika" değildir.
    expect(service.breaking(new Date(Date.parse(T0) + HOUR).toISOString())).toEqual([]);
  });

  it('konular: takip, sessize alma (elenir), çıkarma; profil ilgi alanı "profile" kökenli görünür', async () => {
    const routes = [feedRoute('trthaber.com', 'TRT', () => [...headline('trt', 'Ünlü oyuncu magazin basınına konuştu'), ...headline('trt', 'Yerli girişim yatırım turunu kapattı'), ...headline('trt', 'Bakanlık yeni yönetmeliği açıkladı')])];
    const interests: NewsInterests = { follow: ['girişimcilik'], mute: [] };
    const { service, changes } = setup({ routes, enabled: ['trt'], interests });
    await service.refresh();
    expect(service.topics()).toEqual([expect.objectContaining({ text: 'girişimcilik', origin: 'profile', mode: 'follow' })]);
    expect(service.stories()[0]!.reasons).toEqual(['ilgi alanı: girişimcilik']);
    service.setTopic('magazin', 'mute');
    expect(changes).toContain('topics');
    expect(service.stories().map((story) => story.title)).not.toContain('Ünlü oyuncu magazin basınına konuştu');
    service.setTopic('magazin', 'remove');
    expect(service.stories()).toHaveLength(3);
    expect(() => service.setTopic('  ', 'follow')).toThrow('Konu boş olamaz.');
    // Konu süzgeci ve kategori süzgeci.
    expect(service.stories({ topic: 'startup' }).map((story) => story.title)).toEqual(['Yerli girişim yatırım turunu kapattı']);
    expect(service.stories({ category: 'tech' })).toEqual([]);
  });
});

describe('gündem servisi: kaynak ekleme ve silme', () => {
  it('katalogdaki kapalı kaynak açılır ve okunur; açıksa "zaten ekli"', async () => {
    const routes = [feedRoute('webrazzi.com/feed', 'Webrazzi', () => [{ title: 'Yerli SaaS girişimi yatırım aldı', url: 'https://webrazzi.com/1', at: T0 }])];
    const { service } = setup({ routes, enabled: [] });
    const added = await service.addSource('webrazzi');
    expect(added).toMatchObject({ ok: true, message: 'Webrazzi kaynaklarıma eklendi; ilk okumada 1 başlık geldi.', source: { id: 'webrazzi', enabled: true, builtin: true } });
    const again = await service.addSource('Webrazzi');
    expect(again).toMatchObject({ ok: true, message: 'Webrazzi zaten kaynaklarımda ve açık.' });
  });

  it('yeni besleme: bulunur, doğrulanır, eklenir; aynı adres ikinci kez açılmaz; kullanıcı kaynağı silinir, yerleşik kapanır', async () => {
    const routes: FakeRoute[] = [
      { match: /kisiselblog\.example\.com\/?$/, body: html('<link rel="alternate" type="application/rss+xml" href="/feed.xml">') },
      feedRoute('kisiselblog.example.com/feed.xml', 'Kişisel Teknoloji Günlüğü', () => [
        { title: 'Yeni klavyem geldi', url: 'https://kisiselblog.example.com/1', at: T0 },
        { title: 'Ekran kartı incelemesi', url: 'https://kisiselblog.example.com/2', at: T0 },
      ]),
    ];
    const { service } = setup({ routes, enabled: ['trt'] });
    const added = await service.addSource('kisiselblog.example.com');
    expect(added.ok).toBe(true);
    expect(added.message).toBe('Kişisel Teknoloji Günlüğü kaynaklarıma eklendi; ilk okumada 2 başlık geldi.');
    expect(added.source).toMatchObject({ builtin: false, enabled: true, category: 'tech', lang: 'tr', itemCount: 2, url: 'https://kisiselblog.example.com/feed.xml' });
    const again = await service.addSource('https://kisiselblog.example.com/feed.xml');
    expect(again.message).toContain('zaten kaynaklarımda');
    expect(service.sources().filter((source) => !source.builtin)).toHaveLength(1);

    expect(service.removeSource(added.source!.id)).toBe(true);
    expect(service.sources().some((source) => source.id === added.source!.id)).toBe(false);
    expect(service.removeSource('trt')).toBe(true);
    expect(service.sources().find((source) => source.id === 'trt')).toMatchObject({ enabled: false, builtin: true });
    expect(service.removeSource('yok-boyle')).toBe(false);
  });

  it('bulunamayan kaynak: Türkçe neden ve denenenler', async () => {
    const { service } = setup({ routes: [{ match: /./, fail: 'network' }] });
    const result = await service.addSource('hicolmayanbirsite');
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/^“hicolmayanbirsite” için bir RSS beslemesi bulamadım\. Denediklerim: www\.hicolmayanbirsite\.com/);
    expect(result.tried.length).toBeGreaterThan(0);
  });
});
