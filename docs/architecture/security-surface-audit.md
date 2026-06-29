# Security Surface Audit

Source documents:

- `docs/architecture/adr/0002-localhost-first-security-model.md`
- `docs/architecture/risk-priority-backlog.md`
- `docs/architecture/pre-code-test-checklist.md`
- `src/server/index.ts`
- `src/server/auth.ts`
- `src/server/rate-limit.ts`
- `src/validation.ts`
- `src/core/tool-runtime.ts`
- `src/tools/file.ts`
- `web/js/auth.js`
- `web/js/api.js`
- `web/js/store.js`
- `web/vite.config.js`
- `web/sw.js`

Purpose: classify Mio's exposed surfaces and identify which security claims are safe. This is a read-only audit and does not modify code.

## Executive Verdict

Mio has an acceptable security posture for a localhost-first personal agent:

- Default bind host is `127.0.0.1`.
- Bearer auth exists and is applied to most sensitive native routes when `MIO_AUTH_TOKEN` or `config.authToken` is set.
- OpenAI-compatible auth has direct tests.
- WebSocket upgrade validates `?token=` when auth is enabled.
- API inputs use Zod schemas.
- Uploads have size/type constraints and upload-directory checks.
- CORS is not open unless explicitly configured.
- External IM sessions get restricted tools and isolated memory behavior.

It should not be described as internet-hardened by default:

- Auth is optional.
- Several routes are intentionally public.
- Onboarding has unauthenticated write routes.
- Frontend token validation uses public `/status`.
- Native-route auth lacks direct test coverage.
- WS token is passed in the query string.
- Streaming and WS client disconnects do not cancel `runTurn`.
- Notification sends use direct `fetch` without the provider HTTP timeout/retry wrapper.

## Threat Model

Default supported threat model:

- Single-user local machine.
- Browser UI or local clients on loopback.
- Optional local bridge integrations.
- User controls the local environment and provider keys.

Changed threat model:

- Binding to `0.0.0.0`, LAN, tunnel, reverse proxy, public domain, or mobile remote access.
- Shared machine or untrusted local network.
- Third-party gateway posting into OpenAI-compatible or OneBot endpoints.

Under the changed threat model, `MIO_AUTH_TOKEN` should be mandatory and public routes need explicit review.

## Surface Inventory

