#!/usr/bin/env node
// ── Uyandırma test seti (0.13 T8): olumlu klipler + saatlerce olumsuz ses; hepsi cihazda, depoya girmez ─────────────────────────────
// Çıktı .superpowers/uyandirma/ altındadır (.gitignore). Her adım çıktısı varsa atlanır; yeniden üretmek için dosyayı sil.
//   node scripts/dev/uyandirma/set-hazirla.mjs [adım …]        adımlar: arac klipler cv tolga piper olumlu kamu gurultu zor bol akisli
// KAYNAKLAR (mikrofon kullanılmaz):
//   · klipler/    : tolga.ps1 + klipler-1/2.txt — "16/20" bu 50 klibin (20 olumlu, 30 olumsuz) sonucudur (19 Eki), aynı set yeniden ölçülür.
//   · cv-tr       : Mozilla Common Voice 17 Türkçe (CC0), gerçek insan sesi; ysdede/commonvoice_17_tr_fixed test bölümü, ≈7,3 saat.
//   · tolga-tr, piper-tr : Common Voice cümleleri Windows Tolga ve üç Piper Türkçe sesiyle okunur (cümle arası 0,25–1 sn).
//   · kamu-konusma (LibriVox), kamu-video (Prelinger), kamu-muzik-tr (1930 öncesi taş plaklar), kamu-muzik (Musopen).
//     archive.org'un lisans etiketi kimi yerde yanlıştır (güncel filmler "public domain" görünüyor): bu yüzden liste elle seçilmiş, sabittir;
//     etiket indirirken yine doğrulanır, kamu malı/CC0 değilse kaynak atlanır.
//   · gurultu     : seedli sentetik klavye, darbe, uğultu (sorun: her ses tetikliyordu).
//   · zor/        : kasıtlı benzer sözler (zor-cumleler.txt); saatlik orana KATILMAZ, ayrı "yanlış / klip" olarak sayılır.
//   · olumlu-ek/  : üç Piper sesi "Hey Fuber" der; eşik ayarında kullanılmaz, başka seslerde genelleme sınavıdır.
// bol: her olumsuz kategori "-ayar" ve "-sinama" diye ikiye ayrılır. Eşik yalnız ayar setinde seçilir, sınama setiyle sonra bir kez ölçülür.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BURASI = dirname(fileURLToPath(import.meta.url));
const DEPO = resolve(BURASI, '../../..');
const KOK = join(DEPO, '.superpowers/uyandirma');
const HAM = join(KOK, 'ham');
const NEG = join(KOK, 'olumsuz');
const PY = join(KOK, 'venv/Scripts/python.exe');
const HZ = 16000;
const YARDIMCI = join(BURASI, 'set-yardimci.py');
const CV_URL = 'https://huggingface.co/datasets/ysdede/commonvoice_17_tr_fixed/resolve/main/data/test-00000-of-00001.parquet';
// rhasspy/piper-voices bugün yalnız dfki'yi tutuyor; üç ses de sherpa-onnx'in hazır VITS paketinden gelir (model + espeak verisi bir arada).
const PIPER_URL = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models';
const PIPER_SESLER = ['dfki', 'fahrettin', 'fettah'];
const CV_AYAR_SN = 2 * 3600;

