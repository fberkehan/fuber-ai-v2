// Motor durumu — TEK kaynak (0.10 Görev 2, D2; R16): yedi hâl, tek bildirim, kesin metinler, P3 göçü. Kokpit kartı, sohbet şeridi,
// ada, başlık hapı ve sohbet hata metinleri bunu okur (src/shared/motor-durumu.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  motorGorunumu, motorBildirimi, motorCalistiGocu, kopmaSayilirMi, adaMotoru, gonderimAcikMi, motorHapiVarMi, motorEngelliMi, MOTOR_YER_TUTUCU,
  MOTOR_GORUNUMLERI, motorCipEylemi, yapayZekaSatiri, motorsuzAcilanlar, yalnizYerelSecili, type MotorGorunumu,
} from '../src/shared/motor-durumu.ts';
import { HESAP_DURUM_METNI } from '../src/shared/masaustu-hesap.ts';
import { isDiliIhlali } from '../src/shared/is-dili.ts';
import { hazirDurumu } from '../src/shared/kurulum-yerel.ts';
import { adaHaliBul, type AdaDurumu } from '../src/shared/ada.ts';
import { gorunenMotorHatasi, motorEtiketi, motorHataMetni, sohbetSeridi } from '../src/shared/abonelik.ts';
import { bolgeKapaliNedeni, type KapaliGirdisi } from '../src/shared/beyin.ts';

test('dört temel hâl (P3: hiç bağlanmamış "bağlı değil", çalışmış ve kopmuş "durdu")', () => {
  assert.equal(motorGorunumu({ bulut: 1, yerel: false }, false), 'hazir');
  assert.equal(motorGorunumu({ bulut: 0, yerel: true }, true), 'yerel');
  assert.equal(motorGorunumu({ bulut: 0, yerel: false }, false), 'bagli-degil');
  assert.equal(motorGorunumu({ bulut: 0, yerel: false }, true), 'durdu');
});

test('hesap hâlleri: bulut motoru Fuber hesabından gelecekken hesabın hâli öne geçer; kendi anahtarı hazırsa "hazır"', () => {
  assert.equal(motorGorunumu({ bulut: 0, yerel: false }, false, 'bekliyor'), 'hesap-bekliyor');
  assert.equal(motorGorunumu({ bulut: 0, yerel: false }, true, 'kapali'), 'hesap-kapali');
  assert.equal(motorGorunumu({ bulut: 0, yerel: false }, true, 'kredi-bitti'), 'kredi-bitti');
  // Yerel model gündelik sohbeti yanıtlasa da kullanıcıya hesabın gerçek hâli söylenir (gönderim ayrıca açık: gonderimAcikMi).
  assert.equal(motorGorunumu({ bulut: 0, yerel: true }, true, 'bekliyor'), 'hesap-bekliyor');
  // Geliştiricinin kendi anahtarı bağlıyken hesap beklese de motor hazır.
  assert.equal(motorGorunumu({ bulut: 1, yerel: false }, true, 'bekliyor'), 'hazir');
  // Aktif hesap (ya da hesap yok) eski kurala düşer.
  assert.equal(motorGorunumu({ bulut: 0, yerel: false }, true, 'aktif'), 'durdu');
  assert.equal(motorGorunumu({ bulut: 0, yerel: false }, false, null), 'bagli-degil');
  // F1 (Ö2): sekizinci hâl 'hazirlaniyor' — yalnız Gizli modda, bu bilgisayardaki yapay zekâ hazırlanırken (nötr).
  // H3c düzeltme turu 1 (P14 K1): dokuzuncu hâl 'yerel-hazir-degil' — "Yalnız bu bilgisayar" seçili, yerel ne hazır ne hazırlanıyor.
  assert.deepEqual([...MOTOR_GORUNUMLERI].sort(), ['bagli-degil', 'durdu', 'hazir', 'hazirlaniyor', 'hesap-bekliyor', 'hesap-kapali', 'kredi-bitti', 'yerel', 'yerel-hazir-degil']);
});

test('bağlı değil nötr, durdu kırmızı, hazır bildirimsiz; hesap: bekliyor sakin nötr, kapalı ve kullanım hakkı kırmızı', () => {
  assert.equal(motorBildirimi('bagli-degil', 'is')!.seviye, 'notr');
  assert.equal(motorBildirimi('durdu', 'is')!.seviye, 'kirmizi');
  assert.equal(motorBildirimi('hazir', 'is'), null);
  assert.equal(motorBildirimi('yerel', 'is')!.seviye, 'sari');
  assert.equal(motorBildirimi('hesap-bekliyor', 'is')!.seviye, 'notr');
  assert.equal(motorBildirimi('hesap-kapali', 'is')!.seviye, 'kirmizi');
  assert.equal(motorBildirimi('kredi-bitti', 'is')!.seviye, 'kirmizi');
});

test('kesin metinler: "Yapay zekâ bağla" (R16), R10 hesap metinleri birebir, durdu düğmesi hesaba göre', () => {
  const b = motorBildirimi('bagli-degil', 'is')!;
  assert.equal(b.baslik, 'Yapay zekâ bağla');
  assert.equal(b.metin, 'Sohbet, sesli yanıt ve hatırlatıcılar bir yapay zekâ bağlayınca açılır. Gündem ve hava şimdiden burada.');
  assert.equal(b.dugme, 'Yapay zekâ bağla');
  assert.equal(b.eylem, 'hesap');
  assert.equal(b.kisa, 'Yapay zekâ bağlı değil');
  assert.equal(b.ikincil, undefined, 'Kendi anahtarımla bağla yok');
  const g = motorBildirimi('bagli-degil', 'gelistirici')!;
  assert.equal(g.kisa, 'Motor bağlı değil');
  assert.equal(g.ikincil, undefined, '0.13 T15: Geliştirici de kendi anahtarını bağlamaz');
  const d = motorBildirimi('durdu', 'is')!;
  assert.equal(d.baslik, 'Yapay zekâ bağlantısı koptu');
  assert.equal(d.metin, 'Verilerin yerinde. Bağlantıyı yenileyince sohbet ve hatırlatıcılar yeniden açılır.');
  assert.equal(d.kisa, 'Bağlantı koptu');
  assert.equal(d.dugme, 'Yapay zekâ bağla');
  assert.equal(motorBildirimi('durdu', 'gelistirici')!.kisa, 'Motor durdu');
  const dAktif = motorBildirimi('durdu', 'is', 'aktif')!;
  assert.equal(dAktif.dugme, 'Yeniden dene');
  assert.equal(dAktif.eylem, 'yeniden-dene');
  assert.equal(motorBildirimi('hesap-bekliyor', 'is')!.metin, HESAP_DURUM_METNI.bekliyor);
  assert.equal(motorBildirimi('hesap-bekliyor', 'is')!.dugme, undefined, 'onay beklerken yapılacak bir şey yok: düğme yok');
  assert.equal(motorBildirimi('hesap-kapali', 'is')!.metin, HESAP_DURUM_METNI.kapali);
  assert.equal(motorBildirimi('kredi-bitti', 'is')!.metin, HESAP_DURUM_METNI['kredi-bitti']);
  assert.equal(motorBildirimi('yerel', 'is')!.kisa, 'Şimdilik yalnız gündelik sohbet — zor işler için Fuber’in yapay zekâsı gerekir');
  assert.equal(motorBildirimi('yerel', 'gelistirici')!.kisa, 'Yalnız yerel model açık — zor işler için bulut motoru gerekir');
  assert.equal(MOTOR_YER_TUTUCU, 'Fuber bağlanınca yazabilirsin');
});

