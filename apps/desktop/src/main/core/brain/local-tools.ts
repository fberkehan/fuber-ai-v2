// Yerel (küçük) modelin gördüğü araçlar. Küçük model çok araçla bozulabilir (KURGU §6) ve 8192'lik bağlamı araç
// şemaları doldurur: kayıtlı araçların yalnız bir KÜMEYE girenleri, KISALTILMIŞ tanımlarıyla (`local-tool-specs.ts`) ve
// tura göre seçilerek sunulur. Hangi kümenin sunulacağı ÖLÇÜMLE seçilir: `scripts/e2e/local-llm-eval.mjs`
// (Türkçe istemler × 3 yineleme; sonuçlar `artifacts/local-llm-eval*.json`).
//
// Bir aracın kümesi üç yoldan belli olur (sırayla): araç tanımındaki `group` alanı (`ToolDef.group`; modül kendi aracını
// etiketler) → buradaki ad listeleri → ad öneki (`pc_`, `browser_`, `weather_`…). Hiçbirine uymayan araç yerel modele
// sunulmaz ve çağrılamaz.

/** Küme kimlikleri (`ToolDef.group` değerleri). `core`: her turda · `deep`: yerel modele HİÇ sunulmaz. */
export type LocalGroupId =
  | 'core'
  | 'planner'
  | 'stage'
  | 'dashboard'
  | 'docs'
  | 'projects'
  | 'code'
  | 'workshop'
  | 'voice'
  | 'ambient'
  | 'meeting'
  | 'info'
  | 'research'
  | 'open'
  | 'jbrowser'
  | 'browser'
  | 'pc'
  | 'settings'
  | 'watch'
  | 'briefing'
  | 'mail'
  | 'files'
  | 'system'
  | 'deep';

/**
 * Çekirdek küme: her turda sunulur (sırası sabittir: istem öneki değişmez, sunucu önbellekten okur). Gündelik
 * konuşmanın işleri: hatırlat, yapılacak ekle, hatırla, sus / mikrofonu kapat ve kendini bilme (`self_status`).
 */
export const LOCAL_TOOLS_BASE = [
  'reminder_create',
  'reminder_list',
  'todo_add',
  'todo_list',
  'memory_save',
  'memory_search',
  'voice_stop_speaking',
  'voice_mute_mic',
  'voice_set_quiet',
  'self_status',
] as const;

/** Hatırlatıcı/yapılacak düzenleme: iptal, tamamlama, toplu ekleme. */
export const LOCAL_TOOLS_PLANNER_MORE = ['reminder_cancel', 'todo_add_many', 'todo_done'] as const;

/** Proje araçları (S7). */
export const LOCAL_TOOLS_PROJECTS = ['project_find', 'project_open'] as const;

/**
 * Bilgisayarda bir şey AÇAN araçlar. Yalnız kullanıcının sözü bir şey açmayı işaret ediyorsa sunulurlar: küçük model
 * bilgi sorusunda ("Ankara'da hava nasıl?") araç tanımındaki "bilgi sorusunda KULLANMA" uyarısına rağmen tarayıcı
 * açıyor (sınamada iki kez görüldü). Sunulmayan araç çağrılamaz.
 */
export const LOCAL_TOOLS_OPEN = ['app_open', 'url_open'] as const;

/** Seyrek gereken ses araçları. */
export const LOCAL_TOOLS_VOICE_MORE = ['voice_pause_listening', 'voice_status', 'voice_end_conversation'] as const;

/**
 * "Her şeyi konuşarak" (ses denetimi modülü; demo.3): bu bilgisayarın ayarlarını sesle okuma/değiştirme, ses
 * sınamalarını başlatma, ana pencereyi bir sayfada açma. Kesin sözler ("söz kesme sınamasını başlat", "ayarları aç")
 * kodla araca gider (`local-commands.ts`); serbest söyleyişte bu küme modele sunulur.
 */
export const LOCAL_TOOLS_SETTINGS = ['settings_list', 'settings_set', 'voice_test_start', 'app_navigate'] as const;

/**
 * Ortam dinleme (ambient modülü; varsayılan KAPALI, rıza ister): gün boyu duyulan konuşmanın notlarında arama, gün
 * özeti, dinlemeyi duraklatma, son dakikaları silme. Modül kapalıyken araçlar kayıtlı değildir ve sunulmaz.
 */
export const LOCAL_TOOLS_AMBIENT = ['ambient_search', 'ambient_day_summary', 'ambient_pause', 'ambient_set', 'ambient_forget_recent'] as const;

/**
 * Toplantı modu (meeting modülü): başlat, bitir, özetle, geçmiş toplantıda ne konuşulduğunu bul. Ortam dinlemeden
 * ayrıdır (açıkça başlatılan görüşme dökümü); modül kapalıyken araçlar kayıtlı değildir.
 */
export const LOCAL_TOOLS_MEETING = ['meeting_start', 'meeting_stop', 'meeting_summary', 'meeting_recall'] as const;

/**
 * Gözcülü arka plan işleri (watch modülü): "şunu takip et, … olunca söyle", "Claude bitirince haber ver", "işlerim ne
 * durumda", "şu işi iptal et". Başlatma tek onay kartı ister.
 */
export const LOCAL_TOOLS_WATCH = ['watch_start', 'watch_list', 'watch_status', 'watch_pause', 'watch_resume', 'watch_cancel'] as const;

/**
 * Brifing, gündem ve profil (briefing / news / memory modülleri): kendiliğinden konuşmanın ayarı, günün brifingi, RSS
 * kaynakları ve takip konuları, "beni nasıl tanıyorsun". SUNULUŞ SIRASIYLA (araç payı sondan kırpar). `briefing_set`
 * ayar değerini modelden istemez: kullanıcının sözü `say` alanına aynen verilir, değer kodla okunur.
 */
export const LOCAL_TOOLS_BRIEFING = ['briefing_set', 'briefing_now', 'feed_add', 'feed_topic', 'feed_news', 'feed_list', 'feed_remove', 'profile_get', 'briefing_status'] as const;

/** Ekranda kart. `stage_show_app` (uzun, kendi kendine yeten HTML) küçük modelde güvenilir değil, kapalı. */
export const LOCAL_TOOLS_STAGE = ['stage_show_card'] as const;
/**
 * Kokpit araçları, SUNULUŞ SIRASIYLA: araç bütçesi liste sonundan kırpar; en sık istenenler (taşı, oku, kaldır) başta
 * durur. Ölçüm: ada göre sırada kümeden yalnız `dashboard_card_add` kalıyor, model "yukarı al" sözünde kart ekliyordu.
 */
export const LOCAL_TOOLS_DASHBOARD = ['dashboard_card_move', 'dashboard_state', 'dashboard_card_remove', 'dashboard_card_add', 'dashboard_layout', 'dashboard_card_update', 'suggestion_add'] as const;

/**
 * Güncel bilgi araçları (web modülü; anahtarsız, bulut beyni gerektirmez): hava, arama, döviz, haber, gün/tatil,
 * sayfa okuma. Bilgi sorusunda sayfa açmak yerine bunlar sunulur.
 */
export const LOCAL_TOOLS_INFO = ['weather_get', 'web_search', 'fx_rate', 'news_get', 'day_info', 'web_read'] as const;

/** Claude Code oturumları (projeler modülü; dal `d2-cc`): başlat, ileti gönder, durum, durdur, ara, terminalde aç. */
export const LOCAL_TOOLS_CODE = [
  'code_session_start',
  'code_session_send',
  'code_session_status',
  'code_session_stop',
  'code_session_search',
  'code_session_open',
] as const;

/**
 * Belgeler (belge modülü): oku, içinde ara, klasörü listele, belge üret. Bunlar
 * yerel listede yokken model belge sorusunda araç çağırmadı ve tarihi uydurdu ("28 Ekim"; doğrusu 26 Kasım).
 */
