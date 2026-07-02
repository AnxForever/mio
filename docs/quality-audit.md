# Mio 质量审计与改进计划

> 日期:2026-06-29 · 基于逐功能域代码深挖 + 学术/商业基准对照
> 方法:读每个模块实现(机制/亮点/弱点/完成度),对照 MemGPT、Generative Agents、PAD 情感模型,以及 Replika/Character.AI 的真实能力数据。

## 评分总览

| 功能域 | 评分 | 一句话 |
|--------|------|--------|
| 核心循环 (core) | 良好(偏优秀) | Turn 流水线编排教科书级,质量门禁 eval 驱动 |
| Provider 层 | 良好 | 抽象干净、HTTP 层生产级,但 Fallback/Router 是死代码 |
| 人格系统 (persona) | 良好 | L0 防御纵深完整、角色卡优质,但 ID-RAG 名不副实 |
| 记忆系统 (memory) | 良好 | 检索+矛盾消解优秀,但"95%保留率"无依据 |
| 情感引擎 (emotion) | 良好(偏下沿) | 理论视野好,但数值拍脑袋 + 真实 bug + 架构冗余 |

**最值得做的改进**(高投入产出比,能显著提升真实质量):
1. 把 ID-RAG 检索换成真向量召回(最大水分)
2. 接线 Fallback 故障转移 + 模型路由器(共 455 行死代码)
3. 修情感引擎真实 bug(invalidatePADCache 死代码、affinity 按次衰减)
4. 补记忆抽取保留率 eval(撕掉"95%"营销注释)

---

## 一、核心循环 (core/) — 良好(偏优秀)

### 亮点(接近生产级)
- **Turn 流水线**(`agent-loop.ts:997` runTurn):5 阶段(prepare→早退→推理→门禁→副作用),`PreparedTurnContext` 显式数据载体,orchestrator 只协调不干活。
- **回复质量门禁**(`reply-quality-gate.ts`):两段式分层——确定性 fail(漏身份/编造)正则直接重写省 token,灰区才调 LLM judge(temp:0,300token)。完整 trace 落盘可追溯。eval 驱动设计。
- **L0 扣流守卫**(`agent-loop.ts:951`):身份试探回合临时把 `onToken` 替换成 no-op 扣流,破功才重生成并补发,保流式体验。
- **ContextEngine**(`prompt/context-engine.ts`):30+ section 懒加载,硬上限降级路径(先留 critical 全量,high 按 size 削)。
- **隔离彻底**:IM 联系人在 prompt/工具/记忆三层全隔离,修复了跨用户串户漏洞。
- **全链 best-effort 容错**:每个副作用 try/catch,"never break the turn"。

### 弱点
- `agent-loop.ts` 1108 行偏大:其中 prompt 装配(`registerPromptSections` 等 360 行)可外移到 `core/prompt-assembly.ts`。
- 全局可变状态泄漏:`turnCounter`、`_evalResult`、`_lastBookmarkMtime` 模块级,多用户/多 channel 并发会互相干扰(单用户无碍)。
- `contextualPersonaRepairFallback`(`reply-quality-gate.ts:393`)定义却未调用——死代码。
- persona fragment 在一回合内被算多次(condition 一次、assemble 一次)。

---

## 二、Provider 层 — 良好

### 亮点
- **HTTP 层**(`http.ts`):全项目质量最高的代码。AbortController 超时 + 指数退避重试(只重试 429/5xx)+ 正确区分 caller-cancel 和 timeout + undici ProxyAgent 代理 + 连接释放。生产级韧性。
- **9 Provider 抽象干净**:`OpenAICompatibleProvider` 一个类吃 9 家,靠 `ProviderPresetConfig` 差异化;`stripUnsupportedModality` 处理视觉能力门控;`<think>` 过滤处理 R1/M3 思考链。quirk 都写进文件头注释。
- **Anthropic 原生 SSE**:content_block 状态机正确处理乱序/分块,工具 input_json_delta 累积后才解析。

