#!/usr/bin/env node
// ── Gerçek kayıtlarla doğru uyanma (0.13 T8) ───────────────────────────────────────────────────────────────────────────────────────
// Doğru uyanma ölçütü AÇIK: 18/20 örneklem içi, tek yansız ölçü sentetik bir ses (fettah 16/21). Ölçütü gerçek "Hey Fuber" kayıtları kapatır:
//   node scripts/dev/uyandirma/kayit-olc.mjs <kayıt-klasörü>
// Her kayıt dağıtılan WASM + dağıtılan ayarla (src/shared/uyandirma-ayar.ts, src/renderer/uyandirma-motor.ts) dinlenir: mikrofon açılmaz, ağa
// çıkılmaz. wav doğrudan okunur; m4a, mp3, ogg, opus, webm, aac, flac için ffmpeg gerekir. Kayda önden dolgu EKLENMEZ (sıfır örnekler gerçek mikrofonda
// olmaz ve sonucu bozar: 20 klipte 18 → 16), arkadan 1,5 sn taban gürültüsü eklenir (motorun son sözü bitirmesi için).
// "sürekli akış": uygulamadaki gibi tek akış, kayıtlar arası 0,5–3 sn −60 dBFS taban gürültüsü, dört hizalamanın ortalaması. Söz kodlayıcı parçasına
// nasıl denk düşerse sonuç değişir; karar için bu satır, "taze akış" satırından daha doğrudur.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, join, resolve } from 'node:path';
import { kwsAc } from '../../../src/renderer/uyandirma-motor.ts';
import { Ornekleyici, wavdanPcm } from '../../../src/shared/pcm.ts';
import { UYANDIRMA_AYARI as AYAR } from '../../../src/shared/uyandirma-ayar.ts';

const KAYNAK = resolve(import.meta.dirname, '../../../resources/uyandirma');
const HZ = 16000;
const SES = new Set(['.wav', '.m4a', '.mp3', '.ogg', '.opus', '.webm', '.aac', '.flac']);
const SONRA_SN = 1.5;
const TABAN_DB = -60;
const OLCUT = 0.8; // brief: 16/20
const parcaBoyu = 1600;

/** Tekrarlanabilir küçük üreteç: aynı klasör her koşuda aynı sonucu verir. */
function rastgele(t) {
  return () => { t = (t + 0x6d2b79f5) | 0; let x = Math.imul(t ^ (t >>> 15), 1 | t); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
}

function int16Float(b) {
  const i = new Int16Array(b.buffer.slice(b.byteOffset, b.byteOffset + (b.byteLength & ~1)));
  return Float32Array.from(i, (x) => x / 32768);
}

/** Dosyayı 16 kHz tek kanal Float32'ye çevirir. */
function oku(f) {
  if (extname(f).toLowerCase() === '.wav') {
    const w = wavdanPcm(new Uint8Array(readFileSync(f)));
    if (w) {
      const k = int16Float(w.pcm);
      const tek = new Float32Array(Math.floor(k.length / w.kanal));
      for (let i = 0; i < tek.length; i++) { let t = 0; for (let c = 0; c < w.kanal; c++) t += k[i * w.kanal + c]; tek[i] = t / w.kanal; }
      return w.hz === HZ ? tek : int16Float(new Ornekleyici(w.hz, HZ).donustur(tek));
    }
  }
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', f, '-ac', '1', '-ar', String(HZ), '-f', 's16le', '-'], { maxBuffer: 1 << 28 });
  if (r.error || r.status !== 0) throw new Error(`${f} okunamadı (16 bit wav değilse ffmpeg gerekir): ${r.error?.message ?? r.stderr}`);
  return int16Float(r.stdout);
}

/** Mikrofon tabanına benzer pembemsi gürültü (sabit tohum). */
function taban(n, r) {
  const g = new Float32Array(n);
  const a = 10 ** (TABAN_DB / 20) / 0.2294; // tek kutuplu süzgeç çıkışının RMS'i
  let s = 0;
  for (let i = 0; i < n; i++) { s = 0.9 * s + 0.1 * Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r()); g[i] = s * a; }
  return g;
}
const kuyruklu = (o) => { const d = new Float32Array(Math.round(SONRA_SN * HZ) + o.length); d.set(o); d.set(taban(d.length - o.length, rastgele(1)), o.length); return d; };

