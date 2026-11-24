// Olay yardımcısının ana süreç katmanı (0.14 T22): src/main/olay-yardimcisi.ts ve tam ekranın son bilinen hâli (src/main/tam-ekran.ts). Gerçek
// fuber-olay.exe açılmaz: süreç sahte (bellekte) ya da scripts/dev/sahte-olay.mjs (gerçek alt süreç, sistemin node'u). Sınananlar (Review Focus 2):
// tam ekran yalnız çentiğin ekranındaysa sayılır; tam ekranda onay kuyrukta bekler, hatırlatıcı iner, `acik:false` olayı kuyruğu HEMEN boşaltır
// (yoklama yok); yardımcı çökünce tam ekran yok sayılır, yeniden başlatma 1, 5, 30 sn ve 10 dk'da üçüncü çöküşten sonra durur (günlüğe tek satır);
// `hazir` 5 sn'de gelmezse ya da stdin kapanınca 2 sn'de çıkmazsa süreç öldürülür (aynı çöküş sayacı); klavye kancası komutu her (yeniden) başlatmada
// yinelenir; medyada duraklamışken `hiz: 0` olağandır. Kaynak taraması: ada.ts ve tam-ekran.ts'te setInterval ve powershell yok; fuber-durum hiçbir yerde.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { YONETIM_VAR } from './yardimci/ozel.ts';
import { OlayYardimcisi, YENIDEN_BASLATMA_MS, yenidenBaslatmaPlani, centikMedyasi, centikMedyasiDegisti, medyaKomutuAyikla } from '../src/main/olay-yardimcisi.ts';
import { satirSureci, type SatirSureci } from '../src/main/durum-yardimcisi.ts';
import { tamEkranCentikte, centikHedefEkrani } from '../src/main/tam-ekran.ts';
import { AdaKuyrugu, adaYolu, type AdaOlayi } from '../src/shared/ada.ts';
import { BOS_DURUM, durumGuncelle, type SistemDurumu, type SistemOlayi } from '../src/shared/sistem-olay.ts';

const kok = path.resolve(import.meta.dirname, '..');
const oku = (g: string) => fs.readFileSync(path.join(kok, g), 'utf8');
const bekle = (ms: number) => new Promise((r) => setTimeout(r, ms));
const DK = 60_000;

/** Bellekteki sahte yardımcı: yazılan komutları tutar; `cik` süreç çöküşünü, `satir` yardımcının bir çıktı satırını taklit eder. */
class Sahte implements SatirSureci {
  yazilan: string[] = [];
  olduruldu = false;
  stdinKapandi = false;
  private satirF: ((s: string) => void) | undefined;
  private bitF: ((n: string) => void) | undefined;
  yaz(s: string): void { this.yazilan.push(s); }
  oldur(): void { this.olduruldu = true; this.bitF?.('öldürüldü'); }
  kapat(): void { this.stdinKapandi = true; }
  satirda(f: (s: string) => void): void { this.satirF = f; }
  bitince(f: (n: string) => void): void { this.bitF = f; }
  satir(o: unknown): void { this.satirF?.(typeof o === 'string' ? o : JSON.stringify(o)); }
  cik(neden = 'çıkış kodu 1'): void { this.bitF?.(neden); }
  hazir(): void { this.satir({ t: 'hazir', surum: 1 }); }
  komutlar(): unknown[] { return this.yazilan.map((s) => JSON.parse(s)); }
}

function kur(o: { hazirMs?: number; cikisMs?: number; demo?: boolean } = {}) {
  const surecler: Sahte[] = [];
  const gunluk: string[] = [];
  let saat = 1_000_000;
  const y = new OlayYardimcisi({
    baslat: () => { const s = new Sahte(); surecler.push(s); return s; }, simdi: () => saat, gunluk: (m) => gunluk.push(m), ...o,
  });
  const olaylar: { o: SistemOlayi; onceki: SistemDurumu }[] = [];
  y.dinle((x, onceki) => olaylar.push({ o: x, onceki }));
  return { y, surecler, gunluk, olaylar, ilerle: (ms: number) => { saat += ms; mock.timers.tick(ms); } };
}