export const LOCAL_TOOLS_DOCS = ['document_read', 'document_search', 'file_list', 'document_create'] as const;

/**
 * Atölye (dal `d2-kopru`): yetenek geliştirmeyi BAŞLATIR ve yetenekleri yönetir. `skill_build` derin beyin ister
 * (`LOCAL_NEEDS_DEEP`); sayma, açma/kapama ve kaldırma istemez. Bunlar yerel listede yokken model "ekleyemem" diyordu.
 */
export const LOCAL_TOOLS_WORKSHOP = ['skill_build', 'skill_list', 'skill_enable', 'skill_remove'] as const;

/** Derin araştırma (web modülü): arka planda yürür, derin beyin ister. Hızlı arama `web_search`'tür (`info`). */
export const LOCAL_TOOLS_RESEARCH = ['research_start'] as const;

/** Kullanıcının kendi tarayıcısı (pc modülü): sekmeler, sayfayı okuma, yeni sekmede arama ve adrese gitme. */
export const LOCAL_TOOLS_BROWSER = ['browser_tabs', 'browser_read', 'browser_search', 'browser_navigate'] as const;

/**
 * Asistanın KENDİ tarayıcısı (browser modülü; ayrı pencere, kalıcı oturum): aç, oku, tıkla, yaz, seç, tuş, bekle, geri,
 * sekmeler, pencere, kaydır. Görüntüye bakma (jbrowser_screenshot) derin beyin ister; indirme (danger) yerelde sunulmaz.
 */
export const LOCAL_TOOLS_JBROWSER = [
  'jbrowser_open',
  'jbrowser_read',
  'jbrowser_click',
  'jbrowser_type',
  'jbrowser_select',
  'jbrowser_key',
  'jbrowser_wait',
  'jbrowser_back',
  'jbrowser_scroll',
  'jbrowser_tabs',
  'jbrowser_window',
  'jbrowser_screenshot',
] as const;

/** Bilgisayar denetimi (pc modülü): pencereler, yazma, tuş, tıklama, sürükleme, kaydırma, ortam tuşları. */
export const LOCAL_TOOLS_PC = [
  'pc_windows',
  'pc_read_window',
  'pc_focus_window',
  'pc_window_action',
  'pc_type',
  'pc_keys',
  'pc_click',
  'pc_drag',
  'pc_scroll',
  'pc_media',
  // Ekrana bakıp yorumlama: görüntüyü derin beyin okur (`LOCAL_NEEDS_DEEP`).
  'screen_look',
  // d3: öğe arama. `pc_window_arrange`, `pc_screens`, `pc_selftest` kümeye önekle girer ve söz kapılıdır (`LOCAL_WORD_GATES`).
  'pc_find',
] as const;

/** Dosya yönetimi (pc modülü, d3): ada göre bul, kopyala, taşı/yeniden adlandır, klasör oluştur, Geri Dönüşüm Kutusu'na sil, aç, Gezgin'de göster. */
export const LOCAL_TOOLS_FILES = ['file_find', 'file_copy', 'file_move', 'folder_create', 'file_delete', 'file_open', 'file_reveal', 'file_write', 'file_edit'] as const;

/**
 * Sistem (pc modülü, d3): hazır salt okunur sorgular, pano, uygulama kapatma, parlaklık, kilit, ekran görüntüsü, bildirim;
 * geri alınamayanlar (komut, süreç sonlandırma, güç) söz kapılıdır (`LOCAL_WORD_GATES`) ve her seferinde onay ister.
 */
export const LOCAL_TOOLS_SYSTEM = [
  'system_info',
  'process_list',
  'network_status',
  'app_list',
  'clipboard_read',
  'clipboard_write',
  'app_close',
  'screenshot_save',
  'system_brightness',
  'system_lock',
  'notify_show',
  'pc_run_command',
  'process_kill',
  'system_power',
  'system_power_cancel',
  // Arka planda başlatılan komutun çıktısı ve durdurulması (yalnız kendi başlattıklarımız).
  'process_output',
  'process_stop',
] as const;

/**
 * E-posta (mail modülü; hesap eklenmemişse araçlar "hesap yok" der): listele, oku, taslak hazırla, gönder. Gönderim
 * `danger`dır (her seferinde onay kartı) ve söz kapısının arkasındadır (`LOCAL_WORD_GATES`). Eki kaydetme yerelde sunulmaz.
 * Thunderbird'den hesap ayarlarını içe aktarma yalnız sayar ve pencereyi açar (parola sesle istenmez).
 */
export const LOCAL_TOOLS_MAIL = ['mail_list', 'mail_read', 'mail_draft', 'mail_send', 'mail_import_thunderbird'] as const;

/**
 * Söze göre sunulan kümeler. `match` ile adı tanınan araçlar da kümeye girer: bir modül aynı önekle yeni araç eklerse
 * (ör. `weather_week`, `pc_zoom`, `claude_resume`) bu dosyaya ad yazılmadan yerel modele açılır, ama yalnız ilgili
 * sözde. Sıra, modele sunuluş sırasıdır.
 */
interface IntentGroup {
  id: Exclude<LocalGroupId, 'core' | 'deep'>;
  /** Raporlarda ve belgelerde görünen kısa ad. */
  label: string;
  tools: readonly string[];
  match?: RegExp;
  /** Katlanmış (küçük harf, Türkçe harfler sadeleşmiş) kullanıcı sözünde niyet işareti. */
  intent: RegExp;
  /**
   * Varsa: bu söz, yanıtı ARAÇLA OKUNMADAN verilemeyecek bir olgu soruyor (kullanıcının belgesi, ekranı, güncel veri).
   * Tur araçsız biter ve yanıtta sayı/tarih geçerse yanıt iletilmez, okuma aracı zorunlu tutulur (`groundingGroups`).
   */
  grounded?: RegExp;
}

const PLANNER_MORE_INTENT = /iptal|vazgec|\bsil\b|silsene|siler|kaldir|tamamla|bitti|bitir|hallet|yaptim|liste|madde|alisveris|yapilacak/;
const STAGE_INTENT = /goster|ekran|kart|sahne|tablo|gorelim|goreyim|gormek/;
/**
 * Kokpit (Bugün sayfasının panosu): kalıcı kart ekle/kaldır, sırala, boyutlandır, öneri bırak. "Kart göster" tek başına
 * sahnedir (geçici); pano sözü "pano", "kokpit", "ana sayfa", "ana ekran", "kutu" ya da kartı kalıcı kılan bir fiil taşır;
 * yerleşik kartın adı bir yer ya da boyut sözüyle birlikte de panoyu açar ("hava durumunu yukarı al", "dövizi büyüt").
 */
const DASHBOARD_INTENT =
  /\bpano|kokpit|ana (sayfa|ekran)|bugun sayfa|kutucu|\bkutu(yu|su|sunu|lari|larini)?\b|kart(i|ini|lari|larini)? (kaldir|sil|buyut|kucult|tasi|sirala|duzenle|diz|koy|al)|(hava( durumu)?|doviz|\bkur|haber(ler)?|yapilacak(lar)?|oneri(ler)?)\w* (kart\w* |kutu\w* )?(yukari|asagi|en uste|uste|en alta|alta|saga|sola|basa|sona|one|\w+ yanina|buyut|kucult|kaldir|tasi|baska (bir )?yere)|(yukari|asagi|en uste|en alta|saga|sola|basa|sona) (al|tasi|koy)|\bbuyut|\bkucult|(hava( durumu)?|doviz|\bkur|haber(ler)?|yapilacak(lar)?|oneri(ler)?|toplanti|e ?posta|suren is)\w* yanina (al|koy|tasi)|duzeni sifirla|surekli (goster|gor)|oneri (birak|ekle)/;
