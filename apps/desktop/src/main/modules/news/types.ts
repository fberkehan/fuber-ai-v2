// Gündem modülünün sözleşmesi: RSS kaynak kaydı, takip konuları, kişiselleştirilmiş haber listesi.
// Kural (v1'den, `modules/web/news.ts` ile aynı): yayıncıdan yalnız BAŞLIK + kaynak adı + zaman + adres alınır; özet,
// görsel ve haber metni saklanmaz. Kaynak içeriği güvenilmez veridir: modele `[WEB İÇERİĞİ BAŞI/SONU]` çerçevesinde gider.
import type { Id, IsoDateTime, Ok } from '@fuber/shared';

/** Kaynağın konusu. `other`: kullanıcının eklediği, sınıflanamayan kaynak. */
export type NewsCategory = 'tr' | 'world' | 'economy' | 'tech' | 'ai' | 'startup' | 'other';
export const NEWS_CATEGORIES = ['tr', 'world', 'economy', 'tech', 'ai', 'startup', 'other'] as const satisfies readonly NewsCategory[];

export interface NewsSourceView {
  id: string;
  name: string;
  /** Besleme adresi (RSS / Atom). */
  url: string;
  category: NewsCategory;
  /** Beslemenin dili: `tr`, `en`… */
  lang: string;
  /** Yerleşik katalogdan mı (kaldırılamaz, kapatılır); kullanıcının eklediği kaynak silinir. */
  builtin: boolean;
  enabled: boolean;
  addedAt: IsoDateTime;
  /** Son başarılı okuma; hiç okunmadıysa `null`. */
  lastOkAt: IsoDateTime | null;
  /** Son okuma başarısızsa kısa Türkçe neden; başarılıysa `null`. */
  lastError: string | null;
  /** Depodaki başlık sayısı. */
  itemCount: number;
}

export interface NewsTopic {
  id: Id;
  /** Kullanıcının söylediği konu: "yapay zekâ", "dolar kuru", "Fenerbahçe". */
  text: string;
  /** `follow`: öne çıkar · `mute`: bu konudaki haberler gösterilmez ve söylenmez. */
  mode: 'follow' | 'mute';
  /** `user`: kullanıcı söyledi/ekledi · `profile`: profil katmanındaki ilgi alanından türedi. */
  origin: 'user' | 'profile';
  createdAt: IsoDateTime;
}

/** Birleştirilmiş bir haber: aynı olayı anlatan başlıklar tek kayıttır. */
export interface NewsStory {
  id: Id;
  title: string;
  url: string;
  /** İlk (seçilen) kaynağın adı. */
  source: string;
  /** Aynı haberi veren bütün kaynaklar (seçilen dahil). */
  sources: string[];
  category: NewsCategory;
  lang: string;
  at: IsoDateTime | null;
  /** 0–100: ilgi (takip konusu, profil), tazelik ve kaç kaynağın verdiği birlikte. */
  score: number;
  /** Neden öne çıktı: "takip: yapay zekâ", "3 kaynak", "ilgi alanı: girişimcilik". Boş olabilir. */
  reasons: string[];
  read: boolean;
}

export interface NewsStoriesQuery {
  limit?: number;
  /** Yalnız okunmamışlar (varsayılan `false`). */
  unreadOnly?: boolean;
  category?: NewsCategory;
  /** Yalnız bu andan sonra görülenler (gün içi güncelleme, "son dakika"). */
  since?: IsoDateTime;
  /** Serbest konu süzgeci ("ekonomi", "OpenAI"): başlıkta kökü geçenler. */
  topic?: string;
}

/** Kaynak ekleme sonucu: `message` kullanıcıya söylenecek Türkçe cümledir. */
export interface NewsAddResult {
  ok: boolean;
  source: NewsSourceView | null;
  message: string;
  /** Besleme bulunurken denenen adresler (tanı için). */
  tried: string[];
}

export interface NewsStatus {
  sources: number;
  enabled: number;
  failing: number;
  stories: number;
  unread: number;
  lastRefreshAt: IsoDateTime | null;
}

declare module '@fuber/shared' {
  interface Api {
    'news.sources': { req: void; res: NewsSourceView[] };
    /** `query`: besleme adresi, site adresi ya da site adı ("webrazzi", "bbc.com/turkce"). Beslemeyi bulur ve doğrular. */
    'news.addSource': { req: { query: string }; res: NewsAddResult };
    /** Kullanıcının eklediği kaynağı siler; yerleşik kaynağı kapatır. */
    'news.removeSource': { req: { id: string }; res: Ok };
    'news.toggleSource': { req: { id: string; enabled: boolean }; res: NewsSourceView };
    'news.topics': { req: void; res: NewsTopic[] };
    /** `mode: 'remove'` konuyu listeden çıkarır. */
    'news.setTopic': { req: { text: string; mode: 'follow' | 'mute' | 'remove' }; res: NewsTopic[] };
    'news.stories': { req: NewsStoriesQuery; res: NewsStory[] };
    'news.markRead': { req: { ids: Id[] }; res: Ok };
    /** Etkin kaynakları şimdi okur. */
    'news.refresh': { req: void; res: NewsStatus };
    'news.status': { req: void; res: NewsStatus };
  }
  interface BusEvents {
    'news.changed': { reason: 'refresh' | 'sources' | 'topics' | 'read' };
  }
  interface WindowEvents {
    'news.changed': { reason: 'refresh' | 'sources' | 'topics' | 'read' };
  }
}