// Elle seçilmiş kaynaklar. tek: bu kimlikten alınacak dosya adı parçası; sn: en uzun süre.
const KAMU = [
  { kat: 'kamu-konusma', kimlik: 'gallipoli_2410_librivox', dosya: ['gallipoli_01_masefield_64kb.mp3', 'gallipoli_02_masefield_64kb.mp3'], dil: 'en' },
  { kat: 'kamu-konusma', kimlik: 'ausgewahlte_erzahlungen_puschkin_1505_librivox', dosya: ['erzaehlungen_01_puschkin_64kb.mp3'], dil: 'de' },
  { kat: 'kamu-konusma', kimlik: 'keraban-le-tetu_ezwa_1001_librivox', dosya: ['kerabanletetu_01_verne_64kb.mp3', 'kerabanletetu_02_verne_64kb.mp3'], dil: 'fr' },
  { kat: 'kamu-konusma', kimlik: 'white_nights_librivox', dosya: ['1-fm-dostoevsky-belye-nochi-night1_64kb.mp3'], dil: 'ru' },
  ...['Sleepfor1950', 'AboutBan1935', 'FromtheG1954', 'Doctorin1946', 'HealthYo1953', 'JoanAvoi1947', 'EatforHe1954', 'Automoti1940'].map((kimlik) => ({ kat: 'kamu-video', kimlik, uzanti: '.mp3' })),
  ...['BenYemenimiAlIsterim-HafizBurhan', 'BozlakAndHalay-YozgatliHafizSuleymanBey', 'EgilDaglarUstundenAsam-ViktoriyaHanim', 'HalayHavasiagriDagindanUctum-ZurnaciHalil',
    'Harmandali-RecepEfendiCemalEfendi', 'KadifedenKesesi-HafizBurhan', 'loc-jukebox-20795-chifta-telly-gazel', 'loc-jukebox-34204-rast-gazel', 'SariZeybek-HanendeIbrahimEfendi'].map((kimlik) => ({ kat: 'kamu-muzik-tr', kimlik, uzanti: '.mp3' })),
  { kat: 'kamu-muzik', kimlik: 'musopen-chopin', uzanti: '.mp3', enCokDosya: 16 },
  { kat: 'kamu-muzik', kimlik: 'musopen-mozart-marriage-of-figaro-compressed', uzanti: '.ogg', enCokDosya: 12 },
];

const calistir = (komut, argv, o = {}) => {
  const r = spawnSync(komut, argv, { stdio: ['ignore', 'inherit', 'inherit'], ...o });
  if (r.status !== 0) throw new Error(`${komut} ${argv.slice(0, 4).join(' ')} başarısız (${r.status ?? r.error})`);
};

/** Ses dosyasını (yerel ya da URL) 16 kHz mono ham PCM16'ya çevirir. */
const hamYap = (giris, cikis, ek = []) => calistir('ffmpeg', ['-y', '-v', 'error', ...ek, '-i', giris, '-map', '0:a:0', '-ac', '1', '-ar', String(HZ), '-f', 's16le', cikis]);

/** Ham PCM16 parçalarını tek WAV'da birleştirir (bellekte tutmadan). */
function wavBirlestir(parcalar, cikis) {
  const toplam = parcalar.reduce((t, p) => t + statSync(p).size, 0);
  const b = Buffer.alloc(44);
  b.write('RIFF', 0); b.writeUInt32LE(36 + toplam, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(HZ, 24); b.writeUInt32LE(HZ * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(toplam, 40);
  const fd = openSync(cikis, 'w');
  writeFileSync(fd, b);
  const t = Buffer.alloc(1 << 20);
  for (const p of parcalar) {
    const g = openSync(p, 'r');
    for (let n; (n = readSync(g, t, 0, t.length, null)) > 0;) writeFileSync(fd, t.subarray(0, n));
    closeSync(g);
  }
  closeSync(fd);
}

/** WAV'ın [bas, bit) aralığını (sn) yeni WAV'a keser. */
function wavKes(giris, cikis, bas, bit) {
  const fd = openSync(giris, 'r');
  const boy = statSync(giris).size - 44;
  const baslangic = 44 + Math.min(boy, Math.round(bas * HZ) * 2);
  const son = 44 + Math.min(boy, Math.round(bit * HZ) * 2);
  const yol = `${cikis}.ham`;
  const g = openSync(yol, 'w');
  const t = Buffer.alloc(1 << 20);
  for (let k = baslangic; k < son;) { const n = readSync(fd, t, 0, Math.min(t.length, son - k), k); if (!n) break; writeFileSync(g, t.subarray(0, n)); k += n; }
  closeSync(g); closeSync(fd);
  wavBirlestir([yol], cikis);
  rmSync(yol);
}

const wavSn = (f) => (statSync(f).size - 44) / 2 / HZ;
const klasor = (d) => { mkdirSync(d, { recursive: true }); return d; };

function arac() {
  if (existsSync(PY)) return;
  calistir('uv', ['venv', '--python', '3.12', join(KOK, 'venv'), '-q']);
  calistir('uv', ['pip', 'install', '-q', '--python', PY, 'sherpa-onnx', 'vosk', 'piper-tts', 'pyarrow', 'soundfile', 'numpy', 'sentencepiece']);
}

function klipler() {
  const d = klasor(join(KOK, 'klipler'));
  if (readdirSync(d).filter((f) => f.endsWith('.wav')).length >= 50) return;
  const hamD = klasor(join(HAM, 'klipler'));
  for (const l of ['klipler-1.txt', 'klipler-2.txt']) calistir('powershell', ['-ExecutionPolicy', 'Bypass', '-File', join(BURASI, 'tolga.ps1'), '-Klasor', hamD, '-Liste', join(BURASI, l)]);
  for (const f of readdirSync(hamD).filter((x) => x.endsWith('.wav'))) {
    const r = join(HAM, `${f}.pcm`);
    hamYap(join(hamD, f), r);
    wavBirlestir([r], join(d, f));
    rmSync(r);
  }
}

async function indir(url, yol) {
  if (existsSync(yol)) return;
  mkdirSync(dirname(yol), { recursive: true });
  const y = await fetch(url);
  if (!y.ok) throw new Error(`${url}: ${y.status}`);
  writeFileSync(yol, Buffer.from(await y.arrayBuffer()));
}

async function cv() {
  const ayar = join(KOK, 'cv-tr-ayar.wav');
  if (existsSync(ayar)) return;
  const p = join(HAM, 'cv/test.parquet');
  await indir(CV_URL, p);
  calistir(PY, ['-I', YARDIMCI, 'cv', p, ayar, join(KOK, 'cv-tr-sinama.wav'), join(KOK, 'metinler.txt'), String(CV_AYAR_SN)]);
}

const ssmlKacis = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\|/g, ' ');
/** Common Voice cümlelerinin kimi "\r" ile biter; Get-Content onu satır sonu sayar, liste bölünür. */
const metinler = () => readFileSync(join(KOK, 'metinler.txt'), 'utf8').split('\n').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);

