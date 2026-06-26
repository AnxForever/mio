/**
 * Mio — Conversation Analytics API
 *
 * READ-ONLY endpoints that expose relationship insights: conversation stats,
 * emotion trends, topic heatmaps, relationship timelines, and ritual data.
 *
 * All functions handle missing/empty data gracefully — first-run safe.
 *
 * Data sources:
 *   - transcripts/*.jsonl          sessions
 *   - emotion-history.jsonl        mood timeline
 *   - emotion-state.json           current affection
 *   - structured-memory.json       topic segments
 *   - relationship-state.json      stage / milestones
 *   - ritual-state.json            active rituals
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { readFileSyncSafe } from '../memory/bank.js';
import { transcriptsDir, emotionStatePath } from '../memory/paths.js';
import { readEmotionState } from '../emotion/state.js';
import { readRelationshipState } from '../relationship/progression.js';
import { readRitualState } from '../emotion/ritual.js';
import { readStructuredMemoryFromDisk } from '../memory/structured-memory.js';
import type { RelationshipStage } from '../types.js';
import { getStageConfig } from '../relationship/stages.js';
import { getProgressInfo } from '../relationship/progression.js';
import { getActiveRituals as getActiveRitualsFromEngine } from '../emotion/ritual.js';
import type { Ritual } from '../emotion/ritual.js';
import type { StructuredMemory } from '../memory/structured-memory.js';

// ─── Types ───

export interface ConversationStats {
  totalSessions: number;
  totalMessages: number;
  totalTurns: number;
  firstInteraction: string;
  lastInteraction: string;
  daysActive: number;
  avgMessagesPerDay: number;
}

export interface EmotionTrendPoint {
  date: string;
  myMood: string;
  userMood: string;
  affection: number;
}

export interface EmotionTrend {
  timeline: EmotionTrendPoint[];
  dominantMoods: { mood: string; count: number }[];
  affectionCurve: { date: string; value: number }[];
}

export interface TopicHeatmap {
  topics: { name: string; count: number; lastDiscussed: string }[];
  topTopics: string[];
}

export interface RelationshipTimeline {
  stageChanges: { date: string; from: string; to: string }[];
  milestones: { date: string; description: string }[];
  currentStage: string;
  progress: number;
}

export interface AnalyticsSnapshot {
  conversation: ConversationStats;
  emotion: EmotionTrend;
  topics: TopicHeatmap;
  relationship: RelationshipTimeline;
  rituals: { name: string; type: string; count: number }[];
  generatedAt: string;
}

// ─── Helpers ───

const STAGE_LABELS: Record<string, string> = {
  acquaintance: '初识',
  familiar: '熟悉',
  ambiguous: '暧昧',
  intimate: '亲密',
};

const STAGE_ORDER: RelationshipStage[] = ['acquaintance', 'familiar', 'ambiguous', 'intimate'];

/**
 * Progress from current stage toward the next, as 0–100.
 * 100 = ready to advance (or already at max).
 */
function computeProgress(stage: RelationshipStage, interactions: number, depth: number): number {
  if (stage === 'intimate') return 100;
  const info = getProgressInfo();
  const needInteractions = info.interactionsToNext + (stage === 'acquaintance' ? 0 : interactions);
  const needDepth = info.depthToNext + depth;

  const totalInteractions = needInteractions || 1;
  const totalDepth = needDepth || 1;

  const interactionRatio = stage === 'acquaintance'
    ? interactions / totalInteractions
    : interactions / totalInteractions;
  const depthRatio = depth / totalDepth;

  // Weight: interactions 60%, depth 40%
  return Math.min(100, Math.round((interactionRatio * 60 + depthRatio * 40) * 100));
}

// ─── Emotion history helpers ───

interface EmotionHistoryEntry {
  timestamp: string;
  myMood: string;
  userMood: string;
  affection: number;
}

/**
 * Path to emotion-history.jsonl (trailing history, not the live state).
 */
