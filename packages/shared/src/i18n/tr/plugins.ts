/**
 * Türkçe sözlük · alan: plugins. Eklenti platformunun ana süreç metinleri (Atölye): önizleme satırları, onay özetleri,
 * güncelleme, geri alma, katkıların çalışma zamanı ve sesli yanıtlar. Arayüz metinleri `plugins-ui.ts` içindedir.
 * Düz anahtarlar; yer tutucu `{ad}`. Yeni anahtar bu alanın önekiyle başlar ve başka dosyada yinelenemez.
 */
export default {
  // ── zamanlama ve olaylar ──
  'plugins.schedule.daily': 'her gün {time}',
  'plugins.schedule.days': '{days} günleri {time}',
  'plugins.schedule.everyMinutes': '{count} dakikada bir',
  'plugins.schedule.everyHour': 'saatte bir',
  'plugins.schedule.everyHours': '{count} saatte bir',
  'plugins.schedule.everyDay': 'günde bir',
  'plugins.schedule.everyDays': '{count} günde bir',
  'plugins.day.1': 'Pazartesi',
  'plugins.day.2': 'Salı',
  'plugins.day.3': 'Çarşamba',
  'plugins.day.4': 'Perşembe',
  'plugins.day.5': 'Cuma',
  'plugins.day.6': 'Cumartesi',
  'plugins.day.7': 'Pazar',
  'plugins.event.appStarted': 'uygulama açılınca',
  'plugins.event.reminderFired': 'bir hatırlatıcı çalınca',
  'plugins.event.mailReceived': 'yeni e-posta gelince',
  'plugins.event.watchFired': 'bir takip işi tetiklenince',
  'plugins.event.userReturned': 'bilgisayarın başına dönünce',
  'plugins.announce.speak': 'sesli söyler',
  'plugins.announce.notify': 'bildirim gösterir',
  'plugins.announce.silent': 'sessiz çalışır',

  // ── ne ekleyecek ──
  'plugins.adds.tools': '{count} araç (konuşurken kullanırım)',
  'plugins.adds.card': 'Bugün panosuna "{title}" kartı ({every} yenilenir)',
  'plugins.adds.page': 'Yan menüye "{title}" sayfası (güvenli kutuda çalışır)',
  'plugins.adds.job': '"{title}" işi: {schedule}, {announce}',
  'plugins.adds.watch': '"{title}" takibi: {every} bakar, yeni olanı {announce}',
  'plugins.adds.settings': '{count} ayar',
  'plugins.adds.voice': 'Sesli komut: {phrases}',

  // ── hangi izinler ──
  'plugins.permission.none': 'Özel izin istemiyor: internete çıkamaz, dosyalara ulaşamaz, bildirim gönderemez',
  'plugins.permission.net': 'İnternet: yalnız {hosts}',
  'plugins.permission.fs': 'Dosyalar: yalnız {roots} klasörü',
  'plugins.permission.tools': 'Şu araçlarımı çağırabilir: {tools}',
  'plugins.permission.speak': 'Sesli duyuru yapabilir',
  'plugins.permission.notify': 'Bildirim gösterebilir ve hatırlatıcı kurabilir',
  'plugins.folder.documents': 'Belgeler',
  'plugins.folder.desktop': 'Masaüstü',
  'plugins.folder.downloads': 'İndirilenler',

  // ── güncelleme farkları ──
  'plugins.change.hosts': 'YENİ İZİN: şu adreslere de bağlanacak: {hosts}',
  'plugins.change.roots': 'YENİ İZİN: şu klasöre de ulaşacak: {roots}',
  'plugins.change.tools': 'YENİ İZİN: şu araçlarımı da çağıracak: {tools}',
  'plugins.change.speak': 'YENİ İZİN: sesli duyuru yapacak',
  'plugins.change.notify': 'YENİ İZİN: bildirim gösterecek ve hatırlatıcı kuracak',
  'plugins.change.newTools': '{count} yeni araç',
  'plugins.change.newCard': 'Yeni pano kartı: {title}',
  'plugins.change.newPage': 'Yeni sayfa: {title}',
  'plugins.change.newJob': 'Yeni iş: {title} ({schedule})',
  'plugins.change.newWatch': 'Yeni takip: {title}',
  'plugins.change.removed': '{count} katkı kaldırılıyor',
  'plugins.change.codeOnly': 'Yeni izin ya da katkı yok; yalnız davranış değişiyor',

  // ── onay ──
  'plugins.approval.summary': 'Yeni eklenti hazır: {name}. {description} Ekleyecekleri: {adds}. İzinler: {permissions}. Etkinleştireyim mi?',

  // ── güncelleme ──
  'plugins.update.title': '{name} eklentisini güncelliyorum',
  'plugins.update.draftName': '{name} güncellemesi',
  'plugins.update.started': '{name} eklentisini güncellemeye başladım; hazır olunca onayınızı isteyeceğim. O zamana kadar eski sürüm çalışır.',
  'plugins.update.done': '{name} güncellemesi hazır (sürüm {version}); onayınızı bekliyor.',
  'plugins.update.none': '{name} için bekleyen bir güncelleme yok.',
  'plugins.update.broken': '{name} güncellemesinin dosyaları değişmiş ya da bozulmuş; uygulamadım. Güncellemeyi yeniden isteyin.',
  'plugins.update.summary': '{name} güncellemesi hazır (sürüm {version}). Değişenler: {changes}. Uygulayayım mı?',
  'plugins.update.summaryWider': '{name} güncellemesi hazır (sürüm {version}) ve YENİ İZİN istiyor. Değişenler: {changes}. Uygulayayım mı?',
  'plugins.update.applied': '{name} güncellendi; artık sürüm {version} çalışıyor.',
  'plugins.update.rejected': '{name} güncellemesini uygulamadım; eski sürüm çalışmaya devam ediyor.',
  'plugins.update.noAnswer': '{name} güncellemesi için yanıt gelmedi; Yetenekler sayfasında onayınızı bekliyor.',
  'plugins.update.waiting.title': 'Güncelleme onayınızı bekliyor',
  'plugins.update.waiting.body': '{name} güncellemesi hazır. Yetenekler sayfasından uygulayabilirsiniz; o zamana kadar eski sürüm çalışır.',
  'plugins.update.approval': '{name} eklentisinin bekleyen güncellemesi uygulansın mı?',

  // ── geri alma ──
  'plugins.rollback.none': '{name} için dönülecek daha eski bir sürüm yok.',
  'plugins.rollback.unknown': '{name} eklentisinin {version}. sürümü saklı değil.',
  'plugins.rollback.broken': '{name} eklentisinin saklanan {version}. sürümü onaylandığı andaki içerik değil; geri almadım.',
  'plugins.rollback.selftest': '{name} eklentisinin {version}. sürümü öz-sınamadan geçmedi; geri almadım. {detail}',
  'plugins.rollback.done': '{name} eklentisini {version}. sürüme geri aldım.',
  'plugins.rollback.approval': '{name} eklentisi önceki sürümüne geri alınsın mı?',

  // ── çekirdek geliştirme gerektiren istek ──
  'plugins.escalate.reason': 'Bu istek eklentiyle yapılamıyor: {reason} Uygulamanın kendi kodunda değişiklik (çekirdek geliştirme) gerekiyor.',
  'plugins.escalate.noReason': 'eklenti yüzeyi bu iş için yetmiyor.',

  // ── kendiliğinden çalışan katkılar ──
  'plugins.run.busy': 'Bu iş şu an zaten çalışıyor.',
  'plugins.run.inactive': 'Bu eklenti etkin değil.',
  'plugins.run.unknown': 'Böyle bir iş, takip ya da kart yok.',
  'plugins.card.refreshed': '"{title}" kartı yenilendi.',
  'plugins.card.badData': 'Kartın aracı beklenen veriyi döndürmedi (data.card, "{template}" şablonu).',
  'plugins.job.quiet': 'İş çalıştı; söyleyecek bir şey yoktu.',
  'plugins.watch.seeded': 'İlk bakış: {count} kayıt görüldü; bundan sonra yeni olanları haber vereceğim.',
  'plugins.watch.fresh': '{count} yeni: {list}',
  'plugins.watch.nothing': 'Yeni bir şey yok.',

  // ── sayfa ve ayar ──
  'plugins.page.unknown': 'Bu eklenti sayfası bulunamadı (eklenti kapatılmış ya da kaldırılmış olabilir).',
  'plugins.page.unknownTool': 'Sayfa bilinmeyen bir araç çağırdı: {tool}.',
  'plugins.page.badInput': '{tool} aracına gönderilen girdi geçersiz.',
  'plugins.page.danger': '{tool} onay isteyen bir araç; sayfadan çağrılamaz. Bunu bana sesle ya da yazıyla söyleyin.',
  'plugins.page.tooMany': 'Sayfa çok sık istek gönderiyor; biraz sonra yeniden deneyin.',
  'plugins.page.opened': '{title} sayfasını açtım.',
  'plugins.page.none': 'Sayfası olan etkin bir eklenti yok.',
  'plugins.page.ambiguous': 'Birden çok sayfa var: {names}. Hangisini açayım?',
  'plugins.setting.unknown': 'Bu eklentide "{key}" adında bir ayar yok.',
  'plugins.setting.badType': '"{label}" ayarı için geçersiz değer.',
  'plugins.setting.badOption': '"{label}" ayarı için seçeneklerden biri verilmeli.',

  // ── kendini değiştirme kapısı: onay kartında gösterilen özet ──
  'plugins.guard.build': 'Yeni eklenti geliştirme isteği: "{goal}".',
  'plugins.guard.update': '{name} eklentisini güncelleme isteği: "{change}".',

  // ── takip işleri için kaynak (İşler modülü: watch_start, source: "plugin") ──
  'plugins.source.label': 'Eklenti takibi',
  'plugins.source.targetHint': 'eklentinin takip adı (ör. "haberler") ya da <eklenti>:<takip> kimliği',
  'plugins.source.unavailable': 'Takip sunan etkin bir eklenti yok.',
  'plugins.source.unknown': 'Böyle bir eklenti takibi yok. Olanlar: {names}.',
  'plugins.source.describe': '“{title}” eklenti takibi',

  // ── öz-tanım (beynin "KENDİN" bölümü) ──
  'plugins.self.canChange':
    'kendine yeni özellik ekleyebilirsin: eklenti olarak (skill_build; uygulama yeniden başlamaz) araç, Bugün panosu kartı, yan menü sayfası, zamanlanmış ya da olay tetikli iş, takip, ayar ve sesli komut; eklentiyi güncelleyebilir (skill_update) ve önceki sürüme döndürebilirsin (skill_rollback)',
  'plugins.self.cannotChange':
    'eklentiyle değişmeyenler: uygulamanın kabuğu ve adası, ses hattı, beyin ve yerleşik modüllerin davranışı; bunlar kaynak kodda değişiklik ister (çekirdek geliştirme: core_develop; yalnız geliştirici kipi açıksa). Kullanıcı böyle bir şey isterse eklentinin neden yetmediğini söyle',
  'plugins.self.work': '{name} eklentisi: {title} ({schedule})',

  // ── sesli yanıtlar ──
  'plugins.say.info': '{name}, sürüm {version}, {status}. Ekledikleri: {adds}. İzinleri: {permissions}.',
  'plugins.say.infoUpdate': ' Onayınızı bekleyen bir güncellemesi var.',
  'plugins.say.versions': ' Geri dönülebilecek {count} eski sürümü saklı.',
};
