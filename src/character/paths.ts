/**
 * Mio — Character System Paths
 *
 * All disk paths for the character system. Single source of truth.
 */

import { join } from 'node:path';
import { getDataDir } from '../config.js';

// ─── Character files ───

/** Directory containing all character mods */
export function modsDir(): string {
  return join(getDataDir(), '..', 'mods');
}

/** Structured character config JSON for a specific character */
export function characterJsonPath(name: string): string {
  return join(modsDir(), name, 'character.json');
}

/** Soul markdown file for a specific character */
export function soulPath(name: string): string {
  return join(modsDir(), name, 'soul.md');
}

/** Seed memory markdown file (generated from character config) */
export function seedMemoryPath(name: string): string {
  return join(modsDir(), name, 'seed-memory.md');
}

// ─── Memory Stream ───

/** Memory stream JSONL file for a character's event history */
export function memoryStreamPath(name: string): string {
  return join(getDataDir(), 'memory-bank', name, 'memory-stream.jsonl');
}

/** Story arcs JSON file */
export function storyArcsPath(name: string): string {
  return join(getDataDir(), 'memory-bank', name, 'story-arcs.json');
}

/** Reflection memory JSON file */
export function reflectionPath(name: string): string {
  return join(getDataDir(), 'memory-bank', name, 'reflections.json');
}

/** Life journal JSON file (aggregated view for UI) */
export function lifeJournalPath(name: string): string {
  return join(getDataDir(), 'memory-bank', name, 'life-journal.json');
}

// ─── Active character tracking ───

/** File that stores the currently active character name */
export function activeCharacterPath(): string {
  return join(modsDir(), '.active-character');
}
