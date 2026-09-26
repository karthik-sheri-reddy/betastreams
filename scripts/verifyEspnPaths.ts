/**
 * CLI wrapper: verifies every ESPN path in config/categories.yaml
 * against a live request (§3), writes
 * reports/espn-path-verification.json, and rewrites categories.yaml in
 * place to disable any path that failed. Run with:
 *   npm run verify:espn-paths
 *
 * Requires outbound access to site.api.espn.com — in a network-
 * restricted environment (e.g. a sandbox that only allowlists specific
 * hosts) this will fail every path with a network/host error rather than
 * a real 404. Check the error text in the report before trusting a
 * "disabled" result: a host-blocked error is not the same as ESPN saying
 * the path doesn't exist.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadCategoriesFromFile, serializeCategoriesToYaml } from '../src/shared/config/categories';
import { verifyEspnPaths, applyVerificationReport } from '../src/worker/espn/pathVerification';

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'categories.yaml');
const REPORT_PATH = path.join(__dirname, '..', 'reports', 'espn-path-verification.json');

async function main(): Promise<void> {
  const file = loadCategoriesFromFile(CONFIG_PATH);
  const leagueCount = file.categories.reduce((n, c) => n + c.leagues.length, 0);
  console.log(`Verifying ${leagueCount} ESPN paths against a live request...`);

  const report = await verifyEspnPaths(file);

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`Wrote ${REPORT_PATH}: ${report.okCount} ok, ${report.failedCount} failed.`);

  if (report.failedCount > 0) {
    const updated = applyVerificationReport(file, report);
    fs.writeFileSync(CONFIG_PATH, serializeCategoriesToYaml(updated));
    console.log(`Disabled ${report.failedCount} path(s) in ${CONFIG_PATH}:`);
    for (const e of report.entries.filter((x) => !x.ok)) {
      console.log(`  - [${e.categoryId}] ${e.espnPath} (${e.displayName}): ${e.error}`);
    }
  }
}

main().catch((err) => {
  console.error('ESPN path verification failed:', err);
  process.exit(1);
});