| Surface | Routes / files | Auth state | Security controls | Residual risk |
|---|---|---|---|---|
| Static web UI | `express.static(webDir)`, `/`, `web/index.html` | Public | Static files only; API calls carry bearer token from frontend when present. | Public UI is fine, but service worker precache can drift. |
| Health | `GET /health` | Public | Minimal liveness payload. Rate limit skipped. | Acceptable public route. |
| Status | `GET /status` | Public | Does not expose provider keys. | Exposes config summary, provider availability, emotion, relationship, progress, embedding stats. Frontend uses it as auth validation even though it is public. |
| Avatar state | `GET /avatar/state` | Public | Read-only derived avatar state. | Exposes emotion/relationship-derived state under remote exposure. |
| Voice capabilities | `GET /voice/capabilities` | Public | Read-only local capability check. | Low risk. |
| Onboarding | `GET /onboarding/status`, `POST /onboarding/start`, `POST /onboarding/next` | Public | Zod body validation on `next`; intended before config exists. | Public write/setup flow is acceptable only for local first-run. It needs remote-binding policy. |
| Native chat | `POST /chat`, `POST /chat/stream` | `requireAuth` | Zod body validation; text length checks; upload path root checks; SSE response headers. | No client-disconnect cancellation. Native auth needs direct tests. |
| Uploads | `POST /uploads/images`, `POST /uploads/audio`, `POST /voice/transcribe` | `requireAuth` | Size caps; image magic-byte detection; MIME enum; random filenames; path helpers. | Audio relies on declared MIME rather than magic-byte detection. Auth is optional if no token is configured. |
| OpenAI-compatible bridge | `GET /v1/models`, `POST /v1/chat/completions` | `requireOpenAIAuth` | OpenAI error envelope; body schema; text length; session normalization; optional strict session requirement; direct auth tests. | Streaming lacks disconnect cancellation. Provider/gateway headers affect session/channel context and need stable tests. |
| OneBot bridge | `GET /onebot/v11/status`, `POST /onebot/v11/events` | `requireAuth` | Zod body schema; session mapping; group skip/reply necessity behavior. | Depends on shared bearer token. Route auth needs native test matrix. |
| WebSocket | `WS /ws` | `validateWsAuth` when token configured | Upgrade-time token check; JSON schema for messages; heartbeat; restricted message types. | Token in query string can leak through logs/history. No per-message auth renewal. No cancellation for in-flight `runTurn` after disconnect. |
| Mod and soul editing | `POST /mod`, `GET/PUT /mods/:name/soul` | `requireAuth` | Param regex; mod validity check; soul length cap; safe path helper. | Powerful because it changes persona source. Needs native auth tests before remote use. |
| Persona Studio | `POST /persona/generate`, `POST /persona/save`, `GET/POST /persona/mode` | `requireAuth` | Body validation; path through `modSoulPath`; activation via mod manager. | Writes persona files; depends on auth policy. |
| Admin backup/export | `GET /admin/backups`, `POST /admin/backup`, `GET /admin/export`, `POST /admin/backups/prune` | `requireAuth` | Export uses attachment response; prune validates range. | High-sensitivity memory export; native auth tests are mandatory before any remote exposure. |
| Admin log level | `GET /admin/log-level` | Public | Read-only logger level. | Should be explicitly classified or protected for consistency. |
| Analytics | `/analytics*` | `requireAuth` | Query validation for emotion days. | Sensitive behavioral data; auth policy must be enforced in remote mode. |
| Memory review and search | `GET /memories`, `PATCH/DELETE /memories/:id`, `GET /search` | `requireAuth` | Query/body/param validation; memory ids hex-limited; search has query/limit validation. | Search can include memory as well as transcripts. Broad private data exposure if auth disabled under non-localhost binding. |
| Proactive preferences | `GET/POST /proactive/preferences` | `requireAuth` | Body validation and bounded numeric ranges. | Behavioral preference changes depend on auth. |
| Notifications | `GET /notify/channels`, `POST /notify/test*` | `requireAuth` | Channel config avoids returning raw tokens; webhook URLs are sanitized for display. | External sends use direct `fetch` with no shared timeout/retry. Test endpoints can trigger outbound messages. |
| Character management | `POST /character/create`, `GET /characters`, `POST/DELETE /character/:name`, `GET /character/:name/life` | `requireAuth` | Some param validation; character schema validation for create. | Character create schema is looser than persona name schema. These routes mutate local identity/persona state. |
| Tools in normal sessions | `src/tools/*` | Model-mediated, local trusted session | File path allowlist under data dir and cwd; restricted read-only bash command list; persona allowlist support. | Normal sessions can read/write/edit files under cwd/data. This is a trusted-local agent capability, not a sandbox. |
| Tools in isolated IM sessions | `src/core/tool-runtime.ts` | Model-mediated, isolated bridge sessions | Only `current_time` is exposed; forbidden tool calls return errors. | Stronger privacy boundary than normal sessions, supported by tests. |
| Frontend token storage | `web/js/store.js`, `web/js/api.js`, `web/js/auth.js` | Browser localStorage | Authorization header attached when token exists; request timeout in frontend client. | Token stored in `localStorage`; invalid token is checked against public `/status`, so wrong tokens may appear accepted until protected API use. |
| Vite dev proxy | `web/vite.config.js` | Dev-only | Proxy includes `/ws` and several API prefixes. | Proxy list misses several actual frontend API paths such as `/chat`, `/mod`, `/uploads`, `/voice`, `/persona`, `/mods`, `/character`, `/characters`. |
| Service worker | `web/sw.js` | Browser cache | Excludes dynamic API prefixes from cache handling. | Precache list is hardcoded and documented as requiring manual sync. |

## Positive Controls

### Bearer Auth

Evidence:

- `src/server/auth.ts` resolves `MIO_AUTH_TOKEN` first and `config.authToken` second.
- `checkBearerAuth` returns structured failures for missing, malformed, and wrong tokens.
- `requireAuth` wraps native routes.
- `requireOpenAIAuth` returns OpenAI-style authentication errors.
- `validateWsAuth` checks `?token=` during WS upgrade.

Assessment:

Good foundation for a single-user local agent. The main gap is not the middleware; it is deployment policy and test coverage across native routes.

### Input Validation

Evidence:

- `src/validation.ts` uses Zod schemas for native chat, OpenAI-compatible bodies, OneBot events, uploads, mod/persona/soul, memory review, proactive preferences, backup prune, search, analytics, character params, and WS messages.
- `src/server/index.ts` consistently applies `validate`, `validateParams`, and `validateQuery` to most non-trivial routes.

Assessment:

This is one of the stronger security controls in the codebase.

### Upload Constraints

Evidence:

- Image uploads are decoded from base64, capped, magic-byte checked, and random-named.
- Audio uploads are MIME-enum checked and size-capped.
- Chat only accepts `imagePath` and `audioPath` that resolve under upload directories.