/** Tolga: 25 cümlelik öbekler; öbek başı/sonu boşluğu (2,2 sn) saatte yüzde 2'nin altında kalır. Cümle arası 400 ms. */
function tolga() {
  const cikti = join(NEG, 'tolga-tr.wav');
  if (existsSync(cikti)) return;
  klasor(NEG);
  const d = klasor(join(HAM, 'tolga'));
  const metin = metinler().slice(0, 1000);
  const satir = [];
  for (let i = 0; i < metin.length; i += 25) satir.push(`t${String(i / 25).padStart(3, '0')}|${metin.slice(i, i + 25).map(ssmlKacis).join("<break time='400ms'/>")}`);
  const liste = join(d, 'liste.txt');
  writeFileSync(liste, satir.join('\n'), 'utf8');
  calistir('powershell', ['-ExecutionPolicy', 'Bypass', '-File', join(BURASI, 'tolga.ps1'), '-Klasor', d, '-Liste', liste]);
  const parcalar = [];
  for (const f of readdirSync(d).filter((x) => x.endsWith('.wav')).sort()) { const r = join(d, `${f}.pcm`); hamYap(join(d, f), r); parcalar.push(r); }
  wavBirlestir(parcalar, cikti);
  for (const p of parcalar) rmSync(p);
}

async function piperModelleri() {
  const d = klasor(join(HAM, 'piper'));
  for (const s of PIPER_SESLER) {
    const ad = `vits-piper-tr_TR-${s}-medium`;
    if (existsSync(join(d, s, 'tokens.txt'))) continue;
    await indir(`${PIPER_URL}/${ad}.tar.bz2`, join(d, `${ad}.tar.bz2`));
    klasor(join(d, s));
    calistir('tar', ['xjf', join(d, `${ad}.tar.bz2`), '-C', join(d, s), '--strip-components=1']);
  }
  return d;
}

async function piper() {
  const cikti = join(NEG, 'piper-tr.wav');
  if (existsSync(cikti)) return;
  klasor(NEG);
  const d = await piperModelleri();
  const parcalar = [];
  for (const [i, s] of PIPER_SESLER.entries()) {
    const ham = join(d, `${s}-neg.wav`);
    if (!existsSync(ham)) calistir(PY, ['-I', YARDIMCI, 'piper', join(d, s), join(KOK, 'metinler.txt'), ham, '320', String(1000 + i * 400)]);
    const r = join(d, `${s}-neg.pcm`);
    hamYap(ham, r);
    parcalar.push(r);
  }
  wavBirlestir(parcalar, cikti);
  for (const p of parcalar) rmSync(p);
}

