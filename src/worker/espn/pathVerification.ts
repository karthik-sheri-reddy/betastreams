import {
  flattenLeagues,
  type CategoriesFile,
} from '../../shared/config/categories';
import { fetchEspnScoreboard } from './client';

export interface PathVerificationEntry {
  categoryId: string;
  espnPath: string;
  displayName: string;
  ok: boolean;
  status: number;
  eventCount?: number;
  error?: string;
}

export interface PathVerificationReport {
  generatedAt: string;
  entries: PathVerificationEntry[];
  okCount: number;
  failedCount: number;
}

/**
 * Verifies every ESPN path in a categories file against a live request
 * (§3: "Verify every ESPN path against the pseudo-r docs and a live
 * request at build time. Disable and log any path that 404s.").
 */
export async function verifyEspnPaths(
  file: CategoriesFile,
  fetchImpl?: typeof fetch,
): Promise<PathVerificationReport> {
  const leagues = flattenLeagues(file);
  const entries: PathVerificationEntry[] = [];

  for (const league of leagues) {
    const [sportPath, ...leagueParts] = league.espnPath.split('/');
    const leaguePath = leagueParts.join('/');
    try {
      const result = await fetchEspnScoreboard(sportPath ?? '', leaguePath, undefined, { fetchImpl });
      const ok = result.status === 200 || result.status === 304;
      entries.push({
        categoryId: league.categoryId,
        espnPath: league.espnPath,
        displayName: league.displayName,
        ok,
        status: result.status,
        eventCount: result.body?.events?.length,
        error: ok ? undefined : `unexpected status ${result.status}`,
      });
    } catch (err) {
      entries.push({
        categoryId: league.categoryId,
        espnPath: league.espnPath,
        displayName: league.displayName,
        ok: false,
        status: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    entries,
    okCount: entries.filter((e) => e.ok).length,
    failedCount: entries.filter((e) => !e.ok).length,
  };
}

/** Applies a verification report to a categories file, disabling any league whose path failed. */
export function applyVerificationReport(
  file: CategoriesFile,
  report: PathVerificationReport,
): CategoriesFile {
  const failedByPath = new Map(report.entries.filter((e) => !e.ok).map((e) => [e.espnPath, e]));
  return {
    ...file,
    categories: file.categories.map((cat) => ({
      ...cat,
      leagues: cat.leagues.map((league) => {
        const failure = failedByPath.get(league.espnPath);
        if (!failure) return league;
        return { ...league, disabled: true, disabledReason: failure.error ?? 'verification failed' };
      }),
    })),
  };
}
