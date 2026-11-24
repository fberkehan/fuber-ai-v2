// Kendini bilme: asistanın KAYITLARDAN ÜRETİLEN öz-tanımı (ben neyim, hangi sayfalar ve modüller var, araçlarım küme küme
// ne işe yarar, neyi değiştirebilirim, neyi değiştiremem).
//
// Geri bildirim: "Sistem hâlâ kendinin farkında değil… ne yapması gerektiğini bilmiyor, araçları
// doğru kullanamıyor." O güne kadar yetenekler elle yazılmış bir aile listesinden geliyordu (`self.ts` › eski `FAMILIES`):
// listeye yazılmamış araç ya da modül modelin gözünde yoktu, kapalı modülün yeteneği "var" görünebiliyordu. Bu dosya listeyi
// kaldırır: kayıtlı her araç kendi kümesine (`local-tools.ts` › `localGroupOf`; kümesi olmayan araç modülünün kümesine)
// kendiliğinden düşer; modüller modül kaydından (açık/kapalı ve nedeni), sayfalar `SPOKEN_PAGES`'ten (modülü kapalı sayfa
// düşer), ayarlar `local-settings.ts` kataloglarından gelir. Elle yazılan tek şey kümenin tek satırlık "ne işe yarar"
// cümlesidir (`CLUSTER_INFO`); hangi aracın orada olduğu, kümenin görünüp görünmediği kayıttan çıkar.
//
// İki biçimi vardır: ZENGİN (Claude Code ve bulut yolu; sabit sistem istemine girer, kayıt değişmedikçe bayt bayt aynıdır)
// ve KISA (yerel küçük model; `self.ts` › `renderSelfBlock` içindeki tek satırlık yetenek listesi: 8192'lik bağlam).
import { t, type ModuleInfo, type Risk, type ToolInfo } from '@fuber/shared';
import { SPOKEN_PAGES } from './local-commands';
import { LOCAL_NEEDS_DEEP, SKILL_MODULE_PREFIX, localGroupOf } from './local-tools';

/** Öz-tanıma giren araç bilgisi (`ToolRegistry.list()` öğesinin okunan kısmı). */
export type CatalogTool = Pick<ToolInfo, 'name' | 'moduleId' | 'risk' | 'group'>;

/** Bir modül ve o anki durumu. */
export interface CatalogModule {
  id: string;
  name: string;
  description: string;
  kind: 'builtin' | 'skill';
  /** `on` açık · `off-user` bu bilgisayarda kapatılmış · `off-policy` Fuber Yönetim kapatmış · `error` yüklenemedi. */
  state: 'on' | 'off-user' | 'off-policy' | 'error';
}

/** Ayar katalogları (yalnız adlar; değerler değişkendir ve burada yoktur). */
export interface SelfControls {
  /** Sesle/yazıyla değiştirilebilen ayarlar (`settings_set`). */
  spoken: string[];
  /** Fuber Yönetim'den yönetilenler (asistan değiştiremez). */
  managed: string[];
  /** Yalnız Ayarlar sayfasından değişenler. */
  localOnly: string[];
}

/**
 * Bir modülün öz-tanıma kattığı parça (KANCA): ikinci dalgada gelecek "pano" gibi modüller değiştirilebilen ya da
 * değiştirilemeyen yeni şeyler ve süren işler bildirir (`BrainService.attachSelfPart`). `canChange` / `cannotChange`
 * sabit kısma (öz-tanım) girer; `work` her turun durum bloğuna.
 */
export interface SelfPart {
  canChange?: string[];
  cannotChange?: string[];
  /** Süren işler (kısa, tek satırlık: "Takip: example.com fiyatı (5 dk'da bir)"). */
  work?: string[];
}

/** Bir araç kümesi: kimlik, ad, ne işe yaradığı ve kayıtlı araçları. */
export interface SelfCluster {
  id: string;
  label: string;
  purpose: string;
  tools: string[];
  /** Derin beyin isteyen araçlar (`LOCAL_NEEDS_DEEP`). */
  deep: string[];
  /** Her seferinde kullanıcı onayı isteyen araçlar (`risk: 'danger'`). */
  approval: string[];
}

