/**
 * Kontrol servisi HTTP sözleşmesi (KURGU §11.2). Sunucu: `packages/control` (Hono + SQLite);
 * istemciler: masaüstü `policy` servisi (cihaz belirteciyle) ve Fuber Yönetim (yönetici belirteciyle).
 *
 * Kimlik: `Authorization: Bearer <belirteç>`. Cihaz uçları cihaz belirteci, `/v1/admin/*` yönetici belirteci ister.
 * Gövdeler JSON'dur. Hata yanıtları `ControlErrorBody` taşır.
 */

import type { IsoDateTime, UsageKind } from './entities';
import type { KeyProvider, Policy, PolicyPatch } from './policy';

export const CONTROL_ROUTES = {
  health: '/v1/health',
  registerDevice: '/v1/devices/register',
  policy: '/v1/policy',
  usage: '/v1/usage',
  heartbeat: '/v1/heartbeat',
  admin: {
    policy: '/v1/admin/policy',
    policyHistory: '/v1/admin/policy/history',
    policyRollback: '/v1/admin/policy/rollback',
    devices: '/v1/admin/devices',
    /** `POST /v1/admin/devices/:id/approve` */
    deviceApprove: (id: string) => `/v1/admin/devices/${encodeURIComponent(id)}/approve`,
    /** `POST /v1/admin/devices/:id/revoke` */
    deviceRevoke: (id: string) => `/v1/admin/devices/${encodeURIComponent(id)}/revoke`,
    /** `DELETE /v1/admin/devices/:id` */
    device: (id: string) => `/v1/admin/devices/${encodeURIComponent(id)}`,
    usage: '/v1/admin/usage',
    keys: '/v1/admin/keys',
    /** `PUT` / `DELETE /v1/admin/keys/:provider` */
    key: (provider: KeyProvider) => `/v1/admin/keys/${provider}`,
    /** `POST /v1/admin/keys/:provider/test` */
    keyTest: (provider: KeyProvider) => `/v1/admin/keys/${provider}/test`,
    audit: '/v1/admin/audit',
    /** `GET`: kasadaki Anthropic anahtarıyla sağlayıcının model listesi. */
    models: '/v1/admin/providers/anthropic/models',
    /** `GET`: kasadaki ElevenLabs anahtarıyla ses listesi. */
    voices: '/v1/admin/providers/elevenlabs/voices',
    /** `GET`: OpenAI uyumlu sağlayıcı kaydının (`Policy.providers`) model listesi, kasadaki anahtarıyla. */
    cloudModels: (endpointId: string) => `/v1/admin/providers/cloud/${encodeURIComponent(endpointId)}/models`,
  },
} as const;

/** `GET /v1/health` yanıtındaki servis adı; port doluyken "bizim servis mi" ayrımı bununla yapılır. */
export const CONTROL_SERVICE_NAME = 'fuber-control';

export type ControlErrorCode =
  | 'unauthorized' // 401: belirteç yok ya da bilinmiyor
  | 'device_pending' // 403: cihaz kayıtlı ama henüz onaylanmadı
  | 'device_revoked' // 403: cihazın yetkisi alındı
  | 'not_found' // 404
  | 'conflict' // 409: `baseRevision` güncel değil
  | 'invalid_request' // 422: gövde şemaya uymuyor
  | 'internal'; // 500

export interface ControlErrorBody {
  error: ControlErrorCode;
  /** Türkçe açıklama. */
  message: string;
}

// ───────────────────────────── Cihaz uçları ─────────────────────────────

/** `GET /v1/health` — kimlik gerekmez. */
export interface HealthResponse {
  ok: true;
  /** Kontrol servisinin sürümü. */
  version: string;
  time: IsoDateTime;
  /** Her zaman `CONTROL_SERVICE_NAME`. */
  service: typeof CONTROL_SERVICE_NAME;
}

/** `POST /v1/devices/register` — kimlik gerekmez. */
export interface RegisterDeviceRequest {
  /** Kullanıcıya görünen cihaz adı; varsayılan bilgisayar adı. */
  name: string;
  platform: string;
  arch: string;
  appVersion: string;
  /**
   * Cihazın kalıcı kimliği (ilk açılışta üretilir, yerelde saklanır). Aynı kimlikle yeniden kayıt
   * yeni cihaz açmaz: var olan kaydın belirteci yenilenir, onay durumu korunur.
   */
  installId: string;
}

