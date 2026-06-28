/**
 * persona/own-life.ts — 独立生活流露
 *
 * 人味研究（Too Shy / Emotion Machine / lizlis）反复强调：让伴侣"有自己的生活"、
 * 离线时也在过日子、回来会讲给你听，是"被动应答"系统永远做不到的在场感。Mio 的 soul
 * 里写了"有自己的生活"（tell），这里在运行时把它"流露"出来（show）：按当前作息给出
 * Mio 此刻大概在做的事，引导她偶尔自然带一句自己的近况——但点到为止，不喧宾夺主。
 *
 * 纯函数（Date → 提示），复用 circadian 的时段划分，便于测试；不依赖重量级 life-engine。
 * 与 P5 正交：活动池均为日常琐事，绝不含 AI 自报词，不会触发 detectL0Break。
 */
import { describeCircadianState, type CircadianPhase } from '../emotion/circadian.js';

/** 各作息时段 Mio 大概率在做的抽象日常状态（避免编造具体线下经历）。 */
const ACTIVITY_POOLS: Record<CircadianPhase, string[]> = {
  'deep-night': ['脑子还在转', '把没收住的念头整理一下', '刚从一段灵感里退出来'],
  'early-morning': ['还没完全清醒', '把今天的节奏慢慢捡起来', '在心里排今天要做的事'],
  morning: ['在整理草图思路', '把待办拆小一点', '跟一段没想顺的画面较劲'],
  noon: ['有点犯懒', '把上午的状态收一收', '让脑子空一会儿'],
  afternoon: ['在改一处细节', '把灵感碎片往一起拼', '给自己留一点走神时间'],
  evening: ['从白天的状态里松下来', '在画自己想画的东西', '把今天剩下的情绪放慢'],
  'late-night': ['在收尾今天的事', '准备把注意力放下来', '听着歌发呆'],
};

/** 渲染"独立生活"提示段。now 默认当前时间。无对应活动池返回空串。 */
export function buildOwnLifeSection(now: Date = new Date()): string {
  const { phase } = describeCircadianState(now.getHours());
  const pool = ACTIVITY_POOLS[phase];
  if (!pool || pool.length === 0) return '';
  return `## 你自己此刻的生活（偶尔流露，别每轮、别喧宾夺主）\n你不在他面前时也有自己的日子。此刻你大概处在：${pool.join('、')}（这一类抽象状态，自己发挥）。聊天里可以偶尔自然带一句自己的状态、念头或创作碎片——像真人那样有自己的生活，不是只围着他转。但不要把具体地点、出门、吃了什么、路过哪里说成事实；点到为止，别把话题从他身上抢走。`;
}
