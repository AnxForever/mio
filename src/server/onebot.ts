import { createHash } from 'node:crypto';
import type { TurnOutput } from '../core/agent-loop.js';
import type { OneBotEventBody, OneBotMessageSegment } from '../validation.js';

type OneBotMessageType = 'private' | 'group';
type OneBotGroupMode = 'off' | 'mention' | 'all';
type OneBotReplyMode = 'api' | 'quick' | 'both' | 'off';

const DEFAULT_ONEBOT_TIMEOUT_MS = 10_000;

export interface OneBotIncomingMessage {
  type: OneBotMessageType;
  text: string;
  sessionId: string;
  userId: string | number;
  groupId?: string | number;
  messageId?: string | number;
}

export interface OneBotSkipResult {
  ok: true;
  processed: false;
  skipped: true;
  reason: string;
}

export interface OneBotBridgeStatus {
  enabled: true;
  apiBaseConfigured: boolean;
  accessTokenConfigured: boolean;
  groupMode: OneBotGroupMode;
  replyMode: OneBotReplyMode;
  timeoutMs: number;
  ignoreSelf: boolean;
  allowUsersConfigured: boolean;
  allowUsersCount: number;
  allowGroupsConfigured: boolean;
  allowGroupsCount: number;
}

export class OneBotConfigError extends Error {
  readonly status = 503;

  constructor(message: string) {
    super(message);
    this.name = 'OneBotConfigError';
  }
}

interface OneBotSendResponse {
  status?: string;
  retcode?: number;
  msg?: string;
  wording?: string;
  data?: unknown;
}

interface OneBotConfig {
  apiBase: string | null;
  accessToken: string | null;
  groupMode: OneBotGroupMode;
  replyMode: OneBotReplyMode;
  timeoutMs: number;
  ignoreSelf: boolean;
  allowUsers: Set<string> | null;
  allowGroups: Set<string> | null;
}

export function getOneBotBridgeStatus(): OneBotBridgeStatus {
  const config = readOneBotConfig();
  return {
    enabled: true,
    apiBaseConfigured: config.apiBase !== null,
    accessTokenConfigured: config.accessToken !== null,
    groupMode: config.groupMode,
    replyMode: config.replyMode,
    timeoutMs: config.timeoutMs,
    ignoreSelf: config.ignoreSelf,
    allowUsersConfigured: config.allowUsers !== null,
    allowUsersCount: config.allowUsers?.size ?? 0,
    allowGroupsConfigured: config.allowGroups !== null,
    allowGroupsCount: config.allowGroups?.size ?? 0,
  };
}

export function extractOneBotIncomingMessage(event: OneBotEventBody): OneBotIncomingMessage | OneBotSkipResult {
  const config = readOneBotConfig();
  if (event.post_type !== 'message') {
    return skipped(`ignored_post_type:${event.post_type}`);
  }

  if (event.message_type !== 'private' && event.message_type !== 'group') {
    return skipped('unsupported_message_type');
  }

  if (event.user_id === undefined) {
    return skipped('missing_user_id');
  }

  if (config.ignoreSelf && event.self_id !== undefined && String(event.user_id) === String(event.self_id)) {
    return skipped('self_message');
  }

  if (config.allowUsers && !config.allowUsers.has(String(event.user_id))) {
    return skipped('user_not_allowed');
  }

  if (event.message_type === 'group' && event.group_id === undefined) {
    return skipped('missing_group_id');
  }

  if (event.message_type === 'group') {
    if (config.allowGroups && !config.allowGroups.has(String(event.group_id))) {
      return skipped('group_not_allowed');
    }
    if (config.groupMode === 'off') {
      return skipped('group_messages_disabled');
    }
    if (config.groupMode === 'mention' && !isMentioningSelf(event)) {
      return skipped('group_message_not_mentioned');
    }
  }

  const text = extractOneBotText(event);
  if (!text) {
    return skipped('empty_text');
  }

  return {
    type: event.message_type,
    text,
    sessionId: buildOneBotSessionId(event),
    userId: event.user_id,
    groupId: event.group_id,
    messageId: event.message_id,
  };
}

