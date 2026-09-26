import { describe, it, expect } from 'vitest';
import { buildIptvOrgIndex, resolveByChannelId, resolveByNormalizedName } from './iptvOrgIndex';
import type { IptvOrgData } from '../ingest/iptvOrg';

const data: IptvOrgData = {
  channels: [
    { id: 'ESPN.us', name: 'ESPN', alt_names: ['ESPN USA', 'ESPN HD'] },
    { id: 'ESPN2.us', name: 'ESPN2', alt_names: ['ESPN 2'] },
    { id: 'DefunctChannel.us', name: 'Defunct Channel', closed: true },
  ],
  feeds: [],
  logos: [],
  guides: [],
  fetchedAt: new Date().toISOString(),
};

describe('buildIptvOrgIndex', () => {
  it('indexes by channel id', () => {
    const index = buildIptvOrgIndex(data);
    expect(resolveByChannelId(index, 'ESPN.us')).toBe('ESPN.us');
    expect(resolveByChannelId(index, 'Unknown.us')).toBeUndefined();
  });

  it('indexes by normalized name and every alt_name', () => {
    const index = buildIptvOrgIndex(data);
    expect(resolveByNormalizedName(index, 'espn')).toBe('ESPN.us');
    expect(resolveByNormalizedName(index, 'espn usa')).toBe('ESPN.us');
    expect(resolveByNormalizedName(index, 'espn 2')).toBe('ESPN2.us');
  });

  it('excludes closed channels entirely', () => {
    const index = buildIptvOrgIndex(data);
    expect(resolveByChannelId(index, 'DefunctChannel.us')).toBeUndefined();
    expect(resolveByNormalizedName(index, 'defunct channel')).toBeUndefined();
  });

  it('normalizes messy input the same way before lookup, so a quality-tagged name still resolves', () => {
    const index = buildIptvOrgIndex(data);
    const key = 'espn'; // what normalizeChannelName('US: ESPN HD') produces
    expect(resolveByNormalizedName(index, key)).toBe('ESPN.us');
  });
});
