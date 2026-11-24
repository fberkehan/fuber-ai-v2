// 0.11 G6 — yapay zekâ yanıtına kart: `kart_goster` aracı ve kartın sıkı doğrulaması (src/shared/kart.ts).
// Yapay zekânın kullanacağı kaliteli bir arayüz kütüphanesi. Altı kart türü (özet, liste, tablo,
// adımlar, karşılaştırma, bağlantılar); doğrulama KATI: bilinmeyen alan yok, uzunluk ve sayı sınırları, bağlantı yalnız http(s), HTML yok
// (metin düz metin olarak kalır; arayüz React metniyle çizer — dangerouslySetInnerHTML yok, burada kaynak taranır).
// Gerçek shared/kart.ts + araclar/kart.ts; sohbet kaydı/görünümü gerçek main/sohbet.ts ile (Electron sahte, veri geçici; ağ yok).
import { KURULUM_SURUMU } from '../src/shared/kurulum-adimlari.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { kartDogrula, kartDuzMetin, kartBaslik, kartOzetSatirlari, aracCagrisiKarti, kartiDuzMetneIndir, KART_SINIR, KART_TURLERI, type KartVerisi } from '../src/shared/kart.ts';
import { KART_ORNEKLERI, KART_ZORLAYICI } from '../src/renderer/ui/galeri-veri.ts';
import { blokHafiflet, hafiflet, olayHafiflet, mesajMetni, gorunenBloklarMetni } from '../src/shared/telefon-hafif.ts';
import { anaSurecSahnesi, esbuildHazir } from './yardimci/ana-surec.ts';

anaSurecSahnesi('kart', {
  kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, kullaniciAdi: 'Deniz', mod: 'is', tanitimSurumu: '0.9.0', ses: { surum: 2, uyandirma: false },
  proaktif: { etkin: false }, baslangictaAc: false,
});
process.env.FUBER_DEMO = '1';
await esbuildHazir();
const { sohbetOlustur, mesajEkle, gorunenMesajlar, mesajlar, sohbetListesi } = await import('../src/main/sohbet.ts');
const { kartAraciniKaydet } = await import('../src/main/ajan/araclar/kart.ts');
const { aracBul, dogrula } = await import('../src/main/ajan/araclar/kayit.ts');

const ok = (girdi: unknown): KartVerisi => {
  const s = kartDogrula(girdi);
  assert.ok('kart' in s, `geçerli olmalıydı: ${'hata' in s ? s.hata : ''}`);
  return s.kart;
};
const hata = (girdi: unknown): string => {
  const s = kartDogrula(girdi);
  assert.ok('hata' in s, `reddedilmeliydi: ${String(JSON.stringify(girdi)).slice(0, 120)}`);
  assert.ok(s.hata.length > 8, 'hata iletisi okunur olmalı');
  return s.hata;
};
const n = (adet: number, f: (i: number) => unknown) => Array.from({ length: adet }, (_, i) => f(i));
const uzun = (k: number) => 'a'.repeat(k);

// ── Geçerli örnek: her tür ──
const ORNEKLER: Record<KartVerisi['tur'], unknown> = {
  ozet: { tur: 'ozet', baslik: 'Bu haftanın özeti', maddeler: ['Sunum cuma teslim', 'Bütçe %15 aştı'] },
  liste: { tur: 'liste', baslik: 'Toplantılar', ogeler: [{ baslik: 'Yatırımcı görüşmesi', alt: 'Zoom', sag: '09:30' }, { baslik: 'Ürün gözden geçirme' }] },
  tablo: { tur: 'tablo', baslik: 'Planlar', sutunlar: ['Plan', 'Fiyat'], satirlar: [['Başlangıç', '9 $'], ['Pro', '29 $']] },
  adimlar: { tur: 'adimlar', baslik: 'Kurulum', adimlar: ['İndir', 'Çalıştır', 'Giriş yap'] },
  karsilastirma: { tur: 'karsilastirma', baslik: 'Hangisi?', secenekler: ['Plan A', 'Plan B'], ozellikler: [{ ad: 'Fiyat', degerler: ['9 $', '29 $'] }, { ad: 'Kullanıcı', degerler: ['1', '5'] }] },
  baglantilar: { tur: 'baglantilar', baslik: 'Kaynaklar', baglantilar: [{ baslik: 'Fuber', adres: 'https://ornek.example' }, { baslik: 'Yardım', adres: 'http://yardim.ornek.example/baslangic' }] },
};

test('her tür için geçerli örnek {kart} döner ve kartın tamamı olduğu gibi kalır', () => {
  for (const [tur, g] of Object.entries(ORNEKLER)) assert.deepEqual(ok(g), g, tur);
});

