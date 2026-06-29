# ADR-0004: Emotion State Ownership

Status: Proposed

Date: 2026-06-28

## Context

Mio has a sophisticated emotional behavior model: legacy emotion state, PAD, trait-state rolling PAD, legacy affinity, multi-axis relationship, frustration/attachment, relationship progression, ritual/cardboard, ghost silence, reply necessity, personality driver, and dual-mode.

This richness supports the product, but overlapping state machines make it unclear which state owns which behavior.

## Decision

Define an explicit ownership matrix:

| Domain | Proposed Owner | Purpose |
|---|---|---|
| Immediate mood/energy | PAD state | Numeric emotional state and decay. |
| Legacy mood compatibility | Emotion state | Backward-compatible prompt/UI fields. |
| Relationship stage | Relationship progression | Code-gated stage advancement and feature gates. |
| Closeness/trust/neediness | Multi-axis relationship | Relationship dynamics beyond a single affection scalar. |
| Legacy warmth/trust/intimacy/patience/tension | Affinity | Compatibility layer unless formally promoted. |
| Short-lived tension streaks | Frustration | Ephemeral pacing and attachment hints unless persistence is chosen. |
| Ritual/cardboard quality | Ritual subsystem | Conversation quality and recurring ritual detection. |
| Silence policy | Ghost + reply necessity | Code-level decision to answer or stay silent. |
| Persona behavior style | Personality driver / dual-mode | Response style and depth mode. |

Core should call a cohesive emotion/relationship post-turn service rather than directly coordinating every state writer.

## Rationale

- Product behavior benefits from multiple emotional dimensions.
- Architecture needs a source-of-truth policy to avoid contradictory prompt signals.
- Post-turn side effects are currently concentrated in `turn-post-effects.ts`.

## Consequences

Positive:

- Clearer behavior debugging.
- Safer future additions to emotion modules.
- Better test targeting.

Negative:

- Requires migration discipline for legacy compatibility states.
- May expose design decisions about whether frustration should persist.
- Package drift between app and `@mio/emotion` must be resolved.

## Evidence

- Emotion research found parallel state machines and package/app drift.
- `turn-post-effects.ts` aggregates emotion, affinity, frustration, ritual, relationship, learning, dual-mode, life events, memory, and session side effects.
- Tests cover PAD, ghost, affinity, frustration, and progression, but direct multi-axis and ownership tests are still limited.

## Follow-Ups

- Add tests for multi-axis updates and feature-gated attachment derivation.
- Decide whether frustration state is intentionally ephemeral.
- Extract an `emotionTurnService` boundary.
- Resolve `src/emotion` vs `packages/emotion` drift.
