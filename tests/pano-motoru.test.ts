// Pano önbelleği ve motoru (Görev 24): tazelik süreleri (MET Expires sınırları), dosyaya kalıcılık, kapalı kaynağa istek yok, tazeyken
// yeniden istek yok, çevrimdışında son veri yaşıyla + geri çekilme, 304 (If-Modified-Since), kimlikli User-Agent, ağ yokken hiç istek.
// Ağ YOK: yalnız 127.0.0.1'deki sahte sunucu. src/main/pano/{onbellek,getir,pano-motoru}.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { PanoOnbellek, tazelikSonu } from '../src/main/pano/onbellek.ts';
import { PanoMotoru, sahteTabanlar } from '../src/main/pano/pano-motoru.ts';
import { PANO_VARSAYILAN, type PanoAyari, type PanoDurumu } from '../src/shared/pano.ts';

test('önbellek: anahtar tutmazsa yok; tazelik (haber 15 dk, kur 1 sa, hava Expires 30 dk–2 sa); dosyaya yazılır, yeniden okunur', () => {
  const dosya = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pano-ob-')), 'pano-onbellek.json');
  const o = new PanoOnbellek(dosya);
  const t0 = Date.parse('2026-10-25T10:00:00Z');
  o.yaz('haberler', { anahtar: 'TR', zaman: new Date(t0).toISOString(), veri: [1] });
  assert.equal(o.oku('haberler', 'DE'), undefined);
  assert.deepEqual(o.oku('haberler', 'TR')?.veri, [1]);
  assert.equal(o.tazeMi('haberler', 'TR', t0 + 14 * 60_000), true);
  assert.equal(o.tazeMi('haberler', 'TR', t0 + 16 * 60_000), false);
  const z = new Date(t0).toISOString();
  assert.equal(tazelikSonu('piyasa', { zaman: z }), t0 + 3600_000);
  assert.equal(tazelikSonu('hava', { zaman: z, bitis: t0 + 5 * 60_000 }), t0 + 30 * 60_000, 'Expires çok yakın: en az 30 dk');
  assert.equal(tazelikSonu('hava', { zaman: z, bitis: t0 + 50 * 60_000 }), t0 + 50 * 60_000);
  assert.equal(tazelikSonu('hava', { zaman: z, bitis: t0 + 9 * 3600_000 }), t0 + 2 * 3600_000, 'en çok 2 sa');
  const yeniden = new PanoOnbellek(dosya);
  assert.deepEqual(yeniden.oku('haberler', 'TR')?.veri, [1]);
  fs.writeFileSync(dosya, '{bozuk'); fs.rmSync(`${dosya}.bak`, { force: true });
  assert.equal(new PanoOnbellek(dosya).oku('haberler', 'TR'), undefined, 'bozuk dosya: boş önbellek, istisna yok');
});

