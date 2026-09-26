import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
  loadStationsFromFile,
  loadStationsFromString,
  buildStationIndex,
  buildStationByNetworkCityIndex,
} from './stations';

const REAL_STATIONS_PATH = path.join(__dirname, '..', '..', '..', 'data', 'stations.yaml');

describe('loadStationsFromFile', () => {
  it('parses the real data/stations.yaml without error', () => {
    const file = loadStationsFromFile(REAL_STATIONS_PATH);
    expect(file.version).toBe(1);
    expect(file.stations.length).toBeGreaterThan(0);
  });

  it('rejects a call sign that does not look like a US call sign', () => {
    expect(() =>
      loadStationsFromString(`
version: 1
stations:
  - callsign: NOTVALID123
    network: ABC
    city: Nowhere
`),
    ).toThrow();
  });
});

describe('buildStationIndex', () => {
  it('indexes by uppercased call sign', () => {
    const file = loadStationsFromFile(REAL_STATIONS_PATH);
    const index = buildStationIndex(file);
    expect(index.get('WABC')).toMatchObject({ network: 'ABC', city: 'New York' });
    expect(index.get('KABC')).toMatchObject({ network: 'ABC', city: 'Los Angeles' });
  });
});

describe('buildStationByNetworkCityIndex', () => {
  it('indexes by (network, lowercased city) for "FOX 2 Detroit"-style names', () => {
    const file = loadStationsFromFile(REAL_STATIONS_PATH);
    const index = buildStationByNetworkCityIndex(file);
    expect(index.get('FOX\u0000chicago')).toMatchObject({ callsign: 'WFLD' });
    expect(index.get('NBC\u0000los angeles')).toMatchObject({ callsign: 'KNBC' });
  });
});