test('İş bildirimleri İş dilinde (model/anahtar/Faz/önizleme/Stripe yok)', () => {
  for (const g of MOTOR_GORUNUMLERI.filter((x) => x !== 'hazir')) {
    for (const h of [undefined, 'aktif', 'bekliyor'] as const) {
      const b = motorBildirimi(g, 'is', h)!;
      for (const m of [b.baslik, b.metin ?? '', b.kisa, b.dugme ?? '', b.ipucu ?? '']) assert.equal(isDiliIhlali(m), null, `${g}: ${m}`);
    }
  }
});

test('gönderim ve ada: gönderim yalnız hiç motor yokken kapalı; ada yalnız yanıt veremiyorken motor kartını gösterir', () => {
  assert.equal(gonderimAcikMi({ bulut: 0, yerel: true }), true);
  assert.equal(gonderimAcikMi({ bulut: 2, yerel: false }), true);
  assert.equal(gonderimAcikMi({ bulut: 0, yerel: false }), false);
  // Hesap onay beklerken yerel model yanıtlıyorsa ada "yerel" gibi davranır (soru kutusu açılır, hap yok).
  assert.equal(adaMotoru('hesap-bekliyor', { bulut: 0, yerel: true }), 'yerel');
  assert.equal(adaMotoru('hesap-kapali', { bulut: 0, yerel: false }), 'hesap-kapali');
  assert.equal(adaMotoru('hazir', { bulut: 1, yerel: false }), 'hazir');
  const engel: MotorGorunumu[] = ['bagli-degil', 'durdu', 'hazirlaniyor', 'hesap-bekliyor', 'hesap-kapali', 'kredi-bitti', 'yerel-hazir-degil'];
  for (const g of MOTOR_GORUNUMLERI) assert.equal(motorEngelliMi(g), engel.includes(g), g);
  // Boştaki ada hapı yalnız kırmızı hâllerde (bağlı değil ve onay bekliyor sessiz kalır).
  for (const g of MOTOR_GORUNUMLERI) assert.equal(motorHapiVarMi(g), ['durdu', 'hesap-kapali', 'kredi-bitti'].includes(g), g);
});

// ── Düzeltme turu 1 (madde 1): Gizli mod. Sinyal ana süreçten (main/abonelik.ts motorDurumu: tekMotorYolu — Gizli modda bulut 0,
// `gizli` true); kural Gizli modda hesabın hâline bakmaz (hesap kullanılmaz) ve yalnız bu bilgisayardaki yapay zekâyı sayar.
test('Gizli mod: hesap aktif ama yerel hazır değil → "hazır" DEĞİL (gönderim kapalı); yerel hazırsa "yerel"; hesap hâli yok sayılır', () => {
  const yok = { bulut: 0, yerel: false, gizli: true }, yerel = { bulut: 0, yerel: true, gizli: true };
  assert.equal(motorGorunumu(yok, true, 'aktif'), 'durdu');
  assert.equal(motorGorunumu(yok, false, 'aktif'), 'durdu', 'Gizli mod açık ve hiçbir şey yanıtlamıyor: "bağlı değil" değil');
  assert.equal(motorGorunumu(yok, false, null), 'durdu');
  assert.equal(gonderimAcikMi(yok), false);
  assert.equal(motorGorunumu(yerel, true, 'aktif'), 'yerel', 'Fuber hazır kartı (hatırlatıcı kurar…) çizilmez: araçsız yerel model');
  for (const h of ['kredi-bitti', 'kapali', 'bekliyor'] as const) assert.equal(motorGorunumu(yerel, true, h), 'yerel', `${h}: hesap Gizli modda kullanılmıyor`);
  // Savunma: Gizli modda bulut sayısı ne olursa olsun bulut yolu yoktur (shared/tek-motor.ts).
  assert.equal(motorGorunumu({ bulut: 2, yerel: true, gizli: true }, true, 'aktif'), 'yerel');
  assert.equal(motorGorunumu({ bulut: 2, yerel: false, gizli: true }, true, 'aktif'), 'durdu');
  // Gizli kapalıyken eski kural.
  assert.equal(motorGorunumu({ bulut: 0, yerel: true, gizli: false }, true, 'kredi-bitti'), 'kredi-bitti');
});

test('Gizli mod bildirimleri: yerel hazırsa sakin not, "Giriş yap" yok; hazır değilse kırmızı + "Gizlilik ayarları" (çapa gizli-mod)', () => {
  for (const mod of ['is', 'gelistirici'] as const) {
    const y = motorBildirimi('yerel', mod, null, true)!;
    assert.equal(y.seviye, 'notr', mod);
    assert.equal(y.dugme, undefined, `${mod}: Gizli modda giriş yapmak bir şey açmaz`);
    assert.equal(y.ikincil, undefined, `${mod}: "Kendi anahtarımla bağla" Gizli modda bir şey açmaz`);
    assert.match(y.baslik, /^Gizli mod açık/);
    const d = motorBildirimi('durdu', mod, 'aktif', true)!;
    assert.deepEqual([d.seviye, d.dugme, d.cipa, d.eylem, d.ikincil], ['kirmizi', 'Gizlilik ayarları', 'gizli-mod', undefined, undefined], mod);
    assert.equal(d.baslik, 'Gizli modda yapay zekâ hazır değil');
    assert.doesNotMatch(`${d.baslik} ${d.metin} ${d.kisa}`, /koptu|giriş yap/i, mod);
  }
  assert.equal(motorBildirimi('durdu', 'is', 'aktif', true)!.kisa, 'Gizli mod hazır değil');
  for (const g of ['yerel', 'durdu'] as const) {
    const b = motorBildirimi(g, 'is', 'aktif', true)!;
    for (const m of [b.baslik, b.metin ?? '', b.kisa, b.dugme ?? '', b.ipucu ?? '']) assert.equal(isDiliIhlali(m), null, `${g}: ${m}`);
  }
});

