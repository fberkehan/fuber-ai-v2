// "Her şeyi konuşarak": bu bilgisayardaki ayarların SESLE okunması ve değiştirilmesi. Amaç: ayar ve sınama
// için fareye gerek kalmasın. Burada yalnız karar ve çözümleme vardır (hangi söz hangi ayar, değer nasıl okunur, kim
// yönetir, hangi söz kodla araca gider); araç tanımları `modules/voice-control/index.ts` içindedir. Dosya beynin
// yanındadır çünkü söz → komut eşlemesi (`local-commands.ts`) aynı kataloğu kullanır; beyin modülleri içe aktarmaz.
//
// Üç tür ayar vardır ve Jarvis üçünü de DOĞRU söylemek zorundadır (uydurma yok):
//   1. Bu bilgisayarın ayarı (`Settings`): sesle okunur ve değişir. Alan adları şemadan ÇALIŞMA ANINDA okunur
//      (`SettingsApi.get()` anahtarları): bu sürümde alanı olmayan ayar "bu sürümde yok" diye yanıtlanır, alan başka bir
//      görevle eklendiği gün (görünüm, ses motoru, bildirim sesi) kod değişmeden çalışır.
//   2. Fuber Yönetim'den (politika) yönetilen ayar: sesle DEĞİŞMEZ; Jarvis bunu açıkça söyler ve nereden değişeceğini anlatır.
//   3. Sesle değiştirilmeyen yerel ayar (kısayol, aygıt seçimi, veri klasörü): neden ve nereden değişeceği söylenir.
import { effectiveFollowUpSeconds, FOLLOW_UP_MAX_SECONDS, FOLLOW_UP_STEPS, SETTING_CHOICES, t, TTS_ENGINES, type MessageKey, type Policy, type Settings } from '@fuber/shared';
import { foldTr } from './local-tools';

/** Katlanmış, noktalaması sadeleşmiş söz (saat biçimleri korunur: `23:00`, `23.00`, `23-07`). */
const plain = (text: string): string => strip(foldTr(text));

/**
 * Noktalama ayıklanır; yalnız iki rakam arasındaki `:`, `.`, `-` kalır (saat ve aralık). Harf sayısını korumak için
 * her işaret tek boşluğa çevrilir ve boşluklar SIKIŞTIRILMAZ: katlanmış metindeki konum özgün metinde de geçerlidir.
 */
const stripKeepingLength = (text: string): string => text.replace(/[^\p{L}\p{N}\s]/gu, (ch, at: number, all: string) => (/[:.\-–]/.test(ch) && /\d/.test(all[at - 1] ?? '') && /\d/.test(all[at + 1] ?? '') ? ch : ' '));
const strip = (text: string): string => stripKeepingLength(text).replace(/\s+/g, ' ').trim();

export interface SpokenChoice {
  value: string;
  /** Kullanıcıya söylenen adı. */
  label: string;
  /** Katlanmış sözde bu seçeneği işaret eden kalıp. */
  match: RegExp;
}

export interface SpokenSetting {
  /** Konuşma adı (araç girdisindeki `name`): `windowsla_basla`. */
  id: string;
  /** Kullanıcıya söylenen adı: "Windows'la başlatma". */
  label: string;
  /** Ayar şemasında aranan alan adları (ilk bulunan kullanılır). */
  keys: readonly string[];
  /** Alan başka bir adla eklenirse onu da bulan kalıp (alan adında aranır). */
  keyPattern?: RegExp;
  /**
   * `voice`: motor başına ses haritası (`ttsVoices`); seçenekler o an geçerli motorun sesleridir. `follow-up`: dinleme
   * süresi (saniye ya da `null` = Yönetim'in değeri); "uzat / kısalt" kademe ilerletir.
   */
  kind: 'toggle' | 'quiet-hours' | 'dnd' | 'text' | 'choice' | 'voice' | 'follow-up';
  /** Katlanmış sözde ya da `name` girdisinde bu ayarı işaret eden kalıp. */
  match: RegExp;
  /** `choice` için bilinen seçenekler; alanın şemadaki seçenekleri (`SETTING_CHOICES`) varsa onlarla sınırlanır. */
  choices?: readonly SpokenChoice[];
  /** AÇILIRKEN kullanıcı onayı istenir (izinler): onay kartındaki cümlenin sözlük anahtarı. Kapatmak onay istemez. */
  approval?: MessageKey;
  /** Alan bu sürümde yokken ayar Fuber Yönetim'den mi yönetiliyor (ör. ses motoru): nereden değişeceği. */
  managedMeanwhile?: string;
}