test('isteğe bağlı başlık ve alanlar yoksa kart yine geçerli (özetin başlığı zorunlu)', () => {
  assert.deepEqual(ok({ tur: 'liste', ogeler: [{ baslik: 'Tek öğe' }] }), { tur: 'liste', ogeler: [{ baslik: 'Tek öğe' }] });
  assert.deepEqual(ok({ tur: 'adimlar', adimlar: ['Bir'] }), { tur: 'adimlar', adimlar: ['Bir'] });
  hata({ tur: 'ozet', maddeler: ['x'] });
  hata({ tur: 'ozet', baslik: '   ', maddeler: ['x'] });
  // Boş bırakılan isteğe bağlı alanlar (modeller "" yollayabilir) yok sayılır.
  assert.deepEqual(ok({ tur: 'liste', baslik: '', ogeler: [{ baslik: 'A', alt: '', sag: ' ' }] }), { tur: 'liste', ogeler: [{ baslik: 'A' }] });
});

test('sınırlar: özet ≤8, liste ≤12, tablo ≤6 sütun × ≤20 satır, adımlar ≤10, karşılaştırma 2–3 seçenek × ≤8 özellik, bağlantılar ≤8', () => {
  assert.deepEqual(KART_SINIR, { baslik: 80, metin: 200, ozet: 8, liste: 12, sutun: 6, satir: 20, adim: 10, secenekEn: 3, secenekAz: 2, ozellik: 8, baglanti: 8 });
  const maddeler = (k: number) => ({ tur: 'ozet', baslik: 'Özet', maddeler: n(k, (i) => `madde ${i}`) });
  ok(maddeler(8)); hata(maddeler(9)); hata(maddeler(0));
  const liste = (k: number) => ({ tur: 'liste', ogeler: n(k, (i) => ({ baslik: `öğe ${i}` })) });
  ok(liste(12)); hata(liste(13)); hata(liste(0));
  const tablo = (c: number, s: number) => ({ tur: 'tablo', sutunlar: n(c, (i) => `S${i}`), satirlar: n(s, () => n(c, (j) => `h${j}`)) });
  ok(tablo(6, 20)); hata(tablo(7, 3)); hata(tablo(3, 21)); hata(tablo(0, 1)); hata(tablo(2, 0));
  const adimlar = (k: number) => ({ tur: 'adimlar', adimlar: n(k, (i) => `adım ${i}`) });
  ok(adimlar(10)); hata(adimlar(11)); hata(adimlar(0));
  const kars = (s: number, o: number) => ({ tur: 'karsilastirma', secenekler: n(s, (i) => `S${i}`), ozellikler: n(o, (i) => ({ ad: `Ö${i}`, degerler: n(s, (j) => `d${j}`) })) });
  ok(kars(2, 8)); ok(kars(3, 1)); hata(kars(1, 2)); hata(kars(4, 2)); hata(kars(2, 9)); hata(kars(2, 0));
  const baglanti = (k: number) => ({ tur: 'baglantilar', baglantilar: n(k, (i) => ({ baslik: `B${i}`, adres: `https://ornek.com/${i}` })) });
  ok(baglanti(8)); hata(baglanti(9)); hata(baglanti(0));
});

test('her metin ≤200 karakter, başlık ≤80 (kart, öğe ve bağlantı başlıkları)', () => {
  ok({ tur: 'ozet', baslik: uzun(80), maddeler: [uzun(200)] });
  hata({ tur: 'ozet', baslik: uzun(81), maddeler: ['x'] });
  hata({ tur: 'ozet', baslik: 'Özet', maddeler: [uzun(201)] });
  ok({ tur: 'liste', ogeler: [{ baslik: uzun(80), alt: uzun(200), sag: uzun(200) }] });
  hata({ tur: 'liste', ogeler: [{ baslik: uzun(81) }] });
  hata({ tur: 'liste', ogeler: [{ baslik: 'A', alt: uzun(201) }] });
  hata({ tur: 'liste', ogeler: [{ baslik: 'A', sag: uzun(201) }] });
  ok({ tur: 'tablo', sutunlar: [uzun(200)], satirlar: [[uzun(200)]] });
  hata({ tur: 'tablo', sutunlar: ['A'], satirlar: [[uzun(201)]] });
  hata({ tur: 'tablo', sutunlar: [uzun(201)], satirlar: [['x']] });
  hata({ tur: 'adimlar', adimlar: [uzun(201)] });
  hata({ tur: 'karsilastirma', secenekler: ['A', uzun(201)], ozellikler: [{ ad: 'x', degerler: ['1', '2'] }] });
  hata({ tur: 'karsilastirma', secenekler: ['A', 'B'], ozellikler: [{ ad: uzun(201), degerler: ['1', '2'] }] });
  hata({ tur: 'karsilastirma', secenekler: ['A', 'B'], ozellikler: [{ ad: 'x', degerler: ['1', uzun(201)] }] });
  hata({ tur: 'baglantilar', baglantilar: [{ baslik: uzun(81), adres: 'https://ornek.example' }] });
  hata({ tur: 'baglantilar', baglantilar: [{ baslik: 'A', adres: `https://ornek.example/${uzun(200)}` }] });
  // Karakter sayısı kod noktasıyla: 200 emoji hâlâ 200 karakterdir.
  ok({ tur: 'ozet', baslik: 'E', maddeler: ['😀'.repeat(200)] });
});

