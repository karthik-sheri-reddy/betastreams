import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseM3U } from './m3u';

const fixture = fs.readFileSync(
  path.join(__dirname, '__fixtures__', 'm3u', 'sample.m3u'),
  'utf-8',
);

describe('parseM3U', () => {
  it('parses every EXTINF/URL pair in the fixture', () => {
    const records = parseM3U(fixture, 'src1');
    expect(records).toHaveLength(5);
  });

  it('extracts tvg-id, logo, group, and name', () => {
    const [espn] = parseM3U(fixture, 'src1');
    expect(espn).toMatchObject({
      sourceId: 'src1',
      tvgId: 'ESPN.us',
      logo: 'http://logos.example/espn.png',
      group: 'USA| SPORTS',
      name: 'ESPN HD',
      containerExt: 'm3u8',
    });
  });

  it('falls back to tvg-name when the display name after the comma is empty', () => {
    // Not present in the current fixture directly, but verify via a minimal inline case.
    const content = [
      '#EXTM3U',
      '#EXTINF:-1 tvg-id="X" tvg-name="Fallback Name" tvg-logo="" group-title="G",',
      'http://example.com/1.ts',
    ].join('\n');
    const [rec] = parseM3U(content, 'src1');
    expect(rec?.name).toBe('Fallback Name');
  });

  it('handles channels with empty tvg-id (falls back to undefined)', () => {
    const records = parseM3U(fixture, 'src1');
    const ppv = records.find((r) => r.name.includes('UFC'));
    expect(ppv?.tvgId).toBeUndefined();
  });

  it('produces a stable streamKey per URL', () => {
    const a = parseM3U(fixture, 'src1');
    const b = parseM3U(fixture, 'src1');
    expect(a[0]?.streamKey).toBe(b[0]?.streamKey);
    expect(a[0]?.streamKey).not.toBe(a[1]?.streamKey);
  });

  it('detects the container extension from the URL', () => {
    const records = parseM3U(fixture, 'src1');
    const ts = records.find((r) => r.urlTemplate.endsWith('.ts'));
    expect(ts?.containerExt).toBe('ts');
  });

  it('ignores blank lines and unrelated comment tags', () => {
    const content = [
      '#EXTM3U',
      '#EXTGRP:Sports',
      '',
      '#EXTINF:-1 tvg-id="A" tvg-name="A" tvg-logo="" group-title="G",Channel A',
      '#EXTVLCOPT:network-caching=1000',
      'http://example.com/a.ts',
      '',
    ].join('\n');
    const records = parseM3U(content, 'src1');
    expect(records).toHaveLength(1);
    expect(records[0]?.name).toBe('Channel A');
  });
});
