// 0.14 son bütün dal incelemesi — küçük bulguların kaynak denetimleri (Minor 13, 16, 19). Davranış testleri ilgili dosyalarda (Minor 2, 3, 4, 6:
// tests/komut-siniflama.test.ts, tests/dosya-yaz.test.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const oku = (y: string) => fs.readFileSync(path.resolve(import.meta.dirname, '..', y), 'utf8');

test('Minor 13: MCP OAuth/katalog isteği yönlendirme izlemez (https denetimi yalnız ilk adrese yapılıyordu)', () => {
  assert.match(oku('src/main/entegrasyon/mcp-oauth.ts'), /credentials: 'omit', cache: 'no-store', redirect: 'error'/);
});
