// Claude Code oturum araması: proje adı, başlık, istem içeriği ve Türkçe karakter farkları.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ccAra, sorguKelimeleri } from '../src/shared/cc-ara.ts';

const simdi = Date.parse('2026-10-19T12:00:00Z');
const liste = [
  { id: 'a1', baslik: 'Stripe webhook imza hatası', proje: 'kuzey-panel', cwd: 'C:/x/kuzey-panel', istemler: ['ödeme webhook 400 veriyor', 'imzayı doğrula'], sonZaman: '2026-10-18T10:00:00Z' },
  { id: 'b2', baslik: 'Landing sayfası 3B sahneler', proje: 'mavi-web', cwd: 'C:/x/mavi-web', istemler: ['beyin render', 'GSAP pin'], sonZaman: '2026-10-10T10:00:00Z' },
  { id: 'c3', baslik: 'Kokpit ızgara düzeni', proje: 'fuber-ai', cwd: 'C:/x/fuber-ai', istemler: ['grid bozuluyor', 'ödeme kartı'], sonZaman: '2026-09-01T10:00:00Z' },
];

test('sorgu kelimeleri: durak sözcükler atılır, Türkçe sadeleşir', () => {
  assert.deepEqual(sorguKelimeleri('kuzey projesinde ödeme webhook sohbetini aç'), ['kuzey', 'odeme', 'webhoo']);
});

test('başlık/proje ve istem eşleşmesi, en iyi aday başta', () => {
  assert.equal(ccAra(liste, 'kuzey ödeme webhook', simdi)[0].oturum.id, 'a1');
  assert.equal(ccAra(liste, 'mavi web landing', simdi)[0].oturum.id, 'b2');
  assert.equal(ccAra(liste, 'IZGARA kokpit', simdi)[0].oturum.id, 'c3');
  assert.equal(ccAra(liste, 'kuantum', simdi).length, 0);
});

test('aynı eşleşmede yeni oturum öne geçer', () => {
  const r = ccAra(liste, 'ödeme', simdi);
  assert.equal(r[0].oturum.id, 'a1');
  assert.ok(r.some((x) => x.oturum.id === 'c3'));
});
