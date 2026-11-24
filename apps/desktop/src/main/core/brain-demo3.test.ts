// demo.3: "her şeyi konuşarak" ve yerel beynin bilinen kusurlarının birim testleri. Sahte llama-server ile: modelin ne
// dediği senaryodan gelir, sınanan beynin o söze ne yaptığıdır (kodla eşlenen komutlar, geçmişten yanıt, kalem düzeltme,
// sesli söz sınırı, "yerel modelle çalışıyorum" duyurusu).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEEP_BRAIN_UNKNOWN, DEFAULT_POLICY, defineTool, type Bus, type DeepBrainStatus, type MemoryApi, type Policy, type UsageApi } from '@fuber/shared';
import { z } from 'zod';
import { createBrain, ownHistoryText } from './brain';
import { setDeepStatus } from './brain/deep/status';
import type { LlmServer } from './brain/llm-server';
import { SUMMARY_OPEN } from './brain/prompt';
import { fakePolicy, fakePresence, miniTools, moduleContext, silentLog, tempStore, testBus } from './brain/testkit';
import { createMemory } from './memory';
import { createUsage } from './usage';

type LocalTurn = { text?: string; tool?: { name: string; args: string } };

function sse(turn: LocalTurn): string {
  const chunks: unknown[] = [];
  for (const piece of (turn.text ?? '').match(/.{1,5}/gs) ?? []) chunks.push({ choices: [{ delta: { content: piece } }] });
  if (turn.tool) {
    chunks.push({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: turn.tool.name, arguments: '' } }] } }] });
    chunks.push({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: turn.tool.args } }] } }] });
  }
  chunks.push({ choices: [{ delta: {}, finish_reason: turn.tool ? 'tool_calls' : 'stop' }] });
  chunks.push({ choices: [], usage: { prompt_tokens: 50, completion_tokens: 10 } });
  return chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n';
}

interface Body {
  messages: Array<{ role: string; content: string | null }>;
  tools?: Array<{ function: { name: string } }>;
  tool_choice?: string;
}

const server: LlmServer = {
  available: () => ({ ok: true, reason: null }),
  ensure: async () => 'http://127.0.0.1:1',
  touch() {},
  status: () => ({ state: 'ready', reason: null, baseUrl: 'http://127.0.0.1:1', modelId: 'qwen' }),
  stop: async () => {},
};

let env: ReturnType<typeof tempStore>;
let bus: Bus;
let memory: MemoryApi;
let usage: UsageApi;
let tools: ReturnType<typeof miniTools>;
let ran: Array<{ name: string; input: unknown }>;

const record = (name: string, input: z.ZodType, text: string, risk: 'read' | 'write' = 'write', group?: string) =>
  defineTool({
    name,
    description: `${name} aracı.`,
    input,
    risk,
    ...(group ? { group } : {}),
    run: async (value) => {
      ran.push({ name, input: value });
      return { ok: true, text };
    },
  });

beforeEach(() => {
  env = tempStore();
  bus = testBus();
  memory = createMemory({ store: env.store, bus, log: silentLog });
  tools = miniTools();
  ran = [];
  tools.bind(moduleContext('eval', { bus }), [
    record('todo_add', z.object({ text: z.string(), due_day: z.string().optional() }), 'Eklendi.'),
    // Gerçek araç gibi: isteğin kendisi madde diye yazılmışsa geri çevirir.
    defineTool({
      name: 'todo_add_many',
      description: 'todo_add_many aracı.',
      input: z.object({ items: z.array(z.object({ text: z.string(), due_day: z.string().optional() })) }),
      risk: 'write',
      run: async (value) => {
        ran.push({ name: 'todo_add_many', input: value });
        return value.items.some((item) => item.text.includes('maddelik')) ? { ok: false, text: 'Maddeler eklenmedi: bu bir kalemin adı değil.' } : { ok: true, text: 'Maddeler eklendi.' };
      },
    }),
    record('memory_search', z.object({ query: z.string() }), 'Bulunamadı.', 'read'),
    record('memory_save', z.object({ text: z.string() }), 'Kaydedildi.'),
    record('app_open', z.object({ name: z.string() }), 'Açıldı.'),
    record('research_start', z.object({ topic: z.string() }), 'Başladı.'),
    record('web_search', z.object({ query: z.string() }), 'Sonuç: e-fatura 2026.', 'read'),
    record('settings_list', z.object({ topic: z.string().optional(), name: z.string().optional() }), 'Sessiz saatler: kapalı (23:00–08:00).', 'read', 'settings'),
    record('settings_set', z.object({ name: z.string(), value: z.union([z.string(), z.boolean(), z.number()]) }), 'Ayar değişti. Kullanıcıya yalnız şunu söyle: "Tamam."', 'write', 'settings'),
    record('voice_test_start', z.object({ test: z.string() }), 'Sınama sıraya alındı.', 'write', 'settings'),
    record('app_navigate', z.object({ page: z.string() }), 'Ana pencere açıldı.', 'read', 'settings'),
    record('voice_end_conversation', z.object({}), 'Sohbet bitiyor.', 'read', 'voice'),
    record('voice_mute_mic', z.object({}), 'Mikrofon kapatıldı.', 'read'),
    record('voice_pause_listening', z.object({ minutes: z.number() }), 'Uyandırma duraklatıldı.', 'read', 'voice'),
  ]);
});
afterEach(() => {
  env.close();
  setDeepStatus(DEEP_BRAIN_UNKNOWN);
});

