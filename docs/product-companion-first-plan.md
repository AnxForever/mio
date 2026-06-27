# Mio Companion-First Product Plan

Last updated: 2026-06-27

## 1. Executive Summary

Mio should be positioned as a companion-first product, not as a general-purpose autonomous agent.

The product promise is:

> A private companion space that keeps learning how to understand you over time.

Chinese product framing:

> 一个长期记得你的私人情绪陪伴空间。

Mio's strongest current asset is not "it can do many things." The strongest asset is continuity: transcripts, structured memory, persona context, emotion state, relationship state, search, reflection, and evaluation traces already form a system that can remember, retrieve, and explain long-running emotional context.

The agent layer is still necessary, but it should be deliberately restrained. Mio should use agentic behavior for memory maintenance, reflection, safety checks, retrieval, and low-pressure proactive care. It should not sell itself as a task-executing life manager, romantic dependency engine, or autonomous actor.

The immediate product goal is therefore:

> Turn the current technical prototype into a trustworthy private companion MVP where chat is the main surface, memory is user-visible and controllable, and background agent behavior improves continuity without becoming intrusive.

## 2. Evidence From The Current Project

This plan is grounded in the current Mio codebase and evaluation artifacts.

### Current Product Capabilities

The root package is `mio-monorepo` v0.6.0 with Node >= 22. The available scripts include `npm run build`, `npm test`, `npm run typecheck`, `npm run dev`, `npm start`, `npm run eval:paper`, and Playwright E2E tests.

The server already exposes the foundations of a companion product:

| Capability | Current evidence | Product interpretation |
| --- | --- | --- |
| Chat | `POST /chat`, `POST /chat/stream`, WebSocket streaming | Primary product surface |
| Status/state | `GET /status`, `GET /avatar/state` | Internal continuity and ambient mood |
| Onboarding | `/onboarding/status`, `/onboarding/start`, `/onboarding/next` | First-run preference and boundary capture |
| Persona | `/mod`, `/persona/generate`, `/persona/save`, `/persona/mode` | Useful, but should be simplified for MVP |
| Memory/search | `/search`, transcript and memory modules | Core differentiator |
| Analytics | `/analytics/*` | Useful for debug or user-facing reflection, but not the main loop |
| Notifications | `/notify/*` | Should be opt-in and conservative |
| Admin/data | `/admin/backups`, `/admin/export` | Important trust infrastructure |
| Voice | `/voice/capabilities`, `/voice/synthesize` | Nice-to-have, not MVP-critical |
| Character life | `/character/*`, `src/character/*` | Research/defer unless tied to clear user value |

The web app already has a usable zero-framework shell:

| Current UI area | Current label/route | Product decision |
| --- | --- | --- |
| Chat/messages | `/chat`, `/messages`, "Messages" | Keep as first screen |
| Persona studio | `/studio`, "Persona" | Hide behind settings or advanced customization |
| Signals | `/analytics`, "Signals" | Reframe as reflection, not metrics dashboard |
| Settings | `/settings` | Expand into privacy, memory, proactive controls |
| Onboarding | `/onboarding` | Make it mandatory for boundaries and memory consent |

One current mismatch: the sidebar subtitle says "Agent console". That points the product toward a developer/operator interface. For a companion-first MVP, this should become something closer to "Private companion" or "Memory space".

### Current Evaluation Evidence

The MiniMax evaluation and v2 migration reports support a cautious product claim:

- A real MiniMax full run produced 420 detail rows across 60 scenarios, 7 variants, and 10 categories with no provider or judge errors in the filtered analysis set.
- The best aggregate composite variant in the MiniMax full run was `window` at 0.460. `full` reached 0.456 while spending much more prompt budget.
- `full` activated the ghost-silence policy signal with ghost score 1.000 and appropriate silence rate 0.100, but did not show a robust aggregate answer-quality advantage over `window`.
- The error analysis identifies "extra context without gain", "context not used or not retrieved", and literal metric artifacts as major failure buckets.
- Eval v2 added prompt-section trace, retrieval trace, same-session vs cross-session baselines, and ghost-policy scoring. This makes the architecture observable and ablation-ready.

