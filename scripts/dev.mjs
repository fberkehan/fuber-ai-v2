// Geliştirme: node scripts/dev.mjs <desktop|admin>
// Vite sunucusu (sıcak yenileme) + esbuild izleme; ana süreç ya da preload değişince Electron yeniden başlar.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { context } from 'esbuild';
import { createServer } from 'vite';
import { apps, esbuildConfigs } from './lib/apps.mjs';
import { generateIndexes } from './gen-index.mjs';

const name = process.argv[2];
const app = apps[name];
if (!app) {
  console.error('Kullanım: node scripts/dev.mjs <desktop|admin>');
  process.exit(1);
}

const require = createRequire(import.meta.url);
const electronPath = require('electron');
// Yeni modül/işleyici/sözlük dosyası eklendiğinde dizin açılışta üretilir; çalışırken eklenirse `npm run gen`.
generateIndexes();

const server = await createServer({ configFile: path.join(app.dir, 'vite.config.ts') });
await server.listen();
const devUrl = `http://127.0.0.1:${app.devPort}`;

let electron = null;
let stopping = false;

function startElectron() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  electron = spawn(electronPath, [app.dir, `--dev-server=${devUrl}`], { stdio: 'inherit', env });
  const current = electron;
  console.log(`${name}: Electron başladı (pid ${current.pid})`);
  current.on('exit', (code) => {
    console.log(`${name}: Electron çıktı (kod ${code})`);
    // Pencere kullanıcı tarafından kapatıldıysa geliştirme oturumu da biter; yeniden başlatmada sürer.
    if (electron === current && !stopping) void shutdown(0);
  });
}

let restartTimer = null;
let restarting = false;
let restartAgain = false;

// Ortak bir dosya değişince ana süreç ve preload demetleri art arda biter; tek yeniden başlatmada birleştirilir.
// Eski süreç tümüyle kapanmadan yenisi açılmaz (aksi halde yenisi tek örnek kilidini alamaz ve çıkar).
function scheduleRestart() {
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => void restartElectron(), 200);
}

async function restartElectron() {
  if (restarting) {
    restartAgain = true;
    return;
  }
  restarting = true;
  do {
    restartAgain = false;
    const previous = electron;
    electron = null;
    if (previous && previous.exitCode === null) {
      await new Promise((resolve) => {
        previous.once('exit', resolve);
        previous.kill();
      });
    }
  } while (restartAgain);
  restarting = false;
  if (!stopping) startElectron();
}

const configs = esbuildConfigs(name);
let pending = configs.length;
const contexts = await Promise.all(
  configs.map((config) =>
    context({
      ...config,
      plugins: [
        {
          name: 'restart-electron',
          setup(build) {
            let first = true;
            build.onEnd((result) => {
              if (result.errors.length > 0) return;
              if (first) {
                first = false;
                // İlk tur: bütün demetler hazır olunca Electron bir kez başlar.
                if (--pending === 0) startElectron();
                return;
              }
              scheduleRestart();
            });
          },
        },
      ],
    }),
  ),
);
await Promise.all(contexts.map((ctx) => ctx.watch()));
console.log(`${name}: geliştirme kipi, renderer ${devUrl}`);

async function shutdown(code) {
  if (stopping) return;
  stopping = true;
  electron?.kill();
  await Promise.all(contexts.map((ctx) => ctx.dispose()));
  await server.close();
  process.exit(code);
}
process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));