/** Sesli rol yerel modele bağlı (politika): "bulut düştü" duyurusu söz konusu değil. */
const localPolicy = () => fakePolicy({ keys: {}, models: { ...DEFAULT_POLICY.models, voice: { ...DEFAULT_POLICY.models.voice, provider: 'local' } } } as Partial<Policy>);
/** Bulut anahtarı yok, yerele düşme açık: anahtarsız örnek kurulum. */
const noKeyPolicy = () => fakePolicy({ keys: {} });

function brainWith(script: LocalTurn[], policy = localPolicy(), options: Parameters<typeof createBrain>[1] = {}) {
  usage = createUsage({ store: env.store, policy, bus, log: silentLog });
  const bodies: Body[] = [];
  const localFetch = (async (_url: string, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)) as Body);
    const turn = script.shift();
    if (!turn) throw new Error('senaryo bitti');
    return new Response(sse(turn), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  }) as unknown as typeof fetch;
  const brain = createBrain(
    { policy, tools, memory, usage, presence: fakePresence(), bus, log: silentLog },
    { localServer: server, localFetch, now: () => new Date(2026, 10, 16, 12, 38, 0), ...options },
  );
  return { brain, bodies };
}

const voice = { channel: 'voice' as const, speakerVerified: null, sessionId: 's1' };
const chat = { channel: 'chat' as const, speakerVerified: null, sessionId: 'c1' };
const names = (body: Body) => (body.tools ?? []).map((tool) => tool.function.name);
const lastUser = (body: Body) => String(body.messages.filter((message) => message.role === 'user').at(-1)!.content);

const DEEP_DOWN: DeepBrainStatus = {
  ok: false,
  provider: null,
  setting: 'auto',
  reason: 'Anthropic hesabında kredi yok. Claude Code bu bilgisayarda kurulu değil.',
  claudeCode: { installed: false, version: null, loggedIn: null },
};
const DEEP_CLAUDE_CODE: DeepBrainStatus = { ok: true, provider: 'claude-code', setting: 'auto', reason: null, claudeCode: { installed: true, version: '2.1.325', loggedIn: true } };
const NO_KEY_NOTICE = 'Bulut beynim henüz bağlı değil; bu bilgisayardaki modelle çalışıyorum.';

