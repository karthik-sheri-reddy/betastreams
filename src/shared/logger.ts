import pino from 'pino';
import { loadEnv } from './config/env';

export function createLogger(name: string) {
  const env = loadEnv();
  return pino({
    name,
    level: env.LOG_LEVEL,
    transport:
      env.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
        : undefined,
  });
}

export type Logger = ReturnType<typeof createLogger>;
