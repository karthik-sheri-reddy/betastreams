import type { Station } from '../../shared/config/stations';

// Standard US broadcast call signs: K or W followed by 2-3 more letters,
// all caps (§4 cascade step 3). Matching only fully-uppercase runs is
// what keeps this from firing on ordinary words in mixed-case channel
// names — a real call sign always appears in caps in playlist data.
const CALLSIGN_RE = /\b([KW][A-Z]{2,3})\b/g;

// "FOX 2 Detroit"-style: a network name, an optional channel number,
// then a city name.
const NETWORK_CITY_RE = /\b(ABC|CBS|NBC|FOX|CW|PBS|MyNetworkTV)\s*\d{0,2}\s+([A-Z][A-Za-z.]*(?:\s+[A-Z][A-Za-z.]*){0,2})/;

/** Every uppercase [KW]XXX-shaped token in the name, deduplicated. Candidates only — caller must confirm against the station table. */
export function extractCallSignCandidates(rawName: string): string[] {
  const matches = rawName.match(CALLSIGN_RE) ?? [];
  return [...new Set(matches)];
}

export interface NetworkCityMatch {
  network: string;
  city: string;
}

/** Extracts a "NETWORK [NN] CITY" pattern, e.g. "FOX 2 Detroit" -> {network: "FOX", city: "Detroit"}. */
export function extractNetworkCityPattern(rawName: string): NetworkCityMatch | undefined {
  const m = NETWORK_CITY_RE.exec(rawName);
  if (!m?.[1] || !m[2]) return undefined;
  return { network: m[1].toUpperCase(), city: m[2].trim() };
}

export interface CallSignResolution {
  station: Station;
  method: 'callsign' | 'network_city';
}

/**
 * Resolves a raw channel name to a station via call-sign extraction,
 * falling back to the network+city pattern. Only ever returns a station
 * that's actually in the table — extraction candidates that don't match
 * anything real are silently dropped, not treated as a match.
 */
export function resolveStation(
  rawName: string,
  stationByCallsign: Map<string, Station>,
  stationByNetworkCity: Map<string, Station>,
): CallSignResolution | undefined {
  for (const candidate of extractCallSignCandidates(rawName)) {
    const station = stationByCallsign.get(candidate);
    if (station) return { station, method: 'callsign' };
  }

  const networkCity = extractNetworkCityPattern(rawName);
  if (networkCity) {
    const key = `${networkCity.network}\u0000${networkCity.city.toLowerCase()}`;
    const station = stationByNetworkCity.get(key);
    if (station) return { station, method: 'network_city' };
  }

  return undefined;
}
