// Ayar/sır dosyası: atomik yazım, .bak yedeği; bozuk dosya yedekten okunur ve sağlam yedeği ezmez.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { jsonOku, jsonYaz } from '../src/main/json-dosya.ts';

const acilan: string[] = [];
const klasor = () => { const k = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-json-')); acilan.push(k); return k; };
after(() => { for (const k of acilan) fs.rmSync(k, { recursive: true, force: true }); });

test('yaz → oku; ikinci yazımda önceki içerik .bak olur, geçici dosya kalmaz', () => {
  const d = path.join(klasor(), 'ayarlar.json');
  assert.equal(jsonOku(d), 'yok');
  jsonYaz(d, { a: 1 }, 2);
  assert.deepEqual(jsonOku(d), { veri: { a: 1 }, yedektenMi: false });
  jsonYaz(d, { a: 2 });
  assert.deepEqual(JSON.parse(fs.readFileSync(`${d}.bak`, 'utf8')), { a: 1 });
  assert.deepEqual(jsonOku(d), { veri: { a: 2 }, yedektenMi: false });
  assert.equal(fs.existsSync(`${d}.yaziliyor`), false);
});

test('bozuk asıl dosya yedekten okunur; yazım sağlam yedeği bozukla ezmez', () => {
  const d = path.join(klasor(), 'sirlar.json');
  jsonYaz(d, { 'api:anthropic': 'x' });
  jsonYaz(d, { 'api:anthropic': 'x', 'api:openai': 'y' });
  fs.writeFileSync(d, '{"api:anthr'); // yarıda kalmış yazım
  assert.deepEqual(jsonOku(d), { veri: { 'api:anthropic': 'x' }, yedektenMi: true });
  jsonYaz(d, { 'api:anthropic': 'x', 'api:fuber': 'z' });
  assert.deepEqual(JSON.parse(fs.readFileSync(`${d}.bak`, 'utf8')), { 'api:anthropic': 'x' });
  assert.deepEqual(jsonOku(d), { veri: { 'api:anthropic': 'x', 'api:fuber': 'z' }, yedektenMi: false });
});

test('asıl ve yedek okunamıyorsa "bozuk"; nesne olmayan JSON da bozuk sayılır', () => {
  const k = klasor();
  const d = path.join(k, 'ayarlar.json');
  fs.writeFileSync(d, 'çöp');
  assert.equal(jsonOku(d), 'bozuk');
  fs.writeFileSync(d, 'null');
  assert.equal(jsonOku(d), 'bozuk');
  fs.writeFileSync(`${d}.bak`, '[1,2]');
  assert.equal(jsonOku(d), 'bozuk');
});
