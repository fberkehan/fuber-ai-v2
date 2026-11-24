// Gözlerin hareket beyni (11 Kas, "Pamuk"; renderer/ui/goz/beyin.ts). Sahte saat ve kaydedici canlandırıcıyla: yalnız transform ve opacity; kırpmada kapanış
// açılıştan kısa; az harekette sakkad, döngü ve nefes yok; uyku 60 sn sonra, dizisi onaylı sırayla (yarıya düşme, iki yavaş kırpma, kapanma), 6 nefes ve
// ardından hiçbir zamanlayıcı ve sonsuz hareket yok; uyanış 1,6 sn; uyku defteri; durağan göz zamanlayıcı kurmaz; hâl eşlemesi (shared/goz.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GozBeyni, baslangictaUyurMu, defterEtkinligi, type Canlandirici, type DonguKaresi, type GozOgeleri, type Saat, type UykuDefteri } from '../src/renderer/ui/goz/beyin.ts';
import {
  KIRPMA_SURE, NEFES_SAYI, NEFES_SURE, UYANIS_SURE, UYKU_KAPAK, UYKU_SURE, UYKU_TOPLAM_MS, kapakY, kirpmaKareleri, nefesKareleri, type Kare,
} from '../src/renderer/ui/goz/geometri.ts';
import { UYKU_MS, gozDurumu, uyuyabilirMi } from '../src/shared/goz.ts';

interface Kayit { el: string; tur: 'diz' | 'dongu'; oz: string; kareler: readonly (Kare | DonguKaresi)[]; sure: number; gecik: number; tekrar?: number; an: number }

class SahteSaat implements Saat {
  t = 0;
  private n = 0;
  private z = new Map<number, { an: number; fn: () => void }>();
  simdi() { return this.t; }
  kur(fn: () => void, ms: number) { const id = ++this.n; this.z.set(id, { an: this.t + ms, fn }); return id; }
  iptal(id: unknown) { this.z.delete(id as number); }
  get bekleyen() { return this.z.size; }
  ilerle(ms: number) {
    const son = this.t + ms;
    for (;;) {
      let en: [number, { an: number; fn: () => void }] | null = null;
      for (const g of this.z) if (g[1].an <= son && (!en || g[1].an < en[1].an)) en = g;
      if (!en) break;
      this.z.delete(en[0]);
      this.t = en[1].an;
      en[1].fn();
    }
    this.t = son;
  }
}

function kur(o: { canli?: boolean; az?: boolean; defter?: UykuDefteri; rastgele?: () => number } = {}) {
  const saat = new SahteSaat();
  const kayit: Kayit[] = [];
  const kapakF = new Map<string, number>();
  const can: Canlandirici<string> = {
    diz(el, oz, kareler, sure, gecik = 0) {
      kayit.push({ el, tur: 'diz', oz, kareler, sure, gecik, an: saat.t });
      if (oz === 'transform' && el.startsWith('kapak')) {
        const m = /translate\(0px, (-?[\d.]+)px\)/.exec(kareler[kareler.length - 1].v);
        if (m) kapakF.set(el, Number(m[1]));
      }
    },
    dongu(el, kareler, x) { kayit.push({ el, tur: 'dongu', oz: 'transform', kareler, sure: x.sure, gecik: x.gecik, tekrar: x.tekrar, an: saat.t }); },
    kapakF: (el) => kapakF.get(el) ?? kapakY(0),
  };
  const goz = (s: number): GozOgeleri<string> => {
    const y = s > 0 ? 'sag' : 'sol';
    return { s, bakis: `bakis-${y}`, durum: `durum-${y}`, dongu: `dongu-${y}`, bebek: `bebek-${y}`, bebekDurum: `bebekDurum-${y}`, yanak: `yanak-${y}`, kapak: `kapak-${y}`, kapali: `kapali-${y}` };
  };
  let az = o.az ?? false;
  const uykular: boolean[] = [];
  const b = new GozBeyni<string>({
    gozler: [goz(-1), goz(1)], cift: 'cift', kok: 'kok', can, saat, rastgele: o.rastgele ?? (() => 0.5), az: () => az, birimPx: () => 0.6,
    canli: o.canli ?? true, defter: o.defter, uykuDegisti: (u) => uykular.push(u),
  });
  return { b, saat, kayit, uykular, azYap: (x: boolean) => { az = x; } };
}

