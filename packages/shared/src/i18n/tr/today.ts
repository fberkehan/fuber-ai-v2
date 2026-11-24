/**
 * Türkçe sözlük · alan: today. Bugün sayfası (Kokpit): selam, bugün bandı ve Planlar'dan gelen kartların metinleri.
 * Panonun kendi metinleri (kart başlıkları, menü, boş durum, yerleşik sohbet) `dashboard.ts` içindedir.
 * Düz anahtarlar; yer tutucu `{ad}`. Yeni anahtar bu alanın önekiyle başlar ve başka dosyada yinelenemez.
 * Hitap "siz"dir (Jarvis "efendim" diyen bir asistandır).
 */
export default {
  'today.greeting.morning': 'Günaydın',
  'today.greeting.day': 'İyi günler',
  'today.greeting.evening': 'İyi akşamlar',
  'today.greeting.night': 'İyi geceler',
  'today.greeting.withName': '{greeting}, {name}.',

  // Selamın altındaki cümle gerçek durumu söyler: bekleyen karar, bugün, sıradaki.
  'today.summary.lead': 'Bugün {list} var.',
  // Sayı ile adı arasında bölünmez boşluk: satır sonunda sayı adından kopmaz.
  'today.summary.reminders': '{count}\u00a0hatırlatıcı',
  'today.summary.todos': 'listede {count}\u00a0iş',
  'today.summary.next': 'Bugün için bir şey yok; sırada {when}: {text}.',
  'today.summary.clear': 'Takviminiz boş; güzel bir gün.',

  'today.core.talk': 'Konuşmak için tıklayın',

  // "Sırada" kartı: hatırlatıcıların zaman çizgisi.
  'today.timeline.overdue': 'Gecikenler',
  'today.timeline.today': 'Bugün',
  'today.timeline.tomorrow': 'Yarın',
  'today.timeline.day': '{day}, {date}',
  'today.timeline.daysLeft': '{count} gün',
  'today.timeline.unverified': 'Doğrulanmadı',
  'today.timeline.complete': 'Tamamlandı',

  'today.todos.late': 'Gecikti',
  'today.todos.complete': '“{text}” tamamlandı',

  'today.pending.title': 'Bekleyenler',
  'today.pending.dismiss': 'Kapat',

  'today.usage.budget': 'bütçe {budget}',
  'today.usage.calls': 'Bugün {count} model çağrısı.',
  'today.usage.over': 'Günlük bütçe doldu; yalnız sesli yanıtlar çalışıyor.',

  // Modüllerin pano kartları: toplantı (sürüyor / son toplantı), önemli e-postalar, süren işlerdeki takip işi.
  'today.meeting.title': 'Son toplantı',
  'today.meeting.live': 'Toplantı sürüyor',
  'today.meeting.since': '{time} başladı, {duration}',
  'today.meeting.liveHint': 'Döküm ve çeviri Toplantı sayfasında.',
  'today.meeting.open': 'Toplantıyı aç',
  'today.meeting.summarizing': 'Özet yazılıyor…',
  'today.meeting.noSummary': 'Bu toplantının özeti yok.',
  'today.meeting.counts': '{decisions} karar, {actions} yapılacak',
  'today.mail.more': '{count} önemli e-posta daha',
  'today.mail.failing': 'Eşitlemede sorun var; liste eksik olabilir.',
  // E-posta kartı (canlı): bağlantı durumu, son iletiler, "Yeni" vurgusu.
  'today.live.new': 'Yeni',
  'today.mailCard.title': 'E-posta',
  'today.mailCard.unread': '{count} okunmamış',
  'today.mailCard.important': '{count} önemli',
  'today.mailCard.empty': 'Gelen kutusu temiz. Okunmamış ileti yok.',
  'today.mailCard.error': 'Eşitlenemedi',
  'today.mailCard.errorHint': '{account}: {reason}',
  'today.mailCard.importantMark': 'Önemli',
  'today.mailCard.open': 'E-posta ayarlarını aç',
  'today.jobs.paused': 'Duraklatıldı',
  'today.jobs.openWatch': '“{title}” işini aç',

  'today.voiceNotReady':'Ses hazırlanırken yandaki kutudan yazarak konuşabilirsiniz.',
  'today.voiceNotReadyKey': 'Hazır olunca konuşmak için:',
} as const;