export interface SelfCatalog {
  appName: string;
  appVersion: string;
  /** Kişilik adı (Fuber Yönetim'den: "Jarvis"). */
  persona: string;
  /** Açılabilen sayfalar (modülü kapalı olanlar düşmüş) ve Ayarlar'ın sekmeleri. */
  pages: string[];
  tabs: string[];
  /** Modül kaydı okunamadıysa `null` ("bilinmiyor" yazılır). */
  modules: CatalogModule[] | null;
  clusters: SelfCluster[];
  /** Ayar katalogları okunamadıysa `null`. */
  controls: SelfControls | null;
  /** Kancadan gelenler (`SelfPart`). */
  canChange: string[];
  cannotChange: string[];
}

/**
 * Kümelerin adı ve tek satırlık "ne işe yarar" cümlesi; SIRA, istemdeki sıradır. Kimlikler `LocalGroupId` ile aynıdır
 * (`core` ve `deep` hariç: onlardaki araçlar aşağıdaki kurallarla bir kümeye dağılır); `memory` ve `skills` yalnız
 * öz-tanımın kümeleridir. Yeni bir yerel küme ekleyen görev buraya da bir satır ekler (sınaması var).
 */
/**
 * "Ne işe yarar" cümlesinin parçaları: her parça yalnız ona karşılık gelen araç KAYITLIYSA yazılır (kalıp yoksa her zaman).
 * Bilgisayar modülünün okuma ve kullanma araçları ayrı izinlerle kaydedilir; okuma izni açık, kullanma kapalıyken
 * "tıklar, yazar" yazılmaz. Böylece cümle de kayıttan çıkar, uydurulmaz.
 */
type Fragment = readonly [text: string, when?: RegExp];

