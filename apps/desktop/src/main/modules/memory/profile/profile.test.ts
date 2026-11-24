import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { silentLog, tempStore } from '../../../core/brain/testkit';
import { userContextBlock } from '../../../core/brain/prompt';
import { introState, introTurn, MAX_PER_DAY } from './intro';
import { explicitLearnings, topicOf } from './learn';
import { createProfileService, ROUTINE_MIN_DAYS, type ProfileService } from './service';
import { createProfileStore, looksSecret, PROFILE_MIGRATIONS, sameTopic, type ProfileStore } from './store';
import { COMPACT_MAX, renderProfileContext, RICH_MAX } from './summary';

let env: ReturnType<typeof tempStore>;
let store: ProfileStore;
let service: ProfileService;
let clock: Date;
const changes: string[] = [];

beforeEach(() => {
  env = tempStore();
  env.store.migrate('memory', PROFILE_MIGRATIONS);
  clock = new Date(2026, 10, 17, 9, 0, 0);
  store = createProfileStore({ db: env.store.scoped('memory'), now: () => clock });
  changes.length = 0;
  service = createProfileService({ store, now: () => clock, log: silentLog, onChange: (reason) => void changes.push(reason) });
});
afterEach(() => env.close());

const advance = (hours: number) => {
  clock = new Date(clock.getTime() + hours * 3_600_000);
};

describe('açık sözlerden öğrenme (kodla)', () => {
  const kinds = (text: string, previous: string | null = null) => explicitLearnings(text, previous).map((learned) => `${learned.category}:${learned.key ?? '-'}`);

  it('düzeltme davranış kuralı olur ve konusu anahtarlanır', () => {
    expect(kinds('Bundan sonra yanıtlarını kısa tut.')).toEqual(['rule:yanit-uzunlugu']);
    expect(kinds('Bir daha bana efendim deme.')).toEqual(['rule:hitap']);
    expect(kinds('Bu kadar uzun anlatma, lafı uzatma.')).toEqual(['rule:yanit-uzunlugu']);
    expect(kinds('Her zaman önce sonucu söyle.')).toEqual(['rule:-']);
  });

  it('"böyle isterim" bir önceki yanıta bağlanır', () => {
    const [rule] = explicitLearnings('Evet, bunu böyle isterim.', 'Bugün üç işiniz var: KDV beyannamesi, Atlas toplantısı ve fatura.');
    expect(rule?.category).toBe('rule');
    expect(rule?.text).toContain('asistanın şu yanıtı üzerine');
    expect(rule?.text).toContain('KDV beyannamesi');
  });

  it('soru, tek seferlik istek ve hatırlatıcı isteği kural değildir', () => {
    expect(kinds('Bundan sonra ne yapacağız?')).toEqual([]);
    expect(kinds('Şimdi konuşma, bir dakika.')).toEqual([]);
    expect(kinds('Her pazartesi KDV beyannamesini hatırlat.')).toEqual([]);
    expect(kinds('Hava nasıl?')).toEqual([]);
    expect(kinds('Yarın saat onda toplantıyı hatırlat.')).toEqual([]);
  });

  it('gündelik sözler ve tek seferlik olumsuz istekler öğrenilmez (yanlış kural olmasın)', () => {
    for (const text of [
      'Ali’ye mesaj gönderme.',
      'Konuşma.',
      'Tamam, anlatma.',
      'O dosyayı silme.',
      'Müziği kapat.',
      'Bugün çok yorgunum.',
      'Seni seviyorum Jarvis.',
      'Hâlâ bekliyorum.',
      'Toplantıyı takvime ekleme.',
      'Bana bir kahve tarifi ver.',
      'Teşekkürler, çok iyi oldu.',
    ]) {
      expect(kinds(text), text).toEqual([]);
    }
    // Asistanın davranışına yönelen olumsuz emir kalıcılık işareti olmadan da kuraldır.
    expect(kinds('Bana efendim deme.')).toEqual(['rule:hitap']);
    expect(kinds('Sürekli özür dileme.')).toEqual(['rule:ozur']);
    expect(kinds('Her şeyi iki kez tekrarlama.')).toEqual(['rule:tekrar']);
    expect(kinds('Bana sormadan dosya silme.')).toEqual(['rule:onay-sorma']);
  });

  it('sevmedikleri, ilgi alanları, tercihler', () => {
    expect(kinds('Spor haberlerini sevmem.')).toEqual(['dislike:-']);
    expect(kinds('Yapay zekâ gelişmelerini yakından takip ediyorum.')).toEqual(['interest:-']);
    expect(kinds('Kahveyi sade içerim.')).toEqual(['preference:-']);
    expect(kinds('Toplantıları sabah yapmayı tercih ederim.')).toEqual(['preference:-']);
  });

  it('yakın çevre, şirket, proje, şehir, meslek', () => {
    expect(explicitLearnings('Eşim Ayşe yarın geliyor.')[0]).toMatchObject({ category: 'circle', key: 'es', text: 'Eşi: Ayşe.' });
    expect(explicitLearnings('Muhasebecim Mehmet Bey ile görüştüm.')[0]).toMatchObject({ category: 'circle', key: 'muhasebeci', text: 'Muhasebecisi: Mehmet Bey.' });
    expect(explicitLearnings('Şirketim Atlas Limited Ankara’da kurulu.')[0]).toMatchObject({ category: 'work', text: 'Şirketi: Atlas Limited Ankara.' });
    expect(explicitLearnings('Atlas projesi üzerinde çalışıyorum.')[0]).toMatchObject({ category: 'work', key: 'proje-atlas' });
    expect(explicitLearnings('Ankara’da yaşıyorum.')[0]).toMatchObject({ category: 'identity', key: 'sehir', text: 'Yaşadığı yer: Ankara.' });
    expect(explicitLearnings('Ben yazılım mühendisiyim.')[0]).toMatchObject({ category: 'identity', key: 'meslek' });
    // "eşim bugün gelmeyecek": ad yok, kayıt yok
    expect(explicitLearnings('Eşim bugün gelmeyecek.')).toEqual([]);
    // "doktorum Ayşe Hanım" meslek değil, yakın çevredir
    expect(kinds('Doktorum Ayşe Hanım aradı.')).toEqual(['circle:doktor']);
  });

  it('rutin ve süren mesele', () => {
    expect(kinds('Her sabah yedide kalkarım.')).toEqual(['routine:-']);
    expect(kinds('Şu sıralar yatırım turuyla uğraşıyorum.')).toEqual(['ongoing:-']);
  });

  it('konu ayıklama (haber puanlaması için)', () => {
    expect(topicOf('Spor haberlerini sevmem.')).toBe('Spor');
    expect(topicOf('Yapay zekâ gelişmelerini yakından takip ediyorum.')).toBe('Yapay zekâ');
  });
});

