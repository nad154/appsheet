import { defineConfig } from 'vitest/config';

// Unit tests only run *.test.ts; Playwright's e2e *.spec.ts files must never
// be picked up here (they need a browser and the dev servers).
export default defineConfig({
  test: {
    include: ['**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/test-results/**', 'apps/web/e2e/**'],
  },
});