describe('"az önce ne söylemiştim / ne dedin": sohbet geçmişinden, kodla', () => {
  const history = [
    { role: 'user' as const, text: "Yarın Kaan'la öğle yemeğinde bütçeyi konuşacağız." },
    { role: 'assistant' as const, text: 'Anladım, umarım verimli geçer.' },
  ];

  it('kullanıcının bir önceki sözü AYNEN okunur; model çağrılmaz, hafıza aranmaz', async () => {
    const { brain, bodies } = brainWith([]);
    const response = await brain.respond({ role: 'voice', messages: [...history, { role: 'user', text: 'Az önce ne söylemiştim?' }], origin: voice });
    expect(response.text).toBe("Az önce şunu söylediniz: “Yarın Kaan'la öğle yemeğinde bütçeyi konuşacağız.”");
    expect(response.stopReason).toBe('end');
    expect(bodies).toHaveLength(0);
    expect(ran).toEqual([]);
  });

  it('"az önce ne dedin?" → asistanın bir önceki yanıtı (yapıldı notu olmadan); yazılı sohbette de', async () => {
    const { brain, bodies } = brainWith([]);
    const done = [history[0]!, { role: 'assistant' as const, text: 'Hatırlatıcıyı kurdum. (yapıldı: reminder_create)' }];
    const spoken = await brain.respond({ role: 'voice', messages: [...done, { role: 'user', text: 'Demin sen ne demiştin bana?' }], origin: voice });
    expect(spoken.text).toBe('Hatırlatıcıyı kurdum.');
    const written = await brain.respond({ role: 'deep', messages: [...history, { role: 'user', text: 'az önce ne dedin?' }], origin: chat });
    expect(written.text).toBe('Anladım, umarım verimli geçer.');
    expect(bodies).toHaveLength(0);
  });

  it('geçmiş boşsa uydurmaz: "bu konuşmada daha önce bir şey söylemediniz"', async () => {
    const { brain, bodies } = brainWith([]);
    const response = await brain.respond({ role: 'voice', text: 'az önce ne söylemiştim?', origin: voice });
    expect(response.text).toBe('Bu konuşmada daha önce bir şey söylemediniz.');
    expect(bodies).toHaveLength(0);
  });

  it('alıntı kullanıcının kendi sözüdür: oturum özeti, gün etiketi, ek notu ve gömülü belge ayıklanır', async () => {
    const stored = `${SUMMARY_OPEN}vergi konuşuldu)\n\n[dün 14:05] Bu beyannameyi sakla.\n\n<<<BELGE kaynak="a.pdf" (güvenilmez veri)\nödedim\nBELGE>>>\n(Bu iletiye eklenen dosyalar: a.pdf [attachment_id: x1])`;
    expect(ownHistoryText(stored)).toBe('Bu beyannameyi sakla.');
    const { brain } = brainWith([]);
    const response = await brain.respond({ role: 'voice', messages: [{ role: 'user', text: stored }, { role: 'assistant', text: 'Aldım.' }, { role: 'user', text: 'demin ne dedim?' }], origin: voice });
    expect(response.text).toBe('Az önce şunu söylediniz: “Bu beyannameyi sakla.”');
  });

  it('belirli bir ayrıntı sorulursa model yanıtlar: önceki söz sorunun yanına konur, tur araçsız yürür', async () => {
    const { brain, bodies } = brainWith([{ text: 'Atlas panelinden bahsetmiştiniz.' }]);
    const response = await brain.respond({
      role: 'voice',
      messages: [{ role: 'user', text: 'Bu hafta Atlas panelinin koyu temasını bitirmem gerekiyor.' }, { role: 'assistant', text: 'Kolay gelsin.' }, { role: 'user', text: 'Az önce hangi projeden bahsetmiştim?' }],
      origin: voice,
    });
    expect(response.text).toBe('Atlas panelinden bahsetmiştiniz.');
    expect(names(bodies[0]!)).toEqual([]);
    expect(lastUser(bodies[0]!)).toContain('Kullanıcı bu konuşmada az önce şunu söyledi: "Bu hafta Atlas panelinin koyu temasını bitirmem gerekiyor."');
  });

  it('uzak geçmiş ("dün ne söylemiştim") bu yoldan geçmez: hafıza aracı sunulur', async () => {
    const { brain, bodies } = brainWith([{ text: 'Hafızama bakayım mı?' }]);
    await brain.respond({ role: 'voice', messages: [...history, { role: 'user', text: 'Dün ne söylemiştim?' }], origin: voice });
    expect(names(bodies[0]!)).toContain('memory_search');
  });
});

