/**
 * Türkçe sözlük · alan: selfchange. Kendini değiştirme kapısı (`core/self-change-guard.ts`): eklenti yapımı ve çekirdek
 * geliştirme isteklerinin yalnız kullanıcının kendi sözüyle başlaması.
 * Düz anahtarlar; yer tutucu `{ad}`. Yeni anahtar bu alanın önekiyle başlar ve başka dosyada yinelenemez.
 */
export default {
  'selfchange.notUser':
    'Kendimi geliştirme isteğini yalnız siz verebilirsiniz; bu istek bir arka plan işinden ya da bir eklentiden geldi, başlatmadım.',
  'selfchange.speaker': 'Sesinizi tanıyamadım; kendimi geliştirme isteğini yalnız tanıdığım sesle başlatırım.',
  'selfchange.tainted': 'Bu turda dış içerik okudum ({tools}); isteğin sizden geldiğinden emin olmak için onayınızı istiyorum.',
  'selfchange.denied': 'Onay vermediniz; başlatmadım.',
  'selfchange.noAnswer': 'Onay beklerken yanıt gelmedi; başlatmadım. İsterseniz yeniden söyleyin.',
};
