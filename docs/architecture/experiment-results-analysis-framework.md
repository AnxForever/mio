# Experiment Results Analysis Framework

Purpose: define how to analyze and write up future `eval/` results. This complements `docs/architecture/paper-experiment-design.md`, which defines the experiment design before results exist.

Source:

- `eval/README.md`
- `docs/architecture/paper-experiment-design.md`
- `docs/architecture/evidence-traceability-matrix.md`

## Result Interpretation Rule

Do not start with a success story. Start by asking what each metric proves, what it does not prove, and whether the result supports or weakens a specific architecture claim.

Acceptable claim level:

- Mock or dry-run: validates plumbing only.
- Real-provider synthetic scenarios: supports engineering evidence.
- LLM judge: supports comparative scoring with judge limitations.
- Human review sample: supports qualitative interpretation.
- Real user study: required for user wellbeing or relationship outcome claims.

## Research Questions

| ID | Question | Primary evidence |
|---|---|---|
| RQ1 | Does layered memory improve recall and preference continuity? | Variant aggregate and `long_memory` / `user_preference` category rows. |
| RQ2 | Does structured memory reduce hallucinated memory? | `hallucinated_memory_rate`, `memory_score`, failure samples. |
| RQ3 | Does ID-RAG improve persona consistency within token budget? | `persona_score`, `judge_persona_score`, `prompt_tokens`. |
| RQ4 | Does affective state improve support quality? | `support_score`, `judge_support_score`, emotional support examples. |
| RQ5 | Does full policy stack improve privacy/crisis/ghost behavior? | `privacy_score`, `crisis_score`, `ghost_score`, harmful/appropriate silence. |
| RQ6 | Are gains provider-independent? | Provider-grouped aggregate/category tables. |
| RQ7 | Is quality gain worth token/latency cost? | Composite score per prompt token and latency deltas. |

## Ablation Interpretation

| Comparison | Interpretation if improved | Interpretation if flat/regressed |
|---|---|---|
| `window` vs `no_memory` | Short history helps. | Current probes may not require history, or history not injected effectively. |
| `rag` vs `window` | Long-term retrieval adds value. | Retrieval misses, prompt budget trims memory, or scenarios too easy. |
| `structured` vs `rag` | Structured facts improve precision. | Extraction not used, structured facts redundant, or hallucination penalty too weak. |
| `persona` vs `structured` | ID-RAG persona improves identity consistency. | Persona retrieval not relevant, not tested directly, or provider ignores persona fragment. |
| `persona_affect` vs `persona` | Emotion/PAD state improves support tone. | Affect context not salient, scorer insensitive, or prompt cost offsets gains. |
| `full` vs `persona_affect` | Ghost/proactive/policy stack adds complete-system value. | Full stack adds cost or silence risk without scenario benefit. |

## Metrics Explanation

| Metric | Treat as | Do not treat as |
|---|---|---|
| `memory_score` | Recall of seeded expected facts. | Proof of complete memory safety. |
| `temporal_score` | Handling old/new conflict in synthetic scenarios. | Full temporal reasoning benchmark. |
| `preference_score` | Preference continuity in seeded tasks. | Real personalization satisfaction. |
| `privacy_score` | Rule/judge privacy boundary behavior. | Formal privacy guarantee. |
| `crisis_score` | Crisis response compliance in scenarios. | Clinical safety proof. |
| `proactive_score` | Scenario-defined proactive quality. | Proof users want proactive messages. |
| `ghost_score` | Silence decision quality under synthetic probes. | Complete social timing model. |
| `persona_score` | Rule-based persona consistency. | Human-perceived character realism. |
| `support_score` | Rule-based support quality. | Therapeutic efficacy. |
| `judge_*` | LLM-judge qualitative proxy. | Ground truth. |
| `composite_score` | Convenient aggregate. | Sufficient explanation by itself. |
| `harmful_silence` | Silent when response expected. | Complete failure taxonomy. |
| `appropriate_silence` | Silent when silence expected. | Proof of emotional intelligence. |
| `hallucinated_memory_rate` | Unsupported memory claims in scenario rows. | Full hallucination safety across all use. |
| `prompt_tokens` | Prompt cost proxy. | Exact billable cost across providers. |
| `latency_ms` | Runtime cost proxy. | Stable provider performance benchmark. |

## Required Tables

### 1. Variant Aggregate

| Variant | Composite | Memory | Temporal | Preference | Persona | Support | Privacy | Crisis | Ghost | Hallucinated memory | Prompt tokens | Latency ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `no_memory` |  |  |  |  |  |  |  |  |  |  |  |  |
| `window` |  |  |  |  |  |  |  |  |  |  |  |  |
| `rag` |  |  |  |  |  |  |  |  |  |  |  |  |
| `structured` |  |  |  |  |  |  |  |  |  |  |  |  |
| `persona` |  |  |  |  |  |  |  |  |  |  |  |  |
| `persona_affect` |  |  |  |  |  |  |  |  |  |  |  |  |
| `full` |  |  |  |  |  |  |  |  |  |  |  |  |

### 2. Ablation Delta

| Step | Composite delta | Main metric delta | Prompt token delta | Interpretation |
|---|---:|---:|---:|---|
| `window - no_memory` |  |  |  |  |
| `rag - window` |  |  |  |  |
| `structured - rag` |  |  |  |  |
| `persona - structured` |  |  |  |  |
| `persona_affect - persona` |  |  |  |  |
| `full - persona_affect` |  |  |  |  |

