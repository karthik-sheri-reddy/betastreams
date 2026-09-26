# betastreams

A Stremio add-on that matches IPTV channels (M3U/XMLTV and Xtream Codes
sources) to live/upcoming sporting events from the public ESPN API, scores
the match confidence, and ranks each event's streams by how likely they are
to actually be showing it. Personal/household use only — see `PROGRESS.md`
for the full design spec and build log.

**Status:** Phase 1 (scaffold + deploy skeleton) complete. See
`PROGRESS.md` for what's done, what's next, and the handoff notes.

## Architecture

One container, two processes (`src/entrypoint.ts`):

- **server** (Fastify) — read-only against SQLite. Serves the add-on
  routes, configure/admin sites, and stream redirects. Never runs matching
  on the request path.
- **worker** (`child_process.fork`, `src/worker/index.ts`) — owns all
  writes: ingest, matching, scoring, on schedules. Crashes restart with
  exponential backoff; the server keeps serving the last good data
  meanwhile.

Storage is SQLite (`better-sqlite3`, WAL mode) at `/data/app.db`. See
`src/shared/db/` for the migration runner and `src/shared/db/migrations/`
for schema changes.

## Local development

```bash
npm install
npm --prefix web install

npm run build:web   # builds web/dist (placeholder until Phase 6)
npm run dev:server  # tsx watch on src/entrypoint.ts, reads .env
```

Copy `.env.example` to `.env` first and fill in `PUBLIC_BASE_URL` at least
(defaults to `http://localhost:7000`). `DATA_DIR` defaults to `/data`; for
local dev point it somewhere writable, e.g. `DATA_DIR=./data`.

```bash
npm run lint
npm run typecheck
npm test
```

## Docker

```bash
docker build -t betastreams .
docker run --rm -p 7000:7000 -e PUBLIC_BASE_URL=http://localhost:7000 \
  -v betastreams-data:/data betastreams
curl http://localhost:7000/health
```

Pass `--build-arg ENABLE_OCR=true` to also install `tesseract-ocr` in the
image (Phase 9, off by default).

## Deploying: Coolify + DuckDNS

### 1. DuckDNS

1. Create a subdomain at [duckdns.org](https://www.duckdns.org) and point
   it at your server's public IPv4.
2. If your IP is dynamic, add a cron job on the host (not in this repo) to
   refresh it every 5 minutes:
   ```bash
   */5 * * * * curl -s "https://www.duckdns.org/update?domains=SUBDOMAIN&token=TOKEN&ip=" >/dev/null 2>&1
   ```
   Keep the token out of the repo — it's a host-level cron job, not an app
   env var.
3. Make sure ports 80 and 443 are open on the server firewall so Coolify's
   proxy can complete Let's Encrypt HTTP-01 validation.

### 2. Coolify

1. Coolify → Project → **+ New → Application** → your private GitHub repo
   (via the GitHub App) → Build Pack **Docker Compose**, compose path
   `docker-compose.yml`.
2. In the `app` service's **Domains** field, enter
   `https://SUBDOMAIN.duckdns.org:7000`. The `:7000` tells Coolify's proxy
   which container port to route to; the public URL still serves on 443.
   Coolify issues and renews the Let's Encrypt certificate automatically.
3. Set environment variables in Coolify's **Environment Variables** tab
   (see `.env.example` for the full list). Mark `ADMIN_TOKEN`,
   `SIGNING_SECRET`, `XTREAM_ACCOUNTS`, and any source URLs/credentials as
   **secret**. Set `PUBLIC_BASE_URL=https://SUBDOMAIN.duckdns.org`.
4. Confirm the `appdata` named volume appears under **Persistent Storage**
   (holds the SQLite DB, cached logos/posters, overrides, and backups).
5. Enable **auto-deploy on push**.
6. Deploy. Verify over HTTPS:
   - `https://SUBDOMAIN.duckdns.org/health`
   - `https://SUBDOMAIN.duckdns.org/configure` (Phase 6+)
   - `https://SUBDOMAIN.duckdns.org/manifest.json` (Phase 6+)
7. Install the add-on in Stremio desktop and Stremio Web once the
   manifest route exists (Phase 6).

### Recommended server

2 vCPU, 2–4 GB RAM.

## Environment variables

See `.env.example` for the full annotated list. Never commit real values —
set them in Coolify (marked secret where noted) or a local, gitignored
`.env`.

## Operations

- **Health:** `GET /health` returns `{status, uptimeSeconds, dataVersion,
  timestamp}`. The Docker `HEALTHCHECK` polls it every 30s.
- **Graceful shutdown:** on `SIGTERM`/`SIGINT` the server stops the worker,
  finishes in-flight requests, and closes the DB before exiting.
- **Backups:** nightly SQLite backup to `/data/backups`, keeping 7 copies
  — arrives in Phase 10.
- **Logs:** structured JSON to stdout, collected by Coolify.

## Repo layout

```
src/
  entrypoint.ts   # forks the worker, starts the Fastify server
  server/         # read-only HTTP layer (routes, add-on, configure/admin)
  worker/         # ingest, matching, scoring (writes SQLite)
  shared/         # db access, config, logger — used by both processes
web/              # Vite-built static configure/admin site
config/           # categories.yaml, scoring.yaml, aliases.yaml (Phase 2+)
data/             # local dev SQLite + backups (gitignored, except .gitkeep)
```

## Contributing / adding aliases and categories

Documented once Phase 2 (`config/categories.yaml`) and Phase 3
(`data/aliases.yaml`) land.
