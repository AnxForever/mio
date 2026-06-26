/**
 * Built-in plugins barrel export.
 *
 * Exports all builtin plugins as an array so the integration point
 * (agent-loop or server bootstrap) can iterate and register them.
 */

import type { Plugin } from '../types.js';
import { ghostPlugin } from './ghost-plugin.js';
import { affinityPlugin } from './affinity-plugin.js';
import { padPlugin } from './pad-plugin.js';
import { frustrationPlugin } from './frustration-plugin.js';

/**
 * All builtin plugins, in registration order.
 *
 * Order matters if one plugin implicitly depends on another's side effects.
 * Currently no builtin has explicit `requires`, so order is arbitrary
 * but kept alphabetical for predictability.
 */
export const BUILTIN_PLUGINS: Plugin[] = [
  affinityPlugin,
  frustrationPlugin,
  ghostPlugin,
  padPlugin,
];

/**
 * Map of plugin name → Plugin for quick lookup.
 */
export const BUILTIN_PLUGIN_MAP: Record<string, Plugin> = {};
for (const p of BUILTIN_PLUGINS) {
  BUILTIN_PLUGIN_MAP[p.manifest.name] = p;
}

// Re-export individual plugins for selective importing
export { ghostPlugin } from './ghost-plugin.js';
export { affinityPlugin } from './affinity-plugin.js';
export { padPlugin } from './pad-plugin.js';
export { frustrationPlugin } from './frustration-plugin.js';
