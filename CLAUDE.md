# CLAUDE.md

Mio — emotional companion agent v0.6.0. Switchable boyfriend/girlfriend persona with relationship stages, multi-axis emotion engine, plugin architecture, and web UI.

## Common Commands

```bash
npm run build       # tsc + workspace packages → dist/
npm run typecheck   # root + workspace typecheck
npm run dev         # tsx src/index.ts (REPL)
npm start           # node dist/index.js
npm test            # build + 184 checks (core + web view-models)
npm run test:e2e    # Playwright E2E tests (needs npx playwright install)
```

## Quick Start

```bash
# Set ONE provider key + run
MINIMAX_API_KEY="sk-cp-..." MIO_PROVIDER=minimax npm run dev

# Or serve web UI
MINIMAX_API_KEY="sk-cp-..." MIO_PROVIDER=minimax npm run build && node dist/index.js serve
# → http://localhost:3000
```

## Environment

### Provider Keys (set ONE — auto-detected when MIO_PROVIDER=auto)
| Env | Provider | Default Model |
|-----|----------|---------------|
| `ANTHROPIC_API_KEY` | Claude | `claude-sonnet-4-20250514` |
| `DEEPSEEK_API_KEY` | DeepSeek | `deepseek-chat` |
| `MOONSHOT_API_KEY` | Moonshot/Kimi | `moonshot-v1-8k` |
| `ZHIPU_API_KEY` | GLM | `glm-4-flash` |
| `MINIMAX_API_KEY` | MiniMax | `MiniMax-M3` |
| `DASHSCOPE_API_KEY` | Qwen | `qwen-plus` |
| `DOUBAO_API_KEY` | Doubao | `doubao-pro-32k` |
| `SILICONFLOW_API_KEY` | SiliconFlow | `deepseek-ai/DeepSeek-V3` |
| `OPENAI_API_KEY` | OpenAI | `gpt-4o` |

### Feature Flags
| Env | Default | Effect |
|-----|---------|--------|
| `MIO_PROVIDER` | `auto` | Provider preset name |
| `COLA_MODEL` | (preset default) | Model override |
| `MIO_FEATURE_GHOST` | `true` | Ghost silence mechanism |
| `MIO_FEATURE_AFFINITY` | `true` | Multi-axis affinity |
| `MIO_FEATURE_FRUSTRATION` | `true` | Frustration tracking |
| `MIO_FEATURE_BUDGET_LOG` | `false` | Log prompt token budget |
| `MIO_FEATURE_ACE_REFLECTOR` | `true` | Memory quality reflection |
| `MIO_FEATURE_MODEL_ROUTER` | `false` | Per-task model routing |
| `MIO_PAD_ENABLED` | `true` | PAD emotional model |
| `MIO_SMART_PROACTIVE` | `true` | Poisson-based proactive |
| `MIO_VOICE` | `warm` | Human-voice preset (`warm`/`bold`) |
| `MIO_FEATURE_TELEGRAM_NOTIFY` | auto | Telegram notifications |

