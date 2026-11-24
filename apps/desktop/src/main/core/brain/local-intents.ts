// Yerel modelde ses denetimi sözlerinin KODLA eşlenmesi. İlk denemelerde "Sesli modeli kapatabilirsin" sözü
// başarısız turla bitti ("Bunu yapamadım: gereken işlemi çalıştıramadım"): küçük model aracı çağırmadan "kapattım"
// dedi, uyarıdan sonraki zorunlu araç adımında da çağrı üretmedi (ölçüm: "sesi kapat" 3 denemenin 2'sinde düştü).
// Fuber AI 1 de yerel modelde güvenilmeyen işleri modele bırakmıyordu (`shared/yerel-yonlendirme.ts`: "yerel model
// yazar, özetler, hatırlar; kesin iş KODLA yapılır"). Burada yalnız dar ve kesin kalıplar eşlenir; emin olunmayan söz
// modele kalır, anlamı belirsiz söz ("sesi kapat") için model yerine sabit bir soru sorulur.
import { farewellKind, type FarewellKind } from './farewell';
import { foldTr } from './local-tools';

/**
 * Veda sözü ("güle güle", "bay bay", "görüşürüz", "iyi geceler"…): sohbeti BİTİRME isteğidir; mikrofonu kapatma ya da
 * dinlemeyi duraklatma değildir. Kalıp `farewell.ts`'tedir (ses oturumunun hızlı yoluyla ortak). Beyin bu sözde modeli
 * çağırmaz: `voice_end_conversation` aracını kodla çalıştırır ve tek kısa veda söyler (`core/brain.ts`).
 */
export const farewellIntent = (text: string, names: readonly string[] = []): FarewellKind | null => farewellKind(text, names);

/**
 * Dinlemeyi ya da sesli yanıtı KAPATAN araçlar. Yerel model bunları yalnız kullanıcının sözü böyle bir şeyi işaret
 * ediyorsa çağırabilir (`asksVoiceOff`). Ölçüm (demo.3): "Görüşürüz diye bir film var mı?" sorusunda model üç denemenin
 * birinde `voice_mute_mic({minutes: 1})` çağırdı; kullanıcı sormadan mikrofonu kapatmak en pahalı yanlıştır (asistan
 * duymaz olur). Kodun kendi kararları (kesin söz, veda) bu denetimden geçmez.
 */
export const VOICE_OFF_TOOLS: ReadonlySet<string> = new Set(['voice_mute_mic', 'voice_pause_listening', 'voice_set_quiet', 'voice_end_conversation']);

const VOICE_OFF_WORDS =
  /mikrofon|dinle|duy(ma|mayi|masin)|\bses|\bsus|sessiz|konus|kapat|\bkapa\b|\bkis\b|rahat|birak|durdur|duraklat|yaziyla|toplanti|uyandirma|bitir|sonlandir|vedalas|\bara ver/;
/** Asistanın bir önceki sözü bu konuda bir soruydu ("Dinlemeyi mi kapatayım, sesli yanıtı mı?"): kısa yanıt da geçerlidir. */
const VOICE_OFF_ASKED = /mikrofon|dinleme|sesli yanit|sessiz kip|sohbeti/;

/** Kullanıcının sözü (ya da asistanın az önceki sorusu) dinlemeyi/sesli yanıtı kapatmayı işaret ediyor mu. */
export function asksVoiceOff(text: string, previousReply: string | null = null): boolean {
  return VOICE_OFF_WORDS.test(foldTr(text)) || (previousReply !== null && VOICE_OFF_ASKED.test(foldTr(previousReply)));
}

export type VoiceIntent =
  /** Araç doğrudan çalıştırılır; sonucunu model tek cümleyle söyler. */
  | { kind: 'call'; name: 'voice_mute_mic' | 'voice_set_quiet' | 'voice_stop_speaking' | 'self_status' | 'ambient_set'; input: Record<string, unknown> }
  /** "Dinlemeyi mi kapatayım, sesli yanıtı mı?" */
  | { kind: 'ask' };

const MUTE = /\bmikrofon\w*\s+(kapat|kapa\b|kis\b|sustur)|\bbeni dinleme\b|\bdinleme(yi|si)?\s+(birak|kapat|durdur|kes|bitir)|\bdinlemeyi\b.*\b(birak|kapat|durdur)/;
const QUIET_ON = /\bsesli\s+(yanit|cevap|konusma)\w*\s+(verme|kapat|kapa\b|istemiyorum|yapma)|\bsesli konusma\b$|\bsessiz\s+(ol|kal|kipe gec|moda gec|kipi ac|modu ac)\b|\byaziyla\s+(soyle|yanit|cevap|yaz|bildir)|\bsadece yaz\b/;
/**
 * Ortam dinleme (gün boyu not tutma) aç/kapat (d10). "Ortam dinlemeyi kapat" sözü eskiden `MUTE` kalıbına düşüp
 * MİKROFONU kapatıyordu: ortam sözcüğü geçen söz mikrofon kalıbına girmez, kendi aracına (`ambient_set`) gider.
 */
