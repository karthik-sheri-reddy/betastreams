import type { ChannelRecord, ChannelSource, EpgSource, ProgrammeRecord } from '../../../shared/types/source';
import { parseM3U } from '../m3u';
import { fetchXmltvProgrammes } from '../xmltv';

export interface M3uSourceConfig {
  sourceId: string;
  url: string;
  headers?: Record<string, string>;
}

export class M3uChannelSource implements ChannelSource {
  readonly kind = 'm3u' as const;
  readonly sourceId: string;

  constructor(private readonly config: M3uSourceConfig) {
    this.sourceId = config.sourceId;
  }

  async fetchChannels(): Promise<ChannelRecord[]> {
    const res = await fetch(this.config.url, { headers: this.config.headers });
    if (!res.ok) {
      throw new Error(`M3U fetch failed (${res.status}) for source ${this.sourceId}`);
    }
    const body = await res.text();
    return parseM3U(body, this.sourceId);
  }
}

export interface XmltvSourceConfig {
  sourceId: string;
  url: string;
  headers?: Record<string, string>;
}

export class XmltvEpgSource implements EpgSource {
  readonly sourceId: string;

  constructor(private readonly config: XmltvSourceConfig) {
    this.sourceId = config.sourceId;
  }

  fetchProgrammes(): AsyncIterable<ProgrammeRecord> {
    return fetchXmltvProgrammes(this.config.url, this.sourceId, { headers: this.config.headers });
  }
}
