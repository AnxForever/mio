# Mio

<p align="center">
  <strong>情感陪伴智能体</strong><br>
  多轴情感引擎 &middot; 知识图谱记忆 &middot; 插件架构 &middot; 本地优先
</p>

<p align="center">
  <img src="https://img.shields.io/badge/版本-0.6.0-blue" alt="Version">
  <img src="https://img.shields.io/badge/node-%E2%89%A5%2022-brightgreen" alt="Node">
  <img src="https://img.shields.io/badge/协议-MIT-green" alt="License">
  <img src="https://img.shields.io/badge/测试-108%20通过-brightgreen" alt="Tests">
</p>

---

Mio 是一个完全运行在本机的情感 AI 陪伴智能体——无需云服务、无遥测、无用户账号。内置男友/女友双模式人格，配备模拟神经科学的 3 阶段夜间记忆整合管线、基于 PAD 三维情感模型的 OCEAN 人格特质系统，以及模块化插件架构。所有状态数据存储在本地 JSON 文件中，你对每一字节拥有完全控制权。

## 架构总览

```
┌─────────────────────────────────────────────────────────┐
│                     Agent Loop (智能体主循环)              │
│  prompt → inference (9 个 LLM 后端) → tools → effects    │
└──────────────────────────┬──────────────────────────────┘
                           │
     ┌─────────────────────┼─────────────────────┐
     ▼                     ▼                     ▼
┌──────────┐    ┌──────────────────┐    ┌──────────────┐
│ Emotion  │    │     Memory       │    │   Persona    │
│ (情感)   │    │     (记忆)       │    │   (人格)     │
│ ──────── │    │  ─────────────── │    │  ─────────── │
│ PAD 3D   │    │  3 阶段整合      │    │  ID-RAG 知识 │
│ OCEAN    │    │  ACE 反射器      │    │  图谱        │
│ 5 轴亲密 │    │  混合压缩        │    │  双模式切换  │
│ 幽灵沉默 │    │  实体图谱        │    │  soul.md     │
│ 挫折追踪 │    │  程序化记忆      │    │  生成器      │
└──────────┘    └──────────────────┘    └──────────────┘
     │                     │                     │
     └─────────────────────┼─────────────────────┘
                           ▼
     ┌─────────────────────────────────────────┐
     │          Plugin Registry (插件注册中心)   │
     │  onLoad / beforeTurn / afterTurn / hooks │
     └─────────────────────────────────────────┘
                           │
                           ▼
     ┌─────────────────────────────────────────┐
     │       Server (Express + WebSocket)       │
     │  REST + SSE 流式 + WS 全双工 + 通知推送   │
     └─────────────────────────────────────────┘
```

## 核心技术系统

### PAD 三维情感模型 (Pleasure-Arousal-Dominance)

用维度化情感模型取代关键词匹配式情感分析。每次交互都会更新 Mio 在 **愉悦度-唤醒度-支配度** 三维空间中的位置，进而驱动虚拟形象表情（面部特征、语音语调、姿态）并影响回复生成。三个维度均按指数衰减向中性回归——模拟人类情绪的"冷却回落"机制。

```
Pleasure  [0..1]  — 愉悦度：积极/消极
Arousal   [0..1]  — 唤醒度：兴奋/平静
Dominance [0..1]  — 支配度：主动/顺从
```

结合 **OCEAN 五大人格特质**（开放性 Openness、尽责性 Conscientiousness、外向性 Extraversion、宜人性 Agreeableness、神经质 Neuroticism），通过"经验→特质"微调反馈实现人格演化——一个闭环系统，用户的交互模式在数周内会切实改变 Mio 的性格。

**相关文件**: `src/emotion/pad.ts`, `src/emotion/experience-trait.ts`, `src/emotion/trait-state.ts`, `src/server/avatar.ts`

### 五轴亲密度系统 (5-Axis Affinity)

在五个独立维度上追踪关系深度，每个维度有各自的更新函数和衰减曲线：

