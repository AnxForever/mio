# Mio 项目参考研究资料 (2026-07-09)

根据 Mio v0.6.0 核心架构维度整理的相关学术论文、产品分析和最佳实践。

---

## 1. PAD 情感模型 (Pleasure-Arousal-Dominance)

Mio 使用: `src/emotion/pad.ts` — 三维 PAD + OCEAN 人格基线 + 指数衰减

### 相关研究

| 论文/来源 | 年份 | 关键内容 |
|-----------|------|----------|
| **Quantum-inspired modeling of social impact** (Alodjants et al., *Scientific Reports* 15, 35052) | 2025 | 用量子启发方法建模 LLM agent 生态中的集体情感，PAD 情感球面表示，arousal 由外部信息 × 人格特质交互决定 |
| **MBTI-to-OCEAN-PAD Approach** (Liu & Li, AI Application Technologies) | 2025 | MBTI → Big Five → PAD 映射链，用于机器人的个性驱动情感表达。与 Mio 的 OCEAN→PAD baseline 调整同方向 |
| **Learning VAD Interdependencies** (IEEE ACII, Glasgow) | 2024 | 挑战 VAD 三维独立假设，发现维度间共享方差不可忽略，残差分析改善基本情绪映射 |
| **S-O-R + PAD for AI Virtual Influencers** (*Computers in Human Behavior Reports*) | 2025 | PAD 模型在 AI 虚拟人营销中的应用——感知互动性/视觉吸引力影响 PAD 状态→驱动行为动机 |

### 对 Mio 的参考价值
- PAD 三维之间的**非独立性**值得注意——当前 `classifyPAD()` 独立调整三个维度，可能需要考虑交叉影响
- Quantum-inspired 论文的"情感球面"表示可能用于改进 PAD 状态可视化
- MBTI→OCEAN→PAD 映射链验证了 Mio 当前的设计方向

---

## 2. AI 陪伴产品架构对比

Mio 定位: 带长期记忆/多轴情感/关系阶段的单一陪伴 agent

### 三大产品架构对比

| 维度 | **Xiaoice (微软小冰)** | **Replika** | **Character.AI** | **Mio** |
|------|----------------------|-------------|------------------|---------|
| 核心架构 | Hybrid IQ+EQ + Dialogue Manager | GPT-based + 自定义 emotion model | 自研 LLM + 多角色图谱 | 模块化单体 + 分层人格 |
| 关系模型 | 有状态动态图 (nodes + edges) | 线性单一关系进程 | 星型拓扑 (用户↔多角色) | 4阶段 + 5轴亲和力 + 多轴关系 |
| 记忆深度 | 多层级 (short + episodic + semantic RAG) | 短期 + 基础 episodic | 每角色持久记忆 | 3层结构化 + 双时间 + 向量 + 程序性 |
| 情感连续性 | **高** — 学术金标准 | 低 — "情感连续性浅" | 中 — 单session强，跨角色碎片化 | 高 — PAD + 亲和力 + 挫败感持久化 |
| 主动性 | 有 | 有限 | 无 | 泊松过程 + 贝叶斯响应预测 |

### 关键学术发现 (ICLR 2025 / Harvard)
> "Replika's short-term recall vs XiaoIce's persistent affective memory demonstrates that **architecture imposes a capacity ceiling on relational authenticity.**"

### 中文市场竞品分析维度 (2025)
1. 产品定位 — 陪伴 vs 社区 vs 互动娱乐
2. 角色生态 — 创作→分发→消费→反馈闭环
3. 对话质量 — 基础连贯性 + 人格一致性 + **关系连续性（记忆）**
4. 变现触发 — 最佳时机是关系沉没成本绑定
5. 安全与依赖 — 必须解决过度依恋，尤其对脆弱用户

---

## 3. 记忆系统 — MemGPT/Letta/Mem0 等

Mio 使用: 结构化记忆 + 双时间消解 + 3阶段固化 + ACE reflector + 向量检索

### 主要竞品/框架

