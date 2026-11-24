// 0.11 G9 — Görevler (süreli/sürekli işler) saf kuralları (spec §8; shared/isler.ts): plan doğrulama sınırları, uyarlanır aralık (değişiklik
// yoksa ×1,5 uzar, değişince en kısaya döner, yapay zekânın önerisi sınırlara kırpılır), bitiş (süre, bitiş zamanı, sigorta, adım sınırı),
// izin kapsamı (yalnız izin verilen kişiye/adrese/siteye; ekran izni yoksa fare-klavye yok) ve onay kartının insan dili (İş'te teknik sözcük yok).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isPlaniDogrula, sonrakiAralik, bitmeliMi, izinVarMi, isPlaniMetni, jidAyniMi, durmaMetni, gonderilenlerMetni,
  EN_KISA_ARALIK, VARSAYILAN_AZAMI_ADIM, EN_COK_ADIM, EN_UZUN_SURE, AYNI_ANDA_EN_COK, ARALIK_CARPANI,
  type IsPlani, type IsOzet,
} from '../src/shared/isler.ts';
import { isDiliIhlali } from '../src/shared/is-dili.ts';
import { epostaAlicilari } from '../src/main/entegrasyon/eposta-alicilari.ts';

const SIMDI = new Date('2026-10-28T10:00:00Z');
const temel = (ek: Record<string, unknown> = {}) => ({
  gozcu: { tur: 'whatsapp', hedef: 'Ahmet' }, aralik: { min: 30, max: 300 }, bitis: { tur: 'sure', saniye: 180 },
  izinler: [{ tur: 'whatsapp_gonder', kisi: 'Ahmet Yılmaz' }], azamiAdim: 20, ...ek,
});
const gecerli = (g: unknown): IsPlani => { const r = isPlaniDogrula(g, SIMDI); assert.ok('plan' in r, JSON.stringify(r)); return r.plan; };
const hatali = (g: unknown, desen?: RegExp) => { const r = isPlaniDogrula(g, SIMDI); assert.ok('hata' in r, `geçmeliydi değil: ${JSON.stringify(g)}`); if (desen) assert.match(r.hata, desen); };

test('sabitler (spec §8 sınırları)', () => {
  assert.deepEqual([EN_KISA_ARALIK, VARSAYILAN_AZAMI_ADIM, EN_COK_ADIM, EN_UZUN_SURE, AYNI_ANDA_EN_COK, ARALIK_CARPANI], [10, 60, 500, 86_400, 3, 1.5]);
});

test('isPlaniDogrula: aralık en kısa 10 sn, en uzun 3600 sn, max ≥ min; saat gözcüsünde en kısa 30 sn', () => {
  hatali(temel({ aralik: { min: 9, max: 60 } }), /10/);
  hatali(temel({ aralik: { min: 30, max: 4000 } }), /3600/);
  hatali(temel({ aralik: { min: 60, max: 30 } }));
  hatali(temel({ aralik: undefined }));
  gecerli(temel({ aralik: { min: 10, max: 3600 } }));
  hatali(temel({ gozcu: { tur: 'saat' }, aralik: { min: 20, max: 60 } }), /30/);
  assert.equal(gecerli(temel({ gozcu: { tur: 'saat' }, aralik: { min: 30, max: 60 } })).aralik.min, 30);
});

test('isPlaniDogrula: süre ve sigorta en çok 24 saat; bitiş zamanı gelecekte ve 24 saat içinde', () => {
  hatali(temel({ bitis: { tur: 'sure', saniye: 90_000 } }), /86400|24 saat/);
  gecerli(temel({ bitis: { tur: 'sure', saniye: 86_400 } }));
  hatali(temel({ bitis: { tur: 'sure', saniye: 0 } }));
  hatali(temel({ bitis: { tur: 'elle', sigorta: 90_000 } }));
  hatali(temel({ bitis: { tur: 'kosul', aciklama: 'Ahmet cevap verince', sigorta: 100_000 } }));
  hatali(temel({ bitis: { tur: 'kosul', aciklama: '  ', sigorta: 3600 } }));
  assert.equal(gecerli(temel({ bitis: { tur: 'kosul', aciklama: 'Ahmet cevap verince', sigorta: 3600 } })).bitis.tur, 'kosul');
  gecerli(temel({ bitis: { tur: 'zaman', iso: '2026-10-28T18:00:00Z' } }));
  hatali(temel({ bitis: { tur: 'zaman', iso: '2026-10-28T09:00:00Z' } }), /geçmiş|gelecek/);
  hatali(temel({ bitis: { tur: 'zaman', iso: '2026-10-30T09:00:00Z' } }), /24 saat/);
  hatali(temel({ bitis: { tur: 'zaman', iso: 'yarın' } }));
  hatali(temel({ bitis: { tur: 'sonsuz' } }));
});

