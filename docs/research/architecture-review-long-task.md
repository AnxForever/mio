# Mio Architecture Research Long Task

## Objective

持续研究 Mio 当前技术架构是否优秀，形成可累积的架构评估、风险清单、证据日志、改进路线和决策依据。

本任务只做研究和文档更新，不修改源码。

## Hard Constraints

- 只更新本文档，除非用户明确允许更新其他研究文档。
- 不修改 `src/`、`web/`、`packages/`、`tests/`、配置文件或构建脚本。
- 每个架构判断必须指向具体证据：文件、模块、命令输出、测试脚本或文档。
- 不把“看起来合理”当结论；结论需要说明影响和后续验证方式。
- 每轮继续前先读取本文档，并根据 `Next Research Questions` 接着做。
- 如果工作树已有代码改动，把当前工作树视为事实来源，但不要回退或继续改代码。

## Research Method

采用多角色架构审核方式，参考 `docs/architecture-audit-agents.md`：

- Principal Architect：整体架构与模块边界。
- Runtime Reliability Engineer：运行可靠性、Provider、调度、长进程风险。
- Memory Systems Reviewer：记忆分层、检索、隔离、整合。
- Agent Behavior and Prompt Architect：persona、prompt、工具、情绪行为控制。
- Security and Privacy Reviewer：认证、上传、路径、IM 隔离、隐私。
- Product Scalability Reviewer：新增渠道、Provider、插件、前端视图的扩展性。

评分规则：

- `5`: strong design, low risk, fits project direction
- `4`: good design, manageable issues
- `3`: acceptable but needs explicit trade-offs
- `2`: fragile or over-coupled
- `1`: blocks long-term maintainability or safety

## Work Queue

- [x] 建立长期研究文档
- [x] 建立第一轮架构证据基线
- [x] 初步判断整体架构模式
- [x] 深入研究 core turn loop
- [x] 深入研究 memory 系统
- [x] 深入研究 emotion / relationship 系统
- [x] 深入研究 persona / ID-RAG 系统
- [x] 深入研究 provider / tool / plugin 系统
- [x] 深入研究 server / API / bridge 系统
- [x] 深入研究 frontend 架构
- [x] 深入研究测试体系
- [x] 形成阶段性架构评分
- [x] 形成改进路线图
- [x] 形成论文/展示可用的架构亮点

## Current Worktree State

本轮开始时，目标研究文档不存在。

当前工作树已有未提交改动：

- `src/core/agent-loop.ts`
- `src/core/turn-conversation.ts`
- `src/core/turn-counter.ts`
- `src/core/turn-input.ts`
- `src/core/turn-post-effects.ts`
- `src/core/turn-prepare.ts`
- `src/core/turn-session.ts`
- `src/core/turn-silence.ts`
- `src/core/turn-types.ts`
- `docs/architecture-audit-agents.md`

研究结论以当前工作树为事实来源。上述源码改动不是本研究任务产生的，不在本任务中继续修改。

## Evidence Log

### 2026-06-28: Project Identity And Stack

Evidence:

- `README.md`: Mio is described as a privacy-first emotional AI companion, local-first, no telemetry, no accounts.
- `README.md`: key capabilities include PAD 3D emotion, OCEAN traits, 5-axis affinity, ID-RAG persona graph, 3-phase memory consolidation, plugin architecture, 9 LLM backends, crisis detection, zero-framework web UI, voice, notifications.
- `package.json`: monorepo name `mio-monorepo`, version `0.6.0`, ESM via `"type": "module"`.
- `package.json`: workspaces are `packages/emotion` and `packages/idrag`.
- `package.json`: runtime dependencies are relatively small and focused: `better-sqlite3`, `croner`, `dotenv`, `express`, `sharp`, `sqlite-vec`, `ws`, `zod`, plus internal packages.
- `tsconfig.json`: strict TypeScript, ES2022 target, bundler module resolution, declarations enabled.

Observation:

Mio is best understood as a stateful local-first agent runtime, not a stateless chatbot app. The stack supports that: a single Node.js process, local filesystem state, SQLite vector storage, Express/WS for UI and integrations, and internal packages for reusable emotion and ID-RAG engines.

Initial judgment:

The architecture pattern should be called a modular monolith with ports/adapters tendencies, not microservices. This is appropriate because the product is local-first, personal, and operational simplicity matters more than independent service deployment.

### 2026-06-28: Module Distribution

Command:

```bash
find src -maxdepth 2 -type f -name '*.ts' | cut -d/ -f2 | sort | uniq -c | sort -nr
```

Observed distribution:

```text
20 memory
15 emotion
11 server
11 core
8 tools
8 providers
8 character
7 persona
5 scheduler
5 prompt
4 utils
3 voice
3 subagent
3 plugins
3 learning
2 relationship
1 vision
1 validation.ts
1 types.ts
1 safety
1 onboarding
1 mod
1 index.ts
1 config.ts
```

Observation:

The domain decomposition is real. `memory`, `emotion`, `server`, `core`, `tools`, `providers`, `character`, and `persona` are visible top-level concerns. This is a positive sign: the architecture already has vocabulary that matches the product domain.

Risk:

Module count alone does not prove low coupling. The next research step must inspect import direction and identify whether `core` coordinates modules cleanly or whether feature modules reach back into orchestration.

### 2026-06-28: Large File Pressure

Command:

```bash
find src packages web/js web/css -type f \( -name '*.ts' -o -name '*.js' -o -name '*.css' \) -not -path '*/dist/*' -not -path '*/node_modules/*' -print0 | xargs -0 wc -l | sort -nr | sed -n '1,45p'
```

Largest files observed:

```text
1359 src/server/index.ts
1009 src/core/agent-loop.ts
932 src/memory/structured-memory.ts
819 src/persona/graph.ts
819 packages/idrag/src/graph.ts
754 web/js/views/studio.js
687 packages/emotion/src/ritual.ts
685 src/emotion/ritual.ts
666 web/css/chat.css
645 web/css/studio.css
637 src/memory/reflector.ts
629 web/js/views/chat.js
618 packages/emotion/src/pad.ts
617 src/emotion/pad.ts
593 src/memory/search.ts
593 src/memory/consolidation-phases.ts
584 src/config.ts
583 src/providers/openai-compatible.ts
574 packages/idrag/src/driver.ts
573 src/persona/driver.ts
572 src/server/notify.ts
572 src/prompt/templates.ts
553 src/scheduler/smart-proactive.ts
498 src/prompt/context-engine.ts
492 src/server/onebot.ts
484 src/scheduler/proactive.ts
482 src/memory/vector.ts
478 src/memory/procedural-memory.ts
469 src/server/openai-compat.ts
453 src/index.ts
444 src/memory/lorebook.ts
434 src/providers/anthropic.ts
428 src/types.ts
```

Observation:

The current worktree already reflects prior loop splitting: `src/core/agent-loop.ts` is 1009 lines and several `src/core/turn-*.ts` modules exist. Before the split, `agent-loop.ts` was the strongest integration pressure point; now `server/index.ts` is the largest file and likely the next structural bottleneck.

Initial maintainability risk ranking:

1. `src/server/index.ts`: largest file, likely route-family aggregation and HTTP/WS bridge concentration.
2. `src/core/agent-loop.ts`: still large, but now appears to be shrinking toward prompt/inference orchestration.
3. `src/memory/structured-memory.ts`: likely combines schema, extraction, persistence, and provider routing.
4. `src/persona/graph.ts` and `packages/idrag/src/graph.ts`: duplication risk or source-of-truth drift risk.
5. `src/emotion/*` and `packages/emotion/*`: package/app parallel implementation risk.

### 2026-06-28: Existing Architecture Audit Panel

Evidence:

- `docs/architecture-audit-agents.md` exists in current worktree.
- It defines six review roles: Principal Architect, Runtime Reliability Engineer, Memory Systems Reviewer, Agent Behavior and Prompt Architect, Security and Privacy Reviewer, Product Scalability Reviewer.
- It records an initial verdict: overall `good`, with excellent product-architecture fit and maintainability pressure points.

Observation:

This document is useful as a review rubric, but it is not a research log. This long task document should become the cumulative evidence base, while `architecture-audit-agents.md` remains the role checklist.

### 2026-06-28: Core Turn Loop Deep Dive

Evidence commands:

```bash
rg -n "^function |^async function |^export async function |^export function |^interface |^type |^export type |^let |^const " src/core/agent-loop.ts src/core/turn-*.ts
rg -n "from '../|from './" src/core/*.ts
wc -l src/core/agent-loop.ts src/core/turn-*.ts src/core/inference-loop.ts src/core/tool-runtime.ts | sort -nr
sed -n '1,220p' src/core/agent-loop.ts
sed -n '520,1040p' src/core/agent-loop.ts
sed -n '1,240p' src/core/turn-prepare.ts
sed -n '1,260p' src/core/turn-post-effects.ts
sed -n '1,270p' tests/golden-turn.ts
```

Observed core file sizes:

```text
2023 total
1009 src/core/agent-loop.ts
231 src/core/turn-post-effects.ts
131 src/core/turn-silence.ts
125 src/core/inference-loop.ts
119 src/core/turn-conversation.ts
108 src/core/tool-runtime.ts
106 src/core/turn-prepare.ts
81 src/core/turn-session.ts
77 src/core/turn-types.ts
26 src/core/turn-input.ts
10 src/core/turn-counter.ts
```

Responsibilities still inside `src/core/agent-loop.ts`:

- Prompt section ownership: `buildSystemPrompt` and `registerPromptSections` remain in `agent-loop.ts` and register identity, kernel, preference, session privacy, soul/persona, relationship, user, memory, structured memory, lorebook, relations, time, emotion, PAD, personality, affinity, attachment, plugins, ritual, cardboard, mirror, feedback, procedural memory, life events, few-shot, dynamic few-shot, and recovery sections.
- Memory prompt construction: `buildMemorySection` combines semantic memory hydrated on `PromptCtx` with recent bookmarks.
- Async semantic memory prefetch: `prefetchSemanticMemories` calls vector search and LLM rerank before prompt assembly.
- Post-history prompt mode: `buildPostPrompt`, `buildIsolatedPostPrompt`, and `buildPrePrompt` live in `agent-loop.ts`.
- Persona retrieval: `buildPersonaFragment` lazy-initializes ID-RAG persona graph and retrieves relevant nodes from current topics, task intent, relationship stage, and recent bookmarks.
- Prompt-time behavior augmentation: `applyPrePromptPersonalityDriver` and `applyPromptAugmentations` update personality driver, lorebook state, builder-chain evaluation, and dual-mode prompt fragments.
- Inference stage: `runInferenceStage` coordinates pre-prompt effects, semantic memory prefetch, prompt assembly, conversation message building, transcript user write, scoped tools, and `runInferenceLoop`.
- Public entrypoint: `runTurn` is now small and reads as a clear four-step pipeline: prepare, early exit, inference, post-turn side effects.

Evidence by line:

- `src/core/agent-loop.ts:25-109` imports prompt, persona, providers, plugins, memory, learning, emotion, relationship, safety, character, and core turn modules. This proves the file is still a high-fan-in integration point.
- `src/core/agent-loop.ts:145-175` builds the system prompt through `ContextEngine`.
- `src/core/agent-loop.ts:177-518` registers the prompt sections. The section registry is explicit and priority-aware, which is good, but the file owns too many domain-specific section decisions.
- `src/core/agent-loop.ts:541-593` builds and prefetches semantic memory, coupling turn orchestration to vector search and reranking.
- `src/core/agent-loop.ts:612-743` owns post-history injection prompt variants.
- `src/core/agent-loop.ts:765-790` owns persona graph retrieval fallback behavior.
- `src/core/agent-loop.ts:820-857` owns lorebook commit, builder-chain evaluation, and dual-mode prompt augmentation.
- `src/core/agent-loop.ts:859-920` owns the inference stage.
- `src/core/agent-loop.ts:939-986` shows the top-level `runTurn` function is now concise.

Assessment of the new `turn-*.ts` split:

- `src/core/turn-prepare.ts` is cohesive enough: it handles bank/plugin/tool setup, provider selection, input normalization, session id, directive capture, session context, plugin `onSessionStart/onBeforeTurn`, user message creation, activity tracking, bookmark reindex dirty check, and crisis screening. This is still broad, but it maps to "prepare turn context" rather than random extracted code.
- `src/core/turn-silence.ts` is cohesive: it owns early exits for reply necessity and ghost silence, including transcript recording and isolated-session gating.
- `src/core/turn-conversation.ts` is cohesive but still takes callback parameters for `buildPrePrompt` and `buildPostPrompt`, which is a sign that prompt ownership has not fully moved out of `agent-loop.ts`.
- `src/core/turn-post-effects.ts` is cohesive by phase, but internally it still aggregates many domains: emotion tracking, affinity, frustration, ritual, relationship progression, dynamic few-shot, dual-mode, personality/life events, bookmarks, active context, and session close. This is an acceptable phase module, but not yet a clean domain boundary.
- `src/core/turn-input.ts`, `turn-session.ts`, `turn-counter.ts`, and `turn-types.ts` are small and appropriately scoped.

Judgment:

The loop split is an architectural improvement. It makes `runTurn` understandable and separates preparation, early exit, conversation history construction, inference-loop execution, and post-turn side effects. This raises confidence that the orchestration can continue to be refactored without changing public behavior.

However, the split is not yet enough to call the architecture excellent. `agent-loop.ts` remains the owner of prompt architecture, persona retrieval, memory retrieval, prompt-time behavioral mutations, and inference staging. The strongest remaining boundary issue is not line count alone; it is that one file still decides how memory, emotion, persona, learning, lorebook, and dual-mode enter the model context.

Target boundary if future refactoring is allowed:

- Extract `turn-prompt.ts` or `prompt/turn-prompt.ts` for `buildSystemPrompt`, `registerPromptSections`, post-history prompt variants, isolated prompt variants, and safety prompt injection.
- Extract `turn-memory-context.ts` or move semantic memory prefetch into a memory-owned service so `core` asks for "memory context for turn" rather than calling vector search and rerank directly.
- Extract persona retrieval into a persona-owned context provider so `agent-loop.ts` does not call `ensurePersonaGraph`, `retrieveRelevantNodes`, or `graphToPrompt` directly.
- Keep `runTurn` as the public pipeline and keep `runInferenceStage` thin: input should be prepared context plus prompt/conversation services, output should be inference result plus intent/budget.

Testing evidence:

- `tests/golden-turn.ts:1-7` states it is a golden regression for one complete agent turn.
- `tests/golden-turn.ts:59-91` checks normal turn output shape, transcript writes, bookmark append, Active Context update, and data directory creation.
- `tests/golden-turn.ts:93-105` checks continuing an existing session.
- `tests/golden-turn.ts:107-118` checks crisis flagging and crisis bookmark writes.
- `tests/golden-turn.ts:138-157` checks ghost path behavior without inference.
- `tests/golden-turn.ts:177-208` checks tool-loop execution.
- `tests/golden-turn.ts:220-250` checks post-history mode preserves the crisis safety override.
- Additional static evidence from test discovery shows related tests for `unit-context-engine`, `unit-im-session-isolation`, `unit-persona-tool-allowlist`, `unit-semantic-memory`, `unit-emotion`, HTTP smoke, OpenAI compatibility, and E2E crisis behavior.

Risk:

The existing tests protect observable behavior well, but they mostly test the turn as an integrated unit. They do not yet make prompt section ownership independently easy to validate. If prompt architecture changes continue inside `agent-loop.ts`, regressions may still require broad golden tests to diagnose.

Role verdicts for this slice:

| Reviewer | Slice Verdict | Notes |
|---|---|---|
| Principal Architect | `good` | The public turn pipeline is clearer, but `agent-loop.ts` remains a central integration file. |
| Runtime Reliability Engineer | `good` | Best-effort handling exists for reindex, semantic search, and async learning effects; deeper provider/fallback review still pending. |
| Memory Systems Reviewer | `mixed` | Isolation checks appear in core, but core still directly builds and retrieves memory context. Needs memory-system deep dive. |
| Agent Behavior and Prompt Architect | `good` | Prompt assembly is explicit and budget-aware, but prompt section ownership is too concentrated. |
| Security and Privacy Reviewer | `mixed` | Isolated-session prompt/tool behavior is visible and tested, but endpoint/path review is still pending. |
| Product Scalability Reviewer | `mixed` | Adding new behavioral context still likely requires edits in `agent-loop.ts`. |

### 2026-06-28: Memory System Deep Dive

Evidence commands:

```bash
rg -n "join\\(|resolve\\(|MIO_DIR|colaDir|memory-bank|transcripts|structured-memory|BOOKMARKS|MEMORY.md" src/memory src/core src/server src/tools tests
rg -n "^export |^async function |^function |^interface |^type |^const " src/memory/*.ts
wc -l src/memory/*.ts | sort -nr | sed -n '1,35p'
sed -n '1,280p' src/memory/paths.ts
sed -n '1,320p' src/memory/bank.ts
sed -n '1,220p' src/memory/transcript.ts
sed -n '1,540p' src/memory/vector.ts
sed -n '1,340p' src/memory/sqlite-vector.ts
sed -n '1,620p' src/memory/search.ts
sed -n '1,960p' src/memory/structured-memory.ts
sed -n '1,580p' src/memory/consolidation-phases.ts
sed -n '1,240p' tests/unit-im-session-isolation.ts
sed -n '1,220p' tests/unit-memory-recall-scope.ts
sed -n '1,180p' tests/unit-vector-incremental.ts
```

Observed memory file sizes:

```text
7247 total
932 src/memory/structured-memory.ts
637 src/memory/reflector.ts
593 src/memory/search.ts
593 src/memory/consolidation-phases.ts
482 src/memory/vector.ts
478 src/memory/procedural-memory.ts
444 src/memory/lorebook.ts
396 src/memory/entity-graph.ts
396 src/memory/adaptive-history.ts
393 src/memory/judge.ts
319 src/memory/compression.ts
299 src/memory/sqlite-vector.ts
284 src/memory/bank.ts
254 src/memory/paths.ts
220 src/memory/rerank.ts
194 src/memory/embedding.ts
172 src/memory/transcript.ts
121 src/memory/persona-delta.ts
31 src/memory/scope.ts
9 src/memory/global.ts
```

Architecture shape:

- `src/memory/paths.ts` is a real path boundary. It centralizes `memory-bank`, `MEMORY.md`, `BOOKMARKS.md`, `cola-self-reference`, diary, notes, tasks, global memory, mods, persona graph, uploads, consolidation checkpoint, snapshots, structured memory, per-user state, mid-term topics, emotion state files, transcripts, ritual, cardboard, and procedural memory paths.
- `src/memory/bank.ts` is the file-backed memory-bank API. It creates the directory structure, writes `MEMORY.md`, `BOOKMARKS.md`, procedural memory bootstrap, supports atomic writes, snapshots, checkpoint read/write, structured-memory file wrappers, mid-term file wrappers, and memory-bank-only search.
- `src/memory/transcript.ts` is short and cohesive: append JSONL transcript entries, read/filter transcript, search one transcript, load recent message window, list transcripts, find latest session, record messages, mark session done, and load recent transcripts.
- `src/memory/vector.ts` is the vector store facade. It preserves the public API while delegating storage to SQLite, supports TF and MiniMax embedding types, migrates legacy JSONL, reindexes bookmarks incrementally, fuses dense KNN with keyword ranking, and exposes stats.
- `src/memory/sqlite-vector.ts` is the SQLite backend. It handles WAL, sqlite-vec loading, dense vec0 table creation, sparse/dense serialization, upserts, batch writes, deletes, reads, stats, and dense KNN.
- `src/memory/search.ts` is hybrid search across memory bank and transcripts: keyword matching, semantic search, RRF fusion, time decay, role filtering, and transcript scope.
- `src/memory/structured-memory.ts` implements the research-heavy memory lifecycle: schema, regex extraction, dirty source tracking, LLM atomic-fact extraction, provider routing, JSON parsing/validation, merge, confidence decay, topic clustering, durable fact selection, prompt context rendering, serialization, disk I/O, and mid-term cleanup.
- `src/memory/consolidation-phases.ts` implements a three-phase nightly pipeline: LIGHT prioritization, DEEP extraction/ACE reflection/write changes, and REM procedural pattern extraction.

Positive evidence:

- `src/memory/paths.ts:10-253` centralizes most durable state paths and includes sanitization for external user ids at `src/memory/paths.ts:230-238`.
- `src/memory/bank.ts:31-38` uses same-directory temporary files plus `renameSync` for atomic writes, reducing partial-write risk for core memory files.
- `src/memory/bank.ts:46-63` bootstraps the memory-bank structure and required base files.
- `src/memory/transcript.ts:27-32` uses append-only JSONL for transcripts, which matches the documented convention.
- `src/memory/transcript.ts:38-45` skips malformed transcript lines rather than failing the whole read.
- `src/memory/vector.ts:1-11` documents the SQLite + sqlite-vec replacement and why TF remains an offline fallback.
- `src/memory/vector.ts:205-240` migrates legacy JSONL into SQLite and renames the legacy file aside.
- `src/memory/vector.ts:446-473` makes bookmark reindex incremental and only rebuilds on embedding-provider type mismatch.
- `src/memory/sqlite-vector.ts:67-92` reopens the database when data dir changes and enables WAL.
- `src/memory/search.ts:493-524` wraps semantic search in fallback behavior so keyword results survive semantic failure.
- `src/memory/structured-memory.ts:275-283` makes dirty extraction avoid reprocessing unchanged bookmark snapshots.
- `src/memory/structured-memory.ts:581-600` falls back to regex extraction when LLM extraction is unavailable or malformed.
- `src/memory/structured-memory.ts:608-667` merges repeated entities and decays old unconfirmed entities.
- `src/memory/structured-memory.ts:709-756` renders structured memory into bounded prompt-facing sections.
- `src/memory/consolidation-phases.ts:1-18` documents a clear 3-phase consolidation design.
- `src/memory/consolidation-phases.ts:226-299` logs DEEP phase changes and writes structured memory through ACE reflection when enabled.
- `src/memory/consolidation-phases.ts:358-472` extracts recurring topics, emotions, behavioral insights, and procedural rules.

Isolation evidence:

- `src/memory/scope.ts` scopes transcript search by session/channel. Private `onebot-private-*` and `openai-*` sessions are exact-scope only; `onebot-group-*` sessions share a group prefix.
- `src/memory/search.ts:245-326` applies `transcriptVisibleInScope` before reading transcript content.
- `src/memory/search.ts:493-510` searches global memory bank by default unless `searchMemory` is false or role filtering is used. This is a deliberate design, but it means isolation depends on the caller passing the right options.
- `tests/unit-im-session-isolation.ts:102-140` asserts isolated sessions omit global bookmarks/user profile, avoid global bookmark writes, keep contact transcripts, expose only `current_time`, and deny hidden forbidden tool calls.
- `tests/unit-memory-recall-scope.ts:57-92` asserts group-scoped transcript recall includes same-group data and excludes another group.

Performance and reliability evidence:

- `tests/unit-vector-incremental.ts:1-16` states the regression target: per-turn bookmark reindex must embed only new lines, not full history, except provider switches.
- `tests/unit-vector-incremental.ts:98-121` verifies first reindex, one-new-bookmark reindex, and no-new-bookmark no-op behavior.
- `tests/unit-vector-incremental.ts:124-141` verifies provider switch triggers a full rebuild.
- `tests/unit-sqlite-vector.ts` covers dense KNN, stable upsert, sparse roundtrip, stats, delete-by-source, migration, TF search, incremental reindex, and dense entry materialization.
- `tests/unit-memory-recall-scope.ts:94-112` verifies dirty structured memory extraction skips unchanged snapshots and extracts only new lines while preserving existing entities.

Risks:

- `src/memory/structured-memory.ts` is the largest memory file and combines too many concerns: data model, regex extraction, LLM prompt and provider routing, dirty-state tracking, merge/decay, topic clustering, prompt rendering, serialization, persistence, and mid-term cleanup. It is strong product logic, but not a clean internal boundary.
- `src/memory/search.ts` combines transcript search, memory-bank search, semantic fallback, RRF, time decay, and scope handling. This is acceptable now, but it makes privacy behavior partly dependent on correct option plumbing.
- `src/memory/consolidation-phases.ts` writes durable user-profile, relationship, soul, notes, structured memory, and procedural memory in one flow. There is logging and snapshot support exists in `bank.ts`, but this read-only pass did not prove transactional recovery across multi-file partial failure.
- There are some path joins outside `paths.ts`. Many are local derived paths and acceptable, but examples like `src/core/turn-prepare.ts:95` constructing `colaDir() + '/memory-bank/BOOKMARKS.md'`, `src/memory/vector.ts:197` constructing legacy JSONL path from `getDataDir()`, and `src/memory/sqlite-vector.ts:60` constructing `vector.db` directly should be considered minor boundary drift. Prefer adding explicit path helpers if these paths become public contracts.
- `transcriptPath(sessionId)` does not sanitize `sessionId`; current session ids appear generated or prefixed by controlled bridges, but this deserves security review when studying server/API inputs.

Judgment:

The memory system is a product-architecture strength. It is not a simple chat history; it has STM transcripts, memory bank, active context, bookmarks, structured long-term memory, mid-term topics, vector recall, lorebook, procedural memory, entity graph, global memory, per-user preferences, and nightly consolidation. This matches Mio's goal better than a generic RAG store.

The system is not yet excellent because it has high complexity concentrated in a few files and still relies on careful caller discipline for isolation and search scope. The right next improvement direction is not to replace the memory architecture; it is to harden boundaries around retrieval scope, structured extraction, and consolidation writes.

Target boundary if future refactoring is allowed:

- Split `structured-memory.ts` into `schema`, `extract-regex`, `extract-llm`, `merge-policy`, `context-renderer`, and `persistence` modules.
- Add explicit path helpers for vector DB, legacy vector JSONL, notes consolidated file, and bookmark path access used by core reindexing.
- Move transcript scope policy closer to public search APIs so unsafe defaults are harder to call from isolated contexts.
- Give consolidation a small write plan / commit log abstraction so multi-file updates can be audited and resumed after partial failure.
- Keep append-only transcripts and atomic memory-bank writes; those are good primitives.

Role verdicts for this slice:

| Reviewer | Slice Verdict | Notes |
|---|---|---|
| Principal Architect | `good` | Memory has clear subdomains and fits the local-first product, but several files are too broad. |
| Runtime Reliability Engineer | `good` | Atomic writes, append-only transcripts, SQLite WAL, incremental reindex, and fallbacks are positive; multi-file consolidation recovery is still unproven. |
| Memory Systems Reviewer | `good` | The layered memory model is strong and tested; structured extraction and search scope need cleaner internal seams. |
| Agent Behavior and Prompt Architect | `good` | Memory context is intentional and prompt-facing output is bounded; core still owns some retrieval composition. |
| Security and Privacy Reviewer | `mixed` | IM isolation tests are strong, but search defaults and unsanitized transcript ids need deeper server/API review. |
| Product Scalability Reviewer | `mixed` | The memory feature set can grow, but `structured-memory.ts`, `search.ts`, and `consolidation-phases.ts` will become friction points. |

### 2026-06-28: Emotion / Relationship System Deep Dive

Evidence commands:

```bash
find src/emotion src/relationship packages/emotion/src -maxdepth 1 -type f -name '*.ts' | sort
wc -l src/emotion/*.ts src/relationship/*.ts packages/emotion/src/*.ts | sort -nr | sed -n '1,60p'
for f in src/emotion/*.ts; do b=$(basename "$f"); if [ -f "packages/emotion/src/$b" ]; then if cmp -s "$f" "packages/emotion/src/$b"; then printf 'same %s\n' "$b"; else printf 'diff %s\n' "$b"; fi; fi; done | sort
rg -n "export async function trackEmotion|updatePAD|updateAffinity|updateFrustration|updateMultiAxis|getConfig\(\)\.features|recordInteraction|recordEmotionalDepth|appendEmotionHistory" src/emotion/tracker.ts src/core/turn-post-effects.ts src/emotion/state.ts src/emotion/pad.ts src/emotion/affinity.ts src/emotion/multi-axis.ts src/emotion/frustration.ts src/relationship/progression.ts src/relationship/stages.ts
diff -u src/emotion/tracker.ts packages/emotion/src/tracker.ts | sed -n '1,220p'
diff -u src/emotion/ghost.ts packages/emotion/src/ghost.ts | sed -n '1,220p'
sed -n '1,260p' packages/emotion/src/index.ts
sed -n '1,180p' packages/emotion/src/context.ts
```

Observed emotion / relationship file sizes:

```text
9291 total
687 packages/emotion/src/ritual.ts
685 src/emotion/ritual.ts
618 packages/emotion/src/pad.ts
617 src/emotion/pad.ts
333 src/emotion/signals.ts
333 packages/emotion/src/signals.ts
317 packages/emotion/src/multi-axis.ts
316 src/emotion/multi-axis.ts
310 src/emotion/trait-state.ts
310 packages/emotion/src/trait-state.ts
292 src/emotion/experience-trait.ts
292 packages/emotion/src/experience-trait.ts
290 src/emotion/classifier.ts
290 packages/emotion/src/classifier.ts
281 src/emotion/lexical-mood.ts
281 packages/emotion/src/lexical-mood.ts
243 src/emotion/frustration.ts
243 packages/emotion/src/frustration.ts
228 src/emotion/ghost.ts
222 src/emotion/tracker.ts
215 packages/emotion/src/tracker.ts
214 packages/emotion/src/ghost.ts
198 src/emotion/reply-necessity.ts
175 src/relationship/progression.ts
173 packages/emotion/src/affinity.ts
172 src/emotion/affinity.ts
148 packages/emotion/src/state.ts
147 src/emotion/state.ts
94 packages/emotion/src/index.ts
92 src/relationship/stages.ts
59 packages/emotion/src/context.ts
58 src/emotion/circadian.ts
```

Package drift evidence:

```text
diff affinity.ts
diff experience-trait.ts
diff frustration.ts
diff ghost.ts
diff lexical-mood.ts
diff multi-axis.ts
diff pad.ts
diff ritual.ts
diff signals.ts
diff state.ts
diff tracker.ts
same classifier.ts
same trait-state.ts
```

Architecture shape:

- The system is a set of explicit emotional and relationship state machines, not a single mood flag. The application has legacy `EmotionState`, PAD, trait-state rolling PAD, legacy 5-axis affinity, newer multi-axis relationship, frustration/attachment, relationship stage progression, ritual/cardboard quality signals, ghost silence, and reply necessity.
- `src/emotion/tracker.ts` is the main per-turn emotion orchestrator. It applies PAD decay, classifies user intent, updates legacy affection/mood/topic fields, records relationship depth, updates PAD, records PAD into trait-state, analyzes response signals, updates multi-axis relationship, writes `emotion-state.json`, syncs PAD back to legacy mood/energy, and records interaction count.
- `src/core/turn-post-effects.ts` is the wider post-turn side-effect hub. After the assistant reply, it records the assistant message, skips global emotional side effects for isolated memory sessions, calls `trackEmotion`, schedules learning, updates ritual/cardboard, legacy affinity, frustration, dual-mode history, progression, personality/life events, bookmarks, active context, and session completion.
- `src/relationship/stages.ts` keeps relationship gating in code, not only prompt text. It defines stage configs and exposes `canUseNicknames`, `canSendProactiveMsgs`, and `canExpressIntimacy`.
- `src/relationship/progression.ts` persists relationship stage state and defines concrete thresholds: acquaintance to familiar at 50 interactions / 10 depth, familiar to ambiguous at 150 / 40, ambiguous to intimate at 300 / 80.
- `packages/emotion/src/context.ts` shows a good intended package boundary: package code receives paths, I/O, transcript access, and config through `initEmotion()` instead of importing the host app directly. `packages/emotion/src/index.ts` exposes the package as a public API for PAD, traits, affinity, multi-axis, ghost, frustration, classifier, signals, ritual, lexical mood, legacy state, and tracker.

Positive evidence:

- `src/emotion/state.ts:42-52` and `src/relationship/progression.ts:53-68` tolerate missing or corrupt JSON by returning defaults instead of crashing a turn.
- `src/emotion/state.ts:105-123` reads PAD-aware emotion state while preserving legacy fields, and `src/emotion/state.ts:132-147` syncs PAD mood/energy back into the legacy state as best-effort compatibility.
- `src/emotion/pad.ts:73-76` gates PAD by `MIO_PAD_ENABLED`, `src/emotion/pad.ts:164-179` clamps and defaults corrupt PAD state, and `src/emotion/pad.ts:196-205` clamps all PAD updates to `[-1, 1]`.
- `src/emotion/pad.ts:239-260` implements exponential decay toward a personality-adjusted baseline, which is a stronger model than pure keyword mood flips.
- `src/emotion/tracker.ts:93-98` records emotional depth for meaningful exchanges, and `src/emotion/tracker.ts:185-186` records interaction count. This directly feeds relationship progression.
- `src/core/turn-post-effects.ts:60-64` skips global emotion tracking for isolated memory sessions, and `src/core/turn-post-effects.ts:116-135` skips relational side effects under isolation while still progressing normal sessions.
- `src/emotion/multi-axis.ts:32-37` feature-gates the newer multi-axis model through config, and `src/emotion/multi-axis.ts:129-167` gives a clear update policy for closeness, trust, and neediness.
- `src/emotion/frustration.ts:169-183` derives attachment from multi-axis when enabled but falls back to legacy affinity when multi-axis has no clear signal.
- `src/emotion/ghost.ts:104-109` prevents ghost silence for OpenAI/OneBot bridge sessions, avoiding empty replies on IM surfaces.
- `src/core/turn-silence.ts:43-57` only runs ghost for non-isolated memory sessions and non-crisis turns, then records a silent assistant turn and plugin hooks when ghosting.
- `src/relationship/stages.ts:30-85` puts stage behavior gates in typed code. This is architecturally stronger than relying on prompt instruction alone.
- `src/relationship/progression.ts:137-155` checks stage progression at runtime, and `src/core/turn-post-effects.ts:133-135` calls it after turn updates so progression does not depend only on nightly jobs.

Testing evidence:

- `tests/unit-emotion.ts:58-166` covers ghost behavior, including long-message no-ghost, cold-start no-ghost, high-tension no-ghost, low-patience no-ghost, double-ghost protection, and IM bridge no-ghost.
- `tests/unit-emotion.ts:168-233` covers PAD classification, decay, and mood conversion.
- `tests/unit-emotion.ts:235-276` covers legacy affinity deltas and ghost penalty.
- `tests/unit-emotion.ts:278-339` covers frustration streaks, warm reset, mini-crisis trigger, attachment context, and attachment derivation.
- `tests/unit-progression-wiring.ts:36-44` proves `trackEmotion` grows `emotionalDepth`; `tests/unit-progression-wiring.ts:46-53` proves `checkProgression` advances at threshold; `tests/unit-progression-wiring.ts:55-59` proves `interactionCount` climbs per turn.
- `tests/unit-directive-isolation.ts:29-40` verifies isolated IM directive handling does not write global relationship state and does not leak one user's preferences to another user.

Risks:

- There are overlapping sources of emotional and relationship truth: legacy `EmotionState.affection/myMood`, PAD, trait-state rolling PAD, legacy affinity, multi-axis relationship, frustration attachment, relationship stage progression, ritual/cardboard, ghost state, and reply necessity. This is product-rich, but the architecture needs a source-of-truth policy for which state drives which behavior.
- `src/core/turn-post-effects.ts` is a high-coupling side-effect hub. It is phase-cohesive, but one function path coordinates emotion, relationship, learning, persona, character life events, memory, active context, and sessions.
- Frustration state is process-local in `src/emotion/frustration.ts:22-30`, while many other emotion states are file-backed. Restart behavior may be acceptable for short-lived tension, but it should be explicit because mini-crisis and attachment context depend on this in-memory state.
- Legacy affinity and multi-axis relationship both model closeness/trust-like concepts. `src/emotion/frustration.ts:169-183` bridges them, but this also proves the architecture has two relationship models running in parallel.
- The package extraction is currently a drift risk. Only `classifier.ts` and `trait-state.ts` were byte-identical between `src/emotion` and `packages/emotion/src`; most paired files differ.
- Some package drift is functionally meaningful. `src/emotion/tracker.ts:93-98` records emotional depth, but `packages/emotion/src/tracker.ts` does not in the diff. `src/emotion/ghost.ts:104-109` prevents ghosting for IM bridge sessions, but `packages/emotion/src/ghost.ts` does not in the diff. If consumers use `@mio/emotion`, their behavior can diverge from the app.
- There is no clear direct test evidence for multi-axis relationship update behavior in the inspected unit tests. The model is well-defined in code, but tests should prove closeness/trust/neediness changes and attachment derivation under feature flags.

Judgment:

The emotion / relationship system is sophisticated and well-aligned with Mio's product goal. It has explicit state machines, bounded numeric models, feature gates, per-turn update wiring, code-level relationship gates, and regression tests around ghost, PAD, affinity, frustration, and progression. This is stronger than a prototype companion bot and supports the claim that Mio is a stateful local emotional agent.

It is still not excellent architecture because the emotional model has accumulated parallel state systems and package/app duplication. The application version appears more behaviorally current than `@mio/emotion`, which weakens the package as a reliable abstraction boundary. The right direction is not to simplify the product model into one scalar; it is to document state ownership and eliminate package drift.

Target boundary if future refactoring is allowed:

- Define an emotion state ownership matrix: PAD owns mood/energy, relationship progression owns stage, multi-axis owns closeness/trust/neediness, affinity is either legacy compatibility or a deprecated prompt context, frustration owns only short-lived process tension unless persisted deliberately.
- Move post-turn emotional orchestration behind an `emotionTurnService` interface so `core` calls one cohesive subsystem rather than coordinating every state writer.
- Pick one source of truth for package code. Either generate/sync `packages/emotion` from app modules or invert the dependency so the app imports the package through injected I/O.
- Add unit tests for multi-axis update and feature-gated attachment derivation.
- Decide whether frustration mini-crisis state should persist across restarts. If yes, make it file-backed; if no, document it as ephemeral pacing state.
- Keep code-level stage gates; this is a strong design choice and should not be moved solely into prompts.

Role verdicts for this slice:

| Reviewer | Slice Verdict | Notes |
|---|---|---|
| Principal Architect | `good` | Domain modeling is strong, but overlapping state machines and package drift prevent an excellent rating. |
| Runtime Reliability Engineer | `mixed` | File-backed states use defaults and safe writes; process-local frustration and many post-turn writes create recovery questions. |
| Memory Systems Reviewer | `good` | Isolated sessions skip global emotion/relationship side effects, matching the privacy model; state ownership still needs clearer contracts. |
| Agent Behavior and Prompt Architect | `good` | PAD, ghost, progression, and stage gates create nuanced behavior in code, not just prompts. |
| Security and Privacy Reviewer | `mixed` | IM bridge no-ghost and isolated side-effect skips are positive; full bridge/API input review still pending. |
| Product Scalability Reviewer | `mixed` | The model is feature-rich, but package drift and side-effect centralization will slow safe feature growth. |

### 2026-06-28: Persona / ID-RAG System Deep Dive

Evidence commands:

```bash
wc -l src/persona/*.ts packages/idrag/src/*.ts src/prompt/*.ts src/character/*.ts | sort -nr | sed -n '1,80p'
find src/persona packages/idrag/src src/prompt src/character -maxdepth 1 -type f -name '*.ts' | sort
for f in src/persona/*.ts; do b=$(basename "$f"); if [ -f "packages/idrag/src/$b" ]; then if cmp -s "$f" "packages/idrag/src/$b"; then printf 'same %s\n' "$b"; else printf 'diff %s\n' "$b"; fi; fi; done | sort
rg -n "soul|persona|graph|retrieveRelevantNodes|graphToPrompt|ensurePersonaGraph|dualMode|directive|layered|lorebook|isolatedMemory|SessionContext" src/persona src/prompt src/core src/character packages/idrag/src tests
diff -u src/persona/graph.ts packages/idrag/src/graph.ts | sed -n '1,220p'
diff -u src/persona/extractor.ts packages/idrag/src/extractor.ts | sed -n '1,260p'
diff -u src/persona/driver.ts packages/idrag/src/driver.ts | sed -n '1,260p'
diff -u src/persona/dual-mode.ts packages/idrag/src/dual-mode.ts | sed -n '1,260p'
diff -u src/persona/generator.ts packages/idrag/src/generator.ts | sed -n '1,260p'
sed -n '1,260p' src/persona/graph.ts
sed -n '1,220p' src/persona/extractor.ts
sed -n '1,620p' src/persona/driver.ts
sed -n '1,260p' src/persona/dual-mode.ts
sed -n '1,130p' src/persona/directive-capture.ts
sed -n '1,100p' src/persona/layered.ts
sed -n '120,245p' src/core/agent-loop.ts
sed -n '600,795p' src/core/agent-loop.ts
sed -n '820,905p' src/core/agent-loop.ts
sed -n '1,80p' src/prompt/templates.ts
sed -n '1,140p' src/mod/mod-manager.ts
sed -n '1,95p' src/core/turn-session.ts
sed -n '750,850p' src/server/index.ts
sed -n '1,260p' tests/unit-layered-persona.ts
sed -n '1,120p' tests/unit-persona-tool-allowlist.ts
sed -n '1,90p' tests/unit-directive-isolation.ts
sed -n '1,80p' tests/unit-begin-dialogs.ts
```

Observed persona / prompt / character file sizes:

```text
8727 total
819 src/persona/graph.ts
819 packages/idrag/src/graph.ts
574 packages/idrag/src/driver.ts
573 src/persona/driver.ts
572 src/prompt/templates.ts
569 src/persona/generator.ts
569 packages/idrag/src/generator.ts
498 src/prompt/context-engine.ts
398 src/prompt/xml-context.ts
366 src/character/memory-stream.ts
312 src/character/life-engine.ts
306 src/prompt/builder-chain.ts
306 src/character/factory.ts
286 src/character/reflection.ts
272 src/prompt/subagent.ts
216 src/persona/dual-mode.ts
216 packages/idrag/src/dual-mode.ts
142 src/persona/extractor.ts
142 packages/idrag/src/extractor.ts
89 src/persona/directive-capture.ts
59 src/persona/layered.ts
50 packages/idrag/src/index.ts
```

Package drift evidence:

```text
diff driver.ts
diff dual-mode.ts
diff extractor.ts
diff generator.ts
diff graph.ts
```

Architecture shape:

- Persona is not only `soul.md`; it is a layered persona stack. The intended base is `soul.md` from the active mod, optimized through ID-RAG, then overlaid with per-user persona deltas, explicit preferences, relationship context, memory/lorebook context, personality driver hints, builder-chain fragments, and dual-mode prompt fragments.
- `src/prompt/templates.ts:1-18` explicitly states the design philosophy: templates should be minimal scaffolding and the mod's `soul.md` is the single source of personality.
- `src/core/agent-loop.ts:122-139` repeats the same architectural claim: `Soul (from mod)` is the personality single source of truth; relationship, user, memory, time, and emotion are dynamic context.
- `src/persona/graph.ts` implements the ID-RAG model: `soul.md` is parsed into nodes/edges, nodes are scored by trigger match, relationship stage relevance, and confidence, then rendered back into a compact prompt fragment.
- `src/persona/extractor.ts` owns graph lifecycle: load persisted graph, extract from the active mod's `soul.md`, persist graph, and detect refresh need by comparing `soul.md` mtime to graph mtime.
- `src/mod/mod-manager.ts` owns active mod switching and `soul.md` working-copy synchronization. It flushes the bank soul to the previous mod, loads the new mod's soul into the bank working copy, and exposes current soul content for prompt assembly.
- `src/core/turn-session.ts` reads active soul content, active mod, persona delta, and per-user preferences into `PromptCtx` every turn.
- `src/core/agent-loop.ts:214-230` registers the `soul` prompt section as the main personality: it calls `buildPersonaFragment(ctx)`, falls back to full `ctx.soulContent`, and then applies persona delta.
- `src/core/agent-loop.ts:765-789` builds the ID-RAG retrieval context. For isolated sessions it removes recent topics, stage progression, and recent bookmarks by using `[]` and `acquaintance`, then retrieves relevant nodes and renders them through `graphToPrompt`.
- `src/persona/layered.ts` provides an immutable kernel, per-user persona override / tone / clinginess / initiative / begin-dialog fragments, and preference rendering.
- `src/persona/directive-capture.ts` detects user in-chat persona instructions and writes them either to global relationship state or per-user preferences depending on isolation.
- `src/persona/driver.ts` is a separate personality-state machine: sociability, initiative, playfulness, thoughtfulness, response verbosity, question frequency, and current activity. It is driven by PAD, response signals, multi-axis relationship, and time since last chat.
- `src/persona/dual-mode.ts` is another behavior mode state machine: base/deep mode with hysteresis for distress and crisis contexts.
- `packages/idrag/src/index.ts` presents ID-RAG as a public package API for graph extraction/retrieval, persona generation, personality driver, and dual-mode.

Positive evidence:

- `src/persona/graph.ts:118-213` extracts a structured `PersonaGraph` from raw `soul.md`, assigning node type, confidence, triggers, stage relevance, and same-section edges.
- `src/persona/graph.ts:225-339` retrieval is budget-aware and relevance-aware: it combines trigger match, stage relevance, and confidence, always includes core traits plus voice/boundary nodes, and caps around an 800-token target.
- `src/persona/graph.ts:350-395` renders retrieved nodes into clear sections: personality core, principles, voice, and beliefs.
- `src/persona/graph.ts:408-463` has a conservative graph evolution API, reinforcing matched nodes slowly and only bumping version on actual changes.
- `src/persona/extractor.ts:46-58` lazily initializes the graph and falls back to an empty default graph when no soul is available.
- `src/persona/extractor.ts:87-103` detects refresh need through `soul.md` and graph modification times.
- `src/core/agent-loop.ts:765-789` catches ID-RAG failure and falls back to full soul content instead of breaking the turn.
- `src/core/agent-loop.ts:773-778` makes ID-RAG retrieval isolation-aware by clearing global context terms for isolated IM sessions.
- `src/persona/layered.ts:4-12` defines a small immutable identity kernel that is independent of replaceable persona content.
- `src/persona/layered.ts:23-52` applies user persona deltas after the base soul, which gives per-user customization without rewriting `soul.md`.
- `src/persona/layered.ts:55-59` renders explicit user preferences separately from base personality.
- `src/persona/directive-capture.ts:48-55` documents the isolation rule for in-chat directives, and `src/persona/directive-capture.ts:67-82` implements per-user fallback for isolated nickname/shared-memory directives.
- `src/core/agent-loop.ts:820-856` keeps lorebook commits, builder-chain prompt fragments, and dual-mode prompt augmentation out of isolated sessions.
- `src/server/index.ts:773-786` refreshes the bank soul and persona graph when the active mod's soul is edited through the API.
- `src/server/index.ts:819-847` lets Persona Studio generate and save a new mod soul, activate it, and update config.

Testing evidence:

- `tests/unit-layered-persona.ts:46-114` covers persona-delta persistence, per-user preference isolation, proactive opt-in/out detection, and WeClaw target isolation.
- `tests/unit-layered-persona.ts:116-152` proves the immutable kernel and explicit preference sections survive `ContextEngine` hard caps as critical sections.
- `tests/unit-layered-persona.ts:154-177` covers directive detection and persistence for nickname, persona override, preference, proactive preference, and false-positive guards.
- `tests/unit-layered-persona.ts:179-185` verifies shared memories render into relationship prompt context.
- `tests/unit-begin-dialogs.ts:16-35` covers begin-dialog rendering and confirms begin dialogs are injected through the persona delta fragment with persona override preserved.
- `tests/unit-persona-tool-allowlist.ts:37-59` verifies per-persona tool allowlists and confirms isolated sessions still expose only `current_time` rather than persona-specific tool permissions.
- `tests/unit-directive-isolation.ts:29-47` verifies isolated nickname/shared-memory directives do not write global relationship state, while global sessions preserve the original behavior.
- `tests/smoke.ts:151-172` covers GET/PUT `/mods/:name/soul` at smoke level and restores the original soul after editing.

Risks:

- The "soul.md is the single source of personality" claim is directionally true, but not literal. `CORE_IDENTITY`, immutable kernel, few-shot examples, personality driver, dual-mode deep prompt, builder-chain fragments, Persona Studio generator templates, and character life-engine all add persona-shaping behavior. These may be valid layers, but the architecture needs clearer vocabulary: `soul.md` is the single source of character archetype, not the only source of behavior.
- `src/core/agent-loop.ts` still owns ID-RAG retrieval and prompt injection. `buildPersonaFragment` calls `ensurePersonaGraph`, builds the retrieval context, calls `retrieveRelevantNodes`, and renders `graphToPrompt` inside core orchestration. This repeats the earlier core hotspot pattern.
- Direct ID-RAG unit tests were not found in this pass. There are strong tests for layered persona and prompt budget behavior, but no obvious test directly proves `extractGraphFromSoul`, `retrieveRelevantNodes`, `graphToPrompt`, refresh detection, or app/package graph parity.
- `src/persona/graph.ts` and `packages/idrag/src/graph.ts` are effectively identical except a comment, but `src/persona/generator.ts` and `packages/idrag/src/generator.ts` have meaningful behavior drift.
- The package generator drift looks internally inconsistent. `packages/idrag/src/types.internal.ts:1-8` declares `gender: 'male' | 'female'`, but `packages/idrag/src/generator.ts:21-29`, `packages/idrag/src/generator.ts:50`, `packages/idrag/src/generator.ts:88`, and `packages/idrag/src/generator.ts:107-112` check `girlfriend` / `boyfriend`. The app generator uses `male` / `female` consistently. This weakens `@mio/idrag` as a reliable package boundary.
- `src/persona/driver.ts:117-139` constructs `personality-state.json` from `getDataDir()` directly rather than using `src/memory/paths.ts`, continuing minor path-boundary drift.
- `src/persona/driver.ts` and `src/persona/dual-mode.ts` are additional state machines adjacent to emotion and relationship. They may be product-correct, but without an ownership matrix they add another layer of behavioral coupling.
- `src/mod/mod-manager.ts:81-92` flushes the bank soul back to the previous mod on switch. This is powerful, but it means the working copy and source mod soul can overwrite each other; it deserves a focused durability/recovery review when studying server/API and admin flows.

Judgment:

Persona / ID-RAG is one of Mio's strongest product-alignment ideas. The architecture recognizes that a companion's identity is not just a long static prompt; it is a retrievable persona graph, a mod-backed `soul.md`, per-user overlays, explicit preferences, and runtime behavior modes. This is a materially stronger design than dumping the full persona text into every turn.

It is still not excellent as an engineering boundary. The ID-RAG algorithm is well-contained in `graph.ts`, but core still owns retrieval wiring, package/app duplication is unresolved, and direct graph retrieval tests appear missing. The package generator mismatch is a concrete drift defect, even if the app path currently uses `src/persona/generator.ts`.

Target boundary if future refactoring is allowed:

- Rename the architectural claim from "`soul.md` is the single personality source" to "`soul.md` is the single character-archetype source"; document other behavior layers as dynamic overlays.
- Extract a persona context provider so core asks for "persona prompt fragment for this turn" instead of directly calling extractor, graph retrieval, and renderer.
- Add direct ID-RAG tests for extraction, stage relevance, trigger matching, always-included voice/boundary nodes, budget behavior, fallback to full soul, and refresh detection.
- Decide app/package ownership for `@mio/idrag`. At minimum, fix the package generator gender mismatch and add parity tests for exported package behavior.
- Move `personality-state.json` and `dual-mode-state.json` paths behind path helpers if these states are durable contracts.
- Document how `soul.md`, persona delta, preferences, relationship context, personality driver, dual-mode, builder-chain, lorebook, and character life-engine are allowed to override each other.

Role verdicts for this slice:

| Reviewer | Slice Verdict | Notes |
|---|---|---|
| Principal Architect | `good` | The persona graph and mod-backed soul design fit the product well; boundaries between core, package, and overlays need tightening. |
| Runtime Reliability Engineer | `mixed` | Fallbacks exist for graph failure, but mod soul working-copy sync and multiple persona state files need recovery review. |
| Memory Systems Reviewer | `good` | Persona overlays and preferences are isolated per user; ID-RAG uses memory-derived context carefully under isolation. |
| Agent Behavior and Prompt Architect | `good` | Strong layered persona design with kernel, soul, deltas, preferences, ID-RAG, and dual-mode; source-of-truth language is too broad. |
| Security and Privacy Reviewer | `mixed` | Directive and tool isolation tests are positive; soul edit/generation API review still pending. |
| Product Scalability Reviewer | `mixed` | Persona Studio and packages suggest extensibility, but package drift and core-owned retrieval will slow safe growth. |

### 2026-06-28: Provider / Tool / Plugin System Deep Dive

Evidence commands:

```bash
wc -l src/providers/*.ts src/tools/*.ts src/plugins/*.ts src/plugins/builtins/*.ts src/core/inference-loop.ts src/core/tool-runtime.ts | sort -nr | sed -n '1,100p'
find src/providers src/tools src/plugins src/plugins/builtins -maxdepth 1 -type f -name '*.ts' | sort
rg -n "interface AIProvider|stream|tool|ToolCall|FallbackChainProvider|selectProvider|MIO_PROVIDER|modelRouter|router|pluginRegistry|invokeHook|scopedToolRegistry|isolatedMemory|call\\.input|result\\.output" src/providers src/tools src/plugins src/core tests src/server
nl -ba src/types.ts | sed -n '110,145p'
nl -ba src/providers/index.ts | sed -n '1,230p'
nl -ba src/providers/fallback.ts | sed -n '1,360p'
nl -ba src/providers/router.ts | sed -n '1,260p'
nl -ba src/providers/http.ts | sed -n '1,230p'
nl -ba src/providers/openai-compatible.ts | sed -n '1,620p'
nl -ba src/providers/anthropic.ts | sed -n '1,460p'
nl -ba src/core/inference-loop.ts | sed -n '1,170p'
nl -ba src/core/tool-runtime.ts | sed -n '1,150p'
nl -ba src/tools/registry.ts | sed -n '1,120p'
nl -ba src/tools/file.ts | sed -n '1,300p'
nl -ba src/plugins/types.ts | sed -n '1,150p'
nl -ba src/plugins/registry.ts | sed -n '1,390p'
nl -ba src/plugins/index.ts | sed -n '1,90p'
nl -ba src/plugins/builtins/*.ts
nl -ba tests/golden-turn.ts | sed -n '130,215p'
nl -ba tests/unit-inference-guardrails.ts | sed -n '1,110p'
nl -ba tests/unit-im-session-isolation.ts | sed -n '100,150p'
nl -ba tests/unit-persona-tool-allowlist.ts | sed -n '35,75p'
nl -ba tests/unit-http.ts | sed -n '80,250p'
nl -ba tests/unit-openai-compat.ts | sed -n '1,220p'
nl -ba tests/openai-http-compat.ts | sed -n '120,230p'
```

Observed provider / tool / plugin file sizes:

```text
4397 total
583 src/providers/openai-compatible.ts
434 src/providers/anthropic.ts
365 src/plugins/registry.ts
338 src/providers/fallback.ts
316 src/providers/lora-adapter.ts
250 src/tools/file.ts
242 src/tools/session.ts
233 src/providers/router.ts
190 src/providers/http.ts
189 src/tools/work.ts
169 src/providers/index.ts
125 src/core/inference-loop.ts
124 src/tools/cron.ts
108 src/core/tool-runtime.ts
106 src/plugins/types.ts
98 src/tools/emotion.ts
83 src/providers/mock.ts
73 src/tools/registry.ts
67 src/tools/recall.ts
58 src/tools/knowledge.ts
54 src/plugins/builtins/pad-plugin.ts
46 src/plugins/builtins/ghost-plugin.ts
41 src/plugins/builtins/affinity-plugin.ts
40 src/plugins/builtins/index.ts
36 src/plugins/builtins/frustration-plugin.ts
29 src/plugins/index.ts
```

Architecture shape:

- Provider boundary is explicit. `src/types.ts:117-135` defines `AIProvider` and `StreamingProvider`; both use Mio-native `Message`, `ToolDef`, and `ToolCall`, with streaming adding `onToken` and optional `onToolCall`.
- Provider selection is centralized in `src/providers/index.ts`. It maps Anthropic to a native adapter, OpenAI-compatible vendors to one generic adapter, LoRA to a dedicated adapter, and missing keys to `MockProvider`.
- `src/providers/http.ts` is a shared reliability primitive under provider adapters: timeout, retry, backoff, retryable-status handling, body cancellation before retry, and caller abort propagation.
- `src/providers/openai-compatible.ts` is the broadest adapter. It maps Mio messages, tool calls, tool results, text/image content blocks, tool definitions, non-streaming tool calls, OpenAI-format SSE chunks, streamed tool-call deltas, and reasoning-model `<think>` filtering.
- `src/providers/anthropic.ts` is a separate native adapter. It maps Mio messages to Anthropic content blocks, sends system prompt separately, maps tools to `input_schema`, and parses `content_block_*` streaming events into tokens and tool calls.
- `src/core/inference-loop.ts` is now a clean tool-loop runner rather than mixed turn orchestration. It calls the provider, appends assistant messages, executes tools, appends tool results, detects repeated tool streaks, and forces a final tool-free summary after `MAX_LOOP_TURNS`.
- Tool registration is global but execution is scoped. `src/core/tool-runtime.ts:30-77` wraps the global registry for isolated sessions and persona allowlists. Isolated IM sessions expose only `current_time`; persona allowlists restrict visible and executable tools for normal sessions.
- Plugin architecture has three layers: SDK types in `src/plugins/types.ts`, runtime registry in `src/plugins/registry.ts`, and harness calls from core/server integration points. Built-in plugins are loaded once per process through `src/core/tool-runtime.ts:82-89`.

Positive evidence:

- `src/types.ts:117-135` keeps provider contracts small and stable. The provider interface does not leak vendor-specific request/response types into core.
- `src/providers/http.ts:98-190` bounds every provider HTTP request and retries only network errors, timeouts, 429, and 5xx. `src/providers/http.ts:138-140` preserves caller cancellation as non-retryable, and `src/providers/http.ts:165-169` cancels response bodies before retrying.
- `src/providers/openai-compatible.ts:115-122` strips unsupported image modality for text-only providers rather than failing the whole turn.
- `src/providers/openai-compatible.ts:186-255` maps Mio messages and tool results to OpenAI wire format; `src/providers/openai-compatible.ts:320-351` parses non-streaming tool calls; `src/providers/openai-compatible.ts:386-517` accumulates streaming tool calls and filters reasoning blocks.
- `src/providers/anthropic.ts:102-175` maps tool calls and tool results into Anthropic content blocks; `src/providers/anthropic.ts:245-373` parses streaming text and tool-use blocks.
- `src/core/inference-loop.ts:11-15` defines explicit loop limits; `src/core/inference-loop.ts:23-29` detects repeated tool streaks; `src/core/inference-loop.ts:108-124` forces a final tool-free response after the max loop count.
- `src/tools/registry.ts:42-54` enforces the canonical `call.input` to handler and `result.output` return shape, and converts handler failures into tool error results instead of throwing through the inference loop.
- `src/tools/file.ts:11-26` restricts file paths to `getDataDir()` and `process.cwd()`. `src/tools/file.ts:175-217` rejects shell composition, redirection, interpolation, path traversal, absolute paths outside allowed dirs, unsafe git subcommands, and `find -exec/-delete`.
- `src/core/tool-runtime.ts:34-53` prevents isolated IM sessions from seeing or executing tools beyond `current_time`, even if a hidden model call attempts a forbidden tool name.
- `src/core/tool-runtime.ts:56-77` implements persona-level tool allowlists without changing the global tool registry.
- `src/plugins/registry.ts:104-193` validates manifests, duplicate registration, dependencies, conflicts, capability implementation, and rolls back if `onLoad` fails.
- `src/plugins/registry.ts:271-288` catches per-plugin hook failures, so one failing plugin does not prevent later plugins from running.
- `src/plugins/registry.ts:296-317` collects prompt fragments defensively, and `src/core/agent-loop.ts:491-496` deduplicates plugin prompt fragments against directly registered emotion sections.

Testing evidence:

- `tests/golden-turn.ts:159-208` verifies the turn executes one tool call, passes `call.input` into the registry, appends tool output, and returns a final provider reply that sees the tool result.
- `tests/unit-inference-guardrails.ts:17-23` verifies repeated-tool streak detection. `tests/unit-inference-guardrails.ts:25-46` verifies a provider that never stops calling tools is forced into a final tool-free summary.
- `tests/unit-im-session-isolation.ts:134-140` verifies isolated sessions expose only `current_time`, hide file/memory/session tools, deny hidden forbidden tool calls, and do not leak global memory content.
- `tests/unit-persona-tool-allowlist.ts:37-59` verifies no allowlist means all tools, allowlist means only whitelisted tools, non-whitelisted execution is rejected, and isolated sessions still override persona allowlists with `current_time` only.
- `tests/unit-http.ts:87-240` covers timeout aborts, 503 retry success, persistent 500 retry cap, non-429 4xx no-retry, network retry success, 429 retry, env retry override, and caller abort without retry.
- `tests/unit-openai-compat.ts:48-199` covers OpenAI bridge text extraction, session id precedence/sanitization, strict session mode, OpenAI error envelope, and bearer auth behavior. This is server bridge evidence rather than provider-adapter evidence, but it proves important compatibility contracts at the HTTP boundary.
- `tests/openai-http-compat.ts:122-230` covers `/v1/chat/completions` accepting common OpenAI SDK fields, returning normal chat completion shape, streaming parseable SSE chunks plus `[DONE]`, and returning OpenAI-compatible invalid-request errors.

Risks:

- `src/providers/index.ts:82-89` has a documentation/code mismatch: the comment says fallback is true by default, but `enableFallback` defaults to `false`. This is not a runtime crash, but it can create false operator confidence about automatic recovery.
- `FallbackChainProvider` is useful but not obviously enabled in the main path. `src/providers/index.ts:97-101` only wraps with fallback when explicitly requested.
- `src/providers/fallback.ts:277-329` retries streaming calls after recoverable errors, but it passes the original `onToken` callback into each attempt. If a provider fails after emitting user-visible tokens, a fallback provider can emit a second answer fragment into the same stream. This needs either buffering-until-success or explicit "no fallback after first token" semantics.
- `src/providers/fallback.ts:104-129` passes the primary model string to every fallback provider. That can be invalid across providers unless the explicit model is compatible with all fallback vendors.
- `src/providers/router.ts:186-229` routes by model string and creates providers via `selectProvider('auto', taskModel)`. That means the model is chosen independently from a guaranteed provider/vendor match. A task model such as an Anthropic/DeepSeek/OpenAI-specific name may be sent to whichever provider `auto` resolves first.
- `src/memory/rerank.ts:142-150` and `src/memory/structured-memory.ts:544-551` use model routing for classify/summarize tasks. This proves the router has real behavioral impact once enabled, so model-provider mismatch is not theoretical.
- `src/tools/file.ts:54-99` exposes write/edit tools globally for non-isolated, non-allowlisted sessions. Path safety helps, but the default tool surface still gives the model mutation capability inside the working directory and data directory.
- `src/tools/file.ts:227-232` uses `execSync` for the restricted bash tool. The command allowlist is narrow, but a synchronous shell still blocks the Node process for up to 30 seconds per call.
- `src/plugins/index.ts:12-15` explicitly says direct calls still work if plugins are not loaded. Built-in plugin files confirm this: `src/plugins/builtins/pad-plugin.ts:37-43`, `src/plugins/builtins/affinity-plugin.ts:26-34`, and `src/plugins/builtins/frustration-plugin.ts:24-29` are mostly wrappers or no-ops because real updates still happen in core/emotion paths.
- No direct plugin registry test was found with `rg "PluginRegistry|pluginRegistry|plugin" tests src`. The registry design is good, but lifecycle validation, rollback, conflicts, hook ordering, and prompt-fragment behavior are not yet protected by a dedicated test.

Judgment:

The provider and tool architecture is better than prototype quality. The core provider contract is small, adapters absorb vendor differences, HTTP calls have serious retry/timeout behavior, tool I/O has a single canonical shape, and tool execution is scoped for isolated IM sessions and persona allowlists. The inference loop is also a real strength: it has bounded tool iteration and graceful forced summary behavior.

The plugin architecture is less mature than the provider/tool architecture. The registry is well-designed as infrastructure, but the built-in plugins are mostly compatibility wrappers while the real behavior still lives in direct core/emotion calls. That means Mio has a plugin harness, not yet a fully plugin-owned behavior system.

This slice supports raising runtime reliability confidence, but it does not make the whole architecture excellent. The remaining concerns are fallback activation ambiguity, streaming fallback partial-output semantics, model-provider mismatch under routing/fallback, broad default file mutation tools, and missing direct plugin tests.

Target boundary if future refactoring is allowed:

- Fix the `selectProvider` fallback default documentation or add an explicit config flag such as `MIO_FEATURE_PROVIDER_FALLBACK` so operators know whether fallback is enabled.
- Add streaming fallback semantics: either buffer tokens until provider success, or disable fallback after first token and surface the original streaming error.
- Make router configuration provider-aware, for example `{ task: { provider, model } }`, rather than routing by model string through `auto`.
- Add unit tests for `FallbackChainProvider`, `routeTask`, and `PluginRegistry` lifecycle/conflict/rollback/prompt-fragment behavior.
- Consider making write/edit/bash unavailable by default unless a local trusted mode or persona allowlist enables them. Keep isolated-session restrictions as they are.
- Decide whether built-in plugins should eventually own PAD/affinity/frustration updates. If not, rename them as extension hooks or prompt-fragment wrappers to avoid overstating the plugin architecture.

Role verdicts for this slice:

| Reviewer | Slice Verdict | Notes |
|---|---|---|
| Principal Architect | `good` | Provider and tool boundaries are clean; plugin system is structurally clean but not yet the behavior source of truth. |
| Runtime Reliability Engineer | `good` | HTTP timeout/retry and tool-loop guardrails are strong; streaming fallback and model-provider mismatch need explicit handling. |
| Memory Systems Reviewer | `good` | Tool isolation protects global memory in IM sessions; router use in memory extraction/rerank means provider routing must stay predictable. |
| Agent Behavior and Prompt Architect | `good` | Tool calls and plugin prompt fragments are integrated deliberately; built-in behavioral plugins are still wrappers around direct calls. |
| Security and Privacy Reviewer | `mixed` | IM tool isolation is strong; default write/edit/bash tools remain a trusted-local risk for normal sessions. |
| Product Scalability Reviewer | `mixed` | Adding providers is straightforward; adding plugin-owned behavior still requires edits in core/emotion paths. |

### 2026-06-28: Server / API / Bridge System Deep Dive

Evidence commands:

```bash
wc -l src/server/*.ts src/index.ts tests/*.ts tests/e2e/*.ts | sort -nr | sed -n '1,100p'
rg -n "app\\.|router|express|ws|WebSocket|auth|rate|cors|upload|body|json\\(|/chat|/chat/stream|/v1/chat/completions|/mods|/admin|/notify|/analytics|/onboarding|serve|listen|MIO_HTTP_PORT|MIO_AUTH_TOKEN" src/server src/index.ts tests
nl -ba src/server/index.ts | sed -n '1,360p'
nl -ba src/server/index.ts | sed -n '360,760p'
nl -ba src/server/index.ts | sed -n '760,1160p'
nl -ba src/server/index.ts | sed -n '1160,1420p'
nl -ba src/server/auth.ts | sed -n '1,240p'
nl -ba src/server/rate-limit.ts | sed -n '1,180p'
nl -ba src/server/openai-compat.ts | sed -n '1,560p'
nl -ba src/validation.ts | sed -n '1,340p'
nl -ba src/server/notify.ts | sed -n '1,620p'
nl -ba src/utils/backup.ts | sed -n '1,520p'
nl -ba src/server/onebot.ts | sed -n '1,540p'
nl -ba src/server/search.ts | sed -n '1,130p'
nl -ba src/server/memories.ts | sed -n '1,240p'
nl -ba tests/openai-http-compat.ts | sed -n '1,280p'
nl -ba tests/smoke.ts | sed -n '1,780p'
nl -ba tests/e2e/mio-e2e.spec.ts | sed -n '1,520p'
nl -ba tests/unit-onebot.ts | sed -n '110,230p;360,435p'
nl -ba tests/unit-weclaw-notify-isolation.ts | sed -n '1,140p'
```

Observed server / API file sizes:

```text
12018 total
1359 src/server/index.ts
764 tests/smoke.ts
685 tests/unit.ts
572 src/server/notify.ts
492 src/server/onebot.ts
488 tests/e2e/mio-e2e.spec.ts
469 src/server/openai-compat.ts
454 tests/unit-onebot.ts
453 src/index.ts
393 src/server/analytics.ts
281 tests/openai-http-compat.ts
273 tests/golden-turn.ts
262 tests/unit-http.ts
207 src/server/memories.ts
205 src/server/im-pacing.ts
199 src/server/auth.ts
148 src/server/rate-limit.ts
148 src/server/avatar.ts
95 src/server/search.ts
```

Architecture shape:

- `src/server/index.ts` is the public HTTP/WS composition root. It wires Express, static web files, CORS, JSON body limits, rate limiting, onboarding, health/status/avatar/voice, uploads, OpenAI-compatible routes, OneBot routes, native chat and SSE chat, mod/soul/persona routes, admin backup/export, analytics, memory review, proactive preferences, search, notification tests, character management, WebSocket upgrade, and lifecycle logging.
- `src/server/auth.ts` is a standalone auth middleware. It resolves `MIO_AUTH_TOKEN` or config token, performs constant-time comparison, exposes native JSON auth errors, OpenAI-compatible auth errors, and query-token WebSocket auth.
- `src/server/rate-limit.ts` is a standalone in-memory sliding-window limiter, applied after static assets and before most API routes.
- `src/validation.ts` is a real request schema boundary for chat, OpenAI bridge, OneBot, voice/upload, mods, persona generation, onboarding, memory review, proactive preferences, backup prune, search, analytics, persona mode, character names, and WebSocket client messages.
- `src/server/openai-compat.ts` is a protocol adapter, not a provider adapter. It maps OpenAI-style request/session/channel conventions onto Mio `runTurn`, returns OpenAI-compatible response/error/SSE envelopes, normalizes external session ids, and preserves raw WeClaw contact ids for outbound binding.
- `src/server/onebot.ts` is a second bridge adapter. It extracts OneBot v11 messages, filters group/self/allowlist cases, builds stable session ids, dispatches quick-operation or outbound API replies, supports pacing, and optionally formats outbound image/text segments.
- `src/server/notify.ts` is an outbound integration layer for Telegram, webhook, WhatsApp, Discord, Slack, and WeClaw. It treats channel failure independently and exposes sanitized status config.
- `src/utils/backup.ts` is used by admin routes for data backup/export/prune, but it lives under utils and implements its own path logic rather than going through `memory/paths.ts`.

