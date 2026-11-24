import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, DEFAULT_TTS_ENGINE, defaultSettings, TTS_ENGINES } from '@fuber/shared';
import { resolveTtsSelection } from '../../voice/tts-settings';
import { describeSetting, listSpokenSettings, parseMinutes, parseOnOff, parseTimes, planSet, resolveSetting, routeSpokenSetting, useTtsCatalog } from './local-settings';

const base = (patch: Record<string, unknown> = {}) => ({ ...defaultSettings('C:/tmp'), ...patch }) as unknown as Record<string, unknown>;
/** Ses motoru ve ses alanları olmayan eski ayar kaydı (demo.2 şeması): bu ayarlar o kayıtta Yönetim'den yönetilir. */
const legacy = (patch: Record<string, unknown> = {}) => {
  const { ttsEngine: _engine, ttsVoices: _voices, ...rest } = base(patch);
  return rest as Record<string, unknown>;
};
const policy = DEFAULT_POLICY;
const NOW = new Date(2026, 10, 16, 21, 0, 0);

describe('değer çözümleme', () => {
  it('"aç / kapat" anlamı; uzun sözde yüklem sondadır', () => {
    for (const on of ['aç', 'açık', 'evet', 'etkinleştir', 'başlat', true, 1, 'Sessiz saatleri aç.', 'Bilgisayarımı kullanma iznini aç.', 'Windows açılınca kendiliğinden başla.']) {
      expect(parseOnOff(on), String(on)).toBe(true);
    }
    for (const off of ['kapat', 'kapalı', 'hayır', 'devre dışı', 'açma', false, 0, 'Bilgisayarımı kullanma iznini kapat.', 'Bilgisayar açılınca otomatik başlamayı kapat.', 'artık Windows’la başlama']) {
      expect(parseOnOff(off), String(off)).toBe(false);
    }
    expect(parseOnOff('çentik')).toBeNull();
    expect(parseOnOff('')).toBeNull();
  });

  it('saat aralığı: rakamla, sözcükle, gün bölümüyle', () => {
    expect(parseTimes('23:00-07:00')).toEqual(['23:00', '07:00']);
    expect(parseTimes('22.30 ile 6.45 arası')).toEqual(['22:30', '06:45']);
    expect(parseTimes('Sessiz saatleri gece on birden sabah yediye ayarla.')).toEqual(['23:00', '07:00']);
    expect(parseTimes('akşam 10’dan sabah 8 buçuğa')).toEqual(['22:00', '08:30']);
    expect(parseTimes('gece yarısından sabah altıya')).toEqual(['00:00', '06:00']);
    // Sayı sözcüğüyle başlayan başka sözcükler saat değildir.
    expect(parseTimes('önce birlikte bakalım')).toEqual([]);
    expect(parseTimes('sessiz saatleri aç')).toEqual([]);
  });

  it('süre', () => {
    expect(parseMinutes('bir saat')).toBe(60);
    expect(parseMinutes('Bir buçuk saat rahatsız etme')).toBe(90);
    expect(parseMinutes('30 dakika')).toBe(30);
    expect(parseMinutes('yarım saat')).toBe(30);
    expect(parseMinutes('rahatsız etme')).toBeNull();
  });
});

