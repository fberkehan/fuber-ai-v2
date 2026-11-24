// Gömülü tarayıcının adres kuralları (saf; birim testli `urls.test.ts`). Kaynak: v1 `src/shared/tarayici.ts` (adres çözme,
// indirme adı, tehlikeli uzantı, kullanıcı aracı) + v2 web modülünün SSRF korumaları (`modules/web/net.ts`).
//
// Kural: yalnız http(s) web adresleri açılır. `file:`, `chrome:`, `devtools:`, `javascript:`, `data:` ve uygulamanın kendi
// adresleri açılmaz. İç ağ (geri döngü, özel bloklar, yerel bağ, `localhost`, `.local`, tek etiketli ad) açılmaz: sayfa
// Jarvis'in eliyle modemin, yazıcının ya da bu bilgisayardaki servislerin (Fuber Yönetim'in kontrol servisi dahil)
// arayüzüne istek gönderemesin. Sınama yalnız `testing.jbrowserAllow` ile verilen adres:port'u açabilir.
import { checkUrl, FetchBlockedError, isPublicAddress } from '../web/net';

/** Aynı anda en çok bu kadar sekme. */
export const MAX_TABS = 8;
/** Arama adresi (adres değil sözcük yazılırsa). */
export const SEARCH_BASE = 'https://duckduckgo.com/?q=';

export type BlockReason = 'scheme' | 'credentials' | 'private' | 'host';