export interface RegisterDeviceResponse {
  deviceId: string;
  /** Cihaz belirteci. Yalnız bu yanıtta görünür; sunucu yalnız özetini saklar. */
  token: string;
  status: DeviceStatus;
}

export type DeviceStatus = 'pending' | 'approved' | 'revoked';

/**
 * `GET /v1/policy` — cihaz belirteci.
 * Sorgu: `?wait=<saniye>` (uzun yoklama, en çok 30). Başlık: `If-None-Match: <etag>`.
 * Yanıt: `200 PolicyEnvelope` (+ `ETag` ve `X-Device-Status` başlıkları) · `304` (değişmedi; `wait` süresince
 * bekledikten sonra; `X-Device-Status` yine gelir) · `401 unauthorized`.
 *
 * Onay bekleyen (`pending`) ya da yetkisi alınmış (`revoked`) cihaz 403 ALMAZ: anahtarsız politika
 * (`keys: {}`) ve `status` alır. Böylece masaüstü durumu gösterebilir, onay gelince uzun yoklama hemen
 * anahtarlı zarfı getirir (durum ETag'e dahildir).
 */
export interface PolicyEnvelope {
  /** Politika; anahtarlar yalnız `status === 'approved'` iken dolu. */
  policy: Policy;
  /** Politika sürümü + cihaz durumu + anahtarların özeti; `If-None-Match` ile geri gönderilir. */
  etag: string;
  serverTime: IsoDateTime;
  /** Cihazın onay durumu. */
  status: DeviceStatus;
}

/** Cihazın kontrol servisine bildirdiği tek kullanım olayı. İçerik (metin, ses) taşımaz. */
export interface UsageEvent {
  /** Cihazda üretilen kimlik; yinelenen gönderim sunucuda tek sayılır. */
  id: string;
  at: IsoDateTime;
  kind: UsageKind;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  audioSeconds: number;
  costUsd: number;
  /** `false`: fiyat bilinmiyor (`costUsd` 0'dır ama gerçek değil). Eski cihazlar alanı göndermez: bilinir sayılır. */
  costKnown?: boolean;
  durationMs: number;
}

/**
 * `POST /v1/usage` — cihaz belirteci. En çok 500 olay.
 * `403 device_pending | device_revoked`: onaysız ya da yetkisi alınmış cihaz kullanım bildiremez.
 */
export interface UsageReportRequest {
  events: UsageEvent[];
}
export interface UsageReportResponse {
  /** Kabul edilen (yeni) olay sayısı. */
  accepted: number;
}

/** `POST /v1/heartbeat` — cihaz belirteci (her durumda kabul edilir; yanıt durumu bildirir). Dakikada bir. */
export interface HeartbeatRequest {
  appVersion: string;
  /** Cihazda yürürlükteki politika sürümü. */
  policyRevision: number;
  /** Uygulamanın açık kaldığı süre (saniye). */
  uptimeSeconds: number;
  /** Ses hattı hazır mı. */
  voiceReady: boolean;
  /** Yüklü modül kimlikleri. */
  modules: string[];
}
export interface HeartbeatResponse {
  serverTime: IsoDateTime;
  /** Sunucudaki güncel politika sürümü; cihazınkinden büyükse cihaz hemen çeker. */
  policyRevision: number;
  status: DeviceStatus;
}

// ───────────────────────────── Yönetim uçları (`/v1/admin/*`) ─────────────────────────────

export interface DeviceRecord {
  id: string;
  name: string;
  platform: string;
  arch: string;
  appVersion: string;
  status: DeviceStatus;
  registeredAt: IsoDateTime;
  approvedAt: IsoDateTime | null;
  /** Son yoklama ya da kalp atışı. */
  lastSeenAt: IsoDateTime | null;
  /** Cihazın bildirdiği politika sürümü. */
  policyRevision: number | null;
  voiceReady: boolean | null;
}

/** `GET /v1/admin/policy` — anahtarsız güncel politika. */
export interface AdminPolicyResponse {
  policy: Policy;
}

/**
 * `PUT /v1/admin/policy` — yamayı uygular, sürümü bir artırır, bekleyen uzun yoklamaları uyandırır.
 * `baseRevision` güncel sürümle eşleşmezse `409 conflict`.
 */
