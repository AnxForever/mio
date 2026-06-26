# Mio

<p align="center">
  <strong>Open-Source Emotional Intelligence Toolkit</strong><br>
  Reusable emotion engine &middot; Knowledge-graph persona memory &middot; Plugin architecture
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

Mio is **not a product** — it is a composable toolkit for building emotionally intelligent applications, plus a reference implementation (the "Mio" companion). You can use the emotion engine, knowledge graph retrieval, and plugin system in your own projects without adopting the entire companion agent.

## What You Can Build With This

- **AI companions** — the reference app ships boyfriend/girlfriend personas with relationship stages
- **NPC dialogue systems** — give game characters persistent personality and emotional memory
- **Mental health tools** — crisis detection, emotional state tracking, attachment style analysis
- **Character-based chatbots** — ID-RAG lets you define any character via a single `soul.md` file
- **Research** — PAD 3D + OCEAN trait evolution is grounded in academic psychology

## Architecture

```
mio/
├── src/emotion/          ← PAD 3D, OCEAN traits, 5-axis affinity, ghost silence
├── src/memory/           ← 3-phase consolidation, ACE reflector, hybrid compression
├── src/persona/          ← ID-RAG knowledge graph (soul.md → graph → retrieval)
├── src/plugins/          ← Plugin registry with lifecycle hooks
├── src/providers/        ← 9 LLM backends + fallback chain
├── src/server/           ← Express + WebSocket reference server
├── src/scheduler/        ← Poisson-based proactive messaging
└── web/                  ← Zero-framework Canvas SPA (reference UI)
```

Everything above is MIT-licensed. Copy what you need, leave the rest.

## Core Libraries

### Emotion Engine (`src/emotion/`)

A psychology-grounded multi-dimensional emotion system. Zero LLM calls — purely computational.

```typescript
import { computePAD, decayPAD } from './emotion/pad.js';
import { updateAffinity } from './emotion/affinity.js';
import { shouldGhost } from './emotion/ghost.js';

// Update PAD state based on user message
const pad = computePAD(currentPAD, userIntent, { pleasure: 0.6, arousal: 0.4, dominance: 0.5 });

// Apply exponential decay toward neutral
const cooled = decayPAD(pad, elapsedMinutes);

// Track 5-axis affinity
const affinity = updateAffinity(currentAffinity, {
  userMessage: "I had a really bad day",
  myResponse: "Tell me about it",
});

// Ghost silence — sometimes not replying is the right move
if (shouldGhost(sessionContext)) {
  return; // Mio chooses silence
}
```

**Components**:
| Module | Description | File |
|--------|-------------|------|
| PAD 3D Model | Pleasure-Arousal-Dominance with exponential decay | `pad.ts` |
| OCEAN Traits | Big Five personality with experience→trait micro-shifts | `experience-trait.ts`, `trait-state.ts` |
| 5-Axis Affinity | warmth, trust, intimacy, patience, tension | `affinity.ts`, `multi-axis.ts` |
| Frustration Tracking | Streak detection, mini-crisis triggers, attachment style | `frustration.ts` |
| Ghost Silence | Context-driven "read but not reply" | `ghost.ts` |
| Intent Classifier | 12-category intent matching (no LLM) | `classifier.ts` |

### ID-RAG Knowledge Graph (`src/persona/`)

Define a character in markdown, retrieve only the relevant parts at inference time.

```typescript
import { bootstrapGraph } from './persona/extractor.js';
import { retrieveContext } from './persona/graph.js';

// One-time: build knowledge graph from a soul.md file
const graph = bootstrapGraph(fs.readFileSync('soul.md', 'utf-8'));

// Per-turn: retrieve only what's relevant to the current conversation
const context = retrieveContext(graph, {
  userMessage: "Do you remember the first time we met?",
  maxTokens: 800,
});
// context → "You first met at a coffee shop. She was reading Murakami..."
```

~800 tokens vs ~1500 for full soul injection — **47% token savings**.

### Memory Consolidation (`src/memory/`)

Nightly pipeline: score bookmarks → extract entities → find cross-session patterns.

```typescript
import { runFullConsolidation } from './memory/consolidation-phases.js';

// Run as a cron job
const report = runFullConsolidation();
// report.phase1.selectedCount  — top 30% bookmarks
// report.phase2.changes        — entities written to memory
// report.phase3.rulesGenerated — procedural memory rules
```

**Pipeline**: Phase 1 LIGHT (select top 30%) → Phase 2 DEEP (ACE quality audit + write) → Phase 3 REM (pattern extraction)

### Plugin System (`src/plugins/`)

Hook into the agent loop at any lifecycle point.

```typescript
import { registry } from './plugins/registry.js';

registry.register({
  name: 'custom-mood-tracker',
  version: '1.0.0',
  hooks: {
    afterTurn(ctx, result) {
      // Log mood changes to your analytics
    },
    getPromptFragment(ctx) {
      return '<custom_context>injected data</custom_context>';
    },
  },
});
```

### Provider Adapter (`src/providers/`)

9 LLM backends with auto-detection and automatic fallback. Add your own:

```typescript
import { FallbackChainProvider } from './providers/fallback.js';

const provider = new FallbackChainProvider({
  providers: ['anthropic', 'openai', 'deepseek'],
  onSwitch: (from, to, reason) => console.warn(`Fallback: ${from} → ${to}: ${reason}`),
});
```

## Quick Start

```bash
git clone https://github.com/AnxForever/mio.git
cd mio && npm install

# Run the reference companion app
MINIMAX_API_KEY="sk-cp-..." MIO_PROVIDER=minimax npm run dev

# Or just import the libraries you need
# import { computePAD, decayPAD } from 'mio/emotion/pad.js';
# import { bootstrapGraph, retrieveContext } from 'mio/persona/graph.js';
```

## Commands

```bash
npm run build        # tsc → dist/
npm run typecheck    # tsc --noEmit
npm run dev          # REPL (tsx src/index.ts)
npm test             # 51 unit + 41 emotion + 12 smoke
npm run test:e2e     # Playwright
```

## Documentation

- **[CLAUDE.md](CLAUDE.md)** — Full architecture, design decisions, conventions, API endpoints, state files
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — How to contribute
- **[README_CN.md](README_CN.md)** — 中文文档

## Requirements

Node.js ≥ 22 · ESM · One LLM API key (for the reference app only; libraries are computation-only)

## License

MIT © [AnxForever](https://github.com/AnxForever)
