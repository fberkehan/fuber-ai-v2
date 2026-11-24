/**
 * Türkçe sözlük · alan: ccbrain. Konuşan beyin olarak Claude Code (bu bilgisayardaki CLI, kullanıcının aboneliği):
 * masaüstünün duyuru ve durum cümleleri, rozet, Ayarlar › Tanı satırı ve Yönetim'in Beyin sayfasındaki bölüm.
 * Düz anahtarlar; yer tutucu `{ad}`. Yeni anahtar bu alanın önekiyle başlar ve başka dosyada yinelenemez.
 */
export default {
  // ── tur: istem, kısa yanıtlar, bekleme sözü ──
  'ccbrain.system.plain': 'Türkçe yanıt veren yardımcı bir asistansın. Kısa ve doğru yanıt ver; bilmediğini uydurma.',
  'ccbrain.filler': 'Bir saniye.',
  'ccbrain.filler.read': 'Bakıyorum.',
  'ccbrain.filler.write': 'Hemen.',
  'ccbrain.quick.time': 'Saat {time}.',
  'ccbrain.quick.date': 'Bugün {day} {year}.',

  // ── hata ve yerele düşüş duyuruları (oturumda bir kez söylenir) ──
  'ccbrain.error.unreachable': 'Bu bilgisayardaki Claude Code şu an yanıt vermiyor. Biraz sonra yeniden deneyin.',
  'ccbrain.notice.limit': 'Claude aboneliğinin kullanım sınırı doldu; sınır açılana kadar bu bilgisayardaki modelle devam ediyorum.',
  'ccbrain.notice.auth': 'Claude Code’da oturum açık değil; bu bilgisayardaki modelle devam ediyorum.',
  'ccbrain.notice.missing': 'Claude Code bu bilgisayarda hazır değil; bu bilgisayardaki modelle çalışıyorum.',
  'ccbrain.notice.error': 'Claude’a şu an ulaşamıyorum; bu bilgisayardaki modelle devam ediyorum.',

  // ── durum (BrainStatus.claudeCode.reason) ──
  'ccbrain.state.off': 'Fuber Yönetim’de Claude Code konuşan beyin olarak kapalı.',
  'ccbrain.state.otherProvider': 'Konuşma rolü Fuber Yönetim’de başka bir sağlayıcıya ayarlı.',
  'ccbrain.state.private': 'Gizli kipte Claude Code’a hiçbir şey gönderilmez.',

  'ccbrain.deep.role': 'Derin rol Yönetim’de Claude Code’a ayarlı.',

  // ── üst satır rozeti ──
  'ccbrain.badge': 'Claude',
  'ccbrain.badge.hint': 'Yanıtlar Claude’dan geliyor: bu bilgisayardaki Claude Code üzerinden, aboneliğinizle. Ayrı bir harcama yok.',
  'ccbrain.badge.localLimit': 'Claude aboneliğinin kullanım sınırı doldu; yanıtlar bu bilgisayardaki modelden geliyor. Sınır açılınca kendiliğinden Claude’a dönerim.',
  'ccbrain.badge.localLimitUntil': 'Claude aboneliğinin kullanım sınırı doldu ({time} sonrası açılıyor); yanıtlar bu bilgisayardaki modelden geliyor. Sınır açılınca kendiliğinden Claude’a dönerim.',
  'ccbrain.badge.localAuth': 'Claude Code’da oturum açık değil; yanıtlar bu bilgisayardaki modelden geliyor. Bir terminalde “claude” çalıştırıp oturum açın.',
  'ccbrain.badge.localError': 'Claude Code şu an yanıt vermiyor; yanıtlar bu bilgisayardaki modelden geliyor. Kısa süre sonra yeniden denerim.',

  // ── Ayarlar › Tanı ──
  'ccbrain.diag.label': 'Claude Code (konuşan beyin)',
  'ccbrain.diag.active': 'Ses ve yazılı sohbet Claude ile yürüyor: bu bilgisayardaki Claude Code (sürüm {version}), aboneliğinizle. Ses: {voice}, yazılı sohbet: {chat}.',
  'ccbrain.diag.activeRow': 'Kullanımda (sürüm {version}); {warm} sıcak süreç hazır bekliyor. Kullanılmayan süreç on dakika sonra kapanır.',
  'ccbrain.diag.activeTiming': ' Son yanıtın ilk parçası {ms} ms’de geldi.',
  'ccbrain.diag.standby': 'Claude Code hazır (sürüm {version}); bulut API kullanılamazsa devreye girer.',
  'ccbrain.diag.limitUntil': 'Claude aboneliğinin kullanım sınırı doldu; {time} sonrası açılıyor. O zamana dek bu bilgisayardaki model yanıtlar.',
  'ccbrain.diag.badge.active': 'Çalışıyor',
  'ccbrain.diag.badge.standby': 'Hazır',
  'ccbrain.diag.badge.checking': 'Yoklanıyor',
  'ccbrain.diag.badge.off': 'Kapalı',
  'ccbrain.diag.badge.down': 'Yok',

  // ── Yönetim: Beyin › rol kartı ve Claude Code bölümü ──
  'ccbrain.admin.where.option': 'Claude Code (abonelik)',
  'ccbrain.admin.where.optionHint': 'Bu bilgisayardaki Claude Code; API anahtarı ve dolar harcaması yok.',
  'ccbrain.admin.where.note': 'Bu rol, masaüstünün kurulu olduğu bilgisayardaki Claude Code ile (kullanıcının Claude aboneliğiyle) yürür. Claude Code yoksa, oturumu kapalıysa ya da kullanım sınırı dolduysa yerel model devralır.',
  'ccbrain.admin.where.memoryNote': 'Hafıza çıkarımı Claude Code’a gönderilmez (arka planda kota harcamasın); bu rolde yerel model kullanılır.',
  'admin.field.brain.claudeCode': 'Claude Code (abonelik)',
  'ccbrain.admin.title': 'Claude Code (abonelik)',
  'ccbrain.admin.description':
    'Sesli ve yazılı sohbet, masaüstünün kurulu olduğu bilgisayardaki Claude Code üzerinden kullanıcının Claude aboneliğiyle yürüyebilir: API anahtarı ve dolar harcaması gerekmez. Asistanın araçları Claude’a uygulamanın içinden verilir; Claude Code’un kendi araçları (dosya, kabuk, web) bu yolda kapalıdır.',
  'ccbrain.admin.use.label': 'Konuşan beyin',
  'ccbrain.admin.use.hint': 'Rolü “Bulutta (Claude)” olan konuşma ve yazılı sohbet için sıra. Rolü yerel modele ya da başka bir sağlayıcıya ayarlı olan etkilenmez.',
  'ccbrain.admin.use.prefer': 'Önce Claude Code (abonelik)',
  'ccbrain.admin.use.preferHint': 'Claude Code hazırsa o; değilse Anthropic API, o da yoksa yerel model.',
  'ccbrain.admin.use.fallback': 'Önce Anthropic API',
  'ccbrain.admin.use.fallbackHint': 'API kullanılamıyorsa (anahtar ya da kredi yok) Claude Code; o da yoksa yerel model.',
  'ccbrain.admin.use.off': 'Kullanma',
  'ccbrain.admin.use.offHint': 'Konuşma ve sohbet Claude Code’a gitmez. Derin işlerin sağlayıcısı ayrıca seçilir.',
  'ccbrain.admin.voice.label': 'Sesli sohbet modeli',
  'ccbrain.admin.voice.hint': 'Gecikme burada hissedilir. Ölçüm (16 Kasım 2026): Sonnet düşük eforda ilk metin ≈0,6 sn; Haiku 5.5 ≈1,0 sn.',
  'ccbrain.admin.chat.label': 'Yazılı sohbet modeli',
  'ccbrain.admin.chat.hint': 'Doğruluk hızdan önemli; güçlü model seçilebilir.',
  'ccbrain.admin.model.sonnet': 'Sonnet (dengeli, hızlı)',
  'ccbrain.admin.model.haiku': 'Haiku (hafif)',
  'ccbrain.admin.model.opus': 'Opus (güçlü)',
  'ccbrain.admin.model.fable': 'Fable (en güçlü, en yavaş)',
  'ccbrain.admin.model.custom': 'Şu an seçili',
  'ccbrain.admin.effort': 'Efor',
  'ccbrain.admin.status.checking': 'Bu bilgisayardaki Claude Code yoklanıyor…',
  'ccbrain.admin.status.ready': 'Bu bilgisayarda Claude Code kurulu ve oturumu açık (sürüm {version}).',
  'ccbrain.admin.status.unknown': 'Bu bilgisayarda Claude Code kurulu (sürüm {version}); oturum durumu okunamadı.',
  'ccbrain.admin.status.loggedOut': 'Bu bilgisayarda Claude Code kurulu (sürüm {version}) ama oturum açık değil: bir terminalde “claude” çalıştırıp oturum açın.',
  'ccbrain.admin.status.missing': 'Bu bilgisayarda Claude Code kurulu değil; konuşan beyin yerel modele ya da API’ye düşer.',
  'ccbrain.admin.status.note': 'Durum bu bilgisayar için gösterilir; kullanım sınırı ve o anki durum masaüstünde Ayarlar › Tanı’dadır.',
} as const;
