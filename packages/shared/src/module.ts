/**
 * Modül sözleşmesi (KURGU §4.2). Yeni yetenek = bir klasör:
 * `apps/desktop/src/main/modules/<id>/index.ts` içinde `export default defineModule({...})`.
 * Modüller birbirini import etmez; `ModuleContext` üzerinden çekirdek servislerle ve olay yoluyla konuşur.
 */

import type { z } from 'zod';
import type { ApprovalKind, Id, JsonObject, ModulePage, Permission, Risk, StageCard, ToolOrigin } from './entities';
import type { WindowEvents } from './events';
import type {
  AttentionApi,
  BrainApi,
  Bus,
  ConversationApi,
  IpcHandlers,
  JobsApi,
  Logger,
  MemoryApi,
  Paths,
  PolicyApi,
  PresenceApi,
  SchedulerApi,
  ScopedDb,
  SettingsApi,
  StageApi,
  ToolRegistry,
  UsageApi,
  VoiceApi,
} from './services';

export type { Permission, Risk } from './entities';

/** Bir aracın modele dönen sonucu. */
export interface ToolResult {
  /** `false`: iş yapılmadı. Model bu durumda "yaptım" diyemez (KURGU §2.6). */
  ok: boolean;
  /** Modele giden metin: ne oldu, kısa ve olgusal. Hata ise nedeni ve varsa çözümü. */
  text: string;
  /** Yapılandırılmış sonuç; modele JSON olarak eklenir. JSON'a çevrilebilir olmalı. */
  data?: unknown;
  /** Verilirse sonuç ayrıca sahnede kart olarak gösterilir. */
  show?: StageCard;
}

/** Her araç çağrısına özel bağlam. Modülün kendi `ModuleContext`'ini de taşır. */
export interface ToolContext extends ModuleContext {
  /** Bu çağrının kimliği; günlükte ve `tool.call` olayında aynıdır. */
  callId: Id;
  origin: ToolOrigin;
  /** Kullanıcı söz kestiğinde, acil durdurmada ya da iş iptalinde tetiklenir. Uzun işler bunu dinlemeli. */
  signal: AbortSignal;
  /** Uzun süren araç ara durum bildirir ("3 sayfa okundu"); ada ve sohbet akışında görünür. */
  report(step: string): void;
}

export interface ToolDef<I = unknown> {
  /** snake_case, bütün modüller arasında benzersiz: `reminder_create`. */
  name: string;
  /** Modele gider; ne işe yaradığını ve ne zaman kullanılacağını söyler. */
  description: string;
  /** Girdi şeması. Kayıt sırasında JSON Schema'ya çevrilir; her çağrıda girdi bununla doğrulanır. */
  input: z.ZodType<I>;
  risk: Risk;
  /**
   * Aracın kümesi (isteğe bağlı). Yerel (küçük) beyne araçların hepsi her turda sunulmaz; küme, aracın hangi sözde
   * sunulacağını belirler (`apps/desktop/src/main/core/brain/local-tools.ts`). Bilinen değerler: `core` (her turda),
   * `planner`, `stage`, `projects`, `code`, `voice`, `info` (güncel bilgi), `open` (bir şey açar),
   * `browser`, `pc`, `deep` (derin/bulut beyin ister; yerelde hiç sunulmaz). Verilmezse ad listelerine ve ad önekine
   * (`pc_`, `browser_`, `weather_`…) bakılır; hiçbirine uymayan araç yerel modele sunulmaz. Bulut beyni kümeye bakmaz.
   */
  group?: string;
  /**
   * `danger` araçlar için onay kartında ve sesli onayda kullanılan Türkçe cümle
   * ("‘rapor.docx’ dosyasını kalıcı olarak silmek istiyorum"). Verilmezse açıklama kullanılır.
   */
  approvalText?(input: I): string;
  /** Onayın türü: kapı yetki düzeyine göre sorup sormayacağına bununla karar verir. Verilmezse araç adından bulunur. */
  approvalKind?: ApprovalKind;
  /**
   * Aracın çalıştığı yerin ŞU ANKİ kısa durumu (isteğe bağlı; tek cümle). Araç bir turda yerel modele sunulduğunda
   * bağlam notuna eklenir: model göremediği bir yüzeyi (örn. ana ekrandaki pano: hangi kartlar, hangi sırada) bilerek
   * araç çağırır. Hızlı ve yan etkisiz olmalı; fırlatırsa yok sayılır. Çoğu aracın buna ihtiyacı yoktur.
   */
  contextHint?(): string | null;
  /**
   * Onaydan ÖNCE koşan ret denetimi (isteğe bağlı): girdi hiçbir koşulda çalıştırılmayacaksa nedenini (Türkçe) döndürür,
   * yoksa `null`. Reddedilecek iş için kullanıcıya onay kartı çıkmaz. Eşzamanlı ve yan etkisiz olmalıdır; `run` aynı
   * denetimi yine de kendisi yapar (kapıyı atlayan çağrılar için).
   */
  refuse?(input: I): string | null;
  /**
   * İşi yapar. Fırlatmak yerine `{ ok: false, text }` döndürmek yeğlenir;
   * fırlatılan hata kayıt tarafından yakalanıp `ok: false` sonuca çevrilir.
   */
  run(input: I, ctx: ToolContext): Promise<ToolResult>;
}

