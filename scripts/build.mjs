// Üretim derlemesi: node scripts/build.mjs <desktop|admin|all>
// Ana süreç + preload esbuild ile, renderer Vite ile derlenir; çıktı apps/<ad>/dist altındadır.
// dist silinmez, üstüne yazılır: aynı anda koşan bir sınamanın altından dosyalar çekilmesin.
// Eski demet artıklarını temizlemek için: npm run clean
import path from 'node:path';
import { build as esbuild } from 'esbuild';
import { build as viteBuild } from 'vite';
import { apps, esbuildConfigs, resolveApps } from './lib/apps.mjs';
import { generateIndexes } from './gen-index.mjs';

const targets = resolveApps(process.argv[2]);
generateIndexes();

for (const name of targets) {
  const app = apps[name];
  const started = Date.now();
  for (const config of esbuildConfigs(name)) await esbuild(config);
  await viteBuild({ configFile: path.join(app.dir, 'vite.config.ts'), logLevel: 'warn' });
  console.log(`${name}: derlendi (${Date.now() - started} ms) → ${path.join(app.dir, 'dist')}`);
}
