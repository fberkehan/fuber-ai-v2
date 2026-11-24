// Ortam dinleme modülünün varlıkları, IPC kanalları ve olayları (tip genişletmesi; çekirdek sözleşmeye dokunmaz).
// Sayfalar bu dosyayı `import type` ile içe aktarır; hepsi düz JSON'dur.
import type { EntityChange, Id, IsoDateTime, LocalDay, LocalTime, Ok } from '@fuber/shared';
import type { ReportKind } from './periods';

export type { ReportKind } from './periods';

/** Ham döküm satırı: ses hattının yazıya çevirdiği bir söz bölütü. Ses saklanmaz; yalnız bu metin, süresi dolana dek. */
export interface AmbientSegment {
  id: Id;
  text: string;
  startedAt: IsoDateTime;
  endedAt: IsoDateTime;
  durationMs: number;
  day: LocalDay;
  /** Not tutucu bu satırı işledi mi. */
  noted: boolean;
  /** Satır asistana seslenme olarak sınıflandı (`address.ts`); eşlikçi buna tepki vermez. */
  addressed: boolean;
}

/** Notun türü (önem nedeni): karar, söz, tarih/randevu, kişi bilgisi, tercih, öteki bilgi; `chat` gündelik ve önemsiz. */
export type AmbientNoteKind = 'decision' | 'promise' | 'date' | 'person' | 'preference' | 'info' | 'chat';

/** Dökümden çıkarılmış kısa not. `sourceIds` dayandığı döküm satırlarıdır; satırlar silinse de zaman aralığı kalır. */
export interface AmbientNote {
  id: Id;
  day: LocalDay;
  /** Dayandığı ilk döküm satırının anı. */
  at: IsoDateTime;
  text: string;
  important: boolean;
  kind: AmbientNoteKind;
  people: string[];
  /** Model emin değildi ya da kaynağı doğrulanamadı: arayüz ve araçlar "sanırım" diye sunar. */
  unsure: boolean;
  sourceIds: Id[];
  /** Kaynak dökümün zaman aralığı (döküm silindikten sonra da gösterilir). */
  sourceFrom: IsoDateTime;
  sourceTo: IsoDateTime;
  /** Bu andan sonra silinir (gündelik not kısa, önemli not uzun yaşar). */
  expiresAt: IsoDateTime;
  createdAt: IsoDateTime;
}

export type AmbientIssueStatus = 'open' | 'done' | 'dropped';

