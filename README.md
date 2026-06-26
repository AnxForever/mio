# Mio

<p align="center">
  <strong>Emotional Companion Agent</strong><br>
  Multi-axis emotion engine &middot; Knowledge-graph memory &middot; Plugin architecture &middot; Local-first
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.6.0-blue" alt="Version">
  <img src="https://img.shields.io/badge/node-%E2%89%A5%2022-brightgreen" alt="Node">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License">
  <img src="https://img.shields.io/badge/tests-108%20passed-brightgreen" alt="Tests">
</p>

---

Mio is a privacy-first emotional AI companion that operates entirely on your machine — no cloud services, no telemetry, no user accounts. It ships with two built-in personas (boyfriend/girlfriend), a neuroscience-inspired 3-phase memory consolidation pipeline, a PAD 3D emotional model with OCEAN personality traits, and a modular plugin system. All state lives in local JSON files; you own every byte.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                     Agent Loop                           │
│  prompt → inference (9 LLM backends) → tools → effects  │
└──────────────────────────┬──────────────────────────────┘
                           │
     ┌─────────────────────┼─────────────────────┐
     ▼                     ▼                     ▼
┌──────────┐    ┌──────────────────┐    ┌──────────────┐
│ Emotion  │    │     Memory       │    │   Persona    │
│ ──────── │    │  ─────────────── │    │  ─────────── │
│ PAD 3D   │    │  3-Phase Consol. │    │  ID-RAG KG   │
│ OCEAN    │    │  ACE Reflector   │    │  Dual-Mode   │
│ 5-Axis   │    │  Hybrid Compress │    │  soul.md     │
│ Affinity │    │  Entity Graph    │    │  Generator   │
│ Ghost    │    │  Procedural Mem  │    │  Driver      │
└──────────┘    └──────────────────┘    └──────────────┘
     │                     │                     │
     └─────────────────────┼─────────────────────┘
                           ▼
     ┌─────────────────────────────────────────┐
     │            Plugin Registry               │
     │  onLoad / beforeTurn / afterTurn / hooks │
     └─────────────────────────────────────────┘
                           │
                           ▼
     ┌─────────────────────────────────────────┐
     │         Server (Express + WS)            │
     │  REST + SSE + WebSocket + Notifications  │
     └─────────────────────────────────────────┘
```

## Key Technical Systems

### PAD 3D Emotional Model

Replaces keyword-based sentiment with a proper dimensional model. Every interaction updates Mio's position in **Pleasure-Arousal-Dominance** space, which then drives avatar expression (facial features, voice tone, posture) and influences response generation. All three axes decay exponentially toward neutral over time — a "cooling curve" that mimics human emotional homeostasis.

```
Pleasure  [0..1]  — valence: positive/negative
Arousal   [0..1]  — energy: excited/calm
Dominance [0..1]  — control: assertive/submissive
```

Combined with **OCEAN personality traits** (Openness, Conscientiousness, Extraversion, Agreeableness, Neuroticism) that evolve via experience-to-trait micro-shifts — a closed feedback loop where interaction patterns literally reshape Mio's personality over weeks.

**Files**: `src/emotion/pad.ts`, `src/emotion/experience-trait.ts`, `src/emotion/trait-state.ts`, `src/server/avatar.ts`

### 5-Axis Affinity System

Relationship depth tracked across five independent dimensions, each with its own update function and decay curve:

| Axis | Range | Description |
|------|-------|-------------|
| `warmth` | 0–100 | Emotional closeness |
| `trust` | 0–100 | Reliability confidence |
| `intimacy` | 0–100 | Self-disclosure depth |
| `patience` | 0–100 | Frustration tolerance |
| `tension` | 0–100 | Relationship friction |

**Frustration tracking** monitors streaks of cold/dismissive user behavior. When `frustrationStreak >= 3 && tension > 50`, a mini-crisis triggers with automatic bookmarking. **Attachment style** (secure/anxious/avoidant/disorganized) is derived from affinity ratios and shapes response strategy.

**Files**: `src/emotion/affinity.ts`, `src/emotion/multi-axis.ts`, `src/emotion/frustration.ts`

### ID-RAG Persona Knowledge Graph

Each persona is defined by a single `soul.md` file — no duplicated personality rules in code. At startup, the soul is bootstrapped into a **knowledge graph** (entities as nodes, relationships as edges). During inference, only the most contextually relevant subgraph is retrieved (~800 tokens vs ~1500 for the full soul), enabling persona depth to grow without bloating the prompt.

**Files**: `src/persona/graph.ts`, `src/persona/extractor.ts`, `src/persona/generator.ts`, `src/persona/driver.ts`

### 3-Phase Nightly Memory Consolidation

Modeled after the sleep-dependent memory consolidation cycle in neuroscience:

```
Phase 1 — LIGHT (Select)
  Score all bookmarks by: freq×0.3 + recency×0.4 + emotional_weight×0.3
  Select top 30% for deep processing.