/** Tutulan sınav: başka seslerde "Hey Fuber". Klip düzeni Tolga klipleriyle aynı (öncesinde 0,7 sn, sonrasında 1,5 sn sessizlik). */
async function olumlu() {
  const d = klasor(join(KOK, 'olumlu-ek'));
  if (readdirSync(d).filter((f) => f.endsWith('.wav')).length) return;
  const m = await piperModelleri();
  const hamD = klasor(join(HAM, 'olumlu-ek'));
  for (const s of PIPER_SESLER) calistir(PY, ['-I', YARDIMCI, 'olumlu', join(m, s), hamD, s]);
  for (const f of readdirSync(hamD).filter((x) => x.endsWith('.wav'))) {
    const r = join(HAM, `${f}.pcm`);
    hamYap(join(hamD, f), r);
    wavBirlestir([r], join(d, f));
    rmSync(r);
  }
}

async function kamu() {
  klasor(NEG);
  const cap = { 'kamu-konusma': 1500, 'kamu-video': 1500, 'kamu-muzik-tr': 400, 'kamu-muzik': 420 };
  const lisanslar = [];
  const parcalar = {};
  for (const k of KAMU) {
    (parcalar[k.kat] ??= []);
    if (existsSync(join(NEG, `${k.kat}.wav`))) continue;
    let m = null;
    for (let d = 0; d < 4 && !m; d++) {
      m = await fetch(`https://archive.org/metadata/${k.kimlik}`).then((y) => y.json()).catch(() => null);
      if (!m) await new Promise((coz) => setTimeout(coz, 4000));
    }
    if (!m) { console.warn(`  atlandı (üstveri yok): ${k.kimlik}`); continue; }
    const lisans = m.metadata?.licenseurl ?? '';
    if (!/publicdomain/.test(lisans)) { console.warn(`  atlandı (kamu malı değil): ${k.kimlik} ${lisans}`); continue; }
    const adaylar = (m.files ?? []).map((f) => f.name).filter((n) => (k.dosya ? k.dosya.includes(n) : n.toLowerCase().endsWith(k.uzanti)) && !/_64kb|_128kb|spectrogram/i.test(k.dosya ? '' : n)).sort();
    const secilen = adaylar.slice(0, k.enCokDosya ?? adaylar.length);
    if (!secilen.length) { console.warn(`  atlandı (dosya yok): ${k.kimlik}`); continue; }
    lisanslar.push({ kat: k.kat, kimlik: k.kimlik, lisans, dosya: secilen });
    for (const [i, n] of secilen.entries()) {
      const r = join(klasor(join(HAM, 'kamu', k.kat)), `${createHash('sha1').update(k.kimlik + n).digest('hex').slice(0, 12)}.pcm`);
      if (!existsSync(r)) {
        const url = `https://archive.org/download/${k.kimlik}/${n.split('/').map(encodeURIComponent).join('/')}`;
        const sn = String(cap[k.kat]);
        // archive.org arada 5xx verir: üç deneme; olmazsa kaynak atlanır, set elde kalanla sürer (dizin süreyi dürüstçe gösterir).
        let oldu = false;
        for (let d = 0; d < 3 && !oldu; d++) {
          oldu = spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', url, '-t', sn, '-map', '0:a:0', '-ac', '1', '-ar', String(HZ), '-f', 's16le', r], { stdio: 'ignore' }).status === 0;
        }
        if (!oldu) { console.warn(`  atlandı (indirilemedi): ${k.kimlik}/${n}`); rmSync(r, { force: true }); continue; }
        console.log(`  ${k.kat} ${k.kimlik}#${i} ${(statSync(r).size / 2 / HZ / 60).toFixed(1)} dk`);
      }
      parcalar[k.kat].push(r);
    }
  }
  for (const [kat, p] of Object.entries(parcalar)) if (p.length) wavBirlestir(p, join(NEG, `${kat}.wav`));
  if (lisanslar.length) writeFileSync(join(KOK, 'kamu-lisanslar.json'), JSON.stringify(lisanslar, null, 2));
}

