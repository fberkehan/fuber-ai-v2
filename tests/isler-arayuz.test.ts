// 0.11 G10 — Görevler: arayüzün saf yardımcıları (src/shared/isler-gorunum.ts) ve görev sohbetlerinin kokpit listesinden / okunmamış
// toplamlarından süzülmesi (src/shared/kokpit-sohbet.ts). Bir şeyin takibi istenince Fuber aralıklar üretip kendi kendini
// tetikler — kullanıcı bu işleri bir kartta görür: kalan süre, son kontrol, adım sayısı, Durdur / Sürdür. Sınanır:
//  · gorevSatiri: süren / çalışan adım / durdu (kapanış, acil, Gizli, kullanıcı, hata) / bitti / sınır; göreli zaman ekleri ("12 sn önce",
//    "1 dk önce"); sürdürülemeyen iş eylemsiz; İş dili temiz (IS_YASAK); tek satır ve kırpılmış sonuç;
//  · kart ögeleri: süren önce, bugün bitenler yeni → eski, dünün bitenleri kartta yok; "N gönderim" rozeti;
//  · görev sohbetleri (sohbetler.tur 'gorev') kokpit sohbet seçicisinin "son 8"inde GÖRÜNMEZ, okunmamışları kenar çubuğu/telefon toplamına ve
//    "Ana sohbette N yeni mesaj" çipine SAYILMAZ; son seçilen sohbet bir görev sohbetiyse kokpit ana sohbetle açılır.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GOREV_BOS_METNI, GOREV_DURDUR_HATASI, GOREV_SURDUR_HATASI, adimdakiGorev, gonderimRozeti, gorevOnayAciklamasi, gorevBosGorulduYazilsin, gorevKartiHali, gorevKartiOgeleri, gorevOzeti, gorevSatiri, goreliOnce, kalanMetni, pencereGorunurMu, surdurulebilirMi,
} from '../src/shared/isler-gorunum.ts';
import { isPlaniDogrula, type DurmaNedeni, type IsOzet, type IsPlani } from '../src/shared/isler.ts';
import { isDiliIhlali } from '../src/shared/is-dili.ts';
import { TERIM } from '../src/shared/terimler.ts';
import { olayMetni, type BeyinOlayi, type GorevOlayiTuru } from '../src/shared/beyin.ts';
import { acilirListe, anaYeniSayisi, gecerliSecim, gorevSohbetiMi, kokpitSohbeti, kokpitSohbetleri, okunmamisToplami } from '../src/shared/kokpit-sohbet.ts';
import type { SohbetOzet } from '../src/shared/tipler.ts';

// Yerel öğle: "bugün" yerel gündür; saat dilimi ne olursa olsun iki saat önceki an aynı gündedir.
const SIMDI = new Date(2026, 9, 28, 12, 0, 0);
const sonra = (sn: number) => new Date(SIMDI.getTime() + sn * 1000);
const once = (sn: number) => sonra(-sn).toISOString();

const plan = (ek: Record<string, unknown> = {}): IsPlani => {
  const r = isPlaniDogrula({ gozcu: { tur: 'whatsapp', hedef: 'Ahmet' }, aralik: { min: 10, max: 120 }, bitis: { tur: 'sure', saniye: 3600 }, izinler: [], azamiAdim: 60, ...ek }, SIMDI);
  assert.ok('plan' in r, JSON.stringify(r));
  return r.plan;
};
const is = (ek: Partial<IsOzet> = {}): IsOzet => ({
  id: 1, baslik: 'Ahmet’in yanıtını izle', amac: 'Ahmet cevap verince söyle', durum: 'suruyor', plan: plan(), baslangic: once(600),
  bitisZamani: sonra(130).toISOString(), sonraki: sonra(10).toISOString(), sonKontrol: once(12), adim: 3, kontrol: 9, sonOzet: null, sonuc: null,
  durmaNedeni: null, sohbetId: 7, ...ek,
});
const durdu = (neden: DurmaNedeni, ek: Partial<IsOzet> = {}) => is({ durum: 'durdu', durmaNedeni: neden, bitisZamani: once(30), sonraki: null, ...ek });

// ── Step 1: gorevSatiri ──────────────────────────────────────────────────────────────────────────────────────────

test('G10: süren görev — kalan süre · son kontrol · adım sayısı; Durdur', () => {
  const s = gorevSatiri(is(), SIMDI);
  assert.equal(s.baslik, 'Ahmet’in yanıtını izle');
  assert.equal(s.alt, '2 dk 10 sn kaldı · son kontrol 12 sn önce · 3 adım');
  assert.deepEqual(s.rozet, { ton: 'iyi', metin: 'Sürüyor' });
  assert.equal(s.eylem, 'durdur');
});

