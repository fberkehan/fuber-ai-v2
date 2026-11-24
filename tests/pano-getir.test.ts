// Pano ağ katmanı ve çözücülerin dayanıklılığı (Görev 24 düzeltme turu 1): kötü niyetli ya da bozuk bir akış ana süreci donduramaz.
// (1) Gövde boyut sınırı akarken uygulanır: Content-Length büyükse hiç okunmaz; Content-Length'siz (chunked) ve gzip bombası açılmış
// baytta kesilir. (2) Zaman aşımı gövdenin okunmasını da kapsar. (3) 3 MB'lık patolojik akışlar (kapanmamış öğe, yinelenen açılış,
// "<<<" başlıklar, ECB/TCMB'de yinelenen açılış) DOĞRUSAL sürede çözülür (G12a: eskiden "200 ms altında" mutlak eşiğiydi, makine
// yükteyken düşüyordu; artık yarım/tam boyut oranı + 600 ms mutlak tavan; G12b). Ağ YOK: yalnız 127.0.0.1. src/main/pano/getir.ts,
// src/shared/pano-cozucu.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import { metinGetir, BoyutHatasi, EN_COK_BAYT } from '../src/main/pano/getir.ts';
import { rssCoz, ecbCoz, tcmbCoz, metCoz, duzMetin } from '../src/shared/pano-cozucu.ts';

const MB3 = 3_000_000;

async function sunucu(isle: (q: http.IncomingMessage, r: http.ServerResponse) => void) {
  const s = http.createServer(isle);
  await new Promise<void>((c) => s.listen(0, '127.0.0.1', c));
  return { kok: `http://127.0.0.1:${(s.address() as { port: number }).port}`, kapat: () => new Promise<void>((c) => { s.closeAllConnections(); s.close(() => c()); }) };
}
const g = (enCokBayt = 64_000, zamanAsimiMs = 3000) => ({ getir: (u: string, i?: RequestInit) => fetch(u, i), ua: 'FuberAI/test', enCokBayt, zamanAsimiMs });

test('boyut sınırı: Content-Length sınırın üstündeyse gövde okunmadan BoyutHatasi', async () => {
  let yazilan = 0;
  const s = await sunucu((_q, r) => {
    r.writeHead(200, { 'content-type': 'text/xml', 'content-length': String(10_000_000) });
    const parca = Buffer.alloc(64 * 1024, 0x61);
    const yaz = () => { while (yazilan < 10_000_000 && r.write(parca)) yazilan += parca.length; if (yazilan < 10_000_000) r.once('drain', yaz); else r.end(); };
    r.on('close', () => undefined);
    yaz();
  });
  try {
    await assert.rejects(metinGetir(g(), `${s.kok}/x`), BoyutHatasi);
  } finally { await s.kapat(); }
  assert.ok(yazilan < 10_000_000, 'gövdenin hepsi gönderilmedi (okuma kesildi)');
});

test('boyut sınırı: Content-Length yokken (chunked) sınır aşılınca okuma kesilir; sınırın altındaki yanıt tam okunur', async () => {
  let kapandi = false;
  const s = await sunucu((q, r) => {
    r.writeHead(200, { 'content-type': 'text/xml' }); // uzunluk yok → chunked
    if (q.url === '/kucuk') { r.end('<rss>tamam</rss>'); return; }
    const parca = Buffer.alloc(16 * 1024, 0x62);
    const z = setInterval(() => { if (!r.write(parca)) return; }, 1);
    r.on('close', () => { kapandi = true; clearInterval(z); });
  });
  try {
    assert.equal(await metinGetir(g(), `${s.kok}/kucuk`), '<rss>tamam</rss>');
    const t0 = performance.now();
    await assert.rejects(metinGetir(g(64_000), `${s.kok}/sonsuz`), BoyutHatasi);
    assert.ok(performance.now() - t0 < 2000, 'sonsuz akış beklenmedi');
    for (let i = 0; i < 50 && !kapandi; i++) await new Promise((c) => setTimeout(c, 20));
    assert.equal(kapandi, true, 'bağlantı kapatıldı (akış iptal)');
  } finally { await s.kapat(); }
});