/** Sesle değiştirilebilen ayarlar. Sıra, "ne ayarlayabilirim" yanıtındaki sıradır. */
export const SPOKEN_SETTINGS: readonly SpokenSetting[] = [
  {
    id: 'windowsla_basla',
    label: 'Windows’la başlatma',
    keys: ['launchAtLogin'],
    kind: 'toggle',
    // Dardır: "Windows'u yeniden başlat", "Windows açılınca Chrome'u aç" bu ayar değildir.
    match: /windows\W{0,3}(la|ile) (birlikte )?(basla|acil)|(windows|bilgisayar) acil(inca|diginda|isinda) (sen de |kendiliginden |otomatik |otomatik olarak )?(basla|acil|calis)\w*\s*$|acilista (kendiliginden |otomatik )?(basla|calis)|otomatik basla\w*|kendiliginden basla\w*|baslangicta (basla|calis|acil)|launchatlogin|^windowsla basla$/,
  },
  {
    id: 'sessiz_saatler',
    label: 'sessiz saatler',
    keys: ['quietHours'],
    kind: 'quiet-hours',
    match: /sessiz saat|quiethours/,
  },
  {
    id: 'rahatsiz_etme',
    label: 'rahatsız etme kipi',
    keys: ['dnd'],
    kind: 'dnd',
    match: /rahatsiz etme|\bdnd\b/,
  },
  {
    id: 'bildirim_sesi',
    label: 'bildirim sesi',
    keys: ['notificationSound', 'notificationSounds', 'notifySound', 'notifySounds', 'soundEnabled', 'chime'],
    keyPattern: /^(notif\w*(sound|chime|tone)\w*|(sound|chime)\w*notif\w*)$/i,
    kind: 'toggle',
    match: /bildirim.{0,6}ses|uyari sesi|notificationsound|\bchime\b/,
  },
  {
    id: 'hitap',
    label: 'hitap',
    keys: ['userAddress'],
    kind: 'text',
    match: /hitap|diye (seslen|cagir)|useraddress/,
  },
  {
    id: 'ad',
    label: 'adınız',
    keys: ['userName'],
    kind: 'text',
    match: /\badim\b|\bismim\b|\badimi\b|\bismimi\b|kullanici adi|username|^ad$|^isim$/,
  },
  {
    id: 'bilgisayar_kullanma_izni',
    label: 'bilgisayarı kullanma izni',
    keys: ['pcControlAllowed'],
    kind: 'toggle',
    // "Tarayıcını kullanma izni" bu ayar değildir (aşağıdaki `tarayici_izni`): yanlış izin kapanmasın.
    match: /pccontrol|(bilgisayar|fare|klavye)\w*.{0,28}(\bizn|\bizin)|(?<!tarayici\w* )kullanma izn|kontrol izn/,
    approval: 'voice.spokenSetting.approvePcControl',
  },
  {
    id: 'ekran_okuma_izni',
    label: 'ekranı okuma izni',
    keys: ['pcReadAllowed'],
    kind: 'toggle',
    match: /pcread|(ekran|pencere)\w*.{0,28}(\bizn|\bizin)|okuma izn/,
    approval: 'voice.spokenSetting.approvePcRead',
  },
  {
    // Asistanın KENDİ tarayıcısı (browser modülü, `jbrowser_*`); kullanıcının tarayıcısı bilgisayarı kullanma iznindedir.
    id: 'tarayici_izni',
    label: 'kendi tarayıcımı kullanma izni',
    keys: ['jbrowserAllowed'],
    kind: 'toggle',
    match: /jbrowser|tarayici\w* (kullanma )?(izn|izin)\w*|(kendi|senin|jarvis\w*|asistan\w*) tarayici\w*.{0,28}(\bizn|\bizin)/,
    approval: 'voice.spokenSetting.approveJbrowser',
  },
  {
    id: 'ses_motoru',
    label: 'ses motoru',
    keys: ['ttsEngine', 'voiceEngine', 'ttsProvider', 'speechEngine', 'localTtsEngine'],
    keyPattern: /^(tts|speech|voice)\w*(engine|provider|motor)\w*$/i,
    kind: 'choice',
    match: /ses motor|seslendirme motor|ttsengine|voiceengine|konusma motor/,
    choices: [
      { value: '', label: 'yerel', match: /yerel|bu bilgisayar|local|cevrimdisi|piper|supertonic|kokoro/ },
      { value: '', label: 'bulut', match: /bulut|cloud|elevenlabs|eleven labs/ },
    ],
    managedMeanwhile: 'Ses motoru bu sürümde Fuber Yönetim’de, Ses ve Anahtarlar ekranından ayarlanır.',
  },
  {
    id: 'ses',
    label: 'ses seçimi',
    keys: ['ttsVoices', 'ttsVoice', 'voiceId', 'ttsVoiceId', 'voiceName', 'localVoice', 'speaker'],
    keyPattern: /^(tts|local|speech)?\w*voices?(id|name)?$|^speaker\w*$/i,
    kind: 'voice',
    match: /ses secim\w*|sesini\w* degis\w*|baska (bir )?ses\w*|hangi ses\w*|ses tonu\w*|\bsesi\w*\b.*\b(degis|sec)\w*|\b(erkek|kadin) ses\w*|\bsesi\w*\b.*\b(erkek|kadin)\b|ttsvoice|voiceid/,
    managedMeanwhile: 'Asistanın sesi bu sürümde Fuber Yönetim’de, Ses ve Anahtarlar ekranından seçilir.',
  },
  {
    id: 'hareket',
    label: 'hareket',
    keys: ['reducedMotion'],
    kind: 'choice',
    match: /hareket\w* (azalt|ayar)\w*|azaltilmis hareket|animasyon\w*|gecis canlandirma\w*|reducedmotion|^hareket$/,
    choices: [
      { value: 'on', label: 'azaltılmış', match: /azalt|az\b|sade|kapat|kapali|\bon\b/ },
      { value: 'off', label: 'tam', match: /\btam\b|\bac\b|acik|hepsi|\boff\b/ },
      { value: 'system', label: 'sistemi izle', match: /sistem|windows|otomatik/ },
    ],
  },
  {
    // d10: dinleme süresi bu cihazın ayarıdır (sol paneldeki Hızlı kontrol ile aynı alan); Yönetim'in değeri varsayılandır.
    id: 'dinleme_suresi',
    label: 'dinleme süresi',
    keys: ['followUpSeconds'],
    kind: 'follow-up',
    match: /dinleme sure\w*|takip sure\w*|bekleme sure\w*|ne kadar (uzun )?dinle\w*|(daha )?(uzun|kisa) dinle\w*|followup/,
  },
  {
    id: 'ada_ekrani',
    label: 'adanın çıkacağı ekran',
    keys: ['islandDisplay'],
    kind: 'choice',
    match: /\bada(nin|yi|ya|da)?\b.{0,16}ekran|islanddisplay|^ada ekrani$/,
    choices: [
      { value: 'cursor', label: 'imlecin olduğu ekran', match: /imlec|fare|cursor/ },
      { value: 'primary', label: 'ana ekran', match: /ana ekran|birincil|primary/ },
    ],
  },
];

/** Fuber Yönetim'den (politika) yönetilen ayarlar: sesle değişmez. `where`: Yönetim'deki ekran. */
export interface ManagedSetting {
  id: string;
  label: string;
  match: RegExp;
  where: string;
  /** Şu anki değerin kısa metni (söylenebilir); okunamıyorsa `null`. */
  current?(policy: Policy): string | null;
}

export const MANAGED_SETTINGS: readonly ManagedSetting[] = [
  {
    id: 'uyandirma_sozu',
    label: 'uyandırma sözü',
    match: /uyandirma soz|uyanma soz|wake ?(word|phrase)|hey \w+ yerine|nasil cagir/,
    where: 'Beyin ve Kişilik',
    current: (policy) => policy.persona.wakePhrases.join(', '),
  },
  {
    id: 'asistan_adi',
    label: 'asistanın adı',
    match: /asistan\w* ad\w*|\badini .* (yap|degis|olsun)|\bismini .* (yap|degis|olsun)|persona/,
    where: 'Beyin ve Kişilik',
    current: (policy) => policy.persona.name,
  },
  {
    id: 'model',
    label: 'beyin ve model seçimi',
    match: /\bmodel\w* (degis|sec)\w*|\bmodeli\w*|\bmodele gec\w*|baska (bir )?model\w*|beyn(i|in)\w* (degis|sec)\w*/,
    where: 'Beyin ve Kişilik',
    current: (policy) => `sesli tur ${policy.models.voice.model}, derin işler ${policy.models.deep.model}`,
  },
  {
    id: 'soz_kesme',
    label: 'söz kesme kipi',
    match: /soz kesme (kip|ayar|mod)|sozumu kes|araya gir\w* (ayar|kip)|bargein|barge in/,
    where: 'Ses ve Anahtarlar',
    current: (policy) => ({ voice: 'konuşarak kesilir', wake: 'yalnız uyandırma sözüyle kesilir', off: 'kapalı' })[policy.voice.bargeIn],
  },
  {
    id: 'yaziya_cevirme',
    label: 'yazıya çevirme motoru',
    match: /yaziya cevirme (motor|ayar|saglayici)\w*|\bstt\b|whisper|scribe|ses tanima motor\w*/,
    where: 'Ses ve Anahtarlar',
    current: (policy) => (policy.voice.stt.provider === 'whisper-local' ? 'bu bilgisayarda (Whisper)' : 'ElevenLabs bulutunda'),
  },
  { id: 'anahtarlar', label: 'anahtarlar', match: /api anahtar\w*|anahtar\w* (ekle|degis|gir)\w*|api key/, where: 'Ses ve Anahtarlar' },
  { id: 'moduller', label: 'modüllerin açılıp kapatılması', match: /modul/, where: 'Modüller' },
  { id: 'butce', label: 'günlük harcama sınırı', match: /gunluk (butce|harcama|limit)\w*|harcama (sinir|limit)\w*|butce (sinir|limit)\w*/, where: 'Güvenlik' },
  { id: 'kisilik', label: 'kişilik ve sistem istemi', match: /kisili[gk]\w*|sistem istem\w*/, where: 'Beyin ve Kişilik' },
];

