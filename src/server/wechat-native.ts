import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync, chmodSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import QRCode from 'qrcode';
import { runTurn } from '../core/agent-loop.js';
import { getConfig } from '../config.js';
import {
  wechatNativeAccountDir,
  wechatNativeAccountPath,
  wechatNativeAccountsDir,
  wechatNativeContextPath,
  wechatNativeEventsPath,
  wechatNativeRuntimeLockPath,
  wechatNativeSettingsPath,
  wechatNativeSyncPath,
  wechatNativeUsagePath,
} from '../memory/paths.js';
import { upsertWeClawTarget } from '../memory/persona-delta.js';
import { logger } from '../utils/logger.js';
import { readLastCompanionGateStatus } from './companion-gate.js';
import { planPacing, sleep } from './im-pacing.js';

type LoginStatus =
  | 'wait'
  | 'scaned'
  | 'confirmed'
  | 'expired'
  | 'scaned_but_redirect'
  | 'need_verifycode'
  | 'verify_code_blocked'
  | 'binded_redirect'
  | 'error';

type WechatMessageItem = {
  type?: number;
  text_item?: { text?: string };
  voice_item?: { text?: string };
  ref_msg?: {
    title?: string;
    message_item?: WechatMessageItem;
  };
};

type WechatMessage = {
  seq?: number;
  message_id?: number | string;
  from_user_id?: string;
  to_user_id?: string;
  client_id?: string;
  create_time_ms?: number;
  session_id?: string;
  message_type?: number;
  item_list?: WechatMessageItem[];
  context_token?: string;
};

type GetUpdatesResponse = {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  msgs?: WechatMessage[];
  get_updates_buf?: string;
  longpolling_timeout_ms?: number;
};

type QrResponse = {
  qrcode?: string;
  qrcode_img_content?: string;
};

type QrStatusResponse = {
  status?: LoginStatus;
  bot_token?: string;
  ilink_bot_id?: string;
  baseurl?: string;
  ilink_user_id?: string;
  redirect_host?: string;
  errmsg?: string;
};

type WechatNativeAccountFile = {
  accountId: string;
  token: string;
  baseUrl: string;
  userId?: string;
  savedAt: string;
  disabled?: boolean;
};

type WechatNativeAccessMode = 'open' | 'allowlist';

export type WechatNativeSettings = {
  accessMode: WechatNativeAccessMode;
  allowedUsers: string[];
  dailyLimitPerUser: number;
  unknownUserReply: string;
  quotaExceededReply: string;
  updatedAt?: string;
};

type WechatNativeUsageFile = {
  day: string;
  contacts: Record<string, number>;
};

export type WechatNativeEvent = {
  id: string;
  type: string;
  timestamp: string;
  accountId?: string;
  userId?: string;
  sessionId?: string;
  detail?: string;
};

export type WechatNativeAccountSummary = {
  accountId: string;
  baseUrl: string;
  userId?: string;
  savedAt: string;
  disabled: boolean;
  running: boolean;
  needsRelogin: boolean;
  lastInboundAt?: string;
  lastOutboundAt?: string;
  lastError?: string | null;
};

type ActiveLogin = {
  sessionKey: string;
  qrcode: string;
  qrcodeUrl: string;
  qrImageDataUrl: string;
  startedAt: number;
  expiresAt: number;
  status: LoginStatus;
  message: string;
  currentApiBaseUrl: string;
  pendingVerifyCode?: string;
};

type AccountRuntime = {
  accountId: string;
  controller: AbortController;
  running: boolean;
  startedAt: number;
  lastInboundAt?: number;
  lastOutboundAt?: number;
  lastError?: string | null;
  processed: Map<string, number>;
  lock?: WechatNativeRuntimeLock;
};

type WechatNativeRuntimeLock = {
  path: string;
  token: string;
};

type WechatNativeRuntimeLockFile = {
  accountId?: string;
  pid?: number;
  token?: string;
  acquiredAt?: string;
  command?: string;
};

const DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com';
const CDN_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c';
const DEFAULT_BOT_TYPE = process.env.MIO_WECHAT_NATIVE_BOT_TYPE || '3';
const QR_LOGIN_TTL_MS = 5 * 60_000;
const QR_POLL_TIMEOUT_MS = 25_000;
const GET_UPDATES_TIMEOUT_MS = 38_000;
const API_TIMEOUT_MS = 15_000;
const MESSAGE_TEXT = 1;
const MESSAGE_VOICE = 3;
const MESSAGE_TYPE_USER = 1;
const MESSAGE_TYPE_BOT = 2;
const MESSAGE_STATE_FINISH = 2;
const CHANNEL_VERSION = '0.6.0';
const ILINK_APP_ID = 'bot';
const ILINK_APP_CLIENT_VERSION = buildClientVersion(CHANNEL_VERSION);
const DEFAULT_SETTINGS: WechatNativeSettings = {
  accessMode: 'open',
  allowedUsers: [],
  dailyLimitPerUser: 0,
  unknownUserReply: 'Mio 现在是内测白名单模式，请联系管理员开通试用。',
  quotaExceededReply: '今天的微信试用次数已经用完，明天再来找我。',
};

