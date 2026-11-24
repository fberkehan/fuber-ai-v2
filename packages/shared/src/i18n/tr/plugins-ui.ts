/**
 * Türkçe sözlük · alan: plugins-ui. Eklentiler sayfası, eklenti sayfaları (güvenli kutu) ve onay/güncelleme önizlemeleri.
 * Önek `pluginsUi.`; ana süreç metinleri `plugins.` önekiyle `tr/plugins.ts`'tedir. Yer tutucu `{ad}`.
 */
export default {
  // ── başlık ve gezinme ──
  'pluginsUi.nav.title': 'Yetenekler',
  'pluginsUi.title': 'Yetenekler',
  'pluginsUi.header.none': 'Kendi geliştirdiğim bir eklenti henüz yok.',
  'pluginsUi.header.enabled': '{count} eklenti etkin.',
  'pluginsUi.header.noneEnabled': 'Etkin eklenti yok.',
  'pluginsUi.header.pending': '{count} eklenti onayınızı bekliyor.',
  'pluginsUi.header.updates': '{count} güncelleme onayınızı bekliyor.',
  'pluginsUi.header.building': 'Bir eklenti geliştiriliyor.',

  // ── yeni eklenti: istek kutusu ve türler ──
  'pluginsUi.new.label': 'Yeni eklenti',
  'pluginsUi.new.placeholder': 'Ne eklememi istersiniz?',
  'pluginsUi.new.hint': 'Araç, pano kartı, menü sayfası, zamanlanmış iş ya da takip ekleyebilirim. Arka planda yazar, sınar ve onayınıza sunarım; siz onaylamadan hiçbir kod çalışmaz.',
  'pluginsUi.new.kindsLabel': 'Neler ekleyebilirim',
  'pluginsUi.kind.card': 'Pano kartı',
  'pluginsUi.kind.job': 'Zamanlanmış iş',
  'pluginsUi.kind.page': 'Menü sayfası',
  'pluginsUi.kind.tool': 'Araç',
  'pluginsUi.example.card': 'Bugün panosuna BTC fiyatı kartı ekle',
  'pluginsUi.example.job': 'Her sabah dokuzda döviz kurlarını sesli söyle',
  'pluginsUi.example.page': 'Pomodoro sayacı sayfası yap',

  // ── kendi eklentilerim ──
  'pluginsUi.own.title': 'Kendi eklentilerim',
  'pluginsUi.own.empty.title': 'Henüz kendi geliştirdiğim bir eklenti yok',
  'pluginsUi.own.empty.description': 'Yukarıya ne istediğinizi yazın ya da sesle “kendine şunu yapan bir eklenti geliştir” deyin.',
  'pluginsUi.own.empty.action': 'İstek yaz',
  'pluginsUi.row.updateReady': 'Güncelleme v{version}',
  'pluginsUi.row.adds': 'Ne ekliyor',

  // ── ne ekliyor (rozet ve etiket) ──
  'pluginsUi.add.tools': 'Araç',
  'pluginsUi.add.tools.count': '{count} araç',
  'pluginsUi.add.cards': 'Kart',
  'pluginsUi.add.cards.count': '{count} kart',
  'pluginsUi.add.jobs': 'İş',
  'pluginsUi.add.jobs.count': '{count} iş',
  'pluginsUi.add.watches': 'Takip',
  'pluginsUi.add.watches.count': '{count} takip',
  'pluginsUi.add.pages': 'Sayfa',
  'pluginsUi.add.pages.count': '{count} sayfa',
  'pluginsUi.add.settings': 'Ayar',
  'pluginsUi.add.settings.count': '{count} ayar',
  'pluginsUi.add.voice': 'Sesli komut',
  'pluginsUi.add.voice.count': '{count} sesli komut',

  // ── onay kartı önizlemesi ──
  'pluginsUi.preview.adds': 'Ne ekleyecek',
  'pluginsUi.preview.addsNone': 'Yeni bir şey eklemiyor.',
  'pluginsUi.preview.permissions': 'Hangi izinler',
  'pluginsUi.preview.permissionsNone': 'Özel izin istemiyor.',

  // ── güncelleme ──
  'pluginsUi.update.ready': 'Güncelleme hazır: v{version}',
  'pluginsUi.update.oldKeepsRunning': 'Siz karar verene dek şu anki sürüm (v{version}) çalışmayı sürdürür.',
  'pluginsUi.update.changes': 'Bu güncellemeyle değişenler',
  'pluginsUi.update.apply': 'Güncellemeyi uygula',
  'pluginsUi.update.discard': 'Vazgeç',
  'pluginsUi.toast.updateApplied': '“{name}” güncellendi.',
  'pluginsUi.toast.updateDiscarded': '“{name}” güncellemesinden vazgeçildi; eski sürüm duruyor.',
  'pluginsUi.updateForm.label': 'Şunu da ekle',
  'pluginsUi.updateForm.hint': 'Eklentiye eklenmesini ya da değişmesini istediğiniz şeyi yazın. Yeni sürümü hazırlarım; onaylayana dek eski sürüm çalışır.',
  'pluginsUi.updateForm.placeholder': 'Örneğin: Pano kartına son 7 günün grafiğini de ekle',
  'pluginsUi.updateForm.submit': 'Güncelle',
  'pluginsUi.updateForm.inProgress': 'Bu eklentinin bir güncellemesi hazırlanıyor ya da onayınızı bekliyor.',
  'pluginsUi.updateForm.started': '“{name}” için güncellemeyi hazırlamaya başladım; hazır olunca onayınızı isteyeceğim.',

  // ── ayrıntı sekmeleri ──
  'pluginsUi.tab.label': 'Eklenti ayrıntısı',
  'pluginsUi.tab.general': 'Genel',
  'pluginsUi.tab.adds': 'Ekledikleri',
  'pluginsUi.tab.settings': 'Ayarlar',
  'pluginsUi.tab.versions': 'Sürümler',
  'pluginsUi.tab.update': 'Güncelle',

  // ── ekledikleri ──
  'pluginsUi.adds.toolsOnly': 'Bu eklenti yalnız araç ekliyor: pano kartı, sayfa, iş ya da sesli komut yok.',
  'pluginsUi.adds.pages': 'Menü sayfaları',
  'pluginsUi.adds.open': 'Aç',
  'pluginsUi.adds.enableToOpen': 'Sayfayı açmak için eklentiyi etkinleştirin.',
  'pluginsUi.adds.activity': 'İşler, takipler ve kartlar',
  'pluginsUi.adds.enableToRun': 'Çalıştırmak için eklentiyi etkinleştirin.',
  'pluginsUi.adds.voice': 'Sesli komutlar',
  'pluginsUi.activity.kind.job': 'İş',
  'pluginsUi.activity.kind.watch': 'Takip',
  'pluginsUi.activity.kind.card': 'Kart',
  'pluginsUi.activity.every': '{minutes} dakikada bir',
  'pluginsUi.activity.runNow': 'Şimdi çalıştır',
  'pluginsUi.activity.refreshNow': 'Şimdi yenile',
  'pluginsUi.activity.last': 'Son çalışma: {when}',
  'pluginsUi.activity.next': 'Sonraki: {when}',
  'pluginsUi.activity.never': 'Henüz çalışmadı',
  'pluginsUi.activity.ran': 'Çalıştırıldı.',
  'pluginsUi.activity.runFailed': 'Çalıştırılamadı.',

  // ── ayarlar ──
  'pluginsUi.settings.empty': 'Bu eklentinin ayarı yok.',
  'pluginsUi.settings.dialogTitle': '{name} ayarları',

  // ── sürümler ──
  'pluginsUi.versions.empty': 'Saklanan sürüm yok.',
  'pluginsUi.versions.noNote': 'Ek açıklama yok',
  'pluginsUi.versions.current': 'Kurulu',
  'pluginsUi.versions.rollback': 'Bu sürüme dön',
  'pluginsUi.versions.confirmTitle': '“{name}” v{version} sürümüne dönsün mü?',
  'pluginsUi.versions.confirmBody': 'Eklenti seçtiğiniz sürümün koduyla çalışır. Sonraki sürümler saklanır; istediğinizde yeniden geçebilirsiniz.',
  'pluginsUi.versions.rollbackConfirm': 'Bu sürüme dön',
  'pluginsUi.versions.rolledBack': '“{name}” v{version} sürümüne döndü.',

  // ── eklenti sayfası (güvenli kutu) ──
  'pluginsUi.page.sandbox': 'Güvenli kutuda çalışıyor',
  'pluginsUi.page.sandboxHint': 'Bu sayfa uygulamanın geri kalanından ve internetten yalıtılmış bir kutuda çalışır; yalnız eklentinin kendi araçlarına erişebilir.',
  'pluginsUi.page.refresh': 'Sayfayı yenile',
  'pluginsUi.page.settings': 'Eklenti ayarları',
  'pluginsUi.page.detail': 'Eklenti ayrıntısı',
  'pluginsUi.page.errorTitle': 'Sayfa açılamadı',
  'pluginsUi.page.frameFailed': 'Güvenli kutu yanıt vermedi. Yeniden deneyin.',
  'pluginsUi.frame.invalid': 'Geçersiz istek.',
  'pluginsUi.frame.rateLimited': 'Çok sık istek: saniyede en çok 20 istek yapılabilir.',
  'pluginsUi.frame.toolFailed': 'Araç çalıştırılamadı.',
};
