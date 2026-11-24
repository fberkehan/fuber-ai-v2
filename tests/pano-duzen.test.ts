// Dolu pano düzeni (Görev 24, K14): boş kart yok; görünen alan doldurucularla tam dolar; kullanıcı verisi çoksa doldurucular küçülüp
// aşağı iner; delik yok, sıra korunur; araç kiti her zaman bir yerde. src/shared/pano-duzen.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SATIR_TAVAN_PX, panoDiz, kartDoluMu, hedefSatirHesapla, satirYuksekligi, satirPikselleri, altlikSigar, icerikBoyu, boylariIcerigeGore, DOLGU_TIPLERI, type PanoDuzeni } from '../src/shared/pano-duzen.ts';
import type { SutunSayisi } from '../src/shared/izgara.ts';
import type { KartYerlesimi, KokpitVerisi } from '../src/shared/tipler.ts';

const k = (id: string, genislik: number, yukseklik: KartYerlesimi['yukseklik'] = 'o', tip = id as KartYerlesimi['tip']): KartYerlesimi => ({ id, tip, kolon: 1, genislik, yukseklik });
const BANTLAR = [k('zihin', 12, 'k'), k('gundem', 12, 'k')];
/** Ana sürecin kuralla eklediği araç kiti (planlayıcı koymadı). */
const KIT = { ...k('arac_kiti', 6, 'k'), yedek: true };

/** Delik yok, üst üste binme yok, ızgara içinde (bantlar dahil). */
function deliksiz(d: PanoDuzeni, sutun: SutunSayisi): void {
  const enAlt = Math.max(...d.hucreler.map((x) => x.satir + x.boy));
  const iz: (string | null)[][] = Array.from({ length: enAlt - 1 }, () => Array(sutun).fill(null));
  for (const x of d.hucreler) {
    assert.ok(x.kolon >= 1 && x.kolon + x.genislik - 1 <= sutun, `${x.id} ızgara dışında`);
    for (let r = x.satir; r < x.satir + x.boy; r++) for (let c = x.kolon; c < x.kolon + x.genislik; c++) {
      assert.equal(iz[r - 1][c - 1], null, `${x.id} ile ${iz[r - 1][c - 1]} üst üste`);
      iz[r - 1][c - 1] = x.id;
    }
  }
  for (const s of iz) assert.ok(s.every(Boolean), 'delik var');
}
/** Görünen alandaki (ilk `hedef` satır) toplam satır = kullanıcı + doldurucu satırları. */
function gorunen(d: PanoDuzeni, hedef: number): number { return Math.min(d.toplamSatir, hedef); }

test('hiç veri yok, 12 sütun, 4 satır (1440×900): iki tam sıra doldurucu, boş satır yok, araç kiti var', () => {
  const d = panoDiz({ kartlar: [...BANTLAR, KIT], dolgular: DOLGU_TIPLERI, sutun: 12, hedefSatir: 4 });
  deliksiz(d, 12);
  assert.equal(d.bosSatir, 0);
  assert.equal(d.toplamSatir, 4, JSON.stringify(d.hucreler));
  const tipler = d.kartlar.map((x) => x.tip);
  assert.deepEqual(tipler.slice(0, 2), ['zihin', 'gundem']);
  for (const t of ['hava', 'haberler', 'arac_kiti', 'piyasa']) assert.ok(tipler.includes(t as never), `${t} yok`);
  // Daha uzun pencerede kartlar uzar; hiçbir doldurucu tek başına bütün satıra gerilmez (seyrek koca kutu yok).
  const uzun = panoDiz({ kartlar: [...BANTLAR], dolgular: DOLGU_TIPLERI, sutun: 12, hedefSatir: 6 });
  assert.equal(uzun.bosSatir, 0);
  for (const s of new Set(uzun.hucreler.filter((x) => x.satir > 2).map((x) => x.satir))) {
    assert.ok(uzun.hucreler.filter((x) => x.satir === s).length >= 2, `satır ${s} tek kartlık`);
  }
  // Hava sol üstte (doldurucuların ilki), haberler yanında geniş.
  const hava = d.hucreler.find((x) => x.id === 'hava')!, haber = d.hucreler.find((x) => x.id === 'haberler')!;
  assert.equal(hava.kolon, 1);
  assert.equal(hava.satir, haber.satir);
  assert.ok(haber.genislik >= 6);
});