Assessment:

Good local control. Audio content validation is weaker than image validation.

### IM Isolation

Evidence:

- `turn-session.ts` treats `openai-*` and `onebot-private/group-*` sessions as isolated.
- `tool-runtime.ts` restricts isolated sessions to `current_time`.
- Research found tests for IM isolation, directive isolation, and persona tool allowlist behavior.

Assessment:

This is a real privacy boundary and one of the stronger parts of the architecture.

### CORS

Evidence:

- CORS is only enabled when `MIO_CORS_ORIGIN` is set.
- Allowed origins are exact-match unless the variable is `*`.
- Authorization and bridge headers are listed in allowed headers.

Assessment:

Reasonable for local/proxy setups. For remote deployment, avoid `MIO_CORS_ORIGIN=*` with bearer-token clients unless the deployment threat model explicitly allows it.

### Rate Limiting

Evidence:

- `createRateLimiter` applies after static files and before API routes.
- Defaults: 30 requests per 60 seconds.
- Tracks by `X-Forwarded-For` first, then `req.ip`.
- Skips `GET /health`.

Assessment:

Useful single-process protection. It is not a distributed or trusted-proxy-aware rate limiter.

## Findings

### S-001: Optional Auth Under Non-Localhost Binding

Priority: P0

Evidence:

- `checkBearerAuth` returns success when no token is configured.
- Server logs `auth: disabled (no auth)` when no token exists.
- Bind host can be changed with `MIO_HTTP_HOST`.

Impact:

If the server is bound to LAN/public interfaces without `MIO_AUTH_TOKEN`, private memory, admin, chat, notification, persona, and analytics routes become accessible according to route public/protected behavior with auth disabled.

Recommendation:

- Require `MIO_AUTH_TOKEN` when binding beyond loopback, or fail startup.
- At minimum, log a high-severity warning and document the deployment policy.

### S-002: Frontend Validates Tokens Through Public `/status`

Priority: P0

Evidence:

- `web/js/auth.js` uses `api.get('/status')` in `checkAuth` and `tryLogin`.
- `GET /status` is public and does not call `requireAuth`.

Impact:

When auth is enabled, a wrong token can appear valid to the frontend until the user hits a protected route.

Recommendation:

- Add `GET /auth/check` protected by `requireAuth`, or validate frontend login against a protected low-impact endpoint.
- Add frontend auth-store tests.

### S-003: Native Route Auth Lacks Direct Test Matrix

Priority: P0

Evidence:

- OpenAI auth tests exist.
- Existing research did not find a native auth matrix for `/chat`, `/chat/stream`, `/admin/export`, `/mods/:name/soul`, `/notify/test`, `/memories`, or WS.

Impact:

Auth middleware may work, but route coverage is not proven. This blocks any strong external-security claim.

Recommendation:

- Implement the native auth matrix in `pre-code-test-checklist.md`.

### S-004: Public Onboarding Writes Are Local-Only Safe

Priority: P0 for remote binding, P2 for default local use

Evidence:

- `POST /onboarding/start` and `POST /onboarding/next` are intentionally unauthenticated.
- Comment says onboarding must be available before config exists.

Impact:

Under remote exposure, an unauthenticated party could participate in first-run setup or alter onboarding state.

Recommendation:

- Keep unauthenticated onboarding for loopback.
- Require a bootstrap token, one-time local confirmation, or loopback-only enforcement for non-localhost binding.

### S-005: Public `/status` Exposes Private State Summary

Priority: P1

Evidence:

- `/status` returns config summary, provider availability, active mod, embedding stats, emotion, relationship, and progress.

Impact:

No secrets are returned, but it exposes behavioral and configuration metadata. This is fine locally and risky remotely.

Recommendation:

- Split public liveness from private status, or protect status when auth is enabled.

### S-006: WS Token In Query String

Priority: P1

Evidence:

- Frontend builds WS URL as `/ws?token=<token>`.
- `validateWsAuth` reads query param.

Impact:

Query tokens can appear in browser history, reverse proxy logs, diagnostics, or server logs depending on deployment.

Recommendation:

- For browser compatibility, query-token auth may be acceptable locally.
- For remote deployment, prefer a short-lived WS ticket or authenticated HTTP bootstrap that returns a transient token.

### S-007: Streaming And WS Disconnects Do Not Cancel In-Flight Turns

Priority: P1

Evidence:

- `/chat/stream`, OpenAI streaming, and WS call `runTurn` with token callbacks.
- No `AbortSignal` is passed from client close/disconnect into `runTurn`.
- Provider HTTP supports caller abort, but the server/core path does not propagate it.

