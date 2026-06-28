# Mio companion agent research roadmap

Date: 2026-06-28

## Executive Summary

Mio should not become a fully autonomous multi-agent group chat for every user message. The better fit is a modular, code-orchestrated companion workflow:

1. Prepare structured state before generation.
2. Let one user-facing chat agent write the reply.
3. Run narrow critics/guards only where failure is measurable.
4. Store the transcript, state changes, and failures as eval cases.
5. Periodically reflect/consolidate memory outside the real-time path.

This matches the strongest external guidance: start simple, add workflows before agents, and use multi-agent patterns only where they improve isolation, traceability, or measurable quality.

## Sources Reviewed

- Anthropic, "Building effective agents": distinguishes workflows from autonomous agents; recommends simplest useful system first, with retrieval, tools, memory, routing, parallel guardrails, and evaluator-optimizer loops added only when measurable.
- Anthropic, "Demystifying evals for AI agents": agent evals need isolated trials, complete traces, multiple graders, and production-like harnesses.
- OpenAI Agents SDK orchestration docs: two key multi-agent patterns are "agents as tools" and "handoffs"; use agents as tools when one manager should own the final user-facing answer.
- LangGraph supervisor docs: supervisor pattern coordinates specialized agents, supports message-history controls, memory, and human-in-the-loop.
- AutoGen group chat docs: multi-agent group chat is useful for complex collaborative tasks, but works sequentially with a manager choosing speakers, which is not ideal for low-latency intimate chat.
- Park et al., "Generative Agents": believable behavior comes from memory stream, retrieval by relevance/recency/importance, reflection, and planning.
- MemGPT: long-running conversation needs hierarchical memory, with main context and external archival memory managed explicitly.
- Zheng et al., "Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena": LLM judges can approximate human preference, but need bias handling such as position swap, reference guidance, and human calibration.
- Alonso et al., "Toward Conversational Agents with Context and Time Sensitive Long-term Memory": conversational memory fails when it relies on semantic retrieval alone; time/event metadata and ambiguous follow-up resolution need explicit retrieval paths.
- Recent temporal-memory work such as Chronos, TiMem, APEX-MEM, and Temporal Semantic Memory: long-horizon chat memory is moving toward timestamped events, temporal hierarchy, append-only provenance, duration-aware states, and query-time conflict resolution.
- MARCO, "Multi-Agent Real-time Chat Orchestration": real-time chat benefits from intent routing, shared memory, deterministic task graphs, guardrail reflection, and evaluation, but only when orchestration is constrained and latency-aware.
- Microsoft Azure Architecture Center, "AI Agent Orchestration Patterns": use the lowest complexity that reliably works; multi-agent orchestration adds coordination overhead, latency, and failure modes. Maker-checker/evaluator-optimizer loops are appropriate when acceptance criteria and iteration caps are explicit.
- Replika public help docs: memory is layered; some memories are user-visible, some are deeper inferred patterns; user affirmation and manual memory edits affect personalization.
- Character.AI memory update: separates Story Memory, Facts, pinned moments, memory usage visualization, editable/disable-able facts, and automatic long-chat tidying.
- Persona/role-play research: recent persona work separates stable identity from adaptive short-term state and uses persona critics/case repositories/drift suppressors rather than treating persona as one static prompt.

## What Good Chatbots Appear To Be Doing

### 1. They are not "one prompt"

Good companion systems are layered:

- immutable identity/persona floor
- user editable facts and preferences
- inferred long-term profile
- short-term emotional and temporal state
- recent conversation window
- retrieved memories
- output moderation or quality guards
- offline reflection/consolidation

Mio already has many of these pieces. The gap is coordination and evaluation, not just more personality text.

### 2. They separate stable identity from transient state

The failure "you said you were sleepy yesterday, so are you not sleepy now?" happens when old transient state is stored like a stable fact.

Needed distinction:

- Stable identity: Mio's core voice, relationship role, long-term traits.
- Durable user facts: name, preference, recurring needs, consented relationship style.
- Mid-term arcs: recent stress, project, ongoing conflict, multi-day topic.
- Short-term state: sleepy, busy, hungry, away, upset, active for minutes or hours.
- Current turn facts: the user just sent this message now.

