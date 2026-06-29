# Mio Architecture Proof Pack

Purpose: provide reusable, evidence-backed architecture claims for README, papers, talks, or investor/product reviews.

Current architecture verdict: `good, not excellent`.

This document intentionally avoids inflated claims. Mio has strong product-architecture fit, but it still has maintainability, reliability, security, and test gaps.

## Executive Summary

Mio is best described as a local-first, stateful companion-agent runtime implemented as a modular monolith. Its strongest architecture qualities are:

- Durable local memory as a layered subsystem, not just chat history.
- Persona as a graph and overlay system, not only a static prompt.
- Code-backed emotional and relationship state machines.
- Compact provider/tool boundaries around LLM inference and agent actions.
- Multiple protocol surfaces routed through one behavior core.
- Broad deterministic regression tests plus eval-oriented quality gates.

The architecture should not be called excellent yet. The main blockers are composition-root concentration, package drift, optional-auth assumptions, missing cancellation, frontend cache/proxy drift, and direct-test gaps.

## Claim 1: Mio Is A Local-First Stateful Runtime

Short version:

Mio is not a stateless chatbot. It is a local-first runtime that keeps memory, persona, emotion, relationship, and transcript state on disk.

Evidence:

- `src/memory/*` owns transcripts, memory bank, structured memory, vector search, lorebook, procedural memory, and consolidation.
- `src/emotion/*` and `src/relationship/*` persist companion state across turns.
- `src/persona/*` and mod `soul.md` provide persistent character identity.
- Server, CLI, schedulers, and bridge adapters all route through the same core turn path.

Best wording:

> Mio is a local-first companion runtime built as a modular monolith: one process, explicit domain modules, and durable local state.

Avoid:

> Mio is a distributed agent platform.

## Claim 2: Memory Is Layered And Reviewable

Short version:

Mio treats memory as a stack: transcripts, bookmarks, active context, vector search, structured memory, review, lorebook, procedural memory, and prompt context.

Evidence:

- Architecture research found append-only transcripts, memory bank, active context, vector recall, structured entities, mid-term topics, lorebook, procedural memory, entity graph, and nightly consolidation.
- Tests cover vector incremental indexing, SQLite vector behavior, structured extraction, memory review propagation, semantic memory, recall scope, compression, and IM isolation.
- Frontend has a Memories view for review/edit/delete flows.

Best wording:

> Mio's memory system turns raw conversation into reviewable long-term context through layered local stores and retrieval paths.

Avoid:

> Mio has perfect memory safety.

Reason:

Search scope, broad memory files, and multi-file consolidation recovery still need hardening.

## Claim 3: Persona Is A Source Hierarchy

Short version:

Mio's persona is not a single prompt blob. `soul.md` is the primary archetype source, but runtime behavior also includes graph retrieval, per-user overlays, preferences, relationship context, and behavior modes.

Evidence:

- `src/persona/graph.ts` extracts and retrieves persona graph nodes.
- `src/persona/layered.ts` provides kernel/delta/preference rendering.
- `src/persona/dual-mode.ts` and `src/persona/driver.ts` shape runtime behavior.
- Persona Studio and mod management allow active `soul.md` editing/generation.

Best wording:

> `soul.md` defines the character archetype; ID-RAG and per-user overlays make it context-sensitive at runtime.

Avoid:

> `soul.md` is the only persona source.

## Claim 4: Behavior Is Enforced In Code, Not Only Prompt Text

Short version:

Mio implements important behavior gates in code: crisis, ghost/reply necessity, tool isolation, relationship stages, emotional state updates, and prompt budget priority.

Evidence:

- Relationship stages have code-level gates.
- Isolated IM sessions expose only `current_time`.
- Ghost and reply-necessity paths can produce silent turns.
- `ContextEngine` enforces prompt section priority and budgets.
- Tests cover crisis, ghost, tool loop, prompt hard caps, IM isolation, and progression wiring.