const activeLogins = new Map<string, ActiveLogin>();
const runtimes = new Map<string, AccountRuntime>();
const contextTokenStore = new Map<string, string>();

function isNativeWechatEnabled(): boolean {
  return !/^(0|false|off|no)$/i.test(process.env.MIO_WECHAT_NATIVE_ENABLED || 'true');
}

function buildClientVersion(version: string): number {
  const [major = 0, minor = 0, patch = 0] = version.split('.').map((part) => Number.parseInt(part, 10) || 0);
  return ((major & 0xff) << 16) | ((minor & 0xff) << 8) | (patch & 0xff);
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

function safeId(raw: string): string {
  const safe = raw
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return safe || createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

function safeSessionPart(raw: string): string {
  const safe = raw
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 18);
  const hash = createHash('sha256').update(raw).digest('hex').slice(0, 8);
  return safe ? `${safe}-${hash}` : hash;
}

function buildWechatSessionId(accountId: string, peerId: string): string {
  return `wechat-native-${safeSessionPart(accountId)}-${safeSessionPart(peerId)}`.slice(0, 96);
}

function contextKey(accountId: string, peerId: string): string {
  return `${accountId}:${peerId}`;
}

function readJson<T>(path: string, fallback: T): T {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

function writeJson(path: string, value: unknown, mode?: number): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
  if (mode) {
    try {
      // Best effort on Windows/WSL shared drives.
      chmodSync(path, mode);
    } catch {
      // ignore
    }
  }
}

function uniqueCleanList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  for (const value of values) {
    const item = String(value || '').trim();
    if (!item) continue;
    seen.add(item);
  }
  return [...seen].slice(0, 1000);
}

function readSettings(): WechatNativeSettings {
  const raw = readJson<Partial<WechatNativeSettings>>(wechatNativeSettingsPath(), {});
  const accessMode: WechatNativeAccessMode = raw.accessMode === 'allowlist' ? 'allowlist' : 'open';
  const dailyLimitPerUser = Number.isInteger(raw.dailyLimitPerUser)
    ? Math.max(0, Math.min(500, raw.dailyLimitPerUser || 0))
    : DEFAULT_SETTINGS.dailyLimitPerUser;
  return {
    accessMode,
    allowedUsers: uniqueCleanList(raw.allowedUsers),
    dailyLimitPerUser,
    unknownUserReply: typeof raw.unknownUserReply === 'string' && raw.unknownUserReply.trim()
      ? raw.unknownUserReply.trim()
      : DEFAULT_SETTINGS.unknownUserReply,
    quotaExceededReply: typeof raw.quotaExceededReply === 'string' && raw.quotaExceededReply.trim()
      ? raw.quotaExceededReply.trim()
      : DEFAULT_SETTINGS.quotaExceededReply,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : undefined,
  };
}

function writeSettings(settings: WechatNativeSettings): void {
  writeJson(wechatNativeSettingsPath(), settings, 0o600);
}

