import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { findSpokenPage, findSpokenTest, routeSpokenCommand, SPOKEN_PAGES, SPOKEN_TESTS } from './local-commands';
import { asksRecentDetail, recallIntent } from './local-intents';

const route = (text: string) => routeSpokenCommand(text);

describe('sesle sınama başlatma', () => {
  it('sınama adı + başlatma fiili → araç', () => {
    const cases: Array<[string, string]> = [
      ['Söz kesme sınamasını başlat.', 'barge_in'],
      ['söz kesme testini yapar mısın', 'barge_in'],
      ['Yankı sınaması yapar mısın?', 'echo'],
      ['yankıyı sına', 'echo'],
      ['Uyandırma alıştırmasını başlat.', 'wake_training'],
      ['uyandırmayı yeniden alıştır', 'wake_training'],
      ['Mikrofonumu bir sına bakalım.', 'mic'],
      ['mikrofonu test eder misin', 'mic'],
    ];
    for (const [text, test] of cases) expect(route(text), text).toEqual({ name: 'voice_test_start', input: { test } });
  });

  it('soru, sonuç sorma, kapatma ve sınama olmayan söz başlatma değildir', () => {
    for (const text of ['yankı sınaması ne oldu?', 'söz kesme sınaması nasıl yapılır', 'sınamayı durdur', 'mikrofonu kapat', 'bunu bir dene', 'uyandırma sözünü duraklat', 'mikrofonu aç']) {
      expect(route(text)?.name, text).not.toBe('voice_test_start');
    }
  });

  it('"hangi sınamalar var", "neleri ayarlayabilirim" → liste aracı', () => {
    expect(route('Hangi sınamalar var?')).toEqual({ name: 'settings_list', input: { topic: 'sinamalar' } });
    expect(route('Sesle neleri ayarlayabilirim?')).toEqual({ name: 'settings_list', input: { topic: 'ayarlar' } });
    expect(route('ne ayarlayabilirim')).toEqual({ name: 'settings_list', input: { topic: 'ayarlar' } });
    expect(route('hangi ayarları değiştirebilirim')).toEqual({ name: 'settings_list', input: { topic: 'ayarlar' } });
  });

  it('katalog: dört sınama, adla ve kimlikle bulunur', () => {
    expect(SPOKEN_TESTS.map((test) => test.id)).toEqual(['barge_in', 'echo', 'wake_training', 'mic']);
    expect(findSpokenTest('wake_training')?.label).toBe('uyandırma alıştırması');
    expect(findSpokenTest('yankı')?.id).toBe('echo');
    expect(findSpokenTest('hava durumu')).toBeNull();
  });
});