test('bilinmeyen alan reddedilir: üst düzeyde, iç içe nesnede ve başka türün alanı', () => {
  assert.match(hata({ tur: 'ozet', baslik: 'A', maddeler: ['x'], renk: 'kırmızı' }), /renk/);
  assert.match(hata({ tur: 'liste', ogeler: [{ baslik: 'A', simge: 'zil' }] }), /simge/);
  assert.match(hata({ tur: 'karsilastirma', secenekler: ['A', 'B'], ozellikler: [{ ad: 'x', degerler: ['1', '2'], not: 'y' }] }), /not/);
  assert.match(hata({ tur: 'baglantilar', baglantilar: [{ baslik: 'A', adres: 'https://ornek.example', hedef: '_blank' }] }), /hedef/);
  // Özet kartında "ogeler" gibi başka türün alanı da bilinmeyen alandır.
  assert.match(hata({ tur: 'ozet', baslik: 'A', maddeler: ['x'], ogeler: [] }), /ogeler/);
  assert.match(hata({ tur: 'tablo', sutunlar: ['A'], satirlar: [['x']], html: '<b>x</b>' }), /html/);
});

test('girdi nesne olmalı; tür bilinmeli; alan türleri doğru olmalı', () => {
  for (const g of [null, undefined, 'ozet', 42, true, [], [{ tur: 'ozet' }]]) hata(g);
  hata({});
  hata({ tur: 'pasta', baslik: 'A' });
  hata({ tur: 7 });
  hata({ tur: 'ozet', baslik: 5, maddeler: ['x'] });
  hata({ tur: 'ozet', baslik: 'A', maddeler: 'x' });
  hata({ tur: 'ozet', baslik: 'A', maddeler: [1, 2] });
  hata({ tur: 'ozet', baslik: 'A', maddeler: [null] });
  hata({ tur: 'ozet', baslik: 'A', maddeler: [''] });
  hata({ tur: 'liste', ogeler: ['düz metin'] });
  hata({ tur: 'liste', ogeler: [{ alt: 'başlıksız' }] });
  hata({ tur: 'tablo', sutunlar: ['A'], satirlar: ['x'] });
  hata({ tur: 'tablo', sutunlar: [1], satirlar: [['x']] });
  // Prototip kirletme girişimi bilinmeyen alandır.
  hata(JSON.parse('{"tur":"ozet","baslik":"A","maddeler":["x"],"__proto__":{"x":1},"constructor":"y"}'));
});

test('tablo: her satır sütun sayısı kadar hücre taşır; karşılaştırma: değer sayısı seçenek sayısı kadar', () => {
  assert.match(hata({ tur: 'tablo', sutunlar: ['A', 'B'], satirlar: [['1', '2'], ['3']] }), /2\. satır|satır 2/i);
  hata({ tur: 'tablo', sutunlar: ['A', 'B'], satirlar: [['1', '2', '3']] });
  hata({ tur: 'tablo', sutunlar: ['A'], satirlar: [[]] });
  // Boş hücre serbest (tabloda "—" yerine boş bırakılabilir).
  assert.deepEqual(ok({ tur: 'tablo', sutunlar: ['A', 'B'], satirlar: [['1', '']] }), { tur: 'tablo', sutunlar: ['A', 'B'], satirlar: [['1', '']] });
  assert.match(hata({ tur: 'karsilastirma', secenekler: ['A', 'B'], ozellikler: [{ ad: 'x', degerler: ['1'] }] }), /x/);
  hata({ tur: 'karsilastirma', secenekler: ['A', 'B', 'C'], ozellikler: [{ ad: 'x', degerler: ['1', '2'] }] });
  hata({ tur: 'karsilastirma', secenekler: ['A', 'B'], ozellikler: [{ ad: 'x', degerler: ['1', '2', '3'] }] });
});

test('bağlantı adresi yalnız http: / https:; javascript:, data:, file:, ftp:, şemasız ve göreli adres reddedilir', () => {
  const adres = (a: string) => ({ tur: 'baglantilar', baglantilar: [{ baslik: 'Bağlantı', adres: a }] });
  for (const a of ['https://ornek.example', 'http://fuber.ai/a?b=c#d', 'HTTPS://Fuber.AI/Yol', 'https://yardim.ornek.example:8443/x']) ok(adres(a));
  for (const a of [
    'javascript:alert(1)', 'JavaScript:alert(1)', ' javascript:alert(1)', 'java\nscript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///C:/Windows/win.ini',
    'ftp://fuber.ai/x', 'vbscript:msgbox(1)', 'fuber.ai', 'www.fuber.ai/yol', '//fuber.ai', '/yol/ici', 'mailto:a@b.co', 'tel:+905000000002', 'blob:https://ornek.example/x', '', 'https://', 'http:',
  ]) hata(adres(a));
});

