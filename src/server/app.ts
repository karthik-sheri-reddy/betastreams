import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { registerHealthRoute } from './routes/health';
import type { Logger } from '../shared/logger';

export function buildServer(db: Database.Database, logger: Logger): FastifyInstance {
  const app = Fastify({
    // pino's Logger is runtime-compatible with FastifyBaseLogger (same method
    // surface); the two types just disagree on internal-only fields.
    loggerInstance: logger as unknown as FastifyBaseLogger,
    trustProxy: true,
  });

  registerHealthRoute(app, db);

  // The configure/admin site is a static Vite build. It's optional in dev
  // (not every checkout has run `npm run build:web`) but always present in
  // the production image.
  const webDist = path.join(__dirname, '..', '..', 'web', 'dist');
  if (fs.existsSync(webDist)) {
    void app.register(fastifyStatic, { root: webDist, prefix: '/' });
  } else {
    logger.warn({ webDist }, 'web/dist not found; configure site will 404 (run npm run build:web)');
  }

  return app;
}
