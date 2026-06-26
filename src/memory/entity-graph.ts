/**
 * Mio — Entity-Relation Lightweight Graph
 *
 * Lightweight entity-relation tracking using JSON persistence (no Neo4j).
 *
 * Extracts subject-relation-object triples from structured memory durable facts
 * and provides query/context formatting for system prompt injection.
 *
 * Format persisted to data/entity-graph.json:
 *   [
 *     { subject: "Darling", relation: "likes", object: "拿铁咖啡", confidence: 0.9, evidence: "...", since: "2025-01-01" },
 *     ...
 *   ]
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readFileSyncSafe, writeFileSyncSafe } from './bank.js';
import { colaDir } from './paths.js';
import type { StructuredMemory } from './structured-memory.js';

// ─── Types ───

export interface EntityRelation {
  subject: string;       // "Darling"
  relation: string;      // "likes"
  object: string;        // "拿铁咖啡"
  confidence: number;    // 0-1
  evidence: string;      // source text
  since: string;         // ISO date or YYYY-MM-DD
}

// ─── Path ───

function entityGraphPath(): string {
  return join(colaDir(), 'entity-graph.json');
}

// ─── Relation extraction rules ───
//
// Each rule is a pair: (trigger regex, extraction function).
// The regex matches fact content; the function returns [subject, relation, object] or null.

interface ExtractionRule {
  pattern: RegExp;
  extract: (match: RegExpExecArray) => [string, string, string] | null;
}

/** Normalize relation labels to a consistent short form. */
function normalizeRelation(relation: string): string {
  const map: Record<string, string> = {
    '喜欢': 'likes',
    '喜欢看': 'likes',
    '喜欢吃': 'likes',
    '喜欢喝': 'likes',
    '喜欢玩': 'likes',
    '爱': 'loves',
    '最爱': 'loves',
    '讨厌': 'dislikes',
    '不喜欢': 'dislikes',
    '恨': 'hates',
    '在...工作': 'works_at',
    '在...上班': 'works_at',
    '在...上学': 'studies_at',
    '在...读书': 'studies_at',
    '住在': 'lives_in',
    '在...住': 'lives_in',
    '想去': 'wants_to_go',
    '想买': 'wants_to_buy',
    '想学': 'wants_to_learn',
    '想做': 'wants_to_do',
    '是': 'is_a',
    '有': 'has',
    '养了': 'has_pet',
  };
  return map[relation] ?? relation;
}

const EXTRACTION_RULES: ExtractionRule[] = [
  // "用户喜欢X" / "用户爱X" / "用户不爱X"
  {
    pattern: /(?:用户|Darling|他|她|你)(?:很喜欢|喜欢|爱|不爱|讨厌|不喜欢|最爱)(\S{2,30})/,
    extract: (m) => {
      const obj = m[1];
      const verb = m[0].includes('不爱') || m[0].includes('讨厌') || m[0].includes('不喜欢') ? 'dislikes' : 'likes';
      return ['用户', verb, obj];
    },
  },

  // "用户在X工作/上班"
  {
    pattern: /(?:用户|Darling|他|她|你)在(\S{2,30})(?:工作|上班)/,
    extract: (m) => ['用户', 'works_at', m[1]],
  },

  // "用户在X上学/读书"
  {
    pattern: /(?:用户|Darling|他|她|你)在(\S{2,30})(?:上学|读书|学习)/,
    extract: (m) => ['用户', 'studies_at', m[1]],
  },

  // "用户住在X"
  {
    pattern: /(?:用户|Darling|他|她|你)在(\S{2,30})住/,
    extract: (m) => ['用户', 'lives_in', m[1]],
  },

  // "用户想(要)X"
  {
    pattern: /(?:用户|Darling|他|她|你)想(?:要|去|买|学|做)(\S{2,20})/,
    extract: (m) => ['用户', 'likes', m[1]],
  },

  // "用户养了X" / "用户有X"
  {
    pattern: /(?:用户|Darling|他|她|你)养[了着](\S{2,20})/,
    extract: (m) => ['用户', 'has_pet', m[1]],
  },

  // "用户是X" (occupation/identity)
  {
    pattern: /(?:用户|Darling|他|她|你)是(\S{2,20}(?:生|师|员|人|手|匠))/,
    extract: (m) => ['用户', 'is_a', m[1]],
  },
];

// ─── Main API ───

