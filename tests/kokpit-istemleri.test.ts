// F1 düzeltme turu 2 (KK-1): Gizli açıkken (hazır ya da hazırlanırken) kokpit, Gizli turda yapılamayan işleri (hatırlatıcı, iş, plan,
// e-posta, WhatsApp, web, ekran, hafıza — Gizli turda araç yok: main/ajan/dongu.ts) önermez. Kural tek yerde (shared/kokpit-istemleri.ts);
// Normal modda hiçbir liste değişmez.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  aracsizMi, ACIK_GUN_ONERILERI, ARAC_KITI, GIZLI_ONERILERI, IPUCU_ONERILERI, ISTEM, altlikOnerisi, epostaOzeti, istemDugmeleri, istemOnerilir,
  konuHaberleri, konuyuKonusalim, oneriListesi, projeDurumu, SOHBET_BOS_ONERILERI, sohbetOnerileri, toplantiEpostasi, whatsappOzeti, type IstemOnerisi,
} from '../src/shared/kokpit-istemleri.ts';
import { GIZLI_SOHBET_NOTU, YALNIZ_YEREL_SOHBET_NOTU, motorsuzAcilanlar } from '../src/shared/motor-durumu.ts';
import { isDiliIhlali } from '../src/shared/is-dili.ts';

const kok = path.resolve(import.meta.dirname, '..');
const KAYDA_BAGLI = [konuHaberleri('Merkez Bankası'), epostaOzeti(3), toplantiEpostasi(4), whatsappOzeti('Ece'), projeDurumu('Mavi Kuş')];
const etiketler = (l: readonly IstemOnerisi[]) => l.map((o) => o.etiket);

test('KK-1: kokpitin araç isteyen istemleri işaretli; Gizli önerileri araçsız ve Gizli turda yapılabilir işler', () => {
  for (const i of [...Object.values(ISTEM), ...KAYDA_BAGLI]) assert.equal(i.arac, true, i.metin);
  assert.equal(konuyuKonusalim('Sunum', 'Perşembeye yetişmeli').arac, false, 'konusu istemin içinde: araç gerekmez');
  assert.equal(konuyuKonusalim('Sunum', 'Perşembeye yetişmeli').metin, 'Şu konuyu konuşalım: Sunum — Perşembeye yetişmeli');
  assert.ok(GIZLI_ONERILERI.length >= 3 && GIZLI_ONERILERI.length <= 4, String(GIZLI_ONERILERI.length));
  for (const o of GIZLI_ONERILERI) {
    assert.equal(o.istem.arac, false, o.etiket);
    const metin = `${o.etiket} ${o.ipucu ?? ''} ${o.istem.metin}`;
    // Gizli turda yapılamayan bir işi istemez (hatırlatıcı, iş, plan, e-posta, WhatsApp, web/haber, ekran, hafıza, takvim).
    assert.doesNotMatch(metin, /hatırlat|planla|plan[ıi]m|e-posta|whatsapp|web|internet|haber|gündem|ekran|hafıza|takvim|iş ekle/i, metin);
    assert.equal(isDiliIhlali(metin), null, metin);
  }
});

test('KK-1: istemOnerilir — Normal her istemi önerir; Gizli yalnız araçsızı', () => {
  for (const i of [...Object.values(ISTEM), ...KAYDA_BAGLI]) {
    assert.equal(istemOnerilir(i, false), true, i.metin);
    assert.equal(istemOnerilir(i, true), false, i.metin);
  }
  for (const o of GIZLI_ONERILERI) assert.equal(istemOnerilir(o.istem, true), true, o.etiket);
  assert.equal(istemOnerilir(konuyuKonusalim('Sunum'), true), true);
});

