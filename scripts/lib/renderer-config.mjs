// İki uygulamanın ortak Vite yapılandırması: React 19 + Tailwind v4, çok girişli, file:// ile yüklenen çıktı.
import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

/**
 * Paketlenen sayfalara içerik güvenlik politikası ekler. Geliştirme sunucusunda eklenmez:
 * sıcak yenileme satır içi betik ve WebSocket ister.
 */
function cspPlugin() {
  const policy = [
    "default-src 'self'",
    // wasm-unsafe-eval: ses penceresindeki olası WASM işleyiciler için; satır içi betik yok.
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: file:",
    "font-src 'self' data:",
    "media-src 'self' blob: data:",
    "worker-src 'self' blob:",
    "connect-src 'self'",
    // Sahnedeki kum havuzlu mini uygulamalar srcdoc/blob çerçevesinde koşar.
    "frame-src 'self' blob: data:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  return {
    name: 'fuber-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`);
    },
  };
}

/**
 * @param {{ appDir: string, entries: string[], port: number }} options
 *   appDir: uygulama klasörü (apps/desktop); entries: `src/renderer/<ad>/index.html` girişleri.
 */
export function defineRendererConfig({ appDir, entries, port }) {
  const root = path.join(appDir, 'src', 'renderer');
  return defineConfig({
    root,
    // Sayfalar file:// ile açılır; bütün yollar göreli olmalı.
    base: './',
    plugins: [react(), tailwindcss(), cspPlugin()],
    clearScreen: false,
    server: { port, strictPort: true, host: '127.0.0.1' },
    build: {
      outDir: path.join(appDir, 'dist', 'renderer'),
      // Üstüne yazılır, silinmez (bkz. scripts/build.mjs).
      emptyOutDir: false,
      target: 'chrome150',
      modulePreload: { polyfill: false },
      sourcemap: true,
      rolldownOptions: {
        input: Object.fromEntries(entries.map((name) => [name, path.join(root, name, 'index.html')])),
        onwarn(warning, defaultHandler) {
          // Tailwind eklentisi CSS dönüşümü için kaynak haritası üretmez; JS haritaları etkilenmez.
          if (warning.code === 'SOURCEMAP_BROKEN') return;
          defaultHandler(warning);
        },
      },
    },
  });
}
