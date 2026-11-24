#!/usr/bin/env node
// ── Uyandırma motorunu kaynaktan üretir (0.13 T8): sherpa-onnx v2.0.1 KWS + emsdk 4.0.23 + model + lisans bildirimi ───────────────────
// NEDEN KENDİ DERLEMEMİZ: resmi tarayıcı KWS paketi yayımlanmıyor (sürüm varlıklarında yok, HF alanı kapalı); npm "sherpa-onnx" WASM'ı
// NODERAWFS ile derlenmiş, tarayıcıda açılışta düşer. Kulak penceresi sandbox'lı olduğu için yerel eklenti de yüklenemez.
// Yukarı akıştan üç fark (wasm/kws/CMakeLists.txt yamalanır):
//   · model .data'ya gömülmez: çalışırken fuber://app/kaynak/uyandirma/'dan okunup WASM dosya sistemine yazılır (FS dışa açılır);
//   · INITIAL_MEMORY 512 MB → 64 MB: gizli pencere sürekli açık, gereksiz bellek tutmasın (ihtiyaçta büyür);
//   · MODULARIZE + ENVIRONMENT=web,worker,node: aynı ikili olc.mjs ve testlerde de koşar (ölçülen = dağıtılan).
// Girdilerin hepsi SABİT: PIN'deki adres + SHA-256 (uymazsa durur). ONNX Runtime statik kitaplığını sherpa'nın kendi cmake'i, kendi SHA-256'sıyla
// indirir. Hiçbir şey git ile alınmaz; her şey .superpowers/uyandirma/wasm/ altında kalır.
// Derleyici __FILE__ ile kaynakların MUTLAK yolunu ikiliye yazar (derleme bilgisayarının klasör adları): çıktı WASM'ı wasm-yol-temizle.mjs ile
// nötrlenir (aynı uzunlukta /build/… öneki; boyut ve yapı değişmez), yerel yol kalırsa derleme durur.
// Depodaki çıktılar (yollar nötr): sherpa-onnx-wasm-kws-main.wasm 12 756 696 bayt, SHA-256 44340c5e213e172422ed6229b19a3ddb8dc28aee30af75a63f6f0177fb48eceb;
// sherpa-onnx-wasm-kws-main.js SHA-256 eed015edbd40d900c466b5f921bab5ed9c2ec4c71520ed9f82005ce3e9946c02. Yeniden derleme bayt bayt aynı çıkmayabilir.
//   node scripts/dev/uyandirma/wasm-derle.mjs                derler, çıktıyı wasm/cikti/ altına koyar
//   node scripts/dev/uyandirma/wasm-derle.mjs --kopyala      ek olarak resources/uyandirma/'ya kopyalar
//   node scripts/dev/uyandirma/wasm-derle.mjs --yalniz-lisans  derlemeden bildirimi yeniden üretir (yapi/ gerekir)
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { yerelYollar, yollariTemizle } from './wasm-yol-temizle.mjs';

const BURASI = dirname(fileURLToPath(import.meta.url));
const DEPO = resolve(BURASI, '../../..');
const KOK = join(DEPO, '.superpowers/uyandirma');
const W = join(KOK, 'wasm');
const SHERPA = join(W, 'sherpa');
const EMSDK = join(W, 'emsdk');
const YAPI = join(W, 'yapi');
const CIKTI = join(W, 'cikti');
const INDIR = join(W, 'indirilen');
const EMSDK_SURUM = '4.0.23';
const VENV = join(KOK, 'venv/Scripts');
const PY = join(VENV, 'python.exe');
const ham = (depo, etiket, yol) => `https://raw.githubusercontent.com/${depo}/${etiket}/${yol}`;

