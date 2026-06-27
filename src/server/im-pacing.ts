/**
 * IM pacing — 让桥接（微信/QQ）里的 Mio 回复有"真人在打字"的节奏感。
 *
 * 两个纯关注点（无磁盘、无网络、无时钟依赖；调用方负责把延迟交给 setTimeout）：
 *
 *   1. splitIntoBubbles(text)  把一段长回复在自然边界（空行段落、句末）切成
 *      1~N 条短"气泡"。微信类桥（WeClaw/Hermes）会按换行把单条回复拆成多条
 *      微信消息，所以分段后用 joinBubbles 合回单条即可"多条连发"；QQ(OneBot)
 *      路则可逐条主动发送、条间插入延迟。
 *
 *   2. computeTypingDelayMs(text)  按字数模拟"阅读+思考+打字"的延迟，带上下限，
 *      避免秒回一大坨的机器人感。
 *
 * 设计取舍：宁可少拆也不拆坏——代码块整块保留、句子不硬切、过短碎片并回邻条。
 */

export interface BubbleOptions {
  /** 最多拆成几条气泡，超出的从尾部并回最后一条。 */
  maxBubbles?: number;
  /** 单条气泡的软上限（字符数），同段超过则按句末再拆。 */
  maxBubbleChars?: number;
  /** 短于此长度的碎片并回上一条，避免单字独立成条。 */
  minBubbleChars?: number;
}

export interface TypingDelayOptions {
  /** 基础延迟：看到消息后的反应/思考。 */
  baseMs?: number;
  /** 每字符增量：模拟打字速度。 */
  perCharMs?: number;
  /** 延迟下限。 */
  minMs?: number;
  /** 延迟上限：再长也不让用户等太久。 */
  maxMs?: number;
}

export const DEFAULT_PACING = {
  maxBubbles: 3,
  maxBubbleChars: 60,
  minBubbleChars: 4,
  baseMs: 500,
  perCharMs: 55,
  minMs: 600,
  maxMs: 7000,
} as const;

const CODE_BLOCK = /```[\s\S]*?```/g;
// 全 ASCII 占位 token：正文绝不会出现 @@MIO_CB_<n>@@，避免与内容/数字冲突。
const MASK_PREFIX = '@@MIO_CB_';
const MASK_SUFFIX = '@@';
const SENTENCE_ENDER = /[。！？!?…]/;

/** 按句末标点切句，标点随句保留。逗号/波浪号不算句末（语气延续，拆了别扭）。 */
function splitSentences(text: string): string[] {
  const parts: string[] = [];
  let buf = '';
  for (const ch of text) {
    buf += ch;
    if (SENTENCE_ENDER.test(ch)) {
      parts.push(buf);
      buf = '';
    }
  }
  if (buf.trim()) parts.push(buf);
  return parts.map((s) => s.trim()).filter(Boolean);
}

/** 贪心把同段句子打包成 ≤ maxChars 的气泡；单句超长则单独成条（不硬切句子）。 */
function packSentences(sentences: string[], maxChars: number): string[] {
  const bubbles: string[] = [];
  let cur = '';
  for (const s of sentences) {
    if (!cur) {
      cur = s;
    } else if (cur.length + s.length <= maxChars) {
      cur += s;
    } else {
      bubbles.push(cur);
      cur = s;
    }
  }
  if (cur) bubbles.push(cur);
  return bubbles;
}

/** 把过短碎片并回上一条，避免"嗯""吗"这种单字独立成条。代码块气泡不参与合并。 */
function mergeShortFragments(bubbles: string[], minChars: number): string[] {
  const out: string[] = [];
  for (const b of bubbles) {
    const prev = out[out.length - 1];
    const canMerge = out.length > 0
      && b.length < minChars
      && !b.includes(MASK_PREFIX)
      && !prev.includes(MASK_PREFIX);
    if (canMerge) {
      out[out.length - 1] = `${prev} ${b}`.trim();
    } else {
      out.push(b);
    }
  }
  return out;
}

/**
 * 把一段回复拆成 1~N 条短气泡。短回复原样返回单条。
 */
