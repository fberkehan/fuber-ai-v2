// Okunan pencere/ağaç verisini modele gidecek kısa, yapısı korunmuş metne çevirir ve söylenen adı pencereyle
// eşleştirir (saf işlevler). Ekrandan gelen her metin GÜVENİLMEZ veridir: `untrusted` ile çerçevelenir.
import { t } from '@fuber/shared';
import { rankCandidates } from '../projects/match';
import { isBrowser } from './guard';
import type { UiaNode, WindowInfo, WindowList } from './types';

/** Sık kullanılan uygulamaların söylenen adları (süreç adına göre). */
const SPOKEN_NAMES: Record<string, string[]> = {
  chrome: ['krom', 'google chrome', 'tarayıcı', 'browser'],
  msedge: ['edge', 'microsoft edge', 'tarayıcı', 'browser'],
  firefox: ['firefox', 'tarayıcı', 'browser'],
  brave: ['brave', 'tarayıcı', 'browser'],
  opera: ['opera', 'tarayıcı', 'browser'],
  notepad: ['not defteri', 'notepad'],
  explorer: ['dosya gezgini', 'gezgin', 'klasör', 'dosyalar'],
  calculatorapp: ['hesap makinesi', 'calculator'],
  windowsterminal: ['terminal', 'komut satırı', 'konsol'],
  cmd: ['komut istemi', 'komut satırı'],
  code: ['vs code', 'visual studio code', 'kod editörü'],
  winword: ['word'],
  excel: ['excel'],
  powerpnt: ['powerpoint', 'sunum'],
  systemsettings: ['ayarlar', 'settings'],
  spotify: ['spotify', 'müzik'],
  whatsapp: ['whatsapp'],
  'whatsapp.root': ['whatsapp'],
};

/** Sorguda anlam taşımayan sözcükler. */
const FILLER = /(^|\s)(pencere(si|sini|sine|yi)?|uygulama(sı|sını|sına)?|program(ı|ını)?|window|app|sekme(si|sini)?)(?=\s|$)/giu;

/**
 * Söylenen adı ("chrome", "not defteri", "atlas paneli") pencereyle eşleştirir. Birden çok pencere uyarsa en üstteki
 * (en son kullanılan) seçilir: aynı uygulamanın iki penceresinde kullanıcının baktığı odur. Sayı verilirse pencere kimliğidir.
 */
export function matchWindow(query: string, list: WindowInfo[]): WindowInfo | null {
  const trimmed = query.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) return list.find((window) => window.hwnd === Number(trimmed)) ?? null;
  const cleaned = trimmed.replace(FILLER, ' ').trim() || trimmed;
  const ranked = rankCandidates(
    cleaned,
    list.map((window, index) => ({
      item: window,
      names: [window.app, window.exe, ...(SPOKEN_NAMES[window.exe] ?? []), window.title],
      // z-sırası: eşit puanda üstteki pencere.
      recency: 1 - index / Math.max(1, list.length),
    })),
  );
  return ranked[0]?.item ?? null;
}

/** Ad verilmediğinde üzerinde çalışılacak pencere: öndeki; o bizim pencerimizse ya da kabuksa en üstteki başka pencere. */
export function defaultTarget(list: WindowList): WindowInfo | null {
  const front = list.foreground;
  if (front && !front.own && !front.shell) return front;
  return list.windows.find((window) => !window.own && !window.minimized) ?? null;
}

/** Tarayıcı pencerelerinden en üstteki (kullanıcının son baktığı). */
export function frontBrowser<T extends WindowInfo>(list: T[]): T | null {
  return list.find((window) => isBrowser(window) && !window.minimized) ?? list.find((window) => isBrowser(window)) ?? null;
}

export function describeWindow(window: WindowInfo): string {
  const marks = [window.focused ? t('pc.window.focused') : '', window.minimized ? t('pc.window.minimized') : '', window.own ? t('pc.window.own') : ''].filter(Boolean);
  const title = clip(window.title, 90);
  return `${title} [${window.app}]${marks.length ? ` (${marks.join(', ')})` : ''}`;
}

export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Ekrandan/sayfadan okunan metni çerçeveler: içindeki "şunu yap" cümleleri komut değildir (istem enjeksiyonu). */
export function untrusted(text: string): string {
  return `${t('pc.untrusted.begin')}\n${text.trim()}\n${t('pc.untrusted.end')}`;
}

const ROLE_LABEL: Record<string, string> = {
  Button: 'düğme',
  SplitButton: 'düğme',
  Edit: 'alan',
  Hyperlink: 'bağlantı',
  CheckBox: 'onay kutusu',
  RadioButton: 'seçenek',
  ComboBox: 'açılır liste',
  TabItem: 'sekme',
  MenuItem: 'menü',
  ListItem: 'öğe',
  TreeItem: 'öğe',
  DataItem: 'satır',
  HeaderItem: 'sütun',
  Document: 'belge',
  Image: 'görsel',
  Slider: 'kaydırıcı',
  Spinner: 'sayı alanı',
  ProgressBar: 'ilerleme',
};

