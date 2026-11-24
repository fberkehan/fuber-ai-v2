// Yerel modelde "birden çok şey söylendi, tek madde yazıldı" kusurunun KODLA kapatılması.
//
// Ölçüm (demo.3, Qwen3.5-4B, 3 yineleme): "alışveriş listesine süt, ekmek ve yumurta ekle" sözünde model maddeleri doğru
// ayırıyor (3/3), ama gündelik söyleyişlerde bozuluyor:
//   · "Yarın süt, ekmek ve yumurta almam lazım, bunları ekle." → `todo_add("Süt, ekmek ve yumurta almak")` (0/3): sözde
//     "liste" geçmediği için toplu ekleme aracının kümesi açılmıyor, modelin önünde yalnız tekli araç var;
//   · "alışveriş listesine süt ekmek yumurta ekle" (sesten yazıya çevrilen söz virgülsüz gelir) → "süt ekmek" tek madde (0/3);
//   · "Süt, ekmek, yumurta." → maddelerden biri "Ekme" diye yazıldı (1/3).
// Kullanıcının sözü zaten elimizde: sayılan kalemler sözden KODLA çıkarılır ve modelin ekleme çağrısı onlarla
// düzeltilir (`applyListItems`). Emin olunmayan sözde hiçbir şey değişmez; modelin çağrısı olduğu gibi kalır.
import { foldTr } from './local-tools';

/** Alışveriş bağlamı: kalemler kısa adlardır; "ve" ile bağlanan iki kalem de ayrılır. "Almam lazım" da alışveriştir. */
const SHOPPING = /alisveris|market|pazar list|bakkal|manav|kasap|eczane|almam (lazim|gerek)|almamiz (lazim|gerek)|alacagim|alacagiz|alinacak|almaliyim/;
/** Liste bağlamı: sayılan şeyler ayrı maddelerdir. */
const LIST_CONTEXT = /liste|madde|yapilacak|yapacak|sunlari|bunlari|asagidaki/;
/** Ekleme isteği. */
const ADD_VERB = /\bekle|\byaz\b|yazar misin|yazsana|not et|not al|kaydet|\bkoy\b|koyar misin/;
/** Kalem olamayacak sözcükler: çerçeveden artakalan liste/eylem sözleri. Biri kalemlerde görünürse söz bir sayım değildir. */
const NOT_AN_ITEM =
  /\blist\w*|\bmadde\w*|yapilacak|yapacak|olustur|hazirla|\bekle\w*|\byap\b|\byapalim|tamam|tesekkur|\bevet\b|\bhayir\b|\bolur\b|\bpeki\b|sag ol|bu kadar|\bbaska\b|\bhepsi\b|\bne\b|\bmi\b|\bmu\b/;

/** Sözün başındaki çerçeve: "Jarvis yarın …", "şunları ekle: …". */
const FRAME_HEAD =
  /^(?:(?:jarvis|lutfen|ayrica|simdi|tamam|peki|sunlari|sunlar|bunlari|bana|benim|yarin|bugun|haftaya|yarinki|bugunku)\s+)*(?:(?:alisveris|market|pazar|bakkal|manav)\s+)?(?:(?:list\w*|yapilacak\w*|yapacak\w*)\s+)?(?:(?:sunlari|sunlar|bunlari)\s+)?(?:(?:ekle|yaz|not et|not al|koy)\b)?\s*:?\s*/;
/** Sözün sonundaki çerçeve: "… ekle", "… de ekler misin?", "…, bunları ekle.", "… ve yapılacaklara ekle". */
const FRAME_TAIL =
  /[\s,;.]*(?:\bve\s+)?(?:(?:bunlari|sunlari|hepsini|onlari)\s+)?(?:(?:da|de)\s+)?(?:(?:alisveris\s+|market\s+|yapilacak\w*\s+)?list\w*\s+|yapilacak\w*\s+)?(?:ekle\w*(?:\s+mi\w*)?|ekleyebilir\s+misin\w*|yaz\w*(?:\s+mi\w*)?|not\s+(?:et|al)\w*(?:\s+mi\w*)?|kaydet\w*|koy\w*|lutfen|olsun)[\s.!?]*$/;
