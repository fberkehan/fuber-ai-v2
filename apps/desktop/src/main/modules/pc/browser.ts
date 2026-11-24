// Kullanıcının KENDİ tarayıcısı: sekmeleri görme, etkin sayfayı okuma, yeni sekmede adres/arama açma.
// v1'de bu yoktu (ayrı profilli gömülü tarayıcı vardı; kullanıcının Chrome'u yalnız eklentiyle görülüyordu).
// Burada sekmeler UI Automation ile okunur: eklenti, yeniden başlatma ya da hata ayıklama bayrağı gerekmez.
// Açma her zaman YENİ sekmedir ve tarayıcının kendi komut satırıyla yapılır: açık sekmeye tuş gönderilmez,
// hiçbir sekme kapatılmaz ya da üstüne yazılmaz.
import { t, type ToolResult } from '@fuber/shared';
import { sensitiveWindow } from './guard';
import { clip, frontBrowser, normalizeUrl, tidyText, untrusted } from './read';
import type { BrowserWindowInfo, UiaProvider, WindowInfo } from './types';

const MAX_TABS_PER_WINDOW = 25;
const FIREFOX_FAMILY = new Set(['firefox', 'librewolf', 'waterfox', 'zen']);
export const SEARCH_URL = 'https://www.google.com/search?q=';

/** Etkin sekme: tarayıcı bildirdiyse o; bildirmediyse pencere başlığı sekme adıyla başlayan. */
export function activeTab(window: BrowserWindowInfo): { title: string; index: number } | null {
  let index = window.tabs.findIndex((tab) => tab.active);
  if (index < 0) index = window.tabs.findIndex((tab) => tab.title.length > 2 && window.title.startsWith(tab.title.slice(0, 40)));
  const tab = window.tabs[index];
  return tab ? { title: tab.title, index } : null;
}

export function tabsResult(browsers: BrowserWindowInfo[]): ToolResult {
  const windows = browsers.filter((window) => window.tabs.length > 0);
  if (windows.length === 0) return { ok: false, text: browsers.length > 0 ? t('pc.tabs.unreadable') : t('pc.tabs.none') };
  const lines: string[] = [];
  for (const window of windows) {
    const active = activeTab(window);
    lines.push(t('pc.tabs.window', { app: window.app, count: window.tabs.length, focused: window.focused ? t('pc.tabs.focused') : '' }));
    // Etkin sekme her zaman listede kalır; fazlası sayı olarak bildirilir.
    const shown = window.tabs
      .map((tab, index) => ({ tab, index }))
      .filter(({ index }) => index < MAX_TABS_PER_WINDOW || index === active?.index)
      .slice(0, MAX_TABS_PER_WINDOW + 1);
    for (const { tab, index } of shown) lines.push(`  ${index + 1}. ${clip(tab.title, 80)}${index === active?.index ? ` (${t('pc.tabs.active')})` : ''}`);
    if (window.tabs.length > shown.length) lines.push(`  ${t('pc.tabs.more', { count: window.tabs.length - shown.length })}`);
    const url = normalizeUrl(window.url);
    if (url) lines.push(`  ${t('pc.tabs.url', { url: clip(url, 200) })}`);
  }
  return {
    ok: true,
    text: untrusted(lines.join('\n')),
    data: {
      untrusted: true,
      windows: windows.map((window) => ({ app: window.app, tabs: window.tabs.length, focused: window.focused, active: activeTab(window)?.title ?? null, url: normalizeUrl(window.url) })),
    },
  };
}

export interface PageRead {
  result: ToolResult;
  /** Sayfa metni tarayıcıdan okunamadıysa web okuma aracına devredilecek adres. */
  fallbackUrl: string | null;
}

