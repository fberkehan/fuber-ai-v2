// Yerel (küçük) modelin yanıt üslubunu cümle cümle düzelten süzgeç. İlk denemelerde model her cümleye
// "Efendim" ile başladı, her yanıtı "Nasıl yardımcı olabilirim?" ile bitirdi, sorulmadan tarih/saat okudu ve yeni bir
// söz karşısında önceki yanıtını aynen yineledi. İstem kuralı küçük modelde tek başına yetmiyor (taban ölçüm: yanıt
// başına 1,01 "efendim"); süzgeç kuralı kodla uygular. Yalnız yerel yolda çalışır; bulut modelinin metnine dokunulmaz.
import { stemSet, stemSetSimilarity } from '@fuber/shared';
import { foldTr } from './local-tools';

/** Yanıtın sonuna eklenen kalıp teklif ("Size nasıl yardımcı olabilirim?", "Başka bir isteğiniz var mı?"). */
const OFFER =
  /^((peki|simdi|bugun|size|sana|baska) )*(nasil|ne konuda|hangi konuda|ne sekilde) yardimci olabilirim|^(size |sana )?yardimci olabilecegim baska|^baska (bir )?(sey|istek|isteginiz|isiniz|isim|konu|sorunuz|soru)\w*.*(var mi|olur mu)|^istediginiz baska bir sey var mi|^baska nasil yardimci|^umarim (isinize|ise) yarar|^daha (detayli|ayrintili|fazla) bilgi ister mi|^baska (bir )?(sey|is|konu)\w* (yapabilir|yapmami ister|yardimci olabilir)|^ne yardimci olabilirim|^(simdi |peki )?ne yapmami istersin/;

/** Cümlenin sonuna virgülle eklenen aynı kalıp ("…, yoksa nasıl yardımcı olabilirim?"): yalnız bu parça kesilir. */
const OFFER_TAIL = /[,;]\s*(?:yoksa|ya da|peki|ama)?\s*(?:size |sana )?(?:başka )?(?:nasıl|ne konuda|ne şekilde) yardımcı olabilirim\s*\?\s*$/iu;

/** Önceki yanıtla "aynı cümle" sayma eşiği (kök kümesi örtüşmesi) ve en az kök sayısı (kısa cümleler tesadüfen benzer). */
const REPEAT_SIMILARITY = 0.85;
const REPEAT_MIN_STEMS = 3;

const MONTHS = ['ocak', 'subat', 'mart', 'nisan', 'mayis', 'haziran', 'temmuz', 'agustos', 'eylul', 'ekim', 'kasim', 'aralik'];

const plain = (text: string) => foldTr(text).replace(/[^\p{L}\p{N}\s]+/gu, ' ').replace(/\s+/g, ' ').trim();
const sentenceList = (text: string) => text.split(/(?<=[.!?…])\s+/).map((part) => part.trim()).filter(Boolean);
const pad = (value: number) => String(value).padStart(2, '0');

export interface ReplyFilterOptions {
  /** Hitap sözcüğü ("efendim"). */
  address: string;
  /** Geçmişteki son asistan yanıtı; yoksa `null`. */
  previousReply: string | null;
  /** Kullanıcı yinelemeyi kendisi istedi ("bir daha söyle"): yineleme denetimi kapalı. */
  allowRepeat: boolean;
  /**
   * Verilirse: kullanıcı zaman sormadı; şimdiki tarihi ya da saati OKUYAN cümle atılır (sınamada görüldü: alakasız
   * yanıtlarda "Şu anki tarih 16 Kasım 2026, saat 12:34'tir"). Zaman sorulduğunda ya da zamanlı iş yapıldığında `null`.
   */
  unaskedTime?: Date | null;
  /** Turun adımları arasında paylaşılan sayaç: hitap bütün turda yalnız bir kez kalır. */
  shared?: { emitted: number };
}

export interface ReplyFilter {
  /** Tamamlanan bir cümleyi alır; şimdi iletilecek cümleleri döndürür (bekletilenler sonra gelir). */
  push(sentence: string): string[];
  /** Yanıt bitti: bekletilenlerden iletilecekler ve yanıtın tümüyle önceki yanıtın yinelemesi olup olmadığı. */
  end(): { sentences: string[]; repeated: boolean };
}

/** Cümle şimdiki tarihi ya da saati söylüyor mu ("16 Kasım 2026", "saat 12:34"). */
export function statesNow(sentence: string, now: Date): boolean {
  const text = plain(sentence);
  const raw = foldTr(sentence);
  const minuteBefore = new Date(now.getTime() - 60_000);
  const clocks = [now, minuteBefore].flatMap((date) => [`${pad(date.getHours())}:${pad(date.getMinutes())}`, `${date.getHours()}:${pad(date.getMinutes())}`, `${pad(date.getHours())}.${pad(date.getMinutes())}`]);
  if (clocks.some((clock) => raw.includes(clock))) return true;
  if (text.includes(`${now.getDate()} ${MONTHS[now.getMonth()]}`)) return true;
  return /su anki (tarih|saat)/.test(text);
}