export async function dispatchOneBotReply(
  incoming: OneBotIncomingMessage,
  result: TurnOutput,
): Promise<Record<string, unknown>> {
  const config = readOneBotConfig();
  const replyText = result.text.trim();

  if (!replyText || result.ghosted) {
    return {
      ok: true,
      processed: true,
      sessionId: result.sessionId,
      replyMode: 'off',
      sent: false,
      ghosted: result.ghosted === true,
    };
  }

  if (config.replyMode === 'off') {
    return {
      ok: true,
      processed: true,
      sessionId: result.sessionId,
      replyMode: 'off',
      sent: false,
    };
  }

  if ((config.replyMode === 'api' || config.replyMode === 'both') && !config.apiBase) {
    throw new OneBotConfigError(
      'MIO_ONEBOT_API_BASE is required when MIO_ONEBOT_REPLY_MODE is api or both',
    );
  }

  if (config.replyMode === 'api' || config.replyMode === 'both') {
    const sendResult = await sendOneBotMessage(config, incoming, replyText);
    if (config.replyMode === 'api') {
      return {
        ok: true,
        processed: true,
        sessionId: result.sessionId,
        replyMode: 'api',
        sent: true,
        onebot: sendResult,
      };
    }
    return {
      ok: true,
      processed: true,
      sessionId: result.sessionId,
      replyMode: 'both',
      sent: true,
      reply: replyText,
      auto_escape: false,
      onebot: sendResult,
    };
  }

  return {
    ok: true,
    processed: true,
    sessionId: result.sessionId,
    replyMode: 'quick',
    sent: false,
    reply: replyText,
    auto_escape: false,
  };
}

function readOneBotConfig(): OneBotConfig {
  const apiBase = firstCleanEnv(process.env.MIO_ONEBOT_API_BASE, process.env.ONEBOT_API_BASE);
  const accessToken = firstCleanEnv(process.env.MIO_ONEBOT_ACCESS_TOKEN, process.env.ONEBOT_ACCESS_TOKEN);
  const groupMode = parseGroupMode(process.env.MIO_ONEBOT_GROUP_MODE);
  const explicitReplyMode = parseReplyMode(process.env.MIO_ONEBOT_REPLY_MODE);
  const replyMode = explicitReplyMode ?? (apiBase ? 'api' : 'quick');
  const timeoutMs = parseTimeoutMs(process.env.MIO_ONEBOT_TIMEOUT_MS);
  const ignoreSelf = parseBoolean(process.env.MIO_ONEBOT_IGNORE_SELF, true);
  const allowUsers = parseIdSet(firstCleanEnv(process.env.MIO_ONEBOT_ALLOW_USERS, process.env.MIO_ONEBOT_ALLOWED_USERS));
  const allowGroups = parseIdSet(firstCleanEnv(process.env.MIO_ONEBOT_ALLOW_GROUPS, process.env.MIO_ONEBOT_ALLOWED_GROUPS));
  return {
    apiBase,
    accessToken,
    groupMode,
    replyMode,
    timeoutMs,
    ignoreSelf,
    allowUsers,
    allowGroups,
  };
}

function parseGroupMode(raw: string | undefined): OneBotGroupMode {
  if (raw === 'off' || raw === 'all' || raw === 'mention') return raw;
  return 'mention';
}

function parseReplyMode(raw: string | undefined): OneBotReplyMode | null {
  if (raw === 'api' || raw === 'quick' || raw === 'both' || raw === 'off') return raw;
  return null;
}

