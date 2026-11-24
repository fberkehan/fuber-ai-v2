import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIRS, type Paths } from '@fuber/shared';
import { runtime } from '../runtime';

/** Veri kökü altındaki yolları kurar ve klasörleri oluşturur. */
export function createPaths(): Paths {
  const data = runtime.dataDir;
  const paths: Paths = {
    data,
    db: path.join(data, DATA_DIRS.dbFile),
    logs: path.join(data, DATA_DIRS.logs),
    models: path.join(data, DATA_DIRS.models),
    skills: path.join(data, DATA_DIRS.skills),
    cache: path.join(data, DATA_DIRS.cache),
    temp: path.join(data, DATA_DIRS.temp),
    policyCache: path.join(data, DATA_DIRS.policyCacheFile),
    resources: runtime.resourcesDir,
  };
  // Geçici klasör bir önceki oturumdan kalanlarla açılmaz; silinemeyen (kilitli) dosya açılışı durdurmaz.
  try {
    fs.rmSync(paths.temp, { recursive: true, force: true });
  } catch {
    // kilitli dosya: bir sonraki açılışta yeniden denenir
  }
  for (const dir of [paths.data, paths.logs, paths.models, paths.skills, paths.cache, paths.temp]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return paths;
}
