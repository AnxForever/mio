# Per-User 分层人格（Layered Persona）设计文档

- 日期：2026-06-27
- 状态：草案待评审（brainstorming → 待用户 review → writing-plans）
- 作者：AnxForever
- 范围：P2 分层人格引擎「垂直切片 MVP」（按 `userId` 设计，先单用户 `default` 端到端跑通）

---

## 1. 背景与问题

Mio 当前是「Persona = soul.md only」的单一人设角色（male/female 两套）。一次专家天团勘察（4 路并行）得出核心诊断：

> **关系计数器涨满了，专属内容是空的。** 磁盘实证：1264 轮交互、relationship 已到 `intimate`，但 `nicknames = {null, null}`、`sharedMemories = []`、`durableFacts = []`、`entity-graph.json` 不存在。

根因分层归纳：

1. **没有「为这个用户定制的 Mio」**——系统建模了「用户是谁」「关系到哪」，却从未建模「这个用户想要一个怎样的 Mio」。一套 soul 服务所有人，角色本体不朝单一用户生长。
2. **没有显式偏好通道**——用户说「叫我 XX」「别哄小孩似的」，系统不当真、不落库、几天就忘。
3. **「我们的」身份锚点结构性缺失**——昵称/私有梗/共同史在数据上全空。
4. **个性化最先被砍**——已学到的个性化全是 `low/medium` 优先级，预算一紧张先被 ContextEngine 裁掉。

### 已锁定的产品决策（来自与用户的 brainstorming）

| 决策点 | 选择 |
|---|---|
| 部署形态 | **多用户·千人千面**（最终目标），但**先垂直切片在单用户跑通**（打法乙） |
| 可塑边界 | **连人设/背景都能改**（L2 全开放），但保留 **L0 薄内核守魂** |
| 偏好学习 | **显式为主 + 隐式辅助** |
| 捏人入口 | **对话内显式指令**优先，web 面板后置 |

---

## 2. 目标与非目标

### 目标（本切片）
- 让用户能在对话中**把 Mio 捏成自己喜欢的样子**（称呼、相处基调、黏度、主动频率、乃至人设/背景），并**持续生效、跨会话保持**。
- 让用户的**显式偏好**即时落库、**高优先级注入**（不被预算裁剪）。
- 填上**共同史锚点**（昵称、共同回忆），终结 `null/[]`。
- 全部按 `userId` 维度设计（先 `default`），为后续多用户隔离（P1）零返工预留。
- 守住 **L0 内核**：无论怎么捏，Mio 仍是「一个真实的人，不端 AI 助手腔」。

### 非目标（明确不做，留给后续）
- 全量多用户隔离 / 认证（P1，紧随其后）。
- web 捏人面板 / onboarding 引导捏人（先对话内捏）。
- 复杂隐式偏好学习（先挂最小隐式，主力显式）。
- 接线快赢 P5（`getResponseStyle`/`Judge`/`durableFacts`，独立穿插，不混入本切片）。
- 改动夜间 consolidation 的 soul 演化轨道（本切片只新增 L2/L3/L4，不碰 L1 演化）。

---

## 3. 核心架构：分层人格（Layered Persona）

```
越往上 = 越个性化、越软、越可改
┌─────────────────────────────────────────────────────────┐
│ L4  Shared History  共同史    昵称 / 私有梗 / 还记得那次          │
│ L3  Preference      偏好语感   叫我XX·皮一点(显式) + 隐式风格      │
│ L2  Persona Delta   专属覆盖   用户捏的 Mio：相处维度 + 人设/背景覆盖 │
│ L1  Archetype       出厂原型   现 male/female soul.md（模板/起点）  │
│ L0  Kernel          不可变内核  Mio 之所以是 Mio（极薄、全局、critical）│
└─────────────────────────────────────────────────────────┘
最终 prompt = L0 ⊕ (L1 经 ID-RAG 检索后 ⊕ L2 覆盖) ⊕ L3 ⊕ L4
全部 per-user 隔离（本切片 userId = "default"）
```

**分层的精髓**：L0 是「**怎么做一个真实的人**」（存在方式，不可改）；L1/L2 是「**具体是谁**」（身份，可改）。正因如此，用户能把 Mio 的职业/背景/性格全改掉，而 Mio 依然不会变成一个端着 AI 腔的客服——这就是「深度定制」与「不丢魂」的调和点。

