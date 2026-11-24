// Kısayolun okunur yazımı (src/shared/kisayol.ts): sol menüdeki asistan ipucu ayardaki kısayolu yazmalı (Görev 19 denetimi).
// K15: kurulum sihirbazı ve tanıtım turu da aynı yardımcıyı kullanır (kendi kopyaları kalktı); boş kısayolda "Asistan ()" yok.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { kisayolOkunur, kisayolluAd } from '../src/shared/kisayol.ts';

// 0.10 Görev 3 (D-6): okunur yazım kisayolGosterimi'dir (tests/terimler.test.ts) — "Space" de "Boşluk" yazılır; kisayolOkunur onun boş
// değer kabul eden eski adı (tepsi, ada, sihirbaz aynı gösterimi kullanır).
test('Windows: CommandOrControl / CmdOrCtrl / Control → Ctrl; Space → Boşluk', () => {
  assert.equal(kisayolOkunur('CommandOrControl+Shift+Space'), 'Ctrl+Shift+Boşluk');
  assert.equal(kisayolOkunur('CmdOrCtrl+Alt+F9'), 'Ctrl+Alt+F9');
  assert.equal(kisayolOkunur('Control+Alt+Q'), 'Ctrl+Alt+Q');
  assert.equal(kisayolOkunur('Alt+Space'), 'Alt+Boşluk');
});

test('Mac: CommandOrControl → ⌘', () => {
  assert.equal(kisayolOkunur('CommandOrControl+Shift+Space', true), '⌘+Shift+Boşluk');
});

test('K15: boş ya da eksik kısayol boş metin; ad yanında "Asistan ()" değil yalnız "Asistan"', () => {
  for (const k of ['', '   ', undefined, null]) assert.equal(kisayolOkunur(k), '', JSON.stringify(k));
  assert.equal(kisayolluAd('Asistan', 'CommandOrControl+Shift+Space'), 'Asistan (Ctrl+Shift+Boşluk)');
  assert.equal(kisayolluAd('Asistan', 'CommandOrControl+Shift+Space', true), 'Asistan (⌘+Shift+Boşluk)');
  for (const k of ['', '  ', undefined, null]) assert.equal(kisayolluAd('Asistan', k), 'Asistan', JSON.stringify(k));
});

test('K15: kısayolun okunur yazımı tek yerde — renderer\'da CommandOrControl → Ctrl dönüşümünün kopyası yok', () => {
  const kok = path.resolve(import.meta.dirname, '..', 'src', 'renderer');
  const kopya: string[] = [];
  const tara = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const y = path.join(d, e.name);
      if (e.isDirectory()) { tara(y); continue; }
      if (/\.tsx?$/.test(e.name) && /CommandOrControl\|CmdOrCtrl/.test(fs.readFileSync(y, 'utf8'))) kopya.push(path.relative(kok, y));
    }
  };
  tara(kok);
  assert.deepEqual(kopya, []);
});