describe('sesle gezinme', () => {
  it('sayfa adı + açma fiili → ana pencere o sayfada', () => {
    const cases: Array<[string, string]> = [
      ['Ayarları aç.', 'settings'],
      ['ayarları göster', 'settings'],
      ['Planlar sayfasını aç.', 'planner'],
      ['planlar sayfasını açar mısın', 'planner'],
      ['Son sohbeti göster.', 'chat'],
      ['sohbet geçmişini aç', 'chat'],
      ['Ses ayarlarını aç.', 'settings/voice'],
      ['tanı sekmesini aç', 'settings/diagnostics'],
      ['gizlilik ayarlarına git', 'settings/privacy'],
      ['planlar sayfasını aç', 'planner'],
      ['hafızayı aç', 'memory'],
      ['yetenekler sayfasına git', 'skills'],
      ['projeler sayfasını göster', 'projects'],
      // demo.3 bütünleştirmesi: İşler (takip işleri) ve Toplantı sayfaları.
      ['İşler sayfasını aç.', 'watch'],
      ['işleri aç', 'watch'],
      ['takip işlerini aç', 'watch'],
      ['işler sayfasına git', 'watch'],
      ['Toplantı sayfasını aç.', 'meeting'],
      ['toplantılar sayfasına git', 'meeting'],
      ['toplantıları aç', 'meeting'],
      // E-posta hesapları Ayarlar'ın sekmesidir.
      ['E-posta ayarlarını aç.', 'settings/mail'],
      ['mail hesaplarını göster', 'settings/mail'],
      // Bugün = Kokpit (pano): "bugün / pano / ana ekran / kokpit".
      ['bugün sayfasını aç', 'today'],
      ['panoyu aç', 'today'],
      ['ana ekranı aç', 'today'],
      ['kokpiti aç', 'today'],
      ['pano ekranına git', 'today'],
    ];
    for (const [text, page] of cases) expect(route(text), text).toEqual({ name: 'app_navigate', input: { page } });
  });

  it('başka bir işi anlatan söz gezinme değildir', () => {
    for (const text of [
      'atlas projesini aç',
      'hesap makinesini aç',
      'Windows ayarlarını aç',
      'faturaları göster',
      'hatırlatıcıları göster',
      'example.com sitesini aç',
      'Atlas dosyasını aç',
      'hafızana kaydet',
      'ayarlar nerede',
      // Toplantı KİPİNİ başlatma isteği sayfa açma değildir (`meeting_start`); işlerin durumu bir sorudur (`watch_list`).
      'toplantı modunu aç',
      'toplantıyı başlat',
      'toplantıyı aç',
      'toplantıları göster',
      'işlerim ne durumda',
      'işleri göster',
      'yapılacak işleri aç',
      'kulaklık takibini aç',
      // E-postaya bakma bir sorudur (`mail_list`), sekme açma değil.
      'e-postalarıma bak',
      'e-postaları göster',
      "Ahmet'in e-postasını aç",
      // Bilgisayarın panosu (kopyalanan metin) Bugün sayfası değildir.
      'panoya kopyala',
      'panoda ne var göster',
      'panoyu göster',
    ]) {
      expect(route(text)?.name, text).not.toBe('app_navigate');
    }
  });

  it('katalog: kimlikle ("settings/voice") ve adla bulunur', () => {
    expect(findSpokenPage('settings/voice')).toMatchObject({ page: 'settings', tab: 'voice' });
    expect(findSpokenPage('planner')).toMatchObject({ page: 'planner', moduleId: 'planner' });
    expect(findSpokenPage('Planlar')).toMatchObject({ page: 'planner' });
    expect(findSpokenPage('ses ayarları')).toMatchObject({ page: 'settings', tab: 'voice' });
    expect(findSpokenPage('bilinmeyen')).toBeNull();
    expect(findSpokenPage('watch')).toMatchObject({ page: 'watch', moduleId: 'watch', label: 'İşler' });
    expect(findSpokenPage('meeting')).toMatchObject({ page: 'meeting', moduleId: 'meeting', label: 'Toplantı' });
    // Renderer'daki GERÇEK sayfalar (`renderer/main/pages/<id>/index.tsx` › `definePage`): katalog bunlarla birebir aynıdır;
    // yeni bir sayfa ekleyen görev kataloğa satır eklemezse (ya da sayfa kalkarsa) bu sınama kalır.
    const pagesDir = fileURLToPath(new URL('../../../renderer/main/pages/', import.meta.url));
    // Gizli sayfalar (JARVIS MODE: yalnız sesle açılır) ve kurulu eklentilerin sayfaları (plugins/*; `// PLUGIN-MODULES` işaretinin
    // üstüne yazılan modül kimlikleri) katalogda olmaz.
    const constants = readFileSync(fileURLToPath(new URL('../../../../../../packages/shared/src/constants.ts', import.meta.url)), 'utf8');
    const pluginBlock = constants.split('// plugins/*/install.mjs')[1]?.split('// PLUGIN-MODULES')[0] ?? '';
    const pluginModules = [...pluginBlock.matchAll(/'([a-z0-9-]+)',/g)].map((match) => match[1]!);
    const isCorePage = (source: string) => /definePage\(/.test(source) && !/hidden: true/.test(source) && !pluginModules.some((id) => source.includes(`moduleId: '${id}'`));
    const real = readdirSync(pagesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(pagesDir, entry.name, 'index.tsx')) && isCorePage(readFileSync(join(pagesDir, entry.name, 'index.tsx'), 'utf8')))
      .map((entry) => entry.name)
      .sort();
    expect([...new Set(SPOKEN_PAGES.map((item) => item.page))].sort()).toEqual(real);
    // Sayfanın modülü, sayfa tanımındaki `moduleId` ile aynıdır (modül kapalıyken sayfa da açılmaz).
    for (const item of SPOKEN_PAGES.filter((page) => !page.tab)) {
      const source = readFileSync(join(pagesDir, item.page, 'index.tsx'), 'utf8');
      const declared = /definePage\(\{[^}]*?moduleId: '([^']+)'/s.exec(source)?.[1];
      expect(item.moduleId, item.page).toBe(declared);
    }
  });

  it('uzun söz eşlenmez (başka bir iş taşıyabilir)', () => {
    expect(route('ayarları aç ve sonra bana yarınki toplantıları tek tek say lütfen hemen')).toBeNull();
  });
});