/** Mesele: konuşmadan çıkan açık iş ya da verilen söz ("Kaan'ı arayacağım"). */
export interface AmbientIssue {
  id: Id;
  title: string;
  person: string | null;
  detail: string | null;
  firstDay: LocalDay;
  /** Konuşmada geçen hedef gün; yoksa `null`. */
  dueDay: LocalDay | null;
  status: AmbientIssueStatus;
  closedAt: IsoDateTime | null;
  unsure: boolean;
  sourceIds: Id[];
  sourceFrom: IsoDateTime;
  /** Kullanıcı hatırlatıcıya çevirdiyse o hatırlatıcının kimliği. */
  reminderId: Id | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** Günlük / haftalık / aylık rapor. Her katman yalnız bir alttakinin özetinden yazılır; ham döküm rapora gitmez. */
export interface AmbientReport {
  id: Id;
  kind: ReportKind;
  /** Gün `2026-11-16`, hafta `2026-W47`, ay `2026-11`. */
  period: string;
  title: string;
  summary: string;
  important: string[];
  casual: string[];
  decisions: string[];
  openIssues: string[];
  next: string[];
  joke: string | null;
  /** Raporun dayandığı kalem sayısı (not ya da alt rapor kalemi). */
  itemCount: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export type InterjectionKind = 'reminder' | 'info' | 'joke';

/** Eşlikçinin bir araya girişi. `sources`: dayandığı kayıtlar (`N-…` not, `M-…` mesele, `R-…` rapor, `H-…` hafıza). */
export interface AmbientInterjection {
  id: Id;
  at: IsoDateTime;
  text: string;
  kind: InterjectionKind;
  /** Araya girmeyi tetikleyen söz. */
  trigger: string;
  sources: string[];
  voiced: boolean;
}

/** Hafızaya ÖNERİ: kalıcı görünen bilgi. Kullanıcı kabul etmeden hafızaya yazılmaz. */
export interface AmbientSuggestion {
  id: Id;
  text: string;
  subject: string | null;
  day: LocalDay;
  sourceIds: Id[];
  status: 'pending' | 'accepted' | 'dismissed';
  createdAt: IsoDateTime;
}

/** Kullanıcının cihazda tuttuğu ortam dinleme tercihleri. */
export interface AmbientPrefs {
  /** Kullanıcının aç/kapa anahtarı. Rıza ve Yönetim izni olmadan tek başına dinlemeyi başlatmaz. */
  enabled: boolean;
  /** Eşlikçi araya girebilsin mi (politika ve kapılar ayrıca uygulanır). */
  companion: boolean;
  /** Araya girme seslendirilsin mi; kapalıyken yalnız küçük ada bildirimi. */
  companionVoice: boolean;
  /** Günlük raporun hazırlanacağı yerel saat. */
  reportTime: LocalTime;
  /** Ekran kilitliyken dinleme dursun mu. */
  pauseWhenLocked: boolean;
  /** Yalnız belirli saatlerde dinle. `days`: 0 = Pazar. */
  hours: { enabled: boolean; from: LocalTime; to: LocalTime; days: number[] };
}

/** Dinlememe nedeni; `ok` = dinliyor. Sıra, kapının denetim sırasıdır. */
export type ListenReason =
  | 'ok'
  | 'kill_switch' // Yönetim acil durdurma
  | 'policy' // Yönetim ortam dinlemeye izin vermiyor
  | 'no_consent' // rıza verilmemiş
  | 'disabled' // kullanıcı kapatmış
  | 'paused' // "şimdi duraklat"
  | 'mic_off' // mikrofon kapalı
  | 'quiet_hours' // sessiz saatler ya da rahatsız etme
  | 'outside_hours' // dinleme saatleri dışında
  | 'locked' // ekran kilitli
  | 'no_feed'; // ses hattı sürekli döküm vermiyor (hazır değil ya da desteklemiyor)

/** Araya girmeme nedeni; `ok` = kapılar açık (model kararı ayrıca gerekir). */
export type InterjectReason =
  | 'ok'
  | 'not_listening'
  | 'policy_off' // policy.ambient.interjections = off
  | 'needs_cloud' // cloud-only ve bulut beyni çalışmıyor
  | 'user_off' // kullanıcı eşlikçiyi kapatmış
  | 'meeting' // toplantı / görüşme: mikrofon ya da kamera başka uygulamada
  | 'fullscreen'
  | 'quiet_hours'
  | 'hourly_limit'
  | 'min_gap'
  | 'user_speaking' // kullanıcı hâlâ konuşuyor ya da sesli tur sürüyor
  | 'busy'; // önceki değerlendirme sürüyor

export type PausePreset = '15m' | '1h' | 'today';

export interface AmbientStatus {
  /** Yönetim izni (`policy.ambient.allowed`). */
  allowed: boolean;
  consentAt: IsoDateTime | null;
  prefs: AmbientPrefs;
  listening: boolean;
  reason: ListenReason;
  pausedUntil: IsoDateTime | null;
  /** Ses hattı sürekli dökümü destekliyor mu (`voice.setAmbient`). */
  feedSupported: boolean;
  limits: {
    retentionDays: number;
    maxInterjectionsPerHour: number;
    minGapSeconds: number;
    interjections: 'off' | 'cloud-only' | 'on';
  };
  /** Eşlikçi şu an araya girebilir mi ve giremiyorsa neden (ayarlar ekranı gösterir). */
  companion: { active: boolean; reason: InterjectReason };
  today: { segments: number; notes: number; openIssues: number; interjections: number };
}

export interface AmbientDay {
  day: LocalDay;
  notes: number;
  important: number;
  /** Bu güne ait, süresi dolmamış ham döküm satırı sayısı. */
  segments: number;
  hasReport: boolean;
}

declare module '@fuber/shared' {
  interface Api {
    'ambient.status': { req: void; res: AmbientStatus };
    /** Rıza ekranının sonucu. `accept: true` rızayı kaydeder ve dinlemeyi açar; `false` rızayı geri alır ve kapatır. */
    'ambient.consent': { req: { accept: boolean }; res: AmbientStatus };
    'ambient.setPrefs': { req: { patch: Partial<AmbientPrefs> }; res: AmbientStatus };
    /** `preset: null` duraklatmayı kaldırır. */
    'ambient.pause': { req: { preset: PausePreset | null }; res: AmbientStatus };
    /** Son `minutes` dakikanın dökümünü ve ondan çıkan notları, meseleleri, önerileri siler. */
    'ambient.forgetRecent': { req: { minutes: number }; res: { segments: number; notes: number; issues: number } };
    /** Döküm, not, mesele, rapor, öneri ve araya girme kayıtlarının hepsini siler. */
    'ambient.deleteAll': { req: void; res: Ok };

