import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { measureAccuracy, type AccuracyFixtureEntry } from './accuracy';
import { buildCascadeContext } from './runStageA';
import fixture from './__fixtures__/accuracyFixture.json';
import world from './__fixtures__/accuracyWorld.json';
import type { IptvOrgData } from '../ingest/iptvOrg';

const ALIASES_PATH = path.join(__dirname, '..', '..', '..', 'data', 'aliases.yaml');
const STATIONS_PATH = path.join(__dirname, '..', '..', '..', 'data', 'stations.yaml');

const iptvOrgData: IptvOrgData = { ...world, fetchedAt: new Date().toISOString() };

describe('Stage A resolution accuracy', () => {
  it('has a fixture of at least 50 entries with independently-determined ground truth', () => {
    expect(fixture.length).toBeGreaterThanOrEqual(50);
  });

  it('measures and records current accuracy against the fixture', () => {
    const ctx = buildCascadeContext(iptvOrgData, { aliasesPath: ALIASES_PATH, stationsPath: STATIONS_PATH });
    const report = measureAccuracy(fixture as AccuracyFixtureEntry[], ctx);

    console.log(
      `Stage A accuracy: ${report.correct}/${report.total} (${(report.accuracy * 100).toFixed(1)}%)`,
    );
    if (report.mismatches.length > 0) {
      console.log('Mismatches:', JSON.stringify(report.mismatches, null, 2));
    }

    // Baseline recorded in PROGRESS.md: 100% (57/57) on this fixture as
    // of Phase 3. This is a floor, not a ceiling — a regression below it
    // means something real broke; exceeding it (a bigger fixture that's
    // still 100%, or fixing a currently-accepted gap) is always fine.
    expect(report.accuracy).toBeGreaterThanOrEqual(1);
  });
});
