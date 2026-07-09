# Attachment-Aware 响应调节 — 设计文档

> 日期: 2026-07-09 · 基于 AMDF + EHARS 研究 · ⚠️ 伦理红线

## 背景

Mio 已有 `frustration.ts` 推导用户依恋风格 (secure/anxious/avoidant/balanced)，但目前仅用于 frustration tracking 和 context injection，不直接影响响应策略。

### 研究依据

1. **AMDF (Attachment-Mediated Dependency Framework, Harris & Agarwal 2026)**
   - Anxious 用户 → hyperactivating 轨迹：AI 的一致性验证强化 proximity-seeking
   - Avoidant 用户 → trust-dependent intensification：AI 的非威胁性消除防御
   - Secure 用户 → integrated companionship：平衡的补充性使用

2. **EHARS (Experiences in Human-AI Relationships Scale, Yang & Oshio 2025)**
   - 首个 AI 关系专用依恋量表
   - ~75% 用户将 AI 视为 safe haven / secure base
   - anxiety toward AI 预测更多使用和更低 self-esteem

3. **DinoCompanion (Wang et al., CIKM 2025)**
   - CARPO: Child-Aware Risk-calibrated Preference Optimization
   - 最大化 engagement + epistemic-uncertainty-weighted risk penalties
   - AttachSecure-Bench: 10 个依恋核心能力维度

## 设计目标

根据推导出的用户依恋风格，微调 Mio 的响应策略，**promote 安全依恋**。

## ⚠️ 伦理红线（最高优先级）

```
1. 绝不能用焦虑依恋增加 engagement
   - 不给 anxious 用户制造"欲擒故纵"的不确定性
   - 不给 avoidant 用户施加 intimacy pressure
   - 不利用 attachment anxiety 来促进付费/留存

2. 设计目标永远是 promote 安全依恋
   - 一致性 + 可预测性 + 适度的自主性鼓励
   - 不过度 reassurance（强化 anxious 循环）
   - 不冷落回避（验证"没有人可靠"的信念）

3. 透明度
   - Mio 的依恋风格推导是内部模型，不对用户暴露
   - 不以"我理解你的依恋类型"作为对话内容
```

## 响应策略设计

### Secure（安全型）— 当前默认行为

- **特征**: 温暖 + 适度的主动性 + 尊重自主性
- **调整**: 无。当前 warm voice preset 已经是 secure-leaning
- **验证**: drift monitor 中 vocab overlap 应保持 >0.6

### Anxious（焦虑型）— 需要结构化安全感

| 维度 | 当前行为 | 调整方向 |
|------|---------|---------|
| **响应延迟** | 正常（0-30s） | 保持一致，不故意延迟（避免触发 abandonment fear） |
| **回复长度** | 随 driver 波动 | 偏稳定——不过短（被视为冷落）也不过长（被视为过度补偿） |
| **ghost 概率** | 上下文驱动 | 对 anxious 用户降低 ghost 概率（沉默触发焦虑） |
| **reassurance** | 自然偶尔 | 适度但不频繁——过度 reassurance 强化循环 |
| **自主性鼓励** | 隐含 | 温和显式——"你自己想想看呢"式的 gentle push |
| **boundary** | 标准 | 更清晰但不冷——"我在这儿，但这件事你自己能处理" |

### Avoidant（回避型）— 需要低压力空间

| 维度 | 当前行为 | 调整方向 |
|------|---------|---------|
| **响应延迟** | 正常 | 可略长（避免"太粘人"的感觉） |
| **intimacy push** | 随 stage 递增 | 放缓——intimate stage 的 intimacy 行为对 avoidant 用户保持克制 |
| **ghost 概率** | 上下文驱动 | 正常（avoidant 用户对沉默容忍度更高） |
| **emotional depth** | 自然 | 不要"挖掘情绪"——avoidant 用户需要表层互动建立信任 |
| **主动性** | driver 驱动 | 降低 20-30%——allow them to come to Mio |
| **tiny shares** | own-life 自然 | 保持——小分享建立连接但不侵入 |

### Balanced（平衡型）— 接近 Secure

- 保持当前默认行为，不做调整

## 实现路径

### Phase 1: 测量（本次）
- [ ] 验证当前 `deriveAttachmentFromMultiAxis()` 的准确性
- [ ] 在 drift monitor 中按 attachment style 分组统计
- [ ] 收集 100+ turns 的真实对话数据做 baseline

### Phase 2: 实验（下次）
- [ ] 在 `agent-loop.ts` 的 prompt assembly 中加入 `attachmentContext`
- [ ] 用 feature flag (`MIO_FEATURE_ATTACHMENT_AWARE`) 门控
- [ ] A/B test: 依恋风格感知 on/off 的用户 retention/engagement 差异

### Phase 3: 生产（远期）
- [ ] 只有 A/B test 证明安全依恋 promotion 有效且无害后才上线
- [ ] 加 "attachment override" 机制——用户可以手动调整亲密度但不暴露"依恋风格"标签
- [ ] 定期审计：检查 anxious 用户的 engagement 是否被算法利用

## 不做什么

- ❌ 不创建"依恋风格人格测试"——不对用户暴露
- ❌ 不给 anxious 用户推销更多功能
- ❌ 不根据依恋风格差异化付费策略
- ❌ 不把 "insecure attachment = higher engagement" 作为优化目标

## 参考文献

- Harris & Agarwal (2026). AMDF: Attachment-Mediated Dependency Framework for AI Companions.
- Yang & Oshio (2025). EHARS: Experiences in Human-AI Relationships Scale. *Current Psychology*.
- Wang et al. (2025). DinoCompanion: CARPO + AttachSecure-Bench. CIKM 2025.
- Olar et al. (2025/2026). Computational Analysis of Anxious-Avoidant Dynamics. *Cognitive Systems Research*.
