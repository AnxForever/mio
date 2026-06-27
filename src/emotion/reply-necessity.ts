/**
 * Reply necessity scoring for group/IM surfaces.
 *
 * Ghost handles intimate one-to-one silence. This module answers a different
 * question: in a noisy group/channel, is this message worth Mio speaking into?
 */

import type { TurnChannelContext } from '../types.js';

export const REPLY_NECESSITY_TRIGGER_SCORE = 65;

const DIRECT_REQUEST_TERMS = ['帮我', '帮忙', '能不能', '可以吗', '要不要'];
const WEAK_REQUEST_TERMS = ['需要', '求', '看看', '试试'];
const QUESTION_TERMS = ['怎么', '如何', '为什么', '有没有'];
const OPINION_TERMS = ['你觉得', '你认为', '咋看', '有什么建议'];
const SHORT_REACTIONS = new Set(['哈哈', '哈哈哈', '草', '笑死', '好', '嗯', '啊', '哦', '6', '666', '？', '?']);
const MEDIA_PREFIXES = ['[CQ:image', '[图片：', '[表情包:', '[文件]', '[语音:', '[卡片:'];
const OTHER_ASSISTANT_ADDRESSEE = /^(?:DeepSeek|ChatGPT|Grok|豆包|千问|元宝|通义|Kimi|Claude)[，,、\s]/;

export interface ReplyNecessityInput {
  texts: string[];
  pendingCount: number;
  triggerThreshold: number;
  hasAt: boolean;
  hasMention: boolean;
  isGroupChat: boolean;
  focusActive: boolean;
  recentSelfReplies: number;
  consecutiveSelfReplies: number;
  effectiveFrequency: number;
  idleSeconds: number;
  idleReachedAverage: boolean;
}

export interface ReplyNecessityScore {
  score: number;
  detail: string;
}

export function stripReplyNecessityNoise(text: string): string {
  let normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized || normalized.startsWith('@all')) return '';
  if (normalized.startsWith('[回复了') && normalized.includes('【合并转发消息:')) return '';
  if (normalized.startsWith('【合并转发消息:') || normalized.startsWith('本群发言榜')) return '';
  if (MEDIA_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return '';

  normalized = normalized
    .replace(/^\[CQ:reply[^\]]*\]\s*/, '')
    .replace(/^\[reply\]\s*/, '')
    .replace(/^\[回复了.+?的消息: .+?\]\s*/, '')
    .replace(/^\[回复消息\]\s*/, '')
    .replace(/^\[回复了一条消息，但原消息已无法访问\]\s*/, '')
    .replace(/@<[^>]+>|@\S+/g, '')
    .trim();

  const legacyReply = normalized.match(/\]，说：\s*(.+)$/);
  if (legacyReply) normalized = legacyReply[1].trim();
  if (MEDIA_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return '';
  return normalized;
}

export function isShortReactionBatch(texts: string[]): boolean {
  const cleaned = texts.map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (cleaned.length === 0) return true;
  if (cleaned.some((t) => t.length > 8)) return false;
  return cleaned.every((t) => SHORT_REACTIONS.has(t));
}

export function hasReplyNecessityQuestion(text: string): boolean {
  if (!text) return false;
  if (/^[？?！!~～…\s]+[\w\u4e00-\u9fff]{1,4}[？?！!~～…\s]+$/.test(text)) return false;
  if (QUESTION_TERMS.some((term) => text.includes(term))) return true;
  if (/(?<![这那没])什么/.test(text)) return true;
  if (/[吗呢](?:[？?。！!~～…]*$)/.test(text) && text.length >= 4 && text.length <= 80) return true;
  return /[？?](?:$|[。！!~～…])/.test(text) && text.length >= 4 && text.length <= 120;
}

function requestReason(text: string, isDirectContext: boolean): string {
  if (!isDirectContext && OTHER_ASSISTANT_ADDRESSEE.test(text)) return '';
  const directHits = DIRECT_REQUEST_TERMS.filter((term) => text.includes(term));
  const filtered = directHits.filter((term) => {
    if (term === '能不能' && !(isDirectContext || text.startsWith('能不能'))) return false;
    if (!isDirectContext && (term === '可以吗' || term === '要不要')) return false;
    return true;
  });
  if (filtered.length > 0) return filtered.join('/');
  if (!isDirectContext) return '';
  const weakHits = WEAK_REQUEST_TERMS.filter((term) => text.includes(term));
  return weakHits.join('/');
}

