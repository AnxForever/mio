/**
 * Mio — 主动消息调度器
 *
 * Cron 驱动的主动消息系统，根据关系阶段解锁不同行为：
 * - stage >= familiar:  早安问候 (0 8 * * *) + 晚安问候 (0 23 * * *)
 * - stage >= ambiguous:  随机关心 (0 {slash}8 * * * base + randomness)
 *
 * 消息类型: morning / evening / random_checkin / emotional_support
 * 生成方式: spawn proactive-msg 子 agent，返回 [NO_MSG] 则跳过
 */

import { Cron } from 'croner';
import { logger } from '../utils/logger.js';
import { spawnSubagent } from '../subagent/spawn.js';
import { readEmotionState } from '../emotion/state.js';
import { readRelationshipState } from '../relationship/progression.js';
import { getStageConfig, canSendProactiveMsgs, stageLabel } from '../relationship/stages.js';
import type { StageConfig } from '../relationship/stages.js';
import { selectProvider } from '../providers/index.js';
import { getConfig } from '../config.js';
import { decideProactiveMessage, recordProactiveMessage } from './smart-proactive.js';
import { sendToAllChannels, isNotifyEnabled } from '../server/notify.js';
import { appendBookmark } from '../memory/bank.js';
import type { StreamingProvider, SessionContext, EmotionState, RelationshipState, RelationshipStage } from '../types.js';

/** 主动消息类型 */
export type ProactiveMessageType = 'morning' | 'evening' | 'random_checkin' | 'emotional_support';

/** 已生成的主动消息 */
export interface ProactiveMessage {
  type: ProactiveMessageType;
  content: string;
  timestamp: string;
}

/** 阶段顺序（索引越大关系越深） */
const STAGE_ORDER: readonly RelationshipStage[] = ['acquaintance', 'familiar', 'ambiguous', 'intimate'];

let schedulerInstance: ProactiveScheduler | null = null;

/**
 * ProactiveScheduler — 主动消息调度器
 *
 * 根据关系阶段注册 cron job，定时生成并投递主动消息。
 */
export class ProactiveScheduler {
  private cronJobs: Cron[] = [];
  private provider: StreamingProvider;
  private ctx?: Partial<SessionContext>;
  private messageBuffer: ProactiveMessage[] = [];
  private onMessage?: (msg: ProactiveMessage) => void;
  private enabled: boolean;

  constructor(provider?: StreamingProvider, ctx?: Partial<SessionContext>) {
    const config = getConfig();
    this.provider = (provider ??
      selectProvider(ctx?.model ?? config.model, ctx?.apiKey)) as StreamingProvider;
    this.ctx = ctx;
    this.enabled = config.proactiveEnabled;
  }

  /**
   * 设置消息回调。
   * 当主动消息生成后，会调用此回调（用于即时投递到用户）。
   */
  setMessageCallback(cb: (msg: ProactiveMessage) => void): void {
    this.onMessage = cb;
  }

