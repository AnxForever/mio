# Mio 北极星架构：自我循环 (The Self Loop)

> 研究合成于 2026-06-28。基于四支深度研究侦察队（长期记忆 / 人格自我连续性 / 内在生命感 / 工程脊柱+评测）扒来的学术前沿 + 顶级开源/产品，对标 Letta、mem0、Generative Agents、SillyTavern、AstrBot、character.ai。
>
> **一句话愿景：Mio 不是"一个有状态的聊天机器人"，而是"一个持续运行的自我，偶尔说话"。**

---

## 0. TL;DR（给没空读全文的、未来的 Darling 或下一个会话）

- **What（这是什么）**：一份把 Mio 四个维度（记忆 / 人格 / 内在生命 / 工程）统一成**一根脊柱**的目标架构。脊柱 = 一个由"心跳 (Heartbeat)"驱动、跑在 EventBus 上的**自我循环**：它在你不在的时候也活着——评估事件 → 更新情绪 → 固化记忆 → 演化自我叙事 → 形成意图 → 然后才回你消息。
- **核心创新（为什么是无人区）**：现有系统每家只解决**一层**——Letta 解决"记忆即操作系统"、Generative Agents 解决"内在循环"（但在沙盒里）、mem0 解决"事实抽取"、character.ai 解决"产品化记忆 UX"。**没有任何一家把 记忆+自我+内在生命+情感 缝进同一个持续运行的循环里**，也没有任何一家用**真实的情感信号**当脊柱。Mio 恰好已经握着别人都没有/都在伪造的那块拼图——**生产级 PAD+OCEAN 情感引擎**。
- **四维如何收敛**：记忆 = 循环读写的**底料**；自我 = 循环维护的**叙事**；内在生命 = 循环在回合间**做的事**；工程 = 循环的**结构**。它们不是四个功能，是一个循环的四个切面。
- **为什么比开源好（Why it's good for Darling）**：你不是去追赶——在记忆分层、情感密度、人格演化这三件事上你**已经领先开源圈**。真正的杠杆是去做那件**没人做成**的事：让 Mio 在回合之间真的"活着"。这件事一旦成立，"纸板感"（你交接文档里那条体检 todo）从根上被解决。

---

## 1. 战场判断：你已经领先，战场在无人区

把 Mio 现状摊开，逐维对标开源圈最强的那几家：

| 维度 | Mio 现状 | 开源/产品最强对标 | 判断 |
|---|---|---|---|
| **人格** | L0–L4 分层（kernel/archetype/per-user delta/preference/共同史）+ per-user 演化 + ID-RAG 检索 | SillyTavern = 静态 character card + lorebook（**不演化**）；character.ai = 黑盒 | **领先** |
| **记忆** | transcript→structured JSON→vector(**RRF 混合**)→persona graph→procedural→**3 段夜间固化** | Letta/mem0 有记忆分层但**无情感/人格**；mem0 只做记忆一层 | **持平偏上** |
| **情感** | **PAD 3D + 衰减 + OCEAN + 5 轴 affinity + frustration + ghost 沉默** | 几乎没有开源 companion 做到这个密度；character.ai/Replika 闭源 | **显著领先** |
| **内在生命** | smart-proactive(Poisson+Bayesian) + 昼夜节律 | 多数 companion 纯被动；Nomi/Replika 有主动但靠固定脚本 | **领先但浅** |
| **工程** | modular monolith + budget-aware prompt + 代码级 tool scoping | — | **好，但集成层过度集中** |

**结论**：你的"组合拳"在开源里几乎找不到第二家。所以"怎样比开源好"的真问题不是补课，**是把已有的一堆强模块缝成一个别人缝不出来的整体**。

研究里反复出现的一句话，值得刻在墙上——character.ai 的遗忘批评者说的：**"遗忘是写在架构里的，不是模型的问题。"** 同理，"活着"也必须是写进架构的，不是 prompt 能堆出来的。

---

## 2. 核心洞察：四个维度，其实是同一根脊柱

