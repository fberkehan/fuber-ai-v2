import { describe, expect, it } from 'vitest';
import { correctSelfClaim, deepFromStatus, describeSelf, listCapabilities, renderSelfBlock, selfHints, type SelfState, type SelfVoiceState } from './self';

const voice = (patch: Partial<SelfVoiceState> = {}): SelfVoiceState => ({
  ready: true,
  stt: { provider: 'whisper-local', gpu: true },
  tts: { provider: 'elevenlabs', active: 'elevenlabs', fallbackReason: null },
  micMuted: false,
  quiet: false,
  bargeIn: 'wake',
  wakePaused: false,
  conversation: false,
  ...patch,
});

/** Örnek kurulumun durumu: beyin yerelde (bulutta kredi yok), yazıya çevirme yerelde, ses ElevenLabs bulutundan. */
const sampleSession = (patch: Partial<SelfState> = {}): SelfState => ({
  appName: 'Fuber AI 2',
  appVersion: '2.0.0-demo.1',
  brain: { provider: 'local', reason: 'cloud_down', cause: 'billing', model: 'qwen3.5-4b-q4km', deep: { ok: false, reason: 'Bu iş bulut beyni istiyor; bulut beyni şu an kullanılamıyor.' } },
  voice: voice(),
  admin: 'approved',
  hotkeys: { talk: 'Ctrl+Alt+J', mute: 'Ctrl+Alt+K' },
  capabilities: [
    { label: 'hatırlatıcı ve yapılacaklar', available: true, needs: null },
    { label: 'yeni yetenek ya da özellik geliştirme (Atölye)', available: false, needs: 'bulut beyni gerekir; şu an yok' },
  ],
  ...patch,
});

