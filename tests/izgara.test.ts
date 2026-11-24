// Kokpit ızgarası: delik yok, sıra korunur, satırlar tam dolar, dar ızgarada 6/1 sütun; kart önemi kuralları.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KOKPIT_EN_GENIS, KART_EN_GENIS, boyOku, izgaraDiz, satiriDagit, sutunSec, yerlesimiOturt, kuralOnemi, onemleriBirlestir, onemOku, onemDegisti, type SutunSayisi, type Hucre } from '../src/shared/izgara.ts';
import type { KartYerlesimi, KokpitVerisi } from '../src/shared/tipler.ts';

const k = (id: string, genislik: number, yukseklik: KartYerlesimi['yukseklik'] = 'o', tip = id as KartYerlesimi['tip']): KartYerlesimi =>
  ({ id, tip, kolon: 1, genislik, yukseklik });

/** Her hücre ızgaranın içinde, hiçbir hücre üst üste binmiyor ve dolu alanda delik yok. */
function dolulukDenetle(h: Hucre[], sutun: SutunSayisi): void {
  const enAlt = Math.max(...h.map((x) => x.satir + x.boy));
  const izgara: (string | null)[][] = Array.from({ length: enAlt - 1 }, () => Array(sutun).fill(null));
  for (const x of h) {
    assert.ok(x.kolon >= 1 && x.kolon + x.genislik - 1 <= sutun, `${x.id} ızgara dışında`);
    for (let r = x.satir; r < x.satir + x.boy; r++) {
      for (let c = x.kolon; c < x.kolon + x.genislik; c++) {
        assert.equal(izgara[r - 1][c - 1], null, `${x.id} ile ${izgara[r - 1][c - 1]} üst üste`);
        izgara[r - 1][c - 1] = x.id;
      }
    }
  }
  for (const s of izgara) assert.ok(s.every(Boolean), 'ızgarada delik var');
}

const PLANLAR: KartYerlesimi[][] = [
  // demo-veri.mjs'teki elle kurulmuş yerleşim: üstte zihin bandı, sonra farklı boylar, 5+3 gibi izinsiz genişlikler
  [k('zihin', 12, 'k'), k('hatirlatici', 4, 'o'), k('eposta', 8, 'o'), k('dikkat', 4, 'k'), k('plan', 3, 'o'), k('ozel:hafta', 5, 'k', 'ozel'), k('whatsapp', 4, 'k'), k('oneriler', 8, 'k'), k('arac_kiti', 12, 'k')],
  // planlayıcının bozuk önerileri: sıfır, 13, ondalık, eksik
  [k('zihin', 12, 'k'), k('eposta', 0), k('plan', 13, 'b'), k('dikkat', 2.6, 'k'), k('sohbetler', NaN as unknown as number, 'k'), k('arac_kiti', 7, 'k'), k('hafiza', 5, 'k')],
  // tek kart, sonra çok sayıda küçük kart
  [k('zihin', 3, 'k'), k('ozel:a', 3, 'k', 'ozel'), k('ozel:b', 3, 'k', 'ozel'), k('ozel:c', 3, 'k', 'ozel'), k('ozel:d', 3, 'k', 'ozel'), k('ice_aktarma', 3, 'k')],
  [k('dusunme', 7, 'k'), k('meseleler', 5, 'o')],
];

test('her plan, her sütun sayısında deliksiz ve sırasını koruyarak dizilir', () => {
  for (const plan of PLANLAR) {
    for (const sutun of [12, 6, 1] as SutunSayisi[]) {
      const h = izgaraDiz(plan, sutun);
      assert.deepEqual(h.map((x) => x.id), plan.map((x) => x.id), 'sıra bozuldu');
      dolulukDenetle(h, sutun);
      // Okuma sırası (satır, sonra kolon) planlayıcının sırasıyla aynı.
      const okuma = [...h].sort((a, b) => a.satir - b.satir || a.kolon - b.kolon).map((x) => x.id);
      assert.deepEqual(okuma, plan.map((x) => x.id));
    }
  }
});