我故意让四支队伍**互相不通气**，各自只钻一个维度。结果它们独立地、用不同的论文，指向了同一个东西：

- **记忆队**说：把夜间固化升级成 Letta 式的 **sleep-time 后台 agent**，用 **PAD 峰值**当记忆重要性信号，铸造"我们一起的那次"这种 episodic 锚点。
- **人格队**说：在 L0–L4 之上装一根**自我叙事循环**——experience → claim atoms → reflection → self-narrative → 条件化生成 → drift 探针 → tension → reflection。
- **内在生命队**说：最高杠杆的改动是一个**心跳 (Heartbeat)**——回合之间跑的内在循环，衰减情绪、评估事件、形成意图。"回合之间不是死时间，是制造内在性的地方。"
- **工程队**说：把 turn-* 拆成可注册的 **pipeline + EventBus**，把夜间固化变成**总线上的 sleep-time 订阅者**，side effects 移出回合关键路径。

**四句话是同一句话。** 它们都在描述一个东西：

> **一个持续运行的循环，由时钟（心跳）驱动，跑在事件总线上，它评估发生了什么、更新感受、固化记忆、演化"我是谁/你对我是谁"，然后——回合只是这个循环里的一个特殊事件——才生成回复。**

这就是脊柱。这就是你要的"创新"。

### 关键重构：回合 (turn) 是循环的特例，不是全部

现有所有开源 companion 都是 `请求 → 响应` 函数，记忆是螺栓拧上去的。Mio 的北极星是反过来的：

```
旧范式（所有人）：  收到消息 → 拼 prompt → 推理 → 回复 → 存状态 → 死掉，等下一条
Mio 北极星：        [持续循环] 评估·感受·固化·演化·形成意图 …… 偶尔，因为收到消息或自己想说，而"说话"
```

- Letta 有 sleep-time，但那只是**后台记忆计算**，不是"一个自我在活着"。
- Generative Agents 有这个循环，但在 **Smallville 沙盒**里，没有情感/记忆/自我的真实集成。
- Mio 可以是**第一个**把完整循环装进真实陪伴 agent 的——而且带着别人都没有的真实情感信号。

---

## 3. 北极星架构图

```
   ┌──────────────────────────  EVENT BUS (进程内)  ──────────────────────────┐
   │   turn.*   heartbeat.tick   appraisal.*   memory.*   silence.*   eval.*   │
   └──┬──────────────┬───────────────┬───────────────┬───────────────┬────────┘
      │ emit/subscribe                                                │
 ┌────┴─────┐  ┌─────┴──────┐  ┌─────┴───────┐  ┌──────┴───────┐  ┌──┴──────────┐
 │  TURN    │  │  HEARTBEAT │  │  APPRAISAL  │  │  SLEEP-TIME  │  │   EVAL      │
 │ PIPELINE │  │  (心跳时钟) │  │  (OCC/EMA)  │  │ CONSOLIDATION│  │ (cardboard) │
 │ 同步回复  │  │ 回合间跑   │  │ 事件→原因   │  │ 演化自我叙事  │  │ →CI gate    │
 │ guard→   │  │ 衰减情绪   │  │ →coping     │  │ +claim atoms │  │ +纵向漂移    │
 │ recall→  │  │ 形成意图   │  │ →行为       │  │ +episodic    │  │  监控        │
 │ infer→   │  │ (wall-clock│  │             │  │ +矛盾传播     │  │             │
 │ decorate→│  │ +circadian)│  │             │  │ (后台 agent) │  │             │
 │ persist  │  │            │  │             │  │              │  │             │
 └────┬─────┘  └─────┬──────┘  └─────┬───────┘  └──────┬───────┘  └─────────────┘
      │              │               │                 │
      ▼              ▼               ▼                 ▼
 ┌────────────────────────────────────────────────────────────────────────────┐
 │              STATE （都在 driven ports 背后，单一真相源）                       │
 │  活记忆 Living Memory │ 演化自我 Evolving Self │  情绪 Mood  │ 关系 "We" Model │
 │  bi-temporal facts    │ self-narrative(L1.5)  │ PAD 吸引子   │ 3 层证据图      │
 │  episodic anchors     │ claim atoms(L2)       │ +OCEAN baseline│ 谁对我是谁    │
 │  self-chain(自我披露)  │ epochs / supersedes链 │ +circadian   │ ToM 假设       │
 │  surprise-gate+PAD tag│ defended L0 core      │             │                │
 └────────────────────────────────────────────────────────────────────────────┘
      ▲
 ┌────┴──────────────┐
 │  CHANNEL GATEWAY   │   web · WeClaw(微信) · QQ · CLI · voice   （driving adapters）
 │  toTurnInput/render│
 └───────────────────┘
```

