// "Her şeyi konuşarak": sesle ayar, sınama başlatma ve gezinme araçları (gerçek araç tanımları, sahte servisler).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t, type Bus, type ModuleContext, type Settings, type ToolContext, type ToolDef, type ToolResult } from '@fuber/shared';
import { fakePolicy, fakeSettings, fakeVoice, miniTools, moduleContext, testBus } from '../../core/brain/testkit';
import voiceControl, { describeSpokenControls } from './index';
import { endConversationAfterTurn } from './end-conversation';
import { resetSpokenTests, startSpokenTest } from './spoken-tests';

const tool = (name: string): ToolDef => voiceControl.tools!.find((def) => def.name === name)!;

let bus: Bus;
let ctx: ModuleContext;
let tools: ReturnType<typeof miniTools>;
let notified: Array<{ title: string; body?: string; priority: string }>;
let spoken: string[];
let navigations: Array<{ page: string; params?: unknown }>;

function setup(patch: Partial<Settings> & Record<string, unknown> = {}, voice = fakeVoice()) {
  bus = testBus();
  tools = miniTools();
  notified = [];
  spoken = [];
  navigations = [];
  bus.on('app.navigate', (target) => void navigations.push(target));
  ctx = moduleContext('voice-control', {
    bus,
    tools,
    settings: fakeSettings(bus, patch as Partial<Settings>),
    policy: fakePolicy(),
    voice: {
      ...voice,
      speak: async (text: string) => {
        spoken.push(text);
        return { spoken: true };
      },
    } as ModuleContext['voice'],
    attention: { notify: (request: { title: string; body?: string; priority: string }) => void notified.push(request) } as unknown as ModuleContext['attention'],
  });
}

const run = (name: string, input: unknown, origin: ToolContext['origin'] = { channel: 'voice', speakerVerified: null }): Promise<ToolResult> =>
  tool(name).run(input, { ...ctx, callId: 'c1', origin, signal: new AbortController().signal, report() {} });
const settings = () => ctx.settings.get() as unknown as Record<string, unknown>;

beforeEach(() => setup());
afterEach(() => {
  resetSpokenTests();
  vi.useRealTimers();
});

describe('authority_set (yetki düzeyi: serbest söyleyiş ve yazılı sohbet için beynin aracı)', () => {
  const say = (text: string) => `Kullanıcıya yalnız şunu söyle: "${text}"`;

  it('yükseltme bir kez onay ister (tür: authority); onay yoksa ayar değişmez', async () => {
    const asked: Array<{ kind?: string; ask?: string }> = [];
    const original = tools.requestApproval.bind(tools);
    tools.requestApproval = async (input) => {
      asked.push({ kind: input.kind, ask: input.ask });
      return original(input);
    };
    const denied = await run('authority_set', { level: 'full' });
    expect(denied.ok).toBe(false);
    expect(asked).toEqual([{ kind: 'authority', ask: t('authority.ask.raiseFull') }]);
    expect(settings().authorityLevel).toBe('smart');

    tools.approvals.push('approved');
    expect(await run('authority_set', { level: 'full' })).toEqual({ ok: true, text: say(t('authority.say.full')) });
    expect(settings().authorityLevel).toBe('full');
  });

  it('düşürmek ve kaldırmak sorulmaz; durum okunur', async () => {
    setup({ authorityLevel: 'full' });
    tools.authorityState = { level: 'full', base: 'full', max: 'full', grant: null };
    const asked: string[] = [];
    tools.requestApproval = async (input) => {
      asked.push(input.summary);
      return 'denied';
    };
    expect(await run('authority_set', { level: 'ask' })).toEqual({ ok: true, text: say(t('authority.say.ask')) });
    expect(settings().authorityLevel).toBe('ask');
    expect(asked).toEqual([]);
    tools.authorityState = { level: 'ask', base: 'ask', max: 'full', grant: null };
    expect((await run('authority_set', { level: 'status' })).text).toBe(say(t('authority.say.status', { level: t('authority.level.ask') })));
  });

  it('süreli ve işe bağlı tam yetki ayarı değiştirmez, geçici yükseltme verir; Yönetim sınırı aşılamaz', async () => {
    tools.approvals.push('approved', 'approved');
    const timed = await run('authority_set', { level: 'full', minutes: 60 });
    expect(timed.text).toBe(say(t('authority.say.fullTimed', { duration: t('authority.duration.hours', { n: 1 }) })));
    await run('authority_set', { level: 'full', task: true });
    expect(tools.grants).toEqual([{ minutes: 60 }, { task: true }]);
    expect(settings().authorityLevel).toBe('smart');

    tools.authorityState = { level: 'smart', base: 'smart', max: 'smart', grant: null };
    const capped = await run('authority_set', { level: 'full' });
    expect(capped.text).toBe(say(t('authority.say.capped', { level: t('authority.level.smart') })));
    expect(settings().authorityLevel).toBe('smart');
    expect(tools.grants).toHaveLength(2);
  });
});

