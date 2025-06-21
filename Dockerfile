# Multi-stage Dockerfile for production
FROM oven/bun:1.1-alpine AS base

# Install dependencies
FROM base AS deps
WORKDIR /app
COPY package.json bun.lockb ./
COPY packages/*/package.json ./packages/
RUN bun install --frozen-lockfile --production=false

# Build stage
FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client
RUN cd packages/database && bun run generate

# Build application
RUN bun build apps/api/src/index.ts \
  --target=bun \
  --outdir=dist \
  --minify

# Production stage
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy necessary files
COPY --from=build --chown=nodejs:nodejs /app/dist ./dist
COPY --from=build --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nodejs:nodejs /app/packages/database/generated ./packages/database/generated
COPY --from=build --chown=nodejs:nodejs /app/packages/database/prisma ./prisma

# Copy package files
COPY --chown=nodejs:nodejs package.json ./
COPY --chown=nodejs:nodejs packages/database/package.json ./packages/database/
COPY --chown=nodejs:nodejs packages/shared/package.json ./packages/shared/
COPY --chown=nodejs:nodejs apps/api/package.json ./apps/api/

USER nodejs

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["bun", "run", "dist/index.js"]