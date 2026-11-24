#!/usr/bin/env node
// ── Uyandırma ölçümü (0.13 T8): motor başına doğru uyanma / olumlu, yanlış uyanma / saat ─────────────────────────────────────────────
// Set: set-hazirla.mjs (.superpowers/uyandirma/; depoya girmez). Motorlar:
//   node scripts/dev/uyandirma/olc.mjs vosk [--set ayar|sinama|hepsi]
//   node scripts/dev/uyandirma/olc.mjs sherpa --urun [--set ayar|sinama]      dağıtılan ayar (src/shared/uyandirma-ayar.ts)
//   node scripts/dev/uyandirma/olc.mjs sherpa --model giga|gigaf|zhen8|zhen16 --anahtar "<belirteçler>[;<belirteçler>]" --esik 0.1,0.2 --skor 1,2 [--set ayar]
//        [--kuyruk 1,2] [--yol 4,8] [--ad deneme] [--hizli]
// "sinama" seti (10 saat) eşik seçiminde KULLANILMAZ: ayar yalnız "ayar" setinde seçilir, seçilen ayar sınamada bir kez ölçülür.
// Sayım: akış tek parça beslenir (uygulamadaki gibi), 1500 ms içindeki ardışık uyanmalar teke iner (src/renderer/uyandirma.ts ile aynı kilit).
// sherpa ölçümü pakete giren WASM (resources/uyandirma) ve pakete giren kodla (uyandirma-motor.ts) koşar. Sonuçlar: .superpowers/uyandirma/sonuc/*.json.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

const BURASI = dirname(fileURLToPath(import.meta.url));
const DEPO = resolve(BURASI, '../../..');
const KOK = join(DEPO, '.superpowers/uyandirma');
const PY = join(KOK, 'venv/Scripts/python.exe');
const WASM = join(DEPO, 'resources/uyandirma');
const KILIT_SN = 1.5;
const ONEK = 100; // ms: besleme parçası; uygulamadaki ScriptProcessor (4096 örnek @ 48 kHz) ≈ 85 ms

export const MODELLER = {
  giga: { dizin: 'modeller/giga', kod: 'encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx', coz: 'decoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx', bir: 'joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx' },
  gigaf: { dizin: 'modeller/giga', kod: 'encoder-epoch-12-avg-2-chunk-16-left-64.onnx', coz: 'decoder-epoch-12-avg-2-chunk-16-left-64.onnx', bir: 'joiner-epoch-12-avg-2-chunk-16-left-64.onnx' },
  zhen16: { dizin: 'modeller/zhen', kod: 'encoder-epoch-13-avg-2-chunk-16-left-64.int8.onnx', coz: 'decoder-epoch-13-avg-2-chunk-16-left-64.onnx', bir: 'joiner-epoch-13-avg-2-chunk-16-left-64.int8.onnx' },
  zhen8: { dizin: 'modeller/zhen', kod: 'encoder-epoch-13-avg-2-chunk-8-left-64.int8.onnx', coz: 'decoder-epoch-13-avg-2-chunk-8-left-64.onnx', bir: 'joiner-epoch-13-avg-2-chunk-8-left-64.int8.onnx' },
};

/** 16 kHz mono PCM16 WAV → Float32Array (başlık 44 bayt: set-hazirla hep böyle yazar). */
function wavOku(f) {
  const b = readFileSync(f);
  const n = (b.length - 44) >> 1;
  const o = new Float32Array(n);
  for (let i = 0; i < n; i++) o[i] = b.readInt16LE(44 + i * 2) / 32768;
  return o;
}

/** 1500 ms kilit: ürünün kapısıyla aynı sayım. */
export function kilitle(zamanlar, kilit = KILIT_SN) {
  const c = [];
  for (const z of zamanlar) if (!c.length || z - c[c.length - 1] >= kilit) c.push(z);
  return c;
}