test('12 sütunda genişlikler izinli kümede; zihin ve gün kaydı en az 6, listeler en az 4', () => {
  for (const plan of PLANLAR) {
    for (const x of izgaraDiz(plan, 12)) {
      assert.ok([3, 4, 6, 8, 9, 12].includes(x.genislik), `${x.id}: ${x.genislik}`);
      const tip = plan.find((p) => p.id === x.id)!.tip;
      if (tip === 'zihin' || tip === 'dusunme') assert.ok(x.genislik >= 6, `${x.id} çok dar`);
      else if (tip !== 'ozel' && tip !== 'ice_aktarma') assert.ok(x.genislik >= 4, `${x.id} çok dar`);
    }
  }
});

test('demo yerleşimi: üstte zihin bandı, hatırlatıcı bandın altında sol üstte, satırlar tam dolu ve eşit boyda', () => {
  const h = izgaraDiz(PLANLAR[0], 12);
  const bul = (id: string) => h.find((x) => x.id === id)!;
  assert.deepEqual([bul('zihin').kolon, bul('zihin').genislik, bul('zihin').satir, bul('zihin').boy], [1, 12, 1, 1]);
  assert.deepEqual([bul('hatirlatici').kolon, bul('hatirlatici').satir, bul('hatirlatici').genislik], [1, 2, 4]);
  // hatirlatici(4,o) + eposta(8,o) aynı satır; sonra dikkat(4,k) + plan(3,o) + ozel(5,k): boy en uzunu (o = 3)
  const ikinci = h.filter((x) => x.satir === bul('dikkat').satir);
  assert.deepEqual(ikinci.map((x) => x.id), ['dikkat', 'plan', 'ozel:hafta']);
  assert.equal(ikinci.reduce((n, x) => n + x.genislik, 0), 12);
  assert.ok(ikinci.every((x) => x.boy === 3));
  assert.equal(bul('arac_kiti').genislik, 12);
});

test('satır dağıtımı: kalan sütun önerilene en yakın biçimde paylaşılır', () => {
  assert.deepEqual(satiriDagit([4, 4], [4, 4], 12), [6, 6]);
  assert.deepEqual(satiriDagit([8], [4], 12), [12]);
  assert.deepEqual(satiriDagit([6, 3], [4, 3], 12), [8, 4]);
  assert.deepEqual(satiriDagit([4, 6], [4, 4], 12), [4, 8]);
  assert.deepEqual(satiriDagit([3, 3, 3, 3], [3, 3, 3, 3], 12), [3, 3, 3, 3]);
  assert.deepEqual(satiriDagit([4, 5, 4], [4, 4, 4], 12), [4, 4, 4]);
  assert.deepEqual(satiriDagit([3, 3], [3, 3], 6), [3, 3]);
  assert.deepEqual(satiriDagit([3], [3], 6), [6]);
});

test('dar ızgara: 6 sütunda zihin tam genişlik; 1 sütunda her kart kendi satırında', () => {
  const h6 = izgaraDiz(PLANLAR[0], 6);
  assert.equal(h6.find((x) => x.id === 'zihin')!.genislik, 6);
  assert.ok(h6.every((x) => x.genislik === 3 || x.genislik === 6));
  const h1 = izgaraDiz(PLANLAR[0], 1);
  assert.equal(new Set(h1.map((x) => x.satir)).size, h1.length);
  assert.equal(sutunSec(900), 12);
  assert.equal(sutunSec(600), 6);
  assert.equal(sutunSec(380), 1);
});

test('zihin bandı: her zaman ilk, tam genişlikte, tek başına bir satır (komşusu onu germez); her sütun sayısında', () => {
  for (const sutun of [12, 6, 1] as SutunSayisi[]) {
    for (const y of ['k', 'o', 'b', undefined] as const) assert.equal(boyOku({ tip: 'zihin', yukseklik: y }, sutun), 'k', `${sutun} sütun, ${y}`);
    // Planlayıcı bandı komşuyla yan yana (8 sütun, orta boy) önerse de bant yalnız kalır, tam genişlik ve tek satır olur.
    const h = izgaraDiz([k('hatirlatici', 4, 'o'), k('zihin', 8, 'o'), k('plan', 6, 'b')], sutun);
    const z = h.find((x) => x.id === 'zihin')!;
    assert.deepEqual([z.kolon, z.genislik, z.satir, z.boy], [1, sutun, 1, 1], `${sutun} sütun`);
    assert.ok(h.filter((x) => x.id !== 'zihin').every((x) => x.satir > 1), 'başka kart bandın satırına girmez');
    dolulukDenetle(h, sutun);
  }
  assert.equal(boyOku({ tip: 'plan', yukseklik: 'o' }), 'o', 'diğer kartlar etkilenmez');
});