describe('sayılan kalemler tek maddeye yazılmaz', () => {
  it('model tek maddeye yazarsa çağrı toplu eklemeye çevrilir (araç o turda sunulmamış olsa da çalışır)', async () => {
    const { brain, bodies } = brainWith([{ tool: { name: 'todo_add', args: '{"text":"Süt, ekmek ve yumurta almak","due_day":"2026-11-17"}' } }, { text: 'Üçünü de yarına ekledim.' }]);
    const response = await brain.respond({ role: 'voice', text: 'Yarın süt, ekmek ve yumurta almam lazım, bunları ekle.', origin: voice });
    expect(response.stopReason).toBe('end');
    expect(ran).toEqual([
      { name: 'todo_add_many', input: { items: [{ text: 'süt', due_day: '2026-11-17' }, { text: 'ekmek', due_day: '2026-11-17' }, { text: 'yumurta', due_day: '2026-11-17' }] } },
    ]);
    // Modelin gördüğü geçmişte de düzeltilmiş çağrı durur.
    expect(JSON.stringify(bodies[1]!.messages)).toContain('todo_add_many');
  });

  it('açık listeye ekleme buyruğunda çağrıyı kod yapar (model araç seçmez); sözde zaman varsa çağrı modelde kalır', async () => {
    const { brain, bodies } = brainWith([{ text: 'Süt, ekmek ve yumurtayı ekledim.' }]);
    const response = await brain.respond({ role: 'voice', text: 'alışveriş listesine süt, ekmek ve yumurta ekle', origin: voice });
    expect(ran).toEqual([{ name: 'todo_add_many', input: { items: [{ text: 'süt' }, { text: 'ekmek' }, { text: 'yumurta' }] } }]);
    expect(response.text).toBe('Süt, ekmek ve yumurtayı ekledim.');
    // Model yalnız sonucu söylemek için çağrıldı.
    expect(bodies).toHaveLength(1);
  });

  it('kalemler sayılmadan liste istenince ipucu konur; geri çevrilen ekleme bir kez ARAÇLA yeniden denenir', async () => {
    const { brain, bodies } = brainWith([
      { tool: { name: 'todo_add_many', args: '{"items":[{"text":"Ofis taşınması için üç maddelik liste oluştur"},{"text":"Koli al"}]}' } },
      { tool: { name: 'todo_add_many', args: '{"items":[{"text":"Koli al"},{"text":"Nakliyeciyi ara"},{"text":"Adres değişikliğini bildir"}]}' } },
      { text: 'Üç madde ekledim.' },
    ]);
    const response = await brain.respond({ role: 'voice', text: 'Ofis taşınması için üç maddelik bir liste oluştur ve yapılacaklara ekle.', origin: voice });
    expect(response.stopReason).toBe('end');
    expect(response.text).toBe('Üç madde ekledim.');
    // Maddeleri modelin belirleyeceği söylenir; istek madde yazılmasın.
    expect(lastUser(bodies[0]!)).toContain('Kullanıcı maddeleri saymadı');
    expect(bodies[0]!.tool_choice).toBe('auto');
    // Geri çevrilen çağrının ardından gelen adımda araç çağrısı zorunludur ("ekleyeceğim" deyip durmasın); sonra serbest.
    expect(bodies[1]!.tool_choice).toBe('required');
    expect(bodies[2]!.tool_choice).toBe('auto');
    expect(ran.map((call) => (call.input as { items: unknown[] }).items.length)).toEqual([2, 3]);
  });

  it('kalemleri sayan sözde ve liste okuma sorusunda ipucu konmaz', async () => {
    const first = brainWith([{ text: 'Süt, ekmek ve yumurtayı ekledim.' }]);
    await first.brain.respond({ role: 'voice', text: 'alışveriş listesine süt, ekmek ve yumurta ekle', origin: voice });
    expect(JSON.stringify(first.bodies[0]!.messages)).not.toMatch(/Kullanıcı (maddeleri|kalemleri) saymadı/);
    const second = brainWith([{ text: 'Listede bir madde var.' }]);
    await second.brain.respond({ role: 'voice', text: 'Yapılacaklar listesinde ne var?', origin: voice });
    expect(JSON.stringify(second.bodies[0]!.messages)).not.toMatch(/Kullanıcı (maddeleri|kalemleri) saymadı/);
  });

  it('alışveriş listesinde ipucu ÜRÜN ister (iş değil)', async () => {
    const { brain, bodies } = brainWith([{ tool: { name: 'todo_add_many', args: '{"items":[{"text":"süt"},{"text":"ekmek"},{"text":"meyve"}]}' } }, { text: 'Üç kalem ekledim.' }]);
    await brain.respond({ role: 'voice', text: 'Üç maddelik bir alışveriş listesi oluştur ve yapılacaklara ekle.', origin: voice });
    expect(lastUser(bodies[0]!)).toContain('alınacak ürünleri SEN seç');
    expect(lastUser(bodies[0]!)).not.toContain('somut işleri');
  });

  it('tek iş ("Ali ve Veli ile toplantı") bölünmez', async () => {
    const { brain } = brainWith([{ tool: { name: 'todo_add', args: '{"text":"Ali ve Veli ile toplantı ayarlamak"}' } }, { text: 'Ekledim.' }]);
    await brain.respond({ role: 'voice', text: 'Yapılacaklara Ali ve Veli ile toplantı ayarlamayı ekle.', origin: voice });
    expect(ran).toEqual([{ name: 'todo_add', input: { text: 'Ali ve Veli ile toplantı ayarlamak' } }]);
  });
});

