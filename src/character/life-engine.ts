/**
 * Mio — Autonomous Life Engine
 *
 * Generates life events for custom characters using:
 *   1. Template events (deterministic, occupation-aware)
 *   2. Story arcs (causal event chains)
 *   3. Crisis events (low-probability, high-impact)
 *
 * Dual-source trigger: Cron (every 3h) + chat post-turn (10-15% probability).
 * Each event carries PAD emotional impact, applied via updatePAD().
 */

import type {
  CharacterConfig,
  LifeEvent,
  LifeEventCategory,
  StoryArc,
  StoryArcPhase,
} from './types.js';
import { EVENT_TEMPLATES, getOccupationContext } from './event-templates.js';
import { appendEvent, readRecentEvents } from './memory-stream.js';
import { readStoryArcs, writeStoryArcs, updateArcPhase } from './story-arcs.js';
import { characterJsonPath } from './paths.js';
import { logger } from '../utils/logger.js';
import { existsSync, readFileSync } from 'node:fs';

// ─── Pronoun resolution ───

function pronoun(gender: string): string {
  const g = gender.toLowerCase();
  if (g === 'female' || g === '女') return '她';
  return '他';
}

function choose<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ─── Template substitution ───

function substitute(template: string, config: CharacterConfig): string {
  const p = pronoun(config.gender);
  const ctx = choose(getOccupationContext(config.occupation));
  return template
    .replace(/\{name\}/g, config.name)
    .replace(/\{pronoun\}/g, p)
    .replace(/\{occupation\}/g, config.occupation)
    .replace(/\{occupationContext\}/g, ctx);
}

// ─── Time-of-day filtering ───

function isMorning(): boolean {
  const h = new Date().getHours();
  return h >= 6 && h < 12;
}

function isAfternoon(): boolean {
  const h = new Date().getHours();
  return h >= 12 && h < 18;
}

function isEvening(): boolean {
  const h = new Date().getHours();
  return h >= 18 || h < 6;
}

// ─── Template filtering by personality ───

function filterByPersonality(
  templates: typeof EVENT_TEMPLATES,
  config: CharacterConfig,
): typeof EVENT_TEMPLATES {
  const p = config.personality;
  let pool = [...templates];

  // Higher extraversion → more social events
  if (p.extraversion > 0.6) {
    const social = pool.filter(e => e.category === 'social');
    if (social.length > 5) pool = [...pool, ...social.slice(0, 5)];
  } else if (p.extraversion < 0.4) {
    pool = pool.filter(e => e.category !== 'social' || e.tags.includes('connection'));
  }

  // Higher neuroticism → more negative events visible
  // Higher agreeableness → more positive social events
  // Higher openness → more creative events

  return pool;
}

// ─── LifeEngine ───

export class LifeEngine {
  /**
   * Advance the character's life by one tick.
   * Returns the generated event, or null if no event was generated.
   */
  tick(characterName: string): LifeEvent | null {
    const config = this.loadConfig(characterName);
    if (!config) return null;

    // 1. Check for crisis events (low probability ~5%)
    if (Math.random() < 0.05) {
      return this.generateCrisisEvent(characterName, config);
    }

    // 2. Check for story arc progression
    const arcEvent = this.maybeAdvanceArc(characterName, config);
    if (arcEvent) return arcEvent;

    // 3. Maybe start a new story arc (low probability ~8%)
    if (Math.random() < 0.08) {
      const newArcEvent = this.maybeStartNewArc(characterName, config);
      if (newArcEvent) return newArcEvent;
    }

    // 4. Generate a template event
    return this.generateTemplateEvent(characterName, config);
  }

  /** Lightweight tick for chat-triggered events (lower probability) */
  tickLight(characterName: string): LifeEvent | null {
    // Chat-triggered: half the base probability
    if (Math.random() > 0.12) return null;
    return this.tick(characterName);
  }

  // ─── Private ───

  private loadConfig(characterName: string): CharacterConfig | null {
    try {
      const path = characterJsonPath(characterName);
      if (!existsSync(path)) return null;
      return JSON.parse(readFileSync(path, 'utf-8')) as CharacterConfig;
    } catch {
      return null;
    }
  }

  private generateTemplateEvent(
    characterName: string,
    config: CharacterConfig,
  ): LifeEvent | null {
    let pool = filterByPersonality(EVENT_TEMPLATES, config);

    // Filter by time of day for relevance
    if (isMorning()) {
      pool = pool.filter(
        e => !e.text.includes('加班到') && !e.text.includes('晚上的'),
      );
    }

    // Filter out crisis templates for normal ticks
    pool = pool.filter(e => !e.tags.includes('crisis'));

    if (pool.length === 0) return null;

    const chosen = choose(pool);
    const description = substitute(chosen.text, config);

    logger.info(`[life-engine] ${characterName}: ${description.slice(0, 80)}`);

    return appendEvent(characterName, description, chosen.category, chosen.padDelta, {
      importance: chosen.importance,
      tags: chosen.tags,
    });
  }