const klasor = process.argv[2];
if (!klasor || !existsSync(klasor) || !statSync(klasor).isDirectory()) {
  console.error('kullanım: node scripts/dev/uyandirma/kayit-olc.mjs <kayıt-klasörü>');
  process.exit(2);
}
const dosyalar = readdirSync(klasor).filter((f) => SES.has(extname(f).toLowerCase())).sort();
if (!dosyalar.length) {
  console.error(`kayıt bulunamadı: ${klasor} (${[...SES].join(' ')})`);
  process.exit(2);
}

const require = createRequire(import.meta.url);
const modul = await require(join(KAYNAK, 'sherpa-onnx-wasm-kws-main.js'))({ locateFile: (f) => join(KAYNAK, f) });
const { createKws } = require(join(KAYNAK, 'sherpa-onnx-kws.js'));
const model = Object.fromEntries(Object.values(AYAR.dosyalar).map((f) => [f, readFileSync(join(KAYNAK, f))]));
const motorAc = (bulundu) => kwsAc(modul, createKws, model, AYAR, bulundu);

const sesler = dosyalar.map((f) => ({ ad: f, ses: kuyruklu(oku(join(klasor, f))) }));

// Taze akış: her kayıt kendi akışında.
for (const k of sesler) {
  let n = 0;
  const m = motorAc(() => { n++; });
  for (let i = 0; i < k.ses.length; i += parcaBoyu) m.besle(k.ses.subarray(i, i + parcaBoyu));
  m.kapat();
  k.taze = n > 0;
  k.akis = 0;
}

// Sürekli akış: tek akış, dört hizalama. Uyanma, klibin penceresine (+1 sn karar payı) düşerse o kayda yazılır.
const TOHUMLAR = [1, 2, 3, 4];
const akisToplam = [];
for (const tohum of TOHUMLAR) {
  const r = rastgele(tohum * 7919);
  let ornek = 0;
  const uyanmalar = [];
  const m = motorAc(() => uyanmalar.push(ornek));
  const besle = (o) => { for (let i = 0; i < o.length; i += parcaBoyu) { const p = o.subarray(i, i + parcaBoyu); ornek += p.length; m.besle(p); } };
  const pencere = [];
  for (const k of sesler) {
    besle(taban(Math.round((0.5 + r() * 2.5) * HZ), r));
    pencere.push({ k, bas: ornek, bit: ornek + k.ses.length + HZ });
    besle(k.ses);
  }
  besle(taban(HZ, r));
  m.kapat();
  let vurus = 0;
  for (const p of pencere) if (uyanmalar.some((u) => u >= p.bas && u <= p.bit)) { vurus++; p.k.akis++; }
  akisToplam.push(vurus);
}

const n = sesler.length;
const taze = sesler.filter((k) => k.taze).length;
const ort = akisToplam.reduce((t, x) => t + x, 0) / akisToplam.length;
console.log(`Doğru uyanma · dağıtılan ayar (eşik ${AYAR.esik}, skor ${AYAR.skor}, yol ${AYAR.yol}) · ${n} kayıt\n`);
for (const k of sesler) console.log(`  ${k.ad.padEnd(40)} ${k.taze ? 'uyandı   ' : 'uyanmadı '}  akış ${k.akis}/${TOHUMLAR.length}`);
console.log(`\ntaze akış: ${taze}/${n}`);
console.log(`sürekli akış: ${ort.toFixed(1)}/${n} ortalama [${akisToplam.join(' ')}]`);
console.log(`ölçüt ≥ %${OLCUT * 100} (16/20), sürekli akışa göre: ${ort / n >= OLCUT ? 'GEÇTİ' : 'KALDI'}${n < 10 ? ` (yalnız ${n} kayıt: yön gösterir, karar için az)` : ''}`);
