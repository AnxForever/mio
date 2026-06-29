# ADR-0001: Local-First Modular Monolith

Status: Proposed

Date: 2026-06-28

## Context

Mio is a stateful emotional companion agent. It keeps local memory, persona state, emotion state, transcripts, vector indexes, background schedulers, web UI state, and bridge sessions. The product is personal and local-first rather than multi-tenant SaaS.

The architecture research found clear domain modules under `src/`: `memory`, `emotion`, `server`, `core`, `tools`, `providers`, `persona`, `scheduler`, `prompt`, `relationship`, `voice`, `plugins`, and others. The runtime dependencies are focused and the deployment shape is a single Node.js process with local files and SQLite vector storage.

## Decision

Mio should be described and evolved as a local-first modular monolith with ports/adapters tendencies.

It should not be split into microservices unless future requirements introduce independent deployment, multi-tenant isolation, or operational scale needs that outweigh local simplicity.

## Rationale

- A single process fits local-first privacy and operational simplicity.
- Durable local state is easier to reason about when memory, persona, emotion, schedulers, and bridge adapters share one consistency boundary.
- Provider and tool abstractions already provide adapter-style extension points without requiring process boundaries.
- Microservices would add network failure, deployment, and state coordination overhead without solving the current bottlenecks.

## Consequences

Positive:

- Simple install and local operation.
- Shared local filesystem and SQLite state are natural primitives.
- Cross-domain turn orchestration remains debuggable in one process.

Negative:

- Composition roots can become large. Current hotspots include `src/server/index.ts`, `src/core/agent-loop.ts`, and frontend view controllers.
- Isolation must be enforced in code because there is no process boundary between channels.
- Internal module boundaries need discipline and tests.

## Evidence

- `docs/research/architecture-review-long-task.md`: stage verdict is `good, not excellent`.
- Module distribution shows real domain vocabulary: `memory`, `emotion`, `server`, `core`, `tools`, `providers`, `persona`, `scheduler`, `prompt`.
- Large-file scan shows the main risk is concentration, not wrong deployment pattern.
- Tests cover core turn behavior, bridge behavior, memory isolation, tool restrictions, and local-state flows.

## Follow-Ups

- Split route families out of `src/server/index.ts`.
- Extract prompt/persona/memory context providers from `src/core/agent-loop.ts`.
- Maintain a module boundary review before major feature additions.
