# syntax=docker/dockerfile:1.7

# ─── Build stage ───
FROM node:22-alpine AS builder

WORKDIR /app
ARG NPM_REGISTRY=""
ARG NPM_CI_MODE="--prefer-offline"
RUN if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi

# Install deps (with cache layer)
COPY package.json package-lock.json ./
COPY packages/emotion/package.json packages/emotion/
COPY packages/idrag/package.json packages/idrag/
RUN --mount=type=cache,target=/root/.npm \
  HTTP_PROXY= HTTPS_PROXY= http_proxy= https_proxy= \
  NO_PROXY=registry.npmjs.org,registry.npmmirror.com,localhost,127.0.0.1 \
  NODE_OPTIONS=--dns-result-order=ipv4first \
  npm ci --ignore-scripts --no-audit --no-fund ${NPM_CI_MODE} --loglevel=info \
    --fetch-timeout=120000 --fetch-retries=4 \
    --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000 \
    --maxsockets=3

# Copy source and build
COPY tsconfig.json .
COPY packages/ packages/
COPY src/ src/
RUN npm run build
RUN npm prune --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=warn

# ─── Production stage ───
FROM node:22-alpine

WORKDIR /app
ARG NPM_REGISTRY=""
RUN if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi

# Copy built artifacts + pruned production deps
COPY package.json package-lock.json ./
COPY packages/emotion/package.json packages/emotion/
COPY packages/idrag/package.json packages/idrag/
COPY --from=builder /app/node_modules/ ./node_modules/

COPY --from=builder /app/dist/ ./dist/
COPY --from=builder /app/packages/ ./packages/

# Static assets
COPY web/ ./web/
COPY mods/ ./mods/

# Data volume
VOLUME ["/app/data"]

EXPOSE 3000
ENV NODE_ENV=production
ENV MIO_HTTP_PORT=3000
ENV MIO_HTTP_HOST=0.0.0.0

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.MIO_HTTP_PORT || '3000') + '/health').then(r=>r.json()).then(j=>j.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js", "serve"]