/** Bu bilgisayarın ayarı ama sesle DEĞİŞTİRİLMEYENLER: neden ve nereden değişeceği. */
export const LOCAL_ONLY_SETTINGS: ReadonlyArray<{ id: string; label: string; match: RegExp; why: string }> = [
  { id: 'kisayollar', label: 'kısayollar', match: /kisayol\w*|hotkey|tus\w* (degis|ata)\w*/, why: 'Tuş birleşimi yanlış anlaşılırsa asistana ulaşamazsınız; Ayarlar › Kısayollar’dan değişir.' },
  { id: 'aygit', label: 'mikrofon ve hoparlör aygıtı seçimi', match: /(mikrofon|hoparlor|kulaklik)\w*.{0,20}(sec|degis|kullan)|aygit|cihaz sec|inputdevice|outputdevice/, why: 'Aygıt listesi yalnız Ayarlar › Ses’te görünür; oradan seçilir.' },
  { id: 'gizlilik_kipi', label: 'gizlilik kipi', match: /gizli(lik)? kip|privacymode|gizli mod/, why: 'Gizli kipte çalışacak modelleri Fuber Yönetim belirler; bu sürümde yalnız altyapısı var.' },
  { id: 'dil', label: 'arayüz dili', match: /(arayuz|uygulama)\w* dil\w*|\bdil (ayar|secim)\w*|uilanguage/, why: 'Bu sürüm Türkçedir; Ayarlar › Genel’den seçim saklanır.' },
  { id: 'proje_klasoru', label: 'proje klasörü', match: /proje\w* (klasor|kok)|projectsroot/, why: 'Klasör yolu sesle güvenilir yazılamaz; Projeler sayfasından değişir.' },
  { id: 'yonetim_adresi', label: 'Fuber Yönetim bağlantısı', match: /yonetim\w* (adres|baglan)|controlurl/, why: 'Bağlantı adresi Ayarlar › Bağlantı’dan değişir.' },
  { id: 'gelistirici_kipi', label: 'geliştirici kipi', match: /gelistirici (kip|mod)w*|developermode|developerrepo|cekirdek gelistirw* (ac|kapat|izn)w*|kaynak (klasor|depo)w*/, why: 'Kendi kaynak kodumu değiştirmem büyük bir yetkidir; yalnız Ayarlar › Genel › Geliştirici kipi’nden (ve Yönetim izniyle) açılır.' },
  { id: 'ortam_dinleme', label: 'ortam dinleme izni', match: /ortam dinleme\w* (ac|baslat|etkinlestir|izn)\w*|ortam dinleme izn\w*/, why: 'Ortam dinlemenin ilk açılışı açık rıza ister; Ayarlar › Gizlilik ve veri’den verilir. Rızadan sonra “ortam dinlemeyi aç / kapat” demeniz ya da sol paneldeki Hızlı kontrol yeter.' },
];

type SettingsBag = Record<string, unknown>;

/** Girişin bu sürümdeki ayar alanı; şemada yoksa `null`. */
export function fieldOf(entry: SpokenSetting, settings: SettingsBag): string | null {
  for (const key of entry.keys) if (key in settings) return key;
  if (entry.keyPattern) return Object.keys(settings).find((key) => entry.keyPattern!.test(key)) ?? null;
  return null;
}

// ───────────────────────── seslendirme motorları kataloğu (varsa) ─────────────────────────

/**
 * Seslendirme motorlarının kataloğu (`@fuber/shared` › `TTS_ENGINES`). Motor ve ses listesi yalnız oradadır: "ses
 * motorunu Piper yap", "sesini Erkek 5 yap" sözleri katalogdaki adlarla eşlenir, seçim cihaz ayarına yazılır
 * (`Settings.ttsEngine`, `Settings.ttsVoices`). Alanları olmayan eski bir ayar kaydında (ya da katalog yokken) bu
 * ayarlar Fuber Yönetim'den yönetilir ve Jarvis öyle söyler (`managedMeanwhile`).
 */
export interface TtsCatalog {
  [engine: string]: { id: string; kind?: string; label?: string; voices?: ReadonlyArray<{ id: string; label?: string }>; defaultVoice?: string | null };
}
const sharedTtsCatalog = (): TtsCatalog | null => TTS_ENGINES as unknown as TtsCatalog;
let ttsCatalogOverride: TtsCatalog | null | undefined;
/** Sınama için: kataloğu verir (`null`: katalog yok) ya da `undefined` ile gerçek kaynağa döner. */
export function useTtsCatalog(catalog: TtsCatalog | null | undefined): void {
  ttsCatalogOverride = catalog;
}
const ttsCatalog = (): TtsCatalog | null => (ttsCatalogOverride === undefined ? sharedTtsCatalog() : ttsCatalogOverride);

/** Sözlük anahtarı ise çevirisi; değilse (ya da sözlükte yoksa) verilen metin. */
const labelOf = (key: string | undefined, fallback: string): string => {
  if (!key) return fallback;
  // Noktalı anahtar biçiminde değilse ("tts.engine.supertonic") zaten okunur bir addır.
  if (!/^[a-z][\w-]*(\.[\w-]+)+$/i.test(key)) return key;
  try {
    const text = t(key as MessageKey);
    return text && text !== key ? text : fallback;
  } catch {
    return fallback;
  }
};
const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordsOfValue = (value: string) => foldTr(value).replace(/[^a-z0-9]+/g, ' ').trim();

/** Motor seçenekleri (katalogdan): adıyla, kimliğiyle ve türüyle ("yerel", "bulut", "ekran kartı") söylenebilir. */
function engineChoices(catalog: TtsCatalog): SpokenChoice[] {
  return Object.values(catalog).map((engine) => {
    const label = labelOf(engine.label, engine.id);
    const kind = engine.kind === 'cloud' ? 'bulut|cloud|internet' : engine.kind === 'piper' ? 'islemci|cpu' : engine.kind === 'host' ? 'ekran kart\\w*|gpu' : '';
    // Kimliğin ve adın tamamı, ilk sözcüğü ("piper-local" → "piper", "EMA Lightning" → "ema") ve "labs" ile biten adın
    // ayrı yazımı ("eleven labs": yazıya çevirme ikisini de üretir). Sözcük sınırıyla: "sinema" EMA değildir.
    const full = [wordsOfValue(engine.id), wordsOfValue(label)].filter(Boolean);
    const firsts = full.map((name) => name.split(' ')[0]!).filter((word) => word.length >= 3);
    const spaced = full.map((name) => name.replace(/(?<=[a-z])labs$/, ' labs'));
    const names = [...new Set([...full, ...firsts, ...spaced])].map((name) => `\\b${escapeRe(name)}\\b`);
    return { value: engine.id, label, match: new RegExp([...names, kind].filter(Boolean).join('|')) };
  });
}

