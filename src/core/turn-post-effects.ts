import { captureExplicitDirectives } from '../persona/directive-capture.js';
import { getConfig } from '../config.js';
import { trackEmotion } from '../emotion/tracker.js';
import type { classifyIntent } from '../emotion/tracker.js';
import { updateAffinity } from '../emotion/affinity.js';
import { updateFrustration } from '../emotion/frustration.js';
import { observeRitual, updateCardboard } from '../emotion/ritual.js';
import { updatePAD } from '../emotion/pad.js';
import { checkProgression } from '../relationship/progression.js';
import { appendBookmark, updateActiveContext } from '../memory/bank.js';
import { observeAssistantTemporalCommitments } from '../memory/temporal-state.js';
import { isSyntheticProfileSignal } from '../memory/profile-governance.js';
import { collectFromFeedback } from '../learning/dynamic-fewshot.js';
import { recordTurn as recordDualModeTurn } from '../persona/dual-mode.js';
import {
  getPersonalityState,
  simulateLifeEvent,
  applyWarmUpEffect,
  isPersonalityDriverEnabled,
} from '../persona/driver.js';
import { lifeEngine } from '../character/life-engine.js';
import { readActiveCharacter } from '../character/factory.js';
import { acknowledgeRecentEvents } from '../character/memory-stream.js';
import { recordMessage, markSessionDone } from '../tools/session.js';
import { drainFallbackEvents } from '../providers/index.js';
import { logger } from '../utils/logger.js';
import type { PromptBudget } from '../utils/prompt-budget.js';
import type { screenForCrisis } from '../safety/crisis.js';
import type { Message, SessionContext } from '../types.js';
import type { TurnInput } from './turn-types.js';
import { getTurnCounter, incrementTurnCounter } from './turn-counter.js';

interface PostTurnSideEffectsInput {
  input: TurnInput;
  text: string;
  sessionId: string;
  sessionCtx: SessionContext;
  intent: ReturnType<typeof classifyIntent>;
  crisisResult: ReturnType<typeof screenForCrisis>;
  config: ReturnType<typeof getConfig>;
  budget?: PromptBudget;
  isNewSession: boolean;
  capturedDirectiveCount: number;
}

export async function applyPostTurnSideEffects({
  input,
  text,
  sessionId,
  sessionCtx,
  intent,
  crisisResult,
  config,
  budget,
  isNewSession,
  capturedDirectiveCount,
}: PostTurnSideEffectsInput): Promise<void> {
  const assistantMsg: Message = {
    role: 'assistant',
    content: text,
    timestamp: new Date().toISOString(),
  };
  const isolatedMemory = sessionCtx.isolatedMemory === true;
  recordMessage(sessionId, assistantMsg);
  observeAssistantTemporalCommitments(sessionId, text, new Date(assistantMsg.timestamp ?? Date.now()));
  if (!isolatedMemory) {
    trackEmotion(input.text ?? '', text, sessionId);
  }

  scheduleLearningSideEffects(input, text, sessionId, config, isolatedMemory);
  updateRelationalSideEffects(input, text, intent, crisisResult, config, isolatedMemory);
  if (capturedDirectiveCount === 0) {
    captureExplicitDirectives(input.text, sessionId, !isolatedMemory);  // isolated 只写 per-user，不碰全局 relationship
  }
  if (!isolatedMemory) {
    await updatePersonalitySideEffects(input, text, sessionCtx);
  }
  persistTurnMemorySideEffects(input, text, sessionId, crisisResult, isNewSession, isolatedMemory);

  // Drain provider fallback events from this turn. Non-isolated sessions record
  // the switch into BOOKMARKS (it's relationship context — Mio "noticed" her
  // usual voice changed); isolated IM sessions only log, to keep contacts from
  // polluting the global timeline.
  try {
    const events = drainFallbackEvents();
    for (const event of events) {
      if (!isolatedMemory) {
        appendBookmark({
          time: new Date().toISOString(),
          what: `[provider] ${event}`,
          evidence: 'fallback-chain',
        });
      } else {
        logger.warn(`[fallback][isolated] ${event}`);
      }
    }
  } catch (err) {
    logger.error('drain fallback events failed', { error: String(err) });
  }

  if (budget) budget.log();
}

