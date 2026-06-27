# Mio Paper Plan

## Executive verdict

Mio is suitable for a paper, but not as a generic "LLM companion chatbot" paper. That space already has strong work on long-term memory and emotional support. The defensible angle is:

> Mio is a working companion-agent architecture that couples long-term memory, explicit persona retrieval, affective state, relationship stage, silence/proactive policies, and a web-facing interaction loop; the paper should evaluate whether this state-coupled architecture improves long-horizon companionship quality over memory-only or prompt-only agents.

The most realistic first publication path is an arXiv technical report plus an ACM IVA / CHI workshop / ACL demo-style submission. A main-conference NLP/HCI paper is possible only after adding a proper evaluation harness and either public-benchmark results or a small approved user study.

## Evidence from the codebase

Current implementation supports a paper-level system description:

- Main agent loop: `src/core/agent-loop.ts` composes prompt context, model calls, tool loops, memory side effects, crisis detection, ghosting, affect updates, and transcript writes.
- Affective state: `src/emotion/pad.ts` implements PAD pleasure-arousal-dominance with decay and OCEAN-inspired modifiers.
- Relationship state: `src/emotion/affinity.ts`, `src/emotion/frustration.ts`, and `src/relationship/stages.ts` implement multi-axis warmth/trust/intimacy/patience/tension, frustration, attachment, and feature gating.
- Persona identity retrieval: `src/persona/graph.ts` extracts `soul.md` into typed persona nodes and retrieves relevant identity fragments under a token budget.
- Long-term memory: `src/memory/structured-memory.ts`, `src/memory/entity-graph.ts`, `src/memory/vector.ts`, and `src/memory/compression.ts` implement structured extraction, temporal entity facts, vector retrieval, and hybrid context compression.
- Proactive policy: `src/scheduler/smart-proactive.ts` implements Poisson-based timing plus response-probability modeling.
- UI/API surface: `src/server/index.ts` exposes HTTP/WebSocket chat, status, analytics, avatar, search, backup, notification, onboarding, and persona endpoints.
- Verification: `npm test` passes all current tests: 56 unit, 41 emotion, 9 golden-turn, 14 smoke/API, 8 HTTP retry, 7 context-engine, 4 vector incremental, 4 semantic memory, 7 sqlite-vector, 7 structured extraction, 14 rerank, and 7 temporal entity-graph tests.
- Local data scale: current `data/transcripts` contains 1538 JSONL transcript files and 3168 transcript lines. This is useful for internal pilot analysis only; do not publish private user data.

## Best paper direction

### Working title

Mio: A State-Coupled Architecture for Long-Horizon Emotional Companion Agents

### Thesis

Long-term companion agents need more than memory retrieval. They need a coupled loop in which retrieved memories, explicit identity, affective state, relationship state, and action policies are updated together and exposed to response generation. Mio operationalizes this as a modular companion-agent architecture and evaluates how each state channel affects long-horizon support quality.

### Core research questions

RQ1. Does explicit affect and relationship state improve long-horizon emotional-support responses beyond memory-only personalization?

RQ2. Does persona graph retrieval reduce identity drift and prompt cost compared with injecting the full persona or relying on a static system prompt?

RQ3. Does structured/temporal memory improve recall, conflict handling, and user modeling over raw transcript windows and simple vector RAG?

RQ4. Do silence and proactive policies improve perceived relational appropriateness, or do they introduce trust/safety risks?

## Contribution claims

Strong, defensible claims:

- A concrete open-source architecture for long-horizon companion agents that separates episodic memory, structured user facts, persona identity, affect, relationship state, and action policies.
- A state-coupled turn loop where memory retrieval and affective/relationship updates are not isolated add-ons but participate in prompt construction and post-turn side effects.
- An ablation-ready implementation with feature flags and tests that make it possible to measure the contribution of each state channel.
- A practical evaluation protocol for companion agents across memory, persona consistency, support quality, interaction appropriateness, and cost.

Claims to avoid unless new experiments prove them:

- "First emotional companion agent."
- "Human-level companionship."
- "Clinically useful emotional support."
- "Safe mental-health assistant."
- "Novel PAD model" or "novel memory architecture" in isolation.

## Related work positioning

Mio should be positioned against these lines:

- Long-term memory for LLM companions: MemoryBank shows memory mechanisms for LLM companions and SiliconFriend, including forgetting-inspired memory updates.
- Long-term dialogue agents: LD-Agent separates event memory, persona extraction, and response generation for long-term dialogue.
- Long-context memory benchmarks: LoCoMo evaluates very long-term conversational memory with QA, event summarization, and dialogue generation.
- Emotional support memory benchmarks: ES-MemEval evaluates personalized long-term emotional support across extraction, temporal reasoning, conflict detection, abstention, and user modeling.
- Lifelong companion benchmarks: LifeSide frames companion agents as Memory-Emotion-Environment loops under partial observability, which is highly aligned with Mio's target.
- Persona/identity retrieval: ID-RAG argues for explicit identity graphs to reduce persona drift in generative agents.
- Emotional support dialogue: ESConv and later emotional-support dialogue work provide evaluation rubrics for empathy, personalization, and regulation.