const AMBIENT = /\bortam\w* dinle\w*/;
const AMBIENT_OFF = /\b(kapat\w*|kapa|kapansin|durdur\w*|birak\w*|kes)\b/;
const AMBIENT_ON = /\b(ac|acar\w*|acsana|acilsin|acsin|baslat\w*|etkinlestir\w*)\b/;
/** Hangisi olduğu söylenmeyen "ses"i kapatma: dinleme mi, sesli yanıt mı? */
const AMBIGUOUS = /\bses(i|ini|li\s+mod\w*|li\s+model\w*|li\s+asistan\w*)?\s+(kapat|kapa\b|kis\b)/;
/** Belirsizliği gideren ya da başka bir şeyi (müzik, bilgisayar sesi) işaret eden sözcükler. */
const NOT_AMBIGUOUS = /mikrofon|dinle|yanit|cevap|konus|yazi|muzi|sarki|video|bilgisayar|hoparlor|kulaklik|bildirim/;
/** Olumsuz buyruk ("mikrofonu kapatma") ya da soru ("mikrofon kapalı mı") eşlenmez. */
const NEGATED = /kapatma\b|kapama\b|birakma\b|durdurma\b|kapali|acik mi|durum/;
/** Süre ya da sayı geçen söz modele kalır (dakikayı model çıkarır). */
const HAS_DURATION = /\d|dakika|saat|sure|yarim|ceyrek|kadar/;

/** Belirsizlik sorusuna verilen kısa yanıt. */
const ANSWER_LISTEN = /dinle|mikrofon|duyma/;
const ANSWER_SPEECH = /sesli|yanit|cevap|ses|konus|sessiz/;

/** Yalnız susturma sözünden oluşan kısa söz. */
const STOP = /^(tamam |artik |lutfen )?(sus|dur|yeter|kes|kes sesini|sus artik)( artik| lutfen| tamam)?$/;

/**
 * Bilgisayarın donanımını soran söz ("ekran kartımı görebiliyor musun", "kaç GB RAM var"). 40 turluk ölçümde model
 * aracı çağırmadan "RTX 4090" diye uydurdu; donanım sorusunda durum aracı kodla çalıştırılır, model sonucu söyler.
 */
const HARDWARE = /ekran kart|\bislemci|\bram\b|donanim|bilgisayarimin ozellik|\bgpu\b|\bcpu\b|ekran bellegi|\bgb\b.*belleg/;
const HARDWARE_ASK = /\bgor|\bbili|\bne\b|nedir|hangi|\bkac\b|marka|model|soyle|\boku|\bvar\b|ne kadar/;

const words = (text: string) => text.split(' ').filter(Boolean).length;

const ASKS_EARLIER = /(az once|demin|biraz once|daha once|gecen sefer|gecenlerde|dun)\b.*\b(ne|neydi|neler)\b.*(soyle|demis|dedim|konus|iste)/;

/**
 * Kullanıcı daha önce söylediğini soruyor mu ("az önce ne söylemiştim?"). Oturumun ilk sözüyse geçmişte bakılacak bir
 * şey yoktur; model soruyu kendisine yineliyordu (ölçüm: 3 denemede 0). Hafızaya bakması ipucuyla söylenir.
 */
export function asksEarlier(text: string): boolean {
  return ASKS_EARLIER.test(foldTr(text).replace(/[^\p{L}\p{N}\s]+/gu, ' '));
}

/** "Az önce", "demin": BU konuşmanın yakın geçmişi (dün, geçen sefer gibi uzak geçmiş hafızanın işidir). */
const RECALL_NEAR = /\b(az once|az evvel|demin|deminki|biraz once|biraz evvel|hemen once|az onceki|simdi|en son|son olarak)\b/;
/** Kullanıcının KENDİ sözü soruluyor: "ne söylemiştim", "ne dedim", "ne sormuştum", "ne diyordum". */
const RECALL_USER = /\bne (soyle(mis)?(tim|dim)|de(mis)?(tim|dim)|sor(mus)?(tum|dum)|iste(mis)?(tim|dim)|anlat(mis)?(tim|iyordum)|diyordum|soyluyordum)\b/;
/** Asistanın sözü soruluyor: "ne dedin", "ne söylemiştin", "ne diyordun". */
const RECALL_ASSISTANT = /\bne (soyle(mis)?(tin|din)|de(mis)?(tin|din)|anlat(mis)?(tin|iyordun)|diyordun|soyluyordun)\b/;
/** Belirli bir konuyu soran söz ("Kaan hakkında ne demiştim") modele kalır: yanıt geçmişten seçilmelidir. */
const RECALL_TOPIC = /hakkinda|ile ilgili|\bicin\b|konusunda|\bhangi\b|\bkim\w*\b|nere\w*|kac\w*|ne zaman/;

