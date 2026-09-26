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

## Next: Phase 2 — Ingest

Per §15 #2: `ChannelSource`/`EpgSource` interfaces (§2.1), M3U + XMLTV
adapter, Xtream Codes adapter (account check, category pre-filter, live
streams, `xmltv.php` guide, short-EPG fallback), iptv-org loader, ESPN
client with adaptive polling (§9), `categories.yaml` with every ESPN path
verified live per §3.

**First concrete steps when Phase 2 starts:**

1. Decide on Phase 2's fixture strategy given the open question above: use
   real operator sources if provided by then, otherwise build a small
   synthetic M3U+XMLTV fixture and a credential-scrubbed fake Xtream
   `player_api.php`/`get_live_streams`/`xmltv.php` response set under
   `fixtures/` or `test/fixtures/`.
2. Add the `ChannelSource`/`EpgSource` TypeScript interfaces to
   `src/shared/` (they're consumed by both adapters and, later, Stage A —
   keep them source-agnostic per §2.1).
3. Build the credential-redaction helper and its test *first* (§14 — "add
   a test that fails if a credential string shows up in captured log
   output"), since the Xtream adapter must use it from the start rather
   than have it bolted on after.
4. Add `config/categories.yaml` and write the "verify every ESPN path
   against a live request at build time" checker script early, since it
   gates which league paths Phase 2's ESPN client is allowed to poll.
5. New migrations for `sources`, `channels`/`streams`, `programmes` tables
   (append-only numbered `.sql` files; don't touch `0001_init.sql`).

**How to run what exists today:**

```bash
npm install && npm --prefix web install
npm run build:web
npm run dev:server   # http://localhost:7000/health
```

or

```bash
docker build -t betastreams .   # needs real internet access for apt-get ffmpeg
docker run --rm -p 7000:7000 -v betastreams-data:/data betastreams
```

**Open issues carried into Phase 2:** none blocking; see Open Questions
above for the non-blocking ones.

If context is getting long when you pick this back up, start a fresh
session and point it at this file.
