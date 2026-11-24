// Yerel modele açılan araçların GERÇEK tanımlarla uyumu (demo.2 bütünleştirme).
// `core/brain/local-tools.ts` ve `local-tool-specs.ts` araç adlarını ve alan adlarını elle taşır (beyin, modülleri içe
// aktarmaz). Bu dosya modüllerin gerçek araç tanımlarını toplar ve üç şeyi güvenceye alır:
//   1. elle yazılmış her ad gerçekten var; her aracın tanımındaki küme (`ToolDef.group`) ad listesiyle aynı kümeyi verir;
//   2. yerel kısa tanımda adı geçen her alan aracın gerçek (zod) şemasında var;
//   3. her kümeden en az bir araç, o işi isteyen gündelik bir sözde yerel modele sunulur (ve ilgisiz sözde sunulmaz).
import os from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import type { ToolDef } from '@fuber/shared';
import { z } from 'zod';
import { COMPACT_SPEC_PATHS } from '../core/brain/local-tool-specs';
import {
  LOCAL_GROUP_TABLE,
  LOCAL_NEEDS_DEEP,
  LOCAL_TOOLS,
  LOCAL_TOOLS_BASE,
  isLocalTool,
  localGroupOf,
  previousReplyOf,
  routingTexts,
  selectLocalTools,
  type LocalGroupId,
} from '../core/brain/local-tools';
import ambient from './ambient/index';
import briefing from './briefing/index';
import { browserTools } from './browser/tools';
import dashboardModule from './dashboard/index';
import jarvisModule from './jarvis/index';
import documents from './documents/index';
import meeting from './meeting/index';
import mail from './mail/index';
import memory from './memory/index';
import news from './news/index';
import { deviceControlTools, deviceReadTools } from './pc/device';
import { fileControlTools, fileReadTools } from './pc/files';
import pc from './pc/index';
import { selftestTool } from './pc/selftest';
import { systemControlTools, systemReadTools } from './pc/system';
import { controlTools, readTools } from './pc/tools';
import planner from './planner/index';
import projects from './projects/index';
import stage from './stage/index';
import voiceControl from './voice-control/index';
import watch from './watch/index';
import web from './web/index';
import workshop from './workshop/index';

// Atölye ve bilgisayar modülleri yüklenirken Electron'un `app` nesnesine bakar (`runtime.ts`); burada yalnız araç
// tanımları okunur, hiçbir şey çalıştırılmaz.
vi.mock('electron', () => ({ app: { isPackaged: false, commandLine: { getSwitchValue: () => '' }, getPath: () => os.tmpdir() } }));

/** Bütün yerleşik modüllerin araç tanımları. Bilgisayar modülünün okuma/kullanma araçları izne göre çalışma anında kaydedilir. */
const DEFS: ToolDef[] = [
  ...[voiceControl, memory, planner, stage, dashboardModule, jarvisModule, projects, web, workshop, ambient, documents, mail, pc, meeting, watch, news, briefing].flatMap((module) => module.tools ?? []),
  // Tanımlar yalnız okunur (ad, küme, şema); araçlar çalıştırılmaz, bu yüzden bağımlılık verilmez.
  ...readTools({ uia: {}, screens: () => [] } as never),
  ...controlTools({} as never),
  // Asistanın kendi tarayıcısı: araçlar izne göre çalışma anında kaydedilir.
  ...browserTools({ driver: {} as never }),
  // d3: dosya, komut/süreç, pano/sistem araçları ve fare-klavye sınaması (`app_close` okuyucu ve sürücü varken sunulur).
  ...fileReadTools({} as never),
  ...fileControlTools({} as never),
  ...systemReadTools({} as never),
  ...systemControlTools({ uia: {}, input: {} } as never),
  ...deviceReadTools({} as never),
  ...deviceControlTools({} as never),
  selftestTool(async () => ({ ok: false, stopped: null, steps: [], ms: 0 })),
];
const byName = new Map(DEFS.map((def) => [def.name, def]));
const declared = (name: string) => byName.get(name)?.group;