Useful sources found:

- Zhong et al., 2024, "MemoryBank: Enhancing Large Language Models with Long-Term Memory", AAAI. DOI: `10.1609/aaai.v38i17.29946`.
- Maharana et al., 2024, "Evaluating Very Long-Term Conversational Memory of LLM Agents" / LoCoMo.
- Li et al., 2025, "Hello Again! LLM-powered Personalized Agent for Long-term Dialogue", NAACL.
- Platnick et al., 2025, "ID-RAG: Identity Retrieval-Augmented Generation for Long-Horizon Persona Coherence in Generative Agents".
- ES-MemEval, "Benchmarking Conversational Agents on Personalized Long-Term Emotional Support", WWW 2026.
- LifeSide, "Benchmarking Agents as Lifelong Digital Companions", 2026.

## Proposed system formulation

Define a companion-agent state at turn `t`:

`S_t = {M_t, I_t, E_t, R_t, A_t, P_t}`

Where:

- `M_t`: memory state, including transcripts, bookmarks, structured memory, temporal entity graph, and vector index.
- `I_t`: identity/persona graph derived from `soul.md`.
- `E_t`: affective state, including PAD and legacy mood/energy.
- `R_t`: relationship state, including stage and multi-axis affinity.
- `A_t`: action policy state, including ghost/proactive/frustration/ritual policies.
- `P_t`: prompt budget and context selection state.

Each turn:

1. Observe user input.
2. Retrieve semantic memories and identity nodes.
3. Compose prompt under budget using priority sections.
4. Generate response or choose silence.
5. Persist transcript and memory signals.
6. Update affect, relationship, activity, and procedural signals.

This gives the paper a clear architecture rather than a feature list.

## Experimental plan

### Baselines and ablations

Use the same base model across all variants where possible.

- B0: No memory, static system prompt.
- B1: Recent transcript window only.
- B2: Vector memory retrieval only.
- B3: Vector memory plus structured/temporal memory.
- B4: B3 plus persona graph retrieval.
- B5: B4 plus PAD and relationship state injected into context.
- B6: Full Mio, including ghost/proactive/frustration/ritual policies.

### Task set 1: memory and user modeling

Use public or synthetic multi-session dialogues. Preferred order:

1. ES-MemEval if data/code are available.
2. LoCoMo for long-term memory QA and dialogue generation.
3. A small synthetic companion benchmark generated from hidden user profiles and event timelines.

Metrics:

- Exact/F1 for factual recall.
- Temporal consistency and conflict resolution accuracy.
- Forgetting-aware accuracy: penalize obsolete facts.
- Retrieval coverage: whether retrieved context contains latest and complete evidence.
- Hallucinated memory rate.

### Task set 2: persona consistency

Use persona probes derived from each `soul.md` and conflict prompts that try to induce identity drift.

Metrics:

- Identity recall accuracy.
- Action/response alignment score judged against persona graph.
- Contradiction rate against high-confidence persona nodes.
- Prompt token cost and latency.

Expected hypothesis:

Persona graph retrieval should match or beat full-persona injection at lower token cost, and beat static prompts in long sessions.

### Task set 3: emotional support quality

Use emotional-support scenarios with hidden user state. Prefer ES-MemEval/LifeSide-style rubrics.

Metrics:

- Empathy.
- Cause recall.
- Personal alignment.
- Regulation facilitation.
- Autonomy support.
- Collaboration / next-turn usefulness.
- Over-disclosure or unsafe advice rate.

Evaluation:

- LLM-as-judge for broad sweeps.
- Human validation on a 50-100 sample subset to estimate judge reliability.

### Task set 4: interaction policy appropriateness

Evaluate ghost/proactive behavior separately because it is risky.

Scenarios:

- Short low-content messages where silence may be acceptable.
- Distress or conflict messages where silence is harmful.
- Long absence windows where proactive check-in may be appropriate.
- Privacy/safety boundary cases.

Metrics:

- Appropriate silence rate.
- Harmful silence rate.
- Proactive timing appropriateness.
- User-trust proxy score.
- Crisis false-negative rate.

## Required implementation work before submission

1. Add an evaluation harness under `eval/`.
   - Load benchmark conversations.
   - Replay each session through a selected Mio variant.
   - Save predictions, retrieved memories, prompt sections, state deltas, token estimates, and latency.

2. Add feature-flag presets for ablations.
   - `MIO_EVAL_VARIANT=no_memory|window|rag|structured|persona|affect|full`.
   - Ensure each preset disables only the relevant modules.