function emotionHistoryPath(): string {
  return emotionStatePath().replace('emotion-state.json', 'emotion-history.jsonl');
}

/**
 * Read emotion history entries, newest-first, capped to `limit`.
 */
function readEmotionHistory(limit?: number): EmotionHistoryEntry[] {
  const path = emotionHistoryPath();
  if (!existsSync(path)) return [];

  try {
    const raw = readFileSync(path, 'utf-8');
    const lines = raw.split('\n').filter((l) => l.trim().length > 0);
    const entries: EmotionHistoryEntry[] = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.timestamp && parsed.affection !== undefined) {
          entries.push({
            timestamp: parsed.timestamp,
            myMood: parsed.myMood ?? '平静',
            userMood: parsed.userMood ?? '未知',
            affection: parsed.affection,
          });
        }
      } catch {
        // skip malformed lines
      }
    }
    entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    if (limit && entries.length > limit) {
      return entries.slice(-limit);
    }
    return entries;
  } catch {
    return [];
  }
}

// ─── Core Analytics Functions ───

/**
 * Scan transcript directory, counting sessions, messages, and turns.
 *
 * Efficient: reads each JSONL file line-by-line via readFileSync, but only
 * counts — does not parse every line into structured objects.
 */
export function getConversationStats(): ConversationStats {
  const dir = transcriptsDir();
  const sessions: string[] = [];
  if (existsSync(dir)) {
    try {
      for (const f of readdirSync(dir)) {
        if (f.endsWith('.jsonl')) sessions.push(f.replace(/\.jsonl$/, ''));
      }
    } catch {
      // permission error or similar — treat as empty
    }
  }

  let totalMessages = 0;
  let totalTurns = 0;
  let firstInteraction = '';
  let lastInteraction = '';

  for (const sessionId of sessions) {
    const path = `${dir}/${sessionId}.jsonl`;
    try {
      const raw = readFileSync(path, 'utf-8');
      const lines = raw.split('\n').filter((l) => l.trim().length > 0);

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry.timestamp) {
            // Track earliest / latest timestamps
            if (!firstInteraction || entry.timestamp < firstInteraction) {
              firstInteraction = entry.timestamp;
            }
            if (!lastInteraction || entry.timestamp > lastInteraction) {
              lastInteraction = entry.timestamp;
            }
          }
          if (entry.type === 'message') {
            totalMessages++;
          } else if (entry.type === 'session_end') {
            totalTurns++;
          }
        } catch {
          // skip malformed line
        }
      }
    } catch {
      // skip unreadable files
    }
  }

  // Calculate days active
  let daysActive = 0;
  let avgMessagesPerDay = 0;
  if (firstInteraction && lastInteraction) {
    const diffMs = new Date(lastInteraction).getTime() - new Date(firstInteraction).getTime();
    daysActive = Math.max(1, Math.ceil(diffMs / 86400000));
    avgMessagesPerDay = daysActive > 0 ? parseFloat((totalMessages / daysActive).toFixed(1)) : 0;
  } else {
    daysActive = 0;
  }

  return {
    totalSessions: sessions.length,
    totalMessages,
    totalTurns,
    firstInteraction,
    lastInteraction,
    daysActive,
    avgMessagesPerDay,
  };
}

/**
 * Build emotion trend timeline from emotion-history.jsonl.
 *
 * @param days  Number of days of history to include (default 30, 0 = all).
 */
