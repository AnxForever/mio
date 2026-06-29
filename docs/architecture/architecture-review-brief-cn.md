# Mio 架构评审汇报版

用途：用于中文评审、汇报或 PPT 大纲。本文基于现有研究材料，不新增实现判断。

核心结论：

> Mio 当前架构是 good，暂时不是 excellent。它在产品形态和核心领域建模上很强，但在组合根、测试证据、安全部署边界、package drift 和前端/运行可靠性上还有明确缺口。

## 一页摘要

Mio 不是一个普通 chatbot 项目。它更像一个 local-first 的状态型 companion runtime：

- 单进程 Node.js modular monolith，适合个人本地代理。
- 记忆、人格、情绪、关系、工具、Provider 和多协议入口是明确领域模块。
- 记忆不是简单聊天历史，而是 transcript、memory bank、structured memory、vector search、lorebook、procedural memory、review flow 和 consolidation 的组合。
- 人格不是单一 prompt，而是 `soul.md`、ID-RAG、per-user delta、显式偏好、关系上下文、dual-mode 和 personality driver 的层级。
- 情绪/关系/沉默/危机不是只靠 prompt 文本，而是有代码级状态机和 gate。
- Web、SSE、WS、OpenAI-compatible、OneBot 都汇入 `runTurn`，行为核心统一。

但它还不能称为优秀架构：

- `src/server/index.ts` 和 `src/core/agent-loop.ts` 仍是组合热点。
- `src/emotion` vs `packages/emotion`、`src/persona` vs `packages/idrag` 有 drift 风险。
- 安全模型是 localhost-first，不是默认互联网强安全。
- native auth、ID-RAG、provider fallback、PluginRegistry、浏览器真实流程、取消传播等直接测试不足。
- Vite proxy、service worker、前端 token 校验有工程漂移风险。

## 当前评分

| 角色 | 分数 | 结论 |
|---|---:|---|
| Principal Architect | 4/5 | 模块化单体方向正确，领域词汇清晰；server/core 组合根限制上限。 |
| Runtime Reliability Engineer | 3/5 | Provider HTTP timeout/retry 是亮点；stream/WS cancellation、notification timeout、恢复策略不足。 |
| Memory Systems Reviewer | 4/5 | 记忆系统是核心优势；structured/search/consolidation 边界和恢复性需要加强。 |
| Agent Behavior and Prompt Architect | 4/5 | persona、emotion、ghost、stage gates、tool scoping 设计丰富；状态所有权和直接测试不足。 |
| Security and Privacy Reviewer | 3/5 | localhost-first、auth、validation、IM isolation 不错；远程暴露、public routes、localStorage token、native auth test 是短板。 |
| Product Scalability Reviewer | 3/5 | Provider/channel/plugin/package 都有扩展方向；但新增能力仍容易触碰 core/server/view hubs。 |

## 为什么是 Good

### 1. 架构模式贴合产品

Mio 是个人本地 companion，不需要微服务。模块化单体是合适选择：

- 部署简单。
- 本地状态一致性更容易处理。
- 单用户场景不需要分布式复杂度。
- 领域模块已经清楚：memory、emotion、persona、relationship、providers、tools、server、scheduler。

安全表述：

> Mio 采用 local-first modular monolith，而不是分布式 agent 平台。

### 2. 记忆系统是架构级能力

Mio 的 memory 不是简单把最近 N 条消息塞进 prompt：

- transcript 负责原始对话事实。
- memory bank / bookmarks 负责持久上下文。
- structured memory 负责 entity/fact/decision 抽取。
- vector / sqlite-vector 负责语义召回。
- lorebook / procedural memory 负责行为与模式沉淀。
- review flow 给用户确认、忽略、编辑、删除入口。
- consolidation phases 负责夜间整理。

这支持一个强 claim：

> Mio 把对话转化为可检索、可审查、可压缩的本地长期上下文。

限制：

不能说“完美记忆安全”。search scope、multi-file recovery、structured-memory 大文件仍需治理。

### 3. Persona 是层级系统

当前正确说法不是 "`soul.md` 是唯一人格来源"，而是：

> `soul.md` 是角色 archetype 来源；ID-RAG、per-user overlays、偏好、关系上下文、dual-mode 和 driver 共同形成运行时 persona。

这是比静态长 prompt 更强的设计。但要升级为 excellent，需要补 ID-RAG extraction/retrieval/rendering 的直接测试和 package parity。

### 4. 行为策略有代码 gate

Mio 不只是靠 LLM 风格词维持关系感：

- crisis screening 在模型前执行。
- relationship stage gates 控制昵称、主动消息、亲密表达。
- ghost / reply necessity 控制是否沉默。
- isolated IM sessions 限制工具和全局记忆访问。
- ContextEngine 控制 prompt section priority 和 token budget。

这支持：

> Mio 的关键行为策略由运行时代码和 prompt 共同控制。

限制：

