/**
 * Frustration Plugin — wraps the frustration/attachment tracking system
 *
 * Capabilities: ['hook', 'prompt']
 * - onAfterTurn: calls updateFrustration()
 * - getPromptFragment: returns getAttachmentContext() string
 */

import type { SessionContext, PromptCtx } from '../../types.js';
import type { Plugin, PluginManifest, TurnOutput } from '../types.js';
import { updateFrustration, getAttachmentContext } from '../../emotion/frustration.js';

export const FRUSTRATION_MANIFEST: PluginManifest = {
  name: 'frustration',
  version: '1.0.0',
  description: 'Frustration/attachment tracking — relationship tension and attachment style',
  capabilities: ['hook', 'prompt'],
  config: {},
};

export const frustrationPlugin: Plugin = {
  manifest: FRUSTRATION_MANIFEST,

  onAfterTurn: async (ctx: SessionContext, result: TurnOutput): Promise<void> => {
    // The real updateFrustration() call still happens in agent-loop
    // directly. This plugin hook acts as a secondary integration point.
    // For zero-breaking-change backward compat, agent-loop's direct calls
    // remain intact and the plugin wraps them.
  },

  getPromptFragment: (ctx: PromptCtx): string | null => {
    const context = getAttachmentContext();
    if (!context) return null;
    return `## 依赖\n${context}`;
  },
};