/**
 * "Pano" iki şeydir: ana ekranın panosu (Kokpit) ve bilgisayarın panosu (kopyalanan metin). Kopyalama, yapıştırma ya da
 * "panodaki metin" sözü bilgisayarın panosudur; o zaman pano kümesi yalnız "pano" sözüyle açılmaz. Tersi: öteki pano
 * sözleri sistem kümesini yalnız "pano" sözüyle açmaz.
 */
const CLIPBOARD_TALK = /kopyala|yapistir|\bpano(da|daki|dan) |\bpanodaki\b|clipboard/;
const PANO_WORD = /\bpano\w*/g;
/**
 * Kartı açıkça elleyen söz ("e-posta kartını küçült", "toplantı kartını kaldır", "dövizin yanına koy"): kartın adı
 * başka bir kümenin adı olsa da iş panonundur; e-posta, toplantı ve takip kümeleri açılmaz.
 */
const CARD_TALK = /\b(kart|kutu)\w* (kaldir|sil|buyut|kucult|tasi|sirala|koy|al|yukari|asagi|en uste|en alta)|yanina (al|koy|tasi)|(yukari|asagi|en uste|en alta) (al|tasi|koy)/;
const CARD_YIELDS: ReadonlySet<LocalGroupId> = new Set<LocalGroupId>(['mail', 'meeting', 'watch']);
const PROJECTS_INTENT = /proje|klasor|repo|\bkod|vs code|vscode|editor|terminal|claude/;
/** Claude Code oturumları: "Claude'a şunu yaptır", "oturuma şunu söyle", "Claude ne durumda", "Claude'u durdur", ara. */
/**
 * Claude Code oturumları. demo.5: "X projemde şunu yap / şuna bak / şunu ekle" (proje adı + iş) de bu kümedir: iş
 * oturuma verilir (`code_session_start`), asistan kendisi fare/klavyeyle yapmaya kalkmaz. "X projesini aç" proje kümesidir.
 */
const CODE_PROJECT_WORK =
  /\bproje\w*\b.*\b(yap|yapsin|ekle|duzelt|degistir|guncelle|bak|baktir|incele|devam|surdur|bitir|hallet|calistir|olustur|kur|kaldir|tamamla|refactor|gelistir)/;
const CODE_INTENT = new RegExp(`claude|klod|cloud kod|\\bkod|oturum|ajan|yazdir|yaptir|duzelt|commit|derle|test et|${CODE_PROJECT_WORK.source}`);
/**
 * Belge ve dosya: oku, ara, listele, üret; sohbete eklenen dosya (`attachment_id`). "Beyanname", "fatura", "sözleşme"
 * tek başına belge işareti DEĞİLDİR (sık söylenen bir söz: "KDV beyannamesini hatırlat"; ölçüm: küme bu sözde de
 * açılınca 19 araç sunuldu ve model hatırlatıcı kurmak yerine listeledi): yalnız içeriği soruluyorsa belge sayılır.
 */
const DOCS_CONTENT_ASK =
  /^(?!.*(hatirlat|animsat))(?=.*(beyanname|fatura|sozlesme)).*(ne yaziyor|yaziyor mu|\boku\b|okur musun|ozetle|ozeti|icinde ne|son odeme|tutar|ne kadar|ne zaman|hangi tarih|kac (tl|lira))/;
const DOCS_WORDS = /pdf|belge|dokuman|dosya|evrak|dekont|makbuz|levha|\bekte\b|ekteki|ekledigim|attachment_id/;
const DOCS_INTENT = new RegExp(`${DOCS_WORDS.source}|masaustu|indirilenler|\\bword\\b|excel|powerpoint|sunum|docx|xlsx|pptx|${DOCS_CONTENT_ASK.source}`);
/** Belgenin İÇERİĞİ soruluyor: okumadan yanıt verilemez. Belge üretme isteği ("Word yap") bunun dışındadır. */
const DOCS_GROUNDED = new RegExp(`${DOCS_WORDS.source}|${DOCS_CONTENT_ASK.source}`);
/**
 * Atölye: yetenek geliştir, say, aç/kapat, kaldır. d6: "bunu yapabilir hale gel", "artık şunu da yap", "eklenti yaz" da
 * buradadır (önce yalnız "yetenek/özellik" sözüyle açılıyordu; asistan bu sözlerde aracı görmeyip "yapamıyorum" diyordu).
 */
const WORKSHOP_INTENT =
  /yetene[kg]|ozelli[kg]|atolye|beceri|eklenti|kendine .*(ekle|gelistir|ogren|yaz)|kendini gelistir|kendini guncelle|yapabilir hale gel|yapabilecek hale|hale getir kendini|artik (bunu|sunu|bunlari|onu) (da )?(yap\b|yapabil)|bunu (da )?(ogren|yapmayi ogren)|onceki surum|surume don|guncelleme|cekirdek|neler yapabil/;
/**
 * Asistanın bir önceki yanıtındaki "isterseniz kendime bu yeteneği ekleyebilirim" önerisi (öz-tanımın kuralı) ve kullanıcının
 * kısa onayı ("evet", "olur, ekle"): onay sözünde yetenek kümesi açılmazdı (yerel yol araçları söze göre seçer).
 */
const SELF_BUILD_OFFER = /kendime (bu |boyle |bunun icin |bunu yapan )?(bir )?(yetene|ozelli|eklenti|beceri)\w* (de )?(ekleyebilirim|gelistirebilirim|yazabilirim|kazandirabilirim)/;
const AFFIRM = /^(evet|olur|tamam|peki|tabii|tabi|elbette|lutfen|hadi|isterim|ekle|gelistir|yap|yaz|ogren|kesinlikle|aynen|ekleyebilirsin|gelistirebilirsin)\b/;

/**
 * Söze göre küme seçiminin kullanacağı kullanıcı sözleri (yeniden eskiye). Asistan bir önceki yanıtında kendine yetenek
 * eklemeyi önerdiyse ve kullanıcı kısaca onayladıysa, onay sözü yetenek kümesini açar (yalnız seçim içindir; modele giden söz
 * değişmez).
 */
export function routingTexts(userTexts: readonly string[], previousReply: string | null | undefined): string[] {
  const out = [...userTexts];
  if (!previousReply || out.length === 0) return out;
  if (!SELF_BUILD_OFFER.test(foldTr(previousReply))) return out;
  if (!AFFIRM.test(foldTr(ownWords(out[0]!).text).replace(/^[^\p{L}]+/u, ''))) return out;
  out[0] = `${out[0]} (kendine yetenek ekle)`;
  return out;
}

/** Konuşmadaki son kullanıcı iletisinden ÖNCEKİ asistan yanıtı (yoksa `null`). */
export function previousReplyOf(messages: ReadonlyArray<{ role: string; text?: string }>): string | null {
  let index = messages.length - 1;
  while (index >= 0 && messages[index]!.role !== 'user') index--;
  for (index -= 1; index >= 0; index--) {
    const text = messages[index]!.role === 'assistant' ? messages[index]!.text : undefined;
    if (text?.trim()) return text;
  }
  return null;
}
/** Derin araştırma: "şunu araştır", "rapor hazırla". */
const RESEARCH_INTENT = /arastir|rapor hazirla|rapor cikar|derinlemesine|kapsamli/;
/**
 * Ortamda geçen konuşma: "bugün ne konuştuk", "dün ne karar verdik", "ortam dinlemeyi duraklat", "son on dakikayı unut".
 * Sohbetin kendisini soran söz ("az önce ne söylemiştim") bunun dışındadır.
 */
const AMBIENT_INTENT =
  /ne konustuk|ne konusmustuk|neler konus|ne karar ver|kime ne soz|ne soz verdi[mk]|toplantida ne|ortam (dinleme|not|kayd|ozet)|ortami dinle|dinlemeyi (duraklat|durdur)|not tutmayi|ozel konusacag|dakikayi (unut|sil)|konusulan(i|lari) (unut|sil)|gunun (ozeti|raporu)|gun kaydi/;