/** Kalemlerin ardındaki "almam lazım", "alacağım", "alınacak" kuyruğu. */
const NEED_TAIL = /[\s,;]*\b(?:almam|almamiz|alinmasi|alinacak|alacagim|alacagiz|almak|almayi|alalim|almaliyim|lazim|gerek\w*)[\s.!?]*$/;
/** Yönelme ekli liste adı ("listesine", "listeme", "yapılacaklara"): çerçevedir, kalemler ondan sonra gelir. */
const DATIVE = /^.*?\b(?:list\w*[ea]|yapilacak\w*a|yapacak\w*a)\b\s*(?:sunlari\s+)?/;
/** Miktar sözcükleri bir sonraki kalemle birlikte tek maddedir ("bir kilo domates", "iki ekmek"). */
const QUANTITY = /^(?:\d+|bir|iki|uc|dort|bes|alti|yedi|sekiz|dokuz|on|yarim|ceyrek|birkac|biraz|kilo|kg|gram|gr|litre|lt|paket|kutu|sise|adet|tane|demet|dilim|bardak|koli|duzine)$/;
const STOP_WORDS = new Set(['ve', 'ile', 'de', 'da', 'lutfen']);

const words = (text: string) => text.split(/\s+/).filter(Boolean);
const tidy = (text: string) => text.replace(/^[\s,;:.\-–]+|[\s,;:.!?\-–]+$/g, '').replace(/\s+/g, ' ');

/**
 * Sözün çerçevesini keser, kalemlerin olduğu gövdeyi verir. Kesme katlanmış metinde yapılır ama ÖZGÜN yazım korunur:
 * katlama karakter sayısını değiştirmez (yalnız harf dönüşümü), konumlar özgün metinde de geçerlidir. `framed`: açık bir
 * liste çerçevesi bulundu ("…listesine", "şunları ekle: …").
 */
function cutFrame(text: string): { body: string; framed: boolean } {
  let body = text.trim();
  for (let pass = 0; pass < 3; pass++) {
    const folded = foldTr(body);
    const tail = FRAME_TAIL.exec(folded) ?? NEED_TAIL.exec(folded);
    if (!tail || tail[0].length === 0) break;
    body = body.slice(0, tail.index).trim();
  }
  const colon = body.lastIndexOf(':');
  // İki nokta çerçevedir ("yapılacaklara şunları ekle: …"); açık liste adı da varsa söz kesin bir ekleme buyruğudur.
  if (colon !== -1 && colon < body.length - 1) return { body: body.slice(colon + 1).trim(), framed: DATIVE.test(foldTr(body.slice(0, colon))) };
  const folded = foldTr(body);
  const head = FRAME_HEAD.exec(folded);
  const dative = DATIVE.exec(folded);
  const start = Math.max(head ? head[0].length : 0, dative ? dative[0].length : 0);
  return { body: body.slice(start).trim(), framed: dative !== null };
}

/** "bir de deterjan" → "deterjan"; kalemin başındaki bağlaçlar atılır, miktar kalır. */
const cleanItem = (item: string): string => {
  let out = tidy(item);
  for (let pass = 0; pass < 3; pass++) {
    const lead = /^(?:bir de|birde|ayrica|sonra|ve|ile|bir tane de)\s+/.exec(foldTr(out));
    if (!lead) break;
    out = out.slice(lead[0].length);
  }
  return tidy(out.replace(/\s+(?:da|de)$/i, ''));
};

/** Virgülsüz alışveriş sözü ("süt ekmek yumurta", "bir kilo domates iki ekmek"): her ad bir kalem, miktar bir sonrakine bağlı. */
function splitBare(body: string): string[] {
  const out: string[] = [];
  let pending: string[] = [];
  for (const word of words(body)) {
    const folded = foldTr(word).replace(/[^\p{L}\p{N}]+/gu, '');
    if (!folded || STOP_WORDS.has(folded)) continue;
    if (QUANTITY.test(folded)) {
      pending.push(word);
      continue;
    }
    out.push(tidy([...pending, word].join(' ')));
    pending = [];
  }
  return out;
}

/** Yapılacaklara madde ekleyen araçlar (geri çevrilen ekleme bir kez araçla yeniden denenir; `brain.ts`). */
export const LIST_ADD_TOOLS: ReadonlySet<string> = new Set(['todo_add', 'todo_add_many']);

