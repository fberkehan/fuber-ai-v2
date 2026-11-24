// Uygulama içi (canlı) Claude Code oturumlarının sayfayla paylaşılan tipleri ve IPC sözleşmesi.
// Sayfa bu dosyayı `import type` ile alır; burada Node'a özgü hiçbir şey olmamalı.
import type { Id } from '@fuber/shared';
import type {
  BackgroundTask,
  EffortLevel,
  PermissionMode,
  PermissionRequestEvent,
  StreamEvent,
  TodoItem,
  TokenUsage,
} from '../../../core/claude-cli/session-events';

export type {
  AskQuestion,
  BackgroundTask,
  EffortLevel,
  PermissionMode,
  PermissionRequestEvent,
  StreamEvent,
  TodoItem,
  TokenUsage,
  ToolKind,
  TurnResultEvent,
} from '../../../core/claude-cli/session-events';

/**
 * Oturumun görünen durumu.
 * `queued` sırada (eşzamanlı sınır) · `running` çalışıyor · `permission` izin bekliyor · `done` tur bitti ·
 * `stopped` durduruldu · `error` hata/çökme · `limit` kullanım sınırı doldu · `idle` henüz ileti yok · `closed` kapatıldı.
 */
export type LiveStatus = 'queued' | 'running' | 'permission' | 'done' | 'stopped' | 'error' | 'limit' | 'idle' | 'closed';

/** Oturumu kim başlattı: Projeler sayfası ya da asistan (ses/sohbet aracı). */
export type LiveSource = 'page' | 'assistant';

/** Listede görünen özet; döküm içermez. */
export interface LiveSessionSummary {
  /** Uygulama içi kimlik (bu çalıştırmaya özgü). */
  id: string;
  /** Claude Code'un oturum kimliği (ilk `init`ten sonra; sürdürülen oturumda baştan). Oturum dizinindeki `CodeSession.id`. */
  sessionId?: string;
  cwd: string;
  projectId: Id | null;
  projectName: string;
  title: string;
  status: LiveStatus;
  mode: PermissionMode;
  /** Kullanıcının seçtiği model (takma ad ya da kimlik); yoksa Claude Code'un varsayılanı. */
  model?: string;
  /** Claude Code'un bildirdiği çözülmüş model kimliği (yalnız gösterim). */
  activeModel?: string;
  effort?: EffortLevel;
  source: LiveSource;
  /** Asistan sohbetinden verildiyse o sohbet oturumu (bitince özet oraya düşer). */
  chatSessionId?: Id;
  pendingPermissions: number;
  /** Bu oturumda sırada bekleyen ileti sayısı. */
  queued: number;
  /** Eşzamanlı sınır yüzünden sıradaysa sıra numarası (1'den). */
  queuePosition?: number;
  /** Arka planda süren iş sayısı (tur bitse de sürer). */
  background: number;
  /** Yalnız API anahtarıyla çalışan oturumda dolu. */
  costUsd?: number;
  usage?: TokenUsage;
  durationMs?: number;
  turns?: number;
  changedFiles: number;
  version?: string;
  /** Klasörün kendi Claude Code ayarları yüklenmeden çalışıyor (güvenilmedi ya da karar yok). */
  untrusted?: boolean;
  error?: string;
  /** `limit` durumunda sınırın sıfırlanma anı (epoch ms), biliniyorsa. */
  limitResetsAt?: number | null;
  createdAt: number;
  lastActivityAt: number;
}

/** Oturum yöneticisinin akışa eklediği olaylar. */
export type LiveEvent =
  | StreamEvent
  | PermissionRequestEvent
  | { type: 'permission_resolved'; requestId: string; decision: 'allow' | 'always' | 'deny' | 'cancelled' }
  /** Anlık hâl; dökümde tutulmaz. */
  | { type: 'status'; summary: LiveSessionSummary }
  /** Oturum kaydı silindi: arayüz listeden kaldırır. */
  | { type: 'forgotten' };

/** `projects.claudeEvent` yükü. `seq` oturum başına artar (sıralama ve tekrar ayıklama). */
export interface LiveEnvelope {
  session: string;
  seq: number;
  at: number;
  event: LiveEvent;
}

