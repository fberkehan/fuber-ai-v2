// Toplantı modülünün varlıkları, IPC kanalları ve olayları (tip genişletmesi; çekirdek sözleşmeye dokunmaz).
// Sayfa bu dosyayı `import type` ile içe aktarır; hepsi düz JSON'dur. Ses hiçbir varlıkta yoktur: yalnız yazı.
import type { Id, IsoDateTime, Ok } from '@fuber/shared';

/** `me` = "Siz" (mikrofon) · `them` = "Karşı taraf" (bilgisayarın sesi). */
export type MeetingSpeaker = 'me' | 'them';

/** Kullanıcının toplantıya verdiği bağlam. Belge metni talimat değil başvuru verisidir. */
export interface MeetingContext {
  topic: string;
  participants: string;
  notes: string;
  /** Terim sözlüğü: virgülle ayrılmış adlar ve terimler (çeviride korunur, Whisper'a da verilir). */
  glossary: string;
  documents: Array<{ name: string; text: string; truncated: boolean }>;
}

export type TranslationState = 'none' | 'pending' | 'done' | 'same' | 'failed' | 'skipped';

/** Kesinleşmiş döküm satırı. */
export interface MeetingLine {
  id: Id;
  meetingId: Id;
  speaker: MeetingSpeaker;
  text: string;
  startedAt: IsoDateTime;
  endedAt: IsoDateTime;
  /** Satırın dili (metinden sezilen, yoksa motorun sezdiği); bilinmiyorsa `null`. */
  lang: string | null;
  translation: string | null;
  translationState: TranslationState;
}

/** Karşı tarafın sorusuna yalnız kullanıcının gördüğü yanıt önerisi. Seslendirilmez, hiçbir yere gönderilmez. */
export interface MeetingSuggestion {
  id: Id;
  meetingId: Id;
  lineId: Id;
  question: string;
  state: 'working' | 'ready' | 'failed' | 'skipped';
  reply: string | null;
  /** Yanıt hedef dilden başka dildeyse hedef dildeki karşılığı. */
  translation: string | null;
  createdAt: IsoDateTime;
}

export interface SummaryItem {
  text: string;
  /** Maddenin dayandığı döküm satırı (satır süresi dolup silinse de kimlik kalır). */
  lineId: Id;
  owner?: string;
  /** Yalnız konuşmada tarih geçtiyse (YYYY-MM-DD). */
  due?: string;
  /** Planlar'a aktarıldıysa yapılacağın kimliği. */
  todoId?: Id;
}

/**
 * `deep`: derin beyin (API ya da bu bilgisayardaki Claude Code) · `cloud`: bulut beyni (hafıza rolü) · `local`: bu
 * bilgisayardaki küçük model (yalnız kısa toplantı).
 */
export type SummaryEngine = 'deep' | 'cloud' | 'local';

export interface MeetingSummary {
  points: SummaryItem[];
  decisions: SummaryItem[];
  actions: SummaryItem[];
  engine: SummaryEngine;
  createdAt: IsoDateTime;
}

export type MeetingState = 'live' | 'summarizing' | 'ended';

/** Özetin neden yazılmadığı: `needs_deep` derin beyin yok ve döküm yerel model için uzun · `no_brain` hiç beyin yok · `failed` model yanıtı geçersiz · `empty` dökümde söz yok. */
export type SummaryProblem = 'needs_deep' | 'no_brain' | 'failed' | 'empty';

export interface Meeting {
  id: Id;
  title: string;
  state: MeetingState;
  startedAt: IsoDateTime;
  endedAt: IsoDateTime | null;
  /** Çevirinin hedef dili; `null` = çeviri kapalı. */
  target: string | null;
  /** Karşı tarafın dili (`auto` = motor sezer). */
  theirLanguage: string;
  /** Yanıt önerisi açık mı. */
  suggestions: boolean;
  /** Bilgisayar sesi istendi mi (yalnız mikrofonla da toplantı tutulabilir). */
  system: boolean;
  context: MeetingContext;
  summary: MeetingSummary | null;
  summaryProblem: SummaryProblem | null;
  /** Özetin yazılamama nedeninin açıklaması (derin beyin yoksa neden yok olduğu). */
  summaryDetail: string | null;
  /** Özette dayanağı bulunmadığı için atılan madde sayısı. */
  summaryDropped: number;
  lineCount: number;
  /** Hoparlörden mikrofona kaçtığı için "Siz" yazılmayan satır sayısı. */
  echoDropped: number;
}

export interface MeetingListItem {
  id: Id;
  title: string;
  state: MeetingState;
  startedAt: IsoDateTime;
  endedAt: IsoDateTime | null;
  lineCount: number;
  hasSummary: boolean;
  /** Ham dökümün süresi doldu: yalnız özet ve bağlam kaldı. */
  transcriptExpired: boolean;
}