  private generateCrisisEvent(
    characterName: string,
    config: CharacterConfig,
  ): LifeEvent {
    const crisisTemplates = EVENT_TEMPLATES.filter(e => e.tags.includes('crisis'));
    const chosen = choose(crisisTemplates);
    const description = substitute(chosen.text, config);

    logger.warn(`[life-engine] ${characterName} CRISIS: ${description.slice(0, 80)}`);

    return appendEvent(characterName, description, chosen.category, chosen.padDelta, {
      type: 'crisis',
      importance: chosen.importance,
      tags: [...chosen.tags, 'crisis'],
    });
  }

  private maybeAdvanceArc(
    characterName: string,
    config: CharacterConfig,
  ): LifeEvent | null {
    const arcs = readStoryArcs(characterName);
    const activeArcs = arcs.filter(a => a.phase !== 'resolution');

    if (activeArcs.length === 0) return null;

    // 50% chance to advance a random active arc
    if (Math.random() > 0.5) return null;

    const arc = choose(activeArcs);
    const nextPhase = this.nextPhase(arc.phase);
    if (!nextPhase) return null;

    // Generate event text based on phase transition
    const descriptions: Record<StoryArcPhase, string[]> = {
      setup: [
        `关于「${arc.title}」——开始了。{pronoun}决定接受这个挑战。`,
        `「${arc.title}」这件事正式开始了。{pronoun}心里既有期待也有不安。`,
      ],
      rising: [
        `「${arc.title}」有了新的进展。{pronoun}感觉事情在往好的方向发展。`,
        `关于「${arc.title}」，今天有了突破。{pronoun}觉得之前的努力没有白费。`,
      ],
      crisis: [
        `「${arc.title}」遇到了瓶颈。{pronoun}现在有点不知道该怎么办。`,
        `关于「${arc.title}」，事情突然变得复杂起来。{pronoun}需要冷静一下。`,
      ],
      resolution: [
        `「${arc.title}」终于有了结果。{pronoun}感到如释重负。`,
        `关于「${arc.title}」——结束了。{pronoun}学到了很多。`,
      ],
    };

    const desc = substitute(choose(descriptions[nextPhase]), config);
    const importance = nextPhase === 'crisis' || nextPhase === 'resolution' ? 0.7 : 0.5;

    // Update arc
    updateArcPhase(arc.id, nextPhase, characterName);

    const event = appendEvent(characterName, desc, 'work', {
      pleasure: nextPhase === 'resolution' ? 0.3 : nextPhase === 'crisis' ? -0.25 : 0.1,
      arousal: nextPhase === 'crisis' ? 0.35 : 0.15,
      dominance: nextPhase === 'resolution' ? 0.25 : nextPhase === 'crisis' ? -0.2 : 0.05,
    }, { importance, tags: ['story-arc', nextPhase] });

    return event;
  }

  private maybeStartNewArc(
    characterName: string,
    config: CharacterConfig,
  ): LifeEvent | null {
    const arcs = readStoryArcs(characterName);
    const activeCount = arcs.filter(a => a.phase !== 'resolution').length;

    // Don't start new arcs if too many are active
    if (activeCount >= 2) return null;

    const arcTitles = [
      '新项目挑战',
      '生活的转折',
      '一个重要的决定',
      '新的开始',
    ];
    const title = choose(arcTitles);
    const now = new Date().toISOString();

    const newArc: StoryArc = {
      id: `arc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      title,
      phase: 'setup',
      startedAt: now,
      events: [],
      expectedResolution: '',
      userInfluenced: false,
    };

    arcs.push(newArc);
    writeStoryArcs(characterName, arcs);

    const desc = substitute(
      `{pronoun}的「${title}」开始了。这可能是一段值得记住的经历。`,
      config,
    );

    const event = appendEvent(characterName, desc, 'work', {
      pleasure: 0.1, arousal: 0.2, dominance: 0.1,
    }, { importance: 0.5, tags: ['story-arc', 'setup'] });

    newArc.events.push(event.id);
    writeStoryArcs(characterName, arcs);

    return event;
  }

  private nextPhase(current: StoryArcPhase): StoryArcPhase | null {
    const order: StoryArcPhase[] = ['setup', 'rising', 'crisis', 'resolution'];
    const idx = order.indexOf(current);
    if (idx < 0 || idx >= order.length - 1) return null;
    return order[idx + 1];
  }
}

/** Singleton */
let _engine: LifeEngine | null = null;

export function lifeEngine(): LifeEngine {
  if (!_engine) _engine = new LifeEngine();
  return _engine;
}
