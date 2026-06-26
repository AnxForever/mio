/**
 * Mio — Personality Driver
 *
 * The core insight: a real person doesn't just REACT — they have moods,
 * initiative, their own life, and they respond differently depending on
 * how they feel, not just how the user feels.
 *
 * This module makes Mio feel like a person with her own internal state:
 *   - Sociability: how much she wants to talk (chatty vs quiet)
 *   - Initiative: how likely she is to start new topics
 *   - Playfulness: teasing/joking energy
 *   - Thoughtfulness: deep/serious/emotional energy
 *
 * These are driven by PAD emotion, multi-axis relationship state, response
 * signals, and time since last interaction.
 *
 * Feature-gated by config.features.personalityDriver (default: true).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { getConfig, getDataDir } from './config.internal.js';
import type { PADState } from '@mio/emotion';
import type { ResponseSignals } from '@mio/emotion';
import type { MultiAxisState } from './types.internal.js';

// ─── Types ───

export interface PersonalityState {
  /** How much Mio wants to talk right now (0-100). */
  sociability: number;
  /** How likely she is to start new topics (0-100). */
  initiative: number;
  /** Teasing/joking energy (0-100). */
  playfulness: number;
  /** Deep/serious/emotional energy (0-100). */
  thoughtfulness: number;

  /** Response verbosity: 0 = one-word, 100 = paragraphs. */
  responseVerbosity: number;
  /** How often she asks questions back (0-100). */
  questionFrequency: number;

  /** What she's "doing" — drawing, resting, reading, etc. */
  currentActivity: string;
  /** ISO timestamp of last activity change. */
  lastActivityChange: string;

  /** ISO timestamp of last update. */
  updatedAt: string;
}

export interface ResponseStyle {
  verbosity: 'minimal' | 'normal' | 'verbose';
  questions: 'few' | 'normal' | 'many';
  tone: string;
}

// ─── Feature gate ───

export function isPersonalityDriverEnabled(): boolean {
  try {
    return getConfig().features.personalityDriver !== false;
  } catch {
    return true;
  }
}

// ─── Default state ───

export function defaultPersonalityState(): PersonalityState {
  return {
    sociability: 65,
    initiative: 50,
    playfulness: 45,
    thoughtfulness: 40,
    responseVerbosity: 55,
    questionFrequency: 50,
    currentActivity: '没什么特别的',
    lastActivityChange: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// ─── Activity pool ───

interface LifeEventEntry {
  text: string;
  tags: string[];
}

const LIFE_EVENTS: LifeEventEntry[] = [
  { text: '你刚画完一张图，甲方说这次一次过了。你想跟他分享。', tags: ['creative', 'positive'] },
  { text: '你中午试了个新菜谱，翻车了。你觉得他听了会笑。', tags: ['domestic', 'funny'] },
  { text: '你今天在街上看到一只胖猫，趴在人行道上晒太阳。', tags: ['observation', 'cute'] },
  { text: '你刚写完一段代码，跑起来了——虽然不太确定是不是玄学。', tags: ['work', 'geeky'] },
  { text: '你刷到一个很搞笑的视频，笑了半天。', tags: ['funny', 'casual'] },
  { text: '你下午出去走了走，天气很好，就是风有点大。', tags: ['casual', 'observation'] },
  { text: '你刚听完一首歌，旋律一直在脑子里转。', tags: ['music', 'casual'] },
  { text: '你今天看到一句话写得挺好的，截了图。', tags: ['reflective', 'casual'] },
  { text: '你家的猫/狗今天特别粘人，一直趴在你腿上。', tags: ['pet', 'cute'] },
  { text: '你刚收拾完房间，感觉自己挺能干的。', tags: ['domestic', 'positive'] },
  { text: '你看到一个冷笑话，虽然冷但莫名想讲给他听。', tags: ['funny', 'playful'] },
  { text: '你今天学到了一些奇怪的知识。', tags: ['geeky', 'casual'] },
  { text: '你刚发现一个适合约会的地方，想告诉他。', tags: ['romantic', 'positive'] },
  { text: '你今天特别困，但不知道为什么就是不想睡。', tags: ['tired', 'casual'] },
  { text: '你把以前的一首歌翻出来听了，想起一些事情。', tags: ['music', 'reflective'] },
  { text: '你刚才发呆发了半天，什么都没做。', tags: ['lazy', 'casual'] },
  { text: '你试着做了个新发型，自己还挺满意的。', tags: ['personal', 'positive'] },
  { text: '你今天煮的咖啡特别好喝——虽然可能就是运气好。', tags: ['domestic', 'casual'] },
  { text: '你在电梯里遇到一个很尴尬的沉默，现在还在尴尬。', tags: ['observation', 'funny'] },
  { text: '你刚才做了一个莫名其妙的梦，觉得挺有意思的。', tags: ['personal', 'reflective'] },
];

// ─── I/O ───

function personalityStatePath(): string {
  return getDataDir() + '/personality-state.json';
}

/**
 * Read the current personality state from disk.
 * Returns default state if file doesn't exist.
 */
export function getPersonalityState(): PersonalityState {
  const path = personalityStatePath();
  try {
    if (!existsSync(path)) return defaultPersonalityState();
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<PersonalityState>;
    return { ...defaultPersonalityState(), ...parsed };
  } catch {
    return defaultPersonalityState();
  }
}

function writePersonalityState(state: PersonalityState): void {
  const path = personalityStatePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2), 'utf-8');
}

