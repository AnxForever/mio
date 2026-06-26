/**
 * Type definitions for @mio/emotion.
 * Mirrors the relevant subset of src/types.ts.
 */

// ─── Core emotion ───
export interface EmotionState {
  myMood: string;
  userMood: string;
  affection: number;
  energy: 'low' | 'medium' | 'high';
  recentTopics: string[];
}

export type Gender = 'boyfriend' | 'girlfriend';

export interface RelationshipState {
  stage: string;
  interactionCount: number;
  emotionalDepth: number;
}

export interface SessionContext {
  sessionId: string;
  model: string;
  apiKey: string | undefined;
  gender: Gender;
  emotionState: EmotionState;
  relationshipState: RelationshipState;
  activeMod: string;
  colaDir: string;
}

// ─── PAD ───
export interface PADState {
  pleasure: number;
  arousal: number;
  dominance: number;
  updatedAt: string;
}

export interface PADConfig {
  decayRate: number;
  pleasureBaseline: number;
  arousalBaseline: number;
  dominanceBaseline: number;
}

// ─── OCEAN ───
export interface OCEANTraits {
  openness: number;
  conscientiousness: number;
  extraversion: number;
  agreeableness: number;
  neuroticism: number;
}

// ─── Affinity ───
export interface AffinityState {
  warmth: number;
  trust: number;
  intimacy: number;
  patience: number;
  tension: number;
  updatedAt: string;
}

// ─── Multi-Axis ───
export interface MultiAxisState {
  closeness: number;
  trust: number;
  neediness: number;
  updatedAt: string;
}

export type AttachmentStyle = 'secure' | 'anxious' | 'avoidant' | 'balanced';

export interface FrustrationState {
  frustrationStreak: number;
  rejectionCount: number;
  attachmentLevel: AttachmentStyle;
  lastWarmAt: string | null;
}

// ─── Intent ───
export interface IntentResult {
  label: string;
  category: string;
  confidence: number;
}

// ─── Signals ───
export interface ResponseSignals {
  emotionalTone?: string;
  warmth?: number;
  energy?: number;
  formality?: number;
}

// Re-export IntentLabel for convenience
export type { IntentLabel } from './classifier.js';
