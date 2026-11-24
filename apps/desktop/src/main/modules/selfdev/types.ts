// Çekirdek kendini geliştirme (Katman 2, KURGU §10.13): varlıklar, IPC kanalları ve olaylar.
// Tip genişletmesidir; çekirdek sözleşmeye dokunmaz. Sayfa bu dosyayı yalnız `import type` ile alır.
import type { ToolOrigin } from '@fuber/shared';

/**
 * Koşunun durumu. Akış: queued → planning → implementing → verifying ⇄ fixing → packaging → ready → installing →
 * restarting → installed. Terminal: installed · failed · cancelled · rolled_back.
 */
export type RunStatus =
  | 'queued'
  | 'planning'
  | 'implementing'
  | 'verifying'
  | 'fixing'
  | 'packaging'
  | 'ready'
  | 'installing'
  | 'restarting'
  | 'installed'
  | 'failed'
  | 'cancelled'
  | 'rolled_back';

/** Bir sınama adımının sonucu (typecheck, test, e2e). */
export interface CheckResult {
  /** `typecheck`, `test`, `e2e:smoke`… */
  name: string;
  command: string;
  ok: boolean;
  exitCode: number | null;
  durationMs: number;
  /** Çıktının son bölümü (düzeltme turuna ve sayfaya gider). */
  tail: string;
  /** Kaçıncı sınama turu (0 = ilk, 1-2 = düzeltmeden sonra). */
  round: number;
}

export interface SelfdevRun {
  id: string;
  /** Kullanıcının isteği (kendi sözü). */
  request: string;
  /** Neden eklentiyle olmadığı (kullanıcıya söylenen). */
  reason: string;
  /** İstek hangi yoldan geldi: `voice`, `chat`, `ui`, `escalate`. */
  origin: string;
  status: RunStatus;
  /** Kullanıcıya sade dille plan özeti. */
  planSummary: string | null;
  /** Planın tam metni. */
  planText: string | null;
  /** Planın dokunacağını söylediği dosyalar. */
  planFiles: string[];
  /** Plandaki risk notu. */
  planRisk: string | null;
  branch: string | null;
  worktree: string | null;
  baseCommit: string | null;
  headCommit: string | null;
  /** Gerçekten değişen dosyalar (git farkından). */
  files: string[];
  /** Dikkat gerektiren değişiklikler (güvenlik kapısı dosyası, bağımlılık). */
  riskFlags: string[];
  checks: CheckResult[];
  /** Kaç düzeltme turu yapıldı. */
  fixRounds: number;
  /** Çalışırken kurulu olan sürüm. */
  fromVersion: string;
  /** Üretilen sürüm (paketleme öncesi `null`). */
  version: string | null;
  packagePath: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export type EventKind = 'status' | 'step' | 'tool' | 'text' | 'check' | 'note' | 'error';

/** Koşu günlüğü satırı (Geliştirme sayfasındaki canlı adım günlüğü). */
export interface SelfdevEvent {
  id: number;
  runId: string;
  at: string;
  kind: EventKind;
  text: string;
}

/** Kurulumdan önce yazılan, açılışta okunan kayıt (sağlık denetimi bunu bekler). */
export interface PendingUpdate {
  runId: string;
  /** `install`: yeni sürüme geçiş · `rollback`: önceki sürüme dönüş. */
  kind: 'install' | 'rollback';
  fromVersion: string;
  toVersion: string;
  /** Açılışta sağlık işareti yazmadan biten açılış sayısı. */
  attempts: number;
  at: string;
}

/** Kurulu sürüm geçmişi kaydı (eski → yeni; sonuncusu şu an kurulu). */
export interface InstalledVersion {
  version: string;
  at: string;
  runId: string | null;
  /** Bu sürümün kurulum paketi (varsa). */
  packagePath: string | null;
  /** Bu sürümün kurulum klasörü anlık kopyası (varsa; ilk güncellemeden önce alınır). */
  snapshotPath: string | null;
}

export interface SelfdevState {
  installed: InstalledVersion[];
  pending: PendingUpdate | null;
  /** Yeni sürüm açıldı ama sağlıksız göründü: geri alma öneriliyor. */
  healthFailed: { runId: string; reason: string; at: string } | null;
  /** Üretilen son `-dev.N` numarası (aynı numara iki kez üretilmesin). */
  lastDevNumber: number;
}

/** Geliştirici kipi kapısının sonucu. */
export interface GateState {
  open: boolean;
  /** Kapalıysa nedeni (Türkçe). */
  reason: string | null;
  /** Hangi koşul eksik: yönetim izni, cihaz anahtarı, depo yolu. */
  policy: boolean;
  setting: boolean;
  repoPath: string | null;
  repoOk: boolean;
}

export interface VersionPanel {
  current: string;
  previous: string | null;
  /** Geri alma nasıl yapılır: anlık kopya, paket ya da yok. */
  rollbackVia: 'snapshot' | 'package' | null;
  history: Array<{ version: string; at: string }>;
}

export interface SelfdevStatus {
  gate: GateState;
  /** Süren (planlama … paketleme) koşu. */
  active: SelfdevRun | null;
  /** Kurulum onayı bekleyen koşu. */
  ready: SelfdevRun | null;
  versions: VersionPanel;
  pending: PendingUpdate | null;
  healthFailed: SelfdevState['healthFailed'];
  /** Derin beyin (Claude Code) hazır mı. */
  deep: { ok: boolean; reason: string | null };
  /** Bu kipte gerçek kurulum yapılabilir mi (paketli uygulama). */
  install: { ok: boolean; reason: string | null };
}

declare module '@fuber/shared' {
  interface Api {
    'selfdev.status': { req: Record<string, never>; res: SelfdevStatus };
    'selfdev.runs': { req: { limit: number }; res: SelfdevRun[] };
    'selfdev.run': { req: { id: string }; res: { run: SelfdevRun; events: SelfdevEvent[] } | null };
    'selfdev.start': { req: { request: string; reason?: string }; res: { ok: boolean; text: string; runId?: string } };
    'selfdev.cancel': { req: Record<string, never>; res: { ok: boolean; text: string } };
    'selfdev.install': { req: { run?: string }; res: { ok: boolean; text: string } };
    'selfdev.rollback': { req: Record<string, never>; res: { ok: boolean; text: string } };
    /** Ayarlar sayfası: bu yol geçerli bir kaynak deposu mu. */
    'selfdev.checkRepo': { req: { path: string }; res: { ok: boolean; reason: string | null } };
  }
  interface BusEvents {
    'selfdev.changed': { runId: string | null; status: RunStatus | null };
    /** Atölye: bu istek eklentiyle yapılamıyor; çekirdek geliştirme gerekir. Yalnız kullanıcının kendi isteğinden doğan yapımlarda yayınlanır. */
    'selfdev.escalate': { request: string; reason: string; origin: ToolOrigin };
  }
  interface WindowEvents {
    'selfdev.changed': { runId: string | null; status: RunStatus | null };
  }
}
