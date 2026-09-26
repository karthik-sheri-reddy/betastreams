import { normalizeChannelName } from '../../shared/resolve/normalize';
import { combinedFuzzyScore, networkFamilyOf } from '../../shared/resolve/fuzzy';
import type { Station } from '../../shared/config/stations';
import { detectEventChannel, type ParsedEventTitle } from './eventTitle';
import { resolveByChannelId, resolveByNormalizedName, type IptvOrgIndex } from './iptvOrgIndex';
import { resolveStation } from './callsign';

export type ResolutionMethod =
  | 'event_channel'
  | 'tvg_id'
  | 'alias'
  | 'callsign'
  | 'network_city'
  | 'fuzzy'
  | 'unresolved';

export interface ChannelResolutionInput {
  sourceId: string;
  streamKey: string;
  name: string;
  tvgId?: string;
  group?: string;
}

export interface ChannelResolution {
  sourceId: string;
  streamKey: string;
  normalizedKey: string;
  feedHint?: string;
  isEventChannel: boolean;
  eventParsed?: ParsedEventTitle;
  canonicalChannelId?: string;
  resolutionMethod: ResolutionMethod;
  resolutionConfidence: number;
}

/** A memoizable-by-normalized-key subset of a resolution — what's actually reusable across different streams/sources sharing the same name. */
export interface MemoizedResolution {
  canonicalChannelId?: string;
  resolutionMethod: ResolutionMethod;
  resolutionConfidence: number;
}

export interface FuzzyCandidate {
  normalized: string;
  canonicalChannelId: string;
}

export interface CascadeContext {
  iptvOrgIndex: IptvOrgIndex;
  /** normalizedName -> canonical label, from data/aliases.yaml. */
  aliasIndex: Map<string, string>;
  stationByCallsign: Map<string, Station>;
  stationByNetworkCity: Map<string, Station>;
  fuzzyCandidates: FuzzyCandidate[];
  /** Minimum jaroWinkler/tokenSetRatio score to accept a fuzzy match. Default 0.85. */
  fuzzyThreshold?: number;
}

const DEFAULT_FUZZY_THRESHOLD = 0.85;

// Confidence values here are the v1 hand-picked priors §4 step 5 wants
// persisted; §6.7's calibrated scoring model is a different (later,
// event-matching) confidence axis and doesn't reuse these numbers.
const CONFIDENCE: Record<Exclude<ResolutionMethod, 'unresolved' | 'event_channel' | 'fuzzy'>, number> = {
  tvg_id: 0.99,
  alias: 0.95,
  callsign: 0.9,
  network_city: 0.75,
};

/**
 * Stage A's cascade (§4): detect event channels first (they skip normal
 * resolution entirely), then try tvg-id, alias, call-sign, and blocked
 * fuzzy matching in that order, stopping at the first confident hit.
 * Memoizes by normalized name — both within one instance's lifetime and,
 * via the `initialMemo` constructor arg, across worker restarts (the
 * caller loads/saves `resolved_names` around this class; the class
 * itself has no DB dependency, which is what makes it easy to test).
 */
export class ChannelResolver {
  private readonly memo: Map<string, MemoizedResolution>;

  constructor(
    private readonly ctx: CascadeContext,
    initialMemo: Map<string, MemoizedResolution> = new Map(),
  ) {
    this.memo = initialMemo;
  }

  /** Every normalized key resolved so far — the caller persists this back to `resolved_names`. */
  getMemoSnapshot(): Map<string, MemoizedResolution> {
    return this.memo;
  }

  resolve(input: ChannelResolutionInput): ChannelResolution {
    const eventDetection = detectEventChannel(input.name, input.group);
    const { normalized, feedHint } = normalizeChannelName(input.name);

    if (eventDetection.isEventChannel) {
      return {
        sourceId: input.sourceId,
        streamKey: input.streamKey,
        normalizedKey: normalized,
        feedHint,
        isEventChannel: true,
        eventParsed: eventDetection.parsed,
        resolutionMethod: 'event_channel',
        resolutionConfidence: 1,
      };
    }

    const cached = this.memo.get(normalized);
    const memoized = cached ?? this.runCascade(input, normalized);
    if (!cached) this.memo.set(normalized, memoized);

    return {
      sourceId: input.sourceId,
      streamKey: input.streamKey,
      normalizedKey: normalized,
      feedHint,
      isEventChannel: false,
      canonicalChannelId: memoized.canonicalChannelId,
      resolutionMethod: memoized.resolutionMethod,
      resolutionConfidence: memoized.resolutionConfidence,
    };
  }

  private runCascade(input: ChannelResolutionInput, normalized: string): MemoizedResolution {
    if (input.tvgId) {
      const id = resolveByChannelId(this.ctx.iptvOrgIndex, input.tvgId);
      if (id) return { canonicalChannelId: id, resolutionMethod: 'tvg_id', resolutionConfidence: CONFIDENCE.tvg_id };
    }

    const iptvOrgHit = resolveByNormalizedName(this.ctx.iptvOrgIndex, normalized);
    if (iptvOrgHit) {
      return { canonicalChannelId: iptvOrgHit, resolutionMethod: 'alias', resolutionConfidence: CONFIDENCE.alias };
    }
    const aliasHit = this.ctx.aliasIndex.get(normalized);
    if (aliasHit) {
      return { canonicalChannelId: aliasHit, resolutionMethod: 'alias', resolutionConfidence: CONFIDENCE.alias };
    }

    const stationHit = resolveStation(input.name, this.ctx.stationByCallsign, this.ctx.stationByNetworkCity);
    if (stationHit) {
      const method = stationHit.method === 'callsign' ? 'callsign' : 'network_city';
      return {
        canonicalChannelId: `station:${stationHit.station.callsign}`,
        resolutionMethod: method,
        resolutionConfidence: CONFIDENCE[method],
      };
    }

    const fuzzyHit = this.bestFuzzyMatch(normalized);
    if (fuzzyHit) {
      return {
        canonicalChannelId: fuzzyHit.canonicalChannelId,
        resolutionMethod: 'fuzzy',
        resolutionConfidence: fuzzyHit.score,
      };
    }

    return { canonicalChannelId: undefined, resolutionMethod: 'unresolved', resolutionConfidence: 0 };
  }

  private bestFuzzyMatch(normalized: string): { canonicalChannelId: string; score: number } | undefined {
    const family = networkFamilyOf(normalized);
    const pool = family
      ? this.ctx.fuzzyCandidates.filter((c) => networkFamilyOf(c.normalized) === family)
      : this.ctx.fuzzyCandidates;

    let best: { canonicalChannelId: string; score: number } | undefined;
    for (const candidate of pool) {
      const score = combinedFuzzyScore(normalized, candidate.normalized);
      if (!best || score > best.score) {
        best = { canonicalChannelId: candidate.canonicalChannelId, score };
      }
    }

    const threshold = this.ctx.fuzzyThreshold ?? DEFAULT_FUZZY_THRESHOLD;
    return best && best.score >= threshold ? best : undefined;
  }
}