test('yerlesimiOturt: zihin başa alınır, tam genişlik ve küçük boya sabitlenir; diğer sıra korunur', () => {
  const o = yerlesimiOturt([k('hatirlatici', 4, 'o'), k('eposta', 8, 'o'), k('zihin', 8, 'o'), k('plan', 6, 'o')]);
  assert.deepEqual(o.map((x) => x.id), ['zihin', 'hatirlatici', 'eposta', 'plan']);
  assert.deepEqual([o[0].kolon, o[0].genislik, o[0].yukseklik], [1, 12, 'k']);
  assert.deepEqual([o[1].kolon, o[1].genislik], [1, 4]);
});

test('yerlesimiOturt: kolon/genişlik 12 sütuna oturur, gün kaydı en az orta boy', () => {
  const o = yerlesimiOturt([k('dusunme', 7, 'k'), k('meseleler', 5, 'o')]);
  assert.equal(o[0].yukseklik, 'o');
  assert.equal(o[0].kolon, 1);
  assert.equal(o[1].kolon, 1 + o[0].genislik);
  assert.equal(o[0].genislik + o[1].genislik, 12);
});

// ── Önem ──
const SAAT = 3_600_000;
const simdi = Date.parse('2026-10-19T12:00:00');
const veri = (ek: Partial<KokpitVerisi> = {}): KokpitVerisi => ({
  hatirlaticilar: [], gorevler: [], oneriler: [], epostalar: [], whatsapp: [], sohbetler: [], projeler: [], hafiza: [],
  iceAktarma: { bekleyen: 0, islenen: 0, hata: 0 }, ozelKartlar: [], zihin: { durum: 'bos', hafizaSayisi: 0, bagliMotorlar: [] },
  dusunme: { durum: {} as KokpitVerisi['dusunme']['durum'], bugunOnemli: [], meseleler: [] },
  ...ek,
});
const hat = (dk: number, durum = 'bekliyor') => ({ id: dk, baslik: 'x', zaman: new Date(simdi + dk * 60_000).toISOString(), tekrar: 'yok', durum, onem: 3 });

test('kural önemi: yaklaşan hatırlatıcı, geciken görev, önemli e-posta, geciken mesele', () => {
  assert.equal(kuralOnemi('hatirlatici', veri({ hatirlaticilar: [hat(40)] }), simdi), 'acil');
  assert.equal(kuralOnemi('hatirlatici', veri({ hatirlaticilar: [hat(150)] }), simdi), 'dikkat');
  assert.equal(kuralOnemi('hatirlatici', veri({ hatirlaticilar: [hat(600)] }), simdi), 'normal');
  // Bildirilmiş (geçmiş) hatırlatıcı acil yapmaz.
  assert.equal(kuralOnemi('hatirlatici', veri({ hatirlaticilar: [hat(-30, 'gonderildi')] }), simdi), 'normal');
  const gorev = (dk: number) => ({ id: 1, baslik: 'g', durum: 'acik', oncelik: 3, sonTarih: new Date(simdi + dk * 60_000).toISOString() });
  assert.equal(kuralOnemi('plan', veri({ gorevler: [gorev(-5)] }), simdi), 'acil');
  assert.equal(kuralOnemi('plan', veri({ gorevler: [gorev(2 * 60)] }), simdi), 'dikkat');
  const ep = (onem: number, okundu: boolean) => ({ id: 1, hesap: 'İş', kimden: 'a', konu: 'b', tarih: '', ozet: '', okundu, onem });
  assert.equal(kuralOnemi('eposta', veri({ epostalar: [ep(5, false)] }), simdi), 'dikkat');
  assert.equal(kuralOnemi('eposta', veri({ epostalar: [ep(5, true), ep(3, false)] }), simdi), 'normal');
  const mesele = (hedef: string) => ({ id: 1, baslik: 'm', ilkGun: '2026-10-10', hedef, durum: 'acik' as const, guncelleme: '' });
  assert.equal(kuralOnemi('meseleler', veri({ dusunme: { ...veri().dusunme, meseleler: [mesele('2026-10-17')] } }), simdi), 'acil');
  assert.equal(kuralOnemi('meseleler', veri({ dusunme: { ...veri().dusunme, meseleler: [mesele('2026-10-20')] } }), simdi), 'dikkat');
  assert.equal(kuralOnemi('meseleler', veri({ dusunme: { ...veri().dusunme, meseleler: [mesele('2026-10-30')] } }), simdi), 'normal');
  assert.equal(SAAT, 3_600_000);
});

