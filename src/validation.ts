/**
 * Mio — Request validation schemas
 *
 * Runtime validation for all API inputs using Zod.
 * TypeScript types are derived from schemas — single source of truth.
 */

import { z } from 'zod';

// ─── Chat ───

export const chatBody = z.object({
  text: z.string().min(1).max(8000),
  sessionId: z.string().max(64).optional(),
  imagePath: z.string().max(512).optional(),
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
  reviewStatus: z.enum(['inferred', 'confirmed', 'ignored']).optional(),
}).refine((body) => Object.keys(body).length > 0, {
  message: 'At least one field is required',
});

export type MemoryPatchBody = z.infer<typeof memoryPatchBody>;

// ─── Proactive preferences ───

export const proactivePreferencesBody = z.object({
  enabled: z.boolean().optional(),
  minIntervalMinutes: z.number().int().min(30).max(10080).optional(),
  responseThreshold: z.number().min(0).max(1).optional(),
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

export const characterNameParam = z.object({
  name: z.string().trim().min(1).max(80).regex(/^[a-z0-9\p{Script=Han}-]+$/u, 'Invalid character name'),
});

export type CharacterNameParam = z.infer<typeof characterNameParam>;

export const wsClientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('chat'),
    text: z.string().min(1).max(8000),
    sessionId: z.string().max(64).optional(),
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

export const characterConfigSchema = z.object({
  name: z.string().min(1).max(50),
  gender: z.string().min(1).max(20),
  age: z.number().int().min(12).max(120),
  occupation: z.string().min(1).max(50),
  style: z.string().max(100).optional().default(''),
  personality: z.object({
    openness: z.number().min(0).max(1).optional().default(0.6),
    conscientiousness: z.number().min(0).max(1).optional().default(0.5),
    extraversion: z.number().min(0).max(1).optional().default(0.5),
    agreeableness: z.number().min(0).max(1).optional().default(0.7),
    neuroticism: z.number().min(0).max(1).optional().default(0.3),
  }).optional(),
  traits: z.array(z.string()).optional().default([]),
  speakingStyle: z.string().max(500).optional().default(''),
  backstory: z.string().max(3000).optional().default(''),
  lifeGoals: z.array(z.string()).optional().default([]),
  interests: z.array(z.string()).optional().default([]),
  values: z.array(z.string()).optional().default([]),
  quirks: z.array(z.string()).optional().default([]),
});

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