test('boyut sınırı: gzip bombası (küçük sıkıştırılmış, 20 MB açılmış) açılmış baytta kesilir', async () => {
  const bomba = zlib.gzipSync(Buffer.alloc(20_000_000, 0x20));
  assert.ok(bomba.length < 100_000);
  const s = await sunucu((_q, r) => { r.writeHead(200, { 'content-type': 'text/xml', 'content-encoding': 'gzip', 'content-length': String(bomba.length) }); r.end(bomba); });
  try {
    const t0 = performance.now();
    await assert.rejects(metinGetir(g(EN_COK_BAYT), `${s.kok}/bomba`), BoyutHatasi);
    assert.ok(performance.now() - t0 < 3000);
  } finally { await s.kapat(); }
});

test('zaman aşımı: başlıkları gönderip gövdede takılan sunucu süre dolunca bırakılır (gövde okuması da kapsanır)', async () => {
  const s = await sunucu((q, r) => {
    if (q.url === '/hic') return; // hiç yanıt yok
    r.writeHead(200, { 'content-type': 'text/xml' });
    r.write('<rss><channel>'); // sonra sessizlik
  });
  try {
    for (const yol of ['/hic', '/yarim']) {
      const t0 = performance.now();
      await assert.rejects(metinGetir(g(64_000, 300), `${s.kok}${yol}`));
      const sure = performance.now() - t0;
      assert.ok(sure >= 250 && sure < 2000, `${yol}: ${Math.round(sure)} ms`);
    }
  } finally { await s.kapat(); }
});

// Görev 23 (G24 küçüğü): Electron'un net.fetch'inde gövdeyi iptal etmek isteği kesmez — sınır aşılınca İSTEĞİN sinyali de kesilmeli
// (eskiden yalnız 8 sn'lik zaman aşımı kesiyordu: bağlantı ve indirme o kadar sürüyordu). Sahte getirici net.fetch gibi davranır:
// gövde iptalini yok sayar, yalnız sinyal kesilince durur.
test('boyut sınırı aşılınca isteğin sinyali hemen kesilir (net.fetch gibi gövde iptalini yok sayan getiricide de)', async () => {
  let sinyal: AbortSignal | undefined;
  let uretilen = 0;
  const getir = async (_u: string, i?: { signal?: AbortSignal }) => {
    sinyal = i?.signal;
    const govde = new ReadableStream<Uint8Array>({
      pull(k) { if (sinyal?.aborted) { k.close(); return; } uretilen++; k.enqueue(new Uint8Array(16_384).fill(0x61)); },
      cancel() { /* net.fetch: gövde iptali isteği kesmez */ },
    });
    return new Response(govde, { headers: { 'content-type': 'text/xml' } });
  };
  const t0 = performance.now();
  await assert.rejects(metinGetir({ getir, ua: 'FuberAI/test', enCokBayt: 64_000, zamanAsimiMs: 8000 }, 'https://haber.example/rss'), BoyutHatasi);
  assert.ok(performance.now() - t0 < 1000, 'zaman aşımı beklenmedi');
  assert.equal(sinyal?.aborted, true, 'isteğin sinyali kesilmedi (yalnız gövde iptal edildi)');
  assert.ok(uretilen < 20, `${uretilen} parça üretildi`);
});