export const CLUSTER_INFO: ReadonlyArray<{ id: string; label: string; purpose: readonly Fragment[]; suffix?: string }> = [
  { id: 'planner', label: 'hatırlatıcı ve yapılacaklar', purpose: [['hatırlatıcı kurar, listeler', /^reminder_(create|list)$/], ['hatırlatıcıyı değiştirir', /^reminder_update$/], ['iptal eder', /^reminder_cancel$/], ['yapılacak ekler, listeler, tamamlar', /^todo_/]] },
  { id: 'memory', label: 'hafıza', purpose: [['kullanıcının kalıcı bilgisini kaydeder', /^memory_save$/], ['hafızada arar', /^memory_search$/], ['kaydı düzeltir', /^memory_update$/], ['istenince unutur', /^memory_forget$/]] },
  { id: 'docs', label: 'belgeler ve dosyalar', purpose: [['belgeyi okur ve içinde arar', /^(document_read|document_search)$/], ['klasörü listeler', /^file_list$/], ['Word, Excel, PowerPoint ya da PDF üretir', /^document_create$/]] },
  { id: 'mail', label: 'e-posta', purpose: [['gelen kutusunu listeler, iletiyi okur', /^mail_(list|read)$/], ['yanıt taslağı hazırlar', /^mail_draft$/], ['gönderir', /^mail_send$/], ['eki kaydeder', /^mail_attachment/]] },
  { id: 'projects', label: 'projeler', purpose: [['proje klasörünü bulur', /^project_find$/], ['editörde açar', /^project_open$/]] },
  { id: 'code', label: 'Claude Code oturumları', purpose: [['bir projede Claude Code oturumu başlatır ve ona iş yaptırır', /^code_session_(start|send)$/], ['durumunu söyler, durdurur', /^code_session_(status|stop)$/], ['eski oturumlarda arar, terminalde açar', /^code_session_(search|open)$/]] },
  { id: 'watch', label: 'takip işleri (İşler)', purpose: [['arka planda sayfa, dosya, pencere ya da Claude Code işini izler, olunca haber verir', /^watch_start$/], ['işleri listeler ve durumunu söyler', /^watch_(list|status)$/], ['duraklatır, sürdürür, iptal eder', /^watch_(pause|resume|cancel)$/]] },
  { id: 'briefing', label: 'brifing, gündem ve kullanıcı profili', purpose: [['günün brifingini hazırlar', /^briefing_now$/], ['kendiliğinden konuşmanın sıklığını, sabah brifinginin saatini ve kapsamını ayarlar', /^briefing_(set|status)$/], ['RSS kaynağı ekler, çıkarır, listeler', /^feed_(add|remove|list)$/], ['haber konusu takip eder ya da sessize alır', /^feed_topic$/], ['kişiye göre seçilmiş gündemi söyler', /^feed_news$/], ['kullanıcıyı nasıl tanıdığını anlatır', /^profile_get$/], ['kullanıcı hakkında öğrendiğini ve davranış kurallarını profile kaydeder, siler', /^profile_(note|forget)$/]] },
  { id: 'meeting', label: 'toplantı modu', purpose: [['görüşmeyi iki taraflı yazıya döker (başlatır, bitirir)', /^meeting_(start|stop)$/], ['özetler', /^meeting_summary$/], ['geçmiş toplantıda konuşulanı bulur', /^meeting_recall$/]] },
  { id: 'ambient', label: 'ortam dinleme', purpose: [['notlarda arar', /^ambient_search$/], ['gün özeti', /^ambient_day_summary$/], ['duraklatır', /^ambient_pause$/], ['son dakikaları siler', /^ambient_forget/]], suffix: ' (yerelde; sen yalnız kısa notları görürsün)' },
  { id: 'info', label: 'güncel bilgi', purpose: [['hava', /^weather_/], ['döviz', /^fx_/], ['haber', /^news_/], ['web araması', /^web_search$/], ['gün ve tatil bilgisi', /^day_/], ['sayfa okuma', /^web_read$/]], suffix: ' (sayfa açmadan söyler)' },
  { id: 'research', label: 'derin araştırma', purpose: [['arka planda kapsamlı web araştırması yapıp rapor hazırlar']] },
  { id: 'open', label: 'uygulama ve site açma', purpose: [['Windows uygulaması açar', /^app_open$/], ['web adresini kullanıcının tarayıcısında açar', /^url_open$/]], suffix: ' (yalnız açman istenirse)' },
  { id: 'browser', label: 'kullanıcının tarayıcısı', purpose: [['açık sekmeleri ve sayfayı okur', /^browser_(tabs|read)$/], ['yeni sekmede arar ya da adrese gider', /^browser_(search|navigate)$/]] },
  { id: 'jbrowser', label: 'kendi tarayıcın (ayrı pencere)', purpose: [['sitede gezinir ve okur', /^jbrowser_(open|read|back|scroll|tabs|window|wait)$/], ['tıklar, yazar, seçer, tuşa basar (gönderim onaylı)', /^jbrowser_(click|type|select|key)$/], ['sayfa görüntüsüne bakar', /^jbrowser_screenshot$/], ['dosya indirir', /^jbrowser_download$/]] },
  { id: 'pc', label: 'bilgisayarı kullanma', purpose: [['pencereleri ve ekranları listeler, pencereyi okur', /^pc_(windows|read_window|screens)$/], ['ekrandaki öğeyi adıyla bulur', /^pc_find$/], ['pencereyi öne getirir, küçültür, büyütür', /^pc_(focus_window|window_action)$/], ['pencereyi taşır, boyutlandırır, yan yana dizer', /^pc_window_arrange$/], ['yazar, tuşa basar', /^pc_(type|keys)$/], ['birkaç adımı tek seferde sırayla yapar (aç, tıkla, yaz, bekle)', /^pc_do$/], ['tıklar, sürükler, kaydırır', /^pc_(click|drag|scroll)$/], ['müziği ve ses düzeyini yönetir', /^pc_media$/], ['ekrana bakıp yorumlar', /^screen_look$/], ['istenince fare ve klavye sınaması yapar', /^pc_selftest$/]] },
  { id: 'files', label: 'dosya yönetimi', purpose: [['dosya ve klasör arar', /^file_find$/], ['dosyayı açar, klasöründe gösterir', /^file_(open|reveal)$/], ['kopyalar, taşır, klasör oluşturur', /^(file_(copy|move)|folder_create)$/], ['metin dosyası yazar ve düzenler', /^file_(write|edit)$/], ['Geri Dönüşüm Kutusu’na atar (onaylı)', /^file_delete$/]] },
  { id: 'system', label: 'sistem, pano ve komut', purpose: [['bilgisayarın durumunu söyler (bellek, disk, ağ, çalışan uygulamalar ve süreçler)', /^(system_info|network_status|app_list|process_list)$/], ['panoyu okur ve yazar', /^clipboard_/], ['ekran görüntüsünü kaydeder, bildirim gösterir', /^(screenshot_save|notify_show)$/], ['uygulamayı kapatır', /^app_close$/], ['parlaklığı ayarlar, bilgisayarı kilitler', /^system_(brightness|lock)$/], ['PowerShell komutu çalıştırır, süreci sonlandırır, bilgisayarı kapatır ya da yeniden başlatır (her seferinde onaylı)', /^(pc_run_command|process_kill|system_power)/], ['arka planda başlattığı komutun çıktısını okur, durdurur', /^process_(output|stop)$/]] },
  { id: 'dashboard', label: 'ana ekran panosu (Bugün, Kokpit)', purpose: [['kartları taşır, büyütür, küçültür', /^dashboard_card_move$/], ['kalıcı kart ekler, günceller, kaldırır', /^dashboard_card_(add|update|remove)$/], ['panonun düzenini ve durumunu söyler, sıfırlar', /^dashboard_(layout|state)$/], ['öneri bırakır', /^suggestion_add$/]], suffix: ' (ekranda gösterme geçicidir; pano kalıcıdır)' },
  { id: 'stage', label: 'ekranda gösterme', purpose: [['ekranda kart gösterir', /^stage_show_card$/], ['küçük uygulama gösterir', /^stage_show_app$/], ['ekrandakini kapatır', /^stage_close$/]] },
  { id: 'voice', label: 'ses denetimi ve öz-durum', purpose: [['susar', /^voice_stop_speaking$/], ['mikrofonu kapatır', /^voice_mute_mic$/], ['sessiz kibi açar, kapatır', /^voice_set_quiet$/], ['uyandırma sözünü duraklatır', /^voice_pause_listening$/], ['sohbeti bitirir', /^voice_end_conversation$/], ['ses hattının durumunu söyler', /^voice_status$/], ['kendi durumunu ve donanımı okur', /^self_status$/]] },
  { id: 'settings', label: 'ayarlar, sınamalar ve sayfalar', purpose: [['ayarları okur', /^settings_list$/], ['ayarları sesle değiştirir', /^settings_set$/], ['ses sınaması başlatır', /^voice_test_start$/], ['ana pencerede sayfa açar', /^app_navigate$/]] },
  {
    id: 'workshop',
    label: 'eklentiler (Atölye; kendini geliştirme)',
    purpose: [
      ['kendine eklenti geliştirir (araç, pano kartı, sayfa, zamanlanmış iş, takip, sesli komut)', /^skill_build$/],
      ['eklentiyi günceller, güncellemeyi uygular, geri alır', /^skill_(update|apply_update|rollback)$/],
      ['eklentileri ve izinlerini söyler', /^skill_(list|info)$/],
      ['açar, kapatır, kaldırır, sayfasını açar', /^skill_(enable|remove|open_page)$/],
    ],
  },
  { id: 'skills', label: 'Atölye’de eklenen yetenekler', purpose: [['kullanıcının onaylayıp yüklediği yetenekler']] },
];