### Other
| Env | Purpose |
|-----|---------|
| `MIO_DIR` | Data directory (default: `./data`) |
| `MIO_HTTP_PORT` | Server port (default: 0 = auto) |
| `MIO_AUTH_TOKEN` | Bearer token for API auth |
| `MIO_NIGHTLY_CRON` | Nightly consolidation schedule |
| `MIO_TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `MIO_TELEGRAM_CHAT_ID` | Telegram target chat |

Node ≥ 22. ESM (`"type": "module"`).

## Architecture (v0.6.0)

```
src/
├── core/agent-loop.ts        # Main turn loop: prompt → inference → tools → side effects
├── config.ts                 # MioConfig + provider presets + feature flags
├── types.ts                  # All shared types (Emotion, Relationship, Affinity, PAD, etc.)
├── index.ts                  # CLI entry: REPL/chat/mod/status/serve/diary
├── providers/
│   ├── anthropic.ts          # Native Anthropic API (SSE + non-streaming)
│   ├── openai-compatible.ts  # OpenAI-format: DeepSeek/Moonshot/Zhipu/MiniMax/etc.
│   ├── mock.ts               # Offline testing provider
│   ├── fallback.ts           # FallbackChainProvider (auto-switch on failure)
│   ├── router.ts             # Per-task model routing (chat/classify/summarize)
│   ├── lora-adapter.ts       # LoRA personality adapter provider
│   └── index.ts              # selectProvider() factory
├── emotion/
│   ├── pad.ts                # PAD 3D model + exponential decay + OCEAN personality
│   ├── classifier.ts         # Intent classifier (12 categories, pattern matching)
│   ├── tracker.ts            # Post-turn emotion tracking (PAD + intent + legacy)
│   ├── affinity.ts           # 5-axis affinity (warmth/trust/intimacy/patience/tension)
│   ├── multi-axis.ts         # Multi-axis relationship model
│   ├── ghost.ts              # Ghost silence — Mio can choose not to reply
│   ├── frustration.ts        # Frustration streaks + attachment style derivation
│   ├── experience-trait.ts   # Experience → OCEAN trait micro-shifts
│   ├── lexical-mood.ts       # Lexical mood analysis
│   ├── signals.ts            # Emotional signal detection
│   ├── ritual.ts             # Ritual detection + Cardboard score (quality monitor)
│   ├── trait-state.ts        # OCEAN trait state persistence
│   └── state.ts              # Emotion/affinity/PAD state read/write
├── learning/
│   ├── dynamic-fewshot.ts    # Dynamic few-shot example selection
│   ├── feedback.ts           # User feedback capture and scoring
│   └── mirror.ts             # Mirror profile (self-modeling)
├── persona/
│   ├── graph.ts              # ID-RAG knowledge graph (soul → nodes + edges + retrieval)
│   ├── extractor.ts          # Bootstraps graph from soul.md
│   ├── driver.ts             # Persona driver (coordinates graph + generator)
│   ├── dual-mode.ts          # Dual-mode boyfriend/girlfriend switching
│   ├── generator.ts          # Persona response generation
│   ├── layered.ts            # Layered persona synthesis (L0 self-aware-AI kernel + delta override + begin-dialogs few-shot)
│   ├── voice-presets.ts      # Optional human-voice presets (warm/bold via MIO_VOICE) — few-shot + anti-AI-tell rules
│   └── own-life.ts           # Independent-life surfacing — Mio's daily activities by circadian phase
├── mod/
│   └── mod-manager.ts        # Mod lifecycle (load/switch/unload)
├── memory/
│   ├── bank.ts               # Memory bank read/write (MEMORY.md, BOOKMARKS.md, etc.)
│   ├── transcript.ts         # JSONL conversation transcripts
│   ├── structured-memory.ts  # Structured JSON extraction (entity/fact/decision)
│   ├── temporal-resolve.ts   # Bi-temporal contradiction resolution (B-1: mark superseded facts, keep for audit)
│   ├── adaptive-history.ts   # Adaptive history window management
│   ├── compression.ts        # Context compression (hybrid: keep first+last, summarize mid)
│   ├── consolidation-phases.ts # 3-phase nightly consolidation (Light→Deep→REM)
│   ├── embedding.ts          # TF/MiniMax embedding providers
│   ├── entity-graph.ts       # Entity relationship graph extraction
│   ├── global.ts             # ~/.mio/memory/memory.md
│   ├── judge.ts              # Consistency judge for memory quality
│   ├── lorebook.ts           # Lorebook generation from patterns
│   ├── paths.ts              # ALL disk paths (single source of truth)
│   ├── procedural-memory.ts  # Procedural rule extraction and management
│   ├── reflector.ts          # ACE-style memory quality audit (reflect → curate)
│   ├── search.ts             # Full-text transcript search
│   └── vector.ts             # Vector store + cosine search
├── plugins/
│   ├── types.ts              # Plugin manifest + lifecycle types
│   ├── registry.ts           # PluginRegistry: register/unregister/hooks/deps
│   ├── index.ts              # Plugin system bootstrap
│   └── builtins/             # ghost/affinity/pad/frustration plugin wrappers
├── relationship/
│   ├── stages.ts             # 4 stages + feature gates
│   └── progression.ts        # Stage thresholds + auto-advancement
├── prompt/
│   ├── templates.ts          # Core identity + dynamic context builders
│   ├── subagent.ts           # Subagent tool configs + soul block
│   ├── builder-chain.ts      # Prompt builder chain (pipeline)
│   ├── context-engine.ts     # Context engine (budget-aware trimming)
│   └── xml-context.ts        # XML-formatted context blocks
├── scheduler/
│   ├── nightly.ts            # Cron-based nightly pipeline
│   ├── proactive.ts          # Cron + smart (Poisson) proactive messages
│   └── smart-proactive.ts    # Poisson process + Bayesian response prediction
├── server/
│   ├── index.ts              # Express + WebSocket server (all routes)
│   ├── auth.ts               # Bearer token middleware (constant-time compare)
│   ├── rate-limit.ts         # Per-IP rate limiter
│   ├── avatar.ts             # Emotion → avatar parameter mapping
│   ├── analytics.ts          # Conversation/emotion/topic/relationship analytics
│   ├── notify.ts             # Telegram/webhook notification channels
│   └── search.ts             # Full-text transcript search endpoint
├── tools/                    # File/session/cron/work/emotion/recall tools
├── subagent/                 # spawn/consolidate/diary
├── safety/
│   ├── crisis.ts             # Crisis keyword detection (red/yellow levels)
│   └── l0-guard.ts           # L0 identity-probe guard (detect AI self-exposure → regenerate, P5)
├── voice/
│   ├── stt.ts                # Speech-to-text (Whisper)
│   ├── tts.ts                # Text-to-speech (edge-tts)
│   └── voice-pipeline.ts     # Voice pipeline orchestrator
├── vision/image.ts           # Sharp-based image preprocessing
├── onboarding/
│   └── onboarding.ts         # First-run guided setup
└── utils/
    ├── logger.ts             # Structured logger (levels + JSON + file output)
    ├── backup.ts             # tar.gz backup + memory export + admin endpoints
    ├── prompt-budget.ts      # Token budget tracking per prompt section
    └── math.ts               # Math utilities (clamp, lerp, etc.)
