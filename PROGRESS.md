# betastreams — Progress

Build log for the Sports EPG → Event Matching Stremio add-on. Read this
before starting a new phase or a fresh session. Follows §0/§15 of the
build spec: stop after each phase's acceptance checks, write the handoff
here, report, and wait for "continue".

## Open questions (asked, not yet answered)

This session ran unattended (no interactive user available at build time),
so per the spec's own fallback ("If I'm not available, use placeholders
and continue") these were **not** answered and placeholders/defaults were
used instead. Nothing about them blocks Phase 1; they start to matter in
Phase 2 (real ingest) and Phase 13 (actual Coolify deploy):

1. **Dev IPTV sources** — no M3U/XMLTV URLs or Xtream Codes account were
   provided. `.env.example` documents the shape (`M3U_URLS`, `EPG_URLS`,
   `XTREAM_ACCOUNTS`); Phase 2 will need at least one real or realistic
   fixture to build/test the adapters against. If none is provided, Phase
   2 will construct a synthetic fixture (a small hand-built M3U + XMLTV
   pair, and a recorded/fabricated Xtream `player_api.php` response shape)
   so the adapters and their tests aren't blocked — but that's a stand-in,
   not a substitute for testing against a real provider before relying on
   this for actual viewing.
2. **DuckDNS subdomain** — unknown. `PUBLIC_BASE_URL` in `.env.example` is
   a placeholder (`https://REPLACE_ME.duckdns.org`). No actual Coolify
   deploy has happened; §15 Phase 1's acceptance check ("`/health` responds
   over valid HTTPS, and auto-deploy on push works") could not be
   completed end-to-end because that requires your DuckDNS domain, your
   Coolify instance, and pushing to GitHub — none of which this session
   has access to. Locally, `/health` was verified working via `docker run`
   (see below); the README's Coolify checklist covers the remaining
   manual steps for you to run once you have a domain and server.
3. **GitHub repo** — resolved: `karthik-sheri-reddy/betastreams`, already
   given. Working on branch `claude/gallant-hawking-ntxu5r`.
4. **Schedules Direct account** — unknown. `.env.example` has
   `SCHEDULES_DIRECT_USERNAME`/`SCHEDULES_DIRECT_PASSWORD` as optional and
   unset. Not used anywhere yet (only matters once EPG sourcing choices
   come up in Phase 2/6).

**Action for you:** answer these whenever convenient (a message is fine,
no need to interrupt a phase). Until then later phases proceed with
fixtures/placeholders and will flag anywhere a real value is a hard
blocker.

## Phase 1 — Scaffold and deploy skeleton: DONE (locally verified)

### What was built

- **Repo structure:** `src/server`, `src/worker`, `src/shared`, `web/`,
  `config/`, per spec §1.
- **TypeScript:** Node 22, CommonJS (chosen over ESM to avoid `.js`
  extension resolution friction in a fork-based two-process app — see
  Decisions below). Strict mode, `noUncheckedIndexedAccess` on.
- **Lint:** ESLint 9 flat config + `@typescript-eslint`. Clean (`npm run
  lint` exits 0).
- **Tests:** Vitest. 4 tests passing (`src/shared/db/migrate.test.ts`,
  `src/server/routes/health.test.ts`) covering migration idempotency, WAL
  mode, `meta`/`data_version` helpers, and `/health`'s response shape.
- **SQLite:** `better-sqlite3`, WAL mode, `synchronous=NORMAL`,
  `foreign_keys=ON`. Migration runner (`src/shared/db/migrate.ts`) applies
  numbered `.sql` files from `src/shared/db/migrations/` exactly once,
  tracked in a `schema_migrations` table. First migration
  (`0001_init.sql`) creates `meta` (key/value) and seeds `data_version=0`,
  `schema_version=1`. `src/shared/db/meta.ts` has
  `getDataVersion`/`bumpDataVersion`/`getMeta`/`setMeta` helpers both
  processes will use.
- **Entrypoint** (`src/entrypoint.ts`): opens the DB, runs migrations,
  forks the worker (`src/worker/index.ts`), starts the Fastify server.
  Worker crash → exponential backoff restart (`1s, 2s, 4s, ... capped at
  WORKER_RESTART_MAX_BACKOFF_MS`, default 30s), reset on a clean "ready"
  message. `SIGTERM`/`SIGINT` → kill worker, close Fastify, close DB, exit
  0. This satisfies §1's "crashed worker restarts with backoff, and the
  server keeps serving the last good data" and §13's graceful shutdown
  requirement early, since it was cheap to do alongside the fork logic.
