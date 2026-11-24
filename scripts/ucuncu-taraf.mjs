#!/usr/bin/env node
// THIRD_PARTY_NOTICES üreticisi (açık kaynak hazırlığı, 11 Kas). Ağa çıkmaz: kurulu node_modules'u okur.
//   · Üretim bağımlılık ağacı (`npm ls --omit=dev --all --parseable`) — pakete (asar) girenler.
//   · Arayüze derlenen geliştirme bağımlılıkları (React, React DOM, scheduler, DOMPurify, Marked, vosk-browser) — dist/renderer içine gömülür.
//   · Elle listelenen paket içi ikililer/modeller ve çalışma anında kullanıcının indirdiği bileşenler (aşağıda VARLIKLAR, INDIRILENLER).
// Lisans metinleri aynı metni taşıyan paketler tek başlıkta toplanarak eklenir. Çıktı: docs/acik-kaynak/genel-depo/THIRD_PARTY_NOTICES.md
// (dışa aktarmada depo köküne gider). Kullanım: node scripts/ucuncu-taraf.mjs [--denetle] [--ozel]
//   --denetle: dosya güncel değilse 1 ile çıkar (CI).
// İsteğe bağlı modüller (ozel/<modül>/; bu depoda yok): package.json'da `ozelModulBagimliliklari` varsa o paketler ve YALNIZ onlar yüzünden kurulanlar
// bu bildirime GİRMEZ. `--ozel`: modüllerin ek bildirimi — her modülün yalnız kendine ait paketleri `ozel/<modül>/THIRD_PARTY_NOTICES.md`'ye (modülle
// birlikte kalır).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { uretimKapanisi } from './paket-bekcisi.mjs';

const KOK = path.resolve(import.meta.dirname, '..');
// Özel depoda genel depo dosyalarının kaynağına (docs/acik-kaynak/genel-depo/), genel depoda köke yazılır.
const OZEL_KAYNAK = path.join(KOK, 'docs', 'acik-kaynak', 'genel-depo');
export const CIKTI = fs.existsSync(OZEL_KAYNAK) ? path.join(OZEL_KAYNAK, 'THIRD_PARTY_NOTICES.md') : path.join(KOK, 'THIRD_PARTY_NOTICES.md');
const ARAYUZE_GOMULU = ['react', 'react-dom', 'scheduler', 'dompurify', 'marked', 'vosk-browser'];
/** Pakete girmeyen ama ağaçta görünen (electron-builder.yml dışlaması): Agent SDK'nın kendi Claude Code ikilileri. */
const PAKETE_GIRMEZ = /^@anthropic-ai\/claude-agent-sdk-/;
/** Dağıtımda dikkat isteyen lisanslar (copyleft, özel ya da bilinmeyen koşullar). */
export const DIKKAT = /(^|[^L])GPL|AGPL|LGPL|SSPL|BUSL|SEE LICENSE|UNLICENSED|BİLİNMİYOR|CC-BY-NC|Commons Clause/i;

