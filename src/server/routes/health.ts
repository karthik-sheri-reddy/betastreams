import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { getDataVersion } from '../../shared/db/meta';

export function registerHealthRoute(app: FastifyInstance, db: Database.Database): void {
  app.get('/health', async (_req, reply) => {
    let dataVersion: number | null = null;
    let dbOk = true;
    try {
      dataVersion = getDataVersion(db);
    } catch {
      dbOk = false;
    }

    const body = {
      status: dbOk ? 'ok' : 'degraded',
      uptimeSeconds: Math.round(process.uptime()),
      dataVersion,
      timestamp: new Date().toISOString(),
    };

    reply.code(dbOk ? 200 : 503).send(body);
  });
}
