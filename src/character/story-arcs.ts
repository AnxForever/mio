/**
 * Mio — Story Arcs
 *
 * Persistent story arc state management.
 * Each character can have multiple active story arcs.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { StoryArc, StoryArcPhase } from './types.js';
import { storyArcsPath } from './paths.js';
import { logger } from '../utils/logger.js';

/** Read all story arcs for a character */
export function readStoryArcs(characterName: string): StoryArc[] {
  const path = storyArcsPath(characterName);
  if (!existsSync(path)) return [];

  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as StoryArc[];
  } catch {
    return [];
  }
}

/** Write story arcs to disk */
export function writeStoryArcs(characterName: string, arcs: StoryArc[]): void {
  const path = storyArcsPath(characterName);
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  try {
    writeFileSync(path, JSON.stringify(arcs, null, 2), 'utf-8');
  } catch (err) {
    logger.error('[story-arcs] failed to write', { err: String(err) });
  }
}

/** Update the phase of a specific arc */
export function updateArcPhase(
  arcId: string,
  newPhase: StoryArcPhase,
  characterName: string,
): void {
  const arcs = readStoryArcs(characterName);
  const arc = arcs.find(a => a.id === arcId);
  if (!arc) return;

  arc.phase = newPhase;
  writeStoryArcs(characterName, arcs);
}
