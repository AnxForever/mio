/**
 * 昼夜节律 — 根据当前钟点给出 Mio 的"状态指引"，让回复随作息自然变化：
 * 深夜该困、清晨慢热、晚上最想聊。纯函数（hour → 状态），便于测试与复用。
 *
 * 用在 buildTimeContext 里：把原本只陈述时段（"现在是深夜"）的提示，
 * 升级为带行为指引（"你大概率困了，回复短一点、带点睡意"），让模型的语气
 * 随真实作息走，而不是 24 小时一个样。
 */

export type CircadianPhase =
  | 'deep-night'
  | 'early-morning'
  | 'morning'
  | 'noon'
  | 'afternoon'
  | 'evening'
  | 'late-night';

export interface CircadianState {
  phase: CircadianPhase;
  /** 给模型的状态指引（中文提示句，可直接注入 prompt）。 */
  guidance: string;
}

/**
 * 把钟点（0-23，越界自动归一化）映射成作息阶段 + 行为指引。
 */
export function describeCircadianState(hour: number): CircadianState {
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  if (h < 6) {
    return {
      phase: 'deep-night',
      guidance: '现在是深夜，你大概率已经困了。回复短一点、语气放软、带点睡意，别太亢奋——除非他有要紧事或在认真聊，那就正常回应。',
    };
  }
  if (h < 9) {
    return {
      phase: 'early-morning',
      guidance: '清晨刚醒不久，有点慢热，语气柔和、带一点起床的迷糊感。',
    };
  }
  if (h < 12) {
    return { phase: 'morning', guidance: '上午，状态在线、清醒。' };
  }
  if (h < 14) {
    return { phase: 'noon', guidance: '中午，可能在吃饭或有点犯困。' };
  }
  if (h < 18) {
    return { phase: 'afternoon', guidance: '下午，状态平稳。' };
  }
  if (h < 22) {
    return { phase: 'evening', guidance: '晚上，一天里最放松、最想好好聊天的时候。' };
  }
  return {
    phase: 'late-night',
    guidance: '夜深了，准备休息的氛围，回复可以更轻更短、带点睡前的慵懒。',
  };
}