export function getEmotionTrends(days: number = 30): EmotionTrend {
  const history = readEmotionHistory(days > 0 ? undefined : undefined);

  // If days > 0, filter by cutoff
  let filtered = history;
  if (days > 0) {
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    filtered = history.filter((e) => e.timestamp >= cutoff);
  }

  // Build timeline (one point per unique timestamp, use the last state per date)
  const dateMap = new Map<string, EmotionTrendPoint>();
  for (const entry of filtered) {
    const dateKey = entry.timestamp.slice(0, 10); // YYYY-MM-DD
    dateMap.set(dateKey, {
      date: dateKey,
      myMood: entry.myMood,
      userMood: entry.userMood,
      affection: entry.affection,
    });
  }

  const timeline = Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  // Dominant moods
  const moodCount = new Map<string, number>();
  for (const entry of filtered) {
    const mood = entry.myMood || '平静';
    moodCount.set(mood, (moodCount.get(mood) ?? 0) + 1);
  }
  const dominantMoods = Array.from(moodCount.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([mood, count]) => ({ mood, count }));

  // Affection curve (daily average)
  const dailyAffection = new Map<string, { total: number; count: number }>();
  for (const entry of filtered) {
    const dateKey = entry.timestamp.slice(0, 10);
    const existing = dailyAffection.get(dateKey) ?? { total: 0, count: 0 };
    existing.total += entry.affection;
    existing.count += 1;
    dailyAffection.set(dateKey, existing);
  }
  const affectionCurve = Array.from(dailyAffection.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, { total, count }]) => ({
      date,
      value: Math.round(total / count),
    }));

  return {
    timeline,
    dominantMoods,
    affectionCurve,
  };
}

/**
 * Build topic heatmap from structured-memory.json topic segments.
 */
export function getTopicHeatmap(): TopicHeatmap {
  const memory = readStructuredMemoryFromDisk();
  if (!memory || !memory.topics || memory.topics.length === 0) {
    return { topics: [], topTopics: [] };
  }

  const topics = memory.topics.map((segment) => ({
    name: segment.topic,
    count: segment.entities.length,
    lastDiscussed: segment.dateRange.end,
  }));

  topics.sort((a, b) => b.count - a.count);

  const topTopics = topics.slice(0, 5).map((t) => t.name);

  return { topics, topTopics };
}

/**
 * Build relationship timeline from relationship-state.json and shared memories.
 */
export function getRelationshipTimeline(): RelationshipTimeline {
  const state = readRelationshipState();
  const stageChanges: { date: string; from: string; to: string }[] = [];

  // Infer stage changes: the only recorded change is the current stageChangedAt.
  // Previous stages had no history record, so we reconstruct from the current state.
  // If the stage is not acquaintance, we hypothesize the previous change point.
  const currentIdx = STAGE_ORDER.indexOf(state.stage);
  if (currentIdx > 0) {
    const prevStage = STAGE_ORDER[currentIdx - 1];
    stageChanges.push({
      date: state.stageChangedAt,
      from: STAGE_LABELS[prevStage] ?? prevStage,
      to: STAGE_LABELS[state.stage] ?? state.stage,
    });
  }

  // Convert shared memories to milestones
  const milestones: { date: string; description: string }[] = [];
  // sharedMemories is a string array (titles only); we treat them as milestones
  // without individual timestamps since the data model doesn't store dates per memory.
  // Use the stageChangedAt as a rough anchor if available.
  for (const memory of state.sharedMemories) {
    milestones.push({
      date: state.stageChangedAt,
      description: memory,
    });
  }

  const progress = computeProgress(state.stage, state.interactionCount, state.emotionalDepth);

  return {
    stageChanges,
    milestones,
    currentStage: STAGE_LABELS[state.stage] ?? state.stage,
    progress,
  };
}

/**
 * Return active rituals with their types and observation counts.
 */
export function getActiveRituals(): { name: string; type: string; count: number }[] {
  const rituals = getActiveRitualsFromEngine();
  return rituals.map((r: Ritual) => ({
    name: r.pattern,
    type: r.type,
    count: r.frequency,
  }));
}

/**
 * Aggregate all analytics into a single snapshot.
 */
export function getAnalyticsSnapshot(): AnalyticsSnapshot {
  return {
    conversation: getConversationStats(),
    emotion: getEmotionTrends(30),
    topics: getTopicHeatmap(),
    relationship: getRelationshipTimeline(),
    rituals: getActiveRituals(),
    generatedAt: new Date().toISOString(),
  };
}