test('hâl eşlemesi: çalışıyor düşünür, onay dinler, sevinç mutlu; ifade üstündür; yalnız sakin uyur', () => {
  assert.equal(gozDurumu('calisiyor'), 'dusunuyor');
  assert.equal(gozDurumu('onay'), 'dinliyor');
  assert.equal(gozDurumu('sevinc'), 'mutlu');
  assert.equal(gozDurumu('sakin'), 'bosta');
  assert.equal(gozDurumu('dinliyor', 'hata'), 'hata');
  assert.equal(gozDurumu(undefined, 'uyuyor'), 'uyuyor');
  assert.equal(gozDurumu(), 'bosta');
  assert.ok(uyuyabilirMi('sakin'));
  assert.ok(!uyuyabilirMi('calisiyor'));
});

test('yalnız transform ve opacity canlanır (her hâl, uyku, uyanış, jestler, imleç)', () => {
  const { b, saat, kayit } = kur();
  b.baslat('bosta');
  for (const dd of ['dinliyor', 'dusunuyor', 'konusuyor', 'mutlu', 'hata', 'bosta'] as const) { b.istek(dd); saat.ilerle(1500); }
  b.tetikle('selam'); b.tetikle('mod'); b.tetikle('kirp'); b.imlec(10, 4); b.imlecGitti();
  saat.ilerle(UYKU_MS + UYKU_TOPLAM_MS + 1000);
  b.etkinlik(); saat.ilerle(3000);
  assert.ok(kayit.length > 50);
  for (const k of kayit) {
    assert.ok(k.oz === 'transform' || k.oz === 'opacity', `${k.el}: ${k.oz}`);
    for (const kare of k.kareler) {
      for (const anahtar of Object.keys(kare)) assert.ok(['o', 'v', 'e', 'transform', 'offset', 'easing'].includes(anahtar), `${k.el}: ${anahtar}`);
    }
  }
});

test('kırpma: kapanış (75 ms) açılıştan (150 ms) kısa; kapalı yay kapalı anda görünür; son kare hâlin kapağı', () => {
  const K = kirpmaKareleri(0);
  const kapanis = K[0].o * KIRPMA_SURE;
  const acilis = (K[2].o - K[1].o) * KIRPMA_SURE;
  assert.ok(Math.abs(kapanis - 75.4) < 1);
  assert.ok(Math.abs(acilis - 150.8) < 1);
  assert.ok(kapanis < acilis);
  const { b, kayit } = kur();
  b.baslat('bosta');
  b.kirp();
  const yay = kayit.find((k) => k.el === 'kapali-sag' && k.oz === 'opacity');
  assert.ok(yay);
  const enCok = Math.max(...yay.kareler.map((x) => Number((x as Kare).v)));
  assert.equal(enCok, 1, 'kapalıyken yay tam görünür');
  assert.equal(Number((yay.kareler.at(-1) as Kare).v), 0, 'açılınca söner');
});

test('canlı boşta göz: sakkad ve kırpma tek atımlık zamanlayıcıyla (sonsuz döngü yok)', () => {
  const { b, saat, kayit } = kur();
  b.baslat('bosta');
  saat.ilerle(20_000);
  assert.ok(kayit.some((k) => k.el === 'bebek-sag'), 'sakkad baktı');
  assert.ok(kayit.some((k) => k.el === 'kapak-sag' && k.sure === KIRPMA_SURE), 'kırptı');
  assert.ok(!kayit.some((k) => k.tur === 'dongu'), 'boşta döngü yok');
});

test('az hareket: sakkad, imleç, hâl döngüsü, zıplama ve nefes yok; kırpma kalır', () => {
  const { b, saat, kayit } = kur({ az: true });
  b.baslat('bosta');
  saat.ilerle(20_000);
  assert.ok(!kayit.some((k) => k.el === 'bebek-sag'), 'sakkad yok');
  assert.ok(kayit.some((k) => k.el === 'kapak-sag' && k.sure === KIRPMA_SURE), 'kırpma var');
  b.imlec(20, 0);
  assert.ok(!kayit.some((k) => k.el === 'bebek-sag'), 'imleç izlenmez');
  b.istek('konusuyor'); b.istek('dusunuyor'); b.istek('mutlu');
  assert.ok(!kayit.some((k) => k.tur === 'dongu'), 'döngü yok');
  assert.ok(!kayit.some((k) => k.el === 'cift'), 'zıplama yok');
  b.istek('bosta');
  saat.ilerle(UYKU_MS + 10_000);
  assert.ok(b.uyku);
  assert.ok(kayit.filter((k) => k.el === 'kok').length <= 1, 'nefes yok (yalnız kökü sıfırlama)');
});

