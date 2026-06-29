# ADR-0005: Package Drift Policy

Status: Proposed

Date: 2026-06-28

## Context

Mio has internal packages:

- `@mio/emotion`
- `@mio/idrag`

Architecture research found parallel implementations between `src/` and `packages/`. Some files are identical or nearly identical, while others have meaningful behavior drift. The most concrete issue found was `packages/idrag` generator code checking `boyfriend/girlfriend` while package types expose `male/female`.

## Decision

Choose one of these policies before treating packages as stable extension boundaries:

Option A: Package as source of truth.

- App imports package modules through injected I/O.
- `src/` no longer keeps parallel behavior copies.

Option B: App source as source of truth with generated package snapshots.

- Package files are generated or synchronized from app modules.
- CI checks parity.

Option C: Explicit divergence.

- Package APIs are documented as embeddable subsets.
- Divergences are intentional and tested.

Recommended policy: Option B short term, Option A long term if package reuse becomes a priority.

## Rationale

- Current drift weakens package trust.
- App-local behavior appears more current in some cases.
- A parity policy is cheaper than debugging inconsistent package behavior later.

## Consequences

Positive:

- Clearer package reliability.
- Safer external reuse.
- Easier test targeting.

Negative:

- Requires build/test tooling around parity.
- Some internal modules may need I/O injection cleanup.
- Short-term package changes may be blocked until source-of-truth is resolved.

## Evidence

- Emotion package drift was found across most paired files except a small subset.
- ID-RAG package drift includes a concrete generator gender mismatch.
- Tests did not directly prove package/app parity.

## Follow-Ups

- Fix `@mio/idrag` generator gender mismatch.
- Add parity tests for exported package behavior.
- Document package scope in README/package docs.
- Avoid adding new public package APIs until drift policy is accepted.