/** O an geçerli seslendirme motoru: bu cihazın seçimi, yoksa Yönetim'in varsayılanı. */
const currentEngine = (settings: SettingsBag, policy: Policy): string => (typeof settings.ttsEngine === 'string' ? settings.ttsEngine : policy.voice.tts.provider);

const NUMBER_WORDS: Record<string, string> = { bir: '1', iki: '2', uc: '3', dort: '4', bes: '5', alti: '6', yedi: '7', sekiz: '8', dokuz: '9', on: '10' };

/** Bir motorun sesleri: kimliğiyle ("M5"), adıyla ("Erkek 5", "erkek beş") ve nitelemesiyle ("en derin") söylenebilir. */
function voiceChoices(catalog: TtsCatalog, engine: string): SpokenChoice[] {
  return (catalog[engine]?.voices ?? []).map((voice) => {
    const label = labelOf(voice.label, voice.id);
    // "Erkek 5 · en derin" → ad ("erkek 5") ve niteleme ("en derin") ayrı ayrı eşlenir.
    const parts = label.split('·').map((part) => wordsOfValue(part)).filter(Boolean);
    const patterns = [`\\b${escapeRe(wordsOfValue(voice.id))}\\b`, ...parts.map((part) => `\\b${escapeRe(part)}\\b`)];
    return { value: voice.id, label, match: new RegExp(patterns.join('|')) };
  });
}

/** Sözdeki sayı sözcüklerini rakama çevirir ("erkek beş" → "erkek 5"); ses adlarıyla eşleştirmek için. */
const digitize = (text: string): string => text.replace(/\b(bir|iki|uc|dort|bes|alti|yedi|sekiz|dokuz|on)\b/g, (word) => NUMBER_WORDS[word] ?? word);

/**
 * Alanın seçenekleri, öncelik sırasıyla: şemadaki liste (`SETTING_CHOICES`) → çalışma anı kataloğu (ses motoru) →
 * girişin bilinen seçenekleri. Hiçbiri yoksa boş: seçenekleri bilinmeyen alana sesle değer yazılmaz.
 */
export function choicesOf(entry: SpokenSetting, key: string | null): SpokenChoice[] {
  const known = (entry.choices ?? []).filter((choice) => choice.value !== '');
  const allowed = key ? (SETTING_CHOICES as Readonly<Record<string, readonly string[]>>)[key] : undefined;
  if (!allowed) {
    const catalog = entry.id === 'ses_motoru' && key ? ttsCatalog() : null;
    return catalog ? engineChoices(catalog) : [...known];
  }
  return allowed.map((value) => {
    const named = known.find((choice) => choice.value === value);
    if (named) return named;
    // Şemadan gelen, burada adı bilinmeyen seçenek: değerin kendisi söylenir; genel kalıplar (yerel/bulut) değere bakarak eşlenir.
    const folded = foldTr(value).replace(/[^a-z0-9]+/g, ' ').trim();
    const generic = (entry.choices ?? []).find((choice) => choice.value === '' && choice.match.test(folded));
    const escaped = folded.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return { value, label: value, match: new RegExp(generic ? `${escaped}|${generic.match.source}` : escaped) };
  });
}

export type Resolved =
  | { kind: 'setting'; entry: SpokenSetting; key: string }
  | { kind: 'managed'; managed: ManagedSetting }
  /** Sesle değişen bir ayar ama alanı bu sürümde yok. */
  | { kind: 'absent'; entry: SpokenSetting }
  | { kind: 'local-only'; item: (typeof LOCAL_ONLY_SETTINGS)[number] }
  /** Şemada var, kataloğa girmemiş alan (başka bir görevin yeni ayarı): yalnız açık/kapalı türündeyse sesle değişir. */
  | { kind: 'raw'; key: string }
  | { kind: 'unknown' };

/** Sesle hiçbir zaman yazılmayan alanlar (kimlik, rıza, bağlantı, kurulum durumu). */
const NEVER_BY_VOICE = new Set(['setupCompletedAt', 'ambientConsentAt', 'controlUrl', 'disabledModules', 'hotkeys', 'inputDeviceId', 'outputDeviceId', 'projectsRoot', 'privacyMode', 'uiLanguage', 'dndUntil', 'developerMode', 'developerRepoPath']);

/** Ayar adını (araç girdisi ya da kullanıcının sözü) çözer. */
export function resolveSetting(name: string, settings: SettingsBag): Resolved {
  const text = plain(name);
  const compact = text.replace(/[\s_.-]+/g, '');
  const entry =
    SPOKEN_SETTINGS.find((item) => item.id === text.replace(/\s+/g, '_') || item.id.replace(/_/g, '') === compact) ??
    SPOKEN_SETTINGS.find((item) => item.keys.some((key) => key.toLowerCase() === compact)) ??
    SPOKEN_SETTINGS.find((item) => item.match.test(text));
  if (entry) {
    const key = fieldOf(entry, settings);
    if (key) return { kind: 'setting', entry, key };
    const managed = MANAGED_SETTINGS.find((item) => item.match.test(text));
    return managed ? { kind: 'managed', managed } : { kind: 'absent', entry };
  }
  const managed = MANAGED_SETTINGS.find((item) => item.id === text.replace(/\s+/g, '_') || item.match.test(text));
  if (managed) return { kind: 'managed', managed };
  const localOnly = LOCAL_ONLY_SETTINGS.find((item) => item.id === text.replace(/\s+/g, '_') || item.match.test(text));
  if (localOnly) return { kind: 'local-only', item: localOnly };
  const raw = Object.keys(settings).find((key) => key.toLowerCase() === compact);
  if (raw && !NEVER_BY_VOICE.has(raw)) return { kind: 'raw', key: raw };
  return { kind: 'unknown' };
}

// ───────────────────────── değer çözümleme ─────────────────────────

const OFF = /\bkapat|\bkapa\b|kapali|kapansin|\bkapasin|\bacma\b|hayir|\boff\b|\bfalse\b|devre disi|pasif|istemiyorum|olmasin|kullanma\b|kullanmasin|baslama\b|baslamasin|\bverme\b|\balma\b|kaldir|iptal|\bdurdur|\bsus\b|\byok\b|\b0\b/;
const ON = /\bac\b|\bacar\b|\bacsana\b|\bacik\b|\bacilsin|\bacsin|\bacar\b|evet|\bon\b|\btrue\b|etkin|aktif|\bbasla\b|baslasin|\bbaslat|\bolsun|\bkullan\b|kullansin|\bver\b|\bizin ver|\bvar\b|\b1\b/;