/** Ortamda ne konuşulduğu soruluyor: kayıt okunmadan yanıtlanamaz. */
const AMBIENT_GROUNDED = /ne konustuk|ne konusmustuk|neler konus|ne karar ver|kime ne soz|ne soz verdi[mk]|toplantida ne/;
const VOICE_MORE_INTENT =
  /dinle|uyandirma|duraklat|mikrofon.*(durum|acik mi|kapali mi)|ses.*durum|sessiz kip.*(acik|kapali) mi|(sohbet|konusma)\w*\s+(bitir|kapat|sonlandir)|vedalas/;
/**
 * Sesle ayar, sınama ve gezinme. Kalıp dardır: "ayarla" (hatırlatıcı/alarm ayarlama) bu kümeyi AÇMAZ, yalnız "ayarlar"
 * adı ve çekimleri; "izin" tek başına değil (Claude Code izin istekleri başka kümenin işidir), bilgisayar/ekran izinleri;
 * "sayfa" tek başına değil (açık web sayfası tarayıcı kümesinin işidir), "… sayfası(nı)".
 */
const SETTINGS_INTENT =
  /\bayarlar(i|a|da|dan|in|ina|ini|imi|ima|imiz|inda|indan)?\b(?! mi)|\bayar\b|\bayari\b|ayarlayabil|ayarlanabil|sinama|\bsina\b|sinar misin|sinayalim|alistirma|\balistir\b|kalibr|sessiz saat|rahatsiz etme|bildirim.{0,6}ses|hitap|diye (seslen|cagir|hitap)|(kullanma|okuma|kontrol) izn|(bilgisayar|ekran|pencere|tarayici)\w* izn|\bizinleri\w*|windows.{0,12}(basla|acil)|kendiliginden basla|otomatik basla|acilista (basla|calis)|ses motor|seslendirme motor|konusma motor|ses secim|baska (bir )?ses\b|sesini degis|(erkek|kadin) ses|\bsesi\w*\b.*\b(erkek|kadin)\b|\w+ sayfasi\w*|(ana ekran|kokpit|bugun ekran)\w* (ac|git|gec)\b|son (sohbet|konusma)|sohbet gecmis|hareketi azalt|animasyon|kisayol|uyandirma soz\w* .*(degis|yap\b|olsun)|\badin\w* .*(degis|olsun)|modeli\w* (degis|sec)|soz kesme (kip|ayar)/;
/**
 * Ayar/sınama/gezinme sözünde "aç", "başlat" fiili uygulama açma kümesini de açar ("ekran okuma iznini aç", "söz kesme
 * sınamasını başlat"); küçük model ikisini karıştırıp `app_open` çağırabilir. Söz bu kümeyi açıyorsa uygulama/site açma
 * araçları yalnız sözde açık bir hedef (adres, uygulama, Windows ayarları) varsa sunulur.
 */
/** İşletim sisteminin ayarları (asistanın Ayarlar sayfası değil). */
const OS_SETTINGS = /windows\w* ayar|sistem ayar|denetim masasi/;
const OPEN_TARGET =/https?:|www\.|\b[a-z0-9-]+\.(com|ai|io|net|org|co|dev|app)\b|uygulama|program|\bsite\w*|hesap makinesi|not defteri|tarayici|chrome|klasor|dosya|windows ayar|sistem ayar|denetim masasi/;
/**
 * Toplantı modu: "toplantı modunu aç", "toplantıyı bitir/özetle", "geçen toplantıda ne karar verdik", "görüşmeyi yazıya dök".
 * "3'teki toplantıyı hatırlat" gibi hatırlatıcı sözünde küme AÇILMAZ (hatırlatıcı çekirdek kümededir).
 */
const MEETING_INTENT =
  /^(?!.*(hatirlat|animsat|takvim))(?=.*(toplanti|gorusme|meeting)).*(mod|kayd|kaydet|kaydi|yaziya dok|dokum|baslat|\bac\b|acar misin|acsana|bitir|bitti|kapat|durdur|ozet|karar|konustu|konusmus|ne dedi|ne denmis|yapilacak|gecen|son toplanti)/;
/** Toplantıda ne konuşulduğu soruluyor: kayıt okunmadan yanıtlanamaz. */
const MEETING_GROUNDED = /^(?!.*(hatirlat|animsat))(?=.*(toplanti|gorusme)).*(ne karar|ne konus|ne dedi|ne denmis|ozetle|ozeti|yapilacak)/;
/** Güncel bilgi isteği: hava, kur, haber, arama, gün/tatil. */
const INFO_INTENT =
  /hava|sicaklik|derece|yagmur|yagis|kar yag|ruzgar|\bkur\b|\bkuru\b|doviz|dolar|euro|sterlin|altin|borsa|bitcoin|haber|gundem|son dakika|\bmac\b|skor|fiyat|kac lira|kac tl|arastir|\bara\b|arat|internet|google|\bweb\b|sitede|\bbak\b|nedir|kimdir|guncel|son durum|tatil|bayram|gunlerden|hangi gun/;
/** "Bir şey aç" işareti: açma fiili ya da açık bir adres. "Google'a sor", "bir bak" açma isteği DEĞİLDİR. */
const OPEN_INTENT =
  /\bac\b|\bacar misin|\bacsana|\bacabilir|\bacalim|\bacin\b|\bacsin\b|\bacar\b|baslat|calistir|https?:|www\.|\b[a-z0-9-]+\.(com|ai|io|net|org|co|dev|app)\b|hesap makinesi|not defteri/;
/**
 * Kullanıcının tarayıcısı: sekme, açık sayfa, "tarayıcıda aç", "Google'da ara", "şu sayfaya git". "Tarayıcın…" (asistanın kendi
 * tarayıcısı: JBROWSER_INTENT) bu kümeyi açmaz.
 */
const BROWSER_INTENT = /tarayici(?!n)|chrome|\bedge\b|sekme|sayfada|sayfayi|sayfaya git|adrese git|google da ara|googleda ara|google dan ara|internette ac|\bsite(yi|sini|ye)\b/;
/**
 * Asistanın KENDİ tarayıcısı: "kendi tarayıcında", "senin tarayıcında" (katlanmış: tarayicin…; kullanıcınınki tarayicim…),
 * giriş yapılan sitede iş (e-Devlet, panel, başvuru, form doldurma), kullanıcının parolayı girdiğini söylemesi.
 */
const JBROWSER_INTENT =
  /kendi tarayici|senin tarayici|tarayicin(da|dan|i|a)?\b|tarayicini\b|tarayici penceren|e-?devlet|turkiye\.gov|giris yap|oturum ac|uye ol|kaydol|form(u|a)? doldur|basvur|siteye gir|sitesine gir|sitesinde .*(yap|doldur|tikla|bak|gir)|paneline gir|hesabima gir|sepete ekle|siparis ver|bilet al|randevu al|sifremi girdim|parolami girdim|kodu girdim/;
/**
 * Söz asistanın KENDİ tarayıcısını adıyla anıyor ("kendi tarayıcında", "senin tarayıcında", "tarayıcında"): iş orada
 * yapılır. Aynı sözdeki "aç" / "sitesini" kullanıcının tarayıcısı kümesini ve uygulama/site açma kümesini de açardı
 * (demo.3 bütünleştirmesi, ölçüm: "kendi tarayıcında example.com sitesini aç" sözünde 28 araç, pay aşımı; `url_open`
 * kullanıcının tarayıcısında açar). Bu sözde o iki küme sunulmaz.
 */
