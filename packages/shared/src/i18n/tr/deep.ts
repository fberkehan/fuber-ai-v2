/**
 * Türkçe sözlük · alan: deep. Derin beyin (yetenek geliştirme, araştırma, görüntü anlama): durum ve hata metinleri.
 * Düz anahtarlar; yer tutucu `{ad}`. Yeni anahtar bu alanın önekiyle başlar ve başka dosyada yinelenemez.
 */
export default {
  // ── derin beyin yok ──
  'deep.none.private': 'Gizli kipte derin işler (araştırma, yetenek geliştirme, görüntü anlama) yapılmaz.',
  'deep.none.both': '{api} {cli}',
  'deep.api.noKey': 'Anthropic anahtarı tanımlı değil.',
  'deep.api.localRole': 'Derin rol Yönetim’de yerel modele ayarlı.',
  'deep.api.billing': 'Anthropic hesabında kredi yok.',
  'deep.api.auth': 'Anthropic anahtarı kabul edilmedi.',
  'deep.api.network': 'Anthropic’e şu an ulaşılamıyor.',
  'deep.api.down': 'Anthropic API şu an kullanılamıyor.',
  'deep.cli.checking': 'Claude Code yoklanıyor.',
  'deep.cli.missing': 'Claude Code bu bilgisayarda kurulu değil.',
  'deep.cli.loggedOut': 'Claude Code kurulu ama oturum açık değil; bir terminalde “claude” çalıştırıp oturum açın.',
  'deep.cli.old': 'Claude Code sürümü eski ({version}); en az {min} gerekiyor. “claude update” ile güncelleyin.',
  'deep.cli.broken': 'Claude Code bulundu ama çalıştırılamadı.',

  // ── araştırma (derin iş) ──
  'deep.research.unavailable': 'Araştırma için derin beynim gerekiyor. {reason}',
  'deep.research.format':
    'Yanıtını tam olarak şu biçimde ver: ilk satır "ÖZET: " ile başlasın ve sesli okunacak en çok iki kısa cümle olsun (adres, madde işareti ve biçim imi yok); sonra bir boş satır; sonra istenen rapor. Kullanıcının hesabı, e-postası ya da bilgisayarıyla ilgili hiçbir bilgiyi aramalara ve adreslere yazma.',
  'deep.research.stepQuery': 'Aranıyor: {query}',
  'deep.research.stepSite': 'Okunuyor: {site}',
  'deep.research.chatReport': 'Araştırma raporu: {topic}\n\n{report}',

  // ── çalışma hataları ──
  'deep.error.limit': 'Claude aboneliğinin kullanım sınırı doldu{reset}. Sınır açılınca yeniden deneyebilirsiniz.',
  'deep.error.limitReset': ' ({time} sonrası açılıyor)',
  'deep.error.auth': 'Claude Code oturumu kabul edilmedi; bir terminalde “claude” çalıştırıp yeniden oturum açın.',
  'deep.error.timeout': 'İş {seconds} saniyede bitmedi; durdurdum.',
  'deep.error.aborted': 'İş durduruldu.',
  'deep.error.maxTurns': 'İş adım sınırına takıldı ve yarıda kaldı.',
  'deep.error.refusal': 'Model bu isteği geri çevirdi.',
  'deep.error.noResult': 'Claude Code bir sonuç vermeden kapandı{detail}.',
  'deep.error.spawn': 'Claude Code başlatılamadı: {detail}',
  'deep.error.failed': 'Claude Code işi tamamlayamadı: {detail}',
  'deep.error.empty': 'Derin beyin boş yanıt verdi.',
  'deep.error.image': 'Görüntü okunamadı: {detail}',
  'deep.error.imageType': 'Görüntü türü desteklenmiyor ({name}); png, jpg, webp ya da gif olmalı.',
  'deep.error.imageSize': 'Görüntü çok büyük ({name}); en çok 5 MB olabilir.',
  'deep.error.system': 'Derin iş için sistem istemi verilmedi.',
  'deep.error.workDir': 'Derin işin çalışma klasörü yok: {dir}',
} as const;
