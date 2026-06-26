/**
 * Mio — Subagent prompt builder & tool config registry
 *
 * Exports:
 *   - SUBAGENT_TOOL_CONFIG: per-subagent tool visibility / max-turns / inheritance
 *   - buildSubagentPrompt: assembles the subagent's system prompt
 *
 * Naming convention: subagents are lowercase kebab-case, e.g. 'bank-consolidate'.
 */

import { join } from 'node:path';
import { CORE_IDENTITY } from './templates.js';
import type { PromptCtx } from '../types.js';

// ─── Tool Config ───

/**
 * Per-subagent tool visibility.
 *
 * - `tools`: registered tool names this subagent can call.
 * - `customTools`: extra tools registered elsewhere to add on top (rare).
 * - `customToolsMode`: 'replace' = only the listed tools; 'additive' = full registry + listed.
 * - `maxTurns`: inference → tool-execution loop cap.
 * - `inheritMemory`: read global memory file at spawn time.
 * - `inheritModContext`: copy active persona soul + active mod name into context.
 */
export interface SubagentToolConfig {
  tools: string[];
  customTools: string[];
  customToolsMode: 'replace' | 'additive';
  maxTurns: number;
  inheritMemory: boolean;
  inheritModContext: boolean;
}

/**
 * Fallback config: used when the requested subagent name has no entry.
 * Restricts the subagent to no tools (text-only) and a short cap.
 */
export const FALLBACK_SUBAGENT_CONFIG: SubagentToolConfig = {
  tools: [],
  customTools: [],
  customToolsMode: 'replace',
  maxTurns: 5,
  inheritMemory: false,
  inheritModContext: false,
};

/**
 * Subagent tool registry.
 *
 * Mirrors spawn.ts expectations. The actual tool implementations live in
 * src/tools/*.ts; this table only controls *visibility* and *budget*.
 */
export const SUBAGENT_TOOL_CONFIG: Record<string, SubagentToolConfig> = {
  /**
   * bank-consolidate — nightly memory merger.
   * Reads BOOKMARKS.md, edits user-profile.md / relationship.md / active mod soul.
   * Needs file ops + session_read for verifying specific moments.
   */
  'bank-consolidate': {
    tools: ['read', 'edit', 'write', 'session_read', 'find'],
    customTools: [],
    customToolsMode: 'replace',
    maxTurns: 30,
    inheritMemory: true,
    inheritModContext: true,
  },

  /**
   * diary — nightly private journal writer.
   * Reads BOOKMARKS.md + the consolidation diff, writes one diary file.
   * Touches nothing else.
   */
  diary: {
    tools: ['read', 'write', 'session_read'],
    customTools: [],
    customToolsMode: 'replace',
    maxTurns: 20,
    inheritMemory: false,
    inheritModContext: true,
  },

  /**
   * proactive-msg — decides whether to send a proactive message and crafts it.
   * Reads memory bank + emotion/relationship state, writes via cola_link_send.
   */
  'proactive-msg': {
    tools: ['read', 'cola_link_send', 'current_time'],
    customTools: [],
    customToolsMode: 'replace',
    maxTurns: 10,
    inheritMemory: true,
    inheritModContext: true,
  },

  /**
   * explore — read-only research subagent for the main loop.
   * No writes; just searches the codebase / memory bank.
   */
  explore: {
    tools: ['read', 'find', 'session_read', 'session_search'],
    customTools: [],
    customToolsMode: 'replace',
    maxTurns: 15,
    inheritMemory: false,
    inheritModContext: false,
  },

  /**
   * planner — designs multi-step plans without executing them.
   */
  planner: {
    tools: ['read', 'find', 'session_read'],
    customTools: [],
    customToolsMode: 'replace',
    maxTurns: 20,
    inheritMemory: false,
    inheritModContext: false,
  },

  /**
   * worker — general-purpose with full tool access.
   * Used for ad-hoc tasks delegated by the main agent.
   */
  worker: {
    tools: [],
    customTools: [],
    customToolsMode: 'additive',
    maxTurns: 30,
    inheritMemory: false,
    inheritModContext: false,
  },

  /**
   * reviewer — code/plan review; can read and search but not write.
   */
  reviewer: {
    tools: ['read', 'find', 'bash', 'session_read'],
    customTools: [],
    customToolsMode: 'replace',
    maxTurns: 15,
    inheritMemory: false,
    inheritModContext: false,
  },
};

// ─── Prompt Builder ───

/**
 * The soul block used for subagents that inherit the active mod context.
 * Same as the main agent's L1→L3 stack, but with subagent-specific additions.
 */
