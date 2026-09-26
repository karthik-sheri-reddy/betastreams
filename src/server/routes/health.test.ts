import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, runMigrations } from '../../shared/db/migrate';
import { buildServer } from '../app';
import { createLogger } from '../../shared/logger';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';

process.env.PUBLIC_BASE_URL ??= 'http://localhost:7000';

let tmpDir: string;
let db: Database.Database;
let app: FastifyInstance;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'betastreams-health-'));
  db = openDb(path.join(tmpDir, 'app.db'));
  runMigrations(db, path.join(__dirname, '..', '..', 'shared', 'db', 'migrations'));
  app = buildServer(db, createLogger('test'));
});

afterEach(async () => {
  await app.close();
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('GET /health', () => {
  it('returns 200 with status ok and the current data version', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.dataVersion).toBe(0);
    expect(typeof body.uptimeSeconds).toBe('number');
  });
});
