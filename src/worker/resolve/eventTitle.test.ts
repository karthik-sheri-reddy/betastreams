import { describe, it, expect } from 'vitest';
import { detectEventChannel } from './eventTitle';
import fixtures from './__fixtures__/eventChannelNames.json';

// Each fixture has a verified-correct expected isEventChannel result —
// 20 clear event-channel names plus 9 "looks like sports but isn't a
// one-off event" negatives, to make sure the detector doesn't just say
// yes to anything sports-shaped. Well over the §15 acceptance bar of 20.
const EXPECTED_IS_EVENT: Record<string, boolean> = {
  'ESPN+ 14: Alabama vs Georgia 7:30PM ET': true,
  'NFL 05 | KC @ BUF': true,
  'PPV 3 - UFC 320': true,
  'UFC 300: Prelims': true,
  'WWE 1: Raw': true,
  'Boxing 2: Fury vs Usyk': true,
  'MLB 12 | NYY @ BOS 7:05PM ET': true,
  'NBA 07: Lakers at Celtics 8PM ET': true,
  'NHL 02 | BOS vs TOR': true,
  'PPV 10': true,
  'ESPN+ 22: Duke vs UNC 9:00PM ET': true,
  'UFC 320 PPV': true,
  'Alabama vs Georgia': true,
  'KC @ BUF': true,
  'Lakers at Celtics': true,
  'NCAAF 03: Michigan vs Ohio State': true,
  'MMA 5: Bellator 300': true,
  'WWE 2: SummerSlam PPV': true,
  'Boxing 1 - Canelo vs Crawford': true,
  'NFL 12: DAL vs PHI 4:25PM ET': true,
  'ESPN2 HD': false,
  'FOX Sports Detroit (East)': false,
  'NBA TV': false,
  'NFL RedZone': false,
  'NFL Network': false,
  'Golf Channel': false,
  'CBS Sports Network': false,
  'UFC Fight Pass': false,
  'Comedy Central HD': false,
};

describe('detectEventChannel', () => {
  it('has a fixture of at least 20 event-channel names (plus negatives)', () => {
    const positives = fixtures.filter((f) => EXPECTED_IS_EVENT[f.name]);
    expect(positives.length).toBeGreaterThanOrEqual(20);
  });

  it.each(fixtures.map((f) => [f.name, f.group, EXPECTED_IS_EVENT[f.name]] as const))(
    'detects %s as event=%s',
    (name, group, expected) => {
      expect(detectEventChannel(name, group).isEventChannel).toBe(expected);
    },
  );

  it('extracts both teams from an @ matchup', () => {
    const r = detectEventChannel('NFL 05 | KC @ BUF', 'NFL GAME PASS');
    expect(r.parsed).toMatchObject({ leaguePrefix: 'NFL', channelNumber: '05', teamA: 'KC', teamB: 'BUF' });
  });

  it('extracts both teams from a "vs" matchup', () => {
    const r = detectEventChannel('Boxing 2: Fury vs Usyk');
    expect(r.parsed).toMatchObject({ teamA: 'Fury', teamB: 'Usyk' });
  });

  it('extracts an embedded time with meridiem and timezone, without polluting the team name', () => {
    const r = detectEventChannel('ESPN+ 14: Alabama vs Georgia 7:30PM ET');
    expect(r.parsed?.time).toEqual({ hour: 7, minute: 30, meridiem: 'PM', timezone: 'ET' });
    expect(r.parsed?.teamB).toBe('Georgia');
  });

  it('extracts a minute-less time ("8PM ET") without swallowing it into the team name', () => {
    const r = detectEventChannel('NBA 07: Lakers at Celtics 8PM ET');
    expect(r.parsed?.time).toEqual({ hour: 8, minute: 0, meridiem: 'PM', timezone: 'ET' });
    expect(r.parsed?.teamB).toBe('Celtics');
  });

  it('falls back to a bare eventName when there is a known prefix but no matchup', () => {
    const r = detectEventChannel('PPV 3 - UFC 320');
    expect(r.parsed).toMatchObject({ leaguePrefix: 'PPV', channelNumber: '3', eventName: 'UFC 320' });
  });

  it('flags a bare numbered PPV channel from the name alone, via the standalone "PPV" keyword', () => {
    const r = detectEventChannel('PPV 10', 'PPV EVENTS');
    expect(r.isEventChannel).toBe(true);
    expect(r.parsed?.eventName).toBe('PPV 10');
  });

  it('does not flag an ordinary named channel just because its group is sports-flavored', () => {
    const r = detectEventChannel('NFL RedZone', 'USA| SPORTS');
    expect(r.isEventChannel).toBe(false);
  });

  it('flags via the group/category fallback when the name alone does not parse as an event', () => {
    const r = detectEventChannel('Channel 42', 'PPV EVENTS');
    expect(r.isEventChannel).toBe(true);
    expect(r.parsed).toBeUndefined();
  });
});
