import { describe, expect, it } from 'vitest';
import { ElevenLabsError, type ElevenFailure } from './elevenlabs';
import { cooldownFor, speakableText, spokenForm, stripTags, TtsRouter, understandsTags, type CloudSynth, type FallbackInfo, type LocalSynth } from './tts-router';

const pcm = (samples: number) => new Int16Array(samples).fill(1000);

function setup(options: { local?: boolean } = {}) {
  let now = new Date(2026, 10, 17, 3, 0, 0).getTime();
  const calls: string[] = [];
  const fallbacks: FallbackInfo[] = [];
  let recovered = 0;
  /** Bulutun sıradaki davranışı: `null` başarı, neden hata; `partial` verilirse ses başladıktan sonra kopar. */
  const plan: Array<{ fail: ElevenFailure; partial?: number; status?: number } | null> = [];

  const local: LocalSynth = {
    sampleRate: 22_050,
    async speak(text, onChunk) {
      calls.push(`local:${text}`);
      onChunk({ pcm: pcm(2205), sampleRate: 22_050 });
      return { samples: 2205, firstChunkMs: 40 };
    },
    cancel: () => void calls.push('local.cancel'),
  };
  const cloud: CloudSynth = {
    sampleRate: 24_000,
    prewarm: () => void calls.push('cloud.prewarm'),
    async speak(text, onChunk) {
      calls.push(`cloud:${text}`);
      const step = plan.shift() ?? null;
      if (step) {
        if (step.partial) onChunk({ pcm: pcm(step.partial), sampleRate: 24_000 });
        throw new ElevenLabsError(step.fail, step.status ?? null, step.partial ?? 0, `sahte ${step.fail}`);
      }
      onChunk({ pcm: pcm(2400), sampleRate: 24_000 });
      return { samples: 2400, firstChunkMs: 170, chars: text.length, cancelled: false };
    },
    cancel: () => void calls.push('cloud.cancel'),
    stop: () => void calls.push('cloud.stop'),
  };
  const router = new TtsRouter({
    local: options.local === false ? null : local,
    log: () => {},
    onFallback: (info) => fallbacks.push(info),
    onRecovered: () => void recovered++,
    now: () => now,
  });
  return {
    router,
    cloud,
    calls,
    fallbacks,
    plan,
    recovered: () => recovered,
    advance: (ms: number) => void (now += ms),
    now: () => now,
    speak: (text: string, forceLocal = false) => router.speak(text, () => {}, forceLocal),
  };
}

