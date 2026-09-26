import type { XtreamAccountConfig } from '../../../shared/config/xtreamAccounts';
import { redactCredentials } from '../../../shared/redact';

export interface XtreamUserInfo {
  status?: string;
  exp_date?: string | number | null;
  max_connections?: string | number;
  active_cons?: string | number;
  allowed_output_formats?: string[];
}

export interface XtreamServerInfo {
  url?: string;
  port?: string | number;
  https_port?: string | number;
  server_protocol?: string;
  timezone?: string;
}

export interface XtreamAccountCheckResponse {
  user_info?: XtreamUserInfo;
  server_info?: XtreamServerInfo;
}

export interface AccountHealth {
  healthy: boolean;
  reason?: string;
  userInfo?: XtreamUserInfo;
  serverInfo?: XtreamServerInfo;
  maxConnections?: number;
  activeConnections?: number;
}

/** Default player-shaped User-Agent, since Xtream panels often reject client-library agents (§2.1 politeness). */
const DEFAULT_USER_AGENT = 'IPTVSmartersPro/1.0 (Linux; SmartTV)';

export function xtreamHeaders(account: XtreamAccountConfig): Record<string, string> {
  return {
    'User-Agent': account.userAgent ?? DEFAULT_USER_AGENT,
    ...account.headers,
  };
}

export function xtreamApiUrl(account: XtreamAccountConfig, params: Record<string, string> = {}): string {
  const url = new URL(`${account.serverUrl}/player_api.php`);
  url.searchParams.set('username', account.username);
  url.searchParams.set('password', account.password);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

function toNumber(v: string | number | null | undefined): number | undefined {
  if (v === null || v === undefined) return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
}

/**
 * Account check (§2.1): calls player_api.php with no `action`, reads
 * user_info/server_info, and reports whether the account is usable.
 * Never throws on a bad account — callers should treat an unhealthy
 * result as "skip this source, keep serving the last good data" (§2),
 * not as a fatal ingest error.
 */
export async function checkXtreamAccount(account: XtreamAccountConfig): Promise<AccountHealth> {
  const url = xtreamApiUrl(account);

  let res: Response;
  try {
    res = await fetch(url, { headers: xtreamHeaders(account) });
  } catch (err) {
    return { healthy: false, reason: `network error: ${redactCredentials(String(err))}` };
  }

  if (!res.ok) {
    return { healthy: false, reason: `http ${res.status}` };
  }

  let body: XtreamAccountCheckResponse;
  try {
    body = (await res.json()) as XtreamAccountCheckResponse;
  } catch {
    return { healthy: false, reason: 'invalid JSON in account-check response' };
  }

  const userInfo = body.user_info;
  const serverInfo = body.server_info;
  if (!userInfo || !serverInfo) {
    return { healthy: false, reason: 'malformed account-check response (missing user_info/server_info)' };
  }

  const expDateSeconds = toNumber(userInfo.exp_date);
  const expired = expDateSeconds !== undefined && expDateSeconds * 1000 < Date.now();
  const active = userInfo.status === 'Active' && !expired;

  return {
    healthy: active,
    reason: active ? undefined : `status=${userInfo.status ?? 'unknown'}${expired ? ' (expired)' : ''}`,
    userInfo,
    serverInfo,
    maxConnections: toNumber(userInfo.max_connections),
    activeConnections: toNumber(userInfo.active_cons),
  };
}

/** account.output wins; otherwise the first entry the account-check response allows. Falls back to "ts". */
export function resolveOutputExt(account: XtreamAccountConfig, userInfo?: XtreamUserInfo): string {
  if (account.output) return account.output;
  const allowed = userInfo?.allowed_output_formats;
  return allowed && allowed.length > 0 ? (allowed[0] as string) : 'ts';
}
