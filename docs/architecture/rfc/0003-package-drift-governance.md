# RFC-0003: Govern App/Package Drift

Status: Proposed

Owner role: Principal Architect + Product Scalability Reviewer

Source evidence:

- `docs/architecture/adr/0005-package-drift-policy.md`
- `docs/architecture/module-boundary-review.md`
- `docs/architecture/evidence-traceability-matrix.md`
- `docs/architecture/risk-priority-backlog.md#r-003-package-drift-in-emotion-and-id-rag`

## Problem

Mio has app modules under `src/` and package modules under `packages/`. The package direction is useful, but current research found meaningful drift:

- `src/emotion` and `packages/emotion` can differ in behavior.
- `src/persona` and `packages/idrag` can differ in vocabulary and runtime assumptions.
- Known ID-RAG gender/mode vocabulary drift exists between package expectations and app usage.

Without governance, packages become unreliable as extension boundaries. Bug fixes may land in one copy and not the other.

## Goals

- Define source-of-truth ownership per package area.
- Make intentional divergence explicit.
- Add package parity tests before advertising package stability.
- Preserve local app velocity while making reusable packages trustworthy.

## Non-Goals

- No immediate package publishing plan.
- No monorepo restructure.
- No requirement to move all app code into packages.
- No API redesign without separate ADR.

## Ownership Models

Choose one model per subsystem:

| Model | Meaning | Use when |
|---|---|---|
| Package is source of truth | App imports package implementation directly. | Behavior should be reusable and stable. |
| App is source of truth | Package is generated or synced from app implementation. | App behavior changes faster than package API. |
| Intentional fork | App and package differ by design. | Runtime host needs app-only behavior. Requires docs and tests. |

## Proposed Ownership Decisions

| Area | Proposed owner | Rationale |
|---|---|---|
| PAD math and decay | Package source of truth | Pure domain logic, reusable, easy to test. |
| Classifier/lexical mood | Package source of truth or shared source | Mostly pure logic. |
| Ghost silence | App source of truth until IM constraints are modeled in package | App has bridge-specific no-ghost behavior. |
| Emotion tracker | App source of truth | App tracker wires memory, relationship, feature flags, and persistence. |
| ID-RAG graph extraction/retrieval/rendering | Package source of truth after parity tests | Strong reusable domain boundary. |
| Persona driver and dual-mode | App source of truth | Runtime-specific and coupled to current companion behavior. |
| Package barrels | Package-owned export surface only | High fan-out is acceptable if no orchestration logic lives there. |

## Required Parity Tests

| Package | Parity test |
|---|---|
| `@mio/emotion` | PAD update, decay, trait state, affinity/multi-axis deltas, ritual scoring, ghost decisions where expected. |
| `@mio/idrag` | `extractGraphFromSoul`, `retrieveRelevantNodes`, `graphToPrompt`, token cap, stage relevance, voice/boundary inclusion, empty soul fallback. |
| App/package integration | App context provider output matches package-rendered ID-RAG fragment for representative `soul.md` fixtures. |

## Drift Register

Create a living drift register in package docs or ADR appendix:

| Drift item | Intentional? | Owner | Test required | Removal condition |
|---|---|---|---|---|
| Emotion tracker app-only side effects | Yes | App | App tracker tests | Package exposes host hooks. |
| IM bridge no-ghost behavior | Temporary | App | Ghost parity with bridge fixture | Package models session isolation. |
| ID-RAG gender/mode vocabulary mismatch | No | Package | ID-RAG parity test | Vocabulary normalized. |

## Migration Plan

1. Add package parity tests with current behavior documented.
2. Fix known unintended drift, starting with ID-RAG vocabulary mismatch.
3. Decide ownership model per module and document it in package READMEs.
4. Move pure logic toward package source-of-truth where tests are stable.
5. Keep app-specific orchestration in `src/`.
6. Add CI/test script entries for parity checks.

## Acceptance Criteria

- Every app/package duplicate area has an ownership model.
- Unintended drift has a test that fails before the fix and passes after it.
- Intentional drift is documented with rationale and removal condition.
- Package public APIs do not promise behavior that only exists in app code.
- Package parity tests are part of the regular test path before package stability is claimed.

## Risks

| Risk | Mitigation |
|---|---|
| Moving too much into packages slows app iteration | Keep orchestration app-owned. |
| Parity tests freeze bad behavior | Mark tests as current-contract first, then improve through ADR-backed changes. |
| Package API churn | Stabilize pure logic first, defer runtime orchestration APIs. |

## Definition Of Done

This RFC is implemented only when package consumers can know whether they are using the same behavior as the app, and CI can detect unintended divergence.

