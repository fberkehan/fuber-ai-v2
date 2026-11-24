import { describe, expect, it } from 'vitest';
import { harmonizeSuffix, numberToTurkish, toSpokenTurkish } from './tr-speech';

type Row = [input: string, expected: string];

function table(rows: Row[]): void {
  it.each(rows)('%s → %s', (input, expected) => {
    expect(toSpokenTurkish(input)).toBe(expected);
  });
}

describe('1. tam sayılar', () => {
  table([
    ['0', 'sıfır'],
    ['1000', 'bin'],
    ['1001', 'bin bir'],
    ['21', 'yirmi bir'],
    ['100', 'yüz'],
    ['200', 'iki yüz'],
    ['1.250', 'bin iki yüz elli'],
    ['1.250.000', 'bir milyon iki yüz elli bin'],
    ['2026', 'iki bin yirmi altı'],
    ['1000000000', 'bir milyar'],
    ['1000000', 'bir milyon'],
    ['101', 'yüz bir'],
    ['007', 'sıfır sıfır yedi'],
    ['1234567890123456', 'bir iki üç dört beş altı yedi sekiz dokuz sıfır bir iki üç dört beş altı'],
    ['Borcum -5 lira.', 'Borcum eksi beş lira.'],
    ['-5', 'eksi beş'],
    ['Sıcaklık -12 oldu.', 'Sıcaklık eksi on iki oldu.'],
    ['999.999', 'dokuz yüz doksan dokuz bin dokuz yüz doksan dokuz'],
  ]);
});

describe('numberToTurkish', () => {
  it.each([
    [0, 'sıfır'],
    [-0, 'sıfır'],
    [7, 'yedi'],
    [-5, 'eksi beş'],
    [1000, 'bin'],
    [1_000_000, 'bir milyon'],
    [2_000_000_000, 'iki milyar'],
    [12_345, 'on iki bin üç yüz kırk beş'],
    [3.9, 'üç'],
    [999_999_999_999_999, 'dokuz yüz doksan dokuz trilyon dokuz yüz doksan dokuz milyar dokuz yüz doksan dokuz milyon dokuz yüz doksan dokuz bin dokuz yüz doksan dokuz'],
    [Number.NaN, ''],
    [Number.POSITIVE_INFINITY, ''],
  ])('%s → %s', (value, expected) => {
    expect(numberToTurkish(value)).toBe(expected);
  });

  it('güvenli aralık dışı ve 16+ hane basamak basamak okunur', () => {
    expect(numberToTurkish(1e16)).toBe('bir sıfır sıfır sıfır sıfır sıfır sıfır sıfır sıfır sıfır sıfır sıfır sıfır sıfır sıfır sıfır sıfır');
    expect(numberToTurkish(1e21).split(' ')).toHaveLength(22);
  });
});

describe('2. ondalık ve binlik ayrımı', () => {
  table([
    ['3,5', 'üç virgül beş'],
    ['0,25', 'sıfır virgül yirmi beş'],
    ['3,05', 'üç virgül sıfır beş'],
    ['1.250,75', 'bin iki yüz elli virgül yetmiş beş'],
    ['3.5', 'üç nokta beş'],
    ['2.5', 'iki nokta beş'],
    ['2.25', 'iki nokta yirmi beş'],
    ['1.250', 'bin iki yüz elli'],
    ['0.250', 'sıfır nokta iki beş sıfır'],
    ['1,000,000', 'bir milyon'],
    ['2,500,000', 'iki milyon beş yüz bin'],
    ['3,14159', 'üç virgül bir dört bir beş dokuz'],
    ['Oran 4,5 olmuş.', 'Oran dört virgül beş olmuş.'],
  ]);
});

describe('3. saat', () => {
  table([
    ['20:00', 'yirmi'],
    ['20:30', 'yirmi otuz'],
    ['09:05', 'dokuz sıfır beş'],
    ["12:34'te", 'on iki otuz dörtte'],
    ["20:00'de", 'yirmide'],
    ["08:00'e", 'sekize'],
    ['12:34:56', 'on iki otuz dört elli altı'],
    ["20.00'de", 'yirmide'],
    ['saat 20.00', 'saat yirmi'],
    ['saat 9.15 gibi', 'saat dokuz on beş gibi'],
    ['00:00', 'sıfır'],
    ['25:99', 'yirmi beş doksan dokuz'],
    ['23:59', 'yirmi üç elli dokuz'],
    ['Toplantı 14:45 başlıyor.', 'Toplantı on dört kırk beş başlıyor.'],
    ['12:00:00', 'on iki'],
  ]);
});

describe('4. tarih', () => {
  table([
    ['16 Kasım 2026', 'on altı Kasım iki bin yirmi altı'],
    ['16.11.2026', 'on altı Kasım iki bin yirmi altı'],
    ['16/11/2026', 'on altı Kasım iki bin yirmi altı'],
    ['2026-11-16', 'on altı Kasım iki bin yirmi altı'],
    ['16-11-2026', 'on altı Kasım iki bin yirmi altı'],
    ["28'inde", 'yirmi sekizinde'],
    ["1 Ocak'ta", "bir Ocak'ta"],
    ['1.1.2027', 'bir Ocak iki bin yirmi yedi'],
    ["16.11.2026'da", 'on altı Kasım iki bin yirmi altıda'],
    ['31.12.2025 tarihinde', 'otuz bir Aralık iki bin yirmi beş tarihinde'],
    ['13.13.2026', 'on üç nokta on üç nokta iki bin yirmi altı'],
  ]);
});

