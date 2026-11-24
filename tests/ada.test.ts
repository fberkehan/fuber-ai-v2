// Ada mantığı: hal ölçüleri, tam ekran kuralı, öncelikli kuyruk ve hal önceliği (saf işlevler; pencere yok).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TERIM } from '../src/shared/terimler.ts';
import {
  ADA_PENCERE, AdaKuyrugu, FUBER_OLAYI_OMRU_MS, MOTOR_HAP_METNI, adaHaliBul, adaOlcusu, insinMi, olayGecerliMi, adaYolu, sureSuruyor, adaKapaliMi, gorevHapMetni, fareYakalansinMi, adaYasamAdimi, ADA_YASAM_ILK, durdurSokuldu, gorevHapiInsinMi, type AdaYasami, type AdaYasamOlayi,
  type AdaDurumu, type AdaHal, type AdaKaynak, type AdaOlayi, type AdaKosulu, kisayolKarari, bildirimSiraya, bekleyenCip, hatirlatmaKutuyuKapatirMi,
  HOVER_GECIKME_MS, HOVER_CIKIS_MS, fuberNoktasiVar, hoverCikinciKalkarMi, selamMetni, sessizMesajTaze, soyleKaynagi, centikOlcegi,
  PANEL_KAPANIS_MS, PANEL_TIKLAMA, PANEL_TIKLAMA_TAZE_MS, tiklamaTazeMi, panelKapanirMi, centikKipiAdimi, calisiyorAdimMetni, type CentikKipi,
} from '../src/shared/ada.ts';

/** Saf kuralın dışında kalan bağlantılar kaynak taramasıyla sınanır (bu dosyadaki diğer taramalarla aynı desen). */
const kaynakOku = (yol: string): string => readFileSync(new URL(`../${yol}`, import.meta.url), 'utf8');

// ── Ölçüler ─────────────────────────────────────────────────────────────────────────────────────────────────
test('ada penceresi sabit 720×460 kutudur (0.14 R15; ölçekle büyür)', () => {
  assert.deepEqual(ADA_PENCERE, { en: 720, boy: 460 });
});

test('her halin ölçüsü tasarımdaki gibi', () => {
  const beklenen: Record<AdaHal, { en: number; boy: number | 'icerik' }> = {
    dinlenme: { en: 132, boy: 30 }, // 0.14 T19 (R13): boşta, karakterin yüzü çentikten bakar
    sessiz: { en: 200, boy: 32 }, // 0.14 T19: Kapalı hap (saat + sağda simge)
    bildirim: { en: 360, boy: 44 },
    ekranda: { en: 340, boy: 36 },
    'motor-durdu': { en: 440, boy: 'icerik' }, // açıklamalı kart (Ruling O / K1): kısayolla, üstüne gelince, tıklayınca, oturumda ilk kez
    'motor-hap': { en: 204, boy: 32 }, // A2: boşta + bağlantı koptu küçük hap ("Bağlantı koptu", "Kullanım hakkın doldu" sığsın)
    dinliyor: { en: 380, boy: 64 },
    dusunuyor: { en: 300, boy: 44 },
    sor: { en: 440, boy: 56 },
    kart: { en: 440, boy: 'icerik' },
    yanit: { en: 440, boy: 'icerik' },
    onay: { en: 440, boy: 'icerik' },
    gorev: { en: 400, boy: 44 }, // 0.11 G10: "Görev: <başlık>" + Durdur (adım çalışırken ya da görev ekranı tutarken)
    panel: { en: 560, boy: 188 }, // 0.14 T23: açık panel (üst satır, sayfa, noktalar); 0.13'ün selamının yerinde
  };
  for (const [hal, olcu] of Object.entries(beklenen)) assert.deepEqual(adaOlcusu(hal as AdaHal), olcu, hal);
});

test('hiçbir hal pencere kutusundan geniş değil; dönen ölçü değiştirilse de tablo bozulmaz', () => {
  const haller: AdaHal[] = ['dinlenme', 'sessiz', 'bildirim', 'kart', 'sor', 'dinliyor', 'dusunuyor', 'yanit', 'onay', 'ekranda', 'motor-durdu', 'motor-hap', 'gorev', 'panel', 'uyari'];
  for (const h of haller) {
    const o = adaOlcusu(h);
    assert.ok(o.en <= ADA_PENCERE.en, `${h} en`);
    if (o.boy !== 'icerik') assert.ok(o.boy <= ADA_PENCERE.boy, `${h} boy`);
  }
  adaOlcusu('sessiz').en = 1;
  assert.equal(adaOlcusu('sessiz').en, 200);
});

// ── Tam ekran kuralı ────────────────────────────────────────────────────────────────────────────────────────
test('tam ekranda yalnız kullanıcı ve hatırlatıcı iner', () => {
  assert.equal(insinMi('fuber', true), false);
  assert.equal(insinMi('onay', true), false);
  assert.equal(insinMi('hatirlatma', true), true);
  assert.equal(insinMi('kullanici', true), true);
});

test('tam ekran değilken her kaynak iner', () => {
  for (const k of ['kullanici', 'hatirlatma', 'onay', 'fuber'] as AdaKaynak[]) assert.equal(insinMi(k, false), true, k);
});

// ── Kuyruk ──────────────────────────────────────────────────────────────────────────────────────────────────
let sayac = 0;
const olay = (kaynak: AdaKaynak, kanal: string = kaynak): AdaOlayi => ({ kaynak, kanal, veri: { n: ++sayac }, zaman: 1000 + sayac });

test('kuyruk: önce onay, sonra hatırlatma, sonra mesaj', () => {
  const k = new AdaKuyrugu();
  const mesaj = olay('fuber'), hatirlatma = olay('hatirlatma'), onay = olay('onay');
  k.ekle(mesaj); k.ekle(hatirlatma); k.ekle(onay);
  assert.equal(k.uzunluk, 3);
  assert.equal(k.al(false), onay);
  assert.equal(k.al(false), hatirlatma);
  assert.equal(k.al(false), mesaj);
  assert.equal(k.uzunluk, 0);
});

test('kuyruk: kullanıcı fuber\'in önünde, hatırlatmanın arkasında', () => {
  const k = new AdaKuyrugu();
  const f = olay('fuber'), u = olay('kullanici'), h = olay('hatirlatma');
  k.ekle(f); k.ekle(u); k.ekle(h);
  assert.deepEqual([k.al(false), k.al(false), k.al(false)], [h, u, f]);
});

test('kuyruk: aynı öncelikte ilk gelen önce çıkar', () => {
  const k = new AdaKuyrugu();
  const a = olay('hatirlatma', 'a'), b = olay('hatirlatma', 'b'), c = olay('hatirlatma', 'c');
  // zaman damgası sırayı değil, geliş sırası belirler: b'nin zamanı en küçük olsa da a önce eklendi.
  b.zaman = 1;
  k.ekle(a); k.ekle(b); k.ekle(c);
  assert.deepEqual([k.al(false)?.kanal, k.al(false)?.kanal, k.al(false)?.kanal], ['a', 'b', 'c']);
});

test('kuyruk: tam ekranda inemeyenler bekler, hatırlatma verilir', () => {
  const k = new AdaKuyrugu();
  const mesaj = olay('fuber'), hatirlatma = olay('hatirlatma'), onay = olay('onay');
  k.ekle(mesaj); k.ekle(hatirlatma); k.ekle(onay);
  assert.equal(k.al(true), hatirlatma);
  assert.equal(k.uzunluk, 2);
  // Verilecek başka şey kalmadı: onay ve mesaj tam ekran bitene dek bekler, kaybolmaz.
  assert.equal(k.al(true), undefined);
  assert.equal(k.uzunluk, 2);
  // Tam ekran bitince bekleyenler öncelik sırasıyla gelir.
  assert.equal(k.al(false), onay);
  assert.equal(k.al(false), mesaj);
  assert.equal(k.uzunluk, 0);
});

test('kuyruk: tam ekranda bekleyen onayın arkasındaki kullanıcı olayı atlanıp verilir', () => {
  const k = new AdaKuyrugu();
  const onay = olay('onay'), kullanici = olay('kullanici');
  k.ekle(onay); k.ekle(kullanici);
  assert.equal(k.al(true), kullanici);
  assert.equal(k.uzunluk, 1);
});

test('kuyruk: boşken undefined döner', () => {
  const k = new AdaKuyrugu();
  assert.equal(k.al(false), undefined);
  assert.equal(k.al(true), undefined);
  assert.equal(k.uzunluk, 0);
});

test('kuyruk: kart açıkken gelen hatırlatma kaybolmaz, ondan sonra gelen mesajdan önce çıkar', () => {
  const k = new AdaKuyrugu();
  const hatirlatma = olay('hatirlatma'), mesaj = olay('fuber');
  k.ekle(mesaj);
  k.ekle(hatirlatma);
  assert.equal(k.al(false), hatirlatma);
  assert.equal(k.al(false), mesaj);
});

// ── Bayatlayan olay: kuyrukta beklerken geçerliliğini yitirenler teslim edilmez ──────────────────────────────────
const dk = 60_000;
const yasli = (kaynak: AdaKaynak, yasMs: number, gecerli?: () => boolean): AdaOlayi => ({ kaynak, kanal: kaynak, veri: null, zaman: 5_000_000 - yasMs, gecerli });
const SIMDI = 5_000_000;

test('bayat: Fuber olayı 30 dakikaya kadar geçerli, sonra düşer', () => {
  assert.equal(FUBER_OLAYI_OMRU_MS, 30 * dk);
  assert.equal(olayGecerliMi(yasli('fuber', 0), SIMDI), true);
  assert.equal(olayGecerliMi(yasli('fuber', 29 * dk), SIMDI), true);
  assert.equal(olayGecerliMi(yasli('fuber', 30 * dk), SIMDI), true, 'tam 30 dk sınırı geçerli');
  assert.equal(olayGecerliMi(yasli('fuber', 30 * dk + 1), SIMDI), false);
  assert.equal(olayGecerliMi(yasli('fuber', 3 * 60 * dk), SIMDI), false);
});

test('bayat: onay yaşa göre düşmez, yalnız geçerlilik denetimine bakar (yanıtlanmışsa düşer)', () => {
  assert.equal(olayGecerliMi(yasli('onay', 9 * dk, () => true), SIMDI), true);
  assert.equal(olayGecerliMi(yasli('onay', 9 * dk, () => false), SIMDI), false);
  assert.equal(olayGecerliMi(yasli('onay', 45 * dk, () => true), SIMDI), true);
});

test('bayat: denetimi olmayan olay geçerli; denetim false dönerse Fuber olayı da düşer; denetim teslim anında sorulur', () => {
  assert.equal(olayGecerliMi(yasli('onay', 0), SIMDI), true);
  assert.equal(olayGecerliMi(yasli('hatirlatma', 99 * dk), SIMDI), true);
  assert.equal(olayGecerliMi(yasli('kullanici', 99 * dk), SIMDI), true);
  assert.equal(olayGecerliMi(yasli('fuber', 0, () => false), SIMDI), false);
  let bekliyor = true;
  const o = yasli('onay', 0, () => bekliyor);
  assert.equal(olayGecerliMi(o, SIMDI), true);
  bekliyor = false;
  assert.equal(olayGecerliMi(o, SIMDI), false, 'olay kuyruğa girdikten SONRA yanıtlandı');
});

// ── Hal önceliği ────────────────────────────────────────────────────────────────────────────────────────────
const bos: AdaDurumu = {
  hal: 'bos', onaySayisi: 0, bildirimVar: false, kartAcik: false, yanitVar: false, sorAcik: false, ekranda: false, motor: 'hazir',
};
const hal = (k: Partial<AdaDurumu>) => adaHaliBul({ ...bos, ...k });

test('hal: hiçbir şey yoksa dinlenme (0.14 R13)', () => {
  assert.equal(hal({}), 'dinlenme');
});

// İş izi (11 Kas): iş izinin işleri görev hapının yerinde; üstüne gelince liste — yalnız gösterecek ek bilgi varken.
test('hal: iş izi — iş varken iş hapı, hover\'da liste; onay ve kullanıcının işi önde; tam ekranda liste yok', () => {
  assert.equal(hal({ isler: 1 }), 'gorev');
  assert.equal(hal({ isler: 3, hover: true }), 'isler');
  assert.equal(hal({ isler: 1, hover: true }), 'isler', 'tek iş görev/sohbet hapı değilse listede yeri görünür');
  assert.equal(hal({ isler: 1, hover: true, calisiyor: { sohbetId: 1, adim: 4, etiket: '' } }), 'gorev', 'tek iş sohbet turunun kendisi: hap yeter');
  assert.equal(hal({ isler: 2, hover: true, calisiyor: { sohbetId: 1, adim: 4, etiket: '' } }), 'isler');
  assert.equal(hal({ isler: 3, hover: true, tamEkran: true }), 'gorev');
  assert.equal(hal({ isler: 3, onaySayisi: 1 }), 'onay');
  assert.equal(hal({ isler: 3, sorAcik: true }), 'sor');
  assert.equal(hal({ isler: 0, hover: true }), 'panel', 'iş yokken hover eskisi gibi panel');
});