test('isPlaniDogrula: azamiAdim yoksa 60; 1..500 dışı hata', () => {
  const { azamiAdim: _a, ...adimsiz } = temel();
  assert.equal(gecerli(adimsiz).azamiAdim, VARSAYILAN_AZAMI_ADIM);
  hatali(temel({ azamiAdim: 0 }));
  hatali(temel({ azamiAdim: 501 }), /500/);
  assert.equal(gecerli(temel({ azamiAdim: 500 })).azamiAdim, 500);
});

test('isPlaniDogrula: sayfa gözcüsü yalnız http(s) adresle; javascript: ve boş hedef hata', () => {
  hatali(temel({ gozcu: { tur: 'sayfa', hedef: 'javascript:alert(1)' } }), /http/);
  hatali(temel({ gozcu: { tur: 'sayfa', hedef: 'file:///C:/gizli.txt' } }), /http/);
  hatali(temel({ gozcu: { tur: 'sayfa' } }));
  assert.equal(gecerli(temel({ gozcu: { tur: 'sayfa', hedef: 'https://ornek.com/fiyat' } })).gozcu.hedef, 'https://ornek.com/fiyat');
  hatali(temel({ gozcu: { tur: 'radar' } }));
  hatali('plan');
  hatali(null);
});

test('isPlaniDogrula: izinlerde boş kişi/adres/alan yok; bilinmeyen izin türü hata; izinsiz plan geçerli', () => {
  hatali(temel({ izinler: [{ tur: 'whatsapp_gonder', kisi: '  ' }] }), /kişi/);
  hatali(temel({ izinler: [{ tur: 'eposta_gonder', adres: '' }] }), /adres/);
  // Son inceleme yeniden incelemesi: izin kartında bilinen bir adrese BENZEYEN ama başka yere giden adres yok — yalnız ASCII görünür karakter
  // (Kiril "\u0445", sıfır genişlikli boşluk, yön işareti, NEL reddedilir).
  for (const adres of ['a@\u0445.com', 'a\u200b@x.com', 'a@x.com\u202e', 'a@x.com\u0085', 'ahmet@örnek.com']) hatali(temel({ izinler: [{ tur: 'eposta_gonder', adres }] }), /adres/);
  hatali(temel({ izinler: [{ tur: 'tarayici', alan: '' }] }));
  hatali(temel({ izinler: [{ tur: 'dosya_sil' }] }));
  assert.deepEqual(gecerli(temel({ izinler: [] })).izinler, []);
  assert.deepEqual(gecerli(temel({ izinler: undefined })).izinler, []);
  const p = gecerli(temel({ izinler: [{ tur: 'ekran' }, { tur: 'tarayici', alan: 'https://www.Ornek.com/sepet' }, { tur: 'eposta_gonder', adres: ' Ece@Ornek.co ' }] }));
  assert.deepEqual(p.izinler, [{ tur: 'ekran' }, { tur: 'tarayici', alan: 'ornek.com' }, { tur: 'eposta_gonder', adres: 'ece@ornek.co' }]);
});

test('sonrakiAralik: değişmedikçe ×1,5 (yukarı yuvarla) max’a dek; değişince min; öneri [min, max]’a kırpılır', () => {
  const p = gecerli(temel({ aralik: { min: 10, max: 60 } }));
  const dizi: number[] = [];
  let a = 10;
  for (let i = 0; i < 7; i++) { a = sonrakiAralik(a, false, p); dizi.push(a); }
  assert.deepEqual(dizi, [15, 23, 35, 53, 60, 60, 60]);
  assert.equal(sonrakiAralik(53, true, p), 10, 'değişti → en kısa');
  assert.equal(sonrakiAralik(30, true, p, 5), 10, 'öneri 5 → 10’a kırpılır');
  assert.equal(sonrakiAralik(30, true, p, 999), 60, 'öneri max’a kırpılır');
  assert.equal(sonrakiAralik(30, true, p, 42.4), 42);
  assert.equal(sonrakiAralik(30, false, p, Number.NaN), 45, 'geçersiz öneri yok sayılır');
});

