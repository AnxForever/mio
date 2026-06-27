/**
 * Mio — Temporal Entity-Relation Lightweight Graph
 *
 * Lightweight entity-relation tracking using JSON persistence (no Neo4j).
 *
 * Extracts subject-relation-object triples from structured memory durable facts
 * and provides query/context formatting for system prompt injection.
 *
 * Temporal model (inspired by Zep): each relation carries `validFrom` (when it
 * was extracted) and `active` (whether it reflects the CURRENT state). When a
 * *functional* relation changes value (e.g. the user moves "住在·北京" → "住在·上海"),
 * the old object is marked `active=false` and tombstoned with `supersededBy`,
 * instead of both coexisting and contradicting each other.
 *
 * Format persisted to data/entity-graph.json:
 *   [
 *     {
 *       subject: "用户", relation: "lives_in", object: "上海",
 *       confidence: 0.9, evidence: "...", since: "2025-01-01",
 *       validFrom: "2025-01-01T08:00:00.000Z", active: true,
 *       lastSeen: "2025-01-01T08:00:00.000Z"
 *     },
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
  subject: string;       // "用户"
  relation: string;      // "lives_in"
  object: string;        // "上海"
  confidence: number;    // 0-1
  evidence: string;      // source text
  since: string;         // ISO date or YYYY-MM-DD — first observed (legacy anchor)
  validFrom: string;     // ISO timestamp — when this relation was extracted / became the active state
  active: boolean;       // whether this relation reflects the CURRENT state (legacy data defaults to true)
  supersededBy?: string; // "subject|relation|object" key of the relation that replaced this one
  lastSeen?: string;     // ISO timestamp — most recent time this exact fact was re-observed
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

// ─── Temporal helpers ───

/**
 * Functional (single-valued) relations: a person has exactly ONE current value,
 * so a new object supersedes the previous one (a state change like moving city
 * or changing job). Multi-valued relations (likes/dislikes/has_pet/…) instead
 * accumulate — liking a new thing doesn't unlike the old one.
 *
 * Membership is tested after normalizeRelation(), so Chinese aliases such as
 * "住在" / "在...工作" resolve to their canonical English label first.
 */
const FUNCTIONAL_RELATIONS = new Set<string>(['lives_in', 'works_at', 'studies_at']);

function isFunctionalRelation(relation: string): boolean {
  return FUNCTIONAL_RELATIONS.has(normalizeRelation(relation));
}

/** Stable identity key for a relation triple. */
function relationKey(r: Pick<EntityRelation, 'subject' | 'relation' | 'object'>): string {
  return `${r.subject}|${r.relation}|${r.object}`;
}

/**
 * Fill temporal defaults on a possibly-legacy / partial relation record.
 *
 * Backward compatibility: records persisted before the temporal upgrade have no
 * `active` field — they default to `active: true`. Missing `validFrom` falls
 * back to `since` (or the current time), and `lastSeen` defaults to `validFrom`.
 */
