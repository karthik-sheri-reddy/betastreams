import { describe, it, expect, afterEach, vi } from 'vitest';
import { fetchEspnScoreboard, fetchEspnTeams, computeAdaptivePollIntervalMs, type EspnEvent } from './client';

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockFetch(handler: (url: string) => { status: number; body?: unknown; etag?: string }) {
  const fn = vi.fn(async (url: string) => {
    const r = handler(url);
    return {
      ok: r.status < 400,
      status: r.status,
      json: async () => r.body,
      headers: { get: (name: string) => (name.toLowerCase() === 'etag' ? r.etag : undefined) },
    } as unknown as Response;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('fetchEspnScoreboard', () => {
  it('builds the correct sport/league/scoreboard URL with a date param', async () => {
    const fn = mockFetch(() => ({ status: 200, body: { events: [] }, etag: 'v1' }));
    const result = await fetchEspnScoreboard('football', 'nfl', '20260115');
    expect(fn).toHaveBeenCalledWith(
      expect.stringContaining('/apis/site/v2/sports/football/nfl/scoreboard?dates=20260115'),
      expect.anything(),
    );
    expect(result.status).toBe(200);
    expect(result.etag).toBe('v1');
  });

  it('sends If-None-Match when an etag is supplied and returns 304 without a body', async () => {
    let sentHeaders: Record<string, string> = {};
    const fn = vi.fn(async (_url: string, init?: RequestInit) => {
      sentHeaders = (init?.headers as Record<string, string>) ?? {};
      return { ok: false, status: 304, json: async () => undefined, headers: { get: () => undefined } } as unknown as Response;
    });
    vi.stubGlobal('fetch', fn);

    const result = await fetchEspnScoreboard('football', 'nfl', undefined, { etag: 'etag-abc' });
    expect(sentHeaders['If-None-Match']).toBe('etag-abc');
    expect(result.status).toBe(304);
    expect(result.body).toBeUndefined();
  });

  it('reports the raw status on a non-ok, non-304 response (e.g. a disabled/404 league path)', async () => {
    mockFetch(() => ({ status: 404 }));
    const result = await fetchEspnScoreboard('football', 'made-up-league');
    expect(result.status).toBe(404);
    expect(result.body).toBeUndefined();
  });
});

describe('fetchEspnTeams', () => {
  it('builds the correct sport/league/teams URL', async () => {
    const fn = mockFetch(() => ({ status: 200, body: { sports: [] } }));
    await fetchEspnTeams('basketball', 'nba');
    expect(fn).toHaveBeenCalledWith(
      expect.stringContaining('/apis/site/v2/sports/basketball/nba/teams'),
      expect.anything(),
    );
  });
});

function makeEvent(state: 'pre' | 'in' | 'post', isoDate: string): EspnEvent {
  return {
    id: '1',
    date: isoDate,
    status: { type: { state } },
    competitions: [{ id: '1', competitors: [] }],
  };
}

describe('computeAdaptivePollIntervalMs', () => {
  const now = new Date('2026-01-15T12:00:00Z');

  it('polls every 60s when any event is live', () => {
    const events = [makeEvent('in', '2026-01-15T11:00:00Z')];
    expect(computeAdaptivePollIntervalMs(events, now)).toBe(60_000);
  });

  it('polls every 10min when an event starts within 6h', () => {
    const events = [makeEvent('pre', '2026-01-15T15:00:00Z')]; // 3h out
    expect(computeAdaptivePollIntervalMs(events, now)).toBe(10 * 60_000);
  });

  it('polls every 60min when nothing is live or within 6h', () => {
    const events = [makeEvent('pre', '2026-01-16T12:00:00Z')]; // 24h out
    expect(computeAdaptivePollIntervalMs(events, now)).toBe(60 * 60_000);
  });

  it('polls every 60min when there are no events at all', () => {
    expect(computeAdaptivePollIntervalMs([], now)).toBe(60 * 60_000);
  });

  it('ignores already-started-in-the-past pre-state events (stale data) for the 10min tier', () => {
    const events = [makeEvent('pre', '2026-01-15T09:00:00Z')]; // 3h in the past, still "pre" (stale)
    expect(computeAdaptivePollIntervalMs(events, now)).toBe(60 * 60_000);
  });

  it('prioritizes live over upcoming-soon when both are present', () => {
    const events = [makeEvent('pre', '2026-01-15T13:00:00Z'), makeEvent('in', '2026-01-15T10:00:00Z')];
    expect(computeAdaptivePollIntervalMs(events, now)).toBe(60_000);
  });
});
