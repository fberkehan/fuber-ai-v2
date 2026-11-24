// Son dalga B düzeltme turu 2 (Trojan Source önlemi): src, tests ve scripts altındaki metin dosyalarında HAM yön/görünmez karakter
// olmamalı — yön imleri ve yalıtıcılar (U+202A–202E, U+2066–2069), sıfır genişlikli ve yön işaretleri (U+200B–200F), BOM (U+FEFF),
// yumuşak tire (U+00AD), Arapça harf işareti (U+061C). Bu dosyanın kendisi bu karakterleri ne ham ne kaçışla yazar: aralıklar SAYI.
// (Yazma aracı kaçışları ham karaktere çevirebiliyordu; gerekirse kaynakta kaçış dizisi kullanılır, ham karakter değil.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const kok = path.resolve(import.meta.dirname, '..');
const ARALIKLAR: [number, number][] = [[0x202a, 0x202e], [0x2066, 0x2069], [0x200b, 0x200f], [0xfeff, 0xfeff], [0x00ad, 0x00ad], [0x061c, 0x061c]];
const yasak = (c: number) => ARALIKLAR.some(([a, b]) => c >= a && c <= b);
const METIN = /\.(ts|tsx|mts|cts|mjs|cjs|js|jsx|css|html|json|md|py|ps1|cs|txt|yml|yaml|sh)$/i;
const ATLA = new Set(['node_modules', 'dist', 'release', '.git']);

function tara(dizin: string, bulgular: string[], sayac: { dosya: number }): void {
  let girdiler: fs.Dirent[] = [];
  try { girdiler = fs.readdirSync(dizin, { withFileTypes: true }); } catch { return; }
  for (const e of girdiler) {
    if (ATLA.has(e.name)) continue;
    const p = path.join(dizin, e.name);
    if (e.isDirectory()) { tara(p, bulgular, sayac); continue; }
    if (!e.isFile() || !METIN.test(e.name)) continue;
    const boyut = fs.statSync(p).size;
    if (boyut > 8 * 1024 * 1024) continue;
    sayac.dosya++;
    const s = fs.readFileSync(p, 'utf8');
    let satir = 1;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c === 10) satir++;
      else if (yasak(c)) bulgular.push(`${path.relative(kok, p)}:${satir} U+${c.toString(16).toUpperCase().padStart(4, '0')}`);
    }
  }
}

test('src, tests, scripts: ham yön/görünmez karakter yok (Trojan Source)', () => {
  const bulgular: string[] = [];
  const sayac = { dosya: 0 };
  for (const d of ['src', 'tests', 'scripts']) tara(path.join(kok, d), bulgular, sayac);
  assert.ok(sayac.dosya > 100, `taranan dosya ${sayac.dosya}`);
  assert.deepEqual(bulgular.slice(0, 50), [], `${bulgular.length} ham karakter`);
});

test('tarayıcı gerçekten yakalar (aralıklar sayıyla üretilmiş örnekle)', () => {
  for (const [a, b] of ARALIKLAR) for (const c of [a, b]) assert.equal(yasak(String.fromCharCode(c).charCodeAt(0)), true);
  assert.equal(yasak('a'.charCodeAt(0)), false);
  assert.equal(yasak(0x00e7), false, 'ç serbest');
  assert.equal(yasak(0x2014), false, 'uzun tire serbest');
});