// ── Sahte sunucu ──
type Istek = { yol: string; ara: string; ua: string; ims?: string };
async function sunucuAc() {
  const istekler: Istek[] = [];
  const durum = { kapali: false, degismedi: false };
  const metZaman = Array.from({ length: 30 }, (_, i) => ({ time: new Date(Date.now() + (i - 1) * 3600_000).toISOString().slice(0, 13) + ':00:00Z', data: { instant: { details: { air_temperature: 12 + i * 0.1 } }, next_1_hours: { summary: { symbol_code: 'cloudy' } } } }));
  const s = http.createServer((q, r) => {
    const u = new URL(q.url!, 'http://x');
    istekler.push({ yol: u.pathname, ara: u.search, ua: String(q.headers['user-agent'] ?? ''), ims: q.headers['if-modified-since'] as string | undefined });
    if (durum.kapali) { r.writeHead(503); r.end(); return; }
    if (u.pathname === '/hava') {
      if (durum.degismedi && q.headers['if-modified-since']) { r.writeHead(304, { expires: new Date(Date.now() + 40 * 60_000).toUTCString() }); r.end(); return; }
      r.writeHead(200, { 'content-type': 'application/json', expires: new Date(Date.now() + 40 * 60_000).toUTCString(), 'last-modified': 'Sun, 25 Oct 2026 08:00:00 GMT' });
      r.end(JSON.stringify({ properties: { meta: { updated_at: '2026-10-25T08:00:00Z' }, timeseries: metZaman } }));
      return;
    }
    if (u.pathname.startsWith('/haber/')) {
      const id = decodeURIComponent(u.pathname.slice(7));
      r.writeHead(200, { 'content-type': 'application/rss+xml' });
      r.end(`<rss><channel><item><title>${id} Merkez Bankası haberi</title><link>https://h.example/${id}</link><pubDate>${new Date().toUTCString()}</pubDate></item><item><title>${id} Galatasaray kazandı</title><link>https://h.example/${id}/2</link></item></channel></rss>`);
      return;
    }
    if (u.pathname === '/kur/ecb') {
      // Sıkıştırılmış yanıt (gerçek sunucular gzip döner): getirici kendisi açmalı.
      r.writeHead(200, { 'content-encoding': 'gzip', 'content-type': 'text/xml' });
      r.end(zlib.gzipSync(`<Cube><Cube time='2026-10-22'><Cube currency='USD' rate='1.15'/><Cube currency='TRY' rate='49'/></Cube><Cube time='2026-10-23'><Cube currency='USD' rate='1.16'/><Cube currency='TRY' rate='49.3'/></Cube></Cube>`));
      return;
    }
    r.writeHead(404); r.end();
  });
  await new Promise<void>((c) => s.listen(0, '127.0.0.1', c));
  return { istekler, durum, kok: `http://127.0.0.1:${(s.address() as { port: number }).port}`, kapat: () => new Promise<void>((c) => s.close(() => c())) };
}

function motorKur(kok: string | null, ayar: Partial<PanoAyari> = {}, saat = { t: Date.now() }, gizli?: () => boolean) {
  let son: PanoDurumu | null = null;
  const bekleyenler: (() => void)[] = [];
  const m = new PanoMotoru({
    ...(gizli ? { gizli } : {}),
    ayar: () => ({ ...PANO_VARSAYILAN, ...ayar }),
    saatDilimi: () => 'Europe/Istanbul', dil: () => 'tr-TR',
    getir: kok ? (url, init) => fetch(url, init) : null,
    tabanlar: kok ? sahteTabanlar(kok) : null,
    ua: 'FuberAI/0.9.0 (+https://fuber.ai)',
    onbellek: new PanoOnbellek(null),
    degisti: (d) => { son = d; bekleyenler.splice(0).forEach((f) => f()); },
    simdi: () => saat.t,
    zamanAsimiMs: 3000,
  });
  /** Bütün süren istekler bitene dek bekler. */
  const sakin = async () => { for (let i = 0; i < 50; i++) { await new Promise((r) => setTimeout(r, 30)); if (!(m as unknown as { suren: Map<string, unknown> }).suren.size) return; } };
  return { m, son: () => son, sakin, saat };
}

test('motor: ilk durum iskelet (yükleniyor), sonra veri; User-Agent kimlikli; koordinat 2 ondalık; tazeyken yeniden istek yok', async () => {
  const s = await sunucuAc();
  try {
    const { m, sakin } = motorKur(s.kok);
    const d0 = m.durum();
    assert.deepEqual([d0.hava.durum, d0.haberler.durum, d0.gundem.durum, d0.piyasa.durum], ['yukleniyor', 'yukleniyor', 'yukleniyor', 'yukleniyor']);
    assert.equal(d0.konum.sehir, 'İstanbul');
    await sakin();
    const d = m.durum();
    assert.equal(d.hava.durum, 'hazir');
    assert.equal(d.hava.veri!.simdi.simge, 'cloudy');
    assert.equal(d.haberler.durum, 'hazir');
    assert.ok(d.haberler.veri!.length >= 5);
    assert.equal(d.gundem.durum, 'hazir');
    assert.ok(d.gundem.veri!.some((k) => k.ad === 'Merkez Bankası'));
    assert.equal(d.piyasa.durum, 'hazir');
    assert.equal(d.piyasa.veri!.yerel, 'TRY');
    assert.ok(s.istekler.every((i) => i.ua === 'FuberAI/0.9.0 (+https://fuber.ai)'));
    assert.deepEqual(s.istekler.filter((i) => i.yol === '/hava').map((i) => i.ara), ['?lat=41.01&lon=28.98']);
    const n = s.istekler.length;
    m.durum(); m.durum();
    await sakin();
    assert.equal(s.istekler.length, n, 'taze kaynak yeniden istenmedi');
  } finally { await s.kapat(); }
});

