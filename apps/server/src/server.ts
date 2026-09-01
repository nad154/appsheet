import 'dotenv/config';
import { createApp } from './app.js';
import { migrate } from './db/migrate.js';

async function bootstrap(): Promise<void> {
  await migrate();

  const port = Number(process.env.PORT ?? 3000);
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
