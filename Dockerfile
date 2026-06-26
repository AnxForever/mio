# ─── Build stage ───
FROM node:22-alpine AS builder

WORKDIR /app

# Install deps (with cache layer)
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

# Copy source and build
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ─── Production stage ───
FROM node:22-alpine

# Runtime deps: ffmpeg for voice recording (optional)
RUN apk add --no-cache ffmpeg sox tini

WORKDIR /app

# Copy built artifacts + production deps
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts

COPY --from=builder /app/dist/ ./dist/

# Data volume
VOLUME ["/app/data"]

# Use tini as init to reap zombie processes
ENTRYPOINT ["/sbin/tini", "--"]

# Default: start the HTTP server
EXPOSE 3000
ENV NODE_ENV=production
ENV MIO_HTTP_PORT=3000

CMD ["node", "dist/index.js", "serve"]
