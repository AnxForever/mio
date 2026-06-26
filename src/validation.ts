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

// ─── Mod switch ───

export const modBody = z.object({
  name: z.enum(['male', 'female']),
});

export type ModBody = z.infer<typeof modBody>;

// ─── Persona generation ───

export const personaBody = z.object({
  gender: z.enum(['male', 'female']).optional(),
  userMessage: z.string().max(4000).optional(),
  context: z.string().max(2000).optional(),
});

export type PersonaBody = z.infer<typeof personaBody>;

// ─── Onboarding ───

export const onboardingBody = z.object({
  step: z.number().int().min(0).max(10).optional(),
  value: z.string().max(2000).optional(),
});

export type OnboardingBody = z.infer<typeof onboardingBody>;

// ─── Admin ───

export const backupPruneBody = z.object({
  maxAgeDays: z.number().int().min(1).max(365).optional(),
});

export type BackupPruneBody = z.infer<typeof backupPruneBody>;

// ─── Search ───

export const searchQuery = z.object({
  q: z.string().min(1).max(500),
  session: z.string().max(64).optional(),
  role: z.enum(['user', 'agent', 'system']).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});

export type SearchQuery = z.infer<typeof searchQuery>;

// ─── Analytics ───

export const analyticsQuery = z.object({
  days: z.coerce.number().int().min(1).max(365).optional(),
});

export type AnalyticsQuery = z.infer<typeof analyticsQuery>;

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
    // Replace query with parsed values (handles coercion)
    req.query = result.data as Record<string, string>;
    next();
  };
}