Positive evidence:

- `src/server/index.ts:304-323` builds the Express server with CORS, `express.json({ limit: '8mb' })`, static web serving, and rate limiting after static files.
- `src/server/index.ts:1147-1148` defaults the server host to `127.0.0.1`, matching the local-first product assumption unless `MIO_HTTP_HOST` or CLI `--host` overrides it.
- `src/server/index.ts:171-203` implements allowlisted CORS via `MIO_CORS_ORIGIN`, exposes `X-Mio-Session-Id`, and allows the bridge headers required by OpenAI/IM clients.
- `src/server/auth.ts:117-147` centralizes bearer auth checks and uses constant-time comparison. `src/server/auth.ts:101-115` gives OpenAI-compatible auth errors for `/v1/*`.
- `src/server/rate-limit.ts:79-119` applies a per-IP sliding-window limiter with configurable max/window and skips only `GET /health`.
- `src/validation.ts:12-19` bounds native chat text/session/path fields; `src/validation.ts:40-48` bounds OpenAI messages, message count, max tokens, and model fields while allowing SDK passthrough fields; `src/validation.ts:222-241` validates WebSocket client messages.
- `src/server/index.ts:238-260` validates uploaded image MIME by magic bytes and enforces 4.5 MB decoded size; `src/server/index.ts:262-280` enforces known audio MIME types and 15 MB decoded size.
- `src/server/index.ts:282-291` checks image/audio paths remain under upload directories before `/chat` processes them.
- `src/server/openai-compat.ts:111-125` extracts the last non-empty user message and rejects empty or over-8000-character inputs.
- `src/server/openai-compat.ts:131-147` supports explicit session hints and strict session mode. `src/server/openai-compat.ts:373-385` normalizes session ids by stripping unsafe characters, hashing the raw id, prefixing with `openai-`, and capping at 64 characters.
- `src/server/openai-compat.ts:149-205` maps channel metadata and headers into `TurnChannelContext`, preserving group/private hints and pacing signals.
- `src/server/index.ts:541-616` preserves OpenAI-compatible route shape for validation, auth, session headers, streaming SSE, non-streaming completion, and IM pacing.
- `src/server/onebot.ts:93-146` filters unsupported post types, missing ids, self messages, allowlists, group mention policy, and empty text before calling `runTurn`.
- `src/server/onebot.ts:360-377` builds OneBot session ids from sanitized/hash-truncated user/group ids.
- `src/server/onebot.ts:395-433` sends outbound OneBot messages with timeout and optional bearer token, and surfaces API failures clearly.
- `src/server/notify.ts:388-427` attempts enabled notification channels independently so one failed channel does not block all channels.
- `src/server/notify.ts:460-540` reports configured notification channels without exposing tokens or full webhook URLs.
- `src/index.ts:416-434` starts life, nightly, and proactive schedulers only in `serve` mode, then starts the HTTP server. This keeps CLI chat/status paths from implicitly arming background jobs.

Testing evidence:

- `tests/smoke.ts:101-122` starts the real server and checks `/health` and `/status`.
- `tests/smoke.ts:124-149` checks `/mod` valid and invalid switches; `tests/smoke.ts:151-175` checks GET/PUT `/mods/:name/soul` and restores the original soul.
- `tests/smoke.ts:177-238` checks `/chat`, image upload plus image chat path, and `/chat/stream` SSE token/done events.
- `tests/smoke.ts:240-306` checks OpenAI model list, non-streaming completion, and OpenAI streaming chunks plus `[DONE]`.
- `tests/smoke.ts:308-442` checks OneBot status, private outbound API reply, group skip behavior, and group-all low-necessity silence.
- `tests/smoke.ts:530-628` checks WebSocket invalid-payload rejection, hello, token, done, avatar subscription, emotion_changed, mod switch, and ping/pong.
- `tests/smoke.ts:633-745` checks OpenAI auth errors, valid API key, OpenAI validation envelope, authenticated gateway session preservation, and authenticated streaming metadata session.
- `tests/openai-http-compat.ts:92-120` checks CORS preflight and OpenAI auth envelopes. `tests/openai-http-compat.ts:122-215` checks common SDK fields and stream shape. `tests/openai-http-compat.ts:217-260` checks invalid-request envelope and stable concurrent session isolation.
- `tests/e2e/mio-e2e.spec.ts:134-180` checks `/chat` and `/chat/stream`; `tests/e2e/mio-e2e.spec.ts:184-260` checks OpenAI non-streaming, streaming, and validation; `tests/e2e/mio-e2e.spec.ts:330-367` checks WS hello/chat/done/switch/ping; `tests/e2e/mio-e2e.spec.ts:467-488` checks rate limiting and health bypass.
- `tests/unit-onebot.ts:124-161` checks OneBot conservative defaults and allowlist status without exposing ids. `tests/unit-onebot.ts:199-222` checks private extraction and group mention gating. `tests/unit-onebot.ts:387-435` checks API-mode failure without base URL and outbound API send with access token.
- `tests/unit-weclaw-notify-isolation.ts:53-111` checks per-user WeClaw proactive dispatch does not leak into global channels, writes contact transcript, skips global bookmarks, omits global shared memories from prompt, and does not fall back to global WeClaw delivery after opt-out.
- `tests/unit.ts:365-383` checks validation rejects path-like persona names, traversal-like character names, invalid search roles, and empty WebSocket chat text.

Risks:

- `src/server/index.ts` is the largest source file and is no longer "thin" despite the header comment at `src/server/index.ts:13-14`. It owns route registration, protocol glue, upload parsing, path checks, OpenAI bridge handling, OneBot bridge handling, mod/soul writes, Persona Studio, admin, analytics, memory review, notifications, character routes, WebSocket protocol, heartbeat, and logging. This is now the biggest architectural hotspot.
- Auth is optional by design. `src/server/auth.ts:117-119` returns success when no token is configured. That fits localhost-first use, but if `MIO_HTTP_HOST=0.0.0.0` is used without `MIO_AUTH_TOKEN`, sensitive routes become network-reachable.
- Some read routes are public even when auth exists. `src/server/index.ts:397-435` exposes `/status` including provider/model/config/emotion/relationship/progress; `src/server/index.ts:919-921` exposes `/admin/log-level`; `/avatar/state` and `/voice/capabilities` are public. The auth comments mention public reads, but the risk should be explicit.
- Onboarding routes are intentionally unauthenticated at `src/server/index.ts:325-389`. Because onboarding writes config-like state through `applyValue`, this is acceptable only under local boot assumptions. It needs a documented setup-mode boundary if the server is bound beyond localhost.
- `/chat/stream` and OpenAI streaming do not propagate client disconnect into `runTurn`. `src/server/index.ts:728-735` and `src/server/index.ts:581-590` keep running the turn even if the client closes, because no abort signal is passed through core/provider.
- WebSocket chat similarly does not cancel a running `runTurn` on socket close. `safeSend` prevents send crashes, but the model/tool turn may continue in the background.
- Native `/chat/stream` does not enforce the manual 10,000-character check found in `/chat`, but both rely on `validate(chatBody)` and `chatBody` caps text at 8,000. The duplicate manual check in `/chat` is inconsistent and can confuse future maintainers.
- `src/server/notify.ts` uses direct `fetch` calls without the shared `fetchWithRetry`/timeout wrapper. OneBot has `AbortSignal.timeout`, but Telegram/webhook/WhatsApp/Discord/Slack/WeClaw notification calls can hang depending on runtime defaults.
- `src/utils/backup.ts` hand-builds tar headers and reads every file synchronously into memory. `src/utils/backup.ts:36-38` says it is simple and for small data dirs, which is honest, but long paths are truncated at `src/utils/backup.ts:193-195`, and this is not a robust backup format for larger or nested datasets.
- `src/utils/backup.ts` constructs memory paths directly with `join(getDataDir(), ...)` rather than `src/memory/paths.ts`, continuing path-boundary drift.
- Native route auth behavior under `MIO_AUTH_TOKEN` is not as directly tested as OpenAI route auth. Smoke/e2e mostly exercise native routes with auth disabled; strict bearer tests focus on `/v1/*`.
- `src/server/search.ts:58-65` delegates to hybrid search and searches global memory unless a role filter disables it. Because `/search` is a native authenticated route this is probably acceptable, but if auth is disabled it exposes broad private memory over HTTP.

Judgment:

The server layer is operationally useful and well-tested for a local-first app. It exposes the real product surface, has runtime validation, local binding by default, rate limiting, upload checks, OpenAI compatibility, OneBot integration, WebSocket events, and broad smoke/E2E coverage. The bridge work is especially pragmatic: OpenAI and OneBot adapters preserve external client conventions while still routing through Mio's core turn pipeline and session model.

The architecture is not excellent because `src/server/index.ts` has become a route and protocol monolith. It is now the main maintainability hotspot, overtaking `agent-loop.ts`. Security posture is acceptable for a localhost personal agent, but should not be described as internet-hardened. The biggest reliability gap is missing cancellation propagation for streaming HTTP and WS clients; the biggest maintainability gap is route-family concentration.

Target boundary if future refactoring is allowed:

- Split `src/server/index.ts` into route modules: `routes/core-chat`, `routes/openai`, `routes/onebot`, `routes/uploads`, `routes/mods-persona`, `routes/admin`, `routes/analytics`, `routes/memories`, `routes/notify`, `routes/characters`, and `ws/server`.
- Add a small `ServerSecurityPolicy` document or config summary that states: localhost by default, auth optional, public read endpoints, onboarding unauthenticated, and `0.0.0.0` requires a token.
- Pass `AbortSignal` or cancellation context from `/chat/stream`, `/v1/chat/completions` streaming, and WS close into `runTurn` and provider HTTP calls.
- Move upload parsing and path checks into `server/uploads.ts` or `media/uploads.ts` with direct tests for invalid base64, MIME mismatch, oversize, and path rejection.
- Wrap notification outbound `fetch` calls with timeout/retry or at least `AbortSignal.timeout`.
- Replace hand-built backup tar logic with a proven tar library or clearly rename it as a best-effort local export snapshot. Add tests for nested/long paths if it remains.
- Add native-auth tests for `/chat`, `/admin/export`, `/mods/:name/soul`, `/notify/test`, and WS `?token=` under `MIO_AUTH_TOKEN`.

Role verdicts for this slice:

| Reviewer | Slice Verdict | Notes |
|---|---|---|
| Principal Architect | `mixed` | Route families are conceptually clear, but `server/index.ts` concentrates too many protocols and domains. |
| Runtime Reliability Engineer | `mixed` | Rate limiting, validation, bridge tests, and OneBot timeout are positive; streaming/WS cancellation and notification timeouts are missing. |
| Memory Systems Reviewer | `mixed` | Search, admin export, memory review, and bridge session isolation exist, but unauthenticated local reads can expose memory if host/auth are misconfigured. |
| Agent Behavior and Prompt Architect | `good` | Bridges route through `runTurn`, preserving behavior consistency across web, OpenAI, OneBot, and WS surfaces. |
| Security and Privacy Reviewer | `mixed` | Localhost default, auth middleware, validation, and upload checks are good; optional auth plus public status/onboarding/admin-log reads need explicit deployment guidance. |
| Product Scalability Reviewer | `mixed` | The API surface is rich and tested, but adding routes or protocols will keep growing the server monolith unless split. |

### 2026-06-28: Frontend Architecture Deep Dive

Evidence commands:

```bash
find web -maxdepth 3 -type f -not -path '*/node_modules/*' -not -path '*/dist/*' | sort
find web/js web/css tests/web tests/e2e -type f \( -name '*.js' -o -name '*.css' -o -name '*.mjs' -o -name '*.ts' \) -not -path '*/node_modules/*' -not -path '*/dist/*' -print0 | xargs -0 wc -l | sort -nr | sed -n '1,140p'
rg -n "innerHTML|localStorage|authToken|Store\\.persist|/status|/chat|/uploads|/voice|/persona|/character|/mod|WebSocket|EventSource|serviceWorker|console\\.log" web/js web/index.html web/sw.js web/vite.config.js tests/web tests/e2e
nl -ba web/index.html | sed -n '1,90p'
nl -ba web/package.json | sed -n '1,120p'
nl -ba web/vite.config.js | sed -n '1,180p'
nl -ba web/sw.js | sed -n '1,150p'
nl -ba web/js/api.js | sed -n '1,140p'
nl -ba web/js/ws.js | sed -n '1,260p'
nl -ba web/js/store.js | sed -n '1,130p'
nl -ba web/js/auth.js | sed -n '1,90p'
nl -ba web/js/app.js | sed -n '1,230p'
nl -ba web/js/views/BaseView.js | sed -n '1,130p'
nl -ba web/js/utils/dom.js | sed -n '1,110p'
nl -ba web/js/views/chat.js | sed -n '1,660p'
nl -ba web/js/views/studio.js | sed -n '1,760p'
nl -ba web/js/views/settings.js | sed -n '1,460p'
nl -ba web/js/views/memories.js | sed -n '1,340p'
nl -ba web/js/views/analytics.js | sed -n '1,300p'
nl -ba web/js/liveness.js | sed -n '1,120p'
nl -ba tests/web/liveness.test.mjs | sed -n '1,90p'
nl -ba tests/web/memories.test.mjs | sed -n '1,90p'
nl -ba tests/web/mascot.test.mjs | sed -n '1,60p'
nl -ba tests/e2e/mio-e2e.spec.ts | sed -n '1,120p;370,430p'
```

Observed frontend file sizes:

```text
9513 total
754 web/js/views/studio.js
666 web/css/chat.css
645 web/css/studio.css
629 web/js/views/chat.js
488 tests/e2e/mio-e2e.spec.ts
416 web/js/views/settings.js
308 web/js/views/memories.js
307 web/css/views/chat.css
301 web/js/views/onboarding.js
278 web/css/analytics.css
276 web/js/views/messages.js
274 web/js/views/mood.js
271 web/css/views/memories.css
264 web/js/views/analytics.js
243 web/css/settings.css
240 web/css/onboarding.css
232 web/css/layout.css
219 web/css/views/mood.css
214 web/js/ws.js
189 web/js/app.js
186 web/js/components/bubble.js
182 web/css/auth.css
140 web/js/views/gender.js
132 web/js/views/auth.js
132 web/css/views/messages.css
128 web/css/utilities.css
116 web/css/reset.css
101 web/js/api.js
97 web/js/views/BaseView.js
94 web/js/store.js
91 web/js/utils/icons.js
85 web/js/liveness.js
72 web/js/utils/dom.js
70 web/js/utils/constants.js
61 web/js/router.js
60 tests/e2e/playwright.global-setup.ts
59 web/js/utils/easing.js
52 web/js/utils/time.js
51 tests/e2e/playwright.config.ts
49 tests/web/memories.test.mjs
49 tests/web/liveness.test.mjs
47 web/js/auth.js
40 web/js/components/tab-bar.js
40 web/css/base.css
32 web/css/components.css
24 web/js/utils/haptics.js
24 web/css/tokens.css
22 web/js/mascot.js
14 tests/web/mascot.test.mjs
```

Architecture shape:

- The frontend is still a zero-UI-framework ES module application, but not literally dependency-free anymore. `web/package.json:10-23` defines Vite `dev/build/preview`, `vite` as a dev dependency, and `dotenv` as a dependency.
- `web/index.html:14-27` manually links the CSS bundle list and `web/index.html:34` loads `/js/app.js` as the module entrypoint.
- `web/js/app.js:41-46` defines the primary navigation model. `web/js/app.js:122-132` maps routes to view modules. `web/js/app.js:134-148` unmounts the current view, clears the main element, renders the next view, mounts it, and updates the store route.
- `web/js/router.js:10-60` implements a small hash router with parameter support and `/chat` fallback.
- `web/js/store.js:25-49` is a simple global state tree; `web/js/store.js:74-83` provides key-based pub/sub; `web/js/store.js:92-94` auto-persists `authToken` and `sessionId`.
- `web/js/api.js:21-62` is the HTTP boundary: base URL from Store, bearer auth header, JSON handling, 30 second timeout, and normalized errors.
- `web/js/ws.js:11-207` is the realtime boundary: reconnect delays, heartbeat, message routing, WS chat, SSE fallback, and HTTP fallback.
- `web/js/views/BaseView.js:38-60` gives views a lifecycle cleanup primitive for DOM listeners, Store subscriptions, intervals, RAFs, and DOM removal.
- `web/js/utils/dom.js:15-49` is the main safe DOM construction helper. It prefers `textContent`, event listeners, styles, datasets, and attribute setting rather than string HTML.
- The product surface is view-driven: chat, messages, memories, mood, studio, analytics, settings, onboarding, auth, plus small shared utilities and components.
- Static visual assets now exist in `web/assets/mascot/*.png`, and `web/js/mascot.js:5-21` maps PAD-derived expression names to those assets.

Positive evidence:

- `web/js/app.js:165-187` has a clear boot sequence: auth check, shell construction, WebSocket connect, onboarding status check, then router initialization.
- `web/js/views/BaseView.js:38-60` prevents many common leak patterns by centralizing teardown.
- `web/js/utils/dom.js:21-24` uses `textContent` for text and attaches event handlers directly. The `rg` scan found many `innerHTML = ''` clear operations, but no `insertAdjacentHTML`, `outerHTML`, `eval`, `new Function`, or `DOMParser` usage in `web/js`.
- `web/js/api.js:32-61` uses `AbortController` for per-request timeout, and `web/js/api.js:44-58` gives callers consistent error shapes.
- `web/js/ws.js:167-207` gives chat a pragmatic degradation chain: WS first, then SSE, then HTTP POST.
- `web/js/views/chat.js:180-187`, `web/js/views/memories.js:170-175`, `web/js/views/analytics.js:178-183`, and `web/js/views/studio.js:303-309` render user- or server-derived text through `textContent`, which is the right default XSS posture.
- `web/js/views/chat.js:466-490` performs client-side image type and size checks before uploading to `/uploads/images`, matching the server-side upload hardening direction.
- `web/js/views/chat.js:261-268` cleans up speech recognition and audio playback on unmount.
- `web/js/views/analytics.js:72-87` uses `Promise.allSettled`, and `web/js/views/analytics.js:79-80` guards against rendering into an unmounted container after async calls.
- `web/js/views/memories.js:35-55` exports pure review helpers, and `web/js/liveness.js:45-84` exports pure relationship/mood view-model functions.
- `tests/web/liveness.test.mjs:6-48`, `tests/web/memories.test.mjs:20-48`, and `tests/web/mascot.test.mjs:4-13` directly cover the extracted frontend pure functions.
- `tests/e2e/mio-e2e.spec.ts:11-26` documents broad API/WS/server E2E coverage, and `tests/e2e/mio-e2e.spec.ts:403-425` at least verifies the frontend root returns a well-formed response.
- `web/sw.js:72-92` explicitly excludes API and WS path prefixes from static cache handling, reducing stale dynamic-data risk.

Risks:

- The frontend has the same pattern as the backend: architecture vocabulary exists, but the largest views are feature hubs. `web/js/views/studio.js` is 754 lines and owns mod gallery/status, active mod detail, mode switching, soul preview/edit, character list/activation/deletion/life, persona generation wizard, persona save, gender mapping, skeletons, and toasts. `web/js/views/chat.js` is 629 lines and owns chat rendering, input, image upload, speech recognition, WS/SSE/HTTP streaming state, scroll behavior, TTS, status/avatar fetches, and Store message persistence.
- `web/css/chat.css` and `web/css/studio.css` are still large at 666 and 645 lines while newer per-view CSS files exist. This suggests a CSS migration-in-progress and makes styling source-of-truth harder to reason about.
- `web/vite.config.js:16-30` proxies only `/api`, `/ws`, and `health/status/avatar/onboarding/search/memories/proactive/notify/admin`. The frontend directly calls `/chat`, `/chat/stream`, `/mod`, `/uploads/images`, `/voice/synthesize`, `/voice/capabilities`, `/persona/generate`, `/persona/save`, `/persona/mode`, `/character/*`, `/characters`, and `/mods/:name/soul`. This is a concrete dev-server contract mismatch risk if developers run the `web` Vite server rather than the backend static server.
- `web/sw.js:1-2` states the precache list is hardcoded. `web/sw.js:9-40` includes older `/css/chat.css` and `/css/studio.css` but not all currently linked view CSS from `web/index.html:17-20`, and it omits newer JS files such as `messages.js`, `mood.js`, `gender.js`, `mascot.js`, and `utils/icons.js`. This makes offline/cache behavior likely stale.
- `web/index.html:36-43` registers the service worker and uses `console.log` directly, which is minor but inconsistent with the backend's no-`console.log` convention.
- `web/js/auth.js:23-31` and `web/js/auth.js:34-46` validate tokens by calling `/status`. The server review found `/status` is public even when auth exists, so an invalid stored token can be accepted by the frontend and only fail later on protected POSTs.
- `web/js/store.js:28`, `web/js/store.js:40`, and `web/js/store.js:92-94` store bearer token and session id in `localStorage`. That is common for a local app, but any future XSS would expose the token. Also, `web/js/store.js:85-89` persists raw key names while the auto handlers persist `auth_token` and `session`; `web/js/auth.js:29`, `web/js/auth.js:37`, `web/js/auth.js:44`, and `web/js/ws.js:86` call `Store.persist('authToken'/'sessionId')`, which can create duplicate stale keys such as `mio_authToken` and `mio_sessionId`.
- `web/js/ws.js:18-20` uses one module-global `_streamCallbacks`, and `web/js/ws.js:172-177` overwrites it per chat send. The current chat view blocks concurrent sends through `web/js/views/chat.js:334-335`, but the WS manager itself assumes one active stream.
- `web/js/ws.js:48-53` sends heartbeats and `web/js/ws.js:116-118` sets `alive = true` on pong, but `alive` is not used to detect missed pongs or reconnect. This is an incomplete heartbeat design.
- `web/js/api.js:71-100` parses only `data: ` SSE lines and calls `onDone` when the stream ends. It does not inspect `event: done` or preserve `sessionId` from a done payload, while the WS path updates `Store.sessionId` on done at `web/js/ws.js:82-87`.
- `web/js/views/chat.js:417-424` stores the assistant message only if a streamed message element exists. A ghost/empty reply or done-without-token path will not add an assistant message to the frontend Store, even though the backend may have recorded a silent assistant turn.
- `web/js/views/chat.js:207-230` uses browser `webkitSpeechRecognition` directly for voice input, while `web/js/views/chat.js:541-542` uses backend `/voice/synthesize` for TTS. This is not wrong, but the voice architecture is split between browser STT and server TTS despite server voice endpoints existing.
- `web/js/views/studio.js:667-713` calls `/mods/${modName}/soul` without `encodeURIComponent`, while character routes do encode ids at `web/js/views/studio.js:345`, `web/js/views/studio.js:359`, and `web/js/views/studio.js:381`. Server validation likely blocks slash-like names, but the frontend should still encode route params consistently.
- Gender mapping is duplicated: `web/js/views/studio.js:12-20` and `web/js/views/settings.js:10-19` both maintain UI/backend gender maps. This echoes the earlier app/package drift issue at a smaller frontend scale.
- `web/js/views/settings.js:198-203` applies gender with POST `/mod` and updates Store, but unlike `studio.js:248-250` it does not call `wsManager.switchMod`. This may be acceptable because server state changes globally, but it means the two UI surfaces do not use the same realtime update path.
- `web/js/views/BaseView.js:75-78` expects `store.subscribe(callback)`, but the actual Store API is `Store.on(key, fn)` at `web/js/store.js:74-78`. This helper appears stale or unused.
- The E2E test labeled frontend at `tests/e2e/mio-e2e.spec.ts:403-425` does not exercise actual browser UI interactions; it only checks `/` response shape. Most frontend confidence comes from pure-function tests and API/WS tests, not from view behavior tests.

Judgment:

The frontend architecture is `mixed-to-good`. It is stronger than a one-file static UI: it has an app shell, hash router, HTTP/WS clients, global store, lifecycle base class, safe DOM helper, shared view-model functions, mascot assets, and some direct frontend tests. This fits Mio's local-first, low-dependency direction and keeps the UI operationally simple.

It is not excellent because the largest views have become product-area controllers, the service worker and Vite proxy are visibly stale against the current route/file set, frontend auth relies on a public status endpoint, token persistence has duplicate-key drift, and UI-level tests are thin. The right direction is not to adopt a framework by default; it is to split view controllers into view-model/services, make generated/static manifests accurate, and test the streaming/auth/memory/studio workflows directly.

Target boundary if future refactoring is allowed:

- Split `chat.js` into chat view shell, stream state machine, attachment upload helper, voice/TTS helper, and status/avatar presenter.
- Split `studio.js` into mod gallery, soul editor, character management, and persona wizard modules; share gender mapping with `settings.js`.
- Align `web/vite.config.js` proxy paths with actual frontend API calls or route all non-static app API calls to the backend in dev.
- Replace hardcoded service-worker precache with a generated manifest or remove stale precache entries until build tooling owns them.
- Change token validation to hit an authenticated endpoint or add a dedicated `/auth/check` route if future code changes are allowed.
- Make `Store.persist` use the same storage-key mapping as the auto persistence handlers, or remove manual persistence calls.
- Add direct UI tests for login token failure, chat WS/SSE fallback, image attachment, memories edit/delete, studio soul edit, persona wizard, and settings gender switch.
- Keep the no-framework baseline unless product requirements force heavier client state; the current problem is boundary discipline, not lack of a frontend framework.

Role verdicts for this slice:

| Reviewer | Slice Verdict | Notes |
|---|---|---|
| Principal Architect | `mixed` | App shell, router, API, WS, Store, BaseView, and utilities are recognizable boundaries; large view-controller files remain the pressure point. |
| Runtime Reliability Engineer | `mixed` | HTTP timeout and WS/SSE/HTTP fallback are positive; heartbeat, session persistence on SSE, service-worker drift, and dev proxy gaps are concrete reliability issues. |
| Memory Systems Reviewer | `mixed` | Memories UI gives review/edit/delete affordances and tested view-model helpers; broad `/search` exposure follows backend auth assumptions. |
| Agent Behavior and Prompt Architect | `good` | UI exposes chat, mood, persona mode, Studio, memories, and relationship state coherently; ghost/empty replies and voice split need behavioral consistency. |
| Security and Privacy Reviewer | `mixed` | Safe DOM construction is good; localStorage bearer token, public `/status` auth check, and public-memory surfaces under disabled auth keep this mixed. |
| Product Scalability Reviewer | `mixed` | Zero-framework modules can grow for a local app, but `chat.js`, `studio.js`, `settings.js`, and large CSS files will slow feature work unless split. |

### 2026-06-28: Testing Architecture Deep Dive

Evidence commands:

```bash
find tests -maxdepth 2 -type f | sort
find eval -maxdepth 2 -type f \( -name '*.ts' -o -name '*.md' -o -name '*.json' \) -not -path 'eval/.data/*' -not -path 'eval/results/*' | sort
find tests eval scripts -type f \( -name '*.ts' -o -name '*.mjs' -o -name '*.js' -o -name '*.sh' \) -print0 | xargs -0 wc -l | sort -nr | sed -n '1,180p'
rg -n "PluginRegistry|FallbackChainProvider|routeTask|extractGraphFromSoul|retrieveRelevantNodes|graphToPrompt|MIO_AUTH_TOKEN|/admin/export|/mods/.*/soul|serviceWorker|vite|localStorage|_streamCallbacks|AbortSignal|client disconnect|skip|only" tests eval/run.ts eval/quality-gate.ts package.json
for f in tests/*.ts tests/web/*.mjs tests/e2e/*.ts; do printf '%s ' "$f"; rg -c "await test\\(|test\\(|assert\\.|assert\\(|ok\\(|expect\\(" "$f"; done | sort
nl -ba package.json | sed -n '1,90p'
nl -ba tests/golden-turn.ts | sed -n '1,280p'
nl -ba tests/smoke.ts | sed -n '1,260p;520,760p'
nl -ba tests/unit.ts | sed -n '1,110p;280,390p;610,690p'
nl -ba tests/unit-http.ts | sed -n '1,250p'
nl -ba tests/openai-http-compat.ts | sed -n '1,290p'
nl -ba tests/unit-im-session-isolation.ts | sed -n '1,190p'
nl -ba tests/unit-layered-persona.ts | sed -n '1,230p'
nl -ba tests/unit-memory-review.ts | sed -n '1,220p'
nl -ba tests/unit-inference-guardrails.ts | sed -n '1,90p'
nl -ba tests/e2e/playwright.config.ts | sed -n '1,90p'
nl -ba tests/e2e/playwright.global-setup.ts | sed -n '1,90p'
nl -ba eval/README.md | sed -n '1,190p'
```

Observed test / eval file sizes:

```text
11961 total
2324 eval/run.ts
892 eval/quality-gate.ts
764 tests/smoke.ts
685 tests/unit.ts
488 tests/e2e/mio-e2e.spec.ts
484 tests/unit-emotion.ts
454 tests/unit-onebot.ts
281 tests/openai-http-compat.ts
273 tests/golden-turn.ts
262 tests/unit-http.ts
242 tests/unit-entity-graph-temporal.ts
227 tests/unit-rerank.ts
216 tests/unit-openai-compat.ts
214 tests/unit-context-engine.ts
213 tests/unit-structured-extract.ts
198 tests/unit-layered-persona.ts
194 tests/unit-memory-review.ts
168 tests/unit-vector-incremental.ts
164 tests/unit-semantic-memory.ts
160 tests/unit-sqlite-vector.ts
153 tests/unit-im-session-isolation.ts
141 tests/unit-wiring.ts
131 tests/unit-memory-recall-scope.ts
127 tests/unit-weclaw-notify-isolation.ts
105 tests/unit-im-pacing.ts
100 tests/unit-reply-necessity.ts
92 tests/unit-knowledge-base.ts
69 tests/unit-progression-wiring.ts
69 tests/unit-persona-tool-allowlist.ts
68 tests/unit-smart-proactive.ts
60 tests/e2e/playwright.global-setup.ts
59 tests/unit-compression.ts
57 tests/unit-rrf-fusion.ts
57 tests/unit-directive-isolation.ts
56 tests/unit-inference-guardrails.ts
52 tests/unit-circadian.ts
51 tests/unit-proactive-quality.ts
51 tests/e2e/playwright.config.ts
49 tests/web/memories.test.mjs
49 tests/web/liveness.test.mjs
48 tests/unit-modality.ts
45 tests/unit-begin-dialogs.ts
14 tests/web/mascot.test.mjs
```

Architecture shape:

- `package.json:15-16` makes `npm test` a broad serial regression suite: build, many compiled TypeScript test scripts with `MIO_PROVIDER=mock`, and `npm run test:web`.
- `package.json:27-29` separates typecheck and E2E from the main test script. `npm run test:e2e` uses Playwright, while `npm test` is mostly deterministic local mock coverage.
- The test style is deliberately lightweight: most tests are executable scripts with local `test/record/assert` helpers rather than a full test framework. This matches the low-dependency local-first project style.
- Most integration tests import compiled `dist/` modules after `npm run build`, so the suite validates emitted JS behavior rather than only TypeScript source.
- Tests usually isolate durable state with temporary `MIO_DIR` directories. Examples: `tests/golden-turn.ts:42-45`, `tests/unit.ts:55-59`, `tests/unit-im-session-isolation.ts:13-22`, `tests/unit-layered-persona.ts:10-13`, and `tests/unit-memory-review.ts:40-44`.
- There are several test layers: pure unit/module tests, core golden-turn regression, server smoke, OpenAI HTTP compatibility, Playwright E2E, frontend view-model tests, and separate eval/quality gates.
- `eval/README.md:17-37` defines `eval:quality` as a deterministic local product quality gate, while `eval/README.md:62-87` describes a broader synthetic scenario benchmark with ablation variants.

Positive evidence:

- `tests/golden-turn.ts:3-7` explicitly locks down one complete `runTurn` observable side effect surface. It covers response shape, transcript writes, bookmarks, and Active Context.
- `tests/golden-turn.ts:65-91` tests normal turn output, transcript writes, memory append, and directory creation; `tests/golden-turn.ts:93-105` tests session continuation; `tests/golden-turn.ts:107-118` tests crisis flagging; `tests/golden-turn.ts:138-157` tests ghost silence; `tests/golden-turn.ts:177-208` tests tool loop behavior; `tests/golden-turn.ts:244-250` tests crisis safety override under post-history prompt mode.
- `tests/smoke.ts:1-20` describes a real server smoke suite, and `tests/smoke.ts:101-238` exercises `/health`, `/status`, `/mod`, `/mods/:name/soul`, `/chat`, image upload, image chat, and `/chat/stream`.
- `tests/smoke.ts:530-628` exercises WebSocket invalid payload rejection, hello, chat tokens, done, avatar subscription, emotion_changed, mod switch, and ping/pong.
- `tests/smoke.ts:633-745` starts a second auth-enabled server and tests OpenAI-compatible auth errors, valid key, validation envelope, authenticated session preservation, and authenticated streaming metadata session.
- `tests/openai-http-compat.ts:92-120` tests CORS preflight and auth error envelope; `tests/openai-http-compat.ts:122-181` tests SDK-ish request compatibility; `tests/openai-http-compat.ts:183-215` tests OpenAI SSE chunks; `tests/openai-http-compat.ts:217-260` tests invalid request envelopes and concurrent session isolation.
- `tests/unit-http.ts:1-17` documents provider HTTP reliability coverage, and `tests/unit-http.ts:87-241` tests timeout, retry success, retry exhaustion, no retry for ordinary 4xx, network-error retry, 429 retry, env retry override, and caller abort without retry.
- `tests/unit.ts:292-345` tests file/bash tool restrictions for allowed reads, command execution rejection, package-manager rejection, mutating git rejection, shell composition, redirection, destructive find options, unsafe cwd, and unsafe absolute paths.
- `tests/unit.ts:365-383` tests validation rejects path-like persona names, traversal-like character names, invalid search role, and empty WebSocket chat text.
- `tests/unit-im-session-isolation.ts:102-140` tests OpenAI/OneBot session isolation, prompt privacy constraint, omission of global bookmarks/profile, no global bookmark append, per-contact transcript writes, tool exposure restricted to `current_time`, and hidden forbidden tool-call denial.
- `tests/unit-layered-persona.ts:46-113` tests persona delta, explicit preferences, per-user preference isolation, WeClaw target isolation, proactive opt-in/out behavior, and false opt-in/opt-out cases.
- `tests/unit-layered-persona.ts:116-152` tests kernel/preference prompt sections survive `ContextEngine` hard caps as critical sections. `tests/unit-layered-persona.ts:154-185` tests directive detection, persistence, false positives, and shared-memory prompt rendering.
- `tests/unit-memory-review.ts:1-10` documents memory review sync coverage, and `tests/unit-memory-review.ts:86-170` tests confirm/ignore/edit/delete propagation across structured memory, durable facts, topics, vector index, prompt context, and lorebook.
- `tests/unit-inference-guardrails.ts:17-45` tests repeated tool-call detection and max-loop forced summary behavior.
- `tests/e2e/playwright.config.ts:15-34` defines sequential single-worker Playwright runs with retry/trace/screenshot behavior. `tests/e2e/playwright.global-setup.ts:42-57` starts the real Mio server on a free port and exports HTTP/WS URLs.
- Frontend pure-function coverage exists through `tests/web/liveness.test.mjs`, `tests/web/memories.test.mjs`, and `tests/web/mascot.test.mjs`, already cited in the frontend section.
- `eval/README.md:62-77` defines 60 synthetic scenarios across memory, temporal conflict, emotional support, preference, privacy, crisis, proactive, ghost, persona consistency, and token cost. `eval/README.md:81-87` defines ablation variants from `no_memory` to `full`, which is useful for architecture claims.
- `eval/README.md:160-165` is honest about evidence limits: synthetic scenarios are not user-study evidence, dry-run rows validate plumbing only, and real-provider/human or LLM judge passes are second-stage validation.