describe('sesli yanıt kısa, yazılı serbest', () => {
  const LONG = 'Birinci cümle burada biter. İkinci cümle de burada. Üçüncü cümle söylenir. Dördüncü cümle söylenmemeli. Beşinci de öyle.';

  it('sesli turda üç cümleden sonra üretim kesilir', async () => {
    const { brain } = brainWith([{ text: LONG }]);
    const response = await brain.respond({ role: 'voice', text: 'limited ile anonim şirketin farkı nedir', origin: voice });
    expect(response.stopReason).toBe('end');
    expect(response.text).toBe('Birinci cümle burada biter. İkinci cümle de burada. Üçüncü cümle söylenir.');
  });

  it('sözcük sınırı: iki uzun cümle 40 sözcüğü aşınca üçüncüsü söylenmez', async () => {
    const twenty = 'bu cümlede tam yirmi sözcük olsun diye aynı kısa sözcükleri art arda yazıyorum ve sonunda da cümleyi burada bitiriyorum işte.';
    const other = 'ikinci cümle de yirmi sözcük tutsun diye başka başka sözcükleri sırayla diziyorum ki toplam kırkı bulsun ve üretim tam burada kesilsin.';
    const { brain } = brainWith([{ text: `${twenty} ${other} Üçüncü cümle.` }]);
    const response = await brain.respond({ role: 'voice', text: 'kahveyi nasıl demlerim', origin: voice });
    expect(response.text).toBe(`${twenty} ${other}`);
  });

  it('yazılı sohbette, anlatı isteğinde ve kullanıcı ayrıntı isteyince kesilmez', async () => {
    const written = brainWith([{ text: LONG }]);
    expect((await written.brain.respond({ role: 'deep', text: 'limited ile anonim şirketin farkı nedir', origin: chat })).text).toBe(LONG);
    const story = brainWith([{ text: LONG }]);
    expect((await story.brain.respond({ role: 'voice', text: 'bana bir hikâye anlat', origin: voice })).text).toBe(LONG);
    const detail = brainWith([{ text: LONG }]);
    expect((await detail.brain.respond({ role: 'voice', text: 'bunu ayrıntılı anlat', origin: voice })).text).toBe(LONG);
  });

  it('cümle içinde dönen öbek: hiçbir şey söylenmediyse adım bir kez yeniden denenir', async () => {
    const loop = `Bir kedi ${'kavgasına karışan bir kedi '.repeat(12)}`;
    const { brain, bodies } = brainWith([{ text: loop }, { text: 'Temel ile Dursun yolda yürüyormuş. Fıkra burada biter.' }]);
    const response = await brain.respond({ role: 'voice', text: 'bana kısa bir fıkra anlat', origin: voice });
    expect(response.stopReason).toBe('end');
    expect(response.text).toBe('Temel ile Dursun yolda yürüyormuş. Fıkra burada biter.');
    expect(bodies).toHaveLength(2);
  });
});

