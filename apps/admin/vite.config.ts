import { defineRendererConfig } from '../../scripts/lib/renderer-config.mjs';

// Port `@fuber/shared` içindeki DEV_PORT_ADMIN ile aynıdır.
export default defineRendererConfig({
  appDir: import.meta.dirname,
  entries: ['main'],
  port: 5174,
});