describe('ayarın adı: kim yönetiyor', () => {
  it('bu bilgisayarın ayarı, Yönetim’in ayarı, sesle değişmeyen yerel ayar ve bu sürümde olmayan ayar ayrışır', () => {
    expect(resolveSetting('windowsla_basla', base())).toMatchObject({ kind: 'setting', key: 'launchAtLogin' });
    expect(resolveSetting('sessiz saatler', base())).toMatchObject({ kind: 'setting', key: 'quietHours' });
    expect(resolveSetting('quietHours', base())).toMatchObject({ kind: 'setting', key: 'quietHours' });
    expect(resolveSetting('ekran okuma izni', base())).toMatchObject({ kind: 'setting', key: 'pcReadAllowed' });
    expect(resolveSetting('uyandırma sözü', base())).toMatchObject({ kind: 'managed', managed: { id: 'uyandirma_sozu', where: 'Beyin ve Kişilik' } });
    expect(resolveSetting('kısayollar', base())).toMatchObject({ kind: 'local-only', item: { id: 'kisayollar' } });
    // "Bu sürümde yok" örneği bildirim sesi. Görünüm seçimi kaldırıldı (tek görünüm): artık bilinmeyen addır.
    expect(resolveSetting('gorunum', base())).toEqual({ kind: 'unknown' });
    expect(resolveSetting('bildirim sesi', base())).toMatchObject({ kind: 'absent' });
    // Ses motoru ve ses seçimi bu cihazın ayarıdır (Ayarlar › Ses); alanı olmayan eski kayıtta Yönetim'den yönetilir.
    expect(resolveSetting('ses_motoru', base())).toMatchObject({ kind: 'setting', key: 'ttsEngine' });
    expect(resolveSetting('ses seçimi', base())).toMatchObject({ kind: 'setting', key: 'ttsVoices' });
    expect(resolveSetting('ses_motoru', legacy())).toMatchObject({ kind: 'absent', entry: { managedMeanwhile: expect.stringContaining('Fuber Yönetim') } });
    expect(resolveSetting('uçak kipi', base())).toEqual({ kind: 'unknown' });
  });

  it('alan şemaya gelince (başka görevin eklediği ayar) kod değişmeden bulunur; başka adla gelse de', () => {
    expect(resolveSetting('bildirim sesi', base({ notificationSound: true }))).toMatchObject({ kind: 'setting', key: 'notificationSound' });
    expect(resolveSetting('bildirim sesi', base({ notifyChimeEnabled: true }))).toMatchObject({ kind: 'setting', key: 'notifyChimeEnabled' });
    expect(resolveSetting('ses motoru', base({ ttsEngine: 'piper-local' }))).toMatchObject({ kind: 'setting', key: 'ttsEngine' });
    // Katalogda olmayan açık/kapalı alan da alan adıyla bulunur; yazılmayan alanlar bulunmaz.
    expect(resolveSetting('meetingNotes', base({ meetingNotes: false }))).toEqual({ kind: 'raw', key: 'meetingNotes' });
    expect(resolveSetting('setupCompletedAt', base())).toEqual({ kind: 'unknown' });
    expect(resolveSetting('controlUrl', base())).toMatchObject({ kind: 'local-only', item: { id: 'yonetim_adresi' } });
  });

  it('liste: şu anki değerler, bu sürümde olmayanlar ve Yönetim’den yönetilenler', () => {
    const list = listSpokenSettings(base({ quietHours: { enabled: true, from: '22:00', to: '07:30' }, userAddress: 'patron' }), policy);
    const value = (label: string) => list.available.find((item) => item.label === label)?.value;
    expect(value('Windows’la başlatma')).toBe('kapalı');
    expect(value('sessiz saatler')).toBe('açık (22:00–07:30)');
    expect(value('hitap')).toBe('“patron”');
    expect(value('bilgisayarı kullanma izni')).toBe('açık');
    expect(list.absent).toEqual(['bildirim sesi']);
    expect(list.managed).toEqual(expect.arrayContaining(['uyandırma sözü', 'asistanın adı', 'anahtarlar']));
    expect(list.managed).not.toContain('ses motoru');
    expect(value('ses motoru')).toBe('Supertonic 3 (Fuber Yönetim’in seçimi)');
    expect(value('ses seçimi')).toBe('Erkek 4 · tok');
    expect(listSpokenSettings(legacy(), policy).managed).toEqual(expect.arrayContaining(['ses motoru', 'ses seçimi']));
    expect(list.localOnly).toContain('kısayollar');
    // Kaldırılan görünüm seçimi listede yoktur.
    expect(list.available.find((item) => item.label === 'görünüm')).toBeUndefined();
    // Hitap verilmemişse Yönetim'deki varsayılan söylenir.
    expect(listSpokenSettings(base(), policy).available.find((item) => item.label === 'hitap')?.value).toContain(policy.persona.address);
  });
});

