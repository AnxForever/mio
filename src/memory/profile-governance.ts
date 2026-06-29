/**
 * User profile governance helpers.
 *
 * Keep durable profile memory narrow: stable facts, preferences, boundaries,
 * habits, and long-running goals. Chat smoke tests and one-off exchanges should
 * not become "who the user is".
 */

export interface ProfileSignal {
  text?: string | null;
  what?: string | null;
  evidence?: string | null;
  sessionId?: string | null;
}

const SYNTHETIC_SIGNAL_PATTERNS = [
  /\bmockprovider\b/i,
  /\bmock reply\b/i,
  /\be2e\b/i,
  /\bsmoke test\b/i,
  /\brate limit test\b/i,
  /\bbridge test\b/i,
  /\bcompat(?:ible|ibility)? test\b/i,
  /\bstream(?:ing)? test\b/i,
  /\bws test\b/i,
  /\bopenai\b.*\btest\b/i,
  /\bonebot\b.*\btest\b/i,
  /\bauthenticated\b.*\btest\b/i,
  /\bimage smoke\b/i,
  /\bhello from (?:ws|b)\b/i,
  /\bsame a again\b/i,
  /\bfirst message in session\b/i,
  /\bsecond message, same session\b/i,
  /^initial$/i,
  /^test(?:[-_\s]\w+)?$/i,
];

const DURABLE_PROFILE_PATTERNS = [
  /我(?:叫|是|在|住在|来自|出生|毕业|就读|工作|上班|养了|有一只|有两只)/,
  /我(?:喜欢|讨厌|不喜欢|爱吃|不爱吃|偏好|习惯|经常|通常|每天|每周|总是|容易)/,
  /我(?:希望你|需要你|不想你|别再|不要|可以叫我|叫我)/,
  /我(?:正在|打算|计划|准备|目标是|想长期|一直在)/,
  /我的(?:名字|昵称|生日|年龄|工作|职业|公司|学校|专业|城市|家|家人|朋友|伴侣|猫|狗|宠物|习惯|偏好|目标|计划|项目|边界)/,
  /(?:用户|他|她)(?:喜欢|讨厌|不喜欢|爱吃|不爱吃|习惯|经常|通常|住在|来自|工作|职业|公司|学校|专业|养了|希望|需要|边界)/,
  /\bI (?:am|work|live|study|prefer|like|dislike|hate|usually|always|often|need|want you to|do not want you to)\b/i,
  /\bmy (?:name|nickname|birthday|age|job|work|company|school|major|city|family|partner|pet|habit|preference|goal|plan|boundary)\b/i,
];

const EPHEMERAL_PATTERNS = [
  /^今天天气/,
  /^今天(?:有点|好|很)?(?:累|开心|难过|烦|困|饿)/,
  /^你好[呀啊]?$/,
  /^hi$/i,
  /^hello$/i,
];

export function extractUserSaidText(what: string): string | null {
  const match = what.match(/user said "([\s\S]*?)"/i);
  return match?.[1]?.trim() || null;
}

export function isSyntheticProfileSignal(signal: ProfileSignal): boolean {
  const combined = [
    signal.text,
    signal.what,
    signal.evidence,
    signal.sessionId,
  ].filter(Boolean).join('\n');
  if (!combined.trim()) return false;
  return SYNTHETIC_SIGNAL_PATTERNS.some((pattern) => pattern.test(combined));
}

export function hasDurableUserProfileSignal(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 4) return false;
  if (EPHEMERAL_PATTERNS.some((pattern) => pattern.test(trimmed))) return false;
  return DURABLE_PROFILE_PATTERNS.some((pattern) => pattern.test(trimmed));
}