describe('öz-durum bloğu (durum → istem metni)', () => {
  it('örnek kurulum: beyin yerelde ve nedeni, yazıya çevirme yerelde, SES BULUTTAN; yapamadıkları neye bağlı', () => {
    const block = renderSelfBlock(sampleSession());
    expect(block).toContain('## ŞU ANKİ DURUMUN');
    expect(block).toContain('BU BİLGİSAYARDA, ekran kartında çalışan yerel model (qwen3.5-4b-q4km)');
    expect(block).toContain('bulut hesabında kredi yok');
    expect(block).toContain('Yazıya çevirme (kullanıcıyı duyma): bu bilgisayarda, ekran kartında (Whisper)');
    expect(block).toContain('SESİN: ElevenLabs BULUTUNDAN geliyor');
    expect(block).toContain('ekran kartında ÜRETİLMİYOR');
    expect(block).toContain('Mikrofon açık');
    expect(block).toContain('yalnız uyandırma sözüyle');
    expect(block).toContain('Şu an yapabildiklerin: hatırlatıcı ve yapılacaklar.');
    expect(block).toContain('Sende VAR ama şu an ÇALIŞMAYANLAR (bulut beyni gerekir; şu an yok): yeni yetenek ya da özellik geliştirme (Atölye).');
    expect(block).toContain('Özet: TAMAMEN yerelde DEĞİLSİN. Bu bilgisayarda: beynin, yazıya çevirme. BULUTTA: sesin.');
    expect(block).toContain('Fuber Yönetim: bağlı.');
    expect(block).toContain('Sürüm: Fuber AI 2 2.0.0-demo.1.');
    // Kural blokla birlikte gelir.
    expect(block).toContain('burada yazmayan bir şey sorulursa "bunu bilmiyorum" de');
    expect(block).toContain('onaylama, kibarca düzelt');
  });

  it('blok küçüktür (bağlam bütçesi)', () => {
    expect(renderSelfBlock(sampleSession()).length).toBeLessThan(1400);
  });

  it('ses yerel motora düşmüşse neden söylenir; yerel ses politikaysa bulut anılmaz', () => {
    const fallen = renderSelfBlock(sampleSession({ voice: voice({ tts: { provider: 'elevenlabs', active: 'piper-local', fallbackReason: 'quota' } }) }));
    expect(fallen).toContain('şu an bu bilgisayarda üretiliyor (yerel ses motoru)');
    expect(fallen).toContain('ElevenLabs kotası doldu');
    const local = renderSelfBlock(sampleSession({ voice: voice({ tts: { provider: 'piper-local', active: 'piper-local', fallbackReason: null } }) }));
    expect(local).toContain('SESİN: bu bilgisayarda üretiliyor (yerel ses motoru); bulut kullanılmıyor.');
    expect(local).not.toContain('ElevenLabs');
  });

  it('bulut beyni: bulutta çalıştığını söyler', () => {
    const block = renderSelfBlock(sampleSession({ brain: { provider: 'cloud', reason: 'ok', cause: null, model: 'claude-haiku-5-5', deep: { ok: true, reason: null } } }));
    expect(block).toContain('Beynin: bulutta çalışıyor (Anthropic, claude-haiku-5-5)');
    expect(block).not.toContain('BU BİLGİSAYARDA');
  });

  it('yerel beynin nedeni duruma göre değişir', () => {
    const why = (reason: SelfState['brain']['reason'], cause: SelfState['brain']['cause']) =>
      renderSelfBlock(sampleSession({ brain: { ...sampleSession().brain, reason, cause } }));
    expect(why('no_key', null)).toContain('bulut anahtarı tanımlı değil');
    expect(why('policy_local', null)).toContain('Fuber Yönetim’de yerel model seçili');
    expect(why('private', null)).toContain('Neden bulut değil: GİZLİ KİP açık (kullanıcı Ayarlar’dan açtı); buluta hiçbir şey gönderilmiyor.');
    expect(why('cloud_down', 'network')).toContain('buluta şu an ulaşılamıyor');
    expect(why('cloud_down', 'auth')).toContain('bulut anahtarı kabul edilmedi');
  });

  it('ses hattının durumu bilinmiyorsa uydurulmaz: "bilinmiyor" yazar', () => {
    const block = renderSelfBlock(sampleSession({ voice: null, admin: null }));
    expect(block).toContain('Ses hattının durumu (yazıya çevirme, seslendirme, mikrofon): bilinmiyor.');
    expect(block).not.toContain('SESİN');
    expect(block).not.toContain('Fuber Yönetim');
  });

  it('bilgisayar izinleri: ayar varsa açık/kapalı yazar, yoksa satır hiç yazılmaz', () => {
    expect(renderSelfBlock(sampleSession())).not.toContain('Bilgisayar izinleri');
    const block = renderSelfBlock(sampleSession({ pc: { control: false, read: true } }));
    expect(block).toContain('Bilgisayar izinleri: fareyi/klavyeyi kullanma KAPALI; ekranı ve pencereleri okuma AÇIK.');
    expect(describeSelf(sampleSession({ pc: { control: true, read: true } }))).toContain('fareyi/klavyeyi kullanma AÇIK');
  });

  it('söz asistanın kendisiyle ilgiliyse ilgili satır ipucu olarak döner; ilgisiz sözde ipucu yok', () => {
    const state = sampleSession();
    const where = selfHints(state, 'şu anda tamamen yerelde çalışıyorsun, doğru mu?')[0]!;
    expect(where).toContain('Kendin hakkında: TAMAMEN yerelde DEĞİLSİN. Bu bilgisayarda: beynin, yazıya çevirme. BULUTTA: sesin.');
    expect(where).toContain('"Doğru" deme; "Hayır, tamamen değil" diye başla');
    expect(selfHints(state, 'Senin ses modelin nereden geliyor bu arada şu anda?').join(' ')).toContain('SESİN: ElevenLabs BULUTUNDAN geliyor');
    expect(selfHints(state, 'Sana bir özellik ekle desem kendi kendine ekleyebiliyor musun?')[0]).toContain('"Ekleyemem" deme');
    expect(selfHints(state, 'Benim ekran kartımı görebiliyor musun, modelini, markasını?').join(' ')).toContain('self_status');
    expect(selfHints(state, 'yarın saat onda KDV beyannamesini hatırlat')).toEqual([]);
    expect(selfHints(state, 'Ses modelin baya gelişmiş, şok oldum.')).toEqual([]);
  });

  it('"nerede çalışıyorsun" sorusunun içinde geçen "yeteneklerini geliştireceğim" yetenek ipucunu getirmez (iki ipucu karışıyordu)', () => {
    const state = sampleSession();
    const mixed = selfHints(state, 'Yeteneklerini ben geliştireceğim ama şu anda tamamen yerelde çalışıyorsun, doğru mu?');
    expect(mixed).toHaveLength(1);
    expect(mixed[0]).toContain('TAMAMEN yerelde DEĞİLSİN');
    // Açık yetenek sorusu aynı sözde olsa da yanıtlanır.
    expect(selfHints(state, 'Yerelde çalışırken kendine özellik ekleyebiliyor musun?').join(' ')).toContain('"Ekleyemem" deme');
  });

  it('mikrofon kapalı, sessiz kip ve duraklatma görünür', () => {
    const block = renderSelfBlock(sampleSession({ voice: voice({ micMuted: true, quiet: true, wakePaused: true, bargeIn: 'voice' }) }));
    expect(block).toContain('Mikrofon KAPALI');
    expect(block).toContain('sessiz kip açık');
    expect(block).toContain('uyandırma sözü duraklatılmış');
    expect(block).toContain('kullanıcı konuşarak sözünü kesebilir');
  });

  it('ayrıntılı durum (self_status): derin beyin, kısayollar ve yetenekler satır satır', () => {
    const text = describeSelf(sampleSession());
    expect(text).toContain('Derin beyin (yetenek geliştirme, araştırma, ekrana bakma): şu an kullanılamıyor');
    expect(text).toContain('Kısayollar: konuş Ctrl+Alt+J, mikrofon aç/kapat Ctrl+Alt+K.');
    expect(text).toContain('Yapamaz: yeni yetenek ya da özellik geliştirme (Atölye) (bulut beyni gerekir; şu an yok).');
    expect(text).toContain('SESİN: ElevenLabs BULUTUNDAN geliyor');
  });
});

