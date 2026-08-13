# Build context is the repository root, not apps/api.
#
# The API imports @alarm/types and @alarm/core as workspace packages, so the
# build needs those sources and the root lockfile. Building from apps/api would
# leave both unresolvable.
#
#   docker build -f apps/api/Dockerfile -t dynamic-alarm-api .

# ---------------------------------------------------------------------------
# Builder: install, compile the shared packages, then the API.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app

# Manifests first, so a source-only change reuses the cached install layer.
COPY package.json package-lock.json ./
COPY packages/types/package.json ./packages/types/
COPY packages/core/package.json ./packages/core/
COPY apps/api/package.json ./apps/api/

# Only the three workspaces the server needs. apps/mobile is a React Native app
# whose dependencies are an order of magnitude larger and are never imported
# here; installing them would cost minutes per build for nothing.
RUN npm ci \
    --include-workspace-root \
    --workspace=@alarm/types \
    --workspace=@alarm/core \
    --workspace=@alarm/api

COPY tsconfig.base.json ./
COPY packages/ ./packages/
COPY apps/api/ ./apps/api/

# In order: the API's tsconfig resolves the shared packages through their built
# dist/, so they have to exist first.
RUN npm run build --workspace=@alarm/types \
    && npm run build --workspace=@alarm/core \
    && npm run build --workspace=@alarm/api

# Leaves the workspace symlinks intact, since those are runtime dependencies.
RUN npm prune --omit=dev

# ---------------------------------------------------------------------------
# Runtime: the compiled output, production dependencies, nothing else.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS production
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

RUN addgroup -g 1001 -S nodejs && adduser -S api -u 1001 -G nodejs

# The workspace layout is kept rather than flattened into node_modules. The
# symlinks npm created (node_modules/@alarm/* to packages/*) then resolve
# exactly as they do in development, so the image runs the same module graph
# that was tested.
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/types/package.json ./packages/types/
COPY --from=builder /app/packages/types/dist ./packages/types/dist
COPY --from=builder /app/packages/core/package.json ./packages/core/
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/apps/api/dist ./apps/api/dist

RUN chown -R api:nodejs /app
USER api

WORKDIR /app/apps/api
EXPOSE 3000

# 127.0.0.1, never localhost. BusyBox wget resolves localhost to ::1 first, and
# a Node process bound to 0.0.0.0 is IPv4 only, so it refuses the connection and
# the container reports unhealthy while serving traffic perfectly.
#
# The path is /api/v1/health because every route in this API is declared
# absolute in @alarm/types, health included.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/api/v1/health || exit 1

# The container is the process manager. No PM2, no supervisor.
CMD ["node", "dist/index.js"]
