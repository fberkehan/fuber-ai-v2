// Yedi günlük benzetim (sahte saat): Jarvis kullanıcıyı öğreniyor mu, düzeltmeyi hatırlıyor mu, brifing kişiselleşiyor
// mu, ilgisiz haber eleniyor mu, ilgisizlikte kendiliğinden susuyor mu. GERÇEK profil deposu, gündem servisi ve brifing
// motoru birlikte çalışır (SQLite gerçek); ağ yok (kayıtlı RSS), model yok (öğrenme kodla; istem bağlamı `context()`
// çıktısından okunur: beynin her yolda isteme koyduğu metin budur, bkz. `core/brain-profile.test.ts`).
//
// Ölçüm satırları `[jarvis-benzetim]` önekiyle yazılır (rapor buradan okur): gün gün profil boyu, istemde kapladığı
// yer, brifingin ilk üç haberi (önce / sonra), elenen ilgisiz haber sayısı.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Notification, NotifyRequest, PresenceState, VoiceState } from '@fuber/shared';
import { silentLog, tempStore } from '../core/brain/testkit';
import { userContextBlock } from '../core/brain/prompt';
import { createBriefingEngine, type BriefingEngine } from './briefing/engine';
import { BRIEFING_MIGRATIONS, parseSpokenPrefs } from './briefing/prefs';
import { createProfileService, type ProfileService } from './memory/profile/service';
import { createProfileStore, PROFILE_MIGRATIONS } from './memory/profile/store';
import { COMPACT_MAX, RICH_MAX } from './memory/profile/summary';
import { createNewsService } from './news/service';
import { NEWS_MIGRATIONS } from './news/store';
import { rss, type FeedEntry } from './news/testkit';
import type { NewsStory } from './news/types';
import { fakeFetch, type FakeRoute } from './web/fake-fetch';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

let env: ReturnType<typeof tempStore>;
let nowMs: number;
let profile: ProfileService;
let news: ReturnType<typeof createNewsService>;
let briefing: BriefingEngine;
let who: PresenceState;
let voice: { state: VoiceState; quiet: boolean; conversation: boolean };
const spoken: NotifyRequest[] = [];
/** Asistanın bir önceki yanıtı (düzeltmenin bağlamı). */
let lastReply: string | null = null;

/** Benzetimin günü: 1 = 16 Kasım 2026 Pazartesi. */
const at = (day: number, hour: number, minute = 0) => {
  nowMs = new Date(2026, 10, 15 + day, hour, minute).getTime();
};
const today = () => new Date(nowMs);

