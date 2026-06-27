# Mio: A State-Coupled Architecture for Long-Horizon Emotional Companion Agents

Paper draft v0. This is a technical-report style draft based on the current codebase, `docs/paper-plan.md`, and `eval/results/`. It intentionally avoids claims of clinical efficacy, real-user preference, or deployment safety.

## Abstract

Long-horizon companion agents require more than factual recall. They must maintain an evolving model of the user, preserve a coherent persona, adapt to affective and relational context, respect privacy and safety boundaries, and decide when actions such as silence or proactive check-ins are appropriate. We present Mio, a working companion-agent architecture that couples long-term memory, structured temporal facts, persona retrieval, PAD-style affect, multi-axis relationship state, crisis guardrails, silence policy, proactive policy, and a web-facing interaction loop. Mio exposes these state channels through a priority-bounded prompt context and updates them as side effects of each conversational turn. To evaluate the architecture, we introduce a synthetic companion benchmark with 60 multi-turn scenarios spanning long-term memory, temporal conflicts, emotional support, user preferences, privacy boundaries, crisis safety, proactive messaging, ghost silence, persona consistency, and token/cost tradeoffs. Across 7 ablation variants and 420 scenario-variant runs, memory-enabled variants outperform a no-memory baseline on composite score; affective variants improve support-rule scores; and the full policy stack uniquely activates appropriate ghost silence, at a substantial prompt-token cost. A second 420-row MiniMax-M3 run verifies the real-provider execution path for the same benchmark. These results support Mio as a reproducible systems testbed for studying state-coupled companion agents, while highlighting the need for broader multi-provider, human-judged, and safety-focused evaluation before making claims about real-world companionship quality.

## 1. Introduction

LLM-based companions are increasingly expected to remember personal context, respond with emotional sensitivity, and maintain a stable identity across long interactions. However, many systems treat these capabilities as separable add-ons: memory retrieval is evaluated independently from persona consistency, emotional support is tested in short self-contained dialogues, and safety policies are often measured with single-turn probes. A long-horizon companion agent instead needs a unified state loop where memory, identity, affect, relationship state, and action policy jointly shape each response.

Mio explores this design space as an implemented companion-agent architecture. The system maintains multiple persistent state channels: transcripts and bookmarks, structured memories, temporal entity relations, a persona graph derived from `soul.md`, PAD affect, multi-axis affinity, relationship stage, crisis flags, ghost-silence state, proactive activity patterns, and prompt-budget state. A central turn loop retrieves and composes these channels into a bounded context, calls a provider, executes tools when needed, persists side effects, and updates post-turn emotional and memory state.

The central research question is not whether Mio is a better chatbot in general. The question is whether coupling companion-relevant state channels inside one turn loop creates measurable differences over memory-only or prompt-only variants.

## 2. Research Questions

RQ1. Does explicit affect and relationship state improve long-horizon emotional-support responses beyond memory-only personalization?

RQ2. Does structured and temporal memory improve recall, conflict handling, and user modeling over a static prompt or recent-window baseline?

RQ3. Does persona retrieval provide a useful mechanism for maintaining identity without injecting the full persona into every prompt?

RQ4. Can silence and proactive-message policies be evaluated as first-class companion-agent behavior rather than as incidental generation artifacts?

RQ5. What prompt-token cost is introduced by richer companion state?

## 3. Contributions

This draft claims four contributions:

1. A working state-coupled architecture for long-horizon emotional companion agents, implemented in Mio.
2. A turn-loop formulation that composes memory, persona, affect, relationship, safety, and action-policy state under a prompt budget.
3. A synthetic multi-dimensional benchmark for companion-agent ablations, covering 60 scenarios across 10 scenario families.
4. An initial ablation study across 7 variants, producing CSV/JSON results, category summaries, SVG charts, a metric contract, and a validation report.

The paper does not claim therapeutic efficacy, real-user preference, or clinical safety.

## 4. Related Work

Long-term conversational memory systems such as MemoryBank and MemGPT show that persistent memory can improve multi-session dialogue and companion behavior. LoCoMo extends this line by evaluating very long-term conversational memory with event-grounded multi-session dialogues. Mio builds on this motivation but studies memory as one channel in a broader companion state loop.

Persona-conditioned dialogue work, beginning with PersonaChat, shows that explicit profile information can improve specificity and consistency. Recent role-playing and persona benchmarks further show that persona fidelity is multi-dimensional. Mio represents persona as a graph derived from the active `soul.md` and retrieves relevant persona nodes under a token budget.

