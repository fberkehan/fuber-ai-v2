// Pano çözücüleri (Görev 24): RSS 2.0 / RDF / Atom, MET Norway JSON, ECB ve TCMB XML, gündem konuları. Dış veri güvenilmez: bozuk
// girdi istisna fırlatmaz, bağlantılar yalnız http(s), başlıklar düz metin. src/shared/pano-cozucu.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rssCoz, haberleriBirlestir, konulariCikar, metCoz, ecbCoz, ecbPiyasa, tcmbCoz, tcmbPiyasa, duzMetin, gecerliBaglanti, varliklariCoz } from '../src/shared/pano-cozucu.ts';
import type { Haber } from '../src/shared/pano.ts';

const K = { id: 'trt', ad: 'TRT Haber' };

test('RSS 2.0: başlık (CDATA, varlık, etiket), bağlantı, pubDate → ISO; bağlantısız/başlıksız öğe atlanır', () => {
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Kanal</title>
    <item><title><![CDATA[Merkez Bankası <b>faizi</b> sabit tuttu]]></title><link>https://ornek.tr/a</link><pubDate>Sun, 25 Oct 2026 19:24:00 +0300</pubDate></item>
    <item><title>Fiyatlar &amp; maaşlar: &#8220;yeni&#8221; düzenleme</title><link> https://ornek.tr/b </link></item>
    <item><title></title><link>https://ornek.tr/c</link></item>
    <item><title>Bağlantısız</title></item>
    <item><title>Kötü bağlantı</title><link>javascript:alert(1)</link></item>
  </channel></rss>`;
  const h = rssCoz(xml, K);
  assert.equal(h.length, 2);
  assert.equal(h[0].baslik, 'Merkez Bankası faizi sabit tuttu');
  assert.equal(h[0].link, 'https://ornek.tr/a');
  assert.equal(h[0].zaman, '2026-10-25T16:24:00.000Z');
  assert.equal(h[0].kaynak, 'TRT Haber');
  assert.equal(h[1].baslik, 'Fiyatlar & maaşlar: “yeni” düzenleme');
  assert.equal(h[1].zaman, undefined);
});

test('RSS 1.0 (RDF) ve Atom: rdf:about öğeleri, Atom <link rel="alternate" href>, <updated>; guid kalıcı bağlantı', () => {
  const rdf = `<rdf:RDF><channel/><item rdf:about="https://dw.example/1"><title>DW başlığı</title><link>https://dw.example/1</link><dc:date>2026-10-25T10:00:00Z</dc:date></item></rdf:RDF>`;
  assert.deepEqual(rssCoz(rdf, K).map((x) => [x.baslik, x.zaman]), [['DW başlığı', '2026-10-25T10:00:00.000Z']]);
  const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title type="html">Atom &lt;i&gt;haberi&lt;/i&gt;</title><link rel="self" href="https://x.example/self"/><link rel="alternate" href="https://x.example/haber"/><updated>2026-10-25T08:30:00+02:00</updated></entry></feed>`;
  const a = rssCoz(atom, K);
  assert.equal(a[0].baslik, 'Atom haberi');
  assert.equal(a[0].link, 'https://x.example/haber');
  assert.equal(a[0].zaman, '2026-10-25T06:30:00.000Z');
  const guid = `<rss><channel><item><title>Guid</title><guid isPermaLink="true">https://g.example/1</guid></item><item><title>Kalıcı değil</title><guid isPermaLink="false">abc-1</guid></item></channel></rss>`;
  assert.deepEqual(rssCoz(guid, K).map((x) => x.link), ['https://g.example/1']);
});

