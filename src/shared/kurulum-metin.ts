// ── Kurulumun "sen / siz" metinleri: TEK yer (0.13.1 düzeltme turu 1) ─────────────────────────────────────────────────────────────────
// Kurulum "sen" konuşur. Kullanıcı Adım 3'te resmî bir hitap (Bey, Hanım, Hocam…; shared/hitap.ts sizliMi) seçtiyse Adım 3'ün dipnotundan kurulum
// sonuna kadar (Adım 3'ün sol sütunu hariç: hitabın seçildiği yer; Adım 1–2 hitap seçilmeden önce gelir) BÜTÜN görünür metin ve örnek mesajlar "siz"
// konuşur. "Sadece adımla" (ya da serbest, resmî olmayan hitap) ise Adım 11 dahil hepsi "sen" kalır. Fuber'in sohbet dili değişmez.
// Her metin bir `(sen, siz)` ÇİFTİdir; bileşenler çifti `AdimBaglami.m(çift)` ile seçer (hitaba göre). Sen eki taşıyan kurulum metni bu dosyanın
// ya da (paylaşılan modüllerde) açıkça `siz` parametresi alan işlevlerin dışında yazılmaz. Birim testi: tests/kurulum-cila.test.ts — her çift
// farklıdır, "siz" tarafında sen eki yoktur; canlı denetim: scripts/dev/kurulum2-onizle.mjs (Bey ile Adım 3 önizlemesi ve 4–11 bütün ekran metni).
import { NEREDE_FUBER_CUMLESI, NEREDE_FUBER_CUMLESI_SIZ } from './nerede.ts';
import { YEDEK_SES_INMEDI } from './ses-kimligi.ts';
import { GM } from './gizlilik-metni.ts';

export type Cift = readonly [sen: string, siz: string];
/** Çiftten hitaba göre metin. */
export const sec = (siz: boolean, c: Cift): string => (siz ? c[1] : c[0]);

