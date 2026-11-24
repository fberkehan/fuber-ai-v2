// Gözcülü arka plan işlerinin ("İşler", G5) varlıkları, kaynak eklenti arayüzü, IPC kanalları ve olayları.
// Tip genişletmesidir; çekirdek sözleşmeye dokunmaz. Sayfa ve başka modüller bu dosyayı yalnız `import type` ile alır.
import type { EntityChange, Id, IsoDateTime, JsonObject, Ok } from '@fuber/shared';

/** Yerleşik kaynaklar. Eklenti kaynakları (e-posta gibi) kendi adlarını getirir: `WatchSourceDef.kind`. */
export type BuiltinSourceKind = 'time' | 'page' | 'file' | 'window' | 'claude';

/**
 * Koşul: gözcünün YAPAY ZEKÂSIZ verdiği karar. Yalnız `ask` modele gider ve yalnız içerik DEĞİŞTİĞİNDE.
 * - `changed`     içerik değişti (olay kaynağında: yeni olay geldi; dosyada: oluştu/değişti/silindi)
 * - `appears`     metin göründü (Türkçe harf ve büyük/küçük harf duyarsız)
 * - `disappears`  metin kayboldu
 * - `matches`     düzenli ifade tuttu
 * - `below/above` metindeki sayı (ör. fiyat) eşiğin altına indi / üstüne çıktı; `near` sayının yanındaki sözcük
 * - `drops/rises` sayı bir önceki denetime göre düştü / yükseldi
 * - `ask`         doğal dille koşul ("ilan yayımlandı mı"): değişiklikte modele sorulur
 */
export type WatchCondition =
  | { type: 'changed' }
  | { type: 'appears'; text: string }
  | { type: 'disappears'; text: string }
  | { type: 'matches'; pattern: string }
  | { type: 'below' | 'above'; value: number; near?: string }
  | { type: 'drops' | 'rises'; near?: string }
  | { type: 'ask'; question: string };

/** Koşul tutunca çalışan OKUMA aracı (`web_read`, `fx_rate`...). Okuma dışı araç her seferinde yeniden onay ister. */
export interface WatchAction {
  tool: string;
  input: JsonObject;
}

export interface WatchPlan {
  source: { kind: string; target: string };
  condition: WatchCondition;
  /** `false`: koşul ilk tuttuğunda iş biter. `true`: son tarihe dek her tuttuğunda haber verir. */
  repeat: boolean;
  /** Haber sesli de verilsin mi (yüksek öncelik; Dikkat Yöneticisi yine toplantı/oyun kuralını uygular). */
  speak: boolean;
  /** Son tarih: bu andan sonra iş "süre doldu" ile biter. */
  untilAt: IsoDateTime;
  /** Denetim aralığı (sn). Değişiklik yokken aralık ×1,5 büyür (`maxSec`e dek), değişince `minSec`e döner. */
  interval: { minSec: number; maxSec: number };
  /** İş boyunca en çok kaç model çağrısı (yalnız `ask` koşulu ve özet çağırır). */
  maxModelCalls: number;
  action: WatchAction | null;
}

export type WatchStatus = 'running' | 'paused' | 'done' | 'failed' | 'cancelled';

/**
 * Durumun nedeni. `paused`: `user` kullanıcı · `panic` acil durdurma · `policy` Yönetim'in acil durdurması ·
 * `errors` kaynak üst üste yanıt vermedi. `done`: `matched` koşul tuttu · `expired` süre doldu · `budget` çağrı bütçesi
 * doldu. `failed`: `source` kaynak artık geçersiz (ör. dosya erişimi yasaklandı).
 */
export type WatchReason = 'user' | 'panic' | 'policy' | 'errors' | 'matched' | 'expired' | 'budget' | 'source';

/** Arayüzün ve araçların gördüğü iş. Gözcünün iç izi (imza, önceki metin) burada yoktur. */
export interface WatchJob {
  id: Id;
  title: string;
  /** Kullanıcının kendi sözleriyle istediği. */
  goal: string;
  plan: WatchPlan;
  status: WatchStatus;
  reason: WatchReason | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  lastCheckAt: IsoDateTime | null;
  /** Çalışırken bir sonraki denetim; durunca `null`. */
  nextCheckAt: IsoDateTime | null;
  /** Şu anki denetim aralığı (sn). */
  intervalSec: number;
  checks: number;
  /** Kaynakta görülen değişiklik sayısı. */
  changes: number;
  modelCalls: number;
  /** Koşulun kaç kez tuttuğu (haber sayısı). */
  matches: number;
  /** Üst üste başarısız denetim sayısı ve sonuncusunun nedeni. */
  errors: number;
  lastError: string | null;
  lastChangeAt: IsoDateTime | null;
  /** Son bulunan değişikliğin kısa anlatımı. */
  finding: string | null;
  /** Bitince ya da durunca sonuç cümlesi. */
  result: string | null;
  finishedAt: IsoDateTime | null;
  /** İşi başlatan sohbet oturumu (haber oraya da yazılır). */
  sessionId: Id | null;
}

/** Kaynak listesi (arayüz ve araç açıklaması için). */
export interface WatchSourceInfo {
  kind: string;
  label: string;
  /** Kullanılamıyorsa Türkçe nedeni. Kullanılamayan kaynak modele hiç önerilmez. */
  unavailable: string | null;
  builtin: boolean;
}

// ───────────────────────────── kaynak eklenti arayüzü ─────────────────────────────

