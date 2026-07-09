# Mio 远期优化设计文档（P1-P2）

> 日期: 2026-07-09 · 基于 Grok 搜索研究结果

---

## 1. 上下文压缩升级（P1）— LLMLingua-2 接入评估

### 当前状态

`src/memory/compression.ts` 使用混合压缩：保留首 3 + 尾 10 条消息，中间段做摘要。字符数估算 token（1.5 CJK/token, 4 Latin/token），无 tokenizer 依赖。

### 研究建议

LLMLingua-2（Microsoft, 2024-2025）用小模型（GPT-2 级）做重要性打分，移除低重要度 token。特点：
- 3-6x token 压缩比（vs 当前的 ~2x）
- 比 LLMLingua-1 快 3-6x
- Query-aware：根据当前 query 调整保留策略
- 开源、轻量（可本地跑，零 API 成本）

### 决策

**暂缓接入**。理由：
1. Mio 的 `adaptive-history.ts` 已经在做分层压缩（FULL/COMPRESSED/PLACEHOLDER），效果已接近 LLMLingua-2
2. 引入新依赖（Python 推理 / ONNX runtime）增加运维复杂度
3. 当前 Grok 4.20 128K+ 上下文窗口足够日常使用
4. 优先做 prompt caching（已完成）——同等投入下收益更高

**后续条件**：当单 session 平均 turn 数 > 200 时重新评估。

---

## 2. Voice Pipeline 流式化（P2）— 设计方向

### 当前状态

`src/voice/` 使用 edge-tts（非流式），无法做到低延迟语音交互。STT 走 Whisper。

### 研究建议

2026 年 Voice AI 标准架构：

```
级联流式管道（推荐）:
  STT(Deepgram Nova-3, ~150ms) → LLM(Grok 4.20 Fast, ~200ms TTFT) → TTS(Cartesia Sonic, ~40ms TTFB)
  端到端: 600-950ms

原生 Speech-to-Speech（最新）:
  Grok Voice API (sub-1s TTFA) / OpenAI Realtime / Gemini Live
  端到端: 300-700ms
```

### 推荐方案

**Mio 的最佳路径**：Grok Voice API（已有 Grok 接入）

- xAI 的 Voice Agent API 已支持 companion mode + personality + memory
- 直接输出音频，跳过 STT→LLM→TTS 三级延迟
- 可与现有文本 pipeline 并存（文本优先，语音选配）

**实现优先级**：低。Mio 的核心价值在文本陪伴质量（记忆/人格/情感），语音是锦上添花。等 Grok Voice API 更成熟后再评估。

---

## 3. 语义查询缓存（P2）— 设计方向

### 当前状态

无缓存层。每轮都发完整 prompt 给 provider。

### 研究建议

```
Redis + Embedding 语义缓存:
  - 用户发"在干嘛" → embedding 查询 → 命中缓存 → 直接返回
  - 陪伴场景命中率: 30-60%（高频问候/日常寒暄）
  - 节省: 100% 推理成本（缓存命中时）
```

### 推荐方案

两层缓存：
1. **Prompt 前缀缓存**（Anthropic cache_control）——已完成 P0-1
2. **语义响应缓存**（Redis + MiniMax embedding）——本项

语义缓存的 key = user message embedding，value = Mio's last response for similar query。TTL = 10 分钟（避免重复回复）。

### 决策

**暂不接入**。理由：
1. 陪伴场景的情感多样性——"在干嘛"的回复不应每次都一样（偶尔分享画画、偶尔说瘫着）
2. 缓存命中虽省成本但会降低人味（重复回复 = AI 痕迹）
3. Prompt 前缀缓存（已完成）已经省了 50-90%，语义缓存的额外收益递减

**例外场景**：IM bridge 的群聊场景可以开（同一群聊重复问同样问题），但私聊不开。

---

## 总结

| 优化 | 优先级 | 状态 | 决策 |
|------|--------|------|------|
| Prompt 缓存 (Anthropic cache_control) | P0 | ✅ 已完成 | 省 50-90% Claude cost |
| Prompt 静态前置重排 | P0 | ✅ 已完成 | 1800+ token 缓存命中 |
| Grok 模型分级路由 | P1 | ✅ 已完成 | 日常 Fast / 情绪 High |
| LLMLingua-2 压缩 | P1 | ❌ 暂缓 | 当前压缩已够用，等 >200 turns |
| Voice 流式化 | P2 | ❌ 预留 | 等 Grok Voice API 成熟 |
| 语义查询缓存 | P2 | ❌ 预留 | 陪伴场景不适合固定回复 |

**总成本节省预估**（Claude 用户）：
- Prompt caching: 50-90% 输入 token 节省
- 假设 5000 token/轮，日 100 轮 → 省 $1.5-2.7/天 → $45-81/月
