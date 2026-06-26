/**
 * Mio — 共享类型定义
 * 扩展自 cola-companion，增加情感/关系/流式/多模态类型
 */

// ─── Gender ───

export type Gender = 'male' | 'female';

// ─── Provider ───

/**
 * Supported AI provider presets.
 * - 'auto': auto-detect from available API keys
 * - Specific provider names for explicit selection
 */
export type ProviderPreset =
  | 'auto'
  | 'anthropic'
  | 'openai'
  | 'deepseek'
  | 'moonshot'
  | 'zhipu'
  | 'minimax'
  | 'qwen'
  | 'doubao'
  | 'siliconflow'
  | 'mock';

/**
 * Static configuration for a provider preset.
 */
export interface ProviderPresetConfig {
  name: ProviderPreset;
  label: string;
  /** Base URL for the chat completions endpoint (no trailing path). */
  baseUrl: string;
  /** Environment variable that holds the API key. */
  apiKeyEnv: string;
  /** Default model name for this provider. */
  defaultModel: string;
  /** Auth header template. Use `${apiKey}` as placeholder. */
  authHeader: string;
  /** Whether this provider supports vision/image input. */
  supportsVision: boolean;
  /** Whether this provider supports function/tool calling. */
  supportsToolCalling: boolean;
  /** Available models (id + human-readable label). */
  models: { id: string; label: string }[];
}

/** Result of auto-detecting which provider to use. */
export interface ProviderResolution {
  preset: ProviderPresetConfig;
  apiKey: string;
  model: string;
}

// ─── 基础消息类型 ───

