// 0.14 T25 — şarkı sözü kaynağı (src/main/soz.ts; LRCLIB, önbellek, P14) ve iki sayfanın kaynak kuralları (Muzik.tsx, Soz.tsx). Ağ yok: fetch sahtedir,
// önbellek geçici klasörde. Review Focus 3: Gizli ya da "Yalnız bu bilgisayar"da istek hiç çıkmaz; istek sürerken Gizli açılırsa istek kesilir, sonucu
// gösterilmez ve önbelleğe yazılmaz.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LRCLIB, LRCLIB_KULLANICI, LRCLIB_MS, SOZ_GOVDE_SINIRI, SOZ_ONBELLEK_SINIRI, sozGetirici, type SozBagimliliklari } from '../src/main/soz.ts';
import { medyaCaliyor } from '../src/shared/sistem-olay.ts';
import { sozDurumMetni, SOZ_METNI } from '../src/shared/lrc.ts';
import { BULUT_KAPALI_METNI } from '../src/shared/bulut-kapisi.ts';

const PARCA = { baslik: 'Firuze', sanatci: 'Sezen Aksu', album: 'Firuze', sure: 241 };
const kaynakOku = (yol: string): string => fs.readFileSync(new URL(`../${yol}`, import.meta.url), 'utf8');

interface Istek { url: string; init: RequestInit }
const yanit = (durum: number, govde: unknown) => ({ status: durum, ok: durum >= 200 && durum < 300, json: async () => govde });

/** Sahte bağımlılıklar: istekleri sayar; `yasak` ve ayar dinleyicisi testten yönetilir. */
function sahne(o: { yanitla?: (i: Istek) => Promise<unknown>; dosya?: string | null } = {}) {
  const istekler: Istek[] = [];
  const dinleyiciler = new Set<() => void>();
  const durum = { yasak: false };
  const klasor = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-soz-'));
  const dosya = o.dosya === null ? null : (o.dosya ?? path.join(klasor, 'soz-onbellek.json'));
  const b: SozBagimliliklari = {
    fetch: (url, init) => { const i = { url, init }; istekler.push(i); return (o.yanitla ?? (async () => yanit(200, { syncedLyrics: '[00:01.00]Merhaba', plainLyrics: 'Merhaba' })))(i) as never; },
    yasak: () => durum.yasak,
    ayarDegisince: (f) => { dinleyiciler.add(f); return () => { dinleyiciler.delete(f); }; },
    dosya: () => dosya,
  };
  const ayarDegisti = () => { for (const f of [...dinleyiciler]) f(); };
  return { b, istekler, durum, dosya, dinleyiciler, ayarDegisti, klasor };
}

test('sözler önbellekten ikinci kez ağa çıkmadan gelir (dosyadan da: yeni süreç gibi)', async () => {
  const s = sahne();
  const getir = sozGetirici(s.b);
  const ilk = await getir(PARCA);
  const ikinci = await getir({ ...PARCA, baslik: 'FIRUZE ', sure: 241.3 });
  assert.deepEqual(ikinci, ilk);
  assert.equal(s.istekler.length, 1, 'aynı parça ikinci kez ağa çıkmaz');
  assert.ok(fs.existsSync(s.dosya!), 'userData/soz-onbellek.json yazıldı');
  const yeni = sozGetirici(s.b); // uygulama yeniden açıldı: önbellek dosyadan
  assert.deepEqual(await yeni(PARCA), ilk);
  assert.equal(s.istekler.length, 1);
});

test('404 → bulunamadi ("Bu şarkının sözleri bulunamadı."); 404 de önbelleğe girer (atlamada kaynak dövülmez)', async () => {
  const s = sahne({ yanitla: async () => yanit(404, { code: 404, name: 'TrackNotFound' }) });
  const getir = sozGetirici(s.b);
  const r = await getir(PARCA);
  assert.deepEqual(r, { tur: 'bulunamadi' });
  assert.equal(sozDurumMetni(r), 'Bu şarkının sözleri bulunamadı.');
  await getir(PARCA);
  assert.equal(s.istekler.length, 1);
});