// ── Büyüme sınaması (G12a): duvar saati eşiği yerine ÖLÇEK ORANI ──────────────────────────────────────────────────────────────
// Eskiden "3 MB < 200 ms" mutlak eşiğiydi; makine yükteyken (başka süreçler CPU'yu paylaşırken) doğru çözücü de eşiği aşıp düşüyordu.
// Yakalanması gereken hata sınıfı kuadratik yavaşlamadır: girdi iki katına çıkınca süre ≈ 4× olur (doğrusalda ≈ 2×). Artık aynı iş
// yarım ve tam boyutta ölçülür, ORAN sınanır. Yük iki ölçümü aynı oranda uzatır ama sıçramalar ölçümü bozar (çöp toplama ve bellek
// baskısı büyük girdide orantısız şişer: 32 çekirdekli makinede 48 CPU doyurucuyla tek turun oranı 0,5…7 arası çıktı). Bu yüzden:
// (1) ölçümler birbirine KARIŞTIRILIR (yarım, tam, yarım, tam…) ve her boyutun EN KÜÇÜK süresi alınır (yük süreyi yalnız UZATIR);
// (2) bir tur doğrusal çıkmazsa en çok `DENEME` tur daha denenir, TEK doğrusal tur yeter. Gerçek kuadratik yavaşlama her turda ≈ 4×
// çıkar (sessiz makinede sınır 3× + 10 ms'yi her tur aşar → yakalanır); yük kaynaklı şişkinlik rastgeledir, bir turda dağılır.
const ORAN_SINIRI = 3; // doğrusal ≈ 2, kuadratik ≈ 4 → ortası
const PAY_MS = 10; // zamanlayıcı/GC titremesi payı: kuadratik yavaşlama yarım boyutta ≥ ~10 ms'e ulaşan her işte yakalanır
const TAKILMA_MS = 3000; // yarım boyutun kendisi bu kadar sürüyorsa (kuadratik patlama) tam boyut hiç denenmez
const DENEME = 6;
// Oran yalnız BÜYÜMEYİ yakalar; "doğrusal ama devasa sabitli" bozulmayı (ör. her '<' için 500 karakter ileri bakan düzenli ifade: 3 MB'ta
// ≈ saniyeler) göremez. Onu mutlak tavan yakalar: eski 200 ms'nin 3 katı (sessiz makinede en yavaş vaka ≈ 80 ms; 48 CPU doyurucuyla
// ≈ 400 ms görüldü) → yükte yanlış alarm vermez, saniyeler süren bozulmayı kaçırmaz. 0.11 G12b (inceleme kalanı): 1500 → 600 ms —
// 1,5 sn "saniyeler süren" bozulmaya bile geniş payla yer bırakıyordu; oran testi (yukarısı) kuadratik büyümeyi zaten yakalar.
const MUTLAK_TAVAN_MS = 600;

interface Olcum { yarim: number; tam: number }
const dogrusalMi = (o: Olcum) => o.tam <= ORAN_SINIRI * o.yarim + PAY_MS;
const fazlasi = (o: Olcum) => o.tam - (ORAN_SINIRI * o.yarim + PAY_MS); // ≤ 0: doğrusal
const ozetle = (o: Olcum) => `yarım ${o.yarim.toFixed(1)} ms → tam ${o.tam.toFixed(1)} ms (oran ${(o.tam / o.yarim).toFixed(2)}; sınır ${ORAN_SINIRI}× + ${PAY_MS} ms)`;

/** Aynı işin yarım ve tam boyutu için en küçük süreler (ms); ilk doğrusal tur ya da hiçbiri doğrusal değilse en iyi tur. `saat` sınanabilirlik için. */
function buyume(yarim: () => unknown, tam: () => unknown, o: { saat?: () => number; tur?: number; deneme?: number } = {}): Olcum {
  const saat = o.saat ?? (() => performance.now());
  let t0 = saat();
  yarim();
  const ilk = saat() - t0; // aynı zamanda ısınma
  if (ilk > TAKILMA_MS) return { yarim: ilk, tam: Number.POSITIVE_INFINITY };
  tam();
  let enIyi: Olcum | null = null;
  for (let d = 0; d < (o.deneme ?? DENEME); d++) {
    let y = Number.POSITIVE_INFINITY;
    let t = Number.POSITIVE_INFINITY;
    for (let i = 0; i < (o.tur ?? 3); i++) {
      t0 = saat(); yarim(); y = Math.min(y, saat() - t0);
      t0 = saat(); tam(); t = Math.min(t, saat() - t0);
    }
    const tur: Olcum = { yarim: y, tam: t };
    if (enIyi === null || fazlasi(tur) < fazlasi(enIyi)) enIyi = tur;
    if (dogrusalMi(tur)) break;
  }
  return enIyi as Olcum;
}