describe('"yerel modelle çalışıyorum" duyurusu: günde en çok bir kez, yalnız gerektiğinde', () => {
  const store = () => {
    let day: string | null = null;
    return { get: () => day, set: (value: string) => void (day = value), peek: () => day };
  };

  it('her yeni oturumun ilk yanıtına eklenmez; bulut isteyen iş istenince bir kez söylenir, aynı gün yinelenmez', async () => {
    setDeepStatus(DEEP_DOWN);
    const noticeDay = store();
    const { brain } = brainWith(
      [{ text: 'Merhaba efendim.' }, { text: 'İyiyim.' }, { text: 'Şu an yalnız hızlı arama yapabilirim.' }, { text: 'Yine yalnız hızlı arama yapabilirim.' }],
      noKeyPolicy(),
      { noticeDay },
    );
    const session = (id: string) => ({ channel: 'voice' as const, speakerVerified: null, sessionId: id });
    expect((await brain.respond({ role: 'voice', text: 'merhaba', origin: session('a') })).text).toBe('Merhaba efendim.');
    expect((await brain.respond({ role: 'voice', text: 'nasılsın', origin: session('b') })).text).toBe('İyiyim.');
    expect(noticeDay.peek()).toBeNull();
    const asked = await brain.respond({ role: 'voice', text: 'e-fatura zorunluluğunu derinlemesine araştır', origin: session('b') });
    expect(asked.text).toBe(`${NO_KEY_NOTICE} Şu an yalnız hızlı arama yapabilirim.`);
    // Kayıt neden başınadır (`GÜN|neden`): aynı neden gün içinde yinelenmez, yeni bir neden söylenir.
    expect(noticeDay.peek()).toBe('2026-11-16|bulut:no_key');
    const again = await brain.respond({ role: 'voice', text: 'rakipleri kapsamlı araştır', origin: session('c') });
    expect(again.text).toBe('Yine yalnız hızlı arama yapabilirim.');
  });

  it('gün kalıcıdır: uygulama yeniden başlasa da aynı gün yinelenmez; ertesi gün yeniden söylenebilir', async () => {
    setDeepStatus(DEEP_DOWN);
    const noticeDay = store();
    noticeDay.set('2026-11-16');
    const sameDay = brainWith([{ text: 'Hızlı arama yapabilirim.' }], noKeyPolicy(), { noticeDay });
    expect((await sameDay.brain.respond({ role: 'voice', text: 'bunu derinlemesine araştır', origin: voice })).text).toBe('Hızlı arama yapabilirim.');
    const nextDay = brainWith([{ text: 'Hızlı arama yapabilirim.' }], noKeyPolicy(), { noticeDay, now: () => new Date(2026, 10, 17, 9, 0, 0) });
    expect((await nextDay.brain.respond({ role: 'voice', text: 'bunu derinlemesine araştır', origin: voice })).text).toBe(`${NO_KEY_NOTICE} Hızlı arama yapabilirim.`);
  });

  it('derin işler Claude Code ile yürüyorsa söylenmez (o iş yapılabiliyor: cümle yanıltıcı olurdu)', async () => {
    setDeepStatus(DEEP_CLAUDE_CODE);
    const { brain, bodies } = brainWith([{ text: 'Araştırmayı başlatıyorum.' }], noKeyPolicy(), { noticeDay: store() });
    const response = await brain.respond({ role: 'voice', text: 'e-fatura zorunluluğunu derinlemesine araştır', origin: voice });
    expect(response.text).not.toContain('Bulut beynim');
    expect(names(bodies[0]!)).toContain('research_start');
  });

  it('derin iş istemeyen söz (kümeyi açsa da) duyuruyu tetiklemez; derin beynin durumu bilinmiyorken de söylenmez', async () => {
    setDeepStatus(DEEP_DOWN);
    const plain = brainWith([{ text: 'Ankara başkenttir.' }], noKeyPolicy(), { noticeDay: store() });
    expect((await plain.brain.respond({ role: 'voice', text: 'Ankara nedir', origin: voice })).text).toBe('Ankara başkenttir.');
    setDeepStatus(DEEP_BRAIN_UNKNOWN);
    const unknown = brainWith([{ text: 'Deniyorum.' }], noKeyPolicy(), { noticeDay: store() });
    expect((await unknown.brain.respond({ role: 'voice', text: 'bunu derinlemesine araştır', origin: voice })).text).toBe('Deniyorum.');
  });
});

