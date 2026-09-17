import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'apps/web/e2e',
  timeout: 60000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: 'node apps/server/scripts/start-safe.js',
      url: 'http://localhost:3000/api/health',
      reuseExistingServer: false,
      timeout: 30000,
      env: { LOGIN_RATE_LIMIT_MAX: '100' },
    },
    {
      command: 'npm run dev:web',
      url: 'http://localhost:5173',
      reuseExistingServer: false,
      timeout: 60000,
    },
  ],
});