- **Worker** (`src/worker/index.ts`): opens its own DB handle, runs
  migrations (idempotent, so this is safe even though the entrypoint also
  runs them), logs startup, sends a `ready` IPC message, currently just a
  heartbeat placeholder — real ingest scheduling starts in Phase 2.
- **Server** (`src/server/app.ts`): Fastify instance, `/health` route
  (`src/server/routes/health.ts`) returning
  `{status, uptimeSeconds, dataVersion, timestamp}` (200 if the DB read
  succeeds, 503 "degraded" otherwise). Serves `web/dist` as static files
  via `@fastify/static` when present, logging a warning instead of failing
  when it isn't (so `npm run dev:server` works before anyone's run
  `build:web`).
- **web/:** minimal Vite + TS project (placeholder `index.html`/`main.ts`)
  so the build pipeline (`npm run build:web` → `web/dist`) exists and is
  exercised by the Dockerfile now, ahead of the real configure UI in
  Phase 6.
- **Dockerfile:** multi-stage (`deps` → `build` → `prod-deps` →
  `runtime`), `node:22-slim`, non-root `betastreams` user, `ffmpeg`
  installed unconditionally and `tesseract-ocr` only when
  `--build-arg ENABLE_OCR=true`, `HEALTHCHECK` using `node -e fetch(...)`
  (no curl in slim images, per spec). `/data/{backups,logos,posters}`
  pre-created and chowned.
- **docker-compose.yml:** single `app` service, `build: .`, `expose:
  ["7000"]` (no `ports:`, Coolify's proxy routes), named volume
  `appdata:/data`, `environment:` block covering every var in
  `.env.example`, `restart: unless-stopped`.
- **`.env.example`**, **`.dockerignore`**, **`.gitignore`**.
- **README.md:** local dev, Docker, and the full Coolify + DuckDNS
  deployment checklist from §13.

### Verification (all done locally; see numbers below)

- `npm run typecheck` — clean.
- `npm run lint` — clean.
- `npm test` — 4/4 passing.
- `npm run build` (tsc + copy SQL migrations into `dist/`) — succeeds;
  ran the compiled `dist/entrypoint.js` directly and confirmed: server
  listens, worker forks and reports ready, `GET /health` → 200 with
  `dataVersion: 0`.
- **Docker image:** built successfully end-to-end *except* the
  `apt-get install ffmpeg` step, which could not be exercised in this
  sandbox because outbound access to `deb.debian.org` is blocked at the
  sandbox's network egress policy (immediate 403, consistent with a
  firewalled/non-allowlisted host — Docker Hub and the npm registry *are*
  reachable from here, deb.debian.org is not). This is a property of the
  sandbox this session runs in, not of the Dockerfile; `apt-get install
  ffmpeg` on `node:22-slim` is standard and will work on the real Coolify
  server, which has normal internet access. Verified everything else that
  *is* exercisable in this sandbox by building a temporary local-only
  variant with the apt step stubbed out (never committed — see git history
  has no trace of it) and running the resulting container:
  - Non-root: `docker exec ... whoami` → `betastreams`.
  - `/data` is writable by that user; SQLite WAL files
    (`app.db`/`-shm`/`-wal`) created correctly.
  - `GET /health` over the container's mapped port → 200.
  - Docker `HEALTHCHECK` transitions to `"Status":"healthy"`.
  - `docker stop` (SIGTERM) → clean shutdown log lines from both server
    and worker, no forced kill needed.
  - **Not yet verified:** HTTPS over a real DuckDNS domain via Coolify —
    needs your actual domain/server (see Open Questions above). The
    `/health` endpoint itself is proven to work; what's unverified is the
    Coolify+DuckDNS plumbing around it, which is infrastructure this
    session doesn't have access to, not application code.

### Decisions and trade-offs

- **CommonJS over ESM.** The two-process fork architecture
  (`child_process.fork` on a `.js` file) plus wanting `tsc` as the sole
  build step made CommonJS the lower-friction choice — ESM under Node
  requires explicit `.js` extensions in relative imports and file-URL
  handling for `fork`/`require.main` idioms that CJS gives for free. Can
  revisit later if a dependency forces ESM-only.