describe('yetenekler (kayıttan üretilir)', () => {
  const registered = new Set(['reminder_create', 'todo_add', 'memory_save', 'voice_mute_mic', 'skill_build', 'research_start', 'screen_look', 'weather_get', 'web_search']);

  it('yerel beyinde: yerel araçlar var, derin beyin isteyenler neye bağlı olduğuyla yok', () => {
    const list = listCapabilities({ registered, local: true, localCallable: (name) => !['skill_build', 'research_start', 'screen_look'].includes(name), deepOk: false });
    const by = Object.fromEntries(list.map((item) => [item.label, item]));
    expect(by['hatırlatıcı ve yapılacaklar']).toMatchObject({ id: 'group:planner', available: true });
    expect(by['hafıza']).toMatchObject({ available: true });
    expect(by['güncel bilgi']).toMatchObject({ id: 'group:info', available: true });
    expect(by['yeni yetenek ya da özellik geliştirme (Atölye)']).toMatchObject({ id: 'deep:skill_build', available: false, needs: 'bulut beyni gerekir; şu an yok' });
    expect(by['ekrana bakıp yorumlama']).toMatchObject({ available: false });
    expect(by['derin web araştırması']).toMatchObject({ available: false });
    // Kayıtlı olmayan küme hiç anılmaz; yalnız derin araçtan oluşan küme ayrıca anılmaz (araç kendi adıyla anılır).
    expect(by['toplantı modu']).toBeUndefined();
    expect(by['derin araştırma']).toBeUndefined();
  });

  it('bulut beyni varken hepsi kullanılabilir', () => {
    const list = listCapabilities({ registered, local: false, localCallable: () => false, deepOk: true });
    expect(list.every((item) => item.available)).toBe(true);
  });
});