// ── F1 (son inceleme Ö2): Gizli mod hazırlanırken (bekleyen kurulum hatasız ya da indirme sürüyor; ana süreç sinyalinin `hazirlaniyor`u)
// "hazır değil" kırmızısı yok — K4 "hazır olana kadar Gizli mod 'hazırlanıyor' der", D2 "kırmızı yalnız çalışan bir şey koptuysa". ──
const HAZIRLANIYOR = { bulut: 0, yerel: false, gizli: true, hazirlaniyor: true };
test('Ö2: Gizli + yerel hazır değil + hazırlanıyor → "hazirlaniyor" (kırmızı "durdu" değil); bitince sessizce "yerel"', () => {
  for (const h of [null, 'aktif', 'bekliyor', 'kapali', 'kredi-bitti'] as const) {
    for (const calisti of [false, true]) assert.equal(motorGorunumu(HAZIRLANIYOR, calisti, h), 'hazirlaniyor', `${h} ${calisti}`);
  }
  assert.equal(motorGorunumu({ ...HAZIRLANIYOR, yerel: true }, true, 'aktif'), 'yerel', 'hazırlık bitti: normal "yerel" hâli');
  assert.equal(motorGorunumu({ ...HAZIRLANIYOR, hazirlaniyor: false }, true, 'aktif'), 'durdu', 'hazırlanmıyor ve hazır değil: kırmızı kalır');
  assert.equal(motorGorunumu({ ...HAZIRLANIYOR, bulut: 2 }, true, 'aktif'), 'hazirlaniyor', 'Gizli modda bulut sayılmaz');
  // Gizli kapalıyken iniş motor hâlini değiştirmez (Normal modda yerel indirme yanıt yolu değildir).
  assert.equal(motorGorunumu({ bulut: 0, yerel: false, gizli: false, hazirlaniyor: true }, false, null), 'bagli-degil');
  assert.equal(motorGorunumu({ bulut: 1, yerel: false, gizli: false, hazirlaniyor: true }, false, null), 'hazir');
  assert.equal(gonderimAcikMi(HAZIRLANIYOR), false, 'sohbet girişi kapalı');
  assert.equal(motorEngelliMi('hazirlaniyor'), true);
});

test('Ö2: "hazirlaniyor" nötr ve düğmesiz; metin sihirbazın Hazırsın satırıyla AYNI kaynaktan (hazirDurumu); hap ve ada kartı yok', () => {
  for (const mod of ['is', 'gelistirici'] as const) {
    const b = motorBildirimi('hazirlaniyor', mod, 'aktif', true)!;
    assert.equal(b.seviye, 'notr', mod);
    assert.equal(b.baslik, hazirDurumu({ mod, gorunum: 'hazirlaniyor', gizliMod: true, yerelHazir: false, yerelIniyor: true, yerelIstendi: true }), `${mod}: çift metin yok`);
    // Düzeltme turu 1 (A): düğme YOK ama çapa Gizlilik — motor gerektiren kokpit çipleri Fuber hesabı penceresini değil Gizlilik'i açar.
    assert.deepEqual([b.dugme, b.eylem, b.cipa, b.ikincil, b.metin], [undefined, undefined, 'gizli-mod', undefined, undefined], mod);
    assert.equal(b.kisa, 'Gizli mod hazırlanıyor');
    // K-6: ipucu Gizli'nin yapamayacağı işi vaat etmez (araçlar Gizli'de hazır olunca da yok).
    assert.equal(b.ipucu, 'Gizli mod hazır olunca gündelik sohbet açılır', mod);
    assert.deepEqual(motorBildirimi('hazirlaniyor', mod, null, false), b, `${mod}: hâl yalnız Gizli'de doğar; bayrak verilmese de aynı`);
    for (const m of [b.baslik, b.kisa, b.ipucu ?? '']) assert.doesNotMatch(m, /hazır değil|koptu|giriş yap/i, mod);
  }
  assert.equal(motorBildirimi('hazirlaniyor', 'is', null, true)!.baslik, 'Gizli mod hazırlanıyor — bu bilgisayardaki yapay zekâ iniyor; inince sohbet açılır.');
  assert.equal(motorBildirimi('hazirlaniyor', 'gelistirici', null, true)!.baslik, 'Gizli mod hazırlanıyor — yerel model iniyor; inince sohbet açılır.');
  const b = motorBildirimi('hazirlaniyor', 'is', 'aktif', true)!;
  for (const m of [b.baslik, b.kisa, b.ipucu ?? '']) assert.equal(isDiliIhlali(m), null, m);
  // Ada: boştayken hap yok ve oturumun ilk kartı inmez (yalnız kırmızı hâllerde).
  assert.equal(motorHapiVarMi('hazirlaniyor'), false);
  const ada: AdaDurumu = { hal: 'bos', onaySayisi: 0, bildirimVar: false, kartAcik: false, yanitVar: false, sorAcik: false, ekranda: false, motor: adaMotoru('hazirlaniyor', HAZIRLANIYOR), motorKartAcik: true };
  assert.equal(adaHaliBul(ada), 'dinlenme'); // 0.14 T19 (R13): boştaki çentik dinlenme hâlidir
  // Sohbet şeridi: nötr, düğmesiz, gönderim kapalı.
  const s = sohbetSeridi('is', HAZIRLANIYOR, 'hazirlaniyor', 'aktif', true)!;
  assert.deepEqual([s.seviye, s.baslik, s.dugmeler.length, s.gonderimKapali], ['notr', b.baslik, 0, true]);
  // Ayarlar → Hesap üst satırı ve kokpit başlık hapı.
  assert.deepEqual(yapayZekaSatiri('hazirlaniyor', 'is', 'aktif', true), { durum: 'Gizli mod hazırlanıyor' });
  assert.deepEqual(yapayZekaSatiri('hazirlaniyor', 'gelistirici', null, true), { durum: 'Gizli mod hazırlanıyor' });
  assert.equal(motorEtiketi('hazirlaniyor', 'is', 0, true), null, 'İş: tek bildirim kokpit kartında (R28b)');
  assert.deepEqual(motorEtiketi('hazirlaniyor', 'gelistirici', 0, true), { hap: 'gizli mod · yerel model iniyor', nokta: 'gri' });
  // Etkinlik: Akıl bölgesinin nedeni aynı nötr cümle ("hazır değil" değil).
  const ak: KapaliGirdisi = { mod: 'is', mikrofonKapali: false, uyandirma: true, seslendirme: true, gunKaydi: true, eslikciKapali: false, bilgisayar: true, tarayici: true, iletisimVar: true, kopruCalisiyor: true, motor: 'hazirlaniyor', gizli: true, claudeCodeEtkin: false, claudeBulundu: false };
  assert.equal(bolgeKapaliNedeni('ajan', ak), b.baslik);
  assert.equal(bolgeKapaliNedeni('ajan', { ...ak, mod: 'gelistirici' }), motorBildirimi('hazirlaniyor', 'gelistirici')!.baslik);
});