// ── İşçi: bir yapılandırma + bir dosya (ya da klip kümesi). Dağıtılan WASM + dağıtılan kod (uyandirma-motor.ts). ──
async function isci() {
  const require = createRequire(import.meta.url);
  const { kwsAc } = await import('../../../src/renderer/uyandirma-motor.ts');
  const SherpaKws = require(join(WASM, 'sherpa-onnx-wasm-kws-main.js'));
  const { createKws } = require(join(WASM, 'sherpa-onnx-kws.js'));
  const modul = await SherpaKws({ locateFile: (f) => join(WASM, f) });
  parentPort.on('message', (is) => {
    const m = MODELLER[is.ayar.model];
    const adlar = { encoder: m.kod, decoder: m.coz, joiner: m.bir, tokens: 'tokens.txt' };
    const dosyalar = Object.fromEntries(Object.values(adlar).map((f) => [f, readFileSync(join(KOK, m.dizin, f))]));
    const ayar = { dosyalar: adlar, anahtar: is.ayar.anahtar, esik: is.ayar.esik, skor: is.ayar.skor, kuyruk: is.ayar.kuyruk, yol: is.ayar.yol };
    const parca = Math.round(16000 * ONEK / 1000);
    const adlar2 = {};
    const dinle = (ses) => {
      const z = [];
      let i = 0;
      const motor = kwsAc(modul, createKws, dosyalar, ayar, (a) => { z.push(+((i + parca) / 16000).toFixed(2)); adlar2[a] = (adlar2[a] ?? 0) + 1; });
      for (; i < ses.length; i += parca) motor.besle(ses.subarray(i, i + parca));
      motor.kapat();
      return z;
    };
    const t0 = performance.now();
    let sonuc;
    if (is.tur === 'akis') {
      const ses = wavOku(is.dosya);
      sonuc = { zamanlar: kilitle(dinle(ses)), sn: ses.length / 16000, anahtarlar: adlar2 };
    } else {
      sonuc = { klipler: is.klipler.map((f) => ({ ad: f.split(/[\\/]/).pop().slice(0, -4), uyandi: dinle(wavOku(f)).length > 0 })) };
    }
    parentPort.postMessage({ ...sonuc, ms: performance.now() - t0 });
  });
  parentPort.postMessage({ hazir: true });
}

// ── Ana süreç ──
const arg = (ad, varsayilan) => { const i = process.argv.indexOf(`--${ad}`); return i >= 0 ? process.argv[i + 1] : varsayilan; };
const liste = (s) => s.split(',').map(Number);

function dizin(set) {
  const d = JSON.parse(readFileSync(join(KOK, 'dizin.json'), 'utf8'));
  return set === 'hepsi' ? d : d.filter((x) => x.set === set);
}

const klasorWav = (k) => readdirSync(join(KOK, k)).filter((f) => f.endsWith('.wav')).sort().map((f) => join(KOK, k, f));

/** Sürekli akış olumluları (set-hazirla akisli): klipler gerçek konuşma arasına gömülü; pencere, klibin akıştaki yeri. */
const pozAkislar = () => klasorWav('olumlu-akis').map((dosya) => ({
  kume: dosya.split(/[\\/]/).pop().split('-')[0],
  dosya,
  pencere: JSON.parse(readFileSync(`${dosya}.json`, 'utf8')),
}));
/** Penceresine (+1 sn karar payı) en az bir uyanma düşen klip sayısı. */
export const pencereVurus = (zamanlar, pencere) => pencere.filter((p) => zamanlar.some((z) => z >= p.bas && z <= p.bit + 1)).length;
const ort = (l) => (l.length ? l.reduce((t, x) => t + x, 0) / l.length : 0);

function pyAkis(dosya) {
  return new Promise((coz, red) => {
    const p = spawn(PY, ['-I', join(BURASI, 'olc.py'), '--akis', join(KOK, 'modeller/vosk/model'), dosya], { stdio: ['ignore', 'pipe', 'inherit'] });
    let c = '';
    p.stdout.on('data', (d) => { c += d; });
    p.on('close', (k) => (k === 0 ? coz(JSON.parse(c)) : red(new Error(`vosk ${dosya}: ${k}`))));
  });
}

function pyKlipler(klasor) {
  return new Promise((coz, red) => {
    const p = spawn(PY, ['-I', join(BURASI, 'olc.py'), '--json', join(KOK, 'modeller/vosk/model'), join(KOK, klasor)], { stdio: ['ignore', 'pipe', 'inherit'] });
    let c = '';
    p.stdout.on('data', (d) => { c += d; });
    p.on('close', (k) => (k === 0 ? coz(c.trim().split('\n').map((s) => JSON.parse(s))) : red(new Error(`vosk ${klasor}: ${k}`))));
  });
}

async function havuz(isler, n, calis) {
  const sonuc = new Array(isler.length);
  let sira = 0;
  await Promise.all(Array.from({ length: Math.min(n, isler.length) }, async (_, k) => {
    const ic = await calis.hazirla?.(k);
    for (;;) {
      const i = sira++;
      if (i >= isler.length) break;
      sonuc[i] = await calis.is(isler[i], ic);
    }
    await calis.bitir?.(ic);
  }));
  return sonuc;
}

const isciKullan = {
  hazirla: () => new Promise((coz, red) => {
    const w = new Worker(fileURLToPath(import.meta.url), { workerData: { isci: true }, resourceLimits: { maxOldGenerationSizeMb: 8192 } });
    w.once('message', () => coz(w));
    w.once('error', red);
  }),
  is: (x, w) => new Promise((coz, red) => {
    w.once('error', red);
    w.once('message', (m) => { w.off('error', red); coz(m); });
    w.postMessage(x);
  }),
  bitir: (w) => w.terminate(),
};