const EKRAN_A = { x: 0, y: 0, width: 1920, height: 1080 };       // çentiğin ekranı (DIP)
const EKRAN_B = { x: 1920, y: 0, width: 2560, height: 1440 };    // öbür ekran

test('tam ekran yalnız çentiğin ekranındaysa sayılır (başka ekrandaki tam ekran çentiği gizlemez)', () => {
  // Fiziksel kutu, ölçek 1: aynı ekran.
  assert.equal(tamEkranCentikte({ acik: true, ekran: { x: 0, y: 0, en: 1920, boy: 1080 } }, EKRAN_A, 1), true);
  assert.equal(tamEkranCentikte({ acik: false, ekran: { x: 0, y: 0, en: 1920, boy: 1080 } }, EKRAN_A, 1), false, 'acik:false');
  // Başka ekrandaki tam ekran: çentiğin ekranı etkilenmez.
  assert.equal(tamEkranCentikte({ acik: true, ekran: { x: 1920, y: 0, en: 2560, boy: 1440 } }, EKRAN_A, 1), false);
  assert.equal(tamEkranCentikte({ acik: true, ekran: { x: 1920, y: 0, en: 2560, boy: 1440 } }, EKRAN_B, 1), true);
  // Aynı boyda iki ekran: konum ayırır.
  assert.equal(tamEkranCentikte({ acik: true, ekran: { x: 1920, y: 0, en: 1920, boy: 1080 } }, EKRAN_A, 1), false, 'yandaki aynı boy ekran');
  // %150 ölçekli ekran: yardımcı fiziksel piksel verir (2880×1620), çentiğin ekranı DIP (1920×1080).
  assert.equal(tamEkranCentikte({ acik: true, ekran: { x: 0, y: 0, en: 2880, boy: 1620 } }, EKRAN_A, 1.5), true);
  assert.equal(tamEkranCentikte({ acik: true, ekran: { x: 0, y: 0, en: 2880, boy: 1620 } }, EKRAN_A, 1), false, 'ölçeksiz okunursa boy tutmaz');
  // Yuvarlama payı (±2 px) ve geçersiz ölçek.
  assert.equal(tamEkranCentikte({ acik: true, ekran: { x: -1, y: 0, en: 1921, boy: 1080 } }, EKRAN_A, 1), true);
  assert.equal(tamEkranCentikte({ acik: true, ekran: { x: 0, y: 0, en: 1920, boy: 1080 } }, EKRAN_A, 0), true, 'ölçek 0 → 1');
  // Ana süreç: çentiğin ekranının kutusu fizikselleştirilip verilir (Windows'ta screen.dipToScreenRect; çok ekran ve karışık ölçek).
  assert.match(oku('src/main/ada.ts'), /screen\.dipToScreenRect\(null, e\.bounds\)/);
});

