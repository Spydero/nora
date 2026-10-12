# Build context: repository root (see docker-compose.yml).
FROM docker.io/library/node:26-slim AS base
RUN npm install -g pnpm@12.11.2 && apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /repo

FROM base AS build
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @nora/api...
COPY apps/api apps/api
# prisma.config.ts requires DATABASE_URL to be defined; generation does not connect.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build pnpm --filter @nora/api build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build --chown=node:node /repo /repo
WORKDIR /repo/apps/api
USER node
EXPOSE 4000
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node dist/main.js"]