const OWN_BROWSER = /kendi tarayici|senin tarayici|tarayicin(da|dan|i|a)?\b|tarayicini\b|tarayici penceren/;
/** Asistanın tarayıcısında açık sayfanın içeriği soruluyor. */
const JBROWSER_GROUNDED = /tarayicinda ne|tarayicindaki sayfa|acik tuttugun sayfa/;
/** Açık sayfanın içeriği soruluyor. */
const BROWSER_GROUNDED = /sekme|sayfada ne|acik sayfa|bu sayfa/;
/** Güncel veri: model bilemez, araçla okunur. */
const INFO_GROUNDED = /hava durumu|hava nasil|hava kac|havasi|havalar|sicaklik|kac derece|yagmur|yagis|doviz|dolar|euro|sterlin|gram altin|altin fiyat|altin kac|bitcoin|borsa|haberler|gundem|son dakika|skor/;
/**
 * Takip işi: "takip et", "… değişince / çıkınca / düşünce / bitirince söyle", "işlerim ne durumda", "şu işi iptal et".
 * Hatırlatıcı sözü ("yarın saat onda hatırlat") ve "yarınki işlerimi göster" bunu AÇMAZ: onlar planlar kümesinin işidir.
 */
const WATCH_INTENT =
  /takip et|takibe al|takibi|takipte|izlemeye al|gozle|gozcu|(sayfa|site|dosya|klasor|pencere|sekme|fiyat)\S* izle|degisince|degisirse|degistiginde|gorununce|gorunurse|cikinca|cikarsa|dusunce|duserse|yukselince|yukselirse|bitince|bitirince|bitirdiginde|bittiginde|cevap verince|yanit verince|gelince|gelirse|geldiginde|\bis(ler)?im ne durumda|\bisler ne durumda|neleri takip|takip ettik|\bisi (iptal|durdur|duraklat|surdur)|\bise devam/;
/**
 * Brifing, gündem kaynakları ve profil: "brifing ver", "daha az konuş", "sabah brifingini sekizde ver", "şu RSS kaynağını
 * ekle", "yapay zekâ haberlerini takip et", "kaynaklarını say", "beni nasıl tanıyorsun". Yalın "haberler" / "gündem"
 * bu kümeyi AÇMAZ (güncel bilgi kümesinin `news_get` aracı yanıtlar): küçük modelin önüne dokuz araç daha konmasın.
 */
const BRIEFING_INTENT =
  /brifing|gunun ozet|gunluk ozet|bugun neler var|\brss\b|besleme|haber kayna|gundem kayna|kaynak\w* (ekle|cikar|kaldir|sil|say|listele)|kaynaklar(in|ini|ina)\b|(haber|gelisme|konu)\w* (takip et|takibe al|takipten cikar|gosterme|sessize al)|\w+ (haberlerini|gelismelerini) (takip et|istemiyorum|gosterme|sorma)|haberleri sorma|takip (ettigin )?konu|daha (az|cok|sik|seyrek) konus|kendiliginden konus|\baz konus|cok konusuyorsun|eskisi gibi konus|onemli gelisme\w* araya gir|beni (nasil )?tani(yor|din)|hakkimda ne (bil|ogren)|benimle ilgili ne (bil|ogren)|hangi kurallarimi/;
/**
 * E-posta: "e-postalarıma bak", "Ahmet'ten mail geldi mi", "şuna yanıt yaz", "gelen kutusunda ne var". Yalın "ileti" ve
 * "mesaj" işaret değildir (sohbet iletisi); "cevap ver" de değildir (sohbette sık).
 */
const MAIL_INTENT =
  /thunderbird|betterbird|e-?posta|\bmail|\bmeyl|gelen kutu|posta kutu|okunmamis (ileti|posta|mail)|ileti (geldi|gelmis|var mi)|yanit(la|i? yaz|i? hazirla)|cevap(la|i? yaz|i? hazirla)|(yanit|cevap|mail|e-?posta) tasla[kg]/;
/** Gelen kutusu soruluyor: listelenmeden yanıtlanamaz. */
const MAIL_GROUNDED = /(e-?posta|\bmail|\bmeyl|ileti)\w* (geldi|gelmis|var mi|ne diyor|ne yaziyor|ne istiyor|oku)|gelen kutu|okunmamis|kimden (mail|e-?posta|ileti)/;
/** Pencere, klavye, fare, ortam tuşları. */
const PC_INTENT =
  /tikla|\btik\b|fare|imlec|surukle|klavye|\btus|\byaz\b|yazdir|pencere|kaydir|ekran goruntusu|ekranda|ekrana bak|ekranim|kopyala|yapistir|buyut|kucult|simge durum|one getir|muzi|sarki|video|oynat|ses duzeyi|sesini|yan yana|yerlestir|hizala|ortala|monitor/;
/** Ekranda ya da pencerede ne olduğu soruluyor. */
const PC_GROUNDED = /ekranda ne|ekranimda ne|pencerede ne|ekrana bak|hangi pencere/;
/** Dosya yönetimi: kopyala, taşı, yeniden adlandır, sil, klasör oluştur, bul, Gezgin'de göster. */
const FILES_INTENT = /dosya|klasor|kopyala|\btasi|yeniden adlandir|adini degistir|geri donusum|cop kutusu|gezgin|explorer/;
/** Sistem: bilgisayarın durumu, süreçler, ağ, kurulu uygulamalar, pano, komut, parlaklık, kilit, güç, ekran görüntüsü kaydı, bildirim. */
const SYSTEM_INTENT =
  /komut|powershell|\bcmd\b|surec|islemci|bellek|\bram\b|\bdisk|\bpil\b|sarj|batarya|ekran karti|\bgpu\b|\bcpu\b|sistem bilgi|bilgisayar(in|im)? (ozellik|durum|bilgi)|\bwifi\b|wi-fi|internet bagl|\bag (durum|bagl)|ip adres|kurulu|yuklu (uygulama|program)|\bpano|clipboard|parlakli|kilitle|\buyku|\buyut|yeniden baslat|bilgisayari kapat|ekran goruntusu (al|kaydet)|bildirim|(uygulama|program)(yi|i)? kapat|sonlandir/;
/** Bilgisayarın o anki durumu soruluyor: sorgu araçlarıyla okunmadan sayı verilemez. */
const SYSTEM_GROUNDED = /kac (gb|mb)|ne kadar (bellek|ram|disk|yer|sarj)|sarj(im)? kac|pil(im)? kac|disk(te)? ne kadar|hangi surecler|ip adres/;

