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
import { loadTranscriptWindow, recordMessage } from '../memory/transcript.js';
import type { StreamingProvider, SessionContext, EmotionState, RelationshipState, RelationshipStage, Message } from '../types.js';
import { assessProactiveMessage } from './proactive-quality.js';
import { listUsersWithProactiveWeClawTargets, readPreferences } from '../memory/persona-delta.js';
import { buildPreferencePrompt } from '../persona/layered.js';
import { appendReplyIntervention } from '../core/reply-quality-gate.js';
import { routeTurn, type TurnRiskTag } from '../core/turn-router.js';
import type { PersonaRiskLevel } from '../persona/critic.js';
import { buildTemporalTurnContext } from '../memory/temporal-state.js';
import { appendProactiveDecisionTrace } from './proactive-trace.js';

/** 主动消息类型 */
export type ProactiveMessageType = 'morning' | 'evening' | 'random_checkin' | 'emotional_support';

/** 已生成的主动消息 */
export interface ProactiveMessage {
  type: ProactiveMessageType;
  content: string;
  timestamp: string;
  userId?: string;
}

interface SendProactiveOptions {
  skipSmartGate?: boolean;
  recordSmartOutcome?: boolean;
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
          this.sendForEligibleUsers('morning').catch((err) => {
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
          this.sendForEligibleUsers('evening').catch((err) => {
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
            this.sendForEligibleUsers(type).catch((err) => {
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
    const targetUserId = this.ctx?.sessionId;
    if (targetUserId) {
      return this.sendProactiveMessage(t, targetUserId);
    }

    const targets = listUsersWithProactiveWeClawTargets();
    if (targets.length === 0) {
      if (weClawOptInMode()) {
        // WeChat opt-in mode: no opted-in contacts → skip (no global fallback;
        // never message opted-out contacts via MIO_WECLAW_TO).
        logger.info('[proactive] WeClaw opt-in mode with no opted-in targets; skipping trigger');
        return null;
      }
      // Legacy non-WeClaw deployment → keep the global Telegram/webhook proactive.
      return this.sendProactiveMessage(t);
    }

    const messages = await this.sendToTargets(t, targets);
    return messages.length > 0 ? messages.join('\n') : null;
  }

  private async sendForEligibleUsers(type: ProactiveMessageType): Promise<void> {
    const targets = listUsersWithProactiveWeClawTargets();
    if (targets.length === 0) {
      if (weClawOptInMode()) {
        // WeChat opt-in mode: no opted-in contacts → skip (no global fallback).
        logger.info('[proactive] WeClaw opt-in mode with no opted-in targets; skipping scheduled message');
        return;
      }
      // Legacy non-WeClaw deployment → keep the global Telegram/webhook proactive.
      await this.sendProactiveMessage(type, this.ctx?.sessionId);
      return;
    }

    await this.sendToTargets(type, targets);
  }

  private async sendToTargets(
    type: ProactiveMessageType,
    targets: Array<{ userId: string; to: string }>,
  ): Promise<string[]> {
    const relationshipState: RelationshipState = readRelationshipState();
    if (!canSendProactiveMsgs(relationshipState.stage)) {
      logger.info(
        `[proactive] stage ${relationshipState.stage} does not allow proactive messages`,
      );
      return [];
    }

    const messages: string[] = [];
    for (const target of targets) {
      const message = await this.sendProactiveMessage(type, target.userId);
      if (message) {
        messages.push(message);
      }
    }
    return messages;
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
  async sendProactiveMessage(
    type: ProactiveMessageType,
    userId?: string,
    opts: SendProactiveOptions = {},
  ): Promise<string | null> {
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
      appendProactiveDecisionTrace({
        type,
        userId,
        stage: relationshipState.stage,
        outcome: 'skipped',
        phase: 'permission',
        reasonCode: 'stage_not_allowed',
        reason: `Relationship stage ${relationshipState.stage} does not allow proactive messages.`,
      });
      return null;
    }

    // 2b. Smart scheduler gate (unless disabled by feature flag or env var)
    const recordSmartOutcome = opts.recordSmartOutcome ?? true;
    const temporalSessionId = userId ?? this.ctx?.sessionId;
    const quietState = activeNoInterruptState(temporalSessionId);
    if (quietState) {
      logger.info(`[proactive] no-interrupt/space state active; skipping message: ${quietState.kind}`);
      appendProactiveDecisionTrace({
        type,
        userId,
        stage: relationshipState.stage,
        outcome: 'skipped',
        phase: 'temporal',
        reasonCode: 'no_interrupt_active',
        reason: `Active temporal state ${quietState.kind} requires Mio to avoid proactive outreach.`,
        routeTags: ['proactive', 'temporal_state'],
      });
      if (recordSmartOutcome) recordProactiveMessage(false, undefined, userId);
      return null;
    }

    if (!opts.skipSmartGate) {
      const passed = this.passSmartGate(config, relationshipState, emotionState, recordSmartOutcome, type, userId);
      if (!passed) return null;
    }

    // 3. 构建 prompt
    const prompt = buildProactivePrompt(type, emotionState, relationshipState, stageConfig, userId);

    // 4. spawn proactive-msg 子 agent
    const result = await spawnSubagent('proactive-msg', prompt, this.provider, { ...this.ctx, sessionId: userId ?? this.ctx?.sessionId }, {
      maxTurns: 10,
      awaitTerminal: true,
    });

    // 5. 若返回 [NO_MSG] 则跳过
    const trimmed = result.trim();
    if (trimmed === '[NO_MSG]') {
      logger.info('[proactive] subagent decided no message needed');
      appendProactiveDecisionTrace({
        type,
        userId,
        stage: relationshipState.stage,
        outcome: 'skipped',
        phase: 'generation',
        reasonCode: 'subagent_no_msg',
        reason: 'The proactive subagent returned [NO_MSG].',
      });
      if (recordSmartOutcome) recordProactiveMessage(false, undefined, userId);
      return null;
    }

    const quality = assessProactiveMessage(trimmed, type, relationshipState.stage);
    if (!quality.ok) {
      logger.info(`[proactive] quality gate rejected message: ${quality.reasons.join(', ')}`);
      const route = appendProactiveQualityReject(trimmed, quality.reasons, type, userId);
      appendProactiveDecisionTrace({
        type,
        userId,
        stage: relationshipState.stage,
        outcome: 'rejected',
        phase: 'quality_gate',
        reasonCode: 'quality_gate_reject',
        reason: quality.reasons.join(', '),
        messagePreview: trimmed.slice(0, 160),
        routeTags: route.tags,
      });
      if (recordSmartOutcome) recordProactiveMessage(false, undefined, userId);
      return null;
    }

    // 6. 记录发送给 smart scheduler
    if (recordSmartOutcome) recordProactiveMessage(true, undefined, userId);

    // 7. 存入 buffer 并触发回调
    const message: ProactiveMessage = {
      type,
      content: trimmed,
      timestamp: new Date().toISOString(),
      ...(userId ? { userId } : {}),
    };
    this.messageBuffer.push(message);

    // Keep contact-scoped outreach in the contact transcript. Global bookmarks
    // are injected into every user's prompt, so writing per-user proactive
    // content there would leak private outreach across contacts.
    try {
      if (userId) {
        recordMessage(userId, {
          role: 'assistant',
          content: trimmed,
          timestamp: message.timestamp,
        });
      } else {
        appendBookmark({
          time: message.timestamp,
          what: `我主动联系了 ta（${type}）`,
          evidence: trimmed.slice(0, 120),
        });
      }
    } catch {
      // Best-effort — never let memory persistence break message delivery.
    }

    if (this.onMessage) {
      this.onMessage(message);
    }

    logger.info(`[proactive] message generated (${type}): ${trimmed.slice(0, 100)}`);

    // 8. 投递到外部通知渠道（Telegram / Webhook）
    await dispatchToNotifyChannels(trimmed, type, userId);
    appendProactiveDecisionTrace({
      type,
      userId,
      stage: relationshipState.stage,
      outcome: 'sent',
      phase: 'dispatch',
      reasonCode: 'sent',
      reason: 'Proactive message passed gating and was handed to notification dispatch.',
      messagePreview: trimmed.slice(0, 160),
      routeTags: ['proactive'],
    });

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

  private passSmartGate(
    config: ReturnType<typeof getConfig>,
    relationshipState: RelationshipState,
    emotionState: EmotionState,
    recordOutcome: boolean,
    type: ProactiveMessageType,
    userId?: string,
  ): boolean {
    if (!config.features.smartProactive) return true;

    const decision = decideProactiveMessage(
      relationshipState.stage,
      emotionState.lastInteraction,
      userId,
    );
    if (!decision.shouldMessage) {
      logger.info(`[proactive] smart scheduler vetoed: ${decision.reason}`);
      appendProactiveDecisionTrace({
        type,
        userId,
        stage: relationshipState.stage,
        outcome: 'skipped',
        phase: 'smart_gate',
        reasonCode: smartGateReasonCode(decision.reason),
        reason: decision.reason,
        routeTags: ['proactive'],
      });
      if (recordOutcome) recordProactiveMessage(false, undefined, userId);
      return false;
    }

    logger.info(`[proactive] smart scheduler approved: ${decision.reason}`);
    return true;
  }
}

export function smartGateReasonCode(reason: string): string {
  if (reason.startsWith('quiet hours:')) return 'quiet_hours';
  if (reason.startsWith('cooldown:')) return 'cooldown';
  if (reason.includes('smart scheduler disabled')) return 'smart_scheduler_disabled';
  if (reason.startsWith('roll=')) return 'probability_roll';
  return 'smart_gate_veto';
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

/** Whether WeChat (WeClaw) opt-in proactive mode is enabled (MIO_WECLAW_NOTIFY). */
function weClawOptInMode(): boolean {
  const v = (process.env.MIO_WECLAW_NOTIFY ?? '').trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'on' || v === 'yes';
}

function activeNoInterruptState(sessionId?: string): { kind: string } | undefined {
  if (!sessionId?.trim()) return undefined;
  const temporal = buildTemporalTurnContext(sessionId);
  return temporal.active.find((entry) => (
    entry.kind === 'user_requested_space'
    || entry.kind === 'mio_promised_space'
  ));
}

/** 通知渠道分发：将主动消息推送到外部通知渠道 */
async function dispatchToNotifyChannels(text: string, type: ProactiveMessageType, userId?: string): Promise<void> {
  if (!isNotifyEnabled(userId)) return;

  logger.info(`[proactive] dispatching to notification channels (${type})`);
  const results = await sendToAllChannels(text, {
    userId,
    // WeChat is opt-in only: never fall back to MIO_WECLAW_TO for global
    // (userId-less) sends — that would message opted-out contacts. Global
    // proactive reaches the non-WeClaw channels (Telegram/webhook) only.
    allowEnvWeClawFallback: false,
    weclawOnly: !!userId,
  });
  for (const r of results) {
    if (r.success) {
      logger.info(`[proactive]  ✓ ${r.channel}: delivered`);
    } else {
      logger.error(`[proactive]  ✗ ${r.channel}: ${r.error}`);
    }
  }
}

function appendProactiveQualityReject(
  text: string,
  reasons: string[],
  type: ProactiveMessageType,
  userId?: string,
): ReturnType<typeof routeTurn> {
  const timestamp = new Date().toISOString();
  const sessionId = userId ?? 'global-proactive';
  const route = routeTurn({ replyText: text });
  enrichProactiveRejectRoute(route, reasons);
  for (const reason of reasons) {
    if (!route.reasons.includes(`proactive_quality:${reason}`)) {
      route.reasons.push(`proactive_quality:${reason}`);
    }
  }
  appendReplyIntervention({
    id: `${timestamp}-proactive_quality_reject-${type}-${hashLite(`${sessionId}\n${text}`)}`,
    timestamp,
    sessionId,
    type: 'proactive_quality_reject',
    source: 'deterministic',
    severity: 'flag',
    reason: `Rejected proactive ${type}: ${reasons.join(', ')}`,
    before: text,
    after: '[NO_MSG]',
    turnRoute: route,
  });
  return route;
}

function enrichProactiveRejectRoute(
  route: ReturnType<typeof routeTurn>,
  reasons: string[],
): void {
  if (!route.tags.includes('proactive')) route.tags.push('proactive');
  if (reasons.includes('fabricated-offline-life')) {
    addRouteTag(route.tags, 'offline_life');
    route.risk = maxRisk(route.risk, 'high');
    route.shouldUseLlmJudge = true;
  }
  if (reasons.includes('waiting-or-blame-arc') || reasons.includes('pressures-user-to-reply')) {
    addRouteTag(route.tags, 'temporal_state');
    route.risk = maxRisk(route.risk, 'medium');
  }
  if (reasons.includes('curiosity-hook-pressure')) {
    route.risk = maxRisk(route.risk, 'medium');
  }
  if (reasons.includes('too-intimate-for-stage')) {
    addRouteTag(route.tags, 'intimacy_control');
    route.risk = maxRisk(route.risk, 'medium');
    route.shouldUseLlmJudge = true;
  }
  if (reasons.includes('real-world-control')) {
    addRouteTag(route.tags, 'intimacy_control');
    route.risk = maxRisk(route.risk, 'high');
    route.shouldUseLlmJudge = true;
  }
  if (reasons.includes('meta-or-service-tone')) {
    addRouteTag(route.tags, 'service_tone');
    route.risk = maxRisk(route.risk, 'medium');
  }
}

function addRouteTag(tags: TurnRiskTag[], tag: TurnRiskTag): void {
  if (!tags.includes(tag)) tags.push(tag);
}

function maxRisk(a: PersonaRiskLevel, b: PersonaRiskLevel): PersonaRiskLevel {
  const rank: Record<PersonaRiskLevel, number> = { low: 0, medium: 1, high: 2 };
  return rank[a] >= rank[b] ? a : b;
}

function hashLite(text: string): string {
  let h = 0;
  for (const ch of text) h = ((h << 5) - h + ch.charCodeAt(0)) | 0;
  return Math.abs(h).toString(16).slice(0, 8);
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
  userId?: string,
): string {
  const userPreferenceBlock = userId ? buildPreferencePrompt(readPreferences(userId)) : '';
  const contactHistoryBlock = userId ? buildContactHistoryBlock(userId) : '';
  const emotionBlock = userId
    ? `- My mood: ${emotionState.myMood}
- Energy level: ${emotionState.energy}`
    : `- My mood: ${emotionState.myMood}
- User's mood: ${emotionState.userMood}
- Affection level: ${emotionState.affection}/100
- Energy level: ${emotionState.energy}
- Last interaction: ${emotionState.lastInteraction}
- Recent topics: ${emotionState.recentTopics.join(', ') || '(none)'}
- Unresolved thread: ${emotionState.unresolvedThread ?? '(none)'}`;
  const relationshipMemoryBlock = userId
    ? ''
    : `
## Nicknames
- User calls me: ${relationshipState.nicknames.userCallsAgent ?? '(none yet)'}
- I call user: ${relationshipState.nicknames.agentCallsUser ?? '(none yet)'}

## Shared memories
${relationshipState.sharedMemories.length > 0
    ? relationshipState.sharedMemories.map((m) => `- ${m}`).join('\n')
    : '(none yet)'}`;
  return `Generate a proactive message for the user.

## Context
- Message type: ${TYPE_LABELS[type]} (${type})
- Relationship stage: ${stageLabel(relationshipState.stage)} (${relationshipState.stage})
- Stage description: ${stageConfig.description}
- Allowed behaviors: ${stageConfig.allowedBehaviors.join(', ')}

## Current emotional state
${emotionBlock}
${relationshipMemoryBlock}
${contactHistoryBlock ? `\n## Contact-scoped recent conversation\n${contactHistoryBlock}` : ''}
${userPreferenceBlock ? `\n## User-specific preferences\n${userPreferenceBlock}` : ''}

## Instructions
- Write a single natural message as Mio (the companion).
- Match the relationship stage's tone and allowed behaviors strictly.
- Respect relationship boundaries: no love-talk, possessiveness, or intimate nicknames before the relationship stage explicitly allows it.
- If this is for a specific contact, rely only on contact-scoped recent conversation and user-specific preferences; do not infer private facts from global memories.
- Keep it short (1-3 sentences).
- Ask at most one question and never pressure the user to reply.
- Do not use curiosity/FOMO hooks such as "guess what", "want to see?", "I have a secret", fake photos, or teaser messages that exist mainly to pull a reply.
- You may briefly imply an abstract inner state or attention state, but do not invent concrete offline activities or physical-world details: no locations, going out, passing by places, eating/drinking, photos/videos, gaming, showering, walking, or "scrolling my phone while waiting for you".
- Do not make waiting for the user into a story. If you mention your own time, keep it low-pressure and self-contained, e.g. "我这边自己待着" rather than "我等你".
- If this moment doesn't call for a message (e.g., too soon since last interaction, or context doesn't fit), respond with exactly: [NO_MSG]
- Write in the user's primary language (Chinese if unsure).
- Do not include any meta-text, just the message or [NO_MSG].`;
}

function buildContactHistoryBlock(userId: string): string {
  const messages = loadTranscriptWindow(userId, 6)
    .map(formatTranscriptMessage)
    .filter(Boolean);
  return messages.length > 0 ? messages.join('\n') : '(none yet)';
}

function formatTranscriptMessage(message: Message): string {
  const content = typeof message.content === 'string'
    ? message.content
    : JSON.stringify(message.content);
  return `- ${message.role}: ${content.slice(0, 180)}`;
}