const ozet = (plan: IsPlani, ek: Partial<IsOzet> = {}): IsOzet => ({
  id: 1, baslik: 'Ahmet’i takip et', amac: 'Ahmet cevap verince söyle', durum: 'suruyor', plan, baslangic: SIMDI.toISOString(), bitisZamani: null,
  sonraki: SIMDI.toISOString(), sonKontrol: null, adim: 0, kontrol: 0, sonOzet: null, sonuc: null, durmaNedeni: null, sohbetId: 7, ...ek,
});
const sonra = (sn: number) => new Date(SIMDI.getTime() + sn * 1000);

test('bitmeliMi: süre, bitiş zamanı, sigorta ve adım sınırı', () => {
  const sure = ozet(gecerli(temel({ bitis: { tur: 'sure', saniye: 180 } })));
  assert.equal(bitmeliMi(sure, sonra(179)), null);
  assert.equal(bitmeliMi(sure, sonra(180)), 'sure');
  const zaman = ozet(gecerli(temel({ bitis: { tur: 'zaman', iso: '2026-10-28T11:00:00Z' } })));
  assert.equal(bitmeliMi(zaman, sonra(3599)), null);
  assert.equal(bitmeliMi(zaman, sonra(3600)), 'sure');
  const elle = ozet(gecerli(temel({ bitis: { tur: 'elle', sigorta: 600 } })));
  assert.equal(bitmeliMi(elle, sonra(599)), null);
  assert.equal(bitmeliMi(elle, sonra(600)), 'sure', 'sigorta doldu');
  const kosul = ozet(gecerli(temel({ bitis: { tur: 'kosul', aciklama: 'cevap gelince', sigorta: 60 } })));
  assert.equal(bitmeliMi(kosul, sonra(61)), 'sure');
  const adim = ozet(gecerli(temel({ azamiAdim: 3 })), { adim: 3 });
  assert.equal(bitmeliMi(adim, sonra(1)), 'sinir');
  assert.equal(bitmeliMi({ ...adim, adim: 2 }, sonra(1)), null);
  assert.equal(bitmeliMi({ ...sure, baslangic: null }, sonra(9999)), null, 'başlamamış iş bitmez');
});

test('izinVarMi (düzeltme turu 1, Ö1): WhatsApp izni KİŞİYE bağlı — mesajın gideceği hesap (çağıranın çözdüğü aliciJid) izindeki jid’le aynı olmalı; ad yetmez', () => {
  const AHMET = '905000000001@s.whatsapp.net';
  const ham = gecerli(temel({ izinler: [{ tur: 'whatsapp_gonder', kisi: 'Ahmet Yılmaz', jid: '905000000003@s.whatsapp.net' }] }));
  assert.equal((ham.izinler[0] as { jid?: string }).jid, undefined, 'modelin verdiği jid alınmaz (kişi görev başlarken çözülür)');
  const p: IsPlani = { ...ham, izinler: [{ tur: 'whatsapp_gonder', kisi: 'Ahmet Yılmaz', jid: AHMET }] };
  assert.equal(izinVarMi(p, 'whatsapp_gonder', { kime: 'Ahmet Yılmaz', metin: 'x', aliciJid: AHMET }), true, 'izinli kişi');
  assert.equal(izinVarMi(p, 'whatsapp_gonder', { kime: 'AHMET YILMAZ', metin: 'x', aliciJid: '05000000001' }), true, 'numara biçimi önemsiz (0500… = 90500…)');
  assert.equal(izinVarMi(p, 'whatsapp_gonder', { kime: 'Ahmet Yılmaz', metin: 'x', aliciJid: '905000000003@s.whatsapp.net' }), false, 'aynı ad, başka kişi');
  assert.equal(izinVarMi(p, 'whatsapp_gonder', { kime: 'Ahmet Yılmaz', metin: 'x', aliciJid: '' }), false, 'ad belirsiz/çözülemedi');
  assert.equal(izinVarMi(p, 'whatsapp_gonder', { kime: 'Ahmet Yılmaz', metin: 'x' }), false, 'çözülmemiş ad izin değildir');
  assert.equal(izinVarMi(p, 'whatsapp_gonder', { kime: 'x', aliciJid: '905000000001@g.us' }), false, 'aynı rakamlı grup kişi değildir');
  assert.equal(izinVarMi(ham, 'whatsapp_gonder', { kime: 'Ahmet Yılmaz', aliciJid: AHMET }), false, 'jid’siz izin hiçbir şeye onaysız izin vermez');
  assert.equal(izinVarMi(gecerli(temel({ izinler: [] })), 'whatsapp_gonder', { kime: 'Ahmet Yılmaz', aliciJid: AHMET }), false);
  assert.equal(jidAyniMi('0500 000 00 01', AHMET), true);
  assert.equal(jidAyniMi('Ahmet', AHMET), false);
  // Düzeltme turu 2 (N4): alan adı da aynı olmalı — aynı rakamlı "@lid" ya da "@g.us" kişi hesabı değildir; eski "@c.us" kişidir.
  assert.equal(jidAyniMi('905000000001@lid', AHMET), false);
  assert.equal(jidAyniMi('905000000001@g.us', AHMET), false);
  assert.equal(jidAyniMi('905000000001@c.us', AHMET), true);
  assert.equal(izinVarMi(p, 'whatsapp_gonder', { kime: '905000000001@lid', aliciJid: '905000000001@lid' }), false);
  hatali(temel({ izinler: [{ tur: 'whatsapp_gonder', kisi: '120363025555555555@g.us' }] }), /grup/);
});