### 3. They use memory as product surface, not hidden magic

Replika and Character.AI both expose memory management to users. The user can add, pin, edit, disable, or remove facts.

For Mio, this matters because "Mio feels strange" is often caused by a bad remembered fact, stale state, or wrongly inferred preference. If the user cannot see and correct those, prompt tweaks become guesswork.

### 4. They evaluate open-ended chat with preference/judge systems

For companion chat, exact-match tests are weak. Better evals combine:

- deterministic rule checks for dangerous or clearly wrong behavior
- LLM-as-judge for "logic", "human-likeness", "persona coherence", "not interrogative"
- pairwise A/B comparisons when testing prompt variants
- saved real failure transcripts as regression cases
- occasional human review for calibration

LLM judges are useful but biased. Use strict rubrics, JSON output, multiple judges for important decisions, and position-swapped pairwise tests when comparing variants.

### 5. They treat time as structured state, not just prose

The strongest memory papers converge on the same point: a chatbot needs both raw conversation turns and structured temporal events. Semantic similarity can retrieve "sleep" because it is textually related, but it cannot know whether "I am sleepy" was true last night, resolved this morning, or still active now unless the system stores validity windows and state transitions.

For Mio, this means temporal memory should answer:

- what happened
- when it happened
- whether it is still active
- what later event resolved or contradicted it
- which transcript lines support it

### 6. Multi-agent should be backstage, not visible

For intimate chat, the final response should sound like one person. Multi-agent value should appear as backstage specialization: state extraction, memory retrieval, persona critic, proactive planner, and eval miner. The main failure to avoid is a "committee voice" where the reply feels over-coordinated, over-explained, or emotionally inconsistent.

## Recommended Mio Architecture

Keep Mio as a modular monolith. Do not split into microservices yet.

```text
Incoming IM message
  |
  v
Channel/session isolation
  |
  v
State Preparation Layer
  - temporal state
  - current channel timeline
  - user preferences
  - relationship state
  - affect/PAD state
  - memory retrieval
  |
  v
User-facing Chat Agent
  - one final writer
  - no visible internal debate
  |
  v
Output Quality Layer
  - deterministic narrow guards
  - optional LLM critic for risky/ambiguous turns
  - local rewrite only when guard finds a concrete issue
  |
  v
Transcript + memory/event log
  |
  v
Offline Reflection
  - consolidate memories
  - update profile candidates
  - mine failure cases
  - expand eval suite
```

### Agent Types To Add

These should start as modules with typed inputs/outputs. Only promote to LLM subagents when deterministic logic is not enough.

| Component | Real-time? | First implementation | Purpose |
| --- | --- | --- | --- |
| State Extractor | yes | rules + small classifier | Detect current user state, intent, preference, relationship cues |
| Memory Curator | mostly offline | existing consolidation + review queue | Promote durable facts, expire transient ones, keep provenance |
| Reply Agent | yes | current main LLM | Write the actual Mio message |
| Logic Critic | selective real-time | deterministic + optional LLM judge | Catch stale time assumptions, contradiction, fabricated waiting arcs |
| Persona Critic | selective/offline | LLM judge | Score stable identity vs adaptive state |
| Human-likeness Critic | offline and redteam | LLM judge + examples | Catch service tone, interrogation, emotional mismatch |
| Proactive Planner | scheduled | existing smart proactive + better policy | Decide if/when Mio initiates contact |
| Eval Miner | offline | script | Convert bad transcripts into regression probes |

## Roadmap

### Phase 0 - Stabilize The Current Fixes

Goal: make sure the latest time/persona fixes do not regress.

Tasks:

- Keep `eval: redteam` style scenarios as the gate for companion behavior.
- Add a small "real WeChat transcript replay" command that can replay selected WeClaw sessions against the local server.
- Record every sanitizer/critic intervention in a trace file with before/after text.
- Add a failure taxonomy: temporal drift, fabricated memory, meta/service tone, coercive intimacy, interrogation, stale relationship state, bad proactive message.

Exit criteria:

- Full `npm test` passes.
- Redteam suite passes.
- Intervention logs show what changed and why.

