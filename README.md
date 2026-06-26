# Mio 💕

> Emotional companion agent — switchable boyfriend/girlfriend persona with multi-axis emotion engine, plugin architecture, and web UI.

**v0.6.0** | [MIT License](LICENSE)

Mio is a privacy-first emotional AI companion that lives entirely on your machine. No cloud, no telemetry, no accounts. It comes with two built-in personas (boyfriend/girlfriend) and a modular plugin system that lets you extend everything from emotional axes to notification channels.

## Quick Start

```bash
# Clone + install
git clone https://github.com/AnxForever/mio.git
cd mio
npm install

# Set ONE provider key + run the CLI
MINIMAX_API_KEY="sk-cp-..." MIO_PROVIDER=minimax npm run dev

# Or serve the web UI (http://localhost:3000)
MINIMAX_API_KEY="sk-cp-..." MIO_PROVIDER=minimax npm run build && node dist/index.js serve
```

## Features

- 🎭 **Switchable Personas** — boyfriend or girlfriend, with relationship stages that evolve over time
- 💓 **Multi-Axis Emotion** — PAD 3D model + 5-axis affinity + OCEAN personality traits
- 🧠 **3-Phase Memory** — Light→Deep→REM nightly consolidation with ACE-style quality reflection
- 🔌 **Plugin System** — register/unregister/hooks for emotion/ghost/affinity modules
- 🌐 **Web UI** — zero-framework Canvas-based chat interface with emotion-driven avatar
- 🔒 **Local-First** — all data stays on your machine, no accounts, no telemetry
- 📱 **Notifications** — Telegram, Webhook, Discord, Slack, WhatsApp channels
- 🛡️ **Crisis Detection** — red/yellow keyword levels with automatic escalation

## LLM Providers

Set ONE environment variable — auto-detected when `MIO_PROVIDER=auto`:

| API Key Env | Provider | Default Model |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude | `claude-sonnet-4-20250514` |
| `DEEPSEEK_API_KEY` | DeepSeek | `deepseek-chat` |
| `MOONSHOT_API_KEY` | Moonshot/Kimi | `moonshot-v1-8k` |
| `ZHIPU_API_KEY` | GLM | `glm-4-flash` |
| `MINIMAX_API_KEY` | MiniMax | `MiniMax-M3` |
| `DASHSCOPE_API_KEY` | Qwen | `qwen-plus` |
| `DOUBAO_API_KEY` | Doubao | `doubao-pro-32k` |
| `SILICONFLOW_API_KEY` | SiliconFlow | `deepseek-ai/DeepSeek-V3` |
| `OPENAI_API_KEY` | OpenAI | `gpt-4o` |

## Commands

```bash
npm run build       # tsc → dist/
npm run typecheck   # tsc --noEmit
npm run dev         # tsx src/index.ts (REPL)
npm start           # node dist/index.js
npm test            # build + unit + emotion + smoke tests
npm run test:e2e    # Playwright E2E tests
```

## Architecture

See [CLAUDE.md](CLAUDE.md) for the full architecture overview, conventions, design decisions, and API endpoints.

## Requirements

- **Node.js** ≥ 20
- **ESM** (`"type": "module"`)
- One LLM provider API key (see above)

## License

MIT — see [LICENSE](LICENSE).
