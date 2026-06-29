# Mio Architecture Audit Agents

This document defines a repeatable multi-role review panel for judging whether
Mio's architecture is strong enough for its product goal: a local-first,
stateful emotional companion agent with multiple channels, persistent memory,
persona evolution, and web UI.

## How To Use

For every major architecture change, run the review through all agents below.
Each agent must return:

- Verdict: `excellent`, `good`, `mixed`, or `weak`
- Top strengths
- Top risks
- Required changes before merge
- Optional follow-ups

Use this scoring:

- `5`: strong design, low risk, fits project direction
- `4`: good design, manageable issues
- `3`: acceptable but needs explicit trade-offs
- `2`: fragile or over-coupled
- `1`: blocks long-term maintainability or safety

## Agent 1: Principal Architect

Mission: Judge the whole system shape and module boundaries.

Questions:

- Does the architecture match the product: local-first, stateful, personal agent?
- Are major responsibilities separated into stable layers?
- Is the central orchestration code kept small enough to reason about?
- Are extension points real, or only nominal?

Checks:

- `src/core/agent-loop.ts` orchestration size and responsibilities
- Direction of dependencies between `core`, `server`, `memory`, `emotion`, `persona`, `providers`, `tools`
- Reusable package boundaries in `packages/emotion` and `packages/idrag`
- Public contracts in `src/types.ts`

Red flags:

- More business logic moving into `server/index.ts`
- `agent-loop.ts` becoming the only place where new features can be integrated
- Package copies drifting from `src/` implementations

## Agent 2: Runtime Reliability Engineer

Mission: Judge whether the system survives real usage, provider failures, large
state, and long-running processes.

Questions:

- Are slow or unreliable operations isolated from the main turn path?
- Does provider failure degrade predictably?
- Are background schedulers and async side effects observable?
- Can the local state recover from corrupt or missing files?

Checks:

- `src/providers/*`
- `src/scheduler/*`
- `src/memory/vector.ts`
- `src/memory/sqlite-vector.ts`
- `src/core/inference-loop.ts`
- logging through `src/utils/logger.ts`

Red flags:

- Network calls inside prompt assembly
- Unbounded transcript or memory loading
- Async side effects that fail silently without useful logs
- Long-running scans that do not ignore `node_modules`, `dist`, or generated data

## Agent 3: Memory Systems Reviewer

Mission: Judge whether memory is coherent, scoped, retrievable, and safe.

Questions:

- Is short-term, mid-term, long-term, procedural, persona, and transcript memory clearly separated?
- Are cross-user and external IM sessions isolated?
- Is retrieval explicit enough to debug?
- Is consolidation idempotent and recoverable?

Checks:

- `src/memory/paths.ts`
- `src/memory/transcript.ts`
- `src/memory/vector.ts`
- `src/memory/search.ts`
- `src/memory/structured-memory.ts`
- `src/memory/consolidation-phases.ts`
- `src/core/tool-runtime.ts`

Red flags:

- Inline filesystem paths outside `src/memory/paths.ts`
- Shared memory visible to isolated IM sessions
- Durable memory updated directly from low-confidence inference without review
- Search APIs that mix transcript, user, and global scope implicitly

## Agent 4: Agent Behavior and Prompt Architect

Mission: Judge whether prompt construction, persona, tools, and emotion state
produce controllable behavior.

Questions:

- Is persona defined in one canonical source?
- Is prompt assembly deterministic and budget-aware?
- Are tool permissions scoped by session and persona?
- Are emotion and relationship state machines influencing behavior without
  turning into hidden prompt spaghetti?

Checks:

- `src/prompt/context-engine.ts`
- `src/prompt/templates.ts`
- `src/persona/extractor.ts`
- `src/persona/graph.ts`
- `src/persona/layered.ts`
- `src/emotion/*`
- `src/core/tool-runtime.ts`

Red flags:

- Duplicated persona rules in prompts and `soul.md`
- Prompt sections added without priority or budget behavior
- Tools exposed to isolated sessions by default
- Behavior changes implemented only as prompt text when they need code gates

## Agent 5: Security and Privacy Reviewer