describe('seslendirme yönlendiricisi', () => {
  it('bulut yokken yerel sesle okur', async () => {
    const h = setup();
    const result = await h.speak('Merhaba.');
    expect(result).toMatchObject({ engine: 'piper-local', samples: 2205, sampleRate: 22_050, chars: 0, fallback: null });
    expect(h.router.active()).toBe('piper-local');
  });

  it('bulut takılıyken cümle buluttan gelir ve karakter sayılır', async () => {
    const h = setup();
    h.router.setCloud(h.cloud, 'eleven_flash_v2_5');
    const result = await h.speak('Merhaba efendim.');
    expect(result).toMatchObject({ engine: 'elevenlabs', samples: 2400, sampleRate: 24_000, chars: 16, firstChunkMs: 170, fallback: null });
    expect(h.calls).toEqual(['cloud:Merhaba efendim.']);
    expect(h.fallbacks).toHaveLength(0);
  });

  it('ses başlamadan hata: AYNI cümle yerel sesle okunur, neden bildirilir, bekleme süresince buluta gidilmez', async () => {
    const h = setup();
    h.router.setCloud(h.cloud, 'eleven_flash_v2_5');
    h.plan.push({ fail: 'payment', status: 402 });
    const first = await h.speak('Birinci cümle.');
    expect(first).toMatchObject({ engine: 'piper-local', samples: 2205, fallback: 'payment' });
    expect(h.calls).toEqual(['cloud:Birinci cümle.', 'local:Birinci cümle.']);
    expect(h.fallbacks).toEqual([{ reason: 'payment', status: 402, until: h.now() + 5 * 60_000, detail: 'sahte payment' }]);
    expect(h.router.active()).toBe('piper-local');
    expect(h.router.fallback()?.reason).toBe('payment');

    const second = await h.speak('İkinci cümle.');
    expect(second).toMatchObject({ engine: 'piper-local', fallback: null });
    expect(h.calls.filter((call) => call.startsWith('cloud:'))).toHaveLength(1);
    expect(h.fallbacks).toHaveLength(1);

    // Süre dolunca yeniden denenir; başarı geri düşme kaydını siler.
    h.advance(5 * 60_000 + 1);
    expect(h.router.active()).toBe('elevenlabs');
    const third = await h.speak('Üçüncü cümle.');
    expect(third.engine).toBe('elevenlabs');
    expect(h.recovered()).toBe(1);
    expect(h.router.fallback()).toBeNull();
  });

  it('süre dolduktan sonra da başarısızsa yeniden yerel sese düşer ve yeniden bildirir', async () => {
    const h = setup();
    h.router.setCloud(h.cloud, 'eleven_flash_v2_5');
    h.plan.push({ fail: 'network' }, { fail: 'network' });
    await h.speak('Bir.');
    h.advance(2 * 60_000 + 1);
    const again = await h.speak('İki.');
    expect(again).toMatchObject({ engine: 'piper-local', fallback: 'network' });
    expect(h.fallbacks).toHaveLength(2);
  });

  it('ses başladıktan sonra kopma: çalınan kısım kalır, sonraki cümleler yerel sese geçer', async () => {
    const h = setup();
    h.router.setCloud(h.cloud, 'eleven_flash_v2_5');
    h.plan.push({ fail: 'interrupted', partial: 4800 });
    const broken = await h.speak('Yarıda kalan cümle.');
    expect(broken).toMatchObject({ engine: 'elevenlabs', samples: 4800, fallback: 'interrupted', chars: 19 });
    // Cümle baştan okunmaz (yineleme olur).
    expect(h.calls).toEqual(['cloud:Yarıda kalan cümle.']);
    const next = await h.speak('Sonraki cümle.');
    expect(next.engine).toBe('piper-local');
    expect(h.calls.at(-1)).toBe('local:Sonraki cümle.');
  });

  it('bekleme süreleri: kota gün sonuna kadar, anahtar yoksa ayar değişene kadar', () => {
    const now = new Date(2026, 10, 17, 3, 0, 0).getTime();
    expect(cooldownFor('quota', now)).toBe(new Date(2026, 10, 18, 0, 0, 0).getTime());
    expect(cooldownFor('no_key', now)).toBeNull();
    expect(cooldownFor('budget', now)).toBeNull();
    expect(cooldownFor('rate_limit', now)).toBe(now + 60_000);
    expect(cooldownFor('timeout', now)).toBe(now + 120_000);
    expect(cooldownFor('unauthorized', now)).toBe(now + 300_000);
  });

  it('anahtar yokken ayar değişene kadar yerel ses; yeni ayar bekleme süresini sıfırlar', async () => {
    const h = setup();
    h.router.setCloud(h.cloud, 'eleven_flash_v2_5');
    h.plan.push({ fail: 'no_key' });
    await h.speak('Bir.');
    h.advance(24 * 3600_000);
    expect(h.router.active()).toBe('piper-local');
    expect(h.fallbacks[0]?.until).toBeNull();
    h.router.setCloud(h.cloud, 'eleven_flash_v2_5');
    expect(h.router.active()).toBe('elevenlabs');
    expect((await h.speak('İki.')).engine).toBe('elevenlabs');
  });

  it('yerel ses yokken bulut da başarısızsa fırlatır (çağıran yazıyla gösterir)', async () => {
    const h = setup({ local: false });
    h.router.setCloud(h.cloud, 'eleven_flash_v2_5');
    h.plan.push({ fail: 'server', status: 500 });
    await expect(h.speak('Bir.')).rejects.toThrow('yerel ses');
    expect(h.fallbacks).toHaveLength(1);
  });

  it('yerel zorunlu istek buluta gitmez; yerel ses yoksa sessiz kalmamak için gider', async () => {
    const h = setup();
    h.router.setCloud(h.cloud, 'eleven_flash_v2_5');
    expect((await h.speak('Sınama cümlesi.', true)).engine).toBe('piper-local');
    expect(h.calls).toEqual(['local:Sınama cümlesi.']);
    const cloudOnly = setup({ local: false });
    cloudOnly.router.setCloud(cloudOnly.cloud, 'eleven_flash_v2_5');
    expect((await cloudOnly.speak('Sınama cümlesi.', true)).engine).toBe('elevenlabs');
  });

  it('köşeli duygu etiketleri yalnız eleven_v3 modelinde geçer; diğerlerinde ve yerel seste ayıklanır', async () => {
    const h = setup();
    h.router.setCloud(h.cloud, 'eleven_flash_v2_5');
    await h.speak('[laughs] Çok iyi! [sighs]');
    expect(h.calls.at(-1)).toBe('cloud:Çok iyi!');
    h.router.setCloud(h.cloud, 'eleven_v3');
    await h.speak('[laughs] Çok iyi!');
    expect(h.calls.at(-1)).toBe('cloud:[laughs] Çok iyi!');
    // Yalnız etiketten oluşan "cümle" hiçbir motora gitmez.
    const before = h.calls.length;
    expect((await h.speak('[laughs]')).samples).toBe(0);
    expect(h.calls).toHaveLength(before);
    h.router.setCloud(null);
    await h.speak('[whispers] Sessizce söylüyorum.');
    expect(h.calls.at(-1)).toBe('local:Sessizce söylüyorum.');
  });

  it('ısıtma yalnız bulut kullanılabilirken yapılır; iptal iki motora da gider', async () => {
    const h = setup();
    h.router.prewarm();
    expect(h.calls).toEqual([]);
    h.router.setCloud(h.cloud, 'eleven_flash_v2_5');
    h.router.prewarm();
    expect(h.calls).toEqual(['cloud.prewarm']);
    h.plan.push({ fail: 'unauthorized', status: 401 });
    await h.speak('Bir.');
    h.calls.length = 0;
    h.router.prewarm();
    expect(h.calls).toEqual([]);
    h.router.cancel();
    expect(h.calls).toEqual(['cloud.cancel', 'local.cancel']);
  });
});