export const KM = {
  // ── Adım 2 · Fuber hesabı, bağlı hâl (0.14 T32 düzeltme turu 1): ilk kurulumda hitap henüz yok ("sen"); yeniden açılan kurulumda ya da Geri ile
  // dönülünce hitap biliniyorsa "siz". Hesap akışının formları (renderer/hesap/HesapAkisi.tsx, Ayarlar ile ortak) bu kapsamın dışında. ──
  hesapBagliBaslik: ['Fuber hesabın bağlı.', 'Fuber hesabınız bağlı.'],
  hesapBekliyorBaslik: ['Hesabın onay bekliyor.', 'Hesabınız onay bekliyor.'],
  hesapAcildiBaslik: ['Hesabın açıldı.', 'Hesabınız açıldı.'],
  hesapBekliyorGiris: ['Onaylanınca Fuber hemen açılır. O sırada kuruluma devam edebilirsin.', 'Onaylanınca Fuber hemen açılır. O sırada kuruluma devam edebilirsiniz.'],
  hesapAcildiGiris: ['Kuruluma devam edebilirsin.', 'Kuruluma devam edebilirsiniz.'],
  hesapDurumAktif: ['Fuber hesabın bu bilgisayara bağlı; her şey hazır.', 'Fuber hesabınız bu bilgisayara bağlı; her şey hazır.'],
  hesapDurumBekliyor: ['Hesabın onay bekliyor. Onaylanınca Fuber hemen açılır.', 'Hesabınız onay bekliyor. Onaylanınca Fuber hemen açılır.'],
  /** `e`: iletişim adresi (çağıran verir). */
  hesapDurumKredi: (e: string): Cift => [`Kullanım hakkın doldu. ${e} ile iletişime geç.`, `Kullanım hakkınız doldu. ${e} ile iletişime geçin.`],
  hesapDogrulaSonra: ['E-postanı henüz doğrulamadın. Doğrulayınca kullanım hakkın başlar. Ayarlar → Hesap’tan doğrulayabilirsin.', 'E-postanızı henüz doğrulamadınız. Doğrulayınca kullanım hakkınız başlar. Ayarlar → Hesap’tan doğrulayabilirsiniz.'],
  /** Bağlı hesabın tek maddesi: yeni bilgi (nereden yönetilir). Giriş ve dipnot tekrarlanmaz. */
  hesapAyarlarda: ['Hesabın Ayarlar’da', 'Hesabınız Ayarlar’da'],
  hesapAyarlardaAlt: ['Ayarlar → Hesap’tan yönetirsin.', 'Ayarlar → Hesap’tan yönetirsiniz.'],
  hesapSifreDip: ['Şifren bu bilgisayarda saklanmaz.', 'Şifreniz bu bilgisayarda saklanmaz.'],
  hesapKartEposta: ['E-posta adresin', 'E-posta adresiniz'],
  hesapKartBilgisayarlar: ['Bir hesap, bütün bilgisayarların', 'Bir hesap, bütün bilgisayarlarınız'],
  // Formun üst dalı (T34b, T32 N2): erişimi kapalı hesap, yükseltme (yalnız hesap) ve hesapsız akış — hitap kayıtlıysa siz.
  hesapFormBaslik: ['Fuber hesabınla devam et.', 'Fuber hesabınızla devam edin.'],
  hesapFormKapali: ['Bu bilgisayarın Fuber erişimi kapandı. Hesabınla yeniden giriş yap. Hafızan ve ayarların yerinde.', 'Bu bilgisayarın Fuber erişimi kapandı. Hesabınızla yeniden giriş yapın. Hafızanız ve ayarlarınız yerinde.'],
  hesapFormYalniz: ['Hesabınla giriş yap. Hafızan ve ayarların yerinde.', 'Hesabınızla giriş yapın. Hafızanız ve ayarlarınız yerinde.'],
  hesapsizNot: ['Şimdilik hesapsız ilerliyorsun. Ayarlar → Hesap’tan açarsın.', 'Şimdilik hesapsız ilerliyorsunuz. Ayarlar → Hesap’tan açarsınız.'],

  // ── Adım 3 · Seni tanıyayım (yalnız önizleme ve dipnot; sol sütun hitap seçilmeden önce "sen") ──
  tanismaDip: ['Kokpitin seni böyle karşılar · örnek gün', 'Kokpitiniz sizi böyle karşılar · örnek gün'],
  tanismaOdak: ['Bugün 3 toplantın ve yanıt bekleyen 2 önemli e-postan var.', 'Bugün 3 toplantınız ve yanıt bekleyen 2 önemli e-postanız var.'],
  /** Adanın örnek sözü; `h`: hitapMetni (ad + hitap; boşsa ad yok). */
  adaSozu: (h: string): Cift => (h ? [`${h}, toplantın 10 dakika sonra.`, `${h}, toplantınız 10 dakika sonra.`] : ['Toplantın 10 dakika sonra.', 'Toplantınız 10 dakika sonra.']),
  adaAlt: ['Ekranın üstünden böyle haber veririm', 'Ekranınızın üstünden böyle haber veririm'],

  // ── Adım 4 · Nasıl kullanacaksın ──
  kipBaslik: ['Nasıl kullanacaksın?', 'Nasıl kullanacaksınız?'],
  kipGiris: ['İstediğin an değiştirirsin. Sohbetlerin olduğu gibi kalır.', 'İstediğiniz an değiştirirsiniz. Sohbetleriniz olduğu gibi kalır.'],
  claudeNotVar: (n: number): Cift => [`Bu bilgisayarda ${n} not var. Projelerini baştan bilirim.`, `Bu bilgisayarda ${n} not var. Projelerinizi baştan bilirim.`],
  kipIsSoru: ['Bu teklifi şimdi göndereyim mi?', 'Bu teklifi şimdi göndereyim mi?'],
  kipIsYanit: ['Bence bekle. Fiyatı biraz yukarıdan aç, pazarlık payın kalsın. Hazır olunca onayınla gönderirim.', 'Bence bekleyin. Fiyatı biraz yukarıdan açın, pazarlık payınız kalsın. Hazır olunca onayınızla gönderirim.'],
  kipGelSoru: ['Bu hatayı düzeltir misin?', 'Bu hatayı düzeltir misiniz?'],
  kipGelYanit: ['Önce testi çalıştırıp nedeni göreyim. Değişiklikten önce ne yapacağımı söylerim. Silme gerekirse sana sorarım.', 'Önce testi çalıştırıp nedeni göreyim. Değişiklikten önce ne yapacağımı söylerim. Silme gerekirse size sorarım.'],

  // ── Adım 5 · Günün ──
  gunBaslik: ['Genelde hangi saatlerde çalışırsın?', 'Genelde hangi saatlerde çalışırsınız?'],
  gunGirisSessiz: ['Mesai dışında sessiz kalırım. Hatırlatıcıların yine zamanında gelir.', 'Mesai dışında sessiz kalırım. Hatırlatıcılarınız yine zamanında gelir.'],
  gunGirisAyar: ['Planlarımı bu saatlere göre yaparım. Sessiz saatlerin Ayarlar’daki gibi kalır.', 'Planlarımı bu saatlere göre yaparım. Sessiz saatleriniz Ayarlar’daki gibi kalır.'],
  calismaSaatleri: ['Çalışma saatlerin', 'Çalışma saatleriniz'],
  sabahAcik: ['Her sabah günün özetiyle sana yazarım.', 'Her sabah günün özetiyle size yazarım.'],
  sabahKapali: ['Kapalı. Açarsan her sabah günün özetiyle yazarım.', 'Kapalı. Açarsanız her sabah günün özetiyle yazarım.'],
  baslangicAlt: ['Fuber açık olsun, sabah özeti zamanında gelsin.', 'Fuber açık olsun, sabah özeti zamanında gelsin.'],
  akisMesai: ['Mesai başlar, planın hazır', 'Mesai başlar, planınız hazır'],
  gunDipAyar: ['Sessiz saatlerin Ayarlar’daki gibi kalır.', 'Sessiz saatleriniz Ayarlar’daki gibi kalır.'],

  // ── Adım 6 · Nerede çalışayım ──
  neredeGiris: ['Yapay zekânın nerede çalışacağını seç.', 'Yapay zekânın nerede çalışacağını seçin.'],
  neredeFuber: [NEREDE_FUBER_CUMLESI, NEREDE_FUBER_CUMLESI_SIZ],
  neredeSoru: ['Yarınki toplantıyı kısaca özetler misin?', 'Yarınki toplantıyı kısaca özetler misiniz?'],
  neredeYanit: ['Üç başlık var: bütçe, takvim ve yeni ekip. Bütçe için senden onay bekleniyor.', 'Üç başlık var: bütçe, takvim ve yeni ekip. Bütçe için sizden onay bekleniyor.'],
  bilgisayaraBakiyorum: ['Bilgisayarına bakıyorum…', 'Bilgisayarınıza bakıyorum…'],
  // P14 (0.14 T32 düzeltme turu 1): sonuç sözü vermez, yalnız neyin kapalı olduğunu söyler. T34b: tek kaynak shared/gizlilik-metni.ts (Ayarlar da okur).
  inisGizli: GM.inisGizli,
  inisYerel: GM.inisYerel,
  /** `ek`: " Gizli modu açmıyorum." / " Şimdilik Fuber’le sürdürürüm." / "". */
  bakamadim: (ek: string): Cift => [`Bu bilgisayara bakamadım. İstediğin an Ayarlar → Gizlilik’ten kurarsın.${ek}`, `Bu bilgisayara bakamadım. İstediğiniz an Ayarlar → Gizlilik’ten kurarsınız.${ek}`],

  // ── Adım 7 · Nasıl görüneyim ──
  gorunumGiris: ['Seçimin kurulum bitince uygulanır.', 'Seçiminiz kurulum bitince uygulanır.'],
  gorunumSistem: ['Bilgisayarının temasını izler.', 'Bilgisayarınızın temasını izler.'],
  gorunumCam: ['Masaüstün pencerenin arkasından görünür.', 'Masaüstünüz pencerenin arkasından görünür.'],

  // ── Adım 8 · Sesimi dinle ──
  sesGiris: (ad: string, nasil: string): Cift => [`${ad} olarak yanıtları, hatırlatıcıları ve ekranın üstündeki notları ${nasil}.`, `${ad} olarak yanıtları, hatırlatıcıları ve ekranınızın üstündeki notları ${nasil}.`],
  sesliKonusma: ['Sesle sorduğunda yanıtı sesli okurum.', 'Sesle sorduğunuzda yanıtı sesli okurum.'],
  heyFuber: ['“Hey Fuber” sözünü bu bilgisayarda algılarım. Sesin ancak bu sözden sonra gönderilir.', '“Hey Fuber” sözünü bu bilgisayarda algılarım. Sesiniz ancak bu sözden sonra gönderilir.'],
  sesDipHesap: ['Bilgisayarlarında aynı ses.', 'Bilgisayarlarınızda aynı ses.'],
  dinlemeSozu: (ad: string): Cift => [`Merhaba, ben ${ad}. Sesimi hep böyle duyacaksın.`, `Merhaba, ben ${ad}. Sesimi hep böyle duyacaksınız.`],
  sesHesapBekliyor: ['Hesabın onaylanınca sesimi duyacaksın.', 'Hesabınız onaylanınca sesimi duyacaksınız.'],
  yedekSesInmedi: [YEDEK_SES_INMEDI, 'İndirilemedi; internet gelince yeniden deneyebilirsiniz. Şimdilik yazıyla konuşuruz.'],
  sesCalinamadi: ['Ses şu an çalınamadı; birazdan yeniden dene.', 'Ses şu an çalınamadı; birazdan yeniden deneyin.'],

  // ── Adım 9 · Nereden haber alayım ──
  baglantiGiris: ['İsteğe bağlı. Dilersen atlayabilirsin.', 'İsteğe bağlı. Dilerseniz atlayabilirsiniz.'],
  epostaKart: ['Önemli e-postaları söylerim. Şifren yalnız e-posta sunucuna gider.', 'Önemli e-postaları söylerim. Şifreniz yalnız e-posta sunucunuza gider.'],
  whatsappKart: ['Mesajların bu bilgisayarda saklanır. Gönderim hep onay ister.', 'Mesajlarınız bu bilgisayarda saklanır. Gönderim hep onay ister.'],
  baglantiDip: ['Önemli olanı ekranın üstünden söylerim. Gerisi sessiz kalır.', 'Önemli olanı ekranınızın üstünden söylerim. Gerisi sessiz kalır.'],
  haberHatirlatici: ['Saat 14:00’te. Notların hazır.', 'Saat 14:00’te. Notlarınız hazır.'],
  haberWhatsapp: ['Dosyayı attım, akşam bakabilir misin?', 'Dosyayı attım, akşam bakabilir misiniz?'],

  // ── Adım 10 · İzinler ──
  izinlerBaslik: ['Bilgisayarında neleri kullanayım?', 'Bilgisayarınızda neleri kullanayım?'],
  izinBilgisayar: (acil: string): Cift => [`Kapalı gelir. Açarsan görev için ekranı görür, fare ve klavyeyi kullanırım. Her seferinde sorarım. ${acil} her şeyi durdurur.`, `Kapalı gelir. Açarsanız görev için ekranı görür, fare ve klavyeyi kullanırım. Her seferinde sorarım. ${acil} her şeyi durdurur.`],
  izinBildirim: ['Önemli bir şey olunca ekranın üstünden haber veririm. Mesai dışında sessizim.', 'Önemli bir şey olunca ekranınızın üstünden haber veririm. Mesai dışında sessizim.'],
  izinBaslik: ['Bugün senin için', 'Bugün sizin için'],
  izinDip: ['Örnek gün · gönderim, silme ve ödeme her zaman onayını bekler.', 'Örnek gün · gönderim, silme ve ödeme her zaman onayınızı bekler.'],
  izinBilgisayarAcik: ['Satış tablosunu Excel’de güncelledim', 'Satış tablosunu Excel’de güncelledim'],
  izinBilgisayarKapali: ['İzin verirsen Excel’deki tablolarını güncellerim', 'İzin verirseniz Excel’deki tablolarınızı güncellerim'],
  izinTarayiciKapali: ['İzin verirsen uçuşları web’de karşılaştırırım', 'İzin verirseniz uçuşları web’de karşılaştırırım'],
  izinDosyaAcik: ['Sözleşmeyi okudum: 3 maddeye bakmalısın', 'Sözleşmeyi okudum: 3 maddeye bakmalısınız'],
  izinDosyaKapali: ['İzin verirsen belgelerini okur, önemlisini söylerim', 'İzin verirseniz belgelerinizi okur, önemlisini söylerim'],
  izinBildirimAcik: ['Toplantına 10 dakika kaldı', 'Toplantınıza 10 dakika kaldı'],
  izinBildirimKapali: ['İzin verirsen önemli anlarda ekranın üstünden söylerim', 'İzin verirseniz önemli anlarda ekranınızın üstünden söylerim'],

  // ── Adım 11 · Hazırsın ──
  hazirsin: (siz: boolean, h: string): string => (h ? `${siz ? 'Hazırsınız' : 'Hazırsın'}, ${h}.` : `${siz ? 'Hazırsınız' : 'Hazırsın'}.`),
  hazirsinGirisIlk: ['Önemli bir şey olunca ekranının üstünde küçük bir kartla haber veririm.', 'Önemli bir şey olunca ekranınızın üstünde küçük bir kartla haber veririm.'],
  hazirsinGirisYeniden: ['“Bitti” yalnız ayarlarını kaydeder. Hafızan ve sohbetlerin olduğu gibi kalır.', '“Bitti” yalnız ayarlarınızı kaydeder. Hafızanız ve sohbetleriniz olduğu gibi kalır.'],
  baslayabilirsin: ['Şöyle başlayabilirsin', 'Şöyle başlayabilirsiniz'],
  hazirsinDip: ['Hepsini Ayarlar’dan istediğin an değiştirirsin.', 'Hepsini Ayarlar’dan istediğiniz an değiştirirsiniz.'],
  sozToplanti: ['“Yarın 9’da toplantıyı hatırlat.”', '“Yarın 9’da toplantıyı hatırlatın.”'],
  sozSozlesme: ['“Masaüstündeki sözleşmeyi özetle.”', '“Masaüstündeki sözleşmeyi özetleyin.”'],
  sozPlanYarin: ['“Yarın için kısa bir plan yap.”', '“Yarın için kısa bir plan yapın.”'],
  sozUcus: ['“Yarınki uçuşları karşılaştır.”', '“Yarınki uçuşları karşılaştırın.”'],
  sozPlanHafta: ['“Bu haftanın planını çıkar.”', '“Bu haftanın planını çıkarın.”'],
  sozEposta: ['“Bugün önemli bir e-posta var mı?”', '“Bugün önemli bir e-posta var mı?”'],
  sozYerel1: ['“Bu paragrafı kısalt.”', '“Bu paragrafı kısaltın.”'],
  sozYerel2: ['“Toplantı için üç madde hazırla.”', '“Toplantı için üç madde hazırlayın.”'],
  sozYerel3: ['“Bana kısa bir gün planı öner.”', '“Bana kısa bir gün planı önerin.”'],
  surer: (a: string, b: string): Cift => [`Önceden başlayan ${a} indirmesi sürüyor; ${b} için Ayarlar → Gizlilik’ten değiştirebilirsin.`, `Önceden başlayan ${a} indirmesi sürüyor; ${b} için Ayarlar → Gizlilik’ten değiştirebilirsiniz.`],
} as const satisfies Record<string, Cift | ((...a: never[]) => Cift | string)>;

