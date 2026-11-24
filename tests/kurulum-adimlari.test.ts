// Kurulum sihirbazının sayfa listesi, sol paneldeki seçim özetleri ve kurulum sürümü (0.10 E4, K6; Görev 23 K11 ve Görev 29 K18'in
// yükseltme kuralları korunur, P7). Yönetici her adımı "ileri, ileri, ileri" diyerek geçebilmeli; kişiyi tanımak için birçok
// kurulum sayfası var. Sıra (İş): Hoş geldin → Fuber hesabı → Tanışalım → İşin → Günün → Görünüm → Ses → Gizlilik → Bu cihazda çalışan yapay
// zekâ → Bağlantılar → İzinler → Hazırsın; "İşin"de "Geliştiriciyim" seçilince "Geliştirici araçları" Hazırsın'dan hemen önce girer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  KURULUM_ADIMLARI, KURULUM_SURUMU, ROL_ADLARI, kurulumYolu, adimAdi, adimEkle, adimOzeti, adimSirasi, araclarGecisiMi, araclarTeklifEdilsinMi, kurulumSurumuGocu,
  isProfiliMetni, ozelYukseltmeBitirirMi, sessizSaatleri, gunBaslangici, isProfiliYamasi, sessizUygulanirMi, type AdimTanimi, type OzetAyari,
} from '../src/shared/kurulum-adimlari.ts';

const IS = ['hosgeldin', 'hesap', 'tanisma', 'isin', 'gunun', 'gorunum', 'ses', 'gizlilik', 'yerel', 'baglantilar', 'izinler', 'ada'];
const G = ['hosgeldin', 'hesap', 'tanisma', 'isin', 'gunun', 'gorunum', 'ses', 'gizlilik', 'yerel', 'baglantilar', 'izinler', 'gelistirici-araclari', 'ada'];

test('İş modunda "Geliştirici araçları" hiçbir kipte yok', () => {
  for (const kip of ['ilk', 'yeniden'] as const) assert.ok(!adimSirasi('is', kip).includes('gelistirici-araclari'));
  for (const s of [0, 1, 2, 3]) assert.ok(!adimSirasi('is', 'yukseltme', s).includes('gelistirici-araclari'));
});

test('"Geliştiriciyim" seçilince bulunulan sayfa kaymaz: İşin\'e kadar ve sonrasında Hazırsın\'a kadar sıra aynı', () => {
  const is = adimSirasi('is', 'ilk'), g = adimSirasi('gelistirici', 'ilk');
  const i = is.indexOf('isin');
  assert.deepEqual(is.slice(0, i + 1), g.slice(0, i + 1));
  assert.deepEqual(g.filter((x) => x !== 'gelistirici-araclari'), is);
  assert.equal(g[g.length - 2], 'gelistirici-araclari');
});

test('çalışma saatleri sessiz saate eşlenir: mesai bitişinden mesai başlangıcına (sabah özeti daha erkense özete) sessiz', () => {
  assert.deepEqual(sessizSaatleri('09:00', '19:00', '08:30'), { sessizBaslangic: '19:00', sessizBitis: '08:30' });
  assert.deepEqual(sessizSaatleri('09:00', '19:00', '10:00'), { sessizBaslangic: '19:00', sessizBitis: '09:00' });
  assert.deepEqual(sessizSaatleri('08:00', '18:30', ''), { sessizBaslangic: '18:30', sessizBitis: '08:00' }, 'özet kapalı');
  assert.equal(sessizSaatleri('25:00', '19:00', ''), null, 'geçersiz saat');
  assert.equal(sessizSaatleri('19:00', '09:00', ''), null, 'bitiş başlangıçtan önce: eşlenmez');
});