// Düzeltme turu 1 (K-1): indirme DURAKLAMIŞKEN (bekleyen kayıt var, hiçbir şey inmiyor — uygulama indirme sürerken kapanmıştı) satır
// "iniyor; inince sohbet açılır" demez: sinyalin `yarim`ı → Hazırsın'ın tek dalı (aynı kaynak).
test('K-1: hazırlık duraklamışsa (yarım) nötr satır "indirme yarıda kaldı; sürdürünce sohbet açılır" der — metin hazirDurumu\'ndan', () => {
  const YARIM = 'Gizli mod hazırlanıyor — indirme yarıda kaldı; sürdürünce sohbet açılır.';
  for (const mod of ['is', 'gelistirici'] as const) {
    const b = motorBildirimi('hazirlaniyor', mod, null, true, true)!;
    assert.equal(b.baslik, YARIM, mod);
    assert.equal(b.baslik, hazirDurumu({ mod, gorunum: 'hazirlaniyor', gizliMod: true, yerelHazir: false, yerelIniyor: false, yerelIstendi: true, yerelYarim: true }));
    assert.deepEqual([b.seviye, b.dugme, b.cipa], ['notr', undefined, 'gizli-mod'], mod);
    assert.doesNotMatch(b.baslik, /iniyor/, mod);
  }
  assert.equal(isDiliIhlali(YARIM), null);
  // Sohbet şeridi ve Etkinlik aynı satırı sinyalden okur.
  const s = sohbetSeridi('is', { ...HAZIRLANIYOR, yarim: true }, 'hazirlaniyor', null, true)!;
  assert.equal(s.baslik, YARIM);
  const ak: KapaliGirdisi = { mod: 'is', mikrofonKapali: false, uyandirma: true, seslendirme: true, gunKaydi: true, eslikciKapali: false, bilgisayar: true, tarayici: true, iletisimVar: true, kopruCalisiyor: true, motor: 'hazirlaniyor', gizli: true, yarim: true, claudeCodeEtkin: false, claudeBulundu: false };
  assert.equal(bolgeKapaliNedeni('ajan', ak), YARIM);
  // İndirme sürüyorsa eski cümle.
  assert.match(motorBildirimi('hazirlaniyor', 'is', null, true, false)!.baslik, /iniyor; inince sohbet açılır\.$/);
});

// Düzeltme turu 1 (K-6): motor yokken kokpitin "Fuber’le neler yapabilirsin" listesi Gizli'de Gizli'nin yapamayacağı işleri (hatırlatıcı,
// e-posta, planlama) vaat etmez — tek satır.
test('K-6: motorsuz "neler yapabilirsin" listesi Gizli\'de tek satır; Gizli kapalıyken dört satır (hesapla açılanlar)', () => {
  assert.deepEqual(motorsuzAcilanlar(true), [['sohbet', 'Gizli modda gündelik sohbet; yanıtlar bu bilgisayarda']]);
  const normal = motorsuzAcilanlar(false);
  assert.deepEqual(normal.map(([, m]) => m), ['Sohbet ve sesli yanıt', 'Hatırlatıcı kurma ve takip', 'E-postalarını tarama ve özetleme', 'Gününü ve haftanı planlama']);
  for (const [, m] of [...motorsuzAcilanlar(true), ...normal]) assert.equal(isDiliIhlali(m), null, m);
});

test('"Yeniden dene" gerçekten ulaşılabilir: hesap aktif ama ana süreç hesabın anahtarını kullanamıyor (sinyalde bulut 0)', () => {
  // main/hesap.ts motorKaynagi: hesap aktif olsa da cihaz anahtarı yoksa/okunamıyorsa motor yok → sinyal bulut 0 (tests/motor-sinyali-ana.test.ts).
  const g = motorGorunumu({ bulut: 0, yerel: false }, true, 'aktif');
  assert.equal(g, 'durdu');
  assert.equal(motorGorunumu({ bulut: 0, yerel: false }, false, 'aktif'), 'durdu', 'hiç çalışmamış olsa da giriş yapmış kullanıcıya "giriş yap" denmez');
  assert.equal(motorGorunumu({ bulut: 0, yerel: true }, false, 'aktif'), 'yerel');
  assert.deepEqual([motorBildirimi(g, 'is', 'aktif')!.dugme, motorBildirimi(g, 'is', 'aktif')!.eylem], ['Yeniden dene', 'yeniden-dene']);
});

test('motor gerektiren kokpit çipleri bildirimin kendi yolunu izler: İş hesap penceresi, Geliştirici Motorlar, Gizli modda Gizlilik', () => {
  assert.deepEqual(motorCipEylemi(motorBildirimi('bagli-degil', 'is')!, 'is'), { eylem: 'hesap' });
  assert.deepEqual(motorCipEylemi(motorBildirimi('bagli-degil', 'gelistirici')!, 'gelistirici'), { eylem: 'hesap' });
  assert.deepEqual(motorCipEylemi(motorBildirimi('durdu', 'gelistirici', 'aktif')!, 'gelistirici'), { eylem: 'yeniden-dene' });
  assert.deepEqual(motorCipEylemi(motorBildirimi('durdu', 'is', 'aktif', true)!, 'is'), { cipa: 'gizli-mod' });
  assert.deepEqual(motorCipEylemi(motorBildirimi('durdu', 'gelistirici', 'aktif', true)!, 'gelistirici'), { cipa: 'gizli-mod' });
  // Düzeltme turu 1 (A): Gizli hazırlanırken de çipler Gizlilik'e gider (Fuber hesabı penceresine değil; Gizli'de hesap kullanılmaz).
  assert.deepEqual(motorCipEylemi(motorBildirimi('hazirlaniyor', 'is', null, true)!, 'is'), { cipa: 'gizli-mod' });
  assert.deepEqual(motorCipEylemi(motorBildirimi('hazirlaniyor', 'gelistirici', null, true)!, 'gelistirici'), { cipa: 'gizli-mod' });
  assert.deepEqual(motorCipEylemi(motorBildirimi('hesap-bekliyor', 'is', 'bekliyor')!, 'is'), { eylem: 'hesap' }, 'düğmesiz hâl: hesabın hâlini gösteren pencere');
  assert.deepEqual(motorCipEylemi(motorBildirimi('kredi-bitti', 'is', 'kredi-bitti')!, 'is'), { eylem: 'hesap' });
});

