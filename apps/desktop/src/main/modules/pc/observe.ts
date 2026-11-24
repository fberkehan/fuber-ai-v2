// Eylemden SONRA ekranın kısa özeti: önde hangi pencere var, klavye odağı nerede, pencerede hangi alanlar ve düğmeler
// görünüyor. Fare/klavye araçları bunu sonuçlarına ekler ki model bir sonraki hedefini AYRI bir bakış turu
// (`screen_look`: 4–7 sn süren görüntü yorumlama) harcamadan seçebilsin. v1 her eylemden sonra ekran görüntüsü
// döndürüyordu; burada aynı bilgi erişilebilirlik ağacından, metin olarak ve ~30–250 ms'de gelir.
//
// Özetteki adlar EKRANDAN okunur: güvenilmez veridir, çerçevelenir. Parola yöneticisi, banka ve kimlik pencereleri
// özetlenmez. Alanların DEĞERLERİ hiç okunmaz (yalnız adları).
import { t } from '@fuber/shared';
import { sensitiveWindow } from './guard';
import { clip, untrusted } from './read';
import type { SurveyItem, UiaProvider, WindowInfo } from './types';

export interface ObserveOptions {
  /** Hedef pencere; verilmezse öndeki pencere. */
  hwnd?: number;
  /** Eylemin etkisinin ekrana yansıması için okuma öncesi bekleme. */
  delayMs?: number;
  sleep?(ms: number): Promise<void>;
  /** Öğe listesi istenmiyorsa (yalnız pencere + odak) `false`. */
  items?: boolean;
  budgetMs?: number;
}

export interface Observation {
  /** Sonuç metnine eklenecek özet (başında boşluk/satır sonu ile); okunamadıysa boş. */
  text: string;
  window: WindowInfo | null;
  /** Görünen öğe sayısı (sınama ve günlük için). */
  count: number;
}

const GROUPS: Array<{ key: string; roles: string[]; max: number }> = [
  { key: 'fields', roles: ['Edit', 'ComboBox'], max: 6 },
  { key: 'buttons', roles: ['Button', 'SplitButton'], max: 12 },
  { key: 'tabs', roles: ['TabItem'], max: 8 },
  { key: 'rows', roles: ['ListItem', 'DataItem', 'TreeItem'], max: 8 },
  { key: 'menus', roles: ['MenuItem'], max: 8 },
  { key: 'links', roles: ['Hyperlink'], max: 6 },
  { key: 'checks', roles: ['CheckBox', 'RadioButton'], max: 6 },
];

const windowLabel = (window: WindowInfo): string => `${clip(window.title, 60) || window.app} [${window.app}]`;

/** Öğe listesini türlerine göre gruplanmış tek satırlık metne çevirir (saf işlev). */
export function describeItems(items: SurveyItem[], more = 0): string {
  const parts: string[] = [];
  let hidden = more;
  for (const group of GROUPS) {
    const seen = new Set<string>();
    const names: string[] = [];
    for (const item of items) {
      if (!group.roles.includes(item.role)) continue;
      const name = item.password ? t('pc.observe.passwordField') : clip(item.name, 44) || t('pc.observe.unnamed');
      if (seen.has(name)) continue;
      seen.add(name);
      if (names.length >= group.max) {
        hidden += 1;
        continue;
      }
      const marks = [item.flags?.includes('*') ? t('pc.observe.focused') : '', item.flags?.includes('s') ? t('pc.observe.selected') : '', item.flags?.includes('x') ? t('pc.observe.disabled') : ''].filter(Boolean);
      names.push(`“${name}”${marks.length ? ` (${marks.join(', ')})` : ''}`);
    }
    if (names.length > 0) parts.push(`${t(`pc.observe.${group.key}`)}: ${names.join(', ')}`);
  }
  if (parts.length === 0) return '';
  return parts.join(' · ') + (hidden > 0 ? t('pc.observe.more', { count: hidden }) : '');
}

/** Pencerenin görünen öğelerinin özeti; hata iletilerinde "pencerede şunlar var: …" için de kullanılır. Okunamadıysa boş. */
export async function describeWindowItems(uia: UiaProvider, hwnd: number, budgetMs = 250): Promise<{ text: string; count: number }> {
  try {
    const survey = await uia.survey(hwnd, { budgetMs, max: 48 });
    return { text: describeItems(survey.items, survey.more), count: survey.items.length };
  } catch {
    return { text: '', count: 0 };
  }
}

export async function observe(uia: UiaProvider, options: ObserveOptions = {}): Promise<Observation> {
  if (options.delayMs && options.sleep) await options.sleep(options.delayMs);
  try {
    const list = await uia.windows();
    const window = options.hwnd === undefined ? list.foreground : (list.windows.find((item) => item.hwnd === options.hwnd) ?? list.foreground);
    if (!window || sensitiveWindow(window)) return { text: '', window: null, count: 0 };
    let text = t('pc.after', { window: `“${windowLabel(list.foreground && !sensitiveWindow(list.foreground) ? list.foreground : window)}”` });
    try {
      const field = await uia.focused();
      if (field.known && field.name && !field.password) text += t('pc.after.field', { field: `“${clip(field.name, 60)}”` });
    } catch {
      // odak okunamadı: pencere bilgisi yeter
    }
    if (options.items === false || window.own) return { text, window, count: 0 };
    const items = await describeWindowItems(uia, window.hwnd, options.budgetMs);
    if (items.text) text += `\n${untrusted(`${t('pc.observe.header')} ${items.text}`)}`;
    return { text, window, count: items.count };
  } catch {
    return { text: '', window: null, count: 0 };
  }
}