| 系统 | GitHub Stars | 核心思路 | 与 Mio 对比 |
|------|-------------|---------|------------|
| **MemGPT / Letta** | 14K+ | OS 启发: core memory + archival memory, agent 可自编辑记忆 | Mio 的 3层记忆 + 夜间固化 类似其 "sleep-time compute" |
| **Mem0** | 42.6K+ | ADD-only 提取 + 混合检索 (semantic+BM25+entity), $24M融资 | Mio 的 ADD-only + supersededBy 更强（保留审计） |
| **Zep / Graphiti** | 19.7K | 时间知识图谱，4时间戳模型 | Mio 的双时间模型 (valid_at + invalid_at) 设计理念一致 |
| **Engram** | 新项目 | 双时间 KG + 双进程架构，83.6% LongMemEval | 与 Mio 的 invalidatedAt/supersededBy 链同构 |
| **TOKI** | VLDB 2027 | 形式化矛盾消解为写时并发控制，隔离前提条件 | 理论基础——Mio 的 combineContradicts() 可用其形式化验证 |
| **MemStrata** | 2026 | 确定性 supersession via S-R-O key matching | 证明 similarity-based staleness detection 在结构上不可能 (cosine AUROC 0.59) |

### 关键趋势 (2025)

1. **Letta 的核心发现**: 即使是简单的 filesystem + grep (74% LoCoMo) 也能击败专门化记忆工具 (Mem0 68.5%)。**检索机制不如 agent 如何使用工**
2. **MemStrata 定理**: 基于相似度的过期检测结构上不可能——必须用**确定性 key-matching**
3. **双时间已成标准**: Engram, TOKI, MemStrata, Zep 全部采用 valid/invalid 时间戳

### 对 Mio 的参考价值
- Mio 的双时间消解设计走在正确的方向上——TOKI 论文提供了形式化理论基础
- MemStrata 的 S-R-O key matching 可能替代 Mio 当前的 O(n²) LLM 矛盾检测
- Engram 的双进程架构 (System-1 fast write + System-2 async consolidation) 值得借鉴

---

## 4. 人格一致性与 RAG

Mio 使用: ID-RAG 知识图谱 + 分层人格 (L0 kernel + soul.md + delta + few-shot)

### 关键论文

| 论文 | 年份 | 关键发现 |
|------|------|----------|
| **Information for Conversation Generation: Proposals Utilising KGs** (Clay & Jimenez-Ruiz, ISWC) | 2024 | "Narrative bubbles" — 角色话语/事实/摘要存储为时空有界的 KG 实体，动态更新无需重训练。VAD 情感分数存入 KG 实体特征 |
| **Emotional RAG** (IEEE ICKG) | 2024 | 情绪依赖记忆理论——两策略：① semantic + emotional 组合 ② 先情绪后语义。在角色扮演数据集上优于纯 semantic RAG |
| **Beyond Simple Personas** (Pal & Traum, SIGDIAL) | 2025 | KG 早期融合显著减少幻觉，vs 文本摘要/纯 RAG/NPCEditor。**KG-based persona grounding 是减少幻觉的最优方案** |
| **EMG-RAG** (EMNLP) | 2024 | 可编辑记忆图谱 + RAG + RL 优化。解决三个难题：数据收集、记忆可编辑性、相关记忆可选性 |
| **PersonaGym** (EMNLP Findings) | 2025 | 200+ persona 动态基准。PersonaScore 评估指标。发现：模型大小与一致性不完全相关 (Llama-3-8B 可竞争) |

### 人格漂移解决方案 (2024-2025)

| 方法 | 代表论文 | 效果 |
|------|---------|------|
| **PCL (Persona-Aware Contrastive Learning)** | ACL Findings 2025 | Chain-of-Persona 自反思 + 对比自博弈。7B 模型接近 GPT-4，零样本迁移 |
| **Multi-turn RL** | NeurIPS 2025 | 轨迹级优化，不一致性降低 >55% vs 单轮 baseline |
| **Activation Steering / Persona Vectors** | Anthropic 2025 | 残差流中提取人格方向向量，实时监控+纠偏。r~0.76-0.97 |
| **Split-Softmax** | 2024 drift paper | 训练无关，增强对早期 persona token 的注意力权重 |
| **Heterogeneous Temporal Memory Governance** | COLING 2025/2026 | 外部可审计记忆框架，五维一致性追踪 |

### 对 Mio 的参考价值
- PersonaGym 的评估指标可以直接用于 Mio 的人格一致性测试
- Emotional RAG 的情绪依赖检索 → 可以增强 ID-RAG 的 recallScore（当前仅 TF-cosine）
- PCL 的 Chain-of-Persona 自反思 → 可以集成到 prompt assembly 中
- Anthropic Persona Vectors 的实时监控 → L0 guard 的升级方向