Risks:

- `npm test` is a very long shell command in `package.json:15`. It is explicit and easy to inspect, but hard to maintain, hard to subset, and not self-describing as the suite grows.
- The lightweight script style keeps dependencies low, but each test file reimplements small harness helpers. That is fine now, but shared setup patterns for temp dirs, env restore, fake providers, and server startup are duplicated across many files.
- Most tests import `dist/`, so `npm test` requires a full build. This is good for release confidence but slower for tight inner-loop development; there is no obvious fast unit-only command besides manually running individual files.
- Coverage is breadth-oriented, not measured. There is no coverage tool or architectural coverage matrix in the inspected scripts, so "184 checks" can still hide untested boundary modules.
- Direct tests for several earlier architecture risks were not found in `rg` output: `PluginRegistry`, `FallbackChainProvider`, `routeTask`, `extractGraphFromSoul`, `retrieveRelevantNodes`, `graphToPrompt`, Vite proxy, service worker precache, frontend localStorage token behavior, WS `_streamCallbacks`, and client-disconnect cancellation.
- Native-route auth remains weaker than OpenAI-route auth. `tests/smoke.ts:633-745` and `tests/openai-http-compat.ts:107-120` focus on `/v1/*`; this pass did not find equivalent auth tests for native `/chat`, `/admin/export`, `/mods/:name/soul`, `/notify/test`, `/memories`, or WS `?token=`.
- `tests/e2e/mio-e2e.spec.ts` is mostly API/WS E2E through Playwright's request client and Node `ws`. The frontend "loads" test only checks `/` response shape, as documented in `tests/e2e/mio-e2e.spec.ts:403-425`; it does not click through chat, Studio, Memories, Settings, or onboarding.
- The eval system is valuable but large. `eval/run.ts` is 2324 lines and `eval/quality-gate.ts` is 892 lines. They may become their own maintainability area if used as research/paper infrastructure.
- A noisy initial evidence command accidentally scanned `eval/.data` and `eval/results`, producing massive output. That reveals a documentation/process risk: architecture scripts and future research commands need explicit ignore rules for generated artifacts.
- The test suite appears to rely heavily on mutable environment variables. Many files restore env carefully, but this style remains fragile if tests become parallel. Playwright explicitly sets `fullyParallel: false` and `workers: 1` at `tests/e2e/playwright.config.ts:22-25`, confirming shared state constraints.

Judgment:

The test architecture is a real strength. It is not only checking happy-path unit functions; it protects core turn behavior, memory privacy, tool guardrails, HTTP reliability, server routes, bridge compatibility, IM isolation, persona overlays, memory review propagation, and frontend pure view-models. This materially supports the provisional `good` architecture verdict.

It is not excellent because the most strategic gaps align with the architecture risks found earlier. Plugin lifecycle, provider fallback/routing, ID-RAG retrieval, native-route auth, frontend PWA/dev-server behavior, actual browser workflows, and cancellation semantics need direct tests. The suite is also operationally broad but not well organized into named tiers, which may slow future developers who need a focused confidence check.

Target boundary if future refactoring is allowed:

- Replace the monolithic `package.json` test command with named scripts: `test:unit`, `test:core`, `test:http`, `test:memory`, `test:bridge`, `test:web`, `test:smoke`, and `test:all`.
- Add shared test utilities for temp `MIO_DIR`, env restore, fake providers, server startup, and assertion reporting.
- Add direct tests for `PluginRegistry` lifecycle/conflict/rollback/prompt fragments, `FallbackChainProvider`, `routeTask`, ID-RAG graph extraction/retrieval/rendering, native route auth, WS auth, service worker manifest completeness, Vite proxy coverage, frontend token persistence, and chat stream state.
- Add browser UI E2E for chat send, SSE/WS fallback, image upload, memories edit/delete, Studio soul edit, persona wizard, settings gender switch, onboarding, and invalid token login.
- Add cancellation tests once core/server supports abort propagation.
- Add a generated or maintained test coverage matrix mapping architectural contracts to test files; this may be more useful than raw line coverage for this agent runtime.
- Keep mock-provider deterministic tests as the main local gate; use eval real-provider runs as second-stage evidence, not as a replacement for deterministic regression tests.

Role verdicts for this slice:

| Reviewer | Slice Verdict | Notes |
|---|---|---|
| Principal Architect | `good` | Tests protect many architectural contracts, but missing tests line up with known boundary risks. |
| Runtime Reliability Engineer | `good` | HTTP retry/timeout, smoke server, WS/SSE, golden turn, and E2E coverage are strong; cancellation, fallback, and route auth gaps remain. |
| Memory Systems Reviewer | `good` | Memory isolation, recall scope, semantic memory, vector, structured extraction, and review sync are well represented. |
| Agent Behavior and Prompt Architect | `good` | Golden turn, context engine, layered persona, emotion, reply necessity, and eval scenarios cover behavior well; direct ID-RAG retrieval tests are missing. |
| Security and Privacy Reviewer | `mixed` | Strong tests for IM isolation, tool restrictions, validation, and OpenAI auth; native auth and frontend token/cache behavior need direct tests. |
| Product Scalability Reviewer | `mixed` | Broad suite supports growth, but the monolithic test script and duplicated harness code will become friction. |

## Initial Architecture Hypothesis

Mio's architecture is currently `good` and directionally appropriate.

Why:

- The chosen deployment shape, a local modular monolith, fits the product constraints better than microservices.
- The domain has clear module vocabulary: memory, emotion, persona, providers, tools, scheduler, server, prompt, core.
- Provider abstraction and tool abstraction appear intentional rather than incidental.
- Memory is a first-class subsystem rather than an afterthought.
- Prompt construction is treated as a pipeline with budget control, which is stronger than typical prototype prompt concatenation.
- The test script list suggests broad regression awareness around core turn behavior, memory, vector search, OpenAI compatibility, OneBot, IM isolation, prompt context, and web view-models.

Why not `excellent` yet:

- Large-file pressure remains significant.
- `server/index.ts` is now the biggest architectural hotspot.
- `agent-loop.ts` still contains prompt assembly, persona retrieval, semantic memory retrieval, inference-stage coordination, and evaluation augmentation.
- `src/` and `packages/` duplicate emotion and ID-RAG implementation areas, requiring a clear drift policy.
- Frontend view files and CSS show the same maintainability pressure as backend composition files.
- Testing is broad, but direct tests are still missing for several architectural boundaries: plugin lifecycle, provider fallback/routing, ID-RAG retrieval/rendering, native route auth, frontend PWA/dev-server behavior, actual browser workflows, and cancellation semantics.

## Stage Architecture Scorecard

This scorecard is based on the completed slice reviews: core turn loop, memory, emotion/relationship, persona/ID-RAG, provider/tool/plugin, server/API/bridge, frontend, and testing.

Stage verdict: `good, not excellent`.

Defensible claim:

Mio has a strong product-architecture fit. The local modular monolith, file-backed memory, explicit prompt budget, provider/tool boundaries, code-backed emotion behavior, persona graph, bridge adapters, and deterministic regression tests are all meaningful architecture work. It is already beyond prototype quality.

Why the verdict stops at `good`:

- The main composition roots are still too concentrated: `src/server/index.ts`, `src/core/agent-loop.ts`, `src/core/turn-post-effects.ts`, `web/js/views/chat.js`, and `web/js/views/studio.js`.
- Two package boundaries are not trustworthy enough yet: `src/emotion` vs `packages/emotion`, and `src/persona` vs `packages/idrag`.
- Local-first security posture is reasonable, but not internet-hardened: auth is optional, some reads/setup routes are public, frontend auth checks `/status`, and tokens live in localStorage.
- Reliability has strong primitives but missing propagation: provider HTTP timeout/retry exists, but server streaming and WS turns do not cancel on client disconnect, notifications lack shared timeout/retry, and multi-file memory recovery is not proven.
- Test coverage is broad, but the missing direct tests align with the major architecture risks.

Score table:

| Reviewer | Score | Confidence | Rationale |
|---|---:|---|---|
| Principal Architect | 4 | High | Modular monolith fits the local-first companion product, and domain vocabulary is strong. Score is capped by route/core/frontend composition roots and package drift. |
| Runtime Reliability Engineer | 3 | High | HTTP retry/timeout, SQLite WAL, append-only transcripts, tool-loop guardrails, and smoke/E2E tests are solid. Missing cancellation, notification timeouts, streaming fallback semantics, and recovery guarantees keep this at acceptable. |
| Memory Systems Reviewer | 4 | High | Memory is a first-class layered subsystem with transcript scope, vector/structured memory, review flows, and isolation tests. Score is capped by broad memory files, caller-dependent search scope, and unproven multi-file consolidation recovery. |
| Agent Behavior and Prompt Architect | 4 | High | Prompt, persona, emotion, ghost, stage gates, tool scoping, and eval scenarios are explicitly engineered. Score is capped by prompt section concentration, overlapping state machines, source-of-truth ambiguity, and missing direct ID-RAG tests. |
| Security and Privacy Reviewer | 3 | High | IM isolation, validation, upload checks, tool restrictions, safe DOM, and OpenAI auth tests are strong. Optional auth, public reads/setup routes, localStorage token persistence, native-auth test gaps, and frontend auth mismatch keep this at acceptable. |
| Product Scalability Reviewer | 3 | High | Providers and channels can grow, and tests support change. New behavior still tends to touch core/server/view hubs, package drift raises maintenance cost, and plugin-owned behavior is not mature. |

Score interpretation:

- `4` means "good enough to build on, with explicit follow-up boundaries."
- `3` means "acceptable for a local-first personal agent, but must not be oversold as hardened or low-maintenance."
- No role receives `5` because every strong subsystem has at least one concrete boundary, reliability, security, or test gap.

Architecture blockers before calling Mio `excellent`:

- Split route families out of `src/server/index.ts` without changing API contracts.
- Move prompt/persona/memory context assembly out of `src/core/agent-loop.ts` into owned context providers.
- Define package drift policy and add parity tests for `@mio/emotion` and `@mio/idrag`.
- Add cancellation propagation from HTTP/SSE/WS clients into `runTurn` and provider calls.
- Add native route auth tests and deployment guidance for non-localhost binding.
- Fix frontend dev proxy and service-worker manifest drift.
- Add direct tests for plugin lifecycle, provider fallback/routing, ID-RAG graph retrieval, and real browser UI workflows.

Ordinary maintainability debt, not blockers:

- Splitting `structured-memory.ts`, `search.ts`, `consolidation-phases.ts`, `chat.js`, `studio.js`, and large CSS files.
- Replacing duplicated test harness helpers with shared test utilities.
- Moving remaining direct path joins behind explicit path helpers.
- Tightening frontend Store persistence keys.
- Documenting emotion state ownership and persona overlay precedence.

## Improvement Roadmap

This roadmap is research-only. It describes what should be done if future implementation work is allowed; it does not authorize code changes in this task.

Sequencing principle:

Do not start by rewriting the architecture. First add tests and decision records around the contracts that are already working. Then split composition roots in small behavior-preserving steps. Mio's current shape is good enough to evolve; the risk is untested broad refactors, not the modular monolith itself.

### Phase 0: Architecture Decision Baseline

Goal:

Make the current architecture explicit so future work does not accidentally fight it.

Recommended artifacts:

- ADR: "Mio is a local-first modular monolith, not microservices."
- ADR: "Localhost-first security model and deployment assumptions."
- ADR: "Persona source hierarchy: `soul.md` as character-archetype source, plus dynamic overlays."
- ADR: "Emotion state ownership matrix."
- ADR: "Package drift policy for `@mio/emotion` and `@mio/idrag`."
- Test coverage matrix mapping major contracts to test files.

Why first:

Most major risks are not from missing features; they are from unclear ownership. Decision records reduce future accidental coupling before any code is moved.

### Phase 1: Tests Before Refactors

Goal:

Protect the highest-risk boundaries before splitting files.

High-priority direct tests:

- `PluginRegistry`: manifest validation, duplicate registration, dependency/conflict handling, `onLoad` rollback, hook failure isolation, prompt fragment collection.
- Provider fallback/routing: `FallbackChainProvider`, streaming fallback semantics, `routeTask`, provider-aware model routing.
- ID-RAG: `extractGraphFromSoul`, `retrieveRelevantNodes`, stage relevance, trigger matching, always-included voice/boundary nodes, `graphToPrompt`, refresh detection.
- Native auth: `/chat`, `/admin/export`, `/mods/:name/soul`, `/notify/test`, `/memories`, and WS `?token=` under `MIO_AUTH_TOKEN`.
- Frontend contracts: Vite proxy path coverage, service-worker precache completeness, auth invalid-token behavior, localStorage persistence keys, WS single-stream assumption, SSE done/session handling.
- Browser UI workflows: chat send, image attach, Memories edit/delete, Studio soul edit, persona wizard, settings gender switch, onboarding, invalid login token.

Why second:

The current suite is broad, but gaps align with architecture risks. Adding these tests turns refactoring from guesswork into controlled movement.

### Phase 2: Composition Root Splitting

Goal:

Reduce the files where many domains converge.

Recommended split order:

1. `src/server/index.ts`: extract route families while preserving existing routes and response shapes.
2. `src/core/agent-loop.ts`: extract turn prompt/context providers, not the public `runTurn` pipeline.
3. `src/core/turn-post-effects.ts`: move emotion/relationship post-turn orchestration behind a domain service.
4. `web/js/views/chat.js`: extract stream state, attachment upload, voice/TTS, and avatar/status presenter.
5. `web/js/views/studio.js`: extract mod gallery, character management, soul editor, and persona wizard.

Why this order:

The server is now the largest hotspot and easiest to split by route family. Core prompt/context extraction is higher risk because it can change behavior, so it should follow test additions.

### Phase 3: Reliability And Security Hardening

Goal:

Make local-first assumptions explicit and reduce long-running failure modes.

Recommended work:

- Add `AbortSignal` propagation from `/chat/stream`, OpenAI streaming, and WS close into `runTurn` and provider HTTP calls.
- Wrap notification `fetch` calls with timeout/retry or `AbortSignal.timeout`.
- Document and enforce "binding beyond localhost requires auth."
- Add a setup-mode boundary for onboarding if non-localhost binding is allowed.
- Revisit backup/export: either use a proven archive library or label the current tar logic as best-effort local export.
- Add path helpers for durable state paths that are still hand-built.
- Decide whether frustration mini-crisis state should be persisted or documented as ephemeral.

Why third:

These improve real-world operation without changing Mio's product model. They also close the gap between "local personal agent" and "safe to expose beyond localhost."

### Phase 4: Package And Plugin Maturity

Goal:

Turn nominal extension points into reliable boundaries.

Recommended work:

- Choose source of truth for `src/emotion` vs `packages/emotion`.
- Choose source of truth for `src/persona` vs `packages/idrag`.
- Fix known `@mio/idrag` generator gender mismatch before treating the package as reusable.
- Add package parity tests for exported behavior.
- Decide whether built-in plugins should own PAD/affinity/frustration/ghost behavior or remain extension wrappers.
- If plugins should own behavior, move one behavior at a time behind plugin-owned lifecycle hooks.

Why fourth:

Package and plugin maturity matters for ecosystem growth, but it should follow core reliability and test hardening.

### Phase 5: Frontend Maintainability

Goal:

Keep the zero-framework frontend viable as the product surface grows.

Recommended work:

- Align `web/vite.config.js` with all backend routes used by the frontend.
- Generate service-worker precache or remove stale hardcoded entries.
- Share gender mapping between Studio and Settings.
- Extract pure view-models from Chat, Studio, Settings, Messages, and Mood.
- Add UI-level E2E before large visual or state changes.
- Keep safe DOM construction as the default; do not introduce string HTML rendering for convenience.

Why fifth:

The frontend is not yet blocking the architecture, but it is on the same path as earlier backend hotspots. Splitting before more features arrive will be cheaper.

Priority summary:

| Priority | Item | Reason |
|---|---|---|
| P0 | Decision records and test coverage matrix | Clarifies ownership without code risk. |
| P0 | Direct tests for plugin, fallback/routing, ID-RAG, native auth, frontend cache/proxy/auth | Protects the exact boundaries currently limiting scores. |
| P1 | Split `server/index.ts` by route family | Largest hotspot and clear modularization target. |
| P1 | Add cancellation propagation | Biggest runtime reliability gap for streaming/WS. |
| P1 | Define package drift policy | Prevents reusable packages from becoming misleading snapshots. |
| P2 | Extract core prompt/persona/memory context providers | High value but behavior-sensitive. |
| P2 | Frontend Chat/Studio splits | Improves product iteration speed. |
| P2 | Backup/export and notification hardening | Practical reliability improvements. |