describe('5. sıra sayıları', () => {
  table([
    ['3. kat', 'üçüncü kat'],
    ['1. madde', 'birinci madde'],
    ['21. yüzyıl', 'yirmi birinci yüzyıl'],
    ['Bu cümle 3.', 'Bu cümle üç.'],
    ['4. Madde', 'dört. Madde'],
    ["3'üncü", 'üçüncü'],
    ["2'nci", 'ikinci'],
    ["1'inci", 'birinci'],
    ["4'üncü sıra", 'dördüncü sıra'],
    ["20'nci gün", 'yirminci gün'],
    ["30'uncu", 'otuzuncu'],
    ['100. yıl', 'yüzüncü yıl'],
    ['5. sınıfa gidiyor', 'beşinci sınıfa gidiyor'],
  ]);
});

describe('6. yüzde', () => {
  table([
    ['%20', 'yüzde yirmi'],
    ['%3,5', 'yüzde üç virgül beş'],
    ['20%', 'yüzde yirmi'],
    ['% 20', 'yüzde yirmi'],
    ["%47'si", 'yüzde kırk yedisi'],
    ["%20'si", 'yüzde yirmisi'],
    ['%100', 'yüzde yüz'],
    ['Pil %5 kaldı.', 'Pil yüzde beş kaldı.'],
    ['%0,5', 'yüzde sıfır virgül beş'],
  ]);
});

describe('7. para', () => {
  table([
    ['15.000 TL', 'on beş bin lira'],
    ['₺250', 'iki yüz elli lira'],
    ['250 ₺', 'iki yüz elli lira'],
    ['999 $', 'dokuz yüz doksan dokuz dolar'],
    ['$999', 'dokuz yüz doksan dokuz dolar'],
    ['50 €', 'elli avro'],
    ['€50', 'elli avro'],
    ['£10', 'on sterlin'],
    ['1.250,50 TL', 'bin iki yüz elli lira elli kuruş'],
    ['9,99 $', 'dokuz dolar doksan dokuz sent'],
    ['100 USD', 'yüz dolar'],
    ['20 EUR', 'yirmi avro'],
    ['5 GBP', 'beş sterlin'],
    ['1500 TRY', 'bin beş yüz lira'],
    ["15.000 TL'ye", 'on beş bin liraya'],
    ["999 $'lık", 'dokuz yüz doksan dokuz dolarlık'],
    ['15 milyon TL', 'on beş milyon lira'],
    ['5,00 TL', 'beş lira'],
    ['TL kuru yükseldi.', 'te le kuru yükseldi.'],
  ]);
});

describe('8. birimler', () => {
  table([
    ['16 GB', 'on altı gigabayt'],
    ['4,5 GB', 'dört virgül beş gigabayt'],
    ['120 km', 'yüz yirmi kilometre'],
    ['-5 °C', 'eksi beş derece'],
    ['600 ms', 'altı yüz milisaniye'],
    ['30 sn', 'otuz saniye'],
    ['16GB', 'on altı gigabayt'],
    ["5 km'lik", 'beş kilometrelik'],
    ["10 dk'da", 'on dakikada'],
    ['256 MB', 'iki yüz elli altı megabayt'],
    ['2 TB', 'iki terabayt'],
    ['75 kg', 'yetmiş beş kilogram'],
    ['2 L süt', 'iki litre süt'],
    ['100 km/sa', 'yüz kilometre bölü saat'],
    ['50 m²', 'elli metrekare'],
    ['60 fps', 'altmış kare bölü saniye'],
    ['2,4 GHz', 'iki virgül dört gigahertz'],
    ['5 V', 'beş volt'],
    ['1080 px', 'bin seksen piksel'],
    ['25°', 'yirmi beş derece'],
    // Sayı yokken tek/iki harfli birimlere dokunulmaz.
    ['m', 'm'],
    ['Bu m, g ve sa ile ml işareti.', 'Bu m, g ve sa ile ml işareti.'],
    // Tek büyük harf kuralı (14) ayrıdır: sayısız "V" harf adıyla okunur, birim olarak değil.
    ['V harfi', 've harfi'],
    ['Haber sa gibi', 'Haber sa gibi'],
  ]);
});

describe('9. telefon', () => {
  table([
    ['+90 500 000 00 05', 'artı doksan, beş yüz, sıfır sıfır sıfır, sıfır sıfır, sıfır beş'],
    ['0500 000 00 05', 'sıfır beş yüz, sıfır sıfır sıfır, sıfır sıfır, sıfır beş'],
    ['05000000005', 'sıfır beş yüz, sıfır sıfır sıfır, sıfır sıfır, sıfır beş'],
    ['0212 000 12 34', 'sıfır iki yüz on iki, sıfır sıfır sıfır, on iki, otuz dört'],
    ['(0212) 000 12 34', 'sıfır iki yüz on iki, sıfır sıfır sıfır, on iki, otuz dört'],
    ['0500-000-00-05', 'sıfır beş yüz, sıfır sıfır sıfır, sıfır sıfır, sıfır beş'],
    ['+905000000005', 'artı doksan, beş yüz, sıfır sıfır sıfır, sıfır sıfır, sıfır beş'],
    ['0500 000 00 05', 'sıfır beş yüz, sıfır sıfır sıfır, sıfır sıfır, sıfır beş'],
    ['Ara: 0500 111 22 33.', 'Ara: sıfır beş yüz, yüz on bir, yirmi iki, otuz üç.'],
  ]);
});

describe('10. sürüm ve IP', () => {
  table([
    ['2.0.0', 'iki nokta sıfır nokta sıfır'],
    ['v1.12.1', 'bir nokta on iki nokta bir'],
    ['0.18.2', 'sıfır nokta on sekiz nokta iki'],
    ['127.0.0.1', 'yüz yirmi yedi nokta sıfır nokta sıfır nokta bir'],
    ['2.0.0-demo.1', 'iki nokta sıfır nokta sıfır demo bir'],
    ['V2.0', 'iki nokta sıfır'],
    ['192.168.1.20', 'yüz doksan iki nokta yüz altmış sekiz nokta bir nokta yirmi'],
    ['1.250.000.000', 'bir milyar iki yüz elli milyon'],
    ['Sürüm 1.2.3 yayında.', 'Sürüm bir nokta iki nokta üç yayında.'],
  ]);
});