export interface LiveSessionDetail extends LiveSessionSummary {
  /** Döküm (en çok son 2000 olay). Akan metin blok başına tek birikimli `text_delta` kaydıdır. */
  events: LiveEnvelope[];
  permissions: PermissionRequestEvent[];
  queue: Array<{ id: string; text: string; images: number }>;
  changedFilesList: string[];
  todos: TodoItem[];
  tasks: BackgroundTask[];
  /** Claude Code'un bu oturumda sunduğu eğik çizgi komutları (`/compact` …) ve becerileri. */
  commands: LiveCommand[];
}

export interface LiveCommand {
  name: string;
  description: string;
  argumentHint: string;
}

export interface LiveModel {
  value: string;
  label: string;
  description: string;
}

export interface LiveImage {
  mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
  /** base64. */
  data: string;
}

/** Klasör güveni: klasörün kendi Claude Code ayarları (kancalar, izin kuralları, MCP sunucuları) var mı, karar ne. */
export interface FolderTrustState {
  cwd: string;
  /** Klasörün kendi ayarı var: karar gerekir. */
  required: boolean;
  decision: 'trust' | 'distrust' | null;
  /** Kararı kim verdi: kullanıcı bu uygulamada mı, yoksa Claude Code'un kendi kaydı mı (terminalde daha önce güvenilmiş). */
  decidedBy: 'user' | 'claude-code' | null;
  /** Bulunan ayar dosyaları: göreli yol ve tek satırlık özet. */
  files: Array<{ path: string; summary: string }>;
  hooks: boolean;
  mcp: boolean;
}

export type LiveOpCode =
  | 'not_found'
  | 'invalid'
  | 'no_folder'
  | 'unknown_folder'
  | 'protected_folder'
  | 'trust_required'
  | 'open_elsewhere'
  | 'full_access_off'
  | 'busy'
  | 'empty'
  | 'too_large'
  | 'queue_full'
  | 'shutting_down'
  | 'no_cli'
  | 'unsupported'
  | 'bad_answer'
  | 'next_turn';

export interface LiveOpResult {
  ok: boolean;
  code?: LiveOpCode;
  /** Kullanıcıya gösterilecek Türkçe ileti. */
  error?: string;
}

export interface LiveStartRequest {
  /** Proje kimliği ya da doğrudan klasör; ikisi de yoksa `resume` oturumunun klasörü kullanılır. */
  projectId?: Id;
  cwd?: string;
  prompt?: string;
  images?: LiveImage[];
  /** Sürdürülecek Claude Code oturum kimliği. */
  resume?: string;
  /** `resume` ile: yeni kimlikle çatalla. */
  fork?: boolean;
  mode?: PermissionMode;
  model?: string | null;
  effort?: EffortLevel | null;
  title?: string;
  /** "Başka yerde açık" uyarısına rağmen sürdür. */
  force?: boolean;
}

export interface LiveStartResult extends LiveOpResult {
  session?: LiveSessionSummary;
  /** `code: 'trust_required'` ise klasörün durumu (kart için). */
  trust?: FolderTrustState;
}

export interface LivePermissionAnswer {
  decision: 'allow' | 'always' | 'deny';
  reason?: string;
  /** AskUserQuestion: soru metni → seçenek etiketi (çoklu seçimde dizi) ya da serbest metin. */
  answers?: Record<string, string | string[]>;
  /** "Diğer" ile serbest metin yanıtlanan sorular. */
  freeText?: string[];
}

/** Cihazda kalan oturum yönetimi ayarları (`projects.claudeConfig`). */
export interface LiveConfig {
  /** "Tam yetki" kipi seçilebilir mi. Varsayılan kapalı. */
  fullAccess: boolean;
  /** Yeni oturumun izin kipi. Varsayılan `default` (her şeyi sor). */
  defaultMode: PermissionMode;
  /** Yeni oturumun modeli; boş = Claude Code'un varsayılanı. */
  defaultModel: string;
  /** Aynı anda çalışan tur sınırı (1–8). */
  maxConcurrent: number;
}

/** Claude Code'un bu bilgisayardaki durumu ve oturum yönetimi ayarları. */
export interface LiveEnvironment {
  installed: boolean;
  version: string | null;
  /** Oturum açık mı; yoklanamadıysa `null`. */
  loggedIn: boolean | null;
  /** Hesap (yalnız e-posta ve plan); bilinmiyorsa `null`. */
  account: { email?: string; plan?: string } | null;
  models: LiveModel[];
  config: LiveConfig;
  /** Şu an çalışan tur sayısı. */
  running: number;
}