- **No workspaces/monorepo tool.** `web/` is just a second, independent
  `package.json` built via `npm --prefix web`. Didn't reach for npm
  workspaces/Turborepo/Nx — the surface (one small Vite app, one Node
  app) doesn't need it yet. Revisit if `web/`'s dependency graph grows.
- **Fastify logger typing.** `fastify@5`'s `FastifyBaseLogger` type and
  `pino.Logger` disagree on one internal field (`msgPrefix`) despite being
  runtime-compatible (same method surface). Cast once at the
  `Fastify({ loggerInstance })` call site rather than fighting the
  generics further; documented inline in `src/server/app.ts`.
- **Migrations are plain `.sql` files**, applied in filename order,
  tracked in `schema_migrations`. No ORM. Matches "prefer boring,
  well-understood solutions" and keeps the migration runner itself
  trivially testable (see `migrate.test.ts`).
- **`meta` key/value table** is the only schema so far. Real tables
  (sources, channels, streams, programmes, events, matches, labels,
  overrides...) arrive incrementally starting Phase 2/3/5, each as its own
  numbered migration — didn't pre-build a big schema speculatively.
- **Worker heartbeat is a placeholder.** Real adaptive scheduling (§9) is
  Phase 2 work; Phase 1 only needed to prove the fork/restart/IPC
  mechanics.
- **Graceful shutdown and worker-restart backoff were pulled forward**
  from Phase 10/§1 into Phase 1, since they're intrinsic to "entrypoint
  that forks the worker" and cost nothing extra to get right now instead
  of retrofitting later.
- **Docker sandbox limitation** — see Verification above. Not a design
  decision, but recording it here because it explains why the Phase 1
  Docker verification note reads the way it does, and because whoever
  picks this up next (possibly a fresh session per §0) should not waste
  time trying to "fix" the Dockerfile over it.

### Measured numbers (Phase 1 scope only — full §9 budgets are Phase 7)

- Cold `npm install` (root): ~20s. `web/`: ~2s.
- `npm run build` (tsc + asset copy): ~2s.
- `npm run build:web` (Vite, placeholder app): ~0.1s.
- `npm test` (4 tests): ~0.5s wall.
- Docker image build (cached base layers, minus the blocked apt step):
  well under 10s for the Node stages.
- Container cold start to `/health` 200: ~2s (dominated by Fastify +
  worker fork, not measured precisely — real measurement is Phase 7).

## Phase 2 — Ingest: DONE (locally verified, including real network I/O)

### What was built

- **Shared types** (`src/shared/types/source.ts`): `ChannelRecord`,
  `ProgrammeRecord`, `ChannelSource`, `EpgSource` — the normalized shapes
  every adapter produces, source-agnostic per §2.1.
- **Credential redaction** (`src/shared/redact.ts`): `redactCredentials`
  strips both Xtream URL-path credentials (`/live/{user}/{pass}/...`) and
  query-param credentials (`?username=...&password=...`) from any string;
  `redactAccountForLogging` does the same for an account config object.
  Built and tested *before* the Xtream adapter, per the Phase 1 handoff
  plan, and threaded through every Xtream error path
  (`checkXtreamAccount`, `runIngest.ts`) so a thrown error's message is
  never logged or stored raw. 7 tests, including the §14-mandated "fails
  if a credential string shows up in captured log output" test.
- **M3U parser** (`src/worker/ingest/m3u.ts`): line-oriented `#EXTINF`
  parser (not streaming — M3U playlists are small text, unlike XMLTV).
  7 tests against a 5-channel fixture plus inline edge cases (fallback to
  `tvg-name`, `#EXTVLCOPT`/`#EXTGRP` lines, container-extension detection).
- **XMLTV streaming parser** (`src/worker/ingest/xmltv.ts`): `saxes`-based,
  yields one `ProgrammeRecord` per `<programme>` as its closing tag is
  seen — never buffers the whole document. Handles per-source date
  parsing (`20260115173000 +0000` → ISO UTC), `<previously-shown/>` rerun
  flag. 7 tests, including feeding the same fixture through in 7-byte
  chunks vs. all at once and asserting identical output (streaming
  correctness), and a UTF-8 multi-byte character deliberately split
  across a chunk boundary (via a persistent `TextDecoder({stream:true})`,
  not naive per-chunk `Buffer.toString()`).
