/**
 * PAD Plugin — wraps the Pleasure-Arousal-Dominance emotional model
 *
 * Capabilities: ['hook', 'prompt']
 * - onBeforeTurn: calls applyDecay() for time-based emotional decay
 * - onAfterTurn: calls classifyPAD() + updatePAD()
 * - getPromptFragment: returns padToPromptContext() string
 */

import type { SessionContext, PromptCtx } from '../../types.js';
import type { Plugin, PluginManifest, TurnOutput } from '../types.js';
import {
  isPADEnabled,
  applyDecay,
  classifyPAD,
  updatePAD,
  getPADState,
  padToPromptContext,
} from '../../emotion/pad.js';

export const PAD_MANIFEST: PluginManifest = {
  name: 'pad',
  version: '1.0.0',
  description: 'PAD (Pleasure-Arousal-Dominance) three-dimensional emotional model',
  capabilities: ['hook', 'prompt'],
  config: {},
};

export const padPlugin: Plugin = {
  manifest: PAD_MANIFEST,

  onBeforeTurn: async (ctx: SessionContext): Promise<void> => {
    if (!isPADEnabled()) return;
    applyDecay();
  },

  onAfterTurn: async (ctx: SessionContext, result: TurnOutput): Promise<void> => {
    if (!isPADEnabled()) return;
    // classifyPAD requires the user message text. When agent-loop integrates
    // this through the plugin system, it passes the user message via context.
    // For now, this is a no-op wrapper — the real call still happens in
    // emotion/tracker.ts which is called by agent-loop's trackEmotion().
  },

  getPromptFragment: (ctx: PromptCtx): string | null => {
    if (!isPADEnabled()) return null;
    try {
      const pad = getPADState();
      return padToPromptContext(pad);
    } catch {
      return null;
    }
  },
};
