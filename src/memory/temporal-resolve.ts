/**
 * src/memory/temporal-resolve.ts — B-1：bi-temporal 矛盾消解（北极星 §4.1）
 *
 * 由 eval:contradiction 实测驱动：记忆 store 新旧并存无失效（住杭州+住上海、美式+拿铁全在），
 * 规模化/隐式变更会退化（mem0 都退回 ADD-only 放弃了自动消解）。
 *
 * 本模块标记被「更新事实」取代的旧事实（invalidatedAt，bi-temporal：不删除留审计），
 * structured-memory.ts 的 activeEntities 据此把失效项排除出 prompt-facing 检索。
 *
 * 引擎 resolveContradictions 是纯函数（矛盾判定 contradicts 注入）：
 *   - 单测注入确定性 fake（可复现）；
 *   - 生产注入 combineContradicts(ruleBased, llmBased)（规则优先，LLM 兜底）。
 *
 * 矛盾判定分三级（按成本从低到高）：
 *   1. Slot-based（确定性，零成本）：7 个单值槽位 regex 提取 → 同槽异值 = 取代
 *   2. Content-key（确定性，零成本）：同 type + 同内容键（前几个有意义的词）→ 内容不同 = 取代
 *   3. LLM（语义判定，有成本）：前两级无法判定时兜底
 *
 * MemStrata (arXiv:2606.26511) 定理：基于相似度的过期检测在结构上不可能
 * （cosine AUROC 仅 0.59）。正确做法是 S-R-O key matching——同 subject+relation、
 * 不同 object → 自动取代。本模块的 slot + content-key 两层实现此原理。
 */

import type { MemoryEntity } from './structured-memory.js';
import type { AIProvider } from '../types.js';

/** 旧事实是否被新事实取代（同主题、值冲突）。可同步(测试)或异步(LLM)。 */
export type Contradicts = (older: MemoryEntity, newer: MemoryEntity) => boolean | Promise<boolean>;

/**
 * 标记被取代的旧事实。只在同 type、newer.firstSeen > older.firstSeen 的候选对上问 contradicts，
 * 命中则给 older 打 invalidatedAt + supersededBy。bi-temporal：保留实体，仅标失效。
 */
export async function resolveContradictions(
  entities: MemoryEntity[],
  contradicts: Contradicts,
  now: string,
): Promise<{ entities: MemoryEntity[]; supersededCount: number }> {
  const out = entities.map((e) => ({ ...e }));
  let supersededCount = 0;
  for (let i = 0; i < out.length; i++) {
    if (out[i].invalidatedAt) continue;
    for (let j = 0; j < out.length; j++) {
      if (i === j || out[j].invalidatedAt) continue;
      if (out[j].type !== out[i].type) continue;                       // 矛盾只在同类事实间
      if ((out[j].firstSeen ?? '') <= (out[i].firstSeen ?? '')) continue; // j 必须更新
      if (await contradicts(out[i], out[j])) {
        out[i].invalidatedAt = now;
        out[i].supersededBy = out[j].content;
        supersededCount++;
        break;
      }
    }
  }
  return { entities: out, supersededCount };
}

export function resolveContradictionsSync(
  entities: MemoryEntity[],
  contradicts: (older: MemoryEntity, newer: MemoryEntity) => boolean,
  now: string,
): { entities: MemoryEntity[]; supersededCount: number } {
  const out = entities.map((e) => ({ ...e }));
  let supersededCount = 0;
  for (let i = 0; i < out.length; i++) {
    if (out[i].invalidatedAt) continue;
    for (let j = 0; j < out.length; j++) {
      if (i === j || out[j].invalidatedAt) continue;
      if (out[j].type !== out[i].type) continue;
      if ((out[j].firstSeen ?? '') <= (out[i].firstSeen ?? '')) continue;
      if (contradicts(out[i], out[j])) {
        out[i].invalidatedAt = now;
        out[i].supersededBy = out[j].content;
        supersededCount++;
        break;
      }
    }
  }
  return { entities: out, supersededCount };
}

export function makeRuleBasedContradicts(): Contradicts {
  return (older, newer) => {
    const oldText = normalizeText(older.content);
    const newText = normalizeText(newer.content);

    // L1: 显式槽位匹配（7 个单值槽位，regex 提取）
    const oldSlot = extractSingleValueSlot(oldText);
    const newSlot = extractSingleValueSlot(newText);
    if (oldSlot && newSlot && oldSlot.slot === newSlot.slot && oldSlot.value !== newSlot.value) {
      return true;
    }

    // L2: 内容键匹配（同 type + 同内容键 → 内容不同 = 取代）
    // MemStrata S-R-O 原理：同 subject(用户)+同 relation(内容键)、不同 object(值) → supersede
    if (contentKeyBasedContradiction(older, newer)) {
      return true;
    }

    if (older.type === 'preference' && newer.type === 'preference') {
      return preferenceNegates(oldText, newText);
    }

    return false;
  };
}