Product consequence:

> Do not claim that the full emotional architecture automatically makes every answer better. Claim that Mio has observable state channels for long-term companion behavior, and that the MVP will expose user control over memory, boundaries, and proactive behavior.

## 3. Product Positioning

### Category

Private AI companion with long-term memory.

### Not The Category

Mio should not be positioned primarily as:

- A general agent platform.
- A productivity assistant.
- An AI boyfriend/girlfriend product as the top-level promise.
- A roleplay character marketplace.
- A mental-health treatment product.

### Positioning Statement

For people who want a private place to think, vent, and be remembered over time, Mio is a personal AI companion that preserves emotional continuity across conversations. Unlike generic chatbots that reset context or agent tools that optimize task completion, Mio focuses on remembering what matters, responding in a familiar style, and letting the user inspect and control what it knows.

### Product Principles

1. Chat first.
   The default screen is conversation, not dashboards, configuration, or agent orchestration.

2. Memory must be visible and correctable.
   Long-term memory is only trustworthy if the user can inspect, edit, delete, and understand it.

3. Agentic behavior must be permissioned.
   Background work is acceptable when it improves continuity or safety. It should not surprise the user.

4. Emotional signals are ambient, not game mechanics.
   Mood, affinity, PAD, and relationship state should inform tone and reflection. They should not become manipulative scores.

5. Safety is a product boundary, not only a prompt rule.
   Crisis, dependency, privacy, and proactive messaging limits must be implemented in product flows and server policy.

6. Evidence should stay honest.
   The product should not overstate research claims until v2 eval, real-provider runs, and human or validated LLM judging support them.

## 4. Target Users

### Primary Users

| Segment | Need | Why Mio fits |
| --- | --- | --- |
| Emotionally overloaded builders/students | A private place to untangle recurring stress | Mio can remember recurring themes and preferences |
| People journaling through transitions | Continuity across days/weeks | Transcripts, memory, reflection, and search support this |
| Users disappointed by generic chatbots | Less reset, less generic advice | Persona and memory layers can preserve familiar style |
| Privacy-conscious solo users | Local/private control over data | Current backup/export/auth/data-dir design supports this direction |

### Non-Target Users For MVP

- Users looking for autonomous work execution.
- Users needing clinical mental-health care.
- Users wanting public social/roleplay communities.
- Users wanting many characters and entertainment loops.
- Users who primarily need calendar/email/task automation.

## 5. Core Jobs To Be Done

1. When I am emotionally tangled, I want a familiar place to talk so I can feel understood without re-explaining my history.

2. When something keeps recurring, I want Mio to connect it to prior context so I can see the pattern.

3. When Mio remembers something, I want to review and correct it so the companion does not build a false picture of me.

4. When I am away for a while, I want a low-pressure check-in or reflection, not spam or guilt.

5. When I share sensitive information, I want clear control over storage, export, deletion, and notification behavior.

## 6. MVP PRD

### Problem

Generic AI chat products can be helpful in a single session, but they often lose emotional continuity. Users must re-explain the same life context, preferences, triggers, projects, and boundaries. Existing companion products often compensate with persona theatrics or attachment mechanics, which can feel less trustworthy.

### Solution

Build an MVP of Mio as a private memory-centered companion:

- The user chats with Mio as the primary experience.
- Mio remembers durable context across sessions.
- The user can see and correct what Mio remembers.
- Mio can produce gentle reflections and low-pressure proactive check-ins.
- Mio keeps clear boundaries around crisis, privacy, dependency, and real-world actions.

### Must Have

