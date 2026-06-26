# Mio

<p align="center">
  <strong>Emotional Companion Agent</strong><br>
  Local-first &middot; Multi-axis emotion engine &middot; Plugin architecture
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.6.0-blue" alt="Version">
  <img src="https://img.shields.io/badge/node-%E2%89%A5%2022-brightgreen" alt="Node">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License">
  <img src="https://img.shields.io/badge/tests-104-brightgreen" alt="Tests">
</p>

<p align="center">
  <sub><a href="README.md">English</a> | <a href="README_CN.md">中文</a></sub>
</p>

---

Mio is a privacy-first emotional AI companion that runs entirely on your machine — no cloud, no telemetry, no accounts. It ships with boyfriend/girlfriend personas, a PAD 3D emotional model, OCEAN personality traits that evolve through conversation, and a 3-phase nightly memory consolidation pipeline inspired by sleep neuroscience.

## Key Features

- **PAD 3D Emotion + OCEAN Personality** — dimensional emotion model with exponential decay; Big Five traits evolve via experience-to-trait micro-shifts
- **5-Axis Affinity** — warmth, trust, intimacy, patience, tension each tracked independently with frustration streak detection and attachment style derivation
- **ID-RAG Knowledge Graph** — persona defined by a single `soul.md`; context-aware subgraph retrieval (~800 tokens vs ~1500 full soul)
- **3-Phase Memory Consolidation** — nightly Light→Deep→REM pipeline with ACE quality reflection (dedup, weaken, merge)
- **Plugin Architecture** — lifecycle hooks (`onLoad`, `beforeTurn`, `afterTurn`) with dependency resolution; 5 built-in emotion plugins
- **Smart Proactive** — Poisson-process messaging replaces fixed cron; adapts to user activity patterns
- **Crisis Detection** — two-tier keyword system (yellow/red) with automatic escalation
- **Zero-Framework Web UI** — Canvas-rendered emotion-driven avatar, SPA router, WebSocket full-duplex chat

## Quick Start

```bash
git clone https://github.com/AnxForever/mio.git
cd mio && npm install

# Set ONE provider key
MINIMAX_API_KEY="sk-cp-..." MIO_PROVIDER=minimax npm run dev   # CLI REPL
MINIMAX_API_KEY="sk-cp-..." MIO_PROVIDER=minimax npm start serve  # Web UI → :3000
```

## LLM Providers

Set one key — auto-detected with `MIO_PROVIDER=auto`. Automatic fallback chain on failure.

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
npm run build       # tsc → dist/
npm run typecheck   # tsc --noEmit
npm run dev         # tsx src/index.ts (REPL)
npm start           # node dist/index.js
npm test            # 54 unit + 42 emotion + 12 smoke
npm run test:e2e    # Playwright E2E
```

## Documentation

Full architecture, design decisions, API endpoints, conventions, and state file layout → **[CLAUDE.md](CLAUDE.md)**

## Requirements

Node.js ≥ 22 · ESM · One LLM API key

## License

MIT © [AnxForever](https://github.com/AnxForever)
