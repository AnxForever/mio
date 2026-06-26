/**
 * Mio — 每轮情感追踪器
 * 在 agent loop 每轮结束后调用，分析交换并更新情感状态。
 *
 * v2: 使用 IntentClassifier 替代纯关键词匹配，支持多意图识别、
 *     情感色调判定和能量检测。
 *
 * v3: 集成 PAD 情感模型。
 * - 每轮调用 applyDecay 应用时间衰减
 * - 每轮调用 classifyPAD 分析消息情感影响
 * - 保持对旧 emotion-state.json 的后向兼容
 *
 * v4: 集成 Response Pattern Signals。
 * - 每轮调用 analyzeSignals 分析用户回复模式
 * - 信号历史持久化到 signal-history.json
 */

import type { EmotionState } from './types.internal.js';
import { readEmotionState, updateEmotionState, syncPADToEmotionState } from './state.js';
import { recordInteraction } from './progression.internal.js';
import { classifyIntent, intentLabel, type IntentResult } from './classifier.js';
import {
  isPADEnabled,
  applyDecay,
  classifyPAD,
  updatePAD,
  getPADState,
  padToMood,
} from './pad.js';
import { analyzeSignals, type ResponseSignals } from './signals.js';
import { isMultiAxisRelationshipEnabled, updateMultiAxis } from './multi-axis.js';
import { getConfig } from './config.internal.js';
import { recordPADState, computeMood as computeTraitMood } from './trait-state.js';

/**
 * 追踪每轮交换并更新情感状态。
 *
 * 步骤：
 * 1. 应用 PAD 时间衰减（如启用）
 * 2. 用 IntentClassifier 分类用户消息
 * 3. 根据主意图更新 userMood
 * 4. 根据情感色调调整 affection
 * 5. 更新话题和能量
 * 6. PAD: 调用 classifyPAD + updatePAD
 * 7. PAD trait-state: 记录 PAD 状态到滚动窗口
 * 8. 分析用户回复模式信号
 * 9. 持久化
 *
 * v5: 集成 Trait-State Separation。每轮调用 recordPADState() 来维持
 *     滚动平均窗口，computeMood() 融合特质层与状态层输出最终 mood/energy。
 */

export function trackEmotion(userMessage: string, agentReply: string, sessionId?: string): void {
  // 0. PAD: apply time decay first
  if (isPADEnabled()) {
    applyDecay();
  }

  // 1. Classify the user message
  const intent: IntentResult = classifyIntent(userMessage);

  // 2. Read current state
  const state: EmotionState = readEmotionState();

  // 3. Determine user mood from the primary intent
  const userMood = intentLabel(intent.primary);

  // 4. Update topics (merge, dedup, keep last 5)
  const updatedTopics: string[] = [...state.recentTopics];
  for (const topic of intent.topics) {
    if (!updatedTopics.includes(topic)) {
      updatedTopics.push(topic);
      if (updatedTopics.length > 5) updatedTopics.shift();
    }
  }

  // 5. Adjust affection based on exchange quality
  const isMeaningful = userMessage.trim().length > 5 && agentReply.trim().length > 10;
  let affectionDelta = 0;

  if (isMeaningful) {
    // Positive intents → affection grows faster (user is engaging warmly)
    if (intent.tone === 'positive') affectionDelta = 2;
    // Negative intents → affection still grows (user is trusting enough to share)
    else if (intent.tone === 'negative') affectionDelta = 1;
    // Neutral → slow growth
    else affectionDelta = 1;
  }

  // Cap affection at 100
  const newAffection = Math.min(100, state.affection + affectionDelta);

  // 6. PAD: classify and update
  if (isPADEnabled()) {
    const delta = classifyPAD(userMessage, agentReply);
    updatePAD(delta);
  }

  // 6b. Trait-State Separation: record current PAD state for rolling average
  //     and compute fused mood if the feature is enabled.
  const config = getConfig();
  let useTraitMood = false;
  if (isPADEnabled() && config.features.traitStateSeparation) {
    try {
      const pad = getPADState();
      recordPADState(pad);
      useTraitMood = true;
    } catch {
      // Best-effort — never crash the tracker on trait-state integration failure
    }
  }

  // 7. Determine Mio's energy based on user's energy + time of day
  const hour = new Date().getHours();
  let myEnergy: EmotionState['energy'] = 'mid';
  if (intent.energy === 'high') myEnergy = 'high';
  else if (intent.energy === 'low' || hour >= 23 || hour < 6) myEnergy = 'low';

  // If PAD is enabled, its mood/energy overrides the heuristic
  let myMood: string;
  if (isPADEnabled()) {
    if (useTraitMood) {
      try {
        const moodInfo = computeTraitMood();
        myMood = moodInfo.myMood;
        myEnergy = moodInfo.energy;
      } catch {
        // Fall back to plain PAD mood
        const pad = getPADState();
        const moodInfo = padToMood(pad);
        myMood = moodInfo.myMood;
        myEnergy = moodInfo.energy;
      }
    } else {
      const pad = getPADState();
      const moodInfo = padToMood(pad);
      myMood = moodInfo.myMood;
      myEnergy = moodInfo.energy;
    }
  } else {
    myMood = inferMyMood(intent, newAffection);
  }

  // 8. Analyze response pattern signals (if sessionId is provided)
  let signals: ResponseSignals | undefined;
  if (sessionId) {
    try {
      signals = analyzeSignals(userMessage, sessionId);
    } catch {
      // Signal analysis is best-effort; should not crash the tracker
    }
  }

  // 8b. Update multi-axis relationship (if enabled)
  if (isMultiAxisRelationshipEnabled()) {
    try {
      updateMultiAxis(intent.primary, signals ?? null, userMessage);
    } catch {
      // Multi-axis update is best-effort; should not crash the tracker
    }
  }

  // 9. Persist
  updateEmotionState({
    userMood,
    myMood,
    affection: newAffection,
    energy: myEnergy,
    lastInteraction: new Date().toISOString(),
    recentTopics: updatedTopics,
  });

  // 10. Sync PAD to legacy emotion state for backward compat
  if (isPADEnabled()) {
    syncPADToEmotionState();
  }

  // 11. Record interaction count
  recordInteraction();
}

/**
 * Infer Mio's mood based on the user's intent + relationship warmth.
 */
function inferMyMood(intent: IntentResult, affection: number): string {
  switch (intent.primary) {
    case 'excited':
      return '开心';
    case 'joking':
      return '开心';
    case 'playful':
      return affection > 50 ? '开心' : '活泼';
    case 'affectionate':
      return affection > 40 ? '温柔' : '开心';
    case 'sad':
      return '心疼';
    case 'seeking_comfort':
      return '心疼';
    case 'angry':
      return '担心';
    case 'anxious':
      return '担心';
    case 'tired':
      return '心疼';
    case 'venting':
      return '在意';
    case 'casual_chat':
      return affection > 60 ? '温柔' : '平静';
    default:
      return '平静';
  }
}

// Re-export for convenience
export { classifyIntent, intentLabel };
