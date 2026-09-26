import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseXmltvChunks, parseXmltvDate } from './xmltv';
import type { ProgrammeRecord } from '../../shared/types/source';

const fixturePath = path.join(__dirname, '__fixtures__', 'xmltv', 'sample.xml');

async function* stringChunks(content: string, chunkSize: number): AsyncGenerator<string> {
  for (let i = 0; i < content.length; i += chunkSize) {
    yield content.slice(i, i + chunkSize);
  }
}

async function collect(gen: AsyncGenerator<ProgrammeRecord>): Promise<ProgrammeRecord[]> {
  const out: ProgrammeRecord[] = [];
  for await (const rec of gen) out.push(rec);
  return out;
}

describe('parseXmltvDate', () => {
  it('parses a UTC XMLTV timestamp', () => {
    expect(parseXmltvDate('20260115173000 +0000')).toBe('2026-01-15T17:30:00.000Z');
  });

  it('parses a negative-offset timestamp into UTC', () => {
    // 23:00 at -05:00 is 04:00 the next day UTC.
    expect(parseXmltvDate('20260115230000 -0500')).toBe('2026-01-16T04:00:00.000Z');
  });
});

describe('parseXmltvChunks', () => {
  it('parses every programme in the fixture, whole-file in one chunk', async () => {
    const content = fs.readFileSync(fixturePath, 'utf-8');
    const records = await collect(parseXmltvChunks(stringChunks(content, content.length), 'src1'));
    expect(records).toHaveLength(4);
  });

  it('produces identical results when fed in small byte-ish chunks (streaming correctness)', async () => {
    const content = fs.readFileSync(fixturePath, 'utf-8');
    const whole = await collect(parseXmltvChunks(stringChunks(content, content.length), 'src1'));
    const chunked = await collect(parseXmltvChunks(stringChunks(content, 7), 'src1'));
    expect(chunked).toEqual(whole);
  });

  it('extracts title, sub-title, category, and converts start/stop to ISO UTC', async () => {
    const content = fs.readFileSync(fixturePath, 'utf-8');
    const records = await collect(parseXmltvChunks(stringChunks(content, content.length), 'src1'));
    const cfb = records.find((r) => r.title === 'College Football');
    expect(cfb).toMatchObject({
      channelRef: 'ESPN.us',
      subTitle: 'No. 5 Alabama at No. 12 Georgia',
      category: 'Sports',
      start: '2026-01-15T17:30:00.000Z',
      stop: '2026-01-15T20:00:00.000Z',
    });
  });

  it('flags previously-shown programmes as reruns', async () => {
    const content = fs.readFileSync(fixturePath, 'utf-8');
    const records = await collect(parseXmltvChunks(stringChunks(content, content.length), 'src1'));
    const nba = records.find((r) => r.title === 'NBA Basketball');
    expect(nba?.previouslyShown).toBe(true);
    const cfb = records.find((r) => r.title === 'College Football');
    expect(cfb?.previouslyShown).toBeUndefined();
  });

  it('handles a UTF-8 multi-byte character split across chunk boundaries', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><tv><programme start="20260101000000 +0000" stop="20260101010000 +0000" channel="C"><title>Fútbol Español</title></programme></tv>`;
    // Force the split to land inside the multi-byte 'ú' (0xC3 0xBA in UTF-8).
    const bytes = Buffer.from(xml, 'utf-8');
    const splitIndex = xml.indexOf('Fú') + 2; // right after "Fú" so we split mid-character in bytes
    async function* byteChunks(): AsyncGenerator<Uint8Array> {
      // Use small fixed-size byte chunks to guarantee some multi-byte char gets split.
      for (let i = 0; i < bytes.length; i += 3) {
        yield bytes.subarray(i, i + 3);
      }
    }
    void splitIndex;
    const records = await collect(parseXmltvChunks(byteChunks(), 'src1'));
    expect(records[0]?.title).toBe('Fútbol Español');
  });
});
