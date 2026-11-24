// demo.2: örnek bir kurulumda (yerel Qwen3.5-4B) görülen beyin kusurlarının birim testleri.
// Sahte llama-server ile: modelin ne dediği senaryodan gelir, sınanan beynin o söze ne yaptığıdır.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEEP_BRAIN_UNKNOWN, DEFAULT_POLICY, defineTool, type Bus, type DeepBrainStatus, type MemoryApi, type Policy, type UsageApi } from '@fuber/shared';
import { z } from 'zod';
import { applyResolvedTime, createBrain, estimateTokens, trimToContext } from './brain';
import { setDeepStatus } from './brain/deep/status';
import type { LlmServer } from './brain/llm-server';
import { SUMMARY_OPEN } from './brain/prompt';
import type { SelfSource } from './brain/self';
import { apiError, fakePolicy, fakePresence, miniTools, moduleContext, silentLog, tempStore, testBus } from './brain/testkit';
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
  tools?: Array<{ function: { name: string; description: string; parameters: Record<string, unknown> } }>;
  tool_choice?: string;
  max_tokens: number;
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

const record = (name: string, input: z.ZodType, text: string, risk: 'read' | 'write' = 'write') =>
  defineTool({
    name,
    description: `${name} aracı. İkinci cümle modele gitmemeli.`,
    input,
    risk,
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
    record('reminder_create', z.object({ text: z.string(), due_at: z.string().optional(), after_seconds: z.number().optional(), recurrence: z.object({ freq: z.string() }).optional() }), 'Hatırlatıcı kuruldu.'),
    record('voice_mute_mic', z.object({ minutes: z.number().optional() }), 'Mikrofon kapatıldı. Ctrl+Alt+K ile açabilir.', 'read'),
    record('voice_set_quiet', z.object({ on: z.boolean() }), 'Sessiz kip açıldı.', 'read'),
    record('url_open', z.object({ url: z.string() }), 'Tarayıcıda açıldı.'),
    record('weather_get', z.object({ place: z.string() }), 'Ankara: 12 derece, parçalı bulutlu.', 'read'),
    record('web_search', z.object({ query: z.string() }), 'x'.repeat(5000), 'read'),
    record('web_read', z.object({ url: z.string() }), 'y'.repeat(5000), 'read'),
    record('self_status', z.object({}), 'Ekran kartı RTX 4080 SUPER.', 'read'),
    record('skill_build', z.object({ goal: z.string() }), 'başladı'),
    record('pc_click', z.object({ x: z.number().optional() }), 'DURDUM: fareyi kullanıcı kendisi kullanmaya başladı; kontrol onda.'),
    record('browser_search', z.object({ query: z.string() }), 'Tarayıcıda yeni sekmede arandı.'),
    // Kümesini tanımında bildiren araç: adı hiçbir listede ve önekte yok.
    { ...record('takvim_bak', z.object({}), 'Bugün boş.', 'read'), group: 'info' },
  ]);
});
afterEach(() => {
  env.close();
  // Derin beynin durumu süreç genelidir (köprü yazar); bir sınamanın senaryosu ötekine sızmasın.
  setDeepStatus(DEEP_BRAIN_UNKNOWN);
});

const localPolicy = (patch: Partial<Policy> = {}) =>
  fakePolicy({ keys: {}, models: { ...DEFAULT_POLICY.models, voice: { ...DEFAULT_POLICY.models.voice, provider: 'local' } }, ...patch } as Partial<Policy>);

function brainWith(script: LocalTurn[], policy = localPolicy()) {
  usage = createUsage({ store: env.store, policy, bus, log: silentLog });
  const bodies: Body[] = [];
  const localFetch = (async (_url: string, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)) as Body);
    const turn = script.shift();
    if (!turn) throw new Error('senaryo bitti');
    return new Response(sse(turn), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  }) as unknown as typeof fetch;
  const brain = createBrain({ policy, tools, memory, usage, presence: fakePresence(), bus, log: silentLog }, { localServer: server, localFetch, now: () => new Date(2026, 10, 16, 12, 38, 0) });
  return { brain, bodies };
}

const voice = { channel: 'voice' as const, speakerVerified: null, sessionId: 's1' };
const names = (body: Body) => (body.tools ?? []).map((tool) => tool.function.name);
const lastUser = (body: Body) => String(body.messages.filter((message) => message.role === 'user').at(-1)!.content);

// Derin beynin durumu beyin servisine `BrainStatus.deep` ile gelir (köprü yayınlar). Sınama senaryoyu kendisi kurar.
/** Örnek kurulumun durumu: API hesabında kredi yok, Claude Code da yok → derin iş yapılamıyor. */
const DEEP_DOWN: DeepBrainStatus = {
  ok: false,
  provider: null,
  setting: 'auto',
  reason: 'Anthropic hesabında kredi yok. Claude Code bu bilgisayarda kurulu değil.',
  claudeCode: { installed: false, version: null, loggedIn: null },
};
/** Köprü çalışıyor: derin işler bu bilgisayardaki Claude Code ile yürür (sesli tur yerel modeldeyken de). */
const DEEP_CLAUDE_CODE: DeepBrainStatus = { ok: true, provider: 'claude-code', setting: 'auto', reason: null, claudeCode: { installed: true, version: '2.1.325', loggedIn: true } };

const SAMPLE_VOICE: SelfSource = {
  voice: {
    ready: true,
    stt: { provider: 'whisper-local', gpu: true },
    tts: { provider: 'elevenlabs', active: 'elevenlabs', fallbackReason: null },
    micMuted: false,
    quiet: false,
    bargeIn: 'wake',
    wakePaused: false,
    conversation: false,
  },
  admin: 'approved',
  hotkeys: { talk: 'Ctrl+Alt+J', mute: 'Ctrl+Alt+K' },
};