test('I1 5b: "Günün" açılış saatleri — ilk kurulumda önerilen; sonra iş profilinden, profilde saat yoksa kayıtlı sessiz saatin tersinden', () => {
  const SESSIZ = { sessizBaslangic: '22:00', sessizBitis: '07:30' };
  assert.deepEqual(gunBaslangici('ilk', undefined, SESSIZ), { bas: '09:00', bit: '18:00', kaynak: 'varsayilan' }, '0.13.1: klasik mesai 09:00–18:00');
  assert.deepEqual(gunBaslangici('yeniden', { rol: 'kurucu', gunBas: '10:00', gunBit: '18:00' }, SESSIZ), { bas: '10:00', bit: '18:00', kaynak: 'profil' });
  // Yükseltme yolu yalnız rol/şirket yazar: saatler kullanıcının sessiz saatinden (22:00–07:30 sessiz → mesai 07:30–22:00).
  assert.deepEqual(gunBaslangici('yeniden', { rol: 'kurucu', sirket: 'Mavi Kuş' }, SESSIZ), { bas: '07:30', bit: '22:00', kaynak: 'sessiz' });
  assert.deepEqual(gunBaslangici('yukseltme', undefined, SESSIZ), { bas: '07:30', bit: '22:00', kaynak: 'sessiz' });
  // Gece yarısını aşmayan sessiz saat mesaiye çevrilemez: önerilen saatler (yazılmaz; bkz. isProfiliYamasi).
  assert.deepEqual(gunBaslangici('yeniden', undefined, { sessizBaslangic: '01:00', sessizBitis: '06:00' }), { bas: '09:00', bit: '18:00', kaynak: 'varsayilan' });
  // Ters çevrilen saatler geri eşlenince aynı sessiz saati verir (sabah özeti sessiz bitişinden sonra).
  const g = gunBaslangici('yeniden', undefined, SESSIZ);
  assert.deepEqual(sessizSaatleri(g.bas, g.bit, '08:30'), SESSIZ);
});

test('I1 5b: "Günün" yalnız uygulanan şeyi söyler — sessiz saate eşlenir mi (ilk kurulum, kayıtlı/türetilmiş saat ya da dokunuldu; gece vardiyası değil)', () => {
  const g = { kip: 'yeniden' as const, kaynak: 'sessiz' as const, dokunuldu: false, gunBas: '07:30', gunBit: '22:00', sabah: '08:30' };
  assert.equal(sessizUygulanirMi({ ...g, kip: 'ilk', kaynak: 'varsayilan' }), true);
  assert.equal(sessizUygulanirMi(g), true, 'sessiz saatten türetilmiş saat: gerçek sessiz saati gösterir');
  assert.equal(sessizUygulanirMi({ ...g, kaynak: 'profil' }), true);
  assert.equal(sessizUygulanirMi({ ...g, kaynak: 'varsayilan' }), false, 'dokunulmamış önerilen saat yazılmaz');
  assert.equal(sessizUygulanirMi({ ...g, kaynak: 'varsayilan', dokunuldu: true }), true);
  assert.equal(sessizUygulanirMi({ ...g, gunBas: '22:00', gunBit: '06:00', dokunuldu: true }), false, 'gece vardiyası sessiz saate eşlenmez');
});

test('I1 5b: yeniden açılan sihirbazın "Bitti"si — saatler YALNIZ kayıtta varsa ya da kullanıcı değiştirdiyse yazılır; değişiklik yoksa hiçbir şey', () => {
  const acilis = { rol: 'kurucu' as const, sirket: 'Mavi Kuş', gunBas: '07:30', gunBit: '22:00' };
  const onceki = { rol: 'kurucu' as const, sirket: 'Mavi Kuş' }; // yükseltme yolu: saat yok
  assert.equal(isProfiliYamasi(onceki, acilis, acilis), null, 'dokunulmadı: sessiz saatler ezilmez');
  assert.deepEqual(isProfiliYamasi(onceki, { ...acilis, rol: 'yonetici' }, acilis), { rol: 'yonetici', sirket: 'Mavi Kuş' }, 'yalnız rol: saat yazılmaz');
  assert.deepEqual(isProfiliYamasi(onceki, { ...acilis, gunBit: '20:00' }, acilis), { rol: 'kurucu', sirket: 'Mavi Kuş', gunBas: '07:30', gunBit: '20:00' }, 'saate dokundu');
  const saatli = { ...onceki, gunBas: '09:00', gunBit: '18:00' };
  const ac2 = { ...acilis, gunBas: '09:00', gunBit: '18:00' };
  assert.deepEqual(isProfiliYamasi(saatli, { ...ac2, sirket: ' Kuzey ' }, ac2), { rol: 'kurucu', sirket: 'Kuzey', gunBas: '09:00', gunBit: '18:00' }, 'kayıttaki saatler korunur');
  assert.equal(isProfiliYamasi(undefined, { rol: 'yonetici', sirket: '', gunBas: '09:00', gunBit: '19:00' }, { rol: 'yonetici', sirket: '', gunBas: '09:00', gunBit: '19:00' }), null, 'profil yok, dokunulmadı: varsayılan yazılmaz');
});

