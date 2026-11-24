// Sağlayıcının ham hata gövdesi (JSON, istek kimliği) sohbete yazılmaz: kullanıcı ne olduğunu ve ne yapacağını tek cümleyle görür.

/** İstek reddedildi (400) ya da genel API hatası: sağlayıcı iletisinden kullanıcı cümlesi. */
export function motorHataMetni(saglayici: string, ham: string): string {
  if (/credit balance|insufficient[_ ](?:quota|credits?)|billing|exceeded your current quota/i.test(ham)) {
    return `${saglayici} hesabının bakiyesi bitti. Hesabına kredi yükle ya da Ayarlar'dan Fuber'e dön.`;
  }
  if (/prompt is too long|context[_ ]length|maximum context|too many tokens/i.test(ham)) {
    return 'Bu sohbet modelin sınırını aştı. Yeni bir sohbet aç.';
  }
  if (/model[^.]*(not found|not exist|does not have access)|not_found/i.test(ham)) {
    return `Seçili ${saglayici} modeline ulaşılamadı. Ayarlar'dan başka bir model seç.`;
  }
  return `${saglayici} bu isteği kabul etmedi. Yeniden dene; sürerse Ayarlar'dan Fuber'e dön.`;
}