/** Her girdi: adres + beklenen SHA-256. Sürümler ONNX Runtime v1.28.2 cmake/deps.txt ile aynı. */
const PIN = {
  sherpa: { url: 'https://github.com/k2-fsa/sherpa-onnx/archive/refs/tags/v2.0.1.tar.gz', sha: '24ecc0fccf6344c2556e7c229c849e9f61bf9456b915615197d85f35e3f177e7' },
  emsdk: { url: `https://github.com/emscripten-core/emsdk/archive/refs/tags/${EMSDK_SURUM}.tar.gz`, sha: 'a91a4c1f42dbb0345faac093161e27d43e9b6964840d8c8d80976ab8d3eaf2d3' },
  model: { url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20.tar.bz2', sha: '68447f4fbc67e70eee3a93961f36e81e98f47aef73ce7e7ca00885c6cd3616a6' },
  ortLisans: { url: ham('microsoft/onnxruntime', 'v1.28.2', 'LICENSE'), sha: '2f07c72751aed99790b8a4869cf2311df85a860b22ded05fa22803587a48922c' },
  ortBildirim: { url: ham('microsoft/onnxruntime', 'v1.28.2', 'ThirdPartyNotices.txt'), sha: '0e07b95f3a8d6230037707c5c4a2b554d12c4cb67369669ac255635528ffcee2' },
  onnx: { url: ham('onnx/onnx', 'v1.22.0', 'LICENSE'), sha: 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30' },
  abseil: { url: ham('abseil/abseil-cpp', '20250814.0', 'LICENSE'), sha: 'c79a7fea0e3cac04cd43f20e7b648e5a0ff8fa5344e644b0ee09ca1162b62747' },
  protobuf: { url: ham('protocolbuffers/protobuf', 'v21.12', 'LICENSE'), sha: '6e5e117324afd944dcf67f36cf329843bc1a92229a8cd9bb573d7a83130fea7d' },
  re2: { url: ham('google/re2', '2024-07-02', 'LICENSE'), sha: '6040cda75d90b1738292a631d89934c411ef7ffd543c4d6a1b7edfc8edf29449' },
  flatbuffers: { url: ham('google/flatbuffers', 'v23.5.26', 'LICENSE'), sha: 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30' },
  gsl: { url: ham('microsoft/GSL', 'v4.2.1', 'LICENSE'), sha: '4c21dc82a1c7186ea754fd59d504c00947953a3401fe8e24eaa44109ef8e2555' },
  safeint: { url: ham('dcleblanc/SafeInt', '3.0.28', 'LICENSE'), sha: 'a46919cc8f01eb73f6e4b84af0d41b46b2a33b87c74e864279ef585079f82da4' },
  date: { url: ham('HowardHinnant/date', 'v3.0.1', 'LICENSE.txt'), sha: 'c90f6c00fb961170560299cbda28ca2d45804913aa8b2a9f36dbb8e0028d6930' },
  boost: { url: ham('boostorg/boost', 'boost-1.82.0', 'LICENSE_1_0.txt'), sha: 'c9bff75738922193e67fa726fa225535870d2aa1059f91452c411736284ad566' },
};
const MODEL_DOSYALARI = ['encoder-epoch-13-avg-2-chunk-16-left-64.int8.onnx', 'decoder-epoch-13-avg-2-chunk-16-left-64.onnx', 'joiner-epoch-13-avg-2-chunk-16-left-64.int8.onnx', 'tokens.txt'];

const calistir = (k, a, o = {}) => {
  console.log(`▶ ${k.split(/[\\/]/).pop()} ${a.slice(0, 3).join(' ')}`);
  const r = spawnSync(k, a, { stdio: 'inherit', ...o });
  if (r.status !== 0) throw new Error(`${k}: ${r.status ?? r.error}`);
};

/** İndirir (varsa yeniden indirmez) ve SHA-256'yı HER seferinde doğrular: uymayan girdiyle derleme başlamaz. */
async function al(ad, dosyaAdi) {
  const { url, sha } = PIN[ad];
  mkdirSync(INDIR, { recursive: true });
  const yol = join(INDIR, dosyaAdi ?? `${ad}.${url.split('.').pop()}`);
  for (let d = 1; !existsSync(yol); d++) {
    try {
      const y = await fetch(url);
      if (!y.ok) throw new Error(`${url}: ${y.status}`);
      writeFileSync(yol, Buffer.from(await y.arrayBuffer()));
    } catch (h) {
      if (d >= 4) throw h; // ağ kopması geçicidir; SHA-256 yine de aşağıda doğrulanır
      await new Promise((c) => setTimeout(c, 3000 * d));
    }
  }
  const gercek = createHash('sha256').update(readFileSync(yol)).digest('hex');
  if (gercek !== sha) throw new Error(`${ad}: SHA-256 uymuyor\n  beklenen ${sha}\n  gelen    ${gercek}`);
  return yol;
}

const ac = (arsiv, hedef, ...ek) => { mkdirSync(hedef, { recursive: true }); calistir('tar', ['xf', arsiv, '-C', hedef, '--strip-components=1', ...ek]); };

/** Yukarı akış dosyasını yamalar; beklenen satır yoksa (sürüm değişti) sessizce geçmez, durur. */
function yamala() {
  const f = join(SHERPA, 'wasm/kws/CMakeLists.txt');
  let s = readFileSync(f, 'utf8');
  if (s.includes('fuber:')) return;
  const degistir = (eski, yeni) => {
    if (!s.includes(eski)) throw new Error(`yama yeri yok (sherpa sürümü değişti mi?): ${eski}`);
    s = s.replace(eski, yeni);
  };
  degistir('if(NOT EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/assets/decoder-epoch-12-avg-2-chunk-16-left-64.onnx")\n    message(WARNING "${CMAKE_CURRENT_SOURCE_DIR}/assets/decoder-epoch-12-avg-2-chunk-16-left-64.onnx does not exist")\n    message(FATAL_ERROR "Please read ${CMAKE_CURRENT_SOURCE_DIR}/assets/README.md before you continue")\nendif()\n', '# fuber: model pakete gömülmez\n');
  degistir('-s INITIAL_MEMORY=512MB', '-s INITIAL_MEMORY=64MB -sMODULARIZE=1 -sEXPORT_NAME=SherpaKws -sENVIRONMENT=web,worker,node');
  degistir('string(APPEND MY_FLAGS "--preload-file ${CMAKE_CURRENT_SOURCE_DIR}/assets@. ")\n', '');
  degistir("'HEAPF64']", "'HEAPF64','FS']");
  degistir('        "$<TARGET_FILE_DIR:sherpa-onnx-wasm-kws-main>/sherpa-onnx-wasm-kws-main.data"\n', '');
  writeFileSync(f, s);
}

const yol = (d) => d.replace(/\\/g, '/');

async function derle() {
  if (!existsSync(PY)) {
    calistir('uv', ['venv', '--python', '3.12', join(KOK, 'venv'), '-q']);
  }
  calistir('uv', ['pip', 'install', '-q', '--python', PY, 'cmake==4.4.4', 'ninja==1.13.2']);
  const emsdkArsiv = await al('emsdk');
  if (!existsSync(join(EMSDK, 'emsdk.py'))) ac(emsdkArsiv, EMSDK);
  const sherpaArsiv = await al('sherpa');
  if (!existsSync(join(SHERPA, 'CMakeLists.txt'))) ac(sherpaArsiv, SHERPA);
  if (!existsSync(join(EMSDK, 'upstream/emscripten/emcc.bat'))) {
    // Yol boşluk içerir, emsdk.bat tırnaklamada düşer: doğrudan emsdk.py.
    calistir(PY, [join(EMSDK, 'emsdk.py'), 'install', EMSDK_SURUM], { cwd: EMSDK });
    calistir(PY, [join(EMSDK, 'emsdk.py'), 'activate', EMSDK_SURUM], { cwd: EMSDK });
  }
  yamala();
  mkdirSync(YAPI, { recursive: true });
  const EM = join(EMSDK, 'upstream/emscripten');
  const ortam = {
    ...process.env,
    SHERPA_ONNX_IS_USING_BUILD_WASM_SH: 'ON',
    EMSDK: yol(EMSDK),
    EM_CONFIG: yol(join(EMSDK, '.emscripten')),
    PATH: [VENV, EM, join(EMSDK, 'upstream/bin'), process.env.PATH].join(';'),
  };
  const cmake = join(VENV, 'cmake.exe');
  calistir(cmake, ['-G', 'Ninja', '-S', SHERPA, '-B', YAPI,
    `-DCMAKE_MAKE_PROGRAM=${yol(join(VENV, 'ninja.exe'))}`,
    `-DCMAKE_TOOLCHAIN_FILE=${yol(join(EM, 'cmake/Modules/Platform/Emscripten.cmake'))}`,
    `-DCMAKE_INSTALL_PREFIX=${yol(join(YAPI, 'install'))}`,
    '-DCMAKE_BUILD_TYPE=Release', '-DCMAKE_POLICY_VERSION_MINIMUM=3.5',
    '-DSHERPA_ONNX_ENABLE_PYTHON=OFF', '-DSHERPA_ONNX_ENABLE_TESTS=OFF', '-DSHERPA_ONNX_ENABLE_CHECK=OFF', '-DBUILD_SHARED_LIBS=OFF',
    '-DSHERPA_ONNX_ENABLE_PORTAUDIO=OFF', '-DSHERPA_ONNX_ENABLE_JNI=OFF', '-DSHERPA_ONNX_ENABLE_C_API=ON', '-DSHERPA_ONNX_ENABLE_TTS=OFF',
    '-DSHERPA_ONNX_ENABLE_WEBSOCKET=OFF', '-DSHERPA_ONNX_ENABLE_GPU=OFF', '-DSHERPA_ONNX_ENABLE_WASM=ON', '-DSHERPA_ONNX_ENABLE_WASM_KWS=ON',
    '-DSHERPA_ONNX_ENABLE_BINARY=OFF', '-DSHERPA_ONNX_LINK_LIBSTDCPP_STATICALLY=OFF'], { env: ortam });
  calistir(cmake, ['--build', YAPI, '--target', 'sherpa-onnx-wasm-kws-main', '-j', '12'], { env: ortam });
  mkdirSync(CIKTI, { recursive: true });
  for (const f of ['sherpa-onnx-wasm-kws-main.js', 'sherpa-onnx-wasm-kws-main.wasm']) copyFileSync(join(YAPI, 'bin', f), join(CIKTI, f));
  // __FILE__ yolları derleme bilgisayarının klasörlerini taşır: aynı uzunlukta nötr önekle değiştirilir (wasm-yol-temizle.mjs).
  const wasmCikti = join(CIKTI, 'sherpa-onnx-wasm-kws-main.wasm');
  const temiz = yollariTemizle(readFileSync(wasmCikti));
  if (!WebAssembly.validate(temiz.tampon)) throw new Error('yolları temizlenen WASM geçersiz');
  const kalan = yerelYollar(temiz.tampon);
  if (kalan.length) throw new Error(`WASM'da ${kalan.length} yerel yol kaldı (derleme kökü .superpowers/uyandirma/wasm dışında mı?): ${kalan[0].ornek}`);
  writeFileSync(wasmCikti, temiz.tampon);
  console.log(`WASM: ${temiz.sayi} derleme yolu nötrlendi`);
  copyFileSync(join(SHERPA, 'wasm/kws/sherpa-onnx-kws.js'), join(CIKTI, 'sherpa-onnx-kws.js'));
  // Model: yalnız kullanılan dört dosya (encoder/joiner int8, chunk-16).
  const m = await al('model', 'model.tar.bz2');
  const md = join(W, 'model');
  if (!existsSync(join(md, MODEL_DOSYALARI[0]))) ac(m, md);
  for (const f of MODEL_DOSYALARI) copyFileSync(join(md, f), join(CIKTI, f));
}

/**
 * Bildirim: WASM'ın içinde olduğu DOĞRULANAN kod (scripts/dev/uyandirma/wasm-icerik.mjs işlev adlarını sayar: abseil, re2, protobuf, onnx, onnxruntime,
 * flatbuffers, GSL, SafeInt, Boost.Mp11, Eigen, nlohmann/json, kissfft, libc++, musl, compiler-rt) ile bağlanan ama ölü kod elemesiyle tamamen
 * düşmüş olabilecek kitaplıklar (fazlası zarar vermez). XNNPACK, cpuinfo, nsync, pthreadpool, mimalloc içeride değil. ONNX Runtime'ın kendi
 * bildirimi uzun (325 KB) ve çoğu bu derlemede yok: ayrı dosya olarak pakete girer, Hakkında metnine alınmaz.
 */
async function lisans() {
  const D = join(YAPI, '_deps');
  const E = join(EMSDK, 'upstream/emscripten');
  const pin = async (ad) => readFileSync(await al(ad, `lisans-${ad}.txt`), 'utf8');
  const oku = (...y) => readFileSync(join(...y), 'utf8');
  const bolum = (ad, metin) => `==== ${ad} ====\n\n${metin.trim()}\n`;
  const bolumler = [
    bolum('sherpa-onnx, kaldi-native-fbank, kaldi-decoder, kaldifst, simple-sentencepiece, icefall-kws-zipformer-zh-en-3M (pkufool), ONNX v1.22.0, FlatBuffers v23.5.26 (Apache-2.0)', oku(SHERPA, 'LICENSE')),
    bolum('Abseil 20250814.0 (Apache-2.0)', await pin('abseil')),
    bolum('OpenFst (Apache-2.0)', oku(D, 'openfst-src/COPYING')),
    bolum('ONNX Runtime v1.28.2 (MIT)', await pin('ortLisans')),
    bolum('RE2 2024-07-02 (BSD-3-Clause)', await pin('re2')),
    bolum('Protocol Buffers v21.12 (BSD-3-Clause)', await pin('protobuf')),
    bolum('Microsoft GSL v4.2.1 (MIT)', await pin('gsl')),
    bolum('SafeInt 3.0.28 (MIT)', await pin('safeint')),
    bolum('date v3.0.1 (MIT)', await pin('date')),
    bolum('Boost.Mp11 1.82.0 (BSL-1.0)', await pin('boost')),
    bolum('Eigen (MPL-2.0; yalnız başlık dosyaları)', oku(D, 'eigen-src/COPYING.MPL2')),
    bolum('nlohmann/json (MIT)', oku(D, 'json-src/LICENSE.MIT')),
    bolum('utf8proc (MIT)', oku(D, 'utf8proc-src/LICENSE.md')),
    bolum('KISS FFT (BSD-3-Clause)', `${oku(D, 'kissfft-src/COPYING')}\n${oku(D, 'kissfft-src/LICENSES/BSD-3-Clause')}`),
    bolum(`Emscripten ${EMSDK_SURUM} çalışma zamanı (MIT, University of Illinois/NCSA)`, oku(E, 'LICENSE')),
    bolum('libc++, libc++abi, compiler-rt (LLVM; Apache-2.0 WITH LLVM-exception)', oku(E, 'system/lib/libcxx/LICENSE.TXT')),
    bolum('musl libc (MIT)', oku(E, 'system/lib/libc/musl/COPYRIGHT')),
    bolum('dlmalloc (Doug Lea; kamu malı, CC0)', 'This is a version (aka dlmalloc) of malloc/free/realloc written by Doug Lea and released to the public domain, as explained at http://creativecommons.org/publicdomain/zero/1.0/'),
    bolum('ONNX Runtime üçüncü taraf bildirimleri', 'ONNX Runtime v1.28.2 kendi bildirim dosyasını da taşır; paket içinde: kaynak/uyandirma/ThirdPartyNotices-onnxruntime.txt'),
  ];
  mkdirSync(CIKTI, { recursive: true });
  writeFileSync(join(CIKTI, 'LISANSLAR.txt'), bolumler.join('\n'));
  writeFileSync(join(CIKTI, 'ThirdPartyNotices-onnxruntime.txt'), await pin('ortBildirim'));
}

if (!process.argv.includes('--yalniz-lisans')) await derle();
await lisans();
if (process.argv.includes('--kopyala')) {
  const H = join(DEPO, 'resources/uyandirma');
  for (const f of ['sherpa-onnx-wasm-kws-main.js', 'sherpa-onnx-wasm-kws-main.wasm', 'sherpa-onnx-kws.js', 'LISANSLAR.txt', 'ThirdPartyNotices-onnxruntime.txt', ...MODEL_DOSYALARI]) copyFileSync(join(CIKTI, f), join(H, f));
  console.log('kopyalandı:', H);
}
console.log('bitti:', CIKTI);
