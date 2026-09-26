import { describe, it, expect } from 'vitest';
import { normalizeChannelName } from './normalize';
import messyNames from './__fixtures__/messyNames.json';

// Each fixture name has one verified-correct expected result — see
// __fixtures__/messyNames.json for the raw inputs (60 messy real-world
// style variants, well over the §15 acceptance bar of 50).
const EXPECTED: Record<string, { normalized: string; feedHint?: string }> = {
  'US: ESPN': { normalized: 'espn' },
  'USA| ESPN2': { normalized: 'espn2' },
  '[US] NBC': { normalized: 'nbc' },
  'UK: Sky Sports Main Event': { normalized: 'sky sports main event' },
  'USA | FOX Sports 1': { normalized: 'fox sports 1' },
  'ESPN HD': { normalized: 'espn' },
  'ESPN2 FHD': { normalized: 'espn2' },
  'TNT UHD': { normalized: 'tnt' },
  'Fox Sports 4K': { normalized: 'fox sports' },
  'beIN Sports RAW': { normalized: 'bein sports' },
  'NBC SD': { normalized: 'nbc' },
  'ESPN HD2': { normalized: 'espn' },
  'ESPN Backup': { normalized: 'espn' },
  'NBC Backup 2': { normalized: 'nbc' },
  'CBS BACKUP': { normalized: 'cbs' },
  '📺 ESPN 🔥': { normalized: 'espn' },
  '⚽ Fox Soccer Plus': { normalized: 'fox soccer plus' },
  '🏈 NFL Network 🏈': { normalized: 'nfl network' },
  'ESPN.': { normalized: 'espn' },
  'ESPN!!': { normalized: 'espn' },
  'ESPN--News': { normalized: 'espn news' },
  ESPN_2: { normalized: 'espn 2' },
  'ESPN   News': { normalized: 'espn news' },
  'NBC    Sports    Network': { normalized: 'nbc sports network' },
  'Fútbol Canal': { normalized: 'futbol canal' },
  'ESPN Deportes': { normalized: 'espn deportes' },
  'Canal+ Sport': { normalized: 'canal sport' },
  'beIN SPORTS ESPAÑOL': { normalized: 'bein sports espanol' },
  'TSN Español': { normalized: 'tsn espanol' },
  'FOX Sports Detroit (East)': { normalized: 'fox sports detroit', feedHint: 'east' },
  'USA Network - West': { normalized: 'usa network', feedHint: 'west' },
  'TNT East': { normalized: 'tnt', feedHint: 'east' },
  'NBC Sports Boston (West)': { normalized: 'nbc sports boston', feedHint: 'west' },
  'MSG (East)': { normalized: 'msg', feedHint: 'east' },
  eSpN: { normalized: 'espn' },
  'Fox SPORTS 1': { normalized: 'fox sports 1' },
  'nbc sports': { normalized: 'nbc sports' },
  'USA| ESPN2 FHD (East) Backup': { normalized: 'espn2', feedHint: 'east' },
  'US: NBC HD Backup 2': { normalized: 'nbc' },
  '[USA] TNT UHD (West)': { normalized: 'tnt', feedHint: 'west' },
  'ESPN+': { normalized: 'espn' },
  'FOX Sports 2 HD': { normalized: 'fox sports 2' },
  'Golf Channel HD': { normalized: 'golf channel' },
  'NBA TV UHD': { normalized: 'nba tv' },
  'MLB Network HD': { normalized: 'mlb network' },
  'NHL Network HD': { normalized: 'nhl network' },
  'Big Ten Network (East) HD': { normalized: 'big ten network', feedHint: 'east' },
  'SEC Network HD Backup': { normalized: 'sec network' },
  'ACC Network West HD': { normalized: 'acc network', feedHint: 'west' },
  'CBS Sports Network 4K': { normalized: 'cbs sports network' },
  'Willow Cricket HD': { normalized: 'willow cricket' },
  'beIN Sports en Español HD': { normalized: 'bein sports en espanol' },
  'Univision Deportes Network': { normalized: 'univision deportes network' },
  'TUDN HD': { normalized: 'tudn' },
  'NFL RedZone HD': { normalized: 'nfl redzone' },
  'Pac-12 Network HD': { normalized: 'pac 12 network' },
  'YES Network (East) HD': { normalized: 'yes network', feedHint: 'east' },
  'Bally Sports Detroit HD': { normalized: 'bally sports detroit' },
  'FanDuel Sports Network Ohio HD': { normalized: 'fanduel sports network ohio' },
  'US - ESPNU HD': { normalized: 'espnu' },
  'CA: TSN1 HD': { normalized: 'tsn1' },
};

describe('normalizeChannelName', () => {
  it('has a fixture of at least 50 messy real-world name variants', () => {
    expect(messyNames.length).toBeGreaterThanOrEqual(50);
  });

  it('has an expectation for every fixture name', () => {
    for (const name of messyNames) {
      expect(EXPECTED, `missing expectation for ${JSON.stringify(name)}`).toHaveProperty(name);
    }
  });

  it.each(messyNames.map((name) => [name, EXPECTED[name]] as const))(
    'normalizes %s correctly',
    (name, expected) => {
      expect(normalizeChannelName(name)).toEqual(expected);
    },
  );

  it('is stable: normalizing an already-normalized name is a no-op', () => {
    const once = normalizeChannelName('US: ESPN HD (East)');
    const twice = normalizeChannelName(once.normalized);
    expect(twice.normalized).toBe(once.normalized);
  });

  it('never strips a country-code-like substring that is not actually a delimited prefix', () => {
    // "ES" and "CA" are country codes, but only when followed by a real
    // delimiter — not just any following letters.
    expect(normalizeChannelName('ESPN').normalized).toBe('espn');
    expect(normalizeChannelName('Canal Plus').normalized).toBe('canal plus');
    expect(normalizeChannelName('CANADA Sports Network').normalized).toBe('canada sports network');
  });

  it('collapses repeated internal whitespace and trims', () => {
    expect(normalizeChannelName('  ESPN   News  ').normalized).toBe('espn news');
  });
});