test('uyku: 60 sn girdisizlikten sonra; dizi onaylı sırayla; 6 nefes kök svg\'de; sonra hiçbir şey çizilmez', () => {
  const { b, saat, kayit, uykular } = kur();
  b.baslat('bosta');
  saat.ilerle(UYKU_MS - 100);
  assert.ok(!b.uyku);
  saat.ilerle(200);
  assert.ok(b.uyku);
  assert.deepEqual(uykular, [true]);
  const uykuAni = saat.t;
  const kapak = kayit.find((k) => k.el === 'kapak-sag' && k.sure === UYKU_SURE);
  assert.ok(kapak, 'uyku kapağı 7,2 sn');
  // Yarıya düşme (0,45), iki yavaş kırpma (1), yavaşça kapanma (1).
  assert.deepEqual(UYKU_KAPAK.map((k) => k.p), [0.45, 0.47, 1, 1, 0.55, 0.6, 1, 1, 0.72, 0.73, 1]);
  assert.equal(kapak.kareler.length, UYKU_KAPAK.length);
  // Nefes: kök svg'ye adımlı anında yazımlar (tek atımlık zamanlayıcı zinciri; sürekli canlandırma yok), 400 ms sonra başlar, 6 nefeste biter.
  assert.ok(!kayit.some((k) => k.el === 'kok' && k.tur === 'dongu'), 'nefes sürekli canlandırma değil');
  assert.equal(b.bekleyen, 1, 'uykuda tek zamanlayıcı: nefes zinciri');
  const kokYazim = () => kayit.filter((k) => k.el === 'kok' && k.tur === 'diz' && k.an >= kapak.an && k.sure === 0);
  const ilkYazim = kokYazim().length; // uykuya girerken kökü sıfırlama
  saat.ilerle(kapak.an + UYKU_SURE + 399 - saat.t);
  assert.equal(kokYazim().length, ilkYazim, 'kapanmadan önce nefes yok');
  saat.ilerle(UYKU_TOPLAM_MS);
  const adimlar = kokYazim().slice(ilkYazim);
  const nAdim = nefesKareleri(0.6).length;
  assert.equal(adimlar.length, NEFES_SAYI * (nAdim - 1) + 1, 'her nefes adımlı (adım başına tek yazım)');
  assert.equal(adimlar[0].an - kapak.an, UYKU_SURE + 400);
  assert.ok(Math.abs(adimlar.at(-1)!.an - kapak.an - UYKU_TOPLAM_MS) < 2, 'son adım 6. nefesin sonunda');
  assert.match((adimlar.at(-1)!.kareler[0] as Kare).v, /translate\(0px, 0px\) scale\(1, 1\)/, 'nefes durgun karede biter');
  assert.equal(b.bekleyen, 0, 'nefesten sonra zamanlayıcı yok');
  // Uykudan sonra: hiçbir sonsuz hareket takılı değil, yeni kayıt yok.
  const once = kayit.length;
  saat.ilerle(60_000);
  assert.equal(kayit.length, once, 'uykuda yeni hareket yok');
  assert.equal(saat.bekleyen, 0);
  const sonsuz = kayit.filter((k) => k.tur === 'dongu' && k.tekrar === Infinity && k.an >= uykuAni);
  assert.equal(sonsuz.length, 0);
  assert.equal(UYKU_TOPLAM_MS, 7200 + 400 + 4400 * 6);
  // Nefes adımları: tepe 0,45'te (onaylı eğri); adım başına ekranda ≤ 0,2 px; çentikte saniyede birkaç yazım.
  const centik = nefesKareleri(16 / 26);
  assert.ok(centik.length >= 9 && centik.length <= 20, `çentik: ${centik.length} kare / nefes`);
  const kart = nefesKareleri(120 / 92.4);
  assert.ok(kart.length > centik.length && kart.length <= 61);
  const tepe = centik.reduce((a, b) => (Number(/translate\(0px, ([\d.]+)px/.exec(b.transform)![1]) > Number(/translate\(0px, ([\d.]+)px/.exec(a.transform)![1]) ? b : a));
  assert.ok(Math.abs(tepe.offset - 0.45) < 0.08, `tepe ${tepe.offset}`);
  assert.match(centik[0].transform, /translate\(0px, 0px\) scale\(1, 1\)/);
  assert.match(centik.at(-1)!.transform, /translate\(0px, 0px\) scale\(1, 1\)/);
});

test('uyumaz: dinlerken ya da çalışırken; durağan gözde uyku saati de zamanlayıcı da yok', () => {
  const a = kur();
  a.b.baslat('dinliyor');
  a.saat.ilerle(UYKU_MS * 3);
  assert.ok(!a.b.uyku);
  const d = kur({ canli: false });
  d.b.baslat('bosta');
  assert.equal(d.b.bekleyen, 0);
  d.saat.ilerle(UYKU_MS * 2);
  assert.ok(!d.b.uyku);
  assert.equal(d.kayit.length, 0, 'durağan göz kendiliğinden hareket etmez');
  d.b.tetikle('selam');
  assert.ok(d.kayit.some((k) => k.el === 'cift'), 'dış tetik durağanda da oynar');
});

test('uyanış: girdiyle; 1,6 sn, o anki kapaktan başlar; uyanınca nefes durur ve saat yeniden kurulur', () => {
  const { b, saat, kayit, uykular } = kur();
  b.baslat('bosta');
  saat.ilerle(UYKU_MS + 3000); // uyku dizisinin ortasında
  assert.ok(b.uyku);
  const n = kayit.length;
  b.imlec(5, 0);
  assert.ok(!b.uyku);
  assert.ok(b.uyaniyor);
  assert.deepEqual(uykular, [true, false]);
  const yeni = kayit.slice(n);
  assert.ok(yeni.some((k) => k.el === 'kapak-sag' && k.sure === UYANIS_SURE));
  assert.ok(yeni.some((k) => k.el === 'kok' && k.tur === 'diz'), 'nefes yumuşakça bırakılır');
  saat.ilerle(UYANIS_SURE + 10);
  assert.ok(!b.uyaniyor);
  saat.ilerle(UYKU_MS + 100);
  assert.ok(b.uyku, 'yeniden uyur');
});

test('uyku defteri: süresi dolmuşsa uyuyarak başlar (dizi oynamaz); dış girdi takılı gözü uyandırır', () => {
  const defter: UykuDefteri = { son: null };
  const a = kur({ defter });
  a.b.baslat('bosta');
  assert.equal(defter.son, 0);
  a.b.durdur();
  assert.ok(baslangictaUyurMu(defter, UYKU_MS + 5, 'bosta'));
  assert.ok(!baslangictaUyurMu(defter, UYKU_MS + 5, 'dinliyor'));
  const b = kur({ defter });
  b.saat.t = UYKU_MS + 5;
  b.b.baslat('bosta');
  assert.ok(b.b.uyku);
  assert.equal(b.kayit.length, 0, 'uyuyan göz ilk karede kapalı çizilir, dizi oynamaz');
  assert.equal(b.b.bekleyen, 0);
  defterEtkinligi(defter, b.saat.t);
  assert.ok(!b.b.uyku, 'tekerlek ya da tuş uyandırır');
  // Bileşen uyuyan gözü 'uyuyor' ile kurar, sonra takılma etkisi ebeveynin hâlini ('bosta') ister: bu uyandırmaz.
  const c = kur({ defter: { son: 0 } });
  c.saat.t = UYKU_MS + 5;
  c.b.baslat('uyuyor');
  c.b.istek('bosta');
  assert.ok(c.b.uyku, 'takılmadaki ilk istek uyuyan gözü uyandırmaz');
  assert.equal(c.kayit.length, 0);
});

test('hâl döngüleri yalnız o hâlde: düşünme ve konuşma sonsuz, boşa dönünce durgun kareye iner', () => {
  const { b, kayit } = kur();
  b.baslat('bosta');
  b.istek('konusuyor');
  assert.ok(kayit.some((k) => k.el === 'dongu-sag' && k.tur === 'dongu' && k.tekrar === Infinity && k.sure === 1500));
  b.istek('dusunuyor');
  assert.ok(kayit.some((k) => k.el === 'dongu-sag' && k.tur === 'dongu' && k.sure === 5200));
  const n = kayit.length;
  b.istek('bosta');
  const son = kayit.slice(n).filter((k) => k.el === 'dongu-sag');
  assert.ok(son.length && son.every((k) => k.tur === 'diz'), 'boşta döngü yerine durgun kareye iner');
});

test('hata sallanır, mutlu zıplar; mod tetiği zıplayıp kırpar; selam gülümseyip hâline döner', () => {
  const { b, saat, kayit } = kur();
  b.baslat('bosta');
  b.istek('hata');
  assert.ok(kayit.some((k) => k.el === 'cift' && k.sure === 560));
  b.istek('mutlu');
  assert.ok(kayit.some((k) => k.el === 'cift' && k.sure === 480));
  const n = kayit.length;
  b.tetikle('mod');
  saat.ilerle(200);
  assert.ok(kayit.slice(n).some((k) => k.el === 'cift'));
  assert.ok(kayit.slice(n).some((k) => k.el === 'kapak-sag' && k.sure === KIRPMA_SURE));
});
