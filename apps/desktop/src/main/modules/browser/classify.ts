// Gömülü tarayıcının (Jarvis'in kendi tarayıcısı) saf sınıflama kuralları. Electron'a bağlı değil, birim testli
// (`classify.test.ts`; v1 `tests/form-gonderimi.test.ts` ve `tests/tarayici.test.ts` senaryoları taşındı).
//
// Kaynak: v1 `src/shared/form-gonderimi.ts` (5 düzeltme turu) ve `src/shared/tarayici.ts`; tanımlayıcılar İngilizceye
// çevrildi, kurallar aynen alındı. Proje kararı (v1): "Gezinme, okuma, arama ve taslak kendiliğinden; gönderme, silme,
// ödeme, form gönderme her zaman onay ister." Gönderim modelin BEYANINA göre değil, sayfadan OKUNAN öğe bilgisine göre
// algılanır. Bu algılama ilk kapıdır; kaçırdığı her şeyi ağ kalkanı (`shield.ts`) yakalar.
//
// Sayfa içi yoklama (`page.ts`) `formMethod` ve `isPaymentFrame` işlevlerini `toString()` ile sayfaya götürür: ikisi de
// KENDİ İÇİNDE bağımsız olmalı (dış değişkene dokunmaz; testte `new Function` ile ayrıca sınanır).

/**
 * Tıklanan/odaktaki öğenin sayfadan okunan bilgisi. `type`: "etiket[:tür]" ("button:submit", "button" = tipsiz,
 * "input:text", "a", "button:role" = role=button olan başka öğe, "contenteditable").
 */
export interface ElementInfo {
  label: string;
  type: string;
  inForm: boolean;
  formMethod: 'get' | 'post' | null;
  text: string;
  passwordForm: boolean;
  cardForm: boolean;
}

/** Onay kartı için formun özeti. Parola ve kart alanlarının değeri HİÇ okunmaz. */
export interface FormSummary {
  action: string;
  method: 'get' | 'post' | null;
  fields: Array<{ name: string; kind?: SensitiveKind; filled: boolean; value?: string }>;
  hidden: number;
}

export type SensitiveKind = 'password' | 'card';

/** Parola ve kart alanı desenleri: ad, kimlik, yer tutucu, etiket ve autocomplete değerine uygulanır. */
export const PASSWORD_FIELD_PATTERN = /parola|[sş]ifre|password|passwd|pwd|passcode|\bpin\b|\botp\b|one.?time.?(?:code|password)|tek kullanımlık|doğrulama kodu|dogrulama kodu|sms kodu/i;
export const CARD_FIELD_PATTERN =
  /cvv|cvc|cc-|card.?(?:number|no|num)|cardnumber|credit.?card|kart.?(?:no|numara)|kredi.?kart|banka.?kart|\biban\b|security.?code|güvenlik.?kodu|guvenlik.?kodu|son kullanma|expir/i;

/** Alan parola mı kart mı: yazma yasağı ve form sınıflaması. Sayfa içi yoklama aynı desenlerle aynı sonucu verir. */
export function sensitiveFieldKind(field: { type: string; name?: string; autocomplete?: string }): SensitiveKind | null {
  const autocomplete = (field.autocomplete ?? '').toLowerCase();
  const name = field.name ?? '';
  if (String(field.type ?? '').toLowerCase() === 'input:password' || /password|one-time-code/.test(autocomplete)) return 'password';
  if (/^cc-|card/.test(autocomplete) || CARD_FIELD_PATTERN.test(name)) return 'card';
  if (PASSWORD_FIELD_PATTERN.test(name)) return 'password';
  return null;
}

// ── Geri dönüşsüz sözcükler ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Düğme metninde geçerse düğme gönderim sayılan sözcükler (tr, en, de, fr). Sözcük sınırıyla eşleşir ("silinen" ≠ "sil");
 * aksansız yazım da yakalanır. v1 listesine v2'de hesap değişikliği ve para gönderme sözcükleri eklendi.
 */