---

## 5. 分层人格架构 (L0 Kernel)

Mio 使用: L0 自我感知内核 + L1 soul.md + L2 Delta + L3 偏好

### 业界并行实践

| 框架/项目 | L0 理念 | 特点 |
|----------|---------|------|
| **OpenPersona** | Soul/Body/Faculty/Skill 四层 | 开源，模块化 |
| **Zylos AI** | identity.md + SOUL.md 模式 | 不可变 L0 trust anchor |
| **Rotifer** | 不可变 L0 trust anchor | 独立项目，强调安全性 |
| **Lawmadi** | OS 风格 orchestration kernel | L0 KERNEL 用于编排/治理 |
| **Second-Me** | L0-L2 memory hierarchy | 将记忆训练进模型参数 |

### 核心设计原则 (2025 共识)

```
L0 内核 (不可变) → 基本自我模型 + 元认知 + 伦理常量 + 防漂移规则
L1 持久人格 (慢更新) → 背景故事 + 核心特质 + 声音/语气 + 关系模型
L2 自适应层 (动态) → 当前情绪 + 主题透镜 + 短期工作记忆
L3+ 表达层 → 响应风格 + 多模态 + 工具/技能
```

编排层逐层咨询：L0 → L1 → L2 → 生成。响应前后各一次反思。

### 对 Mio 的参考价值
- Mio 的 8 层 ADR-0003 层次结构与此共识高度一致
- OpenPersona 的 Faculty 层 (能力/技能) → Mio 可考虑将 tools/subagent 抽象为独立层
- Zylos 的 identity.md 不可变锚点 → 与 Mio 的 soul.md 单一人格源理念一致
- "Sync Score" 概念 (Echo Protocol FSM) → 可作为 Mio 的 drift detector

---

## 6. SillyTavern 角色卡最佳实践

Mio 的 voice-presets.ts / layered.ts 借鉴了 SillyTavern 社区经验

### 核心方法论 (2024-2026)

1. **mes_example (few-shot 示例消息) 是人格一致性的最强杠杆**
   - 3-10 个多样化示例，用 `<START>` 分隔
   - 展示：随意、冲突、亲密、脆弱、高张力决策等场景
   - 格式必须精确匹配期望输出：`*动作描写* "对话" *更多反应*`
   - 最后一条示例（最接近目标场景）影响力最大

2. **信息分层注入 (按优先级)**
   - Description/Personality/Scenario → 永久基础（注意力会衰减）
   - mes_example → few-shot 声音训练（最强但会被推出上下文）
   - First Message → 设定基调
   - Lorebook/World Info → 卸载事实/关系/条件触发
   - Author's Note / Post-History → 持久引导

3. **书写规则**
   - 用 {{char}} 第三人称，不用第一人称（第一人称是身份泄漏的首要原因）
   - 具体、客观的描述而非模糊形容词
   - 正向规则嵌入（"如果 X 则 Y"），优先 8-10 条
   - Ali:Chat 风格在官方文档中被重点推荐

### 对 Mio 的参考价值
- beginDialogs 是正确方向，但 message 注入位置可能需要优化（当前在后历史，SillyTavern 经验是越接近生成点越强）
- Character Note (后历史锚点) 的设计与 SillyTavern Author's Note 理念一致
- voice-presets.ts 的 nano bear 极简 + 示例驱动 高度吻合社区最佳实践

---

## 7. 依恋理论与 AI 陪伴

Mio 使用: frustration.ts 依恋风格推导 (secure/anxious/avoidant/balanced) + 多轴关系

### 关键研究

| 论文 | 年份 | 关键发现 |
|------|------|----------|
| **EHARS (Experiences in Human-AI Relationships Scale)** (Yang & Oshio, *Current Psychology*) | 2025 | 首个 AI 关系专用依恋量表。二维模型：anxiety (需要 reassurance) + avoidance (回避亲密)。~75% 用户将 AI 视为 safe haven/secure base |
| **AMDF (Attachment-Mediated Dependency Framework)** (Harris & Agarwal) | 2026 | 依恋风格调节依赖路径：anxious→hyperactivating / avoidant→trust-dependent intensification / secure→integrated companionship |
| **DinoCompanion** (Wang et al., CIKM) | 2025 | 基于依恋理论的多模态儿童陪伴机器人。CARPO 风险校准优化 + AttachSecure-Bench。安全基地行为 ~73% |
| **Olar et al.** (*Cognitive Systems Research*) | 2025/2026 | 双 agent 计算模拟 anxious-avoidant 互动动力学。内部状态 (感知/图式/情绪/调节/行动) 自适应学习 |
| **多阶段关系模型** (Yan / Shu et al.) | 2025/2026 | instrumental use → quasi-social interaction → full emotional attachment with IWMs |

