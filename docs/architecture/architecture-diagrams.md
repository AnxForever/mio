# Mio Architecture Diagrams

These Mermaid diagrams summarize Mio's current architecture as of the research pass in `docs/research/architecture-review-long-task.md`.

Overall verdict: `good, not excellent`.

Use these diagrams for README, papers, or presentations, but keep the hotspot notes. The diagrams describe the current system, not an idealized future state.

## 1. System Overview

```mermaid
flowchart TB
  CLI[CLI / REPL] --> Core[Core runTurn]
  Web[Zero-framework Web UI] --> Server[Express + WS Server]
  OpenAI[OpenAI-compatible Clients] --> Server
  OneBot[OneBot / IM Bridge] --> Server
  Scheduler[Nightly / Proactive / Life Schedulers] --> Core

  Server --> Core
  Core --> Prompt[Prompt Context Engine]
  Core --> Providers[Provider Boundary]
  Core --> Tools[Tool Runtime]
  Core --> Effects[Post-turn Effects]

  Prompt --> Memory[Memory System]
  Prompt --> Persona[Persona / ID-RAG]
  Prompt --> Emotion[Emotion / Relationship]
  Prompt --> Learning[Learning / Few-shot]

  Providers --> Anthropic[Anthropic Adapter]
  Providers --> OpenAICompat[OpenAI-compatible Adapter]
  Providers --> Mock[Mock Provider]
  Providers --> Router[Model Router]
  Providers --> Fallback[Fallback Chain]

  Tools --> FileTools[File / Session / Work / Recall / Knowledge Tools]
  Tools --> PluginRegistry[Plugin Registry]

  Effects --> Memory
  Effects --> Emotion
  Effects --> Persona
  Effects --> Character[Character Life Engine]

  Memory --> Files[(Local Files)]
  Memory --> SQLite[(SQLite Vector Store)]
  Persona --> Files
  Emotion --> Files
  Server --> Files

  classDef hotspot fill:#fff3cd,stroke:#b58100,color:#111;
  class Server,Core,Effects hotspot;
```

Hotspots:

- `src/server/index.ts` is the largest composition root.
- `src/core/agent-loop.ts` still owns prompt/persona/memory context assembly.
- `src/core/turn-post-effects.ts` aggregates many domain side effects.

## 2. Turn Loop

```mermaid
sequenceDiagram
  participant Client
  participant Server
  participant RunTurn as core/runTurn
  participant Prepare as turn-prepare
  participant Silence as turn-silence
  participant Prompt as prompt/context
  participant Provider
  participant ToolLoop as inference-loop
  participant Effects as turn-post-effects
  participant State as local state

  Client->>Server: chat / stream / WS message
  Server->>RunTurn: TurnInput + SessionContext
  RunTurn->>Prepare: normalize input, provider, plugins, crisis, session
  Prepare->>State: ensure bank, reindex bookmarks, load config
  RunTurn->>Silence: reply necessity + ghost policy
  alt ghost or skip
    Silence->>State: transcript + optional bookmark
    Silence-->>RunTurn: empty/silent result
  else normal turn
    RunTurn->>Prompt: semantic memory + persona graph + context sections
    Prompt->>State: memory, persona, emotion, relationship
    RunTurn->>ToolLoop: messages + system prompt + tools
    ToolLoop->>Provider: chat/stream
    Provider-->>ToolLoop: text and/or tool calls
    ToolLoop->>State: execute scoped tools
    ToolLoop-->>RunTurn: final text + counts
    RunTurn->>Effects: transcript, emotion, memory, learning, relationship
    Effects->>State: write durable side effects
  end
  RunTurn-->>Server: TurnOutput
  Server-->>Client: response / SSE / WS tokens
```

Key design point:

The public `runTurn` pipeline is clearer after the `turn-*` split, but prompt/persona/memory context ownership still needs extraction before the architecture can be called excellent.

## 3. Memory Stack

```mermaid
flowchart TB
  Raw[Raw Messages] --> Transcript[Append-only JSONL Transcripts]
  Raw --> Bookmarks[BOOKMARKS.md]
  Bookmarks --> Active[Active Context / MEMORY.md]
  Bookmarks --> Vector[Vector Index]
  Transcript --> Search[Transcript Search]
  Vector --> Hybrid[Hybrid Search / RRF / Rerank]
  Search --> Hybrid

  Bookmarks --> Structured[Structured Memory Extraction]
  Transcript --> Structured
  Structured --> Entities[Entities / Facts / Decisions]
  Entities --> Review[Memory Review UI / API]
  Review --> Durable[Durable Facts]
  Review --> Topics[Mid-term Topics]
  Durable --> Lorebook[Lorebook]
  Structured --> Procedural[Procedural Memory]
  Structured --> EntityGraph[Entity Graph]

  Hybrid --> PromptMemory[Prompt Memory Context]
  Durable --> PromptMemory
  Lorebook --> PromptMemory
  Procedural --> PromptMemory
  EntityGraph --> PromptMemory

  subgraph Storage
    Files[(Local Files)]
    SQLite[(SQLite Vector DB)]
  end

  Transcript --> Files
  Bookmarks --> Files
  Active --> Files
  Structured --> Files
  Vector --> SQLite
```