test('tam ekranda onay kuyrukta bekler, hatırlatıcı iner; tam-ekran acik:false olayı kuyruğu hemen boşaltır', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { y, surecler } = kur();
    y.baslat();
    surecler[0].hazir();
    // Kapı: ana sürecin kuralları (shared/ada.ts adaYolu + AdaKuyrugu); tam ekran son bilinen hâlden — soru yok.
    const tam = () => { const t = y.durumu().tamEkran; return Boolean(t) && tamEkranCentikte(t!, EKRAN_A, 1); };
    const kuyruk = new AdaKuyrugu();
    const teslim: string[] = [];
    const bosalt = () => { for (let o = kuyruk.al(tam()); o; o = kuyruk.al(tam())) teslim.push(o.kaynak); };
    const gonder = (kaynak: AdaOlayi['kaynak']) => {
      const yol = adaYolu(kaynak, { tamEkran: true, anaOnde: false, kapali: false });
      if (yol.ada === 'simdi') teslim.push(kaynak); else if (yol.ada !== 'yok') { kuyruk.ekle({ kaynak, kanal: 'x', veri: null, zaman: 0 }); bosalt(); }
    };
    y.dinle((o) => { if (o.t === 'tam-ekran' || o.t === 'durum') bosalt(); });
    surecler[0].satir({ t: 'tam-ekran', acik: true, ekran: { x: 0, y: 0, en: 1920, boy: 1080 } });
    assert.equal(tam(), true);
    gonder('onay');
    gonder('hatirlatma');
    assert.deepEqual(teslim, ['hatirlatma'], 'hatırlatıcı tam ekranda iner, onay bekler');
    assert.equal(kuyruk.uzunluk, 1);
    // Başka ekrandaki tam ekran (ön pencere öbür ekrana geçti): çentiğin ekranı serbest.
    surecler[0].satir({ t: 'tam-ekran', acik: true, ekran: { x: 1920, y: 0, en: 2560, boy: 1440 } });
    assert.deepEqual(teslim, ['hatirlatma', 'onay'], 'olay anında (zamanlayıcısız) teslim edildi');
    // Yeniden tam ekran → bekler; acik:false → hemen.
    surecler[0].satir({ t: 'tam-ekran', acik: true, ekran: { x: 0, y: 0, en: 1920, boy: 1080 } });
    gonder('onay');
    assert.deepEqual(teslim, ['hatirlatma', 'onay']);
    surecler[0].satir({ t: 'tam-ekran', acik: false, ekran: { x: 0, y: 0, en: 1920, boy: 1080 } });
    assert.deepEqual(teslim, ['hatirlatma', 'onay', 'onay']);
    y.kapat();
  } finally { mock.timers.reset(); }
  // Ana süreç bu kuralı olayla uygular: tam ekran değişince kuyruk ve boştaki çentik yeniden değerlendirilir.
  const ada = oku('src/main/ada.ts');
  assert.match(ada, /tamEkranDinle\(\(\) => tamEkranOlayi\(\)\)/);
  const govde = /function tamEkranOlayi\(\): void \{[\s\S]*?\n\}/.exec(ada)?.[0] ?? '';
  assert.match(govde, /kuyruguBosalt\(\)/);
  assert.match(govde, /sessizDegerlendir\(\)/);
});

// 0.14 T28b: yardımcı temiz çıkışta geri çağırma sayaçlarını tek satırla yazar ({"t":"sayac",…}). Ana süreç bu satırı YALNIZ FUBER_DEMO'da günlüğe yazar
// (tek satır, yalnız izinli adlar ve sayılar); hâle uygulanmaz, dinleyicilere yayılmaz. Satır stdin kapandıktan sonra (kapanan süreçten) da gelir.
test('sayac satırı: FUBER_DEMO\'da tek günlük satırı (kapanan süreçten de); demo dışında yazılmaz; hâle ve dinleyicilere gitmez', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { y, surecler, gunluk, olaylar } = kur({ demo: true });
    y.baslat();
    surecler[0].hazir();
    const once = olaylar.length;
    const durum = y.durumu();
    surecler[0].satir('{"t":"sayac","on":4,"appbar":2,"baslik":"Gizli belge","tus":65}');
    assert.equal(olaylar.length, once, 'dinleyicilere yayılmaz');
    assert.equal(y.durumu(), durum, 'hâl değişmez');
    assert.deepEqual(gunluk, ['[olay] yardımcı sayaçları {"on":4,"appbar":2}']);
    // Kapanış: stdin kapandı, süreç henüz çıkmadı; son satır yine günlüğe girer, başka satırlar (ör. caps) yok sayılır.
    void y.kapat();
    surecler[0].satir({ t: 'caps', acik: true });
    surecler[0].satir({ t: 'sayac', sureMs: 5000, klavyeAcikMs: 0 });
    assert.equal(gunluk.length, 2);
    assert.equal(gunluk[1], '[olay] yardımcı sayaçları {"sureMs":5000,"klavyeAcikMs":0}');
    assert.equal(olaylar.length, once);
    surecler[0].cik('çıkış kodu 0');
  } finally { mock.timers.reset(); }
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { y, surecler, gunluk } = kur();
    y.baslat();
    surecler[0].hazir();
    surecler[0].satir({ t: 'sayac', on: 1 });
    void y.kapat();
    surecler[0].satir({ t: 'sayac', on: 2 });
    assert.deepEqual(gunluk, [], 'demo dışında sayaç günlüğe yazılmaz');
    surecler[0].cik('çıkış kodu 0');
  } finally { mock.timers.reset(); }
});