test('yalnız düz söz varsa eşsiz gösterilir; enstrümantal ve boş yanıt bulunamadı', async () => {
  const duz = sahne({ yanitla: async () => yanit(200, { syncedLyrics: null, plainLyrics: 'Birinci satır\nİkinci satır\n' }) });
  assert.deepEqual(await sozGetirici(duz.b)(PARCA), { tur: 'duz', metin: 'Birinci satır\nİkinci satır' });
  const bozukEsli = sahne({ yanitla: async () => yanit(200, { syncedLyrics: 'damgasız', plainLyrics: 'Düz metin' }) });
  assert.deepEqual(await sozGetirici(bozukEsli.b)(PARCA), { tur: 'duz', metin: 'Düz metin' }, 'eşli metinden satır çıkmazsa düz');
  const enst = sahne({ yanitla: async () => yanit(200, { instrumental: true, syncedLyrics: null, plainLyrics: null }) });
  assert.deepEqual(await sozGetirici(enst.b)(PARCA), { tur: 'bulunamadi' });
});

test('sunucu hatası, ağ hatası ve 6 sn aşımı → hata; önbelleğe girmez (sonra yeniden denenir)', async () => {
  const s5 = sahne({ yanitla: async () => yanit(503, {}) });
  const g = sozGetirici(s5.b);
  assert.deepEqual(await g(PARCA), { tur: 'hata' });
  await g(PARCA);
  assert.equal(s5.istekler.length, 2, 'hata önbelleğe girmez');
  const ag = sahne({ yanitla: async () => { throw new TypeError('fetch failed'); } });
  assert.deepEqual(await sozGetirici(ag.b)(PARCA), { tur: 'hata' });
  // Asılı kalan istek: sınır dolunca kesilir (test sınırı kısaltır; varsayılan LRCLIB_MS).
  const asili = sahne({ yanitla: (i) => new Promise((_, ret) => i.init.signal!.addEventListener('abort', () => ret(new Error('abort')))) });
  const bas = Date.now();
  assert.deepEqual(await sozGetirici({ ...asili.b, sureMs: 40 })(PARCA), { tur: 'hata' });
  assert.ok(Date.now() - bas < 2000);
});

test('düzeltme turu 1: yanıt gövdesi en çok 1 MB — büyük gövde hata döner, önbelleğe girmez; content-length aşarsa gövde okunmaz', async () => {
  assert.equal(SOZ_GOVDE_SINIRI, 1024 * 1024);
  /** Parça parça akan gövde; kaç bayt çekildiği sayılır. */
  const akis = (toplam: number, parca = 64 * 1024) => {
    let verilen = 0;
    const s = new ReadableStream<Uint8Array>({
      pull(c) {
        if (verilen >= toplam) { c.close(); return; }
        const n = Math.min(parca, toplam - verilen);
        verilen += n;
        c.enqueue(new Uint8Array(n).fill(0x20));
      },
    });
    return { s, verilen: () => verilen };
  };
  // Akıştan: sınır aşılınca kesilir (bütün gövde çekilmez).
  let kesildi = false;
  const buyuk = akis(5 * 1024 * 1024);
  const a = sahne({
    yanitla: async (i) => {
      i.init.signal!.addEventListener('abort', () => { kesildi = true; });
      return { status: 200, ok: true, json: async () => { throw new Error('json() çağrılmamalı'); }, headers: new Headers(), body: buyuk.s };
    },
  });
  const ga = sozGetirici(a.b);
  assert.deepEqual(await ga(PARCA), { tur: 'hata' });
  assert.ok(kesildi, 'sınır aşılınca istek kesildi');
  assert.ok(buyuk.verilen() < 2 * 1024 * 1024, `en çok sınır + bir parça okunur (${buyuk.verilen()})`);
  assert.ok(!fs.existsSync(a.dosya!), 'büyük gövde önbelleğe girmez');
  await ga(PARCA);
  assert.equal(a.istekler.length, 2, 'hata önbellekte değil: yeniden denenir');
  // content-length sınırı aşıyorsa gövde hiç okunmaz.
  let okundu = false;
  const b = sahne({
    yanitla: async () => ({
      status: 200, ok: true, json: async () => { okundu = true; return {}; }, headers: new Headers({ 'content-length': String(SOZ_GOVDE_SINIRI + 1) }),
      // highWaterMark 0: akış kendiliğinden ön okuma yapmaz — pull yalnız gerçekten okunursa çağrılır.
      body: new ReadableStream<Uint8Array>({ pull() { okundu = true; } }, { highWaterMark: 0 }),
    }),
  });
  assert.deepEqual(await sozGetirici(b.b)(PARCA), { tur: 'hata' });
  assert.ok(!okundu, 'gövde okunmadı');
  assert.ok(!fs.existsSync(b.dosya!));
  // Sınırın altındaki gerçek Response akıştan okunur ve ayrıştırılır.
  const c = sahne({ yanitla: async () => new Response(JSON.stringify({ syncedLyrics: '[00:02.00]Akıştan', plainLyrics: 'Akıştan' }), { status: 200 }) });
  assert.deepEqual(await sozGetirici(c.b)(PARCA), { tur: 'esli', satirlar: [{ sn: 2, metin: 'Akıştan' }] });
  // Bozuk JSON gövde: hata.
  const d = sahne({ yanitla: async () => new Response('{bozuk', { status: 200 }) });
  assert.deepEqual(await sozGetirici(d.b)(PARCA), { tur: 'hata' });
});

