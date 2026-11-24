/**
 * Türkçe sözlük · alan: documents. Belgeler modülü: sohbet ekleri, Ayarlar › Dosya erişimi.
 * Düz anahtarlar; yer tutucu `{ad}`. `chat.tool.*` ve `chat.toolDone.*` anahtarları sohbet sayfasının araç çipleri
 * içindir (çip anahtarı araç adından türetilir); belge araçlarına ait oldukları için burada durur.
 */
export default {
  'module.documents.name': 'Belgeler',
  'module.documents.description': 'Belge okuma (PDF, Word, Excel, PowerPoint, e-posta), sohbete dosya ekleme ve belge üretme.',

  // ───── sohbet ekleri ─────
  'documents.attach': 'Dosya ekle',
  'documents.attachHint': 'PDF, Word, Excel, PowerPoint, CSV, e-posta, metin ya da görsel (en çok {count} dosya)',
  'documents.dropHere': 'Dosyaları buraya bırakın',
  'documents.dropBody': 'Belgeler okunup sohbete eklenir; dosyalar bu bilgisayardan çıkmaz, yalnız içerikleri beyne gider.',
  'documents.reading': '{name} okunuyor…',
  'documents.remove': '{name} ekini kaldır',
  'documents.rejected': '{name} eklenemedi: {reason}',
  'documents.tooMany': 'Bir iletiye en çok {count} dosya eklenir.',
  'documents.status.failed': 'Okunamadı',
  'documents.status.noText': 'Metin yok',
  'documents.localImageNote': 'Bu bilgisayardaki model görselleri göremez; görsel eki bulut beyni bağlanınca okunur.',
  'documents.sendWithAttachments': 'Ekleri gönder',

  // ───── araç çipleri (sohbet) ─────
  'chat.tool.file_list': 'Klasöre bakılıyor',
  'chat.tool.document_read': 'Belge okunuyor',
  'chat.tool.document_search': 'Belgelerde aranıyor',
  'chat.tool.document_create': 'Belge hazırlanıyor',
  'chat.toolDone.file_list': 'Klasöre bakıldı',
  'chat.toolDone.document_read': 'Belge okundu',
  'chat.toolDone.document_search': 'Belgelerde arandı',
  'chat.toolDone.document_create': 'Belge kaydedildi',

  // ───── Ayarlar › Gizlilik › Dosya erişimi ─────
  'documents.settings.title': 'Dosya erişimi',
  'documents.settings.body': '{name} yalnız bu klasörlerdeki belgeleri sorusuz okur. Başka bir yerdeki dosya için her seferinde onay ister. Sistem klasörleri, uygulama verisi, tarayıcı profilleri ve parola/anahtar dosyaları hiçbir zaman açılmaz.',
  'documents.settings.read': 'Okuma izinli klasörler',
  'documents.settings.add': 'Klasör ekle',
  'documents.settings.remove': 'Kaldır',
  'documents.settings.restore': 'Yeniden aç',
  'documents.settings.missing': 'Klasör yok',
  'documents.settings.source.default': 'Varsayılan',
  'documents.settings.source.user': 'Eklediğiniz',
  'documents.settings.source.external': 'Başka modül',
  'documents.settings.externalHint': 'Başka modüllerin okumasına izin verdiği klasörler; kayıt silinince listeden düşer.',
  'documents.settings.disabled': 'Kapatılan varsayılanlar',
  'documents.settings.output': 'Üretilen belgelerin klasörü',
  'documents.settings.outputBody': '{name} Word, Excel, PowerPoint ve PDF belgelerini yalnız buraya yazar; var olan dosyanın üzerine yazmaz.',
  'documents.settings.change': 'Değiştir',
  'documents.settings.reset': 'Varsayılana dön',
  'documents.settings.open': 'Klasörü aç',
  'documents.settings.default': 'varsayılan',
} as const;