// F1 (son inceleme K1): Gizli mod açıkken pano AĞA ÇIKMAZ (MET Norway'e konum, haber kaynakları, ECB/TCMB yok): tazeleme de "Şimdi
// yenile" de istek yapmaz; son önbellek `gizli` işaretiyle gösterilir (çevrimdışı sayılmaz); önbellek yoksa kaynak "yok" + `gizli`
// (kart sakin "Gizli modda güncellenmiyor" der). Gizli kapanınca tazeleme kaldığı yerden sürer.
test('K1: Gizli modda pano hiç istek yapmaz; son önbellek "gizli" işaretli; önbellek yoksa "yok" + gizli; Gizli kapanınca tazeler', async () => {
  const s = await sunucuAc();
  try {
    const gizli = { acik: false };
    const saat = { t: Date.now() };
    const { m, sakin } = motorKur(s.kok, { haberler: true, gundem: true, piyasa: true }, saat, () => gizli.acik);
    m.durum(); await sakin();
    assert.equal(m.durum().hava.durum, 'hazir');
    const n = s.istekler.length;
    assert.ok(n >= 3, `Normal modda istekler gitti (${n})`);
    gizli.acik = true;
    saat.t += 3 * 3600_000; // her kaynak bayat: Normal modda tazelenirdi
    const d = m.durum(); await sakin();
    assert.equal(s.istekler.length, n, 'Gizli modda bayat kaynak tazelenmedi');
    const y = await m.yenile(); await sakin();
    assert.equal(s.istekler.length, n, 'Gizli modda "Şimdi yenile" ağa çıkmadı');
    for (const k of [d.hava, d.haberler, d.gundem, d.piyasa, y.hava]) {
      assert.deepEqual([k.durum, k.gizli, k.bayat, k.cevrimdisi], ['hazir', true, true, undefined], JSON.stringify({ ...k, veri: undefined }));
    }
    // Önbelleği olmayan kurulum (Gizli modla başlayan profil): hiç istek yok, kaynaklar "yok" + gizli (iskelet değil).
    const b = motorKur(s.kok, { haberler: true, gundem: true, piyasa: true }, { t: Date.now() }, () => true);
    const d2 = b.m.durum(); await b.sakin(); await b.m.yenile(); await b.sakin();
    for (const k of [d2.hava, d2.haberler, d2.gundem, d2.piyasa]) assert.deepEqual([k.durum, k.gizli], ['yok', true]);
    assert.equal(s.istekler.length, n, 'önbelleksiz Gizli profil de ağa çıkmadı');
    // Kapalı kaynak Gizli'de de "kapali".
    assert.equal(motorKur(s.kok, { piyasa: false }, { t: Date.now() }, () => true).m.durum().piyasa.durum, 'kapali');
    // Gizli kapanınca bayat kaynaklar tazelenir.
    gizli.acik = false;
    m.durum(); await sakin();
    assert.ok(s.istekler.length > n, 'Gizli kapanınca tazeleme sürdü');
    assert.equal(m.durum().hava.gizli, undefined);
  } finally { await s.kapat(); }
});

test('motor: kapalı kaynağa hiç istek gitmez (haberler + gündem kapalıysa akış yok; döviz kapalıysa kur yok)', async () => {
  const s = await sunucuAc();
  try {
    const { m, sakin } = motorKur(s.kok, { haberler: false, gundem: false, piyasa: false });
    const d = m.durum();
    await sakin();
    assert.deepEqual([d.haberler.durum, d.gundem.durum, d.piyasa.durum], ['kapali', 'kapali', 'kapali']);
    assert.deepEqual(s.istekler.map((i) => i.yol), ['/hava']);
    // Yalnız gündem açıksa akışlar istenir ama haber kartı kapalı kalır.
    const g = motorKur(s.kok, { haberler: false, gundem: true, piyasa: false, hava: false });
    g.m.durum();
    await g.sakin();
    const d2 = g.m.durum();
    assert.equal(d2.haberler.durum, 'kapali');
    assert.equal(d2.gundem.durum, 'hazir');
    assert.equal(d2.hava.durum, 'kapali');
  } finally { await s.kapat(); }
});