test('G10: süren görevde adım çalışıyorsa rozet "Çalışıyor"; henüz kontrol yoksa ve adım 0 ise o parçalar yazılmaz', () => {
  assert.deepEqual(gorevSatiri(is({ adimda: true }), SIMDI).rozet, { ton: 'bilgi', metin: 'Çalışıyor' });
  const yeni = gorevSatiri(is({ sonKontrol: null, adim: 0, kontrol: 0, bitisZamani: sonra(45).toISOString() }), SIMDI);
  assert.equal(yeni.alt, '45 sn kaldı · henüz kontrol etmedi');
  assert.equal(gorevSatiri(is({ adim: 1 }), SIMDI).alt, '2 dk 10 sn kaldı · son kontrol 12 sn önce · 1 adım');
});

test('G10: süre bitmek üzereyse "az kaldı"; bitiş zamanı yoksa kalan süre yazılmaz', () => {
  assert.equal(gorevSatiri(is({ bitisZamani: sonra(-3).toISOString() }), SIMDI).alt, 'az kaldı · son kontrol 12 sn önce · 3 adım');
  assert.equal(gorevSatiri(is({ bitisZamani: null }), SIMDI).alt, 'son kontrol 12 sn önce · 3 adım');
});

test('G10: göreli zaman ekleri doğru — sn, dk, sa, gün; çok yeni "az önce"', () => {
  const g = (sn: number) => goreliOnce(once(sn), SIMDI);
  assert.equal(g(12), '12 sn önce');
  assert.equal(g(59), '59 sn önce');
  assert.equal(g(60), '1 dk önce');
  assert.equal(g(125), '2 dk önce');
  assert.equal(g(3599), '59 dk önce');
  assert.equal(g(3600), '1 sa önce');
  assert.equal(g(7300), '2 sa önce');
  assert.equal(g(86_400), '1 gün önce');
  assert.equal(g(3), 'az önce');
  assert.equal(g(0), 'az önce');
  assert.equal(goreliOnce(sonra(30).toISOString(), SIMDI), 'az önce', 'saat kayması: gelecek zaman "az önce" sayılır');
  assert.equal(goreliOnce(null, SIMDI), '');
  assert.equal(goreliOnce('bozuk', SIMDI), '');
});

test('G10: kalan süre — sn, dk + sn, dk, sa + dk', () => {
  assert.equal(kalanMetni(45), '45 sn kaldı');
  assert.equal(kalanMetni(130), '2 dk 10 sn kaldı');
  assert.equal(kalanMetni(120), '2 dk kaldı');
  assert.equal(kalanMetni(599), '9 dk 59 sn kaldı');
  assert.equal(kalanMetni(600), '10 dk kaldı');
  assert.equal(kalanMetni(601.2), '10 dk kaldı', 'on dakikadan sonra saniye yazılmaz');
  assert.equal(kalanMetni(3600), '1 sa kaldı');
  assert.equal(kalanMetni(5400), '1 sa 30 dk kaldı');
  assert.equal(kalanMetni(86_400), '24 sa kaldı');
  assert.equal(kalanMetni(0), 'az kaldı');
  assert.equal(kalanMetni(-5), 'az kaldı');
  assert.equal(kalanMetni(Number.NaN), 'az kaldı');
});

test('G10: durdu — her neden için sakin tek cümle; Sürdür', () => {
  const beklenen: [DurmaNedeni, string][] = [
    ['kapanis', 'Fuber kapandığı için durdu'],
    ['acil', 'Acil durdurmayla durdu'],
    ['gizli', 'Gizli mod açıldığı için durdu'],
    // Son inceleme I1: yol Gizli DIŞINDA yalnız bu bilgisayardaki yapay zekâ olduysa (Geliştirici anahtarı, bulut hesabı kullanılamıyor) nötr cümle.
    ['yerel', 'Bu bilgisayardaki yapay zekâyla görev çalışmaz; durdu'],
    ['kullanici', 'Durdurdun'],
  ];
  for (const [neden, alt] of beklenen) {
    const s = gorevSatiri(durdu(neden), SIMDI);
    assert.equal(s.alt, alt, neden);
    assert.equal(s.rozet.metin, 'Durdu', neden);
    assert.equal(s.eylem, 'surdur', neden);
  }
  assert.deepEqual(gorevSatiri(durdu('kapanis'), SIMDI).rozet, { ton: 'notr', metin: 'Durdu' });
  assert.equal(gorevSatiri(durdu('gizli'), SIMDI).rozet.ton, 'uyari', 'Gizli: kullanıcının bilmesi gereken durma');
  assert.equal(gorevSatiri(durdu('yerel'), SIMDI).rozet.ton, 'uyari', 'yalnız yerel yol: kullanıcının bilmesi gereken durma');
  assert.equal(gorevSatiri(durdu('acil'), SIMDI).rozet.ton, 'uyari');
  assert.doesNotMatch(gorevSatiri(durdu('yerel'), SIMDI).alt, /Gizli|gizli/, 'Gizli kapalıyken Gizli denmez');
});

test('G10: hata — art arda ilerleyemeyen görev durdu, Sürdür; nedeni olmayan durdu da sakin bir cümle alır', () => {
  const h = gorevSatiri(is({ durum: 'hata', durmaNedeni: 'hata', bitisZamani: once(5), sonraki: null }), SIMDI);
  assert.equal(h.alt, 'İlerleyemediği için durdu');
  assert.deepEqual(h.rozet, { ton: 'hata', metin: 'Sorun' });
  assert.equal(h.eylem, 'surdur');
  const nedensiz = gorevSatiri(durdu('kullanici', { durmaNedeni: null }), SIMDI);
  assert.equal(nedensiz.alt, 'Durdu');
  assert.equal(nedensiz.eylem, 'surdur');
});