test('KK-1: oneriListesi — Normal liste aynen; Gizli araç isteyenler çıkar, yerine Gizli turda yapılabilenler', () => {
  for (const liste of [IPUCU_ONERILERI, ARAC_KITI, ACIK_GUN_ONERILERI, sohbetOnerileri({ konu: 'Merkez Bankası', okunmamis: 2, takvimBos: false })]) {
    assert.deepEqual(oneriListesi(liste, false), [...liste]);
    const g = oneriListesi(liste, true);
    assert.ok(g.every((o) => !o.istem.arac), JSON.stringify(etiketler(g)));
    assert.deepEqual(etiketler(g), etiketler(GIZLI_ONERILERI));
  }
  // Karışık listede araçsız öneri kalır, Gizli önerileri arkasına gelir.
  const karisik: IstemOnerisi[] = [{ simge: 'sohbet', etiket: 'Sunumu konuşalım', istem: konuyuKonusalim('Sunum') }, ARAC_KITI[0]];
  assert.deepEqual(etiketler(oneriListesi(karisik, true)), ['Sunumu konuşalım', ...etiketler(GIZLI_ONERILERI)]);
});

test('KK-1: istemDugmeleri — Gizli araç isteyen düğme gizlenir, hepsi gizlendiyse yerinde tek nötr cümle; Normal aynen', () => {
  assert.deepEqual(istemDugmeleri(ACIK_GUN_ONERILERI, false, false), { gorunen: [...ACIK_GUN_ONERILERI], not: null });
  assert.deepEqual(istemDugmeleri(ACIK_GUN_ONERILERI, true, true), { gorunen: [], not: GIZLI_SOHBET_NOTU });
  assert.deepEqual(istemDugmeleri(GIZLI_ONERILERI, true, true), { gorunen: [...GIZLI_ONERILERI], not: null });
  // Nötr cümle K-6'nın Gizli satırıyla aynı (tek kaynak).
  assert.deepEqual(motorsuzAcilanlar(true), [['sohbet', GIZLI_SOHBET_NOTU]]);
  assert.equal(GIZLI_SOHBET_NOTU, 'Gizli modda gündelik sohbet; yanıtlar bu bilgisayarda');
});

