import { updateAffinity } from '../emotion/affinity.js';
import { updateFrustration } from '../emotion/frustration.js';
import { shouldGhost } from '../emotion/ghost.js';
import { shouldSkipReplyForNecessity } from '../emotion/reply-necessity.js';
import { classifyIntent } from '../emotion/tracker.js';
import { pluginRegistry } from '../plugins/index.js';
import { logger } from '../utils/logger.js';
import type { Message } from '../types.js';
import { markSessionDone, recordMessage } from '../tools/session.js';
import type { PreparedTurnContext, TurnInput, TurnOutput } from './turn-types.js';

export async function maybeHandleEarlyTurnExit(
  prepared: PreparedTurnContext,
): Promise<TurnOutput | null> {
  const {
    config,
    turnInput,
    sessionId,
    sessionCtx,
    userMessage,
    crisisResult,
  } = prepared;

  // Group/channel messages should not always make Mio speak. Direct mentions
  // and crisis messages always proceed.
  if (!crisisResult.shouldIntervene) {
    const necessity = shouldSkipReplyForNecessity(turnInput.text ?? '', turnInput.channel);
    if (necessity.skip) {
      logger.info('[reply-necessity] silent group turn', {
        sessionId,
        score: necessity.score.score,
        detail: necessity.score.detail,
      });
      return handleSilentTurn({
        sessionId,
        userMessage,
        crisisFlagged: false,
        reason: 'reply_necessity_low',
      });
    }
  }

  if (
    !sessionCtx.isolatedMemory &&
    config.features.ghost &&
    !crisisResult.shouldIntervene &&
    shouldGhost(turnInput.text ?? '', sessionCtx)
  ) {
    const result = handleGhostTurn({ input: turnInput, sessionId, userMessage, config });
    if (!sessionCtx.isolatedMemory) {
      await pluginRegistry().invokeHook('onAfterTurn', sessionCtx, result);
    }
    if (!sessionCtx.isolatedMemory && !turnInput.sessionId) {
      await pluginRegistry().invokeHook('onSessionEnd', sessionId);
    }
    return result;
  }

  return null;
}

function handleGhostTurn({
  input,
  sessionId,
  userMessage,
  config,
}: {
  input: TurnInput;
  sessionId: string;
  userMessage: Message;
  config: PreparedTurnContext['config'];
}): TurnOutput {
  recordMessage(sessionId, userMessage);

  if (config.features.multiAxisAffinity) {
    const intent = classifyIntent(input.text ?? '');
    updateAffinity(intent.primary, true);
  }
  if (config.features.frustrationTracking) {
    const intent = classifyIntent(input.text ?? '');
    updateFrustration(intent.primary, true, false, input.text ?? '');
  }

  const ghostMsg: Message = {
    role: 'assistant',
    content: '',
    timestamp: new Date().toISOString(),
  };
  recordMessage(sessionId, ghostMsg);

  if (!input.sessionId) markSessionDone(sessionId);

  return {
    text: '',
    sessionId,
    toolCallCount: 0,
    turns: 0,
    crisisFlagged: false,
    ghosted: true,
    silentReason: 'ghost',
  };
}

function handleSilentTurn({
  sessionId,
  userMessage,
  crisisFlagged,
  reason,
}: {
  sessionId: string;
  userMessage: Message;
  crisisFlagged: boolean;
  reason: string;
}): TurnOutput {
  recordMessage(sessionId, userMessage);
  recordMessage(sessionId, {
    role: 'assistant',
    content: '',
    timestamp: new Date().toISOString(),
  });

  return {
    text: '',
    sessionId,
    toolCallCount: 0,
    turns: 0,
    crisisFlagged,
    ghosted: true,
    silentReason: reason,
  };
}
