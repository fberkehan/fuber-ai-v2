import { describe, expect, it } from 'vitest';
import { routeVoiceIntent } from './local-intents';
import { createReplyFilter, statesNow } from './local-style';
import { foldTr } from './local-tools';
import { contextNote, doneNote, isRepeatRequest, isTimeAsked, isTimeRelevant } from './prompt';

/** Cümleleri sırayla verir; kullanıcının duyacağı cümleleri ve "tümü yineleme" bilgisini döndürür. */
function run(sentences: string[], options: { previousReply?: string | null; allowRepeat?: boolean } = {}) {
  const filter = createReplyFilter({ address: 'efendim', previousReply: options.previousReply ?? null, allowRepeat: options.allowRepeat ?? false });
  const heard: string[] = [];
  for (const sentence of sentences) heard.push(...filter.push(sentence));
  const end = filter.end();
  heard.push(...end.sentences);
  return { heard, repeated: end.repeated };
}

describe('yerel yanıt süzgeci', () => {
  it('yanıtın sonundaki kalıp teklif atılır; tek cümleyse kalır', () => {
    expect(run(['Efendim, teşekkür ederim, iyiyim.', 'Nasıl yardımcı olabilirim?']).heard).toEqual(['Efendim, teşekkür ederim, iyiyim.']);
    expect(run(['Hatırlatıcıyı kurdum.', 'Başka bir isteğiniz var mı?']).heard).toEqual(['Hatırlatıcıyı kurdum.']);
    expect(run(['Mikrofonu kapattım.', 'Umarım işinize yarar.']).heard).toEqual(['Mikrofonu kapattım.']);
    expect(run(['Anladım.', 'Peki, size bugün nasıl yardımcı olabilirim?']).heard).toEqual(['Anladım.']);
    // Cümlenin sonuna virgülle eklenen kalıp: yalnız o parça kesilir.
    expect(run(['Anlıyorum.', 'Dinlenmek için bir şeyler yapabiliriz, yoksa nasıl yardımcı olabilirim?']).heard).toEqual(['Anlıyorum.', 'Dinlenmek için bir şeyler yapabiliriz.']);
    expect(run(['Az önce bir şey söylemediniz.', 'Ne yapmamı istersiniz?']).heard).toEqual(['Az önce bir şey söylemediniz.']);
    // 40 turluk koşuda görülen biçim (uzun konuşmada altı kez).
    expect(run(['Kaan adını aklımda tuttum.', 'Başka bir şey yapabilirim mi?']).heard).toEqual(['Kaan adını aklımda tuttum.']);
    expect(run(['Size nasıl yardımcı olabilirim?']).heard).toEqual(['Size nasıl yardımcı olabilirim?']);
  });

  it('kalıp teklifin ardından söz sürüyorsa teklif son cümle değildir, iletilir', () => {
    expect(run(['Nasıl yardımcı olabilirim?', 'Hatırlatıcı kurabilirim.']).heard).toEqual(['Nasıl yardımcı olabilirim?', 'Hatırlatıcı kurabilirim.']);
  });

  it('hitap yalnız ilk cümlede kalır; önceki yanıt da hitapla başladıysa hiç kalmaz', () => {
    expect(run(['Efendim, özür dilerim.', 'Efendim, hatırlatıcıyı kurdum.', 'Efendim, akşam sekizde çalacak.']).heard).toEqual([
      'Efendim, özür dilerim.',
      'Hatırlatıcıyı kurdum.',
      'Akşam sekizde çalacak.',
    ]);
    expect(run(['Efendim, şu an hava bilgisini alamıyorum.'], { previousReply: 'Efendim, iyiyim.' }).heard).toEqual(['Şu an hava bilgisini alamıyorum.']);
    expect(run(['Efendim, iyiyim.'], { previousReply: 'Ankara başkenttir.' }).heard).toEqual(['Efendim, iyiyim.']);
  });

  it('önceki yanıtın yinelemesi iletilmez ve bildirilir (sınamada görüldü: yeni söze eski yanıt)', () => {
    const previous = "Efendim, teşekkür ederim, iyiyim. Bugün 16 Kasım 2026, saat 12:34'te sizinle hizmet etmekten mutluluk duyarım. Nasıl yardımcı olabilirim?";
    const again = ['Efendim, çok teşekkür ederim, iyiyim.', "Bugün 16 Kasım 2026, saat 12:34'te sizinle hizmet etmekten mutluluk duyarım."];
    expect(run(again, { previousReply: previous })).toEqual({ heard: [], repeated: true });
    // Kullanıcı yinelemeyi kendisi istediyse denetim kapalıdır.
    expect(run(again, { previousReply: previous, allowRepeat: true }).repeated).toBe(false);
    expect(run(again, { previousReply: previous, allowRepeat: true }).heard).toHaveLength(2);
  });

  it('yeni içerik gelince bekletilen benzer cümle de iletilir; kısa cümleler yineleme sayılmaz', () => {
    const previous = 'Hatırlatıcıyı bugün akşam sekize kurdum.';
    expect(run(['Hatırlatıcıyı bugün akşam sekize kurdum.', 'İsterseniz saatini değiştirebilirim.'], { previousReply: previous })).toEqual({
      heard: ['Hatırlatıcıyı bugün akşam sekize kurdum.', 'İsterseniz saatini değiştirebilirim.'],
      repeated: false,
    });
    expect(run(['Tamam.'], { previousReply: 'Tamam.' })).toEqual({ heard: ['Tamam.'], repeated: false });
  });

  it('yanıta kopyalanan köşeli etiket, bağlam bloğu ve "(yapıldı: …)" notu atılır', () => {
    expect(run(['[dün 14:05] Efendim, kurdum.']).heard).toEqual(['Efendim, kurdum.']);
    expect(run(['<baglam> Saat on iki.']).heard).toEqual(['Saat on iki.']);
    expect(run(['Hatırlatıcıyı akşam sekize kurdum. (yapıldı: reminder_create)']).heard).toEqual(['Hatırlatıcıyı akşam sekize kurdum.']);
  });

  it('sorulmadan okunan tarih/saat cümlesi atılır; tek içerik oysa kalır; hitap tur boyunca bir kez', () => {
    const now = new Date(2026, 10, 16, 12, 34, 20);
    const filter = createReplyFilter({ address: 'efendim', previousReply: null, allowRepeat: false, unaskedTime: now });
    const heard = [
      ...filter.push("Efendim, Ankara'nın hava durumunu şu an alamıyorum."),
      ...filter.push("Şu anki tarih 16 Kasım 2026, saat 12:34'tir."),
      ...filter.push('İsterseniz sayfasını açayım.'),
      ...filter.end().sentences,
    ];
    expect(heard).toEqual(["Efendim, Ankara'nın hava durumunu şu an alamıyorum.", 'İsterseniz sayfasını açayım.']);
    expect(statesNow('Bugün 16 Kasım, saat 12:33.', now)).toBe(true);
    expect(statesNow('Hatırlatıcıyı akşam 20:00’ye kurdum.', now)).toBe(false);

    const only = createReplyFilter({ address: 'efendim', previousReply: null, allowRepeat: false, unaskedTime: now });
    expect([...only.push('Saat 12:34.'), ...only.end().sentences]).toEqual(['Saat 12:34.']);

    const shared = { emitted: 0 };
    const first = createReplyFilter({ address: 'efendim', previousReply: null, allowRepeat: false, shared });
    const second = createReplyFilter({ address: 'efendim', previousReply: null, allowRepeat: false, shared });
    expect([...first.push('Efendim, bakıyorum.'), ...first.end().sentences, ...second.push('Efendim, bir madde var.'), ...second.end().sentences]).toEqual(['Efendim, bakıyorum.', 'Bir madde var.']);
  });
});

