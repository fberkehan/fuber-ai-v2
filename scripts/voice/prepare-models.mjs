// Yerel modellerin geliştirme/teslim önbelleğini hazırlar: %LOCALAPPDATA%\FuberAI2-dev\models
//
// Önbellek, uygulamanın veri klasöründeki `models/` klasörünün aynasıdır. Uygulama modelleri hazırlarken
// (ModelsApi.download) önce buraya bakar ve özeti tutan dosyayı sabit bağlantıyla anında yerleştirir; böylece
// uçtan uca sınamalar her koşuda 1,7 GB kopyalamaz ve teslimde modeller önceden hazır olur.
//
// Dosyaların kaynağı, sırasıyla: önbelleğin kendisi → Fuber AI 1'in indirdikleri (sabit bağlantı; v1 klasörü
// değişmez) → ağ (Hugging Face doğrudan; arşiv içindeki dosyalar için arşiv bir kez iner ve açılır).
// Her dosya `DEFAULT_LOCAL_MODELS` içindeki SHA-256 ile doğrulanır; tutmayan dosya önbelleğe girmez.
//
// Kullanım: node scripts/voice/prepare-models.mjs [--no-network] [--cache <klasör>] [--only <model kimliği>]
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..', '..');
// Node 24 TypeScript kaynağını tür silerek doğrudan yükler; liste ve dosya kuralları tek yerde kalır.
const load = (relative) => import(pathToFileURL(path.join(root, relative)).href);
const { DEFAULT_LOCAL_MODELS } = await load('packages/shared/src/local-models.ts');
const { VerifyCache, findLocalCopy, placeFile, verifyFile, quickState, resolveModelPath, hashFile, removeFile } = await load(
  'apps/desktop/src/main/voice/model-files.ts',
);

const args = process.argv.slice(2);
const noNetwork = args.includes('--no-network');
const onlyArg = args.indexOf('--only');
const only = onlyArg >= 0 ? args[onlyArg + 1] : null;
const cacheArg = args.indexOf('--cache');
const devRoot = path.join(process.env.LOCALAPPDATA ?? os.tmpdir(), 'FuberAI2-dev');
const cacheDir = cacheArg >= 0 ? path.resolve(args[cacheArg + 1]) : path.join(devRoot, 'models');
const downloadsDir = path.join(path.dirname(cacheDir), 'downloads');

/** Arşivlerin kendi özetleri (sürüm sayfalarından); arşiv açılmadan önce doğrulanır. */
const ARCHIVE_SHA256 = {
  'whisper-cublas-12.4.0-bin-x64.zip': '443110ddaad70d4290ab2e77179e31cf712035bbc4fad56bb4519a90c917b39c',
  'piper_windows_amd64.zip': 'f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea',
  'llama-prism-b10777-e3de715-bin-win-cuda-13.3-x64.zip': '071088ef64f2e62dfb488f4d73cc368df945f9c0e8c7019bc94daf9abd0eb4aa',
  'cudart-llama-bin-win-cuda-13.3-x64.zip': '1462a050eb4c684921ba51dcc4cc488a036674c3e73e9945ee705b854808d03e',
  // Yerel ekran kartı sesi: PyPI tekerlekleri (özetler PyPI'nin kendi kaydından, 16 Kasım 2026).
  'onnxruntime_gpu-1.32.0-cp312-cp312-win_amd64.whl': 'd8bc5d7668872889d605c1e7253581e021db7dea41a142ad2ab78d6d96f3f289',
  'onnxruntime_directml-1.24.4-cp312-cp312-win_amd64.whl': 'f2ecb68b7b7b259d2ef3112ae760149f9b5a1e7c0fbb73d539da6250a648a614',
  'nvidia_cublas-13.10.0.20-py3-none-win_amd64.whl': 'c310b749eea855b88fafb906de08d6819b87216c6711640771764fea5dcd8546',
  'nvidia_cudnn_cu13-9.28.1.4-py3-none-win_amd64.whl': '73d874c6bd8a1c75ca040228f77c4e163efe9bab3b65bd85914e2b7334ac68ee',
};

const v1 = process.env.APPDATA ? path.join(process.env.APPDATA, 'Fuber AI') : null;
// Yerel ses araştırmasının ölçüm klasörü: Supertonic 3 modeli, ONNX Runtime ve NVIDIA kitaplıkları orada inmiş durur.
const bench = path.join(devRoot, 'tts-bench');
const benchGpu = path.join(bench, 'supertonic3-gpu', '.venv', 'Lib', 'site-packages');
const sources = [
  path.join(bench, 'supertonic3', 'model'),
  path.join(benchGpu, 'onnxruntime', 'capi'),
  path.join(benchGpu, 'nvidia', 'cu13', 'bin', 'x86_64'),
  path.join(benchGpu, 'nvidia', 'cudnn', 'bin'),
  path.join(bench, 'supertonic3-dml', '.venv', 'Lib', 'site-packages', 'onnxruntime', 'capi'),
  path.join(bench, 'ema-onnx', 'ozcancelik'),
  ...(v1
    ? [
        path.join(v1, 'whisper'),
        path.join(v1, 'whisper', 'v1.9.2-cuda', 'Release'),
        path.join(v1, 'ses', 'piper'),
        path.join(v1, 'ses', 'piper', 'piper'),
        // Yerel beynin sunucusu (v1 aynı llama.cpp yapısını kullanıyor).
        path.join(v1, 'yerel', 'llama-prism-b10777-e3de715-cuda'),
        // v1'in indirdiği arşivler (arşiv içi dosya gerekirse yeniden indirmemek için).
        path.join(v1, 'yerel', 'indirilen'),
      ]
    : []),
  downloadsDir,
]
  .filter((dir) => fs.existsSync(dir))
  .map((dir) => ({ dir }));