function opinionReason(text: string, isDirectContext: boolean): string {
  if (text.includes('不怎么看')) return '';
  if (!isDirectContext && !text.includes('Mio') && !text.includes('米奥')) return '';
  const hits = OPINION_TERMS.filter((term) => text.includes(term));
  if (hits.length > 0) return hits.join('/');
  if (/(?:你|Mio|米奥).{0,6}怎么看|怎么看.{0,6}(?:你|Mio|米奥)/.test(text)) return '怎么看';
  return '';
}

function scoreContent(cleanedTexts: string[], combinedText: string, isDirectContext: boolean): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  if (cleanedTexts.some(hasReplyNecessityQuestion)) {
    score += 15;
    reasons.push('问题');
  }

  const req = requestReason(combinedText, isDirectContext);
  if (req) {
    score += 20;
    reasons.push(`请求:${req}`);
  }

  const opinion = opinionReason(combinedText, isDirectContext);
  if (opinion) {
    score += 20;
    reasons.push(`征询:${opinion}`);
  }

  if (combinedText.length >= 40) {
    score += 5;
    reasons.push('长文本');
  }
  if (combinedText.length >= 120) {
    score += 10;
    reasons.push('较长文本');
  }
  if (isShortReactionBatch(cleanedTexts)) {
    score -= 25;
    reasons.push('短反应');
  }

  return { score, reasons };
}

export function scoreReplyNecessity(input: ReplyNecessityInput): ReplyNecessityScore {
  const threshold = Math.max(1, input.triggerThreshold);
  let relevanceScore = 0;
  let relevanceReason = '普通';
  if (input.hasAt) {
    relevanceScore = 100;
    relevanceReason = '@';
  } else if (input.hasMention) {
    relevanceScore = 80;
    relevanceReason = '提及';
  } else if (!input.isGroupChat) {
    relevanceScore = 40;
    relevanceReason = '私聊';
  } else if (input.focusActive) {
    relevanceScore = 40;
    relevanceReason = 'focus';
  }

  const isDirectContext = relevanceScore > 0;
  const cleanedTexts = input.texts.map(stripReplyNecessityNoise);
  const combinedText = cleanedTexts.filter(Boolean).join('\n');
  const content = scoreContent(cleanedTexts, combinedText, isDirectContext);
  let pressureScore = Math.min(40, Math.round(40 * input.pendingCount / threshold));
  if (input.idleReachedAverage) pressureScore += 15;

  const presencePenalty = Math.min(45, input.recentSelfReplies * 15)
    + Math.min(40, input.consecutiveSelfReplies * 20);
  const rawScore = relevanceScore + content.score + pressureScore - presencePenalty;
  const frequency = Math.min(1, Math.max(0, input.effectiveFrequency));
  const factor = 0.5 + 0.5 * frequency;
  const finalScore = Math.max(0, Math.round(rawScore * factor));

  return {
    score: finalScore,
    detail: `最终=${finalScore} 原始=${rawScore} 强相关=${relevanceScore}(${relevanceReason}) 内容=${content.score}(${content.reasons.join(',') || '无'}) 文本长度=${combinedText.length} 压力=${pressureScore}(pending=${input.pendingCount}/${threshold},idle=${input.idleSeconds.toFixed(1)}s) 存在感=-${presencePenalty}(5min=${input.recentSelfReplies},连续=${input.consecutiveSelfReplies}) 频率=${frequency.toFixed(3)} 倍率=${factor.toFixed(2)}`,
  };
}

export function buildReplyNecessityInput(text: string, channel?: TurnChannelContext): ReplyNecessityInput {
  return {
    texts: [text],
    pendingCount: Math.max(1, channel?.pendingCount ?? 1),
    triggerThreshold: REPLY_NECESSITY_TRIGGER_SCORE,
    hasAt: channel?.hasAt === true,
    hasMention: channel?.hasMention === true,
    isGroupChat: channel?.type === 'group',
    focusActive: channel?.focusActive === true,
    recentSelfReplies: Math.max(0, channel?.recentSelfReplies ?? 0),
    consecutiveSelfReplies: Math.max(0, channel?.consecutiveSelfReplies ?? 0),
    effectiveFrequency: channel?.effectiveFrequency ?? 1,
    idleSeconds: Math.max(0, channel?.idleSeconds ?? 0),
    idleReachedAverage: channel?.idleReachedAverage === true,
  };
}

export function shouldSkipReplyForNecessity(text: string, channel?: TurnChannelContext): { skip: boolean; score: ReplyNecessityScore } {
  const input = buildReplyNecessityInput(text, channel);
  const score = scoreReplyNecessity(input);
  const skip = input.isGroupChat && !input.hasAt && !input.hasMention && score.score < input.triggerThreshold;
  return { skip, score };
}