export const VARLIKLAR = [
  ['Electron / Chromium', 'MIT (Electron), BSD-3-Clause and others (Chromium)', 'The packaged app ships `LICENSE` and `LICENSES.chromium.html` from Electron next to the executable.'],
  ['Manrope variable font', 'SIL OFL 1.1', '`resources/fonts/Manrope-Variable.woff2`, license `resources/fonts/OFL-Manrope.txt`.'],
  ['Vosk Turkish model (vosk-model-small-tr-0.3)', 'Apache-2.0', '`resources/vosk/tr.tar.gz`, repacked from https://alphacephei.com/vosk/models/vosk-model-small-tr-0.3.zip (see `resources/vosk/README.md`).'],
  ['sherpa-onnx keyword spotting (WASM + zipformer KWS model)', 'Apache-2.0', '`resources/uyandirma/` (see `LISANSLAR.txt`).'],
  ['ONNX Runtime (inside sherpa-onnx WASM)', 'MIT', '`resources/uyandirma/ThirdPartyNotices-onnxruntime.txt`.'],
  ['Icons and logo artwork', 'Fuber AI brand assets (see TRADEMARKS.md)', '`resources/ikon/`, `build/` — not covered by the code license. The notification sound `resources/ses/odak-zil.wav` is synthesized by `scripts/dev/zil-uret.mjs` and covered by the Apache License 2.0 (see NOTICE).'],
  ['Lucide and Feather icons (adapted path data)', 'ISC (Lucide) and MIT (Feather)', 'Some UI icon paths in `src/renderer/bilesenler/Ikon.tsx` are adapted from Lucide (© Lucide Icons and Contributors) and Feather (© Cole Bemis). License: `resources/lisanslar/LUCIDE-LICENSE.txt`, reproduced under "Bundled asset license texts" below.'],
  ['fuber-girdi.exe, fuber-olay.exe', 'Same as this repository', 'Built from `native/` (not committed).'],
];
/** Paket dışı varlıkların lisans metinleri (bildirimin sonunda dosyadan birebir): [başlık, depo köküne göre dosya]. */
export const VARLIK_METINLERI = [
  ['Lucide and Feather icons (adapted in `src/renderer/bilesenler/Ikon.tsx`)', 'resources/lisanslar/LUCIDE-LICENSE.txt'],
];
export const INDIRILENLER = [
  ['llama.cpp (PrismML fork) server binaries', 'MIT', 'Downloaded on demand for local models (`src/main/yerel/paketler.ts`).'],
  ['Ternary Bonsai 2 GGUF models (prism-ml; 27B, 9B, 4B)', 'Apache-2.0 (model cards)', 'Downloaded on demand for local models from Hugging Face (`prism-ml/Ternary-Bonsai-2-*-gguf`; Qwen-based).'],
  ['whisper.cpp + ggml models', 'MIT', 'Downloaded on demand for local transcription (`src/main/gunkaydi/whisper.ts`).'],
  ['Piper TTS (rhasspy/piper 2023.11.14-2)', 'MIT', 'Downloaded on demand for local speech.'],
  ['Piper voice tr_TR-dfki-medium (fallback voice)', 'CC BY-NC-SA 4.0 — non-commercial', 'Downloaded on demand from rhasspy/piper-voices. Trained on the DFKI OT dataset (https://github.com/marytts/dfki-ot-data), licensed CC BY-NC-SA 4.0 (https://creativecommons.org/licenses/by-nc-sa/4.0/): non-commercial use only, with attribution and share-alike. Commercial distributions must replace this voice.'],
  ['uv (Astral)', 'MIT OR Apache-2.0', 'Downloaded on demand for Claude Code plugins that need Python.'],
];

