// ── Araç kullanırken konuşma kuralı (I5, son inceleme; saf — birim testli: tests/anlatim-kurali.test.ts) ─────────────────────────
// G26 gerçek motorla gördü: sesli turda (düşük düşünme gücü) Fuber araçtan önce kendi akıl yürütmesini yazıyor ("Kullanıcı yeni bir
// oturum açmamı istedi; …") ve G21 bu araç öncesi cümleyi SESLİ okuyordu. Eski kural ("ne yaptığını tek cümleyle söyle") anlatıma davet
// ediyordu. Kural artık istemde (akış süzülmez — güvenilmez): araçtan önce HİÇBİR ŞEY yazılmaz; araçtan sonra kullanıcıya hitap eden
// tek cümle; kendi akıl yürütmesi, üçüncü şahıs anlatımı asla. Ses yolu ayrıca araçtan önce yazılan metni hiç söylemez (yapı kuralı:
// shared/sesli-yanit.ts).

/** Kişiliğin EYLEMLER bölümündeki kural (kisilik.ts). */
export const ARAC_ANLATIM_KURALI = '- Araçlarını cesurca kullan. Araç çağırmadan ÖNCE hiçbir şey yazma: doğrudan aracı çağır. Araç bitince kullanıcıya doğrudan hitap eden TEK cümleyle ne yaptığını söyle ("Yarın 09:00\'a kurdum."). Kendi akıl yürütmeni ASLA anlatma: kullanıcıdan üçüncü şahıs olarak söz etme ("Kullanıcı … istedi", "Kullanıcının isteğine göre…" YOK), ne yapacağını kendine anlatma ("Şimdi … yapmalıyım", "Önce … bakayım" YOK); ona "sen" diye konuş. Yapmadığın bir şeyi yapmış gibi ASLA anlatma; araç hata verdiyse söyle.';

/**
 * I6 (son inceleme): eski kural ("…yanlış olan hafıza kaydını düzelt") modeli kullanıcının kendi söylediğini silmeye davet ediyordu.
 * Hafıza satırları artık kaynağını taşır (hafiza/depo.ts; shared/hafiza-kaynak.ts); kullanıcıdan gelen kayıt yalnız ONAYLA değişir/silinir.
 */
export const HAFIZA_DUZELTME_KURALI = '- Hafıza kaydı ile hatırlatıcı/görev kaydı çelişirse hatırlatıcıyı ya da görevi KENDİLİĞİNDEN değiştirme: çelişkiyi tek cümleyle söyle, hangisinin doğru olduğunu sor. Hafıza satırında türün yanındaki kaynağa bak (ör. "(tercih; sohbetten)"): kendiliğinden yalnız "sohbetten", "belgeden" ya da "gün kaydından" gelen yanlış kaydı düzeltebilirsin; "sen söyledin", "kurulum" ya da "ayarlardan" gelen kaydı kullanıcı açıkça istemeden değiştirme ve silme — önce sor (silme aracı da bu kayıtlar için onay ister).';

/** Sesli turun bağlam talimatı (ajan/dongu.ts; yanıt sesli okunur). */
export const SESLI_TUR_TALIMATI = 'Bu mesaj SESLİ asistandan geldi: yanıtın sesli okunacak. Araç gerekiyorsa önce HİÇBİR ŞEY yazma, doğrudan aracı çağır; araçtan sonra kullanıcıya hitap ederek konuş. Kendi akıl yürütmeni asla yazma ya da söyleme ("Kullanıcı … istedi" gibi üçüncü şahıs anlatımı yok). İlk cümlen kısa olsun ve hemen söze gir; toplam 1-3 kısa cümle, konuşma dili; markdown, liste, bağlantı ve kod kullanma.';

/**
 * Kendi akıl yürütmesini anlatan yanıtı yakalar — YALNIZ testlerin denetimi (tests/anlatim-kurali.test.ts).
 * Akış bununla SÜZÜLMEZ (güvenilmez; kural istemde ve ses yolunun yapısında).
 */
// Sınırlar Unicode harfiyle (\b Türkçe harflerde — ı, ş, ü… — çalışmaz).
export const KENDI_ANLATIM_RE = /(?<!\p{L})kullanıcı(?:nın|ya|yı|dan)?(?!\p{L})[^.!?\n]{0,80}?(?<!\p{L})(?:ist(?:edi|iyor|ediği|enen|eği)|sordu|soruyor|söyledi|diyor|dedi|açmamı|kurmamı|yapmamı|bakmamı)|(?<!\p{L})(?:şimdi|önce|sonra)(?!\p{L})[^.!?\n]{0,60}?(?<!\p{L})(?:yapmalıyım|çağırmalıyım|bakmalıyım|kontrol etmeliyim|kullanmalıyım|açmalıyım|kurmalıyım)(?!\p{L})|(?<!\p{L})(?:the user|user wants|i should|i need to|let me)(?!\p{L})/iu;