### 弱点
- ⚠️ **FallbackChainProvider 默认不启用(死代码)**:`selectProvider` 默认 `enableFallback: false`,全仓 `enableFallback: true` 零命中。338 行完善的故障转移代码生产路径从不调用。
- ⚠️ **routeTask 多模型路由器完全未接线(死代码)**:Grep 全 src(排除 router.ts)零调用。117 行 chat/classify/summarize/reflect/embed 路由逻辑是预留功能。
- LoRA provider 半成品(chat/chatStream 已实现但未接路由决策)。
- 两份 SSE 解析重复(anthropic / openai-compatible 各写一份)。
- provider 不回收真实 token 用量,预算只能靠 prompt 侧估算。

---

## 三、人格系统 (persona/) — 良好

### 亮点
- **L0 身份防御四层纵深**:纯 prompt(KERNEL)→ 重生成闸(l0-guard)→ critic 确定性重写 → LLM judge。`detectL0Break` 在运行时和 `eval/l0-probe.ts` 共用同一正则,基准与防线一致。工程化程度在情感陪伴产品里属上乘。
- **6 内置角色卡**(`factory.ts` + soul.md):完整 backstory/lifeTrajectory/relationshipProfile/exampleDialogues,带 creatorNotes/characterVersion/source 分级。**整个系统内容质量最高的部分**,真人测试级。
- **Voice Presets 装人味**:核心是 few-shot(6 条真聊天范例)+ 五大 AI 破绽负面清单。show-don't-tell,对齐当前 LLM 人格塑造最佳实践。
- **Own-Life**:按时段注入抽象活动状态,明确禁止编造线下经历,与 critic 防幻觉规则呼应。
- **directive-capture 会话隔离**:修复了跨用户串户真实漏洞,isolated session 下绝不写全局。

### 弱点
- ⚠️ **ID-RAG 是最大水分**(`graph.ts`):检索是纯关键词子串匹配 + 封闭触发词表(约30个 tag),无 embedding/语义相似度,**严格说不算 RAG**。对个性化细节(速写本/数位板/冷掉的茶)几乎召回不到。声称的"1500→800 token 节省"存疑(Phase1 永远纳入 core trait+voice+boundary 可能占满预算)。
  > **已修复(P1-5)**:检索评分升级为 `max(triggerScore, semanticScore)`,叠加离线 TF 余弦召回(复用现有 tokenize 中文 bigram + cosine,零网络开销)。现在 query 用同义词/相关词也能召回 trigger 里没有该词的节点(如"画画"→"数位板/插画")。补了 9 项单测验证语义召回生效。
- **Critic 100% 硬编码正则**:7 维全正则+except子句,可绕过(换种说法就漏检),中文语义漂移会让规则失效。靠 LLM judge 补语义盲区。
- **状态管理分散**:driver / own-life / dual-mode 三处都在管"此刻的 Mio",职责重叠、潜在冲突。
- **generator 产物同质化**:纯模板,同 tone 的不同角色描述高度相似。
- **文档与代码不同步**:`l0-guard.ts:13` 注释写"暂未接"但 `agent-loop.ts:948-976` 实际已接。
- driver 的魔法常数(pleasure*20、arousal*25...)全手调无校准依据。

---

## 四、记忆系统 (memory/) — 良好

### 亮点
- **B-1 双时态矛盾消解**(`temporal-resolve.ts`):软失效(标记 `invalidatedAt`/`supersededBy`,不删除)+ 审计溯源 + 多层 active 过滤一致。规则判定(7 单值槽位)+ LLM 兜底,**记忆系统里工程完成度最高、测试最充分**的部分。
- **向量检索 + RRF**(`vector.ts`):dense(minimax/sqlite-vec KNN)+ sparse(tf 关键词)融合,标准 RRF(k=60)。增量重索引、legacy 迁移。
- **LLM Rerank**(`rerank.ts`):严格校验必须是 `[0,n)` 完整排列,never-throws 容错严谨。
- **混合压缩**(`compression.ts`):保首3末10+中段摘要,无 tokenizer 依赖估算,round-aware token budget。

