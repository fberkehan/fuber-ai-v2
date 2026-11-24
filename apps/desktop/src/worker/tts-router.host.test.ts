import { describe, expect, it } from 'vitest';
import { ElevenLabsError } from './elevenlabs';
import { HostSynth, type HostPort } from './host-synth';
import { speakableText, spokenForm, TtsRouter, type CloudSynth, type HostSynthLike, type LocalSynth } from './tts-router';

const pcm = (samples: number) => new Int16Array(samples).fill(1000);

/** Ekran kartı konağı + Piper + (isteğe bağlı) bulut olan bir yönlendirici. */
function setup(options: { piper?: boolean } = {}) {
  const calls: string[] = [];
  const hostFailures: string[] = [];
  /** Konağın sıradaki davranışı: `null` başarı; `fail` hata, `partial` verilirse ses başladıktan sonra. */
  const hostPlan: Array<{ fail: string; partial?: number } | null> = [];
  const local: LocalSynth = {
    sampleRate: 22_050,
    async speak(text, onChunk) {
      calls.push(`piper:${text}`);
      onChunk({ pcm: pcm(2205), sampleRate: 22_050 });
      return { samples: 2205, firstChunkMs: 60 };
    },
    cancel: () => void calls.push('piper.cancel'),
  };
  const makeHost = (): HostSynthLike & { usable: boolean } => ({
    usable: true,
    info: { engine: 'supertonic', voice: 'M4', device: 'cuda', sampleRate: 44_100 },
    async speak(text, onChunk, language, override) {
      calls.push(`host:${override?.engine ?? 'supertonic'}/${override?.voice ?? 'M4'}/${language}:${text}`);
      const step = hostPlan.shift() ?? null;
      const rate = override?.engine === 'ema-lightning' ? 48_000 : 44_100;
      if (step) {
        if (step.partial) onChunk({ pcm: pcm(step.partial), sampleRate: rate });
        throw Object.assign(new Error(step.fail), { samples: step.partial ?? 0 });
      }
      onChunk({ pcm: pcm(4410), sampleRate: rate });
      return { samples: 4410, firstChunkMs: 90 };
    },
    cancel: () => void calls.push('host.cancel'),
  });
  const cloud: CloudSynth = {
    sampleRate: 24_000,
    prewarm: () => void calls.push('cloud.prewarm'),
    async speak(text) {
      calls.push(`cloud:${text}`);
      throw new ElevenLabsError('quota', 401, 0, 'kota');
    },
    cancel: () => {},
    stop: () => {},
  };
  const router = new TtsRouter({
    local: options.piper === false ? null : local,
    log: () => {},
    onFallback: () => {},
    onRecovered: () => {},
    onHostFailure: (message) => hostFailures.push(message),
  });
  const host = makeHost();
  router.setEngine('supertonic');
  router.setHost(host);
  return { router, host, makeHost, cloud, calls, hostPlan, hostFailures, speak: (text: string, options = {}) => router.speak(text, () => {}, options) };
}

