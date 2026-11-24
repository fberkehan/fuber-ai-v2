// 11 Kas tasarımcı analizi, bulgu 6: kokpit aynı bilgiyi 2–3 kez gösteriyordu — "Sunum taslağını bitir" Bugün bandında, Yapılacaklar kartında ve
// sağdaki "Bugünün özeti"nde; haberler Gündemde'de, Haberler kartında ve özette; hava hem İstanbul kartında hem özette. "Ne yapmalıyım?" sorusunun
// yanıtı kayboluyordu. Kural (src/shared/kokpit-tekil.ts):
//  · Bugün bandında görünen kayıt (en çok BUGUN_EN_COK) Hatırlatıcılar ve Yapılacaklar kartlarında yinelenmez; geriye kayıt kalmazsa kart çizilmez;
//  · Gündemde'nin gösterdiği haberler (konu örnekleri ya da yedek başlıklar) Haberler kartında yinelenmez ("Tümü" yine hepsini gösterir);
//  · "Bugünün özeti" yalnız ızgarada OLMAYAN bilgiyi taşır; hepsi ızgaradaysa özet hiç çizilmez (sağ panel sohbet olur).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUGUN_EN_COK, KONU_EN_COK, bantDisiVeri, bantHaberleri, ozetSatirlari } from '../src/shared/kokpit-tekil.ts';
import { gundemOgeleri } from '../src/shared/gundem.ts';
import { kartDoluMu } from '../src/shared/pano-duzen.ts';
import type { KokpitVerisi } from '../src/shared/tipler.ts';
import type { GundemKonusu, Haber } from '../src/shared/pano.ts';

const simdi = new Date(2026, 10, 11, 10, 0, 0).getTime();
const iso = (saat: number, gun = 0) => new Date(2026, 10, 11 + gun, saat, 0, 0).toISOString();
const veri = (ek: Partial<KokpitVerisi> = {}): KokpitVerisi => ({
  hatirlaticilar: [], gorevler: [], oneriler: [], epostalar: [], whatsapp: [], sohbetler: [], projeler: [], hafiza: [],
  iceAktarma: { bekleyen: 0, islenen: 0, hata: 0 }, ozelKartlar: [], zihin: { durum: 'bos', hafizaSayisi: 0, bagliMotorlar: [] },
  ...ek,
} as unknown as KokpitVerisi);
const hat = (id: number, zaman: string) => ({ id, baslik: `H${id}`, zaman, tekrar: 'yok', durum: 'bekliyor', onem: 3 });
const gor = (id: number, sonTarih?: string) => ({ id, baslik: `G${id}`, durum: 'acik', oncelik: 3, ...(sonTarih ? { sonTarih } : {}) });

test('Bugün bandındaki kayıt kartlarda yinelenmez; bant dışı kayıt kalır', () => {
  const v = veri({
    hatirlaticilar: [hat(1, iso(15)), hat(2, iso(9, 1))] as KokpitVerisi['hatirlaticilar'],
    gorevler: [gor(7, iso(8)), gor(8)] as KokpitVerisi['gorevler'],
    yapilacaklar: [gor(7, iso(8)), gor(8), { ...gor(9), durum: 'tamam', tamamlanma: iso(9) }] as KokpitVerisi['gorevler'],
  });
  const bant = gundemOgeleri(v, simdi).ogeler.map((o) => o.id);
  assert.deepEqual(bant, ['g:7', 'h:1']);
  const k = bantDisiVeri(v, simdi);
  assert.deepEqual(k.hatirlaticilar.map((h) => h.id), [2], 'yarınki hatırlatıcı kartta kalır');
  assert.deepEqual(k.gorevler.map((g) => g.id), [8]);
  assert.deepEqual(k.yapilacaklar?.map((g) => g.id), [8, 9], 'tamamlanan madde kartta kalır');
  assert.equal(v.hatirlaticilar.length, 2, 'girdi değişmez');
});

