/**
 * Mio — Reflection Memory
 *
 * Based on Smallville's reflection mechanism (reflect.py):
 *   1. Counter-based trigger: importance_trigger_curr decrements to 0 → reflect
 *   2. Focal points generation → retrieve relevant nodes → generate insights
 *   3. Each thought has SPO triple, poignancy, evidence links, 30-day expiration
 *
 * V1: Template-based (no LLM). V2: LLM-driven with prompt templates.
 */

import { readEvents, appendEvent } from './memory-stream.js';
import { readStoryArcs } from './story-arcs.js';
import type { LifeEvent } from './types.js';
import { logger } from '../utils/logger.js';

// ─── Reflection trigger counter ───

const TRIGGER_THRESHOLD = 150; // Importance points to accumulate before firing

interface ReflectionState {
  /** Accumulated importance points from new events */
  importanceAccumulated: number;
  /** Number of events since last reflection */
  eventsSinceLastReflection: number;
  /** Last time reflection ran */
  lastReflectionAt: string | null;
}

// In-memory state (resets on process restart)
const _state: Map<string, ReflectionState> = new Map();

function getState(characterName: string): ReflectionState {
  if (!_state.has(characterName)) {
    _state.set(characterName, {
      importanceAccumulated: 0,
      eventsSinceLastReflection: 0,
      lastReflectionAt: null,
    });
  }
  return _state.get(characterName)!;
}

/**
 * Feed importance points into the trigger counter.
 * Returns true if reflection should fire.
 *
 * Smallville (reflect.py):
 *   if persona.scratch.importance_trigger_curr <= 0
 *   → fire reflection, then reset counter
 *
 * Our adaptation: accumulate importance UPWARD until threshold.
 */
export function feedReflectionTrigger(characterName: string, importance: number): boolean {
  const state = getState(characterName);
  state.importanceAccumulated += importance * 100; // Scale to larger range
  state.eventsSinceLastReflection++;
  return state.importanceAccumulated >= TRIGGER_THRESHOLD;
}

/** Reset the trigger counter after reflection fires */
export function resetReflectionTrigger(characterName: string): void {
  const state = getState(characterName);
  state.importanceAccumulated = 0;
  state.eventsSinceLastReflection = 0;
  state.lastReflectionAt = new Date().toISOString();
}

// ─── SPO extraction ───

interface SPOTriple {
  subject: string;
  predicate: string;
  object: string;
}

/**
 * Extract subject-predicate-object from a thought string.
 * V1: Simple pattern matching (no LLM).
 * Smallville uses run_gpt_prompt_event_triple() for this.
 */
function extractSPO(thought: string): SPOTriple {
  // Pattern: "X 觉得 Y" / "X 在 Z" / "X 是 Y" / "X 被 Y"
  const patterns: { regex: RegExp; extract: (m: RegExpMatchArray) => SPOTriple }[] = [
    {
      regex: /^(.{1,8})(觉得|认为|感到|感觉)(.{1,30})/,
      extract: (m) => ({ subject: m[1], predicate: m[2], object: m[3] }),
    },
    {
      regex: /^(.{1,8})(在|去|做|经历)(.{1,30})/,
      extract: (m) => ({ subject: m[1], predicate: m[2], object: m[3] }),
    },
    {
      regex: /^(.{1,8})(是|不是|变得)(.{1,30})/,
      extract: (m) => ({ subject: m[1], predicate: m[2], object: m[3] }),
    },
  ];

  for (const p of patterns) {
    const m = thought.match(p.regex);
    if (m) return p.extract(m);
  }
  // Default: treat first char block as subject, rest as object
  return { subject: thought.slice(0, 4), predicate: '经历', object: thought.slice(4) };
}

// ─── Template-based reflection ───

interface ReflectionTemplate {
  tags: string[];
  minCount: number;
  insight: string;
}

const REFLECTION_TEMPLATES: ReflectionTemplate[] = [
  {
    tags: ['negative', 'tired'],
    minCount: 3,
    insight: '最近一直很疲惫，可能是该给自己放个假了。一直在撑着，但其实没有人要求我必须这么辛苦。',
  },
  {
    tags: ['negative', 'conflict'],
    minCount: 2,
    insight: '最近的人际关系有点紧绷。我在反思是不是自己太敏感了，还是说有些底线确实该坚持。',
  },
  {
    tags: ['positive', 'connection'],
    minCount: 3,
    insight: '最近和人相处得很舒服。感觉到被在乎，这种温暖让人安心。',
  },
  {
    tags: ['positive', 'productive'],
    minCount: 3,
    insight: '最近效率很高，生活好像走上了正轨。这种掌控感很踏实。',
  },
  {
    tags: ['challenge', 'stress'],
    minCount: 3,
    insight: '最近面对的挑战有点多。虽然相信自己能做好，但压力是真的存在的。',
  },
  {
    tags: ['lonely'],
    minCount: 2,
    insight: '最近偶尔感到孤单。可能不是身边没人，而是缺少真正的理解。',
  },
  {
    tags: ['reflective', 'nostalgia'],
    minCount: 2,
    insight: '最近一直在回忆过去。有些东西回不去了，但那些经历成就了现在的我。',
  },
  {
    tags: ['story-arc', 'crisis'],
    minCount: 1,
    insight: '正在经历一个重要的转折。这种时候人会想很多，但也正是成长的契机。',
  },
];