function appendWechatEvent(event: Omit<WechatNativeEvent, 'id' | 'timestamp'>): void {
  try {
    const path = wechatNativeEventsPath();
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      ...event,
    })}\n`, 'utf-8');
  } catch (err) {
    logger.debug('[wechat-native] failed to append event', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function readRecentWechatEvents(limit = 24): WechatNativeEvent[] {
  try {
    const path = wechatNativeEventsPath();
    if (!existsSync(path)) return [];
    return readFileSync(path, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .slice(-Math.max(1, Math.min(100, limit)))
      .reverse()
      .map((line) => JSON.parse(line) as WechatNativeEvent)
      .filter((event) => event && typeof event.id === 'string');
  } catch {
    return [];
  }
}

function dayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function readUsage(accountId: string): WechatNativeUsageFile {
  const today = dayKey();
  const usage = readJson<WechatNativeUsageFile>(wechatNativeUsagePath(accountId), { day: today, contacts: {} });
  if (usage.day !== today || !usage.contacts || typeof usage.contacts !== 'object') {
    return { day: today, contacts: {} };
  }
  return usage;
}

function writeUsage(accountId: string, usage: WechatNativeUsageFile): void {
  writeJson(wechatNativeUsagePath(accountId), usage, 0o600);
}

function checkAccessGate(accountId: string, userId: string): { ok: true } | { ok: false; type: 'blocked' | 'quota-exceeded'; reply: string; detail: string } {
  const settings = readSettings();
  const normalizedUser = userId.trim();

  if (settings.accessMode === 'allowlist' && !settings.allowedUsers.includes(normalizedUser)) {
    return {
      ok: false,
      type: 'blocked',
      reply: settings.unknownUserReply,
      detail: 'not in allowlist',
    };
  }

  if (settings.dailyLimitPerUser > 0) {
    const usage = readUsage(accountId);
    const used = usage.contacts[normalizedUser] || 0;
    if (used >= settings.dailyLimitPerUser) {
      return {
        ok: false,
        type: 'quota-exceeded',
        reply: settings.quotaExceededReply,
        detail: `${used}/${settings.dailyLimitPerUser} daily messages used`,
      };
    }
  }

  return { ok: true };
}

function recordAcceptedUsage(accountId: string, userId: string): void {
  const settings = readSettings();
  if (settings.dailyLimitPerUser <= 0) return;
  const usage = readUsage(accountId);
  const normalizedUser = userId.trim();
  usage.contacts[normalizedUser] = (usage.contacts[normalizedUser] || 0) + 1;
  writeUsage(accountId, usage);
}

function randomWechatUin(): string {
  const uint32 = randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), 'utf-8').toString('base64');
}

function baseInfo(): Record<string, string> {
  return {
    channel_version: CHANNEL_VERSION,
    bot_agent: 'Mio/0.6.0',
  };
}

function commonHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    AuthorizationType: 'ilink_bot_token',
    'X-WECHAT-UIN': randomWechatUin(),
    'iLink-App-Id': ILINK_APP_ID,
    'iLink-App-ClientVersion': String(ILINK_APP_CLIENT_VERSION),
  };
  if (token?.trim()) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }
  return headers;
}

async function requestText(params: {
  method: 'GET' | 'POST';
  baseUrl: string;
  endpoint: string;
  body?: unknown;
  token?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<string> {
  const url = new URL(params.endpoint, ensureTrailingSlash(params.baseUrl));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs ?? API_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  params.signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const res = await fetch(url, {
      method: params.method,
      headers: commonHeaders(params.token),
      body: params.body === undefined ? undefined : JSON.stringify(params.body),
      signal: controller.signal,
    });
    const raw = await res.text();
    if (!res.ok) {
      throw new Error(`${params.method} ${url.pathname} ${res.status}: ${raw.slice(0, 240)}`);
    }
    return raw;
  } finally {
    clearTimeout(timeout);
    params.signal?.removeEventListener('abort', onAbort);
  }
}

async function postJson<T>(params: {
  baseUrl: string;
  endpoint: string;
  body?: unknown;
  token?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<T> {
  const raw = await requestText({ method: 'POST', ...params });
  return JSON.parse(raw) as T;
}

async function getJson<T>(params: {
  baseUrl: string;
  endpoint: string;
  timeoutMs?: number;
}): Promise<T> {
  const raw = await requestText({ method: 'GET', ...params });
  return JSON.parse(raw) as T;
}

function readAccount(accountId: string): WechatNativeAccountFile | null {
  const path = wechatNativeAccountPath(accountId);
  const account = readJson<WechatNativeAccountFile | null>(path, null);
  if (!account?.token?.trim()) return null;
  return {
    ...account,
    accountId: account.accountId || accountId,
    baseUrl: account.baseUrl || DEFAULT_BASE_URL,
  };
}

function listAccountIds(): string[] {
  try {
    if (!existsSync(wechatNativeAccountsDir())) return [];
    return readdirSync(wechatNativeAccountsDir(), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function listAccounts(): WechatNativeAccountFile[] {
  return listAccountIds()
    .map((id) => readAccount(id))
    .filter((account): account is WechatNativeAccountFile => account !== null);
}

function saveAccount(rawAccountId: string, update: {
  token: string;
  baseUrl?: string;
  userId?: string;
}): WechatNativeAccountFile {
  const accountId = safeId(rawAccountId);
  const existing = readAccount(accountId);
  const account: WechatNativeAccountFile = {
    accountId,
    token: update.token.trim(),
    baseUrl: update.baseUrl?.trim() || existing?.baseUrl || DEFAULT_BASE_URL,
    savedAt: new Date().toISOString(),
    disabled: existing?.disabled === true,
    ...(update.userId?.trim() ? { userId: update.userId.trim() } : existing?.userId ? { userId: existing.userId } : {}),
  };
  writeJson(wechatNativeAccountPath(accountId), account, 0o600);
  return account;
}

function deleteAccount(accountId: string): boolean {
  const safe = safeId(accountId);
  stopAccountRuntime(safe);
  const dir = wechatNativeAccountDir(safe);
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  appendWechatEvent({ type: 'account-removed', accountId: safe });
  return true;
}

function localTokenList(): string[] {
  return listAccounts()
    .slice(-10)
    .reverse()
    .map((account) => account.token)
    .filter(Boolean);
}

function purgeExpiredLogins(): void {
  const now = Date.now();
  for (const [key, login] of activeLogins) {
    if (login.expiresAt <= now) {
      activeLogins.delete(key);
    }
  }
}

function publicRuntime(accountId: string): Pick<AccountRuntime, 'running' | 'lastInboundAt' | 'lastOutboundAt' | 'lastError'> {
  const runtime = runtimes.get(accountId);
  return {
    running: runtime?.running === true,
    lastInboundAt: runtime?.lastInboundAt,
    lastOutboundAt: runtime?.lastOutboundAt,
    lastError: runtime?.lastError ?? null,
  };
}

function needsRelogin(lastError?: string | null): boolean {
  if (!lastError) return false;
  return /(?:errcode=-14|token|auth|unauthorized|expired|invalid)/i.test(lastError);
}

function summarizeAccount(account: WechatNativeAccountFile): WechatNativeAccountSummary {
  const runtime = publicRuntime(account.accountId);
  return {
    accountId: account.accountId,
    baseUrl: account.baseUrl,
    userId: account.userId,
    savedAt: account.savedAt,
    disabled: account.disabled === true,
    running: runtime.running,
    needsRelogin: needsRelogin(runtime.lastError),
    lastInboundAt: runtime.lastInboundAt ? new Date(runtime.lastInboundAt).toISOString() : undefined,
    lastOutboundAt: runtime.lastOutboundAt ? new Date(runtime.lastOutboundAt).toISOString() : undefined,
    lastError: runtime.lastError,
  };
}

function summarizeLogin(login: ActiveLogin | undefined): Record<string, unknown> {
  if (!login) {
    return { active: false };
  }
  return {
    active: true,
    sessionKey: login.sessionKey,
    qrcodeUrl: login.qrcodeUrl,
    qrImageDataUrl: login.qrImageDataUrl,
    status: login.status,
    message: login.message,
    startedAt: new Date(login.startedAt).toISOString(),
    expiresAt: new Date(login.expiresAt).toISOString(),
    needsVerifyCode: login.status === 'need_verifycode',
  };
}

export function getWechatNativeStatus(): Record<string, unknown> {
  purgeExpiredLogins();
  const settings = readSettings();
  const accounts = listAccounts().map(summarizeAccount);
  const activeLogin = [...activeLogins.values()].sort((a, b) => b.startedAt - a.startedAt)[0];
  const runningCount = accounts.filter((account) => account.running).length;

  return {
    enabled: isNativeWechatEnabled(),
    mode: 'native-ilink',
    transport: {
      inbound: 'iLink getUpdates long-poll',
      outbound: 'iLink sendMessage',
      publicWebhookRequired: false,
      baseUrl: DEFAULT_BASE_URL,
      cdnBaseUrl: CDN_BASE_URL,
    },
    runtime: {
      running: runningCount > 0,
      runningCount,
      accountCount: accounts.length,
    },
    settings: {
      ...settings,
      allowUsersConfigured: settings.allowedUsers.length > 0,
      allowUsersCount: settings.allowedUsers.length,
    },
    login: summarizeLogin(activeLogin),
    accounts,
    companionGate: readLastCompanionGateStatus(),
    recentEvents: readRecentWechatEvents(),
    testerFlow: [
      '在这里生成微信连接二维码并扫码授权',
      'Mio 保存 iLink bot 身份并开始长轮询',
      '试用者在微信里找到这个 bot 后直接发消息',
      'Mio 按微信联系人生成独立会话和记忆边界',
    ],
    limitations: [
      '当前内置通道先支持私聊文本和微信语音转文字',
      '图片、文件和群聊策略会作为下一阶段补齐',
    ],
  };
}

export function updateWechatNativeSettings(patch: Partial<WechatNativeSettings>): Record<string, unknown> {
  const current = readSettings();
  const next: WechatNativeSettings = {
    ...current,
    ...(patch.accessMode ? { accessMode: patch.accessMode } : {}),
    ...(patch.allowedUsers ? { allowedUsers: uniqueCleanList(patch.allowedUsers) } : {}),
    ...(typeof patch.dailyLimitPerUser === 'number'
      ? { dailyLimitPerUser: Math.max(0, Math.min(500, Math.trunc(patch.dailyLimitPerUser))) }
      : {}),
    ...(typeof patch.unknownUserReply === 'string'
      ? { unknownUserReply: patch.unknownUserReply.trim() || DEFAULT_SETTINGS.unknownUserReply }
      : {}),
    ...(typeof patch.quotaExceededReply === 'string'
      ? { quotaExceededReply: patch.quotaExceededReply.trim() || DEFAULT_SETTINGS.quotaExceededReply }
      : {}),
    updatedAt: new Date().toISOString(),
  };
  writeSettings(next);
  appendWechatEvent({
    type: 'settings-updated',
    detail: `${next.accessMode}, dailyLimit=${next.dailyLimitPerUser}, allowed=${next.allowedUsers.length}`,
  });
  return getWechatNativeStatus();
}

export async function startWechatNativeLogin(force = false): Promise<Record<string, unknown>> {
  if (!isNativeWechatEnabled()) {
    throw new Error('Native WeChat channel is disabled by MIO_WECHAT_NATIVE_ENABLED=false');
  }

  purgeExpiredLogins();
  const existing = [...activeLogins.values()].find((login) => login.expiresAt > Date.now());
  if (existing && !force) {
    return { ok: true, login: summarizeLogin(existing) };
  }

  const sessionKey = randomUUID();
  const qr = await postJson<QrResponse>({
    baseUrl: DEFAULT_BASE_URL,
    endpoint: `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(DEFAULT_BOT_TYPE)}`,
    body: { local_token_list: localTokenList() },
    timeoutMs: API_TIMEOUT_MS,
  });

  if (!qr.qrcode || !qr.qrcode_img_content) {
    throw new Error('微信没有返回可用二维码，请稍后再试');
  }

  const qrImageDataUrl = await QRCode.toDataURL(qr.qrcode_img_content, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 520,
  });

  const now = Date.now();
  const login: ActiveLogin = {
    sessionKey,
    qrcode: qr.qrcode,
    qrcodeUrl: qr.qrcode_img_content,
    qrImageDataUrl,
    startedAt: now,
    expiresAt: now + QR_LOGIN_TTL_MS,
    status: 'wait',
    message: '请用手机微信扫描二维码并确认连接。',
    currentApiBaseUrl: DEFAULT_BASE_URL,
  };
  activeLogins.set(sessionKey, login);
  logger.info('[wechat-native] QR login started', { sessionKey });
  appendWechatEvent({ type: 'login-started', detail: 'QR code generated' });

  return { ok: true, login: summarizeLogin(login) };
}

export async function pollWechatNativeLogin(params: {
  sessionKey: string;
  verifyCode?: string;
}): Promise<Record<string, unknown>> {
  purgeExpiredLogins();
  const login = activeLogins.get(params.sessionKey);
  if (!login) {
    return { ok: false, login: { active: false }, message: '当前没有进行中的微信连接，请重新生成二维码。' };
  }

  if (params.verifyCode?.trim()) {
    login.pendingVerifyCode = params.verifyCode.trim();
  }

  let endpoint = `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(login.qrcode)}`;
  if (login.pendingVerifyCode) {
    endpoint += `&verify_code=${encodeURIComponent(login.pendingVerifyCode)}`;
  }

  const status = await getJson<QrStatusResponse>({
    baseUrl: login.currentApiBaseUrl,
    endpoint,
    timeoutMs: QR_POLL_TIMEOUT_MS,
  });

  login.status = status.status || 'wait';

  switch (login.status) {
    case 'wait':
      login.message = '等待扫码。';
      break;
    case 'scaned':
      login.message = '已扫码，等待手机确认。';
      if (login.pendingVerifyCode) login.pendingVerifyCode = undefined;
      break;
    case 'need_verifycode':
      login.message = '微信需要输入手机上显示的数字验证码。';
      break;
    case 'verify_code_blocked':
      login.pendingVerifyCode = undefined;
      login.message = '验证码多次错误，请重新生成二维码。';
      break;
    case 'scaned_but_redirect':
      if (status.redirect_host) {
        login.currentApiBaseUrl = `https://${status.redirect_host}`;
      }
      login.message = '微信已切换连接节点，继续等待确认。';
      break;
    case 'binded_redirect':
      activeLogins.delete(login.sessionKey);
      login.message = '这个微信 bot 已经绑定过，可以直接运行。';
      startWechatNativeRuntime();
      return { ok: true, login: summarizeLogin(login), status: getWechatNativeStatus() };
    case 'expired':
      activeLogins.delete(login.sessionKey);
      login.message = '二维码已过期，请重新生成。';
      break;
    case 'confirmed': {
      if (!status.bot_token || !status.ilink_bot_id) {
        activeLogins.delete(login.sessionKey);
        throw new Error('微信确认成功，但没有返回 bot token 或 account id');
      }
      const account = saveAccount(status.ilink_bot_id, {
        token: status.bot_token,
        baseUrl: status.baseurl,
        userId: status.ilink_user_id,
      });
      activeLogins.delete(login.sessionKey);
      startWechatNativeRuntime();
      appendWechatEvent({
        type: 'account-connected',
        accountId: account.accountId,
        userId: account.userId,
        detail: 'QR login confirmed',
      });
      return {
        ok: true,
        connected: true,
        account: summarizeAccount(account),
        login: {
          active: false,
          status: 'confirmed',
          message: '微信已连接，Mio 已开始监听消息。',
        },
        status: getWechatNativeStatus(),
      };
    }
    default:
      login.message = status.errmsg || '微信连接状态异常。';
  }

  return { ok: true, login: summarizeLogin(login), status: getWechatNativeStatus() };
}