/** Klip kümelerini ve akışları tek rapora çevirir. */
function ozet(ad, ayar, kumeler, akislar, setAdi, poz = []) {
  const say = (k, kosul) => k.filter((x) => kosul(x) && x.uyandi).length;
  const pozKume = (kume) => poz.filter((x) => x.kume === kume).map((x) => pencereVurus(x.zamanlar, x.pencere));
  const p = say(kumeler.klipler, (x) => x.ad.startsWith('p'));
  const pT = kumeler.klipler.filter((x) => x.ad.startsWith('p')).length;
  const n = say(kumeler.klipler, (x) => x.ad.startsWith('n'));
  const nT = kumeler.klipler.filter((x) => x.ad.startsWith('n')).length;
  const ek = say(kumeler.ek, () => true), zor = say(kumeler.zor, () => true);
  const kat = {};
  for (const a of akislar) { const k = (kat[a.kat] ??= { yanlis: 0, sn: 0, zamanlar: [] }); k.yanlis += a.zamanlar.length; k.sn += a.sn; k.zamanlar.push(...a.zamanlar); }
  const sa = akislar.reduce((t, a) => t + a.sn, 0) / 3600;
  const yanlis = akislar.reduce((t, a) => t + a.zamanlar.length, 0);
  return { ad, ayar, set: setAdi, dogru: p, olumlu: pT, klipYanlis: n, klipOlumsuz: nT, ek, ekT: kumeler.ek.length, zor, zorT: kumeler.zor.length, saat: sa, yanlis, saatlik: sa ? yanlis / sa : 0,
    akisKlip: pozKume('klipler'), akisEk: pozKume('ek'),
    kacan: kumeler.klipler.filter((x) => x.ad.startsWith('p') && !x.uyandi).map((x) => x.ad),
    ekKacan: kumeler.ek.filter((x) => !x.uyandi).map((x) => x.ad),
    zorYanlis: kumeler.zor.filter((x) => x.uyandi).map((x) => x.ad), kat };
}

function yaz(o) {
  const kategori = Object.entries(o.kat).map(([k, v]) => `${k} ${v.yanlis}`).join(' · ');
  console.log(`${o.ad.padEnd(40)} klip ${String(o.dogru).padStart(2)}/${o.olumlu} akış ${ort(o.akisKlip).toFixed(1).padStart(4)}/20 [${o.akisKlip.join(' ')}]  n ${o.klipYanlis}/${o.klipOlumsuz}  ek ${String(o.ek).padStart(2)}/${o.ekT} akış ${ort(o.akisEk).toFixed(1).padStart(4)}/63  zor ${String(o.zor).padStart(3)}/${o.zorT}  yanlış ${String(o.yanlis).padStart(4)} (${o.saatlik.toFixed(2)}/sa, ${o.saat.toFixed(2)} sa)  [${kategori}]`);
}

function kaydet(ad, veri) {
  mkdirSync(join(KOK, 'sonuc'), { recursive: true });
  writeFileSync(join(KOK, 'sonuc', `${ad}.json`), JSON.stringify(veri, null, 1));
}

async function vosk(setAdi) {
  const n = cpus().length > 16 ? 14 : 8;
  const set = dizin(setAdi);
  const [klipler, ek, zor] = await Promise.all([pyKlipler('klipler'), pyKlipler('olumlu-ek'), pyKlipler('zor')]);
  const poz = pozAkislar();
  const hepsi = await havuz([...set, ...poz], n, { is: async (x) => ({ ...x, ...(await pyAkis(x.dosya)) }) });
  // Vosk akış testinde kilit olc.py'da değil: ürünle aynı sayım için burada uygulanır.
  const kilitli = hepsi.map((x) => ({ ...x, zamanlar: kilitle(x.zamanlar) }));
  const o = ozet('vosk (kulak.ts dil bilgisi, kural 0.45/0.97)', {}, { klipler, ek, zor }, kilitli.filter((x) => x.kat), setAdi, kilitli.filter((x) => x.kume));
  yaz(o);
  kaydet(`vosk-${setAdi}`, o);
}

