# syntax=docker/dockerfile:1.7
# API image (also used by the one-shot `migrate` service). Build context = repository root:
#   docker build -f apps/api/Dockerfile -t ghcr.io/mhamad-raad/pallet-api:<sha> .

FROM node:24.21.0-bookworm-slim AS build
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true \
    CHECKPOINT_DISABLE=1
# openssl: required by the Prisma schema engine (migrate deploy).
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable
WORKDIR /repo

# 1) Fetch dependencies using only the lockfile (cached layer). The root package.json must be present so
#    Corepack uses the pinned `packageManager` (pnpm 10.34.5) instead of the latest pnpm.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch --frozen-lockfile

# 2) Install + build @pallet/api and its workspace dependencies (@pallet/shared).
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --offline --frozen-lockfile --filter "@pallet/api..."
RUN pnpm --filter "@pallet/api..." build

# 3) Produce a self-contained production bundle (dist, prisma/, prisma.config.ts, prod node_modules).
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @pallet/api deploy --legacy --prod /out

FROM node:24.21.0-bookworm-slim AS runtime
ENV NODE_ENV=production \
    CHECKPOINT_DISABLE=1 \
    PRISMA_HIDE_UPDATE_MESSAGE=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /data/uploads \
 && chown node:node /data/uploads
WORKDIR /app
# Application files stay root-owned (read-only for the `node` user); only /data/uploads is writable.
COPY --from=build /out /app
USER node
EXPOSE 3000
CMD ["node", "--enable-source-maps", "dist/main.js"]
