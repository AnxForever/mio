import type {
  AIProvider,
  ContentBlock,
  Message,
  PromptCtx,
  SessionContext,
  TurnChannelContext,
} from '../types.js';
import type { PromptBudget } from '../utils/prompt-budget.js';
import type { MemoryUsefulnessCandidate } from '../memory/usefulness.js';
import type { ToolRegistryLike } from './tool-runtime.js';
import type { getConfig } from '../config.js';
import type { classifyIntent } from '../emotion/tracker.js';
import type { screenForCrisis } from '../safety/crisis.js';

/**
 * Input to a single agent-loop turn.
 *
 * - `text`         : plain text user input (most common).
 * - `imageBlocks`  : optional pre-processed image content blocks (vision/image.ts).
 * - `audioPath`    : optional path to an audio file; if provided, transcribed via STT.
 * - `sessionId`    : continue an existing session, or omit to start a new one.
 */
export interface TurnInput {
  text?: string;
  imageBlocks?: ContentBlock[];
  audioPath?: string;
  sessionId?: string;
  channel?: TurnChannelContext;
}

/**
 * Output from a single agent-loop turn.
 */
export interface TurnOutput {
  /** Final assistant text. */
  text: string;
  /** Session id (newly generated if input.sessionId was undefined). */
  sessionId: string;
  /** Tool calls made during the turn (for observability / logging). */
  toolCallCount: number;
  /** Number of inference iterations (1 = no tool calls, >1 = tool use). */
  turns: number;
  /** Whether a crisis signal was detected and surfaced. */
  crisisFlagged: boolean;
  /** Whether Mio chose to ghost this turn (no reply generated). */
  ghosted?: boolean;
  /** Optional machine-readable reason for silent turns. */
  silentReason?: string;
}

export interface RunTurnOptions {
  onToken?: (chunk: string) => void;
  provider?: AIProvider;
  registry?: ToolRegistryLike;
}

export interface PreparedTurnContext {
  registry: ToolRegistryLike;
  config: ReturnType<typeof getConfig>;
  provider: AIProvider;
  turnInput: TurnInput;
  sessionId: string;
  capturedDirectiveCount: number;
  sessionCtx: SessionContext;
  promptCtx: PromptCtx;
  recovery: 'new' | 'compact' | 'none';
  userMessage: Message;
  crisisResult: ReturnType<typeof screenForCrisis>;
}

export interface InferenceStageResult {
  text: string;
  toolCallCount: number;
  turns: number;
  intent: ReturnType<typeof classifyIntent>;
  budget?: PromptBudget;
  memoryUsefulnessCandidates?: MemoryUsefulnessCandidate[];
}