Strength:

Mio's memory architecture is a product strength because it is layered and reviewable rather than a single chat-history buffer.

Risk:

`structured-memory.ts`, `search.ts`, and `consolidation-phases.ts` are broad files, and multi-file consolidation recovery is not yet proven.

## 4. Persona Stack

```mermaid
flowchart TB
  Kernel[Immutable Kernel] --> PersonaPrompt[Persona Prompt Fragment]
  Soul[Active mod soul.md] --> Graph[ID-RAG Persona Graph]
  Soul --> PersonaPrompt
  Graph --> Retrieval[Relevant Persona Nodes]
  Retrieval --> PersonaPrompt

  Delta[Per-user Persona Delta] --> PersonaPrompt
  Prefs[Explicit User Preferences] --> PersonaPrompt
  Relationship[Relationship Context] --> PersonaPrompt
  Lorebook[Lorebook / Shared Memories] --> PersonaPrompt
  Fewshot[Dynamic Few-shot] --> PersonaPrompt
  Driver[Personality Driver] --> PersonaPrompt
  DualMode[Base / Deep Mode] --> PersonaPrompt
  Safety[Safety + Channel Constraints] --> PersonaPrompt

  PersonaPrompt --> PromptEngine[ContextEngine Budget Assembly]
```

Accurate claim:

`soul.md` is the primary character-archetype source. Runtime persona behavior also includes dynamic overlays and code-backed policies.

## 5. Provider And Tool Boundary

```mermaid
flowchart LR
  Core[Core Inference Stage] --> ProviderContract[AIProvider / StreamingProvider]
  ProviderContract --> Anthropic[Anthropic Native API]
  ProviderContract --> OpenAICompat[OpenAI-compatible Vendors]
  ProviderContract --> Mock[Mock Provider]
  ProviderContract --> LoRA[LoRA Adapter]
  ProviderContract --> Fallback[FallbackChainProvider]
  ProviderContract --> Router[Task Router]

  Core --> ToolRuntime[Scoped Tool Runtime]
  ToolRuntime --> GlobalRegistry[Global Tool Registry]
  ToolRuntime --> PersonaAllowlist[Persona Tool Allowlist]
  ToolRuntime --> IMIsolation[IM Isolation: current_time only]
  GlobalRegistry --> File[File Tools]
  GlobalRegistry --> Session[Session Tools]
  GlobalRegistry --> Recall[Recall / Knowledge]
  GlobalRegistry --> Work[Work / Cron / Emotion]
  ToolRuntime --> PluginRegistry[Plugin Hooks]

  ProviderContract --> HTTP[fetchWithRetry timeout/backoff]
```

Strength:

Provider and tool contracts are compact and pragmatic.

Risk:

Fallback/routing/plugin lifecycle behavior needs direct tests before these boundaries can be described as mature.

## 6. Server Bridge Surface

```mermaid
flowchart TB
  Browser[Web UI] --> Static[Static Web + Assets]
  Browser --> NativeAPI[Native HTTP API]
  Browser --> WS[WebSocket API]
  Browser --> SSE[Native SSE Chat]

  OpenAIClient[OpenAI SDK-compatible Client] --> OpenAIAPI[/v1/chat/completions]
  OneBotClient[OneBot v11] --> OneBotAPI[/onebot/v11/events]
  Admin[Local Admin / Settings] --> AdminAPI[Admin / Backup / Export]
  Studio[Persona Studio] --> PersonaAPI[Mods / Soul / Persona / Character]
  Analytics[Analytics UI] --> AnalyticsAPI[Analytics / Search / Memories]
  Notify[Notification Tests] --> NotifyAPI[Notify Routes]

  NativeAPI --> RunTurn[core/runTurn]
  WS --> RunTurn
  SSE --> RunTurn
  OpenAIAPI --> RunTurn
  OneBotAPI --> RunTurn
  PersonaAPI --> MemoryPersona[Memory + Persona Files]
  AdminAPI --> LocalData[(Local Data Dir)]
  AnalyticsAPI --> LocalData
  NotifyAPI --> External[Telegram / Webhook / Discord / Slack / WeClaw]
```

Strength:

Multiple client protocols route into one agent core, preserving behavior consistency.

Risk:

The route surface is broad but currently concentrated in `src/server/index.ts`. Streaming and WS cancellation do not yet propagate into `runTurn`.

## 7. Evidence Loop

```mermaid
flowchart LR
  Contract[Architecture Contract] --> Unit[Deterministic Unit Tests]
  Unit --> Golden[Golden Turn Regression]
  Golden --> Smoke[Server Smoke / HTTP / WS]
  Smoke --> Bridge[OpenAI / OneBot Compatibility]
  Bridge --> Web[Frontend View-model Tests]
  Web --> Eval[Eval Quality Gate]
  Eval --> Research[Architecture Scorecard]
  Research --> Backlog[Risk Backlog + Roadmap]
  Backlog --> Contract
```

Current test strength:

The suite is broad for a personal agent project.

Current test gap:

Direct tests are missing for plugin lifecycle, provider fallback/routing, ID-RAG retrieval/rendering, native route auth, frontend PWA/dev-server behavior, browser UI workflows, and cancellation semantics.