/** "aç / kapat" anlamı; anlaşılmadıysa `null`. Olumsuz önce denenir ("açma", "kullanmasın"). */
export function parseOnOff(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const all = plain(String(value ?? ''));
  if (!all) return null;
  // Değer bir sözün tamamıysa (kodla eşlenen komut) eylem sondadır: "…kullanma iznini aç" sözündeki "kullanma" ayarın
  // adıdır, buyruk değil. Türkçede yüklem sonda durur; uzun sözde yalnız son iki sözcüğe bakılır.
  const parts = all.split(' ');
  const text = parts.length > 3 ? parts.slice(-2).join(' ') : all;
  if (OFF.test(text)) return false;
  if (ON.test(text)) return true;
  return null;
}

/** Sözcükle söylenen saat ve alabileceği hal ekleri ("on birden", "yediye", "sekizde"). "Önce", "birlikte" saat değildir. */
const HOUR_SUFFIX = '(?:den|dan|ten|tan|de|da|te|ta|ye|ya|e|a|i|u|yi|yu)?';
const HOUR_WORDS: Array<[string, number]> = [
  ['on ?bir', 11], ['on ?iki', 12], ['bir', 1], ['iki', 2], ['uc', 3], ['dort', 4], ['bes', 5], ['alti', 6], ['yedi', 7], ['sekiz', 8], ['dokuz', 9], ['on', 10],
];
const pad = (value: number) => String(value).padStart(2, '0');

/**
 * Sözdeki saatleri sırayla çıkarır: "23:00-07:00", "23 ile 7 arası", "gece on birden sabah yediye", "akşam 10'dan sabah
 * 8 buçuğa". Gün bölümü (akşam, gece, öğleden sonra) 1–11 arasındaki saati öğleden sonraya taşır; "gece 1" gece kalır.
 */
export function parseTimes(value: string): string[] {
  let text = plain(value).replace(/\bgece yarisi\w*/g, ' 00:00 ');
  // Sözcükle söylenen saatler rakama çevrilir ("on bir" → 11); "yarım" ve "buçuk" dakikadır.
  for (const [word, hour] of HOUR_WORDS) text = text.replace(new RegExp(`(?<![\\p{L}\\d:.])${word}${HOUR_SUFFIX}(?![\\p{L}\\d:.])`, 'gu'), ` ${hour} `);
  const out: string[] = [];
  const pattern = /(sabah|ogleden sonra|oglen|ogle|aksam|gece)?\s*(?:saat\s*)?(\d{1,2})(?:[:.](\d{2}))?(\s*bucu[kg]\w*)?/g;
  let part: string | null = null;
  for (const match of text.matchAll(pattern)) {
    part = match[1] ?? part;
    let hour = Number(match[2]);
    const minute = match[3] !== undefined ? Number(match[3]) : match[4] ? 30 : 0;
    if (hour > 24 || minute > 59) continue;
    if (match[3] === undefined) {
      if ((part === 'aksam' || part === 'ogleden sonra') && hour < 12) hour += 12;
      else if (part === 'gece' && hour >= 6 && hour < 12) hour += 12;
      else if (part === 'gece' && hour === 12) hour = 0;
    }
    out.push(`${pad(hour % 24)}:${pad(minute)}`);
    // Gün bölümü yalnız kendi saatine uygulanır; ikinci saatin bölümü ayrıca söylenir ("… sabah yediye").
    part = null;
  }
  return out;
}

/** "bir saat", "30 dakika", "yarım saat" → dakika; yoksa `null`. */
export function parseMinutes(value: string): number | null {
  const text = plain(value);
  if (/yarim saat/.test(text)) return 30;
  const words: Record<string, number> = { bir: 1, iki: 2, uc: 3, dort: 4, bes: 5, alti: 6, yedi: 7, sekiz: 8, dokuz: 9, on: 10, yirmi: 20, otuz: 30, kirk: 40, elli: 50 };
  const match = /(\d{1,3}|bir|iki|uc|dort|bes|alti|yedi|sekiz|dokuz|on|yirmi|otuz|kirk|elli)\s*(bucu[kg]\w*\s*)?(saat|dakika|dk)\b/.exec(text);
  if (!match) return null;
  const count = /^\d+$/.test(match[1]!) ? Number(match[1]) : (words[match[1]!] ?? 0);
  const minutes = match[3] === 'saat' ? count * 60 + (match[2] ? 30 : 0) : count;
  return minutes > 0 && minutes <= 24 * 60 ? minutes : null;
}

// ───────────────────────── okuma ─────────────────────────

const onOff = (value: unknown) => (value === true ? 'açık' : value === false ? 'kapalı' : 'bilinmiyor');

/** Ayarın şu anki değeri, söylenebilir kısa metin. */
export function describeValue(entry: SpokenSetting, key: string, settings: SettingsBag, policy: Policy): string {
  const value = settings[key];
  switch (entry.kind) {
    case 'toggle':
      return onOff(value);
    case 'quiet-hours': {
      const quiet = value as Settings['quietHours'] | undefined;
      return quiet ? `${quiet.enabled ? 'açık' : 'kapalı'} (${quiet.from}–${quiet.to})` : 'bilinmiyor';
    }
    case 'dnd':
      return value === true ? (typeof settings.dndUntil === 'string' ? `açık (${new Date(settings.dndUntil).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })} saatine kadar)` : 'açık') : 'kapalı';
    case 'text':
      if (typeof value === 'string' && value.trim()) return `“${value.trim()}”`;
      return entry.id === 'hitap' ? `“${policy.persona.address}” (Yönetim’deki varsayılan)` : 'belirtilmemiş';
    case 'choice': {
      const choices = choicesOf(entry, key);
      const choice = choices.find((item) => item.value === value);
      if (choice) return choice.label;
      // Ses motoru: bu cihazda seçim yoksa (`null`) Fuber Yönetim'in varsayılanı geçerlidir.
      if (value === null && entry.id === 'ses_motoru') {
        const engine = policy.voice.tts.provider;
        return `${choices.find((item) => item.value === engine)?.label ?? engine} (Fuber Yönetim’in seçimi)`;
      }
      return typeof value === 'string' && value ? value : 'bilinmiyor';
    }
    case 'voice': {
      const catalog = ttsCatalog();
      const engine = currentEngine(settings, policy);
      const chosen = typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[engine] : typeof value === 'string' ? value : undefined;
      const id = typeof chosen === 'string' && chosen ? chosen : (policy.voice.tts.provider === engine ? policy.voice.tts.voiceId : undefined) ?? catalog?.[engine]?.defaultVoice ?? null;
      if (!id) return 'motorun kendi sesi';
      return (catalog ? voiceChoices(catalog, engine).find((item) => item.value === id)?.label : undefined) ?? id;
    }
    case 'follow-up':
      return typeof value === 'number' ? `${value} saniye` : `${policy.voice.followUpSeconds} saniye (Fuber Yönetim’in değeri)`;
  }
}

/** Saniye sayısı sözcükleri ("yirmi saniye", "bir dakika"); yalnız birimle birlikte okunur. */
const SECOND_WORDS: Record<string, number> = { bir: 1, iki: 2, uc: 3, dort: 4, bes: 5, alti: 6, yedi: 7, sekiz: 8, dokuz: 9, on: 10, onbes: 15, yirmi: 20, otuz: 30, kirk: 40, elli: 50, altmis: 60, doksan: 90 };

