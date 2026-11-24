/**
 * Dökümden yerel kararlar: uyandırma sözüyle mi başlıyor, dur-sözcüğü mü, sohbet kipi sözü mü.
 * Sözlü onay burada yorumlanmaz: o karar araç servisinindir (`core/tools.ts` › `interpretApprovalSpeech`).
 * Bunlar model turu açmadan, milisaniyeler içinde verilir; yanlış pozitif pahalıdır
 * (Jarvis kendiliğinden uyanır ya da susar), bu yüzden eşleşmeler dar tutulur.
 */
import { farewellKindOfCore, type FarewellKind } from '../core/brain/farewell';

const DIACRITICS: Record<string, string> = {
  ç: 'c',
  ğ: 'g',
  ı: 'i',
  ö: 'o',
  ş: 's',
  ü: 'u',
  â: 'a',
  î: 'i',
  û: 'u',
};

/** Türkçe küçük harf + aksansız Latin. Whisper aynı sesi "sus" da "süs" de yazabildiği için ünlü ayrımı da silinir. */
export function foldSpeech(text: string): string {
  return text
    .toLocaleLowerCase('tr')
    .replace(/[çğıöşüâîû]/g, (ch) => DIACRITICS[ch] ?? ch)
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

interface Token {
  /** Katlanmış sözcük; kesme işareti ve sonrası dahil ("jarvis'e"). */
  text: string;
  /** Özgün metinde sözcüğün bittiği konum. */
  end: number;
}

const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const match of text.matchAll(WORD)) {
    tokens.push({ text: foldSpeech(match[0]).replace(/’/g, "'"), end: match.index + match[0].length });
  }
  return tokens;
}

/**
 * Bir adın söyleniş anahtarı: Türkçe konuşan birinin "Jarvis" deyişini Whisper "Carvis", "Cervis",
 * "Çarvis", "Jarvıs" diye yazabilir. Bu yazımların hepsi aynı anahtara iner; başka sözcükler ("servis") inmez.
 */
export function soundKey(word: string): string {
  return foldSpeech(word)
    .replace(/^dj/, 'c')
    .replace(/^ch/, 'c')
    .replace(/j/g, 'c')
    .replace(/w/g, 'v')
    .replace(/e/g, 'a')
    .replace(/z$/, 's');
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, (previous[j - 1] ?? 0) + cost);
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

/**
 * Whisper adı her seferinde aynı yazmaz ("Jarlis", "Javis", "Carvi"). Tek harflik sapma kabul edilir ama
 * yalnız şu koşullarla: ilk ses aynı ("servis" uyandırmaz) ve sözcük addan uzun değil — Türkçede ekler sona
 * gelir, addan uzun sözcük ek almış addır ("Jarvise", "Jarvisi") ve seslenme değildir.
 */
function nearName(key: string, nameKey: string): boolean {
  if (nameKey.length < 5 || key[0] !== nameKey[0]) return false;
  if (key.length === nameKey.length) {
    let differences = 0;
    for (let i = 0; i < key.length; i++) if (key[i] !== nameKey[i]) differences++;
    return differences <= 1;
  }
  if (key.length === nameKey.length - 1) {
    for (let skip = 1; skip < nameKey.length; skip++) {
      if (nameKey.slice(0, skip) + nameKey.slice(skip + 1) === key) return true;
    }
  }
  return false;
}

export interface WakeMatch {
  matched: boolean;
  /** Eşleşen uyandırma sözü (politikadaki yazımıyla); eşleşme yoksa boş. */
  phrase: string;
  /** Uyandırma sözünden sonra kalan metin ("Jarvis, saat kaç" → "saat kaç"). */
  rest: string;
}

