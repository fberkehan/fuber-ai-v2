/**
 * Fuber Yönetim 2 (apps/admin) IPC sözleşmesi. Arayüz yalnız IPC konuşur; ana süreç aynı süreçte
 * koşan kontrol servisinin (`packages/control`) yönetim cephesini doğrudan çağırır (HTTP'ye gitmez:
 * port doluyken de yönetim çalışır). Kanallar `control-api.ts` içindeki yönetim uçlarının karşılığıdır.
 *
 * Anahtar değerleri ana süreçten arayüze ASLA dönmez; arayüz yalnız `KeyStatus` (var/yok, son 4 hane,
 * son sınama) görür. Hatalar `Error.message` olarak Türkçe gelir.
 */

import type {
  AdminUsageResponse,
  AuditEntry,
  DeviceRecord,
  KeyStatus,
  KeyTestResult,
  PolicyRevisionRecord,
  ProviderModelInfo,
  ProviderVoiceInfo,
} from './control-api';
import type { AppInfo, ClaudeCodeInfo, IsoDateTime } from './entities';
import type { Bridge, Ok } from './ipc';
import type { KeyProvider, Policy, PolicyPatch } from './policy';
import type { CloudModelInfo } from './cloud-providers';

/** Gömülü kontrol servisinin durumu. */
export interface ControlServiceStatus {
  running: boolean;
  /** `http://127.0.0.1:47820`. */
  url: string;
  port: number;
  startedAt: IsoDateTime | null;
  /** Kontrol veritabanının mutlak yolu. */
  dbPath: string;
  /** `safeStorage` kullanılabiliyor mu; `false` ise anahtar kasası yazmayı reddeder. */
  encryptionAvailable: boolean;
  /** Başlatma hatası (ör. port dolu); yoksa `null`. */
  error: string | null;
}

/** Yönetim uygulamasının bu bilgisayara özgü ayarları (politikadan ayrı). */
export interface AdminSettings {
  /** Windows açılınca gizli (tepside) başla. Varsayılan açık. */
  openAtLogin: boolean;
  /**
   * Açılış kaydı bu kipte yazılabiliyor mu. Yalnız kurulu (paketli) uygulamada `true`; geliştirme ve
   * sınamada `false` (ayar saklanır ama sisteme yazılmaz; arayüz anahtarı devre dışı gösterir).
   */
  openAtLoginSupported: boolean;
}

/** "v1'den aktar" ön izlemesi: hiçbir değer çözülmeden yalnız neyin bulunacağı. */
export interface V1ImportPreview {
  /** v1 anahtar deposu bulundu ve okunabildi mi. */
  found: boolean;
  /** Bakılan klasör (`%APPDATA%\Fuber AI`); bilinmiyorsa `null`. */
  dir: string | null;
  /** Depoda kaydı olan sağlayıcılar (yalnız adlar). */
  providers: KeyProvider[];
  /** Bu sağlayıcılardan kasada zaten anahtarı olanlar (aktarım bunların üstüne yazar). */
  overwrites: KeyProvider[];
  /** Asıl dosya okunamadı, yedekten (`sirlar.json.bak`) okundu. */
  usedBackup: boolean;
  /** Türkçe tek cümle özet: "Anthropic ve Gemini anahtarı bulundu." */
  message: string;
}

export interface V1ImportResult {
  /** Kasaya yazılan sağlayıcılar. */
  imported: KeyProvider[];
  /** Türkçe özet (anahtar içermez). */
  message: string;
  /** Aktarılan her anahtarın aktarım sonrası sınama sonucu. */
  tests: KeyTestResult[];
}

export interface AdminApi {
  // ───────── app ─────────
  'app.info': { req: void; res: AppInfo };
  /** `close`: pencere gizlenir, uygulama tepside yaşamaya devam eder. */
  'app.window': { req: { action: 'minimize' | 'toggleMaximize' | 'close' }; res: { maximized: boolean } };
  /** Yalnız `http:`/`https:` adresleri varsayılan tarayıcıda açar. */
  'app.openExternal': { req: { url: string }; res: Ok };

  // ───────── settings: bu bilgisayara özgü ─────────
  'settings.get': { req: void; res: AdminSettings };
  'settings.update': { req: { patch: Partial<Pick<AdminSettings, 'openAtLogin'>> }; res: AdminSettings };

  // ───────── service ─────────
  'service.status': { req: void; res: ControlServiceStatus };
  /** Servisi yeniden başlatır (port değişikliği ya da hata sonrası). */
  'service.restart': { req: void; res: ControlServiceStatus };

