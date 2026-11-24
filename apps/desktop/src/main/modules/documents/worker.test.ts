// Belge işçisi ayrı süreçte (Node alt süreci; üretimde Electron utilityProcess): gerçek demetle (esbuild) ve sahte
// işçilerle süre, bellek ve çökme sınırları. (worker_threads kullanılmaz: pdf.js'in yerel tuval eklentisi iş parçacığı
// sonlandırılınca sınama sürecini düşürüyordu, 0xC0000005.)
// Electron'daki `utilityProcess` yolu uçtan uca sınamada (`scripts/e2e/documents.mjs`) denenir.
import fs from 'node:fs';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDocx, buildPdf, buildZip, scratchDir } from './testkit';
import { createDocWorker, type DocWorker } from './worker-client';

const here = nodePath.dirname(fileURLToPath(import.meta.url));
const root = nodePath.resolve(here, '..', '..', '..', '..', '..', '..');
// node_modules içinde: dış paketler (pdf-parse) yukarı doğru çözülür.
const outDir = nodePath.join(root, 'node_modules', '.cache', 'fuber-doc-worker-test');
const realWorker = nodePath.join(outDir, 'index.mjs');

let dir: string;
let cleanup: () => Promise<void>;
const clients: DocWorker[] = [];
const client = (workerPath: string, options: { memoryMb?: number; timeoutMs?: number } = {}) => {
  const created = createDocWorker({ workerPath, mode: 'process', ...options });
  clients.push(created);
  return created;
};

/** Sahte işçi: `hang` yolunda sonsuz döngü, `oom` yolunda bellek doldurma, `exit` yolunda çıkış; diğerine yanıt. */
const FAKE = `
process.on('message', (request) => {
  if (request.path.endsWith('hang')) { for (;;) {} }
  if (request.path.endsWith('oom')) { const keep = []; for (;;) keep.push(new Array(1e6).fill(Math.random())); }
  if (request.path.endsWith('exit')) process.exit(7);
  process.send({ id: request.id, ok: true, format: 'text', title: null, sections: [], totalChars: 0, truncated: false, meta: {} });
});
`;

beforeAll(async () => {
  ({ dir, cleanup } = scratchDir('worker'));
  fs.mkdirSync(outDir, { recursive: true });
  await build({
    entryPoints: [nodePath.join(here, 'worker', 'entry.ts')],
    outfile: realWorker,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    external: ['electron', 'pdf-parse'],
    banner: { js: "import { createRequire as __r } from 'node:module'; const require = __r(import.meta.url);" },
    logLevel: 'error',
  });
  fs.writeFileSync(nodePath.join(outDir, 'fake.mjs'), FAKE);
}, 60_000);

afterAll(async () => {
  for (const created of clients) created.dispose();
  await cleanup();
});

const write = (name: string, data: Buffer) => {
  const file = nodePath.join(dir, name);
  fs.writeFileSync(file, data);
  return file;
};

describe('gerçek işçi (demet, ayrı iş parçacığı)', () => {
  it('PDF ve Word okur, Excel üretir', async () => {
    const docs = client(realWorker);
    const pdf = await docs.parse({ path: write('a.pdf', buildPdf([['Son Odeme Tarihi: 26.11.2026']])), maxChars: 100_000 });
    expect(pdf).toMatchObject({ ok: true, format: 'pdf' });
    const docx = await docs.parse({ path: write('a.docx', buildDocx()), maxChars: 100_000 });
    expect(docx.ok && docx.sections.some((section) => section.text.includes('KDV | 12.500,00 TL'))).toBe(true);
    const xlsx = await docs.generate('xlsx', { sheets: [{ name: 'Liste', rows: [['A', 'B'], [1, 2]] }] });
    expect(xlsx.ok && Buffer.from(xlsx.data.subarray(0, 2)).toString('latin1')).toBe('PK');
  }, 60_000);

  it('gerçek boyutta zip bombası varsayılan sınırda (100 MB) durur, ana süreç ayakta', async () => {
    const bomb = buildZip([{ name: 'word/document.xml', data: Buffer.alloc(120 * 1024 * 1024, 0x20), claimInflated: 1000 }]);
    const result = await client(realWorker).parse({ path: write('bomba.docx', bomb), maxChars: 100_000 });
    expect(result).toMatchObject({ ok: false, code: 'limit' });
  }, 60_000);
});

describe('süre, bellek, çökme', () => {
  it('süre dolunca işçi öldürülür; sonraki istek yeni süreçle yürür', async () => {
    // Süre yeni sürecin açılışını da kapsar: yük altında (bütün sınamalar koşarken) Node'un açılışı 400 ms'yi aşabiliyor ve
    // ikinci, sağlam istek de "timeout" dönüyordu. 1,5 sn yük altında da yeter; asılı istek yine sınırında kesilir.
    const docs = client(nodePath.join(outDir, 'fake.mjs'), { timeoutMs: 4_000 }); // süre sürecin açılışını da kapsar; yük altında 1,5 sn yetmedi
    const started = Date.now();
    const hung = await docs.parse({ path: 'x-hang', maxChars: 10 });
    expect(hung).toMatchObject({ ok: false, code: 'timeout' });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(await docs.parse({ path: 'normal', maxChars: 10 })).toMatchObject({ ok: true });
  }, 20_000);

  it('bellek sınırı aşılınca "memory", ana süreç çökmez', async () => {
    const docs = client(nodePath.join(outDir, 'fake.mjs'), { memoryMb: 48, timeoutMs: 20_000 });
    const result = await docs.parse({ path: 'x-oom', maxChars: 10 });
    expect(result).toMatchObject({ ok: false, code: 'memory' });
    expect(await docs.parse({ path: 'normal', maxChars: 10 })).toMatchObject({ ok: true });
  }, 30_000);

  it('işçi çıkarsa "crashed"; iptal "aborted"', async () => {
    const docs = client(nodePath.join(outDir, 'fake.mjs'), { timeoutMs: 5_000 });
    expect(await docs.parse({ path: 'x-exit', maxChars: 10 })).toMatchObject({ ok: false, code: 'crashed' });
    const controller = new AbortController();
    const pending = docs.parse({ path: 'y-hang', maxChars: 10 }, { signal: controller.signal });
    setTimeout(() => controller.abort(), 100);
    expect(await pending).toMatchObject({ ok: false, code: 'aborted' });
  });
});
