# AstrBot × Mio 技术借鉴方案

- 日期：2026-06-27
- 状态：研究/路线图（未动代码）
- 目的：分析 `/mnt/d/AstrBot`（生产级多平台 LLM bot 框架）的技术，对照 Mio，沉淀可落地的借鉴清单。
- 行号说明：AstrBot 锚点为分析时实测；Mio 锚点供参考（codex 并发改动中，以实际为准）。

---

## 1. 定位对比

| | AstrBot | Mio |
|---|---|---|
| 定位 | **多平台多用户** bot 平台（接入万千 IM、服务海量会话） | **单用户深度**情感陪伴 agent（一个人的情商与人格） |
| 语言 | Python 3.10+ | TypeScript / Node ESM |
| 强项 | 基础设施：会话隔离、平台适配、插件市场、知识库 | 情感内核：PAD 情绪、分层人格、关系演化 |

**结论：互补。抄 AstrBot 的地基，不必抄它的体量。**

## 2. 技术栈对比

| 维度 | AstrBot | Mio | 评判 |
|---|---|---|---|
| 会话隔离 | UMO 单一 key 贯穿全栈 + 通用 KV 分区表 | 裸 sessionId + 全局单文件 state | AstrBot 碾压 |
| 并发安全 | per-会话异步锁（同会话串行/跨会话并行） | 无锁（丢更新隐患，见 §4） | AstrBot |
| 多平台 | 装饰器注册 + 统一消息链 + `send_by_session` | onebot/openai 各搞一套（codex 在做） | AstrBot |
| 消息处理 | 洋葱式 pipeline 责任链 | 单体 agent-loop（已分阶段 helper） | 看场景 |
| 检索 | dense+sparse **RRF 融合** + rerank | dense/sparse **二选一**，无融合 | AstrBot |
| 文档知识库 | 完整 RAG（多格式/分块/混检） | 无 | AstrBot |
| 上下文压缩 | token 预算 + 回合感知 + 回退阶梯 | 固定"留 3+10 条" | AstrBot 更稳 |
| 人格 | DB 多人格库 + 三级解析 + 工具白名单 | soul.md + 分层 L0–L4 + PAD | **Mio 更深** |
| 情感引擎 | 无 | PAD/affinity/ghost/关系阶段 | **Mio 独有** |

## 3. 会话隔离（重点）

### AstrBot 的方案：UMO 单一字符串 key

- **`unified_msg_origin` (UMO)** = `平台id:会话类型:会话id`（`astrbot/core/platform/message_session.py:7-27`）。`from_str` 用 `split(":", 2)` 让 session_id 自身可含冒号。
- 一个 UMO **同时充当**：DB 行键、KV 分区键、锁键、缓存键、**主动推送目标**。新增隔离维度只改 key 生成处一点。
- 群/私聊靠中段 `message_type` 区分；跨平台 `platform_id` 不同 → 天然隔离。
- **通用 KV 表** `preferences(scope, scope_id, key, value)` + `UNIQUE(scope, scope_id, key)`（`db/po.py:199-223` + `utils/shared_preferences.py:144-159`）：per-会话的 provider/persona/插件开关全塞一张表，**加新状态永不改 schema**。`scope ∈ {global, umo, plugin}`。
- **会话(session) vs 对话(conversation) 分离**（`conversation_mgr.py:78-174`）：一个 UMO 多个对话、活动指针 `sel_conv_id`、persona 挂对话上（`conversations.persona_id`），切对话即切人格。
- **per-key 锁 + 引用计数自清理**（`utils/session_lock.py:8-53`，应用点 `pipeline/process_stage/method/agent_sub_stages/internal.py:215`）：锁**包住整个 turn**，同会话串行、跨会话并行，计数归零删锁条目防泄漏。
- **级联清理回调**（`conversation_mgr.py:28-58` `register_on_session_deleted`）：删会话时各模块清自己的下游数据。
- 多轮等待 `session_waiter.py`（Future+Event+timeout+`SessionFilter`）。

### Mio 落地方案（接上既有 P1 待办）