function restoreContextTokens(accountId: string): void {
  const tokens = readJson<Record<string, string>>(wechatNativeContextPath(accountId), {});
  for (const [peerId, token] of Object.entries(tokens)) {
    if (token) contextTokenStore.set(contextKey(accountId, peerId), token);
  }
}

function persistContextToken(accountId: string, peerId: string, token: string): void {
  if (!token) return;
  contextTokenStore.set(contextKey(accountId, peerId), token);
  const path = wechatNativeContextPath(accountId);
  const tokens = readJson<Record<string, string>>(path, {});
  tokens[peerId] = token;
  writeJson(path, tokens, 0o600);
}

function getContextToken(accountId: string, peerId: string): string | undefined {
  return contextTokenStore.get(contextKey(accountId, peerId));
}

function readSyncBuf(accountId: string): string {
  return readJson<{ getUpdatesBuf?: string }>(wechatNativeSyncPath(accountId), {}).getUpdatesBuf || '';
}

function writeSyncBuf(accountId: string, getUpdatesBuf: string): void {
  writeJson(wechatNativeSyncPath(accountId), { getUpdatesBuf }, 0o600);
}

function processIsAlive(pid: unknown): boolean {
  if (!Number.isInteger(pid) || Number(pid) <= 0) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function describeRuntimeLock(lock: WechatNativeRuntimeLockFile | null): string {
  if (!lock) return 'malformed lock file';
  const pid = Number.isInteger(lock.pid) ? `pid=${lock.pid}` : 'pid=unknown';
  const acquiredAt = lock.acquiredAt ? ` acquiredAt=${lock.acquiredAt}` : '';
  return `${pid}${acquiredAt}`.trim();
}

export function tryAcquireWechatNativeRuntimeLock(accountId: string): WechatNativeRuntimeLock | null {
  const lockPath = wechatNativeRuntimeLockPath(accountId);
  const token = randomUUID();

  for (let attempt = 0; attempt < 2; attempt++) {
    mkdirSync(dirname(lockPath), { recursive: true });
    let fd: number | undefined;
    try {
      fd = openSync(lockPath, 'wx', 0o600);
      const payload: WechatNativeRuntimeLockFile = {
        accountId,
        pid: process.pid,
        token,
        acquiredAt: new Date().toISOString(),
        command: process.argv.slice(0, 6).join(' '),
      };
      writeFileSync(fd, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
      return { path: lockPath, token };
    } catch (err) {
      if (fd !== undefined) {
        try { closeSync(fd); } catch { /* ignore */ }
        fd = undefined;
      }
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') {
        logger.warn('[wechat-native] failed to acquire runtime lock', {
          accountId,
          error: err instanceof Error ? err.message : String(err),
        });
        return null;
      }

      const current = readJson<WechatNativeRuntimeLockFile | null>(lockPath, null);
      if (processIsAlive(current?.pid)) {
        logger.warn('[wechat-native] runtime lock already held', {
          accountId,
          owner: describeRuntimeLock(current),
        });
        return null;
      }

      logger.warn('[wechat-native] removing stale runtime lock', {
        accountId,
        owner: describeRuntimeLock(current),
      });
      try {
        rmSync(lockPath, { force: true });
      } catch (removeErr) {
        logger.warn('[wechat-native] failed to remove stale runtime lock', {
          accountId,
          error: removeErr instanceof Error ? removeErr.message : String(removeErr),
        });
        return null;
      }
    } finally {
      if (fd !== undefined) {
        try { closeSync(fd); } catch { /* ignore */ }
      }
    }
  }

  return null;
}

export function releaseWechatNativeRuntimeLock(lock: WechatNativeRuntimeLock): void {
  const current = readJson<WechatNativeRuntimeLockFile | null>(lock.path, null);
  if (current?.pid !== process.pid || current?.token !== lock.token) return;
  try {
    rmSync(lock.path, { force: true });
  } catch (err) {
    logger.warn('[wechat-native] failed to release runtime lock', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function extractBodyFromItems(items?: WechatMessageItem[]): string {
  if (!items?.length) return '';
  for (const item of items) {
    if (item.type === MESSAGE_TEXT && item.text_item?.text != null) {
      const text = String(item.text_item.text);
      const ref = item.ref_msg;
      if (!ref) return text;
      const quoted: string[] = [];
      if (ref.title) quoted.push(ref.title);
      if (ref.message_item) {
        const body = extractBodyFromItems([ref.message_item]);
        if (body) quoted.push(body);
      }
      return quoted.length ? `[引用: ${quoted.join(' | ')}]\n${text}` : text;
    }
    if (item.type === MESSAGE_VOICE && item.voice_item?.text) {
      return item.voice_item.text;
    }
  }
  return '';
}

function messageKey(message: WechatMessage): string {
  return String(
    message.message_id
      ?? message.client_id
      ?? `${message.from_user_id || 'unknown'}:${message.seq || ''}:${message.create_time_ms || ''}`,
  );
}

function pruneProcessed(runtime: AccountRuntime): void {
  const cutoff = Date.now() - 5 * 60_000;
  for (const [key, ts] of runtime.processed) {
    if (ts < cutoff) runtime.processed.delete(key);
  }
}

async function notifyLifecycle(account: WechatNativeAccountFile, endpoint: string, signal?: AbortSignal): Promise<void> {
  try {
    await postJson({
      baseUrl: account.baseUrl,
      endpoint,
      body: { base_info: baseInfo() },
      token: account.token,
      timeoutMs: 10_000,
      signal,
    });
  } catch (err) {
    logger.debug('[wechat-native] lifecycle notify failed', {
      accountId: account.accountId,
      endpoint,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function getUpdates(account: WechatNativeAccountFile, getUpdatesBuf: string, signal: AbortSignal): Promise<GetUpdatesResponse> {
  try {
    return await postJson<GetUpdatesResponse>({
      baseUrl: account.baseUrl,
      endpoint: 'ilink/bot/getupdates',
      body: {
        get_updates_buf: getUpdatesBuf,
        base_info: baseInfo(),
      },
      token: account.token,
      timeoutMs: GET_UPDATES_TIMEOUT_MS,
      signal,
    });
  } catch (err) {
    if (signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
      return { ret: 0, msgs: [], get_updates_buf: getUpdatesBuf };
    }
    throw err;
  }
}

async function sendWechatText(account: WechatNativeAccountFile, to: string, text: string): Promise<void> {
  const clientId = `mio-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const body = {
    msg: {
      from_user_id: '',
      to_user_id: to,
      client_id: clientId,
      message_type: MESSAGE_TYPE_BOT,
      message_state: MESSAGE_STATE_FINISH,
      item_list: text
        ? [{ type: MESSAGE_TEXT, text_item: { text } }]
        : undefined,
      context_token: getContextToken(account.accountId, to),
    },
    base_info: baseInfo(),
  };

  const response = await postJson<{ ret?: number; errmsg?: string }>({
    baseUrl: account.baseUrl,
    endpoint: 'ilink/bot/sendmessage',
    body,
    token: account.token,
    timeoutMs: API_TIMEOUT_MS,
  });

  if (response.ret && response.ret !== 0) {
    throw new Error(`sendmessage ret=${response.ret} ${response.errmsg || ''}`.trim());
  }
}

async function processWechatMessage(account: WechatNativeAccountFile, runtime: AccountRuntime, message: WechatMessage): Promise<void> {
  const from = message.from_user_id?.trim();
  if (!from) return;
  if (message.message_type === MESSAGE_TYPE_BOT) return;

  pruneProcessed(runtime);
  const key = messageKey(message);
  if (runtime.processed.has(key)) return;
  runtime.processed.set(key, Date.now());

  if (message.context_token) {
    persistContextToken(account.accountId, from, message.context_token);
  }

  const gate = checkAccessGate(account.accountId, from);
  if (!gate.ok) {
    await sendWechatText(account, from, gate.reply);
    runtime.lastOutboundAt = Date.now();
    appendWechatEvent({
      type: gate.type,
      accountId: account.accountId,
      userId: from,
      detail: gate.detail,
    });
    return;
  }

  const text = extractBodyFromItems(message.item_list).trim();
  if (!text) {
    await sendWechatText(account, from, '我现在先只能稳定处理文字消息。你发文字给我，我就能回。');
    runtime.lastOutboundAt = Date.now();
    appendWechatEvent({
      type: 'unsupported-message',
      accountId: account.accountId,
      userId: from,
      detail: 'non-text message',
    });
    return;
  }

  runtime.lastInboundAt = Date.now();
  const sessionId = buildWechatSessionId(account.accountId, from);
  upsertWeClawTarget(sessionId, from, 'wechat-native');
  recordAcceptedUsage(account.accountId, from);
  appendWechatEvent({
    type: 'inbound',
    accountId: account.accountId,
    userId: from,
    sessionId,
    detail: `${text.length} chars`,
  });

  logger.info('[wechat-native] inbound message', { accountId: account.accountId, sessionId });
  const result = await runTurn({
    text,
    sessionId,
    channel: {
      type: 'private',
      platform: 'wechat-native',
      userId: from,
    },
  });

  if (result.ghosted || !result.text.trim()) return;

  const config = getConfig();
  let replyText = result.text.trim();
  if (config.features.imPacing) {
    const plan = planPacing(replyText);
    await sleep(plan.initialDelayMs);
    replyText = plan.text;
  }

  await sendWechatText(account, from, replyText);
  runtime.lastOutboundAt = Date.now();
  appendWechatEvent({
    type: 'outbound',
    accountId: account.accountId,
    userId: from,
    sessionId,
    detail: `${replyText.length} chars`,
  });
}

function startAccountRuntime(account: WechatNativeAccountFile): void {
  if (account.disabled || !account.token.trim()) return;
  const current = runtimes.get(account.accountId);
  if (current?.running) return;
  if (current?.lock) {
    releaseWechatNativeRuntimeLock(current.lock);
    current.lock = undefined;
  }

  const lock = tryAcquireWechatNativeRuntimeLock(account.accountId);
  if (!lock) {
    appendWechatEvent({
      type: 'runtime-lock-held',
      accountId: account.accountId,
      detail: 'another Mio process is already polling this native WeChat account',
    });
    return;
  }

  const controller = new AbortController();
  const runtime: AccountRuntime = {
    accountId: account.accountId,
    controller,
    running: true,
    startedAt: Date.now(),
    lastError: null,
    processed: new Map(),
    lock,
  };
  runtimes.set(account.accountId, runtime);
  restoreContextTokens(account.accountId);
  appendWechatEvent({ type: 'runtime-started', accountId: account.accountId });

  void runAccountLoop(account.accountId, controller.signal).catch((err) => {
    runtime.running = false;
    runtime.lastError = err instanceof Error ? err.message : String(err);
    appendWechatEvent({ type: 'runtime-error', accountId: account.accountId, detail: runtime.lastError });
    logger.error('[wechat-native] account loop crashed', {
      accountId: account.accountId,
      error: runtime.lastError,
    });
  });
}

async function runAccountLoop(accountId: string, signal: AbortSignal): Promise<void> {
  let getUpdatesBuf = readSyncBuf(accountId);
  const runtime = runtimes.get(accountId);
  const account = readAccount(accountId);
  if (!runtime || !account) return;

  logger.info('[wechat-native] account runtime started', { accountId });
  await notifyLifecycle(account, 'ilink/bot/msg/notifystart', signal);

  try {
    while (!signal.aborted) {
      const latest = readAccount(accountId);
      if (!latest || latest.disabled) break;

      try {
        const response = await getUpdates(latest, getUpdatesBuf, signal);
        if (response.get_updates_buf !== undefined) {
          getUpdatesBuf = response.get_updates_buf;
          writeSyncBuf(accountId, getUpdatesBuf);
        }

        if (response.ret && response.ret !== 0) {
          const detail = `getupdates ret=${response.ret} errcode=${response.errcode ?? 'none'} ${response.errmsg || ''}`.trim();
          const previousError = runtime.lastError;
          runtime.lastError = detail;
          if (previousError !== detail) {
            appendWechatEvent({ type: 'runtime-error', accountId, detail });
          }
          logger.warn('[wechat-native] getupdates returned error', { accountId, detail });
          if (response.errcode === -14) break;
          await sleep(5000);
          continue;
        }

        for (const message of response.msgs || []) {
          await processWechatMessage(latest, runtime, message);
        }
        runtime.lastError = null;
      } catch (err) {
        if (signal.aborted) break;
        const detail = err instanceof Error ? err.message : String(err);
        const previousError = runtime.lastError;
        runtime.lastError = detail;
        if (previousError !== detail) {
          appendWechatEvent({ type: 'polling-error', accountId, detail });
        }
        logger.warn('[wechat-native] polling failed', { accountId, error: runtime.lastError });
        await sleep(5000);
      }
    }
  } finally {
    runtime.running = false;
    await notifyLifecycle(account, 'ilink/bot/msg/notifystop');
    if (runtime.lock) {
      releaseWechatNativeRuntimeLock(runtime.lock);
      runtime.lock = undefined;
    }
    appendWechatEvent({ type: 'runtime-stopped', accountId });
    logger.info('[wechat-native] account runtime stopped', { accountId });
  }
}

function stopAccountRuntime(accountId: string): void {
  const runtime = runtimes.get(accountId);
  if (!runtime) return;
  runtime.controller.abort();
  runtime.running = false;
  if (runtime.lock) {
    releaseWechatNativeRuntimeLock(runtime.lock);
    runtime.lock = undefined;
  }
}

export function startWechatNativeRuntime(): Record<string, unknown> {
  if (!isNativeWechatEnabled()) return getWechatNativeStatus();
  for (const account of listAccounts()) {
    startAccountRuntime(account);
  }
  return getWechatNativeStatus();
}

export function stopWechatNativeRuntime(): Record<string, unknown> {
  for (const accountId of [...runtimes.keys()]) {
    stopAccountRuntime(accountId);
  }
  return getWechatNativeStatus();
}

export function restartWechatNativeRuntime(): Record<string, unknown> {
  stopWechatNativeRuntime();
  startWechatNativeRuntime();
  return getWechatNativeStatus();
}

export function removeWechatNativeAccount(accountId: string): Record<string, unknown> {
  const deleted = deleteAccount(accountId);
  return { ok: deleted, status: getWechatNativeStatus() };
}
