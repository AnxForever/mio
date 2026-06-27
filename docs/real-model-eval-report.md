# Real-Model Eval Report

Generated from `eval/results/real-model-minimax/` and `eval/results/real-model-minimax-smoke/` on 2026-06-27.

## Current Status

The real-provider replication path has been executed with MiniMax credentials loaded from `.env`. The key was present in the execution environment after loading `.env`, and the report intentionally does not record the secret value.

The MiniMax smoke run used real MiniMax for both the evaluated probe provider and the LLM judge:

```bash
set -a; source .env; set +a
node --experimental-strip-types eval/run.ts \
  --providers minimax \
  --variants no_memory,full \
  --max-scenarios 2 \
  --result-dir eval/results/real-model-minimax-smoke \
  --judge llm \
  --judge-provider minimax
```

The smoke run produced 4 detail rows across 1 provider, 2 variants, and 2 scenarios. It passed validation with `dry_run=0`, `provider_error` count 0, and `judge_error` count 0. This verifies both the MiniMax probe route and the MiniMax LLM-judge route.

The full MiniMax run used real MiniMax for the evaluated probe provider and the deterministic mock judge for the LLM-judge-shaped support/persona/privacy/crisis fields:

```bash
set -a; source .env; set +a
node --experimental-strip-types eval/run.ts \
  --providers minimax \
  --result-dir eval/results/real-model-minimax \
  --judge llm \
  --judge-provider mock
```

The full run produced 420 detail rows across 1 provider, 7 variants, and 60 scenarios. It passed validation with `dry_run=0`, `provider_error` count 0, and `judge_error` count 0.

## Full MiniMax Aggregate Results

Source: `eval/results/real-model-minimax/providers-summary.json`.

| variant | composite | memory | support | privacy | crisis | judge_support | judge_persona | ghost | prompt tokens |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `no_memory` | 0.381 | 0.000 | 0.014 | 0.500 | 0.681 | 0.287 | 0.863 | 0.000 | 545 |
| `window` | 0.460 | 0.103 | 0.000 | 0.500 | 0.667 | 0.350 | 0.946 | 0.000 | 479 |
| `rag` | 0.451 | 0.137 | 0.000 | 0.528 | 0.667 | 0.345 | 0.883 | 0.000 | 693 |
| `structured` | 0.456 | 0.158 | 0.000 | 0.500 | 0.667 | 0.350 | 0.871 | 0.000 | 752 |
| `persona` | 0.445 | 0.176 | 0.014 | 0.556 | 0.681 | 0.344 | 0.842 | 0.000 | 1298 |
| `persona_affect` | 0.416 | 0.164 | 0.000 | 0.500 | 0.667 | 0.314 | 0.767 | 0.000 | 1424 |
| `full` | 0.456 | 0.143 | 0.000 | 0.528 | 0.667 | 0.352 | 0.792 | 1.000 | 1412 |

In this MiniMax run, `window` has the highest aggregate composite score at 0.460 and the lowest average prompt-token count at 479. `full` activates the ghost-silence policy signal with ghost score 1.000 and appropriate silence rate 0.100, but it does not improve aggregate composite score over `window` under the current judge configuration.

## Error Analysis

A follow-up error analysis is stored in `docs/minimax-error-analysis/report.md`. It compares `persona`, `persona_affect`, and `full` against `window` and `rag` at scenario and category level, generating 360 target-baseline comparisons from the MiniMax detail rows.

The error analysis found that `full` has 19 negative-composite scenarios against `window` and 15 against `rag`. The dominant failure buckets are extra context without composite gain, context non-use or non-retrieval, and literal success-signal misses. This supports a cautious interpretation: the MiniMax run validates real-provider execution and exposes state-channel behavior, but it does not show a robust full-stack quality advantage over the recent-window baseline.

## MiniMax Smoke Aggregate Results

Source: `eval/results/real-model-minimax-smoke/providers-summary.json`.

| variant | composite | memory | judge_support | judge_persona | judge_privacy | judge_crisis | prompt tokens | latency ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `no_memory` | 0.250 | 0.000 | 0.190 | 0.060 | 0.210 | 0.240 | 578 | 15066 |
| `full` | 0.625 | 0.500 | 0.600 | 0.685 | 0.785 | 0.775 | 1386 | 9930 |

This smoke result is intentionally small. It is useful as API and judge-route evidence, not as a publishable behavioral comparison.

## Generated Artifacts

- `eval/results/real-model-minimax/providers-aggregate.csv`
- `eval/results/real-model-minimax/providers-details.csv`
- `eval/results/real-model-minimax/providers-category.csv`
- `eval/results/real-model-minimax/providers-summary.json`
- `eval/results/real-model-minimax/providers-details.json`
- `eval/results/real-model-minimax/providers/minimax-MiniMax-M3-real/summary.json`
- `eval/results/real-model-minimax/providers/minimax-MiniMax-M3-real/details.csv`
- `eval/results/real-model-minimax/providers/minimax-MiniMax-M3-real/aggregate.csv`
- `eval/results/real-model-minimax/providers/minimax-MiniMax-M3-real/category.csv`
- `eval/results/real-model-minimax/charts/composite-score.svg`
- `eval/results/real-model-minimax/charts/support-score.svg`
- `eval/results/real-model-minimax/charts/prompt-tokens.svg`
- `eval/results/real-model-minimax/charts/judge-support-score.svg`
- `eval/results/real-model-minimax/metric-contract.md`
- `eval/results/real-model-minimax/validation-report.md`
- `eval/results/real-model-minimax/real-model-eval-report.md`
- `eval/results/real-model-minimax-smoke/providers-summary.json`
- `eval/results/real-model-minimax-smoke/validation-report.md`

## Validation Summary

Source: `eval/results/real-model-minimax/validation-report.md`.

- Scenario count: 60.
- Unique scenario IDs: 60.
- Required dimensions: long memory, temporal conflict, emotional support, user preference, privacy boundary, crisis safety, proactive message, ghost silence, persona consistency, and token-cost tradeoff.
- Detail rows: 420, equal to 1 provider x 7 variants x 60 scenarios.
- Aggregate rows: 7 provider/variant groups.
- Category rows: 70 variant/category groups.
- All detail scores and rates are in `[0, 1]`.
- Prompt-token and latency values are finite and non-negative.

## Evidence Boundary

The full result is real MiniMax probe evidence for Mio's provider-routed benchmark, not a human preference study and not a safety certification. The full run used a deterministic mock judge for the LLM-judge-shaped emotional support, persona consistency, privacy, and crisis scores. The MiniMax LLM judge route is verified only on the 2-scenario smoke subset.

Rows with non-empty `provider_error` or `judge_error` should be excluded from behavioral comparison tables or reported separately as infrastructure failures. The current MiniMax full run has 0 such rows.

The next publishable evidence step should extend the same 60 scenario x 7 variant benchmark to additional real providers and add human or independently validated LLM judging for emotional support, persona consistency, privacy boundary handling, and crisis safety.
