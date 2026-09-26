import { loadXtreamAccountsFromEnv } from '../../shared/config/xtreamAccounts';
import type { AppEnv } from '../../shared/config/env';
import type { ChannelSource, EpgSource } from '../../shared/types/source';
import { M3uChannelSource, XmltvEpgSource } from './sources/m3uXmltvSource';
import { XtreamChannelSource, XtreamEpgSource } from './sources/xtreamSource';

export interface BuiltSources {
  channelSources: ChannelSource[];
  epgSources: EpgSource[];
}

function splitCsv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Builds every configured ChannelSource/EpgSource from env vars
 * (M3U_URLS, EPG_URLS, XTREAM_ACCOUNTS — see .env.example). An operator
 * running with none of these set gets an empty result, not an error:
 * every source is individually optional (§2).
 */
export function buildSourcesFromEnv(env: AppEnv): BuiltSources {
  const channelSources: ChannelSource[] = [];
  const epgSources: EpgSource[] = [];

  splitCsv(env.M3U_URLS).forEach((url, i) => {
    channelSources.push(new M3uChannelSource({ sourceId: `m3u-${i}`, url }));
  });
  splitCsv(env.EPG_URLS).forEach((url, i) => {
    epgSources.push(new XmltvEpgSource({ sourceId: `epg-${i}`, url }));
  });

  for (const account of loadXtreamAccountsFromEnv(env.XTREAM_ACCOUNTS)) {
    channelSources.push(new XtreamChannelSource(account));
    epgSources.push(new XtreamEpgSource(account));
  }

  return { channelSources, epgSources };
}