不能说行为完全确定。LLM 输出仍然概率化，多个状态机之间也存在所有权重叠。

### 5. 多协议统一到一个行为核心

Web chat、SSE、WS、OpenAI-compatible、OneBot 都汇入 `runTurn`。这避免了每个入口各写一套 companion 行为。

限制：

不能说 server 是薄层。`src/server/index.ts` 已经是最大组合热点。

### 6. 测试意识不错

现有测试覆盖 core、memory、emotion、OpenAI bridge、OneBot、HTTP、WS、semantic memory、structured memory、IM isolation、prompt budget、frontend view-model 和 eval harness。

限制：

不能说测试完备。边界测试缺口仍很明确。

## 哪些点接近 Excellent

| 方向 | 为什么接近 | 升级条件 |
|---|---|---|
| Local-first modular monolith | 模式和产品高度匹配 | server/core 组合根拆分，边界测试补齐 |
| Memory stack | 领域完整、能力丰富、已有多类测试 | consolidation recovery、search scope、structured boundary 治理 |
| Emotion/relationship engine | PAD、affinity、frustration、stage、ghost 都是代码模型 | 状态所有权矩阵、package parity、更多 multi-axis 测试 |
| Persona hierarchy | ID-RAG + overlays 是强设计 | 直接 ID-RAG 测试、source hierarchy 文档落地 |
| Protocol bridge | 多入口复用同一 turn core | server route 拆分、stream/WS cancellation |
| Eval harness | 已有 ablation 和 metrics | 跑真实 provider、归档结果、人审样本 |

## 哪些点不能吹

| 不能吹的说法 | 原因 | 可替代表述 |
|---|---|---|
| 默认互联网安全 | auth optional，public routes 存在，远程绑定策略未强制 | localhost-first，可配置 bearer auth |
| server 是 thin layer | `src/server/index.ts` 聚合大量路由和协议 | server 当前是 composition root，需要按 route family 拆分 |
| `soul.md` 是唯一人格来源 | runtime persona 还有 overlays、driver、dual-mode、few-shot 等 | `soul.md` 是角色 archetype 来源 |
| plugin 架构成熟 | 缺 lifecycle/conflict/rollback 直接测试 | plugin foundation 已存在 |
| provider fallback 完全可靠 | fallback/router direct tests 缺失 | provider adapter 清晰，fallback 仍需证明 |
| memory 完全安全 | search scope、consolidation recovery 未完全证明 | memory layered and reviewable |
| 测试覆盖完整 | 多个高风险边界缺直接测试 | broad tests with known boundary gaps |
| 证明改善用户心理状态 | eval 是 synthetic engineering benchmark | 可评估 companion scenario quality，不是用户研究 |

## 需要补哪些证据才能升级评分

P0 证据：

- Native auth matrix：`/chat`、`/chat/stream`、`/admin/export`、`/mods/:name/soul`、`/notify/test`、`/memories`、WS。
- ID-RAG direct tests：extract、retrieve、render、token cap、refresh、package parity。
- PluginRegistry lifecycle tests。
- Provider fallback/router tests。
- Frontend auth check：不能继续用 public `/status` 验 token。
- Vite proxy / service worker drift tests。

P1 证据：

- stream / WS cancellation tests。
- notification timeout/retry tests。
- memory consolidation recovery tests。
- browser UI workflow E2E。

实验级证据：

- `eval:paper` deterministic run。
- real-provider replication。
- LLM judge + human review sample。
- failure analysis linking to architecture changes。

## 推荐汇报结构

### Slide 1: 结论

Mio 架构当前是 good, not excellent。强在 local-first companion runtime 的领域建模，弱在组合根、安全部署边界和直接证据。

### Slide 2: 系统形态

展示 modular monolith + local disk state + web/WS/bridge adapters + `runTurn`。

### Slide 3: 核心亮点

memory stack、persona hierarchy、emotion/relationship state machines、provider/tool adapters、eval harness。

### Slide 4: 架构评分

六角色评分表。

### Slide 5: 不能吹的边界

internet security、server thin、plugin maturity、provider fallback、perfect memory、complete tests。

### Slide 6: P0 补证据

native auth、ID-RAG、provider fallback、PluginRegistry、frontend auth/proxy/SW。

### Slide 7: 改进路线

RFC-0004 security policy -> RFC-0001 server split -> RFC-0002 context providers -> RFC-0003 package drift。

### Slide 8: 最终目标

从 good 升级到 excellent 的定义：边界清晰、证据可跑、远程安全口径诚实、核心行为可回归。

## 推荐公开话术

> Mio 是一个 local-first emotional companion runtime，采用模块化单体架构。它的强项是把记忆、人格、情绪、关系、工具和多协议入口都纳入同一个状态型 turn loop，而不是做一个 stateless chatbot。当前架构已经 good，尤其适合个人本地 companion 场景；但还不能称为 excellent，因为 server/core 组合根、package drift、远程安全策略、stream cancellation 和若干直接测试还需要补齐。

