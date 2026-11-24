/**
 * Türkçe sözlük · alan: dashboard. Kokpit (Bugün sayfasının panosu): kart başlıkları, kart içi metinler, araç yanıtları.
 * Düz anahtarlar; yer tutucu `{ad}`. Yeni anahtar bu alanın önekiyle başlar ve başka dosyada yinelenemez.
 * Hitap "siz"dir. Araç yanıtları (`dashboard.tool.*`) modele gider: kısa ve olgusal.
 */
export default {
  'module.dashboard.name': 'Kokpit',
  'module.dashboard.description': 'Bugün sayfasının panosu: hava, döviz, haber, sıradaki işler ve asistanın eklediği kartlar.',

  'dashboard.error.off': 'Kokpit modülü kapalı.',
  'dashboard.error.title': 'Pano okunamadı',

  // ── kart başlıkları ──
  'dashboard.card.today': 'Bugün',
  'dashboard.card.notices': 'Bildirimler',
  'dashboard.card.jobs': 'Süren işler',
  'dashboard.card.agenda': 'Sırada',
  'dashboard.card.todos': 'Yapılacaklar',
  'dashboard.card.weather': 'Hava',
  'dashboard.card.fx': 'Döviz',
  'dashboard.card.news': 'Haberler',
  'dashboard.card.suggestions': 'Öneriler',
  'dashboard.card.sessions': 'Claude Code',
  'dashboard.card.activity': 'Son olanlar',
  'dashboard.card.usage': 'Bugünkü kullanım',

  // ── kart çerçevesi ──
  'dashboard.menu.label': '{title}: kart seçenekleri',
  'dashboard.menu.size': 'Boyut',
  'dashboard.size.small': 'Küçük',
  'dashboard.size.medium': 'Orta',
  'dashboard.size.wide': 'Geniş',
  'dashboard.size.large': 'Büyük',
  'dashboard.menu.earlier': 'Bir öne al',
  'dashboard.menu.later': 'Bir sona al',
  'dashboard.menu.remove': 'Panodan kaldır',
  'dashboard.drag': '{title} kartını taşımak için sürükleyin',
  'dashboard.byAssistant': '{name} ekledi',
  'dashboard.stale': 'Son veri {time}',
  'dashboard.more': '{count} tane daha',
  'dashboard.removed': '“{title}” panodan kaldırıldı.',
  'dashboard.reset': 'Düzeni sıfırla',
  'dashboard.resetDone': 'Pano varsayılan düzene döndü.',
  'dashboard.grid.label': 'Pano kartları',

  // ── bugün bandı ──
  'dashboard.week.label': 'Önümüzdeki yedi gün',
  'dashboard.week.count': '{day}: {count} kayıt',
  'dashboard.week.none': '{day}: kayıt yok',
  'dashboard.approval.more': '{count} onay daha bekliyor',

  // ── süren işler ──
  'dashboard.jobs.stop': 'Durdur',
  'dashboard.jobs.stopLabel': '“{title}” işini durdur',
  'dashboard.jobs.queued': 'Sırada bekliyor',
  'dashboard.jobs.remaining': '{time} kaldı',
  'dashboard.jobs.elapsed': '{time} önce başladı',
  'dashboard.jobs.minutes': '{count} dk',
  'dashboard.jobs.hours': '{hours} sa {minutes} dk',
  'dashboard.jobs.almost': 'bitmek üzere',
  'dashboard.jobs.justStarted': 'az önce başladı',

  // ── sırada ──
  'dashboard.agenda.snoozeHour': '1 saat ertele',
  'dashboard.agenda.snoozeTomorrow': 'Yarına ertele',

  // ── son günler ──

  // ── hava, döviz, haber ──
  'dashboard.weather.range': 'En yüksek {max}°, en düşük {min}°',
  'dashboard.fx.spread': 'Alış {buying}, satış {selling}',
  'dashboard.fx.source': '{source}, {date}',
  'dashboard.fx.up': '{value} yükseldi',
  'dashboard.fx.down': '{value} düştü',
  'dashboard.news.open': 'Haberi tarayıcıda aç',

  // ── Claude Code, son olanlar ──
  'dashboard.activity.jobDone': '{title} bitti',
  'dashboard.activity.jobFailed': '{title} tamamlanamadı',
  'dashboard.activity.jobCancelled': '{title} durduruldu',

  // ── öneriler ──
  'dashboard.suggestions.use': 'Sohbete yaz',
  'dashboard.suggestions.dismiss': 'Öneriyi kapat',

  // ── özel kartlar ──
  'dashboard.custom.progress': '%{value}',
  'dashboard.custom.open': 'Bağlantıyı aç',

  // ── boş durum ──
  'dashboard.empty.card': 'Başlarken',
  'dashboard.empty.title': 'Pano sizi bekliyor.',
  'dashboard.empty.cardBody': 'Hatırlatıcılarınız, işleriniz ve asistanınızın eklediği kartlar burada görünür. Bir örneğe dokunun ya da kendi sözünüzü yazın.',
  'dashboard.empty.body': 'Bir hatırlatıcı kurduğunuzda, bir iş başlattığınızda ya da {name} bir kart eklediğinde burası dolar. Bir örneğe dokunun ya da kendi sözünüzü yazın.',
  'dashboard.starter.reminder.title': 'Hatırlatıcı kurun',
  'dashboard.starter.reminder.prompt': 'Yarın saat onda muhasebeciyi aramayı hatırlat',
  'dashboard.starter.card.title': 'Panoya kart ekletin',
  'dashboard.starter.card.prompt': 'Panoya lansmana kaç gün kaldığını gösteren bir kart ekle',
  'dashboard.starter.weather.title': 'Havayı sorun',
  'dashboard.starter.weather.prompt': 'Bugün hava nasıl, şemsiye almalı mıyım?',
  'dashboard.starter.project.title': 'Projeyi açtırın',
  'dashboard.starter.project.prompt': 'Blog projesini aç',
  'dashboard.starter.news.title': 'Haberleri özetletin',
  'dashboard.starter.news.prompt': 'Bugünün haberlerini üç cümlede özetle',

  // ── yerleşik sohbet ──
  'dashboard.chat.title': 'Sohbet',
  'dashboard.chat.new': 'Yeni sohbet',
  'dashboard.chat.open': 'Sohbet sayfasında aç',
  'dashboard.chat.show': 'Konuşmayı göster',
  'dashboard.chat.hide': 'Konuşmayı gizle',
  'dashboard.chat.empty': '{name} ile konuşma burada akar. Bir şey yazın ya da “{wake}” deyin.',
  'dashboard.chat.earlier': 'Önceki iletiler Sohbet sayfasında.',

  // ── araç yanıtları (modele) ──
  'dashboard.tool.added': '“{title}” kartı panoya eklendi.',
  'dashboard.tool.updated': '“{title}” kartı güncellendi.',
  'dashboard.tool.removed': '“{title}” kartı panodan kaldırıldı.',
  'dashboard.tool.alreadyRemoved': '“{title}” kartı zaten kaldırılmış.',
  'dashboard.tool.restored': '“{title}” kartı panoya geri getirildi.',
  'dashboard.tool.notHidden': '“{title}” kartı kaldırılmamış; panoda duruyor ya da şu an gösterecek verisi yok.',
  'dashboard.tool.resized': '“{title}” kartı {size} boyuta getirildi.',
  'dashboard.tool.reordered': 'Kartların yeni sırası: {list}.',
  'dashboard.tool.skipped': 'Bulunamayan: {list}.',
  'dashboard.tool.reset': 'Pano varsayılan düzene döndü; kaldırılan yerleşik kartlar geri geldi.',
  'dashboard.tool.notFound': 'Böyle bir kart yok: “{card}”. Panodaki kartlar: {list}.',
  'dashboard.tool.hiddenMark': 'kaldırılmış',
  'dashboard.tool.order': 'Sıra: {list}.',
  'dashboard.tool.state': 'Panoda {count} kart var (sırayla; soldan sağa, yukarıdan aşağıya): {list}.',
  'dashboard.claim.notDone': 'Henüz taşımadım efendim; hangi kartı nereye alayım?',
  'dashboard.self.canChange': 'Ana ekrandaki pano (Bugün sayfası): kartları taşır, büyütür, küçültür; kalıcı kart ekler, kaldırır; düzeni sıfırlar.',
  'dashboard.tool.hint': 'Ana ekrandaki pano şu an (sırayla): {list}. Bir kartı taşımak, büyütmek ya da küçültmek için dashboard_card_move, kaldırmak için dashboard_card_remove çağır; aracı çağırmadan "taşıdım" ya da "yaptım" deme.',
  'dashboard.tool.stateEmpty': 'Panoda şu an kart yok.',
  'dashboard.tool.stateHidden': 'Kaldırılmış kartlar (geri getirilebilir): {list}.',
  'dashboard.tool.stateNoData': 'Şu an verisi olmadığı için çizilmeyenler: {list}.',
  'dashboard.tool.where.top': 'en üst sıra',
  'dashboard.tool.where.bottom': 'en alt sıra',
  'dashboard.tool.where.row': '{row}. sıra',
  'dashboard.tool.where.left': 'solda',
  'dashboard.tool.where.middle': 'ortada',
  'dashboard.tool.where.right': 'sağda',
  'dashboard.tool.where.full': 'boydan boya',
  'dashboard.tool.moved.top': '“{title}” kartı en üste alındı.',
  'dashboard.tool.moved.bottom': '“{title}” kartı en alta alındı.',
  'dashboard.tool.moved.left': '“{title}” kartı bir öne (sola) alındı.',
  'dashboard.tool.moved.right': '“{title}” kartı bir sona (sağa) alındı.',
  'dashboard.tool.moved.before': '“{title}” kartı “{other}” kartının önüne alındı.',
  'dashboard.tool.moved.after': '“{title}” kartı “{other}” kartının yanına (hemen ardına) alındı.',
  'dashboard.tool.needMove': 'Kartı nereye taşıyacağımı ya da boyutunu söyleyin: position (top, bottom, left, right, before:<kart>, after:<kart>) ya da size (bigger, smaller, small, medium, wide, large).',
  'dashboard.tool.badPosition': '“{position}” anlaşılmadı. position şunlardan biri olmalı: top, bottom, left, right, before:<kart>, after:<kart>.',
  'dashboard.tool.badAnchor': 'Kart “{title}” kartına göre taşınamaz; başka bir kart adı verin.',
  'dashboard.tool.anchorNotShown': '“{title}” kartı şu an panoda çizilmiyor; başka bir karta göre ya da top / bottom ile taşıyın.',
  'dashboard.tool.sizeMax': '“{title}” kartı zaten en büyük boyutta ({size}).',
  'dashboard.tool.sizeMin': '“{title}” kartı zaten en küçük boyutta ({size}).',
  'dashboard.tool.sizeSame': '“{title}” kartı zaten {size} boyutta.',
  'dashboard.tool.notDrawn': '“{title}” kartının şu an gösterecek verisi yok; yeri kaydedildi, veri gelince orada çizilir.',
  'dashboard.tool.tooMany': 'Panoda en çok {count} özel kart durabilir; önce birini kaldırın.',
  'dashboard.tool.bandFixed': 'Bugün bandı sabittir: taşınamaz, kaldırılamaz, boyutu değişmez.',
  'dashboard.tool.builtinOnlySize': '“{title}” yerleşik bir karttır; içeriği veriden gelir. Yalnız boyutu (size) değiştirilebilir.',
  'dashboard.tool.placeOnlyWeather': 'place yalnız hava kartında (card="weather") kullanılır.',
  'dashboard.tool.placeSet': 'Hava kartı artık {place} için gösteriliyor.',
  'dashboard.tool.placeFailed': '“{place}” için hava durumu alınamadı; yer adı bulunamadı ya da ağ kapalı. Kart veri gelene kadar çizilmez.',
  'dashboard.tool.needOrder': 'action=reorder için order gerekli.',
  'dashboard.tool.needCardSize': 'action=resize için card ve size gerekli.',
  'dashboard.tool.needCard': 'action=restore için card gerekli.',
  'dashboard.tool.none': 'kart yok',
  'dashboard.tool.suggested': 'Öneri panoya eklendi: {text}',
} as const;