test('yeniden başlatma planı: 1, 5, 30 sn; 10 dk\'da üçüncü çöküşten sonra null', () => {
  assert.deepEqual([...YENIDEN_BASLATMA_MS], [1000, 5000, 30000]);
  const t = 50 * DK;
  assert.equal(yenidenBaslatmaPlani([t], t), 1000);
  assert.equal(yenidenBaslatmaPlani([t, t + DK], t + DK), 5000);
  assert.equal(yenidenBaslatmaPlani([t, t + DK, t + 2 * DK], t + 2 * DK), null, '10 dk içinde üçüncü çöküş');
  // Üçüncü çöküş ilkinden 10 dk sonra: pencerede iki çöküş var → 30 sn (sıradaki gecikme).
  assert.equal(yenidenBaslatmaPlani([t, t + 5 * DK, t + 11 * DK], t + 11 * DK), 30000);
  // Seyrek çöküşler: gecikme 30 sn'de kalır, durmaz.
  assert.equal(yenidenBaslatmaPlani([t, t + 20 * DK, t + 40 * DK, t + 60 * DK], t + 60 * DK), 30000);
  assert.equal(yenidenBaslatmaPlani([], t), 1000, 'boş liste: ilk deneme');
});

test('yardımcı çökünce tam ekran yok sayılır (ada iner); yeniden başlatma 1, 5, 30 sn; 10 dk\'da üçüncü çöküşten sonra durur', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { y, surecler, gunluk, olaylar, ilerle } = kur();
    y.baslat();
    surecler[0].hazir();
    surecler[0].satir({ t: 'tam-ekran', acik: true, ekran: { x: 0, y: 0, en: 1920, boy: 1080 } });
    assert.equal(y.durumu().tamEkran?.acik, true);
    surecler[0].cik();
    // Çöküş: hâl boşalır, dinleyiciler tam bir `durum` (boş) alır → tam ekran yok (ada iner, kuyruk boşalır).
    assert.deepEqual(y.durumu(), BOS_DURUM);
    const son = olaylar.at(-1)!;
    assert.equal(son.o.t, 'durum');
    assert.equal(son.onceki.tamEkran?.acik, true);
    ilerle(999);
    assert.equal(surecler.length, 1, '1 sn dolmadı');
    ilerle(1);
    assert.equal(surecler.length, 2, '1 sn sonra yeniden açıldı');
    surecler[1].hazir();
    ilerle(DK);
    surecler[1].cik();
    ilerle(4999);
    assert.equal(surecler.length, 2);
    ilerle(1);
    assert.equal(surecler.length, 3, 'ikinci çöküş: 5 sn');
    surecler[2].hazir();
    ilerle(DK);
    surecler[2].cik(); // 10 dk içinde üçüncü
    ilerle(10 * DK);
    assert.equal(surecler.length, 3, 'üçüncü çöküşten sonra durdu');
    // 0.14 T28 düzeltme turu 3 (yeniden inceleme 2, N2): HER beklenmedik çıkış günlüğe tek satır yazar (çıkış kodu ve açık kalma süresi); duruş ayrıca bir satır.
    const cikislar = gunluk.filter((m) => /beklenmedik biçimde kapandı/.test(m));
    assert.equal(cikislar.length, 3, 'üç çıkışın her biri günlükte');
    assert.match(cikislar[0], /çıkış kodu 1; 0 sn açık kaldı\); 1000 ms sonra yeniden açılıyor/);
    assert.match(cikislar[1], /çıkış kodu 1; 60 sn açık kaldı\); 5000 ms sonra yeniden açılıyor/);
    assert.match(cikislar[2], /60 sn açık kaldı\); yeniden açılmıyor/);
    assert.equal(gunluk.filter((m) => /10 dk.*3/.test(m)).length, 1, 'duruş satırı bir kez');
    // Durduktan sonra komutlar sessizce düşer (çökme yok).
    y.gonder({ k: 'durum' });
    y.kapat();
  } finally { mock.timers.reset(); }
  // 30 sn: üçüncü çöküş ilkinden 10 dk sonra.
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { y, surecler, ilerle } = kur();
    y.baslat();
    surecler[0].cik();
    ilerle(1000);
    ilerle(5 * DK);
    surecler[1].cik();
    ilerle(5000);
    ilerle(6 * DK);
    surecler[2].cik();
    ilerle(29_999);
    assert.equal(surecler.length, 3);
    ilerle(1);
    assert.equal(surecler.length, 4, 'pencerede iki çöküş: 30 sn sonra');
    y.kapat();
  } finally { mock.timers.reset(); }
});

