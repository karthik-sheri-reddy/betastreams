import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(7000),
  DATA_DIR: z.string().default('/data'),
  DB_PATH: z.string().optional(),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:7000'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TZ_DEFAULT: z.string().default('UTC'),
  ADMIN_TOKEN: z.string().optional(),
  SIGNING_SECRET: z.string().optional(),
  PROXY_MODE: z.enum(['redirect', 'hls']).default('redirect'),
  ENABLE_OCR: z.coerce.boolean().default(false),
  ENABLE_506: z.coerce.boolean().default(false),
  M3U_URLS: z.string().optional(),
  EPG_URLS: z.string().optional(),
  XTREAM_ACCOUNTS: z.string().optional(),
  SCHEDULES_DIRECT_USERNAME: z.string().optional(),
  SCHEDULES_DIRECT_PASSWORD: z.string().optional(),
  WORKER_RESTART_MAX_BACKOFF_MS: z.coerce.number().int().positive().default(30000),
});

export type AppEnv = z.infer<typeof envSchema>;

let cached: AppEnv | undefined;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  if (cached) return cached;
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
    throw new Error('Invalid environment configuration');
  }
  cached = parsed.data;
  return cached;
}

export function resetEnvCacheForTests(): void {
  cached = undefined;
}

export function dbPath(env: AppEnv = loadEnv()): string {
  return env.DB_PATH ?? `${env.DATA_DIR}/app.db`;
}