test('düzeltme turu 1: medyaCaliyor hız da ister (duraklamada hiz 0; Kapalı hap ve medya çubukları yalnız gerçekten çalarken)', () => {
  const m = { t: 'medya' as const, var: true as const, uygulama: 'Spotify.exe', baslik: 'a', sanatci: 'b', album: '', sure: 100, konum: 1, konumZamani: 0, caliyor: true, hiz: 1, kapak: null };
  assert.equal(medyaCaliyor({ medya: m, ses: null }), true);
  assert.equal(medyaCaliyor({ medya: { ...m, hiz: 0 }, ses: null }), false, 'caliyor true ama hız 0');
  assert.equal(medyaCaliyor({ medya: { ...m, caliyor: false }, ses: null }), false);
  assert.equal(medyaCaliyor({ medya: { t: 'medya', var: false }, ses: null }), false);
  assert.equal(medyaCaliyor({ medya: null, ses: null }), false);
  assert.equal(medyaCaliyor(null), false);
});

test('başlıksız parça ağa çıkmaz: bulunamadi', async () => {
  const s = sahne();
  assert.deepEqual(await sozGetirici(s.b)({ baslik: '  ', sanatci: 'X', sure: 100 }), { tur: 'bulunamadi' });
  assert.equal(s.istekler.length, 0);
});

test('Review Focus 3: Gizli ya da Yalnız bu bilgisayar: fetch hiç çağrılmaz, sonuç kapali ve BULUT_KAPALI_METNI.soz', async () => {
  const s = sahne();
  const getir = sozGetirici(s.b);
  await getir(PARCA); // önbellekte olsa da Gizli'de gösterilmez
  const once = s.istekler.length;
  s.durum.yasak = true; // Gizli mod ya da "Yalnız bu bilgisayar" (bulutYasak)
  const r = await getir(PARCA);
  const r2 = await getir({ ...PARCA, baslik: 'Başka şarkı' });
  assert.deepEqual(r, { tur: 'kapali' });
  assert.deepEqual(r2, { tur: 'kapali' });
  assert.equal(s.istekler.length - once, 0, 'Gizli\'de sıfır istek');
  assert.equal(sozDurumMetni(r), BULUT_KAPALI_METNI.soz);
  // Hiç önbelleği olmayan yeni kurulumda da sıfır istek.
  const t = sahne();
  t.durum.yasak = true;
  assert.deepEqual(await sozGetirici(t.b)(PARCA), { tur: 'kapali' });
  assert.equal(t.istekler.length, 0);
});

test('Review Focus 3: istek sürerken Gizli açılırsa istek kesilir, sonuç gösterilmez ve önbelleğe yazılmaz', async () => {
  let kesildi = false;
  let coz: ((v: unknown) => void) | null = null;
  const s = sahne({
    yanitla: (i) => new Promise((res, ret) => {
      coz = res;
      i.init.signal!.addEventListener('abort', () => { kesildi = true; ret(new Error('abort')); });
    }),
  });
  const getir = sozGetirici(s.b);
  const soz = getir(PARCA);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(s.istekler.length, 1);
  s.durum.yasak = true;
  s.ayarDegisti(); // ayarlar:degisti — Gizli açıldı
  assert.deepEqual(await soz, { tur: 'kapali' });
  assert.ok(kesildi, 'süren istek AbortController ile kesildi');
  assert.ok(!fs.existsSync(s.dosya!), 'yarıda kalan istekten önbelleğe bir şey yazılmadı');
  assert.equal(s.dinleyiciler.size, 0);
  // Kesilmeyen (sinyali yok sayan) sahte kaynak yine de yanıt verse: Gizli'de sonuç gösterilmez.
  const inatci = sahne({ yanitla: () => new Promise((res) => { coz = res; }) });
  const g2 = sozGetirici(inatci.b)(PARCA);
  await new Promise((r) => setTimeout(r, 10));
  inatci.durum.yasak = true;
  (coz as unknown as (v: unknown) => void)(yanit(200, { syncedLyrics: '[00:01.00]Gizli satır' }));
  assert.deepEqual(await g2, { tur: 'kapali' });
  assert.ok(!fs.existsSync(inatci.dosya!));
});