test('Son e-postalar gelen kutusudur: banttaki toplantı e-postası orada da kalır (kart boşalıp "Okunmamışları tara" kaybolmasın)', () => {
  const e = (id: number, konu: string) => ({ id, hesap: 'a', kimden: 'Ece <e@x>', konu, tarih: iso(8), ozet: '', okundu: false, onem: 3 });
  const v = veri({ epostalar: [e(1, 'Perşembe toplantısı için davet'), e(2, 'Ekim faturası')] as KokpitVerisi['epostalar'] });
  assert.deepEqual(gundemOgeleri(v, simdi).ogeler.map((o) => o.id), ['e:1']);
  assert.deepEqual(bantDisiVeri(v, simdi).epostalar.map((x) => x.id), [1, 2]);
});

test('bütün kayıtları bantta olan kart çizilmez', () => {
  const v = veri({ gorevler: [gor(7, iso(8))] as KokpitVerisi['gorevler'], hatirlaticilar: [hat(1, iso(15))] as KokpitVerisi['hatirlaticilar'] });
  const k = bantDisiVeri(v, simdi);
  assert.equal(kartDoluMu('plan', k), false);
  assert.equal(kartDoluMu('hatirlatici', k), false);
});

test('bant en çok BUGUN_EN_COK kayıt gösterir: fazlası kartlarda kalır ("+N daha · kartlarda" doğru kalsın)', () => {
  const l = Array.from({ length: BUGUN_EN_COK + 2 }, (_, i) => hat(i + 1, iso(11 + i)));
  const k = bantDisiVeri(veri({ hatirlaticilar: l as KokpitVerisi['hatirlaticilar'] }), simdi);
  assert.deepEqual(k.hatirlaticilar.map((h) => h.id), [BUGUN_EN_COK + 1, BUGUN_EN_COK + 2]);
});

test('sıradaki kipinde de (bugün boş) bantta görünen kayıt yinelenmez', () => {
  const k = bantDisiVeri(veri({ hatirlaticilar: [hat(1, iso(9, 2))] as KokpitVerisi['hatirlaticilar'] }), simdi);
  assert.equal(k.hatirlaticilar.length, 0);
});

const haber = (id: string): Haber => ({ id, baslik: `B${id}`, link: `https://x/${id}`, kaynak: 'K', kaynakId: 'k' });
const konu = (ad: string, h: Haber): GundemKonusu => ({ ad, kaynakSayisi: 3, haberSayisi: 3, ornek: h });

test('Gündemde\'nin haberleri Haberler kartında yinelenmez', () => {
  const l = ['a', 'b', 'c', 'd', 'e', 'f'].map(haber);
  // Konular varsa: ilk KONU_EN_COK konunun örnek haberi.
  const ayni = bantHaberleri([konu('X', l[0]), konu('Y', l[3]), konu('Z', l[4]), konu('W', l[5])], l);
  assert.deepEqual([...ayni].sort(), ['a', 'd', 'e']);
  assert.equal(KONU_EN_COK, 3);
  // Konu yoksa bant ilk başlıkları gösterir ("Son haberler").
  assert.deepEqual([...bantHaberleri([], l)], ['a', 'b', 'c']);
  assert.equal(bantHaberleri([], []).size, 0);
});

test('Bugünün özeti yalnız ızgarada olmayanı taşır', () => {
  const tam = new Set(['gundem', 'hava', 'piyasa', 'haberler']);
  assert.deepEqual(ozetSatirlari(tam), { gundem: false, hava: false, konu: false, dolar: false, bos: true });
  assert.deepEqual(ozetSatirlari(new Set(['gundem'])), { gundem: false, hava: true, konu: false, dolar: true, bos: false });
  assert.deepEqual(ozetSatirlari(new Set()), { gundem: true, hava: true, konu: true, dolar: true, bos: false });
});