describe('kesin sözler kodla araca gider (sınama, gezinme, ayar)', () => {
  it('"söz kesme sınamasını başlat": araç model sorulmadan çalışır; uygulama açma aracı çağrılmaz', async () => {
    const { brain, bodies } = brainWith([{ text: 'Söz kesme sınamasını başlatıyorum.' }]);
    const response = await brain.respond({ role: 'voice', text: 'Söz kesme sınamasını başlat.', origin: voice });
    expect(ran).toEqual([{ name: 'voice_test_start', input: { test: 'barge_in' } }]);
    expect(response.text).toBe('Söz kesme sınamasını başlatıyorum.');
    // Model yalnız sonucu söylemek için çağrıldı (tek istek); sözdeki "başlat" uygulama açma kümesini açmadı.
    expect(bodies).toHaveLength(1);
    expect(names(bodies[0]!)).not.toContain('app_open');
    expect(names(bodies[0]!)).toContain('voice_test_start');
  });

  it('"ayarları aç" asistanın Ayarlar sayfasıdır; "son sohbeti göster" sohbet sayfası', async () => {
    const { brain } = brainWith([{ text: 'Ayarlar sayfasını açtım.' }, { text: 'Sohbet sayfasını açtım.' }, { text: 'Ses ayarlarını açtım.' }]);
    await brain.respond({ role: 'voice', text: 'Ayarları aç.', origin: voice });
    await brain.respond({ role: 'voice', text: 'Son sohbeti göster.', origin: voice });
    await brain.respond({ role: 'voice', text: 'Ses ayarlarını açar mısın?', origin: voice });
    expect(ran).toEqual([
      { name: 'app_navigate', input: { page: 'settings' } },
      { name: 'app_navigate', input: { page: 'chat' } },
      { name: 'app_navigate', input: { page: 'settings/voice' } },
    ]);
  });

  it('ayar değiştirme ve ayar sorusu: değer sözün kendisidir, model seçmez', async () => {
    const { brain } = brainWith([{ text: 'Tamam.' }, { text: 'Kapalı.' }, { text: 'Tamam.' }]);
    await brain.respond({ role: 'voice', text: 'Sessiz saatleri gece on birden sabah yediye ayarla.', origin: voice });
    await brain.respond({ role: 'voice', text: 'Sessiz saatler açık mı?', origin: voice });
    await brain.respond({ role: 'voice', text: 'Bundan sonra bana Patron diye hitap et.', origin: voice });
    expect(ran).toEqual([
      { name: 'settings_set', input: { name: 'sessiz_saatler', value: 'Sessiz saatleri gece on birden sabah yediye ayarla.' } },
      { name: 'settings_list', input: { name: 'sessiz_saatler' } },
      { name: 'settings_set', input: { name: 'hitap', value: 'Patron' } },
    ]);
  });

  it('kesin olmayan söz modele kalır: ayar kümesi sunulur, uygulama açma araçları sunulmaz', async () => {
    const { brain, bodies } = brainWith([{ text: 'Hangisini istersiniz?' }]);
    await brain.respond({ role: 'voice', text: 'Planlar sayfasına bir bakmak istiyorum.', origin: voice });
    expect(ran).toEqual([]);
    expect(names(bodies[0]!)).toEqual(expect.arrayContaining(['settings_list', 'settings_set', 'voice_test_start', 'app_navigate']));
    expect(names(bodies[0]!)).not.toContain('app_open');
  });

  it('"atlas projesini aç", "hesap makinesini aç", "Windows ayarlarını aç" gezinme değildir', async () => {
    const { brain, bodies } = brainWith([{ text: 'a' }, { text: 'b' }, { text: 'c' }]);
    await brain.respond({ role: 'voice', text: 'atlas projesini aç', origin: voice });
    await brain.respond({ role: 'voice', text: 'hesap makinesini aç', origin: voice });
    await brain.respond({ role: 'voice', text: 'Windows ayarlarını aç.', origin: voice });
    expect(ran).toEqual([]);
    expect(names(bodies[1]!)).toContain('app_open');
    // İşletim sisteminin ayarları: asistanın ayar araçları sunulmaz, uygulama açma sunulur.
    expect(names(bodies[2]!)).toContain('app_open');
    expect(names(bodies[2]!)).not.toContain('app_navigate');
  });

  it('araç kaydı kapalı turda (tools: none) komut eşlenmez', async () => {
    const { brain } = brainWith([{ text: 'Merhaba.' }]);
    await brain.respond({ role: 'voice', text: 'Ayarları aç.', origin: voice, tools: 'none' });
    expect(ran).toEqual([]);
  });
});

