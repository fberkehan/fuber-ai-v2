/**
 * Yönetim'in bu turda eklenen metinleri. Asıl yerleri `packages/shared/src/i18n/tr/admin.ts`; o dosya başka
 * bir görevin sahipliğinde olduğundan çalışma anında kaydedilir (`registerMessages`, TUZAKLAR §1). Sözlüğe
 * taşınınca bu dosya silinir; anahtarlar aynı kalır. Önek `admin2.` ki sözlükteki bir anahtarla çakışmasın
 * (çakışma açılışta hata verir).
 */
import { hasMessage, registerMessages } from '@fuber/shared';

export const ADMIN2_MESSAGES = {
  // Sağlayıcı hataları (anahtar sınama, ses listesi, "Sesi dene")
  'admin2.err.invalid.title': 'Anahtar geçersiz',
  'admin2.err.invalid.body': 'Sağlayıcı bu anahtarı kabul etmedi. Anahtarı yeniden kopyalayıp yapıştırın.',
  'admin2.err.plan.title': 'Bu ses ücretli plan istiyor',
  'admin2.err.plan.body': 'ElevenLabs ücretsiz planda kütüphane seslerini kullandırmıyor. Hazır seslerden birini seçin ya da planı yükseltin.',
  'admin2.err.quota.title': 'Kota doldu',
  'admin2.err.quota.body': 'Bu dönemin kullanım hakkı bitti. Hak yenilenene ya da plan yükseltilene kadar asistan yerel sesle konuşur.',
  'admin2.err.credit.title': 'Hesapta kredi yok',
  'admin2.err.credit.body': 'Anahtar geçerli ama Anthropic hesabında kredi kalmamış. Kredi yükleyin; o zamana kadar asistan bu bilgisayardaki modelle devam edebilir.',
  'admin2.err.network.title': 'Bağlantı kurulamadı',
  'admin2.err.network.body': 'Sağlayıcıya ulaşılamadı. İnternet bağlantısını denetleyip yeniden deneyin.',
  'admin2.err.missing.title': 'Anahtar yok',
  'admin2.err.missing.body': 'Önce bu sağlayıcının anahtarını ekleyin.',
  'admin2.err.unknown.title': 'Beklenmeyen bir yanıt geldi',
  'admin2.err.unknown.body': 'Sağlayıcı tanımadığımız bir hata döndü. Ayrıntıyı kopyalayıp bakabilirsiniz.',
  'admin2.err.details': 'Ayrıntı',
  'admin2.err.copy': 'Kopyala',
  'admin2.err.copied': 'Ayrıntı kopyalandı',

  // Anahtar kasası durumu
  'admin2.keys.state.recognized': 'Anahtar tanındı',
  'admin2.keys.state.noCredit': 'Kredi yok',
  'admin2.keys.state.quota': 'Kota doldu',
  'admin2.keys.creditNote': 'Kredi durumu ilk konuşmada belli olur.',
  'admin2.keys.inVault': 'Anahtar',
  'admin2.keys.inVaultYes': 'Kasada',
  'admin2.keys.inVaultNo': 'Eklenmedi',
  'admin2.keys.result': 'Sonuç',
  'admin2.keys.resultNone': 'Henüz sınanmadı',
  'admin2.keys.result.valid': 'Çalışıyor',
  'admin2.keys.result.validCredit': 'Çalışıyor, hesapta kredi var',

  // Ses sayfası
  'admin2.voice.fallback': 'Anahtar yoksa ya da kota dolarsa yerel sesle devam eder.',
  'admin2.voice.voice.default': 'Varsayılan ses (Daniel)',
  'admin2.voice.voice.defaultHint': 'Ses seçilmezse kullanılan hazır ses',
  'admin2.voice.voiceList.failed': 'Ses listesi alınamadı',

  // Beyin sayfası: yerel model
  'admin2.brain.local.title': 'Bu bilgisayardaki model',
  'admin2.brain.local.description': 'Buluta ulaşılamadığında ya da bir iş bu bilgisayara verildiğinde kullanılan küçük dil modeli.',
  'admin2.brain.fallback.label': 'Bulut yokken bu bilgisayardaki modelle devam et',
  'admin2.brain.fallback.hint': 'Anahtar yoksa, hesapta kredi kalmadıysa ya da internet yoksa konuşma ve hafıza bu bilgisayarda sürer. Derin işler (araştırma, Atölye) burada yapılmaz.',
  'admin2.brain.fallback.on': 'Açık: asistan susmaz, daha basit yanıt verir.',
  'admin2.brain.fallback.off': 'Kapalı: bulut yokken asistan yanıt veremez.',
  'admin2.brain.localModel.label': 'Yerel model',
  'admin2.brain.localModel.hint': 'Masaüstünün indirdiği dil modellerinden biri.',
  'admin2.brain.localModel.unlisted': 'Listede yok',
  'admin2.brain.context.label': 'Okuma genişliği',
  'admin2.brain.context.hint': 'Modelin bir seferde okuyabildiği metin (token). Büyüdükçe daha çok bellek ister. 2.048 ile 131.072 arası.',
  'admin2.brain.context.unit': 'token',
  'admin2.brain.where.label': 'Nerede çalışır',
  'admin2.modules.onCount': '{on} / {total} açık',
  'admin2.security.usage.emptyBody': 'Asistan konuştukça gün gün harcama ve token burada görünür.',
  'admin2.brain.models.role': 'İş',
  'admin2.brain.models.model': 'Model',
  'admin2.brain.where.cloud': 'Bulutta (Claude)',
  'admin2.brain.where.cloudHint': 'Anthropic anahtarı ister',
  'admin2.brain.where.local': 'Bu bilgisayarda',
  'admin2.brain.where.localHint': 'Anahtarsız, internetsiz; daha basit',
  'admin2.brain.where.localDisabled': 'Bu iş için yerel model yetmez',
  'admin2.brain.where.localNote': 'Bu iş bu bilgisayardaki modelle ({model}) yapılır. Efor, düşünme ve hızlı çıktı ayarları burada geçmez.',
  'admin2.brain.deep.label': 'Derin işler',
  'admin2.brain.deep.hint': 'Yetenek geliştirme, araştırma ve ekrana bakma gibi arka plan işlerini kim yapar. Hızlı sesli yanıtlar bundan etkilenmez.',
  'admin2.brain.deep.auto': 'Kendiliğinden',
  'admin2.brain.deep.autoHint': 'API çalışıyorsa API, yoksa Claude Code',
  'admin2.brain.deep.anthropic': 'Anthropic API',
  'admin2.brain.deep.anthropicHint': 'Anahtar ve hesapta kredi ister',
  'admin2.brain.deep.claudeCode': 'Claude Code',
  'admin2.brain.deep.claudeCodeHint': 'Bu bilgisayardaki abonelik',
  'admin2.brain.deep.now': 'Şu an: {active}',
  'admin2.brain.deep.now.api': 'Anthropic API',
  'admin2.brain.deep.now.cli': 'Claude Code (bu bilgisayardaki abonelik)',
  'admin2.brain.deep.now.none': 'derin iş yapılamıyor',
  'admin2.brain.deep.api.ready': 'Anthropic API: anahtar var.',
  'admin2.brain.deep.api.missing': 'Anthropic API: anahtar yok.',
  'admin2.brain.deep.api.failed': 'Anthropic API: son sınama geçmedi ({message})',
  'admin2.brain.deep.cli.ready': 'Claude Code: {version}, oturum açık.',
  'admin2.brain.deep.cli.unknown': 'Claude Code: {version}, oturum durumu okunamadı.',
  'admin2.brain.deep.cli.loggedOut': 'Claude Code: {version}, oturum kapalı (bir terminalde “claude” ile oturum açın).',
  'admin2.brain.deep.cli.missing': 'Claude Code: bu bilgisayarda kurulu değil.',
  'admin2.brain.deep.checking': 'Durum denetleniyor…',
  'admin.field.brain.deep': 'Derin işler',
  'admin.field.brain.localFallback': 'Yerel modelle devam',
  'admin.field.brain.local': 'Yerel model',

  // Sayfa hata sınırı
  'admin2.page.crashTitle': 'Bu sayfa açılamadı',
  'admin2.page.crashBody': 'Beklenmeyen bir hata oldu. Öteki sayfalar çalışmaya devam ediyor.',
} as const;

export type Admin2Key = keyof typeof ADMIN2_MESSAGES;

let registered = false;
/**
 * Bir kez kaydeder. Sözlükte zaten olan anahtar atlanır: `registerMessages` sözlükteki anahtara yazmayı
 * reddeder (açılışta fırlatır); anahtar sözlüğe taşınınca sözlükteki metin geçerli olur.
 */
export function registerAdmin2Messages(): void {
  if (registered) return;
  registerMessages('tr', Object.fromEntries(Object.entries(ADMIN2_MESSAGES).filter(([key]) => !hasMessage(key))));
  registered = true;
}

registerAdmin2Messages();