// Görev 23 (G24 küçüğü): bazı yayıncılar etiketleri büyük harfle ya da karışık yazar (<ITEM>, <Title>, <PubDate>; ECB/TCMB'de <cube>).
// Etiket eşleşmesi büyük/küçük harf duyarsız; içerik (başlık) olduğu gibi kalır (Türkçe "İ" uzunluğu bozmaz).
test('etiket eşleşmesi büyük/küçük harf duyarsız: <ITEM>/<Title>/<PubDate>, Atom <ENTRY><LINK>, ECB <cube>, TCMB <currency>', () => {
  const rss = `<RSS><CHANNEL><ITEM><TITLE>İzmir’de BÜYÜK fuar</TITLE><LINK>https://b.example/1</LINK><PUBDATE>Sun, 25 Oct 2026 10:00:00 +0000</PUBDATE></ITEM>
    <Item><Title>Karışık yazım</Title><Link>https://b.example/2</Link></Item></CHANNEL></RSS>`;
  assert.deepEqual(rssCoz(rss, K).map((x) => [x.baslik, x.link, x.zaman ?? null]), [
    ['İzmir’de BÜYÜK fuar', 'https://b.example/1', '2026-10-25T10:00:00.000Z'],
    ['Karışık yazım', 'https://b.example/2', null],
  ]);
  const atom = `<FEED><ENTRY><TITLE>Atom büyük</TITLE><LINK REL="alternate" HREF="https://b.example/a"/></ENTRY></FEED>`;
  assert.deepEqual(rssCoz(atom, K).map((x) => x.link), ['https://b.example/a']);
  const ecb = `<cube><cube time='2026-10-23'><cube currency='USD' rate='1.16'/><cube currency='TRY' rate='49.3'/></cube></cube>`;
  assert.deepEqual(ecbCoz(ecb).map((g) => [g.tarih, g.oranlar.USD, g.oranlar.TRY]), [['2026-10-23', 1.16, 49.3]]);
  const tcmb = `<tarih_date Date="10/23/2026"><currency Kod="USD"><unit>1</unit><forexselling>49.65</forexselling></currency></tarih_date>`;
  assert.deepEqual(tcmbCoz(tcmb), { tarih: '2026-10-23', kurlar: { USD: 49.65 } });
});

test('bozuk girdi istisna fırlatmaz; en çok 20 haber; aynı haber bir kez', () => {
  assert.deepEqual(rssCoz('', K), []);
  assert.deepEqual(rssCoz('<html><body>404</body></html>', K), []);
  assert.deepEqual(rssCoz(undefined as unknown as string, K), []);
  const cok = `<rss><channel>${Array.from({ length: 30 }, (_, i) => `<item><title>H${i}</title><link>https://h.example/${i}</link></item>`).join('')}<item><title>H0</title><link>https://h.example/0</link></item></channel></rss>`;
  assert.equal(rssCoz(cok, K).length, 20);
  assert.equal(varliklariCoz('&#x130;stanbul &#304;zmir &bilinmez;'), 'İstanbul İzmir &bilinmez;');
  assert.equal(duzMetin('  a\n\t b <br/> c &amp;amp; d '), 'a b c & d');
  assert.equal(gecerliBaglanti('data:text/html,x'), undefined);
  assert.equal(gecerliBaglanti('https://ok.example/a b'), 'https://ok.example/a%20b');
});

const haber = (id: string, kaynakId: string, baslik: string, dk: number): Haber => ({ id, baslik, link: `https://h.example/${id}`, kaynak: kaynakId.toUpperCase(), kaynakId, zaman: new Date(Date.parse('2026-10-25T18:00:00Z') - dk * 60_000).toISOString() });

test('haberleri birleştir: tekrar (bağlantı ya da başlık) bir kez, yeniler önce, aynı kaynaktan üst üste en çok iki', () => {
  const a = [haber('a1', 'a', 'Bir', 1), haber('a2', 'a', 'İki', 2), haber('a3', 'a', 'Üç', 3), haber('a4', 'a', 'Dört', 4)];
  const b = [haber('b1', 'b', 'Beş', 10), { ...haber('b2', 'b', 'bir!', 11) }];
  const l = haberleriBirlestir([a, b], 40, Date.parse('2026-10-25T18:00:00Z'));
  assert.deepEqual(l.map((x) => x.id), ['a1', 'a2', 'b1', 'a3', 'a4'], 'başlığı aynı ("Bir" / "bir!") olan atılır; a3 b1\'den sonra');
  // Gelecekteki zaman şimdiye çekilir.
  const ileri = haberleriBirlestir([[haber('x', 'x', 'Gelecek', -600)]], 40, Date.parse('2026-10-25T18:00:00Z'));
  assert.equal(ileri[0].zaman, '2026-10-25T18:00:00.000Z');
});

