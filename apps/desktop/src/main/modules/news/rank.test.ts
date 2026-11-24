// Gündemin saf işlevleri: kümeleme, puan, nedenler, sessize alma, çeşitlilik, Türkçe/İngilizce eş anlam.
import { describe, expect, it } from 'vitest';
import { clusterItems, diversify, freshness, rankClusters, SCORE, sortStories, titleWords, topicMatcher, type RankItem, type RankTopics } from './rank';

const NOW = Date.parse('2026-11-17T09:00:00Z');
const H = 60 * 60_000;
let seq = 0;
function item(title: string, sourceName: string, hoursAgo: number, extra: Partial<RankItem> = {}): RankItem {
  seq++;
  return {
    id: `i${seq}`,
    sourceId: sourceName.toLowerCase(),
    sourceName,
    category: 'tr',
    lang: 'tr',
    title,
    url: `https://${sourceName.toLowerCase().replace(/\s+/g, '')}.example.com/${seq}`,
    at: NOW - hoursAgo * H,
    firstSeen: NOW - hoursAgo * H,
    ...extra,
  };
}
const noTopics: RankTopics = { follow: [], mute: [], interests: [], dislikes: [] };
const rank = (items: RankItem[], topics: Partial<RankTopics> = {}, read = new Set<string>()) =>
  rankClusters(clusterItems(items), { now: NOW, topics: { ...noTopics, ...topics }, isRead: (members) => members.some((member) => read.has(member.id)) });

describe('kümeleme', () => {
  it('aynı olayı anlatan başlıklar tek hikâye; bütün kaynaklar; seçilen en yeni Türkçe başlık', () => {
    const items = [
      item('Merkez Bankası politika faizini yüzde 40’ta sabit tuttu', 'AA', 3),
      item('Merkez Bankası faizi sabit tuttu: politika faizi yüzde 40', 'TRT Haber', 2),
      item('Turkey central bank holds policy rate', 'BBC News', 1, { lang: 'en', category: 'world' }),
      item('Fenerbahçe deplasmanda kazandı', 'NTV', 1),
    ];
    const stories = rank(items);
    expect(stories).toHaveLength(3);
    const bank = stories.find((story) => story.sources.includes('AA'))!;
    expect(bank.sources.sort()).toEqual(['AA', 'TRT Haber']);
    expect(bank.title).toContain('faizi sabit tuttu: politika');
    expect(bank.reasons).toContain('2 kaynak');
  });

  it('aynı adres tek hikâye; 36 saatten uzak benzer başlıklar ayrı', () => {
    const a = item('Deprem: Ege’de 5,1 büyüklüğünde deprem', 'AA', 1);
    const b = item('Bir başka başlık', 'TRT Haber', 2, { url: a.url });
    const old = item('Ege’de 5,1 büyüklüğünde deprem korkuttu', 'NTV', 50);
    const clusters = clusterItems([a, b, old]);
    expect(clusters).toHaveLength(2);
    expect(clusters.find((cluster) => cluster.items.includes(a))!.items).toContain(b);
  });

  it('kimlik belirleyicidir: en erken görülen öğenin kimliği', () => {
    const first = item('Yeni elektrikli araç fabrikası açıldı Bursa', 'AA', 5);
    const later = item('Bursa’da yeni elektrikli araç fabrikası açıldı', 'NTV', 1);
    expect(clusterItems([later, first])[0]!.id).toBe(first.id);
  });
});

