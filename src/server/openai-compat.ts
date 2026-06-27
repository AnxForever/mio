import { createHash, randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { getConfig } from '../config.js';
import type { TurnOutput } from '../core/agent-loop.js';
import type { OpenAIChatCompletionsBody, OpenAIChatMessage } from '../validation.js';

const DEFAULT_MODEL_ID = 'mio';
const FALLBACK_SESSION_ID = 'openai-bridge';
const SESSION_HEADER_NAMES = [
  'x-mio-session-id',
  'x-openai-session-id',
  'x-openclaw-session-id',
  'x-openclaw-user-id',
  'x-wechat-user-id',
  'x-onebot-user-id',
];
const METADATA_SESSION_KEYS = [
  'sessionId',
  'session_id',
  'mioSessionId',
  'mio_session_id',
  'conversationId',
  'conversation_id',
  'conversation.id',
  'threadId',
  'thread_id',
  'thread.id',
  'chatId',
  'chat_id',
  'chat.id',
  'senderId',
  'sender_id',
  'sender.id',
  'fromUserName',
  'from_user_name',
];

export class OpenAICompatError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = 'OpenAICompatError';
  }
}

export interface OpenAIStreamContext {
  id: string;
  created: number;
  model: string;
}

export function buildOpenAIModelsResponse(): Record<string, unknown> {
  const config = getConfig();
  return {
    object: 'list',
    data: [
      {
        id: DEFAULT_MODEL_ID,
        object: 'model',
        created: 0,
        owned_by: 'mio',
      },
      {
        id: `mio-${config.provider}`,
        object: 'model',
        created: 0,
        owned_by: 'mio',
      },
    ],
  };
}

export function buildOpenAIErrorResponse(
  message: string,
  type = 'invalid_request_error',
  code?: string,
): Record<string, unknown> {
  return {
    error: {
      message,
      type,
      ...(code ? { code } : {}),
    },
  };
}

export function extractOpenAIUserText(body: OpenAIChatCompletionsBody): string {
  const userTexts = body.messages
    .filter((message) => message.role === 'user')
    .map((message) => extractMessageText(message))
    .filter((text) => text.length > 0);

  const text = userTexts.at(-1);
  if (!text) {
    throw new OpenAICompatError('No non-empty user text message found');
  }
  if (text.length > 8000) {
    throw new OpenAICompatError('Input too long. Maximum 8000 characters.', 413);
  }
  return text;
}

export function resolveOpenAISessionId(body: OpenAIChatCompletionsBody, req: Request): string {
  const explicit = findOpenAISessionHint(body, req);
  if (explicit) return normalizeSessionId(explicit);

  if (isStrictSessionRequired()) {
    throw new OpenAICompatError(
      'Missing stable session id. Set X-Mio-Session-Id, X-OpenClaw-User-Id, user, or metadata.conversation.id.',
    );
  }

  return FALLBACK_SESSION_ID;
}

function findOpenAISessionHint(body: OpenAIChatCompletionsBody, req: Request): string | null {
  for (const name of SESSION_HEADER_NAMES) {
    const header = firstHeaderValue(req.headers[name]);
    if (header?.trim()) return header;
  }

  for (const key of METADATA_SESSION_KEYS) {
    const value = readMetadataValue(body.metadata, key);
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }

  if (body.user?.trim()) {
    return body.user;
  }

  return null;
}

function isStrictSessionRequired(): boolean {
  const raw = process.env.MIO_OPENAI_REQUIRE_SESSION?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

export function buildOpenAICompletionResponse(
  body: OpenAIChatCompletionsBody,
  result: TurnOutput,
): Record<string, unknown> {
  const created = unixNow();
  const content = result.text ?? '';
  return {
    id: completionId(),
    object: 'chat.completion',
    created,
    model: body.model || DEFAULT_MODEL_ID,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content,
        },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: estimateTokens(extractOpenAIUserText(body)),
      completion_tokens: estimateTokens(content),
      total_tokens: estimateTokens(extractOpenAIUserText(body)) + estimateTokens(content),
    },
  };
}

export function createOpenAIStreamContext(body: OpenAIChatCompletionsBody): OpenAIStreamContext {
  return {
    id: completionId(),
    created: unixNow(),
    model: body.model || DEFAULT_MODEL_ID,
  };
}

export function writeOpenAIStreamStart(res: Response, ctx: OpenAIStreamContext): void {
  writeSseData(res, {
    id: ctx.id,
    object: 'chat.completion.chunk',
    created: ctx.created,
    model: ctx.model,
    choices: [
      {
        index: 0,
        delta: { role: 'assistant' },
        finish_reason: null,
      },
    ],
  });
}

export function writeOpenAIStreamToken(
  res: Response,
  ctx: OpenAIStreamContext,
  content: string,
): void {
  if (!content) return;
  writeSseData(res, {
    id: ctx.id,
    object: 'chat.completion.chunk',
    created: ctx.created,
    model: ctx.model,
    choices: [
      {
        index: 0,
        delta: { content },
        finish_reason: null,
      },
    ],
  });
}

export function writeOpenAIStreamDone(res: Response, ctx: OpenAIStreamContext): void {
  writeSseData(res, {
    id: ctx.id,
    object: 'chat.completion.chunk',
    created: ctx.created,
    model: ctx.model,
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: 'stop',
      },
    ],
  });
  writeRawSse(res, 'data: [DONE]\n\n');
}

export function writeOpenAIStreamError(res: Response, message: string): void {
  writeSseData(res, {
    error: {
      message,
      type: 'server_error',
    },
  });
  writeRawSse(res, 'data: [DONE]\n\n');
}

function extractMessageText(message: OpenAIChatMessage): string {
  const content = message.content;
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';

  return content
    .map((part) => {
      if (typeof part.text === 'string') return part.text;
      if (typeof part.input_text === 'string') return part.input_text;
      return '';
    })
    .filter((text) => text.trim().length > 0)
    .join('\n')
    .trim();
}

function normalizeSessionId(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return FALLBACK_SESSION_ID;

  const safe = trimmed
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  const hash = createHash('sha256').update(trimmed).digest('hex').slice(0, 12);
  const core = safe.length > 0 ? `${safe}-${hash}` : hash;
  return `openai-${core}`.slice(0, 64);
}

function readMetadataValue(metadata: OpenAIChatCompletionsBody['metadata'], dottedKey: string): unknown {
  if (!metadata) return undefined;
  if (Object.prototype.hasOwnProperty.call(metadata, dottedKey)) return metadata[dottedKey];
  if (!dottedKey.includes('.')) return undefined;

  let current: unknown = metadata;
  for (const part of dottedKey.split('.')) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function firstHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function completionId(): string {
  return `chatcmpl-mio-${randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}

function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil([...text].length / 2));
}

function writeSseData(res: Response, data: unknown): void {
  writeRawSse(res, `data: ${JSON.stringify(data)}\n\n`);
}

function writeRawSse(res: Response, data: string): void {
  if (res.writableEnded || res.destroyed) return;
  res.write(data);
}