  /**
   * 注册 cron job，基于当前关系阶段。
   *
   * - stage >= familiar:  morning (0 8 * * *) + evening (0 23 * * *)
   * - stage >= ambiguous: random check-in (0 {slash}8 * * * + randomness → 1-2x/day)
   */
  start(): void {
    if (!this.enabled) {
      logger.info('[proactive] disabled by config');
      return;
    }
    if (this.cronJobs.length > 0) return; // 已启动

    const relState = readRelationshipState();
    const stageIdx = STAGE_ORDER.indexOf(relState.stage);
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

    // stage >= familiar: 早安问候
    if (stageIdx >= 1) {
      this.cronJobs.push(
        new Cron('0 8 * * *', { timezone: tz }, () => {
          this.sendProactiveMessage('morning').catch((err) => {
            logger.error('[proactive] morning failed:', err);
          });
        }),
      );
      logger.info('[proactive] morning greeting scheduled (0 8 * * *)');
    }

    // stage >= familiar: 晚安问候
    if (stageIdx >= 1) {
      this.cronJobs.push(
        new Cron('0 23 * * *', { timezone: tz }, () => {
          this.sendProactiveMessage('evening').catch((err) => {
            logger.error('[proactive] evening failed:', err);
          });
        }),
      );
      logger.info('[proactive] evening greeting scheduled (0 23 * * *)');
    }

    // stage >= ambiguous: 随机关心（base: 0 */8 * * *，加随机性 → 每天 1-2 次）
    if (stageIdx >= 2) {
      this.cronJobs.push(
        new Cron('0 */8 * * *', { timezone: tz }, () => {
          // 0 */8 * * * 每天触发 3 次（00:00, 08:00, 16:00）
          // 50% 概率实际发送 → 平均每天 1-2 次
          if (Math.random() < 0.5) {
            // 30% 概率发情感支持，70% 随机关心
            const type: ProactiveMessageType = Math.random() < 0.3 ? 'emotional_support' : 'random_checkin';
            this.sendProactiveMessage(type).catch((err) => {
              logger.error('[proactive] random check-in failed:', err);
            });
          }
        }),
      );
      logger.info('[proactive] random check-in scheduled (0 */8 * * *)');
    }

    if (this.cronJobs.length === 0) {
      logger.info(
        `[proactive] stage is ${stageLabel(relState.stage)}, no proactive messages yet`,
      );
    }
  }

  /** 停止所有 cron job */
  stop(): void {
    for (const job of this.cronJobs) {
      job.stop();
    }
    this.cronJobs = [];
  }

  /**
   * 手动触发一条主动消息。
   * type 未指定时默认 random_checkin。
   */
  async triggerNow(type?: ProactiveMessageType): Promise<string | null> {
    const t: ProactiveMessageType = type ?? 'random_checkin';
    return this.sendProactiveMessage(t);
  }

  /**
   * 生成并投递一条主动消息。
   *
   * 1. 读取当前情感状态 + 关系状态
   * 2. 检查阶段权限
   * 3. 构建 prompt，spawn proactive-msg 子 agent
   * 4. 若返回 [NO_MSG] 则跳过
   * 5. 否则存入 buffer 并触发回调
   */
  async sendProactiveMessage(type: ProactiveMessageType): Promise<string | null> {
    // 1. 读取当前状态
    const emotionState: EmotionState = readEmotionState();
    const relationshipState: RelationshipState = readRelationshipState();
    const stageConfig: StageConfig = getStageConfig(relationshipState.stage);
    const config = getConfig();

    // 2. 检查权限
    if (!canSendProactiveMsgs(relationshipState.stage)) {
      logger.info(
        `[proactive] stage ${relationshipState.stage} does not allow proactive messages`,
      );
      return null;
    }

    // 2b. Smart scheduler gate (unless disabled by feature flag or env var)
    if (config.features.smartProactive) {
      const decision = decideProactiveMessage(
        relationshipState.stage,
        emotionState.lastInteraction,
      );
      if (!decision.shouldMessage) {
        logger.info(`[proactive] smart scheduler vetoed: ${decision.reason}`);
        recordProactiveMessage(false);
        return null;
      }
      logger.info(`[proactive] smart scheduler approved: ${decision.reason}`);
    }

    // 3. 构建 prompt
    const prompt = buildProactivePrompt(type, emotionState, relationshipState, stageConfig);

    // 4. spawn proactive-msg 子 agent
    const result = await spawnSubagent('proactive-msg', prompt, this.provider, this.ctx, {
      maxTurns: 10,
      awaitTerminal: true,
    });

    // 5. 若返回 [NO_MSG] 则跳过
    const trimmed = result.trim();
    if (trimmed === '[NO_MSG]') {
      logger.info('[proactive] subagent decided no message needed');
      recordProactiveMessage(false);
      return null;
    }

    // 6. 记录发送给 smart scheduler
    recordProactiveMessage(true);

    // 7. 存入 buffer 并触发回调
    const message: ProactiveMessage = {
      type,
      content: trimmed,
      timestamp: new Date().toISOString(),
    };
    this.messageBuffer.push(message);

    // Record the outreach as a bookmark so Mio "remembers" she reached out —
    // it gets indexed for semantic recall and consolidated at night. Without
    // this, a proactive message leaves no trace and the next user reply has
    // no context that she just messaged them.
    try {
      appendBookmark({
        time: message.timestamp,
        what: `我主动联系了 ta（${type}）`,
        evidence: trimmed.slice(0, 120),
      });
    } catch {
      // Best-effort — never let a bookmark write break message delivery.
    }

    if (this.onMessage) {
      this.onMessage(message);
    }

    logger.info(`[proactive] message generated (${type}): ${trimmed.slice(0, 100)}`);

    // 8. 投递到外部通知渠道（Telegram / Webhook）
    await dispatchToNotifyChannels(trimmed, type);

    return trimmed;
  }