describe('11. kesme işaretli ekler', () => {
  table([
    ["20'de", 'yirmide'],
    ["3'ü", 'üçü'],
    ["5'i", 'beşi'],
    ["6'sı", 'altısı'],
    ["2'si", 'ikisi'],
    ["10'a", 'ona'],
    ["7'ye", 'yediye'],
    ["100'den", 'yüzden'],
    ["3'te", 'üçte'],
    ["4'ün", 'dördün'],
    ["4'e", 'dörde'],
    ["4'ü", 'dördü'],
    ["4'te", 'dörtte'],
    ["4'ten", 'dörtten'],
    ["9'un", 'dokuzun'],
    ["2026'da", 'iki bin yirmi altıda'],
    ["1'i", 'biri'],
    ["40'lı", 'kırklı'],
    ["90'lar", 'doksanlar'],
    ["12:34'de", 'on iki otuz dörtte'],
    ["12:34'tir", 'on iki otuz dörttür'],
    ["20:00'da", 'yirmide'],
    ["6'de", 'altıda'],
    ['5’i', 'beşi'],
    ['20’de', 'yirmide'],
    ["90'ların", 'doksanların'],
    ["1990'lardan", 'bin dokuz yüz doksanlardan'],
  ]);

  it.each([
    ['dört', 'de', 'dörtte'],
    ['dört', 'ün', 'dördün'],
    ['dört', 'e', 'dörde'],
    ['dört', 'ten', 'dörtten'],
    ['yirmi', 'de', 'yirmide'],
    ['yirmi', 'dan', 'yirmiden'],
    ['altı', 'de', 'altıda'],
    ['altı', 'e', 'altıya'],
    ['beş', 'i', 'beşi'],
    ['beş', 'ye', 'beşe'],
    ['iki', 'i', 'ikisi'],
    ['iki', 'yi', 'ikiyi'],
    ['elli', 'i', 'ellisi'],
    ['altı', 'i', 'altısı'],
    ['kırk', 'i', 'kırkı'],
    ['yüz', 'i', 'yüzü'],
    ['iki', 'si', 'ikisi'],
    ['iki', 'le', 'ikiyle'],
    ['üç', 'la', 'üçle'],
    ['on', 'dir', 'ondur'],
    ['yüz', 'lik', 'yüzlük'],
    ['kırk', 'lı', 'kırklı'],
    ['sekiz', 'inde', 'sekizinde'],
    ['iki', 'sinde', 'ikisinde'],
    ['ka de ve', 'nin', 'ka de venin'],
    ['ka de ve', 'yi', 'ka de veyi'],
    ['se ge ka', 'ya', 'se ge kaya'],
    ['üç', 'üncü', 'üçüncü'],
    ['on dört', 'üncü', 'on dördüncü'],
    ['dört', 'tir', 'dörttür'],
    ['altı', 'dır', 'altıdır'],
    ['dokuz', 'luk', 'dokuzluk'],
    ['bir', 'inci', 'birinci'],
    ['bir', "'de", 'birde'],
    ['yedi', 'xyz', 'yedixyz'],
    ['yedi', '', 'yedi'],
    ['', 'de', 'de'],
  ])('harmonizeSuffix(%j, %j) → %j', (spoken, suffix, expected) => {
    expect(harmonizeSuffix(spoken, suffix)).toBe(expected);
  });
});

describe('12. aralık', () => {
  table([
    ['10-15', 'on ile on beş'],
    ['10–15 dakika', 'on ile on beş dakika'],
    ['09:00-17:00', 'dokuz ile on yedi'],
    ['%10-15', 'yüzde on ile on beş'],
    ['COVID-19', 'COVID on dokuz'],
    ['GPT-5', 'GPT beş'],
    ['2020-2024 arası', 'iki bin yirmi ile iki bin yirmi dört arası'],
    ['5-10 $', 'beş ile on dolar'],
    ['Wi-Fi 6', 'Wi-Fi altı'],
    ['20 – 30 kişi', 'yirmi ile otuz kişi'],
  ]);
});

describe('13. kısaltmalar', () => {
  table([
    ['elma, armut vb. aldım', 'elma, armut ve benzeri aldım'],
    ['elma, armut, kalem vb.', 'elma, armut, kalem ve benzeri.'],
    ['kalem vs.', 'kalem vesaire.'],
    ['vs. gibi', 'vesaire gibi'],
    ['örn. bu', 'örneğin bu'],
    ['bkz. ek', 'bakınız ek'],
    ['Dr. Ayşe geldi', 'doktor Ayşe geldi'],
    ['Prof. Yılmaz', 'profesör Yılmaz'],
    ['Doç. Kaya', 'doçent Kaya'],
    ['Av. Demir', 'avukat Demir'],
    ['No: 5', 'numara beş'],
    ['No. 12', 'numara on iki'],
    ['Atlas Ltd. Şti.', 'Atlas limited şirketi'],
    ['Atlas A.Ş.', 'Atlas anonim şirketi'],
    ['T.C. vatandaşı', 'te ce vatandaşı'],
    ['Sn. Yılmaz', 'sayın Yılmaz'],
    ['KDV', 'ka de ve'],
    ['ÖTV', 'ö te ve'],
    ['SGK', 'se ge ka'],
    ['TC', 'te ce'],
    ['ABD', 'a be de'],
    ['TL', 'te le'],
    ['MTV', 'me te ve'],
    ['KKTC', 'ka ka te ce'],
    ['TBMM', 'te be me me'],
    ['TCKN', 'te ce ka ne'],
    ['SMS', 'se me se'],
    ['PTT', 'pe te te'],
    ['GSM', 'ge se me'],
    ["KDV'yi", 'ka de veyi'],
    ["KDV'nin", 'ka de venin'],
    ["SGK'ya", 'se ge kaya'],
    // Listede olmayan büyük harfli sözcükler ve ürün adları aynen kalır; yanlarındaki rakam çevrilir.
    ['ElevenLabs', 'ElevenLabs'],
    ['Claude Code', 'Claude Code'],
    ['ChatGPT GitHub API GPU RTX', 'ChatGPT GitHub API GPU RTX'],
    ['iPhone Windows', 'iPhone Windows'],
    ['Fuber AI', 'Fuber AI'],
    ['Windows 11', 'Windows on bir'],
    ['iPhone 15', 'iPhone on beş'],
    ['RTX 4080', 'RTX dört bin seksen'],
    ['Fuber AI 2', 'Fuber AI iki'],
    ['4K', 'dört ka'],
    ['5G', 'beş ge'],
  ]);
});

