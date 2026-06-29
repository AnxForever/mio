# Paper-Level Experiment Design

Source: `eval/README.md` and `docs/research/architecture-review-long-task.md`

Purpose: turn Mio's architecture claims into reproducible experimental evidence without changing product code.

## Scope

This design evaluates Mio as a local-first emotional companion runtime. It focuses on whether the architecture improves memory use, persona consistency, emotional support, safety boundaries, proactive behavior, silence decisions, token cost, and provider portability.

It is not a user study. Synthetic scenarios and LLM judges can support engineering and paper prototypes, but claims about real user outcomes require a later human study.

## Research Questions

| ID | Question |
|---|---|
| RQ1 | Does layered memory improve factual recall and preference continuity compared with no memory or window-only history? |
| RQ2 | Does ID-RAG persona retrieval improve persona consistency without excessive prompt-token growth? |
| RQ3 | Do affective state modules improve emotional support behavior compared with persona and memory alone? |
| RQ4 | Do privacy, crisis, and ghost-silence policies reduce unsafe responses or harmful silence? |
| RQ5 | How much quality is gained per additional prompt token across ablation variants? |
| RQ6 | Are results stable across supported provider families, or are gains provider-specific? |

## Hypotheses

| ID | Hypothesis | Primary metrics |
|---|---|---|
| H1 | `rag`, `structured`, and later variants outperform `no_memory` and `window` on long-memory tasks. | `memory_score`, `hallucinated_memory_rate` |
| H2 | `persona` and later variants outperform `structured` on persona tasks. | `persona_score`, `judge_persona_score` |
| H3 | `persona_affect` and `full` outperform `persona` on emotional support tasks. | `support_score`, `judge_support_score` |
| H4 | `full` performs best on proactive and ghost-silence tasks without increasing harmful silence. | `proactive_score`, `ghost_score`, `harmful_silence`, `appropriate_silence` |
| H5 | Architecture gains are not free; later variants increase `prompt_tokens` and may increase `latency_ms`. | `prompt_tokens`, `latency_ms`, `composite_score` |
| H6 | Provider rankings may differ, but relative ablation trends should remain directionally consistent. | Provider-grouped aggregate and category tables |

## Scenario Families

The existing eval harness defines 60 synthetic scenarios from 6 user profiles x 10 scenario families:

| Family | Architectural claim tested |
|---|---|
| `long_memory` | Long-term memory retrieval and stable factual recall. |
| `temporal_conflict` | Resolution of old vs new facts. |
| `emotional_support` | Supportive response quality under affective context. |
| `user_preference` | Preference retention and personalized response selection. |
| `privacy_boundary` | Refusal or boundary behavior around private/sensitive data. |
| `crisis_safety` | Crisis detection and safe response policy. |
| `proactive_message` | Proactive-message relevance and timing quality. |
| `ghost_silence` | Appropriate silence vs harmful silence. |
| `persona_consistency` | Character voice, boundaries, and identity stability. |
| `token_cost_tradeoff` | Quality/cost trade-off across context variants. |

## Ablation Variants

| Variant | Meaning | Expected role |
|---|---|---|
| `no_memory` | Static prompt, no seeded history, most dynamic sections disabled. | Baseline for context-free behavior. |
| `window` | Seeded same-session history, long-term sections disabled. | Tests short-context memory only. |
| `rag` | Cross-session history plus bookmark/vector retrieval. | Tests retrieval-based memory. |
| `structured` | `rag` plus structured memory extraction. | Tests entity/fact/decision structure. |
| `persona` | Structured memory plus persona graph context. | Tests ID-RAG persona contribution. |
| `persona_affect` | Structured memory plus persona and affective state. | Tests emotion/persona integration. |
| `full` | Full Mio prompt/policy stack, including ghost/proactive-related features. | Tests complete architecture. |

## Metrics

Rule and judge metrics from the current eval harness:

| Metric | Use |
|---|---|
| `memory_score` | Correct recall of seeded facts. |
| `temporal_score` | Handles updated or conflicting temporal facts. |
| `preference_score` | Retains and applies user preferences. |
| `privacy_score` | Respects privacy boundaries. |
| `crisis_score` | Handles crisis/safety scenarios. |
| `proactive_score` | Quality of proactive-message behavior. |
| `ghost_score` | Silence decision quality. |
| `persona_score` | Rule-based persona consistency. |
| `support_score` | Rule-based emotional support quality. |
| `judge_support_score` | LLM-judge support quality. |
| `judge_persona_score` | LLM-judge persona quality. |
| `judge_privacy_score` | LLM-judge privacy quality. |
| `judge_crisis_score` | LLM-judge crisis quality. |
| `composite_score` | Aggregate quality summary. |
| `harmful_silence` | Silence when response was required. |
| `appropriate_silence` | Silence when silence was acceptable or desired. |
| `hallucinated_memory_rate` | Memory claims not supported by seeded facts. |
| `prompt_tokens` | Context cost proxy. |
| `latency_ms` | Runtime cost proxy. |

All numeric scores and rates should stay within `[0, 1]`; token and latency values must be finite and non-negative.

## Execution Plan

### Stage 1: Deterministic Plumbing

Command:

```bash
npm run eval:paper
```

Purpose:

- Validate scenario generation.
- Validate row counts, metric ranges, charts, and report generation.
- Establish deterministic baseline under `MIO_PROVIDER=mock`.

Evidence level:

Engineering correctness only. Mock-provider results should not be cited as real behavioral performance.

### Stage 2: Dry-Run Provider Matrix

Command:

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

Purpose:

- Validate provider grouping, schemas, split artifacts, charts, and judge plumbing without real API calls.

Evidence level:

Experiment infrastructure only.

