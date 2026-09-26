import { describe, it, expect, afterEach, vi } from 'vitest';
import { checkXtreamAccount, resolveOutputExt, xtreamApiUrl } from './xtreamAccount';
import type { XtreamAccountConfig } from '../../../shared/config/xtreamAccounts';

const SECRET_USER = 'testuser_zz9';
const SECRET_PASS = 'testpass_zz9';

const account: XtreamAccountConfig = {
  id: 'acct1',
  serverUrl: 'http://provider.example.invalid',
  username: SECRET_USER,
  password: SECRET_PASS,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('xtreamApiUrl', () => {
  it('builds a player_api.php URL with credentials as query params', () => {
    const url = xtreamApiUrl(account, { action: 'get_live_categories' });
    expect(url).toContain('username=testuser_zz9');
    expect(url).toContain('action=get_live_categories');
  });
});

describe('checkXtreamAccount', () => {
  it('reports healthy for an Active, unexpired account', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          user_info: { status: 'Active', exp_date: '4795200000', max_connections: '1', active_cons: '0' },
          server_info: { url: 'provider.example.invalid', port: '80' },
        }),
      })),
    );
    const health = await checkXtreamAccount(account);
    expect(health.healthy).toBe(true);
    expect(health.maxConnections).toBe(1);
  });

  it('reports unhealthy for a non-Active status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ user_info: { status: 'Banned' }, server_info: { url: 'x' } }),
      })),
    );
    const health = await checkXtreamAccount(account);
    expect(health.healthy).toBe(false);
    expect(health.reason).toContain('Banned');
  });

  it('reports unhealthy for an expired account even if status says Active', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          user_info: { status: 'Active', exp_date: '1' }, // 1 second past epoch — long expired
          server_info: { url: 'x' },
        }),
      })),
    );
    const health = await checkXtreamAccount(account);
    expect(health.healthy).toBe(false);
    expect(health.reason).toContain('expired');
  });

  it('reports unhealthy on HTTP error without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403 })));
    const health = await checkXtreamAccount(account);
    expect(health.healthy).toBe(false);
    expect(health.reason).toBe('http 403');
  });

  it('never leaks credentials in the reason string on a network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error(
          `fetch failed for http://provider.example.invalid/player_api.php?username=${SECRET_USER}&password=${SECRET_PASS}`,
        );
      }),
    );
    const health = await checkXtreamAccount(account);
    expect(health.healthy).toBe(false);
    expect(health.reason).not.toContain(SECRET_USER);
    expect(health.reason).not.toContain(SECRET_PASS);
  });
});

describe('resolveOutputExt', () => {
  it('prefers the configured output', () => {
    expect(resolveOutputExt({ ...account, output: 'ts' })).toBe('ts');
  });

  it('falls back to the first allowed_output_formats entry', () => {
    expect(resolveOutputExt(account, { allowed_output_formats: ['m3u8', 'ts'] })).toBe('m3u8');
  });

  it('falls back to ts when nothing else is known', () => {
    expect(resolveOutputExt(account)).toBe('ts');
  });
});