/**
 * Şeması zod yerine JSON Schema ile verilen DIŞ araç: kullanıcı yetenekleri (yetenek konağındaki araçlar)
 * ve ileride MCP gibi dış kaynaklar. Kapı kuralları (acil durdurma, onay, konuşmacı, Gizli kip) aynen uygulanır.
 */
export interface ExternalToolDef {
  /** snake_case, bütün araçlar arasında benzersiz. */
  name: string;
  description: string;
  /** JSON Schema (draft 2020-12) nesne şeması. Kayıt, girdiyi çalıştırmadan önce bununla doğrular. */
  inputSchema: JsonObject;
  risk: Risk;
  /** Aracın kümesi (bkz. `ToolDef.group`). */
  group?: string;
  /** Onay kartında gösterilecek Türkçe cümle; verilmezse açıklama kullanılır. */
  approvalText?(input: unknown): string;
  /** Bkz. `ToolDef.approvalKind`. */
  approvalKind?: ApprovalKind;
  /** Onaydan önce koşan ret denetimi (bkz. `ToolDef.refuse`). */
  refuse?(input: unknown): string | null;
  /** Şemaya uyan girdiyle çağrılır. Fırlatırsa `ok: false` sonuca çevrilir. */
  run(input: unknown, ctx: ToolContext): Promise<ToolResult>;
}

/**
 * Modülün kendi tablolarını kuran numaralı göç. Bir kez uygulanır, sırası `id` ile belirlenir.
 * Tablo adları `ScopedDb.prefix` ile başlamalıdır (ör. `planner_reminders`).
 */
export interface Migration {
  /** 1'den başlayan, modül içinde artan numara. Yayınlanmış göç değiştirilmez; yenisi eklenir. */
  id: number;
  /** Günlükte görünen kısa ad: "reminders tablosu". */
  name: string;
  /** SQL metni ya da veriyi dönüştüren işlev. Tek işlem (transaction) içinde koşar. */
  up: string | ((db: ScopedDb) => void);
}

