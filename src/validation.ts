/**
 * Mio — Request validation schemas
 *
 * Runtime validation for all API inputs using Zod.
 * TypeScript types are derived from schemas — single source of truth.
 */

import { z } from 'zod';

// ─── Chat ───

export const chatBody = z.object({
  text: z.string().min(1).max(8000).optional(),
  sessionId: z.string().max(64).optional(),
  imagePath: z.string().max(512).optional(),
  audioPath: z.string().max(512).optional(),
}).refine((body) => !!body.text || !!body.imagePath || !!body.audioPath, {
  message: 'At least one of text, imagePath, or audioPath is required',
});

export type ChatBody = z.infer<typeof chatBody>;

const openAIContentPart = z.object({
  type: z.string().trim().min(1).max(64).optional(),
  text: z.string().max(8000).optional(),
  input_text: z.string().max(8000).optional(),
}).passthrough();

export const openAIChatMessage = z.object({
  role: z.enum(['system', 'developer', 'user', 'assistant', 'tool']),
  content: z.union([
    z.string().max(8000),
    z.array(openAIContentPart).max(32),
    z.null(),
  ]).optional(),
  name: z.string().trim().max(128).optional(),
  tool_call_id: z.string().trim().max(256).optional(),
}).passthrough();

export const openAIChatCompletionsBody = z.object({
  model: z.string().trim().min(1).max(200).optional().default('mio'),
  messages: z.array(openAIChatMessage).min(1).max(100),
  stream: z.boolean().optional().default(false),
  user: z.string().trim().max(256).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().min(1).max(8192).optional(),
}).passthrough();

export type OpenAIChatMessage = z.infer<typeof openAIChatMessage>;
export type OpenAIChatCompletionsBody = z.infer<typeof openAIChatCompletionsBody>;

const authUsername = z.string().trim().min(2).max(64).regex(/^[\p{L}\p{N}_.@-]+$/u, 'Invalid username');
const authPassword = z.string().min(8).max(200);

export const authBootstrapBody = z.object({
  username: authUsername,
  password: authPassword,
  setupToken: z.string().trim().max(500).optional(),
}).strict();

export type AuthBootstrapBody = z.infer<typeof authBootstrapBody>;

export const authLoginBody = z.object({
  username: authUsername,
  password: authPassword,
}).strict();

export type AuthLoginBody = z.infer<typeof authLoginBody>;

export const adminUserCreateBody = z.object({
  username: authUsername,
  password: authPassword,
  role: z.enum(['admin', 'viewer']).optional().default('admin'),
}).strict();

export type AdminUserCreateBody = z.infer<typeof adminUserCreateBody>;

const oneBotId = z.union([
  z.string().trim().min(1).max(64),
  z.number().int().nonnegative(),
]);