const INFO_BY_ID = new Map(CLUSTER_INFO.map((info, index) => [info.id, { ...info, index }]));

/** Kümenin "ne işe yarar" cümlesi, yalnız kayıtlı araçlara karşılık gelen parçalardan. */
function purposeOf(id: string, tools: readonly string[]): string | null {
  const info = INFO_BY_ID.get(id);
  if (!info) return null;
  const parts = info.purpose.filter(([, when]) => !when || tools.some((name) => when.test(name))).map(([text]) => text);
  return parts.length ? `${parts.join(', ')}${info.suffix ?? ''}` : '';
}

/** Çekirdek kümedeki araçların öz-tanımdaki yeri (çekirdek bir yerel model kavramıdır, yetenek değildir). */
const CORE_HOME: ReadonlyArray<[RegExp, string]> = [
  [/^(reminder_|todo_)/, 'planner'],
  [/^memory_/, 'memory'],
  [/^(voice_|self_status$)/, 'voice'],
];

/** Derin beyin isteyen araçların durum satırındaki adı (bir kümenin içinde ayrıca anılır: o an çalışmayabilir). */
const DEEP_LABEL: Readonly<Record<string, string>> = {
  skill_build: 'yeni yetenek ya da özellik geliştirme (Atölye)',
  research_start: 'derin web araştırması',
  screen_look: 'ekrana bakıp yorumlama',
  jbrowser_screenshot: 'kendi tarayıcında sayfa görüntüsüne bakma',
};