/** Kullanıcının ya da modelin yazdığı adres → açılacak adres. Şemasız alan adı https ile; sözcükler arama. Boşsa null. */
export function resolveAddress(input: string, searchBase = SEARCH_BASE): string | null {
  const text = input.trim();
  if (!text) return null;
  const search = () => `${searchBase}${encodeURIComponent(text)}`;
  const parse = (raw: string) => {
    try {
      const url = new URL(raw);
      return /^https?:$/.test(url.protocol) && url.hostname ? url.href : null;
    } catch {
      return null;
    }
  };
  if (/^https?:\/\//i.test(text)) return parse(text) ?? search();
  // Web dışı şema açıkça yazıldıysa (file:, javascript:, data:) adres DEĞİLDİR; aranmaz da: reddedilir.
  if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(text) && !/^[a-z0-9-]+(\.[a-z0-9-]+)+:\d/i.test(text)) return null;
  if (/\s/.test(text)) return search();
  const match = text.match(/^([^/?#:]+)(:\d{1,5})?([/?#].*)?$/);
  if (!match) return search();
  const host = match[1]!.toLowerCase();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host === 'localhost') return parse(`http://${text}`) ?? search();
  if (/^(?:[a-z0-9-]+\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/i.test(host)) return parse(`https://${text}`) ?? search();
  return search();
}

export interface AddressRules {
  /** Sınamada açılmasına izin verilen geri döngü adresleri (`host:port`). Üretimde boş. */
  allow?: readonly string[];
}

/** `host:port` biçimi (port yoksa şemanın varsayılanı). */
export function hostPort(url: URL): string {
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  return `${url.hostname.replace(/^\[|\]$/g, '').toLowerCase()}:${port}`;
}

/**
 * Bir isteğin adresi açılabilir mi (ad çözümlemesinden önce yapılabilen her şey). `null`: serbest; yoksa ret nedeni.
 * `about:blank` ve sayfanın kendi içindeki `blob:`/`data:` alt kaynakları serbesttir; ana çerçeve `data:` açılmaz.
 */
export function addressBlock(raw: string, options: { mainFrame: boolean; rules?: AddressRules }): BlockReason | null {
  if (raw === 'about:blank') return null;
  if (/^(blob|data):/i.test(raw)) return options.mainFrame ? 'scheme' : null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'scheme';
  }
  if (url.protocol === 'ws:' || url.protocol === 'wss:') url = new URL(raw.replace(/^ws/i, 'http'));
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'scheme';
  if (options.rules?.allow?.includes(hostPort(url))) return null;
  try {
    // Port kısıtı yok: herkese açık sitelerin başka portları açılabilir; iç ağ yine kapalıdır.
    checkUrl(url.href, isPublicAddress, () => true);
    return null;
  } catch (error) {
    if (error instanceof FetchBlockedError) return error.reason === 'credentials' ? 'credentials' : error.reason === 'private' ? 'private' : error.reason === 'scheme' ? 'scheme' : 'host';
    return 'host';
  }
}

/** Ad çözümlendikten sonra: adreslerden biri bile herkese açık değilse bağlantı kurulmaz (DNS ile iç ağa yönlendirme). */
export function resolvedAllowed(addresses: readonly string[]): boolean {
  return addresses.length > 0 && addresses.every((address) => isPublicAddress(address));
}

// ── İndirme ──

/** Çalıştırılabilir ya da kısayol dosyaları: Jarvis bunları HİÇBİR koşulda indirmez. */
const DANGEROUS = new Set([
  'exe', 'msi', 'msp', 'bat', 'cmd', 'com', 'scr', 'pif', 'ps1', 'psm1', 'psd1', 'vbs', 'vbe', 'js', 'jse', 'mjs', 'wsf', 'wsh', 'jar', 'lnk', 'url',
  'reg', 'hta', 'cpl', 'dll', 'sys', 'msix', 'msixbundle', 'appx', 'appxbundle', 'appinstaller', 'apk', 'dmg', 'pkg', 'sh', 'iso', 'img', 'vhd', 'vhdx',
  'chm', 'inf', 'scf', 'application', 'gadget', 'xll', 'xlam', 'docm', 'xlsm', 'pptm', 'ppam', 'library-ms', 'settingcontent-ms', 'diagcab', 'cab',
]);
export const dangerousDownload = (name: string): boolean => {
  const clean = name.trim().replace(/[.\s]+$/, '').toLowerCase();
  return clean.includes('.') && DANGEROUS.has(clean.split('.').pop() ?? '');
};

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** İndirilen dosyanın güvenli adı (v1 `indirmeDosyaAdi`): yol ayırıcı, yasak karakter, ayrılmış ad temizlenir; çakışmada " (2)". */
export function downloadFileName(raw: string | undefined, address: string, exists: (name: string) => boolean): string {
  let name = (raw ?? '').split(/[\\/]/).pop() ?? '';
  if (!name.trim()) {
    try {
      name = decodeURIComponent(new URL(address).pathname.split('/').filter(Boolean).pop() ?? '');
    } catch {
      name = '';
    }
  }
  name = [...name]
    .map((ch) => (ch.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(ch) ? '_' : ch))
    .join('')
    .replace(/^[.\s]+|[.\s]+$/g, '');
  if (!name) name = 'indirme';
  if (RESERVED.test(name)) name = `_${name}`;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 && name.length - dot <= 16 ? name.slice(dot) : '';
  let body = ext ? name.slice(0, dot) : name;
  if (body.length > 120) body = body.slice(0, 120);
  let candidate = `${body}${ext}`;
  for (let n = 2; exists(candidate) && n < 200; n++) candidate = `${body} (${n})${ext}`;
  return candidate;
}

/** Gömülü tarayıcının kullanıcı aracından Electron ve uygulama adı çıkarılır (siteler "güvenli olmayan tarayıcı" demesin). */
export function cleanUserAgent(ua: string): string {
  return ua
    .replace(/ (Electron|Fuber[\w -]*?)\/\S+/gi, '')
    .replace(/ fuber-ai-v?2\/\S+/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Adresin modele/karta gösterilen kısa biçimi: ana makine + yol; sorgu dizgesi ve parça YOK (sır olabilir). */
export function shortAddress(raw: string, max = 120): string {
  try {
    const url = new URL(raw);
    if (!/^https?:$/.test(url.protocol)) return '';
    const text = `${url.host}${url.pathname}`;
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  } catch {
    return '';
  }
}
