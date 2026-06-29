# Evidence Traceability Matrix

Source documents:

- `docs/research/architecture-review-long-task.md`
- `docs/architecture/architecture-proof-pack.md`
- `docs/architecture/module-boundary-review.md`
- `docs/architecture/risk-priority-backlog.md`
- `docs/architecture/pre-code-test-checklist.md`
- `docs/architecture/security-surface-audit.md`

Purpose: connect each architecture claim to concrete code, tests, and known gaps. This document is meant to prevent overclaiming. A claim is only safe when the evidence is specific enough to support it.

## Evidence Levels

| Level | Meaning |
|---|---|
| Strong | Supported by clear module structure plus direct tests or executable eval coverage. |
| Medium | Supported by code and broad tests, but missing direct boundary tests or has known caveats. |
| Weak | Supported by intent or partial implementation, but important proof is missing. |
| Unsupported | Should not be claimed yet. |

## Claim Matrix

| ID | Claim | Evidence level | Code evidence | Test / doc evidence | Gaps that limit the claim | Safe wording |
|---|---|---|---|---|---|---|
| C-001 | Mio is a local-first stateful runtime, not a stateless chatbot. | Strong | `src/memory/*`, `src/emotion/*`, `src/relationship/*`, `src/persona/*`, `src/server/index.ts`, `src/index.ts`; server host defaults to `127.0.0.1` in `startServer`. | Architecture research identifies local disk state, transcripts, memory bank, emotion/PAD/relationship files, persona `soul.md`, CLI/server shared behavior core. | Local-first does not mean internet-hardened. External binding changes the threat model. | "Mio is a local-first companion runtime with durable local state." |
| C-002 | Modular monolith is the right architecture pattern for this product stage. | Strong | One Node process, `src/` domain folders, workspace packages for emotion and ID-RAG, Express/WS as local interface. | ADR-0001, architecture diagrams, module boundary review. | Current module import direction is imperfect; core/server remain broad composition roots. | "Mio is best described as a domain-organized modular monolith." |
| C-003 | Memory is a first-class layered subsystem. | Strong | `src/memory/bank.ts`, `transcript.ts`, `structured-memory.ts`, `adaptive-history.ts`, `compression.ts`, `vector.ts`, `sqlite-vector.ts`, `lorebook.ts`, `procedural-memory.ts`, `consolidation-phases.ts`, `search.ts`, `memories.ts`. | Tests discovered for semantic memory, vector incremental indexing, SQLite vector, memory review sync, structured extraction, compression, memory recall scope, IM session isolation. | `structured-memory.ts`, `search.ts`, and consolidation remain broad. Multi-file consolidation recovery is not proven. Search scope can include global memory unless caller options are correct. | "Mio treats memory as layered local stores and retrieval paths." |
| C-004 | Memory is reviewable by the user/operator. | Medium | Server memory review routes: `GET /memories`, `PATCH /memories/:id`, `DELETE /memories/:id`; frontend memories view; memory review service. | `tests/unit-memory-review.ts`; frontend memory view-model tests. | Browser E2E for real memory review workflow is thin. Auth posture of memory routes depends on `MIO_AUTH_TOKEN`. | "Mio includes a memory review/edit/delete surface." |
| C-005 | Persona is a hierarchy, not a single prompt blob. | Medium | `src/persona/graph.ts`, `extractor.ts`, `driver.ts`, `dual-mode.ts`, `generator.ts`; `src/persona/layered.ts`; mod-backed `soul.md`; persona delta/preferences. | Persona / ID-RAG deep dive; layered persona tests; directive isolation tests; persona tool allowlist tests. | Direct ID-RAG tests for extraction, retrieval, rendering, refresh detection, and package parity are missing. `soul.md` is not literally the only behavior source. | "`soul.md` defines the character archetype; ID-RAG and overlays make persona context-sensitive." |
| C-006 | ID-RAG reduces persona prompt pressure by retrieving relevant persona nodes. | Weak to Medium | `src/persona/graph.ts` extracts nodes/edges and renders prompt fragments with a token target. `agent-loop.ts` calls graph retrieval during prompt assembly. | Architecture research found retrieval logic and token-budget intent. | No direct test currently proves `extractGraphFromSoul`, `retrieveRelevantNodes`, `graphToPrompt`, budget behavior, refresh detection, or app/package parity. | "Mio implements an ID-RAG persona retrieval path; direct retrieval tests are still needed." |
| C-007 | Emotional behavior is code-backed, not only prompt-driven. | Strong | `src/emotion/tracker.ts`, `pad.ts`, `affinity.ts`, `multi-axis.ts`, `frustration.ts`, `ghost.ts`, `reply-necessity.ts`, `relationship/stages.ts`, `relationship/progression.ts`, `core/turn-silence.ts`, `core/turn-post-effects.ts`. | `tests/unit-emotion.ts`, `tests/unit-progression-wiring.ts`, golden turn crisis/ghost checks, reply necessity tests. | Multiple relationship/emotion models overlap. State ownership needs a clearer matrix. App/package drift can change behavior outside the main app. | "Mio has code-level emotion, silence, and relationship-stage gates." |
| C-008 | Crisis handling is a runtime safety layer. | Medium | `src/safety/crisis.ts` screens messages before inference and injects a safety override. `turn-prepare.ts` calls crisis screening; `turn-conversation.ts` appends override; post effects record crisis bookmarks. | Golden turn crisis tests and E2E crisis behavior are cited in research. | Keyword-based Chinese/English scope only. This is a safety floor, not clinical validation. | "Mio has deterministic crisis detection and prompt override safeguards." |
| C-009 | Provider adapters are compact and vendor logic is isolated. | Medium | `AIProvider` / `StreamingProvider` in `src/types.ts`; `src/providers/anthropic.ts`, `openai-compatible.ts`, `lora-adapter.ts`, `index.ts`; `fetchWithRetry` in `src/providers/http.ts`. | Unit HTTP tests; OpenAI compatibility tests; smoke/E2E OpenAI routes. | Fallback chain and model router need direct tests. Model/provider routing can still mismatch under `auto`. | "Provider integrations are adapter-based, with retry/timeout primitives." |
| C-010 | Tool exposure is scoped for isolated IM sessions. | Strong for IM isolation, Medium overall | `src/core/tool-runtime.ts` exposes only `current_time` for isolated sessions; `turn-session.ts` identifies OpenAI/OneBot sessions; persona allowlist supports non-isolated sessions. | `tests/unit-im-session-isolation.ts`, `tests/unit-directive-isolation.ts`, `tests/unit-persona-tool-allowlist.ts`. | Normal local sessions still expose powerful trusted-local tools such as file read/write/edit and restricted bash. Prompt injection risk remains a local-trust concern. | "External IM sessions get restricted tools; normal local sessions remain trusted." |
| C-011 | Protocol bridges preserve one behavior core. | Medium | Native `/chat`, `/chat/stream`, OpenAI `/v1/chat/completions`, OneBot `/onebot/v11/events`, and WS `/ws` call `runTurn`. | Smoke and E2E tests cover native routes, OpenAI compatibility, OneBot, and WS. | `src/server/index.ts` is a route/protocol monolith. Streaming and WS do not propagate client disconnect cancellation into `runTurn`. | "Multiple protocol surfaces route into the same core turn loop." |
| C-012 | Input validation is broad and centralized. | Strong | `src/validation.ts` defines Zod schemas for chat, OpenAI, OneBot, uploads, memory, search, analytics, persona, character, WS; server uses `validate`, `validateParams`, `validateQuery`. | Unit tests include validation checks; smoke/E2E exercise route inputs. | Validation is broad, but native route auth and frontend auth behavior need dedicated tests. | "API inputs are guarded by shared Zod validation schemas." |
| C-013 | Upload handling has meaningful path and MIME controls. | Medium | Image upload magic-byte detection; audio MIME enum and size cap; uploads write under memory path helpers; chat image/audio paths must resolve under upload directories. | Smoke test exercises image upload plus chat image path. | Audio content is not magic-byte verified like images. Uploads are safe only when route auth policy is correctly configured. | "When auth is configured, uploads are protected and constrained by size, type, and upload-directory checks." |
| C-014 | Security posture is privacy-first for local personal use. | Medium | Server host defaults to `127.0.0.1`; `requireAuth` activates when `MIO_AUTH_TOKEN` is set; WS validates `?token=`; CORS is allowlist-only unless configured otherwise; rate limiter exists. | ADR-0002; security research; OpenAI auth tests; IM isolation tests. | Auth is optional by design; public `/status`, onboarding, avatar, voice capabilities, and admin log-level need deployment classification; native route auth tests are missing; frontend token validation uses public `/status`. | "Mio is localhost-first with optional bearer auth, not internet-hardened by default." |
| C-015 | Regression awareness is strong for a personal-agent project. | Strong overall, Medium for boundaries | `package.json` runs build plus many deterministic tests; `eval/` contains synthetic scenario benchmark and ablation variants. | `eval/README.md`, quality gate, golden turn tests, smoke/E2E, unit suites. | Missing direct tests for PluginRegistry, FallbackChainProvider, routeTask, ID-RAG, native auth, Vite proxy, service worker, frontend auth store, browser workflows, and cancellation. | "Mio has broad deterministic tests and a scenario eval harness, with known boundary gaps." |
| C-016 | Plugin architecture is mature. | Weak | `src/plugins/*` and built-in wrappers exist; core loads plugins and invokes hooks. | Research found plugin structure. | Direct lifecycle/conflict/rollback/prompt-fragment tests were not found. Core behavior is not yet plugin-owned. | "Mio has a plugin foundation, but plugin maturity still needs proof." |
| C-017 | Package APIs are stable extension boundaries. | Weak | `packages/emotion` and `packages/idrag` exist. | Package drift ADR and module review document the boundary. | App/package drift is known: emotion behavior and ID-RAG vocabulary can diverge. Parity tests are missing. | "Mio has package extraction in progress; parity work is still required." |
| C-018 | Server layer is thin. | Unsupported | `src/server/index.ts` imports many domains and registers many route families. | Module boundary review: `src/server/index.ts` has 37 internal imports and is a composition hotspot. | The server owns HTTP setup, static files, CORS, rate limiting, route registration, uploads, bridges, admin, memory, analytics, notifications, characters, WS, and logging. | Do not claim this. Say: "The server is a composition root that should be split by route family." |

