/**
 * Type definitions for @mio/emotion.
 * Mirrors the relevant subset of src/types.ts.
 */

import type { IntentLabel } from './classifier.js';

// ─── Core emotion ───
export interface EmotionState {
  myMood: string;
  userMood: string;
  affection: number;
  energy: 'high' | 'mid' | 'low';
  lastInteraction: string;
  unresolvedThread: string | null;
  recentTopics: string[];
}

export type Gender = 'male' | 'female';

export interface RelationshipState {
  stage: string;
  interactionCount: number;
  emotionalDepth: number;
  stageChangedAt?: string;
  sharedMemories?: string[];
  nicknames?: {
    userCallsAgent: string | null;
    agentCallsUser: string | null;
  };
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
  primary: IntentLabel;
  all: { label: IntentLabel; confidence: number }[];
  tone: 'positive' | 'negative' | 'neutral';
  energy: 'high' | 'mid' | 'low';
  topics: string[];
}

// ─── Signals ───
export interface ResponseSignals {
  responseLatencyMs: number;
  messageBurst: boolean;
  lengthRatio: number;
  sessionGapHours: number;
  engagementTrend: 'rising' | 'steady' | 'falling';
}

export interface TranscriptEntry {
  type?: string;
  role?: 'user' | 'assistant' | 'agent' | 'system';
  content?: string;
  text?: string;
  timestamp?: string;
  time?: string;
}

// Re-export IntentLabel for convenience
export type { IntentLabel } from './classifier.js';