test('takılan yardımcı: hazir 5 sn\'de gelmezse öldürülür (çöküş sayılır, 1 sn sonra yeniden); stdin kapanınca 2 sn\'de çıkmazsa öldürülür', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { y, surecler, olaylar, ilerle } = kur();
    y.baslat();
    ilerle(4999);
    assert.equal(surecler[0].olduruldu, false);
    ilerle(1);
    assert.equal(surecler[0].olduruldu, true, 'hazir gelmedi: öldürüldü');
    assert.equal(olaylar.at(-1)?.o.t, 'durum', 'hâl boşaldı');
    ilerle(1000);
    assert.equal(surecler.length, 2, 'aynı çöküş sayacıyla 1 sn sonra yeniden');
    surecler[1].hazir();
    ilerle(10_000);
    assert.equal(surecler[1].olduruldu, false, 'hazir geldi: dokunulmaz');
    // Kapanış: stdin kapanır; 2 sn'de çıkmazsa öldürülür; yeniden açılmaz.
    y.kapat();
    assert.equal(surecler[1].stdinKapandi, true);
    ilerle(1999);
    assert.equal(surecler[1].olduruldu, false);
    ilerle(1);
    assert.equal(surecler[1].olduruldu, true, 'çıkmayan yardımcı öldürüldü');
    ilerle(60_000);
    assert.equal(surecler.length, 2, 'kapanışta yeniden başlatma yok');
  } finally { mock.timers.reset(); }
  // Kendiliğinden çıkan yardımcı öldürülmez.
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { y, surecler, ilerle } = kur();
    y.baslat();
    surecler[0].hazir();
    y.kapat();
    surecler[0].cik('çıkış kodu 0');
    ilerle(5000);
    assert.equal(surecler[0].olduruldu, false);
  } finally { mock.timers.reset(); }
});

test('sahte yardımcıyla gerçek alt süreç: hazir yoksa öldürülür ve yeniden açılır; stdin kapanınca çıkmayan öldürülür; olay satırları ayrışır', async () => {
  const betik = path.join(kok, 'scripts', 'dev', 'sahte-olay.mjs');
  const acilan: number[] = [];
  const gunluk: string[] = [];
  const y = new OlayYardimcisi({
    baslat: () => { acilan.push(Date.now()); return satirSureci(process.execPath, [betik, acilan.length === 1 ? '--hazir-yok' : '--cikma']); }, hazirMs: 400, cikisMs: 400, gunluk: (m) => gunluk.push(m),
  });
  const olaylar: SistemOlayi[] = [];
  y.dinle((o) => olaylar.push(o));
  try {
    y.baslat();
    for (let i = 0; i < 60 && acilan.length < 2; i++) await bekle(100);
    assert.ok(acilan.length >= 2, 'hazir vermeyen yardımcı öldürülüp yeniden açıldı');
    assert.ok(acilan[1] - acilan[0] >= 1000 + 400 - 50, `ilk yeniden başlatma 1 sn sonra (${acilan[1] - acilan[0]} ms)`);
    // Sonraki açılış olağan sahte yardımcı, ama stdin kapanınca çıkmıyor.
    for (let i = 0; i < 80 && !y.hazirMi(); i++) await bekle(100);
    assert.ok(y.hazirMi(), 'olağan yardımcı hazir verdi');
    y.hamYaz({ k: 'sahte-olay', olay: { t: 'medya', var: true, uygulama: 'Spotify.exe', baslik: 'Parça', sanatci: '', album: '', sure: 200, konum: 12, konumZamani: 1, caliyor: false, hiz: 0, kapak: null } });
    y.hamYaz({ k: 'sahte-olay', olay: { t: 'ses', duzey: 0.42, sessiz: false } });
    for (let i = 0; i < 40 && !olaylar.some((o) => o.t === 'ses'); i++) await bekle(50);
    // T21: duraklamışken hız 0 olağandır: olay ayrışır, hâl tutulur, hata yok.
    const m = y.durumu().medya;
    assert.ok(m && m.var && m.caliyor === false && m.hiz === 0, JSON.stringify(m));
    assert.ok(!olaylar.some((o) => o.t === 'hata'), 'hata satırı yok');
    assert.equal(y.durumu().ses?.duzey, 0.42);
    const sonAcilis = acilan.length;
    const t0 = Date.now();
    const sonuc = await y.kapat(); // before-quit bunu bekler (en çok cikisMs)
    assert.equal(sonuc, 'olduruldu', 'stdin\'i yok sayan yardımcı öldürüldü');
    assert.equal(y.calisiyorMu(), false);
    assert.ok(Date.now() - t0 >= 350, `öldürme 400 ms bekledi (${Date.now() - t0} ms)`);
    await bekle(1500);
    assert.equal(acilan.length, sonAcilis, 'kapanıştan sonra yeniden açılmadı');
  } finally { y.kapat(); }
});