/** Bir denetimin sonucu. */
export interface WatchProbe {
  /** Kaynağın durum imzası (özet). Değişmediyse iş modeli ÇAĞIRMAZ, aralık büyür. */
  signature: string;
  /**
   * Koşulların bakacağı metin. `state` kaynakta o anki içerik; `events` kaynakta yalnız önceki imzadan bu yana gelen
   * yeni olaylar (yoksa boş).
   */
  text: string;
  /** Kaynak koşuldan bağımsız "şimdi haber ver" diyorsa (saat kaynağı). */
  fire?: boolean;
  /** Kaynak bir sonraki denetimin anını biliyorsa (saat: tam vakit). Epoch ms. */
  wakeAt?: number;
  /** Değişikliğin kaynağa özgü kısa anlatımı ("Dosya oluştu"). Verilmezse iş kendisi çıkarır. */
  finding?: string;
  /**
   * Bu bulguyu kaynağın SAHİBİ modül kullanıcıya kendisi duyuruyorsa `true` (Claude Code: projeler modülünün "oturum
   * bitti" bildirimi; e-posta: yeni posta bildirimi). O zaman iş ayrıca bildirim göndermez: kullanıcı aynı olayı iki kez
   * duymaz. İş yine "gerçekleşti" diye kaydedilir, sohbete satırı yazılır; işin bir okuma eylemi varsa (yeni bilgi
   * taşır) bildirim yine gönderilir. Söz (Promise) verilebilir: kaynak, sahibinin duyurusunu kısa süre bekleyebilir.
   */
  announcedElsewhere?: boolean | Promise<boolean>;
}

export interface WatchCheckInput {
  target: string;
  /** Önceki imza; ilk denetimde `null`. */
  previous: string | null;
  /** İşin başladığı an (epoch ms): olay kaynakları yalnız bundan sonrakini sayar. */
  since: number;
  signal: AbortSignal;
}

/**
 * Takılıp çıkarılabilen kaynak. Başka bir modül (ör. e-posta) kendi kaynağını `watch.sources.collect` olayına
 * ekleyerek sunar; modül kapanınca dinleyicisi kalkar ve kaynak listeden kendiliğinden düşer:
 *
 * ```ts
 * import type { WatchSourceDef } from '../watch/types';
 * ctx.bus.on('watch.sources.collect', ({ sources }) => sources.push(mailSource));
 * ```
 *
 * Kaynak YAPAY ZEKÂ ÇAĞIRMAZ; yalnız okur ve imza üretir. Hata fırlatırsa iş onu "değişmedi" sayar, aralığı büyütür.
 */
export interface WatchSourceDef {
  kind: string;
  /** Sahibi olan modül. */
  moduleId: string;
  /** Türkçe kısa ad: "E-posta". */
  label: string;
  /** Modele ve onay kartına hedefin ne olduğunu anlatan kısa cümle: "gönderen adresi ya da konudaki sözcük". */
  targetHint: string;
  /**
   * `state`: her denetim kaynağın o anki içeriğini verir (sayfa, dosya, pencere).
   * `events`: her denetim yalnız yeni olayları verir (e-posta, Claude Code). İlk denetimde de yeni olay sayılır.
   */
  mode: 'state' | 'events';
  /** En kısa ve varsayılan en uzun aralık (sn). */
  minIntervalSec: number;
  maxIntervalSec: number;
  /** Kullanılamıyorsa Türkçe neden (izin kapalı, hesap yok). Kullanılamayan kaynak modele önerilmez. */
  available?(): string | null;
  /** Hedefi doğrular ve sadeleştirir; geçersizse Türkçe hata. */
  normalize?(target: string): { target: string } | { error: string };
  /** Onay kartında hedefin insan dili: "atlas.co sayfası", "“muhasebe” e-postaları". */
  describe(target: string): string;
  check(input: WatchCheckInput): Promise<WatchProbe>;
  /** Olay kaynağı: yeni olay gelince `poke` çağrılır, iş beklemeden denetlenir. Dönen işlev aboneliği kaldırır. */
  subscribe?(target: string, poke: () => void): () => void;
}

declare module '@fuber/shared' {
  interface Api {
    'watch.list': { req: { status?: WatchStatus[]; limit?: number }; res: WatchJob[] };
    'watch.get': { req: { id: Id }; res: WatchJob };
    'watch.sources': { req: void; res: WatchSourceInfo[] };
    'watch.pause': { req: { id: Id }; res: WatchJob };
    'watch.resume': { req: { id: Id }; res: WatchJob };
    'watch.cancel': { req: { id: Id }; res: WatchJob };
    /** Biten/iptal edilen işi listeden siler. */
    'watch.remove': { req: { id: Id }; res: Ok };
    /** Beklemeden şimdi denetler ("Şimdi bak"). */
    'watch.checkNow': { req: { id: Id }; res: WatchJob };
  }

  interface BusEvents {
    /** Bir iş eklendi, değişti ya da silindi. `job` silinmede `null`. */
    'watch.changed': EntityChange<'job'> & { job: WatchJob | null };
    /**
     * Kaynak toplama: dinleyen modüller kendi kaynaklarını `sources` dizisine ekler (eşzamanlı). Modül kapanınca
     * dinleyicisi kalkar ve kaynağı listeden düşer.
     */
    'watch.sources.collect': { sources: WatchSourceDef[] };
  }

  interface WindowEvents {
    'watch.changed': EntityChange<'job'> & { job: WatchJob | null };
  }
}