| 轴 (Axis) | 范围 | 含义 |
|-----------|------|------|
| `warmth` (亲密度) | 0–100 | 情感亲近程度 |
| `trust` (信任度) | 0–100 | 可靠性信心 |
| `intimacy` (私密度) | 0–100 | 自我暴露深度 |
| `patience` (耐心度) | 0–100 | 挫折容忍度 |
| `tension` (紧张度) | 0–100 | 关系摩擦指数 |

**挫折追踪 (Frustration Tracking)** 监测用户冷淡/忽视行为的连续次数。当 `frustrationStreak >= 3 && tension > 50` 时触发迷你危机并自动标记。**依恋风格 (Attachment Style)**（安全型/焦虑型/回避型/混乱型）从亲密轴比率推导，影响回复策略。

**相关文件**: `src/emotion/affinity.ts`, `src/emotion/multi-axis.ts`, `src/emotion/frustration.ts`

### ID-RAG 人格知识图谱 (Persona Knowledge Graph)

每个人格由单一的 `soul.md` 文件定义——代码中不存在重复的人格规则。启动时，soul 被引导构建为**知识图谱**（实体为节点，关系为边）。推理时仅检索上下文最相关的子图（约 800 tokens，对比完整 soul 的约 1500 tokens），使人格深度可无限扩展而不撑爆上下文窗口。

**相关文件**: `src/persona/graph.ts`, `src/persona/extractor.ts`, `src/persona/generator.ts`, `src/persona/driver.ts`

### 三阶段夜间记忆整合 (3-Phase Nightly Consolidation)

模拟睡眠依赖的记忆巩固周期：

```
Phase 1 — LIGHT (筛选)
  按重要性打分：频率×0.3 + 新鲜度×0.4 + 情感权重×0.3
  选取前 30% 进入深度处理。

Phase 2 — DEEP (写入)
  提取结构化实体 → ACE 质量审计 → 写入：
    structured-memory.json、用户画像、关系、灵魂

Phase 3 — REM (模式提取)
  扫描全部书签寻找跨会话模式。
  生成程序化记忆规则。追加至 procedural-memory.json。
```

**ACE 反射器 (ACE Reflector)** 后处理记忆质量：丢弃低质量实体、削弱过时实体、合并重复实体。每个实体携带 `qualityScore` 随时间衰减，确保记忆库持续精炼。

**相关文件**: `src/memory/consolidation-phases.ts`, `src/memory/structured-memory.ts`, `src/memory/reflector.ts`, `src/memory/procedural-memory.ts`

### 混合上下文压缩 (Hybrid Context Compression)

当对话历史超出 LLM 的 token 预算时，上下文引擎采用**保留首段 + 保留末段 + 压缩中段**策略。每个 prompt 段落有独立的 token 预算，可配置上限。在保留对话连续性的同时（最近轮次保持原文），防止上下文窗口溢出（较早轮次压缩为摘要）。

**相关文件**: `src/memory/compression.ts`, `src/prompt/context-engine.ts`, `src/utils/prompt-budget.ts`

### 插件架构 (Plugin Architecture)

```typescript
interface Plugin {
  name: string;                    // 插件唯一标识
  version: string;                 // 版本号
  hooks: {                          // 生命周期钩子
    onLoad?(): Promise<void>;      // 加载时
    onUnload?(): Promise<void>;    // 卸载时
    beforeTurn?(ctx: SessionContext): Promise<SessionContext>;  // 对话前
    afterTurn?(ctx: SessionContext, result: TurnResult): Promise<void>; // 对话后
    getPromptFragment?(ctx: SessionContext): Promise<string>;   // 提示片段注入
  };
  commands?: PluginCommand[];       // 自定义 REPL 命令
  dependencies?: string[];          // 依赖插件（优先加载）
}
```

五个内置插件（`ghost`、`affinity`、`pad`、`frustration` 及插件索引）将情感模块封装为可插拔钩子。注册中心处理依赖解析、加载顺序和安全卸载。

**相关文件**: `src/plugins/registry.ts`, `src/plugins/types.ts`, `src/plugins/builtins/`

### 危机检测 (Crisis Detection)

基于两级关键词系统的自动升级机制：