test('hal: öncelik zincirinin her basamağı', () => {
  // 1. ekranda her şeyin üstünde
  assert.equal(hal({ ekranda: true, onaySayisi: 2, hal: 'dinliyor', bildirimVar: true, motor: 'durdu' }), 'ekranda');
  // 2. onay
  assert.equal(hal({ onaySayisi: 1, hal: 'dinliyor', bildirimVar: true, yanitVar: true }), 'onay');
  // 3. dinliyor
  assert.equal(hal({ hal: 'dinliyor', yanitVar: true, bildirimVar: true }), 'dinliyor');
  // 4. yazıya / düşünüyor → dusunuyor
  assert.equal(hal({ hal: 'yaziya', yanitVar: true, bildirimVar: true }), 'dusunuyor');
  assert.equal(hal({ hal: 'dusunuyor', bildirimVar: true }), 'dusunuyor');
  assert.equal(hal({ hal: 'dusunuyor', sorAcik: true, motor: 'durdu' }), 'dusunuyor');
  // 5. konuşuyor ya da yanıt var → yanit
  assert.equal(hal({ hal: 'konusuyor', bildirimVar: true }), 'yanit');
  assert.equal(hal({ yanitVar: true, bildirimVar: true, sorAcik: true }), 'yanit');
  // 6. sor (Görev 28 düzeltme 2 (b): kullanıcının açtığı kutu acil olmayan bildirimin önünde): motor yoksa motor-durdu
  assert.equal(hal({ bildirimVar: true, sorAcik: true, motor: 'durdu' }), 'motor-durdu');
  assert.equal(hal({ bildirimVar: true, kartAcik: true, sorAcik: true }), 'sor');
  // 7. bildirim: kart açıksa kart
  assert.equal(hal({ bildirimVar: true }), 'bildirim');
  assert.equal(hal({ bildirimVar: true, kartAcik: true }), 'kart');
  assert.equal(hal({ bildirimVar: true, motor: 'durdu' }), 'bildirim');
  assert.equal(hal({ sorAcik: true }), 'sor');
  assert.equal(hal({ sorAcik: true, motor: 'durdu' }), 'motor-durdu');
  assert.equal(hal({ sorAcik: true, motor: 'durdu', motorKartAcik: false }), 'motor-durdu');
  // 8. motor yok, boşta (A2, son düzeltme): küçük hap; kart yalnız açıldıysa (oturumun ilk inişi, üstüne gelme, tıklama)
  assert.equal(hal({ motor: 'durdu' }), 'motor-hap');
  assert.equal(hal({ motor: 'durdu', motorKartAcik: true }), 'motor-durdu');
  // Motor varken kart bayrağı dinlenmeyi bozmaz.
  assert.equal(hal({ motorKartAcik: true }), 'dinlenme');
});

// 0.11 G10 (spec §8 Görünürlük): "Ada: görev bir adım çalıştırırken ya da ekranı tutarken küçük hap 'Görev: <başlık>' + Durdur." Hapın kuralı TEK
// yerde (bu dosya); arayüz yalnız `gorev` durumunu verir. Hap bir ÇALIŞMA halidir: kullanıcının işini (dinleme, yanıt, soru kutusu), onayı ve
// bildirimi örtmez; onların bittiği yerde görünür. Görev ekranı tutuyorsa "Fuber ekranında çalışıyor" halinin yerini alır (Durdur orada da var).
test('G10: görev hapı — yalnız adım çalışırken; kullanıcının işi, onay ve bildirim hapın önündedir', () => {
  const g = { id: 1, baslik: 'Ahmet’in yanıtını izle', ekran: false };
  assert.equal(hal({ gorev: g }), 'gorev');
  assert.equal(hal({ gorev: null }), 'dinlenme');
  assert.equal(hal({ gorev: undefined }), 'dinlenme');
  // Önündekiler: onay, dinleme, düşünme, yanıt, soru kutusu, bildirim (kart dahil).
  assert.equal(hal({ gorev: g, onaySayisi: 1 }), 'onay');
  assert.equal(hal({ gorev: g, hal: 'dinliyor' }), 'dinliyor');
  assert.equal(hal({ gorev: g, hal: 'dusunuyor' }), 'dusunuyor');
  assert.equal(hal({ gorev: g, hal: 'konusuyor' }), 'yanit');
  assert.equal(hal({ gorev: g, yanitVar: true }), 'yanit');
  assert.equal(hal({ gorev: g, sorAcik: true }), 'sor');
  assert.equal(hal({ gorev: g, sorAcik: true, motor: 'durdu' }), 'motor-durdu');
  assert.equal(hal({ gorev: g, bildirimVar: true }), 'bildirim');
  assert.equal(hal({ gorev: g, bildirimVar: true, kartAcik: true }), 'kart');
  // Arkasındakiler: bağlantı hapı (görev motorsuz çalışamaz, yine de hap boşta olandan önce), sessiz.
  assert.equal(hal({ gorev: g, motor: 'durdu' }), 'gorev');
  assert.equal(hal({ gorev: g, motor: 'durdu', motorKartAcik: true }), 'gorev');
  // Adım bitince (gorev null) hap kalkar, ada kendi boşta hâline döner.
  assert.equal(hal({ gorev: null, motor: 'durdu' }), 'motor-hap');
});

test('G10: görev ekranı tutuyorsa "ekranda" yerine görev hapı; ekranı kullanan kullanıcının turuysa "ekranda" kalır (Alt+Shift+Q ipucu)', () => {
  assert.equal(hal({ ekranda: true }), 'ekranda');
  assert.equal(hal({ ekranda: true, gorev: { id: 1, baslik: 'x', ekran: false } }), 'ekranda', 'adım ekranı tutmuyor: ekran kullanıcının turunun');
  assert.equal(hal({ ekranda: true, gorev: { id: 1, baslik: 'x', ekran: true } }), 'gorev', 'görev ekranı tutuyor');
  assert.equal(hal({ ekranda: true, gorev: { id: 1, baslik: 'x', ekran: true }, onaySayisi: 1, hal: 'dinliyor' }), 'gorev', 'ekran kontrolü sürerken de hap en üstte (onay kartı ekranda tıklanamaz)');
  assert.equal(hal({ ekranda: false, gorev: { id: 1, baslik: 'x', ekran: true } }), 'gorev', 'araçlar arasında ekran bırakılmışken de hap');
});

test('G10: hap metni "Görev: <başlık>"; başlık boşsa yalnız "Görev"; boşluklar sadeleşir', () => {
  assert.equal(gorevHapMetni('Ahmet’in yanıtını izle'), 'Görev: Ahmet’in yanıtını izle');
  assert.equal(gorevHapMetni('  İki   boşluk\n satır '), 'Görev: İki boşluk satır');
  assert.equal(gorevHapMetni(''), 'Görev');
  assert.equal(gorevHapMetni('   '), 'Görev');
});

test('G10: hap metni sözlükten ("Görev" = TERIM.gorev)', () => {
  assert.equal(gorevHapMetni('x'), `${TERIM.gorev}: x`);
  assert.equal(gorevHapMetni(''), TERIM.gorev);
});

// Son inceleme küçük 1: 30 sn'lik bir görev geceyi adayı indirip kaldırarak geçirmesin — sessiz saatte ve "Rahatsız etme"de hap adayı indirmez;
// ekranı tutan adım (Fuber ekranı kullanıyor) istisnadır: Durdur her zaman ulaşılabilir. K4 (uygulama önde), K5 (ada kapalı) ve tam ekran aynen.
test('küçük 1: görev hapı sessiz saatte / rahatsız etmede adayı indirmez — ekranı tutan adım hariç; uygulama önde, ada kapalı, tam ekran yine hayır', () => {
  const k = (o: Partial<Parameters<typeof gorevHapiInsinMi>[0]> = {}) => gorevHapiInsinMi({ anaOnde: false, kapali: false, tamEkran: false, sessiz: false, ekran: false, ...o });
  assert.equal(k(), true, 'olağan saatte, arka planda: hap iner');
  assert.equal(k({ sessiz: true }), false, 'sessiz saat / rahatsız etme: ekransız adım adayı indirmez');
  assert.equal(k({ sessiz: true, ekran: true }), true, 'ekranı tutan adım: sessiz saatte de hap iner (Durdur ulaşılabilir)');
  assert.equal(k({ ekran: true }), true);
  for (const engel of [{ anaOnde: true }, { kapali: true }, { tamEkran: true }]) {
    assert.equal(k(engel), false, JSON.stringify(engel));
    assert.equal(k({ ...engel, ekran: true }), false, `ekran da ${JSON.stringify(engel)} kuralını aşmaz`);
    assert.equal(k({ ...engel, sessiz: true, ekran: true }), false);
  }
});

test('küçük 1: ana süreç hap için açılışı tek kuraldan alır (gorevHapiInsinMi) ve sessizliği zamanlayıcının sessizMi’sinden okur', async () => {
  const fs = await import('node:fs');
  const ada = fs.readFileSync(new URL('../src/main/ada.ts', import.meta.url), 'utf8');
  const govde = /function gorevdeAc\(\): void \{[\s\S]*?\n\}/.exec(ada)?.[0] ?? '';
  assert.match(govde, /gorevHapiInsinMi\(\{ anaOnde: anaOnde\(\), kapali: adaKapali\(\), tamEkran: tam, sessiz: yonlendirici\.sessiz\?\.\(\) \?\? false, ekran: gorevEkranli \}\)/);
  assert.match(ada, /gorevEkranli = Boolean\(g\?\.ekran\);/);
  const ana = fs.readFileSync(new URL('../src/main/main.ts', import.meta.url), 'utf8');
  assert.match(ana, /adaYonlendiriciKur\(\{[\s\S]*?sessiz: \(\) => sessizMi\(\),[\s\S]*?\}\);/);
});

// ── G10 düzeltme turu 1: Durdur ve ekran kontrolü — fare yakalama + pencerenin yaşam döngüsü (saf; src/main/ada.ts bunu uygular) ──────────────────────────
// Gerçek olay sırası: Durdur tıklanır → ana süreçte görev durur → `isler:durum` (adım yok) → `ada:gorev` null (hap kalkar) → bilgisayar kontrolü 1,2–4 sn
// SONRA biter (imlec.ts kontrolBitirSonra) → `ada:kontrol` false. Eskiden hap altından kalkınca `mouseleave` hiç gelmiyor, yakalama bayrağı takılı kalıyor ve
// hap için açılan pencere kontrol bitince kapanmıyordu.
const adim = (d: AdaYasami, ...olaylar: AdaYasamOlayi[]) => olaylar.reduce((s, o) => { const r = adaYasamAdimi(s.durum, o); return { durum: r.durum, gizle: s.gizle || r.gizle, hepsi: [...s.hepsi, r.gizle] }; }, { durum: d, gizle: false, hepsi: [] as boolean[] });
/** Pencere hap için açıldı (gorevAcmisti) ve görev adımı sürüyor. */
const hapAcik: AdaYasami = { ...ADA_YASAM_ILK, gorevde: true, gorevAcmisti: true };

test('G10: fare yakalama kuralı — imleç şekilde ve Fuber ekranı kullanmıyorken; kontrol sürerken yalnız Durdur düğmesinin üstünde', () => {
  const y = (fareUzerinde: boolean, durdurUzerinde: boolean, kontrolde: boolean) => fareYakalansinMi({ fareUzerinde, durdurUzerinde, kontrolde });
  assert.equal(y(false, false, false), false, 'imleç şekilde değil: alta geçer');
  assert.equal(y(true, false, false), true, 'imleç şekilde, kontrol yok: yakalanır');
  assert.equal(y(true, false, true), false, 'kontrol sürerken şekil tıklamayı alta geçirir (Fuber’in tıklaması adaya takılmasın)');
  assert.equal(y(true, true, true), true, 'kontrol sürerken yalnız Durdur düğmesinin üstü yakalanır');
  assert.equal(y(false, true, true), false, 'imleç şekilde değilse düğme bayrağı tek başına yetmez');
});

test('G10: Durdur (ekran kontrolü sürerken) — hap altından kalkar, kontrol sonra biter: yakalama bırakılır, hap için açılan pencere kapanır', () => {
  // Gerçek sıra: imleç Durdur'a girer → tıklanır → ada:gorev null → (arayüz ada:fare(false, false) der) → 1,2–4 sn sonra ada:kontrol false.
  const kontrolde = adim(hapAcik, { tur: 'kontrol', acik: true }, { tur: 'fare', uzerinde: true, durdur: true });
  assert.equal(fareYakalansinMi(kontrolde.durum), true, 'kontrol sürerken Durdur yakalanır');
  const hapKalkti = adim(kontrolde.durum, { tur: 'gorev', var: false });
  assert.equal(hapKalkti.durum.durdurUzerinde, false, 'hap kalkınca Durdur bayrağı sıfırlanır (mouseleave hiç gelmez)');
  assert.equal(hapKalkti.durum.gorevAcmisti, true, 'kontrol sürerken pencere kapanmaz ve "hap için açıldı" bayrağı korunur');
  assert.equal(hapKalkti.gizle, false);
  // Arayüz (ada:gorev null gelince) ada:fare(şeklin durumu, false) der: şekilde değilse yakalama kapanır.
  const arayuz = adim(hapKalkti.durum, { tur: 'fare', uzerinde: false, durdur: false });
  assert.equal(fareYakalansinMi(arayuz.durum), false);
  const bitis = adim(arayuz.durum, { tur: 'kontrol', acik: false });
  assert.equal(bitis.gizle, true, 'kontrol bitince hap için açılan pencere kapanır');
  assert.equal(fareYakalansinMi(bitis.durum), false, 've fare yakalama kapalı');
  assert.deepEqual([bitis.durum.gorevAcmisti, bitis.durum.kontrolAcmisti, bitis.durum.fareUzerinde, bitis.durum.durdurUzerinde], [false, false, false, false]);
});