/**
 * Söz, bu konuşmada AZ ÖNCE söyleneni mi soruyor: `user` kullanıcının bir önceki sözü, `assistant` asistanın bir önceki
 * yanıtı; değilse `null`. Ölçüm (demo.3, 3 yineleme): geçmişte söz dururken "Az önce ne söylemiştim?" sorusuna model
 * "bilgi vermiştin", "size … hatırlattım", "hafızamda bulamadım" dedi ya da susturma aracını çağırdı (1/3). Yanıt
 * geçmişte AYNEN durur: modele bırakılmaz, kodla okunur (`core/brain.ts`). Hafıza araması bu sorunun yanıtı değildir.
 */
export function recallIntent(text: string): 'user' | 'assistant' | null {
  const folded = foldTr(text).replace(/[^\p{L}\p{N}\s]+/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!folded || words(folded) > 9 || !RECALL_NEAR.test(folded) || RECALL_TOPIC.test(folded)) return null;
  if (RECALL_USER.test(folded)) return 'user';
  if (RECALL_ASSISTANT.test(folded)) return 'assistant';
  return null;
}

/**
 * Söz, bu konuşmada az önce söylenen bir AYRINTIYI mı soruyor ("az önce hangi projeden bahsetmiştim?"). Yanıt geçmişten
 * seçilmelidir: modele kalır ama kullanıcının bir önceki sözü sorunun yanına konur ve tur araçsız yürür (hafıza araması
 * bu sorunun yanıtı değildir). Ölçüm: ipucu yokken model "projeden bahsetmiyordum, sadece Atlas paneline değinmiyordum" dedi.
 */
export function asksRecentDetail(text: string): boolean {
  const folded = foldTr(text).replace(/[^\p{L}\p{N}\s]+/gu, ' ').replace(/\s+/g, ' ').trim();
  return (
    words(folded) <= 14 &&
    RECALL_NEAR.test(folded) &&
    /bahset|soyle|\bde(mis|di)|konus|sor(mus|du)|iste(mis|di)|anlat/.test(folded) &&
    !ABOUT_SOMEONE_ELSE.test(folded) &&
    recallIntent(text) === null
  );
}

/**
 * Üçüncü kişinin sözü ya da bir ileti kanalı soruluyor ("Ahmet en son ne dedi", "WhatsApp'ta son ne yazdı", "e-postada ne
 * istemiş"): konuşmanın geçmişi değil, okunacak bir kaynaktır. d6: bu sözde tur araçsız yürüyordu ve model "haberim yok"
 * dedi; artık araçlar sunulur.
 */
const ABOUT_SOMEONE_ELSE = /\bne (dedi|demis|yazdi|yazmis|soyledi|soylemis|istedi|istemis|sordu|sormus)\b|whats ?app|vatsap|e ?posta|\bmail/;

/** Söz donanım sorusu mu (`self_status` kodla çağrılır). */
export function asksHardware(text: string): boolean {
  const folded = foldTr(text).replace(/[^\p{L}\p{N}\s]+/gu, ' ').replace(/\s+/g, ' ').trim();
  return words(folded) <= 16 && HARDWARE.test(folded) && HARDWARE_ASK.test(folded);
}

/**
 * Sözün ses denetimi niyeti; emin değilse `null` (model karar verir).
 * `askedBefore`: bir önceki asistan iletisi belirsizlik sorusuydu (kullanıcı şimdi onu yanıtlıyor).
 */
export function routeVoiceIntent(text: string, askedBefore: boolean): VoiceIntent | null {
  const folded = foldTr(text).replace(/[^\p{L}\p{N}\s]+/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!folded) return null;
  const count = words(folded);
  if (askedBefore && count <= 6) {
    const listen = ANSWER_LISTEN.test(folded);
    const speech = !listen && ANSWER_SPEECH.test(folded);
    if (listen) return { kind: 'call', name: 'voice_mute_mic', input: {} };
    if (speech) return { kind: 'call', name: 'voice_set_quiet', input: { on: true } };
    return null;
  }
  // "Sus", "dur": sesli turda ses hattı bunları beyne gelmeden keser; yazılı ya da geç gelen sözde burada eşlenir.
  if (STOP.test(folded)) return { kind: 'call', name: 'voice_stop_speaking', input: {} };
  if (asksHardware(text)) return { kind: 'call', name: 'self_status', input: {} };
  if (count > 9 || HAS_DURATION.test(folded) || NEGATED.test(folded)) return null;
  if (AMBIENT.test(folded)) {
    if (AMBIENT_OFF.test(folded)) return { kind: 'call', name: 'ambient_set', input: { on: false } };
    if (AMBIENT_ON.test(folded)) return { kind: 'call', name: 'ambient_set', input: { on: true } };
    return null;
  }
  if (MUTE.test(folded)) return { kind: 'call', name: 'voice_mute_mic', input: {} };
  if (QUIET_ON.test(folded)) return { kind: 'call', name: 'voice_set_quiet', input: { on: true } };
  if (AMBIGUOUS.test(folded) && !NOT_AMBIGUOUS.test(folded)) return { kind: 'ask' };
  return null;
}
