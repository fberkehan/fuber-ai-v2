import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
    environment: 'node',
    // Electron'a ya da gerçek ağa dokunan sınamalar burada koşmaz; onlar scripts/e2e altındadır.
    exclude: ['**/node_modules/**', '**/dist/**', '**/release/**'],
    // Keşif dizinleri (`*.gen.ts`) `npx vitest` ile doğrudan koşulduğunda da güncel olsun.
    globalSetup: ['./scripts/vitest-setup.mjs'],
  },
});