const INTENT_GROUPS: readonly IntentGroup[] = [
  { id: 'planner', label: 'hatırlatıcı/yapılacak düzenleme', tools: LOCAL_TOOLS_PLANNER_MORE, intent: PLANNER_MORE_INTENT },
  // Takip sözü dar ve açıktır ("takip et", "… gelince söyle"): araç payı aşılınca sondan kırpılan kümelerden önce gelir.
  { id: 'watch', label: 'takip işleri', tools: LOCAL_TOOLS_WATCH, match: /^watch_/, intent: WATCH_INTENT },
  // Brifing ve gündem sözü dardır ("brifing", "RSS", "kaynak ekle", "daha az konuş"); takipten sonra, kırpılan kümelerden önce.
  { id: 'briefing', label: 'brifing, gündem kaynakları ve profil', tools: LOCAL_TOOLS_BRIEFING, match: /^(briefing_|feed_)/, intent: BRIEFING_INTENT },
  { id: 'stage', label: 'ekranda kart', tools: LOCAL_TOOLS_STAGE, intent: STAGE_INTENT },
  // Araç adları modülde (`modules/dashboard/tools.ts`); kümeye tanımdaki `group` etiketiyle ve önekle girerler.
  { id: 'dashboard', label: 'Kokpit panosu (kalıcı kart, düzen, öneri)', tools: LOCAL_TOOLS_DASHBOARD, match: /^(dashboard_|suggestion_)/, intent: DASHBOARD_INTENT },
  { id: 'docs', label: 'belge ve dosya', tools: LOCAL_TOOLS_DOCS, match: /^(document_|file_)/, intent: DOCS_INTENT, grounded: DOCS_GROUNDED },
  { id: 'mail', label: 'e-posta', tools: LOCAL_TOOLS_MAIL, intent: MAIL_INTENT, grounded: MAIL_GROUNDED },
  { id: 'projects', label: 'proje bulma/açma', tools: LOCAL_TOOLS_PROJECTS, intent: PROJECTS_INTENT },
  { id: 'code', label: 'Claude Code oturumları', tools: LOCAL_TOOLS_CODE, match: /^(code_session_|claude_)/, intent: CODE_INTENT },
  { id: 'workshop', label: 'Atölye (yetenekler)', tools: LOCAL_TOOLS_WORKSHOP, match: /^skill_/, intent: WORKSHOP_INTENT },
  { id: 'voice', label: 'seyrek ses araçları', tools: LOCAL_TOOLS_VOICE_MORE, intent: VOICE_MORE_INTENT },
  // Uygulama/site açma kümesinden ÖNCE: "ayarları aç", "… sınamasını başlat" sözünde model önce bunları görür.
  { id: 'settings', label: 'sesle ayar, sınama ve gezinme', tools: LOCAL_TOOLS_SETTINGS, match: /^settings_/, intent: SETTINGS_INTENT },
  { id: 'ambient', label: 'ortam dinleme (gün kaydı)', tools: LOCAL_TOOLS_AMBIENT, match: /^ambient_/, intent: AMBIENT_INTENT, grounded: AMBIENT_GROUNDED },
  { id: 'meeting', label: 'toplantı modu', tools: LOCAL_TOOLS_MEETING, match: /^meeting_/, intent: MEETING_INTENT, grounded: MEETING_GROUNDED },
  // Güncel bilgi araçları, açan araçlardan ÖNCE: bilgi sorusunda model sayfa açmak yerine bunları görür.
  { id: 'info', label: 'güncel bilgi', tools: LOCAL_TOOLS_INFO, match: /^(weather_|web_|fx_|news_|day_)/, intent: INFO_INTENT, grounded: INFO_GROUNDED },
  { id: 'research', label: 'derin araştırma', tools: LOCAL_TOOLS_RESEARCH, match: /^research_/, intent: RESEARCH_INTENT },
  { id: 'open', label: 'uygulama/site açma', tools: LOCAL_TOOLS_OPEN, intent: OPEN_INTENT },
  { id: 'jbrowser', label: 'asistanın kendi tarayıcısı', tools: LOCAL_TOOLS_JBROWSER, match: /^jbrowser_/, intent: JBROWSER_INTENT, grounded: JBROWSER_GROUNDED },
  { id: 'browser', label: 'kullanıcının tarayıcısı', tools: LOCAL_TOOLS_BROWSER, match: /^browser_/, intent: BROWSER_INTENT, grounded: BROWSER_GROUNDED },
  { id: 'pc', label: 'bilgisayar denetimi', tools: LOCAL_TOOLS_PC, match: /^pc_/, intent: PC_INTENT, grounded: PC_GROUNDED },
  // d3: `file_*` öneki belge kümesine de uyar; pc modülünün dosya araçları tanımlarındaki `group: 'files'` ile buraya girer.
  { id: 'files', label: 'dosya yönetimi', tools: LOCAL_TOOLS_FILES, intent: FILES_INTENT },
  { id: 'system', label: 'sistem, pano, komut', tools: LOCAL_TOOLS_SYSTEM, intent: SYSTEM_INTENT, grounded: SYSTEM_GROUNDED },
];
const INTENT_IDS = new Set<string>(INTENT_GROUPS.map((group) => group.id));

/** Yerel modelin HİÇBİR zaman çağıramadığı araçlar (ad kalıbı tutsa da): küçük modelde güvenilir olmayanlar. */
const LOCAL_NEVER = new Set(['stage_show_app', 'jbrowser_download']);

/**
 * İşi DERİN beyinde yürüyen araçlar (Anthropic API ya da bu bilgisayardaki Claude Code): kümelerindedirler ama derin
 * beynin olmadığı BİLİNİYORSA o turda sunulmazlar (yalnız hata döndürürlerdi; nedeni öz-durum ipucu söyler). Derin
 * beynin durumu henüz bilinmiyorsa sunulurlar: araç durumu kendisi söyler.
 */
export const LOCAL_NEEDS_DEEP: ReadonlySet<string> = new Set(['skill_build', 'research_start', 'screen_look', 'jbrowser_screenshot']);

/**
 * Derin beyin isteyen işi AÇIKÇA isteyen söz (katlanmış). Kümenin açılması bunun kanıtı değildir ("müziği durdur" da
 * bilgisayar kümesini açar). Derin beyin yokken kullanıcı böyle bir iş isterse "bulut beynim yok, bu bilgisayardaki
 * modelle çalışıyorum" duyurusu söylenir (günde en çok bir kez; `core/brain.ts`). Yeni bir derin araç ekleyen görev
 * kalıbını da yazar; kalıbı olmayan araç duyuruyu tetiklemez.
 */
export const LOCAL_DEEP_ASKS: Readonly<Record<string, RegExp>> = {
  skill_build:
    /(yetene[kg]|ozelli[kg]|beceri|eklenti|atolye|kendine|kendini).*(gelistir|ekle|ogren|kazan|olustur|\byaz\b|\byap\b)|(gelistir|ekle|ogren|kazan|\byaz\b).*(yetene[kg]|ozelli[kg]|beceri|eklenti)|yapabilir hale gel|yapabilecek hale/,
  research_start: /arastir|rapor hazirla|rapor cikar|derinlemesine|kapsamli/,
  screen_look: /ekrana bak|ekranima bak|ekranda ne|ekranimda ne|ekrani(mi)? (gor|yorumla|oku)|ekrandaki\w* (ne|yorumla|acikla)/,
};

/**
 * Söz kapısı: kümesi açılsa bile yalnız kullanıcının sözü (ya da bir önceki söz) o işi AÇIKÇA söylüyorsa sunulan
 * araçlar. Geri alınamayan işler içindir: yanında zararsız bir kardeşi olan araç (`skill_enable` ↔ `skill_remove`)
 * modelin önünde durdukça küçük model ikisini karıştırır. Köprü e2e'sinde "…yeteneğini kapat" sözünde, kısa tanımlar
 * ayrıştırıldıktan sonra bile bağlama göre üç denemenin üçünde `skill_remove` çağrıldı (onay kartı çıktığı için silinmedi
 * ama kullanıcının istediği iş de yapılmadı). Kalıplar katlanmış (`foldTr`) metinle eşleşir; `all` kipinde uygulanmaz.
 */