export interface WakeMatcher {
  match(text: string): WakeMatch;
  /**
   * Sezici uyandırma sözünü SESTEN zaten doğruladıysa dökümün başındaki söz gevşek eşleşmeyle ayıklanır
   * ("Hey Javis yarın…" → "yarın…"). Yalnız o durumda kullanılır; uyandırma kararı buna dayanmaz.
   */
  stripHeard(text: string, phrase: string): string;
  /** Dur-sözcüğü ve sohbet kipi eşleşmelerinde yok sayılacak ad anahtarları. */
  readonly nameKeys: ReadonlySet<string>;
  /**
   * Tanı: döküm uyandırmadıysa baştaki üç sözcükte ada benzeyen (söyleniş anahtarında en çok iki harf fark) bir sözcük
   * var mı; varsa o sözcük (günlüğe "kaçan uyanma" olarak yazılır, kalibrasyonun öğreneceği yazım budur).
   */
  nearMiss(text: string): string | null;
}

// d6: seslenmenin önüne gelen gündelik sözler de önektir ("Tamam Jarvis, …", "Alo Jarvis", "Günaydın Jarvis").
const BUILTIN_PREFIXES = ['hey', 'hay', 'ey', 'hei', 'e', 'ee', 'eh', 'tamam', 'alo', 'merhaba', 'selam', 'gunaydin', 'hadi', 'bak', 'ok', 'okay', 'oke'];

/**
 * Sevgi/seslenme eki: "Jarvis'cim", "Jarvisciğim" seslenmedir (ek almış ad olsa da birinden söz etmek değildir).
 * Katlanmış biçimde: cim/cigim (ve yazım çeşitleri), kesme işaretli ya da bitişik.
 */
const isVocativeSuffix = (suffix: string): boolean => /^'?c[iu](g[iu])?m$/.test(foldSpeech(suffix));

/**
 * `phrases`: politikadaki uyandırma sözleri ("hey jarvis"); `name`: asistanın adı. Her sözün son sözcüğü
 * addır, öncekiler isteğe bağlı seslenme önekidir. Yalın ad seslenmedir; ek almış ad ("Jarvis'e söyle",
 * "Jarvis'in") birinden söz etmektir ve uyandırmaz.
 *
 * `learned`: kalibrasyonda Whisper'ın kullanıcının söyleyişini nasıl yazdığı ("çarviz", "hay carbis"). Bu yazımlar
 * da ad sayılır; tek harflik sapma payı onlara tanınmaz (yalnız birebir söyleniş anahtarı eşleşir).
 */