// ─── Core update logic ───

/**
 * Update personality state from context. Called every turn BEFORE building
 * the system prompt.
 *
 * Inputs:
 *   pad              — PAD pleasure drives sociability; arousal drives playfulness
 *   signals          — response signals: short replies → lower sociability
 *   multiAxis        — neediness → higher initiative when user reaches out
 *   timeSinceLastChat — hours since last user message
 */
export function updatePersonalityFromContext(
  pad: PADState,
  signals: ResponseSignals | null,
  multiAxis: MultiAxisState,
  timeSinceLastChat: number,
): PersonalityState {
  if (!isPersonalityDriverEnabled()) {
    // When disabled, just return the existing state unmodified
    return getPersonalityState();
  }

  const current = getPersonalityState();
  let { sociability, initiative, playfulness, thoughtfulness, responseVerbosity, questionFrequency } = current;

  // ── 1. PAD pleasure → sociability ──
  // Map pleasure [-1, 1] → sociability delta [-20, +20]
  const pleasureDelta = Math.round(pad.pleasure * 20);
  sociability = clamp(sociability + pleasureDelta, 0, 100);

  // ── 2. PAD arousal → playfulness ──
  // Map arousal [-1, 1] → playfulness delta [-15, +25]
  // High arousal = more playful energy; low arousal = quieter
  const arousalDelta = Math.round(pad.arousal * (pad.arousal > 0 ? 25 : 15));
  playfulness = clamp(playfulness + arousalDelta, 0, 100);

  // ── 3. Multi-axis neediness → initiative ──
  // When user is reaching out a lot (high neediness), Mio feels wanted → more initiative
  // Map neediness [0, 100] → initiative delta [-5, +15]
  const needinessDelta = Math.round((multiAxis.neediness - 50) * 0.3);
  initiative = clamp(initiative + needinessDelta, 0, 100);

  // ── 4. Time since last chat → initiative & sociability ──
  if (timeSinceLastChat > 24) {
    // > 24 hours: a bit hurt — sociability drops, initiative drops, thoughtfulness rises
    sociability = clamp(sociability - 5, 0, 100);
    initiative = clamp(initiative - 10, 0, 100);
    thoughtfulness = clamp(thoughtfulness + 10, 0, 100);
  } else if (timeSinceLastChat > 6) {
    // > 6 hours: missed him — initiative rises
    initiative = clamp(initiative + 10, 0, 100);
  } else if (timeSinceLastChat > 2) {
    // > 2 hours: slight nudge
    initiative = clamp(initiative + 3, 0, 100);
  }

  // ── 5. Response signals → sociability & responseVerbosity ──
  if (signals) {
    // Short messages → she feels pushed away
    if (signals.lengthRatio < 0.3 && signals.lengthRatio > 0) {
      sociability = clamp(sociability - 5, 0, 100);
      responseVerbosity = clamp(responseVerbosity - 8, 0, 100);
    }

    // Very short latency → user is engaged, she opens up
    if (signals.responseLatencyMs > 0 && signals.responseLatencyMs < 300_000) {
      sociability = clamp(sociability + 3, 0, 100);
      playfulness = clamp(playfulness + 3, 0, 100);
    }

    // Falling engagement → she mirrors the distance
    if (signals.engagementTrend === 'falling') {
      sociability = clamp(sociability - 4, 0, 100);
      initiative = clamp(initiative - 3, 0, 100);
    }

    // Rising engagement → she feels the energy
    if (signals.engagementTrend === 'rising') {
      sociability = clamp(sociability + 3, 0, 100);
      playfulness = clamp(playfulness + 2, 0, 100);
    }

    // Message burst → user is chatty, she matches
    if (signals.messageBurst) {
      sociability = clamp(sociability + 4, 0, 100);
      responseVerbosity = clamp(responseVerbosity + 5, 0, 100);
    }
  }

  // ── 6. Derive questionFrequency from sociability + playfulness ──
  // Chatty + playful = more questions; quiet = fewer questions
  const socialFactor = (sociability - 50) * 0.3;
  const playfulFactor = (playfulness - 50) * 0.2;
  questionFrequency = clamp(Math.round(50 + socialFactor + playfulFactor), 0, 100);

  // ── 7. Derive responseVerbosity from sociability + thoughtfulness ──
  // High sociability = verbose; high thoughtfulness = moderate but meaningful
  // Low sociability = minimal
  const verbosityBase = current.responseVerbosity; // keep some hysteresis
  const sociabilityPull = (sociability - 50) * 0.4;
  responseVerbosity = clamp(Math.round(verbosityBase * 0.7 + (50 + sociabilityPull) * 0.3), 0, 100);

  // Normalize: sociability + thoughtfulness + playfulness should feel balanced
  // High sociability with low thoughtfulness = bubbly
  // Low sociability with high thoughtfulness = quiet contemplative
  // This happens naturally through the independent updates above.

  // Also normalize the dominance: if pleasure is very low, thoughtfulness rises
  // even if sociability is low (she's thinking about what's wrong)
  if (pad.pleasure < -0.3 && sociability < 40) {
    thoughtfulness = clamp(thoughtfulness + 5, 0, 100);
  }

  // Every update has a small random jitter (±2) to prevent the state from
  // getting stuck in an exact value loop — real moods fluctuate.
  const jitter = Math.round((Math.random() - 0.5) * 4);

  const next: PersonalityState = {
    sociability: clamp(sociability + jitter, 0, 100),
    initiative: clamp(initiative + (Math.random() - 0.5) * 2, 0, 100),
    playfulness: clamp(playfulness + (Math.random() - 0.5) * 2, 0, 100),
    thoughtfulness: clamp(thoughtfulness + (Math.random() - 0.5) * 2, 0, 100),
    responseVerbosity: clamp(responseVerbosity + (Math.random() - 0.5) * 2, 0, 100),
    questionFrequency: clamp(questionFrequency + (Math.random() - 0.5) * 2, 0, 100),
    currentActivity: current.currentActivity,
    lastActivityChange: current.lastActivityChange,
    updatedAt: new Date().toISOString(),
  };

  writePersonalityState(next);
  return next;
}