describe('değiştirme planı (hiçbir şey yazmaz)', () => {
  const plan = (name: string, value: unknown, settings = base()) => planSet(name, value, settings, policy, NOW);

  it('geliştirici kipi (çekirdek kendini geliştirme) sesle ASLA açılmaz: ne adıyla ne alan adıyla; listede de görünmez', () => {
    const settings = { ...base(), developerMode: false, developerRepoPath: null };
    for (const name of ['geliştirici kipi', 'developerMode', 'geliştirici modunu']) {
      const result = plan(name, 'aç', settings);
      expect(result.ok, name).toBe(false);
    }
    expect(plan('developerMode', true, settings)).toMatchObject({ ok: false });
    expect(listSpokenSettings(settings, policy).available.map((item) => item.label)).not.toContain('developerMode');
    expect(listSpokenSettings(settings, policy).localOnly).toContain('geliştirici kipi');
  });

  it('açık/kapalı ayar; zaten o değerdeyse yama boş', () => {
    expect(plan('windowsla_basla', 'aç')).toMatchObject({ ok: true, patch: { launchAtLogin: true }, unchanged: false, say: 'Windows’la başlatma açıldı.' });
    expect(plan('windowsla_basla', 'kapat')).toMatchObject({ ok: true, patch: {}, unchanged: true, say: 'Windows’la başlatma zaten kapalı.' });
    expect(plan('windowsla_basla', 'belki')).toMatchObject({ ok: false });
  });

  it('izin AÇMA onay ister; kapatma istemez', () => {
    const open = plan('ekran_okuma_izni', 'aç', base({ pcReadAllowed: false }));
    expect(open).toMatchObject({ ok: true, patch: { pcReadAllowed: true }, approval: 'Ekranınızı ve pencerelerinizi okuma iznini açmak istiyorum' });
    const close = plan('bilgisayar_kullanma_izni', 'Bilgisayarımı kullanma iznini kapat.');
    expect(close).toMatchObject({ ok: true, patch: { pcControlAllowed: false } });
    expect((close as { approval?: string }).approval).toBeUndefined();
    // Zaten açık olan izin için onay istenmez.
    expect((plan('bilgisayar_kullanma_izni', 'aç') as { approval?: string }).approval).toBeUndefined();
  });

  it('sessiz saatler: aç/kapat ya da aralık (aralık verilince açılır)', () => {
    expect(plan('sessiz_saatler', 'aç')).toMatchObject({ ok: true, patch: { quietHours: { enabled: true, from: '23:00', to: '08:00' } } });
    expect(plan('sessiz_saatler', 'Sessiz saatleri gece on birden sabah yediye ayarla.')).toMatchObject({
      ok: true,
      patch: { quietHours: { enabled: true, from: '23:00', to: '07:00' } },
      say: 'Sessiz saatleri 23:00 ile 07:00 arasına ayarladım ve açtım.',
    });
    expect(plan('sessiz_saatler', '23:00-07:00')).toMatchObject({ ok: true, patch: { quietHours: { from: '23:00', to: '07:00' } } });
    expect(plan('sessiz_saatler', 'saat 23')).toMatchObject({ ok: false });
  });

  it('rahatsız etme: süreyle açılır, süresiz açılır, kapanır', () => {
    const hour = plan('rahatsiz_etme', 'Bir saat rahatsız etme.');
    expect(hour).toMatchObject({ ok: true, patch: { dnd: true, dndUntil: new Date(NOW.getTime() + 3_600_000).toISOString() }, say: 'Rahatsız etme kipini 1 saatliğine açtım; bildirimler bekleyecek.' });
    expect(plan('rahatsiz_etme', 'Rahatsız etme kipini aç.')).toMatchObject({ ok: true, patch: { dnd: true, dndUntil: null } });
    expect(plan('rahatsiz_etme', 'kapat', base({ dnd: true }))).toMatchObject({ ok: true, patch: { dnd: false, dndUntil: null }, say: 'Rahatsız etme kipini kapattım.' });
  });

  it('hitap: sözcük yazılır; "varsayılan" Yönetim’dekine döndürür', () => {
    expect(plan('hitap', 'Patron')).toMatchObject({ ok: true, patch: { userAddress: 'Patron' }, say: 'Bundan sonra size “Patron” diye hitap edeceğim.' });
    expect(plan('hitap', 'varsayılan', base({ userAddress: 'patron' }))).toMatchObject({ ok: true, patch: { userAddress: null } });
  });

  it('seçenekli ayar: alan yokken "bu sürümde yok", alan gelince seçenek yazılır; şemadaki seçeneklerle sınırlıdır', () => {
    expect(plan('bildirim_sesi', 'aç')).toMatchObject({ ok: false, text: expect.stringContaining('ayarı bu sürümde yok') });
    expect(plan('ada_ekrani', 'mor')).toMatchObject({ ok: false, text: expect.stringContaining('imlecin olduğu ekran, ana ekran') });
    expect(plan('hareket', 'hareketi azalt')).toMatchObject({ ok: true, patch: { reducedMotion: 'on' } });
    expect(plan('ada_ekrani', 'ana ekran')).toMatchObject({ ok: true, patch: { islandDisplay: 'primary' } });
    // Seçenekleri bilinmeyen alan (şemada `SETTING_CHOICES` kaydı yok): rastgele değer yazılmaz.
    useTtsCatalog(null);
    try {
      expect(plan('ses_motoru', 'yerel', base({ ttsEngine: 'piper-local' }))).toMatchObject({ ok: false, text: expect.stringContaining('Ayarlar sayfasından') });
    } finally {
      useTtsCatalog(undefined);
    }
  });

  it('Yönetim’den yönetilen ve sesle değişmeyen ayar değişmez: nedeni ve yeri söylenir', () => {
    const managed = plan('uyandirma_sozu', 'Uyandırma sözünü Friday olarak değiştir.');
    expect(managed).toMatchObject({ ok: false });
    expect((managed as { text: string }).text).toContain('Fuber Yönetim’den yönetilir');
    expect((managed as { text: string }).text).toContain('“Beyin ve Kişilik”');
    expect(plan('ses_motoru', 'değiştir', legacy())).toMatchObject({ ok: false, text: expect.stringContaining('Ses ve Anahtarlar') });
    expect(plan('kisayollar', 'değiştir')).toMatchObject({ ok: false, text: expect.stringContaining('Ayarlar › Kısayollar') });
    expect(plan('yok_boyle_ayar', 'aç')).toMatchObject({ ok: false, text: expect.stringContaining('adında bir ayar yok') });
  });

  it('tek ayar satırı', () => {
    const settings = base({ quietHours: { enabled: true, from: '22:00', to: '07:30' } });
    expect(describeSetting(resolveSetting('sessiz saatler', settings), settings, policy)).toBe('Sessiz saatler: açık (22:00–07:30).');
    expect(describeSetting(resolveSetting('uyandırma sözü', settings), settings, policy)).toContain(policy.persona.wakePhrases[0]!);
  });
});

