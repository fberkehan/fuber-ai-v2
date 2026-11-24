// Tur sonrası işler (Görev 21, K10): hafıza/başlık/özet/kokpit yanıtla yarışmasın — sessizlikten sonra çalışır, yeni tur erteler, aynı
// anahtarlı iş birleşir (en sonuncusu bir kez), hafıza işleri birikir (hiçbiri kaybolmaz).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TurSonrasi, type Zamanlayici } from '../src/main/ajan/tur-sonrasi.ts';

/** Elle ilerleyen saat. */
function saat(): Zamanlayici & { ilerle: (ms: number) => void } {
  let simdi = 0;
  const bekleyen = new Map<number, { t: number; f: () => void }>();
  let no = 0;
  return {
    kur: (f, ms) => { bekleyen.set(++no, { t: simdi + ms, f }); return no; },
    iptal: (z) => { bekleyen.delete(z as number); },
    ilerle: (ms) => { simdi += ms; for (const [k, v] of [...bekleyen]) if (v.t <= simdi) { bekleyen.delete(k); v.f(); } },
  };
}

test('işler sessizlikten sonra çalışır; yeni tur erteler; anahtarlı işler birleşir, hafıza birikir', () => {
  const s = saat();
  const t = new TurSonrasi(s);
  const calisan: string[] = [];
  t.basladi(1);
  t.bitti(1, { 'hafiza:10': () => calisan.push('hafiza10'), baslik: () => calisan.push('baslik-1'), kokpit: () => calisan.push('kokpit-1') }, 6000);
  s.ilerle(3000);
  assert.deepEqual(calisan, [], 'sessizlik dolmadı');
  t.basladi(1); // kullanıcı hemen yeniden sordu
  s.ilerle(10_000);
  assert.deepEqual(calisan, [], 'tur sürerken çalışmaz');
  t.bitti(1, { 'hafiza:12': () => calisan.push('hafiza12'), baslik: () => calisan.push('baslik-2'), kokpit: () => calisan.push('kokpit-2') }, 6000);
  s.ilerle(5999);
  assert.deepEqual(calisan, []);
  s.ilerle(1);
  assert.deepEqual(calisan.sort(), ['baslik-2', 'hafiza10', 'hafiza12', 'kokpit-2']);
  assert.equal(t.bekleyenSayisi, 0);
});

test('çıkışta (düzeltme 7): bekleyenler hemen çalışır, seçilmeyen (kokpit) atlanır, işlerin sözleri beklenebilir', async () => {
  const s = saat();
  const t = new TurSonrasi(s);
  const calisan: string[] = [];
  t.basladi(1);
  t.bitti(1, { 'hafiza:5': async () => { await new Promise((c) => setTimeout(c, 20)); calisan.push('hafiza'); }, baslik: () => calisan.push('baslik'), kokpit: () => calisan.push('kokpit') }, 6000);
  t.basladi(2); // sürmekte olan tur çıkışta da işini bırakmaz
  t.bitti(2, { ozet: () => Promise.reject(new Error('ağ yok')) }, 1500);
  const sozler = t.hepsiniCalistir((k) => k !== 'kokpit');
  assert.equal(sozler.length, 2, 'yalnız söz döndüren işler (hafıza, özet)');
  await Promise.all(sozler); // hata veren iş çıkışı düşürmez
  assert.deepEqual(calisan.sort(), ['baslik', 'hafiza']);
  assert.equal(t.bekleyenSayisi, 0);
  s.ilerle(10_000);
  assert.ok(!calisan.includes('kokpit'), 'atlanan iş sonradan da çalışmaz');
});

test('sohbetler birbirini bekletmez; hata/durdurma (boş bitti) önceki işleri serbest bırakır', () => {
  const s = saat();
  const t = new TurSonrasi(s);
  const calisan: string[] = [];
  t.basladi(1); t.bitti(1, { kokpit: () => calisan.push('1') }, 1500);
  t.basladi(2);
  s.ilerle(1500);
  assert.deepEqual(calisan, ['1']);
  t.basladi(3); t.bitti(3, { a: () => calisan.push('3a') }, 1500);
  t.basladi(3); // yeni tur
  assert.equal(t.suruyorMu(3), true);
  t.bitti(3, {}, 1500); // tur hata verdi
  s.ilerle(1500);
  assert.deepEqual(calisan, ['1', '3a']);
  t.bitti(2, {}, 1500); // hiç işi olmayan tur: hiçbir şey kurulmaz
  assert.equal(t.bekleyenSayisi, 0);
});