/** Tekrarlanabilir küçük üreteç (mulberry32): set her çalıştırmada aynı çıkar. */
function rastgele(tohum) {
  return () => { tohum |= 0; tohum = (tohum + 0x6d2b79f5) | 0; let t = Math.imul(tohum ^ (tohum >>> 15), 1 | tohum); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function gurultu() {
  const cikti = join(NEG, 'gurultu.wav');
  if (existsSync(cikti)) return;
  klasor(NEG);
  const r = rastgele(20261031);
  const n = 600 * HZ;
  const o = new Float32Array(n);
  // 0–240 sn klavye: 3–8 vuruş/sn, 8 ms çürüyen tiz gürültü patlaması
  for (let t = 0; t < 240 * HZ;) {
    const g = 0.05 + r() * 0.25, s = Math.round(0.008 * HZ * (1 + r() * 2));
    for (let i = 0; i < s * 5 && t + i < n; i++) o[t + i] += g * (r() * 2 - 1) * Math.exp(-i / s);
    t += Math.round(HZ / (3 + r() * 5));
  }
  // 240–420 sn darbe (kapı, masa): 0,4–2 sn arayla çürüyen alçak frekans
  for (let t = 240 * HZ; t < 420 * HZ;) {
    const f = 60 + r() * 180, g = 0.2 + r() * 0.5, s = Math.round(0.05 * HZ * (1 + r() * 3));
    for (let i = 0; i < s * 5 && t + i < n; i++) o[t + i] += g * Math.sin(2 * Math.PI * f * i / HZ) * Math.exp(-i / s) + 0.05 * (r() * 2 - 1) * Math.exp(-i / (s / 8));
    t += Math.round(HZ * (0.4 + r() * 1.6));
  }
  // 420–600 sn fan: 120 Hz uğultu + harmonikler + geniş bant hışırtı, yavaş genlik salınımı
  for (let t = 420 * HZ, s = 0; t < n; t++) {
    const sn = t / HZ;
    s = 0.97 * s + 0.03 * (r() * 2 - 1); // pembemsi
    o[t] += (0.05 * Math.sin(2 * Math.PI * 120 * sn) + 0.02 * Math.sin(2 * Math.PI * 240 * sn) + 0.01 * Math.sin(2 * Math.PI * 360 * sn) + 0.6 * s) * (0.8 + 0.2 * Math.sin(2 * Math.PI * 0.3 * sn));
  }
  const pcm = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(o[i] * 32767))), i * 2);
  const yol = join(NEG, 'gurultu.pcm');
  writeFileSync(yol, pcm);
  wavBirlestir([yol], cikti);
  rmSync(yol);
}