/**
 * Kullanıcı kalemleri SAYMADAN liste istiyor: "üç maddelik bir liste oluştur ve yapılacaklara ekle", "taşınma için bir
 * liste hazırla". Maddeleri model belirler. Ölçüm (demo.3, Qwen3.5-4B): bu sözde model altı denemenin beşinde İSTEĞİN
 * KENDİSİNİ ilk madde diye yazdı ("Ofis taşınması için üç maddelik liste oluştur"); tura kısa bir ipucu konur.
 */
const INVENT_LIST = /\b(maddelik|kalemlik)\b|\bliste\w*\s+(olustur|hazirla|cikar|yap)\w*/;
export const asksInventedList = (userText: string): boolean => INVENT_LIST.test(foldTr(userText)) && !/\bne var\b|\boku\b|goster/.test(foldTr(userText));
/**
 * Sayılmamış liste isteğinde modele verilen ipucu (bağlam notuna eklenir). Alışverişte madde ÜRÜNDÜR, başka listede
 * İŞTİR: tek ipucu ("somut işleri sen belirle") alışveriş sözünde isteği işlere böldürdü ("Alışveriş listesi oluştur |
 * Üç maddelik liste hazırla | Yapılacaklara ekle"; ölçüm 1/3).
 */
export const inventListHint = (userText: string): string =>
  SHOPPING.test(foldTr(userText))
    ? 'Kullanıcı kalemleri saymadı: alınacak ürünleri SEN seç; her madde tek bir ürünün adı olsun ("süt", "ekmek" gibi). İsteğin kendisini ("… liste oluştur") madde yazma.'
    : 'Kullanıcı maddeleri saymadı: bu iş için gereken somut işleri SEN belirle ve her birini ayrı, kısa bir madde olarak ekle ("Koli al", "Nakliyeciyi ara" gibi). İsteğin kendisini ("… liste oluştur") madde yazma.';

export interface SpokenList {
  items: string[];
  /** Kalemlerin sözden nasıl çıktığı (günlük ve sınama için). */
  how: 'comma' | 'and' | 'bare';
  /**
   * Söz AÇIK bir listeye ekleme buyruğu: liste adı yönelme ekiyle ya da iki noktayla anılmış ve ekleme fiili var
   * ("alışveriş listesine … ekle", "yapılacaklara şunları ekle: …"). Böyle sözde ekleme çağrısını kod yapar, model seçmez.
   */
  explicit: boolean;
}

/**
 * Kullanıcının sözünde sayılan kalemler; emin değilse `null`. `context`: bir önceki kullanıcı sözü ("Alışveriş listesi
 * yapalım." → "Süt, ekmek, yumurta."). Kurallar dardır:
 *   · söz bir liste bağlamı taşımalı (liste, alışveriş, yapılacak, "şunları", "bunları", "almam lazım", iki nokta);
 *   · virgüllü sayım: en az iki parça ve parçalar BİRÖRNEK (alışverişte hepsi ≤ 4 sözcük; başka listede hepsi ≤ 3 sözcük).
 *     "Ankara, İstanbul ve İzmir bayilerini ara" tek iştir: son parça uzun olduğu için bölünmez;
 *   · yalnız "ve" ile bağlı kalemler: ancak alışveriş bağlamında ("domates ve biber"); "Ali ve Veli ile toplantı" bölünmez;
 *   · virgülsüz dizi ("süt ekmek yumurta"): ancak alışveriş bağlamında, açık liste çerçevesiyle ve söz kısaysa;
 *   · kalemlerden biri liste/eylem sözü taşıyorsa ("üç maddelik bir liste oluştur") söz bir sayım değildir.
 */