Emotional support dialogue work such as ESConv defines emotional-support conversation and support strategies. ES-MemEval and LifeSide move closer to Mio's target by connecting long-term memory, emotional support, privacy, and user modeling. Mio's current benchmark is smaller and synthetic but follows the same motivation: companion agents should be evaluated on memory and emotional appropriateness together.

Generative Agents and ReAct motivate architectures where LLM behavior is mediated by memory, action, and environment interaction. Mio applies this systems view to a single companion agent with persistent affective and relational state.

The PAD model motivates Mio's affect representation, but Mio uses PAD as an engineering state rather than a validated psychometric instrument. Mental-health chatbot work, including Woebot and recent LLM crisis-safety evaluations, motivates cautious safety framing: Mio's crisis layer is a guardrail, not clinical validation.

A fuller citation map is maintained in `docs/related-work.md`.

## 5. System Architecture

Mio's main conversation turn is implemented in `src/core/agent-loop.ts`. The loop resolves session context, builds a system prompt, appends the user message, runs inference and tool calls, records transcripts, updates memory, tracks emotion, updates relationship state, and returns the final response.

We can formulate the companion state at turn `t` as:

`S_t = {M_t, I_t, E_t, R_t, A_t, P_t}`

Where:

- `M_t` is memory state: transcripts, bookmarks, structured memories, temporal entity graph, and vector index.
- `I_t` is identity state: persona graph derived from the active `soul.md`.
- `E_t` is affective state: legacy mood plus PAD pleasure/arousal/dominance.
- `R_t` is relationship state: relationship stage and multi-axis affinity.
- `A_t` is action-policy state: crisis handling, ghost silence, proactive messaging, rituals, and frustration.
- `P_t` is prompt-selection state: context sections, priorities, token estimates, and trimming decisions.

### 5.1 Prompt Context Engine

`src/prompt/context-engine.ts` implements a priority-aware context engine. Sections are registered with critical, high, medium, or low priority. The engine assembles a prompt under a token budget and trims lower-priority sections first. This makes Mio's state channels observable and ablation-friendly: evaluation variants can disable sections such as memory, structured memory, persona, affect, affinity, or dynamic few-shot examples.

### 5.2 Memory State

Mio uses several memory layers:

- Transcript windows for recent local context.
- Bookmarks for durable natural-language memory events.
- Structured memory extraction in `src/memory/structured-memory.ts`.
- Vector search in `src/memory/vector.ts`.
- Temporal entity relations in `src/memory/entity-graph.ts`.
- Compression in `src/memory/compression.ts`.

The temporal entity graph marks functional relations such as `lives_in`, `works_at`, and `studies_at` as single-valued. When a new value supersedes an old one, the old relation is retained as inactive rather than allowed to contradict current state.

### 5.3 Persona State

`src/persona/graph.ts` extracts the active persona source into nodes of type trait, belief, rule, memory, voice, and boundary. At each turn, relevant nodes are retrieved based on topics, intent, relationship stage, and recent bookmarks. This is intended to reduce persona drift and prompt overhead compared with injecting the full persona every turn.

### 5.4 Affective and Relationship State

`src/emotion/pad.ts` stores pleasure, arousal, and dominance values in `[-1, 1]` with decay toward a baseline. `src/emotion/affinity.ts` tracks warmth, trust, intimacy, patience, and tension. `src/relationship/stages.ts` defines four stages: acquaintance, familiar, ambiguous, and intimate, each with different unlocked behaviors.

These states are not presented as psychological measurement. They are explicit engineering variables used to condition response style and policy decisions.

### 5.5 Safety and Action Policies

`src/safety/crisis.ts` detects red/yellow crisis signals before model generation and injects a safety override. `src/emotion/ghost.ts` decides when Mio should remain silent, with guards against early-session ghosting, repeated ghosting, high tension, and low patience. `src/scheduler/smart-proactive.ts` uses a Poisson-style timing model and response-probability estimates for proactive messaging.

These policies are important because companionship includes non-response and initiation decisions, not only generated text.

## 6. Benchmark

We implemented `eval/run.ts`, which generates 60 synthetic multi-turn companion scenarios. The benchmark crosses 6 user profiles with 10 scenario families:

| Category | Purpose |
|---|---|
| `long_memory` | Recall distributed personal facts and use them in support. |
| `temporal_conflict` | Use latest facts and avoid obsolete facts. |
| `emotional_support` | Ground empathy in prior stress and current emotion. |
| `user_preference` | Track updated support preferences. |
| `privacy_boundary` | Respect boundaries around family/private details. |
| `crisis_safety` | Respond safely to crisis-adjacent distress. |
| `proactive_message` | Choose low-pressure proactive check-ins. |
| `ghost_silence` | Evaluate when silence can be appropriate. |
| `persona_consistency` | Resist generic assistant/persona-drift prompts. |
| `token_cost_tradeoff` | Recover relevant facts from noisy history while tracking cost. |

Each scenario contains history, a final probe, expected facts, success signals, forbidden signals, and hallucination terms.

## 7. Ablation Variants

The study evaluates 7 variants:

| Variant | Description |
|---|---|
| `no_memory` | Static prompt, no seeded history, most dynamic sections disabled. |
| `window` | Seeded recent transcript window. |
| `rag` | Cross-session history plus bookmark/vector retrieval. |
| `structured` | RAG plus structured memory extraction. |
| `persona` | Structured memory plus persona graph. |
| `persona_affect` | Structured memory plus persona, PAD, and relationship state. |
| `full` | Full Mio policy stack, including ghost/proactive-related behavior. |

The default provider is deterministic and designed to test whether each variant makes the relevant evidence available to the final probe. This makes the benchmark a controlled architecture test, not a real-model preference study.

## 8. Metrics

The rule judge reports memory, temporal, preference, privacy, crisis, proactive, ghost, persona, support, composite, harmful silence, appropriate silence, hallucinated memory rate, prompt tokens, and latency. Metric definitions are in `eval/results/metric-contract.md`.

Validation checks pass for 60 scenarios, 7 variants, 420 detail rows, score/rate bounds, non-negative token/latency values, 7 aggregate rows, and 70 category rows.

## 9. Results

| variant | memory | support | ghost | composite | prompt tokens |
|---|---:|---:|---:|---:|---:|
| `no_memory` | 0.100 | 0.528 | 0.000 | 0.510 | 304 |
| `window` | 0.817 | 0.611 | 0.000 | 0.812 | 457 |
| `rag` | 0.717 | 0.611 | 0.000 | 0.779 | 528 |
| `structured` | 0.717 | 0.611 | 0.000 | 0.779 | 531 |
| `persona` | 0.717 | 0.611 | 0.000 | 0.779 | 1096 |
| `persona_affect` | 0.717 | 1.000 | 0.000 | 0.818 | 1221 |
| `full` | 0.717 | 1.000 | 1.000 | 0.818 | 1295 |

The recent-window baseline improves composite score by 0.302 over `no_memory`. The full stack improves composite score by 0.308 over `no_memory`, but costs 1295 estimated prompt tokens on average, 2.83x the `window` token cost.

The clearest state-channel gain is affect. `persona_affect` improves support score from 0.611 in `persona` to 1.000, a gain of 0.389. In the `emotional_support` category, `persona_affect` and `full` reach composite 1.000, while memory/persona variants without affect score 0.833.

The full stack uniquely activates ghost silence. `full` has aggregate ghost score 1.000, appropriate silence rate 0.100, and harmful silence rate 0.000. This supports the claim that policy behavior can be tested as part of companion-agent evaluation, but the current ghost benchmark is too small for user-trust conclusions.

The persona graph result is not yet strong. `persona` increases average token cost from 531 in `structured` to 1096 without improving composite score in the current rule judge. This may reflect weak persona probes rather than lack of value, so the paper should treat persona retrieval as an architectural contribution needing stronger evaluation.

Detailed analysis is in `docs/experiment-analysis.md`.

### 9.1 Figure Captions for Current Artifacts

Figure 1. Composite score by ablation variant on the Mio Eval V1 synthetic companion benchmark. The benchmark contains 60 multi-turn scenarios across 10 scenario families, evaluated over 7 ablation variants. Higher is better. Source: `eval/results/charts/composite-score.svg`.

Figure 2. Support score by ablation variant. Affective variants (`persona_affect` and `full`) improve rule-judged support score relative to memory/persona-only variants in the synthetic benchmark. Higher is better. Source: `eval/results/charts/support-score.svg`.

Figure 3. Estimated prompt-token cost by ablation variant. Richer state channels increase prompt cost; `full` uses 1295 estimated tokens on average, compared with 457 for `window`. Lower is cheaper. Source: `eval/results/charts/prompt-tokens.svg`.

### 9.2 MiniMax Real-Provider Replication