describe('yönlendirici: ekran kartı sesi zinciri', () => {
  it('seçili motor ekran kartındaysa cümle konaktan gelir; motor, cihaz ve örnekleme hızı bildirilir', async () => {
    const h = setup();
    const result = await h.speak('Merhaba.');
    expect(result).toMatchObject({ engine: 'supertonic', device: 'cuda', samples: 4410, sampleRate: 44_100, chars: 0, fallback: null, hostError: null });
    expect(h.calls).toEqual(['host:supertonic/M4/tr:Merhaba.']);
    expect(h.router.active()).toBe('supertonic');
  });

  it('konak ses başlamadan hata verirse AYNI cümle Piper ile okunur; konak yeni uç gelene dek atlanır', async () => {
    const h = setup();
    h.hostPlan.push({ fail: 'ses konağı yanıt vermedi' });
    const first = await h.speak('Bir.');
    expect(first).toMatchObject({ engine: 'piper-local', device: 'cpu', hostError: 'ses konağı yanıt vermedi' });
    expect(h.hostFailures).toEqual(['ses konağı yanıt vermedi']);
    expect(h.router.active()).toBe('piper-local');
    const second = await h.speak('İki.');
    expect(second).toMatchObject({ engine: 'piper-local', hostError: null });
    expect(h.calls).toEqual(['host:supertonic/M4/tr:Bir.', 'piper:Bir.', 'piper:İki.']);
    // Ana süreç konağı yeniden başlattı ve yeni ucu verdi: yeniden konaktan.
    h.router.setHost(h.makeHost());
    expect((await h.speak('Üç.')).engine).toBe('supertonic');
  });

  it('ses başladıktan sonra kopma: çalınan kısım kalır (yinelenmez), sonraki cümle Piper ile', async () => {
    const h = setup();
    h.hostPlan.push({ fail: 'bağlantı koptu', partial: 1000 });
    const broken = await h.speak('Uzun bir cümle.');
    expect(broken).toMatchObject({ engine: 'supertonic', samples: 1000, hostError: 'bağlantı koptu' });
    expect(h.calls).toEqual(['host:supertonic/M4/tr:Uzun bir cümle.']);
    expect((await h.speak('Sonraki.')).engine).toBe('piper-local');
  });

  it('Piper seçiliyken konak takılı olsa da kullanılmaz', async () => {
    const h = setup();
    h.router.setEngine('piper-local');
    expect((await h.speak('Merhaba.')).engine).toBe('piper-local');
    expect(h.calls).toEqual(['piper:Merhaba.']);
  });

  it('bulut seçiliyken bulut düşerse yerel yedek ekran kartı sesidir; o da yoksa Piper', async () => {
    const h = setup();
    h.router.setEngine('elevenlabs');
    h.router.setCloud(h.cloud, 'eleven_flash_v2_5');
    const result = await h.speak('Merhaba.');
    expect(result).toMatchObject({ engine: 'supertonic', device: 'cuda', fallback: 'quota' });
    h.router.setHost(null);
    // Kota bekleme süresinde buluta gidilmez; konak da yok: Piper.
    expect(await h.speak('Yine.')).toMatchObject({ engine: 'piper-local', fallback: null });
    expect(h.calls).toEqual(['cloud:Merhaba.', 'host:supertonic/M4/tr:Merhaba.', 'piper:Yine.']);
  });

  it('bulut seçili ama anahtar yok (bulut takılmamış): bildirim olmadan yerel ses', async () => {
    const h = setup();
    h.router.setEngine('elevenlabs');
    expect(await h.speak('Merhaba.')).toMatchObject({ engine: 'supertonic', fallback: null });
  });

  it('Piper yokken de konak konuşur; ikisi de yoksa fırlatır', async () => {
    const h = setup({ piper: false });
    expect(h.router.available()).toBe(true);
    expect((await h.speak('Merhaba.')).engine).toBe('supertonic');
    h.router.setHost(null);
    expect(h.router.available()).toBe(false);
    await expect(h.speak('Merhaba.')).rejects.toThrow(/yerel ses/);
  });

  it('"Dinle": adıyla istenen motor ve ses okunur; o motor yoksa başka motora DÜŞÜLMEZ', async () => {
    const h = setup();
    const ema = await h.speak('Örnek.', { engine: 'ema-lightning', voice: 'ema' });
    expect(ema).toMatchObject({ engine: 'ema-lightning', sampleRate: 48_000 });
    const voice = await h.speak('Örnek.', { engine: 'supertonic', voice: 'F2' });
    expect(voice.engine).toBe('supertonic');
    expect((await h.speak('Örnek.', { engine: 'piper-local' })).engine).toBe('piper-local');
    expect(h.calls).toEqual(['host:ema-lightning/ema/tr:Örnek.', 'host:supertonic/F2/tr:Örnek.', 'piper:Örnek.']);
    h.hostPlan.push({ fail: 'model yüklenemedi' });
    await expect(h.speak('Örnek.', { engine: 'ema-lightning' })).rejects.toThrow('model yüklenemedi');
    h.router.setHost(null);
    await expect(h.speak('Örnek.', { engine: 'supertonic', voice: 'M1' })).rejects.toThrow(/hazır değil/);
    await expect(h.speak('Örnek.', { engine: 'elevenlabs' })).rejects.toThrow(/bulut/);
    // Olağan cümle yine zincirle okunur.
    expect((await h.speak('Olağan.')).engine).toBe('piper-local');
  });

  it('iptal konağa da gider', () => {
    const h = setup();
    h.router.cancel();
    expect(h.calls).toEqual(['host.cancel', 'piper.cancel']);
  });

  it('dil İngilizceyse konağa İngilizce diye verilir ve okuma düzeltici uygulanmaz', async () => {
    const h = setup();
    h.router.setLanguage('en');
    await h.speak('Meeting at 14:30.');
    expect(h.calls).toEqual(['host:supertonic/M4/en:Meeting at 14:30.']);
  });
});

/** Özel kullanım alanı (yönlendiricinin etiket yer tutucuları buradandır); kod noktasıyla yazılır. */
const PRIVATE_USE = new RegExp(`[${String.fromCharCode(0xe000)}-${String.fromCharCode(0xf8ff)}]`);

