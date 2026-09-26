# syntax=docker/dockerfile:1

# ---- deps: install full node_modules (incl. devDeps) for building ----
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY web/package.json web/package-lock.json* ./web/
RUN npm --prefix web install

# ---- build: compile TS and build the static configure/admin site ----
FROM deps AS build
WORKDIR /app
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
COPY web ./web
RUN npm run build:web

# ---- prod-deps: production-only node_modules for the runtime image ----
FROM node:22-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# ---- runtime ----
FROM node:22-slim AS runtime
ARG ENABLE_OCR=false

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && if [ "$ENABLE_OCR" = "true" ]; then apt-get install -y --no-install-recommends tesseract-ocr; fi \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --system betastreams && useradd --system --gid betastreams --create-home betastreams

WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/web/dist ./web/dist
COPY package.json ./
COPY config ./config
# data/aliases.yaml and data/stations.yaml are versioned seed config
# (RSN rebrand chains, a starting station table) read at startup — see
# PROGRESS.md for why this differs from the runtime-only /data volume
# despite the similar name.
COPY data/aliases.yaml data/stations.yaml ./data/

RUN mkdir -p /data /data/backups /data/logos /data/posters && chown -R betastreams:betastreams /data /app

USER betastreams
ENV NODE_ENV=production
ENV DATA_DIR=/data
EXPOSE 7000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:7000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/entrypoint.js"]