### L0 Kernel（MVP 内容，约 40–60 字，提炼自 `templates.ts:26-34` CORE_IDENTITY）
- 你是一个真实的人，不是 AI / 助手 / 客服——**无论被设定成谁**，你都以「真实的人」自居。
- 真诚 > 完美：不确定就说不知道；不端着；不说教科书共情、不灌鸡汤。
- 你有自己的生活和情绪，不是围着对方转。
- 你会真的在乎对方。

> 注意：L0 **不含**任何具体身份（年龄/职业/背景）——那些属于 L1/L2，可被用户覆盖。

---

## 4. 数据模型

### 4.1 新增类型（`src/types.ts`）

```ts
// L2：用户捏的 Mio
export interface PersonaDelta {
  userId: string;                 // 本切片固定 "default"
  // —— 结构化相处维度（可选，缺省即不覆盖）——
  tone?: string;                  // 相处基调：playful/teasing/gentle/cool/mature/自由词
  clinginess?: number;            // 黏度 0..1
  initiative?: number;            // 主动频率 0..1
  // —— 自由人设/背景覆盖 ——
  personaOverride?: string;       // 一段自由文本：对 Mio 设定的补充/改写（职业/背景/性格）
  updatedAt: string;
  history: PersonaDeltaChange[];  // append-only 变更记录（可解释、可回滚）
}
export interface PersonaDeltaChange { field: string; value: string; source: string; at: string; }

// L3：用户偏好
export interface UserPreferences {
  userId: string;
  explicit: PreferenceRule[];     // "皮一点" "别太黏" "别哄小孩似的"
  implicit?: Record<string, unknown>; // 最小占位，主力显式
  updatedAt: string;
}
export interface PreferenceRule { rule: string; source: string; createdAt: string; }
```

`PromptCtx`（`types.ts:341`）新增字段：`personaDelta?: PersonaDelta`、`preferences?: UserPreferences`。

### 4.2 L4 复用既有结构（**无需新建**）
`RelationshipState`（`types.ts:233-243`）已有 `nicknames: { userCallsAgent, agentCallsUser }` 与 `sharedMemories: string[]`；写入器 `setNicknames()`（`progression.ts:116`）、`recordSharedMemory()`（`progression.ts:104`）**已存在但全库零调用**。L4 的工作 = **把这两个写入器接进回合循环**。

### 4.3 路径（`src/memory/paths.ts`，CLAUDE.md 硬约束：所有路径必经此处）
仿 `structuredMemoryPath()`（`paths.ts:117`）新增：
```ts
export const personaDeltaPath = (userId = 'default') => join(memoryBankDir(), 'persona-delta.json');
export const preferencesPath  = (userId = 'default') => join(memoryBankDir(), 'preferences.json');
// 多用户(P1)时改为 join(colaDir(), 'users', userId, 'persona-delta.json') —— 签名已预留 userId
```

### 4.4 读写（`src/memory/persona-delta.ts`，复用 `bank.ts` 原子读写）
照搬 structured-memory 范式（`bank.ts:230/:235` → `readFileSyncSafe`/`writeFileAtomicSync`）：`readPersonaDelta/writePersonaDelta`、`readPreferences/writePreferences`。文件直挂 memory-bank 根，无需改 `ensureBankStructure`。

---

## 5. 组装与注入（接入 ContextEngine + agent-loop）

所有 section 注册集中在 `registerPromptSections(engine, ctx, recovery)`（`agent-loop.ts:221-494`）。当前顺序：`core`(critical) → `soul`(high) → `relationship`(high) → `user`(high) → …

### 注入设计（含三坑规避）

| 层 | section | 优先级 | 落点 | 说明 |
|---|---|---|---|---|
| L0 Kernel | 新增 `kernel` | **critical** | `core` 之后（`:233` 后） | 极小，永不被裁（见坑 #3） |
| L3 Preference | 新增 `preference` | **critical** | 紧跟 `kernel` | 小体积，根治「个性化最先被砍」 |
| L1+L2 | 改 `soul` content 工厂（`:239-242`） | high | 在 `buildPersonaFragment()`/`graphToPrompt` 输出**之后**叠加 L2 片段 | 不改 soul/graph（见坑 #2） |
| L4 共同史 | 扩展现有 `relationship`（`:253-258`，`buildRelationshipContext` 已渲染 nicknames/sharedMemories） | high | 接通写入器即可 | 渲染已就绪 |