| 等级 | 触发条件 | 响应策略 |
|------|---------|---------|
| **黄色 (Yellow)** | 隐晦求救信号（如"撑不住"、"好累"、"想哭"、"不想说话"） | 标记、温和关注 |
| **红色 (Red)** | 明确自伤表述（如"结束生命"、自杀相关关键词） | 完整危机协议、书签标记、升级信息 |

**相关文件**: `src/safety/crisis.ts`

### 幽灵沉默机制 (Ghost Silence)

Mio 有时会选择**不回复**——模拟人类"已读不回"的行为。触发条件基于上下文判断：
- 用户消息极短（"嗯"、"哦"、"好吧"）且对话处于活跃状态
- 用户发出结束信号（"睡了"、"去忙了"、"先这样"）
- Mio 能量低 + 亲密度适中（疲劳但非痛苦）
- **永不连续 ghost 两次**

**相关文件**: `src/emotion/ghost.ts`

### 智能主动消息 (Smart Proactive)

基于 **泊松过程 (Poisson Process)** 的主动消息系统，结合贝叶斯响应概率预测：
- 替代固定 cron 定时发送
- 根据用户历史活跃时段动态调整发送概率
- 用户更可能回复的时段获得更高发送权重

**相关文件**: `src/scheduler/smart-proactive.ts`, `src/scheduler/proactive.ts`

---

## 快速开始

```bash
git clone https://github.com/AnxForever/mio.git
cd mio
npm install

# CLI 交互模式 — 设置一个 LLM API key 即可
MINIMAX_API_KEY="sk-cp-..." MIO_PROVIDER=minimax npm run dev

# Web 界面 — http://localhost:3000
MINIMAX_API_KEY="sk-cp-..." MIO_PROVIDER=minimax npm start serve
```

## LLM 提供商后端

设置一个环境变量即可，`MIO_PROVIDER=auto` 时自动检测。内置**故障转移链 (Fallback Chain)**——主提供商不可用时自动切换至下一个。

| 环境变量 | 提供商 | 默认模型 |
|---|---|---|
| `ANTHROPIC_API_KEY` | Anthropic Claude | `claude-sonnet-4-20250514` |
| `OPENAI_API_KEY` | OpenAI | `gpt-4o` |
| `DEEPSEEK_API_KEY` | DeepSeek（深度求索） | `deepseek-chat` |
| `MOONSHOT_API_KEY` | Moonshot / Kimi（月之暗面） | `moonshot-v1-8k` |
| `ZHIPU_API_KEY` | 智谱 / GLM | `glm-4-flash` |
| `MINIMAX_API_KEY` | MiniMax（稀宇科技） | `MiniMax-M3` |
| `DASHSCOPE_API_KEY` | Qwen / 通义千问（阿里云） | `qwen-plus` |
| `DOUBAO_API_KEY` | Doubao / 豆包（字节跳动） | `doubao-pro-32k` |
| `SILICONFLOW_API_KEY` | SiliconFlow（硅基流动） | `deepseek-ai/DeepSeek-V3` |

额外后端通过 `src/providers/lora-adapter.ts`（LoRA 人格适配器）和 `src/providers/mock.ts`（离线测试）提供。

## API 参考

### 核心接口

| 方法 | 端点 | 说明 |
|--------|----------|-------------|
| `POST` | `/chat` | 发送消息 `{ text, sessionId? }`，返回完整回复 |
| `POST` | `/chat/stream` | SSE 流式对话 |
| `POST` | `/mod` | 切换人格 `{ name: "boyfriend" \| "girlfriend" }` |
| `WS` | `/ws` | 全双工 WebSocket：对话、虚拟形象状态、情感事件、心跳 |
| `GET` | `/status` | 运行时状态快照（情感、亲密度、关系阶段） |
| `GET` | `/health` | 健康检查 |

### 数据分析

| 方法 | 端点 | 说明 |
|--------|----------|-------------|
| `GET` | `/analytics` | 完整分析快照 |
| `GET` | `/analytics/emotion?days=30` | 情感趋势数据 |
| `GET` | `/analytics/topics` | 话题频率热力图 |
| `GET` | `/analytics/relationship` | 关系进展时间线 |
| `GET` | `/analytics/conversation` | 对话统计 |
| `GET` | `/search?q=&session=&role=&limit=` | 全文对话记录搜索 |

