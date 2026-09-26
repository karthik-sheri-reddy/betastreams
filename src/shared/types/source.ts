/**
 * Normalized shapes every ingest adapter (M3U+XMLTV, Xtream Codes, ...)
 * must produce. Everything downstream of ingest (Stage A onward) works
 * only on these records and never knows which adapter produced them —
 * per §2.1 of the build spec.
 */

export interface ChannelRecord {
  sourceId: string;
  /** Stable per-source identifier for this stream (e.g. Xtream stream_id, or a hash of the M3U line). */
  streamKey: string;
  name: string;
  tvgId?: string;
  logo?: string;
  group?: string;
  /**
   * Never a fully resolved URL. For Xtream this is a template like
   * `{server}/live/{username}/{password}/{stream_id}.{ext}`; credentials
   * are substituted only inside the /play route (§8), never stored
   * resolved.
   */
  urlTemplate: string;
  containerExt: string;
  headers?: Record<string, string>;
  /** True when the channel name/group itself looks like a one-off event (§4.2). */
  isEventChannel?: boolean;
  tvArchive?: boolean;
  tvArchiveDurationHours?: number;
}

export interface ProgrammeRecord {
  sourceId: string;
  /** Matches ChannelRecord.tvgId (or Xtream epg_channel_id) for the channel this airs on. */
  channelRef: string;
  title: string;
  subTitle?: string;
  description?: string;
  /** ISO 8601 UTC. */
  start: string;
  stop: string;
  category?: string;
  previouslyShown?: boolean;
}

/**
 * Yields normalized channel records for one operator source (one M3U
 * playlist, or one Xtream account). Implementations must be polite to
 * their upstream (caching, conditional requests, backoff — §2.1) and must
 * never resolve credentials into the returned records.
 */
export interface ChannelSource {
  readonly sourceId: string;
  readonly kind: 'm3u' | 'xtream';
  fetchChannels(): Promise<ChannelRecord[]>;
}

/**
 * Yields normalized programme records for one EPG source (one XMLTV URL,
 * or one Xtream account's xmltv.php guide). Must stream-parse rather than
 * load the whole guide into memory (§1).
 */
export interface EpgSource {
  readonly sourceId: string;
  fetchProgrammes(): AsyncIterable<ProgrammeRecord>;
}