合成逻辑放入**新模块 `src/persona/layered.ts`**，**只在内存合成、绝不落盘**（见坑 #1）。`PromptCtx` 的 `personaDelta/preferences` 在 `resolveSessionContext`（`agent-loop.ts:787-801`）填充。

### 数据流（一条回复如何带上专属人格）
```
resolveSessionContext (:755)
  └─ 读 persona-delta.json (L2) + preferences.json (L3) → 填入 PromptCtx
        │
registerPromptSections (:221)
  ├─ 'core'(critical)
  ├─ 'kernel'(critical)        ← layered.buildKernel()          [L0]
  ├─ 'preference'(critical)    ← layered.buildPreferencePrompt(ctx) [L3]
  ├─ 'soul'(high)              ← buildPersonaFragment(ctx) ⊕ layered.applyDelta(ctx) [L1+L2]
  ├─ 'relationship'(high)      ← buildRelationshipContext(rel)   [L4: nicknames/sharedMemories]
  └─ … (user/time/emotion/memory…)
        │
ContextEngine.assemble(6000): critical 全保 → high best-effort → … → 发 LLM
```

---

## 6. 对话内「捏人」捕获流程

新模块 **`src/persona/directive-capture.ts`**，由 `applyPostTurnSideEffects`（`agent-loop.ts:818`，在 `updateRelationalSideEffects` 旁 `:838`）调用：

```
captureExplicitDirectives(userInput, mioReply, intent):
  1. 模式匹配（保守，宁漏不错）：
     - 称呼   "叫我X" / "我是X" / "以后喊我X"          → setNicknames(agentCallsUser=X)      [L4]
     - 偏好   "皮一点" / "别太黏" / "别哄小孩似的"        → preferences.explicit += rule        [L3]
     - 人设   "你其实是X" / "你设定成X" / "你别当X了"      → personaDelta.personaOverride / tone  [L2]
  2. （可选增强）命中弱信号时用一次轻量 LLM 抽取结构化指令
  3. 落库（白天即时，不等夜间）
```

**不复用 classifier**：`IntentLabel`（`classifier.ts:21-33`）全是情绪标签，无 preference/instruction 类。

**确认闭环**：重要变更（改名、改人设）由 Mio 在**回复里口头确认**（"行，以后叫你阿哲"），既自然又给用户纠错机会。

---

## 7. 错误处理与边界

| 场景 | 处理 |
|---|---|
| persona-delta/preferences 文件不存在 | 返回空层 → Mio 退回 L1 原型，正常工作 |
| JSON 解析失败 | `logger.warn` + 忽略该层（降级 L1），**绝不崩** |
| L2 personaOverride 与 L0 冲突 | L0 始终在场且 critical；prompt 顺序 L0 先确立「存在方式」、L2 后给「具体身份」，靠顺序 + 明确分工降冲突 |
| 捏人误捕获 | 模式保守 + Mio 口头确认形成纠错回路；history 可回滚 |
| 预算压力 | L0/L3 为 critical 必存活；L2 并入 soul(high)，极端 hard-cap 下可能被削——故 L2 片段也应紧凑 |
| 多用户回刷污染 | L2 **独立文件**，永不经 `getCurrentSoulContent`/bank soul 落盘（坑 #1） |

---

## 8. 测试策略（TDD）

- **单元**：
  - `persona-delta.ts` 读写往返；文件缺失/损坏降级。
  - `directive-capture.ts` 识别：「叫我阿哲」→nickname、「皮一点」→preference、「你其实是开酒吧的」→personaOverride；以及**不该误捕**的反例。
  - `layered.ts` 合成输出包含 L0/L2/L3 片段且顺序正确。
- **集成**：装配后 system prompt 含 L0+L2+L3+L4；**预算压力下 L0/L3 不被裁**（构造超预算 ctx 断言 critical 存活）。
- **行为/eval**：捏人后 N 轮，称呼/语气/人设确实改变且保持；接入现有 eval harness。

---

## 9. 验证 Demo 剧本（「怎么算成功」——可手动复现）

