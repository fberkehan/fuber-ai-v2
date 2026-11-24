// İndirme yardımcısı (src/main/indirme.ts): disk dolunca (ENOSPC) asılı kalmaz, yarım dosyayı siler ve "Diskte yer kalmadı." der;
// durdurma (AbortSignal) okumayı bırakır ve yarım dosyayı siler; sağlam indirme özetle doğrulanır. Ağ yok: fetch sahte akışla
// değiştirilir; yazıcı hatası sahte Writable ile.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Writable } from 'node:stream';
import { akisaYaz, indir, type ParcaOkuyucu } from '../src/main/indirme.ts';

const asilFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = asilFetch; });

/** `ms` içinde sonuçlanmazsa "asılı kaldı" diye düşer. */
const zamanla = <T>(p: Promise<T>, ms = 3000) => Promise.race([p, new Promise<never>((_, e) => setTimeout(() => e(new Error('asılı kaldı')), ms))]);
const enospc = () => Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' });
/** Her yazımda (biraz sonra) disk dolu hatası veren yazıcı; küçük tampon: ilk yazım false döner → 'drain' beklenir. */
const doluDisk = () => new Writable({ highWaterMark: 1, write(_p, _k, cb) { setTimeout(() => cb(enospc()), 5); } });
/** `n` parça (her biri `boy` bayt) veren okuyucu; `sonsuz` ise bitmez. */
function okuyucu(n: number, boy = 1024, sonsuz = false): ParcaOkuyucu & { birakildi: boolean } {
  let i = 0;
  const o = {
    birakildi: false,
    async read() {
      await new Promise((c) => setTimeout(c, 2));
      if (o.birakildi) return { done: true };
      if (!sonsuz && i >= n) return { done: true };
      i++;
      return { value: new Uint8Array(boy).fill(i % 251), done: false };
    },
    cancel() { o.birakildi = true; },
  };
  return o;
}
/** Sahte fetch: parçaları akıtır (`sonsuz` ise bitmez). */
function sahteFetch(parcalar: Uint8Array[], sonsuz = false) {
  globalThis.fetch = (async () => {
    let i = 0;
    const akis = new ReadableStream<Uint8Array>({
      async pull(k) {
        await new Promise((c) => setTimeout(c, 2));
        if (sonsuz) { k.enqueue(new Uint8Array(4096).fill(7)); return; }
        if (i < parcalar.length) k.enqueue(parcalar[i++]); else k.close();
      },
    });
    return new Response(akis, { headers: { 'content-length': sonsuz ? '999999999' : String(parcalar.reduce((n, p) => n + p.length, 0)) } });
  }) as typeof fetch;
}
const geciciKlasor = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-indirme-test-'));

test('akisaYaz: yazıcı "drain" beklerken disk dolu hatası verirse reddeder, asılı kalmaz', async () => {
  await assert.rejects(zamanla(akisaYaz(okuyucu(50), doluDisk())), (e: Error & { code?: string }) => e.code === 'ENOSPC');
});

test('akisaYaz: sağlam yazıcıda bütün parçaları yazar, bayt sayısını döner, her parça bildirilir', async () => {
  const yazilan: number[] = [];
  const yaz = new Writable({ write(p, _k, cb) { yazilan.push(p.length); cb(); } });
  let bildirilen = 0;
  const n = await zamanla(akisaYaz(okuyucu(10, 512), yaz, (p) => { bildirilen += p.length; }));
  assert.equal(n, 5120);
  assert.equal(bildirilen, 5120);
  assert.equal(yazilan.reduce((a, b) => a + b, 0), 5120);
});

test('akisaYaz: durdurma sinyali okumayı bırakır ve "durduruldu" diye reddeder (bitti sayılmaz)', async () => {
  const d = new AbortController();
  const o = okuyucu(0, 256, true);
  const yaz = new Writable({ write(_p, _k, cb) { cb(); } });
  setTimeout(() => { o.birakildi = true; d.abort(); }, 30);
  await assert.rejects(zamanla(akisaYaz(o, yaz, undefined, d.signal)), (e: Error) => e.name === 'AbortError');
});