test('büyüme ölçümü (sanal saatle, yükten bağımsız): doğrusal iş geçer; kuadratik ve takılan iş yakalanır; yük sıçraması yanıltmaz', () => {
  let sanal = 0;
  const saat = () => sanal;
  const is = (maliyet: (n: number) => number, n: number, sicrama = (_k: number) => 0) => { let k = 0; return () => { sanal += maliyet(n) + sicrama(k++); }; };
  const dogrusal = (x: number) => x / 1e5; // 1e6 → 10 ms, 2e6 → 20 ms
  const kuadratik = (x: number) => (x * x) / 4e10; // 1e6 → 25 ms, 2e6 → 100 ms
  const d = buyume(is(dogrusal, 1e6), is(dogrusal, 2e6), { saat });
  assert.ok(dogrusalMi(d), `doğrusal iş yakalanmamalı: ${ozetle(d)}`);
  const k = buyume(is(kuadratik, 1e6), is(kuadratik, 2e6), { saat });
  assert.ok(!dogrusalMi(k), `kuadratik iş yakalanmalı: ${ozetle(k)}`);
  assert.deepEqual([k.yarim, k.tam], [25, 100]);
  const takilan = buyume(is(() => 5000, 1), is(() => 5000, 2), { saat });
  assert.equal(takilan.tam, Number.POSITIVE_INFINITY);
  assert.ok(!dogrusalMi(takilan), 'yarım boyutta bile takılan iş yakalanır');
  // Yük: her 3. çağrıda 400 ms'lik sıçrama → en küçük ölçüm sıçramayı atlar; doğrusal iş yine geçer, kuadratik yine yakalanır.
  const sicrama = (k2: number) => (k2 % 3 === 1 ? 400 : 0);
  const dy = buyume(is(dogrusal, 1e6, sicrama), is(dogrusal, 2e6, sicrama), { saat });
  assert.ok(dogrusalMi(dy), `sıçramalı doğrusal iş: ${ozetle(dy)}`);
  const ky = buyume(is(kuadratik, 1e6, sicrama), is(kuadratik, 2e6, sicrama), { saat });
  assert.ok(!dogrusalMi(ky), `sıçramalı kuadratik iş: ${ozetle(ky)}`);
  // Yük, büyük girdide ilk turları şişirir (çöp toplama/bellek): sonraki tur temizse doğrusal iş geçer.
  let cagri = 0;
  const sisen = () => { sanal += dogrusal(2e6) * (cagri++ < 8 ? 6 : 1); };
  const s = buyume(is(dogrusal, 1e6), sisen, { saat });
  assert.ok(dogrusalMi(s), `ilk turları şişen doğrusal iş: ${ozetle(s)}`);
});