test('ekran gözcüsü ekran izni ister (Ö3); durma nedenleri (Gizli dahil) sade cümle; gönderilenler satırında metin yok', () => {
  hatali(temel({ gozcu: { tur: 'ekran' }, izinler: [] }), /ekran izni/);
  assert.equal(gecerli(temel({ gozcu: { tur: 'ekran' }, izinler: [{ tur: 'ekran' }] })).gozcu.tur, 'ekran');
  for (const n of ['kullanici', 'acil', 'kapanis', 'sinir', 'hata', 'gizli', 'yerel'] as const) {
    const m = durmaMetni(n);
    assert.ok(m.length > 5 && isDiliIhlali(m) === null, `${n}: ${m}`);
  }
  // Son inceleme I1: gerçek neden — Gizli yalnız Gizli'de; yalnız yerel yolda nötr cümle, gizlilik vaadi ve "Gizli" sözü yok.
  assert.equal(durmaMetni('gizli'), 'Gizli modda görevler çalışmaz; görev durdu.');
  assert.equal(durmaMetni('yerel'), 'Yapay zekâ şu an yalnız bu bilgisayarda çalıştığı için görevler çalışmaz; görev durdu.');
  assert.doesNotMatch(durmaMetni('yerel'), /Gizli|gizli|gizlilik|ağa çıkmaz|dışarı/);
  const z = new Date(2026, 9, 28, 18, 42).toISOString();
  assert.equal(gonderilenlerMetni([{ alici: 'Ahmet Yılmaz', kanal: 'WhatsApp', zaman: z }, { alici: 'ece@ornek.co', kanal: 'e-posta', zaman: z }]),
    'Gönderilenler: Ahmet Yılmaz (WhatsApp, 18:42); ece@ornek.co (e-posta, 18:42)');
  assert.equal(gonderilenlerMetni([]), '');
  // Çözülmüş kişi onay kartında numarasının sonuyla görünür.
  const p = gecerli(temel());
  const cozuk: IsPlani = { ...p, gozcu: { ...p.gozcu, jid: '905000000001@s.whatsapp.net' }, izinler: [{ tur: 'whatsapp_gonder', kisi: 'Ahmet Yılmaz', jid: '905000000001@s.whatsapp.net' }] };
  const m = isPlaniMetni(cozuk, 'is');
  assert.deepEqual(m.izinler, ['Ahmet Yılmaz’a (…0001) WhatsApp’tan yazabilir']);
  assert.match(m.nasil, /^30 sn’de bir WhatsApp’ta Ahmet’ten \((…0001)\) yeni mesaj var mı bakar/);
});