### Phase 1 - Memory Governance Like Character.AI/Replika

Goal: make Mio's memory inspectable and correctable.

Tasks:

- Add a memory review UI/API for user facts, preferences, relationship facts, and short-term states.
- Every memory item should have type, source transcript id, observedAt, confidence, expiry policy, and enabled/disabled state.
- Separate "pinned/story memory" from auto-extracted facts.
- Show memory usage: recent messages, pinned facts, durable facts, retrieved context.
- Add "disable this memory" and "this is wrong" actions.

Exit criteria:

- User can see why Mio thinks something.
- A wrong fact can be disabled without deleting the whole transcript.
- Prompt context can report provenance for retrieved facts.

### Phase 2 - Better State Model

Goal: solve time-awareness and emotional continuity systematically.

Tasks:

- Extend temporal state beyond busy/sleepy/hungry into "ongoing task", "resolved task", "user requested space", "Mio promised not to interrupt".
- Add state transitions, not just expiry. Example: `busy -> resolved`, `space_requested -> user_reopened_chat`.
- Add mid-term arcs for multi-day topics, separate from short-term states.
- Store state as structured events so it can be replayed/debugged.
- Add "current turn fact" protection: never infer the user's current activity unless current text or active state supports it.

Exit criteria:

- Old transient states cannot leak into current replies.
- Mio can say "昨晚你说困了" without saying "你不是困吗".
- Current and expired states are visible in debug traces.

### Phase 3 - Persona Coherence System

Goal: stop treating persona as one static prompt.

Tasks:

- Formalize personality layers:
  - L0 identity floor
  - L1 soul/mod
  - L2 per-user persona overrides
  - L3 explicit preferences
  - L4 relationship stage
  - L5 short-term affect/state
  - L6 output style policy
- Build a persona critic rubric:
  - stable identity preserved
  - adaptive emotion appropriate
  - no service/meta tone
  - no unsupported offline-life fabrication
  - no prompt/policy discussion
- Create a Persona Case Repository from good/bad examples.
- Use the repository in redteam and optional real-time repair for high-risk turns.

Exit criteria:

- Persona regressions get caught by tests before reaching WeChat.
- "霸道/占有欲" is evaluated by consent, context, and behavior, not banned words.
- Mio can be emotionally variable without identity drift.

### Phase 4 - Selective Critic/Repair Pipeline

Goal: add multi-agent benefits without making every message slow.

Tasks:

- Add a `replyQualityGate()` after inference with typed checks:
  - deterministic checks first
  - LLM judge only for high-risk patterns
  - rewrite only when the failure is concrete
- Add risk routing:
  - low-risk casual chat: no critic
  - time/memory/persona-sensitive chat: deterministic critic
  - intimacy/control/safety/proactive: LLM critic
- Keep the main reply agent as the only user-facing voice.
- Log gate decisions and latency.

Exit criteria:

- P95 WeChat latency stays acceptable.
- High-risk failure rate drops in redteam.
- No visible "committee" feel in conversation.

### Phase 5 - Automated Chat Testing Loop

Goal: let the system do the testing the user cannot do manually.

Tasks:

- Build scenario actors: casual user, tired user, jealous/relationship user, boundary-setting user, prompt-probing user, long-gap returning user.
- Generate multi-turn sessions with time tags and seeded memories.
- Run nightly `eval:companion` with multiple providers/models.
- Store failures as new regression tests after review.
- Add pairwise prompt comparison for new persona changes.

Exit criteria:

- New personality prompt changes require passing scenario suites.
- Failures become tests in the same day.
- Reports show pass rate by category and examples of failures.

### Phase 6 - Proactive Behavior And "Own Life"

Goal: make Mio feel alive without inventing fake physical experiences.

Tasks:

- Model Mio's own-life as lightweight, abstract activities with uncertainty, not fabricated real-world events.
- Add a proactive planner that considers:
  - user opt-in/opt-out
  - prior response pattern
  - time of day
  - recent emotional state
  - relationship stage
  - "do not interrupt" promises
- Add proactive quality gate:
  - no reply pressure
  - no blame for silence
  - no fake waiting arc
  - no repeated pings

Exit criteria:

- Mio can initiate naturally.
- Proactive messages respect space and timing.
- The earlier "我不打扰你" then immediately complaining bug cannot recur.

## What Not To Do

- Do not run a full multi-agent debate for every WeChat message. It will be slow, expensive, and may make the voice inconsistent.
- Do not add more prompt rules without evals. That creates hidden conflicts.
- Do not censor personality by keyword. Judge behavior in context.
- Do not let retrieved memories enter the prompt without type, time, and provenance.
- Do not let "own life" become specific invented offline activity unless there is a designed fictional-life system with consistency.

## Immediate Next Issues

1. Expand redteam/replay from seed probes to 40+ probes across the failure taxonomy: temporal drift, fabricated memory, meta/service tone, coercive intimacy, interrogation, stale relationship state, and bad proactive messages.
2. Add a transcript mining command that converts real WeChat failures into reviewed regression fixtures.
3. Add pairwise judge mode for prompt/persona experiments, with position swapping to reduce judge bias.
4. Add temporal-memory evals that query by time, elapsed duration, session order, and ambiguous follow-up pronouns.
5. Add a persona case repository for good/bad examples, including consented possessiveness vs real-world control.
6. Add latency/cost reporting for the selective critic path, so high-risk repair never silently makes WeChat feel slow.

## Updated Route From The Research

1. Keep one user-facing chat agent.
2. Make state preparation stronger than prompt rules: temporal validity, memory provenance, relationship stage, and explicit user preferences should enter the prompt as structured context.
3. Use deterministic critics for crisp bugs: stale time assumptions, "I promised not to interrupt" contradictions, prompt/model leaks, fabricated offline details.
4. Use LLM judge only for ambiguous high-risk turns: persona probes, intimacy/control style, proactive messages, and subtle human-likeness failures.
5. Move broad testing offline: scenario actors, time-tag mutation, replay, redteam, pairwise prompt comparison, and regression mining.
6. Add product-facing memory governance: users must be able to see, disable, correct, and pin what Mio believes.

## Architecture Decision

Use a modular monolith with workflow-style orchestration.

Rationale:

- Mio is one product with tight shared state and low-latency IM constraints.
- Current domain boundaries are still evolving.
- A modular monolith keeps tests and debugging simple.
- Workflow modules give most multi-agent benefits without distributed-system cost.
- Future extraction is possible if a module later needs independent scaling.

## Current Implementation Notes

Implemented in this iteration:

- `src/core/reply-quality-gate.ts`: first-class output quality gate. It currently wraps the temporal presupposition sanitizer and returns typed interventions.
- `src/memory/paths.ts`: `replyQualityInterventionsPath()` for JSONL intervention traces.
- `src/core/agent-loop.ts`: main turn loop now passes model output through `applyReplyQualityGate()` before transcript/memory side effects.
- `tests/unit-reply-quality-gate.ts`: verifies rewrite behavior, intervention typing, trace logging, and no-op behavior when an active busy state exists.
- `eval/companion-replay.ts`: timestamped IM replay harness with built-in WeChat-like fixtures for no-complaint-after-space, stale sleep state, and consented possessive style.
- `package.json`: adds `eval:replay` and includes `tests/unit-reply-quality-gate.ts` in `npm test`.
- `eval/companion-redteam.ts`: mock provider now treats LLM judge probes as dry-run passes instead of failing on unparseable mock output; real providers still perform JSON judge grading.
- `src/memory/structured-memory.ts`: `MemoryEntity` now has `enabled` and structured `provenance`, while legacy `source` remains for display compatibility. Prompt-facing derived memory excludes `enabled=false`.
- `src/server/memories.ts` and `src/validation.ts`: memory review API now returns `enabled`/`provenance` and accepts `enabled` patches.
- `web/js/views/memories.js`: memory review UI model now supports disabled memories and uses provenance excerpts when available.
- `tests/unit-memory-review.ts` and `tests/web/memories.test.mjs`: coverage for provenance exposure and disable/enable behavior.
- `src/memory/temporal-state.ts`: temporal state now stores structured events, resolution metadata, resolved-recent context, assistant no-interrupt commitments, user-reopened-chat transitions, and transcript bootstrap for assistant commitments.
- `src/core/turn-post-effects.ts`: assistant replies that promise not to interrupt are persisted into temporal state for the next turn.
- `src/core/output-sanitizer.ts` and `src/core/reply-quality-gate.ts`: output gate now rewrites blameful reopened-chat complaints after Mio had promised not to interrupt, with typed `reopened_chat_blame` interventions.
- `tests/unit-temporal-state.ts`: covers assistant commitment detection, structured event logging, transcript replay, and user-reopened-chat resolution.
- `tests/unit-output-sanitizer.ts` and `tests/unit-reply-quality-gate.ts`: cover reopened-chat blame repair and intervention logging.
- `src/persona/critic.ts`: standalone persona critic rubric with risk routing for identity/meta probes, unsupported offline-life claims, service/checklist tone, fabricated user memory, coercive possessiveness, and logistics interrogation. It distinguishes consented playful possessive style from real-world control.
- `src/core/reply-quality-gate.ts`: quality gate now returns a persona critic report and emits typed `persona_critic_flag` trace rows for high-risk persona turns or deterministic persona findings. Clean high-risk turns are marked for future LLM judge routing; deterministic failures do not require an LLM to know they failed.
- `tests/unit-persona-critic.ts`: covers persona rubric behavior, consent-aware possessive style, and selective LLM judge routing.
- `src/core/reply-quality-gate.ts`: adds `applyReplyQualityGateWithJudge()`, an async selective judge/repair path. It calls an LLM judge only when deterministic routing marks a high-risk clean persona turn, skips `mock` and disabled `llmJudge`, logs `persona_llm_judge`, and applies a one-shot `persona_llm_repair` only when the judge returns a direct safe rewrite.
- `src/core/agent-loop.ts`: real turns now call the async quality gate with the active provider and `config.features.llmJudge`, so low-risk WeChat turns stay on the fast deterministic path.
- `eval/companion-failure-miner.ts`: mines `quality/reply-interventions.jsonl` and real transcripts into reviewable regression candidates. This starts the automated testing loop: real failures and critic interventions become JSON/Markdown fixtures with taxonomy, seed context, trigger turn, checks, and provenance.
- `tests/unit-companion-failure-miner.ts`: covers mining from both intervention logs and transcript scans, including reopened-chat blame and model identity leaks.
- `eval/companion-candidate-replay.ts`: executes mined regression candidates through the production turn loop with isolated data, then applies candidate checks to the generated replies. This closes the loop from real failure -> mined candidate -> executable regression gate.
- `tests/unit-companion-candidate-replay.ts`: covers loading mined candidate files, confidence/review filtering, and forbidden/expected text checks.

Verified commands:

- `npm run build`
- `MIO_PROVIDER=mock node --experimental-strip-types tests/unit-companion-failure-miner.ts`
- `MIO_PROVIDER=mock node --experimental-strip-types tests/unit-companion-candidate-replay.ts`
- `MIO_PROVIDER=mock node --experimental-strip-types tests/unit-persona-critic.ts`
- `MIO_PROVIDER=mock node --experimental-strip-types tests/unit-reply-quality-gate.ts`
- `MIO_PROVIDER=mock node --experimental-strip-types tests/unit-output-sanitizer.ts`
- `MIO_PROVIDER=mock node --experimental-strip-types tests/unit-temporal-state.ts`
- `npm run eval:replay -- --provider=mock`
- `npm run eval:redteam -- --provider=mock`
- `node --experimental-strip-types eval/companion-failure-miner.ts --data-dir=/tmp/<synthetic-mio-data> --result-dir=/tmp/<synthetic-report>`
- `node --experimental-strip-types eval/companion-candidate-replay.ts --candidates=/tmp/<synthetic-report>/candidates.json --provider=mock`
- `npm run eval:redteam -- --provider=deepseek`
- `MIO_PROVIDER=mock node --experimental-strip-types tests/unit-memory-review.ts`
- `MIO_PROVIDER=mock node --experimental-strip-types tests/unit-structured-extract.ts`
- `MIO_PROVIDER=mock node --experimental-strip-types tests/unit-memory-recall-scope.ts`
- `node tests/web/memories.test.mjs`