### Stage 3: Real-Provider Replication

Command:

```bash
node --experimental-strip-types eval/run.ts \
  --providers mock,minimax,deepseek,qwen,openai \
  --result-dir eval/results/real-model \
  --judge llm \
  --judge-provider minimax
```

Purpose:

- Compare ablation trends across providers.
- Separate architecture contribution from one provider's behavior.
- Produce provider-grouped report artifacts.

Evidence level:

Paper-prototype behavioral evidence, assuming provider keys are configured and judge output is valid.

### Stage 4: Human Review Sample

Sample:

- At least 5 examples per scenario family.
- Include best, median, and worst rows by `composite_score`.
- Include all harmful-silence rows and high hallucinated-memory rows.

Purpose:

- Catch metric blind spots.
- Confirm whether rule and LLM judge scores match human interpretation.

Evidence level:

Qualitative validation, not statistically powered user evidence.

## Result Tables

### Variant Aggregate

| Variant | Composite | Memory | Persona | Support | Privacy | Crisis | Ghost | Hallucinated memory | Prompt tokens | Latency ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `no_memory` |  |  |  |  |  |  |  |  |  |  |
| `window` |  |  |  |  |  |  |  |  |  |  |
| `rag` |  |  |  |  |  |  |  |  |  |  |
| `structured` |  |  |  |  |  |  |  |  |  |  |
| `persona` |  |  |  |  |  |  |  |  |  |  |
| `persona_affect` |  |  |  |  |  |  |  |  |  |  |
| `full` |  |  |  |  |  |  |  |  |  |  |

### Category Breakdown

| Category | Best variant | Worst variant | Main metric | Interpretation |
|---|---|---|---|---|
| `long_memory` |  |  | `memory_score` |  |
| `temporal_conflict` |  |  | `temporal_score` |  |
| `emotional_support` |  |  | `support_score` |  |
| `user_preference` |  |  | `preference_score` |  |
| `privacy_boundary` |  |  | `privacy_score` |  |
| `crisis_safety` |  |  | `crisis_score` |  |
| `proactive_message` |  |  | `proactive_score` |  |
| `ghost_silence` |  |  | `ghost_score` |  |
| `persona_consistency` |  |  | `persona_score` |  |
| `token_cost_tradeoff` |  |  | `composite_score / prompt_tokens` |  |

### Provider Comparison

| Provider | Model | Variant | Composite | Judge support | Judge persona | Privacy | Crisis | Prompt tokens | Latency ms | Notes |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|
|  |  | `no_memory` |  |  |  |  |  |  |  |  |
|  |  | `full` |  |  |  |  |  |  |  |  |

### Failure Analysis

| Failure type | Definition | Rows to inspect | Likely architecture implication |
|---|---|---|---|
| Memory hallucination | Unsupported remembered fact. | `hallucinated_memory_rate > 0` | Retrieval or prompt provenance needs tightening. |
| Harmful silence | Silence when user needed response. | `harmful_silence = 1` | Ghost/reply-necessity policy too aggressive. |
| Privacy miss | Reveals or uses data against expected boundary. | Low `privacy_score` or `judge_privacy_score` | Privacy policy should move from prompt-only to stronger code gates. |
| Crisis miss | Unsafe or insufficient crisis response. | Low `crisis_score` or `judge_crisis_score` | Crisis detection/escalation requires hardening. |
| Persona drift | Voice/boundary mismatch. | Low `persona_score` or `judge_persona_score` | Persona retrieval/rendering or package parity issue. |
| Cost regression | Quality gain smaller than prompt-token increase. | High `prompt_tokens`, flat `composite_score` | Context budget priorities need tuning. |

### Qualitative Examples

| Scenario | Variant | Provider | Response excerpt | Scores | Human note |
|---|---|---|---|---|---|
|  |  |  |  |  |  |

## Artifacts To Archive

For each paper-facing run, archive:

- Scenario definitions: `v1-scenarios.json`
- Aggregate rows: `v1-aggregate.csv` or `providers-aggregate.csv`
- Scenario details: `v1-details.csv` or `providers-details.csv`
- Category slices: `v1-category.csv` or `providers-category.csv`
- Summary JSON: `v1-summary.json` or `providers-summary.json`
- Charts under `charts/`
- `metric-contract.md`
- `validation-report.md`
- Generated experiment report
- Environment metadata: commit hash, provider/model list, judge provider/model, dry-run flag, date, and relevant feature flags.

## Threats To Validity

- Synthetic scenarios are not user studies.
- Dry-run validates plumbing only and must not be cited as model behavior.
- Mock-provider results validate architecture wiring, not real response quality.
- LLM judges can be biased by provider style and prompt wording.
- Real provider drift can change results across dates.
- Scenario coverage may underrepresent multilingual, long-horizon, attachment, or adversarial use.
- Token count is a proxy for cost and may not match provider billing exactly.
- Latency depends on network, provider load, and local machine state.

## Claim Standards

Acceptable after deterministic and dry-run stages:

> The evaluation harness can compare Mio architecture variants across memory, persona, affect, safety, silence, and cost dimensions.

Acceptable after real-provider replication:

> In synthetic companion scenarios, Mio's fuller architecture variants can be compared against ablations using rule and LLM-judge metrics.

Avoid until human or longitudinal evidence exists:

> Mio is proven to improve real user wellbeing.

> Mio has human-level emotional understanding.

> Mio's memory is safe or complete under all user behavior.

## Current Verdict

The existing `eval/` harness is a strong starting point for paper-level engineering evidence. The next research step is not to add more architecture claims, but to run the staged experiment, archive artifacts, and tie each claim in `architecture-proof-pack.md` to a specific metric table or qualitative example.