/** Sözdeki süre (saniye): "30 saniye", "30", "yirmi saniye", "bir dakika", "1 dk". Yoksa `null`. */
export function parseSeconds(value: string): number | null {
  const text = plain(value).replace(/\bon bes\b/g, 'onbes');
  const digits = /(\d{1,3})\s*(saniye|sn|san|dakika|dk)?\b/.exec(text);
  if (digits) return Number(digits[1]) * (digits[2] === 'dakika' || digits[2] === 'dk' ? 60 : 1);
  const word = new RegExp(`\\b(${Object.keys(SECOND_WORDS).join('|')})\\s*(saniye|sn|dakika|dk)\\b`).exec(text);
  if (!word) return null;
  return SECOND_WORDS[word[1]!]! * (word[2] === 'dakika' || word[2] === 'dk' ? 60 : 1);
}

/** Dinleme süresi değiştirme planı: kademe ("uzat", "kısalt", "uzun"), sayı ("30 saniye") ya da "varsayılan". */
function planFollowUp(key: string, current: unknown, spoken: string, policy: Policy): SetOutcome {
  const text = plain(spoken);
  const own = typeof current === 'number' ? current : null;
  const now = effectiveFollowUpSeconds({ followUpSeconds: own }, policy);
  const set = (next: number): SetOutcome =>
    own === next ? { ok: true, patch: {}, say: `Dinleme sürem zaten ${next} saniye.`, unchanged: true } : { ok: true, patch: { [key]: next }, say: `Dinleme süremi ${next} saniye yaptım.`, unchanged: false };
  if (/varsayilan|yonetim|sifirla/.test(text)) {
    return { ok: true, patch: own === null ? {} : { [key]: null }, say: `Dinleme süremi Fuber Yönetim’in değerine döndürdüm: ${policy.voice.followUpSeconds} saniye.`, unchanged: own === null };
  }
  const seconds = parseSeconds(spoken);
  if (seconds !== null) return set(Math.max(0, Math.min(FOLLOW_UP_MAX_SECONDS, seconds)));
  const steps = [...FOLLOW_UP_STEPS];
  if (/\buzat\w*|\bartir\w*|daha uzun|daha fazla/.test(text)) {
    const next = steps.find((step) => step > now);
    return next === undefined ? { ok: true, patch: {}, say: `Dinleme sürem zaten en uzun kademede: ${now} saniye.`, unchanged: true } : set(next);
  }
  if (/\bkisalt\w*|\bazalt\w*|daha kisa|daha az/.test(text)) {
    const next = steps.filter((step) => step < now).at(-1);
    return next === undefined ? { ok: true, patch: {}, say: `Dinleme sürem zaten en kısa kademede: ${now} saniye.`, unchanged: true } : set(next);
  }
  if (/cok uzun/.test(text)) return set(steps[3]!);
  if (/\buzun\b/.test(text)) return set(steps[2]!);
  if (/\bnormal\b|\borta\b/.test(text)) return set(steps[1]!);
  if (/\bkisa\b/.test(text)) return set(steps[0]!);
  return { ok: false, text: `Dinleme süresi için "uzat", "kısalt" ya da bir süre ("20 saniye") denmeli; anlaşılmadı: “${spoken}”. Kademeler: ${steps.join(', ')} saniye.` };
}

// ───────────────────────── söz → komut ─────────────────────────

/** Değiştirme isteği: aç, kapat, yap, değiştir, ayarla… (katlanmış sözde). */
const CHANGE_VERB =
  /\bac\b|\bacar misin\w*|\bacsana\b|\bacik olsun\b|\bkapat\w*|\bkapa\b|\bkapali olsun\b|\bdegis\w*|\byap\b|\byapar misin\w*|\byapsana\b|\bolsun\b|\bayarla\b|\bayarlar misin\w*|\bayarlasana\b|\bcevir\w*|\bgec\b|\bbasla\b|\bbaslasin\b|\bbaslama\w*|\bbaslat\w*|\betkinlestir\w*|devre disi|\bkaldir\w*|\bhitap et\b|\bseslen\b|\bcagir\b|\bkullan\b|\bkullanalim\b|\bkullansin\b|\buzat\w*|\bkisalt\w*/;
/** Durum sorusu: "açık mı", "ne", "nedir", "kaçta", "nasıl". */
const STATE_QUESTION = /\b(acik|kapali|etkin|aktif|ayarli) mi\w*|\bne durumda\b|\bnedir\b|\bne\b|\bneydi\b|\bkacta\b|\bhangi\w*|\bnasil\b/;
/** "Bana patron diye hitap et", "hitabım patron olsun": hitap sözcüğünü yakalar. */
const ADDRESS_FORMS: readonly RegExp[] = [/\bbana\s+(.{1,30}?)\s+(?:diye|olarak)\s+(?:hitap|seslen|cagir)/, /\bhitab\w*\s+(.{1,30}?)\s+(?:olsun|yap)\b/];

export type SpokenSettingCommand = { name: 'settings_set'; input: { name: string; value: string } } | { name: 'settings_list'; input: { name: string } };

/**
 * Sözün kesin ayar komutu; emin değilse `null` (model karar verir). Söz TEK bir ayarı adıyla anıyor ve bir değiştirme
 * fiili ya da durum sorusu taşıyorsa eşlenir. Değer sözün kendisidir: araç "aç / kapat", saat aralığı, süre ve
 * seçeneği sözden kodla okur (`planSet`); model araya girmez. Ölçüm (demo.3, model seçerken): "Bundan sonra bana patron
 * diye hitap et" hafızaya yazıldı, "Sessiz saatler açık mı?" araç çağrılmadan "açık" diye yanıtlandı (tahmin).
 * Yönetim'den yönetilen ya da sesle değişmeyen ayarı DEĞİŞTİRME isteği de araca gider: araç değiştirmez, nedenini ve
 * yerini söyler. Bu ayarların sorusu ("adın ne?") modele kalır: yanıtı öz-durumdadır.
 */
export function routeSpokenSetting(text: string): SpokenSettingCommand | null {
  const folded = plain(text);
  if (!folded || folded.split(' ').length > 12) return null;
  const settings = SPOKEN_SETTINGS.filter((entry) => entry.match.test(folded));
  const managed = MANAGED_SETTINGS.filter((item) => item.match.test(folded));
  const localOnly = LOCAL_ONLY_SETTINGS.filter((item) => item.match.test(folded));
  // Tek bir ayar adı geçmeli; iki ayar birden anılıyorsa söz modele kalır.
  if (settings.length + managed.length + localOnly.length !== 1) return null;
  const entry = settings[0];
  // "Bir saat rahatsız etme", "beni rahatsız etme": fiilsiz de bir açma isteğidir.
  // "Beni daha uzun dinle": fiili "dinle" olan dinleme süresi isteği.
  const change =
    CHANGE_VERB.test(folded) || (entry?.id === 'rahatsiz_etme' && /rahatsiz etme(yin)?$/.test(folded)) || (entry?.id === 'dinleme_suresi' && /(uzun|kisa) dinle\w*$/.test(folded));
  if (!entry) return change ? { name: 'settings_set', input: { name: (managed[0] ?? localOnly[0]!).id, value: text.trim() } } : null;
  if (!change) return STATE_QUESTION.test(folded) ? { name: 'settings_list', input: { name: entry.id } } : null;
  if (entry.kind === 'text') {
    // Hitap: sözcük sözden yakalanır; yakalanamazsa (ya da ayar kullanıcının adıysa) model çıkarır.
    if (entry.id !== 'hitap') return null;
    // Katlama ve ayıklama uzunluğu değiştirmez: aynı kalıp özgün yazımlı metinde de aynı yeri bulur ("Patron" büyük harfiyle).
    const original = strip(text);
    for (const form of ADDRESS_FORMS) {
      const match = form.exec(folded);
      if (!match) continue;
      const at = folded.indexOf(match[1]!, match.index);
      const value = original.length === folded.length ? original.slice(at, at + match[1]!.length) : match[1]!;
      return { name: 'settings_set', input: { name: entry.id, value: value.trim() } };
    }
    return /varsayilan|sifirla|kaldir/.test(folded) ? { name: 'settings_set', input: { name: entry.id, value: 'varsayılan' } } : null;
  }
  return { name: 'settings_set', input: { name: entry.id, value: text.trim() } };
}