    'ambient.days': { req: { limit: number }; res: AmbientDay[] };
    'ambient.notes': { req: { day: LocalDay }; res: AmbientNote[] };
    /** Notun dayandığı döküm satırları (süresi dolup silinenler gelmez). */
    'ambient.noteSources': { req: { id: Id }; res: AmbientSegment[] };
    'ambient.deleteNote': { req: { id: Id }; res: Ok };
    'ambient.transcript': { req: { day: LocalDay }; res: AmbientSegment[] };
    'ambient.deleteSegment': { req: { id: Id }; res: Ok };
    /** Bekleyen dökümü hemen nota çevirir ("Şimdi not çıkar"). */
    'ambient.takeNotes': { req: void; res: { notes: number; issues: number } };

    'ambient.issues': { req: { status: 'open' | 'closed' | 'all' }; res: AmbientIssue[] };
    'ambient.updateIssue': {
      req: { id: Id; patch: { status?: AmbientIssueStatus; dueDay?: LocalDay | null; title?: string } };
      res: AmbientIssue;
    };
    'ambient.deleteIssue': { req: { id: Id }; res: Ok };
    /** Meseleyi hatırlatıcıya çevirir (planlar modülünün `reminder_create` aracıyla) ve bağını kaydeder. */
    'ambient.issueToReminder': { req: { id: Id; dueAt: IsoDateTime }; res: AmbientIssue };

    'ambient.reports': { req: { kind?: ReportKind; limit: number }; res: AmbientReport[] };
    /** Raporu şimdi hazırlar (varsa yeniden yazar). Dönemde not yoksa `null`. */
    'ambient.buildReport': { req: { kind: ReportKind; period?: string }; res: AmbientReport | null };
    'ambient.deleteReport': { req: { id: Id }; res: Ok };

    'ambient.suggestions': { req: void; res: AmbientSuggestion[] };
    /** `accept: true` öneriyi hafızaya yazar (köken: ortam dinleme); `false` yok sayar. */
    'ambient.resolveSuggestion': { req: { id: Id; accept: boolean }; res: Ok };
    'ambient.interjections': { req: { limit: number }; res: AmbientInterjection[] };
  }

  interface BusEvents {
    /** Dinleme durumu değişti. Tepsi ve ada "ortam dinleme açık" göstergesini bundan çizer. */
    'ambient.status': AmbientStatus;
    'ambient.changed': EntityChange<'segment' | 'note' | 'issue' | 'report' | 'suggestion' | 'interjection'>;
    /**
     * Dökümdeki bir satır, uyandırma sözü olmadan asistana seslenme olarak sınıflandı ("bugün ne yapıyoruz Jarvis").
     * Tura çevirmek ses oturumunun işidir; bu modül yalnız haber verir ve o satır için araya girmez.
     */
    'ambient.addressed': { segmentId: Id; text: string; why: 'name' | 'follow_up' };
  }

  interface WindowEvents {
    'ambient.status': AmbientStatus;
    'ambient.changed': EntityChange<'segment' | 'note' | 'issue' | 'report' | 'suggestion' | 'interjection'>;
  }
}