/** Görev adımının yaptığı gibi (main/isler/adim.ts izinGirdisi): alıcılar GÖNDERENİN ayrıştırıcısıyla çözülüp girdinin üstüne yazılır. */
const eposta = (g: Record<string, unknown>) => ({ ...g, epostaAlicilari: epostaAlicilari(g) });

test('izinVarMi: e-posta yalnız izinli adres(ler)e (cc dahil); ekran izni bilgisayar_*; tarayıcı alan adıyla; başka araç hayır', () => {
  const p = gecerli(temel({ izinler: [{ tur: 'eposta_gonder', adres: 'ece@ornek.co' }, { tur: 'tarayici', alan: 'ornek.com' }] }));
  assert.equal(izinVarMi(p, 'eposta_gonder', eposta({ kime: 'Ece@Ornek.co', konu: 'k', govde: 'g' })), true);
  assert.equal(izinVarMi(p, 'eposta_gonder', eposta({ kime: 'Ece Aydın <ece@ornek.co>', konu: 'k', govde: 'g' })), true, 'görünen ad yalnız etiket; giden adres izinli');
  assert.equal(izinVarMi(p, 'eposta_gonder', eposta({ kime: 'ece@ornek.co', cc: 'patron@ornek.co', konu: 'k', govde: 'g' })), false, 'izinsiz cc');
  assert.equal(izinVarMi(p, 'eposta_gonder', eposta({ kime: 'baska@ornek.co', konu: 'k', govde: 'g' })), false);
  assert.equal(izinVarMi(p, 'eposta_gonder', { kime: 'ece@ornek.co', konu: 'k', govde: 'g' }), false, 'çözülmemiş ham alıcı izin değildir (çağıran çözmeli)');
  assert.equal(izinVarMi(p, 'bilgisayar_tikla', { x: 1, y: 2 }), false, 'ekran izni yokken fare yok');
  assert.equal(izinVarMi(p, 'tarayici_tikla', { no: 3, adres: 'https://www.ornek.com/sepet' }), true);
  assert.equal(izinVarMi(p, 'tarayici_ac', { adres: 'https://magaza.ornek.com/' }), true, 'alt alan adı');
  assert.equal(izinVarMi(p, 'tarayici_ac', { adres: 'https://ornek.com.kotu.net/' }), false);
  assert.equal(izinVarMi(p, 'tarayici_yaz', { no: 3, metin: 'x' }), false, 'adres yoksa izin yok');
  const ekran = gecerli(temel({ izinler: [{ tur: 'ekran' }] }));
  assert.equal(izinVarMi(ekran, 'bilgisayar_tikla', { x: 1, y: 2 }), true);
  assert.equal(izinVarMi(ekran, 'bilgisayar_yaz', { metin: 'x' }), true);
  assert.equal(izinVarMi(ekran, 'whatsapp_gonder', { kime: 'Ahmet Yılmaz' }), false);
  assert.equal(izinVarMi(ekran, 'hafiza_sil', { id: 3 }), false);
  assert.equal(izinVarMi(ekran, 'is_baslat', {}), false);
});

// ── Son inceleme C1: denetlenen = gönderilen ─────────────────────────────────────────────────────────────────────────
// Eski denetim bir düzenli ifadeydi (/[^\s<>,;"']+@[^\s<>,;"']+/): aşağıdaki dizelerde yalnız a@x.com'u görüyor, izinli sanıyordu; nodemailer ise
// (sendMail({ to, cc })) evil@attacker.com'a da gönderiyordu. Şimdi alıcılar nodemailer'ın kendi ayrıştırıcısıyla (nodemailer/lib/addressparser)
// çıkarılır; her biri izinli adresle tam aynı olmalı, ayrıştırılamayan/adressiz/grup biçimi izin değildir (normal onay kartı).
const SALDIRILAR = [
  'a@x.com, "evil"@attacker.com',
  'a@x.com, evil @attacker.com',
  'a@x.com <"evil"@attacker.com>', // görünen ad izinli adres, adres saldırganın
  '"a@x.com" <evil@attacker.com>',
  'Muhasebe: a@x.com, "evil"@attacker.com;', // grup
  'Muhasebe: a@x.com;', // grup (üyeleri izinli olsa da: görev izninde grup yok)
  'a@x.com, =?UTF-8?Q?Muhasebe?= <evil @attacker.com>', // kodlanmış söz (encoded-word) görünen adla
  '=?UTF-8?Q?a=40x.com?= <evil@attacker.com>',
  'a@x.com, "evil"', // adressiz parça
  'a@x.com\n, evil@attacker.com',
];

