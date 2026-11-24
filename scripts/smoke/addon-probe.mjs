// utilityProcess içinde koşar: argv[2]'deki sırayla (virgülle ayrık) yerel eklentileri yükler.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const order = (process.argv[2] ?? '').split(',').filter(Boolean);
const out = {};

for (const name of order) {
  try {
    const mod = require(name);
    const detail = { ok: true };
    if (name === 'sherpa-onnx-node') {
      detail.version = mod.version ?? null;
      detail.classes = ['Vad', 'KeywordSpotter', 'OfflineTts', 'SpeakerEmbeddingExtractor', 'OnlineRecognizer'].filter(
        (key) => typeof mod[key] === 'function',
      );
      // Model gerektirmeyen gerçek bir yerel çağrı: eklentinin yalnız yüklenmediğini, çalıştığını da gösterir.
      if (typeof mod.CircularBuffer === 'function') {
        const buffer = new mod.CircularBuffer(1600);
        buffer.push(Float32Array.from([0.1, 0.2, 0.3]));
        detail.circularBufferSize = buffer.size();
      }
    }
    if (name === 'koffi') detail.version = mod.version;
    if (name === 'node:sqlite') {
      const db = new mod.DatabaseSync(':memory:');
      detail.version = db.prepare('select sqlite_version() as v').get().v;
      db.close();
    }
    out[name] = detail;
  } catch (error) {
    out[name] = { ok: false, error: String(error?.message ?? error).slice(0, 160) };
  }
}

process.parentPort.postMessage({ type: 'result', result: out });