describe('14. simgeler ve Daniel kalıpları', () => {
  table([
    ['Ali & Veli', 'Ali ve Veli'],
    ['2 + 3', 'iki artı üç'],
    ['2+3', 'iki artı üç'],
    ['2 = 2', 'iki eşittir iki'],
    ['3 x 4', 'üç çarpı dört'],
    ['3×4', 'üç çarpı dört'],
    ['1/2', 'bir bölü iki'],
    ['24/7', 'yirmi dört bölü yedi'],
    ['+5', 'artı beş'],
    ['@jarvis', 'et jarvis'],
    ['Bekle… sonra devam', 'Bekle, sonra devam'],
    ['Bekle...', 'Bekle.'],
    ['Bekle…', 'Bekle.'],
    ['Evet — hayır', 'Evet, hayır'],
    ['Evet – hayır', 'Evet, hayır'],
    ['bir; iki', 'bir, iki'],
    ['“merhaba” dedi', 'merhaba dedi'],
    ['«merhaba» dedi', 'merhaba dedi'],
    ['„merhaba“ dedi', 'merhaba dedi'],
    ['"merhaba" dedi', 'merhaba dedi'],
    ['Bu (örneğin bu) bir deneme.', 'Bu, örneğin bu, bir deneme.'],
    ['Bu bir deneme (not).', 'Bu bir deneme, not.'],
    ['example.com', 'example nokta com'],
    ['atlas.co', 'atlas nokta co'],
    ['Adres example.com.', 'Adres example nokta com.'],
    ['https://atlas.co', 'atlas nokta co'],
    ['a@b.com', 'a et b nokta com'],
    ['kaan.k@example.org', 'kaan nokta k et example nokta org'],
    ['B planı', 'be planı'],
    ['C vitamini', 'ce vitamini'],
    ['D sürücüsü', 'de sürücüsü'],
    ['X ekseni', 'iks ekseni'],
    ['Q harfi', 'kü harfi'],
    ['W harfi', 'çift ve harfi'],
    ['A planı hazır', 'a planı hazır'],
    ['Ş planı', 'şe planı'],
    ['İ harfi', 'i harfi'],
    ['O geldi.', 'O geldi.'],
    ['Plan B hazır', 'Plan B hazır'],
    ['Type C kablo', 'Type C kablo'],
    ['Sonra B planı', 'Sonra be planı'],
    ['Yeni Windows B sürümü', 'Yeni Windows B sürümü'],
    ["B'ye geç", 'beye geç'],
    ["I'm hazır", "I'm hazır"],
    ['#1 öncelik', 'numara bir öncelik'],
  ]);
});

describe('15. gerçek cümleler', () => {
  table([
    ["Bugün akşam 20:00'de çalacak.", 'Bugün akşam yirmide çalacak.'],
    [
      "Efendim, Kaan'a önemli iş konusunu hatırlatıcıyı bugün akşam 20:00'de kurdum.",
      "Efendim, Kaan'a önemli iş konusunu hatırlatıcıyı bugün akşam yirmide kurdum.",
    ],
    [
      "Bugün 16 Kasım 2026, saat 12:34'te sizinle hizmet etmekten mutluluk duyarım.",
      'Bugün on altı Kasım iki bin yirmi altı, saat on iki otuz dörtte sizinle hizmet etmekten mutluluk duyarım.',
    ],
    [
      "Şu anki tarih 16 Kasım 2026, saat 12:34'tir.",
      'Şu anki tarih on altı Kasım iki bin yirmi altı, saat on iki otuz dörttür.',
    ],
    [
      'Hatırlatıcı kuruldu: "Kaan\'a önemli iş konusunu hatırlat", bugün 20:00.',
      "Hatırlatıcı kuruldu: Kaan'a önemli iş konusunu hatırlat, bugün yirmi.",
    ],
    [
      'Bulut hesabında kredi yok; bu bilgisayardaki modelle çalışıyorum.',
      'Bulut hesabında kredi yok, bu bilgisayardaki modelle çalışıyorum.',
    ],
    [
      'Ekran kartınız RTX 4080 SUPER, 16 GB; şu an %47\'si dolu.',
      'Ekran kartınız RTX dört bin seksen SUPER, on altı gigabayt, şu an yüzde kırk yedisi dolu.',
    ],
    [
      "Lansman fiyatı 999 $, 31 Aralık'a kadar; sonrası 1.490 $.",
      "Lansman fiyatı dokuz yüz doksan dokuz dolar, otuz bir Aralık'a kadar, sonrası bin dört yüz doksan dolar.",
    ],
    [
      'Toplantı 09:30-10:15 arası, 3. katta.',
      'Toplantı dokuz otuz ile on on beş arası, üçüncü katta.',
    ],
    [
      "KDV beyannamesi ayın 28'inde, %20 üzerinden.",
      'ka de ve beyannamesi ayın yirmi sekizinde, yüzde yirmi üzerinden.',
    ],
    [
      "Beni +90 500 000 00 05'den arayın.",
      'Beni artı doksan, beş yüz, sıfır sıfır sıfır, sıfır sıfır, sıfır beşten arayın.',
    ],
    ['Sürüm 2.0.0-demo.1 kuruldu.', 'Sürüm iki nokta sıfır nokta sıfır demo bir kuruldu.'],
  ]);
});

