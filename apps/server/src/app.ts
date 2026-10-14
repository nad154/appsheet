import express from 'express';
import cors from 'cors';
import { authRouter } from './modules/auth/routes.js';
import { projectsRouter } from './modules/projects/routes.js';
import { projectUpdatesRouter } from './modules/project-updates/routes.js';
import { issuesRouter } from './modules/issues/routes.js';
import { settingsRouter } from './modules/settings/routes.js';
import { driveRouter } from './modules/drive/routes.js';
import { notificationsRouter } from './modules/notifications/routes.js';
import { dashboardRouter } from './modules/dashboard/routes.js';
import { customersRouter } from './modules/customers/routes.js';
import { vendorsRouter } from './modules/vendors/routes.js';
import { projectVendorsRouter } from './modules/project-vendors/routes.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/projects', projectsRouter);
  app.use('/api/projects', projectUpdatesRouter);
  app.use('/api/projects', issuesRouter);
  app.use('/api/projects', projectVendorsRouter);
  app.use('/api/customers', customersRouter);
  app.use('/api/vendors', vendorsRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/drive', driveRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/dashboard', dashboardRouter);

  const here = path.dirname(fileURLToPath(import.meta.url));
  const webDist = process.env.WEB_DIST_DIR ?? path.resolve(here, '../../web/dist');

  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist));
    // SPA fallback for react-router (anything that isn't /api)
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.sendFile(path.join(webDist, 'index.html'));
    });
  }

  return app;
}
