// Claude Code oturum indeksinin gerçek veride ölçümü (SALT OKUNUR; ~/.claude'a yazmaz). Önbellek geçici klasöre.
// Çalıştır: node scripts/dev/cc-indeks-olc.mjs ["arama sorgusu"]
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { ccTara, ccOnbellekYolu } from '../../src/main/claudecode/indeks.ts';
import { ccAra } from '../../src/shared/cc-ara.ts';

const onbellek = path.join(os.tmpdir(), `fuber-cc-olcum-${process.pid}.json`);
ccOnbellekYolu(onbellek);
let t = Date.now();
const l = await ccTara();
console.log(`ilk tarama: ${l.length} oturum, ${((Date.now() - t) / 1000).toFixed(1)} sn`);
t = Date.now();
await ccTara();
console.log(`ikinci (artımlı) tarama: ${((Date.now() - t) / 1000).toFixed(2)} sn · önbellek ${(fs.statSync(onbellek).size / 1024).toFixed(0)} KB`);
const projeler = new Set(l.map((o) => o.proje));
console.log(`proje: ${projeler.size} · başlıklı: ${l.filter((o) => o.baslik && o.baslik !== o.ilk).length}`);
const sorgu = process.argv[2] ?? 'fuber ai masaüstü düşünme motoru';
for (const r of ccAra(l, sorgu).slice(0, 3)) console.log(`  ${r.puan.toFixed(1)} · ${r.oturum.proje} · ${r.oturum.baslik.slice(0, 70)} · ${r.oturum.sonZaman?.slice(0, 10)}`);
fs.rmSync(onbellek, { force: true });