test('G10: bitti — "Bitti · <sonuç, tek satır>"; sonuç yoksa "Bitti"; eylem yok', () => {
  const b = gorevSatiri(is({ durum: 'bitti', sonuc: 'Ahmet yazdı: yarın geliyorum.\n\nTamam   mı?', bitisZamani: once(20), sonraki: null }), SIMDI);
  assert.equal(b.alt, 'Bitti · Ahmet yazdı: yarın geliyorum. Tamam mı?');
  assert.equal(b.eylem, null);
  assert.equal(b.rozet.ton, 'iyi');
  assert.equal(gorevSatiri(is({ durum: 'bitti', sonuc: null }), SIMDI).alt, 'Bitti');
  assert.equal(gorevSatiri(is({ durum: 'bitti', sonuc: '   ' }), SIMDI).alt, 'Bitti');
  const uzun = gorevSatiri(is({ durum: 'bitti', sonuc: 'a'.repeat(400) }), SIMDI).alt;
  assert.ok(uzun.length <= 150 && uzun.endsWith('…') && !uzun.includes('\n'), uzun.length.toString());
});

test('G10: sınır — adım sınırında biten görev "Sınıra ulaştı"; sürdürülemez', () => {
  const s = gorevSatiri(is({ durum: 'bitti', durmaNedeni: 'sinir', adim: 60, sonuc: 'En çok 60 adım sınırına ulaşıldı. Son durum: Ahmet yazmadı.' }), SIMDI);
  assert.deepEqual(s.rozet, { ton: 'uyari', metin: 'Sınıra ulaştı' });
  assert.equal(s.alt, 'Bitti · En çok 60 adım sınırına ulaşıldı. Son durum: Ahmet yazmadı.');
  assert.equal(s.eylem, null);
  assert.equal(gorevSatiri(durdu('sinir', { adim: 60 }), SIMDI).alt, 'Adım sınırına ulaştı');
});

test('G10: sürdürülemeyen görevde Sürdür yok — adım sınırı dolmuş ya da bitiş zamanı geçmiş', () => {
  const sinirli = durdu('kapanis', { plan: plan({ azamiAdim: 3 }), adim: 3 });
  assert.equal(surdurulebilirMi(sinirli, SIMDI), false);
  assert.equal(gorevSatiri(sinirli, SIMDI).eylem, null);
  assert.equal(gorevSatiri(sinirli, SIMDI).alt, 'Fuber kapandığı için durdu', 'neden yine söylenir');
  const gecmis = durdu('kapanis', { plan: { ...plan(), bitis: { tur: 'zaman', iso: once(60) } } });
  assert.equal(surdurulebilirMi(gecmis, SIMDI), false);
  assert.equal(gorevSatiri(gecmis, SIMDI).eylem, null);
  assert.equal(surdurulebilirMi(durdu('kapanis'), SIMDI), true);
  assert.equal(surdurulebilirMi(is(), SIMDI), false, 'süren görev sürdürülmez');
  assert.equal(surdurulebilirMi(is({ durum: 'bitti' }), SIMDI), false);
});

test('G10: onay durumu (kayda geçmez, yine de çökmez)', () => {
  const s = gorevSatiri(is({ durum: 'onay' }), SIMDI);
  assert.equal(s.eylem, null);
  assert.equal(s.rozet.metin, 'Onay bekliyor');
});

test('G10: İş dili temiz — bütün durum cümleleri ve rozetleri IS_YASAK’a takılmaz', () => {
  const durumlar: IsOzet[] = [
    is(), is({ adimda: true }), is({ sonKontrol: null, adim: 0 }), is({ bitisZamani: null }),
    ...(['kullanici', 'acil', 'kapanis', 'sinir', 'hata', 'gizli', 'yerel'] as DurmaNedeni[]).map((n) => durdu(n)),
    is({ durum: 'hata', durmaNedeni: 'hata' }), is({ durum: 'bitti' }), is({ durum: 'bitti', durmaNedeni: 'sinir', sonuc: 'Sınır doldu.' }), is({ durum: 'onay' }),
  ];
  for (const d of durumlar) {
    const s = gorevSatiri(d, SIMDI);
    for (const metin of [s.alt, s.rozet.metin]) assert.equal(isDiliIhlali(metin), null, `${d.durum}/${d.durmaNedeni}: ${metin}`);
  }
  for (const metin of [GOREV_BOS_METNI, '1 gönderim', kalanMetni(90), goreliOnce(once(90), SIMDI)]) assert.equal(isDiliIhlali(metin), null, metin);
});

// ── G10 düzeltme turu 1 ───────────────────────────────────────────────────────────────────────────────────────────

