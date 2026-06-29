# ADR-0003: Persona Source Hierarchy

Status: Proposed

Date: 2026-06-28

## Context

Mio's documentation and code often describe `soul.md` as the single personality source. Architecture research found this is directionally useful but too broad.

Actual behavior is layered: immutable kernel, active mod `soul.md`, ID-RAG persona graph, per-user persona deltas, explicit preferences, relationship context, memory/lorebook context, few-shot examples, personality driver, dual-mode behavior, builder-chain fragments, and character life events.

## Decision

Use this vocabulary:

- `soul.md` is the primary character-archetype source.
- Runtime persona behavior is produced by a hierarchy of dynamic overlays.
- Overlays must be documented and ordered so future changes do not create hidden prompt conflicts.

Recommended hierarchy:

1. Immutable identity kernel.
2. Active mod `soul.md`.
3. ID-RAG persona graph fragment derived from `soul.md`.
4. Per-user persona delta and explicit preferences.
5. Relationship stage and shared-memory context.
6. Lorebook / procedural / few-shot context.
7. Runtime behavior modes such as personality driver and dual-mode.
8. Safety and channel constraints.

## Rationale

- The current product needs dynamic personalization and channel isolation.
- Calling `soul.md` the only persona source hides real behavior layers.
- A documented hierarchy lets the team preserve `soul.md` as canonical archetype while allowing safe overlays.

## Consequences

Positive:

- More accurate architecture language.
- Easier prompt debugging.
- Better separation between character content and runtime policy.

Negative:

- Requires tests for overlay precedence.
- Some existing documentation may need wording updates.
- Core prompt assembly remains a hotspot until persona context is extracted.

## Evidence

- Persona research found mod-backed `soul.md`, ID-RAG graph, per-user overlays, explicit preferences, personality driver, and dual-mode.
- `src/core/agent-loop.ts` still owns persona retrieval and prompt injection.
- Tests cover layered persona and preference critical sections, but direct ID-RAG retrieval tests are missing.

## Follow-Ups

- Add direct ID-RAG tests for extraction, retrieval, stage relevance, trigger matching, budget behavior, and refresh detection.
- Extract a persona context provider so core asks for a persona fragment rather than owning graph calls.
- Update README/doc wording from "single personality source" to "primary character-archetype source."
