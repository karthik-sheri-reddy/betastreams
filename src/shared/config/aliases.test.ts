import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { loadAliasesFromFile, loadAliasesFromString, buildAliasIndex } from './aliases';
import { normalizeChannelName } from '../resolve/normalize';

const REAL_ALIASES_PATH = path.join(__dirname, '..', '..', '..', 'data', 'aliases.yaml');

describe('loadAliasesFromFile', () => {
  it('parses the real data/aliases.yaml without error', () => {
    const file = loadAliasesFromFile(REAL_ALIASES_PATH);
    expect(file.version).toBe(1);
    expect(file.aliases.length).toBeGreaterThan(0);
  });

  it('every alias group has at least one name', () => {
    const file = loadAliasesFromFile(REAL_ALIASES_PATH);
    for (const group of file.aliases) {
      expect(group.names.length).toBeGreaterThan(0);
    }
  });
});

describe('buildAliasIndex', () => {
  it('normalizes every alias name and maps it to its canonical label', () => {
    const file = loadAliasesFromString(`
version: 1
aliases:
  - canonical: FanDuel Sports Network Detroit
    names:
      - Fox Sports Detroit
      - Bally Sports Detroit
      - FanDuel Sports Network Detroit
`);
    const index = buildAliasIndex(file);
    expect(index.get('fox sports detroit')).toBe('FanDuel Sports Network Detroit');
    expect(index.get('bally sports detroit')).toBe('FanDuel Sports Network Detroit');
    expect(index.get('fanduel sports network detroit')).toBe('FanDuel Sports Network Detroit');
  });

  it('resolves the full historical RSN rebrand chain from the real file', () => {
    const file = loadAliasesFromFile(REAL_ALIASES_PATH);
    const index = buildAliasIndex(file);
    expect(index.get('fox sports detroit')).toBe('FanDuel Sports Network Detroit');
    expect(index.get('bally sports detroit')).toBe('FanDuel Sports Network Detroit');
    expect(index.get('fanduel sports network detroit')).toBe('FanDuel Sports Network Detroit');
  });

  it('matches names that differ only by quality tags/case/whitespace, via the shared normalizer', () => {
    const file = loadAliasesFromString(`
version: 1
aliases:
  - canonical: ESPN
    names:
      - ESPN
`);
    const index = buildAliasIndex(file);
    const key = normalizeChannelName('US: espn   HD').normalized;
    expect(index.get(key)).toBe('ESPN');
  });
});