test('Ayarlar → Hesap üst satırı (madde 2): hâl hesabın gerçek durumunu söyler; giriş yapmış kullanıcıya "giriş yap" denmez', () => {
  assert.deepEqual(yapayZekaSatiri('hazir', 'is', 'aktif'), { durum: 'bağlı' });
  assert.deepEqual(yapayZekaSatiri('bagli-degil', 'is', null), { durum: 'bağlı değil', dugme: { etiket: 'Yapay zekâ bağla', eylem: 'hesap' } });
  assert.deepEqual(yapayZekaSatiri('hesap-bekliyor', 'is', 'bekliyor'), { durum: 'hesabın onay bekliyor' });
  assert.deepEqual(yapayZekaSatiri('yerel', 'gelistirici', null), { durum: 'yalnız yerel model', dugme: { etiket: 'Yapay zekâ bağla', eylem: 'hesap' } });
  assert.deepEqual(yapayZekaSatiri('hesap-kapali', 'is', 'kapali'), { durum: 'erişim kapalı', dugme: { etiket: 'Hesabı gör', eylem: 'hesap' } });
  assert.deepEqual(yapayZekaSatiri('kredi-bitti', 'is', 'kredi-bitti'), { durum: 'kullanım hakkın doldu', dugme: { etiket: 'Hesabı gör', eylem: 'hesap' } });
  assert.deepEqual(yapayZekaSatiri('durdu', 'is', 'aktif'), { durum: 'bağlantı koptu', dugme: { etiket: 'Yeniden dene', eylem: 'yeniden-dene' } });
  assert.deepEqual(yapayZekaSatiri('durdu', 'is', 'aktif', true), { durum: 'Gizli modda hazır değil', dugme: { etiket: 'Gizlilik ayarları', cipa: 'gizli-mod' } });
  assert.deepEqual(yapayZekaSatiri('yerel', 'is', 'aktif', true), { durum: 'Gizli mod açık · yalnız bu bilgisayarda' });
  assert.deepEqual(yapayZekaSatiri('yerel', 'is', null), { durum: 'yalnız gündelik sohbet', dugme: { etiket: 'Yapay zekâ bağla', eylem: 'hesap' } });
  assert.deepEqual(yapayZekaSatiri('yerel', 'is', 'aktif'), { durum: 'yalnız gündelik sohbet' });
  // Hesap aktifken ulaşılabilen her hâl (sinyal × Gizli × P3): "giriş yap" yok; metinler İş dilinde.
  for (const bulut of [0, 1]) for (const yerel of [false, true]) for (const gizli of [false, true]) for (const calisti of [false, true]) {
    const g = motorGorunumu({ bulut: gizli ? 0 : bulut, yerel, gizli }, calisti, 'aktif');
    const s = yapayZekaSatiri(g, 'is', 'aktif', gizli);
    assert.equal(isDiliIhlali(`${s.durum} ${s.dugme?.etiket ?? ''}`), null, g);
    assert.doesNotMatch(s.dugme?.etiket ?? '', /giriş yap/i, `${g}: hesap aktifken "giriş yap" yok`);
  }
  for (const g of MOTOR_GORUNUMLERI) assert.equal(isDiliIhlali(yapayZekaSatiri(g, 'is', null).durum), null, g);
});


test('P3 göçü (Review Focus 1): ham dosyada boolean varsa o, yoksa kayıtlı anahtar var mı', () => {
  assert.equal(motorCalistiGocu(undefined, true), true);
  assert.equal(motorCalistiGocu(undefined, false), false);
  assert.equal(motorCalistiGocu(false, true), false);
  assert.equal(motorCalistiGocu(true, false), true);
  assert.equal(motorCalistiGocu('evet', false), false, 'bozuk değer → anahtara göre');
});

// ── 0.11 G8 düzeltme turu 1 (K2): MotorSinyali.yalnizYerel — kullanılmayan bulut hesabı yerel yolu ezmez, "bulut motoru gerekir" notu yok ──
// Eklenen alan isteğe bağlı: eksik/false iken BÜTÜN mevcut satırlar bayt bayt aynıdır (aşağıdaki ızgara eski sonucu yeniden hesaplamaz,
// alan YOKKEN ve false iken aynı olduğunu karşılaştırır; eski beklentiler yukarıdaki testlerde değişmedi).
const HESAP_HALLERI = [undefined, null, 'aktif', 'bekliyor', 'kapali', 'kredi-bitti'] as const;

test('K2: motorGorunumu — yalnizYerel açıkken (yerel yolda) hesap hâli ne olursa olsun "yerel"; öteki bütün girdilerde alan hiçbir şeyi değiştirmez', () => {
  for (const h of HESAP_HALLERI) {
    for (const mc of [false, true]) {
      assert.equal(motorGorunumu({ bulut: 0, yerel: true, yalnizYerel: true }, mc, h), 'yerel', `yalnızYerel hesap=${h} calisti=${mc}`);
      // Aynı sinyalde alan yoksa bugünkü kural: hesap hâlleri yerelin önüne geçer.
      if (h && h !== 'aktif') assert.notEqual(motorGorunumu({ bulut: 0, yerel: true }, mc, h), 'yerel', `eski kural hesap=${h}`);
    }
  }
  // Izgara: alan eksik / false / (yerel değilken) true → SONUÇ AYNI (bayt bayt).
  for (const bulut of [0, 1, 2]) for (const yerel of [false, true]) for (const gizli of [undefined, false, true]) for (const hazirlaniyor of [undefined, false, true]) {
    for (const h of HESAP_HALLERI) for (const mc of [false, true]) {
      const temel = { bulut, yerel, gizli, hazirlaniyor };
      const eski = motorGorunumu(temel, mc, h);
      assert.equal(motorGorunumu({ ...temel, yalnizYerel: false }, mc, h), eski, JSON.stringify({ temel, h, mc, f: false }));
      if (!yerel) assert.equal(motorGorunumu({ ...temel, yalnizYerel: true }, mc, h), eski, JSON.stringify({ temel, h, mc, t: 'yerel değil' }));
      if (gizli) assert.equal(motorGorunumu({ ...temel, yalnizYerel: true }, mc, h), eski, JSON.stringify({ temel, h, mc, t: 'Gizli önce' }));
    }
  }
  // Gönderim ve ada: yerel yanıtladığı için açık; bu hâl "engel" sayılmaz.
  assert.equal(gonderimAcikMi({ bulut: 0, yerel: true, yalnizYerel: true }), true);
  assert.equal(motorEngelliMi('yerel'), false);
});