describe('profil deposu: çelişki, güven, kaynak', () => {
  it('aynı bilgi yinelenince doğrulanır, yenisi açılmaz', () => {
    const first = store.learn({ category: 'preference', text: 'Kahveyi sade içer.', origin: 'inferred', channel: 'voice' });
    const again = store.learn({ category: 'preference', text: 'Kahveyi sade içer.', origin: 'said', channel: 'voice' });
    expect(first.kind).toBe('added');
    expect(again.kind).toBe('confirmed');
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]).toMatchObject({ confirmations: 1, confidence: 1, origin: 'said' });
  });

  it('aynı anahtarın yeni bilgisi eskisinin yerini alır; eskisi tarihli olarak geçmişte durur', () => {
    store.learn({ category: 'rule', key: 'yanit-uzunlugu', text: '“Yanıtlarını kısa tut.”', origin: 'said', channel: 'voice' });
    advance(48);
    const next = store.learn({ category: 'rule', key: 'yanit-uzunlugu', text: '“Bundan sonra ayrıntılı anlat.”', origin: 'said', channel: 'chat' });
    expect(next.kind).toBe('superseded');
    const active = store.list();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ text: '“Bundan sonra ayrıntılı anlat.”', previousText: '“Yanıtlarını kısa tut.”' });
    const history = store.history(5);
    expect(history).toHaveLength(1);
    expect(history[0]?.old.status).toBe('superseded');
    expect(history[0]?.replacedBy?.id).toBe(active[0]?.id);
    expect(history[0]?.old.updatedAt).toBe(clock.toISOString());
  });

  it('sayı değişen aynı konu çelişkidir; ilgisiz iki tercih ayrı kalır', () => {
    expect(sameTopic('Raporları en fazla 5 madde ver.', 'Bundan sonra raporları en fazla 3 madde ver.')).toBe(true);
    expect(sameTopic('Kahveyi sade içer.', 'Çayı sade içer.')).toBe(false);
    store.learn({ category: 'preference', text: 'Kahveyi sade içer.', origin: 'said', channel: 'voice' });
    store.learn({ category: 'preference', text: 'Çayı sade içer.', origin: 'said', channel: 'voice' });
    expect(store.list()).toHaveLength(2);
  });

  it('çıkarım, kullanıcının kendi sözünü ve elle düzeltmesini ezemez', () => {
    store.learn({ category: 'identity', key: 'sehir', text: 'Yaşadığı yer: Ankara.', origin: 'said', channel: 'voice' });
    const guess = store.learn({ category: 'identity', key: 'sehir', text: 'İstanbul’da yaşıyor olabilir.', origin: 'inferred', channel: 'voice' });
    expect(guess).toEqual({ kind: 'skipped', reason: 'first-hand-wins' });
    const said = store.learn({ category: 'identity', key: 'sehir', text: 'Yaşadığı yer: İzmir.', origin: 'said', channel: 'voice' });
    expect(said.kind).toBe('superseded');
  });

  it('elle düzeltme kilitler; silme zinciri de siler', () => {
    const added = store.learn({ category: 'work', text: 'Şirketi: Atlas.', origin: 'inferred', channel: 'chat' });
    if (added.kind !== 'added') throw new Error('eklenmedi');
    const edited = store.edit(added.item.id, { text: 'Şirketi: Atlas Limited (Ankara).' });
    expect(edited).toMatchObject({ locked: true, confidence: 1, origin: 'user', previousText: 'Şirketi: Atlas.' });
    expect(store.learn({ category: 'work', key: edited!.key, text: 'Şirketi: Başka A.Ş.', origin: 'inferred', channel: 'chat' })).toEqual({ kind: 'skipped', reason: 'locked' });
    expect(store.remove(edited!.id)).toBe(true);
    expect(store.list({ includeSuperseded: true })).toHaveLength(0);
  });

  it('sır profile yazılmaz', () => {
    expect(looksSecret('Banka şifrem 4821')).toBe(true);
    expect(store.learn({ category: 'identity', text: 'Kart numarası 4111111111111111', origin: 'said', channel: 'voice' })).toEqual({ kind: 'skipped', reason: 'secret' });
  });

  it('aynı düzeltme farklı anahtarla gelirse (kod + model) tek kural kalır; çelişkide eskisi yan yana durmaz', () => {
    store.learn({ category: 'rule', key: 'yanit-uzunlugu', text: '“Bundan sonra yanıtlarını tek cümleyle ver.”', origin: 'said', channel: 'voice' });
    const model = store.learn({ category: 'rule', key: 'yanit-bicimi', text: 'Yanıtları tek cümleyle ver.', origin: 'said', channel: 'voice' });
    expect(model.kind).not.toBe('added');
    expect(store.list({ category: 'rule' })).toHaveLength(1);
    // İlgisiz kurallar ayrı kalır.
    store.learn({ category: 'rule', key: 'hitap', text: '“Bir daha bana efendim deme.”', origin: 'said', channel: 'voice' });
    store.learn({ category: 'rule', key: 'sayi-bicimi', text: 'Rakamları yuvarlayarak söyle.', origin: 'said', channel: 'voice' });
    expect(store.list({ category: 'rule' })).toHaveLength(3);
  });

  it('kısa kayıt, aynı bilgiyi zaten taşıyan zengin kaydın yerini almaz (doğrular)', () => {
    store.learn({ category: 'circle', key: 'kiz', text: 'Kızı Elif; 2026’da üniversiteye başladı.', origin: 'said', channel: 'voice' });
    const terse = store.learn({ category: 'circle', key: 'kiz', text: 'Kızı: Elif.', origin: 'said', channel: 'voice' });
    expect(terse.kind).toBe('confirmed');
    expect(store.list({ category: 'circle' }).map((item) => item.text)).toEqual(['Kızı Elif; 2026’da üniversiteye başladı.']);
    // Yeni bilgi getiren söz yine yerini alır.
    expect(store.learn({ category: 'circle', key: 'kiz', text: 'Kızı Elif; mimarlık okuyor.', origin: 'said', channel: 'voice' }).kind).toBe('superseded');
  });

  it('söze göre arama', () => {
    store.learn({ category: 'circle', key: 'muhasebeci', text: 'Muhasebecisi: Mehmet Bey.', origin: 'said', channel: 'voice' });
    store.learn({ category: 'preference', text: 'Kahveyi sade içer.', origin: 'said', channel: 'voice' });
    expect(store.search('muhasebecimi ara', 5).map((item) => item.key)).toEqual(['muhasebeci']);
  });
});

