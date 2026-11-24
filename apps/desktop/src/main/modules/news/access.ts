// Gündemin başka modüllere (brifing) açtığı yüz. Modüller birbirini içe aktarmaz kuralının bilinçli istisnası: brifing
// gündemi bu küçük yüzden okur; modül kapalıyken `activeNews()` `null` döner ve brifing haber bölümünü atlar.
import type { Id } from '@fuber/shared';
import type { NewsAddResult, NewsSourceView, NewsStatus, NewsStoriesQuery, NewsStory, NewsTopic } from './types';

/** Profil katmanından: ilgi alanları (`follow`) ve sevmedikleri (`mute`). */
export interface NewsInterests {
  follow: string[];
  mute: string[];
}

export interface NewsAccess {
  stories(query?: NewsStoriesQuery): NewsStory[];
  breaking(sinceIso: string): NewsStory[];
  refresh(options?: { force?: boolean; signal?: AbortSignal }): Promise<NewsStatus>;
  markRead(ids: Id[]): void;
  status(): NewsStatus;
  sources(): NewsSourceView[];
  topics(): NewsTopic[];
  setTopic(text: string, mode: 'follow' | 'mute' | 'remove'): NewsTopic[];
  addSource(query: string): Promise<NewsAddResult>;
  removeSource(id: string): boolean;
}

let active: NewsAccess | null = null;
let interestProvider: (() => NewsInterests) | null = null;

/** Modül açıkken etkin servis; kapalıyken `null`. */
export function activeNews(): NewsAccess | null {
  return active;
}

/** Profil katmanı ilgi alanlarını buradan verir (`null` bağı kaldırır); verilmediyse boş sayılır. */
export function setNewsInterestProvider(read: (() => NewsInterests) | null): void {
  interestProvider = read;
}

/** @internal Yalnız gündem modülü çağırır (kurulum/kapanış). */
export function setActiveNews(access: NewsAccess | null): void {
  active = access;
}

/** @internal Gündem servisinin ilgi okuyucusu: sağlayıcı yoksa ya da fırlatırsa boş. */
export function readNewsInterests(): NewsInterests {
  if (!interestProvider) return { follow: [], mute: [] };
  try {
    const value = interestProvider();
    return { follow: [...(value?.follow ?? [])], mute: [...(value?.mute ?? [])] };
  } catch {
    return { follow: [], mute: [] };
  }
}
