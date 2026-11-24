// E-posta modülünün kendi IPC kanalları ve olayları (çekirdek sözleşmeye dokunmadan; TUZAKLAR §1). Ayarlar › E-posta ve
// Bugün kartı bu dosyayı `import type` ile içe aktarır. Gözcü (`watch`) gibi başka modüller için sorgu arayüzü de buradadır
// (`mail.query`, `mail.received`): modüller birbirini içe aktarmaz, olay yoluyla konuşur.
import type { Id, IsoDateTime, LocalDay, Ok } from '@fuber/shared';

export type MailProviderId = 'gmail' | 'outlook' | 'yandex' | 'icloud' | 'custom';

export interface MailPreset {
  id: MailProviderId;
  /** Görünen ad; `custom` için boş (sözlükten). */
  label: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  /** Uygulama parolası gibi notun sözlük anahtarı. */
  noteKey: string;
}

/** Hesap formu. Parola yalnız bu istekte taşınır; hiçbir yanıtta, olayda ya da günlükte geri gelmez. */
export interface MailAccountInput {
  /** Var olan hesabı düzenlerken. */
  id?: Id;
  provider: MailProviderId;
  label?: string;
  address: string;
  /** Boşsa adres. */
  username?: string;
  /** Düzenlemede boş bırakılırsa kayıtlı parola kalır (bağlantı değişmediyse). */
  password?: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
}

export interface MailAccountView {
  id: Id;
  provider: MailProviderId;
  /** `imap` parolalı IMAP/SMTP hesabı · `thunderbird` parolasız yerel mbox kaynağı. */
  kind: 'imap' | 'thunderbird';
  label: string;
  address: string;
  username: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  /** Şifreli parola kayıtlı mı (değeri hiçbir zaman arayüze çıkmaz). */
  hasPassword: boolean;
  createdAt: IsoDateTime;
  lastSyncAt: IsoDateTime | null;
  /** Son eşitleme hatası (Türkçe, kısa); yoksa null. */
  lastError: string | null;
  messageCount: number;
  unreadCount: number;
}

export interface MailTestResult {
  imap: boolean;
  smtp: boolean;
  /** Türkçe kısa neden; parola hiçbir zaman içermez. */
  error: string | null;
  /** Tek satırlık özet: "Okuma ✓ · Gönderim ✓". */
  text: string;
}

export interface MailStatus {
  accounts: number;
  syncing: boolean;
  lastSyncAt: IsoDateTime | null;
  nextSyncAt: IsoDateTime | null;
  /** Eşitleme neden durdu: `private` Gizli kip · `kill` acil durdurma · `noCipher` şifreli depo yok · null çalışıyor. */
  paused: 'private' | 'kill' | 'noCipher' | null;
  intervalMinutes: number;
}

export interface MailSummary {
  id: Id;
  accountId: Id;
  /** "Ad <adres>" ya da adres. */
  from: string;
  fromAddress: string;
  subject: string;
  date: IsoDateTime;
  snippet: string;
  seen: boolean;
  /** 0–5; henüz puanlanmadıysa null. */
  importance: number | null;
  reason: string | null;
  attachments: number;
}

/** Kokpit "Önemli e-postalar" kartının verisi (`index.ts` › `dashboard.registerProvider`). */
export interface MailDashboardData {
  items: Array<Pick<MailSummary, 'id' | 'subject' | 'date' | 'importance' | 'reason'> & { from: string }>;
  /** Önemli ileti sayısı (gösterilenden çok olabilir). */
  total: number;
  /** Bir hesabın son eşitlemesi hata verdi: liste eksik olabilir. */
  failing: boolean;
}

// ───────────── Thunderbird'den hesap ayarlarını içe aktarma (`thunderbird.ts`) ─────────────

/** Thunderbird'ün kaydettiği bağlantı güvenliği (`socketType` / `try_ssl`: 0 yok · 2 STARTTLS · 3 SSL/TLS). */
export type ImportSecurity = 'none' | 'starttls' | 'tls';