test('hiç veri yok, 6 sütun, 2 satır (1080×680): hava + haberler tek sırada; araç kiti aşağıda (kaybolmaz)', () => {
  const d = panoDiz({ kartlar: [...BANTLAR], dolgular: DOLGU_TIPLERI, sutun: 6, hedefSatir: 2 });
  deliksiz(d, 6);
  assert.equal(d.bosSatir, 0);
  const ilkSira = d.hucreler.filter((x) => x.satir === 3).map((x) => x.id);
  assert.deepEqual(ilkSira, ['hava', 'haberler']);
  assert.ok(d.kartlar.some((x) => x.tip === 'arac_kiti'), 'araç kiti hiç yok');
});

test('görünen alan her satır sayısında tam dolar (2–9 satır, 12 ve 6 sütun); boş satır yalnız doldurucu biterse', () => {
  for (const sutun of [12, 6] as SutunSayisi[]) {
    for (let hedef = 2; hedef <= 9; hedef++) {
      const d = panoDiz({ kartlar: [...BANTLAR], dolgular: DOLGU_TIPLERI, sutun, hedefSatir: hedef });
      deliksiz(d, sutun);
      // Beş doldurucu en çok üç sıra (3 × 'b' = 12 satır) tutar; daha uzun pencerede arayüz satırları uzatır.
      assert.equal(d.bosSatir, 0, `${sutun} sütun, ${hedef} satır: ${d.bosSatir} boş`);
      assert.equal(gorunen(d, hedef), hedef, `${sutun}/${hedef}: ${d.toplamSatir}`);
    }
  }
});

test('orta veri: kullanıcı kartları önce ve sırası korunur; kalan satırlar doldurulur', () => {
  const kullanici = [k('hatirlatici', 4, 'o'), k('eposta', 8, 'o')];
  const d = panoDiz({ kartlar: [...BANTLAR, ...kullanici, KIT], dolgular: DOLGU_TIPLERI, sutun: 12, hedefSatir: 5 });
  deliksiz(d, 12);
  assert.deepEqual(d.kartlar.slice(2, 4).map((x) => x.id), ['hatirlatici', 'eposta']);
  assert.equal(d.bosSatir, 0);
  assert.equal(gorunen(d, 5), 5);
  const ilkDolgu = d.hucreler.find((x) => x.id === 'hava')!;
  assert.equal(ilkDolgu.satir, 3 + 3, 'hava kullanıcı satırının altında');
  assert.deepEqual(['hatirlatici', 'eposta'].map((id) => d.kartlar.find((x) => x.id === id)!.yukseklik), ['o', 'o'], 'kullanıcı kartları büyütülmedi');
});

test('tek satırlık açık kalırsa kullanıcı kartı BÜYÜMEZ; artan yükseklik görünen doldurucu satırına (ya da görünen satırlara) piksel olarak gider', () => {
  const d = panoDiz({ kartlar: [...BANTLAR, k('hatirlatici', 4, 'o'), k('eposta', 8, 'o')], dolgular: DOLGU_TIPLERI, sutun: 12, hedefSatir: 4 });
  deliksiz(d, 12);
  assert.equal(d.kartlar.find((x) => x.id === 'eposta')!.yukseklik, 'o');
  for (const t of ['hava', 'haberler', 'arac_kiti']) assert.ok(d.kartlar.some((x) => x.tip === t), `${t} aşağıda yok`);
  const px = satirPikselleri(d, 4, 446);
  assert.deepEqual(px.slice(0, 3), [92, 92, 92], 'kullanıcı satırları taban yükseklikte');
  assert.equal(px[3], 92 + (446 - (4 * 92 + 3 * 14)), 'artan, görünen ilk doldurucu (hava/haberler) satırına');
  // I7 (son inceleme): görünen alanda bütün kartları doldurucu olan satır yoksa (çok veri) artan yükseklik KULLANILMAZ — kullanıcı
  // kartları gerilmez (eskiden görünen satırlara yayılıyor, kartların ortası boş kalıyordu); sıradaki satır görünen alanın dibine akar.
  const dolu = panoDiz({ kartlar: [...BANTLAR, k('hatirlatici', 4, 'b'), k('eposta', 8, 'b')], dolgular: DOLGU_TIPLERI, sutun: 12, hedefSatir: 4 });
  const p2 = satirPikselleri(dolu, 4, 430);
  assert.deepEqual(p2.slice(0, 4), [92, 92, 92, 92]);
  assert.ok(dolu.toplamSatir > 4, 'aşağıda doldurucu satırları var (görünen alanın dibine akar)');
});

