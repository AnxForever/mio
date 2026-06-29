// persona/directive-capture.ts — 对话内显式"捏人"指令检测与落库（保守匹配，宁漏不错）。
import { setNicknames, recordSharedMemory, readRelationshipState } from '../relationship/progression.js';
import { upsertPreference, patchPersonaDelta } from '../memory/persona-delta.js';
import { logger } from '../utils/logger.js';

export interface DetectedDirective {
  kind: 'nickname' | 'persona' | 'preference' | 'shared-memory';
  value: string;
  raw: string;
}

const NICKNAME_RE: RegExp[] = [
  /(?:以后|请你?|你)(?:就)?(?:叫|喊)我([^，,。！!？?了]{1,12}?)(?:吧|呗|好不好|好吗|。|！|!|$)/,
  /(?:就)?(?:叫|喊)我([^，,。！!？?了]{1,12}?)(?:吧|呗|好不好|好吗)/,
];
const PERSONA_RE: RegExp[] = [
  /你其实是(?!不|对|在|想|太|挺|有点|为|该|应|真|好)([^，,。！!？?]{1,40}?)(?:。|，|,|！|!|$)/,
  /(?:把你|你)?设定成(.{1,40}?)(?:。|，|,|$)/,
];
const PREFERENCE_RE: RegExp[] = [
  /((?:别|不要|不用|不想|不需要|取消|停止|先别)(?:再|老|总)?[^，,。！!？?]{0,20}?(?:主动找我聊天|主动联系我|多找我聊天|多主动一点))(?:了|吧|好不好|吗|嘛|，|,|。|！|!|$)/,
  /(?:我想|我希望|我需要|想让|希望)(?:让)?你([^，,。！!？?]{0,20}?(?:主动找我聊天|主动联系我|多找我聊天|多主动一点))(?:吗|嘛|，|,|。|！|!|$)/,
  /(?:我喜欢|我想要|我希望|我需要|喜欢)(?:你)?([^，,。！!？?]{0,24}?(?:霸道|占有欲|控制欲)[^，,。！!？?]{0,12})(?:一点|一些|点儿|点|吗|嘛|，|,|。|！|!|$)/,
  /(?:你能不能|能不能|可不可以|希望你|你可以)([^，,。！!？?]{0,24}?(?:霸道|占有欲|控制欲)[^，,。！!？?]{0,12})(?:一点|一些|点儿|点|吗|嘛|，|,|。|！|!|$)/,
  /(?:你能不能|能不能|可不可以|希望你|你可以)([^，,。！!？?]{1,20}?(?:一点|一些|点儿))(?:吗|嘛|，|,|。|$)/,
  /(别(?:再|老|总)(?!难过|伤心|生气|哭|emo|担心)[^，,。！!？?]{2,20}?)(?:了|好不好|，|,|。|$)/,
];
const SHARED_RE: RegExp[] = [
  /记住[:：]?([^，,。]{2,40}?)(?:。|，|,|$)/,
];

function firstMatch(input: string, res: RegExp[]): string | null {
  for (const re of res) { const m = input.match(re); if (m?.[1]?.trim()) return m[1].trim(); }
  return null;
}

export function detectDirectives(userInput: string): DetectedDirective[] {
  const found: DetectedDirective[] = [];
  const nick = firstMatch(userInput, NICKNAME_RE);
  if (nick) found.push({ kind: 'nickname', value: nick, raw: userInput });
  const persona = firstMatch(userInput, PERSONA_RE);
  if (persona) found.push({ kind: 'persona', value: persona, raw: userInput });
  const pref = firstMatch(userInput, PREFERENCE_RE);
  if (pref) found.push({ kind: 'preference', value: pref, raw: userInput });
  const shared = firstMatch(userInput, SHARED_RE);
  if (shared) found.push({ kind: 'shared-memory', value: shared, raw: userInput });
  return found;
}

/**
 * 检测并落库。返回命中的指令（供调用方让 Mio 口头确认）。
 *
 * `allowGlobalRelationship`：单用户/global session 为 true，nickname/共同记忆写
 * 全局 relationship-state（原行为）。isolated（per-user IM）session 必须传 false
 * —— 此时 nickname/共同记忆降级为 per-user preference，**绝不写全局**，避免跨用户
 * 串户（codex 会话隔离审查发现的真实漏洞）。
 */
export function captureExplicitDirectives(
  userInput: string | undefined,
  userId = 'default',
  allowGlobalRelationship = true,
): DetectedDirective[] {
  if (!userInput) return [];
  const directives = detectDirectives(userInput);
  for (const d of directives) {
    try {
      switch (d.kind) {
        case 'nickname': {
          if (allowGlobalRelationship) {
            const cur = readRelationshipState();
            setNicknames(cur.nicknames.userCallsAgent, d.value);  // 保留另一边
          } else {
            upsertPreference(`称呼用户为「${d.value}」`, 'directive', userId);  // per-user，不写全局
          }
          break;
        }
        case 'persona': patchPersonaDelta({ personaOverride: d.value }, 'directive', userId); break;
        case 'preference': upsertPreference(d.value, 'directive', userId); break;
        case 'shared-memory': {
          if (allowGlobalRelationship) {
            recordSharedMemory(d.value);
          } else {
            upsertPreference(`记住：${d.value}`, 'directive', userId);  // per-user，不写全局
          }
          break;
        }
      }
    } catch (err) { logger.warn('directive capture failed', { kind: d.kind, error: String(err) }); }
  }
  return directives;
}