describe('derin beyin durumu (`BrainStatus.deep`)', () => {
  const own = { ok: false, reason: 'Bu iş bulut beyni istiyor; bulut beyni şu an kullanılamıyor.' };

  it('alan varsa oradan okunur: sağlayıcı, neden; henüz yoklanmamışsa "bilinmiyor"; alan yoksa beynin kendi bildiği', () => {
    expect(deepFromStatus({ ok: true, provider: 'claude-code', reason: null }, own)).toEqual({ ok: true, reason: null, provider: 'claude-code', known: true });
    expect(deepFromStatus({ ok: false, provider: null, reason: 'Anthropic hesabında kredi yok. Claude Code bu bilgisayarda kurulu değil.' }, own)).toMatchObject({ ok: false, known: true, reason: 'Anthropic hesabında kredi yok. Claude Code bu bilgisayarda kurulu değil.' });
    // `DEEP_BRAIN_UNKNOWN` biçimi (açılışın ilk anı).
    expect(deepFromStatus({ ok: false, provider: null, reason: null }, own)).toMatchObject({ ok: false, known: false });
    expect(deepFromStatus(undefined, own)).toEqual({ ...own, known: true });
  });

  it('blokta "derin işler var mı, hangi sağlayıcıyla" satırı; Claude Code ile yürüyorsa beyin yerelde olsa da Atölye VAR', () => {
    const withBridge = sampleSession({
      brain: { ...sampleSession().brain, deep: { ok: true, reason: null, provider: 'claude-code', known: true } },
      capabilities: [{ label: 'yeni yetenek ya da özellik geliştirme (Atölye)', available: true, needs: null }],
    });
    const block = renderSelfBlock(withBridge);
    expect(block).toContain('Derin işler (yetenek geliştirme, araştırma, ekrana bakma): ÇALIŞIYOR; bu bilgisayardaki Claude Code ile yürür.');
    expect(block).toContain('Şu an yapabildiklerin: yeni yetenek ya da özellik geliştirme (Atölye).');
    expect(selfHints(withBridge, 'Sana bir özellik ekle desem kendi kendine ekleyebiliyor musun?')[0]).toContain('geliştirebilirsin (bu bilgisayardaki Claude Code ile) (Atölye)');
    const down = sampleSession({ brain: { ...sampleSession().brain, deep: { ok: false, reason: 'Anthropic hesabında kredi yok.', provider: null, known: true } } });
    expect(renderSelfBlock(down)).toContain('Derin işler (yetenek geliştirme, araştırma, ekrana bakma): şu an YOK (Anthropic hesabında kredi yok).');
    expect(selfHints(down, 'kendine özelliği ekleyebiliyor musun?')[0]).toContain('(Anthropic hesabında kredi yok)');
    const unknown = sampleSession({ brain: { ...sampleSession().brain, deep: { ok: false, reason: null, provider: null, known: false } } });
    expect(renderSelfBlock(unknown)).toContain('Derin işler (yetenek geliştirme, araştırma, ekrana bakma): durumu bilinmiyor.');
    expect(describeSelf(unknown)).toContain('durumu bilinmiyor');
    // Sağlayıcı bilgisi olmayan (eski) durumda ayrı satır yazılmaz; blok büyümez.
    expect(renderSelfBlock(sampleSession())).not.toContain('Derin işler');
  });
});

describe('öz-duruma aykırı cümlenin düzeltilmesi', () => {
  it('yalnız ölçülmüş iki yanlış düzeltilir; doğru cümle, soru ve olumsuzlama olduğu gibi kalır', () => {
    const state = sampleSession();
    expect(correctSelfClaim(state, 'Doğru, şu anda tamamen yerelde çalışıyorum.')).toBe('Hayır, tamamen yerelde değilim: sesim bulutta.');
    expect(correctSelfClaim(state, 'Evet, hiçbir bulut yok.')).toBe('Hayır, tamamen yerelde değilim: sesim bulutta.');
    expect(correctSelfClaim(state, 'Sesim ekran kartınızda üretiliyor.')).toBe('Sesim ElevenLabs bulutundan geliyor; bu bilgisayarda üretilmiyor.');
    for (const fine of [
      'Hayır, tamamen yerelde değilim; sesim bulutta.',
      'Beynim bu bilgisayarda çalışıyor, sesim ElevenLabs bulutundan geliyor.',
      'Sesim bu bilgisayarda üretilmiyor.',
      'Tamamen yerelde mi çalışmamı istersiniz?',
      'Hatırlatıcıyı kurdum.',
    ]) {
      expect(correctSelfClaim(state, fine), fine).toBeNull();
    }
    // Her şey gerçekten yereldeyse düzeltilecek bir şey yoktur.
    const local = sampleSession({ voice: voice({ tts: { provider: 'piper-local', active: 'piper-local', fallbackReason: null } }) });
    expect(correctSelfClaim(local, 'Evet, tamamen yerelde çalışıyorum.')).toBeNull();
    expect(correctSelfClaim(local, 'Sesim bu bilgisayarda üretiliyor.')).toBeNull();
  });
});