export const LOCAL_WORD_GATES: Readonly<Record<string, RegExp>> = {
  // Çekirdek güncellemesini KURMAK ve geri almak: yalnız söz açıkça isteyince sunulur (ayrıca iki onay çıkar).
  core_install: /\bkur\b|\bkurar|\bkurayim|yukle/,
  core_rollback: /onceki surum|geri al|eski haline|surume don/,
  skill_remove: /\bkaldir|\bsil(?!ah|gi|indir|ik|k)|\bcikar|\buninstall/,
  // E-posta GÖNDERİMİ: "şuna yanıt yaz" sözünde model taslak yerine doğrudan göndermesin (onay kartı yine çıkardı).
  mail_send: /\bgonder|\byolla|\bsend\b|\bilet(\b|sene|ir misin|ebilir)/,
  // d3 (bilgisayar): geri alınamayan ya da seyrek işler yalnız söz açıkça isteyince sunulur (ayrıca onay kartı çıkar).
  file_delete: /\bsil(?!ah|gi|indir|ik|k)|\bkaldir|geri donusum|cop kutusu/,
  pc_run_command: /komut|powershell|\bcmd\b|terminal|betik|script|calistir/,
  process_output: /komut|cikti|surec|arka plan|calisiyor mu|bitti mi/,
  process_stop: /durdur|sonlandir|\bkapat|iptal/,
  file_write: /\byaz|olustur|kaydet/,
  file_edit: /duzenle|duzelt|degistir|guncelle/,
  process_kill: /sonlandir|oldur|\bkill|zorla kapat|gorev(i)? sonlandir/,
  // Yalın "kapat" kapıyı açmaz: "uygulamayı kapat" sözünde `app_close`'un yanında güç aracı durmasın.
  system_power: /bilgisayari kapat|pc(yi)? kapat|yeniden baslat|\buyku|\buyut|restart|shutdown/,
  system_power_cancel: /iptal|vazgec|kapatma|yeniden baslat/,
  system_lock: /kilit/,
  pc_selftest: /sina|\bdene|\btest/,
  pc_screens: /ekran|monitor/,
  pc_window_arrange: /yan yana|\btasi|yerles|boyut|\bsol|\bsag|kose|ortala|hizala|\bdiz|ekrana al|diger ekran/,
};

/** Küme tablosu (rapor ve belgeler için): kimlik, ad, sabit araç adları, niyet kalıbı. */
export const LOCAL_GROUP_TABLE: ReadonlyArray<{ id: LocalGroupId; label: string; tools: readonly string[]; intent: string | null }> = [
  { id: 'core', label: 'çekirdek (her turda)', tools: LOCAL_TOOLS_BASE, intent: null },
  ...INTENT_GROUPS.map((group) => ({ id: group.id, label: group.label, tools: group.tools, intent: group.intent.source })),
];

/** Yerel modelin çağırmasına izin verilen, adı sabit araçlar. */
export const LOCAL_TOOLS = new Set<string>([...LOCAL_TOOLS_BASE, ...INTENT_GROUPS.flatMap((group) => group.tools)]);

/** Aracın tanımında bildirdiği küme (`ToolDef.group`); bildirmediyse `undefined`. */
export type DeclaredGroup = (name: string) => string | undefined;

/**
 * Aracın yerel kümesi; hiçbir kümeye girmiyorsa `null` (yerelde sunulmaz). Tanımdaki `group` alanı önce gelir;
 * bilinmeyen bir değer taşıyorsa ad listelerine ve öneklere bakılır.
 */
export function localGroupOf(name: string, declared?: string): LocalGroupId | null {
  if (declared === 'core' || declared === 'deep' || (declared !== undefined && INTENT_IDS.has(declared))) return declared as LocalGroupId;
  if (LOCAL_NEVER.has(name)) return 'deep';
  if ((LOCAL_TOOLS_BASE as readonly string[]).includes(name)) return 'core';
  // Adı bir kümenin sabit listesinde geçen araç o kümededir; önek (`file_`, `pc_`) yalnız listede olmayanlar içindir
  // (`file_copy` dosya yönetimidir, belge kümesinin `file_` öneki onu almaz; `pc_run_command` sistemdir).
  return (INTENT_GROUPS.find((group) => group.tools.includes(name)) ?? INTENT_GROUPS.find((group) => group.match?.test(name)))?.id ?? null;
}

/** Yerel model bu aracı çağırabilir mi (bir kümeye giriyor). Derin beyin isteyenler için ayrıca `LOCAL_NEEDS_DEEP`'e bakılır. */
export function isLocalTool(name: string, declared?: string): boolean {
  const group = localGroupOf(name, declared);
  return group !== null && group !== 'deep';
}

/** Kullanıcı yeteneklerinin (Atölye) modül kimliği öneki (`modules/workshop/service.ts` › `MODULE_PREFIX`). */
export const SKILL_MODULE_PREFIX = 'skill:';

/**
 * Yerel modele en çok bu kadar yetenek aracı sunulur. Etkin yeteneklerin araçları sabit listede olamaz (çalışma
 * anında doğarlar); yerleşik araçların üstüne eklenirler. Sınır, küçük modelin araç sayısıyla bozulmasına ve bağlam
 * bütçesine karşıdır. Fazlası ada göre sıralı ilk altıdan sonra sunulmaz (bulut beyni hepsini görür).
 */
export const LOCAL_SKILL_TOOL_LIMIT = 6;

/** Kayıtlı araçlardan kullanıcı yeteneklerine ait olanların adları (ada göre sıralı, sınırla kesilmiş). */
export function selectSkillTools(tools: ReadonlyArray<{ name: string; moduleId: string }>, limit = LOCAL_SKILL_TOOL_LIMIT): string[] {
  return tools
    .filter((tool) => tool.moduleId.startsWith(SKILL_MODULE_PREFIX))
    .map((tool) => tool.name)
    .sort((a, b) => a.localeCompare(b))
    .slice(0, limit);
}

/**
 * `base`: yalnız çekirdek küme · `all`: yerel modelin çağırabildiği her şey her turda (ölçüm için) ·
 * `routed`: çekirdek her turda; öteki kümeler yalnız söz işaret ederse (bu ya da bir önceki kullanıcı sözü).
 */
export type LocalToolMode = 'base' | 'all' | 'routed';

/**
 * Varsayılan kip ve dayanağı.
 *
 * 16 Kasım 2026 gecesi (demo.1), Qwen3.5-4B Q4_K_M, sıcaklık 0,3, 21 istem × 3 yineleme (doğru araç / 63):
 *   base (13 araç) 33 · all (22 araç, her turda aynı) 54, 53, 54, 45 · routed (20 + söze göre 2 açma) 52, 52.
 * Koşudan koşuya oynama (±5–9) kipler arasındaki farktan büyüktü; kazanç görülmediği için `all` seçilmişti.
 *
 * İlk gerçek kullanım denemesi `all`'ın iki bedelini gösterdi: (1) hava durumu sorusunda model iki
 * kez `url_open` ile tarayıcı açtı; (2) 22 aracın özgün şemaları 4.613 token tutuyordu (ölçüm: sunucunun kendi
 * şablonu ve belirteçleyicisi), tur başına ~5,7 bin girdi. Ardından web, bilgisayar ve Claude Code araçları geldi
 * (25 araç daha): hepsi her turda sunulamaz. Bu yüzden araçlar söze göre sunulur (`routed`) ve bütün tanımlar
 * kısaltılır (`compactToolSpec`). Güncel ölçümler `docs/TUZAKLAR.md` › "Yerel beyin (demo.2)".
 */
export const DEFAULT_LOCAL_TOOL_MODE: LocalToolMode = 'routed';

