import { describe, expect, it } from 'vitest';
import { compactToolSpec } from './local-tool-specs';
import {
  groundingGroups,
  isLocalTool,
  localGroupOf,
  LOCAL_GROUP_TABLE,
  LOCAL_NEEDS_DEEP,
  LOCAL_SKILL_TOOL_LIMIT,
  LOCAL_TOOLS,
  LOCAL_TOOLS_BASE,
  LOCAL_TOOLS_CODE,
  LOCAL_TOOLS_DOCS,
  LOCAL_TOOLS_INFO,
  LOCAL_TOOLS_OPEN,
  LOCAL_TOOLS_PC,
  LOCAL_TOOLS_WORKSHOP,
  ownWords,
  selectLocalTools,
  selectSkillTools,
} from './local-tools';

const registered = [...LOCAL_TOOLS, 'stage_show_app', 'research_start', 'screen_look', 'archive_purge', 'skill_build', 'jbrowser_screenshot'];

describe('yerel modele sunulan araçlar', () => {
  it('listede olmayan araç hiçbir kipte sunulmaz; derin beyin isteyen araç derin beyin YOKKEN sunulmaz', () => {
    const said = ['hesap makinesini aç, internette araştır, ekrana bak, kendine yetenek geliştir, kendi tarayıcında sayfaya bak'];
    for (const mode of ['base', 'all', 'routed'] as const) {
      const shown = selectLocalTools(registered, said, mode, undefined, { deepBlocked: true });
      for (const name of ['stage_show_app', 'archive_purge', ...LOCAL_NEEDS_DEEP]) expect(shown, name).not.toContain(name);
    }
    // Derin beyin varken (ya da durumu bilinmezken) söz işaret ederse sunulurlar; söz işaret etmezse yine yokturlar.
    const open = selectLocalTools(registered, said, 'routed');
    for (const name of LOCAL_NEEDS_DEEP) expect(open, name).toContain(name);
    expect(open).not.toContain('stage_show_app');
    for (const name of LOCAL_NEEDS_DEEP) expect(selectLocalTools(registered, ['bugün biraz yorgunum'], 'routed'), name).not.toContain(name);
  });

  it('Atölye, araştırma, belge ve Claude Code kümeleri kendi sözleriyle açılır (öteki dalların araç adları)', () => {
    const shows = (said: string, names: readonly string[], options?: { deepBlocked?: boolean }) => {
      const shown = selectLocalTools(registered, [said], 'routed', undefined, options);
      for (const name of names) expect(shown, `${said} → ${name}`).toContain(name);
      return shown;
    };
    // Kullanıcı sorusu: bu araçlar listede yokken model "ekleyemem" diyordu.
    shows('Sana bir özellik ekle desem kendi kendine ekleyebiliyor musun?', LOCAL_TOOLS_WORKSHOP.filter((name) => name !== 'skill_remove'));
    shows('kendine döviz kurunu söyleyen bir yetenek geliştir', ['skill_build']);
    shows('hangi yeteneklerin var, say bakalım', ['skill_list']);
    // Derin beyin yokken yönetim araçları kalır, geliştirme aracı gelmez.
    const blocked = shows('döviz yeteneğini kapat', ['skill_enable', 'skill_list'], { deepBlocked: true });
    expect(blocked).not.toContain('skill_build');
    // Söz kapısı: silen araç yalnız "kaldır" / "sil" denince (ya da bir önceki sözde denmişse) modelin önüne gelir.
    expect(blocked, '"kapat" sözünde silme aracı sunulmaz').not.toContain('skill_remove');
    for (const said of ['döviz yeteneğini kaldır', 'Köprü zarı yeteneğini kalıcı olarak kaldır.', 'şu zar yeteneğini siler misin', 'zar özelliğini sil']) {
      shows(said, ['skill_remove', 'skill_enable']);
    }
    expect(selectLocalTools(registered, ['evet, o yeteneği', 'döviz yeteneğini kaldır'], 'routed'), 'devam cümlesi').toContain('skill_remove');
    expect(selectLocalTools(registered, ['silah yeteneğini kapat'], 'routed'), '"silah" silme sözü değildir').not.toContain('skill_remove');
    expect(selectLocalTools(registered, ['bugün biraz yorgunum'], 'all'), '`all` kipinde kapı uygulanmaz').toContain('skill_remove');
    shows('yapay zekâ pazarını derinlemesine araştır ve rapor hazırla', ['research_start', 'web_search']);
    shows("ekteki PDF'te son ödeme günü ne zaman?", LOCAL_TOOLS_DOCS);
    shows('KDV beyannamesinde son ödeme günü ne yazıyor?', ['document_read']);
    shows('masaüstündeki sözleşmenin özetini Word yap', ['document_read', 'document_create', 'file_list']);
    shows('(Bu iletiye eklenen dosyalar: rapor.pdf [attachment_id: att_1]) bunu özetle', ['document_read']);
    shows('faturada ödenecek tutar ne kadar?', ['document_read']);
    // "Beyanname" tek başına belge işareti değildir: sık söylenen bu sözlerde belge kümesi açılmaz (19 araç oluyordu).
    for (const said of ['yarın saat onda KDV beyannamesini hatırlat', "her ayın 28'inde KDV beyannamesini vermem gerektiğini hatırlat", 'faturayı ödedim', 'bu ay ne var?']) {
      expect(selectLocalTools(registered, [said], 'routed'), said).not.toContain('document_read');
    }
    shows("Claude'a atlas projesinde testleri düzelttir", ['code_session_start']);
    shows('oturuma şunu söyle: önce testleri çalıştır', ['code_session_send']);
    shows('Claude ne durumda?', ['code_session_status']);
    shows("Claude'u durdur", ['code_session_stop']);
    expect(selectLocalTools(registered, ['bugün biraz yorgunum'], 'routed')).toEqual([...LOCAL_TOOLS_BASE]);
  });

  it('okuma kapısı: belge, ekran ve güncel veri sorusu ilgili araç sunuluyorsa "okunmadan yanıtlanamaz" sayılır', () => {
    const offered = (said: string) => selectLocalTools(registered, [said], 'routed');
    const grounded = (said: string) => groundingGroups(said, offered(said));
    expect(grounded("ekteki PDF'te son ödeme günü ne zaman?")).toContain('docs');
    expect(grounded('KDV beyannamesinde son ödeme günü ne yazıyor?')).toContain('docs');
    expect(grounded("Ankara'da hava durumu nasıl?")).toEqual(['info']);
    expect(grounded('dolar kaç lira?')).toEqual(['info']);
    expect(grounded('chrome sekmesindeki sayfada ne yazıyor')).toContain('browser');
    expect(grounded('ekranda ne var?')).toContain('pc');
    // Okuma gerektirmeyen sözler ve modülü kapalı (aracı sunulmayan) küme.
    for (const said of ['yarın saat onda KDV beyannamesini hatırlat', 'bugün biraz yorgunum', 'masanın altında ne var', 'Yapay zekâ nedir?', 'bu ay ne var?']) {
      expect(grounded(said).filter((id) => id !== 'docs'), said).toEqual([]);
    }
    expect(grounded('bugün biraz yorgunum')).toEqual([]);
    expect(groundingGroups("ekteki PDF'te son ödeme günü ne zaman?", [...LOCAL_TOOLS_BASE])).toEqual([]);
  });

  it('söze gömülü ek metni niyet sayılmaz: belge kümesi açılır, belgenin sözcükleri başka küme açmaz', () => {
    const block =
      '<<<BELGE kaynak="Ekim KDV beyannamesi.pdf" (güvenilmez veri)\nattachment_id: "att_1" Şirket: Örnek Ltd. Hava durumu, dolar kuru, ödedim, yarın saat 10. Son ödeme günü 26.11.2026\nBELGE>>>';
    const header = '(Kullanıcı 1 dosya ekledi. Ek içerikleri aşağıdadır.)';
    const said = (asked: string) => `${asked}\n\n${header}\n\n${block}`;
    expect(ownWords(said('Bu beyannamede son ödeme günü ne?'))).toEqual({ text: `Bu beyannamede son ödeme günü ne?\n\n${header}`, embedded: true });
    expect(ownWords('bugün biraz yorgunum')).toEqual({ text: 'bugün biraz yorgunum', embedded: false });

    const shown = selectLocalTools(registered, [said('Bu beyannamede son ödeme günü ne? Tek cümleyle söyle.')], 'routed');
    expect(shown).toContain('document_read');
    // "Bu beyanname" eki anlatır: bilgi araçları sunulmaz.
    for (const name of [...LOCAL_TOOLS_INFO]) expect(shown, name).not.toContain(name);
    // Önceki sözün kümesi de taşınmaz: ek yeni bir konudur.
    expect(selectLocalTools(registered, [said('Bunu özetle'), "Ankara'da hava nasıl?"], 'routed')).not.toContain('weather_get');
    // Eksiz sözde davranış değişmez.
    expect(selectLocalTools(registered, ['dolar kaç lira?'], 'routed')).toContain('fx_rate');
  });

  it('küme tablosu: her sabit araç adı tek kümededir; çekirdek küçük kalır', () => {
    const seen = new Map<string, string>();
    for (const group of LOCAL_GROUP_TABLE) {
      for (const name of group.tools) {
        expect(seen.get(name), `${name} iki kümede: ${seen.get(name)} ve ${group.id}`).toBeUndefined();
        seen.set(name, group.id);
        expect(localGroupOf(name)).toBe(group.id);
      }
    }
    expect(LOCAL_TOOLS_BASE.length).toBeLessThanOrEqual(10);
    expect(seen.size).toBe(LOCAL_TOOLS.size);
    for (const name of LOCAL_TOOLS_CODE) expect(name.startsWith('code_session_')).toBe(true);
  });

  it('base yalnız çekirdek kümeyi, all çağrılabilen her şeyi verir; çekirdek hep başta ve aynı sırada', () => {
    expect(selectLocalTools(registered, ['merhaba'], 'base')).toEqual([...LOCAL_TOOLS_BASE]);
    const all = selectLocalTools(registered, ['merhaba'], 'all');
    expect(all).toHaveLength(LOCAL_TOOLS.size);
    expect(all.slice(0, LOCAL_TOOLS_BASE.length)).toEqual([...LOCAL_TOOLS_BASE]);
  });

  it('routed: gündelik sözde yalnız çekirdek; bilgi sorusunda bilgi araçları gelir, açma araçları GELMEZ', () => {
    expect(selectLocalTools(registered, ['bugün biraz yorgunum'], 'routed')).toEqual([...LOCAL_TOOLS_BASE]);
    // Sınamada görüldü: bu iki sözde model tarayıcı açmıştı.
    for (const said of ["Ankara'nın hava durumunu bana bir söyler misin?", "Google'a sor. Google'a yaz bakalım, Ankara Hava Durumu nasıl de, bana oradaki bilgiyi al."]) {
      const shown = selectLocalTools(registered, [said], 'routed');
      for (const name of LOCAL_TOOLS_INFO) expect(shown, said).toContain(name);
      for (const name of LOCAL_TOOLS_OPEN) expect(shown, said).not.toContain(name);
    }
  });

  it('routed: açma araçları yalnız açma sözünde', () => {
    for (const said of ['hesap makinesini aç', 'example.com sitesini aç', 'Not Defteri uygulamasını başlat', 'https://example.org adresine git', 'Atlas projesini AÇ']) {
      const shown = selectLocalTools(registered, [said], 'routed');
      for (const name of LOCAL_TOOLS_OPEN) expect(shown, said).toContain(name);
    }
    for (const said of ['yarın saat onda KDV beyannamesini hatırlat', 'açıklama yaz', 'bu ay ne var?', 'kaç tane hatırlatıcım var']) {
      expect(selectLocalTools(registered, [said], 'routed'), said).not.toContain('url_open');
    }
  });

  it('routed: proje, liste ve ekran sözleri kendi gruplarını açar', () => {
    const shows = (said: string, name: string) => expect(selectLocalTools(registered, [said], 'routed'), `${said} → ${name}`).toContain(name);
    shows('tarif blogu projesi hangi klasörde?', 'project_find');
    shows('atlas projesini aç', 'project_open');
    shows('üç maddelik bir alışveriş listesi oluştur ve yapılacaklara ekle', 'todo_add_many');
    shows('o hatırlatıcıyı iptal et', 'reminder_cancel');
    shows('bana yarınki işlerimi göster', 'stage_show_card');
    shows('yarım saat uyandırma sözünü dinleme', 'voice_pause_listening');
    shows('dolar kaç lira?', 'fx_rate');
    shows('bugün gündemde ne var, son dakika haber var mı', 'news_get');
    shows('chrome sekmesindeki sayfada ne yazıyor', 'browser_read');
    shows("atlas projesinde claude'a testleri düzelttir", 'code_session_start');
  });

  it('routed: devam cümlesinde bir önceki söz de niyeti taşır; bu sözün grupları önce gelir', () => {
    expect(selectLocalTools(registered, ['evet', 'hesap makinesini aç'], 'routed')).toContain('app_open');
    // İki sözden eskisi artık niyet taşımaz.
    expect(selectLocalTools(registered, ['teşekkürler', 'evet', 'hesap makinesini aç'], 'routed')).not.toContain('app_open');
    const shown = selectLocalTools(registered, ['dolar kaç lira?', 'o hatırlatıcıyı iptal et'], 'routed');
    expect(shown.indexOf('fx_rate')).toBeLessThan(shown.indexOf('reminder_cancel'));
  });

  it('adı bir grubun önekiyle başlayan yeni araç, ad listesine eklenmeden çağrılabilir; derin araçlar hariç', () => {
    expect(isLocalTool('weather_week')).toBe(true);
    expect(isLocalTool('pc_drag')).toBe(true);
    expect(isLocalTool('claude_resume')).toBe(true);
    expect(isLocalTool('code_session_resume')).toBe(true);
    expect(isLocalTool('document_convert')).toBe(true);
    expect(isLocalTool('stage_show_app')).toBe(false);
    expect(isLocalTool('archive_purge')).toBe(false);
    expect(selectLocalTools([...registered, 'weather_week'], ['yarın yağmur var mı'], 'routed')).toContain('weather_week');
    expect(selectLocalTools([...registered, 'pc_drag'], ['pencereyi büyüt'], 'routed')).toEqual(expect.arrayContaining(['pc_drag', ...LOCAL_TOOLS_PC]));
  });

  it('tanımdaki küme (`ToolDef.group`) ad listesinden ve önekten önce gelir', () => {
    const declared = (name: string) => ({ takvim_bak: 'info', hizli_not: 'core', derin_is: 'deep', pc_ozel: 'deep', garip: 'bilinmeyen' })[name];
    const all = [...registered, 'takvim_bak', 'hizli_not', 'derin_is', 'pc_ozel', 'garip'];
    expect(localGroupOf('takvim_bak', 'info')).toBe('info');
    expect(localGroupOf('pc_ozel', 'deep')).toBe('deep');
    expect(localGroupOf('garip', 'bilinmeyen')).toBeNull();
    const plain = selectLocalTools(all, ['merhaba'], 'routed', declared);
    expect(plain).toEqual([...LOCAL_TOOLS_BASE, 'hizli_not']);
    const info = selectLocalTools(all, ['dolar kaç lira'], 'routed', declared);
    expect(info).toContain('takvim_bak');
    const everything = selectLocalTools(all, ['merhaba'], 'all', declared);
    for (const name of ['derin_is', 'pc_ozel', 'garip']) expect(everything, name).not.toContain(name);
    expect(isLocalTool('derin_is', 'deep')).toBe(false);
  });

  it('tarayıcı ve bilgisayar kümeleri ayrı sözlerle açılır; ekrana bakma derin beyin yokken sunulmaz', () => {
    const browser = selectLocalTools(registered, ["Google'da ara: Ankara otelleri, tarayıcıda aç"], 'routed');
    expect(browser).toEqual(expect.arrayContaining(['browser_search', 'browser_navigate']));
    expect(browser).not.toContain('pc_click');
    const pc = selectLocalTools(registered, ['şu pencereyi küçült'], 'routed');
    expect(pc).toEqual(expect.arrayContaining(['pc_windows', 'pc_window_action']));
    expect(pc).not.toContain('browser_search');
    expect(selectLocalTools(registered, ['ekranda ne var bak'], 'routed', undefined, { deepBlocked: true })).not.toContain('screen_look');
    expect(selectLocalTools(registered, ['ekranda ne var bak'], 'routed')).toContain('screen_look');
  });

  it('yetenek araçları: yalnız `skill:` modüllerinin araçları, ada göre sıralı, sınırla kesilir', () => {
    const tools = [
      { name: 'reminder_create', moduleId: 'planner' },
      { name: 'zar_at', moduleId: 'skill:zar' },
      { name: 'doviz_kuru', moduleId: 'skill:doviz' },
      ...Array.from({ length: 10 }, (_, index) => ({ name: `ek_${index}`, moduleId: 'skill:cok' })),
    ];
    const shown = selectSkillTools(tools);
    expect(shown).toHaveLength(LOCAL_SKILL_TOOL_LIMIT);
    expect(shown).not.toContain('reminder_create');
    expect(selectSkillTools(tools.slice(0, 3))).toEqual(['doviz_kuru', 'zar_at']);
  });
});