// K4: İş dili simetrisi — Etkinlik akışı yasak sözcük taşıyan adım özetini/başlığı İş'te düşürür; Görevler kartı da AYNI yardımcıyla (isGuvenliMetin) aynı kuralı uygular.
test('G10 (K4): İş dilinde kart yasak sözcük taşıyan başlığı/özeti/sonucu göstermez (Etkinlik ile aynı kural); Geliştirici\'de olduğu gibi', () => {
  const kirliler = ['token sınırı doldu', 'Claude yanıt verdi', 'model değişti', 'bu bir motor işi', 'API anahtarı yenilendi'];
  for (const k of kirliler) {
    const sonuc = is({ durum: 'bitti', sonuc: k });
    assert.equal(gorevSatiri(sonuc, SIMDI, 'is').alt, 'Bitti', `sonuç düşer: ${k}`);
    assert.equal(gorevSatiri(sonuc, SIMDI).alt, 'Bitti', 'varsayılan mod İş');
    assert.equal(gorevSatiri(sonuc, SIMDI, 'gelistirici').alt, `Bitti · ${k}`, 'Geliştirici ham');
    assert.equal(gorevOzeti(is({ sonOzet: k }), 'is'), null, `özet düşer: ${k}`);
    assert.equal(gorevOzeti(is({ sonOzet: k }), 'gelistirici'), k);
    assert.equal(gorevSatiri(is({ baslik: k }), SIMDI, 'is').baslik, TERIM.gorev, `başlık "Görev" olur: ${k}`);
    assert.equal(gorevSatiri(is({ baslik: k }), SIMDI, 'gelistirici').baslik, k);
    // Etkinlik ile aynı karar: kartın düşürdüğünü Akış da düşürür.
    assert.equal(olayMetni(gorevOlayi('adim', { ozet: k }), 'is')?.alt, 'Ahmet’in yanıtını izle', `Akış da özeti düşürür: ${k}`);
  }
  // Temiz metin İş'te olduğu gibi.
  assert.equal(gorevSatiri(is({ durum: 'bitti', sonuc: 'Ahmet toplantıyı 15:00’e aldı.' }), SIMDI, 'is').alt, 'Bitti · Ahmet toplantıyı 15:00’e aldı.');
  assert.equal(gorevOzeti(is({ sonOzet: 'Ahmet henüz yazmadı.' }), 'is'), 'Ahmet henüz yazmadı.');
});

// K1: güvenlik eylemi (Durdur/Sürdür) IPC'si düşerse sessiz kalmaz — kart tost, ada pil içinde tek satır; metinler sakin ve İş dilinde.
test('G10 (K1): Durdur/Sürdür hata cümleleri tek satır, sakin, İş dilinde ve sözlükten', () => {
  assert.equal(GOREV_DURDUR_HATASI, `${TERIM.gorev} durdurulamadı; yeniden dene.`);
  assert.equal(GOREV_SURDUR_HATASI, `${TERIM.gorev} sürdürülemedi; yeniden dene.`);
  for (const m of [GOREV_DURDUR_HATASI, GOREV_SURDUR_HATASI]) { assert.equal(isDiliIhlali(m), null, m); assert.ok(!m.includes('\n') && m.length <= 48, m); }
});

// Son inceleme küçük 4: görev adımının izin dışı onay kartı görevi adıyla anar (ana süreç: ajan/dongu.ts araciCalistir; uçtan uca: tests/isler-izin.test.ts).
test('küçük 4: gorevOnayAciklamasi — "Görev: <başlık> · <açıklama>"; başlık tek satır ve kırpılmış; İş’te yasak sözcüklü başlık düşer', () => {
  assert.equal(gorevOnayAciklamasi('Faturayı ilet', 'deniz@ornek.co → baska@ornek.co'), 'Görev: Faturayı ilet · deniz@ornek.co → baska@ornek.co');
  assert.equal(gorevOnayAciklamasi('  İki\n satır  ', 'x'), `${TERIM.gorev}: İki satır · x`);
  assert.equal(gorevOnayAciklamasi('', 'x'), `${TERIM.gorev} · x`, 'başlıksız');
  assert.equal(gorevOnayAciklamasi('API anahtarını izle', 'x', 'is'), `${TERIM.gorev} · x`, 'İş: yasak sözcüklü başlık düşer (Görevler kartıyla aynı kural)');
  assert.equal(gorevOnayAciklamasi('API anahtarını izle', 'x', 'gelistirici'), `${TERIM.gorev}: API anahtarını izle · x`);
  const uzun = gorevOnayAciklamasi('a'.repeat(200), 'x');
  assert.ok(uzun.length < 100 && uzun.includes('…'), uzun);
  assert.equal(isDiliIhlali(gorevOnayAciklamasi('Faturayı ilet', 'deniz@ornek.co → baska@ornek.co')), null);
});