describe('Supertonic için metin: etiketler ve okuma düzeltici', () => {
  it('<throatclear> korunur; öteki etiketler ve işaretler atılır, ">" silinirken etiket bozulmaz', () => {
    expect(speakableText('<throatclear> Günaydın efendim.', 'supertonic')).toBe('<throatclear> Günaydın efendim.');
    expect(speakableText('Günaydın <laugh> efendim, <sigh> başlayalım.', 'supertonic')).toBe('Günaydın efendim, başlayalım.');
    expect(speakableText('**Önemli** > not: [öksürür] hazır mısın?', 'supertonic')).toBe('Önemli not: <throatclear> hazır mısın?');
    expect(speakableText('*öksürür* Tamam.', 'supertonic')).toBe('<throatclear> Tamam.');
    // Başka motorlarda aynı etiket atılır; yalnız etiketten oluşan metin okunmaz.
    expect(speakableText('<throatclear> Günaydın.', 'none')).toBe('Günaydın.');
    expect(speakableText('<throatclear>', 'supertonic')).toBe('');
    expect(speakableText('a > b', 'supertonic')).toBe('a b');
  });

  // Ölçüm (17 Kas 2026): Piper "Supertonic → Piper." metninde erişim ihlaliyle çöküyor; cümle hiç okunmuyor.
  it('oklar ve benzeri simgeler motora gitmez; yerlerinde kısa bir duraksama kalır', () => {
    const arrow = String.fromCharCode(0x2192);
    const out = spokenForm(`Geçiş: Supertonic ${arrow} Piper.`, { language: 'tr' });
    expect(out).toBe('Geçiş: Supertonic, Piper.');
    for (const code of [0x2190, 0x21d2, 0x2194, 0x25b6, 0x2713, 0x2605, 0x2b06, 0x2500]) {
      const text = spokenForm(`Önce bu ${String.fromCharCode(code)} sonra şu.`, { language: 'tr' });
      expect(text.includes(String.fromCharCode(code)), code.toString(16)).toBe(false);
      expect(text).toMatch(/^Önce bu, sonra şu\.$/);
    }
    expect(speakableText(`${arrow}`, 'none')).toBe('');
    // İngilizce yolda (okuma düzeltici yok) da aynı.
    expect(spokenForm(`Step one ${arrow} step two.`, { language: 'en' })).toBe('Step one, step two.');
  });

  it('sayı, saat ve para okunuşa çevrilir; etiket okuma düzelticiden de sağ çıkar', () => {
    expect(spokenForm("Toplantı 14:30'da.", { tags: 'supertonic' })).toBe('Toplantı on dört otuzda.');
    expect(spokenForm("<throatclear> Saat 20:00'de 3 kişi geliyor.", { tags: 'supertonic' })).toBe('<throatclear> Saat yirmide üç kişi geliyor.');
    const money = spokenForm('Fatura 1.250 TL, KDV %20.', { tags: 'supertonic' });
    expect(money).toContain('bin iki yüz elli');
    expect(money).toContain('yüzde yirmi');
    expect(money).not.toMatch(/\d/);
    // Yer tutucu hiçbir koşulda metinde kalmaz.
    for (const text of ['<throatclear> 5 < 7 mi?', '<throatclear><throatclear> Tamam 2 kez.', 'x <throatclear>']) {
      expect(PRIVATE_USE.test(spokenForm(text, { tags: 'supertonic' })), text).toBe(false);
    }
    expect(spokenForm('<throatclear> Tamam.', { tags: 'supertonic', language: 'en' })).toBe('<throatclear> Tamam.');
  });

  it('yönlendirici: Türkçe cümlede etiket Supertonic\'e GİTMEZ (sözcük olarak okunuyor); Piper cümlesinde de atılır', async () => {
    const h = setup();
    await h.speak('<throatclear> Saat 9:00.');
    h.router.setEngine('piper-local');
    await h.speak('<throatclear> Saat 9:00.');
    expect(h.calls).toEqual(['host:supertonic/M4/tr:Saat dokuz.', 'piper:Saat dokuz.']);
  });

  it('yönlendirici: İngilizce konuşulurken etiket yalnız ölçülmüş sesle geçer (M2 evet, M4 hayır; Dinle sesi de sayılır)', async () => {
    const h = setup();
    h.router.setLanguage('en');
    await h.speak('<throatclear> Good evening.');
    h.host.info.voice = 'M2';
    await h.speak('<throatclear> Good evening.');
    await h.speak('<laugh> Good evening.');
    // "Dinle": adıyla istenen ses (F1) ölçülmüş; yüklü ses M2 olsa da karar istenen sese göre.
    await h.speak('<throatclear> Good evening.', { engine: 'supertonic', voice: 'F4' });
    await h.speak('<throatclear> Good evening.', { engine: 'supertonic', voice: 'F1' });
    expect(h.calls).toEqual([
      'host:supertonic/M4/en:Good evening.',
      'host:supertonic/M4/en:<throatclear> Good evening.',
      'host:supertonic/M4/en:Good evening.',
      'host:supertonic/F4/en:Good evening.',
      'host:supertonic/F1/en:<throatclear> Good evening.',
    ]);
  });
});

