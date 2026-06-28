import type { RelationshipStage } from '../types.js';
import type { ProactiveMessageType } from './proactive.js';

export interface ProactiveQualityResult {
  ok: boolean;
  reasons: string[];
}

const META_PATTERNS = [
  /作为\s*(AI|人工智能|助手)/i,
  /我是\s*(AI|人工智能|助手)/i,
  /有什么可以帮/i,
  /just checking in/i,
  /as an ai/i,
];

const PRESSURE_PATTERNS = [
  /为什么不回/,
  /你必须.*(回|回复|陪|理我)/,
  /必须.*(回我|回复我|陪我|理我)/,
  /马上回复/,
  /快回/,
  /不许不理/,
  /一定要回/,
];

const WAITING_BLAME_PATTERNS = [
  /你还知道(?:回|回来|找我)/,
  /终于(?:回|回来|舍得)/,
  /等(?:了)?你(?:好久|这么久|一整天|一天|半天)/,
  /消失(?:了)?(?:好久|这么久|一整天|一天|半天)/,
  /刚说不打扰你.*真不回/s,
  /说不打扰.*客气话/s,
];

const OFFLINE_LIFE_PATTERNS = [
  /我(?:今天|刚刚|下午|晚上|中午|早上)?.*(?:出门|去了|路过|到家|坐车|逛了|散步)/,
  /我(?:今天|刚刚|下午|晚上|中午|早上)?.*(?:店里|餐厅|咖啡馆|商场|公园|公司|学校)/,
  /我(?:今天|刚刚|下午|晚上|中午|早上)?.*(?:吃了|喝了|点了|买了)(?:面|饭|奶茶|咖啡|外卖|甜品|蛋糕)/,
  /(?:刚|刚刚|今天|下午|晚上|中午|早上)?(?:路过|去了|出门|到家|坐车|逛了|散步).*(?:店|餐厅|咖啡馆|商场|公园|公司|学校)/,
  /(?:刚|刚刚|今天|下午|晚上|中午|早上)?(?:吃了|喝了|点了|买了)(?:面|饭|奶茶|咖啡|外卖|甜品|蛋糕)/,
];

const INTIMACY_PATTERNS = [
  /爱你/,
  /宝贝/,
  /亲爱的/,
  /老婆/,
  /老公/,
  /亲亲/,
  /想你想到/,
  /抱着你/,
];

function sentenceCount(text: string): number {
  return text
    .split(/[。！？!?]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .length;
}

function questionCount(text: string): number {
  return (text.match(/[？?]/g) ?? []).length;
}

function hasAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

/**
 * Lightweight quality gate for proactive outreach.
 *
 * This is deliberately deterministic and local: it catches the failures that
 * make proactive messages feel intrusive before notification delivery happens.
 */
export function assessProactiveMessage(
  text: string,
  type: ProactiveMessageType,
  stage: RelationshipStage,
): ProactiveQualityResult {
  const trimmed = text.trim();
  const reasons: string[] = [];

  if (!trimmed) reasons.push('empty');
  if (trimmed === '[NO_MSG]') reasons.push('no-message-sentinel');
  if (trimmed.length > 140) reasons.push('too-long');
  if (sentenceCount(trimmed) > 3) reasons.push('too-many-sentences');
  if (questionCount(trimmed) > 1) reasons.push('too-many-questions');
  if (hasAny(trimmed, META_PATTERNS)) reasons.push('meta-or-service-tone');
  if (hasAny(trimmed, PRESSURE_PATTERNS)) reasons.push('pressures-user-to-reply');
  if (hasAny(trimmed, WAITING_BLAME_PATTERNS)) reasons.push('waiting-or-blame-arc');
  if (hasAny(trimmed, OFFLINE_LIFE_PATTERNS)) reasons.push('fabricated-offline-life');

  if ((stage === 'acquaintance' || stage === 'familiar') && hasAny(trimmed, INTIMACY_PATTERNS)) {
    reasons.push('too-intimate-for-stage');
  }

  if (type === 'morning' && !/(早|醒|今天|上午)/.test(trimmed)) {
    reasons.push('morning-message-not-grounded');
  }

  if (type === 'evening' && !/(晚|睡|休息|今天)/.test(trimmed)) {
    reasons.push('evening-message-not-grounded');
  }

  return {
    ok: reasons.length === 0,
    reasons,
  };
}