export interface UpdatePolicyRequest {
  baseRevision: number;
  patch: PolicyPatch;
  /** Sürüm geçmişinde görünen kısa not: "voice modeli Haiku'ya alındı". */
  note: string;
}

/** `GET /v1/admin/policy/history?limit=` — yeniden eskiye. */
export interface PolicyRevisionRecord {
  revision: number;
  updatedAt: IsoDateTime;
  note: string;
  /** Bu sürümde değişen üst düzey alanlar. */
  changedKeys: string[];
  /** O sürümün anahtarsız tam hali (geri alma ve karşılaştırma için). */
  policy: Policy;
}

/** `POST /v1/admin/policy/rollback` — verilen sürümün içeriğini yeni sürüm olarak yayınlar. */
export interface RollbackPolicyRequest {
  revision: number;
}

/** `GET /v1/admin/keys` — kasadaki anahtarların durumu; değerler asla dönmez. */
export interface KeyStatus {
  provider: KeyProvider;
  /** Kasada anahtar var mı. */
  present: boolean;
  /** Son dört karakter (tanımak için): "…a1B2". Yoksa `null`. */
  hint: string | null;
  updatedAt: IsoDateTime | null;
  /** Son sınamanın sonucu; hiç sınanmadıysa `null`. */
  lastTest: KeyTestResult | null;
}

/** `PUT /v1/admin/keys/:provider` — anahtarı kasaya yazar (şifreli) ve politika özetini değiştirir. */
export interface SetKeyRequest {
  value: string;
}

/**
 * Sınama sonucu: `valid` geçerli · `invalid` anahtar reddedildi · `insufficient_plan` anahtar tanındı ama
 * plan bu işe yetmiyor (ör. ElevenLabs ücretsiz planda kütüphane sesi: 402) · `unreachable` ağ hatası,
 * zaman aşımı (10 sn) ya da sağlayıcı 5xx · `missing` kasada anahtar yok.
 *
 * Daha ince ayrımlar (eskiden `insufficient_plan` / `valid` altında iletiden ayırt ediliyordu):
 * `no_credit` anahtar tanındı ama hesapta kredi yok / ödeme sorunu var (Anthropic "credit balance is too low") ·
 * `quota_exceeded` anahtar tanındı ama dönemlik kota doldu (ElevenLabs `quota_exceeded`, sağlayıcının kota 429'u) ·
 * `recognized` sağlayıcı anahtarı tanıdı (kimlik doğrulama geçti) ama sınama çağrısı üretim yapmadan bitti; anahtar
 * çalışır sayılır, ayrıntı `message`'dadır.
 */
export type KeyTestStatus =
  | 'valid'
  | 'invalid'
  | 'insufficient_plan'
  | 'unreachable'
  | 'missing'
  | 'no_credit'
  | 'quota_exceeded'
  | 'recognized';

/** Bütün sınama durumları (arayüzde etiket/renk eşlemesi için). */
export const KEY_TEST_STATUSES = [
  'valid',
  'recognized',
  'no_credit',
  'quota_exceeded',
  'insufficient_plan',
  'invalid',
  'unreachable',
  'missing',
] as const satisfies readonly KeyTestStatus[];

/** Sağlayıcı anahtarı tanıdı mı (anahtar doğru; sorun varsa hesapta/planda): arayüz "anahtar yanlış" dememeli. */
export function keyRecognized(status: KeyTestStatus): boolean {
  return status === 'valid' || status === 'recognized' || status === 'no_credit' || status === 'quota_exceeded' || status === 'insufficient_plan';
}

/**
 * `POST /v1/admin/keys/:provider/test` — sağlayıcıya en ucuz gerçek çağrıyı yapar. Gövde isteğe bağlı:
 * `{ value }` verilirse kasaya yazmadan o değer sınanır (sonuç kaydedilmez); yoksa kasadaki anahtar
 * sınanır ve sonuç `KeyStatus.lastTest` olur. ElevenLabs politikada seçili ses ve modelle sınanır.
 */
export interface TestKeyRequest {
  value?: string;
}

export interface KeyTestResult {
  provider: KeyProvider;
  /** Anahtar kullanılabilir: `status` `valid` ya da `recognized`. */
  ok: boolean;
  status: KeyTestStatus;
  /** Türkçe sonuç: "Geçerli." ya da neden; sağlayıcının hata gövdesinin kısaltılmışı dahil, anahtar asla. */
  message: string;
  /** Sağlayıcının döndüğü HTTP durumu; ağ hatasında ve `missing`'de `null`. */
  httpStatus: number | null;
  latencyMs: number;
  at: IsoDateTime;
}