/** Kasıtlı benzer sözler: Tolga + üç Piper sesi; klip başına tek cümle. */
async function zor() {
  const d = klasor(join(KOK, 'zor'));
  if (readdirSync(d).filter((f) => f.endsWith('.wav')).length) return;
  const m = await piperModelleri();
  const cumle = readFileSync(join(BURASI, 'zor-cumleler.txt'), 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
  const hamD = klasor(join(HAM, 'zor'));
  const liste = join(hamD, 'liste.txt');
  writeFileSync(liste, cumle.map((c, i) => `tolga_${String(i).padStart(3, '0')}|${ssmlKacis(c)}`).join('\n'), 'utf8');
  calistir('powershell', ['-ExecutionPolicy', 'Bypass', '-File', join(BURASI, 'tolga.ps1'), '-Klasor', hamD, '-Liste', liste]);
  const cumleD = join(hamD, 'cumleler.txt');
  writeFileSync(cumleD, cumle.join('\n'), 'utf8');
  for (const s of PIPER_SESLER) calistir(PY, ['-I', YARDIMCI, 'klipler', join(m, s), cumleD, hamD, s]);
  for (const f of readdirSync(hamD).filter((x) => x.endsWith('.wav'))) {
    const r = join(HAM, `${f}.pcm`);
    hamYap(join(hamD, f), r);
    wavBirlestir([r], join(d, f));
    rmSync(r);
  }
}

/** Her kategoriyi ayar/sınama diye ikiye böler ve dizini yazar. */
function bol() {
  const d = klasor(join(KOK, 'olcum'));
  const dizin = [];
  const ekle = (set, kat, kaynak, bas = 0, bit = null) => {
    const f = join(d, `${kat}-${set}.wav`);
    const son = bit ?? wavSn(kaynak);
    if (!existsSync(f)) wavKes(kaynak, f, bas, son);
    dizin.push({ set, kat, dosya: f, sn: wavSn(f) });
  };
  ekle('ayar', 'cv-tr', join(KOK, 'cv-tr-ayar.wav'));
  ekle('sinama', 'cv-tr', join(KOK, 'cv-tr-sinama.wav'));
  for (const f of readdirSync(NEG).filter((x) => x.endsWith('.wav'))) {
    const kat = f.slice(0, -4), yol = join(NEG, f), yari = wavSn(yol) / 2;
    ekle('ayar', kat, yol, 0, yari);
    ekle('sinama', kat, yol, yari);
  }
  writeFileSync(join(KOK, 'dizin.json'), JSON.stringify(dizin, null, 2));
  const sa = (k) => dizin.filter(k).reduce((t, x) => t + x.sn, 0) / 3600;
  for (const x of dizin) console.log(`  ${x.set.padEnd(7)} ${x.kat.padEnd(15)} ${(x.sn / 60).toFixed(1).padStart(7)} dk`);
  console.log(`ayar ${sa((x) => x.set === 'ayar').toFixed(2)} sa · sınama ${sa((x) => x.set === 'sinama').toFixed(2)} sa`);
}

/** Sürekli akış ölçümü. Uygulama tek akışı saatlerce dinler; klip başına taze akış, sözün kodlayıcı parçasına (chunk) denk düştüğü TEK konumu
 *  örnekler ve şanslı çıkabilir (31 Eki: aynı 20 klip taze akışta 18, tek akışta 14-17). Burada klipler gerçek konuşma ve sessizlik arasına
 *  gömülür; dört tohum dört farklı hizalama verir. Her motor aynı WAV'ları dinler; uyanma klip penceresine düşerse doğru sayılır. */
function akisli() {
  const d = klasor(join(KOK, 'olumlu-akis'));
  const cv = readFileSync(join(KOK, 'olcum/cv-tr-ayar.wav')).subarray(44, 44 + 600 * HZ * 2);
  const hazirla = (kume, klipYol, tohum) => {
    const f = join(d, `${kume}-${tohum}.wav`);
    if (existsSync(f)) return;
    const r = rastgele(tohum * 7919);
    const parca = [], pencere = [];
    let n = 0;
    const ekle = (b) => { parca.push(b); n += b.length; };
    for (const k of klipYol) {
      const konusma = Math.round((2 + r() * 5) * HZ) * 2;
      const bas = Math.floor(r() * (cv.length - konusma) / 2) * 2;
      ekle(cv.subarray(bas, bas + konusma));
      ekle(Buffer.alloc(Math.round((0.5 + r() * 2.5) * HZ) * 2));
      const klip = readFileSync(k).subarray(44);
      pencere.push({ ad: k.split(/[\\/]/).pop().slice(0, -4), bas: n / 2 / HZ, bit: (n + klip.length) / 2 / HZ });
      ekle(klip);
    }
    const ham = `${f}.pcm`;
    writeFileSync(ham, Buffer.concat(parca));
    wavBirlestir([ham], f);
    rmSync(ham);
    writeFileSync(`${f}.json`, JSON.stringify(pencere));
  };
  const yollar = (k, s = () => true) => readdirSync(join(KOK, k)).filter((x) => x.endsWith('.wav') && s(x)).sort().map((x) => join(KOK, k, x));
  for (const t of [1, 2, 3, 4]) { hazirla('klipler', yollar('klipler', (x) => x.startsWith('p')), t); hazirla('ek', yollar('olumlu-ek'), t); }
}

const ADIMLAR = { arac, klipler, cv, tolga, piper, olumlu, kamu, gurultu, zor, bol, akisli };
const istenen = process.argv.slice(2);
for (const [ad, f] of Object.entries(ADIMLAR)) {
  if (istenen.length && !istenen.includes(ad)) continue;
  console.log(`▶ ${ad}`);
  await f();
}