// ── kayıtlı gündem: her gün aynı türde haberler (spor üç kaynakta: kişiselleştirme yokken EN ÜSTE çıkar) ──
const dayOf = () => Math.round((new Date(today().getFullYear(), today().getMonth(), today().getDate()).getTime() - new Date(2026, 10, 15).getTime()) / DAY);
const morning = (minutesAgo: number) => new Date(new Date(today().getFullYear(), today().getMonth(), today().getDate(), 7, 0).getTime() - minutesAgo * 60_000).toISOString();
const extra: Record<string, FeedEntry[]> = {};
// Her günün başlıkları farklı olaylardır (aynı kalıp ertesi gün yinelenirse kümeleme onları tek hikâye sayar).
const TEAMS = ['Galatasaray Fenerbahçe', 'Beşiktaş Trabzonspor', 'Fenerbahçe Başakşehir', 'Galatasaray Beşiktaş', 'Trabzonspor Fenerbahçe', 'Başakşehir Galatasaray', 'Beşiktaş Fenerbahçe'];
const STARTUP = [
  'Nöron adlı yapay zekâ girişimi 3 milyon dolar yatırım aldı',
  'Yapay zekâ destekli muhasebe girişimi Defterim yurt dışına açılıyor',
  'Türk girişimi Atlas, yapay zekâ çipleri için fabrika kuruyor',
  'Eğitimde yapay zekâ: Pera Eğitim ders asistanını duyurdu',
  'Girişim sermayesi fonları yapay zekâ alanına yöneliyor',
  'Lodos Robotik yapay zekâ ile depo otomasyonuna giriyor',
  'Yapay zekâ girişimlerine devlet desteği paketi açıklandı',
];
const TECH = [
  'OpenAI yeni dil modelini tanıttı',
  'Google yapay zekâ asistanını telefonlara getiriyor',
  'Anthropic kurumsal yapay zekâ aracını güncelledi',
  'Meta açık kaynak yapay zekâ modeli yayımladı',
  'Apple yapay zekâ özelliklerini Türkçeye açıyor',
  'Nvidia yeni yapay zekâ işlemcisini duyurdu',
  'Microsoft yapay zekâ ajanlarını Office’e ekledi',
];
const ECONOMY = [
  'Merkez Bankası faiz kararını açıkladı',
  'Enflasyon rakamları beklentinin altında kaldı',
  'Dolar kuru haftaya yükselişle başladı',
  'İhracat kasımda rekor kırdı',
  'Borsa İstanbul günü yükselişle kapattı',
  'Asgari ücret görüşmeleri başlıyor',
  'Merkez Bankası rezervleri arttı',
];
const pick = (list: string[]) => list[(dayOf() - 1) % list.length]!;
const feeds: Record<string, () => FeedEntry[]> = {
  'trthaber.com': () => [
    { title: `Süper Lig’de ${pick(TEAMS)} derbisi nefes kesti`, url: `https://www.trthaber.com/haber/spor/derbi-${dayOf()}.html`, at: morning(20) },
    { title: `Meclis bütçe görüşmelerinde ${dayOf()}. gün`, url: `https://www.trthaber.com/haber/gundem/butce-${dayOf()}.html`, at: morning(50) },
  ],
  'ntv.com.tr': () => [
    { title: `${pick(TEAMS)} derbisinde gol yağmuru (Süper Lig)`, url: `https://www.ntv.com.tr/spor/derbi-${dayOf()}`, at: morning(25) },
    { title: `Ünlü oyuncunun yeni dizisi magazin gündeminde (${dayOf()})`, url: `https://www.ntv.com.tr/magazin/dizi-${dayOf()}`, at: morning(40) },
  ],
  'aa.com.tr': () => [
    { title: `Süper Lig: ${pick(TEAMS)} derbisi sona erdi`, url: `https://www.aa.com.tr/tr/spor/derbi-${dayOf()}`, at: morning(15) },
    { title: pick(ECONOMY), url: `https://www.aa.com.tr/tr/ekonomi/haber-${dayOf()}`, at: morning(70) },
  ],
  'webrazzi.com/feed': () => [{ title: pick(STARTUP), url: `https://webrazzi.com/2026/11/haber-${dayOf()}`, at: morning(90) }],
  'shiftdelete.net': () => [{ title: pick(TECH), url: `https://shiftdelete.net/haber-${dayOf()}`, at: morning(100) }],
  'kriptogunluk.test': () => extra.kripto ?? [],
};
function routes(): FakeRoute[] {
  return Object.entries(feeds).map(([match, entries]) => {
    const route: FakeRoute = { match, contentType: 'application/rss+xml' };
    Object.defineProperty(route, 'body', { get: () => rss(match, entries(), { language: 'tr' }) });
    return route;
  });
}