test('çıkışta: stdin\'i yok sayan sahte yardımcı öldürülür — before-quit en çok 2 sn bekler, will-quit\'te hâlâ yaşıyorsa doğrudan öldürülür', async () => {
  const betik = path.join(kok, 'scripts', 'dev', 'sahte-olay.mjs');
  const y = new OlayYardimcisi({ baslat: () => satirSureci(process.execPath, [betik, '--cikma']), cikisMs: 2000 });
  try {
    y.baslat();
    for (let i = 0; i < 60 && !y.hazirMi(); i++) await bekle(100);
    assert.ok(y.hazirMi(), 'sahte yardımcı hazır');
    // before-quit: söz döner (beklenecek); will-quit hemen geldi (bekleme bitmeden): oldur() süreci 2 sn'yi beklemeden öldürür.
    const t0 = Date.now();
    const soz = y.kapat();
    assert.strictEqual(y.kapat(), soz, 'ikinci kapatma aynı söz');
    y.oldur();
    assert.equal(await soz, 'olduruldu');
    assert.ok(Date.now() - t0 < 1000, `will-quit 2 sn beklemedi (${Date.now() - t0} ms)`);
    assert.equal(y.calisiyorMu(), false);
  } finally { y.oldur(); }
  // Kendiliğinden çıkan yardımcı: söz 'cikti'; süreç yoksa 'yok'.
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { y: y2, surecler: s2 } = kur();
    y2.baslat();
    s2[0].hazir();
    const soz2 = y2.kapat();
    s2[0].cik('çıkış kodu 0');
    assert.equal(await soz2, 'cikti');
    const { y: y3 } = kur();
    assert.equal(await y3.kapat(), 'yok');
  } finally { mock.timers.reset(); }
  // Ana süreç: kapanış before-quit'in bekleme listesinde, will-quit'te öldürme.
  const ana = oku('src/main/main.ts');
  assert.match(ana, /const olayKapanisi = olayYardimcisiniKapat\(\);/);
  assert.match(ana, /olayKapanisi \?\? Promise\.resolve\(\),/);
  assert.match(ana, /app\.on\('will-quit', \(\) => \{[^\n]*olayYardimcisiniOldur\(\);/);
});

test('çok ekran: tam ekran kararı çentiğin İNECEĞİ ekrana göre (gizli çentik imlecin ekranına iner) — B\'de tam ekran ve imleç B\'de → onay kuyrukta; tam ekran A\'da, imleç B\'de → onay iner', () => {
  const A = { id: 'A', bounds: EKRAN_A }, B = { id: 'B', bounds: EKRAN_B };
  let imlecOkuma = 0;
  const imlecB = () => { imlecOkuma++; return B; };
  assert.equal(centikHedefEkrani({ gorunur: false, inecek: false, son: A, imlec: imlecB }).id, 'B', 'gizli çentik: imlecin ekranı');
  assert.equal(centikHedefEkrani({ gorunur: true, inecek: true, son: A, imlec: imlecB }).id, 'B', 'teslim/gösterim: imlecin ekranı (konumla taşır)');
  assert.equal(centikHedefEkrani({ gorunur: true, inecek: false, son: A, imlec: imlecB }).id, 'A', 'yerinde duran görünür çentik: kendi ekranı');
  assert.equal(imlecOkuma, 2, 'imleç yalnız gerektiğinde okunur');
  assert.equal(centikHedefEkrani({ gorunur: true, inecek: false, son: null, imlec: imlecB }).id, 'B', 'son ekran bilinmiyorsa imleç');
  // Kapı: son ekran A, imleç B; onay kuyruğa mı girer?
  const kapi = (tam: { acik: boolean; ekran: { x: number; y: number; en: number; boy: number } }) => {
    const hedef = centikHedefEkrani({ gorunur: false, inecek: true, son: A, imlec: () => B });
    const tamEkran = tamEkranCentikte(tam, hedef.bounds, 1);
    const kuyruk = new AdaKuyrugu();
    kuyruk.ekle({ kaynak: 'onay', kanal: 'asistan:onay', veri: null, zaman: 0 });
    return kuyruk.al(tamEkran) ? 'iner' : 'kuyrukta';
  };
  assert.equal(kapi({ acik: true, ekran: { x: 1920, y: 0, en: 2560, boy: 1440 } }), 'kuyrukta', 'B\'de film, imleç B\'de');
  assert.equal(kapi({ acik: true, ekran: { x: 0, y: 0, en: 1920, boy: 1080 } }), 'iner', 'A\'da film, imleç B\'de');
  // Ana süreç bu kuralı kullanır; teslim yolları (kuyruk, kontrol, görev) `inecek` ile sorar.
  const ada = oku('src/main/ada.ts');
  assert.match(ada, /centikHedefEkrani\(\{ gorunur, inecek, son: sonEkran, imlec: \(\) => yerlesim\(\)\.ekran \}\)/);
  const bosalt = /function kuyruguBosalt\(\): void \{[\s\S]*?\n\}/.exec(ada)?.[0] ?? '';
  assert.match(bosalt, /tamEkranSimdi\(true\)/);
  for (const f of ['kontroldeAc', 'gorevdeAc']) {
    const g = new RegExp(`function ${f}\\(\\): void \\{[\\s\\S]*?\\n\\}`).exec(ada)?.[0] ?? '';
    assert.match(g, /tamEkranSimdi\(true\)/, f);
  }
});

test('klavye kancası: istenen değer her (yeniden) başlatmada hazir\'den sonra gider, ardından durum istenir; her ayar değişikliğinde yinelenir', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { y, surecler, ilerle } = kur();
    y.gonder({ k: 'klavye', acik: false }); // açılıştan önce: saklanır
    y.baslat();
    assert.deepEqual(surecler[0].komutlar(), [], 'hazir gelmeden yazılmaz');
    surecler[0].hazir();
    assert.deepEqual(surecler[0].komutlar(), [{ k: 'klavye', acik: false }, { k: 'durum' }]);
    y.gonder({ k: 'klavye', acik: false }); // ayar değişti (aynı değer): yine gider
    y.gonder({ k: 'klavye', acik: true });  // kanca açılınca taban (caps, dil) için durum istenir
    assert.deepEqual(surecler[0].komutlar().slice(2), [{ k: 'klavye', acik: false }, { k: 'durum' }, { k: 'klavye', acik: true }, { k: 'durum' }]);
    surecler[0].cik();
    ilerle(1000);
    surecler[1].hazir();
    assert.deepEqual(surecler[1].komutlar(), [{ k: 'klavye', acik: true }, { k: 'durum' }], 'yeniden başlatmada son istek');
    // Bozuk ve bilinmeyen satır sessizce düşer; durum satırı hâli değiştirir.
    surecler[1].satir('bozuk');
    surecler[1].satir({ t: 'bilinmeyen' });
    surecler[1].satir({ t: 'durum', ...BOS_DURUM, caps: true, ag: true });
    assert.equal(y.durumu().caps, true);
    y.kapat();
  } finally { mock.timers.reset(); }
});

