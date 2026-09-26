import { describe, it, expect } from 'vitest';
import { ChannelResolver, type CascadeContext } from './cascade';
import { buildIptvOrgIndex } from './iptvOrgIndex';
import { buildAliasIndex, loadAliasesFromString } from '../../shared/config/aliases';
import { buildStationIndex, buildStationByNetworkCityIndex, loadStationsFromString } from '../../shared/config/stations';
import type { IptvOrgData } from '../ingest/iptvOrg';

const iptvOrgData: IptvOrgData = {
  channels: [
    { id: 'ESPN.us', name: 'ESPN', alt_names: ['ESPN USA'] },
    { id: 'ESPN2.us', name: 'ESPN2', alt_names: ['ESPN 2'] },
    { id: 'FoxSportsOhio.us', name: 'Fox Sports Ohio' },
  ],
  feeds: [],
  logos: [],
  guides: [],
  fetchedAt: new Date().toISOString(),
};

const aliasesFile = loadAliasesFromString(`
version: 1
aliases:
  - canonical: FanDuel Sports Network Detroit
    names:
      - Fox Sports Detroit
      - Bally Sports Detroit
      - FanDuel Sports Network Detroit
`);

const stationsFile = loadStationsFromString(`
version: 1
stations:
  - callsign: WABC
    network: ABC
    city: New York
  - callsign: WNYW
    network: FOX
    city: New York
`);

function buildContext(overrides: Partial<CascadeContext> = {}): CascadeContext {
  return {
    iptvOrgIndex: buildIptvOrgIndex(iptvOrgData),
    aliasIndex: buildAliasIndex(aliasesFile),
    stationByCallsign: buildStationIndex(stationsFile),
    stationByNetworkCity: buildStationByNetworkCityIndex(stationsFile),
    fuzzyCandidates: [
      { normalized: 'espn deportes', canonicalChannelId: 'ESPNDeportes.us' },
      { normalized: 'nba tv', canonicalChannelId: 'NBATV.us' },
    ],
    ...overrides,
  };
}

describe('ChannelResolver — event channels skip normal resolution', () => {
  it('never runs the cascade for a detected event channel', () => {
    const resolver = new ChannelResolver(buildContext({ fuzzyCandidates: [] }));
    const result = resolver.resolve({ sourceId: 's1', streamKey: 'k1', name: 'NFL 05 | KC @ BUF' });
    expect(result).toMatchObject({
      isEventChannel: true,
      resolutionMethod: 'event_channel',
      resolutionConfidence: 1,
    });
    expect(result.canonicalChannelId).toBeUndefined();
    expect(result.eventParsed).toMatchObject({ teamA: 'KC', teamB: 'BUF' });
  });
});

describe('ChannelResolver — cascade step 1: tvg-id', () => {
  it('resolves via tvg-id when it matches a known iptv-org channel', () => {
    const resolver = new ChannelResolver(buildContext());
    const result = resolver.resolve({ sourceId: 's1', streamKey: 'k1', name: 'Some Weird Name', tvgId: 'ESPN.us' });
    expect(result).toMatchObject({ canonicalChannelId: 'ESPN.us', resolutionMethod: 'tvg_id', resolutionConfidence: 0.99 });
  });

  it('falls through to later steps when tvg-id does not match anything known', () => {
    const resolver = new ChannelResolver(buildContext());
    const result = resolver.resolve({ sourceId: 's1', streamKey: 'k1', name: 'ESPN2', tvgId: 'NotReal.us' });
    expect(result.canonicalChannelId).toBe('ESPN2.us');
    expect(result.resolutionMethod).toBe('alias');
  });
});

describe('ChannelResolver — cascade step 2: alias', () => {
  it('resolves via iptv-org normalized name/alt_name', () => {
    const resolver = new ChannelResolver(buildContext());
    const result = resolver.resolve({ sourceId: 's1', streamKey: 'k1', name: 'US: ESPN USA HD' });
    expect(result).toMatchObject({ canonicalChannelId: 'ESPN.us', resolutionMethod: 'alias' });
  });

  it('resolves the historical RSN rebrand chain via data/aliases.yaml', () => {
    const resolver = new ChannelResolver(buildContext());
    for (const name of ['Fox Sports Detroit', 'Bally Sports Detroit', 'FanDuel Sports Network Detroit HD']) {
      const result = resolver.resolve({ sourceId: 's1', streamKey: name, name });
      expect(result.canonicalChannelId).toBe('FanDuel Sports Network Detroit');
      expect(result.resolutionMethod).toBe('alias');
    }
  });
});