test('G10: arayüz ada:fare(false) demese de (hap altından kalktı) kontrol bitince yakalama bırakılır — pencere kapanınca bayraklar sıfırlanır', () => {
  const s = adim(hapAcik, { tur: 'kontrol', acik: true }, { tur: 'fare', uzerinde: true, durdur: true }, { tur: 'gorev', var: false }, { tur: 'kontrol', acik: false });
  assert.equal(s.gizle, true);
  assert.equal(fareYakalansinMi(s.durum), false);
});

test('G10: sıra tersi — kontrol önce biterse (adım sürerken) pencere hap için açık kalır; adım bitince kapanır', () => {
  const kontrolBitti = adim(hapAcik, { tur: 'kontrol', acik: true }, { tur: 'kontrol', acik: false });
  assert.equal(kontrolBitti.gizle, false, 'adım hâlâ sürüyor: hap kalır');
  assert.equal(kontrolBitti.durum.gorevAcmisti, true);
  const adimBitti = adim(kontrolBitti.durum, { tur: 'gorev', var: false });
  assert.equal(adimBitti.gizle, true, 'adım bitince (kontrol yok) kapanır');
});

test('G10: kontrol yokken adım bitince hap için açılan pencere hemen kapanır; hap için AÇILMAMIŞ pencere (kullanıcı ya da sessiz ada) kapanmaz', () => {
  assert.equal(adim(hapAcik, { tur: 'gorev', var: false }).gizle, true);
  const baskasi: AdaYasami = { ...ADA_YASAM_ILK, gorevde: true }; // pencere zaten açıktı (sessiz ada, kullanıcının soru kutusu…)
  const s = adim(baskasi, { tur: 'kontrol', acik: true }, { tur: 'gorev', var: false }, { tur: 'kontrol', acik: false });
  assert.equal(s.gizle, false);
  assert.equal(adim(baskasi, { tur: 'gorev', var: false }).gizle, false);
});

test('G10: yalnız kontrol için açılan pencere (kontrolAcmisti) kontrol bitince kapanır — bugünkü kural aynen; imleç şekilden çıkınca Durdur bayrağı da düşer', () => {
  const kontrolIcin: AdaYasami = { ...ADA_YASAM_ILK, kontrolAcmisti: true, kontrolde: true };
  assert.equal(adim(kontrolIcin, { tur: 'kontrol', acik: false }).gizle, true);
  const s = adim(ADA_YASAM_ILK, { tur: 'fare', uzerinde: true, durdur: true }, { tur: 'fare', uzerinde: false, durdur: true });
  assert.equal(s.durum.durdurUzerinde, false, 'şekilden çıkınca düğme üstünde sayılmaz');
  assert.equal(s.durum.fareUzerinde, false);
});

// ── G10 düzeltme turu 2 (N1): ekran denetimi YOKKEN hap açmış pencerede Durdur — gecikmiş `ada:fare(true, false)` yakalamayı yeniden kurmasın ──────────────────────────
// Sıra: imleç şekle + Durdur'a girer (arayüz uzerinde=true, durdurUstunde=true) → Durdur tıklanır → ana süreç `adaGorevAdimi(null)`: bayraklar sıfırlanır, pencere gizlenir →
// arayüzün `ada:gorev` null işleyicisi `ada:fare(uzerinde.current === true, false)` yollar (IPC gidiş-dönüşü SONRA) → arayüz temizle(): uzerinde=false (ve ana sürece `ada:fare(false)`).
const imlecDurdurda = (d: AdaYasami) => adim(d, { tur: 'fare', uzerinde: true, durdur: false, gorunur: true }, { tur: 'fare', uzerinde: true, durdur: true, gorunur: true });

test('G10 (N1): hap pencereyi açtı, kontrol yok, imleç şekilde + Durdur\'da → adım biter: sonradan gelen ada:fare(true, false) pencere görünmezken yok sayılır', () => {
  const durdurda = imlecDurdurda(hapAcik);
  assert.equal(fareYakalansinMi(durdurda.durum), true, 'Durdur\'a basılırken yakalama açık (tıklama adaya gider)');
  const kalkti = adim(durdurda.durum, { tur: 'gorev', var: false });
  assert.equal(kalkti.gizle, true, 'kontrol yok: hap için açılan pencere hemen kapanır');
  assert.deepEqual([kalkti.durum.fareUzerinde, kalkti.durum.durdurUzerinde], [false, false], 'ana süreç bayrakları sıfırladı');
  // Gecikmiş yanıt: ana süreç pencereyi gizledikten SONRA gelir → pencere görünür değil.
  const bayat = adim(kalkti.durum, { tur: 'fare', uzerinde: true, durdur: false, gorunur: false });
  assert.equal(bayat.durum.fareUzerinde, false, 'görünmez pencerede "imleç üstünde" yok sayılır');
  assert.equal(fareYakalansinMi(bayat.durum), false, 'yakalama yeniden kurulmadı');
  // Sonraki gösterimde de yakalama kapalı (gösterim bayrakları değiştirmez; yalnız yeni gerçek fare olayı yakalar).
  const sonra = adim(bayat.durum, { tur: 'gorev', var: true }, { tur: 'kontrol', acik: true }, { tur: 'kontrol', acik: false });
  assert.equal(fareYakalansinMi(sonra.durum), false, 'sonraki gösterimde 480×480 kutu tıklama yutmaz');
});

test('G10 (N1): çıkış (false) pencere görünmezken de işlenir; gorunur verilmezse görünür sayılır; görünür pencerede gerçek giriş yakalar', () => {
  const sag = adim({ ...ADA_YASAM_ILK, fareUzerinde: true, durdurUzerinde: true }, { tur: 'fare', uzerinde: false, durdur: false, gorunur: false });
  assert.deepEqual([sag.durum.fareUzerinde, sag.durum.durdurUzerinde], [false, false]);
  assert.equal(adim(ADA_YASAM_ILK, { tur: 'fare', uzerinde: true, durdur: false }).durum.fareUzerinde, true, 'gorunur verilmedi: eski davranış');
  assert.equal(adim(ADA_YASAM_ILK, { tur: 'fare', uzerinde: true, durdur: true, gorunur: false }).durum.durdurUzerinde, false, 'görünmezken Durdur bayrağı da kurulmaz');
  assert.equal(fareYakalansinMi(adim(ADA_YASAM_ILK, { tur: 'fare', uzerinde: true, durdur: false, gorunur: true }).durum), true);
});

test('G10 (N1): pencere GÖRÜNÜR kalıyorsa (sessiz ada) gecikmiş true yakalamayı kurar — arayüz temizle()\'si son ada:fare(false)\'ı yollayınca kapanır', () => {
  // Ana süreç tarafı tek başına yetmez (pencere görünür): ikinci katman arayüzdür. IPC sırası: gecikmiş true → temizle'nin false'u.
  const durdurda = imlecDurdurda({ ...ADA_YASAM_ILK, gorevde: true }); // sessiz ada: pencere hap için açılmadı, kapanmaz
  const kalkti = adim(durdurda.durum, { tur: 'gorev', var: false });
  assert.equal(kalkti.gizle, false);
  const gecikmis = adim(kalkti.durum, { tur: 'fare', uzerinde: true, durdur: false, gorunur: true });
  assert.equal(fareYakalansinMi(gecikmis.durum), true, 'tek katmanda bayat yakalama kalırdı (reviewer yeniden üretimi)');
  const temizle = adim(gecikmis.durum, { tur: 'fare', uzerinde: false, durdur: false, gorunur: true });
  assert.equal(fareYakalansinMi(temizle.durum), false, 'temizle() ada:fare(false) yolladı: son durum "yakalama yok"');
});

test('G10 (kapsam dışı): Durdur düğmesi onay/bildirim hapının altında kalıp mouseleave olmadan sökülünce bayrak düşer (ekran kontrolü sürerken pencere yakalamayı bırakır)', () => {
  const dizi: Array<[Parameters<typeof durdurSokuldu>[0], boolean, boolean]> = [
    ['gorev', true, false], // düğme duruyor
    ['onay', true, true],   // onay hapı ezdi: düğme söküldü
    ['bildirim', true, true],
    ['onay', false, false], // zaten düşmüş
    ['gorev', false, false],
  ];
  for (const [hal, ustunde, beklenen] of dizi) assert.equal(durdurSokuldu(hal, ustunde), beklenen, `${hal} / üstünde ${ustunde}`);
  // Ana süreç tarafı: kontrol sürerken Durdur'da duran imleç; hap onay hapına dönünce arayüz ada:fare(uzerinde=false, false) yollar → yakalama kapanır.
  const kontrolde = adim(hapAcik, { tur: 'kontrol', acik: true }, { tur: 'fare', uzerinde: true, durdur: true, gorunur: true });
  assert.equal(fareYakalansinMi(kontrolde.durum), true);
  const ezildi = adim(kontrolde.durum, { tur: 'fare', uzerinde: false, durdur: false, gorunur: true });
  assert.equal(fareYakalansinMi(ezildi.durum), false);
  assert.equal(ezildi.durum.durdurUzerinde, false);
});

