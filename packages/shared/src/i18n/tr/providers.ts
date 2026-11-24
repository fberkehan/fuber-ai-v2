// OpenAI uyumlu bulut sağlayıcıları (G8): masaüstünün hata ve duyuru cümleleri, Yönetim'in sağlayıcı bölümü.
export default {
  // ── masaüstü: hata ve yerele düşüş duyuruları ──
  'cloud.provider.generic': 'Bulut sağlayıcısı',
  'cloud.error.auth': '{provider} anahtarı kabul edilmedi. Fuber Yönetim’den kontrol edin.',
  'cloud.error.billing': '{provider} hesabında kredi yok. Fuber Yönetim’den kontrol edin.',
  'cloud.error.network': '{provider} sağlayıcısına şu an bağlanamıyorum. Biraz sonra yeniden deneyin.',
  'cloud.error.rateLimit': '{provider} şu an hız sınırında. Birazdan yeniden deneyin.',
  'cloud.error.server': '{provider} şu an hata veriyor. Birazdan yeniden deneyin.',
  'cloud.error.model': '{provider} seçili modeli bulamadı. Fuber Yönetim’den model ayarını kontrol edin.',
  'cloud.error.cut': '{provider} bağlantısı yanıtın ortasında koptu.',
  'cloud.error.badRequest': '{provider} isteği kabul etmedi. Fuber Yönetim’den model ve sağlayıcı ayarını kontrol edin.',
  'cloud.error.forbidden': '{provider} bu isteği kapattı (yönetici kapatmış ya da bölge kısıtı var). Fuber Yönetim’den kontrol edin.',
  'cloud.notice.forbidden': '{provider} bu isteği kapattı (yönetici kapatmış ya da bölge kısıtı var); bu bilgisayardaki modelle yanıtlıyorum.',
  'cloud.error.noKey': '{provider} anahtarı Fuber Yönetim’de tanımlı değil.',
  'cloud.error.noEndpoint': 'Seçili bulut sağlayıcısının kaydı Fuber Yönetim’de yok.',
  'cloud.error.private': 'Gizli kipteyim: buluta bir şey gönderilmiyor ve bu bilgisayardaki model hazır değil.',
  'cloud.notice.private': 'Gizli kipteyim; bu bilgisayardaki modelle yanıtlıyorum.',
  'cloud.notice.noKey': '{provider} anahtarı henüz tanımlı değil; bu bilgisayardaki modelle çalışıyorum.',
  'cloud.notice.billing': '{provider} hesabında kredi yok; bu bilgisayardaki modelle çalışıyorum.',
  'cloud.notice.auth': '{provider} anahtarı kabul edilmedi; bu bilgisayardaki modelle çalışıyorum.',
  'cloud.notice.model': '{provider} seçili modeli bulamadı; bu bilgisayardaki modelle yanıtlıyorum.',
  'cloud.notice.busy': '{provider} şu an yanıt veremiyor; bu bilgisayardaki modelle yanıtlıyorum.',
  'cloud.notice.network': '{provider} sağlayıcısına şu an ulaşamıyorum; bu bilgisayardaki modelle devam ediyorum.',

  'cloud.deep.compatRole': 'Derin rol OpenAI uyumlu bir sağlayıcıda; derin işler (Atölye, araştırma, ekrana bakma) Anthropic API ya da bu bilgisayardaki Claude Code ile yürür.',

  // ── Yönetim: anahtar kartları ──
  'admin.keys.provider.openrouter': 'OpenRouter',
  'admin.keys.provider.moonshot': 'Moonshot (Kimi)',
  'admin.keys.provider.custom': 'Özel adres (OpenAI uyumlu)',
  'admin.keys.use.openrouter': 'Beyin: OpenRouter üzerinden yüzlerce model (Kimi, DeepSeek, Qwen, GPT…).',
  'admin.keys.use.moonshot': 'Beyin: Moonshot’un Kimi modelleri.',
  'admin.keys.use.custom': 'Beyin: Bulut sağlayıcıları bölümünde adresi yazılan OpenAI uyumlu sunucu.',

  // ── Yönetim: Beyin › Bulut sağlayıcıları ──
  'admin.cloud.title': 'Bulut sağlayıcıları (OpenAI uyumlu)',
  'admin.cloud.description':
    'Anthropic dışında beyin olarak kullanılabilecek sağlayıcılar. Anahtarlar Ses ve Anahtarlar ekranındaki kasada durur; masaüstü anahtar istemez. Bir role atamak için rol kartında “Nerede” seçimini “Bulut (OpenAI uyumlu)” yapın.',
  'admin.cloud.key.ready': 'Anahtar kasada',
  'admin.cloud.key.missing': 'Anahtar yok',
  'admin.cloud.key.add': 'Anahtar ekle',
  'admin.cloud.baseUrl': 'Temel adres',
  'admin.cloud.baseUrlHint': 'Sonu genellikle /v1 ile biter. http adreste anahtar şifresiz gider; yalnız bu bilgisayar ya da yerel ağ için kullanın.',
  'admin.cloud.defaultModel': 'Varsayılan model',
  'admin.cloud.caps': 'Yetenekler',
  'admin.cloud.caps.tools': 'Araç çağrısı',
  'admin.cloud.caps.vision': 'Görsel girdi',
  'admin.cloud.caps.stream': 'Akış',
  'admin.cloud.addCustom': 'Özel adres ekle',
  'admin.cloud.removeCustom': 'Kaldır',
  'admin.cloud.customName': 'Özel adres',
  'admin.cloud.inUse': '{roles} rolünde kullanılıyor',
  'admin.cloud.notes.openai': 'Akıl yürüten modellerde (o3, gpt-5) çıktı sınırı max_completion_tokens ile gider, sıcaklık gönderilmez.',
  'admin.cloud.notes.openrouter': 'Gerçek maliyet her yanıtla gelir. ":free" modeller kredisiz de çalışır ama günlük sınırı düşüktür.',
  'admin.cloud.notes.moonshot': 'Kimi K2 için sıcaklık 0,6. Uluslararası adres api.moonshot.ai; Çin hesabı için api.moonshot.cn.',
  'admin.cloud.notes.custom': 'Herhangi bir OpenAI uyumlu sunucu (LM Studio, vLLM, Ollama, kendi geçidiniz). Tanımadığı alanı reddederse alan bir kez çıkarılıp yeniden denenir.',

  // ── Yönetim: rol kartında OpenAI uyumlu seçim ──
  'admin.cloud.where.option': 'Bulut (OpenAI uyumlu)',
  'admin.cloud.where.optionHint': 'OpenAI, OpenRouter, Kimi ya da özel adres.',
  'admin.cloud.role.provider': 'Sağlayıcı',
  'admin.cloud.role.model': 'Model',
  'admin.cloud.role.modelPlaceholder': 'Model kimliği, ör. moonshotai/kimi-k2',
  'admin.cloud.role.list': 'Listeden seç',
  'admin.cloud.role.listLoading': 'Model listesi alınıyor…',
  'admin.cloud.role.listFailed': 'Liste alınamadı: {message}',
  'admin.cloud.role.listEmpty': 'Bu sağlayıcı model listesi vermedi; kimliği elle yazın.',
  'admin.cloud.role.listMore': '{count} model daha; aramak için kimliğin bir kısmını yazın.',
  'admin.cloud.role.noKey': '{provider} anahtarı kasada yok. Anahtar eklenince liste ve sınama açılır.',
  'admin.cloud.role.price': 'Fiyat ($/M token)',
  'admin.cloud.role.priceValue': 'girdi {input} $ · çıktı {output} $',
  'admin.cloud.role.priceUnknown': 'bilinmiyor (kullanım kaydında “fiyat bilinmiyor” yazar)',
  'admin.cloud.role.priceFromList': 'Fiyat sağlayıcının listesinden alındı.',
  'admin.cloud.role.tools': 'araç',
  'admin.cloud.role.vision': 'görsel',
  'admin.cloud.role.context': '{tokens} bağlam',
  'admin.cloud.role.noTools': 'Bu model araç çağrısını desteklemiyor görünüyor: hatırlatıcı, hafıza gibi işleri yapamaz.',
  'admin.cloud.role.effortNote': 'Efor yalnız akıl yürüten modellere gider (reasoning_effort / reasoning).',

  // ── Yönetim: sohbet modeli ──
  'admin.cloud.chat.title': 'Yazılı sohbetin modeli',
  'admin.cloud.chat.hint': 'Kapalıyken yazılı sohbet Derin işler rolünün modelini kullanır. Açınca sohbet ayrı bir modele (ör. Kimi) gider, derin işler yerinde kalır.',
  'admin.cloud.chat.separate': 'Ayrı model kullan',
  'admin.cloud.chat.same': 'Derin işlerle aynı model',

  'admin.field.providers': 'Bulut sağlayıcıları',
  'admin.field.models.chat': 'Sohbet modeli',


  // ── Yönetim: kullanım ──
  'admin.cloud.usage.unknown': 'bilinmiyor',
  'admin.cloud.usage.unpriced': '{count} çağrının fiyatı bilinmiyor; toplama girmedi. Günlük bütçe kapısında çağrı başına 0,02 $ sayılır (fiyatı rolde verirseniz gerçek tutar sayılır).',
} as const;
