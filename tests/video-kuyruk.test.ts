// İnceleme I2: video işleri — tek tek çalışır (ortak oturumun işleyicisi çakışmaz), çip kaldırılınca iptal (sıradaysa hiç başlamaz, çalışıyorsa
// durur), üst süre, çöküş/yanıtsız pencere hemen bitirir; her yolda temizlik (pencere kapanışı) BİR KEZ çalışır. PCM 10 dk'da kesilir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { videoIsiEkle, videoIsiIptal, VideoIsiDurdu } from '../src/main/video-kuyruk.ts';
import { pcmWavParcalari } from '../src/shared/video-ek.ts';

const uyu = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('sıra: ikinci iş birincisi bitmeden başlamaz; sıradaki bilgilendirilir', async () => {
  const olaylar: string[] = [];
  let sirada = false;
  const a = videoIsiEkle('a', { sureMs: 5000, calistir: async () => { olaylar.push('a+'); await uyu(150); olaylar.push('a-'); return 'A'; } });
  const b = videoIsiEkle('b', { sureMs: 5000, sirada: () => { sirada = true; }, calistir: async () => { olaylar.push('b+'); return 'B'; } });
  assert.deepEqual([await a, await b], ['A', 'B']);
  assert.deepEqual(olaylar, ['a+', 'a-', 'b+']);
  assert.ok(sirada);
});

test('iptal: sıradaki iş hiç başlamaz; çalışan iş durur ve temizliği bir kez çalışır', async () => {
  let temizlik = 0;
  let calistiB = false;
  const a = videoIsiEkle('i-a', { sureMs: 10_000, calistir: async (b) => { b.temizlemeyeKaydet(() => { temizlik++; }); while (!b.durdu()) await uyu(20); return 'bitmemeli'; } });
  const b = videoIsiEkle('i-b', { sureMs: 10_000, calistir: async () => { calistiB = true; return 'B'; } });
  assert.equal(videoIsiIptal('i-b'), true);
  await uyu(50);
  assert.equal(videoIsiIptal('i-a'), true);
  const ra = await a, rb = await b;
  assert.ok(ra instanceof VideoIsiDurdu && ra.neden === 'iptal');
  assert.ok(rb instanceof VideoIsiDurdu && rb.neden === 'iptal');
  assert.equal(calistiB, false, 'sıradaki iş başlamadı');
  assert.equal(temizlik, 1, 'pencere kapanışı bir kez');
  assert.equal(videoIsiIptal('i-a'), false, 'biten iş unutuldu');
});

test('üst süre ve çöküş: süre dolunca "zaman", render çöküşünde "coktu"; ikisinde de temizlik çalışır ve söz çözülür', async () => {
  let t1 = 0, t2 = 0;
  const z = await videoIsiEkle('z', { sureMs: 120, calistir: async (b) => { b.temizlemeyeKaydet(() => { t1++; }); await new Promise(() => undefined); return 'asla'; } });
  assert.ok(z instanceof VideoIsiDurdu && z.neden === 'zaman');
  assert.equal(t1, 1);
  const c = await videoIsiEkle('c', { sureMs: 5000, calistir: async (b) => { b.temizlemeyeKaydet(() => { t2++; }); setTimeout(() => b.dus('coktu'), 30); await new Promise(() => undefined); return 'asla'; } });
  assert.ok(c instanceof VideoIsiDurdu && c.neden === 'coktu');
  assert.equal(t2, 1);
  // Takılan işten sonra sıra ilerler.
  assert.equal(await videoIsiEkle('sonra', { sureMs: 1000, calistir: async () => 'tamam' }), 'tamam');
});

test('PCM üst sınırı: 10 dk\'yı aşan ses kesilir (Whisper\'a en çok 10 parça)', () => {
  const pcm = Buffer.alloc(15 * 60 * 16_000 * 2);
  const p = pcmWavParcalari(pcm, { azamiSn: 600 });
  assert.equal(p.length, 10);
  assert.equal(p.at(-1)!.bas, 540);
});
