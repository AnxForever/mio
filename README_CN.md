# Mio

<p align="center">
  <strong>情感陪伴智能体</strong><br>
  本地优先 &middot; 多轴情感引擎 &middot; 插件架构
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

Mio 是一个完全运行在本机的情感 AI 陪伴智能体——无需云服务、无遥测、无账号。内置男友/女友双模式人格，搭载 PAD 三维情感模型、可通过对话演化的 OCEAN 人格特质，以及模拟睡眠记忆巩固的 3 阶段夜间记忆整合管线。

## 核心特性

- **PAD 三维情感 + OCEAN 人格** — 维度化情感模型（愉悦度/唤醒度/支配度）配合指数衰减；五大人格特质通过"经验→特质"微调实现闭环演化
- **五轴亲密度系统** — 亲密度、信任度、私密度、耐心度、紧张度各自独立追踪；挫折连续检测触发迷你危机；依恋风格自动推导
- **ID-RAG 知识图谱** — 人格由单一 `soul.md` 文件定义；上下文感知子图检索（约 800 tokens vs 完整 soul 约 1500 tokens）
- **三阶段记忆整合** — 模拟 LIGHT（筛选）→ DEEP（写入）→ REM（模式提取）的夜间管线，配合 ACE 质量反射器（去重、衰减、合并）
- **插件架构** — 生命周期钩子（`onLoad`、`beforeTurn`、`afterTurn`）+ 依赖解析；5 个内置情感插件
- **智能主动消息** — 泊松过程替代固定定时，根据用户活跃模式动态调整发送概率
- **危机检测** — 黄/红两级关键词触发自动升级
- **零框架 Web 界面** — Canvas 情感驱动虚拟形象 + SPA 路由 + WebSocket 全双工对话

## 快速开始

```bash
git clone https://github.com/AnxForever/mio.git
cd mio && npm install

# 设置一个 LLM API key 即可
MINIMAX_API_KEY="sk-cp-..." MIO_PROVIDER=minimax npm run dev   # CLI 交互模式
MINIMAX_API_KEY="sk-cp-..." MIO_PROVIDER=minimax npm start serve  # Web 界面 → :3000
```

## LLM 提供商

设置一个环境变量即可，`MIO_PROVIDER=auto` 自动检测。内置故障转移链。

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
npm run build       # 编译 TypeScript → dist/
npm run typecheck   # 仅类型检查
npm run dev         # 启动 REPL
npm start           # 运行编译后服务
npm test            # 54 单元 + 42 情感 + 12 冒烟测试
npm run test:e2e    # Playwright 端到端测试
```

## 文档

完整架构、设计决策、API 端点、编码规范、状态文件布局 → **[CLAUDE.md](CLAUDE.md)**

## 运行要求

Node.js ≥ 22 · ESM · 一个 LLM API key

## 许可证

MIT © [AnxForever](https://github.com/AnxForever)
