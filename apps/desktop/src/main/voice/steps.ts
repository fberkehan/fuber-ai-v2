/**
 * Sesli turun canlı adım satırı: araç adı ve girdisinden kısa, Türkçe bir cümle ("WhatsApp açılıyor", "Ahmet arıyorum").
 * Ada bunu "ne yapıyor" satırında gösterir; uzun işte aralarda sesli ilerleme olarak da söylenir. Araç kendi ara
 * durumunu bildirirse (`ctx.report`) o cümle önceliklidir. Saf işlev: sınaması `steps.test.ts`.
 *
 * Girdi KULLANICIYA gösterilir ve okunur: yalnız kısa, zararsız alanlar alınır (uygulama, pencere, öğe adı, arama
 * sözü); yazılan metin, dosya içeriği, adres çubuğu ve parola hiçbir zaman satıra girmez.
 */

import { t, type MessageKey } from '@fuber/shared';

const MAX_TARGET = 40;

function clip(value: unknown): string {
  if (typeof value !== 'string') return '';
  const flat = value.replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  return flat.length > MAX_TARGET ? `${flat.slice(0, MAX_TARGET - 1)}…` : flat;
}

function field(input: unknown, ...names: string[]): string {
  if (typeof input !== 'object' || input === null) return '';
  const record = input as Record<string, unknown>;
  for (const name of names) {
    const value = clip(record[name]);
    if (value) return value;
  }
  return '';
}

/** Hedefli satır: hedef okunabildiyse `{target}`'lı biçim, okunamadıysa `.plain` biçimi. */
function targeted(key: string, target: string): string {
  return target ? t(key as MessageKey, { target: `“${target}”` }) : t(`${key}.plain` as MessageKey);
}

/** Aracın adım satırı. Bilinmeyen araçta genel satır döner. */
export function stepLabel(name: string, input: unknown): string {
  switch (name) {
    case 'app_open':
      return targeted('turn.step.app_open', field(input, 'app', 'name', 'target'));
    case 'app_close':
      return t('turn.step.app_close', { target: field(input, 'app', 'name') || '…' });
    case 'pc_focus_window':
    case 'pc_window_action':
    case 'pc_window_arrange':
      return targeted('turn.step.pc_focus_window', field(input, 'window', 'app', 'title'));
    case 'pc_click':
      return targeted('turn.step.pc_click', field(input, 'name', 'label', 'target', 'text'));
    case 'pc_type':
    case 'clipboard_write':
      return t('turn.step.pc_type');
    case 'pc_keys':
      return targeted('turn.step.pc_key', field(input, 'keys', 'key'));
    case 'pc_scroll':
      return t('turn.step.pc_scroll');
    case 'pc_find':
      return targeted('turn.step.pc_find', field(input, 'name', 'query', 'text'));
    case 'screen_look':
      return t('turn.step.screen_look');
    case 'pc_read_window':
    case 'browser_read':
      return t('turn.step.pc_read');
    case 'pc_windows':
    case 'browser_tabs':
    case 'app_list':
      return t('turn.step.pc_windows');
    case 'browser_search':
      return targeted('turn.step.browser_search', field(input, 'query', 'q'));
    case 'browser_navigate':
    case 'url_open':
      return t('turn.step.browser_open');
    case 'web_read':
      return t('turn.step.web_read');
    case 'web_search':
      return targeted('turn.step.web_search', field(input, 'query', 'q'));
    case 'mail_send':
      return t('turn.step.mail_send');
    case 'research_start':
      return t('turn.step.research');
    default:
      break;
  }
  if (name.startsWith('jbrowser_')) return t('turn.step.jbrowser');
  if (name.startsWith('file_') || name.startsWith('folder_') || name.startsWith('document_')) return t('turn.step.file');
  if (name.startsWith('mail_')) return t('turn.step.mail');
  if (name.startsWith('memory_')) return t('turn.step.memory');
  if (name.startsWith('reminder_') || name.startsWith('todo_') || name.startsWith('calendar_')) return t('turn.step.planner');
  return t('turn.step.generic');
}

/**
 * Başarısız adımın kullanıcıya söylenecek kısa nedeni. Araç sonucu modele yazılmış bir metindir ("Araç hata verdi: …",
 * güvenilmez veri çerçeveleri, yönergeler): ilk cümlesi alınır, çerçeve ve öneki ayıklanır.
 */
export function failureReason(text: string): string {
  const flat = text
    .replace(/\[[^\]]*(BAŞI|SONU)\]/g, ' ')
    .replace(/^HATA:\s*/i, '')
    .replace(/^Araç hata verdi:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!flat) return '';
  const first = /^(.{12,}?[.!?…])(\s|$)/.exec(flat)?.[1] ?? flat;
  return first.length > 180 ? `${first.slice(0, 179)}…` : first;
}