export function createWakeMatcher(phrases: string[], name: string, learned: string[] = []): WakeMatcher {
  const names = new Map<string, string>();
  const prefixes = new Set(BUILTIN_PREFIXES);
  for (const phrase of [...phrases, name]) {
    const words = foldSpeech(phrase).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    const last = words.pop();
    if (!last) continue;
    if (!names.has(soundKey(last))) names.set(soundKey(last), phrase);
    for (const word of words) prefixes.add(word);
  }
  /** Öğrenilen yazımların anahtarları: bunlara yakınlık (tek harf sapma) uyandırmaz. */
  const learnedKeys = new Set<string>();
  const primary = phrases[0] ?? name;
  for (const spelling of learned) {
    const words = foldSpeech(spelling).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    const last = words.pop();
    if (!last) continue;
    const key = soundKey(last);
    if (!names.has(key)) {
      names.set(key, primary);
      learnedKeys.add(key);
    }
    for (const word of words) prefixes.add(word);
  }
  const nameKeys = new Set(names.keys());
  const none: WakeMatch = { matched: false, phrase: '', rest: '' };
  /** Sözcük bir ada (tam ya da tek harf sapmayla) karşılık geliyorsa o adın uyandırma sözü. */
  const phraseFor = (word: string): string | undefined => {
    const key = soundKey(word);
    const exact = names.get(key);
    if (exact !== undefined) return exact;
    for (const [nameKey, phrase] of names) if (!learnedKeys.has(nameKey) && nearName(key, nameKey)) return phrase;
    return undefined;
  };
  const restAfter = (text: string, end: number): string =>
    text
      .slice(end)
      .replace(/^[\s,.;:!?…'’"-]+/u, '')
      .trim();

  return {
    nameKeys,
    nearMiss(text) {
      for (const token of tokenize(text).slice(0, 3)) {
        const word = token.text.replace(/'.*$/, '');
        if (word.length < 4) continue;
        const key = soundKey(word);
        for (const nameKey of names.keys()) if (key[0] === nameKey[0] && editDistance(key, nameKey) <= 2) return word;
      }
      return null;
    },
    stripHeard(text, phrase) {
      const expected = foldSpeech(phrase).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
      const tokens = tokenize(text);
      if (expected.length === 0 || tokens.length < expected.length) return text;
      for (let i = 0; i < expected.length; i++) {
        const heard = (tokens[i]?.text ?? '').replace(/'.*$/, '');
        const want = expected[i] ?? '';
        const close = heard === want || editDistance(soundKey(heard), soundKey(want)) <= (want.length >= 5 ? 2 : 1);
        if (!close) return text;
      }
      return restAfter(text, tokens[expected.length - 1]?.end ?? 0);
    },
    match(text) {
      const tokens = tokenize(text);
      let index = 0;
      // Whisper öneki ada yapıştırabilir ("Heycarvis").
      const first = tokens[0];
      if (!first) return none;
      let token = first;
      if (prefixes.has(first.text) && tokens[1]) {
        index = 1;
        token = tokens[1];
      }
      // Kesme işareti ek demektir ("Jarvis'e"): seslenme değil. Tek istisna sevgi eki ("Jarvis'cim", "Jarvisciğim").
      let word = token.text;
      const vocative = /^(.+?)('?c[iu](?:g[iu])?m)$/.exec(word);
      if (vocative?.[1] && vocative[2] && isVocativeSuffix(vocative[2]) && names.has(soundKey(vocative[1].replace(/'$/, '')))) word = vocative[1].replace(/'$/, '');
      if (word.includes("'")) return none;
      let phrase = phraseFor(word);
      if (phrase === undefined && index === 0) {
        for (const prefix of prefixes) {
          // Bitişik yazılan önek ("Heycarvis"); tek harfli önekler ("e") bitişik aranmaz: "ecarvis" diye bir yazım yok.
          if (prefix.length < 2 || !word.startsWith(prefix)) continue;
          phrase = names.get(soundKey(word.slice(prefix.length)));
          if (phrase !== undefined) break;
        }
      }
      if (phrase === undefined) return none;
      return { matched: true, phrase, rest: restAfter(text, token.end) };
    },
  };
}

/** Uyandırma adına benzese de öğrenilmeyecek gündelik sözcükler: öğrenilirlerse sıradan konuşma uyandırır. */
const NEVER_LEARN = new Set(['servis', 'dervis', 'carsi', 'cari', 'harbi', 'sergi', 'sarmis', 'cerrah', 'cevap', 'cars', 'kavis', 'haris']);

/**
 * Kalibrasyon: kullanıcı uyandırma sözünü söyledi, Whisper `text` yazdı ve eşleştirici bunu tanımadı. Yazım ada
 * yeterince benziyorsa (söyleniş anahtarında en çok iki harf fark) öğrenilecek yazımı döndürür; benzemiyorsa
 * (`null`) kullanıcı başka bir şey söylemiştir. Yalnız kısa söz (ad + isteğe bağlı önek) öğrenilir.
 */
export function learnableSpelling(text: string, phrases: string[], name: string): string | null {
  const tokens = tokenize(text).map((token) => token.text.replace(/'.*$/, ''));
  if (tokens.length === 0 || tokens.length > 3) return null;
  const candidate = tokens.at(-1) ?? '';
  if (candidate.length < 4 || NEVER_LEARN.has(candidate)) return null;
  const key = soundKey(candidate);
  for (const phrase of [...phrases, name]) {
    const last = foldSpeech(phrase).split(/[^\p{L}\p{N}]+/u).filter(Boolean).pop();
    if (!last || last.length < 4) continue;
    const nameKey = soundKey(last);
    if (Math.abs(key.length - nameKey.length) <= 2 && editDistance(key, nameKey) <= 2) return candidate;
  }
  return null;
}

const STOP_FILLERS = new Set(['tamam', 'artik', 'lutfen', 'hey', 'ya', 'be', 'simdi', 'bir', 'bi', 'hadi']);
// "bir dakika", "bir saniye", "bekle": konuşmayı kesmek için sık kullanılan sözler (d6). Dolgu "bir" ayıklanır.
const STOP_PHRASES = new Set(['sus', 'dur', 'yeter', 'kes', 'stop', 'sessiz ol', 'kes sesini', 'sus sus', 'dur dur', 'kapa ceneni', 'dakika', 'saniye', 'bekle']);

/**
 * Tek heceli dur-sözcüklerinin Whisper'dan çıkan yazımları. Ölçüm (16 Kas 2026): aynı "Sus." sesi üç koşuda
 * "Sus", "Süs" ve "Sos" diye yazıldı. Kalıplar dar tutulur: "ses", "siz", "söz", "tur" gibi gerçek sözcükler eşleşmez.
 */
const STOP_SHAPES: Array<[shape: RegExp, word: string]> = [
  [/^s[uo]s{1,2}$/, 'sus'],
  [/^d[uo]r{1,2}$/, 'dur'],
  [/^yet[ea]r$/, 'yeter'],
];

function canonicalStopWord(word: string): string {
  for (const [shape, canonical] of STOP_SHAPES) if (shape.test(word)) return canonical;
  return word;
}

/**
 * Dur-sözcüğü mü: "sus", "dur", "yeter", "kes", "tamam sus", "Jarvis sus artık"…
 * Yalnız kısa ve başka içerik taşımayan söz eşleşir; "dur bir dakika, şunu da ekle" eşleşmez.
 */
export function isStopCommand(text: string, nameKeys: ReadonlySet<string> = new Set()): boolean {
  const tokens = tokenize(text).map((token) => canonicalStopWord(token.text.replace(/'.*$/, '')));
  if (tokens.length === 0 || tokens.length > 4) return false;
  const core = tokens.filter((word) => !nameKeys.has(soundKey(word)));
  if (core.length === 0) return false;
  if (STOP_PHRASES.has(core.join(' '))) return true;
  // Dolgu tek başına komut değildir: "tamam sus" → komut, "tamam" → değil.
  const stripped = core.filter((word) => !STOP_FILLERS.has(word));
  return stripped.length > 0 && STOP_PHRASES.has(stripped.join(' '));
}

/**
 * Duyulan dur-sözcüğünün çekirdek sözcükleri (dolgu ve ad dışındakiler) `spoken` metninde geçiyor mu. Geçiyorsa söz
 * büyük olasılıkla asistanın hoparlörden çıkan kendi cümlesidir: Claude Code beyninin dolgu sözü "Bir saniye."
 * yankı gidericinin öğrenemediği cihazda mikrofona geri geliyor, dur-sözcüğü sayılıyor ve tur kesiliyordu (18 Kas 2026).
 */
export function stopWordsSpoken(text: string, spoken: string, nameKeys: ReadonlySet<string> = new Set()): boolean {
  const canonical = (value: string): string[] => tokenize(value).map((token) => canonicalStopWord(token.text.replace(/'.*$/, '')));
  const core = canonical(text).filter((word) => !nameKeys.has(soundKey(word)) && !STOP_FILLERS.has(word));
  if (core.length === 0) return false;
  const said = new Set(canonical(spoken));
  return core.every((word) => said.has(word));
}

/**
 * İş sürerken söylenen iptal sözü: "iptal", "iptal et", "vazgeç", "vazgeçtim", "boş ver", "bırak", "durdur". Dur-sözcüğü
 * gibi yalnız kısa ve başka içerik taşımayan söz eşleşir ("vazgeç, onun yerine Ali'ye yaz" eşleşmez: yeni komuttur).
 */
export function isCancelCommand(text: string, nameKeys: ReadonlySet<string> = new Set()): boolean {
  const core = chatCore(text, nameKeys);
  if (!core || core.split(' ').length > 3) return false;
  return /^(iptal( et| edelim| olsun)?|vazgec(tim)?|vazgectim|bos ?ver|birak|durdur|isi durdur|bunu birak|gerek kalmadi|gerek yok)$/.test(core);
}

/** "Yeniden dene", "tekrar dene", "bir daha dene", "yeniden yap": kesilen / başarısız olan son söz yeniden yürütülür. */
export function isRetryCommand(text: string, nameKeys: ReadonlySet<string> = new Set()): boolean {
  const core = chatCore(text, nameKeys);
  if (!core || core.split(' ').length > 4) return false;
  // Dolgu sözcükleri ("bir", "hadi") ayıklanmış gelir: "bir daha dene" → "daha dene".
  return /^(yeniden|tekrar|daha|bidaha) (dene|yap|baslat|deneyelim|dener misin)$/.test(core);
}

const CHAT_FILLERS = new Set([
  'hadi',
  'haydi',
  'gel',
  'biraz',
  'bir',
  'bi',
  'simdi',
  'artik',
  'lutfen',
  'seninle',
  'benimle',
  'o',
  'zaman',
  'tamam',
  'peki',
  'evet',
  'ya',
  'hey',
  'efendim',
]);

/** Sözün katlanmış sözcükleri; ad ve dolgu sözcükleri ayıklanmış. */
function chatCore(text: string, nameKeys: ReadonlySet<string>): string {
  return tokenize(text)
    .map((token) => token.text.replace(/'.*$/, ''))
    .filter((word) => !CHAT_FILLERS.has(word) && !nameKeys.has(soundKey(word)))
    .join(' ');
}

/**
 * Sohbet kipini başlatan söz: "sohbet edelim", "hadi biraz konuşalım", "sohbet kipini aç". Yalnız kısa ve başka
 * içerik taşımayan söz eşleşir; "şu konuyu konuşalım" eşleşmez (o bir sorudur, model yanıtlar).
 */
export function isStartOfConversation(text: string, nameKeys: ReadonlySet<string> = new Set()): boolean {
  if (tokenize(text).length > 6) return false;
  return /^(sohbet edelim( mi)?|konusalim( mi)?|sohbet etmek istiyorum|konusmak istiyorum|muhabbet edelim|laflayalim|sohbete baslayalim|sohbet (kipini|modunu) (ac|baslat)|sohbet (kipine|moduna) gec|sohbet baslat)$/.test(
    chatCore(text, nameKeys),
  );
}

/**
 * Veda sözü ("güle güle", "bay bay", "görüşürüz", "iyi geceler"): sohbeti bitirir ve tek kısa veda söylenir. Kalıp
 * beyinle ortaktır (`core/brain/farewell.ts`); yalnız vedadan oluşan kısa söz eşleşir.
 */
export function farewellOf(text: string, nameKeys: ReadonlySet<string> = new Set()): FarewellKind | null {
  const tokens = tokenize(text);
  if (tokens.length > 8) return null;
  // Dolguları kalıbın kendisi atar ("kapat artık"taki "artık" vedanın parçasıdır); burada yalnız asistanın adı ayıklanır.
  const core = tokens
    .map((token) => token.text.replace(/'.*$/, ''))
    .filter((word) => !nameKeys.has(soundKey(word)))
    .join(' ');
  return farewellKindOfCore(core);
}

/** Sohbet kipini ya da dinlemeyi bitiren söz: "tamam, bu kadar", "görüşürüz", "sohbeti bitir"; veda sözleri de. */
export function isEndOfConversation(text: string, nameKeys: ReadonlySet<string> = new Set()): boolean {
  if (farewellOf(text, nameKeys) !== null) return true;
  if (tokenize(text).length > 6) return false;
  return /^(bu kadar( yeter)?|bukadar|bu kadardi|gorusuruz|gorusmek uzere|hosca kal|tesekkurler bu kadar|tesekkur ederim bu kadar|sohbeti (bitir|bitirelim|kapat|sonlandir)|sohbet (bitti|bitsin)|sohbet (kipini|modunu) (kapat|bitir)|konusmayi (bitir|bitirelim)|kapatabilirsin)$/.test(
    chatCore(text, nameKeys),
  );
}