Impact:

Model/tool work can continue after the client has gone away. This is a resource and privacy/logging concern for long-running sessions.

Recommendation:

- Thread an `AbortSignal` through server routes, `runTurn`, providers, and tool execution policy.
- Add cancellation tests.

### S-008: Notification Sends Lack Shared Timeout/Retry

Priority: P1

Evidence:

- `src/server/notify.ts` uses direct `fetch` for Telegram, webhook, WhatsApp, Discord, Slack, and WeClaw.
- Provider calls use `fetchWithRetry`.

Impact:

Outbound notification requests can hang or behave inconsistently compared with provider calls. Test endpoints can also trigger outbound traffic.

Recommendation:

- Use a shared timeout wrapper or `AbortSignal.timeout`.
- Keep channel failures isolated and bounded.

### S-009: Normal Session File Tools Are Trusted-Local Capabilities

Priority: P1 for remote use, P2 for local use

Evidence:

- `src/tools/file.ts` registers read/write/edit/find/bash tools.
- Path access is restricted to data dir and current working directory.
- Bash is read-only command allowlisted and blocks shell composition.
- Isolated IM sessions are restricted to `current_time`.

Impact:

This is appropriate for a trusted local agent but should not be represented as a sandbox. If a remote attacker can drive a normal session, they can attempt model-mediated file operations within allowed directories.

Recommendation:

- Document normal sessions as trusted-local.
- Consider a feature flag to disable file tools for HTTP sessions under remote binding.

### S-010: Vite Proxy And Service Worker Drift Affect Security UX

Priority: P2 security, P1 developer experience

Evidence:

- `web/vite.config.js` proxy omits several frontend API paths.
- `web/sw.js` has a hardcoded asset list and comment warning it must be manually updated.

Impact:

This is not a direct exploit, but it can hide auth/API failures during development or cache stale UI that does not match backend security behavior.

Recommendation:

- Add static tests for frontend API path proxy coverage and service-worker manifest completeness.

## Public Route Classification

Recommended route classification:

| Route | Current state | Recommended policy |
|---|---|---|
| `/health` | Public | Keep public. |
| `/` and static assets | Public | Keep public. |
| `/status` | Public | Public only for localhost; protect or split for remote mode. |
| `/avatar/state` | Public | Public only for localhost; protect for remote mode if emotion privacy matters. |
| `/voice/capabilities` | Public | Keep public or protect with other private status. |
| `/onboarding/*` | Public | Loopback-only or bootstrap-protected under remote binding. |
| `/admin/log-level` | Public | Protect or explicitly document as public diagnostic. |
| All chat/admin/memory/analytics/persona/notify/character routes | Auth-gated when token exists | Require token for remote mode and add direct tests. |
| `/ws` | Query-token auth when token exists | Use local query-token mode; consider transient ticket for remote mode. |

## Security Claim Boundaries

Safe claims:

- "Mio is localhost-first and privacy-oriented."
- "Bearer auth is available for native, OpenAI-compatible, and WebSocket surfaces."
- "Most sensitive routes are protected when `MIO_AUTH_TOKEN` is configured."
- "Input validation is broad and centralized through Zod."
- "External IM sessions get restricted memory/tool behavior."

Claims requiring qualifiers:

- "Secure by default" should mean local-loopback default, not internet exposure.
- "Authenticated API" should specify "when `MIO_AUTH_TOKEN` is configured."
- "Private memory" should specify local deployment and auth policy.
- "Safe tools" should specify isolated IM restrictions vs trusted-local normal tools.

Claims to avoid:

- "Internet-hardened."
- "Zero-trust."
- "Multi-user access control."
- "Browser token handling is robust."
- "All routes are authenticated."
- "Streaming is cancellation-safe."

## Recommended Security Work Order

1. Add native route auth tests.
2. Replace frontend `/status` token validation with a protected auth check.
3. Enforce or warn on non-loopback bind without `MIO_AUTH_TOKEN`.
4. Classify and adjust public routes for remote mode.
5. Add WS/auth tests, including missing/wrong/valid token cases.
6. Add cancellation propagation for SSE/OpenAI streaming/WS.
7. Add notification fetch timeout/retry.
8. Add Vite proxy and service worker drift tests.
9. Decide whether normal HTTP sessions should expose file tools under remote binding.

## Current Verdict

Mio's security model is coherent if described honestly: local-first, single-user, optional bearer auth, strong validation, and strong IM isolation. The same implementation becomes risky if exposed as a public service without additional policy, tests, and deployment safeguards.
