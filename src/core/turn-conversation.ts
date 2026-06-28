import { appendBookmark, readRecentBookmarks, readUserProfile } from '../memory/bank.js';
import { compressIfNeeded } from '../memory/compression.js';
import { appendTranscript, loadTranscriptWindow } from '../memory/transcript.js';
import type { getConfig } from '../config.js';
import type { screenForCrisis } from '../safety/crisis.js';
import type { Message, PromptCtx } from '../types.js';
import type { TurnInput } from './turn-types.js';

interface ConversationBuildInput {
  input: TurnInput;
  userMessage: Message;
  systemPrompt: string;
  promptCtx: PromptCtx;
  recovery: 'new' | 'compact' | 'none';
  crisisResult: ReturnType<typeof screenForCrisis>;
  config: ReturnType<typeof getConfig>;
  buildPrePrompt: (recovery: 'new' | 'compact' | 'none', colaDir: string) => string;
  buildPostPrompt: (
    promptCtx: PromptCtx,
    bookmarks: { what: string; time: string }[],
    userProfile: string,
  ) => string;
}

function buildFinalSystemPrompt(
  systemPrompt: string,
  crisisResult: ReturnType<typeof screenForCrisis>,
): string {
  if (!crisisResult.shouldIntervene) return systemPrompt;
  return `${systemPrompt}\n\n## Safety override\n${crisisResult.systemInjection}`;
}

export async function buildConversationMessages({
  input,
  userMessage,
  systemPrompt,
  promptCtx,
  recovery,
  crisisResult,
  config,
  buildPrePrompt,
  buildPostPrompt,
}: ConversationBuildInput): Promise<{ messages: Message[]; finalSystemPrompt: string }> {
  const messages: Message[] = [];

  if (input.sessionId) {
    if (config.features.adaptiveHistory) {
      const { compressHistory, renderCompressedHistory } = await import('../memory/adaptive-history.js');
      const history = loadTranscriptWindow(input.sessionId, 500);
      const allMsgs = [...history, userMessage];
      const compressed = compressHistory(allMsgs);
      const compressedText = renderCompressedHistory(compressed);

      if (compressed.placeholder.count > 0 || compressed.compressedMessages.length > 0) {
        systemPrompt = `${systemPrompt}\n\n## 对话历史\n${compressedText}`;

        if (!promptCtx.isolatedMemory && compressed.originalCount > 5) {
          appendBookmark({
            time: new Date().toISOString(),
            what: `[adaptive-compression] ${compressed.originalCount} messages → ${compressed.fullMessages.length} full + ${compressed.compressedMessages.length} compressed`,
            evidence: `saved ~${compressed.estimatedTokensSaved} tokens`,
          });
        }
      }

      messages.push(...compressed.fullMessages);
    } else {
      const history = loadTranscriptWindow(input.sessionId, 30);
      const allMsgs = [...history, userMessage];
      const compression = compressIfNeeded(allMsgs);

      if (compression.removedCount > 0) {
        systemPrompt = `${systemPrompt}\n\n${compression.summary}`;
        appendTranscript(input.sessionId, {
          type: 'compaction',
          timestamp: new Date().toISOString(),
          summary: compression.summary,
          recallCues: compression.recallCues,
        });

        if (!promptCtx.isolatedMemory) {
          appendBookmark({
            time: new Date().toISOString(),
            what: `[compaction] ${compression.removedCount} messages compressed`,
            evidence: compression.summary.slice(0, 200),
          });
        }
      }

      messages.push(...compression.messages);
    }
  } else {
    messages.push(userMessage);
  }

  let finalSystemPrompt = buildFinalSystemPrompt(systemPrompt, crisisResult);

  if (config.features.postHistoryInjection) {
    const prePrompt = buildPrePrompt(
      crisisResult.shouldIntervene ? 'none' : recovery,
      promptCtx.colaDir,
    );
    finalSystemPrompt = buildFinalSystemPrompt(prePrompt, crisisResult);

    const postPrompt = buildPostPrompt(
      promptCtx,
      promptCtx.isolatedMemory ? [] : readRecentBookmarks(8),
      promptCtx.isolatedMemory ? '' : readUserProfile(),
    );

    messages.push({
      role: 'user',
      content: `[System Context — this is not a user message. The following is Mio's internal context, instructions, and self-knowledge. Read this before responding to the user.]\n\n${postPrompt}`,
      timestamp: new Date().toISOString(),
    });
  }

  return { messages, finalSystemPrompt };
}