describe('16. dokunulmayacaklar', () => {
  table([
    ['Merhaba, bugün hava çok güzel ve ben buradayım.', 'Merhaba, bugün hava çok güzel ve ben buradayım.'],
    ['Çığlık attı: ağır şüphe üşüdü ğ ı ö.', 'Çığlık attı: ağır şüphe üşüdü ğ ı ö.'],
    ['[laughs] Bu çok komik!', '[laughs] Bu çok komik!'],
    ['[güler] Bu çok komik!', '[güler] Bu çok komik!'],
    ['[laughs] Saat 20:00!', '[laughs] Saat yirmi!'],
    ['', ''],
    ['   ', ''],
    ['\n\t ', ''],
    ['O geldi.', 'O geldi.'],
    ["Jarvis'e söyle.", "Jarvis'e söyle."],
    ["Kaan'ı ara.", "Kaan'ı ara."],
    ['  çok   boşluk   var  ', 'çok boşluk var'],
    ['Nasılsın?', 'Nasılsın?'],
    ['Evet! Tamam.', 'Evet! Tamam.'],
    ['Bir [whispers] iki', 'Bir [whispers] iki'],
    ['ElevenLabs ile Claude Code çalışıyor.', 'ElevenLabs ile Claude Code çalışıyor.'],
  ]);

  it('hiçbir çıktıda ASCII rakam kalmaz (belgelenmiş istisna yok)', () => {
    const samples = [
      "Windows 11, iPhone 15, 4K, 5G, v1.2.3, 0.18.2, 20:00'de, 3. kat, %47'si, 1.250,75 TL, +90 500 000 00 05",
      'COVID-19 GPT-5 A4 B12 H2O 10-15 25:99 2026-11-16 16/11/2026',
      '1/2 24/7 3 x 4 2+3=5 -5 °C 600 ms 16GB',
    ];
    for (const sample of samples) expect(toSpokenTurkish(sample)).not.toMatch(/\d/);
  });
});

describe('çakışan kalıplar', () => {
  table([
    ['16.11.2026', 'on altı Kasım iki bin yirmi altı'],
    ['1.250.000', 'bir milyon iki yüz elli bin'],
    ['10.11.2026 ve 3.5', 'on Kasım iki bin yirmi altı ve üç nokta beş'],
    ['10.11.2026-12.11.2026', 'on Kasım iki bin yirmi altı ile on iki Kasım iki bin yirmi altı'],
    ["20.00'de", 'yirmide'],
    ['Cevap 3.', 'Cevap üç.'],
    ['Cevap 3. Sonra', 'Cevap üç. Sonra'],
    ['10-15', 'on ile on beş'],
    ['0500-000-00-05', 'sıfır beş yüz, sıfır sıfır sıfır, sıfır sıfır, sıfır beş'],
    ['10.000.000', 'on milyon'],
    ['0.0.0.0', 'sıfır nokta sıfır nokta sıfır nokta sıfır'],
    ['1.1.1', 'bir nokta bir nokta bir'],
  ]);
});