  /** 取出并清空 buffer 中的待投递消息 */
  drainMessages(): ProactiveMessage[] {
    const msgs = [...this.messageBuffer];
    this.messageBuffer = [];
    return msgs;
  }

  /** 是否有待投递消息 */
  hasPendingMessages(): boolean {
    return this.messageBuffer.length > 0;
  }
}

/**
 * 全局单例工厂。
 * 首次调用时创建实例，后续调用返回同一实例。
 */
export function proactiveScheduler(
  provider?: StreamingProvider,
  ctx?: Partial<SessionContext>,
): ProactiveScheduler {
  if (!schedulerInstance) {
    schedulerInstance = new ProactiveScheduler(provider, ctx);
  }
  return schedulerInstance;
}

// ─── 内部辅助 ───

/** 通知渠道分发：将主动消息推送到外部通知渠道 */
async function dispatchToNotifyChannels(text: string, type: ProactiveMessageType): Promise<void> {
  if (!isNotifyEnabled()) return;

  logger.info(`[proactive] dispatching to notification channels (${type})`);
  const results = await sendToAllChannels(text);
  for (const r of results) {
    if (r.success) {
      logger.info(`[proactive]  ✓ ${r.channel}: delivered`);
    } else {
      logger.error(`[proactive]  ✗ ${r.channel}: ${r.error}`);
    }
  }
}

/** 消息类型的中文标签 */
const TYPE_LABELS: Record<ProactiveMessageType, string> = {
  morning: '早安问候',
  evening: '晚安问候',
  random_checkin: '随机关心',
  emotional_support: '情感支持',
};

/**
 * 构建 proactive-msg 子 agent 的运行时 prompt。
 * 注入：消息类型、关系阶段、情感状态、昵称、共享记忆。
 */
function buildProactivePrompt(
  type: ProactiveMessageType,
  emotionState: EmotionState,
  relationshipState: RelationshipState,
  stageConfig: StageConfig,
): string {
  return `Generate a proactive message for the user.

## Context
- Message type: ${TYPE_LABELS[type]} (${type})
- Relationship stage: ${stageLabel(relationshipState.stage)} (${relationshipState.stage})
- Stage description: ${stageConfig.description}
- Allowed behaviors: ${stageConfig.allowedBehaviors.join(', ')}

## Current emotional state
- My mood: ${emotionState.myMood}
- User's mood: ${emotionState.userMood}
- Affection level: ${emotionState.affection}/100
- Energy level: ${emotionState.energy}
- Last interaction: ${emotionState.lastInteraction}
- Recent topics: ${emotionState.recentTopics.join(', ') || '(none)'}
- Unresolved thread: ${emotionState.unresolvedThread ?? '(none)'}

## Nicknames
- User calls me: ${relationshipState.nicknames.userCallsAgent ?? '(none yet)'}
- I call user: ${relationshipState.nicknames.agentCallsUser ?? '(none yet)'}

## Shared memories
${relationshipState.sharedMemories.length > 0
    ? relationshipState.sharedMemories.map((m) => `- ${m}`).join('\n')
    : '(none yet)'}

## Instructions
- Write a single natural message as Mio (the companion).
- Match the relationship stage's tone and allowed behaviors strictly.
- Keep it short (1-3 sentences).
- If this moment doesn't call for a message (e.g., too soon since last interaction, or context doesn't fit), respond with exactly: [NO_MSG]
- Write in the user's primary language (Chinese if unsure).
- Do not include any meta-text, just the message or [NO_MSG].`;
}