### 三阶段演进模型
```
工具性使用 → 准社会互动(via 拟人化+响应性) → 完全情感依恋(含内部工作模型)
```

### 对 Mio 的参考价值
- AMDF 的三条路径与 Mio 的 attachment style 推导方向一致但更理论化
- EHARS 量表可作为 Mio 用户 onboarding 的依恋评估工具
- DinoCompanion 的 CARPO 风险校准 → Mio 的 frustration + ghost 安全网可借鉴
- 关键警告：**设计为 promote 安全依恋，而非利用焦虑依恋增加 engagement**

---

## 8. Generative Agents (Smallville) 记忆流

Mio 使用: memory-stream.ts (Smallville 启发的仅追加事件日志 + 三维检索)

### 核心架构

```
记忆流 (append-only) → 检索 (recency*0.5 + relevance*3 + importance*2) → 反思 (树结构) → 规划 (层级分解)
```

### 2024-2025 改进

| 改进方向 | 代表工作 | 关键贡献 |
|---------|---------|---------|
| **规模化** | Park et al. (arXiv:2411.10109) | 1,052 个"数字孪生"，2h 深度访谈 grounding，预测态度 ~83-86% |
| **学习检索** | Hong & He (ACAN, *Frontiers in Psychology*) | 辅助交叉注意力网络，学习 memory 与当前状态的 attention 权重，超越固定权重 |
| **效率** | AGA (Affordable Generative Agents) | 策略缓存 + 记忆压缩 → ~97% token 节省 |
| **层次记忆** | 多项工作 | 从 flat stream → hierarchical/graph memory + summarization |
| **情感整合** | AgentSociety 等 | 情绪/需求/动机/规范模块集成 |

### 对 Mio 的参考价值
- ACAN 的学习检索可能替代 Mio 当前的固定权重 (0.5/3/2)
- AGA 的策略缓存模式 → Mio 的 persona driver 重复行为可缓存
- 层次化记忆与 Mio 的 3层结构 (STM→MTM→LTM) 一致但可进一步深化
- "数字孪生"的 grounding 方法 (深度访谈 + expert persona reflection) 可用于 Mio 的 onboarding

---

## 9. ACE (Agentic Context Engineering)

Mio 使用: reflector.ts (ACE Generator→Reflector→Curator 周期的纯启发式实现)

### 原始论文 (arXiv:2510.04618, ICLR 2026)

**核心创新**: 将上下文视为可进化的 "playbook" —— 结构化的 itemized bullet 集合 + metadata (unique ID, helpful/harmful counters)

**三角色分工**:
- **Generator**: 用当前 playbook 执行任务，产出 reasoning traces
- **Reflector**: 分析执行轨迹，提取可复用洞察（多轮迭代 critique）
- **Curator**: 合成 delta entries，去重 (via embeddings)，一致性，合并

**关键结果**: Agent benchmarks +10.6%, 延迟/成本降低 75-91%

### 与 Mio reflector.ts 的对比

| 维度 | ACE 原版 | Mio reflector |
|------|---------|---------------|
| Reflector 实现 | LLM 多轮 critique | 纯启发式 (regex + Levenshtein) |
| Curator 操作 | embedding 去重 + counter 更新 | 强化/削弱/合并/保留/丢弃 |
| LLM 成本 | 有（Reflector 步骤） | **零** |
| 确定性 | 低（LLM 有随机性） | **高**（纯函数） |
| 深度 | 高（语义理解） | 中（模式匹配） |

### 对 Mio 的参考价值
- Mio 的零 LLM reflector 是差异化优势——ACE 论文的 ablation 显示 Reflector 的多次迭代对质量至关重要，但 Mio 证明**纯启发式也可达到基本水平**
- 可考虑混合方案：启发式做初筛 + LLM reflector 做深度审计（类似 combineContradicts 的 composition 模式）
- ACE 的 itemized bullet + counter 机制比 Mio 当前的 confidence +/- 0.1 更细粒度