Best wording:

> Mio uses prompts for style and context, but key safety and behavior policies are runtime decisions.

Avoid:

> Mio's behavior is fully deterministic.

Reason:

LLM generation remains probabilistic and multiple overlapping state machines shape context.

## Claim 5: Provider And Tool Boundaries Are Pragmatic

Short version:

The LLM provider layer and tool layer use compact internal contracts. Vendors and tools are adapted into Mio-native messages, tool definitions, and tool calls.

Evidence:

- `AIProvider` / `StreamingProvider` contracts are small.
- Anthropic and OpenAI-compatible adapters map different wire formats into the same internal shape.
- `fetchWithRetry` provides timeout/retry primitives.
- Tool runtime scopes tools by session isolation and persona allowlist.
- Tool loop has max-turn guardrails.

Best wording:

> Providers and tools are adapter boundaries around the turn loop, not vendor logic scattered through the agent core.

Avoid:

> Provider fallback and plugin behavior are fully mature.

Reason:

Fallback/routing/plugin lifecycle need direct tests and design cleanup.

## Claim 6: Protocol Bridges Preserve One Behavior Core

Short version:

Native web chat, SSE, WebSocket, OpenAI-compatible requests, and OneBot events route into `runTurn`, preserving a single behavior core.

Evidence:

- Server/API research found native HTTP, SSE, WS, OpenAI-compatible bridge, OneBot bridge, memory review, analytics, notifications, backup/export, onboarding, and Persona Studio.
- Smoke/E2E tests exercise native routes, OpenAI compatibility, OneBot behavior, and WebSocket events.

Best wording:

> Mio supports multiple client protocols while keeping companion behavior centralized in the core turn loop.

Avoid:

> The server layer is thin.

Reason:

`src/server/index.ts` is now the largest hotspot and should be split by route family.

## Claim 7: Regression Awareness Is Strong

Short version:

Mio has a broad deterministic test suite and eval harness for a personal-agent project.

Evidence:

- `npm test` runs build plus core, memory, emotion, bridge, HTTP, isolation, prompt, and frontend view-model tests.
- Golden turn regression protects observable `runTurn` behavior.
- Eval harness defines synthetic companion scenarios and ablation variants.

Best wording:

> Mio combines deterministic mock-provider regression tests with scenario-based quality evaluation.

Avoid:

> Test coverage is complete.

Reason:

Direct tests are missing for plugin lifecycle, provider fallback/routing, ID-RAG retrieval/rendering, native route auth, frontend PWA/dev-server behavior, actual browser workflows, and cancellation.

## One-Slide Architecture Narrative

Mio's architecture is good because it fits the product:

1. A personal companion needs durable memory, not stateless chat.
2. A local-first product benefits from a modular monolith, not distributed services.
3. A companion persona needs layered identity and relationship overlays, not a single prompt.
4. Emotional behavior needs explicit state machines and gates, not only LLM style instructions.
5. Multiple client protocols should share one behavior core.
6. A stateful agent needs deterministic regression tests plus scenario evals.

The architecture is not yet excellent because the same ambition has created integration pressure:

1. Server, core, and frontend view files are too broad.
2. Package/app implementations can drift.
3. Localhost-first security needs stronger deployment boundaries.
4. Streaming cancellation and fallback semantics need hardening.
5. Several high-risk boundaries need direct tests.

## Recommended Public Summary

Use this paragraph when a compact external-facing summary is needed:

> Mio is a local-first emotional companion runtime implemented as a modular monolith. Its architecture centers on a stateful turn loop, layered local memory, code-backed emotion and relationship models, ID-RAG persona retrieval, scoped tools, and provider adapters. This gives Mio stronger product fit than a stateless chatbot architecture. The current system is good and research-backed, but not yet excellent: the next architecture work is to split composition roots, formalize package ownership, harden security/reliability boundaries, and add direct tests around the remaining high-risk seams.