export interface ModuleDef {
  /** kebab-case, benzersiz: `planner`, `voice-control`. Tablo öneki bundan türetilir (`-` → `_`). */
  id: string;
  /** Semver. */
  version: string;
  /** Sözlük anahtarları: `module.<id>.name`, `module.<id>.description`. */
  nameKey: string;
  descriptionKey: string;
  permissions: Permission[];
  migrations?: Migration[];
  tools?: ToolDef[];
  /** Ana pencere sayfası (yalnız yerleşik modüller). Modül kapanınca sayfası da kalkar. */
  page?: ModulePage;
  /**
   * Modülün arayüze açtığı IPC kanalları (`planner.createReminder` gibi; kanal `Api` içinde tanımlı olmalı).
   * Modül yüklenince bağlanır, kapanınca kaldırılır; kapalı modülün kanalı arayüzde hatayla reddedilir.
   */
  ipc?(ctx: ModuleContext): IpcHandlers;
  /**
   * Modülün olay yoluna yaydığı ve pencerelere de aktarılması gereken kendi olayları
   * (tipleri modül klasöründe `BusEvents` ve `WindowEvents` genişletmesiyle tanımlanır).
   */
  windowEvents?: Array<keyof WindowEvents>;
  /** Modül etkinleşince bir kez çağrılır: olay abonelikleri, zamanlayıcı işleyicileri. */
  setup?(ctx: ModuleContext): void | Promise<void>;
  /** Modül kapanırken çağrılır; `setup` içinde açılan her şeyi kapatır. */
  teardown?(): void | Promise<void>;
  /**
   * Kullanıcının bu modülde biriken verisini kalıcı olarak siler (`ModulesApi.purgeData`). Modül KAPALIYKEN de
   * çağrılabilir (Yönetim modülü kapattıktan sonra da kullanıcı kendi verisini silebilmeli); bu yüzden `setup`'ın
   * kurduğu duruma güvenmez, yalnız verilen bağlamla çalışır. Modülün tabloları çağrıdan önce kurulmuştur.
   */
  purge?(ctx: ModuleContext): void | Promise<void>;
}

/** Modüle verilen çekirdek servisler. `db` yalnız modülün kendi tablolarına bakar. */
export interface ModuleContext {
  /** Bu bağlamın ait olduğu modül. */
  moduleId: string;
  bus: Bus;
  db: ScopedDb;
  memory: MemoryApi;
  scheduler: SchedulerApi;
  attention: AttentionApi;
  brain: BrainApi;
  policy: PolicyApi;
  jobs: JobsApi;
  voice: VoiceApi;
  stage: StageApi;
  presence: PresenceApi;
  conversation: ConversationApi;
  settings: SettingsApi;
  usage: UsageApi;
  /** Çalışma anında araç eklemek/çıkarmak için (Atölye yetenekleri). Sıradan modül `ModuleDef.tools` kullanır. */
  tools: ToolRegistry;
  /** Modül adına önekli günlük. */
  log: Logger;
  paths: Paths;
}

/** Tip denetimi ve tamamlama için kimlik işlevi. */
export function defineModule(def: ModuleDef): ModuleDef {
  return def;
}

/**
 * Araç tanımlar; `run` ve `approvalText` girdisinin tipi zod şemasından çıkarılır:
 *
 * ```ts
 * defineTool({
 *   name: 'todo_create',
 *   description: 'Yapılacaklar listesine madde ekler.',
 *   input: z.object({ text: z.string() }),
 *   risk: 'write',
 *   async run({ text }, ctx) { ... return { ok: true, text: 'Eklendi.' }; },
 * })
 * ```
 */
export function defineTool<S extends z.ZodType>(def: {
  name: string;
  description: string;
  input: S;
  risk: Risk;
  /** Aracın kümesi (bkz. `ToolDef.group`). */
  group?: string;
  approvalText?(input: z.infer<S>): string;
  /** Bkz. `ToolDef.approvalKind`. */
  approvalKind?: ApprovalKind;
  /** Bkz. `ToolDef.contextHint`. */
  contextHint?(): string | null;
  /** Onaydan önce koşan ret denetimi (bkz. `ToolDef.refuse`). */
  refuse?(input: z.infer<S>): string | null;
  run(input: z.infer<S>, ctx: ToolContext): Promise<ToolResult>;
}): ToolDef {
  // Kayıt girdiyi `input` şemasıyla doğrulamadan `run` çağırmaz; tip silme bu yüzden güvenlidir.
  return def as unknown as ToolDef;
}
