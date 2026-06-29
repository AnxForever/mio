# Mio

<p align="center">
  <strong>Emotional Companion Agent</strong><br>
  Local-first &middot; Multi-axis emotion &middot; Knowledge-graph memory &middot; Plugin architecture
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.6.0-blue" alt="Version">
  <img src="https://img.shields.io/badge/node-%E2%89%A5%2022-brightgreen" alt="Node">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License">
  <img src="https://img.shields.io/badge/tests-184%20%2B%20e2e-brightgreen" alt="Tests">
</p>

<p align="center">
  <sub><a href="README.md">English</a> | <a href="README_CN.md">中文</a></sub>
</p>

---

Mio is a privacy-first emotional AI companion that runs entirely on your machine — no cloud, no telemetry, no accounts. It ships with boyfriend/girlfriend personas, a PAD 3D emotional model, OCEAN personality traits that evolve through conversation, and a 3-phase nightly memory consolidation pipeline.

## Features

- **PAD 3D Emotion + OCEAN Personality** — dimensional emotion model with exponential decay; Big Five traits evolve via experience-to-trait micro-shifts
- **5-Axis Affinity** — warmth, trust, intimacy, patience, tension each tracked independently with frustration streak detection
- **ID-RAG Knowledge Graph** — persona defined by a single `soul.md`; context-aware subgraph retrieval (~800 tokens vs ~1500 full soul)
- **3-Phase Memory Consolidation** — nightly Light→Deep→REM pipeline with ACE quality reflection
- **Plugin Architecture** — lifecycle hooks with dependency resolution; 5 built-in emotion plugins
- **9 LLM Backends** — Anthropic, OpenAI, DeepSeek, Moonshot, GLM, MiniMax, Qwen, Doubao, SiliconFlow with auto-detection and fallback chain
- **Crisis Detection** — two-tier keyword system (yellow/red) with automatic escalation
- **Zero-Framework Web UI** — Canvas emotion-driven avatar, SPA router, WebSocket full-duplex chat
- **Voice** — STT (Whisper) + TTS (edge-tts)
- **Notifications** — Telegram, Discord, Slack, Webhook

## Quick Start

```bash
git clone https://github.com/AnxForever/mio.git
cd mio && npm install
MINIMAX_API_KEY="sk-cp-..." MIO_PROVIDER=minimax npm run dev
```

## How It Works

```
User message → classify intent → update PAD 3D state → update affinity axes
  → retrieve persona context (ID-RAG) → build prompt → LLM inference
  → analyze response signals → update emotion → check ghost/crisis → reply
```

Nightly: bookmarks scored → top 30% deep-processed → entities written → patterns extracted → memory curated.

## Project Structure

```
src/
├── emotion/      PAD 3D, OCEAN traits, 5-axis affinity, ghost, frustration
├── memory/       3-phase consolidation, ACE reflector, hybrid compression
├── persona/      ID-RAG knowledge graph, dual-mode switching
├── plugins/      Registry + 5 built-in emotion plugins
├── providers/    9 LLM backends + fallback chain
├── server/       Express + WebSocket, auth, analytics, search
├── scheduler/    Nightly pipeline, Poisson-based proactive messaging
└── web/          Zero-framework Canvas SPA

packages/
├── emotion/      @mio/emotion — standalone emotion engine package
└── idrag/        @mio/idrag — standalone knowledge graph package
```

## Providers

| Env Variable | Provider | Model |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude | `claude-sonnet-4-20250514` |
| `OPENAI_API_KEY` | OpenAI | `gpt-4o` |
| `DEEPSEEK_API_KEY` | DeepSeek | `deepseek-chat` |
| `MOONSHOT_API_KEY` | Moonshot / Kimi | `moonshot-v1-8k` |
| `ZHIPU_API_KEY` | GLM | `glm-4-flash` |
| `MINIMAX_API_KEY` | MiniMax | `MiniMax-M3` |
| `DASHSCOPE_API_KEY` | Qwen | `qwen-plus` |
| `DOUBAO_API_KEY` | Doubao | `doubao-pro-32k` |
| `SILICONFLOW_API_KEY` | SiliconFlow | `deepseek-ai/DeepSeek-V3` |

## Commands

```bash
npm run build        # tsc + workspace packages
npm run typecheck    # root + workspace typecheck
npm run dev          # REPL
npm test             # 184 checks (core + web view-models)
npm run test:e2e     # Playwright E2E tests
```

## Documentation

- **[AGENTS.md](AGENTS.md)** — architecture, design decisions, API endpoints, conventions (source of truth)
- **[docs/deployment.md](docs/deployment.md)** — production deployment, Docker/systemd, reverse proxy, CORS, health checks, logs
- **[docs/im-bridge.md](docs/im-bridge.md)** — OpenAI-compatible bridge for WeChat, QQ, ChatGPT-like clients, and custom gateways
- **[docs/humanlike-agent-architecture.md](docs/humanlike-agent-architecture.md)** — Chinese technical architecture explanation for the humanlike companion design
- **[docs/north-star-architecture.md](docs/north-star-architecture.md)** — Chinese north-star architecture: the self loop
- **[docs/architecture/](docs/architecture/)** — ADRs (architecture decisions) and RFCs (improvement proposals)
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — setup, code style, PR process
- **[README_CN.md](README_CN.md)** — 中文

## Requirements

Node.js ≥ 22 · ESM · One LLM API key

## License

MIT © [AnxForever](https://github.com/AnxForever)
