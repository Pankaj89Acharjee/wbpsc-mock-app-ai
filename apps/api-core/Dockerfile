# ============================================================================
# Stage 1: Dependencies & Build (Node.js 22 Alpine)
# Context: Run from monorepo root: `docker build -f apps/api-core/Dockerfile .`
# ============================================================================
FROM node:22-alpine AS builder

WORKDIR /workspace

# Install libc6-compat for Alpine native bindings
RUN apk add --no-cache libc6-compat

# Copy root workspace manifests and target packages
COPY package.json ./
COPY pnpm-workspace.yaml ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY apps/api-core/package.json ./apps/api-core/

# Install dependencies across workspaces
# --legacy-peer-deps: vite 8 prefers a newer esbuild than drizzle-kit pins (harmless)
RUN npm install --no-audit --no-fund --legacy-peer-deps

# Copy source code for shared-types and api-core
COPY packages/shared-types ./packages/shared-types
COPY apps/api-core ./apps/api-core

# Bundle api-core into a single ESM file
WORKDIR /workspace/apps/api-core
RUN npm run build

# ============================================================================
# Stage 2: Production Runner (stateless container)
# ============================================================================
FROM node:22-alpine AS runner

WORKDIR /app

# Create non-root user for security hardening
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 fastify

ENV NODE_ENV=production
ENV PORT=8080

# Copy only the bundled server and production node_modules needed by postgres driver
COPY --from=builder --chown=fastify:nodejs /workspace/node_modules ./node_modules
COPY --from=builder --chown=fastify:nodejs /workspace/apps/api-core/dist ./dist
# Hand-written SQL migrations (applied with DB_MIGRATE_ON_START=true, see src/db/migrate.ts)
COPY --from=builder --chown=fastify:nodejs /workspace/apps/api-core/migrations ./migrations
COPY --from=builder --chown=fastify:nodejs /workspace/apps/api-core/package.json ./package.json

USER fastify

EXPOSE 8080

CMD ["node", "dist/server.js"]