fs.mkdirSync(cacheDir, { recursive: true });
fs.mkdirSync(downloadsDir, { recursive: true });
const cache = new VerifyCache(cacheDir);

const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;

async function download(url, target, label) {
  const response = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'fuber-ai-v2-prepare-models (+https://github.com/fberkehan/orion)' } });
  if (!response.ok || !response.body) throw new Error(`${label}: HTTP ${response.status}`);
  const total = Number(response.headers.get('content-length') ?? 0);
  const temp = `${target}.part`;
  const out = fs.createWriteStream(temp);
  const hash = createHash('sha256');
  let received = 0;
  let lastPrint = 0;
  for await (const chunk of response.body) {
    hash.update(chunk);
    received += chunk.length;
    if (!out.write(chunk)) await new Promise((resolve) => out.once('drain', resolve));
    if (Date.now() - lastPrint > 2000) {
      lastPrint = Date.now();
      process.stdout.write(`    ${label}: ${mb(received)}${total ? ` / ${mb(total)}` : ''}\r`);
    }
  }
  await new Promise((resolve, reject) => out.end((error) => (error ? reject(error) : resolve())));
  fs.renameSync(temp, target);
  return hash.digest('hex');
}

/** Arşivi (yerelde yoksa indirip) doğrular ve yolunu döndürür. */
async function ensureArchive(url) {
  const name = path.basename(new URL(url).pathname);
  const expected = ARCHIVE_SHA256[name];
  for (const source of sources) {
    const candidate = path.join(source.dir, name);
    if (!fs.existsSync(candidate)) continue;
    if (!expected || (await hashFile(candidate)) === expected) return candidate;
  }
  if (noNetwork) throw new Error(`${name} yerelde yok ve ağ kapalı`);
  const target = path.join(downloadsDir, name);
  console.log(`  arşiv indiriliyor: ${url}`);
  const sha256 = await download(url, target, name);
  if (expected && sha256 !== expected) {
    removeFile(target);
    throw new Error(`${name}: arşivin özeti tutmadı`);
  }
  return target;
}

/** Arşivden tek dosyayı, yalnız bu iş için açılmış boş bir klasöre çıkarır ve yolunu döndürür. */
function extractMember(archive, member) {
  const outDir = fs.mkdtempSync(path.join(downloadsDir, 'extract-'));
  // Windows'un kendi tar'ı (bsdtar) zip açar; PATH'teki GNU tar açamaz.
  const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  execFileSync(tar, ['-xf', archive, '-C', outDir, member], { stdio: 'ignore' });
  return { file: path.join(outDir, ...member.split('/')), outDir };
}

const rows = [];
let failures = 0;

for (const model of DEFAULT_LOCAL_MODELS) {
  if (only && model.id !== only) continue;
  console.log(`${model.id} (${model.role}${model.required ? ', zorunlu' : ''})`);
  for (const file of model.files) {
    let how = 'önbellekte';
    try {
      if (!(await verifyFile(cacheDir, file, cache))) {
        const copy = await findLocalCopy(file, sources, cache);
        if (copy) {
          how = `yerel: ${await placeFile(cacheDir, file, copy, cache)}`;
        } else if (file.url.includes('#')) {
          const [archiveUrl, member] = file.url.split('#');
          const archive = await ensureArchive(archiveUrl);
          const { file: extracted, outDir } = extractMember(archive, member);
          try {
            if ((await hashFile(extracted)) !== file.sha256) throw new Error('çıkarılan dosyanın özeti tutmadı');
            await placeFile(cacheDir, file, extracted, cache);
            how = 'arşivden';
          } finally {
            await fs.promises.rm(outDir, { recursive: true, force: true });
          }
        } else {
          if (noNetwork) throw new Error('yerelde yok ve ağ kapalı');
          const target = resolveModelPath(cacheDir, file.path);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          const sha256 = await download(file.url, target, path.basename(file.path));
          if (sha256 !== file.sha256) {
            removeFile(target);
            throw new Error('indirilen dosyanın özeti tutmadı');
          }
          cache.record(file.path, fs.statSync(target), sha256);
          how = 'indirildi';
        }
      }
      if (quickState(cacheDir, file, cache) !== 'ready') throw new Error('doğrulanamadı');
      console.log(`  tamam  ${file.path}  (${mb(file.bytes)}, ${how})`);
      rows.push({ model: model.id, file: file.path, bytes: file.bytes, how });
    } catch (error) {
      failures++;
      console.log(`  HATA   ${file.path}: ${error.message}`);
    }
  }
}
cache.save();

const total = rows.reduce((sum, row) => sum + row.bytes, 0);
console.log(`\nÖnbellek: ${cacheDir}`);
console.log(`${rows.length} dosya, ${mb(total)}${failures ? `; ${failures} dosya HAZIRLANAMADI` : ''}`);
process.exitCode = failures ? 1 : 0;
