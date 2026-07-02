/**
 * Path stubs for @mio/emotion.
 *
 * In a standalone setup, paths come from initEmotion().
 * These stubs delegate to the injected context.
 */
import { join } from 'node:path';
import { getPaths, getEmotionConfig } from './context.js';

export const padStatePath = (dataDir?: string) => getPaths().padState;
export const affinityStatePath = (dataDir?: string) => getPaths().affinityState;
export const multiAxisPath = (dataDir?: string) => getPaths().multiAxis;
export const emotionStatePath = (dataDir?: string) => getPaths().emotionState;
export const ritualStatePath = (dataDir?: string) => getPaths().ritualState;
export const cardboardStatePath = (dataDir?: string) => getPaths().cardboardState;
export const frustrationStatePath = (dataDir?: string) =>
  getPaths().frustrationState ?? join(getEmotionConfig().dataDir, 'frustration-state.json');
export const ghostStatePath = (dataDir?: string) =>
  getPaths().ghostState ?? join(getEmotionConfig().dataDir, 'ghost-state.json');