test('C1: izinli adresin yanına saklanan alıcı (kime ya da cc) izin değildir — gönderenin ayrıştırıcısı zarfa ne yazıyorsa o denetlenir', () => {
  const p = gecerli(temel({ izinler: [{ tur: 'eposta_gonder', adres: 'a@x.com' }] }));
  for (const s of SALDIRILAR) {
    assert.equal(izinVarMi(p, 'eposta_gonder', eposta({ kime: s, konu: 'k', govde: 'g' })), false, `kime: ${s}`);
    assert.equal(izinVarMi(p, 'eposta_gonder', eposta({ kime: 'a@x.com', cc: s, konu: 'k', govde: 'g' })), false, `cc: ${s}`);
  }
  // Araç bcc göndermez; model yazdıysa o da denetlenir. Dize olmayan alan ve modelin uydurduğu "çözülmüş" liste izin vermez.
  assert.equal(izinVarMi(p, 'eposta_gonder', eposta({ kime: 'a@x.com', bcc: 'evil@attacker.com' })), false, 'bcc');
  assert.equal(izinVarMi(p, 'eposta_gonder', eposta({ kime: ['a@x.com', 'evil@attacker.com'] })), false, 'dizi');
  assert.equal(izinVarMi(p, 'eposta_gonder', eposta({ kime: 'evil@attacker.com', epostaAlicilari: ['a@x.com'] })), false, 'modelin yazdığı liste ezilir');
  assert.equal(izinVarMi(p, 'eposta_gonder', eposta({ kime: '' })), false, 'alıcı yoksa izin yok');
  // Kontrol grubu: yalnız izinli adres(ler) — büyük/küçük harf, görünen ad, ";" ya da "," ayırıcı, boş cc fark etmez.
  for (const kime of ['a@x.com', 'A@X.COM', 'Muhasebe <a@x.com>', 'a@x.com, a@x.com', 'a@x.com;A@x.com']) {
    assert.equal(izinVarMi(p, 'eposta_gonder', eposta({ kime, cc: '', konu: 'k', govde: 'g' })), true, kime);
  }
  // Ayrıştırıcının zarfa yazacağı adresler (nodemailer'ın kendi gönderiminde gördüğüyle aynı).
  assert.deepEqual(epostaAlicilari({ kime: 'a@x.com, "evil"@attacker.com' }), ['a@x.com', 'evil@attacker.com']);
  assert.deepEqual(epostaAlicilari({ kime: 'a@x.com', cc: 'a@x.com, evil @attacker.com' }), ['a@x.com', 'a@x.com', 'evil@attacker.com']);
  assert.equal(epostaAlicilari({ kime: 'Muhasebe: a@x.com;' }), null, 'grup');
  assert.equal(epostaAlicilari({ kime: 'a@x.com, "evil"' }), null, 'adressiz parça');
  assert.equal(epostaAlicilari({ kime: 42 }), null, 'dize değil');
  assert.deepEqual(epostaAlicilari({ kime: 'a@x.com', cc: null }), ['a@x.com'], 'cc yok');
});