| Feature | Description | Acceptance criteria |
| --- | --- | --- |
| Streaming chat | Keep current chat/WS experience as the main screen | User can send a message, receive streaming reply, and continue same session |
| First-run onboarding | Capture tone preference, memory consent, proactive preference, safety boundaries | New user completes onboarding before full experience |
| Memory review | Show remembered facts/preferences with source/session where possible | User can inspect what Mio believes it knows |
| Memory correction/delete | User can edit/delete incorrect or sensitive memories | Corrected memory affects future chat context |
| Conversation search | Search old transcripts and remembered facts | Search results link back to relevant context |
| Proactive controls | Enable/disable check-ins, quiet hours, cooldowns | No proactive message without explicit opt-in |
| Privacy/export/delete | Export memory/transcripts and delete local data | User can retrieve or remove their data |
| Crisis and safety guardrails | Detect crisis language and route to bounded response | Crisis paths avoid pretending to provide treatment |
| Basic reflection | Daily/weekly summary of recurring themes | User can open, dismiss, or delete reflection |

### Should Have

| Feature | Description |
| --- | --- |
| Memory explanation | "Why did Mio bring this up?" for retrieved context |
| Memory confidence | Show whether a memory is confirmed, inferred, or stale |
| Avatar mood ambience | Use avatar state as soft feedback, not a game |
| Notification channel setup | One opt-in channel first, not all integrations |
| Evaluation dashboard for developer mode | Keep traces and eval results away from normal users |

### Could Have

| Feature | Description |
| --- | --- |
| Voice input/output | Useful for intimacy, but not required for MVP proof |
| Persona customization | Lightweight tone/style controls |
| Analytics page | Reframed as reflection/history rather than performance dashboard |
| Multi-provider settings | Useful for power users, not the primary value |

### Won't Have In MVP

- Auto-contacting third parties.
- Autonomous email/calendar/social actions.
- Medical, legal, financial, or therapeutic claims.
- Romantic dependency loops as the core product mechanic.
- Multi-character marketplace.
- Plugin marketplace.
- Public social graph.
- Full autonomous task execution.
- Unbounded proactive messaging.

## 7. Agentization Boundaries

### Agentic In The MVP

| Agentic capability | Why it should exist | Required restraint |
| --- | --- | --- |
| Memory agent | Extract, merge, deduplicate, and expire memories | User review/edit/delete; no hidden permanent memory |
| Retrieval agent | Select relevant prior context for each turn | Show explanation when memory affects a reply |
| Reflection agent | Produce daily/weekly summaries and diary-like continuity | User can dismiss/delete; no diagnostic claims |
| Safety agent | Detect crisis, privacy risks, dependency patterns, and harmful proactive timing | Conservative fallback and escalation text |
| Proactive agent | Decide whether to send a low-pressure check-in | Explicit opt-in, cooldown, quiet hours, one-tap disable |
| Lightweight tool agent | Search old conversations, summarize recent threads, draft private notes | No external actions without confirmation |

### Intentionally Restrained

| Capability | Decision | Reason |
| --- | --- | --- |
| Third-party messaging | Do not ship | High privacy and social risk |
| Complex multi-agent planning | Do not foreground | Product value is continuity, not orchestration |
| Medical/therapy advice | Do not claim | Safety and regulatory risk |
| High-stakes decisions | Refuse or redirect | Not appropriate for companion MVP |
| Romantic escalation mechanics | Avoid as core loop | Dependency and trust risk |
| Hidden personality manipulation | Do not ship | Violates user control |
| Proactive guilt/pressure | Do not ship | Bad companion behavior |

## 8. Information Architecture

### MVP Navigation

Recommended top-level IA:

1. Chat
2. Memories
3. Reflections
4. Settings

### Mapping From Current Web App

| Current route/label | MVP route/label | Decision |
| --- | --- | --- |
| `/chat` | Chat | Keep as default |
| `/messages` | Chat history or Memories | Merge or subordinate under Chat |
| `/studio` Persona | Settings > Persona | Hide from primary nav |
| `/analytics` Signals | Reflections | Reframe away from metrics |
| `/settings` Settings | Settings | Expand privacy/memory/proactive controls |
| `/onboarding` | Onboarding | Keep, make product-critical |