describe('söz → ayar komutu', () => {
  const route = (text: string) => routeSpokenSetting(text);

  it('değiştirme: değer sözün kendisidir', () => {
    expect(route('Sessiz saatleri aç.')).toEqual({ name: 'settings_set', input: { name: 'sessiz_saatler', value: 'Sessiz saatleri aç.' } });
    expect(route('Windows açılınca kendiliğinden başla.')).toMatchObject({ name: 'settings_set', input: { name: 'windowsla_basla' } });
    expect(route('Bilgisayarımı kullanma iznini kapat.')).toMatchObject({ name: 'settings_set', input: { name: 'bilgisayar_kullanma_izni' } });
    expect(route('Ekranımı okuma iznini aç.')).toMatchObject({ name: 'settings_set', input: { name: 'ekran_okuma_izni' } });
    // Serbest söyleyiş, "kullan" fiili (yerel değerlendirmede model araç çağırmadan "geçirdim" diyordu): kod eşler.
    expect(route('Seslendirme motoru olarak ElevenLabs kullan bundan sonra.')).toMatchObject({ name: 'settings_set', input: { name: 'ses_motoru' } });
    // "Bilgisayarı kullanma izni" sorusu değiştirme sayılmaz ("kullan" yalnız tek başına fiilken).
    expect(route('Bilgisayarı kullanma iznin var mı?')?.name).not.toBe('settings_set');
    expect(route('Bildirim sesini kapat.')).toMatchObject({ name: 'settings_set', input: { name: 'bildirim_sesi' } });
    expect(route('Bir saat rahatsız etme.')).toMatchObject({ name: 'settings_set', input: { name: 'rahatsiz_etme' } });
    expect(route('Bundan sonra bana Patron diye hitap et.')).toEqual({ name: 'settings_set', input: { name: 'hitap', value: 'Patron' } });
    // Asistanın kendi tarayıcısı ayrı bir izindir (browser modülü); bilgisayarı kullanma izniyle karışmaz.
    expect(route('Kendi tarayıcını kullanma iznini kapat.')).toMatchObject({ name: 'settings_set', input: { name: 'tarayici_izni' } });
    expect(route('Tarayıcı iznini aç.')).toMatchObject({ name: 'settings_set', input: { name: 'tarayici_izni' } });
    expect(route('Tarayıcı izni açık mı?')).toEqual({ name: 'settings_list', input: { name: 'tarayici_izni' } });
    expect(resolveSetting('tarayıcını kullanma izni', base())).toMatchObject({ kind: 'setting', key: 'jbrowserAllowed' });
    expect(resolveSetting('bilgisayarı kullanma izni', base())).toMatchObject({ kind: 'setting', key: 'pcControlAllowed' });
    expect(resolveSetting('jbrowserAllowed', base())).toMatchObject({ kind: 'setting', key: 'jbrowserAllowed' });
  });

  it('durum sorusu okumadır', () => {
    expect(route('Sessiz saatler açık mı?')).toEqual({ name: 'settings_list', input: { name: 'sessiz_saatler' } });
    expect(route('Bana nasıl hitap ediyorsun?')).toEqual({ name: 'settings_list', input: { name: 'hitap' } });
  });

  it('Yönetim’den yönetilen ya da sesle değişmeyen ayarı değiştirme isteği de araca gider (araç reddeder ve yerini söyler)', () => {
    expect(route('Uyandırma sözünü Friday olarak değiştir.')).toMatchObject({ name: 'settings_set', input: { name: 'uyandirma_sozu' } });
    expect(route('Ses motorunu değiştirir misin?')).toMatchObject({ name: 'settings_set', input: { name: 'ses_motoru' } });
    expect(route('Konuşma kısayolunu değiştir.')).toMatchObject({ name: 'settings_set', input: { name: 'kisayollar' } });
  });

  it('ayar olmayan gündelik sözler eşlenmez', () => {
    for (const text of [
      'ekranımı oku',
      'ekrana bak',
      "Windows'u yeniden başlat",
      "Windows açılınca Chrome'u aç",
      'bunu yazıya çevir',
      'bunu İngilizceye çevir',
      'senin adın ne?',
      'Claude ne durumda?',
      'hareketli bir müzik aç',
      'mikrofonu kapat',
      'sesi kapat',
      'ortam dinlemeyi duraklat',
      'ses ayarlarını aç',
      'yarın saat onda KDV beyannamesini hatırlat',
      'bütçeyi Kaan’la konuşacağız',
      'beni rahatsız eden bir şey var',
    ]) {
      expect(route(text), text).toBeNull();
    }
  });
});