describe('yineleme isteği', () => {
  const yes = (text: string) => expect(isRepeatRequest(text, foldTr), text).toBe(true);
  const no = (text: string) => expect(isRepeatRequest(text, foldTr), text).toBe(false);

  it('açık ve örtük yineleme istekleri tanınır', () => {
    yes('Az önce tam anlamadım sesini, bir daha konuşur musun?');
    yes('Bir daha söyler misin?');
    yes('tekrar eder misin');
    yes('Anlamadım.');
    yes('Ne dedin?');
    yes('duyamadım seni');
  });

  it('yeni bir soru taşıyan söz yineleme isteği değildir', () => {
    no("Anlamadım, KDV'yi ne zaman vereceğim, yarın mı yoksa haftaya mı?");
    no('yarın saat onda KDV beyannamesini hatırlat');
    no('Bunun işinize yarar.');
    no('her gün tekrar eden bir hatırlatıcı kur, sabah dokuzda ilacımı içmem gerekiyor ona göre ayarla lütfen');
  });
});

describe('ses denetimi sözlerinin kodla eşlenmesi', () => {
  it('belirsiz "ses"i kapatma: araç yok, soru sorulur (sınamada başarısız olan tur)', () => {
    for (const said of ['Teşekkür ederim. Sesli modeli kapatabilirsin.', 'sesi kapat', 'Sesli modu kapat.', 'sesini kıs']) {
      expect(routeVoiceIntent(said, false), said).toEqual({ kind: 'ask' });
    }
  });

  it('kesin sözler doğru araca gider', () => {
    for (const said of ['mikrofonu kapat', 'Mikrofonu kapatır mısın?', 'beni dinleme', 'dinlemeyi bırak', 'Dinlemeyi kapatabilirsin.']) {
      expect(routeVoiceIntent(said, false), said).toEqual({ kind: 'call', name: 'voice_mute_mic', input: {} });
    }
    for (const said of ['sesli yanıt verme, yazıyla söyle', 'sessiz ol', 'Sesli yanıtı kapat.', 'yazıyla söyle']) {
      expect(routeVoiceIntent(said, false), said).toEqual({ kind: 'call', name: 'voice_set_quiet', input: { on: true } });
    }
  });

  it('d10: "ortam dinlemeyi kapat" mikrofonu KAPATMAZ, ortam dinlemeyi kapatır; "sessiz kipe geç" sessiz kibi açar', () => {
    for (const said of ['ortam dinlemeyi kapat', 'Ortam dinlemeyi kapatır mısın?', 'ortam dinleme kapansın', 'ortam dinlemeyi durdur']) {
      expect(routeVoiceIntent(said, false), said).toEqual({ kind: 'call', name: 'ambient_set', input: { on: false } });
    }
    for (const said of ['ortam dinlemeyi aç', 'Ortam dinlemeyi açar mısın?', 'ortam dinlemeyi başlat']) {
      expect(routeVoiceIntent(said, false), said).toEqual({ kind: 'call', name: 'ambient_set', input: { on: true } });
    }
    for (const said of ['sessiz kipe geç', 'Sessiz moda geç.', 'sessiz kipi aç']) {
      expect(routeVoiceIntent(said, false), said).toEqual({ kind: 'call', name: 'voice_set_quiet', input: { on: true } });
    }
    // Süreli duraklatma ve soru modele kalır (ambient_pause / durum).
    for (const said of ['ortam dinlemeyi bir saat duraklat', 'ortam dinleme açık mı?', 'ortam dinlemeyi kapatma']) {
      expect(routeVoiceIntent(said, false), said).toBeNull();
    }
  });

  it('süre, olumsuzluk, soru ya da başka ses kaynağı geçen söz modele kalır', () => {
    for (const said of [
      'mikrofonu yarım saat kapat',
      'mikrofonu kapatma',
      'mikrofon kapalı mı?',
      'müziğin sesini kapat',
      'bilgisayarın sesini kapat',
      'yarın saat onda KDV beyannamesini hatırlat',
      'Ses modelin baya gelişmiş, şok oldum.',
      'Senin ses modelin nereden geliyor bu arada şu anda?',
    ]) {
      expect(routeVoiceIntent(said, false), said).toBeNull();
    }
  });

  it('soruya verilen kısa yanıt aracı seçer', () => {
    expect(routeVoiceIntent('Dinlemeyi.', true)).toEqual({ kind: 'call', name: 'voice_mute_mic', input: {} });
    expect(routeVoiceIntent('mikrofonu kapat', true)).toEqual({ kind: 'call', name: 'voice_mute_mic', input: {} });
    expect(routeVoiceIntent('Sesli yanıtı.', true)).toEqual({ kind: 'call', name: 'voice_set_quiet', input: { on: true } });
    expect(routeVoiceIntent('boş ver', true)).toBeNull();
  });
});