/** En üstteki tarayıcının etkin sekmesini okur. Chromium sayfa ağacını ilk sorudan sonra kurduğu için kısa aralıkla yeniden dener. */
export async function readActivePage(uia: UiaProvider, sleep: (ms: number) => Promise<void>, maxChars: number): Promise<PageRead> {
  const browsers = await uia.browsers();
  const front = frontBrowser(browsers);
  if (!front) return { result: { ok: false, text: t('pc.browser.none') }, fallbackUrl: null };
  const url = normalizeUrl(front.url);
  const sensitive = sensitiveWindow(front, url);
  if (sensitive) return { result: { ok: false, text: t('pc.fail.sensitive', { detail: t(`pc.sensitive.${sensitive}`) }) }, fallbackUrl: null };
  const title = activeTab(front)?.title ?? front.title;
  let text = '';
  let truncated = false;
  let method = 'none';
  for (let attempt = 0; attempt < 3 && !front.minimized; attempt++) {
    if (attempt > 0) await sleep(350);
    try {
      const document = await uia.document(front.hwnd, { maxChars });
      const tidy = tidyText(document.text, maxChars);
      if (tidy.text.length >= 40) {
        text = tidy.text;
        truncated = document.truncated || tidy.truncated;
        method = document.method;
        break;
      }
    } catch {
      // yardımcı yanıt vermedi: bir kez daha denenir, sonra adres üzerinden okumaya düşülür
    }
  }
  if (!text) return { result: { ok: false, text: t('pc.browser.unreadable') }, fallbackUrl: url };
  const header = [t('pc.browser.header', { title: clip(title, 120) }), ...(url ? [t('pc.browser.address', { url: clip(url, 200) })] : [])].join('\n');
  return {
    result: {
      ok: true,
      text: untrusted(`${header}\n\n${text}${truncated ? `\n${t('pc.read.truncated')}` : ''}`),
      data: { untrusted: true, url, title, method, truncated, chars: text.length },
    },
    fallbackUrl: url,
  };
}

/** Arama metni ya da adres → açılacak http(s) adresi. Adres değilse `null`. */
export function toHttpUrl(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  try {
    const url = new URL(text.includes('://') ? text : `https://${text}`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

export const searchUrl = (query: string): string => `${SEARCH_URL}${encodeURIComponent(query.trim())}`;

/** Tarayıcının komut satırı: var olan pencerede YENİ sekme açar (adres tek başına bir bağımsız değişkendir, anahtar olamaz). */
export function newTabArgs(browser: Pick<WindowInfo, 'exe'>, url: string): string[] {
  return FIREFOX_FAMILY.has(browser.exe.toLowerCase()) ? ['-new-tab', url] : [url];
}

export interface OpenDeps {
  uia?: UiaProvider;
  launchExe(file: string, args?: string[]): Promise<{ ok: boolean; error: string | null }>;
  openExternal(url: string): Promise<void>;
  sleep(ms: number): Promise<void>;
}

export interface OpenOutcome {
  ok: boolean;
  /** Açılan tarayıcının adı; varsayılan tarayıcıya düşüldüyse `null`. */
  app: string | null;
  verified: boolean | null;
  error: string | null;
}

/**
 * Adresi kullanıcının şu an kullandığı tarayıcıda (en üstteki tarayıcı penceresi) yeni sekmede açar; açık tarayıcı
 * yoksa varsayılan tarayıcıda. Sonra adres çubuğundan doğrular (okunabiliyorsa).
 */
export async function openInBrowser(deps: OpenDeps, url: string, verifyNeedle: string): Promise<OpenOutcome> {
  let browser: WindowInfo | null = null;
  if (deps.uia) {
    try {
      browser = frontBrowser((await deps.uia.windows()).windows.filter((window) => window.path));
    } catch {
      browser = null;
    }
  }
  try {
    if (browser) {
      const launched = await deps.launchExe(browser.path, newTabArgs(browser, url));
      if (!launched.ok) return { ok: false, app: browser.app, verified: null, error: launched.error };
    } else {
      await deps.openExternal(url);
    }
  } catch (error) {
    return { ok: false, app: browser?.app ?? null, verified: null, error: error instanceof Error ? error.message : String(error) };
  }
  let verified: boolean | null = null;
  if (deps.uia) {
    const needle = verifyNeedle.toLowerCase();
    for (let attempt = 0; attempt < 4 && verified !== true; attempt++) {
      await deps.sleep(600);
      try {
        const windows = await deps.uia.browsers();
        const hit = windows.some((window) => (window.url ?? '').toLowerCase().includes(needle) || (activeTab(window)?.title ?? '').toLowerCase().includes(needle));
        verified = hit ? true : windows.length > 0 ? false : null;
      } catch {
        verified = null;
      }
    }
  }
  return { ok: true, app: browser?.app ?? null, verified, error: null };
}
