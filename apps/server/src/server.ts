// apps/server/src/server.ts
import 'dotenv/config';
import type { Server } from 'node:http';
import { createApp } from './app.js';
import { migrate } from './db/migrate.js';
import { isGoogleConfigured, resolveRootFolderId } from './modules/google/auth.js';
import { startAgingCron } from './jobs/agingCron.js';
import { closeDb } from './db/connection.js';

let server: Server;

async function bootstrap(): Promise<void> {
  await migrate();

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
  server = app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Server listening on http://localhost:${port}`);
  });
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start server:', err);
  process.exit(1);
});


let shuttingDown = false;

async function handleShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`\nReceived ${signal}, starting graceful shutdown...`);

  try {
    if (server) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }

    await closeDb();

    console.log('Graceful shutdown complete.');
    process.exit(0);
  } catch (err) {
    console.error('Error during shutdown:', err);
    process.exit(1);
  }
}

process.once('SIGINT', () => {
  void handleShutdown('SIGINT');
});

process.once('SIGTERM', () => {
  void handleShutdown('SIGTERM');
});

// process.on('SIGINT', () => handleShutdown('SIGINT'));
// process.on('SIGTERM', () => handleShutdown('SIGTERM'));