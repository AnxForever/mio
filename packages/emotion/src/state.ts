/**
 * Mio — 情感状态模型
 * 运行时情感状态跟踪：读写 emotion-state.json
 *
 * v2: 集成 PAD (Pleasure-Arousal-Dominance) 情感模型。
 * PAD 是默认情感引擎，同时保持对旧 emotion-state.json 的后向兼容。
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { EmotionState } from './types.internal.js';
import { emotionStatePath } from './paths.internal.js';
import {
  isPADEnabled,
  getPADState,
  writePADState,
  getPersonalityBaseline,
  padToMood,
  type PADState,
} from './pad.js';

/**
 * 返回初始情感状态。
 * myMood 默认平静，userMood 未知，affection 30，energy mid。
 */
export function defaultEmotionState(): EmotionState {
  return {
    myMood: '平静',
    userMood: '未知',
    affection: 30,
    energy: 'mid',
    lastInteraction: new Date().toISOString(),
    unresolvedThread: null,
    recentTopics: [],
  };
}

/**
 * 从 emotion-state.json 读取情感状态。
 * 文件不存在或解析失败时返回默认状态。
 */
export function readEmotionState(): EmotionState {
  const path = emotionStatePath();
  try {
    if (!existsSync(path)) return defaultEmotionState();
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<EmotionState>;
    // 与默认值合并，确保所有字段存在
    return { ...defaultEmotionState(), ...parsed };
  } catch {
    return defaultEmotionState();
  }
}

/**
 * 将情感状态写入 emotion-state.json（自动建目录）。
 */
export function writeEmotionState(state: EmotionState): void {
  const path = emotionStatePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * 将 patch 合并到当前情感状态并持久化。
 * 返回合并后的完整状态。
 */
export function updateEmotionState(patch: Partial<EmotionState>): EmotionState {
  const current = readEmotionState();
  const next: EmotionState = { ...current, ...patch };
  writeEmotionState(next);
  return next;
}

/**
 * 添加话题到 recentTopics，保留最近 5 条（去重）。
 */
export function appendTopic(topic: string): void {
  const state = readEmotionState();
  const topics = [...state.recentTopics];
  if (!topics.includes(topic)) {
    topics.push(topic);
    if (topics.length > 5) topics.shift();
  }
  updateEmotionState({ recentTopics: topics });
}

/**
 * 更新 lastInteraction 时间戳为当前时间。
 */
export function bumpInteraction(): void {
  updateEmotionState({ lastInteraction: new Date().toISOString() });
}

// ─── PAD integration ───

/**
 * Read the current PAD state (with legacy EmotionState fallback).
 *
 * When PAD is enabled, returns the PAD state converted to mood/energy labels
 * alongside the raw PAD values. The legacy EmotionState fields (affection,
 * userMood, etc.) are kept from the existing emotion-state.json.
 *
 * When PAD is disabled, returns only the legacy state.
 */
export function readEmotionStateWithPAD(): EmotionState & { pad?: PADState } {
  const legacy = readEmotionState();

  if (!isPADEnabled()) {
    return legacy;
  }

  try {
    const pad = getPADState();
    const { myMood, energy } = padToMood(pad);
    return {
      ...legacy,
      myMood,
      energy,
      pad,
    };
  } catch {
    return legacy;
  }
}

/**
 * Sync the current PAD values into the emotion-state.json file so that
 * legacy code paths that read EmotionState still get reasonable mood/energy.
 *
 * Call this after every PAD update to keep the two in sync.
 */
export function syncPADToEmotionState(): void {
  if (!isPADEnabled()) return;

  try {
    const pad = getPADState();
    const { myMood, energy } = padToMood(pad);
    const legacy = readEmotionState();
    writeEmotionState({
      ...legacy,
      myMood,
      energy,
    });
  } catch {
    // Best-effort: PAD sync should never crash the caller.
  }
}
