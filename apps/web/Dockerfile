# Build context: repository root (see docker-compose.yml).
FROM docker.io/library/node:26-slim AS build
RUN npm install -g pnpm@12.11.2
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/brand/package.json packages/brand/
COPY packages/ui/package.json packages/ui/
RUN pnpm install --frozen-lockfile --filter @nora/web...
COPY packages packages
COPY apps/web apps/web
# Rewrites to the API are resolved at build time.
ARG API_INTERNAL_URL=http://api:4000
ENV API_INTERNAL_URL=$API_INTERNAL_URL NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @nora/web build

FROM docker.io/library/node:26-slim AS runtime
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