export type Role = 'user' | 'assistant' | 'system';

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ImageContent {
  type: 'image';
  source: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

export type ContentBlock = TextContent | ImageContent;

export interface Message {
  role: Role;
  content: string | ContentBlock[];
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  timestamp?: string;
}

// ─── 工具系统 ───

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  id: string;
  name: string;
  output: string;
  isError?: boolean;
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export type ToolHandler = (input: Record<string, unknown>, ctx: SessionContext) => Promise<string>;

export interface RegisteredTool extends ToolDef {
  handler: ToolHandler;
}

// ─── AI Provider ───

export interface AIProvider {
  name: string;
  chat(
    messages: Message[],
    systemPrompt: string,
    tools?: ToolDef[],
    opts?: { temperature?: number; maxTokens?: number; model?: string },
  ): Promise<{ text: string; toolCalls?: ToolCall[] }>;
}

export interface StreamingProvider extends AIProvider {
  chatStream(
    messages: Message[],
    systemPrompt: string,
    tools: ToolDef[] | undefined,
    onToken: (chunk: string) => void,
    onToolCall?: (call: ToolCall) => void,
    opts?: { temperature?: number; maxTokens?: number; model?: string },
  ): Promise<{ text: string; toolCalls?: ToolCall[] }>;
}

// ─── 会话上下文 ───

export interface SessionContext {
  sessionId: string;
  model: string;
  apiKey: string | undefined;
  gender: Gender;
  emotionState: EmotionState;
  relationshipState: RelationshipState;
  activeMod: string;
  colaDir: string;
  outputDir: string;
  connectedChannels?: ChannelInfo[];
}

// ─── IM Channel ───

export interface ChannelInfo {
  id: string;
  label: string;
  platform: string;
}

// ─── 情感状态 ───

export interface EmotionState {
  myMood: string;
  userMood: string;
  affection: number;
  energy: 'high' | 'mid' | 'low';
  lastInteraction: string;
  unresolvedThread: string | null;
  recentTopics: string[];
}

/** OCEAN personality traits (0-1 scale, slow-moving baselines). */
export interface OCEANTraits {
  openness: number;
  conscientiousness: number;
  extraversion: number;
  agreeableness: number;
  neuroticism: number;
}

// ─── 多轴亲密度 ───

export interface AffinityState {
  warmth: number;     // 0-100: how warm/close the relationship feels
  trust: number;      // 0-100: how much they trust each other
  intimacy: number;   // 0-100: romantic/emotional closeness
  patience: number;   // 0-100: tolerance for negative interactions (starts high, depletes)
  tension: number;    // 0-100: unresolved friction/frustration (starts low)
  updatedAt: string;
}

// ─── Multi-Axis Relationship ───

export interface MultiAxisState {
  closeness: number;    // 0-100: emotional intimacy, grows from all positive interaction
  trust: number;        // 0-100: built when user shares vulnerability, secrets, asks for help
  neediness: number;    // 0-100: how much the user relies on Mio (message frequency, initiative)
  updatedAt: string;
}

// ─── Ghost 上下文 ───

export interface GhostContext {
  /** Whether the last turn was ghosted (Mio chose not to reply) */
  lastTurnGhosted: boolean;
  /** How many consecutive ghost turns occurred */
  ghostStreak: number;
  /** Timestamp of the last ghost event */
  lastGhostAt: string | null;
}

// ─── 沮丧/依恋 ───

export type AttachmentStyle = 'secure' | 'anxious' | 'avoidant' | 'balanced';

export interface FrustrationState {
  /** How many cold/dismissive exchanges in a row */
  frustrationStreak: number;
  /** How many times Mio's messages were ignored (user didn't respond for >2h) */
  rejectionCount: number;
  /** Derived attachment style */
  attachmentLevel: AttachmentStyle;
  /** Timestamp of last warm exchange */
  lastWarmAt: string | null;
  /** Whether a mini-crisis is active */
  crisisActive: boolean;
}

// ─── 关系进展 ───

export type RelationshipStage = 'acquaintance' | 'familiar' | 'ambiguous' | 'intimate';

export interface RelationshipState {
  stage: RelationshipStage;
  stageChangedAt: string;
  interactionCount: number;
  emotionalDepth: number;
  sharedMemories: string[];
  nicknames: {
    userCallsAgent: string | null;
    agentCallsUser: string | null;
  };
}

// ─── Persona Studio ───

export interface PersonaRequest {
  name: string;
  gender: 'male' | 'female';
  style: string;
  age?: number;
  occupation?: string;
  traits?: string[];
}

export interface PersonaResult {
  soul: string;
  preview: string;
  tokenEstimate: number;
}

// ─── Dual-Mode Persona ───

export type PersonaMode = 'base' | 'deep';

export interface DualModeState {
  currentMode: PersonaMode;
  switchedAt: string;
  switchCount: number;
  hysteresis: number;    // cooldown counter to prevent oscillation
}

// ─── MOD ───

export interface ModDef {
  name: string;
  soulPath: string;
  fixed: boolean;
}

// ─── Subagent ───

export interface SubagentDef {
  name: string;
  description: string;
  systemPrompt?: string;
  tools?: string[];
  customTools?: string[];
  customToolsMode?: 'replace' | 'additive';
  maxTurns?: number;
  inheritMemory?: boolean;
  inheritModContext?: boolean;
  model?: string;
}

// ─── Cron ───

export interface CronTask {
  id: string;
  name: string;
  cron: string;
  prompt: string;
  enabled: boolean;
  createdAt: string;
  lastFired?: string;
  internal?: boolean;
}

// ─── Work Item ───

export interface WorkItem {
  id: string;
  title: string;
  description: string;
  status: 'todo' | 'in_progress' | 'done' | 'skipped';
  checklist: { label: string; done: boolean }[];
  comments: { at: string; text: string }[];
  artifacts: string[];
  createdAt: string;
  updatedAt: string;
}

// ─── Prompt ───

export type PromptFragment = (ctx: PromptCtx) => string | null;

export interface PromptCtx {
  sessionId: string;
  model: string;
  apiKey: string | undefined;
  gender: Gender;
  emotionState: EmotionState;
  relationshipState: RelationshipState;
  activeMod: string;
  soulContent: string;
  colaDir: string;
  outputDir: string;
  connectedChannels: ChannelInfo[];
  allowColaLinkSend: boolean;
  globalMemory?: string;
  initialTask?: string;
}