describe('dinleme süresi (d10: sol paneldeki Hızlı kontrol ile aynı ayar, `Settings.followUpSeconds`)', () => {
  const plan = (value: unknown, settings = base()) => planSet('dinleme_suresi', value, settings, policy, NOW);
  // Örnek kurulumun Yönetim'deki değeri 5 sn; sınamada politikanın varsayılanı yerine bu kullanılır.
  const five = structuredClone(DEFAULT_POLICY);
  five.voice.followUpSeconds = 5;

  it('bu cihazın ayarıdır (artık Yönetim’e havale edilmez); şu anki değer söylenir', () => {
    expect(resolveSetting('dinleme süresi', base())).toMatchObject({ kind: 'setting', key: 'followUpSeconds' });
    expect(resolveSetting('takip süresi', base())).toMatchObject({ kind: 'setting', key: 'followUpSeconds' });
    expect(listSpokenSettings(base(), five).available.find((item) => item.label === 'dinleme süresi')?.value).toBe('5 saniye (Fuber Yönetim’in değeri)');
    expect(listSpokenSettings(base({ followUpSeconds: 20 }), five).available.find((item) => item.label === 'dinleme süresi')?.value).toBe('20 saniye');
    expect(listSpokenSettings(base(), five).managed).not.toContain('takip süresi');
  });

  it('"uzat" bir kademe ilerler, "kısalt" geriler; kademeler 5 / 10 / 20 / 40 sn', () => {
    expect(planSet('dinleme_suresi', 'Dinleme süreni uzat.', base(), five, NOW)).toMatchObject({ ok: true, patch: { followUpSeconds: 10 }, say: 'Dinleme süremi 10 saniye yaptım.' });
    expect(plan('dinleme süresini biraz daha uzat', base({ followUpSeconds: 10 }))).toMatchObject({ ok: true, patch: { followUpSeconds: 20 } });
    expect(plan('uzat', base({ followUpSeconds: 40 }))).toMatchObject({ ok: true, patch: {}, unchanged: true, say: expect.stringContaining('en uzun') });
    expect(plan('Dinleme süreni kısalt.', base({ followUpSeconds: 20 }))).toMatchObject({ ok: true, patch: { followUpSeconds: 10 } });
    expect(planSet('dinleme_suresi', 'kısalt', base(), five, NOW)).toMatchObject({ ok: true, patch: {}, unchanged: true, say: expect.stringContaining('en kısa') });
    // Kademe arasındaki değerden de doğru yöne gidilir.
    expect(plan('uzat', base({ followUpSeconds: 15 }))).toMatchObject({ patch: { followUpSeconds: 20 } });
    expect(plan('kısalt', base({ followUpSeconds: 15 }))).toMatchObject({ patch: { followUpSeconds: 10 } });
  });

  it('sayıyla ya da kademe adıyla; "varsayılan" Yönetim’in değerine döner', () => {
    expect(plan('Dinleme süreni 30 saniye yap.')).toMatchObject({ ok: true, patch: { followUpSeconds: 30 }, say: 'Dinleme süremi 30 saniye yaptım.' });
    expect(plan('yirmi saniye')).toMatchObject({ ok: true, patch: { followUpSeconds: 20 } });
    expect(plan('bir dakika')).toMatchObject({ ok: true, patch: { followUpSeconds: 60 } });
    expect(plan('uzun')).toMatchObject({ ok: true, patch: { followUpSeconds: 20 } });
    expect(plan('çok uzun')).toMatchObject({ ok: true, patch: { followUpSeconds: 40 } });
    expect(plan('kısa')).toMatchObject({ ok: true, patch: { followUpSeconds: 5 } });
    expect(plan('300 saniye')).toMatchObject({ ok: true, patch: { followUpSeconds: 120 } });
    expect(planSet('dinleme_suresi', 'varsayılana döndür', base({ followUpSeconds: 20 }), five, NOW)).toMatchObject({ ok: true, patch: { followUpSeconds: null }, say: expect.stringContaining('5 saniye') });
    expect(plan('mor')).toMatchObject({ ok: false });
  });

  it('söz → komut: "dinleme süreni uzat" kodla araca gider', () => {
    for (const text of ['Dinleme süreni uzat.', 'dinleme süresini kısalt', 'Dinleme süresini 20 saniye yap.', 'Takip süresini uzat.', 'beni daha uzun dinle']) {
      expect(routeSpokenSetting(text), text).toMatchObject({ name: 'settings_set', input: { name: 'dinleme_suresi' } });
    }
    expect(routeSpokenSetting('Dinleme süren ne kadar?')).toEqual({ name: 'settings_list', input: { name: 'dinleme_suresi' } });
    // Mikrofonu kapatma ve dinlemeyi duraklatma bu ayar değildir.
    expect(routeSpokenSetting('dinlemeyi duraklat')).toBeNull();
  });
});