describe('seslendirilecek metin', () => {
  it('etiketleri ayıklar ya da korur', () => {
    expect(stripTags('[laughs] Merhaba [sighs] efendim')).toBe('Merhaba efendim');
    expect(speakableText('[laughs] **Tamam** efendim')).toBe('Tamam efendim');
    expect(speakableText('[laughs] **Tamam** efendim', true)).toBe('[laughs] Tamam efendim');
    expect(speakableText('[laughs]', true)).toBe('');
    // Köşeli ayraç içindeki uzun metin etiket değildir.
    const long = '[bu köşeli ayraç içindeki uzun bir açıklamadır ve etiket sayılmaz] tamam';
    expect(speakableText(long)).toBe(long);
    expect(understandsTags('eleven_v3')).toBe(true);
    expect(understandsTags('eleven_flash_v2_5')).toBe(false);
  });

  it('okuma düzeltici iki motorda da uygulanır: motora rakam değil okunuş gider', async () => {
    const h = setup();
    h.router.setCloud(h.cloud, 'eleven_flash_v2_5');
    await h.speak("Bugün akşam 20:00'de çalacak.");
    h.plan.push({ fail: 'timeout' });
    await h.speak("Bugün 16 Kasım 2026, saat 12:34'te buradayım; %20 indirim var.");
    await h.speak('**Toplam 15.000 TL**', true);
    expect(h.calls.filter((call) => /^(cloud|local):/.test(call))).toEqual([
      'cloud:Bugün akşam yirmide çalacak.',
      'cloud:Bugün on altı Kasım iki bin yirmi altı, saat on iki otuz dörtte buradayım, yüzde yirmi indirim var.',
      'local:Bugün on altı Kasım iki bin yirmi altı, saat on iki otuz dörtte buradayım, yüzde yirmi indirim var.',
      'local:Toplam on beş bin lira',
    ]);
  });

  it('okuma düzeltici: etiketler korunur, İngilizce konuşmada uygulanmaz, kısayol tuşları ayrı okunur', () => {
    expect(spokenForm("[laughs] Saat 20:00'de!", { keepTags: true })).toBe('[laughs] Saat yirmide!');
    expect(spokenForm("[laughs] Saat 20:00'de!")).toBe('Saat yirmide!');
    expect(spokenForm('It is 20:00 now.', { language: 'en' })).toBe('It is 20:00 now.');
    expect(spokenForm('Mikrofonu kapattım; Ctrl+Alt+M ile açarsınız.')).toBe('Mikrofonu kapattım, Kontrol Alt M ile açarsınız.');
    expect(spokenForm('**')).toBe('');
    // Sıra: önce ifade etiketi ayıklanır, sonra okuma düzeltici çalışır (etiket harf harf okunmaz, sayı okunuşu bozulmaz).
    expect(spokenForm('<laugh> Yerel model Qwen3.5-4B kullanılıyor.')).toBe('Yerel model Qwen üç nokta beş dört be kullanılıyor.');
    expect(spokenForm('Bellek 512 MiB <sigh>.')).toBe('Bellek beş yüz on iki mebibayt.');
    expect(spokenForm("[laughs] Kur 3.50'ye çıktı.", { keepTags: true })).toBe('[laughs] Kur üç nokta elliye çıktı.');
  });

  it('dil değişince okuma düzeltici kapanır', async () => {
    const h = setup();
    h.router.setLanguage('en');
    await h.speak('Meeting at 20:00.');
    expect(h.calls).toContain('local:Meeting at 20:00.');
  });

  it('ifade etiketleri: destekleyen motorda kendi yazımına çevrilir, desteklemeyende sessizce atılır', async () => {
    const h = setup();
    h.router.setCloud(h.cloud, 'eleven_v3');
    await h.speak('<laugh> Bu çok komik! *güler* (iç çeker) Neyse.');
    h.router.setCloud(h.cloud, 'eleven_flash_v2_5');
    await h.speak('<laugh> Bu çok komik! *güler* (iç çeker) Neyse.');
    await h.speak('<laughs> Bu çok komik! [sighs] <breath> Neyse.', true);
    expect(h.calls.filter((call) => /^(cloud|local):/.test(call))).toEqual([
      'cloud:[laughs] Bu çok komik! [laughs] [sighs] Neyse.',
      'cloud:Bu çok komik! Neyse.',
      'local:Bu çok komik! Neyse.',
    ]);
  });
});
