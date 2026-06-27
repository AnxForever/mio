/**
 * liveness.js — 活着感视图模型
 *
 * 把后端关系 / 情感状态转成 UI 就绪的 view-model。纯函数、可测、无副作用。
 * 复用 constants.js 的 STAGE_LABELS + mascot.js 的 padToExpression,不重复造映射。
 * 消费方:消息列表(messages)、心情屋(mood)。
 */
import { STAGE_LABELS } from './utils/constants.js';
import { padToExpression } from './mascot.js';

/** 阶段顺序(与后端 stages.ts 一致) */
const STAGE_ORDER = ['acquaintance', 'familiar', 'ambiguous', 'intimate'];

/**
 * 各阶段「晋升到下一阶段」所需的最低交互次数(与后端 progression.ts 对齐:50 / 150 / 300)。
 * intimate 为满级,无上限。
 */
const STAGE_INTERACTION_THRESHOLD = {
  acquaintance: 50,
  familiar: 150,
  ambiguous: 300,
  intimate: Infinity,
};

/** 表情 → 心情中文标签 */
const EXPR_MOOD_LABEL = {
  happy: '开心',
  gentle: '温柔',
  longing: '想你了',
  shy: '害羞',
  worried: '担心',
  surprised: '惊喜',
};

/**
 * 关系阶段视图模型。
 * @param {{stage?: string, interactionCount?: number}} rel 后端 relationship 状态
 * @returns {{stage: string, label: string, count: number, nextStage: string|null, progress: number}}
 *   stage     阶段 key(非法 / 缺省回落 acquaintance)
 *   label     当前阶段中文标签
 *   count     交互次数(>= 0)
 *   nextStage 下一阶段中文标签(满级为 null)
 *   progress  当前阶段内晋升进度 0..1(满级为 1)
 */
export function relationshipVM(rel = {}) {
  const stage = STAGE_ORDER.includes(rel?.stage) ? rel.stage : 'acquaintance';
  const count = Math.max(0, Math.floor(rel?.interactionCount ?? 0));
  const idx = STAGE_ORDER.indexOf(stage);
  const nextKey = idx < STAGE_ORDER.length - 1 ? STAGE_ORDER[idx + 1] : null;

  // 进入当前阶段的交互门槛 = 上一阶段的晋升门槛(初识为 0)
  const enteredAt = idx === 0 ? 0 : STAGE_INTERACTION_THRESHOLD[STAGE_ORDER[idx - 1]];
  const advanceAt = STAGE_INTERACTION_THRESHOLD[stage];

  let progress;
  if (!nextKey || !Number.isFinite(advanceAt)) {
    progress = 1; // 满级
  } else {
    const span = advanceAt - enteredAt;
    progress = span > 0 ? Math.min(1, Math.max(0, (count - enteredAt) / span)) : 0;
  }

  return {
    stage,
    label: STAGE_LABELS[stage],
    count,
    nextStage: nextKey ? STAGE_LABELS[nextKey] : null,
    progress,
  };
}

/**
 * 心情视图模型(由 /avatar/state 的 PAD → 表情 + 中文标签)。
 * 复用 padToExpression;无 pad 时回落默认温柔态(与聊天页头像一致)。
 * @param {{pad?: object, daysSince?: number, shy?: boolean}} avatarState
 * @returns {{expr: string, label: string}}
 */
export function moodVM(avatarState = {}) {
  const pad = avatarState?.pad ?? {};
  const opts = {};
  if (avatarState?.daysSince !== undefined) opts.daysSince = avatarState.daysSince;
  if (avatarState?.shy !== undefined) opts.shy = avatarState.shy;
  const expr = padToExpression(pad, opts);
  return { expr, label: EXPR_MOOD_LABEL[expr] ?? '温柔' };
}
