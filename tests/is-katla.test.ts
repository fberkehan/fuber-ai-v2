// Biten işlerin katlanması (11 Kas; biten alt ajanlar sohbette çok büyük yer kaplıyordu). Claude Code dökümünde art arda biten yardımcılar
// ve araç kartları tek satır ("✓ 3 yardımcı · 15 adım · 16 sn"); süren iş katlanmaz. Sohbet ve kokpitin grupları, Fuber sohbetinin araç adımları aynı katlı
// satırı kullanır; yükseklik canlanmaz (yalnız transform ve opacity).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { dokumKatla, gorunenSira, katliOzet, type KatliGrup } from '../src/renderer/claudecode/katla.ts';
import type { AltAjanOgesi, AracOgesi, DokumOgesi } from '../src/renderer/claudecode/dokum-modeli.ts';

const kok = path.resolve(import.meta.dirname, '..');
const oku = (f: string) => fs.readFileSync(path.join(kok, f), 'utf8');
const arac = (n: number, durum: AracOgesi['durum'] = 'tamam', zaman = 0, bitis = 1000): AracOgesi => ({
  tur: 'arac', anahtar: `a${n}`, zaman, bitis, ust: null, id: `t${n}`, ad: 'Read', tip: 'okuma', girdi: {}, ozet: '', durum,
});
const ajan = (n: number, adim: number, durum: AltAjanOgesi['durum'] = 'tamam', zaman = 0, bitis = 16_000): AltAjanOgesi => ({
  tur: 'alt-ajan', anahtar: `y${n}`, zaman, bitis, ust: null, id: `j${n}`, aciklama: 'İş', istem: '', durum,
  cocuklar: Array.from({ length: adim }, (_, i) => ({ ...arac(n * 100 + i), ust: `j${n}` })),
});
const metin = (n: number): DokumOgesi => ({ tur: 'metin', anahtar: `m${n}`, zaman: 0, ust: null, blok: `b${n}`, metin: 'x', akiyor: false });

test('art arda biten yardımcılar tek satır: "3 yardımcı · 15 adım · 16 sn"', () => {
  const l = dokumKatla([metin(1), ajan(1, 5), ajan(2, 6), ajan(3, 4, 'tamam', 0, 16_400), metin(2)]);
  assert.deepEqual(l.map((o) => o.tur), ['metin', 'katli', 'metin']);
  const g = l[1] as KatliGrup;
  assert.equal(g.cesit, 'ajan');
  assert.equal(g.anahtar, 'katli:y1', 'kararlı anahtar (ilk öğeden)');
  assert.deepEqual(katliOzet(g), { metin: '3 yardımcı · 15 adım · 16 sn', tamam: true });
});

test('süren iş katlanmaz ve diziyi böler; tek biten öğe kendi satırında', () => {
  const l = dokumKatla([ajan(1, 2), ajan(2, 2, 'calisiyor'), ajan(3, 2)]);
  assert.deepEqual(l.map((o) => o.tur), ['alt-ajan', 'alt-ajan', 'alt-ajan']);
  const k = dokumKatla([arac(1), arac(2), arac(3, 'calisiyor'), arac(4), arac(5, 'hata')]);
  assert.deepEqual(k.map((o) => o.tur), ['katli', 'arac', 'katli']);
  assert.deepEqual(katliOzet(k[2] as KatliGrup), { metin: '2 adım · 1 sn · 1 olmadı', tamam: false });
  // Çeşitler karışmaz: araç dizisi ile yardımcı dizisi ayrı katlanır.
  assert.deepEqual(dokumKatla([arac(1), arac(2), ajan(1, 1), ajan(2, 1)]).map((o) => (o.tur === 'katli' ? o.cesit : o.tur)), ['arac', 'ajan']);
});

test('izin "Göster" hedefi katlı grubun içindeyse grubun sırası bulunur', () => {
  const l = dokumKatla([metin(1), arac(1), arac(2)]);
  assert.equal(gorunenSira(l, 'a2'), 1);
  assert.equal(gorunenSira(l, 'm1'), 0);
  assert.equal(gorunenSira(l, 'yok'), -1);
});

test('kaynak: döküm katlar, biten yardımcı kendi şeridinde kapalı, sohbet grupları ve araç adımları katlı satır; yükseklik canlanmaz', () => {
  assert.match(oku('src/renderer/claudecode/Dokum.tsx'), /const ogeler = useMemo\(\(\) => dokumKatla\(hamOgeler\), \[hamOgeler\]\);/);
  const k = oku('src/renderer/claudecode/Kartlar.tsx');
  assert.match(k, /const acikIc = secimIc \?\? o\.durum === 'calisiyor';/, 'yardımcı yalnız sürerken açık');
  assert.match(k, /<KatliSatir metin=\{o\.metin\}/);
  const s = oku('src/renderer/is-izi/IsSeridi.tsx');
  assert.match(s, /if \(hepsiBitti\) \{/);
  assert.match(s, /<KatliSatir metin=\{ozet\}/);
  assert.match(oku('src/renderer/bilesenler/AracAdimlari.tsx'), /data-arac-adim="katli"/);
  const css = oku('src/renderer/is-izi/is-izi.css');
  const katli = css.slice(css.indexOf('/* ── Katlı satır'), css.indexOf('/* Sohbet: yazı alanının'));
  assert.ok(katli.length > 100);
  const kod = katli.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(kod, /max-height|grid-template-rows|transition:[^;]*height/, 'yükseklik canlanmaz');
  const kf = /@keyframes is-katli-ac \{([^\n]*)\}/.exec(kod);
  assert.ok(kf);
  assert.doesNotMatch(kf[1], /height|width|margin|padding/);
  assert.match(kf[1], /opacity: 0; transform: translateY\(-4px\)/);
  for (const m of katli.matchAll(/transition:\s*([^;]+)/g)) assert.match(m[1], /^(transform|none)\b/, m[1]);
});
