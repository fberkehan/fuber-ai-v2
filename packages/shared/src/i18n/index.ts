/**
 * Sözlük ve `t()`. Her süreç (ana, renderer, işçi) kendi kopyasını taşır; yerel ayar süreç başına tutulur.
 *
 * Türkçe metinler alan dosyalarındadır: `i18n/tr/<alan>.ts` (common, nav, voice, hud, setup, today, chat,
 * memory, planner, settings, projects, skills, admin, core, attention). Her görev yalnız kendi
 * alan dosyasını düzenler; `tr/index.gen.ts` bunları birleştirir (`scripts/gen-index.mjs`, kendiliğinden çalışır)
 * ve bütün anahtarlar `MessageKey` olarak tiplidir.
 *
 * Çalışma anında doğan metinler (kullanıcı yetenekleri) `registerMessages('tr', {...})` ile eklenir.
 */

import { en } from './en';
import { tr, type MessageKey } from './tr/index.gen';

export type Locale = 'tr' | 'en';
export type { MessageKey };

const dictionaries: Record<Locale, Record<string, string>> = {
  tr: { ...tr },
  en: { ...(en as Record<string, string>) },
};

let currentLocale: Locale = 'tr';

export function setLocale(locale: Locale): void {
  currentLocale = locale;
}

export function getLocale(): Locale {
  return currentLocale;
}

/**
 * Sözlüğe çalışma anında anahtar ekler. Alan dosyalarındaki bir anahtarı ezmeye çalışmak hata fırlatır;
 * ek anahtarın yeniden kaydı serbesttir (geliştirmede sıcak yenileme aynı dosyayı tekrar yükler).
 */
export function registerMessages(locale: Locale, messages: Record<string, string>): void {
  const dictionary = dictionaries[locale];
  for (const [key, value] of Object.entries(messages)) {
    if (key in tr) {
      throw new Error(`i18n: "${key}" sözlükte tanımlıdır; çalışma anında değiştirilemez`);
    }
    dictionary[key] = value;
  }
}

/** Anahtar bu yerelde ya da Türkçe yedekte tanımlı mı. */
export function hasMessage(key: string): boolean {
  return dictionaries[currentLocale][key] !== undefined || dictionaries.tr[key] !== undefined;
}

/**
 * Anahtarın metnini döndürür; `{ad}` yer tutucularını `vars` ile doldurur.
 * Geçerli yerelde yoksa Türkçeye, o da yoksa anahtarın kendisine düşer (eksik çeviri ekranda görünür kalsın diye).
 */
export function t(key: MessageKey | (string & {}), vars?: Record<string, string | number>): string {
  const template = dictionaries[currentLocale][key] ?? dictionaries.tr[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined ? match : String(value);
  });
}
