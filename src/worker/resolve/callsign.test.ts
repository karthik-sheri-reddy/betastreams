import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { extractCallSignCandidates, extractNetworkCityPattern, resolveStation } from './callsign';
import { loadStationsFromFile, buildStationIndex, buildStationByNetworkCityIndex } from '../../shared/config/stations';

const REAL_STATIONS_PATH = path.join(__dirname, '..', '..', '..', 'data', 'stations.yaml');
const stationsFile = loadStationsFromFile(REAL_STATIONS_PATH);
const byCallsign = buildStationIndex(stationsFile);
const byNetworkCity = buildStationByNetworkCityIndex(stationsFile);

describe('extractCallSignCandidates', () => {
  it('extracts a bare call sign', () => {
    expect(extractCallSignCandidates('WABC New York')).toContain('WABC');
  });

  it('extracts a call sign embedded with other tokens', () => {
    expect(extractCallSignCandidates('ABC 7 WABC-TV HD')).toContain('WABC');
  });

  it('does not extract lowercase or mixed-case runs', () => {
    expect(extractCallSignCandidates('Wabc New York')).toEqual([]);
  });

  it('does not extract short all-caps words that are not call-sign shaped', () => {
    // "HD" is 2 letters, not [KW]+2-3 letters; "USA" doesn't start with K/W.
    expect(extractCallSignCandidates('ESPN USA HD')).toEqual([]);
  });

  it('deduplicates repeated candidates', () => {
    expect(extractCallSignCandidates('WABC WABC')).toEqual(['WABC']);
  });
});

describe('extractNetworkCityPattern', () => {
  it('extracts network + city with a channel number', () => {
    expect(extractNetworkCityPattern('FOX 2 Detroit')).toEqual({ network: 'FOX', city: 'Detroit' });
  });

  it('extracts network + city without a channel number', () => {
    expect(extractNetworkCityPattern('NBC Los Angeles')).toEqual({ network: 'NBC', city: 'Los Angeles' });
  });

  it('returns undefined when there is no network keyword', () => {
    expect(extractNetworkCityPattern('ESPN Deportes')).toBeUndefined();
  });
});

describe('resolveStation', () => {
  it('resolves a known call sign to its station', () => {
    const r = resolveStation('WABC New York HD', byCallsign, byNetworkCity);
    expect(r).toMatchObject({ method: 'callsign', station: { callsign: 'WABC', network: 'ABC', city: 'New York' } });
  });

  it('resolves every one of the twelve fixture stations by call sign', () => {
    for (const callsign of ['WABC', 'WCBS', 'WNBC', 'WNYW', 'KABC', 'KCBS', 'KNBC', 'KTTV', 'WLS', 'WBBM', 'WMAQ', 'WFLD']) {
      const r = resolveStation(`${callsign} HD`, byCallsign, byNetworkCity);
      expect(r?.station.callsign).toBe(callsign);
    }
  });

  it('returns undefined for a network+city pattern outside the three fixture markets', () => {
    // Detroit is not one of our three fixture markets (NY/LA/Chicago).
    const r = resolveStation('FOX 2 Detroit', byCallsign, byNetworkCity);
    expect(r).toBeUndefined();
  });

  it('resolves a real network+city pattern from the fixture markets', () => {
    const r = resolveStation('NBC 4 Los Angeles', byCallsign, byNetworkCity);
    expect(r).toMatchObject({ method: 'network_city', station: { callsign: 'KNBC' } });
  });

  it('never returns a match for an extracted candidate that is not in the station table', () => {
    // "WXYZ" is call-sign-shaped but not one of our fixture stations.
    const r = resolveStation('WXYZ Nowhere', byCallsign, byNetworkCity);
    expect(r).toBeUndefined();
  });

  it('returns undefined for a name with neither a known call sign nor a known network+city pattern', () => {
    expect(resolveStation('ESPN Deportes', byCallsign, byNetworkCity)).toBeUndefined();
  });
});
