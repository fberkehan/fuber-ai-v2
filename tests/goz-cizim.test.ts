// Gözler "Pamuk" çizimi (11 Kas; onaylanan goz-tasarimi-2, öneri 05). Geometri tasarımla birebir, yol komutları yalnız M L C Q H V Z, iki göz ayna,
// renk yalnız beyaz/siyah ve kipin vurgusu (küçük parıltı), kapak ve yanak kırpma yolu kullanmaz, kademe ve görünüm kutuları.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  KAPALI_YOL, PAMUK, VB_KARE, VB_SIKI, VB_TAM, bebek, d, gozKademesi, hedef, kapakP, kapakT, kapakY, kapakYolu, sekil, yanakT, yanakYolu, yayOpak,
} from '../src/renderer/ui/goz/geometri.ts';
import { KIP_VURGUSU } from '../src/renderer/ui/goz/vurgu.ts';

const kok = path.resolve(import.meta.dirname, '..');
const komutlar = (yol: string) => yol.replace(/[-\d.\s]/g, '').split('');

test('Pamuk ölçüleri tasarımla birebir', () => {
  assert.deepEqual([...PAMUK.cx], [30, 70]);
  assert.equal(PAMUK.yt, -12);
  assert.equal(PAMUK.yb, 12.3);
  assert.deepEqual(PAMUK.menzil, { x: 4, y: 2.6 });
  assert.equal(PAMUK.bakisCarpani, 0.2);
  assert.equal(PAMUK.lidK, 9);
  assert.equal(PAMUK.cheekK, 32);
  assert.equal(sekil(1), 'M-12 0 C-12 -7.4 -6.6 -12.4 0 -12 C5.8 -11.7 10.4 -7.6 12.1 -3.4 C12.5 -2.2 12.5 -0.6 12.5 0.8 C12.5 7.6 6.9 12.3 0 12.3 C-6.8 12.3 -12 7.2 -12 0 Z');
  assert.equal(KAPALI_YOL, 'M-9.4 7 Q0 15.2 9.4 7');
  assert.deepEqual(bebek(1).bebek, { cx: '-0.9', cy: '2.1', r: '7.3' });
});

test('yol komutları yalnız M L C Q H V Z', () => {
  for (const y of [sekil(1), sekil(-1), KAPALI_YOL, kapakYolu(), yanakYolu()]) {
    for (const c of komutlar(y)) assert.match(c, /^[MLCQHVZ]$/, `${y}: ${c}`);
  }
});

test('sol göz sağın aynası; bebek içte, parıltı ofseti aynalanmaz (ışık aynı yandan)', () => {
  const sag = sekil(1).match(/-?\d*\.?\d+/g)!.map(Number);
  const sol = sekil(-1).match(/-?\d*\.?\d+/g)!.map(Number);
  sag.forEach((v, i) => assert.equal(sol[i], i % 2 === 0 ? (v === 0 ? 0 : -v) : v));
  assert.equal(d('M1 2 L3 4', -1), 'M-1 2 L-3 4');
  // Bebek ikisinde de içte (burun yanında): sağ gözde −x, sol gözde +x.
  assert.ok(Number(bebek(1).bebek.cx) < 0 && Number(bebek(-1).bebek.cx) > 0);
  // Büyük parıltı bebeğin sol üstünde iki gözde de (−2,6 ofset aynalanmaz).
  assert.equal(Number(bebek(1).buyukParilti.cx) - Number(bebek(1).bebek.cx), -2.6);
  assert.equal(Number(bebek(-1).buyukParilti.cx) - Number(bebek(-1).bebek.cx), -2.6);
});