/** Bulunan bir hesap. Yalnız hesap adı, adres ve sunucu bilgisi; parola ya da belirteç HİÇBİR ZAMAN (okunmaz bile). */
export interface MailImportCandidate {
  /** İçe aktarma isteğinde hesabı tanıtan anahtar: `kaynak:profil:hesap`. */
  key: string;
  source: 'thunderbird' | 'betterbird';
  profile: string;
  /** Thunderbird'deki hesap adı. */
  name: string;
  /** İlk kimliğin adresi; bozuk kayıtta boş olabilir. */
  address: string;
  /** Kimliğin "Ad Soyad"ı (gönderen adı olur). */
  fullName: string;
  /** imap · pop3 · none (yerel klasörler) · nntp · rss · im … */
  type: string;
  provider: MailProviderId;
  username: string;
  imapHost: string;
  imapPort: number;
  imapSecurity: ImportSecurity;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: ImportSecurity;
  /** OAuth2 ile giriş (Gmail, Outlook…): parola yerine uygulama parolası ya da uygulamadan giriş gerekir. */
  oauth: boolean;
  /** Seçilebilir mi (IMAP ve kaydı tam). */
  importable: boolean;
  /** Seçilemiyorsa nedeni (Türkçe, kısa): "POP3 desteklenmiyor", "giden sunucu yok"… */
  reason: string | null;
  /** Uyarılar: güvenlik farkı, ek kimlikler, SMTP kullanıcı adı farkı. */
  notes: string[];
  /** Bu adres (ya da aynı sunucu + kullanıcı adı) uygulamada zaten ekli. */
  existing: boolean;
}

export interface MailImportScan {
  /** En az bir profilde `prefs.js` bulundu. */
  found: boolean;
  /** Profil bulunamadıysa nedeni (düğmenin açıklaması). */
  reason: string | null;
  profiles: Array<{ source: 'thunderbird' | 'betterbird'; name: string; isDefault: boolean }>;
  accounts: MailImportCandidate[];
}

export type MailImportStatus = 'connected' | 'sendFailed' | 'wrongPassword' | 'loginRequired' | 'unreachable' | 'passwordPending' | 'exists' | 'failed' | 'notFound';

export interface MailImportResult {
  key: string;
  address: string;
  status: MailImportStatus;
  /** Türkçe tek satır; parola hiçbir zaman içermez. */
  text: string;
  /** Kaydedildiyse hesabın kimliği. */
  accountId: Id | null;
}

// ───────────── Thunderbird'ün yerel klasöründen okuma (parolasız; `thunderbird-store.ts`) ─────────────

/** Bulunan bir yerel kutu (mbox dosyası). */
export interface MailLocalBox {
  /** Hesap/sunucu (üst klasör adı; "Local Folders" olabilir). */
  account: string;
  /** Kutu adı (INBOX, Sent, Archive, alt klasör…). */
  mailbox: string;
  /** Profil köküne göre göreli yol (anahtar). */
  path: string;
}

/** Yerel kaynağın durumu (Ayarlar › E-posta). Parola, sunucu, port YOKTUR. */
export interface MailLocalStatus {
  /** Profil ve en az bir mbox bulundu mu (otomatik ya da seçilen klasörde). */
  found: boolean;
  /** Kullanılan profil adı; bulunamazsa null. */
  profile: string | null;
  /** Yerel kaynak açık mı (okuma yapılıyor). */
  enabled: boolean;
  /** Bulunan kutular (hesap + kutu adı). */
  boxes: MailLocalBox[];
  /** Yerel hesabın kimliği (açıksa). */
  accountId: Id | null;
  /** Yerel kaynaktan okunan ileti sayısı. */
  messageCount: number;
  /** İlk okuma (backfill) sürüyor mu: henüz hiç okunmamış kutu var. Açılışta sayı artarken bu `true`'dur. */
  reading: boolean;
  /** Son okuma anı; hiç okunmadıysa null. */
  lastReadAt: IsoDateTime | null;
  /** Kullanıcının seçtiği özel klasör kullanılıyor mu (otomatik bulunamadı). */
  customRoot: boolean;
}

// ───────────── gözcü (başka modüller) için sorgu arayüzü ─────────────

/** "Şu kişiden / şu konuda yeni ileti var mı?" Alanların hepsi isteğe bağlıdır; verilenler VE ile bağlanır. */
export interface MailQuery {
  /** Gönderenin adında ya da adresinde geçen (büyük/küçük harf ve Türkçe harf duyarsız). */
  from?: string;
  /** Konuda geçen. */
  subject?: string;
  /** Konu ya da gövdede geçen sözcükler. */
  text?: string;
  /** Yalnız bu andan SONRA gelen iletiler (ileti tarihi ya da Fuber'in onu ilk gördüğü an, hangisi yeniyse). */
  since?: IsoDateTime;
  unreadOnly?: boolean;
  minImportance?: number;
  accountId?: Id;
  /** Varsayılan 20, en çok 50. */
  limit?: number;
}

