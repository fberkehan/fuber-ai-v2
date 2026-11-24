// Yinelenen kayıt koruması (araç düzeyinde; modele güvenmeden). İlk denemelerde "bir daha konuşur musun?"
// sözünde model aynı hatırlatıcıyı üç kez kurdu: üç kopya hatırlatıcı, üç kopya hafıza kaydı. Aynı işi kısa süre içinde
// yeniden isteyen çağrı yeni kayıt açmaz; var olanı döndürür ("zaten kurulu").
import { foldForSearch, stemSet, type Reminder, type Todo } from '@fuber/shared';

/** İkinci çağrı bu süre içinde gelirse yineleme sayılabilir. Daha sonra gelen aynı istek kullanıcının bilinçli isteğidir. */
export const DUPLICATE_WINDOW_MS = 10 * 60_000;
/** "Aynı vakit": dakika duyarlığı. */
const SAME_TIME_MS = 60_000;
const DAY_MS = 86_400_000;

const normalize = (text: string) => foldForSearch(text).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Yazım farkı (büyük/küçük harf, Türkçe harf, noktalama) gözetilmeden aynı metin mi. */
export const sameText = (a: string, b: string): boolean => normalize(a) === normalize(b);

/**
 * İki kısa metin aynı işi mi anlatıyor: birebir aynı (yazım farkı gözetilmeden) ya da köklerinin en az yarısı ve en az
 * ikisi ortak ("Kaan'a önemli iş konusunu hatırlat" ~ "Kaan'a bugün önemli bir iş konusuyla uyarı"). Tek ortak
 * kök yetmez: "Kaan'ı ara" ile "Kaan'a mail at" ayrı işlerdir.
 */
export function sameTask(a: string, b: string): boolean {
  if (normalize(a) === normalize(b)) return true;
  const x = stemSet(a);
  const y = stemSet(b);
  let common = 0;
  for (const stem of x) if (y.has(stem)) common++;
  return common >= 2 && common / Math.min(x.size, y.size) >= 0.5;
}

export interface ReminderCandidate {
  text: string;
  /** Yeni hatırlatıcının çalma anı (ISO). */
  dueAt: string;
  /** Zaman göreli verildi ("10 dakika sonra"): aynı istek yinelenince çalma anı geçen süre kadar kayar. */
  relative: boolean;
  recurring: boolean;
}

/** Kısa süre önce kurulmuş, aynı işi aynı vakitte hatırlatan bekleyen hatırlatıcı; yoksa `null`. */
export function findDuplicateReminder(existing: readonly Reminder[], candidate: ReminderCandidate, now = Date.now()): Reminder | null {
  const due = Date.parse(candidate.dueAt);
  if (Number.isNaN(due)) return null;
  for (const reminder of existing) {
    if (reminder.status !== 'scheduled') continue;
    const age = now - Date.parse(reminder.createdAt);
    if (!(age >= 0 && age <= DUPLICATE_WINDOW_MS)) continue;
    if ((reminder.recurrence !== null) !== candidate.recurring) continue;
    const shift = due - Date.parse(reminder.dueAt);
    // Tekrarlı kayıtta ilk çalma anı bir sonraki döneme kaydırılmış olabilir: günün saati karşılaştırılır.
    const clockShift = Math.abs(((shift % DAY_MS) + DAY_MS) % DAY_MS);
    const sameTime = candidate.recurring
      ? Math.min(clockShift, DAY_MS - clockShift) <= SAME_TIME_MS
      : candidate.relative
        ? Math.abs(shift - age) <= SAME_TIME_MS
        : Math.abs(shift) <= SAME_TIME_MS;
    if (sameTime && sameTask(reminder.text, candidate.text)) return reminder;
  }
  return null;
}

/** Açık yapılacaklar arasında aynı metinli madde (yazım farkı gözetilmeden); yoksa `null`. */
export function findDuplicateTodo(open: readonly Todo[], text: string): Todo | null {
  const wanted = normalize(text);
  return open.find((todo) => !todo.done && normalize(todo.text) === wanted) ?? null;
}

/**
 * Yer tutucu madde: gerçek bir kalem yerine "madde 1", "Alışveriş listesi maddesi 2" ya da bütün listenin tek maddeye
 * numaralanarak yazılması ("Alışveriş listesi: 1. Muz, 2. Elma, 3. Süt"). Ölçüm (demo.3, yerel model): "üç maddelik bir
 * alışveriş listesi oluştur ve yapılacaklara ekle" sözünde üç denemenin üçünde maddeler böyle yazıldı. Böyle bir çağrı
 * listeye çöp yazar; araç geri çevirir ve modele ne yazması gerektiğini söyler.
 */
export function isPlaceholderItem(text: string): boolean {
  // Tek maddede numaralı birden çok kalem.
  if (/(^|[\s:(])1\s*[.)]\s*\S.*[\s,;]2\s*[.)]\s*\S/.test(text)) return true;
  const plain = normalize(cleanTodoItem(text));
  // İsteğin kendisi madde diye yazılmış ("Ofis taşınması için üç maddelik liste oluştur"): kalem değil, buyruktur.
  // Ölçüm (demo.3): bu sözde yerel model altı denemenin beşinde isteği madde olarak yazdı.
  if (/(^| )(maddelik|kalemlik) (\S+ ){0,3}liste/.test(plain)) return true;
  // Etiket ve numara atılınca geriye bir şey kalmıyorsa ya da kalan yalnız "madde 1", "Ürün 2", "madde" ise yer tutucudur.
  // Numarasız "kalem", "tükenmez kalem", "temizlik ürünleri" GERÇEK kalemdir: genel sözcük ancak numarayla yer tutucu sayılır.
  return (
    plain === '' ||
    /^(\d+ )?(\S+ ){0,2}(madde|kalem|oge|urun|item)\S* \d+$/.test(plain) ||
    /^(\d+ )?(madde|oge|item)\S*$/.test(plain) ||
    /^(liste\S*|alisveris liste\S*)$/.test(plain)
  );
}

/**
 * Maddenin başındaki liste etiketini ve sıra numarasını atar: "Alışveriş listesi: süt" → "süt", "1. Ekmek" → "Ekmek".
 * Küçük model kalemin başına listenin adını ya da numarasını yazabiliyor (demo.3 ölçümü); listede yalnız kalem durmalı.
 * Katlanmış metin özgün metinle aynı uzunluktadır: kesme konumu özgün yazımda da geçerlidir.
 */
export function cleanTodoItem(text: string): string {
  let out = text.trim();
  for (let pass = 0; pass < 3; pass++) {
    const folded = foldForSearch(out);
    const label = /^(?:(?:alisveris|market|pazar|yapilacak\p{L}*)\s+)?list\p{L}*\s*[:\-–—]\s*|^yapilacak\p{L}*\s*[:\-–—]\s*|^\d{1,2}\s*[.):\-–—]\s+|^[-*•]\s+/u.exec(folded);
    if (!label || label[0].length === 0) break;
    out = out.slice(label[0].length).trim();
  }
  return out;
}

/**
 * Yer tutucu maddeyle gelen çağrının geri çevrilme metni. Hem modele (ne yazması gerektiği) hem kullanıcıya (model
 * yeniden deneyemezse bu cümle söylenir) anlamlı olmalıdır.
 */
export const placeholderRefusal = (text: string): string =>
  `Maddeler eklenmedi: “${text}” bir kalemin adı değil. Her madde tek ve gerçek bir kalemin adı olmalı (örneğin süt, ekmek, yumurta); kalemleri belirleyip yeniden ekle.`;
