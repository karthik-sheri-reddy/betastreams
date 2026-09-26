import { z } from 'zod';

const xtreamAccountSchema = z.object({
  id: z.string().min(1),
  server_url: z.string().url(),
  username: z.string().min(1),
  password: z.string().min(1),
  output: z.enum(['m3u8', 'ts']).optional(),
  user_agent: z.string().optional(),
  headers: z.record(z.string()).optional(),
});

export interface XtreamAccountConfig {
  id: string;
  serverUrl: string;
  username: string;
  password: string;
  output?: 'm3u8' | 'ts';
  userAgent?: string;
  headers?: Record<string, string>;
}

/**
 * Parses XTREAM_ACCOUNTS (a JSON array, see .env.example / §2.1). Invalid
 * or missing config yields an empty array rather than throwing, so a
 * misconfigured or absent Xtream setup never takes down ingest for other
 * sources (§2 "every external source must be individually disable-able").
 */
export function loadXtreamAccountsFromEnv(raw: string | undefined): XtreamAccountConfig[] {
  if (!raw || raw.trim() === '') return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  const result = z.array(xtreamAccountSchema).safeParse(parsed);
  if (!result.success) return [];

  return result.data.map((a) => ({
    id: a.id,
    serverUrl: a.server_url.replace(/\/+$/, ''),
    username: a.username,
    password: a.password,
    output: a.output,
    userAgent: a.user_agent,
    headers: a.headers,
  }));
}