export const oneBotMessageSegment = z.object({
  type: z.string().trim().min(1).max(64),
  data: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

export const oneBotEventBody = z.object({
  post_type: z.string().trim().min(1).max(64),
  message_type: z.enum(['private', 'group']).optional(),
  sub_type: z.string().trim().max(64).optional(),
  user_id: oneBotId.optional(),
  group_id: oneBotId.optional(),
  self_id: oneBotId.optional(),
  message_id: oneBotId.optional(),
  message: z.union([
    z.string().max(8000),
    z.array(oneBotMessageSegment).max(128),
  ]).optional(),
  raw_message: z.string().max(8000).optional(),
  sender: z.record(z.string(), z.unknown()).optional(),
  time: z.number().optional(),
}).passthrough();

export type OneBotMessageSegment = z.infer<typeof oneBotMessageSegment>;
export type OneBotEventBody = z.infer<typeof oneBotEventBody>;

export const voiceSynthesizeBody = z.object({
  text: z.string().trim().min(1).max(2000),
});

export type VoiceSynthesizeBody = z.infer<typeof voiceSynthesizeBody>;

export const audioUploadBody = z.object({
  filename: z.string().trim().min(1).max(180).optional(),
  mimeType: z.enum(['audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp4', 'audio/webm', 'audio/ogg']).optional(),
  data: z.string().min(1).max(20_000_000),
});

export type AudioUploadBody = z.infer<typeof audioUploadBody>;

export const imageUploadBody = z.object({
  filename: z.string().trim().min(1).max(180).optional(),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']).optional(),
  data: z.string().min(1).max(7_000_000),
});

export type ImageUploadBody = z.infer<typeof imageUploadBody>;

// ─── Mod switch ───

export const modBody = z.object({
  name: z.string().min(1).max(50),
});

export type ModBody = z.infer<typeof modBody>;

export const modelConfigBody = z.object({
  provider: z.string().trim().min(1).max(80),
  model: z.string().trim().max(200).optional(),
}).strict();

export type ModelConfigBody = z.infer<typeof modelConfigBody>;

export const wechatNativeSettingsBody = z.object({
  accessMode: z.enum(['open', 'allowlist']).optional(),
  allowedUsers: z.array(z.string().trim().min(1).max(128)).max(1000).optional(),
  dailyLimitPerUser: z.number().int().min(0).max(500).optional(),
  unknownUserReply: z.string().trim().max(500).optional(),
  quotaExceededReply: z.string().trim().max(500).optional(),
}).strict().refine((body) => Object.keys(body).length > 0, {
  message: 'At least one field is required',
});

export type WechatNativeSettingsBody = z.infer<typeof wechatNativeSettingsBody>;

export const modNameParam = z.object({
  name: z.string().trim().min(1).max(80).regex(/^[\p{L}\p{N}_-]+$/u, 'Invalid mod name'),
});

export type ModNameParam = z.infer<typeof modNameParam>;

export const soulBody = z.object({
  soul: z.string().min(1).max(80_000),
});

export type SoulBody = z.infer<typeof soulBody>;

// ─── Persona generation ───

export const personaBody = z.object({
  name: z.string().trim().min(1).max(50).regex(/^[\p{L}\p{N}_-]+$/u, 'Use letters, numbers, underscores, or hyphens only'),
  gender: z.enum(['male', 'female']),
  style: z.string().trim().min(1).max(500),
  age: z.number().int().min(12).max(120).optional(),
  occupation: z.string().trim().min(1).max(50).optional(),
  traits: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
});

export type PersonaBody = z.infer<typeof personaBody>;

// ─── Onboarding ───

export const onboardingBody = z.object({
  step: z.number().int().min(0).max(10).optional(),
  value: z.string().max(2000).optional(),
});

export type OnboardingBody = z.infer<typeof onboardingBody>;

// ─── Memory review ───

export const memoryQuery = z.object({
  q: z.string().trim().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  sessionId: z.string().trim().max(64).optional(),
});

export type MemoryQuery = z.infer<typeof memoryQuery>;

export const memoryIdParam = z.object({
  id: z.string().trim().min(1).max(80).regex(/^[a-f0-9]+$/i, 'Invalid memory id'),
});

export type MemoryIdParam = z.infer<typeof memoryIdParam>;

export const memoryPatchBody = z.object({
  type: z.enum(['fact', 'preference', 'event', 'decision', 'intention', 'emotion']).optional(),
  content: z.string().trim().min(1).max(500).optional(),
  confidence: z.number().min(0).max(1).optional(),
  enabled: z.boolean().optional(),
  reviewStatus: z.enum(['inferred', 'confirmed', 'ignored', 'wrong']).optional(),
  pinned: z.boolean().optional(),
}).refine((body) => Object.keys(body).length > 0, {
  message: 'At least one field is required',
});

export type MemoryPatchBody = z.infer<typeof memoryPatchBody>;

export const debugTraceCandidateBody = z.object({
  sessionId: z.string().trim().max(64).optional(),
  note: z.string().trim().max(1000).optional(),
  taxonomy: z.enum([
    'temporal_drift',
    'current_fact_conflict',
    'bad_proactive_or_reopened_chat_blame',
    'proactive_curiosity_hook',
    'identity_or_model_leak',
    'internal_context_leak',
    'unsupported_offline_life',
    'coercive_or_interrogative_possessiveness',
    'service_or_checklist_tone',
    'persona_coherence',
    'persona_judge_repair',
    'reply_logic_or_human_likeness',
  ]).optional(),
  confidence: z.number().min(0).max(1).optional(),
  forbiddenText: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  expectedText: z.array(z.string().trim().min(1).max(120)).max(12).optional(),
}).strict();

export type DebugTraceCandidateBody = z.infer<typeof debugTraceCandidateBody>;

export const regressionCandidatePromoteBody = z.object({
  candidatesPath: z.string().trim().min(1).max(1000),
  ids: z.array(z.string().trim().min(1).max(120)).min(1).max(20).optional(),
  taxonomy: z.string().trim().min(1).max(120).optional(),
  minConfidence: z.number().min(0).max(1).optional(),
  maxCandidates: z.number().int().min(1).max(20).optional(),
  reviewer: z.string().trim().min(1).max(80).optional(),
  note: z.string().trim().max(1000).optional(),
}).strict();

export type RegressionCandidatePromoteBody = z.infer<typeof regressionCandidatePromoteBody>;

export const regressionCandidateIdParam = z.object({
  id: z.string().trim().min(1).max(160),
});

export type RegressionCandidateIdParam = z.infer<typeof regressionCandidateIdParam>;

export const regressionCandidatePatchBody = z.object({
  enabled: z.boolean().optional(),
  reviewer: z.string().trim().min(1).max(80).optional(),
  note: z.string().trim().max(1000).optional(),
}).refine((body) => Object.keys(body).some((key) => key !== 'reviewer' && key !== 'note'), {
  message: 'At least one patch field is required',
}).strict();

export type RegressionCandidatePatchBody = z.infer<typeof regressionCandidatePatchBody>;

// ─── User profile maintenance ───

export const userProfileEntryParam = z.object({
  id: z.string().trim().regex(/^[a-f0-9]{16}$/i, 'Invalid user profile entry id'),
});

export type UserProfileEntryParam = z.infer<typeof userProfileEntryParam>;

export const userProfileEntryBody = z.object({
  content: z.string().trim().min(1).max(1000),
});

export type UserProfileEntryBody = z.infer<typeof userProfileEntryBody>;

// ─── Proactive preferences ───

export const proactivePreferencesBody = z.object({
  enabled: z.boolean().optional(),
  minIntervalMinutes: z.number().int().min(30).max(10080).optional(),
  responseThreshold: z.number().min(0).max(1).optional(),
  quietHours: z.object({
    enabled: z.boolean().optional(),
    startHour: z.number().int().min(0).max(23).optional(),
    endHour: z.number().int().min(0).max(23).optional(),
  }).strict().optional(),
});

export type ProactivePreferencesBody = z.infer<typeof proactivePreferencesBody>;

// ─── Admin ───

export const backupPruneBody = z.object({
  maxAgeDays: z.number().int().min(1).max(365).optional(),
});

export type BackupPruneBody = z.infer<typeof backupPruneBody>;

// ─── Search ───

export const searchQuery = z.object({
  q: z.string().min(1).max(500),
  session: z.string().max(64).optional(),
  role: z.enum(['user', 'assistant']).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});

export type SearchQuery = z.infer<typeof searchQuery>;

// ─── Analytics ───

export const analyticsQuery = z.object({
  days: z.coerce.number().int().min(1).max(365).optional(),
});

export type AnalyticsQuery = z.infer<typeof analyticsQuery>;

export const personaModeBody = z.object({
  mode: z.enum(['base', 'deep']),
});

export type PersonaModeBody = z.infer<typeof personaModeBody>;

const workspaceConfigId = z.string().trim().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/, 'Use letters, numbers, underscores, or hyphens only');
const workspaceConfigName = z.string().trim().min(1).max(120);
const workspaceConfigDescription = z.string().trim().max(1000).optional().default('');

const workspaceRoleConfig = z.object({
  id: workspaceConfigId,
  name: workspaceConfigName,
  description: workspaceConfigDescription,
  enabled: z.boolean().optional().default(true),
}).strict();

const workspaceSkillConfig = z.object({
  id: workspaceConfigId,
  name: workspaceConfigName,
  description: workspaceConfigDescription,
  source: z.enum(['builtin', 'external']).optional().default('external'),
  enabled: z.boolean().optional().default(false),
  status: z.enum(['ready', 'partial', 'planned']).optional().default('planned'),
}).strict();

const workspacePluginConfig = z.object({
  id: workspaceConfigId,
  name: workspaceConfigName,
  description: workspaceConfigDescription,
  builtin: z.boolean().optional().default(false),
  enabled: z.boolean().optional().default(false),
  config: z.record(z.string(), z.unknown()).optional().default({}),
}).strict();

const workspaceMcpConfig = z.object({
  id: workspaceConfigId,
  name: workspaceConfigName,
  description: workspaceConfigDescription,
  enabled: z.boolean().optional().default(false),
  command: z.string().trim().max(1000).optional(),
  url: z.string().trim().max(1000).optional(),
  tools: z.array(z.string().trim().min(1).max(120)).max(100).optional().default([]),
  status: z.enum(['configured', 'planned', 'disabled']).optional().default('planned'),
}).strict();

const workspaceChannelConfig = z.object({
  wechat: z.object({
    enabled: z.boolean().optional().default(true),
    entryUrl: z.string().trim().max(2000).optional().default(''),
    qrImageUrl: z.string().trim().max(2000).optional().default(''),
    testerCopy: z.string().trim().max(1000).optional().default(''),
  }).strict().optional(),
}).strict();

export const workspaceConfigBody = z.object({
  persona: z.object({
    activeRole: workspaceConfigId.optional(),
    mode: z.enum(['base', 'deep']).optional(),
    notes: z.string().trim().max(4000).optional(),
  }).strict().optional(),
  roles: z.array(workspaceRoleConfig).max(100).optional(),
  skills: z.array(workspaceSkillConfig).max(200).optional(),
  plugins: z.array(workspacePluginConfig).max(200).optional(),
  mcp: z.array(workspaceMcpConfig).max(100).optional(),
  channels: workspaceChannelConfig.optional(),
}).strict().refine((body) => Object.keys(body).length > 0, {
  message: 'At least one config section is required',
});

export type WorkspaceConfigBody = z.infer<typeof workspaceConfigBody>;

export const characterNameParam = z.object({
  name: z.string().trim().min(1).max(80).regex(/^[a-z0-9\p{Script=Han}-]+$/u, 'Invalid character name'),
});

export type CharacterNameParam = z.infer<typeof characterNameParam>;

export const wsClientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('chat'),
    text: z.string().min(1).max(8000),
    sessionId: z.string().max(64).optional(),
    requestId: z.string().max(96).optional(),
  }),
  z.object({
    type: z.literal('switch_mod'),
    name: z.string().min(1).max(80).regex(/^[\p{L}\p{N}_-]+$/u, 'Invalid mod name'),
  }),
  z.object({ type: z.literal('subscribe_avatar') }),
  z.object({
    type: z.literal('ping'),
    t: z.number().optional(),
  }),
  z.object({
    type: z.literal('pong'),
    t: z.number().optional(),
  }),
]);

