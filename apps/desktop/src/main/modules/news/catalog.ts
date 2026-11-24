// Yerleşik RSS kataloğu. HER kaynak 17 Kasım 2026'da salt okunur istekle doğrulandı: HTTP 200, en az bir öğe ve son
// öğesi son 48 saat içinde (ölçüm betiği ve ham sonuç: `docs/TUZAKLAR.md` › "Gündem ve RSS"). `on`: ilk açılışta etkin
// olanlar (her konudan birkaç kaynak; kalanlar "şu kaynağı da aç" denince açılır). Adres yönlendiriyorsa SON adres yazılı.
//
// Doğrulamada elenenler (katalogda YOK): t24.com.tr/rss (bağlantı sıfırlanıyor), news.ycombinator.com/rss (419; yerine
// hnrss.org), venturebeat (429), anthropic.com/rss.xml (404), eu-startups (403), startups.watch (404), paraanaliz (404),
// Gazete Duvar (son öğe 5 gün önce), NTV Ekonomi (20 gün), Hürriyet Ekonomi (arama içeriği), Girişim Haber (15 gün),
// Y Combinator blogu (17 gün).
import type { NewsCategory } from './types';

export interface CatalogSource {
  id: string;
  name: string;
  url: string;
  category: NewsCategory;
  lang: 'tr' | 'en';
  /** İlk açılışta etkin mi. */
  on: boolean;
  /** Sesle eklerken tanınan öteki adlar (katlanmış, küçük harf): "bbc turkce", "aa". */
  aliases?: string[];
}