describe('demo.3 bütünleşmesi: üç dalın ekleri birlikte (beyin sağlayıcısı + sesin üretildiği yer + kipler)', () => {
  const gpuVoice = (patch: Partial<SelfVoiceState> = {}) => voice({ tts: { provider: 'supertonic', active: 'supertonic', device: 'cuda', fallbackReason: null }, ...patch });

  it('beyin OpenRouter’da, ses ekran kartında: ikisi de adıyla söylenir, özet karışık', () => {
    const state = sampleSession({
      brain: { provider: 'cloud', reason: 'ok', cause: null, model: 'moonshotai/kimi-k2', cloudName: 'OpenRouter', deep: { ok: true, reason: null, provider: 'claude-code', known: true } },
      voice: gpuVoice(),
    });
    const block = renderSelfBlock(state);
    expect(block).toContain('Beynin: bulutta çalışıyor (OpenRouter, moonshotai/kimi-k2); internet üzerinden.');
    expect(block).toContain('SESİN: BU BİLGİSAYARIN EKRAN KARTINDA üretiliyor (Supertonic 3, CUDA); bulut kullanılmıyor.');
    expect(block).toContain('Özet: TAMAMEN yerelde DEĞİLSİN. Bu bilgisayarda: yazıya çevirme, sesin. BULUTTA: beynin.');
    expect(block).toContain('Derin işler (yetenek geliştirme, araştırma, ekrana bakma): ÇALIŞIYOR; bu bilgisayardaki Claude Code ile yürür.');
    // Aykırı cümleler: "tamamen yerelde" (beyin bulutta) ve "sesim ElevenLabs'ten" (ses ekran kartında).
    expect(correctSelfClaim(state, 'Evet, tamamen yerelde çalışıyorum.')).toBe('Hayır, tamamen yerelde değilim: beynim bulutta.');
    expect(correctSelfClaim(state, 'Sesim ElevenLabs bulutundan geliyor.')).toBe('Sesim buluttan gelmiyor; bu bilgisayarın ekran kartında üretiliyor.');
    expect(selfHints(state, 'sesin nerede üretiliyor?').join(' ')).toContain('EKRAN KARTINDA üretiliyor (Supertonic 3, CUDA)');
  });

  it('OpenRouter düştü, yerel model yürütüyor, ses ekran kartında: neden sağlayıcının adıyla; her şey yerelde', () => {
    const state = sampleSession({
      brain: { provider: 'local', reason: 'cloud_down', cause: 'billing', model: 'qwen3.5-4b-q4km', cloudName: 'OpenRouter', deep: { ok: false, reason: null } },
      voice: gpuVoice(),
    });
    const block = renderSelfBlock(state);
    expect(block).toContain('Neden bulut değil: OpenRouter hesabında kredi yok.');
    expect(block).toContain('Özet: şu an TAMAMEN bu bilgisayarda çalışıyorsun; buluta hiçbir şey gitmiyor.');
    expect(correctSelfClaim(state, 'Evet, tamamen yerelde çalışıyorum.')).toBeNull();
  });

  it('Gizli kip + ekran kartı sesi: nedeni Gizli kip; ses ekran kartına sığmayıp işlemciye düştüyse o söylenir', () => {
    const state = sampleSession({
      brain: { provider: 'local', reason: 'private', cause: null, model: 'qwen3.5-4b-q4km', cloudName: 'OpenRouter', deep: { ok: false, reason: 'Gizli kipte derin işler yapılmıyor.', provider: null, known: true } },
      voice: gpuVoice({ tts: { provider: 'supertonic', active: 'piper-local', device: 'cpu', fallbackReason: 'gpu_failed' } }),
    });
    const block = renderSelfBlock(state);
    expect(block).toContain('Neden bulut değil: GİZLİ KİP açık');
    expect(block).not.toContain('Fuber Yönetim’de yerel model seçili');
    expect(block).toContain('SESİN: şu an bu bilgisayarın İŞLEMCİSİNDE üretiliyor (Piper); ekran kartında DEĞİL; seçili ses Supertonic 3 (ekran kartı) ama ekran kartında başlatılamadı.');
    expect(block).toContain('Derin işler (yetenek geliştirme, araştırma, ekrana bakma): şu an YOK (Gizli kipte derin işler yapılmıyor).');
    expect(correctSelfClaim(state, 'Sesim ekran kartında üretiliyor.')).toBe('Sesim şu an ekran kartında değil, bu bilgisayarın işlemcisinde üretiliyor (Piper).');
  });

  it('toplantı kipi açıkken bunu ve sonucunu söyler; kapalıyken satıra girmez', () => {
    expect(renderSelfBlock(sampleSession({ voice: gpuVoice({ meeting: true }) }))).toContain('TOPLANTI KİPİ açık (konuşulanlar yazıya dökülüyor; sesli yanıt vermiyorsun, uyandırma sözü kapalı');
    expect(renderSelfBlock(sampleSession({ voice: gpuVoice({ meeting: false }) }))).not.toContain('TOPLANTI');
    expect(renderSelfBlock(sampleSession({ voice: gpuVoice() }))).not.toContain('TOPLANTI');
  });

  it('yetenekler: takip işleri, toplantı modu, kendi tarayıcısı ve sesle ayar birlikte listelenir (küme sırasıyla; derin işler sonda)', () => {
    const registered = new Set(['watch_start', 'watch_list', 'meeting_start', 'meeting_summary', 'jbrowser_open', 'settings_set', 'app_navigate', 'skill_build']);
    const labels = listCapabilities({ registered, local: true, localCallable: () => true, deepOk: false }).map((item) => `${item.available ? '+' : '-'}${item.label}`);
    expect(labels).toEqual([
      '+takip işleri (İşler)',
      '+toplantı modu',
      '+kendi tarayıcın (ayrı pencere)',
      '+ayarlar, sınamalar ve sayfalar',
      '-yeni yetenek ya da özellik geliştirme (Atölye)',
    ]);
  });
});