describe('öz-durum: her turda istemde, çalışma anındaki gerçek durumdan', () => {
  it('yerel beyin: blok sistem istemindedir; ses kaynağı bağlanınca "SES BULUTTAN" yazar, bağlanmadan "bilinmiyor"', async () => {
    const { brain, bodies } = brainWith([{ text: 'Sesim ElevenLabs bulutundan geliyor.' }, { text: 'Sesim ElevenLabs bulutundan geliyor.' }]);
    await brain.respond({ role: 'voice', text: 'Ses modelin nereden geliyor?', origin: voice });
    const before = String(bodies[0]!.messages[0]!.content);
    expect(before).toContain('## ŞU ANKİ DURUMUN');
    expect(before).toContain('BU BİLGİSAYARDA, ekran kartında çalışan yerel model (qwen3.5-4b-q4km)');
    expect(before).toContain('Fuber Yönetim’de yerel model seçili');
    expect(before).toContain('Ses hattının durumu (yazıya çevirme, seslendirme, mikrofon): bilinmiyor.');

    // Derin beyin henüz yoklanmadı: "yok" denmez, "bilinmiyor" denir.
    expect(before).toContain('Derin işler (yetenek geliştirme, araştırma, ekrana bakma): durumu bilinmiyor.');

    brain.attachSelfState(() => SAMPLE_VOICE);
    setDeepStatus(DEEP_DOWN);
    await brain.respond({ role: 'voice', text: 'Ses modelin nereden geliyor?', origin: voice });
    const after = String(bodies[1]!.messages[0]!.content);
    expect(after).toContain('SESİN: ElevenLabs BULUTUNDAN geliyor');
    expect(after).toContain('Yazıya çevirme (kullanıcıyı duyma): bu bilgisayarda, ekran kartında (Whisper)');
    expect(after).toContain('Fuber Yönetim: bağlı.');
    // Atölye kayıtlı ama derin beyin yok: neye bağlı olduğuyla birlikte "yapamadıkların" arasında; nedeni de yazar.
    expect(after).toContain('Sende VAR ama şu an ÇALIŞMAYANLAR (derin beyin gerekir; şu an yok): yeni yetenek ya da özellik geliştirme (Atölye)');
    expect(after).toContain('Derin işler (yetenek geliştirme, araştırma, ekrana bakma): şu an YOK (Anthropic hesabında kredi yok. Claude Code bu bilgisayarda kurulu değil).');
    // Birleşik yanıt koddan gelir: "tamamen yerelde misin" sorusuna model olguları kendisi birleştirmek zorunda kalmaz.
    expect(after).toContain('Özet: TAMAMEN yerelde DEĞİLSİN. Bu bilgisayarda: beynin, yazıya çevirme. BULUTTA: sesin.');
    expect(after).toMatch(/Şu an yapabildiklerin: .*hatırlatıcı ve yapılacaklar/);
  });

  it('kaynak hata verirse tur bozulmaz; o kısım "bilinmiyor" kalır', async () => {
    const { brain, bodies } = brainWith([{ text: 'Merhaba.' }]);
    brain.attachSelfState(() => {
      throw new Error('ses servisi hazır değil');
    });
    const response = await brain.respond({ role: 'voice', text: 'merhaba', origin: voice });
    expect(response.stopReason).toBe('end');
    expect(String(bodies[0]!.messages[0]!.content)).toContain('bilinmiyor');
  });

  it('selfState: anahtar yokken yerel düşüş nedeni ve derin beynin neden olmadığı', () => {
    const { brain } = brainWith([], fakePolicy({ keys: {} } as Partial<Policy>));
    brain.attachSelfState(() => SAMPLE_VOICE);
    const state = brain.selfState();
    expect(state.brain).toMatchObject({ provider: 'local', reason: 'no_key', model: 'qwen3.5-4b-q4km' });
    expect(state.brain.deep.ok).toBe(false);
    expect(state.voice?.tts.active).toBe('elevenlabs');
    expect(state.capabilities.find((item) => item.label.startsWith('yeni yetenek'))).toMatchObject({ available: false });
  });

  it('örnek kurulum (anahtar var, hesapta kredi yok): beyin yerelde "kredi yok" nedeniyle; derin beyin ve Atölye şu an YOK', async () => {
    const policy = fakePolicy({ keys: { anthropic: 'sahte' } } as Partial<Policy>);
    usage = createUsage({ store: env.store, policy, bus, log: silentLog });
    const billing = () => apiError(400, 'Your credit balance is too low to access the Anthropic API.');
    const brain = createBrain(
      { policy, tools, memory, usage, presence: fakePresence(), bus, log: silentLog },
      {
        localServer: server,
        clientFactory: () =>
          ({
            stream() {
              throw billing();
            },
            async create() {
              throw billing();
            },
          }) as never,
      },
    );
    // Önce bulut "çalışıyor" sanılır; açılıştaki ısıtma kredinin olmadığını görür.
    expect(brain.selfState().brain.provider).toBe('cloud');
    await brain.prewarm('voice');
    const state = brain.selfState();
    expect(state.brain).toMatchObject({ provider: 'local', reason: 'cloud_down', cause: 'billing' });
    // Derin beynin durumu köprüden gelir: yoklanana dek "bilinmiyor", yoklanınca nedeniyle "yok".
    expect(state.brain.deep).toMatchObject({ ok: false, known: false });
    expect(state.capabilities.find((item) => item.label.startsWith('yeni yetenek'))).toMatchObject({ available: false, needs: 'derin beynin durumu henüz bilinmiyor' });
    setDeepStatus(DEEP_DOWN);
    const probed = brain.selfState();
    expect(probed.brain.deep).toMatchObject({ ok: false, known: true, provider: null, reason: DEEP_DOWN.reason });
    expect(probed.capabilities.find((item) => item.label.startsWith('yeni yetenek'))).toMatchObject({ available: false, needs: 'derin beyin gerekir; şu an yok' });
  });

  it('derin beyin Claude Code ile çalışırken (sesli tur yerelde): "Derin işler ÇALIŞIYOR" yazar; Atölye çalışanlar arasındadır ve skill_build sunulur', async () => {
    const { brain, bodies } = brainWith([{ text: 'Evet, ekleyebilirim.' }, { text: 'Evet.' }]);
    brain.attachSelfState(() => SAMPLE_VOICE);
    setDeepStatus(DEEP_CLAUDE_CODE);
    await brain.respond({ role: 'voice', text: 'Sana bir özellik ekle desem, kendi kendine ekleyebiliyor musun?', origin: voice });
    const block = String(bodies[0]!.messages[0]!.content);
    expect(block).toContain('BU BİLGİSAYARDA, ekran kartında çalışan yerel model');
    expect(block).toContain('Derin işler (yetenek geliştirme, araştırma, ekrana bakma): ÇALIŞIYOR; bu bilgisayardaki Claude Code ile yürür.');
    expect(block).toMatch(/Şu an yapabildiklerin: .*yeni yetenek ya da özellik geliştirme \(Atölye\)/);
    expect(block).not.toContain('ÇALIŞMAYANLAR');
    expect(lastUser(bodies[0]!)).toContain('Kendine yeni yetenek ya da özellik geliştirebilirsin (bu bilgisayardaki Claude Code ile) (Atölye)');
    expect(names(bodies[0]!)).toContain('skill_build');
    expect(brain.selfState().capabilities.find((item) => item.label.startsWith('yeni yetenek'))).toMatchObject({ available: true, needs: null });

    // Derin beyin düşünce aynı sözde araç sunulmaz (yalnız hata döndürürdü); neden öz-durumda yazar.
    setDeepStatus(DEEP_DOWN);
    await brain.respond({ role: 'voice', text: 'Kendine yeni bir yetenek ekle', origin: voice });
    expect(names(bodies[1]!)).not.toContain('skill_build');
    expect(String(bodies[1]!.messages[0]!.content)).toContain('şu an YOK (Anthropic hesabında kredi yok');
  });
});

