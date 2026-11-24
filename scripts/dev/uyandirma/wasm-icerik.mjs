#!/usr/bin/env node
// ── WASM'ın içinde gerçekten hangi üçüncü taraf kodu var? (0.13 T8) ────────────────────────────────────────────────────────────────
// ONNX Runtime tek bir libonnxruntime.a'dır; bildirimi arşivin adından tahmin edemeyiz. Bu betik WASM'ı işlev adlarını koruyarak yeniden bağlar
// (--profiling-funcs; dağıtılan dosyaya dokunmaz) ve ad bölümünde kitaplık başına işlev sayar. Önce: wasm-derle.mjs. Lisans bildirimi bu sayımla denetlenir.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const KOK = resolve(import.meta.dirname, '../../../.superpowers/uyandirma');
const YAPI = join(KOK, 'wasm/yapi');
const VENV = join(KOK, 'venv/Scripts');
const EMSDK = join(KOK, 'wasm/emsdk');
const EM = join(EMSDK, 'upstream/emscripten');
const ortam = { ...process.env, EMSDK: EMSDK.replace(/\\/g, '/'), EM_CONFIG: join(EMSDK, '.emscripten').replace(/\\/g, '/'), PATH: [VENV, EM, join(EMSDK, 'upstream/bin'), process.env.PATH].join(';') };
const c = spawnSync(join(VENV, 'ninja.exe'), ['-C', YAPI, '-t', 'commands', 'bin/sherpa-onnx-wasm-kws-main.js'], { encoding: 'utf8', env: ortam, maxBuffer: 1 << 26 });
const komut = c.stdout.trim().split('\n').pop();
const m = /^.*?cmd\.exe \/C "cd \. && (.*?)(?: && cd \.)?"$/s.exec(komut) ?? [null, komut];
mkdirSync(join(YAPI, 'adli'), { recursive: true });
writeFileSync(join(YAPI, 'adli/bagla.bat'), `@echo off\r\ncd /d "${YAPI}"\r\n${m[1].replace(/ -o \S+\.js/, ' --profiling-funcs -o adli/k.js').replace(/ && .*$/s, '')}\r\n`);
const r = spawnSync('cmd.exe', ['/C', join(YAPI, 'adli/bagla.bat')], { env: ortam, stdio: 'inherit' });
if (r.status !== 0) throw new Error(`bağlama: ${r.status}`);
const b = readFileSync(join(YAPI, 'adli/k.wasm')).toString('latin1');
const AILE = {
  abseil: /absl::/g, re2: /re2::/g, protobuf: /google::protobuf/g, onnx: /\bonnx::/g, onnxruntime: /onnxruntime::/g, flatbuffers: /flatbuffers::/g, gsl: /\bgsl::/g,
  safeint: /SafeInt|SafeCast/g, mp11: /mp11::/g, date: /\bdate::/g, eigen: /Eigen::/g, mlas: /Mlas[A-Z]/g, nlohmann: /nlohmann::/g, kissfft: /kiss_fft/g, sherpa: /sherpa_onnx::/g,
  'libc++': /std::__2::/g, musl: /__syscall|__wasi/g, 'compiler-rt': /__multi3|__ashlti/g,
  // içeride OLMAMASI beklenenler
  xnnpack: /xnn_/g, cpuinfo: /cpuinfo_/g, nsync: /nsync/g, pthreadpool: /pthreadpool/g, mimalloc: /mi_malloc/g,
};
for (const [ad, d] of Object.entries(AILE)) console.log(ad.padEnd(14), (b.match(d) ?? []).length);