function normalizeRelationRecord(r: Partial<EntityRelation>): EntityRelation {
  const validFrom = r.validFrom ?? r.since ?? new Date().toISOString();
  return {
    subject: r.subject ?? '',
    relation: r.relation ?? '',
    object: r.object ?? '',
    confidence: typeof r.confidence === 'number' ? r.confidence : 0.5,
    evidence: r.evidence ?? '',
    since: r.since ?? validFrom.slice(0, 10),
    validFrom,
    active: r.active ?? true,
    supersededBy: r.supersededBy,
    lastSeen: r.lastSeen ?? validFrom,
  };
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
            relations.push(
              normalizeRelationRecord({
                subject,
                relation,
                object,
                confidence: fact.confidence,
                evidence: fact.content.slice(0, 120),
                since: fact.firstSeen.slice(0, 10),
                validFrom: new Date().toISOString(),
                active: true,
              }),
            );
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
 * Only ACTIVE (current-state) relations are rendered, so a superseded fact (the
 * user's old city after they moved) never leaks into the live context. When
 * `includeHistory` is true, a compact "（曾经: …）" trailer lists superseded
 * facts — current state always comes first.
 *
 * Example output:
 *   "关于用户: 喜欢·拿铁咖啡, 科幻电影 | 讨厌·社交场合 | lives_in·上海"
 *   with history → "… | lives_in·上海 （曾经: lives_in·北京）"
 *
 * @param userId          The user identifier used as subject (default "用户")
 * @param includeHistory  Append a "（曾经: …）" trailer of superseded facts (default false)
 * @returns               Formatted context string, or empty string if no relations
 */
export function getRelationContext(userId: string = '用户', includeHistory: boolean = false): string {
  const graph = readEntityGraph();
  const userRelations = graph.filter((r) => r.subject === userId);

  if (userRelations.length === 0) return '';

  // Group ACTIVE relations by relation label (current state only).
  const byRelation = new Map<string, string[]>();
  for (const rel of userRelations) {
    if (!rel.active) continue;
    const existing = byRelation.get(rel.relation) ?? [];
    existing.push(rel.object);
    byRelation.set(rel.relation, existing);
  }

  // Format: "喜欢·拿铁咖啡, 科幻电影 | 讨厌·社交场合 | lives_in·上海"
  const parts: string[] = [];
  for (const [relation, objects] of byRelation) {
    parts.push(`${relation}·${objects.join(', ')}`);
  }

  let out = parts.length > 0 ? `关于${userId}: ${parts.join(' | ')}` : '';

  // Optional past-state trailer — current state takes priority.
  if (includeHistory) {
    const superseded = userRelations.filter((r) => !r.active);
    if (superseded.length > 0) {
      const past = `（曾经: ${superseded.map((r) => `${r.relation}·${r.object}`).join(', ')}）`;
      out = out ? `${out} ${past}` : `关于${userId}: ${past}`;
    }
  }

  return out;
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
 *
 * Legacy records (persisted before the temporal upgrade, with no `active`/
 * `validFrom` fields) are normalized on read — `active` defaults to true so
 * pre-existing facts keep showing up as current state.
 */
export function readEntityGraph(): EntityRelation[] {
  const path = entityGraphPath();
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSyncSafe(path);
    if (!raw || raw.trim().length === 0) return [];
    const parsed = JSON.parse(raw) as Partial<EntityRelation>[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeRelationRecord);
  } catch {
    return [];
  }
}

/**
 * Merge new relations into the existing graph with temporal state modeling.
 *
 * For each incoming relation:
 *  1. State change — if the relation is *functional* (single-valued, e.g.
 *     lives_in/works_at/studies_at) and the graph already holds an ACTIVE fact
 *     with the same subject+relation but a DIFFERENT object, the old one is
 *     marked `active=false` and tombstoned via `supersededBy`. This is the core
 *     of the temporal upgrade: "搬家" makes the old city stale instead of having
 *     "住在·北京" and "住在·上海" coexist and contradict each other.
 *  2. Same fact — an existing (subject, relation, object) triple is not
 *     duplicated; its confidence/evidence/lastSeen are refreshed and it is
 *     (re)activated (clearing any prior tombstone).
 *  3. New fact — genuinely new triples are appended as active.
 *
 * Multi-valued relations (likes/dislikes/has_pet/…) are NOT superseded: liking
 * a new thing leaves earlier likes intact and active.
 *
 * @param newRelations  Array of new EntityRelation objects to merge
 */
export function mergeEntityGraph(newRelations: EntityRelation[]): void {
  const existing = readEntityGraph();

  for (const incoming of newRelations) {
    const nr = normalizeRelationRecord(incoming);
    const key = relationKey(nr);

    // 1. Functional state change: supersede any other active object for this
    //    subject+relation (different object).
    if (isFunctionalRelation(nr.relation)) {
      for (let i = 0; i < existing.length; i++) {
        const r = existing[i];
        if (r.active && r.subject === nr.subject && r.relation === nr.relation && r.object !== nr.object) {
          existing[i] = { ...r, active: false, supersededBy: key };
        }
      }
    }

    // 2. Same exact fact already present → refresh + (re)activate, no duplicate.
    const idx = existing.findIndex((r) => relationKey(r) === key);
    if (idx !== -1) {
      const cur = existing[idx];
      existing[idx] = {
        ...cur,
        confidence: Math.max(cur.confidence, nr.confidence),
        evidence: nr.evidence || cur.evidence,
        // Keep the original anchor while continuously active; on reactivation
        // (the fact had been superseded and is now true again) start a fresh
        // validity period.
        validFrom: cur.active ? cur.validFrom : nr.validFrom,
        lastSeen: nr.validFrom,
        active: true,
        supersededBy: undefined,
      };
      continue;
    }

    // 3. Genuinely new fact → append as active.
    existing.push({ ...nr, active: true, supersededBy: undefined });
  }

  writeEntityGraph(existing);
}