describe('settings_set', () => {
  it('ayarı gerçekten yazar ve söylenecek cümleyi döndürür', async () => {
    const result = await run('settings_set', { name: 'windowsla_basla', value: 'aç' });
    expect(result).toEqual({ ok: true, text: 'Ayar değişti. Kullanıcıya yalnız şunu söyle: "Windows’la başlatma açıldı."' });
    expect(settings().launchAtLogin).toBe(true);
    const quiet = await run('settings_set', { name: 'sessiz_saatler', value: 'Sessiz saatleri gece on birden sabah yediye ayarla.' });
    expect(quiet.ok).toBe(true);
    expect(settings().quietHours).toEqual({ enabled: true, from: '23:00', to: '07:00' });
    await run('settings_set', { name: 'hitap', value: 'Patron' });
    expect(settings().userAddress).toBe('Patron');
  });

  it('izin AÇMA onay ister: onay yoksa yazılmaz; kapatma onay istemez', async () => {
    setup({ pcReadAllowed: false });
    const asked: string[] = [];
    const original = tools.requestApproval.bind(tools);
    tools.requestApproval = async (input) => {
      asked.push(input.summary);
      return original(input);
    };
    // Onay verilmedi (kuyruk boş → reddedildi).
    const denied = await run('settings_set', { name: 'ekran_okuma_izni', value: 'aç' });
    expect(denied).toEqual({ ok: false, text: t('tool.error.denied') });
    expect(settings().pcReadAllowed).toBe(false);
    // Onay süresi doldu.
    tools.approvals.push('expired');
    expect((await run('settings_set', { name: 'ekran_okuma_izni', value: 'aç' })).text).toBe('Onay süresi doldu, yanıt gelmedi; iş yapılmadı.');
    expect(settings().pcReadAllowed).toBe(false);
    // Onaylandı.
    tools.approvals.push('approved');
    const approved = await run('settings_set', { name: 'ekran_okuma_izni', value: 'aç' });
    expect(approved.ok).toBe(true);
    expect(settings().pcReadAllowed).toBe(true);
    expect(asked).toEqual(Array(3).fill('Ekranınızı ve pencerelerinizi okuma iznini açmak istiyorum'));
    // Kapatmak onay istemez.
    const closed = await run('settings_set', { name: 'bilgisayar_kullanma_izni', value: 'kapat' });
    expect(closed.ok).toBe(true);
    expect(settings().pcControlAllowed).toBe(false);
    expect(asked).toHaveLength(3);
  });

  it('Yönetim’den yönetilen ayar değişmez; Jarvis nereden değişeceğini söyler', async () => {
    const before = JSON.stringify(settings());
    const result = await run('settings_set', { name: 'uyandirma_sozu', value: 'Friday' });
    expect(result.ok).toBe(false);
    expect(result.text).toContain('Fuber Yönetim’den yönetilir; sesle ya da bu bilgisayardan değiştirilemez');
    expect(result.text).toContain('Kullanıcıya yalnız şunu söyle: "Uyandırma sözü Fuber Yönetim’den yönetiliyor; oradaki Beyin ve Kişilik ekranından değiştirebilirsiniz."');
    expect(JSON.stringify(settings())).toBe(before);
  });

  it('ses motoru ve ses seçimi cihaz ayarına yazılır (gerçek katalog); Yönetim’in seçimine dönülür', async () => {
    const engine = await run('settings_set', { name: 'ses_motoru', value: 'Ses motorunu Piper yap.' });
    expect(engine).toEqual({ ok: true, text: 'Ayar değişti. Kullanıcıya yalnız şunu söyle: "Ses motoru Piper yapıldı."' });
    expect(settings().ttsEngine).toBe('piper-local');
    const back = await run('settings_set', { name: 'ses_motoru', value: 'varsayılana dön' });
    expect(back.ok).toBe(true);
    expect(settings().ttsEngine).toBeNull();
    const voice = await run('settings_set', { name: 'ses', value: 'Sesini Erkek beş yap.' });
    expect(voice).toEqual({ ok: true, text: 'Ayar değişti. Kullanıcıya yalnız şunu söyle: "Sesimi Erkek 5 · en derin yaptım."' });
    expect(settings().ttsVoices).toEqual({ supertonic: 'M5' });
    expect((await run('settings_list', { name: 'ses' })).text).toBe('Ses seçimi: Erkek 5 · en derin. Kullanıcıya yalnız bunu, tek cümleyle söyle.');
    // Olmayan ses: yazılmaz, seçenekler söylenir.
    const unknown = await run('settings_set', { name: 'ses', value: 'robot sesi' });
    expect(unknown.ok).toBe(false);
    expect(settings().ttsVoices).toEqual({ supertonic: 'M5' });
  });

  it('asistanın kendi tarayıcısını kullanma izni: kapatmak onaysız, açmak onaylı; bilgisayar izniyle karışmaz', async () => {
    const approvals: string[] = [];
    tools.requestApproval = async (request: { summary: string }) => {
      approvals.push(request.summary);
      return 'approved';
    };
    const off = await run('settings_set', { name: 'tarayici_izni', value: 'Kendi tarayıcını kullanma iznini kapat.' });
    expect(off).toEqual({ ok: true, text: 'Ayar değişti. Kullanıcıya yalnız şunu söyle: "Kendi tarayıcımı kullanma izni kapatıldı."' });
    expect(settings()).toMatchObject({ jbrowserAllowed: false, pcControlAllowed: true });
    expect(approvals).toEqual([]);
    // Model ayarın adını kullanıcının sözüyle de verebilir: bilgisayarı kullanma izni DEĞİL, tarayıcı izni çözülür.
    const on = await run('settings_set', { name: 'tarayıcını kullanma izni', value: 'aç' });
    expect(on.ok).toBe(true);
    expect(settings().jbrowserAllowed).toBe(true);
    expect(approvals).toEqual(['Kendi tarayıcımı kullanma iznini (ayrı pencerede gezinme, okuma, form doldurma) açmak istiyorum']);
    expect((await run('settings_list', { name: 'tarayici_izni' })).text).toBe('Kendi tarayıcımı kullanma izni: açık. Kullanıcıya yalnız bunu, tek cümleyle söyle.');
  });

  it('alan bu sürümde yoksa "bu sürümde yok"; alan gelince çalışır', async () => {
    // "Bu sürümde yok" örneği bildirim sesi; var olan seçenekli alan (adanın ekranı) yazılır.
    const absent = await run('settings_set', { name: 'bildirim_sesi', value: 'aç' });
    expect(absent).toEqual({ ok: false, text: 'Değiştirilmedi. Kullanıcıya yalnız şunu söyle: "Bildirim sesi ayarı bu sürümde yok; eklendiğinde sesle değiştirebileceksiniz."' });
    setup({ islandDisplay: 'cursor' });
    const present = await run('settings_set', { name: 'ada_ekrani', value: 'ana ekran' });
    expect(present.ok).toBe(true);
    expect(settings().islandDisplay).toBe('primary');
  });
});