/**
 * 基于内容键的确定性矛盾检测（S-R-O key matching 的泛化实现）。
 *
 * 原理 (MemStrata, arXiv:2606.26511)：
 * - 所有实体 subject = "用户"（Mio 的记忆都是关于用户的）
 * - "Relation" = 两个实体共享的最长公共前缀 (LCP)
 * - LCP ≥ 2 CJK chars + 内容在原前缀之外不同 → 同一 relation，不同 object → 取代
 *
 * 这不是 similarity-based detection（MemStrata 警告的结构性错误做法），
 * 而是 key-matching：LCP 精确字符匹配，不依赖向量相似度。
 *
 * 安全限制：仅对持久状态类型 (fact/preference/decision/intention) 做 content-key 判定。
 * event/emotion 是瞬态的，多条可共存，不做自动取代。
 */
function contentKeyBasedContradiction(older: MemoryEntity, newer: MemoryEntity): boolean {
  if (older.type !== newer.type) return false;
  if (older.content === newer.content) return false; // 完全相同，不矛盾

  // 仅持久状态类型可自动取代；event/emotion 是瞬态的，多条可共存
  const persistentTypes: MemoryEntity['type'][] = ['fact', 'preference', 'decision', 'intention'];
  if (!persistentTypes.includes(older.type)) return false;

  const oldText = normalizeText(older.content);
  const newText = normalizeText(newer.content);

  // LCP: 两个实体共享的最长公共前缀
  const lcp = longestCommonPrefix(oldText, newText);

  // 要求 LCP ≥ 4 chars（过滤 "用户" 这种公共前缀误杀），
  // 且至少有一方在前缀之外还有额外内容
  if (lcp.length < 4) return false;
  if (oldText.length <= lcp.length && newText.length <= lcp.length) return false;

  // 去掉 "用户" 公共前缀后的 LCP 也必须 ≥ 2（进一步过滤 "用户N号事实" 误杀）
  const oldStripped = oldText.replace(/^用户/, '');
  const newStripped = newText.replace(/^用户/, '');
  if (oldStripped === newStripped) return false; // 去掉用户后完全相同，不矛盾
  const strippedLcp = longestCommonPrefix(oldStripped, newStripped);
  if (strippedLcp.length < 2) return false;

  return true;
}

/**
 * 两个字符串的最长公共前缀长度（字符数）。
 */
function longestCommonPrefix(a: string, b: string): string {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return a.slice(0, i);
}

/**
 * 从实体内容中提取内容键（S-R-O 里的 R: relation），用于分组优化。
 *
 * 策略：
 * 1. 从 slot 提取器中拿到的 slot 名是最精确的键
 * 2. 回退：取内容的前 N 个有意义的字符
 */
function extractContentKey(text: string): string | null {
  const normalized = text.replace(/\s+/g, '').replace(/[。！？!?，,、.]/g, '');

  // L1: slot 名作为键（最精确）
  const slot = extractSingleValueSlot(normalized);
  if (slot) return slot.slot;

  // L2: 去掉"用户"前缀，取前几个有意义的字符
  const stripped = normalized.replace(/^用户/, '');
  if (stripped.length < 2) return null;
  if (stripped.length <= 6) return stripped;

  // L3: 在第一个语义边界截断
  const m = stripped.match(/^(.{2,8}?)(?:[在了的到过]|$)/);
  return m ? m[1] : stripped.slice(0, 8);
}

export function combineContradicts(primary: Contradicts, fallback: Contradicts): Contradicts {
  return async (older, newer) => {
    if (await primary(older, newer)) return true;
    return fallback(older, newer);
  };
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, '').replace(/[。！？!?，,、.]/g, '');
}

type SingleValueSlot =
  | 'lives_in'
  | 'works_at'
  | 'studies_at'
  | 'drink_preference'
  | 'support_style'
  | 'relationship_boundary'
  | 'project_context';

