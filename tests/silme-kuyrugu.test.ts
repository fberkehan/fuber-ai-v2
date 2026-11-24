// Ana süreçteki silme kuyruğu (src/main/silme-kuyrugu.ts; Görev 20b düzeltme turu 1): "Unut" → 5 sn içinde normal çıkış →
// silme uygulanmış olmalı (eskiden arayüz sayacı ölüyor, kayıt kalıyordu); çökmede uygulanmaz; IPC girdisi doğrulanır.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { silmeKuyrugu, silmeIslemiOku, silmeAnahtari, type SilmeIslemi, type SilmeDurumu } from '../src/main/silme-kuyrugu.ts';
import type { Saat } from '../src/shared/ertelenmis.ts';

function sahteSaat(): Saat & { ilerle: (ms: number) => void } {
  let t = 0, n = 0;
  const isler = new Map<number, { an: number; f: () => void }>();
  return {
    kur: (f, ms) => { const id = ++n; isler.set(id, { an: t + ms, f }); return id; },
    iptal: (id) => { isler.delete(id as number); },
    simdi: () => t,
    ilerle: (ms) => { t += ms; for (const [id, x] of [...isler].sort((a, b) => a[1].an - b[1].an)) if (x.an <= t) { isler.delete(id); x.f(); } },
  };
}

function kur() {
  const s = sahteSaat();
  const veri = new Set(['hafiza:7', 'eposta:abc', 'belge:3']);
  const durumlar: SilmeDurumu[] = [];
  const hatalar: string[] = [];
  const q = silmeKuyrugu({ saat: s, uygula: (i: SilmeIslemi) => { veri.delete(silmeAnahtari(i)); }, degisti: (d) => durumlar.push(d), hata: (a, e, m) => hatalar.push(`${a}|${e}|${m}`) });
  return { s, veri, durumlar, hatalar, q };
}

test('"Unut" → 5 sn içinde normal çıkış → kayıt silinmiş (before-quit hepsiniUygula)', () => {
  const { s, veri, q } = kur();
  q.ertele({ tur: 'hafiza', id: 7 }, '“Kahve” unutuldu');
  s.ilerle(2000);
  assert.ok(veri.has('hafiza:7'), 'süre dolmadan silinmez');
  q.hepsiniUygula();
  assert.ok(!veri.has('hafiza:7'));
  assert.deepEqual(q.durum().bekleyen, []);
  assert.ok(q.durum().gizli.includes('hafiza:7'));
});

test('süre dolunca uygulanır; arayüze aynası bildirilir (bekleyen, gizli, durakli); geri alınan uygulanmaz', () => {
  const { s, veri, durumlar, q } = kur();
  const d = q.ertele({ tur: 'eposta', id: 'abc' }, 'deniz@ornek.test kaldırıldı');
  assert.deepEqual(d.bekleyen.map((b) => [b.anahtar, b.grup, b.etiket]), [['eposta:abc', 'eposta', 'deniz@ornek.test kaldırıldı']]);
  q.ertele({ tur: 'belge', id: 3 }, '“a.md” silindi');
  assert.equal(q.geriAl('belge:3'), true);
  s.ilerle(5000);
  assert.ok(!veri.has('eposta:abc'));
  assert.ok(veri.has('belge:3'));
  assert.ok(durumlar.length >= 3 && durumlar.at(-1)!.gizli.includes('eposta:abc'));
});

test('duraklatılmış kuyruk da çıkışta uygulanır; hata anahtar ve etiketle bildirilir', () => {
  const s = sahteSaat();
  const hatalar: string[] = [];
  const q = silmeKuyrugu({ saat: s, uygula: () => { throw new Error('veritabanı kilitli'); }, degisti: () => undefined, hata: (a, e, m) => hatalar.push(`${a}|${e}|${m}`) });
  q.ertele({ tur: 'hafiza', id: 9 }, '“X” unutuldu');
  q.duraklat(true);
  assert.equal(q.durum().durakli, true);
  q.hepsiniUygula();
  assert.deepEqual(hatalar, ['hafiza:9|“X” unutuldu|veritabanı kilitli']);
});

// Düzeltme turu 2: aynı türden art arda silinenler tek tost + tek süre; duraklatma tostun grubuna (türüne) özgü.
test('aynı türden ikinci silme (4. sn) birincinin süresini uzatır: ikisi birlikte 9. sn\'de; duraklatma yalnız o türün', () => {
  const { s, veri, q } = kur();
  veri.add('hafiza:8');
  q.ertele({ tur: 'hafiza', id: 7 }, '“A” unutuldu');
  q.ertele({ tur: 'eposta', id: 'abc' }, 'e-posta kaldırıldı');
  s.ilerle(4000);
  const d = q.ertele({ tur: 'hafiza', id: 8 }, '“B” unutuldu');
  assert.deepEqual(d.bekleyen.filter((b) => b.grup === 'hafiza').map((b) => b.bitis), [9000, 9000]);
  q.duraklat(true, 'eposta');
  assert.deepEqual(q.durum().duraklatilan, ['eposta']);
  s.ilerle(1500);
  assert.ok(veri.has('hafiza:7'), 'A eski süresiyle silinmez');
  assert.ok(veri.has('eposta:abc'), 'duraklatılan e-posta beklemede');
  s.ilerle(3500);
  assert.ok(!veri.has('hafiza:7') && !veri.has('hafiza:8'), 'ikisi birlikte 9. sn\'de');
  q.duraklat(false); // grupsuz sürdür: duraklatılmış hepsi
  assert.deepEqual(q.durum().duraklatilan, []);
  s.ilerle(5000);
  assert.ok(!veri.has('eposta:abc'));
});

test('IPC girdisi doğrulanır: yalnız bilinen tür ve geçerli kimlik', () => {
  assert.deepEqual(silmeIslemiOku({ tur: 'hafiza', id: 12 }), { tur: 'hafiza', id: 12 });
  assert.deepEqual(silmeIslemiOku({ tur: 'eposta', id: 'u-1' }), { tur: 'eposta', id: 'u-1' });
  assert.deepEqual(silmeIslemiOku({ tur: 'belge', id: 4 }), { tur: 'belge', id: 4 });
  for (const x of [null, {}, { tur: 'hafiza', id: '12' }, { tur: 'hafiza', id: -1 }, { tur: 'sohbet', id: 1 }, { tur: 'eposta', id: '' }, { tur: 'belge', id: 1.5 }]) assert.equal(silmeIslemiOku(x), null, JSON.stringify(x));
});
