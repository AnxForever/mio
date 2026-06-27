# Mio Paper Eval V1

Evaluation harness for turning Mio's companion-agent architecture into paper-ready experimental evidence.

Run:

```bash
npm run eval:paper
```

The default command builds `dist/`, runs with `MIO_PROVIDER=mock`, disables MiniMax embeddings, and evaluates the deterministic companion provider against synthetic multi-turn scenarios.

Real-provider replication uses the same 60 scenarios x 7 ablation variants, but writes provider-grouped outputs to a separate result directory:

```bash
node --experimental-strip-types eval/run.ts \
  --providers mock,minimax,deepseek,qwen,openai \
  --result-dir eval/results/real-model \
  --judge llm \
  --judge-provider minimax
```

If provider API keys are missing, use `--dry-run` to validate routing, schemas, provider grouping, charts, and reports without making real API calls:

```bash
node --experimental-strip-types eval/run.ts \
  --providers mock,minimax \
  --dry-run \
  --variants no_memory,full \
  --max-scenarios 2 \
  --result-dir eval/results/real-model-dry-run-smoke \
  --judge llm \
  --judge-provider mock
```

## Benchmark Scope

`eval/run.ts` generates 60 synthetic scenarios from 6 user profiles x 10 scenario families:

- `long_memory`
- `temporal_conflict`
- `emotional_support`
- `user_preference`
- `privacy_boundary`
- `crisis_safety`
- `proactive_message`
- `ghost_silence`
- `persona_consistency`
- `token_cost_tradeoff`

Each scenario contains seeded multi-turn history, a final probe, expected facts, success signals, forbidden signals, and hallucination probes.

## Ablation Variants

- `no_memory`: static prompt, no seeded history, most dynamic sections disabled.
- `window`: seeded history in the same session, long-term memory sections disabled.
- `rag`: seeded cross-session history plus bookmark/vector retrieval.
- `structured`: `rag` plus structured memory extraction.
- `persona`: structured memory plus persona graph context.
- `persona_affect`: structured memory plus persona and affective state.
- `full`: full Mio prompt/policy stack, including ghost/proactive-related features.

## Outputs

- `eval/results/v1-aggregate.csv`: aggregate metrics by variant.
- `eval/results/v1-details.csv`: scenario-level rows with matched facts and generated responses.
- `eval/results/v1-category.csv`: variant/category slice metrics.
- `eval/results/v1-summary.json`: machine-readable summary with aggregate/category tables and chart paths.
- `eval/results/v1-details.json`: full detail rows.
- `eval/results/v1-scenarios.json`: generated scenario definitions.
- `eval/results/charts/*.svg`: bar charts for composite score, support score, and prompt-token cost.
- `eval/results/experiment-report.md`: paper-facing experiment summary.
- `eval/results/metric-contract.md`: metric definitions, formulas, data sources, and validation rules.
- `eval/results/validation-report.md`: executed validation checks for scenario coverage, row counts, score ranges, and grouping consistency.

When `--result-dir <dir>` is provided, the runner writes provider-grouped outputs:

- `<dir>/providers-aggregate.csv`: aggregate metrics by provider/model/dry-run/variant.
- `<dir>/providers-details.csv`: scenario-level rows with provider/model metadata, rule scores, judge scores, matched facts, and responses.
- `<dir>/providers-category.csv`: provider/model/variant/category slice metrics.
- `<dir>/providers-summary.json`: machine-readable summary with provider runs, aggregate/category rows, chart paths, and provider split file paths.
- `<dir>/providers/<provider-model-real|dry-run>/*.csv|summary.json`: per-provider split artifacts.
- `<dir>/charts/*.svg`: provider/variant charts for composite, support, prompt tokens, and judge support score.
- `<dir>/real-model-eval-report.md`: provider-grouped report.
- `<dir>/metric-contract.md` and `<dir>/validation-report.md`: metric definitions and executed validation checks.

## Metrics

The rule judge reports:

- `memory_score`
- `temporal_score`
- `preference_score`
- `privacy_score`
- `crisis_score`
- `proactive_score`
- `ghost_score`
- `persona_score`
- `support_score`
- `judge_support_score`
- `judge_persona_score`
- `judge_privacy_score`
- `judge_crisis_score`
- `composite_score`
- `harmful_silence`
- `appropriate_silence`
- `hallucinated_memory_rate`
- `prompt_tokens`
- `latency_ms`

All numeric scores and rates are validated to stay in `[0, 1]`; token and latency values must be finite and non-negative.

## Useful Options

```bash
node --experimental-strip-types eval/run.ts --variants rag,full
node --experimental-strip-types eval/run.ts --judge rule
node --experimental-strip-types eval/run.ts --out eval/results/custom.csv
node --experimental-strip-types eval/run.ts --scenarios eval/scenarios/custom.json
node --experimental-strip-types eval/run.ts --providers mock,minimax --result-dir eval/results/real-model
node --experimental-strip-types eval/run.ts --providers minimax --model MiniMax-M3 --result-dir eval/results/minimax
node --experimental-strip-types eval/run.ts --providers minimax,deepseek --models minimax:MiniMax-M3,deepseek:deepseek-chat
node --experimental-strip-types eval/run.ts --providers mock,minimax --dry-run --max-scenarios 2 --result-dir eval/results/smoke
```

`--judge llm` uses Mio's provider selector. Set `--judge-provider` / `--judge-model`, or `MIO_EVAL_JUDGE_PROVIDER` / `MIO_EVAL_JUDGE_MODEL`, to use a real model that returns judge JSON:

```bash
node --experimental-strip-types eval/run.ts --judge llm --judge-provider minimax --result-dir eval/results/real-model
```

The LLM judge scores four dimensions: emotional support, persona consistency, privacy boundary, and crisis safety. If the judge output is unavailable or not valid JSON, rule scores remain intact and the row records `judge_error`; `--judge-provider mock` uses a deterministic judge substitute for dry-run validation only.

## Reproducibility Notes

- Runtime state is isolated under `eval/.data/`.
- The default deterministic provider is designed to expose whether each variant placed the required information into the prompt.
- Synthetic scenarios are engineering benchmarks, not user-study evidence.
- Rows with `dry_run=1` validate experiment plumbing only and must not be cited as real-provider behavioral evidence.
- Production-provider and human/LLM-judge passes should be run as a second-stage validation before claiming external behavioral results.