test('K2: motorBildirimi("yerel", yalnizYerel) — nötr ve dürüst; "bulut motoru gerekir" ve sarı not yok; alan yoksa eski sarı not AYNEN', () => {
  const eski = motorBildirimi('yerel', 'gelistirici', null);
  assert.equal(eski?.seviye, 'sari', 'bugünkü not');
  assert.equal(eski?.baslik, 'Yalnız yerel model açık — zor işler için bulut motoru gerekir');
  assert.deepEqual(motorBildirimi('yerel', 'gelistirici', null, false, false, false), eski, 'false = alan yok');
  for (const h of [undefined, null, 'aktif'] as const) {
    const b = motorBildirimi('yerel', 'gelistirici', h, false, false, true)!;
    assert.equal(b.seviye, 'notr');
    assert.equal(b.baslik, 'Yalnız bu bilgisayardaki yapay zekâ açık');
    assert.equal(b.metin, 'Bu bilgisayardaki yapay zekâ en iyi yazma, özetleme, çeviri ve hatırlamada çalışır; hatırlatıcılar onayınla kurulur, e-posta ve ekran kullanılamaz.');
    assert.equal(b.kisa, 'Yalnız yerel yapay zekâ');
    assert.equal(b.dugme, undefined, 'hesaba/anahtara götüren düğme yok');
    assert.equal(b.ikincil, undefined);
    assert.doesNotMatch(JSON.stringify(b), /bulut motoru|zor işler|Giriş yap|Kendi anahtarımla/);
    assert.doesNotMatch(JSON.stringify(b), /'/, 'düz kesme işareti yok');
  }
  // Gizli kendi dalına gider: yalnızYerel parametresi Gizli bildirimini değiştirmez.
  assert.deepEqual(motorBildirimi('yerel', 'gelistirici', null, true, false, true), motorBildirimi('yerel', 'gelistirici', null, true));
});

test('K2: şerit, hap ve üst satır — yalnız yerel açıkken kırmızı "kullanım hakkın doldu" ya da sarı not yok; araç yok notu görünür', () => {
  for (const h of ['bekliyor', 'kapali', 'kredi-bitti'] as const) {
    const sinyal = { bulut: 0, yerel: true, yalnizYerel: true };
    const g = motorGorunumu(sinyal, true, h);
    assert.equal(g, 'yerel', h);
    const s = sohbetSeridi('gelistirici', sinyal, g, h)!;
    assert.deepEqual([s.seviye, s.tur, s.baslik, s.dugmeler.length, s.gonderimKapali], ['notr', 'yerel', 'Yalnız bu bilgisayardaki yapay zekâ açık', 0, false], h);
    assert.equal(s.aciklama, 'Bu bilgisayardaki yapay zekâ en iyi yazma, özetleme, çeviri ve hatırlamada çalışır; hatırlatıcılar onayınla kurulur, e-posta ve ekran kullanılamaz.');
    assert.deepEqual(motorEtiketi(g, 'gelistirici', 0, false, true), { hap: 'yalnız yerel · araçsız', ipucu: 'Bu bilgisayardaki yapay zekâ en iyi yazma, özetleme, çeviri ve hatırlamada çalışır; hatırlatıcılar onayınla kurulur, e-posta ve ekran kullanılamaz.', nokta: 'gri' });
    assert.equal(yapayZekaSatiri(g, 'gelistirici', h, false, true).durum, 'yalnız bu bilgisayarda · araçsız');
    assert.equal(yapayZekaSatiri(g, 'gelistirici', h, false, true).dugme, undefined);
  }
  // Alan yoksa bugünkü sarı not, hap ve üst satır AYNEN.
  assert.equal(sohbetSeridi('gelistirici', { bulut: 0, yerel: true }, 'yerel')?.seviye, 'sari');
  assert.deepEqual(motorEtiketi('yerel', 'gelistirici'), { hap: 'yalnız yerel model', ipucu: 'Bulut motoru yok: yerel model yalnız gündelik sohbeti yanıtlar.', nokta: 'turuncu' });
  assert.equal(motorEtiketi('yerel', 'gelistirici', 0, false, false)?.nokta, 'turuncu');
  assert.equal(yapayZekaSatiri('yerel', 'gelistirici', null).durum, 'yalnız yerel model');
  // Gizli: yalnızYerel bayrağı Gizli hâlinin metnini değiştirmez.
  assert.deepEqual(motorEtiketi('yerel', 'gelistirici', 0, true, true), motorEtiketi('yerel', 'gelistirici', 0, true));
  assert.equal(yapayZekaSatiri('yerel', 'gelistirici', null, true, true).durum, yapayZekaSatiri('yerel', 'gelistirici', null, true).durum);
});

test('K2: motorHataMetni("bulut-gerekli", yalnızYerel) — doğru şeyi söyler (Fuber’i seç ya da işi bulutta yap); öteki yollar AYNEN', () => {
  const m = motorHataMetni('bulut-gerekli', 'gelistirici', 'kredi-bitti', false, true);
  // 0.12 H3c: seçim TEK yerde — Ayarlar → Gizlilik → Nerede çalışsın (Yapay zekâ’daki anahtar kalktı).
  assert.equal(m, 'Bu iş araç ister ve “Yalnız bu bilgisayar” seçiliyken araçlar yok. Ayarlar → Gizlilik → Nerede çalışsın’dan bulut yapay zekâyı seç; iş bulut motoruyla yapılır.');
  assert.doesNotMatch(m, /bir motor bağla|giriş yap|kullanım hakkın/, 'bulut hesabının hâli ilgisiz');
  assert.doesNotMatch(m, /'/);
  // Hesap hâli ne olursa olsun aynı cümle (kullanılmayan hesap ilgisiz).
  for (const h of HESAP_HALLERI) assert.equal(motorHataMetni('bulut-gerekli', 'gelistirici', h, false, true), m);
  // 0.12 H3c: İş'te de "Yalnız bu bilgisayar" var — İş dilinde kendi cümlesi (motor/anahtar yok); Gizli ve 'yok' dalları değişmedi.
  const is = motorHataMetni('bulut-gerekli', 'is', null, false, true);
  assert.equal(is, 'Bu iş araç ister; “Yalnız bu bilgisayar” seçiliyken araçlar kapalı. Ayarlar → Gizlilik → Nerede çalışsın’dan bulut yapay zekâyı seçince iş onunla yapılır.');
  assert.equal(isDiliIhlali(is), null);
  assert.equal(gorunenMotorHatasi('anahtar', is, 'is'), is, 'İş için yazılmış ileti olduğu gibi görünür');
  // P14 K1: 'yok' artık "Yalnız bu bilgisayar"ın kendi cümlesi (giriş yapmak önerilmez; T34b: buluttaki yapay zekâ kapalı).
  assert.match(motorHataMetni('yok', 'gelistirici', null, false, true), /buluttaki yapay zekâ kapalı/);
  assert.equal(motorHataMetni('bulut-gerekli', 'gelistirici', null, true, true), motorHataMetni('bulut-gerekli', 'gelistirici', null, true));
  assert.equal(motorHataMetni('bulut-gerekli', 'gelistirici'), 'Bu iş için bulut motoru gerekiyor (yerel model yalnız gündelik sohbeti yanıtlar). Ayarlar → Yapay zekâ’dan kendi anahtarını kaydet.');
  // Bulut motoru VARKEN (varsayılan) cümle yukarıdaki; açıkça true verilse de aynı.
  assert.equal(motorHataMetni('bulut-gerekli', 'gelistirici', null, false, true, true), m);
});

// 0.12 H3a düzeltme turu 1 (kaygı 2): yükseltilmiş, hesabı hiç olmamış ve çevrim dışı kullanıcı (motorCalisti eski sürümden true) kokpitte
// kırmızı "Yapay zekâ bağlantısı koptu" GÖRMEZ — sakin "Yapay zekâ bağla". Kırmızı yalnız gerçekten kurulu bir bağlantı koptuysa.
test('kaygı 2: "bağlantı koptu" yalnız kurulu bir bağlantı (hesap kaydı ya da kayıtlı anahtar) varken; hesabı hiç olmamışa sakin giriş', () => {
  const yok = { bulut: 0, yerel: false };
  const anahtarsiz = { anthropic: { etkin: false, anahtarVar: false }, openai: { etkin: false, anahtarVar: false } };
  // Hiç hesap, hiç anahtar: eskiden çalışmış motor kırmızıya çevirmez.
  assert.equal(kopmaSayilirMi({ motorCalisti: true, hesap: null, saglayicilar: anahtarsiz }), false);
  const g = motorGorunumu(yok, kopmaSayilirMi({ motorCalisti: true, hesap: null, saglayicilar: anahtarsiz }), null);
  assert.equal(g, 'bagli-degil');
  const b = motorBildirimi(g, 'is', null)!;
  assert.equal(b.seviye, 'notr');
  assert.equal(b.baslik, 'Yapay zekâ bağla');
  assert.equal(motorHapiVarMi(g), false, 'ada kırmızı hap göstermez');
  // Gerçek bir bağlantı vardı: kayıtlı anahtar ya da hesap kaydı → kırmızı.
  assert.equal(kopmaSayilirMi({ motorCalisti: true, hesap: null, saglayicilar: { ...anahtarsiz, openai: { etkin: true, anahtarVar: true } } }), true);
  assert.equal(motorGorunumu(yok, true, null), 'durdu');
  assert.equal(kopmaSayilirMi({ motorCalisti: true, hesap: { eposta: 'a@b.c', durum: 'aktif' }, saglayicilar: anahtarsiz }), true);
  assert.equal(motorBildirimi('durdu', 'is', 'aktif')!.seviye, 'kirmizi');
  // Motor hiç çalışmadıysa zaten bağlı değil.
  assert.equal(kopmaSayilirMi({ motorCalisti: false, hesap: { eposta: 'a@b.c', durum: 'aktif' }, saglayicilar: { ...anahtarsiz, openai: { etkin: true, anahtarVar: true } } }), false);
  // Hesap aktif ama motor yok: motorCalisti'den bağımsız "durdu" (eski kural aynen).
  assert.equal(motorGorunumu(yok, false, 'aktif'), 'durdu');
  // İki çağıran da aynı kuralı kullanır (ana süreç ve arayüz).
  const kaynak = (d: string) => fs.readFileSync(path.resolve(import.meta.dirname, d), 'utf8');
  assert.match(kaynak('../src/main/main.ts'), /motorGorunumu\(s, kopmaSayilirMi\(a\), a\.hesap\?\.durum\)/);
  assert.match(kaynak('../src/renderer/motor-sinyali.ts'), /motorGorunumu\(motor, a \? kopmaSayilirMi\(a\) : false, hesapDurumu\)/);
});

// ── 0.12 H3c: "Yalnız bu bilgisayar" İş'te de; seçili ama yerel hazırlanırken (bulut yok) kendi nötr satırı — Gizli'nin değil ─────────────
test('H3c (P14 K1): "Yalnız bu bilgisayar" seçili — hazırlanıyor → "hazirlaniyor", ne hazır ne hazırlanıyor (hata, kaldırıldı, kapalı) → "yerel-hazir-degil"; bulut sayılsa da ASLA "hazir"; alan yokken eski kural AYNEN', () => {
  for (const h of HESAP_HALLERI) for (const mc of [false, true]) for (const bulut of [0, 1]) {
    assert.equal(motorGorunumu({ bulut, yerel: false, hazirlaniyor: true, yalnizYerelIstendi: true }, mc, h), 'hazirlaniyor', `hesap=${h} bulut=${bulut}`);
    assert.equal(motorGorunumu({ bulut, yerel: false, hazirlaniyor: false, yalnizYerelIstendi: true }, mc, h), 'yerel-hazir-degil', `hesap=${h} bulut=${bulut}`);
    assert.equal(motorGorunumu({ bulut, yerel: true, yalnizYerel: true, yalnizYerelIstendi: true }, mc, h), 'yerel');
    // Alan yokken (Fuber seçili ama Ayarlar'dan yerel iniyor) bugünkü kural: hazırlanıyor görünmez.
    assert.equal(motorGorunumu({ bulut: 0, yerel: false, hazirlaniyor: true }, mc, h), motorGorunumu({ bulut: 0, yerel: false }, mc, h));
  }
  // Gizli önce: Gizli açıkken alan hiçbir şeyi değiştirmez.
  assert.equal(motorGorunumu({ bulut: 0, yerel: false, gizli: true, hazirlaniyor: false, yalnizYerelIstendi: true }, false, null), 'durdu');
});

test('H3c: "Yalnız bu bilgisayar" hazırlanırken bildirim nötr ve Gizli demez; İş dilinde; hap İş’te yok, Geliştirici’de gri', () => {
  for (const mod of ['is', 'gelistirici'] as const) {
    for (const yarim of [false, true]) {
      const b = motorBildirimi('hazirlaniyor', mod, null, false, yarim, true)!;
      assert.equal(b.seviye, 'notr');
      assert.doesNotMatch([b.baslik, b.kisa, b.ipucu, b.metin].join(' '), /Gizli|gizli/, 'Gizli denmez');
      assert.equal(b.dugme, undefined);
      assert.equal(b.cipa, 'gizli-mod', 'çapa: Ayarlar → Gizlilik → Nerede çalışsın');
      assert.match(b.baslik, yarim ? /yarıda kaldı/ : /iniyor — hazır olunca yanıtlar bu bilgisayarda üretilir\./);
      if (mod === 'is') for (const m of [b.baslik, b.kisa, b.ipucu ?? '']) assert.equal(isDiliIhlali(m), null, m);
    }
  }
  // Bayraksız (eski çağıran) 'hazirlaniyor' Gizli'nin satırı kalır.
  assert.match(motorBildirimi('hazirlaniyor', 'is', null)!.baslik, /^Gizli mod hazırlanıyor/);
  assert.equal(motorEtiketi('hazirlaniyor', 'is', 0, false, true), null);
  assert.deepEqual(motorEtiketi('hazirlaniyor', 'gelistirici', 0, false, true), { hap: 'yerel model iniyor', nokta: 'gri' });
  assert.equal(yapayZekaSatiri('hazirlaniyor', 'is', null, false, true).durum, 'yalnız bu bilgisayarda · hazırlanıyor');
  // İş'te bilinçli "Yalnız bu bilgisayar": nötr gri hap (turuncu "Yalnız gündelik sohbet" değil).
  assert.deepEqual(motorEtiketi('yerel', 'is', 0, false, true), { hap: 'Yalnız bu bilgisayar', ipucu: 'Bu bilgisayardaki yapay zekâ en iyi yazma, özetleme, çeviri ve hatırlamada çalışır; hatırlatıcılar onayınla kurulur, e-posta ve ekran kullanılamaz.', nokta: 'gri' });
  assert.equal(motorEtiketi('yerel', 'is')?.nokta, 'turuncu', 'bayraksız eski hap AYNEN');
  assert.equal(yalnizYerelSecili({ yalnizYerelIstendi: true }), true);
  assert.equal(yalnizYerelSecili({ yalnizYerel: true }), true);
  assert.equal(yalnizYerelSecili({}), false);
  // Motorsuz liste "Yalnız bu bilgisayar" hazırlanırken araç isteyen işleri vaat etmez (Gizli cümlesi de değil).
  assert.deepEqual(motorsuzAcilanlar(false, true), [['sohbet', 'Yalnız bu bilgisayardaki yapay zekâ: araç isteyen işler kapalı']]);
  assert.deepEqual(motorsuzAcilanlar(true, true), motorsuzAcilanlar(true));
  assert.equal(motorsuzAcilanlar(false).length, 4, 'bayraksız eski liste AYNEN');
});

test('H3c (P14 K1): Hazırsın satırı — "Yalnız bu bilgisayar" inerken bulut olsa da yanıt Fuber’den gelmez: "iniyor · %X — hazır olunca yanıtlar bu bilgisayarda üretilir."; hazırsa satır yok; geri alındıysa söyler', () => {
  const t = { mod: 'is' as const, gizliMod: false, yalnizYerel: true, yerelHazir: false, yerelIniyor: true, yerelIstendi: true };
  for (const g of ['hazir', 'hazirlaniyor'] as const) {
    assert.equal(hazirDurumu({ ...t, gorunum: g, yerelYuzde: 34 }), 'Bu bilgisayardaki yapay zekâ iniyor · %34 — hazır olunca yanıtlar bu bilgisayarda üretilir.');
    assert.doesNotMatch(hazirDurumu({ ...t, gorunum: g }) ?? '', /Fuber’den|eskisi gibi/);
  }
  assert.equal(hazirDurumu({ ...t, gorunum: 'hazirlaniyor' }), 'Bu bilgisayardaki yapay zekâ iniyor — hazır olunca yanıtlar bu bilgisayarda üretilir.');
  assert.match(hazirDurumu({ ...t, gorunum: 'yerel-hazir-degil', yerelIniyor: false, yerelIstendi: false }) ?? '', /hazır değil/);
  // Kü2: hesapsızken geri alma "Fuber’le sürdürüyorum" demez (hesap yokken Fuber'in yapay zekâsı da yok).
  assert.doesNotMatch(hazirDurumu({ mod: 'is', gorunum: 'bagli-degil', gizliMod: false, yerelHazir: false, yerelIniyor: false, yerelIstendi: false, yerelGeriAlindi: 'hazir-degil', hesapsiz: true }) ?? '', /Fuber’le/);
  assert.doesNotMatch(hazirDurumu({ mod: 'is', gorunum: 'bagli-degil', gizliMod: false, yerelHazir: false, yerelIniyor: false, yerelIstendi: false, yerelGeriAlindi: 'yetmiyor', hesapsiz: true }) ?? '', /Fuber’le/);
  assert.equal(hazirDurumu({ ...t, gorunum: 'yerel', yerelHazir: true }), null);
  assert.equal(hazirDurumu({ mod: 'is', gorunum: 'hazir', gizliMod: false, yerelHazir: false, yerelIniyor: false, yerelIstendi: false, yerelGeriAlindi: 'yetmiyor' }), 'Bu bilgisayar kendi yapay zekâsını çalıştırmaya yetmiyor; Fuber’le sürdürüyorum.');
  assert.equal(hazirDurumu({ mod: 'is', gorunum: 'hazir', gizliMod: false, yerelHazir: false, yerelIniyor: false, yerelIstendi: false, yerelGeriAlindi: 'hazir-degil' }), 'Bu bilgisayardaki yapay zekâ hazırlanamadı; Fuber’le sürdürüyorum.');
  for (const g of ['hazir', 'hazirlaniyor'] as const) assert.equal(isDiliIhlali(hazirDurumu({ ...t, gorunum: g }) ?? ''), null);
  // Gizli satırları AYNEN (yalnızYerel bayrağı Gizli'yi etkilemez).
  assert.equal(hazirDurumu({ ...t, gizliMod: true, gorunum: 'hazirlaniyor' }), hazirDurumu({ ...t, gizliMod: true, yalnizYerel: false, gorunum: 'hazirlaniyor' }));
});

// ── H3c düzeltme turu 2 ──
test('Kü (düzeltme turu 2): "hazır değil" kartının kısa satırı (1080) açıklamayı görünür TEK satırla söyler — yalnız ipucunda kalmaz', () => {
  for (const mod of ['is', 'gelistirici'] as const) {
    const b = motorBildirimi('yerel-hazir-degil', mod, null, false, false, true)!;
    assert.equal(b.alt, 'Bulut yapay zekâsı kapalı; birini seç.');
    assert.ok(b.alt!.length <= 38, 'kısa sütunda tek satır');
  }
  const sb = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'renderer', 'pano', 'SohbetBaslangic.tsx'), 'utf8');
  assert.match(sb, /className="sohbet-bas__kur-alt"/);
});