describe('yerel modele giden araç tanımının kısaltılması', () => {
  const reminder = {
    name: 'reminder_create',
    description: 'Uzun açıklama. '.repeat(40),
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', minLength: 1, description: 'Ne hatırlatılacak; kullanıcının diliyle kısa' },
        due_at: { type: 'string', description: 'İlk çalma anı' },
        recurrence: {
          type: 'object',
          properties: {
            freq: { type: 'string', enum: ['daily', 'weekly', 'monthly', 'yearly'], description: 'Tekrar birimi' },
            interval: { type: 'integer', minimum: 1, maximum: 9007199254740991, default: 1 },
            until: { type: 'string', description: 'Bu andan sonra tekrar etmez' },
          },
          required: ['freq'],
          description: 'Tekrar kuralı',
        },
        priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
      },
      required: ['text'],
      additionalProperties: false,
    },
  };

  it('bilinen araç: kısa açıklama, gizlenen alanlar düşer, kısıt ayrıntıları atılır, zorunlular kalır', () => {
    const spec = compactToolSpec(reminder);
    const schema = spec.inputSchema as { properties: Record<string, { properties?: Record<string, unknown>; minLength?: number }>; required: string[]; additionalProperties?: unknown };
    expect(spec.description.length).toBeLessThan(120);
    expect(Object.keys(schema.properties)).toEqual(['text', 'due_at', 'recurrence']);
    expect(Object.keys(schema.properties.recurrence!.properties!)).toEqual(['freq']);
    expect(schema.properties.text!.minLength).toBeUndefined();
    expect(schema.additionalProperties).toBeUndefined();
    expect(schema.required).toEqual(['text']);
    expect(JSON.stringify(spec).length).toBeLessThan(JSON.stringify(reminder).length * 0.6);
  });

  it('bilinmeyen araç (yetenek, yeni modül aracı): ilk cümle ve budanmış şema; nullable alan sadeleşir', () => {
    const spec = compactToolSpec({
      name: 'zar_at',
      description: 'Zar atar ve sonucu söyler. Kullanıcı şans oyunu isterse kullan; ayrıntılı kurallar şöyle şöyle.',
      inputSchema: {
        type: 'object',
        properties: {
          sides: { type: 'integer', minimum: 2, maximum: 100, description: 'Yüz sayısı. Varsayılan altı; daha büyük zarlar için değiştir.' },
          note: { anyOf: [{ type: 'string', maxLength: 50 }, { type: 'null' }], description: 'Not' },
        },
        required: ['sides', 'yok'],
      },
    });
    expect(spec.description).toBe('Zar atar ve sonucu söyler.');
    expect(spec.inputSchema).toEqual({
      type: 'object',
      properties: { sides: { type: 'integer', description: 'Yüz sayısı.' }, note: { type: 'string', description: 'Not' } },
      required: ['sides'],
    });
  });

  it('parametresiz araçta şema boş nesnedir', () => {
    expect(compactToolSpec({ name: 'self_status', description: 'x', inputSchema: { type: 'object', properties: {} } }).inputSchema).toEqual({ type: 'object', properties: {} });
  });
});

describe('proje adı + iş → Claude Code oturumu (demo.5)', () => {
  it('"X projemde şunu yap", "X\'te Claude\'a yaptır", "oturuma devam etsin", "hangi oturumlar çalışıyor" kod kümesini açar', () => {
    for (const said of [
      'Atlas Labs projemde giriş sayfasını düzelt',
      'Atlas projesinde fiyat tablosuna yeni satır ekle',
      'Orbit projesindeki hataya bak',
      "Projemde Claude'a testleri yaptır",
      'Atlas projesindeki oturuma devam etmesini söyle',
      'Claude ne durumda?',
      'hangi oturumlar çalışıyor',
    ]) {
      const shown = selectLocalTools(registered, [said], 'routed');
      for (const name of ['code_session_start', 'code_session_send', 'code_session_status']) expect(shown, `${said} → ${name}`).toContain(name);
    }
    // Projeyi açmak kod işi değildir.
    expect(selectLocalTools(registered, ['Atlas projesini aç'], 'routed')).not.toContain('code_session_start');
  });
});