export const IRREVERSIBLE_WORDS: readonly string[] = [
  // tr
  'gönder', 'satın al', 'satın alın', 'öde', 'ödeme', 'sipariş', 'giriş yap', 'oturum aç', 'kaydol', 'kayıt ol', 'üye ol', 'onayla', 'sil', 'yayınla',
  'paylaş', 'abone ol', 'rezervasyon yap', 'kaydet', 'güncelle', 'değişiklikleri kaydet', 'şifre değiştir', 'şifreyi değiştir', 'parolayı değiştir',
  'hesabı kapat', 'hesabı sil', 'aboneliği iptal', 'abonelikten çık', 'iptal et', 'havale', 'eft', 'para gönder', 'transfer', 'başvur', 'tamamla',
  // en
  'submit', 'send', 'buy', 'buy now', 'purchase', 'pay', 'payment', 'checkout', 'place order', 'order', 'sign in', 'log in', 'login', 'sign up',
  'register', 'confirm', 'delete', 'remove', 'subscribe', 'unsubscribe', 'publish', 'post', 'book now', 'save', 'save changes', 'update',
  'change password', 'close account', 'apply', 'transfer', 'complete',
  // de
  'absenden', 'senden', 'kaufen', 'jetzt kaufen', 'bezahlen', 'zahlen', 'bestellen', 'zahlungspflichtig bestellen', 'anmelden', 'einloggen',
  'registrieren', 'bestätigen', 'löschen', 'abonnieren', 'speichern',
  // fr
  'envoyer', 'acheter', 'payer', 'commander', 'valider', 'confirmer', 'se connecter', 'connexion', "s'inscrire", 'supprimer', 'réserver', 'publier',
  'enregistrer',
];