describe('"az önce" soruları', () => {
  it('kullanıcının sözü / asistanın sözü', () => {
    for (const text of ['Az önce ne söylemiştim?', 'demin ne dedim', 'Demin sana ne demiştim ben?', 'biraz önce ne sormuştum', 'az önce ne diyordum']) {
      expect(recallIntent(text), text).toBe('user');
    }
    for (const text of ['Az önce ne dedin?', 'demin ne demiştin', 'az önce bana ne söylemiştin sen']) expect(recallIntent(text), text).toBe('assistant');
  });

  it('uzak geçmiş, belirli konu ve ilgisiz söz bu yoldan geçmez', () => {
    for (const text of ['Dün ne söylemiştim?', 'geçen hafta ne konuşmuştuk', 'Az önce Kaan hakkında ne demiştim?', 'ne dedin?', 'az önce hangi projeden bahsetmiştim', 'şimdi ne yapıyorsun']) {
      expect(recallIntent(text), text).toBeNull();
    }
  });

  it('az önce söylenen bir ayrıntı sorusu', () => {
    expect(asksRecentDetail('Az önce hangi projeden bahsetmiştim?')).toBe(true);
    expect(asksRecentDetail('demin Kaan hakkında ne demiştim')).toBe(true);
    expect(asksRecentDetail('Az önce ne söylemiştim?')).toBe(false);
    expect(asksRecentDetail('dün hangi projeden bahsetmiştim')).toBe(false);
    expect(asksRecentDetail('hangi projeden bahsediyorsun')).toBe(false);
    // d6: üçüncü kişinin sözü ya da ileti kanalı okunacak bir kaynaktır; tur araçsız yürümemeli ("haberim yok" diyordu).
    expect(asksRecentDetail('Ahmet en son ne dedi')).toBe(false);
    expect(asksRecentDetail("WhatsApp'ta az önce Ayşe ne demiş")).toBe(false);
    // Kullanıcının kendi sözü ("demiştim") yine konuşmanın geçmişidir.
    expect(asksRecentDetail('az önce Kaan için ne demiştim')).toBe(true);
  });

  it('fare ve klavye sınaması (bilgisayar modülü): başlatma sözü `pc_selftest` aracına gider; ses sınamaları ve sorular karışmaz', () => {
    expect(routeSpokenCommand('Fare ve klavye sınamasını başlat.')).toEqual({ name: 'pc_selftest', input: {} });
    expect(routeSpokenCommand('Fare klavye sınamasını başlat')).toEqual({ name: 'pc_selftest', input: {} });
    expect(routeSpokenCommand('Bilgisayar kullanımını bir dene.')).toEqual({ name: 'pc_selftest', input: {} });
    // Ses sınaması adı geçiyorsa o başlar; soru ve durdurma başlatma değildir.
    expect(routeSpokenCommand('Mikrofon sınamasını başlat.')).toEqual({ name: 'voice_test_start', input: { test: 'mic' } });
    expect(routeSpokenCommand('Fare klavye sınaması ne oldu?')?.name).not.toBe('pc_selftest');
    expect(routeSpokenCommand('Fare klavye sınamasını durdur.')?.name).not.toBe('pc_selftest');
    // Sınama sözü yoksa (yalnız "klavyeyi aç") araç başlamaz.
    expect(routeSpokenCommand('Ekran klavyesini aç.')?.name).not.toBe('pc_selftest');
  });
});
