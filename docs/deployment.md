# Mio Production Deployment

This guide turns Mio into a deployable OpenAI-compatible companion endpoint for
WeChat/OpenClaw, ChatGPT-like clients, OpenAI SDK clients, and OneBot/QQ.

## Production Checklist

Required:

- Set exactly one model provider key, for example `MINIMAX_API_KEY`.
- Set `MIO_PROVIDER` to that provider, or keep `auto`.
- Set `MIO_AUTH_TOKEN`. Do not expose `/v1/*` publicly without it.
- Persist `MIO_DIR` on disk or a Docker volume.
- Use a reverse proxy with HTTPS for public access.
- Set `MIO_CORS_ORIGIN` only for browser clients that need cross-origin access.

Recommended:

- Use `MIO_LOG_FORMAT=json` for production log collectors.
- Use `MIO_LOG_FILE=/var/log/mio/mio.log` only when not relying on stdout or
  journald.
- Keep Mio bound to `127.0.0.1` behind a local reverse proxy. Use `0.0.0.0`
  only inside Docker or on a protected network.

## Environment

Copy `.env.example` and set the production values:

```bash
MIO_PROVIDER=minimax
MINIMAX_API_KEY=sk-cp-...

MIO_HTTP_HOST=127.0.0.1
MIO_HTTP_PORT=3000
MIO_AUTH_TOKEN=replace-with-a-long-random-token
MIO_DIR=/var/lib/mio

# Only needed for browser clients on another origin.
MIO_CORS_ORIGIN=https://chat.example.com,http://localhost:5173

MIO_LOG_LEVEL=info
MIO_LOG_FORMAT=json
# MIO_LOG_FILE=/var/log/mio/mio.log
```

Generate a token:

```bash
node -e "console.log(crypto.randomUUID() + crypto.randomUUID())"
```

## Docker Compose

The repository includes `Dockerfile` and `docker-compose.yml`.

```bash
cp .env.example .env
# edit .env
docker compose up -d --build mio
docker compose ps
curl http://127.0.0.1:3000/health
```

If Docker builds slowly because the default npm registry is unreachable, use a
registry mirror for the build step. The compose file passes `NPM_REGISTRY` into
the Docker build and uses host networking for dependency downloads. The
Dockerfile clears proxy environment variables for `npm ci`, so a host proxy that
is not reachable from Docker will not break dependency installation:

```bash
NPM_REGISTRY=https://registry.npmmirror.com docker compose build mio
docker compose up -d mio
```

If a previous build already populated the BuildKit npm cache but the registry is
still unstable, force npm to use the cache:

```bash
NPM_CI_MODE=--offline docker compose build mio
```

The image exposes port `3000`, sets `MIO_HTTP_HOST=0.0.0.0`, persists
`/app/data`, and includes a Docker `HEALTHCHECK` for `/health`.

Useful commands:

```bash
docker compose logs -f mio
docker compose exec mio node dist/index.js status
docker compose down
```

## systemd

Install the app:

```bash
sudo mkdir -p /opt/mio /etc/mio /var/lib/mio
sudo chown -R "$USER":"$USER" /opt/mio /var/lib/mio
rsync -a --exclude node_modules ./ /opt/mio/
cd /opt/mio
npm ci
npm run build
```

Create `/etc/mio/mio.env`:

```bash
MIO_PROVIDER=minimax
MINIMAX_API_KEY=sk-cp-...
MIO_HTTP_HOST=127.0.0.1
MIO_HTTP_PORT=3000
MIO_AUTH_TOKEN=replace-with-a-long-random-token
MIO_DIR=/var/lib/mio
MIO_LOG_LEVEL=info
MIO_LOG_FORMAT=json
```

Install the service:

```bash
sudo cp /opt/mio/deploy/mio.service.example /etc/systemd/system/mio.service
sudo systemctl daemon-reload
sudo systemctl enable --now mio
systemctl status mio
journalctl -u mio -f
```

## Reverse Proxy

Use HTTPS when exposing Mio outside localhost. Example files:

- `deploy/nginx.conf.example`
- `deploy/Caddyfile.example`

Nginx:

```bash
sudo cp deploy/nginx.conf.example /etc/nginx/conf.d/mio.conf
sudo nginx -t
sudo systemctl reload nginx
```

Caddy:

```bash
sudo cp deploy/Caddyfile.example /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

SSE endpoints need buffering disabled or long read timeouts:

- `POST /chat/stream`
- `POST /v1/chat/completions` with `stream: true`

WebSocket needs upgrade forwarding:

- `WS /ws`

## CORS

Server-to-server gateways do not need CORS. Browser-based ChatGPT-like clients
do. Mio only emits CORS headers when `MIO_CORS_ORIGIN` is set.

Examples:

```bash
# One browser client:
MIO_CORS_ORIGIN=https://chat.example.com

# Multiple local/dev clients:
MIO_CORS_ORIGIN=http://localhost:5173,http://127.0.0.1:3001

# Public API clients. Use only with MIO_AUTH_TOKEN.
MIO_CORS_ORIGIN=*
```

Mio allows and exposes the headers used by OpenAI-compatible gateways:

- Request: `Authorization`, `Content-Type`, `X-Mio-Session-Id`,
  `X-OpenAI-Session-Id`, `X-OpenClaw-Session-Id`, `X-OpenClaw-User-Id`,
  `X-WeChat-User-Id`, `X-OneBot-User-Id`
- Response: `X-Mio-Session-Id`

## Health and Logs

Health:

```bash
curl http://127.0.0.1:3000/health
curl -H "Authorization: Bearer $MIO_AUTH_TOKEN" http://127.0.0.1:3000/v1/models
```

Expected `/health`:

```json
{ "ok": true, "name": "mio", "version": "0.6.0" }
```

Logs:

```bash
MIO_LOG_LEVEL=info
MIO_LOG_FORMAT=json
MIO_LOG_FILE=/var/log/mio/mio.log
```

For Docker, prefer stdout:

```bash
docker compose logs -f mio
```

For systemd:

```bash
journalctl -u mio -f
```

## Public Access Safety

- Always set `MIO_AUTH_TOKEN`.
- Put Mio behind HTTPS.
- Do not publish provider API keys in client config. Clients only receive
  `MIO_AUTH_TOKEN`, which authenticates to your Mio instance.
- Keep rate limiting enabled. Tune `MIO_RATE_LIMIT_MAX` and
  `MIO_RATE_LIMIT_WINDOW_MS` for shared gateways.
- Keep `MIO_CORS_ORIGIN` narrow unless the endpoint is intentionally public.
- Back up `MIO_DIR`; it contains transcripts, memory, relationship state, and
  user-specific data.

## Deployment Verification

Run before pointing a real client at Mio:

```bash
npm run typecheck
npm test
npm run test:e2e

curl -s http://127.0.0.1:3000/health
curl -s http://127.0.0.1:3000/v1/models \
  -H "Authorization: Bearer $MIO_AUTH_TOKEN"
curl -N http://127.0.0.1:3000/v1/chat/completions \
  -H "Authorization: Bearer $MIO_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"mio","stream":true,"messages":[{"role":"user","content":"ping"}]}'
```
