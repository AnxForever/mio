# Mio 💕

> Emotional companion agent — switchable boyfriend/girlfriend persona with multi-axis emotion engine, plugin architecture, knowledge graph memory, and web UI.

**v0.6.0** | [MIT License](LICENSE) | Node ≥ 22

Mio is a privacy-first emotional AI companion that lives entirely on your machine. No cloud, no telemetry, no accounts. Every component — from the PAD 3D emotion model to the 3-phase nightly memory consolidation — is designed to make the AI feel alive while staying fully under your control.

---

## ✨ Technical Highlights

### 🎭 Dual-Mode Persona Engine
Switch seamlessly between **boyfriend** and **girlfriend** personas. Each persona is defined entirely by its `soul.md` — no duplicated personality rules in code. Persona switching is instant and preserves all emotional state.

**Key tech**: `src/persona/driver.ts`, `src/persona/dual-mode.ts`, `src/mod/mod-manager.ts`

### 🧬 PAD 3D Emotional Model
Replaces keyword-based emotion with a proper **Pleasure-Arousal-Dominance 3D emotional space**. Each emotional axis decays exponentially over time ("冷却回落"), and the 3D vector is mapped to avatar expressions (mouth, eyes, posture).

**Key tech**: `src/emotion/pad.ts`, `src/server/avatar.ts`, `src/emotion/tracker.ts`

### 🌊 OCEAN Personality + Experience Feedback
The **Big Five personality model** (Openness, Conscientiousness, Extraversion, Agreeableness, Neuroticism) evolves through conversation. Each night, exchange types are classified (affectionate, conflict, vulnerability, playful, supportive) and applied as **micro-shifts (±0.01-0.02 per trait, capped at ±0.03/night)**. This is a closed-loop: the user's interaction style literally changes Mio's personality over weeks.

**Key tech**: `src/emotion/experience-trait.ts`, `src/emotion/trait-state.ts`, `src/emotion/lexical-mood.ts`

### 💞 5-Axis Affinity System
Tracks relationship depth across five independent axes: **warmth, trust, intimacy, patience, tension**. Each axis has its own update rules and decay curves. Combined with **frustration streaking** and **attachment style derivation** — when frustration ≥ 3 AND tension > 50, a mini-crisis triggers.

**Key tech**: `src/emotion/affinity.ts`, `src/emotion/multi-axis.ts`, `src/emotion/frustration.ts`

### 🔗 ID-RAG Knowledge Graph (Persona Memory)
The persona's `soul.md` is bootstrapped into a **knowledge graph** (nodes + edges). At inference time, only the most relevant subgraph is retrieved (~800 tokens vs ~1500 full soul). This means persona depth grows without blowing the context window.

**Key tech**: `src/persona/graph.ts`, `src/persona/extractor.ts`, `src/persona/generator.ts`

### 🧠 3-Phase Nightly Memory Consolidation
Every night, Mio consolidates the day's conversations through a neuroscience-inspired pipeline:

| Phase | Name | What Happens |
|-------|------|-------------|
| **Phase 1** | **LIGHT** | Score bookmarks by importance (freq × 0.3 + recency × 0.4 + emotional weight × 0.3), select top 30% |
| **Phase 2** | **DEEP** | Extract structured entities → ACE reflector quality-audit → write to `structured-memory.json`, user profile, relationship, soul |
| **Phase 3** | **REM** | Scan ALL bookmarks for cross-session patterns → generate procedural memory rules → append to `procedural-memory.json` |

**Key tech**: `src/memory/consolidation-phases.ts`, `src/memory/structured-memory.ts`, `src/memory/reflector.ts`, `src/memory/procedural-memory.ts`

### 🎯 ACE Memory Reflector
After each consolidation, a **quality reflection cycle** audits all memory entities: drops low-quality, weakens stale, merges duplicates. Each entity carries a `qualityScore` that decays over time.

**Key tech**: `src/memory/reflector.ts`, `src/learning/feedback.ts`

### 📚 Hybrid Context Compression
When the conversation history exceeds token budget, compresses using a **keep-first-3 + keep-last-10 + summarize-middle** strategy. Token budgets are tracked per prompt section with configurable caps.

**Key tech**: `src/memory/compression.ts`, `src/prompt/context-engine.ts`, `src/utils/prompt-budget.ts`

---

## 🏗 Architecture

```
src/
├── core/agent-loop.ts          # Main loop: prompt → inference → tools → effects
├── config.ts                   # Config + 9 provider presets + feature flags
├── providers/                  # 9 LLM backends + fallback chain + LoRA adapter
├── emotion/                    # PAD 3D, OCEAN traits, 5-axis affinity, ghost, frustration
├── persona/                    # ID-RAG knowledge graph + persona driver + dual-mode
├── memory/                     # 15 files: bank, transcript, consolidation, embedding, search...
├── learning/                   # Dynamic few-shot, feedback capture, mirror self-modeling
├── plugins/                    # Plugin manifest, registry, 5 built-in emotion plugins
├── relationship/               # 4-stage progression + stage gates
├── prompt/                     # Template builder, context engine (budget-aware), XML blocks
├── scheduler/                  # Nightly pipeline, smart proactive (Poisson + Bayesian)
├── server/                     # Express + WebSocket, auth, avatar, analytics, search
├── tools/                      # 7 tool handlers: file, session, cron, recall, emotion, work
├── subagent/                   # Spawn, consolidate, diary subagents
├── voice/                      # STT (Whisper) + TTS (edge-tts) + voice pipeline
├── safety/                     # Red/yellow crisis keyword detection
├── onboarding/                 # First-run guided setup
└── web/                        # Zero-framework: Canvas avatar, modular CSS/JS, SPA router
```