test('gündem konuları: birden çok kaynakta geçen özel adlar; iki sözcüklü ad tekliyi yutar; ülke ve kaynak adları sayılmaz; ekler atılır', () => {
  const l = [
    haber('1', 'trt', 'Merkez Bankası faizi sabit tuttu', 1), haber('2', 'bbc', 'Merkez Bankası kararının ardından piyasalar', 2),
    haber('3', 'dw', 'Merkez Bankası’nın yeni hamlesi', 3), haber('4', 'ntv', 'Galatasaray’ın rakibi belli oldu', 4),
    haber('5', 'trt', 'Galatasaray Avrupa’da tur atladı', 5), haber('6', 'ntv', 'Türkiye’de kış lastiği dönemi', 6),
    haber('7', 'bbc', 'Türkiye ile AB arasında yeni tur', 7), haber('8', 'dw', 'AB bakanları toplandı', 8), haber('9', 'trt', 'Son dakika: deprem', 9),
  ];
  const k = konulariCikar(l, ['Türkiye', 'İstanbul']);
  const adlar = k.map((x) => x.ad);
  assert.equal(adlar[0], 'Merkez Bankası');
  assert.equal(k[0].kaynakSayisi, 3);
  assert.equal(k[0].ornek.id, '1', 'en yeni başlık örnek');
  assert.ok(adlar.includes('Galatasaray'), JSON.stringify(adlar));
  assert.ok(adlar.includes('AB'), 'kısaltma (2 harf) konu olabilir');
  for (const yok of ['Türkiye', 'Merkez', 'Bankası', 'Son', 'TRT', 'NTV', 'BBC']) assert.ok(!adlar.includes(yok), `${yok} konu sayıldı: ${JSON.stringify(adlar)}`);
  assert.deepEqual(konulariCikar([], []), []);
});

// ── MET Norway ──
function met(simdi: number) {
  const ts = Array.from({ length: 40 }, (_, i) => {
    const t = new Date(simdi - 20 * 60_000 + i * 3600_000);
    t.setUTCMinutes(0, 0, 0);
    return { time: t.toISOString(), data: { instant: { details: { air_temperature: 10 + (i % 24) / 2, wind_speed: 3, relative_humidity: 70 } }, next_1_hours: { summary: { symbol_code: i < 5 ? 'rain' : 'clearsky_day' }, details: { precipitation_amount: i < 5 ? 0.5 : 0 } }, next_6_hours: { summary: { symbol_code: 'partlycloudy_day' } } } };
  });
  return { type: 'Feature', properties: { meta: { updated_at: '2026-10-25T08:00:00Z' }, timeseries: ts } };
}

test('MET: şimdiki hava, bugünün en yükseği/düşüğü ve yağışı, 6 saatlik, sonraki günler (şehrin saat diliminde)', () => {
  const simdi = Date.parse('2026-10-25T09:20:00Z'); // İstanbul 12:20
  const h = metCoz(met(simdi), 'Europe/Istanbul', simdi)!;
  assert.ok(h);
  assert.equal(h.guncelleme, '2026-10-25T08:00:00.000Z');
  assert.equal(h.simdi.simge, 'rain');
  assert.equal(h.simdi.ruzgar, 3);
  assert.equal(h.saatlik.length, 6);
  assert.ok(h.bugun.enYuksek >= h.bugun.enDusuk);
  assert.ok(h.bugun.yagis > 0);
  assert.ok(h.gunluk.length >= 1 && h.gunluk.every((g) => g.gun > '2026-10-25'));
});

