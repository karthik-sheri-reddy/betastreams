import { describe, it, expect } from 'vitest';
import { verifyEspnPaths, applyVerificationReport } from './pathVerification';
import { loadCategoriesFromString } from '../../shared/config/categories';

const SAMPLE_YAML = `
version: 1
categories:
  - id: american_football
    name: American Football
    order: 3
    leagues:
      - espnPath: football/nfl
        displayName: NFL
        priority: 1
      - espnPath: football/made-up-league
        displayName: Made Up League
        priority: 2
  - id: golf
    name: Golf
    order: 11
    leagues:
      - espnPath: golf/pga
        displayName: PGA Tour
        priority: 1
`;

function fetchImplFor(okPaths: string[]) {
  return async (input: string | URL | Request) => {
    const url = input.toString();
    const isOk = okPaths.some((p) => url.includes(p));
    return {
      ok: isOk,
      status: isOk ? 200 : 404,
      json: async () => (isOk ? { events: [{ id: '1' }] } : undefined),
      headers: { get: () => undefined },
    } as unknown as Response;
  };
}

describe('verifyEspnPaths', () => {
  it('marks reachable paths ok and unreachable ones failed', async () => {
    const file = loadCategoriesFromString(SAMPLE_YAML);
    const report = await verifyEspnPaths(file, fetchImplFor(['football/nfl', 'golf/pga']));

    expect(report.okCount).toBe(2);
    expect(report.failedCount).toBe(1);

    const nfl = report.entries.find((e) => e.espnPath === 'football/nfl');
    expect(nfl).toMatchObject({ ok: true, status: 200, eventCount: 1 });

    const madeUp = report.entries.find((e) => e.espnPath === 'football/made-up-league');
    expect(madeUp).toMatchObject({ ok: false, status: 404 });
  });

  it('records a network error as a failed entry rather than throwing', async () => {
    const file = loadCategoriesFromString(SAMPLE_YAML);
    const failingFetch = async () => {
      throw new Error('Host not in allowlist: site.api.espn.com');
    };
    const report = await verifyEspnPaths(file, failingFetch);
    expect(report.failedCount).toBe(3);
    expect(report.entries.every((e) => e.error?.includes('allowlist'))).toBe(true);
  });
});

describe('applyVerificationReport', () => {
  it('disables only the leagues whose path failed, leaving others untouched', async () => {
    const file = loadCategoriesFromString(SAMPLE_YAML);
    const report = await verifyEspnPaths(file, fetchImplFor(['football/nfl', 'golf/pga']));
    const updated = applyVerificationReport(file, report);

    const nfl = updated.categories[0]?.leagues.find((l) => l.espnPath === 'football/nfl');
    expect(nfl?.disabled).toBe(false);

    const madeUp = updated.categories[0]?.leagues.find((l) => l.espnPath === 'football/made-up-league');
    expect(madeUp?.disabled).toBe(true);
    expect(madeUp?.disabledReason).toContain('404');

    const pga = updated.categories[1]?.leagues.find((l) => l.espnPath === 'golf/pga');
    expect(pga?.disabled).toBe(false);
  });
});
