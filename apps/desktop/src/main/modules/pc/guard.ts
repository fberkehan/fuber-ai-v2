// Bilgisayar kullanımının güvenlik kuralları (saf işlevler; birim sınamalı). Karar burada, eylem `control.ts` içinde.
// Sözcük listeleri ve alan desenleri Fuber AI 1'in tarayıcı kurallarından alındı (form gönderimi algılama); orada
// yalnız gömülü tarayıcıya uygulanıyordu, burada bütün pencerelere uygulanır.
import { foldForSearch } from '@fuber/shared';
import type { WindowInfo } from './types';

const squash = (text: string): string => foldForSearch(text).replace(/\s+/g, ' ').trim();

// ───────────── hassas pencereler: okunmaz, içine yazılmaz, tıklanmaz ─────────────

export type SensitiveKind = 'password_manager' | 'bank' | 'credentials';

const PASSWORD_MANAGER_EXES = new Set([
  '1password', 'bitwarden', 'keepass', 'keepassxc', 'lastpass', 'dashlane', 'nordpass', 'protonpass', 'proton pass', 'enpass', 'roboform',
  'keeper', 'keeperpasswordmanager', 'keeweb', 'passwordsafe', 'pwsafe', 'stickypassword',
]);
/** Windows'un kimlik sorduğu yüzeyler (parola, PIN, yönetici onayı). */
const CREDENTIAL_EXES = new Set(['credentialuibroker', 'consent', 'logonui', 'lockapp', 'windowshello']);
const CREDENTIAL_CLASSES = new Set(['Credential Dialog Xaml Host']);

const PASSWORD_MANAGER_TITLE = /(^|[^a-z0-9])(1password|bitwarden|keepass(xc)?|lastpass|dashlane|nordpass|proton pass|enpass|roboform|sifre yoneticisi|parola yoneticisi|password manager)([^a-z0-9]|$)/;
const BANK_TITLE = new RegExp(
  '(^|[^a-z0-9])(' +
    [
      'bank', 'banka', 'bankasi', 'bankacilik', 'bankaciligi', 'banking', 'internet subesi',
      'garanti bbva', 'akbank', 'ziraat', 'isbank', 'yapi kredi', 'halkbank', 'vakifbank', 'denizbank', 'qnb', 'finansbank', 'teb',
      'kuveyt turk', 'albaraka', 'enpara', 'papara', 'odeabank', 'fibabanka', 'sekerbank', 'hsbc', 'paypal', 'revolut', 'wise\\.com',
      'binance', 'coinbase', 'metamask', 'btcturk', 'paribu', 'e-devlet', 'turkiye\\.gov\\.tr',
    ].join('|') +
    ')([^a-z0-9]|$)',
);

/** Pencere parola yöneticisi, banka ya da kimlik sorusu mu. Yanlış alarm ucuzdur (Jarvis o pencerede çalışmaz); kaçırmak pahalı. */
export function sensitiveWindow(window: Pick<WindowInfo, 'exe' | 'title' | 'className'>, url?: string | null): SensitiveKind | null {
  const exe = window.exe.toLowerCase();
  if (PASSWORD_MANAGER_EXES.has(exe)) return 'password_manager';
  if (CREDENTIAL_EXES.has(exe) || CREDENTIAL_CLASSES.has(window.className)) return 'credentials';
  const text = squash(`${window.title} ${url ?? ''}`);
  if (PASSWORD_MANAGER_TITLE.test(text)) return 'password_manager';
  if (BANK_TITLE.test(text)) return 'bank';
  return null;
}

// ───────────── hassas alanlar: yazılmaz ─────────────

const PASSWORD_FIELD = /parola|sifre|password|passwd|pwd|\bpin\b/;
const CARD_FIELD = /cvv|cvc|cc-|card.?(?:number|no|num)|cardnumber|credit.?card|kart.?(?:no|numara)|kredi.?kart|banka.?kart|\biban\b|security.?code|guvenlik.?kodu/;

/** Alanın adı parola ya da kart bilgisi mi istiyor. UI Automation'ın "parola alanı" bayrağını tamamlar (web formlarında bayrak her zaman gelmez). */
export function sensitiveField(name: string): 'password' | 'card' | null {
  const text = squash(name);
  if (!text) return null;
  if (CARD_FIELD.test(text)) return 'card';
  if (PASSWORD_FIELD.test(text)) return 'password';
  return null;
}

// ───────────── geri dönüşsüz eylemler: onay ister ─────────────

