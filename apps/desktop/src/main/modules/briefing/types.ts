// Brifing modülünün sözleşmesi: Jarvis'in KENDİLİĞİNDEN konuşması. Sabah karşılaması, gün içi kısa güncellemeler ve
// önemli gelişmede araya girme. Kanal kararı Dikkat Yöneticisi'nindir (KURGU §8); burada ne zaman ve ne kadar konuşulacağı,
// neyin söyleneceği ve kullanıcının ilgisine göre kendiliğinden azalma vardır.
import type { Id, IsoDateTime, LocalDay } from '@fuber/shared';

/**
 * Konuşkanlık:
 *  silent  kendiliğinden hiç konuşmaz; brifing yalnız Bugün panosunda kart olur
 *  low     yalnız sabah brifingi
 *  normal  sabah brifingi + günde en çok 2 kısa güncelleme + önemli gelişme
 *  high    sabah brifingi + günde en çok 4 kısa güncelleme + önemli gelişme
 */
export type TalkLevel = 'silent' | 'low' | 'normal' | 'high';
export const TALK_LEVELS = ['silent', 'low', 'normal', 'high'] as const satisfies readonly TalkLevel[];

export interface BriefingScope {
  /** Gündem (RSS haberleri). */
  news: boolean;
  /** Bugünün hatırlatıcıları ve takvimi. */
  agenda: boolean;
  /** Bekleyen yapılacaklar ve süren takip işleri. */
  tasks: boolean;
  /** Okunmamış önemli e-postalar. */
  mail: boolean;
}

export interface BriefingPrefs {
  /** Kapalıysa brifing üretilmez (ne ses ne kart). */
  enabled: boolean;
  talk: TalkLevel;
  /** Sabah brifingi: yerel saat `SS:DD`. */
  morning: { enabled: boolean; time: string };
  /** Gün içi güncellemelerin yapılabileceği saat aralığı (yerel `SS:DD`). */
  updates: { from: string; to: string };
  /** Kendiliğinden konuşmanın saatlik üst sınırı (sabah brifingi dahil). */
  maxPerHour: number;
  /** Önemli gelişmede (çok kaynağın verdiği ya da takip edilen konudaki haber) araya girilsin mi. */
  breaking: boolean;
  scope: BriefingScope;
  /** Brifingde söylenecek haber sayısı. */
  newsCount: number;
}

/** Kullanıcının ilgisinden ÖĞRENİLEN ayar: yanıtsız kalan ve reddedilen brifingler konuşmayı kendiliğinden azaltır. */
export interface BriefingAdaptive {
  /** Art arda ilgisiz kalan (yanıtsız ya da "sus" denen) kendiliğinden konuşma sayısı. */
  ignoredStreak: number;
  engaged: number;
  ignored: number;
  declined: number;
  /**
   * Etkin konuşkanlık çarpanı (1 = ayardaki düzey; 0,5 = güncellemeler yarıya iner; 0 = yalnız kart).
   * İlgi gelince yeniden yükselir.
   */
  factor: number;
  /** Çarpanın son değiştiği an ve nedeni (Türkçe; Ayarlar'da gösterilir). */
  changedAt: IsoDateTime | null;
  note: string | null;
}

export type BriefingKind = 'morning' | 'update' | 'breaking' | 'manual';

export interface BriefingSection {
  id: 'agenda' | 'tasks' | 'mail' | 'news';
  title: string;
  lines: string[];
}

export interface BriefingNewsItem {
  id: Id;
  title: string;
  url: string;
  source: string;
  /** Neden seçildi: "takip: yapay zekâ", "3 kaynak". */
  reasons: string[];
}

/** Bir brifing: hem sesli söylenen metin hem Bugün panosundaki kartın verisi. */
export interface Briefing {
  id: Id;
  kind: BriefingKind;
  day: LocalDay;
  at: IsoDateTime;
  /** Kartın başlığındaki selam: "Günaydın Deniz Hanım". */
  greeting: string;
  /** Sesli söylenen metin (kısa; sayılar okunduğu gibi değil, seslendirme çevirir). */
  spoken: string;
  sections: BriefingSection[];
  news: BriefingNewsItem[];
  /**
   * Nasıl ulaştı: `voice` sesle söylendi · `card` yalnız kart (konuşkanlık kapalı, öğrenilmiş azalma) ·
   * `deferred` Dikkat Yöneticisi bekletti (sessiz saat, toplantı, tam ekran) · `skipped` söylenecek bir şey yoktu.
   */
  delivered: 'voice' | 'card' | 'deferred' | 'skipped';
  /** Söylenmediyse neden (Türkçe kısa). */
  reason: string | null;
  /** Kullanıcının tepkisi: `engaged` yanıt verdi / karta dokundu · `ignored` yanıtsız · `declined` "sus / istemiyorum". */
  response: 'pending' | 'engaged' | 'ignored' | 'declined';
}

export interface BriefingState {
  prefs: BriefingPrefs;
  adaptive: BriefingAdaptive;
  /** Bugünün en son brifingi (kart bunu gösterir); yoksa `null`. */
  last: Briefing | null;
  /** Bugün kendiliğinden kaç kez konuşuldu ve bugünkü üst sınır. */
  spokenToday: number;
  dailyLimit: number;
  /** Bir sonraki sabah brifinginin anı; kapalıysa `null`. */
  nextMorningAt: IsoDateTime | null;
  /** Şu an kendiliğinden konuşulabilir mi; konuşulamıyorsa neden (Türkçe). */
  canSpeak: { ok: boolean; reason: string | null };
}

declare module '@fuber/shared' {
  interface Api {
    'briefing.state': { req: void; res: BriefingState };
    /** Ayarın verilen alanlarını değiştirir (iç içe alanlar birleştirilir). */
    'briefing.setPrefs': { req: { patch: Partial<Omit<BriefingPrefs, 'morning' | 'updates' | 'scope'>> & { morning?: Partial<BriefingPrefs['morning']>; updates?: Partial<BriefingPrefs['updates']>; scope?: Partial<BriefingScope> } }; res: BriefingState };
    /** Brifingi şimdi hazırlar ve kartı günceller; `speak` verilirse sesle de söyler. */
    'briefing.runNow': { req: { speak?: boolean }; res: Briefing };
    /** Kullanıcı karta dokundu / kapattı: ilgi öğrenmesi. */
    'briefing.feedback': { req: { id: Id; response: 'engaged' | 'declined' }; res: BriefingState };
    /** Öğrenilmiş azalmayı sıfırlar ("yeniden eskisi gibi konuş"). */
    'briefing.resetAdaptive': { req: void; res: BriefingState };
  }
  interface BusEvents {
    'briefing.changed': { reason: 'prefs' | 'briefing' | 'adaptive' };
  }
  interface WindowEvents {
    'briefing.changed': { reason: 'prefs' | 'briefing' | 'adaptive' };
  }
}