async function sherpa(setAdi) {
  // --urun: yeniden yazmadan, dağıtılan ayarın kendisi (src/shared/uyandirma-ayar.ts). Son ölçüm ve tutulan set bununla koşar.
  const urun = process.argv.includes('--urun') ? (await import('../../../src/shared/uyandirma-ayar.ts')).UYANDIRMA_AYARI : null;
  const model = urun ? 'zhen16' : arg('model', 'giga');
  const anahtarlar = arg('anahtar', '').split(';').map((s) => s.trim()).filter(Boolean);
  if (!urun && !anahtarlar.length) throw new Error('--anahtar gerekli');
  const anahtar = urun ? urun.anahtar : anahtarlar.map((s, i) => (/@/.test(s) ? s : `${s} @hf${i}`)).join('\n');
  const esikler = urun ? [urun.esik] : liste(arg('esik', '0.25'));
  const skorlar = urun ? [urun.skor] : liste(arg('skor', '1'));
  const kuyruklar = urun ? [urun.kuyruk] : liste(arg('kuyruk', '1'));
  const yollar = urun ? [urun.yol] : liste(arg('yol', '4'));
  const kisa = arg('ad', urun ? 'urun' : model);
  // --hizli: yalnız olumlular (ayar denemesi); yanlış uyanma sayısı YOK, karar için tam koşu gerekir.
  const set = process.argv.includes('--hizli') ? [] : dizin(setAdi);
  const klip = klasorWav('klipler'), ek = klasorWav('olumlu-ek'), zor = klasorWav('zor');
  const ayarlar = [];
  for (const esik of esikler) for (const skor of skorlar) for (const kuyruk of kuyruklar) for (const yol of yollar) ayarlar.push({ model, anahtar, esik, skor, kuyruk, yol });
  const isler = [];
  for (const [i, ayar] of ayarlar.entries()) {
    isler.push({ i, kume: 'klipler', tur: 'klip', klipler: klip, ayar }, { i, kume: 'ek', tur: 'klip', klipler: ek, ayar }, { i, kume: 'zor', tur: 'klip', klipler: zor, ayar });
    for (const x of set) isler.push({ i, kume: 'akis', kat: x.kat, tur: 'akis', dosya: x.dosya, ayar });
    for (const x of pozAkislar()) isler.push({ i, kume: 'poz', pozKume: x.kume, pencere: x.pencere, tur: 'akis', dosya: x.dosya, ayar });
  }
  const t0 = performance.now();
  const sonuc = await havuz(isler, Number(arg('is', '14')), isciKullan);
  const raporlar = ayarlar.map((ayar, i) => {
    const s = isler.map((x, k) => ({ ...x, ...sonuc[k] })).filter((x) => x.i === i);
    const k = (ad) => s.filter((x) => x.kume === ad).flatMap((x) => x.klipler);
    const o = ozet(`${kisa} e=${ayar.esik} s=${ayar.skor} k=${ayar.kuyruk} y=${ayar.yol}`, { ...ayar }, { klipler: k('klipler'), ek: k('ek'), zor: k('zor') },
      s.filter((x) => x.kume === 'akis').map((x) => ({ kat: x.kat, zamanlar: x.zamanlar, sn: x.sn })), setAdi,
      s.filter((x) => x.kume === 'poz').map((x) => ({ kume: x.pozKume, pencere: x.pencere, zamanlar: x.zamanlar })));
    // Hangi anahtar sözcük yanlış uyandırıyor? Kümeyi kanıtla budamak için.
    const yanlisAnahtar = {};
    for (const x of s.filter((y) => y.kume === 'akis')) for (const [a, n] of Object.entries(x.anahtarlar ?? {})) yanlisAnahtar[a] = (yanlisAnahtar[a] ?? 0) + n;
    o.yanlisAnahtar = yanlisAnahtar;
    yaz(o);
    if (Object.keys(yanlisAnahtar).length) console.log(`    yanlış anahtar: ${Object.entries(yanlisAnahtar).sort((a, b) => b[1] - a[1]).map(([a, n]) => `${a}=${n}`).join(' ')}`);
    return o;
  });
  const akisMs = sonuc.reduce((t, r, k) => t + (isler[k].kume === 'akis' ? r.ms : 0), 0);
  const akisSn = sonuc.reduce((t, r, k) => t + (isler[k].kume === 'akis' ? r.sn : 0), 0);
  console.log(`süre ${((performance.now() - t0) / 60000).toFixed(1)} dk · gerçek zaman katsayısı (RTF, tek çekirdek) ${(akisMs / 1000 / Math.max(akisSn, 1)).toFixed(4)}`);
  kaydet(`${kisa}-${setAdi}-${Date.now()}`, raporlar);
}

if (!isMainThread && workerData?.isci) await isci();
else if (isMainThread && process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const motor = process.argv[2];
  const setAdi = arg('set', 'ayar');
  if (!existsSync(join(KOK, 'dizin.json'))) throw new Error('önce: node scripts/dev/uyandirma/set-hazirla.mjs');
  process.chdir(KOK);
  if (motor === 'vosk') await vosk(setAdi);
  else if (motor === 'sherpa') await sherpa(setAdi);
  else console.error('kullanım: olc.mjs vosk|sherpa …');
}