describe('yerel bağlam notu', () => {
  it('saat ve hafıza son kullanıcı iletisine girecek blokta; olağan varlık durumu yazılmaz', () => {
    const now = new Date(2026, 10, 16, 12, 34, 5);
    const note = contextNote({
      now,
      presence: { mode: 'normal', fullscreen: false, meeting: false, cameraInUse: false, micInUseByOther: false, quiet: false, idleSeconds: 0, since: now.toISOString() },
      memories: [],
    });
    expect(note.startsWith('<baglam>\nŞimdi: 16 Kasım Pazartesi 2026, saat 12:34 (ISO 2026-11-16T12:34:05')).toBe(true);
    expect(note.endsWith('</baglam>')).toBe(true);
    expect(note).not.toContain('bilgisayar başında');
    expect(note).not.toContain('Hafıza');
    // Saat istenmediyse ve başka bağlam yoksa blok hiç eklenmez.
    expect(contextNote({ now, presence: null, memories: [], includeNow: false })).toBe('');
  });

  it('saat yalnız zamanla ilgili sözde bağlama girer; yanıtta söylenmesi yalnız sorulunca yerindedir', () => {
    for (const said of ['saat kaç?', 'yarın toplantı var mı', 'KDV beyannamesini hatırlat', 'bugün günlerden ne']) expect(isTimeRelevant(said, foldTr), said).toBe(true);
    for (const said of ['merhaba', 'Ses modelin baya gelişmiş, şok oldum.', 'Teşekkür ederim.', 'Ankara hakkında bilgi ver']) expect(isTimeRelevant(said, foldTr), said).toBe(false);
    expect(isTimeAsked('saat kaç?', foldTr)).toBe(true);
    expect(isTimeAsked("Ankara'nın hava durumunu söyler misin?", foldTr)).toBe(false);
  });

  it('geçmişteki yanıta "yapıldı" notu: araç yoksa boş', () => {
    expect(doneNote(['reminder_create', 'memory_save'])).toBe(' (yapıldı: reminder_create, memory_save)');
    expect(doneNote([])).toBe('');
  });

  it('donanım sorusu durum aracına gider; ekran kartının adı geçen ama donanımı sormayan söz gitmez', () => {
    for (const said of ['Benim ekran kartımı falan görebiliyor musun sen şu an, modelini, markasını falan?', 'Ekran kartımı görebiliyor musun?', 'Peki kaç GB belleği var?', 'işlemcim ne?']) {
      expect(routeVoiceIntent(said, false), said).toEqual({ kind: 'call', name: 'self_status', input: {} });
    }
    for (const said of ['Şu anda benim bilgisayarımdasın ve bütün sesi benim ekran kartımla üretiyorsun.', 'ekran kartı almayı hatırlat']) {
      expect(routeVoiceIntent(said, false), said).toBeNull();
    }
  });

  it('"sus", "dur": susturma aracına gider', () => {
    for (const said of ['sus', 'Dur.', 'tamam yeter', 'sus artık']) expect(routeVoiceIntent(said, false), said).toEqual({ kind: 'call', name: 'voice_stop_speaking', input: {} });
    expect(routeVoiceIntent('dur bir dakika, yarın toplantı vardı değil mi', false)).toBeNull();
  });
});