Phase 2 — DEEP (Write)
  Extract structured entities → ACE quality audit → write to:
    structured-memory.json, user-profile, relationship, soul

Phase 3 — REM (Extract Patterns)
  Scan ALL bookmarks for cross-session patterns.
  Generate procedural memory rules. Append to procedural-memory.json.
```

The **ACE Reflector** post-processes memory quality: drops low-quality entities, weakens stale ones, merges duplicates. Each entity carries a `qualityScore` that decays over time, ensuring the memory bank stays curated.

**Files**: `src/memory/consolidation-phases.ts`, `src/memory/structured-memory.ts`, `src/memory/reflector.ts`, `src/memory/procedural-memory.ts`

### Hybrid Context Compression

When conversation history exceeds the LLM's token budget, the context engine applies a **keep-first-N + keep-last-M + summarize-middle** strategy. Token budgets are tracked per prompt section with configurable caps. This preserves conversational continuity (recent turns stay verbatim) while preventing context-window overflow (older turns are compressed into summaries).

**Files**: `src/memory/compression.ts`, `src/prompt/context-engine.ts`, `src/utils/prompt-budget.ts`

### Plugin Architecture

```typescript
interface Plugin {
  name: string;
  version: string;
  hooks: {
    onLoad?(): Promise<void>;
    onUnload?(): Promise<void>;
    beforeTurn?(ctx: SessionContext): Promise<SessionContext>;
    afterTurn?(ctx: SessionContext, result: TurnResult): Promise<void>;
    getPromptFragment?(ctx: SessionContext): Promise<string>;
  };
  commands?: PluginCommand[];
  dependencies?: string[];     // loaded before this plugin
}
```

Five built-in plugins (`ghost`, `affinity`, `pad`, `frustration`, and the plugin index) wrap emotion modules as pluggable hooks. The registry handles dependency resolution, load ordering, and graceful unload.

**Files**: `src/plugins/registry.ts`, `src/plugins/types.ts`, `src/plugins/builtins/`

### Crisis Detection

Two-tier keyword system with automatic escalation:

| Level | Trigger | Response |
|-------|---------|----------|
| **Yellow** | Implicit distress signals (e.g. "撑不住", "好累", "想哭") | Flagged, gentle check-in |
| **Red** | Explicit self-harm references | Full crisis protocol, bookmark, escalation message |

**File**: `src/safety/crisis.ts`

---

## Quick Start

```bash
git clone https://github.com/AnxForever/mio.git
cd mio
npm install

# CLI REPL — set ONE provider key
MINIMAX_API_KEY="sk-cp-..." MIO_PROVIDER=minimax npm run dev