test('Kü (düzeltme turu 2): Hazırsın — ölçülemeyen bilgisayar için "yetmiyor" denmez: "Bu bilgisayarı ölçemedim; …"', () => {
  const t = { mod: 'is' as const, gorunum: 'hazir' as const, gizliMod: false, yerelHazir: false, yerelIniyor: false, yerelIstendi: false, yerelGeriAlindi: 'olculemedi' as const };
  assert.equal(hazirDurumu(t), 'Bu bilgisayarı ölçemedim; Fuber’le sürdürüyorum. Sürümü Ayarlar → Gizlilik’ten seçebilirsin.');
  assert.equal(hazirDurumu({ ...t, gorunum: 'bagli-degil', hesapsiz: true }), 'Bu bilgisayarı ölçemedim; sürümü Ayarlar → Gizlilik’ten seçebilirsin.');
  for (const h of [true, false]) assert.doesNotMatch(hazirDurumu({ ...t, hesapsiz: h }) ?? '', /yetmiyor/);
});

// ── H3c takip turu ──
test('Takip 3: Ayarlar → Hesap üst satırı "hazır değil"de düğmenin adı gerçek eylemi söyler — "Nerede çalışsın’ı aç" (indirmez; tek onaylı yol)', () => {
  for (const mod of ['is', 'gelistirici'] as const) {
    const s = yapayZekaSatiri('yerel-hazir-degil', mod, 'aktif', false, true);
    assert.deepEqual(s.dugme, { etiket: 'Nerede çalışsın’ı aç', cipa: 'gizli-mod' });
  }
});