test('src/main/ada.ts ve tam-ekran.ts\'te setInterval yok; powershell çağrısı yok (kaynak taraması)', () => {
  for (const d of ['src/main/ada.ts', 'src/main/tam-ekran.ts', 'src/main/olay-yardimcisi.ts']) {
    const s = oku(d);
    assert.doesNotMatch(s, /setInterval/, `${d}: setInterval`);
    assert.doesNotMatch(s, /powershell/i, `${d}: powershell`);
  }
  // Eski yoklamanın kalıntıları yok.
  const ada = oku('src/main/ada.ts');
  assert.doesNotMatch(ada, /sessizYoklama|clearInterval|await tamEkranMi/);
  assert.equal(fs.existsSync(path.join(kok, 'src/main/yoklama-freni.ts')), false);
  assert.doesNotMatch(oku('src/main/durum-yardimcisi.ts'), /class DurumYardimcisi/);
});

// ── 0.14 T25: medya durumunun çentiğe yayını ve panelin medya komutları ──────────────────────────────────────────────────────────────────────────
const CALAN: SistemOlayi = {
  t: 'medya', var: true, uygulama: 'Spotify.exe', baslik: 'Firuze', sanatci: 'Sezen Aksu', album: 'Firuze', sure: 241, konum: 12, konumZamani: 1_700_000_000_000,
  caliyor: true, hiz: 1, kapak: null,
};