test('kapak ve yanak: p ve q uçları gözü tam açar / kapatır; kapakP tersidir', () => {
  assert.equal(kapakY(0), PAMUK.yt - 1);
  assert.equal(kapakY(1), PAMUK.yb + 2);
  for (const p of [0, 0.3, 0.72, 1]) assert.ok(Math.abs(kapakP(kapakY(p)) - p) < 1e-9);
  assert.equal(kapakT(0), 'translate(0px, -13px) rotate(0deg)');
  assert.match(yanakT(0), /^translate\(0px, 13\.3px\)$/);
  // Kapalı yay kapağın son ince beyazında belirir: yayBas öncesi 0, yaySon sonrası 1.
  assert.equal(yayOpak(PAMUK.yayBas), 0);
  assert.equal(yayOpak(PAMUK.yaySon), 1);
  assert.ok(yayOpak(0.8) > 0 && yayOpak(0.8) < 1);
});

test('hâl hedefleri: dinliyor büyür, düşünürken tek yan ağır kısılır, mutlu ^ ^, hata dış köşe düşer, uyku kapalı', () => {
  assert.match(hedef('dinliyor', 1).durum, /scale\(1\.07, 1\.1\)/);
  assert.equal(hedef('dinliyor', 1).bebek, 'scale(1.12)');
  assert.equal(hedef('dusunuyor', 1).q, 0.34);
  assert.equal(hedef('dusunuyor', -1).q, 0.12);
  assert.equal(hedef('dusunuyor', 1).p, 0, 'düşünürken kapak inmez');
  assert.equal(hedef('mutlu', 1).q, 1);
  assert.equal(hedef('hata', 1).rot, 13);
  assert.equal(hedef('hata', -1).rot, -13);
  assert.equal(hedef('hata', 1).p, 0.3);
  assert.equal(hedef('uyuyor', 1).p, 1);
  assert.equal(hedef('bosta', 1).kapak, kapakT(0));
});

test('görünüm kutuları ve kademeler (24 px avatar xs, çentik s, büyük m)', () => {
  assert.deepEqual(VB_TAM, { x: 0, y: 0, w: 100, h: 40 });
  assert.deepEqual(VB_SIKI, { x: 10, y: 1, w: 80, h: 38 });
  assert.ok(Math.abs(VB_KARE.w - VB_KARE.h) < 1e-9, 'kare');
  assert.ok(Math.abs(VB_KARE.x + VB_KARE.w / 2 - 50) < 1e-9 && Math.abs(VB_KARE.y + VB_KARE.h / 2 - 20) < 1e-9, 'gözler ortada');
  // 24 px kutuda göz çifti ~20,8 px (tasarımda 20 px), 120 px kartta ~104 px.
  assert.ok(Math.abs((24 * VB_SIKI.w) / VB_KARE.w - 20.8) < 0.1);
  assert.ok(Math.abs((120 * VB_SIKI.w) / VB_KARE.w - 104) < 0.1);
  assert.equal(gozKademesi(24 / VB_KARE.w), 'xs');
  assert.equal(gozKademesi((16 * 40) / 26 / 40), 's');
  assert.equal(gozKademesi(120 / VB_KARE.w), 'm');
});

test('renk: yalnız beyaz, siyah ve kipin vurgusu (Business turuncu, Developer yeşil)', () => {
  assert.deepEqual(KIP_VURGUSU, { business: '#F09532', developer: '#67AD58' });
  const kaynak = fs.readFileSync(path.join(kok, 'src/renderer/ui/goz/Gozler.tsx'), 'utf8') + fs.readFileSync(path.join(kok, 'src/renderer/ui/goz/goz.css'), 'utf8');
  const renkler = new Set((kaynak.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).map((r) => r.toLowerCase()));
  for (const r of renkler) assert.ok(['#fff', '#ffffff', '#000', '#000000'].includes(r), `beklenmeyen renk ${r}`);
  assert.doesNotMatch(kaynak, /clipPath|clip-path|filter\s*:/, 'kapak ve yanak kırpma kullanmaz; filtre yok');
  // Parıltılar: nötr (beyaz) + kipin vurgusu, mod geçişinde 280 ms çapraz solma (CSS).
  assert.match(kaynak, /goz-p-b/);
  assert.match(kaynak, /goz-p-d/);
  assert.match(kaynak, /280ms/);
});