test('G23 bulgu 5: İş → Geliştirici geçişinde (kurulum bitmiş, adım görülmemiş) teklif; öteki geçişlerde yok', () => {
  const m = { motorVar: true } as const;
  assert.equal(araclarTeklifEdilsinMi({ onceki: 'is', yeni: 'gelistirici', kurulumTamam: true, araclarGoruldu: false, ...m }), true);
  assert.equal(araclarTeklifEdilsinMi({ onceki: 'is', yeni: 'gelistirici', kurulumTamam: true, araclarGoruldu: true, ...m }), false);
  assert.equal(araclarTeklifEdilsinMi({ onceki: 'is', yeni: 'gelistirici', kurulumTamam: false, araclarGoruldu: false, ...m }), false, 'ilk kurulumda adım zaten sihirbazda');
  assert.equal(araclarTeklifEdilsinMi({ onceki: 'gelistirici', yeni: 'gelistirici', kurulumTamam: true, araclarGoruldu: false, ...m }), false);
  assert.equal(araclarTeklifEdilsinMi({ onceki: null, yeni: 'gelistirici', kurulumTamam: true, araclarGoruldu: false, ...m }), false, 'açılış geçiş değil');
  assert.equal(araclarTeklifEdilsinMi({ onceki: 'gelistirici', yeni: 'is', kurulumTamam: true, araclarGoruldu: false, ...m }), false);
});

test('0.13 son düzeltme 11: kurulumda Developer seçip bitiren de "Geliştirici araçları" teklifini görür: yeni kurulumda o adım yok', () => {
  const m = { onceki: 'gelistirici', oncekiTamam: false, kurulumTamam: true } as const;
  assert.equal(araclarGecisiMi(m), true, 'kurulum bitti, mod Developer');
  assert.equal(araclarGecisiMi({ ...m, onceki: 'is' }), true, 'oturum ortasında İş → Geliştirici');
  assert.equal(araclarGecisiMi({ ...m, oncekiTamam: true }), false, 'zaten Developer: açılışta ya da başka ayar değişiminde teklif yok');
  assert.equal(araclarGecisiMi({ ...m, kurulumTamam: false }), false, 'kurulum sürüyor');
  assert.equal(araclarGecisiMi({ ...m, oncekiTamam: null }), false, 'ayarlar henüz okunmadı');
  const kabuk = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src/renderer/main.tsx'), 'utf8');
  assert.match(kabuk, /const gecis = araclarGecisiMi\(\{ onceki, oncekiTamam: tamam, kurulumTamam: a\.kurulumTamam \}\);/);
});

test('0.10 Görev 2 (D-2): bulut motoru yokken araçlar teklifi BEKLER (önce motor bağlanır); motor bağlanınca teklif edilir', () => {
  assert.equal(araclarTeklifEdilsinMi({ onceki: 'is', yeni: 'gelistirici', kurulumTamam: true, araclarGoruldu: false, motorVar: false }), false);
  assert.equal(araclarTeklifEdilsinMi({ onceki: 'is', yeni: 'gelistirici', kurulumTamam: true, araclarGoruldu: false, motorVar: true }), true);
});

