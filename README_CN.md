# Mio

<p align="center">
  <strong>开源情感智能工具包</strong><br>
  可复用的情感引擎 &middot; 知识图谱人格记忆 &middot; 插件架构
</p>

<p align="center">
  <img src="https://img.shields.io/badge/版本-0.6.0-blue" alt="Version">
  <img src="https://img.shields.io/badge/node-%E2%89%A5%2022-brightgreen" alt="Node">
  <img src="https://img.shields.io/badge/协议-MIT-green" alt="License">
  <img src="https://img.shields.io/badge/测试-104-brightgreen" alt="Tests">
</p>

<p align="center">
  <sub><a href="README_CN.md">中文</a> | <a href="README.md">English</a></sub>
</p>

---

Mio **不是一个产品**——它是一个用于构建情感智能应用的组合式工具包，外加一个参考实现（即"Mio"陪伴智能体）。你可以把情感引擎、知识图谱检索、插件系统用在任何自己的项目里，无需引入整个陪伴应用。

## 你可以用它构建什么

- **AI 陪伴应用** — 参考实现内置男友/女友双模式人格 + 关系阶段演进
- **游戏 NPC 对话系统** — 赋予角色持久的人格特质和情感记忆
- **心理健康工具** — 危机检测、情绪状态追踪、依恋风格分析
- **角色扮演聊天机器人** — ID-RAG 让你用单一 `soul.md` 文件定义任意角色
- **学术研究** — PAD 三维模型 + OCEAN 人格演化有心理学理论支撑

## 核心库

### 情感引擎 (`src/emotion/`)

基于心理学的多维情感系统。零 LLM 调用——纯计算。

| 模块 | 说明 | 文件 |
|------|------|------|
| PAD 三维模型 | 愉悦度-唤醒度-支配度 + 指数衰减冷却 | `pad.ts` |
| OCEAN 人格特质 | 五大人格 + "经验→特质"微调闭环 | `experience-trait.ts`, `trait-state.ts` |
| 五轴亲密度 | 亲密度/信任度/私密度/耐心度/紧张度 | `affinity.ts`, `multi-axis.ts` |
| 挫折追踪 | 连续检测、迷你危机触发、依恋风格推导 | `frustration.ts` |
| 幽灵沉默 | 上下文驱动的"已读不回" | `ghost.ts` |
| 意图分类 | 12 类意图匹配（无 LLM） | `classifier.ts` |

### ID-RAG 知识图谱 (`src/persona/`)

用 Markdown 定义角色，推理时只检索相关内容。

```typescript
import { bootstrapGraph } from './persona/extractor.js';
import { retrieveContext } from './persona/graph.js';

const graph = bootstrapGraph(fs.readFileSync('soul.md', 'utf-8'));
const context = retrieveContext(graph, {
  userMessage: "你还记得我们第一次见面吗？",
  maxTokens: 800,
});
// → "你们第一次见面在一个咖啡馆。她当时在读村上春树..."
```

约 800 tokens vs 完整 soul 约 1500 tokens——**节省 47% 上下文窗口**。

### 记忆整合 (`src/memory/`)

夜间管线：评分书签 → 提取实体 → 发现跨会话模式。

```
Phase 1 LIGHT（筛选前 30%）→ Phase 2 DEEP（ACE 质量审计+写入）→ Phase 3 REM（模式提取）
```

### 插件系统 (`src/plugins/`)

在智能体循环的任意生命周期点注入逻辑。

```typescript
registry.register({
  name: 'custom-mood-tracker',
  version: '1.0.0',
  hooks: {
    afterTurn(ctx, result) { /* 记录情感变化 */ },
    getPromptFragment(ctx) { return '<custom>注入数据</custom>'; },
  },
});
```

### 提供商适配器 (`src/providers/`)

9 个 LLM 后端 + 自动检测 + 故障转移链。可扩展。

## 快速开始

```bash
git clone https://github.com/AnxForever/mio.git
cd mio && npm install

# 运行参考实现
MINIMAX_API_KEY="sk-cp-..." MIO_PROVIDER=minimax npm run dev

# 或只引入需要的库
# import { computePAD, decayPAD } from 'mio/emotion/pad.js';
# import { bootstrapGraph } from 'mio/persona/graph.js';
```

## 命令

```bash
npm run build        # 编译 TypeScript
npm run typecheck    # 类型检查
npm run dev          # REPL 交互模式
npm test             # 51 单元 + 41 情感 + 12 冒烟
npm run test:e2e     # Playwright 端到端
```

## 文档

- **[CLAUDE.md](CLAUDE.md)** — 完整架构、设计决策、规范、API 端点
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — 贡献指南
- **[README.md](README.md)** — English documentation

## 运行要求

Node.js ≥ 22 · ESM · 参考应用需要一个 LLM API Key（库本身无需）

## 许可证

MIT © [AnxForever](https://github.com/AnxForever)