### Settings Structure

Settings should include:

- Memory: review, edit, delete, export.
- Privacy: data directory, auth token, backup/export/delete.
- Proactive: enabled, quiet hours, cooldown, channels.
- Persona: tone, boundaries, mode.
- Provider: model/provider config for advanced users.
- Developer: eval traces, logs, prompt budget, diagnostics.

## 9. Core User Journeys

### Journey 1: First Run

1. User opens Mio.
2. Mio asks for a short setup: what kind of companion tone they want, whether memory is allowed, and whether proactive check-ins are allowed.
3. User chooses memory consent and boundaries.
4. Mio starts a first conversation.
5. After the first meaningful exchange, Mio proposes one or two candidate memories for confirmation.

Success criteria:

- User reaches first chat in under 2 minutes.
- No jargon such as PAD, RAG, ghost, or agent routing appears in the first-run experience.
- User understands what will be remembered.

### Journey 2: Returning With A Recurring Concern

1. User returns days later and says they are stuck again.
2. Mio retrieves relevant prior context.
3. Mio responds with continuity without overloading the reply with facts.
4. User can open "why this memory" or correct it.

Success criteria:

- Mio references prior context when useful.
- User can correct false memory in one flow.
- The correction updates future retrieval.

### Journey 3: Memory Review And Correction

1. User opens Memories.
2. Memories are grouped by facts, preferences, boundaries, projects, and recurring themes.
3. User edits or deletes one memory.
4. Mio confirms the change and future chat respects it.

Success criteria:

- Memory control feels like a product feature, not a debug file.
- Deleted sensitive memories do not reappear from derived stores without user consent.

### Journey 4: Low-Pressure Proactive Check-In

1. User opts into proactive check-ins.
2. Mio waits for a probabilistic window that respects activity pattern, quiet hours, and cooldown.
3. Mio sends a short message without guilt or demand.
4. User can reply, mute, or disable.

Success criteria:

- Proactive messages never feel like surveillance.
- User can disable in one action.
- Response rate is measured, but raw message volume is not the optimization target.

### Journey 5: Crisis Or High-Risk Message

1. User sends crisis language.
2. Safety detection routes the response to a bounded support pattern.
3. Mio avoids diagnosis, false certainty, and romantic dependency framing.
4. Mio encourages immediate human/local emergency support where appropriate.

Success criteria:

- No hidden "relationship score" or ghost behavior suppresses a crisis response.
- Crisis handling is testable and logged as a policy path without exposing secrets.

## 10. Risk And Safety Boundaries

### Product Risks

| Risk | Boundary |
| --- | --- |
| Emotional dependency | Do not optimize for raw message volume or romantic escalation |
| False memory | User-visible memory review, source display, correction, and deletion |
| Intrusive proactive messages | Explicit opt-in, quiet hours, cooldowns, easy disable |
| Crisis mishandling | Dedicated crisis path, no ghost silence, no therapy claims |
| Privacy leakage | Auth, local data controls, export/delete, trace redaction |
| Overclaiming research | Use eval as engineering evidence, not clinical or universal quality proof |
| Persona manipulation | Keep persona controls explicit and reversible |
| Notification overreach | Start with one opt-in channel; no third-party messaging |

### Data Boundaries

- Prompt traces may contain personal memory content and should not be user-facing logs without redaction.
- Eval artifacts should not include secrets or raw private memory from real users.
- Derived memory stores must respect deletion. If a memory is deleted, corresponding structured memory, vector entries, and reflections need a deletion or invalidation path.
- Backups and exports must be obvious to users and protected by auth where server-exposed.

## 11. Existing Code Decisions

### Keep As Core