/** Bir gün içinde bir kırılımın toplamı. */
export interface UsageTotals {
  costUsd: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** Fiyatı bilinmeyen çağrı sayısı (`costUsd` bunları içermez). Alan yoksa 0. */
  unpricedCalls?: number;
}

/** `GET /v1/admin/usage?days=` — gün, rol, model ve cihaz kırılımlı özet; bugün dahil `days` gün, yeniden eskiye. */
export interface AdminUsageDay extends UsageTotals {
  /** Sunucu yerel günü `YYYY-MM-DD`. Kullanımsız günler de sıfırla listelenir. */
  day: string;
  byKind: Partial<Record<UsageKind, UsageTotals>>;
  byModel: Array<UsageTotals & { provider: string; model: string }>;
  byDevice: Array<{ deviceId: string; costUsd: number; calls: number }>;
}
export interface AdminUsageResponse {
  days: AdminUsageDay[];
  /** Bugünkü toplam ve bütçe. */
  today: { costUsd: number; budgetUsd: number };
}

export type AuditAction =
  | 'policy.update'
  | 'policy.rollback'
  | 'device.register'
  | 'device.approve'
  | 'device.revoke'
  | 'device.delete'
  | 'key.set'
  | 'key.delete'
  | 'key.test'
  | 'killswitch.on'
  | 'killswitch.off';

/** `GET /v1/admin/audit?limit=&before=<id>` — yeniden eskiye. Sır içermez. */
export interface AuditEntry {
  id: number;
  at: IsoDateTime;
  action: AuditAction;
  /** Eylemi yapan: `admin` ya da cihaz kimliği. */
  actor: string;
  /** Etkilenen şey: cihaz kimliği, sağlayıcı adı ya da politika sürümü. */
  target: string;
  /** İnsan diliyle Türkçe özet. */
  summary: string;
}

/** Sağlayıcının model listesindeki bir model (`GET /v1/models`). */
export interface ProviderModelInfo {
  /** `claude-opus-5-5` */
  id: string;
  displayName: string;
  createdAt: IsoDateTime | null;
}

/** ElevenLabs ses listesindeki bir ses (`GET /v1/voices`). */
export interface ProviderVoiceInfo {
  voiceId: string;
  name: string;
  /** `premade` (hazır; ücretsiz planda API'den kullanılabilir) · `cloned` · `generated` · `professional` … */
  category: string | null;
  previewUrl: string | null;
  /** Sesin etiketlerindeki dil; çoğu hazır seste boş. */
  language: string | null;
}

/** Bütün yönetim uçlarının yanıt tipleri tek yerde (istemci yazarken tamamlama için). */
export interface AdminEndpoints {
  'GET /v1/admin/policy': { res: AdminPolicyResponse };
  'PUT /v1/admin/policy': { req: UpdatePolicyRequest; res: AdminPolicyResponse };
  'GET /v1/admin/policy/history': { res: PolicyRevisionRecord[] };
  'POST /v1/admin/policy/rollback': { req: RollbackPolicyRequest; res: AdminPolicyResponse };
  'GET /v1/admin/devices': { res: DeviceRecord[] };
  'POST /v1/admin/devices/:id/approve': { res: DeviceRecord };
  'POST /v1/admin/devices/:id/revoke': { res: DeviceRecord };
  'DELETE /v1/admin/devices/:id': { res: { ok: true } };
  'GET /v1/admin/usage': { res: AdminUsageResponse };
  'GET /v1/admin/keys': { res: KeyStatus[] };
  'PUT /v1/admin/keys/:provider': { req: SetKeyRequest; res: KeyStatus };
  'DELETE /v1/admin/keys/:provider': { res: KeyStatus };
  'POST /v1/admin/keys/:provider/test': { req: TestKeyRequest; res: KeyTestResult };
  'GET /v1/admin/audit': { res: AuditEntry[] };
  'GET /v1/admin/providers/anthropic/models': { res: ProviderModelInfo[] };
  'GET /v1/admin/providers/elevenlabs/voices': { res: ProviderVoiceInfo[] };
}
