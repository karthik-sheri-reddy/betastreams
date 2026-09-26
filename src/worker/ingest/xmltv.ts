import { Readable } from 'node:stream';
import { SaxesParser } from 'saxes';
import type { ProgrammeRecord } from '../../shared/types/source';

interface PartialProgramme {
  channelRef: string;
  start: string;
  stop: string;
  title?: string;
  subTitle?: string;
  description?: string;
  category?: string;
  previouslyShown?: boolean;
}

type TextField = 'title' | 'sub-title' | 'desc' | 'category';
const TEXT_FIELDS = new Set<TextField>(['title', 'sub-title', 'desc', 'category']);

/** XMLTV timestamps look like "20260115120000 +0000". Returns an ISO 8601 UTC string. */
export function parseXmltvDate(raw: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?$/.exec(raw.trim());
  if (!m) {
    const fallback = new Date(raw);
    return Number.isNaN(fallback.getTime()) ? raw : fallback.toISOString();
  }
  const [, y, mo, d, h, mi, s, tz] = m;
  let offsetMinutes = 0;
  if (tz) {
    const sign = tz.startsWith('-') ? -1 : 1;
    offsetMinutes = sign * (Number(tz.slice(1, 3)) * 60 + Number(tz.slice(3, 5)));
  }
  const utcMillis =
    Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)) -
    offsetMinutes * 60_000;
  return new Date(utcMillis).toISOString();
}

/**
 * Stream-parses XMLTV, yielding one ProgrammeRecord per completed
 * <programme> element as soon as its closing tag is seen — the parser
 * never buffers the whole document, so this scales to guides far larger
 * than available memory (§1). Chunks may be raw bytes or already-decoded
 * strings; multi-byte UTF-8 characters split across chunk boundaries are
 * handled via a persistent streaming TextDecoder.
 */
export async function* parseXmltvChunks(
  chunks: AsyncIterable<Uint8Array | string>,
  sourceId: string,
): AsyncGenerator<ProgrammeRecord> {
  const parser = new SaxesParser();
  const decoder = new TextDecoder('utf-8');
  const queue: ProgrammeRecord[] = [];
  let parseError: Error | undefined;

  let current: PartialProgramme | undefined;
  let textBuffer = '';
  let currentField: TextField | undefined;

  parser.on('opentag', (tag) => {
    if (tag.name === 'programme') {
      const start = tag.attributes.start;
      const stop = tag.attributes.stop;
      const channel = tag.attributes.channel;
      current =
        typeof start === 'string' && typeof stop === 'string' && typeof channel === 'string'
          ? { channelRef: channel, start: parseXmltvDate(start), stop: parseXmltvDate(stop) }
          : undefined;
      return;
    }
    if (current && TEXT_FIELDS.has(tag.name as TextField)) {
      currentField = tag.name as TextField;
      textBuffer = '';
      return;
    }
    if (current && tag.name === 'previously-shown') {
      current.previouslyShown = true;
    }
  });

  parser.on('text', (text) => {
    if (currentField) textBuffer += text;
  });

  parser.on('closetag', (tag) => {
    if (current && currentField && tag.name === currentField) {
      const value = textBuffer.trim();
      if (tag.name === 'title') current.title = value;
      else if (tag.name === 'sub-title') current.subTitle = value;
      else if (tag.name === 'desc') current.description = value;
      else if (tag.name === 'category' && !current.category) current.category = value;
      currentField = undefined;
      textBuffer = '';
      return;
    }
    if (tag.name === 'programme') {
      if (current?.title) {
        queue.push({
          sourceId,
          channelRef: current.channelRef,
          title: current.title,
          subTitle: current.subTitle,
          description: current.description,
          start: current.start,
          stop: current.stop,
          category: current.category,
          previouslyShown: current.previouslyShown,
        });
      }
      current = undefined;
    }
  });

  parser.on('error', (err) => {
    parseError = err;
  });

  for await (const chunk of chunks) {
    const str = typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    parser.write(str);
    if (parseError) throw parseError;
    while (queue.length > 0) yield queue.shift() as ProgrammeRecord;
  }
  parser.write(decoder.decode());
  parser.close();
  if (parseError) throw parseError;
  while (queue.length > 0) yield queue.shift() as ProgrammeRecord;
}

/**
 * Fetches and stream-parses an XMLTV guide by URL. Used by both the plain
 * XMLTV adapter and the Xtream adapter's xmltv.php guide.
 */
export async function* fetchXmltvProgrammes(
  url: string,
  sourceId: string,
  init?: RequestInit,
): AsyncGenerator<ProgrammeRecord> {
  const res = await fetch(url, init);
  if (!res.ok || !res.body) {
    throw new Error(`XMLTV fetch failed (${res.status}) for source ${sourceId}`);
  }
  const nodeStream = Readable.fromWeb(res.body as never);
  yield* parseXmltvChunks(nodeStream, sourceId);
}