export const NEWS_CATALOG: readonly CatalogSource[] = [
  // ── Türkiye gündemi ──
  { id: 'trt', name: 'TRT Haber', url: 'https://www.trthaber.com/sondakika_articles.rss', category: 'tr', lang: 'tr', on: true, aliases: ['trt', 'trthaber'] },
  { id: 'bbc-tr', name: 'BBC Türkçe', url: 'https://feeds.bbci.co.uk/turkce/rss.xml', category: 'tr', lang: 'tr', on: true, aliases: ['bbc turkce'] },
  { id: 'dw-tr', name: 'DW Türkçe', url: 'https://rss.dw.com/xml/rss-tur-all', category: 'tr', lang: 'tr', on: true, aliases: ['dw turkce', 'deutsche welle turkce'] },
  { id: 'ntv', name: 'NTV', url: 'https://www.ntv.com.tr/son-dakika.rss', category: 'tr', lang: 'tr', on: true },
  { id: 'aa', name: 'Anadolu Ajansı', url: 'https://www.aa.com.tr/tr/rss/default?cat=guncel', category: 'tr', lang: 'tr', on: true, aliases: ['aa', 'anadolu ajansi'] },
  { id: 'trt-manset', name: 'TRT Haber Manşet', url: 'https://www.trthaber.com/manset_articles.rss', category: 'tr', lang: 'tr', on: false },
  { id: 'cumhuriyet', name: 'Cumhuriyet', url: 'https://www.cumhuriyet.com.tr/rss', category: 'tr', lang: 'tr', on: false },
  { id: 'hurriyet', name: 'Hürriyet', url: 'https://www.hurriyet.com.tr/rss/gundem', category: 'tr', lang: 'tr', on: false },
  { id: 'sozcu', name: 'Sözcü', url: 'https://www.sozcu.com.tr/feeds-rss-category-sozcu', category: 'tr', lang: 'tr', on: false },
  { id: 'haberturk', name: 'Habertürk', url: 'https://www.haberturk.com/rss', category: 'tr', lang: 'tr', on: false },
  { id: 'euronews-tr', name: 'Euronews Türkçe', url: 'https://tr.euronews.com/rss', category: 'tr', lang: 'tr', on: false, aliases: ['euronews turkce'] },
  { id: 'sabah', name: 'Sabah', url: 'https://www.sabah.com.tr/rss/gundem.xml', category: 'tr', lang: 'tr', on: false },
  { id: 'milliyet', name: 'Milliyet', url: 'https://www.milliyet.com.tr/rss/rssnew/sondakikarss.xml', category: 'tr', lang: 'tr', on: false },
  { id: 'cnnturk', name: 'CNN Türk', url: 'https://www.cnnturk.com/feed/rss/all/news', category: 'tr', lang: 'tr', on: false, aliases: ['cnn turk'] },
  { id: 'diken', name: 'Diken', url: 'https://www.diken.com.tr/feed/', category: 'tr', lang: 'tr', on: false },

  // ── Dünya ──
  { id: 'bbc-world', name: 'BBC News', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', category: 'world', lang: 'en', on: true, aliases: ['bbc', 'bbc news', 'bbc world'] },
  { id: 'aljazeera', name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml', category: 'world', lang: 'en', on: true, aliases: ['el cezire', 'aljazeera'] },
  { id: 'guardian-world', name: 'The Guardian', url: 'https://www.theguardian.com/world/rss', category: 'world', lang: 'en', on: true, aliases: ['guardian'] },
  { id: 'dw-en', name: 'DW', url: 'https://rss.dw.com/xml/rss-en-all', category: 'world', lang: 'en', on: false, aliases: ['dw', 'deutsche welle'] },
  { id: 'npr', name: 'NPR', url: 'https://feeds.npr.org/1001/rss.xml', category: 'world', lang: 'en', on: false },
  { id: 'france24', name: 'France 24', url: 'https://www.france24.com/en/rss', category: 'world', lang: 'en', on: false, aliases: ['france24'] },
  { id: 'nyt-world', name: 'The New York Times', url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', category: 'world', lang: 'en', on: false, aliases: ['new york times', 'nyt', 'nytimes'] },
  { id: 'euronews', name: 'Euronews', url: 'https://www.euronews.com/rss', category: 'world', lang: 'en', on: false },

  // ── Ekonomi ve piyasalar ──
  { id: 'bloomberght', name: 'Bloomberg HT', url: 'https://www.bloomberght.com/rss/tum-haberler.xml', category: 'economy', lang: 'tr', on: true, aliases: ['bloomberg ht', 'bloomberg'] },
  { id: 'dunya', name: 'Dünya', url: 'https://www.dunya.com/rss', category: 'economy', lang: 'tr', on: true, aliases: ['dunya gazetesi'] },
  { id: 'aa-ekonomi', name: 'Anadolu Ajansı Ekonomi', url: 'https://www.aa.com.tr/tr/rss/default?cat=ekonomi', category: 'economy', lang: 'tr', on: true },
  { id: 'trt-ekonomi', name: 'TRT Haber Ekonomi', url: 'https://www.trthaber.com/ekonomi_articles.rss', category: 'economy', lang: 'tr', on: true },
  { id: 'ekonomim', name: 'Ekonomim', url: 'https://www.ekonomim.com/rss', category: 'economy', lang: 'tr', on: false },
  { id: 'doviz', name: 'Döviz.com', url: 'https://www.doviz.com/news/rss', category: 'economy', lang: 'tr', on: false, aliases: ['doviz com', 'doviz'] },
  { id: 'investing-tr', name: 'Investing.com Türkiye', url: 'https://tr.investing.com/rss/news.rss', category: 'economy', lang: 'tr', on: false, aliases: ['investing'] },
  { id: 'bbc-business', name: 'BBC Business', url: 'https://feeds.bbci.co.uk/news/business/rss.xml', category: 'economy', lang: 'en', on: false },
  { id: 'cnbc', name: 'CNBC', url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', category: 'economy', lang: 'en', on: false },
  { id: 'ft', name: 'Financial Times', url: 'https://www.ft.com/rss/home/international', category: 'economy', lang: 'en', on: false, aliases: ['ft', 'financial times'] },

  // ── Teknoloji ──
  { id: 'shiftdelete', name: 'ShiftDelete.Net', url: 'https://shiftdelete.net/feed', category: 'tech', lang: 'tr', on: true, aliases: ['shiftdelete', 'sdn'] },
  { id: 'webtekno', name: 'Webtekno', url: 'https://www.webtekno.com/rss.xml', category: 'tech', lang: 'tr', on: true },
  { id: 'verge', name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', category: 'tech', lang: 'en', on: true, aliases: ['verge'] },
  { id: 'hn', name: 'Hacker News', url: 'https://hnrss.org/frontpage', category: 'tech', lang: 'en', on: true, aliases: ['hacker news', 'hn', 'ycombinator news'] },
  { id: 'donanimhaber', name: 'DonanımHaber', url: 'https://www.donanimhaber.com/rss/tum/', category: 'tech', lang: 'tr', on: false, aliases: ['donanim haber'] },
  { id: 'chip', name: 'CHIP Online', url: 'https://www.chip.com.tr/rss', category: 'tech', lang: 'tr', on: false, aliases: ['chip'] },
  { id: 'ntv-teknoloji', name: 'NTV Teknoloji', url: 'https://www.ntv.com.tr/teknoloji.rss', category: 'tech', lang: 'tr', on: false },
  { id: 'technopat', name: 'Technopat', url: 'https://feedpress.me/technopat', category: 'tech', lang: 'tr', on: false },
  { id: 'teknoblog', name: 'Teknoblog', url: 'https://www.teknoblog.com/feed/', category: 'tech', lang: 'tr', on: false },
  { id: 'arstechnica', name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index', category: 'tech', lang: 'en', on: false, aliases: ['ars technica', 'ars'] },
  { id: 'wired', name: 'WIRED', url: 'https://www.wired.com/feed/rss', category: 'tech', lang: 'en', on: false },
  { id: 'bbc-tech', name: 'BBC Technology', url: 'https://feeds.bbci.co.uk/news/technology/rss.xml', category: 'tech', lang: 'en', on: false },
  { id: 'engadget', name: 'Engadget', url: 'https://www.engadget.com/rss.xml', category: 'tech', lang: 'en', on: false },

  // ── Yapay zekâ ──
  { id: 'techcrunch-ai', name: 'TechCrunch AI', url: 'https://techcrunch.com/category/artificial-intelligence/feed/', category: 'ai', lang: 'en', on: true },
  { id: 'verge-ai', name: 'The Verge AI', url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', category: 'ai', lang: 'en', on: true },
  { id: 'the-decoder', name: 'The Decoder', url: 'https://the-decoder.com/feed/', category: 'ai', lang: 'en', on: true, aliases: ['decoder'] },
  { id: 'webrazzi-ai', name: 'Webrazzi Yapay Zekâ', url: 'https://webrazzi.com/kategori/yapay-zeka/feed/', category: 'ai', lang: 'tr', on: true },
  { id: 'openai', name: 'OpenAI', url: 'https://openai.com/news/rss.xml', category: 'ai', lang: 'en', on: true, aliases: ['openai blog'] },
  { id: 'mit-tr', name: 'MIT Technology Review', url: 'https://www.technologyreview.com/feed/', category: 'ai', lang: 'en', on: false, aliases: ['technology review', 'mit technology review'] },
  { id: 'google-ai', name: 'Google AI', url: 'https://blog.google/innovation-and-ai/technology/ai/rss/', category: 'ai', lang: 'en', on: false, aliases: ['google ai blog'] },
  { id: 'ars-ai', name: 'Ars Technica AI', url: 'https://arstechnica.com/ai/feed/', category: 'ai', lang: 'en', on: false },
  { id: 'simonw', name: 'Simon Willison', url: 'https://simonwillison.net/atom/everything/', category: 'ai', lang: 'en', on: false, aliases: ['simon willison'] },
  { id: 'hf', name: 'Hugging Face', url: 'https://huggingface.co/blog/feed.xml', category: 'ai', lang: 'en', on: false, aliases: ['hugging face', 'huggingface'] },

  // ── Girişimcilik ──
  { id: 'webrazzi', name: 'Webrazzi', url: 'https://webrazzi.com/feed/', category: 'startup', lang: 'tr', on: true },
  { id: 'swipeline', name: 'Swipeline', url: 'https://swipeline.co/feed/', category: 'startup', lang: 'tr', on: true },
  { id: 'techcrunch', name: 'TechCrunch', url: 'https://techcrunch.com/feed/', category: 'startup', lang: 'en', on: true, aliases: ['tech crunch'] },
  { id: 'tc-startups', name: 'TechCrunch Startups', url: 'https://techcrunch.com/category/startups/feed/', category: 'startup', lang: 'en', on: false },
  { id: 'sifted', name: 'Sifted', url: 'https://sifted.eu/feed', category: 'startup', lang: 'en', on: false },
  { id: 'producthunt', name: 'Product Hunt', url: 'https://www.producthunt.com/feed', category: 'startup', lang: 'en', on: false, aliases: ['product hunt'] },
  { id: 'fortune-tr', name: 'Fortune Türkiye', url: 'https://www.fortuneturkey.com/feed', category: 'startup', lang: 'tr', on: false, aliases: ['fortune turkiye', 'fortune'] },
];

/** Konunun Türkçe adı (araç yanıtlarında ve arayüzde). */
export const CATEGORY_LABEL: Record<NewsCategory, string> = {
  tr: 'Türkiye gündemi',
  world: 'Dünya',
  economy: 'Ekonomi',
  tech: 'Teknoloji',
  ai: 'Yapay zekâ',
  startup: 'Girişimcilik',
  other: 'Diğer',
};