export const foldTr = (text: string): string =>
  text
    .toLocaleLowerCase('tr')
    .replace(/[çğıöşüâîû]/g, (ch) => ({ ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' })[ch] ?? ch);

/** Belge modülünün söze gömdüğü ek metni (`documents/text.ts` › `untrusted`): `<<<BELGE … BELGE>>>`. */
const EMBEDDED_DOC = /<<<BELGE[\s\S]*?BELGE>>>/g;

/**
 * Kullanıcının KENDİ sözü: söze gömülü ek metni çıkarılır. Niyet, saat, "yaptım" gibi bütün söz çözümlemeleri bunun
 * üzerinde yapılır; yoksa belgenin içindeki sözcükler ("ödedim", "yarın saat 10", "hava") kullanıcı söylemiş gibi
 * araç kümeleri açar. Ölçüm (demo.2 bütünleştirmesi): ekli PDF'e "bu beyannamede son ödeme günü ne?" diye sorulunca
 * model başka bir modülün aracını çağırdı, "kayıt yok" yanıtını alıp belgeye erişemediğini söyledi; oysa metin sözün içindeydi.
 */
export function ownWords(text: string): { text: string; embedded: boolean } {
  let embedded = false;
  const own = text.replace(EMBEDDED_DOC, () => {
    embedded = true;
    return '';
  });
  return { text: embedded ? own.replace(/\n{3,}/g, '\n\n').trim() : text, embedded };
}

/**
 * Bu turda yerel modele sunulacak araç adları, SUNULUŞ SIRASIYLA: önce çekirdek (istem öneki turdan tura aynı
 * kalsın), sonra BU sözün işaret ettiği kümeler, en sonda yalnız bir önceki sözün taşıdığı kümeler (devam cümlesi:
 * "evet aç", "onu iptal et"). Araç bütçesi aşılırsa çağıran listeyi sondan kırpar; çekirdek her zaman kalır.
 * `available`: kayıtlı (modülü açık) araçlar; `userTexts`: son kullanıcı sözleri, yeniden eskiye; `declared`: aracın
 * tanımında bildirdiği küme (varsa).
 */
export function selectLocalTools(
  available: readonly string[],
  userTexts: readonly string[],
  mode: LocalToolMode = DEFAULT_LOCAL_TOOL_MODE,
  declared: DeclaredGroup = () => undefined,
  /** `deepBlocked`: derin beynin olmadığı BİLİNİYOR; derin beyin isteyen araçlar (`LOCAL_NEEDS_DEEP`) sunulmaz. */
  options: { deepBlocked?: boolean } = {},
): string[] {
  const groupOf = new Map(available.map((name) => [name, localGroupOf(name, declared(name))] as const));
  const out: string[] = [];
  // Niyet yalnız kullanıcının kendi sözünden okunur; gömülü ek metni küme açmaz (`ownWords`).
  const own = ownWords(userTexts[0] ?? '');
  const current = foldTr(own.text);
  const previous = foldTr(ownWords(userTexts[1] ?? '').text);
  const add = (name: string) => {
    const group = groupOf.get(name);
    if (options.deepBlocked && LOCAL_NEEDS_DEEP.has(name)) return;
    const gate = mode === 'routed' ? LOCAL_WORD_GATES[name] : undefined;
    if (gate && !gate.test(current) && !gate.test(previous)) return;
    if (group && group !== 'deep' && !out.includes(name)) out.push(name);
  };
  /** Kümenin araçları: önce ad listesindeki sırayla, sonra kümeye başka yoldan (etiket, önek) girenler ada göre. */
  const addGroup = (id: LocalGroupId, listed: readonly string[]) => {
    for (const name of listed) if (groupOf.get(name) === id) add(name);
    for (const name of [...available].sort()) if (groupOf.get(name) === id) add(name);
  };
  addGroup('core', LOCAL_TOOLS_BASE);
  if (mode === 'base') return out;
  if (mode === 'all') {
    for (const group of INTENT_GROUPS) addGroup(group.id, group.tools);
    return out;
  }
  // Ek metni sözün içindeyken "bu beyanname", "bu fatura" eki anlatır: belge kümesi (sonraki parçayı okumak, belgeyi kaydetmek için) her durumda açılır.
  const opens = (group: IntentGroup, text: string, withAttachment: boolean): boolean => {
    if (!withAttachment) return group.intent.test(text);
    if (group.id === 'docs') return true;
    return group.intent.test(text);
  };
  // Ayar/sınama/gezinme sözündeki "aç / başlat" uygulama açma isteği değildir (açık bir hedef yoksa).
  const settingsOnly = (text: string) => SETTINGS_INTENT.test(text) && !OPEN_TARGET.test(text);
  // Asistanın tarayıcı kümesi bu turda sunulabiliyor mu (modülü açık, izni var); sunulamıyorsa öteki kümeler kısılmaz.
  const ownBrowser = (text: string) => OWN_BROWSER.test(text) && available.some((name) => groupOf.get(name) === 'jbrowser');
  // İki pano (Kokpit / bilgisayarın panosu) ve kart adı olan kümeler: bkz. `CLIPBOARD_TALK`, `CARD_TALK`.
  const hasDashboard = available.some((name) => groupOf.get(name) === 'dashboard');
  const panoBlocked = (id: LocalGroupId, text: string): boolean => {
    if (id === 'dashboard' && CLIPBOARD_TALK.test(text)) return !DASHBOARD_INTENT.test(text.replace(PANO_WORD, ' '));
    if (id === 'system' && /\bpano/.test(text) && !CLIPBOARD_TALK.test(text)) return !SYSTEM_INTENT.test(text.replace(PANO_WORD, ' '));
    return CARD_YIELDS.has(id) && hasDashboard && CARD_TALK.test(text);
  };
  for (const group of INTENT_GROUPS) {
    if (panoBlocked(group.id, current)) continue;
    if (group.id === 'open' && settingsOnly(current)) continue;
    // Tersi: "Windows ayarlarını aç" asistanın Ayarlar sayfası değildir; ayar kümesi sunulmaz (ölçüm: model `app_navigate` çağırdı).
    if (group.id === 'settings' && OS_SETTINGS.test(current)) continue;
    // Asistanın kendi tarayıcısı adıyla anıldıysa iş orada yapılır: kullanıcının tarayıcısı ve site açma sunulmaz.
    if ((group.id === 'open' || group.id === 'browser') && ownBrowser(current)) continue;
    if (opens(group, current, own.embedded)) addGroup(group.id, group.tools);
  }
  for (const group of INTENT_GROUPS) {
    if (panoBlocked(group.id, previous)) continue;
    if (group.id === 'open' && (settingsOnly(current) || settingsOnly(previous))) continue;
    if (!own.embedded && previous && group.intent.test(previous)) addGroup(group.id, group.tools);
  }
  return out;
}

/**
 * Bağlam ipucu (`ToolDef.contextHint`) istenecek araçlar: bütün araçların sunulduğu yollarda (Claude Code)
 * ipucu her turda değil, YALNIZ söz o aracın kümesini açtığında gider ("hava durumunu en üste al" → panonun o anki
 * dizilişi). Çekirdek küme ipucu taşımaz. `userTexts`: son kullanıcı sözleri, yeniden eskiye.
 */
export function hintToolsFor(available: readonly string[], userTexts: readonly string[], declared: DeclaredGroup = () => undefined): string[] {
  const core = new Set(selectLocalTools(available, userTexts, 'base', declared));
  return selectLocalTools(available, userTexts, 'routed', declared).filter((name) => !core.has(name));
}

/** Söze göre seçilen araçların bağlam ipuçları (bkz. `hintToolsFor`); okunamazsa boş. */
export function routedContextHints(
  available: readonly string[],
  userTexts: readonly string[],
  hints: ((names: string[]) => string[]) | undefined,
  declared: DeclaredGroup = () => undefined,
): string[] {
  if (!hints || userTexts.length === 0) return [];
  try {
    const names = hintToolsFor(available, userTexts, declared);
    return names.length ? hints(names).filter((hint) => hint.trim() !== '') : [];
  } catch {
    return [];
  }
}

/**
 * Bu sözün yanıtı araçla OKUNMADAN verilemeyecek kümeler (belge, ekran, açık sayfa, güncel veri): sözde kümenin
 * `grounded` işareti var ve o kümeden en az bir araç bu turda sunuluyor. Sunulan araç yoksa (modül kapalı) kapı
 * çalışmaz: model yapamadığını kendisi söyler.
 */
export function groundingGroups(userText: string, offered: readonly string[], declared: DeclaredGroup = () => undefined): LocalGroupId[] {
  const text = foldTr(userText);
  return INTENT_GROUPS.filter((group) => group.grounded?.test(text) && offered.some((name) => localGroupOf(name, declared(name)) === group.id)).map(
    (group) => group.id,
  );
}