test('Takip 6: telefon/ada notu — "Yalnız bu bilgisayar" seçili ve yerel İNERKEN hazırlanma cümlesi ("yeniden indirebilir" denmez)', () => {
  assert.equal(motorHataMetni('yok', 'is', 'aktif', false, true, true, 'iniyor'), 'Bu bilgisayardaki yapay zekâ iniyor — hazır olunca yanıtlar bu bilgisayarda üretilir.');
  assert.match(motorHataMetni('yok', 'is', null, false, true, true, 'yarim'), /yarıda kaldı/);
  assert.match(motorHataMetni('yok', 'gelistirici', null, false, true, true, 'iniyor'), /^Yerel model iniyor/);
  assert.match(motorHataMetni('yok', 'is', null, false, true, true, null), /yeniden indirebilir/, 'inmiyorsa eski cümle');
  for (const h of ['iniyor', 'yarim'] as const) {
    const m = motorHataMetni('yok', 'is', null, false, true, true, h);
    assert.equal(gorunenMotorHatasi('anahtar', m, 'is'), m, 'İş’te aynen görünür');
  }
  const d = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'main', 'ajan', 'dongu.ts'), 'utf8');
  // Tur başındaki "yol yok" dalı hazırlığı okur ve motorHataMetni'ne verir. Satır biçimine bağlı değil (inceleme M-6): davranış
  // tests/hazirlanma-notu.test.ts'te gerçek ajan döngüsüyle sınanır.
  assert.match(d, /yalnizHazirlik\(\)/);
  assert.match(d, /motorHataMetni\('yok',[^;]*hazirlik\)/);
});