// ── I7 (son inceleme): ortası boş kart yok ──
/** Satırlar: hücre satırına göre gruplanmış kart kimlikleri (bantlar hariç). */
const satirlarOf = (d: PanoDuzeni) => {
  const m = new Map<number, { boy: number; idler: string[] }>();
  for (const x of d.hucreler) { if (x.satir <= 2) continue; const r = m.get(x.satir) ?? { boy: x.boy, idler: [] }; r.idler.push(x.id); m.set(x.satir, r); }
  return [...m.values()];
};
const DOLGULAR = new Set<string>(DOLGU_TIPLERI);

test('I7: bir satır yalnız AYNI boydaki kullanıcı kartlarından kurulur; kalan genişliğe o boya gerilebilen doldurucu girer (orta profil)', () => {
  // Pano önizlemesinin "orta" profili: iki kayıtlı Hatırlatıcılar (orta boy), tek kayıtlı Planlar ve Son e-postalar (küçük boy).
  const kullanici = [k('hatirlatici', 4, 'o'), k('plan', 4, 'k'), k('eposta', 4, 'k')];
  for (const [sutun, hedef] of [[12, 4], [12, 3], [6, 2], [6, 4]] as [SutunSayisi, number][]) {
    const d = panoDiz({ kartlar: [...BANTLAR, ...kullanici, KIT], dolgular: DOLGU_TIPLERI, sutun, hedefSatir: hedef });
    deliksiz(d, sutun);
    for (const r of satirlarOf(d)) {
      const kendi = r.idler.filter((id) => !DOLGULAR.has(id));
      const boylar = new Set(kendi.map((id) => d.kartlar.find((x) => x.id === id)!.yukseklik));
      assert.ok(boylar.size <= 1, `${sutun}/${hedef}: satırda farklı boylu kullanıcı kartları ${JSON.stringify(r)}`);
      // Kullanıcı kartı kendi (içerik) boyunda kalır: satır onu germez.
      for (const id of kendi) assert.equal(r.boy, { k: 2, o: 3, b: 4 }[kullanici.find((q) => q.id === id)!.yukseklik], `${id} gerildi`);
    }
    // Kullanıcı kartlarının sırası korunur.
    assert.deepEqual(d.kartlar.filter((x) => !DOLGULAR.has(x.id) && x.id !== 'zihin' && x.id !== 'gundem').map((x) => x.id), ['hatirlatici', 'plan', 'eposta']);
    for (const t of ['hava', 'haberler', 'arac_kiti']) assert.ok(d.kartlar.some((x) => x.tip === t), `${sutun}/${hedef}: ${t} yok`);
  }
  // 12 sütunda: Hatırlatıcılar yanında geniş bir doldurucu (aynı boyda), Planlar + e-postalar yanında küçük bir doldurucu.
  const d = panoDiz({ kartlar: [...BANTLAR, ...kullanici, KIT], dolgular: DOLGU_TIPLERI, sutun: 12, hedefSatir: 4 });
  const s = satirlarOf(d);
  assert.deepEqual(s[0].idler, ['hatirlatici', 'haberler']);
  assert.deepEqual(s[1].idler, ['plan', 'eposta', 'hava']);
});

test('I7: satır büyütme yalnız bütün kartları doldurucu olan satırlarda; döviz ve ipuçları orta boydan uzun gerilmez', () => {
  // "Sıradaki" profili: tek kayıtlı Hatırlatıcılar; eskiden hava ile aynı satırda beş günlük hava boyuna (b) geriliyordu.
  for (const hedef of [4, 5, 6, 8]) {
    const d = panoDiz({ kartlar: [...BANTLAR, k('hatirlatici', 4, 'k'), KIT], dolgular: DOLGU_TIPLERI, sutun: 12, hedefSatir: hedef });
    deliksiz(d, 12);
    assert.equal(d.kartlar.find((x) => x.id === 'hatirlatici')!.yukseklik, 'k', `${hedef}: hatırlatıcı gerildi`);
    for (const r of satirlarOf(d)) {
      if (r.idler.some((id) => !DOLGULAR.has(id))) assert.equal(r.boy, 2, `${hedef}: kullanıcı kartlı satır büyüdü ${JSON.stringify(r)}`);
      if (r.idler.some((id) => id === 'piyasa' || id === 'ipuclari')) assert.ok(r.boy <= 3, `${hedef}: döviz/ipuçları ${r.boy}`);
    }
  }
});