---

## 10. 反 AI 痕迹 (Anti-AI-Tell) 与人味对话

Mio 使用: voice-presets.ts — ~150 token nano bear 正向描述 + 12对 beginDialogs

### AI 痕迹清单 (2025 共识)

**硬标志**:
- Em dashes (—) 过度使用
- Buzzwords: delve, tapestry, intricate, realm, testament, leverage, showcase, underscore, meticulous, nuanced, ever-evolving
- "not just X but Y" 结构
- 过于完美的语法/标点/段落结构
- "Great question!" 式的机器人热情
- 低 burstiness (句子长度过于均匀)

**微信/LINE 真人风格**:
- 一条消息 3-10 字，2-5 条连发
- 大量 emoji 😂😭🥺🔥💀🫶
- "...", "哈哈" (长度变化表达不同语气), "??", "fr", "tbh", "idk"
- yyds, awsl, 666, 绝了, 真的假的
- 反应先行 ("等等 omg"), 回问, 小分享, 偶尔 "在吃饭 brb"
- 小写/缩写/不完整句/填充词

### 对 Mio 的参考价值
- Mio 当前的 WeChat 分段 cadence 方向正确
- beginDialogs 是质量最强杠杆（社区共识 + 论文验证）
- 可增加 burstiness 检测——如果 Mio 连续输出长段落，自动触发 re-anchor
- 真人风格的 "反应先行" 模式可加入 voice presets 的 few-shot 中

---

## 11. 综合性参考框架

以下框架与 Mio 的全栈架构理念高度相关：

| 框架 | 核心贡献 | 与 Mio 的关联 |
|------|---------|--------------|
| **The Liminal Engine** (Zenodo, 2025) | 解决 "cardboard problem" + "continuity problem" + "emotional annotation gap"。episodic relational memory + rupture/repair + Ritual Engine + Cardboard Score + Witness System | Mio 的 ritual.ts 和 cardboard-state.json 直接相关。rupture/repair 模型可增强 frustration tracker |
| **iPET** (ACL 2025 Demo) | LLM 虚拟宠物，200+天生产部署，百万用户。memory + dialogue + world simulation 三模块 | 产品化验证——Mio 的架构在生产中的可行性参考 |
| **Livia** (arXiv:2509.05298) | 情感感知 AR 陪伴。Temporal Binary Compression + Dynamic Importance Memory Filter | 记忆压缩算法可对比 Mio 的 hybrid compression |
| **DAM-LLM** (arXiv:2510.27418) | 贝叶斯启发 memory entropy 更新。63.7-70.6% 记忆减少 | confidence-weighted memory units 与 Mio 的 confidence 系统对应 |
| **Nadine** (Wiley, 2024/2025) | 社交机器人。SoR-ReAct agent + RAG episodic memory + PAD 情感系统 | PAD+OCEAN+LLM 的完整集成案例 |
| **ComPeer** (UIST 2024) | 主动同伴支持。LLM 推理 timing + 内容。主动消息促进更深自我表露 | 主动性的效果验证——Mio 的 smart-proactive 方向正确 |

---

## 12. 总结：Mio 的优势与差距

### 已验证的设计优势 (2024-2026 研究支持)
1. **双时间消解** — 2025-2026 成为行业标准 (Engram/TOKI/MemStrata/Zep)，Mio 走在前面
2. **分层人格 (L0 Kernel)** — 2025 行业共识架构，Mio 的 ADR-0003 8层设计符合趋势
3. **PAD+OCEAN 组合** — 多篇 2025 论文验证此组合在机器人和虚拟人中的有效性
4. **ACE 零 LLM reflector** — 差异化优势，成本/确定性优于原版
5. **few-shot beginDialogs** — SillyTavern 社区 + 学术研究双重验证为最强一致性杠杆
6. **泊松主动** — ComPeer 验证了主动消息的 engagement 提升效果
7. **结构化记忆 (entity 提取)** — 行业从 prose summary 转向 structured entity 的趋势

