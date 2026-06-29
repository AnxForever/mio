# Security Hardening Roadmap

Source:

- `docs/architecture/security-surface-audit.md`
- `docs/architecture/rfc/0004-remote-deployment-security-policy.md`
- `docs/architecture/pre-code-test-checklist.md`

Purpose: convert the security audit into an implementation order. This is a research/design document and does not modify code.

## Guiding Principle

Mio should keep localhost-first ease of use, but remote exposure must not silently inherit localhost assumptions.

The target security statement is:

> Mio is safe to use as a local personal agent by default. If bound beyond localhost, it requires explicit bearer auth and stricter public-route policy.

## Phase P0: Remote Exposure Must Be Explicit

### P0-1: Require Token For Non-Localhost Binding

Problem:

- Auth is optional when no token is configured.
- Host can be changed through `MIO_HTTP_HOST`.

Policy:

- `127.0.0.1`, `localhost`, and `::1`: token optional.
- `0.0.0.0`, LAN IPs, public hostnames: token required.

Implementation design:

- Add startup check near server listen configuration.
- If non-loopback and no token, either fail startup or emit a hard warning. Preferred: fail startup unless an explicit override is added.

Acceptance criteria:

- Non-loopback without token is rejected or clearly blocked.
- Loopback no-token quick start still works.
- Deployment docs show `MIO_AUTH_TOKEN` requirement.

### P0-2: Native Auth Test Matrix

Problem:

- OpenAI-compatible auth has direct tests.
- Native route auth coverage is not proven.

Required matrix:

| Route | Missing token | Wrong token | Valid token |
|---|---:|---:|---:|
| `POST /chat` | 401 | 401 | success or expected provider error |
| `POST /chat/stream` | 401 | 401 | SSE starts |
| `PUT /mods/:name/soul` | 401 | 401 | 200 for valid mod/body |
| `GET /admin/export` | 401 | 401 | 200 |
| `POST /admin/backup` | 401 | 401 | 200 or controlled service result |
| `POST /notify/test` | 401 | 401 | 200 or configured 502 envelope |
| `GET /memories` | 401 | 401 | 200 |
| `PATCH /memories/:id` | 401 | 401 | expected validation/service result |
| `WS /ws?token=` | reject | reject | hello |

Acceptance criteria:

- Tests fail if `requireAuth` is accidentally removed from protected routes.
- Public routes are separately asserted and documented.

### P0-3: Frontend Auth Check Must Hit Protected Endpoint

Problem:

- `web/js/auth.js` validates token using public `/status`.

Target design:

- Add a protected low-impact endpoint such as `GET /auth/check`.
- `tryLogin(token)` calls protected endpoint.
- `checkAuth()` behavior:
  - no token: allow local no-token mode only when protected check is not required.
  - token present: reject if protected endpoint returns 401.

Acceptance criteria:

- Wrong token cannot enter main shell in auth-enabled mode.
- Tests cover persisted token, clearing token, and no-token local mode.

## Phase P1: Remote Mode Tightening

### P1-1: Public Route Classification

Problem:

- Public routes are currently a mix of liveness, status, setup, and diagnostics.

Target classification:

| Route | Remote policy |
|---|---|
| `/health` | Public |
| Static UI | Public |
| `/status` | Protected or split |
| `/avatar/state` | Protected if emotion privacy matters |
| `/voice/capabilities` | Public or protected with status |
| `/onboarding/*` | Loopback-only or bootstrap-protected |
| `/admin/log-level` | Protected or explicitly documented |

Acceptance criteria:

- Route policy exists in docs and ideally code.
- Tests assert route classification.

### P1-2: WS Token Policy

Problem:

- WS auth uses query token.

Local policy:

- Query token remains acceptable for browser simplicity.

Remote policy:

- Prefer short-lived WS ticket issued by authenticated HTTP request.

Acceptance criteria:

- Missing/wrong/valid WS auth tests exist.
- Docs state query-token risk under proxy/logging environments.

### P1-3: Cancellation Propagation

Problem:

- SSE/OpenAI streaming/WS do not pass client disconnect cancellation into `runTurn`.

Target design:

- HTTP request close -> `AbortController`.
- SSE/OpenAI stream close -> abort signal.
- WS close during active turn -> abort or explicit abandoned-turn policy.
- Provider HTTP already treats caller abort as non-retryable; core should pass signal through.

Acceptance criteria:

- Client disconnect stops provider call where feasible.
- Long-running tool/model work does not continue invisibly unless documented.

### P1-4: Notification Timeout/Retry

Problem:

- Notification channels use direct `fetch`.

Target design:

- Wrap notification fetches with timeout.
- Keep per-channel failures independent.
- Do not leak full webhook URLs or tokens in errors.

Acceptance criteria:

- One stuck channel cannot block all notification delivery.
- Timeout behavior is tested.

## Phase P2: Developer And Browser Consistency

### P2-1: Vite Proxy Coverage

Problem:

- Dev proxy misses actual frontend calls: `/chat`, `/mod`, `/uploads`, `/voice`, `/persona`, `/mods`, `/character`, `/characters`.

Acceptance criteria:

- Static test extracts frontend API paths and verifies proxy coverage.
- Missing proxy path fails the test.

### P2-2: Service Worker Manifest Completeness

Problem:

- `web/sw.js` precache list is hardcoded.

Acceptance criteria:

- Static test compares linked/imported CSS/JS assets against precache list.
- Dynamic API prefixes are not cached.

### P2-3: Browser Auth UX

Problem:

- UI may show auth success before protected endpoint verification.

Acceptance criteria:

- Browser E2E covers invalid token, valid token, token clear, and protected API failure state.

## Security Score Upgrade Conditions

Current security score: 3/5.

Upgrade to 4/5 when:

- Non-loopback binding cannot run without token.
- Native auth matrix passes.
- Frontend auth check uses protected endpoint.
- Public routes are explicitly classified.
- WS auth tests exist.

Upgrade toward 5/5 only after:

- Cancellation propagation is implemented and tested.
- Notification timeout/retry is implemented.
- Remote deployment docs are complete.
- Trusted-local tools have a remote-mode policy.
- Browser workflow tests cover auth and sensitive flows.

## Work Order

1. Native auth tests.
2. Protected frontend auth-check design.
3. Non-loopback token requirement.
4. Public route classification.
5. WS auth tests and ticket design decision.
6. Cancellation propagation.
7. Notification timeout/retry.
8. Vite proxy and service worker tests.
9. Trusted-local tool policy for remote mode.

