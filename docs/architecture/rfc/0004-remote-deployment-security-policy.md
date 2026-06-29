# RFC-0004: Remote Deployment Security Policy

Status: Proposed

Owner role: Security Reviewer + Runtime Reliability Reviewer

Source evidence:

- `docs/architecture/adr/0002-localhost-first-security-model.md`
- `docs/architecture/security-surface-audit.md`
- `docs/architecture/risk-priority-backlog.md#r-004-native-auth-and-localhost-assumptions`

## Problem

Mio's security model is localhost-first. This is appropriate for a personal local companion, but the same server can be bound to a non-loopback interface through configuration. If that happens without an auth token and public route classification, private memory/admin/persona surfaces can become exposed.

The architecture should explicitly define what is allowed under remote deployment before implementation hardening begins.

## Goals

- Preserve simple localhost usage.
- Make non-loopback binding require explicit security posture.
- Classify public, protected, and remote-restricted routes.
- Fix frontend token validation so login reflects real auth state.
- Define WS token policy for local and remote use.

## Non-Goals

- No multi-user accounts.
- No OAuth.
- No cloud tenancy.
- No zero-trust claim.
- No encryption-at-rest design in this RFC.

## Deployment Modes

| Mode | Host | Auth requirement | Intended use |
|---|---|---|---|
| Local personal | `127.0.0.1` or `localhost` | Optional | Same-machine browser/CLI. |
| LAN personal | Private LAN address or `0.0.0.0` | Required | Phone or another trusted device on LAN. |
| Reverse proxy / tunnel | Public or semi-public URL | Required plus public route restrictions | Remote access by owner. |
| Multi-user public service | Any public host | Not supported | Out of scope. |

## Policy Decisions

1. If bind host is not loopback, startup must require `MIO_AUTH_TOKEN` or an equivalent configured token.
2. `/health` and static assets may remain public.
3. `/status` should be split into public liveness and protected private status, or protected under remote mode.
4. Onboarding write routes must be loopback-only, bootstrap-token protected, or disabled after first-run.
5. `/admin/log-level` should be protected or explicitly documented as public diagnostic.
6. WS query-token auth is acceptable for localhost; remote mode should prefer a short-lived WS ticket.
7. Frontend login must validate against a protected endpoint, not public `/status`.

## Route Classification

| Route family | Local mode | Remote mode |
|---|---|---|
| `/health` | Public | Public |
| Static UI | Public | Public |
| `/status` | Public acceptable | Protected or split |
| `/avatar/state` | Public acceptable | Protected if emotion privacy matters |
| `/voice/capabilities` | Public acceptable | Public or protected with status |
| `/onboarding/*` | Public before setup | Loopback-only or bootstrap-protected |
| `/chat*` | Auth if token configured | Auth required |
| `/uploads/*`, `/voice/transcribe` | Auth if token configured | Auth required |
| `/v1/*` | OpenAI auth if token configured | Auth required |
| `/onebot/*` | Auth if token configured | Auth required |
| `/mods/*`, `/persona/*`, `/character*` | Auth if token configured | Auth required |
| `/admin/*` | Auth if token configured, except current log-level | Auth required |
| `/analytics*`, `/memories`, `/search`, `/notify*`, `/proactive/*` | Auth if token configured | Auth required |
| `/ws` | Query token if token configured | Auth required; short-lived ticket preferred |

## Frontend Auth Check

Current problem:

- `web/js/auth.js` validates login by calling public `/status`.

Target:

- Add a protected low-impact endpoint such as `GET /auth/check`.
- Frontend `checkAuth()` and `tryLogin()` should call the protected endpoint when a token exists.
- No-token local mode can still probe public `/status` or `/health`.

## WS Auth Policy

Local:

- Continue accepting `?token=` if auth is configured.

Remote:

- Prefer a short-lived WS ticket issued by an authenticated HTTP endpoint.
- Ticket should have a short TTL and single-use semantics if implemented.
- Until ticket auth exists, document query token as acceptable only behind trusted local/LAN access.

## Preconditions

Before enforcing remote policy:

- Native route auth test matrix exists.
- Public route classification tests exist.
- Frontend auth-store tests exist.
- WS auth tests exist.

## Acceptance Criteria

- Non-loopback bind without `MIO_AUTH_TOKEN` fails startup or emits a hard warning according to final implementation choice.
- Native protected routes reject missing/wrong token when auth is configured.
- Frontend wrong-token login fails before entering the main app.
- Public routes are intentionally classified.
- Remote deployment docs avoid "internet-hardened" language.

## Risks

| Risk | Mitigation |
|---|---|
| Breaking local no-token quick start | Keep loopback mode auth-optional. |
| Frontend auth flow becomes confusing | Separate no-token local mode from token-protected mode. |
| Remote users need setup guidance | Add clear env-var examples and route policy docs. |

## Definition Of Done

This RFC is implemented only when remote binding cannot silently inherit unsafe localhost defaults, and the frontend accurately reflects whether the configured token is valid.