export type WsClientMessageInput = z.infer<typeof wsClientMessageSchema>;

// ─── Middleware helper ───

import type { Request, Response, NextFunction } from 'express';

/**
 * Creates an Express middleware that validates req.body against the given schema.
 * On failure, responds with 400 and the Zod error details.
 */
export function validate<T>(schema: z.ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: result.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
      return;
    }
    req.body = result.data;
    next();
  };
}

/**
 * Creates an Express middleware that validates req.params against the given schema.
 */
export function validateParams<T>(schema: z.ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      res.status(400).json({
        success: false,
        error: 'Invalid path parameters',
        details: result.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
      return;
    }
    req.params = result.data as Record<string, string>;
    next();
  };
}

// ─── Character ───

const characterTag = z.string().trim().min(1).max(60);
const characterTagList = (max = 12) => z.array(characterTag).max(max).optional().default([]);
const characterTrajectoryEvent = z.object({
  period: z.string().trim().min(1).max(80),
  ageRange: z.string().trim().max(40).optional().default(''),
  event: z.string().trim().min(1).max(500),
  impact: z.string().trim().min(1).max(500),
}).strict();

export const characterConfigSchema = z.object({
  name: z.string().trim().min(1).max(50),
  gender: z.string().trim().min(1).max(20),
  age: z.number().int().min(12).max(120),
  occupation: z.string().trim().min(1).max(50),
  style: z.string().trim().max(100).optional().default(''),
  personality: z.object({
    openness: z.number().min(0).max(1).optional().default(0.6),
    conscientiousness: z.number().min(0).max(1).optional().default(0.5),
    extraversion: z.number().min(0).max(1).optional().default(0.5),
    agreeableness: z.number().min(0).max(1).optional().default(0.7),
    neuroticism: z.number().min(0).max(1).optional().default(0.3),
  }).optional().default({
    openness: 0.6,
    conscientiousness: 0.5,
    extraversion: 0.5,
    agreeableness: 0.7,
    neuroticism: 0.3,
  }),
  traits: characterTagList(16),
  speakingStyle: z.string().trim().max(800).optional().default(''),
  backstory: z.string().trim().max(4000).optional().default(''),
  lifeTrajectory: z.array(characterTrajectoryEvent).max(12).optional().default([]),
  currentLife: z.string().trim().max(1500).optional().default(''),
  relationshipProfile: z.string().trim().max(1500).optional().default(''),
  scenario: z.string().trim().max(1500).optional().default(''),
  firstMessage: z.string().trim().max(2000).optional().default(''),
  alternateGreetings: z.array(z.string().trim().min(1).max(2000)).max(6).optional().default([]),
  exampleDialogues: z.array(z.string().trim().min(1).max(2000)).max(8).optional().default([]),
  creatorNotes: z.string().trim().max(1500).optional().default(''),
  characterVersion: z.string().trim().max(40).optional().default('0.1.0'),
  tags: characterTagList(20),
  lifeGoals: characterTagList(12),
  interests: characterTagList(20),
  values: characterTagList(12),
  quirks: characterTagList(16),
  createdAt: z.string().datetime().optional().default(() => new Date().toISOString()),
}).strict();

export type CharacterConfigInput = z.infer<typeof characterConfigSchema>;

/**
 * Validates req.query against the given schema.
 */
export function validateQuery<T>(schema: z.ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      res.status(400).json({
        success: false,
        error: 'Invalid query parameters',
        details: result.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
      return;
    }
    // Express 5 exposes req.query through a getter; define an own property so
    // downstream handlers can keep reading coerced values from req.query.
    Object.defineProperty(req, 'query', {
      value: result.data as Record<string, string>,
      configurable: true,
      enumerable: true,
    });
    next();
  };
}
