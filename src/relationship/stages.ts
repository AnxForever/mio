/**
 * Mio — 关系阶段系统
 * 定义四个关系阶段及其解锁的行为与功能
 */

import type { RelationshipStage } from '../types.js';

/**
 * 阶段配置：标签、描述、允许的行为、解锁的功能。
 */
export interface StageConfig {
  /** 中文标签 */
  label: string;
  /** 阶段描述 */
  description: string;
  /** 允许的行为 */
  allowedBehaviors: string[];
  /** 解锁的功能标识 */
  unlockedFeatures: string[];
}

/**
 * STAGE_CONFIG — 四阶段关系配置
 *
 * - acquaintance: 初识 — 真诚礼貌，无主动消息，无亲密表达
 * - familiar:     熟悉 — 可互怼开玩笑，偶尔问候，可使用昵称
 * - ambiguous:    暧昧 — 语气变软，想你消息，偶尔撒娇
 * - intimate:     亲密 — 自然表达爱意，随性主动，撒娇/吃醋/情话
 */
export const STAGE_CONFIG: Record<RelationshipStage, StageConfig> = {
  acquaintance: {
    label: '初识',
    description: '真诚礼貌，保持适当距离',
    allowedBehaviors: ['真诚', '礼貌', '倾听', '关心'],
    unlockedFeatures: [],
  },
  familiar: {
    label: '熟悉',
    description: '可以互怼开玩笑，偶尔问候，可以使用昵称',
    allowedBehaviors: ['互怼', '开玩笑', '偶尔问候', '使用昵称', '真诚', '倾听'],
    unlockedFeatures: ['morning_greeting', 'evening_greeting', 'nicknames'],
  },
  ambiguous: {
    label: '暧昧',
    description: '语气变软，想你消息，偶尔撒娇',
    allowedBehaviors: ['语气变软', '想你消息', '偶尔撒娇', '互怼', '开玩笑', '关心'],
    unlockedFeatures: ['morning_greeting', 'evening_greeting', 'nicknames', 'random_checkin', 'emotional_support'],
  },
  intimate: {
    label: '亲密',
    description: '自然表达爱意，随性主动，撒娇/吃醋/情话',
    allowedBehaviors: ['自然表达爱意', '随性主动', '撒娇', '吃醋', '情话', '语气变软', '互怼'],
    unlockedFeatures: ['morning_greeting', 'evening_greeting', 'nicknames', 'random_checkin', 'emotional_support', 'proactive_intimacy'],
  },
};

/**
 * 返回指定阶段的配置。
 */
export function getStageConfig(stage: RelationshipStage): StageConfig {
  return STAGE_CONFIG[stage];
}

/**
 * 当前阶段是否允许使用昵称。
 */
export function canUseNicknames(stage: RelationshipStage): boolean {
  return STAGE_CONFIG[stage].unlockedFeatures.includes('nicknames');
}

/**
 * 当前阶段是否允许发送主动消息。
 */
export function canSendProactiveMsgs(stage: RelationshipStage): boolean {
  const features = STAGE_CONFIG[stage].unlockedFeatures;
  return features.includes('morning_greeting') || features.includes('random_checkin');
}

/**
 * 当前阶段是否允许表达亲密（爱意、撒娇、情话等）。
 */
export function canExpressIntimacy(stage: RelationshipStage): boolean {
  const features = STAGE_CONFIG[stage].unlockedFeatures;
  return features.includes('emotional_support') || features.includes('proactive_intimacy');
}

/**
 * 返回阶段的中文标签。
 */
export function stageLabel(stage: RelationshipStage): string {
  return STAGE_CONFIG[stage].label;
}