test('KK-1: Normal modda yüzeylerin listeleri eskisiyle birebir', () => {
  // Sohbetin boş hâli ("Sorabileceklerin"): bağlama göre, en çok 4 (önceki SohbetBaslangic.tsx mantığı).
  const sb = (konu: string | undefined, okunmamis: number, takvimBos: boolean) => sohbetOnerileri({ konu, okunmamis, takvimBos }).map((o) => [o.etiket, o.istem.metin]);
  assert.deepEqual(sb('Merkez Bankası', 2, false), [
    ['Merkez Bankası haberlerini özetle', 'Merkez Bankası hakkında son gelişmeleri kısaca, kaynaklarıyla özetle.'],
    ['Günümü planla', 'Bugünkü hatırlatıcılarıma, planlarıma ve e-postalarıma bakıp günümü planla.'],
    ['Okunmamış e-postalarımı tara', 'Okunmamış e-postalarımı tara; önemli olanları ve yanıt gerekenleri söyle.'],
    ['Bu hafta beni neler bekliyor?', 'Bu haftaki hatırlatıcılarıma, işlerime ve toplantılarıma bakıp beni neler beklediğini kısaca söyle.'],
  ]);
  assert.deepEqual(sb(undefined, 0, true).map(([e]) => e), ['Günümü planla', 'Yarın sabah için bir hatırlatıcı kur', 'Bu hafta beni neler bekliyor?']);
  assert.deepEqual(sb(undefined, 0, false).map(([e]) => e), ['Günümü planla', 'Bu hafta beni neler bekliyor?', 'Yarın sabah için bir hatırlatıcı kur']);
  assert.equal(sb(undefined, 0, true)[1][1], 'Yarın sabah 9’da bana bir hatırlatıcı kur; ne için olduğunu sor.');
  assert.deepEqual(sb('Galatasaray', 0, false).map(([e]) => e), ['Galatasaray haberlerini özetle', 'Günümü planla', 'Bu hafta beni neler bekliyor?', 'Yarın sabah için bir hatırlatıcı kur']);
  // "Fuber'e sorabilirsin", araç kiti, takvim boşken gündem çipleri, kart altlıkları.
  assert.deepEqual(IPUCU_ONERILERI.map((o) => [o.simge, o.etiket, o.istem.metin]), [
    ['zil', 'Yarın için hatırlatıcı kur', 'Yarın sabah 9’da bana bir hatırlatıcı kur; ne için olduğunu sor.'],
    ['kure', 'Gündemi bana özetle', 'Bugün gündemde neler var? Önemli haberleri kısaca, kaynaklarıyla özetle.'],
    ['liste', 'Haftamı planla', 'Bu haftaki hatırlatıcılarıma ve işlerime bakıp haftamı planla; eksik bir şey varsa sor.'],
  ]);
  assert.deepEqual(ARAC_KITI.map((o) => [o.simge, o.etiket, o.istem.metin, o.ipucu]), [
    ['zil', 'Hatırlatıcı kur', 'Bir hatırlatıcı kurmak istiyorum; ne zaman ve ne için olduğunu sor.', 'Ne zaman, ne için'],
    ['isik', 'Günümü planla', 'Bugünkü hatırlatıcılarıma, planlarıma ve e-postalarıma bakıp günümü planla.', 'Takvim, işler, e-posta'],
    ['posta', 'E-postaları tara', 'Okunmamış e-postalarımı tara; önemli olanları ve yanıt gerekenleri söyle.', 'Önemli ve yanıt bekleyen'],
    // 0.11 G5: görünen ad Türkçe kesme işaretiyle (’); gönderilen istem metni aynen.
    ['kure', 'Web’de araştır', 'Benim için web\'de bir şey araştırmanı istiyorum; konuyu sor.', 'Kaynaklarıyla özet'],
    ['ekran', 'Ekranıma bak', 'Ekranıma bak ve şu an ne üzerinde çalıştığımı söyle; yardımcı olabileceğin bir şey var mı?', 'Gördüğünü anlatır'],
    ['hafiza', 'Hakkımda ne biliyorsun', 'Hakkımda bildiklerini kısaca özetle ve eksik gördüğün bir şeyi sor.', 'Hafızandakiler'],
  ]);
  assert.deepEqual(ACIK_GUN_ONERILERI.map((o) => [o.simge, o.etiket, o.istem.metin]), [
    ['isik', 'Günümü planla', 'Bugünkü hatırlatıcılarıma, planlarıma ve e-postalarıma bakıp günümü planla.'],
    ['zil', 'Hatırlatıcı kur', 'Bir hatırlatıcı kurmak istiyorum; ne zaman ve ne için olduğunu sor.'],
    ['arti', 'İş ekle', 'Planıma yeni bir iş eklemek istiyorum; ne olduğunu ve son tarihini sor.'],
  ]);
  const altlik = (tip: Parameters<typeof altlikOnerisi>[0], n = 0) => { const o = altlikOnerisi(tip, n); return o && [o.simge, o.etiket, o.istem.metin]; };
  assert.deepEqual(altlik('hatirlatici'), ['arti', 'Hatırlatıcı kur', 'Bir hatırlatıcı kurmak istiyorum; ne zaman ve ne için olduğunu sor.']);
  assert.deepEqual(altlik('dikkat'), ['isik', 'Birlikte bak', 'Dikkat etmem gerekenleri önem sırasıyla anlat; her biri için ne yapmalıyım?']);
  assert.deepEqual(altlik('oneriler'), ['isik', 'Hangisiyle başlayayım?', 'Önerilerini önem sırasıyla anlat; hangisiyle başlamalıyım?']);
  assert.deepEqual(altlik('plan'), ['arti', 'İş ekle', 'Planıma yeni bir iş eklemek istiyorum; ne olduğunu ve son tarihini sor.']);
  assert.deepEqual(altlik('eposta', 2), ['posta', 'Okunmamışları tara', 'Okunmamış e-postalarımı tara; önemli olanları ve yanıt gerekenleri söyle.']);
  assert.deepEqual(altlik('eposta', 0), ['posta', 'Gelen kutusunu tara', 'Okunmamış e-postalarımı tara; önemli olanları ve yanıt gerekenleri söyle.']);
  assert.equal(altlikOnerisi('hava'), null);
  // Kart satırlarının istemleri (önceki Kokpit.tsx / PanoKartlari.tsx metinleri).
  assert.equal(epostaOzeti(7).metin, '#7 numaralı e-postayı oku ve bana özetle; yanıt gerekiyorsa taslak öner.');
  assert.equal(toplantiEpostasi(8).metin, '#8 numaralı e-postayı oku ve bana özetle; toplantı ya da görüşme varsa saatini ve hazırlığını söyle.');
  assert.equal(whatsappOzeti('Ece').metin, 'Ece ile WhatsApp yazışmamı özetle; yanıt vermem gereken bir şey var mı?');
  assert.equal(projeDurumu('Mavi Kuş').metin, 'Mavi Kuş projesinin durumunu özetle; açık işler ve riskler neler?');
  assert.equal(konuyuKonusalim('Sunum').metin, 'Şu konuyu konuşalım: Sunum');
});

