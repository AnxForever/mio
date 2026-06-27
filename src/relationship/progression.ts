/**
 * Mio — 关系进展逻辑
 * 读写 relationship-state.json，管理阶段晋升阈值
 */

import { readFileSync, existsSync } from 'node:fs';
import { logger } from '../utils/logger.js';
import type { RelationshipState, RelationshipStage } from '../types.js';
import { relationshipStatePath } from '../memory/paths.js';
import { writeFileSyncSafe } from '../memory/bank.js';

/**
 * 阶段晋升阈值。
 * interactions: 最低交互次数
 * depth: 最低情感深度
 * next: 晋升后的下一阶段（null 表示已满级）
 */
interface StageThreshold {
  interactions: number;
  depth: number;
  next: RelationshipStage | null;
}

const STAGE_THRESHOLDS: Record<RelationshipStage, StageThreshold> = {
  acquaintance: { interactions: 50, depth: 10, next: 'familiar' },
  familiar: { interactions: 150, depth: 40, next: 'ambiguous' },
  ambiguous: { interactions: 300, depth: 80, next: 'intimate' },
  intimate: { interactions: Number.POSITIVE_INFINITY, depth: Number.POSITIVE_INFINITY, next: null },
};

/**
 * 返回初始关系状态。
 * stage: acquaintance, interactionCount: 0, emotionalDepth: 0
 */
export function defaultRelationshipState(): RelationshipState {
  return {
    stage: 'acquaintance',
    stageChangedAt: new Date().toISOString(),
    interactionCount: 0,
    emotionalDepth: 0,
    sharedMemories: [],
    nicknames: {
      userCallsAgent: null,
      agentCallsUser: null,
    },
  };
}

/**
 * 从 relationship-state.json 读取关系状态。
 * 文件不存在或解析失败时返回默认状态。
 */
export function readRelationshipState(): RelationshipState {
  const path = relationshipStatePath();
  try {
    if (!existsSync(path)) return defaultRelationshipState();
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<RelationshipState>;
    // 与默认值合并，确保所有字段存在
    const defaults = defaultRelationshipState();
    return {
      ...defaults,
      ...parsed,
      nicknames: { ...defaults.nicknames, ...(parsed.nicknames ?? {}) },
    };
  } catch {
    return defaultRelationshipState();
  }
}

/**
 * 将关系状态写入 relationship-state.json（自动建目录）。
 */
export function writeRelationshipState(state: RelationshipState): void {
  const path = relationshipStatePath();
  writeFileSyncSafe(path, JSON.stringify(state, null, 2));
}

/**
 * 累加 interactionCount 并持久化。
 */
export function recordInteraction(): void {
  const state = readRelationshipState();
  writeRelationshipState({
    ...state,
    interactionCount: state.interactionCount + 1,
  });
}

/**
 * 调整 emotionalDepth（可正可负，不低于 0）并持久化。
 */
export function recordEmotionalDepth(delta: number): void {
  const state = readRelationshipState();
  writeRelationshipState({
    ...state,
    emotionalDepth: Math.max(0, state.emotionalDepth + delta),
  });
}

/**
 * 添加共享记忆到 sharedMemories（去重）并持久化。
 */
export function recordSharedMemory(title: string): void {
  const state = readRelationshipState();
  if (state.sharedMemories.includes(title)) return;
  writeRelationshipState({
    ...state,
    sharedMemories: [...state.sharedMemories, title],
  });
}

/**
 * 更新昵称配置并持久化。
 */
export function setNicknames(userCalls: string | null, agentCalls: string | null): void {
  const state = readRelationshipState();
  writeRelationshipState({
    ...state,
    nicknames: {
      userCallsAgent: userCalls,
      agentCallsUser: agentCalls,
    },
  });
}

/**
 * 检查是否应该晋升阶段。
 *
 * 阈值：
 * - acquaintance → familiar:   50+ 交互, 10+ 情感深度
 * - familiar → ambiguous:      150+ 交互, 40+ 情感深度
 * - ambiguous → intimate:      300+ 交互, 80+ 情感深度
 *
 * 返回 true 表示阶段已晋升（自动更新 stageChangedAt）。
 */
export function checkProgression(): boolean {
  const state = readRelationshipState();
  const threshold = STAGE_THRESHOLDS[state.stage];

  if (!threshold.next) return false; // 已满级

  if (state.interactionCount >= threshold.interactions && state.emotionalDepth >= threshold.depth) {
    const previousStage = state.stage;
    writeRelationshipState({
      ...state,
      stage: threshold.next,
      stageChangedAt: new Date().toISOString(),
    });
    logger.info(`[relationship] stage advanced: ${previousStage} → ${threshold.next}`);
    return true;
  }

  return false;
}

/**
 * 返回当前进展信息：当前阶段、下一阶段、距晋升还差多少交互/深度。
 */
export function getProgressInfo(): {
  currentStage: RelationshipStage;
  nextStage: RelationshipStage | null;
  interactionsToNext: number;
  depthToNext: number;
} {
  const state = readRelationshipState();
  const threshold = STAGE_THRESHOLDS[state.stage];

  return {
    currentStage: state.stage,
    nextStage: threshold.next,
    interactionsToNext: Math.max(0, threshold.interactions - state.interactionCount),
    depthToNext: Math.max(0, threshold.depth - state.emotionalDepth),
  };
}