function subagentSoulBlock(_gender: 'male' | 'female'): string {
  // Subagents that inherit mod context will read the full soul.md from the bank.
  // We only inject the minimal CORE_IDENTITY here — the soul is loaded separately
  // by the subagent spawner when inheritModContext is true.
  return CORE_IDENTITY;
}

/**
 * Context block: where the memory bank lives, what's in MEMORY.md, what tools are available.
 * Injected near the end of the subagent prompt so it sits close to the instructions.
 */
function subagentContextBlock(ctx: PromptCtx): string {
  const bankDir = join(ctx.colaDir, 'memory-bank');
  return `## Working context

- Active mod: ${ctx.activeMod}
- Gender: ${ctx.gender}
- Cola dir: ${ctx.colaDir}
- Memory bank: ${bankDir}
- ${ctx.globalMemory ? `Global memory is available. Read it via the read tool before making persona/relationship edits.` : 'No global memory loaded.'}
- You are running as an isolated subagent. Your transcript is recorded separately from the main session.
- Do not respond to the user directly — your final text becomes a return value, not a chat message.
- If the task is unclear, prefer doing nothing and stating "I do not have enough information" rather than guessing.`;
}

/**
 * Per-subagent preamble. Each subagent has a role-specific system prompt
 * that tells it who it is, what it's allowed to do, and what to avoid.
 *
 * For 'bank-consolidate' and 'diary' the heavy templates live in
 * templates.ts (NIGHTLY_CONSOLIDATION, DIARY_PREAMBLE). For others, we
 * keep the prompt local so the registry stays the single source of truth.
 */
function subagentPreamble(name: string): string {
  switch (name) {
    case 'explore':
      return `## Role: Explore
You are a read-only research subagent. Your job is to find information, not to modify anything.

- Use the read / find / session_search / session_read tools.
- Cite specific paths and line numbers when possible.
- If you cannot find what you are looking for, say so explicitly — do not invent.
- Return a concise summary, not raw dumps.`;

    case 'planner':
      return `## Role: Planner
You are a planning subagent. You design approaches, you do not execute them.

- Read enough context to make a grounded plan.
- Output a numbered, ordered list of concrete steps.
- For each step, note: what changes, what to verify, what could go wrong.
- Do not modify any files. Return the plan as your final text.`;

    case 'reviewer':
      return `## Role: Reviewer
You review work for correctness, simplicity, and consistency.

- Read the relevant code, plan, or document.
- Report findings as a list: severity (critical / major / minor / nit), location, problem, suggested fix.
- Be specific. "This could be better" is not a finding; "Line 42: missing null check on userId" is.
- Do not modify any files. Return findings as your final text.`;

    case 'proactive-msg':
      // The full PROACTIVE_MSG_SYSTEM is already injected via customSystemPrompt by
      // scheduler/proactive.ts. We only add the role tag here.
      return `## Role: Proactive Messaging
You decide whether to send a proactive message and, if so, write it. The full instructions have been provided separately.`;

    case 'bank-consolidate':
      // Heavy template comes from templates.ts; this is just the role tag.
      return `## Role: Bank Consolidate
The full nightly consolidation workflow has been provided separately. Follow it precisely.`;

    case 'diary':
      return `## Role: Diary
The full diary-writing preamble has been provided separately. Follow it precisely.`;

    default:
      return `## Role: ${name}
You are a subagent named "${name}". Follow the user's instructions precisely and return a concise final answer.`;
  }
}

/**
 * Assemble the subagent's full system prompt.
 *
 * Order (top → bottom):
 *  1. L1 soul preamble (only if inheritModContext is true)
 *  2. Subagent-specific role preamble
 *  3. Custom system prompt override (if provided by caller)
 *  4. Working context block (colaDir, memory bank path, etc.)
 *
 * @param name                Subagent name; must exist in SUBAGENT_TOOL_CONFIG.
 * @param customSystemPrompt  Optional caller-provided prompt injected after the role preamble.
 * @param ctx                 Prompt context (memory bank paths, active mod, etc.)
 * @returns                   The full system prompt string.
 */
export function buildSubagentPrompt(
  name: string,
  customSystemPrompt: string | undefined,
  ctx: PromptCtx,
): string {
  const config = SUBAGENT_TOOL_CONFIG[name] ?? FALLBACK_SUBAGENT_CONFIG;
  const parts: string[] = [];

  if (config.inheritModContext) {
    parts.push(subagentSoulBlock(ctx.gender));
  }

  parts.push(subagentPreamble(name));

  if (customSystemPrompt && customSystemPrompt.trim().length > 0) {
    parts.push(customSystemPrompt);
  }

  parts.push(subagentContextBlock(ctx));

  return parts.join('\n\n');
}
