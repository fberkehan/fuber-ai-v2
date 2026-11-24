import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BrainApi, BrainRequest, BrainResponse, Bus, BusEvents, ConversationApi } from '@fuber/shared';
import { silentLog, tempStore, testBus } from './brain/testkit';
import { createConversation } from './conversation';

let env: ReturnType<typeof tempStore>;
let bus: Bus;
let requests: BrainRequest[];
let reply: (request: BrainRequest) => Promise<BrainResponse>;
let conversation: ConversationApi;

const response = (text: string, extra: Partial<BrainResponse> = {}): BrainResponse => ({
  text,
  stopReason: 'end',
  error: null,
  toolCalls: [],
  usage: { inputTokens: 1, outputTokens: 1, costUsd: 0, durationMs: 1 },
  ...extra,
});

beforeEach(() => {
  env = tempStore();
  bus = testBus();
  requests = [];
  reply = async () => response('Tamam.');
  const brain = {
    respond: async (request: BrainRequest) => {
      requests.push(request);
      return reply(request);
    },
    extract: async () => ({ summary: 'Eski konuşmada KDV konuşuldu.' }),
  } as unknown as BrainApi;
  conversation = createConversation({ store: env.store, brain, bus, log: silentLog });
});
afterEach(() => env.close());

describe('konuşma omurgası', () => {
  it('turu kaydeder, akış olaylarını ve conversation.turn yayınlar', async () => {
    const stream: Array<BusEvents['chat.stream']['kind']> = [];
    const turns: Array<BusEvents['conversation.turn']> = [];
    bus.on('chat.stream', (event) => void stream.push(event.kind));
    bus.on('conversation.turn', (event) => void turns.push(event));
    reply = async (request) => {
      request.onText?.('Tamam.');
      return response('Tamam.');
    };
    const result = await conversation.turn({ sessionId: null, channel: 'chat', text: 'Merhaba Jarvis' });
    expect(stream).toEqual(['start', 'text', 'done']);
    expect(turns).toHaveLength(1);
    expect(conversation.messages(result.sessionId, { limit: 10 }).map((m) => m.text)).toEqual(['Merhaba Jarvis', 'Tamam.']);
    expect(conversation.sessions({ limit: 5 })[0]?.title).toBe('Merhaba Jarvis');
    expect(requests[0]).toMatchObject({ role: 'deep', effort: 'medium' });
  });

  it('her iletiyle oturum listesi yenilenir: ileti sayısı yanıt bitince günceldir', async () => {
    const changes: Array<BusEvents['chat.changed']> = [];
    const counts: number[] = [];
    bus.on('chat.changed', (event) => {
      changes.push(event);
      counts.push(conversation.sessions({ limit: 5 })[0]?.messageCount ?? 0);
    });
    const result = await conversation.turn({ sessionId: null, channel: 'chat', text: 'Merhaba Jarvis' });
    // Oturum doğdu (0 ileti) → kullanıcı iletisi (1) → asistan yanıtı (2).
    expect(changes.map((event) => event.op)).toEqual(['created', 'updated', 'updated']);
    expect(changes.every((event) => event.ids[0] === result.sessionId)).toBe(true);
    expect(counts).toEqual([0, 1, 2]);
    conversation.appendMessage({ sessionId: result.sessionId, role: 'assistant', text: 'Hatırlatma.', channel: 'chat' });
    expect(counts.at(-1)).toBe(3);
  });

  it('sesli kanal voice rolüyle ve aynı oturumda sürer; geçmişi verir', async () => {
    const first = await conversation.turn({ sessionId: null, channel: 'voice', text: 'Şirketimin adı Atlas Limited.' });
    await conversation.turn({ sessionId: null, channel: 'voice', text: 'Adı neydi?' });
    expect(requests[1]!.role).toBe('voice');
    expect(requests[1]!.origin.sessionId).toBe(first.sessionId);
    expect(requests[1]!.messages!.map((m) => m.text)).toEqual(['Şirketimin adı Atlas Limited.', 'Tamam.', 'Adı neydi?']);
  });

  it('araçla yapılan iş geçmişte "(yapıldı: …)" notuyla görünür; başarısız araç ve kayıttaki metin nota girmez', async () => {
    const call = (name: string, ok: boolean) => ({ callId: name, name, ok, text: 'x', durationMs: 1 });
    reply = async () => response('Hatırlatıcıyı akşam sekize kurdum.', { toolCalls: [call('reminder_create', true), call('memory_save', false)] });
    const first = await conversation.turn({ sessionId: null, channel: 'voice', text: 'Akşam sekizde hatırlat' });
    reply = async () => response('Tamam.');
    await conversation.turn({ sessionId: first.sessionId, channel: 'voice', text: 'Az önce anlamadım, bir daha söyler misin?' });
    expect(requests[1]!.messages!.map((m) => m.text)).toEqual([
      'Akşam sekizde hatırlat',
      'Hatırlatıcıyı akşam sekize kurdum. (yapıldı: reminder_create)',
      'Az önce anlamadım, bir daha söyler misin?',
    ]);
    // Kullanıcının gördüğü döküm değişmez.
    expect(conversation.messages(first.sessionId, { limit: 10 })[1]!.text).toBe('Hatırlatıcıyı akşam sekize kurdum.');
  });

  it('yarıda kesilen yanıt "yarıda kesildi" olarak kaydedilir ve geçmişte öyle görünür', async () => {
    reply = async () => response('Yarın saat onda', { stopReason: 'aborted' });
    const first = await conversation.turn({ sessionId: null, channel: 'voice', text: 'Ne var yarın?' });
    expect(first.assistantMessage.interrupted).toBe(true);
    reply = async () => response('Tamam.');
    await conversation.turn({ sessionId: first.sessionId, channel: 'voice', text: 'Devam et' });
    expect(requests[1]!.messages![1]!.text).toContain('yarıda kesildi');
    const amended = conversation.amendMessage(first.assistantMessage.id, { text: 'Yarın' });
    expect(amended?.text).toBe('Yarın');
  });

  it('hata turunda kullanıcıya cümle kaydedilir ama modele geçmiş olarak gitmez', async () => {
    reply = async () => response('', { stopReason: 'error', error: 'Şu an yoğunluk var.' });
    const errors: string[] = [];
    bus.on('chat.stream', (event) => event.kind === 'error' && errors.push(event.error));
    const first = await conversation.turn({ sessionId: null, channel: 'chat', text: 'Merhaba' });
    expect(errors).toEqual(['Şu an yoğunluk var.']);
    expect(first.assistantMessage.text).toBe('Şu an yoğunluk var.');
    reply = async () => response('Tamam.');
    await conversation.turn({ sessionId: first.sessionId, channel: 'chat', text: 'Tekrar' });
    expect(requests[1]!.messages!.map((m) => m.text)).toEqual(['Merhaba', 'Tekrar']);
  });

  it('dökümde Türkçe tam metin arama', async () => {
    await conversation.turn({ sessionId: null, channel: 'chat', text: 'İSTANBUL ofisinin kirası ne kadar?' });
    const hits = conversation.search('istanbul', 10);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.snippet).toContain('[[İSTANBUL]]');
  });

  it('pencereyi aşan oturumu özetler; özet geçmişin başına girer', async () => {
    const first = await conversation.turn({ sessionId: null, channel: 'chat', text: 'ileti 0' });
    for (let i = 1; i < 8; i++) await conversation.turn({ sessionId: first.sessionId, channel: 'chat', text: `ileti ${i}` });
    await new Promise((resolve) => setTimeout(resolve, 10));
    await conversation.turn({ sessionId: first.sessionId, channel: 'chat', text: 'son' });
    const history = requests.at(-1)!.messages!;
    expect(history[0]!.text).toContain('Eski konuşmada KDV konuşuldu.');
    expect(history.length).toBeLessThanOrEqual(13);
  });

  it('yeni oturumun ilk sözü "az önce ne söylemiştim?" ise bir önceki (yakın) oturumun sonu geçmiş olarak verilir', async () => {
    const first = await conversation.turn({ sessionId: null, channel: 'voice', text: "Yarın Kaan'la bütçeyi konuşacağız." });
    // Sesli oturum 30 dk sessizlikte kapanır; burada yeni oturum elle açılır.
    const fresh = conversation.createSession('voice');
    await conversation.turn({ sessionId: fresh.id, channel: 'voice', text: 'Az önce ne söylemiştim?' });
    expect(requests[1]!.origin.sessionId).toBe(fresh.id);
    expect(requests[1]!.messages!.map((message) => message.text)).toEqual(["Yarın Kaan'la bütçeyi konuşacağız.", 'Tamam.', 'Az önce ne söylemiştim?']);
    // Başka bir söz önceki oturumu taşımaz: yeni oturum boş başlar.
    const other = conversation.createSession('voice');
    await conversation.turn({ sessionId: other.id, channel: 'voice', text: 'Bugün hava nasıl?' });
    expect(requests[2]!.messages!.map((message) => message.text)).toEqual(['Bugün hava nasıl?']);
    // Oturumun kendi geçmişi varsa önceki oturuma bakılmaz.
    await conversation.turn({ sessionId: other.id, channel: 'voice', text: 'Demin ne demiştim?' });
    expect(requests[3]!.messages!.map((message) => message.text)).toEqual(['Bugün hava nasıl?', 'Tamam.', 'Demin ne demiştim?']);
    expect(first.sessionId).not.toBe(fresh.id);
  });

  it('eski bir oturum "az önce" sayılmaz (üç saatten eski)', async () => {
    const old = await conversation.turn({ sessionId: null, channel: 'voice', text: 'Eski bir söz.' });
    env.store.scoped('conversation').run('UPDATE conversation_sessions SET last_at = ? WHERE id = ?', [new Date(Date.now() - 4 * 60 * 60_000).toISOString(), old.sessionId]);
    const fresh = conversation.createSession('voice');
    await conversation.turn({ sessionId: fresh.id, channel: 'voice', text: 'Az önce ne söylemiştim?' });
    expect(requests[1]!.messages!.map((message) => message.text)).toEqual(['Az önce ne söylemiştim?']);
  });

  it('oturum silinince iletiler ve dizin de gider', async () => {
    const result = await conversation.turn({ sessionId: null, channel: 'chat', text: 'silinecek metin' });
    expect(conversation.deleteSession(result.sessionId)).toBe(true);
    expect(conversation.search('silinecek', 5)).toEqual([]);
  });

  it('ifade etiketleri ekrana ve döküme girmez: akış, saklanan metin, düzeltme; seslendirmeye ham gider', async () => {
    const shown: string[] = [];
    const spoken: string[] = [];
    bus.on('chat.stream', (event) => event.kind === 'text' && shown.push(event.delta));
    reply = async (request) => {
      for (const part of ['Tamam ', '<lau', 'gh> efendim, ', 'harika [laughs] bir fikir.']) request.onText?.(part);
      request.onSentence?.('Tamam <laugh> efendim, harika [laughs] bir fikir.');
      return response('Tamam <laugh> efendim, harika [laughs] bir fikir.');
    };
    const voice = await conversation.turn({ sessionId: null, channel: 'voice', text: 'Bir fıkra anlat', onSentence: (s) => void spoken.push(s) });
    expect(voice.assistantMessage.text).toBe('Tamam efendim, harika bir fikir.');
    expect(shown.join('')).not.toMatch(/[<>[\]]/);
    expect(shown.join('').replace(/\s+/g, ' ')).toContain('Tamam efendim, harika');
    // Ses hattı cümleyi ham alır: motoru destekliyorsa etiketi kendi yazımına çevirir.
    expect(spoken).toEqual(['Tamam <laugh> efendim, harika [laughs] bir fikir.']);
    // Yarıda kesilen sesli yanıtın söylenen kısmı da etiketsiz saklanır; arama dizini temiz metni görür.
    expect(conversation.amendMessage(voice.assistantMessage.id, { text: 'Tamam <laugh> efendim,', interrupted: true })?.text).toBe('Tamam efendim,');
    expect(conversation.search('laugh', 5)).toEqual([]);

    // Yazılı sohbet: tanınan ifade atılır, Markdown korunur.
    reply = async () => response('Elbette <laugh>.\n\n- [ ] ilk iş\n- [Kaynak](https://example.com)');
    const chat = await conversation.turn({ sessionId: null, channel: 'chat', text: 'Liste yap' });
    expect(chat.assistantMessage.text).toBe('Elbette.\n\n- [ ] ilk iş\n- [Kaynak](https://example.com)');
  });
});