describe('settings_list', () => {
  it('"ne ayarlayabilirim": ayarlar değerleriyle, sınamalar, sayfalar ve sesle değişmeyenler', async () => {
    const text = (await run('settings_list', {})).text;
    expect(text).toContain('Windows’la başlatma: kapalı');
    expect(text).toContain('sessiz saatler: kapalı (23:00–08:00)');
    expect(text).toContain('Bu sürümde henüz olmayanlar: bildirim sesi.');
    expect(text).toContain('söz kesme sınaması');
    expect(text).toContain('mikrofon sınaması');
    expect(text).toContain('Sesle açılan sayfalar: Ayarlar, Sohbet, Hafıza, Planlar, Projeler, İşler, Toplantı, Geliştirme, Yetenekler, Bugün');
    // Tarayıcı izni adıyla listelenir (alan adıyla, "jbrowserAllowed" diye değil).
    expect(text).toContain('kendi tarayıcımı kullanma izni: açık');
    expect(text).not.toContain('jbrowserAllowed');
    // Ses motoru ve ses bu cihazın ayarıdır (yerel ses): sesle değişenler arasında, şu anki değeriyle.
    expect(text).toContain('ses motoru: Supertonic 3 (Fuber Yönetim’in seçimi)');
    expect(text).toContain('ses seçimi: Erkek 4 · tok');
    expect(text).toContain('Fuber Yönetim’den yönetilenler (sesle değişmez): uyandırma sözü');
    expect(text).toContain('kısayollar');
    // Yerel modelin araç sonucu sınırına sığar.
    expect(text.length).toBeLessThan(2400);
  });

  it('konuya göre kısa yanıt ve tek ayarın değeri', async () => {
    // Fare ve klavye sınaması (bilgisayar modülü) yalnız bilgisayarı kullanma izni açıkken sayılır.
    const tests = (await run('settings_list', { topic: 'sinamalar' })).text;
    expect(tests).toContain(
      settings().pcControlAllowed
        ? 'Kullanıcıya yalnız şunu söyle: "Söz kesme sınaması, yankı sınaması, uyandırma alıştırması, mikrofon sınaması ve fare ve klavye sınaması var; hangisini başlatayım?"'
        : 'Kullanıcıya yalnız şunu söyle: "Söz kesme sınaması, yankı sınaması, uyandırma alıştırması ve mikrofon sınaması var; hangisini başlatayım?"',
    );
    expect((await run('settings_list', { topic: 'ayarlar' })).text).toContain('Sesle şunları değiştirebilirsiniz: Windows’la başlatma, sessiz saatler');
    setup({ quietHours: { enabled: true, from: '22:00', to: '07:30' } });
    expect((await run('settings_list', { name: 'sessiz_saatler' })).text).toBe('Sessiz saatler: açık (22:00–07:30). Kullanıcıya yalnız bunu, tek cümleyle söyle.');
  });

  it('kapalı modülün sayfası listede yoktur', () => {
    setup({ disabledModules: ['planner'] });
    expect(describeSpokenControls(ctx, { topic: 'sayfalar' })).not.toContain('Planlar');
  });
});

