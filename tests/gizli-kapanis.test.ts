// Gizli mod kapanış sırası (Görev 21 düzeltme turu 4, D): yerel sunucu ANCAK bekleyen Gizli satırlar notlandıktan sonra kapanır (main.ts
// bu yardımcıyı kullanır); notlama hata verse de kapanır; o arada Gizli mod yeniden açıldıysa kapanmaz.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gizliKapanisi } from '../src/main/yerel/gizli-kapanis.ts';

const bekle = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('sunucu notlama BİTTİKTEN sonra kapanır (önce değil)', async () => {
  const sira: string[] = [];
  const is = gizliKapanisi({
    notla: async () => { sira.push('notla:basla'); await bekle(30); sira.push('notla:bitti'); },
    tekMotor: () => false,
    durdur: () => sira.push('durdur'),
    bildir: () => sira.push('bildir'),
  });
  await bekle(10);
  assert.deepEqual(sira, ['notla:basla'], 'notlama sürerken sunucu kapanmamalı');
  await is;
  assert.deepEqual(sira, ['notla:basla', 'notla:bitti', 'durdur', 'bildir']);
});

test('notlama hata verse de sunucu sonra kapanır; Gizli mod yeniden açıldıysa kapanmaz', async () => {
  const sira: string[] = [];
  await gizliKapanisi({ notla: async () => { await bekle(5); throw new Error('yerel beyin yanıt vermedi'); }, tekMotor: () => false, durdur: () => sira.push('durdur'), bildir: () => sira.push('bildir') });
  assert.deepEqual(sira, ['durdur', 'bildir']);
  const sira2: string[] = [];
  let tek = false;
  await gizliKapanisi({ notla: async () => { tek = true; /* kullanıcı Gizli modu yeniden açtı */ }, tekMotor: () => tek, durdur: () => sira2.push('durdur'), bildir: () => sira2.push('bildir') });
  assert.deepEqual(sira2, ['bildir']);
});