beforeEach(() => {
  env = tempStore();
  env.store.migrate('memory', PROFILE_MIGRATIONS);
  env.store.migrate('news', NEWS_MIGRATIONS);
  env.store.migrate('briefing', BRIEFING_MIGRATIONS);
  at(1, 7, 30);
  who = { mode: 'normal', fullscreen: false, meeting: false, cameraInUse: false, micInUseByOther: false, quiet: false, idleSeconds: 5 } as PresenceState;
  voice = { state: 'idle', quiet: false, conversation: false };
  spoken.length = 0;
  lastReply = null;
  for (const key of Object.keys(extra)) delete extra[key];

  profile = createProfileService({ store: createProfileStore({ db: env.store.scoped('memory'), now: today }), now: today, log: silentLog });
  news = createNewsService({ db: env.store.scoped('news'), fetcher: fakeFetch(routes()), now: () => nowMs, interests: () => profile.interests(), log: silentLog, networkAllowed: () => true, onChange() {} });
  const db = env.store.scoped('news');
  db.run('UPDATE news_sources SET enabled = 0');
  for (const id of ['trt', 'ntv', 'aa', 'webrazzi', 'shiftdelete']) db.run('UPDATE news_sources SET enabled = 1 WHERE id = ?', [id]);

  briefing = createBriefingEngine({
    db: env.store.scoped('briefing'),
    now: today,
    sources: {
      address: () => 'Deniz Hanım',
      agenda: () => [],
      tasks: () => ({ due: [], open: 0 }),
      mail: () => null,
      news: (limit, since) => news.stories({ limit, unreadOnly: true, ...(since ? { since } : {}) }),
    },
    presence: () => who,
    quiet: () => false,
    killSwitch: () => false,
    voice: () => voice,
    notify(request) {
      spoken.push(request);
      return { id: `n${spoken.length}`, moduleId: request.moduleId, title: request.title, body: request.body ?? '', priority: request.priority, actions: [], speak: String(request.speak), dedupeKey: null, data: request.data ?? {}, status: 'shown', channel: 'voice', createdAt: today().toISOString(), shownAt: null, resolvedAt: null, actionId: null } as Notification;
    },
    appendTranscript() {},
    news: () => ({ stories: (query) => news.stories(query), breaking: (since) => news.breaking(since), refresh: () => news.refresh({ force: true }), markRead: (ids) => news.markRead(ids) }),
    learn: (text) => void profile.note({ category: 'preference', key: 'brifing-sikligi', text, explicit: false, channel: 'system' }),
    log: silentLog,
    onChange() {},
  });
});
afterEach(() => env.close());

