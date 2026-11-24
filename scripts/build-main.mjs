// Ana süreç (ESM) ve preload (CJS: sandbox'lı preload ESM olamaz) esbuild ile derlenir.
// node_modules paketleri DIŞTA kalır; electron-builder üretim bağımlılıklarını paketler.
import { build } from 'esbuild';
import { ozelModulGirisleri } from './ozel-klasor.mjs';

const ortak = { bundle: true, platform: 'node', target: 'node24', sourcemap: true, logLevel: 'warning' };
// İsteğe bağlı modüller (ozel/<modül>/kayit.ts; ör. WhatsApp bağlantısı — bu depoda yok) varsa AYNI pakete, main.ts'ten SONRA içe aktarılır
// (giriş: main.ts + modüller). Böylece ortam kapısı yine ilk çalışan koddur (main.ts'in ilk içe aktarımı) ve modül paylaşılan ana süreç modüllerinin
// (ayarlar, veritabanı…) aynı örneğini kullanır; yüklenince kendini genel kodun kapısına kaydeder (main/entegrasyon/whatsapp-kapisi.ts) — eşzamanlı,
// uygulama hazır olmadan önce. Genel kod `ozel/`i içe aktarmaz; bu depoda klasör yoktur → giriş yalnız main.ts.
const ozelModuller = ozelModulGirisleri();
const anaGiris = ozelModuller.length
  ? { stdin: { contents: ['src/main/main.ts', ...ozelModuller].map((m) => `import './${m}';`).join('\n'), resolveDir: process.cwd(), sourcefile: 'ana-giris.ts', loader: 'ts' } }
  : { entryPoints: ['src/main/main.ts'] };

await build({
  ...ortak,
  ...anaGiris,
  outfile: 'dist/main/main.js',
  format: 'esm',
  packages: 'external',
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});

// İnceleme I1: belge ayrıştırma işçisi (utilityProcess; ayrı paket — ana süreç onu yükleyip içinde çalıştırmaz).
await build({
  ...ortak,
  entryPoints: ['src/main/belge-isci.ts'],
  outfile: 'dist/main/belge-isci.js',
  format: 'esm',
  packages: 'external',
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});

await build({
  ...ortak,
  entryPoints: ['src/preload/preload.ts'],
  outfile: 'dist/preload/preload.cjs',
  format: 'cjs',
  external: ['electron'],
});
// Fuber Tarayıcı submit izcisi (oturum önyüklemesi; sandbox'lı: CJS, yalnız electron dışarıda).
await build({
  ...ortak,
  entryPoints: ['src/preload/submit-izci.ts'],
  outfile: 'dist/preload/submit-izci.cjs',
  format: 'cjs',
  external: ['electron'],
});
console.log(`ana süreç + preload derlendi (özel modül: ${ozelModuller.length ? ozelModuller.map((m) => m.split('/')[1]).join(', ') : 'yok'})`);