/** Düğme metninde geçerse onay istenen sözcükler (tr, en, de, fr): gönderme, ödeme, silme, kapatma, giriş. Sözcük sınırıyla eşleşir. */
export const IRREVERSIBLE_WORDS: readonly string[] = [
  // tr
  'gönder', 'satın al', 'satın alın', 'öde', 'ödeme', 'sipariş', 'giriş yap', 'oturum aç', 'kaydol', 'kayıt ol', 'üye ol', 'onayla', 'sil', 'yayınla', 'paylaş',
  'abone ol', 'rezervasyon yap', 'kapat', 'sekmeyi kapat', 'çıkış', 'çık', 'oturumu kapat', 'kaldır', 'sıfırla', 'kalıcı olarak sil', 'geri dönüşüm kutusunu boşalt',
  'kaydetme',
  // en
  'submit', 'send', 'buy', 'buy now', 'purchase', 'pay', 'payment', 'checkout', 'place order', 'order', 'sign in', 'log in', 'login', 'sign up', 'register', 'confirm',
  'delete', 'subscribe', 'publish', 'post', 'book now', 'close', 'close tab', 'exit', 'quit', 'sign out', 'log out', 'remove', 'uninstall', 'reset', 'discard',
  "don't save", 'empty recycle bin',
  // de
  'absenden', 'senden', 'kaufen', 'jetzt kaufen', 'bezahlen', 'zahlen', 'bestellen', 'zahlungspflichtig bestellen', 'anmelden', 'einloggen', 'registrieren',
  'bestätigen', 'löschen', 'abonnieren', 'schließen',
  // fr
  'envoyer', 'acheter', 'payer', 'commander', 'valider', 'confirmer', 'se connecter', 'connexion', "s'inscrire", 'supprimer', 'réserver', 'publier', 'fermer',
];

const simplify = (text: string): string =>
  squash(text)
    .replace(/[’‘`´]/g, "'")
    .normalize('NFD')
    .replace(/\p{M}/gu, '');

const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const IRREVERSIBLE = new RegExp(`(?:^|[^a-z0-9])(?:${IRREVERSIBLE_WORDS.map((word) => escapeRegex(simplify(word))).join('|')})(?=[^a-z0-9]|$)`);
/** İletişim kutusunda "evet/tamam" çoğu zaman geri dönüşsüz bir soruyu onaylar ("Silinsin mi?"). */
const AFFIRMATIVE = /^(evet|tamam|ok|yes|ja|oui|devam|continue|kabul et|accept|izin ver|allow|uygula|apply|calistir|run)$/;

/** Öğenin adı geri dönüşsüz bir eylemi mi söylüyor ("Gönder", "Sil", "Satın al", "Sekmeyi kapat"). */
export function irreversibleLabel(label: string): boolean {
  const text = simplify(label);
  return text.length > 0 && IRREVERSIBLE.test(text);
}

/** İletişim kutusundaki onay düğmesi mi. */
export function affirmativeLabel(label: string): boolean {
  return AFFIRMATIVE.test(simplify(label));
}

// ───────────── Enter'ın "gönder / öde / çalıştır" anlamına geldiği pencereler ─────────────

export type CommitRisk = 'send' | 'pay' | 'run' | 'confirm';

const TERMINAL_EXES = new Set([
  'windowsterminal', 'wt', 'cmd', 'powershell', 'pwsh', 'conhost', 'openconsole', 'alacritty', 'wezterm-gui', 'mintty', 'putty', 'kitty', 'hyper', 'tabby', 'warp',
]);
const MESSAGING_EXES = new Set([
  'whatsapp', 'whatsapp.root', 'telegram', 'slack', 'discord', 'teams', 'ms-teams', 'msteams', 'signal', 'outlook', 'olk', 'thunderbird', 'skype', 'zoom', 'viber', 'element',
  'hxoutlook', 'mailspring',
]);
const MESSAGING_TITLE = /(^|[^a-z0-9])(whatsapp|telegram|gmail|outlook|slack|discord|messenger|instagram|linkedin|teams|e-?posta|gelen kutusu|inbox|mail|x\.com|twitter)([^a-z0-9]|$)/;
const PAYMENT_TITLE = /(^|[^a-z0-9])(odeme|payment|checkout|sepet|sepetim|siparis|satin al|cart|kasa|order|fatura ode)([^a-z0-9]|$)/;
const RUN_DIALOG_TITLE = /^(calistir|run)$/;

/** Bu pencerede Enter'a basmak (ya da onay düğmesine tıklamak) ne anlama gelir; `null` = sıradan. */
export function commitRisk(window: Pick<WindowInfo, 'exe' | 'title' | 'className'>): CommitRisk | null {
  const exe = window.exe.toLowerCase();
  const title = squash(window.title);
  if (TERMINAL_EXES.has(exe)) return 'run';
  if (window.className === '#32770') return RUN_DIALOG_TITLE.test(title) ? 'run' : 'confirm';
  if (MESSAGING_EXES.has(exe) || MESSAGING_TITLE.test(title)) return 'send';
  if (PAYMENT_TITLE.test(title)) return 'pay';
  return null;
}

// ───────────── tarayıcılar ─────────────

export const BROWSER_EXES = new Set([
  'chrome', 'msedge', 'firefox', 'brave', 'opera', 'opera_gx', 'vivaldi', 'chromium', 'arc', 'browser', 'zen', 'librewolf', 'waterfox', 'thorium',
]);

export const isBrowser = (window: Pick<WindowInfo, 'exe'>): boolean => BROWSER_EXES.has(window.exe.toLowerCase());

/** Giriş sayfası gibi görünen başlık: alan türü okunamıyorsa oraya yazılmaz. */
export function looksLikeLogin(title: string): boolean {
  return /(^|[^a-z0-9])(giris|giris yap|oturum ac|login|log in|sign in|signin|sifre|parola|password|kimlik dogrula|verification|dogrulama kodu|2fa|otp)([^a-z0-9]|$)/.test(squash(title));
}