/** Adı olmadan satır üretmeyen yapısal türler (adı varsa bölüm başlığı olur). */
const STRUCTURAL = new Set(['Window', 'Pane', 'Group', 'Custom', 'List', 'Tree', 'Tab', 'ToolBar', 'MenuBar', 'Menu', 'StatusBar', 'Table', 'DataGrid', 'Header', 'Calendar']);
const DROPPED = new Set(['Separator', 'Thumb', 'ScrollBar', 'TitleBar', 'ToolTip']);
const MAX_INDENT = 6;

function flagText(flags: string | undefined): string {
  if (!flags) return '';
  const parts = [flags.includes('*') ? 'odakta' : '', flags.includes('s') ? 'seçili' : '', flags.includes('c') ? 'işaretli' : '', flags.includes('x') ? 'devre dışı' : ''].filter(Boolean);
  return parts.length ? ` (${parts.join(', ')})` : '';
}

/**
 * Erişilebilirlik ağacını girintili özet metne çevirir: yapı (bölüm → öğe) korunur, adsız kutular atlanır,
 * yinelenen satırlar tek kalır. `maxChars` aşılırsa kesilir ve `truncated` döner.
 */
export function outline(nodes: UiaNode[], maxChars: number): { text: string; truncated: boolean; lines: number } {
  const lines: string[] = [];
  // Düğümün derinliği → satır üreten atalarının sayısı (adsız kutular girinti yapmaz).
  const indentAt: number[] = [];
  let length = 0;
  let previous = '';
  let truncated = false;
  for (const node of nodes) {
    if (DROPPED.has(node.role)) continue;
    const parentIndent = node.depth > 0 ? (indentAt[node.depth - 1] ?? 0) : 0;
    indentAt.length = node.depth;
    const name = clip(node.name, 300);
    let line = '';
    if (node.password) line = `[parola alanı] ${name}`.trimEnd() + ' (değeri gizli)';
    else if (node.role === 'Text') line = name;
    else if (node.role === 'Document') line = node.value ? `[belge] ${name}`.trimEnd() + ':' : name ? `${name}:` : '';
    else if (STRUCTURAL.has(node.role)) line = node.depth > 0 && name ? `${name}:` : '';
    else if (node.role === 'Image') line = name ? `[görsel] ${name}` : '';
    else {
      const label = ROLE_LABEL[node.role] ?? node.role.toLowerCase();
      const value = node.value ? ` = “${clip(node.value, 200)}”` : '';
      line = name || value ? `[${label}] ${name}${value}${flagText(node.flags)}` : '';
    }
    if (!line) {
      indentAt[node.depth] = parentIndent;
      continue;
    }
    indentAt[node.depth] = parentIndent + 1;
    // Düğmenin içindeki aynı yazı, liste öğesinin aynı adlı metni: tek satır yeter.
    const bare = line.replace(/^\[[^\]]+\]\s*/, '').replace(/:$/, '');
    if (bare === previous) continue;
    previous = bare;
    const pad = '  '.repeat(Math.min(parentIndent, MAX_INDENT));
    const body = node.role === 'Document' && node.value ? `${pad}${line}\n${indentBlock(node.value, pad + '  ')}` : `${pad}${line}`;
    if (length + body.length + 1 > maxChars) {
      const room = maxChars - length - 1;
      if (room > 40) lines.push(body.slice(0, room));
      truncated = true;
      break;
    }
    lines.push(body);
    length += body.length + 1;
  }
  return { text: lines.join('\n'), truncated, lines: lines.length };
}

function indentBlock(text: string, pad: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line, index, all) => line.trim() !== '' || (index > 0 && all[index - 1]!.trim() !== ''))
    .map((line) => `${pad}${line}`)
    .join('\n');
}

/** Sayfa metnini sıkıştırır: boş satır yığınları ve satır sonu boşlukları atılır, uzunluk sınırlanır. */
export function tidyText(text: string, maxChars: number): { text: string; truncated: boolean } {
  const tidy = text
    .replace(/\r/g, '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return tidy.length > maxChars ? { text: tidy.slice(0, maxChars), truncated: true } : { text: tidy, truncated: false };
}

/** Adres çubuğundaki metni tam adrese çevirir (Chrome `https://` kısmını göstermez); adres değilse `null`. */
export function normalizeUrl(shown: string | null): string | null {
  const text = (shown ?? '').trim();
  if (!text || /\s/.test(text)) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.hostname.includes('.') || url.hostname === 'localhost' ? url.toString() : null;
  } catch {
    return null;
  }
}
