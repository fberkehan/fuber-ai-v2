// Bilgisayar modülü › pano ve sistem araçları (ses düzeyi sürücüsü, parlaklık, kilit, güç, ekran görüntüsü, bildirim):
// araç sonuçları ve onay cümleleri. Anahtarlar `pc.device.` önekiyle başlar.
export default {
  // ── pano ──
  'pc.device.clipboard.empty': 'Pano boş ya da metin dışında bir şey içeriyor (görsel, dosya); okunacak metin yok.',
  'pc.device.clipboard.header': 'Panodaki metin ({count} karakter):',
  'pc.device.clipboard.truncated': '(devamı var; ilk {count} karakter gösterildi)',
  'pc.device.clipboard.masked': 'Not: panoda parola, anahtar ya da kart bilgisi gibi görünen bölümler vardı; bunlar GİZLENDİ ve bana gösterilmedi. Kullanıcıya içeriği söyleyemem.',
  'pc.device.clipboard.secret': 'Panoda parola ya da gizli anahtar gibi görünen bir içerik var ({count} karakter); güvenlik için okumadım. Kullanıcı gerçekten istiyorsa içeriği kendisi yapıştırabilir.',
  'pc.device.clipboard.readFailed': 'Pano okunamadı: {detail}',
  'pc.device.clipboard.written': '{count} karakter panoya yazıldı; kullanıcı Ctrl+V ile yapıştırabilir. Panonun önceki içeriği değişti.',
  'pc.device.clipboard.unverified': '{count} karakter panoya yazma isteği gönderildi ama pano geri okunduğunda aynı metin görünmedi; yazıldı deme.',
  'pc.device.clipboard.writeFailed': 'Panoya yazılamadı: {detail}',
  'pc.device.clipboard.tooLong': 'Metin çok uzun ({count} karakter; en çok {max}). Daha kısa bir metin ver ya da dosyaya yaz.',

  'pc.device.mask.private_key': '[gizlendi: özel anahtar]',
  'pc.device.mask.token': '[gizlendi: erişim anahtarı]',
  'pc.device.mask.jwt': '[gizlendi: oturum belirteci]',
  'pc.device.mask.card': '[gizlendi: kart numarası]',
  'pc.device.mask.iban': '[gizlendi: IBAN]',
  'pc.device.mask.password': '[gizlendi: parola]',
  'pc.device.mask.secret': '[gizlendi: parola ya da anahtar gibi görünüyor]',

  // ── parlaklık ──
  'pc.device.brightness.current': 'Ekran parlaklığı şu an %{level}.',
  'pc.device.brightness.set': 'Ekran parlaklığı %{level} yapıldı.',
  'pc.device.brightness.mismatch': 'Parlaklık %{wanted} istendi ama ekran %{level} bildiriyor; tam ayarlanamadı.',
  'pc.device.brightness.unsupported':
    'Bu ekranın parlaklığı Windows üzerinden ayarlanamıyor (harici monitörlerde olağandır; yalnız dizüstü ekranları destekler). Parlaklık monitörün kendi düğmelerinden değiştirilebilir.',
  'pc.device.brightness.failed': 'Parlaklık ayarlanamadı: {detail}',

  // ── kilit ──
  'pc.device.lock.done': 'Ekran kilitlendi. Kilit açılana dek bilgisayarı kullanamam (fare, klavye ve ekran okuma çalışmaz).',
  'pc.device.lock.failed': 'Ekran kilitlenemedi: {detail}',

  // ── güç ──
  'pc.device.power.approve.sleep': 'Bilgisayarı {delay} saniye sonra UYKU kipine almak istiyorum. Açık işler bellekte kalır; süren indirmeler ve işler durur.',
  'pc.device.power.approve.shutdown': 'Bilgisayarı {delay} saniye sonra KAPATMAK istiyorum. Kaydedilmemiş işler kaybolabilir; bütün uygulamalar kapanır.',
  'pc.device.power.approve.restart': 'Bilgisayarı {delay} saniye sonra YENİDEN BAŞLATMAK istiyorum. Kaydedilmemiş işler kaybolabilir; bütün uygulamalar kapanır.',
  'pc.device.power.done.sleep': 'Bilgisayar {delay} saniye sonra uyku kipine geçecek. Uyanınca kaldığım yerden sürerim.',
  'pc.device.power.done.shutdown': 'Bilgisayar {delay} saniye sonra kapanacak; Windows geri sayımı gösteriyor. Vazgeçmek için süre dolmadan system_power_cancel.',
  'pc.device.power.done.restart': 'Bilgisayar {delay} saniye sonra yeniden başlayacak; Windows geri sayımı gösteriyor. Vazgeçmek için süre dolmadan system_power_cancel.',
  'pc.device.power.failed': 'Güç işlemi yapılamadı: {detail}',
  'pc.device.power.cancelled': 'Bekleyen kapatma ya da yeniden başlatma iptal edildi (bekleyen bir işlem yoksa hiçbir şey değişmedi).',
  'pc.device.power.cancelFailed': 'Bekleyen kapatma iptal edilemedi: {detail}',

  // ── ekran görüntüsü ──
  'pc.device.screenshot.saved': 'Ekran görüntüsü kaydedildi: {path} ({width}×{height} piksel, {size}).',
  'pc.device.screenshot.sensitive': 'Önde hassas bir pencere var ({detail}); ekran görüntüsü almadım.',
  'pc.device.screenshot.dark': ' Not: görüntü neredeyse tamamen siyah (ekran kapalı olabilir ya da içerik korumalı).',
  'pc.device.screenshot.failed': 'Ekran görüntüsü kaydedilemedi: {detail}',
  'pc.device.screenshot.fileName': 'Ekran görüntüsü',

  // ── bildirim ──
  'pc.device.notify.shown': 'Bildirim gösterildi: “{title}”.',
  'pc.device.notify.failed': 'Bildirim gösterilemedi (Windows bildirimleri kapalı ya da Rahatsız Etmeyin açık olabilir). İstersen aynı şeyi sesli söyleyebilirim.',

  // ── ses düzeyi (pc_media'nın mutlak düzey eylemleri bu sürücüyü kullanır) ──
  'pc.device.volume.current': 'Bilgisayarın ses düzeyi %{level}{muted}.',
  'pc.device.volume.set': 'Bilgisayarın ses düzeyi %{level} yapıldı{muted}.',
  'pc.device.volume.mutedSuffix': ' (sessizde)',
  'pc.device.volume.muted': 'Bilgisayarın sesi kapatıldı (sessizde; düzey %{level}).',
  'pc.device.volume.unmuted': 'Bilgisayarın sesi açıldı (düzey %{level}).',
  'pc.device.volume.failed': 'Ses düzeyi okunamadı ya da ayarlanamadı: {detail}',

  'pc.device.fail.helper': 'sistem yardımcısı yanıt vermedi',
} as const;