test('C1: isPlaniDogrula — e-posta izni TEK çıplak adres: görünen ad, liste, grup, kodlanmış söz, tırnak, boşluk reddedilir', () => {
  for (const adres of [
    'Ece <ece@ornek.co>', '"Ece" <ece@ornek.co>', 'ece@ornek.co, patron@ornek.co', 'ece@ornek.co;patron@ornek.co', 'Ekip: ece@ornek.co;',
    '=?UTF-8?Q?Ece?= <ece@ornek.co>', '=?utf-8?q?ece?=@ornek.co', '"evil"@attacker.com', 'ece @ornek.co', 'ece@ornek.co patron@ornek.co',
    'ece(yorum)@ornek.co', 'ece@[127.0.0.1]', 'ece@ornek', 'ece', '@ornek.co', 'a@b@ornek.co', 'ece\\@ornek.co', 'ece@ornek.co\u0000',
  ]) hatali(temel({ izinler: [{ tur: 'eposta_gonder', adres }] }), /eposta_gonder izninde adres tek bir e-posta adresi/);
  assert.deepEqual(gecerli(temel({ izinler: [{ tur: 'eposta_gonder', adres: ' Muhasebe.Ekip+fatura@Ornek.com.tr ' }] })).izinler, [{ tur: 'eposta_gonder', adres: 'muhasebe.ekip+fatura@ornek.com.tr' }]);
  // Kabul edilen her izin, gönderenin ayrıştırıcısında kendisi olarak TEK adres okunur (izin = zarftaki adres).
  // Türkçe harfli alan adı (ece@şirket.com) artık izin olamaz: yalnız ASCII (benzer görünen harfle başka alana gitmesin) — üstteki testte.
  for (const adres of ['muhasebe@ornek.com', 'ali.veli+x@alt.ornek.com.tr', 'ece@sirket.com']) {
    const izin = gecerli(temel({ izinler: [{ tur: 'eposta_gonder', adres }] })).izinler[0] as { adres: string };
    assert.deepEqual(epostaAlicilari({ kime: izin.adres }), [izin.adres], adres);
  }
});

test('isPlaniMetni: onay kartının insan dili — İş’te teknik sözcük yok; örnek cümle; izinler ve sınır', () => {
  const p = gecerli(temel());
  const m = isPlaniMetni(p, 'is');
  assert.equal(m.nasil.split('.')[0] + '.', '30 sn’de bir WhatsApp’ta Ahmet’ten yeni mesaj var mı bakar; yoksa yapay zekâyı çağırmaz.');
  assert.match(m.ne, /Ahmet’ten/);
  assert.match(m.bitis, /3 dakika/);
  assert.deepEqual(m.izinler, ['Ahmet Yılmaz’a WhatsApp’tan yazabilir']);
  assert.match(m.sinir, /20/);
  const planlar: IsPlani[] = [
    p,
    gecerli(temel({ gozcu: { tur: 'eposta', hedef: 'fatura' }, bitis: { tur: 'elle', sigorta: 7200 }, izinler: [{ tur: 'eposta_gonder', adres: 'ece@ornek.co' }] })),
    gecerli(temel({ gozcu: { tur: 'sayfa', hedef: 'https://ornek.com/fiyat' }, aralik: { min: 60, max: 3600 }, bitis: { tur: 'kosul', aciklama: 'fiyat düşünce', sigorta: 86_400 }, izinler: [{ tur: 'tarayici', alan: 'ornek.com' }] })),
    gecerli(temel({ gozcu: { tur: 'ekran' }, izinler: [{ tur: 'ekran' }], bitis: { tur: 'zaman', iso: '2026-10-28T18:30:00Z' } })),
    gecerli(temel({ gozcu: { tur: 'saat' }, izinler: [{ tur: 'whatsapp_gonder', kisi: 'Ece' }, { tur: 'whatsapp_gonder', kisi: '905000000001' }], bitis: { tur: 'sure', saniye: 5400 } })),
  ];
  for (const plan of planlar) {
    const x = isPlaniMetni(plan, 'is');
    for (const s of [x.ne, x.nasil, x.bitis, x.sinir, ...x.izinler]) {
      assert.ok(s.trim().length > 0);
      assert.equal(isDiliIhlali(s), null, s);
      assert.doesNotMatch(s, /'/, `kesme işareti ’ olmalı: ${s}`);
      assert.doesNotMatch(s, /undefined|null|NaN|\[object/, s);
    }
  }
  assert.deepEqual(isPlaniMetni(planlar[4], 'is').izinler, ['Ece’ye WhatsApp’tan yazabilir', '905000000001 numarasına WhatsApp’tan yazabilir']);
  assert.match(isPlaniMetni(planlar[4], 'is').nasil, /her seferinde yapay zekâ/);
  assert.match(isPlaniMetni(planlar[4], 'is').bitis, /1 saat 30 dakika/);
  assert.match(isPlaniMetni(planlar[2], 'is').nasil, /ornek\.com/);
  assert.match(isPlaniMetni(planlar[2], 'is').bitis, /fiyat düşünce/);
  assert.match(isPlaniMetni(planlar[1], 'is').bitis, /2 saat/);
});