test('indir: disk doluysa "Diskte yer kalmadı." ile reddeder, asılı kalmaz, yarım dosya silinir, hedef oluşmaz', async () => {
  const k = geciciKlasor();
  const hedef = path.join(k, 'model.gguf');
  sahteFetch(Array.from({ length: 40 }, () => new Uint8Array(4096).fill(1)));
  // Yarım dosya gerçekten oluşur (sonra disk dolar): silindiği denetlenir.
  const ac = (yol: string) => { fs.writeFileSync(yol, 'yarim'); return doluDisk(); };
  await assert.rejects(zamanla(indir('https://ornek.invalid/model.gguf', hedef, undefined, undefined, undefined, ac)), (e: Error) => e.message === 'Diskte yer kalmadı.');
  assert.equal(fs.existsSync(`${hedef}.indiriliyor`), false, 'yarım dosya kalmamalı');
  assert.equal(fs.existsSync(hedef), false);
  fs.rmSync(k, { recursive: true, force: true });
});

test('indir: durdurulunca okuma bırakılır, yarım dosya silinir (gerçek dosya yazıcısıyla)', async () => {
  const k = geciciKlasor();
  const hedef = path.join(k, 'model.gguf');
  sahteFetch([], true);
  const d = new AbortController();
  let ilk = true;
  const p = indir('https://ornek.invalid/model.gguf', hedef, undefined, () => { if (ilk) { ilk = false; d.abort(); } }, d.signal);
  setTimeout(() => d.abort(), 600); // ilerleme 300 ms'de bir: en geç burada
  await assert.rejects(zamanla(p), (e: Error) => e.name === 'AbortError');
  await new Promise((c) => setTimeout(c, 50));
  assert.equal(fs.existsSync(`${hedef}.indiriliyor`), false, 'yarım dosya kalmamalı');
  assert.equal(fs.existsSync(hedef), false);
  fs.rmSync(k, { recursive: true, force: true });
});

// Görev 20b düzeltme turu 1: yarım dosya, yazıcı KAPANDIKTAN sonra silinir (Windows'ta açık tutamaklı dosya hemen silinemez/kalır).
test('indir: durdurulunca yarım dosya yazıcı kapandıktan sonra silinir', async () => {
  const k = geciciKlasor();
  const hedef = path.join(k, 'model.gguf');
  sahteFetch([], true);
  const d = new AbortController();
  let kapanirkenVardi: boolean | null = null;
  const ac = (yol: string) => {
    fs.writeFileSync(yol, 'yarim');
    // Sağlam ama kapanışı geciken (Windows'ta tutamak kapanana dek) yazıcı: kapandığı anda dosya hâlâ yerinde olmalı (silme sonra).
    const w = new Writable({ write(_p, _k, cb) { cb(); } });
    w._destroy = (e, cb) => { setTimeout(() => { kapanirkenVardi = fs.existsSync(yol); cb(e); }, 40); };
    setTimeout(() => d.abort(), 30);
    return w;
  };
  await assert.rejects(zamanla(indir('https://ornek.invalid/model.gguf', hedef, undefined, undefined, d.signal, ac)), (e: Error) => e.name === 'AbortError');
  assert.equal(kapanirkenVardi, true, 'silme yazıcı kapanmadan yapılmadı');
  assert.equal(fs.existsSync(`${hedef}.indiriliyor`), false, 'kapanınca silindi');
  fs.rmSync(k, { recursive: true, force: true });
});

