# Module Boundary Review

Source: `docs/research/architecture-review-long-task.md`

Purpose: summarize the current module dependency shape before any architecture refactor. This review is read-only and focuses on import direction, composition hotspots, cycles, and boundary risks.

## Method

The dependency scan used the current worktree as the source of truth.

Scope:

- TypeScript files under `src/` and `packages/`.
- Relative and workspace-internal imports.
- Directory-level edges normalized by top-level module, for example `core -> memory`.
- File fan-out counted by distinct internal import targets.
- Strongly connected components identified at both directory and file level.

Important constraint:

The scan detects static import structure. It does not prove runtime call frequency, data volume, or behavioral correctness. Those need tests and targeted runtime tracing.

## High-Level Result

Scanned TypeScript files: `165`

The architecture has real domain vocabulary and useful module separation, but dependency direction is not yet clean enough to claim excellent modularity. The strongest pressure points remain the core turn path, server composition root, side-effect hub, and app/package duplication boundaries.

## Top Internal Import Fan-Out

| Rank | File | Internal imports | Interpretation |
|---:|---|---:|---|
| 1 | `src/core/agent-loop.ts` | 52 | Main orchestration hotspot. Still coordinates prompt, persona, memory, inference, tools, and state transitions. |
| 2 | `src/server/index.ts` | 37 | Server composition hotspot. Aggregates many route families and protocol bridges. |
| 3 | `packages/emotion/src/index.ts` | 25 | Public package barrel. High fan-out is acceptable if it stays a pure export surface. |
| 4 | `src/core/turn-post-effects.ts` | 23 | Side-effect hub after a turn: memory, emotion, analytics, scheduling, and persistence pressure meet here. |
| 5 | `src/scheduler/proactive.ts` | 16 | Scheduler integrates state, memory, quality, and provider behavior. |
| 6 | `src/core/turn-prepare.ts` | 15 | Pre-turn composition hotspot for context and prompt inputs. |

Interpretation:

- `agent-loop.ts` and `server/index.ts` are confirmed composition roots, not accidental large files.
- The current `turn-*` split is a useful improvement, but the highest-risk dependencies have moved into preparation and post-effect phases.
- `packages/emotion/src/index.ts` should be watched separately from app logic. A barrel file can import broadly without being a design smell, but it must not become behavior orchestration.

## Dominant Directory Edges

| Edge | Count | Meaning |
|---|---:|---|
| `core -> emotion` | 22 | Turn processing directly depends on emotion state, tracking, classification, ghost, and relationship effects. |
| `core -> memory` | 17 | Core directly assembles memory context and writes turn outcomes. |
| `emotion -> memory` | 16 | Emotion modules persist and retrieve state through the memory layer. |
| `server -> memory` | 16 | Server exposes memory/admin/review/search surfaces directly. |
| `core -> tools` | 11 | Tool runtime is correctly under turn orchestration, but core remains tightly aware of tool setup. |
| `scheduler -> memory` | 11 | Proactive and nightly jobs depend heavily on persisted state. |
| `core -> persona` | 9 | Persona graph and driver logic are still pulled into turn composition. |

Interpretation:

- `core` is allowed to depend on domain modules, but the amount of direct context assembly makes it harder to evolve memory/persona/emotion independently.
- `server -> memory` is expected for admin and review APIs, but the route family should be explicit so memory operations can be audited.
- `emotion -> memory` is acceptable if memory is the persistence port. It becomes risky if emotion modules start depending on broad memory-bank behavior instead of narrow state APIs.

## Strongly Connected Components

Directory-level SCCs:

- `config.ts`, `emotion`, `learning`, `memory`, `relationship`, `utils`
- `core`, `onboarding`, `scheduler`, `server`

File-level SCCs:

- `src/config.ts`, `src/memory/bank.ts`, `src/memory/paths.ts`
- `src/memory/embedding.ts`, `src/memory/sqlite-vector.ts`, `src/memory/vector.ts`
- `src/scheduler/proactive-quality.ts`, `src/scheduler/proactive.ts`

Interpretation:

- File-level cycles are limited and mostly infrastructure/vector/scheduler related. They are not currently the main architecture blocker.
- Directory-level cycles show broader shared-state coupling. This is common in a stateful local-first app, but it weakens claims that modules are independently replaceable.
- The `config.ts` / `paths.ts` / `bank.ts` cycle deserves attention because those modules act as cross-cutting infrastructure. It should not grow into a general dependency hub.
- The `core` / `server` / `scheduler` / `onboarding` cycle indicates that runtime entry points and long-running processes are not fully layered.

## Boundary Findings

### Core Boundary

Current shape:

`runTurn` is the right behavioral center, but surrounding files still directly compose prompt sections, persona retrieval, memory retrieval, inference, tools, post-turn persistence, and scheduler-facing effects.

Risk:

New behavior context may keep increasing core fan-out unless domain modules expose narrower context-provider interfaces.

Recommendation:

- Keep `runTurn` as the public behavior entry point.
- Extract prompt-facing providers for memory, persona, and emotion context.
- Add boundary tests for semantic memory, persona graph rendering, prompt budget trimming, and golden turn behavior before moving logic.

### Server Boundary

Current shape:

`src/server/index.ts` is the largest file and imports broadly across memory, persona, mod, notification, bridge, analytics, and admin concerns.

Risk:

Route-specific security, request parsing, upload handling, and protocol behavior are hard to audit when route families share one file.

Recommendation:

- Split route families after native auth tests exist.
- Keep `server/index.ts` as the Express and WebSocket composition root.
- Make public/protected route decisions explicit per module.

### Memory Boundary

Current shape:

Memory is a real subsystem with transcripts, bank files, structured memory, vector search, lorebook, procedural memory, consolidation, and review flows.

Risk:

Because memory is central to product value, many modules import it directly. Multi-file consolidation and broad prompt-facing memory surfaces can create hidden consistency risks.

Recommendation:

- Keep all disk paths routed through `src/memory/paths.ts`.
- Prefer narrow state APIs over direct file access.
- Add recovery tests around consolidation before changing write flow.

### Persona Boundary

Current shape:

Persona is split between `soul.md`, graph extraction/retrieval, driver behavior, dual-mode switching, layered rendering, and package code in `packages/idrag`.

Risk:

Persona behavior is architecturally strong, but package/app drift can make the boundary unreliable for reuse.

Recommendation:

- Treat `soul.md` as the archetype source, not the only runtime persona source.
- Add package parity tests for ID-RAG extraction, retrieval, and prompt rendering.
- Resolve known gender-mode vocabulary drift before presenting the package as a stable external API.

### Emotion Boundary

Current shape:

Emotion, relationship, PAD, affinity, frustration, ritual, and ghost behavior are code-backed state machines with package/app copies.

Risk:

The design is product-aligned, but ownership between `src/emotion` and `packages/emotion` is not fully clean.

Recommendation:

- Accept the package drift ADR before refactoring.
- Define whether app code or package code is the source of truth per module.
- Add parity tests for PAD, ritual, affinity, and relationship-stage behavior.

## Rules For Future Modules

- New feature modules should not import `server` directly.
- New feature modules should not import `core` unless they are explicit turn-loop collaborators.
- Route modules may call domain services, but domain services should not call route modules.
- Prompt fragments should be provided through stable context-provider contracts, not assembled ad hoc inside `agent-loop.ts`.
- Disk writes should go through existing memory/path helpers.
- Package code must either share source with app modules or have parity tests documenting intentional divergence.

## Refactor Order

1. Add the P0 boundary tests from `pre-code-test-checklist.md`.
2. Split server route families while preserving endpoint contracts.
3. Extract memory/persona/emotion prompt-context providers from core.
4. Formalize app/package ownership and parity tests.
5. Re-run the import and SCC scan after each structural change.

## Current Verdict

The module structure is good and domain-aware, but not yet excellent. Mio has the right major boundaries for a local-first companion runtime; the remaining issue is that several boundaries are enforced by convention and tests rather than by narrow interfaces and import direction.