test('motor: çevrimdışında son veri yaşıyla (bayat + çevrimdışı) ve geri çekilme (hemen yeniden denemez); 304 önbelleği tazeler', async () => {
  const s = await sunucuAc();
  try {
    const saat = { t: Date.now() };
    const { m, sakin } = motorKur(s.kok, { haberler: false, gundem: false, piyasa: false }, saat);
    m.durum(); await sakin();
    assert.equal(m.durum().hava.durum, 'hazir');
    // 3 saat sonra, sunucu kapalı.
    s.durum.kapali = true;
    saat.t += 3 * 3600_000;
    m.durum(); await sakin();
    const d = m.durum();
    assert.equal(d.hava.durum, 'hazir', 'son veri gösterilir');
    assert.equal(d.hava.bayat, true);
    assert.equal(d.hava.cevrimdisi, true);
    const n = s.istekler.length;
    m.durum(); m.durum(); await sakin();
    assert.equal(s.istekler.length, n, 'geri çekilme süresinde yeniden istek yok');
    // 3 dk sonra sunucu döner, 304 (değişmedi): veri korunur, zaman tazelenir, If-Modified-Since gönderildi.
    s.durum.kapali = false; s.durum.degismedi = true;
    saat.t += 3 * 60_000;
    m.durum(); await sakin();
    const son = s.istekler.at(-1)!;
    assert.equal(son.ims, 'Sun, 25 Oct 2026 08:00:00 GMT');
    const d2 = m.durum();
    assert.equal(d2.hava.durum, 'hazir');
    assert.equal(d2.hava.bayat, false);
    assert.equal(d2.hava.cevrimdisi, undefined);
  } finally { await s.kapat(); }
});

test('motor: ağ yokken (demo, sahte sunucu verilmemiş) hiç istek yapılmaz; önbellek yoksa "yok"', () => {
  const { m } = motorKur(null);
  const d = m.durum();
  assert.deepEqual([d.hava.durum, d.haberler.durum, d.gundem.durum, d.piyasa.durum], ['yok', 'yok', 'yok', 'yok']);
});

test('motor: çevrimdışı + önbellek boş — "yukleniyor" yalnız ilk denemede; sonraki her denemede "yok" kalır (titreme yok)', async () => {
  const s = await sunucuAc();
  try {
    s.durum.kapali = true;
    const saat = { t: Date.now() };
    const yayinlar: string[] = [];
    const { m, sakin } = motorKur(s.kok, { gundem: false }, saat);
    const hal = (d: PanoDurumu) => [d.hava.durum, d.haberler.durum, d.piyasa.durum].join('/');
    assert.equal(hal(m.durum()), 'yukleniyor/yukleniyor/yukleniyor', 'ilk deneme: iskelet');
    await sakin();
    assert.equal(hal(m.durum()), 'yok/yok/yok');
    // Geri çekilme süresi dolunca yeniden denenir: istek sürerken de "yok" (iskelete dönüp kaybolmaz).
    for (let tur = 0; tur < 4; tur++) {
      saat.t += 30 * 60_000;
      const n = s.istekler.length;
      const d = m.durum();
      assert.ok(s.istekler.length >= n, 'deneme başladı');
      yayinlar.push(hal(d));
      await sakin();
      yayinlar.push(hal(m.durum()));
    }
    assert.ok(yayinlar.every((h) => h === 'yok/yok/yok'), yayinlar.join(' | '));
    assert.ok(s.istekler.filter((i) => i.yol === '/hava').length >= 5, 'gerçekten yeniden denendi');
  } finally { await s.kapat(); }
});

test('motor: çevrimdışında "Şimdi yenile" de 60 sn içinde ikinci kez ağa çıkmaz (telefondan gelse de)', async () => {
  const s = await sunucuAc();
  try {
    s.durum.kapali = true;
    const saat = { t: Date.now() };
    const { m, sakin } = motorKur(s.kok, { haberler: false, gundem: false, piyasa: false }, saat);
    m.durum(); await sakin();
    const n = s.istekler.length;
    assert.equal(n, 1);
    for (let i = 0; i < 5; i++) { saat.t += 5_000; await m.yenile(); }
    assert.equal(s.istekler.length, n, '60 sn içinde yenileme atlandı (başarısız deneme de sayılır)');
    saat.t += 60_000;
    await m.yenile();
    assert.equal(s.istekler.length, n + 1);
  } finally { await s.kapat(); }
});