export const deepLabelOf = (name: string): string => DEEP_LABEL[name] ?? name;

/** Kümesi olmayan aracın yeri: modülünün öteki araçlarının en sık düştüğü küme; o da yoksa modülün kendisi. */
function homeByModule(tools: readonly CatalogTool[]): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const tool of tools) {
    const id = directCluster(tool);
    if (!id) continue;
    const perModule = counts.get(tool.moduleId) ?? new Map<string, number>();
    perModule.set(id, (perModule.get(id) ?? 0) + 1);
    counts.set(tool.moduleId, perModule);
  }
  const home = new Map<string, string>();
  for (const [moduleId, perModule] of counts) home.set(moduleId, [...perModule].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0]);
  return home;
}

function directCluster(tool: CatalogTool): string | null {
  if (tool.moduleId.startsWith(SKILL_MODULE_PREFIX)) return 'skills';
  const group = localGroupOf(tool.name, tool.group);
  if (group === 'core') return CORE_HOME.find(([pattern]) => pattern.test(tool.name))?.[1] ?? null;
  if (group === null || group === 'deep') return null;
  return INFO_BY_ID.has(group) ? group : null;
}

/**
 * Kayıtlı araçlardan kümeler. Her araç tam bir kümeye düşer; araçsız küme yazılmaz. Kümesi bilinmeyen araç modülünün
 * adını taşıyan kümeye girer (adı ve açıklaması modül kaydından): yeni bir modül bu dosyaya dokunmadan görünür.
 */
export function buildClusters(tools: readonly CatalogTool[], modules: readonly CatalogModule[] | null = null): SelfCluster[] {
  const home = homeByModule(tools);
  const byId = new Map<string, SelfCluster>();
  const moduleOf = new Map((modules ?? []).map((module) => [module.id, module]));
  for (const tool of [...tools].sort((a, b) => a.name.localeCompare(b.name))) {
    const id = directCluster(tool) ?? home.get(tool.moduleId) ?? `module:${tool.moduleId}`;
    let cluster = byId.get(id);
    if (!cluster) {
      const info = INFO_BY_ID.get(id);
      const module = moduleOf.get(tool.moduleId);
      cluster = {
        id,
        label: info?.label ?? module?.name ?? tool.moduleId,
        // Bilinen kümede cümle araçlar toplandıktan sonra kurulur (aşağıda); bilinmeyende modülün açıklamasıdır.
        purpose: module?.description ?? '',
        tools: [],
        deep: [],
        approval: [],
      };
      byId.set(id, cluster);
    }
    cluster.tools.push(tool.name);
    if (LOCAL_NEEDS_DEEP.has(tool.name)) cluster.deep.push(tool.name);
    if (tool.risk === 'danger') cluster.approval.push(tool.name);
  }
  for (const cluster of byId.values()) cluster.purpose = purposeOf(cluster.id, cluster.tools) ?? cluster.purpose;
  const order = (cluster: SelfCluster) => INFO_BY_ID.get(cluster.id)?.index ?? CLUSTER_INFO.length;
  return [...byId.values()].sort((a, b) => order(a) - order(b) || a.id.localeCompare(b.id));
}

