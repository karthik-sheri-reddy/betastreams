import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFileCache, loadIptvOrgData, type IptvOrgData } from './iptvOrg';

let tmpDir: string;

afterEach(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function makeFetchImpl(): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string) => {
    const name = url.split('/').pop();
    const body =
      name === 'channels.json'
        ? [{ id: 'ESPN.us', name: 'ESPN' }]
        : name === 'feeds.json'
          ? [{ channel: 'ESPN.us', id: 'US' }]
          : name === 'logos.json'
            ? [{ channel: 'ESPN.us', url: 'http://logos.example/espn.png' }]
            : [{ channel: 'ESPN.us', site: 'espn.com', site_id: '123' }];
    return { ok: true, status: 200, json: async () => body } as Response;
  });
}

describe('loadIptvOrgData', () => {
  it('fetches all four endpoints and writes them to the cache when nothing is cached', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iptvorg-'));
    const cache = createFileCache(path.join(tmpDir, 'iptv-org.json'));
    const fetchImpl = makeFetchImpl();

    const result = await loadIptvOrgData({ cache, fetchImpl });
    expect(result.stale).toBe(false);
    expect(result.data.channels).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(4);

    const persisted = cache.read();
    expect(persisted?.channels).toHaveLength(1);
  });

  it('serves the cache without fetching when within maxAgeMs', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iptvorg-'));
    const cache = createFileCache(path.join(tmpDir, 'iptv-org.json'));
    const fresh: IptvOrgData = {
      channels: [{ id: 'X', name: 'X' }],
      feeds: [],
      logos: [],
      guides: [],
      fetchedAt: new Date().toISOString(),
    };
    cache.write(fresh);

    const fetchImpl = vi.fn();
    const result = await loadIptvOrgData({ cache, fetchImpl, maxAgeMs: 60_000 });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.stale).toBe(false);
    expect(result.data.channels[0]?.id).toBe('X');
  });

  it('refetches when the cache is older than maxAgeMs', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iptvorg-'));
    const cache = createFileCache(path.join(tmpDir, 'iptv-org.json'));
    const old: IptvOrgData = {
      channels: [{ id: 'OLD', name: 'Old' }],
      feeds: [],
      logos: [],
      guides: [],
      fetchedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    };
    cache.write(old);

    const fetchImpl = makeFetchImpl();
    const result = await loadIptvOrgData({ cache, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(result.data.channels[0]?.id).toBe('ESPN.us');
  });

  it('falls back to stale cached data when a refresh fetch fails', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iptvorg-'));
    const cache = createFileCache(path.join(tmpDir, 'iptv-org.json'));
    const old: IptvOrgData = {
      channels: [{ id: 'OLD', name: 'Old' }],
      feeds: [],
      logos: [],
      guides: [],
      fetchedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    };
    cache.write(old);

    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    });

    const result = await loadIptvOrgData({ cache, fetchImpl });
    expect(result.stale).toBe(true);
    expect(result.data.channels[0]?.id).toBe('OLD');
  });

  it('throws when a refresh fails and there is no cache to fall back on', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iptvorg-'));
    const cache = createFileCache(path.join(tmpDir, 'iptv-org.json'));
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    });

    await expect(loadIptvOrgData({ cache, fetchImpl })).rejects.toThrow('network down');
  });
});