// K5: "bir kez" yalnız satır gerçekten çizilip pencere görünürken harcanır (hazır değilken ya da --gizli ile hiç gösterilmemiş pencerede değil).
test('G10 (K5): ilk kullanım satırı yalnız çizildiğinde ve pencere görünürken "görüldü" sayılır; bir kez', () => {
  const o = { hali: 'bos' as const, hazir: true, gorunur: true, yazildi: false };
  assert.equal(gorevBosGorulduYazilsin(o), true);
  assert.equal(gorevBosGorulduYazilsin({ ...o, hazir: false }), false, 'kokpit verisi gelmedi: satır çizilmedi');
  assert.equal(gorevBosGorulduYazilsin({ ...o, gorunur: false }), false, 'pencere gösterilmedi (--gizli, tepside)');
  assert.equal(gorevBosGorulduYazilsin({ ...o, yazildi: true }), false, 'zaten yazıldı');
  assert.equal(gorevBosGorulduYazilsin({ ...o, hali: 'yok' }), false, 'satır yok');
  assert.equal(gorevBosGorulduYazilsin({ ...o, hali: 'liste' }), false, 'görev var: satır gösterilmedi');
});

test('G10 (K5): pencere görünürlüğü belge VE ana süreçten; hiç gösterilmemiş (--gizli) pencerede belge "görünür" dese de ana süreç "değil" derse görünmez', () => {
  assert.equal(pencereGorunurMu(false, true), true);
  assert.equal(pencereGorunurMu(false, false), false, 'ana süreç: pencere gösterilmedi / simge durumunda (belge çizilse de)');
  assert.equal(pencereGorunurMu(true, true), false, 'belge gizli (tepside)');
  assert.equal(pencereGorunurMu(false, undefined), false, 'ana süreç henüz yanıtlamadı: karar verilmez');
});

test('G10 (K5): ana süreç pencere görünürlüğünü pencere:durum ile bildirir (show/hide/minimize olayları)', async () => {
  const { readFileSync } = await import('node:fs');
  const kabuk = readFileSync(new URL('../src/main/pencere-kabugu.ts', import.meta.url), 'utf8');
  assert.match(kabuk, /gorunur: w\.isVisible\(\) && !w\.isMinimized\(\)/);
  assert.match(kabuk, /'restore', 'focus', 'blur', 'show', 'hide', 'minimize'/, 'görünürlük değişince arayüze yeniden bildirilir');
});

test('G10: boş durum metni sade dilde; apostrof ’', () => {
  assert.equal(GOREV_BOS_METNI, 'Fuber’e bir işi takip ettirebilirsin');
  assert.ok(!GOREV_BOS_METNI.includes("'"));
});

// ── Kart ögeleri ──────────────────────────────────────────────────────────────────────────────────────────────

test('G10: kart — süren önce, bugün bitenler yeni → eski, dünün bitenleri ve onay durumu yok', () => {
  const suren1 = is({ id: 1, baslangic: once(900) });
  const suren2 = is({ id: 2, baslangic: once(300) });
  const bittiBugun = is({ id: 3, durum: 'bitti', bitisZamani: once(7200) });
  const durduBugun = durdu('kapanis', { id: 4, bitisZamani: once(60) });
  const dun = is({ id: 5, durum: 'bitti', bitisZamani: new Date(SIMDI.getTime() - 36 * 3600_000).toISOString() });
  const onay = is({ id: 6, durum: 'onay' });
  const k = gorevKartiOgeleri([bittiBugun, dun, suren2, durduBugun, suren1, onay], SIMDI);
  assert.deepEqual(k.suren.map((x) => x.id), [1, 2], 'süren: önce başlayan üstte');
  assert.deepEqual(k.bugun.map((x) => x.id), [4, 3], 'bugün biten/duran: en yeni önce');
  assert.deepEqual(k.hepsi.map((x) => x.id), [1, 2, 4, 3]);
  assert.deepEqual(gorevKartiOgeleri([], SIMDI), { suren: [], bugun: [], hepsi: [] });
});

test('G10: "bugün" yerel gündür — gece yarısından önce biten dünün sayılır', () => {
  const simdi = new Date(2026, 9, 28, 0, 30, 0); // yerel 00:30
  const dunGece = is({ id: 1, durum: 'bitti', bitisZamani: new Date(2026, 9, 27, 23, 50, 0).toISOString() });
  const bugunGece = is({ id: 2, durum: 'bitti', bitisZamani: new Date(2026, 9, 28, 0, 10, 0).toISOString() });
  assert.deepEqual(gorevKartiOgeleri([dunGece, bugunGece], simdi).bugun.map((x) => x.id), [2]);
});

test('G10: bitiş zamanı bozuk ya da yok olan duran görev bugünden sayılmaz (kart şişmez)', () => {
  assert.deepEqual(gorevKartiOgeleri([durdu('acil', { bitisZamani: null }), durdu('acil', { id: 2, bitisZamani: 'bozuk' })], SIMDI).bugun, []);
});