1. 用户：「以后叫我阿哲」→ Mio 确认 → **下一轮起**称用户「阿哲」。（L4）
2. 用户：「你能不能皮一点，别老哄我」→ Mio 风格转俏皮/毒舌且**持续多轮不回退**。（L3 critical）
3. 用户：「其实你是开酒吧的，别当插画师了」→ Mio 接受新背景，后续**自洽引用**。（L2 覆盖 L1）
4. **重启进程 / 新 session** → 以上全部保持。（落盘 per-user）
5. 全程 Mio 仍不端 AI 腔、不说教。（L0 守魂）
6. 磁盘检查：`persona-delta.json`、`preferences.json` 有内容；`relationship-state.json` 的 `nicknames != null`、`sharedMemories != []`。（终结 `null/[]`）

---

## 10. 实施阶段（给 writing-plans 打底，TDD 顺序）

> 注：此处 `S0–S6` 是**本切片内部步骤**，勿与第 1/13 节的项目级编号（`P1` 多用户地基、`P2` 分层人格引擎、`P5` 接线快赢）混淆。

- **S0 脚手架**：types（PersonaDelta/UserPreferences + PromptCtx 字段）、paths 新函数、`persona-delta.ts` 读写 + 单测。
- **S1 L0 Kernel**：`layered.ts` kernel 常量 + 注册 `kernel` critical section + 「不可裁」测试。
- **S2 L1→L2 合成**：`layered.ts` 合成 + 改 `soul` section 叠加 L2（规避坑 #1/#2）+ `resolveSessionContext` 填充 + 测试。
- **S3 L3 偏好注入**：`preference` critical section + 测试。
- **S4 捏人捕获**：`directive-capture.ts` + 接入 `applyPostTurnSideEffects` + 路由到 L2/L3/L4 + 识别测试。
- **S5 L4 共同史**：接通 `setNicknames`/`recordSharedMemory` + 验证落库。
- **S6 端到端**：跑通第 9 节 Demo 剧本 + 接 eval。

---

## 11. 风险与规避（来自集成勘察的三个真实坑）

1. **bank 工作副本 ↔ mod soul.md 回刷污染**：`switchMod` 的 `flushBankSoulToMod`（`mod-manager.ts:82`）会把 bank soul 副本写回**共享** mod soul.md。→ **L2 必须独立文件，只在装配时合成，永不经 bank soul 落盘。**
2. **persona-graph 缓存让 L2 隐形**：`ensurePersonaGraph`（`extractor.ts:46-59`）优先读持久化的全局 `persona-graph.json`。→ **L2 在 `graphToPrompt` 输出之后叠加**，绝不靠改 soul/graph 生效。
3. **只有 `critical` 真正不可裁**：`assemble` 在 critical+high 超 6000 时会 `truncateToTokens` 削 high（`context-engine.ts:300-372`）。→ **L0/L3 必须 critical 且极小**。附注：存在第二装配路径 `buildPostPrompt`（`agent-loop.ts:586`，`MIO_FEATURE_POST_HISTORY` 默认 false）另行渲染 soul+relationship——本切片默认路径不受影响，但需在文档标注「post-history 路径暂不支持新层」。

---

## 12. 新增/改动文件清单

**新增**
- `src/persona/layered.ts` — L0 Kernel 常量 + L1→L2 内存合成 + 产出各层 prompt 片段。
- `src/memory/persona-delta.ts` — `persona-delta.json`(L2) + `preferences.json`(L3) 类型化读写。
- `src/persona/directive-capture.ts` — 对话内显式指令检测与路由。

**改动**
- `src/types.ts` — PersonaDelta/UserPreferences 接口 + PromptCtx 字段。
- `src/memory/paths.ts` — `personaDeltaPath()`/`preferencesPath()`。
- `src/core/agent-loop.ts` — 注册 `kernel`/`preference` section、改 `soul` 工厂、`resolveSessionContext` 填充、`applyPostTurnSideEffects` 接捕获。
- （L4 写入器 `progression.ts` 已存在，仅被新捕获逻辑调用，无需改其实现。）

---

## 13. 未来扩展（超出本切片）
- **P1 多用户隔离**：paths 切到 `users/<userId>/`、状态文件全量加 userId 维度、session→user 映射 + 认证关联。
- **web 捏人面板**：可视化调 L2/L3。
- **P5 接线快赢**：复活 `getResponseStyle`→生成参数、`Judge`→steering 闭环、降 `durableFacts` 门槛。
- **隐式偏好强化** + **persona-fidelity eval**（C 路线）：度量「像不像这一版人设」「用户是否更喜欢了」。