### 消息通知

| 方法 | 端点 | 说明 |
|--------|----------|-------------|
| `GET` | `/notify/channels` | 列出已配置的通知渠道 |
| `POST` | `/notify/test` | 向所有渠道发送测试消息 |
| `POST` | `/notify/test/telegram` | 测试 Telegram |
| `POST` | `/notify/test/discord` | 测试 Discord |
| `POST` | `/notify/test/slack` | 测试 Slack |
| `POST` | `/notify/test/webhook` | 测试 Webhook |

### 管理

| 方法 | 端点 | 说明 |
|--------|----------|-------------|
| `GET` | `/admin/backups` | 列出现有备份 |
| `POST` | `/admin/backup` | 创建新备份 (tar.gz) |
| `POST` | `/admin/backups/prune` | 清理旧备份 |
| `GET` | `/admin/export` | 导出全部记忆为纯文本 |

### 首次引导

| 方法 | 端点 | 说明 |
|--------|----------|-------------|
| `GET` | `/onboarding/status` | 查看引导进度 |
| `POST` | `/onboarding/start` | 开始首次设置 |
| `POST` | `/onboarding/next` | 进入下一个引导步骤 |

### 身份认证

设置 `MIO_AUTH_TOKEN` 环境变量以启用 Bearer Token 认证。所有 `POST` 和 `WS` 端点将要求 `Authorization: Bearer <token>` 头。使用常数时间比较防止时序攻击。

**相关文件**: `src/server/auth.ts`

---

## 命令

```bash
npm run build       # 编译 TypeScript → dist/
npm run typecheck   # 仅类型检查 (tsc --noEmit)
npm run dev         # 启动 REPL (tsx src/index.ts)
npm start           # 运行编译后的服务 (node dist/index.js)
npm test            # 完整测试套件: 54 单元 + 42 情感 + 12 冒烟
npm run test:e2e    # Playwright 浏览器端到端测试
npm run test:emotion # 仅情感模块测试
```

## 项目结构

```
src/
├── core/agent-loop.ts          # 主循环：prompt → 推理 → 工具 → 副作用
├── config.ts                   # 配置中心 + 9 个提供商预设
├── types.ts                    # 共享类型定义
├── providers/                  # 9 个 LLM 后端 + 故障转移 + 路由器 + LoRA 适配器
├── emotion/                    # PAD 三维情感、OCEAN 人格、5 轴亲密、幽灵沉默、挫折追踪
├── persona/                    # ID-RAG 知识图谱 + 人格驱动 + 双模式切换
├── memory/                     # 3 阶段整合、实体提取、嵌入向量、全文搜索、压缩
├── learning/                   # 动态 Few-shot、用户反馈、镜像自建模
├── plugins/                    # 插件注册中心 + 5 个内置情感插件
├── relationship/               # 4 阶段关系进展 + 阶段门控
├── prompt/                     # 模板构建、上下文引擎（预算感知）、XML 上下文块
├── scheduler/                  # 夜间管线、智能主动消息（泊松过程）
├── server/                     # Express + WebSocket、认证、形象、分析、通知、搜索
├── tools/                      # 文件、会话、定时、回忆、情感、工作 7 个工具
├── subagent/                   # 子智能体：生成、整合、日记
├── safety/                     # 危机检测（红/黄两级）
├── voice/                      # 语音识别 (Whisper) + 语音合成 (edge-tts)
├── vision/                     # 图像预处理 (Sharp)
├── onboarding/                 # 首次引导设置
├── utils/                      # 日志、备份、prompt 预算、数学工具
└── mod/                        # 人格 mod 生命周期管理

web/                            # 零框架单页应用
├── css/                        # 设计令牌、重置样式、按视图拆分样式表
├── js/
│   ├── app.js                  # 应用入口
│   ├── router.js               # 客户端 SPA 路由
│   ├── store.js                # 响应式状态存储
│   ├── ws.js                   # WebSocket 客户端
│   ├── api.js                  # REST API 客户端
│   ├── views/                  # chat, studio, analytics, settings, onboarding, auth
│   ├── components/             # bubble, emotion-ball, tab-bar, toast
│   └── utils/                  # DOM, easing, time, haptics, constants
└── index.html

tests/
├── unit.ts                     # 54 项单元测试
├── unit-emotion.ts             # 42 项情感模块测试
├── smoke.ts                    # 12 项 HTTP/WS 集成测试
└── e2e/                        # Playwright 端到端测试
```