test('G10: kart hâli — görev varsa liste; boşken yalnız ilk kullanımda bir kez tek satır; araçsız yolda ya da sonra görünmez', () => {
  const bir = [is()];
  assert.equal(gorevKartiHali({ hepsi: bir, ilkKullanim: false, aracsiz: false }), 'liste');
  assert.equal(gorevKartiHali({ hepsi: bir, ilkKullanim: true, aracsiz: false }), 'liste');
  assert.equal(gorevKartiHali({ hepsi: bir, ilkKullanim: false, aracsiz: true }), 'liste', 'Gizli’de duran görev satırı kalır (Sürdür’ün neden kapalı olduğu görünür)');
  assert.equal(gorevKartiHali({ hepsi: [], ilkKullanim: true, aracsiz: false }), 'bos', 'ilk kullanımda bir kez');
  assert.equal(gorevKartiHali({ hepsi: [], ilkKullanim: false, aracsiz: false }), 'yok', 'sonra kart boşken görünmez');
  assert.equal(gorevKartiHali({ hepsi: [], ilkKullanim: true, aracsiz: true }), 'yok', 'görev başlatamayan yolda "takip ettirebilirsin" denmez');
});

test('G10: ada hapının kaynağı — adımı süren ilk görev; ekran izni; kaç görevin adımı sürüyor', () => {
  const ekranli = (ek: Partial<IsOzet>) => is({ plan: plan({ izinler: [{ tur: 'ekran' }] }), ...ek });
  assert.equal(adimdakiGorev([]), null);
  assert.equal(adimdakiGorev([is({ adimda: false }), is({ id: 2 })]), null, 'kontrol adım değildir');
  assert.deepEqual(adimdakiGorev([is({ id: 4, adimda: true, baslik: 'Ahmet’i izle' })]), { id: 4, baslik: 'Ahmet’i izle', ekran: false, sayi: 1 });
  assert.deepEqual(adimdakiGorev([ekranli({ id: 5, adimda: true, baslik: 'Ekranı izle' })]), { id: 5, baslik: 'Ekranı izle', ekran: true, sayi: 1 });
  // Birden çok görevin adımı sürüyorsa en eski başlayan gösterilir, sayı söylenir; duran görevin (adımı bitmemiş) adımı sayılmaz.
  const l = [is({ id: 9, adimda: true, baslangic: once(60), baslik: 'Yeni' }), is({ id: 8, adimda: true, baslangic: once(600), baslik: 'Eski' }), durdu('acil', { id: 7, adimda: true })];
  assert.deepEqual(adimdakiGorev(l), { id: 8, baslik: 'Eski', ekran: false, sayi: 2 });
  assert.equal(adimdakiGorev([durdu('acil', { adimda: true })]), null);
});

test('G10: son adım özeti tek satır; yoksa null', () => {
  assert.equal(gorevOzeti(is({ sonOzet: 'Ahmet henüz yazmadı.\nBir sonraki kontrol 30 sn sonra.' })), 'Ahmet henüz yazmadı. Bir sonraki kontrol 30 sn sonra.');
  assert.equal(gorevOzeti(is({ sonOzet: null })), null);
  assert.equal(gorevOzeti(is({ sonOzet: '  ' })), null);
  assert.ok((gorevOzeti(is({ sonOzet: 'b'.repeat(500) })) ?? '').length <= 150);
  assert.equal(gorevOzeti(is({ durum: 'bitti', sonOzet: 'x' })), null, 'biten görevde sonuç zaten alt satırda; özet tekrarlanmaz');
});

test('G10: "N gönderim" rozeti — gönderim varsa kısa, yoksa yok', () => {
  assert.equal(gonderimRozeti(is()), null);
  assert.equal(gonderimRozeti(is({ gonderim: 0 })), null);
  assert.deepEqual(gonderimRozeti(is({ gonderim: 1 })), { sayi: 1, metin: '1 gönderim' });
  assert.deepEqual(gonderimRozeti(is({ gonderim: 12 })), { sayi: 12, metin: '12 gönderim' });
  assert.equal(gonderimRozeti(is({ gonderim: -2 })), null);
});

// ── Görev sohbetleri: kokpit listesi ve okunmamış toplamları ──────────────────────────────────────────────────────────

const ANA = 1;
let zaman = 0;
const sohbet = (id: number, ek: Partial<SohbetOzet> = {}): SohbetOzet => ({
  id, baslik: `Sohbet ${id}`, tur: id === ANA ? 'ana' : 'normal', guncelleme: new Date(Date.UTC(2026, 9, 28, 8, 0, 0) + (zaman += 60_000)).toISOString(), okunmamis: 0, ...ek,
});
const gorevSohbeti = (id: number, ek: Partial<SohbetOzet> = {}) => sohbet(id, { tur: 'gorev', baslik: `Görev · İş ${id}`, ...ek });

test('G10: görev sohbeti kokpit listesinden süzülür — "son 8" yalnız normal sohbetlerden', () => {
  assert.equal(gorevSohbetiMi(gorevSohbeti(5)), true);
  assert.equal(gorevSohbetiMi(sohbet(6)), false);
  assert.equal(gorevSohbetiMi(sohbet(ANA)), false);
  // 10 normal + 3 görev sohbeti; görev sohbetleri EN YENİ: süzülmezse "son 8" onlarla dolardı.
  const normal = Array.from({ length: 10 }, (_, i) => sohbet(10 + i));
  const l = [sohbet(ANA), ...normal, gorevSohbeti(30), gorevSohbeti(31), gorevSohbeti(32)];
  const { ana, son } = acilirListe(l, ANA);
  assert.equal(ana?.id, ANA);
  assert.equal(son.length, 8);
  assert.ok(son.every((s) => s.tur === 'normal'), 'görev sohbeti listede yok');
  assert.deepEqual(son.map((s) => s.id), [19, 18, 17, 16, 15, 14, 13, 12]);
  assert.deepEqual(kokpitSohbetleri(l).map((s) => s.id), [ANA, ...normal.map((s) => s.id)]);
  assert.equal(kokpitSohbetleri(l).length, 11);
  assert.deepEqual(kokpitSohbetleri([]), []);
});