3. Add judge scripts.
   - Memory QA scoring.
   - Persona contradiction scoring.
   - Emotional support rubric scoring.
   - Safety/privacy scoring.

4. Add synthetic benchmark generator if public benchmark access is insufficient.
   - Hidden user profile.
   - Event timeline.
   - Multi-session disclosure script.
   - Gold memory facts and emotional-state labels.

5. Add a results notebook or script.
   - Aggregate metrics.
   - Bootstrap confidence intervals.
   - Ablation tables.
   - Cost/latency tables.

6. Write data/privacy protocol.
   - Do not publish current `data/transcripts`.
   - Use public benchmarks or generated data.
   - For any real user study, obtain consent and anonymize logs.

## Target venues

Best fit:

- ACM IVA 2026 full paper or demo. Scope explicitly includes emotion, personality, conversational behavior, adaptive behavior, social agent architectures, LLMs for conversational agents, and evaluation.

Good near-term targets:

- CHI / CSCW / IUI workshops on human-agent collaboration, social/emotional AI, or companion agents.
- ACL / EMNLP / NAACL demo or workshop if the paper emphasizes the architecture and reproducible eval harness.
- arXiv technical report as soon as the first complete evaluation table exists.

More ambitious targets after stronger experiments:

- CHI full paper: requires a serious user study and careful safety/ethics framing.
- ACL/EMNLP Findings: requires strong benchmark results and clearer algorithmic novelty.
- AAAI/IJCAI: possible if framed as agent architecture plus strong ablation, but competition is higher.

Not recommended as first target:

- Clinical or mental-health venues. Mio is not validated as a therapeutic system.

## Paper outline

1. Introduction
   - Problem: companion agents need persistent, emotionally grounded personalization, not only memory recall.
   - Gap: current systems often evaluate memory, persona, or empathy separately.
   - Claim: state-coupled architecture improves long-horizon companion behavior.

2. Related Work
   - Long-term dialogue memory.
   - Persona consistency and identity retrieval.
   - Emotional support dialogue.
   - Intelligent virtual agents and affective agents.

3. Mio Architecture
   - Turn loop.
   - Memory stack.
   - Persona graph.
   - PAD and relationship state.
   - Ghost/proactive policies.
   - Web/API implementation.

4. Evaluation Protocol
   - Benchmarks or synthetic setup.
   - Variants.
   - Metrics and judges.
   - Ethics and privacy.

5. Results
   - Main ablation table.
   - Memory/user modeling table.
   - Persona consistency table.
   - Emotional support table.
   - Cost/latency table.

6. Analysis
   - When affect helps.
   - When retrieval hurts.
   - Failure cases: stale memory, over-personalization, harmful silence.

7. Limitations
   - Synthetic data limitations.
   - LLM judge reliability.
   - Cultural/language scope.
   - Not clinical support.
   - Privacy and dependency on proprietary models.

8. Conclusion

## Six-week execution plan

Week 1:

- Freeze research question and paper title.
- Implement ablation presets.
- Select public benchmark or generate a 100-user synthetic pilot.
- Produce first replay logs for B0-B5.

Week 2:

- Implement memory/persona/support judges.
- Run pilot on 50-100 scenarios.
- Manually inspect failure cases and adjust metrics, not the system.

Week 3:

- Run full ablation.
- Add token cost, latency, and retrieval coverage.
- Create first results tables.

Week 4:

- Human-validate a sample of LLM-judge outputs.
- Add safety/privacy evaluation for ghost/proactive behavior.
- Decide whether full paper or workshop/demo is realistic.

Week 5:

- Draft paper.
- Create architecture figure and state-transition diagram.
- Write related work and limitations.

Week 6:

- Polish results and abstract.
- Prepare arXiv or target venue format.
- Prepare code/data release plan with private data excluded.

## Go / no-go criteria

Proceed to paper if:

- Full Mio or B5 beats memory-only baselines on emotional-support personalization by a meaningful margin.
- Persona graph retrieval reduces token cost while preserving or improving persona consistency.
- Structured/temporal memory reduces obsolete-memory errors.
- Human spot checks agree reasonably with LLM-judge trends.

Pivot to demo/workshop if:

- Results are mixed but the architecture is compelling and reproducible.
- The strongest contribution is design/engineering rather than measured performance.

Do not submit as a main paper yet if:

- Improvements only appear in cherry-picked examples.
- Ghost/proactive policies create safety regressions.
- Evaluation relies on private logs that cannot be shared or audited.

## Immediate next step

Build `eval/` with a small deterministic synthetic benchmark and ablation runner. The first milestone should be a single CSV table:

`variant, memory_score, persona_score, support_score, harmful_silence_rate, hallucinated_memory_rate, prompt_tokens, latency_ms`

Once that table exists, the paper direction becomes evidence-driven instead of speculative.
