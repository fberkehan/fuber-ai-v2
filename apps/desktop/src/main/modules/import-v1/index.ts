// Eski Fuber AI'den (v1) veri aktarımı: hafıza, hatırlatıcı, yapılacak ve meseleler. Kullanıcı Ayarlar › Gizlilik
// ve veri'den başlatır; önizleme yalnız sayılara bakar, onaysız hiçbir satır okunmaz ya da yazılmaz.
import path from 'node:path';
import { app } from 'electron';
import { defineModule, type ModuleContext } from '@fuber/shared';
import { testing } from '../../testing';
import { createV1Importer, IMPORT_V1_MIGRATIONS, type V1Importer } from './importer';
import { createImportSink } from './sink';
import './types';

/** v1 veri klasörü. Sınamada yalnız `FUBER2_V1_DATA` (verilmediyse hiçbir klasör: gerçek v1 verisine bakılmaz). */
function v1Dir(): string | null {
  if (testing.v1DataDir !== undefined) return testing.v1DataDir;
  return path.join(app.getPath('appData'), 'Fuber AI');
}

let importer: V1Importer | null = null;

function importerFor(ctx: ModuleContext): V1Importer {
  importer ??= createV1Importer({
    db: ctx.db,
    sink: createImportSink(ctx),
    bus: ctx.bus,
    log: ctx.log,
    v1Dir,
    tempDir: path.join(ctx.paths.temp, 'import-v1'),
  });
  return importer;
}

export default defineModule({
  id: 'import-v1',
  version: '1.0.0',
  nameKey: 'module.import-v1.name',
  descriptionKey: 'module.import-v1.description',
  permissions: ['fs'],
  migrations: IMPORT_V1_MIGRATIONS,
  windowEvents: ['import-v1.progress'],

  ipc: (ctx) => {
    const run = () => importerFor(ctx);
    return {
      'import-v1.status': () => run().status(),
      'import-v1.preview': () => run().preview(),
      'import-v1.run': ({ options }) => run().run(options),
      'import-v1.undo': ({ runId }) => run().undo(runId),
    };
  },

  teardown() {
    importer = null;
  },
});
