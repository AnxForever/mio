# Mio Submission Roadmap

## Current Submission Readiness

Mio is ready for an arXiv technical report or internal whitepaper draft. It is not yet ready for a strong main-conference claim about user-perceived companionship, clinical safety, or real-world emotional-support outcomes.

The current strongest paper type is:

> A systems-and-evaluation paper describing a state-coupled companion-agent architecture and a synthetic ablation benchmark.

The current evidence package supports a workshop, demo, or technical report if the claims are scoped carefully.

## Candidate Venues

Near-term realistic:

- arXiv technical report.
- ACL/EMNLP/NAACL workshop on LLM agents, long-context dialogue, personalization, or affective NLP.
- CHI/CSCW/IUI workshop on human-agent interaction or social AI.
- ACM IVA demo or short paper if the implementation and interaction loop are emphasized.

Medium-term:

- ACL/EMNLP demo if the evaluation harness is made reproducible and the paper emphasizes architecture plus benchmark.
- IUI or IVA full paper if additional real-model and human-evaluation evidence is added.

Ambitious:

- CHI full paper, only with IRB/ethics-approved user study and careful safety framing.
- ACL/EMNLP Findings, only if external benchmark results and stronger algorithmic novelty are demonstrated.

Avoid for now:

- Clinical/mental-health venues. Mio has crisis guardrails but no clinical validation.

## Evidence Already Available

Architecture evidence:

- Main turn loop: `src/core/agent-loop.ts`.
- Prompt budgeting: `src/prompt/context-engine.ts`.
- Structured memory: `src/memory/structured-memory.ts`.
- Temporal entity graph: `src/memory/entity-graph.ts`.
- Persona graph retrieval: `src/persona/graph.ts`.
- PAD affect: `src/emotion/pad.ts`.
- Multi-axis affinity: `src/emotion/affinity.ts`.
- Ghost silence: `src/emotion/ghost.ts`.
- Smart proactive policy: `src/scheduler/smart-proactive.ts`.
- Relationship stages: `src/relationship/stages.ts`.
- Crisis guardrail: `src/safety/crisis.ts`.
- HTTP/WebSocket interface: `src/server/index.ts`.

Evaluation evidence:

- 60 synthetic scenarios.
- 10 scenario categories.
- 7 ablation variants.
- 420 scenario-variant rows.
- CSV/JSON outputs.
- Aggregate and category summaries.
- SVG charts.
- Metric contract and validation report.
- `npm test` passing across the current project test suite.

## Missing Experiments Before a Serious Submission

### Required for an arXiv technical report

- Include the current synthetic benchmark and its limitations.
- Include exact reproduction command: `npm run eval:paper`.
- Include metric contract and validation report.
- Include code references and ablation definitions.
- Add a short statement that private transcripts are not published.

### Required for a workshop or demo submission

- Add real-provider runs for at least two models.
- Add a small LLM-judge pass for emotional support, persona consistency, and privacy.
- Add qualitative examples for each major ablation.
- Add a public artifact checklist: setup, environment variables, reproduction time, output files.
- Add stronger screenshots or UI/demo material if targeting HCI/IVA.

### Required for a main NLP/HCI submission

- Add external benchmarks:
  - LoCoMo for very long-term conversational memory.
  - ESConv or ES-MemEval-inspired tasks for emotional support.
  - Persona or role-playing benchmark for identity consistency.
- Add human evaluation:
  - 50-100 sampled responses at minimum for support quality and persona consistency.
  - Annotator rubric with inter-annotator agreement.
  - Separate safety review for crisis/privacy cases.
- Add statistical analysis:
  - Bootstrap confidence intervals over scenarios.
  - Significance tests or paired comparisons across variants.
  - Sensitivity analysis for prompt-token budget.
- Add safety evaluation:
  - Crisis false-negative rate.
  - Harmful silence rate under distress.
  - Over-disclosure and boundary-violation rate.
  - Unsafe reassurance or medical/therapeutic overclaiming.

## Claim Boundaries

Safe current claims:

- Mio implements a modular companion-agent architecture that couples memory, persona, affect, relationship state, and action policies.
- Mio includes an ablation-ready evaluation harness for synthetic long-horizon companion scenarios.
- In the v1 synthetic benchmark, memory-enabled variants outperform `no_memory` on composite score.
- In the v1 synthetic benchmark, affective variants improve support-rule scores.
- Richer state increases prompt-token cost, making cost-quality tradeoffs measurable.

Claims to avoid:

- Mio is a therapeutic assistant.
- Mio is safe for mental-health deployment.
- Mio improves real user wellbeing.
- Mio's persona graph is proven superior to full prompt injection.
- Mio's ghost silence improves user trust.
- Synthetic benchmark scores imply human preference.

## Suggested Timeline

### Week 1: Paper Draft and Artifact Cleanup

- Freeze `eval/run.ts` v1.
- Write paper draft v0.
- Add a reproducibility appendix.
- Add example scenario snippets.
- Add a table mapping features to code modules.

### Week 2: Real-Provider Evaluation

- Run `eval:paper` with 2-4 real providers.
- Run LLM judge for support/persona/privacy.
- Compare deterministic-provider results with real-provider results.
- Add failure examples.

### Week 3: External Benchmark Bridge

- Prototype LoCoMo loader.
- Prototype ESConv or ES-MemEval-style scenario conversion.
- Add confidence intervals.
- Add a persona-specific contradiction judge.

### Week 4: Submission Package

- Decide venue.
- Convert draft into venue format.
- Create artifact README.
- Remove or anonymize any private data.
- Add ethics, safety, and limitation sections.

## Artifact Checklist

Before any public release:

- Ensure `eval/.data/` is ignored and not committed.
- Do not publish `data/transcripts/`.
- Check generated JSON for private content.
- Include only synthetic scenarios or public benchmark data.
- Document required Node version and environment variables.
- Provide a one-command reproduction path.
- Include expected output file names and approximate runtime.

## Decision Gate

Proceed to arXiv when:

- `docs/paper-draft-v0.md` is internally coherent.
- `docs/experiment-analysis.md` matches `eval/results/`.
- All reproduction commands pass.
- Claims are limited to architecture and synthetic evaluation.

Proceed to workshop/demo submission when:

- Real-provider evals are added.
- A small LLM/human judge validation exists.
- The paper includes qualitative examples and artifact instructions.

Proceed to main-conference submission when:

- External benchmark results exist.
- Human evaluation exists.
- Safety evaluation is substantially stronger.
- The core novelty is sharpened beyond implementation integration.