describe('app_navigate', () => {
  it('ana pencereyi sayfada (ve sekmede) açar', async () => {
    expect((await run('app_navigate', { page: 'settings' })).text).toContain('Ayarlar sayfasını açtım.');
    await run('app_navigate', { page: 'settings/voice' });
    await run('app_navigate', { page: 'Planlar' });
    expect(navigations).toEqual([{ page: 'settings' }, { page: 'settings', params: { tab: 'voice' } }, { page: 'planner' }]);
  });

  it('İşler ve Toplantı sayfaları (demo.3): adla ve kimlikle açılır; modülü kapalıysa açılmaz', async () => {
    expect((await run('app_navigate', { page: 'watch' })).text).toContain('İşler sayfasını açtım.');
    expect((await run('app_navigate', { page: 'Toplantı sayfası' })).text).toContain('Toplantı sayfasını açtım.');
    expect(navigations).toEqual([{ page: 'watch' }, { page: 'meeting' }]);
    // E-posta hesapları Ayarlar'ın sekmesidir.
    expect((await run('app_navigate', { page: 'settings/mail' })).text).toContain('Ayarlar › E-posta sayfasını açtım.');
    expect(navigations.at(-1)).toEqual({ page: 'settings', params: { tab: 'mail' } });
    navigations.pop();
    setup({ disabledModules: ['watch', 'meeting'] });
    expect(await run('app_navigate', { page: 'watch' })).toEqual({ ok: false, text: 'İşler sayfası şu an yok: modülü kapalı. Kullanıcıya bunu söyle.' });
    expect((await run('app_navigate', { page: 'meeting' })).ok).toBe(false);
    expect(navigations).toEqual([]);
    expect((await run('settings_list', { topic: 'sayfalar' })).text).not.toMatch(/İşler|Toplantı/);
  });

  it('bilinmeyen sayfa ve kapalı modül: açmaz, nedenini söyler', async () => {
    expect((await run('app_navigate', { page: 'uzay' })).ok).toBe(false);
    setup({ disabledModules: ['planner'] });
    const closed = await run('app_navigate', { page: 'planner' });
    expect(closed).toEqual({ ok: false, text: 'Planlar sayfası şu an yok: modülü kapalı. Kullanıcıya bunu söyle.' });
    expect(navigations).toEqual([]);
  });
});