describe('güvenlik ve performans', () => {
  it('rastgele ve garip girdilerde fırlatmaz', () => {
    const weird = [
      '\u0000\u0001\u0002',
      '\ud800',
      '\udc00 5 \ud800',
      '😀 20:00 😀',
      "'''''",
      '%%%%%',
      '....',
      '99999999999999999999999999999999999999',
      '1.2.3.4.5.6.7.8.9.0',
      '((((((((((',
      '[[[[]]]]',
      '$$$$ ₺₺₺₺',
      '-'.repeat(50),
      "5'".repeat(30),
      '1,'.repeat(30),
    ];
    for (const w of weird) expect(() => toSpokenTurkish(w)).not.toThrow();

    let seed = 12345;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    for (let n = 0; n < 300; n++) {
      let s = '';
      const len = next() % 80;
      for (let i = 0; i < len; i++) s += String.fromCharCode(next() % 0x250);
      expect(() => toSpokenTurkish(s)).not.toThrow();
    }
    expect(() => harmonizeSuffix(undefined as unknown as string, null as unknown as string)).not.toThrow();
    expect(() => numberToTurkish(undefined as unknown as number)).not.toThrow();
  });

  it('aynı girdi her seferinde aynı çıktıyı verir', () => {
    const input = "Bugün 16 Kasım 2026, saat 12:34'te %47 ve 1.250,50 TL.";
    expect(toSpokenTurkish(input)).toBe(toSpokenTurkish(input));
  });

  it('300 karakterlik cümle hızlı dönüşür', () => {
    const sentence = "Saat 12:34'te 16 Kasım 2026 tarihinde 1.250,50 TL ve %47 ile 16 GB. ".repeat(5).slice(0, 300);
    toSpokenTurkish(sentence);
    const start = performance.now();
    for (let i = 0; i < 50; i++) toSpokenTurkish(sentence);
    expect((performance.now() - start) / 50).toBeLessThan(25);
  });

  it('10 000 karakterlik rastgele girdi 200 ms içinde döner', () => {
    const alphabet = "0123456789 .,:;-+/%$€₺°'’()[]\"ABCDEFKXabcdefgkmnsvxyzçğıöşü\n…—&@#";
    let seed = 987654321;
    const next = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed;
    };
    let big = '';
    for (let i = 0; i < 10_000; i++) big += alphabet.charAt(next() % alphabet.length);
    const start = performance.now();
    toSpokenTurkish(big);
    expect(performance.now() - start).toBeLessThan(200);
  });

  it.each([
    ['tek sözcük', 'a'.repeat(10_000)],
    ['rakam yığını', '1'.repeat(10_000)],
    ['nokta-rakam zinciri', '1.'.repeat(5_000)],
    ['boşluklu rakamlar', '1 '.repeat(5_000)],
    ['tire zinciri', 'a-'.repeat(5_000)],
    ['alan adı zinciri', 'ab.'.repeat(3_000)],
    ['büyük harfler', 'A '.repeat(5_000)],
    ['kesme zinciri', "5'".repeat(5_000)],
  ])('patolojik girdi: %s', (_name, input) => {
    const start = performance.now();
    toSpokenTurkish(input);
    // Sınır felaket geri izlemeyi (saniyeler) yakalamak içindir; yük altında (bütün sınamalar koşarken) olağan süre
    // 200 ms'yi aşabiliyordu (ölçüm: 232 ms). Tek başına koşuda ~10–40 ms sürer.
    expect(performance.now() - start).toBeLessThan(1_500);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// v1 uyumluluğu: Fuber AI v1 `tests/sayi-okuma.test.ts` tabloları (beş tur düzeltilmiş). Cümle → beklenen
// çiftleri v1'den AYNEN alınmıştır; yalnız `// v2 farkı` notlu satırlarda beklenen çıktı v2'nin bilinçli
// genişlemesine göre yazılmıştır.
// ---------------------------------------------------------------------------------------------------------------
describe('v1 uyumluluğu', () => {
  it.each([
    [0, 'sıfır'],
    [7, 'yedi'],
    [10, 'on'],
    [11, 'on bir'],
    [99, 'doksan dokuz'],
    [100, 'yüz'],
    [101, 'yüz bir'],
    [250, 'iki yüz elli'],
    [1000, 'bin'],
    [1001, 'bin bir'],
    [2026, 'iki bin yirmi altı'],
    [15000, 'on beş bin'],
    [100000, 'yüz bin'],
    [1_000_000, 'bir milyon'],
    [3_500_000, 'üç milyon beş yüz bin'],
    [1_000_000_000, 'bir milyar'],
    [1_234_567, 'bir milyon iki yüz otuz dört bin beş yüz altmış yedi'],
  ])('sayiYazi %s → %s', (n, expected) => {
    expect(numberToTurkish(n)).toBe(expected);
  });

  it.each([
    [1, 'birinci'],
    [2, 'ikinci'],
    [3, 'üçüncü'],
    [4, 'dördüncü'],
    [6, 'altıncı'],
    [9, 'dokuzuncu'],
    [10, 'onuncu'],
    [25, 'yirmi beşinci'],
    [40, 'kırkıncı'],
    [60, 'altmışıncı'],
    [100, 'yüzüncü'],
    [1000, 'bininci'],
    [24, 'yirmi dördüncü'],
  ])('siraYazi %s → %s', (n, expected) => {
    expect(harmonizeSuffix(numberToTurkish(n), 'inci')).toBe(expected);
  });

  // v1 iyelikEki(n) yalnız eki döndürür; v2'de karşılığı harmonizeSuffix(okunuş, 'si') (ünlüden sonra kaynaştırma "s").
  it.each([
    [0, 'ı'], [1, 'i'], [2, 'si'], [3, 'ü'], [4, 'ü'], [5, 'i'], [6, 'sı'], [7, 'si'], [8, 'i'], [9, 'u'], [10, 'u'],
    [12, 'si'], [20, 'si'], [30, 'u'], [40, 'ı'], [50, 'si'], [60, 'ı'], [70, 'i'], [80, 'i'], [90, 'ı'], [100, 'ü'],
    [125, 'i'], [200, 'ü'], [1000, 'i'], [1_000_000, 'u'],
  ])('iyelikEki %s → %s', (n, ek) => {
    const spoken = numberToTurkish(n);
    // "dört" ünlüyle başlayan ekte yumuşar (dördü); v1 yalnız eki döndürdüğü için gövde burada uyarlanır.
    const stem = spoken.replace(/dört$/, 'dörd');
    expect(harmonizeSuffix(spoken, 'si')).toBe(stem + ek);
    // Çıplak "-i" de aynı iyelik okunuşunu verir ("%50'i" → "yüzde elli" + "si").
    expect(harmonizeSuffix(spoken, 'i')).toBe(stem + ek);
  });

  table([
    // tam sayılar, saat, tarih, tutar, yüzde, sıra, ondalık
    ["Yarın saat 10:00'da toplantın var.", 'Yarın saat onda toplantın var.'],
    ['Toplantı 12.30’da, sunum 9:05’te.', 'Toplantı on iki otuzda, sunum dokuz sıfır beşte.'],
    ['Son tarih 25.10.2026.', 'Son tarih yirmi beş Ekim iki bin yirmi altı.'],
    ['Fiyat 3.500.000 TL.', 'Fiyat üç milyon beş yüz bin lira.'],
    ['Kampanya %40 indirimli, ₺250 yerine.', 'Kampanya yüzde kırk indirimli, iki yüz elli lira yerine.'],
    ['Bu 3. kez oluyor ve 25. yılımız.', 'Bu üçüncü kez oluyor ve yirmi beşinci yılımız.'],
    // v2 farkı: noktalı virgül virgüle çevrilir
    ['Büyüme 3,5 milyon; oran 2.5 kat.', 'Büyüme üç virgül beş milyon, oran iki nokta beş kat.'],
    ["Saat 3'te ara ver, 2026'da bitir.", 'Saat üçte ara ver, iki bin yirmi altıda bitir.'],
    // v2 farkı: telefon grupları arasına virgül
    ['Numara 0500 123 45 67.', 'Numara sıfır beş yüz, yüz yirmi üç, kırk beş, altmış yedi.'],
    // v2 farkı: rakama bitişik harf okunur ("üç be"), "H2O" rakamsız çıktı kuralı gereği "he iki O" olur
    ['3B model ve H2O.', 'üç be model ve he iki O.'],
    // düzeltme turu 2 — para
    ['Toplam $50.', 'Toplam elli dolar.'],
    // v2 farkı: harf harf kısaltma ("KDV" → "ka de ve")
    ['Toplam ₺1.250, KDV dahil.', 'Toplam bin iki yüz elli lira, ka de ve dahil.'],
    ['Tutar $1,000,000 oldu.', 'Tutar bir milyon dolar oldu.'],
    ['Tutar $1,000,000.5 oldu.', 'Tutar bir milyon virgül beş dolar oldu.'],
    ['Fatura 1.250,50 TL.', 'Fatura bin iki yüz elli lira elli kuruş.'],
    ['Kahve $3.50, çay €2.', 'Kahve üç dolar elli sent, çay iki avro.'],
    ['Bütçe 1.000.000 TL, gelir 2,500,000 kişi başı.', 'Bütçe bir milyon lira, gelir iki milyon beş yüz bin kişi başı.'],
    ['Oran %12,5 arttı.', 'Oran yüzde on iki virgül beş arttı.'],
    ['Toplam 1.250,50 adet.', 'Toplam bin iki yüz elli virgül elli adet.'],
    ['EN 1,000,000.25 değer.', 'EN bir milyon virgül yirmi beş değer.'],
    // düzeltme turu 2 — saat yalnız bağlam söylerse; noktalı sayı ve sürüm "nokta"; gün.ay tarih
    ['Python 3.12 kurulu.', 'Python üç nokta on iki kurulu.'],
    ['Oran 1.25 kat arttı.', 'Oran bir nokta yirmi beş kat arttı.'],
    ['Saat 14.30 gibi geliyorum.', 'Saat on dört otuz gibi geliyorum.'],
    ['14.30 civarında uğrarım.', 'on dört otuz civarında uğrarım.'],
    // v2 farkı: noktalı virgül virgüle çevrilir
    [
      'Fuber 0.9.0 çıktı; v0.9.0 etiketi de var.',
      'Fuber sıfır nokta dokuz nokta sıfır çıktı, sıfır nokta dokuz nokta sıfır etiketi de var.',
    ],
    ['Sürüm v2.1 hazır.', 'Sürüm iki nokta bir hazır.'],
    ['Teslim 12.10 tarihinde.', 'Teslim on iki Ekim tarihinde.'],
    ["Görüşme 12.10'da.", 'Görüşme on iki onda.'],
    ["Görüşme 12.10'de.", 'Görüşme on iki Ekimde.'],
    ['Rapor 2026-10-25 tarihli.', 'Rapor yirmi beş Ekim iki bin yirmi altı tarihli.'],
    ['Sunucu 192.168.1.10 adresinde.', 'Sunucu yüz doksan iki nokta yüz altmış sekiz nokta bir nokta on adresinde.'],
    // düzeltme turu 3 — saat aralıkları ve tam saat
    ['Toplantı 14.00-15.00 arası.', 'Toplantı on dört ile on beş arası.'],
    ['20.30 ile 21.00 arasında ararım.', 'yirmi otuz ile yirmi bir arasında ararım.'],
    ['Mesai 9:00–17:30.', 'Mesai dokuz ile on yedi otuz.'],
    ['Yemek 13.00 sonrası.', 'Yemek on üç sonrası.'],
    ["Başlangıç 09.00'da.", 'Başlangıç dokuzda.'],
    ['Fiyat $1.00 oldu.', 'Fiyat bir dolar oldu.'],
    // düzeltme turu 4 — ondalık çiftler saat aralığı değildir
    ['Oran 1.25 ile 1.50 arasında.', 'Oran bir nokta yirmi beş ile bir nokta elli arasında.'],
    ['Ortalama 2.50-3.50 arası.', 'Ortalama iki nokta elli-üç nokta elli arası.'],
    ['Sürüm 1.10 ve 1.20 çıktı.', 'Sürüm bir nokta on ve bir nokta yirmi çıktı.'],
    ['Randevu saat 13.00.', 'Randevu saat on üç.'],
    ['Saat 10.10 ile 10.40 arası.', 'Saat on on ile on kırk arası.'],
    // düzeltme turu 5 — iki yönlü matris: saat olarak
    ['Değerli müşterimiz, randevunuz 10.00 ile 11.00 arası.', 'Değerli müşterimiz, randevunuz on ile on bir arası.'],
    ['Değerlendirme toplantısı yarın 15.00.', 'Değerlendirme toplantısı yarın on beş.'],
    ['Kur toplantısı 14.00-15.00 arası.', 'Kur toplantısı on dört ile on beş arası.'],
    ['Fiyat toplantısı 14.00-15.00 arası.', 'Fiyat toplantısı on dört ile on beş arası.'],
    ['Puan toplantısı 14.00-15.00 arası.', 'Puan toplantısı on dört ile on beş arası.'],
    ['Bu yüzden toplantı 14.00-15.00 arası.', 'Bu yüzden toplantı on dört ile on beş arası.'],
    ["Toplantı 14.30'da.", 'Toplantı on dört otuzda.'],
    ['14.00-15.00 arası.', 'on dört ile on beş arası.'],
    // düzeltme turu 5 — ondalık ya da değişmeden
    ['Etiket v1.10 hazır.', 'Etiket bir nokta on hazır.'],
    ['Artış %2.5 oldu.', 'Artış yüzde iki nokta beş oldu.'],
    ['Tutar 1.250 TL.', 'Tutar bin iki yüz elli lira.'],
    ['Fuber 0.9.0 çıktı.', 'Fuber sıfır nokta dokuz nokta sıfır çıktı.'],
    ['Tarih 25.10.2026.', 'Tarih yirmi beş Ekim iki bin yirmi altı.'],
    ['Bilet 2.50 TL.', 'Bilet iki lira elli kuruş.'],
    // v2 farkı: "kg" birimi okunur ("kilogram"); ondalık okunuş ve tire v1'deki gibi korunur
    ['Ağırlık 1.25-1.50 kg arası.', 'Ağırlık bir nokta yirmi beş-bir nokta elli kilogram arası.'],
    ['Tamam, takvimine hemen bakıyorum. Ahmet’in sunumu yarın.', 'Tamam, takvimine hemen bakıyorum. Ahmet’in sunumu yarın.'],
  ]);

  table([
    // Ek ipuçları ve v1 iyelik örnekleri ("payın %40’ı", "%50’si", "%6’sı", "%100’ü")
    ['payın %40’ı', 'payın yüzde kırkı'],
    ['payın %50’si', 'payın yüzde ellisi'],
    ['payın %6’sı', 'payın yüzde altısı'],
    ['payın %100’ü', 'payın yüzde yüzü'],
    ['payın %50’i', 'payın yüzde ellisi'],
    // Cümle sonu noktalama sayıya yapışmaz
    ['Toplam 50.', 'Toplam elli.'],
    ['Fiyat 3,5.', 'Fiyat üç virgül beş.'],
    ['Saat 3 civarı, 2.5 kat.', 'Saat üç civarı, iki nokta beş kat.'],
    // Noktalı sayı bağlamları
    ['Python 3.12', 'Python üç nokta on iki'],
    ['2.5 kat', 'iki nokta beş kat'],
    ['1.25', 'bir nokta yirmi beş'],
    ['$3.50', 'üç dolar elli sent'],
    ['$1.00', 'bir dolar'],
    ['$1,000,000.5', 'bir milyon virgül beş dolar'],
    ['Katsayı 1.20 çıktı.', 'Katsayı bir nokta yirmi çıktı.'],
    ['Endeks 14.30 oldu.', 'Endeks on dört nokta otuz oldu.'],
    ['x2.30 hız', 'x iki nokta otuz hız'],
    ['Ortalama 14.30 puan.', 'Ortalama on dört nokta otuz puan.'],
    ['Saat 9.15 gibi', 'Saat dokuz on beş gibi'],
    ['12.10 tarihinde', 'on iki Ekim tarihinde'],
    // v2 bilinçli: model yanlış ek yazsa da colon saatinde uyuma sokulur (v1 tablosunda yok)
    ["12:34'de", 'on iki otuz dörtte'],
  ]);

  // demo.2 bütünleştirme: dinlerken yakalanan dört okuma kusuru.
  table([
    // 1) Model adındaki tire aralık değildir ("ile" denmez)
    ['Yerel model Qwen3.5-4B kullanılıyor.', 'Yerel model Qwen üç nokta beş dört be kullanılıyor.'],
    ['Llama 3.1-8B de olur.', 'Llama üç nokta bir sekiz be de olur.'],
    ['GPT-4o hazır.', 'GPT dört o hazır.'],
    // ...ama gerçek aralık aralık kalır
    ['Sıcaklık 10-15 derece.', 'Sıcaklık on ile on beş derece.'],
    ['Maaş 5-10K arası.', 'Maaş beş ile on ka arası.'],
    // 2) İkili önekli birimler
    ['Bellek 512 MiB.', 'Bellek beş yüz on iki mebibayt.'],
    ['Kartta 7 GiB boş, 1024 KiB ayrıldı.', 'Kartta yedi gibibayt boş, bin yirmi dört kibibayt ayrıldı.'],
    ["3,2 GiB'ı dolu.", 'üç virgül iki gibibaytı dolu.'],
    // 3) Onaltılık: basamak basamak, harfler heceleme adıyla; x çarpı sanılmaz
    ['Renk 0xFF.', 'Renk onaltılık fe fe.'],
    ['Adres 0x1F4A oldu.', 'Adres onaltılık bir fe dört a oldu.'],
    ['Hata 0x80070005 döndü.', 'Hata onaltılık sekiz sıfır sıfır yedi sıfır sıfır sıfır beş döndü.'],
    ['Vurgu #0E59EF.', 'Vurgu onaltılık sıfır e beş dokuz e fe.'],
    // içinde harf olmayan # dizisi sayıdır
    ['Sipariş #123456.', 'Sipariş numara yüz yirmi üç bin dört yüz elli altı.'],
    // 4) Ekli noktalı sayı: değişim fiili ya da ondalık bağlamı varsa değer, yoksa saat
    ["Kur 3.50'ye çıktı.", 'Kur üç nokta elliye çıktı.'],
    ["Fiyat 3.50'den 4.20'ye yükseldi.", 'Fiyat üç nokta elliden dört nokta yirmiye yükseldi.'],
    ["Oran 3.50'ye indi.", 'Oran üç nokta elliye indi.'],
    ["Toplantı 3.50'ye alındı.", 'Toplantı üç elliye alındı.'],
    ["Toplantı 9.30'a alındı, 15.30'da bitiyor.", 'Toplantı dokuz otuza alındı, on beş otuzda bitiyor.'],
    ["Uçak 3.50'ye indi.", 'Uçak üç elliye indi.'],
  ]);
});
