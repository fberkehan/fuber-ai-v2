/**
 * Türkçe sözlük · alan: voice. Ses durumları, ses denetimi ve sesli yanıt kalıpları.
 * Düz anahtarlar; yer tutucu `{ad}`. Yeni anahtar bu alanın önekiyle başlar ve başka dosyada yinelenemez.
 *
 * `voice.error.*` ve `voice.approval.*` metinleri yüksek sesle de okunur: kısa ve konuşur gibi yazılır.
 */
export default {
  'voice.state.idle': 'Hazır',
  'voice.state.listening': 'Dinliyorum',
  'voice.state.thinking': 'Düşünüyorum',
  'voice.state.speaking': 'Konuşuyorum',
  'voice.state.followup': 'Sizi dinliyorum',
  'voice.state.mic_off': 'Mikrofon kapalı',
  'voice.notReady': 'Ses hazırlanıyor',
  'voice.notReady.starting': 'Ses hattı başlatılıyor.',
  'voice.notReady.models': 'Ses modelleri hazır değil. Kurulumdan ya da Ayarlar’dan hazırlayabilirsiniz.',
  'voice.notReady.stt': 'Yazıya çevirme başlatılıyor.',
  'voice.quiet.on': 'Sessiz kip açık',
  'voice.mic.muted': 'Mikrofonu kapattım; {hotkey} ile açarsınız.',
  'voice.mic.mutedNoHotkey': 'Mikrofonu kapattım; tepsi simgesinden açarsınız.',
  'voice.mic.unmuted': 'Mikrofon açık.',
  'voice.mic.error.permission': 'Mikrofon izni verilmedi. Windows gizlilik ayarlarından mikrofon erişimini açın.',
  'voice.mic.error.noDevice': 'Mikrofon bulunamadı.',
  'voice.mic.error.inUse': 'Mikrofon açılamadı; başka bir uygulama kullanıyor olabilir.',
  'voice.mic.error.unknown': 'Mikrofon açılamadı.',
  'voice.mic.error.disconnected': 'Mikrofon bağlantısı kesildi.',
  'voice.action.listen': 'Konuş',
  'voice.action.stop': 'Sustur',
  'voice.action.stopHint': 'Konuşmayı ve süren işi keser. Esc de aynı işi görür.',
  'voice.action.mute': 'Mikrofonu kapat',
  'voice.action.unmute': 'Mikrofonu aç',
  'voice.interrupted': 'yarıda kesildi',

  'voice.error.stt': 'Sizi yazıya çeviremedim.',
  'voice.error.brain': 'Şu an yanıt veremiyorum.',
  'voice.error.timeout': 'Kusura bakmayın, yanıt gecikti. Bir daha söyler misiniz?',
  'voice.error.tts': 'Yanıtı seslendiremedim; yazıyla gösteriyorum.',
  'voice.error.internal': 'Ses hattında bir sorun oluştu.',
  'voice.error.boot': 'Ses hattı başlatılamadı.',
  'voice.error.killSwitch': 'Asistan Fuber Yönetim tarafından durduruldu.',
  'voice.error.updateRequired': 'Bu sürüm artık kullanılamıyor; önce güncellemeniz gerekiyor.',

  'voice.stt.unavailable': 'Yazıya çevirme kullanılamıyor.',
  'voice.stt.noGpu':
    'Yazıya çevirme ekran kartını kullanamıyor. NVIDIA sürücüsünü güncelleyin; işlemcide çalıştırılmadı çünkü çok yavaş kalır.',
  'voice.stt.spawnFailed': 'Yazıya çevirme başlatılamadı.',
  'voice.stt.exitedEarly': 'Yazıya çevirme açılırken kapandı; yeniden deneniyor.',
  'voice.stt.startTimeout': 'Yazıya çevirme zamanında açılmadı; yeniden deneniyor.',
  'voice.stt.crashed': 'Yazıya çevirme beklenmedik biçimde kapandı; yeniden başlatılıyor.',
  'voice.stt.timeout': 'Yazıya çevirme zamanında yanıt vermedi.',
  'voice.stt.aborted': 'Yazıya çevirme iptal edildi.',
  'voice.stt.requestFailed': 'Yazıya çevirme isteği başarısız oldu.',

  'voice.approval.ask': 'Onaylıyor musunuz?',
  'voice.approval.reask': 'Anlayamadım. Evet ya da hayır der misiniz?',

  'voice.conversation.notAllowed': 'Sohbet kipi şu an kullanılamıyor.',

  'voice.micTest.muted': 'Mikrofon kapalı. Sınamak için önce açın.',
  'voice.micTest.busy': 'Bir mikrofon sınaması zaten sürüyor.',
  'voice.micTest.noAudio': 'Mikrofondan ses gelmiyor.',
  'voice.notYet.calibration': 'Uyandırma kalibrasyonu henüz yok.',
  'voice.notYet.echoTest': 'Yankı sınaması henüz yok.',

  'voice.models.needDownload': 'İndirme gerekiyor.',
  'voice.models.badPath': 'Model listesinde geçersiz bir dosya yolu var.',
  'voice.models.hashMismatch': 'İndirilen dosyanın özeti tutmadı.',
  'voice.models.fileFailed': 'Dosya hazırlanamadı: {file}',
  'voice.models.noSpace': 'Diskte yeterli boş alan yok.',
  'voice.models.extractFailed': 'Arşivden dosya çıkarılamadı.',

  // ── bulut sesi (ElevenLabs) kullanılamayınca yerel sese düşüş. Hata değil BİLGİDİR: adada sakin bir satır olarak
  // bir kez görünür, Tanı'da neden olarak durur. `noKey` kullanıcıya hiç bildirilmez (yalnız Tanı).
  'voice.tts.fallback.noKey': 'ElevenLabs anahtarı yok; yerel ses kullanılıyor.',
  'voice.tts.fallback.unauthorized': 'Bulut sesinin anahtarı kabul edilmedi; yerel sesle devam ediyorum.',
  'voice.tts.fallback.payment': 'Seçili ses bu ElevenLabs planında yok; yerel sesle devam ediyorum.',
  'voice.tts.fallback.rateLimit': 'Bulut sesi şu an yoğun; kısa bir süre yerel sesle devam ediyorum.',
  'voice.tts.fallback.quota': 'Bulut sesinin kotası doldu; yerel sesle devam ediyorum.',
  'voice.tts.fallback.network': 'Bulut sesine ulaşamıyorum; yerel sesle devam ediyorum.',
  'voice.tts.fallback.timeout': 'Bulut sesi gecikti; bir süre yerel sesle devam ediyorum.',
  'voice.tts.fallback.interrupted': 'Bulut sesi yarıda kesildi; yerel sesle devam ediyorum.',
  'voice.tts.fallback.server': 'Bulut sesi yanıt vermiyor; yerel sesle devam ediyorum.',
  'voice.tts.fallback.budget': 'Sınama karakter sınırı doldu; yerel sesle devam ediyorum.',

  'voice.conversation.started': 'Tabii efendim, sizi dinliyorum.',
  // Veda sözüne ("güle güle", "görüşürüz", "iyi geceler") tek kısa yanıt; {address} başında boşlukla gelir ya da boştur.
  'voice.conversation.meetingBlocked': 'Toplantı kipi açıkken sohbet kipi açılmıyor; toplantı bitince açabilirim.',
  'voice.test.meeting': 'Toplantı kipi açıkken ses sınaması yapılmıyor; toplantı bitince yeniden deneyin.',
  'voice.conversation.farewell': 'Görüşürüz{address}.',
  'voice.conversation.farewellNight': 'İyi geceler{address}.',

  // ── uyandırma kalibrasyonu ──
  'voice.calibration.busy': 'Bir ses sınaması zaten sürüyor.',
  'voice.calibration.notReady': 'Ses hattı hazır değil; kalibrasyon yapılamadı.',
  'voice.calibration.ok': 'Sesinizi tanıdım. {heard} örneğin hepsini duydum.',
  'voice.calibration.okTuned': 'Sesinizi tanıdım. {heard} örneğin hepsini duydum; hızlı seziciyi sesinize göre daha duyarlı ayarladım.',
  'voice.calibration.okMixed':
    'Sesinizi tanıdım. Hızlı sezici {heard} örnekten {caught} tanesini yakaladı; kaçırdığında uyandırma yazıya çevirme yoluyla çalışır (yarım saniye kadar daha geç).',
  'voice.calibration.okWhisperOnly':
    'Sesinizi tanıdım. Hızlı sezici söyleyişinizi yakalayamadı; uyandırma yazıya çevirme yoluyla çalışacak (yarım saniye kadar daha geç).',
  'voice.calibration.partial': '{total} örnekten yalnız {heard} tanesini duyabildim. Daha sessiz bir ortamda yeniden deneyin.',
  'voice.calibration.failed': 'Uyandırma sözünü duyamadım. Mikrofonu denetleyip yeniden deneyin.',

  // ── yankı sınaması ──
  'voice.echo.sentence': 'Bu bir yankı sınamasıdır. Hey Jarvis, kendi sesimi duyup duymadığımı ölçüyorum, birkaç saniye sürecek.',
  'voice.echo.busy': 'Bir ses sınaması zaten sürüyor.',
  'voice.echo.notReady': 'Ses hattı hazır değil; yankı sınaması yapılamadı.',
  'voice.echo.noPlayback': 'Sınama sesi çalınamadı; yankı ölçülemedi.',
  'voice.echo.clean': 'Yankı yok: konuşurken sözümü kesebilirsiniz.',
  'voice.echo.cleanAll': 'Yankıyı bastırmanın daha güçlü kipine geçtim; artık kendi sesimi duymuyorum. Konuşurken sözümü kesebilirsiniz.',
  // ── söz kesme sınaması (Ayarlar › Ses) ──
  'voice.bargeTest.title': 'Söz kesme sınaması',
  'voice.bargeTest.never': 'Ben konuşurken araya girdiğinizde susup sizi dinliyor muyum? Hoparlörden kısa bir metin okurum; okurken üç kez araya girin.',
  'voice.bargeTest.done': 'Son sınama {when}: {trials} denemenin {stopped} tanesinde sustum.',
  'voice.bargeTest.run': 'Sınamayı başlat',
  'voice.bargeTest.running': 'Okuyorum; her bölümde bir kez araya girin (örneğin "bir dakika" deyin).',
  'voice.bargeTest.part1': 'Söz kesme sınaması başlıyor. Ben bu cümleleri okurken lütfen araya girin; bir şey söylediğinizde susup sizi dinlemem gerekiyor. Okumayı sürdürüyorum, hâlâ konuşuyorum ve sizi bekliyorum.',
  'voice.bargeTest.part2': 'İkinci bölüme geçiyorum. Yine istediğiniz an sözümü kesin; ne kadar çabuk sustuğumu ölçüyorum. Bu bölüm de birkaç cümle sürecek, acele etmenize gerek yok.',
  'voice.bargeTest.part3': 'Son bölüm. Bir kez daha araya girerseniz sınama tamamlanacak. Ardından sonucu ekranda göreceksiniz ve gerekirse ayarı bu cihaza göre düzelteceğim.',
  'voice.bargeTest.busy': 'Bir ses sınaması zaten sürüyor.',
  'voice.bargeTest.notReady': 'Ses hattı hazır değil; söz kesme sınaması yapılamadı.',
  'voice.bargeTest.ok': '{trials} denemenin {stopped} tanesinde sustum (ortanca {ms} ms). Konuşurken sözümü kesebilirsiniz.',
  'voice.bargeTest.missed': '{trials} denemenin yalnız {stopped} tanesinde sustum; duyarlığı artırdım. Sınamayı bir kez daha yapın.',
  'voice.bargeTest.self': 'Kendi sesimle {self} kez sustum; kendimi kesmemek için ayarı sıkılaştırdım. Sınamayı bir kez daha yapın.',
  'voice.bargeTest.failed': 'Bu hoparlörle kendi sesimi sizinkinden ayıramıyorum. Konuşurken yalnız uyandırma sözü ve "sus" beni durduracak; kulaklıkla sorun kalmaz.',
  'voice.echo.observed':
    'Kendi sesimi duyduğumu fark ettim. Sözümü yanlışlıkla kesmemek için konuşurken yalnız uyandırma sözü ve "sus" beni durduracak.',
  'voice.echo.leaked':
    'Hoparlörden çıkan sesim mikrofona sızıyor. Kendi sözümü kesmemek için konuşurken yalnız uyandırma sözü ve "sus" beni durduracak.',
  'voice.echo.leakedCoarse':
    'Hoparlörden çıkan sesim mikrofona sızıyor; yine de konuşurken araya girebilirsiniz. Önce sesimi kısarım, konuşmayı sürdürürseniz susup sizi dinlerim.',

  // Sesle başlatılan sınamalar ("söz kesme sınamasını başlat"); sınamanın kendi iletileri yukarıdadır.
  'voice.spokenTest.introBarge': 'Söz kesme sınamasını başlatıyorum. Üç bölüm okuyacağım; her bölümde bir kez araya girin.',
  'voice.spokenTest.introEcho': 'Yankı sınamasını başlatıyorum. Kısa bir cümle çalacağım; birkaç saniye sessiz kalın.',
  'voice.spokenTest.introWake': 'Uyandırma alıştırmasını başlatıyorum. Sözüm bitince, aralıklarla üç kez “{wake}” deyin.',
  'voice.spokenTest.introMic': 'Mikrofon sınamasını başlatıyorum. Sözüm bitince dört saniye boyunca bir şeyler söyleyin.',
  'voice.spokenTest.micHeard': 'Mikrofon çalışıyor; sizi duydum: “{text}”',
  'voice.spokenTest.micSpeech': 'Mikrofon çalışıyor ve konuşma algılandı, ama söyleneni yazıya çeviremedim.',
  'voice.spokenTest.micSilent': 'Mikrofondan ses geliyor ama konuşma algılanmadı. Biraz daha yakından ya da yüksek sesle deneyin.',
  'voice.spokenTest.failed': '{name} tamamlanamadı; ayrıntı günlüğe yazıldı.',
  'voice.spokenSetting.approvePcControl': 'Bilgisayarınızı kullanma iznini (fare, klavye, pencereler ve tarayıcı) açmak istiyorum',
  'voice.spokenSetting.approvePcRead': 'Ekranınızı ve pencerelerinizi okuma iznini açmak istiyorum',
  'voice.spokenSetting.approveJbrowser': 'Kendi tarayıcımı kullanma iznini (ayrı pencerede gezinme, okuma, form doldurma) açmak istiyorum',
} as const;
