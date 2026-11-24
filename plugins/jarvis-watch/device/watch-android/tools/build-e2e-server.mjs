// Kullanım: node tools/build-e2e-server.mjs <xr-modül-klasörü> [çıktı.mjs]
// Örn: node tools/build-e2e-server.mjs ../../../../jarvis-quest/desktop/modules/xr build/e2e-server.mjs
// esbuild paketinin yolu ESBUILD_DIR ortam değişkeniyle verilir (örn. Fuber AI v2 deposunun node_modules/esbuild).
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const xr = path.resolve(process.argv[2] ?? '');
const out = path.resolve(process.argv[3] ?? path.join(here, '..', 'build', 'e2e-server.mjs'));
const dir = process.env.ESBUILD_DIR;
const require = createRequire(pathToFileURL(path.join(dir ?? here, 'x.js')));
const { build } = require(dir ?? 'esbuild');
await build({
  entryPoints: [path.join(here, 'e2e-server.ts')],
  bundle: true, platform: 'node', format: 'esm', target: 'node20',
  alias: { xr }, outfile: out,
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
});
console.log('yazıldı: ' + out);
