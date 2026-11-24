/**
 * Türkçe sözlük · alan: profile. Kullanıcı profili (hafızanın yapılandırılmış katmanı): kategori ve kaynak adları,
 * "Beni nasıl tanıyorsun" özeti, profil araçlarının yanıtları. Düz anahtarlar; yer tutucu `{ad}`.
 */
export default {
  'profile.category.identity': 'Kimlik',
  'profile.category.circle': 'Yakın çevre',
  'profile.category.work': 'İşler ve projeler',
  'profile.category.preference': 'Tercihler',
  'profile.category.style': 'Üslup ve hitap',
  'profile.category.routine': 'Rutinler',
  'profile.category.interest': 'İlgi alanları',
  'profile.category.dislike': 'Sevmedikleri',
  'profile.category.ongoing': 'Süren meseleler',
  'profile.category.rule': 'Davranış kuralları',

  'profile.origin.said': 'açıkça söylediniz',
  'profile.origin.inferred': 'sohbetten çıkarıldı',
  'profile.origin.observed': 'davranışınızdan öğrenildi',
  'profile.origin.user': 'elle yazdınız',
  'profile.origin.intro': 'tanışırken söylediniz',

  'profile.summary.empty': 'Sizi henüz tanımıyorum. Konuştukça öğreneceğim; isterseniz kendinizden, işlerinizden ve nasıl yanıt istediğinizden söz edin.',
  'profile.summary.lead': 'Hakkınızda {count} şey biliyorum; ilk kaydı {since} öğrendim.',
  'profile.summary.today': 'bugün',
  'profile.summary.rules': 'Uyduğum {count} kuralınız var: {list}.',

  'profile.tool.noted': 'Profile kaydedildi ({category}).',
  'profile.tool.confirmed': 'Bu bilgi profilde zaten var; doğrulandı.',
  'profile.tool.superseded': 'Profildeki eski kaydın yerini aldı (önceden: {previous}).',
  'profile.tool.secret': 'Bu bir sır gibi görünüyor (parola, kart ya da kimlik numarası); profile yazılmaz.',
  'profile.tool.empty': 'Kaydedilecek metin boş.',
  'profile.tool.keptUserWord': 'Bu konuda kullanıcının kendi sözü kayıtlı; çıkarım onun üstüne yazılmadı. Kullanıcı açıkça söylediyse explicit=true ile yeniden yaz.',
  'profile.tool.unknownId': 'Bu kimlikte bir profil kaydı yok; önce profile_get ile bul.',
  'profile.tool.removed': 'Profilden silindi: {text}',
  'profile.tool.removeFailed': 'Kayıt silinemedi.',

  'profile.error.notFound': 'Kayıt bulunamadı.',
  'profile.error.emptyText': 'Metin boş olamaz.',

  'profile.self.canChange': 'kullanıcı profilini: hakkında öğrendiklerimi ve bana koyduğu davranış kurallarını kaydeder, düzeltir, silerim (profile_note, profile_get, profile_forget)',
} as const;
