// "Her şeyi konuşarak": sesle başlatılan sınamalar ve sesle gezinme için SÖZ → KOMUT eşlemesi.
//
// Kesin olması gereken iş modele bırakılmaz (`local-intents.ts` ile aynı gerekçe): "söz kesme sınamasını başlat",
// "ayarları aç" gibi dar ve kesin sözler kodla araca gider; daha serbest söyleyişte araç modele sunulur. İki kusuru
// birlikte kapatır: (1) bu sözlerde "aç / başlat" fiili uygulama açma kümesini de açıyor ve küçük model `app_open` ile
// Windows Ayarları'nı açabiliyor; (2) hangi sınamanın istendiği sözde açıkça yazıyor, model yanlış seçmesin.
//
// Kataloglar (sınamalar, sayfalar) buradadır; `modules/voice-control` araçlarını bunlarla tanımlar ve aynı çözücüyü
// kullanır. Yeni bir sayfa ekleyen görev `SPOKEN_PAGES`'e bir satır ekler.
import { routeJarvisMode } from './jarvis-mode-intent';
import { routeSpokenSetting } from './local-settings';
import { foldTr } from './local-tools';

const plain = (text: string): string =>
  foldTr(text)
    .replace(/[’'`´]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const wordCount = (text: string) => text.split(' ').filter(Boolean).length;

// ───────────────────────── sınamalar ─────────────────────────

export type SpokenTestId = 'barge_in' | 'echo' | 'wake_training' | 'mic';

export interface SpokenTest {
  id: SpokenTestId;
  /** Kullanıcıya söylenen adı. */
  label: string;
  /** Ne yaptığı, tek cümle ("hangi sınamalar var" yanıtı için). */
  about: string;
  /** Katlanmış sözde bu sınamayı işaret eden kalıp. */
  match: RegExp;
}

export const SPOKEN_TESTS: readonly SpokenTest[] = [
  {
    id: 'barge_in',
    label: 'söz kesme sınaması',
    about: 'ben üç bölüm okurum, siz her bölümde araya girersiniz; sözümü kesebildiğiniz ölçülür',
    match: /soz kesme|sozumu kes|araya gir|barge/,
  },
  {
    id: 'echo',
    label: 'yankı sınaması',
    about: 'hoparlörden kısa bir cümle çalar, sesimin mikrofona sızıp sızmadığını ölçerim',
    match: /yanki|eko\b|echo|ses\w* sizi/,
  },
  {
    id: 'wake_training',
    label: 'uyandırma alıştırması',
    about: 'üç kez uyandırma sözünü söylersiniz, sesinize alışırım',
    match: /uyandirma|uyanma soz|hey \w+ alistir|sesime alis|kalibrasyon|alistirma/,
  },
  {
    id: 'mic',
    label: 'mikrofon sınaması',
    about: 'birkaç saniye dinler, sizi duyup duymadığımı ve ne duyduğumu söylerim',
    match: /mikrofon|beni duy\w* mu|sesim gel|ses\w* geliyor mu/,
  },
];

/**
 * Fare ve klavye sınaması (bilgisayar modülü, `pc_selftest`): ses sınaması değildir, kendi aracıyla yürür (GERÇEK girdi
 * üretir; araç kapısından geçer). Bilgisayarı kullanma izni kapalıyken araç kayıtlı değildir ve söz modele kalır.
 */
export const PC_SELFTEST_SPOKEN = {
  tool: 'pc_selftest',
  label: 'fare ve klavye sınaması',
  about: 'Not Defteri’nde yazar, seçer, tıklar ve pencereyi taşırım; bilgisayarı kullanabildiğim ölçülür',
  match: /\bfare\w*|klavye\w*|bilgisayar\w* kullan\w*/,
} as const;

/** Sınama sözü: sına, sınama, test, dene, alıştır(ma). */
const TEST_WORD = /\bsina\w*|\btest\w*|\bdene\w*|alistir\w*|kalibr\w*|kontrol et/;
/** Başlatma buyruğu ya da isteği. Soru ("hangi sınamalar var") ve geçmiş ("sınama ne oldu") başlatma değildir. */
const START_WORD = /baslat|\bbasla\b|baslayalim|\byap\b|yapalim|yapar misin|yapsana|yapabilir misin|calistir|\bac\b|\bsina\b|sinar misin|sinasana|sinayalim|\btest et|\btest ed\w*|\bdene\b|dener misin|deneyelim|\balistir\b|alistirir misin|alistiralim|kontrol et/;
const NOT_START = /\bne\b|\bnedir|hangi|\bvar mi|\bnasil\b|neden|sonuc|yaptik mi|yapildi mi|ne zaman|kapat|durdur|iptal|bitir/;

/** Sözde adı geçen sınama; yoksa `null`. */
export function findSpokenTest(text: string): SpokenTest | null {
  const folded = plain(text);
  const byId = SPOKEN_TESTS.find((test) => test.id === folded.replace(/\s+/g, '_'));
  return byId ?? SPOKEN_TESTS.find((test) => test.match.test(folded)) ?? null;
}

// ───────────────────────── sayfalar ─────────────────────────

export interface SpokenPage {
  /** Ana penceredeki sayfa kimliği (`renderer/main/pages/<id>`). */
  page: string;
  /** Sayfanın içindeki sekme (`app.navigate` › `params.tab`); yoksa sayfanın kendisi. */
  tab?: string;
  label: string;
  match: RegExp;
  /** Sayfa bir modüle aitse kimliği; modül kapalıyken sayfa da yoktur. */
  moduleId?: string;
}

/** Sesle açılan sayfalar. Sekmeli girişler sayfanın kendisinden ÖNCE gelir ("ses ayarları" → Ayarlar › Ses). */
export const SPOKEN_PAGES: readonly SpokenPage[] = [
  { page: 'settings', tab: 'voice', label: 'Ayarlar › Ses', match: /ses ayar\w*|mikrofon ayar\w*|ayarlar\w* ses\w*/ },
  { page: 'settings', tab: 'hotkeys', label: 'Ayarlar › Kısayollar', match: /kisayol\w*( ayar\w*)?/ },
  { page: 'settings', tab: 'privacy', label: 'Ayarlar › Gizlilik ve veri', match: /gizlilik\w*( ve veri\w*)?( ayar\w*)?|veri ayar\w*|izin ayar\w*/ },
  // E-posta hesapları Ayarlar'ın sekmesidir (ayrı sayfa değil). "E-postalarıma bak" bir sorudur (`mail_list`), sekme isteği değil.
  { page: 'settings', tab: 'mail', moduleId: 'mail', label: 'Ayarlar › E-posta', match: /(e ?posta|\bmail|\bmeyl)\w* (ayar|hesa[bp])\w*|ayarlar\w* e ?posta\w*/ },
  // Brifing ve gündem ayarları Ayarlar'ın sekmesidir. "Brifing ver" bir istektir (`briefing_now`), sekme isteği değil.
  { page: 'settings', tab: 'briefing', moduleId: 'briefing', label: 'Ayarlar › Brifing ve gündem', match: /(brifing|gundem|rss|haber kaynak)\w* (ayar|kaynak)\w*|ayarlar\w* (brifing|gundem)\w*/ },
  { page: 'settings', tab: 'connection', label: 'Ayarlar › Bağlantı', match: /baglanti ayar\w*|yonetim baglanti\w*/ },
  { page: 'settings', tab: 'diagnostics', label: 'Ayarlar › Tanı', match: /\btani\b|\btaniyi\b|diagnostik\w*/ },
  { page: 'settings', label: 'Ayarlar', match: /\bayarlar\w*|\bayar (sayfa|ekran|pencere)\w*|settings/ },
  { page: 'chat', label: 'Sohbet', match: /sohbet\w*|konusma\w* (gecmis|sayfa)\w*|yazisma\w*|\bchat\b/ },
  { page: 'memory', moduleId: 'memory', label: 'Hafıza', match: /hafiza\w*|\bbellek\w*|anilar\w*/ },
  { page: 'planner', moduleId: 'planner', label: 'Planlar', match: /planlar\w*|\bplan (sayfa|ekran)\w*|hatirlatici\w*|yapilacak\w*|planner/ },
  { page: 'projects', moduleId: 'projects', label: 'Projeler', match: /projeler\w*|proje (sayfa|ekran|liste)\w*|claude oturum\w*|oturumlar\w*/ },
  // İşler (takip işleri; watch modülü). "İşlerim ne durumda" bir sorudur (`watch_list`), sayfa isteği değil: yer adı ya da "aç" aranır.
  { page: 'watch', moduleId: 'watch', label: 'İşler', match: /\bisler\w*|\bis (sayfa|ekran|liste)\w*|takip (is|sayfa|ekran|liste)\w*|takipler\w*/ },
  // Toplantı sayfası. "Toplantı modunu aç" / "toplantıyı başlat" kipi BAŞLATMA isteğidir (`meeting_start`), sayfa değil:
  // kalıp yalnız yer adıyla ("toplantı sayfası") ya da çoğul adla ("toplantılar") eşlenir.
  { page: 'meeting', moduleId: 'meeting', label: 'Toplantı', match: /toplanti\w* (sayfa|ekran|sekme|pencere)\w*|toplantilar\w*|gorusme (sayfa|ekran)\w*/ },
  // Geliştirme (çekirdek kendini geliştirme; selfdev modülü). "Kendini geliştir" bir İŞ isteğidir (`core_develop`), sayfa değil: kalıp yer adıyla eşlenir.
  { page: 'development', moduleId: 'selfdev', label: 'Geliştirme', match: /gelistirme (sayfa|ekran|pencere)w*|gelistirici (sayfa|ekran)w*|surum (sayfa|ekran)w*|\bgelistirme\b(?! (yap|et|ekle))/ },
  // JARVIS MODE bir sayfa DEĞİLDİR: rayda yoktur, sesle açılıp kapanır (`jarvis-mode-intent.ts`, `jarvis_mode` aracı).
  { page: 'skills', moduleId: 'workshop', label: 'Yetenekler', match: /yetenekler\w*|yetenek (sayfa|ekran)\w*|atolye\w*|beceriler\w*/ },
  // Bugün = Kokpit (pano). "Pano" tek başına bilgisayarın panosu da olabilir ("panoya kopyala"): yalnız "panoyu" ya da yer
  // adıyla ("pano ekranı") eşlenir; sayfa belirsiz sayılır, "aç" ya da yer adı ister (`AMBIGUOUS_PAGES`).
  { page: 'today', label: 'Bugün', match: /bugun (sayfa|ekran)\w*|\bbugunu\b|ana sayfa\w*|ana ekran\w*|\bkokpit\w*|\bpanoyu\b|\bpano (sayfa|ekran)\w*|\bozet (sayfa|ekran)\w*|gun ozeti/ },
];

/** Sözde ya da araç girdisinde adı geçen sayfa; yoksa `null`. Kimlik ("settings", "settings/voice") de kabul edilir. */
export function findSpokenPage(text: string): SpokenPage | null {
  const folded = plain(text);
  const [page, tab] = text.trim().toLowerCase().split(/[/›>:]/).map((part) => part.trim());
  const byId = SPOKEN_PAGES.find((item) => item.page === page && (item.tab ?? '') === (tab ?? ''));
  return byId ?? SPOKEN_PAGES.find((item) => item.match.test(folded)) ?? null;
}

/** Sayfa AÇMA isteği: "aç", "göster", "getir", "git". */
const NAV_VERB = /\bac\b|\bacar misin|\bacsana|\bacabilir misin|\bacalim|\bgoster\w*|\bgetir\w*|\bgit\b|\bgider misin|\bgidelim|\bgecelim|\bgec\b/;
/** Pencere içi yer adı: sayfa, sekme, ekran, pencere. */
const PLACE_WORD = /\b(sayfa|sekme|ekran|pencere|bolum)\w*/;
/**
 * Sayfa adı tek başına yetmeyen, başka bir işi de anlatabilen adlar: "projeleri göster" proje listesini SÖYLEMEK,
 * "hatırlatıcıları göster" hatırlatıcıları saymak olabilir. Bunlarda yer adı ("sayfasını") ya da "aç" fiili aranır.
 */
const AMBIGUOUS_PAGES = new Set(['planner', 'projects', 'memory', 'skills', 'today', 'watch', 'meeting']);
/** "Son sohbeti göster / aç", "sohbet geçmişini aç". */
const LAST_CHAT = /(son|en son|onceki|az onceki) (sohbet|konusma|yazisma)\w*|sohbet gecmis\w*|konusma gecmis\w*/;

export type SpokenCommand =
  | { name: 'voice_test_start'; input: { test: SpokenTestId } }
  | { name: 'pc_selftest'; input: Record<string, never> }
  | { name: 'app_navigate'; input: { page: string } }
  | { name: 'jarvis_mode'; input: { on: boolean } }
  | { name: 'settings_list'; input: { topic: 'ayarlar' | 'sinamalar' } | { name: string } }
  | { name: 'settings_set'; input: { name: string; value: string } };

/**
 * Sözün kesin komutu; emin değilse `null` (model karar verir). Kısa sözlerde aranır (en çok 9 sözcük): uzun söz başka
 * bir iş de taşıyabilir.
 */
export function routeSpokenCommand(text: string): SpokenCommand | null {
  const folded = plain(text);
  if (!folded || wordCount(folded) > 9) return null;

  // JARVIS MODE: "Jarvis moduna geç" / "Jarvis modunu kapat" (kesin söz; model beklenmez).
  const mode = routeJarvisMode(text);
  if (mode) return { name: 'jarvis_mode', input: { on: mode === 'on' } };

  // "Neleri ayarlayabilirim", "hangi sınamalar var", "sesle neler yapabilirim": doğru liste araçtan okunur.
  if (
    /\b(ne|neler|neleri|hangi \w+) (ayarlayabil|degistirebil)\w*|hangi (sinama|test|ayar)\w*( var| yap)?|sinama\w* neler|ayar\w* neler|(sesle|konusarak) (ne|neler|neleri) (yap|ayarla|degistir)/.test(
      folded,
    )
  ) {
    return { name: 'settings_list', input: { topic: /sinama|test/.test(folded) ? 'sinamalar' : 'ayarlar' } };
  }

  // Sınama başlatma: sınama sözcüğü + adı + başlatma fiili ("söz kesme sınamasını başlat", "mikrofonumu bir sına").
  if (TEST_WORD.test(folded) && START_WORD.test(folded) && !NOT_START.test(folded)) {
    // "Fare ve klavye sınamasını başlat", "bilgisayar kullanımını dene": ses sınaması değil, bilgisayar modülünün aracı.
    if (PC_SELFTEST_SPOKEN.match.test(folded) && !findSpokenTest(folded)) return { name: PC_SELFTEST_SPOKEN.tool, input: {} };
    const test = findSpokenTest(folded);
    if (test) return { name: 'voice_test_start', input: { test: test.id } };
  }

  // Ayar okuma/değiştirme: söz tek bir ayarı adıyla anıyorsa (`local-settings.ts`). Sayfa açma isteği ayar değildir
  // ("ses ayarlarını aç"): ayar adı taşımayan söz buradan geçmez.
  const setting = routeSpokenSetting(text);
  if (setting) return setting;

  // Gezinme: sayfa adı + açma fiili. "Ayarları aç" Windows ayarları değil, asistanın Ayarlar sayfasıdır.
  if (NAV_VERB.test(folded) && !/windows|bilgisayar\w* ayar|sistem ayar|denetim masasi/.test(folded)) {
    if (LAST_CHAT.test(folded)) return { name: 'app_navigate', input: { page: 'chat' } };
    const page = findSpokenPage(folded);
    if (page) {
      const explicit = PLACE_WORD.test(folded) || /\bac\b|\bacar misin|\bacsana|\bacabilir misin|\bacalim|\bgit\b|\bgec\b/.test(folded);
      // Sayfa adından ve fiilden başka söz varsa (ör. "atlas projesini aç") sayfa isteği değildir.
      const rest = folded
        .replace(page.match, ' ')
        .replace(NAV_VERB, ' ')
        .replace(PLACE_WORD, ' ')
        .replace(/\b(jarvis|lutfen|bana|bir|su|bi|hadi|simdi|misin|bakalim)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (rest === '' && (explicit || !AMBIGUOUS_PAGES.has(page.page))) {
        return { name: 'app_navigate', input: { page: page.tab ? `${page.page}/${page.tab}` : page.page } };
      }
    }
  }
  return null;
}
