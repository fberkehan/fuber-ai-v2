// Odak zilini sentezler (0.14 T26, R26): resources/ses/odak-zil.wav. Lisans yok: iki yumuşak çan vuruşu (Sol5, sonra Do6), her biri üstel sönümlü birkaç
// harmonikten kurulur; deterministik (rastgelelik yok), 32 kHz mono 16 bit, ~1,6 sn, tepe 0,45. Başı ve sonu sessizdir (tık yok).
// Çalıştır: node scripts/dev/zil-uret.mjs [çıktı.wav]   (varsayılan: resources/ses/odak-zil.wav)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HZ = 32000;
const SURE = 1.6; // sn
const TEPE = 0.45;
/** [başlangıç sn, temel Hz, sönüm sabiti sn, genlik] */
const VURUSLAR = [[0, 783.99, 0.34, 1], [0.2, 1046.5, 0.42, 0.85]];
/** Çan tınısı: temel, oktav, çan benzeri harmonikler (oran, göreli genlik). */
const HARMONIKLER = [[1, 1], [2, 0.32], [2.76, 0.18], [5.4, 0.06]];
const ATAK = 0.006; // sn, doğrusal giriş
const SON = 0.05; // sn, doğrusal çıkış

const n = Math.round(HZ * SURE);
const x = new Float64Array(n);
for (const [bas, f, tau, gen] of VURUSLAR) {
  for (let i = Math.round(bas * HZ); i < n; i++) {
    const t = i / HZ - bas;
    const zarf = Math.min(1, t / ATAK) * Math.exp(-t / tau) * gen;
    let s = 0;
    for (const [oran, g] of HARMONIKLER) s += g * Math.sin(2 * Math.PI * f * oran * t);
    x[i] += zarf * s;
  }
}
const sonN = Math.round(SON * HZ);
for (let i = 0; i < sonN; i++) x[n - 1 - i] *= i / sonN;
let en = 0;
for (const v of x) en = Math.max(en, Math.abs(v));

const veri = Buffer.alloc(n * 2);
for (let i = 0; i < n; i++) veri.writeInt16LE(Math.round((x[i] / en) * TEPE * 32767), i * 2);
const b = Buffer.alloc(44);
b.write('RIFF', 0); b.writeUInt32LE(36 + veri.length, 4); b.write('WAVE', 8);
b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
b.writeUInt32LE(HZ, 24); b.writeUInt32LE(HZ * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
b.write('data', 36); b.writeUInt32LE(veri.length, 40);

const hedef = path.resolve(process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'resources', 'ses', 'odak-zil.wav'));
fs.mkdirSync(path.dirname(hedef), { recursive: true });
fs.writeFileSync(hedef, Buffer.concat([b, veri]));
console.log(`${hedef} · ${(n / HZ).toFixed(2)} sn · ${veri.length + 44} bayt`);
