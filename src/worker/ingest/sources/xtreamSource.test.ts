import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  XtreamChannelSource,
  XtreamEpgSource,
  XtreamAccountUnhealthyError,
  fetchShortEpg,
} from './xtreamSource';
import type { XtreamAccountConfig } from '../../../shared/config/xtreamAccounts';

const FIXTURES_DIR = path.join(__dirname, '..', '__fixtures__', 'xtream');

function loadFixture<T = unknown>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf-8')) as T;
}

// Fabricated, non-functioning test credentials — never real provider values.
const SECRET_USER = 'testuser_zz9';
const SECRET_PASS = 'testpass_zz9';

const account: XtreamAccountConfig = {
  id: 'acct1',
  serverUrl: 'http://provider.example.invalid',
  username: SECRET_USER,
  password: SECRET_PASS,
  output: 'm3u8',
};

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

function installFetchMock() {
  const calls: string[] = [];
  const mock = vi.fn(async (url: string | URL) => {
    const urlStr = url.toString();
    calls.push(urlStr);
    const parsed = new URL(urlStr);
    const action = parsed.searchParams.get('action');

    if (parsed.pathname === '/player_api.php' && !action) {
      return jsonResponse(loadFixture('account_check.json'));
    }
    if (action === 'get_live_categories') {
      return jsonResponse(loadFixture('categories.json'));
    }
    if (action === 'get_live_streams') {
      const categoryId = parsed.searchParams.get('category_id');
      return jsonResponse(loadFixture(`streams_category_${categoryId}.json`));
    }
    if (action === 'get_short_epg') {
      return jsonResponse(loadFixture('short_epg.json'));
    }
    if (parsed.pathname === '/xmltv.php') {
      const xml = fs.readFileSync(
        path.join(__dirname, '..', '__fixtures__', 'xmltv', 'sample.xml'),
        'utf-8',
      );
      return {
        ok: true,
        status: 200,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(xml));
            controller.close();
          },
        }),
      } as unknown as Response;
    }

    throw new Error(`Unhandled fixture route: ${urlStr}`);
  });
  vi.stubGlobal('fetch', mock);
  return { mock, calls };
}

describe('XtreamChannelSource', () => {
  beforeEach(() => {
    installFetchMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches only sports + maybe-sports category streams, skipping the rest', async () => {
    const source = new XtreamChannelSource(account);
    const records = await source.fetchChannels();
    // 2 from "USA | SPORTS" + 1 from "PPV EVENTS"; entertainment/kids excluded.
    expect(records).toHaveLength(3);
    expect(records.map((r) => r.name).sort()).toEqual(['ESPN HD', 'FOX Sports 1', 'PPV 3 - UFC 320'].sort());
  });

  it('reports the pre-filter summary via the onCategoriesClassified callback', async () => {
    const onCategoriesClassified = vi.fn();
    const source = new XtreamChannelSource(account, { onCategoriesClassified });
    await source.fetchChannels();
    expect(onCategoriesClassified).toHaveBeenCalledWith({ includedCount: 2, excludedCount: 2 });
  });

  it('never embeds real credentials in the returned urlTemplate', async () => {
    const source = new XtreamChannelSource(account);
    const records = await source.fetchChannels();
    for (const r of records) {
      expect(r.urlTemplate).not.toContain(SECRET_USER);
      expect(r.urlTemplate).not.toContain(SECRET_PASS);
      expect(r.urlTemplate).toMatch(/^\{server\}\/live\/\{username\}\/\{password\}\/\d+\.m3u8$/);
    }
  });

  it('maps epg_channel_id to tvgId and category name to group', async () => {
    const source = new XtreamChannelSource(account);
    const records = await source.fetchChannels();
    const espn = records.find((r) => r.name === 'ESPN HD');
    expect(espn).toMatchObject({
      tvgId: 'ESPN.us',
      group: 'USA | SPORTS',
      tvArchive: true,
      tvArchiveDurationHours: 24,
    });
  });

  it('throws XtreamAccountUnhealthyError and makes no further calls when the account check fails', async () => {
    const { mock } = installFetchMock();
    mock.mockImplementationOnce(async () =>
      jsonResponse({ user_info: { status: 'Expired' }, server_info: { url: 'x' } }),
    );
    const source = new XtreamChannelSource(account);
    await expect(source.fetchChannels()).rejects.toBeInstanceOf(XtreamAccountUnhealthyError);
    expect(mock).toHaveBeenCalledTimes(1);
  });
});

describe('XtreamEpgSource', () => {
  beforeEach(() => {
    installFetchMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stream-parses the xmltv.php guide into ProgrammeRecords', async () => {
    const source = new XtreamEpgSource(account);
    const records = [];
    for await (const rec of source.fetchProgrammes()) records.push(rec);
    expect(records.length).toBeGreaterThan(0);
    expect(records[0]).toHaveProperty('title');
  });
});

describe('fetchShortEpg', () => {
  beforeEach(() => {
    installFetchMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('base64-decodes title and description fields', async () => {
    const entries = await fetchShortEpg(account, 5001, 4);
    expect(entries).toEqual([
      {
        title: 'NBA Basketball: Lakers at Celtics',
        description: 'Live NBA coverage.',
        start: '2026-01-15 18:00:00',
        end: '2026-01-15 21:00:00',
      },
    ]);
  });
});