describe('demo.3 bütünleşmesi: Claude Code konuşan beyin + ekran kartı sesi', () => {
  it('beyin Claude Code (abonelik), ses Supertonic (ekran kartı): ikisi birlikte ve özet karışık', () => {
    const state = sampleSession({
      brain: { provider: 'cloud', reason: 'ok', cause: null, model: 'sonnet', cloudName: 'Claude Code', claudeCode: true, deep: { ok: true, reason: null, provider: 'claude-code', known: true } },
      voice: voice({ tts: { provider: 'supertonic', active: 'supertonic', device: 'cuda', fallbackReason: null } }),
    });
    const block = renderSelfBlock(state);
    expect(block).toContain('Beynin: CLAUDE ile çalışıyor (bu bilgisayardaki Claude Code üzerinden, kullanıcının Claude aboneliğiyle; model sonnet)');
    expect(block).toContain('SESİN: BU BİLGİSAYARIN EKRAN KARTINDA üretiliyor (Supertonic 3, CUDA); bulut kullanılmıyor.');
    // Claude Code bu bilgisayarda çalışsa da yanıt Anthropic bulutunda üretilir: "tamamen yerelde" denemez.
    expect(block).toContain('Özet: TAMAMEN yerelde DEĞİLSİN. Bu bilgisayarda: yazıya çevirme, sesin. BULUTTA: beynin.');
    expect(correctSelfClaim(state, 'Evet, tamamen yerelde çalışıyorum.')).toBe('Hayır, tamamen yerelde değilim: beynim bulutta.');
    expect(correctSelfClaim(state, 'Sesim ElevenLabs bulutundan geliyor.')).toBe('Sesim buluttan gelmiyor; bu bilgisayarın ekran kartında üretiliyor.');
  });

  it('Gizli kipte (asıl beyin Claude Code olsa da) neden Gizli kiptir', () => {
    const state = sampleSession({
      brain: { provider: 'local', reason: 'private', cause: null, model: 'qwen3.5-4b-q4km', cloudName: 'Claude Code', claudeCode: true, deep: { ok: false, reason: 'Gizli kipte derin işler yapılmıyor.', provider: null, known: true } },
      voice: voice({ tts: { provider: 'supertonic', active: 'supertonic', device: 'cuda', fallbackReason: null } }),
    });
    const block = renderSelfBlock(state);
    expect(block).toContain('Neden bulut değil: GİZLİ KİP açık');
    expect(block).toContain('Özet: şu an TAMAMEN bu bilgisayarda çalışıyorsun; buluta hiçbir şey gitmiyor.');
  });
});