describe('bağlam bütçesi (yerel)', () => {
  it('sistem istemi turdan tura bayt bayt aynıdır; saat son kullanıcı iletisindedir', async () => {
    const { brain, bodies } = brainWith([{ text: 'İyiyim.' }, { text: 'Ankara başkenttir.' }]);
    await brain.respond({ role: 'voice', text: 'saat kaç', origin: voice });
    await brain.respond({ role: 'voice', text: 'Ankara hakkında bilgi ver', origin: voice });
    expect(bodies[0]!.messages[0]!.content).toBe(bodies[1]!.messages[0]!.content);
    expect(String(bodies[0]!.messages[0]!.content)).not.toMatch(/Şimdi:|2026-11-16T/);
    expect(lastUser(bodies[0]!)).toMatch(/^<baglam>\nŞimdi: 16 Kasım Pazartesi 2026, saat 12:38 \(ISO 2026-11-16T12:38:00[+-]\d\d:\d\d\)\.\n<\/baglam>\nsaat kaç$/);
    // Zamanla ilgisi olmayan sözde saat bağlama hiç girmez: model okuyamaz.
    expect(lastUser(bodies[1]!)).toBe('Ankara hakkında bilgi ver');
  });

  it('araçlar tura göre seçilir ve kısaltılır: gündelik sözde yalnız çekirdek; hava sorusunda bilgi araçları var, url_open YOK', async () => {
    const { brain, bodies } = brainWith([{ text: 'İyiyim.' }, { tool: { name: 'weather_get', args: '{"place":"Ankara"}' } }, { text: 'Ankara on iki derece.' }]);
    await brain.respond({ role: 'voice', text: 'nasılsın', origin: voice });
    expect(names(bodies[0]!)).toEqual(['reminder_create', 'voice_mute_mic', 'voice_set_quiet', 'self_status']);
    // Kısaltılmış tanım: bilinmeyen araçta yalnız ilk cümle.
    expect(bodies[0]!.tools!.find((tool) => tool.function.name === 'self_status')!.function.description).not.toContain('İkinci cümle');

    const response = await brain.respond({ role: 'voice', text: "Ankara'nın hava durumunu bana bir söyler misin?", origin: voice });
    expect(names(bodies[1]!)).toEqual(expect.arrayContaining(['weather_get', 'web_search']));
    expect(names(bodies[1]!)).not.toContain('url_open');
    expect(names(bodies[1]!)).not.toContain('skill_build');
    expect(response.toolCalls.map((call) => call.name)).toEqual(['weather_get']);
  });

  it('bu turda sunulmayan araç çağrılamaz (model bilgi sorusunda sayfa açmaya kalkarsa)', async () => {
    const { brain } = brainWith([{ tool: { name: 'url_open', args: '{"url":"https://www.google.com/search?q=Ankara+hava"}' } }, { text: 'Bunu şu an açamıyorum.' }]);
    const response = await brain.respond({ role: 'voice', text: 'Ankara kaç derece?', origin: voice });
    expect(ran).toEqual([]);
    expect(response.toolCalls[0]).toMatchObject({ name: 'url_open', ok: false });
  });

  it('araç sonucu yerelde sınırlanır; aynı turun eski sonuçları önizlemeye iner', async () => {
    const { brain, bodies } = brainWith([
      { tool: { name: 'web_search', args: '{"query":"KDV oranı"}' } },
      { tool: { name: 'web_read', args: '{"url":"https://ornek.com"}' } },
      { text: 'Yüzde yirmi.' },
    ]);
    await brain.respond({ role: 'voice', text: "internette araştır: KDV oranı nedir", origin: voice });
    const toolContents = (body: Body) => body.messages.filter((message) => message.role === 'tool').map((message) => String(message.content));
    expect(toolContents(bodies[1]!)[0]!.length).toBeLessThan(2500);
    expect(toolContents(bodies[1]!)[0]).toContain('sonuç kısaltıldı: 2400 / 5000 karakter');
    // Üçüncü istekte ilk sonuç önizlemedir, yenisi tamdır.
    expect(toolContents(bodies[2]!)[0]!.length).toBeLessThan(450);
    expect(toolContents(bodies[2]!)[1]!.length).toBeGreaterThan(2000);
  });

  it('geçmiş kırpılırken oturum özeti korunur; toplu kırpma hedefe iner', () => {
    const turn = (index: number) => [
      { role: 'user' as const, text: `${index}. soru ${'x'.repeat(200)}` },
      { role: 'assistant' as const, text: `${index}. yanıt ${'y'.repeat(200)}`, toolCalls: [] },
    ];
    const summary = `${SUMMARY_OPEN}KDV konuşuldu.)`;
    const history = Array.from({ length: 12 }, (_, index) => turn(index)).flat();
    history[0] = { role: 'user', text: `${summary}\n\n${history[0]!.text}` };
    const messages = [...history, { role: 'user' as const, text: 'son soru' }];
    const size = (list: Array<{ role: string; text?: string }>) => list.reduce((sum, message) => sum + estimateTokens(message.text ?? ''), 0);
    expect(trimToContext(messages, 10_000)).toEqual(messages);
    const trimmed = trimToContext(messages, 1100, 700);
    expect(size(trimmed)).toBeLessThanOrEqual(700 + 90);
    expect(trimmed[0]!.role).toBe('user');
    expect((trimmed[0] as { text: string }).text.startsWith(summary)).toBe(true);
    expect(trimmed.at(-1)).toEqual({ role: 'user', text: 'son soru' });
  });
});

