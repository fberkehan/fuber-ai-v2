// `npm test` (açık kaynak hazırlığı, 11 Kas): tests/*.test.ts dosyalarını node:test ile çalıştırır. `// @ozel-bagimlilik: yonetim` işaretli dosya,
// işaretteki klasör bu depoda yoksa (genel depo) çalıştırılmaz ve "atlandı" diye yazılır (scripts/ozel-klasor.mjs). Özel depoda her şey eskisi gibi
// koşar. Ek bağımsız değişkenler node --test'e geçer (ör. `npm test -- --test-name-pattern=hesap`).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { KOK, eksikOzelKlasorler } from './ozel-klasor.mjs';

/** Çalışacak ve atlanacak test dosyaları (saf; tests/ozel-klasor.test.ts). */
export function testPlani(kok = KOK) {
  const klasor = path.join(kok, 'tests');
  const dosyalar = fs.readdirSync(klasor).filter((d) => d.endsWith('.test.ts')).sort();
  const kos = [];
  const atla = [];
  for (const d of dosyalar) {
    const eksik = eksikOzelKlasorler(fs.readFileSync(path.join(klasor, d), 'utf8'), kok);
    if (eksik.length) atla.push({ dosya: `tests/${d}`, eksik }); else kos.push(`tests/${d}`);
  }
  return { kos, atla };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { kos, atla } = testPlani();
  for (const a of atla) console.log(`atlandı: ${a.dosya} (${a.eksik.map((x) => `${x}/`).join(', ')} bu depoda yok)`);
  const r = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...kos], { cwd: KOK, stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