/** Modül kaydının öğesinden öz-tanımın modülü (ad ve açıklama sözlükten; anahtar yoksa anahtarın kendisi). */
export function catalogModule(info: Pick<ModuleInfo, 'id' | 'nameKey' | 'descriptionKey' | 'kind' | 'allowed' | 'enabled' | 'error'>): CatalogModule {
  const state: CatalogModule['state'] = info.enabled ? 'on' : info.error ? 'error' : !info.allowed ? 'off-policy' : 'off-user';
  const description = t(info.descriptionKey);
  return { id: info.id, name: t(info.nameKey), description: description === info.descriptionKey ? '' : description, kind: info.kind, state };
}

/**
 * Sayfa ve sekme adları: modülü kapalı sayfa düşer. Modül kaydı yoksa (`null`) modülü açık sayılan, araçları kayıtlı
 * modüldür (araçlar yalnız modül yüklüyken kayıtlıdır).
 */
export function openPages(modules: readonly CatalogModule[] | null, tools: readonly CatalogTool[]): { pages: string[]; tabs: string[] } {
  const loaded = new Set(tools.map((tool) => tool.moduleId));
  const open = (id: string) => (modules ? modules.some((module) => module.id === id && module.state === 'on') : loaded.has(id));
  const visible = SPOKEN_PAGES.filter((item) => !item.moduleId || open(item.moduleId));
  return {
    pages: [...new Set(visible.filter((item) => !item.tab).map((item) => item.label))],
    tabs: [...new Set(visible.filter((item) => item.tab).map((item) => item.label.replace(/^Ayarlar › /, '')))],
  };
}

export interface CatalogInput {
  appName: string;
  appVersion: string;
  persona: string;
  tools: readonly CatalogTool[];
  modules: readonly CatalogModule[] | null;
  controls: SelfControls | null;
  parts?: readonly SelfPart[];
}

export function buildCatalog(input: CatalogInput): SelfCatalog {
  const { pages, tabs } = openPages(input.modules, input.tools);
  const parts = input.parts ?? [];
  return {
    appName: input.appName,
    appVersion: input.appVersion,
    persona: input.persona,
    pages,
    tabs,
    modules: input.modules ? [...input.modules].sort((a, b) => a.name.localeCompare(b.name, 'tr')) : null,
    clusters: buildClusters(input.tools, input.modules),
    controls: input.controls,
    canChange: parts.flatMap((part) => part.canChange ?? []),
    cannotChange: parts.flatMap((part) => part.cannotChange ?? []),
  };
}

const OFF_WHY: Record<Exclude<CatalogModule['state'], 'on'>, string> = {
  'off-user': 'bu bilgisayarda kapatıldı',
  'off-policy': 'Fuber Yönetim’de kapalı',
  error: 'yüklenemedi',
};

/**
 * ZENGİN öz-tanım: Claude Code ve bulut yolunun SABİT sistem istemine girer. Değişken hiçbir şey (saat, mikrofon,
 * süren iş, derin beynin o anki durumu, ayar değerleri) içermez: kayıt değişmedikçe bayt bayt aynıdır (Claude Code'un
 * ısıtılan süreci ve istem önbelleği buna dayanır). Değişince ısıtılmış süreçler bayatlar (`core/brain.ts`).
 */
