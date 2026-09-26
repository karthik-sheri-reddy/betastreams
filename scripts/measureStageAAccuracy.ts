/**
 * CLI wrapper: measures Stage A's resolution cascade against the
 * accuracy fixture (§15 #3: "Accuracy is measured on the fixture and
 * recorded") and writes reports/stage-a-accuracy.json. Run with:
 *   npm run measure:stage-a-accuracy
 */
import fs from 'node:fs';
import path from 'node:path';
import { measureAccuracy, type AccuracyFixtureEntry } from '../src/worker/resolve/accuracy';
import { buildCascadeContext } from '../src/worker/resolve/runStageA';
import type { IptvOrgData } from '../src/worker/ingest/iptvOrg';

const FIXTURE_PATH = path.join(__dirname, '..', 'src', 'worker', 'resolve', '__fixtures__', 'accuracyFixture.json');
const WORLD_PATH = path.join(__dirname, '..', 'src', 'worker', 'resolve', '__fixtures__', 'accuracyWorld.json');
const ALIASES_PATH = path.join(__dirname, '..', 'data', 'aliases.yaml');
const STATIONS_PATH = path.join(__dirname, '..', 'data', 'stations.yaml');
const REPORT_PATH = path.join(__dirname, '..', 'reports', 'stage-a-accuracy.json');

function main(): void {
  const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf-8')) as AccuracyFixtureEntry[];
  const world = JSON.parse(fs.readFileSync(WORLD_PATH, 'utf-8')) as Omit<IptvOrgData, 'fetchedAt'>;
  const iptvOrgData: IptvOrgData = { ...world, fetchedAt: new Date().toISOString() };

  const ctx = buildCascadeContext(iptvOrgData, { aliasesPath: ALIASES_PATH, stationsPath: STATIONS_PATH });
  const report = measureAccuracy(fixture, ctx);

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), ...report }, null, 2));

  console.log(`Stage A accuracy: ${report.correct}/${report.total} (${(report.accuracy * 100).toFixed(1)}%)`);
  console.log(`Wrote ${REPORT_PATH}`);
  if (report.mismatches.length > 0) {
    console.log('Mismatches:');
    for (const m of report.mismatches) {
      console.log(`  - "${m.name}": expected ${JSON.stringify(m.expected)}, got ${JSON.stringify(m.actual)} (${m.resolutionMethod})`);
    }
  }
}

main();
