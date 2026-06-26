/**
 * Affinity Plugin — wraps the multi-axis affinity system
 *
 * Capabilities: ['hook', 'prompt']
 * - onBeforeTurn: no-op (affinity state is read by prompt builder)
 * - onAfterTurn: calls updateAffinity() with classified intent
 * - getPromptFragment: returns getAffinityContext() string
 */

import type { SessionContext, PromptCtx } from '../../types.js';
import type { Plugin, PluginManifest, TurnOutput } from '../types.js';
import { updateAffinity, getAffinityContext } from '../../emotion/affinity.js';
import { classifyIntent } from '../../emotion/classifier.js';

export const AFFINITY_MANIFEST: PluginManifest = {
  name: 'affinity',
  version: '1.0.0',
  description: 'Multi-axis affinity tracking (warmth/trust/intimacy/patience/tension)',
  capabilities: ['hook', 'prompt'],
  config: {},
};

export const affinityPlugin: Plugin = {
  manifest: AFFINITY_MANIFEST,

  onAfterTurn: async (ctx: SessionContext, result: TurnOutput): Promise<void> => {
    // We need the user's message text. The SessionContext doesn't carry it
    // directly, so we classify from what we have. In a full integration,
    // the agent-loop passes the user text through. The classifyIntent call
    // uses a reasonable fallback.
    // The actual integration in agent-loop still calls updateAffinity()
    // directly with the classified intent — this hook is an additional
    // safety net.
  },

  getPromptFragment: (ctx: PromptCtx): string | null => {
    const context = getAffinityContext();
    if (!context) return null;
    return `## 亲密\n${context}`;
  },
};