describe('voice_test_start', () => {
  const testVoice = () => {
    const voice = fakeVoice() as ReturnType<typeof fakeVoice> & Record<string, unknown>;
    const started: string[] = [];
    voice.echoTest = async () => {
      started.push('echo');
      return { ok: true, leaked: false, recommendedBargeIn: 'voice' as const, message: 'Yankı yok: konuşurken sözümü kesebilirsiniz.' };
    };
    voice.calibrateWake = async (samples: number) => {
      started.push(`wake:${samples}`);
      return { ok: true, heard: 3, total: 3, threshold: 0.5, paths: [], message: 'Sesinizi tanıdım.' };
    };
    voice.testMic = async (_device: string | null, seconds: number) => {
      started.push(`mic:${seconds}`);
      return { ok: true, deviceLabel: 'Mikrofon', peak: 0.4, rms: 0.1, speechDetected: true, transcript: 'bir iki üç', error: null };
    };
    voice.bargeInTest = async () => {
      started.push('barge');
      return { ok: true, trials: 3, stopped: 3, selfInterrupts: 0, latenciesMs: [200], medianMs: 200, bargeIn: 'voice', message: '3 denemenin 3 tanesinde sustum.' };
    };
    return { voice, started };
  };

  it('sınama tur bitip yanıt söylendikten SONRA başlar; sonucu söylenir ve bildirim olarak kalır', async () => {
    vi.useFakeTimers();
    const { voice, started } = testVoice();
    setup({}, voice);
    const { result, settled } = startSpokenTest('echo', ctx);
    expect(result.ok).toBe(true);
    expect(result.text).toContain('Kullanıcıya yalnız şunu söyle: "Yankı sınamasını başlatıyorum. Kısa bir cümle çalacağım; birkaç saniye sessiz kalın."');
    // Tur bitmeden başlamaz.
    await vi.advanceTimersByTimeAsync(2000);
    expect(started).toEqual([]);
    bus.emit('conversation.turn', { sessionId: 's', channel: 'voice', userMessageId: 'u', assistantMessageId: 'a', interrupted: false });
    await vi.advanceTimersByTimeAsync(1000);
    await settled;
    expect(started).toEqual(['echo']);
    expect(spoken).toEqual(['Yankı yok: konuşurken sözümü kesebilirsiniz.']);
    expect(notified).toEqual([expect.objectContaining({ title: 'Yankı sınaması', body: 'Yankı yok: konuşurken sözümü kesebilirsiniz.', priority: 'low' })]);
  });

  it('toplantı kipi açıkken sınama başlamaz: nedeni söylenir, hiçbir şey sıraya girmez', async () => {
    const { voice, started } = testVoice();
    const status = voice.status.bind(voice);
    voice.status = () => ({ ...status(), meeting: { on: true, system: 'on' as const, systemError: null, queued: 0 } });
    setup({}, voice);
    for (const id of ['barge_in', 'echo', 'wake_training', 'mic'] as const) {
      const { result, settled } = startSpokenTest(id, ctx);
      expect(result.ok, id).toBe(false);
      expect(result.text, id).toContain('Toplantı kipi açıkken ses sınaması yapılmıyor; toplantı bitince yeniden deneyin.');
      await settled;
    }
    expect(started).toEqual([]);
    // Toplantı bitince olağan başlar (bekleyen bir sınama kalmamıştır).
    setup({}, testVoice().voice);
    expect(startSpokenTest('mic', ctx).result.ok).toBe(true);
  });

  it('asistan konuşurken beklenir (başlatan yanıt kesilmesin)', async () => {
    vi.useFakeTimers();
    const { voice, started } = testVoice();
    let state: 'speaking' | 'idle' = 'speaking';
    const status = voice.status.bind(voice);
    voice.status = () => ({ ...status(), state });
    setup({}, voice);
    const { settled } = startSpokenTest('mic', ctx);
    bus.emit('conversation.turn', { sessionId: 's', channel: 'voice', userMessageId: 'u', assistantMessageId: 'a', interrupted: false });
    await vi.advanceTimersByTimeAsync(3000);
    expect(started).toEqual([]);
    state = 'idle';
    await vi.advanceTimersByTimeAsync(1500);
    await settled;
    expect(started).toEqual(['mic:4']);
    expect(spoken).toEqual(['Mikrofon çalışıyor; sizi duydum: “bir iki üç”']);
  });

  it('araç dört sınamayı da başlatır; aynı anda yalnız biri koşar', async () => {
    vi.useFakeTimers();
    const { voice, started } = testVoice();
    setup({}, voice);
    const first = await run('voice_test_start', { test: 'barge_in' });
    expect(first.ok).toBe(true);
    const second = await run('voice_test_start', { test: 'wake_training' });
    expect(second).toEqual({ ok: false, text: 'Şu an söz kesme sınaması sürüyor; bitince yeniden deneyin.' });
    bus.emit('conversation.turn', { sessionId: 's', channel: 'voice', userMessageId: 'u', assistantMessageId: 'a', interrupted: false });
    await vi.advanceTimersByTimeAsync(2000);
    expect(started).toEqual(['barge']);
    const third = await run('voice_test_start', { test: 'wake_training' });
    expect(third.text).toContain('üç kez “Hey Jarvis” deyin');
    bus.emit('conversation.turn', { sessionId: 's', channel: 'voice', userMessageId: 'u', assistantMessageId: 'a', interrupted: false });
    await vi.advanceTimersByTimeAsync(2000);
    expect(started).toEqual(['barge', 'wake:3']);
  });

  it('mikrofon kapalıyken ya da ses hattı hazır değilken başlamaz, nedenini söyler', async () => {
    const { voice, started } = testVoice();
    voice.muteMic();
    setup({}, voice);
    const muted = await run('voice_test_start', { test: 'mic' });
    expect(muted).toEqual({ ok: false, text: 'mikrofon sınaması için mikrofon açık olmalı; şu an kapalı. Kullanıcıya mikrofonu açmasını söyle.' });
    const down = testVoice();
    const status = down.voice.status.bind(down.voice);
    down.voice.status = () => ({ ...status(), ready: false, notReadyReason: 'modeller iniyor' });
    setup({}, down.voice);
    expect((await run('voice_test_start', { test: 'echo' })).text).toBe('yankı sınaması başlatılamadı: ses hattı hazır değil (modeller iniyor).');
    expect(started).toEqual([]);
  });

  it('sınama fırlatırsa kullanıcı sade bir cümle duyar; sonraki sınama başlatılabilir', async () => {
    vi.useFakeTimers();
    const { voice } = testVoice();
    voice.echoTest = async () => {
      throw new Error('ses penceresi yok');
    };
    setup({}, voice);
    const { settled } = startSpokenTest('echo', ctx);
    bus.emit('conversation.turn', { sessionId: 's', channel: 'chat', userMessageId: 'u', assistantMessageId: 'a', interrupted: false });
    await vi.advanceTimersByTimeAsync(2000);
    await settled;
    expect(spoken).toEqual(['yankı sınaması tamamlanamadı; ayrıntı günlüğe yazıldı.']);
    expect(startSpokenTest('mic', ctx).result.ok).toBe(true);
  });
});

