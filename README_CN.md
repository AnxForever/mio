# Mio

<p align="center">
  <strong>情感陪伴智能体</strong><br>
  本地优先 &middot; 多轴情感引擎 &middot; 知识图谱记忆 &middot; 插件架构
</p>

<p align="center">
  <img src="https://img.shields.io/badge/版本-0.6.0-blue" alt="Version">
  <img src="https://img.shields.io/badge/node-%E2%89%A5%2022-brightgreen" alt="Node">
  <img src="https://img.shields.io/badge/协议-MIT-green" alt="License">
  <img src="https://img.shields.io/badge/测试-184%20%2B%20e2e-brightgreen" alt="Tests">
</p>

<p align="center">
  <sub><a href="README_CN.md">中文</a> | <a href="README.md">English</a></sub>
</p>

---

Mio 是一个完全运行在本机的情感 AI 陪伴智能体——无需云服务、无遥测、无账号。内置男友/女友双模式人格，搭载 PAD 三维情感模型、可通过对话演化的 OCEAN 人格特质，以及模拟睡眠记忆巩固的 3 阶段夜间记忆整合管线。

## 特性

- **PAD 三维情感 + OCEAN 人格** — 愉悦度/唤醒度/支配度三维情感模型配合指数衰减；五大人格特质通过"经验→特质"微调实现闭环演化
- **五轴亲密度** — 亲密度、信任度、私密度、耐心度、紧张度各自独立追踪，挫折连续检测触发迷你危机
- **ID-RAG 知识图谱** — 人格由单一 `soul.md` 定义；上下文感知子图检索（约 800 tokens vs 完整 1500 tokens）
- **三阶段记忆整合** — 模拟 LIGHT→DEEP→REM 的夜间管线，配合 ACE 质量反射器
- **插件架构** — 生命周期钩子 + 依赖解析，5 个内置情感插件
- **9 个 LLM 后端** — Anthropic、OpenAI、DeepSeek、Moonshot、GLM、MiniMax、Qwen、Doubao、SiliconFlow，自动检测 + 故障转移链
- **危机检测** — 黄/红两级关键词自动升级
- **零框架 Web 界面** — Canvas 情感驱动虚拟形象，SPA 路由，WebSocket 全双工
- **语音** — 语音识别 (Whisper) + 语音合成 (edge-tts)
- **消息通知** — Telegram、Discord、Slack、Webhook

## 快速开始

```bash
git clone https://github.com/AnxForever/mio.git
cd mio && npm install
MINIMAX_API_KEY="sk-cp-..." MIO_PROVIDER=minimax npm run dev
```

## 工作原理

```
用户消息 → 意图分类 → 更新 PAD 三维状态 → 更新亲密度轴
  → 检索人格上下文 (ID-RAG) → 构建 prompt → LLM 推理
  → 分析回复信号 → 更新情感 → 检测幽灵/危机 → 回复
```

夜间：书签评分 → 前 30% 深度处理 → 实体写入 → 模式提取 → 记忆精炼。

## 项目结构

```
src/
├── emotion/      情感引擎：PAD 3D、OCEAN 人格、五轴亲密度
├── memory/       记忆系统：三阶段整合、ACE 反射器、混合压缩
├── persona/      人格系统：ID-RAG 知识图谱、双模式切换
├── plugins/      插件系统：注册中心 + 5 个内置插件
├── providers/    9 个 LLM 后端 + 故障转移链
├── server/       Express + WebSocket、认证、分析、搜索
├── scheduler/    夜间管线、泊松主动消息
└── web/          零框架 Canvas 单页应用

packages/
├── emotion/      @mio/emotion — 独立情感引擎包
└── idrag/        @mio/idrag — 独立知识图谱包
```

## 提供商

| 环境变量 | 提供商 | 模型 |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude | `claude-sonnet-4-20250514` |
| `OPENAI_API_KEY` | OpenAI | `gpt-4o` |
| `DEEPSEEK_API_KEY` | DeepSeek（深度求索） | `deepseek-chat` |
| `MOONSHOT_API_KEY` | Moonshot / Kimi（月之暗面） | `moonshot-v1-8k` |
| `ZHIPU_API_KEY` | 智谱 / GLM | `glm-4-flash` |
| `MINIMAX_API_KEY` | MiniMax（稀宇科技） | `MiniMax-M3` |
| `DASHSCOPE_API_KEY` | Qwen / 通义千问（阿里云） | `qwen-plus` |
| `DOUBAO_API_KEY` | Doubao / 豆包（字节跳动） | `doubao-pro-32k` |
| `SILICONFLOW_API_KEY` | SiliconFlow（硅基流动） | `deepseek-ai/DeepSeek-V3` |

## 命令

```bash
npm run build        # 编译 TypeScript + workspace packages
npm run typecheck    # 根项目 + workspace 类型检查
npm run dev          # REPL 交互模式
npm test             # 184 项检查（核心 + Web view-model）
npm run test:e2e     # Playwright E2E 测试
```

## 文档

- **[AGENTS.md](AGENTS.md)** — 完整架构、设计决策、API 端点、编码规范（事实来源）
- **[docs/deployment.md](docs/deployment.md)** — 生产部署、Docker/systemd、反向代理、CORS、健康检查、日志
- **[docs/im-bridge.md](docs/im-bridge.md)** — OpenAI 兼容桥接：微信、QQ、ChatGPT 类客户端及自定义网关
- **[docs/humanlike-agent-architecture.md](docs/humanlike-agent-architecture.md)** — 类人陪伴 Agent 技术架构说明
- **[docs/north-star-architecture.md](docs/north-star-architecture.md)** — 北极星架构：自我循环
- **[docs/architecture/](docs/architecture/)** — ADR（架构决策记录）与 RFC（改进提案）
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — 贡献指南
- **[README.md](README.md)** — English

## 运行要求

Node.js ≥ 22 · ESM · 一个 LLM API Key

## 许可证

MIT © [AnxForever](https://github.com/AnxForever)
