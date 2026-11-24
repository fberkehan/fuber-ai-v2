/**
 * Model dosyalarının bu bilgisayarda zaten bulunabileceği yerler. Kullanıcı modelleri hazırlamayı
 * başlattığında (`ModelsApi.download`) önce buralara bakılır; özeti tutan dosya indirilmeden yerleştirilir.
 * Kaynak klasörlere yazılmaz.
 */

import fs from 'node:fs';
import path from 'node:path';
import { VerifyCache, type LocalSource } from './model-files';

/** Model klasörünün aynası olan hazır önbellek (`scripts/voice/prepare-models.mjs` kurar; teslimde önceden doldurulur). */
export function seedCacheDir(): string | null {
  const local = process.env.LOCALAPPDATA;
  return local ? path.join(local, 'FuberAI2-dev', 'models') : null;
}

export function knownLocalSources(): LocalSource[] {
  const sources: LocalSource[] = [];
  const local = process.env.LOCALAPPDATA;
  const seed = seedCacheDir();
  if (seed) sources.push({ dir: seed, cache: new VerifyCache(seed, true) });

  // Fuber AI 1'in indirdikleri: aynı whisper.cpp paketi, aynı Whisper modeli, aynı Piper sesi.
  const roaming = process.env.APPDATA;
  if (roaming) {
    const v1 = path.join(roaming, 'Fuber AI');
    sources.push(
      { dir: path.join(v1, 'whisper') },
      { dir: path.join(v1, 'whisper', 'v1.9.2-cuda', 'Release') },
      { dir: path.join(v1, 'ses', 'piper') },
      { dir: path.join(v1, 'ses', 'piper', 'piper') },
      // Yerel beynin sunucusu (aynı llama.cpp yapısı). v1'in dil modeli farklı bir dosyadır; özeti tutmaz, alınmaz.
      { dir: path.join(v1, 'yerel', 'llama-prism-b10777-e3de715-cuda') },
    );
  }
  // Yerel ses araştırmasının ölçüm klasörü (geliştirici bilgisayarında): Supertonic 3 modeli, ONNX Runtime ve NVIDIA
  // kitaplıkları orada inmiş durur; özeti tutan dosya yeniden indirilmeden yerleştirilir.
  if (local) {
    const bench = path.join(local, 'FuberAI2-dev', 'tts-bench');
    const packages = path.join(bench, 'supertonic3-gpu', '.venv', 'Lib', 'site-packages');
    sources.push(
      { dir: path.join(bench, 'supertonic3', 'model') },
      { dir: path.join(packages, 'onnxruntime', 'capi') },
      { dir: path.join(packages, 'nvidia', 'cu13', 'bin', 'x86_64') },
      { dir: path.join(packages, 'nvidia', 'cudnn', 'bin') },
      { dir: path.join(bench, 'supertonic3-dml', '.venv', 'Lib', 'site-packages', 'onnxruntime', 'capi') },
      { dir: path.join(bench, 'ema-onnx', 'ozcancelik') },
    );
  }
  return sources.filter((source) => fs.existsSync(source.dir));
}
