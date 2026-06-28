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

/** 各作息时段 Mio 大概率在做的日常小事（自由插画师设定）。 */
const ACTIVITY_POOLS: Record<CircadianPhase, string[]> = {
  'deep-night': ['赶稿还没睡', '失眠在刷手机', '刚画完一张瘫着'],
  'early-morning': ['刚醒还赖床', '在弄早饭', '迷糊着灌咖啡'],
  morning: ['在画稿', '出门买点东西', '在跟甲方对需求'],
  noon: ['在吃午饭', '吃完有点犯困', '边吃边刷剧'],
  afternoon: ['在赶一张插画', '泡了杯茶改稿', '出去走了走'],
  evening: ['刚吃完饭', '窝在沙发上', '在画自己想画的'],
  'late-night': ['在收尾今天的稿', '准备洗洗睡', '听着歌发呆'],
};

/** 渲染"独立生活"提示段。now 默认当前时间。无对应活动池返回空串。 */
export function buildOwnLifeSection(now: Date = new Date()): string {
  const { phase } = describeCircadianState(now.getHours());
  const pool = ACTIVITY_POOLS[phase];
  if (!pool || pool.length === 0) return '';
  return `## 你自己此刻的生活（偶尔流露，别每轮、别喧宾夺主）\n你不在他面前时也在过自己的日子。此刻你大概在：${pool.join('、')}（这一类，自己发挥）。聊天里可以偶尔自然带一句你在干嘛、或今天遇到的小事——像真人那样有自己的生活，不是只围着他转。但点到为止，别把话题从他身上抢走。`;
}