test('I7: satır pikselleri yalnız bütün kartları doldurucu olan satırlara; kullanıcı kartlı satır taban yükseklikte', () => {
  const d = panoDiz({ kartlar: [...BANTLAR, k('hatirlatici', 4, 'k'), KIT], dolgular: DOLGU_TIPLERI, sutun: 12, hedefSatir: 4 });
  const px = satirPikselleri(d, 4, 470);
  const hat = d.hucreler.find((x) => x.id === 'hatirlatici')!;
  for (let r = hat.satir - 3; r < hat.satir - 3 + hat.boy; r++) assert.equal(px[r], 92, `hatırlatıcı satırı ${r} uzadı`);
  assert.equal(px.slice(0, 4).reduce((a, b) => a + b, 0) + 3 * 14, 470, 'görünen alan doldurucu satırlarıyla dolar');
});

test('satır pikselleri: hiç veri yokken görünen alan tam dolar; yalnız hava/haberler satırı uzar, diğer doldurucular tabanda', () => {
  for (const [sutun, hedef, alan] of [[12, 4, 433], [6, 2, 238], [12, 6, 700]] as [SutunSayisi, number, number][]) {
    const d = panoDiz({ kartlar: [...BANTLAR, KIT], dolgular: DOLGU_TIPLERI, sutun, hedefSatir: hedef });
    const px = satirPikselleri(d, hedef, alan);
    const gorunur = px.slice(0, Math.min(px.length, hedef));
    assert.equal(gorunur.reduce((a, b) => a + b, 0) + (gorunur.length - 1) * 14, alan, `${sutun}/${hedef}`);
    const hava = d.hucreler.find((x) => x.id === 'hava')!;
    const havaSatiri = hava.satir - 3;
    for (let r = 0; r < gorunur.length; r++) if (r < havaSatiri || r >= havaSatiri + hava.boy) assert.equal(px[r], 92, `${sutun}/${hedef} satır ${r}`);
  }
});

// Görev 23 (G24 küçüğü): hava kapalı + ağ yok → yalnız araç kiti ve ipuçları; ipuçları (başlık + 4 düğme) kendi içeriğinin ötesine
// gerilmez (eskiden kartın %65'i boştu): satır başına üst sınır. Görünen alanı aşan yükseklik hiç verilmez.
test('satır pikselleri: ipuçları kartı içeriğinden (≤ 310 px, en çok orta boy) uzun gerilmez; artan yükseklik görünen alanı aşmaz', () => {
  let goruldu = 0;
  const kul = [[], [k('hatirlatici', 4, 'k')], [k('hatirlatici', 4, 'k'), k('eposta', 4, 'k')]];
  for (const [sutun, hedef, alan] of [[12, 4, 700], [12, 6, 760], [6, 2, 420], [12, 3, 560]] as [SutunSayisi, number, number][]) {
    for (const kk of kul) {
      const d = panoDiz({ kartlar: [...BANTLAR, ...kk, KIT], dolgular: ['arac_kiti', 'ipuclari'], sutun, hedefSatir: hedef });
      const px = satirPikselleri(d, hedef, alan);
      const gorunur = px.slice(0, Math.min(px.length, hedef));
      assert.ok(gorunur.reduce((a, b) => a + b, 0) + (gorunur.length - 1) * 14 <= alan, `${sutun}/${hedef}: alanı aştı`);
      const ip = d.hucreler.find((x) => x.id === 'ipuclari');
      if (!ip) continue; // bu yerleşimde araç kiti alanı dolduruyor
      goruldu++;
      assert.ok(ip.boy <= 3, `${sutun}/${hedef}: ipuçları ${ip.boy} satır`);
      const bas = ip.satir - 1 - 2;
      const boy = px.slice(bas, bas + ip.boy).reduce((a, b) => a + b, 0) + (ip.boy - 1) * 14;
      assert.ok(boy <= 310, `${sutun}/${hedef}: ipuçları ${boy} px`);
    }
  }
  assert.ok(goruldu >= 3, `ipuçları yalnız ${goruldu} yerleşimde`);
});

