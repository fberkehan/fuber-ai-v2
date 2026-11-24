// scripts/dev/surec-agaci.mjs (0.14 T28b): boşta işlemci betiğinin süreç ağacı. Windows'ta ParentProcessId, çocuğu açan sürecin kimliğidir; o süreç
// öldükten sonra kimlik YENİDEN KULLANILABİLİR. T28b'nin sayılan sessiz koşusunda Discord'un ana süreci (00:30'da, ölmüş bir başlatıcıdan açılmış;
// ebeveyn kimliği 85240) 04:07'de aynı kimliği alan çentik işleyicimizin "çocuğu" sayıldı ve Discord'un işleyicisi "çentik arayüzü %1,163" olarak ölçüldü.
// Kural: çocuk, ebeveyninden SONRA (ya da aynı anda) oluşmuş olmalı.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { soyAgaci, tamEkranYaDaGizli } from '../scripts/dev/surec-agaci.mjs';

// T28b yeniden ölçüm: ölçüm ortasında Ekran Alıntısı Aracı açıldı (tam ekran kaplama, bildirim durumu 2); çentik doğru olarak gizlendi ve gizlenme
// 60 kare verdi. Koşu başta geçerliydi; sonda tam ekran ya da gizli sayfa da koşuyu geçersiz (kararsız) yapar.
test('tamEkranYaDaGizli: bildirim durumu 2/3/4 ya da gizli sayfa', () => {
  assert.equal(tamEkranYaDaGizli(1, 'visible'), false);
  assert.equal(tamEkranYaDaGizli(5, 'visible'), false);
  for (const d of [2, 3, 4]) assert.equal(tamEkranYaDaGizli(d, 'visible'), true);
  assert.equal(tamEkranYaDaGizli(5, 'hidden'), true);
  assert.equal(tamEkranYaDaGizli(undefined, undefined), false);
});

test('soyAgaci: kökten inen süreçler; ebeveyn kimliği yeniden kullanılmış yabancı süreç (ebeveynden önce oluşmuş) alınmaz', () => {
  const liste = [
    { pid: 36976, ppid: 4000, olusma: 1000 },   // electron (kök)
    { pid: 85240, ppid: 36976, olusma: 1010 },  // çentik işleyicisi
    { pid: 12644, ppid: 36976, olusma: 1005 },  // fuber-olay
    { pid: 121628, ppid: 85240, olusma: 10 },   // Discord ana: ebeveyn kimliği eskiden ölmüş başlatıcının, işleyicimizden önce oluşmuş
    { pid: 122336, ppid: 121628, olusma: 20 },  // Discord işleyicisi
    { pid: 50000, ppid: 85240, olusma: 1020 },  // işleyicimizin gerçek çocuğu
    { pid: 7, ppid: 1, olusma: 0 },
  ];
  assert.deepEqual(soyAgaci(liste, 36976).map((p) => p.pid).sort((a, b) => a - b), [12644, 36976, 50000, 85240]);
});

test('soyAgaci: oluşma anı bilinmiyorsa (null) eski davranış: yalnız ebeveyn kimliği', () => {
  const liste = [{ pid: 1, ppid: 0, olusma: null }, { pid: 2, ppid: 1, olusma: null }, { pid: 3, ppid: 2, olusma: 5 }];
  assert.deepEqual(soyAgaci(liste, 1).map((p) => p.pid), [1, 2, 3]);
});