export function spokenList(userText: string, context = ''): SpokenList | null {
  const folded = foldTr(userText);
  const around = `${foldTr(context)} ${folded}`;
  const shopping = SHOPPING.test(around);
  if (!shopping && !LIST_CONTEXT.test(around) && !userText.includes(':')) return null;
  // Soru, okuma ya da silme isteği ekleme değildir ("listede ne var", "listeyi oku").
  if (/\bne var\b|\boku\b|goster|\bsil\b|kaldir|tamamla|kac (madde|tane)/.test(folded) && !ADD_VERB.test(folded)) return null;
  const { body, framed } = cutFrame(userText);
  if (!body || words(body).length > 24) return null;
  const explicit = framed && ADD_VERB.test(folded);
  const accept = (items: string[], how: SpokenList['how']): SpokenList | null =>
    items.length >= 2 && items.length <= 15 && !items.some((item) => NOT_AN_ITEM.test(foldTr(item))) ? { items, how, explicit } : null;

  if (/[,;]/.test(body)) {
    const parts = body
      .split(/[,;]/)
      .flatMap((part) => {
        // Son parçadaki "ve" de ayırır: "süt, ekmek ve yumurta".
        const pieces = part.split(/\s+ve\s+/i);
        return pieces.length === 2 && pieces.every((piece) => words(piece).length <= 3) ? pieces : [part];
      })
      .map(cleanItem)
      .filter(Boolean);
    const sizes = parts.map((part) => words(part).length);
    // Alışveriş dışında parçalar birörnek olmalı: "Ankara, İstanbul ve İzmir bayilerini ara" (1, 1, 3 sözcük) tek iştir.
    const uniform = shopping ? sizes.every((size) => size <= 4) : sizes.every((size) => size <= 3) && Math.max(...sizes) - Math.min(...sizes) <= 1;
    return uniform ? accept(parts, 'comma') : null;
  }
  if (!shopping) return null;
  const pieces = body
    .split(/\s+ve\s+/i)
    .map(cleanItem)
    .filter(Boolean);
  if (pieces.length >= 2 && pieces.every((piece) => words(piece).length <= 3 && !/\bile\b/.test(foldTr(piece)))) {
    // "süt ekmek ve yumurta": "ve"nin solunda virgülsüz dizi varsa o da ayrılır.
    return accept(
      pieces.flatMap((piece) => (words(piece).length > 1 ? splitBare(piece) : [piece])),
      'and',
    );
  }
  if (!framed || words(body).length > 12) return null;
  return accept(splitBare(body), 'bare');
}

const sameItem = (a: string, b: string): boolean => {
  const x = foldTr(a).replace(/[^\p{L}\p{N}]+/gu, '');
  const y = foldTr(b).replace(/[^\p{L}\p{N}]+/gu, '');
  return x === y || (x.length >= 3 && y.length >= 3 && (x.includes(y) || y.includes(x)));
};

/**
 * Yerel modelin yapılacak ekleme çağrısını kullanıcının saydığı kalemlerle düzeltir (yerinde). Model tek maddeye
 * bütün listeyi yazdıysa ya da kalemleri birleştirdiyse/yanlış yazdıysa çağrı `todo_add_many` olur ve kalemler SÖZDEN
 * gelir; modelin verdiği son gün (`due_day`) korunur. Dönen değer: çağrı değiştirildi mi.
 */
export function applyListItems(call: { name: string; input: unknown }, list: SpokenList | null, log?: { debug(message: string): void }): boolean {
  if (!list || list.items.length < 2) return false;
  if (call.name !== 'todo_add' && call.name !== 'todo_add_many') return false;
  if (typeof call.input !== 'object' || call.input === null || Array.isArray(call.input)) return false;
  const input = call.input as Record<string, unknown>;
  const given: Array<Record<string, unknown>> =
    call.name === 'todo_add_many' && Array.isArray(input.items) ? (input.items as Array<Record<string, unknown>>) : call.name === 'todo_add' ? [input] : [];
  const texts = given.map((item) => String(item?.text ?? ''));
  // Model kalemleri zaten sözdeki gibi ayırdıysa dokunulmaz.
  const exact = texts.length === list.items.length && list.items.every((item) => texts.some((text) => foldTr(text).trim() === foldTr(item).trim()));
  if (exact) return false;
  const dueDay = given.map((item) => item?.due_day).find((value) => typeof value === 'string');
  const typos = texts.length === list.items.length && list.items.every((item) => texts.filter((text) => sameItem(text, item)).length === 1);
  log?.debug(`yapılacak çağrısı kullanıcının saydığı ${list.items.length} kalemle düzeltildi (${list.how}${typos ? ', yazım' : ''}): ${texts.join(' | ')}`);
  call.name = 'todo_add_many';
  call.input = { items: list.items.map((text) => ({ text, ...(typeof dueDay === 'string' ? { due_day: dueDay } : {}) })) };
  return true;
}