### 弱点
- ⚠️ **"95% 保留率" 无任何依据**(`structured-memory.ts:10`):全仓搜不到测试/eval 背书,注释写 "Reference: external research"。实际正则抽取召回脆弱,达不到该量级。**误导性宣称,应删除或标注为外部文献引用**。
- **3 阶段夜间合并名不副实**(`consolidation-phases.ts`):Light/Deep/REM 借睡眠术语,实际是"排序筛选→写入→模式统计"工程流水线,与睡眠神经科学无算法对应。且缺整体端到端测试。
- 正则抽取模式高度特化(如 `用户住在(\S{2,20})`),不在模板里的表达全漏。

---

## 五、情感引擎 (emotion/) — 良好(偏下沿)

### 亮点
- **理论选型扎实**:PAD 3D、OCEAN、依恋理论(secure/anxious/avoidant)、trait-state 三时间尺度分离——都是情感计算/人格心理学正统模型,不是自创玄学。
- **衰减/融合公式数学正确**:指数衰减 + 神经质调制、`fusedP = traitBaseline*0.3 + rollingAvg*0.7`,clamp 严密。
- **multi-axis neediness 派生**:neediness 不直接由意图驱动,而由行为信号(延迟/burst/趋势)派生——理论最扎实的设计。
- **Ghost 沉默**:非随机、基于上下文的 7 条规则决策,IM 护栏、冷启动保护、两段式晚安逻辑。
- **reply-necessity**:群聊必要性打分,多维加权 + 详细 detail 日志,**模块里工程化最成熟**。

### 弱点(含真实 bug)
- 🐛 **Bug:`invalidatePADCache()` 是死代码**(`pad.ts:98`):定义但全代码库无调用。夜间 `runExperienceTraitCycle` 改 `pad-config.json` 后,`readPADConfig` 的 5 分钟内存缓存不失效,夜间人格微调最长滞后 5 分钟生效。
- 🐛 **Bug:5轴亲密度按次衰减**(`affinity.ts`):所有轴共用 EMA 0.95 且"每次交互"衰减,而非按时间——**用户聊越频繁,信任/亲密度衰减越快,逻辑反了**。应改时间衰减或只对久未联系衰减。
- 🐛 **Bug:experience-trait "±0.03/夜封顶"未实现**:`computeTraitShifts` 各规则独立返回 ±0.01,代码不保证总封顶(目前因规则分散到不同特质而"碰巧"没超)。
- ⚠️ **COLD_INTENTS 过窄**(`frustration.ts:62`):只含 `['angry']`,"算了""你不懂"这种 dismissive 冷暴力不触发挫折累积。
  > **已修复(P3-12)**:`updateFrustration` 增加 `userText` 通道,dismissive 措辞(算了/你不懂/不说了…)在非 warm intent 时计入挫折累积;正则复用 multi-axis 的 `DISMISSAL_PATTERNS`(单一来源,不新增第 5 套表),src 与 `@mio/emotion` 包副本同步修改,补 3 项单测。
- ⚠️ **多处状态不持久化**:ghost 标志、frustration 状态、trait-state 滚动窗口——重启即丢。对长期陪伴服务是结构性风险。
- ⚠️ **Cardboard 抓不到话术型塑料感**:只能识别"嗯/哦/哈哈"的表面短应答,抓不到"宝贝你要好好照顾自己哦"这种话术正确但内容空洞的塑料安慰——而那恰是 LLM 陪伴最该防的。
- ⚠️ **演化幅度无感**:experience-trait 月度位移 <0.1,融合后用户基本感知不到性格演化(更像 demo)。
- **架构冗余**:两套亲密度模型(5轴 affinity + 3轴 multi-axis)并存,谁是权威不清;4 套并行中文正则表(PAD分类/intent/experience/dismissal)易漂移。
- 几乎所有数值(decayRate=0.05、各类 delta±0.3、5轴 baseline、attachment 阈值)是经验拍脑袋,无校准/A-B 测试依据。