// I7 (son inceleme): çok veride de kullanıcı kartlarının SIRASI korunur ve ekranın üstündeki ilk satır kullanıcınındır; ama farklı boylu
// kullanıcı kartları aynı satırı paylaşmaz (kısa olan ortası boş, uzun bir kutu olurdu). Boyu farklı kart yeni satır başlatır, satırda kalan
// genişliğe o boya gerilebilen doldurucu girer (eskiden doldurucular hep en alttaydı, kısa kartlar gerilerek yer kaplıyordu).
test('çok veri: kullanıcı sırası korunur, ilk satır kullanıcının; satırlar tek boyda; doldurucular kalan genişlikte ya da altta, küçük', () => {
  const kullanici = [k('hatirlatici', 4, 'o'), k('eposta', 8, 'o'), k('dikkat', 4, 'k'), k('plan', 4, 'o'), k('oneriler', 4, 'k'), k('whatsapp', 6, 'k'), k('projeler', 6, 'k')];
  const d = panoDiz({ kartlar: [...BANTLAR, ...kullanici, KIT], dolgular: DOLGU_TIPLERI, sutun: 12, hedefSatir: 4 });
  deliksiz(d, 12);
  assert.deepEqual(d.kartlar.filter((x) => kullanici.some((q) => q.id === x.id)).map((x) => x.id), kullanici.map((x) => x.id));
  const s = satirlarOf(d);
  assert.deepEqual(s[0].idler, ['hatirlatici', 'eposta'], 'ilk satır kullanıcının');
  for (const r of s) {
    const kendi = r.idler.filter((id) => !DOLGULAR.has(id));
    assert.ok(new Set(kendi.map((id) => kullanici.find((q) => q.id === id)!.yukseklik)).size <= 1, JSON.stringify(r));
    for (const id of kendi) assert.equal(r.boy, { k: 2, o: 3, b: 4 }[kullanici.find((q) => q.id === id)!.yukseklik], `${id} gerildi`);
  }
  for (const t of ['hava', 'haberler', 'arac_kiti']) assert.ok(d.kartlar.some((x) => x.tip === t), `${t} yok`);
  // Görünen alan kullanıcı satırlarıyla dolu: doldurucu satırı büyümedi (bosSatir 0 değilse de kullanıcı kartı gerilmedi).
  assert.ok(d.kartlar.filter((x) => DOLGULAR.has(x.id)).every((x) => x.yukseklik === 'k' || s.some((r) => r.idler.includes(x.id) && r.idler.some((id) => !DOLGULAR.has(id)))));
});

test('planlayıcının yerleştirdiği doldurucu yerinde kalır; kaynağı kapalıysa düşer; kapalı doldurucu hiç gelmez', () => {
  const d = panoDiz({ kartlar: [...BANTLAR, k('hava', 4, 'k'), k('hatirlatici', 8, 'k')], dolgular: ['hava', 'arac_kiti', 'ipuclari'], sutun: 12, hedefSatir: 4 });
  assert.equal(d.kartlar[2].id, 'hava');
  assert.ok(!d.kartlar.some((x) => x.tip === 'haberler' || x.tip === 'piyasa'));
  const d2 = panoDiz({ kartlar: [...BANTLAR, k('haberler', 8, 'k'), k('hatirlatici', 4, 'k')], dolgular: ['hava', 'arac_kiti'], sutun: 12, hedefSatir: 4 });
  assert.ok(!d2.kartlar.some((x) => x.tip === 'haberler'));
  deliksiz(d2, 12);
  // Planlayıcının koyduğu araç kiti (işaretsiz) yerinde kalır; kuralla eklenen (yedek) havuza gider.
  const d3 = panoDiz({ kartlar: [...BANTLAR, k('arac_kiti', 12, 'k'), k('hatirlatici', 4, 'k')], dolgular: DOLGU_TIPLERI, sutun: 12, hedefSatir: 6 });
  assert.equal(d3.kartlar[2].id, 'arac_kiti');
  const d4 = panoDiz({ kartlar: [...BANTLAR, KIT, k('hatirlatici', 4, 'k')], dolgular: DOLGU_TIPLERI, sutun: 12, hedefSatir: 6 });
  assert.equal(d4.kartlar[2].id, 'hatirlatici');
});

test('kartDoluMu: verisi olmayan kullanıcı kartı boştur; doldurucu ve bantlar dolu sayılır', () => {
  const v = {
    hatirlaticilar: [], gorevler: [], oneriler: [], epostalar: [], whatsapp: [], sohbetler: [{ id: 1, baslik: 'Fuber', tur: 'ana', guncelleme: '' }], projeler: [], hafiza: [],
    iceAktarma: { bekleyen: 0, islenen: 3, hata: 0 }, ozelKartlar: [], zihin: { durum: 'bos', hafizaSayisi: 0, bagliMotorlar: [] },
    dusunme: { durum: { etkin: false }, bugunOnemli: [], meseleler: [] },
  } as unknown as KokpitVerisi;
  for (const t of ['hatirlatici', 'plan', 'eposta', 'whatsapp', 'dikkat', 'oneriler', 'sohbetler', 'projeler', 'hafiza', 'ice_aktarma', 'dusunme', 'meseleler', 'ozel'] as const) {
    assert.equal(kartDoluMu(t, v), false, t);
  }
  for (const t of ['zihin', 'gundem', 'hava', 'haberler', 'arac_kiti', 'piyasa', 'ipuclari'] as const) assert.equal(kartDoluMu(t, v), true, t);
});

