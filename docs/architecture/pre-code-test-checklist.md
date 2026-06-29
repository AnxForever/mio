# Pre-Code Test Checklist

Purpose: define tests to add before refactoring or hardening the architecture hotspots identified in `docs/research/architecture-review-long-task.md`.

Rule: do not start broad refactors until the relevant boundary has direct tests.

## Priority Legend

- `P0`: Add before touching the related architecture boundary.
- `P1`: Add before claiming the subsystem is mature.
- `P2`: Useful regression coverage after the main boundary is stable.

## 1. PluginRegistry

Priority: P0

Current gap:

The plugin registry infrastructure is well designed, but direct lifecycle/conflict/rollback tests were not found.

Suggested test file:

- `tests/unit-plugin-registry.ts`

Test cases:

- Valid plugin manifest registers successfully.
- Duplicate plugin id is rejected.
- Missing dependency is rejected.
- Conflict declaration is enforced.
- `onLoad` failure rolls back registration.
- `onUnload` removes plugin state.
- Hook failure in one plugin does not prevent later plugins from running.
- Prompt fragments are collected, ordered, and isolated from failing plugins.
- Capability declarations match implemented hooks/tools.

Passing standard:

- Tests prove registry behavior without relying on core turn integration.
- A failing plugin cannot corrupt registry state or block unrelated plugins.

## 2. Provider Fallback And Routing

Priority: P0

Current gap:

Provider HTTP retry is tested, but fallback chain, streaming fallback semantics, and task routing are not directly tested.

Suggested test files:

- `tests/unit-provider-fallback.ts`
- `tests/unit-provider-router.ts`

Test cases:

Fallback chain:

- Primary provider success returns primary output.
- Primary provider failure falls back to secondary provider.
- All providers fail returns clear final error.
- Fallback events are recorded and drainable.
- Non-streaming fallback does not reuse failed provider state.

Streaming fallback:

- If first provider fails before emitting tokens, fallback may stream from next provider.
- If first provider fails after emitting tokens, behavior is explicitly tested: either no fallback after partial output, or buffered output prevents duplicate partial text.
- Tool-call streaming failure does not produce malformed tool calls.

Router:

- `chat`, `classify`, and `summarize` tasks resolve expected model/provider settings.
- Unknown task falls back predictably.
- Model override does not route an unsupported model through the wrong provider silently.
- Provider-aware route config is validated if introduced later.

Passing standard:

- Fallback behavior is deterministic under both pre-token and post-token failure.
- Router tests prevent provider/model mismatch.

## 3. ID-RAG Persona Graph

Priority: P0

Current gap:

Layered persona is tested, but direct tests for graph extraction, retrieval, rendering, and refresh detection were not found.

Suggested test file:

- `tests/unit-idrag-graph.ts`

Test cases:

- `extractGraphFromSoul` creates nodes for core traits, voice, boundaries, beliefs, and principles.
- Same-section edges are created as expected.
- `retrieveRelevantNodes` includes core traits and voice/boundary nodes even when trigger match is weak.
- Trigger matching increases relevance.
- Relationship stage relevance affects retrieval order.
- Token budget caps rendered persona fragment.
- `graphToPrompt` renders stable sections without raw graph leakage.
- Empty or missing soul falls back safely.
- Graph refresh detects newer `soul.md`.
- Package/app parity test catches `@mio/idrag` behavior drift.

Passing standard:

- Core persona retrieval can be refactored out of `agent-loop.ts` with behavior protected by tests.

## 4. Native Route Auth

Priority: P0

Current gap:

OpenAI-compatible auth is well tested. Native route auth under `MIO_AUTH_TOKEN` needs direct tests.

Suggested test file:

- `tests/native-auth.ts`

Test matrix:

| Route | Missing token | Wrong token | Valid token |
|---|---:|---:|---:|
| `POST /chat` | 401 | 401 | 200 |
| `POST /chat/stream` | 401 | 401 | 200 SSE |
| `PUT /mods/:name/soul` | 401 | 401 | 200 |
| `GET /admin/export` | 401 | 401 | 200 |
| `POST /admin/backup` | 401 | 401 | 200 |
| `POST /notify/test` | 401 | 401 | 200 or configured failure envelope |
| `GET /memories` | 401 | 401 | 200 |
| `PATCH /memories/:id` | 401 | 401 | expected validation/service result |
| `WS /ws?token=` | reject | reject | hello |

Also test:

- Public routes remain intentionally public if documented: `/health`, maybe `/status`, `/avatar/state`, `/voice/capabilities`.
- Binding to `0.0.0.0` without `MIO_AUTH_TOKEN` emits a warning or fails if later enforced.

Passing standard:

- Native route behavior matches documented localhost-first security model.
- Public routes are deliberate, not accidental.

## 5. Frontend Auth, Vite Proxy, And Service Worker

Priority: P0

Current gap:

Frontend auth validates tokens through public `/status`. Vite proxy misses actual frontend API paths. Service worker precache is hardcoded and stale.

Suggested test files:

- `tests/web/auth-store.test.mjs`
- `tests/web/vite-proxy.test.mjs`
- `tests/web/service-worker-manifest.test.mjs`

Test cases:

Auth/store:

- Invalid token is rejected against a protected endpoint or dedicated auth check.
- `Store.persist('authToken')` does not create duplicate stale keys.
- `authToken` and `sessionId` storage key names are consistent.
- Clearing auth removes all token key variants.

Vite proxy:

- Every API path called by `web/js` is matched by `web/vite.config.js` proxy rules or intentionally served by the same origin.
- Explicitly include `/chat`, `/chat/stream`, `/mod`, `/uploads`, `/voice`, `/persona`, `/mods`, `/character`, `/characters`.

Service worker:

- Every CSS/JS file linked by `web/index.html` is either in precache or intentionally network-only.
- Every JS module imported from `/js/app.js` graph is either in precache or intentionally network-only.
- API prefixes exclude all dynamic API routes.

Passing standard:

- Frontend local development and offline/PWA behavior cannot silently drift from current file/route usage.

## 6. Browser UI Workflows

Priority: P1

Current gap:

Playwright E2E mostly exercises API/WS behavior. Actual browser UI workflows are thin.

Suggested test file:

- `tests/e2e/mio-ui.spec.ts`

Test cases:

- App boots to auth or chat depending on server token state.
- Invalid token shows login failure and does not enter main shell.
- Chat sends a message and appends user/assistant bubbles.
- WS path streams tokens into one assistant bubble.
- SSE fallback works when WS is unavailable.
- Image attachment uploads and appears in pending preview.
- Memories page lists items, edits one, confirms/ignores one, deletes one using mock data.
- Studio opens soul editor and saves edited soul.
- Persona wizard generates preview and save flow reaches done state with mock provider.
- Settings gender switch calls `/mod` and updates visible state.
- Onboarding redirects when `needsOnboarding` is true.

Passing standard:

- UI tests verify real DOM behavior, not only route responses.

## 7. Cancellation Semantics

Priority: P1

Current gap:

Server streaming and WS turns do not cancel `runTurn` on client disconnect.

Suggested test files:

- `tests/unit-turn-cancellation.ts`
- `tests/server-cancellation.ts`

Test cases:

- `/chat/stream` client abort passes `AbortSignal` into provider call.
- OpenAI streaming client abort passes `AbortSignal` into provider call.
- WS close during turn cancels or marks the turn abandoned according to documented policy.
- Tool execution observes cancellation where feasible.
- Provider HTTP wrapper treats caller abort as non-retryable.

Passing standard:

- Long-running model/tool work does not continue invisibly after client disconnect unless explicitly documented.

## 8. Package Parity

Priority: P1

Current gap:

`src/emotion` vs `packages/emotion` and `src/persona` vs `packages/idrag` can drift.

Suggested test files:

- `tests/package-emotion-parity.ts`
- `tests/package-idrag-parity.ts`

Test cases:

- Exported package APIs produce same results as app modules for representative inputs.
- `@mio/idrag` generator accepts the same gender values as app generator.
- Ghost behavior parity includes IM bridge no-ghost policy if intended.
- Tracker parity includes emotional depth progression if intended.
- Package docs describe intentional divergences if parity is not desired.

Passing standard:

- Package consumers cannot observe accidental behavior drift.

## 9. Memory Consolidation Recovery

Priority: P1

Current gap:

Atomic writes exist for individual files, but multi-file consolidation recovery is not proven.

Suggested test file:

- `tests/unit-consolidation-recovery.ts`

Test cases:

- Simulated failure after structured memory write but before lorebook/procedural write leaves recoverable state.
- Checkpoint/commit log prevents duplicate application on rerun.
- Corrupt mid-term topic file is skipped or repaired without losing all memory.
- Snapshot/backup exists before destructive consolidation changes if that policy is adopted.

Passing standard:

- Nightly consolidation can be retried safely after partial failure.

## 10. Test Script Organization

Priority: P2

Current gap:

`npm test` is a long monolithic command.

Suggested package scripts:

- `test:unit`
- `test:core`
- `test:memory`
- `test:emotion`
- `test:bridge`
- `test:http`
- `test:web`
- `test:smoke`
- `test:all`

Passing standard:

- Developers can run focused suites before touching a subsystem.
- `test:all` remains the release-level gate.

## Minimum Test Gate Before Major Refactors

Before splitting `server/index.ts`:

- Native route auth tests.
- Server smoke tests.
- OpenAI/OneBot compatibility tests.
- WS/SSE tests.

Before extracting `agent-loop.ts` prompt/context:

- Golden turn tests.
- Context engine tests.
- ID-RAG graph tests.
- Semantic memory tests.
- Crisis/post-history prompt tests.

Before touching provider fallback/routing:

- Provider fallback tests.
- Router tests.
- HTTP retry/timeout tests.
- Streaming partial-output tests.

Before touching frontend Chat/Studio:

- Browser UI workflow tests.
- Frontend auth/store tests.
- Vite proxy and service-worker manifest tests.