export function splitIntoBubbles(text: string, options: BubbleOptions = {}): string[] {
  const maxBubbles = options.maxBubbles ?? DEFAULT_PACING.maxBubbles;
  const maxBubbleChars = options.maxBubbleChars ?? DEFAULT_PACING.maxBubbleChars;
  const minBubbleChars = options.minBubbleChars ?? DEFAULT_PACING.minBubbleChars;

  const trimmed = (text ?? '').trim();
  if (!trimmed) return [];

  // 保护代码块：占位后不参与拆分，最后还原。
  const codeBlocks: string[] = [];
  const masked = trimmed.replace(CODE_BLOCK, (m) => {
    codeBlocks.push(m);
    return `${MASK_PREFIX}${codeBlocks.length - 1}${MASK_SUFFIX}`;
  });

  const paragraphs = masked.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

  let bubbles: string[] = [];
  for (const para of paragraphs) {
    if (para.includes(MASK_PREFIX)) {
      bubbles.push(para); // 含代码块的段落整体保留
    } else if (para.length <= maxBubbleChars) {
      bubbles.push(para);
    } else {
      bubbles.push(...packSentences(splitSentences(para), maxBubbleChars));
    }
  }

  bubbles = mergeShortFragments(bubbles, minBubbleChars);

  // 条数上限：多出来的从尾部并进最后一条，宁可最后一条略长也不超过条数。
  if (bubbles.length > maxBubbles) {
    const head = bubbles.slice(0, maxBubbles - 1);
    const tail = bubbles.slice(maxBubbles - 1).join('\n');
    bubbles = [...head, tail];
  }

  // 还原代码块。
  const restore = new RegExp(`${MASK_PREFIX}(\\d+)${MASK_SUFFIX}`, 'g');
  return bubbles
    .map((b) => b.replace(restore, (_, i) => codeBlocks[Number(i)] ?? ''))
    .map((b) => b.trim())
    .filter((b) => b.length > 0);
}

/**
 * 按字数估算"阅读+思考+打字"延迟（毫秒），clamp 在 [minMs, maxMs]。
 */
export function computeTypingDelayMs(text: string, options: TypingDelayOptions = {}): number {
  const baseMs = options.baseMs ?? DEFAULT_PACING.baseMs;
  const perCharMs = options.perCharMs ?? DEFAULT_PACING.perCharMs;
  const minMs = options.minMs ?? DEFAULT_PACING.minMs;
  const maxMs = options.maxMs ?? DEFAULT_PACING.maxMs;
  const len = (text ?? '').trim().length;
  const raw = baseMs + perCharMs * len;
  return Math.round(Math.min(maxMs, Math.max(minMs, raw)));
}

/** 每条气泡发送前的延迟（毫秒）：逐条连发时按各自长度算"打这条字"的耗时。 */
export function computeBubbleDelaysMs(bubbles: string[], options: TypingDelayOptions = {}): number[] {
  return bubbles.map((b) => computeTypingDelayMs(b, options));
}

/** 把多气泡合回单条文本（微信类桥按换行/空行自动拆成多条消息）。 */
export function joinBubbles(bubbles: string[], separator = '\n\n'): string {
  return bubbles.filter((b) => b.trim().length > 0).join(separator);
}

/** 让出事件循环 ms 毫秒——模拟"正在打字/思考"的停顿。ms ≤ 0 立即返回。 */
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.round(ms))));

export type PacingOptions = BubbleOptions & TypingDelayOptions & { separator?: string };

export interface PacingPlan {
  /** 分段后用分隔符合并的单条文本（微信类桥按换行自动拆多条）。 */
  text: string;
  /** 分段数组（QQ/OneBot 可逐条主动发送）。 */
  bubbles: string[];
  /** 首条发送前的延迟：模拟看到消息后开始打字。 */
  initialDelayMs: number;
  /** 每条气泡发送前的延迟（QQ 逐条连发用）。 */
  bubbleDelaysMs: number[];
}

/**
 * 把一段回复编排成"分段 + 延迟"计划（纯函数，不读 env、不 sleep）。
 * 调用方按 config/channel 决定是否启用，并用 sleep() 落地延迟。
 */
export function planPacing(text: string, options: PacingOptions = {}): PacingPlan {
  const bubbles = splitIntoBubbles(text, options);
  const bubbleDelaysMs = computeBubbleDelaysMs(bubbles, options);
  return {
    text: joinBubbles(bubbles, options.separator ?? '\n\n'),
    bubbles,
    initialDelayMs: bubbleDelaysMs[0] ?? computeTypingDelayMs(text, options),
    bubbleDelaysMs,
  };
}