test('içeriğe göre boy: tek kayıtlı liste kartı küçülür, kalabalık olan planlayıcının boyunda kalır (büyütülmez)', () => {
  const v = {
    hatirlaticilar: [{ id: 1 }], gorevler: Array.from({ length: 9 }, (_, i) => ({ id: i })), oneriler: [], epostalar: [{ id: 1 }, { id: 2 }, { id: 3 }], whatsapp: [],
    sohbetler: [], projeler: [], hafiza: [], iceAktarma: { bekleyen: 0, islenen: 0, hata: 0 }, ozelKartlar: [], zihin: {}, dusunme: { meseleler: [] },
  } as unknown as KokpitVerisi;
  assert.equal(icerikBoyu('hatirlatici', v), 'k');
  assert.equal(icerikBoyu('eposta', v), 'o');
  assert.equal(icerikBoyu('plan', v), 'b');
  assert.equal(icerikBoyu('dusunme', v), undefined, 'liste kartı değil');
  const sonuc = boylariIcerigeGore([k('hatirlatici', 8, 'b'), k('eposta', 8, 'k'), k('plan', 6, 'o')], v);
  assert.deepEqual(sonuc.map((x) => x.yukseklik), ['k', 'k', 'o'], 'yalnız küçültür');
  assert.deepEqual(sonuc.map((x) => x.genislik), [4, 6, 6], 'az kayıtlı kart daralır, kalabalık olan değişmez');
  // Alt şerit (özet + tek eylem) yalnız kayıtlardan sonra yer kalıyorsa.
  assert.equal(altlikSigar('hatirlatici', v, 'k'), true);
  assert.equal(altlikSigar('eposta', v, 'k'), false);
  assert.equal(altlikSigar('eposta', v, 'o'), true);
  assert.equal(altlikSigar('plan', v, 'b'), false);
  assert.equal(altlikSigar('dusunme', v, 'b'), false);
  // Görev 23 (G24 küçüğü): 1440'ta iki hatırlatıcılı kart (biri iki satır başlıklı) küçük boyda hafif taşıyordu — orta boy olur.
  assert.equal(icerikBoyu('hatirlatici', { ...v, hatirlaticilar: [{ id: 1 }, { id: 2 }] } as unknown as KokpitVerisi), 'o');
});

test('satır hesabı: görünen yükseklikten satır sayısı ve satırları tam oturtan yükseklik', () => {
  assert.equal(hedefSatirHesapla(230), 2);
  assert.equal(hedefSatirHesapla(446), 4);
  assert.equal(hedefSatirHesapla(100), 2, 'en az iki satır');
  assert.equal(satirYuksekligi(446, 4), 101);
  assert.equal(satirYuksekligi(230, 2), 108);
  assert.equal(satirYuksekligi(2000, 2), 168, 'üst sınır');
});

// ── 0.13 T14: kokpit geniş ekranda ──
test('satır yüksekliği geniş ekranda sınırlı: çok uzun görünen alanda da hiçbir satır SATIR_TAVAN_PX\'i aşmaz; hava ve döviz en fazla 4 sütun', () => {
  const d = panoDiz({ kartlar: [...BANTLAR, KIT], dolgular: DOLGU_TIPLERI, sutun: 12, hedefSatir: 12 });
  deliksiz(d, 12);
  for (const alan of [446, 900, 1300, 2000]) {
    const px = satirPikselleri(d, hedefSatirHesapla(alan), alan);
    assert.ok(px.every((p) => p <= SATIR_TAVAN_PX), `${alan} px alanda satırlar ${px.join(',')}`);
    assert.ok(px.every((p) => p >= 92));
  }
  for (const x of d.hucreler.filter((h) => ['hava', 'piyasa'].includes(h.id))) assert.ok(x.genislik <= 4, `${x.id} ${x.genislik} sütun`);
  assert.ok(SATIR_TAVAN_PX >= 92 + 14, 'tavan taban yükseklikten küçük olamaz');
});