test('T25: çentik medyası yalnız medya ya da ses değişince yayılır (şarj, ağ, dil yaymaz); çöküşte boş medya gider', () => {
  const d0 = BOS_DURUM;
  const d1 = durumGuncelle(d0, CALAN);
  assert.equal(centikMedyasiDegisti(d0, d1), true);
  assert.deepEqual(centikMedyasi(d1), { medya: { ...CALAN }, ses: null });
  const d2 = durumGuncelle(d1, { t: 'guc', sarj: true, yuzde: 80 });
  assert.equal(centikMedyasiDegisti(d1, d2), false, 'şarj olayı medyayı yaymaz');
  const d3 = durumGuncelle(d2, { ...CALAN } as SistemOlayi);
  assert.equal(centikMedyasiDegisti(d2, d3), false, 'aynı medya satırı (yeni nesne) yeniden yayılmaz');
  const d4 = durumGuncelle(d3, { ...CALAN, caliyor: false, hiz: 0, konum: 30 } as SistemOlayi);
  assert.equal(centikMedyasiDegisti(d3, d4), true, 'duraklama yayılır');
  const d5 = durumGuncelle(d4, { t: 'ses', duzey: 0.4, sessiz: false });
  assert.equal(centikMedyasiDegisti(d4, d5), true, 'ses düzeyi (panelin kaydırıcısı) yayılır');
  const d6 = durumGuncelle(d5, { t: 'durum', ...BOS_DURUM });
  assert.equal(centikMedyasiDegisti(d5, d6), true, 'yardımcı çöktü: boş');
  assert.deepEqual(centikMedyasi(d6), { medya: null, ses: null });
});

test('T25: panelin medya komutları doğrulanır; yalnız yardımcının medya ve ses komutları (medya tuşu yok)', () => {
  assert.deepEqual(medyaKomutuAyikla({ eylem: 'duraklat' }), { k: 'medya', eylem: 'duraklat' });
  assert.deepEqual(medyaKomutuAyikla({ eylem: 'oynat' }), { k: 'medya', eylem: 'oynat' });
  assert.deepEqual(medyaKomutuAyikla({ eylem: 'ileri' }), { k: 'medya', eylem: 'ileri' });
  assert.deepEqual(medyaKomutuAyikla({ eylem: 'geri' }), { k: 'medya', eylem: 'geri' });
  assert.deepEqual(medyaKomutuAyikla({ eylem: 'konum', sn: 42.5 }), { k: 'medya', eylem: 'konum', sn: 42.5 });
  assert.deepEqual(medyaKomutuAyikla({ ses: 0.35 }), { k: 'ses', duzey: 0.35 });
  assert.deepEqual(medyaKomutuAyikla({ ses: 4 }), { k: 'ses', duzey: 1 });
  for (const kotu of [null, 'duraklat', {}, { eylem: 'sil' }, { eylem: 'konum' }, { eylem: 'konum', sn: Number.NaN }, { ses: '1' }, { eylem: 'durum' }, { k: 'klavye', acik: true }]) {
    assert.equal(medyaKomutuAyikla(kotu), null, JSON.stringify(kotu));
  }
});