// ─── Main reflection ───

export interface ReflectionResult {
  /** Generated reflection insights */
  insights: { thought: string; spo: SPOTriple; evidence: string[] }[];
  /** Number of source events */
  sourceCount: number;
  /** Whether the trigger fired */
  triggered: boolean;
}

/**
 * Run a reflection cycle for a character.
 * Should be called:
 *   1. When feedReflectionTrigger() returns true
 *   2. During nightly consolidation (Phase 3 REM)
 */
export function runReflection(
  characterName: string,
  force = false,
): ReflectionResult {
  const state = getState(characterName);

  if (!force && state.importanceAccumulated < TRIGGER_THRESHOLD) {
    return { insights: [], sourceCount: 0, triggered: false };
  }

  const events = readEvents(characterName);
  if (events.length < 3) return { insights: [], sourceCount: 0, triggered: false };

  // Only consider last 7 days
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = events.filter(
    e => new Date(e.timestamp).getTime() > cutoff && e.importance > 0.3,
  );

  const insights: ReflectionResult['insights'] = [];

  // 1. Template-based insights
  for (const template of REFLECTION_TEMPLATES) {
    const matches = recent.filter(e =>
      template.tags.some(t => e.tags.includes(t)),
    );
    if (matches.length >= template.minCount) {
      const spo = extractSPO(template.insight.replace(/\{pronoun\}/g, '我'));
      insights.push({
        thought: template.insight.replace(/\{pronoun\}/g, '我'),
        spo,
        evidence: matches.map(e => e.id),
      });
    }
  }

  // 2. Story arc reflections
  const arcs = readStoryArcs(characterName);
  for (const arc of arcs) {
    if (arc.phase === 'crisis') {
      const thought = `「${arc.title}」正在最难的阶段。{pronoun}需要一点支持。`.replace(/\{pronoun\}/g, '我');
      insights.push({
        thought,
        spo: extractSPO(thought),
        evidence: arc.events.slice(-3),
      });
    } else if (arc.phase === 'resolution') {
      const thought = `「${arc.title}」告一段落了。{pronoun}觉得这可能是一个新的开始。`.replace(/\{pronoun\}/g, '我');
      insights.push({
        thought,
        spo: extractSPO(thought),
        evidence: arc.events.slice(-3),
      });
    }
  }

  // 3. Write reflections back into memory stream (Smallville: 30-day expiration)
  for (const insight of insights) {
    appendEvent(
      characterName,
      insight.thought,
      'random', // reflections don't fit neatly into life categories
      { pleasure: 0.05, arousal: 0.0, dominance: 0.1 },
      {
        type: 'reflection',
        importance: 0.9, // Reflections are always high importance
        tags: ['reflection', ...(insight.spo ? [insight.spo.predicate] : [])],
      },
    );
  }

  // Reset trigger counter
  resetReflectionTrigger(characterName);

  logger.info(
    `[reflection] ${characterName}: ${insights.length} insights from ${recent.length} events (triggered)`,
  );

  return {
    insights,
    sourceCount: recent.length,
    triggered: true,
  };
}

// ─── Trait-drift reflection ───

export function generateTraitDriftReflection(
  previous: Record<string, number>,
  current: Record<string, number>,
): string | null {
  const traits = ['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism'];
  const changed: string[] = [];

  for (const t of traits) {
    const delta = (current[t] || 0) - (previous[t] || 0);
    if (Math.abs(delta) < 0.05) continue;

    const labels: Record<string, string> = {
      openness: delta > 0 ? '更愿意尝试新事物了' : '变得更务实了',
      conscientiousness: delta > 0 ? '做事更有条理了' : '变得更随性了',
      extraversion: delta > 0 ? '变得更外向了' : '变得更喜欢独处了',
      agreeableness: delta > 0 ? '变得更温柔了' : '变得更有主见了',
      neuroticism: delta > 0 ? '情绪变得更敏感了' : '情绪变得更稳定了',
    };

    if (labels[t]) changed.push(labels[t]);
  }

  if (changed.length === 0) return null;
  return `最近我觉得自己${changed.join('，')}。可能和最近经历的事情有关。`;
}
