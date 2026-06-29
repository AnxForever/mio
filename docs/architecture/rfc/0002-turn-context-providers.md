# RFC-0002: Extract Turn Context Providers From `agent-loop.ts`

Status: Proposed

Owner role: Principal Architect + Agent Behavior Reviewer

Source evidence:

- `docs/architecture/module-boundary-review.md`
- `docs/architecture/risk-priority-backlog.md#r-002-core-promptcontext-concentration`
- `docs/architecture/evidence-traceability-matrix.md`

## Problem

`src/core/agent-loop.ts` remains the highest internal import fan-out file. The current turn split is useful, but core still directly composes memory context, persona retrieval, prompt sections, semantic memory prefetch, builder-chain evaluation, emotion/PAD/relationship prompt fragments, tool setup, and inference staging.

This makes prompt behavior hard to change safely. It also weakens module boundaries because memory, persona, and emotion context are assembled inside core rather than exposed by domain-owned providers.

## Goals

- Keep `runTurn()` as the public behavior entry point.
- Move prompt-facing context assembly into domain-owned providers.
- Keep `ContextEngine` as the budget/trimming mechanism.
- Make each context provider directly testable.
- Preserve current prompt content and golden-turn behavior during extraction.

## Non-Goals

- No prompt redesign.
- No behavior quality tuning.
- No removal of memory/persona/emotion features.
- No plugin rewrite.
- No provider/tool loop changes except where needed to pass context.

## Preconditions

Add or confirm tests before moving logic:

| Test area | Required coverage |
|---|---|
| Golden turn | Observable `runTurn` output and transcript side effects stay stable. |
| Context engine | Critical sections survive hard caps; priority trimming is stable. |
| Semantic memory | Relevant old memory is injected when expected. |
| ID-RAG | Graph extraction, retrieval, prompt rendering, token cap, refresh detection, package parity. |
| Persona overlays | Kernel, explicit preferences, relationship prompt, isolated directive handling. |
| Safety | Crisis override remains applied after prompt-context refactor. |

## Proposed Design

Introduce a small provider contract:

```ts
export interface TurnContextProvider {
  id: string;
  collect(input: TurnContextInput): Promise<TurnContextSection[]>;
}

export interface TurnContextSection {
  id: string;
  type: 'identity' | 'persona' | 'memory' | 'emotion' | 'relationship' | 'tool' | 'policy' | 'meta';
  priority: 'critical' | 'high' | 'medium' | 'low';
  content: string;
}
```

The exact TypeScript shape can differ, but the architecture should preserve these properties:

- Provider identity is explicit.
- Returned sections are data, not pre-concatenated global prompt strings.
- `ContextEngine` still owns budget and trimming.
- Domain modules own their own retrieval/rendering logic.

## Candidate Providers

| Provider | Owns | Current pressure relieved |
|---|---|---|
| `coreIdentityProvider` | Static identity and safety policy fragments. | Keeps prompt identity explicit. |
| `personaContextProvider` | `soul.md`, ID-RAG retrieval, persona delta, dual-mode/persona driver fragments. | Removes graph retrieval and persona rendering from `agent-loop.ts`. |
| `memoryContextProvider` | semantic memory, bookmarks, structured memory, lorebook, procedural memory, relations. | Removes memory retrieval composition from core. |
| `emotionContextProvider` | emotion, PAD, affinity, frustration, attachment, ritual/cardboard. | Centralizes affective prompt context. |
| `relationshipContextProvider` | relationship stage, gates, shared memories, progress. | Clarifies source of relationship prompt state. |
| `learningContextProvider` | mirror, feedback, dynamic few-shot. | Keeps learning prompt fragments out of core. |
| `timeContextProvider` | current time and circadian fragments. | Small utility provider. |
| `pluginContextProvider` | plugin prompt fragments. | Preserves plugin extension point. |

## Target Flow

```text
runTurn
  -> prepare turn
  -> resolve session context
  -> collect domain context providers
  -> register sections into ContextEngine
  -> build final system prompt
  -> run inference loop
  -> post-turn side effects
```

Core should orchestrate the sequence, not own the domain-specific retrieval details.

## Migration Plan

1. Add ID-RAG and prompt-context contract tests.
2. Extract pure prompt section registration into a small assembler with no behavior changes.
3. Move persona graph retrieval/rendering into `personaContextProvider`.
4. Move semantic/structured/lorebook/procedural memory rendering into `memoryContextProvider`.
5. Move emotion/PAD/affinity/frustration/ritual rendering into `emotionContextProvider`.
6. Move learning/few-shot/mirror/feedback fragments into `learningContextProvider`.
7. Re-run golden turn and prompt budget tests after each extraction.
8. Re-run import fan-out scan and compare `agent-loop.ts`.

## Acceptance Criteria

- `runTurn()` remains the public API.
- `agent-loop.ts` no longer directly calls persona graph retrieval primitives.
- `agent-loop.ts` no longer directly assembles all memory prompt sections.
- Each major domain provider has direct tests or is covered by existing domain tests.
- Golden turn, context engine, semantic memory, persona, crisis, and tool-loop tests pass.
- Import fan-out for `agent-loop.ts` materially decreases.

## Risks

| Risk | Mitigation |
|---|---|
| Prompt output changes accidentally | Snapshot/golden prompt-section tests before extraction. |
| Context providers become a second monolith | Keep providers domain-owned and small. |
| Budget priority changes | Preserve `ContextEngine` priorities and hard caps. |
| Safety override moves to wrong layer | Keep crisis override in final prompt assembly and test it directly. |

## Definition Of Done

This RFC is implemented only when core remains the turn orchestrator, domain modules own prompt fragments, and behavior is protected by direct tests rather than informal prompt inspection.