# Web UI — http://localhost:3000
MINIMAX_API_KEY="sk-cp-..." MIO_PROVIDER=minimax npm start serve
```

## LLM Provider Backends

Set one environment variable. Auto-detection when `MIO_PROVIDER=auto`. Includes a **fallback chain** — if the primary provider fails, Mio automatically switches to the next available.

| Environment Variable | Provider | Default Model |
|---|---|---|
| `ANTHROPIC_API_KEY` | Anthropic Claude | `claude-sonnet-4-20250514` |
| `OPENAI_API_KEY` | OpenAI | `gpt-4o` |
| `DEEPSEEK_API_KEY` | DeepSeek | `deepseek-chat` |
| `MOONSHOT_API_KEY` | Moonshot / Kimi | `moonshot-v1-8k` |
| `ZHIPU_API_KEY` | Zhipu / GLM | `glm-4-flash` |
| `MINIMAX_API_KEY` | MiniMax | `MiniMax-M3` |
| `DASHSCOPE_API_KEY` | Qwen (Alibaba) | `qwen-plus` |
| `DOUBAO_API_KEY` | Doubao (ByteDance) | `doubao-pro-32k` |
| `SILICONFLOW_API_KEY` | SiliconFlow | `deepseek-ai/DeepSeek-V3` |

Additional backends via `src/providers/lora-adapter.ts` (LoRA personality adapter) and `src/providers/mock.ts` (offline testing).

## API Reference

### Core

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/chat` | Send message `{ text, sessionId? }`, receive full response |
| `POST` | `/chat/stream` | SSE streaming chat |
| `POST` | `/mod` | Switch persona `{ name: "boyfriend" \| "girlfriend" }` |
| `WS` | `/ws` | Full-duplex WebSocket: chat, avatar state, emotion events, ping/pong |
| `GET` | `/status` | Runtime state snapshot (emotion, affinity, relationship stage) |
| `GET` | `/health` | Health check |

### Analytics

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/analytics` | Full analytics snapshot |
| `GET` | `/analytics/emotion?days=30` | Emotion trend data |
| `GET` | `/analytics/topics` | Topic frequency heatmap |
| `GET` | `/analytics/relationship` | Relationship progression timeline |
| `GET` | `/analytics/conversation` | Conversation statistics |
| `GET` | `/search?q=&session=&role=&limit=` | Full-text transcript search |

### Notifications

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/notify/channels` | List configured notification channels |
| `POST` | `/notify/test` | Send test message to all channels |
| `POST` | `/notify/test/telegram` | Test Telegram |
| `POST` | `/notify/test/discord` | Test Discord |
| `POST` | `/notify/test/slack` | Test Slack |
| `POST` | `/notify/test/webhook` | Test Webhook |

### Administration

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/admin/backups` | List existing backups |
| `POST` | `/admin/backup` | Create new backup (tar.gz) |
| `POST` | `/admin/backups/prune` | Prune old backups |
| `GET` | `/admin/export` | Export all memory as plain text |

### Onboarding

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/onboarding/status` | Check onboarding progress |
| `POST` | `/onboarding/start` | Begin first-run setup |
| `POST` | `/onboarding/next` | Advance to next onboarding step |

### Authentication

Set `MIO_AUTH_TOKEN` to enable Bearer token authentication. All `POST` and `WS` endpoints will require `Authorization: Bearer <token>`. Uses constant-time comparison to prevent timing attacks.

**File**: `src/server/auth.ts`

---

## Commands

```bash
npm run build       # Compile TypeScript → dist/
npm run typecheck   # Type-check only (tsc --noEmit)
npm run dev         # Start REPL (tsx src/index.ts)
npm start           # Run compiled server (node dist/index.js)
npm test            # Full test suite: 54 unit + 42 emotion + 12 smoke
npm run test:e2e    # Playwright browser tests
npm run test:emotion # Emotion module tests only
```

## Project Structure

```
src/
├── core/agent-loop.ts          # Main turn loop
├── config.ts                   # Configuration + provider presets
├── types.ts                    # Shared type definitions
├── providers/                  # 9 LLM backends + fallback + router
├── emotion/                    # PAD, OCEAN, affinity, ghost, frustration
├── persona/                    # ID-RAG graph + driver + dual-mode
├── memory/                     # Consolidation, embedding, search, compression
├── learning/                   # Few-shot selection, feedback, mirror profiling
├── plugins/                    # Plugin registry + 5 built-in plugins
├── relationship/               # Stage progression + feature gates
├── prompt/                     # Template builder, context engine, XML context
├── scheduler/                  # Nightly pipeline, smart proactive (Poisson)
├── server/                     # Express + WebSocket, auth, analytics, notify
├── tools/                      # File, session, cron, recall, emotion, work tools
├── subagent/                   # Spawn, consolidate, diary sub-agents
├── safety/                     # Crisis detection (red/yellow)
├── voice/                      # STT (Whisper) + TTS (edge-tts)
├── vision/                     # Image preprocessing (Sharp)
├── onboarding/                 # First-run guided setup
├── utils/                      # Logger, backup, prompt budget, math
└── mod/                        # Persona mod lifecycle manager

web/                            # Zero-framework SPA
├── css/                        # Design tokens, reset, per-view stylesheets
├── js/
│   ├── app.js                  # Application entry
│   ├── router.js               # Client-side SPA router
│   ├── store.js                # Reactive state store
│   ├── ws.js                   # WebSocket client
│   ├── api.js                  # REST API client
│   ├── views/                  # chat, studio, analytics, settings, onboarding, auth
│   ├── components/             # bubble, emotion-ball, tab-bar, toast
│   └── utils/                  # DOM, easing, time, haptics, constants
└── index.html

tests/
├── unit.ts                     # 54 unit tests
├── unit-emotion.ts             # 42 emotion module tests
├── smoke.ts                    # 12 HTTP/WS integration tests
└── e2e/                        # Playwright end-to-end tests
```