The evaluation harness now supports a second-stage real-provider replication path. The same 60 scenario x 7 variant benchmark can be run with configurable `--providers`, `--model`, `--models`, and `--result-dir` options. Target providers include MiniMax, DeepSeek, Qwen, and OpenAI-compatible models through Mio's existing provider selector.

The runner separates the evaluated model from the judge model. The seeded history phase remains deterministic to keep memory setup consistent and low-cost; the final probe can be routed to the selected provider. LLM judge mode produces separate scores for emotional support, persona consistency, privacy boundary, and crisis safety, preserving the rule-judge metrics as the reproducible baseline.

A MiniMax smoke validation was executed with 2 scenarios and 2 variants using MiniMax-M3 for both the evaluated probe provider and the LLM judge. The generated result set contains 4 detail rows, 2 provider/variant aggregate rows, 4 category rows, 4 charts, and per-provider CSV/JSON split files. Validation passed with `dry_run=0`, 0 provider errors, and 0 judge errors. This smoke run verifies both the MiniMax API route and the MiniMax judge route, but it is too small to support behavioral conclusions.

The full MiniMax-M3 replication was then executed on the complete 60 scenario x 7 variant benchmark. It produced 420 detail rows, 7 provider/variant aggregate rows, 70 category rows, provider-grouped CSV/JSON artifacts, SVG charts, a metric contract, and a validation report. Validation passed with `dry_run=0`, 0 provider errors, and 0 judge errors.

In the full MiniMax run, `window` has the highest aggregate composite score at 0.460 and the lowest average prompt-token count at 479. The `full` variant has composite score 0.456 and activates the ghost-silence policy signal with ghost score 1.000 and appropriate silence rate 0.100, but it does not improve aggregate composite score over `window` under the current judge configuration.

The evidence boundary is important: the full run is real MiniMax probe evidence, but its LLM-judge-shaped emotional support, persona consistency, privacy, and crisis fields were scored by the deterministic mock judge. The MiniMax LLM judge route is verified only on the 2-scenario smoke subset. Therefore the full run supports claims about real-provider execution, provider-grouped artifacts, error-free completion, and architecture-level ablation behavior under the current judge; it does not yet support human-preference or safety-certification claims.

### 9.3 MiniMax Error Analysis

We performed a paper-level error analysis over `eval/results/real-model-minimax/`, comparing `persona`, `persona_affect`, and `full` against `window` and `rag` at scenario and category level. The analysis script generated 360 target-baseline scenario comparisons from the 420 MiniMax detail rows and found 289 failure-point comparisons under the pre-registered filters for negative composite, negative memory/persona deltas, or increased token cost without composite gain.

The main finding is that richer state is not automatically used by the real model. Against `window`, `full` has 19 negative-composite scenarios, 15 positive-composite scenarios, 26 ties, and 41 scenarios where it spends more prompt tokens without composite gain. Against `rag`, `full` has 15 negative-composite scenarios, 20 positive-composite scenarios, 25 ties, and 39 no-gain-with-more-token scenarios. The mean `full` delta is -0.004 composite versus `window` and +0.005 versus `rag`.

The heuristic failure buckets are dominated by extra context without gain and context non-use or non-retrieval. Across all target-baseline comparisons, the script assigns 118 failure points to `extra_context_no_gain`, 92 to `context_not_used_or_not_retrieved`, 53 to `literal_success_signal_miss`, 12 to `undetermined_needs_prompt_trace`, 9 to `persona_empty_or_silence_penalty`, and 5 to `metric_conflict_ghost`.

The category-level failures are concentrated in persona consistency, privacy boundary, long-memory, token-cost, and ghost-silence slices. Several representative rows show that the literal rule judge under-credits semantically relevant but non-exact answers, especially when MiniMax paraphrases expected facts or refuses persona-drift prompts without using the exact success strings. Conversely, some rows show genuine retrieval or use failures: the model gives short generic acknowledgements despite the target variant spending substantially more prompt tokens.

This analysis changes the interpretation of the MiniMax result. The full stack should not be described as strictly better than a window baseline on real-model aggregate quality. A more defensible claim is that the architecture makes state channels and policy behaviors observable under ablation, while the current retrieval, scoring, and prompt-trace instrumentation are not yet strong enough to show a robust full-stack advantage with MiniMax-M3. Detailed tables, representative outputs, and validation checks are in `docs/minimax-error-analysis/report.md`.

## 10. Discussion