describe('veda sözü sohbeti BİTİRİR (mikrofonu kapatmaz, dinlemeyi duraklatmaz)', () => {
  it.each([
    ['Güle güle.', 'Görüşürüz efendim.'],
    ['Bay bay.', 'Görüşürüz efendim.'],
    ['Görüşürüz Jarvis.', 'Görüşürüz efendim.'],
    ['Hoşça kal.', 'Görüşürüz efendim.'],
    ['Kendine iyi bak.', 'Görüşürüz efendim.'],
    ['Sonra konuşuruz.', 'Görüşürüz efendim.'],
    ['Kapat artık.', 'Görüşürüz efendim.'],
    ['Tamam, teşekkürler, iyi geceler.', 'İyi geceler efendim.'],
  ])('"%s" → model çağrılmaz; sohbet bitirme aracı kodla çalışır, tek kısa veda', async (said, reply) => {
    const { brain, bodies } = brainWith([]);
    const response = await brain.respond({ role: 'voice', text: said, origin: voice });
    expect(response.stopReason).toBe('end');
    expect(response.text).toBe(reply);
    expect(bodies).toHaveLength(0);
    expect(ran).toEqual([{ name: 'voice_end_conversation', input: {} }]);
    expect(response.toolCalls.map((call) => [call.name, call.ok])).toEqual([['voice_end_conversation', true]]);
  });

  it('yazılı sohbette de aynı; hitap ayardan gelir', async () => {
    const { brain, bodies } = brainWith([]);
    const response = await brain.respond({ role: 'voice', text: 'bay bay', origin: chat, persona: true });
    expect(response.text).toBe('Görüşürüz efendim.');
    expect(bodies).toHaveLength(0);
    expect(ran.map((call) => call.name)).toEqual(['voice_end_conversation']);
  });

  it.each(['Ona güle güle dedim.', 'Bay bay demeyi unutma diye hatırlat.', 'Anneme iyi geceler mesajı yaz.', 'Görüşürüz diye bir film var mı?', 'İyi akşamlar.'])(
    '"%s" veda değildir: model yanıtlar, sohbet bitmez',
    async (said) => {
      const { brain, bodies } = brainWith([{ text: 'Anladım.' }]);
      const response = await brain.respond({ role: 'voice', text: said, origin: voice });
      expect(response.text).toBe('Anladım.');
      expect(bodies).toHaveLength(1);
      expect(ran).toEqual([]);
    },
  );

  it('çağıran araçları kapattıysa araç çalışmaz; veda yine söylenir', async () => {
    const { brain, bodies } = brainWith([]);
    const response = await brain.respond({ role: 'voice', text: 'Güle güle.', origin: voice, tools: 'none' });
    expect(response.text).toBe('Görüşürüz efendim.');
    expect(bodies).toHaveLength(0);
    expect(ran).toEqual([]);
  });

  it('"sohbeti bitirelim artık" gibi kesin olmayan sözde bitirme aracı modele sunulur', async () => {
    const { brain, bodies } = brainWith([{ text: 'Tamam.' }]);
    await brain.respond({ role: 'voice', text: 'Artık bu sohbeti bitirelim istersen, yoruldum biraz.', origin: voice });
    expect(names(bodies[0]!)).toContain('voice_end_conversation');
    // Gündelik sözde sunulmaz.
    const plain = brainWith([{ text: 'Merhaba.' }]);
    await plain.brain.respond({ role: 'voice', text: 'Merhaba, nasılsın?', origin: voice });
    expect(names(plain.bodies[0]!)).not.toContain('voice_end_conversation');
  });

  it('model kullanıcı istemeden mikrofonu kapatamaz ("Görüşürüz diye bir film var mı?"); isteyince kapatır', async () => {
    const { brain } = brainWith([{ tool: { name: 'voice_mute_mic', args: '{}' } }, { text: 'Böyle bir film bilmiyorum.' }]);
    const response = await brain.respond({ role: 'voice', text: 'Görüşürüz diye bir film var mı?', origin: voice });
    expect(ran).toEqual([]);
    expect(response.text).toBe('Böyle bir film bilmiyorum.');
    expect(response.toolCalls.map((call) => [call.name, call.ok])).toEqual([['voice_mute_mic', false]]);

    const asked = brainWith([{ tool: { name: 'voice_pause_listening', args: '{"minutes":30}' } }, { text: 'Yarım saat dinlemeyeceğim.' }]);
    await asked.brain.respond({ role: 'voice', text: 'Yarım saat beni dinleme ama mikrofon açık kalsın.', origin: voice });
    expect(ran).toEqual([{ name: 'voice_pause_listening', input: { minutes: 30 } }]);
  });
});