describe('araç tanımları', () => {
  it('yeni araçlar doğru risk ve kümeyle tanımlı', () => {
    const shape = (name: string) => ({ risk: tool(name).risk, group: tool(name).group });
    expect(shape('settings_list')).toEqual({ risk: 'read', group: 'settings' });
    expect(shape('settings_set')).toEqual({ risk: 'write', group: 'settings' });
    expect(shape('voice_test_start')).toEqual({ risk: 'write', group: 'settings' });
    expect(shape('app_navigate')).toEqual({ risk: 'read', group: 'settings' });
  });
});

describe('voice_end_conversation (veda sözü)', () => {
  /** Durumu sınamadan değiştirilebilen sahte ses servisi. */
  function voiceIn(state: string, conversation: boolean) {
    const voice = fakeVoice();
    const live = { state, conversation };
    return { voice: { ...voice, status: () => ({ ...voice.status(), ...live }) } as ReturnType<typeof fakeVoice>, live, calls: voice.calls };
  }
  const turnDone = () => bus.emit('conversation.turn', {} as never);

  it('sohbet kipi: veda SÖYLENDİKTEN sonra biter; mikrofon kapanmaz, uyandırma duraklamaz', async () => {
    const { voice, live, calls } = voiceIn('speaking', true);
    setup({}, voice);
    const result = await run('voice_end_conversation', {});
    expect(result.ok).toBe(true);
    expect(result.text).toContain('Görüşürüz efendim.');
    // Tur sürerken (veda söylenirken) hiçbir şey kapatılmaz.
    expect(calls).toEqual([]);
    const { ended } = endConversationAfterTurn(ctx);
    turnDone();
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(calls).toEqual([]);
    live.state = 'listening';
    expect(await ended).toBe(true);
    expect(calls.filter((call) => call === 'endConversation').length).toBeGreaterThanOrEqual(1);
    expect(calls.some((call) => call.startsWith('muteMic') || call.startsWith('pauseWake') || call === 'cancelTurn')).toBe(false);
  });

  it('sohbet kipi dışında takip dinlemesi kapanır; boştayken (yazılı sohbet) hiçbir şeye dokunulmaz', async () => {
    const followup = voiceIn('followup', false);
    setup({}, followup.voice);
    const first = endConversationAfterTurn(ctx);
    turnDone();
    expect(await first.ended).toBe(true);
    expect(followup.calls).toEqual(['cancelTurn']);

    const idle = voiceIn('idle', false);
    setup({}, idle.voice);
    const second = endConversationAfterTurn(ctx);
    turnDone();
    expect(await second.ended).toBe(false);
    expect(idle.calls).toEqual([]);
  });

  it('yeni başlamış dinlemeye (uyandırma ya da kısayol) dokunulmaz', async () => {
    const fresh = voiceIn('listening', false);
    setup({}, fresh.voice);
    const { ended } = endConversationAfterTurn(ctx);
    turnDone();
    expect(await ended).toBe(false);
    expect(fresh.calls).toEqual([]);
  });
});