export function createReplyFilter(options: ReplyFilterOptions): ReplyFilter {
  const address = plain(options.address);
  // Önceki yanıt hitapla başladıysa bu yanıt hitapsız başlar: hitap arada bir duyulur, her yanıtta değil.
  const previousAddressed = !!options.previousReply && !!address && plain(options.previousReply).startsWith(address);
  const shared = options.shared ?? { emitted: 0 };
  let emitted = 0;
  let seen = 0;
  let allRepeats = true;
  /** Yineleme olup olmadığı belli olana dek bekletilen cümleler. */
  let heldRepeats: string[] = [];
  /** Yanıtın son cümlesiyse atılacak kalıp teklif. */
  let heldOffer: string | null = null;
  /** Sorulmadan saat okuduğu için atılan cümleler; başka hiçbir şey söylenmediyse yine de iletilir. */
  const droppedTime: string[] = [];

  const stripAddress = (sentence: string): string => {
    if (!address) return sentence;
    const match = new RegExp(`^\\s*${address.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[,!.:;–-]*\\s+`, 'iu').exec(foldTr(sentence));
    if (!match) return sentence;
    const rest = sentence.slice(match[0].length);
    return rest ? rest[0]!.toLocaleUpperCase('tr') + rest.slice(1) : sentence;
  };

  // Karşılaştırma hitapsız yapılır: "Efendim, iyiyim" ile "Çok teşekkürler, iyiyim" hitap yüzünden farklı sayılmasın.
  const previous = options.previousReply ? sentenceList(options.previousReply).map((sentence) => stemSet(stripAddress(sentence))) : [];

  const isRepeat = (sentence: string): boolean => {
    if (options.allowRepeat || previous.length === 0) return false;
    const stems = stemSet(stripAddress(sentence));
    if (stems.size < REPEAT_MIN_STEMS) return false;
    return previous.some((other) => other.size >= REPEAT_MIN_STEMS && stemSetSimilarity(stems, other) >= REPEAT_SIMILARITY);
  };

  const release = (sentence: string): string => {
    const first = shared.emitted === 0;
    emitted++;
    shared.emitted++;
    // Hitap yalnız turun ilk cümlesinde kalabilir; önceki yanıt da hitapla başladıysa orada da kalmaz.
    return first && !previousAddressed ? sentence : stripAddress(sentence);
  };

  return {
    push(raw) {
      // Model, iletinin başındaki köşeli etiketi ya da bağlam bloğunu yanıtına kopyalarsa atılır.
      // Geçmişteki "(yapıldı: …)" notu da yanıta taşınmaz.
      const sentence = raw
        .replace(/<\/?baglam>/gi, ' ')
        .replace(/\s*\(yapıldı:[^)]*\)/gi, '')
        .replace(/^\s*(\[[^\]]{0,80}\]\s*)+/, '')
        .replace(OFFER_TAIL, '.')
        .trim();
      if (!sentence) return [];
      seen++;
      if (options.unaskedTime && statesNow(sentence, options.unaskedTime)) {
        droppedTime.push(sentence);
        seen--;
        return [];
      }
      const out: string[] = [];
      if (heldOffer) {
        // Kalıp teklifin ardından söz sürdü: son cümle değilmiş, iletilir.
        out.push(heldOffer);
        heldOffer = null;
      }
      const repeat = isRepeat(sentence);
      if (allRepeats && repeat) {
        heldRepeats.push(sentence);
        return out.map(release);
      }
      if (allRepeats && heldRepeats.length) {
        out.push(...heldRepeats);
        heldRepeats = [];
      }
      allRepeats = false;
      if (OFFER.test(plain(stripAddress(sentence)))) heldOffer = sentence;
      else out.push(sentence);
      return out.map(release);
    },
    end() {
      const repeated = allRepeats && heldRepeats.length > 0 && seen === heldRepeats.length;
      const rest: string[] = [];
      if (!repeated) rest.push(...heldRepeats);
      heldRepeats = [];
      // Kalıp teklif ya da saat cümlesi yanıtın tek içeriğiyse kalır (boş yanıt olmasın).
      if (heldOffer && emitted + rest.length === 0) rest.push(heldOffer);
      heldOffer = null;
      if (!repeated && emitted + rest.length === 0) rest.push(...droppedTime);
      return { sentences: rest.map(release), repeated };
    },
  };
}