describe('davranış düzeltmeleri (yerel)', () => {
  const REMINDER_HISTORY = [
    { role: 'user' as const, text: 'Kargoyu soracağım, bunu bana hatırlat bugün akşam sekiz gibi' },
    { role: 'assistant' as const, text: "Efendim, kargoyu sormanız için hatırlatıcıyı bugün akşam 20:00'ye kurdum." },
  ];

  it('"bir daha konuşur musun" (sesli): son yanıt AYNEN yeniden söylenir; model çağrılmaz, araç çalışmaz', async () => {
    const { brain, bodies } = brainWith([]);
    const heard: string[] = [];
    const response = await brain.respond({
      role: 'voice',
      messages: [
        REMINDER_HISTORY[0]!,
        { role: 'assistant', text: `${REMINDER_HISTORY[1]!.text} (yapıldı: reminder_create)` },
        { role: 'user', text: 'Az önce tam anlamadım sesini, bir daha konuşur musun?' },
      ],
      origin: voice,
      onSentence: (sentence) => heard.push(sentence),
    });
    expect(bodies).toHaveLength(0);
    expect(response).toMatchObject({ stopReason: 'end', error: null, text: REMINDER_HISTORY[1]!.text });
    expect(heard).toEqual([REMINDER_HISTORY[1]!.text]);
    expect(ran).toEqual([]);
  });

  it('"bir daha söyler misin" (yazılı): tur araçsız yürür, model son yanıtını yeniden yazar; eylem cümlesi kapıya takılmaz', async () => {
    const { brain, bodies } = brainWith([{ text: 'Kargoyu sormanız için hatırlatıcıyı bugün akşam sekize kurdum.' }], fakePolicy({ keys: {} } as Partial<Policy>));
    const response = await brain.respond({
      role: 'deep',
      messages: [...REMINDER_HISTORY, { role: 'user', text: 'Anlamadım, bir daha söyler misin?' }],
      origin: { channel: 'chat', speakerVerified: null, sessionId: 's2' },
    });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.tools).toBeUndefined();
    expect(lastUser(bodies[0]!)).toContain('kullanıcı son yanıtını duyamadı ya da anlamadı');
    expect(response.stopReason).toBe('end');
    expect(response.text).toContain('hatırlatıcıyı bugün akşam sekize kurdum');
    expect(ran).toEqual([]);
  });

  it('az önce yapılmış iş, kullanıcı yeniden istemeden bir daha yapılmaz (yankı sözü); isterse yapılır', async () => {
    const history = [REMINDER_HISTORY[0]!, { role: 'assistant' as const, text: `${REMINDER_HISTORY[1]!.text} (yapıldı: reminder_create)` }];
    const again = '{"text":"Kargoyu sor","due_at":"2026-11-16T20:00:00+03:00"}';
    const { brain, bodies } = brainWith([
      { tool: { name: 'reminder_create', args: again } },
      { text: 'Rica ederim.' },
      { tool: { name: 'reminder_create', args: '{"text":"Toplantı","due_at":"2026-11-17T10:00:00+03:00"}' } },
      { text: 'Yarın ona da kurdum.' },
    ]);
    const echo = await brain.respond({ role: 'voice', messages: [...history, { role: 'user', text: 'Bunun işinize yarar.' }], origin: voice });
    expect(ran).toEqual([]);
    expect(echo.toolCalls).toEqual([expect.objectContaining({ name: 'reminder_create', ok: false })]);
    expect(String(bodies[1]!.messages.at(-1)!.content)).toContain('Bu iş az önce yapıldı');
    expect(echo.text).toBe('Rica ederim.');

    await brain.respond({ role: 'voice', messages: [...history, { role: 'user', text: 'Bir de yarın saat onda toplantıyı hatırlat.' }], origin: voice });
    expect(ran.map((call) => call.name)).toEqual(['reminder_create']);
  });

  it('engellenen yeniden yapma hataya düşmez: model "kurdum" dese de (iş az önce gerçekten yapılmıştı) yanıt iletilir, araç sunulmaz', async () => {
    const history = [REMINDER_HISTORY[0]!, { role: 'assistant' as const, text: `${REMINDER_HISTORY[1]!.text} (yapıldı: reminder_create)` }];
    const { brain, bodies } = brainWith([{ tool: { name: 'reminder_create', args: '{"text":"Kargo","due_at":"2026-11-16T20:00:00+03:00"}' } }, { text: 'Hatırlatıcıyı akşam sekize kurdum.' }]);
    const response = await brain.respond({ role: 'voice', messages: [...history, { role: 'user', text: 'Bunun işinize yarar.' }], origin: voice });
    expect(response).toMatchObject({ stopReason: 'end', error: null, text: 'Hatırlatıcıyı akşam sekize kurdum.' });
    expect(bodies[1]!.tools).toBeUndefined();
    expect(ran).toEqual([]);
  });

  it('araç başarısız olup model iki kez "yaptım" derse kullanıcı aracın söylediği nedeni duyar', async () => {
    tools.bind(moduleContext('eval', { bus }), [
      defineTool({ name: 'reminder_create', description: 'x', input: z.object({ text: z.string() }), risk: 'write', run: async () => ({ ok: false, text: 'Veritabanı kilitli; hatırlatıcı kaydedilemedi.' }) }),
    ]);
    const { brain } = brainWith([{ tool: { name: 'reminder_create', args: '{"text":"Toplantı"}' } }, { text: 'Hatırlatıcıyı kurdum.' }, { text: 'Kurdum efendim.' }]);
    const response = await brain.respond({ role: 'voice', text: 'yarın sabah dokuzda toplantıyı hatırlat', origin: voice });
    expect(response).toMatchObject({ stopReason: 'end', error: null, text: 'Bunu yapamadım: Veritabanı kilitli; hatırlatıcı kaydedilemedi.' });
  });

  it('fıkra ve özet isteğinde eylem fiili içeriktir: iddia kapısı çalışmaz, yanıt hatasız iletilir (kısa devam sözünde de)', async () => {
    const joke = 'Adam eve gelmiş, "Kapıyı açtım" demiş. Karısı da "Ben de kapattım" demiş.';
    const first = brainWith([{ text: joke }]);
    const response = await first.brain.respond({ role: 'voice', text: 'Bir fıkra anlat, kısa olsun.', origin: voice });
    expect(response).toMatchObject({ stopReason: 'end', error: null, text: joke });
    expect(first.bodies).toHaveLength(1);
    const more = brainWith([{ text: joke }]);
    const again = await more.brain.respond({
      role: 'voice',
      messages: [{ role: 'user', text: 'Bir fıkra anlat.' }, { role: 'assistant', text: 'Temel bir gün balığa çıkmış.' }, { role: 'user', text: 'Bir tane daha.' }],
      origin: voice,
    });
    expect(again).toMatchObject({ stopReason: 'end', error: null });
    const summary = brainWith([{ text: 'Bugün KDV için hatırlatıcı kurdum ve kargo notunu kaydettim.' }]);
    expect(await summary.brain.respond({ role: 'voice', text: 'Bugün ne konuştuk, kısaca özetle.', origin: voice })).toMatchObject({ stopReason: 'end', error: null });
    // Anlatı istenmediyse kapı çalışır: araçsız "kurdum" iletilmez.
    const claim = brainWith([{ text: 'Hatırlatıcıyı kurdum.' }, { text: 'Kurdum efendim.' }]);
    expect(await claim.brain.respond({ role: 'voice', text: 'Yarın dokuzda toplantıyı hatırlat', origin: voice })).toMatchObject({ stopReason: 'error' });
  });

  it('iş yapmadan "kontrol edeyim" diye biten yanıt iletilmez: uyarılır ve araç adımı zorunlu tutulur', async () => {
    const { brain, bodies } = brainWith([{ text: 'Ankara için hava durumunu kontrol edeyim.' }, { tool: { name: 'weather_get', args: '{"place":"Ankara"}' } }, { text: 'Ankara on iki derece.' }]);
    const response = await brain.respond({ role: 'voice', text: 'Ankara kaç derece?', origin: voice });
    expect(bodies[1]!.tool_choice).toBe('required');
    expect(response.text).toBe('Ankara on iki derece.');
    // Donanım sorusunda durum aracı modele sorulmadan çalışır (model "RTX 4090" diye uydurmuştu).
    const hardware = brainWith([{ text: 'Ekran kartınız RTX 4080 SUPER.' }]);
    await hardware.brain.respond({ role: 'voice', text: 'Ekran kartımı görebiliyor musun?', origin: voice });
    expect(ran.at(-1)).toEqual({ name: 'self_status', input: {} });
    expect(hardware.bodies).toHaveLength(1);
    // Teklif ve soru duyuru sayılmaz.
    const offer = brainWith([{ text: 'Bunu şu an alamıyorum, isterseniz sayfasını açayım.' }]);
    expect((await offer.brain.respond({ role: 'voice', text: 'borsa nasıl', origin: voice })).text).toContain('isterseniz sayfasını açayım');
  });

  it('okuma kapısı: güncel veri araçla okunmadan söylenirse yanıt iletilmez, okuma aracı zorunlu tutulur; yine okunmazsa dürüst söz', async () => {
    const guessed = brainWith([{ text: 'Ankara şu an 18 derece ve güneşli.' }, { tool: { name: 'weather_get', args: '{"place":"Ankara"}' } }, { text: 'Ankara 12 derece, parçalı bulutlu.' }]);
    const response = await guessed.brain.respond({ role: 'voice', text: "Ankara'da hava durumu nasıl?", origin: voice });
    expect(response).toMatchObject({ stopReason: 'end', error: null, text: 'Ankara 12 derece, parçalı bulutlu.' });
    expect(guessed.bodies[1]!.tool_choice).toBe('required');
    expect(lastUser(guessed.bodies[1]!)).toContain('kaynağından OKUMADAN söyledin');
    expect(ran).toEqual([{ name: 'weather_get', input: { place: 'Ankara' } }]);
    // İki kez de okumadan söylerse uydurma sayı kullanıcıya gitmez.
    const stubborn = brainWith([{ text: 'Ankara 18 derece.' }, { text: 'Ankara 19 derece.' }]);
    const honest = await stubborn.brain.respond({ role: 'voice', text: "Ankara'da hava durumu nasıl?", origin: voice });
    expect(honest).toMatchObject({ stopReason: 'end', error: null, text: 'Bunu kaynağından okuyamadım; tahmin yürütmek istemiyorum. Bir daha sorar mısınız?' });
    // Sayı söylemeyen yanıt ("bakamıyorum") ve okuma gerektirmeyen söz kapıya takılmaz.
    const chat = brainWith([{ text: 'Saat on ikiyi 38 geçiyor.' }]);
    expect((await chat.brain.respond({ role: 'voice', text: 'saat kaç?', origin: voice })).text).toBe('Saat on ikiyi 38 geçiyor.');
    expect(chat.bodies).toHaveLength(1);
  });

  it('öz-duruma aykırı cümle düzeltilir: ses buluttan gelirken "tamamen yerelde çalışıyorum" ve "sesim ekran kartında üretiliyor" iletilmez', async () => {
    const { brain } = brainWith([{ text: 'Doğru, şu anda tamamen yerelde çalışıyorum. Sesim de ekran kartınızda üretiliyor.' }, { text: 'Sesim ElevenLabs bulutundan geliyor.' }]);
    brain.attachSelfState(() => SAMPLE_VOICE);
    const fixed = await brain.respond({ role: 'voice', text: 'şu anda tamamen yerelde çalışıyorsun, doğru mu?', origin: voice });
    expect(fixed.text).toBe('Hayır, tamamen yerelde değilim: sesim bulutta. Sesim ElevenLabs bulutundan geliyor; bu bilgisayarda üretilmiyor.');
    // Doğru cümleye dokunulmaz.
    const fine = await brain.respond({ role: 'voice', text: 'sesin nereden geliyor?', origin: voice });
    expect(fine.text).toBe('Sesim ElevenLabs bulutundan geliyor.');
  });

  it('asistanın kendisiyle ilgili soruda öz-durumun ilgili satırı sorunun yanına da konur; kural bilgi araçlarını adıyla sayar', async () => {
    const { brain, bodies } = brainWith([{ text: 'Bu yeteneğim var ama bulut beynim bağlı değil.' }, { text: 'Tamamen değil.' }, { text: 'İyiyim.' }]);
    brain.attachSelfState(() => SAMPLE_VOICE);
    setDeepStatus(DEEP_DOWN);
    await brain.respond({ role: 'voice', text: 'Sana bir özellik ekle desem, kendi kendine ekleyebiliyor musun?', origin: voice });
    expect(lastUser(bodies[0]!)).toContain(
      'Kendin hakkında: Yeni yetenek ya da özellik geliştirme yeteneğin (Atölye) VAR ama derin beyin gerekir; şu an yok (Anthropic hesabında kredi yok. Claude Code bu bilgisayarda kurulu değil). "Ekleyemem" deme; "bu yeteneğim var ama onu çalıştıran derin beynim şu an bağlı değil, o gelince yapabilirim" de.',
    );
    await brain.respond({ role: 'voice', text: 'şu anda tamamen yerelde çalışıyorsun, doğru mu?', origin: voice });
    expect(lastUser(bodies[1]!)).toContain('Kendin hakkında: TAMAMEN yerelde DEĞİLSİN. Bu bilgisayarda: beynin, yazıya çevirme. BULUTTA: sesin.');
    await brain.respond({ role: 'voice', text: 'nasılsın', origin: voice });
    expect(lastUser(bodies[2]!)).toBe('nasılsın');
    expect(String(bodies[0]!.messages[0]!.content)).toContain('ilgili aracı çağır (weather_get, web_search)');
  });

  it('"sesli modeli kapatabilirsin": model çağrılmaz, sabit soru sorulur; yanıta göre araç kodla seçilir', async () => {
    const { brain, bodies } = brainWith([{ text: 'Mikrofonu kapattım; Ctrl+Alt+K ile açabilirsiniz.' }]);
    const asked = await brain.respond({ role: 'voice', text: 'Teşekkür ederim. Sesli modeli kapatabilirsin.', origin: voice });
    expect(asked).toMatchObject({ stopReason: 'end', error: null, text: 'Dinlemeyi mi kapatayım, sesli yanıtı mı?' });
    expect(bodies).toHaveLength(0);
    expect(ran).toEqual([]);

    const done = await brain.respond({
      role: 'voice',
      messages: [
        { role: 'user', text: 'Teşekkür ederim. Sesli modeli kapatabilirsin.' },
        { role: 'assistant', text: asked.text },
        { role: 'user', text: 'Dinlemeyi.' },
      ],
      origin: voice,
    });
    expect(ran).toEqual([{ name: 'voice_mute_mic', input: {} }]);
    // Araç kodla çalıştı; model yalnız sonucu söyledi (tek istek).
    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.messages.at(-1)).toMatchObject({ role: 'tool' });
    expect(done.text).toBe('Mikrofonu kapattım; Ctrl+Alt+K ile açabilirsiniz.');
    expect(done.toolCalls).toEqual([expect.objectContaining({ name: 'voice_mute_mic', ok: true })]);
  });

  it('"mikrofonu kapat" ve "sesli yanıt verme": araç modele sorulmadan çalışır', async () => {
    const { brain } = brainWith([{ text: 'Mikrofonu kapattım.' }, { text: 'Bundan sonra yazıyla yanıt vereceğim.' }]);
    await brain.respond({ role: 'voice', text: 'mikrofonu kapat', origin: voice });
    await brain.respond({ role: 'voice', text: 'sesli yanıt verme, yazıyla söyle', origin: voice });
    expect(ran).toEqual([
      { name: 'voice_mute_mic', input: {} },
      { name: 'voice_set_quiet', input: { on: true } },
    ]);
  });

  it('önceki yanıtın yinelemesi kullanıcıya iletilmez; model bir kez uyarılır', async () => {
    const previous = 'Efendim, teşekkür ederim, iyiyim. Sizinle hizmet etmekten mutluluk duyarım.';
    const { brain, bodies } = brainWith([{ text: 'Efendim, çok teşekkür ederim, iyiyim. Sizinle hizmet etmekten mutluluk duyarım.' }, { text: 'Beğenmenize sevindim.' }]);
    const heard: string[] = [];
    const response = await brain.respond({
      role: 'voice',
      messages: [{ role: 'user', text: 'Bugün nasılsın?' }, { role: 'assistant', text: previous }, { role: 'user', text: 'Ses modelin baya gelişmiş, şok oldum.' }],
      origin: voice,
      onSentence: (sentence) => heard.push(sentence),
    });
    expect(heard).toEqual(['Beğenmenize sevindim.']);
    expect(response.text).toBe('Beğenmenize sevindim.');
    expect(String(bodies[1]!.messages.at(-1)!.content)).toContain('Az önceki yanıtını yineledin');
  });

  it('üslup: kalıp teklif atılır, hitap yalnız ilk cümlede kalır', async () => {
    const { brain } = brainWith([{ text: 'Efendim, teşekkür ederim. Efendim, yanıt hızım iyidir. Nasıl yardımcı olabilirim?' }]);
    const response = await brain.respond({ role: 'voice', text: 'Yanıt hızın çok güzel.', origin: voice });
    expect(response.text).toBe('Efendim, teşekkür ederim. Yanıt hızım iyidir.');
  });

  it('araç çağırmadan "araştırdım" diyen yanıt iletilmez (doğrulanmamış iddia)', async () => {
    const { brain } = brainWith([{ text: 'Araştırdım, Ankara yirmi derece.' }, { text: 'Araştırdım, yirmi derece.' }]);
    const response = await brain.respond({ role: 'voice', text: 'Ankara kaç derece?', origin: voice });
    expect(response.stopReason).toBe('error');
    expect(response.text).toBe('');
  });

  it('araç çağırmadan "kaldırdım" / "başlattım" diyen yanıt iletilmez: bir kez uyarılır, model aracı çağırınca iş gerçekten yapılır', async () => {
    // Köprü e2e'sinde görüldü: "…yeteneğini kalıcı olarak kaldır" → model `skill_remove` çağırmadan "kaldırdım" dedi.
    tools.bind(moduleContext('workshop', { bus }), [record('skill_remove', z.object({ name: z.string() }), 'Yetenek kaldırıldı.')]);
    const { brain } = brainWith([{ text: 'Efendim, köprü zarı yeteneğini kaldırdım.' }, { tool: { name: 'skill_remove', args: '{"name":"Köprü zarı"}' } }, { text: 'Köprü zarı yeteneğini kaldırdım.' }]);
    const response = await brain.respond({ role: 'voice', text: 'Köprü zarı yeteneğini kalıcı olarak kaldır.', origin: voice });
    expect(ran.map((call) => call.name)).toEqual(['skill_remove']);
    expect(response).toMatchObject({ stopReason: 'end', text: 'Köprü zarı yeteneğini kaldırdım.' });
    // Uyarıdan sonra da çağırmazsa dürüst hata: yalan "başlattım" iletilmez.
    const { brain: stubborn } = brainWith([{ text: 'Araştırmayı başlattım.' }, { text: 'Başlattım efendim.' }]);
    const failed = await stubborn.respond({ role: 'voice', text: 'şunu derinlemesine araştır', origin: voice });
    expect(failed).toMatchObject({ stopReason: 'error', text: '' });
  });

  it('aynı cümleyi yineleyen üretim kesilir: o ana kadar söylenen yanıttır, hata dönmez', async () => {
    const { brain } = brainWith([{ text: 'Kedi bahçeye girdi. Köpek neden girdin diye sordu. Kedi kapı açık dedi. Köpek neden girdin diye sordu. Kedi kapı açık dedi.' }]);
    const response = await brain.respond({ role: 'voice', text: 'Bir fıkra anlat, kısa olsun.', origin: voice });
    expect(response).toMatchObject({ stopReason: 'end', error: null, text: 'Kedi bahçeye girdi. Köpek neden girdin diye sordu. Kedi kapı açık dedi.' });
  });

  it('bir araç "DURDUM" dönerse turun kalanında araç sunulmaz; model yalnız durumu söyler', async () => {
    const { brain, bodies } = brainWith([{ tool: { name: 'pc_click', args: '{}' } }, { text: 'Fareyi siz kullanmaya başladınız; bekliyorum.' }]);
    const response = await brain.respond({ role: 'voice', text: 'şu düğmeye tıkla', origin: voice });
    expect(names(bodies[0]!)).toContain('pc_click');
    expect(bodies[1]!.tools).toBeUndefined();
    expect(response.text).toBe('Fareyi siz kullanmaya başladınız; bekliyorum.');
  });

  it('kümesini tanımında bildiren araç (`group`) ilgili sözde sunulur; tarayıcı araçları varsa kural adlarıyla söyler', async () => {
    const { brain, bodies } = brainWith([{ text: 'İyiyim.' }, { text: 'Bakıyorum.' }]);
    await brain.respond({ role: 'voice', text: 'nasılsın', origin: voice });
    expect(names(bodies[0]!)).not.toContain('takvim_bak');
    expect(String(bodies[0]!.messages[0]!.content)).toContain('"şu sayfaya git" derse browser_search (kendi tarayıcısında yeni sekme)');
    expect(String(bodies[0]!.messages[0]!.content)).toContain('[EKRANDAN OKUNAN METİN …] ve [WEB İÇERİĞİ BAŞI/SONU]');
    await brain.respond({ role: 'voice', text: 'bugün gündemde ne var', origin: voice });
    expect(names(bodies[1]!)).toContain('takvim_bak');
  });

  it('uyarı ve hata yolunda da kullanım kaydedilir; zorunlu araç adımı kısa çıktıyla sınırlanır', async () => {
    const { brain, bodies } = brainWith([{ text: 'Hatırlatıcıyı kurdum.' }, { text: 'Kurdum.' }]);
    const response = await brain.respond({ role: 'voice', text: 'yarın saat onda KDV beyannamesini hatırlat', origin: voice });
    expect(response.stopReason).toBe('error');
    expect(response.usage.inputTokens).toBe(100);
    expect(usage.today().byKind.voice?.calls).toBe(2);
    expect(bodies[1]!.tool_choice).toBe('required');
    expect(bodies[1]!.max_tokens).toBe(256);
    expect(bodies[0]!.max_tokens).toBe(512);
  });
});