export interface MailQueryHit {
  id: Id;
  accountId: Id;
  from: string;
  fromAddress: string;
  subject: string;
  date: IsoDateTime;
  /** Fuber'in iletiyi ilk gördüğü an (eşitleme). */
  receivedAt: IsoDateTime;
  seen: boolean;
  importance: number | null;
}

export interface MailQueryResult {
  /** Hesap var ve modül çalışıyor mu. `false` ise `hits` boştur ve "ileti yok" anlamına gelmez. */
  available: boolean;
  hits: MailQueryHit[];
  /** Son başarılı eşitleme (bütün hesaplar arasında en eskisi); hiç eşitlenmediyse null. */
  lastSyncAt: IsoDateTime | null;
}

/**
 * `mail.query` olayı (zaman uyumlu istek-yanıt; `planner.brief.collect` düzeni): çağıran `result: null` ile yayınlar,
 * e-posta modülü açıksa aynı çağrı içinde `result`'ı doldurur. Modül kapalıysa `result` null kalır.
 */
export interface MailQueryEvent {
  query: MailQuery;
  result: MailQueryResult | null;
}

declare module '@fuber/shared' {
  interface Api {
    'mail.presets': { req: void; res: MailPreset[] };
    'mail.accounts': { req: void; res: MailAccountView[] };
    /** Kaydetmeden sınar (IMAP girişi + SMTP doğrulaması). */
    'mail.testAccount': { req: { account: MailAccountInput }; res: MailTestResult };
    /** Önce sınar; okuma (IMAP) geçmezse KAYDETMEZ. Kaydedilince ilk eşitleme arka planda başlar. */
    'mail.saveAccount': { req: { account: MailAccountInput }; res: { saved: boolean; account: MailAccountView | null; test: MailTestResult } };
    /** Hesabı, şifreli parolasını, iletilerini ve taslaklarını siler. */
    'mail.removeAccount': { req: { id: Id }; res: Ok };
    'mail.syncNow': { req: { accountId?: Id }; res: MailStatus };
    'mail.status': { req: void; res: MailStatus };
    /** Bugün kartı: son 3 günün okunmamış önemli (4+) iletileri. */
    'mail.important': { req: { limit?: number }; res: MailSummary[] };
    /** Thunderbird/Betterbird profillerindeki hesap AYARLARI (yalnız `profiles.ini` + `prefs.js` okunur; parola dosyaları asla). */
    'mail.importScan': { req: void; res: MailImportScan };
    /** Seçilen hesapları ekler; parola verilen hesap sınanır, okuma geçerse parola şifreli depoya yazılır. Parolasız hesap "parola bekliyor" kalır. */
    'mail.importAccounts': { req: { items: Array<{ key: string; password?: string }> }; res: { results: MailImportResult[] } };
    /** Thunderbird'ün yerel klasörünü tarar (parolasız): bulunan hesaplar/kutular + açık mı. Profile yazmaz, IMAP'a bağlanmaz. */
    'mail.localStatus': { req: void; res: MailLocalStatus };
    /** Yerel kaynağı açar/kapatır. Açınca ilk okuma arka planda başlar; kapatınca okunan iletiler silinir. */
    'mail.localSetEnabled': { req: { enabled: boolean }; res: MailLocalStatus };
    /** Otomatik bulunamazsa kullanıcı Thunderbird profil/kök klasörünü seçer; geçerliyse kaynak oradan okur. */
    'mail.localPickFolder': { req: void; res: MailLocalStatus };
  }
  interface BusEvents {
    'mail.changed': { accountId: Id | null; reason: 'sync' | 'account' | 'draft' | 'sent' };
    /** Eşitlemede yeni gelen iletiler (gözcüler için itme yolu). İlk eşitlemenin eski iletileri bu olayla gelmez. */
    'mail.received': { accountId: Id; messages: MailQueryHit[] };
    'mail.query': MailQueryEvent;
    /** Başka bir modül hemen eşitleme ister (en çok dakikada bir uygulanır). */
    'mail.syncRequest': { accountId?: Id };
    // Planlayıcının sabah/akşam özeti (aynı bildirim `planner/types.ts` içinde de var; modüller birbirini içe aktarmaz).
    'planner.brief.collect': { kind: 'morning' | 'evening'; day: LocalDay; lines: string[] };
  }
  interface WindowEvents {
    'mail.changed': { accountId: Id | null; reason: 'sync' | 'account' | 'draft' | 'sent' };
  }
}