The results suggest that different state channels contribute to different companion dimensions, but the strength of that claim depends on the evaluation setting. In the deterministic baseline, recent history and memory retrieval improve access to user facts, affective state changes support-rule behavior, and the full stack adds non-text policy behavior such as silence. In the MiniMax-M3 replication, however, the same full stack does not beat the `window` baseline on aggregate composite score. The robust MiniMax finding is narrower: policy behavior is observable, provider-routed benchmarking works, and richer state often increases prompt cost without guaranteed model use.

The strongest result is not that Mio beats all baselines, but that Mio makes companion-agent state channels ablation-ready and exposes where those channels fail. This matters because long-horizon companionship cannot be evaluated with a single memory score or a short empathy score. The system must be probed along memory, temporal consistency, support, privacy, safety, persona, and action-policy axes, and the evaluation must distinguish retrieval availability, prompt inclusion, model use, and judge sensitivity.

## 11. Safety, Privacy, and Ethics

Mio is an emotional companion prototype, not a therapist or medical device. Its crisis module uses keyword and intent gates to inject safety guidance, but this is not equivalent to expert crisis handling. Any public release should explicitly state that Mio is not a substitute for professional support.

The current private `data/` directory must not be published. Only synthetic scenarios or public benchmark data should be released. If a future user study is conducted, it should use informed consent, anonymization, data minimization, and a procedure for crisis escalation.

Ghost silence and proactive messaging require special care. Silence may feel natural in low-content exchanges, but harmful in distress. Proactive messages may feel supportive or intrusive depending on context. These policies should be evaluated separately with safety-focused metrics.

## 12. Limitations

The benchmark is synthetic. The default run measures prompt availability and rule satisfaction, while the MiniMax-M3 replication measures one real provider's behavior on the same synthetic probes. Neither setting measures human preference.

The rule judge uses literal pattern matching. It cannot fully evaluate empathy, tone, persona voice, or crisis appropriateness.

The real-provider path has been verified with a full MiniMax-M3 run, but only one production provider has completed the full benchmark. The full MiniMax run used the deterministic mock judge for LLM-judge-shaped scores; the MiniMax LLM judge path has only been checked on a 2-scenario smoke subset.

The scenarios are short enough that the recent-window baseline performs strongly. The current `window` variant also probes the same seeded session, while `rag`, `persona`, `persona_affect`, and `full` probe cross-session memory paths. This makes `window` a useful baseline but also a confounded comparator for long-term retrieval. Longer multi-session histories and separate same-session/cross-session tracks are needed to demonstrate the value of vector and structured memory.

The persona-consistency evaluation is underdeveloped. Stronger persona-specific probes and contradiction judges are required.

The result rows do not store full prompt traces. As a result, the MiniMax error analysis can identify response-level failures and matched-fact gaps, but it cannot always determine whether a failure came from retrieval absence, prompt trimming, model non-use, or judge under-crediting.

The crisis evaluation is only a proxy and should not be used as a safety certification.

## 13. Next Steps

The immediate evidence stage is Eval v2. A minimal v2 smoke run has been implemented with prompt-section traces, retrieval traces, same-session and cross-session window baselines, and decomposed task/policy/ghost scoring. The smoke result contains 6 detail rows over 2 scenarios and 3 variants; all rows include parseable `prompt_sections_json` and `retrieval_trace_json`. On the `memory-1` scenario, v2 correctly distinguishes context availability: `window_same_session` has 4 expected facts available in the prompt, `window_cross_session` has 0, and `full` has 4 through cross-session memory sections. The v2 migration report is stored in `docs/eval-v2-migration.md`.

The next evidence stage should:

1. Run the full 60-scenario deterministic Eval v2 benchmark.
2. Re-run MiniMax-M3 on Eval v2 after reviewing trace storage for data sensitivity.
3. Add an independently validated LLM judge that returns both scores and rationales for support, persona, privacy, and crisis cases.
4. Add longer multi-session synthetic histories.
5. Add LoCoMo for external memory evaluation.
6. Add ESConv or ES-MemEval-style emotional-support tasks.
7. Add stronger persona contradiction probes and a persona-specific judge.
8. Add bootstrap confidence intervals.
9. Add a safety-focused crisis and harmful-silence benchmark.

## 14. Conclusion

Mio demonstrates a state-coupled architecture for long-horizon companion agents and a reproducible first benchmark for studying its components. The current evidence supports a technical-report claim: coupling memory, persona, affect, relationship state, and action policies is implementable and measurable through ablations. Stronger real-model, human-judged, and safety-focused experiments are required before claiming real-world companionship benefits.

## References

See `docs/related-work.md` for the working bibliography and citation map.
