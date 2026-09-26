/**
 * Minimal shared event-title parser (§4.2 / §6.3). Stage A uses this to
 * detect channels whose name/group-title is itself a one-off event (e.g.
 * "PPV 3 - UFC 320") rather than a regular channel — these skip normal
 * channel resolution and go straight to event matching. Phase 5's full
 * title parser (also used for EPG programme titles) extends this same
 * shape rather than inventing a second one; keep additions here backward
 * compatible with that reuse.
 *
 * Deliberately covers only what §4.2's examples need: a
 * "LEAGUE NN <sep>" prefix, a basic matchup ("A vs B" / "A @ B" / "A at
 * B"), and an embedded clock time with an optional US timezone
 * abbreviation. Ranking prefixes ("No. 5"), neutral-site suffixes, and
 * alternate-broadcast markers (§6.3) are Phase 5's job.
 */

export interface ParsedEventTime {
  hour: number;
  minute: number;
  meridiem?: 'AM' | 'PM';
  timezone?: string;
}

export interface ParsedEventTitle {
  leaguePrefix?: string;
  channelNumber?: string;
  teamA?: string;
  teamB?: string;
  time?: ParsedEventTime;
  /** Free-text remainder when a known event prefix was found but no matchup (e.g. "UFC 320"). */
  eventName?: string;
}

// A separator is required after the prefix so ordinary named channels
// ("NFL Network", "NBA TV", "NFL RedZone") never match — only numbered
// per-event feeds ("NFL 05 |", "PPV 3 -", "ESPN+ 14:") do.
const PREFIX_RE = /^\s*([A-Za-z][A-Za-z0-9+]{1,10})\s*(\d{1,3})?\s*[:|-]\s*/;

const MATCHUP_RE =
  /([A-Za-z0-9.&']+(?:\s+[A-Za-z0-9.&']+){0,4}?)\s+(?:vs\.?|v\.?|@|at)\s+([A-Za-z0-9.&']+(?:\s+[A-Za-z0-9.&']+){0,4})/i;

// Minute is optional ("8PM ET") but AM/PM is mandatory whenever there's no
// ":MM" — otherwise a bare number (a channel number, a score) would match.
const TIME_RE =
  /\b(\d{1,2}):(\d{2})\s*(AM|PM)?\s*(ET|EST|EDT|CT|CST|CDT|MT|MST|MDT|PT|PST|PDT|UTC|GMT)?\b|\b(\d{1,2})\s*(AM|PM)\s*(ET|EST|EDT|CT|CST|CDT|MT|MST|MDT|PT|PST|PDT|UTC|GMT)?\b/i;

const KNOWN_EVENT_PREFIXES = new Set([
  'PPV',
  'UFC',
  'WWE',
  'BOXING',
  'ESPN+',
  'NFL',
  'MLB',
  'NBA',
  'NHL',
  'NCAAF',
  'NCAAB',
  'MMA',
]);

/** Parses a channel name (or EPG programme title) for event-channel structure. Undefined when it doesn't look like an event. */
export function parseEventTitle(raw: string): ParsedEventTitle | undefined {
  let text = raw.trim();
  let leaguePrefix: string | undefined;
  let channelNumber: string | undefined;

  const prefixMatch = PREFIX_RE.exec(text);
  if (prefixMatch?.[1]) {
    leaguePrefix = prefixMatch[1];
    channelNumber = prefixMatch[2];
    text = text.slice(prefixMatch[0].length);
  }

  let time: ParsedEventTime | undefined;
  const timeMatch = TIME_RE.exec(text);
  if (timeMatch) {
    // Two alternation branches: "H:MM[AM/PM][TZ]" (groups 1-4) or the
    // minute-less "H AM/PM[TZ]" (groups 5-7).
    const hour = timeMatch[1] ?? timeMatch[5];
    const minute = timeMatch[2];
    const meridiem = timeMatch[3] ?? timeMatch[6];
    const timezone = timeMatch[4] ?? timeMatch[7];
    time = {
      hour: Number(hour),
      minute: minute ? Number(minute) : 0,
      meridiem: meridiem?.toUpperCase() as 'AM' | 'PM' | undefined,
      timezone: timezone?.toUpperCase(),
    };
    text = (text.slice(0, timeMatch.index) + text.slice(timeMatch.index + timeMatch[0].length)).trim();
  }

  const matchupMatch = MATCHUP_RE.exec(text);
  const teamA = matchupMatch?.[1]?.trim();
  const teamB = matchupMatch?.[2]?.trim();

  const isKnownEventLeague = leaguePrefix !== undefined && KNOWN_EVENT_PREFIXES.has(leaguePrefix.toUpperCase());
  // "PPV" is unambiguous enough to trust anywhere in the name, not just
  // as a "PPV NN -" prefix (e.g. "UFC 320 PPV").
  const hasStandalonePpv = /\bppv\b/i.test(raw);

  if (!teamA && !isKnownEventLeague && !hasStandalonePpv) {
    return undefined;
  }

  return {
    leaguePrefix,
    channelNumber,
    teamA,
    teamB,
    time,
    eventName: !teamA && text ? text : undefined,
  };
}

const EVENT_GROUP_KEYWORDS = ['ppv', 'pay per view', 'pay-per-view', 'events'];

export interface EventChannelDetection {
  isEventChannel: boolean;
  parsed?: ParsedEventTitle;
}

/** Detects whether a channel is itself a one-off event, per §4.2: checks the name first, then the group/category as a fallback signal. */
export function detectEventChannel(name: string, group?: string): EventChannelDetection {
  const parsed = parseEventTitle(name);
  if (parsed) return { isEventChannel: true, parsed };

  const groupLower = (group ?? '').toLowerCase();
  if (EVENT_GROUP_KEYWORDS.some((kw) => groupLower.includes(kw))) {
    return { isEventChannel: true };
  }

  return { isEventChannel: false };
}