test('K1: URL ayrıştırıcısının kabul ettiği kurallı olmayan adresler ("http:foo", "https:/x.com", "https:\\\\x.com") reddedilir — ana sürecin sistem:ac yolu yalnız "://" açar', () => {
  const adres = (a: string) => ({ tur: 'baglantilar', baglantilar: [{ baslik: 'Bağlantı', adres: a }] });
  const ters = String.fromCharCode(92);
  for (const a of ['http:foo', 'https:/x.com', `https:${ters}${ters}x.com`, 'HTTP:foo', ' https:/x.com']) {
    assert.ok(new URL(a.trim()).hostname, `ayrıştırıcı bunu kabul eder: ${a}`); // sorunun kaynağı: URL "geçerli" der
    assert.match(hata(adres(a)), /https:\/\//, a);
  }
  // Kurallı adresler aynen geçer (ipc.ts'in /^https?:\/\// koruması ile aynı kural).
  for (const a of ['https://x.com', 'http://x.com:8080/a?b#c', 'HTTP://X.com']) assert.equal((ok(adres(a)) as Extract<KartVerisi, { tur: 'baglantilar' }>).baglantilar[0].adres, a);
});

test('K5: tablo hücresi ve karşılaştırma değerinde sonlu sayı ve doğru/yanlış metne çevrilir; NaN/Infinity/nesne/dizi/null hata', () => {
  const tablo = (h: unknown) => ({ tur: 'tablo', sutunlar: ['Plan', 'Fiyat', 'Aktif'], satirlar: [['Pro', h, h]] });
  assert.deepEqual((ok({ tur: 'tablo', sutunlar: ['Plan', 'Fiyat', 'Adet', 'Aktif', 'Pasif'], satirlar: [['Pro', 29, 3.5, true, false]] }) as Extract<KartVerisi, { tur: 'tablo' }>).satirlar, [['Pro', '29', '3.5', 'Evet', 'Hayır']]);
  assert.deepEqual((ok(tablo(0)) as Extract<KartVerisi, { tur: 'tablo' }>).satirlar, [['Pro', '0', '0']]);
  assert.deepEqual((ok(tablo(-12.5)) as Extract<KartVerisi, { tur: 'tablo' }>).satirlar, [['Pro', '-12.5', '-12.5']]);
  const k = ok({ tur: 'karsilastirma', secenekler: ['A', 'B'], ozellikler: [{ ad: 'Fiyat', degerler: [9, 29] }, { ad: 'Destek', degerler: [false, true] }] }) as Extract<KartVerisi, { tur: 'karsilastirma' }>;
  assert.deepEqual(k.ozellikler, [{ ad: 'Fiyat', degerler: ['9', '29'] }, { ad: 'Destek', degerler: ['Hayır', 'Evet'] }]);
  assert.equal(kartDuzMetin(k), 'Seçenekler: A | B\nFiyat — A: 9 · B: 29\nDestek — A: Hayır · B: Evet');
  for (const kotu of [NaN, Infinity, -Infinity, null, undefined, {}, [], ['x'], () => 1]) {
    hata(tablo(kotu));
    hata({ tur: 'karsilastirma', secenekler: ['A', 'B'], ozellikler: [{ ad: 'x', degerler: ['1', kotu] }] });
  }
  // Başlıklar, maddeler, adımlar katı kalır: sayı/boolean yalnız hücrelerde.
  hata({ tur: 'tablo', sutunlar: [1], satirlar: [['x']] });
  hata({ tur: 'ozet', baslik: 'A', maddeler: [5] });
  hata({ tur: 'adimlar', adimlar: [true] });
  hata({ tur: 'karsilastirma', secenekler: [1, 2], ozellikler: [{ ad: 'x', degerler: ['a', 'b'] }] });
});

test('"<" ve ">" içeren metin düz metin olarak KALIR (temizlenmez, silinmez, çevrilmez)', () => {
  const metin = '<b>kalın</b> & <img src=x onerror=alert(1)> "tırnak" 5 < 7 > 3';
  const k = ok({ tur: 'ozet', baslik: metin, maddeler: [metin] }) as Extract<KartVerisi, { tur: 'ozet' }>;
  assert.equal(k.baslik, metin);
  assert.deepEqual(k.maddeler, [metin]);
  const t = ok({ tur: 'tablo', sutunlar: ['<th>'], satirlar: [['<td>']] }) as Extract<KartVerisi, { tur: 'tablo' }>;
  assert.deepEqual([t.sutunlar, t.satirlar], [['<th>'], [['<td>']]]);
  // Satır içi biçim işaretleri de düz metindir (kalın/italik çizilmez, silinmez).
  assert.deepEqual((ok({ tur: 'adimlar', adimlar: ['**kalın** _italik_ `kod`'] }) as Extract<KartVerisi, { tur: 'adimlar' }>).adimlar, ['**kalın** _italik_ `kod`']);
});

test('metin düzeltmesi: satır sonları ve çoklu boşluk tek boşluk, denetim ve yön denetimi karakterleri düşer', () => {
  const k = ok({ tur: 'ozet', baslik: '  Başlık\n\tikinci   satır  ', maddeler: ['a\u0000b\u202ec\u200bd'] }) as Extract<KartVerisi, { tur: 'ozet' }>;
  assert.equal(k.baslik, 'Başlık ikinci satır');
  // NUL → boşluk; sağdan-sola geçersiz kılma (U+202E) ve sıfır genişlikli boşluk (U+200B) düşer.
  assert.deepEqual(k.maddeler, ['a bcd']);
});

test('doğrulama girdiyi değiştirmez ve sonuç girdiyle paylaşılmaz (kopya)', () => {
  const g = { tur: 'ozet', baslik: ' A ', maddeler: ['x'] };
  const once = JSON.stringify(g);
  const k = ok(g) as Extract<KartVerisi, { tur: 'ozet' }>;
  assert.equal(JSON.stringify(g), once);
  assert.notEqual(k.maddeler, g.maddeler);
});

test('galeri ve önizleme fikstürleri (normal + zorlayıcı) kartDogrula\'dan olduğu gibi geçer; zorlayıcılar sınırlara dayanır', () => {
  for (const { ad, kart } of [...KART_ORNEKLERI, ...KART_ZORLAYICI]) assert.deepEqual(ok(kart), kart, ad);
  assert.deepEqual([...new Set([...KART_ORNEKLERI, ...KART_ZORLAYICI].map((f) => f.kart.tur))].sort(), [...KART_TURLERI].sort(), 'altı türün hepsi');
  const z = Object.fromEntries(KART_ZORLAYICI.map((f) => [f.kart.tur, f.kart])) as Record<string, KartVerisi>;
  assert.equal((z.ozet as Extract<KartVerisi, { tur: 'ozet' }>).maddeler.length, KART_SINIR.ozet);
  assert.equal((z.liste as Extract<KartVerisi, { tur: 'liste' }>).ogeler.length, KART_SINIR.liste);
  assert.deepEqual([(z.tablo as Extract<KartVerisi, { tur: 'tablo' }>).sutunlar.length, (z.tablo as Extract<KartVerisi, { tur: 'tablo' }>).satirlar.length], [KART_SINIR.sutun, KART_SINIR.satir]);
  assert.equal((z.adimlar as Extract<KartVerisi, { tur: 'adimlar' }>).adimlar.length, KART_SINIR.adim);
  assert.deepEqual([(z.karsilastirma as Extract<KartVerisi, { tur: 'karsilastirma' }>).secenekler.length, (z.karsilastirma as Extract<KartVerisi, { tur: 'karsilastirma' }>).ozellikler.length], [KART_SINIR.secenekEn, KART_SINIR.ozellik]);
  assert.equal((z.baglantilar as Extract<KartVerisi, { tur: 'baglantilar' }>).baglantilar.length, KART_SINIR.baglanti);
});

test('kartDuzMetin: her tür okunur satırlar (tablo ve karşılaştırma dahil)', () => {
  assert.equal(kartDuzMetin(ok(ORNEKLER.ozet)), 'Bu haftanın özeti\n- Sunum cuma teslim\n- Bütçe %15 aştı');
  assert.equal(kartDuzMetin(ok(ORNEKLER.liste)), 'Toplantılar\n- Yatırımcı görüşmesi — Zoom (09:30)\n- Ürün gözden geçirme');
  assert.equal(kartDuzMetin(ok(ORNEKLER.tablo)), 'Planlar\nPlan | Fiyat\nBaşlangıç | 9 $\nPro | 29 $');
  assert.equal(kartDuzMetin(ok(ORNEKLER.adimlar)), 'Kurulum\n1. İndir\n2. Çalıştır\n3. Giriş yap');
  assert.equal(kartDuzMetin(ok(ORNEKLER.karsilastirma)), 'Hangisi?\nSeçenekler: Plan A | Plan B\nFiyat — Plan A: 9 $ · Plan B: 29 $\nKullanıcı — Plan A: 1 · Plan B: 5');
  assert.equal(kartDuzMetin(ok(ORNEKLER.baglantilar)), 'Kaynaklar\n- Fuber: https://ornek.example\n- Yardım: http://yardim.ornek.example/baslangic');
  // Başlıksız kartta başlık satırı yok.
  assert.equal(kartDuzMetin(ok({ tur: 'adimlar', adimlar: ['Bir', 'İki'] })), '1. Bir\n2. İki');
});

test('kartBaslik: başlık yoksa türün adı; kartOzetSatirlari: ilk N satır + kalan sayısı', () => {
  assert.equal(kartBaslik(ok(ORNEKLER.ozet)), 'Bu haftanın özeti');
  assert.deepEqual(['liste', 'tablo', 'adimlar', 'karsilastirma', 'baglantilar'].map((t) => kartBaslik({ ...(ok(ORNEKLER[t as KartVerisi['tur']]) as object), baslik: undefined } as KartVerisi)),
    ['Liste', 'Tablo', 'Adımlar', 'Karşılaştırma', 'Bağlantılar']);
  const o = kartOzetSatirlari(ok({ tur: 'ozet', baslik: 'B', maddeler: ['1', '2', '3', '4', '5'] }), 3);
  assert.deepEqual(o, { baslik: 'B', satirlar: ['1', '2', '3'], kalan: 2 });
  assert.deepEqual(kartOzetSatirlari(ok(ORNEKLER.adimlar), 3).kalan, 0);
  // 11 Kas (tasarımcı bulgu 8): çentikte tablo ham boru işaretiyle ("Plan | Fiyat") görünmez — hizalı küçük tablo olur (başlık + ilk N satır).
  const t = kartOzetSatirlari(ok(ORNEKLER.tablo), 3);
  assert.deepEqual(t.tablo, { sutunlar: ['Plan', 'Fiyat'], satirlar: [['Başlangıç', '9 $'], ['Pro', '29 $']] });
  assert.equal(t.kalan, 0);
  assert.ok(t.satirlar.every((s) => !s.includes('|')), JSON.stringify(t.satirlar));
});

test('çentik özeti: tabloda ve karşılaştırmada boru işareti yok; uzun tablo ilk N satır + kalan satır sayısı', () => {
  const uzun = ok({ tur: 'tablo', baslik: 'Planlar', sutunlar: ['Plan', 'Aylık', 'Kullanıcı'], satirlar: [['Başlangıç', '9 $', '1'], ['Pro', '29 $', '5'], ['Takım', '79 $', '20'], ['Kurumsal', '199 $', '100']] });
  const o = kartOzetSatirlari(uzun, 3);
  assert.deepEqual(o.tablo, { sutunlar: ['Plan', 'Aylık', 'Kullanıcı'], satirlar: [['Başlangıç', '9 $', '1'], ['Pro', '29 $', '5'], ['Takım', '79 $', '20']] });
  assert.equal(o.kalan, 1);
  const k = kartOzetSatirlari(ok(ORNEKLER.karsilastirma), 3);
  assert.deepEqual(k.tablo, { sutunlar: ['', 'Plan A', 'Plan B'], satirlar: [['Fiyat', '9 $', '29 $'], ['Kullanıcı', '1', '5']] });
  for (const tur of KART_TURLERI) {
    const ozet = kartOzetSatirlari(ok(ORNEKLER[tur]), 3);
    assert.ok(ozet.satirlar.every((s) => !/\s\|\s/.test(s)), `${tur}: ${JSON.stringify(ozet.satirlar)}`);
  }
});

test('aracCagrisiKarti: yalnız kart_goster çağrısının GEÇERLİ girdisi kart olur; ötekiler null', () => {
  assert.deepEqual(aracCagrisiKarti('kart_goster', ORNEKLER.ozet), ok(ORNEKLER.ozet));
  assert.equal(aracCagrisiKarti('kart_goster', { tur: 'ozet' }), null);
  assert.equal(aracCagrisiKarti('hafiza_ara', ORNEKLER.ozet), null);
  assert.equal(aracCagrisiKarti('kart_goster', null), null);
});

test('kartiDuzMetneIndir: kart bloğu düz metin bloğuna iner (telefon, özet); ötekiler aynen', () => {
  const kart = ok(ORNEKLER.adimlar);
  assert.deepEqual(kartiDuzMetneIndir({ tur: 'kart', kart }), { tur: 'metin', metin: kartDuzMetin(kart) });
  const metin = { tur: 'metin' as const, metin: 'merhaba' };
  assert.equal(kartiDuzMetneIndir(metin), metin);
});

test('YapayZekaKarti kart içeriğini React metniyle çizer: dangerouslySetInnerHTML / innerHTML / Markdown yok', () => {
  const yol = path.resolve(import.meta.dirname, '..', 'src', 'renderer', 'bilesenler', 'YapayZekaKarti.tsx');
  const kaynak = fs.readFileSync(yol, 'utf8');
  assert.doesNotMatch(kaynak, /dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML|<Markdown|from '.\/Ortak'/);
  // Bağlantı yalnız ana sürecin sistem:ac yoluyla açılır (o da yalnız http/https); <a href> yok.
  assert.doesNotMatch(kaynak, /<a\s/);
  assert.match(kaynak, /sistem:ac/);
});

// ── kart_goster aracı ──
kartAraciniKaydet();

test('kart_goster: grup "kart", risk serbest, etiket "Kart hazırlıyor"; şema tür zorunlu', () => {
  const a = aracBul('kart_goster')!;
  assert.ok(a);
  assert.equal(a.grup, 'kart');
  assert.equal(a.risk, 'serbest');
  assert.equal(a.etiket({ tur: 'tablo', baslik: 'Gizli başlık' }), 'Kart hazırlıyor');
  assert.equal(a.etiket({}), 'Kart hazırlıyor');
  const sema = a.tanim.sema as { type: string; required: string[]; properties: Record<string, { type?: string; enum?: string[] }> };
  assert.equal(sema.type, 'object');
  assert.deepEqual(sema.required, ['tur']);
  assert.deepEqual(sema.properties.tur.enum, ['ozet', 'liste', 'tablo', 'adimlar', 'karsilastirma', 'baglantilar']);
  for (const alan of ['baslik', 'maddeler', 'ogeler', 'sutunlar', 'satirlar', 'adimlar', 'secenekler', 'ozellikler', 'baglantilar']) assert.ok(sema.properties[alan], alan);
  assert.equal(dogrula(sema as never, { tur: 'ozet', baslik: 'A', maddeler: ['x'] }), null);
  assert.match(dogrula(sema as never, {}) ?? '', /tur/);
});

test('kart_goster: geçerli kart "gösterildi" der (modele kartın kendisi geri dönmez), geçersiz kart hata + nedeni döner', async () => {
  const a = aracBul('kart_goster')!;
  const b = { sohbetId: 1, sinyal: new AbortController().signal, gorevIzinleri: new Set<string>(), onay: async () => 'reddet' as const };
  const iyi = await a.calistir(ORNEKLER.tablo as Record<string, unknown>, b);
  assert.equal(iyi.hata, undefined);
  assert.match(iyi.icerik, /gösterildi/);
  assert.ok(iyi.icerik.length < 200, 'kartın tamamı modele geri yollanmaz (girdisi zaten bağlamda)');
  const kotu = await a.calistir({ tur: 'tablo', sutunlar: ['A', 'B'], satirlar: [['1']] }, b);
  assert.equal(kotu.hata, true);
  assert.match(kotu.icerik, /satır/i);
  assert.match(kotu.icerik, /tekrar/i);
  const js = await a.calistir({ tur: 'baglantilar', baglantilar: [{ baslik: 'x', adres: 'javascript:alert(1)' }] }, b);
  assert.equal(js.hata, true);
});

test('kart_goster Gizli/yerel turda zaten yok (araç listesi boş) ve ARAC_NOTLARI\'nda tek satırlık kullanım notu var; kayıt main.ts\'te', () => {
  const kok = path.resolve(import.meta.dirname, '..', 'src', 'main');
  const dongu = fs.readFileSync(path.join(kok, 'ajan', 'dongu.ts'), 'utf8');
  const notlar = /const ARAC_NOTLARI = `([\s\S]*?)`;/.exec(dongu)?.[1] ?? '';
  const satirlar = notlar.split('\n').filter((s) => /kart_goster/.test(s));
  assert.equal(satirlar.length, 1, 'tek satır');
  assert.match(satirlar[0], /^- /);
  assert.ok(satirlar[0].length < 400);
  assert.match(dongu, /const araclar = yerelTek \? \[\] :/, 'Gizli/yerel turda araç listesi boş');
  assert.match(fs.readFileSync(path.join(kok, 'main.ts'), 'utf8'), /kartAraciniKaydet\(\)/);
});

// ── Sohbet kaydı ve görünümü ──
const metin = (m: string) => ({ tur: 'metin' as const, metin: m });
const cagri = (id: string, ad: string, girdi: Record<string, unknown>) => ({ tur: 'arac_cagri' as const, id, ad, girdi });
const sonuc = (id: string, ad: string, icerik: string, hata?: boolean) => ({ tur: 'arac_sonuc' as const, id, ad, icerik, ...(hata ? { hata: true } : {}) });

test('görünüm: başarılı kart_goster çağrısı "kart" bloğu olur (araç satırı değil); sırası metinle birlikte korunur', () => {
  const id = sohbetOlustur('Kartlı');
  mesajEkle(id, { rol: 'user', bloklar: [metin('Planları karşılaştır')], kaynak: 'kullanici' });
  mesajEkle(id, { rol: 'assistant', bloklar: [metin('Şöyle:'), cagri('k1', 'kart_goster', ORNEKLER.tablo as Record<string, unknown>)] });
  mesajEkle(id, { rol: 'user', kaynak: 'arac', bloklar: [sonuc('k1', 'kart_goster', 'Kart gösterildi.')] });
  mesajEkle(id, { rol: 'assistant', bloklar: [metin('Pro daha iyi.')] });
  const m = gorunenMesajlar(id).filter((x) => x.rol === 'assistant');
  assert.equal(m.length, 1, 'araç döngüsü tek balon');
  assert.deepEqual(m[0].bloklar.map((b) => b.tur), ['metin', 'kart', 'metin']);
  const kart = m[0].bloklar[1] as { tur: 'kart'; kart: KartVerisi };
  assert.deepEqual(kart.kart, ok(ORNEKLER.tablo));
  assert.ok(!JSON.stringify(m[0].bloklar).includes('"tur":"arac"'));
});

test('görünüm: sonucu hata olan ya da girdisi geçersiz kart_goster çağrısı kart OLMAZ, "hata" araç satırı kalır', () => {
  const id = sohbetOlustur('Kartsız');
  mesajEkle(id, { rol: 'assistant', bloklar: [cagri('h1', 'kart_goster', { tur: 'tablo', sutunlar: ['A'], satirlar: [['1', '2']] })] });
  mesajEkle(id, { rol: 'user', kaynak: 'arac', bloklar: [sonuc('h1', 'kart_goster', 'Kart geçersiz: satır sayısı. Düzeltip tekrar çağır.', true)] });
  mesajEkle(id, { rol: 'assistant', bloklar: [cagri('h2', 'kart_goster', ORNEKLER.ozet as Record<string, unknown>)] });
  mesajEkle(id, { rol: 'user', kaynak: 'arac', bloklar: [sonuc('h2', 'kart_goster', 'Onay verilmedi', true)] });
  const b = gorunenMesajlar(id).flatMap((x) => x.bloklar);
  assert.deepEqual(b.map((x) => x.tur), ['arac', 'arac']);
  assert.ok(b.every((x) => x.tur === 'arac' && x.durum !== 'tamam'));
});

test('kayıt: kartın düz metni mesajın metnine girer (arama, sohbet özeti, liste önizlemesi); telefon ve bildirim metni de', () => {
  const id = sohbetOlustur('Metinli');
  const k = mesajEkle(id, { rol: 'assistant', bloklar: [metin('Özet hazır.'), cagri('m1', 'kart_goster', ORNEKLER.karsilastirma as Record<string, unknown>)] });
  assert.ok(k.metin.startsWith('Özet hazır.'));
  assert.ok(k.metin.includes('Fiyat — Plan A: 9 $ · Plan B: 29 $'), k.metin);
  assert.equal(mesajlar(id).at(-1)!.metin, k.metin);
  // Yalnız karttan oluşan yanıt da önizlemede görünür (boş metin değil).
  const id2 = sohbetOlustur('Yalnız kart');
  mesajEkle(id2, { rol: 'assistant', bloklar: [cagri('m2', 'kart_goster', ORNEKLER.adimlar as Record<string, unknown>)] });
  assert.match(sohbetListesi().find((s) => s.id === id2)?.sonMesaj ?? '', /1\. İndir/);
  // Geçersiz kart metne girmez.
  const bos = mesajEkle(id2, { rol: 'assistant', bloklar: [cagri('m3', 'kart_goster', { tur: 'ozet' })] });
  assert.equal(bos.metin, '');
});

test('K7: tur metni (hafıza yazıcısı, başlık, yankı bekçisi) sohbet kaydıyla AYNI kuraldan (kayitMetni); dongu.ts\'te ayrı kart metni işlevi yok', () => {
  const dongu = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'main', 'ajan', 'dongu.ts'), 'utf8');
  assert.match(dongu, /kayitMetni\(y\.bloklar\)/);
  assert.doesNotMatch(dongu, /function kartMetni|kartDuzMetin/);
  // AracBlok tek yerde (shared/tipler.ts); ada ve bileşen oradan içe aktarır.
  const oku = (...p: string[]) => fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src', ...p), 'utf8');
  assert.match(oku('shared', 'tipler.ts'), /export type AracBlok = /);
  for (const d of [['renderer', 'ada', 'useAsistan.ts'], ['renderer', 'bilesenler', 'AracAdimlari.tsx'], ['renderer', 'bilesenler', 'Sohbet.tsx']]) assert.doesNotMatch(oku(...d), /export type AracBlok/, d.join('/'));
});

test('K2: sesli turda kart_goster sunulmaz (kartın içeriği söylenmez; sesli yanıt hep konuşulabilir metin); yazılı turda sunulur', async () => {
  const { temelAraclariKaydet } = await import('../src/main/ajan/araclar/temel.ts');
  temelAraclariKaydet();
  const { turAraclari } = await import('../src/main/ajan/dongu.ts');
  const adlar = (l: { tanim: { ad: string } }[]) => l.map((a) => a.tanim.ad);
  const sesli = adlar(await turAraclari('merhaba', true));
  const yazili = adlar(await turAraclari('merhaba', false));
  assert.ok(!sesli.includes('kart_goster'), sesli.join(', '));
  assert.ok(sesli.includes('hafiza_ara') && sesli.includes('hatirlatici_kur'), 'sesli turda öteki araçlar kalır');
  assert.ok(yazili.includes('kart_goster') && yazili.includes('hafiza_ara'), yazili.join(', '));
  assert.ok(sesli.length < yazili.length);
});
