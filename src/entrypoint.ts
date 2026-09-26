import path from 'node:path';
import { fork, type ChildProcess } from 'node:child_process';
import { loadEnv, dbPath } from './shared/config/env';
import { createLogger } from './shared/logger';
import { openDb, runMigrations } from './shared/db/migrate';
import { buildServer } from './server/app';

const env = loadEnv();
const logger = createLogger('entrypoint');

const db = openDb(dbPath(env));
runMigrations(db, path.join(__dirname, 'shared', 'db', 'migrations'));

let worker: ChildProcess | undefined;
let restartAttempts = 0;
let shuttingDown = false;

function scheduleWorkerRestart(): void {
  if (shuttingDown) return;
  const backoffMs = Math.min(1000 * 2 ** restartAttempts, env.WORKER_RESTART_MAX_BACKOFF_MS);
  restartAttempts += 1;
  logger.warn({ backoffMs, restartAttempts }, 'restarting worker after backoff');
  setTimeout(startWorker, backoffMs);
}

function startWorker(): void {
  if (shuttingDown) return;
  const workerPath = path.join(__dirname, 'worker', 'index.js');
  worker = fork(workerPath, [], {
    env: process.env,
    silent: false,
  });

  worker.on('message', (msg: unknown) => {
    if (typeof msg === 'object' && msg !== null && 'type' in msg && msg.type === 'ready') {
      restartAttempts = 0;
      logger.info('worker reported ready');
    }
  });

  worker.on('exit', (code, signal) => {
    if (shuttingDown) return;
    logger.error({ code, signal }, 'worker exited unexpectedly, will restart');
    scheduleWorkerRestart();
  });

  worker.on('error', (err) => {
    logger.error({ err }, 'worker fork error');
  });
}

const app = buildServer(db, logger);

async function main(): Promise<void> {
  startWorker();
  await app.listen({ host: '0.0.0.0', port: env.PORT });
  logger.info({ port: env.PORT }, 'server listening');
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');

  if (worker && !worker.killed) {
    worker.kill('SIGTERM');
  }

  try {
    await app.close();
  } catch (err) {
    logger.error({ err }, 'error closing server');
  }

  db.close();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

main().catch((err) => {
  logger.error({ err }, 'fatal error starting entrypoint');
  process.exit(1);
});
