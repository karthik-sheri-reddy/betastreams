import { ChannelResolver, type CascadeContext } from './cascade';

export interface AccuracyFixtureEntry {
  name: string;
  tvgId?: string;
  group?: string;
  /** Ground-truth canonical channel id, or null when the correct outcome is "unresolved". */
  expected: string | null;
  expectEventChannel?: boolean;
}

export interface AccuracyMismatch {
  name: string;
  expected: string | null;
  actual: string | null;
  resolutionMethod: string;
}

export interface AccuracyReport {
  total: number;
  correct: number;
  accuracy: number;
  mismatches: AccuracyMismatch[];
}

/**
 * Measures Stage A's cascade against a fixture of names with independently
 * pre-determined ground truth (§15 #3: "Accuracy is measured on the
 * fixture and recorded"). This is a measurement, not a test assertion —
 * there's no fixed target yet, only a baseline to record and, later,
 * avoid regressing (same philosophy as §12's eval baseline for the
 * scoring model).
 */
export function measureAccuracy(
  fixture: AccuracyFixtureEntry[],
  ctx: CascadeContext,
): AccuracyReport {
  const resolver = new ChannelResolver(ctx);
  const mismatches: AccuracyMismatch[] = [];
  let correct = 0;

  fixture.forEach((entry, i) => {
    const result = resolver.resolve({
      sourceId: 'accuracy-fixture',
      streamKey: String(i),
      name: entry.name,
      tvgId: entry.tvgId,
      group: entry.group,
    });

    const actual = result.canonicalChannelId ?? null;
    const eventChannelOk = entry.expectEventChannel === undefined || result.isEventChannel === entry.expectEventChannel;
    const canonicalOk = entry.expectEventChannel ? true : actual === entry.expected;

    if (eventChannelOk && canonicalOk) {
      correct += 1;
    } else {
      mismatches.push({
        name: entry.name,
        expected: entry.expected,
        actual,
        resolutionMethod: result.resolutionMethod,
      });
    }
  });

  return {
    total: fixture.length,
    correct,
    accuracy: fixture.length === 0 ? 1 : correct / fixture.length,
    mismatches,
  };
}