### 值得关注的改进方向
1. **ID-RAG 语义检索** — 当前 TF-cosine 偏弱，可引入 embedding-based semantic similarity + Emotional RAG 的情绪依赖检索
2. **关系衰减方向** — affinity.ts 已修复为时间衰减，但建议关注 AMDF 模型的三条依恋路径
3. **确定性 supersession** — MemStrata 证明 S-R-O key matching 优于 similarity-based approach
4. **人格漂移监控** — PersonaGym 指标 + Anthropic Persona Vectors 可用于实时 drift detection
5. **Reflector 混合方案** — 启发式初筛 + LLM 深度审计（复用 combineContradicts 的 composition 模式）

---

## 参考资料链接

### PAD / 情感计算
- [Quantum-inspired modeling (Nature SR, 2025)](https://rd.springer.com/article/10.1038/s41598-025-22508-y)
- [Learning VAD Interdependencies (IEEE ACII, 2024)](https://ieeexplore.ieee.org/document/10970298)
- [MBTI-to-OCEAN-PAD (2025)](https://www.semanticscholar.org/paper/Bridging-Personality-Theory-and-Emotion-Dynamics-An-Liu-Li/5e2c47789440c616f0d8b39508d2655100375e0c)

### 记忆系统
- [MemGPT → Letta](https://www.letta.com/blog/benchmarking-ai-agent-memory)
- [Engram (arXiv:2606.09900)](https://export.arxiv.org/abs/2606.09900)
- [TOKI (arXiv:2606.06240, VLDB 2027)](https://browse-export.arxiv.org/abs/2606.06240)
- [MemStrata (arXiv:2606.26511)](https://arxiv-org.ezproxy.obspm.fr/html/2606.26511v1)
- [Zep / Graphiti (arXiv:2501.13956)](https://github.com/lhl/agentic-memory/blob/main/ANALYSIS-arxiv-2501.13956-zep.md)

### 人格一致性
- [PersonaGym (EMNLP Findings, 2025)](https://aclanthology.org/2025.findings-emnlp.368.pdf)
- [PCL (ACL Findings, 2025)](https://arxiv.org/html/2503.17662v1)
- [Persona Vectors (Anthropic, 2025)](https://www.anthropic.com/research/persona-vectors)
- [Narrative Bubbles KG (ISWC, 2024)](https://arxiv.org/abs/2410.16196)
- [Emotional RAG (IEEE ICKG, 2024)](https://dtic.dimensions.ai/details/publication/pub.1185706518)

### AI 陪伴
- [Liminal Engine (Zenodo, 2025)](https://zenodo.org/records/17684281)
- [iPET (ACL, 2025)](https://aclanthology.org/2025.acl-demo.40/)
- [Livia (arXiv:2509.05298)](https://browse-export.arxiv.org/abs/2509.05298)
- [DAM-LLM (arXiv:2510.27418)](https://export.arxiv.org/pdf/2510.27418)
- [Nadine (Wiley, 2024/2025)](https://onlinelibrary.wiley.com/doi/full/10.1002/cav.2290)
- [DinoCompanion (arXiv:2506.12486)](https://arxiv.org/abs/2506.12486)

### 依恋理论
- [EHARS Scale (Current Psychology, 2025)](https://link.springer.com/article/10.1007/s12144-025-07917-6)
- [AMDF Framework](https://ijip.in/wp-content/uploads/2026/03/18.01.151.20261401.pdf)
- [Computational Anxious-Avoidant Simulation (*Cognitive Systems Research*)](https://www.sciencedirect.com/science/article/pii/S1389041726000379)

### 基础框架
- [ACE (arXiv:2510.04618, ICLR 2026)](https://arxiv.org/abs/2510.04618)
- [Generative Agents / Smallville (arXiv:2304.03442)](https://arxiv.org/abs/2304.03442)
- [GenAgents 1000 People (arXiv:2411.10109)](https://arxiv.org/abs/2411.10109)
- [ComPeer (UIST, 2024)](https://ar5iv.labs.arxiv.org/html/2407.18064)

### SillyTavern 社区
- [Tavernsprite 2026 Guide](https://tavernsprite.com/blog/sillytavern-character-card-creation-guide/)
- [Mini-Tavern Rules Guide](https://blog.mini-tavern.com/blog/sillytavern-character-card-guide-how-to-write-rules-for-better-ai-behavior-in-20-a5ec61)
- [Ali:Chat Style](https://rentry.co/alichat)
- [Official SillyTavern Docs](https://docs.sillytavern.app/usage/core-concepts/characterdesign/)
