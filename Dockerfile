# ─── Build stage ───
FROM node:22-alpine AS builder

WORKDIR /app

# Install deps (with cache layer)
COPY package.json package-lock.json ./
COPY packages/emotion/package.json packages/emotion/
COPY packages/idrag/package.json packages/idrag/
RUN npm ci --ignore-scripts

# Copy source and build
COPY tsconfig.json .
COPY packages/ packages/
COPY src/ src/
RUN npm run build

# ─── Production stage ───
FROM node:22-alpine

# Runtime deps: ffmpeg for voice (optional)
RUN apk add --no-cache ffmpeg sox tini

WORKDIR /app

# Copy built artifacts + production deps
COPY package.json package-lock.json ./
COPY packages/emotion/package.json packages/emotion/
COPY packages/idrag/package.json packages/idrag/
RUN npm ci --omit=dev --ignore-scripts

COPY --from=builder /app/dist/ ./dist/
COPY --from=builder /app/packages/ ./packages/

# Static assets
COPY web/ ./web/
COPY mods/ ./mods/

# Data volume
VOLUME ["/app/data"]

# Use tini as init
ENTRYPOINT ["/sbin/tini", "--"]

EXPOSE 3000
ENV NODE_ENV=production
ENV MIO_HTTP_PORT=3000

CMD ["node", "dist/index.js", "serve"]