describe('isteme giren özet', () => {
  const fill = () => {
    store.learn({ category: 'rule', key: 'yanit-uzunlugu', text: '“Bundan sonra yanıtlarını kısa tut.”', origin: 'said', channel: 'voice' });
    store.learn({ category: 'rule', key: 'hitap', text: '“Bir daha bana efendim deme.”', origin: 'said', channel: 'voice' });
    store.learn({ category: 'work', text: 'Şirketi: Atlas Limited.', origin: 'said', channel: 'voice' });
    store.learn({ category: 'interest', text: 'Yapay zekâ gelişmelerini yakından takip eder.', origin: 'said', channel: 'voice' });
    store.learn({ category: 'dislike', text: '“Spor haberlerini sevmem.”', origin: 'said', channel: 'voice' });
  };

  it('zengin biçim: kurallar anahtarlarıyla en üstte; sınırın altında', () => {
    fill();
    const { summary } = renderProfileContext(store, { compact: false, text: '' });
    expect(summary).toContain('## Kullanıcı profili');
    expect(summary).toContain('- [yanit-uzunlugu] “Bundan sonra yanıtlarını kısa tut.”');
    expect(summary.indexOf('Davranış kuralları')).toBeLessThan(summary.indexOf('İşler ve projeler'));
    expect(summary.length).toBeLessThanOrEqual(RICH_MAX);
  });

  it('yerel biçim kısadır ve kuralları taşır', () => {
    fill();
    const { summary, details } = renderProfileContext(store, { compact: true, text: 'haberlerde ne var' });
    expect(summary).toContain('Kullanıcının kuralları (uygula)');
    expect(summary).toContain('kısa tut');
    expect(summary.length).toBeLessThanOrEqual(COMPACT_MAX);
    expect(details).toEqual([]);
  });

  it('çok kayıtta sınır aşılmaz; kurallar düşmez; sığmayan ilgili kayıt söze göre çekilir', () => {
    // On iki AYRI kural (benzer kurallar tek kayıtta birleşir; burada konular birbirinden farklıdır).
    const rules = [
      'Hava durumunu söylerken yalnız sıcaklığı ve yağışı bildir.',
      'Döviz kurlarını kuruş hanesi olmadan oku.',
      'Takvimdeki toplantıları saat sırasıyla say.',
      'E-postaları gönderenin adıyla özetle.',
      'Fatura tutarlarını Türk lirası olarak belirt.',
      'Proje adlarını kısaltma kullanmadan telaffuz et.',
      'Vergi tarihlerini iki gün önceden haber ver.',
      'Müşteri görüşmelerinden sonra not çıkarmayı teklif et.',
      'Dosya yollarını sesli okuma, ekranda göster.',
      'Alışveriş listesini market reyonlarına göre grupla.',
      'Gece yarısından sonra espri yapma.',
      'İngilizce terimlerin Türkçe karşılığını kullan.',
    ];
    rules.forEach((text, index) => store.learn({ category: 'rule', key: `kural-${index}`, text: `“${text}”`, origin: 'said', channel: 'voice' }));
    for (let index = 0; index < 30; index++) {
      store.learn({ category: 'work', key: `proje-${index}`, text: `Proje ${index}: müşteri ${index} için uzun soluklu bir danışmanlık ve yazılım geliştirme işi yürütüyor, teslim tarihi belirsiz.`, origin: 'said', channel: 'chat' });
      advance(1);
    }
    store.learn({ category: 'work', key: 'proje-ozel', text: 'Karadeniz lojistik projesini Trabzon ekibiyle yürütüyor.', origin: 'inferred', channel: 'chat', confidence: 0.4 });
    const context = renderProfileContext(store, { compact: false, text: 'Trabzon ekibi ne durumda?' });
    expect(context.summary.length).toBeLessThanOrEqual(RICH_MAX);
    expect(context.summary.match(/^- \[kural-/gm)).toHaveLength(12);
    expect(context.details.some((detail) => detail.line.includes('Trabzon'))).toBe(true);
    expect(userContextBlock({ ...context, note: null })).toContain('Bu sözle ilgili öteki kayıtlar:');
  });

  it('profil boşsa blok yok', () => {
    expect(renderProfileContext(store, { compact: false, text: 'merhaba' })).toEqual({ summary: '', details: [] });
    expect(userContextBlock(null)).toBe('');
  });
});

describe('tanışma', () => {
  const turn = (text: string, conversational = true) => introTurn(store, { text, now: clock, presence: null, conversational });

  it('ilk sözde tek soru; yanıt profile yazılır; aynı gün en çok üç soru', () => {
    const first = turn('Merhaba Jarvis.');
    expect(first.note).toContain('Tanışma (bu tura özgü)');
    expect(first.note).toContain('ne işle uğraştığını');
    advance(0.01);
    const second = turn('Atlas adında bir mobilya şirketim var, ofisler için çalışma masası yapıyoruz.');
    expect(second.answer).toMatchObject({ category: 'work', key: 'tanisma-work' });
    expect(second.answer?.text).toContain('ofisler için');
    expect(second.note).toContain('hangi konuları takip ettiğini');
    advance(0.01);
    const third = turn('Yapay zekâ, girişimcilik ve ekonomi.');
    expect(third.answer?.category).toBe('interest');
    expect(third.note).not.toBeNull();
    advance(0.01);
    const fourth = turn('Kısa ve net olsun.');
    expect(fourth.answer?.category).toBe('style');
    expect(fourth.note).toBeNull();
    expect(introState(store)).toMatchObject({ asked: MAX_PER_DAY, answered: 3 });
  });

  it('aynı tur yeniden denenirse (sağlayıcı zinciri) soru bir kez sayılır', () => {
    const a = turn('Merhaba.');
    const b = turn('Merhaba.');
    expect(b.note).toBe(a.note);
    expect(introState(store).asked).toBe(1);
  });

  it('"sorma" denince bırakır', () => {
    turn('Merhaba.');
    advance(0.01);
    const declined = turn('Sorma şimdi bunları.');
    expect(declined).toMatchObject({ declined: true, note: null, answer: null });
    advance(30);
    expect(turn('Günaydın.').note).toBeNull();
    expect(introState(store).enabled).toBe(false);
  });

  it('soruya yanıt yerine iş istenirse yanıt sayılmaz; iki kez yanıtsız kalınca üç gün ara verir', () => {
    turn('Merhaba.');
    advance(0.01);
    expect(turn('Yarın saat onda toplantıyı hatırlat.')).toMatchObject({ answer: null, note: null });
    advance(21);
    expect(turn('Günaydın.').note).not.toBeNull();
    advance(0.01);
    turn('Hava nasıl?');
    advance(24);
    expect(turn('Günaydın.').note).toBeNull();
    advance(72);
    expect(turn('Günaydın.').note).not.toBeNull();
  });

  it('görev turunda, toplantıda ve acelede soru sorulmaz', () => {
    expect(turn('Raporu hazırla.', false).note).toBeNull();
    expect(introTurn(store, { text: 'Merhaba.', now: clock, presence: { mode: 'meeting', fullscreen: false, meeting: true }, conversational: true }).note).toBeNull();
    expect(turn('Acil, hemen şunu aç.').note).toBeNull();
  });

  it('profilde karşılığı olan konu sorulmaz', () => {
    store.learn({ category: 'work', text: 'Şirketi: Atlas Limited.', origin: 'said', channel: 'voice' });
    expect(turn('Merhaba.').note).toContain('hangi konuları takip ettiğini');
  });
});

describe('profil servisi', () => {
  it('turdan öğrenir ve değişikliği yayınlar', () => {
    const outcomes = service.learnFromTurn({ channel: 'voice', sessionId: null, messageId: null, userText: 'Bundan sonra yanıtlarını kısa tut. Eşim Ayşe.', previousReply: null, tools: [] });
    expect(outcomes.map((outcome) => outcome.kind)).toEqual(['added', 'added']);
    expect(changes).toEqual(['learned']);
    const context = service.context({ text: 'merhaba', compact: false, conversational: false });
    expect(context?.summary).toContain('[yanit-uzunlugu]');
    expect(context?.summary).toContain('Eşi: Ayşe.');
  });

  it('yinelenen istek üç farklı günde rutin olur', () => {
    for (let day = 0; day < ROUTINE_MIN_DAYS; day++) {
      const outcomes = service.learnFromTurn({ channel: 'voice', sessionId: null, messageId: null, userText: 'Hava nasıl?', previousReply: null, tools: ['weather_get'] });
      expect(outcomes.some((outcome) => outcome.kind === 'added')).toBe(day === ROUTINE_MIN_DAYS - 1);
      advance(24);
    }
    expect(service.routines().map((item) => item.text)).toEqual(['Sabahları genelde hava durumunu sorar.']);
    expect(service.routines()[0]).toMatchObject({ origin: 'observed', confidence: 0.6 });
  });

  it('aynı işin iki reddi öğrenilir; bir onay varsa öğrenilmez', () => {
    expect(service.observeApproval('mail_send', 'Ahmet Bey’e e-posta göndermek istiyorum', false)).toBeNull();
    const learned = service.observeApproval('mail_send', 'Ahmet Bey’e e-posta göndermek istiyorum', false);
    expect(learned?.kind).toBe('added');
    service.observeApproval('file_delete', 'x', true);
    service.observeApproval('file_delete', 'x', false);
    expect(service.observeApproval('file_delete', 'x', false)).toBeNull();
  });

  it('ilgi alanları ve sevmedikleri konu olarak çıkar', () => {
    service.learnFromTurn({ channel: 'voice', sessionId: null, messageId: null, userText: 'Spor haberlerini sevmem. Yapay zekâ gelişmelerini yakından takip ediyorum.', previousReply: null, tools: [] });
    store.learn({ category: 'interest', key: 'tanisma-interest', text: 'Takip ettikleri (kendi anlatımı): “girişimcilik ve ekonomi”', origin: 'intro', channel: 'system' });
    const interests = service.interests();
    expect(interests.mute).toEqual(['Spor']);
    expect(interests.follow.sort()).toEqual(['Yapay zekâ', 'ekonomi', 'girişimcilik']);
  });

  it('tanışma yanıtı bağlam okunurken profile yazılır', () => {
    const first = service.context({ text: 'Merhaba.', compact: false, conversational: true });
    expect(first?.note).toContain('Tanışma');
    advance(0.01);
    const second = service.context({ text: 'Atlas adında bir mobilya şirketim var.', compact: false, conversational: true });
    expect(second?.summary).toContain('İşi (kendi anlatımı)');
    // yerel modelde tanışma notu verilmez
    expect(service.context({ text: 'Peki.', compact: true, conversational: true })?.note ?? null).toBeNull();
  });
});

describe('yazıcının (model) profil çıkarımı', () => {
  it('kullanıcının sözüne dayanmayan ve asistana hitap eden kayıt reddedilir', async () => {
    const { groundedInUser } = await import('../writer');
    // Ölçülen vaka (yerel 4B model): sistem isteminden uydurulan "rutin".
    expect(groundedInUser('Kullanıcıya ‘efendim’ diye hitap ediyorsun.', 'Bundan sonra ayrıntılı anlat.')).toBe(false);
    expect(groundedInUser('Kullanıcı her sabah koşuya çıkar.', 'Bundan sonra ayrıntılı anlat.')).toBe(false);
    expect(groundedInUser('Kullanıcı, yanıtların ayrıntılı olmasını ister.', 'Bundan sonra ayrıntılı anlat.')).toBe(true);
    expect(groundedInUser('Kızı Elif üniversiteye başladı.', 'Kızım Elif bu yıl üniversiteye başladı.')).toBe(true);
  });

  it('yazıcının kaydı her zaman çıkarımdır: kullanıcının açık sözünün üstüne yazamaz', async () => {
    const { processTurn } = await import('../writer');
    service.learnFromTurn({ channel: 'voice', sessionId: null, messageId: null, userText: 'Ankara’da yaşıyorum.', previousReply: null, tools: [] });
    const ctx = {
      conversation: { messages: () => [{ id: 'u1', role: 'user', text: 'Ankara’da yaşıyorum, İstanbul’a sık giderim.', toolCalls: [] }, { id: 'a1', role: 'assistant', text: 'Tamam.', toolCalls: [] }] },
      memory: { search: () => [], get: () => null, save: () => null },
      brain: {
        extract: async () => ({
          items: [],
          profile: [
            { category: 'identity', key: 'sehir', text: 'İstanbul’da yaşıyor.', explicit: true },
            { category: 'routine', key: 'istanbul', text: 'İstanbul’a sık gider.', explicit: true },
          ],
        }),
      },
      log: silentLog,
    };
    await processTurn({ ctx: ctx as never, profile: service }, { sessionId: 's1', userMessageId: 'u1', assistantMessageId: 'a1', channel: 'voice' });
    expect(store.list({ category: 'identity' }).map((item) => item.text)).toEqual(['Yaşadığı yer: Ankara.']);
    expect(store.list({ category: 'routine' })[0]).toMatchObject({ text: 'İstanbul’a sık gider.', origin: 'inferred', confidence: 0.7 });
  });
});