- **M3U + XMLTV adapter** (`src/worker/ingest/sources/m3uXmltvSource.ts`):
  `M3uChannelSource`/`XmltvEpgSource` wrap the parsers behind
  `ChannelSource`/`EpgSource`.
- **Xtream Codes adapter** (`src/worker/ingest/sources/xtream*.ts`):
  - `xtreamAccount.ts`: `checkXtreamAccount` (player_api.php, no
    `action`) reads `user_info`/`server_info`, treats non-`Active` status
    or a past `exp_date` as unhealthy, never throws (bad account → `{
    healthy: false, reason }`, not an exception) — 9 tests including "a
    network-error message never leaks the raw username/password".
  - `xtreamCategories.ts`: keyword-based `sports`/`maybe-sports`/
    `not-sports` classifier plus an admin-override hook (wired to
    `data/overrides.yaml` once Phase 12's admin UI exists) — 5 tests.
  - `xtreamSource.ts`: `XtreamChannelSource` does the account check →
    `get_live_categories` → classify → filter → `get_live_streams` per
    included category cascade, mapping `epg_channel_id` to `tvgId` and
    category name to `group`; `XtreamEpgSource` reuses the XMLTV streaming
    parser against `xmltv.php`; `fetchShortEpg` decodes the base64
    title/description fields from `get_short_epg`. 7 integration tests
    against a full mocked `player_api.php`/`xmltv.php` fixture set
    (credential-scrubbed: fabricated `testuser_zz9`/`testpass_zz9`, never
    real values), asserting among other things that `urlTemplate` never
    contains the account's real username/password — only the literal
    `{server}/{username}/{password}` placeholders §2.1 specifies,
    resolved later in the `/play` route (Phase 6), never stored resolved.
- **iptv-org loader** (`src/worker/ingest/iptvOrg.ts`): fetches
  channels/feeds/logos/guides.json, file-backed daily cache, falls back to
  a stale cached copy on a failed refresh rather than failing outright
  (§2: "if any source is down, serve the last good data and mark it
  stale"). 5 tests.
- **ESPN client** (`src/worker/espn/client.ts`): `fetchEspnScoreboard`/
  `fetchEspnTeams` with conditional-request support (`If-None-Match` →
  304 handling) and `computeAdaptivePollIntervalMs` — the pure §9 rule
  (60s live / 10min within 6h / 60min otherwise) as a standalone,
  clock-injectable function. 10 tests. **Not yet wired into the worker's
  scheduler** — there's no consumer for scoreboard data until Stage C
  (Phase 5), so polling ESPN now would just fetch and discard; wiring it
  is Phase 5's job, alongside the adaptive-interval scheduler itself
  (this phase only proves the interval math and the client, not a live
  poll loop).
- **`config/categories.yaml`** + loader (`src/shared/config/categories.ts`,
  zod-validated): all 17 categories from §3, in order, with ESPN paths for
  every league that has one and `epgKeywords` for EPG-derived-only
  categories (fight/boxing, rugby, cricket, darts, billiards). **Rugby's
  ESPN numeric league IDs were not filled in** — §3 flags these as numeric
  IDs rather than slugs, and guessing them would mean fabricating IDs, so
  rugby currently has `leagues: []` and relies on `epgKeywords` only.
  Whoever has real ESPN rugby league IDs (or can verify them against pseudo-r's
  docs) should add them. 5 tests, including "no duplicate espnPath",
  "every league has a positive priority", and the full real
  `categories.yaml` round-tripping through the zod schema.
- **ESPN path verification** (`src/worker/espn/pathVerification.ts` +
  `scripts/verifyEspnPaths.ts`): `verifyEspnPaths` hits every configured
  league's scoreboard endpoint and reports ok/failed per path;
  `applyVerificationReport` disables only the failed ones in place. 3
  tests against a mocked fetch. **Actually ran it against the real ESPN
  API** (`npm run verify:espn-paths`) — see Verification below for why
  that run's output was discarded rather than committed.
- **DB migrations** (`0002_ingest.sql`): `sources` (health/label
  bookkeeping), `source_hashes` (one content hash per `(source_id,
  'channels'|'programmes')` — Xtream accounts share one source id across
  both artifact types, M3U/XMLTV pairs don't, so this is keyed per
  artifact rather than per source), `channels`, `programmes`.
- **Incremental ingest** (`src/worker/ingest/{store,runIngest}.ts`):
  `ingestChannelSource`/`ingestEpgSource` fetch, hash the record set
  (order-independent — sorted by a stable key before hashing, so a
  provider re-shuffling the same list doesn't look like a change), compare
  against the stored hash, and skip the DB write entirely when unchanged
  (`skipped: true`, no rows touched, `data_version` not bumped) — this is
  what makes a warm re-ingest a no-op (§9). On a changed hash, does a
  delete+reinsert-in-one-transaction replace per source (both adapters
  return a full list each fetch; there's no incremental diff from the
  provider side to exploit yet). A thrown fetch/parse error marks the
  source unhealthy with a redacted error message rather than crashing the
  worker or the other sources' ingest. 9 tests.
- **Worker wiring** (`src/worker/ingest/{buildSources,ingestCycle}.ts`,
  `src/worker/index.ts`): `buildSourcesFromEnv` turns `M3U_URLS`,
  `EPG_URLS`, `XTREAM_ACCOUNTS` into the adapters above (empty env →
  empty source list, not an error). The worker now runs one ingest pass
  immediately on startup, then channel sources every 6h and EPG sources
  every 3h (§2's cadence), bumping `data_version` only when something
  actually changed.

### Verification

- `npm run typecheck` (now also checks `scripts/` via a second
  `tsconfig.scripts.json` pass) — clean.
- `npm run lint` — clean.
- `npm test` — **78/78 passing** across 13 files (up from 4/4 at the end
  of Phase 1).
- **Real end-to-end smoke test, not just mocked-fetch unit tests:**
  started a tiny local HTTP server serving the M3U/XMLTV fixtures, ran the
  actual compiled `dist/entrypoint.js` with `M3U_URLS`/`EPG_URLS` pointing
  at it. Confirmed: worker forked, built 1 channel source + 1 EPG source
  from env, ingested 5 channels + 4 programmes over real HTTP, bumped
  `data_version` from 0→1→2, and `/health` reflected it. **Then re-ran
  the same binary against the same DB and the same unchanged fixtures**:
  both sources logged `skipped: true`, `data_version` stayed at 2 — the
  no-op behavior holds through a real process restart against a real
  SQLite file, not just within one Vitest run.
- **ESPN API is unreachable from this sandbox.** `site.api.espn.com`
  returned `403 Host not in allowlist` — a network-egress policy on this
  specific environment (same class of restriction as the `deb.debian.org`
  block noted in Phase 1's Docker verification, not an ESPN or app issue).
  Ran `npm run verify:espn-paths` anyway to prove the script itself works:
  it correctly wrote a report and disabled all 31 paths — but every
  failure was `unexpected status 403` (the sandbox's proxy), not a real
  ESPN 404. Since that "all disabled" result would be actively wrong for
  the real deployment, **I reverted `config/categories.yaml` to its
  pre-verification state** rather than commit a false-negative report, and
  added `reports/` to `.gitignore` (it's a regeneratable artifact, not
  something to track — same reasoning as `eval/history.csv`). **Action
  needed:** re-run `npm run verify:espn-paths` from an environment with
  real internet access (or broaden this environment's network policy —
  see Open Questions below) before trusting any path as verified; right
  now every league path in `categories.yaml` is unverified against a live
  request, only checked against the pseudo-r docs by hand when the list
  was written.
- The Coolify MCP connector mentioned in the continue-Phase-2 request
  shows `needs_reconnect` / not enabled in this chat session (checked via
  `ListConnectors`), so I could not use it to test a deployment against
  `betastreams.duckdns.org` as asked. See Open Questions below.

### Decisions and trade-offs

- **Hash the parsed record set, not the raw upstream bytes.** Computing
  the "did anything change" hash from a canonical (sorted, JSON-stringified)
  form of the adapter's *output* — rather than the raw M3U/XML text or
  Xtream JSON — means the incremental-ingest logic in `runIngest.ts` works
  identically for every adapter without each one needing its own raw-hash
  plumbing. The cost: this doesn't save the network fetch itself on a warm
  cycle (§9's "hash every source" is partly about that), only the
  downstream parse-and-DB-write cost. True conditional HTTP requests
  (ETag/If-Modified-Since) for M3U/XMLTV are a candidate follow-up;
  Xtream's `xmltv.php` "conditional requests where the server supports
  them" from §2.1 is likewise not yet implemented — noted for Phase 5 or
  later when ingest volume actually makes it worth it.
- **Full replace-per-source on any change**, not a fine-grained diff by
  stream/programme key. Both adapters return a complete list on every
  fetch, so delete+reinsert in one transaction is simplest-correct.
  Fine-grained diffing to "rescore only affected channel-event pairs" is
  explicitly a §9 goal, but there's no scoring yet (Phase 5) for it to
  matter to — revisit when Stage C exists.
- **ESPN client and adaptive-interval math are built and tested but not
  wired into the worker's scheduler.** Nothing consumes scoreboard data
  yet (Stage C/Phase 5), so a live poll loop now would fetch and discard.
  Building the pure interval function (`computeAdaptivePollIntervalMs`)
  now, decoupled from any scheduler, means Phase 5 wires scheduling
  against an already-tested policy rather than inventing one under
  pressure.
- **iptv-org loader is built and tested but not called from the worker
  loop either**, for the same reason — its only consumer (Stage A alias
  resolution) is Phase 3.
- **Rugby has no ESPN league paths.** §3 says these are "numeric IDs"
  unlike every other sport's slug paths, and I don't have a verified
  numeric ID to put there without fabricating one. `epgKeywords` covers
  rugby for now; `leagues: []` is intentional, not an oversight.
- **`fetchShortEpg` is implemented but unused by anything yet** — §2.1 is
  explicit that it should only be called "for sports-category channels
  with no programmes in the full guide, near a candidate event,
  rate-limited... cached for 30 min," all of which requires the candidate
  events Stage C produces. Building the fetch+base64-decode function now,
  isolated and tested, means Phase 5's scheduling layer has less to get
  right in one go.
- **Sequential, not parallel, ingest within a cycle**
  (`runChannelIngestCycle`/`runEpgIngestCycle` loop over sources one at a
  time). Matches §2.1's politeness requirement more directly than
  parallelizing for speed would, and Phase 2's source counts are small
  enough that this isn't a bottleneck.
- **Xtream default `output` fallback**: `resolveOutputExt` prefers the
  account's configured `output`, then the account-check response's
  `allowed_output_formats[0]`, then hardcodes `ts` — matches §2.1 exactly.

### Measured numbers

- Full test suite (78 tests, 13 files): ~1.6s wall.
- Real end-to-end ingest smoke test (local HTTP fixture server, 5
  channels + 4 programmes): worker startup to both sources ingested and
  `data_version` bumped twice, well under 1s.
- Warm re-ingest against the same fixtures: both sources report
  `skipped: true`; no measurable DB write cost (the hash comparison is the
  only work done). Formal cold-ingest/warm-reingest timing budgets against
  realistic 20k-stream/100k-programme volumes are Phase 7's job (§9's
  numeric budgets), not Phase 2's — nothing here contradicts them, but
  nothing here has been load-tested at that scale either.

## Open questions (updated)

Carried over from Phase 1, still unanswered, still not blocking:

1. **Dev IPTV sources** — still no real M3U/XMLTV/Xtream credentials.
   Phase 2 built and tested every adapter against synthetic fixtures (a
   hand-built M3U+XMLTV pair, a credential-scrubbed fake Xtream API
   response set) as flagged as the fallback plan. This proves the parsing
   and ingest logic is correct; it does **not** prove any real provider's
   M3U/XMLTV/Xtream responses match these adapters' assumptions byte for
   byte. Point real credentials at `.env`'s `M3U_URLS`/`EPG_URLS`/
   `XTREAM_ACCOUNTS` and re-run ingest before trusting this against a real
   panel.
2. **DuckDNS subdomain** — you mentioned `betastreams.duckdns.org` when
   asking me to test deployment via Coolify. I did not get to test
   against it: the Coolify MCP connector is present in your org but
   showed `needs_reconnect` and wasn't enabled in this chat session. To
   fix: reconnect it at
   [claude.ai/customize/connectors](https://claude.ai/customize/connectors),
   then a **new session** picks it up (connectors load at session start).
   I still don't know whether `betastreams.duckdns.org`'s DNS/IP and the
   Coolify app/domain config from §13 have actually been set up yet —
   that's independent of the connector issue.
3. **GitHub repo** — resolved since Phase 1:
   `karthik-sheri-reddy/betastreams`. A base `main` branch now exists
   (was empty before) with PR
   [karthik-sheri-reddy/betastreams#1](https://github.com/karthik-sheri-reddy/betastreams/pull/1)
   open from `claude/gallant-hawking-ntxu5r`.
4. **Schedules Direct account** — still unknown/unused; not relevant yet.
5. **New this phase — sandbox network egress is narrower than
   production.** Two hosts this repo needs were blocked in this specific
   session's environment: `deb.debian.org` (Phase 1, Docker's `apt-get`)
   and `site.api.espn.com` (Phase 2, the path-verification script). Both
   are ordinary hosts any normal server reaches fine; the block is this
   environment's network policy, changeable under the cloud environment's
   settings (Edit → Network access) if a future session needs to actually
   run either live. Flagging this once here so it isn't re-discovered and
   re-explained every phase — if a later phase hits a third blocked host,
   assume the same cause first.

## Next: Phase 3 — Stage A (stream → canonical channel resolution)

Per §15 #3 / §4: normalization (strip country/quality tags, unidecode,
lowercase), event-channel detection (parse channel names/group titles that
look like one-off events, e.g. "PPV 3 - UFC 320" — reusing Phase 5's title
parser once it exists, or a minimal stand-in now), the cascade
(`tvg-id`/`epg_channel_id` exact → alias hash → call-sign extraction →
blocked fuzzy match → logo dHash), memoization by normalized key, and
channel grouping so scoring in Phase 5 happens once per canonical channel
rather than per stream.

**First concrete steps when Phase 3 starts:**

1. Read `channels` rows written by Phase 2's ingest (`src/worker/ingest/store.ts`'s
   tables) — Stage A is a read of that table, a read of the iptv-org
   loader's cached data, and a write to new `canonical_channels`/
   `channel_resolutions` tables. It should not need to know about M3U vs.
   Xtream at all; that's the point of the `ChannelRecord` abstraction from
   Phase 2.
2. Build the name-normalization rule list first, as pure functions with
   its own test file, before the cascade — §15 #3's acceptance check
   ("50 messy real-world name variants") is much easier to hit with
   normalization already solid.
3. `data/aliases.yaml` (RSN rebrand chains: Fox Sports X → Bally Sports X
   → FanDuel Sports Network X, etc.) is new, hand-authored config — start
   it small and expect to grow it from real Stage A test failures rather
   than trying to enumerate every alias up front.
4. Call-sign extraction and fuzzy-match blocking need the iptv-org
   `channels`/`feeds` data Phase 2's loader already fetches — wire that
   loader's output into Stage A rather than re-fetching independently.
5. New migrations for canonical channels + resolution results
   (`0003_...sql`).
6. Decide how event-channel detection (§4.2) relates to Phase 5's title
   parser (§6.3) — the spec says they share a parser. Consider building a
   minimal shared parser now if Phase 3 needs it before Phase 5 exists, or
   defer full event-channel parsing to land alongside Phase 5's parser and
   have Phase 3 only flag "looks event-like" heuristically in the
   meantime. Worth deciding explicitly rather than accidentally building
   two parsers.

**How to run what exists today:**

```bash
npm install && npm --prefix web install
npm run build:web
npm run dev:server   # http://localhost:7000/health
npm test             # 78 tests
npm run verify:espn-paths   # writes reports/espn-path-verification.json (needs real ESPN access)
```

or, to see real ingest happen end-to-end without a real IPTV provider,
point `M3U_URLS`/`EPG_URLS` at any small locally-served M3U/XMLTV files
(see the fixtures under `src/worker/ingest/__fixtures__/`) and run
`npm run dev:server`.

**Open issues carried into Phase 3:** none blocking; see Open Questions
above for the non-blocking ones — in particular, re-run
`npm run verify:espn-paths` from a network-unrestricted environment before
trusting `config/categories.yaml`'s ESPN paths as verified, and reconnect
the Coolify connector if you want deployment testing done from a session.

If context is getting long when you pick this back up, start a fresh
session and point it at this file.