/** Toplantıyı başlatma seçenekleri (arayüz ve araç). */
export interface MeetingStartOptions {
  context?: Partial<MeetingContext>;
  /** `null` çeviriyi kapatır; verilmezse uygulamanın dili. */
  target?: string | null;
  theirLanguage?: string;
  suggestions?: boolean;
  system?: boolean;
}

/** Sayfa ve tepsi bu durumu çizer. */
export interface MeetingStatus {
  /** Modül açık ama ses hattı toplantı kipini desteklemiyor (sınama düzeneği) ya da hazır değil. */
  available: boolean;
  unavailableReason: string | null;
  consentAt: IsoDateTime | null;
  /** Süren (ya da özetlenen) toplantı. */
  active: Meeting | null;
  /** Ses hattının toplantı durumu: kaynaklar ve bekleyen bölüt. */
  sources: { mic: 'on' | 'off'; system: 'off' | 'starting' | 'on' | 'error'; systemError: string | null; queued: number };
  /** Çeviri, öneri ve özetin hangi beyinle yapılacağı (ekranda gösterilir; uydurma yok). */
  brain: { translate: 'cloud' | 'local' | 'none'; summary: 'deep' | 'cloud' | 'local_short' | 'none'; summaryReason: string | null };
  retentionDays: number;
}

/**
 * Kokpit "Toplantı" kartının verisi (`index.ts` › `dashboard.registerProvider`): toplantı sürüyorsa `live`, yoksa son
 * toplantının özeti (`last`). Hiç toplantı yoksa kart çizilmez.
 */
export interface MeetingDashboardData {
  state: 'live' | 'summarizing' | 'ended';
  id: Id;
  title: string;
  startedAt: IsoDateTime;
  endedAt: IsoDateTime | null;
  /**
   * Özet: ilk maddeler (ana noktalar, sonra kararlar) ve sayılar; özet yoksa `null`. İç içe durur: üst düzeyde boş bir
   * liste olsaydı pano kartı "boş" sayıp çizmezdi (`isEmptyCardData`; süren toplantının özeti yoktur).
   */
  summary: { points: string[]; decisions: number; actions: number } | null;
  /** Özet yazılamadıysa nedeni. */
  problem: SummaryProblem | null;
}

export type MeetingChange =
  | { kind: 'line'; meetingId: Id; line: MeetingLine }
  | { kind: 'line_removed'; meetingId: Id; lineId: Id; reason: 'echo' | 'deleted' }
  /** Kesinleşmemiş "Siz" satırı (yankı denetimi bekliyor): ekranda soluk görünür. */
  | { kind: 'pending'; meetingId: Id; line: MeetingLine }
  | { kind: 'suggestion'; meetingId: Id; suggestion: MeetingSuggestion }
  | { kind: 'meeting'; meetingId: Id };

declare module '@fuber/shared' {
  interface Api {
    'meeting.status': { req: void; res: MeetingStatus };
    /** İlk kullanımın rıza ekranı. `accept: false` rızayı geri alır (süren toplantı biter). */
    'meeting.consent': { req: { accept: boolean }; res: MeetingStatus };
    'meeting.start': { req: MeetingStartOptions; res: MeetingStatus };
    /** Toplantıyı bitirir ve özetler. Özet yazılamazsa da toplantı biter (nedeni `summaryProblem`). */
    'meeting.stop': { req: void; res: MeetingStatus };
    'meeting.setContext': { req: { context: Partial<MeetingContext> }; res: MeetingStatus };
    /** Belgeyi okuyup bağlama ekler (belge modülünün okuyucusuyla). `path` yoksa dosya seçme penceresi. */
    'meeting.addDocument': { req: { path?: string }; res: MeetingStatus };
    'meeting.setOptions': { req: { target?: string | null; suggestions?: boolean; theirLanguage?: string }; res: MeetingStatus };
    'meeting.list': { req: { limit: number }; res: MeetingListItem[] };
    'meeting.get': { req: { id: Id }; res: { meeting: Meeting; lines: MeetingLine[]; suggestions: MeetingSuggestion[] } | null };
    /** Özeti (yeniden) yazar; derin beyin sonradan geldiyse ya da ilk deneme düştüyse. */
    'meeting.summarize': { req: { id: Id }; res: Meeting };
    /** Özetteki yapılacakları Planlar'a ekler (`index` yoksa hepsi). Zaten eklenen yeniden eklenmez. */
    'meeting.exportActions': { req: { id: Id; index?: number }; res: { added: number; skipped: number; meeting: Meeting } };
    'meeting.delete': { req: { id: Id }; res: Ok };
    'meeting.deleteAll': { req: void; res: Ok };
  }

  interface BusEvents {
    'meeting.status': MeetingStatus;
    'meeting.changed': MeetingChange;
  }

  interface WindowEvents {
    'meeting.status': MeetingStatus;
    'meeting.changed': MeetingChange;
  }
}