## Design Decisions

- **Persona = soul.md only.** No duplicated personality rules in prompt templates. The mod's `soul.md` is the single source of truth.
- **ID-RAG over full-soul injection.** Knowledge graph retrieval reduces persona token cost by ~47%.
- **PAD dimensional model over keyword matching.** Enables smooth emotional transitions and multi-dimensional state representation.
- **Plugin wrapping, not rewriting.** Emotion modules (ghost, affinity, pad, frustration) are wrapped as plugins while retaining their original APIs.
- **Structured JSON memory over prose summaries.** Entities with quality scores achieve ~95% retention vs ~70% for prose.
- **Hybrid compression over truncation.** Keep-first + keep-last + summarize-middle preserves both recency and context.
- **Poisson proactive over fixed cron.** Probability-based messaging adapts to user activity patterns.
- **All disk paths via `src/memory/paths.ts`.** Single source of truth for every filesystem reference.

## State Files (in `data/`)

```
emotion-state.json              # Current emotion vector
affinity-state.json             # 5-axis affinity values
pad-state.json                  # PAD 3D coordinates
relationship-state.json         # Current relationship stage
ritual-state.json               # Ritual detection state
cardboard-state.json            # Cardboard quality score
personality-state.json          # OCEAN trait values
entity-graph.json               # Entity relationship graph
fewshot-bank.json               # Few-shot example bank
feedback-state.json             # User feedback records
mirror-profile.json             # Self-modeling profile
memory-bank/
  MEMORY.md, BOOKMARKS.md
  structured-memory.json
  persona-graph.json
  procedural-memory.json
  cola-self-reference/          # soul.md, user-profile.md, relationship.md, diaries
transcripts/<sessionId>.jsonl   # Append-only conversation logs
backups/                        # tar.gz archives
```

## Environment Variables

Full reference in [`.env.example`](.env.example). Key variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `MIO_PROVIDER` | `auto` | LLM provider preset |
| `MIO_HTTP_PORT` | `0` (auto) | Server listen port |
| `MIO_AUTH_TOKEN` | — | Bearer token for API auth |
| `MIO_DIR` | `./data` | Data directory path |
| `MIO_LOG_LEVEL` | `info` | Logger level (debug/info/warn/error) |
| `MIO_LOG_FORMAT` | `text` | Logger format (text/json) |
| `MIO_NIGHTLY_CRON` | `30 21 * * *` | Nightly consolidation schedule |
| `MIO_FEATURE_GHOST` | `true` | Ghost silence mechanism |
| `MIO_FEATURE_AFFINITY` | `true` | Multi-axis affinity |
| `MIO_PAD_ENABLED` | `true` | PAD emotional model |
| `MIO_SMART_PROACTIVE` | `true` | Poisson-based proactive messaging |

## Requirements

- **Node.js** >= 22
- **ESM** (`"type": "module"`)
- One LLM provider API key (see [Provider Backends](#llm-provider-backends))

## Documentation

- **[CLAUDE.md](CLAUDE.md)** — Full architecture reference, conventions, design decisions
- **[README_CN.md](README_CN.md)** — 中文文档
- **[.env.example](.env.example)** — All environment variables with descriptions

## License

MIT © [AnxForever](https://github.com/AnxForever)