test('G10: kokpitSohbeti — son seçilen bir görev sohbetiyse ana açılır; normal seçim bozulmaz', () => {
  const l = [sohbet(ANA), sohbet(5), sohbet(6), gorevSohbeti(7)];
  assert.equal(kokpitSohbeti({ anaId: ANA, sonSecilen: 7, anaOkunmamis: 0, liste: l }), ANA, 'görev sohbeti kokpit paneline açılmaz');
  assert.equal(kokpitSohbeti({ anaId: ANA, sonSecilen: 6, anaOkunmamis: 0, liste: l }), 6);
  assert.equal(kokpitSohbeti({ anaId: ANA, sonSecilen: 6, anaOkunmamis: 2, liste: l }), ANA, 'ana sohbette okunmamış varsa yine ana');
  assert.equal(gecerliSecim(7, { anaId: ANA, liste: l }), ANA, 'panel görev sohbetinde kalmaz');
  assert.equal(gecerliSecim(6, { anaId: ANA, liste: l }), 6);
  assert.equal(gecerliSecim('yeni', { anaId: ANA, liste: l }), 'yeni');
});

test('G10: "Ana sohbette N yeni mesaj" çipi görev sohbetinin okunmamışını saymaz', () => {
  const l = [sohbet(ANA, { okunmamis: 2 }), sohbet(5), gorevSohbeti(7, { okunmamis: 9 })];
  assert.equal(anaYeniSayisi({ secim: 5, anaId: ANA, liste: l }), 2, 'yalnız ana sohbetin 2’si');
  assert.equal(anaYeniSayisi({ secim: ANA, anaId: ANA, liste: l }), 0);
});

// ── Etkinlik akışı: görev olayları ───────────────────────────────────────────────────────────────────────────────────

const gorevOlayi = (olay: GorevOlayiTuru, ek: Partial<NonNullable<BeyinOlayi['gorev']>> = {}): BeyinOlayi => ({
  id: 1, zaman: '2026-10-28T09:00:00.000Z', tur: 'gorev', bolge: 'saat', gorev: { olay, id: 7, baslik: 'Ahmet’in yanıtını izle', ...ek },
});

test('G10: Etkinlik akışı — Görev başladı / kontrol etti (değişiklik yok) / adım / bitti / durdu / yeniden başladı', () => {
  for (const mod of ['is', 'gelistirici'] as const) {
    assert.deepEqual(olayMetni(gorevOlayi('basladi'), mod), { ust: 'Görev başladı', alt: 'Ahmet’in yanıtını izle' });
    assert.deepEqual(olayMetni(gorevOlayi('kontrol'), mod), { ust: 'Görev kontrol etti', alt: 'Ahmet’in yanıtını izle · değişiklik yok' });
    assert.deepEqual(olayMetni(gorevOlayi('kontrol', { n: 3 }), mod), { ust: 'Görev kontrol etti', alt: 'Ahmet’in yanıtını izle · 3 kez · değişiklik yok' });
    assert.deepEqual(olayMetni(gorevOlayi('adim', { ozet: 'Ahmet henüz yazmadı.' }), mod), { ust: 'Görev adım attı', alt: 'Ahmet’in yanıtını izle · Ahmet henüz yazmadı.' });
    assert.deepEqual(olayMetni(gorevOlayi('adim'), mod), { ust: 'Görev adım attı', alt: 'Ahmet’in yanıtını izle' });
    assert.deepEqual(olayMetni(gorevOlayi('bitti'), mod), { ust: 'Görev bitti', alt: 'Ahmet’in yanıtını izle' });
    assert.deepEqual(olayMetni(gorevOlayi('surdu'), mod), { ust: 'Görev yeniden başladı', alt: 'Ahmet’in yanıtını izle' });
    assert.deepEqual(olayMetni(gorevOlayi('durdu', { neden: 'kapanis' }), mod), { ust: 'Görev durdu', alt: 'Ahmet’in yanıtını izle · Fuber kapandı' });
  }
  const nedenler: [NonNullable<NonNullable<BeyinOlayi['gorev']>['neden']>, string][] = [
    ['kullanici', 'sen durdurdun'], ['acil', 'acil durdurma'], ['kapanis', 'Fuber kapandı'], ['sinir', 'adım sınırı'], ['hata', 'ilerleyemedi'], ['gizli', 'Gizli mod açıldı'],
    ['yerel', 'yapay zekâ şu an yalnız bu bilgisayarda'], // son inceleme I1: Gizli kapalıyken "Gizli mod açıldı" denmez
  ];
  for (const [neden, kisa] of nedenler) {
    const m = olayMetni(gorevOlayi('durdu', { neden }), 'is');
    assert.equal(m?.alt, `Ahmet’in yanıtını izle · ${kisa}`, neden);
    assert.equal(isDiliIhlali(`${m?.ust} ${m?.alt}`), null, neden);
  }
  assert.deepEqual(olayMetni(gorevOlayi('durdu'), 'is'), { ust: 'Görev durdu', alt: 'Ahmet’in yanıtını izle' }, 'nedeni olmayan durma');
  assert.equal(olayMetni({ ...gorevOlayi('basladi'), gorev: undefined }, 'is'), null, 'görev bilgisi yoksa satır yok');
});

