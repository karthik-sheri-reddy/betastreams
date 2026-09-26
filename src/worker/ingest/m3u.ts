import crypto from 'node:crypto';
import type { ChannelRecord } from '../../shared/types/source';

const EXTINF_ATTR_RE = /([a-zA-Z0-9_-]+)="([^"]*)"/g;

function parseAttributes(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  let match: RegExpExecArray | null;
  EXTINF_ATTR_RE.lastIndex = 0;
  while ((match = EXTINF_ATTR_RE.exec(attrString)) !== null) {
    const key = match[1];
    const value = match[2];
    if (key !== undefined && value !== undefined) attrs[key] = value;
  }
  return attrs;
}

function extractExt(url: string): string {
  const clean = url.split('?')[0] ?? url;
  const match = /\.([a-zA-Z0-9]+)$/.exec(clean);
  return match?.[1]?.toLowerCase() ?? 'ts';
}

function streamKeyFor(url: string): string {
  return crypto.createHash('sha1').update(url).digest('hex').slice(0, 16);
}

/**
 * Parses a full M3U playlist string into normalized channel records. Not
 * a streaming parser — M3U playlists are line-oriented text, small enough
 * to hold in memory even at tens of thousands of entries (unlike XMLTV
 * guides, which can be much larger and are streamed — see xmltv.ts).
 */
export function parseM3U(content: string, sourceId: string): ChannelRecord[] {
  const lines = content.split(/\r?\n/);
  const records: ChannelRecord[] = [];

  let pendingAttrs: Record<string, string> | undefined;
  let pendingName: string | undefined;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('#EXTINF:')) {
      const rest = line.slice('#EXTINF:'.length);
      const commaIndex = rest.indexOf(',');
      const attrPart = commaIndex >= 0 ? rest.slice(0, commaIndex) : rest;
      const namePart = commaIndex >= 0 ? rest.slice(commaIndex + 1) : '';
      pendingAttrs = parseAttributes(attrPart);
      pendingName = namePart.trim();
      continue;
    }

    if (line.startsWith('#')) {
      // #EXTGRP, #EXTVLCOPT, #EXTM3U, etc. — not needed for Phase 2.
      continue;
    }

    // A non-comment, non-empty line after an #EXTINF is the stream URL.
    if (pendingName !== undefined) {
      const url = line;
      const attrs = pendingAttrs ?? {};
      records.push({
        sourceId,
        streamKey: streamKeyFor(url),
        name: pendingName || attrs['tvg-name'] || 'Unknown',
        tvgId: attrs['tvg-id'] || undefined,
        logo: attrs['tvg-logo'] || undefined,
        group: attrs['group-title'] || undefined,
        urlTemplate: url,
        containerExt: extractExt(url),
      });
      pendingAttrs = undefined;
      pendingName = undefined;
    }
  }

  return records;
}