  // ───────── policy ─────────
  /** Anahtarsız güncel politika. */
  'policy.get': { req: void; res: Policy };
  /**
   * Alan bazında yamayı uygular, yeni sürüm yayınlar. `baseRevision` güncel değilse hata döner; arayüz yeniden
   * yükleyip tekrar dener. Şemaya uymayan yama "Politika geçersiz: persona.name: …" hatası verir.
   */
  'policy.update': { req: { baseRevision: number; patch: PolicyPatch; note: string }; res: Policy };
  /** Yeniden eskiye. */
  'policy.history': { req: { limit: number }; res: PolicyRevisionRecord[] };
  /** Verilen sürümün içeriğini yeni sürüm olarak yayınlar (anahtarlara dokunmaz). */
  'policy.rollback': { req: { revision: number }; res: Policy };
  /** Acil durdurmayı açar/kapatır (politika yamasının kısayolu; denetim kaydına ayrıca düşer). */
  'policy.setKillSwitch': { req: { active: boolean; message?: string }; res: Policy };

  // ───────── devices ─────────
  'devices.list': { req: void; res: DeviceRecord[] };
  'devices.approve': { req: { id: string }; res: DeviceRecord };
  'devices.revoke': { req: { id: string }; res: DeviceRecord };
  'devices.delete': { req: { id: string }; res: Ok };

  // ───────── keys ─────────
  'keys.list': { req: void; res: KeyStatus[] };
  /** Anahtarı şifreli kasaya yazar (şifreleme yoksa reddeder). Sınamaz; ardından `keys.test` çağrılır. */
  'keys.set': { req: { provider: KeyProvider; value: string }; res: KeyStatus };
  'keys.delete': { req: { provider: KeyProvider }; res: KeyStatus };
  /**
   * `value` yoksa kasadaki anahtarı sınar ve sonucu kaydeder (`KeyStatus.lastTest`); `value` verilirse kasaya
   * yazmadan yalnız o değeri sınar. ElevenLabs politikada seçili ses ve modelle sınanır.
   */
  'keys.test': { req: { provider: KeyProvider; value?: string }; res: KeyTestResult };
  /** v1 deposunu salt okunur tarar; hiçbir değer çözülmez. "v1'den aktar" düğmesinin onay penceresi için. */
  'keys.previewV1Import': { req: void; res: V1ImportPreview };
  /** v1 deposundaki sağlayıcı anahtarlarını çözüp kasaya yazar ve sınar (v1 dosyaları salt okunur). */
  'keys.importV1': { req: void; res: V1ImportResult };

  // ───────── providers: seçim listeleri ─────────
  /** Kasadaki Anthropic anahtarıyla sağlayıcının model listesi. Anahtar yoksa hata. */
  'models.list': { req: void; res: ProviderModelInfo[] };
  /** Kasadaki ElevenLabs anahtarıyla hesabın ses listesi. Anahtar yoksa hata. */
  'voices.list': { req: void; res: ProviderVoiceInfo[] };
  /**
   * OpenAI uyumlu sağlayıcının (`Policy.providers` kaydı) model listesi, kasadaki anahtarıyla. `baseUrl` verilirse
   * kaydedilmemiş (taslaktaki) adres denenir. Anahtar yoksa ya da sağlayıcı reddederse hata.
   */
  'providers.models': { req: { endpointId: string; baseUrl?: string; preset?: Policy['providers'][number]['preset']; keyId?: KeyProvider }; res: CloudModelInfo[] };

  /** Bu bilgisayardaki Claude Code CLI'nin durumu ("Derin işler" satırının altındaki durum yazısı için). */
  'deep.claudeCode': { req: void; res: ClaudeCodeInfo };

  // ───────── usage · audit ─────────
  'usage.summary': { req: { days: number }; res: AdminUsageResponse };
  /** Yeniden eskiye; `before` verilirse o kimlikten eski kayıtlar. */
  'audit.list': { req: { limit: number; before?: number }; res: AuditEntry[] };

  // ───────── voice ─────────
  /**
   * Ses ekranındaki "Dene": verilen sesle kısa bir örnek üretir (metin en çok 300 karakter).
   * Yalnız bulut sağlayıcılar burada üretilebilir; yerel ses masaüstünde denenir. Plan yetersizse
   * `ok: false` ve sağlayıcının açıklaması döner (hata fırlatmaz).
   */
  'voice.preview': {
    req: { text: string; provider: 'elevenlabs'; voiceId?: string; model?: string };
    res: { ok: boolean; message: string; audioBase64: string | null; mimeType: string | null };
  };
}

export interface AdminEvents {
  'service.status': ControlServiceStatus;
  /** Cihaz listesi değişti (yeni kayıt, onay, kalp atışı). */
  'devices.changed': { ids: string[] };
  /** Politika yeni sürüme geçti. */
  'policy.changed': { revision: number };
  /** Kasadaki bir anahtar eklendi, silindi ya da sınandı; arayüz `keys.list` ile yeniler. */
  'keys.changed': { provider: KeyProvider };
  'audit.added': AuditEntry;
}

export type AdminBridge = Bridge<AdminApi, AdminEvents>;