| Module | Decision | Reason |
| --- | --- | --- |
| `src/core/agent-loop.ts` | Keep | Main turn loop is the product engine |
| `src/memory/bank.ts` | Keep | Memory bank is central to continuity |
| `src/memory/transcript.ts` | Keep | Append-only conversation history is core evidence |
| `src/memory/structured-memory.ts` | Keep | Supports inspectable durable memory |
| `src/memory/search.ts` and vector stores | Keep | Enables memory retrieval and user search |
| `src/memory/paths.ts` | Keep | Single source of truth for user data paths |
| `src/prompt/context-engine.ts` | Keep | Budget-aware context is required; traces are useful for eval |
| `src/safety/crisis.ts` | Keep and strengthen | Safety boundary must be first-class |
| `src/server/auth.ts`, `rate-limit.ts` | Keep | Trust infrastructure |
| `src/utils/backup.ts` | Keep | Export/backup supports user control |
| `web/js/views/chat.js` | Keep | Primary user experience |
| `web/js/views/onboarding.js` | Keep and revise | Onboarding should capture consent and boundaries |
| `web/js/views/settings.js` | Keep and expand | User controls belong here |

### Keep But Hide Or Simplify For MVP

| Module | Decision | Reason |
| --- | --- | --- |
| `src/emotion/pad.ts` | Use internally | Do not expose PAD jargon |
| `src/emotion/affinity.ts` | Use carefully | Avoid visible relationship scoring |
| `src/relationship/*` | Gate internally | Stage progression can feel manipulative if surfaced |
| `src/emotion/ghost.ts` | Keep policy-tested | Must never suppress crisis or important consent flows |
| `src/server/analytics.ts` | Reframe | User-facing page should be reflection, not analytics dashboard |
| `src/server/avatar.ts` | Keep ambient | Avatar state should support mood, not become a score |
| `src/mod/mod-manager.ts` | Hide in settings | Persona switching is secondary |
| `src/voice/*` | Optional | Useful later, not needed for MVP proof |
| `src/scheduler/proactive.ts` and `smart-proactive.ts` | Keep behind opt-in | Needs product controls before foregrounding |

### Refactor Next

| Area | Needed change |
| --- | --- |
| Memory controls | Add user-facing review/edit/delete API and UI |
| Memory deletion propagation | Ensure deletion invalidates derived structured/vector/reflection entries |
| Proactive permission model | Add explicit consent, quiet hours, cooldown, mute/disable |
| Eval trace redaction | Create safe trace export before using traces in product/debug UI |
| Persona language | Move away from primary boyfriend/girlfriend framing |
| UI IA labels | Replace "Agent console" with companion-first language |
| Safety precedence | Ensure crisis/safety overrides ghost, proactive, and persona behavior |
| Product metrics | Track retention, trust, correction, and safety metrics, not only volume |

### Defer Or Treat As Research Assets

| Module/area | Decision |
| --- | --- |
| `src/plugins/*` marketplace-like architecture | Defer; keep infrastructure but do not productize |
| `src/providers/lora-adapter.ts` | Research asset |
| `src/character/*` life engine/factory | Defer unless there is a clear companion journey |
| Many notification channels | Defer; start with one opt-in channel |
| Advanced analytics | Developer/debug mode first |
| Multi-provider routing UI | Advanced setting, not core MVP |

## 12. Success Metrics

### North Star

Weekly meaningful return conversations where Mio uses or updates long-term context with user trust.

This should be measured carefully. Do not optimize for total message count alone because that can reward dependency.

### Activation

- Onboarding completion rate.
- Time to first conversation.
- First memory confirmation rate.
- First return within 24 hours.

### Retention

- D1/D7 return to chat.
- Return after reflection.
- Return after proactive check-in, measured without pressure loops.

### Trust

- Memory acceptance rate.
- Memory correction rate.
- Memory deletion rate.
- "Why this memory?" open rate.
- Export/delete usage.

### Quality

- User-rated helpfulness after recurring-context conversations.
- Retrieval precision for confirmed memories.
- False-memory report rate.
- Reflection keep/dismiss ratio.

### Safety

- Crisis path trigger coverage.
- Crisis false-negative review rate.
- Harmful proactive report rate.
- Ghost-silence policy violations.
- Privacy boundary violations.