### 🔌 Plugin Architecture

```typescript
interface Plugin {
  name: string;                    // unique plugin id
  version: string;
  hooks: PluginHooks;              // lifecycle hooks
  commands?: PluginCommand[];      // custom REPL commands
  dependencies?: string[];         // plugin deps (loaded first)
}

interface PluginHooks {
  onLoad?(): Promise<void>;
  onUnload?(): Promise<void>;
  beforeTurn?(ctx: SessionContext): Promise<SessionContext>;
  afterTurn?(ctx: SessionContext, result: TurnResult): Promise<void>;
  getPromptFragment?(ctx: SessionContext): Promise<string>;
}
```

**5 built-in plugins** (`src/plugins/builtins/`): `ghost-plugin`, `affinity-plugin`, `pad-plugin`, `frustration-plugin` — each wraps its emotion module as a pluggable hook.

### 🚨 Crisis Detection

Two-tier keyword system:
- **Yellow** (隐晦): "撑不住", "好累", "不想说话", "想哭" → flagged, gentle check-in
- **Red** (明确): "kill myself", "end my life", "结束生命", 自杀 → escalation

### 📡 Notification Channels

| Channel | Status | Transport |
|---------|--------|-----------|
| Telegram | ✅ | Bot API |
| Webhook | ✅ | HTTP POST |
| Discord | ✅ | Webhook |
| Slack | ✅ | Webhook |
| WhatsApp | WIP | — |

### 🎨 Zero-Framework Web UI

`web/index.html` — pure HTML/CSS/JS, no React/Vue/Svelte:
- `<canvas>` emotion-driven avatar rendering
- SPA router (`web/js/router.js`)
- Zustand-like store (`web/js/store.js`)
- WebSocket full-duplex chat (`web/js/ws.js`)
- 6 views: chat, studio, analytics, settings, onboarding, auth
- CSS custom properties design system (`web/css/tokens.css`)

---

## 🚀 Quick Start

```bash
git clone https://github.com/AnxForever/mio.git
cd mio
npm install

# CLI REPL
MINIMAX_API_KEY="sk-cp-..." MIO_PROVIDER=minimax npm run dev

# Web UI → http://localhost:3000
MINIMAX_API_KEY="sk-cp-..." MIO_PROVIDER=minimax npm start serve
```

## 🤖 LLM Providers

Set ONE key — auto-detected with `MIO_PROVIDER=auto`. Provider chain with **automatic fallback** on failure.

| Env Variable | Provider | Model |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude | `claude-sonnet-4-20250514` |
| `OPENAI_API_KEY` | OpenAI | `gpt-4o` |
| `DEEPSEEK_API_KEY` | DeepSeek | `deepseek-chat` |
| `MOONSHOT_API_KEY` | Moonshot/Kimi | `moonshot-v1-8k` |
| `ZHIPU_API_KEY` | GLM | `glm-4-flash` |
| `MINIMAX_API_KEY` | MiniMax | `MiniMax-M3` |
| `DASHSCOPE_API_KEY` | Qwen | `qwen-plus` |
| `DOUBAO_API_KEY` | Doubao | `doubao-pro-32k` |
| `SILICONFLOW_API_KEY` | SiliconFlow | `deepseek-ai/DeepSeek-V3` |

## 📡 API Endpoints

```
POST /chat              { text, sessionId? }
POST /chat/stream       SSE streaming
POST /mod               { name: "boyfriend" | "girlfriend" }
WS   /ws                Full-duplex chat + avatar state sync
GET  /status            Runtime status snapshot
GET  /health            Health check
GET  /search?q=&role=   Full-text transcript search
GET  /analytics/*       Emotion trends, topic heatmap, relationship timeline
POST /notify/test       Send test notification to all channels
GET  /admin/backups     List backups
POST /admin/backup      Create backup
GET  /admin/export      Export memory as text
```

## 🧪 Testing

```bash
npm test              # typecheck + 54 unit + 42 emotion + 12 smoke = 108 tests
npm run test:e2e      # Playwright browser tests
npm run typecheck     # tsc --noEmit
```

## 📦 Full Architecture Docs

See **[CLAUDE.md](CLAUDE.md)** — exhaustive architecture map, conventions, design decisions, state files, feature flags, and all environment variables.

## 📄 License

MIT © [AnxForever](https://github.com/AnxForever)