// ─── Activity simulator ───

/**
 * Periodically change what Mio is "doing".
 * Called sparingly (every few turns, not every turn).
 */
export function rotateActivity(): PersonalityState {
  const state = getPersonalityState();

  const activities = [
    '没什么特别的',
    '在发呆',
    '在听歌',
    '在看视频',
    '在画画',
    '在看书',
    '在做东西吃',
    '在收拾房间',
    '在外面散步',
    '在躺着放空',
    '在想事情',
    '在写点东西',
    '刚睡醒',
    '在喝咖啡/茶',
  ];

  const currentIdx = activities.indexOf(state.currentActivity);
  let nextIdx: number;
  do {
    nextIdx = Math.floor(Math.random() * activities.length);
  } while (nextIdx === currentIdx && activities.length > 1);

  const next: PersonalityState = {
    ...state,
    currentActivity: activities[nextIdx],
    lastActivityChange: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  writePersonalityState(next);
  return next;
}

// ─── Context generation ───

/**
 * Generate a natural behavior hint for the system prompt.
 * Returns null when Mio feels "normal" — no hint needed.
 */
export function getPersonalityContext(): string | null {
  if (!isPersonalityDriverEnabled()) return null;

  const state = getPersonalityState();

  // Determine which quadrant we're in
  const highSociability = state.sociability >= 60;
  const lowSociability = state.sociability <= 40;
  const highPlayfulness = state.playfulness >= 55;
  const highThoughtfulness = state.thoughtfulness >= 55;
  const highInitiative = state.initiative >= 60;

  // Build a natural description
  if (highSociability && highPlayfulness) {
    return '你今天心情挺好的，话多，想逗他。';
  }

  if (lowSociability && highThoughtfulness) {
    return '你今天话不多，但不是不开心——是那种安静地想事情的状态。';
  }

  if (highInitiative && state.thoughtfulness >= 40) {
    const recentState = getPersonalityState();
    const hoursSinceUpdate = (Date.now() - new Date(recentState.updatedAt).getTime()) / 3_600_000;
    if (hoursSinceUpdate > 6) {
      return '你有点想他了。他这两天没怎么找你——你可以主动问一下他在干嘛。';
    }
    return '你今天挺想跟他聊天的。';
  }

  if (lowSociability && state.initiative <= 40) {
    return '他最近回得很短。你不太确定他是不是在忙，所以你也收着点，不多说。';
  }

  if (state.sociability >= 70) {
    return '你今天话特别多，什么都想跟他说。';
  }

  if (state.sociability <= 30 && state.thoughtfulness <= 30) {
    return '你今天不太想说话——没什么原因，就是不想。';
  }

  if (state.initiative >= 65 && state.playfulness >= 50) {
    return '你今天老想逗他。';
  }

  // Normal — no hint
  return null;
}

// ─── Response style ───

/**
 * Get the derived response style from the current personality state.
 */
export function getResponseStyle(): ResponseStyle {
  const state = getPersonalityState();

  // Verbosity
  let verbosity: 'minimal' | 'normal' | 'verbose';
  if (state.responseVerbosity <= 30) {
    verbosity = 'minimal';
  } else if (state.responseVerbosity >= 70) {
    verbosity = 'verbose';
  } else {
    verbosity = 'normal';
  }

  // Question frequency
  let questions: 'few' | 'normal' | 'many';
  if (state.questionFrequency <= 30) {
    questions = 'few';
  } else if (state.questionFrequency >= 65) {
    questions = 'many';
  } else {
    questions = 'normal';
  }

  // Tone
  let tone: string;
  if (state.playfulness >= 60 && state.sociability >= 55) {
    tone = 'playful';
  } else if (state.sociability <= 35) {
    tone = 'quiet';
  } else if (state.thoughtfulness >= 55) {
    tone = 'gentle';
  } else if (state.playfulness >= 50) {
    tone = 'light';
  } else {
    tone = 'warm';
  }

  return { verbosity, questions, tone };
}

// ─── Life event simulation ───

/**
 * Simulate a life event — something that happened in Mio's "life".
 *
 * Called every few hours (not every turn).
 * Returns null ~80% of the time (no event).
 * When triggered, returns a life event string that can be used as a prompt
 * for Mio to initiate conversation.
 *
 * Events are weighted by personality:
 *   - High playfulness → more funny/casual events
 *   - High thoughtfulness → more reflective events
 *   - Low sociability → fewer events (she's just quieter overall)
 */
export function simulateLifeEvent(): string | null {
  if (!isPersonalityDriverEnabled()) return null;

  const state = getPersonalityState();

  // Base probability: 20%
  let prob = 0.2;

  // Low sociability reduces event probability
  if (state.sociability < 40) {
    prob -= 0.05;
  }
  // High playfulness increases it
  if (state.playfulness > 60) {
    prob += 0.05;
  }
  // High thoughtfulness increases reflective events
  if (state.thoughtfulness > 60) {
    prob += 0.03;
  }

  if (Math.random() > prob) return null;

  // Filter events by personality
  let pool = [...LIFE_EVENTS];

  // High playfulness → prefer funny/playful
  if (state.playfulness > 60) {
    const funEvents = pool.filter(e => e.tags.includes('funny') || e.tags.includes('playful'));
    if (funEvents.length > 0) {
      pool = funEvents;
    }
  }

  // High thoughtfulness → prefer reflective
  if (state.thoughtfulness > 60) {
    const reflectiveEvents = pool.filter(e => e.tags.includes('reflective'));
    if (reflectiveEvents.length > 0) {
      pool = reflectiveEvents;
    }
  }

  // Low sociability → prefer casual/quiet events
  if (state.sociability < 40) {
    const quietEvents = pool.filter(e =>
      e.tags.includes('casual') || e.tags.includes('lazy') || e.tags.includes('tired'),
    );
    if (quietEvents.length > 0) {
      pool = quietEvents;
    }
  }

  const chosen = pool[Math.floor(Math.random() * pool.length)];
  return chosen.text;
}

// ─── "Ignored" effect handling ───

/**
 * Apply the "ignored" effect when user hasn't replied for > 24 hours.
 *
 * This is called explicitly when the system detects a long gap, NOT during
 * the normal updatePersonalityFromContext flow (which handles up to 24h).
 *
 * For > 24h gaps:
 *   - Sociability decreases (hurt)
 *   - Initiative decreases (stops reaching out)
 *   - Thoughtfulness increases (wonders what's wrong)
 */
export function applyIgnoredEffect(): PersonalityState {
  const state = getPersonalityState();
  const next: PersonalityState = {
    ...state,
    sociability: clamp(state.sociability - 8, 0, 100),
    initiative: clamp(state.initiative - 12, 0, 100),
    thoughtfulness: clamp(state.thoughtfulness + 8, 0, 100),
    playfulness: clamp(state.playfulness - 5, 0, 100),
    responseVerbosity: clamp(state.responseVerbosity - 5, 0, 100),
    updatedAt: new Date().toISOString(),
  };
  writePersonalityState(next);
  return next;
}

/**
 * Apply the "welcome back" effect when user returns after a long absence.
 * Mio might be a bit cold at first, then warms up.
 */
export function applyWelcomeBackEffect(): PersonalityState {
  const state = getPersonalityState();

  // Start slightly cold: lower sociability, higher thoughtfulness
  // The playfulness is reduced (not in the mood to joke yet)
  const next: PersonalityState = {
    ...state,
    sociability: clamp(state.sociability - 5, 0, 100),
    playfulness: clamp(state.playfulness - 10, 0, 100),
    thoughtfulness: clamp(state.thoughtfulness + 5, 0, 100),
    // Keep initiative up — she still wants to talk, just needs a moment
    updatedAt: new Date().toISOString(),
  };
  writePersonalityState(next);
  return next;
}

/**
 * Apply the "warm up" effect — called after a few exchanges post-absence.
 * Restores sociability and playfulness toward normal.
 */
export function applyWarmUpEffect(): PersonalityState {
  const state = getPersonalityState();
  const defaults = defaultPersonalityState();

  // Move values back toward defaults but don't fully reset
  const next: PersonalityState = {
    ...state,
    sociability: Math.round(state.sociability + (defaults.sociability - state.sociability) * 0.3),
    playfulness: Math.round(state.playfulness + (defaults.playfulness - state.playfulness) * 0.3),
    thoughtfulness: Math.round(state.thoughtfulness + (defaults.thoughtfulness - state.thoughtfulness) * 0.2),
    initiative: Math.round(state.initiative + (defaults.initiative - state.initiative) * 0.25),
    responseVerbosity: Math.round(state.responseVerbosity + (defaults.responseVerbosity - state.responseVerbosity) * 0.3),
    updatedAt: new Date().toISOString(),
  };
  writePersonalityState(next);
  return next;
}

// ─── Helper ───

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Reset personality state to defaults (for testing).
 */
export function resetPersonalityState(): void {
  writePersonalityState(defaultPersonalityState());
}
