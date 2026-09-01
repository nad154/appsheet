import express from 'express';
import cors from 'cors';
import { authRouter } from './modules/auth/routes.js';
import { projectsRouter } from './modules/projects/routes.js';
import { pendingEditsRouter } from './modules/pending-edits/routes.js';
import { settingsRouter } from './modules/settings/routes.js';
import { driveRouter } from './modules/drive/routes.js';

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/projects', projectsRouter);
  app.use('/api/pending-edits', pendingEditsRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/drive', driveRouter);

  return app;
}
