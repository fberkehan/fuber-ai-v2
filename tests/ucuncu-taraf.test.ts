// Üçüncü taraf bildirimleri (Ayarlar → Genel → Hakkında; pakette resources/lisanslar/UCUNCU-TARAF.txt): her girdinin metni kendi lisans dosyasından
// birebir, pakete giren dosya ucuncuTarafMetni() çıktısının aynısı; uyarlanan arayüz simgelerinin (Lucide ISC, Feather MIT) atfı hem Hakkında'da hem
// THIRD_PARTY_NOTICES.md'de (scripts/ucuncu-taraf.mjs VARLIK_METINLERI).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { UCUNCU_TARAF, ucuncuTarafMetni } from '../src/shared/ucuncu-taraf.ts';

const kok = path.resolve(import.meta.dirname, '..');
const oku = (y: string): string => fs.readFileSync(path.join(kok, y), 'utf8').replace(/\r\n/g, '\n');
const SIMGE_LISANSI = 'resources/lisanslar/LUCIDE-LICENSE.txt';

test('her girdinin lisans metni kendi dosyasından birebir', () => {
  for (const x of UCUNCU_TARAF) assert.equal(x.metin.trim(), oku(x.dosya).trim(), `${x.ad} ← ${x.dosya}`);
});

test('pakete giren UCUNCU-TARAF.txt, ucuncuTarafMetni() çıktısının aynısı', () => {
  assert.equal(oku('resources/lisanslar/UCUNCU-TARAF.txt'), ucuncuTarafMetni());
});

test('uyarlanan simgeler: Lucide (ISC) ve Feather (MIT) atfı Hakkında listesinde ve THIRD_PARTY_NOTICES.md içinde birebir', () => {
  const g = UCUNCU_TARAF.find((x) => x.dosya === SIMGE_LISANSI);
  assert.ok(g, 'Hakkında listesinde Lucide/Feather girdisi yok');
  assert.match(g.metin, /^ISC License/);
  assert.match(g.metin, /Copyright \(c\) 2013-present Cole Bemis/);
  const bildirim = oku('THIRD_PARTY_NOTICES.md');
  assert.match(bildirim, /\| Lucide and Feather icons \(adapted path data\) \| ISC \(Lucide\) and MIT \(Feather\) \|/);
  assert.ok(bildirim.includes(oku(SIMGE_LISANSI).trim()), 'simge lisansının metni THIRD_PARTY_NOTICES.md içinde birebir yok');
  assert.match(oku('src/renderer/bilesenler/Ikon.tsx'), /Lucide \(ISC[^)]*\) ve Feather \(MIT[^)]*\)/, 'Ikon.tsx atıf satırı yok');
});