describe('puan ve nedenler', () => {
  it('tazelik yarı ömrü 12 saat, en çok 40; ek kaynak +8 (en çok 24)', () => {
    expect(freshness(0)).toBe(40);
    expect(Math.round(freshness(12 * H))).toBe(20);
    const many = ['AA', 'TRT', 'NTV', 'BBC Türkçe', 'DW Türkçe', 'Sözcü'].map((source, index) => item(`Meclis bütçe görüşmeleri başladı ${'x'.repeat(index)}`, source, 0));
    const story = rank(many)[0]!;
    expect(story.sources).toHaveLength(6);
    expect(story.score).toBe(40 + SCORE.sourcesMax);
  });

  it('takip konusu +30 ve "takip: …"; profil ilgi alanı +18 ve "ilgi alanı: …"; kategori ilgisi +8', () => {
    const ai = item('OpenAI yeni modelini tanıttı', 'Webrazzi', 0, { category: 'ai' });
    const startup = item('Yerli girişim 5 milyon dolar yatırım aldı', 'Swipeline', 0, { category: 'startup' });
    const plain = item('Hava sıcaklığı düşüyor', 'NTV', 0);
    const stories = rank([ai, startup, plain], { follow: ['yapay zekâ'], interests: ['girişimcilik'] });
    const byTitle = (title: string) => stories.find((story) => story.title.startsWith(title))!;
    expect(byTitle('OpenAI').reasons).toEqual(['takip: yapay zekâ']);
    expect(byTitle('OpenAI').score).toBe(40 + 30 + 8);
    expect(byTitle('Yerli').reasons).toEqual(['ilgi alanı: girişimcilik']);
    expect(byTitle('Yerli').score).toBe(40 + 18 + 8);
    expect(byTitle('Hava').score).toBe(40);
    expect(byTitle('Hava').reasons).toEqual([]);
  });

  it('sessize alınan konu ve profilin sevmedikleri ELENİR', () => {
    const items = [item('Ünlü şarkıcı magazin dünyasını salladı', 'Sabah', 0), item('Galatasaray derbiyi kazandı', 'NTV', 0), item('Borsa güne yükselişle başladı', 'AA', 0)];
    const stories = rank(items, { mute: ['magazin'], dislikes: ['Galatasaray'] });
    expect(stories.map((story) => story.title)).toEqual(['Borsa güne yükselişle başladı']);
  });

  it('"spor sevmem": derbi ve maç başlıkları da, adresinin yolunda /spor/ geçen haber de elenir', () => {
    const items = [
      item('Süper Lig’de derbi nefes kesti', 'TRT Haber', 1),
      item('Milli takım kadrosu açıklandı', 'NTV', 1, { url: 'https://www.ntv.com.tr/spor/kadro-123' }),
      item('Merkez Bankası faiz kararını açıkladı', 'AA', 1, { url: 'https://www.aa.com.tr/tr/ekonomi/faiz-1' }),
    ];
    expect(rank(items, { dislikes: ['Spor'] }).map((story) => story.source)).toEqual(['AA']);
    // Adres yolu ilgi alanı için de sayılır: başlıkta "ekonomi" geçmese de eşleşir.
    expect(rank(items, { interests: ['ekonomi'] }).find((story) => story.source === 'AA')!.reasons).toContain('ilgi alanı: ekonomi');
  });

  it('kullanıcının sessize aldığı ilgi alanı puan getirmez', () => {
    const stories = rank([item('Bitcoin 100 bin doları aştı', 'Döviz', 0)], { interests: ['kripto'], mute: [] });
    expect(stories[0]!.reasons).toEqual(['ilgi alanı: kripto']);
    expect(rank([item('Bitcoin 100 bin doları aştı', 'Döviz', 0)], { interests: ['kripto'], mute: ['kripto'] })).toHaveLength(0);
  });
});

describe('konu eşleşmesi', () => {
  const hit = (topic: string, title: string) => topicMatcher(topic)!.matches(titleWords(title));
  it('Türkçe ↔ İngilizce eş anlam', () => {
    expect(hit('yapay zekâ', 'OpenAI unveils new reasoning model')).toBe(true);
    expect(hit('yapay zeka', 'Google’s new AI agent books flights')).toBe(true);
    expect(hit('AI', 'Yapay zekâ düzenlemesi Meclis’te')).toBe(true);
    expect(hit('girişim', 'Fintech startup raises $20M in funding')).toBe(true);
    expect(hit('ekonomi', 'Enflasyon kasımda beklentinin altında kaldı')).toBe(true);
    expect(hit('döviz', 'Dolar güne yükselişle başladı')).toBe(true);
    expect(hit('kripto', 'Bitcoin hits new record')).toBe(true);
    expect(hit('teknoloji', 'Tech giants face new rules')).toBe(true);
  });

  it('kökler: Türkçe ekler; kısa terim yalnız tam sözcük; çok sözcüklü konuda bütün kökler', () => {
    expect(hit('Fenerbahçe', 'Fenerbahçe’nin yeni hocası belli oldu')).toBe(true);
    expect(hit('girişim', 'Okula giriş saatleri değişti')).toBe(false);
    expect(hit('ai', 'Aile destek programı genişledi')).toBe(false);
    expect(hit('dolar kuru', 'Dolar kuru 40 lirayı aştı')).toBe(true);
    expect(hit('dolar kuru', 'Dolar zirvede')).toBe(false);
    expect(hit('yapay zekâ haberleri', 'Yapay zekâ ile kanser teşhisi')).toBe(true);
  });
});

describe('sıralama ve çeşitlilik', () => {
  it('okunmamış önce, sonra puan, sonra tazelik', () => {
    const a = item('Birinci haber burada', 'AA', 0);
    const b = item('İkinci haber başka', 'NTV', 5);
    const stories = sortStories(rank([a, b], {}, new Set([a.id])));
    expect(stories.map((story) => story.read)).toEqual([false, true]);
  });

  it('aynı kaynaktan art arda en çok 2', () => {
    const list = [{ source: 'A' }, { source: 'A' }, { source: 'A' }, { source: 'A' }, { source: 'B' }, { source: 'C' }];
    expect(diversify(list).map((story) => story.source)).toEqual(['A', 'A', 'B', 'A', 'A', 'C']);
  });
});