test('göç: alan yoksa kurulumu bitmiş profil 1, taze/bitmemiş 0; sayı korunur, bozuk değer 0', () => {
  assert.equal(kurulumSurumuGocu({ kurulumTamam: true }), 1);
  assert.equal(kurulumSurumuGocu({ kurulumTamam: false }), 0);
  assert.equal(kurulumSurumuGocu({}), 0);
  assert.equal(kurulumSurumuGocu(null), 0);
  assert.equal(kurulumSurumuGocu({ kurulumTamam: true, kurulumSurumu: 2 }), 2);
  assert.equal(kurulumSurumuGocu({ kurulumTamam: true, kurulumSurumu: -3 }), 0);
  assert.equal(kurulumSurumuGocu({ kurulumTamam: true, kurulumSurumu: '2' }), 1);
});

test('adım ekleme API\'si: yeni bir adım belirtilen adımın hemen arkasına; aynı kimlik ya da olmayan "sonra" hata', () => {
  const yeni: AdimTanimi = { id: 'ornek' as AdimTanimi['id'], ad: 'Örnek', mod: 'gelistirici', yukseltme: 5 };
  const l = adimEkle(KURULUM_ADIMLARI, yeni, 'gelistirici-araclari');
  assert.equal(KURULUM_ADIMLARI.length, 13, 'özgün liste değişmez');
  const g = adimSirasi('gelistirici', 'ilk', 0, l);
  assert.deepEqual(g.slice(g.indexOf('gelistirici-araclari'), g.indexOf('gelistirici-araclari') + 3), ['gelistirici-araclari', 'ornek', 'ada']);
  assert.deepEqual(adimSirasi('gelistirici', 'yukseltme', 4, l), ['ornek', 'ada']);
  assert.throws(() => adimEkle(l, yeni, 'baglantilar'), /zaten var/);
  assert.throws(() => adimEkle(KURULUM_ADIMLARI, { ...yeni, id: 'baska' as AdimTanimi['id'] }, 'olmayan'), /adımı yok/);
});

// ── Sol paneldeki seçim özetleri (adimOzeti) ──
const A: OzetAyari = {
  mod: 'is', kullaniciAdi: 'Deniz', hitap: 'Bey', gorunum: { tema: 'koyu' }, ses: { hiz: 1 }, yerel: { gizliMod: false },
  eposta: [], whatsapp: { bagli: false }, yetki: { tarayici: true, bilgisayar: false, dosyaOkuma: true, tamYetki: false },
};

test('adım özeti: ad + hitap, tema, hız, gizlilik, izin sayısı; Hoş geldin ve Hazırsın boş', () => {
  assert.equal(adimOzeti('hosgeldin', A), '');
  assert.equal(adimOzeti('ada', A), '');
  assert.equal(adimOzeti('tanisma', A), 'Deniz Bey');
  assert.equal(adimOzeti('tanisma', { ...A, kullaniciAdi: '', hitap: '' }), '');
  assert.equal(adimOzeti('gorunum', { ...A, gorunum: { tema: 'koyu' } }), 'Koyu');
  assert.equal(adimOzeti('gorunum', { ...A, gorunum: { tema: 'acik' } }), 'Açık');
  assert.equal(adimOzeti('gorunum', { ...A, gorunum: { tema: 'sistem' } }), 'Otomatik');
  assert.equal(adimOzeti('ses', A), 'Normal hız');
  assert.equal(adimOzeti('ses', { ...A, ses: { hiz: 1.1 } }), 'Hızlı');
  assert.equal(adimOzeti('gizlilik', A), 'Normal');
  assert.equal(adimOzeti('gizlilik', { ...A, yerel: { gizliMod: true } }), 'Gizli mod');
  assert.equal(adimOzeti('izinler', A), '2 izin açık');
  assert.equal(adimOzeti('izinler', { ...A, yetki: { tarayici: true, bilgisayar: true, dosyaOkuma: true, tamYetki: true } }), 'Tam yetki');
});