test('önem birleştirme: yüksek olan kazanır, zihin hep normal, en çok iki acil, vurgu eşlenir', () => {
  const v = veri({ hatirlaticilar: [hat(20)] });
  const o = onemleriBirlestir([
    { ...k('zihin', 8), onem: 'acil' }, k('hatirlatici', 4), { ...k('eposta', 6), onem: 'olumlu' },
    { ...k('plan', 6), onem: 'acil' }, { ...k('whatsapp', 6), onem: 'acil' }, { ...k('sohbetler', 6), vurgu: true },
  ], v, simdi);
  assert.deepEqual(o.map((x) => x.onem), ['normal', 'acil', 'olumlu', 'acil', 'dikkat', 'dikkat']);
  assert.deepEqual(o.map((x) => x.vurgu), [false, true, false, true, true, true]);
  assert.equal(onemOku({ vurgu: true }), 'dikkat');
  assert.equal(onemOku({ onem: 'bilinmez' }), 'normal');
  assert.equal(onemDegisti(undefined, 'dikkat'), true);
  assert.equal(onemDegisti('dikkat', 'acil'), true);
  assert.equal(onemDegisti('acil', 'dikkat'), false);
  assert.equal(onemDegisti('dikkat', 'olumlu'), true);
  assert.equal(onemDegisti('normal', 'normal'), false);
});

// ── 0.13 T14: kokpit geniş ekranda ──────────────────────────────────────────────────────────────────────────────────
// Kokpit tam ekranda hava durumu ve borsa kartları garip görünüyordu: her şey genişliyor, boşluklar
// anlamsızlaşıyordu.
test("2560'ta alan KOKPIT_EN_GENIS'i aşmaz: CSS'teki üst sınır sabitle aynı, ortalanır; sınırdaki ızgara 12 sütun", async () => {
  const fs = await import('node:fs');
  const css = fs.readFileSync(new URL('../src/renderer/tasarim.css', import.meta.url), 'utf8');
  assert.match(css, new RegExp(`--kokpit-en-genis:\\s*${KOKPIT_EN_GENIS}px`), 'tasarim.css --kokpit-en-genis sabitle aynı değil');
  assert.match(css, /\.kokpit__alan > \*\s*\{[^}]*max-width: var\(--kokpit-en-genis\)[^}]*margin-inline: auto/, 'alanın çocukları üst sınırlı ve ortalı olmalı');
  // 2560 penceresinde alan ≈ 2000 px, sohbet sütunu 480 px: ızgara 1680'e iner (1946 değil) ve hâlâ 12 sütun.
  assert.equal(sutunSec(Math.min(2000 - 58, KOKPIT_EN_GENIS)), 12);
  assert.ok(KOKPIT_EN_GENIS < 1946, 'sınır, geniş ekrandaki ızgarayı gerçekten daraltmalı');
});

test('hava kartı en fazla 4 sütun (satırın üçte biri), döviz 4, öneriler 6: komşular büyür, satır yine tam dolar', () => {
  assert.deepEqual([KART_EN_GENIS.hava, KART_EN_GENIS.piyasa, KART_EN_GENIS.ipuclari], [4, 4, 6]);
  // Planlayıcı havaya 8 sütun önerse de 4'te kalır; yanındaki kart kalanı alır.
  const h = izgaraDiz([k('hatirlatici', 4), k('hava', 8)], 12);
  dolulukDenetle(h, 12);
  assert.equal(h.find((x) => x.id === 'hava')!.genislik, 4);
  assert.equal(h.find((x) => x.id === 'hatirlatici')!.genislik, 8);
  // Satırda esneyecek kart yoksa (hava + döviz) delik kalmaması için sınır esner.
  dolulukDenetle(izgaraDiz([k('piyasa', 4), k('hava', 4)], 12), 12);
  // Dar ızgarada (6 sütun) sınır uygulanmaz.
  assert.equal(izgaraDiz([k('hava', 12)], 6)[0].genislik, 6);
  assert.equal(satiriDagit([8, 4], [4, 4], 12, [4, undefined]).join(), '4,8');
});