function extractSingleValueSlot(text: string): { slot: SingleValueSlot; value: string } | null {
  const projectChange = text.match(/(?:不做|暂停|先不管)(论文|简历|毕设|项目|报告|考试|面试)(?:了|啦)?(?:改做|在做|忙|准备)(论文|简历|毕设|项目|报告|考试|面试)/);
  if (projectChange) return { slot: 'project_context', value: projectChange[2] };
  const project = text.match(/(?:在做|忙|准备|主要弄|主要做)(论文|简历|毕设|项目|报告|考试|面试)/);
  if (project) return { slot: 'project_context', value: project[1] };

  const live = text.match(/用户(?:现在)?(?:住在|在)(\S{2,20}?)(?:住|居住)?(?:了|啦)?$/)
    ?? text.match(/用户(?:搬到|搬去|搬进)(\S{2,20}?)(?:了|啦)?(?:现在住\1)?$/)
    ?? text.match(/用户.*现在住(\S{2,20}?)(?:了|啦)?$/);
  if (live) return { slot: 'lives_in', value: cleanValue(live[1]) };

  const work = text.match(/用户(?:现在)?在(\S{2,30}?)(?:工作|上班)(?:了|啦)?$/)
    ?? text.match(/用户(?:入职|去了|换到)(\S{2,30}?)(?:工作|上班)?(?:了|啦)?$/);
  if (work) return { slot: 'works_at', value: cleanValue(work[1]) };

  const study = text.match(/用户(?:现在)?在(\S{2,30}?)(?:上学|读书|学习)(?:了|啦)?$/)
    ?? text.match(/用户(?:转到|考到|去了)(\S{2,30}?)(?:上学|读书|学习)?(?:了|啦)?$/);
  if (study) return { slot: 'studies_at', value: cleanValue(study[1]) };

  const drinkChange = text.match(/(?:不喝|不喜欢喝|别给我|不要给我|不用给我)(咖啡|奶茶|茶|可乐|酒)(?:了|啦)?(?:改喝|喝|想喝|更喜欢)(咖啡|奶茶|茶|可乐|酒)/);
  if (drinkChange) return { slot: 'drink_preference', value: drinkChange[2] };
  const drink = text.match(/(?:喜欢喝|想喝|改喝|只喝|更喜欢)(咖啡|奶茶|茶|可乐|酒)/);
  if (drink) return { slot: 'drink_preference', value: drink[1] };

  const support = supportStyleValue(text);
  if (support) return { slot: 'support_style', value: support };

  const boundary = relationshipBoundaryValue(text);
  if (boundary) return { slot: 'relationship_boundary', value: boundary };

  return null;
}

function preferenceNegates(oldText: string, newText: string): boolean {
  if (!/(别|不要|不想|不喜欢|讨厌|别再|以后别)/.test(newText)) return false;
  const oldCalled = oldText.match(/(?:叫|称呼)(?:我|用户)?(\S{1,12})/);
  if (oldCalled && newText.includes(oldCalled[1])) return true;

  const oldLike = oldText.match(/(?:喜欢|爱|偏好)(\S{2,20})/);
  if (oldLike && newText.includes(oldLike[1])) return true;

  return false;
}

function supportStyleValue(text: string): 'companionship' | 'advice' | null {
  if (/(?:别|不要|不用|先别)(?:给我)?(?:建议|讲道理|分析|解决方案)/.test(text)) return 'companionship';
  if (/(?:只想|就想|需要|想要).{0,8}(?:陪我|抱抱|听我说|安静陪着)/.test(text)) return 'companionship';
  if (/(?:可以|需要|想要|给我).{0,8}(?:建议|分析|解决方案|办法)/.test(text)) return 'advice';
  if (/(?:建议|分析|解决方案|办法)/.test(text) && !/(?:别|不要|不用|先别)/.test(text)) return 'advice';
  return null;
}

function relationshipBoundaryValue(text: string): 'slow' | 'intimate' | null {
  if (/(?:刚认识|慢慢来|先别太亲密|别太黏|不要太黏|别叫宝贝|不要叫宝贝|别说爱我|不要说爱我)/.test(text)) return 'slow';
  if (/(?:黏一点|亲密一点|叫我宝贝|叫宝贝|说爱我|宝贝|爱你)/.test(text) && !/(?:别|不要|刚认识|慢慢来)/.test(text)) return 'intimate';
  return null;
}

function cleanValue(value: string): string {
  return value.replace(/(?:现在|目前|已经|了|啦)$/g, '').slice(0, 30);
}

const CONTRADICT_SYSTEM = `你判断"新事实"是否取代(更新)"旧事实"——同一属性的值变了、旧的不再成立。果断判断。

判 true（取代）的例子：
- 旧:用户在北京工作 / 新:用户现在在深圳工作 → true（工作地变了）
- 旧:用户在北京工作 / 新:用户上个月从北京调到了深圳 → true（已搬走，旧址不再成立）
- 旧:用户爱吃辣 / 新:用户现在忌口不吃辣了 → true（偏好反转）

判 false（不取代）的例子：
- 旧:用户在北京工作 / 新:用户曾经在北京工作 → false（在确认过去，没换成新值）
- 旧:用户叫小明 / 新:用户在准备考试 → false（不同属性，可同时成立）
- 旧:用户爱跑步 / 新:用户最近在赶项目 → false（互不相关）

规则：同一属性、值确实发生了变化 = true；不同属性、互不相关、或只是在补充/确认 = false。
只输出 JSON：{"supersedes": true} 或 {"supersedes": false}`;

/**
 * 生产用：基于真 provider 的语义矛盾判定（像 Zep 的 per-edge 矛盾检查）。
 * 接线时注入给 resolveContradictions。失败默认 false（宁可漏标，不可误杀记忆）。
 */
export function makeLLMContradicts(provider: AIProvider, model?: string): Contradicts {
  return async (older, newer) => {
    try {
      const res = await provider.chat(
        [{ role: 'user', content: `旧事实：${older.content}\n新事实：${newer.content}` }],
        CONTRADICT_SYSTEM,
        [],
        { temperature: 0, model },
      );
      const m = res.text.match(/\{[\s\S]*\}/);
      if (!m) return false;
      return JSON.parse(m[0]).supersedes === true;
    } catch {
      return false; // 判定失败时不标失效，保守
    }
  };
}