test('MET: bozuk yanıt → null (istisna yok); sıcaklığı olmayan kayıtlar atlanır', () => {
  for (const b of [null, {}, { properties: {} }, { properties: { timeseries: 'x' } }, { properties: { timeseries: [{ time: 'kötü' }] } }]) assert.equal(metCoz(b, 'Europe/Istanbul'), null);
  const tek = { properties: { timeseries: [{ time: '2026-10-25T09:00:00Z', data: { instant: { details: { air_temperature: 7.6 } } } }] } };
  const h = metCoz(tek, 'Europe/Istanbul', Date.parse('2026-10-25T09:10:00Z'))!;
  assert.equal(h.simdi.sicaklik, 8);
  assert.equal(h.simdi.simge, 'cloudy');
  assert.deepEqual(h.saatlik, []);
});

// ── Kurlar ──
const ECB = `<?xml version="1.0" encoding="UTF-8"?><gesmes:Envelope><gesmes:subject>Reference rates</gesmes:subject><Cube>
  <Cube time='2026-10-23'><Cube currency='USD' rate='1.1600'/><Cube currency='GBP' rate='0.8700'/><Cube currency='CHF' rate='0.9300'/><Cube currency='TRY' rate='49.3000'/></Cube>
  <Cube time="2026-10-22"><Cube currency="USD" rate="1.1500"/><Cube currency="GBP" rate="0.8650"/><Cube currency="TRY" rate="49.0000"/></Cube>
</Cube></gesmes:Envelope>`;

test('ECB: günler eskiden yeniye; TRY karşılığı çapraz kur (EUR tabanından), önceki güne göre değişim', () => {
  const g = ecbCoz(ECB);
  assert.deepEqual(g.map((x) => x.tarih), ['2026-10-22', '2026-10-23']);
  const p = ecbPiyasa(g, 'TRY')!;
  assert.equal(p.tarih, '2026-10-23');
  assert.deepEqual(p.kurlar.map((k) => k.kod), ['USD', 'EUR', 'GBP']);
  const usd = p.kurlar[0];
  assert.ok(Math.abs(usd.deger - 49.3 / 1.16) < 1e-9);
  assert.ok(Math.abs(usd.degisim! - ((49.3 / 1.16 - 49 / 1.15) / (49 / 1.15)) * 100) < 1e-9);
  assert.equal(p.kurlar[1].deger, 49.3, 'EUR doğrudan');
  // Avro bölgesinde yerel EUR: 1 USD = 1/1.16 EUR.
  const e = ecbPiyasa(g, 'EUR')!;
  assert.deepEqual(e.kurlar.map((k) => k.kod), ['USD', 'GBP', 'CHF']);
  assert.ok(Math.abs(e.kurlar[0].deger - 1 / 1.16) < 1e-9);
  assert.equal(ecbPiyasa([], 'TRY'), null);
  assert.deepEqual(ecbCoz('<html/>'), []);
});

test('TCMB today.xml: tarih, döviz satış kuru (Unit\'e bölünür), kart verisi', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Tarih_Date Tarih="23.10.2026" Date="10/23/2026"  Bulten_No="2026/201" >
    <Currency CrossOrder="0" Kod="USD" CurrencyCode="USD"><Unit>1</Unit><Isim>ABD DOLARI</Isim><ForexBuying>49.5647</ForexBuying><ForexSelling>49.6540</ForexSelling></Currency>
    <Currency CrossOrder="9" Kod="EUR" CurrencyCode="EUR"><Unit>1</Unit><ForexSelling>55.5997</ForexSelling></Currency>
    <Currency CrossOrder="10" Kod="JPY" CurrencyCode="JPY"><Unit>100</Unit><ForexSelling>32.10</ForexSelling></Currency>
    <Currency Kod="XDR" CurrencyCode="XDR"><Unit>1</Unit><ForexSelling></ForexSelling></Currency></Tarih_Date>`;
  const t = tcmbCoz(xml)!;
  assert.equal(t.tarih, '2026-10-23');
  assert.equal(t.kurlar.USD, 49.654);
  assert.ok(Math.abs(t.kurlar.JPY - 0.321) < 1e-12);
  assert.equal(t.kurlar.XDR, undefined);
  const p = tcmbPiyasa(t)!;
  assert.deepEqual(p.kurlar.map((k) => k.kod), ['USD', 'EUR']);
  assert.equal(p.kaynak, 'tcmb');
  assert.equal(tcmbCoz('bozuk'), null);
});