const K = { id: 'x', ad: 'X' };
/** Girdi `boyut` karaktere dek `tekrar`la doldurulur (girdi ölçüm DIŞINDA kurulur: ölçülen yalnız çözücüdür). */
const doldur = (boyut: number, bas: string, tekrar: string, son = '') => bas + tekrar.repeat(Math.ceil((boyut - bas.length - son.length) / tekrar.length)) + son;
/** Patolojik akış vakaları: [ad, boyut → çözülecek iş]. Girdi boyut verildiğinde ÖNCEDEN kurulur, dönen işlev yalnız çözer. */
const PATOLOJIK: [string, (boyut: number) => () => unknown][] = [
  ['kapanmamış <item>', (b) => { const g = doldur(b, '<rss><channel>', '<item><title>a'); return () => rssCoz(g, K); }],
  ['kapanmamış <entry>', (b) => { const g = doldur(b, '<feed>', '<entry><link href="https://a.example/'); return () => rssCoz(g, K); }],
  ['yinelenen <title açılışı', (b) => { const g = doldur(b, '<rss><item>', '<title', '</item></rss>'); return () => rssCoz(g, K); }],
  ['yinelenen <title> kapanışsız', (b) => { const g = doldur(b, '<rss><item>', '<title>x', '</item></rss>'); return () => rssCoz(g, K); }],
  ['"<<<" başlıklı 200+ öğe', (b) => { const g = doldur(b, '<rss>', `<item><title>${'<'.repeat(5000)}</title></item>`); return () => rssCoz(g, K); }],
  ['"<a" başlıklı öğeler', (b) => { const g = doldur(b, '<rss>', `<item><title>${'<a '.repeat(3000)}</title><link>https://a.example/</link></item>`); return () => rssCoz(g, K); }],
  ['varlık yağmuru', (b) => { const g = doldur(b, '<rss>', `<item><title>${'&#'.repeat(3000)}&amp;</title><link>https://a.example/</link></item>`); return () => rssCoz(g, K); }],
  ['Atom: tek öğede yinelenen <link', (b) => { const g = doldur(b, '<feed><entry><title>t</title>', '<link rel="x" ', '</entry></feed>'); return () => rssCoz(g, K); }],
  ['ECB: yinelenen <Cube time', (b) => { const g = doldur(b, '<Cube>', "<Cube time='2026-10-22'>"); return () => ecbCoz(g); }],
  ['ECB: yinelenen <Cube (time yok)', (b) => { const g = doldur(b, '<Cube>', '<Cube x>'); return () => ecbCoz(g); }],
  ['ECB: öznitelik yağmuru', (b) => { const g = doldur(b, '<Cube time=\'2026-10-22\'>', " currency='USD' rate=", '></Cube>'); return () => ecbCoz(g); }],
  ['TCMB: yinelenen <Currency>', (b) => { const g = doldur(b, '<Tarih_Date Date="10/23/2026">', '<Currency Kod="USD"><ForexSelling>1'); return () => tcmbCoz(g); }],
  ['TCMB: kapanışlı 100+ para birimi', (b) => { const g = doldur(b, '<Tarih_Date Date="10/23/2026">', '<Currency Kod="USD"><ForexSelling>1</ForexSelling></Currency>'); return () => tcmbCoz(g); }],
  ['MET: zaman serisi', (b) => {
    const veri = { properties: { timeseries: Array.from({ length: Math.round(b / 100) }, (_, i) => ({ time: new Date(Date.UTC(2026, 9, 25) + i * 3600_000).toISOString(), data: { instant: { details: { air_temperature: 1 } } } })) } };
    return () => metCoz(veri, 'Europe/Istanbul', Date.UTC(2026, 9, 25));
  }],
];

test('3 MB patolojik akışlar doğrusal sürede çözülür (boyut ikiye katlanınca süre ≈ 2×, kuadratik ≈ 4× olurdu) ve istisna fırlatmaz', { timeout: 300_000 }, () => { // zaman aşımı yalnız takılma bekçisi
  for (const [ad, kur] of PATOLOJIK) {
    const o = buyume(kur(MB3 / 2), kur(MB3)); // çözücü istisna fırlatırsa test burada düşer
    assert.ok(dogrusalMi(o), `${ad}: ${ozetle(o)}`);
    assert.ok(o.tam < MUTLAK_TAVAN_MS, `${ad}: 3 MB ${o.tam.toFixed(0)} ms (mutlak tavan ${MUTLAK_TAVAN_MS} ms)`);
  }
});

test('düz metin: etiket ayıklama doğrusal ve eski davranışla aynı (500 karakterden uzun "etiket" metin sayılır)', () => {
  assert.equal(duzMetin('a <b>kalın</b> c'), 'a kalın c');
  assert.equal(duzMetin('x <a<b> y'), 'x y');
  assert.equal(duzMetin('2 < 3 ve 5 > 4'), '2 4');
  const uzun = `<${'z'.repeat(600)}>son`;
  assert.equal(duzMetin(uzun), uzun.replace(/\s+/g, ' ').trim());
  assert.equal(duzMetin('&lt;b&gt;kodlanmış&lt;/b&gt;'), 'kodlanmış');
  // G12a: tek ölçüm yerine 7 ölçümün EN KÜÇÜĞÜ (yük süreyi yalnız uzatır; sıçrama en küçüğü bozmaz). duzMetin girdiyi kırptığı için
  // (ALAN_EN_COK * 2) boyut oranı anlamsız: doğrusal çözücü ≈ 0,01 ms, eski kuadratik düzenli ifade ≥ 10 ms'ydi → 20 ms sınırı kalır.
  const girdi = '<'.repeat(4000);
  const sureler = Array.from({ length: 7 }, () => { const t0 = performance.now(); duzMetin(girdi); return performance.now() - t0; });
  assert.ok(Math.min(...sureler) < 20, `düz metin "<" yağmuru: en küçük ${Math.min(...sureler).toFixed(2)} ms`);
});