/**
 * Extract entity relations from structured memory durable facts.
 *
 * Parses each durable fact through extraction rules to produce
 * subject-relation-object triples.
 *
 * @param structured  The StructuredMemory object (typically from structured-memory.ts)
 * @returns           Array of extracted EntityRelation objects
 */
export function extractRelations(structured: StructuredMemory): EntityRelation[] {
  const relations: EntityRelation[] = [];
  const seen = new Set<string>();

  for (const fact of structured.durableFacts) {
    for (const rule of EXTRACTION_RULES) {
      const match = rule.pattern.exec(fact.content);
      if (match) {
        const result = rule.extract(match);
        if (result) {
          const [subject, relation, object] = result;
          // Dedup by (subject, relation, object) tuple
          const key = `${subject}|${relation}|${object}`;
          if (!seen.has(key)) {
            seen.add(key);
            relations.push({
              subject,
              relation,
              object,
              confidence: fact.confidence,
              evidence: fact.content.slice(0, 120),
              since: fact.firstSeen.slice(0, 10),
            });
          }
        }
      }
    }
  }

  return relations;
}

/**
 * Query the entity graph by subject and/or relation.
 *
 * Both parameters are optional — omitted parameters act as wildcards.
 *
 * @param subject   Optional subject filter (e.g. "用户")
 * @param relation  Optional relation filter (e.g. "likes")
 * @returns         Array of matching EntityRelation objects
 */
export function queryRelations(subject?: string, relation?: string): EntityRelation[] {
  const graph = readEntityGraph();
  return graph.filter((r) => {
    if (subject && r.subject !== subject) return false;
    if (relation && r.relation !== relation) return false;
    return true;
  });
}

/**
 * Format entity relation context for system prompt injection.
 *
 * Example output:
 *   "关于Darling: 喜欢·拿铁咖啡, 科幻电影 | 讨厌·社交场合 | 工作·程序员"
 *
 * @param userId  The user identifier used as subject (default "用户")
 * @returns       Formatted context string, or empty string if no relations
 */
export function getRelationContext(userId: string = '用户'): string {
  const graph = readEntityGraph();
  const userRelations = graph.filter((r) => r.subject === userId);

  if (userRelations.length === 0) return '';

  // Group by relation
  const byRelation = new Map<string, string[]>();
  for (const rel of userRelations) {
    const existing = byRelation.get(rel.relation) ?? [];
    existing.push(rel.object);
    byRelation.set(rel.relation, existing);
  }

  // Format: "喜欢·拿铁咖啡, 科幻电影 | 讨厌·社交场合 | 工作·程序员"
  const parts: string[] = [];
  for (const [relation, objects] of byRelation) {
    parts.push(`${relation}·${objects.join(', ')}`);
  }

  return `关于${userId}: ${parts.join(' | ')}`;
}

/**
 * Persist entity relations to data/entity-graph.json.
 *
 * @param relations  Array of EntityRelation objects to write
 */
export function writeEntityGraph(relations: EntityRelation[]): void {
  writeFileSyncSafe(entityGraphPath(), JSON.stringify(relations, null, 2));
}

/**
 * Read the entity graph from disk.
 * Returns an empty array if the file doesn't exist or is corrupt.
 */
export function readEntityGraph(): EntityRelation[] {
  const path = entityGraphPath();
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSyncSafe(path);
    if (!raw || raw.trim().length === 0) return [];
    return JSON.parse(raw) as EntityRelation[];
  } catch {
    return [];
  }
}

/**
 * Merge new relations into the existing graph.
 * Updates confidence and evidence for existing (subject, relation, object) tuples.
 * Appends genuinely new relations.
 *
 * @param newRelations  Array of new EntityRelation objects to merge
 */
export function mergeEntityGraph(newRelations: EntityRelation[]): void {
  const existing = readEntityGraph();
  const seen = new Map<string, number>();

  // Index existing relations by key
  for (let i = 0; i < existing.length; i++) {
    const r = existing[i];
    const key = `${r.subject}|${r.relation}|${r.object}`;
    seen.set(key, i);
  }

  for (const nr of newRelations) {
    const key = `${nr.subject}|${nr.relation}|${nr.object}`;
    const existingIdx = seen.get(key);
    if (existingIdx !== undefined) {
      // Merge: take higher confidence, update evidence
      const existingRel = existing[existingIdx];
      existingRel.confidence = Math.max(existingRel.confidence, nr.confidence);
      existingRel.evidence = nr.evidence;
      existing[existingIdx] = existingRel;
    } else {
      seen.set(key, existing.length);
      existing.push(nr);
    }
  }

  writeEntityGraph(existing);
}