function scheduleLearningSideEffects(
  input: TurnInput,
  text: string,
  sessionId: string,
  config: ReturnType<typeof getConfig>,
  isolatedMemory: boolean,
): void {
  if (isolatedMemory) return;
  if (input.text) {
    if (!isSyntheticProfileSignal({ text: input.text, evidence: text, sessionId })) {
      import('../learning/mirror.js').then(({ analyzeUserMessage }) => {
        analyzeUserMessage(input.text!);
      }).catch((err: unknown) => { logger.error('mirror learning failed', { error: String(err) }); });
    }

    import('../learning/feedback.js').then(({ detectFeedback }) => {
      detectFeedback(input.text!, text);
    }).catch((err: unknown) => { logger.error('feedback learning failed', { error: String(err) }); });

    if (config.features.dynamicFewShot) {
      collectFromFeedback().catch((err: unknown) => { logger.error('fewshot learning failed', { error: String(err) }); });
    }

    const turnCounter = incrementTurnCounter();
    if (turnCounter % 20 === 0) {
      import('../learning/dynamic-fewshot.js').then(({ rotateBank }) => {
        rotateBank();
      }).catch((err: unknown) => { logger.error('fewshot rotation failed', { error: String(err) }); });
    }
  }
}

function updateRelationalSideEffects(
  input: TurnInput,
  text: string,
  intent: ReturnType<typeof classifyIntent>,
  crisisResult: ReturnType<typeof screenForCrisis>,
  config: ReturnType<typeof getConfig>,
  isolatedMemory: boolean,
): void {
  if (isolatedMemory) return;
  if (input.text) {
    observeRitual(input.text, new Date().getHours());
  }

  updateCardboard(input.text ?? '', text);

  if (config.features.multiAxisAffinity) {
    updateAffinity(intent.primary, false);
  }

  if (config.features.frustrationTracking) {
    updateFrustration(intent.primary, false);
  }

  recordDualModeTurn(intent, crisisResult.shouldIntervene);

  // Running this per turn, after trackEmotion has bumped interactionCount and
  // emotionalDepth, keeps stage-gated behaviors from freezing under serve.
  checkProgression();
}

async function updatePersonalitySideEffects(
  input: TurnInput,
  text: string,
  sessionCtx: SessionContext,
): Promise<void> {
  if (isPersonalityDriverEnabled()) {
    try {
      const personalityState = getPersonalityState();
      const timeSinceLastChat = sessionCtx.emotionState.lastInteraction
        ? (Date.now() - new Date(sessionCtx.emotionState.lastInteraction).getTime()) / 3_600_000
        : 0;

      if (timeSinceLastChat > 24 && text && text.trim().length > 0) {
        applyWarmUpEffect();
      }

      const turnCounter = getTurnCounter();
      if (turnCounter % 8 === 0 && turnCounter > 0) {
        const charName = readActiveCharacter();
        if (getConfig().features.lifeEngine && charName) {
          const event = await lifeEngine().tickLight(charName);
          if (event) {
            appendBookmark({
              time: new Date().toISOString(),
              what: `[life-event] ${truncate(event.description, 100)}`,
              evidence: `category=${event.category} importance=${event.importance}`,
            });
          }
        } else {
          const lifeEvent = simulateLifeEvent();
          if (lifeEvent && personalityState.initiative > 50 && timeSinceLastChat > 2) {
            appendBookmark({
              time: new Date().toISOString(),
              what: `[life-event] 你: ${truncate(lifeEvent, 100)}`,
              evidence: `personality: sociability=${personalityState.sociability}, initiative=${personalityState.initiative}`,
            });
          }
        }
      }

      if (getConfig().features.lifeEngine && text && /抱抱|不哭|没事|我在|陪|心疼|还好吗|辛苦了|会好起来的|别难过/.test(text)) {
        try {
          updatePAD({ pleasure: 0.15, arousal: -0.05, dominance: 0.1 });
          const charName = readActiveCharacter();
          if (charName) acknowledgeRecentEvents(charName);
        } catch { /* best-effort */ }
      }
    } catch {
      // Best-effort
    }
  }
}

function persistTurnMemorySideEffects(
  input: TurnInput,
  text: string,
  sessionId: string,
  crisisResult: ReturnType<typeof screenForCrisis>,
  isNewSession: boolean,
  isolatedMemory: boolean,
): void {
  if (!isolatedMemory && (crisisResult.shouldIntervene || (input.text && input.text.trim().length > 5))) {
    appendBookmark({
      time: new Date().toISOString(),
      what: crisisResult.shouldIntervene
        ? `[crisis:${crisisResult.level}] user expressed distress`
        : `exchange: user said "${truncate(input.text ?? '', 80)}"`,
      evidence: crisisResult.shouldIntervene
        ? `matched: ${crisisResult.matchedKeywords.join(', ')}`
        : `agent replied: "${truncate(text, 80)}"`,
    });
  }

  const hint = truncate(
    `${new Date().toISOString().slice(11, 16)} ${crisisResult.shouldIntervene ? '[crisis] ' : ''}${truncate(input.text ?? '', 60)} → ${truncate(text, 60)}`,
    280,
  );
  if (!isolatedMemory) {
    try {
      updateActiveContext(hint);
    } catch {
      // Active Context update is best-effort; don't break the turn on failure.
    }
  }

  if (isNewSession) {
    markSessionDone(sessionId);
  }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}