---

## 改进计划(按优先级)

### P0 — 真实 bug(必修)

| # | 问题 | 文件 | 改法 |
|---|------|------|------|
| 1 | `invalidatePADCache` 死代码致夜间微调滞后 | `pad.ts:98`, `nightly.ts` | nightly 改 config 后调用 `invalidatePADCache()` ✅ 已完成(注:`writePADConfig` 已刷新缓存,此为防御性加固) |
| 2 | 5轴亲密度按次衰减(越聊越疏远) | `affinity.ts` 衰减逻辑 | 改时间衰减 ✅ 已完成 |
| 3 | experience-trait "±0.03封顶"未实现 | `experience-trait.ts` | 加 ±0.03 clamp 兑现注释 ✅ 已完成 |

### P1 — 撕掉水分宣称(诚实)

| # | 问题 | 改法 |
|---|------|------|
| 4 | "95% 保留率"无依据 | 标注为外部文献引用非本仓实测 ✅ 已完成(补保留率 eval 仍待做) |
| 5 | ID-RAG 名不副实 | 加 TF 语义召回:检索评分从纯关键词子串匹配升级为 `max(triggerScore, semanticScore)`,复用现有 tokenize(中文 bigram)+ cosine,离线零网络开销 ✅ 已完成(补 9 项单测) |
| 6 | "3阶段睡眠合并"夸大 | 注释说明是借睡眠术语的工程命名,非睡眠算法 ✅ 已完成 |

### P2 — 接线死代码(兑现功能)

| # | 问题 | 改法 |
|---|------|------|
| 7 | Fallback 故障转移未启用 | `selectProvider` 默认开 fallback,或加配置开关 |
| 8 | 模型路由器未接线 | 在 agent-loop 按 task 选 provider,或确认暂不需要则归档 |
| 9 | `contextualPersonaRepairFallback` 死代码 | 接线或删除 |

### P3 — 架构收敛(降维护成本)

| # | 问题 | 改法 |
|---|------|------|
| 10 | 两套亲密度模型并存 | 明确 multi-axis 为权威,affinity 降级为兼容层 |
| 11 | agent-loop 1108 行 | prompt 装配 360 行外移到 `core/prompt-assembly.ts` |
| 12 | COLD_INTENTS 过窄 | 补 dismissive 类(算了/你不懂/不说了) ✅ 已完成(复用 multi-axis `DISMISSAL_PATTERNS`,经 `userText` 参数接入) |
| 13 | 全局可变状态并发隐患 | turnCounter 等 per-session 化 |

---

## 外部基准对照

| 维度 | Mio | Character.AI | Replika | MemGPT/Generative Agents |
|------|-----|--------------|---------|--------------------------|
| 记忆持久性 | 结构化+B-1矛盾消解,可审计 | ~21轮重置,会话间不持久 | 长期保留80-85%事实(黑箱) | 分层+importance scoring |
| 人格一致性 | 分层L0+critic+l0-guard | 静态 prompt | 成熟人设运营 | 静态 persona |
| 情感建模 | PAD+OCEAN+多轴(透明) | 无显式 | 黑箱 | — |
| Provider 容错 | 单provider直连(fallback未接线) | 闭源 | 闭源 | — |

定位:架构透明度和理论性**领先** Character.AI / 多数开源陪伴项目;记忆持久性**完胜** Character.AI,与 Replika 接近但更可审计;距离学术 SOTA(Reflection、importance scoring)有明确差距。