describe('yerel modele açılan araçlar: gerçek tanımlarla uyum', () => {
  it('araç adları tekildir', () => {
    expect(DEFS.length).toBe(byName.size);
    expect(DEFS.length).toBeGreaterThan(70);
  });

  it('yerel listelerde elle yazılmış her ad gerçek bir araçtır', () => {
    const missing = [...LOCAL_TOOLS, ...LOCAL_NEEDS_DEEP, ...Object.keys(COMPACT_SPEC_PATHS)].filter((name) => !byName.has(name));
    expect(missing).toEqual([]);
  });

  it('her aracın tanımındaki küme, ad listesinin verdiği kümeyle aynıdır; listedeki her araç etiketlidir', () => {
    for (const def of DEFS) {
      const byList = localGroupOf(def.name);
      if (def.group !== undefined) {
        // Etiket bilinen bir küme olmalı (bilinmeyen etiket sessizce yok sayılırdı).
        expect(localGroupOf('__adsiz__', def.group), `${def.name}: bilinmeyen küme "${def.group}"`).toBe(def.group);
        // Etiket, elle tutulan listeyle çelişmemeli (liste aracı tanıyorsa).
        if (LOCAL_TOOLS.has(def.name)) expect(def.group, def.name).toBe(byList);
      }
      if (LOCAL_TOOLS.has(def.name)) expect(def.group, `${def.name} listede ama tanımında küme yok`).toBe(byList);
    }
  });

  it('yerel modele açılan araçların ve kümelerin tablosu (bu sayılar değişirse `local-llm-eval` yeniden koşulmalı)', () => {
    const table = Object.fromEntries(
      LOCAL_GROUP_TABLE.map((group) => [
        group.id,
        DEFS.filter((def) => localGroupOf(def.name, def.group) === group.id)
          .map((def) => def.name)
          .sort(),
      ]),
    ) as Record<LocalGroupId, string[]>;
    expect(table).toEqual({
      core: ['memory_save', 'memory_search', 'reminder_create', 'reminder_list', 'self_status', 'todo_add', 'todo_list', 'voice_mute_mic', 'voice_set_quiet', 'voice_stop_speaking'],
      planner: ['reminder_cancel', 'todo_add_many', 'todo_done'],
      stage: ['stage_show_card'],
      dashboard: ['dashboard_card_add', 'dashboard_card_move', 'dashboard_card_remove', 'dashboard_card_update', 'dashboard_layout', 'dashboard_state', 'suggestion_add'],
      docs: ['document_create', 'document_read', 'document_search', 'file_list'],
      mail: ['mail_draft', 'mail_import_thunderbird', 'mail_list', 'mail_read', 'mail_send'],
      projects: ['project_find', 'project_open'],
      code: ['code_session_open', 'code_session_search', 'code_session_send', 'code_session_start', 'code_session_status', 'code_session_stop'],
      workshop: ['skill_apply_update', 'skill_build', 'skill_enable', 'skill_info', 'skill_list', 'skill_open_page', 'skill_remove', 'skill_rollback', 'skill_update'],
      // `voice_end_conversation`: veda sözünde kodla çalışır (`farewell.ts`); model yalnız "sohbeti bitir" gibi sözde görür.
      voice: ['voice_end_conversation', 'voice_pause_listening', 'voice_status'],
      // "Her şeyi konuşarak" (demo.3): sesle ayar, sınama başlatma, gezinme.
      settings: ['app_navigate', 'jarvis_mode', 'settings_list', 'settings_set', 'voice_test_start'],
      ambient: ['ambient_day_summary', 'ambient_forget_recent', 'ambient_pause', 'ambient_search', 'ambient_set'],
      meeting: ['meeting_recall', 'meeting_start', 'meeting_stop', 'meeting_summary'],
      info: ['day_info', 'fx_rate', 'news_get', 'weather_get', 'web_read', 'web_search'],
      research: ['research_start'],
      open: ['app_open', 'url_open'],
      jbrowser: ['jbrowser_back', 'jbrowser_click', 'jbrowser_key', 'jbrowser_open', 'jbrowser_read', 'jbrowser_screenshot', 'jbrowser_scroll', 'jbrowser_select', 'jbrowser_tabs', 'jbrowser_type', 'jbrowser_wait', 'jbrowser_window'],
      browser: ['browser_navigate', 'browser_read', 'browser_search', 'browser_tabs'],
      watch: ['watch_cancel', 'watch_list', 'watch_pause', 'watch_resume', 'watch_start', 'watch_status'],
      // Brifing, gündem kaynakları ve profil (d4-jarvis): kendiliğinden konuşmanın ayarı, RSS kaynakları, "beni nasıl tanıyorsun".
      briefing: ['briefing_now', 'briefing_set', 'briefing_status', 'feed_add', 'feed_list', 'feed_news', 'feed_remove', 'feed_topic', 'profile_get'],
      pc: [
        'pc_click', 'pc_drag', 'pc_find', 'pc_focus_window', 'pc_keys', 'pc_media', 'pc_read_window', 'pc_screens', 'pc_scroll', 'pc_selftest', 'pc_type',
        'pc_window_action', 'pc_window_arrange', 'pc_windows', 'screen_look',
      ],
      // d3: bilgisayar modülünün dosya yönetimi ve sistem araçları (geri alınamayanlar söz kapılıdır).
      files: ['file_copy', 'file_delete', 'file_edit', 'file_find', 'file_move', 'file_open', 'file_reveal', 'file_write', 'folder_create'],
      system: [
        'app_close', 'app_list', 'clipboard_read', 'clipboard_write', 'network_status', 'notify_show', 'pc_run_command', 'process_kill', 'process_list',
        'process_output', 'process_stop', 'screenshot_save', 'system_brightness', 'system_info', 'system_lock', 'system_power', 'system_power_cancel',
      ],
    });
    // Yerel modele HİÇ sunulmayanlar (bulut beyni görür): düzenleme/silme araçları ve Atölye'nin iç araçları.
    const hidden = DEFS.filter((def) => !isLocalTool(def.name, def.group))
      .map((def) => def.name)
      .sort();
    expect(hidden).toEqual([
      // Yetki düzeyi: sesli sözde kodla çözülür (`core/authority.ts` › `routeAuthoritySpeech`); yerel modele sunulmaz.
      'authority_set',
      'jbrowser_download',
      'mail_attachment_save',
      'memory_forget',
      'memory_update',
      // Toplu bilgisayar eylemi: iç içe adım şeması küçük modeli bozar; yerel model adımları tek tek atar.
      'pc_do',
      // Profil kaydı ve silme konuşan beynin (Claude Code) işidir; yerelde açık sözler kodla öğrenilir.
      'profile_forget',
      'profile_note',
      'project_list_recent',
      'reminder_update',
      'stage_close',
      'stage_show_app',
      'todo_update',
    ]);
    expect(LOCAL_TOOLS_BASE.length).toBe(10);
  });

  it('yerel kısa tanımda adı geçen her alan aracın gerçek şemasında vardır', () => {
    /** Noktalı yolu JSON Schema'da izler: nesne alanı, dizi öğesi ve `nullable` (anyOf) içinden geçer. */
    const has = (schema: unknown, parts: string[]): boolean => {
      if (typeof schema !== 'object' || schema === null) return false;
      const node = schema as { properties?: Record<string, unknown>; items?: unknown; anyOf?: unknown[]; oneOf?: unknown[] };
      if (parts.length === 0) return true;
      const variants = node.anyOf ?? node.oneOf;
      if (variants) return variants.some((variant) => has(variant, parts));
      if (node.items !== undefined && !node.properties) return has(node.items, parts);
      const [head, ...rest] = parts;
      return node.properties !== undefined && head! in node.properties && has(node.properties[head!], rest);
    };
    const wrong: string[] = [];
    for (const [name, paths] of Object.entries(COMPACT_SPEC_PATHS)) {
      const def = byName.get(name);
      if (!def) continue; // ad denetimi yukarıda
      const schema = z.toJSONSchema(def.input, { io: 'input', unrepresentable: 'any' });
      for (const path of paths) if (!has(schema, path.split('.'))) wrong.push(`${name}.${path}`);
    }
    expect(wrong).toEqual([]);
  });

  it('her kümeden en az bir araç, o işi isteyen sözde sunulur; gündelik sözde yalnız çekirdek sunulur', () => {
    const available = DEFS.map((def) => def.name);
    const offered = (text: string, previous?: string) => selectLocalTools(available, previous ? [text, previous] : [text], 'routed', declared);
    const cases: Array<[LocalGroupId, string, string]> = [
      ['planner', 'alışveriş listesine süt, ekmek ve yumurta ekle', 'todo_add_many'],
      ['stage', 'vergi takvimini ekranda göster', 'stage_show_card'],
      ['dashboard', 'panoya dolar hedefimi gösteren bir kart ekle', 'dashboard_card_add'],
      ['dashboard', 'hava kartını kaldır', 'dashboard_card_remove'],
      ['dashboard', 'hava durumunu ana ekranda farklı bir yere koy', 'dashboard_card_move'],
      ['dashboard', 'dövizi yukarı al', 'dashboard_card_move'],
      ['dashboard', 'haberler kutusunu büyüt', 'dashboard_card_move'],
      ['dashboard', 'ana ekranda hangi kartlar var', 'dashboard_state'],
      ['docs', 'masaüstündeki pdf belgesini oku', 'document_read'],
      ['docs', 'rapor.pdf içinde son ödeme günü ne yazıyor', 'document_read'],
      ['mail', 'e-postalarıma bak', 'mail_list'],
      ['mail', "Ahmet'ten mail geldi mi", 'mail_list'],
      ['mail', 'şuna yanıt yaz', 'mail_draft'],
      ['workshop', 'bunu yapabilir hale gel', 'skill_build'],
      ['workshop', 'artık şunu da yap: her sabah kuru söyle', 'skill_build'],
      ['workshop', 'bunu yapabilecek bir eklenti yaz', 'skill_build'],
      ['projects', 'atlas projesini aç', 'project_open'],
      ['code', "Claude'a atlas projesinde testleri düzelttir", 'code_session_start'],
      ['workshop', 'kendine döviz çeviren bir yetenek geliştir', 'skill_build'],
      ['voice', 'beş dakika beni dinleme, uyandırmayı duraklat', 'voice_pause_listening'],
      ['settings', 'sessiz saatleri gece on birden sabah yediye ayarla', 'settings_set'],
      ['settings', 'hangi sınamalar var', 'voice_test_start'],
      ['settings', 'planlar sayfasına bir bakmak istiyorum', 'app_navigate'],
      ['settings', 'bilgisayarımı kullanma iznini kapat', 'settings_set'],
      ['ambient', 'bugün ne konuştuk', 'ambient_day_summary'],
      ['ambient', 'dün toplantıda ne karar verdik', 'ambient_search'],
      ['ambient', 'ortam dinlemeyi duraklat', 'ambient_pause'],
      ['ambient', 'son on dakikayı unut', 'ambient_forget_recent'],
      ['meeting', 'toplantı modunu aç', 'meeting_start'],
      ['meeting', 'toplantıyı bitir', 'meeting_stop'],
      ['meeting', 'toplantıyı özetle', 'meeting_summary'],
      ['meeting', 'geçen toplantıda ne karar verdik', 'meeting_recall'],
      ['info', "Kadıköy'de hava nasıl", 'weather_get'],
      ['info', 'dolar kaç lira', 'fx_rate'],
      ['research', 'elektrikli araç pazarını derinlemesine araştır', 'research_start'],
      ['open', 'hesap makinesini aç', 'app_open'],
      ['jbrowser', 'kendi tarayıcında e-devlete gir', 'jbrowser_open'],
      ['jbrowser', 'muhasebe paneline gir ve faturayı indir', 'jbrowser_click'],
      ['browser', 'tarayıcıda açık sekmeleri söyle', 'browser_tabs'],
      ['pc', 'not defterine merhaba yaz', 'pc_type'],
      ['pc', 'ekranda ne var, ekrana bak', 'screen_look'],
      ['briefing', 'daha az konuş', 'briefing_set'],
      ['briefing', 'sabah brifingini sekizde ver', 'briefing_set'],
      ['briefing', 'bana brifing ver', 'briefing_now'],
      ['briefing', 'şu RSS kaynağını kendine ekle: webrazzi.com', 'feed_add'],
      ['briefing', 'yapay zekâ haberlerini takip et', 'feed_topic'],
      ['briefing', 'kaynaklarını say', 'feed_list'],
      ['briefing', 'beni nasıl tanıyorsun', 'profile_get'],
      ['watch', 'şu sayfayı takip et, fiyat düşünce söyle', 'watch_start'],
      ['watch', 'Claude atlas projesini bitirince haber ver', 'watch_start'],
      ['watch', 'işlerim ne durumda', 'watch_list'],
      ['watch', 'şu işi iptal et', 'watch_cancel'],
      ['watch', 'fiyat takibini iptal et', 'watch_cancel'],
      ['pc', 'chrome ile not defterini yan yana diz', 'pc_window_arrange'],
      ['pc', 'fare ve klavyeyi sına', 'pc_selftest'],
      ['files', 'masaüstündeki rapor dosyasını arşiv klasörüne kopyala', 'file_copy'],
      ['files', 'eski taslak dosyasını sil', 'file_delete'],
      ['files', 'masaüstüne notlar adında bir metin dosyası yaz', 'file_write'],
      ['files', 'notlar dosyasındaki tarihi düzelt', 'file_edit'],
      ['system', 'arka plandaki komutun çıktısına bak', 'process_output'],
      ['system', 'bilgisayarda ne kadar bellek boş', 'system_info'],
      ['system', 'panodaki metni oku', 'clipboard_read'],
      ['system', 'powershell komutu çalıştır: klasördeki pdf dosyalarını say', 'pc_run_command'],
      ['system', 'bilgisayarı yeniden başlat', 'system_power'],
    ];
    for (const [group, text, tool] of cases) {
      const names = offered(text);
      expect(names, `"${text}" → ${tool}`).toContain(tool);
      expect(localGroupOf(tool, declared(tool)), tool).toBe(group);
      // Çekirdek her turda başta ve aynı sırada.
      expect(names.slice(0, LOCAL_TOOLS_BASE.length)).toEqual([...LOCAL_TOOLS_BASE]);
    }
    const covered = new Set(cases.map(([group]) => group));
    for (const group of LOCAL_GROUP_TABLE) if (group.id !== 'core') expect(covered.has(group.id), `küme sınanmadı: ${group.id}`).toBe(true);

    // Gündelik söz: yalnız çekirdek. Bir şey açan, yazan, tıklayan ya da ortam kaydına bakan araç sunulmaz.
    for (const text of ['merhaba, nasılsın', 'yarın saat onda toplantıyı hatırlat', 'bunu aklında tut: en sevdiğim renk mavi']) {
      expect(offered(text), text).toEqual([...LOCAL_TOOLS_BASE]);
    }
    // Planlar sözü takip kümesini açmaz.
    for (const text of ['bana yarınki işlerimi göster', 'yarın saat onda KDV beyannamesini hatırlat']) {
      expect(offered(text).some((name) => name.startsWith('watch_')), text).toBe(false);
    }
    // Sohbetin kendisini soran söz ortam kaydına gitmez.
    expect(offered('az önce ne söylemiştim')).not.toContain('ambient_search');
    // Derin beyin yokken derin iş isteyen araçlar sunulmaz; öteki küme araçları kalır.
    const blocked = selectLocalTools(available, ['kendine döviz çeviren bir yetenek geliştir'], 'routed', declared, { deepBlocked: true });
    expect(blocked).not.toContain('skill_build');
    expect(blocked).toContain('skill_list');
    // Sesle ayar kümesi: "ayarla" (hatırlatıcı, alarm) açmaz; Claude Code izin isteği ve açık web sayfası da açmaz.
    for (const text of ['saat ona alarm ayarlar mısın', 'yarın dokuza hatırlatıcı ayarla', "Claude'un izin isteğini onayla", 'bu sayfayı oku', 'temasa geçelim']) {
      expect(offered(text), text).not.toContain('settings_set');
    }
    // Ayar/sınama sözündeki "aç / başlat" uygulama açma isteği değildir; "Windows ayarları" ise uygulamadır.
    expect(offered('ekranımı okuma iznini aç')).not.toContain('app_open');
    expect(offered('söz kesme sınamasını başlat')).not.toContain('app_open');
    expect(offered('Windows ayarlarını aç')).toContain('app_open');
    expect(offered('Windows ayarlarını aç')).not.toContain('app_navigate');
    expect(offered('example.com sitesinin ayarlar sayfasını aç')).toContain('url_open');
    // Kullanıcının kendi tarayıcısını soran söz asistanın tarayıcısını açmaz; tersi de.
    expect(offered('tarayıcımda açık sekmeleri söyle')).not.toContain('jbrowser_open');
    expect(offered('senin tarayıcında example.com sitesini aç')).toContain('jbrowser_open');
    expect(offered('kendi tarayıcında e-devlete gir').filter((name) => name.startsWith('browser_'))).toEqual([]);
    // İndirme (her seferinde onaylı) yerel modele hiç sunulmaz.
    expect(offered('kendi tarayıcında faturayı indir')).not.toContain('jbrowser_download');
    // ── demo.3 bütünleştirmesi: kümeler birbirini ezmez ──
    // Asistanın kendi tarayıcısı adıyla anılınca site açma ve kullanıcının tarayıcısı sunulmaz ("aç", "sitesini" onları da açardı).
    const own = offered('kendi tarayıcında example.com sitesini aç');
    expect(own).toContain('jbrowser_open');
    expect(own.filter((name) => name === 'url_open' || name === 'app_open' || name.startsWith('browser_'))).toEqual([]);
    // Asistanın tarayıcısı sunulamıyorsa (izin kapalı: araçları kayıtlı değil) öteki kümeler kısılmaz.
    const withoutJbrowser = selectLocalTools(available.filter((name) => !name.startsWith('jbrowser_')), ['kendi tarayıcında example.com sitesini aç'], 'routed', declared);
    expect(withoutJbrowser).toContain('url_open');
    // Tarayıcı izni bir ayardır: ayar kümesi açılır.
    expect(offered('tarayıcı iznini artık kaldır')).toContain('settings_set');
    expect(offered('kendi tarayıcını kullanma iznini kapat')).toContain('settings_set');
    // Toplantı kipi ile takip işleri ve veda birbirine karışmaz.
    expect(offered('toplantı bitince haber ver')).toContain('watch_start');
    expect(offered('toplantı bitince haber ver')).not.toContain('meeting_stop');
    expect(offered('toplantıyı bitir')).not.toContain('voice_end_conversation');
    expect(offered('sohbeti bitir')).toContain('voice_end_conversation');
    expect(offered('sohbeti bitir')).not.toContain('meeting_stop');
    expect(offered('Claude işini bitirince haber ver')).not.toContain('meeting_stop');
    // "Toplantı sayfasını aç" gezinmedir (ayar kümesi); "toplantı modunu aç" kipi başlatır (toplantı kümesi).
    expect(offered('toplantı sayfasına bir bakalım')).toContain('app_navigate');
    expect(offered('toplantı modunu aç')).toContain('meeting_start');
    expect(offered('toplantı modunu aç')).not.toContain('app_navigate');
    // E-posta takibi: takip aracı sunulur (kaynak `mail`); gönderen araç söz kapısının arkasında kalır.
    const mailWatch = offered("Ahmet'ten e-posta gelince söyle");
    expect(mailWatch).toContain('watch_start');
    expect(mailWatch).not.toContain('mail_send');
    expect(mailWatch.indexOf('watch_start')).toBeLessThan(mailWatch.indexOf('mail_list'));
    // "Toplantıya yanıt yaz" / "gönder" e-posta kümesinin işidir; toplantı kipini başlatmaz, takip başlatmaz.
    expect(offered('tamam, gönder', 'şuna yanıt yaz')).not.toContain('meeting_start');
    expect(offered('e-postalarıma bak')).not.toContain('watch_start');
    // E-posta ayarları asistanın Ayarlar sekmesidir: gezinme aracı sunulur, gönderen araç sunulmaz.
    expect(offered('e-posta ayarlarını aç')).toContain('app_navigate');
    expect(offered('e-posta ayarlarını aç')).not.toContain('mail_send');
    // Ses seçimi sözü ses düzeyi araçlarının önündedir: pay aşılırsa kırpılan bilgisayar kümesidir, ayar değil.
    const voicePick = offered('sesini erkek beş yap');
    expect(voicePick.indexOf('settings_set')).toBeGreaterThan(-1);
    expect(voicePick.indexOf('settings_set')).toBeLessThan(voicePick.indexOf('pc_media'));
    // E-posta gönderimi söz kapısının arkasında: "yanıt yaz" sözünde gönderen araç sunulmaz, "gönder" denince sunulur.
    expect(offered('şuna yanıt yaz')).not.toContain('mail_send');
    expect(offered('tamam, gönder', 'şuna yanıt yaz')).toContain('mail_send');
    expect(offered("Ahmet'ten mail geldi mi")).not.toContain('mail_send');
    // Sohbet iletisi ve "cevap ver" e-posta kümesini açmaz.
    expect(offered('bana kısa cevap ver')).not.toContain('mail_list');
    // ── Kokpit (pano) kümesi öteki kümelerle çakışmaz (demo.3 ikinci dalga) ──
    const groupsOf = (text: string) => new Set(offered(text).filter((name) => !(LOCAL_TOOLS_BASE as readonly string[]).includes(name)).map((name) => localGroupOf(name, declared(name))));
    for (const text of ['hava durumunu en üste al', 'dövizin yanına koy', 'havayı dövizin yanına koy', 'haberleri aşağı al', 'toplantı kartını kaldır', 'e-posta kartını küçült']) {
      const names = offered(text);
      expect(names.some((name) => name.startsWith('dashboard_')), text).toBe(true);
      // Pano sözü ayar, takip, e-posta, toplantı, tarayıcı, dosya, sistem (bilgisayarın panosu), belge ve proje araçlarını açmaz.
      for (const other of ['settings', 'watch', 'mail', 'meeting', 'jbrowser', 'files', 'system', 'docs', 'projects'] as const) expect(groupsOf(text).has(other), `${text} → ${other}`).toBe(false);
    }
    // Tersi: bilgisayarın panosu (kopyalanan metin), işler, e-posta, toplantı ve gezinme sözleri pano kümesini açmaz.
    for (const text of ['panoya kopyala', 'panodaki metni oku', 'işlerim ne durumda', 'e-postalarıma bak', 'toplantıyı bitir', 'masaüstündeki rapor dosyasını arşiv klasörüne kopyala', 'atlas projesini aç']) {
      expect(groupsOf(text).has('dashboard'), text).toBe(false);
    }
    expect(offered('panoya kopyala')).toContain('clipboard_write');
    // "Ana ekranı aç" gezinmedir; pano kümesi de açılabilir ama ayar kümesinin gezinme aracı sunulur.
    expect(offered('ana ekranı aç')).toContain('app_navigate');
    // Devam cümlesi bir önceki sözün kümesini taşır.
    expect(offered('evet, onu yap', 'ortam dinlemeyi duraklat')).toContain('ambient_pause');
  });

  it('d6: "yapamıyorum; isterseniz kendime bu yeteneği ekleyebilirim" önerisine kısa onay yetenek kümesini açar; öneri yoksa açmaz', () => {
    const available = DEFS.map((def) => def.name);
    const offer = 'Şu an bunu yapamıyorum; isterseniz kendime bu yeteneği ekleyebilirim.';
    const routed = (said: string, previous: string, reply: string | null) => selectLocalTools(available, routingTexts([said, previous], reply), 'routed', declared);
    expect(routed('evet, ekle', 'borsadaki hisse fiyatlarını oku', offer)).toContain('skill_build');
    expect(routed('olur', 'borsadaki hisse fiyatlarını oku', offer)).toContain('skill_build');
    expect(routed('evet', 'borsadaki hisse fiyatlarını oku', 'Tamam, hatırlatıcı kurdum.')).not.toContain('skill_build');
    expect(routed('hayır gerek yok', 'borsadaki hisse fiyatlarını oku', offer)).not.toContain('skill_build');
    // Önceki yanıt: son kullanıcı sözünden önceki asistan iletisi.
    expect(previousReplyOf([{ role: 'user', text: 'a' }, { role: 'assistant', text: offer }, { role: 'user', text: 'evet' }])).toBe(offer);
    expect(previousReplyOf([{ role: 'user', text: 'evet' }])).toBeNull();
  });
});