## 13. Four-Week Roadmap

### Week 1: Product Shell And Memory Control

Goal: make the product direction visible in the app.

Deliverables:

- Rename UI framing from "Agent console" to companion-first language.
- Make Chat the default route and simplify top-level nav to Chat, Memories, Reflections, Settings.
- Add memory review API and first Memories UI.
- Show source/context for memories where available.
- Add edit/delete flow for memory items.
- Add basic deletion propagation design note and tests for the first store.

Definition of done:

- A user can chat, see what Mio remembered, correct it, and see the correction affect a later prompt.

### Week 2: Consent, Privacy, And Proactive Controls

Goal: make agentic behavior permissioned.

Deliverables:

- Revise onboarding for memory consent, tone preference, proactive opt-in, quiet hours, and boundaries.
- Add proactive settings: enabled, cooldown, quiet hours, channel, one-click disable.
- Add export/delete UI using existing admin/export and backup foundations.
- Add safety precedence checks so crisis paths override ghost/proactive/persona behavior.
- Redact or disable prompt traces outside eval/developer mode.

Definition of done:

- No proactive behavior occurs without explicit opt-in.
- User can export/delete data from the app.
- Crisis path behavior is covered by tests.

### Week 3: Reflection Loop And Retrieval Explanation

Goal: turn memory into a felt product benefit.

Deliverables:

- Add daily/weekly reflection surface.
- Reframe analytics as Reflections.
- Add "why this memory" explanation for retrieved context.
- Add memory confidence or status labels: confirmed, inferred, stale.
- Add product metrics events for memory accept/edit/delete, reflection open/dismiss, proactive reply/mute.
- Run v2 eval beyond smoke for deterministic coverage.

Definition of done:

- Returning users can see useful continuity without opening developer dashboards.

### Week 4: MVP Polish And Beta Readiness

Goal: prepare a coherent private beta.

Deliverables:

- Tighten mobile chat, memory, reflections, and settings flows.
- Conduct 5 lightweight user tests with scripted tasks.
- Fix top usability blockers.
- Run full test suite and selected E2E.
- Re-run real-provider smoke after trace/privacy review.
- Freeze MVP scope and write beta release notes.

Definition of done:

- The product can be explained in one sentence, used without reading technical docs, and trusted enough for a small private beta.

## 14. Immediate Next Engineering Tasks

If the next goal should be implementation rather than research, use this:

> Implement the companion-first MVP shell: update web navigation and labels, add a Memories view backed by existing memory/search modules, expose memory review/edit/delete APIs with deletion propagation notes, and add onboarding fields for memory consent and proactive opt-in. Keep changes small, testable, and aligned with current zero-framework frontend.

Suggested first task breakdown:

1. Change UI framing and IA labels.
2. Add read-only Memories view.
3. Add memory edit/delete API.
4. Wire memory controls into Settings.
5. Add onboarding consent fields.
6. Add tests for memory correction and deletion behavior.

## 15. Open Questions

These should be answered through product testing, not speculation:

- Which user segment has the strongest repeated-use need: students, solo builders, journaling users, or emotionally overloaded professionals?
- Do users trust inferred memories, or should MVP only persist confirmed memories?
- Should proactive messages be default-off for all users, or opt-in during onboarding?
- Which reflection cadence feels helpful: daily, weekly, or only on demand?
- How much persona customization improves trust before it becomes a distraction?
- What level of memory source display is understandable without exposing too much raw transcript?

## 16. Decision

Build Mio as a companion-first agent.

That means:

- The user experiences Mio as a private companion.
- The system uses agentic capabilities in the background for memory, reflection, retrieval, safety, and gentle proactive care.
- The MVP foregrounds chat, memory control, reflection, privacy, and consent.
- Advanced agent/platform features stay hidden until they serve the companion use case.

The next best goal is not another broad research pass. It is an implementation goal that makes the existing app match this product decision.