1. **统一隔离 key**：新建 `src/identity.ts` 定义 `UserKey = platform:channelType:userId`（web 即 `web:dm:<userId>`），单一派生函数，`split(":", 2)` 风格解析。
2. **per-user 分区**（二选一）：
   - 文件路线（churn 最小）：扩展 `src/memory/paths.ts`，每个 state 路径接 `userKey` → 落 `data/users/<userKey>/`。**emotion/relationship/affinity/pad/structured-memory 全迁入，昵称/共同史这些残留全局项务必一并迁**。
   - KV 路线（结构最优）：复用已有 `src/memory/sqlite-vector.ts` 的 SQLite，建 `state(scope, scope_id, key, value, UNIQUE(...))` 表 + `sessionGet/sessionPut/globalGet` 包装。
3. **每会话锁**：`Map<userKey, Mutex>`，turn 入口 `await lock(userKey)` 包整轮，引用计数归零即删。几十行、无新依赖。
4. （可选）session/conversation 解耦 + 级联清理回调。

> ⚠️ **与 codex 重叠**：codex 正在并发推进 IM-bridge/per-user（已加 `paths.ts` 的 `usersDir/userDir`、把 persona-delta/preferences 改成 sessionId 键控）。会话隔离落地前**必须先核实 codex 改到哪、确认分工时序**，避免互相覆盖。

## 4. ⚠️ Mio 现存并发隐患（顺带发现）

`src/core/agent-loop.ts` 的 turn 对 state 是「**读 → await 推理 → 改 → 写**」。Node 单线程，但 `await` 让两个**同用户并发请求交错** → 互相覆盖 emotion/relationship/transcript（**丢更新**）。单用户慢聊不易触发，**codex 的 IM-bridge 多平台上线后会真实发生**。每会话锁（§3.3）不只是借鉴，是**修 bug**。

## 5. 借鉴清单（按性价比）

### 🟢 立即高性价比（独立、不撞 codex）

**B1. RRF 混合检索** — 半天，立即提升召回
- AstrBot：dense(FAISS)+sparse(BM25) 各自排名 → RRF 融合 `score=Σ1/(60+rank)`（`knowledge_base/retrieval/rank_fusion.py:45`）→ 可选 rerank。
- Mio：已有 dense(sqlite-vec)+sparse(tf) 但**二选一**（`src/memory/vector.ts`）。移植 RRF 纯函数 `fuse()`，融合两路。**不仅用于未来 KB，直接提升现有 memory/lorebook 召回。**

**B2. 文档知识库 RAG** — 补能力空白，约 1–2 天
- AstrBot：多格式 parser（pdf/epub/md/url）+ 递归分块（`chunking/recursive.py:6`，按 `\n\n→\n→。→…` 优先级递归切+overlap）+ 混检 + 双模式注入（auto-inject vs agentic tool，`astr_main_agent.py:264`）。
- Mio：新建 `src/memory/knowledge-base/`，复用 `sqlite-vector.ts` 做 dense，移植递归分块器(~100 行)。情感陪伴可装用户日记/喜好文档，让 Mio"记得"长文事实。先做 text/md。

### 🟡 中期（会话隔离一揽子，见 §3，和 codex 高度重叠 — 需协调）

UMO + per-user 分区 + 每会话锁 + 级联清理。直接解点名需求 + 修 §4 隐患。

### 🟢 小而美（挑零件抄，各几十行）

