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

      systemPrompt = appendIsolatedIMTimeline(systemPrompt, promptCtx, history, userMessage);
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

      systemPrompt = appendIsolatedIMTimeline(systemPrompt, promptCtx, history, userMessage);
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

function appendIsolatedIMTimeline(
  systemPrompt: string,
  promptCtx: PromptCtx,
  history: Message[],
  currentMessage: Message,
): string {
  if (!promptCtx.isolatedMemory) return systemPrompt;

  const timeline = buildRecentIMTimeline(history, currentMessage);
  if (!timeline) return systemPrompt;
  return `${systemPrompt}\n\n${timeline}`;
}

function buildRecentIMTimeline(history: Message[], currentMessage: Message): string {
  const recent = [...history.slice(-8), currentMessage]
    .filter((message) => typeof message.content === 'string' && message.content.trim().length > 0);
  if (recent.length === 0) return '';

  const lines = recent.map((message, index) => {
    const marker = index === recent.length - 1 ? '本轮刚收到' : formatTimelineTimestamp(message.timestamp);
    const role = message.role === 'assistant' ? 'Mio' : message.role === 'user' ? '对方' : '系统';
    return `- ${marker} ${role}: ${truncateTimelineText(message.content as string, 90)}`;
  });

  return [
    '## IM 时间边界',
    '下面是最近几条消息的真实时间线。只把最后一条当成本轮刚收到的消息。',
    '不要把昨晚/几小时前的旧消息当成刚刚发生；不要在同一轮回复里自造“等了一会儿”“你不回我”“你不理我”的后续剧情。',
    ...lines,
  ].join('\n');
}

function formatTimelineTimestamp(timestamp: string | undefined): string {
  if (!timestamp) return '较早';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp.slice(0, 16);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function truncateTimelineText(text: string, maxChars: number): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length <= maxChars ? oneLine : `${oneLine.slice(0, maxChars - 1)}…`;
}