test('G10: Etkinlik akışı — İş modunda yasak sözcük taşıyan özet/başlık yerine sade metin; Geliştirici’de olduğu gibi; "beyin" yok', () => {
  const kirli = gorevOlayi('adim', { ozet: 'token sınırı doldu' });
  assert.equal(olayMetni(kirli, 'is')?.alt, 'Ahmet’in yanıtını izle', 'özet düşer');
  assert.equal(olayMetni(kirli, 'gelistirici')?.alt, 'Ahmet’in yanıtını izle · token sınırı doldu');
  assert.equal(olayMetni(gorevOlayi('basladi', { baslik: 'API anahtarını izle' }), 'is')?.alt, 'Görev', 'başlık yasak sözcük taşırsa');
  for (const o of ['basladi', 'kontrol', 'adim', 'bitti', 'durdu', 'surdu'] as const) {
    const m = olayMetni(gorevOlayi(o, { neden: 'acil', ozet: 'Bir şey oldu.' }), 'is')!;
    assert.equal(isDiliIhlali(`${m.ust} ${m.alt}`), null, o);
    assert.ok(!/beyin/i.test(`${m.ust} ${m.alt}`), o);
  }
});

test('G10: okunmamış toplamı (kenar çubuğu, telefon, Sohbetler) görev sohbetini saymaz', () => {
  const l = [sohbet(ANA, { okunmamis: 3 }), sohbet(5, { okunmamis: 2 }), gorevSohbeti(7, { okunmamis: 14 }), gorevSohbeti(8, { okunmamis: 5 })];
  assert.equal(okunmamisToplami(l), 5, 'telefon rozeti: ana + normal; görev adımları şişirmez');
  assert.equal(okunmamisToplami(l, { anaHaric: true }), 2, 'kenar çubuğu: ana sohbet kokpitte görünür, sayılmaz');
  assert.equal(okunmamisToplami([]), 0);
  assert.equal(okunmamisToplami([sohbet(5, { okunmamis: undefined })]), 0);
  assert.equal(okunmamisToplami([gorevSohbeti(7, { okunmamis: 1 })]), 0);
});

// G10 düzeltme turu 1 (K9, K5): Görevler kartının bütün durumu TEK kancada; Kokpit.tsx ham görev durumunu (liste, ilk kullanım ayarı, "bir kez" bayrağı) taşımaz.
test('G10 (K9): Kokpit görev durumunu useGorevKarti() ile alır; bayrak yalnız gorevBosGorulduYazilsin kapısından yazılır', async () => {
  const { readFileSync } = await import('node:fs');
  const kokpit = readFileSync(new URL('../src/renderer/sayfalar/Kokpit.tsx', import.meta.url), 'utf8');
  const kanca = readFileSync(new URL('../src/renderer/pano/useGorevler.ts', import.meta.url), 'utf8');
  assert.match(kokpit, /useGorevKarti\(\{ hazir: Boolean\(d && pano\), aracsiz: motorS\.aracsiz \}\)/, 'tek kanca; hazır = kokpit verisi geldi');
  for (const ham of ['useGorevListesi', 'useGorevBosIpucu', 'gorevGoruldu', 'gorevKartiOgeleri', 'gorevKartiHali']) assert.ok(!kokpit.includes(ham), `Kokpit.tsx'te ham görev durumu yok: ${ham}`);
  const govde = kanca.slice(kanca.indexOf('export function useGorevKarti'), kanca.indexOf('export function useGorevBosIpucu'));
  assert.match(govde, /gorevBosGorulduYazilsin\(\{ hali, hazir: o\.hazir, gorunur, yazildi: yazildi\.current \}\)/, 'bayrak kapıdan geçer (çizildi + pencere görünür)');
  assert.ok(govde.indexOf('gorevBosGorulduYazilsin') < govde.indexOf('bos.goruldu()'), 'goruldu() kapıdan SONRA çağrılır');
  assert.match(kanca, /document\.hidden/, 'belge görünürlüğü de sayılır');
  assert.match(kanca, /cagir<PencereDurumu>\('pencere:durum'\)/, 'asıl görünürlük ana süreçten (hiç gösterilmemiş pencerenin belgesi gizli demeyebilir)');
  assert.match(kanca, /pencereGorunurMu\(belgeGizli, ana\)/);
});