function parseTimeoutMs(raw: string | undefined): number {
  if (!raw) return DEFAULT_ONEBOT_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_ONEBOT_TIMEOUT_MS;
  return Math.max(500, Math.min(60_000, Math.floor(parsed)));
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseIdSet(raw: string | null | undefined): Set<string> | null {
  const trimmed = raw?.trim();
  if (!trimmed || trimmed === '*') return null;

  const ids = trimmed
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return ids.length > 0 ? new Set(ids) : null;
}

function cleanEnv(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function firstCleanEnv(...values: Array<string | undefined>): string | null {
  for (const value of values) {
    const cleaned = cleanEnv(value);
    if (cleaned !== null) return cleaned;
  }
  return null;
}

function skipped(reason: string): OneBotSkipResult {
  return { ok: true, processed: false, skipped: true, reason };
}

function extractOneBotText(event: OneBotEventBody): string {
  const raw = event.raw_message ?? messageToText(event.message);
  return normalizeMessageText(stripCQCodes(decodeCQText(raw)));
}

function messageToText(message: OneBotEventBody['message']): string {
  if (typeof message === 'string') return message;
  if (!Array.isArray(message)) return '';

  return message
    .map((segment) => {
      if (segment.type !== 'text') return '';
      const text = segment.data?.text;
      return typeof text === 'string' ? text : '';
    })
    .join('');
}

function isMentioningSelf(event: OneBotEventBody): boolean {
  if (event.self_id === undefined) return false;
  const selfId = String(event.self_id);

  if (Array.isArray(event.message)) {
    return event.message.some((segment) => segmentMentionsSelf(segment, selfId));
  }

  const raw = event.raw_message ?? (typeof event.message === 'string' ? event.message : '');
  if (!raw) return false;
  const pattern = new RegExp(`\\[CQ:at,qq=${escapeRegExp(selfId)}(?:,|\\])`);
  return pattern.test(raw);
}

function segmentMentionsSelf(segment: OneBotMessageSegment, selfId: string): boolean {
  if (segment.type !== 'at') return false;
  const qq = segment.data?.qq;
  return qq !== undefined && String(qq) === selfId;
}

function buildOneBotSessionId(event: OneBotEventBody): string {
  if (event.message_type === 'private') {
    return `onebot-private-${safeSessionPart(event.user_id)}`.slice(0, 64);
  }

  return `onebot-group-${safeSessionPart(event.group_id)}-${safeSessionPart(event.user_id)}`.slice(0, 64);
}

function safeSessionPart(value: string | number | undefined): string {
  const raw = String(value ?? 'unknown');
  const safe = raw
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 18);
  const hash = createHash('sha256').update(raw).digest('hex').slice(0, 8);
  return safe ? `${safe}-${hash}` : hash;
}

function decodeCQText(text: string): string {
  return text
    .replace(/&#91;/g, '[')
    .replace(/&#93;/g, ']')
    .replace(/&#44;/g, ',')
    .replace(/&amp;/g, '&');
}

function stripCQCodes(text: string): string {
  return text.replace(/\[CQ:[^\]]+\]/g, ' ');
}

function normalizeMessageText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

async function sendOneBotMessage(
  config: OneBotConfig,
  incoming: OneBotIncomingMessage,
  message: string,
): Promise<OneBotSendResponse> {
  if (!config.apiBase) {
    throw new Error('MIO_ONEBOT_API_BASE is not configured');
  }

  const endpoint = incoming.type === 'private' ? 'send_private_msg' : 'send_group_msg';
  const payload = incoming.type === 'private'
    ? { user_id: incoming.userId, message, auto_escape: false }
    : { group_id: incoming.groupId, message, auto_escape: false };

  let response: Response;
  try {
    response = await fetch(`${trimTrailingSlash(config.apiBase)}/${endpoint}`, {
      method: 'POST',
      signal: AbortSignal.timeout(config.timeoutMs),
      headers: {
        'Content-Type': 'application/json',
        ...(config.accessToken ? { Authorization: `Bearer ${config.accessToken}` } : {}),
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`OneBot send failed: ${detail}`);
  }

  const body = await readOneBotResponse(response);
  if (!response.ok || body.status === 'failed' || (typeof body.retcode === 'number' && body.retcode !== 0)) {
    const detail = body.wording ?? body.msg ?? response.statusText;
    throw new Error(`OneBot send failed: ${detail}`);
  }

  return body;
}

async function readOneBotResponse(response: Response): Promise<OneBotSendResponse> {
  try {
    return (await response.json()) as OneBotSendResponse;
  } catch {
    return { retcode: response.ok ? 0 : response.status, msg: response.statusText };
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