## 设计决策

- **Persona = soul.md 单一来源**。提示模板中不重复人格规则。mod 的 `soul.md` 是唯一真相来源。
- **ID-RAG 替代全量 soul 注入**。知识图谱检索将人格 token 成本降低约 47%。
- **PAD 维度模型替代关键词匹配**。实现平滑的情感过渡和多维状态表示。
- **插件封装，非重写**。情感模块（ghost, affinity, pad, frustration）以插件形式封装，同时保留原有 API。
- **结构化 JSON 记忆替代散文摘要**。带质量评分的实体达到约 95% 保留率，对比散文约 70%。
- **混合压缩替代截断**。保留首段 + 保留末段 + 压缩中段，同时保留上下文连续性和新鲜度。
- **泊松主动消息替代固定定时**。基于概率的消息系统适应用户活跃模式。
- **所有磁盘路径统一通过 `src/memory/paths.ts`**。每个文件系统引用的单一真相来源。

## 状态文件 (位于 `data/` 目录)

```
emotion-state.json              # 当前情感向量
affinity-state.json             # 5 轴亲密度值
pad-state.json                  # PAD 三维坐标
relationship-state.json         # 当前关系阶段
ritual-state.json               # 仪式检测状态
cardboard-state.json            # 纸板质量评分
personality-state.json          # OCEAN 特质值
entity-graph.json               # 实体关系图谱
fewshot-bank.json               # Few-shot 示例库
feedback-state.json             # 用户反馈记录
mirror-profile.json             # 自建模画像
memory-bank/
  MEMORY.md, BOOKMARKS.md
  structured-memory.json
  persona-graph.json
  procedural-memory.json
  cola-self-reference/          # soul.md, user-profile.md, relationship.md, 日记
transcripts/<sessionId>.jsonl   # 仅追加的对话日志
backups/                        # tar.gz 归档
```

## 环境变量

完整参考见 [`.env.example`](.env.example)。核心变量：

| 变量 | 默认值 | 说明 |
|----------|---------|-------------|
| `MIO_PROVIDER` | `auto` | LLM 提供商预设 |
| `MIO_HTTP_PORT` | `0`（自动） | 服务器监听端口 |
| `MIO_AUTH_TOKEN` | — | API 认证 Bearer Token |
| `MIO_DIR` | `./data` | 数据目录路径 |
| `MIO_LOG_LEVEL` | `info` | 日志级别 (debug/info/warn/error) |
| `MIO_LOG_FORMAT` | `text` | 日志格式 (text/json) |
| `MIO_NIGHTLY_CRON` | `30 21 * * *` | 夜间整合调度 |
| `MIO_FEATURE_GHOST` | `true` | 幽灵沉默机制 |
| `MIO_FEATURE_AFFINITY` | `true` | 多轴亲密度 |
| `MIO_PAD_ENABLED` | `true` | PAD 情感模型 |
| `MIO_SMART_PROACTIVE` | `true` | 泊松主动消息 |

## 运行要求

- **Node.js** >= 22
- **ESM** (`"type": "module"`)
- 一个 LLM 提供商 API Key（见 [LLM 提供商后端](#llm-提供商后端)）

## 文档

- **[CLAUDE.md](CLAUDE.md)** — 完整架构参考、编码规范、设计决策
- **[README.md](README.md)** — English documentation
- **[.env.example](.env.example)** — 全部环境变量及说明

## 许可证

MIT © [AnxForever](https://github.com/AnxForever)