/** Sahte port: konağın yanıtlarını sınama yazar. */
function fakePort() {
  const sent: unknown[] = [];
  let onMessage: (event: { data: unknown }) => void = () => {};
  let onClose: () => void = () => {};
  const port: HostPort = {
    on(event: string, listener: never) {
      if (event === 'message') onMessage = listener;
      else onClose = listener;
      return port;
    },
    postMessage: (message) => void sent.push(message),
    start: () => {},
    close: () => {},
  };
  return { port, sent, reply: (data: unknown) => onMessage({ data }), drop: () => onClose() };
}

describe('ses konağının işçideki ucu', () => {
  const info = { engine: 'supertonic', voice: 'M4', device: 'cuda', sampleRate: 44_100 } as const;

  it('cümleyi yollar, parçaları sırayla verir, bitince örnek sayısını döndürür', async () => {
    const p = fakePort();
    const synth = new HostSynth(p.port, { ...info });
    const chunks: number[] = [];
    const done = synth.speak('Merhaba.', (chunk) => chunks.push(chunk.pcm.length), 'tr');
    expect(p.sent).toEqual([{ type: 'speak', id: 1, engine: 'supertonic', voice: 'M4', text: 'Merhaba.', language: 'tr' }]);
    p.reply({ type: 'chunk', id: 1, pcm: pcm(100), sampleRate: 44_100 });
    p.reply({ type: 'chunk', id: 1, pcm: pcm(50), sampleRate: 44_100 });
    p.reply({ type: 'done', id: 1, samples: 150, firstChunkMs: 80, cancelled: false });
    expect(await done).toEqual({ samples: 150, firstChunkMs: 80 });
    expect(chunks).toEqual([100, 50]);
  });

  it('başka motor ve ses istenebilir ("Dinle"); bilgi güncellenince sonraki cümle yeni sesle gider', () => {
    const p = fakePort();
    const synth = new HostSynth(p.port, { ...info });
    void synth.speak('a', () => {}, 'tr', { engine: 'ema-lightning', voice: 'ema' }).catch(() => {});
    synth.info = { ...info, voice: 'F1' };
    void synth.speak('b', () => {}).catch(() => {});
    expect(p.sent.map((message) => (message as { engine: string; voice: string }).engine + '/' + (message as { voice: string }).voice)).toEqual(['ema-lightning/ema', 'supertonic/F1']);
    synth.close();
  });

  it('konak hata döndürürse ve port koparsa iş reddedilir; kopan uç kullanılamaz', async () => {
    const p = fakePort();
    const synth = new HostSynth(p.port, { ...info });
    const failing = synth.speak('a', () => {});
    p.reply({ type: 'error', id: 1, message: 'model hatası' });
    await expect(failing).rejects.toThrow('model hatası');
    const partial = synth.speak('b', () => {});
    p.reply({ type: 'chunk', id: 2, pcm: pcm(70), sampleRate: 44_100 });
    p.drop();
    await expect(partial).rejects.toMatchObject({ message: 'ses konağıyla bağlantı koptu', samples: 70 });
    expect(synth.usable).toBe(false);
    await expect(synth.speak('c', () => {})).rejects.toThrow(/bağlı değil/);
  });

  it('ilk parça süresinde gelmezse reddeder ve konağa iptal yollar', async () => {
    const p = fakePort();
    const synth = new HostSynth(p.port, { ...info }, { firstChunkTimeoutMs: 20 });
    await expect(synth.speak('a', () => {})).rejects.toThrow('ses konağı yanıt vermedi');
    expect(p.sent.at(-1)).toEqual({ type: 'cancel' });
    expect(synth.usable).toBe(true);
  });

  it('iptal: bekleyen işler "üretilmedi" diye çözülür, konağa iptal gider, geç gelen parça yok sayılır', async () => {
    const p = fakePort();
    const synth = new HostSynth(p.port, { ...info });
    const chunks: number[] = [];
    const job = synth.speak('a', (chunk) => chunks.push(chunk.pcm.length));
    synth.cancel();
    expect(await job).toEqual({ samples: 0, firstChunkMs: null });
    p.reply({ type: 'chunk', id: 1, pcm: pcm(100), sampleRate: 44_100 });
    p.reply({ type: 'done', id: 1, samples: 0, firstChunkMs: null, cancelled: true });
    expect(chunks).toEqual([]);
    expect(p.sent.at(-1)).toEqual({ type: 'cancel' });
  });
});
