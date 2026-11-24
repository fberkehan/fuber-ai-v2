// Derleme ve geliştirme betiklerinin ortak uygulama tanımları ve esbuild ayarları.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * externals: demete girmeyen, çalışma anında node_modules'tan yüklenen yerel eklentiler.
 * Buraya eklenen paket uygulamanın package.json `dependencies` alanında da olmalıdır (paketleme için).
 */
export const apps = {
  desktop: {
    dir: path.join(root, 'apps', 'desktop'),
    devPort: 5173,
    // pdf-parse: pdf.js kendi işçi dosyasını ve @napi-rs/canvas'ı çalışma anında yükler; demete girmez.
    externals: ['koffi', 'sherpa-onnx-node', 'pdf-parse'],
    // Ana süreçten ayrı süreçte koşan girişler: ses işçisi (utilityProcess), ses konağı (ekran kartı seslendirmesi),
    // yetenek konağı ve belge işçisi.
    workers: {
      'worker/index': 'src/worker/index.ts',
      'tts-host/index': 'src/tts-host/index.ts',
      'skill-host/index': 'src/skill-host/index.ts',
      'doc-worker/index': 'src/main/modules/documents/worker/entry.ts',
    },
  },
  admin: {
    dir: path.join(root, 'apps', 'admin'),
    devPort: 5174,
    externals: [],
    workers: {},
  },
};

export function resolveApps(arg) {
  if (arg === 'all' || arg === undefined) return Object.keys(apps);
  if (!apps[arg]) throw new Error(`Bilinmeyen uygulama: ${arg} (desktop | admin | all)`);
  return [arg];
}

// ESM demetine giren CJS paketleri `require` ister (ör. ws → node:events).
const esmBanner = [
  "import { createRequire as __fuberCreateRequire } from 'node:module';",
  'const require = __fuberCreateRequire(import.meta.url);',
].join('\n');

/** Bir uygulamanın esbuild yapılandırmaları: ana süreç (ESM), işçiler (ESM), preload (CJS, kum havuzuna uygun). */
export function esbuildConfigs(name) {
  const app = apps[name];
  const node = {
    bundle: true,
    platform: 'node',
    target: 'node24',
    sourcemap: true,
    logLevel: 'warning',
    absWorkingDir: app.dir,
    external: ['electron', ...app.externals],
  };
  const nodeEntries = { 'main/main': 'src/main/main.ts' };
  for (const [out, src] of Object.entries(app.workers)) {
    if (fs.existsSync(path.join(app.dir, src))) nodeEntries[out] = src;
  }
  return [
    {
      ...node,
      entryPoints: nodeEntries,
      outdir: 'dist',
      format: 'esm',
      banner: { js: esmBanner },
    },
    {
      ...node,
      entryPoints: { 'preload/preload': 'src/preload/preload.ts' },
      outdir: 'dist',
      format: 'cjs',
      outExtension: { '.js': '.cjs' },
    },
  ];
}