describe('ses motoru ve ses seçimi: gerçek katalog (`TTS_ENGINES`) ve gerçek ayar alanlarıyla', () => {
  // Birleşmiş sürüm: katalog ve alanlar ortak pakettedir; benzetim yok. Varsayılan politika Supertonic 3 / M4'tür.
  const plan = (name: string, value: unknown, settings = base()) => planSet(name, value, settings, policy, NOW);

  it('varsayılan politika yerel ekran kartı sesidir; katalog ortak pakettekiyle aynıdır', () => {
    expect(policy.voice.tts).toMatchObject({ provider: DEFAULT_TTS_ENGINE, voiceId: 'M4' });
    expect(Object.keys(TTS_ENGINES)).toEqual(['supertonic', 'ema-lightning', 'piper-local', 'elevenlabs']);
    expect(base()).toMatchObject({ ttsEngine: null, ttsVoices: {} });
  });

  it('alanlar ya da katalog yokken (eski kayıt) Yönetim’den yönetilir', () => {
    expect(resolveSetting('ses motoru', legacy())).toMatchObject({ kind: 'absent' });
    expect(planSet('ses', 'erkek beş', legacy(), policy, NOW)).toMatchObject({ ok: false, text: expect.stringContaining('Fuber Yönetim') });
    useTtsCatalog(null);
    try {
      expect(planSet('ses', 'erkek beş', base(), policy, NOW)).toMatchObject({ ok: false, text: expect.stringContaining('Ayarlar › Ses') });
    } finally {
      useTtsCatalog(undefined);
    }
  });

  it('ses motoru: adıyla, türüyle seçilir; "varsayılan" Yönetim’in seçimine döner', () => {
    expect(plan('ses_motoru', 'Ses motorunu Piper yap.')).toMatchObject({ ok: true, patch: { ttsEngine: 'piper-local' }, say: 'Ses motoru Piper yapıldı.' });
    expect(plan('ses_motoru', 'elevenlabs')).toMatchObject({ ok: true, patch: { ttsEngine: 'elevenlabs' } });
    // Yazıya çevirme adı ayrı da yazar.
    expect(plan('ses_motoru', 'Ses motorunu Eleven Labs yap.')).toMatchObject({ ok: true, patch: { ttsEngine: 'elevenlabs' } });
    expect(plan('ses_motoru', 'bulut')).toMatchObject({ ok: true, patch: { ttsEngine: 'elevenlabs' } });
    expect(plan('ses_motoru', 'ema lightning')).toMatchObject({ ok: true, patch: { ttsEngine: 'ema-lightning' } });
    expect(plan('ses_motoru', 'Ses motorunu EMA yap.')).toMatchObject({ ok: true, patch: { ttsEngine: 'ema-lightning' } });
    expect(plan('ses_motoru', 'Ses motorunu Supertonic yap.', base({ ttsEngine: 'piper-local' }))).toMatchObject({ ok: true, patch: { ttsEngine: 'supertonic' }, say: 'Ses motoru Supertonic 3 yapıldı.' });
    expect(plan('ses_motoru', 'işlemcide çalışanı seç')).toMatchObject({ ok: true, patch: { ttsEngine: 'piper-local' } });
    expect(plan('ses_motoru', 'varsayılana dön', base({ ttsEngine: 'piper-local' }))).toMatchObject({ ok: true, patch: { ttsEngine: null } });
    expect(plan('ses_motoru', 'kokoro')).toMatchObject({ ok: false, text: expect.stringContaining('Supertonic 3, EMA Lightning, Piper, ElevenLabs') });
    // Motor adını içinde taşıyan başka sözcük eşlenmez ("sinema" EMA değildir).
    expect(plan('ses_motoru', 'sinema')).toMatchObject({ ok: false });
    // Cihazda seçim yokken Yönetim'in varsayılanı söylenir; cihaz seçince o söylenir.
    const list = listSpokenSettings(base(), policy);
    expect(list.available.find((item) => item.label === 'ses motoru')?.value).toBe('Supertonic 3 (Fuber Yönetim’in seçimi)');
    expect(list.available.find((item) => item.label === 'ses seçimi')?.value).toBe('Erkek 4 · tok');
    expect(list.managed).not.toContain('ses motoru');
    expect(listSpokenSettings(base({ ttsEngine: 'piper-local' }), policy).available.find((item) => item.label === 'ses motoru')?.value).toBe('Piper');
  });

  it('ses: geçerli motorun sesleri arasından, adıyla / kimliğiyle / nitelemesiyle; motor başına yazılır', () => {
    expect(plan('ses', 'Sesini Erkek beş yap.')).toMatchObject({ ok: true, patch: { ttsVoices: { supertonic: 'M5' } }, say: 'Sesimi Erkek 5 · en derin yaptım.' });
    expect(plan('ses', 'M5')).toMatchObject({ ok: true, patch: { ttsVoices: { supertonic: 'M5' } } });
    expect(plan('ses', 'kadın 2')).toMatchObject({ ok: true, patch: { ttsVoices: { supertonic: 'F2' } } });
    expect(plan('ses', 'en derin olanı seç')).toMatchObject({ ok: true, patch: { ttsVoices: { supertonic: 'M5' } } });
    // Öteki motorların kayıtlı sesi korunur.
    expect(plan('ses', 'kadın 2', base({ ttsVoices: { 'piper-local': 'dfki' } }))).toMatchObject({ patch: { ttsVoices: { 'piper-local': 'dfki', supertonic: 'F2' } } });
    expect(plan('ses', 'robot sesi')).toMatchObject({ ok: false, text: expect.stringContaining('Erkek 4 · tok, Erkek 5 · en derin, Erkek 2 · derin, sakin') });
    // Cihaz başka motoru seçtiyse sesler o motorundur.
    expect(plan('ses', 'erkek 5', base({ ttsEngine: 'ema-lightning' }))).toMatchObject({ ok: false, text: expect.stringContaining('EMA Lightning motorunun sesleri: EMA · ince, net') });
    // Sesi Yönetim'den seçilen motor (ElevenLabs): değişmez, nedeni söylenir.
    expect(plan('ses', 'erkek 5', base({ ttsEngine: 'elevenlabs' }))).toMatchObject({ ok: false, text: expect.stringContaining('ElevenLabs motorunun sesi Fuber Yönetim’den seçilir') });
  });

  it('yazılan değer ses hattının okuduğu seçimle aynıdır (`resolveTtsSelection`)', () => {
    const settings = base();
    const engine = plan('ses_motoru', 'Ses motorunu EMA yap.', settings);
    expect(engine.ok).toBe(true);
    const afterEngine = { ...settings, ...(engine as { patch: Record<string, unknown> }).patch };
    expect(resolveTtsSelection(policy, afterEngine as never)).toMatchObject({ engine: 'ema-lightning', voice: 'ema', source: 'device' });
    const voice = plan('ses', 'Sesini Kadın üç yap.', settings);
    const afterVoice = { ...settings, ...(voice as { patch: Record<string, unknown> }).patch };
    expect(resolveTtsSelection(policy, afterVoice as never)).toMatchObject({ engine: 'supertonic', voice: 'F3', source: 'policy' });
  });

  it('söz → komut: "ses motorunu Piper yap", "sesini değiştir"', () => {
    expect(routeSpokenSetting('Ses motorunu Piper yap.')).toMatchObject({ name: 'settings_set', input: { name: 'ses_motoru' } });
    expect(routeSpokenSetting('Sesini Erkek beş yap.')).toEqual({ name: 'settings_set', input: { name: 'ses', value: 'Sesini Erkek beş yap.' } });
    expect(routeSpokenSetting('Sesini değiştir, erkek beş olsun.')).toMatchObject({ name: 'settings_set', input: { name: 'ses' } });
    // Ses düzeyi isteği ses seçimi değildir.
    expect(routeSpokenSetting('sesini biraz kıs')).toBeNull();
  });
});