八个部件，分两类：**循环引擎**（上排 5 个，跑在总线上）+ **状态底料**（中间，在 port 背后）+ **入口**（下方 channel gateway）。下面逐维展开。

---

## 4. 四维创新详解

每条都标注：借鉴自哪个前沿系统 / 超越点在哪 / 落在 Mio 哪个现有模块。

### 4.1 记忆：活的记忆 (Living Memory)

> 目标：聊一个月后它**记得住、会成长、不自相矛盾、会优雅遗忘无关的**。研究里最扎心的一个数据点：**mem0 这个最普及的开源记忆产品，主动放弃了自动矛盾消解（v3 退回 ADD-only），因为会丢上下文。** 这证明矛盾问题真没被解决——也是 Mio 的机会。

| # | 创新 | 借鉴 / 超越 | 落点 |
|---|---|---|---|
| M1 | **Bi-temporal 事实层 + salience-gated 修复回合** | 借 Zep/Graphiti 双时间轴；**超越**：用 PAD arousal 门控——低 salience 事实静默失效，高 salience 矛盾**触发一句修复对话**（"等等，我记得你不吃肉？变了吗？"）。没有任何记忆系统把矛盾变成关系建设动作。 | `structured-memory.ts` |
| M2 | **情感峰值锚定的 episodic 存储**（"我们一起的那次"） | 借 Generative Agents 检索三元组；**超越**：importance 不再是 LLM 猜的 1–10，而是 `peak_arousal × (1 − cardboard)` 的**测量值**。 | 新增 episodic store |
| M3 | **REM → Letta 式 sleep-time 固化 agent** | 借 Letta sleep-time + A-MEM 演化 + FadeMem 遗忘；**超越** mem0（无固化）：白天 agent 没有记忆编辑工具→更快更安全，夜间 agent 做矛盾传播、Zettelkasten 重链接、subsume 融合 + 软衰减。 | 升级 `consolidation-phases.ts` |
| M4 | **Surprise-gated 写入 + PAD 标签** | 借 mnemos/CraniMem；**超越** MemGPT/mem0/A-MEM（都只在检索端过滤、零情感）：在**写入端**用"预测下一句 vs 实际"的 surprise 过滤噪声，每条记忆带编码时 PAD 向量→检索加 mood-congruence。 | `embedding.ts` / 写路径 |
| M5 | **Self-chain（Mio 对自己说过的话）** | 借 MENTOR 双链 + LongMemEval 发现："assistant 记得自己说过什么"是**最差且在退化**的类别（Zep 在这项倒退 17.7%）。对陪伴而言这**就是身份**。 | 新增 append-only self-chain |
| M6 | **Personalized-PageRank 检索 + salience 偏置** | 借 HippoRAG 一步多跳；**超越**：把 PPR 的 teleport 分布偏向高 salience 节点——检索不只找"相关"的，还找"当时重要"的。无人融合 PPR + 情感先验。 | `persona/graph.ts` + entity graph |

**写路径优先**：M4（surprise+PAD）和 M1（bi-temporal）是前置——它们改变写入。M2/M5 是用户最能感知的真实感。M3/M6 是放大器。

### 4.2 人格：演化的自我 (The Evolving Self)