- **C1 压缩升级**（`src/memory/compression.ts`）：留固定条数 → token 预算+回合感知（留整轮、最新 user 轮必留）；触发用 token 占比阈值(0.82)；摘要失败→二分截断兜底；摘要用独立便宜 provider。范本 `agent/context/compressor.py:115-176`。
- **C2 provider modality 门控**：per-provider 标 `modalities`，调用前 sanitize，别把图发给纯文本模型（`tool_loop_agent_runner.py:578-604`）。
- **C3 agent 工具循环护栏**：max-step 后强制总结作答（`tool_loop_agent_runner.py:946`）、同名工具连调 streak 递进警告(`:660`)、超大 tool 输出 spill-to-disk(`:391`)。
- **C4 per-persona 工具白名单**（`db/po.py:149-152`）：按人格/关系阶段 gate 工具。
- **C5 begin_dialogs few-shot 定调**（`persona_mgr.py:380-398`）：预设 user/assistant 对话对锚定语气，比纯 prompt 描述更稳；标记不落库。
- **C6 平台适配抽象**（救 codex 的 IM-bridge）：UMO + `sendBySession(umo, chain)`（解锁跨平台主动推送，Mio proactive 现在只能落 web）+ 归一入站/出站消息链 + `PlatformAdapter` registry。范本 `platform/platform.py:134`、`astrbot_message.py:50`、`platform/register.py:11`。**建议交给正在做 IM-bridge 的 codex。**
- **C7 runTurn 前置 guard 链**：把 crisis/ghost/(未来 whitelist/rate-limit) 表达成有序声明式 guard 列表 `(ctx)=>Stop|Continue`，可单测可扩展。**注意：不要全量抄 9 段 pipeline ABC**（单用户陪伴付不起抽象税）。
- **C8 proactive 泛化为定时 agent 任务**：AstrBot `active_agent` cron 定时唤醒完整 agent 跑工具+投递会话（`cron/manager.py:256,367-390`）。Mio 把 nightly cron 泛化即可支持"每早总结昨天/周末回顾"等智能主动行为，胜过模板消息。

### 🔴 不建议抄（单用户陪伴付不起抽象税）

插件市场化/热重载/依赖自治、全量 9 段 pipeline ABC、DB 化人格库（Mio 的 soul.md 可 git 追踪是刻意设计）。

## 6. 推荐路线

1. **先做 B1（RRF）** — 半天快赢、不撞 codex、立即见效。
2. **B2（文档知识库）** — 补能力空白，独立可做。
3. **会话隔离（§3）** — 最该做但和 codex 重叠，先协调分工再动。其中 C6（平台适配）建议直接交给 codex 的 IM-bridge 线。
4. C1/C2/C3 等小零件随手穿插。

## 7. 附：AstrBot 关键文件索引

- 会话隔离：`platform/message_session.py`、`conversation_mgr.py`、`utils/session_lock.py`、`utils/session_waiter.py`、`db/po.py:199`(KV 表)、`utils/shared_preferences.py`
- 架构：`pipeline/stage.py`、`pipeline/stage_order.py`、`pipeline/scheduler.py`、`platform/platform.py`、`platform/astr_message_event.py`、`provider/provider.py`、`agent/runners/tool_loop_agent_runner.py`
- 功能：`persona_mgr.py`、`knowledge_base/`（`chunking/recursive.py`、`retrieval/rank_fusion.py`、`retrieval/manager.py`）、`agent/context/compressor.py`、`star/star_manager.py`、`cron/manager.py`

---

## 8. 实施进度（2026-06-27）

### ✅ 已复刻完成（落在 codex 未触碰的 memory/providers 区，零撞车）
- **RRF 混合检索** `95c0e4d` — `vector.ts` rrfFuse + fuseDenseWithKeyword + search source 过滤（8 测试）
- **知识库 RAG** `e87abbb`/`4044d8a`/`ba79557` — 递归分块 + 摄入/检索引擎 + `recall_knowledge` 工具 + `scripts/kb-ingest.ts`（17 测试）
- **压缩升级** `b05e38a` — 回合感知 token 预算保留 + 二分截断兜底（8 测试）
- **modality 门控** `909307c` — 接通 `supportsVision`，纯文本模型自动把图片转文本占位（4 测试）

37 个新测试全绿、typecheck 干净。

### ⏳ 接入待办（卡 codex 占用 tool-runtime/package.json，待空窗一行接入）
- `src/core/tool-runtime.ts` 加 `registerKnowledgeTools(reg)` — 让 `recall_knowledge`/`knowledge_stats` 对 agent 可见
- `package.json` test 链补：`unit-rrf-fusion` / `unit-knowledge-base` / `unit-compression` / `unit-modality`

### 🟡 剩余借鉴项（落点 = codex 主导方向，建议交 codex 或待协调）
- **C5 begin_dialogs**（types+persona-delta）、**C4 per-persona 工具白名单**（types+persona-delta+tool-runtime）
- **C3 工具循环护栏 / 会话隔离 / 平台适配 C6 / proactive 泛化 C8** — 落 agent-loop/tool-runtime/proactive
- 这些恰是 codex 正在改的 per-user/IM-bridge 方向，应交它统一推进，避免撞车。
