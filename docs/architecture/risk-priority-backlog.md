# Architecture Risk Priority Backlog

Source: `docs/research/architecture-review-long-task.md`

Current stage verdict: `good, not excellent`.

Priority rules:

- `P0`: blocks a credible claim of excellent architecture or should precede risky refactors.
- `P1`: important hardening or maintainability work that should happen soon.
- `P2`: useful cleanup that improves developer experience or long-term clarity.

## P0 Risks

### R-001: Server Route Monolith

Priority: P0

Evidence:

- `src/server/index.ts` is the largest source file in the research scan.
- Server research found it owns Express setup, route registration, uploads, OpenAI bridge, OneBot bridge, mod/soul writes, Persona Studio, admin, analytics, memory review, notifications, character routes, WebSocket protocol, heartbeat, and logging.

Impact:

- New API features will continue to grow one file.
- Security/auth decisions are harder to audit by route family.
- Refactoring risk rises because unrelated routes share one composition root.

Recommended action:

- Add native route auth and route smoke tests first.
- Split into route modules: chat, uploads, openai, onebot, mods/persona, memories, admin, analytics, notify, characters, ws.

Acceptance criteria:

- `src/server/index.ts` becomes a composition root that mounts route modules.
- Existing endpoint contracts and smoke/E2E tests remain unchanged.
- Route families can be reviewed independently.

### R-002: Core Prompt/Context Concentration

Priority: P0

Evidence:

- Import scan: `src/core/agent-loop.ts` has the highest internal import count: 52.
- Core research found it still owns prompt section registration, semantic memory prefetch, persona graph retrieval, post-history prompt variants, builder-chain evaluation, and inference staging.

Impact:

- New behavior context likely requires editing `agent-loop.ts`.
- Prompt/memory/persona regressions are hard to localize.
- The public `runTurn` pipeline is cleaner, but its supporting context logic is still centralized.

Recommended action:

- Add ID-RAG direct tests and prompt/context contract tests first.
- Extract persona context provider, memory context provider, and turn prompt assembler.

Acceptance criteria:

- `runTurn` remains the public pipeline.
- Core asks domain services for prompt fragments instead of directly orchestrating retrieval.
- Golden turn, context engine, semantic memory, and persona tests pass.

### R-003: Package Drift In Emotion And ID-RAG

Priority: P0

Evidence:

- Research found broad drift between `src/emotion` and `packages/emotion`.
- Research found `@mio/idrag` generator checking `boyfriend/girlfriend` while package types expose `male/female`.

Impact:

- Package consumers can get behavior different from the app.
- Package APIs are hard to trust as extension boundaries.
- Bug fixes may land in one copy but not the other.

Recommended action:

- Accept ADR-0005 package drift policy.
- Add package parity tests.
- Fix known `@mio/idrag` gender mismatch.

Acceptance criteria:

- Source-of-truth policy is documented.
- CI/test suite catches app/package behavior drift.
- Public package docs describe intentional divergence if any.

### R-004: Native Auth And Localhost Assumptions

Priority: P0

Evidence:

- Auth is optional when no token is configured.
- `/status` is public and frontend uses it for token validation.
- OpenAI auth is tested more thoroughly than native route auth.

Impact:

- Binding beyond localhost without token exposes private memory/admin surfaces.
- Invalid frontend token may be accepted until a protected POST fails.
- Security posture can be overstated.

Recommended action:

- Accept ADR-0002 localhost-first security model.
- Add native auth test matrix.
- Add deployment guidance requiring `MIO_AUTH_TOKEN` for non-localhost binding.

Acceptance criteria:

- Native protected routes reject missing/wrong token under `MIO_AUTH_TOKEN`.
- Public routes are explicitly documented.
- Frontend validates token against a protected endpoint or dedicated auth check.

### R-005: Missing Direct Tests For Highest-Risk Boundaries

Priority: P0

Evidence:

- Research did not find direct tests for `PluginRegistry`, `FallbackChainProvider`, `routeTask`, ID-RAG retrieval/rendering, native route auth, Vite proxy, service worker, frontend token persistence, WS single-stream callback assumption, or cancellation.

Impact:

- Refactors could break nominal extension points silently.
- Current broad tests may not catch boundary-specific regressions.

Recommended action:

- Implement `docs/architecture/pre-code-test-checklist.md` P0 items before major code movement.

Acceptance criteria:

- Each P0 boundary has direct tests.
- Refactor PRs can cite the specific tests protecting the moved boundary.

## P1 Risks

### R-006: Streaming And WS Cancellation Missing

Priority: P1

Evidence:

- Server research found `/chat/stream`, OpenAI streaming, and WS chat do not propagate client disconnect into `runTurn`.
- Provider HTTP wrapper already supports caller abort behavior, but server/core do not carry cancellation through.

Impact:

- Model/tool work can continue after the client disconnects.
- Long-running local sessions can consume resources invisibly.

Recommended action:

- Add cancellation context to `runTurn`.
- Wire HTTP/SSE/WS close events into `AbortSignal`.
- Add cancellation tests.

Acceptance criteria:

- Client disconnect cancels provider call or records an explicit abandoned-turn policy.
- Caller abort remains non-retryable.

### R-007: Notification Fetches Lack Shared Timeout/Retry

Priority: P1

Evidence:

- Provider HTTP calls use `fetchWithRetry`; notification channels use direct `fetch` in research findings.

Impact:

- Notification sends may hang or fail inconsistently.
- Runtime reliability differs between provider and notification integrations.

Recommended action:

- Wrap notification fetches with timeout/retry or `AbortSignal.timeout`.
- Add tests for per-channel timeout and independent channel failure.

Acceptance criteria:

- One stuck notification channel cannot block all notification delivery.
- Failures are logged and reported consistently.

### R-008: Memory Consolidation Multi-File Recovery Unproven

Priority: P1

Evidence:

- Memory writes have atomic file helpers.
- Consolidation writes structured memory, profile/relationship/soul/notes/procedural outputs across multiple files.
- Research did not prove transactional recovery.

Impact:

- Partial failure during nightly consolidation can leave inconsistent memory-derived state.

Recommended action:

- Add write plan / commit log / checkpoint strategy.
- Add recovery tests.

Acceptance criteria:

- Re-running consolidation after simulated failure is idempotent or repairable.
- Prompt-facing memory does not duplicate or lose confirmed facts.

### R-009: Frontend Vite Proxy Drift

Priority: P1

Evidence:

- `web/vite.config.js` proxy list misses actual frontend calls like `/chat`, `/mod`, `/uploads`, `/voice`, `/persona`, `/mods`, `/character`, `/characters`.

Impact:

- Developers running the Vite dev server may see partial app failure.
- Frontend/backend contract drift is not tested.

Recommended action:

- Add proxy coverage test.
- Update proxy rules or route API calls through a consistent prefix.

Acceptance criteria:

- Every frontend API path is proxied or explicitly documented as same-origin only.

### R-010: Service Worker Precache Drift

Priority: P1

Evidence:

- `web/sw.js` says asset list is hardcoded.
- Research found linked view CSS and newer JS modules missing from precache.

Impact:

- Offline/PWA behavior can serve stale or incomplete UI.
- Cache bugs can be hard to diagnose.

Recommended action:

- Generate precache manifest through build tooling or remove stale precache.
- Add manifest completeness test.

Acceptance criteria:

- Static asset cache list matches current app module/CSS graph or is intentionally minimal.

### R-011: Frontend View Controllers Growing Too Large

Priority: P1

Evidence:

- `web/js/views/studio.js` is 754 lines.
- `web/js/views/chat.js` is 629 lines.
- `web/js/views/settings.js` is 416 lines.

Impact:

- UI state, API calls, streaming, voice, and rendering are hard to test independently.
- Product iteration slows as views become feature hubs.

Recommended action:

- Add browser UI tests first.
- Extract chat stream state, attachment upload, voice/TTS, status/avatar presenter.
- Extract Studio mod gallery, soul editor, character management, persona wizard.

Acceptance criteria:

- Main view files become composition shells.
- Extracted modules have pure-function or DOM-level tests.

### R-012: Emotion State Ownership Ambiguity

Priority: P1

Evidence:

- Research found legacy emotion, PAD, trait-state, affinity, multi-axis, frustration, progression, ritual/cardboard, ghost, personality driver, and dual-mode all shaping behavior.

Impact:

- Prompt and behavior can receive contradictory signals.
- Future emotion features may duplicate existing state.

Recommended action:

- Accept ADR-0004 emotion state ownership.
- Add state ownership tests for multi-axis, affinity compatibility, and frustration persistence policy.

Acceptance criteria:

- Each state has documented owner and purpose.
- Post-turn orchestration calls cohesive domain service.

## P2 Risks

### R-013: Monolithic Test Script

Priority: P2

Evidence:

- `package.json` has a long serial `npm test` command.

Impact:

- Hard to run focused confidence checks.
- Adding new tests makes the script harder to maintain.

Recommended action:

- Add named scripts: `test:unit`, `test:core`, `test:memory`, `test:bridge`, `test:web`, `test:smoke`, `test:all`.

Acceptance criteria:

- Developers can run subsystem tests without manually copying commands.
- `test:all` remains the release gate.

### R-014: Duplicated Test Harness Helpers

Priority: P2

Evidence:

- Many tests reimplement `record`, `assert`, temp dir setup, env restore, fake server setup.

Impact:

- Test style drift and setup mistakes become more likely.

Recommended action:

- Add shared test utilities for temp `MIO_DIR`, env restore, fake providers, server startup, and assertion output.

Acceptance criteria:

- New tests use shared utilities.
- Existing tests can migrate gradually.

### R-015: Remaining Direct Path Construction

Priority: P2

Evidence:

- Research found direct path joins outside `memory/paths.ts` in vector/persona/backup-related code.

Impact:

- Durable state paths become harder to audit and migrate.

Recommended action:

- Add explicit path helpers for vector DB, legacy vector JSONL, personality state, dual-mode state, backup/export outputs.

Acceptance criteria:

- New durable paths go through path helpers.
- Existing exceptions are documented.

### R-016: Backup Archive Is Best-Effort

Priority: P2

Evidence:

- Research found hand-built tar logic and synchronous file reads.

Impact:

- Larger/nested data directories may produce weak backup behavior.

Recommended action:

- Either use a proven tar library or document backup as best-effort local export.
- Add tests for nested and long paths if custom tar remains.

Acceptance criteria:

- Backup/export reliability claim matches implementation.

## Backlog Execution Order

Recommended order:

1. R-005 direct boundary tests.
2. R-004 native auth and localhost security documentation.
3. R-001 server route split.
4. R-002 core context provider extraction.
5. R-003 package drift policy and parity tests.
6. R-006 cancellation propagation.
7. R-009/R-010 frontend dev/PWA drift.
8. R-011 frontend view splits.
9. R-008 consolidation recovery.
10. P2 cleanup.

Reason:

Tests and decisions come first. Refactors come after boundaries are protected.