test('indir: sağlam indirme özeti doğrular, dosyayı yerine taşır, ".dogrulandi" işareti bırakır; özet tutmazsa siler', async () => {
  const k = geciciKlasor();
  const parcalar = Array.from({ length: 8 }, (_, i) => new Uint8Array(1000).fill(i));
  const sha = createHash('sha256').update(Buffer.concat(parcalar)).digest('hex');
  sahteFetch(parcalar);
  const hedef = path.join(k, 'iyi.bin');
  await zamanla(indir('https://ornek.invalid/iyi.bin', hedef, sha));
  assert.equal(fs.statSync(hedef).size, 8000);
  assert.equal(fs.readFileSync(`${hedef}.dogrulandi`, 'utf8'), sha);
  assert.equal(fs.existsSync(`${hedef}.indiriliyor`), false);
  sahteFetch(parcalar);
  const kotu = path.join(k, 'kotu.bin');
  await assert.rejects(zamanla(indir('https://ornek.invalid/kotu.bin', kotu, '0'.repeat(64))), /SHA-256 doğrulanamadı/);
  assert.equal(fs.existsSync(kotu), false);
  assert.equal(fs.existsSync(`${kotu}.indiriliyor`), false);
  fs.rmSync(k, { recursive: true, force: true });
});

test('son denetim: özetten sonra, yerine konmadan koşar; reddederse yarım dosya silinir, var olan dosya ve işareti yerinde kalır', async () => {
  const k = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-indirme-denetim-'));
  const parcalar = [new Uint8Array(1000).fill(7)];
  const sha = createHash('sha256').update(parcalar[0]).digest('hex');
  const hedef = path.join(k, 'model.gguf');
  fs.writeFileSync(hedef, 'eski');
  fs.writeFileSync(`${hedef}.dogrulandi`, 'eski-ozet');
  sahteFetch(parcalar);
  const goruldu: [string, number, boolean][] = [];
  await assert.rejects(zamanla(indir('https://ornek.invalid/m', hedef, sha, undefined, undefined, undefined, undefined, (g, b) => {
    goruldu.push([path.basename(g), b, fs.existsSync(g)]);
    throw new Error('reddedildi');
  })), /reddedildi/);
  assert.deepEqual(goruldu, [['model.gguf.indiriliyor', 1000, true]]);
  assert.equal(fs.readFileSync(hedef, 'utf8'), 'eski');
  assert.equal(fs.readFileSync(`${hedef}.dogrulandi`, 'utf8'), 'eski-ozet');
  assert.equal(fs.existsSync(`${hedef}.indiriliyor`), false);
  // Özet tutmazsa son denetim hiç koşmaz.
  sahteFetch(parcalar);
  let koştu = false;
  await assert.rejects(zamanla(indir('https://ornek.invalid/m', hedef, '0'.repeat(64), undefined, undefined, undefined, undefined, () => { koştu = true; })), (e: Error & { code?: string }) => e.code === 'SHA');
  assert.equal(koştu, false);
  // Geçerse dosya yerine konur; beklenen (async) tamamlanmadan konmaz.
  sahteFetch(parcalar);
  let konmadan = false;
  await zamanla(indir('https://ornek.invalid/m', hedef, sha, undefined, undefined, undefined, undefined, async () => { await new Promise((c) => setTimeout(c, 10)); konmadan = fs.readFileSync(hedef, 'utf8') === 'eski'; }));
  assert.equal(konmadan, true);
  assert.equal(fs.statSync(hedef).size, 1000);
  fs.rmSync(k, { recursive: true, force: true });
});

test('üst sınır aşılınca hata `BUYUK` koduyla ayrılır (çağıran düz cümle kurar)', async () => {
  const k = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-indirme-buyuk-'));
  const hedef = path.join(k, 'b.bin');
  sahteFetch([new Uint8Array(1000), new Uint8Array(1000)]);
  await assert.rejects(zamanla(indir('https://ornek.invalid/b', hedef, undefined, undefined, undefined, undefined, 1500)), (e: Error & { code?: string }) => e.code === 'BUYUK' && /beklenenden büyük/.test(e.message));
  assert.equal(fs.existsSync(`${hedef}.indiriliyor`), false);
  fs.rmSync(k, { recursive: true, force: true });
});