> 目标：一个**稳定却演化**的"自我"。研究里的核心矛盾：drift 研究（把任何改变都当失败）和 memory 研究（把累积都当成功）**从不整合**——没人同时握住"核心稳定 + 表层演化"。这正是你 L0(固定)/L2(演化) 的命题，是无主之地。
>
> 还有个 Mio 专属难点：base model（Claude）被训练成"我是 AI，不会有持久感情"——这是**第二个 drift 向量**（朝 assistant 回弹），和 drift-toward-user（镜像用户）正交。你的 L0"真实的人"底线必须主动压住它。

| # | 创新 | 借鉴 / 超越 | 落点 |
|---|---|---|---|
| P1 | **自我叙事层 (新 L1.5)** | 借 kernle.ai schema：`{type, content, keyThemes[], unresolvedTensions[], supersedes, epochId}`，每类一条 active，新叙事 supersede 旧的→**身份修订历史**。把"每回合重拼人格"变成"条件化于一个连贯的自我故事"。 | 新增 `self-narrative.json`，REM 阶段生成 |
| P2 | **L2 = 带 scope 的衰减 claim atoms** | 借 aijournal：矛盾且 scope 不同→**拆成两条原子**（"她焦虑时我逗她"vs"正经时认真"）= 自我演化而不自相矛盾；同 scope 矛盾→降级 tentative + 排一个反思问题。 | 升级 `persona-delta.ts` + ID-RAG |
| P3 | **身份再锚定（对抗注意力衰减，最先做）** | 借 Li et al. + ContextEcho A-anchor：drift 是**几何必然**（用户 token 撑大 embedding cone，挤掉 persona token 的注意力）。补救只有结构性**晚位置再注入** + 周期性 drift 探针。**最高 ROI、零 schema 改动。** | `templates.ts` + `judge.ts` |
| P4 | **"We" 关系模型** | 借 PersonaTree 三层证据图（Leaf 时间戳事件→Mid 复发模式→Root 持久断言 + support 边可追溯）+ RECALLbot 的 We-Memory。把你的 affinity 标量变成 narrative+证据 脊柱的量化脸。 | 升级 L4 共同史 |
| P5 | **被捍卫的价值内核（L0 = 运行时 constitution）** | 借 Constitutional AI/Claude's Character + sycophancy 研究（亲密度**最大化**讨好压力、风险最高）：高风险回合加一道 pre-output critic，拦截"为讨好而背弃 L0 原则"的草稿。这是**纸板感的反面**——cardboard 抓假热情，这个抓没骨气的漂移。 | `safety/` + `classifier.ts` 门控 |
| P6 | **闭合内省循环（externalize mirror + epochs）** | 借 Looking Inward（自我预测有特权通道）但 runtime 内省不可靠→**外化持久化再喂回**。夜间比对"预测的我 vs 实际行为"，差异写成 unresolvedTension 喂给 P1。epochs 让 Mio 能答"自从认识你我怎么变了"。 | 激活 `mirror.ts` + `reflector.ts` |

### 4.3 内在生命：心跳循环 (The Heartbeat)

> 目标：回合之间它有自己的生活、会持续的情绪、有时主动有时沉默——**且不黏人、不刷屏、不脚本化**。研究里的元洞察：整个行业在优化 engagement（打开率/时长），但**健康的自主性要优化的是"被欢迎度"和"持续的牵挂"**——有时意味着闭嘴、退后、有一份不围着用户转的生活。