/** Kullanıcının bir sözü: önce beynin okuyacağı bağlam (tanışma dahil), sonra turdan öğrenme. */
function say(text: string, tools: string[] = []) {
  const context = profile.context({ text, compact: false, conversational: true });
  profile.learnFromTurn({ channel: 'voice', sessionId: null, messageId: null, userText: text, previousReply: lastReply, tools });
  briefing.onUserTurn(text);
  lastReply = 'Tamam.';
  return context;
}
/** Bir sonraki turda isteme girecek metin (zengin yol). */
const prompt = () => userContextBlock(profile.context({ text: 'merhaba', compact: false, conversational: false }));
const localPrompt = () => userContextBlock(profile.context({ text: 'merhaba', compact: true, conversational: false }));
const titles = (stories: Array<Pick<NewsStory, 'title'>>) => stories.map((item) => item.title.replace(/\s*\(.*$/, '').slice(0, 44));
const log = (line: string) => console.log(`[jarvis-benzetim] ${line}`);

async function morningBrief(day: number) {
  at(day, 8, 30);
  const before = spoken.length;
  await briefing.tick();
  const card = briefing.today();
  return { said: spoken.length > before ? String(spoken.at(-1)!.speak) : null, card };
}

describe('yedi günlük benzetim: öğrenme, düzeltme, kişisel brifing, ilgisiz haberin elenmesi', () => {
  it('uçtan uca', async () => {
    const days: string[] = [];
    const track = (day: number) => {
      const overview = profile.overview();
      days.push(`gün ${day}: ${overview.total} kayıt (${overview.rules} kural), istem ${overview.promptChars.rich} / yerel ${overview.promptChars.compact} karakter`);
      expect(overview.promptChars.rich).toBeLessThanOrEqual(RICH_MAX);
      expect(overview.promptChars.compact).toBeLessThanOrEqual(COMPACT_MAX);
    };

    // ── 1. gün: Jarvis kullanıcıyı tanımıyor ──
    expect(prompt()).toBe('');
    const first = await morningBrief(1);
    expect(first.said).toContain('Günaydın Deniz Hanım.');
    const beforeTop = titles(first.card!.news);
    // Kişiselleştirme yok: üç kaynağın verdiği spor haberi en üstte, magazin de listede.
    expect(first.card!.news[0]!.title).toContain('derbi');
    expect(first.card!.news[0]!.reasons.join()).toMatch(/^[23] kaynak$/);
    briefing.onUserTurn('Teşekkürler.');

    // Tanışma: ilk sözde tek soru; yanıtlar profile yazılır; istemeyince bırakır.
    at(1, 9, 0);
    const hello = say('Merhaba Jarvis.');
    expect(hello?.note).toContain('ne işle uğraştığını');
    at(1, 9, 1);
    const work = say('Atlas adında bir mobilya şirketim var; ofisler için çalışma masası üretiyoruz.');
    expect(work?.note).toContain('hangi konuları takip ettiğini');
    at(1, 9, 2);
    const interest = say('Yapay zekâ, girişimcilik ve ekonomi.');
    expect(interest?.note).toContain('yanıtlarını nasıl istediğini');
    at(1, 9, 3);
    say('Kısa ve net olsun, lafı uzatma.');
    expect(profile.interests().follow.sort()).toEqual(['Yapay zekâ', 'ekonomi', 'girişimcilik']);
    expect(prompt()).toContain('İşi (kendi anlatımı): “Atlas adında bir mobilya şirketim var');
    track(1);

    // ── 2. gün: brifing ilgi alanına göre; "spor sevmem" → spor ve aynı gün sonraki brifinglerde elenir ──
    const second = await morningBrief(2);
    const secondTitles = second.card!.news.map((item) => item.title).join(' | ');
    expect(second.card!.news.some((item) => item.reasons.some((reason) => reason.startsWith('ilgi alanı:')))).toBe(true);
    expect(second.said).toMatch(/(yapay zekâ|ekonomi|girişimcilik) tarafında/i);
    briefing.onUserTurn('İkincisini biraz açar mısın?');
    at(2, 9, 0);
    say('Spor haberlerini sevmem.');
    say('Bundan sonra yanıtlarını kısa tut.');
    expect(profile.interests().mute).toEqual(['Spor']);
    expect(prompt()).toContain('[yanit-uzunlugu] “Bundan sonra yanıtlarını kısa tut.”');
    expect(localPrompt()).toContain('Kullanıcının kuralları (uygula): “Bundan sonra yanıtlarını kısa tut.”');
    track(2);

    // ── 3. gün: spor yok; kullanıcı her sabah havayı soruyor (rutin üçüncü günde öğrenilir) ──
    const third = await morningBrief(3);
    expect(third.card!.news.map((item) => item.title).join(' ')).not.toMatch(/derbi|Süper Lig/);
    expect(third.said).not.toMatch(/derbi|Galatasaray/);
    briefing.onUserTurn('Sağ ol.');
    for (const day of [1, 2, 3]) {
      at(day, 9, 30);
      say('Hava nasıl?', ['weather_get']);
    }
    expect(profile.routines().map((item) => item.text)).toEqual(['Sabahları genelde hava durumunu sorar.']);
    at(3, 10, 0);
    say('Bir daha bana efendim deme.');
    say('Eşim Ayşe yarın İzmir’den geliyor.');
    expect(prompt()).toContain('[hitap] “Bir daha bana efendim deme.”');
    expect(prompt()).toContain('Yakın çevre: Eşi: Ayşe.');
    track(3);

    // ── 4. gün: çelişki: yeni söz eskisinin yerini alır, eskisi tarihli olarak geçmişte durur ──
    await morningBrief(4);
    briefing.onUserTurn('Tamam.');
    at(4, 11, 0);
    say('Bundan sonra ayrıntılı anlat.');
    const rules = profile.store.list({ category: 'rule' });
    expect(rules.filter((rule) => rule.key === 'yanit-uzunlugu').map((rule) => rule.text)).toEqual(['“Bundan sonra ayrıntılı anlat.”']);
    expect(prompt()).not.toContain('kısa tut');
    expect(prompt()).toContain('[yanit-uzunlugu] “Bundan sonra ayrıntılı anlat.”');
    const history = profile.overview().history;
    expect(history.some((entry) => entry.text === '“Bundan sonra yanıtlarını kısa tut.”' && entry.replacedBy === '“Bundan sonra ayrıntılı anlat.”')).toBe(true);
    // Hâlâ geçerli olan öteki düzeltme unutulmadı.
    expect(prompt()).toContain('[hitap] “Bir daha bana efendim deme.”');
    track(4);

    // ── 5. gün: "şu RSS kaynağını kendine ekle" + konu takibi + sesle brifing saati ──
    at(5, 7, 0);
    extra.kripto = [{ title: 'Bitcoin 70 bin doları aştı', url: 'https://kriptogunluk.test/bitcoin-70', at: new Date(nowMs - HOUR).toISOString() }];
    const added = await news.addSource('https://kriptogunluk.test/rss.xml');
    expect(added.ok).toBe(true);
    expect(news.sources().some((source) => source.url.includes('kriptogunluk.test') && !source.builtin && source.enabled)).toBe(true);
    news.setTopic('kripto', 'follow');
    const spokenPrefs = parseSpokenPrefs('Sabah brifingini sekizde ver.', briefing.prefs(), today());
    briefing.setPrefs(spokenPrefs!.patch);
    expect(briefing.prefs().morning).toEqual({ enabled: true, time: '08:00' });
    at(5, 8, 0);
    const before = spoken.length;
    await briefing.tick();
    expect(spoken.length).toBe(before + 1);
    const fifth = briefing.today()!;
    expect(fifth.news[0]).toMatchObject({ title: 'Bitcoin 70 bin doları aştı', reasons: ['takip: kripto'] });
    expect(String(spoken.at(-1)!.speak)).toContain('kripto tarafında, Bitcoin 70 bin doları aştı');
    track(5);

    // ── 5.–7. gün: kullanıcı ilgilenmiyor (yanıt yok, "sus", "yeter") → Jarvis kendiliğinden azalır ve bunu öğrenir ──
    at(5, 8, 10);
    await briefing.tick();
    at(6, 8, 0);
    await briefing.tick();
    briefing.onUserTurn('Sus.');
    at(7, 8, 0);
    await briefing.tick();
    briefing.onUserTurn('Yeter.');
    const tired = briefing.state();
    expect(tired.adaptive.factor).toBe(0.5);
    expect(tired.adaptive.note).toContain('daha seyrek');
    expect(profile.store.list({ category: 'preference' }).some((item) => item.key === 'brifing-sikligi' && item.origin === 'inferred')).toBe(true);
    expect(prompt()).toContain('Kendiliğinden konuşmalara çoğu zaman yanıt vermiyor');
    track(7);

    // ── 7. gün sonu: ölçüm ──
    at(7, 12, 0);
    await news.refresh({ force: true });
    const all = news.stories({ limit: 30 });
    const afterTop = titles(briefing.today()!.news);
    const text = all.map((item) => item.title).join(' | ');
    expect(text).not.toMatch(/derbi|Süper Lig/);
    // Aynı yedi günde spor kaynakları her gün üç haber verdi: hepsi elendi; magazin elenmedi (kullanıcı öyle demedi).
    const muted = news.stories({ limit: 100, unreadOnly: false }).length;
    for (const line of days) log(line);
    log(`brifingin ilk haberleri · 1. gün (tanımadan): ${JSON.stringify(beforeTop)}`);
    log(`brifingin ilk haberleri · 2. gün (ilgi alanları): ${JSON.stringify(titles(second.card!.news))}`);
    log(`brifingin ilk haberleri · 7. gün (ilgi + sevmediği + takip): ${JSON.stringify(afterTop)}`);
    log(`7. gün depoda ${muted} hikâye; spor başlığı: 0 (1. gün brifinginde ilk sıradaydı); 2. gün başlıkları: ${secondTitles.slice(0, 160)}`);
    log(`öğrenilmiş konuşkanlık çarpanı ${tired.adaptive.factor}; yanıtsız ${tired.adaptive.ignored}, ret ${tired.adaptive.declined}, ilgi ${tired.adaptive.engaged}`);
    expect(beforeTop.join(' ')).toMatch(/derbi/);
    expect(afterTop.join(' ')).not.toMatch(/derbi/);

    // Kullanıcı Hafıza sayfasında görür, düzeltir, siler.
    const overview = profile.overview();
    expect(overview.groups[0]!.category).toBe('rule');
    expect(overview.summary).toContain('Uyduğum');
    const wife = profile.store.list({ category: 'circle' })[0]!;
    const fixed = profile.store.edit(wife.id, { text: 'Eşi: Ayşe (mimar).' })!;
    expect(fixed).toMatchObject({ locked: true, origin: 'user' });
    expect(profile.store.remove(fixed.id)).toBe(true);
    expect(prompt()).not.toContain('Ayşe');
  });
});
