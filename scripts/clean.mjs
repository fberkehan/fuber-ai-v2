// Derleme çıktılarını ve sınama artıklarını siler: node scripts/clean.mjs
import fs from 'node:fs';
import path from 'node:path';
import { apps, root } from './lib/apps.mjs';

const targets = [...Object.values(apps).map((app) => path.join(app.dir, 'dist')), path.join(root, 'artifacts')];
for (const target of targets) {
  fs.rmSync(target, { recursive: true, force: true });
  console.log(`silindi: ${target}`);
}
