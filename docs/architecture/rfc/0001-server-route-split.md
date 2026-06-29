# RFC-0001: Split `src/server/index.ts` By Route Family

Status: Proposed

Owner role: Principal Architect + Security Reviewer

Source evidence:

- `docs/architecture/module-boundary-review.md`
- `docs/architecture/security-surface-audit.md`
- `docs/architecture/risk-priority-backlog.md#r-001-server-route-monolith`

## Problem

`src/server/index.ts` is now a broad composition root. It owns Express setup, static files, CORS, rate limiting, route registration, uploads, OpenAI bridge, OneBot bridge, chat, streaming, mods, Persona Studio, admin backup/export, analytics, memory review, search, proactive preferences, notifications, character management, WebSocket protocol, heartbeat, and startup logging.

This makes security review harder because public/protected route decisions are spread through one file. It also makes feature work risky because unrelated route families share one edit surface.

## Goals

- Keep `startServer()` as the single server entry point.
- Make `src/server/index.ts` a small composition root.
- Move route families into independently reviewable modules.
- Preserve all current endpoint paths and response contracts.
- Keep existing Express, WebSocket, validation, auth, and logger patterns.
- Make public/protected route classification explicit per route family.

## Non-Goals

- No microservice extraction.
- No API path redesign.
- No frontend rewrite.
- No auth policy change in this RFC, except wiring existing middleware consistently.
- No behavior changes to `runTurn`.

## Preconditions

Add or confirm tests before route movement:

| Test area | Required coverage |
|---|---|
| Native auth | Missing/wrong/valid token for `/chat`, `/chat/stream`, `/admin/export`, `/mods/:name/soul`, `/notify/test`, `/memories`, and WS. |
| Route smoke | Existing smoke/E2E coverage for native chat, OpenAI-compatible, OneBot, uploads, WS, admin export, memory review. |
| Public routes | `/health`, `/status`, `/avatar/state`, `/voice/capabilities`, onboarding, and `/admin/log-level` are explicitly tested as public or protected according to final policy. |

## Proposed Module Layout

Target shape:

```text
src/server/
  index.ts                 # create app, middleware, static, mount routes, ws upgrade, listen/close
  routes/
    health.ts              # /health, /status if kept public/private by policy
    onboarding.ts          # /onboarding/*
    voice.ts               # /voice/*
    uploads.ts             # /uploads/*
    openai.ts              # /v1/*
    onebot.ts              # /onebot/v11/*
    chat.ts                # /chat, /chat/stream
    mods.ts                # /mod, /mods/:name/soul
    persona.ts             # /persona/*
    admin.ts               # /admin/*
    analytics.ts           # /analytics*
    memories.ts            # /memories, /search
    proactive.ts           # /proactive/preferences
    notify.ts              # /notify/*
    characters.ts          # /character*, /characters
  ws.ts                    # WebSocket protocol, heartbeat, upgrade handler
  upload-parse.ts          # image/audio parse and upload path guards
  route-policy.ts          # public/protected route registry for docs/tests
```

The exact file names can change during implementation, but the split should follow route-family ownership rather than arbitrary chunks.

## Proposed Route Module Contract

Each route module should expose one registration function:

```ts
export function registerChatRoutes(app: Express): void;
```

or, if shared dependencies are injected:

```ts
export interface RouteDeps {
  runTurn: typeof runTurn;
  requireAuth: typeof requireAuth;
  validate: typeof validate;
  logger: typeof logger;
}

export function registerChatRoutes(app: Express, deps: RouteDeps): void;
```

Prefer minimal dependency injection only where it improves testing. Do not create a large service locator.

## Public Route Policy

Each route module should declare whether its routes are:

- `public-local`: acceptable public route for localhost use.
- `protected`: must use `requireAuth` when auth is configured.
- `remote-restricted`: public locally but protected or disabled under remote deployment policy.

This policy should be testable through a small route registry rather than only comments.

## Migration Plan

1. Add native route auth tests and route smoke tests.
2. Extract upload parsing helpers first because they are pure and route-local.
3. Extract low-risk read routes: health/status/avatar/voice capabilities.
4. Extract upload and chat routes.
5. Extract bridge routes: OpenAI-compatible and OneBot.
6. Extract high-sensitivity routes: admin, memories/search, notify, persona/mods/characters.
7. Extract WS protocol after HTTP route movement is stable.
8. Re-run smoke/E2E and import fan-out scan.

## Acceptance Criteria

- `src/server/index.ts` is reduced to app/server construction, shared middleware, route mounting, WS mounting, and listen/close lifecycle.
- Every existing route path still exists unless a separate security RFC changes it.
- Route families can be reviewed independently.
- Public/protected route classification is visible in code and docs.
- Existing smoke/E2E tests pass.
- Native auth matrix passes.
- Import fan-out for `src/server/index.ts` materially decreases.

## Risks

| Risk | Mitigation |
|---|---|
| Route response drift | Add route smoke tests before movement. |
| Auth middleware accidentally dropped | Native auth matrix plus route policy registry. |
| Circular imports through shared helpers | Keep route modules importing domain modules, never importing `server/index.ts`. |
| Over-abstraction | Keep route modules simple; do not introduce controller/service layers unless needed. |

## Definition Of Done

This RFC is implemented only when route behavior is preserved, auth coverage is explicit, and `src/server/index.ts` becomes a composition root rather than a route monolith.

