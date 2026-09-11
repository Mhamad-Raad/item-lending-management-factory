# syntax=docker/dockerfile:1.7
# Builds the web app and bakes it into the Caddy image. Build context = repository root:
#   docker build -f deploy/caddy/Dockerfile -t ghcr.io/mhamad-raad/pallet-caddy:<sha> .

FROM node:24.21.0-bookworm-slim AS build
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true
RUN corepack enable
WORKDIR /repo

# 1) Fetch dependencies using only the lockfile (cached layer). The root package.json must be present so
#    Corepack uses the pinned `packageManager` (pnpm 10.34.5) instead of the latest pnpm.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch --frozen-lockfile

# 2) Install and build @pallet/web and its workspace dependencies (@pallet/shared).
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --offline --frozen-lockfile --filter "@pallet/web..."
RUN pnpm --filter "@pallet/web..." build

FROM caddy:2.11.4-alpine AS runtime
COPY deploy/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /srv