test('adım özeti: hesap (e-posta kısaltılır, onay bekliyor, sonra), iş, gün, bağlantılar, cihazdaki yapay zekâ, araçlar', () => {
  assert.equal(adimOzeti('hesap', { ...A, hesap: { eposta: 'deniz@ornek.com', durum: 'aktif' } }), 'deniz@ornek.com');
  assert.equal(adimOzeti('hesap', { ...A, hesap: { eposta: 'deniz.yilmaz.uzun.adres@ornekholding.com.tr', durum: 'aktif' } }), 'deniz.yilmaz.uzun.adres@ornek…');
  assert.equal(adimOzeti('hesap', { ...A, hesap: { eposta: 'deniz@ornek.com', durum: 'bekliyor' } }), 'Onay bekliyor');
  assert.equal(adimOzeti('hesap', A, { hesapsiz: true }), 'Sonra');
  assert.equal(adimOzeti('hesap', A), '');
  assert.equal(adimOzeti('isin', A, { rol: 'kurucu', sirket: 'Mavi Kuş' }), 'Kurucu · Mavi Kuş');
  assert.equal(adimOzeti('isin', A, { rol: 'ekip-lideri' }), 'Ekip lideri');
  assert.equal(adimOzeti('isin', { ...A, mod: 'gelistirici' }, { rol: 'gelistirici' }), 'Geliştirici');
  assert.equal(adimOzeti('gunun', A, { gunBas: '09:00', gunBit: '19:00', sabah: '08:30' }), '09:00–19:00 · özet 08:30');
  assert.equal(adimOzeti('gunun', A, { gunBas: '09:00', gunBit: '19:00', sabah: '' }), '09:00–19:00 · özet kapalı');
  // Saat aralığı yarım çizgiyle (U+2013), uzun çizgi (U+2014) değil — haritada ve hafıza kaydında.
  const aralik = `${adimOzeti('gunun', A, { gunBas: '09:00', gunBit: '19:00', sabah: '08:30' })} ${isProfiliMetni({ gunBas: '09:00', gunBit: '19:00' })}`;
  assert.match(aralik, /09:00–19:00/);
  assert.doesNotMatch(aralik, /—/);
  assert.match(isProfiliMetni({ gunBas: '09:00', gunBit: '19:00' }), /dışında yalnız hatırlatıcılar/, 'hafıza kaydı sessiz saatin gerçeğini söyler');
  assert.equal(adimOzeti('baglantilar', A), 'Sonra');
  assert.equal(adimOzeti('baglantilar', { ...A, eposta: [{ parolaVar: true }], whatsapp: { bagli: true } }), '1 e-posta · WhatsApp');
  assert.equal(adimOzeti('baglantilar', { ...A, eposta: [{ parolaVar: true }, { parolaVar: false }] }), '1 e-posta');
  assert.equal(adimOzeti('yerel', A, { yerel: 'hayir' }), 'Sonra');
  assert.equal(adimOzeti('yerel', A, { yerel: 'evet', yerelHal: 'iniyor' }), 'İniyor');
  assert.equal(adimOzeti('yerel', A, { yerelHal: 'kurulu' }), 'Hazır');
  assert.equal(adimOzeti('yerel', A, { yerelHal: 'uygun-degil' }), 'Bu bilgisayara uymuyor');
  assert.equal(adimOzeti('yerel', A, { yerel: 'evet' }), 'İstiyorum');
  assert.equal(adimOzeti('gelistirici-araclari', A, { araclar: 'hepsi', aracSayisi: 9 }), '9 araç');
  assert.equal(adimOzeti('gelistirici-araclari', A, { araclar: 'sonra' }), 'Sonra');
  // Rol adları tek kaynaktan; "Geliştiriciyim" sayfada, özette "Geliştirici".
  assert.deepEqual(ROL_ADLARI.map(([r]) => r), ['kurucu', 'yonetici', 'ekip-lideri', 'gelistirici', 'diger']);
});

test('adım özetlerinde İş dili yok (beyin, model, API, sağlayıcı adı)', () => {
  const s = { rol: 'yonetici' as const, sirket: 'Acme', gunBas: '09:00', gunBit: '19:00', sabah: '08:30', yerel: 'evet' as const, hesapsiz: true };
  for (const t of KURULUM_ADIMLARI) {
    const o = `${t.ad} ${adimOzeti(t.id, A, s)}`;
    assert.doesNotMatch(o, /beyin|\bmodel|\bAPI\b|anahtar|Bonsai|Claude(?! Code)|OpenAI|ElevenLabs|3B|üç boyut/i, t.id);
  }
});