function npmYollari(argv) {
  // npm'in kendi betiği Node ile çalıştırılır (kabuk yok): npm_execpath (npm run altında) ya da Node'un yanındaki npm-cli.js.
  const cli = [process.env.npm_execpath, path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')].find((y) => y && /npm-cli\.js$/.test(y) && fs.existsSync(y));
  const [komut, onEk] = cli ? [process.execPath, [cli]] : [process.platform === 'win32' ? 'npm.cmd' : 'npm', []];
  try {
    return execFileSync(komut, [...onEk, 'ls', ...argv, '--all', '--parseable'], { cwd: KOK, encoding: 'utf8', shell: !cli && process.platform === 'win32', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 32 * 1024 * 1024 })
      .split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch (e) {
    // npm ls, ağaçta "extraneous" gibi uyarılar varsa sıfırdan farklı kodla çıkar; çıktısı yine geçerlidir.
    return String(e.stdout ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  }
}

function lisansAdi(pk) {
  if (typeof pk.license === 'string') return pk.license;
  if (pk.license && typeof pk.license === 'object' && pk.license.type) return pk.license.type;
  if (Array.isArray(pk.licenses)) return pk.licenses.map((l) => (typeof l === 'string' ? l : l.type)).join(' OR ');
  return 'BİLİNMİYOR';
}

function lisansMetni(dizin) {
  const ad = fs.readdirSync(dizin).find((d) => /^(licen[cs]e|copying|notice)(\.|$|-)/i.test(d) && fs.statSync(path.join(dizin, d)).isFile());
  return ad ? fs.readFileSync(path.join(dizin, ad), 'utf8').replace(/\r\n/g, '\n').trim() : null;
}

const depoAdresi = (pk) => {
  const r = typeof pk.repository === 'string' ? pk.repository : pk.repository?.url;
  return r ? r.replace(/^git\+/, '').replace(/\.git$/, '').replace(/^git:\/\//, 'https://').replace(/^github:/, 'https://github.com/') : (pk.homepage ?? '');
};

const kokPaketi = () => JSON.parse(fs.readFileSync(path.join(KOK, 'package.json'), 'utf8'));
const gercekYol = (y) => { try { return fs.realpathSync.native(y).toLowerCase(); } catch { return path.resolve(y).toLowerCase(); } };

/**
 * İsteğe bağlı modül paketlerinin ayrımı: `genel` — özel modüller olmadan da kurulan paket klasörleri; `modul[ad]` — o modülün yalnız kendine ait paket
 * klasörleri (genelde olmayanlar). `ozelModulBagimliliklari` yoksa (genel ağaç) null.
 */
export function ozelAyrim(pk = kokPaketi()) {
  const liste = pk.ozelModulBagimliliklari;
  if (!liste || !Object.keys(liste).length) return null;
  const ozel = new Set(Object.values(liste).flat());
  const sadece = (o) => Object.fromEntries(Object.entries(o ?? {}).filter(([ad]) => !ozel.has(ad)));
  const genel = new Set(uretimKapanisi(KOK, { dependencies: sadece(pk.dependencies), optionalDependencies: sadece(pk.optionalDependencies) }, { esler: true }).paketler.map((p) => gercekYol(p.yer)));
  const modul = {};
  for (const [ad, paketler] of Object.entries(liste)) {
    const kume = uretimKapanisi(KOK, { optionalDependencies: Object.fromEntries(paketler.map((x) => [x, '*'])) }, { esler: true }).paketler.map((p) => gercekYol(p.yer)).filter((y) => !genel.has(y));
    modul[ad] = new Set(kume);
  }
  return { genel, modul };
}

/** Paket listesi: { ad, surum, lisans, depo, metin, yer } (saf olmayan: node_modules okur). `ozelModul`: yalnız o özel modülün paketleri. */
export function paketleriTopla({ ozelModul } = {}) {
  const ayrim = ozelAyrim();
  const uretim = npmYollari(['--omit=dev']).slice(1);
  const arayuz = ozelModul ? [] : npmYollari(ARAYUZE_GOMULU);
  const gorulen = new Map();
  for (const [yollar, yer] of [[uretim, 'app (asar)'], [arayuz, 'renderer bundle']]) {
    for (const d of yollar) {
      if (ayrim && yer === 'app (asar)') {
        const g = gercekYol(d);
        if (ozelModul ? !ayrim.modul[ozelModul]?.has(g) : !ayrim.genel.has(g)) continue; // genel bildirime özel modül paketi girmez (ve tersi)
      }
      const y = path.join(d, 'package.json');
      if (!fs.existsSync(y)) continue;
      const pk = JSON.parse(fs.readFileSync(y, 'utf8'));
      if (!pk.name || PAKETE_GIRMEZ.test(pk.name)) continue;
      const anahtar = `${pk.name}@${pk.version}`;
      if (gorulen.has(anahtar)) continue;
      gorulen.set(anahtar, { ad: pk.name, surum: pk.version, lisans: lisansAdi(pk), depo: depoAdresi(pk), metin: lisansMetni(d), yer });
    }
  }
  return [...gorulen.values()].sort((a, b) => a.ad.localeCompare(b.ad) || a.surum.localeCompare(b.surum));
}

const kacis = (s) => String(s).replace(/\|/g, '\\|');

export function bildirimMetni(paketler) {
  const sayim = new Map();
  for (const p of paketler) sayim.set(p.lisans, (sayim.get(p.lisans) ?? 0) + 1);
  const dikkat = paketler.filter((p) => DIKKAT.test(p.lisans));
  const s = [];
  s.push('# Third-party notices', '');
  s.push('This file is generated by `node scripts/ucuncu-taraf.mjs` from the installed dependency tree. Do not edit by hand.', '');
  s.push(`Packages: ${paketler.length} (production dependencies packaged into the app, plus libraries compiled into the renderer bundle).`, '');
  s.push('## License summary', '', '| License | Packages |', '|---|---|');
  for (const [l, c] of [...sayim.entries()].sort((a, b) => b[1] - a[1])) s.push(`| ${kacis(l)} | ${c} |`);
  s.push('');
  if (dikkat.length) {
    s.push('## Needs review before distribution', '');
    s.push('These licenses need attention before you redistribute a build: copyleft, proprietary or unknown terms.', '');
    for (const p of dikkat) s.push(`- \`${p.ad}@${p.surum}\` — ${p.lisans} (${p.yer})`);
    s.push('');
  }
  s.push('## Bundled binaries, models and assets', '', '| Component | License | Notes |', '|---|---|---|');
  for (const [a, l, n] of VARLIKLAR) s.push(`| ${kacis(a)} | ${kacis(l)} | ${kacis(n)} |`);
  s.push('', '## Downloaded at runtime by the user (not redistributed)', '', '| Component | License | Notes |', '|---|---|---|');
  for (const [a, l, n] of INDIRILENLER) s.push(`| ${kacis(a)} | ${kacis(l)} | ${kacis(n)} |`);
  s.push('', '## Packages', '', '| Package | Version | License | Where | Source |', '|---|---|---|---|---|');
  for (const p of paketler) s.push(`| ${kacis(p.ad)} | ${kacis(p.surum)} | ${kacis(p.lisans)} | ${p.yer} | ${kacis(p.depo)} |`);
  // Lisans metinleri: aynı metin tek kez, altında onu taşıyan paketler.
  const gruplar = new Map();
  for (const p of paketler) {
    if (!p.metin) continue;
    const h = crypto.createHash('sha256').update(p.metin).digest('hex');
    if (!gruplar.has(h)) gruplar.set(h, { metin: p.metin, paketler: [] });
    gruplar.get(h).paketler.push(`${p.ad}@${p.surum}`);
  }
  const metinsiz = paketler.filter((p) => !p.metin).map((p) => `${p.ad}@${p.surum} (${p.lisans})`);
  s.push('', '## License texts', '');
  if (metinsiz.length) s.push(`Packages without a license file in the published package (license from \`package.json\`): ${metinsiz.join(', ')}.`, '');
  for (const g of gruplar.values()) {
    s.push(`### ${g.paketler.join(', ')}`, '', '```text', g.metin.replace(/```/g, "'''"), '```', '');
  }
  s.push('## Bundled asset license texts', '');
  for (const [ad, dosya] of VARLIK_METINLERI) {
    const metin = fs.readFileSync(path.join(KOK, dosya), 'utf8').replace(/\r\n/g, '\n').trim();
    s.push(`### ${ad}`, '', `Source: \`${dosya}\``, '', '```text', metin.replace(/```/g, "'''"), '```', '');
  }
  return `${s.join('\n').trimEnd()}\n`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  if (process.argv.includes('--ozel')) {
    const ayrim = ozelAyrim();
    if (!ayrim) { console.log('özel modül bağımlılığı yok (genel ağaç): ek bildirim üretilmedi.'); process.exit(0); }
    for (const ad of Object.keys(ayrim.modul)) {
      const hedef = path.join(KOK, 'ozel', ad, 'THIRD_PARTY_NOTICES.md');
      const govde = bildirimMetni(paketleriTopla({ ozelModul: ad })).replace('# Third-party notices', `# Third-party notices — optional module "${ad}"`);
      if (process.argv.includes('--denetle')) {
        const eski = fs.existsSync(hedef) ? fs.readFileSync(hedef, 'utf8').replace(/\r\n/g, '\n') : '';
        if (eski !== govde) { console.error(`${path.relative(KOK, hedef)} güncel değil: node scripts/ucuncu-taraf.mjs --ozel`); process.exit(1); }
        console.log(`${path.relative(KOK, hedef)} güncel.`);
      } else if (fs.existsSync(path.dirname(hedef))) { fs.writeFileSync(hedef, govde); console.log(`yazıldı: ${path.relative(KOK, hedef)}`); }
    }
    process.exit(0);
  }
  const metin = bildirimMetni(paketleriTopla());
  if (process.argv.includes('--denetle')) {
    const eski = fs.existsSync(CIKTI) ? fs.readFileSync(CIKTI, 'utf8').replace(/\r\n/g, '\n') : '';
    if (eski !== metin) { console.error('THIRD_PARTY_NOTICES.md güncel değil: node scripts/ucuncu-taraf.mjs'); process.exit(1); }
    console.log('THIRD_PARTY_NOTICES.md güncel.');
  } else {
    fs.mkdirSync(path.dirname(CIKTI), { recursive: true });
    fs.writeFileSync(CIKTI, metin);
    console.log(`yazıldı: ${path.relative(KOK, CIKTI)} (${(metin.length / 1024).toFixed(0)} KB)`);
  }
}