## Claim Safety Summary

Strong claims safe for README or talks:

- Mio is a local-first, stateful companion runtime.
- A modular monolith fits its local personal-agent product shape.
- Memory is layered and prompt-facing rather than only raw chat history.
- Emotion, relationship stage, ghost silence, and crisis behavior have code-level mechanisms.
- Multiple protocol bridges route into a single turn loop.
- The project has broad deterministic regression tests and a scenario eval harness.

Claims that need qualifiers:

- ID-RAG persona retrieval is implemented, but direct extraction/retrieval/rendering tests are still needed.
- Security is suitable for localhost-first use, but not for unauthenticated internet exposure.
- Provider adapters are clean, but fallback/router behavior is not fully proven.
- The plugin system exists, but plugin lifecycle maturity is not proven.
- Package extraction exists, but packages should not be advertised as fully stable until parity tests exist.

Claims to avoid:

- "Internet-hardened by default."
- "Perfect memory safety."
- "`soul.md` is the only persona source."
- "The server layer is thin."
- "Plugin architecture is mature."
- "Provider fallback is fully reliable."
- "Test coverage is complete."
- "Mio proves real user wellbeing outcomes."

## Evidence Gaps Blocking An Excellent Verdict

| Gap | Blocks which claim | Required proof |
|---|---|---|
| Native route auth tests | Security posture, remote deployment guidance | Tests for missing/wrong/valid token across `/chat`, `/chat/stream`, `/admin/export`, `/mods/:name/soul`, `/notify/test`, `/memories`, and WS. |
| Frontend auth validation through public `/status` | Login security, token correctness | A protected auth-check endpoint or frontend test that invalid tokens fail before entering the app. |
| Direct ID-RAG tests | Persona graph claim | Unit tests for extraction, retrieval relevance, always-included voice/boundary nodes, token cap, prompt rendering, refresh, package parity. |
| Provider fallback/router tests | Reliability and provider abstraction | Unit tests for fallback before/after partial streaming output, routeTask, provider/model mismatch. |
| Plugin lifecycle tests | Plugin maturity | Register/unregister/dependency/conflict/rollback/hook isolation/prompt fragment tests. |
| Streaming/WS cancellation | Runtime reliability | Abort propagation from HTTP/SSE/WS disconnects into `runTurn` and provider calls. |
| Package parity tests | Extension boundary stability | App/package comparison tests for emotion and ID-RAG behavior. |
| Vite proxy and service worker tests | Frontend contract maturity | Static tests that frontend API paths and precache manifest match actual usage. |
| Multi-file consolidation recovery | Memory reliability | Simulated failure/retry tests for nightly consolidation write plan. |

## Public Narrative Template

Use this when a concise but defensible summary is needed:

> Mio is a local-first companion runtime built as a modular monolith. Its architecture is strong where the product needs it most: durable local memory, code-backed emotion and relationship models, persona graph retrieval, scoped tools, provider adapters, and a shared turn loop across web, WebSocket, OpenAI-compatible, and OneBot surfaces. The evidence supports calling the architecture good and product-aligned. It should not yet be called excellent because server/core composition roots, package drift, optional-auth deployment assumptions, missing cancellation, and several direct-test gaps still need hardening.
