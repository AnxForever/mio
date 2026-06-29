# Test Design Detailed Specification

Purpose: turn known architecture evidence gaps into detailed test specifications without writing test code.

Source:

- `docs/architecture/pre-code-test-checklist.md`
- `docs/architecture/evidence-traceability-matrix.md`
- `docs/architecture/rfc/0001-server-route-split.md`
- `docs/architecture/rfc/0002-turn-context-providers.md`
- `docs/architecture/security-hardening-roadmap.md`

## Scope

This document specifies tests for the highest-risk gaps:

- Native auth matrix
- ID-RAG graph tests
- Provider fallback/router tests
- PluginRegistry lifecycle tests
- Browser UI workflow tests

The goal is not high line coverage. The goal is boundary proof before refactors.

## Test Design Principles

- Test public contracts before internal shape.
- Use deterministic providers and fixtures.
- Keep tests isolated under temporary `MIO_DIR`.
- Prefer direct unit tests for boundary logic, smoke/E2E for route contracts, and browser tests for real DOM behavior.
- Every test should answer: "Which architecture claim does this prove or protect?"

## 1. Native Auth Matrix

Target claim:

> Most sensitive native routes are protected when `MIO_AUTH_TOKEN` is configured.

Suggested file:

- `tests/native-auth.ts`

Fixture:

- Start server on `127.0.0.1` with temp `MIO_DIR`.
- Set `MIO_PROVIDER=mock`.
- Set `MIO_AUTH_TOKEN=test-token`.
- Use three clients:
  - missing auth
  - `Authorization: Bearer wrong`
  - `Authorization: Bearer test-token`

Route matrix:

| Route | Method | Missing token | Wrong token | Valid token assertion |
|---|---|---:|---:|---|
| `/chat` | POST | 401 | 401 | 200 with `sessionId` or expected mock output |
| `/chat/stream` | POST | 401 | 401 | 200 SSE headers and at least one event |
| `/mods/:name/soul` | PUT | 401 | 401 | 200 for valid mod/body |
| `/admin/export` | GET | 401 | 401 | 200 text export |
| `/admin/backup` | POST | 401 | 401 | 200 or controlled backup result |
| `/notify/test` | POST | 401 | 401 | 200 or 502 configured-channel envelope |
| `/memories` | GET | 401 | 401 | 200 JSON |
| `/memories/:id` | PATCH | 401 | 401 | 404/validation/service result, not 401 |
| `/ws?token=` | WS | reject | reject | receives `hello` |

Public route assertions:

| Route | Expected |
|---|---|
| `/health` | Public 200 |
| `/status` | Public or protected according to final security policy |
| `/avatar/state` | Public or protected according to final security policy |
| `/voice/capabilities` | Public or protected according to final security policy |
| `/onboarding/status` | Public local-mode behavior documented |

Negative tests:

- Malformed `Authorization` header returns 401.
- Lowercase `bearer` works if middleware supports it.
- Empty token env means auth is disabled only in loopback mode.
- Non-loopback no-token behavior follows remote deployment policy once implemented.

Failure meaning:

- If missing/wrong token returns non-401 on protected route, remote security claim fails.
- If public route classification is not asserted, future route changes can drift silently.

## 2. ID-RAG Graph Tests

Target claim:

> Persona is a graph-backed hierarchy, not only a static prompt.

Suggested file:

- `tests/unit-idrag-graph.ts`

Fixtures:

- Minimal `soul.md` with sections for core traits, voice, boundaries, beliefs, principles.
- Stage-specific traits for acquaintance/familiar/ambiguous/intimate.
- Trigger-rich user probes.
- Empty soul fixture.
- App/package parity fixture shared between `src/persona` and `packages/idrag`.

Test cases:

| Case | Assertion |
|---|---|
| Graph extraction | `extractGraphFromSoul` creates expected node types and stable ids. |
| Same-section edges | Related nodes in same section have edges. |
| Core always included | Core traits and voice/boundary nodes appear even with weak trigger match. |
| Trigger relevance | Probe containing a trigger ranks matching nodes higher. |
| Stage relevance | Relationship stage changes retrieval order when stage-specific nodes exist. |
| Token cap | Rendered fragment stays under target budget or documented approximation. |
| Prompt rendering | `graphToPrompt` emits stable sections without raw graph internals. |
| Empty soul | Returns safe fallback, not crash. |
| Refresh detection | Newer `soul.md` invalidates cached graph. |
| Package parity | App and package graph outputs match or documented intentional differences are asserted. |

Failure meaning:

- If extraction/retrieval fails, ID-RAG should be described as implemented but unproven.
- If parity fails unintentionally, package API cannot be called stable.

## 3. Provider Fallback And Router Tests

Target claim:

> Provider integrations are adapter-based, with reliability boundaries that are deterministic.

Suggested files:

- `tests/unit-provider-fallback.ts`
- `tests/unit-provider-router.ts`

Fallback fixtures:

- `SuccessProvider`: returns known text.
- `FailBeforeTokenProvider`: throws before streaming tokens.
- `FailAfterTokenProvider`: emits one token then throws.
- `ToolCallProvider`: returns tool calls.
- Event recorder for fallback events.