### 3. Category Breakdown

| Category | Best variant | Worst variant | Metric used | Architecture implication |
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

### 4. Provider Comparison

| Provider | Model | Variant | Composite | Memory | Persona | Support | Privacy | Crisis | Prompt tokens | Latency ms | Judge error rate |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
|  |  | `no_memory` |  |  |  |  |  |  |  |  |  |
|  |  | `full` |  |  |  |  |  |  |  |  |  |

### 5. Failure Analysis

| Failure class | Detection rule | Example rows | Likely architecture cause | Follow-up |
|---|---|---|---|---|
| Memory miss | Low `memory_score` |  | Retrieval, prompt budget, scenario seeding |  |
| Memory hallucination | High `hallucinated_memory_rate` |  | Unsupported memory claims, weak provenance |  |
| Persona drift | Low `persona_score` / `judge_persona_score` |  | ID-RAG retrieval/rendering, package drift |  |
| Weak support | Low `support_score` / `judge_support_score` |  | Affect context weak, prompt style, provider behavior |  |
| Privacy miss | Low `privacy_score` / `judge_privacy_score` |  | Policy prompt not strong enough, missing code gate |  |
| Crisis miss | Low `crisis_score` / `judge_crisis_score` |  | Detector coverage, prompt override, provider refusal style |  |
| Harmful silence | `harmful_silence = 1` |  | Ghost/reply necessity too aggressive |  |
| Cost regression | Token increase without quality gain |  | Context priority or unnecessary sections |  |

### 6. Qualitative Examples

| Scenario family | Variant | Provider | Response excerpt | Metric result | Human note | Claim impact |
|---|---|---|---|---|---|---|
|  |  |  |  |  |  |  |

## Analysis Procedure

1. Verify run validity:
   - No dry-run rows cited as behavior evidence.
   - Expected scenario count and variant count match.
   - Metric ranges validated.
   - Provider keys and judge mode documented.

2. Read aggregate trends:
   - Identify best/worst variants by composite.
   - Compute deltas between adjacent ablations.
   - Check whether token/latency cost grows with quality.

3. Read category trends:
   - Each scenario family should support or challenge a specific architecture claim.
   - Do not explain all failures as provider issues before checking prompt/context placement.

4. Compare providers:
   - Look for directionally consistent ablation trends.
   - Separate provider-specific style from architecture effect.
   - Report skipped providers and judge errors.

5. Inspect failures:
   - Sample all harmful silence rows.
   - Sample hallucinated memory rows.
   - Sample low crisis/privacy rows.
   - Sample high-token flat-quality rows.

6. Write claim updates:
   - Strengthen claims only when metrics and qualitative examples agree.
   - Downgrade claims when direct evidence contradicts assumptions.

## Conclusion Boundaries

Safe conclusion examples:

> In synthetic companion scenarios, variants with long-term retrieval can be compared against no-memory and window-only baselines using rule and LLM-judge metrics.

> If `persona` improves persona scores over `structured`, the result supports the value of persona context, but direct ID-RAG tests are still needed to attribute the gain specifically to graph retrieval.

> If `full` improves ghost/proactive scores without increasing harmful silence, the full policy stack is promising under benchmark conditions.

Unsafe conclusion examples:

> Mio proves real user wellbeing benefits.

> Mio has clinically safe crisis handling.

> Mio's memory is always correct.

> Mio is provider-independent under all models.

> ID-RAG is proven solely because `persona` variant scored higher.

## Report Outline

1. Experiment setup
   - date, commit, provider list, judge mode, scenario count, variants.
2. Validity checks
   - row counts, metric range checks, dry-run flag, skipped providers.
3. Main result
   - aggregate table and ablation delta.
4. Category result
   - scenario-family table.
5. Provider result
   - provider-grouped table.
6. Failure analysis
   - memory, persona, support, privacy, crisis, silence, cost.
7. Architecture interpretation
   - which claims strengthened, weakened, or remain unproven.
8. Threats to validity
   - synthetic scenarios, LLM judge, provider drift, prompt-token proxy.
9. Next work
   - tests, prompt/context changes, human review, real-provider replication.

## Claim Update Matrix

| Result pattern | Claim update |
|---|---|
| Memory variants improve recall and reduce hallucination | Strengthen layered memory claim. |
| Persona variant improves persona score but ID-RAG tests absent | Strengthen persona-context claim, not graph-specific proof. |
| Persona variant flat or worse | Inspect graph retrieval, prompt budget, package drift. |
| Full variant improves support but costs many tokens | Claim quality gain with cost trade-off. |
| Full variant increases harmful silence | Downgrade ghost/reply-necessity maturity. |
| Provider trends disagree | Claim architecture is provider-sensitive. |
| LLM judge errors frequent | Treat judge metrics as unreliable for that run. |

## Artifact Checklist

Archive these with every report:

- `v1-scenarios.json`
- `v1-aggregate.csv` or `providers-aggregate.csv`
- `v1-details.csv` or `providers-details.csv`
- `v1-category.csv` or `providers-category.csv`
- `v1-summary.json` or `providers-summary.json`
- charts directory
- `metric-contract.md`
- `validation-report.md`
- command used
- provider/model list
- judge provider/model
- dry-run flag
- date and commit hash
- feature flag values relevant to eval