/** Hazırsın'ın örnek sözleri: her zaman toplantı; ikincisi Dosyalar açıksa sözleşme, değilse plan; üçüncüsü e-posta bağlıysa e-posta, değilse Tarayıcı açıksa uçuş,
 *  değilse haftalık plan. Yalnız bu bilgisayarda çalışan seçeneklerde (araç yok) örnekler bu bilgisayarda yapılabilenler. */
export function ilkSozCiftleri(g: { eposta: boolean; dosya: boolean; tarayici: boolean; yerel?: boolean }): Cift[] {
  if (g.yerel) return [KM.sozYerel1, KM.sozYerel2, KM.sozYerel3];
  return [KM.sozToplanti, g.dosya ? KM.sozSozlesme : KM.sozPlanYarin, g.eposta ? KM.sozEposta : g.tarayici ? KM.sozUcus : KM.sozPlanHafta];
}

// ── Denetim yardımcıları (birim testi ve canlı önizleme betiği ortak kullanır) ──
/** Sen eki belirteçleri (siz metinde olmamalı; 0.13.1 düzeltme turu 1): zamir, 2. tekil kişi eki, 2. tekil iyelik (-ın/-in/-un/-ün, kesme işaretsiz). */
const SEN_ZAMIR = /(?:^|[\s(“"])(sen|seni|sana|senin|sende|senden)(?=[\s.,;:!?”"’)]|$)/i;
const SEN_FIIL = /([a-zçğıöşü]+(?:sın|sin|sun|sün))(?=[\s.,;:!?”"’)]|$)/gi;
/** 3. kişi emri (kalsın, olsun, gelsin): sen eki değil. */
const SEN_FIIL_ISTISNA = /^(kalsın|olsun|gelsin|gitsin|bitsin|yetsin)$/i;
const SEN_IYELIK = /(?:^|[\s(“"])([a-zçğıöşü]+(?:ın|in|un|ün))(?=[\s.,;:!?”"’)]|$)/gi;
/** "siz" emir kipi ve ın/in ile biten, sen eki OLMAYAN sözcükler. */
const SEN_ISTISNA = /^(hatırlatın|özetleyin|yapın|karşılaştırın|çıkarın|kısaltın|hazırlayın|önerin|bekleyin|açın|seçin|deneyin|bugün|gün|günün|bütün|için|pencerenin|yarın|haftanın|günaydın|aydın)$/i;
/**
 * Sen eki var mı (siz metninde olmamalı). İlk kusurlu sözcüğü döndürür, yoksa null.
 * T34b (T32 Kaygı 2) — çift-bilinçli: "-ın/-in" ile biten siz emri ("geçin", "konuşun") sen iyeliğinden ("toplantın") biçimce ayrılamaz.
 *  · `sen` METİN ise (birim testi, her KM çifti): iyelik adayı (-ın/-in) ancak AYNI sözcük sen metninde de birebir geçiyorsa kusurdur
 *    (çeviri atlanmış: "toplantın" iki yanda aynı). "geçin" sen'de "geç" olduğu için geçer. Bakım listesi gerekmez.
 *  · `sen` KÜME ise (canlı önizleme betiği; çift yok): kümedeki iyelik biçimli sözcükler meşru siz'dir (kmSizSozcukleri(): KM siz sütununda
 *    olup sen sütununda olmayanlar).
 *  · Zamir (sen, sana, senin…) ve fiil eki (-sın/-sin…) her durumda kusurdur (çift istisnası yalnız iyelikte). Elle yazılmış istisna listesi (3. kişi emri, "bugün", "için"…) her yolda geçerli.
 */
export function senEkiVar(metin: string, sen?: string | ReadonlySet<string>): string | null {
  metin = metin.replace(/bu bilgisayarın/gi, 'bu bilgisayar'); // "bu bilgisayarın sesi": 3. kişi tamlaması, sen eki değil
  const m = SEN_ZAMIR.exec(metin);
  if (m) return m[0].trim();
  const senSozcukleri = typeof sen === 'string' ? new Set(sozcukler(sen.replace(/bu bilgisayarın/gi, 'bu bilgisayar'))) : null;
  const mesru = (w: string): boolean => {
    const k = w.toLocaleLowerCase('tr');
    if (senSozcukleri) return !senSozcukleri.has(k);
    return typeof sen === 'object' && sen !== null ? sen.has(k) : false;
  };
  // Düzeltme turu 1 (I2): çift istisnası yalnız iyelikte — "-sın/-sin/-sun/-sün" siz metninde hiçbir biçimde meşru değil (3. kişi emri istisnada).
  for (const x of metin.matchAll(SEN_FIIL)) if (!SEN_FIIL_ISTISNA.test(x[1])) return x[1];
  for (const x of metin.matchAll(SEN_IYELIK)) if (!SEN_ISTISNA.test(x[1]) && !SEN_FIIL_ISTISNA.test(x[1]) && !/[ıiuü]z(?:ın|in|un|ün)$/i.test(x[1]) && !mesru(x[1])) return x[1];
  return null;
}

/** Metnin sözcükleri (Türkçe küçük harf; kesme işaretinden sonrası ayrı sözcük sayılır). */
function sozcukler(s: string): string[] {
  return s.toLocaleLowerCase('tr').match(/[a-zçğıöşüâîû]+/g) ?? [];
}

/** KM'nin bütün çiftleri (işlevler örnek değerle çağrılır; `hazirsin` iki hitapla). kmSizSozcukleri ve birim testi kullanır. */
export function kmCiftleri(): Cift[] {
  const l: Cift[] = [];
  for (const [ad, deger] of Object.entries(KM)) {
    if (ad === 'hazirsin') { l.push([KM.hazirsin(false, ''), KM.hazirsin(true, '')]); continue; }
    if (typeof deger === 'function') { const f = deger as (...a: unknown[]) => Cift; l.push(f(...Array.from({ length: f.length }, () => 'Ada'))); continue; }
    l.push(deger as Cift);
  }
  return l;
}

/** Canlı denetimin meşru siz sözcükleri: KM siz sütununda geçip sen sütununda hiç geçmeyenler ("geçin", "bekleyin", "hesabınızla"…).
 *  Tembel ve bellekli (M8): yalnız denetim çağırınca hesaplanır, uygulama açılışında çalışmaz. */
let sizSozcukleri: ReadonlySet<string> | null = null;
export function kmSizSozcukleri(): ReadonlySet<string> {
  if (sizSozcukleri) return sizSozcukleri;
  const c = kmCiftleri();
  const sende = new Set(c.flatMap((x) => sozcukler(x[0])));
  return (sizSozcukleri = new Set(c.flatMap((x) => sozcukler(x[1])).filter((w) => !sende.has(w))));
}

/** Siz eki belirteçleri (hitapsız "sen" metninde olmamalı): 2. çoğul kişi eki ve iyelik (-ınız/-iniz/-unuz/-ünüz, -sınız…) ya da "Hazırsınız". */
const SIZ_EKI = /(?:ınız|iniz|unuz|ünüz|sınız|siniz|sunuz|sünüz)(?=[\s.,;:!?”"’)]|$)|(?:^|[\s(“"])(?:sizi|size|sizin|sizden)(?=[\s.,;:!?”"’)]|$)/i;
export function sizEkiVar(metin: string): string | null {
  const m = SIZ_EKI.exec(metin);
  return m ? m[0] : null;
}