export function renderSelfKnowledge(catalog: SelfCatalog): string {
  const lines = [
    '## KENDİN (uygulamanın kayıtlarından üretildi)',
    `- Sen ${catalog.appName} sürüm ${catalog.appVersion}'sin; kişilik adın ${catalog.persona}. Bu bilgisayarda çalışan, sesle ve yazıyla konuşulan Türkçe masaüstü asistanısın. Anlık durumun (beyin, ses, kipler, süren işler, çalışmayan yetenekler) "ŞU ANKİ DURUMUN" bölümündedir.`,
  ];
  if (catalog.pages.length) {
    lines.push(`- Ana penceredeki sayfalar (app_navigate ile açarsın): ${catalog.pages.join(', ')}${catalog.tabs.length ? `; Ayarlar’ın sekmeleri: ${catalog.tabs.join(', ')}` : ''}.`);
  }
  if (catalog.modules === null) {
    lines.push('- Modüllerin listesi: bilinmiyor.');
  } else {
    const on = catalog.modules.filter((module) => module.state === 'on' && module.kind === 'builtin').map((module) => module.name);
    const off = catalog.modules.filter((module) => module.state !== 'on' && module.kind === 'builtin').map((module) => `${module.name} (${OFF_WHY[module.state as Exclude<CatalogModule['state'], 'on'>]})`);
    lines.push(`- Modüller: AÇIK: ${on.length ? on.join(', ') : 'yok'}.${off.length ? ` KAPALI: ${off.join(', ')}; kapalı modülün araçları ve sayfası yoktur, "yapabilir misin" denirse "bu özellik var ama şu an kapalı" de ve nedenini söyle.` : ''}`);
  }
  if (catalog.clusters.length) {
    lines.push('- Araç kümelerin (ne işe yarar → araçlar):');
    for (const cluster of catalog.clusters) {
      const notes = [
        cluster.approval.length ? `onay ister: ${cluster.approval.join(', ')}` : '',
        cluster.deep.length ? `derin beyin ister: ${cluster.deep.join(', ')}` : '',
      ].filter(Boolean);
      lines.push(`  - ${capitalize(cluster.label)}: ${cluster.purpose}${cluster.purpose ? ' ' : ''}→ ${cluster.tools.join(', ')}${notes.length ? ` (${notes.join('; ')})` : ''}.`);
    }
  } else {
    lines.push('- Araçların: şu an kayıtlı araç yok.');
  }
  const can: string[] = [];
  if (catalog.controls?.spoken.length) can.push(`sesle/yazıyla değişen ayarlar (settings_set; değerlerini settings_list okur): ${catalog.controls.spoken.join(', ')}`);
  const workshop = catalog.clusters.find((cluster) => cluster.id === 'workshop');
  if (workshop) can.push('eklentilerin (Atölye kümesi)');
  can.push(...catalog.canChange);
  if (can.length) lines.push(`- Değiştirebildiklerin: ${can.join('; ')}.`);
  const cannot: string[] = [];
  if (catalog.controls?.managed.length) cannot.push(`Fuber Yönetim’den yönetilenler: ${catalog.controls.managed.join(', ')}`);
  if (catalog.controls?.localOnly.length) cannot.push(`yalnız Ayarlar sayfasından değişenler: ${catalog.controls.localOnly.join(', ')}`);
  cannot.push(...catalog.cannotChange);
  if (cannot.length) lines.push(`- Değiştiremediklerin (istenirse nereden değişeceğini söyle): ${cannot.join('; ')}.`);
  if (catalog.controls === null) lines.push('- Ayarların listesi: bilinmiyor (settings_list okur).');
  const canBuild = workshop?.tools.includes('skill_build') === true;
  lines.push(
    `- "Neler yapabilirsin?", "X’i yapabilir misin?" sorularını bu bölümden ve "ŞU ANKİ DURUMUN"dan yanıtla; kapalıysa ya da şu an çalışmıyorsa nedenini söyle; nasıl yaptırılacağını tek örnekle göster ("… demeniz yeter"). Yetenek uydurma.${
      canBuild
        ? ` Kümelerinde yoksa kesip bırakma, "Şu an bunu yapamıyorum; isterseniz kendime bu yeteneği ekleyebilirim" de; onaylarsa skill_build${workshop?.tools.includes('core_develop') ? ' (eklenti yetmezse core_develop)' : ''} ile başlat.`
        : ' Kümelerinde yoksa yapamadığını söyle.'
    }`,
  );
  return lines.join('\n');
}

const capitalize = (text: string) => (text ? text[0]!.toLocaleUpperCase('tr') + text.slice(1) : text);