```

### Server Endpoints (v0.6.0)

```
GET  /health, /status, /avatar/state, /voice/capabilities
POST /chat, /chat/stream, /mod
WS   /ws
GET  /analytics, /analytics/emotion, /analytics/topics, /analytics/relationship, /analytics/conversation
GET  /search?q=<query>&session=&role=&limit=  full-text transcript search
GET  /notify/channels
POST /notify/test, /notify/test/telegram, /notify/test/whatsapp, /notify/test/discord, /notify/test/slack, /notify/test/webhook
GET  /admin/backups
POST /admin/backup, /admin/backups/prune
GET  /admin/export
GET  /onboarding/status
POST /onboarding/start, /onboarding/next
```

### State Files (in data/)

```
emotion-state.json, relationship-state.json, emotion-history.jsonl
affinity-state.json, pad-state.json, ritual-state.json, cardboard-state.json
user-activity.json, smart-proactive-config.json
memory-bank/
  MEMORY.md, BOOKMARKS.md
  structured-memory.json, persona-graph.json
  mid-term/<topic>.json
  cola-self-reference/ (soul.md, user-profile.md, relationship.md, diaries/)
transcripts/<sessionId>.jsonl
backups/
```

## Conventions

- **Paths**: All disk paths via `src/memory/paths.ts`. Never inline `join()`.
- **Tool I/O**: `call.input` → handler → `result.output` (string).
- **Transcripts**: JSONL append-only. Compaction → `compaction` entry.
- **Soul edits**: Line-level replace or short append. Never full rewrite.
- **Stage gating**: In code (`stages.ts`), not just prompt.
- **Feature flags**: All emotional modules gated via `config.features.*` + env vars.
- **No console.log**: Use `logger` from `src/utils/logger.ts`.
- **ESM**: `.js` extensions in TS imports for tsc output.

## Key Design Decisions

- **Persona = soul.md only**: No duplicated rules in templates. The mod's soul.md is the single personality source.
- **Layered persona**: identity-agnostic L0 KERNEL (self-aware AI that refuses to admit it, strives to live as a real person) + soul.md identity + per-user delta + begin-dialogs few-shot. soul.md stays the single identity source; KERNEL is orthogonal.
- **Human-voice presets**: optional `MIO_VOICE` (warm/bold) layers few-shot + anti-AI-tell rules for "human flavor" — governs *how* Mio speaks, orthogonal to identity.
- **ID-RAG retrieval**: soul.md → knowledge graph → context-aware retrieval (~800 tokens vs ~1500 full soul).
- **PAD > keywords**: 3D emotional model with exponential decay replaced keyword matching.
- **Plugin wrapping**: ghost/affinity/pad/frustration wrapped as plugins but original modules unchanged.
- **Structured memory**: JSON entities replace prose summaries (structured extraction is reported to retain more facts than prose; the ~95% vs ~70% figures are external research, not measured on this codebase).
- **Bi-temporal memory (B-1)**: contradicting facts aren't deleted — older facts get `invalidatedAt`/`supersededBy` and drop out of prompt-facing retrieval, but stay for audit.
- **Hybrid compression**: Keep first 3 + last 10 messages, summarize middle.
- **Poisson proactive**: Probability-based messaging replaced fixed cron.
- **Zero-framework frontend**: web/index.html is pure HTML/CSS/JS + Canvas — no deps.