Expected score movement if roadmap succeeds:

- Principal Architect: `4 -> 5` only after server/core/frontend composition roots are split and package drift policy is enforced.
- Runtime Reliability Engineer: `3 -> 4` after cancellation, notification timeout/retry, provider fallback semantics, and recovery tests.
- Memory Systems Reviewer: `4 -> 5` only after structured/search/consolidation boundaries and multi-file recovery are hardened.
- Agent Behavior and Prompt Architect: `4 -> 5` after ID-RAG direct tests, persona overlay precedence, emotion ownership matrix, and prompt context provider extraction.
- Security and Privacy Reviewer: `3 -> 4` after native auth tests, deployment policy, frontend token/auth fixes, and public-route review.
- Product Scalability Reviewer: `3 -> 4` after route/view splits, package parity, and plugin behavior ownership clarity.

## Paper / Presentation Architecture Highlights

These are claims that can be presented with evidence from this research pass. They should be phrased as architecture strengths, not as proof that the whole system is excellent.

### Strong Claims

1. Mio is a local-first stateful agent runtime, not a stateless chatbot.

Evidence:

- Durable state files, transcripts, memory bank, vector store, structured memory, emotion state, relationship state, persona state, backups, and frontend review flows are all first-class architecture elements.
- `src/memory/*`, `src/emotion/*`, `src/persona/*`, `src/core/*`, `src/server/*`, and `web/js/*` are organized around persistent companion behavior rather than one-off request/response chat.

Careful phrasing:

Use "local-first modular monolith" rather than "distributed agent platform" or "microservice architecture."

2. Mio treats memory as a layered system rather than a chat log.

Evidence:

- Memory deep dive found transcripts, memory bank, bookmarks, active context, structured memory, mid-term topics, vector recall, lorebook, procedural memory, entity graph, global memory, per-user preferences, and consolidation.
- Tests cover vector incremental indexing, SQLite vector behavior, semantic memory, memory review propagation, recall scope, structured extraction, compression, and IM isolation.

Careful phrasing:

Do not claim perfect memory safety. Search scope and multi-file consolidation recovery still need hardening.

3. Mio's persona architecture is more advanced than a static prompt.

Evidence:

- Persona deep dive found mod-backed `soul.md`, ID-RAG persona graph, per-user persona deltas, explicit preferences, layered kernel, personality driver, dual-mode behavior, lorebook, and Persona Studio.
- `soul.md` is better described as the character-archetype source, with dynamic overlays shaping behavior.

Careful phrasing:

Do not say `soul.md` is the only personality source. The accurate claim is that it is the primary character-archetype source.

4. Mio uses code-backed behavior gates, not only prompt instructions.

Evidence:

- Relationship stages are implemented in code with feature gates.
- Tool exposure is restricted by isolated session and persona allowlist.
- Ghost silence, reply necessity, PAD updates, frustration, affinity, and progression are runtime modules.
- Tests cover ghost behavior, progression wiring, tool restrictions, IM isolation, reply necessity, and prompt critical sections.

Careful phrasing:

The behavior model is sophisticated, but overlapping state machines need an ownership matrix.

5. Provider and tool boundaries are pragmatic and extensible.

Evidence:

- Provider contract is compact and vendor-agnostic.
- Anthropic and OpenAI-compatible providers map external APIs into Mio-native `Message`, `ToolDef`, and `ToolCall`.
- Shared HTTP timeout/retry exists.
- Tool loop has max-turn guardrails and canonical `call.input -> result.output`.
- Tests cover HTTP retry/timeout and tool-loop guardrails.

Careful phrasing:

Do not overstate provider fallback. Fallback activation/streaming semantics and router model/provider mismatch need direct tests and design cleanup.

6. Mio exposes multiple protocol surfaces through one agent core.

Evidence:

- Server/API deep dive found native HTTP chat, SSE chat, WebSocket, OpenAI-compatible bridge, OneBot bridge, analytics, memories, notifications, backups, onboarding, and Persona Studio.
- Tests cover native routes, OpenAI HTTP compatibility, OneBot behavior, WebSocket events, and session isolation.

Careful phrasing:

This is broad API coverage, not a clean server architecture yet. `server/index.ts` is the biggest hotspot.

7. The test suite is unusually broad for a personal agent project.

Evidence:

- `npm test` runs build plus many deterministic mock-provider tests and frontend view-model tests.
- Separate Playwright E2E and eval/quality gates exist.
- Tests cover core turn behavior, memory privacy, tool guardrails, HTTP retry/timeout, route smoke, OpenAI/OneBot bridges, IM isolation, layered persona, memory review, frontend view-models, and synthetic companion scenarios.

Careful phrasing:

Do not say coverage is complete. Missing direct tests align with major architecture risks.

### Suggested Diagrams

1. System shape diagram:

```text
Web UI / CLI / OpenAI Bridge / OneBot
              |
          Server API
              |
          Core runTurn
              |
Prompt Context + Provider + Tool Loop + Post Effects
              |
Memory / Persona / Emotion / Relationship / Learning
              |
        Local Files + SQLite Vector Store
```

2. Turn pipeline diagram:

```text
prepare turn
  -> early silence / crisis / ghost checks
  -> prefetch memory + persona context
  -> assemble prompt under budget
  -> provider inference + bounded tool loop
  -> transcript + memory + emotion + relationship side effects
```

3. Memory stack diagram:

```text
Raw conversation transcripts
  -> bookmarks / active context
  -> vector index + hybrid search
  -> structured memory entities
  -> durable facts + topics + lorebook + procedural memory
  -> prompt context under budget
```

4. Persona stack diagram:

```text
immutable kernel
  + mod soul.md
  + ID-RAG persona graph
  + per-user deltas/preferences
  + relationship context
  + lorebook / few-shot / dual-mode
  -> persona prompt fragment
```

5. Evidence loop diagram:

```text
Architecture contract
  -> deterministic mock test
  -> smoke / bridge / E2E test
  -> eval quality gate
  -> research scorecard
```

### Phrases Suitable For README / Talk

- "Mio is a local-first companion runtime built as a modular monolith: one process, explicit domain modules, durable local state."
- "The memory system is layered: transcripts are append-only, bookmarks form an active context, vector search supports recall, structured memory turns repeated facts into reviewable long-term state."
- "Persona is not a single prompt blob. `soul.md` defines the character archetype, ID-RAG retrieves relevant persona nodes, and per-user overlays preserve relationship-specific preferences."
- "Behavioral safety is partly enforced in code: session isolation controls memory and tools, relationship stages gate capabilities, and crisis/ghost/reply policies are runtime paths."
- "The current architecture is good, but not yet excellent: its biggest risks are composition-root concentration, package drift, optional-auth assumptions, missing cancellation, and direct-test gaps."

### Claims To Avoid

- Avoid: "Mio is fully plugin-driven."
  Accurate: "Mio has a plugin registry and prompt/hook extension points, but built-in emotional behavior still mostly runs through core/emotion modules."

- Avoid: "Mio is internet-hardened."
  Accurate: "Mio is localhost-first, with auth and validation mechanisms; deployment beyond localhost needs explicit token configuration and route-hardening."

- Avoid: "Mio has complete test coverage."
  Accurate: "Mio has broad deterministic regression coverage, but several architecture boundaries still need direct tests."

- Avoid: "`soul.md` is the only persona source."
  Accurate: "`soul.md` is the primary character-archetype source; behavior is also shaped by overlays, memory, relationship, mode, and runtime policies."

- Avoid: "The frontend is dependency-free."
  Accurate: "The frontend is zero-UI-framework ES modules with Vite tooling."

## Current Scores

These are the current stage scores after the first complete architecture research pass.

| Reviewer | Score | Rationale |
|---|---:|---|
| Principal Architect | 4 | Modular monolith fits the product and module vocabulary is strong; the turn split improves readability, but orchestration/server files remain heavy. |
| Runtime Reliability Engineer | 3 | Provider HTTP retry/timeout and tool-loop guardrails are strong; server streaming/WS cancellation, notification timeouts, background tasks, and file recovery keep this at acceptable rather than strong. |
| Memory Systems Reviewer | 4 | Memory is clearly central and layered with useful tests; large structured/search/consolidation files and multi-file recovery keep it below excellent. |
| Agent Behavior and Prompt Architect | 4 | Prompt/persona are explicitly engineered with ID-RAG and code-backed emotion behavior; prompt section ownership, source-of-truth ambiguity, and overlapping state machines keep it below excellent. |
| Security and Privacy Reviewer | 3 | Localhost default, auth/validation, upload checks, and safe DOM construction are positive; optional auth, public reads, localStorage bearer token, and token validation through public `/status` keep this at acceptable. |
| Product Scalability Reviewer | 3 | Modules are extensible, but new behavioral context still likely touches `agent-loop.ts` or post-turn side effects; large server/frontend files and package duplication may slow product growth. |

Stage overall: `good`.

## Next Research Questions

Next focus: none. Current research loop is complete.

Questions:

- If code changes happen later, rerun the relevant slice review before updating scores.
- If implementation is allowed later, start from the roadmap's P0 items: ADRs and direct boundary tests.
- If a presentation or paper is needed, use the architecture highlights section and keep the cautionary wording.

Suggested read-only evidence commands:

```bash
rg -n "Stage verdict|Improvement Roadmap|Paper / Presentation Architecture Highlights|Claims To Avoid|Stage overall|Current Scores|Open Risks" docs/research/architecture-review-long-task.md
git status --short docs/research/architecture-review-long-task.md src web packages tests package.json tsconfig.json docs/architecture-audit-agents.md
```

## Open Risks To Validate

- Whether route families in `src/server/index.ts` can be separated without changing API contracts.
- Whether duplicated package/app modules are intentionally mirrored or drifting.
- Whether prompt section registration has hidden ordering or cache coupling.
- Whether memory consolidation writes can corrupt user state under partial failure.
- Whether IM isolation applies uniformly across tools, memory retrieval, prompt context, and post-turn side effects.
- Whether emotion/package drift is accidental, and whether `@mio/emotion` is intended as source of truth or embeddable snapshot.
- Whether ID-RAG/package drift is accidental, especially the package generator gender mismatch.
- Whether persona graph retrieval has sufficient direct tests.
- Whether multi-axis relationship behavior has sufficient direct tests.
- Whether provider fallback should be enabled by config, and whether streaming fallback can avoid duplicated partial output.
- Whether model routing should be provider-aware instead of routing model strings through `auto`.
- Whether default write/edit/bash tools should require an explicit trusted-local mode.
- Whether plugin registry behavior has enough direct tests, and whether built-in plugins are intended to own behavior or remain wrappers.
- Whether `server/index.ts` can be split by route family while preserving current API contracts.
- Whether server streaming and WebSocket turns should be cancellable on client disconnect.
- Whether notification outbound calls need timeout/retry parity with provider HTTP calls.
- Whether native route auth needs stricter tests under `MIO_AUTH_TOKEN`.
- Whether backup/export should use a proven archive library or remain explicitly best-effort.
- Whether `web/vite.config.js` dev proxy should cover all frontend API calls or be replaced with a safer catch-all API proxy.
- Whether `web/sw.js` hardcoded precache list is stale enough to break offline/PWA behavior and should be generated.
- Whether frontend auth should validate against a protected endpoint rather than public `/status`.
- Whether `localStorage` token persistence and duplicate `Store.persist` key names are acceptable for a local-first app.
- Whether `chat.js` and `studio.js` should be split before more product surface is added.
- Whether frontend E2E should exercise real UI workflows rather than mostly API/WS behavior.
- Whether architecture scripts need repo-specific ignore rules to avoid unbounded scans.

## Latest Session Notes

2026-06-28:

- Created this research task document.
- Established first evidence baseline from `README.md`, `package.json`, `tsconfig.json`, module counts, and large-file scan.
- Completed the core turn loop deep dive using read-only inspection.
- Found that the turn split is a real improvement: `runTurn` is now a clear pipeline, and phase modules have recognizable cohesion.
- Found that `agent-loop.ts` remains the main prompt/persona/memory integration hotspot, so the architecture remains `good` rather than `excellent`.
- Completed the memory system deep dive using read-only inspection.
- Found that memory is one of Mio's strongest architecture areas: layered, local-first, tested, and matched to the product.
- Found that `structured-memory.ts`, `search.ts`, and `consolidation-phases.ts` are the main memory maintainability risks, with multi-file recovery still unproven.
- Completed the emotion / relationship system deep dive using read-only inspection.
- Found that emotion and relationship modeling is sophisticated and product-aligned, with PAD, affinity, multi-axis relationship, frustration, stage gates, ghost, ritual, and progression represented as explicit state machines.
- Found that the main emotion risks are overlapping state ownership, post-turn side-effect centralization, process-local frustration state, missing direct multi-axis tests, and real drift between `src/emotion` and `packages/emotion`.
- Completed the persona / ID-RAG system deep dive using read-only inspection.
- Found that persona architecture is a strong product idea: mod-backed `soul.md`, ID-RAG persona graph, per-user overlays, explicit preferences, personality driver, and dual-mode prompt behavior.
- Found that `soul.md` is better described as the single character-archetype source, not the only persona influence, because kernel, few-shot, deltas, preferences, builder-chain, dual-mode, and life-engine all shape behavior.
- Found that app/package drift exists in `@mio/idrag`; the most concrete issue is package generator code checking `boyfriend/girlfriend` while package types expose `male/female`.
- Completed the provider / tool / plugin system deep dive using read-only inspection.
- Found that provider/tool architecture is stronger than prototype quality: compact provider contracts, vendor adapters, shared HTTP timeout/retry, bounded tool loop, canonical tool I/O, IM tool isolation, and persona tool allowlists.
- Found that plugin registry infrastructure is solid, but built-in plugins are mostly wrappers/no-ops while real PAD/affinity/frustration/ghost behavior still runs through direct core/emotion calls.
- Found provider/tool/plugin risks: fallback is not enabled by default despite comment wording, streaming fallback can duplicate partial output, router maps model strings through `auto`, non-isolated sessions get write/edit/bash by default, and plugin registry lacks direct tests.
- Completed the server / API / bridge system deep dive using read-only inspection.
- Found that server/API is broad and useful for the product: Express + WS, local host default, CORS allowlist, zod validation, upload checks, OpenAI-compatible bridge, OneBot bridge, memory review, analytics, notifications, backup/export, Persona Studio, and strong smoke/E2E coverage.
- Found that `src/server/index.ts` is now the largest architectural hotspot and is no longer truly thin; it aggregates too many route families, protocol handlers, upload helpers, bridge logic, admin flows, and WS behavior.
- Found server/API risks: optional auth depends on localhost assumptions, several read/setup routes are public, streaming/WS turns do not cancel on client disconnect, notification fetches lack shared timeout/retry, backup archive logic is best-effort, and native-route auth under `MIO_AUTH_TOKEN` needs more direct tests.
- Completed the frontend architecture deep dive using read-only inspection.
- Found that the frontend is still a zero-UI-framework ES module app, but now has Vite tooling, app shell, hash router, Store, HTTP/WS clients, BaseView lifecycle cleanup, safe DOM helpers, mascot assets, and a few pure view-model tests.
- Found that frontend architecture is mixed-to-good: the boundaries are real, but `studio.js`, `chat.js`, `settings.js`, `web/css/chat.css`, and `web/css/studio.css` are growing into feature hubs.
- Found concrete frontend reliability/security risks: Vite proxy misses several actual API paths, service-worker precache is hardcoded and stale, auth validates tokens through public `/status`, bearer token is stored in localStorage, manual `Store.persist` creates duplicate key drift, WS streaming assumes one active stream, SSE does not capture done/session metadata, and frontend E2E does not exercise real UI workflows.
- Completed the testing architecture deep dive using read-only inspection.
- Found that the test suite is a real architecture strength: deterministic mock-based scripts cover core turn behavior, memory privacy, tool guardrails, HTTP retry/timeout, server routes, OpenAI/OneBot bridge behavior, IM isolation, persona overlays, memory review propagation, frontend view-models, and eval quality gates.
- Found testing risks that align with earlier architecture risks: no direct tests found for PluginRegistry, provider fallback/routing, ID-RAG graph retrieval/rendering, native route auth, Vite proxy/service worker behavior, frontend token persistence, WS single-stream callback assumptions, actual browser UI workflows, or cancellation semantics.
- Found that `npm test` is broad but monolithic; the suite would benefit from named tiers and shared test utilities.
- Completed stage architecture scoring.
- Finalized current stage verdict as `good, not excellent`: product-architecture fit is strong, but composition-root concentration, package drift, local-first security assumptions, missing cancellation, frontend/dev-cache drift, and direct-test gaps prevent a higher rating.
- Kept reviewer scores at Principal Architect `4`, Runtime Reliability Engineer `3`, Memory Systems Reviewer `4`, Agent Behavior and Prompt Architect `4`, Security and Privacy Reviewer `3`, and Product Scalability Reviewer `3`.
- Separated architecture blockers before an `excellent` claim from ordinary maintainability debt.
- Completed improvement roadmap.
- Wrote a research-only roadmap that starts with ADRs and test coverage matrix, then prioritizes direct boundary tests, server/core/view composition-root splits, reliability/security hardening, package/plugin maturity, and frontend maintainability.
- Added expected score movement for each reviewer role if roadmap items are completed.
- Completed paper / presentation architecture highlights.
- Captured seven defensible architecture claims, suggested diagrams for system shape / turn pipeline / memory stack / persona stack / evidence loop, reusable talk/README phrasing, and claims to avoid.
- Marked the current research loop complete in `Next Research Questions`.
- Did not modify source code.
- Future sessions should only continue this research loop if new code changes, implementation permission, or a presentation/paper deliverable changes the goal.