test('çağıranın sinyali (parça değişti) isteği keser; sonuç hata, önbelleğe girmez', async () => {
  const s = sahne({ yanitla: (i) => new Promise((_, ret) => i.init.signal!.addEventListener('abort', () => ret(new Error('abort')))) });
  const k = new AbortController();
  const soz = sozGetirici(s.b)(PARCA, k.signal);
  k.abort();
  assert.deepEqual(await soz, { tur: 'hata' });
  assert.ok(!fs.existsSync(s.dosya!));
});

test(`önbellek en çok ${SOZ_ONBELLEK_SINIRI} şarkı, en eski düşer`, async () => {
  assert.equal(SOZ_ONBELLEK_SINIRI, 200);
  const s = sahne();
  const getir = sozGetirici(s.b);
  for (let i = 0; i <= SOZ_ONBELLEK_SINIRI; i++) await getir({ ...PARCA, baslik: `Şarkı ${i}` });
  assert.equal(s.istekler.length, SOZ_ONBELLEK_SINIRI + 1);
  const dosya = JSON.parse(fs.readFileSync(s.dosya!, 'utf8')) as { girdiler: unknown[] };
  assert.equal(dosya.girdiler.length, SOZ_ONBELLEK_SINIRI);
  await getir({ ...PARCA, baslik: `Şarkı ${SOZ_ONBELLEK_SINIRI}` });
  assert.equal(s.istekler.length, SOZ_ONBELLEK_SINIRI + 1, 'en yeni önbellekte');
  await getir({ ...PARCA, baslik: 'Şarkı 0' });
  assert.equal(s.istekler.length, SOZ_ONBELLEK_SINIRI + 2, 'en eski düştü: yeniden ağa çıkar');
});

test('bozuk önbellek dosyası çökertmez; dosyasız (null) bellekte çalışır', async () => {
  const s = sahne();
  fs.writeFileSync(s.dosya!, '{bozuk');
  assert.equal((await sozGetirici(s.b)(PARCA)).tur, 'esli');
  const b = sahne({ dosya: null });
  const g = sozGetirici(b.b);
  await g(PARCA); await g(PARCA);
  assert.equal(b.istekler.length, 1);
});

test('Muzik.tsx ve Soz.tsx requestAnimationFrame ve setInterval kullanmaz (kaynak taraması)', () => {
  for (const yol of ['src/renderer/ada/sayfalar/Muzik.tsx', 'src/renderer/ada/sayfalar/Soz.tsx', 'src/renderer/ada/sayfalar/useMedya.ts']) {
    const k = kaynakOku(yol).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(k, /requestAnimationFrame/, `${yol}: rAF döngüsü yok`);
    assert.doesNotMatch(k, /setInterval/, `${yol}: setInterval yok`);
    assert.doesNotMatch(k, /dangerouslySetInnerHTML|innerHTML/, `${yol}: kapak ve sözler HTML olarak basılmaz`);
  }
  // İlerleme çubuğu tek WAAPI scaleX animasyonu; satır vurgusu setTimeout zinciri.
  assert.match(kaynakOku('src/renderer/ada/sayfalar/Muzik.tsx'), /\.animate\(/);
  assert.match(kaynakOku('src/renderer/ada/sayfalar/Soz.tsx'), /setTimeout/);
  // Kayıtta tek satır (B9).
  const p = kaynakOku('src/renderer/ada/Panel.tsx');
  assert.match(p, /sayfaKaydet\('muzik', Muzik\)/);
  assert.match(p, /sayfaKaydet\('soz', Soz\)/);
  // Medya komutu yalnız yardımcı yolundan (medya:komut → yardimciyaGonder); medya tuşu gönderilmez.
  const ipc = kaynakOku('src/main/ipc.ts');
  assert.match(ipc, /h\('medya:komut'/);
  assert.match(ipc, /h\('soz:getir'/);
  assert.doesNotMatch(kaynakOku('src/main/soz.ts') + kaynakOku('src/renderer/ada/sayfalar/Muzik.tsx'), /MediaPlayPause|sendInputEvent|keybd_event/);
  assert.equal(SOZ_METNI.yok, 'Şu an çalan bir şey yok.');
});