test('G10 (N1): arayüz kaynağı — temizle() ana sürece ada:fare(false, false) söyler ve bayrakları düşürür; hal değişimi durdurSokuldu ile; hata satırı CSS\'i başlığınkini ezer', async () => {
  const { readFileSync } = await import('node:fs');
  const kaynak = readFileSync(new URL('../src/renderer/ada/useAsistan.ts', import.meta.url), 'utf8');
  const temizle = kaynak.slice(kaynak.indexOf('const temizle = () => {'), kaynak.indexOf('const sohbetiTemizle = () => {'));
  assert.match(temizle, /const fareVardi = uzerinde\.current \|\| durdurUstunde\.current;/);
  assert.match(temizle, /uzerinde\.current = false;\s*durdurUstunde\.current = false;/);
  assert.match(temizle, /if \(fareVardi\) void Promise\.resolve\(cagir\('ada:fare', false, false\)\)/, 'ana süreç haberdar edilir (IPC sırası: gecikmiş true\'dan sonra false)');
  assert.match(kaynak, /durdurSokuldu\(gorunen, durdurUstunde\.current\)[\s\S]{0,200}cagir\('ada:fare', uzerinde\.current, false\)/, 'hal değişiminde Durdur bayrağı düşer');
  const ana = readFileSync(new URL('../src/main/ada.ts', import.meta.url), 'utf8');
  assert.match(ana, /yasamAdimi\(\{ tur: 'fare', uzerinde, durdur, gorunur: Boolean\(canli\(\)\?\.isVisible\(\)\) \}\)/, 'ana süreç pencere görünürlüğünü saf kurala verir');
  const css = readFileSync(new URL('../src/renderer/ada/ada.css', import.meta.url), 'utf8');
  assert.match(css, /^\.ada__gorev \.ada__gorev-hata \{[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/m, 'özgüllük (0,2,0) başlık kuralına eşit ve ondan SONRA: tek satır + …');
  assert.ok(css.indexOf('.ada__gorev .ada__gorev-hata') > css.indexOf('.ada__gorev .ada__baslik'), 'hata kuralı başlık kuralından sonra');
});

test('0.10 Görev 2 (C-1, A-3): hiç bağlanmamışken ada NORMAL sessiz (kırmızı hap yok); hap yalnız gerçekten kopunca; soru kutusu motor kartı', () => {
  assert.equal(hal({ motor: 'bagli-degil' }), 'dinlenme', 'bağlı değil: hap yok');
  assert.equal(hal({ motor: 'bagli-degil', motorKartAcik: true }), 'dinlenme', 'oturumun ilk inişinde de kart inmez');
  assert.equal(hal({ motor: 'hesap-bekliyor', motorKartAcik: true }), 'dinlenme', 'onay bekliyor: sakin');
  assert.equal(hal({ motor: 'durdu' }), 'motor-hap');
  assert.equal(hal({ motor: 'hesap-kapali' }), 'motor-hap');
  assert.equal(hal({ motor: 'kredi-bitti' }), 'motor-hap');
  assert.equal(hal({ motor: 'yerel' }), 'dinlenme');
  // Soru kutusu: yanıt verilemiyorsa (motor yok) motor kartı; yalnız yerel model varken soru kutusu.
  for (const m of ['bagli-degil', 'durdu', 'hesap-bekliyor', 'hesap-kapali', 'kredi-bitti'] as const) assert.equal(hal({ sorAcik: true, motor: m }), 'motor-durdu', m);
  assert.equal(hal({ sorAcik: true, motor: 'yerel' }), 'sor');
  assert.equal(hal({ sorAcik: true, motor: 'hazir' }), 'sor');
  assert.equal(MOTOR_HAP_METNI, 'Bağlantı koptu');
});

test('B10: kullanıcı soru kutusuna yazarken gelen onay ya da bildirim kutunun yerine geçmez; gönderince/kapatınca iner', () => {
  // Yazıyor: kutu kalır (onay ve bildirim sırada bekler).
  assert.equal(hal({ sorAcik: true, yaziyor: true, onaySayisi: 1 }), 'sor');
  assert.equal(hal({ sorAcik: true, yaziyor: true, bildirimVar: true }), 'sor');
  // Kutu boşsa (yazı yok): onay öne geçer. Görev 28 düzeltme 2 (b): kullanıcının açtığı soru kutusu (kısayol, tepsi, çip) ACİL
  // OLMAYAN bildirimin önündedir — bildirim kutudaki "Bildirim var" çipinde bekler, kutu kapanınca iner (kart açılmış olsa da).
  assert.equal(hal({ sorAcik: true, onaySayisi: 1 }), 'onay');
  assert.equal(hal({ sorAcik: true, bildirimVar: true }), 'sor');
  assert.equal(hal({ sorAcik: true, bildirimVar: true, kartAcik: true }), 'sor');
  assert.equal(hal({ sorAcik: true, bildirimVar: true, motor: 'durdu' }), 'motor-durdu');
  assert.equal(hal({ bildirimVar: true }), 'bildirim');
  // Gönderdi (kutu kapandı, tur düşünüyor) ya da kapattı: onay iner.
  assert.equal(hal({ yaziyor: true, onaySayisi: 1, hal: 'dusunuyor' }), 'onay');
  assert.equal(hal({ yaziyor: true, onaySayisi: 1 }), 'onay');
  // Ekranda yine her şeyin üstünde.
  assert.equal(hal({ sorAcik: true, yaziyor: true, ekranda: true }), 'ekranda');
});

test('Görev 28 düzeltme 2 (b): kısayol — yalnız Fuber bildirimi için açık adayı kapatmaz, sormak için açar; kullanıcının işi/onay/kontrol kapanır', () => {
  const d = (x: Partial<Parameters<typeof kisayolKarari>[0]> = {}) => kisayolKarari({ acik: true, kullaniciActi: false, onayVar: false, kontrolde: false, ...x });
  assert.equal(kisayolKarari({ acik: false, kullaniciActi: false, onayVar: false, kontrolde: false }), 'ac');
  assert.equal(d(), 'ac', 'bildirim hapı görünürken kısayol soru kutusunu açar');
  assert.equal(d({ kullaniciActi: true }), 'gizle');
  assert.equal(d({ onayVar: true }), 'gizle');
  assert.equal(d({ kontrolde: true }), 'gizle');
  assert.equal(d({ hatirlatmaVar: true }), 'gizle', 'hatırlatıcı acil sayılır: kısayol kapatır (eski kural)');
});

test('Görev 28 düzeltme 3: hatırlatıcı her yolda acil — sırada önde, soru kutusunda kendi çipi, boş kutuyu açarken iner; bilgi bildirimi değişmez', () => {
  type B = { no: number; kaynak: 'hatirlatma' | 'fuber' };
  const l: B[] = [{ no: 1, kaynak: 'fuber' }, { no: 2, kaynak: 'fuber' }];
  // Sıra: hatırlatıcı acil olmayanların önüne geçer (kendi aralarında geliş sırası); bilgi sona eklenir.
  assert.deepEqual(bildirimSiraya(l, { no: 3, kaynak: 'hatirlatma' }).map((b) => b.no), [3, 1, 2]);
  assert.deepEqual(bildirimSiraya([{ no: 3, kaynak: 'hatirlatma' }, ...l], { no: 4, kaynak: 'hatirlatma' }).map((b) => b.no), [3, 4, 1, 2]);
  assert.deepEqual(bildirimSiraya(l, { no: 5, kaynak: 'fuber' }).map((b) => b.no), [1, 2, 5]);
  // Kullanıcı kutuyu hatırlatıcının üstüne açtı (tepsi/çip): kutu açılır, hatırlatıcı "Bildirim var"a gömülmez — kendi çipi (başlığıyla).
  assert.equal(hal({ sorAcik: true, bildirimVar: true, bildirimTuru: 'hatirlatma' }), 'sor');
  assert.deepEqual(bekleyenCip({ ...bos, sorAcik: true, bildirimVar: true, bildirimTuru: 'hatirlatma' }, 'İlaç saati'), { tur: 'hatirlatma', metin: 'Hatırlatıcı · İlaç saati' });
  assert.deepEqual(bekleyenCip({ ...bos, sorAcik: true, bildirimVar: true, bildirimTuru: 'bilgi' }), { tur: 'bilgi', metin: 'Bildirim var' });
  assert.deepEqual(bekleyenCip({ ...bos, sorAcik: true, onaySayisi: 1, bildirimVar: true, bildirimTuru: 'hatirlatma' }, 'x'), { tur: 'onay', metin: 'Onay bekliyor' });
  assert.equal(bekleyenCip({ ...bos, sorAcik: true }), null);
  // BOŞ kutu açıkken gelen hatırlatıcı iner (kutu kapanır; yazılmış bir şey yoktu); yazarken (B10) kutu kalır, hatırlatıcı çipte.
  assert.equal(hatirlatmaKutuyuKapatirMi({ ...bos, sorAcik: true }), true);
  assert.equal(hatirlatmaKutuyuKapatirMi({ ...bos, sorAcik: true, yaziyor: true }), false);
  assert.equal(hatirlatmaKutuyuKapatirMi({ ...bos, sorAcik: false }), false);
  assert.equal(hatirlatmaKutuyuKapatirMi({ ...bos, sorAcik: true, hal: 'dinliyor' }), false);
  // Bilgi bildirimi (ör. "Claude Code bitirdi") eskisi gibi: kutu önde, "Bildirim var" çipi.
  assert.equal(hal({ sorAcik: true, bildirimVar: true, bildirimTuru: 'bilgi' }), 'sor');
  assert.equal(hal({ bildirimVar: true, bildirimTuru: 'hatirlatma' }), 'bildirim');
});

test('A2: boşta + motorsuz hap boşta ölçüsünde (32 px boy), kart değil; kart en geniş halin eni', () => {
  const h = adaOlcusu('motor-hap');
  assert.equal(h.boy, adaOlcusu('sessiz').boy);
  assert.ok(typeof h.en === 'number' && h.en < adaOlcusu('bildirim').en, `hap eni ${h.en}`);
  assert.deepEqual(adaOlcusu('motor-durdu'), { en: 440, boy: 'icerik' });
});

test('hal: kart yalnız bildirim varken anlamlı; tek başına açık bayrak dinlenmeyi bozmaz', () => {
  assert.equal(hal({ kartAcik: true }), 'dinlenme');
});

// ── Görünürlük (K4, K5): ana pencere önde, ada kapalı / 1 saat gizli ───────────────────────────────────────────
const k = (x: Partial<AdaKosulu> = {}): AdaKosulu => ({ tamEkran: false, anaOnde: false, kapali: false, ...x });
const KAYNAKLAR: AdaKaynak[] = ['kullanici', 'hatirlatma', 'onay', 'fuber'];

test('yol: olağan hâlde adaya iner (0.13 T7: Fuber\'in sözü nokta olur); tam ekranda eski kural (Fuber ve onay bekler)', () => {
  for (const s of KAYNAKLAR) assert.deepEqual(adaYolu(s, k()), { ada: s === 'fuber' ? 'nokta' : 'simdi', tost: false, bildirim: false }, s);
  assert.equal(adaYolu('fuber', k({ tamEkran: true })).ada, 'bekle');
  assert.equal(adaYolu('onay', k({ tamEkran: true })).ada, 'bekle');
  assert.equal(adaYolu('hatirlatma', k({ tamEkran: true })).ada, 'simdi');
  assert.equal(adaYolu('kullanici', k({ tamEkran: true })).ada, 'simdi');
});

test('yol: kullanıcının kendi çağrısı (kısayol, "Hey Fuber") her koşulda adaya iner', () => {
  for (const x of [k({ anaOnde: true }), k({ kapali: true }), k({ anaOnde: true, kapali: true, tamEkran: true })]) {
    assert.deepEqual(adaYolu('kullanici', x), { ada: 'simdi', tost: false, bildirim: false });
  }
});

test('yol (K4): ana pencere öndeyken hatırlatma ve Fuber mesajı adaya değil tosta; onay tost olur ve kuyrukta bekler', () => {
  assert.deepEqual(adaYolu('hatirlatma', k({ anaOnde: true })), { ada: 'yok', tost: true, bildirim: false });
  assert.deepEqual(adaYolu('fuber', k({ anaOnde: true })), { ada: 'yok', tost: true, bildirim: false });
  assert.deepEqual(adaYolu('onay', k({ anaOnde: true })), { ada: 'bekle', tost: true, bildirim: false });
  // Tam ekran da olsa aynı: uygulama önde.
  assert.deepEqual(adaYolu('fuber', k({ anaOnde: true, tamEkran: true })), { ada: 'yok', tost: true, bildirim: false });
});

test('yol (K5): ada kapalı/gizliyken hiçbir şey adaya inmez; hatırlatma ve onay Windows bildirimi olur, Fuber\'in sözü düşer', () => {
  assert.deepEqual(adaYolu('hatirlatma', k({ kapali: true })), { ada: 'yok', tost: false, bildirim: true });
  assert.deepEqual(adaYolu('onay', k({ kapali: true })), { ada: 'yok', tost: false, bildirim: true });
  assert.deepEqual(adaYolu('fuber', k({ kapali: true })), { ada: 'yok', tost: false, bildirim: false });
  assert.deepEqual(adaYolu('hatirlatma', k({ kapali: true, tamEkran: true })), { ada: 'yok', tost: false, bildirim: true });
});

test('yol: ada kapalı ama uygulama önde → tost (Windows bildirimi değil); onay kuyruğa girmez (ada hiç inmeyecek)', () => {
  assert.deepEqual(adaYolu('hatirlatma', k({ kapali: true, anaOnde: true })), { ada: 'yok', tost: true, bildirim: false });
  assert.deepEqual(adaYolu('onay', k({ kapali: true, anaOnde: true })), { ada: 'yok', tost: true, bildirim: false });
});

test('yol: adada bekleyenler için yeniden iniş tost/bildirim olmaz; uygulama öndeyken bekler, ada kapalıyken düşer', () => {
  assert.deepEqual(adaYolu('hatirlatma', k(), true), { ada: 'simdi', tost: false, bildirim: false });
  assert.deepEqual(adaYolu('fuber', k({ tamEkran: true }), true), { ada: 'bekle', tost: false, bildirim: false });
  assert.deepEqual(adaYolu('hatirlatma', k({ anaOnde: true }), true), { ada: 'bekle', tost: false, bildirim: false });
  assert.deepEqual(adaYolu('hatirlatma', k({ kapali: true }), true), { ada: 'yok', tost: false, bildirim: false });
});

test('kuyruk (K4): ana pencere öndeyken hiçbir şey çıkmaz, kaybolmaz; arkaya geçince öncelik sırasıyla gelir', () => {
  const q = new AdaKuyrugu();
  const mesaj = olay('fuber'), onay = olay('onay');
  q.ekle(mesaj); q.ekle(onay);
  assert.equal(q.al(false, true), undefined);
  assert.equal(q.al(true, true), undefined);
  assert.equal(q.uzunluk, 2);
  assert.equal(q.al(false), onay);
  assert.equal(q.al(false, false), mesaj);
});

test('süre: ISO bitiş gelecekteyse sürüyor; geçmiş, boş ya da bozuksa sürmüyor', () => {
  const t = Date.parse('2026-10-24T12:00:00Z');
  assert.equal(sureSuruyor('2026-10-24T13:00:00Z', t), true);
  assert.equal(sureSuruyor('2026-10-24T12:00:00Z', t), false, 'tam bitiş anında biter');
  assert.equal(sureSuruyor('2026-10-24T11:59:00Z', t), false);
  assert.equal(sureSuruyor(undefined, t), false);
  assert.equal(sureSuruyor('', t), false);
  assert.equal(sureSuruyor('bozuk', t), false);
  assert.equal(sureSuruyor(null, t), false);
});

test('ada kapalı mı: "kapali" seçili ya da 1 saat gizleme sürüyor; gizleme bitince kendiliğinden açılır', () => {
  const t = Date.parse('2026-10-24T12:00:00Z');
  assert.equal(adaKapaliMi({ ada: 'goster' }, t), false);
  assert.equal(adaKapaliMi({}, t), false, 'eski ayar (alan yok) = göster');
  assert.equal(adaKapaliMi({ ada: 'kapali' }, t), true);
  assert.equal(adaKapaliMi({ ada: 'goster', adaGizliBitis: '2026-10-24T12:59:00Z' }, t), true);
  assert.equal(adaKapaliMi({ ada: 'goster', adaGizliBitis: '2026-10-24T12:59:00Z' }, t + 60 * dk), false, '1 saat sonra');
  assert.equal(adaKapaliMi(undefined, t), false);
});

// ── 0.13 T7: çentik — her temada siyah, hover selamı, Fuber'in sessiz mesajı ───────────────────────────────────────────────────
// Çentik üzerine gelince büyür ve "nasıl yardımcı olabilirim" der; çentik siyahtır; kendi kendine açılmaz.
// Çentiği yalnız üç şey açar: kullanıcının kendi çağrısı, zamanı gelen hatırlatıcı, onay isteği. Fuber'in kendi sözü noktada bekler.
const SESSIZ_MESAJ: Partial<AdaDurumu> = { bildirimVar: true, bildirimTuru: 'bilgi', bildirimSessiz: true };

test('T7/T23: boşta hover panel olur; panel 560×188, gecikmeler 60/80 ms (panelin kapanışı 300 ms)', () => {
  assert.equal(hal({ hover: true }), 'panel');
  assert.deepEqual(adaOlcusu('panel'), { en: 560, boy: 188 });
  assert.equal(HOVER_GECIKME_MS, 60);
  assert.equal(HOVER_CIKIS_MS, 80);
});

test('T7: onay hover üstündedir; kullanıcının işi, hatırlatıcı ve görev hapı da panele ezilmez', () => {
  assert.equal(hal({ hover: true, onaySayisi: 1 }), 'onay');
  assert.equal(hal({ hover: true, hal: 'dinliyor' }), 'dinliyor');
  assert.equal(hal({ hover: true, yanitVar: true }), 'yanit');
  assert.equal(hal({ hover: true, sorAcik: true }), 'sor');
  assert.equal(hal({ hover: true, bildirimVar: true, bildirimTuru: 'hatirlatma' }), 'bildirim');
  assert.equal(hal({ hover: true, ekranda: true }), 'ekranda');
  assert.equal(hal({ hover: true, gorev: { id: 1, baslik: 'x', ekran: false } }), 'gorev', 'Durdur imlecin altından kaybolmaz');
  assert.equal(hal({ hover: true, motor: 'durdu' }), 'motor-hap', 'hapın kendi hover kuralı var (MOTOR_UZERINE_MS)');
});

test('T7: tam ekranda hover panel olmaz, noktadaki mesajı da açmaz', () => {
  assert.equal(hal({ hover: true, tamEkran: true }), 'dinlenme');
  assert.equal(hal({ ...SESSIZ_MESAJ, hover: true, tamEkran: true }), 'sessiz', 'mesaj noktası Kapalı hapta kalır');
});

test('T7: Fuber mesajı adayı açmaz (nokta); hatırlatma, onay ve kullanıcı açar; tost ve Windows bildirimi değişmez', () => {
  assert.deepEqual(adaYolu('fuber', k()), { ada: 'nokta', tost: false, bildirim: false });
  assert.equal(adaYolu('hatirlatma', k()).ada, 'simdi');
  assert.equal(adaYolu('onay', k()).ada, 'simdi');
  assert.equal(adaYolu('kullanici', k()).ada, 'simdi');
  // Uygulama önde: tost aynen; ada kapalı: Fuber'in sözü düşer; tam ekran: bekler (bitince yine adayı açmadan nokta olur).
  assert.deepEqual(adaYolu('fuber', k({ anaOnde: true })), { ada: 'yok', tost: true, bildirim: false });
  assert.deepEqual(adaYolu('fuber', k({ kapali: true })), { ada: 'yok', tost: false, bildirim: false });
  assert.equal(adaYolu('fuber', k({ tamEkran: true })).ada, 'bekle');
  // Yeniden iniş de adayı açamaz: Fuber'in sözü kendiliğinden inmez; adada bekleyen onay ise iner.
  assert.equal(adaYolu('fuber', k(), true).ada, 'nokta');
  assert.equal(adaYolu('onay', k(), true).ada, 'simdi');
});

test('T7: sessiz mesaj sessiz çentikte noktadır; üzerine gelince mesaj görünür', () => {
  assert.equal(hal(SESSIZ_MESAJ), 'sessiz');
  assert.equal(fuberNoktasiVar({ ...bos, ...SESSIZ_MESAJ }), true);
  assert.equal(hal({ ...SESSIZ_MESAJ, hover: true }), 'bildirim');
  assert.equal(hal({ ...SESSIZ_MESAJ, hover: true, kartAcik: true }), 'bildirim', 'hover yalnız hap gösterir: kart (ve ses) ancak tıklanınca');
  assert.equal(fuberNoktasiVar({ ...bos, ...SESSIZ_MESAJ, hover: true }), false, 'mesaj görünürken nokta yok');
  assert.equal(fuberNoktasiVar(bos), false);
  assert.equal(fuberNoktasiVar({ ...bos, ...SESSIZ_MESAJ, hover: true, tamEkran: true }), true, 'tam ekranda hover açmaz, nokta kalır');
});

test('T7: sessiz mesaj başka işi örtmez, noktası da yalnız sessiz çentikte görünür', () => {
  const g = { id: 1, baslik: 'x', ekran: false };
  assert.equal(hal({ ...SESSIZ_MESAJ, gorev: g, hover: true }), 'gorev', 'hover Durdur düğmesini mesaja çevirmez');
  assert.equal(hal({ ...SESSIZ_MESAJ, motor: 'durdu' }), 'motor-hap');
  assert.equal(hal({ ...SESSIZ_MESAJ, onaySayisi: 1 }), 'onay');
  assert.equal(hal({ ...SESSIZ_MESAJ, sorAcik: true }), 'sor');
  assert.equal(hal({ ...SESSIZ_MESAJ, yanitVar: true }), 'yanit');
  for (const x of [{ gorev: g }, { onaySayisi: 1 }, { sorAcik: true }, { yanitVar: true }, { motor: 'durdu' as const }]) assert.equal(fuberNoktasiVar({ ...bos, ...SESSIZ_MESAJ, ...x }), false, JSON.stringify(x));
  // Soru kutusundaki "Bildirim var" çipi aynen (mesaj orada da gömülmez).
  assert.deepEqual(bekleyenCip({ ...bos, ...SESSIZ_MESAJ, sorAcik: true }), { tur: 'bilgi', metin: 'Bildirim var' });
  // Sessiz olmayan bildirimler eskisi gibi iner: hatırlatıcı ve izin isteyen Claude Code bildirimi.
  assert.equal(hal({ bildirimVar: true, bildirimTuru: 'hatirlatma' }), 'bildirim');
  assert.equal(hal({ bildirimVar: true, bildirimTuru: 'bilgi' }), 'bildirim');
});

// Baştaki bildirimin sessizliği adayı belirler (AdaDurumu.bildirimSessiz): karar bekleyen bildirim bekleyen sessiz mesajın arkasına düşerse ada açılır ama hal 'sessiz' kalır.
test('T7: sıra: hatırlatıcı > karar bekleyen bildirim > sessiz mesaj; aynı sınıfta geliş sırası', () => {
  type B = { no: number; kaynak: 'hatirlatma' | 'fuber'; sessiz?: boolean };
  const sessiz1: B = { no: 1, kaynak: 'fuber', sessiz: true }, sessiz2: B = { no: 2, kaynak: 'fuber', sessiz: true };
  const izin: B = { no: 3, kaynak: 'fuber', sessiz: false }, izin2: B = { no: 4, kaynak: 'fuber', sessiz: false };
  const hat: B = { no: 5, kaynak: 'hatirlatma', sessiz: false };
  assert.deepEqual(bildirimSiraya([sessiz1, sessiz2], izin).map((b) => b.no), [3, 1, 2], 'izin isteği sessiz mesajların önüne geçer');
  assert.deepEqual(bildirimSiraya([izin, sessiz1], izin2).map((b) => b.no), [3, 4, 1], 'izinler kendi aralarında geliş sırasıyla');
  assert.deepEqual(bildirimSiraya([izin, sessiz1], hat).map((b) => b.no), [5, 3, 1], 'hatırlatıcı en önde');
  assert.deepEqual(bildirimSiraya([hat, izin], sessiz1).map((b) => b.no), [5, 3, 1], 'sessiz mesaj en arkada');
  // Sıranın sonucu: baştaki izin isteği adayı gösterir, sessiz mesaj onu örtmez.
  const l = bildirimSiraya([sessiz1], izin);
  assert.equal(hal({ bildirimVar: true, bildirimTuru: 'bilgi', bildirimSessiz: l[0].sessiz }), 'bildirim');
});

test('T7: noktadaki mesajın ömrü kuyruktakiyle aynı (30 dk); sınır dahil taze', () => {
  assert.equal(sessizMesajTaze(SIMDI - FUBER_OLAYI_OMRU_MS, SIMDI), true);
  assert.equal(sessizMesajTaze(SIMDI - FUBER_OLAYI_OMRU_MS - 1, SIMDI), false);
});

// Review Focus 2: çentik hover'dayken onay ya da hatırlatma gelir; imleç çıkınca tıklama yakalama serbest kalır, alttaki uygulama tıklanabilir.
test('T7 (Review Focus 2): hover + onay/hatırlatma → hal değişir, imleç çıkınca fareYakalansinMi false; kontrol ve kapanan pencere de takılı bırakmaz', () => {
  const girdi = adim(ADA_YASAM_ILK, { tur: 'fare', uzerinde: true, durdur: false, gorunur: true });
  assert.equal(fareYakalansinMi(girdi.durum), true, 'imleç çentikte: tıklama çentiğe');
  const cikti = adim(girdi.durum, { tur: 'fare', uzerinde: false, durdur: false, gorunur: true });
  assert.equal(fareYakalansinMi(cikti.durum), false, 'imleç çıkınca alttaki uygulama tıklanır');
  assert.equal(fareYakalansinMi(adim(girdi.durum, { tur: 'kontrol', acik: true }).durum), false, 'kontrol hover sürerken başlarsa da bırakılır');
  assert.equal(fareYakalansinMi(adim(cikti.durum, { tur: 'fare', uzerinde: true, durdur: false, gorunur: false }).durum), false, 'gizlenen pencerede gecikmiş "üstünde" yakalamayı kurmaz');
});

test('T7 (Review Focus 2): tıklama yakalama hover gecikmesini beklemez; hover bayrağı imleç bayrağıyla birlikte sıfırlanır', () => {
  const y = kaynakOku('src/renderer/ada/useAsistan.ts');
  const fare = y.slice(y.indexOf('const fare = (ustunde: boolean) => {'), y.indexOf('/** Görev hapındaki Durdur (0.11 G10)'));
  assert.ok(fare.includes("cagir('ada:fare', ustunde)") && fare.indexOf("cagir('ada:fare', ustunde)") < fare.indexOf('hoverKur(ustunde)'), 'ada:fare hemen gider; 80 ms yalnız görünümün gecikmesi');
  // `mouseleave` gelmeden imleç bayrağının düştüğü iki yer: selam takılı kalmasın (bekleyen zamanlayıcı da iptal).
  const temizle = y.slice(y.indexOf('const temizle = () => {'), y.indexOf('const sohbetiTemizle = () => {'));
  assert.match(temizle, /hoverSifirla\(\);/);
  const kontrol = y.slice(y.indexOf("dinle('ada:kontrol'"), y.indexOf("dinle('ada:gorev'"));
  assert.match(kontrol, /uzerinde\.current = false;[^\n]*hoverSifirla\(\);/);
});

test('T7: selam metni dört dilde sözlükten; bilinmeyen dil Türkçe; karakter adı etkin kipten', () => {
  assert.equal(selamMetni('tr-TR'), 'Nasıl yardımcı olabilirim?');
  assert.equal(selamMetni('en-US'), 'How can I help?');
  assert.equal(selamMetni('de-DE'), 'Wie kann ich helfen?');
  assert.equal(selamMetni('fr-FR'), 'Comment puis-je vous aider ?');
  assert.equal(selamMetni('ja-JP'), 'Nasıl yardımcı olabilirim?');
  assert.equal(selamMetni(undefined), 'Nasıl yardımcı olabilirim?');
  const y = kaynakOku('src/renderer/ada/useAsistan.ts');
  assert.match(y, /etkinKarakter\(sinyal\.mod, sinyal\.a\?\.hesap\?\.karakterler\)\.ad/);
  // Dili tek kaynak belirler: uygulamanın ayarı; işletim sisteminin dili notchu öteki metinlerden ayırmaz.
  // 0.14 T23: soru panelin Asistan sayfasında.
  const ada = kaynakOku('src/renderer/ada/Ada.tsx') + kaynakOku('src/renderer/ada/sayfalar/Asistan.tsx');
  assert.doesNotMatch(ada, /navigator\.language/);
  assert.match(ada, /selamMetni\(a\.dil\)/);
  assert.match(y, /dil: sinyal\.a\?\.dil/);
});

// Çentik kendi kendine açılıyordu. Eşlikçinin `hatirlatma`sı modelin seçtiği bir sınıftır, zamanı gelen hatırlatıcı değil: gerçek hatırlatıcı yalnız asistan:bildir'den gelir.
// Değerler eşlikçinin gerçek türleri (gunkaydi/eslikci.ts Karar.tur) ve arayüzün tanıdıkları; ada:test-gonder kaynağı dışarıdan aldığı için kural burada sınanır.
test('T7: asistan:soyle kaynağı: eşlikçinin türleri (hatirlatma dahil) Fuber sayılır, yalnız kullanıcının seslenmesi açar', () => {
  for (const t of ['hatirlatma', 'espri', 'bilgi', 'sohbet', 'onay', 'yanit']) assert.equal(soyleKaynagi(t), 'fuber', t);
  assert.equal(soyleKaynagi('dinlendi'), 'kullanici');
  assert.deepEqual(adaYolu(soyleKaynagi('hatirlatma'), k()), { ada: 'nokta', tost: false, bildirim: false });
  assert.equal(adaYolu(soyleKaynagi('hatirlatma'), k({ tamEkran: true })).ada, 'bekle', 'tam ekranda inmez');
  assert.deepEqual(adaYolu(soyleKaynagi('hatirlatma'), k({ kapali: true })), { ada: 'yok', tost: false, bildirim: false }, 'ada kapalıyken Windows bildirimi de olmaz: mesaj sohbette');
  const ana = kaynakOku('src/main/main.ts');
  assert.match(ana, /asistanaSoyle: \(v\) => adaGonder\('asistan:soyle', v, soyleKaynagi\(v\.tur\)\)/);
  assert.doesNotMatch(ana, /kanal === 'asistan:soyle'/, 'Windows bildirimine dönüşen dal kalktı');
  const y = kaynakOku('src/renderer/ada/useAsistan.ts');
  assert.match(y, /bildirimEkle\(\{ tur: 'mesaj', baslik, metin: v\.metin, soz: true, acik: false, sure: SURE\.soz, sesli: Boolean\(v\.sesli\), kaynak: 'fuber', sessiz: true \}\)/);
});

// Ürün kararı: imleç çentikten geçerken özel bir not sesli okunmaz. Hover yalnız yazı gösterir; sesli mesaj ancak tıklanınca çalar.
test('T7: hover ses başlatmaz: sesli mesaj yalnız tıklanıp açılınca (sessizliği bitince) okunur', () => {
  const y = kaynakOku('src/renderer/ada/useAsistan.ts');
  assert.match(y, /if \(bas\.sesli && !bas\.sessiz && !konusulan\.current\.has\(bas\.no\)\)/);
  assert.match(y, /const kartiAc = [^\n]*acik: true, sessiz: false/);
});

// Koordinatör kararı: hover ses başlatmadığı için çıkışın susturacağı bir şey yok; kullanıcının tıklayarak başlattığı konuşma imleç çıkınca sürer, Sustur keser.
test('T7: imleç çıkınca yalnız hover\'la görünen sessiz mesaj kalkar; tıklanan mesajın kartı ve sesi sürer, Sustur keser; imlecin altındaki işe dokunulmaz', () => {
  const metin = { sessiz: true }, tiklanan = { sessiz: false };
  const hoverda: AdaDurumu = { ...bos, ...SESSIZ_MESAJ, hover: true };
  const acikKart: AdaDurumu = { ...bos, bildirimVar: true, kartAcik: true, bildirimTuru: 'bilgi', bildirimSessiz: false, hover: true };
  assert.equal(hoverCikinciKalkarMi(hoverda, metin), true);
  assert.equal(hoverCikinciKalkarMi(acikKart, tiklanan), false, 'tıklanıp açılan mesaj (sesli ya da hatırlatıcı) imleç çıkınca kalkmaz');
  // İmlecin altında başlayan iş: süresine dokunulmaz.
  assert.equal(hoverCikinciKalkarMi({ ...hoverda, yanitVar: true }, metin), false, 'yanıtın gizleme süresi iptal edilmez');
  assert.equal(hoverCikinciKalkarMi({ ...hoverda, hal: 'konusuyor' }, metin), false);
  assert.equal(hoverCikinciKalkarMi({ ...hoverda, onaySayisi: 1 }, metin), false);
  assert.equal(hoverCikinciKalkarMi({ ...hoverda, sorAcik: true }, metin), false);
  // Mesaj hiç görünmedi (geçen imleç, tam ekran) ya da yok.
  assert.equal(hoverCikinciKalkarMi({ ...hoverda, hover: false }, metin), false);
  assert.equal(hoverCikinciKalkarMi({ ...hoverda, tamEkran: true }, metin), false);
  assert.equal(hoverCikinciKalkarMi(bos, undefined), false);
  const y = kaynakOku('src/renderer/ada/useAsistan.ts');
  const bitti = y.slice(y.indexOf('const hoverBitti = () => {'), y.indexOf('/** Görünüm gecikmeli'));
  assert.match(bitti, /hoverCikinciKalkarMi\(d\.adaDurumu, b\)/);
  assert.doesNotMatch(bitti, /sesiKes/, 'imleç çıkışı sesi kesmez');
  // Sustur konuşmayı keser ve kartın süresini kurar; düğme konuşurken kartta.
  assert.match(y, /const sustur = \(\) => \{ sesiKes\(\); gizleSonra\(SURE\.konusmaSonu\); \};/);
  assert.match(kaynakOku('src/renderer/ada/Ada.tsx'), /a\.bildirimKonusuyor\s*\? <button[^\n]*onClick=\{a\.sustur\}/);
  const kaldir = y.slice(y.indexOf('const bildirimiKaldir = () => {'), y.indexOf('// Sessiz mesaj noktada sonsuza dek beklemez'));
  assert.match(kaldir, /if \(d\.bildirimKonusuyor \|\| bas\.sesli\) sesiKes\(\);/, 'Tamam ilk sesten önce basılsa da konuşma kalmaz');
});

test('T7: motor kartı kendiliğinden açılmaz: başlangıç hap; kart yalnız üstüne gelme, tıklama ya da kısayolla', () => {
  const y = kaynakOku('src/renderer/ada/useAsistan.ts');
  assert.match(y, /const \[motorKart, setMotorKart\] = useState\(false\);/);
  assert.doesNotMatch(y, /motorKartIlk/);
  assert.doesNotMatch(y, /SURE\.motorKart/);
  assert.equal(hal({ motor: 'durdu', motorKartAcik: false }), 'motor-hap');
  assert.equal(hal({ motor: 'durdu', motorKartAcik: true }), 'motor-durdu');
});

test('T7: hover iş sayılmaz: boş mu kararı onu görmez (onay imleç altında yanıtlanınca boş çentik kalmaz); sayaç sessiz mesajı saymaz', () => {
  const y = kaynakOku('src/renderer/ada/useAsistan.ts');
  assert.match(y, /const bosMu = \(d: AdaDurumu\) => !d\.sorAcik && !d\.panelAcik && \['dinlenme', 'sessiz', 'uyari', 'motor-durdu', 'motor-hap'\]\.includes\(adaHaliBul\(\{ \.\.\.d, hover: false \}\)\);/);
  assert.match(y, /bildirimSayisi: acikBildirimler\(bildirimler\)\.length/);
});

test('T7: çentik her temada saf siyah; açık temada ince gölge, kenar yok, yazı belirteçleri koyuda kalır', () => {
  const css = kaynakOku('src/renderer/ada/ada.css');
  const acik = /:root\[data-tema='acik'\] \.ada \{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.match(acik, /--ada-zemin: #000;/);
  assert.match(acik, /--ada-golge: [^;]*rgb\(0 0 0/, 'ince dış gölge');
  assert.doesNotMatch(acik, /inset/, 'kenar yok');
  assert.doesNotMatch(acik, /--ada-dikkat/, 'siyah zeminde beyaz ada için koyulaştırılmış kehribar kalmaz');
  assert.doesNotMatch(css, /:root\[data-tema='acik'\] \.ada \.onay/, 'onay simgesi siyah zeminde beyaz adanın tonunu almaz');
  assert.match(kaynakOku('src/renderer/ada/Ada.tsx'), /className="ada koyu-bolge"/, 'açık temada --ink koyu: siyah üstüne siyah yazı olurdu');
  // Kurulum ve tanıtım turundaki ada kopyası da aynı malzeme; tostlar kehribarı açık temadan okur, ona dokunulmaz.
  const tasarim = kaynakOku('src/renderer/tasarim.css');
  const acikBlok = tasarim.slice(tasarim.indexOf(":root[data-tema='acik'], [data-tema-kutu='acik'] {"));
  assert.match(acikBlok, /--ada-zemin: #000;/);
  assert.match(acikBlok, /--ada-dikkat: var\(--yazi-uyari\);/);
  assert.match(kaynakOku('src/renderer/kurulum/AdaKopyasi.tsx'), /className="ada-kopya koyu-bolge"/);
});

// 0.14 T19 (R16): az hareket kökteki `data-az-hareket`tır (Windows'un animasyon tercihi ya da Görünüm'deki "Az hareket"; Ada.tsx ikisini birleştirir).
// Dokuz dilim biçimin parçaları (CentikSekli) hover'ın açtığı hâllerde hiç geçiş yapmaz: biçim anında oturur, içerik solar.
test('T7/T19/T23: az harekette panel yalnız solar (biçim yaylanmaz); boştaki çentikte hover ara gri kare çizmez', () => {
  const css = kaynakOku('src/renderer/ada/ada.css');
  const kural = /([^{}]*\.ada\[data-az-hareket\]\[data-ada-hal='panel'\] \.ada-bicim__parca[^{]*)\{([^}]*)\}/.exec(css);
  assert.ok(kural, 'az hareket kuralı var');
  assert.match(kural[2], /transition: none/);
  for (const h of ['dinlenme', 'sessiz', 'bildirim', 'kart']) assert.ok(kural[1].includes(`.ada[data-az-hareket][data-ada-hal='${h}'] .ada-bicim__parca`), `${h}: boştan bildirime/karta geçiş de yaylanmaz`);
  assert.match(css, /\.ada:not\(\[data-ada-hal='sessiz'\]\):not\(\[data-ada-hal='dinlenme'\]\) \.ada__sekil:has\(> \.ada__katman > button\.ada__satir:hover\)/);
  const ada = kaynakOku('src/renderer/ada/Ada.tsx');
  assert.match(ada, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/, 'Windows tercihi olayla izlenir');
  assert.match(ada, /data-az-hareket=\{azHareket \? '' : undefined\}/);
});

// Çıkan katman içeriğin yeniden takılmış kopyasıdır (Ada.tsx `cikan`): giriş animasyonları orada yeniden oynarsa `backwards` gecikmesi yazıyı ilk karede siler, şekilde
// bir an yalnız mavi ışık kalır (hover videosunda görüldü).
test('T7/T23: çıkan katmanda panelin ve noktanın giriş animasyonu yeniden oynamaz', () => {
  const css = kaynakOku('src/renderer/ada/ada.css');
  const kural = /([^{}]*\.ada__katman--cikan \.panel \*[^{}]*)\{([^}]*)\}/.exec(css);
  assert.ok(kural, 'çıkan katman kuralı var');
  assert.match(kural[1], /\.ada__katman--cikan \.ada__nokta--mesaj/);
  assert.match(kural[2], /animation: none/);
});

// `adaGonder` tam ekranı "var" sayarak yol seçer (kosul(true)): Fuber olayı önce kuyruğa girer, teslim KUYRUKTAN gelir. Kural yalnız adaYolu'nda kalsaydı
// teslim() pencereyi yine açardı; "kendi kendine açılıyor" sorunu aynen sürerdi.
test('T7: teslim Fuber olayında pencereyi GÖSTERMEZ (kuyruktan geçen dahil), yalnız arayüze yazar', () => {
  const teslim = /function teslim\(o: AdaOlayi\): void \{[\s\S]*?\n\}/.exec(kaynakOku('src/main/ada.ts'))?.[0] ?? '';
  const kol = teslim.indexOf("if (o.kaynak === 'fuber')");
  assert.ok(kol >= 0 && kol < teslim.indexOf('adaGoster('), 'Fuber kolu adaGoster çağrısından önce');
  assert.match(teslim.slice(kol, teslim.indexOf('adaGoster(')), /return;/);
  // Kapıdan "yeniden iniş" (ada:gorunur) görünmez pencerede arayüze "açıldı" demez.
  assert.match(teslim, /o\.kanal !== 'ada:gorunur'/);
});

test('T7: yeniden iniş: arayüz adayı yalnız açık bildirimler ve onay için indirir; ipc onay kaynağını geçirir', () => {
  const y = kaynakOku('src/renderer/ada/useAsistan.ts');
  assert.doesNotMatch(y, /cagir\('ada:goster'[^\n]*'fuber'\)/, "arayüz 'fuber' kaynağıyla adayı indirmez");
  assert.match(y, /cagir\('ada:goster', kalan\.some\(\(b\) => b\.kaynak === 'hatirlatma'\) \? 'hatirlatma' : 'onay'\)/);
  assert.match(kaynakOku('src/main/ipc.ts'), /h\('ada:goster', \(kaynak: AdaKaynak\) => adaGonder\('ada:gorunur', \{ acik: true, yeniden: true \}, kaynak === 'hatirlatma' \|\| kaynak === 'onay' \? kaynak : 'fuber'\)\)/);
});

test('T7: Claude Code izin isteği karar bekler, onay gibi adayı açar; bitti/durdu haberleri sessiz kalır', () => {
  const y = kaynakOku('src/main/claudecode/yonetim.ts');
  assert.match(y, /izinBekliyor: \(o, i\) => \{[\s\S]*?ccBildir\([^\n]*, o, true\);/);
  assert.match(y, /izin \? 'onay' : 'fuber'/);
  assert.match(kaynakOku('src/renderer/ada/useAsistan.ts'), /sessiz: b\.tur !== 'hatirlatma' && !b\.acil/);
});

test('T7: ana süreç tam ekranı arayüze söyler (panel kararı arayüzde); kanal izinli', () => {
  assert.match(kaynakOku('src/main/ada.ts'), /dogrudan\('ada:tam-ekran', \{ acik: tam \}\)/);
  assert.match(kaynakOku('src/shared/kanallar.ts'), /'ada:tam-ekran'/);
  assert.match(kaynakOku('src/renderer/ada/useAsistan.ts'), /dinle\('ada:tam-ekran'/);
});

// ── 0.14 T19: çentik Nusa biçimi, ölçek ve dinlenme hâli (R13, R15, Review Focus 1) ─────────────────────────────────────
const BOS = bos;
test('boşta ve gösterecek durum yoksa dinlenme', () => assert.equal(adaHaliBul(BOS), 'dinlenme'));
test('medya çalıyorsa Kapalı hap', () => assert.equal(adaHaliBul({ ...BOS, medya: true }), 'sessiz'));
test('sessiz Fuber mesajı Kapalı hapta nokta', () => { const d = { ...BOS, bildirimVar: true, bildirimSessiz: true }; assert.equal(adaHaliBul(d), 'sessiz'); assert.equal(fuberNoktasiVar(d), true); });
test('ölçek: 1440 → 1, 1920 → 1.12, 2560 → 1.25', () => { assert.equal(centikOlcegi(1440), 1); assert.equal(centikOlcegi(1920), 1.12); assert.equal(centikOlcegi(2560), 1.25); });
test('ölçek sınırları: 1699 → 1, 1700 → 1.12, 2399 → 1.12, 2400 → 1.25', () => { assert.equal(centikOlcegi(1699), 1); assert.equal(centikOlcegi(1700), 1.12); assert.equal(centikOlcegi(2399), 1.12); assert.equal(centikOlcegi(2400), 1.25); });
test('adaOlcusu ölçekle yuvarlanır', () => assert.deepEqual(adaOlcusu('dinlenme', 1.25), { en: 165, boy: 38 }));
test('adaOlcusu: içerikli hâl ölçekte de içerik boyunda; ölçeksiz çağrı tabanı verir', () => {
  assert.deepEqual(adaOlcusu('yanit', 1.12), { en: 493, boy: 'icerik' });
  assert.deepEqual(adaOlcusu('dinlenme'), { en: 132, boy: 30 });
});
test('Review Focus 1: ekran olayı yakalamayı düşürür', () => assert.equal(adaYasamAdimi({ ...ADA_YASAM_ILK, fareUzerinde: true }, { tur: 'ekran' }).durum.fareUzerinde, false));
test('Review Focus 1: ekran olayı Durdur bayrağını da düşürür, pencereyi kapatmaz, görev ve kontrol bayraklarına dokunmaz', () => {
  const once: AdaYasami = { ...ADA_YASAM_ILK, fareUzerinde: true, durdurUzerinde: true, gorevde: true, kontrolde: true, gorevAcmisti: true };
  const r = adaYasamAdimi(once, { tur: 'ekran' });
  assert.equal(r.gizle, false);
  assert.deepEqual(r.durum, { ...once, fareUzerinde: false, durdurUzerinde: false });
  assert.equal(fareYakalansinMi(r.durum), false);
});
test('calisiyor doluysa hap gorev kalır (T13 kuralı korunur)', () => assert.equal(adaHaliBul({ ...BOS, calisiyor: { sohbetId: 1, adim: 4, etiket: 'Dosya okunuyor' } }), 'gorev'));
test('T19: Kapalı hap ve dinlenme 0.13 kurallarını bozmaz: onay, görev, bildirim ve hover medyanın önünde; tam ekranda hover açmaz', () => {
  assert.equal(adaHaliBul({ ...BOS, medya: true, onaySayisi: 1 }), 'onay');
  assert.equal(adaHaliBul({ ...BOS, medya: true, gorev: { id: 1, baslik: 'x', ekran: false } }), 'gorev');
  assert.equal(adaHaliBul({ ...BOS, medya: true, bildirimVar: true, bildirimTuru: 'hatirlatma' }), 'bildirim');
  assert.equal(adaHaliBul({ ...BOS, medya: true, hover: true }), 'panel', 'T23: Kapalı hapta hover panel');
  assert.equal(adaHaliBul({ ...BOS, medya: true, hover: true, tamEkran: true }), 'sessiz');
  assert.equal(adaHaliBul({ ...BOS, medya: true, motor: 'durdu' }), 'motor-hap');
  assert.equal(fuberNoktasiVar({ ...BOS, medya: true }), false, 'medya noktası yok: nokta yalnız Fuber mesajı');
});

test('T19: ana süreç ekran değişiminde konumlar, ölçeği söyler ve yakalamayı düşürür; tam ekranda gizle anahtarı', () => {
  const ana = kaynakOku('src/main/ada.ts');
  const ekran = ana.slice(ana.indexOf('function ekranDegisti('), ana.indexOf('function ekranDegisti(') + 900);
  assert.match(ekran, /konumla\(\)/);
  assert.match(ekran, /yasamAdimi\(\{ tur: 'ekran' \}\)/);
  assert.match(ekran, /fareyiUygula\(\)/);
  for (const o of ['display-metrics-changed', 'display-added', 'display-removed']) assert.match(ana, new RegExp(`screen\\.on\\('${o}', \\(\\) => ekranDegisti\\(\\)\\)`), o);
  assert.match(ana, /dogrudan\('ada:olcek', \{ olcek \}\)/, 'ölçek arayüze gider');
  assert.match(ana, /centikYerlesimi\(/);
  assert.match(kaynakOku('src/shared/kanallar.ts'), /'ada:olcek'/);
  assert.match(kaynakOku('src/renderer/ada/useAsistan.ts'), /dinle\('ada:olcek'/);
  // Tam ekranda gizle (varsayılan açık): kapalıysa boştaki çentik tam ekranda da kalır; onay ve Fuber kuyruğu tamEkranMi'ye bakmayı sürdürür.
  assert.match(ana, /if \(tam && tamEkrandaGizle\(\)\)/);
  assert.match(kaynakOku('src/main/ayarlar.ts'), /tamEkrandaGizle: true, azHareket: false/);
});

test('T19 (11 Kas gözler): dinlenmede gözler çentikten bakar (16 px, çentik kesiti); Sade mod için tek bayrak, aynı yerde nötr yer tutucu', () => {
  const ada = kaynakOku('src/renderer/ada/Ada.tsx');
  assert.match(ada, /<Gozler[^>]*boyut=\{GOZ_PX\}[^>]*kesit="centik"[^>]*hal="sakin"/);
  assert.match(ada, /const GOZ_PX = 16;/);
  assert.match(ada, /disImlec=\{/, 'göz takibi iletilen fare hareketinden (R14)');
  assert.match(ada, /karakterGorunur = true/);
  assert.match(ada, /\/\/ T6b:/);
  assert.match(ada, /centik-yuz__yer-tutucu/);
  assert.doesNotMatch(ada, /requestAnimationFrame/, 'çentikte çizim döngüsü yok');
});
// ── 0.14 T23: açık panel, Asistan sayfası ve karakterli hâller (R13, R20, Review Focus 1, B28) ────────────────────────────────────────────
test("hover dinlenmede ve Kapalı'da panel olur (60 ms), tam ekranda olmaz", () => {
  assert.equal(HOVER_GECIKME_MS, 60);
  assert.equal(hal({ hover: true }), 'panel', 'dinlenme');
  assert.equal(hal({ hover: true, medya: true }), 'panel', 'Kapalı hap (medya)');
  assert.equal(hal({ hover: true, tamEkran: true }), 'dinlenme');
  assert.equal(hal({ hover: true, medya: true, tamEkran: true }), 'sessiz');
  assert.equal(hal({ hover: true, calisiyor: { sohbetId: 1, adim: 9, etiket: '' } }), 'gorev', 'Çalışıyor hapı hover\'la panele dönmez');
  assert.equal(hal({ hover: true, uyari: { tur: 'caps', metin: 'Büyük harf açık', simge: 'kilit' } }), 'uyari');
  // Kaynak: hover gecikmesi kancada tek zamanlayıcıyla.
  const y = kaynakOku('src/renderer/ada/useAsistan.ts');
  assert.match(y, /ustunde \? HOVER_GECIKME_MS : /);
});

test('imleç çıkınca 300 ms sonra kapanır; yazı alanı odaktaysa kapanmaz', () => {
  assert.equal(PANEL_KAPANIS_MS, 300);
  assert.equal(panelKapanirMi('cikis', { yaziOdakta: false }), true);
  assert.equal(panelKapanirMi('cikis', { yaziOdakta: true }), false, 'yazıyor: panel kalır');
  const y = kaynakOku('src/renderer/ada/useAsistan.ts');
  assert.match(y, /PANEL_KAPANIS_MS/, 'çıkış gecikmesi panelde 300 ms');
  assert.match(y, /panelKapanirMi\('cikis', \{ yaziOdakta: yaziOdaktaMi\(\) \}\)/);
  // Tıklamayla sabitlenen panel imleç çıkınca da aynı kurala uyar; yazı alanı odaktaysa kalır.
  assert.equal(hal({ panelAcik: true }), 'panel');
  assert.equal(hal({ panelAcik: true, motor: 'durdu' }), 'motor-durdu', 'motor yoksa motor kartı (soru kutusu gibi)');
});

test('pencere odağı kaybı ve ekran olayı (adaYasamAdimi tur \'ekran\') açık paneli kapatır (Review Focus 1)', () => {
  assert.equal(panelKapanirMi('odak-kaybi', { yaziOdakta: true }), true, 'yazı alanı odakta olsa da');
  assert.equal(panelKapanirMi('ekran', { yaziOdakta: true }), true);
  const r = adaYasamAdimi({ ...ADA_YASAM_ILK, fareUzerinde: true }, { tur: 'ekran' });
  assert.equal(r.durum.fareUzerinde, false, 'yakalama düşer');
  assert.equal(r.gizle, false, 'pencere kapanmaz: yalnız panel');
  const y = kaynakOku('src/renderer/ada/useAsistan.ts');
  const ekran = y.slice(y.indexOf("dinle('ada:ekran'"), y.indexOf("dinle('ada:ekran'") + 300);
  assert.match(ekran, /panelKapat\('ekran'\)/);
  assert.match(y, /window\.addEventListener\('blur', [^\n]*/);
  assert.match(y, /panelKapat\('odak-kaybi'\)/);
  // Ana süreç ekran olayını arayüze yollar (T19), kanal izinli.
  assert.match(kaynakOku('src/main/ada.ts'), /dogrudan\('ada:ekran', \{\}\)/);
});

test('kaydı olmayan sayfa gizlenmez, tek satır boş durum gösterir (Ada.tsx paneli çizer)', () => {
  const ada = kaynakOku('src/renderer/ada/Ada.tsx');
  assert.match(ada, /case 'panel':/);
  assert.match(ada, /<Panel /);
  assert.doesNotMatch(ada, /case 'selam':/, 'selam kalktı');
});

test('tıklama: gözler selam verir, hal panel, sayfa asistan, odak yazı alanında', () => {
  assert.deepEqual(PANEL_TIKLAMA, { sayfa: 'asistan', tetik: 'selam', odak: 'yazi' });
  assert.equal(hal({ panelAcik: true }), 'panel');
  assert.equal(hal({ panelAcik: true, onaySayisi: 1 }), 'onay', 'onay her şeyin önünde');
  assert.equal(hal({ panelAcik: true, onaySayisi: 1, yaziyor: true }), 'panel', 'B10: yazarken onay paneli örtmez');
  assert.equal(hal({ panelAcik: true, hal: 'dusunuyor' }), 'dusunuyor', 'gönderince yanıt hâline geçer');
  const y = kaynakOku('src/renderer/ada/useAsistan.ts');
  const tikla = y.slice(y.indexOf('const panelTikla = '), y.indexOf('const panelTikla = ') + 700);
  assert.match(tikla, /PANEL_TIKLAMA\.sayfa/);
  assert.match(tikla, /setSapka\(/, 'selam tetik numarasıyla');
  assert.match(tikla, /cagir\('asistan:goster', false, true\)/, 'yazı alanı klavye odağı alsın');
  const as = kaynakOku('src/renderer/ada/sayfalar/Asistan.tsx');
  assert.match(as, /tetik=\{/, 'selam tetik özelliğiyle (pointerdown değil)');
  assert.match(as, /PANEL_TIKLAMA\.tetik/);
  assert.match(as, /autoFocus|\.focus\(\)/, 'yazı alanı odakta');
  assert.match(as, /selamMetni\(/, '"Nasıl yardımcı olabilirim?"');
  assert.match(as, /boyut=\{KARAKTER_PX\}/);
  assert.match(as, /GorunenGoz/, 'Sade modda göz yerine nötr işaret');
  // Dinlenme ve Kapalı hapa tıklama da aynı yol.
  assert.match(kaynakOku('src/renderer/ada/Ada.tsx'), /onClick=\{a\.panelTikla\}/);
});

test('hover ses başlatmaz (panel açılırken seslendirme çağrısı yok; kaynak taraması)', () => {
  const y = kaynakOku('src/renderer/ada/useAsistan.ts');
  const hover = y.slice(y.indexOf('const hoverSifirla = () => {'), y.indexOf('/** İmleç adanın şekline girdi/çıktı'));
  assert.ok(hover.length > 100);
  assert.doesNotMatch(hover, /fuberSoyle|fuberKonus|bildirimiSoyle|dinlemeyiBaslat|kulak:dinle/);
  for (const d of ['src/renderer/ada/Panel.tsx', 'src/renderer/ada/sayfalar/Asistan.tsx']) {
    const k = kaynakOku(d);
    assert.doesNotMatch(k, /fuber-sesi|fuberSoyle|fuberKonus/, `${d} ses çalmaz`);
    assert.doesNotMatch(k, /useEffect\([^)]*dinlemeyiBaslat/, `${d} açılırken dinlemez`);
  }
});

test('Fuber\'in mesajı paneli açmaz, Kapalı hapta nokta', () => {
  const d: AdaDurumu = { ...bos, ...SESSIZ_MESAJ };
  assert.equal(adaHaliBul(d), 'sessiz');
  assert.equal(fuberNoktasiVar(d), true);
  assert.equal(adaHaliBul({ ...d, hover: true }), 'bildirim', 'hover önce mesajın hapını gösterir, panel değil');
  assert.equal(adaYolu('fuber', k()).ada, 'nokta');
});

test('Alt+Shift+Q paneli kapatır ve Çalışıyor\'u düşürür', () => {
  assert.equal(panelKapanirMi('acil', { yaziOdakta: true }), true);
  const ana = kaynakOku('src/main/main.ts');
  const acil = ana.slice(ana.indexOf('function acilDurdur(): void {'), ana.indexOf('function acilDurdur(): void {') + 900);
  assert.match(acil, /adaAcilDurdur\(\)/);
  const m = kaynakOku('src/main/ada.ts');
  const f = m.slice(m.indexOf('export function adaAcilDurdur('), m.indexOf('export function adaAcilDurdur(') + 600);
  assert.match(f, /sonCalisiyorAnahtari = 'null'/);
  assert.match(f, /dogrudan\('ada:acil', \{\}\)/);
  const y = kaynakOku('src/renderer/ada/useAsistan.ts');
  const d = y.slice(y.indexOf("dinle('ada:acil'"), y.indexOf("dinle('ada:acil'") + 300);
  assert.match(d, /panelKapat\('acil'\)/);
  assert.match(d, /setCalisiyor\(null\)/);
  assert.match(kaynakOku('src/shared/kanallar.ts'), /'ada:acil'/);
  assert.match(kaynakOku('src/shared/kanallar.ts'), /'ada:sayfa'/);
});

test('mod değişince (ayarlar.mod) görünür çentikte ModGecisi oynar, az harekette yalnız çapraz solma; süren tur eski karakterle biter (0.13 kuralı)', () => {
  type K = 'is' | 'gelistirici';
  const ilk: CentikKipi<K> = { gorunen: 'is', gecis: null, bekleyen: null };
  const g = centikKipiAdimi(ilk, { tur: 'mod', kip: 'gelistirici', gorunur: true, turSuruyor: false });
  assert.deepEqual(g, { gorunen: 'gelistirici', gecis: { eski: 'is', yeni: 'gelistirici' }, bekleyen: null }, 'görünür çentikte geçiş');
  assert.deepEqual(centikKipiAdimi(g, { tur: 'bitti' }), { gorunen: 'gelistirici', gecis: null, bekleyen: null });
  assert.deepEqual(centikKipiAdimi(ilk, { tur: 'mod', kip: 'gelistirici', gorunur: false, turSuruyor: false }), { gorunen: 'gelistirici', gecis: null, bekleyen: null }, 'görünmezken anında');
  // T5 küçük notu: yarıda kesilen geçiş eski karaktere bir kare dönmez — yeni geçiş yarıda kalanın hedefinden başlar.
  const geri = centikKipiAdimi(g, { tur: 'mod', kip: 'is', gorunur: true, turSuruyor: false });
  assert.deepEqual(geri.gecis, { eski: 'gelistirici', yeni: 'is' });
  assert.equal(geri.gorunen, 'is');
  // Süren tur eski karakterle biter; bitince geçiş oynar.
  const tur = centikKipiAdimi(ilk, { tur: 'mod', kip: 'gelistirici', gorunur: true, turSuruyor: true });
  assert.deepEqual(tur, { gorunen: 'is', gecis: null, bekleyen: 'gelistirici' });
  assert.deepEqual(centikKipiAdimi(tur, { tur: 'tur-bitti', gorunur: true }).gecis, { eski: 'is', yeni: 'gelistirici' });
  assert.deepEqual(centikKipiAdimi(centikKipiAdimi(tur, { tur: 'mod', kip: 'is', gorunur: true, turSuruyor: true }), { tur: 'tur-bitti', gorunur: true }), ilk, 'tur sürerken geri alınan mod bekletilmez');
  // Bileşen: ModGecisi çentikte çizilir, az hareket ona gider (240 ms çapraz solma ModGecisi'nin kendisinde; Sade'de SadeModGecisi), durdurma yolu ModGecisi'nin.
  const ada = kaynakOku('src/renderer/ada/Ada.tsx');
  assert.match(ada, /<ModGecisi[^>]*azHareket=\{azHareket\}/);
  assert.match(ada, /centikKipiAdimi\(/);
  assert.match(ada, /<ModGecisi[^>]*kesit="centik"/, 'çentikte göz aynı kalır, parıltı çapraz solar (şapka yok)');
  assert.doesNotMatch(ada, /firlatmaYonu/, 'şapka fırlatma kalktı');
});

test('gözlü hâller: dinliyor, konuşuyor, Çalışıyor (düşünen göz + halka + Adım N + Durdur), onay düşünüyor, hata', () => {
  assert.equal(calisiyorAdimMetni(7), 'Adım 7');
  assert.equal(calisiyorAdimMetni(0), 'Adım 1');
  const ada = kaynakOku('src/renderer/ada/Ada.tsx');
  assert.match(ada, /hal="dinliyor"/);
  assert.match(ada, /hal=\{konusuyor \|\| yaziyor \? 'konusuyor'/, 'yanıt akarken ya da sesi çalarken');
  assert.match(ada, /hal="calisiyor"/);
  assert.match(ada, /ada__halka/);
  assert.match(ada, /calisiyorAdimMetni\(/);
  assert.match(ada, /ifade="dusunuyor"/);
  assert.match(ada, /ifade="hata"/);
  // Bütün durum gözleri Sade'ye uyan bileşenle (GorunenGoz) çizilir; dinlenme Sade'de vurgu renkli nokta.
  assert.doesNotMatch(ada.replace(/function DinlenmeYuzu[\s\S]*?\r?\n}\r?\n/, ''), /<Gozler /, 'dinlenme dışında doğrudan Gozler yok');
  assert.match(ada, /kipVurgusu\(/);
});

test('görülmüş hatırlatıcı ada gizlenince yeniden inmez (T22\'den devralınan hata; useAsistan yeniden iniş yolu)', () => {
  const y = kaynakOku('src/renderer/ada/useAsistan.ts');
  const yol = y.slice(y.indexOf('yenidenZaman.current = setTimeout(() => {'), y.indexOf('yenidenZaman.current = setTimeout(() => {') + 500);
  assert.match(yol, /!gosterilen\.current\.has\(b\.no\)/, 'yeniden iniş görülmüşleri saymaz');
  // Kök neden: gizlenip temizlenen adaya eski dinlemenin geç sonucu ("Şu an yazıya çevrilemiyor") yazılıyor, gizli ada yanıt hâlinde kalıyordu; arkasında
  // inen hatırlatıcı hiç görünmüyor, görülmemiş sayılıp yeniden iniyordu. Temizlik dinleme neslini artırır, eski dinleme sonucunu yazmaz.
  const temizle = y.slice(y.indexOf('const temizle = () => {'), y.indexOf('const temizle = () => {') + 400);
  assert.match(temizle, /dinlemeNesli\.current\+\+/);
  const kendin = y.slice(y.indexOf('const kendinDinle = async (nesil: number) => {'), y.indexOf('const kendinDinle = async (nesil: number) => {') + 900);
  assert.match(kendin, /if \(nesil !== dinlemeNesli\.current\) \{ oturum\?\.iptal\(\); return; \}/);
  assert.match(kendin, /const d = await dikteYokSatiri\(\);\s+if \(nesil !== dinlemeNesli\.current\) return;/);
  assert.match(y, /const nesil = \+\+dinlemeNesli\.current;/);
});

test('11 Kas: mod geçişinde göz aynı kalır — yalnız parıltı çapraz solar, zıplayıp kırpar; şapka fırlatma yok', () => {
  const mg = kaynakOku('src/renderer/ui/goz/ModGecisi.tsx');
  assert.match(mg, /export const MOD_GECISI_MS = ZIPLA_SURE;/);
  assert.match(mg, /requestAnimationFrame\(\(\) => setKip\(yeni\)\)/, 'ilk karede eski kip, sonra yeni: CSS geçişi oynar');
  assert.doesNotMatch(mg, /sapka|firlat/i);
  assert.match(kaynakOku('src/renderer/ui/goz/goz.css'), /\.goz-parilti > \* \{ transition: opacity 280ms/);
});

// ── 0.14 T23 düzeltme turu 1 ───────────────────────────────────────────────────────────────────────────────────────────────────────────
test('düzeltme 1: ilk tıklamada da gözler selam verir — tıklama zamanı tutulur, Asistan takıldıktan sonra taze tıklamayı (≤ 300 ms) tetik olarak verir', () => {
  assert.equal(PANEL_TIKLAMA_TAZE_MS, 300);
  assert.equal(tiklamaTazeMi({ no: 1, an: 1000 }, 1200), true);
  assert.equal(tiklamaTazeMi({ no: 1, an: 1000 }, 1300), true, 'sınır dahil');
  assert.equal(tiklamaTazeMi({ no: 1, an: 1000 }, 1301), false, 'hover\'la takılan sayfada eski tıklama oynamaz');
  assert.equal(tiklamaTazeMi({ no: 0, an: 0 }, 10), false, 'hiç tıklanmadı');
  const y = kaynakOku('src/renderer/ada/useAsistan.ts');
  assert.match(y, /setSapka\(\(s\) => \(\{ no: s\.no \+ 1, an: Date\.now\(\) \}\)\)/);
  const as = kaynakOku('src/renderer/ada/sayfalar/Asistan.tsx');
  assert.match(as, /useState<\{ ad: GozTetigi; no: number \} \| undefined>\(undefined\)/, 'ilk karede tetik yok: takılma numarası görülmüş sayılmaz');
  assert.match(as, /if \(tiklamaTazeMi\(a\.sapka, Date\.now\(\)\)\) setTetik\(/);
  // Çift selam yok: paneldeki (ve dinlenmedeki) gözün svg pointerdown'u kapalı; selamı yalnız tetik verir.
  assert.match(as, /disTiklama/);
  assert.match(kaynakOku('src/renderer/ada/Ada.tsx'), /<Gozler [^>]*disTiklama/);
  const k = kaynakOku('src/renderer/ui/goz/Gozler.tsx');
  assert.match(k, /if \(!disTiklama\) svg\.addEventListener\('pointerdown', bas\);/);
});

test('düzeltme 2: dinleme nesli bütün yolda — gizlenen çentiğe geç olay yazılmaz, mikrofon açık kalmaz', () => {
  const y = kaynakOku('src/renderer/ada/useAsistan.ts');
  const kendin = y.slice(y.indexOf('const kendinDinle = async (nesil: number) => {'), y.indexOf('const mikrofonuKes = () => {'));
  // getUserMedia sonrası: eski nesilde mikrofon hemen kapanır.
  assert.match(kendin, /getUserMedia[\s\S]*?if \(mikrofonKapaliRef\.current \|\| dinlemeIptal\.current \|\| nesil !== dinlemeNesli\.current\) \{ akis\.getTracks\(\)\.forEach\(\(t\) => t\.stop\(\)\); oturum\.iptal\(\);/);
  assert.match(kendin, /const r = await konusmaYakala[\s\S]*?if \(dinlemeIptal\.current \|\| nesil !== dinlemeNesli\.current \|\| !r\.konustu\)/);
  assert.match(kendin, /const s = await oturum\.bitir\(\)[^\n]*\n\s+if \(dinlemeIptal\.current \|\| nesil !== dinlemeNesli\.current\)/);
  // Temizlik süren kaydı hemen bitirir (gizli pencerede mikrofon açık kalmaz).
  const temizle = y.slice(y.indexOf('const temizle = () => {'), y.indexOf('const temizle = () => {') + 600);
  assert.match(temizle, /yakalama\.current\.durdur\?\.\(\)/);
  // Kulaktan gelen olaylar dinlemenin nesliyle: temizlikten sonra gelen geç metin/hata yok sayılır.
  const ses = y.slice(y.indexOf("k.push(dinle('asistan:ses'"), y.indexOf("k.push(dinle('asistan:bildir'"));
  assert.match(ses, /sesNesli\.current = \+\+dinlemeNesli\.current/);
  assert.match(ses, /if \(sesNesli\.current !== dinlemeNesli\.current\) return;/);
  assert.match(y, /sesNesli\.current = nesil;/);
});

test('düzeltme 3: paneldeki gözler kutusunda kalır (yazı alanını örtmez); oklar mikrofondan uzak', () => {
  const css = kaynakOku('src/renderer/ada/panel.css');
  assert.match(css, /\.asistan-sayfa__karakter \{[^}]*width: 96px; height: 96px;/);
  assert.match(css, /\.panel__ok--sag \{ right: -8px; \}/);
  assert.match(css, /\.panel__sayfa \{ margin: 0 24px; \}/, 'oklar sayfanın (yazı alanı, mikrofon) üstüne binmez');
});

test('düzeltme 3: Sade dinlenmede mod geçişi 8 px noktayla (40 px işaret görünmez)', () => {
  const ada = kaynakOku('src/renderer/ada/Ada.tsx');
  assert.match(ada, /<ModGecisi eski=\{gecis\.eski\} yeni=\{gecis\.yeni\} boyut=\{SADE_NOKTA_PX\}/);
  assert.match(ada, /const SADE_NOKTA_PX = 8;/);
});

// 0.14 çentik cilası (5 Kas; hover animasyonu çok geç tetikleniyordu): ilk karede görsel tepki (CSS :hover şişmesi ve vurgu ışığı; React ya da
// zamanlayıcı beklenmez), panel HOVER_GECIKME_MS sonra açılır ve içerik katmanının girişi 120 ms bütçesinin içinde başlar (gecikme + katman gecikmesi ≤ 120 ms).
test('hover zamanlaması: ilk karede şişme, panel içeriği ≤ 120 ms içinde girmeye başlar', () => {
  const css = kaynakOku('src/renderer/ada/ada.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const katman = /\.ada__katman \{[^}]*animation: ada-gir (\d+)ms [^;]* (\d+)ms backwards/.exec(css);
  assert.ok(katman, 'katman giriş animasyonu');
  const gecikme = Number(katman[2]);
  assert.ok(HOVER_GECIKME_MS + gecikme <= 120, `hover ${HOVER_GECIKME_MS} + içerik gecikmesi ${gecikme} ms ≤ 120`);
  assert.ok(HOVER_GECIKME_MS >= 40, 'üst kenardan geçen imleç için bir süzgeç kalır');
  // İlk kare: boştaki çentiğin :hover kuralı (gecikmesiz, ≤ 120 ms geçişle) — dinlenme ve Kapalı'da.
  const sisme = /\.ada:is\(\[data-ada-hal='dinlenme'\], \[data-ada-hal='sessiz'\]\) \.ada__sekil:hover \{([^}]*)\}/.exec(css);
  assert.ok(sisme && /scale\(/.test(sisme[1]), 'hover şişmesi');
  const sure = /transition: transform (\d+)ms/.exec(sisme[1]);
  assert.ok(sure && Number(sure[1]) <= 120 && !/transition:[^;]*\d+ms \S+ \d+ms/.test(sisme[1]), 'şişme gecikmesiz ve ≤ 120 ms');
});