/** Araç sonucundaki tek ayar satırı: "Sessiz saatler: kapalı (23:00–08:00)". */
export function describeSetting(resolved: Resolved, settings: SettingsBag, policy: Policy): string {
  switch (resolved.kind) {
    case 'setting':
      return `${capitalize(resolved.entry.label)}: ${describeValue(resolved.entry, resolved.key, settings, policy)}.`;
    case 'managed': {
      const current = safe(() => resolved.managed.current?.(policy) ?? null);
      return `${capitalize(resolved.managed.label)}${current ? `: ${current}` : ''}. ${managedText(resolved.managed)}`;
    }
    case 'absent':
      return absentText(resolved.entry);
    case 'local-only':
      return `${capitalize(resolved.item.label)} sesle değiştirilmez. ${resolved.item.why}`;
    case 'raw':
      return `${resolved.key}: ${typeof settings[resolved.key] === 'boolean' ? onOff(settings[resolved.key]) : JSON.stringify(settings[resolved.key])}.`;
    case 'unknown':
      return 'Böyle bir ayar bulunamadı.';
  }
}

const capitalize = (text: string) => (text ? text[0]!.toLocaleUpperCase('tr') + text.slice(1) : text);
function safe<T>(read: () => T): T | null {
  try {
    return read();
  } catch {
    return null;
  }
}

export const managedText = (managed: ManagedSetting) =>
  `Bu ayar Fuber Yönetim’den yönetilir; sesle ya da bu bilgisayardan değiştirilemez. Fuber Yönetim uygulamasında “${managed.where}” ekranından değişir.`;

export const absentText = (entry: SpokenSetting) =>
  entry.managedMeanwhile
    ? `${entry.managedMeanwhile} Sesle değiştirilemiyor.`
    : `${capitalize(entry.label)} ayarı bu sürümde yok; eklendiğinde sesle değiştirebileceksiniz.`;

/** "Ne ayarlayabilirim, hangi sınamalar var" yanıtının ayar kısmı (şu anki değerlerle). */
export function listSpokenSettings(
  settings: SettingsBag,
  policy: Policy,
): { available: Array<{ label: string; value: string }>; absent: string[]; managed: string[]; localOnly: string[] } {
  const available: Array<{ label: string; value: string }> = [];
  const absent: string[] = [];
  const managed: string[] = [];
  for (const entry of SPOKEN_SETTINGS) {
    const key = fieldOf(entry, settings);
    if (key) available.push({ label: entry.label, value: describeValue(entry, key, settings, policy) });
    else if (entry.managedMeanwhile) managed.push(entry.label);
    else absent.push(entry.label);
  }
  // Başka bir görevin eklediği, kataloğa girmemiş açık/kapalı ayarlar da sesle değişir (alan adıyla).
  for (const [key, value] of Object.entries(settings)) {
    if (typeof value !== 'boolean' || NEVER_BY_VOICE.has(key)) continue;
    if (SPOKEN_SETTINGS.some((entry) => fieldOf(entry, settings) === key)) continue;
    available.push({ label: key, value: onOff(value) });
  }
  managed.push(...MANAGED_SETTINGS.map((item) => item.label));
  return { available, absent, managed, localOnly: LOCAL_ONLY_SETTINGS.map((item) => item.label) };
}

// ───────────────────────── yazma ─────────────────────────

export type SetOutcome =
  /** Yazılacak yama ve kullanıcıya söylenecek cümle. `approval`: yazmadan önce istenecek onayın cümlesi. */
  | { ok: true; patch: Record<string, unknown>; say: string; unchanged: boolean; approval?: string }
  | { ok: false; text: string };