/** Küçük harf (Türkçe), aksansız, tek boşluk: "GİRİŞ YAP" ve "giris yap" aynı. */
function simplify(text: string): string {
  return text
    .toLocaleLowerCase('tr-TR')
    .replace(/[’‘`´]/g, "'")
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i')
    .replace(/\s+/g, ' ')
    .trim();
}
const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const WORD_PATTERN = new RegExp(`(?:^|[^a-z0-9])(?:${IRREVERSIBLE_WORDS.map((word) => escapeRe(simplify(word))).join('|')})(?=[^a-z0-9]|$)`);

/** Metin geri dönüşsüz bir eylem sözcüğü taşıyor mu. */
export function isIrreversible(text: string): boolean {
  const simple = simplify(text ?? '');
  return Boolean(simple) && WORD_PATTERN.test(simple);
}

// ── Öğe sınıflaması ve gönderim kararı ─────────────────────────────────────────────────────────────────────────────

interface Kind {
  tag: string;
  sub: string;
}
const kindOf = (type: string): Kind => {
  const [tag = '', sub = ''] = String(type ?? '').toLowerCase().split(':');
  return { tag, sub };
};
const isLink = (kind: Kind) => kind.tag === 'a' || kind.tag === 'area';
const isButton = (kind: Kind) => kind.tag === 'button' || (kind.tag === 'input' && ['submit', 'button', 'image', 'reset'].includes(kind.sub));
/** Form içinde göndere basılırsa formu gönderen düğme: tipsiz/`submit` button, `submit`/`image` input (`button:role` ve `button:button` değil). */
const isSubmitButton = (kind: Kind) => (kind.tag === 'button' && (kind.sub === '' || kind.sub === 'submit')) || (kind.tag === 'input' && (kind.sub === 'submit' || kind.sub === 'image'));

/**
 * Formun yöntemi. YALNIZ açıkça `method`/`formmethod` = get ya da `role=search` GET sayılır (arama). Yöntemi yazılmamış
 * form (`action`'ı olsa da: aşamalı geliştirilmiş formlar `onsubmit` ile fetch POST yapar), `method="dialog"` ve bilinmeyen
 * değer `null` = bilinmiyor → güvenli tarafta gönderim. Sayfa içi yoklama `toString()` ile kullanır (bağımsız kalmalı).
 */
export function formMethod(method: string | null | undefined, formmethod: string | null | undefined, role: string | null | undefined): 'get' | 'post' | null {
  const value = String(formmethod || method || '').trim().toLowerCase();
  if (value === 'post') return 'post';
  if (value === 'get') return 'get';
  if (String(role || '').trim().toLowerCase() === 'search') return 'get';
  return null;
}

/**
 * Bu iframe bir ödeme/kart çerçevesi mi (içindeki kart alanları ayrı kökenden görünmez): sağlayıcı kökeni (stripe, adyen,
 * braintree, paypal, checkout.com, iyzico, paytr) ya da adı/başlığında card, kart, payment, ödeme geçer. Bağımsız kalmalı.
 */
export function isPaymentFrame(src: string | null | undefined, name: string | null | undefined, title: string | null | undefined): boolean {
  let host = '';
  try {
    host = new URL(String(src || ''), 'http://x.invalid/').hostname;
  } catch {
    host = '';
  }
  if (/stripe|adyen|braintree|paypal|checkout\.com|iyzico|iyzipay|paytr/i.test(host)) return true;
  return /card|kart|payment|ödeme|odeme/i.test(`${name || ''} ${title || ''}`);
}

export type ElementAction = 'click' | 'enter';

/**
 * Bu eylem geri dönüşsüz bir gönderim mi (onay gerekir)?
 *  - `click`: bağlantı ve düğme için ADI (metin/etiket) gönderme-silme-satın alma sözcüğü taşıyorsa; düğme parola/kart
 *    formunda her zaman; form içinde gönder düğmesi (açık GET arama formu hariç: yalnız sözcük taşıyorsa).
 *  - `enter`: her zaman gönderim (textarea, contenteditable ve formsuz kutu dahil); tek istisna açık GET formu (arama) ve
 *    parola/kart yoksa. Odaktaki düğme/bağlantıda Enter, tıklama gibi değerlendirilir.
 */
export function isSubmission(element: ElementInfo, action: ElementAction): boolean {
  const kind = kindOf(element.type);
  const sensitive = element.passwordForm || element.cardForm;
  const word = isIrreversible(element.text) || isIrreversible(element.label);
  if (action === 'enter') {
    if (isLink(kind)) return word;
    if (isButton(kind)) return isSubmission(element, 'click');
    if (sensitive) return true;
    return !(element.inForm && element.formMethod === 'get');
  }
  if (isLink(kind)) return word;
  if (!isButton(kind)) return false;
  if (sensitive) return true;
  if (element.inForm && isSubmitButton(kind)) return element.formMethod === 'get' ? word : true;
  return word;
}

// ── Tuşlar (v1 `tusAyristir`) ───────────────────────────────────────────────────────────────────────────────────────

export type Modifier = 'control' | 'shift' | 'alt' | 'meta';

/** Bir tuş basışı. `keyCode`: Electron `sendInputEvent` adı. */
export interface KeyStep {
  name: string;
  keyCode: string;
  modifiers: Modifier[];
  /** Metin olarak yazılan karakter (Ctrl/Alt/Meta yokken tek karakter ve boşluk). */
  char?: string;
  enter: boolean;
  space: boolean;
  /** Odaktaki alana metin yazar mı (parola/kart alanında yasak). */
  printable: boolean;
  /** Yapıştırma (Ctrl/Meta+V, Shift+Insert): parola/kart alanında yasak. */
  paste: boolean;
}
export const MAX_KEYS = 10;

const KEY_NAMES: Record<string, string> = {
  enter: 'Return', return: 'Return', esc: 'Escape', escape: 'Escape', tab: 'Tab', space: 'Space', bosluk: 'Space', backspace: 'Backspace',
  delete: 'Delete', del: 'Delete', insert: 'Insert', up: 'Up', arrowup: 'Up', down: 'Down', arrowdown: 'Down', left: 'Left', arrowleft: 'Left',
  right: 'Right', arrowright: 'Right', home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown', plus: 'Plus',
};
const MODIFIERS: Record<string, Modifier> = {
  ctrl: 'control', control: 'control', shift: 'shift', alt: 'alt', option: 'alt', meta: 'meta', cmd: 'meta', command: 'meta', win: 'meta', super: 'meta',
};

/** "Ctrl+A", "Escape", "Tab Tab Enter" → tuş basışları (boşlukla ayrılan en çok 10 adım). Tanınmayan tuş: hata. */
export function parseKeys(keys: unknown): { steps: KeyStep[] } | { error: string } {
  if (typeof keys !== 'string' || !keys.trim()) return { error: 'Tuş boş. Örnek: "Escape", "Tab Tab Enter", "Ctrl+A".' };
  const parts = keys.trim().split(/\s+/);
  if (parts.length > MAX_KEYS) return { error: `Bir çağrıda en çok ${MAX_KEYS} tuş basılır.` };
  const steps: KeyStep[] = [];
  for (const raw of parts) {
    const pieces = raw.replace(/\+\+$/, '+Plus').split('+').filter(Boolean);
    if (!pieces.length) return { error: `Tuş okunamadı: ${raw}` };
    const main = pieces[pieces.length - 1]!;
    const modifiers: Modifier[] = [];
    for (const piece of pieces.slice(0, -1)) {
      const modifier = MODIFIERS[piece.toLowerCase()];
      if (!modifier) return { error: `Bilinmeyen değiştirici tuş: ${piece} (Ctrl, Shift, Alt kullan).` };
      if (!modifiers.includes(modifier)) modifiers.push(modifier);
    }
    const lower = main.toLowerCase();
    if (MODIFIERS[lower]) return { error: `Yalnız değiştirici tuş basılamaz: ${raw}` };
    let keyCode: string;
    if (KEY_NAMES[lower]) keyCode = KEY_NAMES[lower]!;
    else if (/^f([1-9]|1[0-2])$/.test(lower)) keyCode = lower.toUpperCase();
    else if (/^[a-z0-9]$/.test(lower)) keyCode = lower.toUpperCase();
    else return { error: `Bilinmeyen tuş: ${main}. Örnekler: Enter, Escape, Tab, Space, Backspace, ArrowDown, PageDown, Ctrl+A.` };
    const shiftOnly = modifiers.every((modifier) => modifier === 'shift');
    let char: string | undefined;
    if (keyCode === 'Space' && shiftOnly) char = ' ';
    else if (/^[A-Z0-9]$/.test(keyCode) && shiftOnly) char = modifiers.includes('shift') ? keyCode : keyCode.toLowerCase();
    const ctrlMeta = modifiers.includes('control') || modifiers.includes('meta');
    steps.push({
      name: raw,
      keyCode,
      modifiers,
      ...(char !== undefined ? { char } : {}),
      enter: keyCode === 'Return',
      space: keyCode === 'Space',
      printable: char !== undefined,
      paste: (keyCode === 'V' && ctrlMeta) || (keyCode === 'Insert' && modifiers.includes('shift')),
    });
  }
  return { steps };
}

/** Parola/kart alanı odaktayken metin yazan ya da yapıştıran tuş yasak (Enter, Tab, Escape, ok tuşları serbest). */
export function keyForbidden(step: KeyStep, focusKind: SensitiveKind | null): boolean {
  return focusKind !== null && (step.printable || step.paste);
}

/** Tek bir tuş basışı gönderim mi: Ctrl/Meta+Enter her zaman; Enter odaktaki öğeye göre; Boşluk odaktaki düğmeye. */
export function keySubmits(step: KeyStep, focus: ElementInfo | null): boolean {
  if (step.enter && (step.modifiers.includes('control') || step.modifiers.includes('meta'))) return true;
  if (!focus) return false;
  if (step.enter && step.modifiers.every((modifier) => modifier === 'shift')) return isSubmission(focus, 'enter');
  if (step.space && step.modifiers.length === 0) return isButton(kindOf(focus.type)) && isSubmission(focus, 'click');
  return false;
}

/**
 * Yasak kısayollar: tarayıcının kendisini (yazdır, kaydet, geliştirici araçları, adres çubuğu) ya da işletim sistemini
 * işleten tuşlar. Gömülü tarayıcıda bunların işi araçlardır (jbrowser_open, jbrowser_back); tuşla yapılmaz.
 */
export function keyBlocked(step: KeyStep): boolean {
  const ctrl = step.modifiers.includes('control') || step.modifiers.includes('meta');
  if (step.modifiers.includes('meta') && !step.modifiers.includes('control')) return true;
  if (step.modifiers.includes('alt') && ['F4', 'Left', 'Right', 'Home'].includes(step.keyCode)) return true;
  if (ctrl && ['P', 'S', 'O', 'U', 'J', 'L', 'N', 'T', 'W', 'H', 'D', 'R'].includes(step.keyCode)) return true;
  if (['F5', 'F6', 'F11', 'F12'].includes(step.keyCode)) return true;
  if (ctrl && step.modifiers.includes('shift') && ['I', 'C', 'Delete'].includes(step.keyCode)) return true;
  return false;
}