Mission: Judge whether a local personal agent protects private state and avoids
cross-channel leakage.

Questions:

- Is authentication enforced for write/admin paths?
- Are uploaded files validated and path-scoped?
- Are external bridge sessions memory-isolated?
- Are secrets kept out of logs and responses?

Checks:

- `src/server/auth.ts`
- `src/server/rate-limit.ts`
- `src/server/index.ts`
- `src/validation.ts`
- `src/core/tool-runtime.ts`
- `src/memory/paths.ts`

Red flags:

- Any endpoint writing files without Zod validation
- Path joins outside the path helpers
- Token or API key logged
- IM bridge sessions reading global memory or powerful tools

## Agent 6: Product Scalability Reviewer

Mission: Judge whether the architecture can keep adding channels, personas,
memory features, and UI views without collapsing.

Questions:

- Can a new chat channel be added without changing agent behavior internals?
- Can a new provider be added by implementing an adapter?
- Can a new emotion or memory module be added without modifying many files?
- Are large frontend views split enough for continued iteration?

Checks:

- `src/server/openai-compat.ts`
- `src/server/onebot.ts`
- `src/providers/index.ts`
- `src/plugins/*`
- `web/js/views/*`
- `web/js/store.js`

Red flags:

- Every new feature needs edits in `server/index.ts` and `agent-loop.ts`
- Provider quirks leak into core prompt or memory logic
- Frontend view modules exceed maintainable size without local components

## Current Mio Initial Review

Overall verdict: `good`, with excellent product-architecture fit and a few
clear maintainability pressure points.

Scores:

- Principal Architect: `4/5`
- Runtime Reliability Engineer: `3/5`
- Memory Systems Reviewer: `4/5`
- Agent Behavior and Prompt Architect: `4/5`
- Security and Privacy Reviewer: `4/5`
- Product Scalability Reviewer: `3/5`

Strengths:

- The product shape fits a modular monolith: local-first, stateful, file-backed,
  with a single process coordinating server, CLI, tools, memory, and schedulers.
- Provider abstraction is clean: Anthropic native and OpenAI-compatible adapters
  share internal `Message`, `ToolCall`, and `ContentBlock` contracts.
- Prompt construction is budget-aware through `ContextEngine`, which is better
  than ad hoc string concatenation.
- Memory has real layers: transcripts, bookmarks, structured memory, vector
  store, persona graph, procedural memory, and nightly consolidation.
- Tool scoping is implemented in runtime code, not only by prompt instruction.
- The test surface is broad for a personal-agent project.

Risks:

- `src/core/agent-loop.ts` is still the central integration pressure point even
  after the first-stage refactor. It remains the file most likely to accumulate
  cross-cutting feature logic.
- `src/server/index.ts` is large and mixes many route families in one file.
  HTTP plumbing is thin, but route registration volume is becoming hard to scan.
- `src/` and `packages/` contain parallel implementations for emotion and ID-RAG
  modules. This is useful for packaging, but it creates drift risk.
- Several source files are large enough to deserve focused follow-up splitting:
  `agent-loop.ts`, `server/index.ts`, `structured-memory.ts`, `persona/graph.ts`,
  and large frontend view/CSS files.
- Architecture tooling must explicitly exclude dependency and generated folders;
  full recursive scans are too slow in the current workspace.

Required next architecture improvements:

1. Continue splitting `agent-loop.ts` by phase, while keeping behavior stable:
   turn preparation, early-exit policy, inference stage, and post-turn effects.
2. Move server route families into route modules without changing endpoint
   contracts: chat, persona/mod, memories, admin, bridges, voice/uploads.
3. Define a drift policy for `src/emotion` vs `packages/emotion` and
   `src/persona` vs `packages/idrag`: source-of-truth generation, shared
   internal package usage, or explicit divergence.
4. Add an architecture audit command or script that scans only relevant source
   directories and ignores `node_modules`, `dist`, `data`, and generated files.

Decision:

Mio's architecture is already stronger than a typical prototype because its
state, memory, provider, prompt, and tool boundaries are explicit. It is not yet
excellent because the integration layer is still too concentrated and some
packaged modules can drift from app-local modules.
