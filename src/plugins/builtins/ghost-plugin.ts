/**
 * Ghost Plugin — wraps the ghost silence mechanism
 *
 * Capabilities: ['hook']
 * - onBeforeTurn: calls shouldGhost(), sets ghosted flag on context
 * - onAfterTurn: calls markReplied() if not ghosted
 *
 * Does NOT provide 'prompt' — ghost is purely behavioral.
 */

import type { SessionContext } from '../../types.js';
import type { Plugin, PluginManifest, TurnOutput } from '../types.js';
import { shouldGhost, markReplied } from '../../emotion/ghost.js';
import { classifyIntent } from '../../emotion/classifier.js';
import { updateAffinity } from '../../emotion/affinity.js';
import { updateFrustration } from '../../emotion/frustration.js';

export const GHOST_MANIFEST: PluginManifest = {
  name: 'ghost',
  version: '1.0.0',
  description: 'Ghost silence mechanism — Mio can choose not to reply',
  capabilities: ['hook'],
  config: {},
};

export const ghostPlugin: Plugin = {
  manifest: GHOST_MANIFEST,

  onBeforeTurn: async (ctx: SessionContext): Promise<void> => {
    // The ghost decision is made before inference. We check here and set
    // a flag on a module-level variable so onAfterTurn knows what happened.
    // The actual ghost logic (skipping inference) is still in agent-loop,
    // which calls shouldGhost() directly.
    // This plugin's onBeforeTurn just ensures the ghost system is "active"
    // — the decision itself is wired at the agent-loop level for clarity.
    // (No-op here; agent-loop handles shouldGhost() as before.)
  },

  onAfterTurn: async (ctx: SessionContext, result: TurnOutput): Promise<void> => {
    // If the turn was ghosted, markReplied was already called in agent-loop.
    // If it was NOT ghosted, markReplied resets the ghost streak.
    if (!result.ghosted) {
      markReplied();
    }
  },
};