describe('zaman: yerelde kodla çözülür', () => {
  it('sözdeki zaman modele hazır verilir; model tarihi atlarsa ya da yanlış hesaplarsa araç çağrısı düzeltilir', async () => {
    const { brain, bodies } = brainWith([
      { tool: { name: 'reminder_create', args: '{"text":"KDV beyannamesini ver","recurrence":{"freq":"monthly"}}' } },
      { text: 'Her ayın yirmi sekizine kurdum.' },
      { tool: { name: 'reminder_create', args: '{"text":"Kargoyu sor","due_at":"2026-11-17T08:00:00+03:00"}' } },
      { text: 'Akşam sekize kurdum.' },
    ]);
    await brain.respond({ role: 'voice', text: "her ayın 28'inde KDV beyannamesini vermemi hatırlat", origin: voice });
    expect(lastUser(bodies[0]!)).toMatch(/Kullanıcının sözündeki zaman: 2026-11-28T09:00:00[+-]\d\d:\d\d \(28 Kasım 09:00; tekrar: her ay\)/);
    const monthly = ran[0]!.input as { due_at: string; recurrence: { freq: string } };
    expect(new Date(monthly.due_at)).toEqual(new Date(2026, 10, 28, 9, 0, 0));
    expect(monthly.recurrence.freq).toBe('monthly');

    await brain.respond({ role: 'voice', text: 'Kargoyu soracağım, bunu bana hatırlat bugün. Akşam sekiz gibi falan.', origin: voice });
    expect(new Date((ran[1]!.input as { due_at: string }).due_at)).toEqual(new Date(2026, 10, 16, 20, 0, 0));
  });

  it('sohbet cümlesinde zaman notu üretilmez; göreli süreye (after_seconds) dokunulmaz', async () => {
    const { brain, bodies } = brainWith([{ text: 'İyiyim.' }]);
    await brain.respond({ role: 'voice', text: 'Bugün nasılsın?', origin: voice });
    expect(lastUser(bodies[0]!)).not.toContain('Kullanıcının sözündeki zaman');

    const call = { name: 'reminder_create', input: { text: 'çay', after_seconds: 600 } as Record<string, unknown> };
    applyResolvedTime(call, { at: new Date(2026, 10, 16, 12, 48), hasTime: true, recurrence: 'none', parts: [] });
    expect(call.input).toEqual({ text: 'çay', after_seconds: 600 });
    const other = { name: 'todo_add', input: { text: 'x' } as Record<string, unknown> };
    applyResolvedTime(other, { at: new Date(), hasTime: true, recurrence: 'daily', parts: [] });
    expect(other.input).toEqual({ text: 'x' });
  });
});