test('KK-1: kokpit yüzeyleri istemi yalnız ortak kaynaktan verir (sor ham metin almaz, istem metni yüzeyde yazılmaz)', () => {
  const dosyalar = ['src/renderer/pano/SohbetBaslangic.tsx', 'src/renderer/pano/PanoKartlari.tsx', 'src/renderer/sayfalar/Kokpit.tsx'];
  const istemler = [...Object.values(ISTEM), ...GIZLI_ONERILERI.map((o) => o.istem)].map((i) => i.metin);
  for (const d of dosyalar) {
    const k = fs.readFileSync(path.join(kok, d), 'utf8');
    assert.doesNotMatch(k, /\bsor\(\s*['"`]/, `${d}: sor'a ham metin`);
    assert.match(k, /shared\/kokpit-istemleri/, `${d}: ortak kaynağı okumuyor`);
    for (const m of istemler) assert.ok(!k.includes(m.slice(0, 40)), `${d}: istem metni yüzeyde yazılı — ${m}`);
  }
  // Kokpit'in `sor`u yalnız Istem alır ve Gizli'de araç isteyeni göndermez (son kapı).
  const kokpit = fs.readFileSync(path.join(kok, 'src/renderer/sayfalar/Kokpit.tsx'), 'utf8');
  assert.match(kokpit, /const sor = \(i: Istem\)/);
  assert.match(kokpit, /istemOnerilir\(i, motorS\.aracsiz\)/); // G8 K3: Gizli YA DA yalnız yerel
});

// ── 0.11 G7 (F1 KK-1 devri): yeni (boş) sohbetin hazır önerileri de aynı kuraldan geçer ──
// Eskiden bilesenler/Sohbet.tsx'te ham bir dizi vardı ("Yarın sabah 10:00'da toplantım var, hatırlat", "Son e-postalarımı özetle"…): Gizli'de
// araç isteyen istemler öneriyordu. Kokpitteki SohbetSecici'nin taslak sohbeti ve Sohbetler sayfası aynı bileşeni (Sohbet) kullanır.
test('G7: yeni sohbetin önerileri — Normal eskisiyle birebir (ad = gönderilen metin), Gizli yalnız araçsız', () => {
  assert.deepEqual(SOHBET_BOS_ONERILERI.map((o) => o.etiket), [
    'Bugün beni neler bekliyor?',
    'Yarın sabah 10:00’da toplantım var, hatırlat',
    'Son e-postalarımı özetle',
    'Beni tanımak için bana birkaç soru sor',
  ]);
  for (const o of SOHBET_BOS_ONERILERI) {
    assert.equal(o.istem.metin, o.etiket, 'düğmenin adı gönderilen metnin kendisi (eskisi gibi)');
    assert.equal(o.istem.arac, true, `${o.etiket}: hatırlatıcı, plan, e-posta ya da hafıza ister`);
    assert.equal(istemOnerilir(o.istem, true), false, o.etiket);
  }
  assert.deepEqual(oneriListesi(SOHBET_BOS_ONERILERI, false), [...SOHBET_BOS_ONERILERI]);
  const gizli = oneriListesi(SOHBET_BOS_ONERILERI, true);
  assert.deepEqual(gizli.filter((o) => o.istem.arac), [], 'Gizli: araç isteyen istem yok');
  assert.deepEqual(etiketler(gizli), etiketler(GIZLI_ONERILERI));
  for (const o of gizli) assert.equal(isDiliIhlali(`${o.etiket} ${o.istem.metin}`), null, o.etiket);
});

test('G7: Sohbet bileşeni boş hâl önerilerini ortak kaynaktan alır (ham dizi yok) ve Gizli bilgisiyle süzer', () => {
  const k = fs.readFileSync(path.join(kok, 'src/renderer/bilesenler/Sohbet.tsx'), 'utf8');
  assert.match(k, /shared\/kokpit-istemleri/);
  assert.match(k, /oneriListesi\(SOHBET_BOS_ONERILERI, aracsiz\)/);
  assert.doesNotMatch(k, /const ONERILER\b/, 'ham öneri dizisi geri gelmiş');
  assert.doesNotMatch(k, /Son e-postalarımı özetle/);
  // Son kapı: öneri düğmesi Gizli'de (ve G8'den beri yalnız-yerelde) araç isteyen istemi göndermez.
  assert.match(k, /istemOnerilir\(o\.istem, aracsiz\)/);
});

// ── 0.11 G8 düzeltme turu 1 (K3): "Yalnız bu bilgisayardaki yapay zekâ" da araçsız tur — öneriler yalnız Gizli'ye bağlı kalmasın ──
// Yerel tek motor (dongu.ts) iki durumda araçsız çalışır: Gizli mod ve yalnız-yerel tercihi. Boş sohbet önerileri, kokpit istem düğmeleri ve
// "Hızlı işler" ikisinde de araç isteyen istem sunmaz ("hatırlatıcı kur" düğmesi bastığında yanıtsız kalan bir vaat olmasın).
test('K3: aracsizMi — Gizli YA DA yalnız yerel; ikisinde de her liste araçsız, hiçbiri değilse liste aynen', () => {
  assert.equal(aracsizMi(null), false);
  assert.equal(aracsizMi(undefined), false);
  assert.equal(aracsizMi({}), false);
  assert.equal(aracsizMi({ gizli: false, yalnizYerel: false }), false);
  assert.equal(aracsizMi({ gizli: true }), true);
  assert.equal(aracsizMi({ yalnizYerel: true }), true);
  assert.equal(aracsizMi({ gizli: true, yalnizYerel: true }), true);
  // Sıkı boolean: bozuk bir değer ("evet") araçsız saymaz.
  assert.equal(aracsizMi({ yalnizYerel: 'evet' as unknown as boolean }), false);
  const listeler = [SOHBET_BOS_ONERILERI, IPUCU_ONERILERI, ARAC_KITI, ACIK_GUN_ONERILERI];
  for (const l of listeler) {
    assert.deepEqual(oneriListesi(l, aracsizMi({ yalnizYerel: true })), oneriListesi(l, true), 'yalnız yerel = Gizli listesi');
    assert.deepEqual(oneriListesi(l, aracsizMi({ yalnizYerel: true })).filter((o) => o.istem.arac), [], 'araç isteyen öneri yok');
    assert.deepEqual(oneriListesi(l, aracsizMi({})), [...l], 'araçlı mod: liste aynen');
    // Düğmeler yalnız-yerelde de Gizli ile aynı süzülür (not cümlesi ayrı: aşağıdaki "Gizli sözü" testi).
    assert.deepEqual(istemDugmeleri(l, aracsizMi({ yalnizYerel: true }), false).gorunen, istemDugmeleri(l, true, true).gorunen);
  }
  for (const o of SOHBET_BOS_ONERILERI) assert.equal(istemOnerilir(o.istem, aracsizMi({ yalnizYerel: true })), false, o.etiket);
});

// ── 0.11 G8 düzeltme turu 2: araçsızlık ile Gizli AYRI — "Takvimin bugün açık" kartı yalnız yerelde "Gizli modda …" DEMEZ (spec §7: gizlilik sözü verilmez) ──
test('G8 düzeltme turu 2: istemDugmeleri notu GERÇEK Gizli\'ye göre — Gizli eskisiyle bayt bayt aynı; yalnız yerelde "Gizli" geçmez', () => {
  // Gizli: araçsız + Gizli → mevcut cümle aynen (K-6'nın Gizli satırıyla aynı tek kaynak).
  assert.equal(istemDugmeleri(ACIK_GUN_ONERILERI, aracsizMi({ gizli: true }), true).not, 'Gizli modda gündelik sohbet; yanıtlar bu bilgisayarda');
  assert.equal(istemDugmeleri(ACIK_GUN_ONERILERI, aracsizMi({ gizli: true, yalnizYerel: true }), true).not, GIZLI_SOHBET_NOTU, 'ikisi birden: Gizli cümlesi (Gizli açık)');
  // Yalnız yerel (Gizli kapalı): çipler yine gizlenir, yerlerinde nötr cümle — "Gizli" ve gizlilik sözü yok.
  const y = istemDugmeleri(ACIK_GUN_ONERILERI, aracsizMi({ yalnizYerel: true }), false);
  assert.deepEqual(y.gorunen, []);
  assert.equal(y.not, YALNIZ_YEREL_SOHBET_NOTU);
  assert.equal(YALNIZ_YEREL_SOHBET_NOTU, 'Yalnız bu bilgisayardaki yapay zekâ: araç isteyen işler kapalı');
  assert.doesNotMatch(YALNIZ_YEREL_SOHBET_NOTU, /gizli|gizlilik|bulutsuz|bu bilgisayarda kalır/i);
  assert.notEqual(y.not, GIZLI_SOHBET_NOTU);
  // Araçsız olmayan durumda not yok (Normal mod aynen); araçsız çip varsa not yok.
  assert.equal(istemDugmeleri(ACIK_GUN_ONERILERI, false, false).not, null);
  assert.equal(istemDugmeleri(GIZLI_ONERILERI, true, false).not, null);
  // Telaffuz/İş dili: yalnız-yerel yalnız Geliştirici'de var ama cümle yine sade (teknik ad yok).
  assert.equal(isDiliIhlali(YALNIZ_YEREL_SOHBET_NOTU), null);
});

test('G8 düzeltme turu 2: kokpit kartları araç süzmeyi AracsizMod\'dan alır; GizliMod yalnız "Takvimin bugün açık" notunun Gizli seçimi için okunur', () => {
  const oku = (d: string) => fs.readFileSync(path.join(kok, d), 'utf8');
  const pano = oku('src/renderer/pano/PanoKartlari.tsx');
  const kullanici = oku('src/renderer/pano/KullaniciKartlari.tsx');
  assert.match(pano, /istemDugmeleri\(ACIK_GUN_ONERILERI, useContext\(AracsizMod\), useContext\(GizliMod\)\)/);
  // GizliMod'u okuyan tek yer o satır: öteki tüm süzme yerleri AracsizMod kullanır (Gizli bağlamı Gizli dışı bir durumla doldurulmasın diye).
  assert.equal((pano.match(/useContext\(GizliMod\)/g) ?? []).length, 1);
  assert.equal((kullanici.match(/useContext\(GizliMod\)/g) ?? []).length, 0);
  assert.ok((pano.match(/useContext\(AracsizMod\)/g) ?? []).length >= 5);
  assert.equal((kullanici.match(/useContext\(AracsizMod\)/g) ?? []).length, 3);
  // Sağlayıcıda GizliMod'a araçsızlık verilmez.
  assert.doesNotMatch(oku('src/renderer/sayfalar/Kokpit.tsx'), /GizliMod\.Provider value=\{motorS\.aracsiz/);
});