test('motor: bozuk önbellek kaydı (haberler [{}], kur dizi değil, hava boş) paneli düşürmez — "yok", gündem "yok"', () => {
  const ob = new PanoOnbellek(null);
  const z = new Date().toISOString();
  ob.yaz('haberler', { anahtar: 'TR', zaman: z, veri: [{}, null, { id: 1 }] });
  ob.yaz('piyasa', { anahtar: 'ecb', zaman: z, veri: 'bozuk' });
  ob.yaz('hava', { anahtar: '41.01,28.98', zaman: z, veri: { properties: { timeseries: 'x' } } });
  const m = new PanoMotoru({
    ayar: () => ({ ...PANO_VARSAYILAN }), saatDilimi: () => 'Europe/Istanbul', dil: () => 'tr-TR',
    getir: null, tabanlar: null, ua: 'x', onbellek: ob, degisti: () => undefined,
  });
  const d = m.durum();
  assert.deepEqual([d.hava.durum, d.haberler.durum, d.gundem.durum, d.piyasa.durum], ['yok', 'yok', 'yok', 'yok']);
  // Ayar okuması bile düşerse konum nötr (İstanbul) ve durum yine döner.
  const m2 = new PanoMotoru({
    ayar: () => ({ ...PANO_VARSAYILAN }), saatDilimi: () => { throw new Error('Intl yok'); }, dil: () => 'tr-TR',
    getir: null, tabanlar: null, ua: 'x', onbellek: new PanoOnbellek(null), degisti: () => undefined,
  });
  assert.equal(m2.durum().konum.sehir, 'İstanbul');
});

test('motor: boyut sınırını aşan akış kaynağı düşürür ama diğer kaynaklar gelir', async () => {
  const s = await sunucuAc();
  const s2 = http.createServer((q, r) => {
    if (q.url!.startsWith('/haber/')) { r.writeHead(200, { 'content-type': 'application/rss+xml' }); r.end(`<rss>${'<item><title>a</title></item>'.repeat(5000)}</rss>`); return; }
    r.writeHead(404); r.end();
  });
  await new Promise<void>((c) => s2.listen(0, '127.0.0.1', c));
  try {
    const kok2 = `http://127.0.0.1:${(s2.address() as { port: number }).port}`;
    let son: PanoDurumu | null = null;
    const m = new PanoMotoru({
      ayar: () => ({ ...PANO_VARSAYILAN, gundem: false }), saatDilimi: () => 'Europe/Istanbul', dil: () => 'tr-TR',
      getir: (url, init) => fetch(url, init), tabanlar: { ...sahteTabanlar(s.kok), haber: sahteTabanlar(kok2).haber }, ua: 'x',
      onbellek: new PanoOnbellek(null), degisti: (d) => { son = d; }, zamanAsimiMs: 3000, enCokBayt: 50_000,
    });
    m.durum();
    const bitti = () => { const x = son as PanoDurumu | null; return Boolean(x && x.hava.durum === 'hazir' && x.piyasa.durum === 'hazir' && x.haberler.durum === 'yok'); };
    for (let i = 0; i < 100 && !bitti(); i++) await new Promise((c) => setTimeout(c, 30));
    const d = m.durum();
    assert.equal(d.hava.durum, 'hazir');
    assert.equal(d.piyasa.durum, 'hazir');
    assert.equal(d.haberler.durum, 'yok', 'sınırı aşan akışlar atıldı');
  } finally { await s.kapat(); await new Promise<void>((c) => s2.close(() => c())); }
});

test('motor: "Şimdi yenile" tazeyi de yeniler ama 60 sn içinde ikinci kez sormaz', async () => {
  const s = await sunucuAc();
  try {
    const saat = { t: Date.now() };
    const { m, sakin } = motorKur(s.kok, { haberler: false, gundem: false, piyasa: false }, saat);
    m.durum(); await sakin();
    const n = s.istekler.length;
    await m.yenile();
    assert.equal(s.istekler.length, n, '60 sn içinde yenileme isteği atlanır');
    saat.t += 61_000;
    await m.yenile();
    assert.equal(s.istekler.length, n + 1);
  } finally { await s.kapat(); }
});
