import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { loadCategoriesFromFile, loadCategoriesFromString, flattenLeagues } from './categories';

const REAL_CONFIG_PATH = path.join(__dirname, '..', '..', '..', 'config', 'categories.yaml');

describe('loadCategoriesFromFile', () => {
  it('parses the real config/categories.yaml without error', () => {
    const file = loadCategoriesFromFile(REAL_CONFIG_PATH);
    expect(file.version).toBe(1);
    expect(file.categories.length).toBeGreaterThan(0);
  });

  it('matches the 17 categories from §3, in order, with unique ids and orders', () => {
    const file = loadCategoriesFromFile(REAL_CONFIG_PATH);
    expect(file.categories).toHaveLength(17);

    const ids = file.categories.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);

    const orders = file.categories.map((c) => c.order);
    expect(new Set(orders).size).toBe(orders.length);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);

    expect(ids[0]).toBe('live');
    expect(ids[1]).toBe('today');
    expect(ids.at(-1)).toBe('other');
  });

  it('gives every league a positive priority and a non-empty ESPN path', () => {
    const file = loadCategoriesFromFile(REAL_CONFIG_PATH);
    for (const league of flattenLeagues(file)) {
      expect(league.espnPath).toMatch(/^[a-z0-9.-]+\/[a-z0-9.-]+$/);
      expect(league.priority).toBeGreaterThan(0);
    }
  });

  it('has no duplicate espnPath entries', () => {
    const file = loadCategoriesFromFile(REAL_CONFIG_PATH);
    const paths = flattenLeagues(file).map((l) => l.espnPath);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe('loadCategoriesFromString', () => {
  it('defaults leagues/epgKeywords/disabled and rejects malformed input', () => {
    const file = loadCategoriesFromString(`
version: 1
categories:
  - id: live
    name: Live Now
    order: 1
`);
    expect(file.categories[0]?.leagues).toEqual([]);
    expect(file.categories[0]?.epgKeywords).toEqual([]);

    expect(() =>
      loadCategoriesFromString(`
version: 2
categories: []
`),
    ).toThrow();
  });
});