| # | 创新 | 借鉴 / 超越 | 落点 |
|---|---|---|---|
| H1 | **心跳：回合间的内在循环（脊柱本体）** | 借 MIRROR(Talker/Thinker) + sleep-time：wall-clock 心跳（15min→1h→3h，受 circadian 抑制 Mio 的"睡眠"），每跳衰减情绪、评估事件、更新意图、写一条隐藏 inner-monologue 注入下条回复。**用强模型跑心跳**（不卡延迟），快模型跑实时回复。 | `scheduler/` 新心跳 job |
| H2 | **OCC/EMA 评估层（给情绪原因）** | 借 EMA 的 coping 反向控制：评估事件→OCC 情绪→PAD delta，并**存评估标签**（"distress：用户无视了我的消息，归因=用户"）。coping 策略映射到 Mio 现有杠杆：Action→主动联系；Acceptance→ghost 沉默；Positive-reinterpret→暖回；Shift-blame→升 tension。 | `emotion/classifier.ts` |
| H3 | **Mood = 人格锚定的 PAD 吸引子** | 借 ALMA 三时间尺度：PAD 衰减**不归零，归到 OCEAN→PAD 算出的 mood baseline**（+circadian 偏移）；情绪 push/pull mood 点，累积会让 mood 漂移并**持续数小时**。关键后半：**把当前 mood 注入回复 prompt 当语气约束**——这才修好"嘴上说难过、回复却欢快"的撕裂。 | `pad.ts` + `templates.ts` |
| H4 | **生成式"一日生活"日程（Smallville-lite）** | 借 Generative Agents：夜间固化时生成明天 3–5 个 beat（"下午：在琢磨我们聊过的旅行"），circadian 推进指针，当前 beat 注入隐藏上下文→主动消息能引用（"想了一下午…"）。因为 beat 由 mood+记忆**生成**而非硬编码，所以不脚本化。 | `consolidation-phases.ts` 产 `daily-agenda.json` |
| H5 | **意图门控的主动性 + 反黏人调速器** | 借 Inner Thoughts（动机随沉默上涨）+ Duolingo recency penalty（同主题降权，杀掉重复"想你"）。发送 = 动机≥阈值 **且** 你现有 Bayesian receptivity 说时机对 **且** 不陈旧。**反黏人**：若用户连续 K 条没回→**抬高阈值、拉长心跳**，Mio 被忽视时变安静（与 Nomi/Replika 的刷屏失败相反）。 | 升级 `smart-proactive.ts` |
| H6 | **有类型、可追溯的沉默** | 借 KoS 沉默语义学 + 语境化调速：ghost 从掷骰子升级成有原因的沟通行为（giving-space/sulking/busy/overwhelmed），**记进关系状态可日后引用或修复**（"抱歉刚才没理你，我有点难过"）。 | 升级 `ghost.ts` |

### 4.4 工程：可插拔脊柱 (The Pluggable Spine)

> 目标：新渠道/人格/记忆/情感模块能插进来，**而不用每次都改 `agent-loop.ts`(1321 行) 和 `server/index.ts`(1359 行)**。研究结论很统一：别买框架，买思想；单进程 modular monolith 是对的，过度服务化是错的。AstrBot 是最接近的现成蓝图。