export interface GitFile {
  path: string;
  /** `git status --porcelain` durum harfleri: "M", "A", "??"… */
  status: string;
}

export interface GitSummary {
  git: boolean;
  branch?: string;
  files: GitFile[];
}

declare module '@fuber/shared' {
  interface Api {
    'projects.claudeEnvironment': { req: void; res: LiveEnvironment };
    'projects.claudeConfig': { req: { patch?: Partial<LiveConfig> }; res: LiveConfig };
    'projects.claudeSessions': { req: void; res: LiveSessionSummary[] };
    /** `id`: uygulama içi kimlik ya da Claude Code oturum kimliği. Yoksa `null`. */
    'projects.claudeSession': { req: { id: string }; res: LiveSessionDetail | null };
    'projects.claudeStart': { req: LiveStartRequest; res: LiveStartResult };
    'projects.claudeSend': { req: { id: string; text: string; images?: LiveImage[] }; res: LiveOpResult };
    /** Süren turu durdurur. `keepQueue`: bekleyen iletiler kalsın (varsayılan: silinir). */
    'projects.claudeInterrupt': { req: { id: string; keepQueue?: boolean }; res: LiveOpResult };
    'projects.claudePermission': { req: { id: string; requestId: string; answer: LivePermissionAnswer }; res: LiveOpResult };
    'projects.claudeSetMode': { req: { id: string; mode: PermissionMode }; res: LiveOpResult };
    'projects.claudeSetModel': { req: { id: string; model: string | null }; res: LiveOpResult };
    'projects.claudeSetEffort': { req: { id: string; effort: EffortLevel | null }; res: LiveOpResult };
    /** Süreci kapatır; kayıt "kapandı" olarak kalır (yeni ileti sürdürür). */
    'projects.claudeClose': { req: { id: string }; res: LiveOpResult };
    /** Süreci kapatır ve kaydı listeden siler (Claude Code'un kendi dökümüne dokunulmaz). */
    'projects.claudeForget': { req: { id: string }; res: LiveOpResult };
    'projects.claudeRemoveQueued': { req: { id: string; messageId: string }; res: LiveOpResult };
    'projects.claudeStopTask': { req: { id: string; taskId: string }; res: LiveOpResult };
    'projects.claudeBackgroundTask': { req: { id: string; taskId: string }; res: LiveOpResult };
    'projects.claudeTaskOutput': { req: { id: string; taskId: string; lines?: number }; res: { lines: string[]; bytes: number; error?: string } };
    /** Klasörün güven durumu; `decision` verilirse kaydeder (`null` kararı siler). */
    'projects.claudeTrust': { req: { cwd: string; decision?: 'trust' | 'distrust' | null }; res: FolderTrustState };
    /** Oturum klasörünün git özeti (değişen dosyalar) ve tek dosyanın farkı. */
    'projects.claudeGit': { req: { id: string }; res: GitSummary };
    'projects.claudeDiff': { req: { id: string; file: string }; res: { diff: string; truncated: boolean } };
    /** "@" dosya önerisi: en çok 50 göreli yol. */
    'projects.claudeFiles': { req: { id: string; query: string }; res: { files: string[]; truncated: boolean } };
    /** `claude auth login` görünür bir konsolda (Anthropic'in kendi akışı). */
    'projects.claudeLogin': { req: void; res: LiveOpResult };
    /**
     * Sayfa hangi canlı oturumu ŞU AN gösteriyor (pencere odaktayken); göstermiyorsa `null`. İzlenen oturumun "bitti"
     * bildirimi adada/sesle verilmez (kullanıcı zaten görüyor). Sayfa bunu seçim, odak ve görünürlük değişiminde yollar.
     */
    'projects.claudeWatch': { req: { id: string | null }; res: void };
  }
  interface BusEvents {
    'projects.claudeEvent': LiveEnvelope;
    /**
     * Bir oturumun bitişi (ya da hatası) kullanıcıya BİLDİRİLDİ (ada / ses). Aynı bitişi başka bir modül de haber verecekse
     * (İşler: "Claude bitirince haber ver" işi) ikinci bildirimi göndermez: tek haber (demo.3 bütünleştirmesi).
     * Bildirim verilmediyse (kullanıcı oturumu sayfada izliyor) olay da yayınlanmaz.
     */
    'projects.claudeAnnounced': { liveId: string; project: string; status: string };
  }
  interface WindowEvents {
    'projects.claudeEvent': LiveEnvelope;
  }
}
