// JARVIS MODE'u sesle açma/kapama: söz → niyet (hızlı yerel yol). Kesin olması gereken iş modele bırakılmaz
// (`local-commands.ts` ile aynı gerekçe); daha serbest söyleyişte `jarvis_mode` aracı modele sunulur.
//
// Kurallar:
//  - Söz KISADIR ve kalıba TAMAMEN uyar (çapa ^…$): "Jarvis modunu açtım" (asistanın kendi cümlesi, geçmiş zaman) ya da
//    "Jarvis modu nasıl çalışıyor" gibi sözler tetiklemez. Asistanın kendi sesi bu yola zaten girmez (yalnız kullanıcı
//    dökümü yönlendirilir; sesin mikrofona sızması ayrıca yankı süzgecinde elenir).
//  - Açma: "Jarvis moduna geç", "Jarvis modunu aç", "JARVIS modu", "Jarvis moduna gir"; İngilizce "Jarvis mode on",
//    "enter / open / activate Jarvis mode".
//  - Kapama: "Jarvis modunu kapat", "Jarvis modundan çık", "normal moda dön"; İngilizce "Jarvis mode off",
//    "exit / close / leave Jarvis mode", "back to normal mode".
import { foldTr } from './local-tools';

export type JarvisModeIntent = 'on' | 'off';

/** Söz başındaki dolgu sözcükleri ve uyandırma adı. */
const FILLER = /^(?:(?:hey|hi|ok|okay|tamam|peki|hadi|lutfen|ya|please) )+/;

const NAME = 'jarvis';
const MODE_TR = `${NAME} mod(?:u|a|una|unu|undan)?`;
const MODE_EN = `${NAME} mode`;
const POLITE = '(?: lutfen| please)?';

const ON_VERBS = '(?:ac|acar misin|acsana|acabilir misin|acalim|gec|gecer misin|gecsene|gecelim|gir|girer misin|girsene|girelim|baslat|baslatir misin|baslatsana|etkinlestir|devreye al|goster|ekrana getir|calistir)';
const OFF_VERBS = '(?:kapat|kapatir misin|kapatsana|kapatalim|bitir|bitirir misin|bitirsene|cik|cikar misin|cikalim|devre disi birak|iptal et|durdur|sonlandir)';

const ON_PATTERNS: readonly RegExp[] = [
  // "Jarvis moduna geç", "Jarvis modunu aç", "Jarvis modu" (yalın söz de açar)
  new RegExp(`^${MODE_TR}(?: ${ON_VERBS})?${POLITE}$`),
  // "Aç Jarvis modunu", "geç Jarvis moduna"
  new RegExp(`^${ON_VERBS} ${MODE_TR}${POLITE}$`),
  // İngilizce
  new RegExp(`^${MODE_EN}(?: on)?${POLITE}$`),
  new RegExp(`^(?:enter|start|open|activate|enable|launch|engage|go to|switch to) ${MODE_EN}${POLITE}$`),
  new RegExp(`^turn on ${MODE_EN}${POLITE}$`),
  new RegExp(`^turn ${MODE_EN} on${POLITE}$`),
];

const OFF_PATTERNS: readonly RegExp[] = [
  // "Jarvis modunu kapat", "Jarvis modundan çık"
  new RegExp(`^${MODE_TR} ${OFF_VERBS}${POLITE}$`),
  // "Kapat Jarvis modunu", "çık Jarvis modundan"
  new RegExp(`^${OFF_VERBS} ${MODE_TR}${POLITE}$`),
  // "Normal moda dön / geç"
  new RegExp(`^normal mod(?:a|u)? (?:don|donelim|doner misin|donsene|gec|gecelim|gecer misin)${POLITE}$`),
  // İngilizce
  new RegExp(`^${MODE_EN} off${POLITE}$`),
  new RegExp(`^(?:exit|leave|close|stop|end|quit|disable|deactivate|disengage) ${MODE_EN}${POLITE}$`),
  new RegExp(`^turn off ${MODE_EN}${POLITE}$`),
  new RegExp(`^turn ${MODE_EN} off${POLITE}$`),
  new RegExp(`^(?:back to|return to|go back to|switch to|go to) normal mode${POLITE}$`),
];

/** Sözün JARVIS MODE açma/kapama niyeti; emin değilse `null` (söz başka bir şeyse hiçbir şey yapılmaz). */
export function routeJarvisMode(text: string): JarvisModeIntent | null {
  let folded = foldTr(text)
    .replace(/[’'`´]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!folded || folded.split(' ').length > 8) return null;
  folded = folded.replace(FILLER, '');
  // "Jarvis, Jarvis modunu aç": baştaki uyandırma adı ikinci "jarvis"ten önce atılır.
  if (/^jarvis jarvis /.test(folded)) folded = folded.slice('jarvis '.length);
  if (ON_PATTERNS.some((pattern) => pattern.test(folded))) return 'on';
  if (OFF_PATTERNS.some((pattern) => pattern.test(folded))) return 'off';
  return null;
}