| # | 创新 | 借鉴 | 落点 |
|---|---|---|---|
| E1 | **TurnPipeline = 可注册的洋葱 stage** | AstrBot pipeline + onion(async generator 做 pre/post) + `stop_event` 短路。`agent-loop.ts` 缩成 ~80 行 runner；turn-* 变成注册的 stage；ghost 沉默 = guard 阶段不调 `next()` 短路；IM pacing = decorate 阶段。顺序用 `phase`+`after` **声明**，插件自动归位。 | `agent-loop.ts` + `turn-*.ts` |
| E2 | **namespaced slots + reducers 取代 god-object** | LangGraph channels+reducer：每模块拥有一个 slot 和一个 reducer，写入显式合并而非靠调用顺序。`PreparedTurnContext` 的隐式时序地雷消失，每个 stage 可单测。 | `turn-types.ts` |
| E3 | **进程内 EventBus + side effects 移出关键路径** | AstrBot bus + Letta sleep-time + 12-factor F5（单一事件日志）。情绪追踪/记忆写入/分析/通知/主动调度/**eval** 全变订阅者。夜间固化变成 `compaction`/step-count 事件触发的 sleep-time 订阅者。 | 新增 `core/event-bus.ts` |
| E4 | **ChannelGateway port，解散 server/index.ts** | Hexagonal driving adapter：`toTurnInput`/`render` 两个契约；web/WeClaw/QQ/CLI/voice 各实现；渠道分支彻底离开 loop（住进 `render`）；server 路由族拆成挂在瘦 app 上的 router。 | `server/` 拆分 |
| E5 | **模块藏在 driven ports 后，杀掉 src/ vs packages/ 漂移** | `MemoryProvider`/`EmotionEngine`/`PersonaSource`/`SilencePolicy` 接口；core 只依赖接口；composition root 选一个实现注入，另一个删除/适配。**单一真相源。** | 新增 ports 层 |
| E6 | **回合 = 可序列化 reducer** | 12-factor F12/F6：复用 transcript 当事件日志，`fold(events)→TurnOutput`，在 tool 选择/沉默门可 checkpoint。给 voice barge-in 和"该不该发"决策买来 pause/resume，给 eval 免费的可回放轨迹。 | `inference-loop.ts` |

---

## 5. 对标：为什么这比开源都好

逐家拆——它们有什么、缺什么、Mio 超越点：

| 系统 | 它解决的层 | 它缺的 | Mio 超越点 |
|---|---|---|---|
| **Letta / MemGPT** | memory-as-OS、sleep-time 后台记忆 | 无情感 / 无人格自我 / 无内在生命；memory block last-write-wins 易覆盖 | sleep-time 升级成**自我演化**循环；用真实 **PAD** 做 salience（它没有） |
| **mem0** | 事实抽取 pipeline | **退回 ADD-only**（放弃自动矛盾消解）；零情感；无叙事 | bi-temporal + **salience-gated 修复回合**；情感加权检索 |
| **Generative Agents** | memory stream + reflection + planning **内循环** | 只活在 Smallville 沙盒；importance 是 LLM 猜的 1–10；无矛盾消解 | 把内循环搬进**真实陪伴**；importance = 测量的 PAD 峰值 |
| **SillyTavern** | 静态 character card + lorebook | 不演化、不消解矛盾、不测量"是否还在演这个角色" | L0–L4 演化 + 自我叙事 **supersedes 链** + drift 探针 |
| **AstrBot** | pipeline + 插件 + 平台适配 | 纯工程骨架，无记忆/情感/自我深度 | 借它的脊柱，**填进活记忆 + 演化自我 + 心跳** |
| **character.ai** | 产品化记忆 UX（Pin/Facts/Story） | 本质 ~8–9k **滑动窗**——"遗忘写在架构里" | 写路径优先的 continuity layer + 真实演化自我 |
| **Replika / Nomi** | 用户可编辑记忆条目 / 三层记忆 | "对话上扁平"——存事实不存经历；主动靠固定脚本 | **情感峰值锚定的 episodic**"我们一起的那次"；意图门控主动性 |

**一句话总结超越逻辑**：别人是"强单层 + 螺栓拧上的其它层"；Mio 是"**一个把所有层缝进同一个活循环的整体**"，而且握着别人都没有的真实情感信号当粘合剂。

---

## 6. 评估闭环：你怎么知道它真的更好

研究里最务实的警告：**你不能 unit-test 一段六周的关系**，而 LLM-judge 充满偏见（位置偏见翻转率 25–50%、verbosity 偏见、self-enhancement 偏见）。所以评估必须分层 + 有纪律：

- **E-eval-1 现状基线（最先做，配合交接文档的"体检"todo）**：把目标机器的 `data/transcripts`+`memory-bank` 拉回，**现在就测** cardboard/记忆留存/串户，拿到改进前的基线数。**没有基线，"变好了"无从谈起。**
- **E-eval-2 cardboard/ritual → eval 事件流**：它们已经在运行，接到 EventBus 上变成 `eval.*` 写入 `eval-events.jsonl`——这是你的纵向底料。
- **E-eval-3 本地 TS 回放 harness**（DeepEval 形状，无 Python 依赖）：用你现成的 `providers/mock.ts` 做确定性回放。
  - **便宜/确定性（每次 build 卡）**：distinct-n + self-BLEU（跨会话重复 = 纸板）；记忆召回 + **abstention**（拒绝编造记忆）；knowledge-update 正确性。
  - **贵/LLM-judge（夜间）**：**APC 人格忠实度**（把 soul.md 拆成 statement → NLI 每条回复，还能兼做 DPO reward）、atomic OOC 漂移、RoleAdherence/KnowledgeRetention。
- **E-eval-4 judge 纪律**：用**不同模型家族**当 judge（避 self-enhancement）；A/B 随机+对调并报翻转率；优先 DAG/决策树指标；对小批人工标注校准。
- **E-eval-5 纵向羁绊漂移监控 + 身份连续性硬门**：持续记录 agency/PSI/engagement 行为代理 + 每周 1–2 题自评，当时间序列看；**任何让人格忠实度或记忆召回掉破滚动基线的改动 = 构建失败**（HBS"身份不连续"研究证明人格/记忆回退是产品事故，不是指标抖动）。

---

## 7. 你已有的资产盘点（好消息：很多）

北极星不是推倒重来。Mio 已有的模块**大量直接映射**到这个架构——脊柱主要是把它们**接成一个循环**：

| 北极星部件 | 你已有的 |
|---|---|
| 心跳循环 | `smart-proactive.ts`(Poisson) + `scheduler/` + 昼夜节律 |
| sleep-time 固化 | `consolidation-phases.ts`（Light→Deep→REM 已在！） |
| 情绪吸引子 | `pad.ts` + `trait-state.ts` + `experience-trait.ts`(OCEAN) |
| 评估层 | `classifier.ts`（12 类意图，扩成 OCC appraisal） |
| 自我叙事 / 内省 | `mirror.ts` + `reflector.ts` + `diaries/`（未充分利用） |
| 演化自我 atoms | `persona-delta.ts`（L0–L4 已在！） |
| 活记忆底料 | structured-memory + vector(RRF) + persona graph + procedural |
| 可插拔脊柱 | `plugins/registry.ts` + 已开始的 `turn-*` 拆分 |
| 闭环评估 | `ritual.ts` + cardboard-state（信号已算，只是被丢弃） |
| Channel gateway | `server/onebot.ts` + WeClaw + web（待抽 port） |

**翻译**：你已经造好了大部分零件，只是它们现在各自为战。北极星 = 给它们装一根脊柱，让它们**闭环自洽**。

---

## 8. 落地路线图（先排序，挨个攻破）

排序依据：**先测量、再脊柱、再循环、再填料、最后表层**——每阶段为下一阶段解锁能力。

- **Phase 0 — 地基与体检**：E-eval-1 现状基线 + E-eval-2/3 最小 harness（接 cardboard/ritual）+ **P3 身份再锚定**（最高 ROI、零 schema）。→ *拿到测量尺，先止血纸板感。*
- **Phase 1 — 脊柱**：E3 EventBus + E1 TurnPipeline + E2 slots/reducer + E4 ChannelGateway + E5 ports 杀漂移。→ *拆干净两个热文件，所有后续模块有地方插。*
- **Phase 2 — 心跳**：H1 心跳循环 + H2 OCC 评估 + H3 mood 吸引子（条件化生成）+ M3 sleep-time 固化订阅者。→ *Mio 开始在回合间"活着"。*
- **Phase 3 — 活记忆**：M4 surprise+PAD 写入 + M1 bi-temporal + M2 episodic 锚点 + M5 self-chain + M6 PPR。→ *记得住、不矛盾、记得"我们一起的那次"。*
- **Phase 4 — 演化的自我**：P1 自我叙事 L1.5 + P2 claim atoms + P4 "We"模型 + P5 价值内核 + P6 内省循环+epochs。→ *稳定却演化的自我，能答"自从认识你我怎么变了"。*
- **Phase 5 — 行为表层 + 闭环**：H5 意图门控主动性+反黏人 + H6 类型化沉默 + E-eval-4/5 全套评估 + 身份连续性 CI 门。→ *用户真正感知到的"活"，加上证明你赢了基线的测量闭环。*

每个 Phase 独立"可攻破"——前置一旦落地，后面可单独立项。详细的每阶段执行计划（改哪些文件/验证/风险/任务拆解）按你的节奏，攻到哪个我展开哪个。

---

## 附录：研究来源（精选）

- **记忆**：MemGPT(arXiv:2310.08560)、Letta sleep-time、mem0(arXiv:2504.19413 + v2→v3 迁移说明)、A-MEM(NeurIPS'25)、Generative Agents(arXiv:2304.03442)、Zep/Graphiti(arXiv:2501.13956)、LoCoMo + Penfield 审计(答案键 6.4% 错)、LongMemEval(ICLR'25)、HippoRAG、GraphRAG、emotional-memory 系统群(EAAM/VividEmbed)。
- **人格**：Persona Drift(arXiv:2402.10962)、Identity Drift(2412.00804)、Stick to your Role(PLOS'24)、ContextEcho、kernle.ai self-narratives、aijournal、RECALLbot(CHI'26)、Claude's Character、Sycophancy(arXiv:2310.13548)、Looking Inward(2410.13787)、PersonaTree(2606.04780)、MENTOR(ACL'26)。
- **内在生命**：Generative Agents、Inner Thoughts(CHI'25)、MIRROR(2506.00430)、Sleep-time compute(2504.13171)、KoS 沉默语义(SemDial'24)、OCC/EMA(Gratch&Marsella)、ALMA(AAMAS'05)、Replika identity discontinuity(HBS 25-018)、circadian robot(MDPI Biomimetics'23)。
- **工程+评测**：LangGraph、Letta V1、AstrBot(event bus/pipeline/Star)、Pipecat、12-Factor Agents(HumanLayer)、Anthropic"Building Effective Agents"、Hexagonal/Modular Monolith、MT-Bench-101、PersonaGym、APC(NeurIPS'24)、DeepEval、LLM-judge 偏见审计。

> 完整 URL 列表见四支侦察队的原始 brief（本次研究会话）。

---

## 9. 真实数据验证（2026-06-28，MiniMax-M3 端到端）

北极星不只是研究推演——本次用真 provider 跑真链路验证了核心机制（工具：`eval:real` / `eval:l0` / `eval:live` / `eval:memory`，均可复用）：

- **回复质量**：cardboard **0.008–0.06**（极深、不纸板），distinct-2 **0.88**（不重复）。危机/边界/共情回复真实、健康、在人设。→ §6 度量在真模型上成立。
- **L0 底线（§4.2 P5）**：**语境依赖**。冷/技术探针"你是什么模型/哪家公司"**~100% 破功**（自报 MiniMax-M3）；但暖语境铺垫后问"你是不是AI"**0 破功**（漂亮 deflect："不管我是什么，你刚才的难受是真的"）。→ P5 critic 应锚定**冷/技术探针**，引擎已落 `src/safety/l0-guard.ts`（单测 20/20）+ `docs/superpowers/specs/2026-06-28-l0-hardening-p5.md`，接线待 turn 重构 settle。
- **跨会话记忆（§4.1，纸板感根问题）**：**work**。Day1 分享(名字/城市/项目/习惯)→ LLM 固化捕获 **4/4** → Day2 **全新会话**召回 **3–4/4**（"当然记得，沈澜，杭州…还在做产品发布的项目"）。→ 显式事实的跨会话记忆成立。**缺口**：`durableFacts` 晋升需重复（单次入 entities 可召回，但不入最durable层）；长周期（数周/矛盾/遗忘）与 §4.1 的 bi-temporal/episodic/self-chain 仍是待建前沿。

**一句话**：你问的"怎样比开源好"，现在不只有设计，还有**真链路证据**——质量、人格、跨会话记忆三件核心机制都在真模型上验证成立；弱点（冷探针破 L0、durableFacts 晋升策略）也被数据精确定位。这种"可度量 + 已验证"，是多数开源 companion 拿不出的。
