/**
 * Mio — Character System Types
 *
 * Structured character definition, life events, memory stream, story arcs.
 * Based on the Generative Agent architecture (Smallville / arXiv:2304.03442).
 */

// ─── Character Definition ───

export interface CharacterSource {
  /** Content origin. Built-in samples are not production-quality cards. */
  type: 'sample' | 'custom' | 'imported';
  /** Human-readable source label */
  label: string;
  /** Review state for product trust */
  quality: 'draft' | 'reviewed' | 'unknown';
  /** Optional note shown in management UI */
  note?: string;
  /** Optional source URL for imported/public cards */
  url?: string;
}

export interface LifeTrajectoryEvent {
  /** Life period label, e.g. "childhood", "university", "now" */
  period: string;
  /** Optional age range for the period */
  ageRange?: string;
  /** What happened during this period */
  event: string;
  /** How this period shaped the character */
  impact: string;
}

export interface CharacterConfig {
  /** Character display name */
  name: string;
  /** Gender label (free text, not enum) */
  gender: string;
  /** Age in years */
  age: number;
  /** Occupation / role */
  occupation: string;
  /** Brief style descriptor for generation */
  style: string;
  /** Initial OCEAN personality values (0-1) */
  personality: {
    openness: number;
    conscientiousness: number;
    extraversion: number;
    agreeableness: number;
    neuroticism: number;
  };
  /** Character trait tags */
  traits: string[];
  /** Natural-language speaking style description */
  speakingStyle: string;
  /** User-written backstory (1-3 paragraphs) */
  backstory: string;
  /** Stage-by-stage life trajectory */
  lifeTrajectory?: LifeTrajectoryEvent[];
  /** Current daily life, unresolved pressure, routines */
  currentLife?: string;
  /** How this person approaches intimacy, trust, conflict, and boundaries */
  relationshipProfile?: string;
  /** Starting situation for a new chat */
  scenario?: string;
  /** First message shown in a fresh chat; style anchor */
  firstMessage?: string;
  /** Alternative first messages for different entry points */
  alternateGreetings?: string[];
  /** Example dialogues that demonstrate voice and behavior */
  exampleDialogues?: string[];
  /** Human-facing creator notes, not prompt-critical */
  creatorNotes?: string;
  /** Version string for content review */
  characterVersion?: string;
  /** Frontend tags for filtering */
  tags?: string[];
  /** Life goals / aspirations */
  lifeGoals: string[];
  /** Interests and hobbies */
  interests: string[];
  /** Value system */
  values: string[];
  /** Quirks, verbal tics, habits */
  quirks: string[];
  /** ISO timestamp of creation */
  createdAt: string;
  /** Origin and quality metadata */
  source?: CharacterSource;
}

export interface CharacterDef {
  /** Unique character id (derived from name, slugified) */
  id: string;
  /** Structured config */
  config: CharacterConfig;
  /** Whether this character is currently active */
  active: boolean;
  /** Whether this is a user-created character (vs built-in male/female) */
  isCustom: boolean;
}

// ─── Life Events ───

export type LifeEventCategory =
  | 'work'
  | 'social'
  | 'domestic'
  | 'health'
  | 'creative'
  | 'random';

export type LifeEventType =
  | 'life_event'       // autonomous daily event
  | 'user_interaction' // significant user message / comfort
  | 'reflection'       // higher-level insight from consolidation
  | 'crisis';          // major life event

export interface EmotionalImpact {
  /** PAD pleasure delta (-1 to 1) */
  pleasure: number;
  /** PAD arousal delta (-1 to 1) */
  arousal: number;
  /** PAD dominance delta (-1 to 1) */
  dominance: number;
}

export interface LifeEvent {
  /** Unique event id */
  id: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Event type */
  type: LifeEventType;
  /** Event category */
  category: LifeEventCategory;
  /** Natural-language event description */
  description: string;
  /** PAD emotional impact */
  emotionalImpact: EmotionalImpact;
  /** Importance score (0-1), determines reflection eligibility */
  importance: number;
  /** Tags for retrieval */
  tags: string[];
  /** Whether the user has seen/reacted to this event */
  acknowledged: boolean;
}

// ─── Story Arcs ───

export type StoryArcPhase = 'setup' | 'rising' | 'crisis' | 'resolution';

export interface StoryArc {
  /** Unique arc id */
  id: string;
  /** Display title */
  title: string;
  /** Current phase */
  phase: StoryArcPhase;
  /** ISO timestamp when arc started */
  startedAt: string;
  /** IDs of events linked to this arc */
  events: string[];
  /** Possible resolution directions */
  expectedResolution: string;
  /** Whether user interaction influenced this arc */
  userInfluenced: boolean;
}

// ─── Memory Stream ───

export interface MemoryStreamEntry extends LifeEvent {
  /** Serialized embedding vector (number[] for dense, Record<string,number> for sparse) */
  embedding?: number[] | Record<string, number>;
}

export interface MemoryRetrievalResult {
  /** The matched event */
  entry: MemoryStreamEntry;
  /** Combined retrieval score */
  score: number;
  /** Individual dimension scores */
  dimensions: {
    recency: number;
    importance: number;
    relevance: number;
  };
}

// ─── Reflection Memory ───

export interface ReflectionMemory {
  /** Unique reflection id */
  id: string;
  /** ISO timestamp */
  timestamp: string;
  /** The synthesized insight */
  insight: string;
  /** IDs of source events that triggered this reflection */
  sourceEvents: string[];
  /** Importance (always high for reflections) */
  importance: number;
}

// ─── Life Journal ───

export interface LifeJournal {
  /** Character id */
  characterId: string;
  /** Recent events (last N) */
  entries: LifeEvent[];
  /** Active story arcs */
  activeArcs: StoryArc[];
  /** Character's current emotional summary (derived from PAD) */
  currentMood: {
    happiness: number;
    energy: number;
    stress: number;
  };
  /** ISO timestamp of last update */
  lastUpdated: string;
}

// ─── Event Templates ───

export interface EventTemplate {
  /** Template text with {placeholders} for substitution */
  text: string;
  /** Event category */
  category: LifeEventCategory;
  /** PAD emotional impact of this event */
  padDelta: EmotionalImpact;
  /** Importance score (0-1) */
  importance: number;
  /** Tags for filtering and retrieval */
  tags: string[];
}
