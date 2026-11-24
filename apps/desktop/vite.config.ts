import { defineRendererConfig } from '../../scripts/lib/renderer-config.mjs';

// Girişler ve port `@fuber/shared` içindeki RENDERER_ENTRIES ve DEV_PORT_DESKTOP ile aynıdır.
// Yapılandırma dosyası Node'da derlenmeden yüklendiği için oradan içe aktarılmaz.
export default defineRendererConfig({
  appDir: import.meta.dirname,
  entries: ['main', 'hud', 'audio', 'setup'],
  port: 5173,
});
