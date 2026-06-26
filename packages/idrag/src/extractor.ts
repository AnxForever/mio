/**
 * Mio — Persona Graph Extractor
 *
 * Bootstrapping: parse the active mod's soul.md into a structured knowledge graph.
 *
 * The soul.md is the canonical source of personality. The extractor reads it
 * once at startup (or when it changes), and produces a PersonaGraph that the
 * ID-RAG system uses for dynamic retrieval.
 *
 * Extraction rules:
 * - "# 你是什么样的人" sections → trait nodes
 * - "## 绝不", "什么样的话你不会说" → boundary nodes (high confidence)
 * - "## 怎么说话" → voice nodes
 * - "## 什么样的话你会说" with scenario headers → rule nodes with triggers
 * - "## 和人相处的分寸" with **stage** headers → stage-gated trait/rule nodes
 * - "## 你的原则" → rule nodes
 * - "## 真实的你" → trait nodes (high confidence)
 */

import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readFileSyncSafe, writeFileSyncSafe } from './bank.internal.js';
import { personaGraphPath } from './paths.internal.js';
import { modSoulPath } from './paths.internal.js';
import { modManager } from './mod.internal.js';
import {
  extractGraphFromSoul,
  serializeGraph,
  deserializeGraph,
  defaultGraph,
  type PersonaGraph,
} from './graph.js';

// ─── Public API ───

/**
 * Ensure a persona graph exists for the current active mod.
 *
 * Logic:
 * 1. If graph.json exists and its version matches the current extraction, load it.
 * 2. If not, extract from the active mod's soul.md and persist.
 * 3. If neither soul nor graph exists, return the default empty graph.
 *
 * Returns the loaded or freshly-extracted graph.
 */
export function ensurePersonaGraph(): PersonaGraph {
  // Try loading existing graph
  const existing = tryLoadGraph();
  if (existing) return existing;

  // Extract from soul
  const graph = extractFromActiveSoul();
  if (graph.nodes.length > 0) {
    persistGraph(graph);
    return graph;
  }

  return defaultGraph();
}

/**
 * Refresh the persona graph from the active mod's soul.md.
 * Used after mod switches or nightly consolidation.
 *
 * Returns the new graph (and persists it).
 */
export function refreshPersonaGraph(): PersonaGraph {
  const graph = extractFromActiveSoul();
  if (graph.nodes.length > 0) {
    persistGraph(graph);
  }
  return graph;
}

/**
 * Load the persona graph without extracting.
 * Returns null if no persisted graph exists.
 */
export function loadPersonaGraph(): PersonaGraph | null {
  return tryLoadGraph();
}

/**
 * Determine whether the graph needs to be refreshed.
 * Returns true if soul.md was modified after the graph was last saved.
 */
export function needsRefresh(): boolean {
  try {
    const graphPath = personaGraphPath();
    if (!existsSync(graphPath)) return true;

    const activeMod = modManager().activeMod;
    const soulPath = modSoulPath(activeMod);
    if (!existsSync(soulPath)) return false;

    const soulMtime = statMtime(soulPath);
    const graphMtime = statMtime(graphPath);

    return soulMtime > graphMtime;
  } catch {
    return true;
  }
}

// ─── Internal ───

function tryLoadGraph(): PersonaGraph | null {
  const path = personaGraphPath();
  if (!existsSync(path)) return null;

  try {
    const raw = readFileSyncSafe(path, '');
    if (!raw || raw.trim().length === 0) return null;
    return deserializeGraph(raw);
  } catch {
    return null;
  }
}

function extractFromActiveSoul(): PersonaGraph {
  const activeMod = modManager().activeMod;
  const soulContent = readFileSyncSafe(modSoulPath(activeMod), '');
  if (!soulContent || soulContent.trim().length === 0) return defaultGraph();
  return extractGraphFromSoul(soulContent);
}

function persistGraph(graph: PersonaGraph): void {
  const json = serializeGraph(graph);
  writeFileSyncSafe(personaGraphPath(), json);
}

/**
 * Get file modification time as unix timestamp ms.
 */
function statMtime(path: string): number {
  try {
    const s = statSync(path);
    return s.mtimeMs;
  } catch {
    return 0;
  }
}
