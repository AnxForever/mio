/**
 * Mio — Reflection Memory
 *
 * Generates higher-level insights from recent high-importance events.
 * V1: Template-based (no LLM calls). Groups events by tags → maps to insight templates.
 * V2: LLM-driven reflection.
 *
 * Triggered during nightly consolidation (Phase 3 REM).
 */

import { readEvents } from './memory-stream.js';
import { readStoryArcs } from './story-arcs.js';
import type { LifeEvent } from './types.js';
import { logger } from '../utils/logger.js';

// ─── Template-based reflection ───

interface ReflectionTemplate {
  /** Tag patterns to match */
  tags: string[];
  /** Minimum number of matching events */
  minCount: number;
  /** Insight template */
  insight: string;
}

const REFLECTION_TEMPLATES: ReflectionTemplate[] = [
  {
    tags: ['negative', 'tired'],
    minCount: 3,
    insight: '最近一直很疲惫，可能是该给自己放个假了。一直在撑着，但其实没有人要求{pronoun}必须这么辛苦。',
  },
  {
    tags: ['negative', 'conflict'],
    minCount: 2,
    insight: '最近的人际关系有点紧绷。{pronoun}在反思是不是自己太敏感了，还是说有些底线确实该坚持。',
  },
  {
    tags: ['positive', 'connection'],
    minCount: 3,
    insight: '最近和人相处得很舒服。{pronoun}感觉到被在乎，这种温暖让人安心。',
  },
  {
    tags: ['positive', 'productive'],
    minCount: 3,
    insight: '最近效率很高，{pronoun}觉得生活好像走上了正轨。这种掌控感很踏实。',
  },
  {
    tags: ['challenge', 'stress'],
    minCount: 3,
    insight: '{pronoun}最近面对的挑战有点多。虽然相信自己能做好，但压力是真的存在的。',
  },
  {
    tags: ['lonely'],
    minCount: 2,
    insight: '{pronoun}最近偶尔感到孤单。可能不是身边没人，而是缺少真正的理解。',
  },
  {
    tags: ['reflective', 'nostalgia'],
    minCount: 2,
    insight: '最近{pronoun}一直在回忆过去。有些东西回不去了，但那些经历成就了现在的{pronoun}。',
  },
  {
    tags: ['story-arc', 'crisis'],
    minCount: 1,
    insight: '{pronoun}正在经历一个重要的转折。这种时候人会想很多，但也正是成长的契机。',
  },
];

// ─── Trait-drift reflection ───

/**
 * Generate a reflection when OCEAN traits have shifted significantly.
 */
export function generateTraitDriftReflection(
  characterName: string,
  previous: Record<string, number>,
  current: Record<string, number>,
): string | null {
  const pronoun = 'ta'; // Will be replaced by caller with context
  const traits = ['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism'];
  const changed: string[] = [];

  for (const t of traits) {
    const delta = (current[t] || 0) - (previous[t] || 0);
    if (Math.abs(delta) < 0.05) continue;

    const dir = delta > 0 ? '更' : '不再那么';
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

  return `最近{pronoun}觉得自己${changed.join('，')}。可能和最近经历的事情有关。`;
}

// ─── Main reflection generator ───

export interface ReflectionResult {
  reflections: string[];
  sourceCount: number;
}

/**
 * Generate reflections from recent memory stream events.
 * Called during nightly consolidation Phase 3.
 */
export function generateReflections(characterName: string): ReflectionResult {
  const events = readEvents(characterName);
  if (events.length < 5) return { reflections: [], sourceCount: 0 };

  // Only consider last 7 days
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = events.filter(
    e => new Date(e.timestamp).getTime() > cutoff && e.importance > 0.3,
  );

  const reflections: string[] = [];

  for (const template of REFLECTION_TEMPLATES) {
    const matches = recent.filter(e =>
      template.tags.some(t => e.tags.includes(t)),
    );
    if (matches.length >= template.minCount) {
      reflections.push(template.insight);
    }
  }

  // Story arc reflections
  const arcs = readStoryArcs(characterName);
  for (const arc of arcs) {
    if (arc.phase === 'crisis') {
      reflections.push(`「${arc.title}」正在最难的阶段。{pronoun}需要一点支持。`);
    } else if (arc.phase === 'resolution') {
      reflections.push(`「${arc.title}」告一段落了。{pronoun}觉得这可能是一个新的开始。`);
    }
  }

  logger.info(
    `[reflection] ${characterName}: ${reflections.length} insights from ${recent.length} events`,
  );

  return {
    reflections,
    sourceCount: recent.length,
  };
}