/** Bir ayarı sesle değiştirme isteğini çözer; hiçbir şey YAZMAZ (yazmayı ve onayı araç yapar). */
export function planSet(name: string, value: unknown, settings: SettingsBag, policy: Policy, now: Date = new Date()): SetOutcome {
  const resolved = resolveSetting(name, settings);
  if (resolved.kind === 'managed') {
    return { ok: false, text: `${managedText(resolved.managed)} Kullanıcıya yalnız şunu söyle: "${capitalize(resolved.managed.label)} Fuber Yönetim’den yönetiliyor; oradaki ${resolved.managed.where} ekranından değiştirebilirsiniz."` };
  }
  // Söylenecek cümle hazır verilir (küçük model "desteklenmiyor" gibi kendi yorumunu katıyordu).
  if (resolved.kind === 'absent') return { ok: false, text: `Değiştirilmedi. Kullanıcıya yalnız şunu söyle: "${absentText(resolved.entry)}"` };
  if (resolved.kind === 'local-only') {
    return { ok: false, text: `Değiştirilmedi. Kullanıcıya yalnız şunu söyle: "${capitalize(resolved.item.label)} sesle değiştirilmiyor. ${resolved.item.why}"` };
  }
  if (resolved.kind === 'unknown') {
    return { ok: false, text: `“${name}” adında bir ayar yok. Sesle değişenler: ${SPOKEN_SETTINGS.filter((entry) => fieldOf(entry, settings)).map((entry) => entry.id).join(', ')}.` };
  }
  if (resolved.kind === 'raw') {
    const current = settings[resolved.key];
    if (typeof current !== 'boolean') return { ok: false, text: `${resolved.key} ayarı sesle değiştirilemiyor; Ayarlar sayfasından değişir.` };
    const on = parseOnOff(value);
    if (on === null) return { ok: false, text: `${resolved.key} için "aç" ya da "kapat" denmeli.` };
    return { ok: true, patch: { [resolved.key]: on }, say: `${resolved.key} ayarını ${on ? 'açtım' : 'kapattım'}.`, unchanged: current === on };
  }

  const { entry, key } = resolved;
  const current = settings[key];
  const spoken = typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value);
  switch (entry.kind) {
    case 'toggle': {
      const on = parseOnOff(value);
      if (on === null) return { ok: false, text: `${capitalize(entry.label)} için "aç" ya da "kapat" denmeli; değer anlaşılmadı: “${spoken}”.` };
      if (current === on) return { ok: true, patch: {}, say: `${capitalize(entry.label)} zaten ${on ? 'açık' : 'kapalı'}.`, unchanged: true };
      return {
        ok: true,
        patch: { [key]: on },
        say: `${capitalize(entry.label)} ${on ? 'açıldı' : 'kapatıldı'}.`,
        unchanged: false,
        ...(on && entry.approval ? { approval: t(entry.approval) } : {}),
      };
    }
    case 'quiet-hours': {
      const quiet = (current ?? { enabled: false, from: '23:00', to: '08:00' }) as Settings['quietHours'];
      const times = parseTimes(spoken);
      if (times.length >= 2) {
        const next = { enabled: true, from: times[0]!, to: times[1]! };
        return { ok: true, patch: { [key]: next }, say: `Sessiz saatleri ${next.from} ile ${next.to} arasına ayarladım ve açtım.`, unchanged: quiet.enabled && quiet.from === next.from && quiet.to === next.to };
      }
      const on = parseOnOff(value);
      if (on === null) {
        return { ok: false, text: times.length === 1 ? 'Sessiz saatler için başlangıç ve bitiş birlikte verilmeli: "23:00-07:00".' : 'Sessiz saatler için "aç", "kapat" ya da bir aralık ("23:00-07:00") verilmeli.' };
      }
      if (quiet.enabled === on) return { ok: true, patch: {}, say: `Sessiz saatler zaten ${on ? `açık (${quiet.from}–${quiet.to})` : 'kapalı'}.`, unchanged: true };
      return { ok: true, patch: { [key]: { ...quiet, enabled: on } }, say: on ? `Sessiz saatleri açtım: ${quiet.from} ile ${quiet.to} arasında bildirimler bekleyecek.` : 'Sessiz saatleri kapattım.', unchanged: false };
    }
    case 'dnd': {
      const minutes = parseMinutes(spoken);
      // "Bir saat rahatsız etme", "beni rahatsız etme": sözün kendisi kipi açma isteğidir.
      const asked = /rahatsiz etme(yin)?\s*$/.test(plain(spoken));
      const on = minutes !== null || asked ? true : parseOnOff(value);
      if (on === null) return { ok: false, text: 'Rahatsız etme kipi için "aç", "kapat" ya da bir süre ("bir saat") verilmeli.' };
      if (!on) return { ok: true, patch: { [key]: false, dndUntil: null }, say: current === true ? 'Rahatsız etme kipini kapattım.' : 'Rahatsız etme kipi zaten kapalı.', unchanged: current !== true };
      const until = minutes !== null ? new Date(now.getTime() + minutes * 60_000).toISOString() : null;
      return {
        ok: true,
        patch: { [key]: true, dndUntil: until },
        say: minutes !== null ? `Rahatsız etme kipini ${minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60} saatliğine` : `${minutes} dakikalığına`} açtım; bildirimler bekleyecek.` : 'Rahatsız etme kipini açtım; siz kapatana kadar bildirimler bekleyecek.',
        unchanged: current === true && until === null && settings.dndUntil === null,
      };
    }
    case 'text': {
      const raw = spoken.trim().replace(/^["“”'‘’]+|["“”'‘’.]+$/g, '').trim();
      const clear = !raw || /^(varsayilan|yok|bos|sifirla|kaldir|sil)$/.test(plain(raw));
      const next = clear ? null : raw.slice(0, 40);
      if (entry.id === 'hitap') {
        return { ok: true, patch: { [key]: next }, say: next ? `Bundan sonra size “${next}” diye hitap edeceğim.` : `Hitabı varsayılana döndürdüm: “${policy.persona.address}”.`, unchanged: (current ?? null) === next };
      }
      return { ok: true, patch: { [key]: next }, say: next ? `Adınızı “${next}” olarak kaydettim.` : 'Kayıtlı adınızı sildim.', unchanged: (current ?? null) === next };
    }
    case 'choice': {
      const choices = choicesOf(entry, key);
      if (choices.length === 0) {
        return { ok: false, text: `${capitalize(entry.label)} ayarının seçenekleri bu sürümde sesle seçilemiyor; Ayarlar sayfasından değişir. Değiştirilmedi; kullanıcıya bunu söyle.` };
      }
      const text = plain(spoken);
      const picked = choices.find((choice) => plain(choice.value) === text) ?? choices.find((choice) => choice.match.test(text));
      // Ses motoru: "varsayılana dön", "Yönetim'in seçimine dön" bu cihazın seçimini kaldırır (`null`).
      if (!picked && entry.id === 'ses_motoru' && /varsayilan|yonetim/.test(text)) {
        return { ok: true, patch: current === null ? {} : { [key]: null }, say: 'Ses motorunda Fuber Yönetim’in seçimine döndüm.', unchanged: current === null };
      }
      if (!picked) return { ok: false, text: `${capitalize(entry.label)} için seçenekler: ${choices.map((choice) => choice.label).join(', ')}. “${spoken}” bunlardan biri değil; kullanıcıya seçenekleri söyle.` };
      if (current === picked.value) return { ok: true, patch: {}, say: `${capitalize(entry.label)} zaten ${picked.label}.`, unchanged: true };
      return { ok: true, patch: { [key]: picked.value }, say: `${capitalize(entry.label)} ${picked.label} yapıldı.`, unchanged: false };
    }
    case 'voice': {
      // Ses, motor başına tutulur (`ttsVoices`): seçenekler o an geçerli motorun sesleridir.
      const catalog = ttsCatalog();
      const engine = currentEngine(settings, policy);
      const voices = catalog ? voiceChoices(catalog, engine) : [];
      const engineLabel = catalog ? labelOf(catalog[engine]?.label, engine) : engine;
      if (!catalog || typeof current !== 'object' || current === null) {
        return { ok: false, text: 'Ses seçimi bu sürümde sesle yapılamıyor; Ayarlar › Ses’ten seçilir. Değiştirilmedi; kullanıcıya bunu söyle.' };
      }
      if (voices.length === 0) {
        return { ok: false, text: `Değiştirilmedi. Kullanıcıya yalnız şunu söyle: "${engineLabel} motorunun sesi Fuber Yönetim’den seçilir; başka bir ses için önce ses motorunu değiştirebilirsiniz."` };
      }
      const text = digitize(plain(spoken));
      const picked = voices.find((voice) => plain(voice.value) === text) ?? voices.find((voice) => voice.match.test(text));
      if (!picked) {
        return { ok: false, text: `${engineLabel} motorunun sesleri: ${voices.map((voice) => voice.label).join(', ')}. Hangisi istendiği anlaşılmadı; kullanıcıya seçenekleri kısaca söyle ve hangisini istediğini sor.` };
      }
      const map = current as Record<string, unknown>;
      if (map[engine] === picked.value) return { ok: true, patch: {}, say: `Sesim zaten ${picked.label}.`, unchanged: true };
      return { ok: true, patch: { [key]: { ...map, [engine]: picked.value } }, say: `Sesimi ${picked.label} yaptım.`, unchanged: false };
    }
    case 'follow-up':
      return planFollowUp(key, current, spoken, policy);
  }
}
