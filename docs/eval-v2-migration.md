# Mio Eval V2 Migration Report

Generated from `eval/results/v2-smoke/` on 2026-06-27.

## Purpose

Eval v2 addresses the main ambiguity found in the MiniMax error analysis: when a richer variant fails, v1 cannot reliably tell whether the expected information was absent from storage, trimmed out of the prompt, present but unused by the model, or under-credited by the judge.

## What Changed

1. **Prompt-section trace**

   Each v2 detail row includes `prompt_sections_json`, generated from `ContextEngine.getTrace()`. The trace records section type, priority, included/trimmed state, character count, token estimate, expected fact ids found in the section, and resolved section content.

2. **Retrieval trace**

   Each v2 detail row includes `retrieval_trace_json`. It records prompt-level section inclusion, memory section inclusion/trimming, persona section inclusion/trimming, memory-bank file presence, structured-memory file presence, persona-graph file presence, candidate counts, and per-expected-fact hit flags.

3. **Same-session and cross-session baselines**

   v2 splits the old `window` baseline into:

   - `window_same_session`: seeded history and probe remain in one session.
   - `window_cross_session`: seeded history is written before the probe, but the probe starts a new session without long-term memory sections.

   This separates recent conversational continuity from cross-session retrieval.

4. **Ghost-silence scoring**

   v2 introduces `ghost_policy_score`. For `ghost_silence` scenarios, `composite_score` uses `ghost_policy_score` directly, so an intentionally empty response is not penalized by response-text memory/persona metrics.

5. **Composite decomposition**

   v2 detail rows add:

   - `task_composite_score`
   - `policy_composite_score`
   - `ghost_policy_score`
   - `composite_version`

   This makes it possible to discuss task quality and policy behavior separately.

## Smoke Eval

Command:

```bash
MIO_PROVIDER=mock node --experimental-strip-types eval/run.ts \
  --eval-version v2 \
  --providers mock \
  --variants window_same_session,window_cross_session,full \
  --max-scenarios 2 \
  --result-dir eval/results/v2-smoke
```

Generated artifacts:

- `eval/results/v2-smoke/providers-details.json`
- `eval/results/v2-smoke/providers-details.csv`
- `eval/results/v2-smoke/providers-summary.json`
- `eval/results/v2-smoke/providers-aggregate.csv`
- `eval/results/v2-smoke/providers-category.csv`
- `eval/results/v2-smoke/metric-contract.md`
- `eval/results/v2-smoke/validation-report.md`
- `eval/results/v2-smoke/real-model-eval-report.md`
- `eval/results/v2-smoke/charts/*.svg`

## Smoke Results

Source: `eval/results/v2-smoke/providers-summary.json`.

| variant | composite | task | policy | prompt tokens |
|---|---:|---:|---:|---:|
| `window_same_session` | 0.426 | 0.852 | 0.000 | 404 |
| `window_cross_session` | 0.128 | 0.255 | 0.000 | 405 |
| `full` | 0.500 | 1.000 | 0.000 | 1411 |

Trace validation from `eval/results/v2-smoke/providers-details.json`:

- Detail rows: 6.
- Rows with prompt sections: 6.
- Rows with parseable retrieval trace JSON: 6.
- `memory-1` expected facts in prompt:
  - `window_same_session`: 4.
  - `window_cross_session`: 0.
  - `full`: 4.

This confirms that v2 can distinguish same-session context availability from cross-session retrieval availability.

## Compatibility Notes

Eval v1 remains available as the default. Existing commands and result file names continue to work unless `--eval-version v2` is passed. When `--result-dir` is used with v2, the scenario artifact is written as `v2-scenarios.json`.

The current trace is eval-oriented and intentionally verbose. It should not be enabled for user-facing logs without redaction, because prompt sections can contain personal memory content.

## Next Migration Steps

1. Run the full 60-scenario v2 benchmark with deterministic `mock`.
2. Re-run MiniMax-M3 on v2 once prompt-trace storage has been reviewed for data sensitivity.
3. Add an LLM judge that returns both scores and rationales.
4. Add bootstrap confidence intervals over scenario-level v2 metrics.
5. Add a compact trace export mode for paper supplements.