Fallback tests:

| Case | Assertion |
|---|---|
| Primary success | Secondary provider not called. |
| Primary non-stream fail | Secondary provider returns output. |
| All providers fail | Final error is clear and includes provider context without secrets. |
| Events drain | Fallback events are recorded and drainable. |
| Stream fail before token | Fallback may stream from next provider if policy allows. |
| Stream fail after token | No duplicate partial output; either no fallback after partial output or buffering policy is explicit. |
| Tool-call failure | Tool-call stream failure does not produce malformed tool calls. |
| Caller abort | Abort is not retried. |

Router fixtures:

- Config with `modelRouter` enabled and disabled.
- Task model map for `chat`, `classify`, `summarize`.
- Unknown task.
- Provider-specific model override.

Router tests:

| Case | Assertion |
|---|---|
| Router disabled | Uses base provider/model. |
| Known task | Resolves expected task model. |
| Unknown task | Falls back predictably. |
| Provider/model mismatch | Unsupported model is rejected or routed provider-aware, not silently sent to wrong provider. |
| Missing API key | Error is explicit, not silent fallback unless policy says so. |

Failure meaning:

- If fallback semantics are ambiguous, provider reliability cannot be called mature.
- If router can mismatch provider/model, per-task routing remains an experimental feature.

## 4. PluginRegistry Lifecycle Tests

Target claim:

> Mio has a plugin foundation; maturity requires lifecycle and conflict proof.

Suggested file:

- `tests/unit-plugin-registry.ts`

Fixtures:

- `validPlugin`
- `duplicateIdPlugin`
- `missingDependencyPlugin`
- `conflictingPlugin`
- `failingLoadPlugin`
- `failingHookPlugin`
- `promptFragmentPlugin`

Test cases:

| Case | Assertion |
|---|---|
| Register valid plugin | Plugin appears in registry and hooks are available. |
| Duplicate id | Duplicate registration is rejected. |
| Missing dependency | Registration fails with clear error. |
| Conflict declaration | Conflicting plugin is rejected. |
| Load failure rollback | Failed `onLoad` does not leave partial state. |
| Unload | `onUnload` runs and plugin state is removed. |
| Hook isolation | One failing hook does not prevent later plugins if policy says hooks are isolated. |
| Prompt fragments | Prompt fragments are collected in deterministic order. |
| Capability contract | Declared tools/hooks match implemented behavior. |

Failure meaning:

- If rollback/hook isolation is not proven, plugin architecture should remain "foundation", not "mature".

## 5. Browser UI Workflow Tests

Target claim:

> The web UI supports real user workflows, not only API responses and view-model functions.

Suggested file:

- `tests/e2e/mio-ui.spec.ts`

Test mode:

- Playwright browser tests.
- Mock provider.
- Temp `MIO_DIR`.
- Run both auth-disabled local mode and auth-enabled mode where practical.

Workflows:

| Workflow | Assertions |
|---|---|
| App boot no auth | Local no-token server enters main shell or onboarding according to server state. |
| Invalid token | Login fails and does not enter main shell. |
| Valid token | Login succeeds and token is persisted once. |
| Chat send | User bubble appears, assistant bubble appears, session id persists. |
| WS streaming | Tokens append into one assistant bubble; done state clears spinner. |
| SSE fallback | When WS unavailable, SSE or POST fallback produces assistant response. |
| Image upload | Pending preview appears, upload route called, chat sends `imagePath`. |
| Memories view | List renders, edit/confirm/ignore/delete actions update DOM. |
| Studio soul edit | Soul loads, save calls protected endpoint, success state appears. |
| Persona wizard | Generate preview, save, activation reaches done state. |
| Settings mod switch | `/mod` call updates visible active state. |
| Onboarding | `needsOnboarding=true` routes to onboarding and final step reaches chat. |

Static frontend tests:

| Area | Assertion |
|---|---|
| Auth store | `authToken` and `sessionId` storage keys are consistent; clearing removes stale values. |
| Vite proxy | Every frontend API path is proxied or documented same-origin. |
| Service worker | Linked/imported CSS/JS assets are cached or intentionally network-only; API prefixes excluded. |

Failure meaning:

- If browser auth fails, security hardening is not complete.
- If WS/SSE state splits bubbles incorrectly, user-facing streaming contract is unstable.
- If Vite/SW drift tests fail, frontend development and cached UI cannot be trusted.

## Coverage Map

| Test spec | Protects claim | Protects RFC |
|---|---|---|
| Native auth matrix | Security posture, remote deployment | RFC-0001, RFC-0004 |
| ID-RAG graph | Persona graph architecture | RFC-0002, RFC-0003 |
| Provider fallback/router | Runtime reliability | Future provider RFC |
| PluginRegistry lifecycle | Plugin maturity | Future plugin RFC |
| Browser UI workflow | Product workflow and frontend contract | Security roadmap, frontend hardening |

## Completion Standard

The test suite can be considered architecture-ready when:

- P0 tests exist and fail on the known risky behavior they guard.
- Each major refactor RFC names the tests that must pass before and after implementation.
- Browser tests cover actual DOM workflows for auth, chat, memory, and persona.
- Test names describe contracts, not implementation details.

