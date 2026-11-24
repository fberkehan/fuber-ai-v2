// Açık kaynak hazırlığı (11 Kas): yonetim/ ve sunucu/ yalnız özel depoda. Onlara bağlı testler ve betikler tek işaretle sessizce atlanır
// (scripts/ozel-klasor.mjs, scripts/testleri-kos.mjs, tests/yardimci/ozel.ts); genel depoda `npm test` yeşil kalır.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { OZEL_KLASORLER, dosyaninOzelBagimliliklari, eksikOzelKlasorler, ozelModulGirisleri, ozelVarMi } from '../scripts/ozel-klasor.mjs';
import { testPlani } from '../scripts/testleri-kos.mjs';
import { ozelGerekli } from './yardimci/ozel.ts';

const kok = path.resolve(import.meta.dirname, '..');

test('işaret: ilk satırlardaki `// @ozel-bagimlilik: …` okunur; açıklama atlanır; bilinmeyen ad hata verir', () => {
  assert.deepEqual([...OZEL_KLASORLER], ['yonetim', 'sunucu', 'acik-kaynak', 'landing', 'mobil', 'e2e', 'whatsapp']);
  assert.deepEqual(dosyaninOzelBagimliliklari('// @ozel-bagimlilik: yonetim  (açıklama: yonetim/ yok)\nimport x from "y";'), ['yonetim']);
  assert.deepEqual(dosyaninOzelBagimliliklari('// başlık\n// @ozel-bagimlilik: yonetim, sunucu\n'), ['yonetim', 'sunucu']);
  assert.deepEqual(dosyaninOzelBagimliliklari('const s = "// @ozel-bagimlilik: yonetim";'), [], 'yorum satırı değilse sayılmaz');
  assert.deepEqual(dosyaninOzelBagimliliklari(`${'\n'.repeat(50)}// @ozel-bagimlilik: yonetim`), [], 'yalnız dosyanın başı');
  assert.throws(() => dosyaninOzelBagimliliklari('// @ozel-bagimlilik: yonetm'), /bilinmeyen klasör "yonetm"/);
  assert.throws(() => ozelVarMi('belgeler'), /bilinmeyen özel klasör/);
});

test('test planı: klasör yoksa işaretli dosya atlanır, öteki dosyalar koşar; özel depoda hepsi koşar', () => {
  const k = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-ozel-'));
  try {
    fs.mkdirSync(path.join(k, 'tests'));
    fs.writeFileSync(path.join(k, 'tests', 'a.test.ts'), '// genel\n');
    fs.writeFileSync(path.join(k, 'tests', 'b.test.ts'), '// @ozel-bagimlilik: yonetim\n');
    fs.writeFileSync(path.join(k, 'tests', 'c.test.ts'), '// @ozel-bagimlilik: sunucu\n');
    fs.writeFileSync(path.join(k, 'tests', 'yardimci.ts'), '// test değil\n');
    assert.deepEqual(testPlani(k), { kos: ['tests/a.test.ts'], atla: [{ dosya: 'tests/b.test.ts', eksik: ['yonetim'] }, { dosya: 'tests/c.test.ts', eksik: ['sunucu'] }] });
    fs.mkdirSync(path.join(k, 'yonetim'));
    assert.deepEqual(testPlani(k).kos, ['tests/a.test.ts', 'tests/b.test.ts']);
    assert.deepEqual(eksikOzelKlasorler('// @ozel-bagimlilik: yonetim, sunucu', k), ['sunucu']);
  } finally { fs.rmSync(k, { recursive: true, force: true }); }
});

test('özel modül girişleri (11 Kas): yalnız ozel/<modül>/kayit.ts; ozel/ yoksa boş (genel ağaç → modülsüz derleme)', () => {
  const k = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-ozel-modul-'));
  try {
    assert.deepEqual(ozelModulGirisleri(k), []);
    for (const [d, dosya] of [['b', 'kayit.ts'], ['a', 'kayit.ts'], ['c', 'baska.ts']]) { fs.mkdirSync(path.join(k, 'ozel', d), { recursive: true }); fs.writeFileSync(path.join(k, 'ozel', d, dosya), ''); }
    assert.deepEqual(ozelModulGirisleri(k), ['ozel/a/kayit.ts', 'ozel/b/kayit.ts']);
  } finally { fs.rmSync(k, { recursive: true, force: true }); }
  if (ozelVarMi('whatsapp')) assert.ok(ozelModulGirisleri().includes('ozel/whatsapp/kayit.ts'));
});
