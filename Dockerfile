# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates python3 make g++ \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare pnpm@11.18.0 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile

FROM base AS build
# pnpm prune refuses to purge node_modules without a TTY unless CI is set
ENV CI=true
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/apps/server/node_modules ./apps/server/node_modules
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.json vite.config.ts ./
COPY apps ./apps
RUN pnpm install --frozen-lockfile \
  && pnpm --filter web build \
  && pnpm --filter server build \
  && pnpm prune --prod

FROM node:22-bookworm-slim AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    WEB_DIST=/app/apps/web/dist

COPY --from=build /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/server/package.json ./apps/server/
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=build /app/apps/web/dist ./apps/web/dist

RUN mkdir -p /data && chown -R node:node /data
VOLUME ["/data"]
EXPOSE 8080

# Run as non-root when /data is writable; compose volume may need host perms
USER node
CMD ["node", "apps/server/dist/index.mjs"]
