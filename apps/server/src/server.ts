import 'dotenv/config';
import { createApp } from './app.js';
import { migrate } from './db/migrate.js';
import { isGoogleConfigured, resolveRootFolderId } from './modules/google/auth.js';
import { startAgingCron } from './jobs/agingCron.js';

async function bootstrap(): Promise<void> {
  await migrate();

  // Resolve the Drive root folder once at boot so a missing/misconfigured
  // root is surfaced immediately. Silently skip when Google isn't configured
  // (e.g. local dev) — the Drive endpoints report the error on use instead.
  if (isGoogleConfigured()) {
    try {
      await resolveRootFolderId();
      // eslint-disable-next-line no-console
      console.log('Google Drive ready (root folder resolved).');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Google Drive init failed:', err instanceof Error ? err.message : err);
    }
  } else {
    // eslint-disable-next-line no-console
    console.warn('Google Drive not configured — skipping init. Set GOOGLE_APPLICATION_CREDENTIALS to enable.');
  }

  const port = Number(process.env.PORT ?? 3000);

  try {
    startAgingCron();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Failed to start aging cron:', err instanceof Error ? err.message : err);
  }

  const app = createApp();
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Server listening on http://localhost:${port}`);
  });
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start server:', err);
  process.exit(1);
});