describe('ChannelResolver — cascade step 3: call sign', () => {
  it('resolves via an embedded call sign', () => {
    const resolver = new ChannelResolver(buildContext());
    const result = resolver.resolve({ sourceId: 's1', streamKey: 'k1', name: 'WABC New York HD' });
    expect(result).toMatchObject({ canonicalChannelId: 'station:WABC', resolutionMethod: 'callsign' });
  });

  it('resolves via the network+city fallback pattern', () => {
    const resolver = new ChannelResolver(buildContext());
    const result = resolver.resolve({ sourceId: 's1', streamKey: 'k1', name: 'FOX 5 New York' });
    expect(result).toMatchObject({ canonicalChannelId: 'station:WNYW', resolutionMethod: 'network_city' });
  });
});

describe('ChannelResolver — cascade step 4: blocked fuzzy match', () => {
  it('resolves a close typo within the same network family', () => {
    const resolver = new ChannelResolver(buildContext());
    const result = resolver.resolve({ sourceId: 's1', streamKey: 'k1', name: 'ESPN Deprotes' }); // transposed letters
    expect(result.canonicalChannelId).toBe('ESPNDeportes.us');
    expect(result.resolutionMethod).toBe('fuzzy');
    expect(result.resolutionConfidence).toBeGreaterThanOrEqual(0.85);
  });

  it('never fuzzy-matches across network families, however similar the strings look', () => {
    // A candidate that is an ESPN-family channel should never fuzzy-win
    // against a non-ESPN query even at high string similarity, because
    // blocking excludes it from the pool entirely.
    const ctx = buildContext({
      fuzzyCandidates: [{ normalized: 'espn deportes', canonicalChannelId: 'ESPNDeportes.us' }],
    });
    const resolver = new ChannelResolver(ctx);
    // "fox deportes" is not ESPN-family (blocked to FOX_SPORTS/FOX), so
    // it must never match the ESPN-family candidate even though the
    // strings share "deportes".
    const result = resolver.resolve({ sourceId: 's1', streamKey: 'k1', name: 'Fox Deportes' });
    expect(result.canonicalChannelId).not.toBe('ESPNDeportes.us');
  });

  it('leaves a below-threshold fuzzy candidate unresolved rather than guessing', () => {
    const ctx = buildContext({ fuzzyCandidates: [{ normalized: 'nba tv', canonicalChannelId: 'NBATV.us' }] });
    const resolver = new ChannelResolver(ctx);
    const result = resolver.resolve({ sourceId: 's1', streamKey: 'k1', name: 'MLB TV' }); // different league entirely
    expect(result.canonicalChannelId).toBeUndefined();
    expect(result.resolutionMethod).toBe('unresolved');
    expect(result.resolutionConfidence).toBe(0);
  });
});

describe('ChannelResolver — memoization', () => {
  it('memoizes by normalized key: a second stream with the same name reuses the cached result without re-running the cascade', () => {
    const resolver = new ChannelResolver(buildContext());
    const first = resolver.resolve({ sourceId: 's1', streamKey: 'k1', name: 'ESPN Deprotes' });
    const second = resolver.resolve({ sourceId: 's2', streamKey: 'k2', name: 'ESPN Deprotes' });
    expect(second.canonicalChannelId).toBe(first.canonicalChannelId);
    expect(second.resolutionMethod).toBe(first.resolutionMethod);
    expect(resolver.getMemoSnapshot().size).toBe(1);
  });

  it('reuses a memo entry seeded from a previous run, never touching the cascade at all', () => {
    const seededMemo = new Map([
      ['espn deprotes', { canonicalChannelId: 'ESPNDeportes.us', resolutionMethod: 'fuzzy' as const, resolutionConfidence: 0.91 }],
    ]);
    // No fuzzy candidates at all — if the cascade ran, it could not possibly resolve this.
    const resolver = new ChannelResolver(buildContext({ fuzzyCandidates: [] }), seededMemo);
    const result = resolver.resolve({ sourceId: 's1', streamKey: 'k1', name: 'ESPN Deprotes' });
    expect(result).toMatchObject({ canonicalChannelId: 'ESPNDeportes.us', resolutionMethod: 'fuzzy', resolutionConfidence: 0.91 });
  });

  it('does not memoize event channels under a shared key with regular channels of the same normalized name', () => {
    const resolver = new ChannelResolver(buildContext());
    const eventResult = resolver.resolve({ sourceId: 's1', streamKey: 'k1', name: 'PPV 3 - UFC 320' });
    expect(eventResult.isEventChannel).toBe(true);
    expect(resolver.getMemoSnapshot().size).toBe(0);
  });
});
